// @ts-check

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
      if(!(error instanceof Error)||error.message!=="Worker exceeded CPU time limit."||attempt===3)throw error;
      cpuLimited=true;
    }
    if(result&&(result.ok||!isTransientBrowserFailure(result.error)||attempt===3))return result;
    await dependencies.step.sleepUntil(`${dependencies.name}: backoff ${attempt+1}`,new Date(dependencies.now()+[5000,15000,30000][attempt]));
  }
}
