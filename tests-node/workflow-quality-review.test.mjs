import {knowledgeReviewAuditInput,knowledgeReviewTokens,knowledgeReviewerPrompt,knowledgeRepairPrompt,knowledgeRepairSchemaFor,knowledgeCriticRepairContextPrompt} from '../src/features/knowledge-workflows/quality-review.js';
import {syntheticAssessment,syntheticReviewAudit,auditedVerdict} from './fixtures/knowledge-review-audit.mjs';
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
import {AgentExecutionBoundaryFailure} from '../src/features/knowledge-workflows/harness.js';

const point={id:'knowledge:source:1:original',sourceId:'source',sourceRevision:1,summary:'An unsupported and duplicated broad claim.',normalizedHash:'original',evidenceAnchors:[{url:'https://example.test/',selector:'p',blockId:'b',quote:'Captured immutable relationship.',clause:'Unsupported claim.',quoteDigest:'sha256:original'}],coverageGoalIds:['core'],mediaCandidates:[],attribution:{sourceUrl:'https://example.test/'},extractionVersion:'v1'};
const context={lessOften:[{id:'unwanted',summary:'An unwanted concept.'}],previousKnowledge:[{id:'previous',summary:'A previously covered idea.'}],previousQuizzes:[]};
const verdict=(decision,other={})=>({decision,reasons:['Source-backed concrete reason.'],feedback:'Narrow to the supported distinct relationship.',matchedLessOftenIds:decision==='drop-see-less'?['unwanted']:[],supportingImageEvidence:'',allowTextOnly:true,...other});
const repair={summary:'A supported distinct relationship.',coverageGoalIds:['core'],useSupportingImage:false,evidenceClauses:['Captured immutable relationship.']};
const reviewer=(evaluate,regenerate,mode='text')=>createKnowledgeQualityReviewer({context,sourceMode:mode,evaluate:async(p,attempt)=>{const r=await evaluate(p,attempt);return r.ok?{ok:true,value:auditedVerdict(p,r.value,mode)}:r;},regenerate,digest:async()=> 'sha256:repaired'});

for(const field of ['review','repair'])for(const invalidOutput of [false,true])test(`retry metrics include ${field} ${invalidOutput?'invalid output':'technical failure'} without counting exhaustion`,async()=>{
 const entries=[];let reviews=0,repairs=0;
 const failed=invalidOutput?{ok:true,value:{}}:{ok:false,error:{kind:'KnowledgeModelResponseInvalid'}};
 const result=await createKnowledgeQualityReviewer({context,sourceMode:'text',logger:entry=>entries.push(entry),digest:async()=>assert.fail('Exhausted repair cannot commit'),
  evaluate:async(p)=>{reviews++;return field==='review'?failed:{ok:true,value:auditedVerdict(p,verdict('revise'))};},
  regenerate:async()=>{repairs++;return failed;},
 }).review(point);
 assert.equal(result.ok,false);assert.equal(result.error.technicalAttempts,4);
 assert.equal(reviews,field==='review'?4:1);assert.equal(repairs,field==='repair'?4:0);
 assert.deepEqual(entries.map(({event,field:phase,failureKind,count})=>({event,field:phase,failureKind,count})),[1,2,3].map(count=>({event:'knowledge-quality-technical-retry',field,failureKind:invalidOutput?(field==='review'?'KnowledgeReviewOutputInvalid':'KnowledgeRepairOutputInvalid'):'KnowledgeModelResponseInvalid',count})));
});

test('review retry metrics exclude terminal failures and disabled retries',async()=>{
 for(const technicalRetries of [false,true]) {
  const entries=[];let calls=0;
  const result=await createKnowledgeQualityReviewer({context,sourceMode:'text',technicalRetries,logger:entry=>entries.push(entry),digest:async()=>assert.fail('No repair'),regenerate:async()=>assert.fail('No repair'),evaluate:async()=>{calls++;return {ok:false,error:{kind:technicalRetries?'KnowledgeModelCredentialRejected':'KnowledgeModelResponseInvalid'}};}}).review(point);
  assert.equal(result.ok,false);assert.equal(calls,1);assert.deepEqual(entries,[]);
 }
});

test('unknown response fields use four technical critiques without spending a quality revision',async()=>{
 for(const validSecond of [true,false]) {
  let calls=0;
  const extra={...auditedVerdict(point,verdict('pass')),'':''};
  const result=await createKnowledgeQualityReviewer({context,sourceMode:'text',digest:async()=>assert.fail('No repair'),regenerate:async()=>assert.fail('No repair'),evaluate:async(_point,attempt,history,technicalAttempt)=>{calls++;assert.equal(attempt,1);assert.equal(technicalAttempt,calls);assert.equal(history,undefined);return {ok:true,value:calls===2&&validSecond?auditedVerdict(point,verdict('pass')):extra};}}).review(point);
  assert.equal(calls,validSecond?2:4);assert.equal(result.ok,validSecond);
  if(!validSecond)assert.equal(result.error.kind,'KnowledgeReviewOutputInvalid');
  assert.equal(extra[''],'');
 }
});
test('unknown fields cannot renew an assessment with invalid evidence spans',async()=>{
 let calls=0;const invalid={...auditedVerdict(point,verdict('pass')),'':''};invalid.audit.finalClause.textEvidence[0].end=99999;
 const result=await createKnowledgeQualityReviewer({context,sourceMode:'text',digest:async()=>assert.fail('No repair'),regenerate:async()=>assert.fail('No repair'),evaluate:async()=>{calls++;return {ok:true,value:invalid};}}).review(point);
 assert.deepEqual(result,{ok:false,error:{kind:'KnowledgeReviewOutputInvalid',attempts:4,technicalAttempts:4,technicalRetriesExhausted:true}});assert.equal(calls,4);
});

test('owner see-less meaning match drops immediately without regeneration',async()=>{
  let repairs=0;
  const result=await reviewer(async()=>({ok:true,value:verdict('drop-see-less')}),async()=>{repairs++;throw new Error('Forbidden repair');}).review(point);
  assert.deepEqual(result,{ok:true,value:null});assert.equal(repairs,0);
});
test('quality failure is regenerated once with actionable feedback, re-reviewed and provenance preserved',async()=>{
  const seen=[];
  const result=await reviewer(async(p,attempt)=>{seen.push({p,attempt});return {ok:true,value:verdict(attempt===1?'revise':'pass')};},async(p,v)=>{assert.equal(p,point);assert.match(v.feedback,/Narrow/);return {ok:true,value:repair};}).review(point);
  assert.equal(result.ok,true);assert.equal(result.value.point.summary,repair.summary);assert.equal(result.value.point.normalizedHash,'sha256:repaired');
  assert.equal(result.value.point.evidenceAnchors[0].quote,point.evidenceAnchors[0].quote);assert.equal(result.value.point.evidenceAnchors[0].quoteDigest,point.evidenceAnchors[0].quoteDigest);assert.equal(result.value.point.evidenceAnchors[0].clause,repair.evidenceClauses[0]);assert.deepEqual(seen.map(x=>x.attempt),[1,2]);
});
test('second quality failure drops rather than generating a third output',async()=>{
  let calls=0,repairs=0;
  const result=await reviewer(async()=>{calls++;return {ok:true,value:verdict('revise')};},async()=>{repairs++;return {ok:true,value:repair};}).review(point);
  assert.deepEqual(result,{ok:true,value:null});assert.equal(calls,2);assert.equal(repairs,1);
});

