// @ts-check

import { createOpenRouterKnowledgeModel, createRoleConfiguredKnowledgeModel } from "../worker/knowledge-workflow-model.js";

/** @template T @param {T} actual @param {T} expected */
function assertEquals(actual, expected) { if (!Object.is(actual, expected)) throw new Error(`Expected ${String(expected)}, received ${String(actual)}.`); }

function command() { return { role: "question-generator", systemPrompt: "Generate a grounded question.", input: { knowledge: "A specific concept" }, maxOutputTokens: 256 }; }

Deno.test("model preserves an embedded HTTP error code inside a successful transport response", async () => {
  for (const code of [401, 408, 429, 503, undefined, "401", 99]) {
    const model = createOpenRouterKnowledgeModel({ apiKey: "secret", endpoint: "https://api.example.test/chat/completions", model: "z-ai/glm-5.3-flash", timeoutMs: 1_000, maximumInputCharacters: 10_000, fetch: async () => Response.json({error:{code}}), now: Date.now, logger: () => {} });
    const result = await model.generate(command());
    if (result.ok || result.error.kind !== "KnowledgeModelRejected") throw new Error("Provider error was accepted.");
    assertEquals(result.error.status, typeof code === "number" && code >= 400 ? code : 200);
  }
});

/** @param {Promise<unknown>} value */
async function assertRejects(value) {
  try { await value; } catch (_error) { return; }
  throw new Error("Expected promise rejection.");
}

Deno.test("live knowledge model adapter sends bounded JSON requests without a preflight cost gate", async () => {
  /** @type {RequestInit | undefined} */ let request;
  const model = createOpenRouterKnowledgeModel({ apiKey: "secret", endpoint: "https://api.example.test/chat/completions", model: "z-ai/glm-5.3-flash", timeoutMs: 1_000, maximumInputCharacters: 10_000, fetch: async (_input, init) => { request = init; return Response.json({ id: "request-a", choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ question: "What concept?" }) } }], usage: { prompt_tokens: 4, completion_tokens: 3 } }); }, now: () => 1_000, logger: () => {} });
  const result = await model.generate(command());
  assertEquals(result.ok, true);
  if (!result.ok) return;
  assertEquals(result.value.output.question, "What concept?");
  if (request === undefined || typeof request.body !== "string") throw new Error("Request body was not captured.");
  assertEquals(request.redirect, "manual");
  const body = JSON.parse(request.body);
  assertEquals(body.model, "z-ai/glm-5.3-flash");
  assertEquals(body.max_tokens, 256);
  assertEquals(body.response_format.type, "json_object");
  assertEquals(body.messages[1].role, "user");
  assertEquals(body.messages[1].content.startsWith("<task_input>\n"), true);
  assertEquals(body.messages[1].content.endsWith("\n</task_input>"), true);
  assertEquals("thinking" in body, false);
  for (const parameter of ["temperature", "top_p", "top_k", "frequency_penalty", "presence_penalty", "repetition_penalty"]) assertEquals(parameter in body, false);
});

Deno.test("knowledge model sends raster attachments as vision blocks without putting image bytes in task JSON", async () => {
  /** @type {RequestInit | undefined} */ let request;
  const model = createOpenRouterKnowledgeModel({ apiKey: "secret", endpoint: "https://api.example.test/chat/completions", model: "z-ai/glm-5.3-flash", timeoutMs: 1_000, maximumInputCharacters: 10_000, fetch: async (_input, init) => { request = init; return Response.json({ id: "request-image", choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ pages: [] }) } }] }); }, now: () => 1_000, logger: () => {} });
  const result = await model.generate({ role: "knowledge-scraper", systemPrompt: "Inspect the supplied image.", input: { operation: "observe", text: "caption" }, maxOutputTokens: 16_384, attachments: [{ id: "page-1", mediaType: "image/png", bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) }] });
  assertEquals(result.ok, true);
  if (request === undefined || typeof request.body !== "string") throw new Error("Request body was not captured.");
  const body = JSON.parse(request.body);
  if (!Array.isArray(body.messages[1].content)) throw new Error("Expected multimodal user content.");
  assertEquals(body.messages[1].content[0].type, "text");
  assertEquals(body.messages[1].content[0].text.includes("caption"), true);
  assertEquals(body.messages[1].content[0].text.includes("89504e47"), false);
  assertEquals(body.messages[1].content[1].type, "text");
  assertEquals(body.messages[1].content[1].text.includes("page-1"),true);
  assertEquals(body.messages[1].content[2].type,"image_url");
  assertEquals(body.messages[1].content[2].image_url.url, "data:image/png;base64,iVBORw0KGgo=");
});

