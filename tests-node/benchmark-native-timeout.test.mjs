import {syntheticAssessment,syntheticReviewAudit,auditedVerdict} from './fixtures/knowledge-review-audit.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {openReviewedBenchmark,REVIEWED_PIPELINE} from '../scripts/benchmark-reviewed-runtime.mjs';
import {createEvaluationTransport,createEstimatedRequestPlanner} from '../scripts/evaluation-budget.mjs';
import {classifyEvaluationFailure,isTerminalPipelineFailure} from '../scripts/webpage-image-evaluation.mjs';
import {createOpenRouterKnowledgeModel} from '../worker/knowledge-workflow-model.js';
import {createQuizActorCritic} from '../src/features/knowledge-workflows/quiz.js';
import {createSyntheticEvaluationFixture} from './fixtures/evaluation/synthetic.mjs';
import {readFrozenEvaluationCatalog} from './fixtures/evaluation/catalog.mjs';
// Synthetic ledger port/provider replies; actual native runtime, durable stages and counted transport.
// No paid requests or model-accuracy claim.
const ok=value=>({ok:true,value}),flush=async()=>{for(let i=0;i<20;i++)await new Promise(resolve=>setImmediate(resolve));};
const decision={authority:'Synthetic offline timer contract',source:'benchmark-native-timeout.test.mjs',decision:'TreatUSD5asestimatedbudget withautomaticstopping;acceptpossibleoveragefromoneinflightrequest'};
function ledgerPort(deadline){const rows=new Map();let cancelled=false,active=0;
 return {rows,ledger:{runtimePolicy:{maximumAdditionalRecoveries:null},accountingMode:'estimated',ownerDecision:decision,
  snapshot:()=>ok({deadlineAtMs:deadline,effectiveDeadlineAtMs:deadline,runtimeDeadlineAtMs:deadline,effectiveCancelled:cancelled,cancelled,admissionHalted:null,activeRequests:active}),
  reserve(c){rows.set(c.key,{...c,response:null});return ok(c);},complete(c){Object.assign(rows.get(c.key),c);return ok(null);},
  uncertain(c){const row=rows.get(c.key);if(row){row.uncertain=true;row.recoverable=!!(c.recoverableExternal||c.recoverableTimeout);}return {ok:false,error:{kind:c.kind}};},
  recoveryCandidate(base){const latest=[...rows.values()].filter(row=>row.key===base||row.baseKey===base).at(-1);return ok(latest?.uncertain&&latest.recoverable?{failedKey:latest.key,nextKey:base+':recovery-'+rows.size,retryAtMs:Date.now(),attempt:rows.size}:null);},
  replayResponse:()=>ok(null),pacingDue:()=>ok({retryAtMs:Date.now(),cooldown:false}),haltExecution:()=>ok(null),cancel(){cancelled=true;return ok(null);},
  trackAccounting(promise){active++;promise.then(()=>active--,()=>active--);return promise;}
 }};
}
function profilesFor(catalog){const reviewer=structuredClone(catalog);reviewer.model.id='synthetic/reviewer';reviewer.model.canonical_slug='synthetic/reviewer-v1';
 const protocol={source:'Synthetic offline native protocol',responseFormat:'json_schema',reasoningEffort:'high',receiptOptional:true,provider:{sort:'throughput',require_parameters:true,allow_fallbacks:true}},roles={'knowledge-scraper':{catalog,version:catalog.model.canonical_slug,protocol},'review-grader':{catalog:reviewer,version:reviewer.model.canonical_slug,protocol}};
 return {source:'Synthetic roles',roles,benchmarkContract:{source:'Synthetic approval',readiness:'owner-authorized-first-development-case',excludedCreators:['openai','anthropic','google','luna'],approved:Object.values(roles).map(p=>({id:p.catalog.model.id,creator:p.catalog.model.id.split('/')[0],canonicalSlug:p.version,catalogSha256:p.catalog.catalogSha256,prompt:p.catalog.model.pricing.prompt,completion:p.catalog.model.pricing.completion}))}};
}
const output={decision:'pass',reasons:['Synthetic retained text supports this claim.'],feedback:'Keep the supported relationship.',matchedLessOftenIds:[],supportingImageEvidence:'',allowTextOnly:true};
const wireTask=body=>{const raw=body.messages[1].content,envelope=Array.isArray(raw)?raw[0].text:raw;return JSON.parse(envelope.slice(envelope.indexOf('\n')+1,envelope.lastIndexOf('\n'))).task;};
const response=(model,body)=>Response.json({id:'synthetic-recovered',model,choices:[{finish_reason:'stop',message:{content:JSON.stringify(body?.response_format?.json_schema?.name==='knowledge_quality_review_v13'?syntheticAssessment(wireTask(body),output):output)}}],usage:{prompt_tokens:1,completion_tokens:1,cost:0}});
const hanging=init=>new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true}));

test('actual native critic consumes accounted recovery after finite provider timeout; one critic, no repair, durable replay',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'native-counted-recovery-')),catalog=await readFrozenEvaluationCatalog(),profiles=profilesFor(catalog),{config,corpus}=createSyntheticEvaluationFixture(),item=corpus.cases[0],port=ledgerPort(Date.now()+1800000),logs=[];
 const file='scripts/benchmark-reviewed-runtime.mjs',contract={pipelineMode:REVIEWED_PIPELINE,directory,iterationId:'synthetic',grant:{id:'synthetic'},runtimePolicy:{maximumWindowMilliseconds:1800000},sourceFiles:{[file]:createHash('sha256').update(await readFile(file)).digest('hex')}};
 let calls=0,application,signalFirstDispatch;const firstDispatch=new Promise(resolve=>{signalFirstDispatch=resolve;});t.mock.timers.enable({apis:['setTimeout']});
 try{
  application=await openReviewedBenchmark({contract,imagePolicy:config.imagePolicy,roleDependencies:{profiles,apiKey:'synthetic-offline',modelConfig:{...config.model,name:catalog.model.id,timeoutMs:60000},costPolicy:{source:'Synthetic estimate',bytesPerToken:4,visualTokensPerImage:8000},transport:{ledger:port.ledger,wait:async()=>{},fetch:async(_url,init)=>{calls++;if(calls===1){signalFirstDispatch();return hanging(init);}assert.equal(calls,2);return response(profiles.roles['review-grader'].catalog.model.id,JSON.parse(init.body));},now:Date.now,signal:new AbortController().signal,logger:e=>logs.push(e),billingMode:'estimated',ownerDecision:decision}},logger:e=>logs.push(e)});
  const {run,runtime}=await application.forCase(item),point={id:'synthetic-point',sourceId:item.id,sourceRevision:1,summary:'Synthetic relation.',normalizedHash:'synthetic',evidenceAnchors:[{url:item.input.evidence.url,selector:'p',blockId:'b',quote:'Synthetic relation.',quoteDigest:'sha256:synthetic',clause:'Synthetic relation.'}],coverageGoalIds:[],mediaCandidates:[],attribution:{sourceUrl:item.input.evidence.url},extractionVersion:'synthetic'};
  const command={run,point,sourceMode:'text',sourceEvidence:item.input.evidence},pending=runtime.reviewCapturedCandidate(command);await firstDispatch;assert.equal(calls,1);
  t.mock.timers.tick(30000);await flush();assert.equal(calls,1,'stock native 30s must not cut off counted recovery');t.mock.timers.tick(30000);await flush();
  const result=await pending;assert.equal(result.ok,true,JSON.stringify(result.error));assert.equal(result.value.point.id,point.id);assert.equal(calls,2);assert.equal(port.rows.size,2);assert.equal([...port.rows.values()].filter(r=>r.response!==null).length,1);assert.equal([...port.rows.values()][0].response,null);
  assert.equal(logs.filter(e=>e.event==='knowledge-model-success').length,1);assert.equal(logs.filter(e=>e.event==='knowledge-model-failure').length,0);
  assert.deepEqual(await runtime.reviewCapturedCandidate(command),result);assert.equal(calls,2,'completed critic must replay without another semantic attempt');
 }finally{t.mock.timers.reset();await application?.close();await rm(directory,{recursive:true,force:true});}
});
for(const reason of ['hard-caller','owner-cancel','window'])test(`transport honors ${reason} without replacing logical signals or dispatching recovery`,async t=>{
 const catalog=await readFrozenEvaluationCatalog(),profiles=profilesFor(catalog);t.mock.timers.enable({apis:['setTimeout','Date']});
 const port=ledgerPort(Date.now()+100000),controller=new AbortController(),owner=new AbortController();let calls=0;
 const transport=createEvaluationTransport({ledger:port.ledger,catalog,model:catalog.model.id,endpoint:'https://openrouter.ai/api/v1/chat/completions',iterationId:'synthetic',fetch:async(_url,init)=>{calls++;return hanging(init);},now:Date.now,signal:owner.signal,logger:()=>{},billingMode:'estimated',ownerDecision:decision,requestPlanner:createEstimatedRequestPlanner({metadata:catalog,costPolicy:{source:'Synthetic estimate',bytesPerToken:4,visualTokensPerImage:8000},sourceContract:decision,now:Date.now}),benchmarkContract:profiles.benchmarkContract,requestTimeoutMs:reason==='window'?200000:60000});
 try{
  const pending=transport('https://openrouter.ai/api/v1/chat/completions',{method:'POST',body:JSON.stringify({model:catalog.model.id,messages:[{role:'user',content:'Synthetic input'}],max_tokens:16,response_format:{type:'json_object'}}),signal:controller.signal}).then(value=>({value}),error=>({error}));await flush();assert.equal(calls,1);
  if(reason==='hard-caller')controller.abort(new DOMException('Hard native operation deadline','TimeoutError'));else if(reason==='owner-cancel')owner.abort();else t.mock.timers.tick(100000);
  await flush();const result=await pending;assert(result.error);assert.equal(result.error.notStarted,false,'any prior accounting reserve protects the logical call');assert.equal(calls,1);assert.equal(port.rows.size,1);assert.equal([...port.rows.values()][0].response,null);
  if(reason==='hard-caller')assert.equal(result.error.failure.field,'caller-deadline-expired');if(reason==='owner-cancel')assert.equal(result.error.failure.kind,'EvaluationCancelled');
 }finally{t.mock.timers.reset();}
});
test('known stage causes retain ownership; bare uncertain stage remains unproven pipeline failure',()=>{
 const idle={activeRequests:0,admissionHalted:null,cancelled:false};
 for(const kind of ['KnowledgeModelTimeout','KnowledgeModelUnavailable','KnowledgeModelResponseReadFailed']){assert.equal(classifyEvaluationFailure({kind:'WorkflowStageCallUncertain',causeKind:kind}),'external');assert.equal(isTerminalPipelineFailure({kind:'WorkflowStageCallUncertain',causeKind:kind},idle),false);}
 assert.equal(classifyEvaluationFailure({kind:'WorkflowStageCallUncertain'}),'pipeline');assert.equal(classifyEvaluationFailure({kind:'WorkflowStageCallUncertain',causeKind:'KnowledgeModelResponseInvalid'}),'pipeline');assert.equal(classifyEvaluationFailure({kind:'WorkflowStageCallUncertain',causeKind:'EvaluationBudgetExceeded'}),'stop');
});

