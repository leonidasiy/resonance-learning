import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {readFile,readdir} from 'node:fs/promises';
import {resumeInterruptedKnowledgeWorkflows} from '../worker/knowledge-workflow-auto-resume.js';
import {D1KnowledgeWorkflowRepository} from '../worker/knowledge-workflow-d1.js';
import {createKnowledgeWorkflowService} from '../src/features/knowledge-workflows/workflow.js';

async function fixture(phase='per-point-quiz-loop') {
  const db=new DatabaseSync(':memory:');
  const migrations=new URL('../worker/migrations/',import.meta.url);
  for(const name of (await readdir(migrations)).filter(n=>n.endsWith('.sql')).sort())db.exec(await readFile(new URL(name,migrations),'utf8'));
  const database={prepare(sql){let values=[];return {bind(...v){values=v;return this;},async first(){return db.prepare(sql).get(...values)??null;},async all(){return {success:true,results:db.prepare(sql).all(...values)};},async run(){return {success:true,meta:{changes:Number(db.prepare(sql).run(...values).changes)}};}};},async batch(statements){return Promise.all(statements.map(s=>s.run()));}};
  let time=Date.parse('2026-10-16T12:00:00.000Z'),status='errored',events=0,restarts=0,dispatchFails=false,output;
  const now=()=>new Date(time).toISOString(),logger=()=>{};
  const service=createKnowledgeWorkflowService(new D1KnowledgeWorkflowRepository({database,logger}),{now,logger,createId:()=> 'run-auto'});
  const unwrap=r=>{assert.equal(r.ok,true,JSON.stringify(r.error));return r.value;};
  let run=unwrap(await service.createRun({ownerId:'owner-a',sourceId:'source-a',sourceRevision:1,canonicalSourceIdentity:'https://example.test/',contentSignature:'source',configDigests:{},idempotencyKey:'create-auto'})).run;
  for(const state of ['rights-assessment','robots-check','extraction-loop',...(phase==='per-point-quiz-loop'?['extraction-finalized','per-point-quiz-loop']:[])])run=unwrap(await service.advance({ownerId:run.ownerId,runId:run.runId,expectedRevision:run.revision,nextState:state,counts:{pages:11,knowledgePoints:31,acceptedQuizzes:1,pendingQuizzes:0}}));
  db.prepare("INSERT INTO library_sources VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run('owner-a','source-a','https://example.test/','https://example.test/','Fixture','','{}','[]','active',now(),now(),1);
  const instance={id:'instance',status:async()=>({status,output}),restart:async()=>{if(dispatchFails)throw new Error('Test dispatch unavailable');restarts++;status='running';},resume:async()=>{},sendEvent:async()=>{if(dispatchFails)throw new Error('Test dispatch unavailable');events++;status='running';},pause:async()=>{},terminate:async()=>{}};
  const dependencies={database,binding:{create:async()=>instance,get:async()=>instance},ownerId:'owner-a',now,logger};
  return {db,service,dependencies,run,unwrap,advanceTime:ms=>{time+=ms;},setStatus:s=>{status=s;},setOutput:v=>{output=v;},failDispatch:()=>{dispatchFails=true;},counts:()=>({events,restarts}),read:async()=>unwrap(await service.status({ownerId:'owner-a',runId:'run-auto'})),tick:async()=>resumeInterruptedKnowledgeWorkflows(dependencies)};
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
