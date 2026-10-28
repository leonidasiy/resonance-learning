// @ts-check

import { createKnowledgeWorkflowCleanup } from "../worker/knowledge-workflow-cleanup.js";

/** @typedef {{ readonly withoutBucket?: boolean, readonly mediaRows?: readonly Record<string, unknown>[] }} FixtureOptions */

/** @template T @param {T} actual @param {T} expected */
function assertEquals(actual, expected) { if (!Object.is(actual, expected)) throw new Error(`Expected ${String(expected)}, received ${String(actual)}.`); }

const run = Object.freeze({
  ownerId: "owner-a", runId: "run-a", sourceId: "source-a", sourceRevision: 1,
  canonicalSourceIdentity: "https://example.test/learn", contentSignature: "content-a",
  state: "extraction-loop", revision: 3, idempotencyKey: "workflow-a",
  configDigests: Object.freeze({ "knowledge-scraper": "sha256:config" }),
  extractionStartedAt: "2026-08-13T00:00:00.000Z", extractionDeadlineAt: "2026-08-13T00:30:00.000Z",
  decisionRequired: null, counts: Object.freeze({ pages: 1, knowledgePoints: 1, acceptedQuizzes: 0, pendingQuizzes: 0 }),
  failureKind: null, reused: false, createdAt: "2026-08-13T00:00:00.000Z", updatedAt: "2026-08-13T00:01:00.000Z",
});

/** @param {FixtureOptions} [options] */
function fixture(options = {}) {
  /** @type {string[]} */ const queries = [];
  /** @type {string[]} */ const deleted = [];
  const statement = {
    /** @param {...(string | number | null)} values */
    bind(...values) { void values; return statement; },
    async first() { return null; },
    async all() { return { success: true, results: options.mediaRows ?? [{ object_key: "private-original" }, { object_key: "private-derivative" }, { object_key: "source-content/material-a" }] }; },
    async run() { return { success: true, meta: { changes: 1 } }; },
  };
  const database = {
    prepare(/** @type {string} */ query) { queries.push(query); return (query.includes('SELECT page_url,attempt_key,output_json FROM knowledge_workflow_image_attempts')||query.startsWith('SELECT stage_key,input_digest,result_json FROM knowledge_workflow_stages'))?{...statement,bind(){return this;},async all(){return {success:true,results:[]};}}:statement; },
    batch: async (/** @type {readonly unknown[]} */ statements) => statements.map(() => ({ success: true, meta: { changes: 1 } })),
  };
  /** @type {import("../src/features/knowledge-workflows/workflow.js").KnowledgeWorkflowRun[]} */
  const runs = [run];
  /** @type {Record<string, unknown>[]} */ const invalidations = [];
  /** @type {Record<string, unknown>[]} */ const marked = [];
  const cleanup = createKnowledgeWorkflowCleanup({
    database,
    bucket: options.withoutBucket ? null : { delete: async (key) => { deleted.push(key); } },
    workflowRepository: {
      listBySource: async () => ({ ok: true, value: runs }),
      invalidateReuse: async (command) => { invalidations.push(/** @type {Record<string, unknown>} */ (command)); return { ok: true, value: null }; },
      markAbandoned: async (command) => { marked.push(/** @type {Record<string, unknown>} */ (command)); return { ok: true, value: null }; },
    },
    now: () => "2026-08-13T00:05:00.000Z",
    logger: () => {},
  });
  return { cleanup, queries, deleted, invalidations, marked };
}

Deno.test("cleanup removes R2 objects and every content-bearing run descendant before abandon", async () => {
  const fixtureValue = fixture();
  const result = await fixtureValue.cleanup.abandonRun({ run, reason: "workflow-abandoned" });
  assertEquals(result.ok, true);
  assertEquals(fixtureValue.deleted.join(","), "private-original,private-derivative,source-content/material-a");
  assertEquals(fixtureValue.queries.length >= 12, true);
  assertEquals(fixtureValue.queries.some((query) => query.includes("DELETE FROM learning_generation_tasks")), true);
  assertEquals(fixtureValue.queries.some((query) => query.includes("DELETE FROM learning_generation_units")), true);
  assertEquals(fixtureValue.queries.some((query) => query.includes("DELETE FROM learning_generation_jobs")), true);
  assertEquals(fixtureValue.queries.some((query) => query.includes("DELETE FROM knowledge_workflow_materials")), true);
  assertEquals(fixtureValue.marked.length, 0);
  assertEquals(fixtureValue.invalidations.length, 0);
});

Deno.test("source revocation purges all matching runs and marks active runs abandoned", async () => {
  const fixtureValue = fixture();
  const result = await fixtureValue.cleanup.revokeSource({ ownerId: "owner-a", sourceId: "source-a", reason: "source-disabled" });
  assertEquals(result.ok, true);
  assertEquals(fixtureValue.marked.length, 1);
  assertEquals(fixtureValue.marked[0].reason, "source-disabled");
  assertEquals(fixtureValue.invalidations.length, 2);
});

Deno.test("cleanup fails closed when media rows exist but the bucket is unavailable", async () => {
  const fixtureValue = fixture({ withoutBucket: true });
  const result = await fixtureValue.cleanup.abandonRun({ run, reason: "workflow-abandoned" });
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error.kind, "WorkflowCleanupFailed");
});
