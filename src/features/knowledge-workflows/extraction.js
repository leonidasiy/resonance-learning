// @ts-check
import { isInlineLinks } from './inline-links.js';

/** @template T, E @typedef {{ readonly ok: true, readonly value: T } | { readonly ok: false, readonly error: E }} Result */

/**
 * @typedef {{
 *   readonly id: string,
 *   readonly priority: "high" | "normal",
 *   readonly description: string
 * }} ExtractionGap
 */

/**
 * @typedef {{
 *   readonly revision: number,
 *   readonly frontier: readonly string[],
 *   readonly coverageGoals: readonly { readonly id: string, readonly priority: "high" | "normal", readonly description: string }[],
 *   readonly unresolvedGaps: readonly ExtractionGap[],
 *   readonly stopDecision: ExtractionStopDecision
 * }} ExtractionPlan
 */

/**
 * @typedef {{
 *   readonly decision: "continue" | "complete" | "blocked",
 *   readonly rationale: string,
 *   readonly evidenceUrls: readonly string[],
 *   readonly unresolvedGapIds: readonly string[]
 * }} ExtractionStopDecision
 */

/**
 * @typedef {{
 *   readonly url: string,
 *   readonly selector: string,
 *   readonly blockId?: string,
 *   readonly visibleEvidence?: string,
 *   readonly quote?: string,
 *   readonly inlineLinks?: readonly import('./inline-links.js').InlineLink[],
 *   readonly clause?: string,
 *   readonly quoteDigest?: string
 * }} EvidenceAnchor
 */

/**
 * @typedef {{
 *   readonly comparedLocalHash: string,
 *   readonly score: number,
 *   readonly decision: "distinct" | "merge" | "ambiguous"
 * }} SimilarityEvidence
 */

/** @typedef {{ readonly visualId: string }} VisualMediaReference */

/**
 * @typedef {{
 *   readonly summary: string,
 *   readonly normalizedHash: string,
 *   readonly evidenceAnchors: readonly EvidenceAnchor[],
 *   readonly coverageGoalIds: readonly string[],
 *   readonly mediaCandidates: readonly (VisualMediaReference | unknown)[],
 *   readonly classification?: unknown,
 *   readonly similarity?: SimilarityEvidence
 * }} KnowledgeCandidate
 */

/**
 * @typedef {{
 *   readonly url: string,
 *   readonly responseUrl?: string,
 *   readonly contentDigest?: string,
 *   readonly title: string,
 *   readonly byteCount: number,
 *   readonly redirects: number,
 *   readonly links: readonly string[],
 *   readonly observedAt: string,
 *   readonly candidates: readonly KnowledgeCandidate[],
 *   readonly notes?: string
 }} PageObservation
 */

/** @typedef {{ readonly url: string, readonly title: string, readonly failureKind: string, readonly attempts: number, readonly failedAt: string }} ExtractionFailedPage */

/** @typedef {{ readonly url: string, readonly title: string, readonly note: string, readonly observedAt: string, readonly linkCount: number, readonly candidateCount: number }} ExtractionPageNote */

/**
 * @typedef {{
 *   readonly id: string,
 *   readonly sourceId: string,
 *   readonly sourceRevision: number,
 *   readonly summary: string,
 *   readonly normalizedHash: string,
 *   readonly evidenceAnchors: readonly EvidenceAnchor[],
 *   readonly coverageGoalIds: readonly string[],
 *   readonly mediaCandidates: readonly (VisualMediaReference | unknown)[],
 *   readonly attribution: { readonly sourceUrl: string },
 *   readonly extractionVersion: string,
 *   readonly classification?: unknown
 * }} KnowledgePoint
 */

/**
 * @typedef {{
 *   readonly ownerId: string,
 *   readonly runId: string,
 *   readonly sourceId: string,
 *   readonly sourceRevision: number,
 *   readonly processedUrls: readonly string[],
 *   readonly processedResponseUrls?: readonly string[],
 *   readonly processedContentDigests?: readonly string[],
 *   readonly frontier?: readonly string[],
 *   readonly discoveredUrls?: readonly string[],
 *   readonly acceptedHashes: readonly string[],
 *   readonly reviewedCandidateCount?: number,
 *   readonly reviewedCandidateHashes?: readonly string[],
 *   readonly similarityEvidence: readonly { readonly candidateHash: string, readonly comparedLocalHash: string, readonly score: number, readonly decision: SimilarityEvidence["decision"] }[],
 *   readonly coverage: readonly string[],
 *   readonly unresolvedGaps: readonly ExtractionGap[],
 *   readonly consecutiveNoveltyZero: number,
 *   readonly pageNotes?: readonly ExtractionPageNote[],
 *   readonly failedPages?: readonly ExtractionFailedPage[],
 *   readonly retryingFailedPages?: boolean,
 *   readonly retryGeneration?: number,
 *   readonly planCheckpoint?: { readonly plan: ExtractionPlan, readonly batchKey: string | null, readonly orderedUrls: readonly string[] | null, readonly retryGeneration: number | null },
 *   readonly pendingBatch?: { readonly key: string, readonly plan: ExtractionPlan, readonly observations: readonly PageObservation[] },
 *   readonly revision: number
 * }} ExtractionScratchpad
 */

/** @typedef {Result<KnowledgePoint|null,{readonly kind:string,readonly status?:number,readonly attempts?:number,readonly technicalAttempts?:number,readonly technicalRetriesExhausted?:boolean,readonly causeKind?:string}>} KnowledgeReviewResult */

/**
 * @typedef {{
 *   readonly state: "completed" | "paused" | "awaiting-time-limit-decision",
 *   readonly scratchpad: ExtractionScratchpad,
 *   readonly knowledgePointCount: number,
 *   readonly pagesProcessed: number,
 *   readonly stopReason?: "agent-complete" | "agent-blocked" | "time-limit" | "paused" | "partial-failure"
 * }} ExtractionResult
 */

/**
 * @typedef {{
 *   readonly kind: "ExtractionCommandInvalid",
 *   readonly field: string
 * } | {
 *   readonly kind: "ExtractionRightsNotAllowed"
 * } | {
 *   readonly kind: "ExtractionRobotsNotAllowed"
 * } | {
 *   readonly kind: "ExtractionPlanInvalid",
 *   readonly causeKind?: string
 * } | {
 *   readonly kind: "ExtractionPlannerFailed"
 * } | {
 *   readonly kind: "ExtractionAcquisitionFailed",
 *   readonly causeKind?: string,
 *   readonly diagnosticToken?: string
 * } | {
 *   readonly kind: "ExtractionObservationInvalid",
 *   readonly field: string
 * } | {
 *   readonly kind: "UnsafeDestination"
 * } | {
 *   readonly kind: "ExtractionLimitExceeded",
 *   readonly limit: "frontier" | "page-bytes" | "redirects" | "pages"
 * } | {
 *   readonly kind: "KnowledgeDuplicateAmbiguous"
 * } | {
 *   readonly kind: "KnowledgePersistenceFailed",
 *   readonly causeKind?: string
 * } | {
 *   readonly kind: "ScratchpadPersistenceFailed"
 * } | {
 *   readonly kind: "ScraperMemoryPersistenceFailed"
 * } | {
 *   readonly kind: "KnowledgeSetEmpty"
 * } | {
 *   readonly kind: "ExtractionCoverageIncomplete"
 * } | {
 *   readonly kind: "ExtractionStopped"
 * }} ExtractionFailure
 */

/** @typedef {{ readonly status: "allowed" | "awaiting-review" | "denied", readonly sourceId: string, readonly sourceRevision: number }} RightsGateResult */
/** @typedef {{ readonly status: "allowed" | "denied" }} RobotsGateResult */

/**
 * @typedef {{
 *   readonly plan: (command: { readonly rootUrl: string, readonly scratchpad: ExtractionScratchpad }) => Promise<Result<ExtractionPlan, unknown>>,
 *   readonly replan: (command: { readonly previous: ExtractionPlan, readonly observation: PageObservation, readonly scratchpad: ExtractionScratchpad }) => Promise<Result<ExtractionPlan, unknown>>
 * }} ExtractionPlanner
 */
/** @typedef {{ readonly fetchPage: (command: { readonly url: string, readonly rootUrl: string, readonly plan: ExtractionPlan, readonly attempt?: number, readonly onDrafts?: (observation:PageObservation)=>Promise<Result<null,unknown>> }) => Promise<Result<PageObservation, unknown>> }} PageAcquirer */
/** @typedef {{ readonly load: (scope: { readonly ownerId: string, readonly runId: string, readonly sourceId: string, readonly sourceRevision: number }) => Promise<Result<ExtractionScratchpad, unknown>>, readonly save: (scratchpad: ExtractionScratchpad) => Promise<Result<null, unknown>> }} ScratchpadRepository */
/** @typedef {{ readonly append: (point: KnowledgePoint) => Promise<Result<null, unknown>> }} KnowledgeRepository */
/** @typedef {{ readonly append: (record: { readonly kind: "durable-fact" | "decision" | "unresolved", readonly retention: "source" | "run", readonly payload: unknown }) => Promise<Result<null, unknown>> }} ExtractionMemory */