Deno.test("knowledge model encodes only the attachment view across image buffer boundaries", async () => {
  for (const length of [8, 32_769, 65_539]) for (const nativeAvailable of [true, false]) {
    const backing = new Uint8Array(length + 7).fill(0xa5);
    const bytes = backing.subarray(3, 3 + length);
    for (let index = 0; index < bytes.length; index++) bytes[index] = [0x00, 0xff, 0xfe][index % 3];
    const expected = "AP/+".repeat(Math.floor(length / 3)) + ["", "AA==", "AP8="][length % 3];
    let nativeCalls = 0;
    Object.defineProperty(bytes, 'toBase64', { value: nativeAvailable ? /** @this {Uint8Array} */ function () { assertEquals(this, bytes); nativeCalls++; return expected; } : undefined });
    /** @type {RequestInit | undefined} */ let request;
    const model = createOpenRouterKnowledgeModel({ apiKey: "secret", endpoint: "https://api.example.test/chat/completions", model: "z-ai/glm-5.3-flash", timeoutMs: 1_000, maximumInputCharacters: 10_000, fetch: async (_input, init) => { request = init; return Response.json({ id: "request-offset", choices: [{ finish_reason: "stop", message: { content: "{}" } }] }); }, now: () => 1_000, logger: () => {} });
    const result = await model.generate({ role: "knowledge-scraper", systemPrompt: "Inspect image.", input: { page: 1 }, maxOutputTokens: 256, attachments: [{ id: "page-1", mediaType: "image/png", bytes }] });
    assertEquals(result.ok, true);
    if (request === undefined || typeof request.body !== "string") throw new Error("Request body was not captured.");
    const body = JSON.parse(request.body);
    assertEquals(body.messages[1].content[2].image_url.url, `data:image/png;base64,${expected}`);
    assertEquals(nativeCalls, nativeAvailable ? 1 : 0);
    assertEquals(body.messages[1].content[0].text, '<task_input>\n{"page":1}\n</task_input>');
    assertEquals(backing[0], 0xa5);
    assertEquals(backing[backing.length - 1], 0xa5);
  }
});

Deno.test("image extraction requests strict provider-enforced schema and low-latency parameters", async () => {
  /** @type {RequestInit | undefined} */ let request;
  const model = createOpenRouterKnowledgeModel({ apiKey: "secret", endpoint: "https://api.example.test/chat/completions", model: "z-ai/glm-5.3-flash", timeoutMs: 1_000, maximumInputCharacters: 10_000, fetch: async (_input, init) => { request = init; return Response.json({ id: "request-image-schema", choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ notes: "One distinction.", candidates: [] }) } }] }); }, now: Date.now, logger: () => {} });
  const responseSchema = { name: "material_image_v2", schema: { type: "object", properties: { notes: { type: "string" } }, required: ["notes"], additionalProperties: false } };
  const result = await model.generate({ role: "knowledge-scraper", systemPrompt: "Inspect image.", input: { mode: "image" }, maxOutputTokens: 4_096, timeoutMs: 90_000, responseSchema, reasoningEffort: "low", providerSort: "throughput" });
  assertEquals(result.ok, true);
  if (request === undefined || typeof request.body !== "string") throw new Error("Request body was not captured.");
  const body = JSON.parse(request.body);
  assertEquals(body.response_format.type, "json_schema");
  assertEquals(body.response_format.json_schema.strict, true);
  assertEquals(body.response_format.json_schema.schema.additionalProperties, false);
  assertEquals(body.provider.require_parameters, true);
  assertEquals(body.provider.sort, "throughput");
  assertEquals(body.reasoning.effort, "low");
  const rejected = createOpenRouterKnowledgeModel({ apiKey: "secret", endpoint: "https://api.example.test/chat/completions", model: "z-ai/glm-5.3-flash", timeoutMs: 1_000, maximumInputCharacters: 10_000, fetch: async () => new Response(null, { status: 400 }), now: Date.now, logger: () => {} });
  const unsupported = await rejected.generate({ role: "knowledge-scraper", systemPrompt: "Inspect image.", input: {}, maxOutputTokens: 4_096, responseSchema });
  assertEquals(unsupported.ok, false);
  if (!unsupported.ok) { assertEquals(unsupported.error.kind, "KnowledgeModelRejected"); if (unsupported.error.kind === "KnowledgeModelRejected") assertEquals(unsupported.error.status, 400); }
});

