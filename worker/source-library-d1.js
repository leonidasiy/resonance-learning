// @ts-check
import { isSubjectId } from "../src/features/knowledge-subjects/public.js";

import { isRecord } from "../src/features/source-library/contracts.js";
import { matchesPrivateDocumentReplay, sourceApprovalFingerprint } from "../src/features/source-library/repository.js";

/** @import { LibrarySource, Result, SourceInterestArea, SourceLibraryFailure, SourceIngestionJob, SourceSearchHit, KnowledgeSearchHit, SourceSuppression } from "../src/features/source-library/contracts.js" */
/** @import { ApprovalCommit, RevisionCommit, SuppressionCommit, TransitionCommit } from "../src/features/source-library/repository.js" */

const freeze = Object.freeze;

/** @typedef {{ readonly success: boolean, readonly meta?: { readonly changes?: number } }} D1Result */
/**
 * @typedef {{
 *   readonly bind: (...values: readonly (string | number | null)[]) => D1Statement,
 *   readonly first: () => Promise<unknown | null>,
 *   readonly all: () => Promise<{ readonly success: boolean, readonly results: readonly unknown[] }>,
 *   readonly run: () => Promise<D1Result>
 * }} D1Statement
 */
/**
 * @typedef {{
 *   readonly prepare: (query: string) => D1Statement,
 *   readonly batch: (statements: readonly D1Statement[]) => Promise<readonly D1Result[]>
 * }} D1DatabasePort
 */

/**
 * @typedef {{
 *   readonly owner_id: string,
 *   readonly source_id: string,
 *   readonly submitted_url: string,
 *   readonly canonical_url: string,
 *   readonly title: string,
 *   readonly description: string,
 *   readonly adapter_json: string,
 *   readonly identity_evidence_json: string,
 *   readonly state: string,
 *   readonly approved_at: string,
 *   readonly updated_at: string,
 *   readonly revision: number
 * }} SourceRow
 */

/** @typedef {{ readonly source_id: string, readonly command_fingerprint: string }} IdempotencyRow */

export class D1SourceLibraryRepository {
  /** @type {D1DatabasePort} */
  #database;

  /** @param {D1DatabasePort} database */
  constructor(database) {
    if (
      typeof database?.prepare !== "function" ||
      typeof database?.batch !== "function"
    ) {
      throw new TypeError("D1 source-library database is invalid.");
    }
    this.#database = database;
  }