/**
 * @typedef {{
 *   readonly rights: RightsGateResult,
 *   readonly robots: RobotsGateResult,
 *   readonly planner: ExtractionPlanner,
 *   readonly acquirer: PageAcquirer,
 *   readonly orderedUrls?: readonly string[],
 *   readonly batchAcquirer?: { readonly key: string, readonly maximumBatchSize?: number, readonly fetchBatch: (command: { readonly urls: readonly string[], readonly rootUrl: string, readonly plan: ExtractionPlan, readonly scratchpad: ExtractionScratchpad, readonly attempt?: number, readonly onDrafts?: (observation:PageObservation)=>Promise<Result<null,unknown>> }) => Promise<Result<readonly PageObservation[], unknown>> },
 *   readonly checkRobots?: (targetUrl: string) => Promise<Result<unknown, unknown>>,
 *   readonly scratchpad: ScratchpadRepository,
 *   readonly knowledge: KnowledgeRepository,
 *   readonly reviewer?: { readonly review: (point: KnowledgePoint, observation: PageObservation) => Promise<KnowledgeReviewResult>, readonly reviewBatch?: (points:readonly KnowledgePoint[],observation:PageObservation)=>Promise<readonly KnowledgeReviewResult[]> },
 *   readonly memory?: ExtractionMemory,
 *   readonly onKnowledge?: () => void,
 *   readonly now: () => string,
 *   readonly nowMs: () => number,
 *   readonly logger: (entry: { readonly event: string, readonly runId?: string, readonly failureKind?: string, readonly diagnosticToken?: string }) => void,
 *   readonly stopRequested?: () => boolean,
 *   readonly policy: { readonly maximumFrontier: number, readonly maximumPageBytes: number, readonly maximumRedirects: number, readonly maximumPages: number, readonly maximumDurationMs: number, readonly maximumPagesPerExecution?: number, readonly maximumKnowledgePointsPerExecution?:number }
 * }} ExtractionDependencies
 */

/** @typedef {{ readonly ownerId: string, readonly runId: string, readonly sourceId: string, readonly sourceRevision: number, readonly rootUrl: string, readonly extractionScope?: "page" | "platform", readonly startedAtMs: number, readonly deadlineAtMs: number }} ExtractionCommand */

const freeze = Object.freeze;
const extractionVersion = "knowledge-extraction-v1";

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }
/** @param {unknown} value @returns {value is string} */
function text(value) { return typeof value === "string" && value.trim() !== ""; }
/** @param {unknown} value @returns {value is number} */
function positiveInteger(value) { return typeof value === "number" && Number.isSafeInteger(value) && value > 0; }
/** @param {unknown} value @returns {boolean} */
function nonNegativeInteger(value) { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0; }
/** @param {unknown} value @returns {boolean} */
function timestamp(value) { return text(value) && Number.isFinite(Date.parse(value)); }
/** @param {unknown} value @returns {boolean} */
function publicHttps(value) { return text(value) && URL.canParse(value) && new URL(value).protocol === "https:"; }

/** @param {unknown} value @returns {value is ExtractionGap} */
function validGap(value) { return isRecord(value) && text(value.id) && (value.priority === "high" || value.priority === "normal") && text(value.description); }

/** @param {unknown} value @returns {value is ExtractionPlan} */
function validPlan(value) {
  if (!isRecord(value) || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(["coverageGoals", "frontier", "revision", "stopDecision", "unresolvedGaps"]) || !positiveInteger(value.revision) || !Array.isArray(value.frontier) || !value.frontier.every(publicHttps) || !validStopDecision(value.stopDecision)) return false;
  const validGoal = (/** @type {unknown} */ goal) => isRecord(goal) && JSON.stringify(Object.keys(goal).sort()) === JSON.stringify(["description", "id", "priority"]) && text(goal.id) && (goal.priority === "high" || goal.priority === "normal") && text(goal.description);
  const validGap = (/** @type {unknown} */ gap) => isRecord(gap) && JSON.stringify(Object.keys(gap).sort()) === JSON.stringify(["description", "id", "priority"]) && text(gap.id) && (gap.priority === "high" || gap.priority === "normal") && text(gap.description);
  return Array.isArray(value.coverageGoals) && value.coverageGoals.every(validGoal) && Array.isArray(value.unresolvedGaps) && value.unresolvedGaps.every(validGap);
}

/** @param {unknown} value @returns {value is ExtractionStopDecision} */
function validStopDecision(value) {
  return isRecord(value) && JSON.stringify(Object.keys(value).sort()) === JSON.stringify(["decision", "evidenceUrls", "rationale", "unresolvedGapIds"]) && (value.decision === "continue" || value.decision === "complete" || value.decision === "blocked") && text(value.rationale) && value.rationale.length <= 2_000 && Array.isArray(value.evidenceUrls) && value.evidenceUrls.length <= 50 && value.evidenceUrls.every(publicHttps) && Array.isArray(value.unresolvedGapIds) && value.unresolvedGapIds.length <= 100 && value.unresolvedGapIds.every(text);
}

/** @param {unknown} value @returns {value is EvidenceAnchor} */
function validAnchor(value) { return isRecord(value) && (JSON.stringify(Object.keys(value).filter(key=>key!=="inlineLinks").sort()) === JSON.stringify(["selector", "url"]) || JSON.stringify(Object.keys(value).filter(key=>key!=="inlineLinks").sort()) === JSON.stringify(["selector", "url", "visibleEvidence"]) && text(value.visibleEvidence) && value.visibleEvidence.length <= 500 || JSON.stringify(Object.keys(value).filter(key=>key!=="inlineLinks").sort()) === JSON.stringify(["quoteDigest", "selector", "url"]) || JSON.stringify(Object.keys(value).filter(key=>key!=="inlineLinks").sort()) === JSON.stringify(["blockId", "clause", "quote", "quoteDigest", "selector", "url"])) && (value.inlineLinks===undefined || typeof value.quote==="string" && isInlineLinks(value.inlineLinks,value.quote)) && publicHttps(value.url) && text(value.selector) && (value.quoteDigest === undefined || text(value.quoteDigest)) && (value.blockId === undefined || text(value.blockId) && text(value.quote) && text(value.clause)); }
/** @param {unknown} value @returns {value is SimilarityEvidence} */
function validSimilarity(value) { return isRecord(value) && JSON.stringify(Object.keys(value).sort()) === JSON.stringify(["comparedLocalHash", "decision", "score"]) && text(value.comparedLocalHash) && typeof value.score === "number" && value.score >= 0 && value.score <= 1 && (value.decision === "distinct" || value.decision === "merge" || value.decision === "ambiguous"); }
/** @param {unknown} value @returns {value is VisualMediaReference} */
function validVisualMediaReference(value) { return isRecord(value) && JSON.stringify(Object.keys(value).sort()) === JSON.stringify(["visualId"]) && text(value.visualId); }
/** @param {unknown} value @returns {value is KnowledgeCandidate} */
function validCandidate(value) { return isRecord(value) && (JSON.stringify(Object.keys(value).sort()) === JSON.stringify(["coverageGoalIds", "evidenceAnchors", "mediaCandidates", "normalizedHash", "summary"]) || JSON.stringify(Object.keys(value).sort()) === JSON.stringify(["coverageGoalIds", "evidenceAnchors", "mediaCandidates", "normalizedHash", "similarity", "summary"]) || JSON.stringify(Object.keys(value).sort()) === JSON.stringify(["classification", "coverageGoalIds", "evidenceAnchors", "mediaCandidates", "normalizedHash", "summary"]) || JSON.stringify(Object.keys(value).sort()) === JSON.stringify(["classification", "coverageGoalIds", "evidenceAnchors", "mediaCandidates", "normalizedHash", "similarity", "summary"])) && text(value.summary) && text(value.normalizedHash) && Array.isArray(value.evidenceAnchors) && value.evidenceAnchors.length > 0 && value.evidenceAnchors.every(validAnchor) && Array.isArray(value.coverageGoalIds) && value.coverageGoalIds.every(text) && Array.isArray(value.mediaCandidates) && value.mediaCandidates.length <= 1 && (value.similarity === undefined || validSimilarity(value.similarity)); }
/** @param {unknown} value @returns {value is PageObservation} */
function validObservation(value) { return isRecord(value) && publicHttps(value.url) && (value.responseUrl===undefined||publicHttps(value.responseUrl)) && (value.contentDigest===undefined||text(value.contentDigest)) && text(value.title) && nonNegativeInteger(value.byteCount) && nonNegativeInteger(value.redirects) && Array.isArray(value.links) && value.links.every(publicHttps) && timestamp(value.observedAt) && Array.isArray(value.candidates) && value.candidates.every(validCandidate) && (value.notes === undefined || (typeof value.notes === "string" && value.notes.length <= 2_000)); }

/** @param {unknown} value @returns {value is ExtractionPageNote} */
function validPageNote(value) { return isRecord(value) && publicHttps(value.url) && (value.responseUrl===undefined||publicHttps(value.responseUrl)) && text(value.title) && text(value.note) && value.note.length <= 2_000 && timestamp(value.observedAt) && nonNegativeInteger(value.linkCount) && nonNegativeInteger(value.candidateCount); }

/** @param {unknown} value @returns {value is ExtractionFailedPage} */
function validFailedPage(value) { return isRecord(value) && publicHttps(value.url) && text(value.title) && typeof value.failureKind === "string" && /^[A-Za-z][A-Za-z0-9]*$/u.test(value.failureKind) && positiveInteger(value.attempts) && timestamp(value.failedAt); }

