import {syntheticAssessment,syntheticReviewAudit} from './fixtures/knowledge-review-audit.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
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
 return {rows,setDeadline(value){deadline=value;cancelled=false;},ledger:{runtimePolicy:{maximumAdditionalRecoveries:null},accountingMode:'estimated',ownerDecision:decision,
  snapshot:()=>ok({deadlineAtMs:deadline,effectiveDeadlineAtMs:deadline,runtimeDeadlineAtMs:deadline,effectiveCancelled:cancelled,cancelled,admissionHalted:null,activeRequests:active}),
  reserve(c){rows.set(c.key,{...c,response:null});return ok(c);},complete(c){Object.assign(rows.get(c.key),c);return ok(null);},
  uncertain(c){const row=rows.get(c.key);if(row){row.uncertain=true;row.uncertaintyVersion=1;row.recoverable=!!(c.recoverableExternal||c.recoverableTimeout);}return {ok:false,error:{kind:c.kind}};},
  recoveryCandidate(base){const latest=[...rows.values()].filter(row=>row.key===base||row.baseKey===base).at(-1);return ok(latest?.uncertain&&latest.recoverable?{failedKey:latest.key,nextKey:base+':recovery-'+rows.size,retryAtMs:Date.now(),attempt:rows.size,costNanodollars:latest.costNanodollars,uncertaintyVersion:latest.uncertaintyVersion}:null);},
  replayResponse:base=>ok([...rows.values()].filter(row=>row.key===base||row.baseKey===base).at(-1)?.response??null),pacingDue:()=>ok({retryAtMs:Date.now(),cooldown:false}),haltExecution:()=>ok(null),cancel(){cancelled=true;return ok(null);},
  trackAccounting(promise){active++;promise.then(()=>active--,()=>active--);return promise;}
 }};
}
function profilesFor(catalog){const reviewer=structuredClone(catalog);reviewer.model.id='synthetic/reviewer';reviewer.model.canonical_slug='synthetic/reviewer-v1';
 const protocol={source:'Synthetic offline native protocol',responseFormat:'json_schema',reasoningEffort:'high',receiptOptional:true,provider:{sort:'throughput',require_parameters:true,allow_fallbacks:true}},roles={'knowledge-scraper':{catalog,version:catalog.model.canonical_slug,protocol},'review-grader':{catalog:reviewer,version:reviewer.model.canonical_slug,protocol}};
 return {source:'Synthetic roles',roles,benchmarkContract:{source:'Synthetic approval',readiness:'owner-authorized-first-development-case',excludedCreators:['openai','anthropic','google','luna'],approved:Object.values(roles).map(p=>({id:p.catalog.model.id,creator:p.catalog.model.id.split('/')[0],canonicalSlug:p.version,catalogSha256:p.catalog.catalogSha256,prompt:p.catalog.model.pricing.prompt,completion:p.catalog.model.pricing.completion}))}};
}
const output={decision:'pass',reasons:['Synthetic retained text supports this claim.'],feedback:'Keep the supported relationship.',matchedLessOftenIds:[],supportingImageEvidence:'',allowTextOnly:true};
const response=model=>Response.json({id:'synthetic-recovered',model,choices:[{finish_reason:'stop',message:{content:JSON.stringify(output)}}],usage:{prompt_tokens:1,completion_tokens:1,cost:0}});
const hanging=init=>new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true}));


