// @ts-check

import { D1SourceLibraryRepository } from "../worker/source-library-d1.js";

/** @template T @param {T} actual @param {T} expected */
function assertEquals(actual, expected) {
  if (!Object.is(actual, expected)) {
    throw new Error(
      `Expected ${String(expected)}, received ${String(actual)}.`,
    );
  }
}

class StatementFixture {
  /** @type {DatabaseFixture} */ database;
  /** @type {string} */ query;
  /** @type {readonly (string | number | null)[]} */ bindings = [];

  /** @param {DatabaseFixture} database @param {string} query */
  constructor(database, query) {
    this.database = database;
    this.query = query;
  }

  /** @param {...(string | number | null)} bindings */
  bind(...bindings) {
    this.bindings = bindings;
    return this;
  }

  /** @returns {Promise<unknown | null>} */
  async first() {
    return this.database.first(this.query, this.bindings);
  }

  async run() {
    return { success: true, meta: { changes: 1 } };
  }

  async all() {
    return {
      success: true,
      results: this.database.all(this.query, this.bindings),
    };
  }
}

class DatabaseFixture {
  /** @type {Map<string, unknown>} */ rows = new Map();
  /** @type {Map<string, readonly unknown[]>} */ allRows = new Map();
  /** @type {StatementFixture[][]} */ batches = [];
  /** @type {{ readonly query: string, readonly bindings: readonly (string | number | null)[] }[]} */ allCalls =
    [];
  failBatch = false;

  /** @param {string} query */
  prepare(query) {
    return new StatementFixture(this, query);
  }

  /** @param {readonly import("../worker/source-library-d1.js").D1Statement[]} statements */
  async batch(statements) {
    if (this.failBatch) throw new Error("Injected D1 failure.");
    const fixtures = statements.map((
      statement,
    ) => /** @type {StatementFixture} */ (statement));
    this.batches.push(fixtures);
    return statements.map(() => ({ success: true, meta: { changes: 1 } }));
  }

  /** @param {string} query @param {readonly (string | number | null)[]} bindings */
  first(query, bindings) {
    if (query.includes("private_derived_count")) {
      return this.rows.get(`semantic-private:${bindings.join("|")}`) ?? {
        private_derived_count: 0,
      };
    }
    if (query.includes("FROM source_suppressions")) {
      const field = query.includes("idempotency_key = ?")
        ? "idempotency"
        : "canonical";
      return this.rows.get(`suppression:${field}:${bindings.join("|")}`) ??
        null;
    }
    if (query.includes("idempotency_key")) {
      return this.rows.get(`idempotency:${bindings.join("|")}`) ?? null;
    }
    if (query.includes("FROM interest_areas")) {
      return this.rows.get(`area:${bindings.join("|")}`) ?? null;
    }
    if (query.includes("canonical_url = ?")) {
      return this.rows.get(`canonical:${bindings.join("|")}`) ?? null;
    }
    if (query.includes("s.source_id = ?")) {
      return this.rows.get(`source:${bindings.join("|")}`) ?? null;
    }
    if (query.includes("WHERE source_id = ?")) {
      return this.rows.get(`owner:${bindings.join("|")}`) ?? null;
    }
    if (query.includes("catalog_revision")) {
      return this.rows.get(`revision:${bindings.join("|")}`) ?? {
        catalog_revision: "0:",
      };
    }
    throw new Error(`Unexpected query: ${query}`);
  }

  /** @param {string} query @param {readonly (string | number | null)[]} bindings */
  all(query, bindings) {
    this.allCalls.push({ query, bindings });
    const kind = bindings.at(-1) === 501
      ? "semantic"
      : query.includes("FROM interest_areas")
      ? "areas"
      : query.includes("FROM source_suppressions")
      ? "suppressions"
      : query.includes("MATCH ?")
      ? "keyword"
      : query.includes("source_id IN")
      ? "ids"
      : "browse";
    return this.allRows.get(`${kind}:${bindings.join("|")}`) ?? [];
  }
}

