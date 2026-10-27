// @ts-check

/** @typedef {{ readonly event: string, readonly ownerId?: string, readonly runId?: string, readonly stage?: string, readonly action?: string, readonly failureKind?: string, readonly field?: string, readonly diagnosticToken?: string,readonly phase?: import("./webpage-facts.js").WebpagePhase, readonly requestId?:string,readonly inputTokens?:number|null,readonly outputTokens?:number|null,readonly costNanodollars?:number|null, readonly httpStatus?: number, readonly durationMs?: number, readonly count?: number, readonly itemCount?: number }} KnowledgeWorkflowLogEntry */
/** @typedef {{ readonly component: "knowledge-workflow", readonly event: string, readonly correlationId: string, readonly occurredAt: string, readonly ownerId?: string, readonly runId?: string, readonly stage?: string, readonly action?: string, readonly failureKind?: string, readonly field?: string, readonly diagnosticToken?: string,readonly phase?: import("./webpage-facts.js").WebpagePhase, readonly requestId?:string,readonly inputTokens?:number|null,readonly outputTokens?:number|null,readonly costNanodollars?:number|null, readonly httpStatus?: number, readonly durationMs?: number, readonly count?: number, readonly itemCount?: number }} KnowledgeWorkflowLogRecord */
/** @typedef {{ readonly kind: "KnowledgeWorkflowLogEntryInvalid" | "KnowledgeWorkflowLogTimestampInvalid" }} KnowledgeWorkflowLogFailure */
/** @template T, E @typedef {{ readonly ok: true, readonly value: T } | { readonly ok: false, readonly error: E }} Result */

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function record(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }
/** @param {unknown} value @returns {value is string} */
function text(value) { return typeof value === "string" && value.trim() !== ""; }
/** @param {unknown} value @returns {value is number} */
function nonNegativeInteger(value) { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0; }
/** @param {unknown} value @returns {value is string} */
function boundedCategory(value) { return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value); }

/**
 * A dedicated, allow-listed structured sink for the M5 backend. The logger
 * never serializes unknown entry fields, so source text, prompts, answers,
 * provider payloads, credentials, and private memory cannot enter the log.
 * @param {{ readonly sink: (record: KnowledgeWorkflowLogRecord) => void, readonly now: () => string }} dependencies
 * @returns {(entry: KnowledgeWorkflowLogEntry) => Result<null, KnowledgeWorkflowLogFailure>}
 */
