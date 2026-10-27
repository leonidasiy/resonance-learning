// @ts-check

import { createExtractionRunner } from "../src/features/knowledge-workflows/extraction.js";

/** @template T @param {T} actual @param {T} expected */
function assertEquals(actual, expected) { if (!Object.is(actual, expected)) throw new Error(`Expected ${String(expected)}, received ${String(actual)}.`); }

function setup() {
  let now = 0;
  /** @type {import("../src/features/knowledge-workflows/extraction.js").ExtractionScratchpad} */
  let scratchpad = {
    ownerId: "owner-a", runId: "run-a", sourceId: "source-a", sourceRevision: 1,
    processedUrls: [], acceptedHashes: [], similarityEvidence: [], coverage: [], unresolvedGaps: [],
    consecutiveNoveltyZero: 0, revision: 1,
  };
  /** @type {import("../src/features/knowledge-workflows/extraction.js").KnowledgePoint[]} */
  const points = [];
  /** @type {import("../src/features/knowledge-workflows/extraction.js").ExtractionDependencies} */
  const dependencies = {
    rights: { status: "allowed", sourceId: "source-a", sourceRevision: 1 },
    robots: { status: "allowed" },
    planner: {
      async plan() { return { ok: true, value: { revision: 1, frontier: ["https://example.test/a"], coverageGoals: [{ id: "goal-a", priority: "high", description: "core concept" }], unresolvedGaps: [], stopDecision: { decision: "continue", rationale: "The root page is the first relevant page to observe.", evidenceUrls: ["https://example.test/a"], unresolvedGapIds: [] } } }; },
      /** @param {{ readonly observation: { readonly url: string, readonly links: readonly string[] }, readonly previous: { readonly revision: number, readonly coverageGoals: readonly { readonly id: string, readonly priority: "high" | "normal", readonly description: string }[] } }} command */
      async replan(command) { return { ok: true, value: { revision: command.previous.revision + 1, frontier: command.observation.links, coverageGoals: command.previous.coverageGoals, unresolvedGaps: [], stopDecision: { decision: command.observation.links.length === 0 ? "complete" : "continue", rationale: command.observation.links.length === 0 ? "The agent observed no remaining relevant links." : "The observed page exposed another relevant same-origin page.", evidenceUrls: [command.observation.url], unresolvedGapIds: [] } } }; },
    },
    acquirer: {
      /** @param {{ readonly url: string }} command */
      async fetchPage(command) {
        const page = command.url.endsWith("/a")
          ? { url: command.url, title: "A", byteCount: 100, redirects: 0, links: ["https://example.test/b"], observedAt: "2026-08-13T00:00:00.000Z", candidates: [{ summary: "Core concept", normalizedHash: "hash-a", evidenceAnchors: [{ url: command.url, selector: "#a", quoteDigest: "sha256:evidence-a" }], coverageGoalIds: ["goal-a"], mediaCandidates: [], classification: { version: 1, primarySubject: "music", secondarySubjects: [], subcategory: "theory" } }] }
          : command.url.endsWith("/b")
          ? { url: command.url, title: "B", byteCount: 100, redirects: 0, links: ["https://example.test/c"], observedAt: "2026-08-13T00:00:00.000Z", candidates: [] }
          : { url: command.url, title: "C", byteCount: 100, redirects: 0, links: [], observedAt: "2026-08-13T00:00:00.000Z", candidates: [] };
        return { ok: true, value: page };
      },
    },
    scratchpad: {
      async load() { return { ok: true, value: scratchpad }; },
      /** @param {import("../src/features/knowledge-workflows/extraction.js").ExtractionScratchpad} value */
      async save(value) { if (value.revision <= scratchpad.revision) return {ok:false,error:{kind:"ScratchpadPersistenceFailed"}}; scratchpad = value; return { ok: true, value: null }; },
    },
    knowledge: {
      /** @param {import("../src/features/knowledge-workflows/extraction.js").KnowledgePoint} value */
      async append(value) { points.push(value); return { ok: true, value: null }; },
    },
    now: () => "2026-08-13T00:00:00.000Z",
    nowMs: () => now,
    logger: () => {},
    policy: { maximumFrontier: 10, maximumPageBytes: 1_000, maximumRedirects: 2, maximumPages: 10, maximumDurationMs: 1_800_000 },
  };
  return {
    points,
    /** @param {number} milliseconds */
    advance(milliseconds) { now += milliseconds; },
    runner: createExtractionRunner(dependencies),
    dependencies,
  };
}

Deno.test("bounded commits resume past reviewed points whose repaired hashes differ from their original candidates",async()=>{
  const fixture=setup(),url='https://example.test/a';
  const candidates=Array.from({length:4},(_,index)=>({summary:`Concept ${index}`,normalizedHash:`original-${index}`,evidenceAnchors:[{url,selector:'#a',quoteDigest:'sha256:evidence-a'}],coverageGoalIds:['goal-a'],mediaCandidates:[]}));
  const runner=createExtractionRunner({...fixture.dependencies,orderedUrls:[url],
    policy:{...fixture.dependencies.policy,maximumKnowledgePointsPerExecution:1},
    acquirer:{fetchPage:async()=>({ok:true,value:{url,title:'Fixture',byteCount:100,redirects:0,links:[],observedAt:'2026-08-13T00:00:00.000Z',candidates}})},
    reviewer:{review:async point=>({ok:true,value:{...point,id:`repaired-id-${point.normalizedHash}`,normalizedHash:`repaired-${point.normalizedHash}`}})},
  });
  const command={ownerId:'owner-a',runId:'run-a',sourceId:'source-a',sourceRevision:1,rootUrl:url,startedAtMs:0,deadlineAtMs:1_800_000};
  for(let chunk=0;chunk<4;chunk++){
    const result=await runner.run(command);assertEquals(result.ok,true);if(!result.ok)return;
    assertEquals(result.value.state,chunk===3?'completed':'awaiting-time-limit-decision');
    assertEquals(result.value.knowledgePointCount,chunk+1);
    assertEquals(fixture.points.length,chunk+1);
  }
  assertEquals(new Set(fixture.points.map(point=>point.normalizedHash)).size,4);
});

Deno.test("bounded extraction does not restore unavailable goals after the final replan", async () => {
  const fixture = setup();
  const runner = createExtractionRunner({
    ...fixture.dependencies,
    orderedUrls: ["https://example.test/a"],
    planner: {
      async plan(input) {
        const result = await fixture.dependencies.planner.plan(input);
        if (!result.ok) return result;
        return { ok: true, value: { ...result.value, coverageGoals: [...result.value.coverageGoals, { id: "image-context", priority: "normal", description: "Describe images unavailable to text extraction." }] } };
      },
      async replan({ previous }) {
        return { ok: true, value: { ...previous, frontier: [], coverageGoals: previous.coverageGoals.filter(goal => goal.id !== "image-context"), stopDecision: { decision: "complete", rationale: "All supplied sections observed.", evidenceUrls: ["https://example.test/a"], unresolvedGapIds: [] } } };
      },
    },
  });
  const result = await runner.run({ ownerId: "owner-a", runId: "run-a", sourceId: "source-a", sourceRevision: 1, rootUrl: "https://example.test", startedAtMs: 0, deadlineAtMs: 1_800_000 });
  assertEquals(result.ok, true);
  if (!result.ok) return;
  assertEquals(result.value.state, "completed");
  assertEquals(result.value.pagesProcessed, 1);
  assertEquals(result.value.scratchpad.planCheckpoint?.plan.coverageGoals.length, 1);
  assertEquals(JSON.stringify(result.value.scratchpad.coverage), '["goal-a"]');
});

Deno.test("resume repairs an exhausted cached bounded plan without reacquiring or replanning", async () => {
  const fixture = setup();
  const urls = ["https://example.test/a"];
  const loaded = await fixture.dependencies.scratchpad.load({ ownerId: "owner-a", runId: "run-a", sourceId: "source-a", sourceRevision: 1 });
  if (!loaded.ok) throw new Error("Fixture initialization failed.");
  const planned = await fixture.dependencies.planner.plan({ rootUrl: "https://example.test", scratchpad: loaded.value });
  if (!planned.ok) throw new Error("Fixture initialization failed.");
  await fixture.dependencies.scratchpad.save({
    ...loaded.value, revision: 2, processedUrls: urls, acceptedHashes: ["existing-point"], coverage: ["goal-a"], frontier: [], retryingFailedPages: true, retryGeneration: 61,
    planCheckpoint: { batchKey: null, orderedUrls: urls, retryGeneration: 61, plan: { ...planned.value, frontier: [], coverageGoals: [...planned.value.coverageGoals, { id: "image-context", priority: "normal", description: "Unavailable image context." }], stopDecision: { decision: "complete", rationale: "All sections observed.", evidenceUrls: urls, unresolvedGapIds: [] } } },
  });
  const result = await createExtractionRunner({
    ...fixture.dependencies, orderedUrls: urls,
    planner: { async plan() { throw new Error("Must reuse the saved plan."); }, async replan() { throw new Error("No unprocessed pages."); } },
    acquirer: { async fetchPage() { throw new Error("Must preserve completed extraction."); } },
  }).run({ ownerId: "owner-a", runId: "run-a", sourceId: "source-a", sourceRevision: 1, rootUrl: "https://example.test", startedAtMs: 0, deadlineAtMs: 1_800_000 });
  assertEquals(result.ok, true);
  if (!result.ok) return;
  assertEquals(result.value.state, "completed");
  assertEquals(result.value.knowledgePointCount, 1);
  assertEquals(result.value.scratchpad.retryingFailedPages, false);
  assertEquals(result.value.scratchpad.planCheckpoint?.plan.coverageGoals.length, 1);
  assertEquals(JSON.stringify(result.value.scratchpad.coverage), '["goal-a"]');
  assertEquals(fixture.points.length, 0);
});

Deno.test("five-page extraction batches checkpoint before consumption and resume with a smaller tail", async () => {
  const fixture = setup();
  const urls = Array.from({ length: 7 }, (_, index) => `https://example.test/${index}`);
  /** @type {string[][]} */
  const calls = [];
  let paused = true;
  let plans = 0;
  /** @type {import("../src/features/knowledge-workflows/extraction.js").ExtractionDependencies} */
  const dependencies = {
    ...fixture.dependencies,
    stopRequested: () => paused,
    planner: {
      async plan() { plans++; return { ok: true, value: { revision: 1, frontier: urls, coverageGoals: [], unresolvedGaps: [], stopDecision: { decision: "continue", rationale: "Read supplied pages.", evidenceUrls: [], unresolvedGapIds: [] } } }; },
      async replan({ previous, scratchpad }) { return { ok: true, value: { ...previous, frontier: urls.filter((url) => !scratchpad.processedUrls.includes(url)), stopDecision: { decision: scratchpad.processedUrls.length === urls.length ? "complete" : "continue", rationale: "Track supplied inventory.", evidenceUrls: [], unresolvedGapIds: [] } } }; },
    },
    batchAcquirer: {
      key: "material-and-config-digest",
      async fetchBatch({ urls: batchUrls }) {
        calls.push([...batchUrls]);
        return { ok: true, value: batchUrls.map((url) => ({ url, title: url, byteCount: 10, redirects: 0, links: [], observedAt: fixture.dependencies.now(), notes: "Brief progress, no raw text.", candidates: url.endsWith("/0") ? [{ summary: "A supported relationship.", normalizedHash: "batch-point", evidenceAnchors: [{ url, selector: "page:1" }], coverageGoalIds: [], mediaCandidates: [], classification: { version: 1, primarySubject: "music", secondarySubjects: [], subcategory: "theory" } }] : [] })) };
      },
    },
  };
  const command = { ownerId: "owner-a", runId: "run-a", sourceId: "source-a", sourceRevision: 1, rootUrl: "https://example.test", startedAtMs: 0, deadlineAtMs: 1_800_000 };
  const first = await createExtractionRunner(dependencies).run(command);
  assertEquals(first.ok, true);
  if (!first.ok) return;
  assertEquals(first.value.pagesProcessed, 1);
  assertEquals(first.value.scratchpad.pendingBatch?.observations.length, 4);
  assertEquals(calls[0].length, 5);
  const changed = await createExtractionRunner({ ...dependencies, batchAcquirer: { ...dependencies.batchAcquirer, key: "changed-input", fetchBatch: async () => { throw new Error("Changed input must not be fetched."); } } }).run(command);
  assertEquals(changed.ok, false);
  if (!changed.ok) assertEquals(changed.error.kind, "ExtractionObservationInvalid");
  paused = false;
  const resumed = await createExtractionRunner(dependencies).run(command);
  assertEquals(resumed.ok, true);
  if (!resumed.ok) return;
  assertEquals(resumed.value.state, "completed");
  assertEquals(resumed.value.pagesProcessed, 7);
  assertEquals(JSON.stringify(calls.map((batch) => batch.length)), "[5,2]");
  assertEquals(plans, 1);
  assertEquals(fixture.points.length, 1);
  assertEquals(resumed.value.scratchpad.pendingBatch, undefined);
});

