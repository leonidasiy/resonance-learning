// @ts-check

import { countProcessingWorkflowStatuses, SourceLibraryGatewayClient } from "../src/features/source-library/gateway.js";

/** @template T @param {T} actual @param {T} expected */
function assertEquals(actual, expected) {
  if (!Object.is(actual, expected)) {
    throw new Error(
      `Expected ${String(expected)}, received ${String(actual)}.`,
    );
  }
}

const source = Object.freeze({
  id: "source-a",
  ownerId: "owner-a",
  submittedUrl: "https://publisher.example/learn",
  canonicalUrl: "https://publisher.example/learn",
  title: "Music learning source",
  description: "A source already approved for the Library.",
  adapter: Object.freeze({
    id: "adapter-a",
    version: "1",
    granularity: "root",
    capabilities: Object.freeze(["metadata"]),
  }),
  interestAreaIds: Object.freeze(["area-a"]),
  identityEvidence: Object.freeze([]),
  state: "active",
  approvedAt: "2026-07-22T08:00:00.000Z",
  updatedAt: "2026-07-22T08:00:00.000Z",
  revision: 1,
});

Deno.test("source gateway preserves empty descriptions through catalog and search", async () => {
  const empty = { ...source, description: "" };
  const browse = await gateway(async () => Response.json({ ownerId: "owner-a", result: { items: [empty], interestAreas: [], nextCursor: null } })).browse({ limit: 20 });
  if (!browse.ok) throw new Error(browse.error.kind);
  assertEquals(browse.value.items[0].description, "");
  const search = await gateway(async () => Response.json({ result: [{ source: empty, score: 1 }] })).search({ query: "music", limit: 20 });
  if (!search.ok) throw new Error(search.error.kind);
  assertEquals(search.value[0].source.description, "");
});

Deno.test("source gateway retains saved classifications and rejects malformed classifications", async () => {
  for (const primarySubject of [undefined, null, "music", "invented", 42]) {
    const result = await gateway(async () => Response.json({ ownerId: "owner-a", result: { items: [{ ...source, primarySubject }], interestAreas: [], nextCursor: null } })).browse({ limit: 20 });
    assertEquals(result.ok, primarySubject == null || primarySubject === "music");
    if (result.ok) assertEquals(result.value.items[0].primarySubject, primarySubject);
  }
});

Deno.test("source gateway rejects malformed descriptions and catalog owner mismatches", async () => {
  for (const description of [undefined, null, 42, {}, []]) {
    const result = await gateway(async () => Response.json({ result: { items: [{ ...source, description }], interestAreas: [], nextCursor: null } })).browse({ limit: 20 });
    if (result.ok || result.error.kind !== "SourceGatewayResponseInvalid") throw new Error("Malformed description accepted.");
  }
  const result = await gateway(async () => Response.json({ ownerId: "owner-b", result: { items: [{ ...source, description: "" }], interestAreas: [], nextCursor: null } })).browse({ limit: 20 });
  if (result.ok || result.error.kind !== "SourceGatewayResponseInvalid") throw new Error("Catalog owner mismatch accepted.");
});

Deno.test("source gateway excludes expired extraction runs but keeps work before the deadline", () => {
  /** @param {number} remainingMs */
  const run = (remainingMs) => ({
    runId: `run-${remainingMs}`,
    state: "extraction-loop",
    revision: 1,
    counts: { pages: 0, knowledgePoints: 0, acceptedQuizzes: 0, pendingQuizzes: 0 },
    extractionStartedAt: "2026-08-13T00:00:00.000Z",
    extractionDeadlineAt: "2026-08-13T00:30:00.000Z",
    elapsedMs: 1_800_000 - remainingMs,
    remainingMs,
    decisionRequired: null,
    failureKind: null,
    robotsEvidence: null,
  });
  assertEquals(countProcessingWorkflowStatuses([
    { sourceId: "source-expired", run: run(0), reasonCode: null, message: null },
    { sourceId: "source-boundary", run: run(1), reasonCode: null, message: null },
    { sourceId: "source-quizzes", run: { ...run(0), state: "per-point-quiz-loop" }, reasonCode: null, message: null },
    { sourceId: "source-chunk", run: { ...run(1), state: "awaiting-time-limit-decision" }, reasonCode: null, message: null },
    { sourceId: "source-decision", run: { ...run(0), state: "awaiting-time-limit-decision", decisionRequired:"time-limit" }, reasonCode: null, message: null },
  ]), 3);
});

