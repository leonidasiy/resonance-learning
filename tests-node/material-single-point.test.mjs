import assert from 'node:assert/strict';
import {test} from 'node:test';
import {requestSingleMaterialPoint} from '../worker/material-single-point.js';
import {parseAuthorizedMaterial} from '../src/features/knowledge-workflows/material.js';
import {D1KnowledgeWorkflowMaterialRepository} from '../worker/knowledge-workflow-material-d1.js';

const sections=[{id:'first',title:'Introduction',locator:'page:1',url:'https://example.test/source#first',text:'First supporting relationship.'},{id:'last',title:'Conclusion',locator:'page:9',url:'https://example.test/source#last',text:'The final section teaches the central relationship.'}];
const input={sections,coverageGoals:[{id:'whole-submission'}],fileName:'complete.pdf',mode:'text',progress:{}};
const dependencies={taskId:'whole-upload',input,maxOutputTokens:2048,logger:()=>{}};

test('one-point extraction considers the whole submission and retains selected original evidence',async()=>{
 let calls=0;
 const result=await requestSingleMaterialPoint({...dependencies,generate:async command=>{
  calls++;assert.deepEqual(command.input.sections,sections);assert.match(command.systemPrompt,/entire supplied learning submission/);assert.equal(command.responseSchema.name,'whole_submission_one_point_v1');
  return {ok:true,value:{sectionId:'last',summary:'The final section teaches the central relationship.',evidence:'The final section teaches the central relationship.'}};
 }});
 assert.equal(calls,1);assert.equal(result.ok,true);assert.equal(result.value.length,1);assert.equal(result.value[0].candidates.length,1);assert.equal(result.value[0].url,sections[0].url);assert.equal(result.value[0].responseUrl,sections[1].url);assert.equal(result.value[0].candidates[0].evidenceAnchors[0].selector,'page:9');
});

test('one-point extraction rejects plural, fabricated evidence and unknown sections',async()=>{
 for(const value of [{sectionId:'last',summary:'Summary',evidence:'invented quotation'},{sectionId:'unknown',summary:'Summary',evidence:'First supporting relationship.'},{sectionId:'last',summary:'Summary',evidence:sections[1].text,candidates:[]}]){
  const result=await requestSingleMaterialPoint({...dependencies,generate:async()=>({ok:true,value})});assert.equal(result.ok,false);assert.equal(result.error.kind,'KnowledgeSingleMaterialPointInvalid');
 }
});

test('one-point image extraction includes all pages and retains the selected original image',async()=>{
 const attachments=sections.map(section=>({id:`visual:digest:${section.id}`,mediaType:'image/png',bytes:new Uint8Array([1])}));
 const result=await requestSingleMaterialPoint({...dependencies,input:{...input,mode:'image'},attachments,generate:async command=>{
  assert.deepEqual(command.attachments,attachments);assert.deepEqual(command.input.sections,sections);
  return {ok:true,value:{sectionId:'last',summary:'The visible labels teach a relationship.',evidence:'The arrow connects the two visible labels.'}};
 }});
 assert.equal(result.ok,true);assert.deepEqual(result.value[0].candidates[0].mediaCandidates,[{visualId:'visual:digest:last'}]);
});

test('one-point extraction fails safely without inventing knowledge when support is absent',async()=>{
 const result=await requestSingleMaterialPoint({...dependencies,generate:async()=>({ok:true,value:{sectionId:null,summary:null,evidence:null}})});assert.equal(result.ok,true);assert.equal(result.value[0].candidates.length,0);
});

test('upload parser and durable material read preserve the option and reject malformed values',async()=>{
 const command={ownerId:'owner',runId:'run',sourceId:'source',sourceRevision:1,sourceUrl:'https://example.test/source',mediaType:'text/plain',fileName:'content.txt',mode:'text',bytes:new TextEncoder().encode('An entire submitted relationship.'),idempotencyKey:'upload',oneKnowledgePointOnly:true};
 const parserDependencies={digest:async()=> 'a'.repeat(64),maximumBytes:10000,maximumCharacters:10000};
 const parsed=await parseAuthorizedMaterial(command,parserDependencies);assert.equal(parsed.ok,true);assert.equal(parsed.value.oneKnowledgePointOnly,true);
 const bad=await parseAuthorizedMaterial({...command,oneKnowledgePointOnly:'true'},parserDependencies);assert.equal(bad.ok,false);
 const material={...parsed.value,media:[]};
 const row={material_id:'material',idempotency_key:'upload',command_fingerprint:'fingerprint',object_key:'object',material_json:JSON.stringify(material),created_at:'2026-11-03T00:00:00Z'};
 const repository=new D1KnowledgeWorkflowMaterialRepository({database:{prepare:()=>({bind(){return this;},first:async()=>row})},logger:()=>{}});
 const restored=await repository.read('owner','run');assert.equal(restored.ok,true);assert.equal(restored.value.material.oneKnowledgePointOnly,true);
});

test('large image submissions observe every original before making one global selection',async()=>{
 const manySections=Array.from({length:9},(_,i)=>({...sections[0],id:`image-${i}`,locator:`image:${i}`,url:`https://example.test/source#${i}`}));
 const attachments=manySections.map(section=>({id:`visual:digest:${section.id}`,mediaType:'image/png',bytes:new Uint8Array([1])}));
 const observed=[];
 const result=await requestSingleMaterialPoint({...dependencies,input:{...input,mode:'image',sections:manySections},attachments,generate:async command=>{
  if(command.input.operation==='observe-whole-submission-image'){
   assert.equal(command.attachments.length,1);observed.push(command.input.sectionId);return {ok:true,value:{description:`Useful relationship in ${command.input.sectionId}.`}};
  }
  assert.deepEqual(observed,manySections.map(section=>section.id));assert.equal(command.input.visualObservations.length,9);assert.equal(command.attachments,undefined);
  return {ok:true,value:{sectionId:'image-8',summary:'The final original teaches the central relationship.',evidence:'The visible arrow joins the final labels.'}};
 }});
 assert.equal(result.ok,true);assert.equal(result.value[0].candidates.length,1);assert.equal(result.value[0].candidates[0].mediaCandidates[0].visualId,'visual:digest:image-8');
});