for(const role of ['generator','evaluator'])test(`quiz ${role} preserves deepest known stage cause without regenerating, discarding or publishing`,async()=>{
 const point={id:'point',sourceId:'source',sourceRevision:1,summary:'Synthetic relationship.',normalizedHash:'synthetic',evidenceAnchors:[{url:'https://synthetic.invalid/',selector:'p'}]},draft={id:'draft',knowledgeId:'point',knowledgeRevision:1,kind:'single-choice',prompt:'Which relationship?',options:['One','Two'],answer:'One',citedEvidenceUrls:['https://synthetic.invalid/']};
 const error={kind:'WorkflowStageCallUncertain',causeKind:'KnowledgeModelTimeout'},effects=[];let generated=0,evaluated=0;
 const actor=createQuizActorCritic({maxAttempts:2,technicalRetries:false,now:()=> '2026-10-09T00:00:00Z',logger:()=>{},generator:{generate:async()=>{generated++;return role==='generator'?{ok:false,error}:ok(draft);}},reviewer:{evaluate:async()=>{evaluated++;return {ok:false,error};}},repository:{findPublished:async()=>ok(null),appendAttempt:async()=>{effects.push('attempt');return ok(null);},publish:async()=>{effects.push('publish');return ok(null);},discard:async()=>{effects.push('discard');return ok(null);},purge:async()=>ok(null)}});
 const result=await actor.run({ownerId:'owner',runId:'run',points:[point]});assert.deepEqual(result,{ok:false,error:{kind:'WorkflowStageCallUncertain',causeKind:'KnowledgeModelTimeout'}});assert.equal(classifyEvaluationFailure(result.error),'external');assert.equal(generated,1);assert.equal(evaluated,role==='evaluator'?1:0);assert.deepEqual(effects,[]);
});
test('saved failure mechanism reproduces: legacy physical signal renewal returns HTTP200 but native expired timer rejects it',async t=>{
 const catalog=await readFrozenEvaluationCatalog(),profiles=profilesFor(catalog),port=ledgerPort(Date.now()+1800000),logs=[];let calls=0;t.mock.timers.enable({apis:['setTimeout']});
 try{
  const transport=createEvaluationTransport({ledger:port.ledger,catalog,model:catalog.model.id,endpoint:'https://openrouter.ai/api/v1/chat/completions',iterationId:'synthetic',fetch:async(_url,init)=>{calls++;return calls===1?hanging(init):response(catalog.model.id);},now:Date.now,signal:new AbortController().signal,logger:e=>logs.push(e),billingMode:'estimated',ownerDecision:decision,wait:async()=>{},requestPlanner:createEstimatedRequestPlanner({metadata:catalog,costPolicy:{source:'Synthetic estimate',bytesPerToken:4,visualTokensPerImage:8000},sourceContract:decision,now:Date.now}),benchmarkContract:profiles.benchmarkContract});
  const model=createOpenRouterKnowledgeModel({apiKey:'synthetic',endpoint:'https://openrouter.ai/api/v1/chat/completions',model:catalog.model.id,timeoutMs:30000,maximumInputCharacters:10000,fetch:transport,now:Date.now,logger:e=>logs.push(e)});
  const pending=model.generate({role:'question-evaluator',systemPrompt:'Synthetic critic',input:{synthetic:true},maxOutputTokens:16});await flush();assert.equal(calls,1);t.mock.timers.tick(30000);await flush();
  assert.deepEqual(await pending,{ok:false,error:{kind:'KnowledgeModelTimeout'}});assert.equal(calls,2);assert.equal(logs.filter(e=>e.event==='evaluation-transport-success').length,1);assert.equal([...port.rows.values()].filter(row=>row.response!==null).length,1);
 }finally{t.mock.timers.reset();}
});

