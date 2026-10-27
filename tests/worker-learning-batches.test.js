// @ts-check

import { createLearningBatchService } from "../worker/learning-batches-d1.js";
import { LearningBatchGatewayClient } from "../src/features/learning-generation/batches-gateway.js";

/** @template T @param {T} actual @param {T} expected */
function assertEquals(actual, expected) { if (!Object.is(actual, expected)) throw new Error(`Expected ${String(expected)}, received ${String(actual)}.`); }

/** @param {number} index */
const point = (index) => JSON.stringify({ id: `knowledge-${index}`, sourceId: "source-a", sourceRevision: 1, summary: `A precise music fact ${index}.`, normalizedHash: `hash-${index}`, evidenceAnchors: [{ id: `anchor-${index}`, url: "https://example.test/lesson", excerpt: "Evidence." }], attribution: { sourceUrl: "https://example.test/lesson" } });
/** @param {number} index */
const task = (index) => JSON.stringify({ id: `task-${index}`, kind: "single-choice", prompt: `Which statement is true ${index}?`, explanation: "The paired evidence explains it.", sourceAnchorIds: [`anchor-${index}`], choices: [{ id: "choice-1", label: "Correct" }, { id: "choice-2", label: "Distractor" }], correctChoiceIds: ["choice-1"], revision: 1 });

class Statement {
  /** @param {Database} database @param {string} query */
  /** @type {Database} */ database;
  /** @type {string} */ query;
  /** @type {(string | number | null)[]} */ bindings = [];
  /** @param {Database} database @param {string} query */
  constructor(database, query) { this.database = database; this.query = query; }
  /** @param {...(string | number | null)} values */
  bind(...values) { this.bindings = values; return this; }
  async all() { return this.database.all(this.query); }
  async first() { return this.database.first(this.query, this.bindings); }
  async run() {
    if (this.query.startsWith("UPDATE learner_batch_commands")) this.database.commandResults.set(String(this.bindings[2]), String(this.bindings[0]));
    return { success: true, meta: { changes: 1 } };
  }
}

class Database {
  /** @type {readonly Statement[]} */ written = [];
  /** @type {string[]} */ queries = [];
  /** @type {unknown[]} */ rows;
  /** @type {unknown | null} */ reviewRow = null;
  /** @type {number | null} */ answerCount = null;
  /** @type {unknown[]} */ answeredRows = [];
  answerReadFails = false;
  /** @type {Map<string, string>} */ commandResults = new Map();
  /** @param {unknown[]} rows */
  constructor(rows) { this.rows = rows; }
  /** @param {string} query */
  prepare(query) { this.queries.push(query); return new Statement(this, query); }
  /** @param {string} query */
  async all(query) { if (query.includes("FROM learner_review_answers")) return { success: !this.answerReadFails, results: this.answeredRows }; return { success: true, results: query.includes("FROM extraction_knowledge_points kp") ? this.rows : [] }; }
  /** @param {string} query */
  /** @param {string} query @param {readonly (string | number | null)[]} [bindings] */
  async first(query, bindings = []) {
    if (query.includes("FROM learner_feed_batches")) return null;
    if (query.includes("FROM learner_review_batches")) return this.reviewRow;
    if (query.includes("COUNT(*)") && this.answerCount !== null) return { count: this.answerCount };
    if (query.includes("FROM learner_batch_commands")) { const result = this.commandResults.get(String(bindings[1])); return result === undefined ? null : { result_json: result }; }
    return null;
  }
  /** @param {readonly Statement[]} statements */
  async batch(statements) {
    this.written = statements;
    for (const statement of statements) if (statement.query.startsWith("INSERT INTO learner_batch_commands")) this.commandResults.set(String(statement.bindings[1]), String(statement.bindings[2]));
    return statements.map(() => ({ success: true, meta: { changes: 1 } }));
  }
}

function rows(count = 5) {
  return Array.from({ length: count }, (_, index) => ({ point_json: point(index), knowledge_id: `knowledge-${index}`, source_id: "source-a", source_revision: 1, source_main_subject: null, source_topic: null, source_classification_revision: null, task_json: task(index), source_title: "Music theory", canonical_url: "https://example.test/lesson", view_count: 0, last_answer_correct: null, scheduled_days: 0, due_at: null, studied_at: null, preference: 0, media_candidates: "[]", asset_id: null, media_kind: null, media_attribution: null }));
}

