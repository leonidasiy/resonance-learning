import {syntheticAssessment,syntheticReviewAudit} from './fixtures/knowledge-review-audit.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createKnowledgeQualityReviewer } from '../src/features/knowledge-workflows/quality-review.js';
import { D1WorkflowStageRepository } from '../worker/knowledge-workflow-stages-d1.js';
import { createQuizActorCritic } from '../src/features/knowledge-workflows/quiz.js';
import { createKnowledgeWorkflowRuntime } from '../worker/knowledge-workflow-runtime.js';
import { createKnowledgeWorkflowService } from '../src/features/knowledge-workflows/workflow.js';
import { createAgentConfigurationLoader } from '../src/features/knowledge-workflows/config.js';
import { D1KnowledgeWorkflowRepository } from '../worker/knowledge-workflow-d1.js';
import { WEBPAGE_IMAGE_POLICY } from '../worker/webpage-image-budget.js';

import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openReviewedBenchmark,REVIEWED_PIPELINE} from '../scripts/benchmark-reviewed-runtime.mjs';
import {openPositiveStorage} from '../scripts/architecture-live-positive.mjs';
import {D1KnowledgeContentRepository,D1QuizRepository} from '../worker/knowledge-workflow-content-d1.js';
import {validateQuizPairDraft,quizPairSchema} from '../src/features/knowledge-workflows/quiz-pair.js';
import {readFrozenEvaluationCatalog} from './fixtures/evaluation/catalog.mjs';
import {createSyntheticEvaluationFixture} from './fixtures/evaluation/synthetic.mjs';

// Offline production-contract regressions. Scripted replies do not prove model accuracy.
const point={id:'knowledge:source:1:caption',sourceId:'source',sourceRevision:1,summary:'Caption relationship.',normalizedHash:'caption',evidenceAnchors:[],coverageGoalIds:['core'],mediaCandidates:[],attribution:{sourceUrl:'https://example.test/'},extractionVersion:'synthetic-offline'};
const verdict=decision=>({decision,reasons:['The retained caption supports the network composition, not a new integrin tethering claim.'],feedback:'Narrow the point to proteins and carbohydrates in the retained caption quote.',matchedLessOftenIds:[],supportingImageEvidence:'',allowTextOnly:true});
const repair={summary:'An extracellular network contains proteins and carbohydrates.',coverageGoalIds:['core'],useSupportingImage:false,evidenceClauses:['An extracellular network contains proteins and carbohydrates.']};

