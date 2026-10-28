import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import {createKnowledgeQualityReviewer,isKnowledgeReviewVerdict,knowledgeReviewAuditInput,knowledgeReviewSchemaFor,knowledgeReviewerPrompt,knowledgeReviewTokens,knowledgeReviewSpanText,knowledgeReviewClaimSpans,knowledgeRepairRequirements} from '../src/features/knowledge-workflows/quality-review.js';
import {D1WorkflowStageRepository} from '../worker/knowledge-workflow-stages-d1.js';

// Explicitly migrated synthetic fixtures only; no received historical/provider output is converted.
const constructedV8=a=>{const clauses=a.clauses.slice(0,-1),last=a.clauses.at(-1);const {claimEnd,...finalClause}=last;const {novelty,revisionReason,...shape}=a;return {...shape,version:8,clauses:clauses.map(c=>({...c,supportsWholeClaim:c.pixelEvidence.length>0})),finalClause:{...finalClause,supportsWholeClaim:finalClause.pixelEvidence.length>0}};};
// Hand-authored synthetic judgments exercise contracts, not real LLM accuracy or gold coverage.
const ok=value=>({ok:true,value});
const context={lessOften:[],previousKnowledge:[{id:'rule',summary:'A closed valve stops flow.'}],previousQuizzes:[{prompt:'What stops flow?',answer:'A closed valve.'}]};
const point={id:'point',sourceId:'source',sourceRevision:1,summary:'A closed valve stops flow. A bypass permits flow while the valve is closed.',normalizedHash:'point',evidenceAnchors:[{url:'https://synthetic.invalid/',selector:'#retained',blockId:'b',quote:'A closed valve stops flow. A bypass permits flow while the valve is closed.',clause:'Draft clause, not immutable proof.',quoteDigest:'sha256:synthetic'}],mediaCandidates:[],coverageGoalIds:[],attribution:{sourceUrl:'https://synthetic.invalid/'},extractionVersion:'synthetic'};
const clause=(claimEnd,previousEvidence=[])=>({claimEnd,textEvidence:[{anchorIndex:0,start:0,end:6}],pixelEvidence:[],previousEvidence});
const audit=()=>(constructedV8({version:4,clauses:[clause(6,[{priorId:'knowledge:rule',start:0,end:6}]),{...clause('END'),textEvidence:[{anchorIndex:0,start:6,end:16}]}],novelty:'new',revisionReason:'none'}));
const withoutPixelDeclaration=a=>({...a,clauses:a.clauses.map(c=>{const {supportsWholeClaim,...old}=c;return old;}),...(Object.hasOwn(a,'finalClause')?{finalClause:a.finalClause?((({supportsWholeClaim,...old})=>old)(a.finalClause)):null}:{})});
const historicalVerdict=(a,extra={})=>({decision:'pass',reasons:['Synthetic relationships have retained support and a new application.'],feedback:'Keep the retained source relationships.',matchedLessOftenIds:[],supportingImageEvidence:'',allowTextOnly:true,audit:a?.version<8?withoutPixelDeclaration(a):a,...extra});
const verdict=(a=audit(),extra={})=>{const old=historicalVerdict(a,extra);if(a?.version!==8)return old;const {decision,...rest}=old;return {...rest,sourceLanguageMatches:true,qualityDecision:decision,retrievalComparison:decision==='drop-see-less'?null:{question:'What relationship does this point teach?',answer:point.summary,priorAnswer:null,priorEvidence:[],reason:'Constructed comparison, no semantic accuracy claim.'},sourceReliability:decision==='drop-see-less'?null:{basis:'Constructed captured relationship basis; not a model accuracy claim.',decision:'pass',reason:'Synthetic retained reliability.'}};};
async function review(value,{candidate=point,sourceMode='text',sourceEvidence={},reviewContext=context,repair}={}){
 let critics=0,repairs=0;
 const result=await createKnowledgeQualityReviewer({context:reviewContext,sourceMode,sourceEvidence,digest:async()=> 'synthetic-digest',evaluate:async()=>{critics++;return ok(value);},regenerate:async()=>{repairs++;assert(repair,'Unexpected semantic repair');return ok(repair);}}).review(candidate);
 return {result,critics,repairs};
}
const invalid=result=>assert.deepEqual(result,{ok:false,error:{kind:'KnowledgeReviewOutputInvalid',attempts:4,technicalAttempts:4,technicalRetriesExhausted:true}});

test('a reversed clause boundary is retried once and only a fresh valid critique can pass',async()=>{
 const malformed=verdict();malformed.audit.clauses.push({...clause(3),supportsWholeClaim:false});
 let calls=0;
 const result=await createKnowledgeQualityReviewer({context,sourceMode:'text',sourceEvidence:{},digest:async()=> 'synthetic-digest',evaluate:async()=>ok(++calls===1?malformed:verdict()),regenerate:async()=>assert.fail('No semantic repair of a malformed audit')}).review(point);
 assert.equal(calls,2);assert.equal(result.ok,true);assert.equal(result.value.point,point);
});

