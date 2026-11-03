import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createLearningBatchService} from '../worker/learning-batches-d1.js';
import {D1KnowledgeContentRepository} from '../worker/knowledge-workflow-content-d1.js';
import {assembleQuizPair} from '../src/features/knowledge-workflows/quiz-pair.js';
import {knowledgeReviewAuditInput,knowledgeReviewTokens} from '../src/features/knowledge-workflows/quality-review.js';

function fixture(days=8,due='2026-10-17T00:00:00.000Z',studied='2026-10-09T00:00:00.000Z') {
  const db=new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../worker/migrations/0012_learner_batches.sql',import.meta.url),'utf8'));
  db.exec(readFileSync(new URL('../worker/migrations/0030_learner_question_state.sql',import.meta.url),'utf8'));
  db.exec('CREATE TABLE extraction_knowledge_points(owner_id TEXT, knowledge_id TEXT, source_id TEXT);');
  db.prepare('INSERT INTO extraction_knowledge_points VALUES(?,?,?)').run('test-owner','point','music-source');
  db.prepare('INSERT INTO learner_knowledge_state VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('test-owner','point','music-source',3,1,days,due,studied,2,0,'2026-10-09T00:00:00.000Z');
  const database={prepare(query){let bindings=[];return {bind(...values){bindings=values;return this;},async first(){return db.prepare(query).get(...bindings)??null;},async all(){return {success:true,results:db.prepare(query).all(...bindings)};},async run(){const r=db.prepare(query).run(...bindings);return {success:true,meta:{changes:Number(r.changes)}};}};},async batch(statements){db.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run());db.exec('COMMIT');return results;}catch(error){db.exec('ROLLBACK');throw error;}}};
  const service=createLearningBatchService({database,now:()=> '2026-10-13T00:00:00.000Z',random:()=>0.5,logger:()=>{}});
  return {db,database,service,state:()=>db.prepare('SELECT * FROM learner_knowledge_state').get(),feedback:()=>db.prepare('SELECT * FROM learner_preference_feedback').get()};
}
const command=(choice,idempotencyKey)=>({ownerId:'test-owner',knowledgeId:'point',choice,idempotencyKey});
test('more shortens and less extends adjacent cooldown; retries leave recall history intact',async()=>{
  const f=fixture();try{
    assert.equal((await f.service.setPreference(command('more','more-once'))).ok,true);
    const after=f.state();assert.equal(after.scheduled_days,4);assert.equal(after.due_at,'2026-10-13T00:00:00.000Z');
    assert.equal((await f.service.setPreference(command('more','more-once'))).ok,true);assert.deepEqual(f.state(),after);
    assert.equal((await f.service.setPreference(command('less','less-once'))).ok,true);
    assert.equal(f.state().scheduled_days,8);assert.equal(f.state().due_at,'2026-10-17T00:00:00.000Z');
    assert.equal(f.feedback().choice,'less');assert.equal(f.state().review_count,2);assert.equal(f.state().view_count,3);assert.equal(f.state().last_answer_correct,1);
  }finally{f.db.close();}
});
test('one-day and 365-day endpoints and intermediate intervals follow the existing ladder',async()=>{
  for(const [days,choice,expected] of [[1,'more',1],[365,'less',365],[365,'more',256],[3,'more',2],[3,'less',4]]){
    const f=fixture(days);try{assert.equal((await f.service.setPreference(command(choice,'one'))).ok,true);assert.equal(f.state().scheduled_days,expected);}finally{f.db.close();}
  }
});
test('initial studied content moves from an immediate due date to one day on see-less',async()=>{
  const f=fixture(0,'2026-10-13T00:00:00.000Z');try{
    assert.equal((await f.service.setPreference(command('more','initial-more'))).ok,true);
    assert.equal(f.state().scheduled_days,0);assert.equal(f.state().due_at,'2026-10-13T00:00:00.000Z');
    assert.equal((await f.service.setPreference(command('less','initial-less'))).ok,true);
    assert.equal(f.state().scheduled_days,1);assert.equal(f.state().due_at,'2026-10-14T00:00:00.000Z');
  }finally{f.db.close();}
});
test('unlearned content stays unlearned; foreign owners and unknown points cannot create preferences',async()=>{
  const f=fixture(0,null,null);try{
    assert.equal((await f.service.setPreference(command('less','unlearned'))).ok,true);
    assert.equal(f.state().scheduled_days,0);assert.equal(f.state().due_at,null);assert.equal(f.state().studied_at,null);
    assert.equal((await f.service.setPreference({...command('more','foreign'),ownerId:'foreign-owner'})).ok,false);
    assert.equal((await f.service.setPreference({...command('more','unknown'),knowledgeId:'unknown'})).ok,false);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM learner_preference_feedback').get().n,1);
  }finally{f.db.close();}
});