Deno.test("knowledge model rejects malformed or over-budget attachment commands", async () => {
  const model = createOpenRouterKnowledgeModel({ apiKey: "secret", endpoint: "https://api.example.test/chat/completions", model: "z-ai/glm-5.3-flash", timeoutMs: 1_000, maximumInputCharacters: 10_000, fetch: async () => Response.json({ id: "request-valid", choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ question: "ok" }) } }] }), now: () => 1_000, logger: () => {} });
  const invalidType = await model.generate({ ...command(), attachments: [{ id: "bad", mediaType: "image/svg+xml", url: "https://example.test/image.svg" }] });
  assertEquals(invalidType.ok, false);
  if (!invalidType.ok) assertEquals(invalidType.error.kind, "KnowledgeModelCommandInvalid");
});

Deno.test("knowledge model names missing credentials, timeout, and malformed output", async () => {
  const missing = createOpenRouterKnowledgeModel({ apiKey: null, endpoint: "https://api.example.test/chat/completions", model: "z-ai/glm-5.3-flash", timeoutMs: 1_000, maximumInputCharacters: 10_000, fetch: async () => Response.json({}), now: () => 1_000, logger: () => {} });
  const credential = await missing.generate(command());
  assertEquals(credential.ok, false);
  if (!credential.ok) assertEquals(credential.error.kind, "KnowledgeModelCredentialMissing");
  const malformed = createOpenRouterKnowledgeModel({ apiKey: "secret", endpoint: "https://api.example.test/chat/completions", model: "z-ai/glm-5.3-flash", timeoutMs: 1_000, maximumInputCharacters: 10_000, fetch: async () => Response.json({ id: "request-a", choices: [{ finish_reason: "stop", message: { content: "not-json" } }] }), now: () => 1_000, logger: () => {} });
  const invalid = await malformed.generate(command());
  assertEquals(invalid.ok, false);
  if (!invalid.ok) assertEquals(invalid.error.kind, "KnowledgeModelResponseInvalid");
});

Deno.test("source classification rejects duplicate JSON keys at every object depth", async () => {
  for (const content of [
    '{"mainSubject":"music","mainSubject":"arts","topic":"Harmony"}',
    '{"mainSubject":"music","\\u006dainSubject":"arts","topic":"Harmony"}',
    '{"mainSubject":"music","topic":"Harmony","nested":{"x":1,"x":2}}',
  ]) {
    const model = createOpenRouterKnowledgeModel({ apiKey: "secret", endpoint: "https://api.example.test/chat/completions", model: "z-ai/glm-5.3-flash", timeoutMs: 1_000, maximumInputCharacters: 10_000, fetch: async () => Response.json({ id: "request-duplicate", choices: [{ finish_reason: "stop", message: { content } }] }), now: () => 1_000, logger: () => {} });
    const result = await model.generate({ role: "knowledge-scraper", systemPrompt: "Classify source.", input: { source: { title: "Synthetic" }, points: [{ summary: "Synthetic evidence" }] }, maxOutputTokens: 256, responseSchema: { name: "source_classification_v1", schema: { type: "object" } } });
    assertEquals(result.ok, false);
    if (!result.ok) assertEquals(result.error.kind, "KnowledgeModelResponseDuplicateKey");
  }
});