test('LLM-declared new application can coexist with an already taught general rule',async()=>{
 const {result,critics,repairs}=await review(verdict());assert.equal(result.ok,true);assert.equal(result.value.point,point);assert.deepEqual(result.value.verdict.audit,{...audit(),novelty:'new',revisionReason:'none'});assert.equal(critics,1);assert.equal(repairs,0);
 // Exact excerpts establish provenance only; semantic entailment is still the critic's responsibility.
 assert.match(knowledgeReviewerPrompt,/not just share a topic, source paragraph or part of a causal pathway/);
 assert.match(knowledgeReviewerPrompt,/downstream effects, functions, mechanisms or applications are new/);
});
for(const mutation of ['old-top-decision','missing-quality-decision','other-anchor','unretained-range','draft-quote-field','invented-prior-range','missing-prior-id','omitted-claim','reversed-claims','overlapping-claims','out-of-range-claim','duplicate-with-new-clause','pass-source-reason','extra-audit-field','extra-start','negative','fractional','empty-range','contradictory-final-end','nonfinal-sentinel','sentinel-and-final-end','final-sentinel-field','numeric-string','zero-boundary','duplicate-boundary','empty-final'])test(`structured critic rejects ${mutation} within four technical attempts without repair`,async()=>{
 const value=verdict(),a=value.audit;
 if(mutation==='old-top-decision')value.decision='pass';
 if(mutation==='missing-quality-decision')delete value.qualityDecision;
 if(mutation==='other-anchor')a.finalClause.textEvidence[0].anchorIndex=1;
 if(mutation==='unretained-range')a.finalClause.textEvidence[0].end=17;
 if(mutation==='draft-quote-field')a.finalClause.textEvidence[0].quote=point.evidenceAnchors[0].clause;
 if(mutation==='invented-prior-range')a.finalClause.previousEvidence=[{priorId:'knowledge:rule',start:0,end:7}];
 if(mutation==='missing-prior-id')a.clauses[0].previousEvidence[0].priorId='knowledge:foreign';
 if(mutation==='omitted-claim')delete a.finalClause;
 if(mutation==='reversed-claims'){a.clauses.push(clause(9));a.clauses.reverse();}
 if(mutation==='overlapping-claims'){a.clauses[0].claimEnd=8;a.clauses.push(clause(3));}
 if(mutation==='out-of-range-claim')a.clauses[0].claimEnd=17;
 if(mutation==='new-with-all-prior')a.finalClause.previousEvidence=[{priorId:'quiz:0',start:0,end:1}];
 if(mutation==='duplicate-with-new-clause'){value.qualityDecision='revise';a.novelty='duplicate';a.revisionReason='duplicate';}
 if(mutation==='pass-source-reason')a.revisionReason='source';
 if(mutation==='pass-unsupported-text')a.finalClause.textEvidence=[];
 if(mutation==='extra-audit-field')a.unapproved=true;
 if(mutation==='extra-start')a.finalClause.claimStart=7;
 if(mutation==='negative')a.clauses[0].claimEnd=-1;
 if(mutation==='fractional')a.clauses[0].claimEnd=4.5;
 if(mutation==='empty-range')a.finalClause.textEvidence[0].end=6;
 if(mutation==='contradictory-final-end')a.finalClause.claimEnd=16;
 if(mutation==='nonfinal-sentinel')a.clauses[0].claimEnd='END';
 if(mutation==='sentinel-and-final-end'){a.clauses[0].claimEnd='END';a.finalClause.claimEnd=16;}
 if(mutation==='final-sentinel-field')a.finalClause.claimEnd='end';
 if(mutation==='numeric-string')a.clauses[0].claimEnd='6';
 if(mutation==='zero-boundary')a.clauses[0].claimEnd=0;
 if(mutation==='empty-final')a.clauses[0].claimEnd=16;
 if(mutation==='duplicate-boundary')a.clauses.push(clause(6));
 const {result,critics,repairs}=await review(value);invalid(result);assert.equal(critics,4);assert.equal(repairs,0);
});
test('complete LLM-declared duplicate stays rejected after exactly one repair and two critiques',async()=>{
 const original={...point,summary:'A closed valve stops flow.'},a=constructedV8({version:4,clauses:[clause('END',[{priorId:'knowledge:rule',start:0,end:6}])],novelty:'duplicate',revisionReason:'duplicate'});
 const {result,critics,repairs}=await review(verdict(a,{decision:'revise',feedback:'No distinct relationship remains within this retained anchor.'}),{candidate:original,repair:{summary:original.summary,coverageGoalIds:[],useSupportingImage:false,evidenceClauses:[original.summary]}});
 assert.deepEqual(result,{ok:true,value:null});assert.equal(critics,2);assert.equal(repairs,1);assert.equal(original.evidenceAnchors[0].quote,point.evidenceAnchors[0].quote);
});
test('prior quiz IDs derive from actual ordered content and literal excerpts',async()=>{
 const input=knowledgeReviewAuditInput(point,context,{});assert.deepEqual(input.previousContent,[{id:'knowledge:rule',tokens:knowledgeReviewTokens(context.previousKnowledge[0].summary).map((t,i)=>i+':'+t),endExclusiveTokenCount:knowledgeReviewTokens(context.previousKnowledge[0].summary).length},{id:'quiz:0',tokens:knowledgeReviewTokens(JSON.stringify(context.previousQuizzes[0])).map((t,i)=>i+':'+t),endExclusiveTokenCount:knowledgeReviewTokens(JSON.stringify(context.previousQuizzes[0])).length}]);
 const schema=knowledgeReviewSchemaFor(context,input),properties=schema.schema.properties.audit.properties.clauses.items.properties;
 assert.deepEqual(properties.previousEvidence.items.properties.priorId.enum,['knowledge:rule','quiz:0']);assert.deepEqual(properties.textEvidence.items.properties.anchorIndex.enum,[0]);
 const value=verdict();value.audit.clauses[0].previousEvidence=[{priorId:'quiz:0',start:0,end:1}];assert.equal((await review(value)).result.ok,true);
});
test('material text uses only its original matching URL and locator section',async()=>{
 const candidate={...point,summary:'A closed valve stops flow.',evidenceAnchors:[{url:point.attribution.sourceUrl,selector:'section:1',clause:'Not source proof.'}]};
 const sections=[{url:'https://other.invalid/',locator:'section:1',text:'Wrong origin.'},{url:point.attribution.sourceUrl,locator:'section:2',text:'Wrong section.'},{url:point.attribution.sourceUrl,locator:'section:1',text:candidate.summary}];
 const input=knowledgeReviewAuditInput(candidate,context,{sections});assert.deepEqual(input.retainedText,[{anchorIndex:0,tokens:knowledgeReviewTokens(candidate.summary).map((t,i)=>i+':'+t),endExclusiveTokenCount:knowledgeReviewTokens(candidate.summary).length}]);
 const value=verdict(constructedV8({version:4,clauses:[clause('END')],novelty:'new',revisionReason:'none'}));
 assert.equal((await review(value,{candidate,sourceEvidence:{sections},reviewContext:{lessOften:[],previousKnowledge:[],previousQuizzes:[]}})).result.ok,true);
 invalid((await review(value,{candidate,sourceEvidence:{sections:sections.slice(0,2)}})).result);
 const without=knowledgeReviewSchemaFor(context,knowledgeReviewAuditInput(candidate,context,{}));assert.equal(without.schema.properties.audit.properties.clauses.items.properties.textEvidence.maxItems,0);assert.equal(Object.hasOwn(without.schema.properties.audit.properties.clauses.items.properties.textEvidence.items.properties.anchorIndex,'enum'),false);
});
test('captured image metadata cannot satisfy retained text or current pixel provenance',async()=>{
 const value=verdict();value.audit.finalClause.textEvidence=[];value.audit.finalClause.pixelEvidence=[{imageId:'metadata-only',cue:'Label visible in source metadata.'}];
 const sourceEvidence={images:[{id:'metadata-only',alt:point.summary,caption:point.summary}],blocks:[{id:'other',text:point.summary}]};invalid((await review(value,{sourceEvidence})).result);
});
test('pixel-supported addition cannot pass web text but original raster pixels remain valid source',async()=>{
 const candidate={...point,summary:'The diagram depicts a bypass.',mediaCandidates:[{visualId:'source-image'}]},a=constructedV8({version:4,clauses:[{claimEnd:'END',textEvidence:[],pixelEvidence:[{imageId:'source-image',cue:'A labeled bypass line connects both sides of the valve.'}],previousEvidence:[]}],novelty:'new',revisionReason:'none'}),value=verdict(a,{supportingImageEvidence:'A labeled bypass line connects both sides of the valve.',allowTextOnly:false});
 const gap=await review(value,{candidate,repair:{summary:candidate.summary,coverageGoalIds:[],useSupportingImage:true,evidenceClauses:[candidate.summary]}});assert.deepEqual(gap.result,{ok:true,value:null});assert.equal(gap.critics,2);assert.equal(gap.repairs,1);
 const raster=await review(value,{candidate,sourceMode:'image'});assert.equal(raster.result.ok,true);assert.deepEqual(raster.result.value.point.mediaCandidates,candidate.mediaCandidates);assert.equal(raster.repairs,0);
 value.audit.finalClause.pixelEvidence[0].imageId='captured-other';invalid((await review(value,{candidate,sourceMode:'image'})).result);
});
test('attached-image pass must account for every claim, separately from valid text support',async()=>{
 const candidate={...point,mediaCandidates:[{visualId:'optional'}]},value=verdict(audit(),{supportingImageEvidence:'Visible valve.'});value.audit.clauses[0].pixelEvidence=[{imageId:'optional',cue:'The closed valve is visible.'}];
 const gap=await review(value,{candidate,repair:{summary:point.summary,coverageGoalIds:[],useSupportingImage:true,evidenceClauses:[point.summary]}});assert.deepEqual(gap.result,{ok:true,value:null});assert.equal(gap.critics,2);assert.equal(gap.repairs,1);
});
test('permitted optional removal changes only current pixels; immutable text drives the second audit',async()=>{
 const original={...point,mediaCandidates:[{visualId:'optional'}]},sourceEvidence={images:[{id:'optional',alt:'Source metadata retained after removal.'}]};let critics=0,repairs=0;
 const result=await createKnowledgeQualityReviewer({context,sourceMode:'text',sourceEvidence,digest:async()=> 'synthetic',evaluate:async current=>{critics++;assert.deepEqual(current.evidenceAnchors.map(a=>a.quote),point.evidenceAnchors.map(a=>a.quote));const value=verdict();if(critics===1){value.qualityDecision='revise';assert.deepEqual(current.mediaCandidates,original.mediaCandidates);}else assert.deepEqual(current.mediaCandidates,[]);return ok(value);},regenerate:async()=>{repairs++;return ok({summary:point.summary,coverageGoalIds:[],useSupportingImage:false,evidenceClauses:[point.summary]});}}).review(original);
 assert.equal(result.ok,true);assert.deepEqual(result.value.point.mediaCandidates,[]);assert.equal(critics,2);assert.equal(repairs,1);assert.equal(sourceEvidence.images.length,1);assert.deepEqual(original.mediaCandidates,[{visualId:'optional'}]);
});
test('historical verdict shape remains readable; fresh calls require an audit and reject malformed optional audit',async()=>{
 const legacy=historicalVerdict();delete legacy.audit;assert.equal(isKnowledgeReviewVerdict(legacy,context),true);assert.equal(isKnowledgeReviewVerdict({...legacy,audit:{}},context),false);
 const {result,critics,repairs}=await review(legacy);invalid(result);assert.equal(critics,4);assert.equal(repairs,0);
});
test('fresh v8 requires evidence-only finalClause; historical v2 and v3 audits remain readable but cannot satisfy fresh calls',async()=>{
 const historical=verdict({clauses:[{claim:point.summary,textEvidence:[{anchorIndex:0,quote:point.evidenceAnchors[0].quote}],pixelEvidence:[],previousEvidence:[]}],novelty:'new',revisionReason:'none'});
 assert.equal(isKnowledgeReviewVerdict(historical,context),true);
 invalid((await review(historical)).result);
 const v3=verdict({version:3,clauses:[{claim:{start:0,end:16},textEvidence:[{anchorIndex:0,start:0,end:16}],pixelEvidence:[],previousEvidence:[]}],novelty:'new',revisionReason:'none'});assert.equal(isKnowledgeReviewVerdict(v3,context),true);invalid((await review(v3)).result);
 assert.equal(knowledgeReviewSchemaFor(context,knowledgeReviewAuditInput(point,context,{})).name,'knowledge_quality_review_v12');
});
test('even empty drop-see-less audit requires fresh representation version; old v2 remains read-only compatible',async()=>{
 const reviewContext={lessOften:[{id:'hidden',summary:point.summary}],previousKnowledge:[],previousQuizzes:[]},historical=verdict({clauses:[],novelty:'new',revisionReason:'none'},{decision:'drop-see-less',matchedLessOftenIds:['hidden']});
 assert.equal(isKnowledgeReviewVerdict(historical,reviewContext),true);
 invalid((await review(historical,{reviewContext})).result);
 const v3={...historical,audit:{...historical.audit,version:3}};assert.equal(isKnowledgeReviewVerdict(v3,reviewContext),true);invalid((await review(v3,{reviewContext})).result);
 const {decision,...common}=historical;const fresh={...common,sourceLanguageMatches:true,qualityDecision:decision,retrievalComparison:decision==='drop-see-less'?null:{question:'What relationship does this point teach?',answer:point.summary,priorAnswer:null,priorEvidence:[],reason:'Constructed comparison, no semantic accuracy claim.'},sourceReliability:null,audit:{version:8,clauses:[],finalClause:null}};
 assert.deepEqual((await review(fresh,{reviewContext})).result,{ok:true,value:null});
});
test('no-space Unicode content has content-derived word and punctuation boundaries',async()=>{
 const summary='這個閥門關閉；水流停止。',tokens=knowledgeReviewTokens(summary),candidate={...point,summary,evidenceAnchors:[{...point.evidenceAnchors[0],quote:summary}]};
 assert(tokens.length>1);assert.equal(knowledgeReviewSpanText(summary,{start:0,end:tokens.length}),summary);
 const value=verdict(constructedV8({version:4,clauses:[{claimEnd:'END',textEvidence:[{anchorIndex:0,start:0,end:tokens.length}],pixelEvidence:[],previousEvidence:[]}],novelty:'new',revisionReason:'none'}));
 assert.equal((await review(value,{candidate,reviewContext:{lessOften:[],previousKnowledge:[],previousQuizzes:[]}})).result.ok,true);
});
test('span resolution preserves Unicode punctuation, operators and interior whitespace exactly',async()=>{
 const original="  The cell’s value ≤ 2;\t therefore it changes.\n ";
 assert.deepEqual(knowledgeReviewTokens(original),['The','cell’s','value','≤','2',';','therefore','it','changes','.']);
 assert.equal(knowledgeReviewSpanText(original,{start:1,end:7}),"cell’s value ≤ 2;\t therefore");
 assert.equal(knowledgeReviewSpanText(original,{start:0,end:10}),original.trim());
 for(const span of [{start:-1,end:1},{start:0,end:11},{start:2,end:1},{start:1,end:1},{start:.5,end:2},{start:0,end:Infinity}])assert.equal(knowledgeReviewSpanText(original,span),null);
 const candidate={...point,summary:original.trim(),evidenceAnchors:[{...point.evidenceAnchors[0],quote:original}]},value=verdict(constructedV8({version:4,clauses:[{claimEnd:6,textEvidence:[{anchorIndex:0,start:0,end:6}],pixelEvidence:[],previousEvidence:[]},{claimEnd:'END',textEvidence:[{anchorIndex:0,start:6,end:10}],pixelEvidence:[],previousEvidence:[]}],novelty:'new',revisionReason:'none'}));
 assert.equal((await review(value,{candidate,reviewContext:{lessOften:[],previousKnowledge:[],previousQuizzes:[]}})).result.ok,true);
 assert.deepEqual(knowledgeReviewClaimSpans(value.audit,10),[{start:0,end:6},{start:6,end:10}]);
});
for(const mutation of ['negative-source','fractional-source','reversed-source','source-overflow','negative-prior','fractional-prior','reversed-prior','prior-overflow'])test(`indexed citation rejects ${mutation}`,async()=>{
 const value=verdict(),citation=mutation.includes('source')?value.audit.clauses[0].textEvidence[0]:value.audit.clauses[0].previousEvidence[0];
 if(mutation.startsWith('negative'))citation.start=-1;
 if(mutation.startsWith('fractional'))citation.end=1.5;
 if(mutation.startsWith('reversed')){citation.start=3;citation.end=2;}
 if(mutation.endsWith('overflow'))citation.end=100;
 const {result,critics,repairs}=await review(value);invalid(result);assert.equal(critics,4);assert.equal(repairs,0);
});
test('completed historical native stage replays unchanged without a new review or signature relaxation',async()=>{
 const db=new DatabaseSync(':memory:');try{
 db.exec("CREATE TABLE knowledge_workflow_runs(owner_id TEXT,run_id TEXT,state TEXT,PRIMARY KEY(owner_id,run_id)); CREATE TABLE knowledge_workflow_run_tombstones(owner_id TEXT,run_id TEXT); INSERT INTO knowledge_workflow_runs VALUES('owner','run','extraction-loop');");db.exec(await readFile('worker/migrations/0025_workflow_quality_review.sql','utf8'));
 const database={prepare(sql){return {bind(...values){const stmt=db.prepare(sql);return {first:async()=>stmt.get(...values)??null,run:async()=>({success:true,meta:{changes:Number(stmt.run(...values).changes)}})};}};}};
 const stages=new D1WorkflowStageRepository({database,now:()=> '2026-10-10T00:00:00Z'}),legacy=historicalVerdict();delete legacy.audit;const saved=ok({point,verdict:legacy}),scope={ownerId:'owner',runId:'run'};let calls=0;
 assert.deepEqual(await stages.run(scope,'knowledge-quality:point','historical-input',async()=>{calls++;return saved;}),saved);
 assert.deepEqual(await stages.run(scope,'knowledge-quality:point','historical-input',async()=>assert.fail('Historical completion cannot be renewed')),saved);assert.equal(calls,1);
 const v2=ok({point,verdict:{...legacy,audit:{clauses:[{claim:point.summary,textEvidence:[{anchorIndex:0,quote:point.evidenceAnchors[0].quote}],pixelEvidence:[],previousEvidence:[]}],novelty:'new',revisionReason:'none'}}});
 assert.deepEqual(await stages.run(scope,'knowledge-quality:v2-point','historical-v2-input',async()=>v2),v2);
 assert.deepEqual(await stages.run(scope,'knowledge-quality:v2-point','historical-v2-input',async()=>assert.fail('Historical v2 completion must replay without a fresh indexed call')),v2);
 const v3=ok({point,verdict:{...legacy,audit:{version:3,clauses:[{claim:{start:0,end:16},textEvidence:[{anchorIndex:0,start:0,end:16}],pixelEvidence:[],previousEvidence:[]}],novelty:'new',revisionReason:'none'}}});
 assert.deepEqual(await stages.run(scope,'knowledge-quality:v3-point','historical-v3-input',async()=>v3),v3);assert.deepEqual(await stages.run(scope,'knowledge-quality:v3-point','historical-v3-input',async()=>assert.fail('Historical v3 completion must replay without normalization')),v3);
 const changed=await stages.run(scope,'knowledge-quality:point','new-audit-input',async()=>assert.fail('Changed input cannot bypass historical state'));assert.equal(changed.error.kind,'WorkflowStageInputChanged');
 }finally{db.close();}
});

