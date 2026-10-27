// @ts-check

/** @template T, E @typedef {{ readonly ok: true, readonly value: T } | { readonly ok: false, readonly error: E }} Result */
import { validateSourceRightsProfile } from "../source-library/rights-profile.js";

/** @import { SourceRightsProfile } from "../source-library/rights-profile.js" */

/** @typedef {"source-added" | "rights-assessment" | "awaiting-rights-review" | "awaiting-upload" | "robots-check" | "extraction-loop" | "paused" | "awaiting-time-limit-decision" | "retryable-failure" | "extraction-finalized" | "per-point-quiz-loop" | "completed" | "abandoned"} WorkflowState */
/** @typedef {"rights-review" | "upload-material" | "generate-or-abandon" | null} WorkflowDecision */
/** @typedef {"rights-assessment" | "robots-check" | "extraction-loop" | "extraction-finalized" | "per-point-quiz-loop"} WorkflowRetryStage */

/**
 * @typedef {{
 *   readonly robotsUrl: string,
 *   readonly targetUrl: string,
 *   readonly httpStatus: number,
 *   readonly availability: "present" | "absent" | "unavailable",
 *   readonly content: string,
 *   readonly checkedAt: string,
 *   readonly matchedRule: string | null
 * }} WorkflowRobotsEvidence
 */

/**
 * @typedef {{
 *   readonly pages: number,
 *   readonly knowledgePoints: number,
 *   readonly acceptedQuizzes: number,
 *   readonly pendingQuizzes: number
 * }} WorkflowCounts
 */

/** @typedef {{readonly kind:"user-authorized-link",readonly ownerId:string,readonly sourceId:string,readonly sourceRevision:number,readonly url:string,readonly recordedAt:string}} UserLinkAuthorization */

/**
 * @typedef {{
 *   readonly ownerId: string,
 *   readonly runId: string,
 *   readonly sourceId: string,
 *   readonly sourceRevision: number,
 *   readonly canonicalSourceIdentity: string,
 *   readonly extractionScope?: "page" | "platform",
 *   readonly contentSignature: string,
 *   readonly rightsProfile?: SourceRightsProfile | null,
 *   readonly userAuthorization?: UserLinkAuthorization | null,
 *   readonly materialId?: string | null,
 *   readonly state: WorkflowState,
 *   readonly revision: number,
 *   readonly idempotencyKey: string,
 *   readonly configDigests: Readonly<Record<string, string>>,
 *   readonly robotsEvidence?: WorkflowRobotsEvidence | null,
 *   readonly extractionStartedAt: string | null,
 *   readonly extractionDeadlineAt: string | null,
 *   readonly decisionRequired: WorkflowDecision,
 *   readonly counts: WorkflowCounts,
 *   readonly failureKind: string | null,
 *   readonly retryState?: WorkflowRetryStage,
 *   readonly quizRetryGeneration?: number,
 *   readonly reused: boolean,
 *   readonly createdAt: string,
 *   readonly updatedAt: string
 * }} KnowledgeWorkflowRun
 */

/**
 * @typedef {{
 *   readonly canonicalSourceIdentity: string,
 *   readonly sourceRevision: number,
 *   readonly contentSignature: string,
 *   readonly configDigests: Readonly<Record<string, string>>,
 *   readonly counts: WorkflowCounts
 * }} GlobalSourceReuse
 */

/**
 * @typedef {{
 *   readonly ownerId: string,
 *   readonly runId: string,
 *   readonly expectedRevision: number,
 *   readonly action: "stop" | "resume" | "generate" | "abandon" | "retry-quizzes" | "dismiss-failures",
 *   readonly idempotencyKey: string
 * }} WorkflowControlCommand
 */

/**
 * @typedef {{
 *   readonly kind: "WorkflowCommandInvalid",
 *   readonly field: string
 * } | {
 *   readonly kind: "WorkflowPersistenceFailed"
 * } | {
 *   readonly kind: "WorkflowNotFound"
 * } | {
 *   readonly kind: "WorkflowIdempotencyConflict"
 * } | {
 *   readonly kind: "WorkflowControlStale"
 * } | {
 *   readonly kind: "WorkflowControlInvalid"
 * } | {
 *   readonly kind: "WorkflowTransitionInvalid"
 * } | {
 *   readonly kind: "WorkflowDeadlineDecisionRequired"
 * } | {
 *   readonly kind: "WorkflowCleanupFailed"
 * } | {
 *   readonly kind: "WorkflowMaterialStateInvalid"
 * } | {
 *   readonly kind: "WorkflowMaterialConflict"
 * }} WorkflowFailure
 */