test('actual native no-image revise with allowTextOnly=false performs one quoted repair and two critics; replay unchanged',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'native-counted-repair-')),catalog=await readFrozenEvaluationCatalog(),profiles=profilesFor(catalog),{config,corpus}=createSyntheticEvaluationFixture(),item=corpus.cases[0],port=ledgerPort(Date.now()+1800000),logs=[],calls=[];
 const file='scripts/benchmark-reviewed-runtime.mjs',contract={pipelineMode:REVIEWED_PIPELINE,directory,iterationId:'synthetic',grant:{id:'synthetic'},runtimePolicy:{maximumWindowMilliseconds:1800000},sourceFiles:{[file]:createHash('sha256').update(await readFile(file)).digest('hex')}};
 const repair={summary:'Synthetic supported relation.',coverageGoalIds:[],useSupportingImage:false,evidenceClauses:['Synthetic supported relation.']};let application;
 try{
  application=await openReviewedBenchmark({contract,imagePolicy:config.imagePolicy,roleDependencies:{profiles,apiKey:'synthetic-offline',modelConfig:{...config.model,name:catalog.model.id,timeoutMs:60000},costPolicy:{source:'Synthetic estimate',bytesPerToken:4,visualTokensPerImage:8000},transport:{ledger:port.ledger,wait:async()=>{},fetch:async(_url,init)=>{
   const body=JSON.parse(init.body),schema=body.response_format.json_schema.name;calls.push(schema);const raw=body.messages[1].content,envelope=Array.isArray(raw)?raw[0].text:raw,task=JSON.parse(envelope.slice(envelope.indexOf('\n')+1,envelope.lastIndexOf('\n'))).task;
   let value;
   if(schema==='knowledge_quality_repair_v1'){assert.equal(calls.length,2);assert.equal(body.model,catalog.model.id);assert.equal(body.response_format.json_schema.schema.properties.evidenceClauses.maxItems,1);assert.equal(task.knowledge.evidenceAnchors[0].quote,'Synthetic supported relation.');assert.equal(task.sourceMode,'text');assert.deepEqual(task.knowledge.mediaCandidates,[]);assert.equal(task.review.allowTextOnly,false);assert.match(body.messages[0].content,/no original mediaCandidates, set useSupportingImage=false/);assert.match(body.messages[0].content,/this does not require allowTextOnly permission/);value=repair;}
   else{assert.equal(schema,'knowledge_quality_review_v13');assert.equal(body.model,profiles.roles['review-grader'].catalog.model.id);if(calls.length===1)value={...output,decision:'revise',allowTextOnly:false,feedback:'Narrow the summary to the retained quote.'};else{assert.equal(calls.length,3);assert.deepEqual(task.knowledge.mediaCandidates,[]);assert.equal(task.knowledge.summary,repair.summary);assert.equal(task.knowledge.evidenceAnchors[0].quote,'Synthetic supported relation.');value=output;}}
   if(schema==='knowledge_quality_review_v13')value=syntheticAssessment(task,value);
   return Response.json({id:'synthetic-repair-sequence-'+calls.length,model:body.model,choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}],usage:{prompt_tokens:1,completion_tokens:1,cost:0}});
  },now:Date.now,signal:new AbortController().signal,logger:e=>logs.push(e),billingMode:'estimated',ownerDecision:decision}},logger:e=>logs.push(e)});
  const {run,runtime}=await application.forCase(item),point={id:'synthetic-point',sourceId:item.id,sourceRevision:1,summary:'Synthetic relation and unsupported expansion.',normalizedHash:'synthetic',evidenceAnchors:[{url:item.input.evidence.url,selector:'p',blockId:'b',quote:'Synthetic supported relation.',quoteDigest:'sha256:synthetic',clause:'Synthetic relation and unsupported expansion.'}],coverageGoalIds:[],mediaCandidates:[],attribution:{sourceUrl:item.input.evidence.url},extractionVersion:'synthetic'},command={run,point,sourceMode:'text',sourceEvidence:item.input.evidence};
  const result=await runtime.reviewCapturedCandidate(command);assert.equal(result.ok,true,JSON.stringify(result.error));assert.notEqual(result.value,null);assert.equal(result.value.point.summary,repair.summary);assert.deepEqual(result.value.point.mediaCandidates,[]);assert.equal(result.value.point.evidenceAnchors[0].quoteDigest,point.evidenceAnchors[0].quoteDigest);assert.deepEqual(calls,['knowledge_quality_review_v13','knowledge_quality_repair_v1','knowledge_quality_review_v13']);assert.equal(port.rows.size,3);assert.equal(logs.filter(e=>e.event==='knowledge-model-success').length,3);assert.equal(logs.filter(e=>e.event==='knowledge-model-failure').length,0);
  assert.deepEqual(await runtime.reviewCapturedCandidate(command),result);assert.equal(calls.length,3);assert.equal(port.rows.size,3,'completed review adds neither semantic attempts nor provider reservations');
 }finally{await application?.close();await rm(directory,{recursive:true,force:true});}
});

// Exact typed transport exceptions traverse actual model, harness and nested durable stages.
for(const fence of ['window','cancelled','accounting','budget'])test(`actual benchmark native critic preserves ${fence} fence without provider dispatch or claimed-stage redispatch`,async()=>{
 const directory=await mkdtemp(join(tmpdir(),'native-fence-')),catalog=await readFrozenEvaluationCatalog(),profiles=profilesFor(catalog),{config,corpus}=createSyntheticEvaluationFixture(),item=corpus.cases[0],port=ledgerPort(Date.now()+1800000);let calls=0,application;
 const snapshot=port.ledger.snapshot;port.ledger.snapshot=()=>{const result=snapshot();if(fence==='window')result.value.effectiveDeadlineAtMs=Date.now()-1;if(fence==='cancelled')result.value.effectiveCancelled=true;if(fence==='accounting')result.value.admissionHalted='EvaluationTransportUncertain';return result;};
 if(fence==='budget'){const reserve=port.ledger.reserve;let reservations=0;port.ledger.reserve=c=>++reservations>=2?{ok:false,error:{kind:'EvaluationBudgetExceeded',field:'cost'}}:reserve(c);}
 const file='scripts/benchmark-reviewed-runtime.mjs',contract={pipelineMode:REVIEWED_PIPELINE,directory,iterationId:'synthetic',grant:{id:'synthetic'},runtimePolicy:{maximumWindowMilliseconds:1800000},sourceFiles:{[file]:createHash('sha256').update(await readFile(file)).digest('hex')}};
 try{
  application=await openReviewedBenchmark({contract,imagePolicy:config.imagePolicy,roleDependencies:{profiles,apiKey:'synthetic-offline',modelConfig:{...config.model,name:catalog.model.id,timeoutMs:60000},costPolicy:{source:'Synthetic estimate',bytesPerToken:4,visualTokensPerImage:8000},transport:{ledger:port.ledger,wait:async()=>{},fetch:async(_url,init)=>{calls++;assert.equal(fence,'budget');assert.equal(calls,1);return Response.json({id:'synthetic-first-critic',model:profiles.roles['review-grader'].catalog.model.id,choices:[{finish_reason:'stop',message:{content:JSON.stringify(syntheticAssessment(wireTask(JSON.parse(init.body)),{...output,decision:'revise'}))}}],usage:{prompt_tokens:1,completion_tokens:1,cost:0}});},now:Date.now,signal:new AbortController().signal,logger:()=>{},billingMode:'estimated',ownerDecision:decision}},logger:()=>{}});
  const {run,runtime}=await application.forCase(item),point={id:'synthetic-point',sourceId:item.id,sourceRevision:1,summary:'Synthetic relation.',normalizedHash:'synthetic',evidenceAnchors:[{url:item.input.evidence.url,selector:'p',blockId:'b',quote:'Synthetic relation.',quoteDigest:'sha256:synthetic',clause:'Synthetic relation.'}],coverageGoalIds:[],mediaCandidates:[],attribution:{sourceUrl:item.input.evidence.url},extractionVersion:'synthetic'},command={run,point,sourceMode:'text',sourceEvidence:item.input.evidence};
  const {EvaluationTransportFailure}=await import('../scripts/evaluation-budget.mjs'),expected={window:'EvaluationDeadlineExceeded',cancelled:'EvaluationCancelled',accounting:'EvaluationAccountingHalted',budget:'EvaluationBudgetExceeded'}[fence];
  const check=error=>{assert(error instanceof EvaluationTransportFailure);assert.equal(error.name,'EvaluationTransportFailure');assert.equal(error.failure.kind,expected);assert.equal(classifyEvaluationFailure(error.failure),'stop');if(fence==='budget')assert.equal(error.failure.field,'cost');return true;};
  if(fence==='budget'){
   const {createSyntheticSelectedEvaluationFixture}=await import('./fixtures/evaluation/synthetic-selected.mjs'),{createEvaluationLedger}=await import('../scripts/evaluation-budget.mjs'),{runEvaluation}=await import('../scripts/webpage-image-evaluation.mjs'),{DatabaseSync}=await import('node:sqlite'),fixture=createSyntheticSelectedEvaluationFixture(),db=new DatabaseSync(':memory:');
   const outerDecision={authority:'Synthetic offline execution',source:'benchmark-native-timeout.test.mjs',decision:'TreatUSD1asestimatedbudget withautomaticstopping;acceptpossibleoveragefromoneinflightrequest'},ledger=createEvaluationLedger({database:db,budgetId:'owner-approved-image-benchmark',policy:fixture.config.budget,now:()=>1000,logger:()=>{},accountingMode:'estimated',ownerDecision:outerDecision});
   try{
    const result=await runEvaluation({...fixture,catalog,ledger,mode:'estimated',ownerDecision:outerDecision,iterationId:'synthetic',now:()=>1000,logger:()=>{},signal:new AbortController().signal,requestPlanner:async()=>assert.fail('No outer paid planning'),database:{prepare:()=>assert.fail('No outer application DB')},scope:{ownerId:'synthetic',runId:'synthetic'},allowNetwork:true,budgetAuthorized:true,apiKey:'synthetic-offline',fetch:async()=>assert.fail('No outer provider request'),reviewedApplication:{extract:async()=>{try{return await runtime.reviewCapturedCandidate(command);}catch(error){check(error);throw error;}}}});
    assert.equal(result.ok,true,JSON.stringify(result.error));assert.equal(result.value.status,'incomplete');assert.deepEqual(result.value.stopReason,{kind:'EvaluationBudgetExceeded',field:'cost'});assert(result.value.wholeCaseReport.rows.every(row=>row.status==='unattempted'));assert.equal(ledger.snapshot().value.requests,0);
   }finally{db.close();}
  }else await assert.rejects(runtime.reviewCapturedCandidate(command),check);
  assert.equal(calls,fence==='budget'?1:0);assert.equal(port.rows.size,fence==='budget'?1:0);
  if(fence==='budget')assert.deepEqual(await runtime.reviewCapturedCandidate(command),{ok:false,error:{kind:'WorkflowStageCallUncertain',attempts:1,technicalAttempts:1,technicalRetriesExhausted:true}},'scraper local attempt reservation also protects the claim');else{await assert.rejects(runtime.reviewCapturedCandidate(command),check);await assert.rejects(runtime.reviewCapturedCandidate(command),check);}
  assert.equal(calls,fence==='budget'?1:0);assert.equal(port.rows.size,fence==='budget'?1:0);
 }finally{await application?.close();await rm(directory,{recursive:true,force:true});}
});

