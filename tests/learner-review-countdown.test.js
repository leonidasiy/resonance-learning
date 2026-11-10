// @ts-check
import { createLearnerController } from '../src/features/learning-generation/learner.js';

/** @param {unknown} condition @param {string} message */
function assert(condition, message) { if (!condition) throw new Error(message); }

Deno.test('Review countdowns wait fifteen seconds, allow early keyboard activation, preserve slots and cancel on navigation', async () => {
  const globals = ['document', 'HTMLElement', 'CSS', 'setTimeout', 'clearTimeout'];
  const descriptors = globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  const originalNow = Date.now;
  const shell = await Deno.readTextFile('index.html');
  class Button {
    dataset = { questionId: 'skipped' };
    /** @type {(() => void) | null} */ click = null;
    /** @param {string} _name @param {() => void} listener */
    addEventListener(_name, listener) { this.click = listener; }
  }
  try {
    Object.defineProperty(globalThis, 'document', { configurable: true, value: { getElementById: (/** @type {string} */ id) => ({ textContent: shell.match(new RegExp(`<script id="${id}" type="application/json">([\\s\\S]*?)</script>`))?.[1] }) } });
    Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: Button });
    Object.defineProperty(globalThis, 'CSS', { configurable: true, value: { escape: (/** @type {string} */ text) => text } });
    for (const mode of ['automatic', 'manual', 'batch', 'manual-batch', 'navigation', 'failure']) {
      let clock = 0, timerId = 0, calls = 0;
      /** @type {Map<number, () => void>} */ const timers = new Map();
      Object.defineProperty(globalThis, 'setTimeout', { configurable: true, value: (/** @type {() => void} */ callback) => { timers.set(++timerId, callback); return timerId; } });
      Object.defineProperty(globalThis, 'clearTimeout', { configurable: true, value: (/** @type {number} */ id) => timers.delete(id) });
      Date.now = () => clock;
      const tick = () => { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(callback => callback()); };
      const isBatch = mode.includes('batch');
      const batch = { batchId: 'batch', learningDay: '2026-10-23', status: isBatch ? 'completed' : 'open', itemIds: ['skipped', 'other'], revision: 1, createdAt: '2026-10-23T00:00:00Z', completedAt: isBatch ? '2026-10-23T01:00:00Z' : null };
      const question = (/** @type {string} */ questionId) => ({ questionId, knowledgeId: questionId, title: 'Synthetic source', prompt: 'Name the home note: ____.', kind: 'fill-blank', choices: null, blanks: [{ id: 'blank-1' }], sourceAnchorIds: ['a'], revision: 1 });
      const projection = { batch, questions: ['skipped', 'other'].map(question), skipped: isBatch ? [] : [{ questionId: 'skipped', completed: false, feedback: { correctAnswer: 'tonic', explanation: 'The tonic is the home note.' } }], dueCount: 3 };
      const replaceButton = new Button(), batchButton = new Button();
      const seconds = { textContent: '' };
      const root = /** @type {HTMLElement} */ (/** @type {unknown} */ ({
        isConnected: true,
        querySelector: (/** @type {string} */ selector) => selector === "[data-action='next-review-batch']" ? batchButton : selector.startsWith('[data-review-countdown=') ? { querySelector: (/** @type {string} */ child) => child === '[data-countdown-seconds]' ? seconds : { setAttribute() {} } } : selector.startsWith('[data-review-question') ? { getBoundingClientRect: () => ({ height: 600 }) } : null,
        querySelectorAll: (/** @type {string} */ selector) => selector === "[data-action='replace-review']" ? [replaceButton] : [],
      }));
      /** @type {Parameters<Parameters<typeof createLearnerController>[0]['onChange']>[]} */ const changes = [];
      /** @type {ReturnType<typeof createLearnerController> | null} */ let controller = null;
      controller = createLearnerController({ baseUrl: 'https://app.example.test/', timeoutMs: 1000, escapeHtml: text => text, now: () => '2026-10-23T00:00:00Z', createId: () => 'id', onChange: (...args) => { changes.push(args); controller?.bind(root); }, fetch: async (input, options) => {
        if (options?.method !== 'POST') return Response.json({ result: projection });
        calls++;
        assert(String(input).endsWith(isBatch ? '/refresh' : '/replace'), 'Use the intended command, never a grading endpoint.');
        if (mode === 'failure' && calls === 1) return Response.json({ error: 'LearningBatchPersistenceFailed' }, { status: 503 });
        return Response.json({ result: { questionId: 'skipped', batch: { ...batch, status: 'open', completedAt: null, itemIds: ['replacement', 'other'] }, questions: [question('replacement')], dueCount: 3 } });
      } });
      await controller.loadReview();
      controller.bind(root);
      assert(controller.renderReview().includes('data-countdown-seconds>15<'), 'Countdown begins at fifteen.');
      if (mode === 'navigation') {
        controller.unbind(); clock = 20_000; tick();
        assert(calls === 0, 'Leaving Review cancels active timers.');
        controller.bind(root); tick();
      } else if (mode === 'manual' || mode === 'manual-batch' || mode === 'failure') {
        (isBatch ? batchButton : replaceButton).click?.();
        (isBatch ? batchButton : replaceButton).click?.();
      } else {
        clock = 14_900; tick();
        assert(calls === 0 && seconds.textContent === '1', 'Feedback remains visible until the full fifteen seconds elapse.');
        clock = 15_000; tick();
      }
      for (let step = 0; step < 20; step++) await Promise.resolve();
      if (mode === 'failure') {
        assert(controller.renderReview().includes('Correct answer:') && controller.renderReview().includes('role="alert"'), 'Failed replacement keeps feedback and shows retry.');
        replaceButton.click?.();
        for (let step = 0; step < 20; step++) await Promise.resolve();
      }
      assert(calls === (mode === 'failure' ? 2 : 1), 'Each timer or manual action issues one request.');
      const rendered = controller.renderReview();
      assert(rendered.includes('data-review-question="replacement"') && !rendered.includes('data-review-question="skipped"'), 'The skipped slot is replaced.');
      if (!isBatch) {
        assert(rendered.indexOf('data-review-question="replacement"') < rendered.indexOf('data-review-question="other"'), 'Other cards keep their order.');
        assert(rendered.includes('min-height:600px'), 'Replacement preserves card height to prevent bottom-of-page scroll clamping.');
        assert(changes.some(args => args[4] === true) && changes.every(args => args[3] !== 'review'), 'Single-card changes preserve scroll and never request a page reset.');
      } else assert(changes.some(args => args[3] === 'review'), 'A new batch requests the page top.');
      controller.unbind();
      assert(timers.size === 0, 'No timer survives teardown.');
    }
  } finally {
    Date.now = originalNow;
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, /** @type {string} */ (key), /** @type {PropertyDescriptor} */ (descriptor));
      else Reflect.deleteProperty(globalThis, /** @type {string} */ (key));
    }
  }
});
