// @ts-check

import { LearningBatchGatewayClient } from "../src/features/learning-generation/batches-gateway.js";

/** @template T @param {T} actual @param {T} expected */
function assertEquals(actual, expected) { if (!Object.is(actual, expected)) throw new Error(`Expected ${String(expected)}, received ${String(actual)}.`); }

/** @param {unknown} body @param {number} [status] */
function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const feed = {
  batch: { batchId: "feed:a", learningDay: "2026-08-19", status: "open", itemIds: ["k1", "k2", "k3", "k4", "k5"], revision: 1, createdAt: "2026-08-19T00:00:00.000Z", completedAt: null },
  items: Array.from({ length: 5 }, (_, index) => ({ knowledgeId: `k${index + 1}`, sourceId: "s1", sourceRevision: 2, questionId: `q${index + 1}`, title: "Music", summary: `Point ${index + 1}`, sourceUrl: "https://example.test", evidenceAnchorIds: ["anchor-1"], media: null, questionLocked: true, sourceClassification: { mainSubject: "music", topic: "Cadential harmony" }, sourceClassificationRevision: 1 })),
};

const review = {
  batch: { batchId: "review:a", learningDay: "2026-08-19", status: "open", itemIds: ["q1"], revision: 1, createdAt: "2026-08-19T00:00:00.000Z", completedAt: null },
  questions: [{ questionId: "q1", knowledgeId: "k1", title: "Music", prompt: "Which?", kind: "single-choice", choices: [{ id: "choice-1", label: "A" }, { id: "choice-2", label: "B" }], sourceAnchorIds: ["anchor-1"], revision: 1 }],
  dueCount: 1,
};

const fillBlankReview = {
  batch: { batchId: "review:fill", learningDay: "2026-08-19", status: "open", itemIds: ["q-fill"], revision: 1, createdAt: "2026-08-19T00:00:00.000Z", completedAt: null },
  questions: [{ questionId: "q-fill", knowledgeId: "k-fill", title: "Music", prompt: "Complete the term.", kind: "fill-blank", choices: null, sourceAnchorIds: ["anchor-1"], revision: 1 }],
  dueCount: 1,
};

Deno.test("learner gateway preserves valid media purposes and rejects unknown ones", async () => {
  for (const purpose of [undefined, "evidence", "illustration", "unknown", null]) {
    const media = { assetId: "asset", kind: "image", url: "/api/learning-media?assetId=asset&variant=feed", attribution: "Source image", ...(purpose === undefined ? {} : { purpose }) };
    const gateway = new LearningBatchGatewayClient({ fetch: async () => response({ result: { ...feed, items: feed.items.map((item) => ({ ...item, media })) } }), baseUrl: "https://app.example.test/", timeoutMs: 1000 });
    const loaded = await gateway.loadFeed("2026-08-19");
    assertEquals(loaded.ok, purpose === undefined || purpose === "evidence" || purpose === "illustration");
    if (loaded.ok) assertEquals(loaded.value.items[0].media?.purpose, purpose);
  }
});

Deno.test("learner gateway parses paired Feed and Review projections", async () => {
  /** @type {string[]} */ const paths = [];
  const gateway = new LearningBatchGatewayClient({
    fetch: async (input) => {
      const requestUrl = input instanceof Request ? input.url : String(input);
      paths.push(new URL(requestUrl).pathname);
      return response({ ownerId: "owner-a", result: paths.at(-1)?.endsWith("review-batch") ? review : feed });
    },
    baseUrl: "https://app.example.test/",
    timeoutMs: 1_000,
  });
  const loadedFeed = await gateway.loadFeed("2026-08-19");
  assertEquals(loadedFeed.ok, true);
  if (!loadedFeed.ok) return;
  assertEquals(loadedFeed.value.items.length, 5);
  const loadedReview = await gateway.loadReview("2026-08-19");
  assertEquals(loadedReview.ok, true);
  if (loadedReview.ok) {
    assertEquals(loadedReview.value.dueCount, 1);
    assertEquals(Object.hasOwn(loadedReview.value.questions[0] ?? {}, "explanation"), false);
    assertEquals(Object.hasOwn(loadedReview.value.questions[0] ?? {}, "correctChoiceIds"), false);
  }
});

