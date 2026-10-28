// @ts-check

import { createKnowledgeWorkflowExecutor } from "../src/features/knowledge-workflows/executor.js";
import { createExtractionRunner } from "../src/features/knowledge-workflows/extraction.js";
import { createQuizActorCritic } from "../src/features/knowledge-workflows/quiz.js";

/** @template T @param {T} actual @param {T} expected */
function assertEquals(actual, expected) { if (!Object.is(actual, expected)) throw new Error(`Expected ${String(expected)}, received ${String(actual)}.`); }

/** @param {boolean} condition @param {string} message */
function assert(condition, message) { if (!condition) throw new Error(message); }

function run(state = "robots-check") {
  return /** @type {import("../src/features/knowledge-workflows/workflow.js").KnowledgeWorkflowRun} */ ({ ownerId: "owner-a", runId: "run-a", sourceId: "source-a", sourceRevision: 1, canonicalSourceIdentity: "https://example.test/learn", contentSignature: "sha256:source", state, revision: 2, idempotencyKey: "source-a", configDigests: { scraper: "sha256:config" }, extractionStartedAt: state === "extraction-loop" ? "2026-08-13T00:00:00.000Z" : null, extractionDeadlineAt: state === "extraction-loop" ? "2026-08-13T00:30:00.000Z" : null, decisionRequired: null, counts: { pages: 0, knowledgePoints: 0, acceptedQuizzes: 0, pendingQuizzes: 0 }, failureKind: null, reused: false, createdAt: "2026-08-13T00:00:00.000Z", updatedAt: "2026-08-13T00:00:00.000Z" });
}

function rights() {
  return /** @type {import("../src/features/knowledge-workflows/rights.js").RightsDecision} */ ({ ownerId: "owner-a", sourceId: "source-a", sourceRevision: 1, canonicalUrl: "https://example.test/learn", status: "allowed", evidence: [], reason: null, assessedAt: "2026-08-13T00:00:00.000Z", expiresAt: null });
}

Deno.test("resumed extraction checkpoints quiz work before replaying the source, including the last quiz chunk",async()=>{
  for(const hasMore of [true,false]){
    let extractions=0;
    const current={...run("extraction-loop"),counts:{pages:0,knowledgePoints:1,acceptedQuizzes:0,pendingQuizzes:0}};
    const point={id:"knowledge-a",sourceId:"source-a",sourceRevision:1,summary:"A supported relationship.",normalizedHash:"hash-a",evidenceAnchors:[{url:"https://example.test/learn",selector:"#a"}],coverageGoalIds:[],mediaCandidates:[],attribution:{sourceUrl:"https://example.test/learn"},extractionVersion:"v1"};
    const executor=createKnowledgeWorkflowExecutor({
      transition:async({run,nextState,counts})=>({ok:true,value:{...run,state:nextState,counts:counts??run.counts,revision:run.revision+1}}),
      robots:{check:async()=>({ok:true,value:{}})},
      extraction:{run:async()=>{extractions++;return {ok:true,value:{state:"completed",scratchpad:{},knowledgePointCount:1,pagesProcessed:1}};}},
      knowledge:{list:async()=>({ok:true,value:[point]})},
      classification:{ensure:async()=>({ok:true,value:null})},
      quiz:{run:async()=>({ok:true,value:{processedPoints:1,hasMore,dispositions:[{knowledgeId:point.id,status:"accepted",publicationStatus:"published",attempts:1,failureKind:null,restrictedUntil:null}]}})},
      logger:()=>{},
    });
    const result=await executor.run({run:current,rootUrl:current.canonicalSourceIdentity,rightsAssessment:rights()});
    assert(result.ok,"The saved quiz chunk must checkpoint successfully.");if(!result.ok)continue;
    assertEquals(extractions,0);
    assertEquals(result.value.state,"extraction-loop");
    assertEquals(result.value.run.counts.pages,0);
    assertEquals(result.value.run.counts.acceptedQuizzes,1);
  }
});

Deno.test("an empty resumed quiz backlog still lets newly committed knowledge start quizzes",async()=>{
  let extracting=false,quizzes=0;
  const current={...run("extraction-loop"),counts:{pages:0,knowledgePoints:1,acceptedQuizzes:1,pendingQuizzes:0}};
  const point={id:"knowledge-a",sourceId:"source-a",sourceRevision:1,summary:"A supported relationship.",normalizedHash:"hash-a",evidenceAnchors:[{url:"https://example.test/learn",selector:"#a"}],coverageGoalIds:[],mediaCandidates:[],attribution:{sourceUrl:"https://example.test/learn"},extractionVersion:"v1"};
  const executor=createKnowledgeWorkflowExecutor({
    transition:async({run,nextState,counts})=>({ok:true,value:{...run,state:nextState,counts:counts??run.counts,revision:run.revision+1}}),
    robots:{check:async()=>({ok:true,value:{}})},
    extraction:{run:async command=>{extracting=true;command.onKnowledge?.();return {ok:true,value:{state:"awaiting-time-limit-decision",scratchpad:{},knowledgePointCount:2,pagesProcessed:0}};}},
    knowledge:{list:async()=>({ok:true,value:[point]})},classification:{ensure:async()=>({ok:true,value:null})},
    quiz:{run:async()=>{quizzes++;assertEquals(extracting,quizzes===2);return {ok:true,value:{processedPoints:extracting?1:0,dispositions:[]}};}},logger:()=>{},
  });
  const result=await executor.run({run:current,rootUrl:current.canonicalSourceIdentity,rightsAssessment:rights()});
  assert(result.ok,"Extraction must continue after an empty quiz backlog.");assertEquals(quizzes,2);
});

