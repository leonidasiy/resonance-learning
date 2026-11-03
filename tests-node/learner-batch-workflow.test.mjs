import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { createLearningBatchService } from '../worker/learning-batches-d1.js';
import { createJevAnswerGrader, JEV_GRADER_CONFIGURATION } from '../worker/jev-answer-grader.js';

function fixture(count = 8, random = () => 0.3) {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync('worker/migrations').filter(file => file.endsWith('.sql')).sort()) db.exec(readFileSync(`worker/migrations/${file}`, 'utf8'));
  let clock = '2026-10-18T00:00:00.000Z', probability = 0.7, unavailable = false;
  const gradingRequests = [];
  let beforeGrade = async () => {}, skipUnavailable = false;
  const grader = createJevAnswerGrader({ apiKey: 'synthetic', configuration: JEV_GRADER_CONFIGURATION, timeoutMs: 1000, logger() {}, fetch: async (_url, options) => {
    const request = JSON.parse(options.body);
    gradingRequests.push(request);
    return unavailable ? new Response('{}', { status: 503 }) : Response.json({ model: 'typesafe/jev-1.13-20260917', answers: Object.fromEntries(Object.keys(request.questions).map(id => [id, { type: 'noul', noul: probability }])) });
  } });
  const database = { prepare(sql) { let args = []; return { bind(...values) { args = values; return this; }, async first() { return db.prepare(sql).get(...args) ?? null; }, async all() { return { success: true, results: db.prepare(sql).all(...args) }; }, async run() { if (skipUnavailable && sql.startsWith("INSERT INTO learner_batch_commands") && sql.includes("review-skip")) throw new Error("Synthetic skip outage"); return { success: true, meta: { changes: Number(db.prepare(sql).run(...args).changes) } }; } }; }, async batch(statements) { db.exec('BEGIN'); try { const results = []; for (const statement of statements) results.push(await statement.run()); db.exec('COMMIT'); return results; } catch (error) { db.exec('ROLLBACK'); throw error; } } };
  db.prepare('INSERT INTO library_sources VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run('owner', 'source', 'https://example.test', 'https://example.test', 'Synthetic source', '', '{}', '{}', 'active', clock, clock, 1);
  db.prepare('INSERT INTO knowledge_workflow_runs(owner_id,run_id,source_id,source_revision,canonical_source_identity,content_signature,state,revision,idempotency_key,config_digests_json,counts_json,reused,created_at,updated_at,run_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('owner', 'run', 'source', 1, 'https://example.test', 'hash', 'completed', 1, 'run-key', '{}', '{}', 0, clock, clock, '{}');
  for (let index = 0; index < count; index++) {
    const knowledgeId = `knowledge-${index}`, taskId = `task-${index}`, generationId = `generation-${index}`;
    const task = { id: taskId, kind: 'paired', prompt: 'Recall the relationship.', explanation: 'Synthetic explanation.', sourceAnchorIds: ['anchor'], choices: null, correctChoiceIds: null, revision: 1, pairedVariants: [
      { id: 'choice', kind: 'single-choice', prompt: 'Choose the home note.', explanation: 'The tonic is the home note.', choices: [{ id: 'a', label: 'Tonic' }, { id: 'b', label: 'Dominant' }], correctChoiceIds: ['a'] },
      { id: 'fill', kind: 'fill-blank', prompt: 'The home note is the ____.', explanation: 'The tonic is the home note.', blanks: [{ id: 'blank-1', acceptedAnswers: ['tonic'] }] },
    ] };
    const point = { summary: `Synthetic idea ${index}.`, normalizedHash: `hash-${index}`, evidenceAnchors: [{ id: 'anchor' }], attribution: { sourceUrl: 'https://example.test' } };
    db.prepare('INSERT INTO extraction_knowledge_points VALUES(?,?,?,?,?,?,?,?)').run('owner', 'run', knowledgeId, 'source', 1, `hash-${index}`, JSON.stringify(point), clock);
    db.prepare('INSERT INTO learning_generation_jobs(owner_id,generation_id,source_id,source_revision,item_id,item_version_id,content_digest,source_kind,rights_evidence_id,policy_version,status,local_only,idempotency_key,command_fingerprint,record_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('owner', generationId, 'source', 1, knowledgeId, 'v1', 'hash', 'public-text', 'rights', 'v1', 'completed', 0, generationId, 'hash', '{}', clock);
    db.prepare('INSERT INTO learning_generation_tasks VALUES(?,?,?,?,?,?,?,?,?)').run('owner', generationId, taskId, 1, knowledgeId, 'v1', 'published', 1, JSON.stringify(task));
    db.prepare('INSERT INTO knowledge_workflow_quizzes VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run('owner', `quiz-${index}`, 'run', knowledgeId, 'source', 1, `quiz-hash-${index}`, '{}', 9, 1, 'published', clock);
  }
  const service = createLearningBatchService({ database, now: () => clock, random, logger() {}, semanticGrader: async command => {
    await beforeGrade();
    const result = await grader.grade(command);
    return result.ok ? { ok: true, value: result.value.probabilities } : result;
  } });
  const value = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
  const complete = async batch => value(await service.completeFeed({ ownerId: 'owner', batchId: batch.batchId, idempotencyKey: `complete:${batch.batchId}` }));
  const answer = (batch, question, overrides = {}) => service.answerReview({ ownerId: 'owner', batchId: batch.batchId, questionId: question.questionId, questionRevision: question.revision, selectedChoiceIds: question.kind === 'fill-blank' ? [] : ['a'], ...(question.kind === 'fill-blank' ? { blankAnswers: [{ id: 'blank-1', text: 'tonic' }] } : {}), idempotencyKey: `answer:${batch.batchId}:${question.questionId}`, ...overrides });
  const skip = (batch, question, overrides = {}) => service.skipReview({ ownerId: "owner", batchId: batch.batchId, questionId: question.questionId, questionRevision: question.revision, idempotencyKey: `skip:${batch.batchId}:${question.questionId}`, ...overrides });
  return { db, service, value, complete, answer, skip, setBeforeGrade: value => { beforeGrade = value; }, setSkipUnavailable: value => { skipUnavailable = value; }, gradingRequests, day: () => clock.slice(0, 10), setClock: value => { clock = value; }, setProbability: value => { probability = value; }, setUnavailable: value => { unavailable = value; } };
}

test('Review shuffles all choice labels together per batch, keeps reload order and grades stable IDs', async () => {
  for (const kind of ['single-choice', 'multiple-choice']) {
    const f = fixture(5);
    try {
      const correctIds = kind === 'single-choice' ? ['a'] : ['a', 'c', 'e'];
      const original = ['a', 'c', 'e', 'b', 'd'].map(id => ({ id, label: `Option ${id}` }));
      for (const row of f.db.prepare('SELECT task_id, task_json FROM learning_generation_tasks').all()) {
        const task = JSON.parse(row.task_json);
        Object.assign(task.pairedVariants[0], { kind, choices: original, correctChoiceIds: correctIds });
        f.db.prepare('UPDATE learning_generation_tasks SET task_json = ? WHERE task_id = ?').run(JSON.stringify(task), row.task_id);
      }
      const stored = f.db.prepare('SELECT task_json FROM learning_generation_tasks ORDER BY task_id').all();
      await f.complete(f.value(await f.service.loadFeed('owner', f.day())).batch);
      const initial = f.value(await f.service.loadReview('owner', f.day()));
      assert.deepEqual(f.value(await f.service.loadReview('owner', f.day())).questions, initial.questions);
      const choiceIds = initial.questions.filter(q => q.choices !== null).map(q => q.questionId);
      assert(choiceIds.length > 0);
      const orders = new Set(), correctPositions = new Set();
      let batchId = initial.batch.batchId, latest;
      for (let index = 0; index < 32; index++) {
        const nextId = `review:shuffle-fixture:${index}`;
        f.db.prepare('UPDATE learner_review_batches SET batch_id = ? WHERE batch_id = ?').run(nextId, batchId);
        batchId = nextId;
        latest = f.value(await f.service.loadReview('owner', f.day()));
        const question = latest.questions.find(q => q.questionId === choiceIds[0]);
        assert.deepEqual([...question.choices].sort((a, b) => a.id.localeCompare(b.id)), [...original].sort((a, b) => a.id.localeCompare(b.id)));
        orders.add(question.choices.map(c => c.id).join(','));
        correctPositions.add(question.choices.findIndex(c => c.id === 'a'));
        assert.equal(Object.hasOwn(question, 'correctChoiceIds'), false);
        assert.deepEqual(f.value(await f.service.loadReview('owner', f.day())).questions, latest.questions);
      }
      assert(orders.size > 1, 'New batches use different choice permutations');
      assert.equal(correctPositions.size, 5, 'Correct answers can occupy every position');
      if (kind === 'multiple-choice') assert([...orders].some(order => {
        const flags = order.split(',').map(id => correctIds.includes(id));
        return flags.some((correct, index) => correct && flags.slice(index + 1).includes(false) && flags.slice(index + 2).includes(true));
      }), 'Correct choices are interspersed with distractors');
      assert.deepEqual(f.db.prepare('SELECT task_json FROM learning_generation_tasks ORDER BY task_id').all(), stored);
      const question = latest.questions.find(q => q.questionId === choiceIds[0]);
      assert.equal(f.value(await f.answer(latest.batch, question, { selectedChoiceIds: correctIds })).correct, true);
    } finally { f.db.close(); }
  }
});

test('Review refresh replaces an unfinished batch and preserves saved answers, schedules and progress', async () => {
  const f = fixture();
  try {
    await f.complete(f.value(await f.service.loadFeed('owner', f.day())).batch);
    let initial = f.value(await f.service.loadReview('owner', f.day()));
    f.db.prepare('UPDATE learner_review_batches SET batch_id = ? WHERE batch_id = ?').run('zzzz-old-batch', initial.batch.batchId);
    initial = { ...initial, batch: { ...initial.batch, batchId: 'zzzz-old-batch' } };
    f.value(await f.answer(initial.batch, initial.questions[0]));
    f.value(await f.skip(initial.batch, initial.questions[1]));
    const answers = f.db.prepare('SELECT * FROM learner_review_answers').all();
    const schedules = f.db.prepare('SELECT * FROM learner_question_state ORDER BY question_id').all();
    const progress = f.value(await f.service.loadProgress('owner', 7, null));
    const next = f.value(await f.service.loadReview('owner', f.day(), true));
    assert.notEqual(next.batch.batchId, initial.batch.batchId);
    assert.equal(next.batch.status, 'open');
    assert.equal(next.questions.some(q => q.questionId === initial.questions[0].questionId), false, 'Answered question remains scheduled for later');
    assert.deepEqual(f.db.prepare('SELECT * FROM learner_review_answers').all(), answers);
    assert.deepEqual(f.db.prepare('SELECT * FROM learner_question_state ORDER BY question_id').all(), schedules);
    assert.deepEqual(f.value(await f.service.loadProgress('owner', 7, null)), progress);
    assert.deepEqual(f.value(await f.service.loadReview('owner', f.day())), { ...next, skipped: [] });
  } finally { f.db.close(); }
});

test('removing one Feed card replaces its slot, preserves four cards and survives reload', async () => {
  const f = fixture();
  try {
    const initial = f.value(await f.service.loadFeed('owner', f.day()));
    const removed = initial.items[2].knowledgeId;
    f.value(await f.service.removeKnowledge({ ownerId: 'owner', knowledgeId: removed, idempotencyKey: 'remove' }));
    const after = f.value(await f.service.loadFeed('owner', f.day()));
    assert.equal(after.batch.batchId, initial.batch.batchId);
    assert.equal(after.items.length, 5);
    for (const index of [0, 1, 3, 4]) assert.deepEqual(after.items[index], initial.items[index]);
    assert.equal(after.items.some(item => item.knowledgeId === removed), false);
    assert.deepEqual(f.value(await f.service.loadFeed('owner', f.day())), after);
    await f.complete(after.batch);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM learner_knowledge_state WHERE studied_at IS NOT NULL').get().n, 5);
  } finally { f.db.close(); }
});

test('removing the only spare card still preserves and completes the remaining Feed', async () => {
  const f = fixture(5);
  try {
    const initial = f.value(await f.service.loadFeed('owner', f.day()));
    f.value(await f.service.removeKnowledge({ ownerId: 'owner', knowledgeId: initial.items[2].knowledgeId, idempotencyKey: 'remove' }));
    const after = f.value(await f.service.loadFeed('owner', f.day()));
    assert.deepEqual(after.items, initial.items.filter((_, index) => index !== 2));
    await f.complete(after.batch);
  } finally { f.db.close(); }
});

test('completion refreshes Feed; empty Review unlocks immediately and keeps its batch after later study', async () => {
  const f = fixture();
  try {
    assert.equal(f.value(await f.service.loadReview('owner', f.day())).batch, null);
    const initial = f.value(await f.service.loadFeed('owner', f.day()));
    await f.complete(initial.batch);
    const next = f.value(await f.service.loadFeed('owner', f.day()));
    assert.notEqual(next.batch.batchId, initial.batch.batchId);
    assert.equal(next.batch.status, 'open');
    const review = f.value(await f.service.loadReview('owner', f.day()));
    assert.equal(review.questions.length, 5);
    assert.equal(review.dueCount, 10);
    assert.equal(review.questions.every(question => question.pairedVariants === null), true);
    assert.deepEqual(new Set(review.questions.map(question => question.kind)), new Set(['single-choice', 'fill-blank']));
    assert.equal(JSON.stringify(review).includes('acceptedAnswers'), false);
    await f.complete(next.batch);
    assert.equal(f.value(await f.service.loadReview('owner', f.day())).batch.batchId, review.batch.batchId);
    f.setClock('2026-10-19T00:00:00.000Z');
    assert.notEqual(f.value(await f.service.loadReview('owner', f.day())).batch.batchId, review.batch.batchId);
    assert.notEqual(f.value(await f.service.loadFeed('owner', f.day())).batch.batchId, next.batch.batchId);
  } finally { f.db.close(); }
});

test('Jev accepts 70%, grades exact text too, and records paired variants as separate review attempts', async () => {
  const f = fixture(5);
  try {
    await f.complete(f.value(await f.service.loadFeed('owner', f.day())).batch);
    const review = f.value(await f.service.loadReview('owner', f.day()));
    const fill = review.questions.find(question => question.kind === 'fill-blank');
    const answer = f.value(await f.answer(review.batch, fill));
    assert.equal(answer.correct, true);
    assert.equal(answer.score, 0.7);
    assert.equal(f.gradingRequests.length, 1);
    assert.equal(f.gradingRequests[0].state.answers[0].response, 'tonic');
    assert.deepEqual(f.value(await f.answer(review.batch, fill)), answer);
    assert.equal(f.gradingRequests.length, 1, 'retry does not regrade');
    const states = f.db.prepare('SELECT * FROM learner_question_state WHERE knowledge_id=? ORDER BY question_id').all(fill.knowledgeId);
    assert.equal(states.length, 2);
    assert.equal(states.find(state => state.question_id !== fill.questionId).due_at, '2026-10-18T00:00:00.000Z');
    assert.equal(states.find(state => state.question_id === fill.questionId).due_at, answer.nextDueAt);
    const sibling = f.value(await f.service.loadReview('owner', f.day())).questions.find(question => question.knowledgeId === fill.knowledgeId);
    assert.ok(sibling, "The paired choice remains independently answerable.");
    f.value(await f.answer(review.batch, sibling));
    const progress = f.value(await f.service.loadProgress('owner', 7, null));
    assert.equal(progress.attempts.count, 2);
    assert.equal(progress.activity.find(row => row.date === f.day()).reviewAttempts, 2);
  } finally { f.db.close(); }
});

test('Jev rejection and outage preserve grading boundaries and pending attempts', async () => {
  for (const probability of [0, 0.699999, 0.7, 1]) {
    const f = fixture(5);
    try {
      await f.complete(f.value(await f.service.loadFeed('owner', f.day())).batch);
      const review = f.value(await f.service.loadReview('owner', f.day()));
      const fill = review.questions.find(question => question.kind === 'fill-blank');
      f.setUnavailable(true);
      const unavailable = await f.answer(review.batch, fill);
      assert.equal(unavailable.error.kind, 'ReviewGradingUnavailable');
      assert.equal(f.db.prepare('SELECT COUNT(*) n FROM learner_review_answers').get().n, 0);
      f.setUnavailable(false); f.setProbability(probability);
      const answer = f.value(await f.answer(review.batch, fill));
      assert.equal(answer.correct, probability >= 0.7);
      assert.equal(answer.score, probability);
      assert.equal(f.value(await f.service.loadProgress('owner', 7, null)).attempts.count, 1);
    } finally { f.db.close(); }
  }
});

test('fill-in grading accepts published quizzes with more than four accepted wordings and replays the saved result', async () => {
  const f = fixture(5);
  try {
    const aliases = ['tonic', 'home note', 'tonal center', 'keynote', 'tonal centre'];
    for (const row of f.db.prepare('SELECT task_id, task_json FROM learning_generation_tasks').all()) {
      const task = JSON.parse(row.task_json);
      task.pairedVariants[1].blanks[0].acceptedAnswers = aliases;
      f.db.prepare('UPDATE learning_generation_tasks SET task_json = ? WHERE task_id = ?').run(JSON.stringify(task), row.task_id);
    }
    await f.complete(f.value(await f.service.loadFeed('owner', f.day())).batch);
    const review = f.value(await f.service.loadReview('owner', f.day()));
    const question = review.questions.find(question => question.kind === 'fill-blank');
    const answer = f.value(await f.answer(review.batch, question));
    assert.equal(answer.score, 0.7);
    assert.equal(answer.feedback.correctAnswer, 'tonic');
    assert.deepEqual(f.gradingRequests[0].state.answers[0].canonicalAnswers, aliases);
    assert.deepEqual(f.value(await f.answer(review.batch, question)), answer);
    assert.equal(f.gradingRequests.length, 1);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM learner_review_answers').get().n, 1);
  } finally { f.db.close(); }
});

test('all questions complete independently; unanswered variants remain available for the next batch', async () => {
  const f = fixture(5);
  try {
    await f.complete(f.value(await f.service.loadFeed('owner', f.day())).batch);
    const first = f.value(await f.service.loadReview('owner', f.day()));
    for (const [index, question] of first.questions.entries()) {
      const answer = f.value(await f.answer(first.batch, question));
      assert.equal(answer.completed, index === first.questions.length - 1);
    }
    const second = f.value(await f.service.loadReview('owner', f.day(), true));
    assert.equal(second.questions.length, 5);
    assert.equal(second.dueCount, 5);
    assert.equal(second.questions.some(question => first.batch.itemIds.includes(question.questionId)), false);
    assert.equal(f.value(await f.service.loadProgress('owner', 7, null)).attempts.count, 5);
  } finally { f.db.close(); }
});

test('point removal preserves completed study and answer counts', async () => {
  const f = fixture(5);
  try {
    await f.complete(f.value(await f.service.loadFeed('owner', f.day())).batch);
    const review = f.value(await f.service.loadReview('owner', f.day()));
    f.value(await f.answer(review.batch, review.questions[0]));
    const before = f.value(await f.service.loadProgress('owner', 7, null));
    f.value(await f.service.removeKnowledge({ ownerId: 'owner', knowledgeId: review.questions[0].knowledgeId, idempotencyKey: 'remove-studied' }));
    const after = f.value(await f.service.loadProgress('owner', 7, null));
    assert.deepEqual(after.activity, before.activity);
    assert.equal(after.attempts.count, before.attempts.count);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM learner_question_state WHERE knowledge_id=?').get(review.questions[0].knowledgeId).n, 0);
  } finally { f.db.close(); }
});


test('skipping all questions reveals feedback, persists across reloads and preserves all future scheduling', async () => {
  const f = fixture(5);
  try {
    await f.complete(f.value(await f.service.loadFeed('owner', f.day())).batch);
    const review = f.value(await f.service.loadReview('owner', f.day()));
    const before = f.db.prepare('SELECT * FROM learner_knowledge_state ORDER BY knowledge_id').all();
    for (const [index, question] of review.questions.entries()) {
      const skipped = f.value(await f.skip(review.batch, question));
      assert.equal(skipped.completed, index === review.questions.length - 1);
      assert.equal(skipped.feedback.correctAnswer, question.kind === 'fill-blank' ? 'tonic' : 'Tonic');
      assert.equal(typeof skipped.feedback.explanation, 'string');
      assert.equal(f.value(await f.skip(review.batch, question, { idempotencyKey: `duplicate:${index}` })).questionId, question.questionId);
      assert.equal((await f.answer(review.batch, question)).ok, false, 'revealed answers cannot become review evidence');
    }
    assert.deepEqual(f.db.prepare('SELECT * FROM learner_knowledge_state ORDER BY knowledge_id').all(), before);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM learner_question_state').get().n, 0);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM learner_review_answers').get().n, 0);
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM learner_batch_commands WHERE command_kind = 'review-skip'").get().n, review.questions.length);
    assert.equal(f.gradingRequests.length, 0);
    const reloaded = f.value(await f.service.loadReview('owner', f.day()));
    assert.equal(reloaded.batch.status, 'completed');
    assert.equal(reloaded.dueCount, review.dueCount);
    assert.equal(reloaded.skipped.length, review.questions.length);
    assert.deepEqual(reloaded.questions, review.questions);
    const progress = f.value(await f.service.loadProgress('owner', 7, null));
    assert.equal(progress.activity.find(row => row.date === f.day()).reviewAttempts, 0);
    const next = f.value(await f.service.loadReview('owner', f.day(), true));
    assert.notEqual(next.batch.batchId, review.batch.batchId);
    assert.deepEqual(next.questions.map(q => q.questionId), review.questions.map(q => q.questionId), 'unchanged random inputs and weights can select skipped questions again immediately');
  } finally { f.db.close(); }
});

test('mixed answers and skips complete a batch with only actual answers counted and scheduled', async () => {
  const f = fixture(5);
  try {
    await f.complete(f.value(await f.service.loadFeed('owner', f.day())).batch);
    const review = f.value(await f.service.loadReview('owner', f.day()));
    for (const question of review.questions.slice(0, -1)) f.value(await f.skip(review.batch, question));
    const last = review.questions.at(-1);
    const answer = f.value(await f.answer(review.batch, last));
    assert.equal(answer.completed, true, 'answering the last outstanding card also closes mixed batches');
    assert.equal((await f.skip(review.batch, last)).ok, false);
    assert.deepEqual(f.db.prepare('SELECT question_id FROM learner_review_answers').all().map(row => row.question_id), [last.questionId]);
    const progress = f.value(await f.service.loadProgress('owner', 7, null));
    assert.equal(progress.activity.find(row => row.date === f.day()).reviewAttempts, 1);
    const reloaded = f.value(await f.service.loadReview('owner', f.day()));
    assert.equal(reloaded.skipped.length, review.questions.length - 1);
    assert.equal(reloaded.dueCount, review.dueCount - 1);
  } finally { f.db.close(); }
});

test('Skip rejects bad, unavailable, stale and foreign questions and recovers after a write outage', async () => {
  const f = fixture(5);
  try {
    await f.complete(f.value(await f.service.loadFeed('owner', f.day())).batch);
    const review = f.value(await f.service.loadReview('owner', f.day())), question = review.questions[0];
    for (const overrides of [{ questionId: '' }, { questionId: 'missing' }, { ownerId: 'other' }, { questionRevision: 99 }, { batchId: 'missing' }, { idempotencyKey: '' }]) assert.equal((await f.skip(review.batch, question, overrides)).ok, false);
    assert.equal((await f.service.skipReview(null)).ok, false);
    f.setSkipUnavailable(true);
    assert.deepEqual(await f.skip(review.batch, question), { ok: false, error: { kind: 'LearningBatchPersistenceFailed' } });
    assert.equal(f.value(await f.service.loadReview('owner', f.day())).skipped.length, 0);
    f.setSkipUnavailable(false);
    f.value(await f.skip(review.batch, question));
    f.value(await f.skip(review.batch, question));
    assert.equal(f.value(await f.service.loadReview('owner', f.day())).skipped.length, 1);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM learner_review_answers').get().n, 0);
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM learner_batch_commands WHERE command_kind = 'review-skip'").get().n, 1);
  } finally { f.db.close(); }
});

test('Skip committed while Jev grades prevents the in-flight answer from changing progress or schedules', async () => {
  const f = fixture(5);
  try {
    await f.complete(f.value(await f.service.loadFeed('owner', f.day())).batch);
    const review = f.value(await f.service.loadReview('owner', f.day())), question = review.questions.find(q => q.kind === 'fill-blank');
    const before = f.db.prepare('SELECT * FROM learner_knowledge_state ORDER BY knowledge_id').all();
    let entered, release;
    const started = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { release = resolve; });
    f.setBeforeGrade(async () => { entered(); await gate; });
    const pending = f.answer(review.batch, question);
    await started;
    f.value(await f.skip(review.batch, question));
    release();
    assert.deepEqual(await pending, { ok: false, error: { kind: 'ReviewAnswerNotAllowed' } });
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM learner_review_answers').get().n, 0);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM learner_question_state').get().n, 0);
    assert.deepEqual(f.db.prepare('SELECT * FROM learner_knowledge_state ORDER BY knowledge_id').all(), before);
  } finally { f.db.close(); }
});


