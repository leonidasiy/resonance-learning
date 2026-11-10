// @ts-check

import { createRightsAssessor } from "../src/features/knowledge-workflows/rights.js";
import { createRobotsGate } from "../src/features/knowledge-workflows/robots.js";
import { isWorkflowRobotsEvidence } from '../src/features/knowledge-workflows/workflow.js';

/** @template T @param {T} actual @param {T} expected */
function assertEquals(actual, expected) { if (!Object.is(actual, expected)) throw new Error(`Expected ${String(expected)}, received ${String(actual)}.`); }

const capabilities = ["copyright", "licence", "terms", "access", "storage", "display", "transformation", "attribution", "origin"];
/** @type {(hostname: string) => Promise<{ readonly ok: true, readonly value: readonly string[] }>} */
const publicResolver = async (_hostname) => ({ ok: true, value: ["93.184.216.34"] });

Deno.test('unverified robots permits public targets for fetch errors, unavailable statuses, malformed and oversized files', async () => {
  const cases = [
    {fetch:async()=>{throw new TypeError('Network unavailable');},status:0},
    {fetch:async()=>new Response('Unavailable',{status:503}),status:503},
    {fetch:async()=>new Response('Rate limit',{status:429}),status:429},
    {fetch:async()=>new Response('Disallow: /no-agent',{status:200}),status:200},
    {fetch:async()=>new Response('User-agent: *',{status:200}),maximumBytes:4,status:200},
    {fetch:async()=>new Response(null,{status:500}),fetchRobots:async()=>/** @type {const} */({ok:false,error:{kind:'KnowledgeRobotsFetchUnavailable'}}),status:0},
  ];
  for (const test of cases) {
    let targets=0;
    const gate=createRobotsGate({...test,robotsUnavailablePolicy:'allow-unverified-if-public',verifyTargetReachable:async()=>{targets++;return {ok:true,value:null};},resolveAddresses:publicResolver,now:()=> '2026-10-13T00:00:00.000Z',logger:()=>{}});
    const result=await gate.check({rights:rights()});
    assertEquals(result.ok,true);
    if (!result.ok) continue;
    assertEquals(result.value.httpStatus,test.status);
    assertEquals(result.value.availability,'unavailable');
    assertEquals(isWorkflowRobotsEvidence(result.value),true);
    // Resumption must reverify each target; an unavailable policy is never cached as allowed directives.
    const resumed=createRobotsGate({fetch:async()=>{throw new Error('Unexpected fetch');},cachedEvidence:result.value,robotsUnavailablePolicy:'allow-unverified-if-public',verifyTargetReachable:async()=>{targets++;return {ok:false,error:{kind:'WebpageAccessBlocked'}};},resolveAddresses:publicResolver,now:()=> '2026-10-13T00:00:00.000Z',logger:()=>{}});
    const blocked=await resumed.check({rights:rights(),targetUrl:'https://example.test/lesson/blocked'});
    assertEquals(blocked.ok,false);
    if (!blocked.ok && blocked.error.kind==='RobotsTargetUnavailable') assertEquals(blocked.error.causeKind,'WebpageAccessBlocked');
    assertEquals(targets,2);
  }
});

