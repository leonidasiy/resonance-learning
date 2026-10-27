// @ts-check

import { isInlineLinks } from "../knowledge-workflows/inline-links.js";

import { isProgressSummary } from "../progress/public.js";

import { isSubjectId } from "../knowledge-subjects/public.js";

/** @template T, E @typedef {{ readonly ok: true, readonly value: T } | { readonly ok: false, readonly error: E }} Result */
/** @typedef {{ readonly knowledgeId: string, readonly sourceId: string, readonly sourceRevision: number, readonly questionId: string, readonly title: string, readonly summary: string, readonly inlineLinks?: readonly import("../knowledge-workflows/inline-links.js").InlineLink[], readonly sourceUrl: string, readonly evidenceAnchorIds: readonly string[], readonly media: { readonly assetId: string, readonly kind: string, readonly url: string, readonly attribution: string, readonly purpose?: "illustration" | "evidence" } | null, readonly questionLocked: boolean, readonly sourceClassification: { readonly mainSubject: string, readonly topic: string } | null, readonly sourceClassificationRevision: number }} LearningKnowledgeCard */
/** @typedef {{ readonly batchId: string, readonly learningDay: string, readonly status: "open" | "completed", readonly itemIds: readonly string[], readonly revision: number, readonly createdAt: string, readonly completedAt: string | null }} LearningBatchProjection */
/** @typedef {{ readonly batch: LearningBatchProjection | null, readonly items: readonly LearningKnowledgeCard[] }} FeedBatchProjection */
/** @typedef {{ readonly id: string, readonly kind: "single-choice" | "multiple-choice", readonly prompt: string, readonly choices: readonly { readonly id: string, readonly label: string }[], readonly blanks: null }} LearningReviewChoiceVariant */
/** @typedef {{ readonly id: string, readonly kind: "fill-blank", readonly prompt: string, readonly choices: null, readonly blanks: readonly { readonly id: string }[] }} LearningReviewFillBlankVariant */
/** @typedef {LearningReviewChoiceVariant | LearningReviewFillBlankVariant} LearningReviewVariant */
/** @typedef {{ readonly questionId: string, readonly knowledgeId: string, readonly media: LearningKnowledgeCard["media"], readonly title: string, readonly prompt: string, readonly kind: string, readonly choices: readonly { readonly id: string, readonly label: string }[] | null, readonly blanks: readonly { readonly id: string }[] | null, readonly pairedVariants: readonly [LearningReviewChoiceVariant, LearningReviewFillBlankVariant] | readonly [LearningReviewFillBlankVariant, LearningReviewChoiceVariant] | null, readonly sourceAnchorIds: readonly string[], readonly revision: number }} LearningReviewQuestion */
/** @typedef {{ readonly correct: boolean, readonly score: number, readonly completed: boolean, readonly nextDueAt: string, readonly feedback: { readonly explanation: string, readonly correctAnswer: string, readonly components: readonly { readonly id: string, readonly correct: boolean, readonly correctAnswer: string }[] } }} LearningReviewAnswer */
/** @typedef {{ readonly questionId: string, readonly completed: boolean, readonly feedback: { readonly explanation: string, readonly correctAnswer: string } }} LearningReviewSkip */
/** @typedef {{ readonly batch: LearningBatchProjection | null, readonly questions: readonly LearningReviewQuestion[], readonly dueCount: number, readonly skipped: readonly LearningReviewSkip[] }} ReviewBatchProjection */
/** @typedef {{ readonly kind: "LearningBatchGatewayCommandInvalid", readonly field: string } | { readonly kind: "LearningBatchGatewayUnauthenticated" } | { readonly kind: "LearningBatchGatewayUnauthorized" } | { readonly kind: "LearningBatchGatewayUnavailable" } | { readonly kind: "LearningBatchGatewayTimedOut" } | { readonly kind: "LearningBatchGatewayResponseInvalid" } | { readonly kind: "LearningBatchGatewayRejected", readonly failureKind: string }} LearningBatchGatewayFailure */

