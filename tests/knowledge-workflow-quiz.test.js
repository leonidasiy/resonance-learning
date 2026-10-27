// @ts-check

import { createQuizActorCritic, QUIZ_MAX_ATTEMPTS } from "../src/features/knowledge-workflows/quiz.js";

/** @template T @param {T} actual @param {T} expected */
function assertEquals(actual, expected) { if (!Object.is(actual, expected)) throw new Error(`Expected ${String(expected)}, received ${String(actual)}.`); }

/** @returns {import("../src/features/knowledge-workflows/extraction.js").KnowledgePoint[]} */
function points() {
  return ["knowledge-a", "knowledge-b"].map((id) => ({ id, sourceId: "source-a", sourceRevision: 1, summary: `Summary ${id}`, normalizedHash: id, evidenceAnchors: [{ url: "https://example.test/a", selector: "#anchor" }], coverageGoalIds: [], mediaCandidates: [], classification: { version: 1, primarySubject: "music", secondarySubjects: ["history"], subcategory: "harmony" }, attribution: { sourceUrl: "https://example.test/a" }, extractionVersion: "knowledge-extraction-v1" }));
}

function setup() {
  /** @type {import("../src/features/knowledge-workflows/quiz.js").QuizAttempt[]} */
  const attempts = [];
  /** @type {unknown[]} */
  const published = [];
  /** @type {unknown[]} */
  const restricted = [];
  /** @type {unknown[]} */
  const purged = [];
  let generatorCalls = 0;
  let evaluatorCalls = 0;
  /** @type {import("../src/features/knowledge-workflows/quiz.js").QuizRepository} */
  const repository = {
      async findPublished() { return {ok:true,value:null}; },
      async appendAttempt(value) { attempts.push(value); return { ok: true, value: null }; },
      async publish(value) { published.push(value); return { ok: true, value: null }; },
      async restrict(value) { restricted.push(value); return { ok: true, value: null }; },
      async discard(value) { purged.push(value); return { ok: true, value: null }; },
      async purge(value) { purged.push(value); return { ok: true, value: null }; },
  };
  const actor = createQuizActorCritic({
    generator: {
      async generate(command) {
        generatorCalls += 1;
        return { ok: true, value: { id: `draft-${generatorCalls}`, knowledgeId: command.knowledge.id, knowledgeRevision: command.knowledge.sourceRevision, kind: "single-choice", prompt: generatorCalls === 1 ? "What is the core concept?" : "Which statement best explains the core concept?", options: ["Correct", "Incorrect"], answer: "Correct", citedEvidenceUrls: ["https://example.test/a"] } };
      },
    },
    reviewer: {
      async evaluate(command) {
        evaluatorCalls += 1;
        const score = command.knowledge.id === "knowledge-a" ? (command.attempt === 1 ? 6 : 9) : 6;
        return { ok: true, value: { score, reasons: ["Tests the cited concept."], feedback: score < 7 ? "Make the prompt more specific." : "Grounded and relevant.", groundingProblems: [] } };
      },
    },
    repository,
    now: () => "2026-08-13T00:00:00.000Z",
    logger: () => {},
    maxAttempts: 3,
  });
  return { actor, repository, attempts, published, restricted, purged, get generatorCalls() { return generatorCalls; }, get evaluatorCalls() { return evaluatorCalls; } };
}

Deno.test("quiz retries preserve published work and fail closed on publication reads", async () => {
  const fixture=setup();
  const scope=[];
  const actor=createQuizActorCritic({generator:{generate:async()=>{throw new Error("MustNotRegenerate");}},reviewer:{evaluate:async()=>{throw new Error("MustNotReevaluate");}},repository:{...fixture.repository,findPublished:async(command)=>{scope.push(command);return {ok:true,value:{status:"published",attempt:2}};}},now:()=>"2026-10-02T00:00:00.000Z",logger:()=>{},maxAttempts:3});
  const command={ownerId:"owner-a",runId:"run-a",points:points()};
  const result=await actor.run(command);
  if (!result.ok) throw new Error(result.error.kind);
  assertEquals(result.value.dispositions.length,2);
  assertEquals(scope.length,2);
  assertEquals(fixture.published.length,0);
  assertEquals(fixture.purged.length,0);
  for (const throws of [false,true]) {
    const failing=createQuizActorCritic({generator:{generate:async()=>{throw new Error("MustNotGenerate");}},reviewer:{evaluate:async()=>{throw new Error("MustNotEvaluate");}},repository:{...fixture.repository,findPublished:async()=>{if(throws)throw new Error("ReadUnavailable");return {ok:false,error:{kind:"ReadUnavailable"}};}},now:()=>"2026-10-02T00:00:00.000Z",logger:()=>{},maxAttempts:3});
    const failed=await failing.run(command);
    if (failed.ok) throw new Error("Expected read failure");
    assertEquals(failed.error.kind,"QuizPersistenceFailed");
  }
});