Deno.test("image-mode extraction can force one-page acquisition batches", async () => {
  const fixture = setup();
  const urls = ["https://example.test/one", "https://example.test/two", "https://example.test/three"];
  /** @type {number[]} */ const batchSizes = [];
  const runner = createExtractionRunner({
    ...fixture.dependencies,
    planner: {
      async plan() { return { ok: true, value: { revision: 1, frontier: urls, coverageGoals: [], unresolvedGaps: [], stopDecision: { decision: "continue", rationale: "Observe each supplied image.", evidenceUrls: [], unresolvedGapIds: [] } } }; },
      async replan({ previous, scratchpad }) { const remaining = urls.filter((url) => !scratchpad.processedUrls.includes(url)); return { ok: true, value: { ...previous, frontier: remaining, stopDecision: { decision: remaining.length === 0 ? "complete" : "continue", rationale: "Continue through each image.", evidenceUrls: [], unresolvedGapIds: [] } } }; },
    },
    batchAcquirer: {
      key: "image-mode",
      maximumBatchSize: 1,
      async fetchBatch({ urls: batch }) { batchSizes.push(batch.length); return { ok: true, value: batch.map((url) => ({ url, title: "Image", byteCount: 10, redirects: 0, links: [], observedAt: fixture.dependencies.now(), candidates: [] })) }; },
    },
  });
  const result = await runner.run({ ownerId: "owner-a", runId: "run-a", sourceId: "source-a", sourceRevision: 1, rootUrl: "https://example.test", startedAtMs: 0, deadlineAtMs: 1_800_000 });
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error.kind, "KnowledgeSetEmpty");
  assertEquals(JSON.stringify(batchSizes), JSON.stringify([1, 1, 1]));
});

Deno.test("extraction replans, commits cited knowledge, and preserves the agent-selected stop", async () => {
  const fixture = setup();
  const result = await fixture.runner.run({ ownerId: "owner-a", runId: "run-a", sourceId: "source-a", sourceRevision: 1, rootUrl: "https://example.test", startedAtMs: 0, deadlineAtMs: 1_800_000 });
  assertEquals(result.ok, true);
  if (!result.ok) return;
  assertEquals(result.value.state, "completed");
  assertEquals(fixture.points.length, 1);
  assertEquals(fixture.points[0].evidenceAnchors[0].selector, "#a");
  assertEquals(Object.hasOwn(fixture.points[0], "classification"), false);
  assertEquals(result.value.scratchpad.consecutiveNoveltyZero, 2);
  assertEquals(result.value.scratchpad.processedUrls.join(","), "https://example.test/a,https://example.test/b,https://example.test/c");
  assertEquals(result.value.scratchpad.discoveredUrls?.join(","), "https://example.test/a,https://example.test/b,https://example.test/c");
});

Deno.test("extraction starts the planner frontier when a fresh persisted frontier is empty", async () => {
  const fixture = setup();
  /** @type {import("../src/features/knowledge-workflows/extraction.js").ExtractionScratchpad} */
  let persisted = {
    ownerId: "owner-a", runId: "run-a", sourceId: "source-a", sourceRevision: 1,
    processedUrls: [], frontier: [], discoveredUrls: [], acceptedHashes: [],
    similarityEvidence: [], coverage: [], unresolvedGaps: [], pageNotes: [],
    consecutiveNoveltyZero: 0, revision: 1,
  };
  const runner = createExtractionRunner({
    ...fixture.dependencies,
    scratchpad: {
      async load() { return { ok: true, value: persisted }; },
      async save(value) { persisted = value; return { ok: true, value: null }; },
    },
  });
  const result = await runner.run({ ownerId: "owner-a", runId: "run-a", sourceId: "source-a", sourceRevision: 1, rootUrl: "https://example.test", startedAtMs: 0, deadlineAtMs: 1_800_000 });
  assertEquals(result.ok, true);
  if (!result.ok) return;
  assertEquals(result.value.state, "completed");
  assertEquals(result.value.scratchpad.processedUrls.join(","), "https://example.test/a,https://example.test/b,https://example.test/c");
});

Deno.test("extraction preserves every discovered branch when a replan declares completion early", async () => {
  const fixture = setup();
  const pages = new Map([
    ["https://example.test/a", ["https://example.test/b", "https://example.test/c"]],
    ["https://example.test/b", []],
    ["https://example.test/c", []],
  ]);
  const runner = createExtractionRunner({
    ...fixture.dependencies,
    planner: {
      async plan() { return { ok: true, value: { revision: 1, frontier: ["https://example.test/a"], coverageGoals: [{ id: "goal-a", priority: "high", description: "core concept" }], unresolvedGaps: [], stopDecision: { decision: "continue", rationale: "Observe the root before deciding whether the source is covered.", evidenceUrls: [], unresolvedGapIds: [] } } }; },
      async replan(command) { return { ok: true, value: { revision: command.previous.revision + 1, frontier: [], coverageGoals: command.previous.coverageGoals, unresolvedGaps: [], stopDecision: { decision: "complete", rationale: "The model incorrectly omitted discovered branches.", evidenceUrls: [command.observation.url], unresolvedGapIds: [] } } }; },
    },
    acquirer: {
      async fetchPage(command) {
        const links = pages.get(command.url);
        if (links === undefined) return { ok: false, error: { kind: "UnexpectedPage" } };
        return { ok: true, value: { url: command.url, title: command.url, byteCount: 100, redirects: 0, links, observedAt: "2026-08-13T00:00:00.000Z", candidates: command.url.endsWith("/a") ? [{ summary: "Core concept", normalizedHash: "hash-a", evidenceAnchors: [{ url: command.url, selector: "main" }], coverageGoalIds: ["goal-a"], mediaCandidates: [], classification: { version: 1, primarySubject: "music", secondarySubjects: [], subcategory: "theory" } }] : [] } };
      },
    },
  });
  const result = await runner.run({ ownerId: "owner-a", runId: "run-a", sourceId: "source-a", sourceRevision: 1, rootUrl: "https://example.test", startedAtMs: 0, deadlineAtMs: 1_800_000 });
  assertEquals(result.ok, true);
  if (!result.ok) return;
  assertEquals(result.value.state, "completed");
  assertEquals(result.value.scratchpad.processedUrls.join(","), "https://example.test/a,https://example.test/b,https://example.test/c");
});

Deno.test("extraction completes when a covered frontier is exhausted", async () => {
  const fixture = setup();
  const runner = createExtractionRunner({ ...fixture.dependencies, planner: {
    async plan() { return { ok: true, value: { revision: 1, frontier: ["https://example.test/a"], coverageGoals: [{ id: "goal-a", priority: "high", description: "core concept" }], unresolvedGaps: [], stopDecision: { decision: "continue", rationale: "Observe the planned root page.", evidenceUrls: ["https://example.test/a"], unresolvedGapIds: [] } } }; },
    async replan() { return { ok: true, value: { revision: 2, frontier: [], coverageGoals: [{ id: "goal-a", priority: "high", description: "core concept" }], unresolvedGaps: [], stopDecision: { decision: "complete", rationale: "The only relevant page has been observed and the goal is covered.", evidenceUrls: ["https://example.test/a"], unresolvedGapIds: [] } } }; },
  }, acquirer: { async fetchPage(command) { return { ok: true, value: { url: command.url, title: "A", byteCount: 100, redirects: 0, links: [], observedAt: "2026-08-13T00:00:00.000Z", candidates: [{ summary: "Core concept", normalizedHash: "hash-a", evidenceAnchors: [{ url: command.url, selector: "#a" }], coverageGoalIds: ["goal-a"], mediaCandidates: [], classification: { version: 1, primarySubject: "music", secondarySubjects: [], subcategory: "theory" } }] } }; } } });
  const result = await runner.run({ ownerId: "owner-a", runId: "run-a", sourceId: "source-a", sourceRevision: 1, rootUrl: "https://example.test", startedAtMs: 0, deadlineAtMs: 1_800_000 });
  assertEquals(result.ok, true);
  if (!result.ok) return;
  assertEquals(result.value.state, "completed");
  assertEquals(result.value.pagesProcessed, 1);
  assertEquals(fixture.points.length, 1);
});

Deno.test("extraction rejects an agent complete decision while relevant frontier work remains", async () => {
  const fixture = setup();
  const runner = createExtractionRunner({
    ...fixture.dependencies,
    planner: {
      async plan() { return { ok: true, value: { revision: 1, frontier: ["https://example.test/a"], coverageGoals: [], unresolvedGaps: [], stopDecision: { decision: "complete", rationale: "The agent incorrectly declared completion before observing the frontier.", evidenceUrls: [], unresolvedGapIds: [] } } }; },
      async replan() { throw new Error("must not replan"); },
    },
  });
  const result = await runner.run({ ownerId: "owner-a", runId: "run-a", sourceId: "source-a", sourceRevision: 1, rootUrl: "https://example.test", startedAtMs: 0, deadlineAtMs: 1_800_000 });
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error.kind, "ExtractionCoverageIncomplete");
});

Deno.test("extraction persists bounded page notes and durable scraper memory checkpoints", async () => {
  const fixture = setup();
  /** @type {Record<string, unknown>[]} */ const records = [];
  const runner = createExtractionRunner({
    ...fixture.dependencies,
    memory: {
      async append(record) { records.push(record); return { ok: true, value: null }; },
    },
  });
  const result = await runner.run({ ownerId: "owner-a", runId: "run-a", sourceId: "source-a", sourceRevision: 1, rootUrl: "https://example.test", startedAtMs: 0, deadlineAtMs: 1_800_000 });
  assertEquals(result.ok, true);
  if (!result.ok) return;
  assertEquals(Array.isArray(result.value.scratchpad.pageNotes), true);
  assertEquals(result.value.scratchpad.pageNotes?.length, 3);
  assertEquals(records.some((record) => record.kind === "durable-fact"), true);
  assertEquals(records.some((record) => record.kind === "decision"), true);
  const accepted = records.find((record) => record.kind === "durable-fact" && typeof record.payload === "object" && record.payload !== null && "phase" in record.payload && record.payload.phase === "knowledge-accepted");
  if (accepted === undefined || typeof accepted.payload !== "object" || accepted.payload === null) throw new Error("Accepted knowledge memory was not recorded.");
  assertEquals(JSON.stringify(accepted.payload), JSON.stringify({ phase: "knowledge-accepted", knowledgeId: "knowledge:source-a:1:hash-a", normalizedHash: "hash-a", evidenceDigests: ["sha256:evidence-a"], coverageGoalIds: ["goal-a"], sourceUrl: "https://example.test/a" }));
  assertEquals(JSON.stringify(accepted.payload).includes("Core concept"), false);
});