Deno.test('unverified policy retains explicit robots denials and destination safety',async()=>{
  let verified=0;
  const gate=createRobotsGate({fetch:async()=>new Response('User-agent: *\nDisallow: /lesson'),robotsUnavailablePolicy:'allow-unverified-if-public',verifyTargetReachable:async()=>{verified++;return {ok:true,value:null};},resolveAddresses:publicResolver,now:()=> '2026-10-13T00:00:00.000Z',logger:()=>{}});
  const denied=await gate.check({rights:rights()});
  assertEquals(denied.ok,false);
  if (!denied.ok) assertEquals(denied.error.kind,'RobotsDenied');
  const foreign=await gate.check({rights:rights(),targetUrl:'https://foreign.test/lesson'});
  assertEquals(foreign.ok,false);
  if (!foreign.ok) assertEquals(foreign.error.kind,'UnsafeDestination');
  assertEquals(verified,0);
  const mixed=createRobotsGate({fetch:async()=>new Response('User-agent: *\nDisallow: /lesson\nMalformed line'),robotsUnavailablePolicy:'allow-unverified-if-public',verifyTargetReachable:async()=>{verified++;return {ok:true,value:null};},resolveAddresses:publicResolver,now:()=> '2026-10-13T00:00:00.000Z',logger:()=>{}});
  const mixedResult=await mixed.check({rights:rights()});
  assertEquals(mixedResult.ok,false);
  if (!mixedResult.ok) assertEquals(mixedResult.error.kind,'RobotsDenied');
  assertEquals(verified,0);
});
Deno.test('malformed robots preserves explicit denials across public checks and persisted resumption',async()=>{
  const body='User-agent: *\nDisallow: /restricted\nMalformed line';
  let verified=0;
  const dependencies={fetch:async()=>new Response(body),robotsUnavailablePolicy:/** @type {const} */('allow-unverified-if-public'),verifyTargetReachable:async()=>{verified++;return /** @type {const} */({ok:true,value:null});},resolveAddresses:publicResolver,now:()=> '2026-10-13T00:00:00.000Z',logger:()=>{}};
  const gate=createRobotsGate(dependencies);
  const publicResult=await gate.check({rights:rights(),targetUrl:'https://example.test/public'});
  assertEquals(publicResult.ok,true);
  if(!publicResult.ok)throw new Error('Expected public verification.');
  assertEquals(publicResult.value.content,body);
  assertEquals(publicResult.value.availability,'unavailable');
  assertEquals(isWorkflowRobotsEvidence(publicResult.value),true);
  const resumed=createRobotsGate({...dependencies,fetch:async()=>{throw new Error('Unexpected fetch');},cachedEvidence:publicResult.value});
  for(const instance of [gate,resumed]) {
    const restricted=await instance.check({rights:rights(),targetUrl:'https://example.test/restricted/lesson'});
    assertEquals(restricted.ok,false);
    if(!restricted.ok)assertEquals(restricted.error.kind,'RobotsDenied');
  }
  assertEquals(verified,1);
});

function rights() {
  const assessor = createRightsAssessor({ now: () => "2026-08-13T12:00:00.000Z", logger: () => {} });
  const result = assessor.assess({ ownerId: "owner-a", sourceId: "source-a", sourceRevision: 1, canonicalUrl: "https://example.test/lesson", origin: "https://example.test", access: "public", requestedAt: "2026-08-13T00:00:00.000Z", evidence: capabilities.map((capability) => ({ capability, outcome: "allowed", reference: `https://example.test/evidence/${capability}`, observedAt: "2026-08-13T00:00:00.000Z", expiresAt: "2026-08-14T00:00:00.000Z" })) });
  if (!result.ok) throw new Error("Expected rights decision.");
  return result.value;
}

Deno.test("robots is checked only after allowed rights and denies matching paths", async () => {
  let calls = 0;
  const gate = createRobotsGate({ fetch: async (_url,init) => { assertEquals(init?.redirect,"manual"); calls += 1; return new Response("User-agent: *\nDisallow: /private\nAllow: /private/public\n", { status: 200 }); }, resolveAddresses: publicResolver, now: () => "2026-08-13T12:00:00.000Z", logger: () => {} });
  const denied = await gate.check({ rights: { ...rights(), canonicalUrl: "https://example.test/private/lesson" }, userAgent: "knowledge-platform" });
  assertEquals(denied.ok, false);
  if (!denied.ok) assertEquals(denied.error.kind, "RobotsDenied");
  assertEquals(calls, 1);
  const blockedBeforeRights = await gate.check({ rights: { ...rights(), status: "awaiting-review" }, userAgent: "knowledge-platform" });
  assertEquals(blockedBeforeRights.ok, false);
  if (!blockedBeforeRights.ok) assertEquals(blockedBeforeRights.error.kind, "RobotsCheckBeforeRightsForbidden");
  assertEquals(calls, 1);
});

