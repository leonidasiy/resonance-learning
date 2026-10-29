import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {readFile,readdir} from 'node:fs/promises';
import {resumeInterruptedKnowledgeWorkflows} from '../worker/knowledge-workflow-auto-resume.js';
import {D1KnowledgeWorkflowRepository} from '../worker/knowledge-workflow-d1.js';
import {createKnowledgeWorkflowService} from '../src/features/knowledge-workflows/workflow.js';
import {D1WorkflowStageRepository} from '../worker/knowledge-workflow-stages-d1.js';
import {readWorkflowCpuWidth,recordWorkflowCpuFailure} from '../worker/knowledge-workflow-cpu.js';

async function fixture(phase='per-point-quiz-loop') {
  const db=new DatabaseSync(':memory:');
  const migrations=new URL('../worker/migrations/',import.meta.url);
  for(const name of (await readdir(migrations)).filter(n=>n.endsWith('.sql')).sort())db.exec(await readFile(new URL(name,migrations),'utf8'));
  const database={prepare(sql){let values=[];return {bind(...v){values=v;return this;},async first(){return db.prepare(sql).get(...values)??null;},async all(){return {success:true,results:db.prepare(sql).all(...values)};},async run(){return {success:true,meta:{changes:Number(db.prepare(sql).run(...values).changes)}};}};},async batch(statements){return Promise.all(statements.map(s=>s.run()));}};
  let time=Date.parse('2026-10-16T12:00:00.000Z'),status='errored',events=0,restarts=0,dispatchFails=false,output,error;
  const now=()=>new Date(time).toISOString(),logger=()=>{};
  const service=createKnowledgeWorkflowService(new D1KnowledgeWorkflowRepository({database,logger}),{now,logger,createId:()=> 'run-auto'});
  const unwrap=r=>{assert.equal(r.ok,true,JSON.stringify(r.error));return r.value;};
  let run=unwrap(await service.createRun({ownerId:'owner-a',sourceId:'source-a',sourceRevision:1,canonicalSourceIdentity:'https://example.test/',contentSignature:'source',configDigests:{},idempotencyKey:'create-auto'})).run;
  for(const state of ['rights-assessment','robots-check','extraction-loop',...(phase==='per-point-quiz-loop'?['extraction-finalized','per-point-quiz-loop']:[])])run=unwrap(await service.advance({ownerId:run.ownerId,runId:run.runId,expectedRevision:run.revision,nextState:state,counts:{pages:11,knowledgePoints:31,acceptedQuizzes:1,pendingQuizzes:0}}));
  db.prepare("INSERT INTO library_sources VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run('owner-a','source-a','https://example.test/','https://example.test/','Fixture','','{}','[]','active',now(),now(),1);
  const instance={id:'instance',status:async()=>({status,output,error}),restart:async()=>{if(dispatchFails)throw new Error('Test dispatch unavailable');restarts++;status='running';},resume:async()=>{},sendEvent:async()=>{if(dispatchFails)throw new Error('Test dispatch unavailable');events++;status='running';},pause:async()=>{},terminate:async()=>{}};
  const dependencies={database,binding:{create:async()=>instance,get:async()=>instance},ownerId:'owner-a',now,logger};
  return {db,service,dependencies,run,unwrap,advanceTime:ms=>{time+=ms;},setStatus:s=>{status=s;},setOutput:v=>{output=v;},setError:v=>{error=v;},failDispatch:()=>{dispatchFails=true;},counts:()=>({events,restarts}),read:async()=>unwrap(await service.status({ownerId:'owner-a',runId:'run-auto'})),tick:async()=>resumeInterruptedKnowledgeWorkflows(dependencies)};
}

test('crashed quiz execution waits two minutes from detection and resumes exact saved phase once',async()=>{
  const f=await fixture();try{
    f.advanceTime(3_600_000);
    assert.deepEqual(await f.tick(),{ok:true,value:0});
    const stopped=await f.read();assert.equal(stopped.state,'retryable-failure');assert.equal(stopped.retryState,'per-point-quiz-loop');
    f.advanceTime(119_999);assert.deepEqual(await f.tick(),{ok:true,value:0});assert.equal(f.counts().restarts,0);
    f.advanceTime(1);assert.deepEqual(await f.tick(),{ok:true,value:1});
    const resumed=await f.read();assert.equal(resumed.state,'per-point-quiz-loop');assert.deepEqual(resumed.counts,f.run.counts);assert.equal(resumed.revision,stopped.revision+1);
    assert.deepEqual(await f.tick(),{ok:true,value:0});assert.deepEqual(f.counts(),{events:0,restarts:1});
  }finally{f.db.close();}
});

test('a platform crash retains its safe cause instead of becoming an unexplained interruption',async()=>{
 for(const [message,failureKind] of [['Worker exceeded CPU time limit.','WorkflowCpuTimeLimitExceeded'],['Too many subrequests.','WorkflowSubrequestLimitExceeded'],["exceeded D1's free tier daily row read limit: private SQL",'WorkflowExecutionStopped:d1-daily-quota'],['private unknown exception','WorkflowExecutionStopped']]){
  const f=await fixture();try{
   f.setError({name:'Error',message});assert.deepEqual(await f.tick(),{ok:true,value:0});assert.equal((await f.read()).failureKind,failureKind);
  }finally{f.db.close();}
 }
});

test('hard CPU crashes persist gradual admission reductions through marking and fresh scheduler resumes',async()=>{
 const f=await fixture();try{
  const dependencies={database:f.dependencies.database,stages:new D1WorkflowStageRepository(f.dependencies),run:f.run};
  for(const width of [2,1]) {
   f.setStatus('errored');f.setError({message:'Worker exceeded CPU time limit.'});
   assert.deepEqual(await f.tick(),{ok:true,value:0});
   assert.equal((await f.read()).failureKind,'WorkflowCpuTimeLimitExceeded');
   assert.deepEqual(await readWorkflowCpuWidth(dependencies),{ok:true,value:width});
   assert.deepEqual(await f.tick(),{ok:true,value:0});
   assert.deepEqual(await readWorkflowCpuWidth(dependencies),{ok:true,value:width});
   f.advanceTime(120_000);assert.deepEqual(await f.tick(),{ok:true,value:1});
   assert.equal((await f.read()).failureKind,null);
   assert.deepEqual(await readWorkflowCpuWidth({...dependencies,stages:new D1WorkflowStageRepository(f.dependencies)}),{ok:true,value:width});
  }
 }finally{f.db.close();}
});

test('replaying a CPU observation after its decision was saved cannot narrow again',async()=>{
 const f=await fixture();try{
  const dependencies={database:f.dependencies.database,stages:new D1WorkflowStageRepository(f.dependencies),run:f.run,observationKey:'hard-crash:checkpoint'};
  assert.deepEqual(await recordWorkflowCpuFailure(dependencies),{ok:true,value:2});
  // Recover the same saved decision even if its final profile write was interrupted.
  f.db.prepare("DELETE FROM knowledge_workflow_stages WHERE stage_key='workflow-cpu-backpressure:v2:1'").run();
  assert.deepEqual(await recordWorkflowCpuFailure(dependencies),{ok:true,value:2});
  assert.deepEqual(await recordWorkflowCpuFailure(dependencies),{ok:true,value:2});
  assert.deepEqual(await readWorkflowCpuWidth(dependencies),{ok:true,value:2});
  assert.deepEqual(await recordWorkflowCpuFailure({...dependencies,observationKey:'hard-crash:next-checkpoint'}),{ok:true,value:1});
 }finally{f.db.close();}
});

test('a CPU crash marked before durable backpressure existed receives its profile before resume',async()=>{
 const f=await fixture();try{
  f.unwrap(await f.service.advance({ownerId:f.run.ownerId,runId:f.run.runId,expectedRevision:f.run.revision,nextState:'retryable-failure',failureKind:'WorkflowCpuTimeLimitExceeded'}));
  f.advanceTime(120_000);assert.deepEqual(await f.tick(),{ok:true,value:1});
  assert.deepEqual(await readWorkflowCpuWidth({database:f.dependencies.database,stages:new D1WorkflowStageRepository(f.dependencies),run:f.run}),{ok:true,value:2});
 }finally{f.db.close();}
});

test('failed CPU profile persistence keeps the crash checkpoint available for safe retry',async()=>{
 const f=await fixture();try{
  const prepare=f.dependencies.database.prepare;
  f.dependencies.database.prepare=sql=>sql.startsWith('SELECT stage_key,status,input_digest,result_json')?{...prepare(sql),async all(){return {success:false,results:[]};}}:prepare(sql);
  f.setError({message:'Worker exceeded CPU time limit.'});
  assert.deepEqual(await f.tick(),{ok:false,error:{kind:'WorkflowAutoResumeFailed'}});
  assert.equal((await f.read()).revision,f.run.revision);assert.deepEqual(f.counts(),{events:0,restarts:0});
  f.dependencies.database.prepare=prepare;
  assert.deepEqual(await f.tick(),{ok:true,value:0});
  assert.deepEqual(await readWorkflowCpuWidth({database:f.dependencies.database,stages:new D1WorkflowStageRepository(f.dependencies),run:f.run}),{ok:true,value:2});
 }finally{f.db.close();}
});

test('hard CPU recovery preserves legacy width one and other crashes do not create CPU profiles',async()=>{
 for(const legacy of [true,false]) {
  const f=await fixture();try{
   if(legacy){const key='workflow-cpu-backpressure:v1';f.db.prepare("INSERT INTO knowledge_workflow_stages (owner_id,run_id,stage_key,input_digest,status,result_json,created_at,completed_at) VALUES (?,?,?,?,'completed',?,?,?)").run(f.run.ownerId,f.run.runId,key,key,JSON.stringify({ok:true,value:null}),f.dependencies.now(),f.dependencies.now());}
   f.setError({message:legacy?'Worker exceeded CPU time limit.':'Too many subrequests.'});
   assert.deepEqual(await f.tick(),{ok:true,value:0});
   f.advanceTime(120_000);assert.deepEqual(await f.tick(),{ok:true,value:1});
   assert.deepEqual(await readWorkflowCpuWidth({database:f.dependencies.database,stages:new D1WorkflowStageRepository(f.dependencies),run:f.run}),{ok:true,value:legacy?1:3});
   if(!legacy)assert.equal(f.db.prepare('SELECT count(*) AS count FROM knowledge_workflow_stages').get().count,0);
  }finally{f.db.close();}
 }
});

test('retryable waiting work receives the existing resume event without restarting the workflow',async()=>{
  const f=await fixture();try{
    f.unwrap(await f.service.advance({ownerId:'owner-a',runId:f.run.runId,expectedRevision:f.run.revision,nextState:'retryable-failure',failureKind:'WorkflowStagePersistenceFailed'}));f.setStatus('waiting');
    f.advanceTime(120_000);assert.deepEqual(await f.tick(),{ok:true,value:1});assert.deepEqual(f.counts(),{events:1,restarts:0});assert.equal((await f.read()).state,'per-point-quiz-loop');
  }finally{f.db.close();}
});

test('elapsed extraction deadlines continue after two minutes with checkpoints and a renewed existing time envelope',async()=>{
  const f=await fixture('extraction-loop');try{
    f.advanceTime(30*60_000);f.unwrap(await f.service.advance({ownerId:'owner-a',runId:f.run.runId,expectedRevision:f.run.revision,nextState:'awaiting-time-limit-decision',decisionRequired:'time-limit'}));f.setStatus('waiting');
    f.advanceTime(119_999);assert.deepEqual(await f.tick(),{ok:true,value:0});f.advanceTime(1);assert.deepEqual(await f.tick(),{ok:true,value:1});
    const resumed=await f.read();assert.equal(resumed.state,'extraction-loop');assert.deepEqual(resumed.counts,f.run.counts);assert.equal(Date.parse(resumed.extractionDeadlineAt)-Date.parse(f.dependencies.now()),30*60_000);
  }finally{f.db.close();}
});

test('stopped database states resume when Cloudflare reports a pending event wait as running',async()=>{
  for(const phase of ['retryable-failure','awaiting-time-limit-decision']){
    const f=await fixture('extraction-loop');try{
      f.advanceTime(30*60_000);
      f.unwrap(await f.service.advance({ownerId:'owner-a',runId:f.run.runId,expectedRevision:f.run.revision,nextState:phase,...(phase==='retryable-failure'?{failureKind:'WebpageImageRunDeadlineExceeded'}:{decisionRequired:'time-limit'})}));
      f.setStatus('running');f.advanceTime(119_999);
      assert.deepEqual(await f.tick(),{ok:true,value:0});
      f.advanceTime(1);assert.deepEqual(await f.tick(),{ok:true,value:1});
      const resumed=await f.read();assert.equal(resumed.state,'extraction-loop');assert.deepEqual(resumed.counts,f.run.counts);
      assert.equal(Date.parse(resumed.extractionDeadlineAt)-Date.parse(f.dependencies.now()),30*60_000);
      assert.deepEqual(f.counts(),{events:1,restarts:0});
      assert.deepEqual(await f.tick(),{ok:true,value:0});assert.deepEqual(f.counts(),{events:1,restarts:0});
    }finally{f.db.close();}
  }
});

test('user pauses, cancellations, running executions and disabled sources never auto-resume',async()=>{
  for(const scenario of ['paused','abandoned','running','disabled','platform-paused']){
    const f=await fixture('extraction-loop');try{
      if(['paused','abandoned'].includes(scenario))f.unwrap(await f.service.control({ownerId:'owner-a',runId:f.run.runId,expectedRevision:f.run.revision,action:scenario==='paused'?'stop':'abandon',idempotencyKey:scenario}));
      if(scenario==='running')f.setStatus('running');
      if(scenario==='platform-paused'){await f.tick();f.setStatus('paused');}
      if(scenario==='disabled')f.db.prepare("UPDATE library_sources SET state='disabled'").run();
      f.advanceTime(3_600_000);const before=await f.read();assert.deepEqual(await f.tick(),{ok:true,value:0});assert.deepEqual(await f.read(),before);assert.deepEqual(f.counts(),{events:0,restarts:0});
    }finally{f.db.close();}
  }
});

test('failed control dispatch rolls back to a retryable checkpoint and starts a new two minute wait',async()=>{
  for(const phase of ['retryable-failure','awaiting-time-limit-decision']){
    const f=await fixture('extraction-loop');try{
      f.advanceTime(30*60_000);f.unwrap(await f.service.advance({ownerId:'owner-a',runId:f.run.runId,expectedRevision:f.run.revision,nextState:phase,...(phase==='retryable-failure'?{failureKind:'WorkflowStagePersistenceFailed'}:{decisionRequired:'time-limit'})}));f.setStatus('waiting');f.failDispatch();f.advanceTime(120_000);
      assert.equal((await f.tick()).ok,false);const restored=await f.read();assert.equal(restored.state,'retryable-failure');assert.equal(restored.retryState,'extraction-loop');assert.deepEqual(restored.counts,f.run.counts);
      assert.deepEqual(await f.tick(),{ok:true,value:0});
    }finally{f.db.close();}
  }
});

test('overlapping scheduler ticks dispatch recovery only once',async()=>{
  const f=await fixture();try{
    await f.tick();f.advanceTime(120_000);
    const outcomes=await Promise.all([f.tick(),f.tick()]);assert(outcomes.every(r=>r.ok));assert.equal(f.counts().restarts,1);
  }finally{f.db.close();}
});

test('removed and superseded runs are excluded from automatic recovery',async()=>{
  for(const scenario of ['removed','superseded']){
    const f=await fixture();try{
      if(scenario==='removed')f.db.prepare("INSERT INTO knowledge_workflow_run_tombstones (owner_id,tombstone_id,run_id,purged_before,reason,occurred_at) VALUES (?,?,?,?,?,?)").run('owner-a','removed',f.run.runId,f.dependencies.now(),'workflow-abandoned',f.dependencies.now());
      else {
        const newer={...f.run,runId:'newer-run',idempotencyKey:'newer-run',createdAt:'2026-10-16T12:01:00.000Z',state:'completed'};
        f.unwrap(await new D1KnowledgeWorkflowRepository({database:f.dependencies.database,logger:()=>{}}).insert(newer));
      }
      f.advanceTime(3_600_000);const before=await f.read();assert.deepEqual(await f.tick(),{ok:true,value:0});assert.deepEqual(await f.read(),before);assert.deepEqual(f.counts(),{events:0,restarts:0});
    }finally{f.db.close();}
  }
});


test('one broken workflow instance cannot prevent later sources from recovering',async()=>{
  const f=await fixture();try {
    const second={...f.run,runId:'run-second',sourceId:'source-b',idempotencyKey:'second'};
    f.unwrap(await new D1KnowledgeWorkflowRepository({database:f.dependencies.database,logger:()=>{}}).insert(second));
    f.db.prepare("INSERT INTO library_sources SELECT owner_id,'source-b','https://example.test/second','https://example.test/second',title,description,adapter_json,identity_evidence_json,state,approved_at,updated_at,revision FROM library_sources WHERE source_id='source-a'").run();
    const get=f.dependencies.binding.get,logs=[];
    f.dependencies.logger=e=>logs.push(e);
    f.dependencies.binding.get=async id=>{if(id.endsWith('run-auto'))throw new Error('Fixture instance unavailable');return get(id);};
    assert.equal((await f.tick()).ok,false);
    const stopped=f.unwrap(await f.service.status({ownerId:'owner-a',runId:'run-second'}));assert.equal(stopped.state,'retryable-failure');
    f.advanceTime(120_000);assert.equal((await f.tick()).ok,false);
    assert.equal(f.unwrap(await f.service.status({ownerId:'owner-a',runId:'run-second'})).state,'per-point-quiz-loop');assert.equal(f.counts().restarts,1);
    assert(logs.some(e=>e.event==='knowledge-workflow-auto-resume-run-failure'&&e.runId==='run-auto'));
    assert(logs.some(e=>e.event==='knowledge-workflow-auto-resume-success'&&e.runId==='run-second'));
  }finally{f.db.close();}
});


test('finished bounded checkpoints continue through a fresh scheduler invocation exactly once',async()=>{
 for(const phase of ['extraction-loop','per-point-quiz-loop']){
  const f=await fixture(phase);try{
   f.setStatus('complete');f.setOutput({runId:f.run.runId,revision:f.run.revision,state:phase,continuation:true});
   const outcomes=await Promise.all([f.tick(),f.tick()]);assert(outcomes.every(r=>r.ok));assert.equal(f.counts().restarts,1);
   const continued=await f.read();assert.equal(continued.state,phase);assert.equal(continued.revision,f.run.revision+1);assert.deepEqual(continued.counts,f.run.counts);
   assert.equal(f.db.prepare('SELECT count(*) n FROM knowledge_workflow_controls').get().n,0,'A checkpoint cannot grant a paid model retry');
  }finally{f.db.close();}
 }
});

test('a completed instance needs an exact checkpoint identity before automatic continuation',async()=>{
 for(const output of [null,{continuation:false},{continuation:true,runId:'wrong',revision:6,state:'per-point-quiz-loop'},{continuation:true,runId:'run-auto',revision:999,state:'per-point-quiz-loop'}]){
  const f=await fixture();try{f.setStatus('complete');f.setOutput(output);assert.deepEqual(await f.tick(),{ok:true,value:0});assert.equal(f.counts().restarts,0);assert.deepEqual(await f.read(),f.run);}finally{f.db.close();}
 }
});

test('failed checkpoint dispatch retains the phase and saved counts for bounded recovery',async()=>{
 const f=await fixture();try{
  f.setStatus('complete');f.setOutput({runId:f.run.runId,revision:f.run.revision,state:f.run.state,continuation:true});f.failDispatch();
  assert.equal((await f.tick()).ok,false);const run=await f.read();assert.equal(run.state,'retryable-failure');assert.equal(run.retryState,'per-point-quiz-loop');assert.deepEqual(run.counts,f.run.counts);
 }finally{f.db.close();}
});


test('a scheduler interrupted after claiming a checkpoint recovers without granting a model retry',async()=>{
 const f=await fixture('extraction-loop');try{
  f.setStatus('complete');f.setOutput({runId:f.run.runId,revision:f.run.revision,state:f.run.state,continuation:true});
  f.unwrap(await f.service.advance({ownerId:'owner-a',runId:f.run.runId,expectedRevision:f.run.revision,nextState:f.run.state,counts:f.run.counts}));
  assert.deepEqual(await f.tick(),{ok:true,value:0});f.advanceTime(120_000);assert.deepEqual(await f.tick(),{ok:true,value:1});assert.equal(f.counts().restarts,1);
  assert.equal(f.db.prepare('SELECT count(*) n FROM knowledge_workflow_controls').get().n,0);
 }finally{f.db.close();}
});


test('provider payment rejection waits for owner recovery instead of automatic retry',async()=>{
 const f=await fixture();try{
  f.unwrap(await f.service.advance({ownerId:'owner-a',runId:f.run.runId,expectedRevision:f.run.revision,nextState:'retryable-failure',failureKind:'KnowledgeModelPaymentRequired'}));f.setStatus('waiting');f.advanceTime(3_600_000);
  const before=await f.read();assert.deepEqual(await f.tick(),{ok:true,value:0});assert.deepEqual(await f.read(),before);assert.deepEqual(f.counts(),{events:0,restarts:0});
 }finally{f.db.close();}
});

test('automatic recovery stops after four resumes without published progress; owner resume resets it',async()=>{
 const f=await fixture();try{
  for(let n=0;n<5;n++){
   const run=await f.read();f.unwrap(await f.service.advance({ownerId:'owner-a',runId:run.runId,expectedRevision:run.revision,nextState:'retryable-failure',failureKind:'WorkflowCpuTimeLimitExceeded'}));f.setStatus('waiting');f.advanceTime(120_000);
   assert.deepEqual(await f.tick(),{ok:true,value:n<4?1:0});
  }
  const stopped=await f.read();assert.match(stopped.failureKind,/automatic-retries-exhausted/);assert.equal(f.counts().events,4);
  f.advanceTime(3_600_000);assert.deepEqual(await f.tick(),{ok:true,value:0});assert.equal((await f.read()).revision,stopped.revision);
  f.unwrap(await f.service.control({ownerId:'owner-a',runId:stopped.runId,expectedRevision:stopped.revision,action:'resume',idempotencyKey:'owner-recovery'}));
  const run=await f.read();f.unwrap(await f.service.advance({ownerId:'owner-a',runId:run.runId,expectedRevision:run.revision,nextState:'retryable-failure',failureKind:'WorkflowCpuTimeLimitExceeded'}));f.advanceTime(120_000);assert.deepEqual(await f.tick(),{ok:true,value:1});
 }finally{f.db.close();}
});

test('new published progress keeps automatic recovery available',async()=>{
 const f=await fixture();try{
  for(let n=0;n<6;n++){
   const run=await f.read();f.unwrap(await f.service.advance({ownerId:'owner-a',runId:run.runId,expectedRevision:run.revision,nextState:'retryable-failure',counts:{...run.counts,acceptedQuizzes:run.counts.acceptedQuizzes+1},failureKind:'WorkflowExecutionStopped'}));f.setStatus('waiting');f.advanceTime(120_000);
   assert.deepEqual(await f.tick(),{ok:true,value:1});
  }
 }finally{f.db.close();}
});

test('durable image progress extends recovery with unchanged counts, while retry bookkeeping and failures do not',async()=>{
 for(const progress of [true,false]) {
  const f=await fixture('extraction-loop');try{
   const stop=async()=>{const run=await f.read();f.unwrap(await f.service.advance({ownerId:run.ownerId,runId:run.runId,expectedRevision:run.revision,nextState:'retryable-failure',failureKind:'WorkflowExecutionStopped'}));f.setStatus('waiting');f.advanceTime(120_000);};
   for(let n=0;n<4;n++){await stop();assert.deepEqual(await f.tick(),{ok:true,value:1});}
   await stop();
   const insert=(key,result,at=f.dependencies.now())=>f.db.prepare("INSERT INTO knowledge_workflow_stages (owner_id,run_id,stage_key,input_digest,status,result_json,created_at,completed_at) VALUES (?,?,?,?,'completed',?,?,?)").run(f.run.ownerId,f.run.runId,key,key,JSON.stringify(result),at,at);
   if(progress) {
    for(const key of ['captured-material-image-manifest:fixture','captured-image-caption:fixture:1','captured-image-score:fixture:1'])insert(key,{ok:true,value:{}});
   }else {
    insert('workflow-cpu-observation:hard-crash:fixture',{ok:true,value:2});
    insert('workflow-cpu-backpressure:v2:1',{ok:true,value:{width:2,cpuFailures:1}});
    insert('captured-image-caption:failed:1',{ok:false,error:{kind:'KnowledgeModelRejected',status:503}});
    insert('captured-image-score:old:1',{ok:true,value:{}},'2026-10-16T12:00:00.000Z');
    f.db.prepare("INSERT INTO knowledge_workflow_stages (owner_id,run_id,stage_key,input_digest,status,created_at) VALUES (?,?,'captured-image-caption:pending:1','pending','claimed',?)").run(f.run.ownerId,f.run.runId,f.dependencies.now());
   }
   assert.deepEqual(await f.tick(),{ok:true,value:progress?1:0});
   assert.deepEqual((await f.read()).counts,f.run.counts);
   if(progress){
    for(let n=0;n<4;n++){await stop();assert.deepEqual(await f.tick(),{ok:true,value:n<3?1:0});}
   }
   assert.match((await f.read()).failureKind,/automatic-retries-exhausted/);
  }finally{f.db.close();}
 }
});

test('uncertain calls and credentials require owner action; daily quota waits until the next UTC day',async()=>{
 for(const failureKind of ['WorkflowStageCallUncertain','KnowledgeModelCredentialMissing','KnowledgeModelRejected:http-401','WorkflowStagePersistenceFailed:d1-daily-quota']){
  const f=await fixture();try{
   f.unwrap(await f.service.advance({ownerId:'owner-a',runId:f.run.runId,expectedRevision:f.run.revision,nextState:'retryable-failure',failureKind}));f.setStatus('waiting');f.advanceTime(3_600_000);
   assert.deepEqual(await f.tick(),{ok:true,value:0});
   if(failureKind.endsWith('d1-daily-quota')){f.advanceTime(24*3_600_000);assert.deepEqual(await f.tick(),{ok:true,value:1});}
  }finally{f.db.close();}
 }
});