Deno.test("executor waits for rights before robots and runs extraction then quiz sequentially", async () => {
  /** @type {string[]} */ const calls = [];
  const executor = createKnowledgeWorkflowExecutor({ classification: { ensure: async () => ({ ok: true, value: null }) },
    transition: async ({ run: current, nextState }) => { calls.push(`transition:${nextState}`); return { ok: true, value: { ...current, state: nextState, revision: current.revision + 1 } }; },
    robots: { check: async () => { calls.push("robots"); return { ok: true, value: {} }; } },
    extraction: { run: async () => { calls.push("extraction"); return { ok: true, value: { state: "completed", scratchpad: {}, knowledgePointCount: 1, pagesProcessed: 2 } }; } },
    knowledge: { list: async () => { calls.push("knowledge"); return { ok: true, value: [{ id: "knowledge-a", sourceId: "source-a", sourceRevision: 1, summary: "Specific", normalizedHash: "hash-a", evidenceAnchors: [{ url: "https://example.test/learn", selector: "#a" }], coverageGoalIds: [], mediaCandidates: [], attribution: { sourceUrl: "https://example.test/learn" }, extractionVersion: "v1" }] }; } },
    quiz: { run: async () => { calls.push("quiz"); return { ok: true, value: { dispositions: [{ knowledgeId: "knowledge-a", status: "accepted", publicationStatus: "published", attempts: 1, failureKind: null, restrictedUntil: null }] } }; } },
    logger: () => {},
  });
  const waiting = await executor.run({ run: run("source-added"), rootUrl: "https://example.test/learn" });
  assertEquals(waiting.ok, true);
  if (!waiting.ok) return;
  assertEquals(waiting.value.state, "awaiting-rights-review");
  assertEquals(calls.join(","), "transition:awaiting-rights-review");
  const completed = await executor.run({ run: run(), rootUrl: "https://example.test/learn", rightsAssessment: rights() });
  assertEquals(completed.ok, true);
  assertEquals(calls.slice(1).join(","), "robots,transition:extraction-loop,extraction,transition:extraction-finalized,transition:per-point-quiz-loop,knowledge,quiz,transition:completed");
});

Deno.test("executor preserves pause and timeout decisions and completes a reviewed empty knowledge set", async () => {
  /** @type {import("../src/features/knowledge-workflows/executor.js").WorkflowExecutorDependencies} */
  const base = {
    classification: { ensure: async () => ({ ok: true, value: null }) },
    transition: async ({ run: current, nextState }) => ({ ok: true, value: { ...current, state: nextState, revision: current.revision + 1 } }),
    robots: { check: async () => ({ ok: true, value: {} }) },
    extraction: { run: async () => ({ ok: true, value: { state: "paused", scratchpad: {}, knowledgePointCount: 0, pagesProcessed: 0 } }) },
    knowledge: { list: async () => ({ ok: true, value: [] }), reviewedEmpty:async()=>({ok:true,value:true}) },
    quiz: { run: async () => ({ ok: true, value: { dispositions: [] } }) },
    logger: () => {},
  };
  const paused = createKnowledgeWorkflowExecutor({ ...base, extraction: { run: async () => ({ ok: true, value: { state: "paused", scratchpad: {}, knowledgePointCount: 1, pagesProcessed: 1 } }) } });
  const result = await paused.run({ run: run("extraction-loop"), rootUrl: "https://example.test/learn", rightsAssessment: rights() });
  assertEquals(result.ok, true);
  if (result.ok) assertEquals(result.value.state, "paused");
  const empty = createKnowledgeWorkflowExecutor({ ...base, extraction: { run: async () => ({ ok: true, value: { state: "completed", scratchpad: {}, knowledgePointCount: 0, pagesProcessed: 1 } }) } });
  const completed = await empty.run({ run: run("extraction-loop"), rootUrl: "https://example.test/learn", rightsAssessment: rights() });
  assertEquals(completed.ok, true);
  if (completed.ok) assertEquals(completed.value.state, "completed");
  const unexplained = createKnowledgeWorkflowExecutor({ ...base, knowledge: { list:async()=>({ok:true,value:[]}), reviewedEmpty:async()=>({ok:true,value:false}) }, extraction: { run:async()=>({ok:true,value:{state:"completed",scratchpad:{},knowledgePointCount:0,pagesProcessed:1}}) } });
  const rejected = await unexplained.run({run:run("extraction-loop"),rootUrl:"https://example.test/learn",rightsAssessment:rights()});
  assertEquals(rejected.ok,false);
  if(!rejected.ok)assertEquals(rejected.error.causeKind,"KnowledgeSetEmpty");
});

Deno.test("executor turns a hard browser access block into an upload-required outcome", async () => {
  const executor = createKnowledgeWorkflowExecutor({ classification: { ensure: async () => ({ ok: true, value: null }) },
    transition: async ({ run: current, nextState }) => ({ ok: true, value: { ...current, state: nextState, revision: current.revision + 1 } }),
    robots: { check: async () => ({ ok: true, value: {} }) },
    extraction: { run: async () => ({ ok: false, error: { kind: "ExtractionAcquisitionFailed", causeKind: "KnowledgePageBotAccessDenied" } }) },
    knowledge: { list: async () => ({ ok: true, value: [] }) },
    quiz: { run: async () => ({ ok: true, value: { dispositions: [] } }) },
    logger: () => {},
  });
  const result = await executor.run({ run: run("extraction-loop"), rootUrl: "https://example.test/learn", rightsAssessment: rights() });
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.error.causeKind, "WorkflowUploadRequired");
    assertEquals(result.error.detailKind, "KnowledgePageBotAccessDenied");
  }
});

