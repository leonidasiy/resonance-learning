import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewKnowledgeBatch} from '../worker/knowledge-workflow-parallel-review.js';
const points=Array.from({length:7},(_,i)=>({id:`point-${i}`,summary:`Constructed claim ${i}`}));
test('parallel review bounds requests, settles every worker, and preserves source order and semantic selection',async()=>{
 let active=0,maximum=0,finished=0;
 const result=await reviewKnowledgeBatch({points,review:async point=>{active++;maximum=Math.max(maximum,active);await new Promise(r=>setTimeout(r,point.id==='point-0'?15:1));active--;finished++;return {ok:true,value:point};},select:async candidates=>{assert.equal(active,0);assert.equal(finished,7);assert.deepEqual(candidates,points);return {ok:true,value:{keptKnowledgeIds:points.filter((_,i)=>i!==1).map(p=>p.id)}};}});
 assert.equal(maximum,3);assert.equal(active,0);assert.deepEqual(result.map(r=>r.ok?r.value?.id:null),points.map((p,i)=>i===1?undefined:p.id));
});
test('parallel review retains individual failures and rejected points without silently accepting unchecked duplicates',async()=>{
 const result=await reviewKnowledgeBatch({points:points.slice(0,4),review:async p=>p.id==='point-1'?{ok:false,error:{kind:'KnowledgeReviewOutputInvalid'}}:p.id==='point-2'?{ok:true,value:null}:{ok:true,value:p},select:async candidates=>{assert.deepEqual(candidates.map(p=>p.id),['point-0','point-3']);return {ok:false,error:{kind:'KnowledgeModelTimeout'}};}});
 assert.deepEqual(result,[{ok:false,error:{kind:'KnowledgeModelTimeout'}},{ok:false,error:{kind:'KnowledgeReviewOutputInvalid'}},{ok:true,value:null},{ok:false,error:{kind:'KnowledgeModelTimeout'}}]);
});
test('batch selection rejects invented and repeated IDs, and rechecks a cached single survivor against the current saved context',async()=>{
 for(const keptKnowledgeIds of [['unknown'],['point-0','point-0']]){
  const result=await reviewKnowledgeBatch({points:points.slice(0,2),review:async p=>({ok:true,value:p}),select:async()=>({ok:true,value:{keptKnowledgeIds}})});
  assert(result.every(r=>!r.ok&&r.error.kind==='KnowledgeReviewOutputInvalid'));
 }
 let calls=0;const single=await reviewKnowledgeBatch({points:points.slice(0,1),review:async p=>({ok:true,value:p}),select:async()=>{calls++;return {ok:true,value:{keptKnowledgeIds:[]}};}});
 assert.equal(calls,1);assert.equal(single[0].value,null);
});

test('a partial review chunk defers whole-page selection and preserves pending dispositions',async()=>{
 const result=await reviewKnowledgeBatch({points,review:async point=>point.id==='point-3'?{ok:false,error:{kind:'KnowledgeReviewChunkPending'}}:{ok:true,value:point},select:async()=>assert.fail('Selection requires all individual reviews')});
 assert.equal(result[3].error.kind,'KnowledgeReviewChunkPending');assert.equal(result[0].value,points[0]);
});

test('overlapping pipeline stages share three model slots and release them after failure',async()=>{
 const {createModelRequestLimiter}=await import('../worker/knowledge-workflow-parallel-review.js');
 const slot=createModelRequestLimiter();let active=0,maximum=0,finished=0;
 const results=await Promise.allSettled(Array.from({length:12},(_,i)=>slot(async()=>{
  active++;maximum=Math.max(maximum,active);
  try{await new Promise(resolve=>setTimeout(resolve,1));if(i===1)throw Error('Synthetic provider failure');return i;}
  finally{active--;finished++;}
 })));
 assert.equal(maximum,3);assert.equal(active,0);assert.equal(finished,12);assert.equal(results.filter(result=>result.status==='rejected').length,1);
 assert.equal(await slot(async()=>42),42);
});