test('malformed model JSON remains a terminal pipeline failure through the actual benchmark native path',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'native-invalid-json-')),catalog=await readFrozenEvaluationCatalog(),profiles=profilesFor(catalog),{config,corpus}=createSyntheticEvaluationFixture(),item=corpus.cases[0],port=ledgerPort(Date.now()+1800000);let calls=0,application;
 const file='scripts/benchmark-reviewed-runtime.mjs',contract={pipelineMode:REVIEWED_PIPELINE,directory,iterationId:'synthetic',grant:{id:'synthetic'},runtimePolicy:{maximumWindowMilliseconds:1800000},sourceFiles:{[file]:createHash('sha256').update(await readFile(file)).digest('hex')}};
 try{
  application=await openReviewedBenchmark({contract,imagePolicy:config.imagePolicy,roleDependencies:{profiles,apiKey:'synthetic-offline',modelConfig:{...config.model,name:catalog.model.id,timeoutMs:60000},costPolicy:{source:'Synthetic estimate',bytesPerToken:4,visualTokensPerImage:8000},transport:{ledger:port.ledger,wait:async()=>{},fetch:async()=>{calls++;return Response.json({id:'synthetic-invalid',model:profiles.roles['review-grader'].catalog.model.id,choices:[{finish_reason:'stop',message:{content:'{broken'}}],usage:{prompt_tokens:1,completion_tokens:1,cost:0}});},now:Date.now,signal:new AbortController().signal,logger:()=>{},billingMode:'estimated',ownerDecision:decision}},logger:()=>{}});
  const {run,runtime}=await application.forCase(item),point={id:'synthetic-point',sourceId:item.id,sourceRevision:1,summary:'Synthetic relation.',normalizedHash:'synthetic',evidenceAnchors:[{url:item.input.evidence.url,selector:'p',blockId:'b',quote:'Synthetic relation.',quoteDigest:'sha256:synthetic',clause:'Synthetic relation.'}],coverageGoalIds:[],mediaCandidates:[],attribution:{sourceUrl:item.input.evidence.url},extractionVersion:'synthetic'},command={run,point,sourceMode:'text',sourceEvidence:item.input.evidence};
  const result=await runtime.reviewCapturedCandidate(command);assert.deepEqual(result,{ok:false,error:{kind:'KnowledgeModelResponseInvalid',field:'message.content.json',attempts:1,technicalAttempts:1,technicalRetriesExhausted:true}});assert.equal(classifyEvaluationFailure(result.error),'pipeline');assert.equal(calls,1);assert.equal(port.rows.size,1);assert.deepEqual(await runtime.reviewCapturedCandidate(command),result);assert.equal(calls,1);
 }finally{await application?.close();await rm(directory,{recursive:true,force:true});}
});

import {openPositiveStorage} from '../scripts/architecture-live-positive.mjs';
import {D1WorkflowStageRepository} from '../worker/knowledge-workflow-stages-d1.js';
import {createKnowledgeWorkflowAgentRuntime} from '../worker/knowledge-workflow-agent-runtime.js';
import {createAgentMemoryStore} from '../src/features/knowledge-workflows/memory.js';
import {createAgentConfigurationLoader} from '../src/features/knowledge-workflows/config.js';
import {EvaluationTransportFailure} from '../scripts/evaluation-budget.mjs';
import {AgentExecutionBoundaryFailure} from '../src/features/knowledge-workflows/harness.js';

