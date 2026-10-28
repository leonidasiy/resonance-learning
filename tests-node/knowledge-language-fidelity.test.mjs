import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createKnowledgeQualityReviewer,knowledgeReviewerPrompt,knowledgeRepairPrompt,knowledgeReviewSchema,isKnowledgeCriticAssessment} from '../src/features/knowledge-workflows/quality-review.js';
import {sourceLanguageInstruction} from '../src/features/knowledge-workflows/language-fidelity.js';
import {webpageFactsPrompt,webpageClaimBoundaryPrompt,webpageGroundingPrompt,webpageSelectionGroundingPrompt} from '../worker/webpage-facts.js';
import {materialBatchPrompt,materialImagePrompt,questionGeneratorPrompt,questionEvaluatorPrompt} from '../worker/knowledge-workflow-runtime.js';
import {syntheticAssessment} from './fixtures/knowledge-review-audit.mjs';
const context={lessOften:[],previousKnowledge:[],previousQuizzes:[]};
const english='Free aerophones cause vibrations in the air around them rather than inside them.';
const chinese='自由气鸣乐器使周围空气振动，而不是使乐器内部的空气振动。';
const point=(summary,quote)=>({id:'point',sourceId:'source',sourceRevision:1,summary,normalizedHash:'original',evidenceAnchors:[{url:'https://synthetic.invalid/',selector:'p',quote,clause:quote}],mediaCandidates:[],coverageGoalIds:[],attribution:{sourceUrl:'https://synthetic.invalid/'},extractionVersion:'synthetic'});
const assessment=knowledge=>syntheticAssessment({knowledge,sourceMode:'text'},{decision:'pass',reasons:['Constructed source support.'],feedback:'Keep this point.',matchedLessOftenIds:[],supportingImageEvidence:'',allowTextOnly:true});

test('language instruction reaches extraction, normalization, grounding, review, repair and quiz prompts',()=>{
 for(const prompt of [webpageFactsPrompt,webpageClaimBoundaryPrompt,webpageGroundingPrompt,webpageSelectionGroundingPrompt,materialBatchPrompt,materialImagePrompt,knowledgeReviewerPrompt,knowledgeRepairPrompt,questionGeneratorPrompt,questionEvaluatorPrompt])assert(prompt.includes(sourceLanguageInstruction));
 assert(knowledgeReviewSchema.schema.required.includes('sourceLanguageMatches'));
 assert.match(questionEvaluatorPrompt,/always a blocking defect/);
});

test('a negative language finding overrides a pass and repairs against unchanged English evidence',async()=>{
 const original=point(chinese,english),before=structuredClone(original);let reviews=0,repairs=0;
 const result=await createKnowledgeQualityReviewer({context,sourceMode:'text',digest:async()=> 'english-repair',evaluate:async p=>{
  reviews++;
  // Scripted semantic findings verify enforcement, not model language-classification accuracy.
  return {ok:true,value:{...assessment(p),sourceLanguageMatches:reviews>1}};
 },regenerate:async(p,verdict)=>{repairs++;assert.equal(verdict.decision,'revise');assert.match(verdict.feedback,/Language mismatch/);assert.equal(p.evidenceAnchors[0].quote,english);return {ok:true,value:{summary:english,coverageGoalIds:[],useSupportingImage:false,evidenceClauses:[english]}};}}).review(original);
 assert.equal(result.ok,true);assert.equal(result.value.point.summary,english);assert.equal(reviews,2);assert.equal(repairs,1);assert.deepEqual(original,before);assert.equal(result.value.point.evidenceAnchors[0].quote,english);
});

test('persistent language mismatch cannot publish even with positive quality decisions',async()=>{
 const p=point(chinese,english);let repairs=0;
 const result=await createKnowledgeQualityReviewer({context,sourceMode:'text',digest:async()=> 'still-translated',evaluate:async k=>({ok:true,value:{...assessment(k),sourceLanguageMatches:false}}),regenerate:async()=>{repairs++;return {ok:true,value:{summary:chinese,coverageGoalIds:[],useSupportingImage:false,evidenceClauses:[english]}};}}).review(p);
 assert.deepEqual(result,{ok:true,value:null});assert.equal(repairs,1);
});

for(const [summary,quote] of [[english,english],[chinese,chinese],['The source calls the instrument a sheng (笙).','The instrument is called a sheng (笙).']])test('matching source language remains eligible: '+summary,async()=>{
 const p=point(summary,quote);const result=await createKnowledgeQualityReviewer({context,sourceMode:'text',digest:async()=> 'unused',evaluate:async()=>({ok:true,value:assessment(p)}),regenerate:async()=>{throw Error('Unexpected repair');}}).review(p);
 assert.equal(result.ok,true);assert.equal(result.value.point.summary,summary);
});

test('fresh criticism cannot omit or coerce the required language finding',()=>{
 const v=assessment(point(english,english));assert(isKnowledgeCriticAssessment(v,context));delete v.sourceLanguageMatches;assert.equal(isKnowledgeCriticAssessment(v,context),false);v.sourceLanguageMatches='true';assert.equal(isKnowledgeCriticAssessment(v,context),false);
});