const freeze = Object.freeze;

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function record(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }
/** @param {Record<string, unknown>} value @param {readonly string[]} expected */
function exactKeys(value, expected) { const actual = Object.keys(value); return actual.length === expected.length && expected.every((key) => Object.hasOwn(value, key)); }
/** @param {unknown} value @returns {value is string} */
function text(value) { return typeof value === "string" && value.trim() !== ""; }
/** @param {unknown} value @returns {value is number} */
function positiveInteger(value) { return typeof value === "number" && Number.isSafeInteger(value) && value > 0; }
/** @param {unknown} value @returns {value is string} */
function iso(value) { return text(value) && Number.isFinite(Date.parse(value)); }

/** @param {unknown} value @returns {LearningBatchProjection | null} */
function parseBatch(value) {
  if (value === null) return null;
  if (!record(value) || !text(value.batchId) || !text(value.learningDay) || (value.status !== "open" && value.status !== "completed") || !Array.isArray(value.itemIds) || value.itemIds.length < 1 || value.itemIds.length > 5 || !value.itemIds.every(text) || !positiveInteger(value.revision) || !iso(value.createdAt) || (value.completedAt !== null && !iso(value.completedAt))) return null;
  return freeze({ batchId: value.batchId, learningDay: value.learningDay, status: value.status, itemIds: freeze([...value.itemIds]), revision: value.revision, createdAt: value.createdAt, completedAt: value.completedAt });
}

/** @param {unknown} value @returns {LearningKnowledgeCard | null} */
function parseCard(value) {
  if (!record(value) || !text(value.knowledgeId) || !text(value.sourceId) || !text(value.questionId) || !text(value.title) || !text(value.summary) || !text(value.sourceUrl) || !URL.canParse(value.sourceUrl) || !Array.isArray(value.evidenceAnchorIds) || value.evidenceAnchorIds.length === 0 || !value.evidenceAnchorIds.every(text) || typeof value.questionLocked !== "boolean") return null;
  if (!positiveInteger(value.sourceRevision) || typeof value.sourceClassificationRevision !== "number" || !Number.isSafeInteger(value.sourceClassificationRevision) || value.sourceClassificationRevision < 0) return null;
  if (value.inlineLinks !== undefined && !isInlineLinks(value.inlineLinks)) return null;
  const sourceRevision = /** @type {number} */ (value.sourceRevision);
  const sourceClassificationRevision = /** @type {number} */ (value.sourceClassificationRevision);
  const sourceClassification = value.sourceClassification === null ? null : record(value.sourceClassification) && isSubjectId(value.sourceClassification.mainSubject) && typeof value.sourceClassification.topic === "string" && value.sourceClassification.topic.trim() === value.sourceClassification.topic && value.sourceClassification.topic.length >= 1 && value.sourceClassification.topic.length <= 120 && !/[<>\x00-\x1f\x7f]/u.test(value.sourceClassification.topic) ? freeze({ mainSubject: value.sourceClassification.mainSubject, topic: value.sourceClassification.topic }) : undefined;
  if (sourceClassification === undefined || (sourceClassification === null && sourceClassificationRevision !== 0)) return null;
  const sourceUrl = /** @type {string} */ (value.sourceUrl);
  const media = parseMedia(value.media);
  return media === undefined ? null : freeze({ knowledgeId: value.knowledgeId, sourceId: value.sourceId, sourceRevision, questionId: value.questionId, title: value.title, summary: value.summary, ...(value.inlineLinks !== undefined ? {inlineLinks: Object.freeze(value.inlineLinks.map(link => Object.freeze({...link})))} : {}), sourceUrl, evidenceAnchorIds: freeze([...value.evidenceAnchorIds]), media, questionLocked: value.questionLocked, sourceClassification, sourceClassificationRevision });
}