Deno.test("native paired Review projection passes the gateway without pre-answer explanations or answer keys", async () => {
  const entries = await Promise.all(rows().map(async (entry, index) => {
    const value = JSON.parse(entry.point_json);
    const bytes = new TextEncoder().encode(JSON.stringify({ summary: value.summary, normalizedHash: value.normalizedHash, evidenceAnchors: value.evidenceAnchors }));
    const factHash = `sha256:${Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2, "0")).join("")}`;
    const binding = { kind: "webpage-support", purpose: "evidence", ownerId: "owner-a", runId: "run-a", sourceRevision: 1, factHash, originalDigest: "sha256:original", imageId: "diagram-a", evidence: "The bound diagram shows the relationship." };
    return {
    ...entry, run_id: "run-a", media_candidates: JSON.stringify([{ asset_id: "diagram-a", media_kind: "image", media_attribution: "Associated source diagram", media_binding: JSON.stringify(binding), media_original_digest: "sha256:original" }]), studied_at: "2026-08-19T00:00:00.000Z", due_at: "2026-08-19T00:00:00.000Z", asset_id: "diagram-a", media_kind: "image", media_attribution: "Associated source diagram",
    task_json: JSON.stringify({ id: `task-${index}`, kind: "paired", prompt: "Recall the supported relationship.", explanation: "Post-answer feedback only.", sourceAnchorIds: [`anchor-${index}`], choices: null, correctChoiceIds: null, revision: 1, pairedVariants: [
      { id: "choice-v1", kind: "single-choice", prompt: "Choose the supported relationship.", explanation: "Post-answer choice feedback.", choices: [{ id: "a", label: "Supported" }, { id: "b", label: "Unsupported" }], correctChoiceIds: ["a"] },
      { id: "fill-v1", kind: "fill-blank", prompt: "Name the ____.", explanation: "Post-answer blank feedback.", blanks: [{ id: "blank-1", acceptedAnswers: ["tonic"] }] },
    ] }),
  }; }));
  const service = createLearningBatchService({ database: /** @type {import("../worker/learning-batches-d1.js").D1DatabasePort} */ (/** @type {unknown} */ (new Database(entries))), now: () => "2026-08-19T00:00:00.000Z", random: () => 0.1, logger: () => {} });
  const projected = await service.loadReview("owner-a", "2026-08-19");
  assertEquals(projected.ok, true);
  if (!projected.ok) return;
  const gateway = new LearningBatchGatewayClient({ baseUrl: "https://app.example.test/", timeoutMs: 1_000, fetch: async () => new Response(JSON.stringify({ ownerId: "owner-a", result: projected.value }), { headers: { "Content-Type": "application/json" } }) });
  const loaded = await gateway.loadReview("2026-08-19");
  assertEquals(loaded.ok, true);
  if (!loaded.ok) return;
  assertEquals(loaded.value.questions.length, 5);
  for (const question of loaded.value.questions) {
    assertEquals(question.media?.assetId, "diagram-a");
    assertEquals(question.media?.url, "/api/learning-media?assetId=diagram-a&variant=feed");
    assertEquals(question.pairedVariants, null);
    assertEquals(question.questionId.includes(":choice-v1") || question.questionId.includes(":fill-v1"), true);
    for (const variant of question.pairedVariants ?? []) for (const field of ["explanation", "correctChoiceIds", "acceptedAnswers"]) assertEquals(Object.hasOwn(variant, field), false);
  }
});

Deno.test("learner projection preserves illustration purpose only for a verified current binding", async () => {
  const parsedPoint = JSON.parse(point(0));
  const bytes = new TextEncoder().encode(JSON.stringify({ summary: parsedPoint.summary, normalizedHash: parsedPoint.normalizedHash, evidenceAnchors: parsedPoint.evidenceAnchors }));
  const factHash = `sha256:${Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2, "0")).join("")}`;
  const binding = { kind: "webpage-support", purpose: "illustration", ownerId: "owner-a", runId: "run-a", sourceRevision: 1, factHash, originalDigest: "sha256:original", imageId: "image-a", evidence: "Source illustration depicts the example scene." };
  const alternatives = [{ ...binding, purpose: undefined }, { ...binding, purpose: "evidence" }, binding, { ...binding, purpose: "unknown" }, { ...binding, kind: "uploaded-source", locator: "page:1", sourceDigest: "source-original" }, { ...binding, ownerId: "foreign" }, { ...binding, runId: "foreign" }, { ...binding, sourceRevision: 2 }, { ...binding, factHash: "changed" }, { ...binding, originalDigest: "changed" }];
  for (const [index, candidateBinding] of alternatives.entries()) {
    const entries = rows().map((entry, position) => position === 0 ? { ...entry, run_id: "run-a", media_candidates: JSON.stringify([{ asset_id: "media-a", media_kind: "image", media_attribution: "Source attribution", media_binding: JSON.stringify(candidateBinding), media_original_digest: "sha256:original" }]) } : entry);
    const database = new Database(entries);
    const service = createLearningBatchService({ database: /** @type {import("../worker/learning-batches-d1.js").D1DatabasePort} */ (/** @type {unknown} */ (database)), now: () => "2026-08-19T00:00:00.000Z", random: () => 0.1, logger: () => {} });
    const result = await service.loadFeed("owner-a", "2026-08-19");
    assertEquals(result.ok, true);
    if (!result.ok) continue;
    const item = /** @type {{ items: { knowledgeId: string, media: { purpose?: string } | null }[] }} */ (result.value).items.find(item => item.knowledgeId === "knowledge-0");
    assertEquals(item?.media !== null, index < 3);
    if (index < 3) assertEquals(item?.media?.purpose, candidateBinding.purpose);
  }
});