Deno.test("executor preserves an invalid extraction plan for the retryable workflow status", async () => {
  const executor = createKnowledgeWorkflowExecutor({ classification: { ensure: async () => ({ ok: true, value: null }) },
    transition: async ({ run: current, nextState }) => ({ ok: true, value: { ...current, state: nextState, revision: current.revision + 1 } }),
    robots: { check: async () => ({ ok: true, value: {} }) },
    extraction: { run: async () => ({ ok: false, error: { kind: "ExtractionPlanInvalid" } }) },
    knowledge: { list: async () => ({ ok: true, value: [] }) },
    quiz: { run: async () => ({ ok: true, value: { dispositions: [] } }) },
    logger: () => {},
  });
  const result = await executor.run({ run: run("extraction-loop"), rootUrl: "https://example.test/learn", rightsAssessment: rights() });
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.error.causeKind, "WorkflowExtractionFailed");
    assertEquals(result.error.detailKind, "ExtractionPlanInvalid");
  }
});

Deno.test("executor preserves the concrete robots failure kind", async () => {
  const executor = createKnowledgeWorkflowExecutor({ classification: { ensure: async () => ({ ok: true, value: null }) },
    transition: async ({ run: current, nextState }) => ({ ok: true, value: { ...current, state: nextState, revision: current.revision + 1 } }),
    robots: { check: async () => ({ ok: false, error: { kind: "RobotsFetchUnavailable", causeKind: "KnowledgeRobotsNativeResponseRejected", diagnosticToken: "native-http-503" } }) },
    extraction: { run: async () => { throw new Error("Robots failure must stop before extraction."); } },
    knowledge: { list: async () => ({ ok: true, value: [] }) },
    quiz: { run: async () => ({ ok: true, value: { dispositions: [] } }) },
    logger: () => {},
  });
  const result = await executor.run({ run: run(), rootUrl: "https://example.test/learn", rightsAssessment: rights() });
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.error.causeKind, "WorkflowRobotsFailed");
    assertEquals(result.error.detailKind, "KnowledgeRobotsNativeResponseRejected");
    assertEquals(result.error.detailDiagnosticToken, "native-http-503");
  }
});

Deno.test("quiz-stage retry retains cumulative extraction counts after an earlier discard", async () => {
  const current={...run("per-point-quiz-loop"),counts:{pages:2,knowledgePoints:2,acceptedQuizzes:0,pendingQuizzes:0}};
  const point={id:"remaining",sourceId:"source-a",sourceRevision:1,summary:"Specific",normalizedHash:"hash-a",evidenceAnchors:[{url:"https://example.test/learn",selector:"#a"}],coverageGoalIds:[],mediaCandidates:[],attribution:{sourceUrl:"https://example.test/learn"},extractionVersion:"v1"};
  const executor=createKnowledgeWorkflowExecutor({ classification: { ensure: async () => ({ ok: true, value: null }) },
    transition:async({run:active,nextState,counts})=>{assert(counts!==undefined && counts.knowledgePoints>=active.counts.knowledgePoints,"Counts cannot decrease after discard");return {ok:true,value:{...active,state:nextState,counts:counts??active.counts}};},
    robots:{check:async()=>{throw new Error("MustNotRecheckRobots");}},extraction:{run:async()=>{throw new Error("MustNotReextract");}},
    knowledge:{list:async()=>({ok:true,value:[point]})},quiz:{run:async()=>({ok:true,value:{dispositions:[{knowledgeId:point.id,status:"accepted",publicationStatus:"published",attempts:1,failureKind:null,restrictedUntil:null}]}})},logger:()=>{},
  });
  const result=await executor.run({run:current,rootUrl:"https://example.test/learn"});
  if (!result.ok) throw new Error(result.error.causeKind);
  assertEquals(result.value.state,"completed");
  assertEquals(result.value.run.counts.knowledgePoints,2);
  assertEquals(result.value.run.counts.acceptedQuizzes,1);
});

Deno.test("executor treats a completed run replay as an idempotent no-op", async () => {
  let quizCalls = 0;
  const executor = createKnowledgeWorkflowExecutor({ classification: { ensure: async () => ({ ok: true, value: null }) },
    transition: async () => { throw new Error("Completed replay must not transition."); },
    robots: { check: async () => { throw new Error("Completed replay must not check robots."); } },
    extraction: { run: async () => { throw new Error("Completed replay must not extract."); } },
    knowledge: { list: async () => { throw new Error("Completed replay must not load knowledge."); } },
    quiz: { run: async () => { quizCalls += 1; throw new Error("Completed replay must not run quiz generation."); } },
    logger: () => {},
  });
  const result = await executor.run({ run: run("completed"), rootUrl: "https://example.test/learn" });
  assertEquals(result.ok, true);
  if (result.ok) assertEquals(result.value.state, "completed");
  assertEquals(quizCalls, 0);
});