/**
 * @typedef {{
 *   readonly findByIdempotency: (ownerId: string, idempotencyKey: string) => Promise<Result<KnowledgeWorkflowRun | null, WorkflowFailure>>,
 *   readonly findById: (ownerId: string, runId: string) => Promise<Result<KnowledgeWorkflowRun | null, WorkflowFailure>>,
 *   readonly findLatestBySource: (ownerId: string, sourceId: string, sourceRevision: number) => Promise<Result<KnowledgeWorkflowRun | null, WorkflowFailure>>,
 *   readonly findGlobalReuse: (query: { readonly canonicalSourceIdentity: string, readonly sourceRevision: number, readonly contentSignature: string }) => Promise<Result<GlobalSourceReuse | null, WorkflowFailure>>,
 *   readonly insert: (run: KnowledgeWorkflowRun) => Promise<Result<null, WorkflowFailure>>,
 *   readonly update: (command: { readonly ownerId: string, readonly runId: string, readonly expectedRevision: number, readonly next: KnowledgeWorkflowRun }) => Promise<Result<KnowledgeWorkflowRun, WorkflowFailure>>,
 *   readonly markReuse?: (reuse: GlobalSourceReuse & { readonly createdAt: string, readonly updatedAt: string }) => Promise<Result<null, WorkflowFailure>>,
 *   readonly findControl: (ownerId: string, idempotencyKey: string) => Promise<Result<{ readonly fingerprint: string, readonly run: KnowledgeWorkflowRun } | null, WorkflowFailure>>,
 *   readonly recordControl: (command: { readonly ownerId: string, readonly runId: string, readonly idempotencyKey: string, readonly fingerprint: string, readonly run: KnowledgeWorkflowRun }) => Promise<Result<null, WorkflowFailure>>
 * }} WorkflowRepository
 */

/** @typedef {{ readonly abandonRun: (command: { readonly run: KnowledgeWorkflowRun, readonly reason: string }) => Promise<Result<null, { readonly kind: "WorkflowCleanupFailed" }>>, readonly revokeSource: (command: { readonly ownerId: string, readonly sourceId: string, readonly sourceRevision?: number, readonly canonicalSourceIdentity?: string, readonly reason: string }) => Promise<Result<null, { readonly kind: "WorkflowCleanupFailed" }>> }} WorkflowCleanup */
/** @typedef {{ readonly now: () => string, readonly createId: () => string, readonly logger: (entry: { readonly event: string, readonly runId?: string, readonly ownerId?: string, readonly action?: string, readonly failureKind?: string }) => void, readonly extractionEnvelopeMs?: number, readonly cleanup?: WorkflowCleanup }} WorkflowDependencies */

const freeze = Object.freeze;

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** @param {unknown} value @returns {value is string} */
function isNonEmptyText(value) {
  return typeof value === "string" && value.trim() !== "";
}