  /** @param {string} ownerId @param {string} sourceId @returns {Promise<Result<LibrarySource | null, SourceLibraryFailure>>} */
  async read(ownerId, sourceId) {
    if (typeof ownerId !== "string" || ownerId.trim() === "" || typeof sourceId !== "string" || sourceId.trim() === "") throw new TypeError("Source read command is invalid.");
    try {
      return { ok: true, value: await this.#source(ownerId, sourceId) };
    } catch (error) {
      if (error instanceof Error) return { ok: false, error: { kind: "SourceCatalogReadFailed" } };
      throw error;
    }
  }

  /** @param {SuppressionCommit} commit @returns {Promise<Result<{ readonly suppression: SourceSuppression, readonly reused: boolean }, SourceLibraryFailure>>} */
  async suppress(commit) {
    try {
      const replay = await this.#suppression(
        "idempotency_key",
        commit.suppression.ownerId,
        commit.suppression.idempotencyKey,
      );
      if (replay !== null) {
        if (replay.commandFingerprint !== commit.fingerprint) {
          return {
            ok: false,
            error: {
              kind: "SourceIdempotencyConflict",
              idempotencyKey: commit.suppression.idempotencyKey,
            },
          };
        }
        return {
          ok: true,
          value: freeze({ suppression: replay.value, reused: true }),
        };
      }
      const canonical = await this.#suppression(
        "canonical_identity",
        commit.suppression.ownerId,
        commit.suppression.canonicalIdentity,
      );
      if (canonical !== null) {
        return {
          ok: true,
          value: freeze({ suppression: canonical.value, reused: true }),
        };
      }
      const storedEvidence = JSON.stringify({
        identityEvidence: commit.suppression.identityEvidence,
        commandFingerprint: commit.fingerprint,
      });
      await this.#batch([
        this.#database.prepare(
          "INSERT INTO source_suppressions (owner_id, suppression_id, canonical_identity, evidence_json, idempotency_key, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        ).bind(
          commit.suppression.ownerId,
          commit.suppression.id,
          commit.suppression.canonicalIdentity,
          storedEvidence,
          commit.suppression.idempotencyKey,
          commit.suppression.createdAt,
        ),
      ]);
      return {
        ok: true,
        value: freeze({ suppression: commit.suppression, reused: false }),
      };
    } catch (error) {
      if (error instanceof TypeError) throw error;
      if (error instanceof Error) {
        return { ok: false, error: { kind: "SourceSuppressionFailed" } };
      }
      throw error;
    }
  }

  /** @param {{ readonly ownerId: string, readonly limit: number, readonly after: null | { readonly approvedAt: string, readonly sourceId: string } }} query @returns {Promise<Result<{ readonly items: readonly LibrarySource[], readonly interestAreas: readonly SourceInterestArea[], readonly catalogRevision: string }, SourceLibraryFailure>>} */
  async browseActive(query) {
    try {
      const where = query.after === null
        ? "WHERE s.owner_id = ? AND s.state = 'active'"
        : "WHERE s.owner_id = ? AND s.state = 'active' AND (s.approved_at < ? OR (s.approved_at = ? AND s.source_id < ?))";
      const bindings = query.after === null ? [query.ownerId, query.limit] : [
        query.ownerId,
        query.after.approvedAt,
        query.after.approvedAt,
        query.after.sourceId,
        query.limit,
      ];
      const [items, areas, revision] = await Promise.all([
        this.#allSources(
          `${SOURCE_SELECT} ${where} GROUP BY s.owner_id, s.source_id ORDER BY s.approved_at DESC, s.source_id DESC LIMIT ?`,
          bindings,
        ),
        this.#all(
          "SELECT interest_area_id, label, provenance_json FROM interest_areas WHERE owner_id = ? ORDER BY label, interest_area_id",
          [query.ownerId],
        ),
        this.#database.prepare(
          "SELECT CAST(COUNT(*) AS TEXT) || ':' || COALESCE(MAX(updated_at), '') AS catalog_revision FROM library_sources WHERE owner_id = ? AND state = 'active'",
        ).bind(query.ownerId).first(),
      ]);
      if (
        !isRecord(revision) || typeof revision.catalog_revision !== "string"
      ) {
        throw new TypeError("Stored D1 catalog revision is invalid.");
      }
      const interestAreas = areas.map((row) =>
        interestAreaFromRow(row, query.ownerId)
      );
      return {
        ok: true,
        value: freeze({
          items: freeze(items),
          interestAreas: freeze(interestAreas),
          catalogRevision: revision.catalog_revision,
        }),
      };
    } catch (error) {
      if (error instanceof TypeError) throw error;
      if (error instanceof Error) {
        return { ok: false, error: { kind: "SourceCatalogReadFailed" } };
      }
      throw error;
    }
  }

  /** @param {{ readonly ownerId: string, readonly query: string, readonly limit: number }} query @returns {Promise<Result<readonly SourceSearchHit[], SourceLibraryFailure>>} */
  async keywordSearch(query) {
    const match = ftsQuery(query.query);
    if (match === null) {
      return { ok: false, error: { kind: "SourceSearchQueryInvalid" } };
    }
    try {
      const rows = await this.#all(
        `SELECT ${SEARCH_SOURCE_COLUMNS}, bm25(library_sources_fts) AS search_rank FROM library_sources s JOIN library_sources_fts ON library_sources_fts.owner_id = s.owner_id AND library_sources_fts.source_id = s.source_id WHERE s.owner_id = ? AND s.state = 'active' AND library_sources_fts MATCH ? ORDER BY search_rank ASC, s.approved_at DESC, s.source_id DESC LIMIT ?`,
        [query.ownerId, match, query.limit],
      );
      return {
        ok: true,
        value: freeze(rows.map((row) => {
          if (!isRecord(row) || typeof row.search_rank !== "number") {
            throw new TypeError("Stored D1 keyword rank is invalid.");
          }
          return freeze({
            source: sourceFromRow(
              /** @type {SourceRow & { readonly interest_area_ids_json: string }} */ (row),
            ),
            score: -row.search_rank,
          });
        })),
      };
    } catch (error) {
      if (error instanceof TypeError) throw error;
      if (error instanceof Error) {
        return { ok: false, error: { kind: "SourceKeywordSearchUnavailable" } };
      }
      throw error;
    }
  }

  /** @param {{ readonly ownerId: string, readonly query: string, readonly limit: number }} query @returns {Promise<Result<readonly KnowledgeSearchHit[], SourceLibraryFailure>>} */
  async knowledgeKeywordSearch(query) {
    const match = ftsQuery(query.query);
    if (match === null) return { ok: false, error: { kind: "SourceSearchQueryInvalid" } };
    try {
      const rows = await this.#all(
        `SELECT k.owner_id, k.knowledge_id, k.source_id, k.point_json, s.title AS source_title, s.canonical_url AS source_url, CASE WHEN l.studied_at IS NULL THEN 1 ELSE 0 END AS question_locked, bm25(knowledge_points_search_fts) AS search_rank FROM knowledge_points_search_fts JOIN extraction_knowledge_points k ON k.owner_id = knowledge_points_search_fts.owner_id AND k.knowledge_id = knowledge_points_search_fts.knowledge_id JOIN library_sources s ON s.owner_id = k.owner_id AND s.source_id = k.source_id LEFT JOIN learner_knowledge_state l ON l.owner_id = k.owner_id AND l.knowledge_id = k.knowledge_id WHERE k.owner_id = ? AND knowledge_points_search_fts.owner_id = ? AND s.state = 'active' AND k.source_revision = s.revision AND json_type(k.point_json, '$.summary') = 'text' AND length(trim(json_extract(k.point_json, '$.summary'), char(9, 10, 11, 12, 13, 32, 160, 5760, 8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200, 8201, 8202, 8232, 8233, 8239, 8287, 12288, 65279))) > 0 AND EXISTS (SELECT 1 FROM knowledge_workflow_runs r WHERE r.owner_id = k.owner_id AND r.run_id = k.run_id AND r.source_id = k.source_id AND r.source_revision = k.source_revision AND r.state = 'completed') AND EXISTS (SELECT 1 FROM knowledge_workflow_quizzes q JOIN learning_generation_tasks t ON t.owner_id = q.owner_id AND t.item_id = q.knowledge_id AND t.status = 'published' WHERE q.owner_id = k.owner_id AND q.run_id = k.run_id AND q.knowledge_id = k.knowledge_id AND q.source_id = k.source_id AND q.source_revision = k.source_revision AND q.status = 'published') AND knowledge_points_search_fts MATCH ? ORDER BY search_rank ASC, k.created_at ASC, k.knowledge_id ASC LIMIT ?`,
        [query.ownerId, query.ownerId, match, query.limit],
      );
      return { ok: true, value: freeze(rows.map((row) => {
        if (!isRecord(row) || typeof row.search_rank !== "number") throw new TypeError("Stored D1 knowledge search rank is invalid.");
        return freeze({ knowledge: knowledgeSearchFromRow(row), score: -row.search_rank, matchedBy: /** @type {const} */ ("exact") });
      })) };
    } catch (error) {
      if (error instanceof TypeError) throw error;
      if (error instanceof Error) return { ok: false, error: { kind: "SourceKeywordSearchUnavailable" } };
      throw error;
    }
  }

  /** @param {{ readonly ownerId: string, readonly limit: number }} query @returns {Promise<Result<{ readonly candidates: readonly { readonly knowledge: KnowledgeSearchHit["knowledge"], readonly sourceRevision: number, readonly sourceTopic: string | null }[], readonly privateDerivedCount: number }, SourceLibraryFailure>>} */
  async knowledgeSemanticCandidates(query) {
    if (!isRecord(query) || typeof query.ownerId !== "string" || query.ownerId.trim() === "" || !Number.isInteger(query.limit) || query.limit < 1) return { ok: false, error: { kind: "SourceSemanticIndexUnavailable" } };
    try {
      const [rows, privateRow] = await Promise.all([
        this.#all("SELECT k.owner_id, k.knowledge_id, k.source_id, k.source_revision, k.point_json, s.title AS source_title, s.canonical_url AS source_url, sc.topic AS source_topic, CASE WHEN l.studied_at IS NULL THEN 1 ELSE 0 END AS question_locked FROM extraction_knowledge_points k JOIN library_sources s ON s.owner_id = k.owner_id AND s.source_id = k.source_id LEFT JOIN source_classifications sc ON sc.owner_id = k.owner_id AND sc.source_id = k.source_id LEFT JOIN learner_knowledge_state l ON l.owner_id = k.owner_id AND l.knowledge_id = k.knowledge_id WHERE k.owner_id = ? AND s.state = 'active' AND k.source_revision = s.revision AND json_type(k.point_json, '$.summary') = 'text' AND length(trim(json_extract(k.point_json, '$.summary'), char(9, 10, 11, 12, 13, 32, 160, 5760, 8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200, 8201, 8202, 8232, 8233, 8239, 8287, 12288, 65279))) > 0 AND EXISTS (SELECT 1 FROM knowledge_workflow_runs r WHERE r.owner_id = k.owner_id AND r.run_id = k.run_id AND r.source_id = k.source_id AND r.source_revision = k.source_revision AND r.state = 'completed') AND EXISTS (SELECT 1 FROM knowledge_workflow_quizzes q JOIN learning_generation_tasks t ON t.owner_id = q.owner_id AND t.item_id = q.knowledge_id AND t.status = 'published' WHERE q.owner_id = k.owner_id AND q.run_id = k.run_id AND q.knowledge_id = k.knowledge_id AND q.source_id = k.source_id AND q.source_revision = k.source_revision AND q.status = 'published') AND NOT EXISTS (SELECT 1 FROM knowledge_workflow_materials m WHERE m.owner_id = k.owner_id AND m.run_id = k.run_id AND json_type(m.material_json, '$.provenance.processingAllowed') IS NOT 'true') ORDER BY k.created_at ASC, k.knowledge_id ASC LIMIT ?", [query.ownerId.trim(), query.limit]),
        this.#database.prepare("SELECT COUNT(*) AS private_derived_count FROM extraction_knowledge_points k JOIN library_sources s ON s.owner_id = k.owner_id AND s.source_id = k.source_id WHERE k.owner_id = ? AND s.state = 'active' AND k.source_revision = s.revision AND json_type(k.point_json, '$.summary') = 'text' AND length(trim(json_extract(k.point_json, '$.summary'), char(9, 10, 11, 12, 13, 32, 160, 5760, 8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200, 8201, 8202, 8232, 8233, 8239, 8287, 12288, 65279))) > 0 AND EXISTS (SELECT 1 FROM knowledge_workflow_runs r WHERE r.owner_id = k.owner_id AND r.run_id = k.run_id AND r.source_id = k.source_id AND r.source_revision = k.source_revision AND r.state = 'completed') AND EXISTS (SELECT 1 FROM knowledge_workflow_quizzes q JOIN learning_generation_tasks t ON t.owner_id = q.owner_id AND t.item_id = q.knowledge_id AND t.status = 'published' WHERE q.owner_id = k.owner_id AND q.run_id = k.run_id AND q.knowledge_id = k.knowledge_id AND q.source_id = k.source_id AND q.source_revision = k.source_revision AND q.status = 'published') AND EXISTS (SELECT 1 FROM knowledge_workflow_materials m WHERE m.owner_id = k.owner_id AND m.run_id = k.run_id AND json_type(m.material_json, '$.provenance.processingAllowed') IS NOT 'true')").bind(query.ownerId.trim()).first(),
      ]);
      if (!isRecord(privateRow) || !Number.isSafeInteger(privateRow.private_derived_count) || /** @type {number} */ (privateRow.private_derived_count) < 0) throw new TypeError("Stored semantic provenance count is invalid.");
      const privateDerivedCount = /** @type {number} */ (privateRow.private_derived_count);
      const candidates = rows.map((row) => {
        if (!isRecord(row) || !Number.isSafeInteger(row.source_revision) || /** @type {number} */ (row.source_revision) < 1) throw new TypeError("Stored knowledge source revision is invalid.");
        if (row.source_topic !== null && typeof row.source_topic !== "string") throw new TypeError("Stored source classification topic is invalid.");
        return freeze({ knowledge: knowledgeSearchFromRow(row), sourceRevision: /** @type {number} */ (row.source_revision), sourceTopic: typeof row.source_topic === "string" ? row.source_topic : null });
      });
      return { ok: true, value: freeze({ candidates: freeze(candidates), privateDerivedCount }) };
    } catch (error) {
      if (error instanceof TypeError) throw error;
      if (error instanceof Error) return { ok: false, error: { kind: "SourceSemanticIndexUnavailable" } };
      throw error;
    }
  }

  /** @param {{ readonly ownerId: string, readonly sourceIds: readonly string[] }} query @returns {Promise<Result<readonly LibrarySource[], SourceLibraryFailure>>} */
  async activeByIds(query) {
    if (query.sourceIds.length === 0) return { ok: true, value: freeze([]) };
    try {
      const placeholders = query.sourceIds.map(() => "?").join(", ");
      const items = await this.#allSources(
        `${SOURCE_SELECT} WHERE s.owner_id = ? AND s.state = 'active' AND s.source_id IN (${placeholders}) GROUP BY s.owner_id, s.source_id`,
        [query.ownerId, ...query.sourceIds],
      );
      const byId = new Map(items.map((item) => [item.id, item]));
      return {
        ok: true,
        value: freeze(query.sourceIds.flatMap((id) => {
          const item = byId.get(id);
          return item === undefined ? [] : [item];
        })),
      };
    } catch (error) {
      if (error instanceof TypeError) throw error;
      if (error instanceof Error) {
        return { ok: false, error: { kind: "SourceCatalogReadFailed" } };
      }
      throw error;
    }
  }

  /** @param {{ readonly ownerId: string, readonly canonicalIdentities: readonly string[] }} query @returns {Promise<Result<readonly string[], SourceLibraryFailure>>} */
  async suppressed(query) {
    try {
      const placeholders = query.canonicalIdentities.map(() => "?").join(", ");
      const rows = await this.#all(
        `SELECT canonical_identity FROM source_suppressions WHERE owner_id = ? AND canonical_identity IN (${placeholders}) ORDER BY canonical_identity`,
        [query.ownerId, ...query.canonicalIdentities],
      );
      const identities = rows.map((row) => {
        if (!isRecord(row) || typeof row.canonical_identity !== "string") {
          throw new TypeError("Stored D1 suppression identity is invalid.");
        }
        return row.canonical_identity;
      });
      return { ok: true, value: freeze(identities) };
    } catch (error) {
      if (error instanceof TypeError) throw error;
      if (error instanceof Error) {
        return { ok: false, error: { kind: "SourceCatalogReadFailed" } };
      }
      throw error;
    }
  }

  /**
   * @param {ApprovalCommit} commit
   * @returns {Promise<Result<{ readonly source: LibrarySource, readonly job: SourceIngestionJob | null, readonly reused: boolean }, SourceLibraryFailure>>}
   */
  async approve(commit) {
    try {
      const replay = await this.#idempotency(
        commit.source.ownerId,
        commit.event.idempotencyKey,
      );
      if (replay !== null) {
        const source = await this.#source(commit.source.ownerId, replay.source_id);
        if (source === null) throw new TypeError("D1 source idempotency invariant is broken.");
        if (sourceApprovalFingerprint(replay.command_fingerprint, commit.source.adapter.id) !== commit.fingerprint && !matchesPrivateDocumentReplay(commit, replay.command_fingerprint, source)) {
          return {
            ok: false,
            error: {
              kind: "SourceIdempotencyConflict",
              idempotencyKey: commit.event.idempotencyKey,
            },
          };
        }
        return { ok: true, value: freeze({ source, job: null, reused: true }) };
      }

      const areas = await this.#validateInterestAreas(
        commit.source.ownerId,
        commit.source.interestAreaIds,
      );
      if (!areas.ok) return areas;

      const canonical = await this.#canonical(
        commit.source.ownerId,
        commit.source.canonicalUrl,
      );
      if (canonical !== null) {
        if (canonical.state !== "active") {
          return {
            ok: false,
            error: {
              kind: "SourceStateConflict",
              sourceId: canonical.id,
              state: canonical.state,
              revision: canonical.revision,
            },
          };
        }
        await this.#batch([this.#eventStatement({
          ...commit.event,
          sourceId: canonical.id,
          sourceRevision: canonical.revision,
        }, commit.fingerprint)]);
        return {
          ok: true,
          value: freeze({ source: canonical, job: null, reused: true }),
        };
      }

      const statements = [
        this.#database.prepare(
          "INSERT INTO library_sources (owner_id, source_id, submitted_url, canonical_url, title, description, adapter_json, identity_evidence_json, state, approved_at, updated_at, revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ).bind(
          commit.source.ownerId,
          commit.source.id,
          commit.source.submittedUrl,
          commit.source.canonicalUrl,
          commit.source.title,
          commit.source.description,
          JSON.stringify(commit.source.adapter),
          JSON.stringify(commit.source.identityEvidence),
          commit.source.state,
          commit.source.approvedAt,
          commit.source.updatedAt,
          commit.source.revision,
        ),
        this.#eventStatement(commit.event, commit.fingerprint),
        ...commit.source.interestAreaIds.map((
          /** @type {string} */ interestAreaId,
        ) =>
          this.#database.prepare(
            "INSERT INTO source_interest_areas (owner_id, source_id, interest_area_id, assigned_at) VALUES (?, ?, ?, ?)",
          ).bind(
            commit.source.ownerId,
            commit.source.id,
            interestAreaId,
            commit.event.occurredAt,
          )
        ),
        ...(commit.job === null ? [] : [this.#database.prepare(
          "INSERT INTO source_ingestion_jobs (owner_id, job_id, source_id, source_revision, policy_version, state, idempotency_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ).bind(
          commit.job.ownerId,
          commit.job.id,
          commit.job.sourceId,
          commit.job.sourceRevision,
          commit.job.policyVersion,
          commit.job.state,
          commit.event.idempotencyKey,
          commit.job.createdAt,
          commit.job.createdAt,
        )]),
        ...(commit.initialItem == null ? [] : [this.#database.prepare(
          "INSERT INTO source_item_versions (owner_id, source_id, item_id, version_id, canonical_url, title, description, content_digest, provenance_json, observed_at, published_at, source_revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ).bind(
          commit.initialItem.ownerId, commit.initialItem.sourceId,
          commit.initialItem.itemId, commit.initialItem.versionId,
          commit.initialItem.canonicalUrl, commit.initialItem.title,
          commit.initialItem.description, commit.initialItem.contentDigest,
          JSON.stringify(commit.initialItem.provenance), commit.initialItem.observedAt,
          commit.initialItem.publishedAt, commit.initialItem.sourceRevision,
        )]),
      ];
      await this.#batch(statements);
      return {
        ok: true,
        value: freeze({
          source: commit.source,
          job: commit.job,
          reused: false,
        }),
      };
    } catch (error) {
      if (error instanceof TypeError) throw error;
      if (error instanceof Error) {
        // A concurrent transaction may have committed the exact command while this batch rolled back.
        try {
          const winner = await this.#idempotency(commit.source.ownerId,commit.event.idempotencyKey);
          if (winner !== null && sourceApprovalFingerprint(winner.command_fingerprint, commit.source.adapter.id) !== commit.fingerprint) return {ok:false,error:{kind:"SourceIdempotencyConflict",idempotencyKey:commit.event.idempotencyKey}};
          if (winner !== null) {
            const source = await this.#source(commit.source.ownerId,winner.source_id);
            if (source !== null && source.state === "active" && source.canonicalUrl === commit.source.canonicalUrl) {
              console.info(JSON.stringify({event:"source-approval-concurrent-reuse",ownerId:source.ownerId,sourceId:source.id}));
              return {ok:true,value:freeze({source,job:null,reused:true})};
            }
          } else {
            const source = await this.#canonical(commit.source.ownerId,commit.source.canonicalUrl);
            if (source !== null && source.state === "active") {
              // Preserve the existing canonical-source reuse contract for concurrent distinct request keys.
              await this.#batch([this.#eventStatement({...commit.event,sourceId:source.id,sourceRevision:source.revision},commit.fingerprint)]);
              console.info(JSON.stringify({event:"source-approval-concurrent-canonical-reuse",ownerId:source.ownerId,sourceId:source.id}));
              return {ok:true,value:freeze({source,job:null,reused:true})};
            }
          }
        } catch (readError) {
          if (!(readError instanceof Error)) throw readError;
          console.error(JSON.stringify({event:"source-approval-reconciliation-failure",ownerId:commit.source.ownerId,failureKind:"SourceApprovalPersistenceFailed"}));
        }
        return {
          ok: false,
          error: { kind: "SourceApprovalPersistenceFailed" },
        };
      }
      throw error;
    }
  }

  /** @param {RevisionCommit} commit @returns {Promise<Result<LibrarySource, SourceLibraryFailure>>} */
  async revise(commit) {
    try {
      const replay = await this.#replayedSource(commit);
      if (replay !== null) return replay;
      const current = await this.#ownedSource(commit.ownerId, commit.sourceId);
      if (!current.ok) return current;
      const areas = await this.#validateInterestAreas(
        commit.ownerId,
        commit.interestAreaIds,
      );
      if (!areas.ok) return areas;
      const source = current.value;
      if (source.revision !== commit.expectedRevision) {
        return stale(commit.expectedRevision, source.revision);
      }
      if (source.state !== "active") return stateConflict(source);
      const next = freeze({
        ...source,
        title: commit.title,
        description: commit.description,
        interestAreaIds: freeze([...commit.interestAreaIds]),
        updatedAt: commit.event.occurredAt,
        revision: source.revision + 1,
      });
      const statements = [
        this.#database.prepare(
          "UPDATE library_sources SET title = ?, description = ?, updated_at = ?, revision = revision + 1 WHERE owner_id = ? AND source_id = ? AND revision = ? AND state = 'active'",
        ).bind(
          commit.title,
          commit.description,
          commit.event.occurredAt,
          commit.ownerId,
          commit.sourceId,
          commit.expectedRevision,
        ),
        this.#database.prepare(
          "DELETE FROM source_interest_areas WHERE owner_id = ? AND source_id = ?",
        ).bind(commit.ownerId, commit.sourceId),
        ...commit.interestAreaIds.map((/** @type {string} */ interestAreaId) =>
          this.#database.prepare(
            "INSERT INTO source_interest_areas (owner_id, source_id, interest_area_id, assigned_at) VALUES (?, ?, ?, ?)",
          ).bind(
            commit.ownerId,
            commit.sourceId,
            interestAreaId,
            commit.event.occurredAt,
          )
        ),
        this.#eventStatement(commit.event, commit.fingerprint),
      ];
      const results = await this.#batch(statements);
      if ((results[0].meta?.changes ?? 0) !== 1) {
        return stale(commit.expectedRevision, source.revision);
      }
      return { ok: true, value: next };
    } catch (error) {
      if (error instanceof TypeError) throw error;
      if (error instanceof Error) {
        return {
          ok: false,
          error: { kind: "SourceApprovalPersistenceFailed" },
        };
      }
      throw error;
    }
  }

  /** @param {TransitionCommit} commit @returns {Promise<Result<LibrarySource, SourceLibraryFailure>>} */
  async transition(commit) {
    try {
      const replay = await this.#replayedSource(commit);
      if (replay !== null) return replay;
      const current = await this.#ownedSource(commit.ownerId, commit.sourceId);
      if (!current.ok) return current;
      const source = current.value;
      if (source.revision !== commit.expectedRevision) {
        return stale(commit.expectedRevision, source.revision);
      }
      if (source.state === commit.targetState) return stateConflict(source);
      const next = freeze({
        ...source,
        state: commit.targetState,
        updatedAt: commit.event.occurredAt,
        revision: source.revision + 1,
      });
      const results = await this.#batch([
        this.#database.prepare(
          "UPDATE library_sources SET state = ?, updated_at = ?, revision = revision + 1 WHERE owner_id = ? AND source_id = ? AND revision = ? AND state = ?",
        ).bind(
          commit.targetState,
          commit.event.occurredAt,
          commit.ownerId,
          commit.sourceId,
          commit.expectedRevision,
          source.state,
        ),
        this.#eventStatement(commit.event, commit.fingerprint),
        ...(commit.targetState === "disabled"
          ? [
            this.#database.prepare(
              "UPDATE source_ingestion_jobs SET state = 'cancelled', updated_at = ? WHERE owner_id = ? AND source_id = ? AND state IN ('pending', 'leased', 'partial')",
            ).bind(commit.event.occurredAt, commit.ownerId, commit.sourceId),
          ]
          : []),
      ]);
      if ((results[0].meta?.changes ?? 0) !== 1) {
        return stale(commit.expectedRevision, source.revision);
      }
      return { ok: true, value: next };
    } catch (error) {
      if (error instanceof TypeError) throw error;
      if (error instanceof Error) {
        return { ok: false, error: { kind: "SourceDisablePersistenceFailed" } };
      }
      throw error;
    }
  }

  /** @param {string} ownerId @param {string} idempotencyKey @returns {Promise<IdempotencyRow | null>} */
  async #idempotency(ownerId, idempotencyKey) {
    return /** @type {IdempotencyRow | null} */ (await this.#database.prepare(
      "SELECT source_id, command_fingerprint FROM library_source_events WHERE owner_id = ? AND idempotency_key = ?",
    ).bind(ownerId, idempotencyKey).first());
  }

  /** @param {"idempotency_key" | "canonical_identity"} field @param {string} ownerId @param {string} value */
  async #suppression(field, ownerId, value) {
    const row = await this.#database.prepare(
      `SELECT suppression_id, canonical_identity, evidence_json, idempotency_key, created_at FROM source_suppressions WHERE owner_id = ? AND ${field} = ? LIMIT 1`,
    ).bind(ownerId, value).first();
    if (row === null) return null;
    if (
      !isRecord(row) || typeof row.suppression_id !== "string" ||
      typeof row.canonical_identity !== "string" ||
      typeof row.evidence_json !== "string" ||
      typeof row.idempotency_key !== "string" ||
      typeof row.created_at !== "string"
    ) {
      throw new TypeError("Stored D1 suppression is invalid.");
    }
    const evidence = JSON.parse(row.evidence_json);
    if (
      !isRecord(evidence) || !Array.isArray(evidence.identityEvidence) ||
      typeof evidence.commandFingerprint !== "string"
    ) {
      throw new TypeError("Stored D1 suppression evidence is invalid.");
    }
    return freeze({
      commandFingerprint: evidence.commandFingerprint,
      value: freeze({
        id: row.suppression_id,
        ownerId,
        canonicalIdentity: row.canonical_identity,
        identityEvidence: freeze(evidence.identityEvidence),
        idempotencyKey: row.idempotency_key,
        createdAt: row.created_at,
      }),
    });
  }

  /** @param {string} sql @param {readonly (string | number | null)[]} bindings */
  async #all(sql, bindings) {
    const result = await this.#database.prepare(sql).bind(...bindings).all();
    if (result.success !== true || !Array.isArray(result.results)) {
      throw new Error("D1 source-library read failed.");
    }
    return result.results;
  }

  /** @param {string} sql @param {readonly (string | number | null)[]} bindings */
  async #allSources(sql, bindings) {
    const rows = await this.#all(sql, bindings);
    return rows.map((row) =>
      sourceFromRow(
        /** @type {SourceRow & { readonly interest_area_ids_json: string }} */ (row),
      )
    );
  }

  /**
   * @param {{ readonly ownerId: string, readonly sourceId: string, readonly event: { readonly idempotencyKey: string }, readonly fingerprint: string }} commit
   * @returns {Promise<Result<LibrarySource, Extract<SourceLibraryFailure, { readonly kind: "SourceIdempotencyConflict" }>> | null>}
   */
  async #replayedSource(commit) {
    const replay = await this.#idempotency(
      commit.ownerId,
      commit.event.idempotencyKey,
    );
    if (replay === null) return null;
    if (replay.command_fingerprint !== commit.fingerprint) {
      return {
        ok: false,
        error: {
          kind: /** @type {const} */ ("SourceIdempotencyConflict"),
          idempotencyKey: commit.event.idempotencyKey,
        },
      };
    }
    const source = await this.#source(commit.ownerId, replay.source_id);
    if (source === null) {
      throw new TypeError("D1 event/source invariant is broken.");
    }
    return { ok: /** @type {const} */ (true), value: source };
  }

  /**
   * @param {string} ownerId
   * @param {string} sourceId
   * @returns {Promise<Result<LibrarySource, Extract<SourceLibraryFailure, { readonly kind: "SourceNotFound" | "SourceOwnerMismatch" }>>>}
   */
  async #ownedSource(ownerId, sourceId) {
    const source = await this.#source(ownerId, sourceId);
    if (source !== null) {
      return { ok: /** @type {const} */ (true), value: source };
    }
    const anotherOwner =
      /** @type {{ readonly owner_id: string } | null} */ (await this.#database
        .prepare(
          "SELECT owner_id FROM library_sources WHERE source_id = ? LIMIT 1",
        ).bind(sourceId).first());
    return anotherOwner === null
      ? {
        ok: false,
        error: { kind: /** @type {const} */ ("SourceNotFound"), sourceId },
      }
      : {
        ok: false,
        error: { kind: /** @type {const} */ ("SourceOwnerMismatch"), sourceId },
      };
  }

  /**
   * @param {string} ownerId
   * @param {readonly string[]} interestAreaIds
   * @returns {Promise<Result<true, Extract<SourceLibraryFailure, { readonly kind: "SourceInterestAreaMissing" }>>>}
   */
  async #validateInterestAreas(ownerId, interestAreaIds) {
    for (const interestAreaId of interestAreaIds) {
      const row = await this.#database.prepare(
        "SELECT interest_area_id FROM interest_areas WHERE owner_id = ? AND interest_area_id = ?",
      ).bind(ownerId, interestAreaId).first();
      if (row === null) {
        return {
          ok: false,
          error: {
            kind: "SourceInterestAreaMissing",
            interestAreaId,
          },
        };
      }
    }
    return { ok: true, value: true };
  }

  /** @param {string} ownerId @param {string} canonicalUrl @returns {Promise<LibrarySource | null>} */
  async #canonical(ownerId, canonicalUrl) {
    const row =
      /** @type {(SourceRow & { readonly interest_area_ids_json: string }) | null} */ (await this
        .#database.prepare(
          `${SOURCE_SELECT} WHERE s.owner_id = ? AND s.canonical_url = ? GROUP BY s.owner_id, s.source_id`,
        ).bind(ownerId, canonicalUrl).first());
    return row === null ? null : sourceFromRow(row);
  }

  /** @param {string} ownerId @param {string} sourceId @returns {Promise<LibrarySource | null>} */
  async #source(ownerId, sourceId) {
    const row =
      /** @type {(SourceRow & { readonly interest_area_ids_json: string }) | null} */ (await this
        .#database.prepare(
          `${SOURCE_SELECT} WHERE s.owner_id = ? AND s.source_id = ? GROUP BY s.owner_id, s.source_id`,
        ).bind(ownerId, sourceId).first());
    return row === null ? null : sourceFromRow(row);
  }

  /** @param {import("../src/features/source-library/contracts.js").LibrarySourceEvent} event @param {string} fingerprint */
  #eventStatement(event, fingerprint) {
    return this.#database.prepare(
      "INSERT INTO library_source_events (owner_id, event_id, source_id, event_kind, source_revision, idempotency_key, command_fingerprint, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(
      event.ownerId,
      event.id,
      event.sourceId,
      event.kind,
      event.sourceRevision,
      event.idempotencyKey,
      fingerprint,
      event.occurredAt,
    );
  }

  /** @param {readonly D1Statement[]} statements */
  async #batch(statements) {
    const results = await this.#database.batch(statements);
    if (
      results.length !== statements.length ||
      results.some((result) => result.success !== true)
    ) {
      throw new Error("D1 source-library batch did not commit.");
    }
    return results;
  }
}

