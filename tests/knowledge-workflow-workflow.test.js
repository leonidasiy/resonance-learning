// @ts-check

import { createKnowledgeWorkflowService } from "../src/features/knowledge-workflows/workflow.js";

/** @template T @param {T} actual @param {T} expected */
function assertEquals(actual, expected) {
  if (!Object.is(actual, expected)) throw new Error(`Expected ${String(expected)}, received ${String(actual)}.`);
}

/** @param {import("../src/features/knowledge-workflows/workflow.js").WorkflowDependencies["cleanup"]} [cleanup] */
function setup(cleanup = undefined) {
  /** @type {import("../src/features/knowledge-workflows/workflow.js").KnowledgeWorkflowRun[]} */
  const runs = [];
  /** @type {{ readonly idempotencyKey: string, readonly fingerprint: string, readonly run: import("../src/features/knowledge-workflows/workflow.js").KnowledgeWorkflowRun }[]} */
  const controls = [];
  /** @type {import("../src/features/knowledge-workflows/workflow.js").GlobalSourceReuse[]} */
  const manifests = [];
  /** @type {import("../src/features/knowledge-workflows/workflow.js").GlobalSourceReuse | null} */
  let globalReuse = null;
  /** @type {import("../src/features/knowledge-workflows/workflow.js").WorkflowRepository} */
  const repo = {
    /** @param {string} ownerId @param {string} key */
    async findByIdempotency(ownerId, key) { return { ok: true, value: runs.find((run) => run.ownerId === ownerId && run.idempotencyKey === key) ?? null }; },
    /** @param {string} ownerId @param {string} runId */
    async findById(ownerId, runId) { return { ok: true, value: runs.find((run) => run.ownerId === ownerId && run.runId === runId) ?? null }; },
    /** @param {string} ownerId @param {string} sourceId @param {number} sourceRevision */
    async findLatestBySource(ownerId, sourceId, sourceRevision) {
      return { ok: true, value: runs.filter((run) => run.ownerId === ownerId && run.sourceId === sourceId && run.sourceRevision === sourceRevision).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null };
    },
    async findGlobalReuse() { return { ok: true, value: globalReuse }; },
    /** @param {import("../src/features/knowledge-workflows/workflow.js").GlobalSourceReuse & { readonly createdAt: string, readonly updatedAt: string }} reuse */
    async markReuse(reuse) { manifests.push(reuse); return { ok: true, value: null }; },
    /** @param {import("../src/features/knowledge-workflows/workflow.js").KnowledgeWorkflowRun} run */
    async insert(run) { if (runs.some(existing => existing.ownerId === run.ownerId && existing.idempotencyKey === run.idempotencyKey)) return {ok:false,error:{kind:"WorkflowIdempotencyConflict"}}; runs.push(run); return { ok: true, value: null }; },
    /** @param {{ readonly ownerId: string, readonly runId: string, readonly expectedRevision: number, readonly next: import("../src/features/knowledge-workflows/workflow.js").KnowledgeWorkflowRun }} command */
    async update(command) {
      const index = runs.findIndex((run) => run.ownerId === command.ownerId && run.runId === command.runId && run.revision === command.expectedRevision);
      if (index < 0) return { ok: false, error: { kind: "WorkflowControlStale" } };
      runs[index] = command.next;
      return { ok: true, value: command.next };
    },
    /** @param {string} ownerId @param {string} key */
    async findControl(ownerId, key) { return { ok: true, value: controls.find((control) => control.run.ownerId === ownerId && control.idempotencyKey === key) ?? null }; },
    /** @param {{ readonly fingerprint: string, readonly run: import("../src/features/knowledge-workflows/workflow.js").KnowledgeWorkflowRun, readonly idempotencyKey: string }} command */
    async recordControl(command) { controls.push({ idempotencyKey: command.idempotencyKey, fingerprint: command.fingerprint, run: command.run }); return { ok: true, value: null }; },
  };
  let currentNow = "2026-08-13T00:00:00.000Z";
  return {
    runs,
    manifests,
    /** @param {string} value */
    setNow(value) { currentNow = value; },
    /** @param {import("../src/features/knowledge-workflows/workflow.js").GlobalSourceReuse | null} value */
    setGlobalReuse(value) { globalReuse = value; },
    service: createKnowledgeWorkflowService(repo, { now: () => currentNow, createId: () => `run-${runs.length + 1}`, logger: () => {}, ...(cleanup === undefined ? {} : { cleanup }) }),
  };
}

/** @param {{ readonly createRun: (command: unknown) => Promise<import("../src/features/knowledge-workflows/workflow.js").Result<{ readonly run: import("../src/features/knowledge-workflows/workflow.js").KnowledgeWorkflowRun, readonly reused: boolean }, import("../src/features/knowledge-workflows/workflow.js").WorkflowFailure>> }} service */
async function createRun(service) {
  const result = await service.createRun({
    ownerId: "owner-a",
    sourceId: "source-a",
    sourceRevision: 1,
    canonicalSourceIdentity: "https://example.test/source",
    contentSignature: "sha256:source-a",
    configDigests: { "knowledge-scraper": "sha256:config" },
    idempotencyKey: "source-add-1",
  });
  if (!result.ok) throw new Error(`Run creation failed: ${result.error.kind}`);
  return result.value;
}

