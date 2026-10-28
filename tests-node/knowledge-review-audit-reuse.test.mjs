import assert from 'node:assert/strict';
import {test,mock} from 'node:test';
import {createKnowledgeQualityReviewer,knowledgeReviewAuditInput} from '../src/features/knowledge-workflows/quality-review.js';
import {syntheticAssessment} from './fixtures/knowledge-review-audit.mjs';

test('review, technical retries and repair share the exact immutable audit without retokenizing prior quizzes',async()=>{
 const summary='The valve opens the air path.',point={id:'knowledge:fixture',sourceId:'source',sourceRevision:1,summary,normalizedHash:'fixture',evidenceAnchors:[{url:'https://fixture.test/',selector:'p',quote:summary,clause:summary}],coverageGoalIds:[],mediaCandidates:[],attribution:{sourceUrl:'https://fixture.test/'},extractionVersion:'fixture'};
 const context={lessOften:[],previousKnowledge:[{id:'prior',summary:'The reed vibrates.'}],previousQuizzes:[{prompt:'Which part vibrates?',answer:'The reed.'}]};
 const expected=knowledgeReviewAuditInput(point,context,undefined),quizText=JSON.stringify(context.previousQuizzes[0]),original=Intl.Segmenter.prototype.segment;let priorTokenizations=0,calls=0,firstAudit;
 const spy=mock.method(Intl.Segmenter.prototype,'segment',function(value){if(value===quizText)priorTokenizations++;return original.call(this,value);});
 try{
  const result=await createKnowledgeQualityReviewer({context,sourceMode:'text',digest:async()=> 'sha256:repair',
   evaluate:async(candidate,attempt,_history,technicalAttempt,_feedback,audit)=>{
    assert.deepEqual(audit,expected);
    calls++;if(attempt===1){if(firstAudit)assert.equal(audit,firstAudit);else firstAudit=audit;}
    if(attempt===1&&technicalAttempt===1)return {ok:false,error:{kind:'KnowledgeModelResponseInvalid'}};
    return {ok:true,value:syntheticAssessment({knowledge:candidate,sourceMode:'text'},{decision:attempt===1?'revise':'pass',reasons:['Synthetic review.'],feedback:'Keep the source-supported relationship.',matchedLessOftenIds:[],supportingImageEvidence:'',allowTextOnly:true})};
   },
   regenerate:async(_candidate,_verdict,_comparison,_attempt,_feedback,audit)=>{assert.equal(audit,firstAudit);return {ok:true,value:{summary,coverageGoalIds:[],evidenceClauses:[summary],useSupportingImage:false}};},
  }).review(point);
  assert.equal(result.ok,true);assert(result.value);assert.equal(calls,3);assert.equal(priorTokenizations,2,'Prior content is tokenized once per quality attempt, including all technical retries');
 }finally{spy.mock.restore();}
});
