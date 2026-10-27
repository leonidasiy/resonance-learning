import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {readFile,readdir} from 'node:fs/promises';
import {createQuizActorCritic,QUIZ_MAX_ATTEMPTS} from '../src/features/knowledge-workflows/quiz.js';
import {D1QuizRepository,D1KnowledgeContentRepository} from '../worker/knowledge-workflow-content-d1.js';
import {D1WorkflowStageRepository} from '../worker/knowledge-workflow-stages-d1.js';
import {runReviewedQuizPoints,readReviewedQuizStatistics} from '../scripts/benchmark-reviewed-runtime.mjs';

const now=()=> '2026-10-12T00:00:00.000Z';
const migrationDirectory=new URL('../worker/migrations/',import.meta.url);
function seedRun(db){db.prepare("INSERT INTO library_sources (owner_id,source_id,submitted_url,canonical_url,title,description,adapter_json,identity_evidence_json,state,approved_at,updated_at,revision) VALUES ('owner','source','https://example.test/source','https://example.test/source','Synthetic source','Offline quiz fixture','{}','[]','active',?,?,1)").run(now(),now());db.prepare(`INSERT INTO knowledge_workflow_runs (owner_id,run_id,source_id,source_revision,canonical_source_identity,content_signature,state,revision,idempotency_key,config_digests_json,counts_json,reused,created_at,updated_at,run_json) VALUES ('owner','run','source',1,'source','digest','per-point-quiz-loop',1,'idem','{}','{}',0,?,?,'{}')`).run(now(),now());}
function port(db){return {prepare(sql){let values=[];return {bind(...args){values=args;return this;},async first(){return db.prepare(sql).get(...values)??null;},async all(){return {success:true,results:db.prepare(sql).all(...values)};},async run(){return {success:true,meta:{changes:Number(db.prepare(sql).run(...values).changes)}};}};},async batch(statements){db.exec('BEGIN');try{const values=[];for(const statement of statements)values.push(await statement.run());db.exec('COMMIT');return values;}catch(error){db.exec('ROLLBACK');throw error;}}};}
const point=id=>({id,sourceId:'source',sourceRevision:1,summary:`The supported relationship for ${id}.`,normalizedHash:id,evidenceAnchors:[{url:'https://example.test/source',selector:'#evidence'}],coverageGoalIds:[],mediaCandidates:[],attribution:{sourceUrl:'https://example.test/source'},extractionVersion:'v1'});