export function createKnowledgeWorkflowLogger(dependencies) {
  if (typeof dependencies?.sink !== "function" || typeof dependencies.now !== "function") throw new TypeError("Knowledge workflow logger dependencies are invalid.");
  /** @type {Map<string, number>} */
  const started = new Map();
  /** @returns {Result<null, KnowledgeWorkflowLogFailure>} */
  const invalidEntry = () => ({ ok: false, error: { kind: "KnowledgeWorkflowLogEntryInvalid" } });
  /** @param {KnowledgeWorkflowLogEntry} entry @returns {Result<null, KnowledgeWorkflowLogFailure>} */
  function log(entry) {
    if (!record(entry) || !boundedCategory(entry.event) ||
      (entry.ownerId !== undefined && !boundedCategory(entry.ownerId)) ||
      (entry.runId !== undefined && !boundedCategory(entry.runId)) ||
      (entry.stage !== undefined && !boundedCategory(entry.stage)) ||
      (entry.action !== undefined && !boundedCategory(entry.action)) ||
      (entry.failureKind !== undefined && !boundedCategory(entry.failureKind)) ||
      (entry.diagnosticToken !== undefined && !boundedCategory(entry.diagnosticToken)) ||
      (entry.field !== undefined && !boundedCategory(entry.field)) ||
      (entry.phase!==undefined&&!['extraction','normalization','grounding','match','verify'].includes(entry.phase)) ||
      (entry.requestId!==undefined&&!boundedCategory(entry.requestId)) ||
      (entry.inputTokens!==undefined&&entry.inputTokens!==null&&!nonNegativeInteger(entry.inputTokens)) ||
      (entry.outputTokens!==undefined&&entry.outputTokens!==null&&!nonNegativeInteger(entry.outputTokens)) ||
      (entry.costNanodollars!==undefined&&entry.costNanodollars!==null&&!nonNegativeInteger(entry.costNanodollars)) ||
      (entry.httpStatus !== undefined && (!Number.isSafeInteger(entry.httpStatus) || entry.httpStatus < 100 || entry.httpStatus > 599)) ||
      (entry.durationMs !== undefined && !nonNegativeInteger(entry.durationMs)) ||
      (entry.count !== undefined && !nonNegativeInteger(entry.count)) ||
      (entry.itemCount !== undefined && !nonNegativeInteger(entry.itemCount))) return invalidEntry();
    const occurredAt = dependencies.now();
    if (!text(occurredAt) || !Number.isFinite(Date.parse(occurredAt))) return { ok: false, error: { kind: "KnowledgeWorkflowLogTimestampInvalid" } };
    const ownerId = entry.ownerId;
    const runId = entry.runId;
    const correlationId = runId ?? (ownerId === undefined ? "knowledge-workflow" : `owner:${ownerId}`);
    const explicitDuration = entry.durationMs === undefined ? undefined : entry.durationMs;
    const isEntry = entry.event.endsWith("-entry");
    const isTerminal = entry.event.endsWith("-success") || entry.event.endsWith("-failure");
    const timerKey = `${correlationId}:${entry.stage??""}:${entry.event.replace(/-(entry|success|failure)$/u,"")}`;
    if (isEntry) started.set(timerKey, Date.parse(occurredAt));
    const inferredDuration = explicitDuration ?? (isTerminal && started.has(timerKey) ? Math.max(0, Date.parse(occurredAt) - /** @type {number} */ (started.get(timerKey))) : undefined);
    if (isTerminal) started.delete(timerKey);
    /** @type {KnowledgeWorkflowLogRecord} */
    const safe = {
      component: "knowledge-workflow",
      event: entry.event,
      correlationId,
      occurredAt,
      ...(ownerId === undefined ? {} : { ownerId }),
      ...(runId === undefined ? {} : { runId }),
      ...(text(entry.stage) ? { stage: entry.stage } : {}),
      ...(text(entry.action) ? { action: entry.action } : {}),
      ...(text(entry.failureKind) ? { failureKind: entry.failureKind } : {}),
      ...(entry.diagnosticToken === undefined ? {} : { diagnosticToken: entry.diagnosticToken }),
      ...(entry.field === undefined ? {} : { field: entry.field }),
      ...(entry.phase===undefined?{}:{phase:entry.phase}),
      ...(entry.requestId===undefined?{}:{requestId:entry.requestId}),
      ...(entry.inputTokens===undefined?{}:{inputTokens:entry.inputTokens}),
      ...(entry.outputTokens===undefined?{}:{outputTokens:entry.outputTokens}),
      ...(entry.costNanodollars===undefined?{}:{costNanodollars:entry.costNanodollars}),
      ...(entry.httpStatus === undefined ? {} : { httpStatus: entry.httpStatus }),
      ...(inferredDuration === undefined ? {} : { durationMs: inferredDuration }),
      ...(nonNegativeInteger(entry.count) ? { count: entry.count } : {}),
      ...(nonNegativeInteger(entry.itemCount) ? { itemCount: entry.itemCount } : {}),
    };
    dependencies.sink(Object.freeze(safe));
    return { ok: true, value: null };
  }
  return Object.freeze(log);
}

/** Return only platform error categories; exception text can contain private SQL/input.
 * @param {unknown} error @returns {string} */
export function workflowPersistenceDiagnostic(error) {
  const visited=new Set();
  while(error instanceof Error&&!visited.has(error)) {
    visited.add(error);
    if(/exceeded D1.s free tier daily row (read|write) limit/i.test(error.message))return "d1-daily-quota";
    if(/Too many subrequests|Too many API requests by single Worker invocation/i.test(error.message))return "subrequest-limit";
    if(error.message.includes("SQLITE_CONSTRAINT"))return "sqlite-constraint";
    if(error.message.includes("SQLITE_TOOBIG"))return "sqlite-too-big";
    if(error.message.includes("SQLITE_BUSY")||error.message.includes("SQLITE_LOCKED"))return "sqlite-busy";
    if(error.message.includes("D1 DB is overloaded"))return "d1-overloaded";
    if(/storage caused object to be reset|reset because its code was updated|temporarily unavailable/i.test(error.message))return "d1-reset";
    if(/Network connection lost/i.test(error.message))return "d1-network";
    if(/no such (table|column)/i.test(error.message))return "sqlite-schema";
    if(/too many (sql variables|columns)/i.test(error.message))return "sqlite-limit";
    if(/CPU time limit/i.test(error.message))return "cpu-limit";
    if(error.message.includes("SQLITE_ERROR"))return "sqlite-error";
    error=error.cause;
  }
  return "database-error";
}