Deno.test("workflow creates one idempotent run and transitions into a timed extraction loop", async () => {
  const fixture = setup();
  const created = await createRun(fixture.service);
  const run = created.run;
  const replay = await createRun(fixture.service);
  assertEquals(replay.run.runId, run.runId);
  assertEquals(replay.reused, true);
  const assessed = await fixture.service.advance({ ownerId: "owner-a", runId: run.runId, expectedRevision: 1, nextState: "rights-assessment" });
  assertEquals(assessed.ok, true);
  if (!assessed.ok) return;
  const awaiting = await fixture.service.advance({ ownerId: "owner-a", runId: run.runId, expectedRevision: 2, nextState: "awaiting-rights-review" });
  assertEquals(awaiting.ok, true);
  const approved = await fixture.service.rightsApproved({ ownerId: "owner-a", sourceId: "source-a", sourceRevision: 1 });
  assertEquals(approved.ok, true);
  if (!approved.ok) return;
  const extracting = await fixture.service.advance({ ownerId: "owner-a", runId: run.runId, expectedRevision: 4, nextState: "extraction-loop" });
  assertEquals(extracting.ok, true);
  if (!extracting.ok) return;
  assertEquals(extracting.value.state, "extraction-loop");
  assertEquals(extracting.value.extractionDeadlineAt, "2026-08-13T00:30:00.000Z");
});

Deno.test("workflow validates unknown authorization timestamps and bindings before persistence", async () => {
 const command = { ownerId: "owner-a", sourceId: "source-a", sourceRevision: 1, canonicalSourceIdentity: "https://example.test/source", contentSignature: "sha256:source-a", configDigests: { "knowledge-scraper": "sha256:config" }, idempotencyKey: "authorized-link" };
 const authorization = { kind: "user-authorized-link", ownerId: command.ownerId, sourceId: command.sourceId, sourceRevision: 1, url: command.canonicalSourceIdentity, recordedAt: "2026-10-05T00:00:00.000Z" };
 for (const recordedAt of [undefined, null, 42, {}, [], "", "not-a-date"]) {
  const f = setup(); const result = await f.service.createRun({ ...command, userAuthorization: { ...authorization, recordedAt } });
  if (result.ok || result.error.kind !== "WorkflowCommandInvalid" || result.error.field !== "userAuthorization" || f.runs.length !== 0) throw new Error("Malformed timestamp persisted.");
 }
 for (const change of [{ ownerId: "owner-b" }, { sourceId: "source-b" }, { sourceRevision: 2 }, { url: "https://other.example/" }]) {
  const result = await setup().service.createRun({ ...command, userAuthorization: { ...authorization, ...change } });
  if (result.ok || result.error.kind !== "WorkflowCommandInvalid") throw new Error("Mismatched authorization accepted.");
 }
 const f = setup(); const result = await f.service.createRun({ ...command, userAuthorization: authorization });
 if (!result.ok || result.value.run.userAuthorization?.recordedAt !== authorization.recordedAt) throw new Error("Valid timestamp rejected.");
});

Deno.test("server-owned private document origin starts directly awaiting authorized upload", async () => {
  const fixture = setup();
  const result = await fixture.service.createRun({ ownerId: "owner-a", sourceId: "source-private", sourceRevision: 1, canonicalSourceIdentity: "https://app.example/api/private-documents/source-private", contentSignature: "source-revision:https://app.example/api/private-documents/source-private:1", configDigests: {}, idempotencyKey: "private-source-1", sourceOrigin: "private-document" });
  assertEquals(result.ok, true);
  if (!result.ok) throw new Error(result.error.kind);
  assertEquals(result.value.run.state, "awaiting-upload");
  const urlRun=await fixture.service.createRun({ownerId:"owner-a",sourceId:"source-url",sourceRevision:1,canonicalSourceIdentity:"https://publisher.example/lesson",contentSignature:"url-material:1",configDigests:{},idempotencyKey:"url-material:1",sourceOrigin:"url-material"});
  assertEquals(urlRun.ok,true);if(urlRun.ok){assertEquals(urlRun.value.run.state,"awaiting-upload");assertEquals(urlRun.value.run.canonicalSourceIdentity,"https://publisher.example/lesson");}
  const rejected = await fixture.service.createRun({ ownerId: "owner-a", sourceId: "source-private-2", sourceRevision: 1, canonicalSourceIdentity: "https://app.example/api/private-documents/source-private-2", contentSignature: "source-revision:2", configDigests: {}, idempotencyKey: "private-source-2", sourceOrigin: "web" });
  assertEquals(rejected.ok, false);
  if (!rejected.ok) assertEquals(rejected.error.kind, "WorkflowCommandInvalid");
});

Deno.test("workflow persists bounded robots evidence with the extraction transition", async () => {
  const fixture = setup();
  const run = (await createRun(fixture.service)).run;
  const approved = await fixture.service.rightsApproved({ ownerId: "owner-a", sourceId: "source-a", sourceRevision: 1 });
  if (!approved.ok) throw new Error(approved.error.kind);
  const evidence = {
    robotsUrl: "https://example.test/robots.txt",
    targetUrl: "https://example.test/source",
    httpStatus: 404,
    availability: "absent",
    content: "",
    checkedAt: "2026-08-13T00:00:00.000Z",
    matchedRule: null,
  };
  const extracting = await fixture.service.advance({ ownerId: "owner-a", runId: run.runId, expectedRevision: approved.value.revision, nextState: "extraction-loop", robotsEvidence: evidence });
  assertEquals(extracting.ok, true);
  if (extracting.ok) {
    assertEquals(extracting.value.robotsEvidence?.availability, "absent");
    assertEquals(extracting.value.robotsEvidence?.httpStatus, 404);
  }
});