const SOURCE_CLASSIFICATION_COLUMN = "(SELECT sc.main_subject FROM source_classifications sc WHERE sc.owner_id = s.owner_id AND sc.source_id = s.source_id AND sc.source_revision = s.revision AND sc.status = 'classified') AS primary_subject, (SELECT sc.topic FROM source_classifications sc WHERE sc.owner_id = s.owner_id AND sc.source_id = s.source_id AND sc.source_revision = s.revision AND sc.status = 'classified') AS source_topic";
const SOURCE_COLUMNS =
  `s.owner_id, s.source_id, s.submitted_url, s.canonical_url, s.title, s.description, s.adapter_json, s.identity_evidence_json, s.state, s.approved_at, s.updated_at, s.revision, ${SOURCE_CLASSIFICATION_COLUMN}, COALESCE(json_group_array(a.interest_area_id) FILTER (WHERE a.interest_area_id IS NOT NULL), '[]') AS interest_area_ids_json`;
const SOURCE_FROM =
  " FROM library_sources s LEFT JOIN source_interest_areas a ON a.owner_id = s.owner_id AND a.source_id = s.source_id";
const SOURCE_SELECT = `SELECT ${SOURCE_COLUMNS}${SOURCE_FROM}`;
const SEARCH_SOURCE_COLUMNS =
  `s.owner_id, s.source_id, s.submitted_url, s.canonical_url, s.title, s.description, s.adapter_json, s.identity_evidence_json, s.state, s.approved_at, s.updated_at, s.revision, ${SOURCE_CLASSIFICATION_COLUMN}, COALESCE((SELECT json_group_array(a.interest_area_id) FROM source_interest_areas a WHERE a.owner_id = s.owner_id AND a.source_id = s.source_id), '[]') AS interest_area_ids_json`;

