// @ts-check

import { createAgentConfigurationLoader } from "../src/features/knowledge-workflows/config.js";
import { createContextCompactor } from "../src/features/knowledge-workflows/context.js";
import { createAgentMemoryStore } from "../src/features/knowledge-workflows/memory.js";
import { createKnowledgeWorkflowAgentRuntime } from "../worker/knowledge-workflow-agent-runtime.js";

/** @template T @param {T} actual @param {T} expected */
function assertEquals(actual, expected) { if (!Object.is(actual, expected)) throw new Error(`Expected ${String(expected)}, received ${String(actual)}.`); }

/** @param {unknown} value */
function assertTrue(value) { if (value !== true) throw new Error("Expected true."); }

const roles = /** @type {const} */ (["rights-assessor", "knowledge-scraper", "question-generator", "question-evaluator"]);

Deno.test("resumed scraper requests replay brief model notes without prior source content", async () => {
  const store = memory();
  const snapshots = await configurationSnapshots();
  /** @type {Record<string, unknown>[]} */ const calls = [];
  const makeRuntime = () => createKnowledgeWorkflowAgentRuntime({
    model: { generate: async (value) => {
      const request = /** @type {{ input: Record<string, unknown> }} */ (value);
      calls.push(request.input);
      return { ok: true, value: { output: { pages: [{ url: "https://example.test/page-1", notes: "The figure distinguishes two phases.", candidates: [{ summary: "private-source-marker", evidenceAnchors: [] }] }] }, requestId: "request", inputTokens: 10, outputTokens: 10, reasoningTrace: null } };
    } },
    memory: store, eventLedger: { append: async () => null },
    compactor: createContextCompactor({ now: () => "2026-09-17T00:00:00Z", digest: (value) => `digest:${value.length}`, appendRecord: async () => null, logger: () => {} }),
    configSnapshots: snapshots, now: () => "2026-09-17T00:00:00Z", logger: () => {},
  });
  const command = { ownerId: "owner-memory", runId: "run-memory", role: /** @type {const} */ ("knowledge-scraper"), taskId: "page", systemPrompt: "Return JSON", input: { text: "private-source-marker" }, maxOutputTokens: 16 };
  if (!(await makeRuntime().run(command)).ok) throw new Error("Initial page failed.");
  if (!(await makeRuntime().run({ ...command, taskId: "page-2", input: { text: "new-page" } })).ok) throw new Error("Resumed page failed.");
  const resumed = calls.at(-1);
  if (resumed === undefined || !JSON.stringify(resumed).includes("The figure distinguishes two phases.") || JSON.stringify(resumed.memory).includes("candidates") || JSON.stringify(resumed.memory).includes("pages") || JSON.stringify(resumed).includes("private-source-marker")) throw new Error("Resumed request replayed source content or lost the model note.");
});