Deno.test("extraction yields after one page and resumes from the persisted replanned frontier", async () => {
  const fixture = setup();
  let plans = 0, replans = 0;
  const runner = createExtractionRunner({ ...fixture.dependencies, planner:{async plan(command){plans++;if(plans>1)throw new Error("A durable plan must avoid another initial model call.");return fixture.dependencies.planner.plan(command);},async replan(command){replans++;return fixture.dependencies.planner.replan(command);}}, policy: { ...fixture.dependencies.policy, maximumPagesPerExecution: 1 } });
  const first = await runner.run({ ownerId: "owner-a", runId: "run-a", sourceId: "source-a", sourceRevision: 1, rootUrl: "https://example.test", startedAtMs: 0, deadlineAtMs: 1_800_000 });
  assertEquals(first.ok, true);
  if (!first.ok) return;
  assertEquals(first.value.state, "awaiting-time-limit-decision");
  assertEquals(first.value.pagesProcessed, 1);
  assertEquals(first.value.scratchpad.frontier?.join(","), "https://example.test/b");
  assertEquals(first.value.scratchpad.planCheckpoint?.plan.revision, 2);
  assertEquals(first.value.scratchpad.planCheckpoint?.plan.coverageGoals[0].id, "goal-a");
  assertEquals(first.value.scratchpad.planCheckpoint?.batchKey, null);
  assertEquals(first.value.scratchpad.planCheckpoint?.orderedUrls, null);
  assertEquals(first.value.scratchpad.planCheckpoint?.retryGeneration, null);

  const second = await runner.run({ ownerId: "owner-a", runId: "run-a", sourceId: "source-a", sourceRevision: 1, rootUrl: "https://example.test", startedAtMs: 0, deadlineAtMs: 1_800_000 });
  assertEquals(second.ok, true);
  if (!second.ok) return;
  assertEquals(second.value.state, "awaiting-time-limit-decision");
  assertEquals(second.value.pagesProcessed, 2);
  assertEquals(second.value.scratchpad.frontier?.join(","), "https://example.test/c");

  const third = await runner.run({ ownerId: "owner-a", runId: "run-a", sourceId: "source-a", sourceRevision: 1, rootUrl: "https://example.test", startedAtMs: 0, deadlineAtMs: 1_800_000 });
  assertEquals(third.ok, true);
  if (third.ok) assertEquals(third.value.state, "completed");
  assertEquals(third.ok ? third.value.pagesProcessed : -1, 3);
  assertEquals(plans, 1);
  assertEquals(replans, 3);
  if(third.ok)assertEquals(third.value.scratchpad.planCheckpoint?.plan.stopDecision.decision,"complete");
});

Deno.test("durable plans invalidate when ordered inventory, batch identity, or approved retry generation changes", async () => {
  for (const change of ["inventory", "batch", "retry"]) {
    const fixture = setup(), urls = ["https://example.test/a", "https://example.test/b", "https://example.test/c"];
    let plans = 0;
    /** @type {import('../src/features/knowledge-workflows/extraction.js').ExtractionDependencies} */
    const dependencies = {...fixture.dependencies,orderedUrls:urls,policy:{...fixture.dependencies.policy,maximumPagesPerExecution:1},planner:{...fixture.dependencies.planner,async plan(command){plans++;return fixture.dependencies.planner.plan(command);}},...(change==="batch"?{batchAcquirer:{key:"first-batch",maximumBatchSize:1,async fetchBatch({urls,rootUrl,plan}){const page=await fixture.dependencies.acquirer.fetchPage({url:urls[0],rootUrl,plan});return page.ok?{ok:true,value:[page.value]}:page;}}}: {})};
    const command = {ownerId:"owner-a",runId:"run-a",sourceId:"source-a",sourceRevision:1,rootUrl:"https://example.test",startedAtMs:0,deadlineAtMs:1_800_000};
    const first=await createExtractionRunner(dependencies).run(command);
    assertEquals(first.ok,true);
    /** @type {import('../src/features/knowledge-workflows/extraction.js').ExtractionDependencies} */
    const changed={...dependencies,...(change==="inventory"?{orderedUrls:[urls[2],urls[1],urls[0]]}:change==="batch"?{batchAcquirer:{.../** @type {NonNullable<typeof dependencies.batchAcquirer>} */(dependencies.batchAcquirer),key:"second-batch"}}:{scratchpad:{...dependencies.scratchpad,async load(scope){const loaded=await dependencies.scratchpad.load(scope);return loaded.ok?{ok:/** @type {const} */(true),value:{...loaded.value,retryGeneration:7}}:loaded;}}})};
    const second=await createExtractionRunner(changed).run(command);
    assertEquals(second.ok,true);
    assertEquals(plans,2);
    if(second.ok){assertEquals(second.value.scratchpad.planCheckpoint?.batchKey,change==="batch"?"second-batch":null);assertEquals(second.value.scratchpad.planCheckpoint?.retryGeneration,change==="retry"?7:null);assertEquals(second.value.scratchpad.planCheckpoint?.orderedUrls?.join(","),changed.orderedUrls?.join(","));}
  }
});

Deno.test("initial and replanned plan persistence failures stop before further source acquisition", async () => {
  for (const phase of ["initial", "replan"]) {
    const fixture=setup();let fetches=0;
    const runner=createExtractionRunner({...fixture.dependencies,policy:{...fixture.dependencies.policy,maximumPagesPerExecution:1},scratchpad:{...fixture.dependencies.scratchpad,async save(value){if(phase==="initial"||Number(value.planCheckpoint?.plan.revision)>1)return {ok:false,error:{kind:"ScratchpadPersistenceFailed"}};return fixture.dependencies.scratchpad.save(value);}},acquirer:{async fetchPage(command){fetches++;return fixture.dependencies.acquirer.fetchPage(command);}}});
    const result=await runner.run({ownerId:"owner-a",runId:"run-a",sourceId:"source-a",sourceRevision:1,rootUrl:"https://example.test",startedAtMs:0,deadlineAtMs:1_800_000});
    assertEquals(result.ok,false);
    if(!result.ok)assertEquals(result.error.kind,"ScratchpadPersistenceFailed");
    assertEquals(fetches,phase==="initial"?0:1);
    assertEquals(fixture.points.length,phase==="initial"?0:1);
  }
});

Deno.test("malformed durable plan checkpoints fail before invoking planner or acquisition", async () => {
  const fixture=setup();let calls=0;
  const runner=createExtractionRunner({...fixture.dependencies,scratchpad:{...fixture.dependencies.scratchpad,async load(scope){const loaded=await fixture.dependencies.scratchpad.load(scope);if(loaded.ok)Reflect.set(loaded.value,"planCheckpoint",{plan:{revision:0},batchKey:null,orderedUrls:null,retryGeneration:null});return loaded;}},planner:{...fixture.dependencies.planner,async plan(command){calls++;return fixture.dependencies.planner.plan(command);}},acquirer:{async fetchPage(command){calls++;return fixture.dependencies.acquirer.fetchPage(command);}}});
  const result=await runner.run({ownerId:"owner-a",runId:"run-a",sourceId:"source-a",sourceRevision:1,rootUrl:"https://example.test",startedAtMs:0,deadlineAtMs:1_800_000});
  assertEquals(result.ok,false);if(!result.ok)assertEquals(result.error.kind,"ScratchpadPersistenceFailed");assertEquals(calls,0);
});

Deno.test("approved failed-unit chunks retain their original approved inventory without replanning upfront", async () => {
  const fixture=setup(),approved=["https://example.test/b","https://example.test/c"];
  /** @type {import('../src/features/knowledge-workflows/extraction.js').ExtractionScratchpad} */
  let scratchpad={ownerId:"owner-a",runId:"run-a",sourceId:"source-a",sourceRevision:1,processedUrls:["https://example.test/a"],frontier:approved,acceptedHashes:["prior-point"],coverage:["goal-a"],unresolvedGaps:[],similarityEvidence:[],consecutiveNoveltyZero:0,revision:7,retryingFailedPages:true,retryGeneration:7};
  let plans=0;const planner=inventoryPlanner(fixture,approved);
  const runner=createExtractionRunner({...fixture.dependencies,orderedUrls:["https://example.test/a",...approved,"https://example.test/extra"],planner:{...planner,async plan(){plans++;return planner.plan();}},policy:{...fixture.dependencies.policy,maximumPagesPerExecution:1},scratchpad:{async load(){return {ok:true,value:scratchpad};},async save(value){scratchpad=value;return {ok:true,value:null};}}});
  const command={ownerId:"owner-a",runId:"run-a",sourceId:"source-a",sourceRevision:1,rootUrl:"https://example.test",startedAtMs:0,deadlineAtMs:1_800_000};
  const first=await runner.run(command);assertEquals(first.ok,true);if(!first.ok)return;
  assertEquals(first.value.scratchpad.frontier?.join(","),approved[1]);
  const second=await runner.run(command);assertEquals(second.ok,true);if(!second.ok)return;
  assertEquals(second.value.state,"completed");assertEquals(plans,1);assertEquals(second.value.scratchpad.processedUrls.join(","),`https://example.test/a,${approved.join(",")}`);assertEquals(second.value.scratchpad.retryingFailedPages,false);
});

Deno.test("extraction traverses a twelve-page content chain across bounded chunks", async () => {
  for (const maximumPagesPerExecution of [2, 5]) {
    const fixture = setup();
    const pages = Array.from({ length: 12 }, (_, index) => `https://example.test/page-${index + 1}`);
    /** @param {string} url @param {number} revision @param {boolean} [complete] @returns {{ readonly revision: number, readonly frontier: readonly string[], readonly coverageGoals: readonly { readonly id: string, readonly priority: "high" | "normal", readonly description: string }[], readonly unresolvedGaps: readonly { readonly id: string, readonly priority: "high" | "normal", readonly description: string }[], readonly stopDecision: import("../src/features/knowledge-workflows/extraction.js").ExtractionStopDecision }} */
    const planFor = (url, revision, complete = false) => ({
      revision,
      frontier: complete ? [] : [url],
      coverageGoals: [{ id: "goal-a", priority: "high", description: "all linked sections" }],
      unresolvedGaps: [],
      stopDecision: {
        decision: complete ? "complete" : "continue",
        rationale: complete ? "All twelve linked content pages were observed and the coverage goal is complete." : "The source inventory still contains another linked content page.",
        evidenceUrls: [url],
        unresolvedGapIds: [],
      },
    });
    const runner = createExtractionRunner({
      ...fixture.dependencies,
      planner: {
        async plan(command) {
          const next = pages.find((url) => !command.scratchpad.processedUrls.includes(url)) ?? pages.at(-1);
          return { ok: true, value: planFor(/** @type {string} */ (next), command.scratchpad.revision) };
        },
        async replan(command) {
          const next = command.observation.links.find((url) => !command.scratchpad.processedUrls.includes(url));
          return { ok: true, value: next === undefined ? planFor(command.observation.url, command.previous.revision + 1, true) : planFor(next, command.previous.revision + 1) };
        },
      },
      acquirer: {
        async fetchPage(command) {
          const index = pages.indexOf(command.url);
          const next = pages[index + 1];
          return { ok: true, value: { url: command.url, title: `Page ${index + 1}`, byteCount: 100, redirects: 0, links: next === undefined ? [] : [next], observedAt: "2026-08-13T00:00:00.000Z", candidates: [{ summary: `Section ${index + 1}`, normalizedHash: `hash-${index + 1}`, evidenceAnchors: [{ url: command.url, selector: "main" }], coverageGoalIds: ["goal-a"], mediaCandidates: [], classification: { version: 1, primarySubject: "music", secondarySubjects: [], subcategory: "theory" } }] } };
        },
      },
      policy: { ...fixture.dependencies.policy, maximumFrontier: 20, maximumPages: 20, maximumPagesPerExecution },
    });
    let result = await runner.run({ ownerId: "owner-a", runId: "run-a", sourceId: "source-a", sourceRevision: 1, rootUrl: "https://example.test", startedAtMs: 0, deadlineAtMs: 1_800_000 });
    assertEquals(result.ok, true);
    if (!result.ok) return;
    assertEquals(result.value.pagesProcessed, maximumPagesPerExecution);
    while (result.ok && result.value.state !== "completed") {
      const previousTotal = result.value.pagesProcessed;
      result = await runner.run({ ownerId: "owner-a", runId: "run-a", sourceId: "source-a", sourceRevision: 1, rootUrl: "https://example.test", startedAtMs: 0, deadlineAtMs: 1_800_000 });
      assertEquals(result.ok, true);
      if (!result.ok) return;
      assertEquals(result.value.pagesProcessed, Math.min(previousTotal + maximumPagesPerExecution, pages.length));
    }
    assertEquals(result.ok, true);
    if (!result.ok) return;
    assertEquals(result.value.state, "completed");
    assertEquals(result.value.pagesProcessed, 12);
    assertEquals(result.value.scratchpad.processedUrls.length, 12);
    assertEquals(result.value.scratchpad.discoveredUrls?.length, 12);
    assertEquals(fixture.points.length, 12);
  }
});