async function nativeFixture(){
 const directory=await mkdtemp(join(tmpdir(),'native-preflight-claim-')),catalog=await readFrozenEvaluationCatalog(),profiles=profilesFor(catalog),{config,corpus}=createSyntheticEvaluationFixture(),item=corpus.cases[0],port=ledgerPort(Date.now()+1800000);
 const file='scripts/benchmark-reviewed-runtime.mjs',contract={pipelineMode:REVIEWED_PIPELINE,directory,iterationId:'synthetic',grant:{id:'synthetic'},runtimePolicy:{maximumWindowMilliseconds:1800000},sourceFiles:{[file]:createHash('sha256').update(await readFile(file)).digest('hex')}};
 const point={id:'synthetic-point',sourceId:item.id,sourceRevision:1,summary:'Synthetic relation.',normalizedHash:'synthetic',evidenceAnchors:[{url:item.input.evidence.url,selector:'p',blockId:'b',quote:'Synthetic relation.',quoteDigest:'sha256:synthetic',clause:'Synthetic relation.'}],coverageGoalIds:[],mediaCandidates:[],attribution:{sourceUrl:item.input.evidence.url},extractionVersion:'synthetic'};
 return {directory,catalog,profiles,config,item,port,contract,point};
}
test('actual native first critic preflight has zero accounting, retains not-started history and resumes with exactly one critic',async()=>{
 const f=await nativeFixture();let application,storage,calls=0,expired=true;
 const snapshot=f.port.ledger.snapshot;f.port.ledger.snapshot=()=>{const value=snapshot();if(expired)value.value.effectiveDeadlineAtMs=Date.now()-1;return value;};
 const dependencies={profiles:f.profiles,apiKey:'synthetic-offline',modelConfig:{...f.config.model,name:f.catalog.model.id,timeoutMs:60000},costPolicy:{source:'Synthetic estimate',bytesPerToken:4,visualTokensPerImage:8000},transport:{ledger:f.port.ledger,wait:async()=>{},fetch:async(_url,init)=>{calls++;return response(JSON.parse(init.body).model,JSON.parse(init.body));},now:Date.now,signal:new AbortController().signal,logger:()=>{},billingMode:'estimated',ownerDecision:decision}};
 try{
  application=await openReviewedBenchmark({contract:f.contract,imagePolicy:f.config.imagePolicy,roleDependencies:dependencies});let {run,runtime}=await application.forCase(f.item);const command={run,point:f.point,sourceMode:'text',sourceEvidence:f.item.input.evidence};
  await assert.rejects(runtime.reviewCapturedCandidate(command),error=>error instanceof EvaluationTransportFailure&&error.notStarted===true&&error.failure.kind==='EvaluationDeadlineExceeded');assert.equal(calls,0);assert.equal(f.port.rows.size,0);
  storage=await openPositiveStorage({directory:application.directory});let child=storage.sqlite.prepare("SELECT * FROM knowledge_workflow_stages WHERE run_id=? AND stage_key LIKE 'question-evaluator:knowledge-quality-%'").get(run.runId);
  assert.equal(child.status,'not-started');assert.equal(child.provider_failures,0);assert.deepEqual(JSON.parse(child.failures_json).map(x=>({kind:x.failure.kind,notStarted:x.notStarted})),[{kind:'EvaluationDeadlineExceeded',notStarted:true}]);const identity={key:child.stage_key,digest:child.input_digest,createdAt:child.created_at};
  await assert.rejects(runtime.reviewCapturedCandidate(command),error=>error instanceof EvaluationTransportFailure&&error.notStarted===true);assert.equal(calls,0);assert.equal(f.port.rows.size,0);
  await application.close();expired=false;application=await openReviewedBenchmark({contract:f.contract,imagePolicy:f.config.imagePolicy,roleDependencies:dependencies});({runtime}=await application.forCase(f.item));
  const accepted=await runtime.reviewCapturedCandidate(command);assert.equal(accepted.ok,true,JSON.stringify(accepted.error));assert(accepted.value);assert.equal(calls,1);assert.equal(f.port.rows.size,1);
  child=storage.sqlite.prepare('SELECT * FROM knowledge_workflow_stages WHERE stage_key=?').get(identity.key);assert.equal(child.status,'completed');assert.equal(child.input_digest,identity.digest);assert.equal(child.created_at,identity.createdAt);assert.equal(child.provider_failures,0);assert.equal(JSON.parse(child.failures_json).length,2);
  assert.deepEqual(await runtime.reviewCapturedCandidate(command),accepted);assert.equal(calls,1,'completed critic must replay without a second semantic attempt');
 }finally{await application?.close();await storage?.close();await rm(f.directory,{recursive:true,force:true});}
});
for(const previousCalls of [0,1,2])test(`whole native model work protects prior ${previousCalls} compaction calls before a zero-start fence`,async()=>{
 const f=await nativeFixture();let application,storage;
 try{
  application=await openReviewedBenchmark({contract:f.contract,imagePolicy:f.config.imagePolicy,roleDependencies:{profiles:f.profiles,apiKey:null,modelConfig:f.config.model,transport:{fetch:async()=>assert.fail('No paid request')},costPolicy:{source:'Synthetic estimate',bytesPerToken:4,visualTokensPerImage:8000}}});const {run}=await application.forCase(f.item);storage=await openPositiveStorage({directory:application.directory});
  const namespaces=new Map(),records=new Map(),memory=createAgentMemoryStore({repository:{findNamespace:async id=>namespaces.get(id)??null,createNamespace:async namespace=>{namespaces.set(namespace.id,namespace);records.set(namespace.id,[]);return null;},appendRecord:async record=>{records.get(record.namespaceId).push(record);return null;},listRecords:async id=>records.get(id)??[],appendHandoff:async()=>null},now:()=>new Date().toISOString(),logger:()=>{}});
  const loader=createAgentConfigurationLoader({sha256:async value=>'sha256:'+createHash('sha256').update(value).digest('hex')}),configSnapshots={};for(const role of ['rights-assessor','knowledge-scraper','question-generator','question-evaluator'])configSnapshots[role]=(await loader.load({source:await readFile('agent-config/'+role+'.yaml','utf8'),expectedRole:role})).value;
  const original=new EvaluationTransportFailure({kind:'EvaluationDeadlineExceeded',field:'synthetic-pre-reserve'});original.notStarted=true;let calls=0;
  const runtime=createKnowledgeWorkflowAgentRuntime({model:{generate:async input=>{calls++;if(input.input.operation==='compact-working-context')return ok({output:{summary:'Synthetic completed summary.'},inputTokens:1,outputTokens:1,reasoningTrace:null});throw original;}},memory,eventLedger:{append:async()=>null},compactor:{compact:async command=>{for(let i=0;i<previousCalls;i++)assert.equal((await command.summarize({role:command.role,context:command.context,coveredTurnIds:[],maxOutputTokens:16})).ok,true);return ok({status:'unchanged',context:command.context,record:null});}},configSnapshots,now:()=>new Date().toISOString(),logger:()=>{}});
  const stages=new D1WorkflowStageRepository({database:storage.database,now:()=>new Date().toISOString()});await assert.rejects(stages.run(run,'synthetic-whole-model','digest',()=>runtime.run({ownerId:run.ownerId,runId:run.runId,role:'question-evaluator',taskId:'synthetic',systemPrompt:'Synthetic',input:{},maxOutputTokens:16}),{modelCall:true}),error=>error===original&&error.notStarted===(previousCalls===0));
  assert.equal(calls,previousCalls+1);assert.equal(storage.sqlite.prepare("SELECT status FROM knowledge_workflow_stages WHERE stage_key='synthetic-whole-model'").get().status,previousCalls===0?'not-started':'claimed');
 }finally{await application?.close();await storage?.close();await rm(f.directory,{recursive:true,force:true});}
});
test('preexisting claimed native call cannot be released by a zero-start recovery fence or shape-like error',async()=>{
 const f=await nativeFixture();let application,storage;
 try{
  application=await openReviewedBenchmark({contract:f.contract,imagePolicy:f.config.imagePolicy,roleDependencies:{profiles:f.profiles,apiKey:null,modelConfig:f.config.model,transport:{fetch:async()=>assert.fail('No paid request')},costPolicy:{source:'Synthetic estimate',bytesPerToken:4,visualTokensPerImage:8000}}});const {run}=await application.forCase(f.item);storage=await openPositiveStorage({directory:application.directory});const stages=new D1WorkflowStageRepository({database:storage.database,now:()=>new Date().toISOString()});
  const original=new EvaluationTransportFailure({kind:'EvaluationDeadlineExceeded'});await assert.rejects(stages.run(run,'prior-claim','digest',async()=>{throw original;},{modelCall:true}),error=>error===original);
  original.notStarted=true;await assert.rejects(stages.run(run,'prior-claim','digest',async()=>{throw original;},{modelCall:true,recoverClaimed:async()=>true}),error=>error===original);
  assert.equal(storage.sqlite.prepare("SELECT status FROM knowledge_workflow_stages WHERE stage_key='prior-claim'").get().status,'claimed');
  const invalid=new EvaluationTransportFailure({kind:'EvaluationProviderError'});invalid.notStarted=true;await assert.rejects(stages.run(run,'non-fence','digest',async()=>{throw invalid;},{modelCall:true}),error=>error===invalid);assert.equal(storage.sqlite.prepare("SELECT status FROM knowledge_workflow_stages WHERE stage_key='non-fence'").get().status,'claimed');
  const saveError=new Error('Synthetic persistence rejection'),failingDatabase={prepare(sql){const statement=storage.database.prepare(sql);if(sql.includes("SET status='not-started'"))return {bind(){return {run:async()=>{throw saveError;}}}};return statement;}},failingStages=new D1WorkflowStageRepository({database:failingDatabase,now:()=>new Date().toISOString()}),unsaved=new EvaluationTransportFailure({kind:'EvaluationDeadlineExceeded'});unsaved.notStarted=true;
  await assert.rejects(failingStages.run(run,'unsaved','digest',async()=>{throw unsaved;},{modelCall:true}),error=>error===unsaved&&error.notStarted===false&&error.cause.message==='WorkflowStagePersistenceFailed'&&error.cause.cause===saveError);assert.equal(storage.sqlite.prepare("SELECT status FROM knowledge_workflow_stages WHERE stage_key='unsaved'").get().status,'claimed');
  const shape=Object.assign(new Error('synthetic'),{notStarted:true,failure:{kind:'EvaluationDeadlineExceeded'}});assert.deepEqual(await stages.run(run,'shape','digest',async()=>{throw shape;},{modelCall:true}),{ok:false,error:{kind:'WorkflowStageCallUncertain'}});assert.equal(storage.sqlite.prepare("SELECT status FROM knowledge_workflow_stages WHERE stage_key='shape'").get().status,'claimed');
 }finally{await application?.close();await storage?.close();await rm(f.directory,{recursive:true,force:true});}
});
test('actual paired-quiz native allowance accommodates reasoning and equivalent Unicode aliases publish within one attempt',async()=>{
 const f=await nativeFixture();let application,storage,generators=0,critics=0;const bodies=[];
 try{
  application=await openReviewedBenchmark({contract:f.contract,imagePolicy:f.config.imagePolicy,roleDependencies:{profiles:f.profiles,apiKey:'synthetic-offline',modelConfig:{...f.config.model,name:f.catalog.model.id,timeoutMs:60000},costPolicy:{source:'Synthetic estimate',bytesPerToken:4,visualTokensPerImage:8000},transport:{ledger:f.port.ledger,wait:async()=>{},fetch:async(_url,init)=>{
   const body=JSON.parse(init.body),schema=body.response_format.json_schema.name,raw=body.messages[1].content,envelope=Array.isArray(raw)?raw[0].text:raw,task=JSON.parse(envelope.slice(envelope.indexOf('\n')+1,envelope.lastIndexOf('\n'))).task;bodies.push(body);let value=output;
   if(schema==='paired_quiz_v3'){
    generators++;assert.equal(body.max_tokens,16384,'native paired quiz receives the existing structured-material allowance');if(generators===2){assert.equal(task.attempt,2);assert.match(task.feedback,/Unicode NFKC normalization/);assert.match(task.feedback,/case folding and collapsing whitespace/);assert.match(task.feedback,/variants are duplicates/);}else{assert.equal(task.attempt,1);assert.equal(task.feedback,null);}
    const p=task.knowledge;value={knowledgeId:p.id,knowledgeRevision:1,canonicalAnswers:['relation'],citedEvidenceUrls:[f.item.input.evidence.url],multipleChoice:{prompt:'Which synthetic concept?',options:[{key:'A',text:'relation'},{key:'B',text:'unrelated'}],correctOptionKeys:['A'],correctOptionAnswers:[{key:'A',canonicalAnswer:'relation'}],explanation:'The synthetic quote supports relation.'},fillBlank:{prompt:'The synthetic concept is ____.',blanks:[{id:'blank-1',canonicalAnswer:'relation',acceptedAnswers:generators===1?['relation','ＲＥＬＡＴＩＯＮ']:['relation']}],explanation:'The retained quote supports relation.'}};
   }else if(schema==='quiz_evaluation_v3'){critics++;assert.equal(body.max_tokens,2048);value={score:9,reasons:['Synthetic supported question.'],feedback:'Keep this source-bound question.',groundingProblems:[],knowledgeGroundingProblems:[]};}else {assert.equal(schema,'knowledge_quality_review_v13');value=syntheticAssessment(task,value);}
   // Constructed token counts demonstrate integration headroom, not actual model success.
   return Response.json({id:'synthetic-headroom-'+bodies.length,model:body.model,choices:[{finish_reason:schema==='paired_quiz_v3'&&body.max_tokens<3000?'length':'stop',message:{content:JSON.stringify(value)}}],usage:{prompt_tokens:1,completion_tokens:schema==='paired_quiz_v3'?3000:1,cost:0}});
  },now:Date.now,signal:new AbortController().signal,logger:()=>{},billingMode:'estimated',ownerDecision:decision}}});
  const candidate={summary:f.point.summary,normalizedHash:f.point.normalizedHash,evidenceAnchors:f.point.evidenceAnchors,coverageGoalIds:[],mediaCandidates:[]};assert.equal((await application.accept({item:f.item,candidate,sourceEvidence:f.item.input.evidence})).ok,true);
  const result=await application.quiz(f.item);assert.equal(result.ok,true,JSON.stringify(result.error));assert.equal(result.value.outputs.length,1);assert.equal(result.value.outputs[0].attempt,1);assert.equal(generators,1);assert.equal(critics,1);
  storage=await openPositiveStorage({directory:application.directory});const failures=storage.sqlite.prepare('SELECT failure_kind FROM knowledge_workflow_quiz_retry_attempts').all();assert.deepEqual(failures.map(x=>x.failure_kind),[null]);
 }finally{await application?.close();await storage?.close();await rm(f.directory,{recursive:true,force:true});}
});

