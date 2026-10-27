// @ts-check

import {
  isIsoDateTime,
  isNonEmptyText,
  isPublicHttpsUrl,
  isRecord,
} from "./contracts.js";
import { sourceHref } from "./source-link.js";
import { parseWorkflowProgress } from '../knowledge-workflows/progress.js';
import { isSubjectId } from '../knowledge-subjects/public.js';

/** @import { KnowledgeSearchHit, LibrarySource, Result, SourceCatalogPage, SourceInterestArea, SourceSearchHit, SourceSearchScope } from "./contracts.js" */

/** @typedef {{ readonly kind: "SourceGatewayCommandInvalid", readonly field: string } | { readonly kind: "SourceGatewayUnauthenticated" } | { readonly kind: "SourceGatewayUnauthorized" } | { readonly kind: "SourceGatewayUnavailable" } | { readonly kind: "SourceGatewayTimedOut" } | { readonly kind: "SourceGatewayResponseInvalid" } | { readonly kind: "SourceGatewayRejected", readonly failureKind: string }} SourceGatewayFailure */
/** @typedef {{ readonly runId: string }} WorkflowStartProjection */
/** @typedef {{ readonly robotsUrl: string, readonly targetUrl: string, readonly httpStatus: number, readonly availability: "present" | "absent" | "unavailable", readonly content: string, readonly checkedAt: string, readonly matchedRule: string | null }} WorkflowRobotsEvidence */
/** @typedef {{ readonly runId: string, readonly state: string, readonly revision: number, readonly counts: Readonly<{ readonly pages: number, readonly knowledgePoints: number, readonly acceptedQuizzes: number, readonly pendingQuizzes: number }>, readonly extractionStartedAt: string | null, readonly extractionDeadlineAt: string | null, readonly elapsedMs: number | null, readonly remainingMs: number | null, readonly decisionRequired: string | null, readonly failureKind: string | null, readonly robotsEvidence: WorkflowRobotsEvidence | null, readonly progress?: import('../knowledge-workflows/progress.js').WorkflowProgress }} WorkflowRunStatus */
/** @typedef {{ readonly sourceId: string, readonly run: WorkflowRunStatus | null, readonly reasonCode: string | null, readonly message: string | null }} WorkflowSourceStatus */

const freeze = Object.freeze;
const WORKFLOW_PROCESSING_STATES = new Set([
  "source-added",
  "rights-assessment",
  "robots-check",
  "extraction-loop",
  "extraction-finalized",
  "per-point-quiz-loop",
]);

/**
 * Count sources whose workflow is actively progressing toward retained knowledge.
 * Waiting-for-user, upload-required, completed, and abandoned states are intentionally excluded.
 *
 * @param {readonly WorkflowSourceStatus[]} statuses
 * @returns {number}
 */
export function countProcessingWorkflowStatuses(statuses) {
  if (!Array.isArray(statuses)) throw new TypeError("Workflow statuses are invalid.");
  const sourceIds = new Set();
  for (const status of statuses) {
    if (
      !isRecord(status) || !isNonEmptyText(status.sourceId) ||
      (status.run !== null &&
        (!isRecord(status.run) || !isNonEmptyText(status.run.state)))
    ) throw new TypeError("Workflow status is invalid.");
    const state = status.run === null ? null : /** @type {string} */ (status.run.state);
    if (state !== null && (WORKFLOW_PROCESSING_STATES.has(state) || state === "awaiting-time-limit-decision" && typeof status.run?.remainingMs === "number" && status.run.remainingMs>0 && status.run?.decisionRequired===null) && !(state === "extraction-loop" && status.run?.remainingMs === 0)) {
      sourceIds.add(status.sourceId);
    }
  }
  return sourceIds.size;
}

export class SourceLibraryGatewayClient {
  /** @type {typeof fetch} */ #fetch;
  /** @type {URL} */ #base;
  /** @type {number} */ #timeoutMs;