Deno.test("authorized material attaches only after rights fail closed to the upload state", async () => {
  const fixture = setup();
  const run = (await createRun(fixture.service)).run;
  const rightsAssessment = await fixture.service.advance({ ownerId: "owner-a", runId: run.runId, expectedRevision: 1, nextState: "rights-assessment" });
  if (!rightsAssessment.ok) throw new Error(rightsAssessment.error.kind);
  const awaiting = await fixture.service.advance({ ownerId: "owner-a", runId: run.runId, expectedRevision: 2, nextState: "awaiting-upload" });
  if (!awaiting.ok) throw new Error(awaiting.error.kind);
  const attached = await fixture.service.attachMaterial({ ownerId: "owner-a", runId: run.runId, materialId: "material-a" });
  if (!attached.ok) throw new Error(attached.error.kind);
  assertEquals(attached.value.state, "extraction-loop");
  assertEquals(attached.value.materialId, "material-a");
  const replay = await fixture.service.attachMaterial({ ownerId: "owner-a", runId: run.runId, materialId: "material-a" });
  if (!replay.ok) throw new Error(replay.error.kind);
  assertEquals(replay.value.revision, attached.value.revision);
  const finalized = await fixture.service.advance({ ownerId: "owner-a", runId: run.runId, expectedRevision: replay.value.revision, nextState: "extraction-finalized" });
  if (!finalized.ok) throw new Error(finalized.error.kind);
  const quiz = await fixture.service.advance({ ownerId: "owner-a", runId: run.runId, expectedRevision: finalized.value.revision, nextState: "per-point-quiz-loop" });
  if (!quiz.ok) throw new Error(quiz.error.kind);
  const completed = await fixture.service.advance({ ownerId: "owner-a", runId: run.runId, expectedRevision: quiz.value.revision, nextState: "completed" });
  if (!completed.ok) throw new Error(completed.error.kind);
  const completedReplay = await fixture.service.attachMaterial({ ownerId: "owner-a", runId: run.runId, materialId: "material-a" });
  if (!completedReplay.ok) throw new Error(completedReplay.error.kind);
  assertEquals(completedReplay.value.state, "completed");
});

Deno.test("a hard extraction block can move an active run to upload and records the reason", async () => {
  const fixture = setup();
  const run = (await createRun(fixture.service)).run;
  await fixture.service.rightsApproved({ ownerId: "owner-a", sourceId: "source-a", sourceRevision: 1 });
  const extracting = await fixture.service.advance({ ownerId: "owner-a", runId: run.runId, expectedRevision: 2, nextState: "extraction-loop" });
  if (!extracting.ok) throw new Error(extracting.error.kind);
  const blocked = await fixture.service.advance({ ownerId: "owner-a", runId: run.runId, expectedRevision: extracting.value.revision, nextState: "awaiting-upload", failureKind: "KnowledgePageBotAccessDenied" });
  assertEquals(blocked.ok, true);
  if (!blocked.ok) return;
  assertEquals(blocked.value.state, "awaiting-upload");
  assertEquals(blocked.value.failureKind, "KnowledgePageBotAccessDenied");
  const attached = await fixture.service.attachMaterial({ ownerId: "owner-a", runId: run.runId, materialId: "material-after-block" });
  assertEquals(attached.ok, true);
  if (attached.ok) assertEquals(attached.value.failureKind, null);
});

Deno.test("workflow persists a retryable planner failure and clears it when retry resumes extraction", async () => {
  const fixture = setup();
  const run = (await createRun(fixture.service)).run;
  await fixture.service.rightsApproved({ ownerId: "owner-a", sourceId: "source-a", sourceRevision: 1 });
  const extracting = await fixture.service.advance({ ownerId: "owner-a", runId: run.runId, expectedRevision: 2, nextState: "extraction-loop" });
  if (!extracting.ok) throw new Error(extracting.error.kind);
  const failed = await fixture.service.advance({ ownerId: "owner-a", runId: run.runId, expectedRevision: extracting.value.revision, nextState: "retryable-failure", failureKind: "ExtractionPlanInvalid" });
  assertEquals(failed.ok, true);
  if (!failed.ok) return;
  assertEquals(failed.value.state, "retryable-failure");
  assertEquals(failed.value.failureKind, "ExtractionPlanInvalid");
  const retried = await fixture.service.control({ ownerId: "owner-a", runId: run.runId, expectedRevision: failed.value.revision, action: "resume", idempotencyKey: "retry-plan-1" });
  assertEquals(retried.ok, true);
  if (!retried.ok) return;
  assertEquals(retried.value.state, "extraction-loop");
  assertEquals(retried.value.failureKind, null);
});