/** @param {(request: Request) => Promise<Response>} respond */
function gateway(respond) {
  return new SourceLibraryGatewayClient({
    fetch: (input, init) => respond(new Request(input, init)),
    baseUrl: "https://app.example/",
    timeoutMs: 100,
  });
}

Deno.test("source gateway invokes injected fetch without rebinding its receiver", async () => {
  let requests = 0;
  const receiverSensitiveFetch = /** @type {typeof fetch} */ (
    /** @this {undefined} */ function (input, init) {
      if (this !== undefined) {
        return Promise.reject(new TypeError("Fetch receiver changed."));
      }
      requests += 1;
      const request = new Request(input, init);
      if (request.method === "POST") {
        return Promise.resolve(Response.json({
          result: { source, reused: false }, workflow: {runId:"run-a",reused:false},
        }));
      }
      return Promise.resolve(Response.json({
        result: {
          items: [],
          interestAreas: [{
            id: "area-a",
            ownerId: "owner-a",
            title: "Music",
            provenance: "configured",
          }],
          nextCursor: null,
        },
      }));
    }
  );
  const client = new SourceLibraryGatewayClient({
    fetch: receiverSensitiveFetch,
    baseUrl: "https://app.example/",
    timeoutMs: 100,
  });

  const browse = await client.browse({ limit: 20 });
  assertEquals(browse.ok, true);
  if (!browse.ok) throw new Error(browse.error.kind);
  assertEquals(browse.value.interestAreas[0].title, "Music");

  const approved = await client.extract({
    submittedUrl: source.submittedUrl,
    canonicalUrl: source.canonicalUrl,
    title: source.title,
    description: source.description,
    adapter: source.adapter,
    interestAreaIds: source.interestAreaIds,
    identityEvidence: source.identityEvidence,
    identityStatus: "resolved",
    idempotencyKey: "approve-a",
  });
  assertEquals(approved.ok, true);
  assertEquals(requests, 2);
});

Deno.test("source gateway returns the workflow run from extraction and uploads pasted material as JSON", async () => {
  /** @type {Request | null} */ let received = null;
  const client = gateway(async (request) => {
    received = request;
    if (request.url.endsWith("/extract")) return Response.json({ result: { source, reused: false }, workflow: { runId: "run-a", reused: false } });
    return Response.json({ result: { status: "attached", materialId: "material-a", runId: "run-a", reused: false } });
  });
  const approved = await client.extract({ submittedUrl: source.submittedUrl, canonicalUrl: source.canonicalUrl, title: source.title, description: source.description, adapter: source.adapter, interestAreaIds: source.interestAreaIds, identityEvidence: source.identityEvidence, identityStatus: "resolved", idempotencyKey: "approve-workflow" });
  assertEquals(approved.ok, true);
  if (!approved.ok) throw new Error(approved.error.kind);
  assertEquals(approved.value.workflow?.runId, "run-a");
  const uploaded = await client.uploadWorkflowMaterial({ runId: "run-a", sourceId: source.id, sourceRevision: 1, sourceUrl: source.canonicalUrl, mediaType: "text/plain", fileName: "pasted-text.txt", idempotencyKey: "material-a", content: "A pasted concept.", rightsAttestation: { ownsOrPermitted: true, storageAllowed: true, transformationAllowed: true, processingAllowed: true, basis: "learner copy", reference: "attestation-a" } });
  assertEquals(uploaded.ok, true);
  const receivedRequest = /** @type {Request} */ (/** @type {unknown} */ (received));
  assertEquals(receivedRequest.headers.get("content-type"), "application/json");
  const body = /** @type {Record<string, unknown>} */ (await receivedRequest.json());
  assertEquals(body.ownerId, undefined);
  assertEquals(body.content, "A pasted concept.");
  assertEquals(body.mode, "text");
});