test('concurrent Skip requests for one card persist only one skip event', async () => {
  const f = fixture(5);
  try {
    await f.complete(f.value(await f.service.loadFeed('owner', f.day())).batch);
    const review = f.value(await f.service.loadReview('owner', f.day()));
    const results = await Promise.all([f.skip(review.batch, review.questions[0]), f.skip(review.batch, review.questions[0], { idempotencyKey: 'parallel-skip' })]);
    for (const result of results) assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM learner_batch_commands WHERE command_kind = 'review-skip'").get().n, 1);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM learner_review_answers').get().n, 0);
  } finally { f.db.close(); }
});

test('Delete quiz requires an answer or skip and preserves the other quiz type, knowledge and history', async () => {
  for (const kind of ['choice', 'fill']) for (const action of ['answer', 'skip']) {
    const f = fixture(5);
    try {
      await f.complete(f.value(await f.service.loadFeed('owner', f.day())).batch);
      const initial = f.value(await f.service.loadReview('owner', f.day()));
      const ids = ['task-0:choice', 'task-0:fill'];
      f.db.prepare('UPDATE learner_review_batches SET question_ids_json = ? WHERE batch_id = ?').run(JSON.stringify(ids), initial.batch.batchId);
      const review = f.value(await f.service.loadReview('owner', f.day()));
      const question = review.questions.find(q => q.questionId === `task-0:${kind}`);
      const sibling = review.questions.find(q => q.questionId !== question.questionId);
      const command = { ownerId: 'owner', batchId: review.batch.batchId, questionId: question.questionId, questionRevision: question.revision, idempotencyKey: `remove:${kind}:${action}` };
      assert.equal((await f.service.removeReview(command)).error.kind, 'ReviewRemovalNotAllowed');
      f.value(await f[action](review.batch, question));
      assert.equal((await f.service.removeReview({ ...command, ownerId: 'foreign' })).ok, false);
      assert.equal((await f.service.removeReview({ ...command, questionRevision: 999 })).ok, false);
      assert.equal((await f.service.removeReview({ ...command, batchId: 'foreign' })).ok, false);
      assert.equal((await f.service.removeReview({ ...command, questionId: sibling.questionId })).ok, false);
      const history = f.db.prepare('SELECT * FROM learner_review_answers').all();
      const schedules = f.db.prepare('SELECT * FROM learner_question_state ORDER BY question_id').all();
      const tasks = f.db.prepare('SELECT task_json FROM learning_generation_tasks ORDER BY task_id').all();
      const progress = f.value(await f.service.loadProgress('owner', 7, null));
      const removed = f.value(await f.service.removeReview(command));
      assert.equal(removed.removed, true);
      assert.deepEqual(f.value(await f.service.removeReview(command)), removed, 'Retries replay the same deletion');
      const reloaded = f.value(await f.service.loadReview('owner', f.day()));
      assert.equal(reloaded.batch.batchId, review.batch.batchId, 'Deleting one quiz keeps the current batch');
      assert.deepEqual(reloaded.questions.map(q => q.questionId), [sibling.questionId]);
      assert.deepEqual(reloaded.skipped, [], 'Removed skip feedback cannot leak into the public projection');
      assert.deepEqual(f.db.prepare('SELECT * FROM learner_review_answers').all(), history);
      assert.deepEqual(f.db.prepare('SELECT * FROM learner_question_state ORDER BY question_id').all(), schedules);
      assert.deepEqual(f.db.prepare('SELECT task_json FROM learning_generation_tasks ORDER BY task_id').all(), tasks);
      assert.deepEqual(f.value(await f.service.loadProgress('owner', 7, null)), progress);
      assert.equal(f.value(await f.service.listKnowledge('owner')).items.length, 5);
      f.db.prepare('UPDATE learner_knowledge_state SET studied_at = NULL WHERE knowledge_id != ?').run(question.knowledgeId);
      f.setClock('2026-10-25T00:00:00.000Z');
      const next = f.value(await f.service.loadReview('owner', f.day(), true));
      assert.deepEqual(next.questions.map(q => q.questionId), [sibling.questionId], 'Only the remaining type returns in future batches');
      f.value(await f.skip(next.batch, next.questions[0]));
      f.value(await f.service.removeReview({ ...command, batchId: next.batch.batchId, questionId: sibling.questionId, idempotencyKey: 'remove-last' }));
      const empty = f.value(await f.service.loadReview('owner', f.day()));
      assert.equal(empty.batch, null, 'Deleting the last quiz returns a valid empty projection');
      assert.deepEqual(empty.questions, []);
    } finally { f.db.close(); }
  }
});