/** @param {unknown} value @returns {value is ExtractionScratchpad} */
function validScratchpad(value) {
  return isRecord(value) && (value.failedPages === undefined || Array.isArray(value.failedPages) && value.failedPages.every(validFailedPage) && new Set(value.failedPages.map(page => page.url)).size === value.failedPages.length) && (value.retryingFailedPages === undefined || typeof value.retryingFailedPages === "boolean") && (value.retryGeneration === undefined || positiveInteger(value.retryGeneration)) && text(value.ownerId) && text(value.runId) && text(value.sourceId) && positiveInteger(value.sourceRevision) &&
    Array.isArray(value.processedUrls) && value.processedUrls.every(publicHttps) && (value.processedResponseUrls===undefined||Array.isArray(value.processedResponseUrls)&&value.processedResponseUrls.every(publicHttps)) && (value.processedContentDigests===undefined||Array.isArray(value.processedContentDigests)&&value.processedContentDigests.every(text)) && (value.frontier === undefined || (Array.isArray(value.frontier) && value.frontier.every(publicHttps))) && (value.discoveredUrls === undefined || (Array.isArray(value.discoveredUrls) && value.discoveredUrls.every(publicHttps))) && Array.isArray(value.acceptedHashes) && value.acceptedHashes.every(text) && (value.reviewedCandidateCount === undefined || nonNegativeInteger(value.reviewedCandidateCount)) && (value.reviewedCandidateHashes === undefined || Array.isArray(value.reviewedCandidateHashes) && value.reviewedCandidateHashes.every(text)) &&
    Array.isArray(value.similarityEvidence) && value.similarityEvidence.every((entry) => isRecord(entry) && text(entry.candidateHash) && text(entry.comparedLocalHash) && typeof entry.score === "number" && entry.score >= 0 && entry.score <= 1 && (entry.decision === "distinct" || entry.decision === "merge" || entry.decision === "ambiguous")) &&
    Array.isArray(value.coverage) && value.coverage.every(text) && Array.isArray(value.unresolvedGaps) && value.unresolvedGaps.every(validGap) && nonNegativeInteger(value.consecutiveNoveltyZero) && (value.pageNotes === undefined || (Array.isArray(value.pageNotes) && value.pageNotes.length <= 100 && value.pageNotes.every(validPageNote))) && positiveInteger(value.revision) &&
    (value.planCheckpoint === undefined || (isRecord(value.planCheckpoint) && validPlan(value.planCheckpoint.plan) && (value.planCheckpoint.batchKey === null || text(value.planCheckpoint.batchKey)) && (value.planCheckpoint.orderedUrls === null || Array.isArray(value.planCheckpoint.orderedUrls) && value.planCheckpoint.orderedUrls.every(publicHttps) && new Set(value.planCheckpoint.orderedUrls).size === value.planCheckpoint.orderedUrls.length) && (value.planCheckpoint.retryGeneration === null || positiveInteger(value.planCheckpoint.retryGeneration)))) &&
    (value.pendingBatch === undefined || (isRecord(value.pendingBatch) && text(value.pendingBatch.key) && validPlan(value.pendingBatch.plan) && Array.isArray(value.pendingBatch.observations) && value.pendingBatch.observations.length > 0 && value.pendingBatch.observations.length <= 5 && value.pendingBatch.observations.every(validObservation) && new Set(value.pendingBatch.observations.map((page) => page.url)).size === value.pendingBatch.observations.length));
}

/** @param {unknown} command @returns {command is ExtractionCommand} */
function validCommand(command) {
  return isRecord(command) && text(command.ownerId) && text(command.runId) && text(command.sourceId) && positiveInteger(command.sourceRevision) && publicHttps(command.rootUrl) && (command.extractionScope === undefined || command.extractionScope === "page" || command.extractionScope === "platform") && nonNegativeInteger(command.startedAtMs) && positiveInteger(command.deadlineAtMs) && typeof command.deadlineAtMs === "number" && typeof command.startedAtMs === "number" && command.deadlineAtMs > command.startedAtMs;
}

/** @param {ExtractionScratchpad} value @returns {ExtractionScratchpad} */
function cloneScratchpad(value) {
  return freeze({ ...value, ...(value.planCheckpoint === undefined ? {} : {planCheckpoint:freeze({...value.planCheckpoint,plan:clonePlan(value.planCheckpoint.plan),orderedUrls:value.planCheckpoint.orderedUrls === null ? null : freeze([...value.planCheckpoint.orderedUrls])})}), failedPages: freeze((value.failedPages ?? []).map(page => freeze({ ...page }))), processedUrls: freeze([...value.processedUrls]), processedResponseUrls:freeze([...(value.processedResponseUrls??[])]), processedContentDigests:freeze([...(value.processedContentDigests??[])]), frontier: freeze([...(Array.isArray(value.frontier) ? value.frontier : [])]), discoveredUrls: freeze([...(Array.isArray(value.discoveredUrls) ? value.discoveredUrls : [])]), acceptedHashes: freeze([...value.acceptedHashes]), similarityEvidence: freeze(value.similarityEvidence.map((entry) => freeze({ ...entry }))), coverage: freeze([...value.coverage]), unresolvedGaps: freeze(value.unresolvedGaps.map((entry) => freeze({ ...entry }))), pageNotes: freeze((Array.isArray(value.pageNotes) ? value.pageNotes : []).map((entry) => freeze({ ...entry }))) });
}

/** @param {ExtractionPlan} plan @returns {ExtractionPlan} */
function clonePlan(plan) {
  return freeze({...plan,frontier:freeze([...plan.frontier]),coverageGoals:freeze(plan.coverageGoals.map(goal=>freeze({...goal}))),unresolvedGaps:freeze(plan.unresolvedGaps.map(gap=>freeze({...gap}))),stopDecision:freeze({...plan.stopDecision,evidenceUrls:freeze([...plan.stopDecision.evidenceUrls]),unresolvedGapIds:freeze([...plan.stopDecision.unresolvedGapIds])})});
}

/** @param {unknown} value @returns {string} */
function acquisitionFailureKind(value) {
  return isRecord(value) && text(value.kind) ? value.kind : "ExtractionAcquisitionFailed";
}

/** @param {unknown} value @returns {{ readonly kind: "ExtractionAcquisitionFailed", readonly causeKind?: string, readonly diagnosticToken?: string }} */
function acquisitionFailure(value) {
  const causeKind = acquisitionFailureKind(value);
  const diagnosticToken = isRecord(value) && typeof value.diagnosticToken === "string" && /^[a-z0-9-]+$/u.test(value.diagnosticToken) ? value.diagnosticToken : undefined;
  return { kind: "ExtractionAcquisitionFailed", ...(causeKind === "ExtractionAcquisitionFailed" ? {} : { causeKind }), ...(diagnosticToken === undefined ? {} : { diagnosticToken }) };
}

/** @param {unknown} value @returns {string | undefined} */
function failureDiagnosticToken(value) {
  return isRecord(value) && typeof value.diagnosticToken === "string" && /^[a-z0-9-]+$/u.test(value.diagnosticToken) ? value.diagnosticToken : undefined;
}

/** @param {ExtractionFailure} failure @param {ExtractionDependencies} dependencies @param {string} runId @returns {Result<never, ExtractionFailure>} */
function fail(failure, dependencies, runId) { const diagnosticToken = failureDiagnosticToken(failure); dependencies.logger({ event: "knowledge-extraction-failure", runId, failureKind: failure.kind, ...(diagnosticToken === undefined ? {} : { diagnosticToken }) }); return { ok: false, error: failure }; }

/** @param {ExtractionMemory | undefined} memory @param {"durable-fact" | "decision" | "unresolved"} kind @param {"source" | "run"} retention @param {unknown} payload @param {ExtractionDependencies} dependencies @param {string} runId @returns {Promise<Result<null, ExtractionFailure>>} */
async function remember(memory, kind, retention, payload, dependencies, runId) {
  if (memory === undefined) return { ok: true, value: null };
  let result;
  try {
    result = await memory.append({ kind, retention, payload });
  } catch (error) {
    return fail({ kind: "ScraperMemoryPersistenceFailed" }, dependencies, runId);
  }
  return result.ok ? { ok: true, value: null } : fail({ kind: "ScraperMemoryPersistenceFailed" }, dependencies, runId);
}

/** @param {ExtractionPlan} plan @param {ExtractionScratchpad} scratchpad @returns {string | null} */
function pendingFrontierUrl(plan, scratchpad) {
  return plan.frontier.find((url) => !scratchpad.processedUrls.includes(url) && !scratchpad.processedResponseUrls?.includes(url) && !scratchpad.failedPages?.some(page => page.url === url)) ?? null;
}

/** @param {string} kind @param {unknown} [error] */
function retryablePageFailure(kind, error, includeExhausted = false) {
  if (!includeExhausted && isRecord(error) && error.technicalRetriesExhausted === true) return false;
  return /^(KnowledgeBrowser(NavigationFailed|TimedOut|LoadTimedOut|CaptureTimedOut|CaptureInterrupted|PageClosed)|KnowledgePageFetchFailed|FirecrawlBrowser(ApiFailed|TimedOut|OperationFailed)|KnowledgeModel(Timeout|Cancelled|Unavailable|ResponseReadFailed|ResponseInvalid|ResponseDuplicateKey)|UploadedImageDecodeFailed|KnowledgeMaterial(BatchInvalid|ImageObservationInvalid|ReviewInvalid)|Webpage(FactsInvalid|FactEvidenceInvalid|GroundingInvalid|ClaimBoundariesInvalid|OwnerExclusionInvalid))$/u.test(kind) || kind === "KnowledgeModelRejected" && isRecord(error) && typeof error.status === "number" && (error.status >= 200 && error.status < 300 || [408, 429, 500, 502, 503, 504].includes(error.status));
}

/** @param {string} kind @param {unknown} [error] */
function pageLocalFailure(kind, error) {
  return retryablePageFailure(kind, error, true) || /^(KnowledgePage(BotAccessDenied|ContentTypeUnsupported)|KnowledgeReview(OutputInvalid|EvidenceUnavailable|ImageUnavailable)|KnowledgeRepairOutputInvalid|WorkflowMaterialImageUnavailable)$/u.test(kind);
}

