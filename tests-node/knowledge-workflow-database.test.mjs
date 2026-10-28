import assert from 'node:assert/strict';
import {test} from 'node:test';
import {observeWorkflowDatabase} from '../worker/knowledge-workflow-database.js';
import {workflowPersistenceDiagnostic} from '../worker/knowledge-workflow-logging.js';
import {executeRetryingWorkflowStep} from '../worker/knowledge-workflow-step.js';
import {D1KnowledgeWorkflowProgressRepository} from '../worker/knowledge-workflow-progress-d1.js';

function fixture(work) {
  const logs=[],sleeps=[];let attempts=0;
  const native={bind(){return this;},first:async()=>{attempts++;return work();},run:async()=>{attempts++;return work();},all:async()=>{attempts++;return work();}};
  const database={prepare:()=>native,batch:async statements=>{assert.equal(statements[0],native);return [await native.run()];}};
  const observed=observeWorkflowDatabase(database,e=>logs.push(e),{now:()=>10,sleep:async ms=>sleeps.push(ms),random:()=>0});
  return {database:observed,logs,sleeps,attempts:()=>attempts};
}

test('only transient SELECT errors retry, using bounded backoff and safe operation context',async()=>{
  let calls=0;
  const f=fixture(()=>{if(calls++<2)throw new Error('private SQL',{cause:new Error('D1 DB is overloaded: confidential bindings')});return {id:1};});
  assert.deepEqual(await f.database.prepare('SELECT id FROM knowledge_workflow_runs WHERE private=?').bind('secret').first(),{id:1});
  assert.deepEqual(f.sleeps,[250,500]);assert.equal(f.attempts(),3);
  assert.equal(f.logs[0].field,'select.knowledge_workflow_runs.first');
  assert.equal(f.logs[0].diagnosticToken,'d1-overloaded');
  assert(!JSON.stringify(f.logs).includes('secret'));assert(!JSON.stringify(f.logs).includes('confidential'));
});

test('deterministic read errors and uncertain writes are never automatically repeated',async()=>{
  for(const [sql,method,message] of [['SELECT id FROM runs','first','SQLITE_CONSTRAINT: secret'],['UPDATE runs SET state=?','run','SQLITE_BUSY: secret'],['UPDATE runs SET state=? RETURNING state','first','D1 DB is overloaded']]) {
    const failure=new Error(message),f=fixture(()=>{throw failure;});
    await assert.rejects(f.database.prepare(sql)[method](),error=>error===failure);
    assert.equal(f.attempts(),1);assert.deepEqual(f.sleeps,[]);
  }
});

test('transient reads stop after the existing four-attempt envelope',async()=>{
  const f=fixture(()=>{throw new Error('SQLITE_BUSY');});
  await assert.rejects(f.database.prepare('SELECT id FROM runs').all());
  assert.equal(f.attempts(),4);assert.deepEqual(f.sleeps,[250,500,1000]);
});

test('batch preserves native statements and false results report sanitized diagnostics',async()=>{
  const f=fixture(()=>({success:false,error:'SQLITE_TOOBIG: private payload'}));
  const statement=f.database.prepare('INSERT INTO runs VALUES (?)').bind('secret');
  assert.equal((await f.database.batch([statement]))[0].success,false);
  assert.equal(f.attempts(),1);assert.equal(f.logs[0].field,'batch');assert.equal(f.logs[0].diagnosticToken,'sqlite-too-big');
  assert(!JSON.stringify(f.logs).includes('private'));
  assert.equal(observeWorkflowDatabase(f.database,()=>assert.fail('No double wrapping')),f.database);
});

test('schema and nested platform failures retain safe categories',()=>{
  assert.equal(workflowPersistenceDiagnostic(new Error('outer',{cause:new Error('no such column: private')})),'sqlite-schema');
  assert.equal(workflowPersistenceDiagnostic(new Error('Too many subrequests')),'subrequest-limit');
  assert.equal(workflowPersistenceDiagnostic(new Error('outer',{cause:new Error('Too many API requests by single Worker invocation')})),'subrequest-limit');
});

test('repository contract failures identify their operation without leaking the stored payload',async()=>{
  const {D1KnowledgeWorkflowRepository}=await import('../worker/knowledge-workflow-d1.js');
  const f=fixture(()=>({run_json:'private invalid stored JSON'})),logs=[];
  const repository=new D1KnowledgeWorkflowRepository({database:f.database,logger:e=>logs.push(e)});
  assert.deepEqual(await repository.findById('owner','run'),{ok:false,error:{kind:'WorkflowPersistenceFailed'}});
  assert.equal(logs[0].action,'findById');assert.equal(logs[0].diagnosticToken,'repository-result-invalid');assert.equal(typeof logs[0].durationMs,'number');
  assert(!JSON.stringify(logs).includes('private'));
});

test('an explicitly unsuccessful transient read retries without treating the result as success',async()=>{
  let calls=0;const f=fixture(()=>calls++===0?{success:false,error:'Network connection lost'}:{success:true,results:[]});
  assert.equal((await f.database.prepare('SELECT id FROM runs').all()).success,true);
  assert.equal(f.attempts(),2);assert.deepEqual(f.sleeps,[250]);
});

test('real progress persistence errors retain safe causes and recover through the workflow step',async()=>{
 let writes=0,loads=0;
 const f=fixture(()=>{if(++writes===1)throw new Error('private SQL',{cause:new Error('storage caused object to be reset')});return {success:true,meta:{changes:1}};});
 const repository=new D1KnowledgeWorkflowProgressRepository({database:f.database,logger:()=>{}});
 const result=await executeRetryingWorkflowStep({step:{do:async(_n,_c,cb)=>cb(),sleepUntil:async()=>{}},name:'progress recovery',now:()=>0,load:async()=>({ok:true,value:++loads}),execute:async()=>repository.save({ownerId:'owner',runId:'run',stage:'Reviewing knowledge',updatedAt:'2026-10-28T00:00:00Z'})});
 assert.equal(result.ok,true);assert.equal(writes,2);assert.equal(loads,2);assert(!JSON.stringify(f.logs).includes('private SQL'));
});

test('run lookup preserves quota diagnostics without exposing exception text',async()=>{
 const {D1KnowledgeWorkflowRepository}=await import('../worker/knowledge-workflow-d1.js');
 const f=fixture(()=>{throw new Error("D1_ERROR: exceeded D1's free tier daily row read limit: private SQL");});
 const repository=new D1KnowledgeWorkflowRepository({database:f.database,logger:()=>{}});
 assert.deepEqual(await repository.findById('owner','run'),{ok:false,error:{kind:'WorkflowPersistenceFailed',diagnosticToken:'d1-daily-quota'}});
});