for(const mutation of ['missing-final','null-final','array-final','missing-final-support','extra-final-claimEnd'])test(`fresh assessment finalClause rejects ${mutation} without changing received output`,async()=>{
 const value=verdict();
 if(mutation==='missing-final')delete value.audit.finalClause;
 if(mutation==='null-final')value.audit.finalClause=null;
 if(mutation==='array-final')value.audit.finalClause=[];
 if(mutation==='missing-final-support')delete value.audit.finalClause.previousEvidence;
 if(mutation==='extra-final-claimEnd')value.audit.finalClause.claimEnd=16;
 const before=structuredClone(value),r=await review(value);invalid(r.result);assert.deepEqual(value,before);assert.equal(r.critics,4);assert.equal(r.repairs,0);
});
test('zero nonfinal clauses derives one complete original claim without a model-supplied final boundary',async()=>{
 const value=verdict();value.audit.clauses=[];value.audit.finalClause.textEvidence=[{anchorIndex:0,start:0,end:16}];
 assert.deepEqual(knowledgeReviewClaimSpans(value.audit,16),[{start:0,end:16}]);assert.equal((await review(value)).result.ok,true);
 const schema=knowledgeReviewSchemaFor(context,knowledgeReviewAuditInput(point,context,{}));assert.equal(schema.name,'knowledge_quality_review_v12');
 assert(schema.schema.properties.audit.required.includes('finalClause'));assert.equal(schema.schema.properties.audit.properties.finalClause.anyOf.length,1,'null finalClause not offered without owner see-less IDs');assert.equal(schema.schema.properties.audit.properties.clauses.items.properties.claimEnd.maximum,14);assert.equal(Object.hasOwn(schema.schema.properties.audit.properties.finalClause.anyOf[0].properties,'claimEnd'),false);
});
test('v4 historical verdicts remain readable and completed without accepting them as fresh v5',async()=>{
 const v4=verdict({version:4,clauses:[{claimEnd:'END',textEvidence:[{anchorIndex:0,start:0,end:16}],pixelEvidence:[],previousEvidence:[]}],novelty:'new',revisionReason:'none'});assert.equal(isKnowledgeReviewVerdict(v4,context),true);invalid((await review(v4)).result);
 const db=new DatabaseSync(':memory:');try{db.exec("CREATE TABLE knowledge_workflow_runs(owner_id TEXT,run_id TEXT,state TEXT,PRIMARY KEY(owner_id,run_id)); CREATE TABLE knowledge_workflow_run_tombstones(owner_id TEXT,run_id TEXT); INSERT INTO knowledge_workflow_runs VALUES('owner','run','extraction-loop');");db.exec(await readFile('worker/migrations/0025_workflow_quality_review.sql','utf8'));
 const database={prepare(sql){return {bind(...values){const stmt=db.prepare(sql);return {first:async()=>stmt.get(...values)??null,run:async()=>({success:true,meta:{changes:Number(stmt.run(...values).changes)}})};}};}};
 const stages=new D1WorkflowStageRepository({database,now:()=> '2026-10-10T00:00:00Z'}),scope={ownerId:'owner',runId:'run'},saved=ok({point,verdict:v4});assert.deepEqual(await stages.run(scope,'knowledge-quality:v4','original-v4-input',async()=>saved),saved);assert.deepEqual(await stages.run(scope,'knowledge-quality:v4','original-v4-input',async()=>assert.fail('No historical call')),saved);assert.equal((await stages.run(scope,'knowledge-quality:v4','changed-v5-input',async()=>assert.fail('No changed signature bypass'))).error.kind,'WorkflowStageInputChanged');
 }finally{db.close();}
 const dropContext={lessOften:[{id:'hidden',summary:point.summary}],previousKnowledge:[],previousQuizzes:[]},drop={...v4,decision:'drop-see-less',matchedLessOftenIds:['hidden'],audit:{version:4,clauses:[],novelty:'new',revisionReason:'none'}};assert.equal(isKnowledgeReviewVerdict(drop,dropContext),true);invalid((await review(drop,{reviewContext:dropContext})).result);
});