Deno.test("extraction rejects a non-positive per-execution page limit", () => {
  const fixture = setup();
  let threw = false;
  try {
    createExtractionRunner({ ...fixture.dependencies, policy: { ...fixture.dependencies.policy, maximumPagesPerExecution: 0 } });
  } catch (error) {
    threw = true;
  }
  assertEquals(threw, true);
});

Deno.test("extraction fails closed before acquisition and at the exact deadline", async () => {
  const fixture = setup();
  let fetches = 0;
  const blocked = createExtractionRunner({ ...fixture.dependencies, rights: { status: "awaiting-review", sourceId: "source-a", sourceRevision: 1 }, acquirer: { fetchPage: async () => { fetches += 1; throw new Error("must not fetch"); } } });
  const blockedResult = await blocked.run({ ownerId: "owner-a", runId: "run-a", sourceId: "source-a", sourceRevision: 1, rootUrl: "https://example.test", startedAtMs: 0, deadlineAtMs: 1_800_000 });
  assertEquals(blockedResult.ok, false);
  if (!blockedResult.ok) assertEquals(blockedResult.error.kind, "ExtractionRightsNotAllowed");
  assertEquals(fetches, 0);
  fixture.advance(1_800_000);
  const timed = await fixture.runner.run({ ownerId: "owner-a", runId: "run-a", sourceId: "source-a", sourceRevision: 1, rootUrl: "https://example.test", startedAtMs: 0, deadlineAtMs: 1_800_000 });
  assertEquals(timed.ok, true);
  if (timed.ok) assertEquals(timed.value.state, "awaiting-time-limit-decision");
});

Deno.test("extraction reports a named browser access block as a failed unit without bypassing it", async () => {
  const fixture = setup();
  let fetches = 0;
  const runner = createExtractionRunner({ ...fixture.dependencies, acquirer: { fetchPage: async () => { fetches++; return { ok: false, error: { kind: "KnowledgePageBotAccessDenied", diagnosticToken: "native-http-403" } }; } } });
  const result = await runner.run({ ownerId: "owner-a", runId: "run-a", sourceId: "source-a", sourceRevision: 1, rootUrl: "https://example.test", startedAtMs: 0, deadlineAtMs: 1_800_000 });
  if (!result.ok) throw new Error(result.error.kind);
  assertEquals(result.value.stopReason, "partial-failure");
  assertEquals(result.value.scratchpad.failedPages?.[0].failureKind, "KnowledgePageBotAccessDenied");
  assertEquals(result.value.pagesProcessed, 0);
  assertEquals(fetches, 1);
});

Deno.test("extraction checks robots for each planned page before browser acquisition", async () => {
  const fixture = setup();
  let acquired = 0;
  /** @type {string[]} */ const checked = [];
  const runner = createExtractionRunner({
    ...fixture.dependencies,
    checkRobots: async (url) => {
      checked.push(url);
      return { ok: false, error: { kind: "RobotsDenied", rule: "/private" } };
    },
    acquirer: { fetchPage: async () => { acquired += 1; throw new Error("must not acquire a robots-denied page"); } },
  });
  const result = await runner.run({ ownerId: "owner-a", runId: "run-a", sourceId: "source-a", sourceRevision: 1, rootUrl: "https://example.test", startedAtMs: 0, deadlineAtMs: 1_800_000 });
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.error.kind, "ExtractionAcquisitionFailed");
    if (result.error.kind === "ExtractionAcquisitionFailed") assertEquals(result.error.causeKind, "RobotsDenied");
  }
  assertEquals(checked.join(","), "https://example.test/a");
  assertEquals(acquired, 0);
});

Deno.test("extraction rejects duplicate and ambiguous near-duplicate points", async () => {
  const fixture = setup();
  const runner = createExtractionRunner({
    rights: { status: "allowed", sourceId: "source-a", sourceRevision: 1 }, robots: { status: "allowed" },
    planner: { async plan() { return { ok: true, value: { revision: 1, frontier: ["https://example.test/a"], coverageGoals: [], unresolvedGaps: [], stopDecision: { decision: "continue", rationale: "Observe the candidate page.", evidenceUrls: ["https://example.test/a"], unresolvedGapIds: [] } } }; }, async replan() { return { ok: true, value: { revision: 2, frontier: [], coverageGoals: [], unresolvedGaps: [], stopDecision: { decision: "complete", rationale: "No remaining relevant pages are known.", evidenceUrls: ["https://example.test/a"], unresolvedGapIds: [] } } }; } },
    acquirer: { async fetchPage() { return { ok: true, value: { url: "https://example.test/a", title: "A", byteCount: 10, redirects: 0, links: [], observedAt: "2026-08-13T00:00:00.000Z", candidates: [{ summary: "Same", normalizedHash: "same", evidenceAnchors: [{ url: "https://example.test/a", selector: "#a" }], coverageGoalIds: [], mediaCandidates: [], classification: { version: 1, primarySubject: "music", secondarySubjects: [], subcategory: "theory" } }, { summary: "Near", normalizedHash: "near", evidenceAnchors: [{ url: "https://example.test/a", selector: "#b" }], coverageGoalIds: [], mediaCandidates: [], classification: { version: 1, primarySubject: "music", secondarySubjects: [], subcategory: "theory" }, similarity: { comparedLocalHash: "same", score: 0.99, decision: "ambiguous" } }] } }; } },
    scratchpad: { async load() { return { ok: true, value: { ownerId: "owner-a", runId: "run-a", sourceId: "source-a", sourceRevision: 1, processedUrls: [], acceptedHashes: ["same"], similarityEvidence: [], coverage: [], unresolvedGaps: [], consecutiveNoveltyZero: 0, revision: 1 } }; }, async save() { return { ok: true, value: null }; } },
    knowledge: { async append() { return { ok: true, value: null }; } }, now: () => "2026-08-13T00:00:00.000Z", nowMs: () => 0, logger: () => {}, policy: { maximumFrontier: 10, maximumPageBytes: 100, maximumRedirects: 2, maximumPages: 10, maximumDurationMs: 1_800_000 },
  });
  const result = await runner.run({ ownerId: "owner-a", runId: "run-a", sourceId: "source-a", sourceRevision: 1, rootUrl: "https://example.test", startedAtMs: 0, deadlineAtMs: 1_800_000 });
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error.kind, "KnowledgeDuplicateAmbiguous");
});

Deno.test("extraction rejects candidate evidence and coverage not grounded on the observed page", async () => {
  const fixture = setup();
  const runner = createExtractionRunner({
    ...fixture.dependencies,
    acquirer: { async fetchPage(command) { return { ok: true, value: { url: command.url, title: "A", byteCount: 10, redirects: 0, links: ["https://example.test/b"], observedAt: "2026-08-13T00:00:00.000Z", candidates: [{ summary: "Unsupported", normalizedHash: "unsupported", evidenceAnchors: [{ url: "https://example.test/b", selector: "main" }], coverageGoalIds: ["invented-goal"], mediaCandidates: [], classification: { version: 1, primarySubject: "music", secondarySubjects: [], subcategory: "theory" } }] } }; } },
  });
  const result = await runner.run({ ownerId: "owner-a", runId: "run-a", sourceId: "source-a", sourceRevision: 1, rootUrl: "https://example.test", startedAtMs: 0, deadlineAtMs: 1_800_000 });
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.error.kind, "ExtractionObservationInvalid");
    if (result.error.kind === "ExtractionObservationInvalid") assertEquals(result.error.field, "evidenceAnchors");
  }
  assertEquals(fixture.points.length, 0);
});

Deno.test("extraction rejects candidate coverage absent from the active plan", async () => {
  const fixture = setup();
  const runner = createExtractionRunner({
    ...fixture.dependencies,
    acquirer: { async fetchPage(command) { return { ok: true, value: { url: command.url, title: "A", byteCount: 10, redirects: 0, links: [], observedAt: "2026-08-13T00:00:00.000Z", candidates: [{ summary: "Unsupported", normalizedHash: "unsupported", evidenceAnchors: [{ url: command.url, selector: "main" }], coverageGoalIds: ["invented-goal"], mediaCandidates: [], classification: { version: 1, primarySubject: "music", secondarySubjects: [], subcategory: "theory" } }] } }; } },
  });
  const result = await runner.run({ ownerId: "owner-a", runId: "run-a", sourceId: "source-a", sourceRevision: 1, rootUrl: "https://example.test", startedAtMs: 0, deadlineAtMs: 1_800_000 });
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.error.kind, "ExtractionObservationInvalid");
    if (result.error.kind === "ExtractionObservationInvalid") assertEquals(result.error.field, "coverageGoalIds");
  }
  assertEquals(fixture.points.length, 0);
});

Deno.test("quality-dropped knowledge contributes no accepted hashes or coverage and completes after extraction continues", async () => {
  const fixture=setup();
  let reviews=0;
  const runner=createExtractionRunner({...fixture.dependencies,reviewer:{review:async()=>{reviews++;return {ok:true,value:null};}}});
  const result=await runner.run({ownerId:"owner-a",runId:"run-a",sourceId:"source-a",sourceRevision:1,rootUrl:"https://example.test",startedAtMs:0,deadlineAtMs:1_800_000});
  if(!result.ok)throw new Error(result.error.kind);
  assertEquals(result.value.state,"completed");assertEquals(result.value.pagesProcessed,3);assertEquals(result.value.knowledgePointCount,0);assertEquals(result.value.scratchpad.acceptedHashes.length,0);assertEquals(result.value.scratchpad.coverage.length,0);assertEquals(result.value.scratchpad.reviewedCandidateCount,1);assertEquals(fixture.points.length,0);assertEquals(reviews,1);
});