/** @param {unknown} row @param {string} ownerId @returns {SourceInterestArea} */
function interestAreaFromRow(row, ownerId) {
  if (
    !isRecord(row) || typeof row.interest_area_id !== "string" ||
    typeof row.label !== "string" || typeof row.provenance_json !== "string"
  ) {
    throw new TypeError("Stored D1 interest area is invalid.");
  }
  return freeze({
    id: row.interest_area_id,
    ownerId,
    title: row.label,
    provenance: row.provenance_json,
  });
}

/** @param {string} value */
function ftsQuery(value) {
  const terms = value.normalize("NFKC").match(/[\p{L}\p{N}]+/gu) ?? [];
  return terms.length === 0
    ? null
    : terms.map((term) => `"${term.replaceAll('"', '""')}"`).join(" AND ");
}

/** @param {unknown} row @returns {KnowledgeSearchHit["knowledge"]} */
function knowledgeSearchFromRow(row) {
  if (!isRecord(row) || typeof row.knowledge_id !== "string" || typeof row.source_id !== "string" || typeof row.source_title !== "string" || typeof row.source_url !== "string" || typeof row.point_json !== "string" || (row.question_locked !== 0 && row.question_locked !== 1)) throw new TypeError("Stored D1 knowledge search row is invalid.");
  const point = JSON.parse(row.point_json);
  if (!isRecord(point) || typeof point.summary !== "string" || !isRecord(point.attribution) || typeof point.attribution.sourceUrl !== "string" || !Array.isArray(point.evidenceAnchors)) throw new TypeError("Stored D1 knowledge point is invalid.");
  const evidenceAnchorIds = point.evidenceAnchors.flatMap((anchor) => {
    if (!isRecord(anchor)) return [];
    if (typeof anchor.id === "string" && anchor.id.trim() !== "") return [anchor.id];
    return typeof anchor.url === "string" && typeof anchor.selector === "string" && anchor.url.trim() !== "" && anchor.selector.trim() !== "" ? [`${anchor.url}#${anchor.selector}`] : [];
  });
  if (evidenceAnchorIds.length === 0) throw new TypeError("Stored D1 knowledge evidence is invalid.");
  return freeze({ knowledgeId: row.knowledge_id, sourceId: row.source_id, sourceTitle: row.source_title, summary: point.summary, sourceUrl: point.attribution.sourceUrl, evidenceAnchorIds: freeze(evidenceAnchorIds), questionLocked: row.question_locked === 1 });
}