Deno.test("quiz actor-critic revises after feedback and continues sequentially", async () => {
  const fixture = setup();
  const result = await fixture.actor.run({ ownerId: "owner-a", runId: "run-a", points: points() });
  assertEquals(result.ok, true);
  if (!result.ok) return;
  assertEquals(result.value.dispositions[0].status, "accepted");
  assertEquals(result.value.dispositions[0].attempts, 2);
  assertEquals(result.value.dispositions[1].status, "abandoned");
  assertEquals(result.value.dispositions[1].attempts, 3);
  assertEquals(fixture.published.length, 1);
  assertEquals(fixture.restricted.length, 0);
  assertEquals(fixture.purged.length, 0);
  assertEquals(fixture.generatorCalls, 5);
  assertEquals(fixture.evaluatorCalls, 5);
  assertEquals(fixture.attempts.filter((attempt) => attempt.knowledgeId === "knowledge-b").length, 3);
});

Deno.test("quiz gets three corrective retries, keeps final success and retains knowledge after exhausted pairs", async () => {
  const fixture=setup();
  /** @type {(string|null)[]} */ const feedback=[];
  const actor=createQuizActorCritic({generator:{async generate({knowledge,attempt,feedback:previous}){feedback.push(previous);return {ok:true,value:{id:`draft-${knowledge.id}-${attempt}`,knowledgeId:knowledge.id,knowledgeRevision:knowledge.sourceRevision,kind:"single-choice",prompt:"Which relationship follows from the evidence?",options:["A","B"],answer:"A",citedEvidenceUrls:["https://example.test/a"]}};}},reviewer:{async evaluate({knowledge,attempt}){return {ok:true,value:{score:knowledge.id==="knowledge-a"&&attempt===4?9:6,reasons:["Evidence checked"],feedback:"Make the distinction explicit.",groundingProblems:[]}};}},repository:fixture.repository,now:()=>"2026-10-12T00:00:00.000Z",logger:()=>{},maxAttempts:QUIZ_MAX_ATTEMPTS});
  const result=await actor.run({ownerId:"owner-a",runId:"run-four",points:points()});
  if(!result.ok)throw new Error(result.error.kind);
  assertEquals(fixture.attempts.length,8);
  assertEquals(fixture.published.length,1);
  assertEquals(fixture.purged.length,0);
  assertEquals(result.value.dispositions[0].status,"accepted");
  assertEquals(result.value.dispositions[0].attempts,4);
  assertEquals(result.value.dispositions[1].status,"abandoned");
  assertEquals(result.value.dispositions[1].attempts,4);
  assertEquals(feedback[0],null);
  assertEquals(feedback[1],"Make the distinction explicit.");
  assertEquals(result.value.statistics?.retryRate,1);
  assertEquals(result.value.statistics?.extraAttempts,6);
  assertEquals(result.value.statistics?.quizDropRate,0.5);
  assertEquals(result.value.statistics?.exhaustedDropPoints,1);
  const resumed=createQuizActorCritic({generator:{async generate(){throw new Error("MustNotRegenerate");}},reviewer:{async evaluate(){throw new Error("MustNotReevaluate");}},repository:{...fixture.repository,findPublished:async()=>({ok:true,value:{status:"published",attempt:4}})},now:()=>"2026-10-12T00:00:00.000Z",logger:()=>{},maxAttempts:QUIZ_MAX_ATTEMPTS});
  const reused=await resumed.run({ownerId:"owner-a",runId:"run-four",points:[points()[0]]});
  if(!reused.ok)throw new Error(reused.error.kind);
  assertEquals(reused.value.dispositions[0].attempts,4);
});