import {openPositiveStorage} from '../scripts/architecture-live-positive.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
const extractionFiles=['scripts/benchmark-reviewed-runtime.mjs','worker/knowledge-workflow-runtime.js','worker/webpage-facts.js','worker/webpage-images.js','src/features/knowledge-workflows/quality-review.js'];
const sourceFiles=Object.fromEntries(await Promise.all(extractionFiles.map(async file=>[file,sha(await readFile(file))])));
const forbidden=async()=>assert.fail('No source/semantic regeneration is authorized.');
async function fixture(t,quizAssessmentMode="valid"){
 const directory=await mkdtemp(join(tmpdir(),'native-claimed-recovery-')),catalog=await readFrozenEvaluationCatalog(),profiles=profilesFor(catalog),{config,corpus}=createSyntheticEvaluationFixture(),item=structuredClone(corpus.cases[0]),costPolicy={source:'Synthetic estimate',bytesPerToken:4,visualTokensPerImage:8000},port=ledgerPort(Date.now()+1800000),calls=[];
 item.input.material={kind:'text',fileName:'fixture',sections:[{id:'section',title:'Synthetic',url:item.input.evidence.url,locator:'page:1',text:'Synthetic relation.'}]};
 const contract={pipelineMode:REVIEWED_PIPELINE,directory,iterationId:'old-application',grant:{id:'synthetic'},runtimePolicy:{maximumWindowMilliseconds:1800000},sourceFiles};
 let application,storage,recover=false;
 const roleDependencies={profiles,apiKey:'synthetic-offline',modelConfig:{...config.model,name:catalog.model.id,timeoutMs:60000},costPolicy,transport:{ledger:port.ledger,wait:async()=>{},fetch:async(_url,init)=>{
  const body=JSON.parse(init.body),schema=body.response_format.json_schema.name;calls.push({schema,body});
  const raw=body.messages[1].content,envelope=Array.isArray(raw)?raw[0].text:raw,task=JSON.parse(envelope.slice(envelope.indexOf('\n')+1,envelope.lastIndexOf('\n'))).task;
  let value=output;
  if(schema==='paired_quiz_v3'){const p=task.knowledge;value={knowledgeId:p.id,knowledgeRevision:1,canonicalAnswers:['relation'],citedEvidenceUrls:[item.input.evidence.url],multipleChoice:{prompt:'Which synthetic concept?',options:[{key:'A',text:'relation'},{key:'B',text:'unrelated'}],correctOptionKeys:['A'],correctOptionAnswers:[{key:'A',canonicalAnswer:'relation'}],explanation:'The synthetic quote supports relation.'},fillBlank:{prompt:'The synthetic concept is ____.',blanks:[{id:'blank-1',canonicalAnswer:'relation',acceptedAnswers:['relation']}],explanation:'The retained quote supports relation.'}};}
  else if(schema==='quiz_evaluation_v3'){
   if(!recover){port.setDeadline(Date.now()-1);throw new DOMException('Synthetic provider connection interrupted at real execution fence','AbortError');}
   value={score:9,reasons:['Synthetic supported question.'],feedback:'Keep this source-bound question.',groundingProblems:[],knowledgeGroundingProblems:[]};
   if(quizAssessmentMode==='missing-point-field')delete value.knowledgeGroundingProblems;
   if(quizAssessmentMode==='unsafe-knowledge')value.knowledgeGroundingProblems=[{claim:task.knowledge.summary,kind:'unsupported',reason:'The supplied source does not support the retained relation.'}];
   if(quizAssessmentMode==='absent-claim')value.knowledgeGroundingProblems=[{claim:'An absent unsafe qualifier',kind:'unpictured',reason:'The source does not depict this removed qualifier.'}];
   if(quizAssessmentMode==='legacy-negative')value.knowledgeGroundingProblems=['A legacy string is not a fresh claim-bound issue.'];
   if(quizAssessmentMode==='necessary-condition')value.knowledgeGroundingProblems=[{claim:task.knowledge.summary,kind:'source-conflicting',reason:'The supplied source requires a condition absent from this unconditional retained claim.'}];
   if(quizAssessmentMode==='draft-only'&&task.attempt===1)value.groundingProblems=['This quiz draft introduces an unsupported condition.'];
  }else {assert.equal(schema,'knowledge_quality_review_v12');value=syntheticAssessment(task,value);}
  return Response.json({id:'synthetic-response-'+calls.length,model:body.model,choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}],usage:{prompt_tokens:1,completion_tokens:1,cost:0}});
 },now:Date.now,signal:new AbortController().signal,logger:()=>{},billingMode:'estimated',ownerDecision:decision}};
 try{
  application=await openReviewedBenchmark({contract,roleDependencies,imagePolicy:config.imagePolicy});
  const candidate={summary:'Synthetic relation.',normalizedHash:'synthetic',evidenceAnchors:[{url:item.input.evidence.url,selector:'page:1',blockId:'b',quote:'Synthetic relation.',quoteDigest:'sha256:synthetic',clause:'Synthetic relation.'}],coverageGoalIds:[],mediaCandidates:[]};
  const accepted=await application.accept({item,candidate,sourceEvidence:item.input.evidence});assert.equal(accepted.ok,true,JSON.stringify(accepted.error));assert(accepted.value);
  const extractCommand={item,generate:async()=>ok({pages:[{url:item.input.evidence.url,notes:'No more synthetic points.',candidates:[]}]}),decodeImage:forbidden,deadline:Date.now()+60000,maximumPages:1};
  const extraction=await application.extract(extractCommand);assert.equal(extraction.ok,true,JSON.stringify(extraction.error));
  const interrupted=await application.quiz(item).then(value=>({value}),error=>({error}));assert(interrupted.error instanceof (await import('../scripts/evaluation-budget.mjs')).EvaluationTransportFailure);
  const {run}=await application.forCase(item);storage=await openPositiveStorage({directory:application.directory});
  const row=storage.sqlite.prepare("SELECT * FROM knowledge_workflow_stages WHERE owner_id=? AND run_id=? AND stage_key LIKE 'question-evaluator:quiz-evaluator-%'").get(run.ownerId,run.runId);assert.equal(row.status,'claimed');
  const receipt=storage.sqlite.prepare("SELECT * FROM knowledge_workflow_stages WHERE owner_id=? AND run_id=? AND stage_key='reviewed-benchmark-extraction'").get(run.ownerId,run.runId);
  const reservation=[...port.rows.values()].at(-1);assert.equal(reservation.response,null);assert.equal(reservation.uncertaintyVersion,1);
  await application.close();application=null;
  const closurePath=join(directory,'synthetic-closed.json'),closure={cleanupConfirmed:true,stopping:true,stopReason:'IntegrationDeadlineExceeded',failure:null,monitorFailure:null,finishedAt:new Date(Date.now()+10).toISOString()},closureBytes=JSON.stringify(closure);await writeFile(closurePath,closureBytes);
  const proof={version:'accounted-native-stage-recovery-v1',ownerAuthorized:true,applicationIterationId:contract.iterationId,caseId:item.id,stage:{ownerId:row.owner_id,runId:row.run_id,key:row.stage_key,inputDigest:row.input_digest,createdAt:row.created_at},request:{key:reservation.key,costNanodollars:reservation.costNanodollars,uncertaintyVersion:1},closure:{source:closurePath,sha256:sha(closureBytes),deadlineAtMs:Date.parse(row.created_at)+1},roleProfilesSha256:sha(JSON.stringify(profiles)),costPolicySha256:sha(JSON.stringify(costPolicy)),extraction:{inputDigest:receipt.input_digest,createdAt:receipt.created_at,sourceFiles}};
  async function reopen(withProof=true,mutate=()=>{}){
   port.setDeadline(Date.now()+1800000);recover=true;reservation.recoverable=true;
   const next={...contract,iterationId:'new-technical-run',quizRun:{knowledgeIterationId:contract.iterationId,applicationDirectory:storage.directory},sourceFiles:{...sourceFiles,'worker/knowledge-workflow-runtime.js':'f'.repeat(64),[closurePath]:sha(closureBytes)}};
   if(withProof){const copy=structuredClone(proof);mutate(copy);const path=join(directory,'proof.json'),bytes=JSON.stringify(copy);await writeFile(path,bytes);next.nativeRecovery={source:path,sha256:sha(bytes)};next.sourceFiles[path]=sha(bytes);}
   application=await openReviewedBenchmark({contract:next,roleDependencies,imagePolicy:config.imagePolicy});return application;
  }
  return {directory,item,port,calls,storage,row,receipt,reservation,proof,reopen,extractCommand,async close(){await application?.close();application=null;},async cleanup(){await application?.close();await storage.close();await rm(directory,{recursive:true,force:true});}};
 }catch(error){await application?.close();await storage?.close();await rm(directory,{recursive:true,force:true});throw error;}
}
test('actual adapter closed-store exact quiz call recovery preserves completed extraction, native calls and semantic attempt 1',async t=>{
 const f=await fixture(t);try{
  const app=await f.reopen();const resumed=await app.extract({...f.extractCommand,generate:forbidden});assert.equal(resumed.ok,true,JSON.stringify(resumed.error));
  const result=await app.quiz(f.item);assert.equal(result.ok,true,JSON.stringify(result.error));assert.equal(result.value.outputs.length,1);assert.equal(result.value.outputs[0].attempt,1);
  assert.deepEqual(f.calls.map(call=>call.schema),['knowledge_quality_review_v12','paired_quiz_v3','quiz_evaluation_v3','quiz_evaluation_v3']);
  assert.deepEqual(f.calls[2].body,f.calls[3].body,'dynamic harness reconstruction must retain the exact native body');
  const last=[...f.port.rows.values()].at(-1);assert.equal(last.baseKey,f.reservation.key);assert.equal(f.reservation.response,null);assert(last.response);assert.equal(f.port.rows.size,4);
  assert.equal(f.storage.sqlite.prepare('SELECT status FROM knowledge_workflow_stages WHERE owner_id=? AND run_id=? AND stage_key=?').get(f.row.owner_id,f.row.run_id,f.row.stage_key).status,'completed');
  assert.deepEqual(f.storage.sqlite.prepare("SELECT * FROM knowledge_workflow_stages WHERE owner_id=? AND run_id=? AND stage_key='reviewed-benchmark-extraction'").get(f.row.owner_id,f.row.run_id),f.receipt);
  assert.deepEqual(await app.quiz(f.item),result);assert.equal(f.calls.length,4);
 }finally{await f.cleanup();}
});
test('unproven claimed native child is blocked without transport dispatch or quiz attempt renewal',async t=>{
 const f=await fixture(t);try{const app=await f.reopen(false),result=await app.quiz(f.item);assert.equal(result.ok,false);assert.equal(result.error.kind,'WorkflowStageCallUncertain');assert.equal(f.calls.length,3);assert.equal(f.port.rows.size,3);}finally{await f.cleanup();}
});
for(const field of ['input','admission','cost','body','extraction','unadmitted'])test(`native recovery rejects changed ${field} before paid dispatch`,async t=>{
 const f=await fixture(t);try{
  const app=await f.reopen(true,p=>{if(field==='input')p.stage.inputDigest='sha256:wrong';if(field==='admission')p.request.uncertaintyVersion=2;if(field==='body')p.request.key+='wrong';if(field==='cost')p.request.costNanodollars++;if(field==='extraction')p.extraction.inputDigest='sha256:wrong';});
  if(field==='unadmitted')f.reservation.recoverable=false;
  if(field==='extraction')await assert.rejects(app.extract({...f.extractCommand,generate:forbidden}),/ReviewedExtractionRecoveryReceiptInvalid/);
  else await assert.rejects(app.quiz(f.item),e=>e instanceof Error&&e.failure?.kind==='EvaluationRecoveryEvidenceInvalid');
  assert.equal(f.calls.length,3);assert.equal(f.port.rows.size,3);
 }finally{await f.cleanup();}
});