Deno.test("learner projection suppresses legacy decorative fallback selections", async () => {
  const entries = rows();
  entries[0].point_json = JSON.stringify({ ...JSON.parse(entries[0].point_json), mediaSelection: { assetId: "fallback", kind: "image", url: "/assets/fallback-media/old.png", attribution: "User-attested local fallback" } });
  const database = new Database(entries);
  const service = createLearningBatchService({ database: /** @type {import("../worker/learning-batches-d1.js").D1DatabasePort} */ (/** @type {unknown} */ (database)), now: () => "2026-08-19T00:00:00.000Z", random: () => 0.1, logger: () => {} });
  const result = await service.loadFeed("owner-a", "2026-08-19");
  assertEquals(result.ok, true);
  if (result.ok) assertEquals(/** @type {{ items: { media: unknown }[] }} */ (result.value).items.every((item) => item.media === null), true);
});

Deno.test("learner migration creates state, batch, answer, preference, and command tables", async () => {
  const sql = await Deno.readTextFile(new URL("../worker/migrations/0012_learner_batches.sql", import.meta.url));
  for (const table of ["learner_knowledge_state", "learner_feed_batches", "learner_review_batches", "learner_review_answers", "learner_preference_feedback", "learner_batch_commands"]) assertEquals(sql.includes(`CREATE TABLE ${table}`), true);
  assertEquals(sql.includes("json_valid(item_ids_json)"), true);
});

Deno.test("learner D1 service only selects paired knowledge and creates a five-card Feed batch", async () => {
  const database = new Database(rows());
  const service = createLearningBatchService({ database: /** @type {import("../worker/learning-batches-d1.js").D1DatabasePort} */ (/** @type {unknown} */ (database)), now: () => "2026-08-19T00:00:00.000Z", random: () => 0.1, logger: () => {} });
  const result = await service.loadFeed("owner-a", "2026-08-19");
  assertEquals(result.ok, true);
  if (!result.ok) return;
  const projection = /** @type {{ readonly items: readonly { readonly questionLocked: boolean }[] }} */ (result.value);
  assertEquals(projection.items.length, 5);
  assertEquals(projection.items.every((item) => item.questionLocked === true), true);
  assertEquals(database.queries.some((query) => query.includes("JOIN knowledge_workflow_quizzes") && query.includes("q.status = 'published'")), true);
  assertEquals(database.queries.some((query) => query.includes("LEFT JOIN learner_preference_feedback pf") && query.includes("COALESCE(ls.preference, pf.preference, 0)")), true);
});

Deno.test("manual Feed refresh replaces an unfinished batch on the same day", async () => {
  const previous = { batch_id: "unfinished", learning_day: "2026-08-19", status: "open", item_ids_json: JSON.stringify(Array.from({ length: 5 }, (_, i) => `knowledge-${i}`)), revision: 1, created_at: "2026-08-19T00:00:00.000Z", completed_at: null };
  class CurrentBatchDatabase extends Database {
    /** @override @param {string} query @param {readonly (string | number | null)[]} [bindings] */
    async first(query, bindings = []) {
      if (query.includes("FROM learner_feed_batches")) return previous;
      return await super.first(query, bindings);
    }
  }
  const database = new CurrentBatchDatabase(rows(8));
  const service = createLearningBatchService({ database: /** @type {import("../worker/learning-batches-d1.js").D1DatabasePort} */ (/** @type {unknown} */ (database)), now: () => "2026-08-19T12:00:00.000Z", random: () => 0.1, logger: () => {} });
  const result = await service.loadFeed("owner-a", "2026-08-19", true);
  assertEquals(result.ok, true);
  if (!result.ok) return;
  const projection = /** @type {{ batch: { batchId: string, status: string, itemIds: readonly string[] } }} */ (result.value);
  assertEquals(projection.batch.status, "open");
  assertEquals(projection.batch.batchId === previous.batch_id, false);
  assertEquals(projection.batch.itemIds.length, 5);
  assertEquals(database.queries.some(query => query.startsWith("INSERT INTO learner_feed_batches")), true);
});