Deno.test("private document creation rejects owner injection and validates an attach-ready response", async () => {
  let calls = 0;
  const documentSource = { ...source, origin: "private-document", canonicalUrl: "https://app.example/api/private-documents/source-a", submittedUrl: "https://app.example/api/private-documents/source-a" };
  const client = gateway(async (request) => {
    calls += 1;
    assertEquals(new URL(request.url).pathname, "/api/source-library/private-documents");
    assertEquals(request.method, "POST");
    const body = await request.json();
    assertEquals(body.ownerId, undefined);
    return Response.json({ result: { source: documentSource, runId: "private-run", reused: false } });
  });
  const command = { title: "Lecture", fileName: "lecture.pdf", idempotencyKey: "create-doc", rightsAttestation: { ownsOrPermitted: true, storageAllowed: true, transformationAllowed: true, processingAllowed: true, basis: "permission", reference: "attestation" } };
  assertEquals((await client.createPrivateDocument({ ...command, ownerId: "other" })).ok, false);
  assertEquals(calls, 0);
  const result = await client.createPrivateDocument(command);
  if (!result.ok) throw new Error(result.error.kind);
  assertEquals(result.value.runId, "private-run");
  assertEquals(result.value.source.canonicalUrl, documentSource.canonicalUrl);
  const malformed = await gateway(async () => Response.json({ result: { source, reused: false } })).createPrivateDocument(command);
  assertEquals(malformed.ok, false);
});

Deno.test("private document identities survive local and private phone origins without accepting foreign sources", async () => {
  for (const baseUrl of ["http://127.0.0.1:8787/", "https://my-computer.example.ts.net/"]) {
    for (const [canonicalUrl, expected] of [["https://local-resonance.invalid/api/private-documents/source-a", true], ["https://foreign.example/api/private-documents/source-a", false], ["https://local-resonance.invalid/other", false]]) {
      const documentSource = { ...source, origin: "private-document", canonicalUrl, submittedUrl: canonicalUrl };
      const client = new SourceLibraryGatewayClient({baseUrl, timeoutMs: 1000, fetch: async () => Response.json({result: {source: documentSource, runId: "private-run", reused: false}})});
      assertEquals((await client.createPrivateDocument({title: "Lesson", fileName: "lesson.txt", idempotencyKey: "local-doc"})).ok, expected);
    }
  }
});

Deno.test("source gateway reads the user-facing workflow blocker explanation", async () => {
  let requested = "";
  const client = gateway((request) => {
    requested = request.url;
    return Promise.resolve(Response.json({ result: {
      sourceId: "source-a",
      run: {
        runId: "run-a",
        state: "awaiting-upload",
        revision: 3,
        counts: { pages: 1, knowledgePoints: 0, acceptedQuizzes: 0, pendingQuizzes: 0 },
        extractionStartedAt: "2026-08-20T00:00:00.000Z",
        extractionDeadlineAt: "2026-08-20T00:30:00.000Z",
        elapsedMs: 1_000,
        remainingMs: 1_799_000,
        decisionRequired: "upload-material",
        failureKind: "KnowledgePagePaywallDetected",
      },
      reasonCode: "paywall-or-login",
      message: "This source could not be scraped because it is behind a paywall or requires sign-in. Upload authorized text, PDF, PPTX, or a transcript instead.",
    } }));
  });
  const result = await client.workflowStatus("source-a");
  assertEquals(result.ok, true);
  if (!result.ok) throw new Error(result.error.kind);
  assertEquals(result.value.reasonCode, "paywall-or-login");
  assertEquals(result.value.run?.state, "awaiting-upload");
  assertEquals(new URL(requested).searchParams.get("sourceId"), "source-a");
});