Deno.test("learner gateway accepts one answer-hidden choice and fill-blank variant", async () => {
  const paired = { ...review, questions: [{ ...review.questions[0], pairedVariants: [
    { id: "choice-v1", kind: "multiple-choice", prompt: "Select every interval class with six semitones.", choices: [{ id: "tritone", label: "Tritone" }, { id: "octave", label: "Octave" }], blanks: null },
    { id: "fill-v1", kind: "fill-blank", prompt: "A six-semitone interval is a ____.", choices: null, blanks: [{ id: "blank-1" }] },
  ] }] };
  for (const [variants, expected] of [
    [paired.questions[0].pairedVariants, true],
    [[paired.questions[0].pairedVariants[1], paired.questions[0].pairedVariants[0]], true],
    [[paired.questions[0].pairedVariants[0], paired.questions[0].pairedVariants[0]], false],
    [[{ ...paired.questions[0].pairedVariants[0], correctChoiceIds: ["tritone"] }, paired.questions[0].pairedVariants[1]], false],
    [[{ ...paired.questions[0].pairedVariants[0], choices: [{ id: "tritone", label: "Tritone", isCorrect: true }, { id: "octave", label: "Octave" }] }, paired.questions[0].pairedVariants[1]], false],
    [[{ ...paired.questions[0].pairedVariants[0], canonicalAnswers: ["tritone"] }, paired.questions[0].pairedVariants[1]], false],
    [[{ ...paired.questions[0].pairedVariants[0], explanation: "Answer cue." }, paired.questions[0].pairedVariants[1]], false],
    [[paired.questions[0].pairedVariants[0], { ...paired.questions[0].pairedVariants[1], explanation: "Answer cue." }], false],
    [[paired.questions[0].pairedVariants[0]], false],
  ]) {
    const gateway = new LearningBatchGatewayClient({ fetch: async () => response({ result: { ...paired, questions: [{ ...paired.questions[0], pairedVariants: variants }] } }), baseUrl: "https://app.example.test/", timeoutMs: 1_000 });
    const result = await gateway.loadReview("2026-08-19");
    assertEquals(result.ok, expected);
  }
  const rootAnswerLeak = { ...paired, questions: [{ ...paired.questions[0], choices: [{ id: "choice-1", label: "A", isCorrect: true }, { id: "choice-2", label: "B" }] }] };
  const rootGateway = new LearningBatchGatewayClient({ fetch: async () => response({ result: rootAnswerLeak }), baseUrl: "https://app.example.test/", timeoutMs: 1_000 });
  assertEquals((await rootGateway.loadReview("2026-08-19")).ok, false);
});

Deno.test("learner gateway validates and sends a source-level edit with both optimistic revisions", async () => {
  let requestBody = /** @type {unknown} */ (null);
  const gateway = new LearningBatchGatewayClient({ fetch: async (_input, init) => { requestBody = JSON.parse(String(init?.body)); return response({ result: { sourceId: "s1", sourceRevision: 2, classificationRevision: 2, mainSubject: "music", topic: "Secondary dominants" } }); }, baseUrl: "https://app.example.test/", timeoutMs: 1_000 });
  const saved = await gateway.updateSourceClassification({ sourceId: "s1", sourceRevision: 2, expectedRevision: 1, mainSubject: "music", topic: "Secondary dominants" });
  assertEquals(saved.ok, true);
  assertEquals(JSON.stringify(requestBody), JSON.stringify({ sourceId: "s1", sourceRevision: 2, expectedRevision: 1, mainSubject: "music", topic: "Secondary dominants" }));
  const invalid = await gateway.updateSourceClassification({ sourceId: "s1", sourceRevision: 2, expectedRevision: 1, mainSubject: "invented", topic: "topic" });
  assertEquals(invalid.ok, false);
  if (!invalid.ok) assertEquals(invalid.error.kind, "LearningBatchGatewayCommandInvalid");
});

