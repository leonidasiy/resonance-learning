import {observeWorkflowDatabase} from './knowledge-workflow-database.js';
// @ts-check
import {createKnowledgeWorkflowService, isWorkflowRetryStage} from '../src/features/knowledge-workflows/workflow.js';
import {D1KnowledgeWorkflowRepository} from './knowledge-workflow-d1.js';
import {deliverKnowledgeWorkflowControl, workflowInstanceId, workflowControlRollback} from './main.js';
import {workflowPersistenceDiagnostic} from './knowledge-workflow-logging.js';
import {workflowExecutionFailure} from './knowledge-workflow-step.js';

/** Resume only interrupted work; explicit pauses, consent decisions and terminal runs stay authoritative.
 * @param {{database:import('./knowledge-workflow-d1.js').D1DatabasePort,binding:import('./main.js').KnowledgeWorkflowBinding,ownerId:string,now:()=>string,logger:(entry:import('./knowledge-workflow-logging.js').KnowledgeWorkflowLogEntry)=>void}} dependencies
 * @returns {Promise<{ok:true,value:number}|{ok:false,error:{kind:string}}>}
 */
export async function resumeInterruptedKnowledgeWorkflows({database,binding,ownerId,now,logger}) {
  database=observeWorkflowDatabase(database,logger);
  const service=createKnowledgeWorkflowService(new D1KnowledgeWorkflowRepository({database,logger}),{now,createId:()=>crypto.randomUUID(),logger});
  let resumed=0,failed=0;
  try {
    const selected=await database.prepare("SELECT r.run_id FROM knowledge_workflow_runs r JOIN library_sources s ON s.owner_id=r.owner_id AND s.source_id=r.source_id AND s.revision=r.source_revision AND s.state='active' WHERE r.owner_id=? AND r.state IN ('rights-assessment','robots-check','extraction-loop','extraction-finalized','per-point-quiz-loop','retryable-failure','awaiting-time-limit-decision') AND r.run_id=(SELECT latest.run_id FROM knowledge_workflow_runs latest WHERE latest.owner_id=r.owner_id AND latest.source_id=r.source_id AND latest.source_revision=r.source_revision ORDER BY latest.created_at DESC,latest.run_id DESC LIMIT 1) AND NOT EXISTS (SELECT 1 FROM knowledge_workflow_run_tombstones t WHERE t.owner_id=r.owner_id AND t.run_id=r.run_id) ORDER BY r.updated_at,r.run_id").bind(ownerId).all();
    if(!selected.success)return {ok:false,error:{kind:'WorkflowAutoResumeQueryFailed'}};
    for(const row of selected.results) {
      let operation='load-run';
      try {
        if(!row||typeof row!=='object'||!('run_id' in row)||typeof row.run_id!=='string')throw new Error('WorkflowAutoResumeRowInvalid');
        const loaded=await service.status({ownerId,runId:row.run_id});
        if(!loaded.ok)throw new Error(loaded.error.kind);
        const run=loaded.value;
        const currentTime=Date.parse(now());
        if(!Number.isFinite(currentTime))throw new TypeError('Workflow auto-resume clock is invalid.');
        if(!(isWorkflowRetryStage(run.state)||run.state==='retryable-failure'||run.state==='awaiting-time-limit-decision'))continue;
        operation='instance-status';
        const instance=await binding.get(workflowInstanceId(run.runId));
        if(typeof instance.status!=='function')throw new TypeError('Workflow instance status is unavailable.');
        const snapshot=await instance.status(),status=snapshot.status;
        if(isWorkflowRetryStage(run.state)) {
          const output=snapshot.output;
          if(status==='complete'&&output&&typeof output==='object'&&!Array.isArray(output)&&'continuation' in output&&output.continuation===true&&'runId' in output&&output.runId===run.runId&&'revision' in output&&(output.revision===run.revision||(output.revision===run.revision-1&&currentTime-Date.parse(run.updatedAt)>=120_000))&&'state' in output&&output.state===run.state) {
            operation='claim-checkpoint';
            const claimed=await service.advance({ownerId,runId:run.runId,expectedRevision:run.revision,nextState:run.state,counts:run.counts});
            if(!claimed.ok){if(claimed.error.kind==='WorkflowControlStale')continue;throw new Error(claimed.error.kind);}
            operation='dispatch-checkpoint';
            try {if(typeof instance.restart!=='function')throw new Error('WorkflowInstanceControlFailed');await instance.restart();}
            catch(error){const restored=await service.advance({ownerId,runId:run.runId,expectedRevision:claimed.value.revision,nextState:'retryable-failure',failureKind:'WorkflowInstanceControlFailed'});if(!restored.ok&&restored.error.kind!=='WorkflowControlStale')throw new Error(restored.error.kind);throw error;}
            resumed++;logger({event:'knowledge-workflow-auto-continue-success',ownerId,runId:run.runId,count:resumed});
            continue;
          }
          if(status!=='errored')continue;
          // Persist discovery time: an old checkpoint is not the time the crash happened.
          operation='mark-interruption';
          const cause=workflowExecutionFailure(new Error(typeof snapshot.error?.message==='string'?snapshot.error.message:''));
          const failureKind=`${cause.kind}${cause.detailDiagnosticToken===undefined?'':`:${cause.detailDiagnosticToken}`}`;
          const marked=await service.advance({ownerId,runId:run.runId,expectedRevision:run.revision,nextState:'retryable-failure',failureKind});
          if(!marked.ok&&marked.error.kind!=='WorkflowControlStale')throw new Error(marked.error.kind);
          continue;
        }
        const failure=run.failureKind??'';
        if(/KnowledgeModelPaymentRequired|Credential|WorkflowStageCallUncertain|:http-(401|402|403)|sqlite-(constraint|schema|too-big|limit)|automatic-retries-exhausted/u.test(failure))continue;
        if(failure.includes('d1-daily-quota')&&now().slice(0,10)===run.updatedAt.slice(0,10))continue;
        if(currentTime-Date.parse(run.updatedAt)<120_000)continue;
        if(run.state==='awaiting-time-limit-decision'&&(run.extractionDeadlineAt===null||currentTime<Date.parse(run.extractionDeadlineAt)+120_000))continue;
        // A pending waitForEvent can still report running; the persisted stopped state authorizes its resume event.
        if(!['running','waiting','errored','complete'].includes(status))continue;
        if(run.state==='retryable-failure'){
          operation='check-recovery-progress';
          const controls=await database.prepare('SELECT idempotency_key,result_json FROM knowledge_workflow_controls WHERE owner_id=? AND run_id=? ORDER BY occurred_at DESC,control_id DESC LIMIT 4').bind(ownerId,run.runId).all();
          if(!controls.success)throw new Error('WorkflowAutoResumeQueryFailed');
          const stalled=controls.results.length===4&&controls.results.every(row=>{
            if(!row||typeof row!=='object'||!('idempotency_key'in row)||typeof row.idempotency_key!=='string'||!row.idempotency_key.startsWith('auto-resume:')||!('result_json'in row)||typeof row.result_json!=='string')return false;
            const prior=JSON.parse(row.result_json);
            return prior.counts&&['pages','knowledgePoints','acceptedQuizzes','pendingQuizzes'].every(key=>prior.counts[key]===run.counts[/** @type {keyof typeof run.counts} */(key)]);
          });
          if(stalled){
            const stopped=await service.advance({ownerId,runId:run.runId,expectedRevision:run.revision,nextState:'retryable-failure',counts:run.counts,failureKind:`${failure}:automatic-retries-exhausted`});
            if(!stopped.ok&&stopped.error.kind!=='WorkflowControlStale')throw new Error(stopped.error.kind);
            logger({event:'knowledge-workflow-auto-resume-exhausted',ownerId,runId:run.runId,failureKind:'WorkflowAutomaticRetriesExhausted',count:4});
            continue;
          }
        }
        const command={ownerId,runId:run.runId,expectedRevision:run.revision,action:'resume',idempotencyKey:`auto-resume:${crypto.randomUUID()}`};
        operation='resume-control';
        const controlled=await service.control(command);
        if(!controlled.ok) {
          if(['WorkflowControlStale','WorkflowControlInvalid'].includes(controlled.error.kind))continue;
          throw new Error(controlled.error.kind);
        }
        operation='dispatch-resume';
        try {await deliverKnowledgeWorkflowControl(instance,'resume',status==='complete');}
        catch(error) {
          const rollback=workflowControlRollback(command,loaded,controlled)??{ownerId,runId:run.runId,expectedRevision:controlled.value.revision,nextState:/** @type {const} */('retryable-failure'),failureKind:'WorkflowInstanceControlFailed'};
          operation='rollback-resume';
          const restored=await service.advance(rollback);
          if(!restored.ok)throw new Error(restored.error.kind);
          throw error;
        }
        resumed++;
        logger({event:'knowledge-workflow-auto-resume-success',ownerId,runId:run.runId,count:resumed});
      }catch(error) {
        failed++;
        logger({event:'knowledge-workflow-auto-resume-run-failure',ownerId,field:operation,...(row&&typeof row==='object'&&'run_id' in row&&typeof row.run_id==='string'?{runId:row.run_id}:{}),failureKind:error instanceof Error&&/^Workflow[A-Za-z0-9]+$/.test(error.message)?error.message:'WorkflowAutoResumeFailed',diagnosticToken:workflowPersistenceDiagnostic(error)});
      }
    }
    if(failed)return {ok:false,error:{kind:'WorkflowAutoResumeFailed'}};
    return {ok:true,value:resumed};
  }catch(error) {
    if(!(error instanceof Error))throw error;
    logger({event:'knowledge-workflow-auto-resume-failure',failureKind:'WorkflowAutoResumeFailed',diagnosticToken:workflowPersistenceDiagnostic(error)});
    return {ok:false,error:{kind:'WorkflowAutoResumeFailed'}};
  }
}
