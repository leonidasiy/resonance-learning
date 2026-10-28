// @ts-check
import {workflowPersistenceDiagnostic} from './knowledge-workflow-logging.js';

/** @template T, E @typedef {{ readonly ok: true, readonly value: T } | { readonly ok: false, readonly error: E }} Result */

/**
 * Run a Workflow step from the authoritative D1 snapshot. Workflow retries
 * replay the callback, so a closure-captured run is unsafe for persistence
 * work. Reloading inside the callback makes a completed replay a typed no-op.
 *
 * @template Run, Value, LoadError, ExecuteError
 * @param {{
 *   readonly step: { readonly do: <T>(name: string, config: {timeout: string, retries: {limit: number, delay:number}}, callback: () => Promise<T>) => Promise<T> },
 *   readonly name: string,
 *   readonly load: () => Promise<Result<Run, LoadError>>,
 *   readonly execute: (run: Run, executionAttempt?: number, cpuLimited?: boolean) => Promise<Result<Value, ExecuteError>>,
 * }} dependencies
 * @returns {Promise<Result<Value, LoadError | ExecuteError>>}
 */
export async function executeAuthoritativeWorkflowStep(dependencies) {
  if (typeof dependencies?.step?.do !== "function" || typeof dependencies.name !== "string" || dependencies.name.trim() === "" || typeof dependencies.load !== "function" || typeof dependencies.execute !== "function") throw new TypeError("Authoritative Workflow step dependencies are invalid.");
  return dependencies.step.do(dependencies.name, {timeout: "30 minutes", retries: {limit: 0, delay: 0}}, async () => {
    const loaded = await dependencies.load();
    if (!loaded.ok) return loaded;
    return dependencies.execute(loaded.value);
  });
}

/** @param {unknown} error */
export function isTransientBrowserFailure(error) {
  if (!error || typeof error !== "object") return false;
  const value=/** @type {{kind?:string,detailKind?:string}} */(error);
  return /^(KnowledgeBrowser(NavigationFailed|TimedOut|LoadTimedOut|CaptureTimedOut|CaptureInterrupted|PageClosed)|KnowledgePageFetchFailed|FirecrawlBrowser(ApiFailed|TimedOut|OperationFailed))(?::|$)/u.test(value.detailKind??value.kind??"");
}

/** Preserve safe platform categories without exposing exception text.
 * @param {unknown} error */
export function workflowExecutionFailure(error) {
  const diagnostic=workflowPersistenceDiagnostic(error);
  return {kind:diagnostic==='cpu-limit'?'WorkflowCpuTimeLimitExceeded':diagnostic==='subrequest-limit'?'WorkflowSubrequestLimitExceeded':'WorkflowExecutionStopped',...(['database-error','cpu-limit','subrequest-limit'].includes(diagnostic)?{}:{detailDiagnosticToken:diagnostic})};
}

/** @param {unknown} error */
function retryDiagnostic(error) {
  if(!error||typeof error!=='object')return '';
  const value=/** @type {{kind?:string,detailKind?:string,detailDiagnosticToken?:string,diagnosticToken?:string}} */(error);
  const kind=value.detailKind??value.kind??'';
  // Model retries have their own durable attempt and billing protections.
  if(!/PersistenceFailed$|^Workflow(CpuTimeLimitExceeded|SubrequestLimitExceeded|ExecutionStopped)$/u.test(kind))return '';
  return value.detailDiagnosticToken??value.diagnosticToken??(kind==='WorkflowCpuTimeLimitExceeded'?'cpu-limit':kind==='WorkflowSubrequestLimitExceeded'?'subrequest-limit':'');
}

/** Only observed source access/format restrictions require learner-supplied material.
 * @param {{kind?:string,detailKind?:string}} error */
export function requiresWorkflowUpload(error) {
  return /^(WorkflowUploadRequired|WorkflowRightsNotAllowed|RobotsDenied|KnowledgePage(AuthenticationRequired|PaywallDetected|BotAccessDenied|TypeUnsupported|ContentTypeUnsupported))(?::|$)/u.test(error.detailKind??error.kind??'');
}

/** @template Run, Value, LoadError, ExecuteError
 * @param {Parameters<typeof executeAuthoritativeWorkflowStep<Run,Value,LoadError,ExecuteError>>[0] & {step: {sleepUntil:(name:string,date:Date)=>Promise<unknown>},now:()=>number}} dependencies */
export async function executeRetryingWorkflowStep(dependencies) {
  let cpuLimited=false;
  for (let attempt=0;;attempt++) {
    let result;
    try { result=await executeAuthoritativeWorkflowStep({...dependencies,execute:run=>dependencies.execute(run,attempt+1,cpuLimited),name:`${dependencies.name}: attempt ${attempt+1}`}); }
    catch(error) {
      const diagnostic=workflowPersistenceDiagnostic(error);
      if(!['cpu-limit','subrequest-limit','sqlite-busy','d1-overloaded','d1-reset','d1-network'].includes(diagnostic)||attempt===3)throw error;
      if(['cpu-limit','subrequest-limit'].includes(diagnostic))cpuLimited=true;
    }
    if(result){
      if(result.ok)return result;
      const diagnostic=retryDiagnostic(result.error);
      if(attempt===3||(!isTransientBrowserFailure(result.error)&&!['cpu-limit','subrequest-limit','sqlite-busy','d1-overloaded','d1-reset','d1-network'].includes(diagnostic)))return result;
      if(['cpu-limit','subrequest-limit'].includes(diagnostic))cpuLimited=true;
    }
    await dependencies.step.sleepUntil(`${dependencies.name}: backoff ${attempt+1}`,new Date(dependencies.now()+[5000,15000,30000][attempt]));
  }
}