Deno.test("four-attempt quiz policy propagates operational failures without dropping knowledge", async () => {
  const fixture=setup();
  const actor=createQuizActorCritic({generator:{async generate(){return {ok:false,error:{kind:"ProviderUnavailable"}};}},reviewer:{async evaluate(){throw new Error("MustNotEvaluate");}},repository:fixture.repository,now:()=>"2026-10-12T00:00:00.000Z",logger:()=>{},maxAttempts:QUIZ_MAX_ATTEMPTS});
  const result=await actor.run({ownerId:"owner-a",runId:"run-external",points:[points()[0]]});
  if(result.ok)throw new Error("Expected operational failure");
  assertEquals(result.error.kind,"QuizGeneratorFailed");
  assertEquals(fixture.purged.length,0);
  assertEquals(fixture.attempts.length,0);
});

Deno.test("quiz generation receives the persisted knowledge classification unchanged", async () => {
  const fixture = setup();
  /** @type {unknown} */
  let received;
  const actor = createQuizActorCritic({
    generator: { async generate(command) { received = command.knowledge.classification; return { ok: true, value: { id: "draft-classification", knowledgeId: command.knowledge.id, knowledgeRevision: command.knowledge.sourceRevision, kind: "single-choice", prompt: "Which relationship applies?", options: ["A", "B"], answer: "A", citedEvidenceUrls: ["https://example.test/a"] } }; } },
    reviewer: { async evaluate() { return { ok: true, value: { score: 9, reasons: ["Grounded"], feedback: "Ready", groundingProblems: [] } }; } },
    repository: fixture.repository, now: () => "2026-08-13T00:00:00.000Z", logger: () => {}, maxAttempts: 3,
  });
  await actor.run({ ownerId: "owner-a", runId: "run-classification", points: [points()[0]] });
  assertEquals(JSON.stringify(received), JSON.stringify(points()[0].classification));
});

Deno.test("quiz actor-critic preserves corrective explanation and rejects malformed feedback", async () => {
  for (const explanation of ["The cited rule distinguishes these cases.", "", 42]) {
    const fixture = setup();
    const actor = createQuizActorCritic({
      generator: { async generate() { return { ok: true, value: { id: "draft-feedback", knowledgeId: "knowledge-a", knowledgeRevision: 1, kind: "single-choice", prompt: "Which case fits the rule?", options: ["A", "B"], answer: "A", explanation, citedEvidenceUrls: ["https://example.test/a"] } }; } },
      reviewer: { async evaluate() { return { ok: true, value: { score: 9, reasons: ["Supported distinction"], feedback: "Ready", groundingProblems: [] } }; } },
      repository: fixture.repository, now: () => "2026-09-08T00:00:00.000Z", logger: () => {}, maxAttempts: 3,
    });
    await actor.run({ ownerId: "owner-a", runId: "run-feedback", points: [points()[0]] });
    assertEquals(fixture.published.length, typeof explanation === "string" && explanation.length > 0 ? 1 : 0);
    if (fixture.published.length > 0) assertEquals(/** @type {{ draft: { explanation: string } }} */ (fixture.published[0]).draft.explanation, explanation);
  }
});

Deno.test("quiz actor-critic rejects ungrounded drafts before evaluator dispatch", async () => {
  const fixture = setup();
  const actor = createQuizActorCritic({
    generator: { async generate() { return { ok: true, value: { id: "draft-ungrounded", knowledgeId: "knowledge-a", knowledgeRevision: 1, kind: "single-choice", prompt: "General question", options: ["A", "B"], answer: "A", citedEvidenceUrls: ["https://other.test/unknown"] } }; } },
    reviewer: { async evaluate() { throw new Error("must not evaluate"); } },
    repository: fixture.repository,
    now: () => "2026-08-13T00:00:00.000Z",
    logger: () => {},
    maxAttempts: 3,
  });
  const result = await actor.run({ ownerId: "owner-a", runId: "run-b", points: [points()[0]] });
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.value.dispositions[0].failureKind, "QuizDraftUngrounded");
    assertEquals(fixture.attempts.length, 3);
    assertEquals(fixture.restricted.length, 0);
    assertEquals(fixture.purged.length, 0);
  }
});

