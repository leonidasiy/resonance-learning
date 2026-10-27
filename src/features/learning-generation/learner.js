// @ts-check
import { createShellMarkup } from "../../shell-markup.js";
import { pendingSpark, playSpark, sparkIcon } from "../experience/spark.js";

import { inlineLinkSpans } from "../knowledge-workflows/inline-links.js";

import { sourceHref } from "../source-library/source-link.js";

import { SUBJECTS } from "../knowledge-subjects/public.js";
import { subjectPresentation } from "../knowledge-subjects/presentation.js";

import { showGoalCelebration } from "./celebration.js";

import { LearningBatchGatewayClient } from "./batches-gateway.js";

/** @import { FeedBatchProjection, LearningBatchGatewayFailure, LearningKnowledgeCard, LearningReviewQuestion, ReviewBatchProjection } from "./batches-gateway.js" */

/**
 * @typedef {{
 *   readonly fetch: typeof fetch,
 *   readonly baseUrl: string,
 *   readonly timeoutMs: number,
 *   readonly escapeHtml: (value: string) => string,
 *   readonly now: () => string,
 *   readonly createId: () => string,
 *   readonly getDailyTargets?: () => { readonly learning: number, readonly review: number },
 *   readonly onChange: (notice?: string, preferredFocusKey?: string | null, fallbackHeadingId?: string | null, refreshedView?: "feed" | "review", preserveScroll?: boolean) => void
 * }} LearnerControllerDependencies
 */

const freeze = Object.freeze;
const feedMarkup = createShellMarkup("feed-markup");