Deno.test("5 executor converts every injected operation rejection into its typed failure", async () => {
  const point = /** @type {import("../src/features/knowledge-workflows/extraction.js").KnowledgePoint} */ ({ id: "knowledge-a", sourceId: "source-a", sourceRevision: 1, summary: "Specific", normalizedHash: "hash-a", evidenceAnchors: [{ url: "https://example.test/learn", selector: "main" }], coverageGoalIds: [], mediaCandidates: [], attribution: { sourceUrl: "https://example.test/learn" }, extractionVersion: "v1" });
  const cases = [
    { name: "workflow transition", state: "robots-check", failure: "WorkflowTransitionRejected", overrides: { transition: async () => Promise.reject({ kind: "WorkflowTransitionRejected" }) } },
    { name: "knowledge repository", state: "per-point-quiz-loop", failure: "KnowledgeRepositoryRejected", overrides: { knowledge: { list: async () => Promise.reject({ kind: "KnowledgeRepositoryRejected" }) } } },
    { name: "quiz repository", state: "per-point-quiz-loop", failure: "QuizRepositoryRejected", overrides: { knowledge: { list: async () => ({ ok: true, value: [point] }) }, quiz: { run: async () => Promise.reject({ kind: "QuizRepositoryRejected" }) } } },
    { name: "model generation", state: "extraction-loop", failure: "KnowledgeModelRejected", overrides: { extraction: { run: async () => Promise.reject({ kind: "KnowledgeModelRejected" }) } } },
    { name: "quiz generation", state: "per-point-quiz-loop", failure: "QuizGenerationRejected", overrides: { knowledge: { list: async () => ({ ok: true, value: [point] }) }, quiz: { run: async () => Promise.reject({ kind: "QuizGenerationRejected" }) } } },
    { name: "media", state: "extraction-loop", failure: "MediaDependencyRejected", overrides: { extraction: { run: async () => Promise.reject({ kind: "MediaDependencyRejected" }) } } },
  ];
  for (const testCase of cases) {
    const executor = createKnowledgeWorkflowExecutor(/** @type {import("../src/features/knowledge-workflows/executor.js").WorkflowExecutorDependencies} */ ({
      classification: { ensure: async () => ({ ok: true, value: null }) },
      transition: async ({ run: current, nextState }) => ({ ok: true, value: { ...current, state: nextState, revision: current.revision + 1 } }),
      robots: { check: async () => ({ ok: true, value: {} }) },
      extraction: { run: async () => ({ ok: true, value: { state: "completed", scratchpad: {}, knowledgePointCount: 1, pagesProcessed: 1 } }) },
      knowledge: { list: async () => ({ ok: true, value: [point] }) },
      quiz: { run: async () => ({ ok: true, value: { dispositions: [{ knowledgeId: point.id, status: "accepted", publicationStatus: "published", attempts: 1, failureKind: null, restrictedUntil: null }] } }) },
      logger: () => {},
      ...testCase.overrides,
    }));
    const result = await executor.run({ run: run(/** @type {import("../src/features/knowledge-workflows/workflow.js").WorkflowState} */ (testCase.state)), rootUrl: "https://example.test/learn", rightsAssessment: rights() });
    assertEquals(result.ok, false);
    if (!result.ok) assertEquals(result.error.detailKind, testCase.failure);
  }
  /** @type {import("../src/features/knowledge-workflows/executor.js").WorkflowExecutorDependencies & { readonly cleanup: { readonly close: () => Promise<never> } }} */
  const cleanupDependencies = {
    classification: { ensure: async () => ({ ok: true, value: null }) },
    transition: async ({ run: current, nextState }) => ({ ok: true, value: { ...current, state: nextState, revision: current.revision + 1 } }),
    robots: { check: async () => ({ ok: true, value: {} }) },
    extraction: { run: async () => ({ ok: true, value: { state: "completed", scratchpad: {}, knowledgePointCount: 1, pagesProcessed: 1 } }) },
    knowledge: { list: async () => ({ ok: true, value: [point] }) },
    quiz: { run: async () => ({ ok: true, value: { dispositions: [{ knowledgeId: point.id, status: "accepted", publicationStatus: "published", attempts: 1, failureKind: null, restrictedUntil: null }] } }) },
    cleanup: { close: async () => Promise.reject({ kind: "CleanupDependencyRejected" }) },
    logger: () => {},
  };
  for(const close of [async()=>({ok:/** @type {const} */(false),error:{kind:'KnowledgeBrowserSessionCloseFailed'}}),async()=>{throw new Error('Synthetic cleanup failure');}]) {
    /** @type {Parameters<import("../src/features/knowledge-workflows/executor.js").WorkflowExecutorDependencies["logger"]>[0][]} */ const events=[];
    const failed=createKnowledgeWorkflowExecutor({...cleanupDependencies,quiz:{run:async()=>({ok:false,error:{kind:'OriginalQuizFailure'}})},cleanup:{close},logger:entry=>events.push(entry)});
    const result=await failed.run({run:run('per-point-quiz-loop'),rootUrl:'https://example.test/learn',rightsAssessment:rights()});
    assertEquals(result.ok,false);
    if(!result.ok)assertEquals(result.error.detailKind,'OriginalQuizFailure');
    assert(events.some(entry=>entry.stage==='cleanup'&&entry.event.endsWith('failure')),'Cleanup failure remains logged');
  }
  const cleanup = createKnowledgeWorkflowExecutor(cleanupDependencies);
  const cleanupResult = await cleanup.run({ run: run("per-point-quiz-loop"), rootUrl: "https://example.test/learn", rightsAssessment: rights() });
  assertEquals(cleanupResult.ok, false);
  if (!cleanupResult.ok) {
    assertEquals(cleanupResult.error.stage, "cleanup");
    assertEquals(cleanupResult.error.causeKind, "WorkflowCleanupFailed");
    assertEquals(cleanupResult.error.detailKind, "CleanupDependencyRejected");
  }
});

