// @ts-check
/** @typedef {import('./webpage-facts.js').FactRequest} FactRequest */
/** @typedef {import('./webpage-facts.js').WebpageFactsResult} Facts */
/** @typedef {{blockId:string,disposition:'candidates'|'excluded'|'unresolved',candidateHashes:string[],reason:string}} BlockCoverage */
/** @param {unknown} value @returns {value is Record<string,unknown>} */
const record=value=>typeof value==='object'&&value!==null&&!Array.isArray(value);
/** @param {unknown} value @returns {value is string} */
const text=value=>typeof value==='string'&&value.trim()!=='';

// Keep text and its citation together, and bound attention per request without discarding source blocks.
const BATCH_BYTES=12_000;
const coveragePrompt=`\n# Required captured-block coverage audit (v1)\nIndependently inspect EVERY supplied source block, including the last one. Extract missing useful relationships in additionalCandidates. The extractor's notes, claimed truncation, drafts and memory are not evidence that text is missing or already committed. All sourceBlocks in this request are available; each includes its exact citationReference. Do not accept a partial reading as completion.\nIn addition to the usual output fields return blockCoverage, exactly one entry for EVERY source block, in supplied order: {blockId: exact supplied block ID, disposition: "candidates"|"excluded"|"unresolved", candidateHashes: array of final child/additional candidate hashes supported by this block, reason: nonempty specific explanation}. Use candidates only when at least one listed final candidate cites this block. Use excluded with no hashes only after inspecting the whole block and explaining why it teaches no additional useful source-supported relationship (e.g. administrative, repeated, already committed in supplied previousKnowledge, or incidental context). Do not exclude educational text merely because a related topic has a candidate. Zero useful points is valid but must be explained per block. Use unresolved with no hashes if text is missing, incomplete, unreadable or you cannot assess it; the application will keep the page incomplete. Do not fabricate candidates to satisfy coverage. Return no other new fields.`;

/** @param {readonly {id:string}[]} blocks */
function coverageSchema(blocks) {
  return {type:'array',minItems:blocks.length,maxItems:blocks.length,items:{type:'object',additionalProperties:false,required:['blockId','disposition','candidateHashes','reason'],properties:{blockId:{type:'string',enum:blocks.map(b=>b.id)},disposition:{type:'string',enum:['candidates','excluded','unresolved']},candidateHashes:{type:'array',items:{type:'string',minLength:1}},reason:{type:'string',minLength:1}}}};
}

/** Validate accounting against final drafts and captured references, never a model's completion assertion.
 * @param {unknown} value @param {readonly {id:string}[]} blocks
 * @param {readonly {sourceId:string,reference:unknown}[]} citations @param {readonly unknown[]} candidates
 * @returns {value is BlockCoverage[]} */
export function isCompleteBlockCoverage(value,blocks,citations,candidates) {
  if(!Array.isArray(value)||value.length!==blocks.length)return false;
  return value.every((entry,index)=>{
    if(!record(entry)||Object.keys(entry).sort().join(',')!=='blockId,candidateHashes,disposition,reason'||entry.blockId!==blocks[index].id||!text(entry.reason)||!Array.isArray(entry.candidateHashes)||!entry.candidateHashes.every(text)||new Set(entry.candidateHashes).size!==entry.candidateHashes.length)return false;
    if(entry.disposition==='excluded')return entry.candidateHashes.length===0;
    if(entry.disposition!=='candidates'||entry.candidateHashes.length===0)return false;
    const reference=citations.find(c=>c.sourceId===entry.blockId)?.reference;
    return reference!==undefined&&entry.candidateHashes.every(hash=>candidates.some(c=>record(c)&&c.normalizedHash===hash&&Array.isArray(c.evidenceAnchors)&&c.evidenceAnchors.some(a=>record(a)&&record(a.reference)&&record(reference)&&a.reference.kind===reference.kind&&a.reference.id===reference.id)));
  });
}