for(const field of ['profiles','costPolicy','closure'])test(`source-bound native recovery rejects wrong ${field} before opening provider execution`,async t=>{
 const f=await fixture(t);try{
  await assert.rejects(f.reopen(true,p=>{if(field==='profiles')p.roleProfilesSha256='b'.repeat(64);if(field==='costPolicy')p.costPolicySha256='b'.repeat(64);if(field==='closure')p.closure.sha256='b'.repeat(64);}));
  assert.equal(f.calls.length,3);assert.equal(f.port.rows.size,3);
 }finally{await f.cleanup();}
});
test('transport computed-body/accounting guard rejects stale exact native request key before reserve, replay or provider',async()=>{
 const catalog=await readFrozenEvaluationCatalog(),profiles=profilesFor(catalog),port=ledgerPort(Date.now()+1800000);let queries=0;
 port.ledger.replayResponse=()=>{queries++;assert.fail('Wrong reconstructed request must not reach replay');};
 port.ledger.recoveryCandidate=()=>{queries++;assert.fail('Wrong reconstructed request must not reach recovery admission');};
 const transport=createEvaluationTransport({ledger:port.ledger,catalog,model:catalog.model.id,endpoint:'https://openrouter.ai/api/v1/chat/completions',iterationId:'original',expectedRecoveryKey:'original:wrong-body-accounting-hash',fetch:forbidden,now:Date.now,signal:new AbortController().signal,logger:()=>{},billingMode:'estimated',ownerDecision:decision,requestPlanner:createEstimatedRequestPlanner({metadata:catalog,costPolicy:{source:'Synthetic estimate',bytesPerToken:4,visualTokensPerImage:8000},sourceContract:decision,now:Date.now}),benchmarkContract:profiles.benchmarkContract});
 await assert.rejects(transport('https://openrouter.ai/api/v1/chat/completions',{method:'POST',signal:new AbortController().signal,body:JSON.stringify({model:catalog.model.id,messages:[{role:'user',content:'Changed dynamic native memory'}],max_tokens:16,response_format:{type:'json_object'}})}),error=>error.failure?.kind==='EvaluationRecoveryEvidenceInvalid'&&error.failure.field==='native request/accounting key');
 assert.equal(port.rows.size,0);assert.equal(queries,0);
});