/** @param {unknown} error @returns {string | undefined} */
function interruptedUnitCause(error) {
  // Skip only this identified unit; the uncertain paid claim remains reserved and must not be replayed.
  if (isRecord(error) && error.kind === "WorkflowAgentAgentOutputInvalid") return error.kind;
  if (isRecord(error) && error.kind === "WorkflowStageCallUncertain" && error.causeKind === undefined && error.technicalRetriesExhausted === true && error.technicalAttempts === 4) return error.kind;
  return isRecord(error) && error.kind === "WorkflowStageCallUncertain" && typeof error.causeKind === "string" && /^(KnowledgeModelTimeout|KnowledgeModelCancelled|KnowledgeModelUnavailable|KnowledgeModelResponseReadFailed)$/u.test(error.causeKind) ? error.causeKind : undefined;
}

/** @param {ExtractionPlan} plan @param {ExtractionScratchpad} scratchpad @returns {boolean} */
function planIsComplete(plan, scratchpad) {
  return plan.stopDecision.decision === "complete" && pendingFrontierUrl(plan, scratchpad) === null && coverageComplete(plan, scratchpad) && plan.unresolvedGaps.every((gap) => gap.priority !== "high");
}

/** @param {ExtractionDependencies} dependencies */
export function createExtractionRunner(dependencies) {
  if (!dependencies || !dependencies.rights || !dependencies.robots || dependencies.rights.status === undefined || dependencies.robots.status === undefined ||
    typeof dependencies.planner?.plan !== "function" || typeof dependencies.planner.replan !== "function" || typeof dependencies.acquirer?.fetchPage !== "function" ||
    typeof dependencies.scratchpad?.load !== "function" || typeof dependencies.scratchpad.save !== "function" || typeof dependencies.knowledge?.append !== "function" ||
    typeof dependencies.now !== "function" || typeof dependencies.nowMs !== "function" || typeof dependencies.logger !== "function" ||
    (dependencies.batchAcquirer !== undefined && (!text(dependencies.batchAcquirer.key) || typeof dependencies.batchAcquirer.fetchBatch !== "function" || (dependencies.batchAcquirer.maximumBatchSize !== undefined && (!positiveInteger(dependencies.batchAcquirer.maximumBatchSize) || dependencies.batchAcquirer.maximumBatchSize > 5)))) ||
    (dependencies.orderedUrls !== undefined && (!Array.isArray(dependencies.orderedUrls) || !dependencies.orderedUrls.every(publicHttps) || new Set(dependencies.orderedUrls).size !== dependencies.orderedUrls.length)) ||
    !positiveInteger(dependencies.policy?.maximumFrontier) || !positiveInteger(dependencies.policy.maximumPageBytes) || !nonNegativeInteger(dependencies.policy.maximumRedirects) || !positiveInteger(dependencies.policy.maximumPages) || !positiveInteger(dependencies.policy.maximumDurationMs) ||
    (dependencies.policy.maximumPagesPerExecution !== undefined && !positiveInteger(dependencies.policy.maximumPagesPerExecution)) ||
    (dependencies.policy.maximumKnowledgePointsPerExecution !== undefined && !positiveInteger(dependencies.policy.maximumKnowledgePointsPerExecution))) throw new TypeError("Extraction-runner dependencies are invalid.");
  return Object.freeze({
    /** @param {unknown} input @returns {Promise<Result<ExtractionResult, ExtractionFailure>>} */
    async run(input) {
      if (!validCommand(input)) return fail({ kind: "ExtractionCommandInvalid", field: "command" }, dependencies, "unknown");
      const command = /** @type {ExtractionCommand} */ (input);
      if (dependencies.rights.status !== "allowed" || dependencies.rights.sourceId !== command.sourceId || dependencies.rights.sourceRevision !== command.sourceRevision) return fail({ kind: "ExtractionRightsNotAllowed" }, dependencies, command.runId);
      if (dependencies.robots.status !== "allowed") return fail({ kind: "ExtractionRobotsNotAllowed" }, dependencies, command.runId);
      const root = new URL(command.rootUrl);
      const currentMs = dependencies.nowMs();
      if (!Number.isFinite(currentMs) || currentMs < command.startedAtMs) throw new TypeError("Extraction clock returned an invalid instant.");
      if (command.deadlineAtMs - command.startedAtMs > dependencies.policy.maximumDurationMs) return fail({ kind: "ExtractionCommandInvalid", field: "deadlineAtMs" }, dependencies, command.runId);
      let loaded;
      try { loaded = await dependencies.scratchpad.load({ ownerId: command.ownerId, runId: command.runId, sourceId: command.sourceId, sourceRevision: command.sourceRevision }); } catch (error) { return fail({ kind: "ScratchpadPersistenceFailed" }, dependencies, command.runId); }
      if (!loaded.ok || !validScratchpad(loaded.value) || loaded.value.ownerId !== command.ownerId || loaded.value.runId !== command.runId || loaded.value.sourceId !== command.sourceId || loaded.value.sourceRevision !== command.sourceRevision) return fail({ kind: "ScratchpadPersistenceFailed" }, dependencies, command.runId);
      const persistedFrontier = Array.isArray(loaded.value.frontier) ? loaded.value.frontier : [];
      const retryCheckpoint = loaded.value.planCheckpoint;
      const approvedInventory = retryCheckpoint?.batchKey === (dependencies.batchAcquirer?.key ?? null) && retryCheckpoint.retryGeneration === (loaded.value.retryGeneration ?? null) && retryCheckpoint.orderedUrls !== null ? retryCheckpoint.orderedUrls : persistedFrontier;
      const orderedUrls = command.extractionScope === "page" ? [root.href] : loaded.value.retryingFailedPages === true ? approvedInventory : dependencies.orderedUrls;
      let scratchpad = cloneScratchpad({
        ...loaded.value,
        discoveredUrls: (orderedUrls ?? [...new Set([
          ...(Array.isArray(loaded.value.discoveredUrls) ? loaded.value.discoveredUrls : []),
          ...(Array.isArray(loaded.value.frontier) ? loaded.value.frontier : []),
        ])]),
      });
      let plan;
      if (scratchpad.pendingBatch !== undefined && scratchpad.pendingBatch.key !== dependencies.batchAcquirer?.key) return fail({ kind: "ExtractionObservationInvalid", field: "pendingBatch.key" }, dependencies, command.runId);
      const binding = {batchKey:dependencies.batchAcquirer?.key ?? null,orderedUrls:orderedUrls ?? null,retryGeneration:scratchpad.retryGeneration ?? null};
      const savedPlan = scratchpad.planCheckpoint;
      const reusable = savedPlan !== undefined && savedPlan.batchKey === binding.batchKey && savedPlan.retryGeneration === binding.retryGeneration && JSON.stringify(savedPlan.orderedUrls) === JSON.stringify(binding.orderedUrls);
      try { plan = scratchpad.pendingBatch !== undefined ? {ok:true,value:scratchpad.pendingBatch.plan} : reusable ? {ok:true,value:/** @type {NonNullable<ExtractionScratchpad["planCheckpoint"]>} */(savedPlan).plan} : await dependencies.planner.plan({ rootUrl: root.href, scratchpad }); } catch (error) { return fail({ kind: "ExtractionPlannerFailed" }, dependencies, command.runId); }
      if (!plan.ok) return fail({ kind: "ExtractionPlanInvalid", ...(isRecord(plan.error) && text(plan.error.kind) ? { causeKind: plan.error.kind } : {}) }, dependencies, command.runId);
      if (!validPlan(plan.value) || plan.value.frontier.length > dependencies.policy.maximumFrontier) return fail({ kind: "ExtractionPlanInvalid" }, dependencies, command.runId);
      let currentPlan = freeze({ ...plan.value, frontier: freeze(orderedUrls ?? [...new Set([...persistedFrontier, ...plan.value.frontier])]) });
      scratchpad = cloneScratchpad({ ...scratchpad, discoveredUrls: [...new Set([...(scratchpad.discoveredUrls ?? []), ...currentPlan.frontier])] });
      const exhaustedInventory = orderedUrls !== undefined && scratchpad.pendingBatch === undefined && pendingFrontierUrl(currentPlan, scratchpad) === null;
      if (exhaustedInventory) currentPlan = freeze(boundAuthorizedMaterialPlan(currentPlan, [], scratchpad));
      const initialDiscoveredUrls = scratchpad.discoveredUrls ?? [];
      if (initialDiscoveredUrls.length > dependencies.policy.maximumFrontier) return fail({ kind: "ExtractionLimitExceeded", limit: "frontier" }, dependencies, command.runId);
      /** @returns {Promise<Result<null, ExtractionFailure>>} */
      async function saveCurrentPlan() {
        const discoveredUrls = [...new Set([...(scratchpad.discoveredUrls ?? []), ...currentPlan.frontier])];
        if (discoveredUrls.length > dependencies.policy.maximumFrontier) return fail({kind:"ExtractionLimitExceeded",limit:"frontier"},dependencies,command.runId);
        scratchpad = cloneScratchpad({...scratchpad,planCheckpoint:{...binding,plan:currentPlan},frontier:currentPlan.frontier,discoveredUrls,unresolvedGaps:currentPlan.unresolvedGaps,revision:scratchpad.revision+1});
        try {const saved=await dependencies.scratchpad.save(scratchpad);if(!saved.ok)return fail({kind:"ScratchpadPersistenceFailed"},dependencies,command.runId);}catch(error){return fail({kind:"ScratchpadPersistenceFailed"},dependencies,command.runId);}
        return {ok:true,value:null};
      }
      if (!reusable || exhaustedInventory) {
        const saved = await saveCurrentPlan();
        if (!saved.ok) return saved;
        const planned = await remember(dependencies.memory, "decision", "source", { phase: "plan", revision: currentPlan.revision, decision: currentPlan.stopDecision.decision, rationale: currentPlan.stopDecision.rationale, frontier: currentPlan.frontier.slice(0, 50), discoveredUrls: initialDiscoveredUrls.slice(0, 50), unresolvedGaps: currentPlan.unresolvedGaps.slice(0, 50).map((gap) => ({ id: gap.id, priority: gap.priority, description: gap.description })) }, dependencies, command.runId);
        if (!planned.ok) return planned;
      }
      let pagesProcessed = scratchpad.processedUrls.length;
      let attemptedPages = pagesProcessed + (scratchpad.failedPages?.length ?? 0);
      const previouslyAttemptedPages = attemptedPages;
      let committedThisExecution=0;
      /** @type {Map<string, number>} */ const singleBatchRetries = new Map();
      /** @param {string} url @param {string} failureKind @param {number} attempts @param {PageObservation} [observation] @param {string} [causeKind] @returns {Promise<Result<null, ExtractionFailure>>} */
      async function recordFailedPage(url, failureKind, attempts, observation, causeKind) {
        const failedAt = dependencies.now();
        const failure = freeze({ url, title: observation?.title ?? url, failureKind, attempts, failedAt });
        const noted = await remember(dependencies.memory, "unresolved", "source", { phase: "page-failed", ...failure, ...(causeKind === undefined ? {} : { causeKind }) }, dependencies, command.runId);
        if (!noted.ok) return noted;
        const pending = scratchpad.pendingBatch;
        const { pendingBatch, ...progress } = scratchpad;
        const remaining = pending?.observations.filter(page => page.url !== url) ?? [];
        const links = observation?.links.filter(link => new URL(link).origin === root.origin && withinPath(root, new URL(link)) && (orderedUrls === undefined || orderedUrls.includes(link))) ?? [];
        const discoveredUrls = [...new Set([...(scratchpad.discoveredUrls ?? []), ...links])];
        if (discoveredUrls.length > dependencies.policy.maximumFrontier) return fail({ kind: "ExtractionLimitExceeded", limit: "frontier" }, dependencies, command.runId);
        scratchpad = cloneScratchpad({ ...progress, failedPages: [...(scratchpad.failedPages ?? []), failure], discoveredUrls, frontier: [...new Set([...currentPlan.frontier, ...links])], pageNotes: [...(scratchpad.pageNotes ?? []), { url, title: failure.title, note: `Processing failed after ${attempts} attempt(s): ${failureKind}${causeKind === undefined ? "" : ` (${causeKind}; uncertain call was not replayed)`}.`, observedAt: failedAt, linkCount: links.length, candidateCount: observation?.candidates.length ?? 0 }].slice(-100), ...(pending !== undefined && remaining.length > 0 ? { pendingBatch: { ...pending, observations: remaining } } : {}), revision: scratchpad.revision + 1 });
        currentPlan = freeze({ ...currentPlan, frontier: scratchpad.frontier ?? [] });
        scratchpad = cloneScratchpad({...scratchpad,planCheckpoint:{...binding,plan:currentPlan}});
        try { const saved = await dependencies.scratchpad.save(scratchpad); if (!saved.ok) return fail({ kind: "ScratchpadPersistenceFailed" }, dependencies, command.runId); }
        catch (error) { return fail({ kind: "ScratchpadPersistenceFailed" }, dependencies, command.runId); }
        attemptedPages++;
        dependencies.logger({ event: "knowledge-extraction-page-failed", runId: command.runId, failureKind });
        return { ok: true, value: null };
      }
      /** @param {NonNullable<ExtractionResult["stopReason"]>} stopReason @returns {Promise<Result<ExtractionResult, ExtractionFailure>>} */
      async function completeExtraction(stopReason) {
        if (scratchpad.retryingFailedPages === true) {
          scratchpad = cloneScratchpad({ ...scratchpad, retryingFailedPages: false, revision: scratchpad.revision + 1 });
          try { const saved = await dependencies.scratchpad.save(scratchpad); if (!saved.ok) return fail({ kind: "ScratchpadPersistenceFailed" }, dependencies, command.runId); }
          catch (error) { return fail({ kind: "ScratchpadPersistenceFailed" }, dependencies, command.runId); }
        }
        return { ok: true, value: freeze({ state: "completed", scratchpad: cloneScratchpad(scratchpad), knowledgePointCount: scratchpad.acceptedHashes.length, pagesProcessed, stopReason }) };
      }
      while (true) {
        const observedMs = dependencies.nowMs();
        if (!Number.isFinite(observedMs) || observedMs < command.startedAtMs) throw new TypeError("Extraction clock returned an invalid instant.");
        if (observedMs >= command.deadlineAtMs) return { ok: true, value: freeze({ state: "awaiting-time-limit-decision", scratchpad: cloneScratchpad(scratchpad), knowledgePointCount: scratchpad.acceptedHashes.length, pagesProcessed, stopReason: "time-limit" }) };
        const nextUrl = scratchpad.pendingBatch?.observations[0]?.url ?? pendingFrontierUrl(currentPlan, scratchpad);
        if (nextUrl === null) {
          if ((scratchpad.failedPages?.length ?? 0) > 0) return completeExtraction("partial-failure");
          if (scratchpad.acceptedHashes.length === 0 && !((scratchpad.reviewedCandidateCount??0) > 0)) return fail({ kind: "KnowledgeSetEmpty" }, dependencies, command.runId);
          if (planIsComplete(currentPlan, scratchpad) || scratchpad.acceptedHashes.length === 0 && (scratchpad.reviewedCandidateCount ?? 0) > 0) {
            dependencies.logger({ event: "knowledge-extraction-success", runId: command.runId });
            return completeExtraction("agent-complete");
          }
          if (currentPlan.stopDecision.decision === "blocked") {
            dependencies.logger({ event: "knowledge-extraction-agent-blocked", runId: command.runId });
            return completeExtraction("agent-blocked");
          }
          return fail({ kind: "ExtractionCoverageIncomplete" }, dependencies, command.runId);
        }
        if (dependencies.policy.maximumPagesPerExecution !== undefined && attemptedPages - previouslyAttemptedPages >= dependencies.policy.maximumPagesPerExecution) return { ok: true, value: freeze({ state: "awaiting-time-limit-decision", scratchpad, knowledgePointCount: scratchpad.acceptedHashes.length, pagesProcessed, stopReason: "paused" }) };
        if (dependencies.stopRequested?.() === true && attemptedPages > previouslyAttemptedPages) return { ok: true, value: freeze({ state: "paused", scratchpad, knowledgePointCount: scratchpad.acceptedHashes.length, pagesProcessed, stopReason: "paused" }) };
        if (attemptedPages >= dependencies.policy.maximumPages) return fail({ kind: "ExtractionLimitExceeded", limit: "pages" }, dependencies, command.runId);
        if (currentPlan.stopDecision.decision === "complete") {
          dependencies.logger({ event: "knowledge-extraction-premature-complete-rejected", runId: command.runId, failureKind: "ExtractionCoverageIncomplete" });
          currentPlan = freeze({ ...currentPlan, stopDecision: freeze({ ...currentPlan.stopDecision, decision: "continue", rationale: "Deterministic verification found queued source content that has not been observed." }) });
          const saved = await saveCurrentPlan();
          if (!saved.ok) return saved;
        }
        if (currentPlan.stopDecision.decision === "blocked") {
          if (scratchpad.acceptedHashes.length === 0) return fail({ kind: "ExtractionStopped" }, dependencies, command.runId);
          dependencies.logger({ event: "knowledge-extraction-agent-blocked", runId: command.runId });
          return completeExtraction("agent-blocked");
        }
        const destination = new URL(nextUrl);
        if (command.extractionScope === "page" && destination.href !== root.href || destination.origin !== root.origin || !withinPath(root, destination)) return fail({ kind: "UnsafeDestination" }, dependencies, command.runId);
        if (dependencies.checkRobots !== undefined) {
          let checked;
          try { checked = await dependencies.checkRobots(destination.href); } catch (error) { return fail({ kind: "ExtractionAcquisitionFailed", causeKind: "RobotsCheckFailed" }, dependencies, command.runId); }
          if (!checked.ok) return fail(acquisitionFailure(checked.error), dependencies, command.runId);
        }
        let novel=0;
        /** @type {{kind:string,technicalAttempts?:number,attempts?:number}|undefined} */ let reviewFailure;
        /** @type {Result<ExtractionResult,ExtractionFailure>|undefined} */ let earlyResult;
        /** @param {PageObservation} observation @returns {Promise<Result<ExtractionResult,ExtractionFailure>|null>} */
        async function publishDrafts(observation) {
          if(!validObservation(observation)||observation.url!==destination.href||observation.candidates.some(candidate=>candidate.evidenceAnchors.some(anchor=>anchor.url!==(observation.responseUrl??observation.url))||candidate.coverageGoalIds.some(id=>!currentPlan?.coverageGoals.some(goal=>goal.id===id))))return fail({kind:'ExtractionObservationInvalid',field:'drafts'},dependencies,command.runId);
          if(observation.byteCount>dependencies.policy.maximumPageBytes)return fail({kind:'ExtractionLimitExceeded',limit:'page-bytes'},dependencies,command.runId);
          if(observation.redirects>dependencies.policy.maximumRedirects)return fail({kind:'ExtractionLimitExceeded',limit:'redirects'},dependencies,command.runId);
          if(dependencies.policy.maximumKnowledgePointsPerExecution!==undefined&&committedThisExecution>=dependencies.policy.maximumKnowledgePointsPerExecution)return {ok:true,value:freeze({state:'awaiting-time-limit-decision',scratchpad,knowledgePointCount:scratchpad.acceptedHashes.length,pagesProcessed,stopReason:'paused'})};
          const candidates = scratchpad.processedContentDigests?.includes(observation.contentDigest??'') ? [] : observation.candidates.filter((candidate,index,all)=>!scratchpad.acceptedHashes.includes(candidate.normalizedHash)&&!scratchpad.reviewedCandidateHashes?.includes(candidate.normalizedHash)&&all.findIndex(other=>other.normalizedHash===candidate.normalizedHash)===index);
          /** @param {KnowledgeCandidate} candidate */
          const toPoint = candidate => /** @type {KnowledgePoint} */ (freeze({ id: `knowledge:${command.sourceId}:${command.sourceRevision}:${candidate.normalizedHash}`, sourceId: command.sourceId, sourceRevision: command.sourceRevision, summary: candidate.summary, normalizedHash: candidate.normalizedHash, evidenceAnchors: freeze(candidate.evidenceAnchors.map((anchor) => freeze({ ...anchor }))), coverageGoalIds: freeze([...candidate.coverageGoalIds]), mediaCandidates: freeze([...candidate.mediaCandidates]), attribution: freeze({ sourceUrl: observation.responseUrl??observation.url }), extractionVersion }));
          /** @type {readonly KnowledgeReviewResult[]|undefined} */ let batchReviews;
          if (dependencies.reviewer?.reviewBatch !== undefined) {
            try {batchReviews = await dependencies.reviewer.reviewBatch(candidates.map(toPoint),observation);}
            catch {return fail({kind:"KnowledgePersistenceFailed",causeKind:"KnowledgeReviewFailed"},dependencies,command.runId);}
            if (!Array.isArray(batchReviews) || batchReviews.length !== candidates.length) return fail({kind:"KnowledgePersistenceFailed",causeKind:"KnowledgeReviewOutputInvalid"},dependencies,command.runId);
            if(batchReviews.some(review=>!review.ok&&review.error.kind==='KnowledgeReviewChunkPending')){
              const failed=batchReviews.find(review=>!review.ok&&review.error.kind!=='KnowledgeReviewChunkPending');
              if(failed&&!failed.ok)return fail({kind:'KnowledgePersistenceFailed',causeKind:failed.error.kind},dependencies,command.runId);
            }
          }
          for (const [candidateIndex,candidate] of candidates.entries()) {
            if (scratchpad.acceptedHashes.includes(candidate.normalizedHash)) continue;
            if (dependencies.reviewer === undefined && candidate.similarity?.decision === "ambiguous") return fail({ kind: "KnowledgeDuplicateAmbiguous" }, dependencies, command.runId);
            if (candidate.similarity !== undefined) scratchpad = cloneScratchpad({ ...scratchpad, similarityEvidence: [...scratchpad.similarityEvidence, { candidateHash: candidate.normalizedHash, comparedLocalHash: candidate.similarity.comparedLocalHash, score: candidate.similarity.score, decision: candidate.similarity.decision }] });
            if (dependencies.reviewer === undefined && candidate.similarity?.decision === "merge") continue;
            let point = toPoint(candidate);
            if (dependencies.reviewer !== undefined) {
              let reviewed;
              try { reviewed = batchReviews === undefined ? await dependencies.reviewer.review(point, observation) : batchReviews[candidateIndex]; } catch (error) { return fail({ kind: "KnowledgePersistenceFailed", causeKind: "KnowledgeReviewFailed" }, dependencies, command.runId); }
              if (!reviewed.ok) {
                if(reviewed.error.kind==='KnowledgeReviewChunkPending')continue;
                if (interruptedUnitCause(reviewed.error) === undefined && !pageLocalFailure(reviewed.error.kind, reviewed.error)) return fail({kind:"KnowledgePersistenceFailed",causeKind:reviewed.error.kind},dependencies,command.runId);
                reviewFailure = reviewed.error;
                break;
              }
              if (reviewed.value === null){
                scratchpad=cloneScratchpad({...scratchpad,reviewedCandidateCount:(scratchpad.reviewedCandidateCount??0)+1,reviewedCandidateHashes:[...(scratchpad.reviewedCandidateHashes??[]),candidate.normalizedHash],revision:scratchpad.revision+1});
                try{const saved=await dependencies.scratchpad.save(scratchpad);if(!saved.ok)return fail({kind:'ScratchpadPersistenceFailed'},dependencies,command.runId);}catch{return fail({kind:'ScratchpadPersistenceFailed'},dependencies,command.runId);}
                continue;
              }
              point = reviewed.value;
              if (!validCandidate({summary:point.summary,normalizedHash:point.normalizedHash,evidenceAnchors:point.evidenceAnchors,coverageGoalIds:point.coverageGoalIds,mediaCandidates:point.mediaCandidates}) || point.sourceId !== command.sourceId || point.sourceRevision !== command.sourceRevision || point.evidenceAnchors.some(anchor=>!candidate.evidenceAnchors.some(original=>original.url===anchor.url&&original.selector===anchor.selector&&original.blockId===anchor.blockId&&original.quoteDigest===anchor.quoteDigest&&original.quote===anchor.quote&&JSON.stringify(original.inlineLinks)===JSON.stringify(anchor.inlineLinks))) || point.coverageGoalIds.some(id=>!candidate.coverageGoalIds.includes(id)) || point.attribution.sourceUrl !== (observation.responseUrl??observation.url)) return fail({kind:"KnowledgePersistenceFailed",causeKind:"KnowledgeReviewOutputInvalid"},dependencies,command.runId);
            }
            if(scratchpad.acceptedHashes.includes(point.normalizedHash))continue;
            if(dependencies.policy.maximumKnowledgePointsPerExecution!==undefined&&committedThisExecution>=dependencies.policy.maximumKnowledgePointsPerExecution)return {ok:true,value:freeze({state:'awaiting-time-limit-decision',scratchpad,knowledgePointCount:scratchpad.acceptedHashes.length,pagesProcessed,stopReason:'paused'})};
            if(dependencies.reviewer!==undefined)scratchpad=cloneScratchpad({...scratchpad,reviewedCandidateCount:(scratchpad.reviewedCandidateCount??0)+1});
            let appended;
            try { appended = await dependencies.knowledge.append(point); } catch (error) { const causeKind = isRecord(error) && text(error.kind) ? error.kind : "KnowledgeRepositoryRejected"; return fail({ kind: "KnowledgePersistenceFailed", causeKind }, dependencies, command.runId); }
            if (!appended.ok) { const causeKind = isRecord(appended.error) && text(appended.error.kind) ? appended.error.kind : undefined; return fail({ kind: "KnowledgePersistenceFailed", ...(causeKind === undefined || causeKind === "KnowledgePersistenceFailed" ? {} : { causeKind }) }, dependencies, command.runId); }
            const acceptedMemory = await remember(dependencies.memory, "durable-fact", "source", { phase: "knowledge-accepted", knowledgeId: point.id, normalizedHash: point.normalizedHash, evidenceDigests: point.evidenceAnchors.flatMap((anchor) => anchor.quoteDigest === undefined ? [] : [anchor.quoteDigest]).slice(0, 50), coverageGoalIds: point.coverageGoalIds.slice(0, 50), sourceUrl: observation.url }, dependencies, command.runId);
            if (!acceptedMemory.ok) return acceptedMemory;
            scratchpad = cloneScratchpad({ ...scratchpad, acceptedHashes: [...new Set([...scratchpad.acceptedHashes, point.normalizedHash])], reviewedCandidateHashes:[...new Set([...(scratchpad.reviewedCandidateHashes??[]),candidate.normalizedHash])], coverage: [...new Set([...scratchpad.coverage, ...point.coverageGoalIds])], revision: scratchpad.revision + 1 });
            try { const saved = await dependencies.scratchpad.save(scratchpad); if (!saved.ok) return fail({ kind: "ScratchpadPersistenceFailed" }, dependencies, command.runId); }
            catch (error) { return fail({ kind: "ScratchpadPersistenceFailed" }, dependencies, command.runId); }
            novel += 1;
            committedThisExecution++;
            dependencies.onKnowledge?.();
          }
          // Ready points are durable; pending reviews cannot complete this page or its coverage.
          if(reviewFailure===undefined&&batchReviews?.some(review=>!review.ok&&review.error.kind==='KnowledgeReviewChunkPending'))return {ok:true,value:freeze({state:'awaiting-time-limit-decision',scratchpad,knowledgePointCount:scratchpad.acceptedHashes.length,pagesProcessed,stopReason:'paused'})};
          return null;
        }
        /** @param {PageObservation} observation @returns {Promise<Result<null,unknown>>} */
        const onDrafts=async observation=>{
          const result=await publishDrafts(observation);
          if(result!==null)earlyResult=result;
          return result!==null&&!result.ok?result:{ok:true,value:null};
        };
        if (dependencies.batchAcquirer !== undefined && scratchpad.pendingBatch === undefined) {
          const urls = currentPlan.frontier.filter((url) => !scratchpad.processedUrls.includes(url) && !scratchpad.processedResponseUrls?.includes(url) && !scratchpad.failedPages?.some(page => page.url === url)).slice(0, Math.min(singleBatchRetries.has(nextUrl) ? 1 : dependencies.batchAcquirer.maximumBatchSize ?? 5, dependencies.policy.maximumPages - attemptedPages));
          for (const url of urls) {
            if (new URL(url).origin !== root.origin || !withinPath(root, new URL(url))) return fail({ kind: "UnsafeDestination" }, dependencies, command.runId);
            if (dependencies.checkRobots !== undefined && url !== destination.href) {
              let checked;
              try { checked = await dependencies.checkRobots(url); } catch (error) { return fail({ kind: "ExtractionAcquisitionFailed", causeKind: "RobotsCheckFailed" }, dependencies, command.runId); }
              if (!checked.ok) return fail(acquisitionFailure(checked.error), dependencies, command.runId);
            }
          }
          let batch;
          let attempt = singleBatchRetries.get(nextUrl) ?? 1;
          do {
            try { batch = await dependencies.batchAcquirer.fetchBatch({ urls, rootUrl: root.href, plan: currentPlan, scratchpad, attempt,onDrafts }); } catch (error) { return fail({ kind: "ExtractionAcquisitionFailed" }, dependencies, command.runId); }
            if (batch.ok || !retryablePageFailure(acquisitionFailureKind(batch.error), batch.error) || attempt === 4 || urls.length > 1) break;
            if (dependencies.nowMs() >= command.deadlineAtMs) return { ok: true, value: freeze({ state: "awaiting-time-limit-decision", scratchpad, knowledgePointCount: scratchpad.acceptedHashes.length, pagesProcessed, stopReason: "time-limit" }) };
            attempt++;
          } while (true);
          if (!batch.ok) {
            if (acquisitionFailureKind(batch.error) === "WebpageImageRunDeadlineExceeded" && dependencies.nowMs() >= command.deadlineAtMs) return { ok: true, value: freeze({ state: "awaiting-time-limit-decision", scratchpad, knowledgePointCount: scratchpad.acceptedHashes.length, pagesProcessed, stopReason: "time-limit" }) };
            const failureKind = acquisitionFailureKind(batch.error);
            const interruption = urls.length === 1 ? interruptedUnitCause(batch.error) : undefined;
            if (interruption === undefined && !pageLocalFailure(failureKind, batch.error)) return fail(acquisitionFailure(batch.error), dependencies, command.runId);
            if (urls.length > 1) {
              if (isRecord(batch.error) && batch.error.technicalRetriesExhausted === true) return fail(acquisitionFailure(batch.error), dependencies, command.runId);
              for (const url of urls) singleBatchRetries.set(url, 2); continue;
            }
            const recorded = await recordFailedPage(nextUrl, interruption === undefined ? failureKind : "WorkflowProcessingInterrupted", isRecord(batch.error) && positiveInteger(batch.error.technicalAttempts) ? batch.error.technicalAttempts : isRecord(batch.error) && positiveInteger(batch.error.attempts) ? batch.error.attempts : attempt, undefined, interruption);
            if (!recorded.ok) return recorded;
            continue;
          }
          if (!Array.isArray(batch.value) || batch.value.length !== urls.length || batch.value.some((page, index) => !validObservation(page) || page.url !== urls[index] || page.candidates.some((candidate) => candidate.evidenceAnchors.some((anchor) => anchor.url !== page.url) || candidate.coverageGoalIds.some((id) => !currentPlan.coverageGoals.some((goal) => goal.id === id))))) return fail({ kind: "ExtractionObservationInvalid", field: "batch" }, dependencies, command.runId);
          if (batch.value.some((page) => page.byteCount > dependencies.policy.maximumPageBytes)) return fail({ kind: "ExtractionLimitExceeded", limit: "page-bytes" }, dependencies, command.runId);
          if (batch.value.some((page) => page.redirects > dependencies.policy.maximumRedirects)) return fail({ kind: "ExtractionLimitExceeded", limit: "redirects" }, dependencies, command.runId);
          scratchpad = cloneScratchpad({ ...scratchpad, pendingBatch: { key: dependencies.batchAcquirer.key, plan: currentPlan, observations: batch.value }, revision: scratchpad.revision + 1 });
          let checkpoint;
          try { checkpoint = await dependencies.scratchpad.save(scratchpad); } catch (error) { return fail({ kind: "ScratchpadPersistenceFailed" }, dependencies, command.runId); }
          if (!checkpoint.ok) return fail({ kind: "ScratchpadPersistenceFailed" }, dependencies, command.runId);
          dependencies.logger({ event: "knowledge-extraction-batch-checkpoint", runId: command.runId });
        }
        let acquired;
        let attempt = 1;
        do {
          try { acquired = scratchpad.pendingBatch === undefined ? await dependencies.acquirer.fetchPage({ url: destination.href, rootUrl: root.href, plan: currentPlan, attempt,onDrafts }) : { ok: true, value: scratchpad.pendingBatch.observations[0] }; } catch (error) { return fail({ kind: "ExtractionAcquisitionFailed" }, dependencies, command.runId); }
          if (acquired.ok || !retryablePageFailure(acquisitionFailureKind(acquired.error), acquired.error) || attempt === 4) break;
          if (dependencies.nowMs() >= command.deadlineAtMs) return { ok: true, value: freeze({ state: "awaiting-time-limit-decision", scratchpad, knowledgePointCount: scratchpad.acceptedHashes.length, pagesProcessed, stopReason: "time-limit" }) };
          attempt++;
        } while (true);
        if (!acquired.ok) {
          if (acquisitionFailureKind(acquired.error) === "WebpageImageRunDeadlineExceeded" && dependencies.nowMs() >= command.deadlineAtMs) return { ok: true, value: freeze({ state: "awaiting-time-limit-decision", scratchpad, knowledgePointCount: scratchpad.acceptedHashes.length, pagesProcessed, stopReason: "time-limit" }) };
          const failureKind = acquisitionFailureKind(acquired.error);
          const interruption = interruptedUnitCause(acquired.error);
          if (interruption === undefined && !pageLocalFailure(failureKind, acquired.error)) return fail(acquisitionFailure(acquired.error), dependencies, command.runId);
          const recorded = await recordFailedPage(nextUrl, interruption === undefined ? failureKind : "WorkflowProcessingInterrupted", isRecord(acquired.error) && positiveInteger(acquired.error.technicalAttempts) ? acquired.error.technicalAttempts : isRecord(acquired.error) && positiveInteger(acquired.error.attempts) ? acquired.error.attempts : attempt, undefined, interruption);
          if (!recorded.ok) return recorded;
          continue;
        }
        const observation = acquired.value;
        if (!validObservation(observation)) return fail({ kind: "ExtractionObservationInvalid", field: "observation" }, dependencies, command.runId);
        if (observation.url !== destination.href || new URL(observation.url).origin !== root.origin || !withinPath(root, new URL(observation.url))) return fail({ kind: "UnsafeDestination" }, dependencies, command.runId);
        if(observation.responseUrl!==undefined&&(new URL(observation.responseUrl).origin!==root.origin||!withinPath(root,new URL(observation.responseUrl))))return fail({kind:"UnsafeDestination"},dependencies,command.runId);
        if (observation.candidates.some((candidate) => candidate.evidenceAnchors.some((anchor) => anchor.url !== (observation.responseUrl??observation.url)))) return fail({ kind: "ExtractionObservationInvalid", field: "evidenceAnchors" }, dependencies, command.runId);
        const coverageGoalIds = new Set(currentPlan.coverageGoals.map((goal) => goal.id));
        if(observation.responseUrl!==undefined&&(new URL(observation.responseUrl).origin!==root.origin||!withinPath(root,new URL(observation.responseUrl))))return fail({kind:"UnsafeDestination"},dependencies,command.runId);
        if (observation.candidates.some((candidate) => candidate.coverageGoalIds.some((goalId) => !coverageGoalIds.has(goalId)))) return fail({ kind: "ExtractionObservationInvalid", field: "coverageGoalIds" }, dependencies, command.runId);
        if (observation.byteCount > dependencies.policy.maximumPageBytes) return fail({ kind: "ExtractionLimitExceeded", limit: "page-bytes" }, dependencies, command.runId);
        if (observation.redirects > dependencies.policy.maximumRedirects) return fail({ kind: "ExtractionLimitExceeded", limit: "redirects" }, dependencies, command.runId);
        const pageNote = freeze({ url: observation.url, title: observation.title, note: (text(observation.notes) ? observation.notes : `Observed ${observation.candidates.length} candidate knowledge points and ${observation.links.length} same-origin links.`).slice(0, 2_000), observedAt: observation.observedAt, linkCount: observation.links.length, candidateCount: observation.candidates.length });
        const pageMemory = await remember(dependencies.memory, "durable-fact", "source", { phase: "page-observed", url: observation.url, title: observation.title, note: pageNote.note, observedAt: observation.observedAt, byteCount: observation.byteCount, redirects: observation.redirects, links: observation.links.slice(0, 50), candidateCount: observation.candidates.length }, dependencies, command.runId);
        if (!pageMemory.ok) return pageMemory;
        if(earlyResult!==undefined)return earlyResult;
        const published=await publishDrafts(observation);
        if(published!==null)return published;
        if (reviewFailure !== undefined) {
          const interruption = interruptedUnitCause(reviewFailure);
          const recorded = await recordFailedPage(observation.url, interruption === undefined ? reviewFailure.kind : "WorkflowProcessingInterrupted", positiveInteger(reviewFailure.technicalAttempts) ? reviewFailure.technicalAttempts : positiveInteger(reviewFailure.attempts) ? reviewFailure.attempts : reviewFailure.kind === "KnowledgeReviewOutputInvalid" ? 2 : 1, observation, interruption);
          if (!recorded.ok) return recorded;
          continue;
        }
        const nextZero = novel === 0 ? scratchpad.consecutiveNoveltyZero + 1 : 0;
        const scopedLinks = observation.links.filter((link) => {
          const candidate = new URL(link);
          return candidate.origin === root.origin && withinPath(root, candidate) && (orderedUrls === undefined || orderedUrls.includes(link));
        });
        const discoveredUrls = [...new Set([...(scratchpad.discoveredUrls ?? []), ...currentPlan.frontier, ...scopedLinks])];
        if (discoveredUrls.length > dependencies.policy.maximumFrontier) return fail({ kind: "ExtractionLimitExceeded", limit: "frontier" }, dependencies, command.runId);
        scratchpad = cloneScratchpad({ ...scratchpad, processedUrls: [...scratchpad.processedUrls, observation.url], processedResponseUrls:[...new Set([...(scratchpad.processedResponseUrls??[]),observation.responseUrl??observation.url])], processedContentDigests:[...new Set([...(scratchpad.processedContentDigests??[]),...(observation.contentDigest?[observation.contentDigest]:[])])], frontier: [...new Set([...currentPlan.frontier, ...scopedLinks])], discoveredUrls, unresolvedGaps: currentPlan.unresolvedGaps, consecutiveNoveltyZero: nextZero, pageNotes: [...(scratchpad.pageNotes ?? []), pageNote].slice(-100), revision: scratchpad.revision + 1 });
        if (scratchpad.pendingBatch !== undefined) {
          const remaining = scratchpad.pendingBatch.observations.slice(1);
          const { pendingBatch, ...progress } = scratchpad;
          scratchpad = cloneScratchpad({ ...progress, ...(remaining.length === 0 ? {} : { pendingBatch: { ...pendingBatch, observations: remaining } }) });
        }
        let saved;
        try { saved = await dependencies.scratchpad.save(scratchpad); } catch (error) { return fail({ kind: "ScratchpadPersistenceFailed" }, dependencies, command.runId); }
        if (!saved.ok) return fail({ kind: "ScratchpadPersistenceFailed" }, dependencies, command.runId);
        pagesProcessed += 1;
        attemptedPages += 1;
        if (dependencies.stopRequested?.() === true) return { ok: true, value: freeze({ state: "paused", scratchpad: cloneScratchpad(scratchpad), knowledgePointCount: scratchpad.acceptedHashes.length, pagesProcessed, stopReason: "paused" }) };
        if (scratchpad.pendingBatch !== undefined) {
          if (dependencies.policy.maximumPagesPerExecution !== undefined && attemptedPages - previouslyAttemptedPages >= dependencies.policy.maximumPagesPerExecution) return { ok: true, value: freeze({ state: "awaiting-time-limit-decision", scratchpad, knowledgePointCount: scratchpad.acceptedHashes.length, pagesProcessed, stopReason: "paused" }) };
          continue;
        }
        let replanned;
        try { replanned = await dependencies.planner.replan({ previous: currentPlan, observation, scratchpad }); } catch (error) { return fail({ kind: "ExtractionPlannerFailed" }, dependencies, command.runId); }
        if (!replanned.ok) return fail({ kind: "ExtractionPlanInvalid", ...(isRecord(replanned.error) && text(replanned.error.kind) ? { causeKind: replanned.error.kind } : {}) }, dependencies, command.runId);
        if (!validPlan(replanned.value) || replanned.value.frontier.length > dependencies.policy.maximumFrontier) return fail({ kind: "ExtractionPlanInvalid" }, dependencies, command.runId);
        const proposedPlan = replanned.value;
        const coverageGoals = new Map(currentPlan.coverageGoals.map((goal) => [goal.id, goal]));
        for (const goal of proposedPlan.coverageGoals) coverageGoals.set(goal.id, goal);
        const preservedFrontier = (orderedUrls ?? [...new Set([...proposedPlan.frontier, ...(scratchpad.discoveredUrls ?? [])])]).filter((url) => !scratchpad.processedUrls.includes(url) && !scratchpad.failedPages?.some(page => page.url === url));
        if (preservedFrontier.length > dependencies.policy.maximumFrontier) return fail({ kind: "ExtractionLimitExceeded", limit: "frontier" }, dependencies, command.runId);
        currentPlan = freeze({ ...proposedPlan, coverageGoals: freeze([...coverageGoals.values()]), frontier: freeze(preservedFrontier) });
        if (orderedUrls !== undefined) currentPlan = freeze(boundAuthorizedMaterialPlan(currentPlan, preservedFrontier, scratchpad));
        const prematureComplete = currentPlan.stopDecision.decision === "complete" && pendingFrontierUrl(currentPlan, scratchpad) !== null;
        if (prematureComplete) {
          dependencies.logger({ event: "knowledge-extraction-premature-complete-rejected", runId: command.runId, failureKind: "ExtractionCoverageIncomplete" });
          currentPlan = freeze({ ...currentPlan, stopDecision: freeze({ ...currentPlan.stopDecision, decision: "continue", rationale: "Deterministic verification found relevant discovered pages that have not been observed." }) });
        }
        const replannedSaved = await saveCurrentPlan();
        if (!replannedSaved.ok) return replannedSaved;
        const replannedMemory = await remember(dependencies.memory, "decision", "source", { phase: "replan", revision: currentPlan.revision, afterUrl: observation.url, proposedDecision: proposedPlan.stopDecision.decision, decision: currentPlan.stopDecision.decision, rationale: currentPlan.stopDecision.rationale, frontier: currentPlan.frontier.slice(0, 50), discoveredUrls: scratchpad.discoveredUrls?.slice(0, 50) ?? [], unresolvedGaps: currentPlan.unresolvedGaps.slice(0, 50).map((gap) => ({ id: gap.id, priority: gap.priority, description: gap.description })) }, dependencies, command.runId);
        if (!replannedMemory.ok) return replannedMemory;
        for (const gap of currentPlan.unresolvedGaps.slice(0, 50)) {
          const unresolvedMemory = await remember(dependencies.memory, "unresolved", "source", { phase: "replan", gap: { id: gap.id, priority: gap.priority, description: gap.description }, afterUrl: observation.url }, dependencies, command.runId);
          if (!unresolvedMemory.ok) return unresolvedMemory;
        }
        if (currentPlan.stopDecision.decision === "complete") {
          if (pendingFrontierUrl(currentPlan, scratchpad) === null && (scratchpad.failedPages?.length ?? 0) > 0) return completeExtraction("partial-failure");
          if (pendingFrontierUrl(currentPlan, scratchpad) !== null || (!(scratchpad.acceptedHashes.length === 0 && (scratchpad.reviewedCandidateCount??0) > 0) && (!coverageComplete(currentPlan, scratchpad) || currentPlan.unresolvedGaps.some((gap) => gap.priority === "high")))) return fail({ kind: "ExtractionCoverageIncomplete" }, dependencies, command.runId);
          if (scratchpad.acceptedHashes.length === 0 && !((scratchpad.reviewedCandidateCount??0) > 0)) return fail({ kind: "KnowledgeSetEmpty" }, dependencies, command.runId);
          dependencies.logger({ event: "knowledge-extraction-success", runId: command.runId });
          return completeExtraction("agent-complete");
        }
        if (currentPlan.stopDecision.decision === "blocked") {
          if (scratchpad.acceptedHashes.length === 0) return fail({ kind: "ExtractionStopped" }, dependencies, command.runId);
          dependencies.logger({ event: "knowledge-extraction-agent-blocked", runId: command.runId });
          return completeExtraction("agent-blocked");
        }
        if (dependencies.policy.maximumPagesPerExecution !== undefined) {
          if (attemptedPages - previouslyAttemptedPages >= dependencies.policy.maximumPagesPerExecution) {
            dependencies.logger({ event: "knowledge-extraction-chunk-yield", runId: command.runId });
            return { ok: true, value: freeze({ state: "awaiting-time-limit-decision", scratchpad: cloneScratchpad(scratchpad), knowledgePointCount: scratchpad.acceptedHashes.length, pagesProcessed, stopReason: "paused" }) };
          }
        }
      }
    },
  });
}