Deno.test("robots evaluates the requested nested path and treats an explicit 404 as no directives", async () => {
  const nested = createRobotsGate({ fetch: async () => new Response("User-agent: *\nDisallow: /private\nAllow: /private/public\n", { status: 200 }), resolveAddresses: publicResolver, now: () => "2026-08-13T12:00:00.000Z", logger: () => {} });
  const allowed = await nested.check({ rights: { ...rights(), canonicalUrl: "https://example.test/learn" }, targetUrl: "https://example.test/learn/chapter" });
  assertEquals(allowed.ok, true);
  if (allowed.ok) {
    assertEquals(allowed.value.targetUrl, "https://example.test/learn/chapter");
    assertEquals(allowed.value.availability, "present");
  }
  const denied = await nested.check({ rights: { ...rights(), canonicalUrl: "https://example.test/learn" }, targetUrl: "https://example.test/private/lesson" });
  assertEquals(denied.ok, false);
  if (!denied.ok) assertEquals(denied.error.kind, "RobotsDenied");

  const absent = createRobotsGate({ fetch: async () => new Response("", { status: 404 }), resolveAddresses: publicResolver, now: () => "2026-08-13T12:00:00.000Z", logger: () => {} });
  const absentResult = await absent.check({ rights: rights() });
  assertEquals(absentResult.ok, true);
  if (absentResult.ok) {
    assertEquals(absentResult.value.availability, "absent");
    assertEquals(absentResult.value.httpStatus, 404);
    assertEquals(absentResult.value.content, "");
  }
});

Deno.test("robots reuses the persisted bounded policy document across extraction chunks", async () => {
  let fetchCalls = 0;
  let resolverCalls = 0;
  /** @type {Record<string, unknown>[]} */ const logs = [];
  const gate = createRobotsGate({
    cachedEvidence: {
      robotsUrl: "https://example.test/robots.txt",
      targetUrl: "https://example.test/learn",
      httpStatus: 200,
      availability: "present",
      content: "User-agent: *\nDisallow: /private\nAllow: /private/public\n",
      checkedAt: "2026-08-13T12:00:00.000Z",
      matchedRule: null,
    },
    fetch: async () => { fetchCalls += 1; return new Response("unexpected network access", { status: 500 }); },
    resolveAddresses: async () => { resolverCalls += 1; return { ok: false, error: { kind: "unexpected-dns-access" } }; },
    now: () => "2026-08-13T12:01:00.000Z",
    logger: (entry) => logs.push(entry),
  });
  const allowed = await gate.check({ rights: { ...rights(), canonicalUrl: "https://example.test/learn" }, targetUrl: "https://example.test/learn/chapter" });
  assertEquals(allowed.ok, true);
  const denied = await gate.check({ rights: { ...rights(), canonicalUrl: "https://example.test/learn" }, targetUrl: "https://example.test/private/lesson" });
  assertEquals(denied.ok, false);
  if (!denied.ok) assertEquals(denied.error.kind, "RobotsDenied");
  assertEquals(fetchCalls, 0);
  assertEquals(resolverCalls, 0);
  assertEquals(logs.some((entry) => entry.event === "robots-check-cache-hit"), true);
});

Deno.test("robots retries an unavailable persisted result and applies recovered directives", async () => {
  let fetchCalls = 0;
  let resolverCalls = 0;
  /** @type {string[]} */ const targets = [];
  const gate = createRobotsGate({
    cachedEvidence: {
      robotsUrl: "https://example.test/robots.txt",
      targetUrl: "https://example.test/learn",
      httpStatus: 403,
      availability: "unavailable",
      content: "",
      checkedAt: "2026-08-13T12:00:00.000Z",
      matchedRule: null,
    },
    fetch: async () => { throw new Error("Unexpected native fetch"); },
    fetchRobots: async () => { fetchCalls += 1; return { ok: true, value: { status: 200, bytes: new TextEncoder().encode("User-agent: *\nDisallow: /private\n") } }; },
    resolveAddresses: async () => { resolverCalls += 1; return { ok: true, value: ["93.184.216.34"] }; },
    verifyTargetReachable: async ({ targetUrl }) => { targets.push(targetUrl); return { ok: true, value: null }; },
    robotsUnavailablePolicy: "allow-403-if-target-reachable",
    now: () => "2026-08-13T12:01:00.000Z",
    logger: () => {},
  });
  const result = await gate.check({ rights: { ...rights(), canonicalUrl: "https://example.test/learn" }, targetUrl: "https://example.test/private/chapter" });
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error.kind, "RobotsDenied");
  assertEquals(fetchCalls, 1);
  assertEquals(resolverCalls, 1);
  assertEquals(targets.length, 0);
});