import {DatabaseSync} from 'node:sqlite';
import {createEvaluationLedger} from '../scripts/evaluation-budget.mjs';
import {runtimeStorageColumn} from '../scripts/evaluation-runtime-control.mjs';
const hash=value=>sha(JSON.stringify(value)),h='a'.repeat(64),other='b'.repeat(64);
function syntheticPolicy(){
 const approval={ownerAuthorized:true,source:'synthetic-renewal',decision:'Renew90Minutes20AdditionalRecoveriesUSD5'};
 return {version:2,source:'synthetic-code',budgetId:'owner-approved-image-benchmark',predecessorSha256:h,codeSha256:h,modelsSha256:h,selectionSha256:h,originalGrantSha256:h,maximumCostNanodollars:5000000000,maximumMilliseconds:5400000,maximumWindowMilliseconds:1800000,maximumAdditionalRecoveries:null,
  renewal:{approval,approvalSha256:hash(approval),previousRuntimeSha256:h,pacing:{source:'synthetic-pacing',initialMilliseconds:2000,minimumIntervalMilliseconds:2000,errorBackoffMilliseconds:[1000,2000,4000,8000,16000,32000,60000],suspendAfter429:3},maximumWindows:3},
  lineage:{diagnosticDebitNanodollars:100000000,diagnosticChains:[{path:'synthetic-diagnostic-one',sha256:h},{path:'synthetic-diagnostic-two',sha256:other}],previousRecoveriesConsumed:9,previousRuntimeSha256:h},
  continuation:{ownerAuthorized:true,source:'synthetic-continuation',decision:'DeepInfraMonitorRepairPreserveClock',previousRuntimeSha256:h,reconciliationSha256:h},
  recoveryPool:{ownerAuthorized:true,source:'synthetic-pool',predecessorStateSha256:h,previousLimit:20,previousUsed:18,additional:20},recoveryExtension:{source:'synthetic-recovery',sourceSha256:h,previousRuntimeSha256:h,previousMaximumRecoveries:40,previousRecoveriesUsed:40,maximumRecoveries:null},
  requestExtension:{source:'synthetic-requests',sourceSha256:h,previousRuntimeSha256:h,previousMaximumRequests:1200,maximumRequests:2000},inputTokenExtension:{source:'synthetic-input',sourceSha256:h,previousRuntimeSha256:h,previousMaximumInputTokens:3000000,maximumInputTokens:8000000},
  benchmarkIteration:{source:'synthetic-clock',sourceSha256:h,previousRuntimeSha256:h,previousDeadlineAtMs:5401000,previousWindowCount:0,iterationId:'synthetic-existing-run',durationMilliseconds:7200000},
  priorUnknowns:Array.from({length:24},(_,i)=>({key:'synthetic-unknown-'+i,estimatedDebitNanodollars:100000000,uncertaintyVersion:1}))};
}

