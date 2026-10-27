// @ts-check
import {createQuizActorCritic,QUIZ_MAX_ATTEMPTS} from '../src/features/knowledge-workflows/quiz.js';
/** @param {number} score @param {boolean} [unsafe] */
async function run(score,unsafe=false){
  let published=0,discarded=0;
  const point={id:'point',sourceId:'source',sourceRevision:1,summary:'A meaningful source relationship.',normalizedHash:'relationship',evidenceAnchors:[{url:'https://fixture.invalid',selector:'p'}],coverageGoalIds:[],mediaCandidates:[],attribution:{sourceUrl:'https://fixture.invalid'},extractionVersion:'synthetic'};
  const actor=createQuizActorCritic({maxAttempts:QUIZ_MAX_ATTEMPTS,logger:()=>{},now:()=>new Date().toISOString(),generator:{generate:async()=>({ok:true,value:{id:'draft',knowledgeId:point.id,knowledgeRevision:1,kind:'single-choice',prompt:'Which relationship applies?',options:['A','B'],answer:'A',citedEvidenceUrls:['https://fixture.invalid']}})},reviewer:{evaluate:async()=>({ok:true,value:{score,reasons:['Synthetic review.'],feedback:'Synthetic feedback.',groundingProblems:unsafe?['The answer lacks source support.']:[]}})},repository:{findPublished:async()=>({ok:true,value:null}),appendAttempt:async()=>({ok:true,value:null}),publish:async()=>{published++;return {ok:true,value:null};},discard:async()=>{discarded++;return {ok:true,value:null};},purge:async()=>({ok:true,value:null}),restrict:async()=>({ok:true,value:null})}});
  const result=await actor.run({ownerId:'owner',runId:'run',points:[point]});return {result,published,discarded};
}
Deno.test('a sound score-seven quiz is accepted',async()=>{const r=await run(7);if(r.published!==1)throw new Error('Sound score-seven quiz was rejected');});
Deno.test('quiz quality failure preserves verified knowledge',async()=>{const r=await run(6);if(r.discarded!==0||r.published!==0)throw new Error('A failed quiz must not delete its knowledge point');});
Deno.test('score seven cannot bypass grounding',async()=>{const r=await run(7,true);if(r.published!==0||r.discarded!==0)throw new Error('Grounding remains blocking without deleting verified knowledge');});
