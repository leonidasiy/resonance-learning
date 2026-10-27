// @ts-check

import { createKnowledgeWorkflowLogger, workflowPersistenceDiagnostic } from "../worker/knowledge-workflow-logging.js";

/** @template T @param {T} actual @param {T} expected */
function assertEquals(actual, expected) { if (!Object.is(actual, expected)) throw new Error(`Expected ${String(expected)}, received ${String(actual)}.`); }
/** @param {unknown} value @returns {value is Record<string, unknown>} */
function record(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }
/** @param {unknown} value @returns {boolean} */
function resultOk(value) { return record(value) && value.ok === true; }
/** @param {unknown} value @returns {string} */
function resultErrorKind(value) {
  if (!record(value) || !record(value.error) || typeof value.error.kind !== "string") throw new Error("Expected a named log validation failure.");
  return value.error.kind;
}

Deno.test("knowledge workflow logger emits an allow-listed correlation record with duration", () => {
  /** @type {Record<string, unknown>[]} */ const records = [];
  const logger = createKnowledgeWorkflowLogger({ sink: (entry) => records.push(entry), now: () => "2026-08-13T00:00:01.000Z" });
  const unsafeEntry = /** @type {never} */ ({ event: "extract-entry", ownerId: "owner-a", runId: "run-a", prompt: "must-not-log", count: 2 });
  const terminalUnsafeEntry = /** @type {never} */ ({ event: "extract-success", ownerId: "owner-a", runId: "run-a", sourceText: "must-not-log" });
  logger(unsafeEntry);
  logger(terminalUnsafeEntry);
  assertEquals(records.length, 2);
  assertEquals(records[1].component, "knowledge-workflow");
  assertEquals(records[1].correlationId, "run-a");
  assertEquals(records[1].durationMs, 0);
  assertEquals("prompt" in records[0], false);
  assertEquals("sourceText" in records[1], false);
});

Deno.test("knowledge workflow success and failure logs retain IDs and named outcomes without content", () => {
  /** @type {Record<string, unknown>[]} */ const records = [];
  const logger = createKnowledgeWorkflowLogger({
    sink: (entry) => records.push(entry),
    now: () => "2026-08-13T00:00:01.000Z",
  });
  logger(/** @type {never} */ ({ event: "browser-success", ownerId: "owner-a", runId: "run-a", httpStatus: 200, prompt: "private prompt", uploadedText: "private upload", extractedText: "private extraction", summary: "private summary", providerOutput: "private provider output" }));
  logger(/** @type {never} */ ({ event: "browser-failure", ownerId: "owner-a", runId: "run-a", failureKind: "KnowledgeBrowserNavigationFailed", httpStatus: 502, prompt: "private prompt", uploadedText: "private upload", extractedText: "private extraction", summary: "private summary", providerOutput: "private provider output" }));
  assertEquals(records[0].ownerId, "owner-a");
  assertEquals(records[0].runId, "run-a");
  assertEquals(records[0].httpStatus, 200);
  assertEquals(records[1].ownerId, "owner-a");
  assertEquals(records[1].runId, "run-a");
  assertEquals(records[1].failureKind, "KnowledgeBrowserNavigationFailed");
  assertEquals(records[1].httpStatus, 502);
  for (const record of records) for (const field of ["prompt", "uploadedText", "extractedText", "summary", "providerOutput"]) assertEquals(field in record, false);
});

Deno.test("knowledge workflow logger rejects invalid entries and durations", () => {
  const logger = createKnowledgeWorkflowLogger({ sink: () => {}, now: () => "2026-08-13T00:00:00.000Z" });
  assertEquals(resultErrorKind(logger(/** @type {never} */ ({}))), "KnowledgeWorkflowLogEntryInvalid");
  assertEquals(resultErrorKind(logger({ event: "duration-entry", durationMs: -1 })), "KnowledgeWorkflowLogEntryInvalid");
});

Deno.test("knowledge workflow logger validates bounded categories from the call-site contract", () => {
  const logger = createKnowledgeWorkflowLogger({ sink: () => {}, now: () => "2026-08-13T00:00:00.000Z" });
  assertEquals(resultOk(logger({ event: "extract-entry", stage: "extraction", action: "read", failureKind: "ExtractionFailed" })), true);
  for (const entry of [
    { event: "free form event" },
    { event: "extract-entry", stage: "source summary" },
    { event: "extract-entry", action: "search query" },
    { event: "extract-entry", failureKind: "provider output" },
  ]) assertEquals(resultErrorKind(logger(/** @type {never} */ (entry))), "KnowledgeWorkflowLogEntryInvalid");
});