test('public runtime recovery candidate binds admitted original cost/version and rejects changed reservation metadata',()=>{
 const db=new DatabaseSync(':memory:'),policy=syntheticPolicy(),original={maximumRequests:1200,maximumInputTokens:3000000,maximumOutputTokens:3000000,maximumMilliseconds:10800000,maximumCostNanodollars:1000000000};
 const owner={authority:'Synthetic source-bound approval',source:'benchmark-native-recovery.test.mjs',decision:'TreatUSD1asestimatedbudget withautomaticstopping;acceptpossibleoveragefromoneinflightrequest'};
 try{
  createEvaluationLedger({database:db,budgetId:policy.budgetId,policy:original,now:()=>1000,logger:()=>{},accountingMode:'estimated',ownerDecision:owner});
  const column=runtimeStorageColumn(policy);db.exec('ALTER TABLE evaluation_budgets ADD COLUMN '+column+' TEXT');db.exec('ALTER TABLE evaluation_reservations ADD COLUMN sanitized_envelope TEXT');
  for(const u of policy.priorUnknowns)db.prepare('INSERT INTO evaluation_reservations(budget_id,key,allowance,input_tokens,output_tokens,cost,response,uncertainty_version) VALUES(?,?,?,?,?,?,?,?)').run(policy.budgetId,u.key,'{}',1,1,u.estimatedDebitNanodollars,null,u.uncertaintyVersion);
  const source=policy.priorUnknowns[0],state={policy,benchmarkIterationActivatedAtMs:1000,benchmarkIterationHistory:[{iterationId:policy.benchmarkIteration.iterationId,startedAtMs:1000,deadlineAtMs:7201000,sourceSha256:h}],startedAtMs:1000,deadlineAtMs:7201000,lastNow:1000,windows:[{startedAtMs:1000,deadlineAtMs:1801000}],admissions:[{key:source.key,cost:source.estimatedDebitNanodollars,uncertaintyVersion:1,type:'external',retryAtMs:1000}],dispatches:[],halted:null,cancelled:false,pacing:{},predecessorReservations:db.prepare('SELECT * FROM evaluation_reservations').all(),predecessorBudget:db.prepare('SELECT * FROM evaluation_budgets').get(),contractHistory:[]};
  db.prepare('UPDATE evaluation_budgets SET '+column+'=?').run(JSON.stringify(state));
  const ledger=createEvaluationLedger({database:db,budgetId:policy.budgetId,policy:original,runtimePolicy:policy,now:()=>1000,logger:()=>{},accountingMode:'estimated',ownerDecision:owner}),candidate=ledger.recoveryCandidate(source.key);
  assert.equal(candidate.ok,true,JSON.stringify(candidate));assert.equal(candidate.value.costNanodollars,source.estimatedDebitNanodollars);assert.equal(candidate.value.uncertaintyVersion,1);assert.equal(candidate.value.failedKey,source.key);
  db.prepare('UPDATE evaluation_reservations SET uncertainty_version=2 WHERE key=?').run(source.key);
  assert.deepEqual(ledger.recoveryCandidate(source.key),{ok:false,error:{kind:'EvaluationExecutionDebtConflict'}},'immutable predecessor debt guard rejects changed persisted uncertainty before recovery');
 }finally{db.close();}
});


