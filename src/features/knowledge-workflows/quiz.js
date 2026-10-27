import {waitForTransientRetry} from './retry.js';
// @ts-check
import {AgentExecutionBoundaryFailure} from './harness.js';

import { QUIZ_ACCEPTANCE_SCORE, quizAnswerQualityInstruction, limitChoiceOptions, normalizeAssembledQuizPairLimits, validateAssembledQuizPair } from "./quiz-pair.js";

/** @template T, E @typedef {{ readonly ok: true, readonly value: T } | { readonly ok: false, readonly error: E }} Result */
/** @typedef {import("./extraction.js").KnowledgePoint} KnowledgePoint */
/** @typedef {"single-choice" | "multiple-choice" | "fill-blank" | "short-response" | "case-study" | "symbolic" | "notation"} QuizKind */

/**
 * @typedef {{
 *   readonly id: string,
 *   readonly knowledgeId: string,
 *   readonly knowledgeRevision: number,
 *   readonly kind: QuizKind,
 *   readonly prompt: string,
 *   readonly options: readonly string[],
 *   readonly answer: string | readonly string[],
 *   readonly blanks?: readonly { readonly id: string, readonly acceptedAnswers: readonly string[] }[],
 *   readonly explanation?: string,
 *   readonly citedEvidenceUrls: readonly string[],
 *   readonly pairedQuiz?: { readonly multipleChoice: { readonly id: string, readonly kind: "single-choice"|"multiple-choice", readonly prompt: string, readonly options: readonly {readonly key:string,readonly text:string}[], readonly correctOptionKeys: readonly string[], readonly canonicalAnswers: readonly string[], readonly explanation: string }, readonly fillBlank: { readonly id:string,readonly kind:"fill-blank",readonly prompt:string,readonly blanks:readonly {readonly id:string,readonly canonicalAnswer:string,readonly acceptedAnswers:readonly string[]}[], readonly canonicalAnswers:readonly string[], readonly explanation:string }, readonly canonicalAnswers:readonly string[], readonly citedEvidenceUrls:readonly string[] }
 * }} QuestionDraft
 */

/**
 * @typedef {{
 *   readonly id: string,
 *   readonly ownerId: string,
 *   readonly runId: string,
 *   readonly knowledgeId: string,
 *   readonly attempt: number,
 *   readonly draftId: string | null,
 *   readonly score: number | null,
 *   readonly feedback: string | null,
 *   readonly failureKind: string | null,
 *   readonly createdAt: string
 * }} QuizAttempt
 */

/** @typedef {{ readonly knowledgeId: string, readonly status: "accepted" | "abandoned", readonly publicationStatus: "published" | "pending-review" | null, readonly attempts: number, readonly failureKind: string | null, readonly restrictedUntil: string | null }} QuizDisposition */
/** @typedef {{ readonly inputPoints:number,readonly attemptedPoints:number,readonly retriedPoints:number,readonly extraAttempts:number,readonly retryRate:number,readonly quizDroppedPoints:number,readonly quizDropRate:number,readonly exhaustedDropPoints:number,readonly preferenceDroppedPoints:number }} QuizRunStatistics */
/** @typedef {{ readonly dispositions: readonly QuizDisposition[], readonly statistics?: QuizRunStatistics }} QuizRunResult */

/**
 * @typedef {{
 *   readonly kind: "QuizCommandInvalid",
 *   readonly field: string
 * } | {
 *   readonly kind: "QuizSeeLessOften"
 * } | {
 *   readonly kind: "QuizGeneratorFailed",
 *   readonly causeKind?: string
 * } | {
 *   readonly kind: "QuizDuplicate"
 * } | {
 *   readonly kind: "QuizDraftSchemaInvalid"
 * } | {
 *   readonly kind: "QuizDraftUngrounded"
 * } | {
 *   readonly kind: "QuizKnowledgeUngrounded"
 * } | {
 *   readonly kind: "QuizEvaluatorFailed",
 *   readonly causeKind?: string
 * } | {
 *   readonly kind: "QuizEvaluatorOutputInvalid"
 * } | {
 *   readonly kind: "QuizScoreBelowThreshold"
 * } | {
 *   readonly kind: "QuizAttemptLimitReached"
 * } | {
 *   readonly kind: "QuizPublicationFailed"
 * } | {
 *   readonly kind: "QuizRestrictionPersistenceFailed"
 * } | {
 *   readonly kind: "QuizPurgeFailed"
 * } | {
 *   readonly kind: "QuizPurgeBeforeRestrictionExpired"
 * } | {
 *   readonly kind: "QuizPersistenceFailed"
 * } | QuizTechnicalFailure} QuizFailure
 */