/** @param {unknown} value @returns {LearningKnowledgeCard["media"] | undefined} */
function parseMedia(value) {
  return value === null ? null : record(value) && text(value.assetId) && text(value.kind) && text(value.url) && text(value.attribution) && (value.purpose === undefined || value.purpose === "illustration" || value.purpose === "evidence") ? freeze({ assetId: value.assetId, kind: value.kind, url: value.url, attribution: value.attribution, ...(value.purpose === undefined ? {} : { purpose: /** @type {"illustration" | "evidence"} */ (value.purpose) }) }) : undefined;
}

/** @param {unknown} value @returns {LearningReviewQuestion | null} */
function parseQuestion(value) {
  if (!record(value) || !text(value.questionId) || !text(value.knowledgeId) || !text(value.title) || !text(value.prompt) || !text(value.kind) || !Array.isArray(value.sourceAnchorIds) || value.sourceAnchorIds.length === 0 || !value.sourceAnchorIds.every(text) || !positiveInteger(value.revision)) return null;
  if (["explanation", "correctChoiceIds", "acceptedAnswers", "canonicalAnswers", "correctAnswer", "blankId", "isCorrect"].some((key) => Object.hasOwn(value, key))) return null;
  const choices = value.choices === null ? null : Array.isArray(value.choices) && value.choices.length > 0 && value.choices.every((choice) => record(choice) && exactKeys(choice, ["id", "label"]) && text(choice.id) && text(choice.label)) ? freeze(value.choices.map((choice) => freeze({ id: /** @type {string} */ (choice.id), label: /** @type {string} */ (choice.label) }))) : undefined;
  const blanks = value.blanks === undefined || value.blanks === null ? null : Array.isArray(value.blanks) && value.blanks.length >= 1 && value.blanks.length <= 4 && value.blanks.every((blank, index) => record(blank) && exactKeys(blank, ["id"]) && blank.id === `blank-${index + 1}`) ? freeze(value.blanks.map((blank) => freeze({ id: /** @type {string} */ (blank.id) }))) : undefined;
  const media = parseMedia(value.media ?? null);
  const pairedVariants = value.pairedVariants === undefined || value.pairedVariants === null ? null : parsePairedVariants(value.pairedVariants);
  return choices === undefined || blanks === undefined || pairedVariants === undefined || media === undefined ? null : freeze({ media, questionId: value.questionId, knowledgeId: value.knowledgeId, title: value.title, prompt: value.prompt, kind: value.kind, choices, blanks, pairedVariants, sourceAnchorIds: freeze([...value.sourceAnchorIds]), revision: value.revision });
}

/** @param {unknown} value @returns {readonly [LearningReviewChoiceVariant, LearningReviewFillBlankVariant] | readonly [LearningReviewFillBlankVariant, LearningReviewChoiceVariant] | undefined} */
function parsePairedVariants(value) {
  if (!Array.isArray(value) || value.length !== 2) return undefined;
  /** @type {LearningReviewVariant[]} */ const variants = [];
  for (const raw of value) {
    // Public questions omit feedback until submission, just like the native projection.
    if (!record(raw) || !exactKeys(raw, ["id", "kind", "prompt", "choices", "blanks"]) || !text(raw.id) || !text(raw.prompt) || !["single-choice", "multiple-choice", "fill-blank"].includes(String(raw.kind))) return undefined;
    if (raw.kind === "fill-blank") {
      if (raw.choices !== null || !Array.isArray(raw.blanks) || raw.blanks.length === 0) return undefined;
      const blanks = raw.blanks.map((blank) => record(blank) && exactKeys(blank, ["id"]) && text(blank.id) ? freeze({ id: blank.id }) : null);
      if (blanks.some((blank) => blank === null) || new Set(blanks.map((blank) => blank?.id)).size !== blanks.length) return undefined;
      variants.push(freeze({ id: raw.id, kind: "fill-blank", prompt: raw.prompt, choices: null, blanks: freeze(/** @type {{readonly id:string}[]} */ (blanks)) }));
      continue;
    }
    if ((raw.kind !== "single-choice" && raw.kind !== "multiple-choice") || raw.blanks !== null || !Array.isArray(raw.choices) || raw.choices.length < 2) return undefined;
    const choices = raw.choices.map((choice) => record(choice) && exactKeys(choice, ["id", "label"]) && text(choice.id) && text(choice.label) ? freeze({ id: choice.id, label: choice.label }) : null);
    if (choices.some((choice) => choice === null) || new Set(choices.map((choice) => choice?.id)).size !== choices.length) return undefined;
    variants.push(freeze({ id: raw.id, kind: raw.kind, prompt: raw.prompt, choices: freeze(/** @type {{readonly id:string,readonly label:string}[]} */ (choices)), blanks: null }));
  }
  if (variants.filter((variant) => variant.kind === "fill-blank").length !== 1 || variants.filter((variant) => variant.kind === "single-choice" || variant.kind === "multiple-choice").length !== 1 || new Set(variants.map((variant) => variant.id)).size !== 2) return undefined;
  return /** @type {readonly [LearningReviewChoiceVariant, LearningReviewFillBlankVariant] | readonly [LearningReviewFillBlankVariant, LearningReviewChoiceVariant]} */ (freeze(variants));
}