import {createContextCompactor} from '../src/features/knowledge-workflows/context.js';
for(const stopInSummary of [true,false])test(`actual context compactor preserves typed fence and whole-work proof when stopInSummary=${stopInSummary}`,async()=>{
 const f=await nativeFixture();let application,storage;
 try{
  application=await openReviewedBenchmark({contract:f.contract,imagePolicy:f.config.imagePolicy,roleDependencies:{profiles:f.profiles,apiKey:null,modelConfig:f.config.model,transport:{fetch:async()=>assert.fail('No paid request')},costPolicy:{source:'Synthetic estimate',bytesPerToken:4,visualTokensPerImage:8000}}});const {run}=await application.forCase(f.item);storage=await openPositiveStorage({directory:application.directory});
  const namespaces=new Map(),records=new Map(),memory=createAgentMemoryStore({repository:{findNamespace:async id=>namespaces.get(id)??null,createNamespace:async ns=>{namespaces.set(ns.id,ns);records.set(ns.id,[]);return null;},appendRecord:async record=>{records.get(record.namespaceId).push(record);return null;},listRecords:async id=>records.get(id)??[],appendHandoff:async()=>null},now:()=>new Date().toISOString(),logger:()=>{}});
  const ns=await memory.createNamespace({ownerId:run.ownerId,runId:run.runId,role:'question-evaluator'});assert(ns.ok);assert.equal((await memory.appendRecord(ns.value,{id:'synthetic-prior-working',kind:'working-memory',visibility:'private',retention:'run',integrityVersion:1,sourceEventId:'synthetic-prior-event',payload:{notes:'A synthetic completed prior concept.'}})).ok,true);
  const loader=createAgentConfigurationLoader({sha256:async value=>'sha256:'+createHash('sha256').update(value).digest('hex')}),configs={};for(const role of ['rights-assessor','knowledge-scraper','question-generator','question-evaluator'])configs[role]=(await loader.load({source:await readFile('agent-config/'+role+'.yaml','utf8'),expectedRole:role})).value;
  configs['question-evaluator']={...configs['question-evaluator'],limits:{...configs['question-evaluator'].limits,compactionThresholdTokens:1}};
  const original=new EvaluationTransportFailure({kind:'EvaluationDeadlineExceeded',field:'synthetic-compaction-fence'});original.notStarted=true;let calls=0,summaryCalls=0;
  const runtime=createKnowledgeWorkflowAgentRuntime({model:{generate:async input=>{calls++;if(input.input.operation==='compact-working-context'){summaryCalls++;if(stopInSummary)throw original;return ok({output:{summary:'Synthetic compacted context.'},inputTokens:1,outputTokens:1,reasoningTrace:null});}throw original;}},memory,eventLedger:{append:async()=>null},compactor:createContextCompactor({now:()=>new Date().toISOString(),digest:value=>'sha256:'+createHash('sha256').update(value).digest('hex'),appendRecord:async()=>null,logger:()=>{}}),configSnapshots:configs,now:()=>new Date().toISOString(),logger:()=>{}}),stages=new D1WorkflowStageRepository({database:storage.database,now:()=>new Date().toISOString()});
  await assert.rejects(stages.run(run,'actual-compaction','digest',()=>runtime.run({ownerId:run.ownerId,runId:run.runId,role:'question-evaluator',taskId:'synthetic',systemPrompt:'Synthetic',input:{},maxOutputTokens:16}),{modelCall:true}),error=>error===original&&error instanceof AgentExecutionBoundaryFailure&&error.notStarted===stopInSummary);
  assert.equal(summaryCalls,1);assert.equal(calls,stopInSummary?1:2);assert.equal(storage.sqlite.prepare("SELECT status FROM knowledge_workflow_stages WHERE stage_key='actual-compaction'").get().status,stopInSummary?'not-started':'claimed');
 }finally{await application?.close();await storage?.close();await rm(f.directory,{recursive:true,force:true});}
});

