import test from 'node:test';
import assert from 'node:assert/strict';
import {createKnowledgeQualityReviewer,knowledgeReviewerPrompt,knowledgeRepairPrompt} from '../src/features/knowledge-workflows/quality-review.js';
import {syntheticAssessment} from './fixtures/knowledge-review-audit.mjs';

// Constructed semantic judgments test the existing repair boundary, not vision accuracy.
const context={lessOften:[],previousKnowledge:[],previousQuizzes:[]};
const summary='Opening the gate releases stored water downstream.';
const point={id:'point',sourceId:'source',sourceRevision:1,summary,normalizedHash:'point',evidenceAnchors:[{url:'https://synthetic.invalid/',selector:'#gate',quote:summary,clause:summary}],mediaCandidates:[{visualId:'image'}],coverageGoalIds:[],attribution:{sourceUrl:'https://synthetic.invalid/'},extractionVersion:'synthetic'};
const ok=value=>({ok:true,value});
const assessment=(current,decision,{mode='text',allowTextOnly=false,visible=false,cue='A labeled gate-opening arrow leads to a downstream flow arrow.'}={})=>{
 const value=syntheticAssessment({knowledge:current,sourceMode:mode},{decision,reasons:['Constructed source and visual judgment.'],feedback:decision==='revise'?'Retain the supported mechanism as text; remove the optional image only with this permission.':'Keep the grounded relationship.',matchedLessOftenIds:[],supportingImageEvidence:visible?cue:'',allowTextOnly});
 value.audit.finalClause.supportsWholeClaim=visible;
 value.audit.finalClause.pixelEvidence=visible?[{imageId:'image',cue}]:[];
 return value;
};

test('both prompts separate appearance and attribution from unpictured causal support',()=>{
 assert.match(knowledgeReviewerPrompt,/Prompt version: knowledge-quality-review-v41-quoted-prior-evidence\./);
 assert.match(knowledgeRepairPrompt,/Prompt version: knowledge-quality-repair-v33-readable-prior-evidence\./);
 assert.match(knowledgeReviewerPrompt,/Scene, object or color similarity/);
 assert.match(knowledgeReviewerPrompt,/Record supportsWholeClaim=false for relationships not depicted/);
 assert.match(knowledgeReviewerPrompt,/Preserve that text and remove the optional image/);
 assert.match(knowledgeRepairPrompt,/do not delete a useful source-supported mechanism merely to fit the illustration/);
 assert.match(knowledgeRepairPrompt,/set useSupportingImage=false only under the existing text-only permission/);
});

test('a semantic visual gap retains the source mechanism through exactly one permitted text-only repair',async()=>{
 let critics=0,repairs=0;const original=structuredClone(point);
 const result=await createKnowledgeQualityReviewer({context,sourceMode:'text',sourceEvidence:{},digest:async()=> 'synthetic',evaluate:async(current,attempt,repairContext)=>{
  critics++;assert.equal(current.summary,summary);assert.equal(current.evidenceAnchors[0].quote,summary);
  if(attempt===1)return ok(assessment(current,'revise',{allowTextOnly:true}));
  assert.deepEqual(current.mediaCandidates,[]);assert.equal(repairContext.review.allowTextOnly,true);
  return ok(assessment(current,'pass',{allowTextOnly:true}));
 },regenerate:async(current,verdict)=>{repairs++;assert.equal(verdict.allowTextOnly,true);assert.equal(verdict.audit.revisionReason,'image');return ok({summary,coverageGoalIds:[],useSupportingImage:false,evidenceClauses:[summary]});}}).review(original);
 assert(result.ok&&result.value);assert.equal(result.value.point.summary,summary);assert.deepEqual(result.value.point.mediaCandidates,[]);assert.deepEqual(original,point);assert.equal(critics,2);assert.equal(repairs,1);
});

test('a constructed diagram supporting the complete relationship retains its image without repair',async()=>{
 let critics=0;const result=await createKnowledgeQualityReviewer({context,sourceMode:'text',sourceEvidence:{},digest:async()=>assert.fail('No repair'),evaluate:async current=>{critics++;return ok(assessment(current,'pass',{visible:true}));},regenerate:async()=>assert.fail('No repair')}).review(point);
 assert(result.ok&&result.value);assert.deepEqual(result.value.point.mediaCandidates,point.mediaCandidates);assert.equal(critics,1);
});

for(const mode of ['text','image'])test(`image removal without valid permission stays exhausted in ${mode} mode`,async()=>{
 let critics=0,repairs=0;const result=await createKnowledgeQualityReviewer({context,sourceMode:mode,sourceEvidence:{},digest:async()=>assert.fail('Invalid removal cannot reach digest'),evaluate:async current=>{critics++;return ok(assessment(current,'revise',{mode,allowTextOnly:false,visible:true}));},regenerate:async()=>{repairs++;return ok({summary,coverageGoalIds:[],useSupportingImage:false,evidenceClauses:[summary]});}}).review(point);
 assert.deepEqual(result,{ok:false,error:{kind:'KnowledgeRepairOutputInvalid',attempts:4,technicalAttempts:4,technicalRetriesExhausted:true}});assert.equal(critics,1);assert.equal(repairs,4);
});

test('generic appearance cues remain structurally valid: semantic correctness is still an LLM responsibility',async()=>{
 const cue='Blue water beside a closed-looking structure; the caption says the gate releases water.';
 const result=await createKnowledgeQualityReviewer({context,sourceMode:'text',sourceEvidence:{},digest:async()=>assert.fail('No repair'),evaluate:async current=>ok(assessment(current,'pass',{visible:true,cue})),regenerate:async()=>assert.fail('No repair')}).review(point);
 assert(result.ok&&result.value);assert.equal(result.value.verdict.supportingImageEvidence,cue);
 // This is a received false-positive control, not approval of the cue's causal entailment.
});

// Decision consistency is prospective LLM guidance, never a parser override.
test('final decision guidance follows current surviving defects rather than repair history',()=>{
 assert.match(knowledgeReviewerPrompt,/reconcile qualityDecision with the completed assessment of the CURRENT point/);
 assert.match(knowledgeReviewerPrompt,/do not carry forward the first draft.s revise/);
 assert.match(knowledgeReviewerPrompt,/When qualityDecision is revise, identify the actual surviving defect/);
 assert.match(knowledgeReviewerPrompt,/no remaining failure.*qualityDecision must be pass/);
});
test('positive prose cannot override an inconsistent received revise or create an extra critique',async()=>{
 const current={...point,mediaCandidates:[]};let critics=0,repairs=0;
 const result=await createKnowledgeQualityReviewer({context,sourceMode:'text',sourceEvidence:{},digest:async()=> 'synthetic',evaluate:async candidate=>{critics++;const value=assessment(candidate,'revise',{allowTextOnly:true});value.reasons=['All current criteria are satisfied; this point should pass.'];value.feedback='No regeneration is needed.';return ok(value);},regenerate:async()=>{repairs++;return ok({summary,coverageGoalIds:[],useSupportingImage:false,evidenceClauses:[summary]});}}).review(current);
 assert.deepEqual(result,ok(null));assert.equal(critics,2);assert.equal(repairs,1);
});

test('review and repair require evidence for degree while preserving depicted comparisons',()=>{
 for(const prompt of [knowledgeReviewerPrompt,knowledgeRepairPrompt]){
  assert.match(prompt,/a visible direction alone does not establish magnitude, exclusivity or necessity/);
  assert.match(prompt,/distinct initial and final states without showing motion/);
  assert.match(prompt,/Preserve an image that depicts the supported central comparison/);
 }
});