Deno.test("6 post-persistence publication failure remains explicitly resumable and never partially published", async () => {
  const transitions = /** @type {string[]} */ ([]);
  const publications = /** @type {unknown[]} */ ([]);
  const persisted = { id: "knowledge-a", sourceId: "source-a", sourceRevision: 1, summary: "Persisted before quiz publication", normalizedHash: "hash-a", evidenceAnchors: [{ url: "https://example.test/learn", selector: "main" }], coverageGoalIds: [], mediaCandidates: [], attribution: { sourceUrl: "https://example.test/learn" }, extractionVersion: "v1" };
  const executor = createKnowledgeWorkflowExecutor({ classification: { ensure: async () => ({ ok: true, value: null }) },
    transition: async ({ run: current, nextState }) => { transitions.push(nextState); return { ok: true, value: { ...current, state: nextState, revision: current.revision + 1 } }; },
    robots: { check: async () => ({ ok: true, value: {} }) },
    extraction: { run: async () => ({ ok: true, value: { state: "completed", scratchpad: {}, knowledgePointCount: 1, pagesProcessed: 1 } }) },
    knowledge: { list: async () => ({ ok: true, value: [persisted] }) },
    quiz: { run: async () => ({ ok: false, error: { kind: "QuizPublicationFailed" } }) },
    logger: () => {},
  });
  const result = await executor.run({ run: run("extraction-finalized"), rootUrl: "https://example.test/learn", rightsAssessment: rights() });
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.error.detailKind, "QuizPublicationFailed");
    assertEquals(/** @type {{ readonly resumableState?: string }} */ (result.error).resumableState, "per-point-quiz-loop");
  }
  assertEquals(transitions.join(","), "per-point-quiz-loop");
  assertEquals(publications.length, 0);
  assertEquals(persisted.summary, "Persisted before quiz publication");
});

Deno.test("7 composed authorized Browser extraction preserves identity and exact evidence through private quiz publication", async () => {
  const stored = /** @type {{ readonly ownerId: string, readonly runId: string, readonly point: import("../src/features/knowledge-workflows/extraction.js").KnowledgePoint }[]} */ ([]);
  const attempts = /** @type {import("../src/features/knowledge-workflows/quiz.js").QuizAttempt[]} */ ([]);
  const publications = /** @type {unknown[]} */ ([]);
  const evidenceUrl = "https://example.test/learn";
  const extraction = createExtractionRunner({
    rights: { status: "allowed", sourceId: "source-a", sourceRevision: 1 }, robots: { status: "allowed" },
    planner: {
      plan: async () => ({ ok: true, value: { revision: 1, frontier: [evidenceUrl], coverageGoals: [{ id: "goal-a", priority: "high", description: "Learn the exact concept." }], unresolvedGaps: [], stopDecision: { decision: "continue", rationale: "The authorized page must be observed.", evidenceUrls: [], unresolvedGapIds: [] } } }),
      replan: async () => ({ ok: true, value: { revision: 2, frontier: [], coverageGoals: [{ id: "goal-a", priority: "high", description: "Learn the exact concept." }], unresolvedGaps: [], stopDecision: { decision: "complete", rationale: "The authorized page and goal are covered.", evidenceUrls: [evidenceUrl], unresolvedGapIds: [] } } }),
    },
    acquirer: { fetchPage: async () => ({ ok: true, value: { url: evidenceUrl, title: "Authorized lesson", byteCount: 128, redirects: 0, links: [], observedAt: "2026-08-13T00:00:00.000Z", candidates: [{ summary: "A cadence closes a phrase.", normalizedHash: "cadence", evidenceAnchors: [{ url: evidenceUrl, selector: "main" }], coverageGoalIds: ["goal-a"], mediaCandidates: [], classification: { version: 1, primarySubject: "music", secondarySubjects: [], subcategory: "cadence" } }] } }) },
    scratchpad: { load: async (scope) => ({ ok: true, value: { ...scope, processedUrls: [], acceptedHashes: [], similarityEvidence: [], coverage: [], unresolvedGaps: [], consecutiveNoveltyZero: 0, revision: 1 } }), save: async () => ({ ok: true, value: null }) },
    knowledge: { append: async (point) => { stored.push({ ownerId: "owner-a", runId: "run-a", point }); return { ok: true, value: null }; } },
    now: () => "2026-08-13T00:00:00.000Z", nowMs: () => 1, logger: () => {}, policy: { maximumFrontier: 10, maximumPageBytes: 1_000, maximumRedirects: 0, maximumPages: 5, maximumDurationMs: 100 },
  });
  const quiz = createQuizActorCritic({
    generator: { generate: async ({ knowledge }) => ({ ok: true, value: { id: "quiz-a", knowledgeId: knowledge.id, knowledgeRevision: knowledge.sourceRevision, kind: "single-choice", prompt: "What closes a phrase?", options: ["A cadence", "A pickup"], answer: "A cadence", citedEvidenceUrls: knowledge.evidenceAnchors.map((anchor) => anchor.url) } }) },
    reviewer: { evaluate: async () => ({ ok: true, value: { score: 9, reasons: ["Exact concept and evidence."], feedback: "Keep the exact evidence.", groundingProblems: [] } }) },
    repository: { findPublished: async () => ({ ok: true, value: null }), appendAttempt: async (attempt) => { attempts.push(attempt); return { ok: true, value: null }; }, publish: async (command) => { publications.push(command); return { ok: true, value: null }; }, restrict: async () => ({ ok: true, value: null }), discard: async () => ({ ok: true, value: null }), purge: async () => ({ ok: true, value: null }) },
    now: () => "2026-08-13T00:00:00.000Z", logger: () => {}, maxAttempts: 3,
  });
  let current = run("robots-check");
  let cleanupCalls = 0;
  /** @type {import("../src/features/knowledge-workflows/executor.js").WorkflowExecutorDependencies & { readonly cleanup: { readonly close: () => Promise<{ readonly ok: true, readonly value: null }> } }} */
  const executorDependencies = {
    classification: { ensure: async () => ({ ok: true, value: null }) },
    transition: async ({ run: active, nextState, counts }) => ({ ok: true, value: current = { ...active, state: nextState, revision: active.revision + 1, counts: counts ?? active.counts } }),
    robots: { check: async () => ({ ok: true, value: {} }) },
    extraction: { run: async () => extraction.run({ ownerId: current.ownerId, runId: current.runId, sourceId: current.sourceId, sourceRevision: current.sourceRevision, rootUrl: evidenceUrl, startedAtMs: 0, deadlineAtMs: 100 }) },
    knowledge: { list: async (scope) => ({ ok: true, value: stored.filter((entry) => entry.ownerId === scope.ownerId && entry.runId === scope.runId && entry.point.sourceId === scope.sourceId && entry.point.sourceRevision === scope.sourceRevision).map((entry) => entry.point) }) },
    quiz: { run: (command) => quiz.run(command) }, cleanup: { close: async () => { cleanupCalls += 1; return { ok: true, value: null }; } }, logger: () => {},
  };
  const executor = createKnowledgeWorkflowExecutor(executorDependencies);
  const result = await executor.run({ run: current, rootUrl: evidenceUrl, rightsAssessment: rights() });
  assertEquals(result.ok, true);
  if (result.ok) assertEquals(result.value.state, "completed");
  assertEquals(cleanupCalls, 1);
  assertEquals(stored.length, 1);
  assertEquals(`${stored[0].ownerId}|${stored[0].runId}|${stored[0].point.sourceId}|${stored[0].point.sourceRevision}`, "owner-a|run-a|source-a|1");
  assertEquals(stored[0].point.evidenceAnchors[0].url, evidenceUrl);
  assertEquals(attempts[0].ownerId, "owner-a");
  assertEquals(attempts[0].runId, "run-a");
  const publication = /** @type {{ readonly knowledge: import("../src/features/knowledge-workflows/extraction.js").KnowledgePoint, readonly draft: import("../src/features/knowledge-workflows/quiz.js").QuestionDraft }} */ (publications[0]);
  assertEquals(publication.knowledge.id, stored[0].point.id);
  assertEquals(publication.draft.knowledgeRevision, stored[0].point.sourceRevision);
  assertEquals(publication.draft.citedEvidenceUrls[0], stored[0].point.evidenceAnchors[0].url);
});