Deno.test("repaired knowledge acceptance uses its new identity and refuses altered captured source anchors", async () => {
  for(const foreign of [false,true]) {
    const fixture=setup();
    const runner=createExtractionRunner({...fixture.dependencies,reviewer:{review:async(point)=>({ok:true,value:{...point,id:"knowledge:source-a:1:repaired",summary:"A repaired central relationship",normalizedHash:"repaired",evidenceAnchors:foreign?[{url:"https://foreign.test/",selector:"#other"}]:point.evidenceAnchors}})}});
    const result=await runner.run({ownerId:"owner-a",runId:"run-a",sourceId:"source-a",sourceRevision:1,rootUrl:"https://example.test",startedAtMs:0,deadlineAtMs:1_800_000});
    assertEquals(result.ok,!foreign);
    if(result.ok)assertEquals(result.value.scratchpad.acceptedHashes.join(","),"repaired");else assertEquals(result.error.kind,"KnowledgePersistenceFailed");
    assertEquals(fixture.points.length,foreign?0:1);
  }
});

Deno.test('hybrid lesson inventory preserves displayed order across model replans and workflow resume',async()=>{
  const fixture=setup();
  const urls=['https://example.test/a','https://example.test/b','https://example.test/c'];
  /** @type {string[]} */const fetched=[];
  let paused=true;
  const runner=createExtractionRunner({...fixture.dependencies,orderedUrls:urls,stopRequested:()=>paused&&fetched.length>0,planner:{async plan(){return {ok:true,value:{revision:1,frontier:urls,coverageGoals:[{id:'goal-a',priority:'high',description:'Core concept'}],unresolvedGaps:[],stopDecision:{decision:'continue',rationale:'Fixture inventory.',evidenceUrls:[],unresolvedGapIds:[]}}};},async replan({previous,scratchpad}){return {ok:true,value:{...previous,revision:previous.revision+1,frontier:urls.filter(url=>!scratchpad.processedUrls.includes(url)).reverse(),stopDecision:{...previous.stopDecision,decision:scratchpad.processedUrls.length===3?'complete':'continue'}}};}},acquirer:{async fetchPage(command){fetched.push(command.url);return fixture.dependencies.acquirer.fetchPage(command);}}});
  const command={ownerId:'owner-a',runId:'run-a',sourceId:'source-a',sourceRevision:1,rootUrl:'https://example.test/',startedAtMs:0,deadlineAtMs:1800000};
  const first=await runner.run(command);assertEquals(first.ok,true);paused=false;
  const second=await runner.run(command);assertEquals(second.ok,true);
  assertEquals(fetched.join(','),urls.join(','));
});

Deno.test('known response aliases are skipped and identical captured content is reviewed only once',async()=>{
  const fixture=setup();
  /** @type {string[]} */const fetched=[];
  let reviews=0;
  const runner=createExtractionRunner({...fixture.dependencies,planner:{async plan(){return {ok:true,value:{revision:1,frontier:['https://example.test/a','https://example.test/canonical-a','https://example.test/a?tab=alias'],coverageGoals:[{id:'goal-a',priority:'high',description:'Core concept'}],unresolvedGaps:[],stopDecision:{decision:'continue',rationale:'Fixture aliases.',evidenceUrls:[],unresolvedGapIds:[]}}};},async replan({previous}){return {ok:true,value:{...previous,revision:previous.revision+1,stopDecision:{...previous.stopDecision,decision:'complete'}}};}},acquirer:{async fetchPage({url}){fetched.push(url);return {ok:true,value:{url,responseUrl:'https://example.test/canonical-a',contentDigest:'sha256:identical-fixture-content',title:'A',byteCount:100,redirects:1,links:[],observedAt:'2026-10-13T00:00:00.000Z',candidates:[{summary:'Synthetic core relationship.',normalizedHash:url,evidenceAnchors:[{url:'https://example.test/canonical-a',selector:'#a'}],coverageGoalIds:['goal-a'],mediaCandidates:[]}]}};}},reviewer:{async review(point){reviews++;return {ok:true,value:point};}}});
  const result=await runner.run({ownerId:'owner-a',runId:'run-a',sourceId:'source-a',sourceRevision:1,rootUrl:'https://example.test/',startedAtMs:0,deadlineAtMs:1800000});
  assertEquals(result.ok,true);assertEquals(fetched.join(','),'https://example.test/a,https://example.test/a?tab=alias');assertEquals(reviews,1);assertEquals(fixture.points.length,1);
  if(result.ok)assertEquals(result.value.scratchpad.processedContentDigests?.join(','),'sha256:identical-fixture-content');
});

Deno.test('updated hybrid inventory replaces a stale excluded frontier before resumed acquisition',async()=>{
  const fixture=setup();
  const scope={ownerId:'owner-a',runId:'run-a',sourceId:'source-a',sourceRevision:1};
  const loaded=await fixture.dependencies.scratchpad.load(scope);if(!loaded.ok)throw new Error('Fixture load failed.');
  let scratchpad={...loaded.value,frontier:['https://example.test/c'],discoveredUrls:['https://example.test/c']};
  /** @type {string[]} */const fetched=[];
  const runner=createExtractionRunner({...fixture.dependencies,orderedUrls:['https://example.test/a','https://example.test/b'],scratchpad:{async load(){return {ok:true,value:scratchpad};},async save(value){scratchpad={...value,frontier:[...(value.frontier??[])],discoveredUrls:[...(value.discoveredUrls??[])]};return {ok:true,value:null};}},planner:{...fixture.dependencies.planner,async replan({previous}){return {ok:true,value:{...previous,revision:previous.revision+1,frontier:['https://example.test/c'],stopDecision:{...previous.stopDecision,decision:'complete'}}};}},acquirer:{async fetchPage(command){fetched.push(command.url);return fixture.dependencies.acquirer.fetchPage(command);}}});
  const result=await runner.run({...scope,rootUrl:'https://example.test/',startedAtMs:0,deadlineAtMs:1800000});
  assertEquals(result.ok,true);assertEquals(fetched.join(','),'https://example.test/a,https://example.test/b');
  if(result.ok)assertEquals(result.value.scratchpad.discoveredUrls?.includes('https://example.test/c'),false);
});

Deno.test("mid-page accepted knowledge checkpoints survive a later reviewer failure without re-review", async () => {
  const fixture=setup();
  let failSecond=true;
  const reviewed=/** @type {string[]} */([]);
  const original=fixture.dependencies.acquirer.fetchPage;
  const dependencies={...fixture.dependencies,acquirer:{async fetchPage(/** @type {{readonly url:string,readonly rootUrl:string,readonly plan:import("../src/features/knowledge-workflows/extraction.js").ExtractionPlan}} */ command){const page=await original(command);if(!page.ok||!command.url.endsWith("/a"))return page;return {ok:/** @type {const} */(true),value:{...page.value,candidates:[...page.value.candidates,{...page.value.candidates[0],summary:"Second supported relationship",normalizedHash:"hash-second"}]}};}},reviewer:{async review(/** @type {import("../src/features/knowledge-workflows/extraction.js").KnowledgePoint} */ point){reviewed.push(point.normalizedHash);if(point.normalizedHash==="hash-second"&&failSecond)return {ok:/** @type {const} */(false),error:{kind:"ReviewerUnavailable"}};return {ok:/** @type {const} */(true),value:point};}}};
  const command={ownerId:"owner-a",runId:"run-a",sourceId:"source-a",sourceRevision:1,rootUrl:"https://example.test",startedAtMs:0,deadlineAtMs:1_800_000};
  assertEquals((await createExtractionRunner(dependencies).run(command)).ok,false);
  const checkpoint=await fixture.dependencies.scratchpad.load(command);
  if(!checkpoint.ok)throw new Error("Checkpoint unavailable");
  assertEquals(checkpoint.value.acceptedHashes.join(","),"hash-a");
  assertEquals(checkpoint.value.processedUrls.length,0);
  failSecond=false;
  const resumed=await createExtractionRunner(dependencies).run(command);
  assertEquals(resumed.ok,true);
  assertEquals(reviewed.join(","),"hash-a,hash-second,hash-second");
  assertEquals(fixture.points.length,2);
});


/** @param {ReturnType<typeof setup>} fixture @param {readonly string[]} urls */
function inventoryPlanner(fixture, urls) {
  return {
    async plan() { const result = await fixture.dependencies.planner.plan({ rootUrl: "https://example.test", scratchpad: {ownerId:"owner-a",runId:"run-a",sourceId:"source-a",sourceRevision:1,processedUrls:[],acceptedHashes:[],similarityEvidence:[],coverage:[],unresolvedGaps:[],consecutiveNoveltyZero:0,revision:1} }); if (!result.ok) throw new Error("Fixture plan failed"); return { ok: /** @type {const} */ (true), value: { ...result.value, frontier: urls } }; },
    /** @param {Parameters<import("../src/features/knowledge-workflows/extraction.js").ExtractionPlanner["replan"]>[0]} command */
    async replan({ previous, scratchpad }) { const remaining = urls.filter(url => !scratchpad.processedUrls.includes(url) && !scratchpad.failedPages?.some(page => page.url === url)); return { ok: /** @type {const} */ (true), value: { ...previous, revision: previous.revision + 1, frontier: remaining, stopDecision: { ...previous.stopDecision, decision: /** @type {"continue"|"complete"} */ (remaining.length ? "continue" : "complete") } } }; },
  };
}

Deno.test("failed middle unit exhausts distinct attempts, continues the rest, and stays skipped on durable reload", async () => {
  const fixture = setup();
  const urls = ["https://example.test/a", "https://example.test/b", "https://example.test/c"];
  /** @type {{url:string,attempt:number}[]} */ const calls = [];
  /** @type {import("../src/features/knowledge-workflows/extraction.js").ExtractionDependencies} */
  const dependencies = { ...fixture.dependencies, planner: inventoryPlanner(fixture, urls),
    acquirer: { /** @param {Parameters<import("../src/features/knowledge-workflows/extraction.js").PageAcquirer["fetchPage"]>[0]} command */ async fetchPage(command) { calls.push({ url: command.url, attempt: command.attempt ?? 1 }); return command.url.endsWith("/b") ? { ok: /** @type {const} */ (false), error: { kind: "KnowledgeBrowserTimedOut" } } : fixture.dependencies.acquirer.fetchPage(command); } },
  };
  const command = { ownerId: "owner-a", runId: "run-a", sourceId: "source-a", sourceRevision: 1, rootUrl: "https://example.test", startedAtMs: 0, deadlineAtMs: 1_800_000 };
  const result = await createExtractionRunner(dependencies).run(command);
  if (!result.ok) throw new Error(result.error.kind);
  assertEquals(result.value.stopReason, "partial-failure");
  assertEquals(result.value.pagesProcessed, 2);
  assertEquals(result.value.scratchpad.processedUrls.join(","), `${urls[0]},${urls[2]}`);
  assertEquals(result.value.scratchpad.failedPages?.[0].url, urls[1]);
  assertEquals(result.value.scratchpad.failedPages?.[0].attempts, 4);
  assertEquals(calls.filter(call => call.url === urls[1]).map(call => call.attempt).join(","), "1,2,3,4");
  assertEquals(fixture.points.length, 1);
  const count = calls.length;
  const resumed = await createExtractionRunner(dependencies).run(command);
  if (!resumed.ok) throw new Error(resumed.error.kind);
  assertEquals(resumed.value.stopReason, "partial-failure");
  assertEquals(calls.length, count);
  assertEquals(fixture.points.length, 1);
});

