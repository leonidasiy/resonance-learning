import test from 'node:test';
import assert from 'node:assert/strict';
import {createQuizActorCritic} from '../src/features/knowledge-workflows/quiz.js';
import {assembleQuizPair,quizAnswerQualityInstruction,quizPairSchema} from '../src/features/knowledge-workflows/quiz-pair.js';
import {questionGeneratorPrompt,questionEvaluatorPrompt} from '../worker/knowledge-workflow-runtime.js';

// Constructed judgments check publication/retry wiring, not real model quality.
const point={id:'synthetic',sourceId:'source',sourceRevision:1,summary:'A reward model scores preferences. It assigns high scores to preferred responses and low scores to disfavored responses.',evidenceAnchors:[{url:'https://synthetic.invalid/',selector:'p',quote:'A reward model scores preferences. It assigns high scores to preferred responses and low scores to disfavored responses.'}],mediaCandidates:[]};
function draft(answers){
 const pair=assembleQuizPair({knowledgeId:point.id,knowledgeRevision:1,canonicalAnswers:answers,citedEvidenceUrls:[point.evidenceAnchors[0].url],multipleChoice:{prompt:'Which statements describe the constructed scoring mechanism?',options:[...answers.map((answer,index)=>({key:`a${index}`,text:answer})),{key:'wrong',text:'A tokenizer measures response preference.'}],correctOptionKeys:answers.map((_,index)=>`a${index}`),correctOptionAnswers:answers.map((canonicalAnswer,index)=>({key:`a${index}`,canonicalAnswer})),explanation:'Constructed fixture explanation.'},fillBlank:{prompt:answers.map(()=> '____').join('; '),blanks:answers.map((canonicalAnswer,index)=>({id:`blank-${index+1}`,canonicalAnswer,acceptedAnswers:[canonicalAnswer]})),explanation:'Constructed fixture explanation.'}},'synthetic');
 return {id:pair.multipleChoice.id,knowledgeId:point.id,knowledgeRevision:1,kind:pair.multipleChoice.kind,prompt:pair.multipleChoice.prompt,options:pair.multipleChoice.options.map(o=>o.text),answer:answers.length===1?answers[0]:answers,explanation:pair.multipleChoice.explanation,citedEvidenceUrls:pair.citedEvidenceUrls,pairedQuiz:pair};
}
function repository(){const published=[],attempts=[],discarded=[];return {published,attempts,discarded,findPublished:async()=>({ok:true,value:null}),appendAttempt:async value=>{attempts.push(value);return {ok:true,value:null};},publish:async value=>{published.push(value);return {ok:true,value:null};},discard:async value=>{discarded.push(value);return {ok:true,value:null};},purge:async()=>assert.fail('No purge expected')};}
const judgment=(score,feedback)=>({ok:true,value:{score,reasons:['Constructed per-answer importance judgment.'],feedback,groundingProblems:[],knowledgeGroundingProblems:[]}});

test('generator, reviewer and schema share contextual importance criteria without a count reward or blacklist',()=>{
 for(const instructions of [questionGeneratorPrompt,questionEvaluatorPrompt,quizPairSchema(true).schema.properties.canonicalAnswers.description])assert(instructions.includes(quizAnswerQualityInstruction));
 for(const example of ['a small subset of layers','a testing harness','every encoder hidden state','longer'])assert(quizAnswerQualityInstruction.includes(example));
 assert.match(quizAnswerQualityInstruction,/not by word length, rarity or a vocabulary blacklist/);
 assert.match(quizAnswerQualityInstruction,/what important understanding would go untested/);
 assert.match(quizAnswerQualityInstruction,/Evaluate each fill-blank independently of the MCQ/);
 assert.match(quizAnswerQualityInstruction,/Retrieving a defining technical term from its described role is valid conceptual recall/);
 assert.match(quizAnswerQualityInstruction,/SAME concepts; that agreement is required, not duplication/);
 assert.match(quizAnswerQualityInstruction,/Reducing to one answer does not by itself fix a weak target/);
 assert.match(quizAnswerQualityInstruction,/Repair existing quizzes before considering withdrawal/);
 assert.match(quizAnswerQualityInstruction,/Rewrite both explanations to match the final options and blanks/);
 assert.match(questionGeneratorPrompt,/When previousDraft is supplied, repair that exact pair using feedback/);
 assert.match(quizAnswerQualityInstruction,/optional coverage of another relationship is not a reason to reject a sound single-target question/);
 assert.match(questionEvaluatorPrompt,/For EVERY canonical answer, state in reasons/);
 assert.match(questionEvaluatorPrompt,/Any weak target or filler distractor requires a score below 7/);
 assert.match(questionEvaluatorPrompt,/not knowledgeGroundingProblems/);
});