/** @typedef {{readonly kind:"KnowledgeModelTimeout"|"KnowledgeModelCancelled"|"KnowledgeModelUnavailable"|"KnowledgeModelResponseReadFailed"|"KnowledgeModelResponseInvalid"|"KnowledgeModelResponseDuplicateKey"|"KnowledgeModelRejected"|"WorkflowAgentAgentOutputInvalid"|"WorkflowStageCallUncertain"|"QuizDraftSchemaInvalid"|"QuizEvaluatorOutputInvalid"|"QuizGeneratorFailed"|"QuizEvaluatorFailed",readonly causeKind?:string,readonly status?:number,readonly technicalRetriesExhausted?:true,readonly technicalAttempts?:number}} QuizTechnicalFailure */

/** @typedef {{ readonly generate: (command: { readonly knowledge: KnowledgePoint, readonly attempt: number, readonly technicalAttempt?: number, readonly feedback: string | null, readonly previousDraft?: QuestionDraft }) => Promise<Result<unknown, unknown>> }} QuestionGenerator */
// Production reviewer only. External benchmark evaluators are never dependencies of this actor.
/** @typedef {{ readonly evaluate: (command: { readonly draft: QuestionDraft, readonly knowledge: { readonly id: string, readonly summary: string, readonly evidenceAnchors: readonly { readonly url: string, readonly selector: string }[] }, readonly deterministicValidation: { readonly ok: true }, readonly attempt: number, readonly technicalAttempt?: number, readonly rubric: string }) => Promise<Result<unknown, unknown>> }} QuestionReviewer */
/**
 * @typedef {{
 *   readonly findPublished: (scope: {readonly ownerId:string,readonly runId:string,readonly knowledgeId:string}) => Promise<Result<{readonly status:"published"|"pending-review",readonly attempt:number}|null,unknown>>,
 *   readonly appendAttempt: (attempt: QuizAttempt) => Promise<Result<null, unknown>>,
 *   readonly publish: (command: { readonly ownerId: string, readonly runId: string, readonly knowledge: KnowledgePoint, readonly draft: QuestionDraft, readonly score: number, readonly attempt: number, readonly status: "published" | "pending-review" }) => Promise<Result<null, unknown>>,
 *   readonly restrict: (command: { readonly ownerId: string, readonly runId: string, readonly knowledgeId: string, readonly restrictedUntil: string, readonly reason: string }) => Promise<Result<null, unknown>>,
 *   readonly discard: (command: { readonly ownerId: string, readonly runId: string, readonly knowledgeId: string, readonly reason: "no-meaningful-quiz" }) => Promise<Result<null, unknown>>,
 *   readonly purge: (command: { readonly ownerId: string, readonly runId: string, readonly knowledgeId: string, readonly before: string }) => Promise<Result<null, unknown>>
 * }} QuizRepository
 */
/** @typedef {{ readonly generator: QuestionGenerator, readonly reviewer: QuestionReviewer, readonly repository: QuizRepository, readonly now: () => string, readonly logger: (entry: { readonly event: string, readonly runId?: string, readonly knowledgeId?: string, readonly failureKind?: string,readonly durationMs?:number }) => void, readonly maxAttempts: number, readonly technicalRetries?:boolean, readonly beforeGenerate?: (knowledge: KnowledgePoint) => Promise<Result<boolean, {readonly kind:string}>>, readonly publicationPolicy?: { readonly samplingVersion: string, readonly factualSamplingRatePercent: number } }} QuizDependencies */

const freeze = Object.freeze;
// Initial generation plus three corrective retries.
export const QUIZ_MAX_ATTEMPTS = 4;
const acceptedKinds = new Set(["single-choice", "multiple-choice", "fill-blank", "short-response", "case-study", "symbolic", "notation"]);
const factualKinds = new Set(["single-choice", "multiple-choice", "fill-blank"]);

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function record(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }
/** @param {unknown} value @returns {value is string} */
function text(value) { return typeof value === "string" && value.trim() !== ""; }
/** @param {unknown} value @returns {value is number} */
function positiveInteger(value) { return typeof value === "number" && Number.isSafeInteger(value) && value > 0; }
/** @param {unknown} value @returns {boolean} */
function score(value) { return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 10; }
/** @param {unknown} value @returns {value is QuizKind} */
function quizKind(value) { return typeof value === "string" && acceptedKinds.has(value); }

/** @param {unknown} value @returns {value is QuestionDraft} */
function validDraft(value) {
  if (record(value) && value.explanation !== undefined && (!text(value.explanation) || value.explanation.length > 4000)) return false;
  if (record(value) && value.blanks !== undefined && (!Array.isArray(value.blanks) || value.blanks.length < 2 || value.blanks.some((blank, index) => !record(blank) || blank.id !== `blank-${index + 1}` || !Array.isArray(blank.acceptedAnswers) || blank.acceptedAnswers.length === 0 || !blank.acceptedAnswers.every(text)))) return false;
  return record(value) && text(value.id) && text(value.knowledgeId) && positiveInteger(value.knowledgeRevision) && quizKind(value.kind) && text(value.prompt) && Array.isArray(value.options) && value.options.every(text) && Array.isArray(value.citedEvidenceUrls) && value.citedEvidenceUrls.length > 0 && value.citedEvidenceUrls.every(text) && ((typeof value.answer === "string" && text(value.answer)) || (Array.isArray(value.answer) && value.answer.length > 0 && value.answer.every(text)));
}