test('replacing a skipped quiz preserves its slot, answers, schedules and reload state with idempotent replay', async () => {
  const f = fixture(5);
  try {
    await f.complete(f.value(await f.service.loadFeed('owner', f.day())).batch);
    const review = f.value(await f.service.loadReview('owner', f.day()));
    const question = review.questions[2];
    f.value(await f.answer(review.batch, review.questions[0]));
    f.value(await f.skip(review.batch, question));
    const history = f.db.prepare('SELECT * FROM learner_review_answers').all();
    const schedule = f.db.prepare('SELECT * FROM learner_question_state').all();
    const replace = overrides => f.service.replaceReview({ ownerId: 'owner', batchId: review.batch.batchId, questionId: question.questionId, questionRevision: question.revision, idempotencyKey: 'replace:first', ...overrides });
    for (const overrides of [{ ownerId: 'other' }, { questionId: review.questions[1].questionId }, { questionRevision: 99 }, { batchId: 'missing' }, { idempotencyKey: '' }]) assert.equal((await replace(overrides)).ok, false);
    const replaced = f.value(await replace());
    assert.equal(replaced.questions.length, 1);
    const replacement = replaced.questions[0];
    assert(!review.batch.itemIds.includes(replacement.questionId));
    assert.equal('correctChoiceIds' in replacement, false);
    assert.equal('acceptedAnswers' in replacement, false);
    assert.deepEqual(replaced.batch.itemIds, review.batch.itemIds.map(id => id === question.questionId ? replacement.questionId : id));
    assert.deepEqual(f.value(await replace()), replaced, 'same command returns the same random replacement');
    assert.equal((await replace({ idempotencyKey: 'replace:other' })).ok, false, 'a removed slot cannot replace a second time');
    assert.deepEqual(f.db.prepare('SELECT * FROM learner_review_answers').all(), history);
    assert.deepEqual(f.db.prepare('SELECT * FROM learner_question_state').all(), schedule);
    const reloaded = f.value(await f.service.loadReview('owner', f.day()));
    assert.deepEqual(reloaded.batch, replaced.batch);
    assert(!reloaded.questions.some(q => q.questionId === question.questionId));
    assert(reloaded.questions.some(q => q.questionId === replacement.questionId));
    assert.deepEqual(reloaded.skipped, []);
    f.value(await f.skip(replaced.batch, replacement));
    const next = f.value(await f.service.replaceReview({ ownerId: 'owner', batchId: replaced.batch.batchId, questionId: replacement.questionId, questionRevision: replacement.revision, idempotencyKey: 'replace:second' }));
    assert.notEqual(next.questions[0].questionId, question.questionId, 'previously revealed cards cannot reappear in this batch');
  } finally { f.db.close(); }
});