test('text-supported optional-image mismatch uses image repair, while inconsistent source reason remains terminal',async()=>{
 const original={...point,mediaCandidates:[{visualId:'optional'}]},inconsistent=verdict(audit(),{decision:'revise',supportingImageEvidence:'',allowTextOnly:true});inconsistent.audit.revisionReason='source';
 const before=structuredClone(inconsistent),bad=await review(inconsistent,{candidate:original});invalid(bad.result);assert.equal(bad.critics,4);assert.equal(bad.repairs,0);assert.deepEqual(inconsistent,before);
 let critics=0,repairs=0;
 const result=await createKnowledgeQualityReviewer({context,sourceMode:'text',sourceEvidence:{images:[{id:'optional',caption:'Synthetic metadata.'}]},digest:async()=> 'synthetic',evaluate:async current=>{critics++;const value=verdict();if(critics===1){assert.deepEqual(current.mediaCandidates,original.mediaCandidates);value.qualityDecision='revise';value.supportingImageEvidence='';value.allowTextOnly=true;}else assert.deepEqual(current.mediaCandidates,[]);return ok(value);},regenerate:async()=>{repairs++;return ok({summary:point.summary,coverageGoalIds:[],useSupportingImage:false,evidenceClauses:[point.summary]});}}).review(original);
 assert(result.ok);assert.equal(critics,2);assert.equal(repairs,1);assert.deepEqual(result.value.point.mediaCandidates,[]);assert.equal(result.value.point.evidenceAnchors[0].quote,original.evidenceAnchors[0].quote);
 assert.equal(Object.hasOwn(knowledgeReviewSchemaFor(context,knowledgeReviewAuditInput(point,context,{})).schema.properties.audit.properties,'revisionReason'),false);
});