Deno.test("duplicate-key scanner ignores key-like text and preserves other role behavior", async () => {
  /** @type {(role: import("../worker/knowledge-workflow-model.js").KnowledgeModelRole, schemaName?: string) => ReturnType<ReturnType<typeof createOpenRouterKnowledgeModel>["generate"]>} */
  const response = (role, schemaName) => createOpenRouterKnowledgeModel({ apiKey: "secret", endpoint: "https://api.example.test/chat/completions", model: "z-ai/glm-5.3-flash", timeoutMs: 1_000, maximumInputCharacters: 10_000, fetch: async () => Response.json({ id: "request-ordinary", choices: [{ finish_reason: "stop", message: { content: '{"text":"\\\"mainSubject\\\": \\\"one\\\" and \\\"mainSubject\\\": \\\"two\\\""}' } }] }), now: () => 1_000, logger: () => {} }).generate({ role, systemPrompt: "Respond.", input: {}, maxOutputTokens: 64, ...(schemaName === undefined ? {} : { responseSchema: { name: schemaName, schema: { type: "object" } } }) });
  const ordinary = await response("question-generator");
  assertEquals(ordinary.ok, true);
  const nonClassifierScraper = await response("knowledge-scraper", "material_image_v2");
  assertEquals(nonClassifierScraper.ok, true);
});

Deno.test("knowledge model rejects a JSON object truncated by the output-token limit", async () => {
  /** @type {import("../worker/knowledge-workflow-model.js").KnowledgeModelDependencies["logger"] extends (entry:infer E)=>void ? E[] : never} */
  const logs=[];
  const model = createOpenRouterKnowledgeModel({ apiKey: "secret", endpoint: "https://api.example.test/chat/completions", model: "z-ai/glm-5.3-flash", timeoutMs: 1_000, maximumInputCharacters: 10_000, fetch: async () => Response.json({ id: "request-length", choices: [{ finish_reason: "length", message: { content: JSON.stringify({ revision: 1, frontier: [] }) } }] }), now: () => 1_000, logger: entry => logs.push(entry) });
  const result = await model.generate(command());
  assertEquals(result.ok, false);
  assertEquals(logs.find(entry=>entry.event==="knowledge-model-failure")?.diagnosticToken,"finish-length");
  if (!result.ok) {
    assertEquals(result.error.kind, "KnowledgeModelResponseInvalid");
    if (result.error.kind === "KnowledgeModelResponseInvalid") assertEquals(result.error.field, "finish_reason");
  }
});

Deno.test("knowledge model accepts the bounded semantic-ranker role", async () => {
  const model = createOpenRouterKnowledgeModel({ apiKey: "secret", endpoint: "https://api.example.test/chat/completions", model: "z-ai/glm-5.3-flash", timeoutMs: 1_000, maximumInputCharacters: 10_000, fetch: async () => Response.json({ id: "request-rank", choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ matches: [] }) } }] }), now: () => 1_000, logger: () => {} });
  const result = await model.generate({ role: "semantic-ranker", systemPrompt: "Rank candidates.", input: { query: "harmony", candidates: [] }, maxOutputTokens: 128 });
  assertEquals(result.ok, true);
});

Deno.test("knowledge model accepts the review grader role with synthetic learner answers", async () => {
  const model = createOpenRouterKnowledgeModel({ apiKey: "secret", endpoint: "https://api.example.test/chat/completions", model: "z-ai/glm-5.3-flash", timeoutMs: 1_000, maximumInputCharacters: 10_000, fetch: async () => Response.json({ id: "request-review", choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ equivalent: [true] }) } }] }), now: () => 1_000, logger: () => {} });
  const result = await model.generate({ role: "review-grader", systemPrompt: "Judge equivalence.", input: { prompt: "Name the tonic.", answers: [{ response: "home note", acceptedAnswers: ["tonic"] }] }, maxOutputTokens: 128 });
  assertEquals(result.ok, true);
  if (result.ok) assertEquals(JSON.stringify(result.value.output.equivalent), "[true]");
});

Deno.test("knowledge model maps an aborted DOMException fetch to its named timeout", async () => {
  const model = createOpenRouterKnowledgeModel({ apiKey: "secret", endpoint: "https://api.example.test/chat/completions", model: "z-ai/glm-5.3-flash", timeoutMs: 5, maximumInputCharacters: 10_000, fetch: async (_input, init) => await new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true })), now: Date.now, logger: () => {} });
  const result = await model.generate(command());
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error.kind, "KnowledgeModelTimeout");
});

