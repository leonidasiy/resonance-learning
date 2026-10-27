// @ts-check

import { isWorkflowRobotsEvidence } from "./workflow.js";

/** @template T, E @typedef {{ readonly ok: true, readonly value: T } | { readonly ok: false, readonly error: E }} Result */
/** @typedef {import("./workflow.js").KnowledgeWorkflowRun} KnowledgeWorkflowRun */
/** @typedef {import("./workflow.js").WorkflowRobotsEvidence} WorkflowRobotsEvidence */
/** @typedef {import("./workflow.js").WorkflowState} WorkflowState */
/** @typedef {import("./rights.js").RightsDecision} RightsDecision */
/** @typedef {import("./extraction.js").KnowledgePoint} KnowledgePoint */
/** @typedef {import("./quiz.js").QuizRunResult} QuizRunResult */
/** @typedef {"extraction-loop" | "paused" | "awaiting-time-limit-decision" | "extraction-finalized" | "per-point-quiz-loop"} WorkflowResumableState */

/**
 * @typedef {{
 *   readonly stage: "rights" | "robots" | "extraction" | "knowledge" | "classification" | "quiz" | "cleanup" | "transition",
 *   readonly causeKind: string,
 *   readonly detailKind?: string,
 *   readonly detailDiagnosticToken?: string,
 *   readonly resumableState?: WorkflowResumableState
 * }} WorkflowExecutorFailure
 */

/**
 * @typedef {{
 *   readonly state: WorkflowState,
 *   readonly run: KnowledgeWorkflowRun,
 *   readonly restrictedUntil?: string | null,
 *   readonly restrictedKnowledgeIds?: readonly string[]
 * }} WorkflowExecutionResult
 */

/** @typedef {{ readonly run: KnowledgeWorkflowRun, readonly rootUrl: string, readonly rightsAssessment?: RightsDecision }} WorkflowExecutionCommand */
/** @typedef {{ readonly check: (command: { readonly rights: RightsDecision, readonly targetUrl?: string }) => Promise<Result<unknown, unknown>> }} WorkflowRobots */
/** @typedef {{ readonly run: (command: { readonly run: KnowledgeWorkflowRun, readonly rights: RightsDecision, readonly robots: unknown, readonly onKnowledge?: () => void }) => Promise<Result<{ readonly state: "completed" | "paused" | "awaiting-time-limit-decision", readonly scratchpad: unknown, readonly knowledgePointCount: number, readonly pagesProcessed: number }, unknown>> }} WorkflowExtraction */
/** @typedef {{ readonly reviewedEmpty?: (scope:{readonly ownerId:string,readonly runId:string,readonly sourceId:string,readonly sourceRevision:number})=>Promise<Result<boolean,unknown>>, readonly list: (scope: { readonly ownerId: string, readonly runId: string, readonly sourceId: string, readonly sourceRevision: number, readonly incremental?: boolean }) => Promise<Result<readonly KnowledgePoint[], unknown>> }} WorkflowKnowledge */
/** @typedef {{ readonly run: (command: { readonly ownerId: string, readonly runId: string, readonly points: readonly KnowledgePoint[] }) => Promise<Result<QuizRunResult & {readonly hasMore?:boolean}, unknown>> }} WorkflowQuiz */
/** @typedef {{ readonly ensure: (command: { readonly ownerId: string, readonly sourceId: string, readonly sourceRevision: number, readonly points: readonly KnowledgePoint[], readonly incremental?: boolean }) => Promise<Result<null, unknown>> }} WorkflowClassification */
/** @typedef {{ readonly close: () => Promise<Result<null, unknown>> }} WorkflowCleanup */
/** @typedef {{ readonly transition: (command: { readonly run: KnowledgeWorkflowRun, readonly nextState: WorkflowState, readonly counts?: { readonly pages: number, readonly knowledgePoints: number, readonly acceptedQuizzes: number, readonly pendingQuizzes: number }, readonly robotsEvidence?: WorkflowRobotsEvidence | null, readonly failureKind?: string | null }) => Promise<Result<KnowledgeWorkflowRun, unknown>>, readonly robots: WorkflowRobots, readonly extraction: WorkflowExtraction, readonly knowledge: WorkflowKnowledge, readonly classification: WorkflowClassification, readonly quiz: WorkflowQuiz, readonly cleanup?: WorkflowCleanup, readonly logger: (entry: { readonly event: string, readonly runId?: string, readonly stage?: string, readonly failureKind?: string, readonly diagnosticToken?: string }) => void }} WorkflowExecutorDependencies */