Deno.test("workflow retries rights and quiz failures at the saved stage without changing accumulated content", async () => {
  for (const state of /** @type {const} */ (["rights-assessment", "robots-check", "extraction-loop", "extraction-finalized", "per-point-quiz-loop"])) {
    const fixture = setup();
    const run = (await createRun(fixture.service)).run;
    fixture.runs[0] = {...run,state,counts:{pages:3,knowledgePoints:4,acceptedQuizzes:2,pendingQuizzes:0}};
    const failed = await fixture.service.advance({ownerId:run.ownerId,runId:run.runId,expectedRevision:run.revision,nextState:"retryable-failure",failureKind:"WorkflowExecutionStopped"});
    if (!failed.ok) throw new Error(`${state}: ${failed.error.kind}`);
    assertEquals(failed.value.retryState,state);
    const resumed = await fixture.service.control({ownerId:run.ownerId,runId:run.runId,expectedRevision:failed.value.revision,action:"resume",idempotencyKey:`retry-${state}`});
    if (!resumed.ok) throw new Error(resumed.error.kind);
    assertEquals(resumed.value.state,state);
    assertEquals(resumed.value.counts.knowledgePoints,4);
    assertEquals(resumed.value.counts.acceptedQuizzes,2);
    assertEquals(resumed.value.failureKind,null);
    const rolledBack=await fixture.service.advance({ownerId:run.ownerId,runId:run.runId,expectedRevision:resumed.value.revision,nextState:"retryable-failure",failureKind:"WorkflowInstanceControlFailed"});
    if (!rolledBack.ok) throw new Error(rolledBack.error.kind);
    assertEquals(rolledBack.value.retryState,state);
  }
});

Deno.test("workflow permits an automatic bounded extraction continuation before the deadline", async () => {
  const fixture = setup();
  const run = (await createRun(fixture.service)).run;
  await fixture.service.rightsApproved({ ownerId: "owner-a", sourceId: "source-a", sourceRevision: 1 });
  const extracting = await fixture.service.advance({ ownerId: "owner-a", runId: run.runId, expectedRevision: 2, nextState: "extraction-loop" });
  if (!extracting.ok) throw new Error(extracting.error.kind);
  const waiting = await fixture.service.advance({ ownerId: "owner-a", runId: run.runId, expectedRevision: extracting.value.revision, nextState: "awaiting-time-limit-decision", counts: { pages: 1, knowledgePoints: 2, acceptedQuizzes: 0, pendingQuizzes: 0 } });
  if (!waiting.ok) throw new Error(waiting.error.kind);
  const continued = await fixture.service.advance({ ownerId: "owner-a", runId: run.runId, expectedRevision: waiting.value.revision, nextState: "extraction-loop" });
  assertEquals(continued.ok, true);
  if (continued.ok) {
    assertEquals(continued.value.state, "extraction-loop");
    assertEquals(continued.value.counts.pages, 1);
    assertEquals(continued.value.counts.knowledgePoints, 2);
  }
});

Deno.test("workflow controls are revision-checked, idempotent, and fail closed", async () => {
  const fixture = setup();
  const run = (await createRun(fixture.service)).run;
  await fixture.service.rightsApproved({ ownerId: "owner-a", sourceId: "source-a", sourceRevision: 1 });
  await fixture.service.advance({ ownerId: "owner-a", runId: run.runId, expectedRevision: 2, nextState: "extraction-loop" });
  const stopped = await fixture.service.control({ ownerId: "owner-a", runId: run.runId, expectedRevision: 3, action: "stop", idempotencyKey: "stop-1" });
  assertEquals(stopped.ok, true);
  if (!stopped.ok) return;
  assertEquals(stopped.value.state, "paused");
  const replay = await fixture.service.control({ ownerId: "owner-a", runId: run.runId, expectedRevision: 3, action: "stop", idempotencyKey: "stop-1" });
  assertEquals(replay.ok, true);
  if (!replay.ok) return;
  assertEquals(replay.value.revision, stopped.value.revision);
  const stale = await fixture.service.control({ ownerId: "owner-a", runId: run.runId, expectedRevision: 2, action: "resume", idempotencyKey: "resume-stale" });
  assertEquals(stale.ok, false);
  if (!stale.ok) assertEquals(stale.error.kind, "WorkflowControlStale");
  const generated = await fixture.service.control({ ownerId: "owner-a", runId: run.runId, expectedRevision: 4, action: "generate", idempotencyKey: "generate-1" });
  assertEquals(generated.ok, true);
  if (!generated.ok) return;
  assertEquals(generated.value.state, "per-point-quiz-loop");
  const invalid = await fixture.service.control({ ownerId: "owner-a", runId: run.runId, expectedRevision: 5, action: "resume", idempotencyKey: "resume-invalid" });
  assertEquals(invalid.ok, false);
  if (!invalid.ok) assertEquals(invalid.error.kind, "WorkflowControlInvalid");
});