test('replacement reopens a skipped completed batch, excludes deleted and unavailable quizzes, and rejects superseded batches', async () => {
  const f = fixture(5);
  try {
    await f.complete(f.value(await f.service.loadFeed('owner', f.day())).batch);
    const review = f.value(await f.service.loadReview('owner', f.day()));
    for (const question of review.questions) f.value(await f.skip(review.batch, question));
    const question = review.questions[0];
    const command = { ownerId: 'owner', batchId: review.batch.batchId, questionId: question.questionId, questionRevision: question.revision, idempotencyKey: 'replace:completed' };
    const replaced = f.value(await f.service.replaceReview(command));
    assert.equal(replaced.batch.status, 'open');
    assert.equal(replaced.batch.completedAt, null);
    const replaySkip = f.value(await f.skip(review.batch, review.questions[1]));
    assert.equal(replaySkip.completed, false, 'remaining skips do not prematurely complete the replacement');
    const available = f.value(await f.service.loadReview('owner', f.day()));
    const spare = available.questions.find(q => q.questionId === replaced.questions[0].questionId);
    f.value(await f.skip(available.batch, spare));
    f.db.prepare("UPDATE learner_knowledge_state SET due_at = '2099-01-01T00:00:00.000Z'").run();
    const exhausted = await f.service.replaceReview({ ...command, questionId: spare.questionId, idempotencyKey: 'replace:exhausted' });
    assert.equal(exhausted.error.kind, 'ReviewReplacementUnavailable');
    assert.deepEqual(f.value(await f.service.loadReview('owner', f.day())).batch.itemIds, available.batch.itemIds);
    f.db.prepare("UPDATE learner_knowledge_state SET due_at = '2026-01-01T00:00:00.000Z'").run();
    const refreshed = f.value(await f.service.loadReview('owner', f.day(), true));
    assert.notEqual(refreshed.batch.batchId, review.batch.batchId);
    assert.equal((await f.service.replaceReview({ ...command, questionId: spare.questionId, idempotencyKey: 'replace:stale' })).ok, false);
  } finally { f.db.close(); }
});