Deno.test("8 composition failures and repository results cannot cross owner, source, revision, or run boundaries", async () => {
  const unauthorized = { id: "knowledge-x", ownerId: "owner-b", runId: "run-b", sourceId: "source-b", sourceRevision: 2, summary: "Unauthorized", normalizedHash: "hash-x", evidenceAnchors: [{ url: "https://other.example/", selector: "main" }], coverageGoalIds: [], mediaCandidates: [], attribution: { sourceUrl: "https://other.example/" }, extractionVersion: "v1" };
  let quizCalls = 0;
  const executor = createKnowledgeWorkflowExecutor({ classification: { ensure: async () => ({ ok: true, value: null }) },
    transition: async ({ run: active, nextState }) => ({ ok: true, value: { ...active, state: nextState, revision: active.revision + 1 } }),
    robots: { check: async () => ({ ok: true, value: {} }) },
    extraction: { run: async () => ({ ok: true, value: { state: "completed", scratchpad: {}, knowledgePointCount: 1, pagesProcessed: 1 } }) },
    knowledge: { list: async (scope) => { assertEquals(`${scope.ownerId}|${scope.runId}|${scope.sourceId}|${scope.sourceRevision}`, "owner-a|run-a|source-a|1"); return { ok: true, value: [/** @type {import("../src/features/knowledge-workflows/extraction.js").KnowledgePoint} */ (unauthorized)] }; } },
    quiz: { run: async () => { quizCalls += 1; return { ok: true, value: { dispositions: [] } }; } }, logger: () => {},
  });
  const result = await executor.run({ run: run("per-point-quiz-loop"), rootUrl: "https://example.test/learn", rightsAssessment: rights() });
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error.causeKind, "WorkflowKnowledgeScopeInvalid");
  assertEquals(quizCalls, 0);

  for (const [kind, stage] of [["KnowledgeModelUnavailable", "extraction-loop"], ["MediaDependencyRejected", "extraction-loop"], ["KnowledgeRepositoryRejected", "per-point-quiz-loop"], ["QuizRepositoryRejected", "per-point-quiz-loop"]]) {
    let quizDispatches = 0;
    const failed = createKnowledgeWorkflowExecutor({ classification: { ensure: async () => ({ ok: true, value: null }) },
      transition: async ({ run: active, nextState }) => ({ ok: true, value: { ...active, state: nextState, revision: active.revision + 1 } }), robots: { check: async () => ({ ok: true, value: {} }) },
      extraction: { run: async () => stage === "extraction-loop" ? Promise.reject({ kind }) : ({ ok: true, value: { state: "completed", scratchpad: {}, knowledgePointCount: 1, pagesProcessed: 1 } }) },
      knowledge: { list: async () => stage === "per-point-quiz-loop" && kind === "KnowledgeRepositoryRejected" ? Promise.reject({ kind }) : ({ ok: true, value: [{ ...unauthorized, ownerId: "owner-a", runId: "run-a", sourceId: "source-a", sourceRevision: 1 }] }) },
      quiz: { run: async () => { quizDispatches += 1; return Promise.reject({ kind }); } }, logger: () => {},
    });
    const failure = await failed.run({ run: run(/** @type {import("../src/features/knowledge-workflows/workflow.js").WorkflowState} */ (stage)), rootUrl: "https://example.test/learn", rightsAssessment: rights() });
    assertEquals(failure.ok, false);
    assertEquals(quizDispatches, kind === "QuizRepositoryRejected" ? 1 : 0);
  }
});