const source = Object.freeze({
  id: "source:1",
  ownerId: "owner-a",
  submittedUrl: "https://publisher.example/learn?from=search",
  canonicalUrl: "https://publisher.example/learn",
  title: "Learning source",
  description: "Source description.",
  adapter: Object.freeze({
    id: "adapter-registry-id",
    version: "1",
    granularity: "evidence-resolved",
    capabilities: Object.freeze(["metadata"]),
  }),
  interestAreaIds: Object.freeze(["area-a"]),
  identityEvidence: Object.freeze([{
    attribute: "canonical-link",
    value: "https://publisher.example/learn",
    provenanceUrl: "https://publisher.example/learn",
    observedAt: "2026-07-22T08:00:00.000Z",
  }]),
  state: /** @type {const} */ ("active"),
  approvedAt: "2026-07-22T08:00:00.000Z",
  updatedAt: "2026-07-22T08:00:00.000Z",
  revision: 1,
});
const event = Object.freeze({
  id: "event:1",
  ownerId: "owner-a",
  sourceId: source.id,
  kind: /** @type {const} */ ("approved"),
  sourceRevision: 1,
  idempotencyKey: "approve-1",
  occurredAt: source.approvedAt,
});
const job = Object.freeze({
  id: "job:1",
  ownerId: "owner-a",
  sourceId: source.id,
  sourceRevision: 1,
  policyVersion: "bounded-v1",
  state: /** @type {const} */ ("pending"),
  createdAt: source.approvedAt,
});

Deno.test("D1 approval batches source, evidence, areas, event, and job", async () => {
  const database = new DatabaseFixture();
  database.rows.set("area:owner-a|area-a", { interest_area_id: "area-a" });
  const result = await new D1SourceLibraryRepository(database).approve({
    source,
    event,
    job,
    fingerprint: "fingerprint-1",
  });
  assertEquals(result.ok, true);
  assertEquals(database.batches.length, 1);
  assertEquals(database.batches[0].length, 4);
  assertEquals(
    database.batches[0].some((statement) =>
      statement.query.includes("source_ingestion_jobs")
    ),
    true,
  );
});

Deno.test("D1 private-document approval omits the unrelated crawler job", async () => {
  const database = new DatabaseFixture();
  const result = await new D1SourceLibraryRepository(database).approve({ source: { ...source, interestAreaIds: [], origin: "private-document" }, event, job: null, fingerprint: "private-fingerprint" });
  assertEquals(result.ok, true);
  if (!result.ok) throw new Error(result.error.kind);
  assertEquals(result.value.job, null);
  assertEquals(database.batches[0].length, 2);
  assertEquals(database.batches[0].some((statement) => statement.query.includes("source_ingestion_jobs")), false);
});

Deno.test("D1 service retries a legacy private document without rewriting provenance", async () => {
 const database = new DatabaseFixture();
 const command = { ownerId: "owner-a", title: "Legacy", fileName: "legacy.txt", idempotencyKey: "legacy-private", applicationOrigin: "https://app.example/" };
 const basis = "learner-attested lawful copy", reference = "legacy-grant";
 const url = "https://app.example/api/private-documents/source%3A1";
 const evidence = [{ attribute: "owner-attested-processing", value: "storage, transformation, and processing allowed", provenanceUrl: url, observedAt: source.approvedAt }, { attribute: "processing-basis", value: basis, provenanceUrl: url, observedAt: source.approvedAt }, { attribute: "processing-reference", value: reference, provenanceUrl: url, observedAt: source.approvedAt }, { attribute: "file-name", value: command.fileName, provenanceUrl: url, observedAt: source.approvedAt }];
 database.rows.set("idempotency:owner-a|legacy-private", { source_id: source.id, command_fingerprint: JSON.stringify({ ...command, basis, reference }) });
 database.rows.set(`source:owner-a|${source.id}`, { ...sourceRow(), title: command.title, description: command.fileName, submitted_url: url, canonical_url: url, adapter_json: JSON.stringify({ id: "private-document", version: "v1", granularity: "document", capabilities: ["owner-private-document", "processing-attested"] }), identity_evidence_json: JSON.stringify(evidence), interest_area_ids_json: "[]" });
 const { SourceLibraryService } = await import("../src/features/source-library/service.js");
 const service = new SourceLibraryService({ repository: new D1SourceLibraryRepository(database), createId: () => "new", now: () => source.approvedAt, ingestionPolicyVersion: "v1" });
 const result = await service.createPrivateDocument(command);
 if (!result.ok || !result.value.reused) throw new Error(result.ok ? "Expected reuse." : result.error.kind);
 assertEquals(JSON.stringify(result.value.source.identityEvidence), JSON.stringify(evidence));
 assertEquals(database.batches.length, 0);
 const different = await service.createPrivateDocument({ ...command, fileName: "different.txt" });
 if (different.ok || different.error.kind !== "SourceIdempotencyConflict") throw new Error("D1 accepted changed replay.");
 database.rows.set("idempotency:owner-a|legacy-private", { source_id: source.id, command_fingerprint: "{malformed" });
 const malformed = await service.createPrivateDocument(command);
 if (malformed.ok || malformed.error.kind !== "SourceIdempotencyConflict") throw new Error("D1 accepted malformed history.");
});

