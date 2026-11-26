// @ts-check
const shell = Deno.readTextFileSync("index.html");
Object.defineProperty(globalThis, "document", { configurable: true, value: {
  getElementById: (/** @type {string} */ id) => ({ textContent: shell.match(new RegExp(`<script id="${id}" type="application/json">([\\s\\S]*?)</script>`))?.[1] ?? "" }),
} });
import { buildProgress, isProgressSummary } from "../src/features/progress/public.js";
import { createProgressPage } from "../src/features/progress/page.js";

/** @param {boolean} value @param {string} message */ const assert = (value, message) => { if (!value) throw new Error(message); };
const now = "2026-09-19T12:00:00.000Z";
const attempt = Object.freeze({ batchId: "b", questionId: "q", knowledgeId: null, answeredAt: now, correct: true, score: 1, elapsedDays: 2, previousCorrect: false, primarySubject: "music" });
/** @param {Partial<Record<string,unknown>>} overrides */ const input = overrides => ({ days: 7, now, subject: null, attempts: [attempt], studies: [{ completedAt: now, itemCount: 5 }], subjectCounts: [{ id: "music", count: 1 }], ...overrides });
Deno.test("progress aggregates current UTC day, fractions, recovery, and primary subjects", () => { const result = buildProgress(input({ attempts: [attempt, { ...attempt, batchId: "b2", questionId: "q2", correct: false, score: null, elapsedDays: null, previousCorrect: null, primarySubject: null }] })); assert(result.ok, "valid input"); if (!result.ok) return; assert(result.value.attempts.accuracy === .5 && result.value.attempts.averageScore === 1 && result.value.attempts.scoredCount === 1, "separate score"); assert(result.value.daily.at(-1)?.date === "2026-09-19", "current day"); assert(result.value.recovery.accuracy === 1, "recovery"); assert(result.value.subjects.find(s => s.id === "music")?.accuracy === 1, "primary only"); assert(result.value.intervals.at(-1)?.count === 1, "missing interval"); });
Deno.test("progress distinguishes empty denominators and rejects invalid data", () => { const empty = buildProgress(input({ attempts: [], studies: [] })); assert(empty.ok && empty.value.attempts.accuracy === null && empty.value.daily[0].accuracy === null, "empty nulls"); for (const bad of [input({ days: 8 }), input({ attempts: [{ ...attempt, confidence: 80 }] }), input({ attempts: [{ ...attempt, primarySubject: "nope" }] }), input({ studies: [{ completedAt: now, itemCount: 6 }] })]) assert(!buildProgress(bad).ok, "invalid rejected"); });
Deno.test("progress deduplicates identical attempts and rejects same batch/question conflicts", () => { const duplicate = buildProgress(input({ attempts: [attempt, { ...attempt }] })); assert(duplicate.ok && duplicate.value.attempts.count === 1, "identical dedupe"); const conflict = buildProgress(input({ attempts: [attempt, { ...attempt, answeredAt: "2026-09-19T11:00:00.000Z" }] })); assert(!conflict.ok && conflict.error.field.endsWith("duplicate"), "timestamp conflict"); });
Deno.test("progress rejects invalid scores and excludes future records", () => { assert(!buildProgress(input({ attempts: [{ ...attempt, score: .5, correct: true }] })).ok, "score consistency"); const future = buildProgress(input({ attempts: [{ ...attempt, answeredAt: "2026-09-19T23:00:00.000Z" }] })); assert(future.ok && future.value.attempts.count === 0, "future excluded"); });
Deno.test("progress accepts composed workflow identifiers and still rejects empty or padded identifiers", () => {
  const knowledgeId = `knowledge:source:${"a".repeat(64)}:1:${"b".repeat(64)}`;
  const questionId = `knowledge-workflow-task:run:${knowledgeId}:${knowledgeId}:choice`;
  const result = buildProgress(input({ attempts: [{ ...attempt, knowledgeId, questionId }] }));
  assert(questionId.length > 200, "Fixture covers workflow identifiers beyond the former limit");
  assert(result.ok && result.value.activity.at(-1)?.studyItems === 5 && result.value.activity.at(-1)?.reviewAttempts === 1, "Valid workflow answers retain both activity counts");
  for (const field of ["batchId", "questionId", "knowledgeId"]) {
    for (const value of [null, 1, "", " ", " padded"]) {
      if (field === "knowledgeId" && value === null) continue;
      assert(!buildProgress(input({ attempts: [{ ...attempt, [field]: value }] })).ok, "Invalid identifiers remain rejected");
    }
  }
});
Deno.test("progress page safely reports malformed responses", async () => {
  const result = buildProgress(input({ attempts: [] })); if (!result.ok) throw new Error("fixture invalid");
  /** @param {string} value */ const escapeHtml = value => value.replaceAll("<", "&lt;");
  const response = { result: { ...result.value, period: { ...result.value.period, startedOn: "<script>" } } };
  const page = createProgressPage({ fetch: /** @type {typeof fetch} */(async () => new Response(JSON.stringify(response))), baseUrl: "https://example.test/", escapeHtml, onChange: () => {} });
  await page.load(); assert(page.render().includes("Progress data could not be read"), "invalid date rejected");
  const malformed = createProgressPage({ fetch: /** @type {typeof fetch} */(async () => new Response("{}")), baseUrl: "https://example.test/", escapeHtml, onChange: () => {} });
  await malformed.load(); assert(malformed.render().includes("Progress data could not be read"), "malformed response safe");
});
Deno.test("empty progress replaces unused plots with guidance and keeps real activity", async () => {
  const result = buildProgress(input({ attempts: [] })); if (!result.ok) throw new Error("fixture invalid");
  const page = createProgressPage({ fetch: async () => new Response(JSON.stringify({ result: result.value })), baseUrl: "https://example.test/", escapeHtml: value => value, onChange: () => {} });
  await page.load(); const html = page.render();
  assert(!html.includes("What these measurements mean") && !html.includes("progress-definitions"), "The removed bottom explanation must not render.");
  assert(html.includes('href="#review">Start reviewing') && html.includes("empty-states.svg#progress"), "Review action and decorative empty-state art");
  assert(!html.includes('aria-label="Daily accuracy chart"') && html.includes('aria-label="Activity calendar chart"'), "no blank accuracy canvas; activity remains");
  assert(html.includes("Review attempts</span><strong>0</strong>") && html.includes("Unavailable") && !html.includes("<table"), "honest empty metrics without a data table");
});
Deno.test("progress page ignores stale out-of-order responses", async () => {
  const first = Promise.withResolvers(), second = Promise.withResolvers(); let call = 0;
  const one = buildProgress(input({ attempts: [attempt] })), none = buildProgress(input({ attempts: [] })); if (!one.ok || !none.ok) throw new Error("fixtures invalid");
  const page = createProgressPage({ fetch: /** @type {typeof fetch} */(() => (++call === 1 ? first.promise : second.promise)), baseUrl: "https://example.test/", escapeHtml: value => value, onChange: () => {} });
  const loadingOne = page.load(), loadingTwo = page.load(); second.resolve(new Response(JSON.stringify({ result: none.value }))); await loadingTwo; first.resolve(new Response(JSON.stringify({ result: one.value }))); await loadingOne;
  assert(page.render().includes("Review attempts</span><strong>0</strong>"), "latest response wins");
});