Deno.test("quiz actor-critic rejects duplicate choice meanings and duplicate answers before evaluation", async () => {
  for (const draft of [
    { kind: "single-choice", options: ["Method A maps to term B", " method a maps to term b "], answer: "Method A maps to term B" },
    { kind: "multiple-choice", options: ["A applies to B", "C applies to D"], answer: ["A applies to B", "A applies to B"] },
    { kind: "multiple-choice", options: ["A applies to B", "C applies to D"], answer: ["A applies to B", "C applies to D"] },
  ]) {
    const fixture = setup();
    const actor = createQuizActorCritic({
      generator: { async generate() { return { ok: true, value: { id: "duplicate", knowledgeId: "knowledge-a", knowledgeRevision: 1, prompt: "Which mapping applies?", citedEvidenceUrls: ["https://example.test/a"], ...draft } }; } },
      reviewer: { async evaluate() { throw new Error("invalid draft reached evaluator"); } },
      repository: fixture.repository, now: () => "2026-09-17T00:00:00.000Z", logger: () => {}, maxAttempts: 3,
    });
    const result = await actor.run({ ownerId: "owner-a", runId: "run-duplicate-options", points: [points()[0]] });
    assertEquals(result.ok, false);
    assertEquals(fixture.published.length, 0);
    assertEquals(fixture.attempts.length, 0);
    assertEquals(fixture.purged.length, 0);
    if(!result.ok)assertEquals(result.error.kind, "QuizDraftSchemaInvalid");
  }
});

Deno.test("quiz actor-critic accepts ordered multi-blank drafts and rejects malformed blank boundaries", async () => {
  const base = { id: "draft-blanks", knowledgeId: "knowledge-a", knowledgeRevision: 1, kind: "fill-blank", prompt: "A ____ resolves to the ____.", options: [], answer: ["dominant", "tonic"], explanation: "The dominant resolves to the tonic.", citedEvidenceUrls: ["https://example.test/a"] };
  for (const blanks of [
    [{ id: "blank-1", acceptedAnswers: ["dominant"] }, { id: "blank-2", acceptedAnswers: ["tonic", "home tone"] }],
    [{ id: "blank-1", acceptedAnswers: ["tonic"] }, { id: "blank-2", acceptedAnswers: ["dominant"] }],
    [{ id: "dominant", acceptedAnswers: ["dominant"] }, { id: "blank-2", acceptedAnswers: ["tonic"] }],
    [{ id: "same", acceptedAnswers: ["dominant"] }, { id: "same", acceptedAnswers: ["tonic"] }],
  ]) {
    const fixture = setup();
    let evaluations = 0;
    const actor = createQuizActorCritic({
      generator: { async generate() { return { ok: true, value: { ...base, blanks } }; } },
      reviewer: { async evaluate() { evaluations += 1; return { ok: true, value: { score: 9, reasons: ["Grounded"], feedback: "Ready", groundingProblems: [] } }; } },
      repository: fixture.repository, now: () => "2026-09-18T00:00:00.000Z", logger: () => {}, maxAttempts: 3,
    });
    await actor.run({ ownerId: "owner-a", runId: "run-blanks", points: [points()[0]] });
    assertEquals(fixture.published.length, blanks[0].id === "blank-1" && blanks[0].acceptedAnswers[0] === "dominant" ? 1 : 0);
    assertEquals(evaluations, fixture.published.length);
  }
});

