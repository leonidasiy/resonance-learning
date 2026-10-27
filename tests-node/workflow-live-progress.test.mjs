import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readdir,readFile } from 'node:fs/promises';
import { D1KnowledgeWorkflowProgressRepository } from '../worker/knowledge-workflow-progress-d1.js';
import { D1KnowledgeWorkflowRepository } from '../worker/knowledge-workflow-d1.js';
import { D1KnowledgeContentRepository,D1QuizRepository } from '../worker/knowledge-workflow-content-d1.js';
import { createKnowledgeWorkflowService } from '../src/features/knowledge-workflows/workflow.js';
import { createKnowledgeWorkflowCleanup } from '../worker/knowledge-workflow-cleanup.js';
import { assembleQuizPair } from '../src/features/knowledge-workflows/quiz-pair.js';
import { createDiscoveryWorker } from '../worker/handler.js';
import { SourceLibraryGatewayClient } from '../src/features/source-library/gateway.js';
import { parseWorkflowProgress } from '../src/features/knowledge-workflows/progress.js';

const unwrap = result => {assert.equal(result.ok,true,JSON.stringify(result.error));return result.value;};
async function fixture(bucket={delete:async()=>{}}) {
 const db=new DatabaseSync(':memory:'),dir=new URL('../worker/migrations/',import.meta.url);
 for (const name of (await readdir(dir)).filter(name=>name.endsWith('.sql')).sort()) db.exec(await readFile(new URL(name,dir),'utf8'));
 const database={prepare(query){let values=[];const execute=()=>({success:true,meta:{changes:Number(db.prepare(query).run(...values).changes)}});return {bind(...v){values=v;return this;},first:async()=>db.prepare(query).get(...values)??null,all:async()=>({success:true,results:db.prepare(query).all(...values)}),run:async()=>execute(),execute};},async batch(statements){db.exec('BEGIN IMMEDIATE');try{const results=statements.map(s=>s.execute());db.exec('COMMIT');return results;}catch(error){db.exec('ROLLBACK');throw error;}}};
 let clock=Date.parse('2026-10-13T10:00:00Z'),ids=0;
 const now=()=>new Date(clock).toISOString(),logger=()=>{},repo=new D1KnowledgeWorkflowRepository({database,logger});
 const cleanup=createKnowledgeWorkflowCleanup({database,bucket,workflowRepository:repo,now,logger});
 const service=createKnowledgeWorkflowService(repo,{now,createId:()=>`run-${++ids}`,logger,cleanup});
 const create=async(ownerId='owner',sourceId='source')=>{db.prepare('INSERT OR IGNORE INTO library_sources(owner_id,source_id,submitted_url,canonical_url,title,description,adapter_json,identity_evidence_json,state,approved_at,updated_at,revision) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(ownerId,sourceId,'https://example.test/source','https://example.test/source','Synthetic source','Offline progress fixture','{}','[]','active',now(),now(),1);return unwrap(await service.createRun({ownerId,sourceId,sourceRevision:1,canonicalSourceIdentity:'https://example.test/source',contentSignature:'synthetic',configDigests:{},idempotencyKey:`create-${ids+1}`})).run;};
 const run=await create(),progress=new D1KnowledgeWorkflowProgressRepository({database,logger}),content=new D1KnowledgeContentRepository({database,logger}),quiz=new D1QuizRepository({database,logger,now});
 return {db,database,repo,service,run,progress,content,quiz,now,create,advance(ms=1000){clock+=ms;},close(){db.close();}};
}
function point(id='point',sourceId='source') {return {id,sourceId,sourceRevision:1,summary:'A tonic is the tonal center.',normalizedHash:id,evidenceAnchors:[{url:'https://example.test/source',selector:'main'}],coverageGoalIds:[],mediaCandidates:[],attribution:{sourceUrl:'https://example.test/source'},extractionVersion:'synthetic'};}
function draft(knowledge,paired=true) {
 const pair=assembleQuizPair({knowledgeId:knowledge.id,knowledgeRevision:1,canonicalAnswers:['tonic'],citedEvidenceUrls:['https://example.test/source'],multipleChoice:{prompt:`Which pitch is central for ${knowledge.id}?`,options:[{key:'a',text:'Tonic'},{key:'b',text:'Dominant'}],correctOptionKeys:['a'],correctOptionAnswers:[{key:'a',canonicalAnswer:'tonic'}],explanation:'The tonic is central.'},fillBlank:{prompt:'The tonal center is the ____.',blanks:[{id:'blank-1',canonicalAnswer:'tonic',acceptedAnswers:['tonic']}],explanation:'The tonic is central.'}},`quiz:${knowledge.id}`);
 return {id:pair.multipleChoice.id,knowledgeId:knowledge.id,knowledgeRevision:1,kind:'single-choice',prompt:pair.multipleChoice.prompt,options:['Tonic','Dominant'],answer:'Tonic',explanation:'The tonic is central.',citedEvidenceUrls:pair.citedEvidenceUrls,...(paired?{pairedQuiz:pair}:{})};
}
async function publish(f,run,knowledge,paired=true) {
 unwrap(await f.content.appendKnowledgePoint(knowledge,run.ownerId,run.runId,f.now()));
 unwrap(await f.quiz.publish({ownerId:run.ownerId,runId:run.runId,knowledge,draft:draft(knowledge,paired),score:9,attempt:1,status:'published'}));
}

test('in-flight page/title/section and partial stages are durable and owner scoped',async()=>{
 const f=await fixture();try {
  const scope={ownerId:f.run.ownerId,runId:f.run.runId};
  unwrap(await f.progress.save({...scope,currentUrl:'https://example.test/source/lesson-1',pageTitle:'Lesson 1',sectionTitle:'Pitch',stage:'Extracting knowledge',updatedAt:f.now()}));
  f.advance();unwrap(await f.progress.save({...scope,stage:'Reviewing knowledge',updatedAt:f.now()}));
  const result=unwrap(await f.progress.read(f.run));
  assert.equal(result.currentUrl,'https://example.test/source/lesson-1');assert.equal(result.pageTitle,'Lesson 1');assert.equal(result.sectionTitle,'Pitch');assert.equal(result.stage,'Reviewing knowledge');assert.equal(result.updatedAt,f.now());
  assert.equal((await f.progress.read({...f.run,ownerId:'other'})).error.kind,'WorkflowProgressNotFound');
  unwrap(await f.progress.save({...scope,stage:'Stale concurrent review',updatedAt:'2026-10-12T00:00:00Z'}));
  assert.equal(unwrap(await f.progress.read(f.run)).stage,'Reviewing knowledge','Out-of-order display updates preserve newer progress without failing extraction');
  assert.equal((await f.progress.save({...scope,currentUrl:'javascript:alert(1)',updatedAt:f.now()})).error.kind,'WorkflowProgressCommandInvalid');
  unwrap(await f.progress.save({...scope,pageTitle:null,updatedAt:f.now()}));assert.equal(unwrap(await f.progress.read(f.run)).pageTitle,null);
 }finally{f.close();}
});

test('live progress uses committed current-run points, actual paired and legacy quiz questions, and scratchpad page counts',async()=>{
 const f=await fixture();try{
  await publish(f,f.run,point('paired'));f.advance();await publish(f,f.run,point('legacy'),false);
  const other=await f.create('other-owner');await publish(f,other,point('paired'));
  const previous=await f.create();await publish(f,previous,point('previous-run'));
  const scratchpad=unwrap(await f.content.loadScratchpad({ownerId:f.run.ownerId,runId:f.run.runId,sourceId:f.run.sourceId,sourceRevision:1}));
  unwrap(await f.content.saveScratchpad({...scratchpad,revision:2,processedUrls:['https://example.test/source/lesson-1'],discoveredUrls:['https://example.test/source/lesson-1','https://example.test/source/lesson-2'],pageNotes:[{url:'https://example.test/source/lesson-1',title:'Completed lesson',note:'Synthetic progress.',observedAt:f.now(),linkCount:1,candidateCount:1}]},f.now()));
  const result=unwrap(await f.progress.read(f.run));assert.deepEqual(result.knowledgePoints.map(p=>p.knowledgeId),['paired','legacy']);assert.equal(result.generatedQuizQuestions,3);assert.equal(result.processedPageCount,1);assert.equal(result.totalPages,2);assert.equal(result.pageTitle,'Completed lesson');
 }finally{f.close();}
});

test('confirmed cancellation deletes points/quizzes immediately even when remote media cleanup fails, retains retry keys, and fences late writes',async()=>{
 let f,fail=true,remoteCalls=0;
 f=await fixture({delete:async()=>{
  remoteCalls++;assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM extraction_knowledge_points WHERE run_id=?').get(f.run.runId).n,0);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM knowledge_workflow_quizzes WHERE run_id=?').get(f.run.runId).n,0);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM learning_generation_tasks WHERE item_id=?').get('canceled').n,0);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM knowledge_workflow_progress').get().n,0);if(fail)throw new Error('Synthetic storage unavailable');
 }});
 try{
  await publish(f,f.run,point('canceled'));const other=await f.create();await publish(f,other,point('preserved'));
  unwrap(await f.progress.save({ownerId:f.run.ownerId,runId:f.run.runId,currentUrl:'https://example.test/source',stage:'Generating quizzes',updatedAt:f.now()}));
  f.db.prepare('INSERT INTO knowledge_workflow_media_assets(owner_id,asset_id,run_id,knowledge_id,source_url,origin,kind,media_type,byte_count,digest,private_original_key,attribution,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run('owner','asset',f.run.runId,'canceled','https://example.test/image.png','webpage','image','image/png',1,'synthetic','private-retry-key','Synthetic source',f.now());
  const command={ownerId:f.run.ownerId,runId:f.run.runId,expectedRevision:f.run.revision,action:'abandon',idempotencyKey:'confirmed-cancel'};
  assert.equal((await f.service.control(command)).error.kind,'WorkflowCleanupFailed');
  const canceled=unwrap(await f.service.status(command));assert.equal(canceled.state,'abandoned');assert.equal(unwrap(await f.progress.read(canceled)).generatedQuizQuestions,0);assert.equal(unwrap(await f.progress.read(canceled)).knowledgePoints.length,0);
  assert.equal(f.db.prepare('SELECT private_original_key FROM knowledge_workflow_media_assets').get().private_original_key,'private-retry-key');
  assert.equal((await f.progress.save({ownerId:'owner',runId:f.run.runId,stage:'Late result',updatedAt:f.now()})).ok,false);assert.equal((await f.content.appendKnowledgePoint(point('late'),'owner',f.run.runId,f.now())).ok,false);
  assert.equal(unwrap(await f.progress.read(other)).knowledgePoints.length,1);
  fail=false;unwrap(await f.service.control(command));assert.equal(remoteCalls,2);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM knowledge_workflow_media_assets').get().n,0);assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{f.close();}
});