test('actual native quiz boundary rejects a fresh evaluation missing typed point assessment',async t=>{
 const f=await fixture(t,'missing-point-field');try{
  const app=await f.reopen();const result=await app.quiz(f.item);
  assert.equal(result.ok,false);assert.equal(result.error.kind,'QuizEvaluatorOutputInvalid');
  assert.equal(f.calls.length,4);assert.equal(f.calls.at(-1).body.max_tokens,2048);
  assert.equal(f.calls.at(-1).schema,'quiz_evaluation_v3');
  assert.equal(f.storage.sqlite.prepare('SELECT count(*) AS n FROM knowledge_workflow_quizzes').get().n,0);
 }finally{await f.cleanup();}
});
test('actual native quiz point-level negative discards knowledge without another draft or critic',async t=>{
 const f=await fixture(t,'unsafe-knowledge');try{
  const app=await f.reopen();const result=await app.quiz(f.item);
  assert.equal(result.ok,true,JSON.stringify(result.error));assert.equal(result.value.outputs.length,0);
  assert.equal(f.calls.length,4);assert.equal(f.calls.at(-1).body.max_tokens,2048);
  assert.equal(f.storage.sqlite.prepare('SELECT count(*) AS n FROM extraction_knowledge_points').get().n,0);
  assert.equal(f.storage.sqlite.prepare('SELECT count(*) AS n FROM knowledge_workflow_quizzes').get().n,0);
  assert.equal(f.storage.sqlite.prepare('SELECT count(*) AS n FROM knowledge_workflow_purge_tombstones').get().n,1);
  assert.equal(f.storage.sqlite.prepare('SELECT status FROM knowledge_workflow_stages WHERE owner_id=? AND run_id=? AND stage_key=?').get(f.row.owner_id,f.row.run_id,f.row.stage_key).status,'completed');
  assert.equal(f.port.rows.size,4,'No new semantic attempt or dispatch is admitted.');
  const again=await app.quiz(f.item);assert(again.ok);assert.equal(again.value.passes,true);assert.equal(again.value.outputs.length,0);assert.equal(f.calls.length,4,'Same-owner closed point remains discarded without a new native attempt.');
 }finally{await f.cleanup();}
});