/** Enforce the response burden again on verified drafts before publication; never mutate stored raw evidence.
 * @param {unknown} value @param {()=>number} [random] @returns {unknown}
 */
export function normalizeQuizDraftLimits(value, random = Math.random) {
  if (!validDraft(value)) return value;
  if (value.pairedQuiz !== undefined) {
    const pair = normalizeAssembledQuizPairLimits(value.pairedQuiz, random);
    if (!validateAssembledQuizPair(pair)) return value;
    if (pair === value.pairedQuiz) return value;
    const correct = pair.multipleChoice.correctOptionKeys.map(key => pair.multipleChoice.options.find(option => option.key === key)?.text);
    return { ...value, kind: pair.multipleChoice.kind, prompt: pair.multipleChoice.prompt, options: pair.multipleChoice.options.map(option => option.text), answer: pair.multipleChoice.kind === "single-choice" ? correct[0] : correct, explanation: pair.multipleChoice.explanation, pairedQuiz: pair };
  }
  if (value.kind === "single-choice" || value.kind === "multiple-choice") {
    if (value.kind === "single-choice" && typeof value.answer !== "string" || value.kind === "multiple-choice" && !Array.isArray(value.answer)) return value;
    const answers = typeof value.answer === "string" ? [value.answer] : value.answer;
    if (new Set(answers).size !== answers.length || answers.some(answer => !value.options.includes(answer))) return value;
    const removed = answers.slice(3);
    const kept = answers.slice(0, 3);
    const options = limitChoiceOptions(value.options.filter(option => !removed.includes(option)).map(key => ({ key })), kept, random).map(option => option.key);
    return { ...value, options, answer: value.kind === "single-choice" ? value.answer : kept };
  }
  if (value.kind === "fill-blank" && value.blanks !== undefined && value.blanks.length > 3 && Array.isArray(value.answer) && value.answer.length === value.blanks.length && value.blanks.every((blank, index) => blank.acceptedAnswers[0] === value.answer[index]) && (value.prompt.match(/_{2,}/gu) ?? []).length === value.blanks.length) {
    let position = 0;
    const blanks = value.blanks;
    const prompt = value.prompt.replace(/_{2,}/gu, () => { const index = position++; return index < 3 ? "____" : blanks[index].acceptedAnswers[0]; });
    return { ...value, prompt, answer: value.answer.slice(0, 3), blanks: blanks.slice(0, 3) };
  }
  return value;
}

/** @param {unknown} value @returns {value is { readonly score: number, readonly reasons: readonly string[], readonly feedback: string, readonly groundingProblems: readonly string[], readonly knowledgeGroundingProblems?: readonly string[] }} */
function validEvaluation(value) {
  return record(value) && score(value.score) && Array.isArray(value.reasons) && value.reasons.length > 0 && value.reasons.every(text) && text(value.feedback) && Array.isArray(value.groundingProblems) && value.groundingProblems.every(text) && (value.knowledgeGroundingProblems === undefined || Array.isArray(value.knowledgeGroundingProblems) && value.knowledgeGroundingProblems.every(text));
}


/** @typedef {{readonly claim:string,readonly kind:"unsupported"|"source-conflicting"|"unpictured",readonly reason:string}} QuizKnowledgeGroundingIssue */
/** Fresh native criticism binds each source fault to the current retained summary.
 * Legacy actor evaluations and cached raw evidence are not reinterpreted here.
 * @param {unknown} value
 * @param {{readonly summary:string}} knowledge
 * @returns {value is {readonly score:number,readonly reasons:readonly string[],readonly feedback:string,readonly groundingProblems:readonly string[],readonly knowledgeGroundingProblems:readonly QuizKnowledgeGroundingIssue[]}}
 */
export function isKnowledgeQuizEvaluation(value, knowledge) {
  if (!record(value) || Object.keys(value).sort().join(",") !== "feedback,groundingProblems,knowledgeGroundingProblems,reasons,score" || !text(knowledge?.summary)) return false;
  const {knowledgeGroundingProblems, ...evaluation} = value;
  return validEvaluation(evaluation) && Array.isArray(knowledgeGroundingProblems) && knowledgeGroundingProblems.every(issue =>
    record(issue) && Object.keys(issue).sort().join(",") === "claim,kind,reason" && text(issue.claim) && knowledge.summary.includes(issue.claim) &&
    ["unsupported", "source-conflicting", "unpictured"].includes(/** @type {string} */ (issue.kind)) && text(issue.reason));
}