Deno.test("exhausted reviewer failure keeps already committed points and processes subsequent units", async () => {
  const fixture = setup();
  const urls = ["https://example.test/a", "https://example.test/b"];
  /** @type {string[]} */ const reviewed = [];
  const runner = createExtractionRunner({ ...fixture.dependencies, planner: inventoryPlanner(fixture, urls),
    acquirer: { async fetchPage(command) { const result = await fixture.dependencies.acquirer.fetchPage(command); if (!result.ok) return result; const page = result.value; return { ok: true, value: { ...page, links: [], candidates: command.url === urls[0] ? [...page.candidates, { ...page.candidates[0], summary: "Another source relationship", normalizedHash: "bad-review" }] : [{ summary: "Remaining unit relationship", normalizedHash: "tail", evidenceAnchors: [{url:command.url,selector:"#tail"}], coverageGoalIds: ["goal-a"], mediaCandidates: [] }] } }; } },
    reviewer: { async review(point) { reviewed.push(point.normalizedHash); return point.normalizedHash === "bad-review" ? { ok: false, error: { kind: "KnowledgeReviewOutputInvalid" } } : { ok: true, value: point }; } },
  });
  const result = await runner.run({ ownerId: "owner-a", runId: "run-a", sourceId: "source-a", sourceRevision: 1, rootUrl: "https://example.test", startedAtMs: 0, deadlineAtMs: 1_800_000 });
  if (!result.ok) throw new Error(result.error.kind);
  assertEquals(result.value.scratchpad.failedPages?.[0].attempts, 2);
  assertEquals(result.value.scratchpad.failedPages?.[0].url, urls[0]);
  assertEquals(result.value.scratchpad.processedUrls.join(","), urls[1]);
  assertEquals(fixture.points.map(point => point.normalizedHash).join(","), "hash-a,tail");
  assertEquals(reviewed.join(","), "hash-a,bad-review,tail");
});

Deno.test("page failures count toward execution chunks and do not clear the approved retry cycle until completed", async () => {
  const fixture = setup();
  const urls = ["https://example.test/a", "https://example.test/b"];
  /** @type {import("../src/features/knowledge-workflows/extraction.js").ExtractionScratchpad} */
  let scratchpad = { ownerId: "owner-a", runId: "run-a", sourceId: "source-a", sourceRevision: 1, processedUrls: [], acceptedHashes: [], similarityEvidence: [], coverage: [], unresolvedGaps: [], consecutiveNoveltyZero: 0, revision: 1, frontier: urls, retryingFailedPages: true, retryGeneration: 4 };
  let fetches = 0;
  /** @type {import("../src/features/knowledge-workflows/extraction.js").ExtractionDependencies} */
  const dependencies = { ...fixture.dependencies, planner: inventoryPlanner(fixture, urls), policy: { ...fixture.dependencies.policy, maximumPagesPerExecution: 1 }, scratchpad: { async load() { return {ok: /** @type {const} */(true), value: scratchpad}; }, async save(/** @type {import("../src/features/knowledge-workflows/extraction.js").ExtractionScratchpad} */value) { scratchpad = value; return {ok: /** @type {const} */(true), value: null}; } }, acquirer: { async fetchPage() {fetches++; return {ok: /** @type {const} */(false), error: {kind:"KnowledgeBrowserTimedOut"}};} } };
  const command = { ownerId: "owner-a", runId: "run-a", sourceId: "source-a", sourceRevision: 1, rootUrl: "https://example.test", startedAtMs: 0, deadlineAtMs: 1_800_000 };
  const first = await createExtractionRunner(dependencies).run(command);
  if (!first.ok) throw new Error(first.error.kind);
  assertEquals(first.value.state, "awaiting-time-limit-decision");
  assertEquals(first.value.pagesProcessed, 0);
  assertEquals(first.value.scratchpad.failedPages?.length, 1);
  assertEquals(first.value.scratchpad.retryingFailedPages, true);
  const second = await createExtractionRunner(dependencies).run(command);
  if (!second.ok) throw new Error(second.error.kind);
  assertEquals(second.value.state, "completed");
  assertEquals(second.value.scratchpad.retryingFailedPages, false);
  assertEquals(second.value.scratchpad.retryGeneration, 4);
  assertEquals(second.value.scratchpad.failedPages?.length, 2);
  assertEquals(fetches, 8);
});

Deno.test("unknown provider accounting and persistence failures stop without being marked page failures", async () => {
  for (const kind of ["WorkflowStageOutcomeUnknown", "AgentExecutionBoundaryFailure", "KnowledgeModelUsageInvalid", "WorkflowMaterialPersistenceFailed", "UploadedImageHashMismatch"]) {
    const fixture = setup();
    let calls = 0;
    const runner = createExtractionRunner({ ...fixture.dependencies, acquirer: {async fetchPage() {calls++; return {ok:false,error:{kind}};}} });
    const result = await runner.run({ ownerId: "owner-a", runId: "run-a", sourceId: "source-a", sourceRevision: 1, rootUrl: "https://example.test", startedAtMs: 0, deadlineAtMs: 1_800_000 });
    assertEquals(result.ok, false);
    if (!result.ok && result.error.kind === "ExtractionAcquisitionFailed") assertEquals(result.error.causeKind, kind);
    assertEquals(calls, 1);
    const loaded = await fixture.dependencies.scratchpad.load({ownerId:"owner-a",runId:"run-a",sourceId:"source-a",sourceRevision:1});
    if (loaded.ok) assertEquals(loaded.value.failedPages?.length ?? 0, 0);
  }
});


Deno.test("a failed acquisition batch is isolated into singleton retries without discarding healthy tail units", async () => {
  const fixture = setup();
  const urls = ["https://example.test/a", "https://example.test/b", "https://example.test/c"];
  /** @type {{urls:readonly string[],attempt:number}[]} */ const calls = [];
  const runner = createExtractionRunner({ ...fixture.dependencies, planner: inventoryPlanner(fixture, urls), batchAcquirer: { key: "isolate-failed-batch", async fetchBatch({urls:batch,attempt=1,plan}) {calls.push({urls:batch,attempt}); if(batch.includes(urls[1]))return {ok:false,error:{kind:"KnowledgeModelTimeout"}}; const pages=[]; for(const url of batch){const page=await fixture.dependencies.acquirer.fetchPage({url,rootUrl:"https://example.test",plan});if(!page.ok)return page;pages.push({...page.value,links:[]});}return {ok:true,value:pages};} } });
  const result = await runner.run({ ownerId: "owner-a", runId: "run-a", sourceId: "source-a", sourceRevision: 1, rootUrl: "https://example.test", startedAtMs: 0, deadlineAtMs: 1_800_000 });
  if (!result.ok) throw new Error(result.error.kind);
  assertEquals(result.value.pagesProcessed, 2);
  assertEquals(result.value.scratchpad.failedPages?.[0].url, urls[1]);
  assertEquals(result.value.scratchpad.failedPages?.[0].attempts, 4);
  assertEquals(calls.map(call => `${call.urls.length}:${call.attempt}`).join(","), "3:1,1:2,1:2,1:3,1:4,1:2");
});

Deno.test("failed units consume the existing page budget and failure checkpoint errors stop before the next unit", async () => {
  for (const checkpointFailure of [false, true]) {
    const fixture = setup();
    const urls = ["https://example.test/a", "https://example.test/b"];
    let calls = 0;
    const runner = createExtractionRunner({ ...fixture.dependencies, planner: inventoryPlanner(fixture, urls), policy: {...fixture.dependencies.policy,maximumPages:1}, ...(checkpointFailure ? {scratchpad:{...fixture.dependencies.scratchpad,async save(value){return (value.failedPages?.length??0)>0?{ok:/** @type {const} */(false),error:{kind:"ScratchpadPersistenceFailed"}}:fixture.dependencies.scratchpad.save(value);}}} : {}), acquirer:{async fetchPage(){calls++;return {ok:false,error:{kind:"KnowledgeBrowserTimedOut"}};}} });
    const result = await runner.run({ ownerId: "owner-a", runId: "run-a", sourceId: "source-a", sourceRevision: 1, rootUrl: "https://example.test", startedAtMs: 0, deadlineAtMs: 1_800_000 });
    assertEquals(result.ok, false);
    if (!result.ok) assertEquals(result.error.kind, checkpointFailure ? "ScratchpadPersistenceFailed" : "ExtractionLimitExceeded");
    assertEquals(calls, 4);
  }
});


Deno.test("an approved failed-unit retry cannot introduce other unprocessed inventory or discovered links", async () => {
  const fixture = setup();
  const approved = "https://example.test/b";
  const extra = "https://example.test/c";
  /** @type {import("../src/features/knowledge-workflows/extraction.js").ExtractionScratchpad} */
  let scratchpad = {ownerId:"owner-a",runId:"run-a",sourceId:"source-a",sourceRevision:1,processedUrls:["https://example.test/a"],acceptedHashes:["existing"],similarityEvidence:[],coverage:["goal-a"],unresolvedGaps:[],consecutiveNoveltyZero:0,revision:1,frontier:[approved],discoveredUrls:[approved,extra],retryingFailedPages:true,retryGeneration:7};
  /** @type {string[]} */ const calls = [];
  const runner = createExtractionRunner({...fixture.dependencies,orderedUrls:["https://example.test/a",approved,extra],planner:{...inventoryPlanner(fixture,[approved,extra]),async replan({previous}){return {ok:true,value:{...previous,frontier:[extra],stopDecision:{...previous.stopDecision,decision:"complete"}}};}},scratchpad:{async load(){return {ok:true,value:scratchpad};},async save(value){scratchpad=value;return {ok:true,value:null};}},acquirer:{async fetchPage(command){calls.push(command.url);return fixture.dependencies.acquirer.fetchPage(command);}}});
  const result = await runner.run({ownerId:"owner-a",runId:"run-a",sourceId:"source-a",sourceRevision:1,rootUrl:"https://example.test",startedAtMs:0,deadlineAtMs:1_800_000});
  if (!result.ok) throw new Error(result.error.kind);
  assertEquals(result.value.state,"completed");
  assertEquals(calls.join(","),approved);
  assertEquals(result.value.scratchpad.processedUrls.join(","),`https://example.test/a,${approved}`);
  assertEquals(result.value.scratchpad.retryingFailedPages,false);
});


Deno.test("known not-started model rejection statuses retry locally while credential rejection stops", async () => {
  for (const status of [429, 503, 401, 403]) {
    const fixture = setup();
    const urls = ["https://example.test/a", "https://example.test/b"];
    /** @type {number[]} */ const attempts = [];
    const runner = createExtractionRunner({...fixture.dependencies,orderedUrls:urls,planner:inventoryPlanner(fixture,urls),acquirer:{async fetchPage(command){if(command.url===urls[0]){attempts.push(command.attempt??1);return {ok:false,error:{kind:"KnowledgeModelRejected",status}};}return fixture.dependencies.acquirer.fetchPage(command);}}});
    const result = await runner.run({ownerId:"owner-a",runId:"run-a",sourceId:"source-a",sourceRevision:1,rootUrl:"https://example.test",startedAtMs:0,deadlineAtMs:1_800_000});
    if(status===429||status===503){
      if(!result.ok)throw new Error(result.error.kind);
      assertEquals(result.value.stopReason,"partial-failure");
      assertEquals(result.value.pagesProcessed,1);
      assertEquals(result.value.scratchpad.failedPages?.[0].failureKind,"KnowledgeModelRejected");
      assertEquals(result.value.scratchpad.failedPages?.[0].attempts,4);
      assertEquals(attempts.join(","),"1,2,3,4");
    }else{
      assertEquals(result.ok,false);
      if(!result.ok&&result.error.kind==="ExtractionAcquisitionFailed")assertEquals(result.error.causeKind,"KnowledgeModelRejected");
      assertEquals(attempts.join(","),"1");
    }
  }
});


