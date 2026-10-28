// @ts-check

import { isRecord } from "./contracts.js";

/** @import { AgentMemoryNamespace, AgentMemoryRecord, AgentMemoryRepository, SharedHandoff } from "../src/features/knowledge-workflows/memory.js" */
/** @import { AgentEvent, AgentEventLedger } from "../src/features/knowledge-workflows/harness.js" */
/** @import { CompactionRecord } from "../src/features/knowledge-workflows/context.js" */

/** @typedef {{ readonly success: boolean, readonly meta?: { readonly changes?: number } }} D1Result */
/** @typedef {{ readonly bind: (...values: readonly (string | number | null)[]) => D1Statement, readonly first: () => Promise<unknown | null>, readonly all: () => Promise<{ readonly success: boolean, readonly results: readonly unknown[] }>, readonly run: () => Promise<D1Result> }} D1Statement */
/** @typedef {{ readonly prepare: (query: string) => D1Statement, readonly batch: (statements: readonly D1Statement[]) => Promise<readonly D1Result[]> }} D1DatabasePort */
/** @typedef {{ readonly event: string, readonly ownerId?: string, readonly runId?: string, readonly role?: string, readonly failureKind?: string }} AgentD1Log */

/** @param {unknown} value @returns {value is string} */
function text(value) { return typeof value === "string" && value.trim() !== ""; }

/** @param {unknown} value @returns {value is number} */
function positiveInteger(value) { return typeof value === "number" && Number.isSafeInteger(value) && value > 0; }

/** @param {unknown} value @returns {unknown} */
function json(value) {
  if (!text(value)) throw new TypeError("Stored agent JSON is invalid.");
  try { return JSON.parse(value); } catch (error) { throw new TypeError("Stored agent JSON is malformed.", { cause: error }); }
}

/** @param {unknown} value @returns {AgentMemoryNamespace | null} */
function namespaceFromRow(value) {
  if (!isRecord(value) || !text(value.namespace_id) || !text(value.owner_id) || !text(value.run_id) || !text(value.role) ||
    (value.mode !== "durable" && value.mode !== "disabled") || (value.human_approval_id !== null && !text(value.human_approval_id)) || !text(value.created_at)) return null;
  return Object.freeze({ id: value.namespace_id, ownerId: value.owner_id, runId: value.run_id, role: /** @type {AgentMemoryNamespace["role"]} */ (value.role), mode: value.mode === "durable" ? "enabled" : "disabled-by-task", humanApprovalId: value.human_approval_id, createdAt: value.created_at });
}

/** @param {unknown} value @returns {AgentMemoryRecord | null} */
function recordFromRow(value) {
  if (!isRecord(value) || !text(value.record_id) || !text(value.namespace_id) || !text(value.kind) || !text(value.occurred_at)) return null;
  const stored = json(value.payload_json);
  if (!isRecord(stored) || !text(stored.visibility) || !text(stored.retention) || !positiveInteger(stored.integrityVersion) || !text(stored.sourceEventId) || !("payload" in stored)) return null;
  return Object.freeze({ id: value.record_id, namespaceId: value.namespace_id, kind: /** @type {AgentMemoryRecord["kind"]} */ (value.kind), visibility: /** @type {AgentMemoryRecord["visibility"]} */ (stored.visibility), retention: /** @type {AgentMemoryRecord["retention"]} */ (stored.retention), integrityVersion: stored.integrityVersion, sourceEventId: stored.sourceEventId, occurredAt: value.occurred_at, payload: stored.payload });
}

/** @param {D1Result} result */
function inserted(result) { return result.success === true && result.meta?.changes === 1; }

export class D1AgentMemoryRepository {
  /** @type {D1DatabasePort} */ #database;
  /** @type {(entry: AgentD1Log) => void} */ #logger;

  /** @param {{ readonly database: D1DatabasePort, readonly logger: (entry: AgentD1Log) => void }} dependencies */
  constructor(dependencies) {
    if (typeof dependencies?.database?.prepare !== "function" || typeof dependencies.database.batch !== "function" || typeof dependencies.logger !== "function") throw new TypeError("D1 agent-memory dependencies are invalid.");
    this.#database = dependencies.database;
    this.#logger = dependencies.logger;
  }

  /** @param {string} id @param {string} ownerId @returns {Promise<AgentMemoryNamespace | null>} */
  async findNamespace(id, ownerId) {
    if (!text(id) || !text(ownerId)) throw new TypeError("Agent namespace ID is invalid.");
    try {
      const row = await this.#database.prepare("SELECT owner_id, run_id, namespace_id, role, mode, human_approval_id, created_at FROM agent_memory_namespaces WHERE owner_id = ? AND namespace_id = ? LIMIT 1").bind(ownerId, id).first();
      return row === null ? null : namespaceFromRow(row) ?? (() => { throw new TypeError("Stored agent namespace is invalid."); })();
    } catch (error) {
      this.#logger({ event: "agent-memory-d1-failure", failureKind: "AgentMemoryPersistenceFailed" });
      throw error;
    }
  }