Deno.test("the exact extraction deadline permits only generate or abandon", async () => {
  const fixture = setup();
  const run = (await createRun(fixture.service)).run;
  await fixture.service.rightsApproved({ ownerId: "owner-a", sourceId: "source-a", sourceRevision: 1 });
  const extracting = await fixture.service.advance({ ownerId: "owner-a", runId: run.runId, expectedRevision: 2, nextState: "extraction-loop" });
  assertEquals(extracting.ok, true);
  if (!extracting.ok) return;
  fixture.setNow("2026-08-13T00:30:00.000Z");
  const stop = await fixture.service.control({ ownerId: "owner-a", runId: run.runId, expectedRevision: 3, action: "stop", idempotencyKey: "deadline-stop" });
  assertEquals(stop.ok, false);
  if (!stop.ok) assertEquals(stop.error.kind, "WorkflowControlInvalid");
  const generate = await fixture.service.control({ ownerId: "owner-a", runId: run.runId, expectedRevision: 3, action: "generate", idempotencyKey: "deadline-generate" });
  assertEquals(generate.ok, true);
  if (generate.ok) assertEquals(generate.value.state, "per-point-quiz-loop");
});

Deno.test("an expired extraction can be retried with a fresh bounded window", async () => {
  const fixture = setup();
  const run = (await createRun(fixture.service)).run;
  await fixture.service.rightsApproved({ ownerId: "owner-a", sourceId: "source-a", sourceRevision: 1 });
  const extracting = await fixture.service.advance({ ownerId: "owner-a", runId: run.runId, expectedRevision: 2, nextState: "extraction-loop" });
  if (!extracting.ok) throw new Error(extracting.error.kind);
  fixture.setNow("2026-08-13T00:30:00.000Z");
  const retried = await fixture.service.control({ ownerId: "owner-a", runId: run.runId, expectedRevision: extracting.value.revision, action: "resume", idempotencyKey: "resume-expired" });
  assertEquals(retried.ok, true);
  if (!retried.ok) return;
  assertEquals(retried.value.state, "extraction-loop");
  assertEquals(retried.value.extractionStartedAt, "2026-08-13T00:30:00.000Z");
  assertEquals(retried.value.extractionDeadlineAt, "2026-08-13T01:00:00.000Z");
  assertEquals(retried.value.failureKind, null);
  const stale = await fixture.service.control({ ownerId: "owner-a", runId: run.runId, expectedRevision: extracting.value.revision, action: "resume", idempotencyKey: "resume-expired-stale" });
  assertEquals(stale.ok, false);
  if (!stale.ok) assertEquals(stale.error.kind, "WorkflowControlStale");
});

Deno.test("rights approval advances the matching owner-scoped run exactly once", async () => {
  const fixture = setup();
  const run = (await createRun(fixture.service)).run;
  const advanced = await fixture.service.rightsApproved({ ownerId: "owner-a", sourceId: "source-a", sourceRevision: 1 });
  assertEquals(advanced.ok, true);
  if (!advanced.ok) return;
  assertEquals(advanced.value.state, "robots-check");
  const replay = await fixture.service.rightsApproved({ ownerId: "owner-a", sourceId: "source-a", sourceRevision: 1 });
  assertEquals(replay.ok, true);
  if (replay.ok) assertEquals(replay.value.revision, advanced.value.revision);
});

Deno.test("workflow rejects invalid jumps, records completion counts, and creates reusable global manifest", async () => {
  const fixture = setup();
  const run = (await createRun(fixture.service)).run;
  const invalid = await fixture.service.advance({ ownerId: "owner-a", runId: run.runId, expectedRevision: 1, nextState: "completed" });
  assertEquals(invalid.ok, false);
  if (!invalid.ok) assertEquals(invalid.error.kind, "WorkflowTransitionInvalid");
  await fixture.service.rightsApproved({ ownerId: "owner-a", sourceId: "source-a", sourceRevision: 1 });
  await fixture.service.advance({ ownerId: "owner-a", runId: run.runId, expectedRevision: 2, nextState: "extraction-loop", counts: { pages: 2, knowledgePoints: 3, acceptedQuizzes: 0, pendingQuizzes: 0 } });
  const finalized = await fixture.service.advance({ ownerId: "owner-a", runId: run.runId, expectedRevision: 3, nextState: "extraction-finalized", counts: { pages: 2, knowledgePoints: 3, acceptedQuizzes: 0, pendingQuizzes: 0 } });
  assertEquals(finalized.ok, true);
  const quizLoop = await fixture.service.advance({ ownerId: "owner-a", runId: run.runId, expectedRevision: 4, nextState: "per-point-quiz-loop", counts: { pages: 2, knowledgePoints: 3, acceptedQuizzes: 2, pendingQuizzes: 1 } });
  assertEquals(quizLoop.ok, true);
  const completed = await fixture.service.advance({ ownerId: "owner-a", runId: run.runId, expectedRevision: 5, nextState: "completed", counts: { pages: 2, knowledgePoints: 3, acceptedQuizzes: 2, pendingQuizzes: 1 } });
  assertEquals(completed.ok, true);
  assertEquals(fixture.manifests.length, 1);
  assertEquals(fixture.manifests[0].counts.knowledgePoints, 3);
});

Deno.test("workflow completion recovery can persist a missing reuse manifest idempotently", async () => {
  const fixture = setup();
  const run = (await createRun(fixture.service)).run;
  fixture.runs[0] = { ...run, state: "completed", revision: 2, counts: { pages: 1, knowledgePoints: 1, acceptedQuizzes: 1, pendingQuizzes: 0 } };
  const ensured = await fixture.service.ensureReuse({ ownerId: "owner-a", runId: run.runId });
  assertEquals(ensured.ok, true);
  assertEquals(fixture.manifests.length, 1);
});

