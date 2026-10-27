// @ts-check
/** Deferred quiz failures are bookkeeping, never publication or content rejection.
 * The original paid child stages and their accounting remain immutable. */
/** @typedef {{readonly knowledgeId:string,readonly summary:string,readonly failureKind:string,readonly causeKind?:string,readonly status?:number,readonly attempts:4,readonly failedAt:string,readonly generation:number,readonly phase:"generation"|"review",readonly generatorGeneration:number}} FailedQuizItem */
/** @param {unknown} value @returns {value is Record<string,unknown>} */
function record(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** @param {unknown} value @returns {value is string} */
function text(value) {
  return typeof value === "string" && value.trim() !== "";
}
/** @param {unknown} value @returns {value is number} */
function generation(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
/** @param {unknown} error */
export function exhaustedQuizTechnicalFailure(error) {
  if (
    !record(error) || error.technicalRetriesExhausted !== true ||
    error.technicalAttempts !== 4 || !text(error.kind)
  ) return false;
  if (
    text(error.causeKind) &&
    !/^(KnowledgeModel(Timeout|Cancelled|Unavailable|ResponseReadFailed|ResponseInvalid|ResponseDuplicateKey)|WorkflowAgentAgentOutputInvalid|WorkflowStageCallUncertain|QuizDraftSchemaInvalid|QuizEvaluatorOutputInvalid|QuizGeneratorFailed|QuizEvaluatorFailed)$/u
      .test(error.causeKind)
  ) return false;
  if (error.kind === "KnowledgeModelRejected") {
    return typeof error.status === "number" &&
      (error.status >= 200 && error.status < 300 ||
        [408, 429, 500, 502, 503, 504].includes(error.status));
  }
  return /^(KnowledgeModel(Timeout|Cancelled|Unavailable|ResponseReadFailed|ResponseInvalid|ResponseDuplicateKey)|WorkflowAgentAgentOutputInvalid|WorkflowStageCallUncertain|QuizDraftSchemaInvalid|QuizEvaluatorOutputInvalid|QuizGeneratorFailed|QuizEvaluatorFailed)$/u
    .test(error.kind);
}
/** @param {unknown} value */
export function exhaustedQuizQualityFailure(value){
  return record(value)&&value.qualityAttemptsExhausted===true&&value.qualityAttempts===4&&isQuizQualityFailureKind(value.kind);
}
/** @param {unknown} kind */
export function isQuizQualityFailureKind(kind){return ['QuizScoreBelowThreshold','QuizDraftUngrounded','QuizDuplicate'].includes(typeof kind==='string'?kind:'');}
/** @param {import('./knowledge-workflow-d1.js').D1DatabasePort} database @param {{ownerId:string,runId:string}} scope
 * @returns {Promise<{ok:true,value:readonly FailedQuizItem[]}|{ok:false,error:{kind:string}}>} */
export async function readFailedQuizItems(database, scope) {
  try {
    const rows = await database.prepare(
      "SELECT stage_key,result_json FROM knowledge_workflow_stages WHERE owner_id=? AND run_id=? AND stage_key LIKE 'quiz-point-failed:%' AND status='completed' AND NOT EXISTS (SELECT 1 FROM knowledge_workflow_stages completed WHERE completed.owner_id=knowledge_workflow_stages.owner_id AND completed.run_id=knowledge_workflow_stages.run_id AND completed.stage_key='quiz-point-completed:'||json_extract(knowledge_workflow_stages.result_json,'$.value.knowledgeId') AND completed.status='completed')",
    ).bind(scope.ownerId, scope.runId).all();
    if (!rows.success) {
      return { ok: false, error: { kind: "WorkflowStagePersistenceFailed" } };
    }
    /** @type {Map<string,FailedQuizItem>} */ const latest = new Map();
    for (const row of rows.results) {
      const parsed = record(row) && text(row.result_json)
          ? JSON.parse(row.result_json)
          : null,
        item = record(parsed) && parsed.ok === true ? parsed.value : null;
      if (
        !record(row) || !record(item) ||
        !(isQuizQualityFailureKind(item.failureKind)||exhaustedQuizTechnicalFailure({
          ...item,
          kind: item.failureKind,
          technicalRetriesExhausted: true,
          technicalAttempts: 4,
        })) || !text(item.knowledgeId) || !text(item.summary) ||
        !text(item.failureKind) ||
        !(item.causeKind === undefined || text(item.causeKind)) ||
        !(item.status === undefined ||
          typeof item.status === "number" && Number.isInteger(item.status)) ||
        item.attempts !== 4 || !text(item.failedAt) ||
        !Number.isFinite(Date.parse(item.failedAt)) ||
        !generation(item.generation) || !generation(item.generatorGeneration) ||
        item.generatorGeneration > item.generation ||
        !["generation", "review"].includes(String(item.phase)) ||
        row.stage_key !==
          `quiz-point-failed:${item.knowledgeId}:${item.generation}`
      ) return { ok: false, error: { kind: "WorkflowStagePersistenceFailed" } };
      const old = latest.get(item.knowledgeId);
      if (!old || old.generation < item.generation) {
        latest.set(item.knowledgeId, /** @type {FailedQuizItem} */ (item));
      }
    }
    return { ok: true, value: [...latest.values()] };
  } catch {
    return { ok: false, error: { kind: "WorkflowStagePersistenceFailed" } };
  }
}