/** @param {unknown} value @returns {value is number} */
function isPositiveInteger(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/** @param {unknown} value @returns {value is Readonly<Record<string, string>>} */
function isConfigDigests(value) {
  return isRecord(value) && Object.values(value).every(isNonEmptyText);
}

/** @param {unknown} value @returns {value is WorkflowState} */
function isWorkflowState(value) {
  return value === "source-added" || value === "rights-assessment" || value === "awaiting-rights-review" || value === "awaiting-upload" ||
  value === "robots-check" || value === "extraction-loop" || value === "paused" ||
    value === "awaiting-time-limit-decision" || value === "retryable-failure" || value === "extraction-finalized" ||
    value === "per-point-quiz-loop" || value === "completed" || value === "abandoned";
}

/** @param {unknown} value @returns {value is WorkflowRetryStage} */
export function isWorkflowRetryStage(value) {
  return value === "rights-assessment" || value === "robots-check" || value === "extraction-loop" || value === "extraction-finalized" || value === "per-point-quiz-loop";
}

/** @param {unknown} value @returns {value is WorkflowCounts} */
function isCounts(value) {
  return isRecord(value) && [value.pages, value.knowledgePoints, value.acceptedQuizzes, value.pendingQuizzes]
    .every((candidate) => typeof candidate === "number" && Number.isSafeInteger(candidate) && candidate >= 0);
}

/** @param {unknown} value @returns {value is WorkflowRobotsEvidence} */
function isRobotsEvidence(value) {
  return isRecord(value) && isNonEmptyText(value.robotsUrl) && URL.canParse(value.robotsUrl) && new URL(value.robotsUrl).protocol === "https:" &&
    isNonEmptyText(value.targetUrl) && URL.canParse(value.targetUrl) && new URL(value.targetUrl).protocol === "https:" &&
    typeof value.httpStatus === "number" && Number.isSafeInteger(value.httpStatus) && (value.httpStatus === 0 || value.httpStatus >= 100 && value.httpStatus <= 599) &&
    (value.availability === "present" || value.availability === "absent" || value.availability === "unavailable") && typeof value.content === "string" && value.content.length <= 262_144 &&
    (value.availability === "absent" ? value.content === "" && (value.httpStatus === 404 || value.httpStatus === 410) : value.availability === "unavailable" ? value.content === "" || value.httpStatus >= 200 && value.httpStatus <= 299 : value.httpStatus >= 200 && value.httpStatus <= 299) &&
    typeof value.checkedAt === "string" && validTimestamp(value.checkedAt) && (value.matchedRule === null || isNonEmptyText(value.matchedRule));
}

/** @param {unknown} value @returns {value is KnowledgeWorkflowRun} */
function isRun(value) {
  return isRecord(value) && isNonEmptyText(value.ownerId) && isNonEmptyText(value.runId) &&
    isNonEmptyText(value.sourceId) && isPositiveInteger(value.sourceRevision) &&
    isNonEmptyText(value.canonicalSourceIdentity) && isNonEmptyText(value.contentSignature) &&
    (value.extractionScope === undefined || value.extractionScope === "page" || value.extractionScope === "platform") &&
    isWorkflowState(value.state) && typeof value.revision === "number" && Number.isSafeInteger(value.revision) && value.revision >= 0 &&
    isNonEmptyText(value.idempotencyKey) && isConfigDigests(value.configDigests) &&
    (value.extractionStartedAt === null || isNonEmptyText(value.extractionStartedAt)) &&
    (value.extractionDeadlineAt === null || isNonEmptyText(value.extractionDeadlineAt)) &&
    (value.rightsProfile === undefined || value.rightsProfile === null || validateSourceRightsProfile(value.rightsProfile).ok) &&
    (value.userAuthorization === undefined || value.userAuthorization === null || validLinkAuthorization(value.userAuthorization, value)) &&
    (value.materialId === undefined || value.materialId === null || isNonEmptyText(value.materialId)) &&
    (value.robotsEvidence === undefined || value.robotsEvidence === null || isRobotsEvidence(value.robotsEvidence)) &&
    (value.decisionRequired === null || value.decisionRequired === "rights-review" || value.decisionRequired === "upload-material" || value.decisionRequired === "generate-or-abandon") &&
    isCounts(value.counts) && (value.failureKind === null || isNonEmptyText(value.failureKind)) &&
    (value.retryState === undefined || isWorkflowRetryStage(value.retryState)) &&
    (value.quizRetryGeneration === undefined || isPositiveInteger(value.quizRetryGeneration) && value.quizRetryGeneration <= value.revision) &&
    typeof value.reused === "boolean" && isNonEmptyText(value.createdAt) && isNonEmptyText(value.updatedAt);
}

export const isKnowledgeWorkflowRun = isRun;
export const isWorkflowRobotsEvidence = isRobotsEvidence;

/** @param {unknown} value @returns {value is WorkflowControlCommand} */
function isControlCommand(value) {
  return isRecord(value) && isNonEmptyText(value.ownerId) && isNonEmptyText(value.runId) &&
    isPositiveInteger(value.expectedRevision) &&
    (value.action === "stop" || value.action === "resume" || value.action === "generate" || value.action === "abandon" || value.action === "retry-quizzes" || value.action === "dismiss-failures") &&
    isNonEmptyText(value.idempotencyKey);
}

/** @param {unknown} value @returns {string} */
function fingerprint(value) {
  return JSON.stringify(value);
}

/** @param {string} value @returns {boolean} */
function validTimestamp(value) {
  return isNonEmptyText(value) && Number.isFinite(Date.parse(value));
}

/** @param {KnowledgeWorkflowRun} run @returns {KnowledgeWorkflowRun} */
function cloneRun(run) {
  return freeze({ ...run, rightsProfile: run.rightsProfile ?? null, materialId: run.materialId ?? null, robotsEvidence: run.robotsEvidence ?? null, configDigests: freeze({ ...run.configDigests }), counts: freeze({ ...run.counts }) });
}

/** @param {KnowledgeWorkflowRun} run @param {WorkflowControlCommand["action"]} action @param {boolean} deadlineReached @returns {boolean} */
function isAllowedControl(run, action, deadlineReached) {
  if (action === "dismiss-failures") return run.state === "completed" && ["WorkflowPagesFailed","WorkflowQuizItemsFailed"].includes(run.failureKind??"");
  if (action === "retry-quizzes") return run.state === "completed" && run.failureKind === "WorkflowQuizItemsFailed";
  if (action === "stop") return run.state === "extraction-loop" && !deadlineReached;
  if (action === "resume") return run.state === "paused" || run.state === "retryable-failure" || run.state === "awaiting-time-limit-decision" || (run.state === "completed" && ["WorkflowPagesFailed","WorkflowQuizItemsFailed"].includes(run.failureKind??"")) || (run.state === "extraction-loop" && deadlineReached);
  if (action === "generate") return run.state === "paused" || run.state === "awaiting-time-limit-decision" || (run.state === "extraction-loop" && deadlineReached);
  return run.state !== "completed" && run.state !== "abandoned";
}

/** @param {KnowledgeWorkflowRun} run @param {WorkflowControlCommand["action"]} action @param {string} now @param {boolean} deadlineReached @param {number} envelopeMs @returns {KnowledgeWorkflowRun} */
function nextForControl(run, action, now, deadlineReached, envelopeMs) {
  if (action === "dismiss-failures") return cloneRun({...run,revision:run.revision+1,failureKind:"WorkflowFailedItemsDismissed",updatedAt:now});
  const state = action === "retry-quizzes" ? "per-point-quiz-loop" : action === "stop"
    ? "paused"
    : action === "resume"
    ? run.state === "retryable-failure" ? run.retryState ?? "extraction-loop" : "extraction-loop"
    : action === "generate"
    ? "per-point-quiz-loop"
    : "abandoned";
  return cloneRun({
    ...run,
    state,
    revision: run.revision + 1,
    decisionRequired: null,
    extractionStartedAt: action === "resume" && state === "extraction-loop" && deadlineReached ? now : run.extractionStartedAt,
    extractionDeadlineAt: action === "resume" && state === "extraction-loop" && deadlineReached ? new Date(Date.parse(now) + envelopeMs).toISOString() : run.extractionDeadlineAt,
    updatedAt: now,
    ...(action === "retry-quizzes" ? {quizRetryGeneration:run.revision+1,failureKind:"WorkflowRetryFailedQuizzes"} : action === "abandon" ? { failureKind: "WorkflowAbandoned" } : action === "resume" ? { failureKind: run.state === "completed" ? "WorkflowRetryFailedPages" : run.failureKind === "WorkflowRetryFailedPages" ? run.failureKind : null } : {}),
  });
}

/** @param {WorkflowState} current @param {WorkflowState} next @returns {boolean} */
function isAllowedTransition(current, next) {
  if (current === next) return current === "extraction-loop" || current === "per-point-quiz-loop";
  if (next === "retryable-failure") return isWorkflowRetryStage(current);
  const allowed = {
    "source-added": new Set(["rights-assessment", "awaiting-rights-review", "abandoned"]),
    "rights-assessment": new Set(["awaiting-upload", "awaiting-rights-review", "robots-check", "abandoned"]),
    "awaiting-rights-review": new Set(["robots-check", "abandoned"]),
    "awaiting-upload": new Set(["extraction-loop", "abandoned"]),
    "robots-check": new Set(["extraction-loop", "awaiting-upload", "abandoned"]),
    "extraction-loop": new Set(["paused", "awaiting-time-limit-decision", "retryable-failure", "extraction-finalized", "awaiting-upload", "abandoned"]),
    "retryable-failure": new Set(["extraction-loop", "abandoned"]),
    "paused": new Set(["extraction-loop", "per-point-quiz-loop", "abandoned"]),
    "awaiting-time-limit-decision": new Set(["extraction-loop", "per-point-quiz-loop", "abandoned"]),
    "extraction-finalized": new Set(["per-point-quiz-loop", "abandoned"]),
    "per-point-quiz-loop": new Set(["completed", "abandoned"]),
    "completed": new Set(),
    "abandoned": new Set(),
  };
  return allowed[current].has(next);
}

/** @param {KnowledgeWorkflowRun} run @param {WorkflowRepository} repository @returns {Promise<Result<KnowledgeWorkflowRun, WorkflowFailure>>} */
async function persistReuse(run, repository) {
  // Personal processing grants are owner-scoped, not permission for global reuse.
  if (run.state !== "completed" || ["WorkflowPagesFailed","WorkflowQuizItemsFailed","WorkflowFailedItemsDismissed"].includes(run.failureKind ?? "") || run.materialId != null || run.userAuthorization != null || typeof repository.markReuse !== "function") return { ok: true, value: run };
  const marked = await repository.markReuse({ canonicalSourceIdentity: run.canonicalSourceIdentity, sourceRevision: run.sourceRevision, contentSignature: run.contentSignature, configDigests: run.configDigests, counts: run.counts, createdAt: run.createdAt, updatedAt: run.updatedAt });
  return marked.ok ? { ok: true, value: run } : marked;
}

/** @param {WorkflowRepository} repository @param {WorkflowDependencies} dependencies */
export function createKnowledgeWorkflowService(repository, dependencies) {
  const envelopeMs = dependencies?.extractionEnvelopeMs ?? 30 * 60 * 1_000;
  if (!repository || typeof repository.findByIdempotency !== "function" || typeof repository.findById !== "function" || typeof repository.findLatestBySource !== "function" ||
    typeof repository.findGlobalReuse !== "function" || typeof repository.insert !== "function" ||
    typeof repository.update !== "function" || typeof repository.findControl !== "function" ||
    typeof repository.recordControl !== "function" || !dependencies || typeof dependencies.now !== "function" ||
    typeof dependencies.createId !== "function" || typeof dependencies.logger !== "function" ||
    !Number.isSafeInteger(envelopeMs) || envelopeMs <= 0) {
    throw new TypeError("Knowledge workflow dependencies are invalid.");
  }
  return Object.freeze({
    /** @param {unknown} command @returns {Promise<Result<{ readonly run: KnowledgeWorkflowRun, readonly reused: boolean }, WorkflowFailure>>} */
    async createRun(command) {
      if (!isRecord(command) || !isNonEmptyText(command.ownerId) || !isNonEmptyText(command.sourceId) ||
        !isPositiveInteger(command.sourceRevision) || !isNonEmptyText(command.canonicalSourceIdentity) ||
        !isNonEmptyText(command.contentSignature) || !isNonEmptyText(command.idempotencyKey) ||
        !isConfigDigests(command.configDigests)) {
        return { ok: false, error: { kind: "WorkflowCommandInvalid", field: "command" } };
      }
      if (command.extractionScope !== undefined && command.extractionScope !== "page" && command.extractionScope !== "platform") return {ok:false,error:{kind:"WorkflowCommandInvalid",field:"extractionScope"}};
      if (command.sourceOrigin !== undefined && command.sourceOrigin !== "private-document" && command.sourceOrigin !== "url-material") {
        return { ok: false, error: { kind: "WorkflowCommandInvalid", field: "sourceOrigin" } };
      }
      if (command.userAuthorization !== undefined && command.userAuthorization !== null && !validLinkAuthorization(command.userAuthorization, command)) return {ok:false,error:{kind:"WorkflowCommandInvalid",field:"userAuthorization"}};
      let normalizedRightsProfile = null;
      if (command.rightsProfile !== undefined && command.rightsProfile !== null) {
        const checkedProfile = validateSourceRightsProfile(command.rightsProfile);
        if (!checkedProfile.ok) return { ok: false, error: { kind: "WorkflowCommandInvalid", field: "rightsProfile" } };
        if (!URL.canParse(command.canonicalSourceIdentity) || checkedProfile.value.canonicalRootUrl !== new URL(command.canonicalSourceIdentity).href) return { ok: false, error: { kind: "WorkflowCommandInvalid", field: "rightsProfile.canonicalRootUrl" } };
        normalizedRightsProfile = checkedProfile.value;
      }
      dependencies.logger({ event: "knowledge-workflow.create-entry", ownerId: command.ownerId });
      let attemptKey = command.idempotencyKey;
      /** @param {KnowledgeWorkflowRun} existing */
      const matches = (existing) => existing.extractionScope === command.extractionScope && existing.sourceId === command.sourceId && existing.sourceRevision === command.sourceRevision && existing.canonicalSourceIdentity === command.canonicalSourceIdentity && existing.contentSignature === command.contentSignature && fingerprint(existing.configDigests) === fingerprint(command.configDigests) && fingerprint(existing.rightsProfile ?? null) === fingerprint(normalizedRightsProfile) && fingerprint(existing.userAuthorization ?? null) === fingerprint(command.userAuthorization ?? null);
      while (true) {
        const replay = await repository.findByIdempotency(command.ownerId, attemptKey);
        if (!replay.ok) return replay;
        if (replay.value === null) break;
        if (!matches(replay.value)) return {ok:false,error:{kind:"WorkflowIdempotencyConflict"}};
        if (replay.value.state !== "abandoned") return {ok:true,value:freeze({run:cloneRun(replay.value),reused:true})};
        // Keep cancelled attempts and their data immutable; all writers derive the same next key.
        attemptKey = `after-cancel:${replay.value.runId}`;
      }
      const reuse = await repository.findGlobalReuse({ canonicalSourceIdentity: command.canonicalSourceIdentity, sourceRevision: command.sourceRevision, contentSignature: command.contentSignature });
      if (!reuse.ok) return reuse;
      const now = dependencies.now();
      if (!validTimestamp(now)) throw new TypeError("Knowledge workflow clock returned an invalid timestamp.");
      const run = cloneRun({
        ownerId: command.ownerId,
        runId: dependencies.createId(),
        sourceId: command.sourceId,
        sourceRevision: command.sourceRevision,
        canonicalSourceIdentity: command.canonicalSourceIdentity,
        ...(command.extractionScope === undefined ? {} : {extractionScope: command.extractionScope}),
        contentSignature: command.contentSignature,
        rightsProfile: normalizedRightsProfile,
        userAuthorization: /** @type {UserLinkAuthorization|null} */(command.userAuthorization ?? null),
        materialId: null,
        state: command.sourceOrigin === "private-document" || command.sourceOrigin === "url-material" ? "awaiting-upload" : "source-added",
        revision: 1,
        idempotencyKey: attemptKey,
        configDigests: command.configDigests,
        robotsEvidence: null,
        extractionStartedAt: null,
        extractionDeadlineAt: null,
        decisionRequired: null,
        counts: { pages: 0, knowledgePoints: 0, acceptedQuizzes: 0, pendingQuizzes: 0 },
        failureKind: null,
        reused: false,
        createdAt: now,
        updatedAt: now,
      });
      if (!isRun(run)) throw new TypeError("Knowledge workflow run construction violated its contract.");
      const inserted = await repository.insert(run);
      if (!inserted.ok) {
        if (inserted.error.kind !== "WorkflowIdempotencyConflict") return inserted;
        const winner = await repository.findByIdempotency(run.ownerId, run.idempotencyKey);
        if (!winner.ok) return winner;
        if (winner.value === null) return {ok:false,error:{kind:"WorkflowPersistenceFailed"}};
        if (!matches(winner.value)) return {ok:false,error:{kind:"WorkflowIdempotencyConflict"}};
        dependencies.logger({event:"knowledge-workflow.create-success",ownerId:run.ownerId,runId:winner.value.runId,action:"concurrent-reuse"});
        return {ok:true,value:freeze({run:cloneRun(winner.value),reused:true})};
      }
      dependencies.logger({ event: "knowledge-workflow.create-success", ownerId: command.ownerId, runId: run.runId, action: reuse.value === null ? "new-source" : "reuse-candidate" });
      return { ok: true, value: freeze({ run, reused: false }) };
    },

    /** @param {unknown} command @param {{executionStopped?:boolean}} [execution] @returns {Promise<Result<KnowledgeWorkflowRun, WorkflowFailure>>} */
    async control(command, execution = {}) {
      if (!isControlCommand(command)) return { ok: false, error: { kind: "WorkflowCommandInvalid", field: "command" } };
      dependencies.logger({ event: "knowledge-workflow.control-entry", ownerId: command.ownerId, runId: command.runId, action: command.action });
      const runResult = await repository.findById(command.ownerId, command.runId);
      if (!runResult.ok) return runResult;
      if (runResult.value === null) return { ok: false, error: { kind: "WorkflowNotFound" } };
      const run = runResult.value;
      const controlFingerprint = fingerprint({ runId: command.runId, expectedRevision: command.expectedRevision, action: command.action });
      const replay = await repository.findControl(command.ownerId, command.idempotencyKey);
      if (!replay.ok) return replay;
      if (replay.value !== null) {
        return replay.value.fingerprint === controlFingerprint
          ? { ok: true, value: cloneRun(replay.value.run) }
          : { ok: false, error: { kind: "WorkflowIdempotencyConflict" } };
      }
      const now = dependencies.now();
      if (!validTimestamp(now)) throw new TypeError("Knowledge workflow clock returned an invalid timestamp.");
      const deadlineReached = run.extractionDeadlineAt !== null && Date.parse(now) >= Date.parse(run.extractionDeadlineAt);
      const retryingAbandon = command.action === "abandon" && run.state === "abandoned" && (run.failureKind === "WorkflowAbandoned" || run.failureKind === "WorkflowSourceRevoked") && command.expectedRevision + 1 === run.revision;
      if (!retryingAbandon && run.revision !== command.expectedRevision) return { ok: false, error: { kind: "WorkflowControlStale" } };
      const recoveringExecution = execution.executionStopped === true && command.action === "resume" && isWorkflowRetryStage(run.state);
      if (!retryingAbandon && !recoveringExecution && !isAllowedControl(run, command.action, deadlineReached)) return { ok: false, error: { kind: "WorkflowControlInvalid" } };
      if (retryingAbandon) {
        if (dependencies.cleanup !== undefined) {
          const cleaned = await dependencies.cleanup.abandonRun({ run, reason: "workflow-abandoned" });
          if (!cleaned.ok) return cleaned;
        }
        const recorded = await repository.recordControl({ ownerId: command.ownerId, runId: command.runId, idempotencyKey: command.idempotencyKey, fingerprint: controlFingerprint, run });
        if (!recorded.ok) return recorded;
        dependencies.logger({ event: "knowledge-workflow.control-success", ownerId: command.ownerId, runId: command.runId, action: command.action });
        return { ok: true, value: cloneRun(run) };
      }
      const next = nextForControl(recoveringExecution ? {...run,state:"retryable-failure",retryState:run.state} : run, command.action, now, deadlineReached, envelopeMs);
      const updated = await repository.update({ ownerId: command.ownerId, runId: command.runId, expectedRevision: command.expectedRevision, next });
      if (!updated.ok) return updated;
      if (command.action === "abandon" && dependencies.cleanup !== undefined) {
        const cleaned = await dependencies.cleanup.abandonRun({ run: updated.value, reason: "workflow-abandoned" });
        if (!cleaned.ok) return cleaned;
      }
      if (updated.value.state === "completed") {
        const persisted = await persistReuse(updated.value, repository);
        if (!persisted.ok) return persisted;
      }
      const recorded = await repository.recordControl({ ownerId: command.ownerId, runId: command.runId, idempotencyKey: command.idempotencyKey, fingerprint: controlFingerprint, run: updated.value });
      if (!recorded.ok) return recorded;
      dependencies.logger({ event: "knowledge-workflow.control-success", ownerId: command.ownerId, runId: command.runId, action: command.action });
      return { ok: true, value: cloneRun(updated.value) };
    },

    /** @param {unknown} command @returns {Promise<Result<KnowledgeWorkflowRun, WorkflowFailure>>} */
    async attachMaterial(command) {
      if (!isRecord(command) || !isNonEmptyText(command.ownerId) || !isNonEmptyText(command.runId) || !isNonEmptyText(command.materialId)) return { ok: false, error: { kind: "WorkflowCommandInvalid", field: "material" } };
      const loaded = await repository.findById(command.ownerId, command.runId);
      if (!loaded.ok) return loaded;
      if (loaded.value === null) return { ok: false, error: { kind: "WorkflowNotFound" } };
      const run = loaded.value;
      if (run.materialId === command.materialId) return { ok: true, value: cloneRun(run) };
      if (run.materialId !== null && run.materialId !== undefined && run.materialId !== command.materialId) return { ok: false, error: { kind: "WorkflowMaterialConflict" } };
      if (run.state !== "awaiting-upload") return { ok: false, error: { kind: "WorkflowMaterialStateInvalid" } };
      const now = dependencies.now();
      if (!validTimestamp(now)) throw new TypeError("Knowledge workflow clock returned an invalid timestamp.");
      const uploadFallback = run.failureKind?.startsWith("WorkflowExtractionFailed:") && run.counts.knowledgePoints === 0;
      const startedAt = uploadFallback ? now : run.extractionStartedAt ?? now;
      const deadline = !uploadFallback && run.extractionDeadlineAt !== null ? run.extractionDeadlineAt : new Date(Date.parse(startedAt) + envelopeMs).toISOString();
      const next = cloneRun({ ...run, materialId: command.materialId.trim(), state: "extraction-loop", revision: run.revision + 1, decisionRequired: null, failureKind: null, extractionStartedAt: startedAt, extractionDeadlineAt: deadline, updatedAt: now });
      const updated = await repository.update({ ownerId: run.ownerId, runId: run.runId, expectedRevision: run.revision, next });
      if (!updated.ok) return updated;
      dependencies.logger({ event: "knowledge-workflow.material-attached", ownerId: run.ownerId, runId: run.runId });
      return { ok: true, value: cloneRun(updated.value) };
    },

    /** @param {unknown} command @returns {Promise<Result<null, WorkflowFailure>>} */
    async revokeSource(command) {
      if (!isRecord(command) || !isNonEmptyText(command.ownerId) || !isNonEmptyText(command.sourceId) || (command.sourceRevision !== undefined && !isPositiveInteger(command.sourceRevision)) || !isNonEmptyText(command.reason)) return { ok: false, error: { kind: "WorkflowCommandInvalid", field: "sourceId" } };
      if (dependencies.cleanup === undefined) return { ok: true, value: null };
      return dependencies.cleanup.revokeSource({ ownerId: command.ownerId, sourceId: command.sourceId, ...(command.sourceRevision === undefined ? {} : { sourceRevision: command.sourceRevision }), ...(isNonEmptyText(command.canonicalSourceIdentity) ? { canonicalSourceIdentity: command.canonicalSourceIdentity } : {}), reason: command.reason });
    },

    /** @param {unknown} command @returns {Promise<Result<KnowledgeWorkflowRun, WorkflowFailure>>} */
    async rightsApproved(command) {
      if (!isRecord(command) || !isNonEmptyText(command.ownerId) || !isNonEmptyText(command.sourceId) || !isPositiveInteger(command.sourceRevision)) {
        return { ok: false, error: { kind: "WorkflowCommandInvalid", field: "command" } };
      }
      dependencies.logger({ event: "knowledge-workflow.rights-approved-entry", ownerId: command.ownerId });
      const loaded = await repository.findLatestBySource(command.ownerId, command.sourceId, command.sourceRevision);
      if (!loaded.ok) return loaded;
      if (loaded.value === null) return { ok: false, error: { kind: "WorkflowNotFound" } };
      const run = loaded.value;
      if (run.state !== "source-added" && run.state !== "rights-assessment" && run.state !== "awaiting-rights-review") {
        return { ok: true, value: cloneRun(run) };
      }
      const now = dependencies.now();
      if (!validTimestamp(now)) throw new TypeError("Knowledge workflow clock returned an invalid timestamp.");
      const reuse = await repository.findGlobalReuse({ canonicalSourceIdentity: run.canonicalSourceIdentity, sourceRevision: run.sourceRevision, contentSignature: run.contentSignature });
      if (!reuse.ok) return reuse;
      const next = cloneRun(reuse.value === null
        ? { ...run, state: "robots-check", revision: run.revision + 1, decisionRequired: null, updatedAt: now }
        : { ...run, state: "completed", revision: run.revision + 1, decisionRequired: null, counts: reuse.value.counts, reused: true, updatedAt: now });
      const updated = await repository.update({ ownerId: run.ownerId, runId: run.runId, expectedRevision: run.revision, next });
      if (!updated.ok) return updated;
      if (updated.value.state === "completed") {
        const persisted = await persistReuse(updated.value, repository);
        if (!persisted.ok) return persisted;
      }
      dependencies.logger({ event: "knowledge-workflow.rights-approved-success", ownerId: run.ownerId, runId: run.runId });
      return { ok: true, value: cloneRun(updated.value) };
    },

    /** @param {unknown} command @returns {Promise<Result<KnowledgeWorkflowRun, WorkflowFailure>>} */
    async advance(command) {
      if (!isRecord(command) || !isNonEmptyText(command.ownerId) || !isNonEmptyText(command.runId) ||
        !isPositiveInteger(command.expectedRevision) || !isWorkflowState(command.nextState) ||
        (command.counts !== undefined && !isCounts(command.counts)) ||
        (command.robotsEvidence !== undefined && command.robotsEvidence !== null && !isRobotsEvidence(command.robotsEvidence)) ||
        (command.failureKind !== undefined && command.failureKind !== null && !isNonEmptyText(command.failureKind))) {
        return { ok: false, error: { kind: "WorkflowCommandInvalid", field: "command" } };
      }
      const loaded = await repository.findById(command.ownerId, command.runId);
      if (!loaded.ok) return loaded;
      if (loaded.value === null) return { ok: false, error: { kind: "WorkflowNotFound" } };
      const run = loaded.value;
      if (run.revision !== command.expectedRevision) return { ok: false, error: { kind: "WorkflowControlStale" } };
      const nextState = /** @type {WorkflowState} */ (command.nextState);
      if (!isAllowedTransition(run.state, nextState) || (run.state === nextState && command.counts === undefined)) return { ok: false, error: { kind: "WorkflowTransitionInvalid" } };
      if (!validTimestamp(dependencies.now())) throw new TypeError("Knowledge workflow clock returned an invalid timestamp.");
      const started = nextState === "extraction-loop" && run.extractionStartedAt === null;
      const now = dependencies.now();
      const counts = command.counts === undefined ? run.counts : command.counts;
      if (counts.pages < run.counts.pages || counts.knowledgePoints < run.counts.knowledgePoints || counts.acceptedQuizzes < run.counts.acceptedQuizzes || counts.pendingQuizzes < run.counts.pendingQuizzes) {
        return { ok: false, error: { kind: "WorkflowTransitionInvalid" } };
      }
      const next = cloneRun({
        ...run,
        state: nextState,
        revision: run.revision + 1,
        decisionRequired: nextState === "awaiting-rights-review" ? "rights-review" : nextState === "awaiting-time-limit-decision" ? "generate-or-abandon" : null,
        extractionStartedAt: started ? now : run.extractionStartedAt,
        extractionDeadlineAt: started ? new Date(Date.parse(now) + envelopeMs).toISOString() : run.extractionDeadlineAt,
        robotsEvidence: command.robotsEvidence === undefined ? run.robotsEvidence ?? null : command.robotsEvidence,
        counts,
        failureKind: command.failureKind === undefined ? run.failureKind : command.failureKind,
        ...(nextState === "retryable-failure" && isWorkflowRetryStage(run.state) ? {retryState:run.state} : {}),
        updatedAt: now,
      });
      const updated = await repository.update({ ownerId: command.ownerId, runId: command.runId, expectedRevision: command.expectedRevision, next });
      if (!updated.ok) return updated;
      if (updated.value.state === "completed") {
        const persisted = await persistReuse(updated.value, repository);
        if (!persisted.ok) return persisted;
      }
      return { ok: true, value: cloneRun(updated.value) };
    },

    /** @param {unknown} command @returns {Promise<Result<KnowledgeWorkflowRun, WorkflowFailure>>} */
    async ensureReuse(command) {
      if (!isRecord(command) || !isNonEmptyText(command.ownerId) || !isNonEmptyText(command.runId)) return { ok: false, error: { kind: "WorkflowCommandInvalid", field: "command" } };
      const loaded = await repository.findById(command.ownerId, command.runId);
      if (!loaded.ok) return loaded;
      if (loaded.value === null) return { ok: false, error: { kind: "WorkflowNotFound" } };
      const persisted = await persistReuse(loaded.value, repository);
      return persisted.ok ? { ok: true, value: cloneRun(loaded.value) } : persisted;
    },

    /** @param {unknown} command @returns {Promise<Result<KnowledgeWorkflowRun, WorkflowFailure>>} */
    async status(command) {
      if (!isRecord(command) || !isNonEmptyText(command.ownerId) || !isNonEmptyText(command.runId)) return { ok: false, error: { kind: "WorkflowCommandInvalid", field: "command" } };
      const loaded = await repository.findById(command.ownerId, command.runId);
      if (!loaded.ok) return loaded;
      return loaded.value === null ? { ok: false, error: { kind: "WorkflowNotFound" } } : { ok: true, value: cloneRun(loaded.value) };
    },
  });
}

export {};

/** @param {unknown} value @param {Record<string,unknown>} binding @returns {value is UserLinkAuthorization} */
function validLinkAuthorization(value,binding) {
 return isRecord(value) && Object.keys(value).length===6 && value.kind==="user-authorized-link" && value.ownerId===binding.ownerId && value.sourceId===binding.sourceId && value.sourceRevision===binding.sourceRevision && value.url===binding.canonicalSourceIdentity && typeof value.recordedAt === "string" && validTimestamp(value.recordedAt);
}