Deno.test("quiz actor enforces three answers and five MCQ options before model review", async () => {
  for (const kind of ["single-choice", "multiple-choice", "fill-blank"]) {
    for (const count of [3, 4, 6]) {
      const fixture = setup();
      let evaluations = 0;
      const terms = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta"];
      const answers = terms.slice(0, count);
      const generated = { id: "bounded-draft", knowledgeId: "knowledge-a", knowledgeRevision: 1, kind, prompt: kind === "fill-blank" ? answers.map(() => "____").join(" then ") : "Which statements apply?", options: kind === "fill-blank" ? [] : terms.slice(0, kind === "single-choice" ? count : Math.max(5, count)), answer: kind === "single-choice" ? "alpha" : answers, ...(kind === "fill-blank" ? { blanks: answers.map((answer, index) => ({ id: `blank-${index + 1}`, acceptedAnswers: [answer] })) } : {}), citedEvidenceUrls: ["https://example.test/a"] };
      const actor = createQuizActorCritic({ generator: { generate: async () => ({ ok: true, value: generated }) }, reviewer: { evaluate: async () => { evaluations++; return { ok: true, value: { score: 9, reasons: ["Supported"], feedback: "Ready", groundingProblems: [] } }; } }, repository: fixture.repository, now: () => "2026-10-18T00:00:00.000Z", logger: () => {}, maxAttempts: 3, technicalRetries: false });
      await actor.run({ ownerId: "owner-a", runId: "run-bounds", points: [points()[0]] });
      const valid = kind !== "multiple-choice" || count < 6;
      assertEquals(fixture.published.length, valid ? 1 : 0);
      assertEquals(evaluations, valid ? 1 : 0);
      if (valid) {
        const published = /** @type {{draft:import("../src/features/knowledge-workflows/quiz.js").QuestionDraft}} */ (fixture.published[0]);
        assertEquals(published.draft.options.length <= 5, true);
        assertEquals((published.draft.blanks?.length ?? 0) <= 3, true);
        if (kind === "fill-blank" && count > 3) assertEquals(published.draft.prompt.includes("delta"), true);
      }
    }
  }
});

Deno.test("accepted quiz kinds are published directly after actor-critic approval", async () => {
  const fixture = setup();
  const actor = createQuizActorCritic({
    generator: { async generate(command) { return { ok: true, value: { id: "draft-response", knowledgeId: command.knowledge.id, knowledgeRevision: 1, kind: "short-response", prompt: "Explain the specific concept.", options: [], answer: "A specific explanation", citedEvidenceUrls: ["https://example.test/a"] } }; } },
    reviewer: { async evaluate() { return { ok: true, value: { score: 10, reasons: ["Precise"], feedback: "Ready for review.", groundingProblems: [] } }; } },
    repository: fixture.repository,
    now: () => "2026-08-13T00:00:00.000Z",
    logger: () => {},
    maxAttempts: 3,
  });
  const result = await actor.run({ ownerId: "owner-a", runId: "run-review", points: [points()[0]] });
  assertEquals(result.ok, true);
  assertEquals(fixture.published.length, 1);
  assertEquals(/** @type {{ readonly status: string }} */ (fixture.published[0]).status, "published");
  if (result.ok) assertEquals(result.value.dispositions[0].publicationStatus, "published");
});

Deno.test("malformed evaluator output preserves knowledge and the valid draft after technical exhaustion", async () => {
  for (const grade of [{score:10},{score:9,reasons:["Synthetic supported reason"],feedback:["Use one concise answer term."],groundingProblems:[]}]) {
    const fixture = setup();
    const actor = createQuizActorCritic({
      generator: { async generate(command) { return { ok: true, value: { id: `draft-${command.attempt}`, knowledgeId: command.knowledge.id, knowledgeRevision: 1, kind: "single-choice", prompt: "Specific?", options: ["yes", "no"], answer: "yes", citedEvidenceUrls: ["https://example.test/a"] } }; } },
      reviewer: { async evaluate() { return { ok: true, value: grade }; } },
      repository: fixture.repository,
      now: () => "2026-08-13T00:00:00.000Z",
      logger: () => {},
      maxAttempts: 3,
    });
    const result = await actor.run({ ownerId: "owner-a", runId: "run-malformed", points: [points()[0]] });
    assertEquals(result.ok, false);
    assertEquals(fixture.attempts.length, 0);
    assertEquals(fixture.restricted.length, 0);
    assertEquals(fixture.published.length, 0);
    assertEquals(fixture.purged.length, 0);
    if (result.ok) throw new Error("Expected retained technical failure");
    assertEquals(result.error.kind, "QuizEvaluatorOutputInvalid");
    assertEquals("technicalRetriesExhausted" in result.error && result.error.technicalRetriesExhausted, true);
  }
});