for(const mode of ['absent-claim','legacy-negative'])test(`actual native fresh ${mode} output fails closed without extra draft or publication`,async t=>{
 const f=await fixture(t,mode);try{
  const app=await f.reopen();const result=await app.quiz(f.item);
  assert.equal(result.ok,false);assert.equal(result.error.kind,'QuizEvaluatorOutputInvalid');assert.equal(f.calls.length,4);assert.equal(f.calls.at(-1).body.max_tokens,2048);
  const row=f.storage.sqlite.prepare("SELECT result_json FROM knowledge_workflow_stages WHERE owner_id=? AND run_id=? AND stage_key LIKE 'question-evaluator:quiz-evaluator-%' AND status='completed'").get(f.row.owner_id,f.row.run_id);
  assert(row,'Raw model result remains persisted before actor projection.');assert.equal(f.storage.sqlite.prepare('SELECT count(*) AS n FROM knowledge_workflow_quizzes').get().n,0);
  assert.equal(f.port.rows.size,4,'No additional evaluator or generator call is admitted.');
 }finally{await f.cleanup();}
});

test('actual native fresh necessary-condition negative remains binding at high quiz score',async t=>{
 const f=await fixture(t,'necessary-condition');try{
  const app=await f.reopen();const result=await app.quiz(f.item);assert(result.ok);assert.equal(result.value.outputs.length,0);assert.equal(f.calls.length,4);
  assert.equal(f.storage.sqlite.prepare('SELECT count(*) AS n FROM extraction_knowledge_points').get().n,0);assert.equal(f.storage.sqlite.prepare('SELECT count(*) AS n FROM knowledge_workflow_purge_tombstones').get().n,1);
 }finally{await f.cleanup();}
});
test('actual native fresh draft-only fault remains repairable within its second draft and critic',async t=>{
 const f=await fixture(t,'draft-only');try{
  const app=await f.reopen();const result=await app.quiz(f.item);assert(result.ok,JSON.stringify(result.error));assert.equal(result.value.outputs.length,1);assert.equal(result.value.outputs[0].attempt,2);assert.equal(f.calls.length,6);
  assert.deepEqual(f.calls.map(x=>x.schema),['knowledge_quality_review_v12','paired_quiz_v3','quiz_evaluation_v3','quiz_evaluation_v3','paired_quiz_v3','quiz_evaluation_v3']);assert.equal(f.calls.at(-1).body.max_tokens,2048);
  assert.equal(f.storage.sqlite.prepare('SELECT count(*) AS n FROM extraction_knowledge_points').get().n,1);assert.equal(f.storage.sqlite.prepare('SELECT count(*) AS n FROM knowledge_workflow_quizzes').get().n,1);
  const again=await app.quiz(f.item);assert(again.ok);assert.equal(again.value.outputs[0].attempt,2);assert.equal(f.calls.length,6,'Same-owner publication read does not re-evaluate or regenerate.');
 }finally{await f.cleanup();}
});