Deno.test("uploaded material never creates a global reuse manifest on completion or recovery", async () => {
  const fixture = setup();
  const run = (await createRun(fixture.service)).run;
  fixture.runs[0] = { ...run, materialId: "private-material", state: "per-point-quiz-loop", revision: 2 };
  const completed = await fixture.service.advance({ ownerId: "owner-a", runId: run.runId, expectedRevision: 2, nextState: "completed" });
  assertEquals(completed.ok, true);
  assertEquals(fixture.manifests.length, 0);
  const recovered = await fixture.service.ensureReuse({ ownerId: "owner-a", runId: run.runId });
  assertEquals(recovered.ok, true);
  assertEquals(fixture.manifests.length, 0);
});

Deno.test("global reuse remains pending until rights approval, then adopts the manifest", async () => {
  const fixture = setup();
  fixture.setGlobalReuse({ canonicalSourceIdentity: "https://example.test/source", sourceRevision: 1, contentSignature: "sha256:source-a", configDigests: { "knowledge-scraper": "sha256:old" }, counts: { pages: 4, knowledgePoints: 6, acceptedQuizzes: 5, pendingQuizzes: 1 } });
  const created = await createRun(fixture.service);
  assertEquals(created.reused, false);
  assertEquals(created.run.state, "source-added");
  const approved = await fixture.service.rightsApproved({ ownerId: "owner-a", sourceId: "source-a", sourceRevision: 1 });
  assertEquals(approved.ok, true);
  if (!approved.ok) return;
  assertEquals(approved.value.state, "completed");
  assertEquals(approved.value.reused, true);
  assertEquals(approved.value.counts.knowledgePoints, 6);
});

Deno.test("abandonment persists the terminal state before cleanup and retries cleanup safely", async () => {
  let cleanupCalls = 0;
  /** @type {import("../src/features/knowledge-workflows/workflow.js").WorkflowDependencies["cleanup"]} */
  const cleanup = {
    async abandonRun() {
      cleanupCalls += 1;
      return cleanupCalls === 1 ? { ok: false, error: { kind: "WorkflowCleanupFailed" } } : { ok: true, value: null };
    },
    async revokeSource() { return { ok: true, value: null }; },
  };
  const fixture = setup(cleanup);
  const run = (await createRun(fixture.service)).run;
  const first = await fixture.service.control({ ownerId: "owner-a", runId: run.runId, expectedRevision: 1, action: "abandon", idempotencyKey: "abandon-1" });
  assertEquals(first.ok, false);
  if (!first.ok) assertEquals(first.error.kind, "WorkflowCleanupFailed");
  assertEquals(fixture.runs[0].state, "abandoned");
  const retry = await fixture.service.control({ ownerId: "owner-a", runId: run.runId, expectedRevision: 1, action: "abandon", idempotencyKey: "abandon-1" });
  assertEquals(retry.ok, true);
  assertEquals(cleanupCalls, 2);
});

Deno.test("cancelled extraction creates a fresh in-memory attempt and concurrent identical extraction reuses it",async()=>{
 const f=setup(),first=await createRun(f.service);
 const cancelled=await f.service.control({ownerId:"owner-a",runId:first.run.runId,expectedRevision:1,action:"abandon",idempotencyKey:"cancel-fresh"});assertEquals(cancelled.ok,true);
 const [a,b]=await Promise.all([createRun(f.service),createRun(f.service)]);
 assertEquals(a.run.state,"source-added");assertEquals(a.run.runId===first.run.runId,false);assertEquals(a.run.runId,b.run.runId);assertEquals(f.runs.length,2);assertEquals(f.runs[0].state,"abandoned");
});

Deno.test("upload after failed empty web extraction starts its processing window when material arrives", async () => {
  const fixture = setup();
  const run = (await createRun(fixture.service)).run;
  await fixture.service.rightsApproved({ownerId:"owner-a",sourceId:"source-a",sourceRevision:1});
  const extracting = await fixture.service.advance({ownerId:"owner-a",runId:run.runId,expectedRevision:2,nextState:"extraction-loop"});
  if(!extracting.ok)throw new Error(extracting.error.kind);
  const waiting = await fixture.service.advance({ownerId:"owner-a",runId:run.runId,expectedRevision:extracting.value.revision,nextState:"awaiting-upload",failureKind:"WorkflowExtractionFailed:KnowledgeBrowserNavigationFailed"});
  if(!waiting.ok)throw new Error(waiting.error.kind);
  fixture.setNow("2026-08-14T00:00:00.000Z");
  const attached = await fixture.service.attachMaterial({ownerId:"owner-a",runId:run.runId,materialId:"uploaded-fallback"});
  if(!attached.ok)throw new Error(attached.error.kind);
  assertEquals(attached.value.extractionStartedAt,"2026-08-14T00:00:00.000Z");
  assertEquals(attached.value.extractionDeadlineAt,"2026-08-14T00:30:00.000Z");
  assertEquals(attached.value.failureKind,null);
  assertEquals(attached.value.state,"extraction-loop");
});

