// @ts-check

import {
  countProcessingWorkflowStatuses,
  SourceLibraryGatewayClient,
} from "../features/source-library/gateway.js";
import { LearningBatchGatewayClient } from "../features/learning-generation/batches-gateway.js";
import { renderLibraryRoute, renderProcessingStatus, librarySourceSubjects } from "../routes/library.js";
import { isSubjectId } from "../features/knowledge-subjects/public.js";
import { BUNDLE_TYPE, packImageBundle } from "../features/knowledge-workflows/image-upload.js";
import { renderPdfPageImages } from "./pdf-image-pages.js";
import { URL_CAPTURE_TYPE } from "../features/knowledge-workflows/url-capture.js";

/** @import { LibrarySource, SourceInterestArea, SourceSearchScope } from "../features/source-library/contracts.js" */
/** @import { WorkflowSourceStatus } from "../features/source-library/gateway.js" */

import { loadOptions, saveOptions } from "../features/experience/options.js";
const freeze = Object.freeze;
/** @param {unknown} value @returns {value is {searchScope:SourceSearchScope,externalProcessingAllowed:boolean}} */
function validSearchOptions(value) {
  return typeof value === "object" && value !== null && "searchScope" in value && (value.searchScope === "knowledge" || value.searchScope === "sources") && "externalProcessingAllowed" in value && typeof value.externalProcessingAllowed === "boolean";
}
const WORKFLOW_STATUS_REFRESH_MS = 60_000;

/** @typedef {{ readonly observe: (element: Element) => void, readonly disconnect: () => void }} PageObserver */
/** @typedef {{ readonly batchId: string, readonly learningDay: string, readonly status: "open" | "completed", readonly itemIds: readonly string[], readonly revision: number, readonly createdAt: string, readonly completedAt: string | null }} LibraryBatchModel */
/** @typedef {{ readonly knowledgeId: string, readonly sourceId: string, readonly summary: string, readonly questionLocked: boolean, readonly primarySubject: string|null, readonly sourceTopic: string|null }} LibraryKnowledgeCard */
/** @typedef {{ readonly knowledgeId: string, readonly sourceId: string, readonly sourceTitle: string, readonly summary: string, readonly sourceUrl: string, readonly evidenceAnchorIds: readonly string[], readonly questionLocked: boolean, readonly score: number, readonly matchedBy: "exact" | "semantic" | "combined" }} LibraryKnowledgeSearchCard */

/**
 * @param {{
 *   readonly fetch: typeof fetch,
 *   readonly storage?: Pick<Storage, "getItem"|"setItem">,
 *   readonly gatewayBaseUrl: string,
 *   readonly escapeHtml: (value: string) => string,
 *   readonly formatDate: (value: string) => string,
 *   readonly createId: () => string,
 *   readonly confirmDisable: (source: LibrarySource) => boolean,
 *   readonly confirmUpload?: (message:string,sourceUrl?:string)=>boolean,
 *   readonly navigateToUpload?: (hash:string,prefill?:import("../features/uploads/page.js").UploadPrefill)=>void,
 *   readonly confirmRetryFailed?: (count:number,quizzes?:boolean) => boolean,
 *   readonly confirmCancel?: (source: LibrarySource) => boolean,
 *   readonly createObserver: (load: () => void) => PageObserver | null,
 *   readonly schedule: (callback: () => void, delayMs: number) => number,
 *   readonly cancel: (handle: number) => void,
 *   readonly onNotice: (message: string) => void,
 *   readonly onError: (message: string) => void,
 *   readonly rerender: () => void
 * }} dependencies
 */