test('concurrent replacements cannot overwrite another slot or create duplicate replacement commands', async () => {
  const f = fixture(5);
  try {
    await f.complete(f.value(await f.service.loadFeed('owner', f.day())).batch);
    const review = f.value(await f.service.loadReview('owner', f.day()));
    const original = review.questions[0];
    f.value(await f.skip(review.batch, original));
    const command = { ownerId: 'owner', batchId: review.batch.batchId, questionId: original.questionId, questionRevision: original.revision, idempotencyKey: 'replace:race' };
    const results = await Promise.all([f.service.replaceReview(command), f.service.replaceReview({ ...command, idempotencyKey: 'replace:race-other' })]);
    assert.equal(results.filter(result => result.ok).length, 1);
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM learner_batch_commands WHERE command_kind='review-replace'").get().n, 1);
    const reloaded = f.value(await f.service.loadReview('owner', f.day()));
    assert.equal(new Set(reloaded.batch.itemIds).size, 5);
    assert.deepEqual(reloaded.batch.itemIds.slice(1), review.batch.itemIds.slice(1));
    assert(!reloaded.batch.itemIds.includes(original.questionId));
  } finally { f.db.close(); }
});

test('one success leaves only its partner due; both successes wait for the next interval and another Feed study', async () => {
  const f = fixture(1);
  try {
    const feed = f.value(await f.service.loadFeed('owner', f.day()));
    assert.equal(feed.items.length, 1, 'A small due pool must not wait for five cards');
    await f.complete(feed.batch);
    const initial = f.value(await f.service.loadReview('owner', f.day()));
    const choice = initial.questions.find(q => q.kind === 'single-choice');
    f.value(await f.answer(initial.batch, choice));
    assert.equal(f.db.prepare('SELECT scheduled_days FROM learner_knowledge_state').get().scheduled_days, 0);
    let pending = f.value(await f.service.loadReview('owner', f.day(), true));
    assert.equal(pending.dueCount, 1);
    assert.deepEqual(pending.questions.map(q => q.kind), ['fill-blank']);
    f.setProbability(0);
    assert.equal(f.value(await f.answer(pending.batch, pending.questions[0])).correct, false);
    assert.equal(f.db.prepare('SELECT scheduled_days FROM learner_knowledge_state').get().scheduled_days, 0);
    pending = f.value(await f.service.loadReview('owner', f.day(), true));
    assert.equal(pending.dueCount, 1);
    f.setProbability(1);
    f.value(await f.answer(pending.batch, pending.questions[0]));
    assert.equal(f.db.prepare('SELECT scheduled_days FROM learner_knowledge_state').get().scheduled_days, 1);
    assert.equal(f.value(await f.service.loadReview('owner', f.day(), true)).dueCount, 0);
    assert.equal(f.value(await f.service.loadFeed('owner', f.day(), true)).items.length, 0);
    assert.equal((await f.answer(initial.batch, choice, { idempotencyKey: 'stale-success' })).ok, false);
    f.setClock('2026-10-19T00:00:00.000Z');
    assert.equal(f.value(await f.service.loadReview('owner', f.day(), true)).dueCount, 0, 'Elapsed time alone cannot bypass Feed');
    const repeat = f.value(await f.service.loadFeed('owner', f.day(), true));
    assert.equal(repeat.items[0].knowledgeId, choice.knowledgeId);
    assert.equal(repeat.items[0].questionLocked, true);
    await f.complete(repeat.batch);
    pending = f.value(await f.service.loadReview('owner', f.day(), true));
    assert.equal(pending.dueCount, 2);
    f.value(await f.answer(pending.batch, pending.questions[0]));
    assert.equal(f.db.prepare('SELECT scheduled_days FROM learner_knowledge_state').get().scheduled_days, 1);
    f.value(await f.answer(pending.batch, pending.questions[1]));
    assert.equal(f.db.prepare('SELECT scheduled_days FROM learner_knowledge_state').get().scheduled_days, 2);
    assert.equal(f.db.prepare('SELECT due_at FROM learner_knowledge_state').get().due_at, '2026-10-21T00:00:00.000Z');
  } finally { f.db.close(); }
});