Deno.test("agent memory replays notes while retaining exact facts outside model context", async () => {
  const store = memory();
  const namespace = await store.createNamespace({ ownerId: "owner-memory", runId: "run-memory", role: "knowledge-scraper" });
  if (!namespace.ok) throw new Error(namespace.error.kind);
  async function seed(id = "", payload = {}, kind = /** @type {import("../src/features/knowledge-workflows/memory.js").AgentMemoryRecord["kind"]} */ ("working-memory")) {
    if (!namespace.ok) throw new Error("namespace unavailable");
    const added = await store.appendRecord(namespace.value, { id, kind, payload, sourceEventId: `event:${id}`, visibility: "private", retention: "run", integrityVersion: 1 });
    assertEquals(added.ok, true);
  }
  for (let i = 0; i < 11; i++) await seed(`batch-${i}`, { notes: `concept-${i}` });
  const facts = { processedUrls: ["https://example.test/page-1"], coverage: ["goal-a"], unresolvedGaps: ["gap-b"] };
  await seed("exact-facts", facts, "durable-fact");
  let summaries = 0;
  /** @type {Record<string, unknown>[]} */ const calls = [];
  const snapshots = await configurationSnapshots();
  const signal=new AbortController().signal;
  const makeRuntime = () => createKnowledgeWorkflowAgentRuntime({
    model: { generate: async (value) => {
      const request = /** @type {{ input: Record<string, unknown>, maxOutputTokens: number, signal?:AbortSignal }} */ (value);
      assertEquals(request.signal,signal);
      const summary = request.input.operation === "compact-working-context";
      if (summary) summaries++;
      else { calls.push(request.input); assertEquals(request.maxOutputTokens, 16); }
      return { ok: true, value: { output: summary ? { summary: "Covered concepts; preserve the exact durable facts." } : { answer: "ok" }, requestId: "request", inputTokens: 100, outputTokens: 10, reasoningTrace: null } };
    } },
    memory: store, eventLedger: { append: async () => null },
    compactor: createContextCompactor({ now: () => "2026-09-08T00:00:00Z", digest: (value) => `digest:${value.length}`, appendRecord: async () => null, logger: () => {} }),
    configSnapshots: snapshots, now: () => "2026-09-08T00:00:00Z", logger: () => {},
  });
  const command = { ownerId: "owner-memory", runId: "run-memory", role: /** @type {const} */ ("knowledge-scraper"), taskId: "batch", systemPrompt: "Return JSON", input: { task: "next" }, maxOutputTokens: 16,signal };
  assertEquals((await makeRuntime().run(command)).ok, true);
  assertEquals(summaries, 0);
  assertEquals(/** @type {unknown[]} */ (calls[0].memory).length, 11);
  for (let cycle = 0; cycle < 2; cycle++) {
    await seed(`large-${cycle}`, { text: "x".repeat(1_500_000) });
    assertEquals((await makeRuntime().run(command)).ok, true);
    assertEquals(summaries, 0);
    const sent = calls.at(-1);
    if (sent === undefined) throw new Error("No model input");
    assertEquals(/** @type {unknown[]} */ (sent.memory).length, 11);
    assertEquals(Object.hasOwn(sent, "durableMemory"), false);
    assertEquals(JSON.stringify(sent.memory).includes("x".repeat(100)), false);
    assertEquals((await makeRuntime().run(command)).ok, true);
    assertEquals(summaries, 0);
  }
  const raw = await store.listRecords(namespace.value);
  if (!raw.ok) throw new Error(raw.error.kind);
  assertEquals(raw.value.filter((entry) => entry.id.startsWith("large-")).length, 2);
  assertEquals(raw.value.filter((entry) => entry.id.startsWith("batch-")).length, 11);
  assertEquals(raw.value.some((entry) => JSON.stringify(entry.payload).includes('"inputTokens":100')), true);
  const foreign = await makeRuntime().run({ ...command, ownerId: "other-owner" });
  assertEquals(foreign.ok, true);
  assertEquals(/** @type {unknown[]} */ (calls.at(-1)?.memory).length, 0);
  const sharedRuntime = makeRuntime();
  const [firstCall, overlappingCall] = await Promise.all([sharedRuntime.run(command), sharedRuntime.run(command)]);
  assertEquals(firstCall.ok, true);
  assertEquals(overlappingCall.ok, false);
  if (!overlappingCall.ok) assertEquals(overlappingCall.error.kind, "ContextLimitBeforeSafeCheckpoint");
  assertEquals((await sharedRuntime.run(command)).ok, true);
  const scopedRuntime = makeRuntime();
  assertEquals((await scopedRuntime.run({ ...command, ownerId: "a\u001fb", runId: "c" })).ok, true);
  assertEquals((await scopedRuntime.run({ ...command, ownerId: "a", runId: "b\u001fc" })).ok, true);
  assertEquals(/** @type {unknown[]} */ (calls.at(-1)?.memory).length, 0);
  const distinctScopes = await Promise.all([
    scopedRuntime.run({ ...command, ownerId: "d\u001fe", runId: "f" }),
    scopedRuntime.run({ ...command, ownerId: "d", runId: "e\u001ff" }),
  ]);
  assertEquals(distinctScopes.every((result) => result.ok), true);
  await seed("oversized-exact-facts", { text: "x".repeat(1_500_000) }, "durable-fact");
  assertEquals((await makeRuntime().run(command)).ok, true);
  assertEquals(JSON.stringify(calls.at(-1)).includes("x".repeat(100)), false);
  const callsBeforeFailure = calls.length;
  const summariesBeforeFailure = summaries;
  await seed("invalid-summary", { type: "compacted-context", summary: "Invalid coverage must not hide data.", coveredRecordIds: ["missing-record"], coveredEventIds: ["missing-event"] });
  const invalidCoverage = await makeRuntime().run(command);
  assertEquals(invalidCoverage.ok, false);
  if (!invalidCoverage.ok) assertEquals(invalidCoverage.error.kind, "WorkflowAgentMemoryInvalid");
  assertEquals(calls.length, callsBeforeFailure);
  assertEquals(summaries, summariesBeforeFailure);
});