  /** @param {AgentMemoryNamespace} namespace @returns {Promise<null>} */
  async createNamespace(namespace) {
    try {
      const result = await this.#database.prepare("INSERT INTO agent_memory_namespaces (owner_id, run_id, namespace_id, role, mode, human_approval_id, fingerprint, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(namespace.ownerId, namespace.runId, namespace.id, namespace.role, namespace.mode === "enabled" ? "durable" : "disabled", namespace.humanApprovalId, [namespace.ownerId, namespace.runId, namespace.role, namespace.mode, namespace.humanApprovalId ?? ""].join("\u001f"), namespace.createdAt).run();
      if (!inserted(result)) throw new Error("Agent namespace insert was not committed.");
      this.#logger({ event: "agent-memory-d1-success", ownerId: namespace.ownerId, runId: namespace.runId, role: namespace.role });
      return null;
    } catch (error) {
      this.#logger({ event: "agent-memory-d1-failure", ownerId: namespace.ownerId, runId: namespace.runId, role: namespace.role, failureKind: "AgentMemoryPersistenceFailed" });
      throw error;
    }
  }

  /** @param {AgentMemoryRecord} record @param {string} ownerId @returns {Promise<null>} */
  async appendRecord(record, ownerId) {
    if (!text(ownerId)) throw new TypeError("Agent owner ID is invalid.");
    try {
      const result = await this.#database.prepare("INSERT INTO agent_memory_records (owner_id, namespace_id, record_id, kind, payload_json, occurred_at) VALUES ((SELECT owner_id FROM agent_memory_namespaces WHERE owner_id = ? AND namespace_id = ?), ?, ?, ?, ?, ?)").bind(ownerId, record.namespaceId, record.namespaceId, record.id, record.kind, JSON.stringify({ visibility: record.visibility, retention: record.retention, integrityVersion: record.integrityVersion, sourceEventId: record.sourceEventId, payload: record.payload }), record.occurredAt).run();
      if (!inserted(result)) throw new Error("Agent memory record insert was not committed.");
      return null;
    } catch (error) {
      this.#logger({ event: "agent-memory-d1-failure", failureKind: "AgentMemoryPersistenceFailed" });
      throw error;
    }
  }

  /** @param {string} namespaceId @param {string} ownerId @returns {Promise<readonly AgentMemoryRecord[]>} */
  async listRecords(namespaceId, ownerId) {
    if (!text(namespaceId) || !text(ownerId)) throw new TypeError("Agent namespace ID is invalid.");
    try {
      const result = await this.#database.prepare("SELECT namespace_id, record_id, kind, payload_json, occurred_at FROM agent_memory_records WHERE owner_id = ? AND namespace_id = ? ORDER BY occurred_at, record_id").bind(ownerId, namespaceId).all();
      if (result.success !== true) throw new Error("Agent memory records could not be read.");
      const records = [];
      for (const row of result.results) {
        const parsed = recordFromRow(row);
        if (parsed === null) throw new TypeError("Stored agent memory record is invalid.");
        records.push(parsed);
      }
      return Object.freeze(records);
    } catch (error) {
      this.#logger({ event: "agent-memory-d1-failure", failureKind: "AgentMemoryPersistenceFailed" });
      throw error;
    }
  }

