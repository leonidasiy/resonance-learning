// @ts-check
import { captureCitationSources } from '../worker/webpage-citations.js';
import { requestWebpageFacts, quoteHash } from '../worker/webpage-facts.js';
function assert(/** @type {boolean} */ value) { if (!value) throw new Error('Fact boundary invariant failed'); }
const url = 'https://source.example/ratios';
const block = {id:'block:1',sectionId:'section:1',locator:'main > p:nth-of-type(1)',kind:/** @type {const} */('text'),text:'A ratio compares two quantities by division.',figureId:null};
const evidence = {url,headings:[],blocks:[block],images:[],warnings:[]};
/** @typedef {{reference:import('../worker/webpage-citations.js').TextCitationReference,clause:string,quote?:string,quoteDigest?:string,selector?:string,url?:string}} FixtureAnchor */
async function candidate() {
 const captured=await captureCitationSources({owner:url,sources:[{id:block.id,locator:block.locator,text:block.text}]});if(!captured.ok)throw new Error(captured.error.kind);
 /** @type {FixtureAnchor} */const anchor={reference:captured.value.sources[0].reference,clause:block.text};
 return {summary:block.text,normalizedHash:'ratio',coverageGoalIds:[],mediaCandidates:[],evidenceAnchors:[anchor]};
}
Deno.test('web facts use exact text quotes and independent usefulness/grounding; model sees no pixels/alt/memory', async () => {
  let calls=0;
  const fact=await candidate();
  const result=await requestWebpageFacts({structuredOutput:true,taskId:'fixture',input:{url,evidence,coverageGoals:[],memory:'Injected image knowledge',alt:'Answer99'},maxOutputTokens:4096,logger:()=>{},generate:async command=>{
    calls++;
    assert(command.attachments===undefined);
    if(command.phase==='extraction') assert(command.systemPrompt.includes('According to the primer,') && command.systemPrompt.includes('keep source attribution in the dedicated evidence and citation fields'));
    assert(!JSON.stringify(command.input).includes('Answer99') && !JSON.stringify(command.input).includes('Injected image'));
    if(command.phase==='extraction'){const schema=JSON.parse(JSON.stringify(command.responseSchema));assert(schema.schema.properties.candidates.items.properties.summary.description.includes('one independently testable main relationship'));}
    return {ok:true,value:calls===1 ? {notes:'Source supported.',candidates:[fact]} : {verdicts:[{normalizedHash:'ratio',grounded:true}]}};
  }});
  assert(result.ok && result.value.candidates.length===1 && calls===2);
});
for(const defect of ['wrongquote','wronghash','locator','pixels','foreignurl','unsupported','description']) Deno.test(`web fact boundary rejects ${defect}`,async()=>{
  let calls=0;
  const fact=await candidate();
  if(defect==='wrongquote') fact.evidenceAnchors[0].quote='Invented quote';
  if(defect==='wronghash') fact.evidenceAnchors[0].quoteDigest='sha256:wrong';
  if(defect==='locator') fact.evidenceAnchors[0].selector='#nonexistent';
  if(defect==='pixels') fact.mediaCandidates.push(/** @type {never} */({visualId:'image:1'}));
  if(defect==='foreignurl') fact.evidenceAnchors[0].url='https://foreign.example/';
  const result=await requestWebpageFacts({taskId:'fixture',input:{url,evidence,coverageGoals:[]},maxOutputTokens:4096,logger:()=>{},generate:async command=>{
    calls++;
    return {ok:true,value:JSON.stringify(command.input).includes('verify-webpage-facts') ? {verdicts:[{normalizedHash:'ratio',grounded:defect!=='unsupported'&&defect!=='description'}]} : {notes:'Fixture.',candidates:[fact]}};
  }});
  assert(result.ok ? result.value.candidates.length===0 : ['WebpageFactEvidenceInvalid','WebpageFactsInvalid'].includes(result.error.kind));
});
Deno.test('image-only webpage has zero facts and performs no model call',async()=>{
 const result=await requestWebpageFacts({taskId:'fixture',input:{url,evidence:{...evidence,blocks:[]},coverageGoals:[]},maxOutputTokens:4096,logger:()=>{},generate:async()=>{throw new Error('No text means no facts call');}});
 assert(result.ok && result.value.candidates.length===0);
});
Deno.test('grounding semantically rejects unsupported summary text',async()=>{
 const fact=await candidate(); fact.summary+=' It cures every disease.';
 const result=await requestWebpageFacts({taskId:'subset',input:{url,evidence,coverageGoals:[]},maxOutputTokens:4096,logger:()=>{},generate:async command=>({ok:true,value:JSON.stringify(command.input).includes('verify-webpage-facts')?{verdicts:[{normalizedHash:'ratio',grounded:false}]}:{notes:'Fixture.',candidates:[fact]}})});
 assert(result.ok && result.value.candidates.length===0);
});

