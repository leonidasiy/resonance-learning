import test from "node:test";
import assert from "node:assert/strict";
import {
  assembleQuizPair,
  normalizeQuizPairDraftAliases,
  quizPairSchema,
  validateQuizPairDraft,
} from "../src/features/knowledge-workflows/quiz-pair.js";
import {
  createQuizActorCritic,
  isKnowledgeQuizEvaluation,
  normalizeKnowledgeQuizEvaluation,
} from "../src/features/knowledge-workflows/quiz.js";
import {
  questionEvaluationSchema,
  questionEvaluatorPrompt,
  questionGeneratorPrompt,
} from "../worker/knowledge-workflow-runtime.js";
const draft = () => ({
  knowledgeId: "point",
  knowledgeRevision: 1,
  canonicalAnswers: ["NAD+"],
  citedEvidenceUrls: ["https://example.test/source"],
  multipleChoice: {
    prompt: "Which synthetic carrier?",
    options: [{ key: "a", text: "NAD+" }, { key: "b", text: "Other carrier" }],
    correctOptionKeys: ["a"],
    correctOptionAnswers: [{ key: "a", canonicalAnswer: "NAD+" }],
    explanation: "Constructed source supports the carrier.",
  },
  fillBlank: {
    prompt: "The synthetic carrier is ____.",
    blanks: [{
      id: "blank-1",
      canonicalAnswer: "NAD+",
      acceptedAnswers: ["NAD+", "NAD⁺", " nad+ ", "oxidized carrier"],
    }],
    explanation: "Constructed source supports this term.",
  },
});
test("boundary canonicalizes only redundant alias spellings without mutating the provider object", () => {
  const raw = draft(), before = structuredClone(raw);
  assert.equal(validateQuizPairDraft(raw), false);
  const value = normalizeQuizPairDraftAliases(raw);
  assert(validateQuizPairDraft(value));
  assert.deepEqual(value.fillBlank.blanks[0].acceptedAnswers, [
    "NAD+",
    "oxidized carrier",
  ]);
  assert.deepEqual(raw, before);
  assert.deepEqual(
    assembleQuizPair(value, "quiz:point:r1").fillBlank.blanks[0]
      .acceptedAnswers,
    ["NAD+", "oxidized carrier"],
  );
});
test("valid draft retains exact identity; canonical first spelling is preserved", () => {
  const raw = draft();
  raw.fillBlank.blanks[0].acceptedAnswers = ["NAD⁺", "oxidized carrier"];
  assert(validateQuizPairDraft(raw));
  assert.equal(normalizeQuizPairDraftAliases(raw), raw);
});
for (
  const fault of [
    "blank-count",
    "prompt-count",
    "canonical-map",
    "canonical-list",
    "unknown-field",
    "empty-alias",
    "alias-cap",
  ]
) {
  test("normalization cannot conceal " + fault, () => {
    const raw = draft();
    if (fault === "blank-count") {
      raw.fillBlank.blanks.push({ ...raw.fillBlank.blanks[0], id: "blank-2" });
    }
    if (fault === "prompt-count") {
      raw.fillBlank.prompt += " Another ____.";
    }
    if (fault === "canonical-map") {
      raw.multipleChoice.correctOptionAnswers[0].canonicalAnswer =
        "Other carrier";
    }
    if (fault === "canonical-list") raw.canonicalAnswers.push("NAD⁺");
    if (fault === "unknown-field") raw.fillBlank.blanks[0].extra = true;
    if (fault === "empty-alias") {
      raw.fillBlank.blanks[0].acceptedAnswers.push(
        "",
      );
    }
    if (fault === "alias-cap") {
      raw.fillBlank.blanks[0].acceptedAnswers = Array(
        13,
      ).fill("NAD+");
    }
    const before = structuredClone(raw);
    assert.equal(normalizeQuizPairDraftAliases(raw), raw);
    assert.equal(validateQuizPairDraft(raw), false);
    assert.deepEqual(raw, before);
  });
}
test("fresh schema retains the full required pair without count-only composition", () => {
  const schema = quizPairSchema(true);
  assert.equal(schema.name, "paired_quiz_v4");
  assert.deepEqual(schema.schema.required, ["knowledgeId", "knowledgeRevision", "canonicalAnswers", "citedEvidenceUrls", "multipleChoice", "fillBlank"]);
  assert.equal(schema.schema.anyOf, undefined);
  assert.equal(schema.schema.allOf, undefined);
  assert.equal(schema.schema.properties.canonicalAnswers.minItems, 1);
  assert.equal(schema.schema.properties.canonicalAnswers.maxItems, 3);
  assert.deepEqual(schema.schema.properties.fillBlank.properties.blanks.items.required, ["id", "canonicalAnswer", "acceptedAnswers"]);
});
test("fresh prompt describes final pair rebuilding and substantive source conflict rather than cosmetic order", () => {
  assert.match(questionGeneratorPrompt, /paired-question-generator-v10-source-language/);
  assert.match(
    questionGeneratorPrompt,
    /rebuild all four arrays and the blank prompt together/,
  );
  assert.match(questionEvaluatorPrompt, /paired-question-evaluator-v14-source-language/);
  assert.match(
    questionEvaluatorPrompt,
    /source-conflicting requires a substantive opposing meaning/,
  );
  assert.match(
    questionEvaluatorPrompt,
    /distinguish an undirected relation from an explicitly directed transition/,
  );
  assert.match(
    questionEvaluatorPrompt,
    /genuine necessary condition, unsupported claim, conflicting direction or unpictured relationship remains/,
  );
  assert.equal(questionEvaluationSchema.name, "quiz_evaluation_v3");
});
test("received typed source-conflict remains negative under unchanged normalization and bounded actor", async () => {
  const knowledge = {
      id: "point",
      sourceId: "source",
      sourceRevision: 1,
      summary: "The marker lies between region A and region B.",
      normalizedHash: "point",
      evidenceAnchors: [{
        url: "https://example.test/source",
        quote: "The marker lies between region A and region B.",
      }],
      mediaCandidates: [],
      coverageGoalIds: [],
      attribution: { sourceUrl: "https://example.test/source" },
      extractionVersion: "constructed",
    },
    raw = {
      score: 9,
      reasons: ["Constructed negative remains binding despite positive score."],
      feedback: "Optional wording cannot clear a received typed fault.",
      groundingProblems: [],
      knowledgeGroundingProblems: [{
        claim: knowledge.summary,
        kind: "source-conflicting",
        reason: "Constructed substantive conflict.",
      }],
    };
  assert(isKnowledgeQuizEvaluation(raw, knowledge));
  const normalized = normalizeKnowledgeQuizEvaluation(raw, knowledge);
  assert(
    normalized.ok && normalized.value.knowledgeGroundingProblems.length === 1,
  );
  let drafts = 0, critics = 0, discarded = 0;
  const actor = createQuizActorCritic({
    maxAttempts: 2,
    now: () => "2026-10-12T02:00:00Z",
    logger: () => {},
    generator: {
      generate: async () => {
        drafts++;
        return {
          ok: true,
          value: {
            id: "quiz",
            knowledgeId: "point",
            knowledgeRevision: 1,
            kind: "single-choice",
            prompt: "Where is the marker?",
            options: ["Between A and B", "Other place"],
            answer: "Between A and B",
            explanation: "Constructed explanation.",
            citedEvidenceUrls: ["https://example.test/source"],
          },
        };
      },
    },
    reviewer: {
      evaluate: async () => {
        critics++;
        return normalized;
      },
    },
    repository: {
      findPublished: async () => ({ ok: true, value: null }),
      appendAttempt: async () => ({ ok: true, value: null }),
      publish: async () => assert.fail("No forced publication"),
      discard: async () => {
        discarded++;
        return { ok: true, value: null };
      },
      purge: async () => assert.fail("No purge"),
    },
  });
  const result = await actor.run({
    ownerId: "owner",
    runId: "run",
    points: [knowledge],
  });
  assert(result.ok);
  assert.equal(
    result.value.dispositions[0].failureKind,
    "QuizKnowledgeUngrounded",
  );
  assert.deepEqual([drafts, critics, discarded], [1, 1, 1]);
});
import { DatabaseSync } from "node:sqlite";
import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createKnowledgeWorkflowRuntime } from "../worker/knowledge-workflow-runtime.js";
import { createKnowledgeWorkflowService } from "../src/features/knowledge-workflows/workflow.js";
import { createAgentConfigurationLoader } from "../src/features/knowledge-workflows/config.js";
import { D1KnowledgeWorkflowRepository } from "../worker/knowledge-workflow-d1.js";
import { D1KnowledgeContentRepository } from "../worker/knowledge-workflow-content-d1.js";
import { WEBPAGE_IMAGE_POLICY } from "../worker/webpage-image-budget.js";
for (const scenario of ['valid','malformed','importance-rejected']) {
  const malformed=scenario==='malformed', importanceRejected=scenario==='importance-rejected';
  test(`actual runtime provider boundary preserves raw history; scenario=${scenario}`, async () => {
    const db = new DatabaseSync(":memory:");
    try {
      for (
        const name of (await readdir("worker/migrations")).filter((n) =>
          n.endsWith(".sql")
        ).sort()
      ) db.exec(await readFile("worker/migrations/" + name, "utf8"));
      const database = {
          prepare(sql) {
            let values = [];
            const execute = () => ({
              success: true,
              meta: { changes: Number(db.prepare(sql).run(...values).changes) },
            });
            return {
              bind(...v) {
                values = v;
                return this;
              },
              first: async () => db.prepare(sql).get(...values) ?? null,
              all: async () => ({
                success: true,
                results: db.prepare(sql).all(...values),
              }),
              run: async () => execute(),
              execute,
            };
          },
          async batch(statements) {
            db.exec("BEGIN IMMEDIATE");
            try {
              const r = statements.map((s) => s.execute());
              db.exec("COMMIT");
              return r;
            } catch (e) {
              db.exec("ROLLBACK");
              throw e;
            }
          },
        },
        now = () => "2026-10-12T02:00:00.000Z",
        logger = () => {},
        hash = (v) => "sha256:" + createHash("sha256").update(v).digest("hex"),
        unwrap = (r) => {
          assert(r.ok, JSON.stringify(r));
          return r.value;
        },
        loader = createAgentConfigurationLoader({
          sha256: async (v) => hash(v),
        }),
        configs = {};
      for (
        const role of [
          "rights-assessor",
          "knowledge-scraper",
          "question-generator",
          "question-evaluator",
        ]
      ) {
        configs[role] = unwrap(
          await loader.load({
            source: await readFile("agent-config/" + role + ".yaml", "utf8"),
            expectedRole: role,
          }),
        );
      }
      db.prepare(
        "INSERT INTO library_sources (owner_id,source_id,submitted_url,canonical_url,title,description,adapter_json,identity_evidence_json,state,approved_at,updated_at,revision) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      ).run(
        "synthetic-owner",
        "source",
        "https://example.test/source",
        "https://example.test/source",
        "Synthetic source",
        "Offline fixture",
        "{}",
        "[]",
        "active",
        now(),
        now(),
        1,
      );
      const service = createKnowledgeWorkflowService(
          new D1KnowledgeWorkflowRepository({ database, logger }),
          {
            now,
            createId: () => "synthetic-run",
            logger,
          },
        ),
        run = unwrap(
          await service.createRun({
            ownerId: "synthetic-owner",
            sourceId: "source",
            sourceRevision: 1,
            canonicalSourceIdentity: "https://example.test/source",
            contentSignature: "synthetic-source",
            idempotencyKey: "synthetic-run",
            configDigests: Object.fromEntries(
              Object.entries(configs).map(([role, c]) => [role, c.digest]),
            ),
          }),
        ).run,
        point = {
          id: "point",
          sourceId: "source",
          sourceRevision: 1,
          summary: "The synthetic carrier is NAD+.",
          normalizedHash: "carrier",
          evidenceAnchors: [{
            url: "https://example.test/source",
            selector: "#source",
            quote: "The synthetic carrier is NAD+.",
            clause: "The synthetic carrier is NAD+.",
          }],
          mediaCandidates: [],
          coverageGoalIds: [],
          attribution: { sourceUrl: "https://example.test/source" },
          extractionVersion: "synthetic",
        },
        content = new D1KnowledgeContentRepository({ database, now, logger });
      unwrap(
        await content.appendKnowledgePoint(
          point,
          run.ownerId,
          run.runId,
          now(),
        ),
      );
      unwrap(
        await content.saveReviewEvidence({
          ownerId: run.ownerId,
          runId: run.runId,
          knowledgeId: point.id,
          sourceRevision: 1,
          evidenceDigest: hash(
            JSON.stringify({
              sections: [{
                id: "synthetic",
                url: "https://example.test/source",
                locator: "#source",
                text: point.summary,
              }],
            }),
          ),
          evidence: {
            sections: [{
              id: "synthetic",
              url: "https://example.test/source",
              locator: "#source",
              text: point.summary,
            }],
          },
        }),
      );
      let drafts = 0, critics = 0, importanceReviews = 0, wireFailure;
      const raw = draft();
      if (malformed) {
        raw.fillBlank.blanks.push({
          ...raw.fillBlank.blanks[0],
          id: "blank-2",
        });
      }
      const forbidden = async () => assert.fail("No external acquisition");
      const runtime = createKnowledgeWorkflowRuntime({
        imagePolicy: WEBPAGE_IMAGE_POLICY,
        database,
        apiKey: "synthetic-no-secret",
        endpoint: "https://unexecuted.invalid/model",
        configSnapshots: configs,
        now,
        nowMs: () => Date.parse(now()),
        logger,
        browser: {
          readPage: forbidden,
          readRobots: forbidden,
          screenshot: forbidden,
          close: async () => ({ ok: true, value: null }),
        },
        transition: forbidden,
        fetch: async (_url, init) => {
          try {
            const body = JSON.parse(init.body),
              schema = body.response_format.json_schema;
            let output;
            if (schema.name === "paired_quiz_v4") {
              drafts++;
              assert.equal(body.max_tokens, 16384);
              assert.equal(schema.schema.anyOf, undefined);
              assert.deepEqual(schema.schema.required, ["knowledgeId", "knowledgeRevision", "canonicalAnswers", "citedEvidenceUrls", "multipleChoice", "fillBlank"]);
              output = raw;
            } else if(schema.name==='quiz_answer_importance_v1') {
              importanceReviews++;
              output={targets:[{answer:'NAD+',important:!importanceRejected,reason:'Constructed importance judgment.'}],feedback:importanceRejected?'Constructed weak-target rejection.':'Central fixture target.'};
            } else {
              assert.equal(schema.name, "quiz_evaluation_v3");
              critics++;
              assert.equal(body.max_tokens, 2048);
              const message = Array.isArray(body.messages[1].content)
                ? body.messages[1].content[0].text
                : body.messages[1].content;
              const task = JSON.parse(
                message.slice(
                  message.indexOf("\n") + 1,
                  message.lastIndexOf("\n"),
                ),
              ).task;
              assert.deepEqual(
                task.draft.pairedQuiz.fillBlank.blanks[0].acceptedAnswers,
                ["NAD+", "oxidized carrier"],
              );
              output = {
                score: 9,
                reasons: ["Constructed grounded pair."],
                feedback: "Keep the source-supported pair.",
                groundingProblems: [],
                knowledgeGroundingProblems: [],
              };
            }
            return Response.json({
              id: "synthetic",
              choices: [{
                finish_reason: "stop",
                message: { content: JSON.stringify(output) },
              }],
              usage: { prompt_tokens: 1, completion_tokens: 1 },
            });
          } catch (error) {
            wireFailure = String(error);
            throw error;
          }
        },
      });
      const actor = unwrap(runtime.createQuizActorForRun(run)),
        result = await actor.run({
          ownerId: run.ownerId,
          runId: run.runId,
          points: [point],
        });
      if(malformed){assert.equal(result.ok,false);assert.equal(result.error.kind,"QuizDraftSchemaInvalid");assert.equal(result.error.technicalRetriesExhausted,true);assert.equal(result.error.technicalAttempts,4);assert.equal(db.prepare("SELECT count(*) AS n FROM knowledge_workflow_quizzes").get().n,0);assert.equal(db.prepare("SELECT count(*) AS n FROM extraction_knowledge_points").get().n,1);assert.equal(db.prepare("SELECT count(*) AS n FROM knowledge_workflow_quiz_attempts").get().n,0);}
      else if(importanceRejected){assert(result.ok,JSON.stringify({result,wireFailure}));assert.equal(result.value.dispositions[0].status,'abandoned');assert.equal(result.value.dispositions[0].failureKind,'QuizScoreBelowThreshold');assert.equal(db.prepare("SELECT count(*) AS n FROM knowledge_workflow_quizzes").get().n,0);assert.equal(db.prepare("SELECT count(*) AS n FROM extraction_knowledge_points").get().n,1);}
      else {assert(result.ok,JSON.stringify({result,wireFailure}));assert.equal(result.value.dispositions[0].status,"accepted");}
      assert.deepEqual([drafts, critics, importanceReviews], malformed ? [4, 0, 0] : importanceRejected ? [4, 0, 4] : [1, 1, 1]);
      const rows = db.prepare(
        "SELECT result_json FROM knowledge_workflow_stages WHERE stage_key LIKE 'question-generator:%'",
      ).all();
      assert.equal(rows.length, drafts);
      for (const row of rows) {
        assert.deepEqual(JSON.parse(row.result_json).value, raw);
      }
    } finally {
      db.close();
    }
  });
}