test('wrong answers at a longer interval neither demote nor postpone the remaining quiz', async () => {
  const f = fixture(1);
  try {
    await f.complete(f.value(await f.service.loadFeed('owner', f.day())).batch);
    f.db.prepare('UPDATE learner_knowledge_state SET scheduled_days = 8').run();
    let review = f.value(await f.service.loadReview('owner', f.day(), true));
    const choice = review.questions.find(q => q.kind === 'single-choice');
    f.value(await f.answer(review.batch, choice, { selectedChoiceIds: ['b'] }));
    assert.equal(f.db.prepare('SELECT scheduled_days FROM learner_knowledge_state').get().scheduled_days, 8);
    review = f.value(await f.service.loadReview('owner', f.day(), true));
    assert.equal(review.dueCount, 2);
    f.value(await f.answer(review.batch, review.questions.find(q => q.kind === 'single-choice')));
    review = f.value(await f.service.loadReview('owner', f.day(), true));
    assert.equal(review.dueCount, 1);
    assert.equal(review.questions[0].kind, 'fill-blank');
    f.value(await f.service.setPreference({ownerId:'owner',knowledgeId:choice.knowledgeId,choice:'more',idempotencyKey:'more'}));
    assert.equal(f.db.prepare('SELECT scheduled_days FROM learner_knowledge_state').get().scheduled_days, 4);
    review = f.value(await f.service.loadReview('owner', f.day(), true));
    assert.equal(review.dueCount, 1, 'Preference preserves success in the current round');
  } finally { f.db.close(); }
});