Deno.test("progress response validates ratios, real dates and recovery counts", () => {
  const result = buildProgress(input({})); if (!result.ok) throw new Error("fixture invalid");
  assert(isProgressSummary(result.value), "valid summary");
  for (const bad of [
    { ...result.value, attempts: { ...result.value.attempts, averageScore: 2 } },
    { ...result.value, attempts: { ...result.value.attempts, scoredCount: 0 } },
    { ...result.value, recovery: { eligible: -1, recovered: -1, accuracy: 1 } },
    { ...result.value, period: { ...result.value.period, startedOn: "2026-02-30" } },
  ]) assert(!isProgressSummary(bad), "malformed summary rejected");
  const reordered = Object.fromEntries(Object.entries(attempt).reverse());
  const deduped = buildProgress(input({ attempts: [attempt, reordered] }));
  assert(deduped.ok && deduped.value.attempts.count === 1, "property order is not new evidence");
});

Deno.test("progress charts connect review days and escape labels; malformed JSON is named", async () => {
  const result = buildProgress(input({ attempts: [attempt, { ...attempt, batchId: "earlier", answeredAt: "2026-09-17T12:00:00Z" }] }));
  if (!result.ok) throw new Error("fixture invalid");
  const summary = { ...result.value, subjects: result.value.subjects.map(r => ({ ...r, label: "<img src=x onerror=alert(1)>" })) };
  const page = createProgressPage({ fetch: async () => new Response(JSON.stringify({ result: summary })), baseUrl: "https://example.test/", escapeHtml: value => value.replaceAll("<", "&lt;"), onChange: () => {} });
  await page.load(); const html = page.render();
  assert((html.match(/<line /g) ?? []).length === 1, "separated observations are connected across days without attempts");
  assert(html.includes("<circle") && !html.includes("<img"), "dots and escaped labels");
  const invalid = createProgressPage({ fetch: async () => new Response("{"), baseUrl: "https://example.test/", escapeHtml: value => value, onChange: () => {} });
  await invalid.load(); assert(invalid.render().includes("Progress data could not be read"), "JSON parse error is malformed data");
});