test('tombstones atomically prohibit progress writes and failed reads never fabricate success',async()=>{
 const f=await fixture();try{
  f.db.prepare('INSERT INTO knowledge_workflow_run_tombstones VALUES(?,?,?,?,?,?)').run('owner','t',f.run.runId,f.now(),'synthetic-cancel',f.now());
  assert.equal((await f.progress.save({ownerId:'owner',runId:f.run.runId,stage:'Late',updatedAt:f.now()})).ok,false);
  f.db.exec('DROP TABLE knowledge_workflow_progress');assert.equal((await f.progress.read(f.run)).error.kind,'WorkflowProgressReadFailed');
 }finally{f.close();}
});

test('authenticated source-status projection and browser gateway preserve progress; legacy payloads remain valid',async()=>{
 const f=await fixture();try{
  await publish(f,f.run,point('projected'));
  unwrap(await f.progress.save({ownerId:'owner',runId:f.run.runId,currentUrl:'https://example.test/source',pageTitle:'A source',sectionTitle:'Pitch',stage:'Generating quizzes',updatedAt:f.now()}));
 const worker=createDiscoveryWorker({allowedOrigin:'https://app.example',maximumCommandBytes:4096},{now:f.now,requestLogger:()=>({ok:true,value:null}),authenticate:async()=>({ok:true,value:{ownerId:'owner',email:'owner@example.test'}}),acquireRss:async()=>assert.fail('No network'),knowledgeWorkflow:{start:async()=>assert.fail('No start'),control:async()=>assert.fail('No control'),status:command=>f.service.status(command),sourceStatus:async command=>{assert.equal(command.ownerId,'owner');assert.equal(command.sourceId,'source');return {ok:true,value:{ownerId:'owner',sourceId:'source',run:{...f.run,progress:unwrap(await f.progress.read(f.run))},imageWarnings:['Image warning: MediaStorageFailed. Text retained.','Text extraction empty: {"internal":"diagnostic"}']}};}}});
  const gateway=new SourceLibraryGatewayClient({baseUrl:'https://worker.example',timeoutMs:5000,fetch:async(input,init)=>worker.fetch(new Request(input,{...init,headers:{origin:'https://app.example'}}))});
  const result=unwrap(await gateway.workflowStatus('source'));assert.equal(result.run.progress.pageTitle,'A source');assert.equal(result.run.progress.generatedQuizQuestions,2);assert.equal(result.run.progress.knowledgePoints[0].summary,point().summary);
  assert.match(result.message,/Some source images were omitted/);assert(!result.message.includes('MediaStorageFailed'));assert(!result.message.includes('internal'));
  const legacy=new SourceLibraryGatewayClient({baseUrl:'https://worker.example',timeoutMs:5000,fetch:async()=>Response.json({ownerId:'owner',result:{sourceId:'source',run:{...result.run,progress:undefined},reasonCode:null,message:null}})});
  assert.equal(unwrap(await legacy.workflowStatus('source')).run.progress,undefined);
  const invalid=new SourceLibraryGatewayClient({baseUrl:'https://worker.example',timeoutMs:5000,fetch:async()=>Response.json({ownerId:'owner',result:{sourceId:'source',run:{...result.run,progress:{...result.run.progress,generatedQuizQuestions:-1}},reasonCode:null,message:null}})});
  assert.equal((await invalid.workflowStatus('source')).error.kind,'SourceGatewayResponseInvalid');
 }finally{f.close();}
});