test('concurrent sibling successes promote once and stale refreshed batches cannot submit again', async () => {
  const f = fixture(1);
  try {
    await f.complete(f.value(await f.service.loadFeed('owner', f.day())).batch);
    const review = f.value(await f.service.loadReview('owner', f.day(), true));
    const old = f.value(await f.service.loadReview('owner', f.day(), true));
    const fill = review.questions.find(q => q.kind === 'fill-blank');
    const choice = review.questions.find(q => q.kind === 'single-choice');
    f.setBeforeGrade(async () => { f.value(await f.answer(review.batch, choice)); });
    f.value(await f.answer(review.batch, fill));
    assert.equal(f.db.prepare('SELECT scheduled_days FROM learner_knowledge_state').get().scheduled_days, 1);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM learner_review_answers').get().n, 2);
    assert.equal((await f.answer(old.batch, choice)).ok, false);
  } finally { f.db.close(); }
});


test('Feed keeps its view-count bias while frequently viewed eligible cards can still be drawn', async () => {
  let random = 0.15;
  const f = fixture(6, () => random);
  try {
    await f.complete(f.value(await f.service.loadFeed('owner', f.day())).batch);
    f.db.exec("UPDATE learner_knowledge_state SET view_count = 0; UPDATE learner_knowledge_state SET view_count = 20 WHERE knowledge_id = 'knowledge-0'");
    let feed = f.value(await f.service.loadFeed('owner', f.day(), true));
    assert.equal(feed.items[0].knowledgeId, 'knowledge-1', 'The weighted draw favors less-viewed cards');
    random = 0;
    feed = f.value(await f.service.loadFeed('owner', f.day(), true));
    assert.equal(feed.items[0].knowledgeId, 'knowledge-0', 'A frequently viewed due card still has positive probability');
  } finally { f.db.close(); }
});