/**
 * Bound a plan to the source content the learner authorized.
 * Once every supplied section has been observed, model-suggested goals and gaps that
 * refer to unavailable source content cannot be resolved by another fetch.
 * @param {ExtractionPlan} plan
 * @param {readonly string[]} remainingFrontierUrls
 * @param {ExtractionScratchpad} scratchpad
 * @returns {ExtractionPlan}
 */
export function boundAuthorizedMaterialPlan(plan, remainingFrontierUrls, scratchpad) {
  if (remainingFrontierUrls.length > 0) return plan;
  return {
    ...plan,
    frontier: [],
    coverageGoals: plan.coverageGoals.filter((goal) => scratchpad.coverage.includes(goal.id)),
    unresolvedGaps: [],
    stopDecision: {
      decision: "complete",
      rationale: "All content in the selected extraction scope has been observed.",
      evidenceUrls: plan.stopDecision.evidenceUrls,
      unresolvedGapIds: [],
    },
  };
}

/** @param {URL} root @param {URL} candidate @returns {boolean} */
function withinPath(root, candidate) {
  if (root.pathname === "/") return true;
  const rootPath = root.pathname.endsWith("/") ? root.pathname.slice(0, -1) : root.pathname;
  const candidatePath = candidate.pathname.endsWith("/") && candidate.pathname !== "/" ? candidate.pathname.slice(0, -1) : candidate.pathname;
  return candidatePath === rootPath || candidatePath.startsWith(`${rootPath}/`);
}

/** @param {ExtractionPlan} plan @param {ExtractionScratchpad} scratchpad @returns {boolean} */
function coverageComplete(plan, scratchpad) {
  return plan.coverageGoals.every((goal) => scratchpad.coverage.includes(goal.id));
}

export { validCandidate as isKnowledgeCandidate, validPlan as isExtractionPlan, validVisualMediaReference as isVisualMediaReference };