Deno.test("learner D1 service accepts evidence anchors produced by the extractor without synthetic ids", async () => {
  const extractorRows = rows().map((row, index) => ({
    ...row,
    point_json: JSON.stringify({
      id: `knowledge-${index}`,
      sourceId: "source-a",
      sourceRevision: 1,
      summary: `A precise music fact ${index}.`,
      normalizedHash: `hash-${index}`,
      evidenceAnchors: [{ url: "https://example.test/lesson", selector: `#fact-${index}` }],
      attribution: { sourceUrl: "https://example.test/lesson" },
    }),
  }));
  const database = new Database(extractorRows);
  const service = createLearningBatchService({ database: /** @type {import("../worker/learning-batches-d1.js").D1DatabasePort} */ (/** @type {unknown} */ (database)), now: () => "2026-08-19T00:00:00.000Z", random: () => 0.1, logger: () => {} });
  const result = await service.loadFeed("owner-a", "2026-08-19");
  assertEquals(result.ok, true);
  if (!result.ok) return;
  const projection = /** @type {{ readonly items: readonly { readonly evidenceAnchorIds: readonly string[] }[] }} */ (result.value);
  assertEquals(projection.items.length, 5);
  assertEquals(projection.items.every((item) => item.evidenceAnchorIds[0].includes("#fact-")), true);
});

Deno.test("learner D1 service returns all eligible Feed cards when fewer than five pairs are available", async () => {
  const database = new Database(rows(3));
  const service = createLearningBatchService({ database: /** @type {import("../worker/learning-batches-d1.js").D1DatabasePort} */ (/** @type {unknown} */ (database)), now: () => "2026-08-19T00:00:00.000Z", random: () => 0.1, logger: () => {} });
  const result = await service.loadFeed("owner-a", "2026-08-19");
  assertEquals(result.ok, true);
  if (!result.ok) return;
  const projection = /** @type {{ readonly batch: unknown, readonly items: readonly unknown[] }} */ (result.value);
  assertEquals(projection.batch !== null, true);
  assertEquals(projection.items.length, 3);
});

Deno.test("learner D1 service returns an empty Review projection when no studied knowledge is due", async () => {
  const database = new Database(rows(3));
  const service = createLearningBatchService({ database: /** @type {import("../worker/learning-batches-d1.js").D1DatabasePort} */ (/** @type {unknown} */ (database)), now: () => "2026-08-19T00:00:00.000Z", random: () => 0.1, logger: () => {} });
  const result = await service.loadReview("owner-a", "2026-08-19");
  assertEquals(result.ok, true);
  if (!result.ok) return;
  const projection = /** @type {{ readonly batch: unknown, readonly questions: readonly unknown[], readonly dueCount: number }} */ (result.value);
  assertEquals(projection.batch, null);
  assertEquals(projection.questions.length, 0);
  assertEquals(projection.dueCount, 0);
});

Deno.test("learner D1 review projection withholds explanations and answer keys before an attempt", async () => {
  const due = rows().map((row) => ({ ...row, studied_at: "2026-08-19T00:00:00.000Z", due_at: "2026-08-19T00:00:00.000Z" }));
  const database = new Database(due);
  const service = createLearningBatchService({ database: /** @type {import("../worker/learning-batches-d1.js").D1DatabasePort} */ (/** @type {unknown} */ (database)), now: () => "2026-08-19T00:00:00.000Z", random: () => 0.1, logger: () => {} });
  const result = await service.loadReview("owner-a", "2026-08-19");
  assertEquals(result.ok, true);
  if (!result.ok) return;
  const question = /** @type {{ readonly questions: readonly Record<string, unknown>[] }} */ (result.value).questions[0];
  assertEquals(Object.hasOwn(question, "explanation"), false);
  assertEquals(Object.hasOwn(question, "correctChoiceIds"), false);
  assertEquals(Object.hasOwn(question, "acceptedAnswers"), false);
});