test('public progress rejects duplicate IDs and unsafe URLs',()=>{
 const valid={currentUrl:null,pageTitle:null,sectionTitle:null,stage:null,updatedAt:null,knowledgePoints:[],generatedQuizQuestions:0};
 assert.ok(parseWorkflowProgress(valid));assert.equal(parseWorkflowProgress({...valid,currentUrl:'file:///private'}),null);assert.equal(parseWorkflowProgress({...valid,currentUrl:'https://secret:password@example.test'}),null);assert.equal(parseWorkflowProgress({...valid,knowledgePoints:[{knowledgeId:'id',summary:'One'},{knowledgeId:'id',summary:'Two'}]}),null);
});

test('failed units survive durable progress projection and reject invalid public fields',async()=>{
 const f=await fixture();try{
  const scratchpad=unwrap(await f.content.loadScratchpad(f.run));
  const failedPages=[{url:'https://example.test/source#section=page-2',title:'Page 2',failureKind:'KnowledgeReviewOutputInvalid',attempts:2,failedAt:f.now()}];
  unwrap(await f.content.saveScratchpad({...scratchpad,failedPages,revision:scratchpad.revision+1},f.now()));
  const progress=unwrap(await f.progress.read(f.run));
  assert.deepEqual(progress.failedItems,failedPages.map(({failedAt,...item})=>item));
  assert.equal(progress.processedPageCount,0);
  assert.equal(parseWorkflowProgress({...progress,failedItems:[{...progress.failedItems[0],attempts:0}]}),null);
  assert.equal(parseWorkflowProgress({...progress,failedItems:[{...progress.failedItems[0],url:'https://user:password@example.test/source'}]}),null);
  assert.equal(parseWorkflowProgress({...progress,failedItems:[...progress.failedItems,...progress.failedItems]}),null);
 }finally{f.close();}
});