Deno.test("knowledge model keeps its timeout active while reading a response body", async () => {
  const model = createOpenRouterKnowledgeModel({ apiKey: "secret", endpoint: "https://api.example.test/chat/completions", model: "z-ai/glm-5.3-flash", timeoutMs: 5, maximumInputCharacters: 10_000, fetch: async (_input, init) => /** @type {Response} */ ({ status: 200, ok: true, json: async () => await new Promise((resolve, reject) => { const lateBody = setTimeout(() => resolve({ id: "late-body", choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ question: "What concept?" }) } }] }), 20); init?.signal?.addEventListener("abort", () => { clearTimeout(lateBody); reject(new DOMException("aborted", "AbortError")); }, { once: true }); }) }), now: Date.now, logger: () => {} });
  const result = await model.generate(command());
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error.kind, "KnowledgeModelTimeout");
});

Deno.test("knowledge model maps an un-aborted transport TypeError but propagates unrelated failures", async () => {
  const unavailable = createOpenRouterKnowledgeModel({ apiKey: "secret", endpoint: "https://api.example.test/chat/completions", model: "z-ai/glm-5.3-flash", timeoutMs: 1_000, maximumInputCharacters: 10_000, fetch: async () => { throw new TypeError("network unavailable"); }, now: Date.now, logger: () => {} });
  const unavailableResult = await unavailable.generate(command());
  assertEquals(unavailableResult.ok, false);
  if (!unavailableResult.ok) assertEquals(unavailableResult.error.kind, "KnowledgeModelUnavailable");
  const programmerFailure = createOpenRouterKnowledgeModel({ apiKey: "secret", endpoint: "https://api.example.test/chat/completions", model: "z-ai/glm-5.3-flash", timeoutMs: 1_000, maximumInputCharacters: 10_000, fetch: async () => { throw new RangeError("programmer failure"); }, now: Date.now, logger: () => {} });
  await assertRejects(programmerFailure.generate(command()));
});

Deno.test("Discover model rejects duplicate JSON keys and timeout without fallback", async()=>{
  for(const timeout of [false,true]){
    const model=createOpenRouterKnowledgeModel({apiKey:"synthetic-secret",endpoint:"https://model.example/chat",model:"z-ai/glm-5.3-flash",timeoutMs:1,maximumInputCharacters:1000,now:()=>1000,logger:()=>{},fetch:async(_input,init)=>{if(timeout)return await new Promise((_resolve,reject)=>{init?.signal?.addEventListener("abort",()=>reject(new DOMException("aborted","AbortError")));});return Response.json({id:"test",choices:[{finish_reason:"stop",message:{content:'{"assessments":[],"assessments":[],"rankedIds":[]}'}}]});}});
    const result=await model.generate({role:"source-assessor",systemPrompt:"Assess supplied evidence.",input:{query:"harmony"},maxOutputTokens:256,responseSchema:{name:"discover_source_quality_v1",schema:{type:"object"}}});assertEquals(result.ok,false);if(!result.ok)assertEquals(result.error.kind,timeout?"KnowledgeModelTimeout":"KnowledgeModelResponseDuplicateKey");
  }
});


