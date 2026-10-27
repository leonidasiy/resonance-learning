import assert from 'node:assert/strict';
import {test} from 'node:test';
import {requestWebpageFacts} from '../worker/webpage-facts.js';
import {captureCitationSources} from '../worker/webpage-citations.js';

const url='https://fixture.invalid/composers';
const blocks=Array.from({length:30},(_,i)=>({id:`block:${i+1}`,sectionId:`section:${i+1}`,locator:`li:nth-of-type(${i+1}) p`,kind:'text',figureId:null,text:`Composer ${i+1} developed a distinct musical technique with an explanation of its effect.`}));
const evidence={url,blocks,headings:[],images:[],warnings:[]};
const captured=await captureCitationSources({owner:url,sources:blocks.map(({id,locator,text})=>({id,locator,text}))});
assert(captured.ok);
const candidates=blocks.slice(0,10).map((b,i)=>({summary:b.text,normalizedHash:`composer:${i+1}`,coverageGoalIds:[],mediaCandidates:[],evidenceAnchors:[{reference:captured.value.sources[i].reference,clause:b.text}]}));

test('a captured 30-section page cannot complete with only its first 10 accounted for',async()=>{
  const result=await requestWebpageFacts({requireCoverage:true,normalizeClaims:true,deferQualityReview:true,taskId:'coverage-repro',input:{url,evidence,coverageGoals:[]},maxOutputTokens:4096,logger:()=>{},generate:async command=>({ok:true,value:command.phase==='extraction'?{notes:'Later text unavailable.',candidates}:{notes:'Later text unavailable.',reviews:candidates.map(c=>({sourceNormalizedHash:c.normalizedHash,relationshipUnits:[{condition:null,relationship:c.summary,childNormalizedHash:c.normalizedHash}],candidates:null})),additionalCandidates:[]}})});
  assert.equal(result.ok,false,'Unaccounted captured sections must prevent completion');
  assert.equal(result.error.kind,'WebpageCoverageIncomplete');
});

function responder({omit,unresolved,exclude=false,invalidHash=false}={}) {
  return async command=>{
    const task=command.input;
    const drafts=task.sourceBlocks.map(b=>({summary:b.text,normalizedHash:b.id,coverageGoalIds:[],mediaCandidates:[],evidenceAnchors:[{reference:b.citationReference??task.citationSources.find(c=>c.sourceId===b.id).reference,clause:b.text}]}));
    if(command.phase==='extraction')return {ok:true,value:{notes:'',candidates:exclude?[]:drafts}};
    if(command.phase==='normalization')return {ok:true,value:{notes:'',reviews:task.candidates.map(c=>({sourceNormalizedHash:c.normalizedHash,relationshipUnits:[{condition:null,relationship:c.summary,childNormalizedHash:c.normalizedHash}],candidates:null})),additionalCandidates:[],blockCoverage:task.sourceBlocks.filter(b=>b.id!==omit).map(b=>({blockId:b.id,disposition:b.id===unresolved?'unresolved':exclude?'excluded':'candidates',candidateHashes:exclude||b.id===unresolved?[]:[invalidHash?'invented':b.id],reason:exclude?'This block is administrative context.':'This draft preserves the supplied relationship.'}))}};
    throw Error('Unexpected phase');
  };
}
function run(source=evidence,generate=responder()){
  return requestWebpageFacts({requireCoverage:true,normalizeClaims:true,deferQualityReview:true,structuredOutput:true,taskId:'coverage',input:{url:source.url,evidence:source,coverageGoals:[]},maxOutputTokens:4096,logger:()=>{},generate});
}
test('every block, including the tail, is processed with adjacent exact citation references',async()=>{
  const source={...evidence,blocks:blocks.map(b=>({...b,text:b.text.repeat(25)}))};
  const seen=[],tasks=[];
  const model=responder();
  const result=await run(source,async command=>{
    if(command.phase==='extraction'){
      tasks.push(command.taskId);seen.push(...command.input.sourceBlocks.map(b=>b.id));
      for(const b of command.input.sourceBlocks)assert.deepEqual(b.citationReference,command.input.citationSources.find(c=>c.sourceId===b.id).reference);
    }
    return model(command);
  });
  assert(result.ok);assert(tasks.length>1);assert.equal(new Set(tasks).size,tasks.length);
  assert.deepEqual(seen,blocks.map(b=>b.id));assert.equal(result.value.candidates.length,30);assert.equal(result.value.blockCoverage.length,30);
  assert.equal(result.value.candidates.at(-1).evidenceAnchors[0].quote,source.blocks.at(-1).text);
});
for(const [name,options] of Object.entries({omitted:{omit:'block:30'},unresolved:{unresolved:'block:30'},foreignCandidate:{invalidHash:true}}))test(`coverage cannot complete with ${name}`,async()=>{
  const result=await run(evidence,responder(options));assert.equal(result.ok,false);assert.equal(result.error.kind,'WebpageCoverageIncomplete');
});
test('zero-point sections require explicit exclusions and do not force a knowledge quota',async()=>{
  const result=await run(evidence,responder({exclude:true}));assert(result.ok);assert.equal(result.value.candidates.length,0);assert.equal(result.value.blockCoverage.length,30);assert(result.value.blockCoverage.every(c=>c.disposition==='excluded'&&c.reason));
});
test('a failed later chunk prevents complete-page success and retains deterministic retry identities',async()=>{
  const source={...evidence,blocks:blocks.map(b=>({...b,text:b.text.repeat(25)}))};const tasks=[];const model=responder();
  const generate=async c=>{tasks.push(c.taskId);return c.taskId.includes(':coverage-v1:2')?{ok:false,error:{kind:'SyntheticTimeout'}}:model(c);};
  assert.equal((await run(source,generate)).error.kind,'SyntheticTimeout');const first=[...tasks];tasks.length=0;
  await run(source,generate);assert.deepEqual(tasks,first);
});