Deno.test("legacy delayed purge still refuses before restriction expiry", async () => {
  const fixture = setup();
  const early = await fixture.actor.purgeExpired({ ownerId: "owner-a", runId: "run-legacy", knowledgeId: "knowledge-a", restrictedUntil: "2026-08-14T00:00:00.000Z", before: "2026-08-13T00:00:00.000Z" });
  assertEquals(early.ok, false);
  if (!early.ok) assertEquals(early.error.kind, "QuizPurgeBeforeRestrictionExpired");
  const expired = await fixture.actor.purgeExpired({ ownerId: "owner-a", runId: "run-legacy", knowledgeId: "knowledge-a", restrictedUntil: "2026-08-14T00:00:00.000Z", before: "2026-08-14T00:00:00.000Z" });
  assertEquals(expired.ok, true);
  assertEquals(fixture.purged.length, 1);
});

Deno.test("quiz actor-critic abandons a duplicate knowledge point without evaluation", async () => {
  const fixture = setup();
  const actor = createQuizActorCritic({
    generator: { async generate() { return { ok: false, error: { kind: "QuizDuplicate" } }; } },
    reviewer: { async evaluate() { throw new Error("must not evaluate"); } },
    repository: fixture.repository,
    now: () => "2026-08-13T00:00:00.000Z",
    logger: () => {},
    maxAttempts: 3,
  });
  const result = await actor.run({ ownerId: "owner-a", runId: "run-duplicate", points: [points()[0]] });
  assertEquals(result.ok, true);
  assertEquals(fixture.published.length, 0);
  assertEquals(fixture.purged.length, 0);
});

Deno.test("quiz actor-critic abandons a duplicate publication race and continues", async () => {
  const fixture = setup();
  const actor = createQuizActorCritic({
    generator: { async generate(command) { return { ok: true, value: { id: "draft-race", knowledgeId: command.knowledge.id, knowledgeRevision: 1, kind: "single-choice", prompt: "Specific?", options: ["yes", "no"], answer: "yes", citedEvidenceUrls: ["https://example.test/a"] } }; } },
    reviewer: { async evaluate() { return { ok: true, value: { score: 9, reasons: ["Precise"], feedback: "Ready.", groundingProblems: [] } }; } },
    repository: { ...fixture.repository, async publish() { return { ok: false, error: { kind: "QuizDuplicate" } }; } },
    now: () => "2026-08-13T00:00:00.000Z",
    logger: () => {},
    maxAttempts: 3,
  });
  const result = await actor.run({ ownerId: "owner-a", runId: "run-duplicate-race", points: [points()[0]] });
  assertEquals(result.ok, true);
  if (result.ok) assertEquals(result.value.dispositions[0].failureKind, "QuizDuplicate");
  assertEquals(fixture.restricted.length, 0);
  assertEquals(fixture.purged.length, 0);
});

Deno.test("quiz actor-critic reports discard persistence failure", async () => {
  const fixture = setup();
  const actor = createQuizActorCritic({
    generator: { async generate() { return { ok: true, value: { id:"unsafe",knowledgeId:"knowledge-a",knowledgeRevision:1,kind:"single-choice",prompt:"Which?",options:["A","B"],answer:"A",citedEvidenceUrls:["https://example.test/a"] } }; } },
    reviewer: { async evaluate() { return {ok:true,value:{score:9,reasons:["Source conflict"],feedback:"Unsupported current claim.",groundingProblems:[],knowledgeGroundingProblems:["Summary knowledge-a is absent from the source."]}}; } },
    repository: { ...fixture.repository, async discard() { return { ok: false, error: { kind: "database-unavailable" } }; } },
    now: () => "2026-08-13T00:00:00.000Z",
    logger: () => {},
    maxAttempts: 3,
  });
  const result = await actor.run({ ownerId: "owner-a", runId: "run-discard-failure", points: [points()[0]] });
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error.kind, "QuizPurgeFailed");
});
