import {knowledgeReviewTokens} from '../../src/features/knowledge-workflows/quality-review.js';
// Constructed provider output for existing contract fixtures, never a source/model accuracy claim.
export function syntheticReviewAudit(task,verdict) {
 const point=task.knowledge,input=task.auditEvidence??{retainedText:point.evidenceAnchors.flatMap((a,i)=>a.quote?[{anchorIndex:i,tokens:knowledgeReviewTokens(a.quote)}]:[])};
 return {version:8,clauses:[],finalClause:verdict.decision==='drop-see-less'?null:{supportsWholeClaim:point.mediaCandidates.length>0,textEvidence:task.sourceMode==='image'?[]:input.retainedText.slice(0,1).map(t=>({anchorIndex:t.anchorIndex,start:0,end:t.tokens.length})),pixelEvidence:point.mediaCandidates.map(image=>({imageId:image.visualId,cue:'Synthetic visible cue; no actual image interpretation claim.'})),previousEvidence:[]}};
}
export function syntheticRetrievalComparison(task) {
 return {question:'What relationship does this captured point teach?',answer:task.knowledge.summary,priorAnswer:null,priorEvidence:[],reason:'Constructed source-taught retrieval target; no model accuracy or prior entailment claim.'};
}
export function syntheticAssessment(task,verdict) {
 const {decision,...rest}=verdict;return {...rest,sourceLanguageMatches:true,qualityDecision:decision,retrievalComparison:decision==='drop-see-less'?null:syntheticRetrievalComparison(task),sourceReliability:decision==='drop-see-less'?null:{basis:'Constructed captured relationship basis; not a model accuracy claim.',decision:'pass',reason:'Constructed retained-evidence reliability; no model accuracy claim.'},audit:verdict.audit??syntheticReviewAudit(task,verdict)};
}
export function auditedVerdict(point,verdict,sourceMode='text') {
 return syntheticAssessment({knowledge:point,sourceMode},verdict);
}