test('actual saved public aliases fail strict validation; alias-only deduplication retains canonical order and validates',async()=>{
 const saved=JSON.parse(await readFile(new URL('./fixtures/evaluation/saved-public-alias-duplicates.json',import.meta.url),'utf8'));
 assert.equal(validateQuizPairDraft(saved),false);
 assert.deepEqual(saved.fillBlank.blanks.map(blank=>blank.acceptedAnswers),[['collagen','Collagen','the collagen protein','collagen protein'],['proteoglycans','Proteoglycans','proteoglycan molecules','the proteoglycans']]);
 const copy=structuredClone(saved),normalize=value=>value.normalize('NFKC').trim().toLocaleLowerCase().replace(/\s+/gu,' ');
 for(const blank of copy.fillBlank.blanks){const seen=new Set();blank.acceptedAnswers=blank.acceptedAnswers.filter(answer=>{const normalized=normalize(answer);if(seen.has(normalized))return false;seen.add(normalized);return true;});}
 assert.equal(validateQuizPairDraft(copy),true);
 assert.deepEqual(copy.canonicalAnswers,saved.canonicalAnswers);assert.deepEqual(copy.multipleChoice,saved.multipleChoice);
 assert.deepEqual(copy.fillBlank.blanks.map(blank=>blank.acceptedAnswers[0]),copy.canonicalAnswers);
 const description=quizPairSchema(true).schema.properties.fillBlank.properties.blanks.items.properties.acceptedAnswers.description;
 assert.match(description,/NFKC/);assert.match(description,/case folding/);assert.match(description,/duplicates/);
 const compatibility=structuredClone(copy);compatibility.fillBlank.blanks[0].acceptedAnswers.push('  ＣＯＬＬＡＧＥＮ  ');assert.equal(validateQuizPairDraft(compatibility),false);
});
test('actual native critic and one repair receive retained-quote rules and preserve caption provenance',async()=>{
 const anchors=1,mismatch=false;
  const db=new DatabaseSync(':memory:');
  try {
    for(const name of (await readdir('worker/migrations')).filter(name=>name.endsWith('.sql')).sort())db.exec(await readFile('worker/migrations/'+name,'utf8'));
    const database={prepare(sql){let values=[];const execute=()=>({success:true,meta:{changes:Number(db.prepare(sql).run(...values).changes)}});return {bind(...v){values=v;return this;},first:async()=>db.prepare(sql).get(...values)??null,all:async()=>({success:true,results:db.prepare(sql).all(...values)}),run:async()=>execute(),execute};},async batch(statements){db.exec('BEGIN IMMEDIATE');try{const result=statements.map(s=>s.execute());db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}}};
    const unwrap=result=>{assert.equal(result.ok,true,JSON.stringify(result.error));return result.value;};
    const now=()=> '2026-10-09T00:00:00.000Z',nowMs=()=>Date.parse(now()),logger=()=>{};
    const loader=createAgentConfigurationLoader({sha256:async value=>'sha256:'+createHash('sha256').update(value).digest('hex')}),configs={};
    for(const role of ['rights-assessor','knowledge-scraper','question-generator','question-evaluator'])configs[role]=unwrap(await loader.load({source:await readFile('agent-config/'+role+'.yaml','utf8'),expectedRole:role}));
    const repository=new D1KnowledgeWorkflowRepository({database,logger}),service=createKnowledgeWorkflowService(repository,{now,createId:()=> 'synthetic-run',logger});
    let run=unwrap(await service.createRun({ownerId:'synthetic-owner',sourceId:point.sourceId,sourceRevision:1,canonicalSourceIdentity:point.attribution.sourceUrl,contentSignature:'synthetic-source',idempotencyKey:'synthetic-run',configDigests:Object.fromEntries(Object.entries(configs).map(([role,config])=>[role,config.digest]))})).run;
    for(const nextState of ['rights-assessment','robots-check','extraction-loop'])run=unwrap(await service.advance({ownerId:run.ownerId,runId:run.runId,expectedRevision:run.revision,nextState}));
    const candidate={...point,summary:'Matrix proteins tether a cell through integrins.',evidenceAnchors:[{url:point.attribution.sourceUrl,selector:'figcaption',blockId:'caption',quote:'Figure: an extracellular network of proteins and carbohydrates.',clause:'Integrins tether the cell.',quoteDigest:'sha256:immutable-caption'}]};
    const clauses=['An extracellular network contains proteins and carbohydrates.'];
    let criticCalls=0,repairCalls=0;
    const fetch=async(_url,init)=>{
      const body=JSON.parse(init.body),message=body.messages[1].content;
      const envelope=Array.isArray(message)?message[0].text:message,input=JSON.parse(envelope.slice(envelope.indexOf('\n')+1,envelope.lastIndexOf('\n'))),task=input.task;
      assert.equal(body.response_format.type,'json_schema');
      const schema=body.response_format.json_schema;
      assert.match(body.messages[0].content,/corresponding original evidenceAnchors quote/);
      assert.match(body.messages[0].content,/pixels and outside knowledge cannot (?:fill|supply) missing textual support/);
      assert.match(body.messages[0].content,/material anchor without a DOM quote/);
      let output;
      if(schema.name==='knowledge_quality_repair_v1') {
        repairCalls++;
        assert.equal(schema.schema.properties.evidenceClauses.minItems,anchors);
        assert.equal(schema.schema.properties.evidenceClauses.maxItems,anchors);
        assert.deepEqual(task.knowledge.evidenceAnchors,candidate.evidenceAnchors);
        output={...repair,evidenceClauses:clauses};
      } else {
        assert.equal(schema.name,'knowledge_quality_review_v12');criticCalls++;
        if(criticCalls===2) {
          assert.deepEqual(task.knowledge.evidenceAnchors,candidate.evidenceAnchors.map((anchor,index)=>({...anchor,clause:clauses[index]})));
          assert.equal(task.knowledge.summary,repair.summary);
        }
        output=verdict(criticCalls===1?'revise':'pass');
      }
      if(schema.name==='knowledge_quality_review_v12')output=syntheticAssessment(task,output);
      return Response.json({id:'synthetic-response-'+(criticCalls+repairCalls),choices:[{finish_reason:'stop',message:{content:JSON.stringify(output)}}],usage:{prompt_tokens:1,completion_tokens:1}});
    };
    const forbidden=async()=>assert.fail('Captured review must not acquire external source data.');
    const runtime=createKnowledgeWorkflowRuntime({imagePolicy:WEBPAGE_IMAGE_POLICY,database,fetch,browser:{readPage:forbidden,readRobots:forbidden,screenshot:forbidden,close:async()=>({ok:true,value:null})},apiKey:'synthetic-not-a-secret',endpoint:'https://unexecuted.invalid/model',now,nowMs,logger,configSnapshots:configs,transition:forbidden});
    const command={run,point:candidate,sourceEvidence:{passages:candidate.evidenceAnchors.map(anchor=>anchor.quote)},sourceMode:'text'};
    const result=await runtime.reviewCapturedCandidate(command);
    assert.equal(result.ok,true,JSON.stringify(result.error));
    if(mismatch)assert.equal(result.value,null);
    else {assert.equal(result.value.point.summary,repair.summary);assert.equal(result.value.point.evidenceAnchors.length,anchors);assert.deepEqual(result.value.point.evidenceAnchors[0],{...candidate.evidenceAnchors[0],clause:clauses[0]});}
    assert.equal(repairCalls,1);assert.equal(criticCalls,mismatch?1:2);
    assert.deepEqual(await runtime.reviewCapturedCandidate(command),result);
    assert.equal(repairCalls,1);assert.equal(criticCalls,mismatch?1:2);
  } finally {db.close();}
});

