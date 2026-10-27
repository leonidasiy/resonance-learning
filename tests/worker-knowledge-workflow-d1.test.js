// @ts-check

import {
  D1AgentEventLedger,
  D1AgentMemoryRepository,
  D1CompactionRecordRepository,
} from "../worker/knowledge-workflow-agents-d1.js";

/** @template T @param {T} actual @param {T} expected */
function assertEquals(actual, expected) {
  if (!Object.is(actual, expected)) throw new Error(`Expected ${String(expected)}, received ${String(actual)}.`);
}

/** @typedef {{ readonly bind: (...values: readonly (string | number | null)[]) => TestStatement, readonly first: () => Promise<unknown | null>, readonly all: () => Promise<{ readonly success: boolean, readonly results: readonly unknown[] }>, readonly run: () => Promise<{ readonly success: boolean, readonly meta?: { readonly changes?: number } }> }} TestStatement */
/** @typedef {{ readonly prepare: (query: string) => TestStatement, readonly batch: (statements: readonly TestStatement[]) => Promise<readonly { readonly success: boolean, readonly meta?: { readonly changes?: number } }[]> }} TestDatabase */

function database() {
  /** @type {unknown[]} */
  const queries = [];
  /** @type {{ readonly owner_id: string, readonly run_id: string, readonly namespace_id: string, readonly role: string, readonly mode: string, readonly human_approval_id: string | null, readonly created_at: string } | null} */
  const namespace = { owner_id: "owner-a", run_id: "run-a", namespace_id: "namespace-a", role: "knowledge-scraper", mode: "durable", human_approval_id: null, created_at: "2026-08-13T00:00:00.000Z" };
  /** @type {TestDatabase & { readonly queries: unknown[] }} */
  const fixture = {
    queries,
    /** @param {string} query */
    prepare(query) {
      /** @type {TestStatement} */
      const bound = {
        /** @param {readonly (string | number | null)[]} values */
        bind(...values) {
          queries.push({ query, values });
          return bound;
        },
        async first() {
          if (query.startsWith("SELECT owner_id, run_id, namespace_id")) return namespace;
          return null;
        },
        async all() {
          if (query.startsWith("SELECT namespace_id, record_id")) return { success: true, results: [{ namespace_id: "namespace-a", record_id: "record-a", kind: "working-memory", payload_json: JSON.stringify({ visibility: "private", retention: "run", integrityVersion: 1, sourceEventId: "event-a", payload: { value: "bounded" } }), occurred_at: "2026-08-13T00:00:00.000Z" }] };
          return { success: true, results: [] };
        },
        async run() { return { success: true, meta: { changes: 1 } }; },
      };
      return bound;
    },
    async batch() { return []; },
  };
  return fixture;
}

Deno.test("D1 agent repositories preserve namespace scope, event pairing, and compaction records", async () => {
  const fixture = database();
  const logger = () => {};
  const memory = new D1AgentMemoryRepository({ database: fixture, logger });
  const namespace = await memory.findNamespace("namespace-a", "owner-a");
  if (namespace === null) throw new Error("Expected namespace.");
  assertEquals(namespace.ownerId, "owner-a");
  assertEquals(namespace.mode, "enabled");
  await memory.createNamespace(namespace);
  await memory.appendRecord({ id: "record-a", namespaceId: "namespace-a", kind: "working-memory", visibility: "private", retention: "run", integrityVersion: 1, sourceEventId: "event-a", occurredAt: "2026-08-13T00:00:00.000Z", payload: { value: "bounded" } }, "owner-a");
  const records = await memory.listRecords("namespace-a", "owner-a");
  assertEquals(records.length, 1);
  assertEquals(records[0].sourceEventId, "event-a");
  await memory.appendHandoff({ id: "handoff-a", producer: namespace, consumer: { ...namespace, id: "namespace-b", role: "question-generator" }, sourceEventId: "event-a", occurredAt: "2026-08-13T00:00:00.000Z", payload: { knowledgeId: "knowledge-a" } });
  const events = new D1AgentEventLedger({ database: fixture, logger });
  await events.append({ id: "agent-event-a", runId: "run-a", role: "knowledge-scraper", taskId: "task-a", kind: "model-response", occurredAt: "2026-08-13T00:00:00.000Z", payload: { bounded: true } });
  const compactions = new D1CompactionRecordRepository({ database: fixture, logger });
  await compactions.appendRecord({ id: "compaction-a", ownerId: "owner-a", runId: "run-a", role: "knowledge-scraper", checkpointId: "checkpoint-a", sourceContextDigest: "sha256:before", compactedContextDigest: "sha256:after", thresholdTokens: 150_000, inputTokenCount: 150_001, retainedTurnIds: ["turn-a"], recoveryEventIds: ["event-a"], reversible: true, createdAt: "2026-08-13T00:00:00.000Z" });
  assertEquals(fixture.queries.length, 7);
});

Deno.test("D1 agent repositories reject invalid configuration before touching storage", () => {
  let touched = false;
  /** @type {TestDatabase} */
  const database = { prepare() { touched = true; throw new Error("not expected"); }, batch: async () => [] };
  try { new D1AgentMemoryRepository({ database, logger: () => {} }); } catch (error) { throw error; }
  assertEquals(touched, false);
});
