// @ts-check

import { createDiscoveryWorker } from "../worker/handler.js";

/** @template T @param {T} actual @param {T} expected */
function assertEquals(actual, expected) { if (!Object.is(actual, expected)) throw new Error(`Expected ${String(expected)}, received ${String(actual)}.`); }

/** @param {string} path @param {{ readonly method?: string, readonly headers?: HeadersInit, readonly body?: unknown }} [options] */
function request(path, options = {}) {
  return new Request(`https://app.example${path}`, {
    method: options.method ?? "POST",
    headers: { origin: "https://app.example", "content-type": "application/json", ...(options.headers ?? {}) },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

/** @param {Partial<Parameters<typeof createDiscoveryWorker>[1]>} [overrides] */
function worker(overrides = {}) {
  return createDiscoveryWorker({ allowedOrigin: "https://app.example", maximumCommandBytes: 4096 }, {
    authenticate: overrides.authenticate ?? (async () => ({ ok: true, value: { ownerId: "owner-a", email: "owner@example.com" } })),
    acquireRss: async () => ({ ok: false, error: { kind: "DiscoveryFetchUnavailable" } }),
    sourceLibrary: overrides.sourceLibrary ?? null,
    sourceIngestion: overrides.sourceIngestion ?? null,
    waitUntil: overrides.waitUntil,
    learningGeneration: overrides.learningGeneration ?? null,
    learningBatches: overrides.learningBatches ?? null,
    knowledgeWorkflowBackfill: overrides.knowledgeWorkflowBackfill ?? null,
    knowledgeWorkflowReplay: overrides.knowledgeWorkflowReplay ?? null,
  });
}

/** @param {readonly string[]} capabilities @returns {import("../src/features/source-library/contracts.js").LibrarySource} */
function approvedSource(capabilities) {
  return {
    id: "source-a", submittedUrl: "https://publisher.example/learn", canonicalUrl: "https://publisher.example/learn", title: "Harmony", description: "Source", identityEvidence: [], interestAreaIds: [], state: "active", approvedAt: "2026-08-12T12:00:00.000Z", updatedAt: "2026-08-12T12:00:00.000Z", revision: 1,
    ownerId: "owner-a",
    adapter: { id: "adapter-a", version: "1", granularity: "root", capabilities },
  };
}

Deno.test("progress and classification routes enforce authentication, owner injection, methods and failures", async () => {
  /** @type {unknown[]} */ const seen = [];
  /** @returns {Promise<{ok:false,error:{kind:string}}>} */
  const unavailable = async () => ({ ok: false, error: { kind: "SyntheticUnavailable" } });
  /** @type {NonNullable<Parameters<typeof createDiscoveryWorker>[1]["learningBatches"]>} */
  const batches = {
    loadFeed: unavailable, loadReview: unavailable, completeFeed: unavailable, answerReview: unavailable, setPreference: unavailable, removeKnowledge: unavailable,
    loadProgress: async (/** @type {string} */ owner, /** @type {number} */ days, /** @type {string|null} */ subject) => { seen.push([owner, days, subject]); return { ok: true, value: {} }; },
    correctClassification: async (/** @type {unknown} */ command) => { seen.push(command); return { ok: false, error: { kind: "ClassificationConflict" } }; },
  };
  const app = worker({ learningBatches: batches });
  assertEquals((await app.fetch(request("/api/learning-generation/progress?days=7&subject=music", { method: "GET" }))).status, 200);
  assertEquals(JSON.stringify(seen[0]), JSON.stringify(["owner-a", 7, "music"]));
  assertEquals((await app.fetch(request("/api/learning-generation/progress?days=8", { method: "GET" }))).status, 400);
  assertEquals((await app.fetch(request("/api/learning-generation/progress", { body: {} }))).status, 405);
  assertEquals((await app.fetch(request("/api/learning-generation/classification", { body: { ownerId: "other" } }))).status, 400);
  assertEquals(seen.length, 1);
  for (const method of ["GET", "PUT", "DELETE"]) {
    const response = await app.fetch(request("/api/learning-generation/classification", { method, ...(method === "GET" ? {} : { body: {} }) }));
    assertEquals(response.status, 405);
    assertEquals(response.headers.get("allow"), "POST");
  }
  assertEquals(seen.length, 1);
  assertEquals((await app.fetch(request("/api/learning-generation/classification", { body: { knowledgeId: "k1", expectedRevision: 0, classification: {} } }))).status, 409);
  assertEquals(/** @type {Record<string,unknown>} */ (seen[1]).ownerId, "owner-a");
  const denied = worker({ learningBatches: batches, authenticate: async () => ({ ok: false, error: { kind: "DiscoveryAccessTokenMissing" } }) });
  assertEquals((await denied.fetch(request("/api/learning-generation/progress", { method: "GET" }))).status, 401);
  assertEquals(seen.length, 2);
});

Deno.test("Skip route authenticates, injects its owner and propagates rejected or unavailable commands", async () => {
  /** @type {unknown[]} */ const seen = [];
  /** @returns {Promise<{ok:false,error:{kind:string}}>} */
  const unavailable = async () => ({ ok: false, error: { kind: "LearningBatchUnavailable" } });
  /** @type {NonNullable<Parameters<typeof createDiscoveryWorker>[1]["learningBatches"]>} */
  const batches = { loadFeed: unavailable, loadReview: unavailable, completeFeed: unavailable, answerReview: unavailable, setPreference: unavailable, removeKnowledge: unavailable,
    skipReview: async (/** @type {unknown} */ command) => { seen.push(command); return { ok: false, error: { kind: "ReviewAnswerNotAllowed" } }; },
  };
  const app = worker({ learningBatches: batches }), path = "/api/learning-generation/review-batch/skip";
  const command = { batchId: "review:a", questionId: "q", questionRevision: 1, idempotencyKey: "skip" };
  assertEquals((await app.fetch(request(path, { method: "GET" }))).status, 405);
  assertEquals((await app.fetch(request(path, { body: { ...command, ownerId: "other" } }))).status, 400);
  assertEquals(seen.length, 0);
  assertEquals((await app.fetch(request(path, { body: command }))).status, 409);
  assertEquals(JSON.stringify(seen[0]), JSON.stringify({ ...command, ownerId: "owner-a" }));
  const denied = worker({ learningBatches: batches, authenticate: async () => ({ ok: false, error: { kind: "DiscoveryAccessTokenMissing" } }) });
  assertEquals((await denied.fetch(request(path, { body: command }))).status, 401);
  assertEquals(seen.length, 1);
  const missing = { ...batches, skipReview: undefined };
  assertEquals((await worker({ learningBatches: missing }).fetch(request(path, { body: command }))).status, 503);
});

Deno.test("Replacement route authenticates, injects its owner and propagates rejected or unavailable commands", async () => {
  /** @type {unknown[]} */ const seen = [];
  /** @returns {Promise<{ok:false,error:{kind:string}}>} */
  const unavailable = async () => ({ ok: false, error: { kind: "LearningBatchUnavailable" } });
  /** @type {NonNullable<Parameters<typeof createDiscoveryWorker>[1]["learningBatches"]>} */
  const batches = { loadFeed: unavailable, loadReview: unavailable, completeFeed: unavailable, answerReview: unavailable, setPreference: unavailable, removeKnowledge: unavailable,
    replaceReview: async (/** @type {unknown} */ command) => { seen.push(command); return { ok: false, error: { kind: "ReviewAnswerNotAllowed" } }; },
  };
  const app = worker({ learningBatches: batches }), path = "/api/learning-generation/review-batch/replace";
  const command = { batchId: "review:a", questionId: "q", questionRevision: 1, idempotencyKey: "skip" };
  assertEquals((await app.fetch(request(path, { method: "GET" }))).status, 405);
  assertEquals((await app.fetch(request(path, { body: { ...command, ownerId: "other" } }))).status, 400);
  assertEquals(seen.length, 0);
  assertEquals((await app.fetch(request(path, { body: command }))).status, 409);
  assertEquals(JSON.stringify(seen[0]), JSON.stringify({ ...command, ownerId: "owner-a" }));
  const denied = worker({ learningBatches: batches, authenticate: async () => ({ ok: false, error: { kind: "DiscoveryAccessTokenMissing" } }) });
  assertEquals((await denied.fetch(request(path, { body: command }))).status, 401);
  assertEquals(seen.length, 1);
  const missing = { ...batches, replaceReview: undefined };
  assertEquals((await worker({ learningBatches: missing }).fetch(request(path, { body: command }))).status, 503);
});

/** @param {import("../src/features/source-library/contracts.js").LibrarySource} source @returns {Promise<import("../src/features/source-library/contracts.js").Result<{ readonly source: import("../src/features/source-library/contracts.js").LibrarySource, readonly job: import("../src/features/source-library/contracts.js").SourceIngestionJob, readonly reused: boolean }, import("../src/features/source-library/contracts.js").SourceLibraryFailure>>} */
async function sourceApprovalResult(source) {
  return { ok: true, value: { source, job: { id: "job-a", ownerId: "owner-a", sourceId: source.id, sourceRevision: 1, policyVersion: "policy-v1", state: "pending", createdAt: "2026-08-12T12:00:00.000Z" }, reused: false } };
}

Deno.test("learning-generation status is authenticated, owner-scoped, and content-safe", async () => {
  let seenOwner = "";
  const response = await worker({ learningGeneration: {
    status: async (command) => { seenOwner = /** @type {{ readonly ownerId: string }} */ (command).ownerId; return { ok: true, value: { id: "generation-a", status: "completed", taskCounts: { published: 1, pendingReview: 0, rejected: 0, hidden: 0 } } }; },
    review: { decide: async () => ({ ok: false, error: { kind: "LearningReviewTaskUnknown", taskId: "task-a" } }) },
    revoke: { revoke: async () => ({ ok: false, error: { kind: "LearningRevocationPersistenceFailed" } }) },
  } }).fetch(request("/api/learning-generation/status?generationId=generation-a", { method: "GET" }));
  assertEquals(response.status, 200);
  assertEquals(seenOwner, "owner-a");
  const body = /** @type {Record<string, unknown>} */ (await response.json());
  assertEquals("prompt" in body, false);
});

Deno.test("review decisions derive owner from Access and return only a safe task projection", async () => {
  let seenOwner = "";
  let response = await worker({ learningGeneration: {
    status: async () => ({ ok: true, value: null }),
    review: { decide: async (command) => { seenOwner = /** @type {{ readonly ownerId: string }} */ (command).ownerId; return { ok: true, value: { id: "task-a", status: "published", reviewDecision: "approved", revision: 2, reviewedAt: "2026-08-12T12:01:00.000Z", prompt: "must not be returned" } }; } },
    revoke: { revoke: async () => ({ ok: false, error: { kind: "LearningRevocationPersistenceFailed" } }) },
  } }).fetch(request("/api/learning-generation/review", { body: { ownerId: "attacker", taskId: "task-a", expectedRevision: 1, decision: "approve", reviewedAt: "2026-08-12T12:01:00.000Z", idempotencyKey: "review-a" } }));
  assertEquals(response.status, 400);
  response = await worker({ learningGeneration: {
    status: async () => ({ ok: true, value: null }),
    review: { decide: async (command) => { seenOwner = /** @type {{ readonly ownerId: string }} */ (command).ownerId; return { ok: true, value: { id: "task-a", status: "published", reviewDecision: "approved", revision: 2, reviewedAt: "2026-08-12T12:01:00.000Z", prompt: "must not be returned" } }; } },
    revoke: { revoke: async () => ({ ok: false, error: { kind: "LearningRevocationPersistenceFailed" } }) },
  } }).fetch(request("/api/learning-generation/review", { body: { taskId: "task-a", expectedRevision: 1, decision: "approve", reviewedAt: "2026-08-12T12:01:00.000Z", idempotencyKey: "review-a" } }));
  assertEquals(response.status, 200);
  assertEquals(seenOwner, "owner-a");
  const body = /** @type {Record<string, unknown>} */ (await response.json());
  const result = /** @type {Record<string, unknown>} */ (body.result);
  assertEquals("prompt" in result, false);
});

Deno.test("revocation route returns only content-free tombstone metadata", async () => {
  const response = await worker({ learningGeneration: {
    status: async () => ({ ok: true, value: null }),
    review: { decide: async () => ({ ok: false, error: { kind: "LearningReviewTaskUnknown", taskId: "task-a" } }) },
    revoke: { revoke: async (command) => { const checked = /** @type {{ readonly ownerId: string, readonly sourceId: string, readonly sourceRevision: number, readonly reason: string, readonly revokedAt: string }} */ (command); return { ok: true, value: { changedGenerations: 1, changedUnits: 1, changedTasks: 1, reused: false, tombstones: [{ id: "tombstone-a", ownerId: checked.ownerId, sourceId: checked.sourceId, sourceRevision: checked.sourceRevision, itemId: "item-a", itemVersionId: "version-a", descendantKind: "task", descendantId: "task-a", reason: checked.reason, revokedAt: checked.revokedAt }] } }; } },
  } }).fetch(request("/api/learning-generation/revoke", { body: { sourceId: "source-a", sourceRevision: 1, idempotencyKey: "revoke-a", reason: "rights withdrawn", revokedAt: "2026-08-12T12:03:00.000Z" } }));
  assertEquals(response.status, 200);
  const body = /** @type {Record<string, unknown>} */ (await response.json());
  const result = /** @type {{ readonly tombstones: readonly Record<string, unknown>[] }} */ (body.result);
  assertEquals("prompt" in result.tombstones[0], false);
  assertEquals("contentDigest" in result.tombstones[0], false);
});

Deno.test("learning-generation routes authenticate before feature work", async () => {
  let calls = 0;
  const response = await worker({
    authenticate: async () => ({ ok: false, error: { kind: "DiscoveryClientUnauthenticated" } }),
    learningGeneration: { status: async () => { calls += 1; return { ok: true, value: null }; }, review: { decide: async () => ({ ok: true, value: /** @type {never} */ (undefined) }) }, revoke: { revoke: async () => ({ ok: true, value: /** @type {never} */ (undefined) }) } },
  }).fetch(request("/api/learning-generation/status?generationId=generation-a", { method: "GET" }));
  assertEquals(response.status, 401);
  assertEquals(calls, 0);
});

Deno.test("source disable invokes descendant revocation only after the source transition succeeds", async () => {
  /** @type {string[]} */ const events = [];
  const response = await worker({
    sourceLibrary: {
      approve: async () => ({ ok: false, error: { kind: "SourceApprovalPersistenceFailed" } }),
      revise: async () => ({ ok: false, error: { kind: "SourceDisablePersistenceFailed" } }),
      disable: async (command) => { events.push(`disable:${/** @type {{ readonly sourceId: string }} */ (command).sourceId}`); return { ok: true, value: { id: "source-a", ownerId: "owner-a", state: "disabled", revision: 2, updatedAt: "2026-08-12T12:03:00.000Z" } }; },
      restore: async () => ({ ok: false, error: { kind: "SourceDisablePersistenceFailed" } }),
      reject: async () => ({ ok: false, error: { kind: "SourceSuppressionFailed" } }),
    },
    learningGeneration: {
      status: async () => ({ ok: true, value: null }),
      review: { decide: async () => ({ ok: false, error: { kind: "LearningReviewTaskUnknown", taskId: "task-a" } }) },
      revoke: { revoke: async (command) => { const checked = /** @type {{ readonly sourceId: string, readonly sourceRevision: number, readonly reason: string }} */ (command); events.push(`revoke:${checked.sourceId}:${checked.sourceRevision}:${checked.reason}`); return { ok: true, value: { changedGenerations: 1, changedUnits: 1, changedTasks: 1, reused: false, tombstones: [] } }; } },
    },
  }).fetch(request("/api/source-library/disable", { body: { sourceId: "source-a", expectedRevision: 1, idempotencyKey: "disable-a" } }));
  assertEquals(response.status, 200);
  assertEquals(JSON.stringify(events), JSON.stringify(["disable:source-a", "revoke:source-a:2:source-disabled"]));
});

Deno.test("new bounded Library approval schedules one ingestion run through waitUntil", async () => {
  let runs = 0;
  /** @type {Promise<unknown> | null} */ let scheduled = null;
  const response = await worker({
    sourceLibrary: {
      approve: async () => await sourceApprovalResult(approvedSource(["metadata", "bounded-ingestion"])),
      revise: async () => ({ ok: false, error: { kind: "SourceApprovalPersistenceFailed" } }),
      disable: async () => ({ ok: false, error: { kind: "SourceDisablePersistenceFailed" } }),
      restore: async () => ({ ok: false, error: { kind: "SourceDisablePersistenceFailed" } }),
      reject: async () => ({ ok: false, error: { kind: "SourceSuppressionFailed" } }),
    },
    sourceIngestion: { run: async (command) => { runs += 1; assertEquals(JSON.stringify(command), JSON.stringify({ ownerId: "owner-a", jobId: "job-a" })); return { ok: true, value: { state: "completed", itemsStored: 1 } }; } },
    waitUntil: (promise) => { scheduled = promise; },
  }).fetch(request("/api/source-library/approve", { body: { identityStatus: "resolved", idempotencyKey: "approve-a" } }));
  assertEquals(response.status, 200);
  assertEquals(runs, 1);
  assertEquals(scheduled !== null, true);
  await scheduled;
});

Deno.test("approval replay and metadata-only approval do not schedule ingestion", async () => {
  let runs = 0;
  const sourceLibrary = /** @type {NonNullable<Parameters<typeof createDiscoveryWorker>[1]["sourceLibrary"]>} */ ({
    approve: async (command) => sourceApprovalResult(approvedSource((/** @type {{ readonly idempotencyKey: string }} */ (command)).idempotencyKey === "replay" ? ["metadata", "bounded-ingestion"] : ["metadata"])),
    revise: async () => ({ ok: false, error: { kind: "SourceApprovalPersistenceFailed" } }),
    disable: async () => ({ ok: false, error: { kind: "SourceDisablePersistenceFailed" } }),
    restore: async () => ({ ok: false, error: { kind: "SourceDisablePersistenceFailed" } }),
    reject: async () => ({ ok: false, error: { kind: "SourceSuppressionFailed" } }),
  });
  const sourceIngestion = /** @type {NonNullable<Parameters<typeof createDiscoveryWorker>[1]["sourceIngestion"]>} */ ({ run: async () => { runs += 1; return { ok: true, value: { state: "completed", itemsStored: 1 } }; } });
  const replay = await worker({ sourceLibrary: { ...sourceLibrary, approve: async () => ({ ok: true, value: { source: approvedSource(["metadata", "bounded-ingestion"]), job: null, reused: true } }) }, sourceIngestion }).fetch(request("/api/source-library/approve", { body: { identityStatus: "resolved", idempotencyKey: "replay" } }));
  const metadata = await worker({ sourceLibrary, sourceIngestion }).fetch(request("/api/source-library/approve", { body: { identityStatus: "resolved", idempotencyKey: "metadata" } }));
  assertEquals(replay.status, 200);
  assertEquals(metadata.status, 200);
  assertEquals(runs, 0);
});

Deno.test("review queue route is authenticated and returns bounded pending task projections", async () => {
  let seenOwner = "";
  const response = await worker({ learningGeneration: {
    status: async () => ({ ok: true, value: null }),
    review: {
      queue: async (ownerId) => { seenOwner = /** @type {string} */ (ownerId); return { ok: true, value: { sources: [{ sourceId: "source-a", title: "Harmony", status: "ready-for-review", generationId: "generation-a", pendingTaskCount: 1, reviewedTaskCount: 0, failureKind: null }], tasks: [{ id: "task-a", sourceId: "source-a", kind: "short-response", prompt: "Explain.", explanation: "Evidence.", sourceAnchorIds: ["unit-a:anchor"], revision: 1, status: "pending-review" }] } }; },
      decide: async () => ({ ok: true, value: /** @type {never} */ (undefined) }),
    },
    revoke: { revoke: async () => ({ ok: true, value: /** @type {never} */ (undefined) }) },
  } }).fetch(request("/api/learning-generation/review-queue", { method: "GET" }));
  assertEquals(response.status, 200);
  assertEquals(seenOwner, "owner-a");
  const body = /** @type {{ readonly result: { readonly tasks: readonly Record<string, unknown>[] } }} */ (await response.json());
  assertEquals(body.result.tasks[0].prompt, "Explain.");
  assertEquals(body.result.tasks[0].status, "pending-review");
});

Deno.test("published quiz route returns an authenticated, answerable projection without owner data", async () => {
  const worker = createDiscoveryWorker({ allowedOrigin: "https://app.example", maximumCommandBytes: 4096 }, {
    authenticate: async () => ({ ok: true, value: { ownerId: "owner-a", email: "member@example.test" } }),
    acquireRss: async () => ({ ok: false, error: { kind: "DiscoveryFetchUnavailable" } }),
    learningGeneration: {
      status: async () => ({ ok: true, value: {} }),
      review: {
        decide: async () => ({ ok: true, value: {} }),
        queue: async () => ({ ok: true, value: { sources: [], tasks: [] } }),
        visible: async () => ({ ok: true, value: [{ id: "task-a", sourceId: "source-a", kind: "single-choice", prompt: "Which cadence resolves?", explanation: "The source evidence says authentic cadence.", sourceAnchorIds: ["unit-a:anchor"], choices: [{ id: "choice-a", label: "Authentic" }, { id: "choice-b", label: "Plagal" }], correctChoiceIds: ["choice-a"], expectedConcepts: ["cadence"], minimumWords: null, stimulus: null, responseKind: null, status: "published", revision: 2 }] }),
      },
      revoke: { revoke: async () => ({ ok: true, value: {} }) },
    },
  });
  const response = await worker.fetch(new Request("https://worker.example/api/learning-generation/published", { headers: { origin: "https://app.example" } }));
  if (response.status !== 200) throw new Error(`Unexpected status ${response.status}`);
  const body = /** @type {Record<string, unknown>} */ (await response.json());
  const result = /** @type {Record<string, unknown>[]} */ (body.result);
  if (result.length !== 1 || result[0].prompt !== "Which cadence resolves?") throw new Error("Published quiz projection is missing.");
  if (Object.hasOwn(result[0], "ownerId") || Object.hasOwn(result[0], "sourceId")) throw new Error("Published quiz projection leaked internal ownership or source identifiers.");
});

Deno.test("existing-Library backfill route injects the Access owner and exposes only the safe completion projection", async () => {
  /** @type {unknown} */ let seenCommand = null;
  const response = await worker({ knowledgeWorkflowBackfill: {
    run: async (command) => {
      seenCommand = command;
      return { ok: true, value: { status: "completed", ownerId: "owner-a", sourceCount: 1, runIds: ["run-a"] } };
    },
  } }).fetch(request("/api/knowledge-workflows/backfill", { body: { confirmation: "MILESTONE_5_EXISTING_LIBRARY_BACKFILL", verificationMarker: "MILESTONE_5_LOCAL_VERIFIED" } }));
  assertEquals(response.status, 200);
  assertEquals(/** @type {{ readonly ownerId: string }} */ (seenCommand).ownerId, "owner-a");
  const body = /** @type {{ readonly ownerId: string, readonly result: Record<string, unknown> }} */ (await response.json());
  assertEquals(body.ownerId, "owner-a");
  assertEquals(body.result.sourceCount, 1);
  assertEquals("configDigests" in body.result, false);
});

Deno.test("existing-Library backfill route rejects caller-supplied ownership or deployment configuration", async () => {
  let calls = 0;
  const backfill = { run: async () => { calls += 1; return { ok: /** @type {const} */ (true), value: { status: "completed", ownerId: "owner-a", sourceCount: 0, runIds: [] } }; } };
  const ownerResponse = await worker({ knowledgeWorkflowBackfill: backfill }).fetch(request("/api/knowledge-workflows/backfill", { body: { ownerId: "attacker", confirmation: "MILESTONE_5_EXISTING_LIBRARY_BACKFILL", verificationMarker: "MILESTONE_5_LOCAL_VERIFIED" } }));
  const digestResponse = await worker({ knowledgeWorkflowBackfill: backfill }).fetch(request("/api/knowledge-workflows/backfill", { body: { configDigests: { scraper: "attacker" }, confirmation: "MILESTONE_5_EXISTING_LIBRARY_BACKFILL", verificationMarker: "MILESTONE_5_LOCAL_VERIFIED" } }));
  assertEquals(ownerResponse.status, 400);
  assertEquals(digestResponse.status, 400);
  assertEquals(calls, 0);
});

Deno.test("existing-Library replay route injects the Access owner and exposes blocked-source explanations", async () => {
  /** @type {unknown} */ let seenCommand = null;
  const response = await worker({ knowledgeWorkflowReplay: {
    run: async (command) => {
      seenCommand = command;
      return { ok: /** @type {const} */ (true), value: { status: "completed", ownerId: "owner-a", sourceCount: 2, runIds: ["run-a", "run-b"], blockedSources: [{ sourceId: "source-b", title: "Video lesson", reasonCode: "audio-video-transcription-unavailable", message: "Upload a transcript." }] } };
    },
  } }).fetch(request("/api/knowledge-workflows/replay", { body: { confirmation: "MILESTONE_5_EXISTING_LIBRARY_REPLAY", verificationMarker: "MILESTONE_5_REPLAY_LOCAL_VERIFIED" } }));
  assertEquals(response.status, 200);
  assertEquals(/** @type {{ readonly ownerId: string }} */ (seenCommand).ownerId, "owner-a");
  const body = /** @type {{ readonly result: Record<string, unknown> }} */ (await response.json());
  assertEquals(body.result.sourceCount, 2);
  assertEquals(Array.isArray(body.result.blockedSources), true);
  assertEquals("configDigests" in body.result, false);
});

Deno.test("Delete quiz route authenticates, injects its owner and propagates rejected or unavailable commands", async () => {
  /** @type {unknown[]} */ const seen = [];
  /** @returns {Promise<{ok:false,error:{kind:string}}>} */
  const unavailable = async () => ({ ok: false, error: { kind: "LearningBatchUnavailable" } });
  /** @type {NonNullable<Parameters<typeof createDiscoveryWorker>[1]["learningBatches"]>} */
  const batches = { loadFeed: unavailable, loadReview: unavailable, completeFeed: unavailable, answerReview: unavailable, setPreference: unavailable, removeKnowledge: unavailable,
    removeReview: async (/** @type {unknown} */ command) => { seen.push(command); return { ok: false, error: { kind: "ReviewRemovalNotAllowed" } }; },
  };
  const app = worker({ learningBatches: batches }), path = "/api/learning-generation/review-batch/remove";
  const command = { batchId: "review:a", questionId: "q", questionRevision: 1, idempotencyKey: "remove" };
  assertEquals((await app.fetch(request(path, { method: "GET" }))).status, 405);
  assertEquals((await app.fetch(request(path, { body: { ...command, ownerId: "other" } }))).status, 400);
  assertEquals(seen.length, 0);
  assertEquals((await app.fetch(request(path, { body: command }))).status, 409);
  assertEquals(JSON.stringify(seen[0]), JSON.stringify({ ...command, ownerId: "owner-a" }));
  const denied = worker({ learningBatches: batches, authenticate: async () => ({ ok: false, error: { kind: "DiscoveryAccessTokenMissing" } }) });
  assertEquals((await denied.fetch(request(path, { body: command }))).status, 401);
  assertEquals(seen.length, 1);
  const missing = { ...batches, removeReview: undefined };
  assertEquals((await worker({ learningBatches: missing }).fetch(request(path, { body: command }))).status, 503);
});

Deno.test("deletion feedback route authenticates and injects its owner after deletion",async()=>{
  /** @type {unknown[]} */ const seen=[];
  const unavailable=async()=>({ok:/** @type {const} */(false),error:{kind:"SyntheticUnavailable"}});
  const app=worker({learningBatches:{loadFeed:unavailable,loadReview:unavailable,completeFeed:unavailable,answerReview:unavailable,setPreference:unavailable,removeKnowledge:unavailable,submitDeletionReason:async command=>{seen.push(command);return {ok:true,value:{saved:true}};}}});
  const path="/api/learning-generation/knowledge-deletion-feedback";
  assertEquals((await app.fetch(request(path,{body:{deletionId:"delete-a",reason:"Avoid catalogue trivia.",idempotencyKey:"reason-a"}}))).status,200);
  assertEquals(JSON.stringify(seen[0]),JSON.stringify({deletionId:"delete-a",reason:"Avoid catalogue trivia.",idempotencyKey:"reason-a",ownerId:"owner-a"}));
  assertEquals((await app.fetch(request(path,{body:{ownerId:"foreign",deletionId:"delete-a",reason:"No",idempotencyKey:"bad"}}))).status,400);
  assertEquals((await app.fetch(request(path,{method:"GET"}))).status,405);
});