test('actual adapter records completed extraction and resumes current points after quiz purge without generation or attempt reset',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'completed-reviewed-extraction-'));
 const now=()=>Date.parse('2026-10-09T00:00:00Z'),nowIso=()=>new Date(now()).toISOString();
 const {config,corpus}=createSyntheticEvaluationFixture(),item=structuredClone(corpus.cases[0]),catalog=await readFrozenEvaluationCatalog();
 item.input.material={kind:'text',fileName:'synthetic fixture',sections:[{id:'section',title:'Fixture',locator:'page:1',url:item.input.evidence.url,text:'Two constructed relationships.'}]};
 const reviewer=structuredClone(catalog);reviewer.model.id='synthetic/reviewer';reviewer.model.canonical_slug='synthetic/reviewer-v1';
 const protocol={source:'synthetic offline protocol',responseFormat:'json_schema',reasoningEffort:'high',receiptOptional:true,provider:{sort:'throughput',require_parameters:true,allow_fallbacks:true}};
 const profiles={source:'synthetic offline fixture',roles:{'knowledge-scraper':{catalog,version:catalog.model.canonical_slug,protocol},'review-grader':{catalog:reviewer,version:reviewer.model.canonical_slug,protocol}}};
 const file='scripts/benchmark-reviewed-runtime.mjs',contract={pipelineMode:REVIEWED_PIPELINE,directory,iterationId:'synthetic-iteration',grant:{id:'synthetic-grant'},sourceFiles:{[file]:createHash('sha256').update(await readFile(file)).digest('hex')}};
 const forbidden=async()=>assert.fail('Completed extraction must not generate or acquire pixels.');
 const roleDependencies={profiles,apiKey:null,modelConfig:{...config.model,name:catalog.model.id},transport:{fetch:forbidden},costPolicy:{source:'synthetic offline policy',bytesPerToken:4,visualTokensPerImage:8000}};
 let application,storage;
 try{
  application=await openReviewedBenchmark({contract,roleDependencies,imagePolicy:config.imagePolicy,now});
  const {run}=await application.forCase(item);storage=await openPositiveStorage({directory:application.directory});
  const content=new D1KnowledgeContentRepository({database:storage.database,logger:()=>{}}),quizzes=new D1QuizRepository({database:storage.database,bucket:storage.bucket,now:nowIso,logger:()=>{}});
  // Constructed preexisting reviewed points, not claimed model-derived output.
  const points=['retained','purged'].map(id=>({...point,id,sourceId:item.id,normalizedHash:id,summary:id+' relationship.',evidenceAnchors:[{url:item.input.evidence.url,selector:'page:1'}]}));
  for(const p of points)assert.equal((await content.appendKnowledgePoint(p,run.ownerId,run.runId,nowIso())).ok,true);
  let calls=0;
  const command={item,generate:async()=>{calls++;return {ok:true,value:{pages:[{url:item.input.evidence.url,notes:'No additional supported relationships.',candidates:[]}]}};},decodeImage:forbidden,deadline:now()+60000,maximumPages:1};
  const completed=await application.extract(command);assert.equal(completed.ok,true,JSON.stringify(completed.error));assert.equal(calls,1);assert.deepEqual(completed.value.points.map(p=>p.id).sort(),['purged','retained']);
  assert.equal((await quizzes.appendAttempt({ownerId:run.ownerId,runId:run.runId,id:'attempt-1',knowledgeId:'purged',attempt:1,draftId:null,score:null,feedback:null,failureKind:'QuizDraftSchemaInvalid',createdAt:nowIso()})).ok,true);
  assert.equal((await quizzes.appendAttempt({ownerId:run.ownerId,runId:run.runId,id:'attempt-retained',knowledgeId:'retained',attempt:2,draftId:null,score:null,feedback:null,failureKind:'QuizDraftSchemaInvalid',createdAt:nowIso()})).ok,true);
  assert.equal((await quizzes.discard({ownerId:run.ownerId,runId:run.runId,knowledgeId:'purged',reason:'no-meaningful-quiz'})).ok,true);
  const receipt=storage.sqlite.prepare("SELECT * FROM knowledge_workflow_stages WHERE stage_key='reviewed-benchmark-extraction'").get();assert.equal(receipt.status,'completed');
  const tombstones=storage.sqlite.prepare('SELECT * FROM knowledge_workflow_purge_tombstones').all(),retryAttempts=storage.sqlite.prepare('SELECT * FROM knowledge_workflow_quiz_retry_attempts').all();assert.equal(tombstones.length,1);assert.equal(retryAttempts.length,1);
  await application.close();application=await openReviewedBenchmark({contract,roleDependencies,imagePolicy:config.imagePolicy,now});
  const resumed=await application.extract({...command,generate:forbidden});assert.equal(resumed.ok,true,JSON.stringify(resumed.error));assert.deepEqual(resumed.value.points.map(p=>p.id),['retained']);assert.deepEqual(resumed.value.predictions.map(p=>p.summary),['retained relationship.']);
  assert.deepEqual(storage.sqlite.prepare("SELECT * FROM knowledge_workflow_stages WHERE stage_key='reviewed-benchmark-extraction'").get(),receipt);
  assert.deepEqual(storage.sqlite.prepare('SELECT * FROM knowledge_workflow_purge_tombstones').all(),tombstones);assert.deepEqual(storage.sqlite.prepare('SELECT * FROM knowledge_workflow_quiz_retry_attempts').all(),retryAttempts);
  const changedContract={...contract,sourceFiles:{...contract.sourceFiles,'worker/webpage-facts.js':'changed-protocol'}};
  await application.close();application=await openReviewedBenchmark({contract:changedContract,roleDependencies,imagePolicy:config.imagePolicy,now});
  assert.deepEqual(await application.extract({...command,generate:forbidden}),{ok:false,error:{kind:'WorkflowStageInputChanged'}});
  // A different, incomplete case does not inherit a fabricated completion receipt.
  const incomplete=structuredClone(item);incomplete.id='incomplete';incomplete.input.evidence.url='https://incomplete.synthetic.invalid/';incomplete.input.material.sections[0].url=incomplete.input.evidence.url;
  const failed=await application.extract({...command,item:incomplete,generate:async()=>({ok:false,error:{kind:'KnowledgeModelUnavailable'}})});assert.equal(failed.ok,false);
  const incompleteRun=(await application.forCase(incomplete)).run;
  assert.equal(storage.sqlite.prepare("SELECT status FROM knowledge_workflow_stages WHERE run_id=? AND stage_key='reviewed-benchmark-extraction'").get(incompleteRun.runId).status,'claimed');
 }finally{await application?.close();await storage?.close();await rm(directory,{recursive:true,force:true});}
});
