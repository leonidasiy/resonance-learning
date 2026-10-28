// @ts-check

import { executeAuthoritativeWorkflowStep, executeRetryingWorkflowStep, requiresWorkflowUpload } from "../worker/knowledge-workflow-step.js";

/** @template T @param {T} actual @param {T} expected */
function assertEquals(actual, expected) { if (!Object.is(actual, expected)) throw new Error(`Expected ${String(expected)}, received ${String(actual)}.`); }

Deno.test("authoritative Workflow step reloads D1 on a replay before executing persistence work", async () => {
  /** @type {{ readonly state: "per-point-quiz-loop" | "completed" }} */
  let authoritative = { state: "per-point-quiz-loop" };
  /** @type {string[]} */
  const loadedStates = [];
  let persistenceCalls = 0;
  const result = await executeAuthoritativeWorkflowStep({
    step: {
      do: async (_name, _config, callback) => {
        assertEquals(_config.timeout, "30 minutes");
        assertEquals(_config.retries.limit, 0);
        assertEquals(_config.retries.delay, 0);
        await callback();
        authoritative = { state: "completed" };
        return callback();
      },
    },
    name: "execute knowledge extraction and quiz stages",
    load: async () => ({ ok: true, value: authoritative }),
    execute: async (run) => {
      loadedStates.push(run.state);
      if (run.state === "completed") return { ok: true, value: { state: "completed" } };
      persistenceCalls += 1;
      return { ok: false, error: { kind: "TransientStepReplay" } };
    },
  });
  assertEquals(result.ok, true);
  assertEquals(loadedStates.join(","), "per-point-quiz-loop,completed");
  assertEquals(persistenceCalls, 1);
});

Deno.test("authoritative Workflow step preserves a typed load failure", async () => {
  const result = await executeAuthoritativeWorkflowStep({
    step: { do: async (_name, _config, callback) => callback() },
    name: "reload authoritative run",
    load: async () => ({ ok: false, error: { kind: "WorkflowRunMissing" } }),
    execute: async () => ({ ok: true, value: null }),
  });
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error.kind, "WorkflowRunMissing");
});

Deno.test("browser retries reload state, back off, and stop after four attempts", async () => {
  for(const succeedsAt of [2,4,5]) {
    let calls=0, loads=0;const delays=/** @type {number[]} */([]);
    const result=await executeRetryingWorkflowStep({step:{do:async(_name,_config,callback)=>callback(),sleepUntil:async(_name,date)=>{delays.push(date.getTime());}},name:"browser",now:()=>1000,load:async()=>({ok:true,value:++loads}),execute:async()=>++calls===succeedsAt?{ok:true,value:null}:{ok:false,error:{kind:"WorkflowRobotsFailed",detailKind:"KnowledgeBrowserNavigationFailed"}}});
    assertEquals(calls,Math.min(succeedsAt,4));assertEquals(loads,calls);assertEquals(result.ok,succeedsAt<=4);assertEquals(delays.join(","),succeedsAt===2?"6000":"6000,16000,31000");
  }
});
Deno.test("browser retries never repeat permission denials or successful work", async () => {
  for(const error of ["RobotsDenied","KnowledgePageBotAccessDenied","WorkflowRightsNotAllowed"]) {
    let calls=0;
    const result=await executeRetryingWorkflowStep({step:{do:async(_name,_config,callback)=>callback(),sleepUntil:async()=>{throw new Error("Unexpected retry");}},name:"blocked",now:()=>0,load:async()=>({ok:true,value:null}),execute:async()=>{calls++;return {ok:false,error:{kind:error}};}});
    assertEquals(calls,1);assertEquals(result.ok,false);
  }
});

Deno.test("authoritative step sends a complete platform retry configuration before loading the run", async () => {
  let loads=0;
  const result=await executeAuthoritativeWorkflowStep({
    step:{do:async(_name,config,callback)=>{
      // The platform schema requires delay even when limit is zero and rejects
      // an incomplete retry object before registering or executing a step.
      if(typeof config.retries.delay!=="number" || config.retries.delay<0)throw new Error("WorkflowFatalError: Step config is invalid");
      assertEquals(config.retries.limit,0);assertEquals(config.timeout,"30 minutes");return callback();
    }},name:"paid outer execution",load:async()=>{loads++;return {ok:true,value:null};},execute:async()=>({ok:true,value:null}),
  });
  assertEquals(result.ok,true);assertEquals(loads,1);
});

Deno.test("CPU interruptions retry three times from the durable state and remain bounded", async () => {
  for(const succeedsAt of [4,5]) {
    let calls=0,loads=0,failed=false;
    try {
      const result=await executeRetryingWorkflowStep({step:{do:async(_name,_config,callback)=>callback(),sleepUntil:async()=>{}},name:"cpu",now:()=>0,load:async()=>({ok:true,value:++loads}),execute:async()=>{if(++calls<succeedsAt)throw new Error("Worker exceeded CPU time limit.");return {ok:true,value:null};}});
      assertEquals(result.ok,true);
    }catch(error){if(!(error instanceof Error)||error.message!=="Worker exceeded CPU time limit.")throw error;failed=true;}
    assertEquals(calls,4);assertEquals(loads,4);assertEquals(failed,succeedsAt===5);
  }
});