Deno.test("knowledge workflow logger accepts only bounded opaque owner and run IDs", () => {
  const logger = createKnowledgeWorkflowLogger({ sink: () => {}, now: () => "2026-08-13T00:00:00.000Z" });
  assertEquals(resultOk(logger({ event: "workflow-entry", ownerId: "owner-a", runId: "run-a" })), true);
  for (const entry of [
    { event: "workflow-entry", ownerId: "https://private.example/owner" },
    { event: "workflow-entry", runId: "prompt with spaces" },
    { event: "workflow-entry", ownerId: "x".repeat(129) },
  ]) assertEquals(resultErrorKind(logger(/** @type {never} */ (entry))), "KnowledgeWorkflowLogEntryInvalid");
});

Deno.test("knowledge workflow logger excludes raw content from every allowed output field", () => {
  /** @type {Record<string, unknown>[]} */ const records = [];
  const logger = createKnowledgeWorkflowLogger({ sink: (entry) => records.push(entry), now: () => "2026-08-13T00:00:00.000Z" });
  const result = logger(/** @type {never} */ ({
    event: "search-success",
    ownerId: "owner-a",
    runId: "run-a",
    stage: "search",
    action: "read",
    failureKind: "SearchFailed",
    query: "raw search query",
    sourceText: "raw source text",
    summary: "raw summary",
    prompt: "raw prompt",
    providerOutput: "raw provider output",
  }));
  assertEquals(resultOk(result), true);
  const serialized = JSON.stringify(records);
  for (const value of ["raw search query", "raw source text", "raw summary", "raw prompt", "raw provider output"]) assertEquals(serialized.includes(value), false);
});

Deno.test('persistence diagnostics identify nested platform limits without exposing exception text',async()=>{
 const {workflowPersistenceDiagnostic}=await import('../worker/knowledge-workflow-logging.js');
 assertEquals(workflowPersistenceDiagnostic(new Error('D1_ERROR: private SQL',{cause:new Error('Too many subrequests.')})),'subrequest-limit');
 assertEquals(workflowPersistenceDiagnostic(new Error('SQLITE_CONSTRAINT: private values')),'sqlite-constraint');
 assertEquals(workflowPersistenceDiagnostic(new Error('SQLITE_TOOBIG: private values')),'sqlite-too-big');
 const cycle=new Error('private SQL and secret');cycle.cause=cycle;assertEquals(workflowPersistenceDiagnostic(cycle),'database-error');
 assertEquals(workflowPersistenceDiagnostic('private data'),'database-error');
});

Deno.test('concurrent stages retain independent timers and cost fields stay numeric',()=>{
  let elapsed=0;
  /** @type {Record<string,unknown>[]} */const records=[];
  const logger=createKnowledgeWorkflowLogger({now:()=>new Date(Date.parse('2026-10-16T00:00:00Z')+elapsed).toISOString(),sink:e=>records.push(e)});
  logger({event:'generate-entry',runId:'run-a',stage:'generation'});
  elapsed=10;logger({event:'review-entry',runId:'run-a',stage:'review'});
  elapsed=30;logger({event:'generate-success',runId:'run-a',stage:'generation'});
  elapsed=50;logger({event:'review-success',runId:'run-a',stage:'review'});
  assertEquals(records[2].durationMs,30);assertEquals(records[3].durationMs,40);
  assertEquals(resultOk(logger({event:'knowledge-model-usage',costNanodollars:2000})),true);
  assertEquals(resultErrorKind(logger(/** @type {never} */({event:'knowledge-model-usage',costNanodollars:'private'}))),'KnowledgeWorkflowLogEntryInvalid');
});

Deno.test("D1 daily quotas retain a safe distinct diagnostic",()=>{
 for(const kind of ["read","write"])assertEquals(workflowPersistenceDiagnostic(new Error(`D1_ERROR: Your account has exceeded D1's free tier daily row ${kind} limit. Private details must not be logged.`)),"d1-daily-quota");
});