const freeze = Object.freeze;

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function record(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }
/** @param {unknown} value @returns {value is string} */
function text(value) { return typeof value === "string" && value.trim() !== ""; }
/** @param {unknown} value @returns {value is number} */
function positiveInteger(value) { return typeof value === "number" && Number.isSafeInteger(value) && value > 0; }
/** @param {unknown} value @returns {value is WorkflowState} */
function state(value) { return value === "source-added" || value === "rights-assessment" || value === "awaiting-rights-review" || value === "awaiting-upload" || value === "robots-check" || value === "extraction-loop" || value === "paused" || value === "awaiting-time-limit-decision" || value === "retryable-failure" || value === "extraction-finalized" || value === "per-point-quiz-loop" || value === "completed" || value === "abandoned"; }
/** @param {unknown} value @returns {value is RightsDecision} */
function allowedRights(value) { return record(value) && value.status === "allowed" && text(value.ownerId) && text(value.sourceId) && positiveInteger(value.sourceRevision) && text(value.canonicalUrl); }
/** @param {unknown} value @returns {value is KnowledgeWorkflowRun} */
function validRun(value) { return record(value) && text(value.ownerId) && text(value.runId) && text(value.sourceId) && positiveInteger(value.sourceRevision) && text(value.canonicalSourceIdentity) && URL.canParse(value.canonicalSourceIdentity) && new URL(value.canonicalSourceIdentity).protocol === "https:" && state(value.state) && positiveInteger(value.revision); }
/** @param {unknown} value @returns {value is WorkflowExecutionCommand} */
function validCommand(value) { return record(value) && validRun(value.run) && text(value.rootUrl) && URL.canParse(value.rootUrl) && new URL(value.rootUrl).protocol === "https:" && (value.rightsAssessment === undefined || allowedRights(value.rightsAssessment)); }

/** @param {WorkflowExecutionCommand} command @param {KnowledgeWorkflowRun} run @returns {command is WorkflowExecutionCommand & { readonly rightsAssessment: RightsDecision }} */
function rightsMatch(command, run) {
  const rights = command.rightsAssessment;
  return rights !== undefined && rights.ownerId === run.ownerId && rights.sourceId === run.sourceId && rights.sourceRevision === run.sourceRevision && new URL(rights.canonicalUrl).href === new URL(run.canonicalSourceIdentity).href && new URL(command.rootUrl).href === new URL(run.canonicalSourceIdentity).href;
}

/** @param {KnowledgePoint} point @param {KnowledgeWorkflowRun} run */
function knowledgeScopeMatches(point, run) {
  const scoped = /** @type {KnowledgePoint & { readonly ownerId?: string, readonly runId?: string }} */ (point);
  return point.sourceId === run.sourceId && point.sourceRevision === run.sourceRevision && (scoped.ownerId === undefined || scoped.ownerId === run.ownerId) && (scoped.runId === undefined || scoped.runId === run.runId);
}

/** @param {unknown} value @returns {boolean} */
function requiresAuthorizedMaterial(value) {
  return value === "KnowledgePageBotAccessDenied" || value === "KnowledgePageRateLimited" || value === "KnowledgePageAuthenticationRequired" || value === "KnowledgePagePaywallDetected";
}

/** @param {string} value @returns {boolean} */
function isRobotsFailure(value) { return value === "RobotsDenied" || value.startsWith("Robots") || value.startsWith("KnowledgeRobots"); }

/** @param {unknown} value @returns {string | undefined} */
function failureDetailKind(value) {
  if (!record(value)) return undefined;
  if (text(value.causeKind)) return value.causeKind;
  return text(value.kind) ? value.kind : undefined;
}