Deno.test("learner D1 answer returns the stored explanation and correct choice only after a valid attempt", async () => {
  const due = rows().map((row) => ({ ...row, studied_at: "2026-08-19T00:00:00.000Z", due_at: "2026-08-19T00:00:00.000Z" }));
  const database = new Database(due);
  database.reviewRow = { batch_id: "review:owner-a:2026-08-19", learning_day: "2026-08-19", status: "open", item_ids_json: JSON.stringify(["task-0"]), revision: 1, created_at: "2026-08-19T00:00:00.000Z", completed_at: null };
  database.answerCount = 1;
  const service = createLearningBatchService({ database: /** @type {import("../worker/learning-batches-d1.js").D1DatabasePort} */ (/** @type {unknown} */ (database)), now: () => "2026-08-19T00:00:00.000Z", random: () => 0.1, logger: () => {} });
  const result = await service.answerReview({ ownerId: "owner-a", batchId: "review:owner-a:2026-08-19", questionId: "task-0", selectedChoiceIds: ["choice-1"], answerText: null, blankAnswers: null, confidence: 80, idempotencyKey: "answer-1" });
  const persisted = database.written.find(s => s.query.startsWith("INSERT INTO learner_review_answers"));
  assertEquals(persisted?.query.includes("confidence"), false);
  assertEquals(JSON.stringify(persisted?.bindings.slice(7, 10)), JSON.stringify(["knowledge-0", 0, null]));
  assertEquals(result.ok, true);
  if (!result.ok) return;
  const answer = /** @type {{ readonly feedback: { readonly explanation: string, readonly correctAnswer: string } }} */ (result.value);
  assertEquals(answer.feedback.explanation, "The paired evidence explains it.");
  assertEquals(answer.feedback.correctAnswer, "Correct");
});

Deno.test("multi-blank review scores each part, keeps failed recall due, and hides keys before submission", async () => {
  const due = rows().map((row) => ({ ...row, studied_at: "2026-08-19T00:00:00.000Z", due_at: "2026-08-19T00:00:00.000Z" }));
  due[0].task_json = JSON.stringify({ id: "task-0", kind: "fill-blank", prompt: "A ____ resolves to the ____.", explanation: "The dominant resolves to the tonic.", sourceAnchorIds: ["anchor-0"], choices: null, correctChoiceIds: null, acceptedAnswers: null, blankId: null, blanks: [{ id: "blank-1", acceptedAnswers: ["dominant"] }, { id: "blank-2", acceptedAnswers: ["tonic"] }], revision: 1 });
  const database = new Database(due);
  database.reviewRow = { batch_id: "review:owner-a:2026-08-19", learning_day: "2026-08-19", status: "open", item_ids_json: JSON.stringify(["task-0"]), revision: 1, created_at: "2026-08-19T00:00:00.000Z", completed_at: null };
  database.answerCount = 1;
  const service = createLearningBatchService({ database: /** @type {import("../worker/learning-batches-d1.js").D1DatabasePort} */ (/** @type {unknown} */ (database)), now: () => "2026-08-19T00:00:00.000Z", semanticGrader: async () => ({ ok: true, value: [1, 0] }), logger: () => {} });
  const review = await service.loadReview("owner-a", "2026-08-19");
  assertEquals(review.ok, true);
  if (!review.ok) return;
  const projected = /** @type {{ readonly questions: readonly Record<string, unknown>[] }} */ (review.value).questions[0];
  assertEquals(JSON.stringify(projected).includes("acceptedAnswers"), false);
  assertEquals(JSON.stringify(projected).includes("dominant"), false);
  const result = await service.answerReview({ ownerId: "owner-a", batchId: "review:owner-a:2026-08-19", questionId: "task-0", selectedChoiceIds: [], blankAnswers: [{ id: "blank-1", text: "dominant" }, { id: "blank-2", text: "subdominant" }], idempotencyKey: "answer-1" });
  assertEquals(result.ok, true);
  if (!result.ok) return;
  const answer = /** @type {{ readonly score: number, readonly correct: boolean, readonly nextDueAt: string, readonly feedback: { readonly components: readonly { readonly correct: boolean }[] } }} */ (result.value);
  assertEquals(answer.score, 0.5);
  assertEquals(answer.correct, false);
  assertEquals(answer.nextDueAt, "2026-08-19T00:00:00.000Z");
  assertEquals(answer.feedback.components[0].correct, true);
  assertEquals(answer.feedback.components[1].correct, false);
  assertEquals(database.queries.some((query) => query.includes("INSERT INTO learner_review_answers") && query.includes("score")), true);
  const inserts = database.queries.filter((query) => query.includes("INSERT INTO learner_review_answers")).length;
  const retry = await service.answerReview({ ownerId: "owner-a", batchId: "review:owner-a:2026-08-19", questionId: "task-0", selectedChoiceIds: [], blankAnswers: [{ id: "blank-1", text: "dominant" }, { id: "blank-2", text: "subdominant" }], idempotencyKey: "answer-1" });
  assertEquals(retry.ok, true);
  if (retry.ok) assertEquals(/** @type {{ readonly score: number }} */ (retry.value).score, 0.5);
  assertEquals(database.queries.filter((query) => query.includes("INSERT INTO learner_review_answers")).length, inserts);
});