/** Validate fresh model output once, then preserve the actor's existing negative/discard contract.
 * The raw model value remains untouched in its native stage and paid receipt.
 * @param {unknown} value
 * @param {{readonly summary:string}} knowledge
 * @returns {Result<{readonly score:number,readonly reasons:readonly string[],readonly feedback:string,readonly groundingProblems:readonly string[],readonly knowledgeGroundingProblems:readonly string[]},{readonly kind:"QuizEvaluatorOutputInvalid"}>}
 */
export function normalizeKnowledgeQuizEvaluation(value, knowledge) {
  if (!isKnowledgeQuizEvaluation(value, knowledge)) return {ok:false,error:{kind:"QuizEvaluatorOutputInvalid"}};
  return {ok:true,value:{...value,knowledgeGroundingProblems:value.knowledgeGroundingProblems.map(issue => `${issue.kind}: ${JSON.stringify(issue.claim)} — ${issue.reason}`)}};
}

/** @param {QuestionDraft} draft @param {KnowledgePoint} knowledge @returns {QuizFailure | null} */
function validateGrounding(draft, knowledge) {
  if (draft.knowledgeId !== knowledge.id || draft.knowledgeRevision !== knowledge.sourceRevision) return { kind: "QuizDraftSchemaInvalid" };
  const evidence = new Set(knowledge.evidenceAnchors.map((anchor) => anchor.url));
  if (draft.citedEvidenceUrls.some((url) => !evidence.has(url))) return { kind: "QuizDraftUngrounded" };
  if (draft.pairedQuiz !== undefined && (!validateAssembledQuizPair(draft.pairedQuiz) || draft.pairedQuiz.citedEvidenceUrls.length === 0 || draft.pairedQuiz.citedEvidenceUrls.some((url) => !evidence.has(url)) || draft.kind !== draft.pairedQuiz.multipleChoice.kind || draft.prompt !== draft.pairedQuiz.multipleChoice.prompt)) return { kind: "QuizDraftSchemaInvalid" };
  if (new Set(draft.options.map((option) => option.normalize("NFKC").trim().toLocaleLowerCase())).size !== draft.options.length) return { kind: "QuizDraftSchemaInvalid" };
  if (draft.kind === "single-choice" && (draft.options.length < 2 || draft.options.length > 5 || typeof draft.answer !== "string" || !draft.options.includes(draft.answer))) return { kind: "QuizDraftSchemaInvalid" };
  if (draft.kind === "multiple-choice" && (draft.options.length < 2 || draft.options.length > 5 || !Array.isArray(draft.answer) || draft.answer.length > 3 || draft.answer.length >= draft.options.length || new Set(draft.answer).size !== draft.answer.length || draft.answer.some((answer) => !draft.options.includes(answer)))) return { kind: "QuizDraftSchemaInvalid" };
  if (draft.kind === "fill-blank") {
    if (draft.options.length !== 0 || (draft.blanks !== undefined && (draft.blanks.length > 3 || !Array.isArray(draft.answer) || draft.answer.length !== draft.blanks.length || draft.blanks.some((blank, index) => blank.acceptedAnswers[0] !== draft.answer[index]) || (draft.prompt.match(/_{2,}/gu) ?? []).length !== draft.blanks.length))) return { kind: "QuizDraftSchemaInvalid" };
  } else if (draft.blanks !== undefined) return { kind: "QuizDraftSchemaInvalid" };
  return null;
}

/** @param {unknown} command @returns {command is { readonly ownerId: string, readonly runId: string, readonly points: readonly KnowledgePoint[] }} */
function validCommand(command) {
  return record(command) && text(command.ownerId) && text(command.runId) && Array.isArray(command.points) && command.points.every((point) => record(point) && text(point.id) && text(point.sourceId) && positiveInteger(point.sourceRevision) && text(point.summary) && Array.isArray(point.evidenceAnchors));
}

/** @param {string} _ownerId @param {KnowledgePoint} _knowledge @param {QuestionDraft} _draft @param {{ readonly samplingVersion: string, readonly factualSamplingRatePercent: number }} _policy @returns {"published"} */
function publicationStatus(_ownerId, _knowledge, _draft, _policy) {
  return "published";
}

/** @param {QuizFailure} failure @param {QuizDependencies} dependencies @param {string} runId @param {string | undefined} knowledgeId @returns {Result<never, QuizFailure>} */
function fail(failure, dependencies, runId, knowledgeId) { dependencies.logger({ event: "quiz-actor-critic-failure", runId, knowledgeId, failureKind: failure.kind }); return { ok: false, error: failure }; }