Deno.test("D1 individual-resource approval atomically includes its initial item version", async () => {
  const database = new DatabaseFixture();
  database.rows.set("area:owner-a|area-a", { interest_area_id: "area-a" });
  const result = await new D1SourceLibraryRepository(database).approve({
    source,
    event: { ...event, id: "event:item", idempotencyKey: "approve-item" },
    job: { ...job, id: "job:item" },
    initialItem: {
      ownerId: "owner-a", sourceId: "source:1", sourceRevision: 1,
      itemId: "video-a", versionId: "metadata-v1",
      canonicalUrl: "https://publisher.example/watch/a", title: "Video A",
      description: "Provider metadata.", contentDigest: "sha256:metadata-a",
      provenance: [{ method: "provider-metadata", reference: "provider-item-a" }],
      observedAt: "2026-07-22T08:00:00.000Z", publishedAt: null,
    },
    fingerprint: "fingerprint-item",
  });
  assertEquals(result.ok, true);
  assertEquals(database.batches[0].length, 5);
  assertEquals(database.batches[0][4].query.includes("source_item_versions"), true);
});

Deno.test("D1 approval maps database failure without partial success", async () => {
  const database = new DatabaseFixture();
  database.rows.set("area:owner-a|area-a", { interest_area_id: "area-a" });
  database.failBatch = true;
  const result = await new D1SourceLibraryRepository(database).approve({
    source,
    event,
    job,
    fingerprint: "fingerprint-1",
  });
  assertEquals(result.ok, false);
  if (result.ok) throw new Error("Expected D1 failure.");
  assertEquals(result.error.kind, "SourceApprovalPersistenceFailed");
});

Deno.test("D1 disabled-source approval conflicts expose the current revision", async () => {
  const database = new DatabaseFixture();
  database.rows.set("area:owner-a|area-a", { interest_area_id: "area-a" });
  database.rows.set("canonical:owner-a|https://publisher.example/learn", {
    owner_id: "owner-a",
    source_id: "source:disabled",
    submitted_url: "https://publisher.example/learn",
    canonical_url: "https://publisher.example/learn",
    title: "Disabled source",
    description: "Source description.",
    adapter_json: JSON.stringify(source.adapter),
    identity_evidence_json: JSON.stringify(source.identityEvidence),
    state: "disabled",
    approved_at: source.approvedAt,
    updated_at: source.updatedAt,
    revision: 2,
    interest_area_ids_json: JSON.stringify(source.interestAreaIds),
  });
  const result = await new D1SourceLibraryRepository(database).approve({
    source: { ...source, canonicalUrl: "https://publisher.example/learn" },
    event: { ...event, id: "event:disabled", idempotencyKey: "approve-disabled" },
    job: { ...job, id: "job:disabled" },
    fingerprint: "fingerprint-disabled",
  });
  assertEquals(result.ok, false);
  if (result.ok) throw new Error("Expected disabled-source conflict.");
  assertEquals(result.error.kind, "SourceStateConflict");
  if (result.error.kind === "SourceStateConflict") {
    assertEquals(result.error.sourceId, "source:disabled");
    assertEquals(result.error.state, "disabled");
    assertEquals(/** @type {Record<string, unknown>} */ (result.error).revision, 2);
  }
});