Deno.test("malformed image observations exhaust retries and missing single images do not block later source units", async () => {
  for (const {kind, attempts} of [{kind:"KnowledgeMaterialImageObservationInvalid",attempts:4},{kind:"WorkflowMaterialImageUnavailable",attempts:1}]) {
    const fixture = setup();
    const urls = ["https://example.test/a", "https://example.test/b"];
    /** @type {number[]} */ const retryAttempts = [];
    let laterUnits = 0;
    const runner = createExtractionRunner({...fixture.dependencies,orderedUrls:urls,planner:inventoryPlanner(fixture,urls),batchAcquirer:{key:"image-observation-retries",maximumBatchSize:1,async fetchBatch({urls:batch,attempt=1,plan}){if(batch[0]===urls[0]){retryAttempts.push(attempt);return {ok:false,error:{kind}};}laterUnits++;const result=await fixture.dependencies.acquirer.fetchPage({url:batch[0],rootUrl:"https://example.test",plan});return result.ok?{ok:true,value:[result.value]}:result;}}});
    const result = await runner.run({ownerId:"owner-a",runId:"run-a",sourceId:"source-a",sourceRevision:1,rootUrl:"https://example.test",startedAtMs:0,deadlineAtMs:1_800_000});
    if(!result.ok)throw new Error(result.error.kind);
    assertEquals(result.value.stopReason,"partial-failure");
    assertEquals(result.value.pagesProcessed,1);
    assertEquals(result.value.scratchpad.processedUrls.join(","),urls[1]);
    assertEquals(result.value.scratchpad.failedPages?.[0].failureKind,kind);
    assertEquals(result.value.scratchpad.failedPages?.[0].attempts,attempts);
    assertEquals(retryAttempts.join(","),attempts===4?"1,2,3,4":"1");
    assertEquals(laterUnits,1);
  }
});


Deno.test("failed-unit reporting preserves validated reviewer attempt counts",async()=>{
  for(const attempts of [2,0]){
    const fixture=setup();
    const urls=["https://example.test/a","https://example.test/b"];
    const runner=createExtractionRunner({...fixture.dependencies,orderedUrls:urls,planner:inventoryPlanner(fixture,urls),reviewer:{async review(){return {ok:false,error:{kind:"KnowledgeModelRejected",status:503,attempts}};}}});
    const result=await runner.run({ownerId:"owner-a",runId:"run-a",sourceId:"source-a",sourceRevision:1,rootUrl:"https://example.test",startedAtMs:0,deadlineAtMs:1_800_000});
    if(!result.ok)throw new Error(result.error.kind);
    assertEquals(result.value.stopReason,"partial-failure");
    assertEquals(result.value.scratchpad.failedPages?.[0].failureKind,"KnowledgeModelRejected");
    assertEquals(result.value.scratchpad.failedPages?.[0].attempts,attempts===2?2:1);
    assertEquals(result.value.scratchpad.processedUrls.join(","),urls[1]);
  }
});

Deno.test("planner dependency failures retain their typed cause instead of reporting malformed output", async () => {
  for (const duringReplan of [false,true]) {
    const fixture=setup();
    const rejected=async()=>({ok:/** @type {const} */(false),error:{kind:"WorkflowStageCallUncertain"}});
    const runner=createExtractionRunner({...fixture.dependencies,planner:{...fixture.dependencies.planner,...(duringReplan?{replan:rejected}:{plan:rejected})}});
    const result=await runner.run({ownerId:"owner-a",runId:"run-a",sourceId:"source-a",sourceRevision:1,rootUrl:"https://example.test",startedAtMs:0,deadlineAtMs:1_800_000});
    assertEquals(result.ok,false);
    if(result.ok)throw new Error("Expected planner failure");
    assertEquals(result.error.kind,"ExtractionPlanInvalid");
    assertEquals("causeKind" in result.error?result.error.causeKind:undefined,"WorkflowStageCallUncertain");
    assertEquals(fixture.points.length,duringReplan?1:0);
  }
});

Deno.test("single-unit model interruptions continue without replaying uncertain acquisitions", async () => {
  for (const causeKind of ["KnowledgeModelTimeout", "KnowledgeModelCancelled", "KnowledgeModelUnavailable", "KnowledgeModelResponseReadFailed", "WorkflowAgentAgentOutputInvalid"]) {
    for (const batchMode of [false, true]) {
      const fixture = setup(), urls = ["https://example.test/a", "https://example.test/b", "https://example.test/c"];
      /** @type {string[]} */ const calls = [];
      /** @type {unknown[]} */ const memory = [];
      /** @type {import('../src/features/knowledge-workflows/extraction.js').PageAcquirer['fetchPage']} */
      const fetchPage = async command => {
        calls.push(command.url);
        return command.url === urls[1] ? { ok: false, error: causeKind === "WorkflowAgentAgentOutputInvalid" ? { kind: causeKind } : { kind: "WorkflowStageCallUncertain", causeKind } } : fixture.dependencies.acquirer.fetchPage(command);
      };
      /** @type {import('../src/features/knowledge-workflows/extraction.js').ExtractionDependencies} */
      const dependencies = { ...fixture.dependencies, orderedUrls: urls, planner: inventoryPlanner(fixture, urls), acquirer: { fetchPage }, memory: { async append(record) { memory.push(record.payload); return { ok: true, value: null }; } }, ...(batchMode ? { batchAcquirer: { key: "single-interrupted-material", maximumBatchSize: 1, async fetchBatch(command) { const page = await fetchPage({ ...command, url: command.urls[0] }); return page.ok ? { ok: true, value: [page.value] } : page; } } } : {}) };
      const command = { ownerId: "owner-a", runId: "run-a", sourceId: "source-a", sourceRevision: 1, rootUrl: "https://example.test", startedAtMs: 0, deadlineAtMs: 1_800_000 };
      const result = await createExtractionRunner(dependencies).run(command);
      if (!result.ok) throw new Error(result.error.kind);
      assertEquals(result.value.stopReason, "partial-failure");
      assertEquals(result.value.scratchpad.processedUrls.join(","), `${urls[0]},${urls[2]}`);
      assertEquals(result.value.scratchpad.failedPages?.[0].failureKind, "WorkflowProcessingInterrupted");
      assertEquals(result.value.scratchpad.failedPages?.[0].attempts, 1);
      assertEquals(calls.join(","), urls.join(","));
      assertEquals(result.value.scratchpad.pageNotes?.some(note => note.url === urls[1] && note.note.includes(causeKind)), true);
      assertEquals(memory.some(value => typeof value === "object" && value !== null && Reflect.get(value, "phase") === "page-failed" && Reflect.get(value, "causeKind") === causeKind), true);
      const resumed = await createExtractionRunner(dependencies).run(command);
      if (!resumed.ok) throw new Error(resumed.error.kind);
      assertEquals(calls.join(","), urls.join(","));
      assertEquals(fixture.points.length, 1);
    }
  }
});

Deno.test("interrupted unit reviews retain committed points and process the healthy tail without replay", async () => {
 for (const error of [{kind:"WorkflowStageCallUncertain",causeKind:"KnowledgeModelTimeout",attempts:2},{kind:"WorkflowAgentAgentOutputInvalid"}]) {
  const fixture = setup(), urls = ["https://example.test/a", "https://example.test/b"];
  /** @type {string[]} */ const reviews = [];
  /** @type {import('../src/features/knowledge-workflows/extraction.js').ExtractionDependencies} */
  const dependencies = { ...fixture.dependencies, orderedUrls: urls, planner: inventoryPlanner(fixture, urls),
    acquirer: { async fetchPage(command) { const result = await fixture.dependencies.acquirer.fetchPage(command); if (!result.ok) return result; return { ok: true, value: { ...result.value, links: [], candidates: command.url === urls[0] ? [...result.value.candidates, { ...result.value.candidates[0], summary: "Interrupted repair", normalizedHash: "interrupted" }] : [{ summary: "Healthy tail", normalizedHash: "tail", evidenceAnchors: [{ url: command.url, selector: "main" }], coverageGoalIds: ["goal-a"], mediaCandidates: [] }] } }; } },
    // The final error also models replay of a completed failed repair after its cached critic.
    reviewer: { async review(point) { reviews.push(point.normalizedHash); return point.normalizedHash === "interrupted" ? { ok: false, error } : { ok: true, value: point }; } },
  };
  const command = { ownerId: "owner-a", runId: "run-a", sourceId: "source-a", sourceRevision: 1, rootUrl: "https://example.test", startedAtMs: 0, deadlineAtMs: 1_800_000 };
  const result = await createExtractionRunner(dependencies).run(command);
  if (!result.ok) throw new Error(result.error.kind);
  assertEquals(result.value.scratchpad.acceptedHashes.join(","), "hash-a,tail");
  assertEquals(fixture.points.map(point => point.normalizedHash).join(","), "hash-a,tail");
  assertEquals(result.value.scratchpad.failedPages?.[0].url, urls[0]);
  assertEquals(result.value.scratchpad.failedPages?.[0].attempts, error.attempts ?? 1);
  assertEquals(result.value.scratchpad.failedPages?.[0].failureKind, "WorkflowProcessingInterrupted");
  assertEquals(result.value.scratchpad.pageNotes?.some(note => note.url === urls[0] && note.note.includes(error.causeKind ?? error.kind)), true);
  assertEquals(result.value.scratchpad.processedUrls.join(","), urls[1]);
  assertEquals(reviews.join(","), "hash-a,interrupted,tail");
  const resumed = await createExtractionRunner(dependencies).run(command);
  if (!resumed.ok) throw new Error(resumed.error.kind);
  assertEquals(reviews.join(","), "hash-a,interrupted,tail");
  assertEquals(fixture.points.length, 2);
 }
});

Deno.test("source deadline after a transport interruption checkpoints failure before awaiting approval", async () => {
  for (const phase of ["acquisition", "review"]) {
    const fixture = setup(), urls = ["https://example.test/a", "https://example.test/b"];
    let calls = 0;
    const interrupted = async () => { calls++; fixture.advance(1_800_000); return { ok: /** @type {const} */ (false), error: { kind: "WorkflowStageCallUncertain", causeKind: "KnowledgeModelTimeout" } }; };
    const runner = createExtractionRunner({ ...fixture.dependencies, orderedUrls: urls, planner: inventoryPlanner(fixture, urls), ...(phase === "acquisition" ? { acquirer: { fetchPage: interrupted } } : { reviewer: { review: interrupted } }) });
    const command = { ownerId: "owner-a", runId: "run-a", sourceId: "source-a", sourceRevision: 1, rootUrl: "https://example.test", startedAtMs: 0, deadlineAtMs: 1_800_000 };
    const result = await runner.run(command);
    if (!result.ok) throw new Error(result.error.kind);
    assertEquals(result.value.state, "awaiting-time-limit-decision");
    assertEquals(result.value.stopReason, "time-limit");
    assertEquals(result.value.scratchpad.failedPages?.[0].url, urls[0]);
    assertEquals(result.value.scratchpad.failedPages?.[0].failureKind, "WorkflowProcessingInterrupted");
    assertEquals(calls, 1);
    const replay = await runner.run(command);
    if (!replay.ok) throw new Error(replay.error.kind);
    assertEquals(replay.value.state, "awaiting-time-limit-decision");
    assertEquals(calls, 1);
  }
});