// These hand-authored fresh-v8 assessments check fixed consequences, not model accuracy.
for(const mode of ['source','image','duplicate','duplicate-source-image','semantic','partial-prior-semantic'])test(`fresh v8 derives ${mode} without upgrading semantic negatives or mutating raw output`,async()=>{
 const candidate={...point,mediaCandidates:mode.includes('image')?[{visualId:'optional'}]:[]},value=verdict();
 if(candidate.mediaCandidates.length){value.supportingImageEvidence='Original synthetic aggregate cue.';value.allowTextOnly=true;}
 if(mode.includes('source'))value.audit.finalClause.textEvidence=[];
 if(mode.includes('duplicate'))value.audit.finalClause.previousEvidence=[{priorId:'knowledge:rule',start:0,end:6}];
 if(mode.includes('semantic'))value.qualityDecision='revise';
 if(mode==='semantic')for(const c of [...value.audit.clauses,value.audit.finalClause])c.previousEvidence=[];
 const raw=structuredClone(value),expected=mode.includes('duplicate')?'duplicate':mode.includes('source')?'source':mode==='image'?'image':'quality';let critics=0,repairs=0;
 const result=await createKnowledgeQualityReviewer({context,sourceMode:'text',digest:async()=> 'synthetic',evaluate:async()=>{critics++;return ok(value);},regenerate:async(current,canonical)=>{repairs++;
  assert.equal(canonical.decision,'revise');assert.equal(canonical.audit.revisionReason,expected);assert.equal(canonical.audit.novelty,mode.includes('duplicate')?'duplicate':'new');assert.equal(Object.hasOwn(canonical,'qualityDecision'),false);
  assert.equal(canonical.allowTextOnly,candidate.mediaCandidates.length?false:value.allowTextOnly);assert.equal(canonical.supportingImageEvidence,value.supportingImageEvidence);assert(isKnowledgeReviewVerdict(canonical,context));
  if(expected==='quality')assert.equal(canonical.feedback,value.feedback);else {assert.notEqual(canonical.feedback,value.feedback);assert.match(canonical.feedback,/requiredRevisions|Every audited clause/);if(value.qualityDecision==='revise')assert.match(canonical.feedback,/preserved critic semantic reasons/);}return ok({summary:point.summary,coverageGoalIds:[],useSupportingImage:candidate.mediaCandidates.length>0,evidenceClauses:[point.summary]});}}).review(candidate);
 assert.deepEqual(result,{ok:true,value:null});assert.equal(critics,2);assert.equal(repairs,1);assert.deepEqual(value,raw);
});
test('raw semantic revise with complete nonduplicate support remains negative through both critiques',async()=>{
 const value=verdict(audit(),{decision:'revise'}),r=await review(value,{repair:{summary:point.summary,coverageGoalIds:[],useSupportingImage:false,evidenceClauses:[point.summary]}});assert.deepEqual(r.result,{ok:true,value:null});assert.equal(r.critics,2);assert.equal(r.repairs,1);
});
test('raw PASS image downgrade cannot invent optional removal permission or aggregate evidence',async()=>{
 const candidate={...point,mediaCandidates:[{visualId:'optional'}]},value=verdict(audit(),{allowTextOnly:true,supportingImageEvidence:'Raw cue stays byte-for-byte.'});const before=structuredClone(value);let critics=0,repairs=0;
 const result=await createKnowledgeQualityReviewer({context,sourceMode:'text',digest:async()=>assert.fail('Disallowed removal cannot reach digest'),evaluate:async()=>{critics++;return ok(value);},regenerate:async(current,canonical)=>{repairs++;assert.equal(canonical.audit.revisionReason,'image');assert.equal(canonical.allowTextOnly,false);assert.equal(canonical.supportingImageEvidence,value.supportingImageEvidence);return ok({summary:point.summary,coverageGoalIds:[],useSupportingImage:false,evidenceClauses:[point.summary]});}}).review(candidate);
 assert.deepEqual(result,{ok:false,error:{kind:'KnowledgeRepairOutputInvalid',attempts:4,technicalAttempts:4,technicalRetriesExhausted:true}});assert.equal(critics,1);assert.equal(repairs,4);assert.deepEqual(value,before);
});
test('complete per-clause pixels cannot manufacture a missing aggregate final-pass cue',async()=>{
 const candidate={...point,mediaCandidates:[{visualId:'optional'}]},value=verdict();for(const c of [...value.audit.clauses,value.audit.finalClause]){c.pixelEvidence=[{imageId:'optional',cue:'Synthetic visible relationship.'}];c.supportsWholeClaim=true;};value.supportingImageEvidence='';const before=structuredClone(value),r=await review(value,{candidate});invalid(r.result);assert.equal(r.critics,4);assert.equal(r.repairs,0);assert.deepEqual(value,before);
 const noImage=verdict();noImage.supportingImageEvidence='A phantom cue.';invalid((await review(noImage)).result);
});
test('original raster missing pixels derives source revision and never allows original image removal',async()=>{
 const candidate={...point,mediaCandidates:[{visualId:'original'}]},value=verdict();value.allowTextOnly=true;let calls=0,repairs=0;
 const result=await createKnowledgeQualityReviewer({context,sourceMode:'image',digest:async()=>assert.fail('Raster removal forbidden'),evaluate:async()=>{calls++;return ok(value);},regenerate:async(p,v)=>{repairs++;assert.equal(v.audit.revisionReason,'source');assert.equal(v.allowTextOnly,false);return ok({summary:p.summary,coverageGoalIds:[],useSupportingImage:false,evidenceClauses:[p.summary]});}}).review(candidate);
 assert.deepEqual(result,{ok:false,error:{kind:'KnowledgeRepairOutputInvalid',attempts:4,technicalAttempts:4,technicalRetriesExhausted:true}});assert.equal(calls,1);assert.equal(repairs,4);
});
for(const mutation of ['foreign-owner','duplicate-owner','unmatched-drop','drop-with-clause','drop-with-final'])test(`v8 owner drop rejects ${mutation} before deriving an action`,async()=>{
 const reviewContext={lessOften:[{id:'hidden',summary:'Owner choice.'}],previousKnowledge:[],previousQuizzes:[]},value={...verdict(),qualityDecision:'drop-see-less',retrievalComparison:null,sourceReliability:null,matchedLessOftenIds:['hidden'],audit:{version:8,clauses:[],finalClause:null}};
 if(mutation==='foreign-owner')value.matchedLessOftenIds=['foreign'];if(mutation==='duplicate-owner')value.matchedLessOftenIds=['hidden','hidden'];if(mutation==='unmatched-drop')value.matchedLessOftenIds=[];if(mutation==='drop-with-clause')value.audit.clauses=[clause(6)];if(mutation==='drop-with-final')value.audit.finalClause=audit().finalClause;
 const r=await review(value,{reviewContext});invalid(r.result);assert.equal(r.critics,4);assert.equal(r.repairs,0);
});
test('historical v5 canonical reads and completed-stage replay remain protected; fresh v8 never converts them',async()=>{
 const v5=historicalVerdict({...audit(),version:5,novelty:'new',revisionReason:'none'});assert(isKnowledgeReviewVerdict(v5,context));const before=structuredClone(v5);invalid((await review(v5)).result);assert.deepEqual(v5,before);
 const db=new DatabaseSync(':memory:');try{db.exec("CREATE TABLE knowledge_workflow_runs(owner_id TEXT,run_id TEXT,state TEXT,PRIMARY KEY(owner_id,run_id)); CREATE TABLE knowledge_workflow_run_tombstones(owner_id TEXT,run_id TEXT); INSERT INTO knowledge_workflow_runs VALUES('owner','run','extraction-loop');");db.exec(await readFile('worker/migrations/0025_workflow_quality_review.sql','utf8'));
 const database={prepare(sql){return {bind(...values){const stmt=db.prepare(sql);return {first:async()=>stmt.get(...values)??null,run:async()=>({success:true,meta:{changes:Number(stmt.run(...values).changes)}})};}};}},stages=new D1WorkflowStageRepository({database,now:()=> '2026-10-10T00:00:00Z'}),scope={ownerId:'owner',runId:'run'},saved=ok({point,verdict:v5});
 assert.deepEqual(await stages.run(scope,'knowledge-quality:v5','original-v5-input',async()=>saved),saved);assert.deepEqual(await stages.run(scope,'knowledge-quality:v5','original-v5-input',async()=>assert.fail('No historical new call')),saved);assert.equal((await stages.run(scope,'knowledge-quality:v5','changed-v7-input',async()=>assert.fail('No input bypass'))).error.kind,'WorkflowStageInputChanged');
 }finally{db.close();}
});

