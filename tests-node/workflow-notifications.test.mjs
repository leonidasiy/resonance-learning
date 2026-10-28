import {resolveModelApi} from '../worker/model-api.js';
import { WEBPAGE_IMAGE_POLICY } from '../worker/webpage-image-budget.js';
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { notifyKnowledgeWorkflowOutcome } from "../worker/knowledge-workflow-notifications.js";
import { isWorkflowRetryStage } from "../src/features/knowledge-workflows/workflow.js";
import { executeRetryingWorkflowStep, requiresWorkflowUpload } from "../worker/knowledge-workflow-step.js";

const at = "2026-10-02T12:00:00.000Z";
const run = {
  ownerId: "owner",
  runId: "run",
  sourceId: "source",
  sourceRevision: 1,
  canonicalSourceIdentity: "private",
  contentSignature: "private",
  state: "completed",
  revision: 2,
  idempotencyKey: "id",
  configDigests: {},
  extractionStartedAt: at,
  extractionDeadlineAt: at,
  decisionRequired: null,
  counts: {
    pages: 1,
    knowledgePoints: 1,
    acceptedQuizzes: 1,
    pendingQuizzes: 0,
  },
  failureKind: null,
  reused: false,
  createdAt: at,
  updatedAt: at,
};

test("completed retries with only pending-review quizzes do not announce readiness", async () => {
  const current = {
    ...run,
    counts: { ...run.counts, acceptedQuizzes: 1, pendingQuizzes: 1 },
  };
  const calls = [];
  const result = await notifyKnowledgeWorkflowOutcome({
    run: current,
    now: () => at,
    load: async () => ({ ok: true, value: current }),
    notify: async (command) => {
      calls.push(command);
      return { ok: true, value: { sent: 1 } };
    },
  });
  assert.deepEqual(result, { ok: true, value: { sent: 0 } });
  assert.deepEqual(calls, []);
});

test("completed retries with one published and one pending-review quiz announce readiness", async () => {
  const current = {
    ...run,
    counts: { ...run.counts, knowledgePoints: 2, acceptedQuizzes: 2, pendingQuizzes: 1 },
  };
  const calls = [];
  const result = await notifyKnowledgeWorkflowOutcome({
    run: current,
    now: () => at,
    load: async () => ({ ok: true, value: current }),
    notify: async (command, isCurrent) => {
      assert.deepEqual(await isCurrent(), { ok: true, value: true });
      calls.push(command.kind);
      return { ok: true, value: { sent: 1 } };
    },
  });
  assert.deepEqual(result, { ok: true, value: { sent: 1 } });
  assert.deepEqual(calls, ["source-ready"]);
});
test("workflow alerts select final readiness and actionable states, not chunks, scraping or user pauses", async () => {
  for (
    const state of [
      "source-added",
      "rights-assessment",
      "robots-check",
      "extraction-loop",
      "paused",
      "extraction-finalized",
      "per-point-quiz-loop",
      "abandoned",
      "completed",
      "awaiting-upload",
      "awaiting-rights-review",
      "retryable-failure",
      "awaiting-time-limit-decision",
    ]
  ) {
    const current = { ...run, state };
    const calls = [];
    const result = await notifyKnowledgeWorkflowOutcome({
      run: current,
      now: () => at,
      load: async () => ({ ok: true, value: current }),
      notify: async (command, isCurrent) => {
        assert.deepEqual(await isCurrent(), { ok: true, value: true });
        calls.push(command);
        return { ok: true, value: { sent: 1 } };
      },
    });
    assert.ok(result.ok);
    const expected = state === "completed" ? "source-ready" : [
        "awaiting-upload",
        "awaiting-rights-review",
        "retryable-failure",
        "awaiting-time-limit-decision",
      ].includes(state)
      ? "source-attention"
      : null;
    assert.equal(calls.length, expected ? 1 : 0, state);
    if (expected) assert.equal(calls[0].kind, expected);
  }
  const silent = async () => {
    throw new Error("UnexpectedAlert");
  };
  for (
    const current of [
      { ...run, counts: { ...run.counts, acceptedQuizzes: 0 } },
      {
        ...run,
        state: "awaiting-time-limit-decision",
        extractionDeadlineAt: "2026-10-02T13:00:00.000Z",
      },
    ]
  ) {
    assert.deepEqual(
      await notifyKnowledgeWorkflowOutcome({
        run: current,
        now: () => at,
        load: async () => ({ ok: true, value: current }),
        notify: silent,
      }),
      { ok: true, value: { sent: 0 } },
    );
  }
});
test("workflow alerts recheck authoritative ownership/revision and report invalid input and reads", async () => {
  for (
    const latest of [{ ...run, revision: 3 }, { ...run, ownerId: "other" }, {
      ...run,
      state: "abandoned",
    }]
  ) {
    await notifyKnowledgeWorkflowOutcome({
      run,
      now: () => at,
      load: async () => ({ ok: true, value: latest }),
      notify: async (command, current) => {
        assert.deepEqual(await current(), { ok: true, value: false });
        return { ok: true, value: { sent: 0 } };
      },
    });
  }
  for (
    const loaded of [{
      ok: false,
      error: { kind: "WorkflowRepositoryUnavailable" },
    }, { ok: true, value: {} }]
  ) {
    const r = await notifyKnowledgeWorkflowOutcome({
      run,
      now: () => at,
      load: async () => loaded,
      notify: async (command, current) => current(),
    });
    assert.equal(r.ok, false);
  }
  const base = {
    now: () => at,
    load: async () => ({ ok: true, value: run }),
    notify: async () => ({ ok: true, value: { sent: 0 } }),
  };
  assert.equal(
    (await notifyKnowledgeWorkflowOutcome({ ...base, run: null })).error.kind,
    "ReminderCommandInvalid",
  );
  assert.equal(
    (await notifyKnowledgeWorkflowOutcome({ ...base, run, now: () => "bad" }))
      .error.kind,
    "ReminderClockInvalid",
  );
  let calls = 0;
  const notify = async (command) => {
    calls++;
    assert.equal(command.kind, "source-attention");
    return { ok: true, value: { sent: 1 } };
  };
  await notifyKnowledgeWorkflowOutcome({
    ...base,
    run: { ...run, state: "extraction-loop" },
    notify,
  });
  await notifyKnowledgeWorkflowOutcome({ ...base, run:{...run,state:"retryable-failure"}, notify });
  assert.equal(calls, 1);
});

