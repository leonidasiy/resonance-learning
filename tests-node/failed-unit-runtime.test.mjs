import {syntheticRelationshipUnits} from './fixtures/webpage-condition-partition.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { syntheticAssessment } from './fixtures/knowledge-review-audit.mjs';
import { createKnowledgeWorkflowRuntime } from '../worker/knowledge-workflow-runtime.js';
import { createKnowledgeWorkflowService } from '../src/features/knowledge-workflows/workflow.js';
import { createAgentConfigurationLoader } from '../src/features/knowledge-workflows/config.js';
import { D1KnowledgeWorkflowRepository } from '../worker/knowledge-workflow-d1.js';
import { D1KnowledgeWorkflowMaterialRepository } from '../worker/knowledge-workflow-material-d1.js';
import { D1KnowledgeWorkflowProgressRepository } from '../worker/knowledge-workflow-progress-d1.js';
import { readFailedQuizItems,exhaustedQuizTechnicalFailure } from '../worker/knowledge-workflow-quiz-failures.js';
import {AgentExecutionBoundaryFailure} from '../src/features/knowledge-workflows/harness.js';
import { WEBPAGE_IMAGE_POLICY } from '../worker/webpage-image-budget.js';

for (const failureMode of ['quiz-invocation-yield','quiz-invocation-yield-repair', 'chunk-bound', 'material-coverage', 'review-output', 'model503', 'model200', 'model401', 'stopped-before-acquisition','expired-quiz-clock','quiz-review503','quiz-generator503','quiz-review-malformed','quiz-review401','quiz-review402','classifier503-success','classifier-malformed-success','classifier503-exhausted','classifier-malformed-exhausted','classifier401','classifier402','classifier-bounded','classifier-critical','classifier-mixed-success','quiz-review-resume-success']) {
 test(failureMode==='chunk-bound'?'runtime checkpoints after three quiz jobs without refilling a durable step':failureMode==='material-coverage'?'runtime bounds supplied material coverage without inventing support':failureMode==='expired-quiz-clock'?'runtime continues normal quizzes after the extraction window expires without renewing it':failureMode.startsWith('classifier')?`runtime classification honors one four-attempt combined technical budget: ${failureMode}`:failureMode.startsWith('quiz-') ? `runtime isolates ${failureMode} and approved retry preserves source pages, drafts and healthy quizzes` : failureMode === 'stopped-before-acquisition' ? 'runtime fences provider calls after an authoritative run stop' : failureMode === 'model401' ? 'runtime stops on credential rejection without local page skipping or retry' : `runtime isolates ${failureMode} and approved retry processes only the failed page with fresh durable model identities`, async () => {
  const db = new DatabaseSync(':memory:');
  try {
    const migrations = new URL('../worker/migrations/', import.meta.url);
    for (const file of (await readdir(migrations)).filter(name => name.endsWith('.sql')).sort()) db.exec(await readFile(new URL(file, migrations), 'utf8'));
    let failFinalScratchpadRead = false, finalScratchpadReadFailed = false;
    const database = {
      prepare(query) {
        let values = [];
        const execute = () => ({ success: true, meta: { changes: Number(db.prepare(query).run(...values).changes) } });
        return { bind(...bindings) { values = bindings; return this; }, async first() {
          if (failFinalScratchpadRead && query.startsWith('SELECT scratchpad_json FROM extraction_scratchpads') && db.prepare("SELECT count(*) AS n FROM knowledge_workflow_stages WHERE stage_key LIKE 'quiz-point-completed:%' AND status='completed'").get().n === 3) {
            failFinalScratchpadRead = false; finalScratchpadReadFailed = true;
            throw new Error('Constructed final scratchpad read failure.');
          }
          return db.prepare(query).get(...values) ?? null;
        }, async all() { return { success: true, results: db.prepare(query).all(...values) }; }, async run() { return execute(); }, execute };
      },
      async batch(statements) {
        db.exec('BEGIN IMMEDIATE');
        try { const results = statements.map(statement => statement.execute()); db.exec('COMMIT'); return results; }
        catch (error) { db.exec('ROLLBACK'); throw error; }
      },
    };
    const unwrap = result => { assert.equal(result.ok, true, JSON.stringify(result.error)); return result.value; };
    const logger = () => {};
    const clock = () => new Date().toISOString();
    const ownerId = 'failed-unit-fixture-owner', runId = 'failed-unit-fixture-run', sourceId = 'failed-unit-fixture-source', sourceUrl = 'https://example.test/fixture.pdf';
    const repository = new D1KnowledgeWorkflowRepository({ database, logger });
    const materials = new D1KnowledgeWorkflowMaterialRepository({ database, logger });
    const service = createKnowledgeWorkflowService(repository, { now: clock, createId: () => runId, logger });
    const loader = createAgentConfigurationLoader({ sha256: async value => `sha256:${createHash('sha256').update(value).digest('hex')}` });
    const configSnapshots = {};
    for (const role of ['rights-assessor', 'knowledge-scraper', 'question-generator', 'question-evaluator']) configSnapshots[role] = unwrap(await loader.load({ source: (await readFile(new URL(`../agent-config/${role}.yaml`, import.meta.url), 'utf8')).replace(/name: [^\n]+/, `name: synthetic/${role}`), expectedRole: role }));
    const sections = (failureMode==='chunk-bound'||failureMode.startsWith('quiz-')?[1,2,3,4]:[1, 2, 3]).map(number => ({ id: `page-${number}`, title: `Page ${number}`, locator: `page:${number}`, text: `Synthetic distinct relationship ${number}.` }));
    const material = { ownerId, runId, sourceId, sourceRevision: 1, sourceUrl, mediaType: failureMode.startsWith('quiz-invocation-yield')?'text/plain':'application/pdf', fileName: 'offline-fixture.pdf', contentDigest: 'sha256:offline-fixture', sections, media: [], provenance: { kind: 'authorized-user-material', attestationReference: 'offline-fixture', basis: 'test-owned', processingAllowed: true } };
    let run = unwrap(await service.createRun({ ownerId, sourceId, sourceRevision: 1, canonicalSourceIdentity: sourceUrl, contentSignature: material.contentDigest, idempotencyKey: runId, sourceOrigin: 'private-document', configDigests: Object.fromEntries(Object.entries(configSnapshots).map(([role, config]) => [role, config.digest])) })).run;
    unwrap(await materials.persist({ ownerId, runId, materialId: 'failed-unit-fixture-material', idempotencyKey: runId, fingerprint: material.contentDigest, objectKey: 'offline-fixture-only', material, createdAt: clock() }));
    run = unwrap(await service.attachMaterial({ ownerId, runId, materialId: 'failed-unit-fixture-material' }));
    db.prepare('INSERT INTO library_sources (owner_id,source_id,submitted_url,canonical_url,title,description,adapter_json,identity_evidence_json,state,approved_at,updated_at,revision) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(ownerId, sourceId, sourceUrl, sourceUrl, 'Offline failure-isolation fixture', 'Constructed test input', JSON.stringify({ kind: 'private-document' }), '[]', 'active', clock(), clock(), 1);
    let approvedRetry = false,quizStillInvalid=false,replayInterrupted=false;
    let quizInterrupted = false, quizResumed = false, expiredDeadline;
    let modelCalls = 0,classifierCalls=0,classifierPreflights=0,importanceCalls=0,closed=0;
    const classifierBodies=[];
    const extractedPages = [], reviewedPages = [], generatedQuizzes = [],evaluatedQuizzes=[];
    const transport = async (_url, init) => {
      assert(++modelCalls < 80, 'Bound the isolated synthetic fixture.');
      const body = JSON.parse(init.body);
      const message = body.messages[1].content;
      const envelope = Array.isArray(message) ? message[0].text : message;
      const input = JSON.parse(envelope.slice(envelope.indexOf('\n') + 1, envelope.lastIndexOf('\n')));
      const task = input.task ?? input;
      let output;
      if (body.response_format?.json_schema?.name === 'knowledge_batch_selection_v1') {
        output = { keptKnowledgeIds: task.points.map(point => point.id) };
      } else if (body.response_format?.json_schema?.name === 'knowledge_quality_review_v13') {
        reviewedPages.push(task.knowledge.normalizedHash);
        output = syntheticAssessment(task, { decision: 'pass', reasons: ['Constructed supported fixture.'], feedback: 'Constructed acceptance.', matchedLessOftenIds: [], supportingImageEvidence: '', allowTextOnly: true });
        if (failureMode === 'review-output' && !approvedRetry && task.knowledge.normalizedHash === 'page-2') output.audit.version = 999;
      } else if (task.source && task.points) {
        classifierCalls++;classifierBodies.push(body);
        const fail=failureMode.startsWith('classifier')&&!approvedRetry&&(!failureMode.endsWith('success')||classifierCalls<4);
        if(fail&&(failureMode.includes('malformed')||failureMode==='classifier-mixed-success'&&classifierCalls===2))output={mainSubject:'invented',topic:' '};
        else if(fail)return Response.json({error:{message:'Constructed classifier refusal.'}},{status:failureMode==='classifier401'?401:failureMode==='classifier402'?402:503});
        else output = { mainSubject: 'music', topic: 'Synthetic distinct relationships' };
      }
      else if (task.operation === 'plan-authorized-material' || task.operation === 'replan-authorized-material') {
        output = { revision: 1, frontier: [], coverageGoals: [], unresolvedGaps: [], stopDecision: { decision: 'continue', rationale: 'Observe the supplied fixture inventory.', evidenceUrls: [], unresolvedGapIds: [] } };
        if (failureMode === 'material-coverage') {
          output.coverageGoals = [{ id: 'observed', priority: 'high', description: 'Supplied relationships.' }, { id: 'unavailable', priority: 'normal', description: 'Context unavailable in the supplied material.' }];
          output.unresolvedGaps = [{ id: 'unavailable-gap', priority: 'high', description: 'Context unavailable in the supplied material.' }];
        }
        if (failureMode === 'stopped-before-acquisition') db.prepare("UPDATE knowledge_workflow_runs SET state='retryable-failure',revision=revision+1 WHERE owner_id=? AND run_id=?").run(ownerId, runId);
      }
      else if(task.operation==='extract-webpage-facts'){
        const block=task.sourceBlocks[0],id=block.sectionId;extractedPages.push(id);
        if(failureMode.startsWith('quiz-')&&id==='page-4')return Response.json({error:{message:'Constructed page failure.'}},{status:503});
        if(failureMode.startsWith('model')&&!approvedRetry&&id==='page-2')return Response.json({error:{message:'Synthetic provider rejection.'}},{status:Number(failureMode.slice(5))});
        output={notes:'Constructed progress.',candidates:[{summary:block.text,normalizedHash:id,evidenceAnchors:[{reference:block.citationReference,clause:block.text}],coverageGoalIds:failureMode==='material-coverage'?['observed']:[],mediaCandidates:[]}]};
      }else if(task.operation==='normalize-webpage-claim-boundaries'){
        output={notes:task.notes,additionalCandidates:[],reviews:task.candidates.map(candidate=>({sourceNormalizedHash:candidate.normalizedHash,relationshipUnits:syntheticRelationshipUnits([candidate]),candidates:[candidate]})),blockCoverage:task.sourceBlocks.map(block=>({blockId:block.id,disposition:'candidates',candidateHashes:task.candidates.map(c=>c.normalizedHash),reason:'Constructed supported relationship.'}))};
      }else if(task.pairedQuiz){importanceCalls++;output={targets:task.pairedQuiz.canonicalAnswers.map(answer=>({answer,important:true,reason:'Constructed central target.'})),feedback:'Constructed importance approval.'};
      } else if (task.draft) {
        evaluatedQuizzes.push(task.knowledge.id);
        if(failureMode==='quiz-invocation-yield-repair'&&task.knowledge.summary==='Synthetic distinct relationship 1.'&&task.attempt===1)output={score:6,reasons:['Constructed revision required.'],feedback:'Repair the same supported target.',groundingProblems:[],knowledgeGroundingProblems:[]};
        else
        if(failureMode==='quiz-review-resume-success'&&task.knowledge.summary==='Synthetic distinct relationship 2.'&&evaluatedQuizzes.filter(id=>id.includes('page-2')).length===4)output={score:9,reasons:['Constructed recovery.'],feedback:'Constructed acceptance.',groundingProblems:[],knowledgeGroundingProblems:[]};
        else if((!approvedRetry||quizStillInvalid)&&failureMode.startsWith('quiz-review')&&task.knowledge.summary==='Synthetic distinct relationship 2.') {
          if(failureMode==='quiz-review-malformed')output={score:0};
          else return Response.json({error:{message:'Constructed quiz review refusal.'}},{status:failureMode==='quiz-review401'?401:failureMode==='quiz-review402'?402:503});
        }else output = { score: 9, reasons: ['Constructed fixture.'], feedback: 'Constructed acceptance.', groundingProblems: [], knowledgeGroundingProblems: [] };
      }
      else if (task.knowledge) {
        generatedQuizzes.push(task.knowledge.normalizedHash);
        if(!approvedRetry&&failureMode==='quiz-generator503'&&task.knowledge.normalizedHash==='page-2')return Response.json({error:{message:'Constructed quiz generation refusal.'}},{status:503});
        output = { knowledgeId: task.knowledge.id, knowledgeRevision: task.knowledge.sourceRevision, canonicalAnswers: ['fixture'], citedEvidenceUrls: task.knowledge.evidenceAnchors.map(anchor => anchor.url), multipleChoice: { prompt: `Which fixture belongs to ${task.knowledge.normalizedHash}?`, options: [{ key: 'choice-a', text: 'Fixture' }, { key: 'choice-b', text: 'Other' }], correctOptionKeys: ['choice-a'], correctOptionAnswers: [{ key: 'choice-a', canonicalAnswer: 'fixture' }], explanation: 'Fixture is supported by the source.' }, fillBlank: { prompt: 'The supported answer is ____.', blanks: [{ id: 'blank-1', canonicalAnswer: 'fixture', acceptedAnswers: ['fixture'] }], explanation: 'Fixture is supported by the source.' } };
      } else assert.fail('Unexpected synthetic task.');
      return Response.json({ id: `offline-fixture-${modelCalls}`, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(output) } }], usage: { prompt_tokens: 100, completion_tokens: 100 } });
    };
    const forbidden = async () => assert.fail('Offline uploaded material must not scrape webpages.');
    const runtime = () => createKnowledgeWorkflowRuntime({
      imagePolicy: WEBPAGE_IMAGE_POLICY, technicalRetries: failureMode === 'classifier-bounded' ? false : undefined,
      preflightModelWork: (_role, scope) => {
        if (['review-output', 'model503', 'model200'].includes(failureMode) && !approvedRetry && !quizInterrupted && scope.stageKey.startsWith('question-evaluator:quiz-evaluator-') && scope.stageKey.includes('page-3')) {
          quizInterrupted = true;
          const error = new AgentExecutionBoundaryFailure({ kind: 'EvaluationCancelled' });
          error.notStarted = true;
          throw error;
        }
        if (failureMode === 'quiz-review-resume-success' && !replayInterrupted && scope.stageKey.startsWith('question-evaluator:quiz-evaluator-') && scope.stageKey.includes('page-2') && evaluatedQuizzes.filter(id => id.includes('page-2')).length === 2) {
          replayInterrupted = true;
          const error = new AgentExecutionBoundaryFailure({ kind: 'EvaluationCancelled' });
          error.notStarted = true;
          throw error;
        }
        if (scope.stageKey.startsWith('source-classifier:')) {
          classifierPreflights++;
          if (failureMode === 'classifier-critical') {
            const error = new AgentExecutionBoundaryFailure({ kind: 'EvaluationBudgetExceeded' });
            error.notStarted = true;
            throw error;
          }
        }
      },
      database, fetch: transport, browser: { readPage: forbidden, readRobots: forbidden, screenshot: forbidden, close: async () => {closed++;return { ok: true, value: null };} },
      apiKey: 'offline-fixture-only', endpoint: 'https://example.test/model', now: clock, nowMs: Date.now, logger, configSnapshots, material: materials,
      imageSearch: { search: forbidden }, fallbackManifest: { entries: [], resolve: forbidden },
      transition: async ({ run: current, nextState, ...rest }) => {
        const result = await service.advance({ ownerId, runId, expectedRevision: current.revision, nextState, ...rest });
        if (result.ok && failureMode === 'expired-quiz-clock' && nextState === 'per-point-quiz-loop' && expiredDeadline === undefined) {
          expiredDeadline = new Date(Date.now() - 1000).toISOString();
          const expired = { ...result.value, extractionDeadlineAt: expiredDeadline };
          db.prepare('UPDATE knowledge_workflow_runs SET extraction_deadline_at=?,run_json=? WHERE owner_id=? AND run_id=?').run(expiredDeadline, JSON.stringify(expired), ownerId, runId);
          return { ok: true, value: expired };
        }
        return result;
      },
    });
    const finish = async () => {
      for (let step = 0; step < 8 && run.state !== 'completed'; step++) {
        if (run.state === 'awaiting-time-limit-decision') run = unwrap(await service.control({ ownerId, runId, expectedRevision: run.revision, action: 'resume', idempotencyKey: `fixture-chunk-${run.revision}` }));
        const executed = await runtime().execute(run);
        if (quizInterrupted && !quizResumed) {
          assert.equal(executed.ok, false);
          assert.equal(executed.error.detailKind, 'QuizGenerationRejected');
          run = unwrap(await repository.findById(ownerId, runId));
          assert.equal(run.state, 'per-point-quiz-loop');
          assert.equal(db.prepare("SELECT count(*) AS n FROM knowledge_workflow_stages WHERE stage_key LIKE 'quiz-point-completed:%' AND status='completed'").get().n, 1);
          const previousCalls = modelCalls, counts = {...run.counts}, started = run.extractionStartedAt, deadline = run.extractionDeadlineAt;
          const previousQuizzes = db.prepare('SELECT quiz_id,draft_json,status FROM knowledge_workflow_quizzes ORDER BY quiz_id').all();
          const publication=db.prepare('SELECT knowledge_id,attempt_number FROM knowledge_workflow_quizzes LIMIT 1').get();
          db.prepare('UPDATE knowledge_workflow_quizzes SET attempt_number=2 WHERE knowledge_id=?').run(publication.knowledge_id);
          const inconsistent=await runtime().execute(run);
          assert.equal(inconsistent.ok,false,'Bulk checkpoint verification must reject a mismatched publication.');
          assert.equal(inconsistent.error.detailKind,'WorkflowStagePersistenceFailed');
          assert.equal(modelCalls,previousCalls,'A corrupt publication cannot dispatch another model.');
          db.prepare('UPDATE knowledge_workflow_quizzes SET attempt_number=? WHERE knowledge_id=?').run(publication.attempt_number,publication.knowledge_id);
          run = unwrap(await service.advance({ownerId,runId,expectedRevision:run.revision,nextState:'retryable-failure',failureKind:'WorkflowCpuTimeLimitExceeded'}));
          assert.equal(run.retryState,'per-point-quiz-loop');
          run = unwrap(await service.control({ownerId,runId,expectedRevision:run.revision,action:'resume',idempotencyKey:'fixture-resume-quiz-after-cpu'}));
          assert.equal(run.failureKind,null,'Quiz resume clears its temporary interruption error.');
          assert.equal(run.state,'per-point-quiz-loop');
          assert.deepEqual(run.counts,counts);
          assert.equal(run.extractionStartedAt,started);
          assert.equal(run.extractionDeadlineAt,deadline);
          assert.equal(modelCalls,previousCalls);
          assert.deepEqual(db.prepare('SELECT quiz_id,draft_json,status FROM knowledge_workflow_quizzes ORDER BY quiz_id').all(),previousQuizzes);
          quizResumed = true;
          continue;
        }
        if (!executed.ok && finalScratchpadReadFailed) {
          assert.equal(executed.error.kind,'WorkflowTransitionFailed');
          assert.equal(executed.error.detailKind,'ScratchpadPersistenceFailed');
          run = unwrap(await repository.findById(ownerId,runId));
          assert.equal(run.state,'per-point-quiz-loop','An unreadable failure checkpoint cannot falsely complete the source.');
          const callsBeforeReplay = modelCalls;
          unwrap(await runtime().execute(run));
          assert.equal(modelCalls,callsBeforeReplay,'Final-transition recovery reuses completed quiz checkpoints without provider replay.');
        } else unwrap(executed);
        run = unwrap(await repository.findById(ownerId, runId));
      }
      assert.equal(run.state, 'completed');
    };
    if(failureMode.startsWith('quiz-invocation-yield')){
      const stamp=clock();
      db.prepare("INSERT INTO knowledge_workflow_stages (owner_id,run_id,stage_key,input_digest,status,result_json,created_at,completed_at) VALUES (?,?,?,?,'completed',?,?,?)").run(ownerId,runId,'workflow-cpu-backpressure:v1','workflow-cpu-backpressure:v1',JSON.stringify({ok:true,value:null}),stamp,stamp);
      let yields=0,invocations=0;
      for(;invocations<24&&run.state!=='completed';invocations++){
        if(run.state==='awaiting-time-limit-decision')run=unwrap(await service.control({ownerId,runId,expectedRevision:run.revision,action:'resume',idempotencyKey:`yield-fixture-${run.revision}`}));
        const before=generatedQuizzes.length+evaluatedQuizzes.length+importanceCalls,closes=closed;
        const result=await runtime().execute(run);
        assert(generatedQuizzes.length+evaluatedQuizzes.length+importanceCalls-before<=1,'At CPU width one, a fresh invocation admits at most one quiz model stage.');
        assert.equal(closed,closes+1,'Cooperative yield still closes browser resources.');
        run=unwrap(await repository.findById(ownerId,runId));
        if(!result.ok){assert.equal(result.error.detailKind,'WorkflowInvocationYield',JSON.stringify({invocations,runState:run.state,generatedQuizzes,extractedPages,error:result.error}));yields++;assert.equal(run.failureKind,null);}
        assert.deepEqual(unwrap(await readFailedQuizItems(database,run)),[],'Yield does not exhaust a quiz attempt.');
      }
      assert.equal(run.state,'completed');assert(yields>=6);assert.equal(run.counts.acceptedQuizzes,3);
      const repaired=failureMode.endsWith('-repair');
      assert.deepEqual(generatedQuizzes.toSorted(),repaired?['page-1','page-1','page-2','page-3']:['page-1','page-2','page-3']);assert.equal(importanceCalls,repaired?4:3);assert.equal(evaluatedQuizzes.length,repaired?4:3);
      assert(db.prepare('SELECT knowledge_id,attempt_number FROM knowledge_workflow_quizzes').all().every(row=>row.attempt_number===(repaired&&row.knowledge_id.endsWith('page-1')?2:1)),'Only a real quality rejection advances the quality attempt.');
      assert.equal(db.prepare("SELECT count(*) AS n FROM knowledge_workflow_stages WHERE provider_failures>0 AND stage_key LIKE 'question-%quiz-%'").get().n,0);
      const before=modelCalls;unwrap(await runtime().execute(run));assert.equal(modelCalls,before);return;
    }
    if(failureMode==='expired-quiz-clock'){
      for(let step=0;step<8&&run.state!=='completed';step++){
        if(run.state==='awaiting-time-limit-decision')run=unwrap(await service.advance({ownerId,runId,expectedRevision:run.revision,nextState:'extraction-loop'}));
        unwrap(await runtime().execute(run));run=unwrap(await repository.findById(ownerId,runId));
      }
      assert(expiredDeadline);assert.equal(run.state,'completed');assert.equal(run.extractionDeadlineAt,expiredDeadline);assert.equal(run.counts.acceptedQuizzes,3);
      assert.deepEqual(generatedQuizzes.toSorted(),['page-1','page-2','page-3']);assert.equal(evaluatedQuizzes.length,3);assert.equal(db.prepare("SELECT count(*) AS n FROM knowledge_workflow_quizzes WHERE status='published'").get().n,3);return;
    }
    if (failureMode === 'stopped-before-acquisition') {
      const executed = await runtime().execute(run);
      assert.equal(executed.ok, false);
      assert.equal(executed.error.detailKind, 'WorkflowProcessingStopped');
      assert.equal(modelCalls, 1, 'A stopped callback cannot start another provider request.');
      assert.deepEqual(extractedPages, []);
      assert.deepEqual(reviewedPages, []);
      assert.deepEqual(generatedQuizzes, []);
      assert.equal(db.prepare('SELECT count(*) AS n FROM extraction_knowledge_points').get().n, 0);
      return;
    }
    if (failureMode === 'model401') {
      let executed;
      for(let step=0;step<3;step++) {
        if(run.state==='awaiting-time-limit-decision')run=unwrap(await service.control({ownerId,runId,expectedRevision:run.revision,action:'resume',idempotencyKey:`fixture-auth-chunk-${run.revision}`}));
        executed=await runtime().execute(run);
        if(!executed.ok)break;
        run=unwrap(await repository.findById(ownerId,runId));
      }
      assert(executed);
      assert.equal(executed.ok, false, 'Credential rejection must stop the workflow.');
      assert.deepEqual(extractedPages, ['page-1', 'page-2']);
      assert.deepEqual(reviewedPages, ['page-1']);
      assert.deepEqual(generatedQuizzes, []);
      const saved = JSON.parse(db.prepare('SELECT scratchpad_json FROM extraction_scratchpads WHERE owner_id=? AND run_id=?').get(ownerId, runId).scratchpad_json);
      assert.deepEqual(saved.failedPages ?? [], []);
      assert.equal(saved.acceptedHashes.length, 1);
      return;
    }
    if(failureMode.startsWith('classifier')) {
      let executed;
      for(let step=0;step<8&&run.state!=='completed';step++){
        if(run.state==='awaiting-time-limit-decision')run=unwrap(await service.control({ownerId,runId,expectedRevision:run.revision,action:'resume',idempotencyKey:`classification-chunk-${run.revision}`}));
        executed=await runtime().execute(run);run=unwrap(await repository.findById(ownerId,runId));if(!executed.ok)break;
      }
      const success=failureMode.endsWith('success');
      assert.equal(executed.ok,success,JSON.stringify(executed));
      const expected=failureMode==='classifier-critical'?0:failureMode==='classifier401'||failureMode==='classifier402'||failureMode==='classifier-bounded'?1:4;
      if(failureMode==='classifier402')assert.equal(executed.error.detailKind,'KnowledgeModelPaymentRequired');
      assert.equal(classifierCalls,expected);assert.equal(classifierPreflights,failureMode==='classifier-critical'?1:expected);
      assert.equal(db.prepare('SELECT count(*) AS n FROM extraction_knowledge_points').get().n,3);
      assert.equal(db.prepare("SELECT count(*) AS n FROM library_sources WHERE state='active'").get().n,1);
      assert.equal(run.state,success?'completed':'per-point-quiz-loop');
      const keys=db.prepare("SELECT stage_key,result_json,status,provider_failures FROM knowledge_workflow_stages WHERE stage_key LIKE 'source-classifier:%' ORDER BY stage_key").all();
      assert.equal(keys.length,failureMode==='classifier-critical'?1:expected);
      if(expected===4)for(const attempt of [2,3,4])assert(keys.some(row=>row.stage_key.includes(`:technical-${attempt}:`)));
      assert.equal(keys.filter(row=>!row.stage_key.includes(':technical-')).length,1,'Initial durable identity is unchanged.');
      if(failureMode.includes('malformed')) {
        assert.equal(classifierBodies[0].messages[0].content.includes('previous response failed output validation'),false);
        assert(classifierBodies[1].messages[0].content.includes('previous response failed output validation'));
        for(const body of classifierBodies.slice(1))assert.deepEqual(body.messages[1],classifierBodies[0].messages[1],'Schema repair preserves the entire original point set.');
      }
      if(failureMode==='classifier-mixed-success'){assert.equal(classifierBodies[1].messages[0].content.includes('previous response failed output validation'),false);assert(classifierBodies[2].messages[0].content.includes('previous response failed output validation'));}
      if(!success){if(failureMode!=='classifier401'){const before=modelCalls,repeated=await runtime().execute(run);assert.equal(repeated.ok,false);assert.equal(repeated.error.detailKind,executed.error.detailKind,'Cached refusals preserve the original typed classification failure.');assert.equal(modelCalls,before,'Replaying an exhausted or critical classification cannot multiply provider attempts.');}assert.equal(generatedQuizzes.length,0);assert.equal(executed.error.detailKind,failureMode==='classifier-critical'?'EvaluationBudgetExceeded':failureMode.includes('malformed')?'SourceClassificationOutputInvalid':failureMode==='classifier402'?'KnowledgeModelPaymentRequired':'KnowledgeModelRejected');}
      else {assert.equal(run.counts.acceptedQuizzes,3);const before=modelCalls;unwrap(await runtime().execute(run));assert.equal(modelCalls,before);}
      if(failureMode==='classifier402'){
        const original=db.prepare("SELECT * FROM knowledge_workflow_stages WHERE stage_key LIKE 'source-classifier:%'").get();
        await new Promise(resolve=>setTimeout(resolve,5));
        run=unwrap(await service.advance({ownerId,runId,expectedRevision:run.revision,nextState:'retryable-failure',failureKind:'KnowledgeModelPaymentRequired'}));
        run=unwrap(await service.control({ownerId,runId,expectedRevision:run.revision,action:'resume',idempotencyKey:'classification-billing-repaired'}));approvedRetry=true;
        await finish();assert.equal(run.state,'completed');assert.equal(run.counts.acceptedQuizzes,3);assert.equal(classifierCalls,2);
        assert.deepEqual(db.prepare('SELECT * FROM knowledge_workflow_stages WHERE stage_key=?').get(original.stage_key),original);
      }
      return;
    }
    if(failureMode==='quiz-review-resume-success'){
      let stopped;
      for(let n=0;n<8;n++){if(run.state==='awaiting-time-limit-decision')run=unwrap(await service.control({ownerId,runId,expectedRevision:run.revision,action:'resume',idempotencyKey:`interruption-chunk-${n}`}));stopped=await runtime().execute(run);run=unwrap(await repository.findById(ownerId,runId));if(!stopped.ok)break;}
      assert.equal(stopped.ok,false);assert.equal(replayInterrupted,true);assert.equal(evaluatedQuizzes.filter(id=>id.includes('page-2')).length,2);
      const refused=db.prepare("SELECT * FROM knowledge_workflow_stages WHERE stage_key LIKE 'question-evaluator:quiz-evaluator-%page-2%' AND provider_failures=1 ORDER BY stage_key").all();assert.equal(refused.length,2);
      const unstarted=db.prepare("SELECT * FROM knowledge_workflow_stages WHERE stage_key LIKE 'question-evaluator:quiz-evaluator-%page-2%technical-3:%'").get();assert.equal(unstarted.status,'not-started');assert.equal(unstarted.provider_failures,0);
      run=unwrap(await service.advance({ownerId,runId,expectedRevision:run.revision,nextState:'retryable-failure',failureKind:'EvaluationCancelled'}));
      run=unwrap(await service.control({ownerId,runId,expectedRevision:run.revision,action:'resume',idempotencyKey:'recreate-runtime-after-two-refusals'}));
      await finish();
      assert.equal(run.counts.acceptedQuizzes,3);assert.equal(run.failureKind,'WorkflowPagesFailed');assert.equal(evaluatedQuizzes.filter(id=>id.includes('page-2')).length,4,'Runtime recreation must reuse two refused attempts and dispatch only the remaining two.');
      assert.deepEqual(unwrap(await readFailedQuizItems(database,run)),[]);
      for(const row of refused)assert.deepEqual(db.prepare('SELECT * FROM knowledge_workflow_stages WHERE stage_key=?').get(row.stage_key),row,'Cached refusal history remains immutable.');
      const completed=db.prepare("SELECT count(*) AS n FROM knowledge_workflow_stages WHERE stage_key LIKE 'question-evaluator:quiz-evaluator-%page-2%'").get().n;assert.equal(completed,4);
      const before=modelCalls;unwrap(await runtime().execute(run));assert.equal(modelCalls,before);
      return;
    }
    if(failureMode.startsWith('quiz-')) {
      if(failureMode==='quiz-review401'||failureMode==='quiz-review402') {
        let result;
        for(let n=0;n<8;n++){if(run.state==='awaiting-time-limit-decision')run=unwrap(await service.control({ownerId,runId,expectedRevision:run.revision,action:'resume',idempotencyKey:`auth-${n}`}));result=await runtime().execute(run);run=unwrap(await repository.findById(ownerId,runId));if(!result.ok)break;}
        assert.equal(result.ok,false);assert.equal(result.error.detailKind,failureMode==='quiz-review402'?'KnowledgeModelPaymentRequired':'KnowledgeModelRejected');
        assert.equal(evaluatedQuizzes.filter(id=>id.includes('page-2')).length,1);
        assert.deepEqual(unwrap(await readFailedQuizItems(database,run)),[]);
        assert.equal(run.state,'per-point-quiz-loop');
        assert.equal(db.prepare('SELECT count(*) AS n FROM extraction_knowledge_points').get().n,3);
        if(failureMode==='quiz-review402'){
          const row=db.prepare("SELECT * FROM knowledge_workflow_stages WHERE json_extract(result_json,'$.error.status')=402").get();assert.equal(row.status,'completed');
          const legacy=db.prepare('SELECT * FROM knowledge_workflow_stages WHERE stage_key=?').get(row.stage_key),before=modelCalls;
          result=await runtime().execute(run);assert.equal(result.error.detailKind,'KnowledgeModelPaymentRequired');assert.equal(modelCalls,before,'Cached billing refusal cannot dispatch before owner recovery');
          await new Promise(resolve=>setTimeout(resolve,5));
          run=unwrap(await service.advance({ownerId,runId,expectedRevision:run.revision,nextState:'retryable-failure',failureKind:'KnowledgeModelPaymentRequired'}));
          run=unwrap(await service.control({ownerId,runId,expectedRevision:run.revision,action:'resume',idempotencyKey:'billing-repaired'}));approvedRetry=true;
          await finish();assert.equal(run.state,'completed');assert.equal(run.counts.acceptedQuizzes,3);
          assert.deepEqual(db.prepare('SELECT * FROM knowledge_workflow_stages WHERE stage_key=?').get(row.stage_key),legacy,'Legacy billing refusal history remains immutable');
        }
        return;
      }
      await finish();
      assert.equal(run.failureKind,'WorkflowQuizItemsFailed');
      assert.equal(run.counts.acceptedQuizzes,2);assert.equal(run.counts.knowledgePoints,3);
      assert(generatedQuizzes.includes('page-3'), 'Healthy tail must run while the middle item exhausts technical retries.');
      assert(db.prepare("SELECT knowledge_id FROM knowledge_workflow_quizzes WHERE knowledge_id LIKE '%page-3%' AND status='published'").get(), 'Healthy tail must publish despite its failed peer.');
      const failed=unwrap(await readFailedQuizItems(database,run));assert.equal(failed.length,1);assert.equal(failed[0].attempts,4);assert.equal(failed[0].generation,0);
      const failedId=failed[0].knowledgeId;assert(failedId.includes('page-2'));
      const failedKey=`quiz-point-failed:${failedId}:0`,originalFailure=db.prepare('SELECT result_json FROM knowledge_workflow_stages WHERE stage_key=?').get(failedKey).result_json;
      const corrupt=JSON.parse(originalFailure);corrupt.value.attempts=3;
      db.prepare('UPDATE knowledge_workflow_stages SET result_json=? WHERE stage_key=?').run(JSON.stringify(corrupt),failedKey);
      assert.equal((await readFailedQuizItems(database,run)).error.kind,'WorkflowStagePersistenceFailed','An invalid durable deferral cannot skip a knowledge point.');
      db.prepare('UPDATE knowledge_workflow_stages SET result_json=? WHERE stage_key=?').run(originalFailure,failedKey);
      const progress=unwrap(await new D1KnowledgeWorkflowProgressRepository({database,logger}).read(run));
      assert.equal(progress.failedItems.length,1);assert.equal(progress.failedQuizItems.length,1);assert.equal(progress.failedQuizItems[0].knowledgeId,failedId);
      const snapshot=()=>db.prepare('SELECT knowledge_id,point_json FROM extraction_knowledge_points ORDER BY knowledge_id').all();
      const oldPoints=snapshot(),oldPublications=db.prepare('SELECT * FROM knowledge_workflow_quizzes ORDER BY knowledge_id').all();
      const childStages=db.prepare("SELECT stage_key,status,result_json,failures_json FROM knowledge_workflow_stages WHERE stage_key LIKE 'question-%' ORDER BY stage_key").all();
      const before=modelCalls,oldPages=[...extractedPages],oldReviews=[...reviewedPages],oldGenerators=[...generatedQuizzes];
      unwrap(await runtime().execute(run));assert.equal(modelCalls,before,'Completed partial replay cannot automatically retry.');
      if(failureMode==='quiz-review503') {
        const draft=db.prepare("SELECT stage_key,result_json FROM knowledge_workflow_stages WHERE stage_key LIKE 'quiz-draft-ready:%' AND json_extract(result_json,'$.value.knowledgeId')=?").get(failedId);
        assert(draft,'The failed review retains its successfully generated draft.');
        db.prepare('DELETE FROM knowledge_workflow_stages WHERE stage_key=?').run(draft.stage_key);
      }
      approvedRetry=true;
      const started=run.extractionStartedAt,deadline=run.extractionDeadlineAt;
      run=unwrap(await service.control({ownerId,runId,expectedRevision:run.revision,action:'retry-quizzes',idempotencyKey:'approved-quiz-only'}));
      let generation=run.quizRetryGeneration;assert.equal(generation,run.revision);assert.equal(run.state,'per-point-quiz-loop');
      assert.equal(run.extractionStartedAt,started);assert.equal(run.extractionDeadlineAt,deadline);
      if(failureMode==='quiz-review-malformed'){
        quizStillInvalid=true;const callsBefore=modelCalls,evaluationsBefore=evaluatedQuizzes.length;
        await finish();assert.equal(run.failureKind,'WorkflowQuizItemsFailed');assert.equal(run.counts.acceptedQuizzes,2);
        assert.equal(evaluatedQuizzes.length-evaluationsBefore,4,'Explicit quiz approval grants exactly four technical critic attempts.');assert.equal(modelCalls-callsBefore,8,'Each critic attempt includes its separate answer-importance review.');
        const failedAgain=unwrap(await readFailedQuizItems(database,run));assert.equal(failedAgain[0].generation,generation);assert.equal(failedAgain[0].attempts,4);
        const noAuto=modelCalls;unwrap(await runtime().execute(run));assert.equal(modelCalls,noAuto);
        quizStillInvalid=false;
        run=unwrap(await service.control({ownerId,runId,expectedRevision:run.revision,action:'retry-quizzes',idempotencyKey:'second-approved-quiz-only'}));
        assert(run.quizRetryGeneration>generation);generation=run.quizRetryGeneration;
      }
      await finish();
      assert.equal(run.failureKind,'WorkflowPagesFailed','Separate failed source page remains pending its own approval.');
      assert.equal(run.counts.acceptedQuizzes,3);assert.deepEqual(unwrap(await readFailedQuizItems(database,run)),[]);
      assert.deepEqual(extractedPages,oldPages,'Quiz-only approval must not re-extract any material.');assert.deepEqual(reviewedPages,oldReviews);
      assert.deepEqual(snapshot(),oldPoints);for(const row of oldPublications)assert.deepEqual(db.prepare('SELECT * FROM knowledge_workflow_quizzes WHERE knowledge_id=?').get(row.knowledge_id),row);
      for(const row of childStages)assert.deepEqual(db.prepare('SELECT stage_key,status,result_json,failures_json FROM knowledge_workflow_stages WHERE stage_key=?').get(row.stage_key),row,'Original paid stage claims and outcomes remain immutable.');
      if(failureMode==='quiz-generator503')assert.deepEqual(generatedQuizzes,[...oldGenerators,'page-2']);else assert.deepEqual(generatedQuizzes,oldGenerators,'Review retry reuses the valid generated draft.');
      const retryStages=db.prepare("SELECT stage_key FROM knowledge_workflow_stages WHERE stage_key LIKE ?").all(`%quiz-retry-${generation}%`).map(row=>row.stage_key);
      assert(retryStages.some(key=>key.startsWith(failureMode==='quiz-generator503'?'question-generator:':'question-evaluator:')));
      assert(retryStages.every(key=>!key.includes('page-1')&&!key.includes('page-3')));
      const finalProgress=unwrap(await new D1KnowledgeWorkflowProgressRepository({database,logger}).read(run));assert.equal(finalProgress.failedQuizItems,undefined);assert.equal(finalProgress.failedItems.length,1);
      return;
    }
    if (failureMode === 'chunk-bound') {
      let previous=0, chunks=0;
      for(let step=0;step<10&&run.state!=='completed';step++){
        if(run.state==='awaiting-time-limit-decision')run=unwrap(await service.control({ownerId,runId,expectedRevision:run.revision,action:'resume',idempotencyKey:'chunk-bound-'+step}));
        unwrap(await runtime().execute(run));run=unwrap(await repository.findById(ownerId,runId));
        const admitted=generatedQuizzes.length-previous;
        assert(admitted<=3,'A durable step must not refill past its initial three quiz jobs even with immediate responses.');
        if(admitted)chunks++;
        previous=generatedQuizzes.length;
      }
      assert.equal(run.state,'completed');assert.equal(run.failureKind,null);assert.equal(run.counts.acceptedQuizzes,4);assert.equal(chunks,2);
      assert.deepEqual(generatedQuizzes.toSorted(),['page-1','page-2','page-3','page-4']);
      return;
    }
    if (failureMode === 'material-coverage') {
      await finish();
      assert.equal(run.failureKind, null);
      assert.equal(run.counts.pages, 3);
      assert.equal(run.counts.acceptedQuizzes, 3);
      const saved = JSON.parse(db.prepare('SELECT scratchpad_json FROM extraction_scratchpads WHERE owner_id=? AND run_id=?').get(ownerId, runId).scratchpad_json);
      assert.deepEqual(saved.coverage, ['observed'], 'Unavailable goals cannot fabricate coverage.');
      assert.deepEqual(saved.planCheckpoint.plan.coverageGoals.map(goal => goal.id), ['observed']);
      assert.deepEqual(saved.planCheckpoint.orderedUrls, sections.map(section => `${sourceUrl}#section=${section.id}`));
      assert.deepEqual(saved.planCheckpoint.plan.unresolvedGaps, []);
      return;
    }
    await finish();
    assert.equal(quizInterrupted,true,'The partial run exercised interruption/resume after a committed paired quiz.');
    assert.equal(run.failureKind, 'WorkflowPagesFailed');
    const initialAcquisitions = failureMode.startsWith('model') ? ['page-1', ...Array(4).fill('page-2'), 'page-3'] : ['page-1', 'page-2', 'page-3'];
    const initialCritiques = failureMode.startsWith('model') ? ['page-1', 'page-3'] : ['page-1', ...Array(4).fill('page-2'), 'page-3'];
    assert.deepEqual(extractedPages, initialAcquisitions);
    assert.deepEqual(reviewedPages, initialCritiques);
    assert.deepEqual(generatedQuizzes.toSorted(), ['page-1', 'page-3']);
    assert.equal(run.counts.pages, 2);
    assert.equal(run.counts.knowledgePoints, 2);
    assert.equal(run.counts.acceptedQuizzes, 2);
    const scratchpad = () => JSON.parse(db.prepare('SELECT scratchpad_json FROM extraction_scratchpads WHERE owner_id=? AND run_id=?').get(ownerId, runId).scratchpad_json);
    const failedUrl = scratchpad().failedPages[0].url;
    assert.equal(scratchpad().failedPages[0].attempts, 4);
    const quizRows = () => db.prepare('SELECT quiz_id,draft_json,status FROM knowledge_workflow_quizzes WHERE owner_id=? AND run_id=? ORDER BY quiz_id').all(ownerId, runId);
    const retainedQuizzes = quizRows();
    assert.equal(retainedQuizzes.length, 2);
    for (const row of retainedQuizzes) {
      assert.equal(row.status, 'published');
      const pair = JSON.parse(row.draft_json).pairedQuiz;
      assert(pair.multipleChoice.options.length > 0);
      assert(pair.fillBlank.blanks.length > 0);
    }
    const retainedRows = db.prepare('SELECT knowledge_id,point_json FROM extraction_knowledge_points WHERE owner_id=? AND run_id=? ORDER BY knowledge_id').all(ownerId, runId);
    const beforeReplay = modelCalls;
    unwrap(await runtime().execute(run));
    assert.equal(modelCalls, beforeReplay, 'Completed partial run must not automatically retry.');
    approvedRetry = true;
    run = unwrap(await service.control({ ownerId, runId, expectedRevision: run.revision, action: 'resume', idempotencyKey: 'fixture-approved-failed-only' }));
    const generation = run.revision;
    assert.equal(run.failureKind, 'WorkflowRetryFailedPages');
    failFinalScratchpadRead = failureMode === 'review-output';
    await finish();
    assert.equal(finalScratchpadReadFailed,failureMode === 'review-output');
    assert.equal(run.failureKind, null);
    assert.deepEqual(extractedPages, [...initialAcquisitions, 'page-2']);
    assert.deepEqual(reviewedPages, [...initialCritiques, 'page-2']);
    assert.deepEqual(generatedQuizzes.toSorted(), ['page-1', 'page-2', 'page-3']);
    assert.equal(run.counts.pages, 3);
    assert.equal(run.counts.knowledgePoints, 3);
    assert.equal(run.counts.acceptedQuizzes, 3);
    assert.equal(quizRows().length, 3);
    for (const row of retainedQuizzes) assert.deepEqual(quizRows().find(current => current.quiz_id === row.quiz_id), row);
    assert.deepEqual(scratchpad().failedPages, []);
    assert.equal(scratchpad().retryGeneration, generation);
    assert.equal(scratchpad().retryingFailedPages, false);
    assert(scratchpad().processedUrls.includes(failedUrl));
    for (const row of retainedRows) assert.deepEqual(db.prepare('SELECT knowledge_id,point_json FROM extraction_knowledge_points WHERE owner_id=? AND run_id=? AND knowledge_id=?').get(ownerId, runId, row.knowledge_id), row);
    const stages = db.prepare('SELECT stage_key FROM knowledge_workflow_stages WHERE owner_id=? AND run_id=?').all(ownerId, runId).map(row => row.stage_key);
    if (failureMode.startsWith('model')) {
      // Technical transport retries share one four-call budget.
      const refusals = stages.filter(key => key.startsWith('knowledge-scraper:scraper-material-batch-page-2') && !key.includes(`-retry-${generation}`));
      assert.equal(refusals.length, 4);
      for (const attempt of [2,3,4]) assert(refusals.some(key => key.includes(`scraper-material-batch-page-2:text:page-2:coverage-v1:1:technical-${attempt}:`)));
    }
    assert(stages.some(key => key.includes(`scraper-material-batch-page-2-retry-${generation}:text:page-2:coverage-v1:1:`)), 'Approved acquisition uses a new durable generation.');
    assert(stages.some(key => key.includes(`knowledge-quality-knowledge:${sourceId}:1:page-2-1-retry-${generation}:`)), 'Approved critique uses a new durable generation.');
    assert(!stages.some(key => /scraper-material-batch-page-[13]-retry-/u.test(key)), 'Healthy pages never acquire a retry generation.');
  } finally { db.close(); }
});

}