for(const priorAccounting of ['admitted-recovery','replayed-receipt','cached-reserve'])test(`transport does not mark ${priorAccounting} as wholly unstarted`,async()=>{
 const catalog=await readFrozenEvaluationCatalog(),profiles=profilesFor(catalog),port=ledgerPort(Date.now()+100000);
 if(priorAccounting==='admitted-recovery')port.ledger.recoveryCandidate=()=>ok({failedKey:'prior',nextKey:'recovery',retryAtMs:Date.now()+200000,attempt:1});
 else if(priorAccounting==='replayed-receipt')port.ledger.replayResponse=()=>ok({model:catalog.model.id,error:{code:500},httpStatus:200});
 else port.ledger.reserve=command=>ok({...command,response:{model:catalog.model.id,error:{code:500},httpStatus:200}});
 const transport=createEvaluationTransport({ledger:port.ledger,catalog,model:catalog.model.id,endpoint:'https://openrouter.ai/api/v1/chat/completions',iterationId:'synthetic',fetch:async()=>assert.fail('Prior accounting must prevent a new physical dispatch'),now:Date.now,signal:new AbortController().signal,logger:()=>{},billingMode:'estimated',ownerDecision:decision,requestPlanner:createEstimatedRequestPlanner({metadata:catalog,costPolicy:{source:'Synthetic estimate',bytesPerToken:4,visualTokensPerImage:8000},sourceContract:decision,now:Date.now}),benchmarkContract:profiles.benchmarkContract});
 await assert.rejects(transport('https://openrouter.ai/api/v1/chat/completions',{method:'POST',body:JSON.stringify({model:catalog.model.id,messages:[{role:'user',content:'Synthetic input'}],max_tokens:16,response_format:{type:'json_object'}}),signal:new AbortController().signal}),error=>error instanceof EvaluationTransportFailure&&error.notStarted===false&&error.failure.kind===(priorAccounting==='admitted-recovery'?'EvaluationDeadlineExceeded':'EvaluationProviderError'));
 assert.equal(port.rows.size,0);
});

import {D1KnowledgeContentRepository} from '../worker/knowledge-workflow-content-d1.js';
for(const mode of ['empty-revise','owner-drop','foreign-id','duplicate-id'])test(`actual native quality critic binds owner preference schema and existing disposition: ${mode}`,async()=>{
 const f=await nativeFixture();let application,storage,critics=0,repairs=0;const ownerIds=mode==='empty-revise'?[]:['synthetic-unwanted-1','synthetic-unwanted-2'],previousId='synthetic-learned-duplicate';
 try{
  application=await openReviewedBenchmark({contract:f.contract,imagePolicy:f.config.imagePolicy,roleDependencies:{profiles:f.profiles,apiKey:'synthetic-offline',modelConfig:{...f.config.model,name:f.catalog.model.id,timeoutMs:60000},costPolicy:{source:'Synthetic estimate',bytesPerToken:4,visualTokensPerImage:8000},transport:{ledger:f.port.ledger,wait:async()=>{},fetch:async(_url,init)=>{
   const body=JSON.parse(init.body),schema=body.response_format.json_schema,raw=body.messages[1].content,envelope=Array.isArray(raw)?raw[0].text:raw,task=JSON.parse(envelope.slice(envelope.indexOf('\n')+1,envelope.lastIndexOf('\n'))).task;let value;
   if(schema.name==='knowledge_quality_repair_v1'){
    repairs++;assert.equal(mode,'empty-revise');assert.equal(repairs,1);assert.equal(critics,1);assert.equal(task.review.decision,'revise');assert.deepEqual(task.review.matchedLessOftenIds,[]);assert.deepEqual(task.knowledge.evidenceAnchors,f.point.evidenceAnchors);
    value={summary:'Synthetic supported distinct relationship.',coverageGoalIds:[],useSupportingImage:false,evidenceClauses:['Synthetic relation.']};
   }else{
    assert.equal(schema.name,'knowledge_quality_review_v13');critics++;
    assert.deepEqual(task.lessOften.map(p=>p.id),ownerIds);assert(task.previousKnowledge.some(p=>p.id===previousId));
    const props=schema.schema.properties,ids=props.matchedLessOftenIds;assert.equal(ids.maxItems,ownerIds.length);assert.equal(Object.hasOwn(ids,'uniqueItems'),false);assert.equal(Object.hasOwn(ids.items,'enum'),ownerIds.length>0);
    if(ownerIds.length){assert.deepEqual(ids.items.enum,ownerIds);assert.equal(ids.items.enum.includes(previousId),false);assert.deepEqual(props.qualityDecision.enum,['pass','revise','drop-see-less']);}
    else {assert.deepEqual(props.qualityDecision.enum,['pass','revise']);assert.match(body.messages[0].content,/previousKnowledge and previousQuizzes describe previously learned content/);assert.match(body.messages[0].content,/If lessOften is empty, never return drop-see-less/);}
    value=mode==='empty-revise'?{...output,decision:critics===1?'revise':'pass',feedback:'Select a distinct relationship directly supported by the retained quote.'}:{...output,decision:'drop-see-less',matchedLessOftenIds:mode==='owner-drop'?[ownerIds[1]]:mode==='foreign-id'?[previousId]:[ownerIds[0],ownerIds[0]]};
   }
   if(schema.name==='knowledge_quality_review_v13')value=syntheticAssessment(task,value);
   return Response.json({id:'synthetic-context-'+mode+'-'+(critics+repairs),model:body.model,choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}],usage:{prompt_tokens:1,completion_tokens:1,cost:0}});
  },now:Date.now,signal:new AbortController().signal,logger:()=>{},billingMode:'estimated',ownerDecision:decision}}});
  const {run,runtime}=await application.forCase(f.item);storage=await openPositiveStorage({directory:application.directory});const content=new D1KnowledgeContentRepository({database:storage.database,logger:()=>{}});
  for(const id of [previousId,...ownerIds]){
   assert.equal((await content.appendKnowledgePoint({...f.point,id,normalizedHash:id},run.ownerId,run.runId,new Date().toISOString())).ok,true);
   if(ownerIds.includes(id))storage.sqlite.prepare("INSERT INTO learner_preference_feedback VALUES(?,?,-1,'less',?)").run(run.ownerId,id,new Date().toISOString());
  }
  const command={run,point:f.point,sourceMode:'text',sourceEvidence:f.item.input.evidence},result=await runtime.reviewCapturedCandidate(command);
  if(mode==='empty-revise'){assert.equal(result.ok,true,JSON.stringify(result.error));assert(result.value);assert.equal(result.value.point.summary,'Synthetic supported distinct relationship.');assert.deepEqual(result.value.point.evidenceAnchors,f.point.evidenceAnchors);assert.equal(critics,2);assert.equal(repairs,1);}
  else if(mode==='owner-drop'){assert.deepEqual(result,{ok:true,value:null});assert.equal(critics,1);assert.equal(repairs,0);}
  else {assert.deepEqual(result,{ok:false,error:{kind:'KnowledgeReviewOutputInvalid',attempts:1,technicalAttempts:1,technicalRetriesExhausted:true}});assert.equal(critics,1);assert.equal(repairs,0);}
  assert.equal(f.port.rows.size,critics+repairs);assert.deepEqual(await runtime.reviewCapturedCandidate(command),result);assert.equal(f.port.rows.size,critics+repairs,'replay adds no native calls or accounting reserves');
 }finally{await application?.close();await storage?.close();await rm(f.directory,{recursive:true,force:true});}
});