/** @param {unknown} value @returns {string | undefined} */
function failureDetailDiagnosticToken(value) {
  if (!record(value) || typeof value.diagnosticToken !== "string" || !/^[a-z0-9-]+$/u.test(value.diagnosticToken)) return undefined;
  return value.diagnosticToken;
}

/** @param {WorkflowExecutorFailure["stage"]} stage @param {string} causeKind @param {unknown} detail @param {WorkflowResumableState} [resumableState] @param {string} [rejectionKind] @returns {WorkflowExecutorFailure} */
function operationFailure(stage, causeKind, detail, resumableState = undefined, rejectionKind = undefined) {
  const detailKind = failureDetailKind(detail) ?? rejectionKind;
  const detailDiagnosticToken = failureDetailDiagnosticToken(detail);
  return { stage, causeKind, ...(detailKind === undefined ? {} : { detailKind }), ...(detailDiagnosticToken === undefined ? {} : { detailDiagnosticToken }), ...(resumableState === undefined ? {} : { resumableState }) };
}

/** @param {WorkflowExecutorDependencies} dependencies @param {Parameters<WorkflowExecutorDependencies["transition"]>[0]} command @returns {Promise<Result<KnowledgeWorkflowRun, unknown>>} */
async function transition(dependencies, command) {
  try { return await dependencies.transition(command); } catch (error) { return { ok: false, error: { kind: failureDetailKind(error) ?? "WorkflowTransitionRejected" } }; }
}

/** @param {WorkflowExecutorFailure} error @param {WorkflowExecutorDependencies} dependencies @param {string} runId @returns {Result<never, WorkflowExecutorFailure>} */
function fail(error, dependencies, runId) {
  dependencies.logger({ event: "knowledge-workflow-executor-failure", runId, stage: error.stage, failureKind: error.causeKind, ...(error.detailDiagnosticToken === undefined ? {} : { diagnosticToken: error.detailDiagnosticToken }) });
  return { ok: false, error };
}