Deno.test("primary subjects rank library knowledge counts, cap at five and never count repeated quiz attempts", () => {
  const subjectCounts = [{ id: "music", count: 4 }, { id: "physics", count: 9 }, { id: "computing", count: 20 }, { id: "history", count: 1 }, { id: "biology", count: 7 }, { id: "mathematics", count: 12 }, { id: "arts", count: 0 }];
  const result = buildProgress(input({ subjectCounts, attempts: Array.from({ length: 30 }, (_, i) => ({ ...attempt, batchId: `b${i}` })) }));
  assert(result.ok, "valid counts"); if (!result.ok) return;
  assert(result.value.subjects.map(s => s.id).join() === "computing,mathematics,physics,biology,music", "largest five in descending knowledge count");
  assert(result.value.subjects.at(-1)?.accuracy === 1, "30 quiz attempts affect accuracy but not subject ordering");
  const filtered = buildProgress(input({ subject: "music", subjectCounts }));
  assert(filtered.ok && filtered.value.subjects.length === 1 && filtered.value.subjects[0].accuracy === 1, "subject filter respected");
  for (const bad of [null, [{ id: "music", count: -1 }], [{ id: "music", count: 1.5 }], [{ id: "invented", count: 1 }], [{ id: "music", count: 1 }, { id: "music", count: 2 }]]) assert(!buildProgress(input({ subjectCounts: bad })).ok, "invalid knowledge counts rejected");
});

Deno.test("daily accuracy labels every date with readable spacing and connects only recorded scores across periods", async () => {
  for (const days of [7, 30, 90]) {
    const result = buildProgress(input({ days, now: "2026-01-04T12:00:00Z", attempts: [
      { ...attempt, answeredAt: "2025-12-29T12:00:00Z" },
      { ...attempt, batchId: "zero", answeredAt: "2026-01-02T12:00:00Z", correct: false, score: 0 },
      { ...attempt, batchId: "last", answeredAt: "2026-01-04T12:00:00Z" },
    ] }));
    if (!result.ok) throw new Error("fixture invalid");
    const page = createProgressPage({ fetch: async () => Response.json({ result: result.value }), baseUrl: "https://example.test/", escapeHtml: value => value, onChange: () => {} });
    await page.load(); const html = page.render();
    const chart = html.slice(html.indexOf('<svg height="220"'), html.indexOf("</svg>") + 6);
    const labels = [...chart.matchAll(/<text x="([^"]+)%" y="155" style="transform-origin:[^"]+;rotate:-60deg">(\d{4}-\d{2}-\d{2})<\/text>/g)];
    assert(labels.map(label => label[2]).join() === result.value.daily.map(row => row.date).join(), "every calendar date, including missing scores and year boundaries, is labelled and tilted");
    const width = Number(chart.match(/min-width:(\d+)px/)?.[1]);
    for (let i = 1; i < labels.length; i++) assert((Number(labels[i][1]) - Number(labels[i-1][1])) * width / 100 > 31, "minimum 32px day spacing is retained for horizontal scrolling");
    assert((chart.match(/data-chart-value=/g) ?? []).length === 3 && chart.includes('data-chart-value="0%"'), "missing days never become scores; genuine zero remains a point");
    const lines = [...chart.matchAll(/<line x1="([^"]+)" y1="([^"]+)" x2="([^"]+)" y2="([^"]+)"/g)];
    assert(lines.length === 2 && lines[0][3] === lines[1][1] && lines[0][4] === "135" && lines[1][2] === "135", "one connected line passes through the zero score with calendar spacing preserved");
    assert(Number(lines[0][3].slice(0,-1)) - Number(lines[0][1].slice(0,-1)) > Number(lines[1][3].slice(0,-1)) - Number(lines[1][1].slice(0,-1)), "four-day gap is wider than two-day gap");
  }
});

