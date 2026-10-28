import test from 'node:test';
import assert from 'node:assert/strict';
import {knowledgeReviewAuditInput,knowledgeReviewSpanText,knowledgeReviewHistoryInput,knowledgeReviewQuotedSchemaFor,resolveKnowledgeReviewQuotes,quoteKnowledgeReviewReferences,createKnowledgeQualityReviewer} from '../src/features/knowledge-workflows/quality-review.js';
import {syntheticAssessment} from './fixtures/knowledge-review-audit.mjs';

const point={id:'candidate',sourceId:'source',sourceRevision:1,summary:'A closed valve stops flow.',normalizedHash:'candidate',evidenceAnchors:[{url:'https://example.test',selector:'main',quote:'A closed valve stops flow.',clause:'A closed valve stops flow.'}],mediaCandidates:[],coverageGoalIds:[],attribution:{sourceUrl:'https://example.test'},extractionVersion:'synthetic'};
const context={lessOften:[],previousKnowledge:[{id:'valve',summary:'A closed valve stops flow.'},{id:'unicode',summary:'Café\t水流 — café. Café\t水流 — café.'}],previousQuizzes:[{prompt:'Which valve stops flow?',answer:'The closed valve.',options:['closed','open'],explanation:'A closed valve stops flow.'}]};
const audit=knowledgeReviewAuditInput(point,context,{});
const assessment=()=>syntheticAssessment({knowledge:point,auditEvidence:audit,sourceMode:'text'},{decision:'pass',reasons:['Synthetic judgment, not a model evaluation.'],feedback:'Synthetic acceptance.',matchedLessOftenIds:[],supportingImageEvidence:'',allowTextOnly:true});
function cited(quote='A closed valve stops flow.',priorId='knowledge:valve') {
 const value=assessment();value.audit.finalClause.previousEvidence=[{priorId,quote}];
 value.retrievalComparison={question:'What stops flow?',answer:'A closed valve.',priorAnswer:'A closed valve.',priorEvidence:[{priorId,quote}],reason:'Synthetic exact target match.'};return value;
}

test('readable history preserves every original record once without numbered JSON punctuation',()=>{
 const before=structuredClone(audit),input=knowledgeReviewHistoryInput(audit,context);
 assert.deepEqual(input.previousContent,[...context.previousKnowledge.map(p=>({id:'knowledge:'+p.id,text:p.summary})),{id:'quiz:0',text:JSON.stringify(context.previousQuizzes[0])}]);
 assert.deepEqual(input.retainedText,audit.retainedText);assert.deepEqual(input.summaryTokens,audit.summaryTokens);assert.deepEqual(audit,before);
 assert(JSON.stringify(input.previousContent).length<JSON.stringify(audit.previousContent).length*.65);
});

test('quoted schema keeps exact prior IDs and current source/image constraints',()=>{
 const schema=knowledgeReviewQuotedSchemaFor(context,audit,[]);
 assert.equal(schema.name,'knowledge_quality_review_v13');
 const prior=schema.schema.properties.audit.properties.finalClause.anyOf[0].properties.previousEvidence.items;
 assert.deepEqual(prior.required,['priorId','quote']);assert.equal(prior.additionalProperties,false);
 assert.deepEqual(prior.properties.priorId.enum,audit.previousContent.map(p=>p.id));assert.equal(prior.properties.quote.minLength,1);assert.equal(Object.hasOwn(prior.properties,'start'),false);
 assert.equal(schema.schema.properties.audit.properties.finalClause.anyOf[0].properties.pixelEvidence.maxItems,0);
 assert.equal(schema.schema.properties.audit.properties.finalClause.anyOf[0].properties.textEvidence.items.properties.anchorIndex.enum[0],0);
});