test('a padded pair stays unpublished; quality feedback repairs both variants to one central target',async()=>{
 const repo=repository(),feedback='Remove "high" and "low": these complete prose without distinct central understanding.',generated=[];
 const result=await createQuizActorCritic({maxAttempts:2,technicalRetries:false,repository:repo,now:()=> '2026-10-20T00:00:00Z',logger:()=>{},generator:{generate:async input=>{generated.push(input);return {ok:true,value:draft(input.attempt===1?['reward model','high','low']:['reward model'])};}},reviewer:{evaluate:async input=>{assert(input.rubric.includes(quizAnswerQualityInstruction));return input.attempt===1?judgment(6,feedback):judgment(9,'One central mechanism remains.');}}}).run({ownerId:'owner',runId:'run',points:[point]});
 assert(result.ok);assert.equal(repo.published.length,1);assert.equal(repo.discarded.length,0);
 assert.equal(generated[1].feedback,feedback);assert.equal(repo.attempts[0].failureKind,'QuizScoreBelowThreshold');
 const pair=repo.published[0].draft.pairedQuiz;
 assert.deepEqual(pair.canonicalAnswers,['reward model']);assert.equal(pair.multipleChoice.kind,'single-choice');assert.equal(pair.fillBlank.blanks.length,1);
 assert(!pair.multipleChoice.options.some(o=>o.text==='high'||o.text==='low'));
});

test('bundled answer repair reaches generation and every reviewer without a delimiter parser',async()=>{
 for(const prompt of [questionGeneratorPrompt,questionEvaluatorPrompt,quizPairSchema(true).schema.properties.canonicalAnswers.description]) {
  assert(prompt.includes('separate canonical answers, separate blanks and separate mapped correct MCQ options'));
  assert(prompt.includes('rhythm and blues'));
  assert(prompt.includes('narrow the question to a supported subset'));
 }
 const repo=repository(),generated=[];
 const knowledge={...point,summary:'Attention uses query, key and value.'};
 const feedback='Split query, key and value into three mapped targets and rewrite both prompts.';
 const result=await createQuizActorCritic({maxAttempts:2,technicalRetries:false,repository:repo,now:()=> '2026-10-23T00:00:00Z',logger:()=>{},generator:{generate:async input=>{generated.push(input);return {ok:true,value:draft(input.attempt===1?['query, key and value']:['query','key','value'])};}},reviewer:{evaluate:async input=>{assert(input.rubric.includes('Reviewers must request repair for bundled distinct items'));return input.attempt===1?judgment(6,feedback):judgment(9,'Three separate concepts.');}}}).run({ownerId:'owner',runId:'run',points:[knowledge]});
 assert.equal(result.ok,true);
 assert.equal(repo.published.length,1);
 assert.deepEqual(repo.published[0].draft.pairedQuiz.canonicalAnswers,['query','key','value']);
 assert(generated[1].feedback.includes(feedback));
});

test('three distinct central concepts can still publish, and a format retry preserves the quality rubric',async()=>{
 const repo=repository();let reviews=0;
 const knowledge={...point,summary:'Self-attention uses queries to match keys, and weights the corresponding values.'};
 const result=await createQuizActorCritic({maxAttempts:2,repository:repo,now:()=> '2026-10-20T00:00:00Z',logger:()=>{},generator:{generate:async()=>({ok:true,value:draft(['query','key','value'])})},reviewer:{evaluate:async input=>{reviews++;assert(input.rubric.includes(quizAnswerQualityInstruction));if(reviews===1)return {ok:true,value:{score:'invalid'}};assert.match(input.rubric,/Previous response failed format validation/);return judgment(9,'Query, key and value each have a distinct central role in this fixture.');}}}).run({ownerId:'owner',runId:'run',points:[knowledge]});
 assert(result.ok);assert.equal(reviews,2);assert.equal(repo.published.length,1);assert.deepEqual(repo.published[0].draft.pairedQuiz.canonicalAnswers,['query','key','value']);
});