Deno.test("Progress has only interactive daily and subject accuracy charts plus activity without tables or recovery", async () => {
  const result = buildProgress(input({ attempts: [attempt, { ...attempt, batchId: "wrong", correct: false, score: 0 }] })); if (!result.ok) throw new Error("fixture invalid");
  const page = createProgressPage({ fetch: async () => Response.json({ result: result.value }), baseUrl: "https://example.test/", escapeHtml: value => value, onChange: () => {} });
  await page.load(); const html = page.render();
  for (const removed of ["<table", "<details", "data table", "Recovery after", "Recorded activity", "Spacing intervals", "Unclassified"]) assert(!html.includes(removed), `${removed} removed`);
  assert((html.match(/data-progress-chart/g) ?? []).length === 3, "three remaining charts");
  assert(html.includes('data-chart-value="50%"'), "exact daily accuracy on its point");
  assert(html.includes('data-chart-value="5 cards · 2 quizzes"'), "activity details on its cell");
  assert(html.includes('aria-label="Music & Performing Arts: 50%" data-chart-value="50%"'), "accuracy on subject bar");
  assert(html.includes("Review accuracy by subject") && !html.includes("Primary subjects") && !html.includes("1 knowledge points"), "subject purpose and accuracy replace displayed inventory counts");
  assert(html.includes('--bar-width:50%'), "bar uses absolute accuracy rather than inventory count");
  assert(html.includes('aria-label="2026-09-19: 50%"') && html.includes('aria-label="2026-09-19: 5 cards · 2 quizzes"'), "dates remain available to screen readers");
  assert(html.includes('y="210" text-anchor="middle">09-14</text>') && html.includes('>Mon</text>') && html.includes('>Sun</text>'), "calendar exposes week dates and weekday axes");
  for (const redundant of ["correct answers", "scored attempts", "One per question", "Stronger shading", "Answer accuracy by day", "Accuracy for the selected period"]) assert(!html.includes(redundant), `${redundant} is omitted`);
  assert(html.includes("Top 5 by knowledge points.") && !html.includes("Gaps mean no review attempts."), "subject ranking note remains; obsolete disconnected-line note is removed");
  assert((html.match(/role="tooltip" hidden/g) ?? []).length === 3, "data readouts start hidden");
  assert(html.includes('tabindex="0" role="img"'), "chart data is keyboard and screen-reader accessible");
});

