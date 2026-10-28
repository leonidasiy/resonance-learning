import { prepareSubmittedLink } from "../src/features/source-library/submitted-link.js";
import { validateApprovalCommand } from "../src/features/source-library/service.js";
import { validatePublisherDestination } from "./destination-policy.js";
// @ts-check

import { isRecord, validateRssAcquisitionCommand } from "./contracts.js";
import { isWorkflowRobotsEvidence } from "../src/features/knowledge-workflows/workflow.js";
import { parseWorkflowProgress } from '../src/features/knowledge-workflows/progress.js';
import { createDiscoveryRequestLogger } from "./request-logging.js";
import { handleReminderRequest } from "./reminders/http.js";

/** @import { AccessIdentity, Result, RssAcquisitionResult, WorkerFailure } from "./contracts.js" */
/** @import { LibrarySource, SourceCatalogPage, SourceIngestionJob, SourceLibraryFailure, SourceSearchHit, KnowledgeSearchHit, SourceSuppression } from "../src/features/source-library/contracts.js" */
/** @import { RightsApprovalFailure, RightsApprovalResult } from "../src/features/source-library/rights-approval.js" */
/** @import { SourceRightsProfile } from "../src/features/source-library/rights-profile.js" */
/** @import { DiscoveryRequestLogEntry, DiscoveryRequestLogFailure } from "./request-logging.js" */

/**
 * @param {{ readonly allowedOrigin: string, readonly maximumCommandBytes: number, readonly maximumMaterialBytes?: number, readonly maximumBackendOperationMs?: number }} configuration
 * @param {{
 *   readonly authenticate: (request: Request) => Promise<Result<AccessIdentity, WorkerFailure>>,
 *   readonly acquireRss: (command: import("./contracts.js").RssAcquisitionCommand, ownerId: string) => Promise<Result<RssAcquisitionResult, WorkerFailure | { readonly kind: "TranscriptAuthorizationPersistenceFailed" }>>,
 *   readonly centralSearch?: null | {
 *     readonly capabilities: () => readonly { readonly id: string, readonly label: string, readonly resultKind: string, readonly priority: number, readonly enabled: boolean }[],
 *     readonly search: (command: unknown) => Promise<Result<unknown, { readonly kind: string }>>
 *   },
 *   readonly sourceRename?: ReturnType<typeof import("../src/features/source-library/rename.js").createSourceRenameService> | null,
 *   readonly sourceLibrary?: null | {
 *     readonly approve: (command: unknown) => Promise<Result<{ readonly source: LibrarySource, readonly job: SourceIngestionJob | null, readonly reused: boolean }, SourceLibraryFailure>>,
 *     readonly createPrivateDocument?: (command: unknown) => Promise<Result<{ readonly source: LibrarySource, readonly job: SourceIngestionJob | null, readonly reused: boolean }, SourceLibraryFailure>>,
 *     readonly revise: (command: unknown) => Promise<Result<LibrarySource, SourceLibraryFailure>>,
 *     readonly disable: (command: unknown) => Promise<Result<LibrarySource, SourceLibraryFailure>>,
 *     readonly restore: (command: unknown) => Promise<Result<LibrarySource, SourceLibraryFailure>>,
 *     readonly reject: (command: unknown) => Promise<Result<{ readonly suppression: SourceSuppression, readonly reused: boolean }, SourceLibraryFailure>>
 *   },
 *   readonly sourceRightsApproval?: null | {
 *     readonly approve: (command: unknown) => Promise<Result<RightsApprovalResult, RightsApprovalFailure>>
 *   },
 *   readonly sourceCatalog?: null | {
 *     readonly browse: (command: unknown) => Promise<Result<SourceCatalogPage, SourceLibraryFailure>>,
 *     readonly search: (command: unknown) => Promise<Result<unknown, SourceLibraryFailure>>,
 *     readonly suppressed: (command: unknown) => Promise<Result<readonly string[], SourceLibraryFailure>>,
 *     readonly active: (command: unknown) => Promise<Result<readonly string[], SourceLibraryFailure>>
 *   },
 *   readonly sourceClassification?: null | {
 *     readonly updateManual: (command: unknown) => Promise<Result<{ readonly ownerId: string, readonly sourceId: string, readonly sourceRevision: number, readonly mainSubject: string, readonly topic: string, readonly classificationRevision: number }, { readonly kind: string }>>
 *   },
 *   readonly sourceClassificationBackfill?: null | { readonly run: (command: unknown) => Promise<Result<{ readonly ownerId: string, readonly counts: { readonly scanned: number, readonly classified: number, readonly needsReview: number, readonly alreadyProcessed: number, readonly manualPreserved: number } }, { readonly kind: string }>> },
 *   readonly sourceIngestion?: null | { readonly run: (command: unknown) => Promise<Result<{ readonly state: "completed" | "partial", readonly itemsStored: number }, import("../src/features/source-library/ingestion-contracts.js").SourceIngestionFailure>> },
 *   readonly sourceRightsProfileFor?: (canonicalUrl: string) => SourceRightsProfile | null,
 *   readonly knowledgeWorkflow?: null | {
 *     readonly start: (command: unknown) => Promise<Result<{ readonly runId: string, readonly reused: boolean }, { readonly kind: string }>>,
 *     readonly status: (command: unknown) => Promise<Result<unknown, { readonly kind: string }>>,
 *     readonly sourceStatus?: (command: unknown) => Promise<Result<unknown, { readonly kind: string }>>,
 *     readonly control: (command: unknown) => Promise<Result<unknown, { readonly kind: string }>>,
 *     readonly material?: (command: unknown) => Promise<Result<unknown, { readonly kind: string }>>,
 *     readonly rightsApproved?: (command: unknown) => Promise<Result<unknown, { readonly kind: string }>>,
 *     readonly revokeSource?: (command: unknown) => Promise<Result<unknown, { readonly kind: string }>>
 *   },
 *   readonly privateDocumentRead?: null | ReturnType<typeof import("./private-document-read.js").createPrivateDocumentReadService>,
 *   readonly knowledgeWorkflowBackfill?: null | {
 *     readonly run: (command: unknown) => Promise<Result<unknown, { readonly kind: string }>>
 *   },
 *   readonly knowledgeWorkflowReplay?: null | {
 *     readonly run: (command: unknown) => Promise<Result<unknown, { readonly kind: string }>>
 *   },
 *   readonly learningMedia?: null | {
 *     readonly serve: (command: unknown) => Promise<Result<{ readonly bytes: Uint8Array, readonly mediaType: string }, { readonly kind: string }>>
 *   },
 *   readonly learningBatches?: null | {
   *     readonly loadFeed: (ownerId: string, learningDay: string, force?: boolean) => Promise<Result<unknown, { readonly kind: string }>>,
   *     readonly listKnowledge?: (ownerId: string, sourceId?: string | null) => Promise<Result<unknown, { readonly kind: string }>>,
 *     readonly completeFeed: (command: unknown) => Promise<Result<unknown, { readonly kind: string }>>,
 *     readonly loadReview: (ownerId: string, learningDay: string, force?: boolean) => Promise<Result<unknown, { readonly kind: string }>>,
 *     readonly loadProgress?: (ownerId:string, days:number, subject:string|null) => Promise<Result<unknown,{readonly kind:string}>>,
 *     readonly correctClassification?: (command:unknown) => Promise<Result<unknown,{readonly kind:string}>>,
 *     readonly removeReview?: (command: unknown) => Promise<Result<unknown, { readonly kind: string }>>,
 *     readonly replaceReview?: (command: unknown) => Promise<Result<unknown, { readonly kind: string }>>,
 *     readonly skipReview?: (command: unknown) => Promise<Result<unknown, { readonly kind: string }>>,
 *     readonly answerReview: (command: unknown) => Promise<Result<unknown, { readonly kind: string }>>,
 *     readonly setPreference: (command: unknown) => Promise<Result<unknown, { readonly kind: string }>>,
 *     readonly removeKnowledge: (command: unknown) => Promise<Result<unknown, { readonly kind: string }>>,
 *     readonly removeSource?: (command: unknown) => Promise<Result<unknown, { readonly kind: string }>>,
 *     readonly clearGeneratedContent?: (ownerId: string) => Promise<Result<unknown, { readonly kind: string }>>
 *   },
 *   readonly waitUntil?: (promise: Promise<unknown>) => void,
 *   readonly reminders?: ReturnType<typeof import('./reminders/service.js').createReminderService>|null,
 *   readonly urlCapture?: (command:{ownerId:string,url:string})=>Promise<Result<Uint8Array,{kind:string}>>,
 *   readonly manualMaterial?: null | { readonly upload: (command: unknown) => Promise<Result<{ readonly status: "processing-ready", readonly reference: import("../src/features/source-library/ingestion-contracts.js").SourceContentReference, readonly reused: boolean }, import("../src/features/source-library/ingestion-contracts.js").SourceIngestionFailure>> },
 *   readonly wikimediaTimedText?: null | { readonly retrieve: (command: unknown) => Promise<Result<unknown, { readonly kind: string }>> },
 *   readonly learningGeneration?: null | {
 *     readonly status: (command: unknown) => Promise<Result<unknown, { readonly kind: string }>>,
 *     readonly review: { readonly decide: (command: unknown) => Promise<Result<unknown, { readonly kind: string }>>, readonly queue?: (ownerId: string) => Promise<Result<unknown, { readonly kind: string }>>, readonly visible?: (ownerId: string) => Promise<Result<unknown, { readonly kind: string }>> },
 *     readonly revoke: { readonly revoke: (command: unknown) => Promise<Result<unknown, { readonly kind: string }>> }
 *   }
 *   readonly now?: () => string,
 *   readonly requestLogger?: (entry: DiscoveryRequestLogEntry) => Result<null, DiscoveryRequestLogFailure>,
 *   readonly createRequestId?: () => string,
 * }} dependencies
 */