test('coverage rejects a repeated block receipt even when its length matches the inventory',async()=>{
  const model=responder();const result=await run(evidence,async command=>{const r=await model(command);if(command.phase==='normalization')r.value.blockCoverage[r.value.blockCoverage.length-1]={...r.value.blockCoverage[0]};return r;});
  assert.equal(result.ok,false);assert.equal(result.error.kind,'WebpageCoverageIncomplete');
});
test('normalizer can restore an educational block omitted by an empty extractor',async()=>{
  const source={...evidence,blocks:[blocks.at(-1)]};const model=responder();
  const result=await run(source,async command=>{
    if(command.phase==='extraction')return {ok:true,value:{notes:'Mistaken empty extractor.',candidates:[]}};
    const b=command.input.sourceBlocks[0];const draft={summary:b.text,normalizedHash:b.id,coverageGoalIds:[],mediaCandidates:[],evidenceAnchors:[{reference:b.citationReference,clause:b.text}]};
    return {ok:true,value:{notes:'Restored missing tail.',reviews:[],additionalCandidates:[draft],blockCoverage:[{blockId:b.id,disposition:'candidates',candidateHashes:[b.id],reason:'The tail contains a useful distinct relationship.'}]}};
  });
  assert(result.ok);assert.equal(result.value.candidates[0].summary,blocks.at(-1).text);
});

test('compact unchanged reviews resolve unique child aliases without rewriting claims or losing coverage',async()=>{
  const model=responder();
  const result=await run(evidence,async command=>{
    const r=await model(command);
    if(command.phase==='normalization'){
      for(const review of r.value.reviews)review.relationshipUnits[0].childNormalizedHash+='-kept';
      for(const entry of r.value.blockCoverage)entry.candidateHashes=entry.candidateHashes.map(h=>h+'-kept');
    }
    return r;
  });
  assert(result.ok);
  assert.deepEqual(result.value.candidates.map(c=>[c.normalizedHash,c.summary,c.evidenceAnchors[0].quote]),blocks.map(b=>[b.id,b.text,b.text]));
  assert.deepEqual(result.value.blockCoverage.map(c=>c.candidateHashes),blocks.map(b=>[b.id]));
});
test('compact unchanged reviews reject aliases that collide with another claim identity',async()=>{
  const model=responder();const result=await run(evidence,async command=>{
    const r=await model(command);
    if(command.phase==='normalization')r.value.reviews[0].relationshipUnits[0].childNormalizedHash=r.value.reviews[1].sourceNormalizedHash;
    return r;
  });
  assert.equal(result.ok,false);assert.equal(result.error.kind,'WebpageClaimBoundariesInvalid');
});
test('coverage retains a valid cited relationship and removes an extra association to an uncited draft',async()=>{
  const model=responder();const result=await run(evidence,async command=>{
    const r=await model(command);
    if(command.phase==='normalization')r.value.blockCoverage[1].candidateHashes.unshift(r.value.reviews[0].sourceNormalizedHash);
    return r;
  });
  assert(result.ok);assert.deepEqual(result.value.blockCoverage[1].candidateHashes,['block:2']);
});
test('coverage still fails when its only draft does not cite the claimed source block',async()=>{
  const model=responder();const result=await run(evidence,async command=>{
    const r=await model(command);
    if(command.phase==='normalization')r.value.blockCoverage[1].candidateHashes=[r.value.reviews[0].sourceNormalizedHash];
    return r;
  });
  assert.equal(result.ok,false);assert.equal(result.error.kind,'WebpageCoverageIncomplete');
});

test('validated first drafts enter review while later chunks extract, and all handoffs settle before return',async()=>{
 const source={...evidence,blocks:blocks.map(b=>({...b,text:b.text.repeat(25)}))};
 let release,started=false,settled=false,laterExtraction=false;
 const gate=new Promise(resolve=>{release=resolve;}),model=responder();
 const result=await requestWebpageFacts({requireCoverage:true,normalizeClaims:true,deferQualityReview:true,taskId:'pipeline',input:{url,evidence:source,coverageGoals:[]},maxOutputTokens:4096,logger:()=>{},onDrafts:async drafts=>{
  assert(drafts.length>0);assert(drafts.length<30);started=true;await gate;settled=true;return {ok:true,value:null};
 },generate:async command=>{
  if(command.phase==='extraction'&&command.taskId.includes(':coverage-v1:2')){assert(started);assert(!settled);laterExtraction=true;release();}
  return model(command);
 }});
 assert(result.ok);assert(laterExtraction);assert(settled);assert.equal(result.value.blockCoverage.length,30);
});

test('a failed tail drains the early review without marking the source complete',async()=>{
 const source={...evidence,blocks:blocks.map(b=>({...b,text:b.text.repeat(25)}))};let finished=false;
 const model=responder();
 const result=await requestWebpageFacts({requireCoverage:true,normalizeClaims:true,deferQualityReview:true,taskId:'pipeline-failure',input:{url,evidence:source,coverageGoals:[]},maxOutputTokens:4096,logger:()=>{},onDrafts:async()=>{await new Promise(resolve=>setTimeout(resolve,5));finished=true;return {ok:true,value:null};},generate:command=>command.taskId.includes(':coverage-v1:2')?Promise.resolve({ok:false,error:{kind:'SyntheticTailFailure'}}):model(command)});
 assert.equal(result.ok,false);assert.equal(result.error.kind,'SyntheticTailFailure');assert(finished);
});
