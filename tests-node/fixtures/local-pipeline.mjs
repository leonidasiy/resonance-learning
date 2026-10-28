import assert from 'node:assert/strict';
import {workflowInstanceId} from '../../worker/main.js';
import {syntheticAssessment} from './knowledge-review-audit.mjs';

// Constructed responses exercise wiring only; they are never model/source accuracy claims.
export function createLocalPipelineFixtureProvider({chatEndpoint="https://openrouter.ai/api/v1/chat/completions",model}={}){
  const sentences=Array.from({length:5},(_,index)=>`Synthetic relationship ${index+1} has the canonical fixture answer.`);
  let modelCalls=0;
  const provider=async(input,init)=>{
    const endpoint=String(input);
    assert([chatEndpoint,...(model?[]:['https://openrouter.ai/api/alpha/decisions'])].includes(endpoint),'Only the synthetic own provider may be contacted.');
    assert.equal(new Headers(init.headers).get('authorization'),'Bearer synthetic-own-key');
    assert(++modelCalls<60,'Bound synthetic pipeline calls.');
    const body=JSON.parse(init.body);
    if(model){assert.equal(body.model,model);assert.equal(body.provider,undefined);assert.equal(body.reasoning,undefined);}
    if(endpoint.endsWith('/alpha/decisions'))return Response.json({model:'typesafe/jev-1.13-20260917',answers:Object.fromEntries(Object.keys(body.questions).map(id=>[id,{type:'noul',noul:1}]))});
    const message=body.messages[1].content;
    const envelope=Array.isArray(message)?message[0].text:message;
    const inputTask=JSON.parse(envelope.slice(envelope.indexOf('\n')+1,envelope.lastIndexOf('\n')));
    const task=inputTask.task??inputTask,schema=body.response_format?.json_schema?.name;
    let output;
    if(schema==='semantic_decisions_v1')output={probabilities:Object.fromEntries(Object.keys(task.questions).map(id=>[id,1]))};
    else if(schema==='knowledge_batch_selection_v1')output={keptKnowledgeIds:task.points.map(point=>point.id)};
    else if(schema==='knowledge_quality_review_v12')output=syntheticAssessment(task,{decision:'pass',reasons:['Constructed synthetic source evidence.'],feedback:'Accepted fixture.',matchedLessOftenIds:[],supportingImageEvidence:'',allowTextOnly:true});
    else if(task.operation==='plan-authorized-material'||task.operation==='replan-authorized-material')output={revision:1,frontier:[],coverageGoals:[],unresolvedGaps:[],stopDecision:{decision:'continue',rationale:'Observe the supplied fixture inventory.',evidenceUrls:[],unresolvedGapIds:[]}};
    else if(task.operation==='review-material-source')output={notes:'Constructed source review.',reviews:task.candidates.map(candidate=>({candidateIndex:candidate.candidateIndex,points:[{summary:candidate.summary,visibleEvidence:candidate.evidenceAnchors[0].visibleEvidence??candidate.summary}]}))};
    else if(task.sections)output={pages:task.sections.map(section=>({url:section.url,notes:'Constructed source facts.',candidates:sentences.filter(sentence=>section.text.includes(sentence)).map((summary,index)=>({summary,normalizedHash:`fixture-${index}`,evidenceAnchors:[{url:section.url,selector:section.locator}],coverageGoalIds:[],mediaCandidates:[]}))}))};
    else if(task.source&&task.points)output={mainSubject:'music',topic:'Synthetic relationships'};
    else if(task.draft)output={score:9,reasons:['Constructed quiz fixture.'],feedback:'Accepted fixture.',groundingProblems:[],knowledgeGroundingProblems:[]};
    else if(task.knowledge)output={knowledgeId:task.knowledge.id,knowledgeRevision:task.knowledge.sourceRevision,canonicalAnswers:['fixture'],citedEvidenceUrls:task.knowledge.evidenceAnchors.map(anchor=>anchor.url),multipleChoice:{prompt:`Which answer is canonical for ${task.knowledge.normalizedHash}?`,options:[{key:'choice-a',text:'Fixture'},{key:'choice-b',text:'Other'}],correctOptionKeys:['choice-a'],correctOptionAnswers:[{key:'choice-a',canonicalAnswer:'fixture'}],explanation:'Fixture is the stated canonical answer.'},fillBlank:{prompt:'The canonical answer is ____.',blanks:[{id:'blank-1',canonicalAnswer:'fixture',acceptedAnswers:['fixture']}],explanation:'Fixture is the stated canonical answer.'}};
    else assert.fail(`Unhandled synthetic pipeline task ${schema??task.operation??inputTask.contract?.role}`);
    return Response.json({id:`synthetic-pipeline-${modelCalls}`,choices:[{finish_reason:'stop',message:{content:JSON.stringify(output)}}],usage:{prompt_tokens:100,completion_tokens:100}});
  };
  return {provider,sentences,calls:()=>modelCalls};
}

async function waitFor(check){for(let i=0;i<500;i++){if(await check())return;await new Promise(resolve=>setTimeout(resolve,10));}throw new Error('Synthetic pipeline did not settle.');}

export async function publishOwnedTextFixture({application,api,sentences}){
    const created=await api('/api/source-library/private-documents',{title:'Synthetic owned lesson',fileName:'synthetic-owned.txt',idempotencyKey:'fixture-create-owned'});
    assert(created.runId&&created.source.id);
    await api('/api/knowledge-workflows/material',{runId:created.runId,sourceId:created.source.id,sourceRevision:created.source.revision,sourceUrl:created.source.canonicalUrl,content:sentences.join('\n\n'),fileName:'synthetic-owned.txt',mediaType:'text/plain',mode:'text',idempotencyKey:'fixture-upload-owned'});
    for(let chunk=0;chunk<10;chunk++){
      const row=application.database.sqlite.prepare('SELECT state FROM knowledge_workflow_runs WHERE run_id=?').get(created.runId);
      if(row.state==='completed')break;
      const instance=await application.workflows.get(workflowInstanceId(created.runId));
      await waitFor(async()=>['complete','waiting','errored'].includes((await instance.status()).status));
      const snapshot=await instance.status();
      if(snapshot.status==='complete'&&snapshot.output?.continuation===true){await instance.restart();continue;}
      assert.equal(snapshot.status,'complete',JSON.stringify(application.database.sqlite.prepare('SELECT state,failure_kind FROM knowledge_workflow_runs WHERE run_id=?').get(created.runId)));
    }
    assert.equal(application.database.sqlite.prepare('SELECT state FROM knowledge_workflow_runs WHERE run_id=?').get(created.runId).state,'completed');
    const quizzes=application.database.sqlite.prepare('SELECT status,draft_json FROM knowledge_workflow_quizzes WHERE run_id=?').all(created.runId);
    assert.equal(quizzes.length,5);
    assert(quizzes.every(row=>row.status==='published'&&JSON.parse(row.draft_json).pairedQuiz?.fillBlank.kind==='fill-blank'&&JSON.parse(row.draft_json).pairedQuiz?.multipleChoice.kind==='single-choice'));
  return created;
}