Deno.test("internal and provider failures never force Upload while actual source denials still do",()=>{
  for(const kind of ['FirecrawlBrowserResponseInvalid','FirecrawlBrowserOutputTruncated','FirecrawlBrowserCredentialUnavailable','KnowledgeBrowserNavigationFailed','KnowledgeBrowserTimedOut','WorkflowProgressPersistenceFailed','WorkflowStageCallUncertain','WorkflowStagePersistenceFailed','KnowledgeModelCredentialMissing','RobotsFetchUnavailable','KnowledgePageRateLimited'])assertEquals(requiresWorkflowUpload({kind:'WorkflowRobotsFailed',detailKind:kind}),false);
  for(const kind of ['RobotsDenied','KnowledgePageAuthenticationRequired','KnowledgePagePaywallDetected','KnowledgePageBotAccessDenied','KnowledgePageTypeUnsupported','KnowledgePageContentTypeUnsupported','WorkflowRightsNotAllowed','WorkflowUploadRequired'])assertEquals(requiresWorkflowUpload({kind:'WorkflowExtractionFailed',detailKind:kind}),true);
});

Deno.test("CPU retries pass distinct bounded execution numbers without changing the run",async()=>{
 const attempts=/** @type {number[]} */([]);
 const result=await executeRetryingWorkflowStep({step:{do:async(_name,_config,callback)=>callback(),sleepUntil:async()=>{}},name:"cpu-admission",now:()=>0,load:async()=>({ok:true,value:{revision:18}}),execute:async(run,attempt)=>{
  assertEquals(run.revision,18);attempts.push(attempt??0);
  if(attempts.length<4)throw new Error("Worker exceeded CPU time limit.");
  return {ok:true,value:null};
 }});
 assertEquals(result.ok,true);assertEquals(attempts.join(","),"1,2,3,4");
});

Deno.test("only an observed CPU failure enables reduced work on subsequent attempts",async()=>{
 for(const cpu of [true,false]){
  /** @type {boolean[]} */ const flags=[];
  const result=await executeRetryingWorkflowStep({step:{do:async(_name,_config,callback)=>callback(),sleepUntil:async()=>{}},name:"cpu-pressure",now:()=>0,load:async()=>({ok:true,value:null}),execute:async(_run,_attempt,limited)=>{
   flags.push(limited===true);
   if(flags.length===1){if(cpu)throw new Error("Worker exceeded CPU time limit.");return {ok:false,error:{kind:"KnowledgeBrowserTimedOut"}};}
   return {ok:true,value:null};
  }});
  assertEquals(result.ok,true);assertEquals(flags.join(","),cpu?"false,true":"false,false");
 }
});

Deno.test("transient database and subrequest interruptions recover from fresh checkpoints",async()=>{
 for(const message of ['Too many subrequests.','D1 DB is overloaded','SQLITE_BUSY','Network connection lost','storage caused object to be reset']){
  let loads=0,calls=0;const flags=/** @type {boolean[]} */([]);
  const result=await executeRetryingWorkflowStep({step:{do:async(_n,_c,cb)=>cb(),sleepUntil:async()=>{}},name:'interruption',now:()=>0,load:async()=>({ok:true,value:++loads}),execute:async(run,_attempt,limited)=>{
   assertEquals(run,++calls);flags.push(limited===true);if(calls===1)throw new Error('Wrapped failure',{cause:new Error(message)});return {ok:true,value:null};
  }});
  assertEquals(result.ok,true);assertEquals(calls,2);assertEquals(flags.join(','),message==='Too many subrequests.'?'false,true':'false,false');
 }
});

Deno.test("typed transient persistence failures retry but permanent and uncertain failures do not",async()=>{
 for(const diagnostic of ['d1-reset','sqlite-busy','d1-overloaded','subrequest-limit','d1-daily-quota','sqlite-constraint','sqlite-schema']){
  let calls=0;
  const result=await executeRetryingWorkflowStep({step:{do:async(_n,_c,cb)=>cb(),sleepUntil:async()=>{}},name:'database',now:()=>0,load:async()=>({ok:true,value:null}),execute:async()=>{calls++;return {ok:false,error:{kind:'WorkflowProgressPersistenceFailed',detailDiagnosticToken:diagnostic}};}});
  assertEquals(result.ok,false);assertEquals(calls,['d1-reset','sqlite-busy','d1-overloaded','subrequest-limit'].includes(diagnostic)?4:1);
 }
 for(const kind of ['WorkflowStageCallUncertain','KnowledgeModelPaymentRequired','KnowledgeModelCredentialMissing','KnowledgeReviewOutputInvalid']){
  let calls=0;
  await executeRetryingWorkflowStep({step:{do:async(_n,_c,cb)=>cb(),sleepUntil:async()=>{throw new Error('Unexpected retry');}},name:'protected',now:()=>0,load:async()=>({ok:true,value:null}),execute:async()=>{calls++;return {ok:false,error:{kind,detailDiagnosticToken:'d1-reset'}};}});
  assertEquals(calls,1);
 }
});