Deno.test("9 unit 2 preserves fail-closed rights, deterministic quiz publication, and untouched Browser, logging, and media seams", async () => {
  let sideEffects = 0;
  const executor = createKnowledgeWorkflowExecutor({ classification: { ensure: async () => ({ ok: true, value: null }) },
    transition: async () => { sideEffects += 1; return { ok: false, error: { kind: "unexpected" } }; }, robots: { check: async () => { sideEffects += 1; return { ok: true, value: {} }; } }, extraction: { run: async () => { sideEffects += 1; return { ok: false, error: { kind: "unexpected" } }; } }, knowledge: { list: async () => { sideEffects += 1; return { ok: true, value: [] }; } }, quiz: { run: async () => { sideEffects += 1; return { ok: true, value: { dispositions: [] } }; } }, logger: () => {},
  });
  const wrongOwnerRights = { ...rights(), ownerId: "owner-b" };
  const denied = await executor.run({ run: run("robots-check"), rootUrl: "https://example.test/learn", rightsAssessment: wrongOwnerRights });
  assertEquals(denied.ok, false);
  if (!denied.ok) assertEquals(denied.error.causeKind, "WorkflowRightsRequired");
  assertEquals(sideEffects, 0);

  const statuses = /** @type {string[]} */ ([]);
  const actor = createQuizActorCritic({ generator: { generate: async ({ knowledge }) => ({ ok: true, value: { id: "stable", knowledgeId: knowledge.id, knowledgeRevision: knowledge.sourceRevision, kind: "fill-blank", prompt: "A cadence closes a ___.", options: [], answer: "phrase", citedEvidenceUrls: ["https://example.test/learn"] } }) }, reviewer: { evaluate: async () => ({ ok: true, value: { score: 8, reasons: ["Grounded"], feedback: "Keep", groundingProblems: [] } }) }, repository: { findPublished: async () => ({ ok: true, value: null }), appendAttempt: async () => ({ ok: true, value: null }), publish: async ({ status }) => { statuses.push(status); return { ok: true, value: null }; }, restrict: async () => ({ ok: true, value: null }), discard: async () => ({ ok: true, value: null }), purge: async () => ({ ok: true, value: null }) }, now: () => "2026-08-13T00:00:00.000Z", logger: () => {}, maxAttempts: 3 });
  const quizPoint = { id: "knowledge-a", sourceId: "source-a", sourceRevision: 1, summary: "A cadence closes a phrase.", normalizedHash: "hash-a", evidenceAnchors: [{ url: "https://example.test/learn", selector: "main" }], coverageGoalIds: [], mediaCandidates: [], attribution: { sourceUrl: "https://example.test/learn" }, extractionVersion: "v1" };
  await actor.run({ ownerId: "owner-a", runId: "run-a", points: [quizPoint] });
  await actor.run({ ownerId: "owner-a", runId: "run-a", points: [quizPoint] });
  assertEquals(statuses.join(","), "published,published");
  assert(!JSON.stringify(statuses).includes("private"), "Regression output must remain content-free.");
});

Deno.test("executor classifies the complete consolidated source exactly once before quiz publication", async () => {
  /** @type {string[]} */ const calls = [];
  let classifyFails = false;
  const point = { id: "k-a", sourceId: "source-a", sourceRevision: 1, summary: "A cadence resolves.", normalizedHash: "h-a", evidenceAnchors: [{ url: "https://example.test/learn", selector: "main" }], coverageGoalIds: [], mediaCandidates: [], attribution: { sourceUrl: "https://example.test/learn" }, extractionVersion: "v1" };
  const executor = createKnowledgeWorkflowExecutor({
    transition: async ({ run: active, nextState }) => ({ ok: true, value: { ...active, state: nextState } }),
    robots: { check: async () => ({ ok: true, value: {} }) },
    extraction: { run: async () => ({ ok: true, value: { state: "completed", scratchpad: {}, knowledgePointCount: 1, pagesProcessed: 2 } }) },
    knowledge: { list: async () => ({ ok: true, value: [point] }) },
    classification: { ensure: async ({ points }) => { calls.push(`classify:${points.length}`); return classifyFails ? {ok:false,error:{kind:"SourceClassificationInferenceFailed"}} : { ok: true, value: null }; } },
    quiz: { run: async ({ points }) => { calls.push(`quiz:${points.length}`); return { ok: true, value: { dispositions: [{ knowledgeId: "k-a", status: "accepted", publicationStatus: "published", attempts: 1, failureKind: null, restrictedUntil: null }] } }; } },
    logger: () => {},
  });
  const result = await executor.run({ run: run("extraction-finalized"), rootUrl: "https://example.test/learn" });
  assertEquals(result.ok, true);
  assertEquals(calls.join(","), "classify:1,quiz:1");
  classifyFails = true;
  calls.length = 0;
  const failed = await executor.run({run:run("extraction-finalized"),rootUrl:"https://example.test/learn"});
  assertEquals(failed.ok,false);
  assertEquals(calls.join(","),"classify:1");
  if (!failed.ok) {
    assertEquals(failed.error.causeKind,"WorkflowSourceClassificationFailed");
    assertEquals(failed.error.detailKind,"SourceClassificationInferenceFailed");
  }

});