test('dismissed page and quiz failures stay cleared after durable reload without deleting learned content or accounting',async()=>{
 const f=await fixture();try{
  await publish(f,f.run,point('saved'));
  unwrap(await f.content.appendKnowledgePoint(point('failed-quiz'),'owner',f.run.runId,f.now()));
  const scratchpad=unwrap(await f.content.loadScratchpad(f.run));
  unwrap(await f.content.saveScratchpad({...scratchpad,revision:scratchpad.revision+1,failedPages:[{url:'https://example.test/missing',title:'Missing page',failureKind:'KnowledgePageFetchFailed',attempts:2,failedAt:f.now()}]},f.now()));
  const failedQuiz={knowledgeId:'failed-quiz',summary:'A saved point without a quiz.',failureKind:'KnowledgeModelUnavailable',attempts:4,failedAt:f.now(),generation:0,generatorGeneration:0,phase:'generation'};
  f.db.prepare("INSERT INTO knowledge_workflow_stages(owner_id,run_id,stage_key,input_digest,status,result_json,created_at,completed_at) VALUES(?,?,?,'synthetic','completed',?,?,?)").run('owner',f.run.runId,'quiz-point-failed:failed-quiz:0',JSON.stringify({ok:true,value:failedQuiz}),f.now(),f.now());
  const completed=unwrap(await f.repo.update({ownerId:'owner',runId:f.run.runId,expectedRevision:1,next:{...f.run,state:'completed',revision:2,failureKind:'WorkflowQuizItemsFailed',counts:{pages:1,knowledgePoints:2,acceptedQuizzes:1,pendingQuizzes:0}}}));
  const before=unwrap(await f.progress.read(completed));assert.equal(before.failedItems.length,1);assert.equal(before.failedQuizItems.length,1);
  const other=await f.create('another-owner');
  const worker=createDiscoveryWorker({allowedOrigin:'https://app.example',maximumCommandBytes:4096},{now:f.now,requestLogger:()=>({ok:true,value:null}),authenticate:async()=>({ok:true,value:{ownerId:'owner',email:'owner@example.test'}}),acquireRss:async()=>assert.fail('No network'),knowledgeWorkflow:{start:async()=>assert.fail('Dismiss must not start processing'),control:command=>f.service.control(command),status:command=>f.service.status(command),sourceStatus:async()=>{const run=unwrap(await f.repo.findById('owner',f.run.runId));return {ok:true,value:{ownerId:'owner',sourceId:'source',run:{...run,progress:unwrap(await f.progress.read(run))}}};}}});
  const gateway=new SourceLibraryGatewayClient({baseUrl:'https://worker.example',timeoutMs:5000,fetch:async(input,init)=>worker.fetch(new Request(input,{...init,headers:{origin:'https://app.example'}}))});
  unwrap(await gateway.dismissWorkflowFailures({runId:f.run.runId,expectedRevision:2,idempotencyKey:'dismiss-both'}));
  const publicStatus=unwrap(await gateway.workflowStatus('source'));
  assert.equal(publicStatus.reasonCode,null);assert.equal(publicStatus.run.progress.failedQuizItems,undefined);assert.equal(publicStatus.run.progress.failedItems,undefined);
  const reloaded=unwrap(await f.repo.findById('owner',f.run.runId)),after=unwrap(await f.progress.read(reloaded));
  assert.equal(reloaded.state,'completed');assert.equal(reloaded.failureKind,'WorkflowFailedItemsDismissed');assert.deepEqual(reloaded.counts,completed.counts);
  assert.equal(after.failedItems,undefined);assert.equal(after.failedQuizItems,undefined);assert.deepEqual(after.knowledgePoints,before.knowledgePoints);assert.equal(after.generatedQuizQuestions,2);
  assert.equal(unwrap(await f.progress.read(completed)).failedQuizItems,undefined,'Stale callers cannot restore dismissed failure projections.');
  assert.equal(unwrap(await f.repo.findById(other.ownerId,other.runId)).revision,other.revision);
  assert.equal(f.db.prepare('SELECT state FROM library_sources WHERE owner_id=? AND source_id=?').get('owner','source').state,'active');
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM knowledge_workflow_stages WHERE owner_id=? AND run_id=?').get('owner',f.run.runId).n,1,'Paid attempt history is preserved.');
  assert.equal(unwrap(await f.content.loadScratchpad(f.run)).failedPages.length,1,'Original failure evidence is retained.');
 }finally{f.close();}
});