test("actual workflow entry sends before retention/waits and preserves extraction success on push failure", async () => {
  const source = await readFile(
    new URL("../worker/knowledge-workflow-executor.mjs", import.meta.url),
    "utf8",
  );
  for (
    const state of [
      "completed",
      "awaiting-upload",
      "awaiting-rights-review",
      "retryable-failure",
      "extraction-loop",
      "empty-exhausted",
      "cpu-exceeded",
      "stale-time-window",
      "stale-completed",
      "cached-quiz-cpu",
      "checkpoint-extraction",
      "checkpoint-backlog",
    ]
  ) {
    const replayedController = state === "stale-time-window" || state === "stale-completed" || state === "cached-quiz-cpu";
    let current = { ...run, state:replayedController?"per-point-quiz-loop":state==="empty-exhausted"?"robots-check":state==="cpu-exceeded"?"extraction-loop":state, revision:replayedController?59:run.revision, updatedAt: new Date().toISOString(), ...(replayedController?{counts:{pages:23,knowledgePoints:37,acceptedQuizzes:5,pendingQuizzes:0}}:state==="empty-exhausted"?{counts:{pages:0,knowledgePoints:0,acceptedQuizzes:0,pendingQuizzes:0}}:{}) };
    if(state==='checkpoint-extraction')current={...current,state:'awaiting-time-limit-decision',extractionDeadlineAt:new Date(Date.now()+60000).toISOString()};
    if(state==='checkpoint-backlog')current={...current,state:'extraction-loop'};
    let modelCalls = 0,restarts=0,executorCalls=0;
    const actions = [];
    const noOp = () => ({});
    const bindings = {
      resolveModelApi,
      WEBPAGE_IMAGE_POLICY,
      observeWorkflowDatabase:database=>database,
      WorkflowEntrypoint: class {},
      puppeteer: {},
      D1KnowledgeWorkflowRepository: class {},
      D1KnowledgeWorkflowMaterialRepository: class {},
      D1KnowledgeMediaRepository: class {},
      createKnowledgeWorkflowService: () => ({
        status: async () => ({ ok: true, value: current }),
        advance: async(command)=>{if(replayedController)assert.equal(command.expectedRevision,current.revision);current={...current,...command,state:command.nextState,revision:current.revision+1};return {ok:true,value:current};},
      }),
      isWorkflowRetryStage,
      createKnowledgeWorkflowLogger: () => noOp,
      createKnowledgeWorkflowBrowser: noOp,
      createFirecrawlWorkflowBrowser:noOp,
      createHybridBrowserBudget:noOp,
      requiresWorkflowUpload,
      createAcquisitionClient: () => ({mediaCapability:{}}),
      createAcquisitionWorkflowBrowser: noOp,
      ACQUISITION_POLICY: {},
      createMediaPublicEgress: noOp,
      createMediaPipeline: noOp,
      createOpenSourceImageSearch: noOp,
      createUserAttestedLocalManifest: () => ({ ok: true, value: [] }),
      fallbackMediaEntries: [],
      isCloudflareImageBinding: () => true,
      createCloudflareImageDerivative: noOp,
      createCloudflareImageDecoder: noOp,
      KNOWLEDGE_WORKFLOW_CONFIG_SOURCES: Object.fromEntries(
        [
          "rights-assessor",
          "knowledge-scraper",
          "question-generator",
          "question-evaluator",
        ].map((role) => [role, "config"]),
      ),
      createAgentConfigurationLoader: () => ({
        load: async () => ({ ok: true, value: {} }),
      }),
      createKnowledgeWorkflowRuntime: () => ({
        purgeExpired: async () => ({ ok: true, value: null }),
        execute: async authoritative => {
          assert.equal(state === "stale-time-window" || state === "stale-completed", true);
          assert.equal(authoritative.state, "per-point-quiz-loop");
          assert.equal(authoritative.revision, 59);
          modelCalls++;
          current = {...current,state:"completed",revision:60,counts:{...current.counts,acceptedQuizzes:6}};
          return {ok:true,value:{state:"completed",run:current}};
        },
      }),
      executeRetryingWorkflowStep: async dependencies => {
        executorCalls++;
        if(state==='checkpoint-backlog'){assert.equal(executorCalls,1,"A completed quiz checkpoint must release the invocation before further extraction");return {ok:true,value:{state:current.state,run:current}};}
        if(replayedController)return executeRetryingWorkflowStep(dependencies);
        if (state === "cpu-exceeded") throw new Error("Worker exceeded CPU time limit.");
        if(state==="empty-exhausted")return {ok:false,error:{kind:"WorkflowRobotsFailed",detailKind:"KnowledgeBrowserNavigationFailed"}};
        if (state === "extraction-loop") {
          throw new Error("ProviderRetriesExhausted");
        }
        return {
          ok: true,
          value: {
            state:state==='checkpoint-extraction'?current.state:state,
            run: current,
            restrictedUntil: "2026-11-02T00:00:00.000Z",
            restrictedKnowledgeIds: ["k"],
          },
        };
      },
      createReminderRuntime: () => ({
        notifySource: async (command, isCurrent) => {
          assert.deepEqual(await isCurrent(), { ok: true, value: true });
          actions.push(command.kind);
          return { ok: false, error: { kind: "ReminderDeliveryFailed" } };
        },
      }),
      notifyKnowledgeWorkflowOutcome,
    };
    current.configDigests = Object.fromEntries(
      Object.keys(bindings.KNOWLEDGE_WORKFLOW_CONFIG_SOURCES).map(
        (role) => [role, "digest"],
      ),
    );
    const Entry = new Function(
      ...Object.keys(bindings),
      source.replace(/^import .*;\n/gm, "").replace(
        "export async function executeKnowledgeWorkflow",
        "async function executeKnowledgeWorkflow",
      ) + "\nreturn executeKnowledgeWorkflow;",
    )(...Object.values(bindings));
    const entry = {run(event,step){return Entry(this.env,event,step,bindings.KNOWLEDGE_WORKFLOW_CONFIG_SOURCES);}};
    entry.env = {
      SOURCE_LIBRARY_DB: { prepare: noOp, batch: noOp },
      SOURCE_CONTENT_BUCKET: { put: noOp, get: noOp, delete: noOp },
      KNOWLEDGE_WORKFLOW:{get:async()=>({restart:async()=>{restarts++;actions.push("restart");}})},
      SOURCE_BROWSER: {},
      IMAGES: {},
    };
    const step = {
      do: async (name, configOrCallback, callback) => {
        if(replayedController && restarts===0 && (name === "load knowledge workflow run" || name === "execute knowledge extraction and quiz stages: attempt 1")) {
          const oldRun = {...current,state:state === "stale-completed"?"completed":"awaiting-time-limit-decision",revision:45,extractionDeadlineAt:at};
          return {ok:true,value:name === "load knowledge workflow run"?oldRun:{state:oldRun.state,run:oldRun}};
        }
        if(replayedController && restarts>0 && /: attempt [1-4]$/.test(name)) {
          if(state === "cached-quiz-cpu")throw new Error("Worker exceeded CPU time limit.");
        }
        return (callback ?? configOrCallback)();
      },
      waitForEvent: async () => {
        actions.push("wait");
        throw new Error("TestWaitTimeout");
      },
      sleepUntil: async () => {
        actions.push("retention");
      },
    };
    const execute=async()=>{
      let result=await entry.run({instanceId:'instance',payload:{ownerId:'owner',runId:'run'}},step);
      if(result.continuation===true){restarts++;actions.push('checkpoint');result=await entry.run({instanceId:'instance',payload:{ownerId:'owner',runId:'run'}},step);}
      return result;
    };
    if(state==='checkpoint-backlog'){
      const result=await entry.run({instanceId:'instance',payload:{ownerId:'owner',runId:'run'}},step);
      assert.equal(result.state,'extraction-loop');assert.equal(result.continuation,true);assert.equal(executorCalls,1);assert.equal(restarts,0);assert.deepEqual(actions,[]);
    }else if(state==='checkpoint-extraction'){
      const result=await entry.run({instanceId:'instance',payload:{ownerId:'owner',runId:'run'}},step);
      assert.equal(result.state,'extraction-loop');assert.equal(current.revision,3);assert.equal(result.continuation,true);assert.equal(restarts,0);assert.equal(modelCalls,0);assert.deepEqual(actions,[]);
    }else if(state==="stale-time-window" || state==="stale-completed") {
      assert.equal((await execute()).state,"completed");
      assert.equal(modelCalls,1);
      assert.equal(current.counts.acceptedQuizzes,6);
      assert.deepEqual(actions,["checkpoint","source-ready"]);
    }else if(state==="cached-quiz-cpu") {
      await assert.rejects(execute(),/WorkflowControlTimeout/);
      assert.equal(modelCalls,0);
      assert.equal(current.state,"retryable-failure");
      assert.equal(current.revision,60);
      assert.equal(current.failureKind,"WorkflowCpuTimeLimitExceeded");
      assert.equal(current.counts.knowledgePoints,37);
      assert.equal(current.counts.acceptedQuizzes,5);
      assert.deepEqual(actions,["checkpoint","retention","retention","retention","source-attention","wait"]);
    }else if(state==="empty-exhausted"){
      await assert.rejects(entry.run({payload:{ownerId:"owner",runId:"run"}},step), /WorkflowControlTimeout/);
      assert.equal(current.state,"retryable-failure");
      assert.deepEqual(actions,["source-attention","wait"]);
      assert.equal(current.failureKind,"KnowledgeBrowserNavigationFailed");
    }else if (state === "completed") {
      assert.equal(
        (await entry.run({ payload: { ownerId: "owner", runId: "run" } }, step))
          .state,
        "completed",
      );
      assert.deepEqual(actions, ["source-ready", "retention"]);
    } else {
      await assert.rejects(
        entry.run({ payload: { ownerId: "owner", runId: "run" } }, step),
        /Workflow(Material|RightsApproval|Control)Timeout/,
      );
      assert.equal(actions[0], "source-attention", state);
      if (state === "cpu-exceeded") assert.equal(current.failureKind, "WorkflowCpuTimeLimitExceeded");
    }
  }
});