import {DatabaseSync} from 'node:sqlite';
import {createKnowledgeQualityReviewer} from '../src/features/knowledge-workflows/quality-review.js';
test('historical saved no-image verdicts gain no new quality credit under the fresh audit contract',async()=>{
 // Actual public native stages, read-only; no reference-label or benchmark verdict input is used.
 const proofPath='test-results/architecture-recovery/continued-repair/ready-glm-high30-evaluator-feedback-v15/diagnosed-dev016/diagnosis.json',bytes=await readFile(proofPath),proof=JSON.parse(bytes);
 assert.equal(createHash('sha256').update(bytes).digest('hex'),'db4409f6d824275a697b9338c753d41c6cc455ed765d63631be5dcb9bb70d584');
 const directory='test-results/architecture-recovery/continued-repair/ready-glm-high30-origin-policy-v12',db=new DatabaseSync(directory+'/reviewed-application/isolated.sqlite',{readOnly:true});
 let original,context,values;
 try{
  const run=db.prepare("SELECT run_id FROM knowledge_workflow_runs WHERE source_id='dev-web-016'").get(),row=db.prepare("SELECT result_json FROM knowledge_workflow_stages WHERE run_id=? AND stage_key='reviewed-benchmark-extraction'").get(run.run_id);
  original=JSON.parse(row.result_json).value.facts.candidates.find(p=>p.normalizedHash==='ecm-receptor-microfilament-transcription-signaling');assert.equal(createHash('sha256').update(JSON.stringify(original)).digest('hex'),proof.originalCandidate.sha256);
  context=JSON.parse(db.prepare("SELECT result_json FROM knowledge_workflow_stages WHERE run_id=? AND stage_key='knowledge-quality-context:knowledge:dev-web-016:1:ecm-receptor-microfilament-transcription-signaling'").get(run.run_id).result_json).value;
  values=proof.nativeStages.map(s=>{const row=db.prepare('SELECT result_json FROM knowledge_workflow_stages WHERE run_id=? AND stage_key=?').get(run.run_id,s.stageKey);assert.equal(createHash('sha256').update(row.result_json).digest('hex'),s.resultSha256);const value=JSON.parse(row.result_json).value;assert.equal(createHash('sha256').update(JSON.stringify(value)).digest('hex'),s.valueSha256);return value;});
 }finally{db.close();}
 assert.deepEqual(original.mediaCandidates,[]);assert.equal(values[0].decision,'revise');assert.equal(values[0].allowTextOnly,false);assert.equal(values[1].useSupportingImage,true);assert.equal(values[2].decision,'revise');
 for(const preserveBadRepair of [true,false]){
  let critics=0,repairs=0;const result=await createKnowledgeQualityReviewer({technicalRetries:false,context,sourceMode:'text',digest:async s=>'sha256:'+createHash('sha256').update(s).digest('hex'),evaluate:async candidate=>{assert.deepEqual(candidate.mediaCandidates,[]);assert.deepEqual(candidate.evidenceAnchors.map(a=>({quote:a.quote,quoteDigest:a.quoteDigest,blockId:a.blockId})),original.evidenceAnchors.map(a=>({quote:a.quote,quoteDigest:a.quoteDigest,blockId:a.blockId})));return {ok:true,value:values[critics++===0?0:2]};},regenerate:async()=>{repairs++;return {ok:true,value:preserveBadRepair?values[1]:{...values[1],useSupportingImage:false}};}}).review({...original,id:'saved-original-point',sourceId:'dev-web-016',sourceRevision:1});
  assert.deepEqual(result,{ok:false,error:{kind:'KnowledgeReviewOutputInvalid',attempts:1,technicalAttempts:1,technicalRetriesExhausted:true}});assert.equal(critics,1);assert.equal(repairs,0);
 }
});
for(const sourceMode of ['text','image'])test(`attached image cannot be stripped when critic allowTextOnly=false: ${sourceMode}`,async()=>{
 const original={id:'synthetic',sourceId:'synthetic',sourceRevision:1,summary:'Synthetic immutable passage.',mediaCandidates:[{visualId:'attached-original'}],evidenceAnchors:[{quote:'Synthetic immutable passage.'}],coverageGoalIds:[]},repair={summary:'Synthetic supported relation.',evidenceClauses:['Synthetic immutable passage.'],coverageGoalIds:[],useSupportingImage:false};let critics=0,repairs=0;
 const result=await createKnowledgeQualityReviewer({technicalRetries:false,context:{lessOften:[],previousKnowledge:[],previousQuizzes:[]},sourceMode,digest:async()=>assert.fail('Rejected removal needs no hash'),evaluate:async point=>{critics++;return {ok:true,value:auditedVerdict(point,{...output,decision:'revise',allowTextOnly:false},sourceMode)};},regenerate:async()=>{repairs++;return {ok:true,value:repair};}}).review(original);
 assert.deepEqual(result,{ok:false,error:{kind:'KnowledgeRepairOutputInvalid',attempts:1,technicalAttempts:1,technicalRetriesExhausted:true}});assert.equal(critics,1);assert.equal(repairs,1);assert.deepEqual(original.mediaCandidates,[{visualId:'attached-original'}]);assert.deepEqual(original.evidenceAnchors,[{quote:'Synthetic immutable passage.'}]);
});

for(const fault of ['provider-body','model-content'])test(`public native critic separates ${fault} from pipeline retry authorization`,async()=>{
 const directory=await mkdtemp(join(tmpdir(),'native-response-boundary-')),catalog=await readFrozenEvaluationCatalog(),profiles=profilesFor(catalog),{config,corpus}=createSyntheticEvaluationFixture(),item=corpus.cases[0],port=ledgerPort(Date.now()+1800000),logs=[],file='scripts/benchmark-reviewed-runtime.mjs';
 const contract={pipelineMode:REVIEWED_PIPELINE,directory,iterationId:'synthetic-boundary',grant:{id:'synthetic'},runtimePolicy:{maximumWindowMilliseconds:1800000},sourceFiles:{[file]:createHash('sha256').update(await readFile(file)).digest('hex')}};let calls=0,app;
 try{app=await openReviewedBenchmark({contract,imagePolicy:config.imagePolicy,roleDependencies:{profiles,apiKey:'synthetic-offline',modelConfig:{...config.model,name:catalog.model.id,timeoutMs:60000},costPolicy:{source:'Synthetic estimate',bytesPerToken:4,visualTokensPerImage:8000},transport:{ledger:port.ledger,wait:async()=>{},fetch:async(_url,init)=>{calls++;const body=JSON.parse(init.body);if(fault==='provider-body'&&calls===1)return new Response('{invalid transport JSON',{status:200});if(fault==='model-content')return Response.json({id:'synthetic-model-invalid',model:body.model,choices:[{finish_reason:'stop',message:{content:JSON.stringify({notTheRequiredReviewSchema:true})}}],usage:{prompt_tokens:1,completion_tokens:1,cost:0}});return response(profiles.roles['review-grader'].catalog.model.id,body);},now:Date.now,signal:new AbortController().signal,logger:e=>logs.push(e),billingMode:'estimated',ownerDecision:decision}},logger:e=>logs.push(e)});
 const {run,runtime}=await app.forCase(item),point={id:'synthetic-point',sourceId:item.id,sourceRevision:1,summary:'Synthetic relation.',normalizedHash:'synthetic',evidenceAnchors:[{url:item.input.evidence.url,selector:'p',blockId:'b',quote:'Synthetic relation.',quoteDigest:'sha256:synthetic',clause:'Synthetic relation.'}],coverageGoalIds:[],mediaCandidates:[],attribution:{sourceUrl:item.input.evidence.url},extractionVersion:'synthetic'};
 const result=await runtime.reviewCapturedCandidate({run,point,sourceMode:'text',sourceEvidence:item.input.evidence});
 if(fault==='provider-body'){assert.equal(result.ok,true,JSON.stringify(result.error));assert.equal(calls,2);assert.equal(port.rows.size,2);assert.equal([...port.rows.values()][0].response,null);assert.equal([...port.rows.values()][0].recoverable,true);assert.equal([...port.rows.values()][1].response!==null,true);}else{assert.deepEqual(result,{ok:false,error:{kind:'KnowledgeReviewOutputInvalid',attempts:1,technicalAttempts:1,technicalRetriesExhausted:true}});assert.equal(calls,1);assert.equal(port.rows.size,1);assert.equal([...port.rows.values()][0].response!==null,true);assert.equal(classifyEvaluationFailure(result.error),'pipeline');}
 }finally{app?.close();await rm(directory,{recursive:true,force:true});}
});