/** @param {FactRequest} dependencies @param {(dependencies:FactRequest)=>Promise<import('./webpage-facts.js').Result<Facts>>} batch
 * @returns {Promise<import('./webpage-facts.js').Result<Facts>>} */
export async function requestCoveredWebpageFacts(dependencies,batch) {
  const input=/** @type {{url:string,evidence:import('../acquisition/contracts.ts').WebpageEvidence,coverageGoals:{id:string}[]}} */(structuredClone(dependencies.input));
  if(!dependencies.normalizeClaims||dependencies.attemptPolicy!==undefined)return {ok:false,error:{kind:'WebpageCoverageCommandInvalid'}};
  /** @type {typeof input.evidence.blocks[number][][]} */const chunks=[];
  /** @type {typeof chunks} */const sections=[];
  for(const block of input.evidence.blocks){
    const section=sections.at(-1);
    if(section?.[0].sectionId===block.sectionId)section.push(block);else sections.push([block]);
  }
  let size=0;
  for(const section of sections){
    const sectionBytes=new TextEncoder().encode(JSON.stringify(section)).byteLength;
    if(sectionBytes<=BATCH_BYTES){
      const current=chunks.at(-1);
      if(!current||size+sectionBytes>BATCH_BYTES){chunks.push([...section]);size=sectionBytes;}
      else {current.push(...section);size+=sectionBytes;}
    }else for(const block of section){
      const bytes=new TextEncoder().encode(JSON.stringify(block)).byteLength;
      const current=chunks.at(-1);
      if(!current||size+bytes>BATCH_BYTES){chunks.push([block]);size=bytes;}
      else {current.push(block);size+=bytes;}
    }
  }
  /** @type {Facts['candidates'][number][]} */const candidates=[];
  /** @type {Facts['partialIssues'][number][]} */const partialIssues=[];
  /** @type {BlockCoverage[]} */const coverage=[];
  /** @type {string[]} */const notes=[];
  for(let index=0;index<chunks.length;index++){
    const blocks=chunks[index],sectionIds=new Set(blocks.map(b=>b.sectionId));
    /** @type {BlockCoverage[]|null} */let audited=null;
    const result=await batch({...dependencies,requireCoverage:false,taskId:`${dependencies.taskId}:coverage-v1:${index+1}`,input:{...input,evidence:{...input.evidence,blocks,headings:input.evidence.headings.filter(h=>sectionIds.has(h.sectionId)),images:[]}},generate:async command=>{
      const task=/** @type {Record<string,unknown>} */(command.input);
      const citations=/** @type {{sourceId:string,reference:unknown}[]} */(task.citationSources??[]);
      const sourceBlocks=/** @type {Record<string,unknown>[]} */(task.sourceBlocks??[]);
      const enriched={...task,sourceBlocks:sourceBlocks.map(b=>({...b,citationReference:citations.find(c=>c.sourceId===b.id)?.reference})),sectionHeadings:input.evidence.headings.filter(h=>sectionIds.has(h.sectionId)).map(({sectionId,text})=>({sectionId,text}))};
      const normalizing=command.phase==='normalization';
      const schema=command.responseSchema===undefined?undefined:{...structuredClone(command.responseSchema),name:command.responseSchema.name+'__coverage_v1'};
      if(normalizing&&schema){
        const shape=/** @type {{required:string[],properties:Record<string,unknown>}} */(schema.schema);
        shape.required.push('blockCoverage');shape.properties.blockCoverage=coverageSchema(blocks);
      }
      const generated=await dependencies.generate({...command,input:enriched,systemPrompt:command.systemPrompt+(normalizing?coveragePrompt:''),...(schema?{responseSchema:schema}:{})});
      if(!generated.ok||!normalizing)return generated;
      const value=structuredClone(generated.value);
      const reviews=Array.isArray(value.reviews)?value.reviews:[];
      const originals=Array.isArray(task.candidates)?task.candidates:[];
      const declared=[...originals,...reviews.flatMap(r=>record(r)&&Array.isArray(r.candidates)?r.candidates:[]),...(Array.isArray(value.additionalCandidates)?value.additionalCandidates:[])];
      const identities=new Set(declared.flatMap(c=>record(c)&&text(c.normalizedHash)?[c.normalizedHash]:[]));
      /** @type {Map<string,string>} */const unchangedAliases=new Map();
      // candidates:null retains the exact parent; resolve only unambiguous labels, never claim text or citations.
      for(const review of reviews)if(record(review)&&review.candidates===null){
        const parent=originals.find(c=>record(c)&&c.normalizedHash===review.sourceNormalizedHash);
        const unit=Array.isArray(review.relationshipUnits)&&review.relationshipUnits.length===1?review.relationshipUnits[0]:null;
        if(!record(parent)||!text(parent.normalizedHash)||!record(unit)||!text(unit.childNormalizedHash))return {ok:false,error:{kind:'WebpageClaimBoundariesInvalid'}};
        if(unit.childNormalizedHash!==parent.normalizedHash){
          if(identities.has(unit.childNormalizedHash)||unchangedAliases.has(unit.childNormalizedHash))return {ok:false,error:{kind:'WebpageClaimBoundariesInvalid'}};
          unchangedAliases.set(unit.childNormalizedHash,parent.normalizedHash);
          unit.childNormalizedHash=parent.normalizedHash;
        }
      }
      if(Array.isArray(value.blockCoverage))for(const entry of value.blockCoverage)if(record(entry)&&Array.isArray(entry.candidateHashes))entry.candidateHashes=entry.candidateHashes.map(hash=>unchangedAliases.get(hash)??hash);
      const finalCandidates=[...reviews.flatMap(r=>record(r)?r.candidates===null?originals.filter(c=>record(c)&&c.normalizedHash===r.sourceNormalizedHash):Array.isArray(r.candidates)?r.candidates:[]:[]),...(Array.isArray(value.additionalCandidates)?value.additionalCandidates:[])];
      // A receipt needs a genuinely cited draft; discard extra unsupported associations without inventing support.
      if(Array.isArray(value.blockCoverage))for(const entry of value.blockCoverage)if(record(entry)&&entry.disposition==='candidates'&&Array.isArray(entry.candidateHashes)){
        const block=blocks.find(b=>b.id===entry.blockId);
        if(block)entry.candidateHashes=entry.candidateHashes.filter(hash=>isCompleteBlockCoverage([{...entry,candidateHashes:[hash]}],[block],citations,finalCandidates));
      }
      if(!isCompleteBlockCoverage(value.blockCoverage,blocks,citations,finalCandidates))return {ok:false,error:{kind:'WebpageCoverageIncomplete'}};
      audited=structuredClone(value.blockCoverage);
      const {blockCoverage,...payload}=value;
      return {ok:true,value:payload};
    }});
    if(!result.ok)return result;
    if(audited===null||/** @type {BlockCoverage[]} */(audited).some(entry=>entry.candidateHashes.some(hash=>!result.value.candidates.some(c=>c.normalizedHash===hash)&&!result.value.partialIssues.some(issue=>issue.normalizedHash===hash&&['WebpageCandidateGroundingRejected','WebpageCandidateUsefulnessRejected'].includes(issue.kind)))))return {ok:false,error:{kind:'WebpageCoverageIncomplete'}};
    for(const candidate of result.value.candidates){
      const existing=candidates.find(c=>c.normalizedHash===candidate.normalizedHash);
      if(existing&&existing.summary!==candidate.summary)return {ok:false,error:{kind:'WebpageFactsInvalid'}};
      if(!existing)candidates.push(candidate);
    }
    coverage.push(.../** @type {BlockCoverage[]} */(audited));partialIssues.push(...result.value.partialIssues);notes.push(result.value.notes);
  }
  return {ok:true,value:{candidates:Object.freeze(candidates),notes:notes.join('\n').slice(0,2000),status:candidates.length?(partialIssues.length?'partial':'complete'):'empty',partialIssues:Object.freeze(partialIssues),blockCoverage:Object.freeze(coverage)}};
}