test('transient stage reads retry three times without repeating model work; exhaustion is explicit', async()=>{
 const {D1WorkflowStageRepository}=await import('../worker/knowledge-workflow-stages-d1.js');
 for(const failCount of [3,4]) {
  let reads=0,writes=0,work=0;
  const events=[];
  const database={prepare(query){return {bind(){return this;},async first(){if(query.startsWith('SELECT state')){if(++reads<=failCount)throw new Error('Network connection lost: constructed transient read');return {state:'per-point-quiz-loop'};}return {created_at:'2026-10-15T00:00:00Z'};},async run(){writes++;return {success:true,meta:{changes:1}};},async all(){return {success:true,results:[]};}};},async batch(){return [];}};
  const stages=new D1WorkflowStageRepository({database,now:()=> '2026-10-15T00:00:00Z',logger:e=>events.push(e)});
  const result=await stages.run({ownerId:'fixture-owner',runId:'fixture-run'},'question-evaluator:fixture','fixture-digest',async()=>{work++;return {ok:true,value:{accepted:true}};},{modelCall:true});
  assert.equal(reads,4);assert.equal(result.ok,failCount===3);assert.equal(work,failCount===3?1:0);assert.equal(writes,failCount===3?2:0);
  assert.equal(events.filter(e=>e.event==='workflow-database-read-retry').length,3);
  if(!result.ok)assert.equal(result.error.kind,'WorkflowStagePersistenceFailed');
 }
});

 test('only an exhausted four-attempt quiz technical failure is unit-local',()=>{
  for(const causeKind of ['AgentLedgerPersistenceFailed','WorkflowStagePersistenceFailed','KnowledgeModelCredentialMissing','EvaluationBudgetExceeded','UsageAccountingInvalid','WorkflowStageOutcomeUnknown','AgentExecutionBoundaryFailure','WorkflowProcessingStopped'])assert.equal(exhaustedQuizTechnicalFailure({kind:'WorkflowStageCallUncertain',causeKind,technicalRetriesExhausted:true,technicalAttempts:4}),false);
  assert.equal(exhaustedQuizTechnicalFailure({kind:'WorkflowStageCallUncertain'}),false);
  assert.equal(exhaustedQuizTechnicalFailure({kind:'WorkflowStageCallUncertain',technicalRetriesExhausted:true,technicalAttempts:3}),false);
  assert.equal(exhaustedQuizTechnicalFailure({kind:'KnowledgeModelRejected',status:401,technicalRetriesExhausted:true,technicalAttempts:4}),false);
  assert.equal(exhaustedQuizTechnicalFailure({kind:'KnowledgeModelRejected',status:503,technicalRetriesExhausted:true,technicalAttempts:4}),true);
 });