Deno.test("learner gateway invokes injected fetch without rebinding its receiver", async () => {
  let requests = 0;
  const receiverSensitiveFetch = /** @type {typeof fetch} */ (
    /** @this {undefined} */ function (input, init) {
      if (this !== undefined) {
        return Promise.reject(new TypeError("Fetch receiver changed."));
      }
      requests += 1;
      return Promise.resolve(response({ ownerId: "owner-a", result: feed }));
    }
  );
  const gateway = new LearningBatchGatewayClient({
    fetch: receiverSensitiveFetch,
    baseUrl: "https://app.example.test/",
    timeoutMs: 1_000,
  });

  const loaded = await gateway.loadFeed("2026-08-19");
  assertEquals(loaded.ok, true);
  assertEquals(requests, 1);
});

Deno.test("learner gateway rejects pre-attempt projections that contain explanations or answer keys", async () => {
  const gateway = new LearningBatchGatewayClient({
    fetch: async () => response({ result: { ...review, questions: [{ ...review.questions[0], correctChoiceIds: ["choice-1"] }] } }),
    baseUrl: "https://app.example.test/",
    timeoutMs: 1_000,
  });
  const loaded = await gateway.loadReview("2026-08-19");
  assertEquals(loaded.ok, false);
  if (!loaded.ok) assertEquals(loaded.error.kind, "LearningBatchGatewayResponseInvalid");
  const explanationGateway = new LearningBatchGatewayClient({
    fetch: async () => response({ result: { ...review, questions: [{ ...review.questions[0], explanation: "Answer cue." }] } }),
    baseUrl: "https://app.example.test/",
    timeoutMs: 1_000,
  });
  const withExplanation = await explanationGateway.loadReview("2026-08-19");
  assertEquals(withExplanation.ok, false);
});

Deno.test("learner gateway parses answerable fill-blank Review questions", async () => {
  const gateway = new LearningBatchGatewayClient({
    fetch: async () => response({ ownerId: "owner-a", result: fillBlankReview }),
    baseUrl: "https://app.example.test/",
    timeoutMs: 1_000,
  });
  const loaded = await gateway.loadReview("2026-08-19");
  assertEquals(loaded.ok, true);
  if (loaded.ok) {
    assertEquals(loaded.value.questions[0]?.kind, "fill-blank");
    assertEquals(loaded.value.questions[0]?.choices, null);
  }
});

Deno.test("learner gateway keeps multi-blank answer keys private and parses scored feedback", async () => {
  const multi = { ...fillBlankReview, questions: [{ ...fillBlankReview.questions[0], blanks: [{ id: "blank-1" }, { id: "blank-2" }] }] };
  const gateway = new LearningBatchGatewayClient({ fetch: async (input) => String(input).includes("review-batch/answer") ? response({ result: { completed: true, correct: false, score: 0.5, nextDueAt: "2026-08-20T00:00:00.000Z", feedback: { explanation: "The source distinguishes both terms.", correctAnswer: "dominant, tonic", components: [{ id: "blank-1", correct: true, correctAnswer: "dominant" }, { id: "blank-2", correct: false, correctAnswer: "tonic" }] } } }) : response({ result: multi }), baseUrl: "https://app.example.test/", timeoutMs: 1_000 });
  const loaded = await gateway.loadReview("2026-08-19");
  assertEquals(loaded.ok, true);
  if (!loaded.ok) return;
  assertEquals(loaded.value.questions[0].blanks?.length, 2);
  assertEquals(JSON.stringify(loaded.value).includes("acceptedAnswers"), false);
  const answer = await gateway.answerReview("review:fill", "q-fill", [], "one", null, [{ id: "blank-1", text: "dominant" }, { id: "blank-2", text: "subdominant" }]);
  assertEquals(answer.ok, true);
  if (answer.ok) assertEquals(answer.value.score, 0.5);
});

