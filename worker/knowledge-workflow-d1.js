// @ts-check
import {observeWorkflowDatabase} from './knowledge-workflow-database.js';
import {workflowPersistenceDiagnostic} from "./knowledge-workflow-logging.js";

import { isRecord } from "./contracts.js";
import { isKnowledgeWorkflowRun } from "../src/features/knowledge-workflows/workflow.js";

/** @import { GlobalSourceReuse, KnowledgeWorkflowRun, Result, WorkflowFailure, WorkflowRepository } from "../src/features/knowledge-workflows/workflow.js" */

/** @typedef {{ readonly success: boolean, readonly meta?: { readonly changes?: number } }} D1Result */
/** @typedef {{ readonly bind: (...values: readonly (string | number | null)[]) => D1Statement, readonly first: () => Promise<unknown | null>, readonly all: () => Promise<{ readonly success: boolean, readonly results: readonly unknown[] }>, readonly run: () => Promise<D1Result> }} D1Statement */
/** @typedef {{ readonly prepare: (query: string) => D1Statement, readonly batch: (statements: readonly D1Statement[]) => Promise<readonly D1Result[]> }} D1DatabasePort */
/** @typedef {{ readonly event: string, readonly ownerId?: string, readonly runId?: string, readonly failureKind?: string,readonly diagnosticToken?: string,readonly field?:string,readonly action?:string,readonly durationMs?:number,readonly count?:number,readonly itemCount?:number }} WorkflowD1Log */

const freeze = Object.freeze;

/** @param {unknown} value @returns {value is string} */
function nonEmpty(value) { return typeof value === "string" && value.trim() !== ""; }

/** @param {unknown} value @returns {value is number} */
function positiveInteger(value) { return typeof value === "number" && Number.isSafeInteger(value) && value > 0; }

/** @param {unknown} value @returns {KnowledgeWorkflowRun | null} */
function parseRun(value) {
  if (!nonEmpty(value)) return null;
  try {
    const parsed = JSON.parse(value);
    return isKnowledgeWorkflowRun(parsed) ? parsed : null;
  } catch (error) {
    return null;
  }
}

/** @param {unknown} value @returns {GlobalSourceReuse | null} */
function parseReuse(value) {
  if (!isRecord(value) || !nonEmpty(value.canonical_source_identity) || !positiveInteger(value.source_revision) ||
    !nonEmpty(value.content_signature) || !nonEmpty(value.config_digests_json) || !nonEmpty(value.counts_json) || value.status !== "completed") return null;
  try {
    const configDigests = JSON.parse(value.config_digests_json);
    const counts = JSON.parse(value.counts_json);
    if (!isRecord(configDigests) || !Object.values(configDigests).every(nonEmpty) || !isRecord(counts) ||
      ![counts.pages, counts.knowledgePoints, counts.acceptedQuizzes, counts.pendingQuizzes].every((candidate) => typeof candidate === "number" && Number.isSafeInteger(candidate) && candidate >= 0)) return null;
    const validConfigDigests = /** @type {Readonly<Record<string, string>>} */ (configDigests);
    const validCounts = /** @type {{ readonly pages: number, readonly knowledgePoints: number, readonly acceptedQuizzes: number, readonly pendingQuizzes: number }} */ (counts);
    return freeze({ canonicalSourceIdentity: value.canonical_source_identity, sourceRevision: value.source_revision, contentSignature: value.content_signature, configDigests: freeze({ ...validConfigDigests }), counts: freeze({ pages: validCounts.pages, knowledgePoints: validCounts.knowledgePoints, acceptedQuizzes: validCounts.acceptedQuizzes, pendingQuizzes: validCounts.pendingQuizzes }) });
  } catch (error) {
    return null;
  }
}

/** @param {D1Result} result @returns {boolean} */
function changedOne(result) { return result.success === true && result.meta?.changes === 1; }

export class D1KnowledgeWorkflowRepository {
  /** @type {D1DatabasePort} */
  #database;
  /** @type {(entry: WorkflowD1Log) => void} */
  #logger;

  /** @param {{ readonly database: D1DatabasePort, readonly logger: (entry: WorkflowD1Log) => void }} dependencies */
  constructor(dependencies) {
    if (typeof dependencies?.database?.prepare !== "function" || typeof dependencies.database.batch !== "function" || typeof dependencies.logger !== "function") throw new TypeError("D1 knowledge-workflow dependencies are invalid.");
    this.#database = observeWorkflowDatabase(dependencies.database,dependencies.logger);
    this.#logger = dependencies.logger;
  }

