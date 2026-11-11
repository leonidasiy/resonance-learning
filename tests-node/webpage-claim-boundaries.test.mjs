import {syntheticPartitionReviews} from './fixtures/webpage-condition-partition.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {captureCitationSources} from '../worker/webpage-citations.js';
import {requestWebpageFacts,createWebpageAttemptPolicy} from '../worker/webpage-facts.js';
const url='https://synthetic.invalid/',text='Heating melts ice. Cooling freezes water.';
const evidence={url,blocks:[{id:'b',locator:'p',sectionId:'s',kind:'text',figureId:null,text}],headings:[],images:[],warnings:[]};
const captured=await captureCitationSources({owner:url,sources:[{id:'b',locator:'p',text}]});assert(captured.ok);
const candidate=(summary,normalizedHash)=>({summary,normalizedHash,coverageGoalIds:[],mediaCandidates:[],evidenceAnchors:[{reference:captured.value.sources[0].reference,clause:summary}]});
const combined=candidate(text,'combined'),split=[candidate('Heating melts ice.','heat'),candidate('Cooling freezes water.','cold')];
const reviewed=candidates=>({notes:'',reviews:[{sourceNormalizedHash:combined.normalizedHash,candidates}]});
async function exercise(normalized,{initial=[combined],grounded=true,inspect=()=>{}}={}){
 const phases=[],result=await requestWebpageFacts({normalizeClaims:true,structuredOutput:true,taskId:'case:facts',input:{url,evidence,coverageGoals:[],outside:'excluded',pixels:'excluded'},maxOutputTokens:4096,logger:()=>{},generate:async command=>{
  phases.push(command.phase);inspect(command);
  return {ok:true,value:command.phase==='extraction'?{notes:'',candidates:initial}:command.phase==='normalization'?{additionalCandidates:[],...normalized,...(Array.isArray(normalized.reviews)?{reviews:syntheticPartitionReviews(normalized.reviews)}:{})}:{verdicts:command.input.candidates.map(point=>({normalizedHash:point.normalizedHash,grounded}))}};
 }});return {result,phases};
}
test('claim review splits independent targets before immutable grounding with captured provenance',async()=>{
 const {result,phases}=await exercise(reviewed(split),{inspect:command=>{
  assert.equal(command.attachments,undefined);assert(!JSON.stringify(command.input).includes('excluded'));
  assert.equal(command.input.sourceBlocks[0].text,text);
  if(command.phase==='normalization'){assert.equal(command.taskId,'case:facts:normalization');assert.deepEqual(command.input.candidates,[combined]);assert.match(command.systemPrompt,/source-wide completeness/);assert.match(command.systemPrompt,/Remove a clause added by the extractor/);assert.match(command.systemPrompt,/explicitly established in the captured text/);assert.match(command.systemPrompt,/Distinct outcomes under alternative conditions MUST be separate children/);assert.deepEqual(command.responseSchema.schema.properties.reviews.items.properties.candidates.anyOf[1].items.properties.evidenceAnchors.items.properties.reference.properties.id.enum,[captured.value.sources[0].reference.id]);}
  if(command.phase==='grounding'){assert.deepEqual(command.input.candidates.map(c=>c.summary),split.map(c=>c.summary));command.input.candidates[0].summary='Model port mutation';}
 }});
 assert(result.ok);assert.deepEqual(phases,['extraction','normalization','grounding']);assert.equal(result.value.status,'complete');assert.deepEqual(result.value.candidates.map(c=>c.summary),split.map(c=>c.summary));
 for(const point of result.value.candidates){assert(Object.isFrozen(point));assert.equal(point.evidenceAnchors[0].quote,text);assert.equal(point.evidenceAnchors[0].quoteDigest,captured.value.sources[0].quoteDigest);}
});
test('normalization shares strict evidence validation and never repairs malformed candidates',async()=>{
 const foreign=structuredClone(split);foreign[0].evidenceAnchors[0].reference={kind:'text',id:'foreign'};
 const {result,phases}=await exercise(reviewed(foreign));assert(result.ok);assert.equal(result.value.status,'partial');assert.equal(result.value.partialIssues[0].kind,'WebpageCandidateEvidenceInvalid');assert.deepEqual(result.value.candidates.map(c=>c.normalizedHash),['cold']);assert.deepEqual(phases,['extraction','normalization','grounding']);
 const malformed=await exercise({...reviewed(split),notes:[]});assert.equal(malformed.result.error.kind,'WebpageClaimBoundariesInvalid');assert.deepEqual(malformed.phases,['extraction','normalization']);
 const partial=await exercise(reviewed(split),{initial:[null,combined]});assert(partial.result.ok);assert.equal(partial.result.value.status,'partial');assert.deepEqual(partial.phases,['extraction','normalization','grounding']);
});
test('valid adverse grounding is terminal and normalization gets exactly one bounded attempt',async()=>{
 const {result,phases}=await exercise(reviewed(split),{grounded:false});assert(result.ok);assert.equal(result.value.candidates.length,0);assert.deepEqual(phases,['extraction','normalization','grounding']);
 const policy=createWebpageAttemptPolicy({extraction:1,normalization:1,grounding:1,match:0,verify:0,requests:3});let calls=0;const command={phase:'normalization',taskId:'normalization',systemPrompt:'Synthetic',input:{},maxOutputTokens:1};
 assert((await policy.dispatch(command,async()=>{calls++;return {ok:true,value:{}};})).ok);assert.equal((await policy.dispatch(command,async()=>{throw Error('never');})).error.kind,'WebpagePhaseAttemptLimitExceeded');assert.equal(calls,1);assert.throws(()=>createWebpageAttemptPolicy({extraction:1,normalization:2,grounding:1,match:0,verify:0,requests:4}));
});
test('review envelope cannot lose original targets, use foreign parents or duplicate a parent',async()=>{
 for(const reviews of [[],[{sourceNormalizedHash:'foreign',candidates:split}],[{sourceNormalizedHash:'combined',candidates:[]}],[{sourceNormalizedHash:'combined',candidates:split},{sourceNormalizedHash:'combined',candidates:split}]]){const {result,phases}=await exercise({notes:'',reviews});assert.equal(result.error.kind,'WebpageClaimBoundariesInvalid');assert.deepEqual(phases,['extraction','normalization']);}
 const initial=[candidate('Heating melts ice.','heat'),candidate('Cooling freezes water.','cold')];
 const {result,phases}=await exercise({notes:'',reviews:initial.map(c=>({sourceNormalizedHash:c.normalizedHash,candidates:[c]}))},{initial});assert(result.ok);assert.deepEqual(result.value.candidates.map(c=>c.normalizedHash),['heat','cold']);assert.deepEqual(phases,['extraction','normalization','grounding']);
});

