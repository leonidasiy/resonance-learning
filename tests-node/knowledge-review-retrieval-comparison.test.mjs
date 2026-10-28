import test from 'node:test';
import assert from 'node:assert/strict';
import {createKnowledgeQualityReviewer,isKnowledgeReviewVerdict,knowledgeReviewAuditInput,knowledgeReviewSchemaFor,knowledgeReviewSchema,knowledgeReviewerPrompt,knowledgeReviewTokens} from '../src/features/knowledge-workflows/quality-review.js';
import {syntheticAssessment} from './fixtures/knowledge-review-audit.mjs';
// Generic constructed judgments verify boundaries and monotonicity, never model accuracy.
const context={lessOften:[],previousKnowledge:[{id:'definition',summary:'A reservoir stores water.'}],previousQuizzes:[]};
const point={id:'point',sourceId:'source',sourceRevision:1,summary:'When the outlet opens, stored water flows downstream.',normalizedHash:'point',evidenceAnchors:[{url:'https://synthetic.invalid/',selector:'#outlet',quote:'When the outlet opens, stored water flows downstream.',clause:'When the outlet opens, stored water flows downstream.'}],mediaCandidates:[],coverageGoalIds:[],attribution:{sourceUrl:'https://synthetic.invalid/'},extractionVersion:'synthetic'};
const raw=(decision='pass')=>syntheticAssessment({knowledge:point,sourceMode:'text'}, {decision,reasons:['Constructed semantic judgment remains binding.'],feedback:decision==='revise'?'Address an independent semantic defect.':'Keep the supported point.',matchedLessOftenIds:[],allowTextOnly:true,supportingImageEvidence:''});
const ok=value=>({ok:true,value});
async function run(value,{candidate=point,reviewContext=context,sourceMode='text',regenerate}={}) {
 const before=structuredClone(value);let critics=0,repairs=0,firstContext,canonical,comparison;
 const result=await createKnowledgeQualityReviewer({context:reviewContext,sourceMode,sourceEvidence:{},digest:async()=> 'synthetic',evaluate:async(p,attempt,repairContext)=>{critics++;if(attempt===2)firstContext=repairContext;return ok(value);},regenerate:async(p,v,c)=>{repairs++;canonical=v;comparison=c;return regenerate?regenerate(p,v,c):ok({summary:p.summary,coverageGoalIds:[],useSupportingImage:p.mediaCandidates.length>0,evidenceClauses:[p.summary]});}}).review(candidate);
 assert.deepEqual(value,before,'Received output remains untouched');return {result,critics,repairs,firstContext,canonical,comparison};
}
for(const decision of ['pass','revise'])test(`a constructed distinct retrieval answer preserves raw ${decision}`,async()=>{
 const v=raw(decision);v.retrievalComparison={question:'What happens when the outlet opens?',answer:'Stored water flows downstream.',priorAnswer:null,priorEvidence:[],reason:'The actual prior says the reservoir stores water; it does not teach the outlet condition and downstream flow.'};
 const r=await run(v);assert.equal(r.critics,decision==='pass'?1:2);assert.equal(r.repairs,decision==='pass'?0:1);
 if(decision==='pass'){assert(r.result.value);assert.equal(Object.hasOwn(r.result.value.verdict,'retrievalComparison'),false);}else{assert.deepEqual(r.result,ok(null));assert.equal(r.canonical.decision,'revise');assert(isKnowledgeReviewVerdict(r.canonical,context));assert.deepEqual(r.canonical.reasons,v.reasons);assert.equal(r.canonical.feedback,v.feedback);assert.deepEqual(r.comparison,v.retrievalComparison);assert.deepEqual(r.firstContext.retrievalComparison,v.retrievalComparison);}
});
test('a cited prior answer is bound to the exact supplied prior span, without deterministic entailment credit',async()=>{
 const v=raw();v.retrievalComparison.priorAnswer='The reservoir stores water.';v.retrievalComparison.priorEvidence=[{priorId:'knowledge:definition',start:0,end:knowledgeReviewTokens(context.previousKnowledge[0].summary).length}];const r=await run(v);assert(r.result.value);
 const schema=knowledgeReviewSchemaFor(context,knowledgeReviewAuditInput(point,context,{}));assert.equal(schema.name,'knowledge_quality_review_v12');assert.equal(Object.keys(schema.schema.properties)[0],'retrievalComparison');const prior=schema.schema.properties.retrievalComparison.anyOf[1].properties.priorEvidence.items;assert.deepEqual(prior.properties.priorId.enum,['knowledge:definition']);assert.equal(prior.properties.end.maximum,5);
});
for(const mutation of ['missing','null','extra','missing-question','empty-answer','question-only-null','answer-only-null','reason-empty','oversize','prior-answer-without-span','prior-span-without-answer','foreign-id','negative-start','fractional-end','reversed-range','out-of-bounds','empty-range','foreign-quiz','empty-context-with-citation'])test(`fresh comparison rejects ${mutation} before repair`,async()=>{
 const v=raw(),c=v.retrievalComparison;let reviewContext=context;
 if(mutation==='missing')delete v.retrievalComparison;if(mutation==='null')v.retrievalComparison=null;if(mutation==='extra')c.match=true;if(mutation==='missing-question')delete c.question;if(mutation==='empty-answer')c.answer=' ';if(mutation==='question-only-null')c.question=null;if(mutation==='answer-only-null')c.answer=null;if(mutation==='reason-empty')c.reason='';if(mutation==='oversize')c.question='q'.repeat(1001);if(mutation==='prior-answer-without-span')c.priorAnswer='The reservoir stores water.';
 if(['prior-span-without-answer','foreign-id','negative-start','fractional-end','reversed-range','out-of-bounds','empty-range','foreign-quiz','empty-context-with-citation'].includes(mutation)){c.priorAnswer='The reservoir stores water.';c.priorEvidence=[{priorId:'knowledge:definition',start:0,end:5}];}
 if(mutation==='prior-span-without-answer')c.priorAnswer=null;if(mutation==='foreign-id')c.priorEvidence[0].priorId='knowledge:invented';if(mutation==='negative-start')c.priorEvidence[0].start=-1;if(mutation==='fractional-end')c.priorEvidence[0].end=1.5;if(mutation==='reversed-range'){c.priorEvidence[0].start=3;c.priorEvidence[0].end=2;}if(mutation==='out-of-bounds')c.priorEvidence[0].end=6;if(mutation==='empty-range')c.priorEvidence[0].end=0;if(mutation==='foreign-quiz')c.priorEvidence[0].priorId='quiz:0';if(mutation==='empty-context-with-citation')reviewContext={lessOften:[],previousKnowledge:[],previousQuizzes:[]};
 const r=await run(v,{reviewContext});assert.deepEqual(r.result,{ok:false,error:{kind:'KnowledgeReviewOutputInvalid',attempts:4,technicalAttempts:4,technicalRetriesExhausted:true}});assert.equal(r.critics,4);assert.equal(r.repairs,0);
});
for(const mode of ['quality','duplicate','source','image','combined'])test(`missing target downgrades without bypassing ${mode} or creating image removal`,async()=>{
 const v=raw(mode==='quality'?'revise':'pass'),candidate=mode==='image'||mode==='combined'?{...point,mediaCandidates:[{visualId:'image'}]}:point;v.retrievalComparison={question:null,answer:null,priorAnswer:null,priorEvidence:[],reason:'No coherent answerable relationship was identified.'};
 if(mode==='duplicate'||mode==='combined')v.audit.finalClause.previousEvidence=[{priorId:'knowledge:definition',start:0,end:5}];if(mode==='source'||mode==='combined')v.audit.finalClause.textEvidence=[];
 const r=await run(v,{candidate});assert.deepEqual(r.result,ok(null));assert.equal(r.critics,2);assert.equal(r.repairs,1);assert.equal(r.canonical.audit.revisionReason,mode==='combined'?'duplicate':mode);assert(r.canonical.reasons.includes(v.retrievalComparison.reason));assert(!r.canonical.feedback.includes('Keep the supported point.'));assert.equal(r.canonical.allowTextOnly,candidate.mediaCandidates.length?false:true);assert.equal(Object.hasOwn(r.canonical,'retrievalComparison'),false);
});
test('absence of priors does not upgrade a source-backed usefulness rejection',async()=>{
 const reviewContext={lessOften:[],previousKnowledge:[],previousQuizzes:[]},v=raw('revise'),r=await run(v,{reviewContext});assert.deepEqual(r.result,ok(null));assert.equal(r.critics,2);assert.equal(r.repairs,1);assert.equal(r.canonical.audit.novelty,'new');assert.equal(r.canonical.audit.revisionReason,'quality');assert.equal(knowledgeReviewSchemaFor(reviewContext,knowledgeReviewAuditInput(point,reviewContext,{})).schema.properties.retrievalComparison.anyOf[0].properties.priorEvidence.maxItems,0);
});
test('owner drop alone permits null comparison, with exact owner IDs and no quality attempt',async()=>{
 const reviewContext={...context,lessOften:[{id:'hidden',summary:point.summary}]},v=raw('drop-see-less');v.matchedLessOftenIds=['hidden'];assert.equal(v.retrievalComparison,null);const r=await run(v,{reviewContext});assert.deepEqual(r.result,ok(null));assert.equal(r.critics,1);assert.equal(r.repairs,0);
 const bad={...v,retrievalComparison:raw().retrievalComparison};assert.deepEqual((await run(bad,{reviewContext})).result,{ok:false,error:{kind:'KnowledgeReviewOutputInvalid',attempts:4,technicalAttempts:4,technicalRetriesExhausted:true}});
});
test('received old v9 raw is rejected fresh without inventing a comparison; canonical read remains exact',async()=>{
 const v=raw('revise');delete v.retrievalComparison;const before=structuredClone(v),r=await run(v);assert.deepEqual(r.result,{ok:false,error:{kind:'KnowledgeReviewOutputInvalid',attempts:4,technicalAttempts:4,technicalRetriesExhausted:true}});assert.deepEqual(v,before);
 const {qualityDecision,sourceLanguageMatches,sourceReliability,...common}=v,canonical={...common,decision:qualityDecision,audit:{...v.audit,novelty:'new',revisionReason:'quality'}},saved=structuredClone(canonical);assert(isKnowledgeReviewVerdict(canonical,context));assert.deepEqual(canonical,saved);
});
test('comparison citation provenance rejects before both independent semantic negatives',async()=>{
 const v=raw('revise');v.sourceReliability.decision='revise';v.retrievalComparison.priorAnswer='A claimed prior answer.';v.retrievalComparison.priorEvidence=[{priorId:'knowledge:foreign',start:0,end:1}];const r=await run(v);assert.deepEqual(r.result,{ok:false,error:{kind:'KnowledgeReviewOutputInvalid',attempts:4,technicalAttempts:4,technicalRetriesExhausted:true}});assert.equal(r.critics,4);assert.equal(r.repairs,0);
});
test('missing target cannot authorize removal of the original raster source',async()=>{
 const candidate={...point,mediaCandidates:[{visualId:'image'}]},v=raw();v.retrievalComparison={question:null,answer:null,priorAnswer:null,priorEvidence:[],reason:'No coherent answerable target.'};v.audit.finalClause.textEvidence=[];v.audit.finalClause.pixelEvidence=[{imageId:'image',cue:'Constructed original source cue.'}];v.supportingImageEvidence='Exact original cue.';const r=await run(v,{candidate,sourceMode:'image',regenerate:async()=>ok({summary:point.summary,coverageGoalIds:[],useSupportingImage:false,evidenceClauses:[point.summary]})});assert.deepEqual(r.result,{ok:false,error:{kind:'KnowledgeRepairOutputInvalid',attempts:4,technicalAttempts:4,technicalRetriesExhausted:true}});assert.equal(r.critics,1);assert.equal(r.repairs,4);assert.equal(r.canonical.allowTextOnly,false);
});