Deno.test("unavailable semantic grading leaves an uncertain fill response pending without writing an attempt", async () => {
  const due = rows().map((row) => ({ ...row, studied_at: "2026-08-19T00:00:00.000Z", due_at: "2026-08-19T00:00:00.000Z" }));
  due[0].task_json = JSON.stringify({ id: "task-0", kind: "fill-blank", prompt: "Name the target.", explanation: "The target is tonic.", sourceAnchorIds: ["anchor-0"], choices: null, correctChoiceIds: null, acceptedAnswers: ["tonic"], blankId: "blank-1", revision: 1 });
  const database = new Database(due);
  database.reviewRow = { batch_id: "review:owner-a:2026-08-19", learning_day: "2026-08-19", status: "open", item_ids_json: JSON.stringify(["task-0"]), revision: 1, created_at: "2026-08-19T00:00:00.000Z", completed_at: null };
  const service = createLearningBatchService({ database: /** @type {import("../worker/learning-batches-d1.js").D1DatabasePort} */ (/** @type {unknown} */ (database)), now: () => "2026-08-19T00:00:00.000Z", semanticGrader: async () => ({ ok: false, error: { kind: "KnowledgeModelUnavailable" } }), logger: () => {} });
  const result = await service.answerReview({ ownerId: "owner-a", batchId: "review:owner-a:2026-08-19", questionId: "task-0", selectedChoiceIds: [], answerText: "home note", idempotencyKey: "answer-1" });
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error.kind, "ReviewGradingUnavailable");
  assertEquals(database.queries.some((query) => query.includes("INSERT INTO learner_review_answers")), false);
});

Deno.test("legacy single-blank answers and semantic equivalents remain gradeable", async () => {
  const due = rows().map((row) => ({ ...row, studied_at: "2026-08-19T00:00:00.000Z", due_at: "2026-08-19T00:00:00.000Z", scheduled_days: 2 }));
  due[0].task_json = JSON.stringify({ id: "task-0", kind: "fill-blank", prompt: "Name the home note.", explanation: "The tonic is the home note.", sourceAnchorIds: ["anchor-0"], choices: null, correctChoiceIds: null, acceptedAnswers: ["tonic"], blankId: "blank-1", revision: 1 });
  const database = new Database(due);
  database.reviewRow = { batch_id: "review:owner-a:2026-08-19", learning_day: "2026-08-19", status: "open", item_ids_json: JSON.stringify(["task-0"]), revision: 1, created_at: "2026-08-19T00:00:00.000Z", completed_at: null };
  database.answerCount = 1;
  const service = createLearningBatchService({ database: /** @type {import("../worker/learning-batches-d1.js").D1DatabasePort} */ (/** @type {unknown} */ (database)), now: () => "2026-08-19T00:00:00.000Z", semanticGrader: async () => ({ ok: true, value: [1] }), logger: () => {} });
  const result = await service.answerReview({ ownerId: "owner-a", batchId: "review:owner-a:2026-08-19", questionId: "task-0", selectedChoiceIds: [], answerText: "home pitch", idempotencyKey: "answer-1" });
  assertEquals(result.ok, true);
  if (!result.ok) return;
  const answer = /** @type {{ readonly score: number, readonly correct: boolean, readonly nextDueAt: string }} */ (result.value);
  assertEquals(answer.score, 1);
  assertEquals(answer.correct, true);
  assertEquals(answer.nextDueAt, "2026-08-23T00:00:00.000Z");
});