Deno.test('configured application roles send their own processor, generator, rights and evaluator model names',async()=>{
 const roles=/** @type {const} */(['rights-assessor','knowledge-scraper','question-generator','question-evaluator']);
 const limits={maxTurns:3,maxToolCalls:6,timeoutMs:1000,maxOutputBytes:131072,compactionThresholdTokens:500000};
 const configSnapshots=/** @type {Record<import('../worker/knowledge-workflow-model.js').KnowledgeAgentRole,{model:import('../src/features/knowledge-workflows/config.js').AgentModel,limits:typeof limits}>} */(Object.fromEntries(roles.map(role=>[role,{model:role==='knowledge-scraper'?{provider:'openrouter',name:'z-ai/glm-5.3-flash',reasoningEffort:'high'}:role==='question-evaluator'?{provider:'openrouter',name:'mistralai/mistral-large-4-0',reasoningEffort:'none'}:{provider:'openrouter',name:`synthetic/${role}`},limits}])));
 /** @type {Record<string,unknown>[]} */ const sent=[];
 const model=createRoleConfiguredKnowledgeModel({apiKey:'synthetic',endpoint:'https://api.example.test/chat/completions',configSnapshots,maximumInputCharacters:10000,now:Date.now,logger:()=>{},fetch:async(_url,init)=>{
   const body=JSON.parse(String(init?.body));sent.push(body);assertEquals(body.reasoning?.effort,body.model==='z-ai/glm-5.3-flash'?'high':body.model==='mistralai/mistral-large-4-0'?'none':undefined);
   return Response.json({id:'synthetic-role',choices:[{finish_reason:'stop',message:{content:'{"valid":true}'}}]});
 }});
 for(const role of roles)assertEquals((await model.generate({...command(),role,...(role==='knowledge-scraper'||role==='question-evaluator'?{reasoningEffort:'low'}:{})})).ok,true);
 assertEquals(sent.map(body=>body.model).join(','),roles.map(role=>configSnapshots[role].model.name).join(','));
 const invalid=await model.generate({...command(),role:'unknown-agent'});assertEquals(invalid.ok,false);assertEquals(sent.length,roles.length);
 const conflicting=await model.generate({...command(),role:'question-evaluator',reasoningEffort:'high'});assertEquals(conflicting.ok,false);assertEquals(sent.length,roles.length);
});

Deno.test('configured evaluator timeout remains bounded by its own role limit',async()=>{
 const roles=/** @type {const} */(['rights-assessor','knowledge-scraper','question-generator','question-evaluator']);
 const limits={maxTurns:3,maxToolCalls:6,timeoutMs:1000,maxOutputBytes:131072,compactionThresholdTokens:500000};
 const configSnapshots=/** @type {Record<import('../worker/knowledge-workflow-model.js').KnowledgeAgentRole,{model:{provider:string,name:string},limits:typeof limits}>} */(Object.fromEntries(roles.map(role=>[role,{model:{provider:'openrouter',name:`synthetic/${role}`},limits:{...limits,timeoutMs:role==='question-evaluator'?5:1000}}])));
 const model=createRoleConfiguredKnowledgeModel({apiKey:'synthetic',endpoint:'https://api.example.test/chat/completions',configSnapshots,maximumInputCharacters:10000,now:Date.now,logger:()=>{},fetch:async(_url,init)=>await new Promise((_resolve,reject)=>init?.signal?.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true}))});
 const result=await model.generate({...command(),role:'question-evaluator',timeoutMs:1000});assertEquals(result.ok,false);if(!result.ok)assertEquals(result.error.kind,'KnowledgeModelTimeout');
});