Deno.test("robots allows a successful empty file as no directives", async () => {
  const gate = createRobotsGate({ fetch: async () => new Response("", { status: 200 }), resolveAddresses: publicResolver, now: () => "2026-08-13T12:00:00.000Z", logger: () => {} });
  const result = await gate.check({ rights: rights() });
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.value.availability, "present");
    assertEquals(result.value.httpStatus, 200);
    assertEquals(result.value.content, "");
  }
});

Deno.test("robots remains fail-closed for a 403 unless reachability policy is explicitly enabled", async () => {
  const gate = createRobotsGate({ fetch: async () => new Response("origin refused robots access", { status: 403 }), resolveAddresses: publicResolver, now: () => "2026-08-13T12:00:00.000Z", logger: () => {} });
  const result = await gate.check({ rights: rights() });
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error.kind, "RobotsFetchUnavailable");
});

Deno.test("robots preserves the bounded browser/native fetch cause", async () => {
  const gate = createRobotsGate({
    fetch: async () => new Response(null, { status: 500 }),
    fetchRobots: async () => ({ ok: false, error: { kind: "KnowledgeRobotsNativeFetchFailed", diagnosticToken: "native-fetch-failed" } }),
    resolveAddresses: publicResolver,
    now: () => "2026-08-13T12:00:00.000Z",
    logger: () => {},
  });
  const result = await gate.check({ rights: rights() });
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.error.kind, "RobotsFetchUnavailable");
    if (result.error.kind === "RobotsFetchUnavailable") assertEquals(result.error.causeKind, "KnowledgeRobotsNativeFetchFailed");
    if (result.error.kind === "RobotsFetchUnavailable") assertEquals(result.error.diagnosticToken, "native-fetch-failed");
  }
});

Deno.test("robots unavailable policy requires a target reachability verifier", () => {
  let threw = false;
  try {
    createRobotsGate({ fetch: fetch, robotsUnavailablePolicy: "allow-403-if-target-reachable", resolveAddresses: publicResolver, now: () => "2026-08-13T12:00:00.000Z", logger: () => {} });
  } catch (error) {
    threw = error instanceof TypeError;
  }
  assertEquals(threw, true);
});

Deno.test("robots rejects malformed and over-limit responses", async () => {
  const malformed = createRobotsGate({ fetch: async () => new Response("Disallow: /without-agent", { status: 200 }), resolveAddresses: publicResolver, now: () => "2026-08-13T12:00:00.000Z", logger: () => {} });
  const malformedResult = await malformed.check({ rights: rights() });
  assertEquals(malformedResult.ok, false);
  if (!malformedResult.ok) assertEquals(malformedResult.error.kind, "RobotsMalformed");
  const oversized = createRobotsGate({ maximumBytes: 4, fetch: async () => new Response("User-agent: *", { status: 200 }), resolveAddresses: publicResolver, now: () => "2026-08-13T12:00:00.000Z", logger: () => {} });
  const oversizedResult = await oversized.check({ rights: rights() });
  assertEquals(oversizedResult.ok, false);
  if (!oversizedResult.ok) assertEquals(oversizedResult.error.kind, "RobotsPayloadTooLarge");
});

Deno.test("robots rejects destinations that fail the DNS safety policy before fetching", async () => {
  let calls = 0;
  const gate = createRobotsGate({ fetch: async () => { calls += 1; return new Response("User-agent: *", { status: 200 }); }, resolveAddresses: async (_hostname) => ({ ok: true, value: [] }), now: () => "2026-08-13T12:00:00.000Z", logger: () => {} });
  const result = await gate.check({ rights: rights() });
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error.kind, "RobotsNetworkRejected");
  assertEquals(calls, 0);
});