export function createDiscoveryWorker(configuration, dependencies) {
  const maximumBackendOperationMs = configuration.maximumBackendOperationMs ?? 5_000;
  if (
    !URL.canParse(configuration.allowedOrigin) ||
    new URL(configuration.allowedOrigin).origin !==
      configuration.allowedOrigin ||
    !Number.isInteger(configuration.maximumCommandBytes) ||
    configuration.maximumCommandBytes < 1 ||
    !Number.isSafeInteger(maximumBackendOperationMs) ||
    maximumBackendOperationMs < 1 ||
    maximumBackendOperationMs > 60_000 ||
    typeof dependencies.authenticate !== "function" ||
    typeof dependencies.acquireRss !== "function" ||
    (dependencies.centralSearch != null &&
      (typeof dependencies.centralSearch.capabilities !== "function" ||
        typeof dependencies.centralSearch.search !== "function")) ||
    (dependencies.waitUntil !== undefined && typeof dependencies.waitUntil !== "function") ||
    (dependencies.requestLogger !== undefined && typeof dependencies.requestLogger !== "function") ||
    (dependencies.createRequestId !== undefined && typeof dependencies.createRequestId !== "function")
  ) {
    throw new TypeError("Discovery Worker configuration is invalid.");
  }
  /** @type {(entry: DiscoveryRequestLogEntry) => Result<null, DiscoveryRequestLogFailure>} */
  const requestLogger = dependencies.requestLogger ?? createDiscoveryRequestLogger({
    sink: (record) => console.info(JSON.stringify(record)),
    now: () => dependencies.now?.() ?? new Date().toISOString(),
  });
  const createRequestId = dependencies.createRequestId ?? (() => crypto.randomUUID());

  /** @param {Request} request @param {(ownerId: string) => void} onAuthenticated @param {(entry: Omit<DiscoveryRequestLogEntry, "correlationId" | "route" | "method">) => Result<null, { readonly kind: "DiscoveryRequestLoggingFailed", readonly causeKind: "DiscoveryRequestLogEntryInvalid" | "DiscoveryRequestLogTimestampInvalid" | "DiscoveryRequestLoggerResultInvalid" | "DiscoveryRequestLoggerThrew" }>} emit */
  async function handleRequest(request, onAuthenticated, emit) {
      let authenticated;
      try {
        authenticated = await dependencies.authenticate(request);
      } catch (error) {
        if (!(error instanceof Error)) throw error;
        const logged = emit({ event: "request-auth-failure", status: 503, failureKind: "AuthenticationDependencyFailed" });
        if (!logged.ok) return failureResponse(logged.error);
        return failureResponse({ kind: "DiscoveryAuthenticationFailed" });
      }
      if (!isAuthenticationResult(authenticated)) {
        const logged = emit({ event: "request-auth-failure", status: 503, failureKind: "AuthenticationResultInvalid" });
        if (!logged.ok) return failureResponse(logged.error);
        return failureResponse({ kind: "DiscoveryAuthenticationFailed" });
      }
      if (!authenticated.ok) {
        const status = authenticated.error.kind === "DiscoveryClientUnauthenticated" || authenticated.error.kind === "DiscoveryAccessTokenMissing" || authenticated.error.kind === "DiscoveryAccessTokenInvalid" ? 401 : 403;
        const logged = emit({ event: "request-auth-failure", status, failureKind: authenticated.error.kind });
        if (!logged.ok) return failureResponse(logged.error);
        return failureResponse(authenticated.error);
      }
      onAuthenticated(authenticated.value.ownerId);
      const logged = emit({ event: "request-authenticated", ownerId: authenticated.value.ownerId });
      if (!logged.ok) return failureResponse(logged.error);
      const url = new URL(request.url);
      const reminders = url.pathname === '/api/reminders';
      const rssPath = url.pathname === "/api/discovery/rss";
      const centralSearchPath = url.pathname === "/api/discovery/search";
      const centralCapabilitiesPath =
        url.pathname === "/api/discovery/search/capabilities";
      const sourceUploadContext = url.pathname === "/api/source-library/upload-context";
      const sourceRename = url.pathname === "/api/source-library/rename";
      const urlCapture = url.pathname === "/api/source-library/url-capture";
      const urlMaterial = url.pathname === "/api/source-library/url-material";
      const sourceExtraction = urlMaterial || url.pathname === "/api/source-library/extract";
      const sourceAction = sourceExtraction ? "approve" : sourceLibraryAction(url.pathname);
      const privateDocumentCreate = url.pathname === "/api/source-library/private-documents";
      const privateDocumentId = url.pathname.match(/^\/api\/private-documents\/([^/]+)$/)?.[1] ?? null;
      const sourceRightsApproval = url.pathname === "/api/source-library/rights/approve";
      const sourceBrowse = url.pathname === "/api/source-library";
      const sourceSearch = url.pathname === "/api/source-library/search";
      const sourceClassification = url.pathname === "/api/source-library/classification";
      const sourceClassificationBackfill = url.pathname === "/api/source-library/classification/backfill";
      const sourceSuppressionCheck =
        url.pathname === "/api/source-library/suppressions/check";
      const sourceActiveCheck =
        url.pathname === "/api/source-library/active/check";
      const sourceIngestion = url.pathname === "/api/source-library/ingestion/run";
      const manualMaterial = url.pathname === "/api/source-library/manual-material";
      const wikimediaTimedText = url.pathname === "/api/discovery/wikimedia/timedtext";
      const learningStatus = url.pathname === "/api/learning-generation/status";
      const learningReviewQueue = url.pathname === "/api/learning-generation/review-queue";
      const learningPublished = url.pathname === "/api/learning-generation/published";
      const learningReview = url.pathname === "/api/learning-generation/review";
      const learningRevocation = url.pathname === "/api/learning-generation/revoke";
      const learningProgress = url.pathname === "/api/learning-generation/progress";
      const learningClassification = url.pathname === "/api/learning-generation/classification";
      const learningFeedBatch = url.pathname === "/api/learning-generation/feed-batch";
      const learningLibraryKnowledge = url.pathname === "/api/learning-generation/library-knowledge";
      const learningFeedRefresh = url.pathname === "/api/learning-generation/feed-batch/refresh";
      const learningFeedComplete = url.pathname === "/api/learning-generation/feed-batch/complete";
      const learningReviewBatch = url.pathname === "/api/learning-generation/review-batch";
      const learningReviewRefresh = url.pathname === "/api/learning-generation/review-batch/refresh";
      const learningReviewAnswer = url.pathname === "/api/learning-generation/review-batch/answer";
      const learningReviewRemove = url.pathname === "/api/learning-generation/review-batch/remove";
      const learningReviewReplace = url.pathname === "/api/learning-generation/review-batch/replace";
      const learningReviewSkip = url.pathname === "/api/learning-generation/review-batch/skip";
      const learningPreference = url.pathname === "/api/learning-generation/knowledge-preference";
      const learningKnowledgeRemove = url.pathname === "/api/learning-generation/knowledge-remove";
      const knowledgeWorkflowStatus = url.pathname === "/api/knowledge-workflows/status";
      const knowledgeWorkflowSourceStatus = url.pathname === "/api/knowledge-workflows/source-status";
      const knowledgeWorkflowControl = url.pathname === "/api/knowledge-workflows/control";
      const knowledgeWorkflowMaterial = url.pathname === "/api/knowledge-workflows/material";
      const knowledgeWorkflowBackfill = url.pathname === "/api/knowledge-workflows/backfill";
      const knowledgeWorkflowReplay = url.pathname === "/api/knowledge-workflows/replay";
      const learningMedia = url.pathname === "/api/learning-media";
      if (
        !reminders && !rssPath && !centralSearchPath &&
        !urlCapture && !centralCapabilitiesPath && !sourceUploadContext && !sourceRename && sourceAction === null && !privateDocumentCreate && privateDocumentId === null && !sourceRightsApproval && !sourceBrowse &&
        !sourceSearch && !sourceClassification && !sourceClassificationBackfill && !sourceSuppressionCheck && !sourceActiveCheck &&
        !sourceIngestion && !manualMaterial && !wikimediaTimedText &&
        !learningStatus && !learningReviewQueue && !learningPublished && !learningReview && !learningRevocation &&
        !learningProgress && !learningClassification && !learningFeedBatch && !learningLibraryKnowledge && !learningFeedRefresh && !learningFeedComplete && !learningReviewBatch && !learningReviewRefresh && !learningReviewAnswer && !learningReviewReplace && !learningReviewSkip && !learningReviewRemove && !learningPreference && !learningKnowledgeRemove &&
        !knowledgeWorkflowStatus && !knowledgeWorkflowSourceStatus && !knowledgeWorkflowControl && !knowledgeWorkflowMaterial && !knowledgeWorkflowBackfill && !knowledgeWorkflowReplay && !learningMedia
      ) {
        return json({ error: "Not found." }, 404);
      }
      const origin = request.headers.get("origin");
      if (origin !== null && origin !== configuration.allowedOrigin) {
        return failureResponse({ kind: "DiscoveryOriginRejected" });
      }
      if (reminders) return handleReminderRequest(request, authenticated.value.ownerId, dependencies.reminders ?? null);
      if (sourceUploadContext) {
        if (request.method !== "GET") return json({ error: "Method not allowed." }, 405, { Allow: "GET" });
        if (dependencies.sourceRename == null) return sourceRenameFailureResponse({ kind: "SourceUploadContextReadFailed" });
        const result = await dependencies.sourceRename.uploadContext({ ownerId: authenticated.value.ownerId, sourceId: url.searchParams.get("sourceId"), runId: url.searchParams.get("runId") });
        if (!result.ok) return sourceRenameFailureResponse(result.error);
        const { source, runId, failureKind } = result.value;
        const resolved = workflowStatusReason(failureKind, "awaiting-upload", null);
        const audioVideo = [source.adapter.granularity, ...source.adapter.capabilities].some(value => /audio|video|podcast|episode/u.test(value.toLowerCase()));
        const reason = audioVideo && (resolved?.reasonCode === "rights-not-verified" || resolved?.reasonCode === "upload-content")
          ? "This source contains audio or video, but native audio/video transcription is not available yet. Upload an authorized transcript or text/document instead."
          : resolved?.message;
        if (reason === undefined) return sourceRenameFailureResponse({ kind: "SourceUploadContextReadFailed" });
        return json({ result: { source, runId, reason } }, 200);
      }
      if (learningMedia) {
        if (request.method !== "GET") return json({ error: "Method not allowed." }, 405, { Allow: "GET" });
        if (dependencies.learningMedia == null) return mediaFailureResponse({ kind: "LearningMediaUnavailable" });
        const assetId = url.searchParams.get("assetId");
        const variant = url.searchParams.get("variant");
        if (assetId === null || assetId.trim() === "" || (variant !== "feed" && variant !== "thumbnail")) return mediaFailureResponse({ kind: "MediaCommandInvalid" });
        const served = await dependencies.learningMedia.serve({ ownerId: authenticated.value.ownerId, assetId, variant });
        if (!served.ok) return mediaFailureResponse(served.error);
        return new Response(served.value.bytes, { status: 200, headers: { "content-type": served.value.mediaType, "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff" } });
      }
      if (privateDocumentId !== null) {
        if (request.method !== "GET") return json({ error: "Method not allowed." }, 405, { Allow: "GET" });
        if (dependencies.privateDocumentRead == null) return json({ error: "PrivateDocumentReadUnavailable" }, 503);
        let sourceId;
        try { sourceId = decodeURIComponent(privateDocumentId); } catch (error) { if (!(error instanceof URIError)) throw error; return json({ error: "PrivateDocumentCommandInvalid" }, 400); }
        const result = await dependencies.privateDocumentRead.read({ ownerId: authenticated.value.ownerId, sourceId });
        if (!result.ok) {
          const status = result.error.kind === "PrivateDocumentNotFound" ? 404 : result.error.kind === "PrivateDocumentNotPrivate" || result.error.kind === "PrivateDocumentDisabled" ? 403 : result.error.kind === "PrivateDocumentCommandInvalid" ? 400 : 503;
          return json({ error: result.error.kind }, status);
        }
        const value = result.value;
        if (value.status === "pending") return json({ ownerId: authenticated.value.ownerId, result: value }, 200, { "cache-control": "private, no-store" });
        return new Response(value.bytes, { status: 200, headers: { "content-type": value.mediaType, "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(value.fileName)}`, "x-content-type-options": "nosniff", "cache-control": "private, no-store" } });
      }
      if (knowledgeWorkflowStatus) {
        if (request.method !== "GET") return json({ error: "Method not allowed." }, 405, { Allow: "GET" });
        const workflow = dependencies.knowledgeWorkflow;
        if (workflow == null) return knowledgeWorkflowFailureResponse({ kind: "KnowledgeWorkflowUnavailable" });
        const runId = url.searchParams.get("runId");
        if (runId === null || runId.trim() === "") return knowledgeWorkflowFailureResponse({ kind: "WorkflowCommandInvalid" });
        const result = await runBoundedDependency({
          operation: "knowledge-workflow-status",
          ownerId: authenticated.value.ownerId,
          runId,
          timeoutMs: maximumBackendOperationMs,
          invoke: () => workflow.status({ ownerId: authenticated.value.ownerId, runId }),
          validate: isRecord,
          timeoutFailureKind: "KnowledgeWorkflowDependencyTimedOut",
          dependencyFailureKind: "KnowledgeWorkflowDependencyFailed",
          invalidFailureKind: "KnowledgeWorkflowResultInvalid",
          emit,
        });
        if (!result.ok) return knowledgeWorkflowFailureResponse(result.error);
        const projection = publicWorkflowStatus(result.value, dependencies.now?.());
        if (projection === null) {
          const logged = emit({ event: "dependency-failure", operation: "knowledge-workflow-status", ownerId: authenticated.value.ownerId, runId, failureKind: "WorkflowStatusProjectionInvalid" });
          if (!logged.ok) return failureResponse(logged.error);
          return knowledgeWorkflowFailureResponse({ kind: "WorkflowStatusProjectionInvalid" });
        }
        return json({ ownerId: authenticated.value.ownerId, result: projection }, 200);
      }
      if (knowledgeWorkflowSourceStatus) {
        if (request.method !== "GET") return json({ error: "Method not allowed." }, 405, { Allow: "GET" });
        const workflow = dependencies.knowledgeWorkflow;
        if (workflow?.sourceStatus === undefined) return knowledgeWorkflowFailureResponse({ kind: "KnowledgeWorkflowUnavailable" });
        const sourceStatus = workflow.sourceStatus;
        const sourceId = url.searchParams.get("sourceId");
        if (sourceId === null || sourceId.trim() === "") return knowledgeWorkflowFailureResponse({ kind: "WorkflowCommandInvalid" });
        const result = await runBoundedDependency({
          operation: "knowledge-workflow-source-status",
          ownerId: authenticated.value.ownerId,
          sourceId,
          timeoutMs: maximumBackendOperationMs,
          invoke: () => sourceStatus({ ownerId: authenticated.value.ownerId, sourceId }),
          validate: isRecord,
          timeoutFailureKind: "KnowledgeWorkflowDependencyTimedOut",
          dependencyFailureKind: "KnowledgeWorkflowDependencyFailed",
          invalidFailureKind: "KnowledgeWorkflowResultInvalid",
          emit,
        });
        if (!result.ok) return knowledgeWorkflowFailureResponse(result.error);
        const projection = publicSourceWorkflowStatus(result.value, authenticated.value.ownerId, dependencies.now?.());
        if (projection === null) {
          const logged = emit({ event: "dependency-failure", operation: "knowledge-workflow-source-status", ownerId: authenticated.value.ownerId, sourceId, failureKind: "WorkflowSourceStatusProjectionInvalid" });
          if (!logged.ok) return failureResponse(logged.error);
          return knowledgeWorkflowFailureResponse({ kind: "WorkflowSourceStatusProjectionInvalid" });
        }
        return json({ ownerId: authenticated.value.ownerId, result: projection }, 200);
      }
      if (learningStatus) {
        if (request.method !== "GET") return json({ error: "Method not allowed." }, 405, { Allow: "GET" });
        if (dependencies.learningGeneration == null) return json({ error: "LearningGenerationUnavailable" }, 503);
        const generationId = url.searchParams.get("generationId");
        if (generationId === null || generationId.trim() === "") return json({ error: "LearningGenerationCommandInvalid" }, 400);
        const result = await dependencies.learningGeneration.status({ ownerId: authenticated.value.ownerId, generationId });
        return result.ok ? json({ ownerId: authenticated.value.ownerId, result: result.value }, 200) : learningGenerationFailureResponse(result.error);
      }
      if (learningProgress) {
        if (request.method !== "GET") return json({ error: "Method not allowed." }, 405, { Allow: "GET" });
        if (dependencies.learningBatches?.loadProgress === undefined) return learningBatchFailureResponse({ kind: "ProgressReadUnavailable" });
        const days = url.searchParams.get("days");
        if (days === null || !["7", "30", "90"].includes(days)) return learningBatchFailureResponse({ kind: "ProgressCommandInvalid" });
        const result = await dependencies.learningBatches.loadProgress(authenticated.value.ownerId, Number(days), url.searchParams.get("subject"));
        return result.ok ? json({ result: result.value }, 200) : learningBatchFailureResponse(result.error);
      }
      if (learningFeedBatch || learningReviewBatch || learningLibraryKnowledge) {
        if (request.method !== "GET") return json({ error: "Method not allowed." }, 405, { Allow: "GET" });
        if (dependencies.learningBatches == null) return learningBatchFailureResponse({ kind: "LearningBatchUnavailable" });
        if (learningLibraryKnowledge && dependencies.learningBatches.listKnowledge === undefined) return learningBatchFailureResponse({ kind: "LearningBatchUnavailable" });
        const learningDay = url.searchParams.get("day");
        if (!learningLibraryKnowledge && (learningDay === null || learningDay.trim() === "")) return learningBatchFailureResponse({ kind: "LearningBatchCommandInvalid" });
        const result = learningLibraryKnowledge
          ? await dependencies.learningBatches.listKnowledge?.(authenticated.value.ownerId, url.searchParams.get("sourceId"))
          : learningFeedBatch
          ? await dependencies.learningBatches.loadFeed(authenticated.value.ownerId, /** @type {string} */ (learningDay))
          : await dependencies.learningBatches.loadReview(authenticated.value.ownerId, /** @type {string} */ (learningDay));
        if (result === undefined) return learningBatchFailureResponse({ kind: "LearningBatchUnavailable" });
        return result.ok ? json({ ownerId: authenticated.value.ownerId, result: result.value }, 200) : learningBatchFailureResponse(result.error);
      }
      if (learningClassification && request.method !== "POST") return json({ error: "Method not allowed." }, 405, { Allow: "POST" });
      if (learningFeedRefresh || learningFeedComplete || learningReviewRefresh || learningReviewAnswer || learningReviewReplace || learningReviewSkip || learningReviewRemove || learningPreference || learningKnowledgeRemove) {
        if (request.method !== "POST") return json({ error: "Method not allowed." }, 405, { Allow: "POST" });
        if (dependencies.learningBatches == null) return learningBatchFailureResponse({ kind: "LearningBatchUnavailable" });
      }
      if (learningReviewQueue) {
        if (request.method !== "GET") return json({ error: "Method not allowed." }, 405, { Allow: "GET" });
        if (dependencies.learningGeneration?.review.queue === undefined) return json({ error: "LearningGenerationUnavailable" }, 503);
        const result = await dependencies.learningGeneration.review.queue(authenticated.value.ownerId);
        return result.ok ? json({ ownerId: authenticated.value.ownerId, result: result.value }, 200) : learningGenerationFailureResponse(result.error);
      }
      if (learningPublished) {
        if (request.method !== "GET") return json({ error: "Method not allowed." }, 405, { Allow: "GET" });
        if (dependencies.learningGeneration?.review.visible === undefined) return json({ error: "LearningGenerationUnavailable" }, 503);
        const result = await dependencies.learningGeneration.review.visible(authenticated.value.ownerId);
        if (!result.ok) return learningGenerationFailureResponse(result.error);
        const quizzes = publicPublishedQuizzes(result.value);
        return quizzes === null
          ? json({ error: "LearningGenerationResponseInvalid" }, 503)
          : json({ ownerId: authenticated.value.ownerId, result: quizzes }, 200);
      }
      if (centralCapabilitiesPath) {
        if (request.method !== "GET") {
          return json({ error: "Method not allowed." }, 405, { Allow: "GET" });
        }
        if (dependencies.centralSearch == null) {
          return json({ error: "CentralSearchUnavailable" }, 503);
        }
        return json({
          ownerId: authenticated.value.ownerId,
          result: dependencies.centralSearch.capabilities(),
        }, 200);
      }
      if (sourceBrowse || sourceSearch) {
        if (request.method !== "GET") {
          return json({ error: "Method not allowed." }, 405, { Allow: "GET" });
        }
        const catalog = dependencies.sourceCatalog;
        if (catalog == null) {
          return sourceFailureResponse({ kind: "SourceCatalogReadFailed" });
        }
        const limit = Number(url.searchParams.get("limit"));
        const searchScope = url.searchParams.get("scope") ?? "sources";
        const externalProcessing = url.searchParams.get("externalProcessingAllowed");
        if (sourceSearch && searchScope !== "sources" && searchScope !== "knowledge") return sourceFailureResponse({ kind: "SourceCatalogCommandInvalid", field: "scope" });
        if (sourceSearch && externalProcessing !== null && externalProcessing !== "true" && externalProcessing !== "false") return sourceFailureResponse({ kind: "SourceCatalogCommandInvalid", field: "externalProcessingAllowed" });
        const result = await runBoundedDependency({
          operation: sourceBrowse ? "source-catalog-browse" : "source-catalog-search",
          ownerId: authenticated.value.ownerId,
          timeoutMs: maximumBackendOperationMs,
          invoke: () => sourceBrowse
            ? catalog.browse({
            ownerId: authenticated.value.ownerId,
            limit,
            cursor: url.searchParams.get("cursor"),
          })
            : catalog.search({
            ownerId: authenticated.value.ownerId,
            limit,
            query: url.searchParams.get("q"),
            mode: url.searchParams.get("mode") ?? "combined",
            scope: searchScope,
            externalProcessingAllowed: externalProcessing === null ? undefined : externalProcessing === "true",
            signal: AbortSignal.timeout(maximumBackendOperationMs),
          }),
          validate: sourceBrowse ? isSourceCatalogPage : searchScope === "knowledge" ? isKnowledgeSearchResults : isSourceSearchResults,
          itemCount: sourceBrowse ? sourceCatalogItemCount : sourceSearchItemCount,
          timeoutFailureKind: "SourceCatalogDependencyTimedOut",
          dependencyFailureKind: "SourceCatalogDependencyFailed",
          invalidFailureKind: "SourceCatalogResponseInvalid",
          emit,
        });
        return result.ok
          ? json({ ownerId: authenticated.value.ownerId, result: result.value }, 200)
          : sourceFailureResponse(result.error);
      }
      if (sourceSuppressionCheck || sourceActiveCheck) {
        if (request.method !== "POST") {
          return json({ error: "Method not allowed." }, 405, { Allow: "POST" });
        }
        const catalog = dependencies.sourceCatalog;
        if (catalog == null) {
          return sourceFailureResponse({ kind: "SourceCatalogReadFailed" });
        }
      }
      if (knowledgeWorkflowMaterial) {
        if (request.method !== "POST") return json({ error: "Method not allowed." }, 405, { Allow: "POST" });
        if (dependencies.knowledgeWorkflow?.material === undefined) return knowledgeWorkflowFailureResponse({ kind: "KnowledgeWorkflowUnavailable" });
        const material = await readWorkflowMaterialRequest(request, configuration.maximumCommandBytes, configuration.maximumMaterialBytes ?? configuration.maximumCommandBytes);
        if (!material.ok) return knowledgeWorkflowFailureResponse(material.error);
        const result = await dependencies.knowledgeWorkflow.material({ ...material.value, ownerId: authenticated.value.ownerId });
        return result.ok ? json({ ownerId: authenticated.value.ownerId, result: result.value }, 200) : knowledgeWorkflowFailureResponse(result.error);
      }
      if ((knowledgeWorkflowBackfill || knowledgeWorkflowReplay) && request.method !== "POST") return json({ error: "Method not allowed." }, 405, { Allow: "POST" });
      if (request.method !== "POST") {
        return json({ error: "Method not allowed." }, 405, { Allow: "POST" });
      }
      const declaredLength = Number(request.headers.get("content-length"));
      if (
        Number.isFinite(declaredLength) &&
        declaredLength > configuration.maximumCommandBytes
      ) {
        return failureResponse({ kind: "DiscoveryRequestTooLarge" });
      }
      const text = await request.text();
      if (
        new TextEncoder().encode(text).byteLength >
          configuration.maximumCommandBytes
      ) {
        return failureResponse({ kind: "DiscoveryRequestTooLarge" });
      }
      let document;
      try {
        document = /** @type {unknown} */ (JSON.parse(text));
      } catch (error) {
        if (error instanceof SyntaxError) {
          return failureResponse({
            kind: "DiscoveryCommandInvalid",
            field: "body",
          });
        }
        throw error;
      }
      if(urlCapture){
        if(!isRecord(document)||Object.keys(document).length!==1||!validatePublisherDestination(document.url).ok)return json({error:"SourceExtractionUrlInvalid"},400);
        if(!dependencies.urlCapture)return json({error:"KnowledgeBrowserUnavailable"},503);
        const result=await dependencies.urlCapture({ownerId:authenticated.value.ownerId,url:/** @type {string} */(document.url)});
        return result.ok ? new Response(result.value,{headers:{"content-type":new TextDecoder().decode(result.value.subarray(0,4))==='PKPC'?"application/x-knowledge-url-capture":"application/pdf","cache-control":"private, no-store","x-content-type-options":"nosniff"}}) : json({error:result.error.kind},422);
      }
      if (sourceClassification) {
        if (dependencies.sourceClassification == null) return sourceClassificationFailureResponse({ kind: "SourceClassificationPersistenceFailed" });
        if (!isRecord(document) || Object.hasOwn(document, "ownerId") || Object.keys(document).some((key) => !["sourceId", "sourceRevision", "expectedRevision", "mainSubject", "topic"].includes(key))) return sourceClassificationFailureResponse({ kind: "SourceClassificationCommandInvalid" });
        const result = await dependencies.sourceClassification.updateManual({ ...document, ownerId: authenticated.value.ownerId, classification: { mainSubject: document.mainSubject, topic: document.topic } });
        if (!result.ok) return sourceClassificationFailureResponse(result.error);
        return json({ ownerId: authenticated.value.ownerId, result: { sourceId: result.value.sourceId, sourceRevision: result.value.sourceRevision, classificationRevision: result.value.classificationRevision, mainSubject: result.value.mainSubject, topic: result.value.topic } }, 200);
      }
      if (sourceClassificationBackfill) {
        if (dependencies.sourceClassificationBackfill == null) return sourceClassificationBackfillFailureResponse({ kind: "BackfillUnavailable" });
        const pageSize = isRecord(document) ? document.pageSize : undefined;
        if (!isRecord(document) || Object.hasOwn(document, "ownerId") || Object.keys(document).sort().join(",") !== "pageSize" || typeof pageSize !== "number" || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 500) return sourceClassificationBackfillFailureResponse({ kind: "BackfillCommandInvalid" });
        const result = await dependencies.sourceClassificationBackfill.run(Object.freeze({ ownerId: authenticated.value.ownerId, pageSize }));
        if (!result.ok) return sourceClassificationBackfillFailureResponse(result.error);
        if (!isRecord(result.value) || result.value.ownerId !== authenticated.value.ownerId || !isRecord(result.value.counts) || Object.keys(result.value.counts).sort().join(",") !== "alreadyProcessed,classified,manualPreserved,needsReview,scanned" || ![result.value.counts.scanned, result.value.counts.classified, result.value.counts.needsReview, result.value.counts.alreadyProcessed, result.value.counts.manualPreserved].every((count) => typeof count === "number" && Number.isSafeInteger(count) && count >= 0)) return sourceClassificationBackfillFailureResponse({ kind: "BackfillResponseInvalid" });
        return json({ ownerId: authenticated.value.ownerId, result: { counts: result.value.counts } }, 200);
      }
      if (sourceRename) {
        if (dependencies.sourceRename == null) return sourceRenameFailureResponse({ kind: "SourceRenamePersistenceFailed" });
        if (!isRecord(document) || Object.hasOwn(document, "ownerId")) return sourceRenameFailureResponse({ kind: "SourceRenameCommandInvalid" });
        const result = await dependencies.sourceRename.rename({ ...document, ownerId: authenticated.value.ownerId });
        return result.ok ? json({ result: result.value }, 200) : sourceRenameFailureResponse(result.error);
      }
      if (knowledgeWorkflowBackfill) {
        if (dependencies.knowledgeWorkflowBackfill == null) return knowledgeWorkflowFailureResponse({ kind: "KnowledgeWorkflowUnavailable" });
        if (!isRecord(document) || Object.hasOwn(document, "ownerId") || Object.hasOwn(document, "configDigests") || Object.keys(document).some((key) => key !== "confirmation" && key !== "verificationMarker")) return knowledgeWorkflowFailureResponse({ kind: "BackfillCommandInvalid" });
        const result = await dependencies.knowledgeWorkflowBackfill.run(Object.freeze({ ...document, ownerId: authenticated.value.ownerId }));
        if (!result.ok) return knowledgeWorkflowFailureResponse(result.error);
        const projection = publicBackfillResult(result.value, authenticated.value.ownerId);
        return projection === null
          ? knowledgeWorkflowFailureResponse({ kind: "BackfillResponseInvalid" })
          : json({ ownerId: authenticated.value.ownerId, result: projection }, 200);
      }
      if (knowledgeWorkflowReplay) {
        if (dependencies.knowledgeWorkflowReplay == null) return knowledgeWorkflowFailureResponse({ kind: "KnowledgeWorkflowUnavailable" });
        if (!isRecord(document) || Object.hasOwn(document, "ownerId") || Object.hasOwn(document, "configDigests") || Object.keys(document).some((key) => key !== "confirmation" && key !== "verificationMarker")) return knowledgeWorkflowFailureResponse({ kind: "ReplayCommandInvalid" });
        const result = await dependencies.knowledgeWorkflowReplay.run(Object.freeze({ ...document, ownerId: authenticated.value.ownerId }));
        if (!result.ok) return knowledgeWorkflowFailureResponse(result.error);
        const projection = publicReplayResult(result.value, authenticated.value.ownerId);
        return projection === null
          ? knowledgeWorkflowFailureResponse({ kind: "ReplayResponseInvalid" })
          : json({ ownerId: authenticated.value.ownerId, result: projection }, 200);
      }
      if (learningClassification) {
        if (!isRecord(document) || Object.hasOwn(document, "ownerId")) return learningBatchFailureResponse({ kind: "ClassificationCommandInvalid" });
        if (dependencies.learningBatches?.correctClassification === undefined) return learningBatchFailureResponse({ kind: "ClassificationWriteUnavailable" });
        const result = await dependencies.learningBatches.correctClassification({ ...document, ownerId: authenticated.value.ownerId });
        return result.ok ? json({ result: result.value }, 200) : learningBatchFailureResponse(result.error);
      }
      if (learningFeedRefresh || learningFeedComplete || learningReviewRefresh || learningReviewAnswer || learningReviewRemove || learningReviewReplace || learningReviewSkip || learningPreference || learningKnowledgeRemove) {
        if (!isRecord(document) || Object.hasOwn(document, "ownerId")) return learningBatchFailureResponse({ kind: "LearningBatchCommandInvalid" });
        const ownedCommand = Object.freeze({ ...document, ownerId: authenticated.value.ownerId });
        const learningBatches = dependencies.learningBatches;
        if (learningBatches == null) return learningBatchFailureResponse({ kind: "LearningBatchUnavailable" });
        const result = learningFeedRefresh
          ? await learningBatches.loadFeed(authenticated.value.ownerId, utcDay(dependencies.now?.()), true)
          : learningFeedComplete
          ? await learningBatches.completeFeed(ownedCommand)
          : learningReviewRefresh
          ? await learningBatches.loadReview(authenticated.value.ownerId, utcDay(dependencies.now?.()), true)
          : learningReviewAnswer
          ? await learningBatches.answerReview(ownedCommand)
          : learningReviewRemove
          ? await learningBatches.removeReview?.(ownedCommand) ?? { ok: false, error: { kind: "LearningBatchUnavailable" } }
          : learningReviewReplace
          ? await learningBatches.replaceReview?.(ownedCommand) ?? { ok: false, error: { kind: "LearningBatchUnavailable" } }
          : learningReviewSkip
          ? await learningBatches.skipReview?.(ownedCommand) ?? { ok: false, error: { kind: "LearningBatchUnavailable" } }
          : learningPreference
          ? await learningBatches.setPreference(ownedCommand)
          : await learningBatches.removeKnowledge(ownedCommand);
        return result.ok ? json({ ownerId: authenticated.value.ownerId, result: result.value }, 200) : learningBatchFailureResponse(result.error);
      }
      if (sourceRightsApproval) {
        if (dependencies.sourceRightsApproval == null) return rightsApprovalFailureResponse({ kind: "RightsApprovalPersistenceFailed" });
        if (!isRecord(document) || Object.hasOwn(document, "ownerId")) return rightsApprovalFailureResponse({ kind: "RightsApprovalCommandInvalid", field: Object.hasOwn(isRecord(document) ? document : {}, "ownerId") ? "ownerId" : "body" });
        const result = await dependencies.sourceRightsApproval.approve(Object.freeze({ ...document, ownerId: authenticated.value.ownerId }));
        if (!result.ok) return rightsApprovalFailureResponse(result.error);
        if (!result.value.reused && dependencies.knowledgeWorkflow?.rightsApproved !== undefined) {
          const advanced = await dependencies.knowledgeWorkflow.rightsApproved({ ownerId: authenticated.value.ownerId, sourceId: result.value.sourceId, sourceRevision: result.value.sourceRevision });
          if (!advanced.ok) return knowledgeWorkflowFailureResponse(advanced.error);
        } else if (result.value.requeued && !result.value.reused && result.value.jobId !== null && dependencies.sourceIngestion !== null && dependencies.sourceIngestion !== undefined) {
          const work = dependencies.sourceIngestion.run({ ownerId: authenticated.value.ownerId, jobId: result.value.jobId });
          const observed = work.then((outcome) => {
            if (!outcome.ok) console.error(JSON.stringify({ event: "source-rights-approval-automatic-ingestion-failure", failureKind: outcome.error.kind }));
            else console.info(JSON.stringify({ event: "source-rights-approval-automatic-ingestion-success", itemsStored: outcome.value.itemsStored }));
          }, (error) => {
            if (error instanceof Error) {
              console.error(JSON.stringify({ event: "source-rights-approval-automatic-ingestion-rejection", failureKind: "SourceIngestionUnexpectedFailure" }));
              return;
            }
            throw error;
          });
          if (dependencies.waitUntil === undefined) await observed;
          else dependencies.waitUntil(observed);
        }
        return json({ ownerId: authenticated.value.ownerId, result: result.value }, 200);
      }
      if (privateDocumentCreate) {
        if (dependencies.sourceLibrary?.createPrivateDocument === undefined) return sourceFailureResponse({ kind: "SourceApprovalPersistenceFailed" });
        if (dependencies.knowledgeWorkflow == null) return knowledgeWorkflowFailureResponse({ kind: "KnowledgeWorkflowUnavailable" });
        if (!isRecord(document) || Object.hasOwn(document, "ownerId")) return sourceFailureResponse({ kind: "SourceCatalogCommandInvalid", field: Object.hasOwn(isRecord(document) ? document : {}, "ownerId") ? "ownerId" : "body" });
        const created = await dependencies.sourceLibrary.createPrivateDocument(Object.freeze({ ...document, ownerId: authenticated.value.ownerId, applicationOrigin: configuration.allowedOrigin }));
        if (!created.ok) return sourceFailureResponse(created.error);
        const workflow = await dependencies.knowledgeWorkflow.start({ ownerId: authenticated.value.ownerId, sourceId: created.value.source.id, sourceRevision: created.value.source.revision, canonicalSourceIdentity: created.value.source.canonicalUrl, contentSignature: `source-revision:${created.value.source.canonicalUrl}:${created.value.source.revision}`, configDigests: {}, idempotencyKey: `knowledge-workflow:${created.value.source.id}:${created.value.source.revision}`, sourceOrigin: "private-document" });
        return workflow.ok
          ? json({ ownerId: authenticated.value.ownerId, result: { source: created.value.source, runId: workflow.value.runId, reused: created.value.reused && workflow.value.reused } }, 200)
          : knowledgeWorkflowFailureResponse(workflow.error);
      }
      if (sourceAction !== null) {
        if (dependencies.sourceLibrary == null) {
          return sourceFailureResponse({
            kind: "SourceApprovalPersistenceFailed",
          });
        }
        if (!isRecord(document) || Object.hasOwn(document, "ownerId")) {
          return sourceFailureResponse({
            kind: "SourceCatalogCommandInvalid",
            field: Object.hasOwn(
                isRecord(document) ? document : {},
                "ownerId",
              )
              ? "ownerId"
              : "body",
          });
        }
        let approvalInput = document;
        if (sourceExtraction) {
          if (document.extractionScope !== undefined && document.extractionScope !== "page" && document.extractionScope !== "platform") return json({error:"WorkflowCommandInvalid",field:"extractionScope"},400);
          if (dependencies.knowledgeWorkflow == null) return knowledgeWorkflowFailureResponse({kind:"KnowledgeWorkflowUnavailable"});
          const {extractionScope: _extractionScope, ...sourceDocument} = document;
          approvalInput = sourceDocument;
          if (Object.hasOwn(sourceDocument,"url")) {
            const prepared = prepareSubmittedLink(sourceDocument, dependencies.now?.() ?? new Date().toISOString(),urlMaterial);
            if (!prepared.ok) return json({error:prepared.error.kind,field:prepared.error.field},400);
            approvalInput = prepared.value;
          }
          const checked = validateApprovalCommand({...approvalInput,ownerId:authenticated.value.ownerId});
          if (!checked.ok) return sourceFailureResponse(checked.error);
          if (!validatePublisherDestination(checked.value.canonicalUrl).ok) return json({error:"SourceExtractionUrlInvalid"},400);
          if (!checked.value.adapter.capabilities.includes("bounded-ingestion")) return json({error:"SourceExtractionFormatUnsupported"},422);
        }
        const ownedCommand = Object.freeze({...approvalInput,ownerId:authenticated.value.ownerId});
      let result = sourceAction === "approve"
          ? await dependencies.sourceLibrary.approve(ownedCommand)
          : sourceAction === "revise"
          ? await dependencies.sourceLibrary.revise(ownedCommand)
          : sourceAction === "disable"
          ? await dependencies.sourceLibrary.disable(ownedCommand)
          : sourceAction === "restore"
          ? await dependencies.sourceLibrary.restore(ownedCommand)
          : await dependencies.sourceLibrary.reject(ownedCommand);
        if(urlMaterial && !result.ok && result.error.kind==="SourceStateConflict"){
          const restored=await dependencies.sourceLibrary.restore({ownerId:authenticated.value.ownerId,sourceId:result.error.sourceId,expectedRevision:result.error.revision,idempotencyKey:`url-restore:${document.idempotencyKey}`});
          if(!restored.ok)return sourceFailureResponse(restored.error);
          result=await dependencies.sourceLibrary.approve(ownedCommand);
        }
        if (result.ok && sourceAction === "disable" && dependencies.learningGeneration !== null && dependencies.learningGeneration !== undefined) {
          const revoked = await dependencies.learningGeneration.revoke.revoke({ ownerId: authenticated.value.ownerId, sourceId: result.value.id, sourceRevision: result.value.revision, idempotencyKey: `source-disable:${result.value.id}:${result.value.revision}`, reason: "source-disabled", revokedAt: result.value.updatedAt });
          if (!revoked.ok) return learningGenerationFailureResponse(revoked.error);
        }
        if (result.ok && sourceAction === "disable" && dependencies.knowledgeWorkflow?.revokeSource !== undefined) {
          const revoked = await dependencies.knowledgeWorkflow.revokeSource({ ownerId: authenticated.value.ownerId, sourceId: result.value.id, canonicalSourceIdentity: result.value.canonicalUrl, reason: "source-disabled" });
          if (!revoked.ok) return knowledgeWorkflowFailureResponse(revoked.error);
        }
        if (result.ok && sourceAction === "disable" && dependencies.learningBatches?.removeSource !== undefined) {
          const removed = await dependencies.learningBatches.removeSource({ ownerId: authenticated.value.ownerId, sourceId: result.value.id, idempotencyKey: `source-content-remove:${result.value.id}:${result.value.revision}` });
          if (!removed.ok) return learningBatchFailureResponse(removed.error);
        }
        /** @type {Result<{ readonly runId: string, readonly reused: boolean }, { readonly kind: string }> | null} */
        let workflowStart = null;
        if (result.ok && sourceAction === "approve" && dependencies.knowledgeWorkflow !== null && dependencies.knowledgeWorkflow !== undefined) {
          const rightsProfile = dependencies.sourceRightsProfileFor?.(result.value.source.canonicalUrl) ?? null;
          const extractionScope = sourceExtraction && !urlMaterial ? document.extractionScope : undefined;
          workflowStart = await dependencies.knowledgeWorkflow.start({ ownerId: authenticated.value.ownerId, sourceId: result.value.source.id, sourceRevision: result.value.source.revision, canonicalSourceIdentity: result.value.source.canonicalUrl, contentSignature: `source-revision:${result.value.source.canonicalUrl}:${result.value.source.revision}`, configDigests: {}, ...(extractionScope === undefined ? {} : {extractionScope}), idempotencyKey: urlMaterial ? `url-material:${result.value.source.id}:${document.idempotencyKey}` : `knowledge-workflow:${result.value.source.id}:${result.value.source.revision}${extractionScope === undefined ? "" : `:${extractionScope}`}`, ...(urlMaterial ? {sourceOrigin:"url-material"} : {}), userAuthorization: {kind:"user-authorized-link",ownerId:authenticated.value.ownerId,sourceId:result.value.source.id,sourceRevision:result.value.source.revision,url:result.value.source.canonicalUrl,recordedAt:result.value.source.approvedAt}, rightsProfile });
          if (!workflowStart.ok) return knowledgeWorkflowFailureResponse(workflowStart.error);
        }
        if (result.ok && sourceAction === "approve" && workflowStart === null && !result.value.reused && result.value.job !== null && dependencies.sourceIngestion !== null && dependencies.sourceIngestion !== undefined && result.value.source.adapter.capabilities.includes("bounded-ingestion")) {
          const work = dependencies.sourceIngestion.run({ ownerId: authenticated.value.ownerId, jobId: result.value.job.id });
          const observed = work.then((outcome) => {
            if (!outcome.ok) console.error(JSON.stringify({ event: "source-library-automatic-ingestion-failure", failureKind: outcome.error.kind }));
            else console.info(JSON.stringify({ event: "source-library-automatic-ingestion-success", itemsStored: outcome.value.itemsStored }));
          }, (error) => {
            if (error instanceof Error) {
              console.error(JSON.stringify({ event: "source-library-automatic-ingestion-rejection", failureKind: "SourceIngestionUnexpectedFailure" }));
              return;
            }
            throw error;
          });
          if (dependencies.waitUntil === undefined) await observed;
          else dependencies.waitUntil(observed);
        }
        return result.ok
          ? json(
            { ownerId: authenticated.value.ownerId, result: result.value, ...(workflowStart === null ? {} : { workflow: workflowStart.value }) },
            200,
          )
          : sourceFailureResponse(result.error);
      }
      if (knowledgeWorkflowControl) {
        if (dependencies.knowledgeWorkflow == null) return knowledgeWorkflowFailureResponse({ kind: "KnowledgeWorkflowUnavailable" });
        if (!isRecord(document) || Object.hasOwn(document, "ownerId")) return knowledgeWorkflowFailureResponse({ kind: "WorkflowCommandInvalid" });
        const result = await dependencies.knowledgeWorkflow.control(Object.freeze({ ...document, ownerId: authenticated.value.ownerId }));
        if (!result.ok) return knowledgeWorkflowFailureResponse(result.error);
        const projection = publicWorkflowStatus(result.value, dependencies.now?.());
        if (projection === null) {
          const logged = emit({ event: "dependency-failure", operation: "knowledge-workflow-control", ownerId: authenticated.value.ownerId, ...(isNonEmptyText(document.runId) ? {runId:document.runId} : {}), failureKind: "WorkflowStatusProjectionInvalid" });
          if (!logged.ok) return failureResponse(logged.error);
          return knowledgeWorkflowFailureResponse({ kind: "WorkflowStatusProjectionInvalid" });
        }
        return json({ ownerId: authenticated.value.ownerId, result: projection }, 200);
      }
      if (learningReview || learningRevocation) {
        if (dependencies.learningGeneration == null) return json({ error: "LearningGenerationUnavailable" }, 503);
        if (!isRecord(document) || Object.hasOwn(document, "ownerId")) return json({ error: "LearningGenerationCommandInvalid" }, 400);
        const ownedCommand = Object.freeze({ ...document, ownerId: authenticated.value.ownerId });
        const result = learningReview
          ? await dependencies.learningGeneration.review.decide(ownedCommand)
          : await dependencies.learningGeneration.revoke.revoke(ownedCommand);
        if (!result.ok) return learningGenerationFailureResponse(result.error);
        if (learningRevocation) return json({ ownerId: authenticated.value.ownerId, result: result.value }, 200);
        const value = isRecord(result.value) ? result.value : null;
        if (value === null || !isNonEmptyText(value.id) || !isNonEmptyText(value.status) || typeof value.revision !== "number") return json({ error: "LearningGenerationResponseInvalid" }, 503);
        return json({ ownerId: authenticated.value.ownerId, result: { taskId: value.id, status: value.status, reviewDecision: value.reviewDecision ?? null, reviewedAt: value.reviewedAt ?? null, revision: value.revision } }, 200);
      }
      if (sourceIngestion || manualMaterial || wikimediaTimedText) {
        if (sourceIngestion) {
          if (!validSourceIngestionCommand(document)) {
            return json({ error: "SourceIngestionCommandInvalid" }, 400);
          }
          const result = await dependencies.sourceIngestion?.run(Object.freeze({
            ownerId: authenticated.value.ownerId,
            jobId: document.jobId,
          }));
          if (result === undefined) return json({ error: "SourceIngestionUnavailable" }, 503);
          return result.ok
            ? json({ ownerId: authenticated.value.ownerId, result: result.value }, 200)
            : ingestionFailureResponse(result.error);
        }
        if (wikimediaTimedText && !validWikimediaCommand(document)) {
          return json({ error: "WikimediaCommandInvalid" }, 400);
        }
        if (!isRecord(document) || Object.hasOwn(document, "ownerId")) {
          return json({ error: "SourceIngestionCommandInvalid" }, 400);
        }
        const ownedCommand = Object.freeze({ ...document, ownerId: authenticated.value.ownerId });
        const result = manualMaterial
          ? await dependencies.manualMaterial?.upload(ownedCommand)
          : await dependencies.wikimediaTimedText?.retrieve(ownedCommand);
        if (result === undefined) return json({ error: "SourceIngestionUnavailable" }, 503);
        return result.ok
          ? json({ ownerId: authenticated.value.ownerId, result: result.value }, 200)
          : ingestionFailureResponse(result.error);
      }
      if (sourceSuppressionCheck || sourceActiveCheck) {
        const catalog = dependencies.sourceCatalog;
        if (catalog == null) return sourceFailureResponse({ kind: "SourceCatalogReadFailed" });
        if (!isRecord(document) || Object.hasOwn(document, "ownerId")) {
          return sourceFailureResponse({
            kind: "SourceCatalogCommandInvalid",
            field: "body",
          });
        }
        const result = await runBoundedDependency({
          operation: sourceActiveCheck ? "source-catalog-active" : "source-catalog-suppressed",
          ownerId: authenticated.value.ownerId,
          timeoutMs: maximumBackendOperationMs,
          invoke: () => sourceActiveCheck
            ? catalog.active({
            ...document,
            ownerId: authenticated.value.ownerId,
          })
            : catalog.suppressed({
            ...document,
            ownerId: authenticated.value.ownerId,
          }),
          validate: isStringArray,
          itemCount: (value) => Array.isArray(value) ? value.length : undefined,
          timeoutFailureKind: "SourceCatalogDependencyTimedOut",
          dependencyFailureKind: "SourceCatalogDependencyFailed",
          invalidFailureKind: "SourceCatalogResponseInvalid",
          emit,
        });
        return result.ok
          ? json(
            { ownerId: authenticated.value.ownerId, result: result.value },
            200,
          )
          : sourceFailureResponse(result.error);
      }
      if (centralSearchPath) {
        if (dependencies.centralSearch == null) {
          return json({ error: "CentralSearchUnavailable" }, 503);
        }
        const searched = await dependencies.centralSearch.search(document);
        return searched.ok
          ? json(
            { ownerId: authenticated.value.ownerId, result: searched.value },
            200,
          )
          : centralSearchFailureResponse(searched.error);
      }
      const command = validateRssAcquisitionCommand(document);
      if (!command.ok) return failureResponse(command.error);
      const acquired = await dependencies.acquireRss(
        command.value,
        authenticated.value.ownerId,
      );
      if (!acquired.ok) {
        return acquired.error.kind ===
            "TranscriptAuthorizationPersistenceFailed"
          ? json({ error: acquired.error.kind }, 503)
          : failureResponse(acquired.error);
      }
      return json(
        { ownerId: authenticated.value.ownerId, result: acquired.value },
        200,
      );
  }
  return Object.freeze({
    /** @param {Request} request */
    async fetch(request) {
      const correlationId = createRequestId();
      const requestUrl = new URL(request.url);
      const route = requestRouteLabel(requestUrl.pathname);
      const method = requestMethodLabel(request.method);
      /** @type {string | undefined} */
      let ownerId;
      /** @type {(entry: Omit<DiscoveryRequestLogEntry, "correlationId" | "route" | "method">) => Result<null, { readonly kind: "DiscoveryRequestLoggingFailed", readonly causeKind: "DiscoveryRequestLogEntryInvalid" | "DiscoveryRequestLogTimestampInvalid" | "DiscoveryRequestLoggerResultInvalid" | "DiscoveryRequestLoggerThrew" }> } */
      const emit = (entry) => {
        let result;
        try { result = requestLogger({ ...entry, correlationId, route, method }); } catch (error) {
          return { ok: false, error: { kind: "DiscoveryRequestLoggingFailed", causeKind: "DiscoveryRequestLoggerThrew" } };
        }
        if (!isRecord(result) || typeof result.ok !== "boolean") return { ok: false, error: { kind: "DiscoveryRequestLoggingFailed", causeKind: "DiscoveryRequestLoggerResultInvalid" } };
        if (result.ok) return { ok: true, value: null };
        if (!isRecord(result.error)) return { ok: false, error: { kind: "DiscoveryRequestLoggingFailed", causeKind: "DiscoveryRequestLoggerResultInvalid" } };
        const causeKind = result.error.kind;
        return causeKind === "DiscoveryRequestLogEntryInvalid" || causeKind === "DiscoveryRequestLogTimestampInvalid"
          ? { ok: false, error: { kind: "DiscoveryRequestLoggingFailed", causeKind } }
          : { ok: false, error: { kind: "DiscoveryRequestLoggingFailed", causeKind: "DiscoveryRequestLoggerResultInvalid" } };
      };
      const entryLogged = emit({ event: "request-entry" });
      if (!entryLogged.ok) return attachRequestId(failureResponse(entryLogged.error), correlationId);
      try {
        const response = await handleRequest(
          request,
          (authenticatedOwnerId) => { ownerId = authenticatedOwnerId; },
          emit,
        );
        const logged = emit({
          event: response.status >= 400 ? "request-failure" : "request-success",
          ...(ownerId === undefined ? {} : { ownerId }),
          status: response.status,
        });
        if (!logged.ok) return attachRequestId(failureResponse(logged.error), correlationId);
        return attachRequestId(response, correlationId);
      } catch (error) {
        if (!(error instanceof Error)) throw error;
        const logged = emit({
          event: "request-failure",
          ...(ownerId === undefined ? {} : { ownerId }),
          status: 500,
          failureKind: "DiscoveryUnhandledError",
        });
        if (!logged.ok) return attachRequestId(failureResponse(logged.error), correlationId);
        return attachRequestId(json({ error: "DiscoveryInternalFailure", correlationId }, 500), correlationId);
      }
    },
  });
}

/** @param {Response} response @param {string} correlationId @returns {Response} */
function attachRequestId(response, correlationId) {
  const headers = new Headers(response.headers);
  headers.set("x-resonance-request-id", correlationId);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

/** @param {unknown} value @returns {value is Result<AccessIdentity, WorkerFailure>} */
function isAuthenticationResult(value) {
  if (!isRecord(value) || typeof value.ok !== "boolean") return false;
  if (value.ok) return isRecord(value.value) && isNonEmptyText(value.value.ownerId) && isNonEmptyText(value.value.email);
  return isRecord(value.error) && isNonEmptyText(value.error.kind);
}

/** @param {string} pathname @returns {string} */
function requestRouteLabel(pathname) {
  if (pathname === "/api/source-library") return "source-library-browse";
  if (pathname === "/api/source-library/search") return "source-library-search";
  if (pathname === "/api/knowledge-workflows/status") return "knowledge-workflow-status";
  if (pathname === "/api/knowledge-workflows/source-status") return "knowledge-workflow-source-status";
  if (pathname.startsWith("/api/source-library/")) return "source-library";
  if (pathname.startsWith("/api/knowledge-workflows/")) return "knowledge-workflow";
  if (pathname.startsWith("/api/learning-generation/")) return "learning-generation";
  if (pathname.startsWith("/api/discovery/")) return "discovery";
  return "other-api";
}

/** @param {string} method @returns {string} */
function requestMethodLabel(method) {
  return /^[A-Z]{1,16}$/u.test(method) ? method : "OTHER";
}

/** @param {unknown} value @returns {value is { readonly ok: boolean, readonly value?: unknown, readonly error?: { readonly kind: string } }} */
function isResultEnvelope(value) {
  return isRecord(value) && typeof value.ok === "boolean" && (value.ok
    ? Object.hasOwn(value, "value")
    : isRecord(value.error) && isNonEmptyText(value.error.kind));
}

/** @param {unknown} value @returns {value is SourceCatalogPage} */
function isSourceCatalogPage(value) {
  return isRecord(value) && Array.isArray(value.items) && value.items.every(isLibrarySourceRecord) && Array.isArray(value.interestAreas) && value.interestAreas.every(isInterestAreaRecord) && (value.nextCursor === null || typeof value.nextCursor === "string");
}

/** @param {unknown} value @returns {value is readonly SourceSearchHit[]} */
function isSourceSearchResults(value) {
  return Array.isArray(value) && value.every((entry) => isRecord(entry) && isLibrarySourceRecord(entry.source) && typeof entry.score === "number" && Number.isFinite(entry.score));
}

/** @param {unknown} value @returns {value is readonly KnowledgeSearchHit[]} */
function isKnowledgeSearchResults(value) {
  return Array.isArray(value) && value.every((entry) => isRecord(entry) && isRecord(entry.knowledge) && isNonEmptyText(entry.knowledge.knowledgeId) && isNonEmptyText(entry.knowledge.sourceId) && isNonEmptyText(entry.knowledge.sourceTitle) && isNonEmptyText(entry.knowledge.summary) && isPublicHttpsUrl(entry.knowledge.sourceUrl) && Array.isArray(entry.knowledge.evidenceAnchorIds) && entry.knowledge.evidenceAnchorIds.every(isNonEmptyText) && typeof entry.knowledge.questionLocked === "boolean" && typeof entry.score === "number" && Number.isFinite(entry.score) && (entry.matchedBy === "exact" || entry.matchedBy === "semantic" || entry.matchedBy === "combined"));
}

/** @param {unknown} value @returns {value is LibrarySource} */
function isLibrarySourceRecord(value) {
  return isRecord(value) && isNonEmptyText(value.id) && isNonEmptyText(value.ownerId) && isPublicHttpsUrl(value.submittedUrl) && isPublicHttpsUrl(value.canonicalUrl) && isNonEmptyText(value.title) && typeof value.description === "string" && isRecord(value.adapter) && isNonEmptyText(value.adapter.id) && isNonEmptyText(value.adapter.version) && isNonEmptyText(value.adapter.granularity) && Array.isArray(value.adapter.capabilities) && value.adapter.capabilities.every(isNonEmptyText) && Array.isArray(value.interestAreaIds) && value.interestAreaIds.every(isNonEmptyText) && Array.isArray(value.identityEvidence) && value.state === "active" && isIsoDateTime(value.approvedAt) && isIsoDateTime(value.updatedAt) && isPositiveInteger(value.revision);
}

/** @param {unknown} value @returns {value is { readonly id: string, readonly ownerId: string, readonly title: string, readonly provenance: string }} */
function isInterestAreaRecord(value) {
  return isRecord(value) && isNonEmptyText(value.id) && isNonEmptyText(value.ownerId) && isNonEmptyText(value.title) && isNonEmptyText(value.provenance);
}

/** @param {unknown} value @returns {value is string} */
function isPublicHttpsUrl(value) {
  if (typeof value !== "string") return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && parsed.username === "" && parsed.password === "" && parsed.hostname !== "";
  } catch (error) {
    if (error instanceof TypeError) return false;
    throw error;
  }
}

/** @param {unknown} value @returns {value is string} */
function isIsoDateTime(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

/** @param {unknown} value @returns {value is readonly string[]} */
function isStringArray(value) {
  return Array.isArray(value) && value.every(isNonEmptyText);
}

/** @param {unknown} value @returns {number | undefined} */
function sourceCatalogItemCount(value) {
  return isSourceCatalogPage(value) ? value.items.length : undefined;
}

/** @param {unknown} value @returns {number | undefined} */
function sourceSearchItemCount(value) {
  return Array.isArray(value) ? value.length : undefined;
}

/**
 * Execute one backend dependency with a hard wall-clock bound and a runtime
 * Result-envelope check. The dependency promise may finish later, but its
 * response is never allowed to hold the request open past the bound.
 *
 * @param {{ readonly operation: string, readonly ownerId?: string, readonly sourceId?: string, readonly runId?: string, readonly timeoutMs: number, readonly invoke: () => Promise<unknown>, readonly validate: (value: unknown) => boolean, readonly itemCount?: (value: unknown) => number | undefined, readonly timeoutFailureKind: string, readonly dependencyFailureKind: string, readonly invalidFailureKind: string, readonly emit: (entry: Omit<DiscoveryRequestLogEntry, "correlationId" | "route" | "method">) => Result<null, { readonly kind: string }> }} options
 * @returns {Promise<Result<unknown, { readonly kind: string }>>}
 */
async function runBoundedDependency(options) {
  const entryLogged = options.emit({ event: "dependency-entry", operation: options.operation, ...(options.ownerId === undefined ? {} : { ownerId: options.ownerId }), ...(options.sourceId === undefined ? {} : { sourceId: options.sourceId }), ...(options.runId === undefined ? {} : { runId: options.runId }) });
  if (!entryLogged.ok) return entryLogged;
  const timeoutMarker = Symbol("dependency-timeout");
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(timeoutMarker), options.timeoutMs);
  });
  try {
    const observed = await Promise.race([Promise.resolve().then(options.invoke), timeout]);
    if (observed === timeoutMarker) {
      const logged = options.emit({ event: "dependency-failure", operation: options.operation, failureKind: options.timeoutFailureKind, ...(options.ownerId === undefined ? {} : { ownerId: options.ownerId }), ...(options.sourceId === undefined ? {} : { sourceId: options.sourceId }), ...(options.runId === undefined ? {} : { runId: options.runId }) });
      if (!logged.ok) return logged;
      return { ok: false, error: { kind: options.timeoutFailureKind } };
    }
    if (!isResultEnvelope(observed)) {
      const logged = options.emit({ event: "dependency-failure", operation: options.operation, failureKind: options.invalidFailureKind, ...(options.ownerId === undefined ? {} : { ownerId: options.ownerId }), ...(options.sourceId === undefined ? {} : { sourceId: options.sourceId }), ...(options.runId === undefined ? {} : { runId: options.runId }) });
      if (!logged.ok) return logged;
      return { ok: false, error: { kind: options.invalidFailureKind } };
    }
    if (!observed.ok) {
      const dependencyError = isRecord(observed.error) && isNonEmptyText(observed.error.kind) ? observed.error.kind : null;
      const failureKind = dependencyError !== null && /^[A-Za-z0-9._:-]{1,128}$/u.test(dependencyError) ? dependencyError : options.invalidFailureKind;
      const logged = options.emit({ event: "dependency-failure", operation: options.operation, failureKind, ...(options.ownerId === undefined ? {} : { ownerId: options.ownerId }), ...(options.sourceId === undefined ? {} : { sourceId: options.sourceId }), ...(options.runId === undefined ? {} : { runId: options.runId }) });
      if (!logged.ok) return logged;
      return { ok: false, error: { kind: failureKind } };
    }
    if (!options.validate(observed.value)) {
      const logged = options.emit({ event: "dependency-failure", operation: options.operation, failureKind: options.invalidFailureKind, ...(options.ownerId === undefined ? {} : { ownerId: options.ownerId }), ...(options.sourceId === undefined ? {} : { sourceId: options.sourceId }), ...(options.runId === undefined ? {} : { runId: options.runId }) });
      if (!logged.ok) return logged;
      return { ok: false, error: { kind: options.invalidFailureKind } };
    }
    const itemCount = options.itemCount?.(observed.value);
    const logged = options.emit({ event: "dependency-success", operation: options.operation, ...(itemCount === undefined ? {} : { itemCount }), ...(options.ownerId === undefined ? {} : { ownerId: options.ownerId }), ...(options.sourceId === undefined ? {} : { sourceId: options.sourceId }), ...(options.runId === undefined ? {} : { runId: options.runId }) });
    if (!logged.ok) return logged;
    return { ok: true, value: observed.value };
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    const logged = options.emit({ event: "dependency-failure", operation: options.operation, failureKind: options.dependencyFailureKind, ...(options.ownerId === undefined ? {} : { ownerId: options.ownerId }), ...(options.sourceId === undefined ? {} : { sourceId: options.sourceId }), ...(options.runId === undefined ? {} : { runId: options.runId }) });
    if (!logged.ok) return logged;
    return { ok: false, error: { kind: options.dependencyFailureKind } };
  } finally {
    clearTimeout(timer);
  }
}

/** @param {{ readonly kind: string, readonly failures?: readonly unknown[] }} failure */
function centralSearchFailureResponse(failure) {
  const quotaOnly = failure.kind === "CentralSearchAllProvidersFailed" &&
    Array.isArray(failure.failures) && failure.failures.length > 0 &&
    failure.failures.every((entry) =>
      isRecord(entry) && isRecord(entry.failure) &&
      entry.failure.kind === "SearchProviderQuotaExceeded"
    );
  const status = failure.kind === "CentralSearchTimedOut"
    ? 503
    : failure.kind === "CentralSearchAllProvidersFailed"
    ? quotaOnly ? 429 : 503
    : failure.kind === "CentralSearchProviderDisabled"
    ? 409
    : 400;
  return json({ error: failure.kind }, status);
}

/** @param {unknown} value @returns {value is { readonly jobId: string }} */
function validSourceIngestionCommand(value) {
  return isRecord(value) && Object.keys(value).length === 1 &&
    typeof value.jobId === "string" && value.jobId.trim() !== "";
}

/** @param {unknown} value */
function validWikimediaCommand(value) {
  if (!isRecord(value)) return false;
  const fields = ["sourceId", "sourceRevision", "itemId", "itemVersionId", "language"];
  return Object.keys(value).length === fields.length && fields.every((field) =>
    Object.hasOwn(value, field)
  );
}

/** @param {string} pathname @returns {"approve" | "revise" | "disable" | "restore" | "reject" | null} */
function sourceLibraryAction(pathname) {
  const prefix = "/api/source-library/";
  if (!pathname.startsWith(prefix)) return null;
  const action = pathname.slice(prefix.length);
  return action === "approve" || action === "revise" || action === "disable" ||
      action === "restore" || action === "reject"
    ? action
    : null;
}

/** @param {WorkerFailure} failure */
function failureResponse(failure) {
  const status = failure.kind === "DiscoveryClientUnauthenticated" ||
      failure.kind === "DiscoveryAccessTokenMissing" ||
      failure.kind === "DiscoveryAccessTokenInvalid"
    ? 401
    : failure.kind === "DiscoveryClientUnauthorized" ||
        failure.kind === "DiscoveryOriginRejected" ||
        failure.kind === "DiscoveryAccessAudienceMismatch" ||
        failure.kind === "DiscoveryAccessIdentityUnmapped"
    ? 403
    : failure.kind === "YouTubeSearchQuotaExceeded" ||
        failure.kind === "YouTubeGeneralQuotaExceeded" ||
        failure.kind === "YouTubeProviderQuotaExceeded"
    ? 429
    : failure.kind === "DiscoveryRequestTooLarge" ||
        failure.kind === "DiscoveryPayloadTooLarge"
    ? 413
    : failure.kind === "DiscoveryAuthenticationFailed"
    ? 503
    : failure.kind === "DiscoveryRequestLoggingFailed"
    ? 503
    : failure.kind === "DiscoveryFetchTimedOut"
    ? 504
    : failure.kind === "DiscoveryFetchUnavailable" ||
        failure.kind === "YouTubeCredentialMissing" ||
        failure.kind === "YouTubeCredentialRefreshUnavailable" ||
        failure.kind === "YouTubeUpstreamUnavailable"
    ? 503
    : failure.kind === "DiscoveryHttpRejected" ||
        failure.kind === "YouTubeCredentialRejected" ||
        failure.kind === "YouTubeResponseInvalid"
    ? 502
    : 400;
  return json({ error: failure.kind }, status);
}

/** @param {{ readonly kind: string }} failure */
function sourceClassificationFailureResponse(failure) {
  const status = failure.kind === "SourceClassificationSourceMissing" ? 404
    : failure.kind === "SourceClassificationRevisionConflict" ? 409
    : failure.kind === "SourceClassificationPersistenceFailed" ? 503
    : 400;
  return json({ error: failure.kind }, status);
}

/** @param {{ readonly kind: string }} failure */
function sourceClassificationBackfillFailureResponse(failure) {
  const status = failure.kind === "BackfillUnavailable" ? 503
    : failure.kind.endsWith("Failed") || failure.kind === "BackfillResponseInvalid" ? 503
    : 400;
  return json({ error: failure.kind }, status);
}

/** @param {{ readonly kind: string, readonly field?: string, readonly sourceId?: string, readonly state?: string, readonly revision?: number }} failure */
function sourceFailureResponse(failure) {
  const status = failure.kind === "SourceOwnerMismatch" ||
      failure.kind === "SourceCursorOwnerMismatch"
    ? 403
    : failure.kind === "SourceNotFound"
    ? 404
    : failure.kind === "SourceIdentityMissing" ||
        failure.kind === "SourceIdentityAmbiguous" ||
        failure.kind === "SourceIdentityConflict" ||
        failure.kind === "SourceRevisionStale" ||
        failure.kind === "SourceStateConflict" ||
        failure.kind === "SourceInterestAreaMissing" ||
        failure.kind === "SourceIdempotencyConflict" ||
        failure.kind === "SourceCursorStale"
    ? 409
    : failure.kind === "SourceApprovalPersistenceFailed" ||
        failure.kind === "SourceCrawlEnqueueFailed" ||
        failure.kind === "SourceDisablePersistenceFailed" ||
        failure.kind === "SourceSuppressionFailed" ||
        failure.kind === "SourceCatalogReadFailed" ||
        failure.kind === "SourceCatalogDependencyFailed" ||
        failure.kind === "SourceCatalogResponseInvalid" ||
        failure.kind === "SourceKeywordSearchUnavailable" ||
        failure.kind === "SourceEmbeddingUnavailable" ||
        failure.kind === "SourceSemanticIndexUnavailable" ||
        failure.kind === "SourceSemanticConsentRequired" ||
        failure.kind === "SourceSemanticIndexOutOfSync"
    ? 503
    : failure.kind === "SourceCatalogDependencyTimedOut"
    ? 504
    : failure.kind === "DiscoveryRequestLoggingFailed"
    ? 503
    : 400;
  const conflict = failure.kind === "SourceStateConflict" &&
      typeof failure.sourceId === "string" && failure.sourceId.trim() !== "" &&
      (failure.state === "active" || failure.state === "disabled") &&
      typeof failure.revision === "number" && Number.isInteger(failure.revision) && failure.revision >= 1
    ? { sourceId: failure.sourceId, state: failure.state, revision: failure.revision }
    : {};
  return json({ error: failure.kind, ...conflict }, status);
}

/** @param {RightsApprovalFailure} failure */
function rightsApprovalFailureResponse(failure) {
  const status = failure.kind === "RightsApprovalSourceNotFound"
    ? 404
    : failure.kind === "RightsApprovalSourceDisabled" || failure.kind === "RightsApprovalRevisionStale" || failure.kind === "RightsApprovalRootMismatch" || failure.kind === "RightsApprovalEvidenceConflict" || failure.kind === "RightsApprovalIdempotencyConflict"
    ? 409
    : failure.kind === "RightsApprovalPersistenceFailed"
    ? 503
    : 400;
  return json({ error: failure.kind }, status);
}

/** @param {{ readonly kind: string }} failure */
function ingestionFailureResponse(failure) {
  const status = failure.kind === "ManualUploadOwnerMismatch" ? 403
    : failure.kind === "ManualUploadSourceNotFound" || failure.kind === "ManualUploadItemNotFound" ? 404
    : failure.kind === "IngestionJobLeaseConflict" || failure.kind === "IngestionSourceRevisionStale" || failure.kind === "ManualUploadRevisionStale" || failure.kind === "ManualUploadIdempotencyConflict" ? 409
    : failure.kind === "IngestionPersistenceFailed" || failure.kind === "ManualUploadPersistenceFailed" || failure.kind === "SourceContentObjectWriteFailed" || failure.kind === "SourceContentObjectCleanupFailed" || failure.kind.endsWith("FetchFailed") ? 503
    : 400;
  return json({ error: failure.kind }, status);
}

/** @param {unknown} value @returns {readonly Record<string, unknown>[] | null} */
function publicPublishedQuizzes(value) {
  if (!Array.isArray(value)) return null;
  const quizzes = [];
  for (const task of value) {
    if (!isRecord(task) || !isNonEmptyText(task.id) || !isNonEmptyText(task.prompt) || !isNonEmptyText(task.explanation) || !isNonEmptyText(task.kind) || task.status !== "published" || !isPositiveInteger(task.revision) || !Array.isArray(task.sourceAnchorIds) || task.sourceAnchorIds.length === 0 || task.sourceAnchorIds.some((anchor) => !isNonEmptyText(anchor))) return null;
    if (task.choices !== null && (!Array.isArray(task.choices) || task.choices.length === 0 || task.choices.some((choice) => !isRecord(choice) || !isNonEmptyText(choice.id) || !isNonEmptyText(choice.label)))) return null;
    if (task.correctChoiceIds !== null && (!Array.isArray(task.correctChoiceIds) || task.correctChoiceIds.length === 0 || task.correctChoiceIds.some((id) => !isNonEmptyText(id)))) return null;
    const sourceAnchorIds = /** @type {string[]} */ (task.sourceAnchorIds);
    const choices = task.choices === null ? null : /** @type {{ readonly id: string, readonly label: string }[]} */ (task.choices);
    const correctChoiceIds = task.correctChoiceIds === null ? null : /** @type {string[]} */ (task.correctChoiceIds);
    quizzes.push(Object.freeze({ id: task.id, kind: task.kind, prompt: task.prompt, explanation: task.explanation, sourceAnchorIds: Object.freeze([...sourceAnchorIds]), choices: choices === null ? null : Object.freeze(choices.map((choice) => Object.freeze({ id: choice.id, label: choice.label }))), correctChoiceIds: correctChoiceIds === null ? null : Object.freeze([...correctChoiceIds]), status: "published", revision: task.revision }));
  }
  return Object.freeze(quizzes);
}

/** @param {{ readonly kind: string }} failure */
function learningGenerationFailureResponse(failure) {
  const status = failure.kind === "LearningReviewTaskUnknown"
    ? 404
    : failure.kind === "LearningReviewRevisionStale" || failure.kind === "LearningReviewAlreadyDecided" || failure.kind === "LearningReviewIdempotencyConflict" || failure.kind === "LearningRevocationConflict" || failure.kind === "LearningFreshRightsRequired"
    ? 409
    : failure.kind.endsWith("PersistenceFailed") || failure.kind === "LearningProviderUnavailable" || failure.kind === "LearningProviderTimeout" || failure.kind === "LearningProviderCredentialMissing" || failure.kind === "LearningBudgetExceeded"
    ? 503
    : 400;
  return json({ error: failure.kind }, status);
}

/** @param {{ readonly kind: string }} failure */
function learningBatchFailureResponse(failure) {
  const status = failure.kind === "KnowledgePairNotFound"
    ? 404
    : failure.kind === "LearningBatchIncomplete" ||
        failure.kind === "LearningBatchAlreadyClosed" ||
        failure.kind === "ReviewRefreshLocked" ||
        failure.kind === "ReviewReplacementUnavailable" || failure.kind === "ReviewAnswerNotAllowed" || failure.kind === "ReviewRemovalNotAllowed" || failure.kind === "ClassificationConflict"
    ? 409
    : failure.kind === "ProgressReadUnavailable" || failure.kind === "ProgressHistoryLimitExceeded" || failure.kind === "ProgressDataInvalid" || failure.kind === "ClassificationWriteUnavailable" || failure.kind === "LearningBatchUnavailable" ||
        failure.kind === "ReviewGradePending" || failure.kind === "ReviewGradingUnavailable" ||
        failure.kind === "LearningBatchPersistenceFailed" ||
        failure.kind === "KnowledgePurgeFailed" ||
        failure.kind === "LearningPreferencePersistenceFailed"
    ? 503
    : 400;
  return json({ error: failure.kind }, status);
}

/** @param {{ readonly kind: string }} failure */
function knowledgeWorkflowFailureResponse(failure) {
  const status = failure.kind === "WorkflowNotFound"
    ? 404
    : failure.kind === "WorkflowControlStale" || failure.kind === "WorkflowIdempotencyConflict" || failure.kind === "WorkflowControlInvalid" || failure.kind === "WorkflowMaterialIdempotencyConflict" || failure.kind === "WorkflowMaterialConflict"
    ? 409
    : failure.kind === "KnowledgeWorkflowUnavailable" || failure.kind === "KnowledgeWorkflowDependencyFailed" || failure.kind === "KnowledgeWorkflowResultInvalid" || failure.kind === "WorkflowPersistenceFailed" || failure.kind === "WorkflowStatusProjectionInvalid" || failure.kind === "WorkflowSourceStatusProjectionInvalid" || failure.kind === "WorkflowCleanupFailed" || failure.kind === "ImageWarningReadFailed" || failure.kind === "WorkflowInstanceControlFailed" || failure.kind === "WorkflowInstanceEventFailed" || failure.kind === "WorkflowMaterialPersistenceFailed" || failure.kind === "WorkflowMaterialStorageFailed" || failure.kind === "WorkflowMaterialCleanupFailed" || failure.kind === "WorkflowMaterialAttachFailed" || failure.kind === "BackfillResponseInvalid" || failure.kind === "BackfillSourceListFailed" || failure.kind === "BackfillSourceInvalid" || failure.kind === "BackfillStartFailed" || failure.kind === "BackfillReuseInvalidationFailed" || failure.kind === "BackfillMarkerReadFailed" || failure.kind === "BackfillMarkerWriteFailed" || failure.kind === "BackfillContentResetFailed" || failure.kind === "ReplayResponseInvalid" || failure.kind === "ReplaySourceListFailed" || failure.kind === "ReplaySourceInvalid" || failure.kind === "ReplayStartFailed" || failure.kind === "ReplayReuseInvalidationFailed" || failure.kind === "ReplayMarkerReadFailed" || failure.kind === "ReplayMarkerWriteFailed" || failure.kind === "ReplayContentResetFailed"
    ? 503
    : failure.kind === "KnowledgeWorkflowDependencyTimedOut"
    ? 504
    : failure.kind === "DiscoveryRequestLoggingFailed"
    ? 503
    : 400;
  return json({ error: failure.kind }, status);
}

/** @param {unknown} value @param {string} ownerId @returns {{ readonly status: "completed" | "already-completed", readonly ownerId: string, readonly sourceCount: number, readonly runIds: readonly string[] } | null} */
function publicBackfillResult(value, ownerId) {
  if (!isRecord(value) || value.ownerId !== ownerId || (value.status !== "completed" && value.status !== "already-completed") || !(typeof value.sourceCount === "number" && Number.isSafeInteger(value.sourceCount) && value.sourceCount >= 0) || !Array.isArray(value.runIds) || value.runIds.length > 1_000 || !value.runIds.every(isNonEmptyText)) return null;
  return Object.freeze({ status: value.status, ownerId, sourceCount: value.sourceCount, runIds: Object.freeze([...value.runIds]) });
}

/** @param {unknown} value @param {string} ownerId @returns {{ readonly status: "completed" | "already-completed", readonly ownerId: string, readonly sourceCount: number, readonly runIds: readonly string[], readonly blockedSources: readonly { readonly sourceId: string, readonly title: string, readonly reasonCode: string, readonly message: string }[] } | null} */
function publicReplayResult(value, ownerId) {
  if (!isRecord(value) || value.ownerId !== ownerId || (value.status !== "completed" && value.status !== "already-completed") || !(typeof value.sourceCount === "number" && Number.isSafeInteger(value.sourceCount) && value.sourceCount >= 0) || !Array.isArray(value.runIds) || value.runIds.length > 1_000 || !value.runIds.every(isNonEmptyText) || !Array.isArray(value.blockedSources) || value.blockedSources.length > value.sourceCount) return null;
  const blockedSources = [];
  for (const source of value.blockedSources) {
    if (!isRecord(source) || !isNonEmptyText(source.sourceId) || !isNonEmptyText(source.title) || !isNonEmptyText(source.reasonCode) || !isNonEmptyText(source.message)) return null;
    blockedSources.push(Object.freeze({ sourceId: source.sourceId, title: source.title, reasonCode: source.reasonCode, message: source.message }));
  }
  return Object.freeze({ status: value.status, ownerId, sourceCount: value.sourceCount, runIds: Object.freeze([...value.runIds]), blockedSources: Object.freeze(blockedSources) });
}

/** @param {string | null} failureKind @param {string} state @param {number | null} remainingMs @returns {{ readonly reasonCode: "partial-failure" | "failed" | "paywall-or-login" | "robots-blocked" | "robots-check-unavailable" | "audio-video-transcription-unavailable" | "rights-not-verified" | "upload-content" | "retryable-failure", readonly message: string } | null} */
function workflowStatusReason(failureKind, state, remainingMs) {
  if(state==='retryable-failure'&&failureKind?.endsWith(':automatic-retries-exhausted')){
    const cause=workflowStatusReason(failureKind.slice(0,-':automatic-retries-exhausted'.length),state,remainingMs);
    return Object.freeze({reasonCode:'retryable-failure',message:`${cause?.message??'Processing could not continue.'} Automatic recovery stopped after four resumes without new published progress. Saved knowledge and quizzes are retained. Choose Continue processing to try again, or report this source if the problem persists.`});
  }
  if (state === "completed" && (failureKind === "WorkflowPagesFailed" || failureKind === "WorkflowQuizItemsFailed")) return Object.freeze({reasonCode:"partial-failure",message:"Processing finished for the remaining content. Some items could not be processed after retries. Review the failed items and choose whether to retry them."});
  if(failureKind?.startsWith("WorkflowExtractionFailed:")){
    const cause=workflowStatusReason(failureKind.slice("WorkflowExtractionFailed:".length),"failed",null)?.message??"Automatic processing could not finish for this source.";
    return Object.freeze({reasonCode:"failed",message:state==="awaiting-upload"?`${cause} Would you like to open the website, gather the relevant page links or content yourself, and continue in Upload? Choose Upload text or documents to continue, or cancel to keep this source in Library.`:`${cause} This source and any saved knowledge or quiz drafts remain in Library. You can retry processing or upload source content.`});
  }
  if (state === "awaiting-upload" && failureKind === null) return Object.freeze({reasonCode:"upload-content",message:"This source is awaiting material attachment. If the previous upload is missing, re-upload the material to start processing."});
  const normalized = (failureKind ?? "").toLowerCase();
  if(state==='retryable-failure'){
    let cause;
    if(/d1-daily-quota/u.test(normalized))cause="The database's daily Free plan allowance has been exhausted. Automatic recovery waits until the allowance resets at midnight UTC; retrying before then will not help.";
    else if(/workflowcputimelimitexceeded|cpu-limit/u.test(normalized))cause="Processing reached Cloudflare's CPU time limit after retries. Continue processing to resume from saved progress with smaller batches. If it stops again, report this source so the remaining expensive step can be fixed.";
    else if(/workflowsubrequestlimitexceeded|subrequest-limit/u.test(normalized))cause="Processing reached Cloudflare's request limit for one execution. Continue processing to resume from saved progress with smaller batches.";
    else if(/credential|:http-(401|403)/u.test(normalized))cause="The processing service's credentials are missing, expired, or lack access. Automatic retries are paused. The site administrator must correct the provider credentials, then continue processing.";
    else if(/sqlite-constraint|sqlite-schema|sqlite-too-big|sqlite-limit/u.test(normalized))cause="A database structure, integrity, or size error prevented saving progress. Retrying the same step may fail again; report this source so the site administrator can fix the database error.";
    else if(/d1-reset|d1-network|d1-overloaded|sqlite-busy|persistencefailed/u.test(normalized))cause="The database could not reliably save or retrieve processing progress. Processing has stopped after retries. Continue processing to retry from the last saved checkpoint.";
    else if(/knowledgebrowser|knowledgepagefetchfailed|firecrawlbrowser/u.test(normalized))cause="The webpage could not be loaded or captured successfully after retries. The website or capture service may be unavailable. Continue processing to try again, or upload an authorized copy of the source.";
    else if(/coverageincomplete|materialbatchincomplete|webpagefacts|webpageevidence/u.test(normalized))cause="Processing could not verify complete coverage of the captured content. The source has not been marked complete. Continue processing to retry the unfinished content; if it stops again, report this source.";
    else if(/knowledgemodelunavailable|knowledgemodelrejected|knowledgemodeltimeout|responsereadfailed/u.test(normalized))cause="The AI provider was unavailable, rate-limited, or did not respond successfully. Continue processing to retry from saved progress once the provider recovers.";
    else if(/outputinvalid|responseinvalid|responsemalformed|schemainvalid|evidenceinvalid/u.test(normalized))cause="The AI returned output that did not meet the required format or evidence checks after correction attempts. Continue processing to retry the unfinished work; previously accepted knowledge is retained.";
    if(cause)return Object.freeze({reasonCode:'retryable-failure',message:`${cause} Your saved knowledge and quizzes have been retained.`});
  }
  if (/knowledgebrowsernavigationfailed/u.test(normalized)) return Object.freeze({reasonCode:"failed",message:"The browser could not load this web source."});
  if (state === "extraction-loop" && remainingMs === 0) return Object.freeze({ reasonCode: "retryable-failure", message: "Automatic extraction stopped after its processing deadline elapsed. Any saved progress has been retained." });
  if (/extractionplaninvalid/u.test(normalized)) return Object.freeze({ reasonCode: "retryable-failure", message: "Automatic extraction stopped because the planner returned an invalid ExtractionPlan after one correction attempt (ExtractionPlanInvalid). Retry processing to try again." });
  if (state === "retryable-failure" && normalized.includes("knowledgemodelpaymentrequired")) return Object.freeze({reasonCode:"retryable-failure",message:"The model provider declined processing (HTTP 402). Check account credits and key spending limits, then continue processing. Your saved knowledge and quizzes have been retained."});
  if (state === "retryable-failure" && normalized.includes("workflowstagecalluncertain")) return Object.freeze({reasonCode:"retryable-failure",message:"Processing paused because an AI request's result could not be confirmed. It may already have been billed, so it will not be sent again automatically. Choose Continue processing to authorize recovery of unfinished work. Your extracted knowledge and completed quizzes have been retained."});
  if (state === "retryable-failure" && normalized.includes("workflowexecutionstopped")) return Object.freeze({reasonCode:"retryable-failure",message:"Processing stopped unexpectedly. Your saved progress has been retained. Continue processing to resume."});
  if (state === "retryable-failure") return Object.freeze({ reasonCode: "retryable-failure", message: "Processing stopped with an unclassified error. Your saved knowledge and quizzes have been retained. Continue processing to resume; if it stops again, report this source so the site administrator can investigate the backend logs." });
  if (/paywall|authentication|login|authenticated/u.test(normalized)) return Object.freeze({ reasonCode: "paywall-or-login", message: "This source could not be scraped because it is behind a paywall or requires sign-in. Upload authorized text, PDF, PPTX, or a transcript instead." });
  if (/knowledgepagebotaccessdenied/u.test(normalized)) return Object.freeze({ reasonCode: "upload-content", message: "The source website blocked automated access. Processing is waiting for authorized text, PDF, PPTX, or a transcript to be uploaded." });
  if (/knowledgepageratelimited/u.test(normalized)) return Object.freeze({ reasonCode: "upload-content", message: "The source website rate-limited automated access. Processing is waiting for authorized text, PDF, PPTX, or a transcript to be uploaded." });
  if (/audio|video|transcri/u.test(normalized)) return Object.freeze({ reasonCode: "audio-video-transcription-unavailable", message: "This source contains audio or video, but native audio/video transcription is not available yet. Upload an authorized transcript or text/document instead." });
  if (/robotsdenied|robotsblocked/u.test(normalized)) return Object.freeze({ reasonCode: "robots-blocked", message: "This source cannot be scraped because its robots policy blocks the workflow. Upload authorized text, PDF, PPTX, or a transcript instead." });
  if (/robotstargetunavailable/u.test(normalized)) return Object.freeze({ reasonCode: "robots-check-unavailable", message: "The source's robots.txt returned HTTP 403 and the source page could not be reached by the browser. Upload authorized text, PDF, PPTX, or a transcript instead." });
  if (/robots/u.test(normalized)) return Object.freeze({ reasonCode: "robots-check-unavailable", message: "This source's robots.txt could not be verified. Upload authorized text, PDF, PPTX, or a transcript instead." });
  if (state === "awaiting-upload" || /rights|upload|required|registry/u.test(normalized)) return Object.freeze({ reasonCode: "rights-not-verified", message: "Automatic scraping is blocked because permission or access evidence is not verified. Upload authorized text, PDF, PPTX, or a transcript instead." });
  return null;
}

/** @param {unknown} value @param {string} ownerId @param {string | undefined} nowValue @returns {{ readonly sourceId: string, readonly run: ReturnType<typeof publicWorkflowStatus>, readonly reasonCode: string | null, readonly message: string | null } | null} */
function publicSourceWorkflowStatus(value, ownerId, nowValue) {
  if (!isRecord(value) || value.ownerId !== undefined && value.ownerId !== ownerId || !isNonEmptyText(value.sourceId) || (value.run !== null && !isRecord(value.run))) return null;
  const run = value.run === null ? null : publicWorkflowStatus(value.run, nowValue);
  if (value.run !== null && run === null) return null;
  const reason = run === null ? null : workflowStatusReason(run.failureKind, run.state, run.remainingMs);
  const warnings=value.imageWarnings ?? [];
  if(!Array.isArray(warnings)||!warnings.every(isNonEmptyText))return null;
  const mediaNotice=warnings.some(warning=>warning.startsWith('Image warning:'))?'Some source images were omitted. Extracted knowledge has been retained.':null;
  return Object.freeze({ sourceId: value.sourceId, run, reasonCode: reason?.reasonCode ?? null, message: [reason?.message,mediaNotice].filter(Boolean).join(" ") || null });
}

/** @param {unknown} value @returns {{ readonly robotsUrl: string, readonly targetUrl: string, readonly httpStatus: number, readonly availability: "present" | "absent" | "unavailable", readonly content: string, readonly checkedAt: string, readonly matchedRule: string | null } | null} */
function publicRobotsEvidence(value) {
  if (!isWorkflowRobotsEvidence(value)) return null;
  return Object.freeze({ robotsUrl: value.robotsUrl, targetUrl: value.targetUrl, httpStatus: value.httpStatus, availability: value.availability, content: value.content, checkedAt: value.checkedAt, matchedRule: value.matchedRule });
}

/** @param {unknown} value @param {string | undefined} nowValue @returns {{ readonly runId: string, readonly state: string, readonly revision: number, readonly counts: { readonly pages: number, readonly knowledgePoints: number, readonly acceptedQuizzes: number, readonly pendingQuizzes: number }, readonly extractionStartedAt: string | null, readonly extractionDeadlineAt: string | null, readonly elapsedMs: number | null, readonly remainingMs: number | null, readonly decisionRequired: string | null, readonly failureKind: string | null, readonly robotsEvidence: ReturnType<typeof publicRobotsEvidence> } | null} */
function publicWorkflowStatus(value, nowValue) {
  if (!isRecord(value) || !isNonEmptyText(value.runId) || !isNonEmptyText(value.state) || typeof value.revision !== "number" || !Number.isSafeInteger(value.revision) || value.revision < 1 || !isRecord(value.counts)) return null;
  const revision = value.revision;
  const counts = value.counts;
  const countValues = [counts.pages, counts.knowledgePoints, counts.acceptedQuizzes, counts.pendingQuizzes];
  if (!countValues.every((count) => typeof count === "number" && Number.isSafeInteger(count) && count >= 0) || (value.extractionStartedAt !== null && !isNonEmptyText(value.extractionStartedAt)) || (value.extractionDeadlineAt !== null && !isNonEmptyText(value.extractionDeadlineAt)) || (value.decisionRequired !== null && !isNonEmptyText(value.decisionRequired)) || (value.failureKind !== null && !isNonEmptyText(value.failureKind))) return null;
  const pages = /** @type {number} */ (counts.pages);
  const knowledgePoints = /** @type {number} */ (counts.knowledgePoints);
  const acceptedQuizzes = /** @type {number} */ (counts.acceptedQuizzes);
  const pendingQuizzes = /** @type {number} */ (counts.pendingQuizzes);
  let elapsedMs = null;
  let remainingMs = null;
  if (value.extractionStartedAt !== null || value.extractionDeadlineAt !== null) {
    if (nowValue === undefined || !isNonEmptyText(nowValue) || !Number.isFinite(Date.parse(nowValue)) || value.extractionStartedAt === null || value.extractionDeadlineAt === null) return null;
    const nowMs = Date.parse(nowValue);
    const startedMs = Date.parse(value.extractionStartedAt);
    const deadlineMs = Date.parse(value.extractionDeadlineAt);
    if (!Number.isFinite(nowMs) || !Number.isFinite(startedMs) || !Number.isFinite(deadlineMs) || deadlineMs < startedMs) return null;
    elapsedMs = Math.max(0, nowMs - startedMs);
    remainingMs = Math.max(0, deadlineMs - nowMs);
  }
  const robotsEvidence = value.robotsEvidence === undefined || value.robotsEvidence === null ? null : publicRobotsEvidence(value.robotsEvidence);
  if (value.robotsEvidence !== undefined && value.robotsEvidence !== null && robotsEvidence === null) return null;
  const progress = value.progress === undefined ? undefined : parseWorkflowProgress(value.progress);
  if (progress === null) return null;
  return Object.freeze({ runId: value.runId, state: value.state, revision, counts: Object.freeze({ pages, knowledgePoints, acceptedQuizzes, pendingQuizzes }), extractionStartedAt: value.extractionStartedAt, extractionDeadlineAt: value.extractionDeadlineAt, elapsedMs, remainingMs, decisionRequired: value.decisionRequired, failureKind: value.failureKind, robotsEvidence, ...(progress === undefined ? {} : {progress}) });
}

/** @param {Request} request @param {number} maximumRequestBytes @param {number} maximumMaterialBytes @returns {Promise<Result<Record<string, unknown> & { readonly bytes: Uint8Array }, { readonly kind: string }>>} */
async function readWorkflowMaterialRequest(request, maximumRequestBytes, maximumMaterialBytes) {
  const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
  if (contentType.startsWith("multipart/form-data")) {
    let form;
    try { form = await request.formData(); } catch (error) { return { ok: false, error: { kind: "WorkflowMaterialCommandInvalid" } }; }
    if (form.has("ownerId")) return { ok: false, error: { kind: "WorkflowMaterialCommandInvalid" } };
    const file = form.get("file") ?? form.get("material");
    const textContent = form.get("content");
    let bytes;
    let fileName = stringFormValue(form, "fileName") ?? "pasted-text.txt";
    let mediaType = stringFormValue(form, "mediaType") ?? "text/plain";
    if (file instanceof Blob) {
      if (file.size > maximumMaterialBytes) return { ok: false, error: { kind: "MaterialByteLimitExceeded" } };
      try { bytes = new Uint8Array(await file.arrayBuffer()); } catch (error) { return { ok: false, error: { kind: "WorkflowMaterialCommandInvalid" } }; }
      if (file instanceof File && file.name.trim() !== "") fileName = file.name;
      if (file.type.trim() !== "") mediaType = file.type;
    } else if (typeof textContent === "string") {
      bytes = new TextEncoder().encode(textContent);
      if (bytes.byteLength > maximumMaterialBytes) return { ok: false, error: { kind: "MaterialByteLimitExceeded" } };
    } else return { ok: false, error: { kind: "WorkflowMaterialCommandInvalid" } };
    const mode = stringFormValue(form, "mode") ?? "text";
    if (mode !== "text" && mode !== "image") return { ok: false, error: { kind: "WorkflowMaterialCommandInvalid" } };
    const command = Object.freeze({ runId: stringFormValue(form, "runId"), sourceId: stringFormValue(form, "sourceId"), sourceRevision: Number(stringFormValue(form, "sourceRevision")), sourceUrl: stringFormValue(form, "sourceUrl"), mediaType, fileName, mode, idempotencyKey: stringFormValue(form, "idempotencyKey"), bytes });
    return { ok: true, value: /** @type {Record<string, unknown> & { readonly bytes: Uint8Array }} */ (command) };
  }
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumRequestBytes) return { ok: false, error: { kind: "DiscoveryRequestTooLarge" } };
  let body;
  try {
    const payload = await request.arrayBuffer();
    if (payload.byteLength > maximumRequestBytes) return { ok: false, error: { kind: "DiscoveryRequestTooLarge" } };
    body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(payload));
  } catch (error) {
    return { ok: false, error: { kind: "WorkflowMaterialCommandInvalid" } };
  }
  if (!isRecord(body) || Object.hasOwn(body, "ownerId")) return { ok: false, error: { kind: "WorkflowMaterialCommandInvalid" } };
  let bytes;
  if (typeof body.content === "string") bytes = new TextEncoder().encode(body.content);
  else if (typeof body.bytesBase64 === "string") {
    const decoded = decodeBase64(body.bytesBase64, maximumMaterialBytes);
    if (decoded === null) return { ok: false, error: { kind: "WorkflowMaterialCommandInvalid" } };
    bytes = decoded;
  } else return { ok: false, error: { kind: "WorkflowMaterialCommandInvalid" } };
  if (bytes.byteLength > maximumMaterialBytes) return { ok: false, error: { kind: "MaterialByteLimitExceeded" } };
  const { content: _content, bytesBase64: _bytesBase64, ...metadata } = body;
  const mode = metadata.mode === undefined ? "text" : metadata.mode;
  if (mode !== "text" && mode !== "image") return { ok: false, error: { kind: "WorkflowMaterialCommandInvalid" } };
  return { ok: true, value: /** @type {Record<string, unknown> & { readonly bytes: Uint8Array }} */ ({ ...metadata, mode, bytes, mediaType: typeof metadata.mediaType === "string" ? metadata.mediaType : "text/plain", fileName: typeof metadata.fileName === "string" ? metadata.fileName : "pasted-text.txt" }) };
}