Deno.test("only a completed partial failure permits an approved failed-item retry", async () => {
  const fixture = setup(), run = (await createRun(fixture.service)).run;
  const completed = {...run, state: /** @type {const} */ ("completed"), revision: 6, failureKind:"WorkflowPagesFailed", extractionStartedAt:"2026-08-13T00:00:00.000Z", extractionDeadlineAt:"2026-08-13T00:30:00.000Z", counts:{pages:2,knowledgePoints:3,acceptedQuizzes:3,pendingQuizzes:0}};
  fixture.runs[0] = completed;
  const reuse = await fixture.service.ensureReuse({ownerId:run.ownerId,runId:run.runId});
  assertEquals(reuse.ok,true); assertEquals(fixture.manifests.length,0);
  const retried = await fixture.service.control({ownerId:run.ownerId,runId:run.runId,expectedRevision:6,action:"resume",idempotencyKey:"retry-failed"});
  assertEquals(retried.ok,true);
  if (!retried.ok) return;
  assertEquals(retried.value.state,"extraction-loop"); assertEquals(retried.value.failureKind,"WorkflowRetryFailedPages");
  assertEquals(retried.value.counts.pages,2); assertEquals(retried.value.counts.acceptedQuizzes,3);
  assertEquals(retried.value.extractionDeadlineAt,completed.extractionDeadlineAt);
  fixture.runs[0] = {...completed,failureKind:null};
  const ordinary = await fixture.service.control({ownerId:run.ownerId,runId:run.runId,expectedRevision:6,action:"resume",idempotencyKey:"retry-completed"});
  assertEquals(ordinary.ok,false); if (!ordinary.ok) assertEquals(ordinary.error.kind,"WorkflowControlInvalid");
});

Deno.test("quiz scheduling advances revision with monotonic counts and preserves the extraction clock", async () => {
  const fixture=setup();const {run}=await createRun(fixture.service);
  fixture.runs[0]={...run,state:"per-point-quiz-loop",extractionStartedAt:"2026-08-13T00:00:00.000Z",extractionDeadlineAt:"2026-08-13T00:30:00.000Z",counts:{pages:3,knowledgePoints:2,acceptedQuizzes:0,pendingQuizzes:0}};
  const invalid=await fixture.service.advance({ownerId:run.ownerId,runId:run.runId,expectedRevision:run.revision,nextState:"per-point-quiz-loop"});assertEquals(invalid.ok,false);
  const chunk=await fixture.service.advance({ownerId:run.ownerId,runId:run.runId,expectedRevision:run.revision,nextState:"per-point-quiz-loop",counts:{pages:3,knowledgePoints:2,acceptedQuizzes:1,pendingQuizzes:0}});assertEquals(chunk.ok,true);if(!chunk.ok)return;
  assertEquals(chunk.value.revision,run.revision+1);assertEquals(chunk.value.extractionDeadlineAt,"2026-08-13T00:30:00.000Z");
  const decrease=await fixture.service.advance({ownerId:run.ownerId,runId:run.runId,expectedRevision:chunk.value.revision,nextState:"per-point-quiz-loop",counts:{pages:3,knowledgePoints:2,acceptedQuizzes:0,pendingQuizzes:0}});assertEquals(decrease.ok,false);
  const dropped=await fixture.service.advance({ownerId:run.ownerId,runId:run.runId,expectedRevision:chunk.value.revision,nextState:"per-point-quiz-loop",counts:chunk.value.counts});assertEquals(dropped.ok,true);
});

Deno.test("extraction scope persists through reload and cannot change under the same idempotency key", async () => {
  const fixture = setup();
  const command = {ownerId:"owner-a",sourceId:"source-a",sourceRevision:1,canonicalSourceIdentity:"https://example.test/source",contentSignature:"source-a",configDigests:{},idempotencyKey:"scoped-run",extractionScope:"page"};
  const created = await fixture.service.createRun(command);
  assertEquals(created.ok,true);
  if (!created.ok) return;
  const loaded = await fixture.service.status({ownerId:"owner-a",runId:created.value.run.runId});
  assertEquals(loaded.ok,true);
  if (loaded.ok) assertEquals(loaded.value.extractionScope,"page");
  const conflict = await fixture.service.createRun({...command,extractionScope:"platform"});
  assertEquals(conflict.ok,false);
  if (!conflict.ok) assertEquals(conflict.error.kind,"WorkflowIdempotencyConflict");
  const invalid = await fixture.service.createRun({...command,extractionScope:"all"});
  assertEquals(invalid.ok,false);
  if (!invalid.ok) assertEquals(invalid.error.kind,"WorkflowCommandInvalid");
});

Deno.test('only server-confirmed stopped executions resume their exact active phase and retain checkpoints',async()=>{
 for(const state of ['extraction-loop','per-point-quiz-loop']){
  const {service}=setup();let run=(await createRun(service)).run;
  for(const nextState of ['rights-assessment','robots-check','extraction-loop',...(state==='per-point-quiz-loop'?['extraction-finalized','per-point-quiz-loop']:[])]){
   const next=await service.advance({ownerId:run.ownerId,runId:run.runId,expectedRevision:run.revision,nextState,...(nextState===state?{counts:{pages:11,knowledgePoints:31,acceptedQuizzes:1,pendingQuizzes:0}}:{})});if(!next.ok)throw new Error(next.error.kind);run=next.value;
  }
  const command={ownerId:run.ownerId,runId:run.runId,expectedRevision:run.revision,action:'resume',idempotencyKey:'recover-crash'};
  const normal=await service.control(command);assertEquals(normal.ok,false);
  const forged=await service.control({...command,executionStopped:true});assertEquals(forged.ok,false);
  const stale=await service.control({...command,expectedRevision:run.revision-1},{executionStopped:true});assertEquals(stale.ok,false);
  const resumed=await service.control(command,{executionStopped:true});
  if(!resumed.ok)throw new Error(`Continue rejected: ${resumed.error.kind}`);
  assertEquals(resumed.value.state,state);assertEquals(JSON.stringify(resumed.value.counts),JSON.stringify(run.counts));assertEquals(resumed.value.revision,run.revision+1);
  const replay=await service.control(command);if(!replay.ok)throw new Error(replay.error.kind);assertEquals(replay.value.revision,resumed.value.revision);
 }
});