Deno.test("D1 approval and revision require owner-scoped configured interest areas", async () => {
  const database = new DatabaseFixture();
  const repository = new D1SourceLibraryRepository(database);
  const approval = await repository.approve({
    source,
    event,
    job,
    fingerprint: "fingerprint-1",
  });
  assertEquals(approval.ok, false);
  if (approval.ok) throw new Error("Expected missing interest-area failure.");
  assertEquals(approval.error.kind, "SourceInterestAreaMissing");
  assertEquals(database.batches.length, 0);

  database.rows.set(
    "canonical:owner-a|https://publisher.example/learn",
    sourceRow(),
  );
  const canonicalReuse = await repository.approve({
    source,
    event: { ...event, id: "event:reuse", idempotencyKey: "approve-reuse" },
    job,
    fingerprint: "reuse-fingerprint",
  });
  assertEquals(canonicalReuse.ok, false);
  if (canonicalReuse.ok) {
    throw new Error("Expected canonical reuse area validation failure.");
  }
  assertEquals(canonicalReuse.error.kind, "SourceInterestAreaMissing");
  assertEquals(database.batches.length, 0);

  database.rows.set("source:owner-a|source:1", sourceRow());
  const revision = await repository.revise({
    ownerId: "owner-a",
    sourceId: source.id,
    expectedRevision: 1,
    title: "Revised",
    description: "Revised description.",
    interestAreaIds: ["wrong-owner-area"],
    event: { ...event, id: "event:2", kind: "revised", sourceRevision: 2 },
    fingerprint: "revise-fingerprint",
  });
  assertEquals(revision.ok, false);
  if (revision.ok) throw new Error("Expected missing interest-area failure.");
  assertEquals(revision.error.kind, "SourceInterestAreaMissing");
  assertEquals(database.batches.length, 0);
});

Deno.test("D1 transition distinguishes wrong owner and stale revision", async () => {
  const database = new DatabaseFixture();
  database.rows.set("owner:source:1", { owner_id: "owner-a" });
  const repository = new D1SourceLibraryRepository(database);
  const wrongOwner = await repository.transition({
    ownerId: "owner-b",
    sourceId: "source:1",
    expectedRevision: 1,
    targetState: "disabled",
    event: { ...event, ownerId: "owner-b", kind: "disabled" },
    fingerprint: "disable-owner-b",
  });
  assertEquals(wrongOwner.ok, false);
  if (wrongOwner.ok) throw new Error("Expected owner mismatch.");
  assertEquals(wrongOwner.error.kind, "SourceOwnerMismatch");

  database.rows.set("source:owner-a|source:1", sourceRow({ revision: 2 }));
  const stale = await repository.transition({
    ownerId: "owner-a",
    sourceId: "source:1",
    expectedRevision: 1,
    targetState: "disabled",
    event: { ...event, kind: "disabled", sourceRevision: 2 },
    fingerprint: "disable-stale",
  });
  assertEquals(stale.ok, false);
  if (stale.ok) throw new Error("Expected stale revision.");
  assertEquals(stale.error.kind, "SourceRevisionStale");
});