test('exact prior quotes hydrate to existing lexical spans without mutating raw output',()=>{
 const raw=cited(),before=structuredClone(raw),result=resolveKnowledgeReviewQuotes(raw,context);
 assert.equal(result.ok,true);assert.deepEqual(raw,before);
 const citation=result.value.audit.finalClause.previousEvidence[0];assert.deepEqual(citation,{priorId:'knowledge:valve',start:0,end:6});
 assert.equal(knowledgeReviewSpanText(context.previousKnowledge[0].summary,{start:citation.start,end:citation.end}),'A closed valve stops flow.');
 assert.deepEqual(result.value.retrievalComparison.priorEvidence,[citation]);
 assert.deepEqual(quoteKnowledgeReviewReferences(result.value,context),raw);
});

test('Unicode, original whitespace, repeated text and escaped quiz content retain exact provenance',()=>{
 for(const [priorId,quote,expected] of [['knowledge:unicode','Café\t水流',0],['knowledge:unicode','café',3],['quiz:0','The closed valve.',null]]) {
  const result=resolveKnowledgeReviewQuotes(cited(quote,priorId),context);assert.equal(result.ok,true);
  const c=result.value.audit.finalClause.previousEvidence[0],original=priorId==='quiz:0'?JSON.stringify(context.previousQuizzes[0]):context.previousKnowledge[1].summary;
  assert.equal(knowledgeReviewSpanText(original,{start:c.start,end:c.end}),quote);if(expected!==null)assert.equal(c.start,expected);
 }
});

test('invented, partial, normalized, foreign and malformed quotes are rejected rather than treated as no duplicate',()=>{
 for(const citation of [{priorId:'foreign',quote:'A closed valve stops flow.'},{priorId:'knowledge:valve',quote:'closed val'},{priorId:'knowledge:unicode',quote:'Cafe\u0301\t水流'},{priorId:'knowledge:unicode',quote:'Café 水流'},{priorId:'knowledge:valve',quote:''},{priorId:'knowledge:valve',quote:'Invented text'},{priorId:'knowledge:valve',quote:'closed',extra:true},{priorId:'knowledge:valve',start:0,end:6}]) {
  const raw=cited();raw.audit.finalClause.previousEvidence=[citation];
  assert.deepEqual(resolveKnowledgeReviewQuotes(raw,context),{ok:false,error:{kind:'KnowledgeModelResponseInvalid',causeKind:'KnowledgeReviewPriorQuoteInvalid'}});
 }
 const raw=cited();raw.retrievalComparison.priorEvidence=[{priorId:'foreign',quote:'closed'}];assert.equal(resolveKnowledgeReviewQuotes(raw,context).ok,false);
});

test('quoted prior evidence reaches existing duplicate gate and bounded repair',async()=>{
 let critiques=0,repairs=0;
 const result=await createKnowledgeQualityReviewer({context,sourceMode:'text',sourceEvidence:{},technicalRetries:false,digest:async()=>assert.fail('No successful repair'),evaluate:async()=>{critiques++;return resolveKnowledgeReviewQuotes(cited(),context);},regenerate:async(_point,verdict)=>{repairs++;assert.equal(verdict.audit.novelty,'duplicate');return {ok:false,error:{kind:'KnowledgeModelCredentialRejected'}};}}).review(point);
 assert.deepEqual(result,{ok:false,error:{kind:'KnowledgeModelCredentialRejected'}});assert.equal(critiques,1);assert.equal(repairs,1);
});

test('a malformed quote gets targeted correction within the existing technical attempt allowance',async()=>{
 let calls=0;
 const result=await createKnowledgeQualityReviewer({context,sourceMode:'text',sourceEvidence:{},digest:async()=>assert.fail('No repair'),regenerate:async()=>assert.fail('No semantic repair'),evaluate:async(_point,attempt,_history,technicalAttempt,feedback)=>{
  calls++;assert.equal(attempt,1);assert.equal(technicalAttempt,calls);
  if(calls===1)return resolveKnowledgeReviewQuotes(cited('Invented text'),context);
  assert.deepEqual(feedback.issues,['PriorCitationInvalid']);assert.match(feedback.instructions,/Never invent, paraphrase or normalize/);
  return resolveKnowledgeReviewQuotes(assessment(),context);
 }}).review(point);
 assert.equal(result.ok,true);assert(result.value);assert.equal(calls,2);
});