test('fourth quiz attempt persists; exhaustion retains knowledge without publishing a quiz',async()=>{
 const db=new DatabaseSync(':memory:');
 try{
  for(const name of (await readdir(migrationDirectory)).filter(name=>name.endsWith('.sql')).sort())db.exec(await readFile(new URL(name,migrationDirectory),'utf8'));
  seedRun(db);
  const database=port(db),content=new D1KnowledgeContentRepository({database,logger:()=>{}}),repository=new D1QuizRepository({database,logger:()=>{},now});
  const points=[point('kept'),point('dropped')];
  for(const value of points)assert.equal((await content.appendKnowledgePoint(value,'owner','run',now())).ok,true);
  const attempts=[];
  const actor=createQuizActorCritic({maxAttempts:QUIZ_MAX_ATTEMPTS,repository,now,logger:()=>{},generator:{async generate({knowledge,attempt}){attempts.push({id:knowledge.id,attempt});return {ok:true,value:{id:`draft-${knowledge.id}-${attempt}`,knowledgeId:knowledge.id,knowledgeRevision:1,kind:'single-choice',prompt:`Which supported relationship applies to ${knowledge.id}?`,options:['A','B'],answer:'A',citedEvidenceUrls:['https://example.test/source']}};}},reviewer:{async evaluate({knowledge,attempt}){return {ok:true,value:{score:knowledge.id==='kept'&&attempt===4?9:6,reasons:['Grounded'],feedback:'Clarify the distinction.',groundingProblems:[]}};}}});
  const result=await actor.run({ownerId:'owner',runId:'run',points});
  assert.equal(result.ok,true,JSON.stringify(result));
  assert.equal(attempts.length,8);
  assert.deepEqual(db.prepare('SELECT knowledge_id FROM extraction_knowledge_points').all().map(row=>row.knowledge_id),['dropped','kept']);
  assert.deepEqual(db.prepare('SELECT knowledge_id,attempt_number FROM knowledge_workflow_quizzes').all().map(row=>({...row})),[{knowledge_id:'kept',attempt_number:4}]);
  assert.deepEqual(await repository.findPublished({ownerId:'owner',runId:'run',knowledgeId:'kept'}),{ok:true,value:{status:'published',attempt:4}});
  assert.equal(db.prepare("SELECT count(*) AS n FROM learning_generation_units WHERE unit_json LIKE '%dropped%'").get().n,0);
  assert.equal(db.prepare("SELECT count(*) AS n FROM knowledge_workflow_quiz_attempts WHERE knowledge_id='kept'").get().n,4);
  assert.equal(db.prepare("SELECT count(*) AS n FROM knowledge_workflow_quiz_retry_attempts WHERE knowledge_id='kept'").get().n,4);
  assert.equal(db.prepare("SELECT count(*) AS n FROM knowledge_workflow_purge_tombstones WHERE knowledge_id='dropped' AND reason='no-meaningful-quiz'").get().n,0);
  assert.equal(result.value.statistics.quizDropRate,0.5);
  assert.equal(result.value.statistics.retryRate,1);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{db.close();}
});

test('quiz retry migration preserves existing rows, foreign keys and cancellation fences',async()=>{
 const db=new DatabaseSync(':memory:');
 try{
  const names=(await readdir(migrationDirectory)).filter(name=>name.endsWith('.sql')).sort();
  for(const name of names.filter(name=>!name.startsWith('0026_')))db.exec(await readFile(new URL(name,migrationDirectory),'utf8'));
  seedRun(db);
  db.exec(`INSERT INTO knowledge_workflow_quiz_attempts VALUES ('owner','old','run','old-point',3,NULL,7,'feedback','QuizScoreBelowThreshold','date'); INSERT INTO knowledge_workflow_quiz_retry_attempts VALUES ('owner','old','run','old-point',3,NULL,7,'feedback','QuizScoreBelowThreshold','date'); INSERT INTO knowledge_workflow_quizzes VALUES ('owner','old-quiz','run','old-point','source',1,'fingerprint','{}',9,3,'published','date');`);
  const tables=['knowledge_workflow_quiz_attempts','knowledge_workflow_quiz_retry_attempts','knowledge_workflow_quizzes'];
  const before=tables.map(table=>db.prepare(`SELECT * FROM ${table}`).all());
  db.exec("UPDATE knowledge_workflow_runs SET state='abandoned'");
  db.exec(await readFile(new URL('0026_quiz_four_attempts.sql',migrationDirectory),'utf8'));
  assert.deepEqual(tables.map(table=>db.prepare(`SELECT * FROM ${table}`).all()),before);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys,1);
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  for(const table of tables)assert.throws(()=>db.exec(`UPDATE ${table} SET attempt_number=4`),/WorkflowAttemptAbandoned/);
  db.exec("UPDATE knowledge_workflow_runs SET state='per-point-quiz-loop'");
  db.exec("DELETE FROM knowledge_workflow_quiz_attempts WHERE attempt_id='old'");
  assert.equal(db.prepare('SELECT count(*) AS n FROM knowledge_workflow_quiz_retry_attempts').get().n,0);
  assert.throws(()=>db.exec("UPDATE knowledge_workflow_quizzes SET attempt_number=5"),/CHECK constraint failed/);
 }finally{db.close();}
});