Deno.test("chart values respond to hover, tap and focus, dismiss on exit, outside tap and Escape", async () => {
  const originalElement = Object.getOwnPropertyDescriptor(globalThis, "Element");
  class Point {
    /** @param {string} value */ constructor(value) { this.value = value; }
    closest() { return this; }
    getAttribute() { return this.value; }
    getBoundingClientRect() { return { left: 290, top: 200, bottom: 220, width: 10 }; }
  }
  Object.defineProperty(globalThis, "Element", { configurable: true, value: Point });
  try {
    const handlers = new Map(), rootHandlers = new Map();
    const tooltip = { hidden: true, textContent: "", style: { left: "", top: "" }, offsetWidth: 100, offsetHeight: 40 };
    const plot = { querySelector: () => tooltip, getBoundingClientRect: () => ({ left: 0, top: 100, width: 300 }), addEventListener: (/** @type {string} */ name, /** @type {(e:any)=>void} */ handler) => handlers.set(name, handler) };
    const root = { querySelector: () => null, querySelectorAll: (/** @type {string} */ selector) => selector === "[data-progress-chart]" ? [plot] : [tooltip], addEventListener: (/** @type {string} */ name, /** @type {(e:any)=>void} */ handler) => rootHandlers.set(name, handler) };
    const page = createProgressPage({ fetch: async () => Response.json({}), baseUrl: "https://example.test/", escapeHtml: value => value, onChange: () => {} });
    page.bind(/** @type {HTMLElement} */(/** @type {unknown} */(root)));
    const point = new Point("50%");
    for (const name of ["pointerover", "click", "focusin"]) {
      handlers.get(name)({ target: point });
      assert(!tooltip.hidden && tooltip.textContent === point.value, `${name} reveals the data value`);
      assert(tooltip.style.left === "200px" && tooltip.style.top === "52px", "readout stays near the point and within the chart width");
      handlers.get("pointerout")({ pointerType: "touch" }); assert(!tooltip.hidden, "touch readout persists after lifting finger");
      handlers.get("pointerout")({ pointerType: "mouse" }); assert(tooltip.hidden, "mouse exit dismisses");
    }
    handlers.get("click")({ target: point }); rootHandlers.get("pointerdown")({ target: {} }); assert(tooltip.hidden, "outside tap dismisses");
    handlers.get("focusin")({ target: point }); rootHandlers.get("keydown")({ key: "Escape" }); assert(tooltip.hidden, "Escape dismisses");
    handlers.get("focusin")({ target: point }); handlers.get("focusout")({}); assert(tooltip.hidden, "blur dismisses");
    handlers.get("click")({ target: point }); handlers.get("scroll")({}); assert(tooltip.hidden, "scroll dismisses a readout whose anchor moved");
  } finally {
    if (originalElement) Object.defineProperty(globalThis, "Element", originalElement);
    else Reflect.deleteProperty(globalThis, "Element");
  }
});

Deno.test("subject accuracy uses selected-period attempts and distinguishes no attempts from zero accuracy", async () => {
  const result = buildProgress(input({ subjectCounts: [{ id: "computing", count: 20 }, { id: "music", count: 4 }, { id: "physics", count: 3 }], attempts: [attempt, { ...attempt, batchId: "wrong", correct: false, score: 0 }, { ...attempt, batchId: "physics-wrong", primarySubject: "physics", correct: false, score: 0 }, { ...attempt, batchId: "old", answeredAt: "2026-08-01T10:00:00.000Z" }] }));
  assert(result.ok, "valid subject accuracy input"); if (!result.ok) return;
  assert(JSON.stringify(result.value.subjects.map(row => [row.id, row.accuracy])) === JSON.stringify([["computing", null], ["music", .5], ["physics", 0]]), "inventory orders subjects while in-period answers determine accuracy");
  assert(result.value.subjects.every(row => !Object.hasOwn(row, "count")), "inventory counts are not part of displayed chart data");
  assert(isProgressSummary(result.value), "new summary contract is valid");
  assert(!isProgressSummary({ ...result.value, subjects: [{ id: "music", label: "Music", accuracy: 2 }] }), "invalid subject accuracy rejected");
  const page = createProgressPage({ fetch: async () => Response.json({ result: result.value }), baseUrl: "https://example.test/", escapeHtml: value => value, onChange: () => {} });
  await page.load(); const html = page.render();
  assert(html.includes('aria-label="Computer Science & AI: Unavailable" data-chart-value="Unavailable"') && html.includes('aria-label="Physics & Astronomy: 0%" data-chart-value="0%"'), "no data and genuine zero remain distinct");
});