const draftRepairFeedback = quizAnswerQualityInstruction + " Regenerate a schema-valid draft with at most five options per MCQ, at most three correct multi-select options and at most three fill-blank entries, using only the knowledge point's cited support. For a paired quiz, canonicalAnswers, correctOptionKeys, correctOptionAnswers and fillBlank.blanks must have equal counts and corresponding order: one unique correct key per answer and blank, with exactly the same answer text in canonicalAnswers, correctOptionAnswers.canonicalAnswer, fillBlank.blanks.canonicalAnswer and acceptedAnswers[0]. Each blank must ask for that actual answer, not a subset or combined phrase. Within each acceptedAnswers list, the exact canonical answer alone is sufficient. Synonyms are optional; include the exact canonical answer first and only distinct legitimate synonyms, never cosmetic glyph or Unicode variants that normalize to an existing entry. All entries must be unique after Unicode NFKC normalization, trimming, case folding and collapsing whitespace. Capitalization, compatibility-character and whitespace variants are duplicates, not extra aliases.";

/** @param {unknown} error @returns {error is QuizTechnicalFailure} */
function retryableTechnicalFailure(error) {
  if (!record(error) || !text(error.kind)) return false;
  if (text(error.causeKind) && /Persistence|Ledger|Accounting|Authorization|Credential|Budget|Permission|Usage|Billing|Cost/u.test(error.causeKind)) return false;
  if (error.kind === "KnowledgeModelRejected") return typeof error.status==="number"&&(error.status>=200&&error.status<300||[408,429,500,502,503,504].includes(error.status));
  return /^(KnowledgeModel(Timeout|Cancelled|Unavailable|ResponseReadFailed|ResponseInvalid|ResponseDuplicateKey)|WorkflowAgentAgentOutputInvalid|WorkflowStageCallUncertain|QuizDraftSchemaInvalid|QuizEvaluatorOutputInvalid|QuizGeneratorFailed|QuizEvaluatorFailed)$/u.test(error.kind);
}

/** @template T
 * @param {(technicalAttempt:number)=>Promise<Result<unknown,unknown>>} work
 * @param {(value:unknown)=>Result<T,QuizFailure>} parse
 * @param {"QuizGeneratorFailed"|"QuizEvaluatorFailed"} fallback
 * @param {(failure:unknown)=>void} [repair]
 * @param {boolean} [retry]
 * @param {(failure:unknown,durationMs:number)=>void} [onRetry]
 * @returns {Promise<Result<T,QuizFailure>>}
 */
async function technicalCall(work,parse,fallback,repair,retry=true,onRetry=()=>{}) {
  for (let technicalAttempt=1;technicalAttempt<=(retry?4:1);technicalAttempt++) {
    /** @type {Result<T,unknown>} */ let result;
    try { const raw=await work(technicalAttempt); result=raw.ok?parse(raw.value):raw; }
    catch (error) { if(error instanceof AgentExecutionBoundaryFailure)throw error; result={ok:false,error:{kind:fallback}}; }
    if(result.ok)return result;
    const failure=result.error;
    if(record(failure)&&(failure.kind==="QuizDuplicate"||failure.kind==="QuizDraftUngrounded"))return {ok:false,error:{kind:failure.kind}};
    if(!retryableTechnicalFailure(failure))return {ok:false,error:{kind:fallback,...(record(failure)&&text(failure.kind)?{causeKind:text(failure.causeKind)?failure.causeKind:failure.kind}:{}),...(record(failure)&&failure.technicalRetriesExhausted===true?{technicalRetriesExhausted:true,technicalAttempts:4}:{})}};
    if(!retry)return {ok:false,error:failure};
    if(failure.technicalRetriesExhausted || technicalAttempt===4)return {ok:false,error:{...failure,technicalRetriesExhausted:true,technicalAttempts:failure.technicalAttempts??technicalAttempt}};
    const delay=await waitForTransientRetry(failure,technicalAttempt);
    onRetry(failure,delay);
    repair?.(failure);
  }
  throw new Error("Quiz technical attempt limit violated");
}