// Synthetic responses exercise production dispatch and validation, not model accuracy.
const productionCases=[...[1,3].flatMap(anchors=>[false,true].map(mismatch=>({anchors,mismatch,media:'none'}))),...['text-remove','text-keep','raster-keep','raster-remove','reasoning-only','raw-pass-gap-keep','raw-pass-gap-remove','reliability-only','both-negative','basis-null','history-negative','history-gap','history-null-basis','legacy-config-claims','cached-legacy-context','deadline-before','deadline-expired','deadline-null-valid','deadline-null-invalid','deadline-null-read-failure','deadline-inflight','repair-technical-feedback','legacy-repair-technical-feedback','repair-legacy-read-failure'].map(media=>({anchors:1,mismatch:false,media}))];
for(const {anchors,mismatch,media} of productionCases)test(`production repair schema fixes ${anchors} immutable anchors; mismatched count=${mismatch}; media=${media}`,async()=>{
  const db=new DatabaseSync(':memory:');
  try {
    for(const name of (await readdir('worker/migrations')).filter(name=>name.endsWith('.sql')).sort())db.exec(await readFile('worker/migrations/'+name,'utf8'));
    const database={prepare(sql){let values=[];const execute=()=>({success:true,meta:{changes:Number(db.prepare(sql).run(...values).changes)}});return {bind(...v){values=v;return this;},first:async()=>{if(media==='deadline-null-read-failure'&&sql.startsWith('SELECT extraction_deadline_at FROM knowledge_workflow_runs'))throw new Error('Constructed clock read failure');if(media==='repair-legacy-read-failure'&&sql.startsWith('SELECT stage_key FROM knowledge_workflow_stages'))throw new Error('Synthetic legacy lookup read failure');return db.prepare(sql).get(...values)??null;},all:async()=>({success:true,results:db.prepare(sql).all(...values)}),run:async()=>execute(),execute};},async batch(statements){db.exec('BEGIN IMMEDIATE');try{const result=statements.map(s=>s.execute());db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}}};
    const unwrap=result=>{assert.equal(result.ok,true,JSON.stringify(result.error));return result.value;};
    const now=()=> '2026-10-09T00:00:00.000Z';let dispatchNow=Date.parse(now());const nowMs=()=>dispatchNow,logs=[],logger=entry=>logs.push(entry);
    const loader=createAgentConfigurationLoader({sha256:async value=>'sha256:'+createHash('sha256').update(value).digest('hex')}),configs={};
    for(const role of ['rights-assessor','knowledge-scraper','question-generator','question-evaluator'])configs[role]=unwrap(await loader.load({source:await readFile('agent-config/'+role+'.yaml','utf8'),expectedRole:role}));
    const repository=new D1KnowledgeWorkflowRepository({database,logger}),service=createKnowledgeWorkflowService(repository,{now,createId:()=> 'synthetic-run',logger});
    let run=unwrap(await service.createRun({ownerId:'synthetic-owner',sourceId:point.sourceId,sourceRevision:1,canonicalSourceIdentity:point.attribution.sourceUrl,contentSignature:'synthetic-source',idempotencyKey:'synthetic-run',configDigests:Object.fromEntries(Object.entries(configs).map(([role,config])=>[role,config.digest]))})).run;
    for(const nextState of ['rights-assessment','robots-check','extraction-loop'])run=unwrap(await service.advance({ownerId:run.ownerId,runId:run.runId,expectedRevision:run.revision,nextState}));
    if(media==='deadline-before')dispatchNow=Date.parse(run.extractionDeadlineAt)-10000;
    if(media==='deadline-expired')dispatchNow=Date.parse(run.extractionDeadlineAt);
    if(media.startsWith('deadline-null')){run={...run,extractionDeadlineAt:null};if(media==='deadline-null-invalid')db.prepare('UPDATE knowledge_workflow_runs SET extraction_deadline_at=NULL WHERE run_id=?').run(run.runId);}
    const candidate={...point,evidenceAnchors:Array.from({length:anchors},(_,index)=>({...point.evidenceAnchors[0],blockId:'block-'+index,quote:'Immutable passage '+index,quoteDigest:'sha256:passage-'+index}))};
    const findOuter=()=>db.prepare('SELECT stage_key,input_digest,result_json FROM knowledge_workflow_stages WHERE owner_id=? AND run_id=? AND stage_key LIKE ?').get(run.ownerId,run.runId,'knowledge-quality:%:'+candidate.id);
    let legacyRows,legacySignature;
    if(media==='legacy-config-claims'){
      const evaluatorSource=await readFile('agent-config/question-evaluator.yaml','utf8'),previousEvaluator=unwrap(await loader.load({source:evaluatorSource.replace(/version: question-evaluator-v\d+/,'version: question-evaluator-v5').replace(/name: [^\n]+/,'name: mistralai/mistral-large-4-0').replace('timeoutMs: 120000','timeoutMs: 30000'),expectedRole:'question-evaluator'})),oldConfigDigests={...run.configDigests,'question-evaluator':previousEvaluator.digest};assert.notEqual(previousEvaluator.digest,configs['question-evaluator'].digest);
      const legacyEvidence={passages:candidate.evidenceAnchors.map(anchor=>anchor.quote),images:[{id:'source-only-image',alt:'Captured source image metadata is not an attachment.'}]},digest=value=>'sha256:'+createHash('sha256').update(value).digest('hex');
      legacySignature=digest(JSON.stringify({point:candidate,evidenceDigest:digest(JSON.stringify(legacyEvidence)),sourceMode:'text',imagePurpose:'evidence',protocol:{review:knowledgeReviewerPrompt,repair:knowledgeRepairPrompt,repairContext:knowledgeCriticRepairContextPrompt,maximumCriticOutputTokens:4096},config:oldConfigDigests,attachments:[]}));
      db.prepare("INSERT INTO knowledge_workflow_stages(owner_id,run_id,stage_key,input_digest,status,created_at) VALUES(?,?,?,?,'claimed',?)").run(run.ownerId,run.runId,'knowledge-quality:'+candidate.id,legacySignature,now());
      db.prepare("INSERT INTO knowledge_workflow_stages(owner_id,run_id,stage_key,input_digest,status,result_json,created_at,completed_at) VALUES(?,?,?,?,'completed',?,?,?)").run(run.ownerId,run.runId,'knowledge-quality-context:'+candidate.id,legacySignature,JSON.stringify({ok:true,value:{lessOften:[{id:'legacy-preference-must-not-replay',summary:'Synthetic legacy-only context.'}],previousKnowledge:[],previousQuizzes:[]}}),now(),now());
      legacyRows=db.prepare('SELECT * FROM knowledge_workflow_stages WHERE stage_key IN (?,?) ORDER BY stage_key').all('knowledge-quality:'+candidate.id,'knowledge-quality-context:'+candidate.id);
    }
    const clauses=Array.from({length:anchors+(mismatch?1:0)},(_,index)=>'Supported clause '+index);
    const attached=media.startsWith('text-')||media.startsWith('raster-')||media.startsWith('raw-pass-'),keep=media.endsWith('-keep'),sourceMode=media.startsWith('raster')?'image':'text';
    const image={id:sourceMode==='image'?'source-image':'optional-image',mediaType:'image/png',bytes:Uint8Array.from([137,80,78,71,13,10,26,10])};
    if(attached)candidate.mediaCandidates=[{visualId:image.id}];
    const sourceEvidence={passages:candidate.evidenceAnchors.map(anchor=>anchor.quote),images:[{id:'source-only-image',alt:'Captured source image metadata is not an attachment.'}]};
    const legacyContext={lessOften:[],previousKnowledge:[],previousQuizzes:[{prompt:'Which synthetic control stops flow?',answer:'The closed valve.',pairedQuiz:{multipleChoice:{id:'quiz:legacy:mcq',kind:'single-choice',prompt:'Which synthetic control stops flow?',options:[{key:'A',text:'The closed valve.'},{key:'B',text:'An open path.'}],correctOptionKeys:['A'],canonicalAnswers:['valve'],explanation:'A closed valve blocks the synthetic flow.'},fillBlank:{id:'quiz:legacy:fill',kind:'fill-blank',prompt:'The closed ____ stops flow.',blanks:[{id:'blank-1',canonicalAnswer:'valve',acceptedAnswers:['valve']}],canonicalAnswers:['valve'],explanation:'The valve is the control.'},canonicalAnswers:['valve'],citedEvidenceUrls:['https://example.test/synthetic-legacy']}}]};
    let legacyContextRow;
    if(media==='cached-legacy-context'){
      const digest=value=>'sha256:'+createHash('sha256').update(value).digest('hex');
      const signature=digest(JSON.stringify({point:candidate,evidenceDigest:digest(JSON.stringify(sourceEvidence)),sourceMode,imagePurpose:'evidence',retrySuffix:'',protocol:{review:knowledgeReviewerPrompt,repair:knowledgeRepairPrompt,repairContext:knowledgeCriticRepairContextPrompt,maximumCriticOutputTokens:4096},config:run.configDigests,attachments:[]}));
      const key=`knowledge-quality-context:${signature}:${candidate.id}`;
      db.prepare("INSERT INTO knowledge_workflow_stages(owner_id,run_id,stage_key,input_digest,status,result_json,created_at,completed_at) VALUES(?,?,?,?,'completed',?,?,?)").run(run.ownerId,run.runId,key,signature,JSON.stringify({ok:true,value:legacyContext}),now(),now());
      legacyContextRow=db.prepare('SELECT * FROM knowledge_workflow_stages WHERE stage_key=?').get(key);
    }
    let criticCalls=0,repairCalls=0,firstRaw,firstCanonical,firstRepairInput,legacyRepairRows;
    const fetch=async(_url,init)=>{
      const body=JSON.parse(init.body),message=body.messages[1].content;
      const envelope=Array.isArray(message)?message[0].text:message,input=JSON.parse(envelope.slice(envelope.indexOf('\n')+1,envelope.lastIndexOf('\n'))),task=input.task;
      assert.equal(body.response_format.type,'json_schema');
      if(body.response_format.json_schema.name==='webpage_image_purpose_v1') {
        assert.equal(Object.hasOwn(task,'sourceEvidence'),false,'Pixel-only purpose check excludes source prose and prior critic output');
        return Response.json({id:'synthetic-purpose',choices:[{finish_reason:'stop',message:{content:JSON.stringify({purpose:'evidence',imageId:task.imageId,imageDigest:task.imageDigest,visibleEvidence:'Constructed directly depicted relationship.'})}}],usage:{prompt_tokens:1,completion_tokens:1}});
      }
      assert.deepEqual(task.sourceEvidence,sourceEvidence);
      assert.equal(Object.hasOwn(task,'previousKnowledge'),false,'Canonical audit retains prior knowledge once');
      assert.equal(Object.hasOwn(task,'previousQuizzes'),false,'Canonical audit retains prior quizzes once');
      assert.deepEqual(input.memory,[]);
      const pixels=Array.isArray(message)?message.filter(part=>part.type==='image_url'):[];
      const schema=body.response_format.json_schema;
      let output;
      if(schema.name==='knowledge_quality_repair_v1') {
        repairCalls++;
        if(repairCalls===1){assert.equal(Object.hasOwn(task,'technicalRetryFeedback'),false);firstRepairInput=structuredClone(task);}
        if(media==='repair-technical-feedback'&&repairCalls===2){const {technicalRetryFeedback,...unchanged}=task;assert.deepEqual(unchanged,firstRepairInput);assert.equal(technicalRetryFeedback.failureKind,'KnowledgeRepairOutputInvalid');assert.deepEqual(technicalRetryFeedback.issues,['RepairEvidenceClausesInvalid']);assert.match(technicalRetryFeedback.instructions,/exactly 1 nonempty strings/);}
        if(media==='legacy-repair-technical-feedback'&&repairCalls===1){
          const signature='sha256:'+createHash('sha256').update(JSON.stringify({sourceSignature:run.contentSignature,configDigest:configs['knowledge-scraper'].digest,systemPrompt:knowledgeRepairPrompt,input:task,maxOutputTokens:16384,responseSchema:knowledgeRepairSchemaFor(candidate),attachments:[]})).digest('hex');
          // Constructed pre-patch history: attempt two returned malformed data; attempt three was dispatched with unknown outcome.
          for(const attempt of [2,3])db.prepare('INSERT INTO knowledge_workflow_stages(owner_id,run_id,stage_key,input_digest,status,result_json,created_at,completed_at) VALUES(?,?,?,?,?,?,?,?)').run(run.ownerId,run.runId,`knowledge-scraper:knowledge-repair-${candidate.id}:technical-${attempt}:${signature}`,signature,attempt===2?'completed':'claimed',attempt===2?JSON.stringify({ok:true,value:{...repair,useSupportingImage:false,evidenceClauses:[]}}):null,now(),attempt===2?now():null);
        }
        if(media==='legacy-repair-technical-feedback'&&repairCalls===2){assert.equal(task.technicalRetryFeedback.failureKind,'KnowledgeRepairOutputInvalid');assert.deepEqual(task.technicalRetryFeedback.issues,['RepairEvidenceClausesInvalid']);}
        firstCanonical=structuredClone(task.review);assert.deepEqual(task.retrievalComparison,firstRaw.retrievalComparison);
        assert.equal(body.model,'z-ai/glm-5.3-flash');
        assert.equal(body.reasoning.effort,'high');
        assert.equal(body.max_tokens,16384,'final physical native repair wire preserves existing high-reasoning output allowance');
        assert.deepEqual(task.currentAttachmentIds,attached?[image.id]:[]);
        assert.equal(pixels.length,attached?1:0);
        assert.match(body.messages[0].content,/summary and evidenceClauses must contain source-taught knowledge only/);assert.match(body.messages[0].content,/Each source\/prior citation must stay within its own referenced list's endExclusiveTokenCount/);
        assert.match(body.messages[0].content,/shared entities, subject labels or a prior general definition alone do not establish duplication/);assert.match(body.messages[0].content,/Complementary or opposite-direction relationships are not duplicates merely because they are symmetric or share an endpoint/);assert.match(body.messages[0].content,/Faithful source paraphrase can teach that useful relationship/);assert.match(body.messages[0].content,/do not add original interpretation or outside knowledge/);assert.match(body.messages[0].content,/Repair concrete correctness, clarity or scope defects within the retained evidence/);assert.match(body.messages[0].content,/Cross-check retained source roles, locations and relationships against the supplied captured context for internal conflicts/);assert.match(body.messages[0].content,/Faithfully copying a conflicting role\/location\/relationship/);assert.match(body.messages[0].content,/With an optional image, narrow an unpictured nonessential role\/location qualifier/);
        assert.match(body.messages[0].content,/inspect all relevant labeled initial and final states, panels, curves and endpoints/);assert.match(body.messages[0].content,/never infer unshown stages or conditions/);
        assert.match(body.messages[0].content,/review.decision and review.audit.revisionReason are binding/);assert.match(body.messages[0].content,/shared broad purpose, category or conclusion/);assert.match(body.messages[0].content,/identify a separate concrete quality defect rather than claiming complete prior coverage/);assert.match(body.messages[0].content,/Empty prior citations never require pass/);assert.match(body.messages[0].content,/treat them as hypotheses and follow only source-established corrections/);assert.match(body.messages[0].content,/establish direction from visible arrowheads and connected labeled endpoints/);assert.match(body.messages[0].content,/These boundaries apply even when the listed ranges are empty/);assert.match(body.messages[0].content,/Do not repair unsupported causal certainty solely by adding attribution or a probability caveat/);assert.match(body.messages[0].content,/Preserve and address critic semantic reasons within these same evidence boundaries/);if(!media.startsWith('raw-pass-'))assert.deepEqual(task.requiredRevisions,{sourceClauses:[],imageClauses:[],duplicateClauses:[]});
        if(media==='reliability-only'||media==='both-negative'){assert.equal(task.review.decision,'revise');assert.equal(task.review.audit.revisionReason,'quality');assert(task.review.reasons.includes('Synthetic captured evidence does not establish the claimed causal strength.'));assert.match(task.review.feedback,/Source reliability requires revision/);assert(!task.review.feedback.includes('Keep everything'));assert.equal(Object.hasOwn(task.review,'sourceReliability'),false);assert.match(body.messages[0].content,/preserved source reliability reason and missing captured evidential basis are also binding repair obligations/);if(media==='both-negative')assert.match(task.review.feedback,/preserved critic semantic reasons/);}
        if(media==='basis-null'){assert.equal(task.review.decision,'revise');assert.equal(task.review.audit.revisionReason,'quality');assert(task.review.reasons.includes('No captured evidential basis establishes the relationship at the claimed strength.'));assert.match(task.review.feedback,/Source reliability requires revision: No captured evidential basis/);assert(!task.review.feedback.includes('Keep everything'));assert.equal(Object.hasOwn(task.review,'sourceReliability'),false);}
        if(media.startsWith('raw-pass-')){assert.equal(task.review.decision,'revise');assert.equal(task.review.audit.revisionReason,'image');assert.equal(task.review.allowTextOnly,false);assert.notEqual(task.review.feedback,'Keep everything; no regeneration needed.');assert.match(task.review.feedback,/requiredRevisions.imageClauses/);assert.deepEqual(task.requiredRevisions.sourceClauses,[]);assert.deepEqual(task.requiredRevisions.imageClauses,[{start:0,end:task.auditEvidence.summaryTokenCount}]);assert.deepEqual(task.requiredRevisions.duplicateClauses,[]);}
        assert.equal(schema.schema.properties.evidenceClauses.minItems,anchors);
        assert.equal(schema.schema.properties.evidenceClauses.maxItems,anchors);
        assert.deepEqual(task.knowledge.evidenceAnchors,candidate.evidenceAnchors);
        if(media==='reasoning-only')return Response.json({id:'synthetic-reasoning-only',choices:[{finish_reason:'length',message:{content:null}}],usage:{prompt_tokens:1,completion_tokens:16384,completion_tokens_details:{reasoning_tokens:16384}}});
        output={...repair,useSupportingImage:keep,evidenceClauses:clauses};
        if(['repair-technical-feedback','legacy-repair-technical-feedback','repair-legacy-read-failure'].includes(media)&&repairCalls===1)output.evidenceClauses=[];
      } else {
        assert.equal(schema.name,'knowledge_quality_review_v12');assert.match(body.messages[0].content,/relevant domain knowledge solely to flag a likely source error or unsupported certainty/);assert.match(body.messages[0].content,/model memory is not evidence, external verification or a certain correction/);criticCalls++;assert(schema.schema.required.includes('sourceReliability'));assert(schema.schema.required.includes('retrievalComparison'));assert.deepEqual(schema.schema.properties.retrievalComparison.anyOf[0].required,['question','answer','priorAnswer','priorEvidence','reason']);assert.match(body.messages[0].content,/then the answer actually taught by cited prior content/);assert.equal(Object.keys(schema.schema.properties)[0],'retrievalComparison');assert.deepEqual(schema.schema.properties.sourceReliability.anyOf[0].required,['basis','decision','reason']);assert.equal(Object.keys(schema.schema.properties.sourceReliability.anyOf[0].properties)[0],'basis');assert.equal(schema.schema.properties.sourceReliability.anyOf.length,1);assert.match(body.messages[0].content,/null basis or sourceReliability=revise remains a negative independently of qualityDecision/);
        assert.equal(body.max_tokens,4096,'critic uses existing reviewer4096 ceiling');
        assert.equal(body.model,configs['question-evaluator'].model.name);
        assert.deepEqual(task.auditEvidence.retainedText,candidate.evidenceAnchors.map((anchor,anchorIndex)=>({anchorIndex,tokens:knowledgeReviewTokens(anchor.quote).map((token,index)=>index+':'+token),endExclusiveTokenCount:knowledgeReviewTokens(anchor.quote).length})));
        assert.equal(task.auditEvidence.summaryTokenCount,knowledgeReviewTokens(task.knowledge.summary).length);assert.equal(task.auditEvidence.summaryNonFinalEndMaximum,Math.max(0,[...new Intl.Segmenter('en',{granularity:'word'}).segment(task.knowledge.summary)].filter(t=>t.segment.trim()).findLastIndex(t=>t.isWordLike===true)));assert.match(body.messages[0].content,/summaryNonFinalEndMaximum/);
        assert.deepEqual(schema.schema.properties.qualityDecision.enum,['pass','revise']);assert.equal(Object.hasOwn(schema.schema.properties,'decision'),false);assert.equal(Object.hasOwn(schema.schema.properties.audit.properties,'novelty'),false);assert.equal(Object.hasOwn(schema.schema.properties.audit.properties,'revisionReason'),false);
        const clauseProperties=schema.schema.properties.audit.properties.clauses.items.properties;
        assert.deepEqual(schema.schema.properties.audit.properties.version.enum,[8]);
        assert.equal(Object.hasOwn(clauseProperties,'claim'),false);
        assert.equal(clauseProperties.claimEnd.maximum,task.auditEvidence.summaryNonFinalEndMaximum);
        assert.equal(clauseProperties.claimEnd.type,'integer');assert.deepEqual(schema.schema.properties.audit.properties.finalClause.anyOf[0].required,['textEvidence','pixelEvidence','previousEvidence','supportsWholeClaim']);assert.equal(Object.hasOwn(schema.schema.properties.audit.properties.finalClause.anyOf[0].properties,'claimEnd'),false);
        assert.deepEqual(task.auditEvidence.previousContent,media==='cached-legacy-context'?knowledgeReviewAuditInput(task.knowledge,legacyContext,sourceEvidence).previousContent:[]);
        if(media==='cached-legacy-context')assert(task.auditEvidence.previousContent.some(item=>item.id==='quiz:0'));
        const sourceCitation=schema.schema.properties.audit.properties.finalClause.anyOf[0].properties.textEvidence.items;
        assert.equal(sourceCitation.type,'object');assert.equal(sourceCitation.additionalProperties,false);assert.deepEqual(sourceCitation.required,['anchorIndex','start','end']);
        assert.deepEqual(sourceCitation.properties.anchorIndex.enum,Array.from({length:anchors},(_,index)=>index));assert.deepEqual(sourceCitation.anyOf.map(branch=>({anchorIndex:(branch.properties.anchorIndex.enum??sourceCitation.properties.anchorIndex.enum)[0],startMaximum:branch.properties.start.maximum,endMaximum:branch.properties.end.maximum})),candidate.evidenceAnchors.map((anchor,anchorIndex)=>({anchorIndex,startMaximum:knowledgeReviewTokens(anchor.quote).length-1,endMaximum:knowledgeReviewTokens(anchor.quote).length})));assert.match(body.messages[0].content,/summaryTokenCount bounds only the summary/);
        const expectedAttached=attached&&(criticCalls===1||keep);
        assert.deepEqual(task.currentAttachmentIds,expectedAttached?[image.id]:[]);
        assert.equal(pixels.length,expectedAttached?1:0);
        assert.match(body.messages[0].content,/Captured source image metadata, captions, alt text/);
        assert.match(body.messages[0].content,/inspect all relevant labeled initial and final states, panels, curves and endpoints/);assert.match(body.messages[0].content,/An initial condition alone cannot establish or contradict a depicted final outcome/);
        assert.match(body.messages[0].content,/an unused optional source image alone is not a failure/);assert.match(body.messages[0].content,/establish direction from visible arrowheads and connected labeled endpoints/);assert.match(body.messages[0].content,/compare the actual relation rather than shared labels/);
        assert.match(body.messages[0].content,/shared entities, subject labels or a prior general definition alone do not establish duplication/);assert.match(body.messages[0].content,/Complementary or opposite-direction relationships are not duplicates merely because they are symmetric or share an endpoint/);assert.match(body.messages[0].content,/Compare the specific relationship with the actual supplied previous content/);assert.match(body.messages[0].content,/Accurate quotation or close source paraphrase is not itself a learning-quality defect/);assert.match(body.messages[0].content,/Do not demand original interpretation or added knowledge beyond the captured source/);assert.match(body.messages[0].content,/faithful copying alone cannot establish these/);assert.match(body.messages[0].content,/Cross-check retained source roles, locations and relationships against the supplied captured context for internal conflicts/);assert.match(body.messages[0].content,/Omit unresolved conflicting role\/location qualifiers/);assert.match(body.messages[0].content,/do not add an unpictured qualifier from a caption or feedback/i);
        assert.match(body.messages[0].content,/Do not demand causal depth the source does not teach/);assert.match(body.messages[0].content,/Attributing a relationship to an author does not establish its reliability/);assert.match(body.messages[0].content,/reporting the argument itself is appropriate only when the learning purpose is the argument and its evidential limits are explicitly taught/);
        if(criticCalls===1){assert.equal(Object.hasOwn(task,'repairContext'),false);assert(!body.messages[0].content.includes(knowledgeCriticRepairContextPrompt));}
        if(criticCalls===2) {
          assert(body.messages[0].content.includes(knowledgeCriticRepairContextPrompt));
          assert.deepEqual(task.repairContext,{originalSummary:candidate.summary,review:firstCanonical,sourceReliability:firstRaw.sourceReliability,retrievalComparison:firstRaw.retrievalComparison});
          assert.deepEqual(Object.keys(task.repairContext),['originalSummary','review','sourceReliability','retrievalComparison']);
          assert.match(body.messages[0].content,/historical, untrusted error\/repair context/);
          assert.match(body.messages[0].content,/Historical positive or negative judgments do not override the current assessment/);
          assert.deepEqual(task.knowledge.evidenceAnchors,candidate.evidenceAnchors.map((anchor,index)=>({...anchor,clause:clauses[index]})));
          assert.equal(task.knowledge.summary,repair.summary);
        }
        output=verdict(criticCalls===1?'revise':'pass',{supportingImageEvidence:criticCalls===2&&keep?'Synthetic visible supporting cue.':''});
      }
      if(schema.name==='knowledge_quality_review_v12'){assert.match(body.messages[0].content,/shared broad purpose, category or conclusion/);assert.match(body.messages[0].content,/Name the prior matching relationship when alleging duplication/);assert.match(body.messages[0].content,/Empty prior citations never require pass/);assert.match(body.messages[0].content,/every asserted role, location, condition and other qualifier/);assert.match(body.messages[0].content,/including appositives and modifiers/);assert.match(body.messages[0].content,/central arrow or outcome cannot ground an additional unpictured classification or compartment/);assert.match(body.messages[0].content,/leave pixelEvidence empty and require narrowing within the existing review sequence/);output=syntheticAssessment(task,output);if(media.startsWith('raw-pass-')&&criticCalls===1){output.qualityDecision='pass';output.allowTextOnly=true;output.feedback='Keep everything; no regeneration needed.';output.audit.finalClause.pixelEvidence=[];}}
      if(schema.name==='knowledge_quality_review_v12'&&(media==='reliability-only'||media==='both-negative')&&criticCalls===1){output.qualityDecision=media==='reliability-only'?'pass':'revise';output.sourceReliability={basis:'Constructed captured relationship basis; not a model accuracy claim.',decision:'revise',reason:'Synthetic captured evidence does not establish the claimed causal strength.'};output.feedback='Keep everything; no regeneration needed.';}
      if(schema.name==='knowledge_quality_review_v12'&&media==='basis-null'&&criticCalls===1){output.qualityDecision='pass';output.sourceReliability={basis:null,decision:'pass',reason:'Synthetic positive assertion fidelity is not a captured basis.'};output.feedback='Keep everything; no regeneration needed.';}
      if(schema.name==='knowledge_quality_review_v12'){if(criticCalls===1)firstRaw=structuredClone(output);if(criticCalls===2&&media==='history-negative')output.qualityDecision='revise';if(criticCalls===2&&media==='history-gap')output.audit.finalClause.textEvidence=[];if(criticCalls===2&&media==='history-null-basis')output.sourceReliability.basis=null;}
      if(media==='deadline-inflight'&&schema.name==='knowledge_quality_review_v12'&&criticCalls===1)dispatchNow=Date.parse(run.extractionDeadlineAt)+1;
      return Response.json({id:'synthetic-response-'+(criticCalls+repairCalls),choices:[{finish_reason:'stop',message:{content:JSON.stringify(output)}}],usage:{prompt_tokens:1,completion_tokens:1}});
    };
    const forbidden=async()=>assert.fail('Captured review must not acquire external source data.');
    let interruptedLegacy=false;
    const runtimeOptions={imagePolicy:WEBPAGE_IMAGE_POLICY,database,fetch,browser:{readPage:forbidden,readRobots:forbidden,screenshot:forbidden,close:async()=>({ok:true,value:null})},apiKey:'synthetic-not-a-secret',endpoint:'https://unexecuted.invalid/model',now,nowMs,logger,configSnapshots:configs,transition:forbidden,preflightModelWork:(_role,scope)=>{if(media==='legacy-repair-technical-feedback'&&!interruptedLegacy&&scope.stageKey.startsWith('knowledge-scraper:knowledge-repair-')&&scope.stageKey.includes(':technical-4:')){interruptedLegacy=true;const error=new AgentExecutionBoundaryFailure({kind:'EvaluationCancelled'});error.notStarted=true;throw error;}}};
    let runtime=createKnowledgeWorkflowRuntime(runtimeOptions);
    const command={run,point:candidate,sourceEvidence,sourceMode,...(attached?{supportingImage:image}:{})};
    if(media==='legacy-repair-technical-feedback'){
      await assert.rejects(()=>runtime.reviewCapturedCandidate(command),AgentExecutionBoundaryFailure);
      assert.equal(repairCalls,1);assert.equal(criticCalls,1);assert.equal(db.prepare("SELECT status FROM knowledge_workflow_stages WHERE stage_key LIKE 'knowledge-quality:%'").get().status,'claimed');
      legacyRepairRows=db.prepare("SELECT * FROM knowledge_workflow_stages WHERE stage_key LIKE 'knowledge-scraper:knowledge-repair-%' AND stage_key NOT LIKE '%:technical-4:%' ORDER BY stage_key").all();assert.equal(legacyRepairRows.length,3);assert.deepEqual(legacyRepairRows.map(row=>row.status).sort(),['claimed','completed','completed']);
      runtime=createKnowledgeWorkflowRuntime(runtimeOptions);
    }
    const result=await runtime.reviewCapturedCandidate(command);
    if(media==='repair-technical-feedback')assert.deepEqual(logs.filter(entry=>entry.event==='knowledge-quality-technical-retry'),[{event:'knowledge-quality-technical-retry',field:'repair',failureKind:'KnowledgeRepairOutputInvalid',count:1,ownerId:run.ownerId,runId:run.runId,stage:'knowledge-scraper'}]);
    if(['deadline-expired','deadline-null-invalid','deadline-null-read-failure'].includes(media)){
      assert.deepEqual(result,{ok:false,error:{kind:media==='deadline-expired'?'WebpageImageRunDeadlineExceeded':media==='deadline-null-invalid'?'WorkflowExtractionClockInvalid':'WorkflowStagePersistenceFailed'}});
      assert.equal(criticCalls,0);assert.equal(repairCalls,0);assert.equal(db.prepare("SELECT count(*) AS n FROM knowledge_workflow_stages WHERE stage_key LIKE 'question-evaluator:%' OR stage_key LIKE 'knowledge-scraper:%'").get().n,0,'Expired or invalid extraction clocks cannot claim paid model work');return;
    }
    if(media==='deadline-inflight'){
      assert.deepEqual(result,{ok:false,error:{kind:'WebpageImageRunDeadlineExceeded'}});assert.equal(criticCalls,1);assert.equal(repairCalls,0);
      const nativeBefore=db.prepare("SELECT * FROM knowledge_workflow_stages WHERE stage_key LIKE 'question-evaluator:%'").all();assert.equal(nativeBefore.length,1);assert.equal(nativeBefore[0].status,'completed','An in-flight accepted response is retained');
      dispatchNow=Date.parse(now());assert.equal((await runtime.reviewCapturedCandidate(command)).ok,true);assert.equal(criticCalls,2,'Resume reuses the first critic and dispatches only the final review');assert.equal(repairCalls,1);assert.deepEqual(db.prepare('SELECT * FROM knowledge_workflow_stages WHERE stage_key=?').get(nativeBefore[0].stage_key),nativeBefore[0]);return;
    }
    if(media==='repair-legacy-read-failure'){assert.deepEqual(result,{ok:false,error:{kind:'WorkflowStagePersistenceFailed'}});assert.equal(repairCalls,1);assert.equal(criticCalls,1);assert.equal(db.prepare("SELECT count(*) AS n FROM knowledge_workflow_stages WHERE stage_key LIKE 'knowledge-scraper:knowledge-repair-%'").get().n,1);return;}
    if(media==='reasoning-only'){assert.deepEqual(result,{ok:false,error:{kind:'KnowledgeModelResponseInvalid',field:'finish_reason',attempts:4,technicalAttempts:4,technicalRetriesExhausted:true}});assert.equal(repairCalls,4);assert.equal(criticCalls,1);assert.deepEqual(await runtime.reviewCapturedCandidate(command),result);assert.equal(repairCalls,4);return;}
    const invalidRepair=mismatch||media==='raster-remove'||media==='raw-pass-gap-remove';
    if(invalidRepair){assert.deepEqual(result,{ok:false,error:{kind:'KnowledgeRepairOutputInvalid',attempts:4,technicalAttempts:4,technicalRetriesExhausted:true}});assert.equal(repairCalls,4);assert.equal(criticCalls,1);assert.deepEqual(await runtime.reviewCapturedCandidate(command),result);assert.equal(repairCalls,4);return;}
    assert.equal(result.ok,true,JSON.stringify(result.error));
    const secondRejected=media.startsWith('history-');
    const rejected=mismatch||media==='raster-remove'||media==='reasoning-only'||media==='raw-pass-gap-remove';
    if(rejected||secondRejected)assert.equal(result.value,null);
    else {assert.equal(result.value.point.summary,repair.summary);assert.equal(result.value.point.evidenceAnchors.length,anchors);assert.equal(result.value.verdict.audit.version,8);assert.deepEqual(result.value.verdict.audit.clauses,[]);assert.deepEqual(result.value.verdict.audit.finalClause.textEvidence,sourceMode==='text'?[{anchorIndex:0,start:0,end:knowledgeReviewTokens(candidate.evidenceAnchors[0].quote).length}]:[]);
      const saved=db.prepare("SELECT result_json FROM knowledge_workflow_stages WHERE stage_key LIKE 'question-evaluator:knowledge-quality-%-2:%'").get();const raw=JSON.parse(saved.result_json).value;const {novelty,revisionReason,...wireAudit}=result.value.verdict.audit;assert.deepEqual(raw.audit,wireAudit);assert.equal(raw.qualityDecision,'pass');assert.equal(Object.hasOwn(raw,'decision'),false);assert.equal(result.value.verdict.decision,'pass');assert.equal(novelty,'new');assert.equal(revisionReason,'none');
      const outer=findOuter();assert.deepEqual(JSON.parse(outer.result_json).value.verdict,result.value.verdict);}
    if(media.startsWith('raw-pass-')){const first=JSON.parse(db.prepare("SELECT result_json FROM knowledge_workflow_stages WHERE stage_key LIKE 'question-evaluator:knowledge-quality-%-1:%'").get().result_json).value;assert.equal(first.qualityDecision,'pass');assert.equal(first.allowTextOnly,true);assert.deepEqual(first.audit.finalClause.pixelEvidence,[]);assert.equal(Object.hasOwn(first.audit,'revisionReason'),false);assert.equal(first.feedback,'Keep everything; no regeneration needed.');}
    if(media==='reliability-only'||media==='both-negative'){const raw=JSON.parse(db.prepare("SELECT result_json FROM knowledge_workflow_stages WHERE stage_key LIKE 'question-evaluator:knowledge-quality-%-1:%'").get().result_json).value;assert.equal(raw.feedback,'Keep everything; no regeneration needed.');assert.equal(raw.sourceReliability.decision,'revise');assert.equal(raw.sourceReliability.reason,'Synthetic captured evidence does not establish the claimed causal strength.');assert.equal(raw.qualityDecision,media==='reliability-only'?'pass':'revise');assert.equal(Object.hasOwn(result.value.verdict,'sourceReliability'),false);}
    if(media==='basis-null'){const raw=JSON.parse(db.prepare("SELECT result_json FROM knowledge_workflow_stages WHERE stage_key LIKE 'question-evaluator:knowledge-quality-%-1:%'").get().result_json).value;assert.deepEqual(raw.sourceReliability,{basis:null,decision:'pass',reason:'Synthetic positive assertion fidelity is not a captured basis.'});assert.equal(raw.qualityDecision,'pass');assert.equal(raw.feedback,'Keep everything; no regeneration needed.');assert.equal(Object.hasOwn(result.value.verdict,'sourceReliability'),false);}
    const expectedRepairCalls=['repair-technical-feedback','legacy-repair-technical-feedback'].includes(media)?2:1;
    assert.equal(repairCalls,expectedRepairCalls);assert.equal(criticCalls,rejected?1:2);
    assert.deepEqual(await runtime.reviewCapturedCandidate(command),result);
    assert.equal(repairCalls,expectedRepairCalls);assert.equal(criticCalls,rejected?1:2);
    if(media==='repair-technical-feedback'){const rows=db.prepare("SELECT stage_key,status,result_json FROM knowledge_workflow_stages WHERE stage_key LIKE 'knowledge-scraper:knowledge-repair-%' ORDER BY stage_key").all();assert.equal(rows.length,2);assert(rows.every(row=>row.status==='completed'));assert.equal(rows.filter(row=>row.stage_key.includes(':technical-2')).length,1);assert(rows.some(row=>JSON.parse(row.result_json).value.evidenceClauses.length===0),'Original malformed response remains immutable');}
    if(media==='legacy-repair-technical-feedback'){const rows=db.prepare("SELECT * FROM knowledge_workflow_stages WHERE stage_key LIKE 'knowledge-scraper:knowledge-repair-%' ORDER BY stage_key").all();assert.equal(rows.length,4);assert.equal(repairCalls+2,4,'Two historic dispatched calls plus current transport calls total four');assert.deepEqual(rows.filter(row=>!row.stage_key.includes(':technical-4:')),legacyRepairRows,'All historic native rows including unknown attempt three stay byte-identical');assert.equal(rows.filter(row=>row.stage_key.includes(':technical-4:')).length,1);}
    if(media==='cached-legacy-context'){
      const nativeRows=db.prepare("SELECT * FROM knowledge_workflow_stages WHERE stage_key LIKE 'question-evaluator:%' OR stage_key LIKE 'knowledge-scraper:%' ORDER BY stage_key").all();
      const outer=findOuter();db.prepare("UPDATE knowledge_workflow_stages SET status='claimed',result_json=NULL,completed_at=NULL WHERE stage_key=?").run(outer.stage_key);
      runtime=createKnowledgeWorkflowRuntime(runtimeOptions);
      assert.deepEqual(await runtime.reviewCapturedCandidate(command),result);
      assert.equal(criticCalls,2);assert.equal(repairCalls,1);
      assert.deepEqual(db.prepare('SELECT * FROM knowledge_workflow_stages WHERE stage_key=?').get(legacyContextRow.stage_key),legacyContextRow);
      assert.deepEqual(db.prepare("SELECT * FROM knowledge_workflow_stages WHERE stage_key LIKE 'question-evaluator:%' OR stage_key LIKE 'knowledge-scraper:%' ORDER BY stage_key").all(),nativeRows);
    }
    if(media==='legacy-config-claims'){
      assert.deepEqual(db.prepare('SELECT * FROM knowledge_workflow_stages WHERE stage_key IN (?,?) ORDER BY stage_key').all('knowledge-quality:'+candidate.id,'knowledge-quality-context:'+candidate.id),legacyRows);
      const outer=findOuter();assert.notEqual(outer.input_digest,legacySignature);assert.equal(outer.stage_key,'knowledge-quality:'+outer.input_digest+':'+candidate.id);
      const freshContext=db.prepare('SELECT input_digest,status,result_json FROM knowledge_workflow_stages WHERE stage_key=?').get('knowledge-quality-context:'+outer.input_digest+':'+candidate.id);assert.equal(freshContext.status,'completed');assert.equal(freshContext.input_digest,outer.input_digest);assert.deepEqual(JSON.parse(freshContext.result_json).value.lessOften,[]);assert.equal(criticCalls,2);assert.equal(repairCalls,1);
    }
    // A tampered digest within the current versioned outer cache is protected, not silently reinterpreted or retried.
    if(media==='none'&&anchors===1&&!mismatch){
      const digest=value=>'sha256:'+createHash('sha256').update(value).digest('hex');
      const oldSignature=digest(JSON.stringify({point:candidate,evidenceDigest:digest(JSON.stringify(sourceEvidence)),sourceMode,protocol:{review:knowledgeReviewerPrompt,repair:knowledgeRepairPrompt},config:run.configDigests,attachments:[]}));
      const current=findOuter();
      assert.notEqual(current.input_digest,oldSignature);
      db.prepare('UPDATE knowledge_workflow_stages SET input_digest=? WHERE stage_key=?').run(oldSignature,current.stage_key);
      const protectedOld=await runtime.reviewCapturedCandidate(command);assert.deepEqual(protectedOld,{ok:false,error:{kind:'WorkflowStageInputChanged'}});
      assert.equal(criticCalls,2);assert.equal(repairCalls,1);assert.equal(db.prepare('SELECT result_json FROM knowledge_workflow_stages WHERE stage_key=?').get(current.stage_key).result_json,current.result_json);
    }
  } finally {db.close();}
});
test('forged preference IDs and missing image proof cannot pass the review boundary',async()=>{
  for(const [p,v] of [[point,verdict('drop-see-less',{matchedLessOftenIds:['foreign-owner']})],[{...point,mediaCandidates:[{visualId:'pixel'}]},verdict('pass')]]){
    const result=await reviewer(async()=>({ok:true,value:v}),async()=>{throw new Error('No repair for invalid verdict');}).review(p);
    assert.equal(result.ok,false);assert.equal(result.error.kind,'KnowledgeReviewOutputInvalid');
  }
});
test('image-source repair cannot remove pixels to evade quality review',async()=>{
  const result=await reviewer(async()=>({ok:true,value:verdict('revise')}),async()=>({ok:true,value:repair}),'image').review({...point,mediaCandidates:[{visualId:'pixel'}]});
  assert.deepEqual(result,{ok:false,error:{kind:'KnowledgeRepairOutputInvalid',attempts:4,technicalAttempts:4,technicalRetriesExhausted:true}});
});
test('unsupported optional image is removed only through one permitted repair and a second text-only review',async()=>{
  const original={...point,mediaCandidates:[{visualId:'optional-structure'}]},seen=[];let repairs=0;
  const result=await reviewer(async(candidate,attempt)=>{
    seen.push(attempt);
    if(attempt===1){assert.equal(candidate,original);return {ok:true,value:verdict('revise',{feedback:'Captured text fully supports the claim; the optional image does not. Regenerate with useSupportingImage=false.'})};}
    assert.deepEqual(candidate.mediaCandidates,[]);
    assert.deepEqual(candidate.evidenceAnchors,original.evidenceAnchors.map(anchor=>({...anchor,clause:repair.evidenceClauses[0]})));
    return {ok:true,value:verdict('pass')};
  },async(candidate,feedback)=>{repairs++;assert.equal(candidate,original);assert.equal(feedback.allowTextOnly,true);assert.equal(feedback.supportingImageEvidence,'');return {ok:true,value:repair};}).review(original);
  assert.equal(result.ok,true);assert.equal(result.value.point.summary,repair.summary);assert.deepEqual(result.value.point.mediaCandidates,[]);
  assert.deepEqual(original.mediaCandidates,[{visualId:'optional-structure'}]);assert.equal(original.evidenceAnchors[0].quoteDigest,point.evidenceAnchors[0].quoteDigest);
  assert.deepEqual(seen,[1,2]);assert.equal(repairs,1);
});
test('text-only permission in a malformed attached-image pass never strips the image during technical retries',async()=>{
  const original={...point,mediaCandidates:[{visualId:'optional-structure'}]};let critics=0,repairs=0;
  const result=await reviewer(async()=>{critics++;return {ok:true,value:verdict('pass',{allowTextOnly:true,supportingImageEvidence:''})};},async()=>{repairs++;assert.fail('Malformed pass is not a repair instruction.');}).review(original);
  assert.deepEqual(result,{ok:false,error:{kind:'KnowledgeReviewOutputInvalid',attempts:4,technicalAttempts:4,technicalRetriesExhausted:true}});assert.equal(critics,4);assert.equal(repairs,0);
  assert.deepEqual(original.mediaCandidates,[{visualId:'optional-structure'}]);assert.deepEqual(original.evidenceAnchors,point.evidenceAnchors);
});
test('review transport uncertainty stops separately from the semantic regeneration budget',async()=>{
  let repairs=0;
  const result=await reviewer(async()=>({ok:false,error:{kind:'WorkflowStageCallUncertain'}}),async()=>{repairs++;throw new Error('Unexpected semantic repair');}).review(point);
  assert.equal(result.error.kind,'WorkflowStageCallUncertain');assert.equal(repairs,0);
  for(const kind of ['KnowledgeModelResponseInvalid','KnowledgeModelResponseDuplicateKey','KnowledgeModelUsageInvalid','KnowledgeModelTimeout','KnowledgeModelUnavailable','WorkflowStageCallUncertain']) {
    let regenerationCalls=0;
    const regenerated=await reviewer(async()=>({ok:true,value:verdict('revise')}),async()=>{regenerationCalls++;return {ok:false,error:{kind}};}).review(point);
    const retryable=kind!=='KnowledgeModelUsageInvalid';
    assert.deepEqual(regenerated,{ok:false,error:{kind,...(retryable?{attempts:4,technicalAttempts:4,technicalRetriesExhausted:true}:{})}});
    assert.equal(regenerationCalls,retryable?4:1);

  }
});

async function stages(){
  const db=new DatabaseSync(':memory:');
  db.exec("CREATE TABLE knowledge_workflow_runs(owner_id TEXT,run_id TEXT,state TEXT,PRIMARY KEY(owner_id,run_id)); CREATE TABLE knowledge_workflow_run_tombstones(owner_id TEXT,run_id TEXT); INSERT INTO knowledge_workflow_runs VALUES('owner','run','extraction-loop'); INSERT INTO knowledge_workflow_runs VALUES('other','run','extraction-loop');");
  db.exec(await readFile(new URL('../worker/migrations/0025_workflow_quality_review.sql',import.meta.url),'utf8'));
  const database={prepare(sql){return {bind(...values){const stmt=db.prepare(sql);return {first:async()=>stmt.get(...values)??null,run:async()=>({success:true,meta:{changes:Number(stmt.run(...values).changes)}})};}};}};
  return {db,repository:new D1WorkflowStageRepository({database,now:()=> '2026-10-09T00:00:00.000Z'})};
}
test('atomic stage claims replay outputs and keep owner namespaces isolated',async()=>{
  const {db,repository}=await stages();let calls=0;
  const work=async()=>{calls++;return {ok:true,value:{verdict:'accepted'}};};
  const scope={ownerId:'owner',runId:'run'};
  const first=await repository.run(scope,'review-1','input-sha',work);
  assert.deepEqual(await repository.run(scope,'review-1','input-sha',work),first);assert.equal(calls,1);
  assert.equal((await repository.run(scope,'review-1','changed-input',work)).error.kind,'WorkflowStageInputChanged');
  assert.equal((await repository.run({ownerId:'other',runId:'run'},'review-1','input-sha',work)).ok,true);assert.equal(calls,2);db.close();
});
test('crash after claim and concurrent resumes never repeat an uncertain paid stage',async()=>{
  const {db,repository}=await stages(),scope={ownerId:'owner',runId:'run'};let calls=0;
  const work=async()=>{calls++;throw new Error('Interrupted after provider dispatch');};
  assert.equal((await repository.run(scope,'generation-1','input',work)).error.kind,'WorkflowStageCallUncertain');
  assert.equal((await repository.run(scope,'generation-1','input',work)).error.kind,'WorkflowStageCallUncertain');assert.equal(calls,1);
  let finish;
  const pending=repository.run(scope,'generation-2','input',()=>new Promise(resolve=>{finish=resolve;}));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal((await repository.run(scope,'generation-2','input',work)).error.kind,'WorkflowStageCallUncertain');
  finish({ok:true,value:{draft:'saved'}});assert.equal((await pending).ok,true);assert.equal(calls,1);db.close();
});

function quizzes(overrides={}){
  const audit=[],published=[],dropped=[];
  const draft={id:'draft',knowledgeId:point.id,knowledgeRevision:1,kind:'single-choice',prompt:'Which specific relationship is supported?',options:['Correct relationship','Incorrect relationship'],answer:'Correct relationship',citedEvidenceUrls:['https://example.test/']};
  const actor=createQuizActorCritic({maxAttempts:2,now:()=> '2026-10-09T00:00:00.000Z',logger:()=>{},generator:{generate:async()=>({ok:true,value:draft})},reviewer:{evaluate:async()=>({ok:true,value:{score:7,reasons:['Too generic'],feedback:'Test the actual central relationship.',groundingProblems:[]}})},repository:{findPublished:async()=>({ok:true,value:null}),appendAttempt:async(v)=>{audit.push(v);return {ok:true,value:null};},publish:async(v)=>{published.push(v);return {ok:true,value:null};},discard:async(v)=>{dropped.push(v);return {ok:true,value:null};},purge:async()=>({ok:true,value:null})},...overrides});
  return {actor,audit,published,dropped};
}
test('new quiz pipeline allows exactly one repair and then removes failed knowledge',async()=>{
  const f=quizzes(),result=await f.actor.run({ownerId:'owner',runId:'run',points:[point]});
  assert.equal(result.ok,true);assert.equal(result.value.dispositions[0].attempts,2);assert.equal(f.audit.length,2);assert.equal(f.published.length,0);assert.equal(f.dropped.length,1);
});
test('see-less preflight skips quiz generation and historical third-attempt publication still replays',async()=>{
  let generated=0;
  const f=quizzes({beforeGenerate:async()=>({ok:true,value:false}),generator:{generate:async()=>{generated++;throw new Error('Forbidden generation');}}});
  const result=await f.actor.run({ownerId:'owner',runId:'run',points:[point]});assert.equal(result.value.dispositions[0].attempts,0);assert.equal(generated,0);assert.equal(f.dropped.length,1);
  const historical=quizzes({repository:{findPublished:async()=>({ok:true,value:{status:'published',attempt:3}}),appendAttempt:async()=>({ok:true,value:null}),publish:async()=>({ok:true,value:null}),discard:async()=>({ok:true,value:null}),purge:async()=>({ok:true,value:null})},generator:{generate:async()=>{throw new Error('No regeneration');}}});
  assert.equal((await historical.actor.run({ownerId:'owner',runId:'run',points:[point]})).value.dispositions[0].attempts,3);
});
test('exact duplicate quiz receives actionable regeneration instead of premature abandonment',async()=>{
  let calls=0;
  const f=quizzes({generator:{generate:async(input)=>{calls++;if(input.attempt===2)assert.match(input.feedback,/distinct meaningful relationship/);return {ok:false,error:{kind:'QuizDuplicate'}};}}});
  const result=await f.actor.run({ownerId:'owner',runId:'run',points:[point]});assert.equal(result.ok,true);assert.equal(calls,2);assert.equal(f.audit.length,2);assert.equal(f.dropped.length,1);
});

test('interrupted orchestration resumes protected completed child calls without repaying or renewing quality attempts',async()=>{
  const {db,repository}=await stages(),scope={ownerId:'owner',runId:'run'};let calls=0,interrupted=true;
  const work=async()=>{
    const child=await repository.run(scope,'critic-attempt-1','input',async()=>{calls++;return {ok:true,value:verdict('pass')};});
    if(interrupted){interrupted=false;throw new Error('Crash between child completion and disposition checkpoint');}
    return child;
  };
  assert.equal((await repository.run(scope,'quality-original-candidate','input',work,{resumeSafe:true})).error.kind,'WorkflowStageCallUncertain');
  const resumed=await repository.run(scope,'quality-original-candidate','input',work,{resumeSafe:true});assert.equal(resumed.ok,true);assert.equal(calls,1);
  assert.deepEqual(await repository.run(scope,'quality-original-candidate','input',work,{resumeSafe:true}),resumed);assert.equal(calls,1);db.close();
});
test('known nondispatch failures can recover while provider refusals retain a finite recovery counter',async()=>{
  const {db,repository}=await stages(),scope={ownerId:'owner',runId:'run'};let calls=0;
  const missing=await repository.run(scope,'credential-stage','input',async()=>({ok:false,error:{kind:'KnowledgeModelCredentialMissing'}}));assert.equal(missing.error.kind,'KnowledgeModelCredentialMissing');
  const fixed=await repository.run(scope,'credential-stage','input',async()=>{calls++;return {ok:true,value:{output:'valid'}};});assert.equal(fixed.ok,true);assert.equal(calls,1);
  const refuse=async()=>{calls++;return {ok:false,error:{kind:'KnowledgeModelRejected',status:503}};};
  assert.equal((await repository.run(scope,'provider-stage','input',refuse,{maximumProviderAttempts:2})).error.kind,'KnowledgeModelRejected');
  assert.equal((await repository.run(scope,'provider-stage','input',refuse,{maximumProviderAttempts:2})).error.kind,'KnowledgeModelRejected');
  assert.equal((await repository.run(scope,'provider-stage','input',refuse,{maximumProviderAttempts:2})).error.kind,'WorkflowStageProviderRetryLimitReached');assert.equal(calls,3);
  const row=db.prepare("SELECT provider_failures,failures_json FROM knowledge_workflow_stages WHERE stage_key='provider-stage'").get();assert.equal(row.provider_failures,2);assert.equal(JSON.parse(row.failures_json).length,2);db.close();
});
test('new quiz mode returns evaluator outage without regeneration, discard or publication',async()=>{
  let generators=0;
  const f=quizzes({generator:{generate:async()=>{generators++;return {ok:true,value:{id:'draft',knowledgeId:point.id,knowledgeRevision:1,kind:'single-choice',prompt:'A specific concept?',options:['yes','no'],answer:'yes',citedEvidenceUrls:['https://example.test/']}};}},reviewer:{evaluate:async()=>({ok:false,error:{kind:'WorkflowStageCallUncertain'}})}});
  const result=await f.actor.run({ownerId:'owner',runId:'run',points:[point]});assert.equal(result.ok,false);assert.equal(result.error.kind,'WorkflowStageCallUncertain');assert.equal(result.error.technicalAttempts,4);assert.equal(result.error.technicalRetriesExhausted,true);assert.equal(generators,1);assert.equal(f.audit.length,0);assert.equal(f.dropped.length,0);assert.equal(f.published.length,0);
});

// Optional imagery can be removed only after the independent critic explicitly finds no source-relevant educational support.
test('meaningful supporting image cannot be discarded by a repair without critic permission',async()=>{
  let calls=0;
  const result=await reviewer(async()=>{calls++;return {ok:true,value:verdict('revise',{allowTextOnly:false})};},async()=>({ok:true,value:repair})).review({...point,mediaCandidates:[{visualId:'pixel'}]});
  assert.deepEqual(result,{ok:false,error:{kind:'KnowledgeRepairOutputInvalid',attempts:4,technicalAttempts:4,technicalRetriesExhausted:true}});assert.equal(calls,1);
});

import {knowledgeReviewSchema,knowledgeReviewSchemaFor,isKnowledgeReviewVerdict} from '../src/features/knowledge-workflows/quality-review.js';
test('saved public critic using learned duplicate as unwanted preference stays technical after four critiques without repair',async()=>{
 const path='test-results/architecture-recovery/continued-repair/diagnosed-v13-dev023-review/diagnosis.json',bytes=await readFile(path),saved=JSON.parse(bytes);
 assert.equal(createHash('sha256').update(bytes).digest('hex'),'902d58c4b30b4473fadedc4d34bf3cbe6e4131440bef5aa805dea425d49dcdcb');
 assert.deepEqual(saved.context.lessOften,[]);assert.equal(saved.context.previousKnowledge.some(p=>p.id===saved.verdict.matchedLessOftenIds[0]),true);assert.equal(isKnowledgeReviewVerdict(saved.verdict,saved.context),false);
 let critics=0,repairs=0;const result=await createKnowledgeQualityReviewer({context:saved.context,sourceMode:'text',digest:async()=>assert.fail('No repair hash'),evaluate:async()=>{critics++;return {ok:true,value:saved.verdict};},regenerate:async()=>{repairs++;assert.fail('Malformed verdict stays terminal');}}).review(point);
 assert.deepEqual(result,{ok:false,error:{kind:'KnowledgeReviewOutputInvalid',attempts:4,technicalAttempts:4,technicalRetriesExhausted:true}});assert.equal(critics,4);assert.equal(repairs,0);
});
test('review schema derives a unique owner ID domain without mutating the public base or emitting empty enum',()=>{
 const before=JSON.stringify(knowledgeReviewSchema),context={lessOften:[{id:'owner-choice',summary:'First'},{id:'owner-choice',summary:'Duplicate projection'},{id:'second-choice',summary:'Second'}],previousKnowledge:[{id:'learned-only',summary:'Prior'}],previousQuizzes:[{id:'quiz-only'}]};
 const allowed=knowledgeReviewSchemaFor(context).schema.properties;assert.deepEqual(allowed.matchedLessOftenIds.items.enum,['owner-choice','second-choice']);assert.equal(allowed.matchedLessOftenIds.maxItems,2);assert.equal(Object.hasOwn(allowed.matchedLessOftenIds,'uniqueItems'),false);
 const empty=knowledgeReviewSchemaFor({...context,lessOften:[]}).schema.properties;assert.equal(empty.matchedLessOftenIds.maxItems,0);assert.deepEqual(empty.qualityDecision.enum,['pass','revise']);assert.equal(Object.hasOwn(empty.matchedLessOftenIds.items,'enum'),false);assert.equal(JSON.stringify(knowledgeReviewSchema),before);
});

// Prompt-contract fixture only: it does not assess model quality or any particular source.
test('attribution and probability caveats require independent captured support while argument analysis teaches evidential limits',()=>{
 assert.match(knowledgeReviewerPrompt,/Prompt version: knowledge-quality-review-v40-source-language\./);
 assert.match(knowledgeRepairPrompt,/Prompt version: knowledge-quality-repair-v32-source-language\./);
 assert.match(knowledgeReviewerPrompt,/Do not pass unsupported causal certainty merely because the summary reports what the author says or adds a probability caveat/);
 assert.match(knowledgeReviewerPrompt,/Require independently supported descriptive or causal content within the captured evidence/);
 assert.match(knowledgeReviewerPrompt,/reporting the argument itself is appropriate only when the learning purpose is the argument and its evidential limits are explicitly taught/);
 assert.match(knowledgeRepairPrompt,/Narrow to descriptive or causal content independently established by the original retained evidence, or omit the unsupported relationship/);
 assert.match(knowledgeRepairPrompt,/Preserve the existing source boundaries and conditions; do not invent missing evidence/);
});

// Constructed contract responses exercise bounded decisions, never model accuracy or real-source coverage.
for(const mode of ['semantic-pass','semantic-revise','prior-covered'])test(`complementary source relationship keeps semantic authority and bounded attempts: ${mode}`,async()=>{
 const quote='When the regulator is enabled, the path opens. When the regulator is disabled, the path closes.';
 const current={...point,summary:'When the regulator is disabled, the path closes.',evidenceAnchors:[{...point.evidenceAnchors[0],quote,clause:'When the regulator is disabled, the path closes.'}]};
 const prior={lessOften:[],previousKnowledge:[{id:'prior',summary:mode==='prior-covered'?quote:'When the regulator is enabled, the path opens.'}],previousQuizzes:[]};
 let critics=0,repairs=0;
 const result=await createKnowledgeQualityReviewer({context:prior,sourceMode:'text',digest:async()=> 'sha256:fixture',evaluate:async(p)=>{
  critics++;const response=syntheticAssessment({knowledge:p,sourceMode:'text'},verdict(mode==='semantic-revise'?'revise':'pass'));
  if(mode==='prior-covered')response.audit.finalClause.previousEvidence=[{priorId:'knowledge:prior',start:0,end:knowledgeReviewTokens(quote).length}];
  return {ok:true,value:response};
 },regenerate:async(p,v)=>{repairs++;assert.equal(v.decision,'revise');assert.equal(v.audit.novelty,mode==='prior-covered'?'duplicate':'new');assert.equal(v.audit.revisionReason,mode==='prior-covered'?'duplicate':'quality');return {ok:true,value:{summary:current.summary,coverageGoalIds:current.coverageGoalIds,useSupportingImage:false,evidenceClauses:[current.evidenceAnchors[0].clause]}};}}).review(current);
 if(mode==='semantic-pass'){assert.equal(result.ok,true);assert(result.value);assert.equal(result.value.verdict.audit.novelty,'new');assert.equal(critics,1);assert.equal(repairs,0);}
 else{assert.deepEqual(result,{ok:true,value:null});assert.equal(critics,2);assert.equal(repairs,1);}
});

// Constructed boundary replies, not measured semantic accuracy.
test('historical repair context snapshots the validated canonical downgrade and exact reliability finding',async()=>{
 let count=0,repairs=0,first,canonical;
 const result=await createKnowledgeQualityReviewer({context,sourceMode:'text',sourceEvidence:{},digest:async()=> 'sha256:context-fixture',evaluate:async(p,attempt,history)=>{
  count++;if(attempt===1){assert.equal(history,undefined);first=auditedVerdict(p,verdict('pass'));first.sourceReliability={basis:null,decision:'pass',reason:'No captured basis despite a positive assertion.'};return {ok:true,value:first};}
  assert.equal(attempt,2);assert.equal(history.originalSummary,point.summary);assert.deepEqual(history.sourceReliability,{basis:null,decision:'pass',reason:'No captured basis despite a positive assertion.'});assert.deepEqual(history.review,canonical);assert.equal(history.review.decision,'revise');assert.match(history.review.feedback,/Source reliability requires revision/);assert(!history.review.reasons.includes('Mutated after snapshot'));
  return {ok:true,value:auditedVerdict(p,verdict('revise'))};
 },regenerate:async(p,v)=>{repairs++;canonical=structuredClone(v);v.reasons.push('Mutated after snapshot');return {ok:true,value:repair};}}).review(point);
 assert.deepEqual(result,{ok:true,value:null});assert.equal(count,2);assert.equal(repairs,1);assert.equal(first.qualityDecision,'pass');assert.equal(first.sourceReliability.basis,null);
});
test('invalid assessments use four technical critiques while non-retryable repair failures remain terminal',async()=>{
 for(const malformed of [true,false]){let critics=0,repairs=0;const result=await createKnowledgeQualityReviewer({context,sourceMode:'text',digest:async()=>assert.fail('No successful repair'),evaluate:async(p,attempt,history)=>{critics++;assert.equal(attempt,1);assert.equal(history,undefined);return {ok:true,value:malformed?{qualityDecision:'revise'}:auditedVerdict(p,verdict('revise'))};},regenerate:async()=>{repairs++;return {ok:false,error:{kind:'KnowledgeModelProviderRefused'}};}}).review(point);assert.deepEqual(result,{ok:false,error:{kind:malformed?'KnowledgeReviewOutputInvalid':'KnowledgeModelProviderRefused',...(malformed?{attempts:4,technicalAttempts:4,technicalRetriesExhausted:true}:{})}});assert.equal(critics,malformed?4:1);assert.equal(repairs,malformed?0:1);}
});
test('a malformed second assessment remains terminal with historical context present',async()=>{
 let critics=0,repairs=0;const result=await createKnowledgeQualityReviewer({context,sourceMode:'text',digest:async()=> 'sha256:context-fixture',evaluate:async(p,attempt,history)=>{critics++;assert.equal(history===undefined,attempt===1);return {ok:true,value:attempt===1?auditedVerdict(p,verdict('revise')):{sourceLanguageMatches:true,qualityDecision:'pass',repairContext:history}};},regenerate:async()=>{repairs++;return {ok:true,value:repair};}}).review(point);assert.deepEqual(result,{ok:false,error:{kind:'KnowledgeReviewOutputInvalid',attempts:4,technicalAttempts:4,technicalRetriesExhausted:true}});assert.equal(critics,5);assert.equal(repairs,1);
});

// Constructed source gap: exercises correction delivery, bounded calls and immutable provenance.
for(const oversized of [false,true])test(`source-audit repair preserves specific critic correction and feedback bound: oversized=${oversized}`,async()=>{
 let critics=0,repairs=0;const correction='Remove the unsupported degree; retain the source-backed direction.';
 const result=await createKnowledgeQualityReviewer({context,sourceMode:'text',digest:async()=> 'sha256:repair',evaluate:async(p)=>{
  critics++;const response=syntheticAssessment({knowledge:p,sourceMode:'text'},verdict(critics===1?'revise':'pass',{feedback:oversized?correction+' '.repeat(2000-correction.length):correction}));
  if(critics===1)response.audit.finalClause.textEvidence=[];return {ok:true,value:response};
 },regenerate:async(p,v)=>{repairs++;assert.match(v.feedback,/requiredRevisions.sourceClauses/);assert(v.feedback.includes(correction));assert(v.feedback.length<=2000);assert.equal(v.allowTextOnly,true);return {ok:true,value:repair};}}).review(point);
 assert.equal(result.ok,true);assert(result.value);assert.equal(critics,2);assert.equal(repairs,1);assert.equal(result.value.point.evidenceAnchors[0].quote,point.evidenceAnchors[0].quote);
});

test('normal technical identities replay known refusals without redispatch while credential repair remains available',async()=>{
 const {db,repository}=await stages(),scope={ownerId:'owner',runId:'run'};
 try{
  for(const status of [429,503]){
   const key=`cached-provider-${status}`,failure={ok:false,error:{kind:'KnowledgeModelRejected',status}},options={modelCall:true,maximumProviderAttempts:4,cacheProviderRefusals:true};let calls=0;
   assert.deepEqual(await repository.run(scope,key,'input',async()=>{calls++;return failure;},options),failure);
   const original=db.prepare('SELECT * FROM knowledge_workflow_stages WHERE stage_key=?').get(key);
   for(let replay=0;replay<5;replay++)assert.deepEqual(await repository.run(scope,key,'input',async()=>assert.fail('A cached provider refusal cannot dispatch again'),options),failure);
   assert.equal(calls,1);assert.deepEqual(db.prepare('SELECT * FROM knowledge_workflow_stages WHERE stage_key=?').get(key),original);
   assert.equal((await repository.run(scope,key,'changed',async()=>assert.fail('Changed input cannot replay'),options)).error.kind,'WorkflowStageInputChanged');
   db.prepare('UPDATE knowledge_workflow_stages SET result_json=? WHERE stage_key=?').run(JSON.stringify({ok:false,error:{kind:'KnowledgeModelRejected',status:401}}),key);
   assert.equal((await repository.run(scope,key,'input',async()=>assert.fail('Corrupt refusal cannot dispatch'),options)).error.kind,'WorkflowStagePersistenceFailed');
  }
  for(const status of [401,403]){
   const key=`credential-${status}`,options={modelCall:true,maximumProviderAttempts:4,cacheProviderRefusals:true};
   assert.equal((await repository.run(scope,key,'input',async()=>({ok:false,error:{kind:'KnowledgeModelRejected',status}}),options)).error.status,status);
   assert.equal(db.prepare('SELECT provider_failures FROM knowledge_workflow_stages WHERE stage_key=?').get(key).provider_failures,0);
   assert.deepEqual(await repository.run(scope,key,'input',async()=>({ok:true,value:{credential:'restored'}}),options),{ok:true,value:{credential:'restored'}});
  }
 }finally{db.close();}
});

for(const legacy of [false,true])test('progress preflight failures never poison a paid model stage; legacy='+legacy,async()=>{
 const {db,repository}=await stages(),scope={ownerId:'owner',runId:'run'},key='question-evaluator:progress-test',failure={ok:false,error:{kind:'WorkflowProgressPersistenceFailed'}};let calls=0;
 try{
 if(legacy)db.prepare("INSERT INTO knowledge_workflow_stages(owner_id,run_id,stage_key,input_digest,status,result_json,created_at,completed_at) VALUES(?,?,?,?,'completed',?,?,?)").run(scope.ownerId,scope.runId,key,'input',JSON.stringify(failure),'2026-10-09T00:00:00.000Z','2026-10-09T00:00:00.000Z');
 else assert.deepEqual(await repository.run(scope,key,'input',async()=>failure,{modelCall:true}),failure);
 const work=async()=>{calls++;return {ok:true,value:{review:'saved'}};};
 const recovered=await repository.run(scope,key,'input',work,{modelCall:true});assert.equal(recovered.ok,true,JSON.stringify(recovered));
 assert.deepEqual(await repository.run(scope,key,'input',work,{modelCall:true}),recovered);assert.equal(calls,1);
 assert.equal(db.prepare('SELECT provider_failures FROM knowledge_workflow_stages WHERE stage_key=?').get(key).provider_failures,0);
 }finally{db.close();}
});


test('legacy completed HTTP402 stages recover under an authorized isolated identity and retain history',async()=>{
 const {db,repository}=await stages(),scope={ownerId:'owner',runId:'run'};let calls=0,authorized=false;
 try{
  const key='question-generator:billing',refusal={ok:false,error:{kind:'KnowledgeModelRejected',status:402}};
  await repository.run(scope,key,'input',async()=>refusal,{modelCall:true});
  const original=db.prepare('SELECT * FROM knowledge_workflow_stages WHERE stage_key=?').get(key);
  const work=async()=>{calls++;return {ok:true,value:{saved:true}};},options={modelCall:true,maximumProviderAttempts:4,recoverFailedModel:async()=>authorized?{attemptKey:'b'.repeat(64)}:null};
  assert.deepEqual(await repository.run(scope,key,'input',work,options),refusal);assert.equal(calls,0);
  authorized=true;assert.equal((await repository.run(scope,key,'input',work,options)).ok,true);assert.equal(calls,1);
  assert.equal((await repository.run(scope,key,'input',work,options)).ok,true);assert.equal(calls,1);
  assert.deepEqual(db.prepare('SELECT * FROM knowledge_workflow_stages WHERE stage_key=?').get(key),original);
 }finally{db.close();}
});