Deno.test("calendar axes align weekdays and week dates across periods and year boundaries", async () => {
  for (const days of [7, 30, 90]) {
    const result = buildProgress(input({ days, now: "2026-01-04T12:00:00Z", attempts: [], studies: [] }));
    if (!result.ok) throw new Error("fixture invalid");
    const page = createProgressPage({ fetch: async () => Response.json({ result: result.value }), baseUrl: "https://example.test/", escapeHtml: value => value, onChange: () => {} });
    await page.load(); const html = page.render(), calendar = html.slice(html.indexOf('aria-label="Activity calendar chart"'), html.indexOf('class="progress-tooltip"', html.indexOf('aria-label="Activity calendar chart"')));
    const cells = [...calendar.matchAll(/aria-label="(\d{4}-\d{2}-\d{2}): [^"]*" data-chart-value="[^"]*"><rect x="[^"]*" y="(\d+)"/g)];
    assert(cells.length === days, "each in-period day has one calendar cell");
    for (const [, date, y] of cells) assert(Number(y) === 8 + (new Date(date).getUTCDay() + 6) % 7 * 26, "cell matches its weekday label");
    assert(calendar.includes('>12-29</text>') && calendar.includes('>Sun</text>'), "last week and Sunday remain labelled across New Year");
    const readouts = [...calendar.matchAll(/data-chart-value="([^"]*)"/g)].map(match => match[1]);
    assert(readouts.every(value => value === "0 cards · 0 quizzes"), "empty-day readouts contain only quantities");
  }
});

Deno.test("cached Progress remains visible during a refresh, failure and successful retry", async () => {
  const result = buildProgress(input({})); if (!result.ok) throw new Error("Invalid fixture");
  let next = Promise.resolve(Response.json({ result: result.value }));
  const page = createProgressPage({ fetch: async () => await next, baseUrl: "https://example.test/", escapeHtml: value => value, onChange() {} });
  await page.load();
  /** @type {(value:Response)=>void} */ let settle = () => {};
  next = new Promise(resolve => { settle = resolve; });
  const refresh = page.load();
  assert(page.render().includes('class="progress-summary"') && page.render().includes('role="status">Updating progress'), "Previously loaded metrics remain visible while refreshing.");
  settle(Response.json({}, { status: 503 })); await refresh;
  assert(page.render().includes('class="progress-summary"') && page.render().includes('role="alert"') && page.render().includes('data-action="retry-progress"'), "A failed refresh retains metrics and offers a retry.");
  next = Promise.resolve(Response.json({ result: result.value })); await page.load();
  assert(page.render().includes('class="progress-summary"') && !page.render().includes('role="alert"'), "Retry replaces the error with the refreshed content.");
});

Deno.test("calendar intensity follows the current daily activity goal, not the busiest day", async () => {
  const result = buildProgress(input({ studies: [{ completedAt: now, itemCount: 2 }, { completedAt: "2026-09-18T12:00:00Z", itemCount: 5 }] }));
  if (!result.ok) throw new Error("Invalid fixture");
  let targets = { dailyStudyTarget: 4, dailyRecallLimit: 2 };
  const page = createProgressPage({ fetch: async () => Response.json({ result: result.value }), baseUrl: "https://example.test/", escapeHtml: value => value, onChange() {}, getSettings: () => targets });
  await page.load();
  const opacity = () => Math.min(1, Number(page.render().match(/aria-label="2026-09-19: [^"]*"[^>]*><rect[^>]*opacity="([^"]+)"/)?.[1]));
  assert(opacity() === .5, "Half of each goal gives partial intensity");
  targets = { dailyStudyTarget: 2, dailyRecallLimit: 1 };
  assert(opacity() === 1, "Lower fulfilled goals immediately give maximum intensity despite a busier day");
  targets = { dailyStudyTarget: 1, dailyRecallLimit: 2 };
  assert(opacity() === 1, "Combined daily activity reaching the combined target gives full intensity");
  targets = { dailyStudyTarget: 2, dailyRecallLimit: 0 };
  assert(opacity() === 1, "A disabled review goal does not prevent full study completion");
  targets = { dailyStudyTarget: 1, dailyRecallLimit: 1 };
  assert(opacity() === 1, "Exceeding goals stays capped at maximum intensity");
});