Deno.test("source gateway preserves actual progress when robots verification is unavailable", async () => {
  const evidence={robotsUrl:"https://www.open.edu/robots.txt",targetUrl:"https://www.open.edu/openlearn/course",httpStatus:0,availability:"unavailable",content:"",checkedAt:"2026-10-13T07:00:00.000Z",matchedRule:null};
  const progress={currentUrl:evidence.targetUrl,pageTitle:"Public course",sectionTitle:"Introduction",stage:"Reviewing knowledge",updatedAt:evidence.checkedAt,knowledgePoints:[{knowledgeId:"actual-point-contract",summary:"A retained knowledge summary."}],generatedQuizQuestions:0,processedPageCount:0,totalPages:null};
  const run={runId:"run-a",state:"extraction-loop",revision:4,counts:{pages:0,knowledgePoints:0,acceptedQuizzes:0,pendingQuizzes:0},extractionStartedAt:evidence.checkedAt,extractionDeadlineAt:"2026-10-13T07:30:00.000Z",elapsedMs:1_000,remainingMs:1_799_000,decisionRequired:null,failureKind:null,robotsEvidence:evidence,progress};
  for(const httpStatus of [0,100,200,299,403,429,500,599]){
    const result=await gateway(async()=>Response.json({result:{sourceId:"source-a",run:{...run,robotsEvidence:{...evidence,httpStatus}},reasonCode:null,message:null}})).workflowStatus("source-a");
    assertEquals(result.ok,true);if(!result.ok)throw new Error(result.error.kind);
    assertEquals(result.value.run?.progress?.knowledgePoints[0].summary,progress.knowledgePoints[0].summary);
    assertEquals(result.value.run?.robotsEvidence?.httpStatus,httpStatus);
  }
  for(const candidate of [{httpStatus:-1},{httpStatus:600},{httpStatus:0,content:"Unexpected response content"},{httpStatus:500,content:"Unexpected response content"},{httpStatus:200,availability:"absent"},{httpStatus:500,availability:"present"},{robotsUrl:"http://www.open.edu/robots.txt"}]){
    const result=await gateway(async()=>Response.json({result:{sourceId:"source-a",run:{...run,robotsEvidence:{...evidence,...candidate}},reasonCode:null,message:null}})).workflowStatus("source-a");
    assertEquals(result.ok,false);
  }
  const malformed=await gateway(async()=>Response.json({result:{sourceId:"source-a",run:{...run,robotsEvidence:{...evidence,httpStatus:200,content:"Unparseable robots text"}},reasonCode:null,message:null}})).workflowStatus("source-a");
  assertEquals(malformed.ok,true);
  const foreign=await gateway(async()=>Response.json({result:{sourceId:"source-b",run,reasonCode:null,message:null}})).workflowStatus("source-a");assertEquals(foreign.ok,false);
});

Deno.test("source gateway posts an owner-free workflow retry command and validates its public result", async () => {
  /** @type {Request | null} */ let received = null;
  const client = gateway(async (request) => {
    received = request;
    return Response.json({ result: {
      runId: "run-a",
      state: "extraction-loop",
      revision: 4,
      counts: { pages: 0, knowledgePoints: 0, acceptedQuizzes: 0, pendingQuizzes: 0 },
      extractionStartedAt: "2026-08-20T00:00:00.000Z",
      extractionDeadlineAt: "2026-08-20T00:30:00.000Z",
      elapsedMs: 1_000,
      remainingMs: 1_799_000,
      decisionRequired: null,
      failureKind: null,
      robotsEvidence: null,
    } });
  });
  const result = await client.retryWorkflow({ runId: "run-a", expectedRevision: 3, idempotencyKey: "retry-a" });
  assertEquals(result.ok, true);
  if (!result.ok) return;
  assertEquals(result.value.state, "extraction-loop");
  const request = /** @type {Request} */ (/** @type {unknown} */ (received));
  assertEquals(request.url.endsWith("/api/knowledge-workflows/control"), true);
  const body = /** @type {Record<string, unknown>} */ (await request.json());
  assertEquals(body.action, "resume");
  assertEquals(body.ownerId, undefined);
  await client.retryWorkflow({runId:"run-a",expectedRevision:3,idempotencyKey:"quiz-retry-a",quizzes:true});
  const quizRequest=/** @type {Request} */(/** @type {unknown} */(received));
  const quizBody=await quizRequest.json();
  assertEquals(quizBody.action,"retry-quizzes");
  assertEquals(quizBody.ownerId,undefined);
  assertEquals(quizBody.quizzes,undefined);
});

Deno.test("source gateway uses multipart for a PDF or slide-deck material file", async () => {
  const client = gateway(async (request) => {
    assertEquals(request.headers.get("content-type")?.startsWith("multipart/form-data"), true);
    const form = await request.formData();
    assertEquals(form.get("runId"), "run-a");
    assertEquals(form.get("mediaType"), "application/pdf");
    assertEquals(form.get("file") instanceof File, true);
    return Response.json({ result: { status: "attached", materialId: "material-pdf", runId: "run-a", reused: false } });
  });
  const uploaded = await client.uploadWorkflowMaterial({ runId: "run-a", sourceId: source.id, sourceRevision: 1, sourceUrl: source.canonicalUrl, mediaType: "application/pdf", fileName: "lesson.pdf", idempotencyKey: "material-pdf", file: new File([new Uint8Array([37, 80, 68, 70, 45])], "lesson.pdf", { type: "application/pdf" }), rightsAttestation: { ownsOrPermitted: true, storageAllowed: true, transformationAllowed: true, processingAllowed: true, basis: "learner copy", reference: "attestation-pdf" } });
  assertEquals(uploaded.ok, true);
});