test('frequency feedback never enters scraper exclusion contexts, including unknown subjects',async()=>{
  const f=fixture();try{
    f.db.exec(`ALTER TABLE extraction_knowledge_points ADD COLUMN run_id TEXT;
      ALTER TABLE extraction_knowledge_points ADD COLUMN point_json TEXT;
      ALTER TABLE extraction_knowledge_points ADD COLUMN created_at TEXT;
      CREATE TABLE source_classifications(owner_id TEXT,source_id TEXT,main_subject TEXT,status TEXT);
      CREATE TABLE knowledge_workflow_quizzes(owner_id TEXT,source_id TEXT,knowledge_id TEXT,run_id TEXT,created_at TEXT,quiz_id TEXT,draft_json TEXT);`);
    f.db.prepare('DELETE FROM extraction_knowledge_points').run();
    for(const [owner,source,subject,id] of [['test-owner','music-source','music','same-source'],['test-owner','other-music','music','same-subject'],['test-owner','other-subject','employment','different-subject'],['foreign-owner','foreign-source','music','foreign-owner']]){
      f.db.prepare('INSERT INTO source_classifications VALUES(?,?,?,?)').run(owner,source,subject,'classified');
      const point={id,sourceId:source,sourceRevision:1,summary:'A synthetic unwanted concept.',normalizedHash:id,evidenceAnchors:[]};
      f.db.prepare('INSERT INTO extraction_knowledge_points VALUES(?,?,?,?,?,?)').run(owner,id,source,'old-run',JSON.stringify(point),'2026-10-09T00:00:00.000Z');
      f.db.prepare('INSERT INTO learner_preference_feedback VALUES(?,?,?,?,?)').run(owner,id,-1,'less','2026-10-09T00:00:00.000Z');
    }
    const repository=new D1KnowledgeContentRepository({database:f.database,logger:()=>{}});
    const context=await repository.reviewContext({ownerId:'test-owner',sourceId:'music-source',runId:'current-run',knowledgeId:'current-point'});
    assert.equal(context.ok,true);
    assert.deepEqual(context.value.lessOften,[]);
    assert.deepEqual(context.value.previousKnowledge.map(point=>point.id),['same-source']);
    f.db.prepare("UPDATE source_classifications SET status='needs-review' WHERE source_id='music-source'").run();
    const unknown=await repository.reviewContext({ownerId:'test-owner',sourceId:'music-source',runId:'current-run',knowledgeId:'current-point'});
    assert.deepEqual(unknown.value.lessOften,[]);
    f.db.prepare("DELETE FROM source_classifications WHERE source_id='music-source'").run();
    const initial=await repository.reviewContext({ownerId:'test-owner',sourceId:'music-source',runId:'initial-run',knowledgeId:'current-point'});
    assert.deepEqual(initial.value.lessOften,[]);
  }finally{f.db.close();}
});

