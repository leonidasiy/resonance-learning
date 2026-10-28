import {test} from 'node:test';
import assert from 'node:assert/strict';
import {knowledgeUsefulnessInstruction} from '../src/features/knowledge-workflows/knowledge-usefulness.js';
import {knowledgeSelectionPolicy,webpageFactsPrompt,webpageClaimBoundaryPrompt,webpageGroundingPrompt,webpageSelectionGroundingPrompt} from '../worker/webpage-facts.js';
import {materialBatchPrompt,materialImagePrompt} from '../worker/knowledge-workflow-runtime.js';
import {knowledgeBatchSelectionPrompt} from '../worker/knowledge-workflow-parallel-review.js';
import {createKnowledgeQualityReviewer,knowledgeReviewerPrompt,knowledgeRepairPrompt} from '../src/features/knowledge-workflows/quality-review.js';
import {syntheticAssessment} from './fixtures/knowledge-review-audit.mjs';

test('all extraction, completeness, selection and repair prompts receive the same usefulness policy',()=>{
  for(const prompt of [knowledgeSelectionPolicy,webpageFactsPrompt,webpageClaimBoundaryPrompt,webpageGroundingPrompt,webpageSelectionGroundingPrompt,materialBatchPrompt,materialImagePrompt,knowledgeReviewerPrompt,knowledgeRepairPrompt,knowledgeBatchSelectionPrompt]) {
    assert(prompt.includes(knowledgeUsefulnessInstruction));
  }
  assert.match(knowledgeUsefulnessInstruction,/intentionally omitted low-value introduction is not a coverage gap/);
  assert.match(knowledgeUsefulnessInstruction,/Do not reject all history, foundational knowledge, short definitions/);
  assert.match(knowledgeUsefulnessInstruction,/never source evidence/);
  assert.match(knowledgeReviewerPrompt,/return qualityDecision=revise even when sourceReliability passes/);
});

const examples=[
  'Genres are reference points that help artists communicate their sound, distributors tag releases, and listeners find music.',
  'Debates about genre labels are pointless because genres overlap, mutate and borrow from one another.',
  'Genres are shifting conventions, so a primary genre tag is a judgment call rather than a fact.',
  'An architecture first appeared in a famous paper in a particular year and is used by many well-known products.',
];

for(const summary of examples) test(`synthetic negative usefulness remains rejected despite valid grounding: ${summary}`,async()=>{
  const original={id:'point',sourceId:'source',sourceRevision:1,summary,normalizedHash:'background',evidenceAnchors:[{url:'https://synthetic.invalid/lesson',selector:'p',quote:summary,clause:summary}],mediaCandidates:[],coverageGoalIds:[],attribution:{sourceUrl:'https://synthetic.invalid/lesson'},extractionVersion:'synthetic'};
  const before=structuredClone(original);let reviews=0,repairs=0;
  // This verifies rejection/retry plumbing with constructed judgments, not LLM classification accuracy.
  const result=await createKnowledgeQualityReviewer({context:{lessOften:[],previousKnowledge:[],previousQuizzes:[]},sourceMode:'text',digest:async()=> 'rephrased-background',evaluate:async knowledge=>{
    reviews++;
    assert.equal(knowledge.evidenceAnchors[0].quote,summary);
    return {ok:true,value:syntheticAssessment({knowledge,sourceMode:'text'},{decision:'revise',reasons:['Accurately quoted background without a specific usable learning target.'],feedback:'Do not rescue generic framing with a recall question or invented specificity.',matchedLessOftenIds:[],supportingImageEvidence:'',allowTextOnly:true})};
  },regenerate:async()=>{repairs++;return {ok:true,value:{summary,coverageGoalIds:[],useSupportingImage:false,evidenceClauses:[summary]}};}}).review(original);
  assert.deepEqual(result,{ok:true,value:null});
  assert.equal(reviews,2);assert.equal(repairs,1);
  assert.deepEqual(original,before);
});