export function createLibraryPage(dependencies) {
  if (
    typeof dependencies.fetch !== "function" ||
    !URL.canParse(dependencies.gatewayBaseUrl) ||
    typeof dependencies.escapeHtml !== "function" ||
    typeof dependencies.formatDate !== "function" ||
    typeof dependencies.createId !== "function" ||
    typeof dependencies.confirmDisable !== "function" ||
    typeof dependencies.createObserver !== "function" ||
    typeof dependencies.schedule !== "function" ||
    typeof dependencies.cancel !== "function" ||
    typeof dependencies.onNotice !== "function" ||
    typeof dependencies.onError !== "function" ||
    typeof dependencies.rerender !== "function"
  ) {
    throw new TypeError("LibraryDependenciesInvalid");
  }
  const {
    cancel,
    confirmDisable,
    createId,
    createObserver,
    escapeHtml,
    formatDate,
    onError,
    onNotice,
    rerender,
    schedule,
  } = dependencies;
  const gateway = new SourceLibraryGatewayClient({
    fetch: dependencies.fetch,
    baseUrl: dependencies.gatewayBaseUrl,
    timeoutMs: 15_000,
  });
  const learningGateway = new LearningBatchGatewayClient({
    fetch: dependencies.fetch,
    baseUrl: dependencies.gatewayBaseUrl,
    timeoutMs: 15_000,
  });
  /** @type {"loading" | "success" | "empty" | "error" | "offline"} */ let state =
    "loading";
  /** @type {LibrarySource[]} */ let items = [];
  /** @type {string | null} */ let nextCursor = null;
  /** @type {string} */ let query = "";
  /** @type {string} */ let subject = "all";
  try {
    const stored = dependencies.storage?.getItem("resonance-library-subject");
    if (stored === "all" || stored === "unclassified" || isSubjectId(stored)) subject = stored;
    else if (stored !== null && stored !== undefined) onError(libraryCopy(0));
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    onError(libraryCopy(1));
  }
  const savedOptions = loadOptions(dependencies.storage, "resonance-library-search-options", validSearchOptions, onError);
  /** @type {SourceSearchScope} */ let searchScope = savedOptions?.searchScope ?? "knowledge";
  let externalProcessingAllowed = savedOptions?.externalProcessingAllowed ?? false;
  /** @type {string | null} */ let message = null;
  /** @type {string | null} */ let pendingSourceId = null;
  /** @type {LibraryKnowledgeCard[]} */ let knowledge = [];
  /** @type {LibraryKnowledgeSearchCard[]} */ let knowledgeSearchResults = [];
  /** @type {WorkflowSourceStatus[]} */ let workflowStatuses = [];
  /** @type {Set<string>} */const cancelledKnowledgeIds=new Set();
  /** @type {Map<string,Parameters<SourceLibraryGatewayClient["cancelWorkflow"]>[0]>} */ const cancellationRetries=new Map();
  const trackedSourceIds = new Set(), promptedFailures = new Set();
  let uploading = false;
  let statusDiscoveryPending = false;
  let statusUnavailable = false;
  let statusRetryAllowed = true;
  /** @type {string|null} */ let statusDiscoveryCursor = null;
  /** @type {string | null} */ let pendingKnowledgeId = null;
  /** @type {Promise<void> | null} */ let read = null;
  /** @type {Promise<void> | null} */ let knowledgeRead = null;
  /** @type {Promise<void> | null} */ let workflowStatusRead = null;
  /** @type {number} */ let workflowStatusReadGeneration = -1;
  /** @type {number | null} */ let workflowStatusRefreshHandle = null;
  /** @type {number} */ let workflowStatusGeneration = 0;
  /** @type {PageObserver | null} */ let observer = null;
  let disposed=false;
  /** @type {string|null} */let pendingFocusSourceId=null;
  /** @type {number|null} */let focusHandle=null;

  const collection = () =>
    freeze({
      state,
      items: freeze([...items]),
      nextCursor,
      query,
      subject,
      searchScope,
      externalProcessingAllowed,
      pendingSourceId,
      message,
    });

  async function load(reset = true) {
    if(disposed)return;
    if (read !== null) return await read;
    stopWorkflowStatusPolling();
    read = (async () => {
      if (reset) {
        state = "loading";
        items = [];
        knowledge = [];
        nextCursor = null;
        knowledgeSearchResults = [];
        message = null;
        rerender();
      } else state = "loading";
      const result = await gateway.browse({
        limit: 20,
        cursor: reset ? null : nextCursor,
      });
      if (!result.ok) {
        setFailure(result.error, !reset && items.length > 0);
        statusUnavailable = true;
        statusDiscoveryPending = reset;
        recordStatusFailure(result.error);
        if (statusRetryAllowed) scheduleWorkflowStatusRefresh(workflowStatusGeneration);
        return;
      }
      items = reset
        ? [...result.value.items]
        : merge(items, result.value.items);
      nextCursor = result.value.nextCursor;
      if (reset) { statusDiscoveryCursor = nextCursor; statusDiscoveryPending = false; }
      for (const source of result.value.items) trackedSourceIds.add(source.id);
      state = items.length === 0 ? "empty" : "success";
      message = null;
      rerender();
      await Promise.all([loadKnowledge(), loadWorkflowStatuses(true)]);
    })().finally(() => {
      read = null;
      rerender();
    });
    return await read;
  }

  /** @param {HTMLFormElement | FormData} form */
  async function search(form) {
    if (read !== null) return;
    const data = form instanceof FormData ? form : new FormData(form);
    const rawQuery = data.get("query");
    if (
      typeof rawQuery !== "string"
    ) return;
    query = rawQuery.trim();
    const rawScope = data.get("searchScope");
    searchScope = rawScope === "sources" ? "sources" : "knowledge";
    externalProcessingAllowed = data.get("externalProcessingAllowed") === "on";
    persistSearchOptions();
    if (query === "") return await load(true);
    state = "loading";
    message = null;
    rerender();
    read = (async () => {
      const result = await gateway.search({
        query,
        scope: searchScope,
        limit: 50,
        mode: externalProcessingAllowed ? "combined" : "keyword",
        externalProcessingAllowed,
      });
      if (!result.ok) {
        return setFailure(result.error);
      }
      if (searchScope === "knowledge") {
        knowledgeSearchResults = result.value.map((hit) => {
          if (!("knowledge" in hit)) {
            throw new TypeError(libraryCopy(2));
          }
          return {
            ...hit.knowledge,
            score: hit.score,
            matchedBy: hit.matchedBy,
          };
        });
        items = [];
      } else {
        knowledgeSearchResults = [];
        items = result.value.map((hit) => {
          if (!("source" in hit)) {
            throw new TypeError("Source search response is invalid.");
          }
          return hit.source;
        });
      }
      nextCursor = null;
      state = searchScope === "knowledge"
        ? knowledgeSearchResults.length === 0 ? "empty" : "success"
        : items.length === 0
        ? "empty"
        : "success";
      if (searchScope === "sources") {
        for (const source of items) trackedSourceIds.add(source.id);
        knowledge = []; await Promise.all([loadKnowledge(), loadWorkflowStatuses(true)]);
      }
    })().finally(() => {
      read = null;
      rerender();
    });
    await read;
  }

  /** @param {boolean} [force] */
  async function loadKnowledge(force = false) {
    if (knowledgeRead !== null) {await knowledgeRead;if(!force)return;}
    knowledgeRead = (async () => {
      const result = await learningGateway.listKnowledge();
      if (!result.ok) {
        onError(friendlyLearning(result.error));
        return;
      }
      knowledge = result.value.items.filter(card=>!cancelledKnowledgeIds.has(card.knowledgeId)).map((card) => ({
        knowledgeId: card.knowledgeId,
        sourceId: card.sourceId,
        summary: card.summary,
        questionLocked: card.questionLocked,
        primarySubject: card.sourceClassification?.mainSubject ?? null,
        sourceTopic: card.sourceClassification?.topic ?? null,
      }));
    })().finally(() => {
      knowledgeRead = null;
      rerender();
    });
    return await knowledgeRead;
  }

  /** @param {boolean} [refreshAll] */
  async function loadWorkflowStatuses(refreshAll = false) {
    if (workflowStatusRead !== null) {
      const readingGeneration = workflowStatusReadGeneration;
      await workflowStatusRead;
      if (readingGeneration !== workflowStatusGeneration) await loadWorkflowStatuses(true);
      return;
    }
    const generation = workflowStatusGeneration;
    const currentRead = (async () => {
      let failed = false;
      statusRetryAllowed = true;
      const seenCursors = new Set();
      while (statusDiscoveryPending || statusDiscoveryCursor !== null) {
        const cursor = statusDiscoveryPending ? null : statusDiscoveryCursor;
        if (seenCursors.has(cursor)) { failed = true; break; }
        seenCursors.add(cursor);
        const page = await gateway.browse({limit:20,cursor});
        if (generation !== workflowStatusGeneration) return;
        if (!page.ok) { recordStatusFailure(page.error); failed = true; break; }
        for (const source of page.value.items) trackedSourceIds.add(source.id);
        const requested=page.value.items.find(source=>source.id===pendingFocusSourceId);
        if(requested)items=merge(items,[requested]);
        statusDiscoveryPending = false;
        statusDiscoveryCursor = page.value.nextCursor;
      }
      const knownById=new Map(workflowStatuses.map(status=>[status.sourceId,status]));
      const sourceIds=[...trackedSourceIds].filter(sourceId=>{const known=knownById.get(sourceId);return refreshAll||statusUnavailable||known===undefined||countProcessingWorkflowStatuses([known])>0||known.run!=null&&cancellationRetries.has(known.run.runId);});
      const results = await Promise.all(sourceIds.map(sourceId => gateway.workflowStatus(sourceId)));
      if (generation !== workflowStatusGeneration) return;
      const known = new Map(workflowStatuses.map(status => [status.sourceId,status]));
      /** @type {WorkflowSourceStatus[]} */ const failedCompletions=[];
      let completed=false;
      for (const result of results) {
        if (result.ok) {
          const status=result.value;
          if(status.reasonCode==="failed" && known.get(status.sourceId)?.reasonCode!=="failed"){
            const message=status.message??libraryCopy(24);
            if(status.run?.state==="awaiting-upload" && dependencies.confirmUpload){
              if(dependencies.confirmUpload(message,items.find(source=>source.id===status.sourceId)?.canonicalUrl))dependencies.navigateToUpload?.(`#upload?${new URLSearchParams({sourceId:status.sourceId,runId:status.run.runId})}`);
            }else onError(message);
          }
          const previous=known.get(status.sourceId);
          if(status.run?.state==="completed"&&previous&&previous.run?.state!=="completed"){
            completed=true;
            if(status.reasonCode==="partial-failure")failedCompletions.push(status);
            else if(!status.run.failureKind&&status.run.counts.acceptedQuizzes>status.run.counts.pendingQuizzes)onNotice(libraryCopy(26));
          }
          known.set(status.sourceId,status);
        }
        else { recordStatusFailure(result.error); failed = true; }
      }
      workflowStatuses = statusRetryAllowed ? [...known.values()] : [];
      statusUnavailable = failed;
      if(completed)await loadKnowledge(true);
      for(const status of failedCompletions){
        const run=status.run;if(run===null)continue;
        const key=`${run.runId}:${run.revision}`;
        if(promptedFailures.has(key))continue;
        promptedFailures.add(key);
        const quizzes=!!run.progress?.failedQuizItems?.length;
        if(dependencies.confirmRetryFailed?.((quizzes?run.progress?.failedQuizItems:run.progress?.failedItems)?.length??0,quizzes))void retryWorkflow(run.runId,run.revision,false,true,quizzes);
      }
      if (failed) onError("Status unavailable.");
      if (statusRetryAllowed && (failed || countProcessingWorkflowStatuses(workflowStatuses) > 0)) scheduleWorkflowStatusRefresh(generation);
      else cancelWorkflowStatusRefresh();
      rerender();
    })();
    workflowStatusRead = currentRead;
    workflowStatusReadGeneration = generation;
    try { await currentRead; }
    finally {
      if (workflowStatusRead === currentRead) { workflowStatusRead = null; }
    }
  }

  /** @param {import("../features/source-library/gateway.js").SourceGatewayFailure} failure */
  function recordStatusFailure(failure) {
    if (failure.kind === "SourceGatewayUnauthenticated" || failure.kind === "SourceGatewayUnauthorized") {
      trackedSourceIds.clear();
      statusDiscoveryCursor = null;
      statusDiscoveryPending = false;
      workflowStatuses = [];
      statusRetryAllowed = false;
    }
  }

  function cancelWorkflowStatusRefresh() {
    if (workflowStatusRefreshHandle === null) return;
    cancel(workflowStatusRefreshHandle);
    workflowStatusRefreshHandle = null;
  }

  /** @param {number} generation */
  function scheduleWorkflowStatusRefresh(generation) {
    if (
      generation !== workflowStatusGeneration ||
      disposed ||
      workflowStatusRefreshHandle !== null ||
      (!statusRetryAllowed || !statusUnavailable && countProcessingWorkflowStatuses(workflowStatuses) === 0)
    ) return;
    workflowStatusRefreshHandle = schedule(() => {
      workflowStatusRefreshHandle = null;
      if (generation !== workflowStatusGeneration) return;
      void loadWorkflowStatuses();
    }, WORKFLOW_STATUS_REFRESH_MS);
  }

  function stopWorkflowStatusPolling() {
    cancelWorkflowStatusRefresh();
    workflowStatusGeneration += 1;
  }

  /** @param {HTMLButtonElement} button */
  async function disable(button) {
    const sourceId = button.getAttribute("data-library-disable");
    const revision = Number(button.getAttribute("data-source-revision"));
    const source = items.find((candidate) => candidate.id === sourceId);
    if (
      source === undefined || !Number.isInteger(revision) ||
      pendingSourceId !== null || !confirmDisable(source)
    ) return;
    pendingSourceId = source.id;
    stopWorkflowStatusPolling();
    rerender();
    const result = await gateway.disable({
      sourceId: source.id,
      expectedRevision: revision,
      idempotencyKey: `disable:${createId()}`,
    });
    pendingSourceId = null;
    if (!result.ok) {
      onError(friendly(result.error));
    } else {
      removeSource(source.id);
      onNotice(
        libraryCopy(3),
      );
    }
    await loadWorkflowStatuses(true);
    rerender();
  }

  /** @param {string} sourceId */
  function removeSource(sourceId){
    items=items.filter(source=>source.id!==sourceId);
    knowledge=knowledge.filter(point=>point.sourceId!==sourceId);
    knowledgeSearchResults=knowledgeSearchResults.filter(point=>point.sourceId!==sourceId);
    workflowStatuses=workflowStatuses.filter(status=>status.sourceId!==sourceId);
    trackedSourceIds.delete(sourceId);
    state=items.length?"success":"empty";
  }

  /** @param {HTMLButtonElement} button */
  async function removeKnowledge(button) {
    const knowledgeId = button.getAttribute("data-library-knowledge-remove");
    if (
      knowledgeId === null || knowledgeId.trim() === "" ||
      pendingKnowledgeId !== null
    ) return;
    pendingKnowledgeId = knowledgeId;
    rerender();
    const result = await learningGateway.removeKnowledge(
      knowledgeId,
      `knowledge-remove:${createId()}`,
    );
    pendingKnowledgeId = null;
    if (!result.ok) {
      onError(friendlyLearning(result.error));
    } else {
      knowledge = knowledge.filter((candidate) =>
        candidate.knowledgeId !== knowledgeId
      );
      knowledgeSearchResults = knowledgeSearchResults.filter((candidate) =>
        candidate.knowledgeId !== knowledgeId
      );
      onNotice(
        libraryCopy(4),
      );
    }
    rerender();
  }

  /** @param {string|null} runId @param {number} expectedRevision */
  async function dismissFailures(runId,expectedRevision) {
    const status=workflowStatuses.find(candidate=>candidate.run?.runId===runId);
    if(!status?.run||status.run.state!=="completed"||status.reasonCode!=="partial-failure"||pendingSourceId!==null)return;
    pendingSourceId=status.sourceId;
    stopWorkflowStatusPolling();rerender();
    const result=await gateway.dismissWorkflowFailures({runId:status.run.runId,expectedRevision,idempotencyKey:`workflow-dismiss:${createId()}`});
    pendingSourceId=null;
    if(result.ok)onNotice(libraryCopy(27));
    else onError(friendly(result.error));
    await loadWorkflowStatuses(true);
    rerender();
  }

  /** @param {string|null} runId @param {number} expectedRevision @param {boolean} [cancel] @param {boolean} [approved] @param {boolean} [quizzes] */
  async function retryWorkflow(runId, expectedRevision, cancel=false, approved=false, quizzes=false) {
    if (
      runId === null || runId.trim() === "" ||
      !Number.isSafeInteger(expectedRevision) || expectedRevision < 1
    ) return;
    const status = workflowStatuses.find((candidate) =>
      candidate.run?.runId === runId
    );
    if (status?.run == null || pendingSourceId !== null || (cancel ? !cancellationRetries.has(runId) && ["completed","abandoned"].includes(status.run.state) : status.reasonCode!=="retryable-failure" && status.reasonCode!=="partial-failure")) return;
    if(!cancel&&status.reasonCode==="partial-failure"&&!approved&&!dependencies.confirmRetryFailed?.((quizzes?status.run.progress?.failedQuizItems:status.run.progress?.failedItems)?.length??0,quizzes))return;
    const source=items.find(source=>source.id===status.sourceId);
    if(cancel&&(source===undefined||!dependencies.confirmCancel?.(source)))return;
    pendingSourceId=status.sourceId;rerender();
    stopWorkflowStatusPolling();
    const command=cancellationRetries.get(runId) ?? {runId,expectedRevision,idempotencyKey:`workflow-${cancel?"cancel":"retry"}:${createId()}`,quizzes};
    if(cancel)cancellationRetries.set(runId,command);
    const result = await gateway[cancel?"cancelWorkflow":"retryWorkflow"](command);
    if (!result.ok) {
      pendingSourceId=null;
      onError(cancel ? libraryCopy(5) : friendly(result.error));
      await loadWorkflowStatuses(true);
      rerender();
      return;
    }
    if(cancel){
      const removed=new Set(status.run.progress?.knowledgePoints.map(point=>point.knowledgeId)??[]);
      for(const id of removed)cancelledKnowledgeIds.add(id);
      knowledge=knowledge.filter(point=>!removed.has(point.knowledgeId));
      knowledgeSearchResults=knowledgeSearchResults.filter(point=>!removed.has(point.knowledgeId));
      const disabled=await gateway.disable({sourceId:status.sourceId,expectedRevision:source.revision,idempotencyKey:`${command.idempotencyKey}:disable`});
      if(!disabled.ok){
        pendingSourceId=null;
        onError(libraryCopy(5));
        await loadWorkflowStatuses(true);
        rerender();
        return;
      }
      cancellationRetries.delete(runId);
      removeSource(status.sourceId);
    }
    pendingSourceId=null;
    onNotice(
      cancel ? libraryCopy(6) : libraryCopy(7),
    );
    rerender();
    if(cancel)await loadKnowledge(true);
    if(!cancel)trackedSourceIds.add(status.sourceId);
    await loadWorkflowStatuses(true);
  }

  let uploadMessage = "";
  let uploadSucceeded = false;
  /** @param {string} message */
  function uploadFailure(message) {
    uploadMessage = message;
  }

  /** @param {string} sourceId Empty creates a private document. @param {FormData} form @param {import("../features/uploads/page.js").UploadContext|null} [context] */
  async function uploadMaterial(sourceId, form, context = null) {
    if (pendingSourceId !== null) return;
    uploadMessage = "";
    uploadSucceeded = false;
    if (context !== null && (context.source.id !== sourceId || !context.runId || context.source.state !== "active")) return uploadFailure(uploadCopy(0));
    let source = context?.source ?? items.find((candidate) => candidate.id === sourceId);
    const run = context === null ? workflowStatuses.find((status) => status.sourceId === sourceId)?.run : {runId:context.runId,state:"awaiting-upload"};
    if (
      !(form instanceof FormData) ||
      (sourceId !== "" &&
        (source === undefined || run?.state !== "awaiting-upload"))
    ) {
      uploadFailure(
        uploadCopy(1),
      );
      return;
    }
    const files = /** @type {File[]} */ (form.getAll("file").filter((item) => item instanceof File && item.size > 0));
    const file = files[0] ?? null;
    const mode = files.length > 0 && files.every(file => /\.(?:png|jpe?g|webp|gif)$/iu.test(file.name)) || form.get("imageProcessing") === "on" ? "image" : "text";
    if (files.length > 100 || files.reduce((total, item) => total + item.size, 0) > 104_857_600) return uploadFailure(uploadCopy(2));
    const pasted = form.get("content");
    const content = typeof pasted === "string" ? pasted.trim() : "";
    if (content.length > 1_000_000) return uploadFailure(uploadCopy(3));
    if ((file === null) === (content === "")) {
      uploadFailure(uploadCopy(4));
      return;
    }
    if (files.length > 1 && mode !== "image") return uploadFailure(uploadCopy(5));
    const extension = file?.name.split(".").at(-1)?.toLowerCase();
    // Closed upload-format contract; content interpretation belongs to the model.
    const mediaType = extension === "pkpc" && file?.type === URL_CAPTURE_TYPE && typeof form.get("url") === "string" ? URL_CAPTURE_TYPE : file === null || extension === "txt"
      ? "text/plain"
      : extension === "md"
      ? "text/markdown"
      : extension === "pdf"
      ? "application/pdf"
      : extension === "pptx"
      ? "application/vnd.openxmlformats-officedocument.presentationml.presentation"
      : extension === "png"
      ? "image/png"
      : extension === "jpg" || extension === "jpeg"
      ? "image/jpeg"
      : extension === "webp"
      ? "image/webp"
      : extension === "gif"
      ? "image/gif"
      : null;
    if (mediaType === null) {
      uploadFailure(uploadCopy(6));
      return;
    }
    if (mode === "image" && (file === null || mediaType !== "application/pdf" && !mediaType.startsWith("image/") || files.length > 1 && files.some((item) => !/\.(?:png|jpe?g|webp|gif)$/iu.test(item.name)))) return uploadFailure(uploadCopy(7));
    if (mode === "image" && files.some((item) => item.size > 20 * 1024 * 1024 && mediaType !== "application/pdf")) return uploadFailure(uploadCopy(8));
    if (mode === "text" && mediaType.startsWith("image/")) return uploadFailure(uploadCopy(9));
    const titleValue = form.get("title");
    const title = typeof titleValue === "string" && titleValue.trim() !== ""
      ? titleValue.trim()
      : file?.name;
    if (sourceId === "" && !title) {
      return uploadFailure(uploadCopy(10));
    }
    const fileName = file?.name ?? "paste.txt";
    const pageRange = form.get("pageRange") ?? "";
    if (typeof pageRange !== "string" || pageRange.length > 300 || pageRange.trim() !== "" && (mode !== "image" || mediaType !== "application/pdf")) return uploadFailure(uploadCopy(11));
    pendingSourceId = sourceId;
    uploading = true;
    if (source) trackedSourceIds.add(source.id);
    stopWorkflowStatusPolling();
    rerender();
    try {
      let id;
      let uploadFile = file;
      let uploadMediaType = mediaType;
      if (mode === "image" && file !== null && mediaType === "application/pdf") {
        const rendered = await renderPdfPageImages(file, pageRange);
        if (!rendered.ok) return uploadFailure(`PDF image processing failed: ${rendered.error.kind}.`);
        uploadFile = new File([rendered.value], `${file.name}.pkpi`, { type: BUNDLE_TYPE });
        uploadMediaType = BUNDLE_TYPE;
      } else if (mode === "image" && files.length > 1) {
        const types = /** @type {Record<string, string>} */ ({ png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" });
        let pages;
        try { pages = await Promise.all(files.map(async (item, index) => ({ name: item.name, locator: `image:${index + 1}`, mediaType: item.type || types[item.name.split(".").at(-1)?.toLowerCase() ?? ""] || "", bytes: new Uint8Array(await item.arrayBuffer()) }))); }
        catch (error) { return uploadFailure(libraryCopy(8)); }
        const packed = packImageBundle(pages);
        if (!packed.ok) return uploadFailure(`Image batch failed: ${packed.error.kind}.`);
        uploadFile = new File([packed.value], `${file.name}.pkpi`, { type: BUNDLE_TYPE });
        uploadMediaType = BUNDLE_TYPE;
      }
      try {
        const bytes = uploadFile === null
          ? new TextEncoder().encode(content)
          : await uploadFile.arrayBuffer();
        const contentHash = Array.from(
          new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
          (byte) => byte.toString(16).padStart(2, "0"),
        ).join("");
        id = Array.from(
          new Uint8Array(
            await crypto.subtle.digest(
              "SHA-256",
              new TextEncoder().encode(
                JSON.stringify([sourceId, title, fileName, mode, pageRange, contentHash, form.get("url")]),
              ),
            ),
          ),
          (byte) => byte.toString(16).padStart(2, "0"),
        ).join("");
      } catch (error) {
        return uploadFailure(
          libraryCopy(9),
        );
      }
      let runId = run?.runId;
      if (sourceId === "") {
        const url=form.get("url");
        const created = typeof url==="string" ? await gateway.extract({
          title,url,idempotencyKey:`url-material:${id}`,
        },true) : await gateway.createPrivateDocument({title,fileName,idempotencyKey:`private-document:${id}`});
        if (!created.ok) return uploadFailure(friendly(created.error));
        source = created.value.source;
        trackedSourceIds.add(source.id);
        runId = "workflow" in created.value ? created.value.workflow.runId : created.value.runId;
        if (!items.some((item) => item.id === source?.id)) items.push(source);
      }
      if (source === undefined || runId === undefined) {
        return uploadFailure(
          libraryCopy(10),
        );
      }
      const uploaded = await gateway.uploadWorkflowMaterial({
        runId,
        sourceId: source.id,
        sourceRevision: source.revision,
        sourceUrl: source.canonicalUrl,
        mode,
        mediaType: uploadMediaType,
        fileName: uploadFile?.name ?? fileName,
        idempotencyKey: `workflow-material:${runId}:${id}`,
        ...(uploadFile === null ? { content } : { file: uploadFile }),
      });
      if (!uploaded.ok) {
        uploadFailure(friendly(uploaded.error));
        return;
      }
      uploadMessage =
        libraryCopy(11);
      uploadSucceeded = true;
      onNotice(uploadMessage);
      if (!items.some(item => item.id === source.id)) items.push(source);
    } finally {
      pendingSourceId = null;
      uploading = false;
      rerender();
      await loadWorkflowStatuses(true);
    }
  }

  function persistSearchOptions() {
    saveOptions(dependencies.storage, "resonance-library-search-options", {searchScope,externalProcessingAllowed}, onError);
  }

  /** @param {HTMLElement} root */
  function bind(root) {
    observer?.disconnect();
    observer = null;
    if(pendingFocusSourceId!==null){
      const requested=[...root.querySelectorAll("[data-library-source]")].find(element=>element.getAttribute("data-library-source")===pendingFocusSourceId);
      if(requested instanceof HTMLElement){
        if(focusHandle!==null)cancel(focusHandle);
        focusHandle=schedule(()=>{focusHandle=null;if(disposed||!requested.isConnected)return;requested.focus({preventScroll:true});requested.scrollIntoView({block:"center"});pendingFocusSourceId=null;},0);
      }
    }
    root.querySelector("[data-library-subject]")?.addEventListener("change", event => {
      const select = event.currentTarget;
      if (!(select instanceof HTMLSelectElement) || !(select.value === "all" || select.value === "unclassified" || isSubjectId(select.value))) return;
      subject = select.value;
      try { dependencies.storage?.setItem("resonance-library-subject", subject); }
      catch (error) { if (!(error instanceof Error)) throw error; onError(libraryCopy(12)); }
      rerender();
      const restored = root.querySelector("[data-library-subject]");
      if (restored instanceof HTMLElement) restored.focus();
    });
    root.querySelector("[data-library-search]")?.addEventListener("change", event => {
      if (!(event.currentTarget instanceof HTMLFormElement)) return;
      const form = new FormData(event.currentTarget);
      searchScope = form.get("searchScope") === "sources" ? "sources" : "knowledge";
      externalProcessingAllowed = form.get("externalProcessingAllowed") === "on";
      persistSearchOptions();
    });
    root.querySelector("[data-library-search]")?.addEventListener(
      "submit",
      (event) => {
        event.preventDefault();
        if (event.currentTarget instanceof HTMLFormElement) {
          void search(
            event.currentTarget,
          );
        }
      },
    );
    root.querySelector("[data-library-retry]")?.addEventListener(
      "click",
      () => {
        const form = root.querySelector("[data-library-search]");
        void (query && form instanceof HTMLFormElement ? search(form) : load(true));
      },
    );
    root.querySelector("[data-library-load-more]")?.addEventListener(
      "click",
      () => void load(false),
    );
    root.querySelectorAll("[data-library-disable]").forEach((element) =>
      element.addEventListener("click", () => {
        if (typeof element.getAttribute === "function") {
          void disable(/** @type {HTMLButtonElement} */ (element));
        }
      })
    );
    root.querySelectorAll("[data-library-knowledge-remove]").forEach((
      element,
    ) =>
      element.addEventListener("click", () => {
        if (typeof element.getAttribute === "function") {
          void removeKnowledge(/** @type {HTMLButtonElement} */ (element));
        }
      })
    );
    root.querySelectorAll("[data-library-manual-source]").forEach(element=>element.addEventListener("click",()=>{
      const source=items.find(source=>source.id===element.getAttribute("data-library-manual-source"));
      if(source)dependencies.navigateToUpload?.("#upload",{title:source.title,url:source.canonicalUrl,manual:true,reason:libraryCopy(25)});
    }));
    root.querySelectorAll("[data-library-workflow-retry], [data-library-workflow-cancel]").forEach((element) =>
      element.addEventListener("click", () => {
        if (typeof element.getAttribute === "function") {
          const cancel=element.hasAttribute("data-library-workflow-cancel");
          const attribute=cancel?"data-library-workflow-cancel":"data-library-workflow-retry";
          void retryWorkflow(element.getAttribute(attribute),Number(element.getAttribute(`${attribute}-revision`)),cancel,false,element.hasAttribute("data-library-workflow-quiz"));
        }
      })
    );
    root.querySelectorAll("[data-library-workflow-dismiss]").forEach(element=>element.addEventListener("click",()=>{
      void dismissFailures(element.getAttribute("data-library-workflow-dismiss"),Number(element.getAttribute("data-library-workflow-dismiss-revision")));
    }));
    const sentinel = root.querySelector("[data-library-sentinel]");
    if (sentinel !== null && nextCursor !== null && read === null) {
      observer = createObserver(() => void load(false));
      observer?.observe(sentinel);
    }
  }

  /** @param {LibraryBatchModel | Record<string, unknown>} _queue */
  function render(_queue) {
    return renderLibraryRoute({
      cancellationRetries:[...cancellationRetries.keys()],
      collection: collection(),
      knowledge,
      knowledgeSearchResults,
      workflowStatuses,
      escapeHtml,
      formatDate,
    });
  }

  /** @param {import("../features/source-library/gateway.js").SourceGatewayFailure} failure */
  function setFailure(failure, preserveItems = false) {
    if (preserveItems) {
      state = "success";
      nextCursor = null;
      message = `${friendly(failure)} Previously loaded sources remain below.`;
      return;
    }
    state = failure.kind === "SourceGatewayUnavailable" ||
        failure.kind === "SourceGatewayTimedOut"
      ? "offline"
      : "error";
    message = friendly(failure);
  }

  /** @param {string} sourceId @param {string} title */
  function renamed(sourceId, title) {
    items = items.map(source => source.id === sourceId ? freeze({...source,title}) : source);
    knowledgeSearchResults = knowledgeSearchResults.map(point => point.sourceId === sourceId ? {...point,sourceTitle:title} : point);
  }
  /** Open the source's shelf and focus its card, including a reused source on a later page.
   * @param {string} sourceId */
  async function revealSource(sourceId){
    if(disposed||!sourceId.trim())return;
    pendingFocusSourceId=sourceId;query="";
    await load();
    const requested=items.find(source=>source.id===sourceId);
    if(requested){subject=librarySourceSubjects(requested,knowledge)[0];rerender();}
    else{pendingFocusSourceId=null;onError(libraryCopy(13));}
  }
  async function revealProcessing() {
    const active = workflowStatuses.find(status => countProcessingWorkflowStatuses([status]) > 0);
    if (active) {
      await revealSource(active.sourceId);
      subject = "all";
      rerender();
    }
  }
  function dispose(){disposed=true;stopWorkflowStatusPolling();observer?.disconnect();observer=null;if(focusHandle!==null){cancel(focusHandle);focusHandle=null;}pendingFocusSourceId=null;}
  async function resume(){if(!disposed)return;disposed=false;await loadWorkflowStatuses(true);}
  return freeze({ load, search, uploadMaterial, bind, render, renamed, revealSource, revealProcessing, dispose, resume,
    renderProcessingStatus: () => renderProcessingStatus({workflowStatuses,escapeHtml,uploading,unavailable:statusUnavailable}), uploadResult: () => ({ok:uploadSucceeded,message:uploadMessage}) });
}

/** @param {import("../features/source-library/gateway.js").SourceGatewayFailure} failure */
function friendly(failure) {return failureCopy(failure,"source");}

/** @param {import("../features/learning-generation/batches-gateway.js").LearningBatchGatewayFailure} failure */
function friendlyLearning(failure) {return failureCopy(failure,"knowledge");}

/** User copy follows the closed gateway failure contract.
 * @param {{kind:string,failureKind?:string}} failure @param {string} group */
function failureCopy(failure,group){
 const messages=readLibraryCopy().libraryFailureMessages?.[group];
 const kind=failure.kind.endsWith("Rejected")?failure.failureKind:failure.kind;
 return libraryCopy(messages?.[kind??""]??messages?.default);
}

/** @param {readonly LibrarySource[]} current @param {readonly LibrarySource[]} next */
function merge(current, next) {
  const merged = new Map(current.map((source) => [source.id, source]));
  for (const source of next) merged.set(source.id, source);
  return [...merged.values()];
}

export {};

/** Static copy shares the cached application shell. @param {number} index @param {string} [group] */
function uploadCopy(index,group="uploadValidation") {
  const copy = readLibraryCopy()[group]?.[index];
  if (typeof copy !== "string") throw new TypeError("UploadCopyInvalid");
  return copy;
}

/** @param {number} index */
function libraryCopy(index){return uploadCopy(index,"libraryMessages");}

function readLibraryCopy(){
 const content=document.getElementById("app-copy")?.textContent;
 if(!content)throw new TypeError("LibraryCopyUnavailable");
 return JSON.parse(content);
}