Deno.test("learner gateway sends bounded completion, answer, preference, and deletion commands", async () => {
  /** @type {string[]} */ const methods = [];
  /** @type {unknown[]} */ const bodies = [];
  const gateway = new LearningBatchGatewayClient({
    fetch: async (_input, init) => {
      methods.push(init?.method ?? "GET");
      bodies.push(init?.body === undefined || init.body === null ? null : JSON.parse(String(init.body)));
      const body = init?.body === undefined || init.body === null ? null : JSON.parse(String(init.body));
      return response({ ownerId: "owner-a", result: body !== null && Object.hasOwn(body, "questionId") ? { completed: true, correct: true, score: 1, nextDueAt: "2026-08-20T00:00:00.000Z", feedback: { explanation: "Source-backed explanation.", correctAnswer: "A", components: [{ id: "choice-1", correct: true, correctAnswer: "A" }] } } : { ok: true, completed: true, correct: true } });
    },
    baseUrl: "https://app.example.test/",
    timeoutMs: 1_000,
  });
  assertEquals((await gateway.completeFeed("feed:a", "id-feed")).ok, true);
  assertEquals((await gateway.answerReview("review:a", "q1", ["choice-1"], "id-answer")).ok, true);
  assertEquals(Object.hasOwn(/** @type {Record<string,unknown>} */ (bodies[1]), "confidence"), false);
  assertEquals(bodies.length, 2);
  assertEquals((await gateway.setPreference("k1", "more", "id-more")).ok, true);
  assertEquals((await gateway.removeKnowledge("k1", "id-remove")).ok, true);
  assertEquals((await gateway.removeKnowledge("k1", "id-image-remove", "image")).ok, true);
  assertEquals(/** @type {Record<string,unknown>} */ (bodies.at(-1)).target, "image");
  assertEquals(methods.every((method) => method === "POST"), true);
  assertEquals(bodies.every((body) => typeof body === "object" && body !== null && !Object.hasOwn(/** @type {Record<string, unknown>} */ (body), "ownerId")), true);
});

Deno.test("learner gateway surfaces server locks instead of treating them as success", async () => {
  const gateway = new LearningBatchGatewayClient({ fetch: async () => response({ error: "ReviewRefreshLocked" }, 409), baseUrl: "https://app.example.test/", timeoutMs: 1_000 });
  const result = await gateway.refreshReview("id-refresh");
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error.kind, "LearningBatchGatewayRejected");
});

Deno.test("Feed and Review reject projections with more than five cards", async () => {
  const gateway = new LearningBatchGatewayClient({ fetch: async input => response({ result: String(input).includes("review-batch") ? { ...review, questions: Array.from({ length: 6 }, () => review.questions[0]) } : { ...feed, items: [...feed.items, feed.items[0]] } }), baseUrl: "https://app.example.test/", timeoutMs: 1000 });
  assertEquals((await gateway.loadFeed("2026-08-19")).ok, false);
  assertEquals((await gateway.loadReview("2026-08-19")).ok, false);
});


Deno.test("learner gateway keeps Skip separate from answers and validates revealed feedback", async () => {
  let path = "", body = {};
  const skip = { questionId: "q1", completed: false, feedback: { correctAnswer: "Tritone", explanation: "Six semitones." } };
  const gateway = new LearningBatchGatewayClient({ fetch: async (input, options) => { path = String(input); body = JSON.parse(String(options?.body)); return response({ result: skip }); }, baseUrl: "https://app.example.test/", timeoutMs: 1000 });
  assertEquals((await gateway.skipReview("review:a", "q1", 1, "skip:q1")).ok, true);
  assertEquals(path.endsWith("/review-batch/skip"), true);
  assertEquals(JSON.stringify(body), JSON.stringify({ batchId: "review:a", questionId: "q1", questionRevision: 1, idempotencyKey: "skip:q1" }));
  for (const result of [null, { ...skip, feedback: {} }, { ...skip, completed: "false" }, { ...skip, questionId: "" }]) {
    const malformed = new LearningBatchGatewayClient({ fetch: async () => response({ result }), baseUrl: "https://app.example.test/", timeoutMs: 1000 });
    assertEquals((await malformed.skipReview("review:a", "q1", 1, "skip:q1")).ok, false);
  }
  const hydrated = new LearningBatchGatewayClient({ fetch: async () => response({ result: { ...review, skipped: [skip] } }), baseUrl: "https://app.example.test/", timeoutMs: 1000 });
  const loaded = await hydrated.loadReview("2026-08-19");
  assertEquals(loaded.ok, true);
  if (loaded.ok) assertEquals(loaded.value.skipped[0].feedback.correctAnswer, "Tritone");
  const foreign = new LearningBatchGatewayClient({ fetch: async () => response({ result: { ...review, skipped: [{ ...skip, questionId: "foreign" }] } }), baseUrl: "https://app.example.test/", timeoutMs: 1000 });
  assertEquals((await foreign.loadReview("2026-08-19")).ok, false);
});