/** @param {unknown} value @returns {LearningReviewAnswer | null} */
function parseReviewAnswer(value) {
  if (!record(value) || typeof value.correct !== "boolean" || typeof value.score !== "number" || !Number.isFinite(value.score) || value.score < 0 || value.score > 1 || typeof value.completed !== "boolean" || !iso(value.nextDueAt) || !record(value.feedback) || !text(value.feedback.explanation) || !text(value.feedback.correctAnswer) || !Array.isArray(value.feedback.components) || !value.feedback.components.every((component) => record(component) && text(component.id) && typeof component.correct === "boolean" && typeof component.correctAnswer === "string")) return null;
  return freeze({ correct: value.correct, score: value.score, completed: value.completed, nextDueAt: value.nextDueAt, feedback: freeze({ explanation: value.feedback.explanation, correctAnswer: value.feedback.correctAnswer, components: freeze(value.feedback.components.map((component) => freeze({ id: /** @type {string} */ (component.id), correct: /** @type {boolean} */ (component.correct), correctAnswer: /** @type {string} */ (component.correctAnswer) }))) }) });
}

/** @param {unknown} value @returns {LearningReviewSkip | null} */
function parseSkip(value) {
  return record(value) && text(value.questionId) && typeof value.completed === "boolean" && record(value.feedback) && text(value.feedback.explanation) && text(value.feedback.correctAnswer) ? freeze({ questionId: value.questionId, completed: value.completed, feedback: freeze({ explanation: value.feedback.explanation, correctAnswer: value.feedback.correctAnswer }) }) : null;
}

/** @param {unknown} value @returns {Result<FeedBatchProjection, LearningBatchGatewayFailure>} */
function parseFeed(value) {
  if (!record(value) || !Array.isArray(value.items) || value.items.length > 5) return bad();
  const batch = parseBatch(value.batch);
  if (value.batch !== null && batch === null) return bad();
  const items = value.items.map(parseCard);
  return items.some((item) => item === null) ? bad() : { ok: true, value: freeze({ batch, items: freeze(/** @type {LearningKnowledgeCard[]} */ (items)) }) };
}

/** @param {unknown} value @returns {Result<ReviewBatchProjection, LearningBatchGatewayFailure>} */
function parseReview(value) {
  if (!record(value) || !Array.isArray(value.questions) || value.questions.length > 5 || typeof value.dueCount !== "number" || !Number.isSafeInteger(value.dueCount) || value.dueCount < 0) return bad();
  const dueCount = value.dueCount;
  const batch = parseBatch(value.batch);
  if (value.batch !== null && batch === null) return bad();
  const questions = value.questions.map(parseQuestion);
  const skipped = value.skipped === undefined ? [] : Array.isArray(value.skipped) ? value.skipped.map(parseSkip) : [null];
  return questions.some(question => question === null) || skipped.some(item => item === null || !questions.some(question => question?.questionId === item.questionId)) ? bad() : { ok: true, value: freeze({ batch, questions: freeze(/** @type {LearningReviewQuestion[]} */ (questions)), dueCount, skipped: freeze(/** @type {LearningReviewSkip[]} */ (skipped)) }) };
}