  /** Same ordered identities and validation as full history; no ledger rows are dropped.
   * Remove only metadata written by modern working-memory records and never read
   * by prompt preparation. json_remove retains raw notes/Unicode, unknown fields,
   * legacy outputs and compaction coverage, without scanning JSON virtual tables.
   * @param {string} namespaceId @param {string} ownerId @returns {Promise<readonly AgentMemoryRecord[]>} */
  async listContextRecords(namespaceId, ownerId) {
    if (!text(namespaceId) || !text(ownerId)) throw new TypeError("Agent namespace ID is invalid.");
    try {
      const result = await this.#database.prepare(`SELECT namespace_id, record_id, kind, occurred_at,
        CASE WHEN kind = 'working-memory' AND json_type(payload_json, '$.payload') = 'object'
          AND json_type(payload_json, '$.payload.output') IS NULL
          AND json_extract(payload_json, '$.payload.type') IS NOT 'compacted-context'
          AND json_type(payload_json, '$.payload.role') = 'text'
          AND json_type(payload_json, '$.payload.configDigest') = 'text'
          AND json_type(payload_json, '$.payload.inputDigest') = 'text'
          AND json_type(payload_json, '$.payload.notes') IS NOT NULL
        THEN json_remove(payload_json, '$.payload.role', '$.payload.configDigest', '$.payload.inputDigest', '$.payload.usage')
        ELSE payload_json END AS payload_json
        FROM agent_memory_records WHERE owner_id = ? AND namespace_id = ? ORDER BY occurred_at, record_id`).bind(ownerId, namespaceId).all();
      if (result.success !== true) throw new Error("Agent memory records could not be read.");
      const records = [];
      for (const row of result.results) {
        const parsed = recordFromRow(row);
        if (parsed === null) throw new TypeError("Stored agent memory record is invalid.");
        records.push(parsed);
      }
      return Object.freeze(records);
    } catch (error) {
      this.#logger({ event: "agent-memory-d1-failure", failureKind: "AgentMemoryPersistenceFailed" });
      throw error;
    }
  }

  /** @param {SharedHandoff} handoff @returns {Promise<null>} */
  async appendHandoff(handoff) {
    try {
      const result = await this.#database.prepare("INSERT INTO agent_shared_handoffs (owner_id, run_id, handoff_id, from_namespace_id, to_namespace_id, payload_json, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(handoff.producer.ownerId, handoff.producer.runId, handoff.id, handoff.producer.id, handoff.consumer.id, JSON.stringify({ sourceEventId: handoff.sourceEventId, payload: handoff.payload }), handoff.occurredAt).run();
      if (!inserted(result)) throw new Error("Agent handoff insert was not committed.");
      return null;
    } catch (error) {
      this.#logger({ event: "agent-memory-d1-failure", ownerId: handoff.producer.ownerId, runId: handoff.producer.runId, failureKind: "AgentMemoryPersistenceFailed" });
      throw error;
    }
  }
}

export class D1AgentEventLedger {
  /** @type {D1DatabasePort} */ #database;
  /** @type {(entry: AgentD1Log) => void} */ #logger;

  /** @param {{ readonly database: D1DatabasePort, readonly logger: (entry: AgentD1Log) => void }} dependencies */
  constructor(dependencies) {
    if (typeof dependencies?.database?.prepare !== "function" || typeof dependencies.database.batch !== "function" || typeof dependencies.logger !== "function") throw new TypeError("D1 agent-event dependencies are invalid.");
    this.#database = dependencies.database;
    this.#logger = dependencies.logger;
  }

  /** @param {AgentEvent} event @returns {Promise<null>} */
  async append(event) {
    if (!text(event?.id) || !text(event.runId) || !text(event.role) || !text(event.taskId) || !text(event.kind) || !text(event.occurredAt)) throw new TypeError("Agent event is invalid.");
    try {
      const result = await this.#database.prepare("INSERT INTO agent_event_ledger (owner_id, run_id, event_id, role, task_id, event_kind, event_json, occurred_at) VALUES ((SELECT owner_id FROM knowledge_workflow_runs WHERE run_id = ?), ?, ?, ?, ?, ?, ?, ?)").bind(event.runId, event.runId, event.id, event.role, event.taskId, event.kind, JSON.stringify(event), event.occurredAt).run();
      if (!inserted(result)) throw new Error("Agent event insert was not committed.");
      return null;
    } catch (error) {
      this.#logger({ event: "agent-event-d1-failure", runId: event.runId, role: event.role, failureKind: "AgentLedgerPersistenceFailed" });
      throw error;
    }
  }
}

/** @typedef {{ readonly appendRecord: (record: CompactionRecord) => Promise<null> }} CompactionRecordRepository */

export class D1CompactionRecordRepository {
  /** @type {D1DatabasePort} */ #database;
  /** @type {(entry: AgentD1Log) => void} */ #logger;

  /** @param {{ readonly database: D1DatabasePort, readonly logger: (entry: AgentD1Log) => void }} dependencies */
  constructor(dependencies) {
    if (typeof dependencies?.database?.prepare !== "function" || typeof dependencies.database.batch !== "function" || typeof dependencies.logger !== "function") throw new TypeError("D1 compaction dependencies are invalid.");
    this.#database = dependencies.database;
    this.#logger = dependencies.logger;
  }

  /** @param {CompactionRecord} record @returns {Promise<null>} */
  async appendRecord(record) {
    try {
      const result = await this.#database.prepare("INSERT INTO agent_compaction_records (owner_id, run_id, record_id, record_json, occurred_at) VALUES (?, ?, ?, ?, ?)").bind(record.ownerId, record.runId, record.id, JSON.stringify(record), record.createdAt).run();
      if (!inserted(result)) throw new Error("Compaction record insert was not committed.");
      return null;
    } catch (error) {
      this.#logger({ event: "agent-compaction-d1-failure", ownerId: record.ownerId, runId: record.runId, role: record.role, failureKind: "CompactionRecordPersistenceFailed" });
      throw error;
    }
  }
}

export {};