async function configurationSnapshots() {
  const loader = createAgentConfigurationLoader({ sha256: async (input) => `sha256:test-${input.length}` });
  /** @type {Record<string, import("../src/features/knowledge-workflows/config.js").AgentConfigurationSnapshot>} */
  const snapshots = {};
  for (const role of roles) {
    const source = await Deno.readTextFile(new URL(`../agent-config/${role}.yaml`, import.meta.url));
    const loaded = await loader.load({ source, expectedRole: role });
    if (!loaded.ok) throw new Error(`Expected ${role} configuration.`);
    snapshots[role] = loaded.value;
  }
  return /** @type {Readonly<Record<import("../src/features/knowledge-workflows/memory.js").AgentRole, import("../src/features/knowledge-workflows/config.js").AgentConfigurationSnapshot>>} */ (snapshots);
}

function memory() {
  /** @type {Map<string, import("../src/features/knowledge-workflows/memory.js").AgentMemoryNamespace>} */
  const namespaces = new Map();
  /** @type {Map<string, import("../src/features/knowledge-workflows/memory.js").AgentMemoryRecord[]>} */
  const records = new Map();
  return createAgentMemoryStore({
    repository: {
      async findNamespace(id) { return namespaces.get(id) ?? null; },
      async createNamespace(namespace) { namespaces.set(namespace.id, namespace); records.set(namespace.id, []); return null; },
      async appendRecord(record) { records.get(record.namespaceId)?.push(record); return null; },
      async listRecords(namespaceId) { return records.get(namespaceId) ?? []; },
      async appendHandoff() { return null; },
    },
    now: () => "2026-08-13T00:00:00.000Z",
    logger: () => {},
  });
}

Deno.test("agent runtime records configured tool digests without persisting binary result bytes", async () => {
  const events = /** @type {Record<string, unknown>[]} */ ([]);
  const runtime = createKnowledgeWorkflowAgentRuntime({
    model: { generate: async () => ({ ok: true, value: { output: { answer: "ok" }, requestId: "request-a", inputTokens: null, outputTokens: null, reasoningTrace: null } }) },
    memory: memory(),
    eventLedger: { append: async (event) => { events.push(/** @type {Record<string, unknown>} */ (event)); return null; } },
    compactor: createContextCompactor({ now: () => "2026-08-13T00:00:00.000Z", digest: (value) => `digest:${value.length}`, appendRecord: async () => null, logger: () => {} }),
    configSnapshots: await configurationSnapshots(),
    toolExecutors: {
      "rights-evidence.read": async () => ({ ok: true, value: { bytes: new Uint8Array([1, 2, 3]), text: "private source body", status: "allowed" } }),
    },
    now: () => "2026-08-13T00:00:00.000Z",
    logger: () => {},
  });
  const result = await runtime.invokeTool({ ownerId: "owner-a", runId: "run-a", role: "rights-assessor", taskId: "rights-a", name: "rights-evidence.read", input: { sourceId: "source-a" } });
  assertEquals(result.ok, true);
  if (!result.ok) return;
  if (typeof result.value !== "object" || result.value === null || !("bytes" in result.value)) throw new Error("Expected binary tool value.");
  assertTrue(result.value.bytes instanceof Uint8Array);
  assertEquals(events.length, 2);
  const serializedEvents = JSON.stringify(events);
  assertTrue(!serializedEvents.includes("private source body"));
  assertTrue(!serializedEvents.includes("1,2,3"));
});