/** @param {LearnerControllerDependencies} dependencies */
export function createLearnerController(dependencies) {
  if (typeof dependencies?.fetch !== "function" || !URL.canParse(dependencies.baseUrl) || !Number.isInteger(dependencies.timeoutMs) || dependencies.timeoutMs < 1 || typeof dependencies.escapeHtml !== "function" || typeof dependencies.now !== "function" || typeof dependencies.createId !== "function" || typeof dependencies.onChange !== "function") throw new TypeError("Learner controller dependencies are invalid.");
  const { createId, escapeHtml, now, onChange } = dependencies;
  const gateway = new LearningBatchGatewayClient({ fetch: dependencies.fetch, baseUrl: dependencies.baseUrl, timeoutMs: dependencies.timeoutMs });
  /** @type {{ readonly state: "idle" | "loading" | "success" | "error", readonly value: FeedBatchProjection | null, readonly error: LearningBatchGatewayFailure | null }} */ let feed = { state: "idle", value: null, error: null };
  /** @type {{ readonly state: "idle" | "loading" | "success" | "error", readonly value: ReviewBatchProjection | null, readonly error: LearningBatchGatewayFailure | null }} */ let review = { state: "idle", value: null, error: null };
  /** @type {Map<string, { readonly correct: boolean, readonly score: number, readonly explanation: string, readonly correctAnswer: string, readonly skipped?: boolean }> } */ const answers = new Map();
  /** @type {Map<string, { readonly selectedChoiceIds: readonly string[], readonly answerText: string, readonly blanks: Readonly<Record<string, string>> }> } */ const attempts = new Map();
  /** @type {Map<string, LearningBatchGatewayFailure>} */ const questionErrors = new Map();

  const pending = new Set();
  const celebrations = new Set();
  /** @type {Map<string, string>} */ const preferences = new Map();
  let classificationMessage = "";
  /** @type {{ readonly date: string, readonly studyItems: number, readonly reviewAttempts: number } | null} */ let dailyProgress = null;
  /** @type {Promise<void> | null} */ let progressLoad = null;
  let feedDay = "", reviewDay = "";
  let reviewCelebrationDay = "";
  /** @type {Map<string, number>} */ const countdowns = new Map();
  /** @type {Map<string, number>} */ const replacementHeights = new Map();
  /** @type {HTMLElement | null} */ let countdownRoot = null;
  /** @type {ReturnType<typeof setTimeout> | undefined} */ let countdownTimer;

  /** @param {string} key */
  function startCountdown(key) { if (!countdowns.has(key)) countdowns.set(key, Date.now() + 10_000); }

  function unbind() {
    clearTimeout(countdownTimer);
    countdownRoot = null;
  }

  function tickCountdowns() {
    const root = countdownRoot;
    if (!root?.isConnected) return;
    for (const [key, deadline] of countdowns) {
      const remaining = Math.max(0, deadline - Date.now());
      const button = root.querySelector(`[data-review-countdown="${CSS.escape(key)}"]`);
      const seconds = button?.querySelector("[data-countdown-seconds]");
      if (seconds) seconds.textContent = String(Math.ceil(remaining / 1000));
      button?.querySelector(".spark-ring")?.setAttribute("stroke-dashoffset", String(100 - remaining / 100));
      if (remaining === 0 && !review.value?.questions.some(question => questionPending(question.questionId)) && review.state !== "loading") {
        if (key === "batch") void refreshReview(true);
        else void replaceReview(key);
        return;
      }
    }
    if (countdowns.size) countdownTimer = setTimeout(tickCountdowns, 1000);
  }

  /** @param {string} key @param {string} label @param {string} action @param {string} [questionId] */
  function countdownButton(key, label, action, questionId = "") {
    const remaining = Math.max(0, (countdowns.get(key) ?? Date.now()) - Date.now());
    return feedMarkup(30, action, escapeHtml(questionId), escapeHtml(key), escapeHtml(key), 100 - remaining / 100, Math.ceil(remaining / 1000), label);
  }

  async function loadDailyProgress() {
    if (!dependencies.getDailyTargets) return;
    if (progressLoad !== null) return await progressLoad;
    progressLoad = (async () => {
      const result = await gateway.loadProgress();
      dailyProgress = result.ok ? result.value.activity.find(row => row.date === day()) ?? null : null;
    })().finally(() => { progressLoad = null; });
    await progressLoad;
  }

  /** @param {"learning" | "review"} kind */
  function renderDailyGoal(kind) {
    if (!dependencies.getDailyTargets) return "";
    const target = dependencies.getDailyTargets()[kind];
    const count = kind === "learning" ? dailyProgress?.studyItems : dailyProgress?.reviewAttempts;
    const label = feedMarkup(kind === "learning" ? 24 : 25);
    return feedMarkup(23, count === undefined ? "Progress unavailable" : `${count} / ${target}`, label);
  }

  async function refreshDay() {
    if (pending.size > 0 || feed.state === "loading" || review.state === "loading" || (feedDay === day() && reviewDay === day())) return;
    await Promise.all([loadFeed(), loadReview()]);
  }

  /** @param {string} key */
  function actionState(key) {
    return `data-spark-button data-focus-key="${escapeHtml(key)}" ${pending.has(key) ? 'aria-disabled="true" aria-busy="true"' : ""} ${celebrations.has(key) ? `data-spark-event="${escapeHtml(key)}"` : ""}`;
  }
  /** @param {string} key @param {string} label @param {string} waiting */
  function actionLabel(key, label, waiting) { return pending.has(key) ? `${pendingSpark()}${waiting}` : label; }
  /** @param {string} key */
  function begin(key) {
    if (pending.has(key)) return false;
    pending.add(key);
    onChange(undefined, key);
    return true;
  }

  function day() { return now().slice(0, 10); }

  /** @param {boolean} [resetView] */
  async function loadFeed(resetView = false) {
    feed = { state: "loading", value: feed.value, error: null };
    onChange();
    const requestedDay = day();
    const result = await gateway.loadFeed(requestedDay);
    if (result.ok) feedDay = requestedDay;
    await loadDailyProgress();
    feed = result.ok ? { state: "success", value: result.value, error: null } : { state: "error", value: null, error: result.error };
    onChange(undefined, null, null, result.ok && resetView ? "feed" : undefined);
    return result;
  }

  /** @param {boolean} [resetView] */
  async function loadReview(resetView = false) {
    // Keep the visible attempt and its feedback until an explicit batch or page refresh.
    if (review.value && (answers.size || pending.size)) return { ok: true, value: review.value };
    review = { state: "loading", value: review.value, error: null };
    onChange();
    const requestedDay = day();
    const result = await gateway.loadReview(requestedDay);
    if (result.ok) reviewDay = requestedDay;
    await loadDailyProgress();
    if (result.ok) {
      countdowns.clear();
      for (const skipped of result.value.skipped) {
        answers.set(skipped.questionId, { correct: false, score: 0, ...skipped.feedback, skipped: true });
        startCountdown(skipped.questionId);
      }
      if (result.value.batch?.status === "completed" && !result.value.skipped.length) startCountdown("batch");
    }
    review = result.ok ? { state: "success", value: result.value, error: null } : { state: "error", value: null, error: result.error };
    onChange(undefined, null, null, result.ok && resetView ? "review" : undefined);
    return result;
  }

  async function refreshFeed() {
    if (!begin("feed-refresh")) return;
    const result = await gateway.refreshFeed(`feed-refresh:${createId()}`);
    pending.delete("feed-refresh");
    feed = result.ok ? { state: "success", value: result.value, error: null } : { state: "error", value: feed.value, error: result.error };
    onChange(undefined, result.ok ? null : "feed-refresh", null, result.ok ? "feed" : undefined);
  }

  async function completeFeed() {
    const batch = feed.value?.batch;
    if (batch === null || batch === undefined || batch.status !== "open") return;
    if (!begin("feed-complete")) return;
    await loadDailyProgress();
    const studiedBefore = dailyProgress?.studyItems;
    const result = await gateway.completeFeed(batch.batchId, `feed-complete:${batch.batchId}`);
    pending.delete("feed-complete");
    if (!result.ok) {
      feed = { state: "error", value: feed.value, error: result.error };
      onChange();
      return;
    }
    await Promise.all([loadFeed(true), ...(review.value?.batch == null ? [loadReview()] : [])]);
    const targets = dependencies.getDailyTargets?.();
    if (targets && studiedBefore !== undefined && studiedBefore < targets.learning && dailyProgress !== null && dailyProgress.studyItems >= targets.learning) {
      showGoalCelebration("learning", dailyProgress.studyItems, Math.max(0, targets.review - dailyProgress.reviewAttempts));
    }
  }

  /** @param {boolean} [resetAtStart] */
  async function refreshReview(resetAtStart = false) {
    if (review.state === "loading" || review.value?.questions.some(question => questionPending(question.questionId)) || pending.has("review-refresh")) return;
    countdowns.clear();
    pending.add("review-refresh");
    onChange(undefined, "review-refresh", null, resetAtStart ? "review" : undefined);
    const result = await gateway.refreshReview(`review-refresh:${createId()}`);
    pending.delete("review-refresh");
    if (result.ok) {
      answers.clear();
      attempts.clear();
      questionErrors.clear();
      replacementHeights.clear();
    }
    review = result.ok ? { state: "success", value: result.value, error: null } : { state: "error", value: review.value, error: result.error };
    onChange(undefined, result.ok ? null : "review-refresh", null, result.ok ? "review" : undefined);
    return result;
  }

  /** @param {string} questionId */
  function questionPending(questionId) { return pending.has("review-refresh") || pending.has(`review-submit:${questionId}`) || pending.has(`review-skip:${questionId}`) || pending.has(`review-remove:${questionId}`) || pending.has(`review-replace:${questionId}`); }

  /** @param {string} questionId */
  async function replaceReview(questionId) {
    const question = review.value?.questions.find(item => item.questionId === questionId);
    const batch = review.value?.batch;
    if (!question || !batch || !answers.get(questionId)?.skipped || review.value?.questions.some(item => questionPending(item.questionId))) return;
    countdowns.delete(questionId);
    const height = countdownRoot?.querySelector(`[data-review-question="${CSS.escape(questionId)}"]`)?.getBoundingClientRect().height;
    const key = `review-replace:${questionId}`;
    questionErrors.delete(questionId);
    pending.add(key);
    onChange(undefined, `review-countdown:${questionId}`, null, undefined, true);
    const result = await gateway.replaceReview(batch.batchId, questionId, question.revision, `review-replace:${batch.batchId}:${questionId}`);
    pending.delete(key);
    if (result.ok && review.value?.batch?.batchId === batch.batchId) {
      review = { state: "success", value: { ...review.value, batch: result.value.batch, questions: review.value.questions.map(item => item.questionId === questionId ? result.value.questions[0] : item), skipped: review.value.skipped.filter(item => item.questionId !== questionId) }, error: null };
      answers.delete(questionId);
      replacementHeights.delete(questionId);
      if (height) replacementHeights.set(result.value.questions[0].questionId, height);
      onChange(undefined, `review-question:${result.value.questions[0].questionId}`, null, undefined, true);
    } else {
      if (!result.ok) questionErrors.set(questionId, result.error);
      onChange(undefined, `review-countdown:${questionId}`, null, undefined, true);
    }
  }

  /** @param {HTMLFormElement} form */
  async function answerReview(form) {
    const batchId = form.dataset.learnerReviewBatch ?? "";
    const questionId = form.dataset.learnerReviewQuestion ?? "";
    const formData = new FormData(form);
    const selectedChoiceIds = formData.getAll("selectedChoiceIds").filter((value) => typeof value === "string");
    const answerText = formData.get("answerText");
    const question = review.value?.questions.find((candidate) => candidate.questionId === questionId);
    const blankAnswers = question?.blanks?.map((blank) => ({ id: blank.id, text: formData.get(`blank:${blank.id}`) })) ?? null;
    if (batchId === "" || questionId === "" || question === undefined) return;
    if (question.kind === "fill-blank" ? blankAnswers === null ? typeof answerText !== "string" || answerText.trim() === "" : blankAnswers.some(answer => typeof answer.text !== "string" || answer.text.trim() === "") : selectedChoiceIds.length === 0) {
      const prompt = /** @type {HTMLElement|null} */(form.querySelector("[data-answer-prompt]"));
      if (prompt) prompt.hidden = false;
      return;
    }
    const actionKey = `review-submit:${questionId}`;
    if (questionPending(questionId) || answers.has(questionId)) return;
    const reviewedBefore = dailyProgress?.reviewAttempts;
    questionErrors.delete(questionId);
    attempts.set(questionId, { selectedChoiceIds: freeze([...selectedChoiceIds]), answerText: String(answerText ?? ""), blanks: freeze(Object.fromEntries((question.blanks ?? []).map(blank => [blank.id, String(formData.get(`blank:${blank.id}`) ?? "")])))});
    begin(actionKey);
    const result = await gateway.answerReview(batchId, questionId, /** @type {string[]} */ (selectedChoiceIds), `review-answer:${batchId}:${questionId}`, typeof answerText === "string" ? answerText : null, blankAnswers === null ? null : blankAnswers.map((answer) => ({ id: answer.id, text: /** @type {string} */ (answer.text) })), question.revision);
    pending.delete(actionKey);
    if (!result.ok) {
      questionErrors.set(questionId, result.error);
      onChange(undefined, actionKey);
      return;
    }
    showFeedback(questionId, result.value);
    onChange(undefined, `review-feedback:${questionId}`, "review-title");
    await loadDailyProgress();
    onChange();
    const target = dependencies.getDailyTargets?.().review;
    if (target !== undefined && reviewedBefore !== undefined && reviewedBefore < target && dailyProgress !== null && dailyProgress.reviewAttempts >= target && reviewCelebrationDay !== day()) {
      reviewCelebrationDay = day();
      showGoalCelebration("review", dailyProgress.reviewAttempts);
    }
  }

  /** @param {HTMLElement} button */
  async function skipReview(button) {
    const questionId = button.dataset.questionId ?? "";
    const question = review.value?.questions.find(item => item.questionId === questionId);
    const batch = review.value?.batch;
    const key = `review-skip:${questionId}`;
    if (!question || !batch || questionPending(questionId) || answers.has(questionId)) return;
    questionErrors.delete(questionId);
    begin(key);
    const result = await gateway.skipReview(batch.batchId, questionId, question.revision, `review-skip:${batch.batchId}:${questionId}`);
    pending.delete(key);
    if (result.ok) showFeedback(questionId, { ...result.value, correct: false, score: 0 }, true);
    else questionErrors.set(questionId, result.error);
    onChange(undefined, result.ok ? `review-feedback:${questionId}` : key, "review-title");
  }

  /** @param {HTMLElement} button */
  async function removeReview(button) {
    const questionId = button.dataset.questionId ?? "";
    const question = review.value?.questions.find(item => item.questionId === questionId);
    const batch = review.value?.batch;
    if (!question || !batch || questionPending(questionId) || !answers.has(questionId) && batch.status !== "completed") return;
    const key = `review-remove:${questionId}`;
    questionErrors.delete(questionId);
    begin(key);
    const result = await gateway.removeReview(batch.batchId, questionId, question.revision, `review-remove:${batch.batchId}:${questionId}`);
    pending.delete(key);
    if (result.ok && review.value) {
      review = { ...review, value: { ...review.value, questions: review.value.questions.filter(item => item.questionId !== questionId), skipped: review.value.skipped.filter(item => item.questionId !== questionId), dueCount: Math.max(0, review.value.dueCount - (answers.get(questionId)?.skipped ? 1 : 0)) } };
      answers.delete(questionId);
      attempts.delete(questionId);
      questionErrors.delete(questionId);
      countdowns.delete(questionId);
      onChange(undefined, null, "review-title");
      onChange("Quiz deleted. Other quiz types and the knowledge card are kept.");
    } else {
      if (!result.ok) questionErrors.set(questionId, result.error);
      onChange(undefined, key);
    }
  }

  /** @param {string} questionId @param {{correct:boolean,score:number,completed:boolean,feedback:{explanation:string,correctAnswer:string}}} result @param {boolean} [skipped] */
  function showFeedback(questionId, result, skipped = false) {
    if (skipped) attempts.delete(questionId);
    if (result.correct) celebrations.add(`review-feedback:${questionId}`);
    answers.set(questionId, { correct: result.correct, score: result.score, ...result.feedback, skipped });
    if (review.value !== null) review = { state: "success", value: { ...review.value, batch: result.completed && review.value.batch ? { ...review.value.batch, status: "completed", completedAt: now() } : review.value.batch, dueCount: Math.max(0, review.value.dueCount - (skipped ? 0 : 1)) }, error: null };
    if (skipped) startCountdown(questionId);
    if (result.completed && !review.value?.questions.some(question => answers.get(question.questionId)?.skipped)) startCountdown("batch");
  }

  /** @param {HTMLElement} button */
  async function preference(button) {
    const knowledgeId = button.dataset.knowledgeId ?? "";
    const choice = button.dataset.preference;
    if (knowledgeId === "" || (choice !== "more" && choice !== "less")) return;
    const actionKey = `preference:${knowledgeId}:${choice}`;
    if (pending.has(`preference:${knowledgeId}:more`) || pending.has(`preference:${knowledgeId}:less`)) return;
    begin(actionKey);
    const result = await gateway.setPreference(knowledgeId, choice, `knowledge-preference:${knowledgeId}:${choice}:${createId()}`);
    pending.delete(actionKey);
    if (!result.ok) {
      feed = { state: "error", value: feed.value, error: result.error };
      onChange(undefined, actionKey);
    } else {
      preferences.set(knowledgeId, choice);
      if (choice === "more") celebrations.add(actionKey);
      onChange(undefined, actionKey);
      onChange("Preference saved.");
    }
  }

  /** @param {HTMLElement} button */
  async function removeKnowledge(button) {
    const knowledgeId = button.dataset.knowledgeId ?? "";
    const target = button.dataset.removeTarget;
    if (knowledgeId === "" || (target !== "image" && target !== "knowledge")) return;
    const key = `remove:${knowledgeId}`;
    if (!begin(key)) return;
    const result = await gateway.removeKnowledge(knowledgeId, `knowledge-remove:${knowledgeId}:${createId()}`, target);
    pending.delete(key);
    if (!result.ok) {
      feed = { state: "error", value: feed.value, error: result.error };
      onChange(undefined, key);
      return;
    }
    await Promise.all([loadFeed(), loadReview()]);
    if (target === "image") onChange("Image removed. Knowledge point and quizzes kept.");
  }

  /** @param {LearningBatchGatewayFailure | null} failure */
  function friendly(failure) {
    if (failure === null) return "";
    if (failure.kind === "LearningBatchGatewayUnauthenticated" || failure.kind === "LearningBatchGatewayUnauthorized") return feedMarkup(6);
    if (failure.kind === "LearningBatchGatewayUnavailable" || failure.kind === "LearningBatchGatewayTimedOut") return feedMarkup(7);
    if (failure.kind === "LearningBatchGatewayRejected" && failure.failureKind === "LearningBatchInsufficientCandidates") return feedMarkup(8);
    if (failure.kind === "LearningBatchGatewayRejected" && failure.failureKind === "LearningBatchIncomplete") return feedMarkup(9);
    if (failure.kind === "LearningBatchGatewayRejected" && failure.failureKind === "ReviewGradePending") return feedMarkup(11);
    if (failure.kind === "LearningBatchGatewayRejected" && failure.failureKind === "ReviewGradingUnavailable") return feedMarkup(12);
    if (failure.kind === "LearningBatchGatewayRejected" && failure.failureKind === "ReviewReplacementUnavailable") return feedMarkup(50);
    return feedMarkup(13);
  }

  function renderFeed() {
    return feedMarkup(0) + `${renderDailyGoal("learning")}${renderFeedHeading()}<div class="daily-grid">${renderFeedBody()}</div></section>`;
  }

  function renderFeedHeading() {
    const value = feed.value;
    if (value === null || value.batch === null || value.items.length === 0) return "";
    const complete = value.batch.status === "completed";
    return feedMarkup(14, value.items.length, complete ? "" : feedMarkup(16));
  }

  function renderFeedBody() {
    if (feed.state === "loading" && feed.value === null) return feedMarkup(3);
    if (feed.state === "error" && feed.value === null) return statePanel("Feed", friendly(feed.error), "retry-learner-feed", "h2");
    const value = feed.value;
    if (value === null || value.batch === null || value.items.length === 0) return feedMarkup(1);
    const complete = value.batch.status === "completed";
    return feedMarkup(46, pending.has("feed-refresh") ? feedMarkup(26, pendingSpark()) : "", classificationMessage === "" ? "" : `<p role="status">${escapeHtml(classificationMessage)}</p>`, value.items.map(renderCard).join(""), complete ? feedMarkup(22) : feedMarkup(21, actionState("feed-complete"), actionLabel("feed-complete", "Mark batch studied", "Saving study…")), feed.state === "error" ? `<p class="state-inline" role="alert">${escapeHtml(friendly(feed.error))}</p>` : "");
  }

  /** @param {LearningKnowledgeCard} card */
  function renderCard(card) {
    const classification = card.sourceClassification;
    const presentation = subjectPresentation(classification?.mainSubject ?? null);
    const subject = presentation === null ? "" : ` data-subject="${escapeHtml(classification?.mainSubject ?? "")}"`;
    const mark = presentation === null ? "" : feedMarkup(44, presentation.path);
    const media = renderMedia(card.media);
    const hasImage = media !== "";
    const key = `remove:${card.knowledgeId}`;
    const removal = feedMarkup(43, escapeHtml(key), pending.has(key) ? "open" : "", escapeHtml(key), [["image", "Image only"], ["knowledge", "Knowledge point"]].map(([target, label]) => feedMarkup(48, target, escapeHtml(card.knowledgeId), pending.has(key) || target === "image" && !hasImage ? "disabled" : "", pending.has(key) ? "Removing…" : label)).join(""));
    return feedMarkup(40, subject, escapeHtml(card.knowledgeId), escapeHtml(card.knowledgeId), escapeHtml(card.knowledgeId), escapeHtml(card.knowledgeId), renderKnowledgeText(card), media, escapeHtml(sourceHref(card.sourceUrl)), escapeHtml(card.title), mark, escapeHtml(presentation?.label ?? "Unclassified"), classification ? `<p>${escapeHtml(classification.topic)}</p>` : "", classificationEditor(card), escapeHtml(sourceHref(card.sourceUrl)), escapeHtml(card.evidenceAnchorIds.join(", ")), preferences.get(card.knowledgeId) === "more" ? "spark-saved" : "", escapeHtml(card.knowledgeId), actionState(`preference:${card.knowledgeId}:more`), actionLabel(`preference:${card.knowledgeId}:more`, `${sparkIcon()}${preferences.get(card.knowledgeId) === "more" ? "Preference saved" : "More like this"}`, "Saving…"), escapeHtml(card.knowledgeId), actionState(`preference:${card.knowledgeId}:less`), actionLabel(`preference:${card.knowledgeId}:less`, preferences.get(card.knowledgeId) === "less" ? "Preference saved" : "Less like this", "Saving…"), removal);
  }

  /** @param {LearningKnowledgeCard} card */
  function renderKnowledgeText(card) {
    let cursor = 0, html = "";
    for (const span of inlineLinkSpans(card.summary, card.inlineLinks ?? [])) {
      html += escapeHtml(card.summary.slice(cursor, span.start)) + `<a href="${escapeHtml(span.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(card.summary.slice(span.start, span.end))}</a>`;
      cursor = span.end;
    }
    return html + escapeHtml(card.summary.slice(cursor));
  }

  /** @param {LearningKnowledgeCard["media"]} media */
  function renderMedia(media) {
    return media === null || media.url.startsWith("/assets/fallback-media/") ? "" : feedMarkup(42, escapeHtml(media.url), escapeHtml(media.attribution));
  }

  /** @param {LearningKnowledgeCard} card */
  function classificationEditor(card) {
    const classification = card.sourceClassification;
    const options = SUBJECTS.map(subject => feedMarkup(49, subject.id, subject.id === classification?.mainSubject ? "selected" : "", escapeHtml(subject.label))).join("");
    return feedMarkup(41, escapeHtml(card.sourceId), escapeHtml(card.sourceId), card.sourceRevision, card.sourceClassificationRevision, classification === null ? "selected" : "", options, escapeHtml(classification?.topic ?? ""));
  }

  /** @param {HTMLFormElement} form */
  async function correctClassification(form) {
    const values = new FormData(form);
    const result = await gateway.updateSourceClassification({ sourceId: form.dataset.sourceClassification ?? "", sourceRevision: Number(form.dataset.sourceRevision), expectedRevision: Number(form.dataset.revision), mainSubject: String(values.get("mainSubject") ?? ""), topic: String(values.get("topic") ?? "").trim() });
    classificationMessage = result.ok ? "Source classification saved." : result.error.kind === "LearningBatchGatewayRejected" && result.error.failureKind === "SourceClassificationRevisionConflict" ? "This source classification changed elsewhere. Reload the page before editing again." : "Source classification could not be saved. Your changes have not been applied.";
    if (result.ok) await loadFeed(); else onChange();
  }

  function renderReview() {
    if (review.state === "loading" && review.value === null) return feedMarkup(4);
    if (review.state === "error" && review.value === null) return statePanel("Review", friendly(review.error), "retry-learner-review");
    const value = review.value;
    const error = (pending.has("review-refresh") ? feedMarkup(47, pendingSpark()) : "") + (review.error === null ? "" : feedMarkup(20, escapeHtml(friendly(review.error))));
    if (value === null || value.questions.length === 0) return renderDailyGoal("review") + error + feedMarkup(2, renderReviewRefresh());
    const nextBatch = countdowns.has("batch") ? feedMarkup(31, countdownButton("batch", "Next batch", "next-review-batch")) : "";
    return feedMarkup(17, renderDailyGoal("review"), String(value.questions.length), value.questions.length === 1 ? "" : "s", renderReviewRefresh(), error, value.questions.map(renderQuestion).join("") + nextBatch);
  }

  function renderReviewRefresh() {
    const busy = review.state === "loading" || pending.has("review-refresh") || review.value?.questions.some(question => questionPending(question.questionId));
    return feedMarkup(18, `${actionState("review-refresh")} ${busy ? "disabled" : ""}`, actionLabel("review-refresh", "Refresh batch", "Finding questions…"));
  }

  /** @param {LearningReviewQuestion} question */
  function renderQuestion(question) {
    const answer = answers.get(question.questionId);
    const attempt = attempts.get(question.questionId);
    const failure = questionErrors.get(question.questionId);
    const input = question.kind === "fill-blank"
      ? question.blanks === null ? feedMarkup(32, escapeHtml(attempt?.answerText ?? "")) : question.blanks.map((blank, index) => feedMarkup(33, index + 1, escapeHtml(blank.id), escapeHtml(attempt?.blanks[blank.id] ?? ""))).join("")
      : feedMarkup(29, escapeHtml(question.prompt), question.choices?.map(choice => feedMarkup(34, question.kind === "multiple-choice" ? "checkbox" : "radio", escapeHtml(choice.id), attempt?.selectedChoiceIds.includes(choice.id) ? "checked" : "", escapeHtml(choice.label))).join("") ?? "");
    const completed = review.value?.batch?.status === "completed";
    const actionKey = `review-submit:${question.questionId}`;
    const feedbackKey = `review-feedback:${question.questionId}`;
    const skipKey = `review-skip:${question.questionId}`;
    const removeKey = `review-remove:${question.questionId}`;
    const busy = questionPending(question.questionId);
    const body = answer === undefined && !completed
      ? feedMarkup(35, escapeHtml(review.value?.batch?.batchId ?? ""), escapeHtml(question.questionId), busy ? 'aria-busy="true"' : "", busy ? input.replaceAll("<input ", "<input disabled ") : input, question.kind === "fill-blank" ? "Fill in every blank before checking." : "Choose an answer before checking.", actionState(actionKey), busy ? "disabled" : "", actionLabel(actionKey, "Check answer", "Checking…"), escapeHtml(question.questionId), actionState(skipKey), busy ? "disabled" : "", actionLabel(skipKey, "Skip", "Loading…"))
      : feedMarkup(36, answer === undefined || answer.skipped ? "" : `is-${answer.correct ? "correct" : "incorrect"}`, escapeHtml(feedbackKey), celebrations.has(feedbackKey) ? `data-spark-event="${escapeHtml(feedbackKey)}"` : "", answer?.correct ? sparkIcon() : "", answer === undefined ? "Answered." : answer.skipped ? "Skipped." : answer.correct ? question.kind === "fill-blank" ? `Correct (${Math.round(answer.score * 100)}%).` : "Correct." : answer.score > 0 ? `Partly correct (${Math.floor(answer.score * 100)}%).` : "Not quite.");
    const submitted = answer && !answer.skipped && attempt && question.kind === "fill-blank" ? feedMarkup(37, escapeHtml(question.blanks === null ? attempt.answerText : question.blanks.map(blank => attempt.blanks[blank.id]).join(", "))) : "";
    const feedback = answer === undefined || answer.correct && question.kind !== "fill-blank" ? "" : feedMarkup(27, escapeHtml(answer.correctAnswer), escapeHtml(answer.explanation), escapeHtml(question.sourceAnchorIds.join(", ")));
    const removal = answer === undefined && !completed ? "" : feedMarkup(38, escapeHtml(question.questionId), actionState(removeKey), busy ? "disabled" : "", actionLabel(removeKey, "Delete quiz", "Deleting…"));
    const replacement = !answer?.skipped ? "" : countdowns.has(question.questionId) ? countdownButton(question.questionId, "Replace quiz", "replace-review", question.questionId) : feedMarkup(39, escapeHtml(question.questionId), escapeHtml(question.questionId), busy ? 'disabled aria-busy="true"' : "", busy ? `${pendingSpark()}Finding a quiz…` : "Replace quiz");
    const height = replacementHeights.get(question.questionId);
    const media = renderMedia(question.media);
    const imageRemoval = media ? feedMarkup(48, "image", escapeHtml(question.knowledgeId), actionState(`remove:${question.knowledgeId}`), "Remove image") : "";
    return feedMarkup(28, height ? `style="min-height:${height}px"` : "", escapeHtml(question.questionId), escapeHtml(question.title), escapeHtml(question.questionId), escapeHtml(question.prompt), media + imageRemoval + body + submitted + (failure ? feedMarkup(20, escapeHtml(friendly(failure))) : ""), feedback + replacement + removal);
  }

  /** @param {string} title @param {string} message @param {string} action @param {"h1"|"h2"} [heading] */
  function statePanel(title, message, action, heading = "h1") { return feedMarkup(5, escapeHtml(title), heading, escapeHtml(message), heading, action); }

  /** @param {HTMLElement} root */
  function bind(root) {
    unbind();
    if (root.isConnected && root.querySelector("[data-review-question]")) {
      countdownRoot = root;
      countdownTimer = setTimeout(tickCountdowns, 1000);
    }
    root.querySelectorAll("[data-spark-event]").forEach(element => {
      if (!(element instanceof HTMLElement)) return;
      const key = element.dataset.sparkEvent ?? "";
      if (!celebrations.delete(key)) return;
      element.removeAttribute("data-spark-event");
      requestAnimationFrame(() => playSpark(element, key.startsWith("review-feedback:") ? "answer" : "preference"));
    });
    root.querySelectorAll("form[data-source-classification]").forEach(form => form.addEventListener("submit", event => { event.preventDefault(); if (form instanceof HTMLFormElement) void correctClassification(form); }));
    root.querySelector("[data-action='retry-learner-feed']")?.addEventListener("click", () => void loadFeed(true));
    root.querySelector("[data-action='retry-learner-review']")?.addEventListener("click", () => void loadReview(true));
    root.querySelector("[data-action='refresh-learner-feed']")?.addEventListener("click", () => void refreshFeed());
    root.querySelector("[data-action='complete-learner-feed']")?.addEventListener("click", () => void completeFeed());
    root.querySelector("[data-action='refresh-learner-review']")?.addEventListener("click", () => void refreshReview());
    root.querySelector("[data-action='next-review-batch']")?.addEventListener("click", () => void refreshReview(true));
    root.querySelectorAll("[data-action='learner-preference']").forEach((element) => element.addEventListener("click", () => { if (element instanceof HTMLElement) void preference(element); }));
    root.querySelectorAll("[data-action='remove-learner-knowledge']").forEach((element) => element.addEventListener("click", () => { if (element instanceof HTMLElement) void removeKnowledge(element); }));
    root.querySelectorAll("[data-image-zoom]").forEach(button => button.addEventListener("click", () => {
      const source = button.querySelector("img");
      if (!(source instanceof HTMLImageElement)) return;
      const dialog = document.createElement("dialog");
      dialog.className = "image-viewer";
      dialog.setAttribute("aria-label", "Image detail");
      dialog.innerHTML = feedMarkup(45, escapeHtml(source.src), escapeHtml(source.alt));
      dialog.querySelector("[data-zoom-toggle]")?.addEventListener("click", event => {
        const zoomed = dialog.classList.toggle("is-zoomed");
        if (event.currentTarget instanceof HTMLElement) {
          event.currentTarget.textContent = zoomed ? "Zoom out" : "Zoom in";
          event.currentTarget.setAttribute("aria-pressed", String(zoomed));
        }
      });
      dialog.addEventListener("close", () => dialog.remove());
      dialog.addEventListener("click", event => { if (event.target === dialog) dialog.close(); });
      root.append(dialog);
      dialog.showModal();
    }));
    root.querySelectorAll("img[data-associated-media]").forEach((element) => element.addEventListener("error", () => { element.closest(".card-media")?.remove(); }));
    root.querySelectorAll("[data-action='skip-review']").forEach(button => button.addEventListener("click", () => { if (button instanceof HTMLElement) void skipReview(button); }));
    root.querySelectorAll("[data-action='replace-review']").forEach(button => button.addEventListener("click", () => { if (button instanceof HTMLElement) void replaceReview(button.dataset.questionId ?? ""); }));
    root.querySelectorAll("[data-action='remove-review']").forEach(button => button.addEventListener("click", () => { if (button instanceof HTMLElement) void removeReview(button); }));
    root.querySelectorAll("[data-learner-review]").forEach((element) => element.addEventListener("submit", (event) => { event.preventDefault(); if (event.currentTarget instanceof HTMLFormElement) void answerReview(event.currentTarget); }));
  }

  return freeze({ loadFeed, loadReview, refreshFeed, refreshDay, renderFeed, renderReview, bind, unbind, hasDueReview: () => (review.value?.dueCount ?? 0) > 0 });
}

export {};