/** @param {QuizDependencies} dependencies */
export function createQuizActorCritic(dependencies) {
  const policy = dependencies?.publicationPolicy ?? { samplingVersion: "factual-sampling-v1", factualSamplingRatePercent: 30 };
  if (!dependencies || typeof dependencies.generator?.generate !== "function" || typeof dependencies.reviewer?.evaluate !== "function" || typeof dependencies.repository?.findPublished !== "function" || typeof dependencies.repository.appendAttempt !== "function" || typeof dependencies.repository.publish !== "function" || typeof dependencies.repository.discard !== "function" || typeof dependencies.repository.purge !== "function" || typeof dependencies.now !== "function" || typeof dependencies.logger !== "function" || ![2, 3, QUIZ_MAX_ATTEMPTS].includes(dependencies.maxAttempts) || !text(policy.samplingVersion) || !Number.isInteger(policy.factualSamplingRatePercent) || policy.factualSamplingRatePercent < 0 || policy.factualSamplingRatePercent > 100) throw new TypeError("Quiz actor-critic dependencies are invalid.");
  return Object.freeze({
    /** @param {unknown} command @returns {Promise<Result<QuizRunResult, QuizFailure>>} */
    async run(command) {
      if (!validCommand(command)) return fail({ kind: "QuizCommandInvalid", field: "command" }, dependencies, "unknown", undefined);
      dependencies.logger({ event: "quiz-actor-critic-entry", runId: command.runId });
      /** @type {QuizDisposition[]} */
      const dispositions = [];
      for (const knowledge of command.points) {
        /** @param {unknown} failure @param {number} durationMs */
        const onRetry=(failure,durationMs)=>dependencies.logger({event:'quiz-technical-retry',runId:command.runId,knowledgeId:knowledge.id,failureKind:record(failure)&&text(failure.kind)?failure.kind:'QuizTechnicalFailure',durationMs});
        let existing;
        try { existing = await dependencies.repository.findPublished({ownerId:command.ownerId,runId:command.runId,knowledgeId:knowledge.id}); }
        catch (error) { if (!(error instanceof Error)) throw error; return fail({kind:"QuizPersistenceFailed"},dependencies,command.runId,knowledge.id); }
        if (!existing.ok) return fail({kind:"QuizPersistenceFailed"},dependencies,command.runId,knowledge.id);
        if (existing.value !== null) {
          if ((existing.value.status !== "published" && existing.value.status !== "pending-review") || !Number.isSafeInteger(existing.value.attempt) || existing.value.attempt < 1 || existing.value.attempt > QUIZ_MAX_ATTEMPTS) return fail({kind:"QuizPersistenceFailed"},dependencies,command.runId,knowledge.id);
          dispositions.push(freeze({knowledgeId:knowledge.id,status:"accepted",publicationStatus:existing.value.status,attempts:existing.value.attempt,failureKind:null,restrictedUntil:null}));
          dependencies.logger({event:"quiz-actor-critic-reused",runId:command.runId,knowledgeId:knowledge.id});
          continue;
        }
        if (dependencies.beforeGenerate !== undefined) {
          const allowed=await dependencies.beforeGenerate(knowledge);
          if(!allowed.ok)return fail({kind:"QuizGeneratorFailed",causeKind:allowed.error.kind},dependencies,command.runId,knowledge.id);
          if(!allowed.value) {
            const discarded=await dependencies.repository.discard({ownerId:command.ownerId,runId:command.runId,knowledgeId:knowledge.id,reason:"no-meaningful-quiz"});
            if(!discarded.ok)return fail({kind:"QuizPurgeFailed"},dependencies,command.runId,knowledge.id);
            dispositions.push(freeze({knowledgeId:knowledge.id,status:"abandoned",publicationStatus:null,attempts:0,failureKind:"QuizSeeLessOften",restrictedUntil:null}));
            continue;
          }
        }
        /** @type {string|null} */ let feedback = null;
        /** @type {QuestionDraft|null} */ let previousDraft = null;
        let lastFailure = /** @type {QuizFailure["kind"] | null} */ (null);
        let attempts = 0;
        let accepted = false;
        /** @type {"published" | "pending-review" | null} */
        let acceptedPublicationStatus = null;
        for (let attempt = 1; attempt <= dependencies.maxAttempts; attempt += 1) {
          attempts = attempt;
          /** @type {string|null} */ let technicalFeedback=feedback;
          /** @type {Result<QuestionDraft,QuizFailure>} */ const generated=await technicalCall(technicalAttempt=>dependencies.generator.generate({knowledge,attempt,technicalAttempt,feedback:technicalFeedback,...(previousDraft===null?{}:{previousDraft})}),value=>{
            value = normalizeQuizDraftLimits(value);
            if(!validDraft(value))return {ok:false,error:{kind:"QuizDraftSchemaInvalid"}};
            const invalid=validateGrounding(value,knowledge);
            return invalid?.kind==="QuizDraftSchemaInvalid"?{ok:false,error:invalid}:{ok:true,value};
          },"QuizGeneratorFailed",failure=>{
            if(record(failure)&&failure.kind==="QuizDraftSchemaInvalid") {
              technicalFeedback=feedback===null?draftRepairFeedback:feedback+"\n"+draftRepairFeedback;
              if(Array.isArray(failure.validationIssues)&&failure.validationIssues.length&&failure.validationIssues.every(text))technicalFeedback+="\nPaired-quiz validation issues from the previous draft; fix every listed issue:\n"+failure.validationIssues.join("\n");
            }
          },dependencies.technicalRetries!==false,onRetry);
          if (!generated.ok) {
            if(generated.error.kind!=="QuizDuplicate"&&generated.error.kind!=="QuizDraftUngrounded")return fail(generated.error,dependencies,command.runId,knowledge.id);
            lastFailure=generated.error.kind;
            const saved=await persistAttempt(dependencies.repository,{ownerId:command.ownerId,runId:command.runId,knowledgeId:knowledge.id,attempt,draftId:null,score:null,feedback:null,failureKind:lastFailure,createdAt:dependencies.now()},dependencies,command.runId,knowledge.id);
            if(!saved.ok)return saved;
            feedback=lastFailure==="QuizDuplicate"?"This draft repeats a quiz already generated for this source. Test a distinct meaningful relationship, not a reworded duplicate.":"Use only the knowledge point's cited evidence.";
            previousDraft = null;
            continue;
          }
          const draft = /** @type {QuestionDraft} */ (generated.value);
          const groundingFailure = validateGrounding(draft, knowledge);
          if (groundingFailure !== null) {
            lastFailure = groundingFailure.kind;
            const saved = await persistAttempt(dependencies.repository, { ownerId: command.ownerId, runId: command.runId, knowledgeId: knowledge.id, attempt, draftId: draft.id, score: null, feedback: null, failureKind: lastFailure, createdAt: dependencies.now() }, dependencies, command.runId, knowledge.id);
            if (!saved.ok) return saved;
            feedback = "Use only the knowledge point's cited evidence.";
            previousDraft = null;
            continue;
          }
          const qualityRubric = "10 means the draft tests the key concept precisely; 1 means irrelevant or too general. " + quizAnswerQualityInstruction + " In reasons, justify the distinct central understanding tested by EVERY canonical answer. Score below " + QUIZ_ACCEPTANCE_SCORE + " for any weak, incidental or overlapping target or filler distractor; higher answer counts earn no credit. Identify exact weak target text in feedback. Supported but low-value wording is a quiz quality fault, not a knowledgeGroundingProblems source fault.";
          let evaluationRubric=qualityRubric;
          const evaluated=await technicalCall(technicalAttempt=>dependencies.reviewer.evaluate({draft,knowledge:{id:knowledge.id,summary:knowledge.summary,evidenceAnchors:knowledge.evidenceAnchors},deterministicValidation:{ok:true},attempt,technicalAttempt,rubric:evaluationRubric}),value=>validEvaluation(value)?{ok:true,value}:{ok:false,error:{kind:"QuizEvaluatorOutputInvalid"}},"QuizEvaluatorFailed",failure=>{
            if(record(failure)&&["QuizEvaluatorOutputInvalid","KnowledgeModelResponseInvalid","KnowledgeModelResponseDuplicateKey"].includes(String(failure.kind)))evaluationRubric=qualityRubric+" Previous response failed format validation. Return the required JSON schema exactly: score is an integer from 1 to 10; reasons is a nonempty string array; feedback is a string; groundingProblems is a string array; knowledgeGroundingProblems is an array of typed claim/kind/reason objects citing an exact current summary claim, or [] when there is no point-level fault. Re-evaluate this unchanged draft using the same quality standards.";
          },dependencies.technicalRetries!==false,onRetry);
          if(!evaluated.ok)return fail(evaluated.error,dependencies,command.runId,knowledge.id);
          const evaluation = evaluated.value;
          lastFailure = evaluation.knowledgeGroundingProblems?.length ? "QuizKnowledgeUngrounded" : evaluation.score >= QUIZ_ACCEPTANCE_SCORE && evaluation.groundingProblems.length === 0 ? null : evaluation.score >= QUIZ_ACCEPTANCE_SCORE ? "QuizDraftUngrounded" : "QuizScoreBelowThreshold";
          const saved = await persistAttempt(dependencies.repository, { ownerId: command.ownerId, runId: command.runId, knowledgeId: knowledge.id, attempt, draftId: draft.id, score: evaluation.score, feedback: evaluation.feedback, failureKind: lastFailure, createdAt: dependencies.now() }, dependencies, command.runId, knowledge.id);
          if (!saved.ok) return saved;
          if (lastFailure === "QuizKnowledgeUngrounded") break;
          if (evaluation.score >= QUIZ_ACCEPTANCE_SCORE && evaluation.groundingProblems.length === 0) {
            if(dependencies.beforeGenerate!==undefined) {
              const allowed=await dependencies.beforeGenerate(knowledge);
              if(!allowed.ok)return fail({kind:"QuizGeneratorFailed",causeKind:allowed.error.kind},dependencies,command.runId,knowledge.id);
              if(!allowed.value){lastFailure="QuizSeeLessOften";break;}
            }
            const status = publicationStatus(command.ownerId, knowledge, draft, policy);
            let published;
            try { published = await dependencies.repository.publish({ ownerId: command.ownerId, runId: command.runId, knowledge, draft, score: evaluation.score, attempt, status }); } catch (error) { return fail({ kind: "QuizPublicationFailed" }, dependencies, command.runId, knowledge.id); }
            if (!published.ok) {
              if (record(published.error) && published.error.kind === "QuizDuplicate") {
                lastFailure = "QuizDuplicate";
                feedback = "This draft duplicates an existing quiz from the same source. Test a distinct meaningful relationship.";
                previousDraft = null;
                continue;
              }
              return fail({ kind: "QuizPublicationFailed" }, dependencies, command.runId, knowledge.id);
            }
            accepted = true;
            acceptedPublicationStatus = status;
            break;
          }
          feedback = evaluation.feedback;
          previousDraft = draft;
        }
        if (accepted) {
          dispositions.push(freeze({ knowledgeId: knowledge.id, status: "accepted", publicationStatus: acceptedPublicationStatus, attempts, failureKind: null, restrictedUntil: null }));
          continue;
        }
        // A failed quiz does not invalidate independently verified knowledge.
        if(lastFailure==="QuizKnowledgeUngrounded"||lastFailure==="QuizSeeLessOften")try {
          const discarded = await dependencies.repository.discard({ ownerId: command.ownerId, runId: command.runId, knowledgeId: knowledge.id, reason: "no-meaningful-quiz" });
          if (!discarded.ok) return fail({ kind: "QuizPurgeFailed" }, dependencies, command.runId, knowledge.id);
        } catch (error) { return fail({ kind: "QuizPurgeFailed" }, dependencies, command.runId, knowledge.id); }
        dispositions.push(freeze({ knowledgeId: knowledge.id, status: "abandoned", publicationStatus: null, attempts, failureKind: lastFailure, restrictedUntil: null }));
      }
      const attemptedPoints=dispositions.filter(item=>item.attempts>0).length;
      const retriedPoints=dispositions.filter(item=>item.attempts>1).length;
      const quizDroppedPoints=dispositions.filter(item=>item.status==="abandoned"&&item.failureKind!=="QuizSeeLessOften").length;
      const statistics=freeze({inputPoints:dispositions.length,attemptedPoints,retriedPoints,extraAttempts:dispositions.reduce((sum,item)=>sum+Math.max(0,item.attempts-1),0),retryRate:attemptedPoints?retriedPoints/attemptedPoints:0,quizDroppedPoints,quizDropRate:dispositions.length?quizDroppedPoints/dispositions.length:0,exhaustedDropPoints:dispositions.filter(item=>item.status==="abandoned"&&item.attempts===dependencies.maxAttempts&&item.failureKind!=="QuizKnowledgeUngrounded"&&item.failureKind!=="QuizSeeLessOften").length,preferenceDroppedPoints:dispositions.filter(item=>item.failureKind==="QuizSeeLessOften").length});
      dependencies.logger({ event: "quiz-actor-critic-success", runId: command.runId });
      return { ok: true, value: freeze({ dispositions: freeze(dispositions), statistics }) };
    },

    /** @param {unknown} command @returns {Promise<Result<null, QuizFailure>>} */
    async purgeExpired(command) {
      if (!record(command) || !text(command.ownerId) || !text(command.runId) || !text(command.knowledgeId) || !text(command.restrictedUntil) || !text(command.before) || !Number.isFinite(Date.parse(command.restrictedUntil)) || !Number.isFinite(Date.parse(command.before))) return fail({ kind: "QuizCommandInvalid", field: "command" }, dependencies, "unknown", undefined);
      if (Date.parse(command.before) < Date.parse(command.restrictedUntil)) return fail({ kind: "QuizPurgeBeforeRestrictionExpired" }, dependencies, command.runId, command.knowledgeId);
      try { const purged = await dependencies.repository.purge({ ownerId: command.ownerId, runId: command.runId, knowledgeId: command.knowledgeId, before: command.before }); return purged.ok ? purged : fail({ kind: "QuizPurgeFailed" }, dependencies, command.runId, command.knowledgeId); } catch (error) { return fail({ kind: "QuizPurgeFailed" }, dependencies, command.runId, command.knowledgeId); }
    },
  });
}

/** @param {QuizRepository} repository @param {Omit<QuizAttempt, "id">} attempt @param {QuizDependencies} dependencies @param {string} runId @param {string} knowledgeId @returns {Promise<Result<null, QuizFailure>>} */
async function persistAttempt(repository, attempt, dependencies, runId, knowledgeId) {
  try { const result = await repository.appendAttempt(Object.freeze({ id: dependencies.maxAttempts!==3 ? `quiz-attempt:${attempt.runId}:${knowledgeId}:${attempt.attempt}` : `quiz-attempt:${crypto.randomUUID()}`, ...attempt })); return result.ok ? result : fail({ kind: "QuizPersistenceFailed" }, dependencies, runId, knowledgeId); } catch (error) { return fail({ kind: "QuizPersistenceFailed" }, dependencies, runId, knowledgeId); }
}

export {};