test('quiz statistics preserve an earlier dropped point through interruption and resume',async()=>{
 const db=new DatabaseSync(':memory:');
 try{
  for(const name of (await readdir(migrationDirectory)).filter(name=>name.endsWith('.sql')).sort())db.exec(await readFile(new URL(name,migrationDirectory),'utf8'));
  seedRun(db);
  const run={ownerId:'owner',runId:'run'},database=port(db),content=new D1KnowledgeContentRepository({database,logger:()=>{}}),repository=new D1QuizRepository({database,logger:()=>{},now}),stageRepository=new D1WorkflowStageRepository({database,now});
  const points=[point('preference'),point('dropped'),point('kept')],knowledgeIds=points.map(point=>point.id);
  for(const value of points)assert.equal((await content.appendKnowledgePoint(value,'owner','run',now())).ok,true);
  let interrupted=true,generations=0;
  const actor=createQuizActorCritic({maxAttempts:QUIZ_MAX_ATTEMPTS,repository,now,logger:()=>{},beforeGenerate:async knowledge=>({ok:true,value:knowledge.id!=='preference'}),generator:{async generate({knowledge,attempt}){
   if(knowledge.id==='kept'&&interrupted)return {ok:false,error:{kind:'ProviderUnavailable'}};
   generations++;
   return stageRepository.run(run,`question-generator:quiz-generator-${knowledge.id}-${attempt}:signature`,'signature',async()=>({ok:true,value:{id:`draft-${knowledge.id}-${attempt}`,knowledgeId:knowledge.id,knowledgeRevision:1,kind:'single-choice',prompt:`Which supported relationship applies to ${knowledge.id}?`,options:['A','B'],answer:'A',citedEvidenceUrls:['https://example.test/source']}}));
  }},reviewer:{async evaluate({knowledge,attempt}){return {ok:true,value:{score:knowledge.id==='kept'&&attempt===2?9:6,reasons:['Grounded'],feedback:'Clarify.',groundingProblems:[]}};}}});
  const initial=await runReviewedQuizPoints({actor,stageRepository,run,points});
  assert.equal(initial.ok,false);
  assert.equal(generations,4);
  assert.equal(db.prepare("SELECT count(*) AS n FROM extraction_knowledge_points WHERE knowledge_id='dropped'").get().n,1);
  interrupted=false;
  const remaining=await content.listKnowledgePoints({ownerId:'owner',runId:'run',sourceId:'source',sourceRevision:1});
  assert.equal(remaining.ok,true);
  assert.equal((await runReviewedQuizPoints({actor,stageRepository,run,points:remaining.value})).ok,true);
  const outputs=db.prepare('SELECT knowledge_id AS knowledgeId,attempt_number AS attempt FROM knowledge_workflow_quizzes').all();
  const report=readReviewedQuizStatistics({sqlite:db,run,knowledgeIds,outputs});
  assert.deepEqual(report.statistics,{inputPoints:3,attemptedPoints:2,retriedPoints:2,extraAttempts:4,retryRate:1,quizDroppedPoints:1,quizDropRate:1/3,exhaustedDropPoints:1,preferenceDroppedPoints:1});
  assert.equal((await runReviewedQuizPoints({actor,stageRepository,run,points:remaining.value})).ok,true);
  assert.equal(generations,6);
  assert.deepEqual(readReviewedQuizStatistics({sqlite:db,run,knowledgeIds,outputs}),report);
  db.prepare("DELETE FROM knowledge_workflow_stages WHERE stage_key='reviewed-benchmark-quiz-disposition:dropped'").run();
  assert.throws(()=>readReviewedQuizStatistics({sqlite:db,run,knowledgeIds,outputs}),/ReviewedQuizStatisticsUnavailable/);
 }finally{db.close();}
});


test('score-seven migration preserves rows and cancellation fences and rejects six',async()=>{
 const db=new DatabaseSync(':memory:');try{
  for(const name of (await readdir(migrationDirectory)).filter(n=>n.endsWith('.sql')&&!n.startsWith('0031_')).sort())db.exec(await readFile(new URL(name,migrationDirectory),'utf8'));
  seedRun(db);db.exec("INSERT INTO knowledge_workflow_quizzes VALUES ('owner','quiz','run','point','source',1,'fingerprint','{}',9,4,'published','date')");
  const before=db.prepare('SELECT * FROM knowledge_workflow_quizzes').all();
  db.exec(await readFile(new URL('0031_quiz_acceptance_seven.sql',migrationDirectory),'utf8'));
  assert.deepEqual(db.prepare('SELECT * FROM knowledge_workflow_quizzes').all(),before);
  db.exec('UPDATE knowledge_workflow_quizzes SET score=7');
  assert.throws(()=>db.exec('UPDATE knowledge_workflow_quizzes SET score=6'),/CHECK constraint failed/);
  db.exec("UPDATE knowledge_workflow_runs SET state='abandoned'");
  assert.throws(()=>db.exec('UPDATE knowledge_workflow_quizzes SET score=8'),/WorkflowAttemptAbandoned/);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{db.close();}
});