test('selection grounding separates source truth from usefulness and rejects missing selection verdicts',async()=>{
 const initial=[candidate('Heating melts ice.','heat'),candidate('Cooling freezes water.','cold')],phases=[];
 const execute=verdicts=>requestWebpageFacts({reviewUsefulness:true,structuredOutput:true,taskId:'selection',input:{url,evidence,coverageGoals:[]},maxOutputTokens:4096,logger:()=>{},generate:async command=>{
  phases.push(command.phase);if(command.phase==='extraction')return {ok:true,value:{notes:'',candidates:initial}};
  assert.deepEqual(command.responseSchema.schema.properties.verdicts.items.required,['normalizedHash','grounded','useful']);assert.equal(command.responseSchema.schema.properties.verdicts.items.properties.useful.type,'boolean');assert.match(command.systemPrompt,/source support and educational usefulness separately/);assert.match(command.systemPrompt,/figure-specific letter/);assert.match(command.systemPrompt,/Check each equation and decision condition against the actual captured text/);assert.match(command.systemPrompt,/do not reject the whole relationship merely for that value/);assert.match(command.systemPrompt,/Judge these immutable candidates only/);assert.doesNotMatch(command.systemPrompt,/# Learning quality — selection-v3/);
  return {ok:true,value:{verdicts}};
 }});
 const result=await execute([{normalizedHash:'heat',grounded:true,useful:true},{normalizedHash:'cold',grounded:true,useful:false}]);assert(result.ok);assert.equal(result.value.status,'partial');assert.deepEqual(result.value.candidates.map(c=>c.normalizedHash),['heat']);assert.equal(result.value.partialIssues[0].kind,'WebpageCandidateUsefulnessRejected');assert.equal(result.value.partialIssues[0].candidateIndex,1);assert.deepEqual(phases,['extraction','grounding']);
 for(const useful of [undefined,'false',null]){const bad=await execute([{normalizedHash:'heat',grounded:true,...(useful===undefined?{}:{useful})},{normalizedHash:'cold',grounded:true,useful:true}]);assert.equal(bad.error.kind,'WebpageGroundingInvalid');}
});