Deno.test("D1 suppression is atomic, evidence-backed, and idempotent", async () => {
  const database = new DatabaseFixture();
  const repository = new D1SourceLibraryRepository(database);
  const suppression = {
    id: "suppression:1",
    ownerId: "owner-a",
    canonicalIdentity: "https://publisher.example/learn",
    identityEvidence: source.identityEvidence,
    idempotencyKey: "reject-1",
    createdAt: "2026-07-22T09:00:00.000Z",
  };
  const first = await repository.suppress({
    suppression,
    fingerprint: "reject-fingerprint",
  });
  assertEquals(first.ok, true);
  assertEquals(database.batches.length, 1);
  assertEquals(
    database.batches[0][0].query.includes("INSERT INTO source_suppressions"),
    true,
  );

  database.rows.set("suppression:idempotency:owner-a|reject-1", {
    suppression_id: suppression.id,
    canonical_identity: suppression.canonicalIdentity,
    evidence_json: JSON.stringify({
      identityEvidence: suppression.identityEvidence,
      commandFingerprint: "reject-fingerprint",
    }),
    idempotency_key: suppression.idempotencyKey,
    created_at: suppression.createdAt,
  });
  const replay = await repository.suppress({
    suppression,
    fingerprint: "reject-fingerprint",
  });
  assertEquals(replay.ok, true);
  if (!replay.ok) throw new Error(replay.error.kind);
  assertEquals(replay.value.reused, true);

  const conflict = await repository.suppress({
    suppression,
    fingerprint: "changed-fingerprint",
  });
  assertEquals(conflict.ok, false);
  if (conflict.ok) throw new Error("Expected suppression conflict.");
  assertEquals(conflict.error.kind, "SourceIdempotencyConflict");
});

Deno.test("D1 catalog reads active keyset pages and owner-scoped areas", async () => {
  const database = new DatabaseFixture();
  database.rows.set("revision:owner-a", { catalog_revision: "2:latest" });
  database.allRows.set("browse:owner-a|3", [
    {...sourceRow(),primary_subject:"music",source_topic:"Meter"},
    sourceRow({ sourceId: "source:2", approvedAt: "2026-07-22T07:00:00.000Z" }),
  ]);
  database.allRows.set("areas:owner-a", [{
    interest_area_id: "area-a",
    label: "Configured area",
    provenance_json: JSON.stringify({ source: "owner configuration" }),
  }]);
  const page = await new D1SourceLibraryRepository(database).browseActive({
    ownerId: "owner-a",
    limit: 3,
    after: null,
  });
  assertEquals(page.ok, true);
  if (!page.ok) throw new Error(page.error.kind);
  assertEquals(page.value.items.length, 2);
  assertEquals(page.value.items[0].primarySubject, "music");
  assertEquals(page.value.items[0].sourceTopic, "Meter");
  assertEquals(database.allCalls[0].query.includes("sc.source_revision = s.revision AND sc.status = 'classified') AS source_topic"), true);
  assertEquals(page.value.interestAreas[0].title, "Configured area");
  assertEquals(page.value.catalogRevision, "2:latest");
  assertEquals(
    database.allCalls[0].query.includes("s.state = 'active'"),
    true,
  );
  assertEquals(
    database.allCalls[0].query.includes(
      "ORDER BY s.approved_at DESC, s.source_id DESC",
    ),
    true,
  );
});

Deno.test("D1 keyword search parameterizes escaped terms and keeps owner scope", async () => {
  const database = new DatabaseFixture();
  database.allRows.set('keyword:owner-a|"harmony" AND "OR" AND "rhythm"|5', [{
    ...sourceRow(),
    search_rank: -0.75,
  }]);
  const result = await new D1SourceLibraryRepository(database).keywordSearch({
    ownerId: "owner-a",
    query: 'harmony" OR rhythm',
    limit: 5,
  });
  assertEquals(result.ok, true);
  if (!result.ok) throw new Error(result.error.kind);
  assertEquals(result.value.length, 1);
  const call = database.allCalls[0];
  assertEquals(call.query.includes("library_sources_fts MATCH ?"), true);
  assertEquals(call.query.includes('harmony" OR rhythm'), false);
  assertEquals(call.bindings[0], "owner-a");
  assertEquals(call.bindings[1], '"harmony" AND "OR" AND "rhythm"');
});