/** @param {WorkflowExecutorDependencies} dependencies */
export function createKnowledgeWorkflowExecutor(dependencies) {
  if (!dependencies || typeof dependencies.transition !== "function" || typeof dependencies.robots?.check !== "function" || typeof dependencies.extraction?.run !== "function" || typeof dependencies.knowledge?.list !== "function" || typeof dependencies.classification?.ensure !== "function" || typeof dependencies.quiz?.run !== "function" || (dependencies.cleanup !== undefined && typeof dependencies.cleanup.close !== "function") || typeof dependencies.logger !== "function") throw new TypeError("Knowledge workflow executor dependencies are invalid.");
  /** @param {unknown} input @returns {Promise<Result<WorkflowExecutionResult, WorkflowExecutorFailure>>} */
  async function execute(input) {
      if (!validCommand(input)) return fail({ stage: "transition", causeKind: "WorkflowCommandInvalid" }, dependencies, "unknown");
      const command = /** @type {WorkflowExecutionCommand} */ (input);
      let current = command.run;
      dependencies.logger({ event: "knowledge-workflow-executor-entry", runId: current.runId });
      if (current.state === "retryable-failure") return { ok: true, value: freeze({ state: current.state, run: current }) };
      if (current.state === "source-added" || current.state === "rights-assessment") {
        const transitioned = await transition(dependencies, { run: current, nextState: "awaiting-rights-review" });
        if (!transitioned.ok) return fail(operationFailure("transition", "WorkflowTransitionFailed", transitioned.error), dependencies, current.runId);
        current = transitioned.value;
      }
      if (current.state === "awaiting-rights-review") return { ok: true, value: freeze({ state: current.state, run: current }) };
      if (current.state === "robots-check") {
        if (!rightsMatch(command, current)) return fail({ stage: "rights", causeKind: "WorkflowRightsRequired" }, dependencies, current.runId);
        let robots;
        try { robots = await dependencies.robots.check({ rights: command.rightsAssessment }); } catch (error) { return fail(operationFailure("robots", "WorkflowRobotsFailed", error, undefined, "RobotsDependencyRejected"), dependencies, current.runId); }
        if (!robots.ok) return fail(operationFailure("robots", "WorkflowRobotsFailed", robots.error), dependencies, current.runId);
        const robotsEvidence = isWorkflowRobotsEvidence(robots.value) ? robots.value : undefined;
        const transitioned = await transition(dependencies, { run: current, nextState: "extraction-loop", ...(robotsEvidence === undefined ? {} : { robotsEvidence }) });
        if (!transitioned.ok) return fail(operationFailure("transition", "WorkflowTransitionFailed", transitioned.error), dependencies, current.runId);
        current = transitioned.value;
      }
      if (current.state === "extraction-loop" || current.state === "paused" || current.state === "awaiting-time-limit-decision") {
        if (!rightsMatch(command, current)) return fail({ stage: "rights", causeKind: "WorkflowRightsRequired" }, dependencies, current.runId);
        /** @type {Promise<Result<QuizRunResult,WorkflowExecutorFailure>>|undefined} */ let readyQuiz;
        const onKnowledge=()=>{
          if(readyQuiz!==undefined)return;
          // Start only from committed knowledge, and settle admitted work before any state transition.
          readyQuiz=(async()=>{
            const scope={ownerId:current.ownerId,runId:current.runId,sourceId:current.sourceId,sourceRevision:current.sourceRevision};
            let points;
            try{points=await dependencies.knowledge.list({...scope,incremental:true});}catch(error){return {ok:false,error:operationFailure('knowledge','WorkflowKnowledgeLoadFailed',error,'extraction-loop','KnowledgeRepositoryRejected')};}
            if(!points.ok)return {ok:false,error:operationFailure('knowledge','WorkflowKnowledgeLoadFailed',points.error,'extraction-loop')};
            if(!points.value.every(point=>knowledgeScopeMatches(point,current)))return {ok:false,error:{stage:'knowledge',causeKind:'WorkflowKnowledgeScopeInvalid',resumableState:'extraction-loop'}};
            if(points.value.length===0)return {ok:true,value:{dispositions:[]}};
            let classification;
            try{classification=await dependencies.classification.ensure({...scope,points:points.value,incremental:true});}catch(error){return {ok:false,error:operationFailure('classification','WorkflowSourceClassificationFailed',error,'extraction-loop','SourceClassificationDependencyRejected')};}
            if(!classification.ok)return {ok:false,error:operationFailure('classification','WorkflowSourceClassificationFailed',classification.error,'extraction-loop')};
            try{const quiz=await dependencies.quiz.run({...scope,points:points.value});return quiz.ok?quiz:{ok:false,error:operationFailure('quiz','WorkflowQuizFailed',quiz.error,'extraction-loop')};}catch(error){return {ok:false,error:operationFailure('quiz','WorkflowQuizFailed',error,'extraction-loop','QuizGenerationRejected')};}
          })();
        };
        if(current.state==='extraction-loop'&&current.counts.knowledgePoints>0)onKnowledge();
        let extracted;
        try { extracted = await dependencies.extraction.run({ run: current, rights: command.rightsAssessment, robots: { status: "allowed" },onKnowledge }); }
        catch (error) { await readyQuiz; return fail(operationFailure("extraction", "WorkflowExtractionFailed", error, current.state, "ExtractionDependencyRejected"), dependencies, current.runId); }
        const incremental=await readyQuiz;
        const extractionCounts=incremental?.ok?{...current.counts,acceptedQuizzes:Math.max(current.counts.acceptedQuizzes,incremental.value.dispositions.filter(d=>d.status==='accepted').length),pendingQuizzes:Math.max(current.counts.pendingQuizzes,incremental.value.dispositions.filter(d=>d.publicationStatus==='pending-review').length)}:current.counts;
        if (!extracted.ok) {
          const detailKind = record(extracted.error) && text(extracted.error.causeKind)
            ? extracted.error.causeKind
            : failureDetailKind(extracted.error);
          const detailDiagnosticToken = record(extracted.error) && typeof extracted.error.diagnosticToken === "string" && /^[a-z0-9-]+$/u.test(extracted.error.diagnosticToken) ? extracted.error.diagnosticToken : undefined;
          return fail({ stage: "extraction", causeKind: detailKind !== undefined && requiresAuthorizedMaterial(detailKind) ? "WorkflowUploadRequired" : detailKind !== undefined && isRobotsFailure(detailKind) ? "WorkflowRobotsFailed" : "WorkflowExtractionFailed", ...(detailKind === undefined ? {} : { detailKind }), ...(detailDiagnosticToken === undefined ? {} : { detailDiagnosticToken }), resumableState: current.state }, dependencies, current.runId);
        }
        if(incremental&&!incremental.ok)return fail(incremental.error,dependencies,current.runId);
        if (extracted.value.state === "paused" || extracted.value.state === "awaiting-time-limit-decision") {
          const transitioned = await transition(dependencies, { run: current, nextState: extracted.value.state, counts: { ...extractionCounts, pages: Math.max(current.counts.pages, extracted.value.pagesProcessed), knowledgePoints: Math.max(current.counts.knowledgePoints, extracted.value.knowledgePointCount) } });
          if (!transitioned.ok) return fail(operationFailure("transition", "WorkflowTransitionFailed", transitioned.error, current.state), dependencies, current.runId);
          return { ok: true, value: freeze({ state: transitioned.value.state, run: transitioned.value }) };
        }
        const failedPages = record(extracted.value.scratchpad) && Array.isArray(extracted.value.scratchpad.failedPages) ? extracted.value.scratchpad.failedPages.length : 0;
        const finalized = await transition(dependencies, { run: current, nextState: "extraction-finalized", failureKind: failedPages > 0 ? "WorkflowPagesFailed" : current.failureKind === "WorkflowRetryFailedPages" ? current.failureKind : null, counts: { ...extractionCounts, pages: Math.max(current.counts.pages, extracted?.value?.pagesProcessed ?? current.counts.pages), knowledgePoints: Math.max(current.counts.knowledgePoints, extracted?.value?.knowledgePointCount ?? current.counts.knowledgePoints) } });
        if (!finalized.ok) return fail(operationFailure("transition", "WorkflowTransitionFailed", finalized.error, current.state), dependencies, current.runId);
        current = finalized.value;
      }
      if (current.state === "extraction-finalized" || current.state === "per-point-quiz-loop") {
        if (current.state === "extraction-finalized") {
          const quizStarted = await transition(dependencies, { run: current, nextState: "per-point-quiz-loop" });
          if (!quizStarted.ok) return fail(operationFailure("transition", "WorkflowTransitionFailed", quizStarted.error, "extraction-finalized"), dependencies, current.runId);
          current = quizStarted.value;
        }
        let points;
        try { points = await dependencies.knowledge.list({ ownerId: current.ownerId, runId: current.runId, sourceId: current.sourceId, sourceRevision: current.sourceRevision }); } catch (error) { return fail(operationFailure("knowledge", "WorkflowKnowledgeLoadFailed", error, "per-point-quiz-loop", "KnowledgeRepositoryRejected"), dependencies, current.runId); }
        if (!points.ok) return fail(operationFailure("knowledge", "WorkflowKnowledgeLoadFailed", points.error, "per-point-quiz-loop"), dependencies, current.runId);
        if (points.value.length === 0 && current.counts.knowledgePoints === 0) {
          let empty;
          try { empty=dependencies.knowledge.reviewedEmpty===undefined?{ok:true,value:false}:await dependencies.knowledge.reviewedEmpty({ownerId:current.ownerId,runId:current.runId,sourceId:current.sourceId,sourceRevision:current.sourceRevision}); } catch(error) { return fail(operationFailure("knowledge","WorkflowKnowledgeLoadFailed",error,"per-point-quiz-loop"),dependencies,current.runId); }
          if(!empty.ok)return fail(operationFailure("knowledge","WorkflowKnowledgeLoadFailed",empty.error,"per-point-quiz-loop"),dependencies,current.runId);
          if(!empty.value)return fail({stage:"quiz",causeKind:"KnowledgeSetEmpty",resumableState:"per-point-quiz-loop"},dependencies,current.runId);
        }
        if (!points.value.every((point) => knowledgeScopeMatches(point, current))) return fail({ stage: "quiz", causeKind: "WorkflowKnowledgeScopeInvalid", resumableState: "per-point-quiz-loop" }, dependencies, current.runId);
        let classification;
        try { classification = points.value.length === 0 ? {ok:true,value:null} : await dependencies.classification.ensure({ ownerId: current.ownerId, sourceId: current.sourceId, sourceRevision: current.sourceRevision, points: points.value }); } catch (error) { return fail(operationFailure("classification", "WorkflowSourceClassificationFailed", error, "per-point-quiz-loop", "SourceClassificationDependencyRejected"), dependencies, current.runId); }
        if (!classification.ok) return fail(operationFailure("classification", "WorkflowSourceClassificationFailed", classification.error, "per-point-quiz-loop"), dependencies, current.runId);
        let quiz;
        try { quiz = await dependencies.quiz.run({ ownerId: current.ownerId, runId: current.runId, points: points.value }); } catch (error) { return fail(operationFailure("quiz", "WorkflowQuizFailed", error, "per-point-quiz-loop", "QuizGenerationRejected"), dependencies, current.runId); }
        if (!quiz.ok) return fail(operationFailure("quiz", "WorkflowQuizFailed", quiz.error, "per-point-quiz-loop"), dependencies, current.runId);
        const acceptedQuizzes = quiz.value.dispositions.filter((disposition) => disposition.status === "accepted").length;
        const pendingQuizzes = quiz.value.dispositions.filter((disposition) => disposition.publicationStatus === "pending-review").length;
        const hasMore = quiz.value.hasMore === true;
        const completed = await transition(dependencies, { run: current, nextState: hasMore ? "per-point-quiz-loop" : "completed", failureKind: !hasMore && current.failureKind === "WorkflowRetryFailedPages" ? null : current.failureKind, counts: { ...current.counts, knowledgePoints: Math.max(current.counts.knowledgePoints, points.value.length), acceptedQuizzes: Math.max(current.counts.acceptedQuizzes, acceptedQuizzes), pendingQuizzes: Math.max(current.counts.pendingQuizzes, pendingQuizzes) } });
        if (!completed.ok) return fail(operationFailure("transition", "WorkflowTransitionFailed", completed.error, "per-point-quiz-loop"), dependencies, current.runId);
        if (hasMore) return {ok:true,value:freeze({state:completed.value.state,run:completed.value})};
        dependencies.logger({ event: "knowledge-workflow-executor-success", runId: current.runId });
        const restricted = quiz.value.dispositions.filter((disposition) => disposition.restrictedUntil !== null);
        const restrictedUntil = restricted.map((disposition) => disposition.restrictedUntil).filter((value) => value !== null).sort().at(-1) ?? null;
        return { ok: true, value: freeze({ state: completed.value.state, run: completed.value, restrictedUntil, restrictedKnowledgeIds: freeze(restricted.map((disposition) => disposition.knowledgeId)) }) };
      }
      if (current.state === "completed") return { ok: true, value: freeze({ state: current.state, run: current }) };
      return fail({ stage: "transition", causeKind: "WorkflowStateUnsupported" }, dependencies, current.runId);
  }
  return Object.freeze({
    /** @param {unknown} input @returns {Promise<Result<WorkflowExecutionResult, WorkflowExecutorFailure>>} */
    async run(input) {
      const result = await execute(input);
      if (!validCommand(input) || dependencies.cleanup === undefined) return result;
      let cleaned;
      try { cleaned = await dependencies.cleanup.close(); } catch (error) {
        const failure=fail(operationFailure("cleanup", "WorkflowCleanupFailed", error, undefined, "CleanupDependencyRejected"), dependencies, input.run.runId);
        return result.ok?failure:result;
      }
      if(cleaned.ok)return result;
      const failure=fail(operationFailure("cleanup", "WorkflowCleanupFailed", cleaned.error), dependencies, input.run.runId);
      return result.ok?failure:result;
    },
  });
}

export {};