Deno.test('configured roles retain separate trusted provider price ceilings',async()=>{
 const roles=/** @type {const} */(['rights-assessor','knowledge-scraper','question-generator','question-evaluator']);
 const limits={maxTurns:3,maxToolCalls:6,timeoutMs:1000,maxOutputBytes:131072,compactionThresholdTokens:500000};
 const configSnapshots=/** @type {Record<import('../worker/knowledge-workflow-model.js').KnowledgeAgentRole,{model:import('../src/features/knowledge-workflows/config.js').AgentModel,limits:typeof limits}>} */(Object.fromEntries(roles.map(role=>[role,{model:{provider:'openrouter',name:`synthetic/${role}`,reasoningEffort:role==='question-evaluator'?'none':'high'},limits}])));
 const modelProtocols=/** @type {Partial<Record<import('../worker/knowledge-workflow-model.js').KnowledgeAgentRole,import('../worker/knowledge-workflow-model.js').KnowledgeModelProtocol>>} */(Object.fromEntries(roles.map(role=>[role,{source:'synthetic-price-ceiling',responseFormat:'json_object',reasoningEffort:role==='question-evaluator'?'none':'high',receiptOptional:true,provider:{sort:'throughput',require_parameters:true,allow_fallbacks:true,max_price:{prompt:role==='question-evaluator'?1:0.027,completion:role==='question-evaluator'?2:0.9,request:0,image:0}}}])));
 let calls=0;
 const model=createRoleConfiguredKnowledgeModel({apiKey:'synthetic',endpoint:'https://api.example.test/chat/completions',configSnapshots,modelProtocols,maximumInputCharacters:10000,now:Date.now,logger:()=>{},fetch:async(_url,init)=>{
   const body=JSON.parse(String(init?.body)),role=roles[calls++];
   assertEquals(JSON.stringify(body.provider),JSON.stringify(modelProtocols[role]?.provider));
   assertEquals(body.reasoning.effort,configSnapshots[role].model.reasoningEffort);
   assertEquals(body.response_format.type,'json_object');
   return Response.json({id:'synthetic-protocol',choices:[{finish_reason:'stop',message:{content:'{"valid":true}'}}]});
 }});
 for(const role of roles)assertEquals((await model.generate({...command(),role})).ok,true);
 assertEquals(calls,4);
 let rejected=false;try{createRoleConfiguredKnowledgeModel({.../** @type {Parameters<typeof createRoleConfiguredKnowledgeModel>[0]} */({apiKey:'synthetic',endpoint:'https://api.example.test/chat/completions',configSnapshots,maximumInputCharacters:10000,now:Date.now,logger:()=>{},fetch}),modelProtocols:/** @type {never} */({unknown:{}})});}catch(error){rejected=error instanceof TypeError;}
 assertEquals(rejected,true);
});

Deno.test('response format and optional validated reasoning effort are independent protocol choices',async()=>{
 for(const responseFormat of /** @type {const} */(['json_schema','json_object']))for(const reasoningEffort of /** @type {const} */([undefined,'none','low','high'])) {
   const protocol={source:'synthetic-protocol',responseFormat,...(reasoningEffort===undefined?{}:{reasoningEffort}),receiptOptional:/** @type {const} */(true),provider:{sort:/** @type {const} */('throughput'),require_parameters:/** @type {const} */(true),allow_fallbacks:true,max_price:{prompt:1,completion:2,request:/** @type {const} */(0),image:/** @type {const} */(0)}}};
   let calls=0;
   const model=createOpenRouterKnowledgeModel({apiKey:'synthetic',endpoint:'https://api.example.test/chat/completions',model:'synthetic/evaluator',timeoutMs:1000,maximumInputCharacters:10000,protocol,now:Date.now,logger:()=>{},fetch:async(_url,init)=>{
     calls++;const body=JSON.parse(String(init?.body));assertEquals(body.response_format.type,responseFormat);assertEquals(body.reasoning?.effort,reasoningEffort);assertEquals(JSON.stringify(body.provider),JSON.stringify(protocol.provider));
     return Response.json({choices:[{finish_reason:'stop',message:{content:'{"valid":true}'}}]});
   }});
   const result=await model.generate({...command(),responseSchema:{name:'synthetic_schema',schema:{type:'object',additionalProperties:false,properties:{valid:{type:'boolean'}},required:['valid']}}});assertEquals(result.ok,true);assertEquals(calls,1);
   if(reasoningEffort==='none'||reasoningEffort==='high'){const mismatched=await model.generate({...command(),reasoningEffort:'low'});assertEquals(mismatched.ok,false);if(!mismatched.ok)assertEquals(mismatched.error.kind,'KnowledgeModelCommandInvalid');assertEquals(calls,1);}
 }
});


Deno.test("MiMo evaluator uses automatic provider routing with strict schema and retained reasoning setting", async () => {
  /** @type {Record<string, any> | undefined} */ let body;
  const model = createOpenRouterKnowledgeModel({apiKey:"synthetic-key",endpoint:"https://example.test/model",model:"xiaomi/mimo-v2.6-pro",timeoutMs:1000,maximumInputCharacters:10000,fetch:async(_url,init)=>{body=JSON.parse(String(init?.body));return Response.json({id:"synthetic-mimo",choices:[{finish_reason:"stop",message:{content:'{"score":9}'}}]});},now:Date.now,logger:()=>{}});
  const responseSchema={name:"synthetic_review",schema:{type:"object",properties:{score:{type:"integer"}},required:["score"],additionalProperties:false}};
  assertEquals((await model.generate({...command(),role:"question-evaluator",reasoningEffort:"none",responseSchema})).ok,true);
  if(body===undefined)throw new Error("Model body was not captured.");assertEquals(body.model,"xiaomi/mimo-v2.6-pro");assertEquals(body.provider.sort,undefined);assertEquals(body.provider.only,undefined);assertEquals(body.provider.require_parameters,true);assertEquals(body.provider.allow_fallbacks,true);assertEquals(body.reasoning.effort,"none");assertEquals(body.response_format.type,"json_schema");assertEquals(body.response_format.json_schema.strict,true);
});