Deno.test("unexplained, accounting and source-wide uncertainty still stop processing", async () => {
  for (const causeKind of [undefined, "AgentLedgerPersistenceFailed", "AgentExecutionBoundaryFailure", "KnowledgeModelUsageInvalid", "WorkflowStagePersistenceFailed"]) {
    for (const phase of ["acquisition", "review", "plan", "replan"]) {
      const fixture = setup(); let failures = 0;
      const error = { kind: "WorkflowStageCallUncertain", ...(causeKind === undefined ? {} : { causeKind }) };
      const rejected = async () => { failures++; return { ok: /** @type {const} */ (false), error }; };
      const runner = createExtractionRunner({ ...fixture.dependencies, ...(phase === "acquisition" ? { acquirer: { fetchPage: rejected } } : phase === "review" ? { reviewer: { review: rejected } } : { planner: { ...fixture.dependencies.planner, [phase]: rejected } }) });
      const result = await runner.run({ ownerId: "owner-a", runId: "run-a", sourceId: "source-a", sourceRevision: 1, rootUrl: "https://example.test", startedAtMs: 0, deadlineAtMs: 1_800_000 });
      assertEquals(result.ok, false);
      assertEquals(failures, 1);
      const loaded = await fixture.dependencies.scratchpad.load({ ownerId: "owner-a", runId: "run-a", sourceId: "source-a", sourceRevision: 1 });
      if (!loaded.ok) throw new Error("Fixture checkpoint unavailable");
      assertEquals(loaded.value.failedPages?.length ?? 0, 0);
    }
  }
  for (const phase of ["plan", "replan"]) {
   for (const error of [{kind:"WorkflowStageCallUncertain",causeKind:"KnowledgeModelTimeout"},{kind:"WorkflowAgentAgentOutputInvalid"}]) {
    const fixture = setup();
    const runner = createExtractionRunner({ ...fixture.dependencies, planner: { ...fixture.dependencies.planner, [phase]: async () => ({ ok: false, error }) } });
    assertEquals((await runner.run({ ownerId: "owner-a", runId: "run-a", sourceId: "source-a", sourceRevision: 1, rootUrl: "https://example.test", startedAtMs: 0, deadlineAtMs: 1_800_000 })).ok, false);
   }
  }
});

Deno.test("uncertain multi-unit acquisitions are never split or replayed as singleton requests", async () => {
 for (const error of [{kind:"WorkflowStageCallUncertain",causeKind:"KnowledgeModelResponseReadFailed"},{kind:"WorkflowAgentAgentOutputInvalid"},{kind:"KnowledgeModelRejected",status:503,technicalAttempts:4,technicalRetriesExhausted:true}]) {
  const fixture = setup(), urls = ["https://example.test/a", "https://example.test/b"];
  /** @type {string[][]} */ const batches = [];
  const runner = createExtractionRunner({ ...fixture.dependencies, planner: inventoryPlanner(fixture, urls), batchAcquirer: { key: "uncertain-multi-unit", async fetchBatch({ urls: batch }) { batches.push([...batch]); return { ok: false, error }; } } });
  const result = await runner.run({ ownerId: "owner-a", runId: "run-a", sourceId: "source-a", sourceRevision: 1, rootUrl: "https://example.test", startedAtMs: 0, deadlineAtMs: 1_800_000 });
  assertEquals(result.ok, false);
  if (!result.ok) { assertEquals(result.error.kind, "ExtractionAcquisitionFailed"); assertEquals("causeKind" in result.error ? result.error.causeKind : undefined, error.kind); }
  assertEquals(batches.length, 1);
  assertEquals(batches[0].join(","), urls.join(","));
  const loaded = await fixture.dependencies.scratchpad.load({ ownerId: "owner-a", runId: "run-a", sourceId: "source-a", sourceRevision: 1 });
  if (!loaded.ok) throw new Error("Fixture checkpoint unavailable");
  assertEquals(loaded.value.failedPages?.length ?? 0, 0);
 }
});


Deno.test("runtime-exhausted technical acquisition retries are not multiplied by page acquisition retries",async()=>{
 const guarded=setup();let unsafeCalls=0;
 const unsafe=createExtractionRunner({...guarded.dependencies,acquirer:{async fetchPage(){unsafeCalls++;return {ok:false,error:{kind:"WorkflowStageCallUncertain",causeKind:"AgentLedgerPersistenceFailed",technicalAttempts:4,technicalRetriesExhausted:true}};}}});
 assertEquals((await unsafe.run({ownerId:"owner-a",runId:"run-a",sourceId:"source-a",sourceRevision:1,rootUrl:"https://example.test",startedAtMs:0,deadlineAtMs:1_800_000})).ok,false);
 assertEquals(unsafeCalls,1);

 for(const error of [{kind:"KnowledgeModelRejected",status:503,technicalAttempts:4,technicalRetriesExhausted:true},{kind:"KnowledgeModelCancelled",technicalAttempts:4,technicalRetriesExhausted:true},{kind:"WorkflowStageCallUncertain",technicalAttempts:4,technicalRetriesExhausted:true}]){
  const fixture=setup(),urls=["https://example.test/a","https://example.test/b"];
  let failedCalls=0;
  const runner=createExtractionRunner({...fixture.dependencies,orderedUrls:urls,planner:inventoryPlanner(fixture,urls),acquirer:{async fetchPage(command){if(command.url===urls[0]){failedCalls++;return {ok:false,error};}return fixture.dependencies.acquirer.fetchPage(command);}}});
  const result=await runner.run({ownerId:"owner-a",runId:"run-a",sourceId:"source-a",sourceRevision:1,rootUrl:"https://example.test",startedAtMs:0,deadlineAtMs:1_800_000});
  if(!result.ok)throw new Error(result.error.kind);
  assertEquals(failedCalls,1);assertEquals(result.value.pagesProcessed,1);assertEquals(result.value.scratchpad.failedPages?.[0].attempts,4);
  assertEquals(result.value.scratchpad.failedPages?.[0].failureKind,error.kind==="WorkflowStageCallUncertain"?"WorkflowProcessingInterrupted":error.kind);
 }
});

Deno.test("batch-reviewed extraction commits in source order and resumes without repeating committed points", async () => {
  const fixture=setup();
  const original=fixture.dependencies.acquirer.fetchPage;
  /** @type {string[][]} */ const batches=[];
  let interrupted=true;
  const runner=createExtractionRunner({...fixture.dependencies,orderedUrls:['https://example.test/a'],planner:inventoryPlanner(fixture,['https://example.test/a']),acquirer:{async fetchPage(command){const page=await original(command);return page.ok?{ok:true,value:{...page.value,candidates:[page.value.candidates[0],{...page.value.candidates[0],normalizedHash:'hash-b',summary:'Second supported relationship'}]}}:page;}},reviewer:{async review(){throw Error('Use the batch boundary');},async reviewBatch(points){batches.push(points.map(p=>p.normalizedHash));return points.map(p=>p.normalizedHash==='hash-b'&&interrupted?{ok:false,error:{kind:'ReviewerUnavailable'}}:{ok:true,value:p});}}});
  const command={ownerId:'owner-a',runId:'run-a',sourceId:'source-a',sourceRevision:1,rootUrl:'https://example.test/',startedAtMs:0,deadlineAtMs:1800000};
  const first=await runner.run(command);
  assertEquals(first.ok,false);assertEquals(fixture.points.length,1);
  interrupted=false;
  const second=await runner.run(command);
  if(!second.ok)throw Error(JSON.stringify(second.error));
  assertEquals(second.ok,true);assertEquals(fixture.points.map(p=>p.normalizedHash).join(','),'hash-a,hash-b');
  assertEquals(batches.map(b=>b.join(',')).join('|'),'hash-a,hash-b|hash-b');
});

for(const mode of ['page','batch'])for(const expired of [false,true])Deno.test(`in-flight ${mode} deadline preserves completed pages and requires a time decision only after expiry=${expired}`,async()=>{
 const fixture=setup(),urls=['https://example.test/a','https://example.test/b'];let calls=0;
 /** @type {import('../src/features/knowledge-workflows/extraction.js').PageAcquirer['fetchPage']} */
 const fetchPage=async(command)=>{calls++;if(command.url===urls[1]){if(expired)fixture.advance(1_800_000);return {ok:false,error:{kind:'WebpageImageRunDeadlineExceeded'}};}return fixture.dependencies.acquirer.fetchPage(command);};
 const runner=createExtractionRunner({...fixture.dependencies,orderedUrls:urls,planner:inventoryPlanner(fixture,urls),...(mode==='batch'?{batchAcquirer:{key:'deadline-batch',maximumBatchSize:1,async fetchBatch(command){const r=await fetchPage({url:command.urls[0],rootUrl:command.rootUrl,plan:command.plan});return r.ok?{ok:true,value:[r.value]}:r;}}}:{acquirer:{fetchPage}})});
 const result=await runner.run({ownerId:'owner-a',runId:'run-a',sourceId:'source-a',sourceRevision:1,rootUrl:'https://example.test/',startedAtMs:0,deadlineAtMs:1_800_000});
 assertEquals(result.ok,expired);assertEquals(calls,2);assertEquals(fixture.points.length,1);
 if(result.ok){assertEquals(result.value.state,'awaiting-time-limit-decision');assertEquals(result.value.stopReason,'time-limit');assertEquals(result.value.pagesProcessed,1);assertEquals(result.value.knowledgePointCount,1);assertEquals(result.value.scratchpad.processedUrls.join(','),urls[0]);assertEquals(result.value.scratchpad.failedPages?.length??0,0);}
});

Deno.test('ready reviews publish durably while later drafts remain pending, without completing the page',async()=>{
 const fixture=setup(),url='https://example.test/a';let wave=0,notifications=0;
 const original=fixture.dependencies.acquirer.fetchPage;
 const runner=createExtractionRunner({...fixture.dependencies,orderedUrls:[url],onKnowledge:()=>{notifications++;assertEquals(fixture.points.length,notifications);},
  acquirer:{fetchPage:async command=>{const r=await original(command);if(!r.ok)return r;return {ok:true,value:{...r.value,candidates:[r.value.candidates[0],{...r.value.candidates[0],normalizedHash:'later',summary:'Later relationship'}]}};}},
  reviewer:{review:async point=>({ok:true,value:point}),reviewBatch:async points=>points.map(point=>point.normalizedHash==='later'&&wave===0?{ok:false,error:{kind:'KnowledgeReviewChunkPending'}}:{ok:true,value:point})},
 });
 const command={ownerId:'owner-a',runId:'run-a',sourceId:'source-a',sourceRevision:1,rootUrl:url,startedAtMs:0,deadlineAtMs:1800000};
 const first=await runner.run(command);if(!first.ok)throw Error(JSON.stringify(first.error));
 assertEquals(first.value.state,'awaiting-time-limit-decision');assertEquals(first.value.knowledgePointCount,1);assertEquals(first.value.pagesProcessed,0);assertEquals(first.value.scratchpad.processedUrls.length,0);assertEquals(notifications,1);
 wave++;const second=await runner.run(command);if(!second.ok)throw Error(JSON.stringify(second.error));
 assertEquals(second.value.state,'completed');assertEquals(second.value.knowledgePointCount,2);assertEquals(fixture.points.length,2);assertEquals(notifications,2);
});

Deno.test('early draft handoff uses the same publication checks before full source acquisition completes',async()=>{
 const fixture=setup(),url='https://example.test/a';let acquiring=true;
 const original=fixture.dependencies.acquirer.fetchPage;
 const runner=createExtractionRunner({...fixture.dependencies,orderedUrls:[url],onKnowledge:()=>assertEquals(acquiring,true),acquirer:{fetchPage:async command=>{
  const r=await original(command);if(!r.ok)return r;
  const handed=await command.onDrafts?.(r.value);assertEquals(handed?.ok,true);assertEquals(fixture.points.length,1);
  acquiring=false;return r;
 }}});
 const result=await runner.run({ownerId:'owner-a',runId:'run-a',sourceId:'source-a',sourceRevision:1,rootUrl:url,startedAtMs:0,deadlineAtMs:1800000});
 if(!result.ok)throw Error(JSON.stringify(result.error));assertEquals(result.value.state,'completed');assertEquals(fixture.points.length,1);
});