/** @param {unknown} value @returns {Result<{ readonly items: readonly LearningKnowledgeCard[] }, LearningBatchGatewayFailure>} */
function parseKnowledge(value) {
  if (!record(value) || !Array.isArray(value.items)) return bad();
  const items = value.items.map(parseCard);
  return items.some((item) => item === null)
    ? bad()
    : { ok: true, value: freeze({ items: freeze(/** @type {LearningKnowledgeCard[]} */ (items)) }) };
}

export class LearningBatchGatewayClient {
  #fetch;
  #base;
  #timeoutMs;

  /** @param {{ readonly fetch: typeof fetch, readonly baseUrl: string, readonly timeoutMs: number }} dependencies */
  constructor(dependencies) {
    if (typeof dependencies?.fetch !== "function" || !URL.canParse(dependencies.baseUrl) || !Number.isInteger(dependencies.timeoutMs) || dependencies.timeoutMs < 1) throw new TypeError("Learning batch gateway dependencies are invalid.");
    this.#base = new URL(dependencies.baseUrl);
    if (this.#base.protocol !== "https:" && this.#base.hostname !== "localhost" && this.#base.hostname !== "127.0.0.1") throw new TypeError("Learning batch gateway protocol is invalid.");
    this.#fetch = dependencies.fetch;
    this.#timeoutMs = dependencies.timeoutMs;
  }

  /** @returns {Promise<Result<import("../progress/public.js").ProgressSummary, LearningBatchGatewayFailure>>} */
  async loadProgress() {
    const response = await this.#request("api/learning-generation/progress?days=7", "GET", null);
    if (!response.ok) return response;
    const value = resultValue(response.value);
    return isProgressSummary(value) ? { ok: true, value } : bad();
  }

  /** @param {string} learningDay @returns {Promise<Result<FeedBatchProjection, LearningBatchGatewayFailure>>} */
  async loadFeed(learningDay) {
    if (!iso(`${learningDay}T00:00:00.000Z`)) return invalid("learningDay");
    const response = await this.#request(`api/learning-generation/feed-batch?day=${encodeURIComponent(learningDay)}`, "GET", null);
    if (!response.ok) return response;
    return parseFeed(resultValue(response.value));
  }

  /** @param {string | null} [sourceId] @returns {Promise<Result<{ readonly items: readonly LearningKnowledgeCard[] }, LearningBatchGatewayFailure>>} */
  async listKnowledge(sourceId = null) {
    if (sourceId !== null && !text(sourceId)) return invalid("sourceId");
    const query = sourceId === null ? "" : `?sourceId=${encodeURIComponent(sourceId)}`;
    const response = await this.#request(`api/learning-generation/library-knowledge${query}`, "GET", null);
    if (!response.ok) return response;
    return parseKnowledge(resultValue(response.value));
  }

  /** @param {string} idempotencyKey @returns {Promise<Result<FeedBatchProjection, LearningBatchGatewayFailure>>} */
  async refreshFeed(idempotencyKey) {
    if (!text(idempotencyKey)) return invalid("idempotencyKey");
    const response = await this.#request("api/learning-generation/feed-batch/refresh", "POST", { idempotencyKey });
    if (!response.ok) return response;
    return parseFeed(resultValue(response.value));
  }

  /** @param {string} batchId @param {string} idempotencyKey @returns {Promise<Result<Record<string, unknown>, LearningBatchGatewayFailure>>} */
  async completeFeed(batchId, idempotencyKey) { return this.#command("api/learning-generation/feed-batch/complete", { batchId, idempotencyKey }); }
  /** @param {string} learningDay @returns {Promise<Result<ReviewBatchProjection, LearningBatchGatewayFailure>>} */
  async loadReview(learningDay) {
    if (!iso(`${learningDay}T00:00:00.000Z`)) return invalid("learningDay");
    const response = await this.#request(`api/learning-generation/review-batch?day=${encodeURIComponent(learningDay)}`, "GET", null);
    if (!response.ok) return response;
    return parseReview(resultValue(response.value));
  }
  /** @param {string} idempotencyKey @returns {Promise<Result<ReviewBatchProjection, LearningBatchGatewayFailure>>} */
  async refreshReview(idempotencyKey) {
    if (!text(idempotencyKey)) return invalid("idempotencyKey");
    const response = await this.#request("api/learning-generation/review-batch/refresh", "POST", { idempotencyKey });
    if (!response.ok) return response;
    return parseReview(resultValue(response.value));
  }
  /** @param {string} batchId @param {string} questionId @param {readonly string[]} selectedChoiceIds @param {string} idempotencyKey @param {string | null} [answerText] @param {readonly { readonly id: string, readonly text: string }[] | null} [blankAnswers] @param {number} [questionRevision] @returns {Promise<Result<LearningReviewAnswer, LearningBatchGatewayFailure>>} */
  async answerReview(batchId, questionId, selectedChoiceIds, idempotencyKey, answerText = null, blankAnswers = null, questionRevision = 0) {
    const result = await this.#command("api/learning-generation/review-batch/answer", { batchId, questionId, selectedChoiceIds, answerText, blankAnswers, questionRevision, idempotencyKey });
    if (!result.ok) return result;
    const parsed = parseReviewAnswer(result.value);
    return parsed === null ? bad() : { ok: true, value: parsed };
  }
  /** @param {string} batchId @param {string} questionId @param {number} questionRevision @param {string} idempotencyKey @returns {Promise<Result<LearningReviewSkip, LearningBatchGatewayFailure>>} */
  async skipReview(batchId, questionId, questionRevision, idempotencyKey) {
    const result = await this.#command("api/learning-generation/review-batch/skip", { batchId, questionId, questionRevision, idempotencyKey });
    if (!result.ok) return result;
    const parsed = parseSkip(result.value);
    return parsed === null ? bad() : { ok: true, value: parsed };
  }
  /** @param {string} batchId @param {string} questionId @param {number} questionRevision @param {string} idempotencyKey @returns {Promise<Result<ReviewBatchProjection, LearningBatchGatewayFailure>>} */
  async replaceReview(batchId, questionId, questionRevision, idempotencyKey) {
    if (!text(batchId) || !text(questionId) || !positiveInteger(questionRevision) || !text(idempotencyKey)) return invalid("question");
    const result = await this.#command("api/learning-generation/review-batch/replace", { batchId, questionId, questionRevision, idempotencyKey });
    if (!result.ok) return result;
    const parsed = parseReview(result.value);
    return parsed.ok && result.value.questionId === questionId && parsed.value.batch?.batchId === batchId && parsed.value.batch.status === "open" && !parsed.value.batch.itemIds.includes(questionId) && parsed.value.questions.length === 1 && parsed.value.batch.itemIds.includes(parsed.value.questions[0].questionId) ? parsed : bad();
  }
  /** @param {string} batchId @param {string} questionId @param {number} questionRevision @param {string} idempotencyKey @returns {Promise<Result<Record<string, unknown>, LearningBatchGatewayFailure>>} */
  async removeReview(batchId, questionId, questionRevision, idempotencyKey) {
    const result = await this.#command("api/learning-generation/review-batch/remove", { batchId, questionId, questionRevision, idempotencyKey });
    if (!result.ok) return result;
    return result.value.questionId === questionId && result.value.batchId === batchId && result.value.removed === true ? result : bad();
  }
  /** @param {string} knowledgeId @param {"more" | "less"} choice @param {string} idempotencyKey @returns {Promise<Result<Record<string, unknown>, LearningBatchGatewayFailure>>} */
  async setPreference(knowledgeId, choice, idempotencyKey) { return this.#command("api/learning-generation/knowledge-preference", { knowledgeId, choice, idempotencyKey }); }
  /** @param {string} knowledgeId @param {string} idempotencyKey @param {"image"|"knowledge"} [target] @returns {Promise<Result<Record<string, unknown>, LearningBatchGatewayFailure>>} */
  async removeKnowledge(knowledgeId, idempotencyKey, target) { return this.#command("api/learning-generation/knowledge-remove", { knowledgeId, idempotencyKey, target }); }

  /** @param {{ readonly sourceId: string, readonly sourceRevision: number, readonly expectedRevision: number, readonly mainSubject: string, readonly topic: string }} command @returns {Promise<Result<true, LearningBatchGatewayFailure>>} */
  async updateSourceClassification(command) {
    if (!record(command) || !text(command.sourceId) || !positiveInteger(command.sourceRevision) || !Number.isSafeInteger(command.expectedRevision) || command.expectedRevision < 0 || !isSubjectId(command.mainSubject) || typeof command.topic !== "string" || command.topic.trim() !== command.topic || command.topic.length < 1 || command.topic.length > 120 || /[<>\x00-\x1f\x7f]/u.test(command.topic)) return invalid("classification");
    const response = await this.#request("api/source-library/classification", "POST", command);
    if (!response.ok) return response;
    const value = resultValue(response.value);
    if (!record(value) || value.sourceId !== command.sourceId || value.sourceRevision !== command.sourceRevision || value.classificationRevision !== command.expectedRevision + 1 || value.mainSubject !== command.mainSubject || value.topic !== command.topic) return bad();
    return { ok: true, value: true };
  }

  /** @param {string} path @param {Record<string, unknown>} body @returns {Promise<Result<Record<string, unknown>, LearningBatchGatewayFailure>>} */
  async #command(path, body) {
    if (!text(body.idempotencyKey)) return invalid("idempotencyKey");
    const response = await this.#request(path, "POST", body);
    if (!response.ok) return response;
    const value = resultValue(response.value);
    return record(value) ? { ok: true, value } : bad();
  }

  /** @param {string} path @param {"GET" | "POST"} method @param {Record<string, unknown> | null} body @returns {Promise<Result<unknown, LearningBatchGatewayFailure>>} */
  async #request(path, method, body) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);
    let response;
    try {
      response = await (0, this.#fetch)(new URL(path, this.#base), { method, credentials: "same-origin", headers: { accept: "application/json", ...(body === null ? {} : { "content-type": "application/json" }) }, body: body === null ? null : JSON.stringify(body), cache: "no-store", signal: controller.signal });
    } catch (error) {
      if (controller.signal.aborted) return { ok: false, error: { kind: "LearningBatchGatewayTimedOut" } };
      if (error instanceof TypeError) return { ok: false, error: { kind: "LearningBatchGatewayUnavailable" } };
      throw error;
    } finally { clearTimeout(timeout); }
    if (response.status === 401) return { ok: false, error: { kind: "LearningBatchGatewayUnauthenticated" } };
    if (response.status === 403) return { ok: false, error: { kind: "LearningBatchGatewayUnauthorized" } };
    let document;
    try { document = await response.json(); } catch (error) { if (error instanceof SyntaxError) return bad(); throw error; }
    if (!response.ok) {
      const failureKind = record(document) && text(document.error) ? document.error : null;
      return failureKind === null ? bad() : { ok: false, error: { kind: "LearningBatchGatewayRejected", failureKind } };
    }
    return { ok: true, value: document };
  }
}

/** @param {unknown} value @returns {unknown} */
function resultValue(value) { return record(value) && Object.hasOwn(value, "result") ? value.result : null; }
/** @returns {Result<never, LearningBatchGatewayFailure>} */
function bad() { return { ok: false, error: { kind: "LearningBatchGatewayResponseInvalid" } }; }
/** @param {string} field @returns {Result<never, LearningBatchGatewayFailure>} */
function invalid(field) { return { ok: false, error: { kind: "LearningBatchGatewayCommandInvalid", field } }; }

export {};