/** @param {string} source @param {string} summary @param {string[]} clauses */
async function checkedClauses(source,summary,clauses) {
 const sourceBlock={...block,text:source};
 const capture=await captureCitationSources({owner:url,sources:[{id:block.id,locator:block.locator,text:source}]});if(!capture.ok)throw new Error(capture.error.kind);
 const fact={...await candidate(),summary,evidenceAnchors:clauses.map(clause=>({reference:capture.value.sources[0].reference,clause}))};
 return requestWebpageFacts({taskId:'clause-coverage',input:{url,evidence:{...evidence,blocks:[sourceBlock]},coverageGoals:[]},maxOutputTokens:4096,logger:()=>{},generate:async command=>({ok:true,value:JSON.stringify(command.input).includes('verify-webpage-facts')?{verdicts:[{normalizedHash:fact.normalizedHash,grounded:true}]}:{notes:'Fixture.',candidates:[fact]}})});
}
for(const {summary,clauses} of [
 {summary:'n! equals 3.',clauses:['n!','equals 3.']},
 {summary:'x + y = z; x − y ≠ z.',clauses:['x + y = z;','x − y ≠ z.']},
 {summary:'x ≤ y, and y ≥ 0: x/y is defined only if y ≠ 0.',clauses:['x ≤ y,','and y ≥ 0:','x/y is defined only if y ≠ 0.']},
 {summary:'n!\t\n equals\u00a0 3.',clauses:['n!','equals','3.']},
]) Deno.test(`grounding preserves complete multipart formulas: ${JSON.stringify(summary)}`,async()=>{
 const result=await checkedClauses(summary,summary,clauses);
 assert(result.ok && result.value.candidates.length===1 && result.value.candidates[0].summary===summary);
});
for(const clauses of [['equals 3.','n!'],['n!','n!','equals 3.']]) Deno.test(`grounding permits reordered corroborating clauses: ${clauses.join(' / ')}`,async()=>{
 const result=await checkedClauses('n! equals 3.','n! equals 3.',clauses);
 assert(clauses[0]===clauses[1] ? result.ok && result.value.status==='empty' && result.value.partialIssues[0].kind==='WebpageCandidateEvidenceInvalid' : result.ok && result.value.candidates.length===1);
});

Deno.test('typed partial retains valid candidate and explicitly reports malformed index', async()=>{
 const fact={...await candidate(),summary:'A ratio compares quantities by division.'};
 const result=await requestWebpageFacts({taskId:'partial',input:{url,evidence,coverageGoals:[]},maxOutputTokens:50,logger:()=>{},generate:async command=>({ok:true,value:command.phase==='extraction'?{notes:'',candidates:[null,fact]}:{verdicts:[{normalizedHash:'ratio',grounded:true}]}})});
 assert(result.ok && result.value.status==='partial' && result.value.candidates.length===1 && result.value.partialIssues[0].candidateIndex===0);
});
