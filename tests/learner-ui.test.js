
const shell = Deno.readTextFileSync("index.html");
Object.defineProperty(globalThis, "document", { configurable: true, value: {
  getElementById: (/** @type {string} */ id) => {
    const content = shell.match(new RegExp(`<script id="${id}" type="application/json">([\\s\\S]*?)</script>`))?.[1];
    return content === undefined ? null : { textContent: content };
  },
} });
// @ts-check

import { buildProgress } from "../src/features/progress/public.js";
import { learningCelebrationMarkup, reviewCelebrationMarkup } from "../src/features/learning-generation/celebration.js";

import { createLearnerController } from "../src/features/learning-generation/learner.js";

/** @param {boolean} condition @param {string} message */
function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/** @param {unknown} body */
function response(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

const review = {
  batch: {
    batchId: "review:music",
    learningDay: "2026-09-01",
    status: "open",
    itemIds: ["question-1"],
    revision: 1,
    createdAt: "2026-09-01T00:00:00.000Z",
    completedAt: null,
  },
  questions: [{
    questionId: "question-1",
    knowledgeId: "knowledge-1",
    title: "Open Music Theory",
    prompt: "Which interval spans six semitones?",
    kind: "single-choice",
    choices: [{ id: "choice-1", label: "Tritone" }, { id: "choice-2", label: "Octave" }],
    sourceAnchorIds: ["anchor-1"],
    revision: 1,
  }],
  dueCount: 1,
};

Deno.test("Review offers Refresh for unfinished, completed and empty batches with pending and retry feedback", async () => {
  for (const projection of [review, { ...review, batch: { ...review.batch, status: "completed" } }, { batch: null, questions: [], dueCount: 0 }]) {
    let requests = 0;
    /** @type {(value: Response) => void} */ let settle = () => {};
    const controller = createLearnerController({ fetch: async input => {
      if (String(input).endsWith("/refresh")) { requests++; return await new Promise(resolve => { settle = resolve; }); }
      return response({ result: projection });
    }, baseUrl: "https://app.example.test/", timeoutMs: 1000, escapeHtml: value => value, now: () => "2026-09-01T12:00:00.000Z", createId: () => "test", onChange: () => {} });
    await controller.loadReview();
    /** @type {() => void} */ let refresh = () => {};
    controller.bind(/** @type {HTMLElement} */ (/** @type {unknown} */ ({ querySelector: (/** @type {string} */ selector) => selector === "[data-action='refresh-learner-review']" ? { addEventListener: (/** @type {string} */ _event, /** @type {() => void} */ listener) => { refresh = listener; } } : null, querySelectorAll: () => [] })));
    const html = controller.renderReview();
    assert(html.includes('data-action="refresh-learner-review"') && !html.includes("Answer every question before refreshing"), "Refresh is available in every settled state");
    for (const succeed of [false, true]) {
      refresh(); refresh();
      assert(requests === (succeed ? 2 : 1), "Duplicate pending clicks send one request");
      const pending = controller.renderReview();
      assert(pending.includes('aria-busy="true"') && pending.includes("Finding questions…") && pending.includes("disabled"), "Pending refresh has visible feedback and is disabled");
      if (projection.batch?.status === "open") assert(pending.includes('<input disabled '), "Answer inputs are disabled while replacing the batch");
      settle(succeed ? response({ result: { ...review, batch: { ...review.batch, batchId: "review:replacement" }, questions: [{ ...review.questions[0], prompt: "Replacement question" }] } }) : new Response(JSON.stringify({ error: "LearningBatchPersistenceFailed" }), { status: 503 }));
      await new Promise(resolve => setTimeout(resolve, 0));
      const after = controller.renderReview();
      assert(!after.includes("Finding questions…"), "Refresh returns to its ready state");
      if (succeed) assert(after.includes("Replacement question"), "Success displays the replacement batch");
      else assert(after.includes('role="alert"') && (projection.batch === null || after.includes(review.questions[0].prompt)), "Failure reports an error and preserves the current questions");
    }
  }
});

Deno.test("Feed is text-only without associated media and hides legacy fallback images", async () => {
  for (const media of [null, { assetId: "old-fallback", kind: "image", url: "/assets/fallback-media/old.png", attribution: "User-attested local fallback" }]) {
    const controller = createLearnerController({ fetch: async () => response({ result: { batch: { ...review.batch, batchId: "feed:a", itemIds: ["knowledge-1"] }, items: [{ knowledgeId: "knowledge-1", sourceId: "source-1", sourceRevision: 1, sourceClassification: null, sourceClassificationRevision: 0, questionId: "question-1", title: "Source", summary: "A useful relationship.", sourceUrl: "https://example.test/source", evidenceAnchorIds: ["page:1"], media, questionLocked: true }] } }), baseUrl: "https://app.example.test/", timeoutMs: 1000, escapeHtml: (value) => value, now: () => "2026-09-08T00:00:00.000Z", createId: () => "test", onChange: () => {} });
    await controller.loadFeed();
    const html = controller.renderFeed();
    assert(html.includes("A useful relationship."), "Text must remain visible.");
    const card = html.slice(html.indexOf('<article class="learning-card"'));
    assert(card.indexOf('card-knowledge') < card.indexOf('card-source') && card.indexOf('card-source') < card.indexOf('card-subject'), "Reading order must be knowledge, source, then subject.");
    assert(!html.includes('session-panel') && !html.includes('progress-bridge'), "Completion must not repeat competing panels.");
    assert(html.includes('Mark batch studied') && html.includes('data-action="refresh-learner-feed"') && html.indexOf('data-action="refresh-learner-feed"') > html.indexOf('Mark batch studied') && !html.includes('data-view="review"'), "Open batch must offer manual refresh beside explicit completion.");
    assert(!html.includes("<img") && !html.includes("card-media") && !html.includes("source-icon-fallback") && !html.includes("card-visual"), "Unassociated fallback must not render.");
  }
});

Deno.test("Feed renders an associated source image without an unrelated fallback", async () => {
  const controller = createLearnerController({ fetch: async () => response({ result: { batch: { ...review.batch, batchId: "feed:image", itemIds: ["knowledge-1"] }, items: [{ knowledgeId: "knowledge-1", sourceId: "source-1", sourceRevision: 1, sourceClassification: null, sourceClassificationRevision: 0, questionId: "question-1", title: "Source", summary: "A diagram-backed relationship.", sourceUrl: "https://example.test/source", evidenceAnchorIds: ["page:1"], media: { assetId: "media-1", kind: "image", url: "/api/knowledge-workflows/media/media-1?variant=feed", attribution: "Source page diagram" }, questionLocked: true }] } }), baseUrl: "https://app.example.test/", timeoutMs: 1000, escapeHtml: (value) => value, now: () => "2026-09-08T00:00:00.000Z", createId: () => "test", onChange: () => {} });
  await controller.loadFeed();
  const html = controller.renderFeed();
  assert(html.includes("data-associated-media=\"true\""), "Associated source media must render.");
  assert(!html.includes("data-fallback-src"), "Unrelated fallback must never be declared.");
  assert(html.includes('alt="Source page diagram"') && !html.includes("<figcaption"), "Images keep accessible attribution without the removed supportive caption.");
  assert(html.includes('data-image-zoom') && html.includes('aria-label="Enlarge image"'), "Associated images offer a keyboard accessible larger view.");
  assert(html.includes('data-remove-target="image"') && html.includes('data-remove-target="knowledge"') && html.includes('<summary class="button quiet"'), "Remove expands into image-only and knowledge-point choices.");
  assert(html.indexOf('card-knowledge') < html.indexOf('card-media') && html.indexOf('card-media') < html.indexOf('card-source'), "Associated media must support the knowledge before its source, not lead the page.");
});

Deno.test("Feed keeps associated image attribution accessible without supportive captions", async () => {
  for (const purpose of [undefined, "evidence", "illustration"]) {
    const media = { assetId: "media-1", kind: "image", url: "/api/learning-media?assetId=media-1&variant=feed", attribution: "Source page image", ...(purpose === undefined ? {} : { purpose }) };
    const card = { knowledgeId: "knowledge-1", sourceId: "source-1", sourceRevision: 1, sourceClassification: null, sourceClassificationRevision: 0, questionId: "question-1", title: "Source", summary: "A text-supported relationship.", sourceUrl: "https://example.test/source", evidenceAnchorIds: ["page:1"], media, questionLocked: true };
    const controller = createLearnerController({ fetch: async () => response({ result: { batch: { ...review.batch, batchId: "feed:illustration", itemIds: [card.knowledgeId] }, items: [card] } }), baseUrl: "https://app.example.test/", timeoutMs: 1000, escapeHtml: (value) => value, now: () => "2026-09-08T00:00:00.000Z", createId: () => "test", onChange: () => {} });
    await controller.loadFeed();
    const html = controller.renderFeed();
    assert(html.includes('data-associated-media="true"'), "Approved source images remain visible.");
    assert(html.includes('alt="Source page image"') && html.includes('class="card-source"'), "Accessible attribution and the source link remain available.");
    assert(!html.includes("<figcaption") && !html.includes("Illustration — facts are supported by the source text"), "Supportive captions are removed for all image purposes.");
  }
});

Deno.test("Feed source editor exposes only main subject dropdown and free-text topic", async () => {
  const card = { knowledgeId: "knowledge-1", sourceId: "source-1", sourceRevision: 3, sourceClassificationRevision: 2, sourceClassification: { mainSubject: "music", topic: "Cadential harmony" }, questionId: "question-1", title: "Source", summary: "A useful relationship.", sourceUrl: "https://example.test/source", evidenceAnchorIds: ["page:1"], media: null, questionLocked: true };
  const controller = createLearnerController({ fetch: async () => response({ result: { batch: { ...review.batch, batchId: "feed:source-edit", itemIds: ["knowledge-1"] }, items: [card] } }), baseUrl: "https://app.example.test/", timeoutMs: 1000, escapeHtml: (value) => value, now: () => "2026-09-08T00:00:00.000Z", createId: () => "test", onChange: () => {} });
  const loaded = await controller.loadFeed();
  assert(loaded.ok, "The source-level classification projection must load.");
  const html = controller.renderFeed();
  const editor = html.slice(html.indexOf("<form class=\"classification-form\""), html.indexOf("</form>") + 7);
  assert(editor.includes('name="mainSubject"') && editor.includes("<select"), "Main subject remains one dropdown.");
  assert(editor.includes('name="topic"') && editor.includes("<input"), "Topic remains free text.");
  assert((editor.match(/<select\b/gu) ?? []).length === 1 && (editor.match(/<input\b/gu) ?? []).length === 1, "Exactly two editable fields appear.");
  assert(!/name="(?:secondary|subcategory|primarySubject)"/iu.test(editor), "Per-point taxonomy fields are absent.");
});

Deno.test("Feed displays topic beneath subject separately from the classification editor", async () => {
  const items = [
    { knowledgeId: "knowledge-1", sourceId: "source-1", sourceRevision: 3, sourceClassificationRevision: 2, sourceClassification: { mainSubject: "music", topic: "Cadential harmony" }, questionId: "question-1", title: "Classified source", summary: "A useful relationship.", sourceUrl: "https://example.test/source", evidenceAnchorIds: ["page:1"], media: null, questionLocked: true },
    { knowledgeId: "knowledge-2", sourceId: "source-2", sourceRevision: 1, sourceClassificationRevision: 0, sourceClassification: null, questionId: "question-2", title: "Unclassified source", summary: "Another relationship.", sourceUrl: "https://example.test/other", evidenceAnchorIds: ["page:2"], media: null, questionLocked: true },
  ];
  const controller = createLearnerController({ fetch: async () => response({ result: { batch: { ...review.batch, batchId: "feed:classification", itemIds: items.map((item) => item.knowledgeId) }, items } }), baseUrl: "https://app.example.test/", timeoutMs: 1000, escapeHtml: (value) => value, now: () => "2026-09-08T00:00:00.000Z", createId: () => "test", onChange: () => {} });
  await controller.loadFeed();
  const html = controller.renderFeed();
  const classified = html.slice(html.indexOf('data-knowledge-id="knowledge-1"'), html.indexOf("</article>"));
  assert(classified.indexOf('class="card-subject"') < classified.indexOf("<p>Cadential harmony</p>") && classified.indexOf("<p>Cadential harmony</p>") < classified.indexOf('Edit source classification'), "Classified card order must be subject, separate topic, then editor action.");
  assert(classified.includes("<p>Cadential harmony</p>"), "The existing topic must display as its own card field.");
  assert(classified.includes("<summary>Edit source classification</summary>"), "The disclosure summary must be an action, not the topic.");
  const unclassified = html.slice(html.indexOf('data-knowledge-id="knowledge-2"'), html.indexOf("</article>", html.indexOf('data-knowledge-id="knowledge-2"')));
  assert(unclassified.includes("Unclassified") && !unclassified.includes("Cadential harmony") && unclassified.includes("</p><div class=\"card-context\">"), "An unclassified card keeps its subject label without a standalone topic.");
  assert(unclassified.includes('name="topic"'), "Topic remains editable in the existing editor.");
});

Deno.test("completed Feed offers the next batch without urging Review", async () => {
  const controller = createLearnerController({ fetch: async () => response({ result: { batch: { ...review.batch, batchId: "feed:done", status: "completed", completedAt: "2026-09-01T12:00:00.000Z", itemIds: ["knowledge-1"] }, items: [{ knowledgeId: "knowledge-1", sourceId: "source-1", sourceRevision: 1, sourceClassification: null, sourceClassificationRevision: 0, questionId: "question-1", title: "Source", summary: "A useful relationship.", sourceUrl: "https://example.test/source", evidenceAnchorIds: ["page:1"], media: null, questionLocked: false }] } }), baseUrl: "https://app.example.test/", timeoutMs: 1000, escapeHtml: (value) => value, now: () => "2026-09-08T00:00:00.000Z", createId: () => "test", onChange: () => {} });
  await controller.loadFeed();
  const html = controller.renderFeed();
  assert(!html.includes('data-action="complete-learner-feed"'), "Completed batch must not offer another study write.");
  assert(!html.includes('data-view="review"'), "A completed batch alone must not urge Review.");
  assert(html.split('data-action="refresh-learner-feed"').length === 2, "Completed batch keeps one manual refresh beside its bottom continuation.");
});

Deno.test("Review renders the paired quiz prompt, not the knowledge-card summary", async () => {
  const knowledgeSummary = "This knowledge card explains ordered pitch intervals and interval classes in detail.";
  const controller = createLearnerController({
    fetch: async () => response({ result: review }),
    baseUrl: "https://app.example.test/",
    timeoutMs: 1_000,
    escapeHtml: (value) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;"),
    now: () => "2026-09-01T12:00:00.000Z",
    createId: () => "id-1",
    onChange: () => {},
  });
  const loaded = await controller.loadReview();
  assert(loaded.ok, "Review must accept a valid paired-question projection.");
  const html = controller.renderReview();
  assert(html.includes("Which interval spans six semitones?"), "Review must render the quiz prompt.");
  assert(html.includes("Tritone") && html.includes("Octave"), "Review must render the quiz answer choices.");
  assert(html.includes("From Open Music Theory"), "Review must identify the quiz's source context.");
  assert(!html.includes(knowledgeSummary), "Review must not render the knowledge-card summary.");
  assert(!html.includes("The source defines the interval class"), "Review must not render an explanation before an answer.");
  assert(html.includes("data-review-question=\"question-1\""), "Review must render the paired question container.");
  assert(!html.includes('name="confidence"'), "Review must not collect confidence.");
});

Deno.test("Review renders ordered blank inputs without revealing answers", async () => {
  const multi = { ...review, questions: [{ ...review.questions[0], prompt: "A ____ resolves to the ____.", kind: "fill-blank", choices: null, blanks: [{ id: "blank-1" }, { id: "blank-2" }] }] };
  const controller = createLearnerController({ fetch: async () => response({ result: multi }), baseUrl: "https://app.example.test/", timeoutMs: 1_000, escapeHtml: (value) => value, now: () => "2026-09-01T12:00:00.000Z", createId: () => "id-1", onChange: () => {} });
  const loaded = await controller.loadReview();
  assert(loaded.ok, "Review must accept ordered blank definitions.");
  const html = controller.renderReview();
  assert(html.includes('name="blank:blank-1"') && html.includes('name="blank:blank-2"'), "Both blanks need accessible inputs.");
  assert(html.includes("Blank 1") && html.includes("Blank 2"), "Each input needs a distinct label.");
  assert(!html.includes("dominant") && !html.includes("tonic"), "The pre-attempt view must not reveal answers.");
});

Deno.test("Review renders separate keyboard-operable choice and fill-blank cards with Skip on each", async () => {
  const separate = { ...review, batch: { ...review.batch, itemIds: ["choice-v1", "fill-v1"] }, questions: [
    { ...review.questions[0], questionId: "choice-v1", pairedVariants: null },
    { ...review.questions[0], questionId: "fill-v1", kind: "fill-blank", prompt: "A six-semitone interval is a ____.", choices: null, blanks: [{ id: "blank-1" }], pairedVariants: null },
  ] };
  const controller = createLearnerController({ fetch: async () => response({ result: separate }), baseUrl: "https://app.example.test/", timeoutMs: 1_000, escapeHtml: value => value, now: () => "2026-09-01T12:00:00.000Z", createId: () => "id-1", onChange: () => {} });
  assert((await controller.loadReview()).ok, "The independent answer-hidden questions must load.");
  const html = controller.renderReview();
  assert((html.match(/data-learner-review-question=/gu) ?? []).length === 2, "Each question gets its own form.");
  assert(html.includes('type="radio" name="selectedChoiceIds"') && html.includes('name="blank:blank-1"'), "Both input kinds use native controls.");
  assert((html.match(/>Check answer</gu) ?? []).length === 2 && (html.match(/>Skip</gu) ?? []).length === 2, "Each question can be answered or skipped independently.");
  assert(!html.includes("correctChoiceIds") && !html.includes("acceptedAnswers") && !html.includes("Source explanation"), "No feedback appears before an answer or Skip.");
});

Deno.test("Review empty state contains no knowledge-card content", async () => {
  const controller = createLearnerController({
    fetch: async () => response({ result: { batch: null, questions: [], dueCount: 0 } }),
    baseUrl: "https://app.example.test/",
    timeoutMs: 1_000,
    escapeHtml: (value) => value,
    now: () => "2026-09-01T12:00:00.000Z",
    createId: () => "id-1",
    onChange: () => {},
  });
  const loaded = await controller.loadReview();
  assert(loaded.ok, "Review must accept an empty due-question projection.");
  const html = controller.renderReview();
  assert(html.includes("No questions are due"), "Review must show its empty quiz state.");
  assert(!html.includes("knowledge-card") && !html.includes("Knowledge card"), "Review empty state must not present knowledge cards.");
});

Deno.test("Feed completion is not triggered by an intersection observer", async () => {
  const source = await Deno.readTextFile(new URL("../src/features/learning-generation/learner.js", import.meta.url));
  assert(!source.includes("IntersectionObserver"), "Feed completion must remain an explicit learner action.");
  assert(source.includes("data-action='complete-learner-feed'"), "Feed must retain its explicit completion action.");
});

Deno.test("Feed completion and manual Feed/Review refresh reset the view only after success", async () => {
  const feed = { batch: { ...review.batch, batchId: "feed:scroll", itemIds: ["knowledge-1"] }, items: [{ knowledgeId: "knowledge-1", sourceId: "source-1", sourceRevision: 1, sourceClassification: null, sourceClassificationRevision: 0, questionId: "question-1", title: "Source", summary: "Read this knowledge.", sourceUrl: "https://example.test/source", evidenceAnchorIds: ["page:1"], media: null, questionLocked: true }] };
  for (const action of ["refresh-learner-feed", "complete-learner-feed", "refresh-learner-review", "retry-learner-feed", "retry-learner-review"]) {
    for (const success of [true, false]) {
      /** @type {string[]} */ const refreshed = [];
      /** @type {() => void} */ let click = () => {};
      /** @type {(value: Response) => void} */ let settle = () => {};
      let activated = false;
      const controller = createLearnerController({
        fetch: async (input, init) => {
          if (init?.method === "POST" || activated && action.startsWith("retry-")) return await new Promise(resolve => { settle = resolve; });
          return response({ result: String(input).includes("review-batch") ? review : feed });
        },
        baseUrl: "https://app.example.test/", timeoutMs: 1000, escapeHtml: value => value,
        now: () => "2026-09-01T12:00:00.000Z", createId: () => "scroll",
        onChange: (_notice, _focus, _heading, view) => { if (view) refreshed.push(view); },
      });
      await Promise.all([controller.loadFeed(), controller.loadReview()]);
      assert(controller.renderFeed().includes('data-read-knowledge="knowledge-1"') && controller.renderFeed().includes('data-reading-status role="status"'), "Knowledge cards offer a native Read button and speech status.");
      controller.bind(/** @type {HTMLElement} */ (/** @type {unknown} */ ({ querySelector: (/** @type {string} */ selector) => selector === `[data-action='${action}']` ? { addEventListener: (/** @type {string} */ _event, /** @type {() => void} */ listener) => { click = listener; } } : null, querySelectorAll: () => [] })));
      activated = true;
      click();
      await new Promise(resolve => setTimeout(resolve, 0));
      assert(refreshed.length === 0, "Pending refresh keeps the current position.");
      settle(success ? response({ result: action === "complete-learner-feed" ? { completed: true } : action.endsWith("review") ? review : feed }) : new Response("Unavailable", { status: 503 }));
      await new Promise(resolve => setTimeout(resolve, 0));
      assert(refreshed.join() === (success ? action.endsWith("review") ? "review" : "feed" : ""), "Only a successful replacement asks the active page to return to the top.");
    }
  }
});

Deno.test("Empty Feed and Review offer artwork and a next action without invented learning content", async () => {
  const controller = createLearnerController({ fetch: async () => response({ result: { batch: null, items: [], questions: [], dueCount: 0 } }), baseUrl: "https://app.example.test/", timeoutMs: 1000, escapeHtml: value => value, now: () => "2026-10-14T00:00:00.000Z", createId: () => "empty", onChange: () => {} });
  await controller.loadFeed();
  await controller.loadReview();
  const feed = controller.renderFeed(), review = controller.renderReview();
  assert(feed.includes("empty-states.svg#feed") && feed.includes('href="#discover"') && !feed.includes('data-knowledge-id'), "Empty Feed uses its own artwork and guides discovery without sample cards.");
  assert(review.includes("empty-states.svg#review") && review.includes('href="#feed"') && !review.includes('data-question-id'), "Empty Review guides study without sample questions.");
});

Deno.test("preference motion follows actual settlement, rejects duplicate pending clicks and consumes success once", async () => {
  const originalElement = Object.getOwnPropertyDescriptor(globalThis, "HTMLElement");
  const originalFrame = Object.getOwnPropertyDescriptor(globalThis, "requestAnimationFrame");
  class Button {
    /** @type {Record<string, string>} */ dataset = { knowledgeId: "knowledge-1", preference: "more", sparkEvent: "preference:knowledge-1:more" };
    /** @type {Map<string, () => void>} */ listeners = new Map();
    /** @param {string} type @param {() => void} listener */
    addEventListener(type, listener) { this.listeners.set(type, listener); }
    removeAttribute() { delete this.dataset.sparkEvent; }
  }
  /** @type {FrameRequestCallback[]} */ const frames = [];
  Object.defineProperty(globalThis, "HTMLElement", { configurable: true, value: Button });
  Object.defineProperty(globalThis, "requestAnimationFrame", { configurable: true, value: (/** @type {FrameRequestCallback} */ callback) => frames.push(callback) });
  try {
    /** @type {(response:Response) => void} */ let settle = () => { throw new Error("No pending request"); };
    let requests = 0;
    let changed = () => {};
    const card = { knowledgeId: "knowledge-1", sourceId: "source-1", sourceRevision: 1, sourceClassification: null, sourceClassificationRevision: 0, questionId: "question-1", title: "Source", summary: "A useful relationship.", sourceUrl: "https://example.test/source", evidenceAnchorIds: ["page:1"], media: null, questionLocked: true };
    const controller = createLearnerController({ fetch: async (_url, init) => {
      if (init?.method === "GET") return response({ result: { batch: { ...review.batch, batchId: "feed:motion" }, items: [card] } });
      requests++;
      return await new Promise(resolve => { settle = resolve; });
    }, baseUrl: "https://app.example.test/", timeoutMs: 1000, escapeHtml: value => value, now: () => "2026-10-15T00:00:00.000Z", createId: () => "motion", onChange: () => changed() });
    await controller.loadFeed();
    const button = new Button();
    /** @type {Button[]} */ let events = [];
    const root = /** @type {HTMLElement} */ (/** @type {unknown} */ ({ querySelector: () => null, querySelectorAll: (/** @type {string} */ selector) => selector === "[data-spark-event]" ? events : selector === "[data-action='learner-preference']" ? [button] : [] }));
    controller.bind(root);
    button.listeners.get("click")?.();
    button.listeners.get("click")?.();
    assert(requests === 1, "A pending action must send only one request.");
    assert(controller.renderFeed().includes('aria-busy="true"') && !controller.renderFeed().includes('data-spark-event='), "Pending is real request state, never success.");
    let completed = new Promise(resolve => { changed = () => resolve(undefined); });
    settle(response({ result: { saved: true } }));
    await completed;
    assert(controller.renderFeed().includes('data-spark-event="preference:knowledge-1:more"'), "Only a settled success schedules a celebration.");
    events = [button];
    controller.bind(root);
    controller.bind(root);
    assert(frames.length === 1 && !controller.renderFeed().includes('data-spark-event='), "Rerender/bind must not repeat a consumed success.");
    events = [];
    button.listeners.get("click")?.();
    completed = new Promise(resolve => { changed = () => resolve(undefined); });
    settle(new Response(JSON.stringify({ error: "Unavailable" }), { status: 503 }));
    await completed;
    assert(!controller.renderFeed().includes('data-spark-event=') && !controller.renderFeed().includes('aria-busy="true"') && controller.renderFeed().includes('role="alert"'), "Failure must clear pending, expose the error and never celebrate.");
  } finally {
    if (originalElement) Object.defineProperty(globalThis, "HTMLElement", originalElement); else Reflect.deleteProperty(globalThis, "HTMLElement");
    if (originalFrame) Object.defineProperty(globalThis, "requestAnimationFrame", originalFrame); else Reflect.deleteProperty(globalThis, "requestAnimationFrame");
  }
});

Deno.test("daily targets use separate persisted study and quiz counts across five-card batches", async () => {
  const progress = buildProgress({ days: 7, now: "2026-09-01T12:00:00.000Z", subject: null, studies: [{ completedAt: "2026-09-01T10:00:00.000Z", itemCount: 5 }, { completedAt: "2026-09-01T11:00:00.000Z", itemCount: 5 }], attempts: [{ batchId: "b", questionId: "q", knowledgeId: "k", answeredAt: "2026-09-01T10:00:00.000Z", correct: false, score: 0, elapsedDays: null, previousCorrect: null, primarySubject: null }] });
  if (!progress.ok) throw new Error(progress.error.field);
  let targets = { learning: 10, review: 5 };
  const controller = createLearnerController({ fetch: async input => response({ result: String(input).includes("/progress?") ? progress.value : String(input).includes("review-batch") ? review : { batch: null, items: [] } }), baseUrl: "https://app.example.test/", timeoutMs: 1000, escapeHtml: value => value, now: () => "2026-09-01T12:00:00.000Z", createId: () => "test", getDailyTargets: () => targets, onChange: () => {} });
  await Promise.all([controller.loadFeed(), controller.loadReview()]);
  assert(controller.renderFeed().includes("10 / 10") && controller.renderFeed().includes("knowledge cards studied"), "Study counts accumulate across batches.");
  assert(controller.renderReview().includes("1 / 5") && controller.renderReview().includes("quiz cards completed"), "Incorrect submitted quizzes count toward completion independently.");
  targets = { learning: 5, review: 10 };
  assert(controller.renderFeed().includes("10 / 5") && controller.renderReview().includes("1 / 10"), "Target changes apply immediately without changing the batch.");
});

Deno.test("an open page loads both new daily batches once and retains same-day batches", async () => {
  let timestamp = "2026-09-01T23:59:00.000Z";
  /** @type {string[]} */ const requested = [];
  const controller = createLearnerController({ fetch: async input => { requested.push(String(input)); return response({ result: String(input).includes("review-batch") ? review : { batch: null, items: [] } }); }, baseUrl: "https://app.example.test/", timeoutMs: 1000, escapeHtml: value => value, now: () => timestamp, createId: () => "test", onChange: () => {} });
  await Promise.all([controller.loadFeed(), controller.loadReview()]);
  await controller.refreshDay();
  assert(requested.length === 2, "Same day does not refresh batches.");
  timestamp = "2026-09-02T00:00:00.000Z";
  await controller.refreshDay();
  assert(requested.length === 4 && requested.slice(2).every(url => url.includes("day=2026-09-02")), "Both pages request the new day, including unfinished Review.");
  await controller.refreshDay();
  assert(requested.length === 4, "Repeated day checks keep the new batches.");
});

Deno.test("learning celebration points to the remaining review goal", () => {
  const html = learningCelebrationMarkup(10, 5);
  assert(html.includes('href="#review"') && html.includes("5 quiz cards") && html.includes("<strong>10</strong>"), "Celebration shows actual activity and Review continuation.");
  assert(learningCelebrationMarkup(5, 0).includes("Your review goal is complete too"), "Completed Review is not described as outstanding.");
});

Deno.test("Review celebration has distinct artwork and celebrates completed practice", () => {
  const html = reviewCelebrationMarkup(5);
  assert(html.includes('class="review-achievement"') && html.includes("Daily review goal complete") && html.includes("<strong>5</strong> quiz cards"), "Review has its own checkmark and completion message.");
  assert(!html.includes("goal-star") && !html.includes('href="#review"') && html.includes("data-goal-dismiss"), "Review stays in place with a dismiss action.");
  assert(reviewCelebrationMarkup(1).includes("quiz card today"), "Singular count reads naturally.");
});

Deno.test("only submitted answers crossing the daily Review target open its popup", async () => {
  const originals = Object.fromEntries(["document", "HTMLFormElement", "FormData", "HTMLElement"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  class Form {
    dataset = { learnerReviewBatch: "review:music", learnerReviewQuestion: "question-1" };
    /** @type {(() => void) | null} */ submit = null;
    /** @param {string} _type @param {(event: { preventDefault: () => void, currentTarget: Form }) => void} listener */
    addEventListener(_type, listener) { this.submit = () => listener({ preventDefault: () => {}, currentTarget: this }); }
  }
  class Element {
    dataset = { questionId: "question-1" };
    /** @type {(() => void) | null} */ click = null;
    /** @param {string} _type @param {() => void} listener */
    addEventListener(_type, listener) { this.click = listener; }
  }
  class Values { getAll() { return ["choice-1"]; } get() { return null; } }
  Object.defineProperty(globalThis, "HTMLFormElement", { configurable: true, value: Form });
  Object.defineProperty(globalThis, "HTMLElement", { configurable: true, value: Element });
  Object.defineProperty(globalThis, "FormData", { configurable: true, value: Values });
  try {
    for (const scenario of [{ before: 0, target: 2, show: false }, { before: 1, target: 2, show: true }, { before: 1, target: 2, correct: false, show: true }, { before: 2, target: 2, show: false }, { before: 0, target: 0, show: false }, { before: 1, target: 2, skip: true, show: false }, { before: 1, target: 2, fail: true, show: false }]) {
      let count = scenario.before, shown = 0;
      const dialog = { innerHTML: "", setAttribute: () => {}, querySelector: () => null, addEventListener: () => {}, showModal: () => { shown++; } };
      Object.defineProperty(globalThis, "document", { configurable: true, value: { ...originals.document?.value, createElement: () => dialog, querySelector: () => null, body: { append: () => {} } } });
      const controller = createLearnerController({ fetch: async input => {
        if (String(input).endsWith("/answer")) {
          if (scenario.fail) return new Response("unavailable", { status: 503 });
          count++;
          return response({ result: { correct: scenario.correct !== false, score: scenario.correct === false ? 0 : 1, completed: true, nextDueAt: "2026-09-02T12:00:00.000Z", feedback: { correctAnswer: "Tritone", explanation: "Six semitones.", components: [] } } });
        }
        if (String(input).endsWith("/skip")) return response({ result: { completed: true, feedback: { correctAnswer: "Tritone", explanation: "Six semitones." } } });
        if (String(input).includes("/progress?")) {
          const result = buildProgress({ days: 7, now: "2026-09-01T12:00:00.000Z", subject: null, studies: [], attempts: Array.from({ length: count }, (_, i) => ({ batchId: "b", questionId: `q-${i}`, knowledgeId: "k", answeredAt: "2026-09-01T10:00:00.000Z", correct: true, score: 1, elapsedDays: null, previousCorrect: null, primarySubject: null })) });
          if (!result.ok) throw new Error(result.error.field);
          return response({ result: result.value });
        }
        return response({ result: review });
      }, baseUrl: "https://app.example.test/", timeoutMs: 1000, escapeHtml: value => value, now: () => "2026-09-01T12:00:00.000Z", createId: () => "test", getDailyTargets: () => ({ learning: 5, review: scenario.target }), onChange: () => {} });
      await controller.loadReview();
      assert(shown === 0, "Loading Review never opens a popup.");
      const form = new Form(), skip = new Element();
      controller.bind(/** @type {HTMLElement} */ (/** @type {unknown} */ ({ querySelector: () => null, querySelectorAll: (/** @type {string} */ selector) => selector === "[data-learner-review]" ? [form] : selector === "[data-action='skip-review']" ? [skip] : [] })));
      if (scenario.skip) skip.click?.(); else form.submit?.();
      await new Promise(resolve => setTimeout(resolve, 10));
      assert(shown === Number(scenario.show), `Unexpected popup for ${JSON.stringify(scenario)}.`);
      await controller.loadReview();
      assert(shown === Number(scenario.show), "Reloading progress never replays the celebration.");
    }
  } finally {
    for (const [key, descriptor] of Object.entries(originals)) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
  }
});

Deno.test("only crossing the learning target opens the Review celebration", async () => {
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  let studied = 0, shown = 0, status = "open", popup = "";
  /** @type {Record<string, { click?: () => void }>} */ const actions = {};
  const button = (/** @type {string} */ selector) => ({ addEventListener: (/** @type {string} */ _type, /** @type {() => void} */ listener) => { actions[selector] = { click: listener }; } });
  const dialog = { innerHTML: "", setAttribute: () => {}, querySelector: () => null, addEventListener: () => {}, showModal: () => { shown++; popup = dialog.innerHTML; } };
  Object.defineProperty(globalThis, "document", { configurable: true, value: { ...document, createElement: () => dialog, querySelector: () => null, body: { append: () => {} } } });
  try {
    const cards = Array.from({ length: 5 }, (_, i) => ({ knowledgeId: `k-${i}`, sourceId: "s", sourceRevision: 1, sourceClassification: null, sourceClassificationRevision: 0, questionId: `q-${i}`, title: "Synthetic source", summary: "Synthetic knowledge.", sourceUrl: "https://example.test", evidenceAnchorIds: ["a"], media: null, questionLocked: true }));
    const controller = createLearnerController({ fetch: async input => {
      const path = String(input);
      if (path.endsWith("/complete")) { studied += 5; status = "completed"; return response({ result: { status } }); }
      if (path.includes("/progress?")) {
        const progress = buildProgress({ days: 7, now: "2026-09-01T12:00:00.000Z", subject: null, attempts: [], studies: Array.from({ length: studied / 5 }, () => ({ itemCount: 5, completedAt: "2026-09-01T10:00:00.000Z" })) });
        if (!progress.ok) throw new Error(progress.error.field);
        return response({ result: progress.value });
      }
      if (path.includes("review-batch")) return response({ result: { batch: null, questions: [], dueCount: 0 } });
      if (path.endsWith("/refresh") || path.includes("/feed-batch?")) status = "open";
      return response({ result: { batch: { ...review.batch, status, itemIds: cards.map(c => c.knowledgeId) }, items: cards } });
    }, baseUrl: "https://app.example.test/", timeoutMs: 1000, escapeHtml: value => value, now: () => "2026-09-01T12:00:00.000Z", createId: () => "test", getDailyTargets: () => ({ learning: 10, review: 5 }), onChange: () => {} });
    await controller.loadFeed();
    controller.bind(/** @type {HTMLElement} */ (/** @type {unknown} */ ({ querySelector: button, querySelectorAll: () => [] })));
    actions["[data-action='complete-learner-feed']"].click?.();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert(shown === 0 && controller.renderFeed().includes("5 / 10"), "The first five-card batch must not trigger a ten-card goal.");
    assert(controller.renderFeed().includes('data-action="complete-learner-feed"'), "The next batch is ready without a manual refresh.");
    actions["[data-action='complete-learner-feed']"].click?.();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert(shown === 1 && popup.includes("5 quiz cards") && popup.includes('href="#review"'), "Crossing ten opens a celebration with the independent Review goal.");
    await controller.loadFeed();
    actions["[data-action='complete-learner-feed']"].click?.();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert(shown === 1, "Reloading or re-completing the closed batch must not repeat the popup.");
  } finally {
    if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
  }
});

Deno.test("typed quiz cards retain submitted answers and show canonical answers after correct and incorrect grading", async () => {
  const originalForm = Object.getOwnPropertyDescriptor(globalThis, "HTMLFormElement");
  const originalData = Object.getOwnPropertyDescriptor(globalThis, "FormData");
  class Form {
    dataset = { learnerReviewBatch: "review:music", learnerReviewQuestion: "question-1" };
    /** @type {((event: { preventDefault: () => void, currentTarget: Form }) => void) | null} */ submit = null;
    /** @param {string} _name @param {(event: { preventDefault: () => void, currentTarget: Form }) => void} listener */
    addEventListener(_name, listener) { this.submit = listener; }
  }
  class Values {
    /** @param {string} _name */ getAll(_name) { return []; }
    /** @param {string} name */ get(name) { return name === "blank:blank-1" || name === "answerText" ? "home note" : name === "blank:blank-2" ? "fifth" : null; }
  }
  Object.defineProperty(globalThis, "HTMLFormElement", { configurable: true, value: Form });
  Object.defineProperty(globalThis, "FormData", { configurable: true, value: Values });
  try {
    for (const blanks of [null, [{ id: "blank-1" }], [{ id: "blank-1" }, { id: "blank-2" }]]) for (const score of [0.7, 0.699999]) {
      const correct = score >= 0.7;
      const canonical = blanks?.length === 2 ? "tonic, dominant" : "tonic";
      const projection = { ...review, questions: [{ ...review.questions[0], kind: "fill-blank", choices: null, blanks, pairedVariants: null }] };
      const controller = createLearnerController({ fetch: async (input, options) => {
        if (String(input).endsWith("/answer")) {
          const command = JSON.parse(String(options?.body));
          assert((blanks === null ? command.answerText : command.blankAnswers[0].text) === "home note" && !Object.hasOwn(command, "pairedBlankAnswers"), "Only this card's response is submitted.");
          return response({ result: { correct, score, completed: true, nextDueAt: "2026-09-02T12:00:00.000Z", feedback: { correctAnswer: canonical, explanation: "Source explanation of the tonal center.", components: [{ id: "blank-1", correct, correctAnswer: "tonic" }] } } });
        }
        return response({ result: projection });
      }, baseUrl: "https://app.example.test/", timeoutMs: 1000, escapeHtml: value => value, now: () => "2026-09-01T12:00:00.000Z", createId: () => "test", onChange: () => {} });
      await controller.loadReview();
      const form = new Form();
      controller.bind(/** @type {HTMLElement} */ (/** @type {unknown} */ ({ querySelector: () => null, querySelectorAll: (/** @type {string} */ selector) => selector === "[data-learner-review]" ? [form] : [] })));
      assert(controller.renderReview().includes("Check answer"), "An individual quiz has its own submit button.");
      form.submit?.({ preventDefault: () => {}, currentTarget: form });
      await new Promise(resolve => setTimeout(resolve, 0));
      const html = controller.renderReview();
      assert(html.includes(correct ? "Correct (70%)." : "Partly correct"), "The grading status remains visible.");
      const submitted = `Your answer:</strong> ${blanks?.length === 2 ? "home note, fifth" : "home note"}</p><p class="correct-answer">`;
      assert(html.includes(submitted), "Submitted free text stays directly above the canonical answer, including legacy and multiple blanks.");
      assert(html.includes(`Correct answer:</strong> ${canonical}</p><details`), "Canonical feedback appears after every grading result.");
      assert(html.includes('<details class="source-details"><summary>Source explanation</summary>'), "The source explanation remains available in its drawer.");
      await controller.loadReview(); await controller.refreshDay();
      assert(controller.renderReview().includes(submitted), "Submitted answers and canonical feedback survive navigation and automatic refresh.");
    }
  } finally {
    if (originalForm) Object.defineProperty(globalThis, "HTMLFormElement", originalForm); else Reflect.deleteProperty(globalThis, "HTMLFormElement");
    if (originalData) Object.defineProperty(globalThis, "FormData", originalData);
  }
});


Deno.test("Skip reveals feedback without an answer or progress request, handles retry and survives reload", async () => {
  const originalElement = Object.getOwnPropertyDescriptor(globalThis, "HTMLElement");
  class Button {
    dataset = { questionId: "question-1" };
    /** @type {(() => void) | null} */ click = null;
    /** @param {string} _name @param {() => void} callback */
    addEventListener(_name, callback) { this.click = callback; }
  }
  Object.defineProperty(globalThis, "HTMLElement", { configurable: true, value: Button });
  try {
    let calls = 0, failed = true, revealed = false;
    /** @type {string[]} */ const paths = [];
    /** @type {(value:Response) => void} */ let settle = () => {};
    const skip = { questionId: "question-1", completed: true, feedback: { correctAnswer: "Tritone", explanation: "A tritone spans six semitones." } };
    const controller = createLearnerController({ fetch: async input => {
      const path = String(input); paths.push(path);
      if (path.endsWith("/skip")) { calls++; return await new Promise(resolve => { settle = resolve; }); }
      return response({ result: { ...review, batch: { ...review.batch, status: revealed ? "completed" : "open" }, skipped: revealed ? [skip] : [] } });
    }, baseUrl: "https://app.example.test/", timeoutMs: 1000, escapeHtml: value => value, now: () => "2026-09-01T12:00:00.000Z", createId: () => "test", onChange: () => {} });
    await controller.loadReview();
    const button = new Button();
    /** @type {() => void} */ let refresh = () => {};
    controller.bind(/** @type {HTMLElement} */ (/** @type {unknown} */ ({ querySelector: (/** @type {string} */ selector) => selector === "[data-action='refresh-learner-review']" ? { addEventListener: (/** @type {string} */ _event, /** @type {() => void} */ listener) => { refresh = listener; } } : null, querySelectorAll: (/** @type {string} */ selector) => selector === "[data-action='skip-review']" ? [button] : [] })));
    for (const succeed of [false, true]) {
      button.click?.(); button.click?.();
      refresh();
      assert(calls === (failed ? 1 : 2), "Duplicate pending clicks send one Skip request.");
      assert(!paths.some(path => path.endsWith("/refresh")), "Refresh cannot replace a question while Skip is saving.");
      assert(controller.renderReview().includes('aria-busy="true"') && controller.renderReview().includes("Loading…"), "Pending Skip has visible feedback.");
      settle(succeed ? response({ result: skip }) : new Response(JSON.stringify({ error: "LearningBatchPersistenceFailed" }), { status: 503 }));
      await new Promise(resolve => setTimeout(resolve, 0));
      if (!succeed) {
        assert(controller.renderReview().includes('role="alert"') && controller.renderReview().includes(">Skip<") && !controller.renderReview().includes("Correct answer:"), "Failure retains an unanswered, retryable card.");
        failed = false;
      }
    }
    const html = controller.renderReview();
    assert(html.includes("Skipped.") && html.includes("Correct answer:</strong> Tritone</p><details"), "Skip reveals the correction immediately without marking correct or incorrect.");
    assert(html.includes('<summary>Source explanation</summary>') && html.includes("Refresh batch"), "The source drawer and next-batch action remain available.");
    assert(paths.every(path => !path.includes("/answer") && !path.includes("/progress")), "Skip never submits an answer or refreshes answer-based progress.");
    revealed = true;
    await controller.loadReview();
    assert(controller.renderReview().includes("Skipped.") && controller.renderReview().includes("Correct answer:</strong> Tritone"), "A reload restores skipped feedback.");
  } finally {
    if (originalElement) Object.defineProperty(globalThis, "HTMLElement", originalElement); else Reflect.deleteProperty(globalThis, "HTMLElement");
  }
});

Deno.test("empty quiz answers show an inline prompt without submitting or losing other inputs", async () => {
  const originals = Object.fromEntries(["HTMLFormElement", "FormData"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  class Form {
    dataset = { learnerReviewBatch: "review:music", learnerReviewQuestion: "question-1" };
    prompt = { hidden: true };
    /** @type {((event: { preventDefault: () => void, currentTarget: Form }) => void) | null} */ submit = null;
    /** @param {string} _name @param {(event: { preventDefault: () => void, currentTarget: Form }) => void} listener */
    addEventListener(_name, listener) { this.submit = listener; }
    querySelector() { return this.prompt; }
  }
  class Values {
    getAll() { return []; }
    /** @param {string} name */ get(name) { return name === "blank:blank-1" ? "saved partial response" : "   "; }
  }
  Object.defineProperty(globalThis, "HTMLFormElement", { configurable: true, value: Form });
  Object.defineProperty(globalThis, "FormData", { configurable: true, value: Values });
  try {
    for (const question of [review.questions[0], { ...review.questions[0], kind: "multiple-choice" }, { ...review.questions[0], kind: "fill-blank", choices: null, blanks: null }, { ...review.questions[0], kind: "fill-blank", choices: null, blanks: [{ id: "blank-1" }, { id: "blank-2" }] }]) {
      let requests = 0, renders = 0;
      const controller = createLearnerController({ fetch: async () => { requests++; return response({ result: { ...review, questions: [question] } }); }, baseUrl: "https://app.example.test/", timeoutMs: 1000, escapeHtml: value => value, now: () => "2026-09-01T12:00:00.000Z", createId: () => "test", onChange: () => { renders++; } });
      await controller.loadReview(); const before = renders, form = new Form();
      controller.bind(/** @type {HTMLElement} */(/** @type {unknown} */({ querySelector: () => null, querySelectorAll: (/** @type {string} */ selector) => selector === "[data-learner-review]" ? [form] : [] })));
      assert(controller.renderReview().includes(question.kind === "fill-blank" ? "Fill in every blank before checking." : "Choose an answer before checking."), "prompt matches the answer format");
      form.submit?.({ preventDefault: () => {}, currentTarget: form });
      assert(!form.prompt.hidden && requests === 1 && renders === before, "empty submission reveals its inline prompt without a request or rerender that clears inputs");
    }
  } finally {
    for (const [key, descriptor] of Object.entries(originals)) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
  }
});

Deno.test("Review displays the knowledge point image with the same zoom controls as Feed", async () => {
  const media = { assetId: "diagram", kind: "image", url: "/api/learning-media?assetId=diagram&variant=feed", attribution: "Associated source diagram" };
  const controller = createLearnerController({ fetch: async () => response({ result: { ...review, questions: review.questions.map(question => ({ ...question, media })) } }), baseUrl: "https://app.example.test/", timeoutMs: 1000, escapeHtml: value => value, now: () => "2026-09-01T12:00:00.000Z", createId: () => "test", onChange: () => {} });
  await controller.loadReview();
  const html = controller.renderReview();
  assert(html.includes('data-image-zoom') && html.includes('data-associated-media="true"'), "Review uses Feed's image viewer controls");
  assert(html.includes(media.url) && html.includes(media.attribution), "The bound image and attribution render with the quiz");
  assert(html.includes('data-remove-target="image"'), "Review can remove the image while keeping the quizzes");
});

Deno.test("Feed makes reused source text clickable and escapes both link labels and destinations", async () => {
  const card={knowledgeId:"k",sourceId:"s",sourceRevision:1,sourceClassification:null,sourceClassificationRevision:0,questionId:"q",title:"Source",summary:'A <chord> combines notes.',inlineLinks:[{text:'<chord>',url:'https://example.test/?a=1&b=2'}],sourceUrl:"https://example.test/",evidenceAnchorIds:["p"],media:null,questionLocked:true};
  const escapeHtml=(/** @type {string} */ value)=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
  const controller=createLearnerController({fetch:async()=>response({result:{batch:{...review.batch,batchId:"feed:links",itemIds:["k"]},items:[card]}}),baseUrl:"https://app.example.test/",timeoutMs:1000,escapeHtml,now:()=>"2026-09-08T00:00:00.000Z",createId:()=>"test",onChange:()=>{}});
  await controller.loadFeed();
  const html=controller.renderFeed();
  assert(html.includes('A <a href="https://example.test/?a=1&amp;b=2" target="_blank" rel="noopener noreferrer">&lt;chord&gt;</a> combines notes.'),"Reused text must retain its captured link safely.");
});