Deno.test("executor checkpoints one quiz chunk and completes only after the remaining points", async () => {
  let more = true;
  const initial = {...run("per-point-quiz-loop"),failureKind:"WorkflowPagesFailed",counts:{pages:3,knowledgePoints:2,acceptedQuizzes:0,pendingQuizzes:0}};
  const executor = createKnowledgeWorkflowExecutor({
    transition:async ({run:current,nextState,counts,failureKind})=>({ok:true,value:{...current,state:nextState,revision:current.revision+1,counts:counts??current.counts,failureKind:failureKind??current.failureKind}}),
    robots:{check:async()=>{throw new Error("Do not restart acquisition");}}, extraction:{run:async()=>{throw new Error("Do not restart extraction");}},
    knowledge:{list:async()=>({ok:true,value:[{id:"knowledge-a",sourceId:"source-a",sourceRevision:1,summary:"Specific",normalizedHash:"hash-a",evidenceAnchors:[{url:"https://example.test/learn",selector:"#a"}],coverageGoalIds:[],mediaCandidates:[],attribution:{sourceUrl:"https://example.test/learn"},extractionVersion:"v1"}]})},
    classification:{ensure:async()=>({ok:true,value:null})},
    quiz:{run:async()=>({ok:true,value:{hasMore:more,dispositions:[{knowledgeId:"knowledge-a",status:"accepted",publicationStatus:"published",attempts:1,failureKind:null,restrictedUntil:null}]}})},logger:()=>{},
  });
  const chunk = await executor.run({run:initial,rootUrl:initial.canonicalSourceIdentity});
  assert(chunk.ok,"First quiz chunk must succeed");if(!chunk.ok)return;
  assertEquals(chunk.value.state,"per-point-quiz-loop");assertEquals(chunk.value.run.counts.acceptedQuizzes,1);assertEquals(chunk.value.run.failureKind,"WorkflowPagesFailed");
  more=false;
  const completed=await executor.run({run:chunk.value.run,rootUrl:initial.canonicalSourceIdentity});
  assert(completed.ok,"Last quiz chunk must succeed");if(!completed.ok)return;
  assertEquals(completed.value.state,"completed");assertEquals(completed.value.run.counts.knowledgePoints,2);assertEquals(completed.value.run.failureKind,"WorkflowPagesFailed");
});

Deno.test('a committed point starts its quiz while extraction continues, and the page stays incomplete',async()=>{
 let extracting=true,quizStarted=false,quizFinished=false;
 /** @type {()=>void} */let release=()=>{};
 const gate=new Promise(resolve=>{release=()=>resolve(undefined);});
 const point={id:'knowledge-a',sourceId:'source-a',sourceRevision:1,summary:'A supported relationship',normalizedHash:'a',evidenceAnchors:[{url:'https://example.test/learn',selector:'p'}],coverageGoalIds:[],mediaCandidates:[],attribution:{sourceUrl:'https://example.test/learn'},extractionVersion:'v1'};
 const executor=createKnowledgeWorkflowExecutor({
  transition:async({run:current,nextState,counts})=>{assertEquals(quizFinished,true);return {ok:true,value:{...current,state:nextState,revision:current.revision+1,counts:counts??current.counts}};},
  robots:{check:async()=>({ok:true,value:{}})},
  extraction:{run:async command=>{
   command.onKnowledge?.();
   await gate;assertEquals(quizStarted,true);assertEquals(quizFinished,false);extracting=false;
   return {ok:true,value:{state:'awaiting-time-limit-decision',scratchpad:{},knowledgePointCount:1,pagesProcessed:0}};
  }},
  knowledge:{list:async()=>({ok:true,value:[point]})},
  classification:{ensure:async command=>{assertEquals(command.incremental,true);return {ok:true,value:null};}},
  quiz:{run:async()=>{
   assertEquals(extracting,true);quizStarted=true;release();await Promise.resolve();await Promise.resolve();quizFinished=true;
   return {ok:true,value:{dispositions:[{knowledgeId:point.id,status:'accepted',publicationStatus:'published',attempts:1,failureKind:null,restrictedUntil:null}]}};
  }},logger:()=>{},
 });
 const result=await executor.run({run:run('extraction-loop'),rootUrl:'https://example.test/learn',rightsAssessment:rights()});
 if(!result.ok)throw Error(JSON.stringify(result.error));assertEquals(result.value.state,'awaiting-time-limit-decision');assertEquals(result.value.run.counts.knowledgePoints,1);assertEquals(result.value.run.counts.acceptedQuizzes,1);assertEquals(result.value.run.counts.pages,0);
});