  /** @param {{ readonly fetch: typeof fetch, readonly baseUrl: string, readonly timeoutMs: number }} dependencies */
  constructor(dependencies) {
    if (
      typeof dependencies.fetch !== "function" ||
      !URL.canParse(dependencies.baseUrl) ||
      !Number.isInteger(dependencies.timeoutMs) || dependencies.timeoutMs < 1
    ) {
      throw new TypeError("SourceGatewayDependencyInvalid");
    }
    this.#base = new URL(dependencies.baseUrl);
    if (
      this.#base.protocol !== "https:" && this.#base.hostname !== "localhost" &&
      this.#base.hostname !== "127.0.0.1"
    ) {
      throw new TypeError("SourceGatewayProtocolInvalid");
    }
    this.#fetch = dependencies.fetch;
    this.#timeoutMs = dependencies.timeoutMs;
  }

  /** @param {unknown} command @returns {Promise<Result<SourceCatalogPage, SourceGatewayFailure>>} */
  async browse(command) {
    if (
      !isRecord(command) || typeof command.limit !== "number" ||
      !Number.isInteger(command.limit) || command.limit < 1 ||
      (command.cursor !== null && command.cursor !== undefined &&
        !isNonEmptyText(command.cursor))
    ) {
      return invalid("command");
    }
    const params = new URLSearchParams({ limit: String(command.limit) });
    if (isNonEmptyText(command.cursor)) params.set("cursor", command.cursor);
    const response = await this.#request(
      `api/source-library?${params}`,
      "GET",
      null,
    );
    if (!response.ok) return response;
    const result = isRecord(response.value) ? response.value.result : null;
    return sourcePage(result, isRecord(response.value) ? response.value.ownerId : undefined);
  }

  /**
   * @overload
   * @param {{ readonly query: string, readonly mode?: "keyword" | "semantic" | "combined", readonly externalProcessingAllowed?: boolean, readonly limit: number, readonly scope: "knowledge" }} command
   * @returns {Promise<Result<readonly KnowledgeSearchHit[], SourceGatewayFailure>>}
   */
  /**
   * @overload
   * @param {{ readonly query: string, readonly mode?: "keyword" | "semantic" | "combined", readonly externalProcessingAllowed?: boolean, readonly limit: number, readonly scope?: "sources" }} command
   * @returns {Promise<Result<readonly SourceSearchHit[], SourceGatewayFailure>>}
   */
  /** @param {unknown} command @returns {Promise<Result<readonly (SourceSearchHit | KnowledgeSearchHit)[], SourceGatewayFailure>>} */
  async search(command) {
    if (
      !isRecord(command) || !isNonEmptyText(command.query) ||
      (command.externalProcessingAllowed !== undefined && typeof command.externalProcessingAllowed !== "boolean") ||
      (command.mode !== undefined && command.mode !== "keyword" &&
        command.mode !== "semantic" && command.mode !== "combined") ||
      (command.scope !== undefined && command.scope !== "sources" &&
        command.scope !== "knowledge") ||
      typeof command.limit !== "number" || !Number.isInteger(command.limit) ||
      command.limit < 1
    ) {
      return invalid("command");
    }
    /** @type {SourceSearchScope} */
    const scope = command.scope ?? "sources";
    const params = new URLSearchParams({
      q: command.query.trim(),
      mode: command.mode ?? "combined",
      scope,
      limit: String(command.limit),
    });
    if (command.externalProcessingAllowed === true) params.set("externalProcessingAllowed", "true");
    const response = await this.#request(
      `api/source-library/search?${params}`,
      "GET",
      null,
    );
    if (!response.ok) return response;
    const values = isRecord(response.value) ? response.value.result : null;
    if (!Array.isArray(values)) return bad();
    if (scope === "knowledge") {
      /** @type {KnowledgeSearchHit[]} */ const hits = [];
      for (const value of values) {
        const parsed = parseKnowledgeSearchHit(value);
        if (parsed === null) return bad();
        hits.push(parsed);
      }
      return { ok: true, value: freeze(hits) };
    }
    /** @type {SourceSearchHit[]} */ const hits = [];
    for (const value of values) {
      if (
        !isRecord(value) || typeof value.score !== "number" ||
        !Number.isFinite(value.score)
      ) return bad();
      const source = parseSource(value.source);
      if (source === null || source.state !== "active") return bad();
      hits.push(freeze({ source, score: value.score }));
    }
    return { ok: true, value: freeze(hits) };
  }

  /** @param {unknown} command @returns {Promise<Result<LibrarySource, SourceGatewayFailure>>} */
  async disable(command) {
    if (
      !isRecord(command) || !isNonEmptyText(command.sourceId) ||
      !isNonEmptyText(command.idempotencyKey) ||
      typeof command.expectedRevision !== "number" ||
      !Number.isInteger(command.expectedRevision) ||
      command.expectedRevision < 1
    ) return invalid("command");
    const response = await this.#request(
      "api/source-library/disable",
      "POST",
      command,
    );
    if (!response.ok) return response;
    const value = isRecord(response.value) ? response.value.result : null;
    const source = parseSource(value);
    return source === null ? bad() : { ok: true, value: source };
  }

  /** @param {unknown} command @returns {Promise<Result<{readonly source:LibrarySource,readonly reused:boolean,readonly workflow:WorkflowStartProjection},SourceGatewayFailure>>} */
  async extract(command, material = false) {
    if (!isRecord(command) || Object.hasOwn(command, "ownerId")) {
      return invalid("command");
    }
    const response = await this.#request(
      material ? "api/source-library/url-material" : "api/source-library/extract",
      "POST",
      command,
    );
    if (!response.ok) return response;
    if (!isRecord(response.value)) return bad();
    const value = response.value.result;
    if (!isRecord(value) || typeof value.reused !== "boolean") return bad();
    const source = parseSource(value.source);
    const workflow = parseWorkflowStart(response.value.workflow);
    if (source === null || workflow === null) return bad();
    return { ok: true, value: { source, reused: value.reused, workflow } };
  }

  /** @param {unknown} command @returns {Promise<Result<{ readonly source: LibrarySource, readonly runId: string, readonly reused: boolean }, SourceGatewayFailure>>} */
  async createPrivateDocument(command) {
    if (!isRecord(command) || Object.hasOwn(command, "ownerId") || !isNonEmptyText(command.title) || !isNonEmptyText(command.fileName) || !isNonEmptyText(command.idempotencyKey)) return invalid("command");
    const response = await this.#request("api/source-library/private-documents", "POST", command);
    if (!response.ok) return response;
    const value = isRecord(response.value) ? response.value.result : null;
    if (!isRecord(value) || !isNonEmptyText(value.runId) || typeof value.reused !== "boolean" || !isRecord(value.source) || value.source.origin !== "private-document") return bad();
    const source = parseSource(value.source);
    if (source === null) return bad();
    const url = new URL(sourceHref(source.canonicalUrl), this.#base);
    if (url.origin !== this.#base.origin || !url.pathname.startsWith("/api/private-documents/")) return bad();
    return { ok: true, value: freeze({ source, runId: value.runId, reused: value.reused }) };
  }

  /** @param {{sourceId:string,runId:string,expectedRevision:number,expectedTitle:string,title:string,idempotencyKey:string}} command @returns {Promise<Result<{readonly sourceId:string,readonly runId:string,readonly title:string,readonly revision:number,readonly reused:boolean},SourceGatewayFailure>>} */
  async rename(command) {
    if (!isRecord(command) || Object.hasOwn(command, "ownerId") || !isNonEmptyText(command.sourceId) || !isNonEmptyText(command.runId) || !Number.isSafeInteger(command.expectedRevision) || command.expectedRevision < 1 || !isNonEmptyText(command.expectedTitle) || !isNonEmptyText(command.title) || command.title.trim().length > 300 || !isNonEmptyText(command.idempotencyKey)) return invalid("rename");
    const response = await this.#request("api/source-library/rename", "POST", command);
    if (!response.ok) return response;
    const value = isRecord(response.value) ? response.value.result : null;
    if (!isRecord(value) || value.sourceId !== command.sourceId || value.runId !== command.runId || value.title !== command.title.trim() || value.revision !== command.expectedRevision || typeof value.reused !== "boolean") return bad();
    return {ok:true,value:freeze({sourceId:command.sourceId,runId:command.runId,title:command.title.trim(),revision:command.expectedRevision,reused:value.reused})};
  }

  /** @param {{sourceId:string,runId:string}} command @returns {Promise<Result<{readonly source:LibrarySource,readonly runId:string,readonly reason:string},SourceGatewayFailure>>} */
  async uploadContext(command) {
    if (!isRecord(command) || !isNonEmptyText(command.sourceId) || !isNonEmptyText(command.runId)) return invalid("context");
    const response = await this.#request(`api/source-library/upload-context?${new URLSearchParams(command)}`, "GET", null);
    if (!response.ok) return response;
    const value = isRecord(response.value) ? response.value.result : null;
    if (!isRecord(value) || value.runId !== command.runId || !isNonEmptyText(value.reason)) return bad();
    const source = parseSource(value.source);
    if (source === null || source.id !== command.sourceId || source.state !== "active") return bad();
    return { ok: true, value: freeze({source,runId:command.runId,reason:value.reason}) };
  }

  /** @param {unknown} command @returns {Promise<Result<{ readonly materialId: string, readonly runId: string }, SourceGatewayFailure>>} */
  async uploadWorkflowMaterial(command) {
    if (!isRecord(command) || Object.hasOwn(command, "ownerId") || !isNonEmptyText(command.runId) || !isNonEmptyText(command.sourceId) || !Number.isSafeInteger(/** @type {number} */ (command.sourceRevision)) || /** @type {number} */ (command.sourceRevision) < 1 || !isPublicHttpsUrl(command.sourceUrl) || !isNonEmptyText(command.mediaType) || !isNonEmptyText(command.fileName) || !isNonEmptyText(command.idempotencyKey) || (command.mode !== undefined && command.mode !== "text" && command.mode !== "image")) return invalid("command");
    const mode = command.mode ?? "text";
    let response;
    if (command.file instanceof Blob) {
      const form = new FormData();
      for (const [key, value] of Object.entries({
        runId: command.runId,
        sourceId: command.sourceId,
        sourceRevision: String(command.sourceRevision),
        sourceUrl: command.sourceUrl,
        mediaType: command.mediaType,
        fileName: command.fileName,
        mode,
        idempotencyKey: command.idempotencyKey,
      })) form.set(key, value);
      form.set("file", command.file, command.fileName);
      response = await this.#request("api/knowledge-workflows/material", "POST", form);
    } else if (typeof command.content === "string") {
      response = await this.#request("api/knowledge-workflows/material", "POST", { runId: command.runId, sourceId: command.sourceId, sourceRevision: command.sourceRevision, sourceUrl: command.sourceUrl, mediaType: command.mediaType, fileName: command.fileName, mode, idempotencyKey: command.idempotencyKey, content: command.content });
    } else return invalid("content");
    if (!response.ok) return response;
    const value = isRecord(response.value) ? response.value.result : null;
    if (!isRecord(value) || value.status !== "attached" || !isNonEmptyText(value.materialId) || !isNonEmptyText(value.runId) || typeof value.reused !== "boolean") return bad();
    return { ok: true, value: freeze({ materialId: value.materialId, runId: value.runId }) };
  }

  /** @param {string} sourceId @returns {Promise<Result<WorkflowSourceStatus, SourceGatewayFailure>>} */
  async workflowStatus(sourceId) {
    if (!isNonEmptyText(sourceId)) return invalid("sourceId");
    const response = await this.#request(`api/knowledge-workflows/source-status?sourceId=${encodeURIComponent(sourceId)}`, "GET", null);
    if (!response.ok) return response;
    const value = isRecord(response.value) ? response.value.result : null;
    const parsed = parseWorkflowSourceStatus(value);
    return parsed.ok && parsed.value.sourceId !== sourceId ? bad() : parsed;
  }

  /** @param {{ readonly runId: string, readonly expectedRevision: number, readonly idempotencyKey: string, readonly quizzes?:boolean }} command @returns {Promise<Result<WorkflowRunStatus, SourceGatewayFailure>>} */
  async retryWorkflow(command) {return this.#controlWorkflow(command,command.quizzes?"retry-quizzes":"resume");}

  /** @param {{readonly runId:string,readonly expectedRevision:number,readonly idempotencyKey:string}} command */
  async cancelWorkflow(command) {return this.#controlWorkflow(command,"abandon");}

  /** @param {{readonly runId:string,readonly expectedRevision:number,readonly idempotencyKey:string}} command */
  async dismissWorkflowFailures(command) {return this.#controlWorkflow(command,"dismiss-failures");}

  /** @param {{readonly runId:string,readonly expectedRevision:number,readonly idempotencyKey:string}} command @param {"resume"|"abandon"|"retry-quizzes"|"dismiss-failures"} action @returns {Promise<Result<WorkflowRunStatus, SourceGatewayFailure>>} */
  async #controlWorkflow(command,action) {
    if (!isRecord(command) || !isNonEmptyText(command.runId) || !Number.isSafeInteger(command.expectedRevision) || command.expectedRevision < 1 || !isNonEmptyText(command.idempotencyKey)) return invalid("command");
    const response = await this.#request("api/knowledge-workflows/control", "POST", { runId: command.runId, expectedRevision: command.expectedRevision, action, idempotencyKey: command.idempotencyKey });
    if (!response.ok) return response;
    const value = isRecord(response.value) ? response.value.result : null;
    const run = parseWorkflowRunStatus(value);
    return run === null || run.runId !== command.runId ? bad() : { ok: true, value: run };
  }

  /** @param {readonly string[]} canonicalIdentities @returns {Promise<Result<readonly string[], SourceGatewayFailure>>} */
  async suppressed(canonicalIdentities) {
    if (
      !Array.isArray(canonicalIdentities) || canonicalIdentities.length < 1 ||
      canonicalIdentities.length > 50 ||
      canonicalIdentities.some((value) => !isNonEmptyText(value))
    ) return invalid("canonicalIdentities");
    const response = await this.#request(
      "api/source-library/suppressions/check",
      "POST",
      { canonicalIdentities },
    );
    if (!response.ok) return response;
    const values = isRecord(response.value) ? response.value.result : null;
    if (
      !Array.isArray(values) || values.some((value) => !isNonEmptyText(value))
    ) return bad();
    return { ok: true, value: freeze(/** @type {string[]} */ ([...values])) };
  }

  /** @param {readonly string[]} sourceIds @returns {Promise<Result<readonly string[], SourceGatewayFailure>>} */
  async active(sourceIds) {
    if (
      !Array.isArray(sourceIds) || sourceIds.length < 1 ||
      sourceIds.length > 50 ||
      sourceIds.some((value) => !isNonEmptyText(value))
    ) return invalid("sourceIds");
    const requested = new Set(sourceIds);
    const response = await this.#request(
      "api/source-library/active/check",
      "POST",
      { sourceIds },
    );
    if (!response.ok) return response;
    const values = isRecord(response.value) ? response.value.result : null;
    if (
      !Array.isArray(values) ||
      values.some((value) => !isNonEmptyText(value) || !requested.has(value))
    ) return bad();
    return {
      ok: true,
      value: freeze(/** @type {string[]} */ ([...new Set(values)])),
    };
  }

  /** @param {string} path @param {"GET" | "POST"} method @param {unknown | FormData} body @returns {Promise<Result<unknown, SourceGatewayFailure>>} */
  async #request(path, method, body) {
    const controller = new AbortController();
    /** @type {ReturnType<typeof setTimeout>|undefined} */ let timeout;
    const deadline=new Promise((resolve)=>{timeout=setTimeout(()=>{controller.abort();resolve(/** @type {Result<never,SourceGatewayFailure>} */({ok:false,error:{kind:"SourceGatewayTimedOut"}}));},this.#timeoutMs);});
    /** @returns {Promise<Result<unknown,SourceGatewayFailure>>} */
    const work=async()=>{
    const multipart = body instanceof FormData;
    try {
      const response = await (0, this.#fetch)(new URL(path, this.#base), {
        method, credentials: "same-origin",
        headers: {accept:"application/json",...(body === null || multipart ? {} : {"content-type":"application/json"})},
        body:body === null ? null : multipart ? body : JSON.stringify(body),cache:"no-store",signal:controller.signal,
      });
      if (controller.signal.aborted) return {ok:false,error:{kind:"SourceGatewayTimedOut"}};
      if (response.status === 401) return {ok:false,error:{kind:"SourceGatewayUnauthenticated"}};
      if (response.status === 403) return {ok:false,error:{kind:"SourceGatewayUnauthorized"}};
      /** @type {unknown} */ const document = await response.json();
      if (controller.signal.aborted) return {ok:false,error:{kind:"SourceGatewayTimedOut"}};
      if (!response.ok) return isRecord(document) && isNonEmptyText(document.error)
        ? {ok:false,error:{kind:"SourceGatewayRejected",failureKind:document.error}} : bad();
      return {ok:true,value:document};
    } catch(error) {
      if (controller.signal.aborted) return {ok:false,error:{kind:"SourceGatewayTimedOut"}};
      if (error instanceof SyntaxError) return bad();
      if (error instanceof TypeError) return {ok:false,error:{kind:"SourceGatewayUnavailable"}};
      throw error;
    }
    };
    try {return /** @type {Result<unknown,SourceGatewayFailure>} */(await Promise.race([work(),deadline]));}
    finally {if(timeout!==undefined)clearTimeout(timeout);}
  }

}

/** @param {unknown} value @param {unknown} ownerId @returns {Result<SourceCatalogPage, SourceGatewayFailure>} */
function sourcePage(value, ownerId) {
  if (
    !isRecord(value) || !Array.isArray(value.items) ||
    !Array.isArray(value.interestAreas) ||
    (ownerId !== undefined && !isNonEmptyText(ownerId)) ||
    (value.nextCursor !== null && typeof value.nextCursor !== "string")
  ) return bad();
  /** @type {LibrarySource[]} */ const items = [];
  for (const candidate of value.items) {
    const source = parseSource(candidate);
    if (source === null || source.state !== "active" || (ownerId !== undefined && source.ownerId !== ownerId)) return bad();
    items.push(source);
  }
  /** @type {SourceInterestArea[]} */ const interestAreas = [];
  for (const candidate of value.interestAreas) {
    if (
      !isRecord(candidate) || !isNonEmptyText(candidate.id) ||
      (ownerId !== undefined && candidate.ownerId !== ownerId) ||
      !isNonEmptyText(candidate.ownerId) || !isNonEmptyText(candidate.title) ||
      !isNonEmptyText(candidate.provenance)
    ) return bad();
    interestAreas.push(
      freeze({
        id: candidate.id,
        ownerId: candidate.ownerId,
        title: candidate.title,
        provenance: candidate.provenance,
      }),
    );
  }
  return {
    ok: true,
    value: freeze({
      items: freeze(items),
      interestAreas: freeze(interestAreas),
      nextCursor: value.nextCursor,
    }),
  };
}

/** @param {unknown} value @returns {LibrarySource | null} */
function parseSource(value) {
  if (
    !isRecord(value) || ![value.id, value.ownerId, value.title].every(isNonEmptyText) ||
    (value.primarySubject != null && !isSubjectId(value.primarySubject)) ||
    (value.sourceTopic != null && !isNonEmptyText(value.sourceTopic)) ||
    !isPublicHttpsUrl(value.submittedUrl) || !isPublicHttpsUrl(value.canonicalUrl) ||
    typeof value.description !== "string" || !isRecord(value.adapter) ||
    ![value.adapter.id, value.adapter.version, value.adapter.granularity].every(isNonEmptyText) ||
    !Array.isArray(value.adapter.capabilities) ||
    !value.adapter.capabilities.every(isNonEmptyText) ||
    !Array.isArray(value.interestAreaIds) ||
    !value.interestAreaIds.every(isNonEmptyText) ||
    !Array.isArray(value.identityEvidence) ||
    (value.state !== "active" && value.state !== "disabled") ||
    !isIsoDateTime(value.approvedAt) || !isIsoDateTime(value.updatedAt) ||
    typeof value.revision !== "number" || !Number.isInteger(value.revision) ||
    value.revision < 1
  ) return null;
  return freeze(
    /** @type {LibrarySource} */ ({
      ...value,
      adapter: freeze({
        ...value.adapter,
        capabilities: freeze([...value.adapter.capabilities]),
      }),
      interestAreaIds: freeze([...value.interestAreaIds]),
      identityEvidence: freeze([...value.identityEvidence]),
    }),
  );
}

/** @param {unknown} value @returns {KnowledgeSearchHit | null} */
// Knowledge citations may include section fragments; canonical source identities may not.
function parseKnowledgeSearchHit(value) {
  if (!isRecord(value)) return null;
  const knowledge = value.knowledge;
  if (
    typeof value.score !== "number" ||
    !Number.isFinite(value.score) ||
    (value.matchedBy !== "exact" && value.matchedBy !== "semantic" &&
      value.matchedBy !== "combined") || !isRecord(knowledge) ||
    !isNonEmptyText(knowledge.knowledgeId) ||
    !isNonEmptyText(knowledge.sourceId) ||
    !isNonEmptyText(knowledge.sourceTitle) ||
    !isNonEmptyText(knowledge.summary) ||
    !isNonEmptyText(knowledge.sourceUrl) ||
    !isPublicHttpsUrl(knowledge.sourceUrl.split("#")[0]) ||
    !Array.isArray(knowledge.evidenceAnchorIds) ||
    !knowledge.evidenceAnchorIds.every(isNonEmptyText) ||
    typeof knowledge.questionLocked !== "boolean"
  ) return null;
  return freeze({
    knowledge: freeze({
      knowledgeId: knowledge.knowledgeId,
      sourceId: knowledge.sourceId,
      sourceTitle: knowledge.sourceTitle,
      summary: knowledge.summary,
      sourceUrl: knowledge.sourceUrl,
      evidenceAnchorIds: freeze([...knowledge.evidenceAnchorIds]),
      questionLocked: knowledge.questionLocked,
    }),
    score: value.score,
    matchedBy: value.matchedBy,
  });
}

/** @param {unknown} value @returns {WorkflowStartProjection | null} */
function parseWorkflowStart(value) {
  return isRecord(value) && isNonEmptyText(value.runId) && typeof value.reused === "boolean"
    ? freeze({ runId: value.runId })
    : null;
}

/** @param {unknown} value @returns {WorkflowRunStatus | null} */
function parseWorkflowRunStatus(value) {
  if (!isRecord(value) || !isNonEmptyText(value.runId) || !isNonEmptyText(value.state) || typeof value.revision !== "number" || !Number.isSafeInteger(value.revision) || value.revision < 1 || !isRecord(value.counts)) return null;
  const { extractionStartedAt, extractionDeadlineAt, elapsedMs, remainingMs, decisionRequired, failureKind } = value;
  const counts = value.counts;
  if (![counts.pages, counts.knowledgePoints, counts.acceptedQuizzes, counts.pendingQuizzes].every((count) => typeof count === "number" && Number.isSafeInteger(count) && count >= 0)) return null;
  if ((extractionStartedAt !== null && !isIsoDateTime(extractionStartedAt)) || (extractionDeadlineAt !== null && !isIsoDateTime(extractionDeadlineAt)) || (elapsedMs !== null && (typeof elapsedMs !== "number" || !Number.isFinite(elapsedMs) || elapsedMs < 0)) || (remainingMs !== null && (typeof remainingMs !== "number" || !Number.isFinite(remainingMs) || remainingMs < 0)) || (decisionRequired !== null && !isNonEmptyText(decisionRequired)) || (failureKind !== null && !isNonEmptyText(failureKind))) return null;
  const pages = /** @type {number} */ (counts.pages);
  const knowledgePoints = /** @type {number} */ (counts.knowledgePoints);
  const acceptedQuizzes = /** @type {number} */ (counts.acceptedQuizzes);
  const pendingQuizzes = /** @type {number} */ (counts.pendingQuizzes);
  const robotsEvidence = value.robotsEvidence == null ? null : parseWorkflowRobotsEvidence(value.robotsEvidence);
  if (value.robotsEvidence != null && robotsEvidence === null) return null;
  const progress = value.progress === undefined ? undefined : parseWorkflowProgress(value.progress);
  if (progress === null) return null;
  return freeze({ runId: value.runId, state: value.state, revision: value.revision, counts: freeze({ pages, knowledgePoints, acceptedQuizzes, pendingQuizzes }), extractionStartedAt, extractionDeadlineAt, elapsedMs, remainingMs, decisionRequired, failureKind, robotsEvidence, ...(progress === undefined ? {} : {progress}) });
}

/** @param {unknown} value @returns {WorkflowRobotsEvidence | null} */
function parseWorkflowRobotsEvidence(value) {
  if (!isRecord(value) || !isNonEmptyText(value.robotsUrl) || !isPublicHttpsUrl(value.robotsUrl) || !isNonEmptyText(value.targetUrl) || !isPublicHttpsUrl(value.targetUrl) || typeof value.httpStatus !== "number" || !Number.isSafeInteger(value.httpStatus) || !(value.httpStatus === 0 || value.httpStatus >= 100 && value.httpStatus <= 599) || (value.availability !== "present" && value.availability !== "absent" && value.availability !== "unavailable") || typeof value.content !== "string" || value.content.length > 262_144 || (value.availability === "absent" ? value.content !== "" || (value.httpStatus !== 404 && value.httpStatus !== 410) : value.availability === "unavailable" ? value.content !== "" && (value.httpStatus < 200 || value.httpStatus > 299) : value.httpStatus < 200 || value.httpStatus > 299) || !isIsoDateTime(value.checkedAt) || (value.matchedRule !== null && !isNonEmptyText(value.matchedRule))) return null;
  return freeze({ robotsUrl: value.robotsUrl, targetUrl: value.targetUrl, httpStatus: value.httpStatus, availability: value.availability, content: value.content, checkedAt: value.checkedAt, matchedRule: value.matchedRule });
}

/** @param {unknown} value @returns {Result<WorkflowSourceStatus, SourceGatewayFailure>} */
function parseWorkflowSourceStatus(value) {
  if (!isRecord(value) || !isNonEmptyText(value.sourceId) || (value.reasonCode !== null && !isNonEmptyText(value.reasonCode)) || (value.message !== null && !isNonEmptyText(value.message))) return bad();
  const run = value.run === null ? null : parseWorkflowRunStatus(value.run);
  return value.run !== null && run === null ? bad() : { ok: true, value: freeze({ sourceId: value.sourceId, run, reasonCode: value.reasonCode, message: value.message }) };
}

/** @returns {Result<never, SourceGatewayFailure>} */
function bad() {
  return { ok: false, error: { kind: "SourceGatewayResponseInvalid" } };
}
/** @param {string} field @returns {Result<never, SourceGatewayFailure>} */
function invalid(field) {
  return { ok: false, error: { kind: "SourceGatewayCommandInvalid", field } };
}

export {};