// Independent test interpreter for the JSON Schema keywords used by the comparison contract.
// It checks generation shape only; semantic answer entailment remains the critic's responsibility.
function comparisonMatches(schema,value) {
 const known=new Set(['type','anyOf','properties','required','additionalProperties','items','minItems','maxItems','minLength','maxLength','minimum','maximum','enum']);
 for(const key of Object.keys(schema))assert(known.has(key),`Unsupported comparison test keyword: ${key}`);
 if(schema.anyOf&&!schema.anyOf.some(branch=>comparisonMatches(branch,value)))return false;
 if(schema.type&&!(schema.type==='null'?value===null:schema.type==='array'?Array.isArray(value):schema.type==='object'?value!==null&&typeof value==='object'&&!Array.isArray(value):schema.type==='integer'?Number.isInteger(value):typeof value===schema.type))return false;
 if(schema.enum&&!schema.enum.includes(value))return false;
 if(typeof value==='number'&&(value<(schema.minimum??-Infinity)||value>(schema.maximum??Infinity)))return false;
 if(typeof value==='string'&&(value.length<(schema.minLength??0)||value.length>(schema.maxLength??Infinity)))return false;
 if(Array.isArray(value)&&(value.length<(schema.minItems??0)||value.length>(schema.maxItems??Infinity)||schema.items&&!value.every(item=>comparisonMatches(schema.items,item))))return false;
 if(value!==null&&typeof value==='object'&&!Array.isArray(value)){
  if(schema.required?.some(key=>!Object.hasOwn(value,key)))return false;
  if(schema.additionalProperties===false&&Object.keys(value).some(key=>!Object.hasOwn(schema.properties,key)))return false;
  if(schema.properties&&Object.entries(value).some(([key,item])=>schema.properties[key]&&!comparisonMatches(schema.properties[key],item)))return false;
 }
 return true;
}
for(const scoped of [false,true])test(`generation schema couples prior answer and citations: ${scoped?'scoped':'public base'}`,()=>{
 const schema=scoped?knowledgeReviewSchemaFor(context,knowledgeReviewAuditInput(point,context,{})):knowledgeReviewSchema,comparison=schema.schema.properties.retrievalComparison,before=structuredClone(comparison),v=raw().retrievalComparison;
 assert(comparisonMatches(comparison,v));
 const cited={...v,priorAnswer:'The reservoir stores water.',priorEvidence:[{priorId:'knowledge:definition',start:0,end:5}]};assert(comparisonMatches(comparison,cited));
 assert.equal(comparisonMatches(comparison,{...cited,priorEvidence:[]}),false);
 assert.equal(comparisonMatches(comparison,{...cited,priorAnswer:null}),false);
 assert.equal(comparisonMatches(comparison,{...cited,priorAnswer:''}),false);
 if(scoped){assert.equal(comparisonMatches(comparison,{...cited,priorEvidence:[{priorId:'foreign',start:0,end:5}]}),false);assert.equal(comparisonMatches(comparison,{...cited,priorEvidence:[{priorId:'knowledge:definition',start:0,end:6}]}),false);}
 assert.deepEqual(comparison,before);
});
test('generation with no supplied prior content allows only null answer and empty citations',()=>{
 const empty={lessOften:[],previousKnowledge:[],previousQuizzes:[]},before=JSON.stringify(knowledgeReviewSchema),comparison=knowledgeReviewSchemaFor(empty,knowledgeReviewAuditInput(point,empty,{})).schema.properties.retrievalComparison,v=raw().retrievalComparison;
 assert.equal(comparison.anyOf.length,1);assert(comparisonMatches(comparison,v));assert.equal(comparisonMatches(comparison,{...v,priorAnswer:'Uncited prior answer.'}),false);assert.equal(comparisonMatches(comparison,{...v,priorAnswer:'Invented answer.',priorEvidence:[{priorId:'invented',start:0,end:1}]}),false);assert.equal(JSON.stringify(knowledgeReviewSchema),before);
});
test('comparison pairing preserves owner-drop null and leaves exact-question entailment to the critic',async()=>{
 const owner={...context,lessOften:[{id:'hidden',summary:'Owner choice.'}]};assert(comparisonMatches(knowledgeReviewSchemaFor(owner).schema.properties.retrievalComparison,null));assert.equal(comparisonMatches(knowledgeReviewSchemaFor(context).schema.properties.retrievalComparison,null),false);
 const v=raw('revise');v.retrievalComparison={question:'What happens when the outlet opens?',answer:'Water flows downstream.',priorAnswer:'The reservoir stores water.',priorEvidence:[{priorId:'knowledge:definition',start:0,end:5}],reason:'The cited prior answers a different question, so the independent semantic judgment must still assess this comparison.'};
 assert(comparisonMatches(knowledgeReviewSchemaFor(context,knowledgeReviewAuditInput(point,context,{})).schema.properties.retrievalComparison,v.retrievalComparison));const r=await run(v);assert.equal(r.result.value,null);assert.equal(r.critics,2);assert.equal(r.repairs,1);assert.equal(r.canonical.decision,'revise');
 assert.match(knowledgeReviewerPrompt,/Prompt version: knowledge-quality-review-v40-source-language\./);assert.match(knowledgeReviewerPrompt,/priorAnswer must answer this EXACT current question/);assert.match(knowledgeReviewerPrompt,/return priorAnswer=null and priorEvidence=\[\] together/);
});