test("failed empty sources still notify after automatic Library removal",async()=>{
 const current={...run,state:"abandoned",counts:{pages:0,knowledgePoints:0,acceptedQuizzes:0,pendingQuizzes:0},failureKind:"WorkflowExtractionFailed:KnowledgeBrowserNavigationFailed"};const calls=[];
 const result=await notifyKnowledgeWorkflowOutcome({run:current,now:()=>at,load:async()=>({ok:true,value:current}),notify:async command=>{calls.push(command.kind);return {ok:true,value:{sent:1}};}});assert.deepEqual(result,{ok:true,value:{sent:1}});assert.deepEqual(calls,["source-attention"]);
});

test('completed partial sources notify for approval even when every quiz is deferred',async()=>{
 for(const failureKind of ['WorkflowPagesFailed','WorkflowQuizItemsFailed']){
  const current={...run,failureKind,counts:{...run.counts,acceptedQuizzes:0}},calls=[];
  const result=await notifyKnowledgeWorkflowOutcome({run:current,now:()=>at,load:async()=>({ok:true,value:current}),notify:async(command,isCurrent)=>{assert.deepEqual(await isCurrent(),{ok:true,value:true});calls.push(command.kind);return {ok:true,value:{sent:1}};}});
  assert.deepEqual(result,{ok:true,value:{sent:1}});assert.deepEqual(calls,['source-attention']);
 }
});