for(const mode of ['source','image','duplicate','combined','pure-quality'])test(`repair requirements resolve all ${mode} obligations without mutating raw support or upgrading a negative`,async()=>{
 const candidate={...point,mediaCandidates:mode==='image'||mode==='combined'?[{visualId:'image'}]:[]},value=verdict(audit(),{decision:'revise'});if(mode==='source'||mode==='combined')value.audit.finalClause.textEvidence=[];if(mode==='duplicate'||mode==='combined')value.audit.finalClause.previousEvidence=[{priorId:'knowledge:rule',start:0,end:6}];
 let seen=0;await createKnowledgeQualityReviewer({context,sourceMode:'text',digest:async()=> 'synthetic',evaluate:async()=>ok(value),regenerate:async(p,canonical)=>{seen++;const input=knowledgeReviewAuditInput(p,context,{}),before=structuredClone(canonical),targets=knowledgeRepairRequirements(p,canonical,'text',input);assert.deepEqual(canonical,before);
 assert.deepEqual(targets.sourceClauses,mode==='source'||mode==='combined'?[{start:6,end:16}]:[]);assert.deepEqual(targets.imageClauses,candidate.mediaCandidates.length?[{start:0,end:6},{start:6,end:16}]:[]);assert.deepEqual(targets.duplicateClauses,mode==='duplicate'||mode==='combined'?[{start:0,end:6},{start:6,end:16}]:[]);assert.equal(canonical.audit.revisionReason,mode==='combined'?'duplicate':mode==='pure-quality'?'quality':mode);
 if(mode==='pure-quality')assert.equal(canonical.feedback,value.feedback);else assert.match(canonical.feedback,/preserved critic semantic reasons within these same evidence boundaries/);
 for(const mutation of ['legacy','wrong-count','foreign-source','foreign-prior','foreign-image','reversed-summary','not-revise']){const v=structuredClone(canonical),i=structuredClone(input);if(mutation==='legacy')v.audit.version=5;if(mutation==='wrong-count')i.summaryTokenCount--;if(mutation==='foreign-source')v.audit.clauses[0].textEvidence[0].anchorIndex=99;if(mutation==='foreign-prior')v.audit.clauses[0].previousEvidence[0].priorId='foreign';if(mutation==='foreign-image')v.audit.finalClause.pixelEvidence=[{imageId:'foreign',cue:'Synthetic'}];if(mutation==='reversed-summary')v.audit.clauses[0].claimEnd=17;if(mutation==='not-revise')v.decision='pass';assert.throws(()=>knowledgeRepairRequirements(p,v,'text',i),{name:'TypeError',message:'KnowledgeRepairRequirementsInvalid'});}
 return {ok:false,error:{kind:'FixtureReachedBoundedRepair'}};}}).review(candidate);assert.equal(seen,1);
});

test('historical canonical v6 completed cache replays without a fresh validator or extra call; changed and claimed identities stay protected',async()=>{
 const v6=historicalVerdict({...audit(),version:6,novelty:'new',revisionReason:'none'}),before=structuredClone(v6);assert(isKnowledgeReviewVerdict(v6,context));invalid((await review(v6)).result);assert.deepEqual(v6,before);
 const db=new DatabaseSync(':memory:');try{db.exec("CREATE TABLE knowledge_workflow_runs(owner_id TEXT,run_id TEXT,state TEXT,PRIMARY KEY(owner_id,run_id)); CREATE TABLE knowledge_workflow_run_tombstones(owner_id TEXT,run_id TEXT); INSERT INTO knowledge_workflow_runs VALUES('owner','run','extraction-loop');");db.exec(await readFile('worker/migrations/0025_workflow_quality_review.sql','utf8'));
 const database={prepare(sql){return {bind(...values){const stmt=db.prepare(sql);return {first:async()=>stmt.get(...values)??null,run:async()=>({success:true,meta:{changes:Number(stmt.run(...values).changes)}})};}};}},stages=new D1WorkflowStageRepository({database,now:()=> '2026-10-10T00:00:00Z'}),scope={ownerId:'owner',runId:'run'},saved=ok({point,verdict:v6});
 assert.deepEqual(await stages.run(scope,'knowledge-quality:v6','original-v6-input',async()=>saved),saved);const stored=db.prepare('SELECT * FROM knowledge_workflow_stages').all();assert.deepEqual(await stages.run(scope,'knowledge-quality:v6','original-v6-input',async()=>assert.fail('No historical new call')),saved);assert.deepEqual(db.prepare('SELECT * FROM knowledge_workflow_stages').all(),stored);assert.equal((await stages.run(scope,'knowledge-quality:v6','changed-v7-input',async()=>assert.fail('No input bypass'))).error.kind,'WorkflowStageInputChanged');assert.deepEqual(db.prepare('SELECT * FROM knowledge_workflow_stages').all(),stored);
 db.prepare("INSERT INTO knowledge_workflow_stages(owner_id,run_id,stage_key,input_digest,status,created_at) VALUES('owner','run','question-evaluator:claimed-v6','original-claimed','claimed','2026-10-10T00:00:00Z')").run();const claimed=db.prepare('SELECT * FROM knowledge_workflow_stages').all();assert.equal((await stages.run(scope,'question-evaluator:claimed-v6','original-claimed',async()=>assert.fail('No uncertain retry'))).error.kind,'WorkflowStageCallUncertain');assert.deepEqual(db.prepare('SELECT * FROM knowledge_workflow_stages').all(),claimed);
 }finally{db.close();}
});

test('citation schema keeps exact source bounds and compact prior IDs with shared outer bounds',()=>{
 const candidate={...point,evidenceAnchors:[{...point.evidenceAnchors[0],quote:'Short.'},{...point.evidenceAnchors[0],quote:'A longer retained source relationship with two conditions.'}]};
 const prior={lessOften:[],previousKnowledge:[{id:'short',summary:'Prior.'},{id:'long',summary:'A different longer previous relationship with its own conditions.'}],previousQuizzes:[]};
 const input=knowledgeReviewAuditInput(candidate,prior,{}),before=structuredClone(input);
 const e=knowledgeReviewSchemaFor(prior,input).schema.properties.audit.properties.finalClause.anyOf[0].properties;
 for(const [index,branch] of e.textEvidence.items.anyOf.entries()){
  const entry=input.retainedText[index];assert.deepEqual(branch.properties.anchorIndex.enum,[entry.anchorIndex]);assert.equal(branch.properties.start.maximum,entry.tokens.length-1);assert.equal(branch.properties.end.maximum,entry.tokens.length);
 }
 const properties=e.previousEvidence.items.properties,maximum=Math.max(...input.previousContent.map(item=>item.tokens.length));
 assert.equal(Object.hasOwn(e.previousEvidence.items,'anyOf'),false);
 assert.deepEqual(properties.priorId.enum,input.previousContent.map(item=>item.id));
 assert.equal(properties.start.maximum,maximum-1);assert.equal(properties.end.maximum,maximum);assert.deepEqual(input,before);
});
test('large prior history grows by IDs without repeated per-ID citation schemas',()=>{
 const prior={lessOften:[],previousKnowledge:Array.from({length:67},(_,i)=>({id:'source:'+String(i).padStart(32,'0')+':1:'+ 'relationship-'.repeat(6)+i,summary:'A retained prior relationship.'})),previousQuizzes:Array.from({length:65},()=>({prompt:'Question?',answer:'Answer.'}))};
 const input=knowledgeReviewAuditInput(point,prior,{}),schema=knowledgeReviewSchemaFor(prior,input);
 const ids=input.previousContent.map(item=>item.id),serialized=JSON.stringify(schema);
 for(const id of ids)assert.equal(serialized.split(JSON.stringify(id)).length-1,4,'Each prior ID appears only in the four citation enums');
 assert.equal(input.previousContent.length,132);
});
for(const location of ['retrieval','clause','final'])for(const defect of ['foreign-id','short-prior-range'])test(`compact prior schema retains runtime ${location} ${defect} rejection`,async()=>{
 const prior={...context,previousKnowledge:[...context.previousKnowledge,{id:'long',summary:'A substantially longer prior relationship with several conditions and consequences.'}]},value=verdict();
 const citation={priorId:defect==='foreign-id'?'knowledge:foreign':'knowledge:rule',start:0,end:7};
 if(location==='retrieval')value.retrievalComparison={...value.retrievalComparison,priorAnswer:'An alleged answer.',priorEvidence:[citation]};
 else if(location==='clause')value.audit.clauses[0].previousEvidence=[citation];
 else value.audit.finalClause.previousEvidence=[citation];
 const {result,critics,repairs}=await review(value,{reviewContext:prior});invalid(result);assert.equal(critics,4);assert.equal(repairs,0);
});
test('empty referenced content offers no citation branch or contradictory numeric schema',()=>{
 const candidate={...point,evidenceAnchors:[]},prior={lessOften:[],previousKnowledge:[{id:'empty',summary:''}],previousQuizzes:[]};
 const input=knowledgeReviewAuditInput(candidate,prior,{}),e=knowledgeReviewSchemaFor(prior,input).schema.properties.audit.properties.finalClause.anyOf[0].properties;
 assert.equal(input.previousContent[0].endExclusiveTokenCount,0);for(const name of ['textEvidence','previousEvidence']){assert.equal(e[name].maxItems,0);assert.equal(Object.hasOwn(e[name].items,'anyOf'),false);}
});