Deno.test("agent runtime rejects circular tool and model inputs before creating a ledger event", async () => {
  const events = /** @type {unknown[]} */ ([]);
  const runtime = createKnowledgeWorkflowAgentRuntime({
    model: { generate: async () => ({ ok: true, value: { output: {}, requestId: "request-b", inputTokens: null, outputTokens: null, reasoningTrace: null } }) },
    memory: memory(),
    eventLedger: { append: async (event) => { events.push(event); return null; } },
    compactor: createContextCompactor({ now: () => "2026-08-13T00:00:00.000Z", digest: (value) => `digest:${value.length}`, appendRecord: async () => null, logger: () => {} }),
    configSnapshots: await configurationSnapshots(),
    toolExecutors: { "rights-evidence.read": async () => ({ ok: true, value: null }) },
    now: () => "2026-08-13T00:00:00.000Z",
    logger: () => {},
  });
  /** @type {Record<string, unknown>} */
  const circular = {};
  circular.self = circular;
  const result = await runtime.invokeTool({ ownerId: "owner-a", runId: "run-b", role: "rights-assessor", taskId: "rights-b", name: "rights-evidence.read", input: circular });
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error.kind, "WorkflowAgentValueNotSerializable");
  assertEquals(events.length, 0);
  const modelResult = await runtime.run({ ownerId: "owner-a", runId: "run-b", role: "rights-assessor", taskId: "model-b", systemPrompt: "Return JSON", input: circular, maxOutputTokens: 16 });
  assertEquals(modelResult.ok, false);
  if (!modelResult.ok) assertEquals(modelResult.error.kind, "WorkflowAgentValueNotSerializable");
  assertEquals(events.length, 0);
});

Deno.test("agent runtime preserves safe provider error termination metadata without another model turn",async()=>{
 let calls=0;const runtime=createKnowledgeWorkflowAgentRuntime({model:{generate:async()=>{calls++;return {ok:false,error:{kind:"KnowledgeModelRejected",status:200,retryAfterMs:1500,finishReason:/** @type {const} */("error")}};}},memory:memory(),eventLedger:{append:async()=>null},compactor:createContextCompactor({now:()=>"2026-08-13T00:00:00.000Z",digest:value=>`digest:${value.length}`,appendRecord:async()=>null,logger:()=>{}}),configSnapshots:await configurationSnapshots(),now:()=>"2026-08-13T00:00:00.000Z",logger:()=>{}});
 const result=await runtime.run({ownerId:"synthetic-owner",runId:"synthetic-run",role:"question-evaluator",taskId:"synthetic-first-critic",systemPrompt:"Constructed only",input:{claim:"Constructed"},maxOutputTokens:2048});assertEquals(result.ok,false);if(result.ok)throw new Error("Provider error cannot become successful model output");assertEquals(result.error.kind,"KnowledgeModelRejected");assertEquals(result.error.status,200);assertEquals(/** @type {{retryAfterMs?:number}} */(result.error).retryAfterMs,1500);assertEquals(/** @type {{finishReason?:string}} */(result.error).finishReason,"error");assertEquals(calls,1);
});

Deno.test("agent runtime retains the model response rejection field in its saved failure", async () => {
  const runtime = createKnowledgeWorkflowAgentRuntime({
    model: {generate: async () => ({ok:false,error:{kind:"KnowledgeModelResponseInvalid",field:"finish_reason"}})},
    memory: memory(), eventLedger: {append:async()=>null},
    compactor: createContextCompactor({now:()=>"2026-10-16T00:00:00Z",digest:value=>`digest:${value.length}`,appendRecord:async()=>null,logger:()=>{}}),
    configSnapshots: await configurationSnapshots(), now:()=>"2026-10-16T00:00:00Z", logger:()=>{},
  });
  const result = await runtime.run({ownerId:"diagnostic-owner",runId:"diagnostic-run",role:"knowledge-scraper",taskId:"page",systemPrompt:"Return JSON",input:{},maxOutputTokens:4096});
  assertEquals(result.ok,false);
  if (!result.ok) assertEquals(/** @type {{field?:string}} */(result.error).field,"finish_reason");
});

