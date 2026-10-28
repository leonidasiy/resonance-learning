import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readdir, readFile } from "node:fs/promises";
import {
  D1KnowledgeContentRepository,
  D1QuizRepository,
} from "../worker/knowledge-workflow-content-d1.js";
import { D1KnowledgeWorkflowRepository } from "../worker/knowledge-workflow-d1.js";
import { createKnowledgeWorkflowService } from "../src/features/knowledge-workflows/workflow.js";
import { createQuizActorCritic, isKnowledgeQuizEvaluation, normalizeKnowledgeQuizEvaluation } from "../src/features/knowledge-workflows/quiz.js";
import { assembleQuizPair, isQuizPairDraft, quizPairDraftValidationIssues, quizPairSchema } from "../src/features/knowledge-workflows/quiz-pair.js";
import { questionGeneratorPrompt, questionEvaluatorPrompt, questionEvaluationSchema } from "../worker/knowledge-workflow-runtime.js";
import { createLearningBatchService } from "../worker/learning-batches-d1.js";

async function fixture() {
  const db = new DatabaseSync(":memory:");
  const directory = new URL("../worker/migrations/", import.meta.url);
  for (
    const name of (await readdir(directory)).filter((name) =>
      name.endsWith(".sql")
    ).sort()
  ) db.exec(await readFile(new URL(name, directory), "utf8"));
  const database = {
    prepare(sql) {
      return {
        bind(...values) {
          const s = db.prepare(sql);
          return {
            first: async () => s.get(...values) ?? null,
            all: async () => ({ success: true, results: s.all(...values) }),
            run: async () => ({
              success: true,
              meta: { changes: Number(s.run(...values).changes) },
            }),
            execute: () => ({
              success: true,
              meta: { changes: Number(s.run(...values).changes) },
            }),
          };
        },
      };
    },
    async batch(statements) {
      db.exec("BEGIN");
      try {
        const result = statements.map((s) => s.execute());
        db.exec("COMMIT");
        return result;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
  const now = () => "2026-10-02T12:00:00.000Z";
  db.prepare(
    "INSERT INTO library_sources (owner_id,source_id,submitted_url,canonical_url,title,description,adapter_json,identity_evidence_json,state,approved_at,updated_at,revision) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
  ).run(
    "owner",
    "source",
    "https://example.test/source",
    "https://example.test/source",
    "Synthetic source",
    "Offline test",
    "{}",
    "[]",
    "active",
    now(),
    now(),
    1,
  );
  const service = createKnowledgeWorkflowService(
    new D1KnowledgeWorkflowRepository({ database, logger: () => {} }),
    {
      now,
      createId: () => "run",
      logger: () => {},
    },
  );
  const created = await service.createRun({
    ownerId: "owner",
    sourceId: "source",
    sourceRevision: 1,
    canonicalSourceIdentity: "https://example.test/source",
    contentSignature: "content",
    configDigests: {},
    idempotencyKey: "create",
  });
  assert.ok(created.ok);
  return {
    db,
    database,
    now,
    repository: new D1QuizRepository({ database, logger: () => {}, now }),
  };
}

test("publication failure retries retain old attempts, publish once and cascade history on erase", async () => {
  const f = await fixture();
  try {
    const point = {
      id: "point",
      sourceId: "source",
      sourceRevision: 1,
      summary: "A cadence closes a phrase.",
      normalizedHash: "cadence",
      evidenceAnchors: [{
        url: "https://example.test/source",
        selector: "main",
      }],
      coverageGoalIds: [],
      mediaCandidates: [],
      attribution: { sourceUrl: "https://example.test/source" },
      extractionVersion: "v1",
    };
    let generations = 0, failPublication = true;
    assert.deepEqual(
      await new D1KnowledgeContentRepository({
        database: f.database,
        logger: () => {},
      }).appendKnowledgePoint(point, "owner", "run", f.now()),
      { ok: true, value: null },
    );
    const repository = {
      findPublished: (s) => f.repository.findPublished(s),
      appendAttempt: (a) => f.repository.appendAttempt(a),
      publish: (c) =>
        failPublication
          ? Promise.resolve({
            ok: false,
            error: { kind: "SyntheticPublicationFailure" },
          })
          : f.repository.publish(c),
      restrict: (c) => f.repository.restrict(c),
      discard: (c) => f.repository.discard(c),
      purge: (c) => f.repository.purge(c),
    };
    const actor = createQuizActorCritic({
      repository,
      now: f.now,
      logger: () => {},
      maxAttempts: 3,
      generator: {
        generate: async () => ({
          ok: true,
          value: {
            id: `draft-${++generations}`,
            knowledgeId: "point",
            knowledgeRevision: 1,
            kind: "single-choice",
            prompt: "What closes a phrase?",
            options: ["Cadence", "Pickup"],
            answer: "Cadence",
            explanation: "A cadence closes the phrase.",
            citedEvidenceUrls: ["https://example.test/source"],
          },
        }),
      },
      reviewer: {
        evaluate: async () => ({
          ok: true,
          value: {
            score: 9,
            reasons: ["Grounded"],
            feedback: "Keep",
            groundingProblems: [],
          },
        }),
      },
    });
    const command = { ownerId: "owner", runId: "run", points: [point] };
    const first = await actor.run(command);
    assert.equal(first.ok, false);
    const original = f.db.prepare(
      "SELECT * FROM knowledge_workflow_quiz_attempts",
    ).get();
    failPublication = false;
    assert.deepEqual(await actor.run(command), {
      ok: true,
      value: {
        statistics:{inputPoints:1,attemptedPoints:1,retriedPoints:0,extraAttempts:0,retryRate:0,quizDroppedPoints:0,quizDropRate:0,exhaustedDropPoints:0,preferenceDroppedPoints:0},
        dispositions: [{
          knowledgeId: "point",
          status: "accepted",
          publicationStatus: "published",
          attempts: 1,
          failureKind: null,
          restrictedUntil: null,
        }],
      },
    });
    assert.deepEqual(
      f.db.prepare("SELECT * FROM knowledge_workflow_quiz_attempts").get(),
      original,
    );
    assert.equal(
      f.db.prepare(
        "SELECT COUNT(*) AS n FROM knowledge_workflow_quiz_retry_attempts",
      ).get().n,
      2,
    );
    assert.equal(
      f.db.prepare("SELECT COUNT(*) AS n FROM knowledge_workflow_quizzes").get()
        .n,
      1,
    );
    assert.deepEqual(await actor.run(command), {
      ok: true,
      value: {
        statistics:{inputPoints:1,attemptedPoints:1,retriedPoints:0,extraAttempts:0,retryRate:0,quizDroppedPoints:0,quizDropRate:0,exhaustedDropPoints:0,preferenceDroppedPoints:0},
        dispositions: [{
          knowledgeId: "point",
          status: "accepted",
          publicationStatus: "published",
          attempts: 1,
          failureKind: null,
          restrictedUntil: null,
        }],
      },
    });
    assert.equal(generations, 2);
    assert.deepEqual(
      await f.repository.findPublished({
        ownerId: "another-owner",
        runId: "run",
        knowledgeId: "point",
      }),
      { ok: true, value: null },
    );
    f.db.prepare(
      "DELETE FROM knowledge_workflow_quiz_attempts WHERE owner_id=? AND knowledge_id=?",
    ).run("owner", "point");
    assert.equal(
      f.db.prepare(
        "SELECT COUNT(*) AS n FROM knowledge_workflow_quiz_retry_attempts",
      ).get().n,
      0,
    );
    assert.deepEqual(f.db.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    f.db.close();
  }
});

test("paired quiz publication and learner review keep answers private and update knowledge progress once", async () => {
  const f = await fixture();
  try {
    const point = { id: "point", sourceId: "source", sourceRevision: 1, summary: "A tonic is the tonal center.", normalizedHash: "tonic", evidenceAnchors: [{ url: "https://example.test/source", selector: "main" }], coverageGoalIds: [], mediaCandidates: [], attribution: { sourceUrl: "https://example.test/source" }, extractionVersion: "v1" };
    const content = new D1KnowledgeContentRepository({ database: f.database, logger: () => {} });
    assert.deepEqual(await content.appendKnowledgePoint(point, "owner", "run", f.now()), { ok: true, value: null });
    f.db.prepare("UPDATE knowledge_workflow_runs SET state = 'completed' WHERE owner_id = 'owner' AND run_id = 'run'").run();
    const pair = assembleQuizPair({ knowledgeId: "point", knowledgeRevision: 1, canonicalAnswers: ["tonic"], citedEvidenceUrls: ["https://example.test/source"], multipleChoice: { prompt: "Which pitch is the tonal center?", options: [{ key: "choice-tonic", text: "Tonic" }, { key: "choice-dominant", text: "Dominant" }], correctOptionKeys: ["choice-tonic"], correctOptionAnswers: [{ key: "choice-tonic", canonicalAnswer: "tonic" }], explanation: "The tonic is the tonal center." }, fillBlank: { prompt: "The tonal center is the ____.", blanks: [{ id: "blank-1", canonicalAnswer: "tonic", acceptedAnswers: ["tonic", "tonic note"] }], explanation: "The tonic names the tonal center." } }, "quiz:source:point:r1");
    const draft = { id: pair.multipleChoice.id, knowledgeId: "point", knowledgeRevision: 1, kind: "single-choice", prompt: pair.multipleChoice.prompt, options: ["Tonic", "Dominant"], answer: "Tonic", explanation: pair.multipleChoice.explanation, citedEvidenceUrls: pair.citedEvidenceUrls, pairedQuiz: pair };
    f.db.exec("CREATE TRIGGER fail_pair_task BEFORE INSERT ON learning_generation_tasks WHEN NEW.task_id = 'knowledge-workflow-task:run:point' BEGIN SELECT RAISE(ABORT, 'synthetic pair publication failure'); END;");
    assert.equal((await f.repository.publish({ ownerId: "owner", runId: "run", knowledge: point, draft, score: 9, attempt: 1, status: "published" })).ok, false);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM knowledge_workflow_quizzes WHERE owner_id = 'owner' AND knowledge_id = 'point'").get().n, 0);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM learning_generation_jobs WHERE owner_id = 'owner' AND item_id = 'point'").get().n, 0);
    f.db.exec("DROP TRIGGER fail_pair_task;");
    assert.deepEqual(await f.repository.publish({ ownerId: "owner", runId: "run", knowledge: point, draft, score: 9, attempt: 1, status: "published" }), { ok: true, value: null });
    const taskId = "knowledge-workflow-task:run:point";
    f.db.prepare("INSERT INTO learner_knowledge_state (owner_id, knowledge_id, source_id, view_count, studied_at, updated_at) VALUES ('owner', 'point', 'source', 1, ?, ?)").run(f.now(), f.now());
    f.db.prepare("INSERT INTO learner_review_batches (owner_id, batch_id, learning_day, status, question_ids_json, revision, idempotency_key, created_at) VALUES ('owner', 'review-pair', '2026-10-02', 'open', ?, 1, 'pair-review', ?)").run(JSON.stringify([taskId]), f.now());
    const service = createLearningBatchService({ database: f.database, now: f.now, logger: () => {}, semanticGrader: async () => ({ ok: true, value: [true] }) });
    const loaded = await service.loadReview("owner", "2026-10-02");
    assert.equal(loaded.ok, true);
    if (!loaded.ok) return;
    const question = loaded.value.questions[0];
    assert.equal(question?.pairedVariants?.length, 2);
    assert.equal(JSON.stringify(question).includes("acceptedAnswers"), false);
    assert.equal(JSON.stringify(question).includes("correctChoiceIds"), false);
    assert.equal(JSON.stringify(question).includes("explanation"), false);
    const command = { ownerId: "owner", batchId: "review-pair", questionId: taskId, questionRevision: 1, selectedChoiceIds: ["choice-tonic"], pairedBlankAnswers: [{ id: "blank-1", text: "Tonic" }], idempotencyKey: "answer-pair" };
    f.db.exec("CREATE TRIGGER fail_pair_command BEFORE INSERT ON learner_batch_commands WHEN NEW.idempotency_key = 'answer-pair' BEGIN SELECT RAISE(ABORT, 'synthetic rollback'); END;");
    const failedWrite = await service.answerReview(command);
    assert.equal(failedWrite.ok, false);
    assert.equal(f.db.prepare("SELECT review_count FROM learner_knowledge_state WHERE owner_id = 'owner' AND knowledge_id = 'point'").get().review_count, 0);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM learner_review_answers WHERE owner_id = 'owner' AND question_id = ?").get(taskId).n, 0);
    f.db.exec("DROP TRIGGER fail_pair_command;");
    const answer = await service.answerReview(command);
    assert.equal(answer.ok, true);
    assert.equal(f.db.prepare("SELECT review_count FROM learner_knowledge_state WHERE owner_id = 'owner' AND knowledge_id = 'point'").get().review_count, 1);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM learner_review_answers WHERE owner_id = 'owner' AND question_id = ?").get(taskId).n, 1);
    assert.deepEqual(await service.answerReview(command), answer);
    assert.equal(f.db.prepare("SELECT review_count FROM learner_knowledge_state WHERE owner_id = 'owner' AND knowledge_id = 'point'").get().review_count, 1);
  } finally { f.db.close(); }
});

test("concurrent paired answers close a migrated five-question review batch exactly once", async () => {
  const f = await fixture();
  try {
    const content = new D1KnowledgeContentRepository({ database: f.database, logger: () => {} });
    const taskIds = [];
    const questions = [];
    for (let index = 1; index <= 5; index += 1) {
      const knowledgeId = `pair-${index}`;
      const answerText = `answer ${index}`;
      const point = { id: knowledgeId, sourceId: "source", sourceRevision: 1, summary: `Synthetic paired knowledge ${index}.`, normalizedHash: `pair-hash-${index}`, evidenceAnchors: [{ url: "https://example.test/source", selector: "main" }], coverageGoalIds: [], mediaCandidates: [], attribution: { sourceUrl: "https://example.test/source" }, extractionVersion: "v1" };
      assert.deepEqual(await content.appendKnowledgePoint(point, "owner", "run", f.now()), { ok: true, value: null });
      const pair = assembleQuizPair({ knowledgeId, knowledgeRevision: 1, canonicalAnswers: [answerText], citedEvidenceUrls: ["https://example.test/source"], multipleChoice: { prompt: `Which option identifies ${knowledgeId}?`, options: [{ key: `choice-${index}-correct`, text: answerText }, { key: `choice-${index}-wrong`, text: "Other" }], correctOptionKeys: [`choice-${index}-correct`], correctOptionAnswers: [{ key: `choice-${index}-correct`, canonicalAnswer: answerText }], explanation: `${answerText} identifies ${knowledgeId}.` }, fillBlank: { prompt: `${knowledgeId} is ____ .`, blanks: [{ id: "blank-1", canonicalAnswer: answerText, acceptedAnswers: [answerText] }], explanation: `${answerText} identifies ${knowledgeId}.` } }, `quiz:source:${knowledgeId}:r1`);
      const draft = { id: pair.multipleChoice.id, knowledgeId, knowledgeRevision: 1, kind: "single-choice", prompt: pair.multipleChoice.prompt, options: [answerText, "Other"], answer: answerText, explanation: pair.multipleChoice.explanation, citedEvidenceUrls: pair.citedEvidenceUrls, pairedQuiz: pair };
      assert.deepEqual(await f.repository.publish({ ownerId: "owner", runId: "run", knowledge: point, draft, score: 9, attempt: 1, status: "published" }), { ok: true, value: null });
      const taskId = `knowledge-workflow-task:run:${knowledgeId}`;
      taskIds.push(taskId);
      questions.push({ taskId, knowledgeId, choiceId: `choice-${index}-correct`, answerText });
      f.db.prepare("INSERT INTO learner_knowledge_state (owner_id, knowledge_id, source_id, view_count, studied_at, updated_at) VALUES ('owner', ?, 'source', 1, ?, ?)").run(knowledgeId, f.now(), f.now());
    }
    f.db.prepare("UPDATE knowledge_workflow_runs SET state = 'completed' WHERE owner_id = 'owner' AND run_id = 'run'").run();
    f.db.prepare("INSERT INTO learner_review_batches (owner_id, batch_id, learning_day, status, question_ids_json, revision, idempotency_key, created_at) VALUES ('owner', 'review-race', '2026-10-02', 'open', ?, 1, 'review-race-key', ?)").run(JSON.stringify(taskIds), f.now());
    const service = createLearningBatchService({ database: f.database, now: f.now, logger: () => {} });
    const answer = (question, idempotencyKey) => service.answerReview({ ownerId: "owner", batchId: "review-race", questionId: question.taskId, questionRevision: 1, selectedChoiceIds: [question.choiceId], pairedBlankAnswers: [{ id: "blank-1", text: question.answerText }], idempotencyKey });

    for (const question of questions.slice(0, 3)) {
      const result = await answer(question, `answer-${question.taskId}`);
      assert.equal(result.ok, true, JSON.stringify(result.error));
      if (result.ok) assert.equal(result.value.completed, false);
    }
    assert.equal(f.db.prepare("SELECT COUNT(*) AS count FROM learner_review_answers WHERE owner_id = 'owner' AND batch_id = 'review-race'").get().count, 3);

    const finalCommands = questions.slice(3).map((question) => answer(question, `answer-${question.taskId}`));
    const outcomes = await Promise.all(finalCommands);
    assert(outcomes.every((outcome) => outcome.ok), JSON.stringify(outcomes));
    assert.equal(outcomes.filter((outcome) => outcome.ok && outcome.value.completed).length, 1);
    const completedBatch = f.db.prepare("SELECT status, revision, completed_at FROM learner_review_batches WHERE owner_id = 'owner' AND batch_id = 'review-race'").get();
    assert.equal(completedBatch.status, "completed");
    assert.equal(completedBatch.revision, 2);
    assert.equal(completedBatch.completed_at, f.now());
    assert.equal(f.db.prepare("SELECT COUNT(*) AS count FROM learner_review_answers WHERE owner_id = 'owner' AND batch_id = 'review-race'").get().count, 5);

    const replay = await answer(questions[4], `answer-${questions[4].taskId}`);
    const original = outcomes[1];
    assert.deepEqual(replay, original);
    assert.equal(f.db.prepare("SELECT SUM(review_count) AS count FROM learner_knowledge_state WHERE owner_id = 'owner'").get().count, 5);
  } finally { f.db.close(); }
});

test("retry audit failure rolls back its legacy parent and reports persistence failure", async () => {
  const f = await fixture();
  try {
    f.db.exec(
      "CREATE TRIGGER reject_retry BEFORE INSERT ON knowledge_workflow_quiz_retry_attempts BEGIN SELECT RAISE(ABORT,'SyntheticAuditFailure'); END",
    );
    const result = await f.repository.appendAttempt({
      id: "new",
      ownerId: "owner",
      runId: "run",
      knowledgeId: "point",
      attempt: 1,
      draftId: null,
      score: null,
      feedback: null,
      failureKind: "QuizGeneratorFailed",
      createdAt: f.now(),
    });
    assert.deepEqual(result, {
      ok: false,
      error: { kind: "QuizPersistenceFailed" },
    });
    assert.equal(
      f.db.prepare("SELECT COUNT(*) AS n FROM knowledge_workflow_quiz_attempts")
        .get().n,
      0,
    );
  } finally {
    f.db.close();
  }
});


// Synthetic contract checks do not establish model quality or source-derived learning results.
test("paired quiz canonical-only answers are valid; optional synonyms cannot be cosmetic aliases", () => {
  const draft = {
    knowledgeId: "synthetic-point", knowledgeRevision: 1,
    canonicalAnswers: ["L2"], citedEvidenceUrls: ["https://example.test/source"],
    multipleChoice: { prompt: "Which synthetic label completes the mapping?", options: [{key:"choice-a",text:"Second label"},{key:"choice-b",text:"First label"}], correctOptionKeys:["choice-a"],correctOptionAnswers:[{key:"choice-a",canonicalAnswer:"L2"}],explanation:"Synthetic mapping." },
    fillBlank: { prompt:"The synthetic mapping uses ____.",blanks:[{id:"blank-1",canonicalAnswer:"L2",acceptedAnswers:["L2"]}],explanation:"Synthetic mapping." },
  };
  assert.equal(isQuizPairDraft(draft), true);
  const synonym = structuredClone(draft); synonym.fillBlank.blanks[0].acceptedAnswers.push("second label");
  assert.equal(isQuizPairDraft(synonym), true);
  for (const cosmetic of ["L₂", "Ｌ２", "l2", " L2 "]) {
    const duplicate = structuredClone(draft); duplicate.fillBlank.blanks[0].acceptedAnswers.push(cosmetic);
    assert.equal(isQuizPairDraft(duplicate), false);
    assert.throws(() => assembleQuizPair(duplicate, "quiz:synthetic"), /invalid/);
  }
  assert.match(questionGeneratorPrompt, /paired-question-generator-v10-source-language/);
  for (const guidance of [questionGeneratorPrompt, quizPairSchema(true).schema.properties.fillBlank.properties.blanks.items.properties.acceptedAnswers.description]) {
    assert.match(guidance, /exact canonical answer alone is sufficient/);
    assert.match(guidance, /Synonyms are optional/);
    assert.match(guidance, /never cosmetic glyph or Unicode variants/);
    assert.match(guidance, /NFKC/);
  }
  assert.equal(quizPairSchema(true).schema.properties.fillBlank.properties.blanks.items.properties.acceptedAnswers.minItems, 1);
});

for (const branch of ["typed-schema-failure", "invalid-draft", "legacy-thrown-generator"]) {
  test(`invalid quiz feedback keeps aliases optional using a separate four-attempt ${branch} technical budget`, async () => {
    const inputs = [], attempts = []; let discarded = 0, evaluated = 0;
    const point = {id:"synthetic-point",sourceId:"source",sourceRevision:1,summary:"A synthetic mapping.",evidenceAnchors:[{url:"https://example.test/source",selector:"main"}]};
    const maxAttempts = branch === "legacy-thrown-generator" ? 3 : 2;
    const actor = createQuizActorCritic({
      maxAttempts, now:()=>"2026-10-02T12:00:00.000Z",logger:()=>{},
      repository:{findPublished:async()=>({ok:true,value:null}),appendAttempt:async a=>{attempts.push(a);return {ok:true,value:null};},publish:async()=>{throw Error("Invalid draft must not publish.");},discard:async()=>{discarded++;return {ok:true,value:null};},purge:async()=>({ok:true,value:null})},
      generator:{generate:async input=>{inputs.push(input);if(branch==="legacy-thrown-generator")throw Error("Synthetic invalid provider envelope.");return branch==="typed-schema-failure"?{ok:false,error:{kind:"QuizDraftSchemaInvalid"}}:{ok:true,value:{}};}},
      reviewer:{evaluate:async()=>{evaluated++;throw Error("Invalid draft must not reach critic.");}},
    });
    const result = await actor.run({ownerId:"owner",runId:"run",points:[point]});
    assert.deepEqual(result,{ok:false,error:{kind:branch==="legacy-thrown-generator"?"QuizGeneratorFailed":"QuizDraftSchemaInvalid",technicalRetriesExhausted:true,technicalAttempts:4}});
    assert.equal(inputs.length,4);assert.equal(attempts.length,0);
    assert.deepEqual(inputs.map(input=>[input.attempt,input.technicalAttempt]),[[1,1],[1,2],[1,3],[1,4]]);
    assert.equal(inputs[0].feedback,null);
    for (const input of inputs.slice(1)) {
      if(branch==="legacy-thrown-generator"){assert.equal(input.feedback,null);continue;}
      assert.match(input.feedback,/exact canonical answer alone is sufficient/);
      assert.match(input.feedback,/Synonyms are optional/);
      assert.match(input.feedback,/never cosmetic glyph or Unicode variants/);
      assert.match(input.feedback,/NFKC/);
    }
    assert.equal(evaluated,0);assert.equal(discarded,0);
  });
}


test("fresh native quiz criticism requires typed knowledge grounding while legacy evaluation remains readable", () => {
  const legacy={score:9,reasons:["Synthetic support."],feedback:"Keep.",groundingProblems:[]};
  assert.equal(isKnowledgeQuizEvaluation(legacy,{summary:"Synthetic support."}),false);
  assert.equal(isKnowledgeQuizEvaluation({...legacy,knowledgeGroundingProblems:[]},{summary:"Synthetic support."}),true);
  for(const invalid of [null,"safe",{},[null],[""]])assert.equal(isKnowledgeQuizEvaluation({...legacy,knowledgeGroundingProblems:invalid},{summary:"Synthetic support."}),false);
  assert.equal(questionEvaluationSchema.name,"quiz_evaluation_v3");
  assert(questionEvaluationSchema.schema.required.includes("knowledgeGroundingProblems"));
  assert.match(questionEvaluatorPrompt,/paired-question-evaluator-v14-source-language/);
  assert.match(questionEvaluatorPrompt,/Quiz regeneration changes only the quiz, never that retained summary/);
});

for(const fault of ["knowledge","draft-only","legacy"])test(`quiz critic ${fault} grounding preserves the correct point or draft boundary`, async()=>{
  const evaluations=[],generations=[],attempts=[],publications=[],discards=[];
  const point={id:"synthetic-point",sourceId:"source",sourceRevision:1,summary:"A synthetic supported relation with a disputed qualifier.",evidenceAnchors:[{url:"https://example.test/source",selector:"main"}]};
  const draft={id:"synthetic-draft",knowledgeId:point.id,knowledgeRevision:1,kind:"single-choice",prompt:"Which synthetic relation?",options:["Relation","Alternative"],answer:"Relation",explanation:"Synthetic support.",citedEvidenceUrls:["https://example.test/source"]};
  const valid={score:9,reasons:["Supported revised draft."],feedback:"Keep supported draft.",groundingProblems:[],knowledgeGroundingProblems:[]};
  const first=fault==="knowledge"?{...valid,knowledgeGroundingProblems:["The retained summary qualifier conflicts with supplied evidence."],feedback:"Omitting this qualifier from a quiz cannot repair its retained knowledge."}:fault==="draft-only"?{...valid,groundingProblems:["This draft tests an unsupported extra relation."],feedback:"Remove the extra tested relation."}:(({knowledgeGroundingProblems,...legacy})=>legacy)(valid);
  const actor=createQuizActorCritic({maxAttempts:2,now:()=>"2026-10-02T12:00:00.000Z",logger:()=>{},repository:{findPublished:async()=>({ok:true,value:null}),appendAttempt:async a=>{attempts.push(a);return {ok:true,value:null};},publish:async x=>{publications.push(x);return {ok:true,value:null};},discard:async x=>{discards.push(x);return {ok:true,value:null};},purge:async()=>({ok:true,value:null})},generator:{generate:async input=>{generations.push(structuredClone(input));return {ok:true,value:draft};}},reviewer:{evaluate:async input=>{evaluations.push(input);return {ok:true,value:evaluations.length===1?first:valid};}}});
  const result=await actor.run({ownerId:"owner",runId:"run",points:[point]});assert.equal(result.ok,true);assert.deepEqual(point.summary,generations[0].knowledge.summary);
  if(fault==="knowledge"){
    assert.equal(result.value.dispositions[0].status,"abandoned");assert.equal(result.value.dispositions[0].failureKind,"QuizKnowledgeUngrounded");assert.equal(result.value.dispositions[0].attempts,1);
    assert.equal(generations.length,1);assert.equal(evaluations.length,1);assert.equal(publications.length,0);assert.equal(discards.length,1);assert.equal(attempts[0].failureKind,"QuizKnowledgeUngrounded");assert.equal(attempts[0].score,9);
  }else{
    assert.equal(result.value.dispositions[0].status,"accepted");assert.equal(publications.length,1);assert.equal(discards.length,0);assert.equal(generations.length,fault==="draft-only"?2:1);assert.equal(evaluations.length,generations.length);
    if(fault==="draft-only"){assert.equal(attempts[0].failureKind,"QuizDraftUngrounded");assert.equal(generations[1].feedback,first.feedback);assert.deepEqual(generations[0].knowledge,generations[1].knowledge);}
  }
});


test("paired draft reports all alignment and normalized-alias faults to the existing second draft", async () => {
 const draft={knowledgeId:"synthetic-point",knowledgeRevision:1,canonicalAnswers:["L2 checkpoint"],citedEvidenceUrls:["https://example.test/source"],multipleChoice:{prompt:"Select the synthetic checkpoint.",options:[{key:"a",text:"L2 checkpoint"},{key:"b",text:"Alternative"}],correctOptionKeys:["a"],correctOptionAnswers:[{key:"a",canonicalAnswer:"L2 checkpoint"}],explanation:"Synthetic source."},fillBlank:{prompt:"The checkpoint is ____.",blanks:[{id:"blank-1",canonicalAnswer:"L2",acceptedAnswers:["L₂","L2"]}],explanation:"Synthetic source."}};
 const issues=quizPairDraftValidationIssues(draft);
 assert.equal(isQuizPairDraft(draft),false);assert.equal(issues.length,3);
 assert(issues.some(x=>x.includes("canonicalAnswer:")));assert(issues.some(x=>x.includes("acceptedAnswers[0]:")));assert(issues.some(x=>x.includes("NFKC-equivalent")));
 const corrected=structuredClone(draft);corrected.fillBlank.blanks[0]={id:"blank-1",canonicalAnswer:"L2 checkpoint",acceptedAnswers:["L2 checkpoint"]};
 assert.equal(isQuizPairDraft(corrected),true);assert.deepEqual(quizPairDraftValidationIssues(corrected),[]);
 const point={id:"synthetic-point",sourceId:"source",sourceRevision:1,summary:"Synthetic checkpoint relationship.",evidenceAnchors:[{url:"https://example.test/source",selector:"main"}]};
 const inputs=[],attempts=[];let discarded=0,evaluated=0;
 const actor=createQuizActorCritic({maxAttempts:2,now:()=>"2026-10-02T12:00:00.000Z",logger:()=>{},generator:{generate:async input=>{inputs.push(input);return {ok:false,error:{kind:"QuizDraftSchemaInvalid",validationIssues:issues}};}},reviewer:{evaluate:async()=>{evaluated++;throw Error("Invalid paired draft must not reach critic.");}},repository:{findPublished:async()=>({ok:true,value:null}),appendAttempt:async a=>{attempts.push(a);return {ok:true,value:null};},publish:async()=>{throw Error("Invalid draft must not publish.");},discard:async()=>{discarded++;return {ok:true,value:null};},purge:async()=>({ok:true,value:null})}});
 const result=await actor.run({ownerId:"owner",runId:"run",points:[point]});assert.deepEqual(result,{ok:false,error:{kind:"QuizDraftSchemaInvalid",validationIssues:issues,technicalRetriesExhausted:true,technicalAttempts:4}});assert.equal(inputs.length,4);assert.equal(attempts.length,0);assert.equal(evaluated,0);assert.equal(discarded,0);for(const issue of issues)assert(inputs[1].feedback.includes(issue));assert.deepEqual(draft.fillBlank.blanks[0].acceptedAnswers,["L₂","L2"]);
});

// Prompt contract and supplied verdict fixtures; these do not predict real model accuracy.
test('quiz scope permits supported narrowing while retaining necessary conditions and full-summary safety',()=>{
 assert.match(questionEvaluatorPrompt,/Assess the current taught relationship, not whether it repeats every statement in a longer retained quotation/);
 assert.match(questionEvaluatorPrompt,/A faithful narrower relationship need not restore an unrelated or nonessential removed qualifier/);
 assert.match(questionEvaluatorPrompt,/Conditions, negations, units and causal qualifications necessary to preserve that relationship remain required/);
 assert.match(questionEvaluatorPrompt,/narrowing must still be supported by retained evidence and attached pixels/);
 assert.match(questionEvaluatorPrompt,/Report unsupported, source-conflicting or unpictured summary claims in knowledgeGroundingProblems/);
 assert.match(questionEvaluatorPrompt,/Do not invent corrections from outside knowledge/);
});

// Typed source-fault fixtures test boundary behavior, not model semantic accuracy.
for (const kind of ["unsupported", "source-conflicting", "unpictured"]) test(`fresh ${kind} issue preserves its exact retained claim and raw evidence`, () => {
 const knowledge={summary:"A supported relationship with an unsafe qualifier."};
 const raw={score:9,reasons:["Synthetic assessment."],feedback:"Remove the unsupported qualifier.",groundingProblems:[],knowledgeGroundingProblems:[{claim:"unsafe qualifier",kind,reason:"The captured source or image does not establish this qualifier."}]};
 const before=JSON.stringify(raw),result=normalizeKnowledgeQuizEvaluation(raw,knowledge);
 assert(result.ok);assert.equal(result.value.knowledgeGroundingProblems.length,1);assert(result.value.knowledgeGroundingProblems[0].includes('"unsafe qualifier"'));assert.equal(JSON.stringify(raw),before);
});
test("fresh issue cannot cite a removed qualifier, arbitrary kind, unknown field or legacy string",()=>{
 const knowledge={summary:"A retained supported relationship."};
 const base={score:9,reasons:["Synthetic assessment."],feedback:"Keep.",groundingProblems:[]};
 for(const issue of [{claim:"removed location",kind:"unpictured",reason:"Not depicted."},{claim:"retained",kind:"usefulness",reason:"Too descriptive."},{claim:"retained",kind:"unsupported",reason:"Conflict.",extra:true},{claim:"",kind:"unsupported",reason:"Conflict."},"Legacy semantic fault"]){
  assert.deepEqual(normalizeKnowledgeQuizEvaluation({...base,knowledgeGroundingProblems:[issue]},knowledge),{ok:false,error:{kind:"QuizEvaluatorOutputInvalid"}});
 }
 assert.equal(normalizeKnowledgeQuizEvaluation({...base,knowledgeGroundingProblems:[],extra:true},knowledge).ok,false);
});
test("entire current summary can anchor an unsafe image association or a necessary-condition fault",()=>{
 const summary="The process produces the outcome.";
 for(const issue of [{claim:summary,kind:"unpictured",reason:"The associated pixels depict a different relationship."},{claim:summary,kind:"source-conflicting",reason:"The supplied source requires a condition for this outcome; the retained unconditional claim omits it."}]){
  assert(normalizeKnowledgeQuizEvaluation({score:9,reasons:["Synthetic assessment."],feedback:"Resolve the source fault.",groundingProblems:[],knowledgeGroundingProblems:[issue]},{summary}).ok);
 }
 assert.match(questionEvaluatorPrompt,/actual overbroad retained claim/);assert.match(questionEvaluatorPrompt,/inspect retained unsafe clauses even when the quiz does not test them/);
});
test("claim binding does not silently reinterpret or clear a present-claim semantic negative",()=>{
 const summary="A supported spatial relationship.";
 const raw={score:9,reasons:["Synthetic model assessment."],feedback:"Revise the point.",groundingProblems:[],knowledgeGroundingProblems:[{claim:summary,kind:"unsupported",reason:"The model calls this descriptive rather than educational."}]};
 const result=normalizeKnowledgeQuizEvaluation(raw,{summary});assert(result.ok);assert.equal(result.value.knowledgeGroundingProblems.length,1);assert.match(result.value.knowledgeGroundingProblems[0],/descriptive/);
 // Semantic correctness still belongs to the critic. The boundary cannot infer source truth from prose.
});