Deno.test('platform crash projection is read-only, preserves revision, and does not offer recovery for healthy or terminal runs',async()=>{
 const {projectKnowledgeWorkflowExecution}=await import('../worker/main.js');
 const {service,runs}=setup();let run=(await createRun(service)).run;
 for(const nextState of ['rights-assessment','robots-check','extraction-loop','extraction-finalized','per-point-quiz-loop']){
  const r=await service.advance({ownerId:run.ownerId,runId:run.runId,expectedRevision:run.revision,nextState});if(!r.ok)throw new Error(r.error.kind);run=r.value;
 }
 let reads=0;const forbidden=async()=>{throw new Error('Unexpected workflow mutation');};
 let status='errored';const binding={create:forbidden,get:async()=>({id:run.runId,status:async()=>{reads++;return {status};},pause:forbidden,resume:forbidden,restart:forbidden,sendEvent:forbidden,terminate:forbidden})};
 const projected=await projectKnowledgeWorkflowExecution(run,binding);if(!projected.ok)throw new Error(projected.error.kind);
 assertEquals(projected.value.state,'retryable-failure');assertEquals(projected.value.retryState,'per-point-quiz-loop');assertEquals(projected.value.revision,run.revision);assertEquals(runs[0].state,'per-point-quiz-loop');
 status='running';const healthy=await projectKnowledgeWorkflowExecution(run,binding);if(!healthy.ok)throw new Error(healthy.error.kind);assertEquals(healthy.value,run);
 const unavailable=await projectKnowledgeWorkflowExecution(run,{...binding,get:forbidden});assertEquals(unavailable.ok,false);
 const terminal={...run,state:/** @type {const} */('completed')};const done=await projectKnowledgeWorkflowExecution(terminal,binding);if(!done.ok)throw new Error(done.error.kind);assertEquals(done.value,terminal);assertEquals(reads,2);
});

Deno.test("dismissing completed failures is owner/revision scoped, replayable and preserves content counts",async()=>{
 for(const failureKind of ["WorkflowPagesFailed","WorkflowQuizItemsFailed"]){
  let cleanups=0;
  const f=setup({abandonRun:async()=>{cleanups++;return {ok:true,value:null};},revokeSource:async()=>{cleanups++;return {ok:true,value:null};}});
  const {run}=await createRun(f.service);
  const command={ownerId:run.ownerId,runId:run.runId,expectedRevision:6,action:"dismiss-failures",idempotencyKey:"dismiss"};
  f.runs[0]={...run,state:"completed",revision:6,failureKind,counts:{pages:2,knowledgePoints:3,acceptedQuizzes:2,pendingQuizzes:1}};
  for(const {change,kind} of [{change:{ownerId:"other-owner"},kind:"WorkflowNotFound"},{change:{expectedRevision:5},kind:"WorkflowControlStale"}]){
   const result=await f.service.control({...command,...change});assertEquals(result.ok,false);if(!result.ok)assertEquals(result.error.kind,kind);
  }
  const original=f.runs[0];
  const dismissed=await f.service.control(command);if(!dismissed.ok)throw new Error(dismissed.error.kind);
  assertEquals(dismissed.value.state,"completed");assertEquals(dismissed.value.failureKind,"WorkflowFailedItemsDismissed");assertEquals(dismissed.value.revision,7);
  assertEquals(JSON.stringify(dismissed.value.counts),JSON.stringify(original.counts));assertEquals(dismissed.value.sourceId,run.sourceId);
  const replay=await f.service.control(command);if(!replay.ok)throw new Error(replay.error.kind);assertEquals(replay.value.revision,7);
  assertEquals((await f.service.ensureReuse(command)).ok,true);assertEquals(f.manifests.length,0);assertEquals(cleanups,0);
  for(const action of ["resume","retry-quizzes","dismiss-failures"]){
   const result=await f.service.control({...command,expectedRevision:7,action,idempotencyKey:action});assertEquals(result.ok,false);if(!result.ok)assertEquals(result.error.kind,"WorkflowControlInvalid");
  }
  for(const state of /** @type {const} */(["extraction-loop","per-point-quiz-loop","paused","completed"])){
   f.runs[0]={...run,state,revision:6,failureKind:state==="completed"?null:failureKind};
   const result=await f.service.control({...command,idempotencyKey:`invalid-${state}`});assertEquals(result.ok,false);if(!result.ok)assertEquals(result.error.kind,"WorkflowControlInvalid");
  }
 }
});