Deno.test("agent runtime accepts configured request windows above 90 seconds and clamps overrides", async () => {
  const snapshots = await configurationSnapshots();
  const configured = snapshots["knowledge-scraper"].limits.timeoutMs;
  assertTrue(configured > 90_000);
  let observedTimeout = 0;
  const runtime = createKnowledgeWorkflowAgentRuntime({
    model: { generate: async (value) => {
      observedTimeout = /** @type {{timeoutMs:number}} */ (value).timeoutMs;
      return {ok:true,value:{output:{answer:"ok"},requestId:"window",inputTokens:null,outputTokens:null,reasoningTrace:null}};
    } },
    memory: memory(), eventLedger: {append:async()=>null},
    compactor: createContextCompactor({now:()=>"2026-10-13T00:00:00Z",digest:value=>`digest:${value.length}`,appendRecord:async()=>null,logger:()=>{}}),
    configSnapshots:snapshots,now:()=>"2026-10-13T00:00:00Z",logger:()=>{},
  });
  const command={ownerId:"window-owner",runId:"window-run",role:/** @type {const} */("knowledge-scraper"),taskId:"window",systemPrompt:"Return JSON",input:{},maxOutputTokens:16,timeoutMs:configured};
  assertEquals((await runtime.run(command)).ok,true);
  assertEquals(observedTimeout,configured);
  assertEquals((await runtime.run({...command,timeoutMs:configured+1})).ok,true);
  assertEquals(observedTimeout,configured);
});

Deno.test("agent private working usage retains request receipts, actual cost and cache observations", async () => {
  for(const observations of [{costNanodollars:0,cachedInputTokens:0,cacheWriteInputTokens:0},{costNanodollars:123456,cachedInputTokens:321,cacheWriteInputTokens:12},{}]){
    const store=memory(),snapshots=await configurationSnapshots();
    const runtime=createKnowledgeWorkflowAgentRuntime({model:{generate:async()=>({ok:true,value:{output:{answer:"ok"},requestId:"cache-receipt",inputTokens:400,outputTokens:10,reasoningTrace:null,...observations}})},memory:store,eventLedger:{append:async()=>null},compactor:createContextCompactor({now:()=>"2026-10-28T00:00:00Z",digest:value=>`digest:${value.length}`,appendRecord:async()=>null,logger:()=>{}}),configSnapshots:snapshots,now:()=>"2026-10-28T00:00:00Z",logger:()=>{}});
    const scope={ownerId:"owner-cache",runId:"run-cache",role:/** @type {const} */("question-evaluator")};
    const result=await runtime.run({...scope,taskId:"cache-review",systemPrompt:"Return JSON",input:{},maxOutputTokens:16});
    assertEquals(result.ok,true);
    const namespace=await store.createNamespace(scope);if(!namespace.ok)throw new Error(namespace.error.kind);
    const records=await store.listRecords(namespace.value);if(!records.ok)throw new Error(records.error.kind);
    const entry=records.value.find(entry=>entry.id.startsWith("working:"));
    if(entry===undefined)throw new Error("Missing private working usage.");
    assertEquals(entry.visibility,"private");
    const payload=/** @type {{usage:{requestId:string,inputTokens:number,outputTokens:number,costNanodollars:number|null,cachedInputTokens:number|null,cacheWriteInputTokens:number|null}}} */(entry.payload);
    assertEquals(payload.usage.requestId,"cache-receipt");assertEquals(payload.usage.inputTokens,400);assertEquals(payload.usage.outputTokens,10);
    for(const key of /** @type {const} */(["costNanodollars","cachedInputTokens","cacheWriteInputTokens"]))assertEquals(payload.usage[key],observations[key]??null);
  }
});