Deno.test("source gateway carries image mode and the raster file through multipart", async () => {
  const client = gateway(async (request) => {
    const form = await request.formData();
    assertEquals(form.get("mode"), "image");
    assertEquals(form.get("mediaType"), "image/png");
    assertEquals(form.get("file") instanceof File, true);
    return Response.json({ result: { status: "attached", materialId: "material-image", runId: "run-a", reused: false } });
  });
  const uploaded = await client.uploadWorkflowMaterial({ runId: "run-a", sourceId: source.id, sourceRevision: 1, sourceUrl: source.canonicalUrl, mediaType: "image/png", fileName: "chapter5-page-001.png", mode: "image", idempotencyKey: "material-image", file: new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], "chapter5-page-001.png", { type: "image/png" }), rightsAttestation: { ownsOrPermitted: true, storageAllowed: true, transformationAllowed: true, processingAllowed: true, basis: "learner-owned", reference: "attestation-image" } });
  assertEquals(uploaded.ok, true);
});

Deno.test("source gateway reads a validated bounded catalog page", async () => {
  let requested = "";
  const client = gateway((request) => {
    requested = request.url;
    return Promise.resolve(Response.json({
      ownerId: "owner-a",
      result: {
        items: [source],
        interestAreas: [{
          id: "area-a",
          ownerId: "owner-a",
          title: "Music",
          provenance: "configured",
        }],
        nextCursor: "signed-cursor",
      },
    }));
  });
  const result = await client.browse({ limit: 20, cursor: "previous" });
  assertEquals(result.ok, true);
  if (!result.ok) throw new Error(result.error.kind);
  assertEquals(result.value.items[0].id, "source-a");
  assertEquals(result.value.nextCursor, "signed-cursor");
  assertEquals(new URL(requested).searchParams.get("limit"), "20");
  assertEquals(new URL(requested).searchParams.get("cursor"), "previous");
});

Deno.test("source gateway validates search results and disabled sources", async () => {
  const valid = await gateway(() =>
    Promise.resolve(Response.json({ result: [{ source, score: 0.75 }] }))
  ).search({ query: "harmony", mode: "keyword", limit: 10 });
  assertEquals(valid.ok, true);
  if (!valid.ok) throw new Error(valid.error.kind);
  assertEquals(valid.value[0].score, 0.75);

  const invalid = await gateway(() =>
    Promise.resolve(
      Response.json({
        result: [{ source: { ...source, state: "disabled" }, score: 1 }],
      }),
    )
  ).search({ query: "harmony", mode: "semantic", limit: 10 });
  assertEquals(invalid.ok, false);
  if (invalid.ok) throw new Error("Expected invalid response.");
  assertEquals(invalid.error.kind, "SourceGatewayResponseInvalid");
});

Deno.test("source gateway forwards explicit external processing consent without inventing it", async () => {
  let requested = "";
  const client = gateway(async (request) => {
    requested = request.url;
    return Response.json({ result: [] });
  });
  await client.search({ query: "harmony", mode: "combined", limit: 10, externalProcessingAllowed: true });
  assertEquals(new URL(requested).searchParams.get("externalProcessingAllowed"), "true");
  await client.search({ query: "harmony", mode: "keyword", limit: 10 });
  assertEquals(new URL(requested).searchParams.has("externalProcessingAllowed"), false);
});

Deno.test("source gateway defaults omitted search mode to Combined", async () => {
  let requested = "";
  const result = await gateway((request) => {
    requested = request.url;
    return Promise.resolve(Response.json({ result: [{ source, score: 0.75 }] }));
  }).search({ query: "harmony", limit: 10 });
  assertEquals(result.ok, true);
  assertEquals(new URL(requested).searchParams.get("mode"), "combined");
});