test('fresh review context preserves quiz meaning without repeated pair bookkeeping',async t=>{
  const f=fixture();try{
    f.db.exec(`ALTER TABLE extraction_knowledge_points ADD COLUMN run_id TEXT;
      ALTER TABLE extraction_knowledge_points ADD COLUMN point_json TEXT;
      ALTER TABLE extraction_knowledge_points ADD COLUMN created_at TEXT;
      CREATE TABLE source_classifications(owner_id TEXT,source_id TEXT,main_subject TEXT,status TEXT);
      CREATE TABLE knowledge_workflow_quizzes(owner_id TEXT,source_id TEXT,knowledge_id TEXT,run_id TEXT,created_at TEXT,quiz_id TEXT,draft_json TEXT);`);
    f.db.prepare('DELETE FROM extraction_knowledge_points').run();
    const pair=assembleQuizPair({knowledgeId:'old-point',knowledgeRevision:1,canonicalAnswers:['valve','reservoir'],citedEvidenceUrls:['https://example.test/synthetic-source'],multipleChoice:{prompt:'Which mappings describe the synthetic system?',options:[{key:'A',text:'The valve controls the path.'},{key:'B',text:'The reservoir stores water.'},{key:'C',text:'The path creates water.'}],correctOptionKeys:['A','B'],correctOptionAnswers:[{key:'A',canonicalAnswer:'valve'},{key:'B',canonicalAnswer:'reservoir'}],explanation:'The valve controls the path; the reservoir stores water.'},fillBlank:{prompt:'The ____ controls the path, and the ____ stores water.',blanks:[{id:'blank-1',canonicalAnswer:'valve',acceptedAnswers:['valve','control valve']},{id:'blank-2',canonicalAnswer:'reservoir',acceptedAnswers:['reservoir','water reservoir']}],explanation:'These terms name the two distinct roles.'}},'quiz:synthetic-source:old-point:r1');
    const paired={id:pair.multipleChoice.id,knowledgeId:'old-point',knowledgeRevision:1,kind:pair.multipleChoice.kind,prompt:pair.multipleChoice.prompt,options:pair.multipleChoice.options.map(option=>option.text),answer:pair.multipleChoice.correctOptionKeys.map(key=>pair.multipleChoice.options.find(option=>option.key===key).text),explanation:pair.multipleChoice.explanation,citedEvidenceUrls:pair.citedEvidenceUrls,pairedQuiz:pair};
    const legacy={id:'legacy',knowledgeId:'legacy-point',knowledgeRevision:1,kind:'fill-blank',prompt:'A ____ controls a ____.',options:[],answer:['valve','path'],blanks:[{id:'blank-1',acceptedAnswers:['valve','control valve']},{id:'blank-2',acceptedAnswers:['path','flow path']}],explanation:'The control acts on the path.',citedEvidenceUrls:['https://example.test/legacy']};
    const distinct={...paired,id:'distinct',answer:[paired.options[2]],explanation:'A distinct retained legacy explanation.'};
    const legacyChoice={...legacy,id:'legacy-choice',knowledgeId:'legacy-choice-point',kind:'single-choice',prompt:'Which control blocks flow?',options:['A closed valve.','An open path.'],answer:'A closed valve.'};delete legacyChoice.blanks;
    const originals=[paired,legacy,distinct,legacyChoice];
    for(const draft of originals)f.db.prepare('INSERT INTO knowledge_workflow_quizzes VALUES(?,?,?,?,?,?,?)').run('test-owner','music-source',draft.knowledgeId,'old-run','2026-10-09T00:00:00.000Z',draft.id,JSON.stringify(draft));
    const before=f.db.prepare('SELECT * FROM knowledge_workflow_quizzes ORDER BY quiz_id').all();
    const result=await new D1KnowledgeContentRepository({database:f.database,logger:()=>{}}).reviewContext({ownerId:'test-owner',sourceId:'music-source',runId:'current-run',knowledgeId:'current-point'});
    assert.equal(result.ok,true);
    const projected=result.value.previousQuizzes.find(item=>item.pairedQuiz&&!Object.hasOwn(item,'answer'));
    assert.deepEqual(projected,{pairedQuiz:{multipleChoice:{kind:pair.multipleChoice.kind,prompt:pair.multipleChoice.prompt,options:pair.multipleChoice.options,correctOptionKeys:pair.multipleChoice.correctOptionKeys,explanation:pair.multipleChoice.explanation},fillBlank:{kind:pair.fillBlank.kind,prompt:pair.fillBlank.prompt,blanks:pair.fillBlank.blanks,explanation:pair.fillBlank.explanation}}});
    assert.deepEqual(result.value.previousQuizzes.find(item=>item.prompt===legacy.prompt),{prompt:legacy.prompt,answer:legacy.answer,blanks:legacy.blanks,explanation:legacy.explanation});
    assert.deepEqual(result.value.previousQuizzes.find(item=>item.prompt===legacyChoice.prompt),{prompt:legacyChoice.prompt,answer:legacyChoice.answer,options:legacyChoice.options,explanation:legacyChoice.explanation});
    assert.deepEqual(result.value.previousQuizzes.find(item=>item.pairedQuiz&&Object.hasOwn(item,'answer')),{...projected,answer:distinct.answer,explanation:distinct.explanation});
    assert.deepEqual(f.db.prepare('SELECT * FROM knowledge_workflow_quizzes ORDER BY quiz_id').all(),before);
    const oldContext={lessOften:[],previousKnowledge:[],previousQuizzes:[{prompt:paired.prompt,answer:paired.answer,pairedQuiz:pair}]};
    const newContext={...oldContext,previousQuizzes:[projected]},point={summary:'A synthetic source relationship.',evidenceAnchors:[]};
    const metrics=context=>{const input={...context,auditEvidence:knowledgeReviewAuditInput(point,context,{})},serialized=JSON.stringify(input);return {bytes:Buffer.byteLength(serialized),wordSegments:knowledgeReviewTokens(serialized).length};};
    const oldMetrics=metrics(oldContext),newMetrics=metrics(newContext);
    assert(newMetrics.bytes<oldMetrics.bytes);assert(newMetrics.wordSegments<oldMetrics.wordSegments);
    t.diagnostic('Synthetic quiz context plus unchanged numbered audit: '+JSON.stringify({before:oldMetrics,after:newMetrics}));
  }finally{f.db.close();}
});