  /** @param {string} action @param {number} started @returns {{ok:false,error:{kind:'WorkflowPersistenceFailed'}}} */
  #failed(action,started) {
    this.#logger({event:'knowledge-workflow-d1-result-failure',action,durationMs:Math.max(0,Date.now()-started),failureKind:'WorkflowPersistenceFailed',diagnosticToken:'repository-result-invalid'});
    return {ok:false,error:{kind:'WorkflowPersistenceFailed'}};
  }

  /** @param {string} ownerId @param {string} idempotencyKey @returns {Promise<Result<KnowledgeWorkflowRun | null, WorkflowFailure>>} */
  async findByIdempotency(ownerId, idempotencyKey) {
    const started=Date.now();
    if (!nonEmpty(ownerId) || !nonEmpty(idempotencyKey)) return { ok: false, error: { kind: "WorkflowCommandInvalid", field: "idempotencyKey" } };
    try {
      const row = await this.#database.prepare("SELECT run_json FROM knowledge_workflow_runs WHERE owner_id = ? AND idempotency_key = ? LIMIT 1").bind(ownerId, idempotencyKey).first();
      if (row === null) return { ok: true, value: null };
      if (!isRecord(row)) return this.#failed('findByIdempotency',started);
      const run = parseRun(row.run_json);
      return run === null || run.ownerId !== ownerId ? this.#failed('findByIdempotency',started) : { ok: true, value: freeze({ ...run, configDigests: freeze({ ...run.configDigests }), counts: freeze({ ...run.counts }) }) };
    } catch (error) {
      this.#logger({ event: "knowledge-workflow-d1-failure", action:"findByIdempotency",durationMs:Math.max(0,Date.now()-started), ownerId, failureKind: "WorkflowPersistenceFailed",diagnosticToken:workflowPersistenceDiagnostic(error) });
      return { ok: false, error: { kind: "WorkflowPersistenceFailed", diagnosticToken: workflowPersistenceDiagnostic(error) } };
    }
  }

  /** @param {string} ownerId @param {string} runId @returns {Promise<Result<KnowledgeWorkflowRun | null, WorkflowFailure>>} */
  async findById(ownerId, runId) {
    const started=Date.now();
    if (!nonEmpty(ownerId) || !nonEmpty(runId)) return { ok: false, error: { kind: "WorkflowCommandInvalid", field: "runId" } };
    try {
      const row = await this.#database.prepare("SELECT run_json FROM knowledge_workflow_runs WHERE owner_id = ? AND run_id = ? LIMIT 1").bind(ownerId, runId).first();
      if (row === null) return { ok: true, value: null };
      if (!isRecord(row)) return this.#failed('findById',started);
      const run = parseRun(row.run_json);
      return run === null || run.ownerId !== ownerId ? this.#failed('findById',started) : { ok: true, value: freeze({ ...run, configDigests: freeze({ ...run.configDigests }), counts: freeze({ ...run.counts }) }) };
    } catch (error) {
      this.#logger({ event: "knowledge-workflow-d1-failure", action:"findById",durationMs:Math.max(0,Date.now()-started), ownerId, runId, failureKind: "WorkflowPersistenceFailed",diagnosticToken:workflowPersistenceDiagnostic(error) });
      return { ok: false, error: { kind: "WorkflowPersistenceFailed", diagnosticToken: workflowPersistenceDiagnostic(error) } };
    }
  }

  /** @param {string} ownerId @param {string} sourceId @param {number} sourceRevision @returns {Promise<Result<KnowledgeWorkflowRun | null, WorkflowFailure>>} */
  async findLatestBySource(ownerId, sourceId, sourceRevision) {
    const started=Date.now();
    if (!nonEmpty(ownerId) || !nonEmpty(sourceId) || !positiveInteger(sourceRevision)) return { ok: false, error: { kind: "WorkflowCommandInvalid", field: "sourceId" } };
    try {
      const row = await this.#database.prepare("SELECT run_json FROM knowledge_workflow_runs WHERE owner_id = ? AND source_id = ? AND source_revision = ? ORDER BY updated_at DESC, run_id DESC LIMIT 1").bind(ownerId, sourceId, sourceRevision).first();
      if (row === null) return { ok: true, value: null };
      if (!isRecord(row)) return this.#failed('findLatestBySource',started);
      const run = parseRun(row.run_json);
      return run === null || run.ownerId !== ownerId || run.sourceId !== sourceId || run.sourceRevision !== sourceRevision
        ? this.#failed('findLatestBySource',started)
        : { ok: true, value: freeze({ ...run, configDigests: freeze({ ...run.configDigests }), counts: freeze({ ...run.counts }) }) };
    } catch (error) {
      this.#logger({ event: "knowledge-workflow-d1-failure", action:"findLatestBySource",durationMs:Math.max(0,Date.now()-started), ownerId, failureKind: "WorkflowPersistenceFailed",diagnosticToken:workflowPersistenceDiagnostic(error) });
      return { ok: false, error: { kind: "WorkflowPersistenceFailed", diagnosticToken: workflowPersistenceDiagnostic(error) } };
    }
  }

  /** @param {string} ownerId @param {string} sourceId @param {number | undefined} sourceRevision @returns {Promise<Result<readonly KnowledgeWorkflowRun[], WorkflowFailure>>} */
  async listBySource(ownerId, sourceId, sourceRevision) {
    const started=Date.now();
    if (!nonEmpty(ownerId) || !nonEmpty(sourceId) || (sourceRevision !== undefined && !positiveInteger(sourceRevision))) return { ok: false, error: { kind: "WorkflowCommandInvalid", field: "sourceId" } };
    try {
      const statement = sourceRevision === undefined
        ? this.#database.prepare("SELECT run_json FROM knowledge_workflow_runs WHERE owner_id = ? AND source_id = ? ORDER BY updated_at DESC, run_id DESC").bind(ownerId, sourceId)
        : this.#database.prepare("SELECT run_json FROM knowledge_workflow_runs WHERE owner_id = ? AND source_id = ? AND source_revision = ? ORDER BY updated_at DESC, run_id DESC").bind(ownerId, sourceId, sourceRevision);
      const rows = await statement.all();
      if (!rows.success) return this.#failed('listBySource',started);
      const runs = [];
      for (const row of rows.results) {
        if (!isRecord(row)) return this.#failed('listBySource',started);
        const run = parseRun(row.run_json);
        if (run === null || run.ownerId !== ownerId || run.sourceId !== sourceId || (sourceRevision !== undefined && run.sourceRevision !== sourceRevision)) return this.#failed('listBySource',started);
        runs.push(run);
      }
      return { ok: true, value: Object.freeze(runs) };
    } catch (error) {
      this.#logger({ event: "knowledge-workflow-d1-failure", action:"listBySource",durationMs:Math.max(0,Date.now()-started), ownerId, runId: sourceId, failureKind: "WorkflowPersistenceFailed",diagnosticToken:workflowPersistenceDiagnostic(error) });
      return { ok: false, error: { kind: "WorkflowPersistenceFailed", diagnosticToken: workflowPersistenceDiagnostic(error) } };
    }
  }

  /** @param {{ readonly canonicalSourceIdentity: string, readonly sourceRevision: number, readonly contentSignature: string }} query @returns {Promise<Result<GlobalSourceReuse | null, WorkflowFailure>>} */
  async findGlobalReuse(query) {
    const started=Date.now();
    if (!nonEmpty(query?.canonicalSourceIdentity) || !positiveInteger(query.sourceRevision) || !nonEmpty(query.contentSignature)) return { ok: false, error: { kind: "WorkflowCommandInvalid", field: "sourceIdentity" } };
    try {
      const row = await this.#database.prepare("SELECT canonical_source_identity, source_revision, content_signature, config_digests_json, counts_json, status FROM knowledge_source_manifests WHERE canonical_source_identity = ? AND source_revision = ? AND content_signature = ? LIMIT 1").bind(query.canonicalSourceIdentity, query.sourceRevision, query.contentSignature).first();
      if (row === null) return { ok: true, value: null };
      const reuse = parseReuse(row);
      return reuse === null ? this.#failed('findGlobalReuse',started) : { ok: true, value: reuse };
    } catch (error) {
      this.#logger({ event: "knowledge-workflow-d1-failure", action:"findGlobalReuse",durationMs:Math.max(0,Date.now()-started), failureKind: "WorkflowPersistenceFailed",diagnosticToken:workflowPersistenceDiagnostic(error) });
      return { ok: false, error: { kind: "WorkflowPersistenceFailed", diagnosticToken: workflowPersistenceDiagnostic(error) } };
    }
  }

  /** @param {KnowledgeWorkflowRun} run @returns {Promise<Result<null, WorkflowFailure>>} */
  async insert(run) {
    const started=Date.now();
    if (!isKnowledgeWorkflowRun(run)) return { ok: false, error: { kind: "WorkflowCommandInvalid", field: "run" } };
    try {
      const result = await this.#database.prepare("INSERT INTO knowledge_workflow_runs (owner_id, run_id, source_id, source_revision, canonical_source_identity, content_signature, state, revision, idempotency_key, config_digests_json, extraction_started_at, extraction_deadline_at, decision_required, counts_json, failure_kind, reused, created_at, updated_at, run_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(owner_id,idempotency_key) DO NOTHING").bind(run.ownerId, run.runId, run.sourceId, run.sourceRevision, run.canonicalSourceIdentity, run.contentSignature, run.state, run.revision, run.idempotencyKey, JSON.stringify(run.configDigests), run.extractionStartedAt, run.extractionDeadlineAt, run.decisionRequired, JSON.stringify(run.counts), run.failureKind, run.reused ? 1 : 0, run.createdAt, run.updatedAt, JSON.stringify(run)).run();
      if (!result.success) return this.#failed('insert',started);
      if (!changedOne(result)) return {ok:false,error:{kind:"WorkflowIdempotencyConflict"}};
      this.#logger({ event: "knowledge-workflow-d1-insert-success", ownerId: run.ownerId, runId: run.runId });
      return { ok: true, value: null };
    } catch (error) {
      this.#logger({ event: "knowledge-workflow-d1-failure", action:"insert",durationMs:Math.max(0,Date.now()-started), ownerId: run.ownerId, runId: run.runId, failureKind: "WorkflowPersistenceFailed",diagnosticToken:workflowPersistenceDiagnostic(error) });
      return { ok: false, error: { kind: "WorkflowPersistenceFailed", diagnosticToken: workflowPersistenceDiagnostic(error) } };
    }
  }

  /** @param {{ readonly ownerId: string, readonly runId: string, readonly expectedRevision: number, readonly next: KnowledgeWorkflowRun }} command @returns {Promise<Result<KnowledgeWorkflowRun, WorkflowFailure>>} */
  async update(command) {
    const started=Date.now();
    if (!nonEmpty(command?.ownerId) || !nonEmpty(command.runId) || !positiveInteger(command.expectedRevision) || !isKnowledgeWorkflowRun(command.next)) return { ok: false, error: { kind: "WorkflowCommandInvalid", field: "run" } };
    try {
      const result = await this.#database.prepare("UPDATE knowledge_workflow_runs SET state = ?, revision = ?, config_digests_json = ?, extraction_started_at = ?, extraction_deadline_at = ?, decision_required = ?, counts_json = ?, failure_kind = ?, reused = ?, updated_at = ?, run_json = ? WHERE owner_id = ? AND run_id = ? AND revision = ?").bind(command.next.state, command.next.revision, JSON.stringify(command.next.configDigests), command.next.extractionStartedAt, command.next.extractionDeadlineAt, command.next.decisionRequired, JSON.stringify(command.next.counts), command.next.failureKind, command.next.reused ? 1 : 0, command.next.updatedAt, JSON.stringify(command.next), command.ownerId, command.runId, command.expectedRevision).run();
      if (!changedOne(result)) {
        const current = await this.findById(command.ownerId, command.runId);
        return current.ok && current.value !== null && current.value.revision !== command.expectedRevision ? { ok: false, error: { kind: "WorkflowControlStale" } } : this.#failed('update',started);
      }
      if(command.next.state==='completed')this.#logger({event:'workflow-completion',ownerId:command.ownerId,runId:command.runId,durationMs:Math.max(0,Date.parse(command.next.updatedAt)-Date.parse(command.next.createdAt)),count:command.next.counts.acceptedQuizzes,itemCount:command.next.counts.pendingQuizzes,...(command.next.failureKind?{failureKind:command.next.failureKind}:{})});
      return { ok: true, value: command.next };
    } catch (error) {
      this.#logger({ event: "knowledge-workflow-d1-failure", action:"update",durationMs:Math.max(0,Date.now()-started), ownerId: command.ownerId, runId: command.runId, failureKind: "WorkflowPersistenceFailed",diagnosticToken:workflowPersistenceDiagnostic(error) });
      return { ok: false, error: { kind: "WorkflowPersistenceFailed", diagnosticToken: workflowPersistenceDiagnostic(error) } };
    }
  }

  /** @param {string} ownerId @param {string} idempotencyKey @returns {Promise<Result<{ readonly fingerprint: string, readonly run: KnowledgeWorkflowRun } | null, WorkflowFailure>>} */
  async findControl(ownerId, idempotencyKey) {
    const started=Date.now();
    if (!nonEmpty(ownerId) || !nonEmpty(idempotencyKey)) return { ok: false, error: { kind: "WorkflowCommandInvalid", field: "idempotencyKey" } };
    try {
      const row = await this.#database.prepare("SELECT command_fingerprint, result_json FROM knowledge_workflow_controls WHERE owner_id = ? AND idempotency_key = ? LIMIT 1").bind(ownerId, idempotencyKey).first();
      if (row === null) return { ok: true, value: null };
      if (!isRecord(row) || !nonEmpty(row.command_fingerprint)) return this.#failed('findControl',started);
      const run = parseRun(row.result_json);
      return run === null || run.ownerId !== ownerId ? this.#failed('findControl',started) : { ok: true, value: freeze({ fingerprint: row.command_fingerprint, run }) };
    } catch (error) {
      this.#logger({ event: "knowledge-workflow-d1-failure", action:"findControl",durationMs:Math.max(0,Date.now()-started), ownerId, failureKind: "WorkflowPersistenceFailed",diagnosticToken:workflowPersistenceDiagnostic(error) });
      return { ok: false, error: { kind: "WorkflowPersistenceFailed", diagnosticToken: workflowPersistenceDiagnostic(error) } };
    }
  }

  /** @param {{ readonly ownerId: string, readonly runId: string, readonly idempotencyKey: string, readonly fingerprint: string, readonly run: KnowledgeWorkflowRun }} command @returns {Promise<Result<null, WorkflowFailure>>} */
  async recordControl(command) {
    const started=Date.now();
    if (!nonEmpty(command?.ownerId) || !nonEmpty(command.runId) || !nonEmpty(command.idempotencyKey) || !nonEmpty(command.fingerprint) || !isKnowledgeWorkflowRun(command.run)) return { ok: false, error: { kind: "WorkflowCommandInvalid", field: "control" } };
    try {
      const result = await this.#database.prepare("INSERT INTO knowledge_workflow_controls (owner_id, control_id, run_id, idempotency_key, command_fingerprint, result_json, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(command.ownerId, `control:${encodeURIComponent(command.idempotencyKey)}`, command.runId, command.idempotencyKey, command.fingerprint, JSON.stringify(command.run), command.run.updatedAt).run();
      return changedOne(result) ? { ok: true, value: null } : this.#failed('recordControl',started);
    } catch (error) {
      this.#logger({ event: "knowledge-workflow-d1-failure", action:"recordControl",durationMs:Math.max(0,Date.now()-started), ownerId: command.ownerId, runId: command.runId, failureKind: "WorkflowPersistenceFailed",diagnosticToken:workflowPersistenceDiagnostic(error) });
      return { ok: false, error: { kind: "WorkflowPersistenceFailed", diagnosticToken: workflowPersistenceDiagnostic(error) } };
    }
  }

  /** @param {GlobalSourceReuse & { readonly createdAt: string, readonly updatedAt: string }} reuse @returns {Promise<Result<null, WorkflowFailure>>} */
  async markReuse(reuse) {
    const started=Date.now();
    if (!nonEmpty(reuse?.canonicalSourceIdentity) || !positiveInteger(reuse.sourceRevision) || !nonEmpty(reuse.contentSignature) || !nonEmpty(reuse.createdAt) || !nonEmpty(reuse.updatedAt)) return { ok: false, error: { kind: "WorkflowCommandInvalid", field: "reuse" } };
    try {
      const result = await this.#database.prepare("INSERT INTO knowledge_source_manifests (canonical_source_identity, source_revision, content_signature, config_digests_json, counts_json, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'completed', ?, ?) ON CONFLICT(canonical_source_identity, source_revision, content_signature) DO UPDATE SET config_digests_json = excluded.config_digests_json, counts_json = excluded.counts_json, status = 'completed', updated_at = excluded.updated_at").bind(reuse.canonicalSourceIdentity, reuse.sourceRevision, reuse.contentSignature, JSON.stringify(reuse.configDigests), JSON.stringify(reuse.counts), reuse.createdAt, reuse.updatedAt).run();
      return changedOne(result) ? { ok: true, value: null } : this.#failed('markReuse',started);
    } catch (error) {
      this.#logger({ event: "knowledge-workflow-d1-failure", action:"markReuse",durationMs:Math.max(0,Date.now()-started), failureKind: "WorkflowPersistenceFailed",diagnosticToken:workflowPersistenceDiagnostic(error) });
      return { ok: false, error: { kind: "WorkflowPersistenceFailed", diagnosticToken: workflowPersistenceDiagnostic(error) } };
    }
  }

  /** @param {{ readonly canonicalSourceIdentity: string, readonly sourceRevision?: number }} command @returns {Promise<Result<null, WorkflowFailure>>} */
  async invalidateReuse(command) {
    const started=Date.now();
    if (!nonEmpty(command?.canonicalSourceIdentity) || (command.sourceRevision !== undefined && !positiveInteger(command.sourceRevision))) return { ok: false, error: { kind: "WorkflowCommandInvalid", field: "sourceIdentity" } };
    try {
      const statement = command.sourceRevision === undefined
        ? this.#database.prepare("DELETE FROM knowledge_source_manifests WHERE canonical_source_identity = ?").bind(command.canonicalSourceIdentity)
        : this.#database.prepare("DELETE FROM knowledge_source_manifests WHERE canonical_source_identity = ? AND source_revision = ?").bind(command.canonicalSourceIdentity, command.sourceRevision);
      const result = await statement.run();
      return result.success === true ? { ok: true, value: null } : this.#failed('invalidateReuse',started);
    } catch (error) {
      this.#logger({ event: "knowledge-workflow-d1-failure", action:"invalidateReuse",durationMs:Math.max(0,Date.now()-started), failureKind: "WorkflowPersistenceFailed",diagnosticToken:workflowPersistenceDiagnostic(error) });
      return { ok: false, error: { kind: "WorkflowPersistenceFailed", diagnosticToken: workflowPersistenceDiagnostic(error) } };
    }
  }

  /** @param {{ readonly run: KnowledgeWorkflowRun, readonly reason: string, readonly updatedAt: string }} command @returns {Promise<Result<null, WorkflowFailure>>} */
  async markAbandoned(command) {
    const started=Date.now();
    if (!isKnowledgeWorkflowRun(command?.run) || !nonEmpty(command.reason) || !nonEmpty(command.updatedAt)) return { ok: false, error: { kind: "WorkflowCommandInvalid", field: "run" } };
    const next = { ...command.run, state: "abandoned", revision: command.run.revision + 1, decisionRequired: null, failureKind: command.reason === "workflow-abandoned" ? "WorkflowAbandoned" : "WorkflowSourceRevoked", updatedAt: command.updatedAt };
    if (!isKnowledgeWorkflowRun(next)) return this.#failed('markAbandoned',started);
    try {
      const result = await this.#database.prepare("UPDATE knowledge_workflow_runs SET state = ?, revision = ?, decision_required = ?, failure_kind = ?, updated_at = ?, run_json = ? WHERE owner_id = ? AND run_id = ? AND revision = ?").bind(next.state, next.revision, next.decisionRequired, next.failureKind, next.updatedAt, JSON.stringify(next), next.ownerId, next.runId, command.run.revision).run();
      if (result.success !== true || result.meta?.changes === undefined) return this.#failed('markAbandoned',started);
      if (result.meta.changes === 1) return { ok: true, value: null };
      const current = await this.findById(command.run.ownerId, command.run.runId);
      return current.ok && current.value?.state === "abandoned" ? { ok: true, value: null } : this.#failed('markAbandoned',started);
    } catch (error) {
      this.#logger({ event: "knowledge-workflow-d1-failure", action:"markAbandoned",durationMs:Math.max(0,Date.now()-started), ownerId: command.run.ownerId, runId: command.run.runId, failureKind: "WorkflowPersistenceFailed",diagnosticToken:workflowPersistenceDiagnostic(error) });
      return { ok: false, error: { kind: "WorkflowPersistenceFailed", diagnosticToken: workflowPersistenceDiagnostic(error) } };
    }
  }
}

export {};