Deno.test("multi-select requires exact set equality and wrong selections do not extend the interval", async () => {
  const due = rows().map((row) => ({ ...row, studied_at: "2026-08-19T00:00:00.000Z", due_at: "2026-08-19T00:00:00.000Z", scheduled_days: 2 }));
  due[0].task_json = JSON.stringify({ id: "task-0", kind: "multiple-choice", prompt: "Which relationships hold?", explanation: "The source supports A and B.", sourceAnchorIds: ["anchor-0"], choices: [{ id: "a", label: "A" }, { id: "b", label: "B" }, { id: "c", label: "C" }], correctChoiceIds: ["a", "b"], acceptedAnswers: null, blankId: null, revision: 1 });
  const database = new Database(due);
  database.reviewRow = { batch_id: "review:owner-a:2026-08-19", learning_day: "2026-08-19", status: "open", item_ids_json: JSON.stringify(["task-0"]), revision: 1, created_at: "2026-08-19T00:00:00.000Z", completed_at: null };
  database.answerCount = 1;
  const service = createLearningBatchService({ database: /** @type {import("../worker/learning-batches-d1.js").D1DatabasePort} */ (/** @type {unknown} */ (database)), now: () => "2026-08-19T00:00:00.000Z", logger: () => {} });
  const result = await service.answerReview({ ownerId: "owner-a", batchId: "review:owner-a:2026-08-19", questionId: "task-0", selectedChoiceIds: ["a", "b", "c"], answerText: null, blankAnswers: null, idempotencyKey: "answer-1" });
  assertEquals(result.ok, true);
  if (!result.ok) return;
  const answer = /** @type {{ readonly score: number, readonly correct: boolean, readonly nextDueAt: string }} */ (result.value);
  assertEquals(answer.score, 0);
  assertEquals(answer.correct, false);
  assertEquals(answer.nextDueAt, "2026-08-19T00:00:00.000Z");
});

Deno.test("learner D1 deletion preserves batch and answer history while removing paired descendants", async () => {
  const database = new Database([]);
  const service = createLearningBatchService({ database: /** @type {import("../worker/learning-batches-d1.js").D1DatabasePort} */ (/** @type {unknown} */ (database)), now: () => "2026-08-19T00:00:00.000Z", logger: () => {} });
  const result = await service.removeKnowledge({ ownerId: "owner-a", knowledgeId: "knowledge-a", idempotencyKey: "remove-a" });
  assertEquals(result.ok, true);
  for (const table of ["learner_question_state", "learner_knowledge_state", "knowledge_workflow_quizzes", "extraction_knowledge_points"]) assertEquals(database.queries.some((query) => query.includes(`DELETE FROM ${table}`)), true);
  for (const table of ["learner_feed_batches", "learner_review_batches", "learner_review_answers"]) assertEquals(database.queries.some(query => query.includes(`DELETE FROM ${table}`)), false);
});

Deno.test("learner D1 answer contract supports fill-blank answers without exposing them in the question projection", async () => {
  const source = await Deno.readTextFile(new URL("../worker/learning-batches-d1.js", import.meta.url));
  assertEquals(source.includes("acceptedAnswers"), true);
  assertEquals(source.includes("answerText"), true);
  assertEquals(source.includes("ReviewAnswerNotSupported"), true);
});

Deno.test("learner D1 source removal enumerates every descendant namespace before cascading", async () => {
  const database = new Database([]);
  const service = createLearningBatchService({ database: /** @type {import("../worker/learning-batches-d1.js").D1DatabasePort} */ (/** @type {unknown} */ (database)), now: () => "2026-08-19T00:00:00.000Z", logger: () => {} });
  const result = await service.removeSource({ ownerId: "owner-a", sourceId: "source-a", idempotencyKey: "remove-source-a" });
  assertEquals(result.ok, true);
  for (const table of ["extraction_knowledge_points", "knowledge_workflow_quizzes", "learning_generation_jobs", "knowledge_workflow_media_assets", "learner_knowledge_state"]) assertEquals(database.queries.some((query) => query.includes(`FROM ${table}`)), true);
});

Deno.test("learner D1 full generated-content reset preserves durable more-or-less preference feedback", async () => {
  const database = new Database([]);
  const service = createLearningBatchService({ database: /** @type {import("../worker/learning-batches-d1.js").D1DatabasePort} */ (/** @type {unknown} */ (database)), now: () => "2026-08-20T00:00:00.000Z", logger: () => {} });
  const result = await service.clearGeneratedContent("owner-a");
  assertEquals(result.ok, true);
  assertEquals(database.queries.some((query) => query.includes("DELETE FROM learner_preference_feedback")), false);
  assertEquals(database.queries.some((query) => query.includes("DELETE FROM extraction_knowledge_points")), true);
});

