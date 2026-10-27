import {test} from 'node:test';
import assert from 'node:assert/strict';
import {captureCitationSources} from '../worker/webpage-citations.js';
import {requestWebpageFacts} from '../worker/webpage-facts.js';
const url='https://fixture.invalid/genres';
const blocks=['60–110','R&B','Tempo (BPM)'].map((text,index)=>({id:`cell-${index}`,locator:`td:nth-of-type(${index+1})`,sectionId:'genres',kind:'text',figureId:null,text}));
const captured=await captureCitationSources({owner:url,sources:blocks.map(({id,locator,text})=>({id,locator,text}))});assert(captured.ok);
const anchor=index=>({reference:captured.value.sources[index].reference,clause:blocks[index].text});
const parent={summary:'R&B has a tempo range of 60–110 BPM.',normalizedHash:'rnb-tempo',coverageGoalIds:[],mediaCandidates:[],evidenceAnchors:[anchor(0)]};
for(const change of ['unchanged','covered-unchanged','summary','identity','lost-support','foreign-reference'])test(`captured citation augmentation preserves exact parent lineage: ${change}`,async()=>{
 const child={...structuredClone(parent),evidenceAnchors:[anchor(0),anchor(1),anchor(2)]};
 if(change==='summary')child.summary='R&B has a tempo range of 120–150 BPM.';
 if(change==='identity')child.normalizedHash='different-claim';
 if(change==='lost-support')child.evidenceAnchors.shift();
 if(change==='foreign-reference')child.evidenceAnchors.push({reference:{kind:'text',id:'not-captured'},clause:'Invented support'});
 const result=await requestWebpageFacts({requireCoverage:change==='covered-unchanged',normalizeClaims:true,deferQualityReview:true,taskId:'citation-augmentation',input:{url,evidence:{url,blocks,headings:[],images:[],warnings:[]},coverageGoals:[]},maxOutputTokens:4096,logger:()=>{},generate:async command=>({ok:true,value:command.phase==='extraction'?{notes:'',candidates:[parent]}:{notes:'',reviews:[{sourceNormalizedHash:parent.normalizedHash,relationshipUnits:[{condition:null,relationship:child.summary,childNormalizedHash:child.normalizedHash}],candidates:[child]}],additionalCandidates:[],...(change==='covered-unchanged'?{blockCoverage:blocks.map(block=>({blockId:block.id,disposition:'candidates',candidateHashes:[parent.normalizedHash],reason:'The unchanged draft cites this captured table value or label.'}))}:{})}})});
 if(change==='unchanged'||change==='covered-unchanged'){
  assert(result.ok,JSON.stringify(result));assert.equal(result.value.candidates.length,1);assert.equal(result.value.candidates[0].summary,parent.summary);assert.equal(result.value.candidates[0].normalizedHash,parent.normalizedHash);assert.deepEqual(result.value.candidates[0].evidenceAnchors.map(a=>a.quote),blocks.map(b=>b.text));
 }else if(change==='foreign-reference'){
  assert(result.ok);assert.equal(result.value.candidates.length,0);assert(result.value.partialIssues.some(issue=>issue.kind==='WebpageCandidateEvidenceInvalid'));
 }else {assert.equal(result.ok,false);assert.equal(result.error.kind,'WebpageClaimBoundariesInvalid');}
});