test('Feed candidate pool includes knowledge beyond the former first-thousand cutoff', async () => {
  const f = fixture(1001);
  try {
    const candidates = f.value(await f.service.listCandidates('owner', '2026-10-18T00:00:00.000Z'));
    assert.equal(candidates.length, 1001);
    assert(candidates.some(candidate => candidate.knowledgeId === 'knowledge-1000'));
  } finally { f.db.close(); }
});

test('confirmed deletion retains private example, optional reason and subject without treating frequency feedback as avoidance', async()=>{
  const f=fixture(3);
  try {
    f.db.prepare("INSERT INTO source_classifications VALUES(?,?,?,?,?,?,?,?,?,?,?)").run('owner','source',1,'music','Harmony',1,'agent','classified','[]','2026-10-18T00:00:00.000Z',null);
    f.value(await f.service.setPreference({ownerId:'owner',knowledgeId:'knowledge-0',choice:'less',idempotencyKey:'less-only'}));
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM knowledge_deletion_feedback').get().n,0);
    const removed=f.value(await f.service.removeKnowledge({ownerId:'owner',knowledgeId:'knowledge-0',idempotencyKey:'delete-0'}));
    assert.equal(removed.deletionId,'delete-0');
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM extraction_knowledge_points WHERE knowledge_id=?').get('knowledge-0').n,0);
    assert.deepEqual({...f.db.prepare('SELECT summary,main_subject,reason FROM knowledge_deletion_feedback').get()},{summary:'Synthetic idea 0.',main_subject:'music',reason:null});
    assert.equal(f.value(await f.service.removeKnowledge({ownerId:'owner',knowledgeId:'knowledge-0',idempotencyKey:'delete-0'})).deletionId,'delete-0');
    assert.equal((await f.service.submitDeletionReason({ownerId:'foreign',deletionId:'delete-0',reason:'No trivia',idempotencyKey:'foreign'})).ok,false);
    assert.equal((await f.service.submitDeletionReason({ownerId:'owner',deletionId:'delete-0',reason:'  ',idempotencyKey:'blank'})).ok,false);
    f.value(await f.service.submitDeletionReason({ownerId:'owner',deletionId:'delete-0',reason:'  Avoid catalogue trivia.  ',idempotencyKey:'reason'}));
    f.value(await f.service.submitDeletionReason({ownerId:'owner',deletionId:'delete-0',reason:'Avoid catalogue trivia.',idempotencyKey:'reason'}));
    assert.equal(f.db.prepare('SELECT reason FROM knowledge_deletion_feedback').get().reason,'Avoid catalogue trivia.');
    f.value(await f.service.removeKnowledge({ownerId:'owner',knowledgeId:'knowledge-1',target:'image',idempotencyKey:'image'}));
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM knowledge_deletion_feedback').get().n,1);
  } finally {f.db.close();}
});