Deno.test("reloading an open Review batch resumes only unanswered questions", async () => {
  for (const answeredRows of [[], [{ question_id: "task-0" }], [{ question_id: "task-0" }, { question_id: "task-1" }]]) {
    const database = new Database(rows().map(row => ({ ...row, studied_at: "2026-08-19T00:00:00.000Z", due_at: "2026-08-19T00:00:00.000Z" })));
    database.reviewRow = { batch_id: "review:resume", learning_day: "2026-08-19", status: "open", item_ids_json: JSON.stringify(["task-0", "task-1", "task-2"]), revision: 1, created_at: "2026-08-19T00:00:00.000Z", completed_at: null };
    database.answeredRows = answeredRows;
    const service = createLearningBatchService({ database: /** @type {import("../worker/learning-batches-d1.js").D1DatabasePort} */ (/** @type {unknown} */ (database)), now: () => "2026-08-19T00:00:00.000Z", random: () => 0.1, logger: () => {} });
    const result = await service.loadReview("owner-a", "2026-08-19");
    assertEquals(result.ok, true);
    if (!result.ok) continue;
    const projection = /** @type {{questions: {questionId:string}[]}} */ (result.value);
    assertEquals(projection.questions.length, 3 - answeredRows.length);
    assertEquals(projection.questions.some(question => answeredRows.some(row => row.question_id === question.questionId)), false);
    assertEquals(database.queries.some(query => query.includes("FROM learner_review_answers WHERE owner_id = ? AND batch_id = ?")), true);
    database.answerReadFails = true;
    const failure = await service.loadReview("owner-a", "2026-08-19");
    assertEquals(failure.ok, false);
    if (!failure.ok) assertEquals(failure.error.kind, "LearningBatchPersistenceFailed");
  }
});

Deno.test("a new day replaces unfinished Feed and Review batches without erasing prior activity", async () => {
  const previous = { batch_id: "yesterday", learning_day: "2026-08-18", status: "open", item_ids_json: JSON.stringify(["task-0"]), revision: 1, created_at: "2026-08-18T00:00:00.000Z", completed_at: null };
  class PriorDayDatabase extends Database {
    /** @override @param {string} query @param {readonly (string | number | null)[]} [bindings] */
    async first(query, bindings = []) {
      if (query.includes("FROM learner_feed_batches")) return { ...previous, item_ids_json: JSON.stringify(Array.from({ length: 5 }, (_, i) => `knowledge-${i}`)) };
      return await super.first(query, bindings);
    }
  }
  const database = new PriorDayDatabase(rows(8).map(row => ({ ...row, studied_at: "2026-08-19T00:00:00.000Z", due_at: "2026-08-19T00:00:00.000Z" })));
  database.reviewRow = previous;
  const service = createLearningBatchService({ database: /** @type {import("../worker/learning-batches-d1.js").D1DatabasePort} */ (/** @type {unknown} */ (database)), now: () => "2026-08-19T00:00:00.000Z", random: () => 0.1, logger: () => {} });
  for (const load of [() => service.loadFeed("owner-a", "2026-08-19"), () => service.loadReview("owner-a", "2026-08-19")]) {
    const result = await load();
    assertEquals(result.ok, true);
    if (!result.ok) return;
    const projection = /** @type {{ readonly batch: { readonly learningDay: string, readonly status: string, readonly itemIds: readonly string[] } }} */ (result.value);
    assertEquals(projection.batch.learningDay, "2026-08-19");
    assertEquals(projection.batch.status, "open");
    assertEquals(projection.batch.itemIds.length, 5);
  }
  assertEquals(database.queries.some(query => query.startsWith("DELETE")), false);
});

Deno.test("stored webpage links survive Feed projection and gateway parsing", async () => {
  const entries = rows();
  const inlineLinks = [{text:"music fact",url:"https://example.test/definition#fact"}];
  const saved = JSON.parse(entries[0].point_json);
  saved.evidenceAnchors[0] = {...saved.evidenceAnchors[0],quote:saved.summary,inlineLinks};
  entries[0].point_json = JSON.stringify(saved);
  const service = createLearningBatchService({database:/** @type {import("../worker/learning-batches-d1.js").D1DatabasePort} */ (/** @type {unknown} */ (new Database(entries))),now:()=>"2026-08-19T00:00:00.000Z",random:()=>0.1,logger:()=>{}});
  const projected = await service.loadFeed("owner-a","2026-08-19");
  assertEquals(projected.ok,true); if(!projected.ok)return;
  const gateway = new LearningBatchGatewayClient({fetch:async()=>Response.json({result:projected.value}),baseUrl:"https://app.example.test/",timeoutMs:1000});
  const result = await gateway.loadFeed("2026-08-19");
  assertEquals(result.ok,true); if(!result.ok)return;
  assertEquals(JSON.stringify(result.value.items.find(item=>item.knowledgeId==="knowledge-0")?.inlineLinks),JSON.stringify(inlineLinks));
});
