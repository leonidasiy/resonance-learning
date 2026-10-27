import {syntheticAssessment} from './fixtures/knowledge-review-audit.mjs';
import {syntheticRelationshipUnits} from './fixtures/webpage-condition-partition.mjs';
import {test} from 'node:test';
import {AgentExecutionBoundaryFailure} from '../src/features/knowledge-workflows/harness.js';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createKnowledgeWorkflowRuntime} from '../worker/knowledge-workflow-runtime.js';
import {createKnowledgeWorkflowService} from '../src/features/knowledge-workflows/workflow.js';
import {createAgentConfigurationLoader} from '../src/features/knowledge-workflows/config.js';
import {D1SourceLibraryRepository} from '../worker/source-library-d1.js';
import {D1KnowledgeWorkflowRepository} from '../worker/knowledge-workflow-d1.js';
import {D1KnowledgeContentRepository} from '../worker/knowledge-workflow-content-d1.js';
import {WEBPAGE_IMAGE_POLICY,createWebpageImageBudget} from '../worker/webpage-image-budget.js';
import {createWebpageImageCache} from '../worker/webpage-image-cache.js';
import {quoteHash} from '../worker/webpage-facts.js';
import {createKnowledgeWorkflowLogger} from '../worker/knowledge-workflow-logging.js';