Deno.test("Delete quiz validates the exact question acknowledgement", async () => {
  for (const [result, expected] of [[{ batchId: "review:a", questionId: "q1", removed: true }, true], [{ batchId: "review:b", questionId: "q1", removed: true }, false], [{ batchId: "review:a", questionId: "q2", removed: true }, false], [{ batchId: "review:a", questionId: "q1", removed: false }, false]]) {
    const gateway = new LearningBatchGatewayClient({ fetch: async (input, init) => {
      assertEquals(String(input).endsWith("/review-batch/remove"), true);
      assertEquals(JSON.stringify(JSON.parse(String(init?.body))), JSON.stringify({ batchId: "review:a", questionId: "q1", questionRevision: 1, idempotencyKey: "remove:q1" }));
      return response({ result });
    }, baseUrl: "https://app.example.test/", timeoutMs: 1000 });
    assertEquals((await gateway.removeReview("review:a", "q1", 1, "remove:q1")).ok, expected);
  }
});

Deno.test("Replacement validates the slot, answer-hidden question and batch identity", async () => {
  const batch = { batchId: "review:a", learningDay: "2026-10-23", status: "open", itemIds: ["new"], revision: 2, createdAt: "2026-10-23T00:00:00Z", completedAt: null };
  const question = { questionId: "new", knowledgeId: "k", title: "Synthetic source", prompt: "The home note is ____.", kind: "fill-blank", choices: null, blanks: [{ id: "blank-1" }], sourceAnchorIds: ["a"], revision: 1 };
  const valid = { questionId: "old", batch, questions: [question], dueCount: 2 };
  for (const [value, expected] of [[valid, true], [{ ...valid, questionId: "other" }, false], [{ ...valid, batch: { ...batch, batchId: "other" } }, false], [{ ...valid, questions: [] }, false], [{ ...valid, batch: { ...batch, itemIds: ["old"] } }, false], [{ ...valid, questions: [{ ...question, acceptedAnswers: ["tonic"] }] }, false]]) {
    const gateway = new LearningBatchGatewayClient({ fetch: async (input, init) => {
      assertEquals(String(input).endsWith("/review-batch/replace"), true);
      assertEquals(JSON.stringify(JSON.parse(String(init?.body))), JSON.stringify({ batchId: "review:a", questionId: "old", questionRevision: 1, idempotencyKey: "replace:old" }));
      return response({ result: value });
    }, baseUrl: "https://app.example.test/", timeoutMs: 1000 });
    assertEquals((await gateway.replaceReview("review:a", "old", 1, "replace:old")).ok, expected);
  }
});

Deno.test("learner gateway rejects executable inline link destinations", async () => {
  const gateway = new LearningBatchGatewayClient({fetch:async()=>response({result:{...feed,items:feed.items.map(item=>({...item,inlineLinks:[{text:"Point",url:"javascript:alert(1)"}]}))}}),baseUrl:"https://app.example.test/",timeoutMs:1000});
  assertEquals((await gateway.loadFeed("2026-08-19")).ok,false);
});