Deno.test("source gateway parses cross-source knowledge search results and forwards scope", async () => {
  let requested = "";
  const result = await gateway((request) => {
    requested = request.url;
    return Promise.resolve(Response.json({ result: [{
      knowledge: {
        knowledgeId: "knowledge-a",
        sourceId: "source-a",
        sourceTitle: "Music learning source",
        summary: "A cadence resolves harmonic tension.",
        sourceUrl: source.canonicalUrl,
        evidenceAnchorIds: ["anchor-a"],
        questionLocked: true,
      },
      score: 0.84,
      matchedBy: "semantic",
    }] }));
  }).search({ query: "cadence", scope: "knowledge", mode: "semantic", limit: 10 });
  assertEquals(result.ok, true);
  if (!result.ok) throw new Error(result.error.kind);
  assertEquals(result.value[0].knowledge.knowledgeId, "knowledge-a");
  assertEquals(result.value[0].matchedBy, "semantic");
  const params = new URL(requested).searchParams;
  assertEquals(params.get("scope"), "knowledge");
  assertEquals(params.get("mode"), "semantic");
});

Deno.test("source gateway mutations omit owner and expose server rejection", async () => {
  /** @type {unknown} */ let body = null;
  const client = gateway(async (request) => {
    body = await request.json();
    return Response.json({ error: "SourceRevisionStale" }, { status: 409 });
  });
  const result = await client.disable({
    sourceId: "source-a",
    expectedRevision: 1,
    idempotencyKey: "disable-a",
  });
  assertEquals(result.ok, false);
  if (result.ok) throw new Error("Expected rejection.");
  assertEquals(result.error.kind, "SourceGatewayRejected");
  if (result.error.kind !== "SourceGatewayRejected") {
    throw new Error("Expected server failure.");
  }
  assertEquals(result.error.failureKind, "SourceRevisionStale");
  assertEquals(
    Object.hasOwn(/** @type {Record<string, unknown>} */ (body), "ownerId"),
    false,
  );
});

Deno.test("source gateway distinguishes authentication, availability, and malformed data", async () => {
  const unauthenticated = await gateway(() =>
    Promise.resolve(new Response(null, { status: 401 }))
  ).browse({ limit: 10 });
  assertEquals(unauthenticated.ok, false);
  if (unauthenticated.ok) throw new Error("Expected authentication failure.");
  assertEquals(unauthenticated.error.kind, "SourceGatewayUnauthenticated");

  const unavailable = await gateway(() =>
    Promise.reject(new TypeError("offline"))
  ).browse({ limit: 10 });
  assertEquals(unavailable.ok, false);
  if (unavailable.ok) throw new Error("Expected unavailable failure.");
  assertEquals(unavailable.error.kind, "SourceGatewayUnavailable");

  const malformed = await gateway(() =>
    Promise.resolve(Response.json({ result: { items: "not-array" } }))
  ).browse({ limit: 10 });
  assertEquals(malformed.ok, false);
  if (malformed.ok) throw new Error("Expected response failure.");
  assertEquals(malformed.error.kind, "SourceGatewayResponseInvalid");
});

Deno.test("source gateway checks a bounded suppression projection", async () => {
  /** @type {unknown} */ let body = null;
  const client = gateway(async (request) => {
    body = await request.json();
    return Response.json({ result: ["identity-b"] });
  });
  const result = await client.suppressed(["identity-a", "identity-b"]);
  assertEquals(result.ok, true);
  if (!result.ok) throw new Error(result.error.kind);
  assertEquals(result.value.join(","), "identity-b");
  const identities = /** @type {Record<string, unknown>} */ (body)
    .canonicalIdentities;
  assertEquals(Array.isArray(identities) ? identities.length : -1, 2);
});

Deno.test("source gateway validates the active source projection", async () => {
  /** @type {unknown} */ let body = null;
  const client = gateway(async (request) => {
    body = await request.json();
    return Response.json({ result: ["source-a"] });
  });
  const result = await client.active(["source-a", "source-disabled"]);
  assertEquals(result.ok, true);
  if (!result.ok) throw new Error(result.error.kind);
  assertEquals(result.value.join(","), "source-a");
  const sourceIds = /** @type {Record<string, unknown>} */ (body).sourceIds;
  assertEquals(Array.isArray(sourceIds) ? sourceIds.length : -1, 2);

  const injected = await gateway(() =>
    Promise.resolve(Response.json({ result: ["source-not-requested"] }))
  ).active(["source-a"]);
  assertEquals(injected.ok, false);
  if (injected.ok) throw new Error("Expected invalid active projection.");
  assertEquals(injected.error.kind, "SourceGatewayResponseInvalid");
});

