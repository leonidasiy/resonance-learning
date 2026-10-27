import test from 'node:test';
import assert from 'node:assert/strict';
import {questionEvaluatorPrompt,questionEvaluationSchema} from '../worker/knowledge-workflow-runtime.js';
import {createQuizActorCritic,normalizeKnowledgeQuizEvaluation} from '../src/features/knowledge-workflows/quiz.js';
import {assembleQuizPair} from '../src/features/knowledge-workflows/quiz-pair.js';

// Constructed judgments exercise existing boundaries, never model/source accuracy.
const point={id:'synthetic',sourceId:'source',sourceRevision:1,summary:'Opening the valve releases water.',evidenceAnchors:[{url:'https://synthetic.invalid/',selector:'p',quote:'With the pump running, opening the valve releases water.'}],mediaCandidates:[]};
const raw={knowledgeId:point.id,knowledgeRevision:1,canonicalAnswers:['water'],citedEvidenceUrls:['https://synthetic.invalid/'],multipleChoice:{prompt:'What does opening the valve release?',options:[{key:'a',text:'water'},{key:'b',text:'steam'}],correctOptionKeys:['a'],correctOptionAnswers:[{key:'a',canonicalAnswer:'water'}],explanation:'The constructed source describes water release.'},fillBlank:{prompt:'Opening the valve releases ____.',blanks:[{id:'blank-1',canonicalAnswer:'water',acceptedAnswers:['water']}],explanation:'The constructed source describes water release.'}};
const pair=assembleQuizPair(raw,'synthetic'),draft={id:pair.multipleChoice.id,knowledgeId:point.id,knowledgeRevision:1,kind:'single-choice',prompt:pair.multipleChoice.prompt,options:pair.multipleChoice.options.map(o=>o.text),answer:'water',explanation:pair.multipleChoice.explanation,citedEvidenceUrls:pair.citedEvidenceUrls,pairedQuiz:{...pair,canonicalAnswers:pair.fillBlank.canonicalAnswers}};
async function run(issues,feedback){let generators=0,critics=0,published=0,discarded=0;const received={score:9,reasons:['Constructed judgment.'],feedback,groundingProblems:[],knowledgeGroundingProblems:issues},before=structuredClone(received),result=await createQuizActorCritic({maxAttempts:2,now:()=> '2026-10-12T00:00:00Z',logger:()=>{},generator:{generate:async()=>{generators++;return {ok:true,value:draft};}},reviewer:{evaluate:async input=>{critics++;return normalizeKnowledgeQuizEvaluation(received,input.knowledge);}},repository:{findPublished:async()=>({ok:true,value:null}),appendAttempt:async()=>({ok:true,value:null}),publish:async()=>{published++;return {ok:true,value:null};},discard:async()=>{discarded++;return {ok:true,value:null};},purge:async()=>assert.fail('No purge')}}).run({ownerId:'owner',runId:'run',points:[point]});assert.deepEqual(received,before);assert(result.ok);return {result,generators,critics,published,discarded};}

test('omission guidance requires captured restriction and truth impact, preserving other point faults',()=>{
 assert.match(questionEvaluatorPrompt,/paired-question-evaluator-v13/);
 assert.equal(questionEvaluationSchema.name,'quiz_evaluation_v3');
 assert.match(questionEvaluatorPrompt,/identify the captured wording that restricts the claim/);
 assert.match(questionEvaluatorPrompt,/makes that exact current claim false or broader than the captured evidence supports/);
 assert.match(questionEvaluatorPrompt,/Mere presence of a location or contextual detail in a longer quotation is not such a restriction/);
 assert.match(questionEvaluatorPrompt,/Optional clarification belongs in feedback/);
 assert.match(questionEvaluatorPrompt,/whether or not the quiz tests them/);
});

test('optional clarification with no typed point fault remains nonblocking',async()=>{
 const r=await run([],'Optional clarification could add source context; the current relationship remains supported.');
 assert.equal(r.published,1);assert.equal(r.discarded,0);assert.equal(r.generators,1);assert.equal(r.critics,1);
});

for(const kind of ['unsupported','source-conflicting','unpictured'])test(`a received ${kind} issue stays binding despite optional-sounding feedback`,async()=>{
 const reason=kind==='unpictured'?'The attached pixels show a different relationship.':'The captured source restricts release to a running pump; the current unqualified claim asserts release without that condition.';
 const r=await run([{claim:point.summary,kind,reason}],'Minor improvement suggested; the quiz does not test this context.');
 assert.equal(r.published,0);assert.equal(r.discarded,1);assert.equal(r.result.value.dispositions[0].failureKind,'QuizKnowledgeUngrounded');assert.equal(r.generators,1);assert.equal(r.critics,1);
});

test('a mistaken omission reason is not automatically cleared by the typed boundary',async()=>{
 const r=await run([{claim:point.summary,kind:'unsupported',reason:'The source also describes a room; the model calls that omitted room necessary.'}],'The source context could be added.');
 assert.equal(r.discarded,1);assert.equal(r.published,0);assert.equal(r.generators,1);assert.equal(r.critics,1);
});