for(const {partial,blockedImage,resumedPage,sessionImage,cacheResume,authoritativePrevious,retryWindow,stalePhase,cachedRetry,largePage,callbackRetry,batchRetry,qualityFailure} of [{qualityFailure:true,partial:false,blockedImage:true},{partial:false,blockedImage:true,largePage:true,batchRetry:true},{partial:false,blockedImage:true,largePage:true,callbackRetry:true},{partial:false,blockedImage:true,largePage:200},{partial:false,blockedImage:true,largePage:true},{partial:false,blockedImage:false,largePage:true,sessionImage:"associated"},{partial:false,blockedImage:true,retryWindow:true,stalePhase:true,cachedRetry:true},{partial:false,blockedImage:true,retryWindow:true},{partial:false,blockedImage:true,stalePhase:true},{partial:false,blockedImage:false,authoritativePrevious:true},{partial:false,blockedImage:false,sessionImage:'associated',cacheResume:true},{partial:false,blockedImage:false},{partial:true,blockedImage:false},{partial:false,blockedImage:true},{partial:false,blockedImage:true,resumedPage:true},...['success','associated','blocked','corrupt','mismatch','oversize','throw'].map(sessionImage=>({partial:false,blockedImage:false,sessionImage}))])test(qualityFailure?'mocked exhausted quiz quality preserves verified knowledge and supports targeted retry':batchRetry?'mocked failed batch-selection retry preserves successful acquisition and point reviews':callbackRetry?'mocked owner resume recovers a cached callback failure without replaying successful source acquisition':largePage?`mocked ${typeof largePage==='number'?largePage:48}-candidate webpage checkpoints reviews and images under the D1 invocation allowance: ${sessionImage??'text'}`:cachedRetry?'mocked webpage resume replays the cached successful retry without another extraction call':retryWindow?'mocked webpage extraction keeps a successful technical retry after the first request deadline expires':stalePhase?'mocked webpage resume ignores an expired duplicate phase reservation without rewriting it':authoritativePrevious?'mocked partial-page observer and normalizer retain same-page and other-page committed knowledge and preferences':cacheResume?'mocked production cached original rehydrates reviewer pixels without a browser read or new debit':sessionImage?`mocked production browser-session image ${sessionImage} uses observed scope and never backend fallback`:resumedPage?'mocked production resume retains expired page reservation and accepts a bounded new revision read':blockedImage?'mocked production figure caption retains reviewed text after optional image403; no pixels fabricated':`mocked production webpage runtime retains text and explicit partial=${partial} issues after association fails; no network`,async(t)=>{
 const candidateCount=typeof largePage==='number'?largePage:48;const selected=index=>largePage!==200||index%10!==0;const selectedCount=Array.from({length:candidateCount},(_,index)=>index).filter(selected).length;
 const db=new DatabaseSync(':memory:'),originalFetch=globalThis.fetch;let network=0,timeOffset=0,historicalPhase,interruptedAfterRetry=false,queryCount=0,pageReads=0,batchSelections=0,browserCaptured=false,callbackRecovered=false,batchRecovered=false,qualityRecovered=false,quizDrafts=0;const queryCounts=[];const countQuery=()=>{if(largePage&&++queryCount>1000)throw Error("Too many subrequests");};
 globalThis.fetch=()=>{network++;assert.fail('ZERO_NETWORK_SENTINEL');};
 try{
  for(const name of (await readdir('worker/migrations')).filter(n=>n.endsWith('.sql')).sort())db.exec(await readFile('worker/migrations/'+name,'utf8'));
  const database={prepare(sql){let values=[];const execute=()=>{countQuery();const result={success:true,meta:{changes:Number(db.prepare(sql).run(...values).changes)}};if(callbackRetry&&!callbackRecovered&&sql.startsWith('INSERT INTO knowledge_workflow_stages')&&String(values[2]).startsWith('question-evaluator:knowledge-quality-')){db.prepare("UPDATE knowledge_workflow_stages SET status='completed',result_json=?,completed_at=? WHERE owner_id=? AND run_id=? AND stage_key=? AND status='claimed'").run(JSON.stringify({ok:false,error:{kind:'WorkflowAgentAgentOutputInvalid'}}),values[4],...values.slice(0,3));return {success:true,meta:{changes:0}};}return result;};return {bind(...v){if(/LIKE \?/i.test(sql)&&v.some(value=>typeof value==='string'&&Buffer.byteLength(value)>50))throw Error('D1_ERROR: LIKE or GLOB pattern too complex');values=v;return this;},first:async()=>{countQuery();if(stalePhase&&!historicalPhase&&sql.startsWith('SELECT output_json,policy_json FROM knowledge_workflow_image_attempts')&&String(values[3]).startsWith('scraper-observe-')){db.prepare('INSERT INTO knowledge_workflow_image_attempts(owner_id,run_id,page_url,attempt_key,policy_version,policy_json,evaluations,decoded_bytes,deadline_at_ms,settled) VALUES(?,?,?,?,?,?,?,?,?,?)').run(...values.slice(0,4),WEBPAGE_IMAGE_POLICY.version,JSON.stringify(WEBPAGE_IMAGE_POLICY),0,0,Date.now()-1,0);historicalPhase=db.prepare('SELECT * FROM knowledge_workflow_image_attempts WHERE attempt_key=?').get(values[3]);}return db.prepare(sql).get(...values)??null;},all:async()=>{countQuery();return {success:true,results:db.prepare(sql).all(...values)};},run:async()=>{const result=execute();if(cachedRetry&&!interruptedAfterRetry&&sql.startsWith("UPDATE knowledge_workflow_stages SET status='completed'")&&values.some(value=>typeof value==='string'&&value.startsWith('knowledge-scraper:scraper-observe-')&&value.includes(':technical-2:'))){interruptedAfterRetry=true;throw new AgentExecutionBoundaryFailure({kind:'EvaluationCancelled'});}return result;},execute};},async batch(statements){db.exec('BEGIN IMMEDIATE');try{const r=statements.map(s=>s.execute());db.exec('COMMIT');return r;}catch(error){db.exec('ROLLBACK');throw error;}}};
  const unwrap=r=>{assert.equal(r.ok,true,JSON.stringify(r.error));return r.value;};
  const records=[],nowMs=()=>Date.now()+timeOffset,clock=()=>new Date(nowMs()).toISOString(),logger=createKnowledgeWorkflowLogger({sink:r=>records.push(r),now:clock});
  const ownerId='glm-fixture-owner',runId='glm-fixture-run',sourceId='glm-fixture-source',url='https://fixture.test/lesson';
  const loader=createAgentConfigurationLoader({sha256:async s=>'sha256:'+createHash('sha256').update(s).digest('hex')}),configs={};
  for(const role of ['rights-assessor','knowledge-scraper','question-generator','question-evaluator'])configs[role]=unwrap(await loader.load({source:await readFile('agent-config/'+role+'.yaml','utf8'),expectedRole:role}));
  configs['question-evaluator']={...configs['question-evaluator'],model:{...configs['question-evaluator'].model,name:'synthetic-distinct-reviewer'}};
  const repository=new D1KnowledgeWorkflowRepository({database,logger}),service=createKnowledgeWorkflowService(repository,{now:clock,createId:()=>runId,logger});
  let run=unwrap(await service.createRun({ownerId,sourceId,sourceRevision:1,canonicalSourceIdentity:url,contentSignature:'fixture-revision',idempotencyKey:runId,configDigests:Object.fromEntries(Object.entries(configs).map(([role,c])=>[role,c.digest])),userAuthorization:{kind:'user-authorized-link',ownerId,sourceId,sourceRevision:1,url,recordedAt:clock()}})).run;
  run=unwrap(await service.advance({ownerId,runId,expectedRevision:run.revision,nextState:'rights-assessment'}));
  db.prepare('INSERT INTO library_sources(owner_id,source_id,submitted_url,canonical_url,title,description,adapter_json,identity_evidence_json,state,approved_at,updated_at,revision) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(ownerId,sourceId,url,url,'Fixture','Synthetic source','{"kind":"website"}','[]','active',clock(),clock(),1);
  const block={id:'block:1',locator:'main > p',sectionId:'section:root',kind:blockedImage?'caption':'text',figureId:blockedImage?'figure:1':null,text:'A ratio compares two quantities with matching units.'};
  const image={id:'image:1',url:'https://fixture.test/diagram.png',occurrences:[{id:'occurrence:1',locator:'main > img',sectionId:'section:root',figureId:blockedImage?'figure:1':null,captionId:blockedImage?block.id:null,alt:'Pixels must not create facts.'}],occurrenceWindows:[['occurrence:1']]};
  const evidence={url,blocks:[block],images:[image],headings:[],warnings:[]},operations=[];let imageReads=0,textCritics=0,sessionImageReads=0;const storedSessionImages=[];
  const committed=[];
  if(authoritativePrevious){
   const content=new D1KnowledgeContentRepository({database,logger});
   for(const [id,sourceUrl,summary] of [['saved-same-page',url,'A ratio compares quantities.'],['saved-other-page',url+'/earlier','An unwanted synthetic convention.']]){
    const saved={id,sourceId,sourceRevision:1,summary,normalizedHash:id,evidenceAnchors:[{url:sourceUrl,selector:'p',quote:summary,clause:summary}],coverageGoalIds:[],mediaCandidates:[],attribution:{sourceUrl},extractionVersion:'synthetic-committed'};
    unwrap(await content.appendKnowledgePoint(saved,ownerId,runId,clock()));committed.push({id,summary});
   }
   db.prepare('INSERT INTO learner_preference_feedback(owner_id,knowledge_id,preference,choice,created_at) VALUES(?,?,?,?,?)').run(ownerId,'saved-other-page',-1,'less',clock());
  }
  const fetch=async(_url,init)=>{
   const body=JSON.parse(init.body),message=body.messages[1].content,envelope=Array.isArray(message)?message[0].text:message;
   const parsed=JSON.parse(envelope.slice(envelope.indexOf('\n')+1,envelope.lastIndexOf('\n'))),task=parsed.task?.task??parsed.task??parsed;
   operations.push(task.operation??(task.knowledge?'quiz':task.draft?'critic':'classification'));
   if(retryWindow&&task.operation==='extract-webpage-facts'&&operations.filter(o=>o===task.operation).length===1){timeOffset+=configs['knowledge-scraper'].limits.timeoutMs+1;throw Error('Synthetic request timed out before the successful technical retry.');}
   if(['normalize-webpage-claim-boundaries','verify-webpage-facts'].includes(task.operation))assert.equal(body.model,'synthetic-distinct-reviewer');
   if(authoritativePrevious&&['extract-webpage-facts','normalize-webpage-claim-boundaries'].includes(task.operation)){
    assert.deepEqual(task.previousKnowledge.toSorted((a,b)=>a.id.localeCompare(b.id)),committed.toSorted((a,b)=>a.id.localeCompare(b.id)),'Committed facts from the current incomplete page remain authoritative');
    assert.deepEqual(task.lessOften,[committed[1]],'Owner preference input survives the committed-knowledge forwarding');
    if(task.operation==='normalize-webpage-claim-boundaries')return new Response(null,{status:401}); // Terminal credential refusal stops this input-forwarding fixture without technical retries.
   }
   if(task.operation==='extract-webpage-facts')assert.equal(body.model,configs['knowledge-scraper'].model.name);
   let output;
   if(body.response_format?.json_schema?.name==='knowledge_batch_selection_v1'){if(batchRetry&&!batchRecovered)return Response.json({id:'synthetic-truncated',choices:[{finish_reason:'length',message:{content:'{'}}]});if(largePage)assert(task.points.every(point=>/^\d{1,3}$/.test(point.id)),'Whole-page selection must use bounded local aliases, not long persistence IDs');batchSelections++;output={keptKnowledgeIds:task.points.filter((point,index)=>selected(index)).map(point=>point.id)};}
   else if(body.response_format?.json_schema?.name==='public_webpage_access_v1')output={access:'public',reason:'Synthetic visible source',evidenceBlockIds:[block.id]};
   else if(task.operation==='plan'||task.operation==='replan')output={revision:1,frontier:task.operation==='plan'?[url]:[],coverageGoals:[],unresolvedGaps:[],stopDecision:{decision:task.operation==='plan'?'continue':'complete',rationale:'Synthetic captured source.',evidenceUrls:[url],unresolvedGapIds:[]}};
   else if(task.operation==='extract-webpage-facts'){assert.equal(body.response_format.type,'json_schema');assert(!Array.isArray(message));output={notes:'',candidates:[...(partial?[null]:[]),...Array.from({length:largePage?candidateCount:1},(_,index)=>({summary:block.text,normalizedHash:largePage?'ratio-'+index:'ratio',coverageGoalIds:[],mediaCandidates:[],evidenceAnchors:[{reference:task.citationSources.find(s=>s.sourceId===block.id).reference,clause:block.text}]}))]};}
   else if(task.operation==='normalize-webpage-claim-boundaries')output={notes:task.notes,blockCoverage:task.sourceBlocks.map(b=>({blockId:b.id,disposition:'candidates',candidateHashes:task.candidates.filter(c=>c?.evidenceAnchors?.some(a=>a.reference.id===b.citationReference.id)).map(c=>c.normalizedHash),reason:'Synthetic supported relationship.'})),additionalCandidates:[],reviews:task.candidates.map(c=>({sourceNormalizedHash:c.normalizedHash,relationshipUnits:syntheticRelationshipUnits([c]),candidates:[c]}))};
  else if(task.operation==='verify-webpage-facts'){assert.equal(body.response_format.type,'json_object');assert.equal(task.candidates[0].evidenceAnchors[0].url,url);assert.equal(task.candidates[0].evidenceAnchors[0].quoteDigest,await quoteHash(block.text));output={verdicts:[{normalizedHash:'ratio',grounded:true,useful:true}]};}
   else if(task.operation==='match-webpage-images'){if(sessionImage==='associated')output={matches:task.facts.map(fact=>({normalizedHash:fact.normalizedHash,status:'match',imageId:task.candidates[0].id,imageDigest:task.candidates[0].digest}))};else return new Response(null,{status:502});}
   else if(task.operation==='assess-webpage-image-purpose')output={purpose:'evidence',imageId:task.imageId,imageDigest:task.imageDigest,visibleEvidence:'Synthetic quantity labels.'};
   else if(task.auditEvidence && task.currentAttachmentIds){textCritics++;if(blockedImage){assert.equal(task.sourceMode,'text');assert.deepEqual(task.currentAttachmentIds,[]);assert.equal(Array.isArray(message)?message.filter(part=>part.type==='image_url').length:0,0);assert.deepEqual(task.sourceEvidence.blocks,[block]);}output=syntheticAssessment(task,{decision:'pass',reasons:['Constructed fixture'],feedback:'Constructed source support.',matchedLessOftenIds:[],allowTextOnly:false,supportingImageEvidence:task.currentAttachmentIds.length?'Synthetic quantity labels.':''});}
   else if(task.source&&task.points)output={mainSubject:'mathematics',topic:'Ratios'};
   else if(task.pairedQuiz)output={targets:task.pairedQuiz.canonicalAnswers.map(answer=>({answer,important:true,reason:'Synthetic central answer.'})),feedback:'Accepted fixture targets.'};
   else if(task.draft)output={score:qualityFailure&&!qualityRecovered?6:7,reasons:['Synthetic supported answer.'],feedback:'Accepted synthetic fixture.',groundingProblems:[],knowledgeGroundingProblems:[]};
   else if(task.knowledge){quizDrafts++;output={knowledgeId:task.knowledge.id,knowledgeRevision:1,canonicalAnswers:['ratio'],citedEvidenceUrls:[url],multipleChoice:{prompt:'Which relationship compares quantities?',options:[{key:'a',text:'A ratio'},{key:'b',text:'A date'}],correctOptionKeys:['a'],correctOptionAnswers:[{key:'a',canonicalAnswer:'ratio'}],explanation:'A ratio compares quantities.'},fillBlank:{prompt:'A ____ compares quantities.',blanks:[{id:'blank-1',canonicalAnswer:'ratio',acceptedAnswers:['ratio']}],explanation:'A ratio compares quantities.'}};}
   else assert.fail('Unexpected fixture model task '+task.operation);
   return Response.json({id:'synthetic-'+operations.length,choices:[{finish_reason:'stop',message:{content:JSON.stringify(output),reasoning:'PRIVATE_REASONING'}}],usage:{prompt_tokens:1,completion_tokens:1}});
  };
  const browser={readPage:async()=>{if(!browserCaptured){pageReads++;browserCaptured=true;}if(largePage)assert.equal(pageReads,1,"Review checkpoints reuse the captured page");return {ok:true,value:{url,responseUrl:url,renderedTitle:'Synthetic ratio source',contentType:'text/html',bytes:new TextEncoder().encode('<main><p>'+block.text+'</p></main>'),redirects:0,evidence}};},readRobots:async()=>({ok:true,value:largePage===200?{status:403,bytes:new Uint8Array()}:{status:200,bytes:new TextEncoder().encode('User-agent: *\nAllow: /')}}),screenshot:async()=>assert.fail('Text extraction must not screenshot.'),close:async()=>({ok:true,value:null})};
  if(sessionImage)browser.readImage=async command=>{sessionImageReads++;assert.equal(command.url,image.url);assert.equal(command.pageUrl,url);assert.equal(command.rootUrl,url);assert(command.signal instanceof AbortSignal);assert.equal(command.maximumBytes,20*1024*1024);if(sessionImage==='blocked')return {ok:false,error:{kind:'KnowledgeBrowserImageBlocked'}};if(sessionImage==='throw')throw Error('Synthetic browser image failure');return {ok:true,value:{bytes:sessionImage==='corrupt'?new TextEncoder().encode('<html>Challenge</html>'):sessionImage==='oversize'?new Uint8Array(21*1024*1024):new Uint8Array([137,80,78,71,13,10,26,10]),mediaType:sessionImage==='mismatch'?'image/jpeg':'image/png'}};};
  const cachedObjects=new Map(),cacheBucket={put:async(key,bytes)=>cachedObjects.set(key,bytes.slice()),get:async key=>{const bytes=cachedObjects.get(key);return bytes?{arrayBuffer:async()=>bytes.slice().buffer}:null;},delete:async key=>cachedObjects.delete(key)};
  let cachedReadBefore;
  if(cacheResume){
   const originalBudget=createWebpageImageBudget({database,policy:WEBPAGE_IMAGE_POLICY,scope:{ownerId,runId,pageUrl:url},maximumPages:100,deadlineAtMs:Date.now()+60000,now:Date.now,logger}),originalCache=createWebpageImageCache({database,bucket:cacheBucket,budget:originalBudget,scope:{ownerId,runId,sourceRevision:1,pageUrl:url},logger});
   unwrap(await originalBudget.reserve({key:`read:${image.id}`,evaluations:1,decodedBytes:20*1024*1024,timeoutMs:30000}));unwrap(await originalBudget.settle(`read:${image.id}`,8));unwrap(await originalCache.save(image,{bytes:new Uint8Array([137,80,78,71,13,10,26,10]),mediaType:'image/png'}));
   cachedReadBefore=db.prepare('SELECT * FROM knowledge_workflow_image_attempts WHERE attempt_key=?').get(`read:${image.id}`);
  }
  const runtime=createKnowledgeWorkflowRuntime({...(cacheResume||largePage?{mediaBucket:cacheBucket}:{}),...(sessionImage==='associated'?{media:{ingest:async()=>assert.fail('Session image must persist captured bytes without another URL fetch.'),ingestBytes:async command=>{storedSessionImages.push(command);return {ok:true,value:{}};}},reviewMedia:{readOriginal:async()=>({ok:true,value:{id:image.id,bytes:storedSessionImages[0].bytes,mediaType:storedSessionImages[0].candidate.mediaTypeHint}})}}:{}),webpageStructuredOutput:true,imagePolicy:WEBPAGE_IMAGE_POLICY,database,fetch,browser,apiKey:'synthetic',endpoint:'https://fixture.test/model',now:clock,nowMs,logger,configSnapshots:configs,resolveAddresses:async()=>({ok:true,value:['93.184.216.34']}),publicEgress:{fetch:async()=>{if(sessionImage)assert.fail('Browser capability must not trigger a separate backend fetch.');imageReads++;return {ok:true,value:blockedImage?new Response('Synthetic public image access challenge',{status:403,headers:{'content-type':'text/html'}}):new Response(new Uint8Array([137,80,78,71,13,10,26,10]),{headers:{'content-type':'image/png'}})};}},transition:({run:current,nextState,...rest})=>service.advance({ownerId,runId,expectedRevision:current.revision,nextState,...rest})});
  let historicalPageAttempt;
  if(resumedPage){db.prepare('INSERT INTO knowledge_workflow_image_attempts(owner_id,run_id,page_url,attempt_key,policy_version,policy_json,evaluations,decoded_bytes,deadline_at_ms,settled) VALUES(?,?,?,?,?,?,?,?,?,?)').run(ownerId,runId,url,'page-acquisition',WEBPAGE_IMAGE_POLICY.version,JSON.stringify(WEBPAGE_IMAGE_POLICY),0,0,Date.now()-1,0);historicalPageAttempt=db.prepare("SELECT * FROM knowledge_workflow_image_attempts WHERE attempt_key='page-acquisition'").get();}
  if(authoritativePrevious){
   const executed=await runtime.execute(run);assert.equal(executed.ok,false,'Deliberately refused normalization must stop the fixture');
   assert.equal(operations.filter(o=>o==='extract-webpage-facts').length,1);assert.equal(operations.filter(o=>o==='normalize-webpage-claim-boundaries').length,1);
   assert.equal(operations.some(o=>o==='match-webpage-images'||o==='quiz'||o==='critic'),false);
   const rows=db.prepare('SELECT knowledge_id,point_json FROM extraction_knowledge_points WHERE owner_id=? AND run_id=? ORDER BY knowledge_id').all(ownerId,runId);assert.equal(rows.length,2);assert.deepEqual(rows.map(r=>r.knowledge_id),['saved-other-page','saved-same-page']);
   assert.equal(db.prepare('SELECT count(*) n FROM knowledge_workflow_quizzes WHERE owner_id=? AND run_id=?').get(ownerId,runId).n,0);assert.equal(network,0);return;
  }
  if(cachedRetry){const interrupted=await runtime.execute(run);assert.equal(interrupted.ok,false,JSON.stringify(interrupted));assert.equal(interrupted.error.detailKind,'ExtractionAcquisitionFailed');assert(interruptedAfterRetry);run=unwrap(await repository.findById(ownerId,runId));run=unwrap(await service.advance({ownerId,runId,expectedRevision:run.revision,nextState:'retryable-failure',failureKind:interrupted.error.detailKind}));run=unwrap(await service.advance({ownerId,runId,expectedRevision:run.revision,nextState:'extraction-loop'}));}
  if(callbackRetry){
   const failed=await runtime.execute(run);assert.equal(failed.ok,false);assert.equal(failed.error.detailKind,'WorkflowAgentAgentOutputInvalid');assert.equal(textCritics,0);
   run=unwrap(await repository.findById(ownerId,runId));
   run=unwrap(await service.advance({ownerId,runId,expectedRevision:run.revision,nextState:'retryable-failure',failureKind:failed.error.detailKind}));
   timeOffset+=1000;run=unwrap(await service.control({ownerId,runId,expectedRevision:run.revision,action:'resume',idempotencyKey:'auto-resume:fixture'}));
   assert.equal((await runtime.execute(run)).ok,false,'Automatic continuation cannot grant another paid call');assert.equal(textCritics,0);
   run=unwrap(await repository.findById(ownerId,runId));
   run=unwrap(await service.advance({ownerId,runId,expectedRevision:run.revision,nextState:'retryable-failure',failureKind:failed.error.detailKind}));
   callbackRecovered=true;timeOffset+=1000;
   run=unwrap(await service.control({ownerId,runId,expectedRevision:run.revision,action:'resume',idempotencyKey:'owner-callback-retry'}));
  }
  if(batchRetry){
   for(let execution=0;execution<candidateCount;execution++){
    queryCount=0;const result=await runtime.execute(run);assert.equal(result.ok,true,JSON.stringify(result));
    run=unwrap(await repository.findById(ownerId,runId));
    if(run.state==='completed')break;
    assert.equal(run.state,'awaiting-time-limit-decision');run=unwrap(await service.advance({ownerId,runId,expectedRevision:run.revision,nextState:'extraction-loop'}));
   }
   assert.equal(run.failureKind,'WorkflowPagesFailed');assert.equal(textCritics,candidateCount);assert.equal(pageReads,1);
   batchRecovered=true;timeOffset+=1000;
   run=unwrap(await service.control({ownerId,runId,expectedRevision:run.revision,action:'resume',idempotencyKey:'owner-batch-retry'}));
  }
  if(largePage){
   for(let execution=0;execution<candidateCount*2+1;execution++){
    queryCount=0;browserCaptured=false;unwrap(await runtime.execute(run));queryCounts.push(queryCount);
    run=unwrap(await repository.findById(ownerId,runId));
    if(run.state==='completed')break;
    if(run.state==='awaiting-time-limit-decision'){
     if(run.counts.knowledgePoints>0)assert.equal(textCritics,candidateCount+(batchRetry?3:0),'All reviews finish before any ordered publication');
     run=unwrap(await service.advance({ownerId,runId,expectedRevision:run.revision,nextState:'extraction-loop'}));
    }else assert.equal(run.state,'per-point-quiz-loop');
   }
   assert.equal(run.state,'completed');assert.equal(run.counts.knowledgePoints,selectedCount);assert.equal(run.counts.acceptedQuizzes,selectedCount);
   assert.equal(JSON.parse(db.prepare('SELECT scratchpad_json FROM extraction_scratchpads').get().scratchpad_json).reviewedCandidateCount,candidateCount);
   assert.equal(operations.filter(o=>o==='extract-webpage-facts').length,1);assert.equal(operations.filter(o=>o==='normalize-webpage-claim-boundaries').length,1);
   assert.equal(textCritics,candidateCount+(batchRetry?3:0),'Saved review chunks are retained; only the unfinished selection chunk is rechecked after an approved retry');assert.equal(batchSelections,1,'Global duplicate selection is retained across commit chunks');assert.equal(pageReads,1);
   assert.equal(queryCounts.length>1,true);assert.equal(Math.max(...queryCounts)<1000,true);
   assert.deepEqual(db.prepare('SELECT point_json FROM extraction_knowledge_points ORDER BY rowid').all().map(row=>JSON.parse(row.point_json).normalizedHash),Array.from({length:candidateCount},(_,index)=>index).filter(selected).map(index=>'ratio-'+index));
   t.diagnostic(JSON.stringify({candidateCount,selectedCount,chunks:queryCounts.length,maximumQueriesPerChunk:Math.max(...queryCounts),pageReads,batchSelections}));
   if(sessionImage==='associated'){assert.equal(sessionImageReads,1);assert.equal(storedSessionImages.length,candidateCount);for(const stored of storedSessionImages)assert.deepEqual(stored.bytes,new Uint8Array([137,80,78,71,13,10,26,10]));}
   if(callbackRetry)assert.equal(db.prepare("SELECT count(*) AS n FROM knowledge_workflow_stages WHERE json_extract(result_json,'$.error.kind')='WorkflowAgentAgentOutputInvalid'").get().n,12,'Original failed results remain immutable');
   assert.equal(network,0);return;
  }
  unwrap(await runtime.execute(run));
  if(qualityFailure){
   run=unwrap(await repository.findById(ownerId,runId));
   assert.equal(run.state,'completed');assert.equal(run.failureKind,'WorkflowQuizItemsFailed');assert.equal(run.counts.knowledgePoints,1);assert.equal(run.counts.acceptedQuizzes,0);
   assert.equal(db.prepare('SELECT count(*) n FROM extraction_knowledge_points').get().n,1);
   assert.equal(db.prepare('SELECT count(*) n FROM knowledge_workflow_purge_tombstones').get().n,0);
   assert.equal(db.prepare("SELECT count(*) n FROM knowledge_workflow_stages WHERE stage_key LIKE 'quiz-point-failed:%' AND status='completed'").get().n,1);
   assert.equal(quizDrafts,4);
   qualityRecovered=true;run=unwrap(await service.control({ownerId,runId,expectedRevision:run.revision,action:'retry-quizzes',idempotencyKey:'owner-quality-retry'}));
   unwrap(await runtime.execute(run));
   assert.equal(quizDrafts,5,'Targeted retry generates one fresh draft after four exhausted attempts');
   assert.equal(pageReads,1,'Quiz retry must not reacquire source');
  }
  if(stalePhase){assert(historicalPhase);assert.deepEqual(db.prepare('SELECT * FROM knowledge_workflow_image_attempts WHERE attempt_key=?').get(historicalPhase.attempt_key),historicalPhase,'Expired duplicate phase evidence remains immutable.');}
  if(retryWindow){const attempts=db.prepare("SELECT attempt_key,output_json FROM knowledge_workflow_image_attempts WHERE attempt_key LIKE 'scraper-observe-%'").all();assert(attempts.some(a=>a.attempt_key.includes(':technical-2:')&&a.output_json!==null),'Successful retry must retain its durable result.');}
  if(resumedPage){assert.deepEqual(db.prepare("SELECT * FROM knowledge_workflow_image_attempts WHERE attempt_key='page-acquisition'").get(),historicalPageAttempt);const reads=db.prepare("SELECT * FROM knowledge_workflow_image_attempts WHERE attempt_key GLOB 'page-acquisition:*'").all();assert.equal(reads.length,1);assert(reads[0].deadline_at_ms>historicalPageAttempt.deadline_at_ms);assert.equal(reads[0].evaluations,0);assert.equal(reads[0].decoded_bytes,0);}
  const persisted=unwrap(await repository.findById(ownerId,runId));assert.equal(persisted.state,'completed');assert.equal(persisted.counts.knowledgePoints,1);assert.equal(persisted.counts.acceptedQuizzes,1);
  const rows=db.prepare('SELECT point_json FROM extraction_knowledge_points WHERE owner_id=? AND run_id=?').all(ownerId,runId);assert.equal(rows.length,1);const point=JSON.parse(rows[0].point_json);assert.equal(point.summary,block.text);assert.deepEqual(point.mediaCandidates,sessionImage==='associated'?[{visualId:image.id}]:[]);if(sessionImage==='associated'){assert.equal(storedSessionImages.length,1);const stored=storedSessionImages[0];assert.deepEqual(stored.bytes,new Uint8Array([137,80,78,71,13,10,26,10]));assert.equal(stored.sourceUrl,image.url);assert.equal(stored.knowledgeId,point.id);assert.equal(stored.binding.kind,'webpage-support');assert.equal(stored.binding.imageId,image.id);assert.equal(stored.binding.originalDigest,'sha256:'+createHash('sha256').update(stored.bytes).digest('hex'));}assert.equal(point.evidenceAnchors[0].quoteDigest,await quoteHash(block.text));
  const warnings=db.prepare('SELECT warnings_json FROM knowledge_workflow_page_image_warnings WHERE owner_id=? AND run_id=?').all(ownerId,runId);const sessionFailure={blocked:'KnowledgeBrowserImageBlocked',corrupt:'MediaUnsupportedType',mismatch:'MediaMimeSignatureConflict',oversize:'WebpageImageBytesInvalid',throw:'KnowledgeBrowserImageReadFailed'}[sessionImage];if(sessionImage!=='associated')assert(warnings.some(r=>r.warnings_json.includes(sessionFailure??(blockedImage?'MediaFetchFailed':'KnowledgeModelRejected'))&&r.warnings_json.includes('Text retained')));if(sessionImage){assert.equal(sessionImageReads,cacheResume?0:1);assert.equal(imageReads,0);}if(cacheResume)assert.deepEqual(db.prepare('SELECT * FROM knowledge_workflow_image_attempts WHERE attempt_key=?').get(`read:${image.id}`),cachedReadBefore);
  if(blockedImage){assert.equal(imageReads,1);assert.equal(textCritics,1);assert.equal(point.evidenceAnchors[0].blockId,block.id);assert.equal(db.prepare('SELECT count(*)n FROM knowledge_workflow_media_assets WHERE owner_id=? AND run_id=?').get(ownerId,runId).n,0);const before=operations.length;assert.deepEqual(await runtime.reviewCapturedCandidate({run:persisted,point:{...point,mediaCandidates:[{visualId:image.id}]},sourceEvidence:{url,blocks:[block],headings:[]},sourceMode:'image'}),{ok:false,error:{kind:'KnowledgeReviewImageUnavailable'}});assert.equal(operations.length,before,'Missing pixel-source bytes cannot fall back to caption review.');}
  if(partial){const warning=warnings.map(r=>r.warnings_json).join('');assert(warning.includes('Text extraction partial'));assert(warning.includes('WebpageCandidateInvalid'));assert(warnings.flatMap(r=>JSON.parse(r.warnings_json)).some(w=>w.includes('\"candidateIndex\":0')));}
  const library=unwrap(await new D1SourceLibraryRepository(database).knowledgeSemanticCandidates({ownerId,limit:10}));assert.equal(library.candidates.length,1);assert.equal(library.candidates[0].knowledge.summary,block.text);assert.equal(library.privateDerivedCount,0);
  assert.equal(operations.filter(o=>o==='extract-webpage-facts').length,retryWindow?2:1);assert.equal(operations.filter(o=>o==='verify-webpage-facts').length,0);assert.equal(operations.filter(o=>o==='normalize-webpage-claim-boundaries').length,1);assert.equal(operations.filter(o=>o==='match-webpage-images').length,blockedImage||sessionImage&&!['success','associated'].includes(sessionImage)?0:sessionImage==='associated'?1:4);assert(!operations.includes('verify-webpage-image'));assert(records.some(r=>r.phase==='extraction'&&r.event==='knowledge-model-success'));assert(!JSON.stringify(records).includes('PRIVATE_REASONING'));assert.equal(network,0);
 }finally{globalThis.fetch=originalFetch;db.close();}
});