Deno.test("source gateway fences ignored fetch/body deadlines", async () => {
  for (const delayBody of [false,true]) {
    const client=new SourceLibraryGatewayClient({baseUrl:"https://example.test/",timeoutMs:5,fetch:async()=>{
      if(!delayBody) await new Promise(resolve=>setTimeout(resolve,15));
      const response=Response.json({result:{items:[],interestAreas:[],nextCursor:null}});
      if(delayBody) response.json=async()=>{await new Promise(resolve=>setTimeout(resolve,15));return {result:{items:[],interestAreas:[],nextCursor:null}};};
      return response;
    }});
    const result=await client.browse({limit:1});
    assertEquals(result.ok,false);if(!result.ok)assertEquals(result.error.kind,"SourceGatewayTimedOut");
    await new Promise(resolve=>setTimeout(resolve,20)); // Release the deliberately ignored late response/body timers.
  }
});

Deno.test("cancel gateway sends an authenticated scoped abandon command",async()=>{
  let payload;
  const client=gateway(async request=>{payload=await request.json();return Response.json({result:{runId:"run-a",state:"abandoned",revision:2,counts:{pages:0,knowledgePoints:0,acceptedQuizzes:0,pendingQuizzes:0},extractionStartedAt:null,extractionDeadlineAt:null,elapsedMs:null,remainingMs:null,decisionRequired:null,failureKind:null,robotsEvidence:null}});});
  const result=await client.cancelWorkflow({runId:"run-a",expectedRevision:1,idempotencyKey:"cancel-a"});
  assertEquals(result.ok,true);assertEquals(JSON.stringify(payload),JSON.stringify({runId:"run-a",expectedRevision:1,action:"abandon",idempotencyKey:"cancel-a"}));
});

Deno.test("source gateway deadline returns even when injected transport never settles",async()=>{
  const client=new SourceLibraryGatewayClient({baseUrl:"https://example.test/",timeoutMs:5,fetch:()=>new Promise(()=>{})});
  const result=await client.browse({limit:1});assertEquals(result.ok,false);if(!result.ok)assertEquals(result.error.kind,"SourceGatewayTimedOut");
});

Deno.test("knowledge search retains citation fragments while rejecting unsafe URLs", async () => {
  for (const sourceUrl of ["https://publisher.example/article#section=page-13", "https://publisher.example/article#:~:text=decoder", "https://publisher.example/article", "javascript:alert(1)#section", "http://publisher.example/article#section", "https://user:secret@publisher.example/article#section", "#section=page-13", "not a URL"]) {
    const result = await gateway(() => Promise.resolve(Response.json({ result: [{ knowledge: { knowledgeId: "k", sourceId: "s", sourceTitle: "Source", summary: "The decoder consists of a stack of identical layers.", sourceUrl, evidenceAnchorIds: ["anchor"], questionLocked: true }, score: 14.03, matchedBy: "exact" }] }))).search({ query: "decoder", scope: "knowledge", mode: "keyword", limit: 50 });
    if (sourceUrl.startsWith("https://publisher.example/")) {
      assertEquals(result.ok, true);
      if (!result.ok) throw new Error(result.error.kind);
      assertEquals(result.value[0].knowledge.sourceUrl, sourceUrl);
    } else {
      assertEquals(result.ok, false);
      if (result.ok) throw new Error("Unsafe citation accepted");
      assertEquals(result.error.kind, "SourceGatewayResponseInvalid");
    }
  }
});

Deno.test("source gateway validates source topics before they reach Library", async () => {
  for (const sourceTopic of [undefined,null,"Meter and rhythm","",42]) {
    const result = await gateway(async () => Response.json({ownerId:"owner-a",result:{items:[{...source,sourceTopic}],interestAreas:[],nextCursor:null}})).browse({limit:20});
    assertEquals(result.ok,sourceTopic == null || sourceTopic === "Meter and rhythm");
    if (result.ok) assertEquals(result.value.items[0].sourceTopic,sourceTopic);
  }
});
