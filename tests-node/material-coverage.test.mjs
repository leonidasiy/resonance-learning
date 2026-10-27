import assert from 'node:assert/strict';
import {test} from 'node:test';
import {requestMaterialBatch} from '../worker/knowledge-workflow-runtime.js';
import {materialTextEvidence} from '../worker/material-text-coverage.js';
import {auditMaterialImageCoverage} from '../worker/material-image-coverage.js';
const url='https://fixture.invalid/upload';
const section={id:'page-1',title:'Uploaded text',locator:'page:1',url,text:'Early relationship.\n'+'A distinct relationship and its necessary conditions. '.repeat(300)+'\nLate relationship: preserve 𝄞 and 中文.'};
const evidence=materialTextEvidence(section);

test('uploaded text splitting preserves exact content including Unicode and final text',()=>{
  assert.equal(evidence.blocks.map(b=>b.text).join(''),section.text);
  assert(evidence.blocks.length>1);assert(evidence.blocks.at(-1).text.endsWith('𝄞 and 中文.'));
  for(const block of evidence.blocks){const [start,end]=block.locator.split('text-codepoints=')[1].split(':').map(Number);assert.equal(Array.from(section.text).slice(start,end).join(''),block.text);}
});
for(const kind of ['PDF page','slide','plain text','transcript','captured-page PDF'])test(`${kind} uses complete uploaded-text accounting`,async()=>{
  const seen=[];let handoffs=0;
  const result=await requestMaterialBatch({requireCoverage:true,onDrafts:async page=>{handoffs++;assert.equal(page.url,section.url);assert(page.candidates.length>0);assert(page.candidates.every(candidate=>candidate.evidenceAnchors.every(anchor=>anchor.selector===section.locator)));return {ok:true,value:null};},reviewMaterial:false,taskId:'material',input:{mode:'text',sections:[section],fileName:kind,coverageGoals:[],progress:{},previousKnowledge:[{id:'saved',summary:'A saved unrelated concept.'}]},maxOutputTokens:4096,logger:()=>{},generate:async c=>{
    const task=c.input;assert.deepEqual(task.previousKnowledge,[{id:'saved',summary:'A saved unrelated concept.'}]);
    if(c.phase==='extraction'){
      seen.push(...task.sourceBlocks.map(b=>b.id));
      return {ok:true,value:{notes:'Synthetic extraction.',candidates:task.sourceBlocks.map(b=>({summary:b.text,normalizedHash:b.id,evidenceAnchors:[{reference:b.citationReference,clause:b.text}],coverageGoalIds:[],mediaCandidates:[]}))}};
    }
    return {ok:true,value:{notes:'Synthetic audit.',reviews:task.candidates.map(c=>({sourceNormalizedHash:c.normalizedHash,relationshipUnits:[{condition:null,relationship:c.summary,childNormalizedHash:c.normalizedHash}],candidates:null})),additionalCandidates:[],blockCoverage:task.sourceBlocks.map(b=>({blockId:b.id,disposition:'candidates',candidateHashes:[b.id],reason:'A source-supported relationship.'}))}};
  }});
  assert(result.ok);assert.equal(handoffs,1);assert.deepEqual(seen,evidence.blocks.map(b=>b.id));assert.equal(result.value[0].blockCoverage.length,evidence.blocks.length);
  assert.equal(result.value[0].candidates.map(c=>c.evidenceAnchors[0].quote).join(''),section.text);
  assert(result.value[0].candidates.every(c=>c.evidenceAnchors[0].selector===section.locator));
});
const observations={notes:'Synthetic visual inventory.',observations:[{id:'top',description:'Top relationship.'},{id:'bottom',description:'Bottom relationship.'}]};
const point={summary:'Top relationship.',normalizedHash:'top',coverageGoalIds:[],evidenceAnchors:[{url,selector:'image:1',visibleEvidence:'Top relationship.'}],mediaCandidates:[{visualId:'image:1'}]};
for(const defect of ['missing','unresolved','foreign','duplicate','none'])test(`image observation audit ${defect==='none'?'accepts complete justified accounting':'rejects '+defect}`,async()=>{
  const coverage=[{observationId:'top',disposition:'candidates',candidateHashes:['top'],reason:'The draft preserves this relationship.'},{observationId:'bottom',disposition:'excluded',candidateHashes:[],reason:'The lower region repeats the same relationship.'}];
  if(defect==='missing')coverage.pop();if(defect==='unresolved')coverage[1].disposition='unresolved';if(defect==='foreign')coverage[0].candidateHashes=['invented'];if(defect==='duplicate')coverage[1]={...coverage[0]};
  const result=await auditMaterialImageCoverage({taskId:'image',input:{sections:[{...section,locator:'image:1'}],coverageGoals:[],visualId:'image:1'},maxOutputTokens:1000,generate:async c=>{assert.equal(c.phase,'normalization');return {ok:true,value:{observationCoverage:coverage,additionalCandidates:[]}};}},observations,{url,notes:'Draft',candidates:[point]});
  assert.equal(result.ok,defect==='none');if(!result.ok)assert.equal(result.error.kind,'MaterialImageCoverageIncomplete');
});