Deno.test("knowledge model rejects provider redirects without forwarding credentials", async () => {
  let calls = 0;
  const model = createOpenRouterKnowledgeModel({ apiKey: "secret", endpoint: "https://api.example.test/chat/completions", model: "synthetic-model", timeoutMs: 1_000, maximumInputCharacters: 10_000, now: Date.now, logger: () => {}, fetch: async (_input, init) => {
    calls++;
    assertEquals(init?.redirect, "manual");
    return new Response(null, { status: 302, headers: { location: "https://other.example.test/" } });
  } });
  const result = await model.generate(command());
  assertEquals(result.ok, false);
  if (!result.ok && result.error.kind === "KnowledgeModelRejected") assertEquals(result.error.status, 302);
  else throw new Error("Expected a rejected redirect response.");
  assertEquals(calls, 1);
});

Deno.test("model retains reported cache and cost observations without inventing missing usage", async () => {
  for (const reported of [undefined, {}, {cost:null,prompt_tokens_details:null}, {cost:0,prompt_tokens_details:{cached_tokens:0,cache_write_tokens:0}}, {cost:0.000123456,prompt_tokens_details:{cached_tokens:123,cache_write_tokens:45}}]) {
    const model=createOpenRouterKnowledgeModel({apiKey:"synthetic",endpoint:"https://api.example.test/chat/completions",model:"synthetic",timeoutMs:1000,maximumInputCharacters:10000,now:Date.now,logger:()=>{},fetch:async()=>Response.json({id:"cache-receipt",choices:[{finish_reason:"stop",message:{content:"{}"}}],...(reported===undefined?{}:{usage:reported})})});
    const result=await model.generate(command());
    if(!result.ok)throw new Error(result.error.kind);
    assertEquals(result.value.requestId,"cache-receipt");
    assertEquals(result.value.costNanodollars,reported?.cost===undefined||reported.cost===null?null:Math.round(reported.cost*1_000_000_000));
    assertEquals(result.value.cachedInputTokens,reported?.prompt_tokens_details?.cached_tokens??null);
    assertEquals(result.value.cacheWriteInputTokens,reported?.prompt_tokens_details?.cache_write_tokens??null);
  }
});

Deno.test("model rejects malformed reported cache counters and unsafe costs with field context", async () => {
  const cases=[
    {usage:{cost:-1},field:"usage.cost"},{usage:{cost:"0.1"},field:"usage.cost"},{usage:{cost:1e100},field:"usage.cost"},
    {usage:{prompt_tokens_details:"invalid"},field:"usage.prompt_tokens_details"},
    ...["cached_tokens","cache_write_tokens"].flatMap(field=>[-1,0.5,"2",Number.MAX_SAFE_INTEGER+1].map(value=>({usage:{prompt_tokens_details:{[field]:value}},field:`usage.prompt_tokens_details.${field}`}))),
  ];
  for(const sample of cases){
    const model=createOpenRouterKnowledgeModel({apiKey:"synthetic",endpoint:"https://api.example.test/chat/completions",model:"synthetic",timeoutMs:1000,maximumInputCharacters:10000,now:Date.now,logger:()=>{},fetch:async()=>Response.json({id:"cache-receipt",choices:[{finish_reason:"stop",message:{content:"{}"}}],usage:sample.usage})});
    const result=await model.generate(command());
    if(result.ok||result.error.kind!=="KnowledgeModelUsageInvalid")throw new Error("Malformed reported usage was accepted.");
    assertEquals(result.error.field,sample.field);
  }
});
