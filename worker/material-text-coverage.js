// @ts-check
import {requestWebpageFacts} from './webpage-facts.js';
/** @typedef {import('../src/features/knowledge-workflows/material.js').MaterialSection & {url:string}} Section */
/** Divide long uploaded sections without dropping text. Locators identify exact codepoint ranges.
 * @param {Section} section @returns {import('../acquisition/contracts.ts').WebpageEvidence} */
export function materialTextEvidence(section) {
  const points=Array.from(section.text);
  /** @type {import('../acquisition/contracts.ts').WebpageEvidence['blocks'][number][]} */const blocks=[];
  for(let start=0;start<points.length;){
    let end=Math.min(start+4000,points.length);
    if(end<points.length){
      const segment=points.slice(start,end).join('');
      const newline=segment.lastIndexOf('\n');
      if(newline>0)end=start+Array.from(segment.slice(0,newline+1)).length;
    }
    const text=points.slice(start,end).join('');
    if(text.trim())blocks.push({id:`${section.id}:text:${start}:${end}`,sectionId:section.id,locator:`${section.locator};text-codepoints=${start}:${end}`,kind:'text',text,figureId:null});
    start=end;
  }
  return {url:section.url,headings:[{id:`heading:${section.id}`,sectionId:section.id,locator:section.locator,text:section.title,level:1}],blocks,images:[],warnings:[]};
}

/** @param {import('./knowledge-workflow-runtime.js').MaterialBatchRequest} dependencies
 * @returns {Promise<import('../src/features/knowledge-workflows/extraction.js').Result<readonly {url:string,notes:string,candidates:readonly import('../src/features/knowledge-workflows/extraction.js').KnowledgeCandidate[],blockCoverage?:readonly import('./webpage-coverage.js').BlockCoverage[]}[],{kind:string}>>} */
export async function requestCoveredMaterialText(dependencies) {
  const input=dependencies.input;
  const pages=[];
  for(const section of input.sections){
    const result=await requestWebpageFacts({requireCoverage:true,normalizeClaims:true,deferQualityReview:true,structuredOutput:true,taskId:`${dependencies.taskId}:text:${section.id}`,input:{url:section.url,evidence:materialTextEvidence(section),coverageGoals:input.coverageGoals,previousKnowledge:input.previousKnowledge??[],lessOften:input.lessOften??[]},maxOutputTokens:dependencies.maxOutputTokens,generate:dependencies.generate,logger:dependencies.logger});
    if(!result.ok)return result;
    // Material reviewers locate the containing original section; literal sub-block quotes and digests remain intact.
    pages.push({url:section.url,notes:result.value.notes,candidates:result.value.candidates.map(candidate=>({...candidate,evidenceAnchors:candidate.evidenceAnchors.map(anchor=>({...anchor,selector:section.locator}))})),blockCoverage:result.value.blockCoverage});
  }
  return {ok:true,value:pages};
}