test('exhausted provider recovery does not multiply actor technical retries or consume another quality critique',async()=>{
 for(const status of [200,204,299,408,429,503]){
  const attempts=[];
  const error={kind:'KnowledgeModelRejected',status,attempts:4,technicalAttempts:4,technicalRetriesExhausted:true};
  const result=await createKnowledgeQualityReviewer({context,sourceMode:'text',sourceEvidence:{},digest:async()=> 'synthetic-digest',evaluate:async(current,attempt,repairContext,technicalAttempt)=>{assert.equal(current,point);attempts.push([attempt,technicalAttempt]);return {ok:false,error};},regenerate:async()=>assert.fail('Provider refusal must not trigger semantic repair')}).review(point);
  assert.deepEqual(attempts,[[1,1]]);
  assert.deepEqual(result,{ok:false,error});
 }
});

test('malformed responses have four technical attempts per critique without consuming semantic repair budget',async()=>{
 const calls=[],malformed=verdict();malformed.audit.clauses.push({...clause(3),supportsWholeClaim:false});
 const revised=verdict(audit(),{decision:'revise'});
 let repairs=0;
 const result=await createKnowledgeQualityReviewer({context,sourceMode:'text',sourceEvidence:{},digest:async()=> 'synthetic-digest',evaluate:async(current,qualityAttempt,repairContext,technicalAttempt)=>{
   calls.push([qualityAttempt,technicalAttempt]);
   return ok(technicalAttempt<4?malformed:qualityAttempt===1?revised:verdict());
 },regenerate:async()=>{repairs++;return ok({summary:point.summary,coverageGoalIds:[],useSupportingImage:false,evidenceClauses:[point.summary]});}}).review(point);
 assert.equal(result.ok,true);assert.equal(repairs,1);
 assert.deepEqual(calls,[[1,1],[1,2],[1,3],[1,4],[2,1],[2,2],[2,3],[2,4]]);
 assert.equal(point.normalizedHash,'point');
});

test('reviewer credential and uncertain failures remain immediate typed failures',async()=>{
 for(const error of [{kind:'KnowledgeModelRejected',status:401},{kind:'KnowledgeModelRejected',status:403},{kind:'WorkflowStageCallUncertain',causeKind:'AgentLedgerPersistenceFailed'},{kind:'AgentExecutionBoundaryFailure'},{kind:'KnowledgeModelRejected',status:400},{kind:'KnowledgeModelRejected',status:422},{kind:'KnowledgeModelRejected',status:200,causeKind:'KnowledgeModelCredentialMissing'}]){
  let calls=0;
  const result=await createKnowledgeQualityReviewer({context,sourceMode:'text',sourceEvidence:{},digest:async()=> 'synthetic-digest',evaluate:async()=>{calls++;return {ok:false,error};},regenerate:async()=>assert.fail('A fatal failure must not trigger repair')}).review(point);
  assert.equal(calls,1);
  assert.deepEqual(result,{ok:false,error});
 }
});


test('technical transport retries use fresh identities within the same quality critique',async()=>{
 for(const error of [{kind:'KnowledgeModelRejected',status:200},{kind:'KnowledgeModelRejected',status:204},{kind:'KnowledgeModelRejected',status:299},{kind:'KnowledgeModelRejected',status:408},{kind:'KnowledgeModelRejected',status:429},{kind:'KnowledgeModelRejected',status:500},{kind:'KnowledgeModelRejected',status:502},{kind:'KnowledgeModelRejected',status:503},{kind:'KnowledgeModelRejected',status:504},{kind:'KnowledgeModelTimeout'},{kind:'WorkflowStageCallUncertain'},{kind:'WorkflowStageCallUncertain',causeKind:'KnowledgeModelTimeout'},{kind:'WorkflowAgentAgentOutputInvalid'}])for(const recovers of [true,false]){
  const calls=[];
  const result=await createKnowledgeQualityReviewer({context,sourceMode:'text',sourceEvidence:{},digest:async()=> 'synthetic-digest',evaluate:async(candidate,qualityAttempt,repairContext,technicalAttempt)=>{calls.push([qualityAttempt,technicalAttempt]);return recovers&&technicalAttempt===4?ok(verdict()):{ok:false,error};},regenerate:async()=>assert.fail('No semantic repair on technical failures')}).review(point);
  assert.deepEqual(calls,[[1,1],[1,2],[1,3],[1,4]]);
  if(recovers){assert.equal(result.ok,true);assert.equal(result.value.point,point);}
  else assert.deepEqual(result,{ok:false,error:{...error,attempts:4,technicalAttempts:4,technicalRetriesExhausted:true}});
 }
});

test('malformed or failed repair retains original point and technical budget independent from quality critiques',async()=>{
 for(const error of [undefined,{kind:'KnowledgeModelRejected',status:200},{kind:'KnowledgeModelRejected',status:408},{kind:'KnowledgeModelTimeout'},{kind:'WorkflowAgentAgentOutputInvalid'}])for(const recovers of [true,false]){
  const calls=[];let critics=0;
  const result=await createKnowledgeQualityReviewer({context,sourceMode:'text',sourceEvidence:{},digest:async()=> 'synthetic-digest',evaluate:async()=>ok(++critics===1?verdict(audit(),{decision:'revise'}):verdict()),regenerate:async(candidate,review,retrievalComparison,technicalAttempt)=>{assert.equal(candidate,point);calls.push(technicalAttempt);return recovers&&technicalAttempt===4?ok({summary:point.summary,coverageGoalIds:[],useSupportingImage:false,evidenceClauses:[point.summary]}):error?{ok:false,error}:ok({summary:'Malformed missing evidence'});}}).review(point);
  assert.deepEqual(calls,[1,2,3,4]);
  assert.equal(critics,recovers?2:1);assert.equal(point.normalizedHash,'point');
  if(recovers)assert.equal(result.ok,true);
  else assert.deepEqual(result,{ok:false,error:error?{...error,attempts:4,technicalAttempts:4,technicalRetriesExhausted:true}:{kind:'KnowledgeRepairOutputInvalid',attempts:4,technicalAttempts:4,technicalRetriesExhausted:true}});
 }
});