/** @param {SourceRow & { readonly interest_area_ids_json: string, readonly primary_subject?: string | null, readonly source_topic?: string | null }} row @returns {LibrarySource} */
function sourceFromRow(row) {
  const adapter = JSON.parse(row.adapter_json);
  const identityEvidence = JSON.parse(row.identity_evidence_json);
  const interestAreaIds = JSON.parse(row.interest_area_ids_json);
  if (row.source_topic != null && (typeof row.source_topic !== "string" || !row.source_topic.trim())) throw new TypeError("Stored source topic is invalid.");
  if (row.primary_subject != null && !isSubjectId(row.primary_subject)) throw new TypeError("Stored source classification is invalid.");
  if (
    typeof adapter !== "object" || adapter === null ||
    !Array.isArray(identityEvidence) || !Array.isArray(interestAreaIds) ||
    (row.state !== "active" && row.state !== "disabled") ||
    !Number.isInteger(row.revision) || row.revision < 1
  ) {
    throw new TypeError("Stored D1 source is invalid.");
  }
  return freeze({
    id: row.source_id,
    ownerId: row.owner_id,
    origin: adapter.id === "private-document"
      ? /** @type {const} */ ("private-document")
      : /** @type {const} */ ("web"),
    submittedUrl: row.submitted_url,
    canonicalUrl: row.canonical_url,
    title: row.title,
    description: row.description,
    primarySubject: row.primary_subject ?? null,
    sourceTopic: row.source_topic ?? null,
    adapter:
      /** @type {import("../src/features/source-library/contracts.js").SourceAdapterContract} */ (adapter),
    interestAreaIds: freeze(/** @type {string[]} */ (interestAreaIds)),
    identityEvidence: freeze(
      /** @type {import("../src/features/source-library/contracts.js").SourceIdentityEvidence[]} */ (identityEvidence),
    ),
    state: row.state,
    approvedAt: row.approved_at,
    updatedAt: row.updated_at,
    revision: row.revision,
  });
}

/** @param {number} expectedRevision @param {number} actualRevision @returns {Result<never, Extract<SourceLibraryFailure, { readonly kind: "SourceRevisionStale" }>>} */
function stale(expectedRevision, actualRevision) {
  return {
    ok: /** @type {const} */ (false),
    error: {
      kind: /** @type {const} */ ("SourceRevisionStale"),
      expectedRevision,
      actualRevision,
    },
  };
}

/** @param {LibrarySource} source @returns {Result<never, Extract<SourceLibraryFailure, { readonly kind: "SourceStateConflict" }>>} */
function stateConflict(source) {
  return {
    ok: /** @type {const} */ (false),
    error: {
      kind: /** @type {const} */ ("SourceStateConflict"),
      sourceId: source.id,
      state: source.state,
      revision: source.revision,
    },
  };
}

export {};