/** @param {FormData} form @param {string} name @returns {string | null} */
function stringFormValue(form, name) { const value = form.get(name); return typeof value === "string" && value.trim() !== "" ? value.trim() : null; }
/** @param {string} value @param {number} maximumBytes @returns {Uint8Array | null} */
function decodeBase64(value, maximumBytes) {
  if (value.length > Math.ceil(maximumBytes * 4 / 3) + 4 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(value) || value.length % 4 === 1) return null;
  try { const binary = atob(value); if (binary.length > maximumBytes) return null; const bytes = new Uint8Array(binary.length); for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index); return bytes; } catch (error) { return null; }
}

/** @param {{ readonly kind: string }} failure */
function mediaFailureResponse(failure) {
  const status = failure.kind === "MediaDerivativeNotFound" ? 404 : failure.kind === "MediaDerivativeRevoked" ? 410 : failure.kind === "LearningMediaUnavailable" ? 503 : 400;
  return json({ error: failure.kind }, status);
}

/** @param {unknown} body @param {number} status @param {HeadersInit} [headers] */
function json(body, status, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

/** @param {unknown} value @returns {value is string} */
function isNonEmptyText(value) { return typeof value === "string" && value.trim() !== ""; }
/** @param {unknown} value @returns {value is number} */
function isPositiveInteger(value) { return typeof value === "number" && Number.isSafeInteger(value) && value > 0; }

/** @param {string | undefined} value @returns {string} */
function utcDay(value) {
  const parsed = typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value) : new Date();
  return parsed.toISOString().slice(0, 10);
}

/** @param {import("../src/features/source-library/rename.js").SourceRenameFailure} failure */
function sourceRenameFailureResponse(failure) {
  const status = failure.kind === "SourceRenameCommandInvalid" ? 400 : failure.kind === "SourceUploadContextUnavailable" ? 404 : failure.kind === "SourceRenameConflict" || failure.kind === "SourceRenameIdempotencyConflict" ? 409 : 503;
  return json({ error: failure.kind }, status);
}