Deno.test("D1 semantic knowledge candidates fail closed for unconsented active uploaded runs before ranking", async () => {
  const database = new DatabaseFixture();
  database.allRows.set("browse:owner-a|5", [{ ...sourceRow(), knowledge_id: "knowledge:1", source_revision: 1, source_topic: null, point_json: JSON.stringify({ summary: "A source concept.", attribution: { sourceUrl: "https://publisher.example/learn" }, evidenceAnchors: [{ id: "anchor:1" }] }), source_title: "Learning source", source_url: "https://publisher.example/learn", question_locked: 1 }]);
  database.rows.set("semantic-private:owner-a", { private_derived_count: 0 });
  const result = await new D1SourceLibraryRepository(database).knowledgeSemanticCandidates({
    ownerId: "owner-a",
    limit: 5,
  });
  assertEquals(result.ok, true);
  if (!result.ok) throw new Error(result.error.kind);
  assertEquals(result.value.privateDerivedCount, 0);
  assertEquals(result.value.candidates[0].knowledge.knowledgeId, "knowledge:1");
  assertEquals(result.value.candidates[0].sourceRevision, 1);
  assertEquals(database.allCalls[0].bindings[0], "owner-a");
  assertEquals(database.allCalls[0].bindings[1], 5);
  assertEquals(database.allCalls[0].query.includes("NOT EXISTS (SELECT 1 FROM knowledge_workflow_materials"), true);
  assertEquals(database.allCalls[0].query.includes("json_type(m.material_json, '$.provenance.processingAllowed') IS NOT 'true'"), true);
});

Deno.test("D1 suppression checks are bounded by owner and candidate identities", async () => {
  const database = new DatabaseFixture();
  database.allRows.set("suppressions:owner-a|identity-a|identity-b", [{
    canonical_identity: "identity-b",
  }]);
  const result = await new D1SourceLibraryRepository(database).suppressed({
    ownerId: "owner-a",
    canonicalIdentities: ["identity-a", "identity-b"],
  });
  assertEquals(result.ok, true);
  if (!result.ok) throw new Error(result.error.kind);
  assertEquals(result.value.join(","), "identity-b");
  assertEquals(database.allCalls[0].bindings[0], "owner-a");
  assertEquals(
    database.allCalls[0].query.includes("canonical_identity IN (?, ?)"),
    true,
  );
});

Deno.test("source-library migration is strict, owner-scoped, indexed, and searchable", async () => {
  const migration = await Deno.readTextFile(
    new URL("../worker/migrations/0001_source_library.sql", import.meta.url),
  );
  for (
    const required of [
      "PRIMARY KEY (owner_id, source_id)",
      "UNIQUE (owner_id, canonical_url)",
      "UNIQUE (owner_id, idempotency_key)",
      "CREATE VIRTUAL TABLE library_sources_fts USING fts5",
      "CREATE TRIGGER library_sources_fts_insert",
      "source_item_versions",
      "source_rights_assessments",
      "source_crawl_assessments",
      "source_content_references",
      "source_suppressions",
    ]
  ) {
    assertEquals(migration.includes(required), true);
  }
  assertEquals((migration.match(/\) STRICT;/g) ?? []).length >= 10, true);
});

Deno.test("pending D1 migrations avoid nested trigger statements rejected by remote query parsing", async () => {
  for (const name of [
    "0002_source_acquisition.sql",
    "0003_browser_run_acquisition.sql",
    "0004_r2_capacity.sql",
  ]) {
    const migration = await Deno.readTextFile(
      new URL(`../worker/migrations/${name}`, import.meta.url),
    );
    assertEquals(migration.includes("SELECT CASE WHEN"), false);
    assertEquals(migration.includes("SELECT RAISE(ABORT"), true);
  }
});

/** @param {Partial<{ readonly revision: number, readonly state: "active" | "disabled", readonly sourceId: string, readonly approvedAt: string }>} [overrides] */
function sourceRow(overrides = {}) {
  return {
    owner_id: source.ownerId,
    source_id: overrides.sourceId ?? source.id,
    submitted_url: source.submittedUrl,
    canonical_url: source.canonicalUrl,
    title: source.title,
    description: source.description,
    adapter_json: JSON.stringify(source.adapter),
    identity_evidence_json: JSON.stringify(source.identityEvidence),
    interest_area_ids_json: JSON.stringify(source.interestAreaIds),
    state: overrides.state ?? source.state,
    approved_at: overrides.approvedAt ?? source.approvedAt,
    updated_at: source.updatedAt,
    revision: overrides.revision ?? source.revision,
  };
}
