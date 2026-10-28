import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile,readdir} from 'node:fs/promises';
import {readFailedQuizItems} from '../worker/knowledge-workflow-quiz-failures.js';
import {createLearningBatchService} from '../worker/learning-batches-d1.js';

test('failed quiz lookup uses the stage-key index while retaining unresolved failures and owner isolation',async()=>{
 const db=new DatabaseSync(':memory:');
 try{
  db.exec('CREATE TABLE knowledge_workflow_stages(owner_id TEXT,run_id TEXT,stage_key TEXT,status TEXT,result_json TEXT,PRIMARY KEY(owner_id,run_id,stage_key))');
  const insert=db.prepare('INSERT INTO knowledge_workflow_stages VALUES(?,?,?,?,?)');
  for(let i=0;i<500;i++)insert.run('owner','run','question-evaluator:'+i,'completed','{}');
  const item=id=>({knowledgeId:id,summary:'Synthetic supported claim.',failureKind:'QuizDraftSchemaInvalid',attempts:4,failedAt:'2026-10-28T00:00:00Z',generation:2,phase:'generation',generatorGeneration:2});
  for(const [owner,id] of [['owner','unresolved'],['owner','recovered'],['other-owner','foreign']])insert.run(owner,'run',`quiz-point-failed:${id}:2`,'completed',JSON.stringify({ok:true,value:item(id)}));
  insert.run('owner','run','quiz-point-completed:recovered','completed','{}');
  let plan;
  const database={prepare(sql){let values=[];return{bind(...v){values=v;return this;},all:async()=>{plan=db.prepare('EXPLAIN QUERY PLAN '+sql).all(...values);return{success:true,results:db.prepare(sql).all(...values)};}};}};
  assert.deepEqual(await readFailedQuizItems(database,{ownerId:'owner',runId:'run'}),{ok:true,value:[item('unresolved')]});
  assert(plan.some(row=>/SEARCH knowledge_workflow_stages .*stage_key>\? AND stage_key<\?/u.test(row.detail)),'Stage lookup must seek its prefix instead of scanning every model stage');
 }finally{db.close();}
});

test('migrated learning candidate media lookup seeks each knowledge binding through its partial index',async()=>{
 const db=new DatabaseSync(':memory:');
 try{
  for(const file of (await readdir('worker/migrations')).filter(name=>name.endsWith('.sql')).sort())db.exec(await readFile('worker/migrations/'+file,'utf8'));
  let plan;
  const database={prepare(sql){let values=[];return{bind(...v){values=v;return this;},all:async()=>{plan=db.prepare('EXPLAIN QUERY PLAN '+sql).all(...values);return{success:true,results:db.prepare(sql).all(...values)};}};},batch:async()=>assert.fail('Candidate reads must not mutate data')};
  const result=await createLearningBatchService({database,now:()=>new Date().toISOString(),logger:()=>{}}).listCandidates('owner',new Date().toISOString());
  assert.deepEqual(result,{ok:true,value:[]});
  assert(plan.some(row=>row.detail.includes('knowledge_workflow_media_active_knowledge')&&row.detail.includes('knowledge_id=? AND run_id=? AND source_revision=?')),'Correlated media lookup must not scan all of the owner\'s images per knowledge point');
 }finally{db.close();}
});