test('repair technical retries explain structural faults without replaying output or spending another quality revision',async()=>{
 const valid={summary:point.summary,coverageGoalIds:[],useSupportingImage:false,evidenceClauses:[point.summary]};
 const cases=[['RepairShapeInvalid',{summary:'PRIVATE_BAD_OUTPUT'}],['RepairSummaryInvalid',{...valid,summary:''}],['RepairCoverageGoalsInvalid',{...valid,coverageGoalIds:['PRIVATE_UNKNOWN_GOAL']}],['RepairEvidenceClausesInvalid',{...valid,evidenceClauses:[]}],['RepairImageRetentionInvalid',{...valid,useSupportingImage:'false'}]];
 for(const [issue,malformed] of cases){
  let critics=0;const calls=[],received=[];
  const result=await createKnowledgeQualityReviewer({context,sourceMode:'text',sourceEvidence:{},digest:async()=> 'synthetic-repair-feedback',evaluate:async(current,qualityAttempt)=>{critics++;assert.equal(qualityAttempt,critics);return ok(qualityAttempt===1?verdict(audit(),{decision:'revise'}):verdict());},regenerate:async(current,review,comparison,technicalAttempt,feedback)=>{
   assert.equal(current,point);assert.equal(review.decision,'revise');calls.push(technicalAttempt);received.push(feedback);
   if(technicalAttempt===1){assert.equal(feedback,undefined);return ok(malformed);}
   assert.equal(feedback.failureKind,'KnowledgeRepairOutputInvalid');assert.deepEqual(feedback.issues,[issue]);assert.match(feedback.instructions,/exactly 1 nonempty strings/);assert.match(feedback.instructions,/immutable evidence/);assert.doesNotMatch(JSON.stringify(feedback),/PRIVATE_BAD_OUTPUT|PRIVATE_UNKNOWN_GOAL/);
   if(technicalAttempt===2)return {ok:false,error:{kind:'KnowledgeModelTimeout'}};
   assert.equal(feedback,received[1],'A transport failure must preserve the last structural correction');return ok(valid);
  }}).review(point);
  assert(result.ok);assert(result.value);assert.equal(critics,2);assert.deepEqual(calls,[1,2,3]);assert.equal(result.value.point.summary,point.summary);assert.deepEqual(point.normalizedHash,'point');
 }
});

test('bounded repair policy stops after the first malformed response without a technical retry or second critic',async()=>{
 let critics=0,repairs=0;
 const result=await createKnowledgeQualityReviewer({technicalRetries:false,context,sourceMode:'text',sourceEvidence:{},digest:async()=>assert.fail('An invalid repair cannot commit a new point'),evaluate:async()=>{critics++;return ok(verdict(audit(),{decision:'revise'}));},regenerate:async(current,review,comparison,attempt,feedback)=>{repairs++;assert.equal(attempt,1);assert.equal(feedback,undefined);return ok({summary:'Malformed missing evidence'});}}).review(point);
 assert.deepEqual(result,{ok:false,error:{kind:'KnowledgeRepairOutputInvalid',attempts:1,technicalAttempts:1,technicalRetriesExhausted:true}});assert.equal(critics,1);assert.equal(repairs,1);
});

test('scoped critic pixel citations enumerate exact current attachments and forbid absent pixels',()=>{
 const input=knowledgeReviewAuditInput(point,context,{}),ids=['visual:exact-id','visual:second-id'];
 const schema=knowledgeReviewSchemaFor(context,input,ids),evidence=[schema.schema.properties.audit.properties.clauses.items.properties.pixelEvidence,schema.schema.properties.audit.properties.finalClause.anyOf[0].properties.pixelEvidence];
 for(const pixels of evidence)assert.deepEqual(pixels.items.properties.imageId.enum,ids);
 const empty=knowledgeReviewSchemaFor(context,input,[]);
 for(const pixels of [empty.schema.properties.audit.properties.clauses.items.properties.pixelEvidence,empty.schema.properties.audit.properties.finalClause.anyOf[0].properties.pixelEvidence]){assert.equal(pixels.maxItems,0);assert.equal(Object.hasOwn(pixels.items.properties.imageId,'enum'),false);}
 assert.equal(Object.hasOwn(knowledgeReviewSchemaFor(context,input).schema.properties.audit.properties.clauses.items.properties.pixelEvidence.items.properties.imageId,'enum'),false);
});

test('technical citation retries receive actionable structural feedback without consuming semantic critique',async()=>{
 for(const defect of ['ClaimBoundariesInvalid','ImageCitationInvalid']){
  const candidate={...point,mediaCandidates:[{visualId:'visual:exact-id'}]},valid=verdict();
  valid.supportingImageEvidence='Constructed actual visible relationship.';
  for(const c of [...valid.audit.clauses,valid.audit.finalClause]){c.pixelEvidence=[{imageId:'visual:exact-id',cue:'Constructed visible labels.'}];c.supportsWholeClaim=true;}
  const malformed=structuredClone(valid);
  if(defect==='ClaimBoundariesInvalid')malformed.audit.clauses.push({...malformed.audit.clauses[0],claimEnd:3});
  else malformed.audit.finalClause.pixelEvidence[0].imageId='visual:extra-typo-id';
  const original=structuredClone(candidate),received=[];
  const result=await createKnowledgeQualityReviewer({context,sourceMode:'text',sourceEvidence:{},digest:async()=>assert.fail('Technical correction cannot rewrite knowledge'),evaluate:async(current,qualityAttempt,repairContext,technicalAttempt,feedback)=>{
   received.push([qualityAttempt,technicalAttempt]);assert.equal(current,candidate);assert.equal(repairContext,undefined);
   if(technicalAttempt===1){assert.equal(feedback,undefined);return ok(malformed);}
   assert.equal(feedback.failureKind,'KnowledgeReviewOutputInvalid');assert.deepEqual(feedback.issues,[defect]);
   assert.match(feedback.instructions,/strictly increasing/);assert.match(feedback.instructions,/all remaining summary tokens/);assert.match(feedback.instructions,/Copy pixel imageId exactly/);assert.match(feedback.instructions,/without inventing source support/);
   return ok(valid);
  },regenerate:async()=>assert.fail('No semantic repair on a malformed citation')}).review(candidate);
  assert.equal(result.ok,true);assert.equal(result.value.point,candidate);assert.deepEqual(candidate,original);assert.deepEqual(received,[[1,1],[1,2]]);
 }
});

test('explicit bounded technical policy disables technical retries while preserving semantic quality budget',async()=>{
 for(const error of [undefined,{kind:'KnowledgeModelRejected',status:200},{kind:'KnowledgeModelRejected',status:408},{kind:'KnowledgeModelTimeout'}]){
  let calls=0;
  const result=await createKnowledgeQualityReviewer({technicalRetries:false,context,sourceMode:'text',sourceEvidence:{},digest:async()=>assert.fail('No digest'),evaluate:async()=>{calls++;return error?{ok:false,error}:ok({unexpected:'Malformed response'});},regenerate:async()=>assert.fail('No semantic repair')}).review(point);
  assert.equal(calls,1);assert.deepEqual(result,{ok:false,error:{...(error??{kind:'KnowledgeReviewOutputInvalid'}),attempts:1,technicalAttempts:1,technicalRetriesExhausted:true}});
 }
 let calls=0,repairs=0;
 const negative=await createKnowledgeQualityReviewer({technicalRetries:false,context,sourceMode:'text',sourceEvidence:{},digest:async()=> 'synthetic-digest',evaluate:async()=>{calls++;return ok(verdict(audit(),{decision:'revise'}));},regenerate:async()=>{repairs++;return ok({summary:point.summary,coverageGoalIds:[],useSupportingImage:false,evidenceClauses:[point.summary]});}}).review(point);
 assert.deepEqual(negative,ok(null));assert.equal(calls,2);assert.equal(repairs,1);
});