test('a repairable explanation defect is revised and published without discarding its sound target',async()=>{
 const repo=repository(),feedback='Keep reward model; remove the explanation reference to deleted option oldB.';
 const result=await createQuizActorCritic({maxAttempts:2,technicalRetries:false,repository:repo,now:()=> '2026-10-20T00:00:00Z',logger:()=>{},generator:{generate:async input=>{
  if(input.attempt===1)assert(!Object.hasOwn(input,'previousDraft'));
  if(input.attempt===2){assert.equal(input.feedback,feedback);assert.deepEqual(input.previousDraft.pairedQuiz.canonicalAnswers,['reward model']);assert.match(input.previousDraft.explanation,/oldB/);}
  const d=draft(['reward model']),explanation=input.attempt===1?'Reward model is correct; oldB is incorrect.':'A reward model scores response preferences; a tokenizer does not.';
  return {ok:true,value:{...d,explanation,pairedQuiz:{...d.pairedQuiz,multipleChoice:{...d.pairedQuiz.multipleChoice,explanation},fillBlank:{...d.pairedQuiz.fillBlank,explanation}}}};
 }},reviewer:{evaluate:async input=>input.attempt===1?{ok:true,value:{score:9,reasons:['The concept is sound.'],feedback,groundingProblems:['Explanation references deleted option oldB.'],knowledgeGroundingProblems:[]}}:judgment(9,'The corrected explanation matches the options.')}}).run({ownerId:'owner',runId:'run',points:[point]});
 assert(result.ok);assert.equal(repo.discarded.length,0);assert.equal(repo.published.length,1);
 assert.equal(repo.attempts[0].failureKind,'QuizDraftUngrounded');
 assert.deepEqual(repo.published[0].draft.pairedQuiz.canonicalAnswers,['reward model']);
 assert(!JSON.stringify(repo.published[0].draft.pairedQuiz).includes('oldB'));
});

// These are synthetic boundary judgments; real model calibration remains separate.
test('focused importance judgments cover every target and any weak target blocks the pair',async()=>{
 const {normalizeQuizAnswerImportance,quizAnswerImportancePrompt}=await import('../src/features/knowledge-workflows/quiz-answer-importance.js');
 assert(quizAnswerImportancePrompt.includes(quizAnswerQualityInstruction));
 const answers=['reward model','high'];
 const valid={targets:[{answer:'reward model',important:true,reason:'Central scoring component.'},{answer:'high',important:false,reason:'Generic directional completion.'}],feedback:'Remove high; keep the reward-model concept.'};
 const result=normalizeQuizAnswerImportance(valid,answers);assert(result.ok);assert.equal(result.value.passed,false);
 assert.equal(normalizeQuizAnswerImportance({...valid,targets:[valid.targets[0]]},answers).ok,false);
 assert.equal(normalizeQuizAnswerImportance({...valid,targets:[...valid.targets].reverse()},answers).ok,false);
 assert.equal(normalizeQuizAnswerImportance({...valid,targets:valid.targets.map(t=>({...t,important:'true'}))},answers).ok,false);
 assert.equal(normalizeQuizAnswerImportance({...valid,extra:true},answers).ok,false);
 const positive=normalizeQuizAnswerImportance({targets:['query','key','value'].map(answer=>({answer,important:true,reason:'A distinct attention vector role.'})),feedback:'Each target is central.'},['query','key','value']);assert(positive.ok&&positive.value.passed);
});

test('visual answerability is required at first generation, schema guidance and review', () => {
  for (const prompt of [questionGeneratorPrompt, questionEvaluatorPrompt, quizPairSchema(true).schema.properties.canonicalAnswers.description]) {
    assert(prompt.includes('Prefer a self-contained verbal question'));
    assert(prompt.includes('Only when learningImageAvailable is true'));
    assert(prompt.includes('Reviewers must reject missing visual context'));
  }
});
