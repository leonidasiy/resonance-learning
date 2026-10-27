// @ts-check

import { isInlineLinks } from "../src/features/knowledge-workflows/inline-links.js";

import { isMediaBindingPurpose } from "../src/features/knowledge-workflows/media.js";

import { isSubjectId } from "../src/features/knowledge-subjects/public.js";
import { createLearningProgressService } from "./learning-progress-d1.js";

import { selectKnowledgeBatch } from "../src/features/learning-generation/batches.js";

/** @template T @typedef {{ readonly ok: true, readonly value: T } | { readonly ok: false, readonly error: { readonly kind: string, readonly [key: string]: unknown } }} Result */
/** @typedef {{ readonly success: boolean, readonly meta?: { readonly changes?: number } }} D1Result */
/** @typedef {{ readonly bind: (...values: readonly (string | number | null)[]) => D1Statement, readonly first: () => Promise<unknown | null>, readonly all: () => Promise<{ readonly success: boolean, readonly results: readonly unknown[] }>, readonly run: () => Promise<D1Result> }} D1Statement */
/** @typedef {{ readonly prepare: (query: string) => D1Statement, readonly batch: (statements: readonly D1Statement[]) => Promise<readonly D1Result[]> }} D1DatabasePort */
/** @typedef {{ readonly delete: (key: string) => Promise<unknown> }} MediaBucket */
/** @typedef {{ readonly event: string, readonly ownerId?: string, readonly batchId?: string, readonly knowledgeId?: string, readonly failureKind?: string, readonly itemCount?: number }} LearnerBatchLog */
/** @typedef {{ readonly knowledgeId: string, readonly sourceId: string, readonly sourceRevision: number, readonly questionId: string, readonly pairedQuestionId?: string, readonly viewCount: number, readonly lastAnswerCorrect: boolean | null, readonly scheduledDays: number, readonly preference: number, readonly dueAt: string | null, readonly studiedAt: string | null, readonly title: string, readonly summary: string, readonly inlineLinks?: readonly import("../src/features/knowledge-workflows/inline-links.js").InlineLink[], readonly sourceUrl: string, readonly evidenceAnchorIds: readonly string[], readonly sourceClassification: { readonly mainSubject: string, readonly topic: string } | null, readonly sourceClassificationRevision: number, readonly question: PublicQuestion, readonly media: PublicMedia | null }} LearnerCandidate */
/** @typedef {{ readonly id:string, readonly kind:"single-choice"|"multiple-choice"|"fill-blank", readonly prompt:string, readonly explanation:string, readonly choices:readonly {readonly id:string,readonly label:string}[]|null, readonly correctChoiceIds:readonly string[]|null, readonly blanks:readonly {readonly id:string,readonly acceptedAnswers:readonly string[]}[]|null }} PairedVariant */
/** @typedef {{ readonly id: string, readonly kind: string, readonly prompt: string, readonly explanation: string, readonly sourceAnchorIds: readonly string[], readonly choices: readonly { readonly id: string, readonly label: string }[] | null, readonly correctChoiceIds: readonly string[] | null, readonly acceptedAnswers: readonly string[] | null, readonly blankId: string | null, readonly blanks: readonly { readonly id: string, readonly acceptedAnswers: readonly string[] }[] | null, readonly pairedVariants: readonly PairedVariant[] | null, readonly revision: number }} PublicQuestion */
/** @typedef {{ readonly assetId: string, readonly kind: string, readonly url: string, readonly attribution: string, readonly purpose?: "illustration" | "evidence" }} PublicMedia */
/** @typedef {{ readonly batchId: string, readonly learningDay: string, readonly status: "open" | "completed", readonly itemIds: readonly string[], readonly revision: number, readonly createdAt: string, readonly completedAt: string | null }} BatchRow */
/** @typedef {{ readonly ownerId: string, readonly batchId: string, readonly idempotencyKey: string }} FeedCompleteCommand */
/** @typedef {{ readonly ownerId: string, readonly batchId: string, readonly questionId: string, readonly questionRevision?:number, readonly selectedChoiceIds: readonly string[], readonly answerText?: string | null, readonly blankAnswers?: readonly { readonly id: string, readonly text: string }[], readonly pairedBlankAnswers?: readonly { readonly id:string,readonly text:string }[] | null, readonly idempotencyKey: string }} ReviewAnswerCommand */
/** @typedef {{ readonly ownerId: string, readonly knowledgeId: string, readonly choice: "more" | "less", readonly idempotencyKey: string }} PreferenceCommand */
/** @typedef {{ readonly ownerId: string, readonly knowledgeId: string, readonly idempotencyKey: string }} KnowledgeRemoveCommand */
/** @typedef {{ readonly ownerId: string, readonly sourceId: string, readonly idempotencyKey: string }} SourceRemoveCommand */

const MAX_BATCH_SIZE = 5;
const MAX_CANDIDATES = 1_000;

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function record(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }
/** @param {unknown} value @returns {value is string} */
function text(value) { return typeof value === "string" && value.trim() !== ""; }
/** @param {unknown} value @returns {value is number} */
function nonNegativeInteger(value) { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0; }
/** @param {unknown} value @returns {value is number} */
function positiveInteger(value) { return typeof value === "number" && Number.isSafeInteger(value) && value > 0; }
/** @param {unknown} value @returns {value is string} */
function iso(value) { return text(value) && Number.isFinite(Date.parse(value)); }
/** @param {D1Result} result */
function changed(result) { return result.success === true && (result.meta?.changes ?? 0) > 0; }
/** @param {unknown} value @returns {value is readonly string[]} */
function stringList(value) { return Array.isArray(value) && value.length > 0 && value.every(text); }

/** @param {unknown} value @returns {PublicQuestion | null} */
function parseQuestion(value) {
  if (!record(value) || !text(value.id) || !text(value.kind) || !text(value.prompt) || !text(value.explanation) || !Array.isArray(value.sourceAnchorIds) || !stringList(value.sourceAnchorIds) || !positiveInteger(value.revision)) return null;
  const choices = value.choices === null ? null : Array.isArray(value.choices) && value.choices.length > 0 && value.choices.every((choice) => record(choice) && text(choice.id) && text(choice.label)) ? value.choices.map((choice) => Object.freeze({ id: /** @type {string} */ (choice.id), label: /** @type {string} */ (choice.label) })) : undefined;
  const correctChoiceIds = value.correctChoiceIds === null ? null : stringList(value.correctChoiceIds) ? [...value.correctChoiceIds] : undefined;
  const acceptedAnswers = value.acceptedAnswers === undefined || value.acceptedAnswers === null ? null : stringList(value.acceptedAnswers) ? [...value.acceptedAnswers] : undefined;
  const blankId = value.blankId === undefined || value.blankId === null ? null : text(value.blankId) ? value.blankId : undefined;
  const blanks = value.blanks === undefined || value.blanks === null ? null : Array.isArray(value.blanks) && value.blanks.length >= 2 && value.blanks.length <= 4 && value.blanks.every((blank, index) => record(blank) && blank.id === `blank-${index + 1}` && stringList(blank.acceptedAnswers)) ? value.blanks.map((blank) => Object.freeze({ id: /** @type {string} */ (blank.id), acceptedAnswers: Object.freeze(/** @type {string[]} */ ([...blank.acceptedAnswers])) })) : undefined;
  const pairedVariants = value.pairedVariants === undefined || value.pairedVariants === null ? null : Array.isArray(value.pairedVariants) && value.pairedVariants.length === 2 && value.pairedVariants.every((variant) => record(variant) && text(variant.id) && (variant.kind === "single-choice" || variant.kind === "multiple-choice" || variant.kind === "fill-blank") && text(variant.prompt) && text(variant.explanation)) ? /** @type {unknown[]} */ (value.pairedVariants).map((rawVariant) => {
    if (!record(rawVariant)) return null;
    const variant = rawVariant;
    if (variant.kind === "fill-blank") return Array.isArray(variant.blanks) && variant.blanks.length > 0 && variant.blanks.every((blank) => record(blank) && text(blank.id) && stringList(blank.acceptedAnswers)) ? Object.freeze({ id: /** @type {string} */ (variant.id), kind: "fill-blank", prompt: /** @type {string} */ (variant.prompt), explanation: /** @type {string} */ (variant.explanation), choices: null, correctChoiceIds: null, blanks: Object.freeze(variant.blanks.map((blank) => Object.freeze({ id: /** @type {string} */ (blank.id), acceptedAnswers: Object.freeze(/** @type {string[]} */ ([...blank.acceptedAnswers])) }))) }) : null;
    return Array.isArray(variant.choices) && variant.choices.length >= 2 && variant.choices.every((choice) => record(choice) && text(choice.id) && text(choice.label)) && stringList(variant.correctChoiceIds) ? Object.freeze({ id: /** @type {string} */ (variant.id), kind: /** @type {"single-choice"|"multiple-choice"} */ (variant.kind), prompt: /** @type {string} */ (variant.prompt), explanation: /** @type {string} */ (variant.explanation), choices: Object.freeze(variant.choices.map((choice) => Object.freeze({ id: /** @type {string} */ (choice.id), label: /** @type {string} */ (choice.label) }))), correctChoiceIds: Object.freeze(/** @type {string[]} */ ([...variant.correctChoiceIds])), blanks: null }) : null;
  }).filter((variant) => variant !== null) : undefined;
  if (choices === undefined || correctChoiceIds === undefined || acceptedAnswers === undefined || blankId === undefined || blanks === undefined || pairedVariants === undefined || pairedVariants !== null && pairedVariants.length !== 2) return null;
  if (value.kind === "fill-blank" && (blanks === null ? acceptedAnswers === null || blankId === null : acceptedAnswers !== null || blankId !== null || new Set(blanks.map((blank) => blank.id)).size !== blanks.length)) return null;
  if (value.kind !== "fill-blank" && blanks !== null) return null;
  return Object.freeze({ id: value.id, kind: value.kind, prompt: value.prompt, explanation: value.explanation, sourceAnchorIds: Object.freeze([...value.sourceAnchorIds]), choices: choices === null ? null : Object.freeze(choices), correctChoiceIds: correctChoiceIds === null ? null : Object.freeze(correctChoiceIds), acceptedAnswers: acceptedAnswers === null ? null : Object.freeze(acceptedAnswers), blankId, blanks: blanks === null ? null : Object.freeze(blanks), pairedVariants: pairedVariants === null ? null : Object.freeze(pairedVariants), revision: value.revision });
}

/** @param {unknown} value @returns {BatchRow | null} */
function parseBatch(value, allowLess = false) {
  if (!record(value) || !text(value.batch_id) || !text(value.learning_day) || (value.status !== "open" && value.status !== "completed") || !text(value.item_ids_json) || !positiveInteger(value.revision) || !iso(value.created_at) || (value.completed_at !== null && !iso(value.completed_at))) return null;
  let ids;
  try { ids = JSON.parse(value.item_ids_json); } catch (error) { return null; }
  if (!stringList(ids) || ids.length < 1 || ids.length > MAX_BATCH_SIZE || (!allowLess && ids.length !== MAX_BATCH_SIZE)) return null;
  return Object.freeze({ batchId: value.batch_id, learningDay: value.learning_day, status: value.status, itemIds: Object.freeze([...ids]), revision: value.revision, createdAt: value.created_at, completedAt: value.completed_at });
}

/** @param {unknown} value @returns {LearnerCandidate | null} */
function parseCandidate(value) {
  if (!record(value) || !text(value.point_json) || !text(value.task_json) || !text(value.knowledge_id) || !text(value.source_id) || !positiveInteger(value.source_revision) || !text(value.source_title) || !text(value.canonical_url) || !nonNegativeInteger(value.view_count) || (value.last_answer_correct !== null && value.last_answer_correct !== 0 && value.last_answer_correct !== 1) || !nonNegativeInteger(value.scheduled_days) || (value.due_at !== null && !iso(value.due_at)) || (value.studied_at !== null && !iso(value.studied_at)) || typeof value.preference !== "number" || !Number.isFinite(value.preference) || value.preference < -1 || value.preference > 1) return null;
  let point;
  let task;
  try { point = JSON.parse(value.point_json); task = JSON.parse(value.task_json); } catch (error) { return null; }
  if (!record(point) || !text(point.summary) || !record(point.attribution) || !text(point.attribution.sourceUrl) || !Array.isArray(point.evidenceAnchors)) return null;
  const inlineLinks = point.evidenceAnchors.flatMap(anchor => record(anchor) && typeof anchor.quote === "string" && isInlineLinks(anchor.inlineLinks, anchor.quote) ? anchor.inlineLinks : []);
  const sourceClassificationRevision = value.source_classification_revision === null ? 0 : value.source_classification_revision;
  if (!nonNegativeInteger(sourceClassificationRevision)) return null;
  const sourceClassification = value.source_main_subject === null && value.source_topic === null
    ? null
    : isSubjectId(value.source_main_subject) && typeof value.source_topic === "string" && value.source_topic.trim() === value.source_topic && value.source_topic.length >= 1 && value.source_topic.length <= 120 && !/[<>\x00-\x1f\x7f]/u.test(value.source_topic)
    ? Object.freeze({ mainSubject: value.source_main_subject, topic: value.source_topic })
    : undefined;
  if (sourceClassification === undefined) return null;
  const question = parseQuestion(task);
  if (question === null) return null;
  const evidenceAnchorIds = point.evidenceAnchors.flatMap((anchor) => {
    if (!record(anchor)) return [];
    if (text(anchor.id)) return [anchor.id];
    return text(anchor.url) && text(anchor.selector) ? [`${anchor.url}#${anchor.selector}`] : [];
  });
  if (evidenceAnchorIds.length === 0) return null;
  const storedMedia = text(value.asset_id) && text(value.media_kind) && text(value.media_attribution)
    ? Object.freeze({ assetId: value.asset_id, kind: value.media_kind, url: `/api/learning-media?assetId=${encodeURIComponent(value.asset_id)}&variant=feed`, attribution: value.media_attribution, ...(value.media_purpose === "illustration" || value.media_purpose === "evidence" ? { purpose: value.media_purpose } : {}) })
    : null;
  return Object.freeze({ knowledgeId: value.knowledge_id, sourceId: value.source_id, sourceRevision: value.source_revision, questionId: question.id, viewCount: value.view_count, lastAnswerCorrect: value.last_answer_correct === null ? null : value.last_answer_correct === 1, scheduledDays: value.scheduled_days, dueAt: value.due_at, studiedAt: value.studied_at, preference: value.preference, title: value.source_title, summary: point.summary, ...(inlineLinks.length ? {inlineLinks: Object.freeze(inlineLinks)} : {}), sourceUrl: point.attribution.sourceUrl, evidenceAnchorIds: Object.freeze(evidenceAnchorIds), sourceClassification, sourceClassificationRevision, question, media: storedMedia });
}

/** @param {LearnerCandidate} candidate @returns {Record<string, unknown>} */
function publicCandidate(candidate) {
  return { knowledgeId: candidate.knowledgeId, sourceId: candidate.sourceId, sourceRevision: candidate.sourceRevision, questionId: candidate.questionId, title: candidate.title, summary: candidate.summary, ...(candidate.inlineLinks ? {inlineLinks:candidate.inlineLinks} : {}), sourceUrl: candidate.sourceUrl, evidenceAnchorIds: candidate.evidenceAnchorIds, media: candidate.media, questionLocked: candidate.studiedAt === null || candidate.dueAt !== null && Date.parse(candidate.studiedAt) < Date.parse(candidate.dueAt), sourceClassification: candidate.sourceClassification, sourceClassificationRevision: candidate.sourceClassificationRevision };
}
/** @param {LearnerCandidate} candidate @param {string} batchId @returns {Promise<Record<string, unknown>>} */
async function publicQuestion(candidate, batchId) {
  let choices = candidate.question.choices;
  if (choices !== null) {
    // The random batch identity mixes choices without moving them during retries or reloads.
    const ranked = await Promise.all(choices.map(async choice => {
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([batchId, candidate.questionId, choice.id])));
      return { choice, rank: Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("") };
    }));
    choices = Object.freeze(ranked.sort((a, b) => a.rank.localeCompare(b.rank)).map(item => item.choice));
  }
  return { questionId: candidate.questionId, knowledgeId: candidate.knowledgeId, title: candidate.title, prompt: candidate.question.prompt, kind: candidate.question.kind, choices, blanks: candidate.question.blanks?.map((blank) => ({ id: blank.id })) ?? null, pairedVariants: candidate.question.pairedVariants?.map((variant) => ({ id: variant.id, kind: variant.kind, prompt: variant.prompt, choices: variant.choices, blanks: variant.blanks?.map((blank) => ({ id: blank.id })) ?? null })) ?? null, sourceAnchorIds: candidate.question.sourceAnchorIds, revision: candidate.question.revision, media: candidate.media };
}

/** @param {PublicQuestion} question @returns {string | null} */
function correctAnswer(question) {
  if (question.kind === "fill-blank") return question.blanks?.map((blank) => blank.acceptedAnswers[0]).join(", ") ?? question.acceptedAnswers?.[0] ?? null;
  if (question.correctChoiceIds === null || question.choices === null) return null;
  const labels = question.correctChoiceIds.map((id) => question.choices?.find((choice) => choice.id === id)?.label);
  return labels.length === question.correctChoiceIds.length && labels.every(text) ? labels.join(", ") : null;
}

/** @param {{ readonly database: D1DatabasePort, readonly now: () => string, readonly random?: () => number, readonly logger: (entry: LearnerBatchLog) => void, readonly semanticGrader?: (command: { readonly prompt: string, readonly answers: readonly { readonly id: string, readonly response: string, readonly canonicalAnswers: readonly string[] }[] }) => Promise<Result<readonly number[]>>, readonly bucket?: MediaBucket | null, readonly fallbackPack?: readonly { readonly id: string, readonly path: string, readonly alt: string, readonly creator: string, readonly sourceUrl: string, readonly licence: string, readonly attribution: string }[] }} dependencies */
export function createLearningBatchService(dependencies) {
  if (typeof dependencies?.database?.prepare !== "function" || typeof dependencies.database.batch !== "function" || typeof dependencies.now !== "function" || typeof dependencies.logger !== "function" || (dependencies.semanticGrader !== undefined && typeof dependencies.semanticGrader !== "function") || (dependencies.bucket !== undefined && dependencies.bucket !== null && typeof dependencies.bucket.delete !== "function")) throw new TypeError("Learning batch dependencies are invalid.");
  const random = dependencies.random ?? Math.random;
  if (typeof random !== "function") throw new TypeError("Learning batch random source is invalid.");
  const database = dependencies.database;

  /** @param {string} ownerId @param {string} now @returns {Promise<Result<readonly LearnerCandidate[]>>} */
  async function candidates(ownerId, now) {
    if (!text(ownerId) || !iso(now)) return { ok: false, error: { kind: "LearningBatchCommandInvalid" } };
    try {
      const result = await database.prepare("SELECT kp.point_json, kc.classification_json, kc.revision AS classification_revision, kp.knowledge_id, kp.source_id, s.revision AS source_revision, sc.main_subject AS source_main_subject, sc.topic AS source_topic, sc.classification_revision AS source_classification_revision, t.task_json, s.title AS source_title, s.canonical_url, COALESCE(ls.view_count, 0) AS view_count, ls.last_answer_correct, COALESCE(ls.scheduled_days, 0) AS scheduled_days, ls.due_at, ls.studied_at, COALESCE(ls.preference, pf.preference, 0) AS preference, kp.run_id, (SELECT json_group_array(json_object('media_binding', eligible.binding_json, 'media_original_digest', eligible.digest, 'asset_id', eligible.asset_id, 'media_kind', eligible.kind, 'media_attribution', eligible.attribution)) FROM (SELECT ma.binding_json, ma.digest, ma.asset_id, ma.kind, ma.attribution FROM knowledge_workflow_media_assets ma WHERE ma.owner_id = kp.owner_id AND ma.knowledge_id = kp.knowledge_id AND ma.run_id = kp.run_id AND ma.source_revision = kp.source_revision AND ma.binding_json IS NOT NULL AND ma.revoked_at IS NULL AND NOT (ma.kind = 'screenshot' AND EXISTS (SELECT 1 FROM knowledge_workflow_materials captured WHERE captured.owner_id = kp.owner_id AND captured.run_id = kp.run_id AND json_extract(captured.material_json, '$.fileName') = json_extract(captured.material_json, '$.sourceUrl') || ' — captured page.pdf.pkpi')) ORDER BY ma.asset_id ASC) eligible) AS media_candidates FROM extraction_knowledge_points kp JOIN knowledge_workflow_quizzes q ON q.owner_id = kp.owner_id AND q.knowledge_id = kp.knowledge_id AND q.run_id = kp.run_id AND q.source_id = kp.source_id AND q.source_revision = kp.source_revision AND q.status = 'published' JOIN learning_generation_tasks t ON t.owner_id = q.owner_id AND t.item_id = q.knowledge_id AND t.status = 'published' JOIN library_sources s ON s.owner_id = kp.owner_id AND s.source_id = kp.source_id AND s.state = 'active' LEFT JOIN knowledge_classifications kc ON kc.owner_id = kp.owner_id AND kc.knowledge_id = kp.knowledge_id LEFT JOIN source_classifications sc ON sc.owner_id = kp.owner_id AND sc.source_id = kp.source_id LEFT JOIN learner_knowledge_state ls ON ls.owner_id = kp.owner_id AND ls.knowledge_id = kp.knowledge_id LEFT JOIN learner_preference_feedback pf ON pf.owner_id = kp.owner_id AND pf.knowledge_id = kp.knowledge_id WHERE kp.owner_id = ? AND kp.source_revision = s.revision AND json_type(kp.point_json, '$.summary') = 'text' AND length(trim(json_extract(kp.point_json, '$.summary'), char(9, 10, 11, 12, 13, 32, 160, 5760, 8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200, 8201, 8202, 8232, 8233, 8239, 8287, 12288, 65279))) > 0 AND EXISTS (SELECT 1 FROM knowledge_workflow_runs r WHERE r.owner_id = kp.owner_id AND r.run_id = kp.run_id AND r.source_id = kp.source_id AND r.source_revision = kp.source_revision AND r.state = 'completed') ORDER BY kp.created_at ASC, kp.knowledge_id ASC").bind(ownerId).all();
      if (!result.success || !Array.isArray(result.results)) return { ok: false, error: { kind: "LearningBatchPersistenceFailed" } };
      const parsed = [];
      for (const row of result.results) {
        let projected=row;
        if(record(row)) {
          projected={...row,asset_id:null};
          const media=text(row.media_candidates)?JSON.parse(row.media_candidates):[];
          if(!Array.isArray(media))return {ok:false,error:{kind:"LearningBatchPersistenceFailed"}};
          if(media.length>0) {
            const point=text(row.point_json)?JSON.parse(row.point_json):null;
            if(record(point)) {
              const bytes=new TextEncoder().encode(JSON.stringify({summary:point.summary,normalizedHash:point.normalizedHash,evidenceAnchors:point.evidenceAnchors}));
              const hash=`sha256:${Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),b=>b.toString(16).padStart(2,"0")).join("")}`;
              for(const asset of media) {
                if(!record(asset))return {ok:false,error:{kind:"LearningBatchPersistenceFailed"}};
                try {
                  const binding=text(asset.media_binding)?JSON.parse(asset.media_binding):null;
                  if(text(asset.asset_id)&&text(asset.media_kind)&&text(asset.media_attribution)&&record(binding)&&isMediaBindingPurpose(binding)&&(binding.kind==="webpage-support"||binding.kind==="uploaded-source")&&binding.ownerId===ownerId&&binding.runId===row.run_id&&binding.sourceRevision===row.source_revision&&binding.factHash===hash&&binding.originalDigest===asset.media_original_digest&&text(binding.imageId)&&text(binding.evidence)&&(binding.kind!=="uploaded-source"||text(binding.locator)&&text(binding.sourceDigest))) {
                    projected={...row,...asset,media_purpose:binding.purpose};
                    break;
                  }
                }catch(error){if(!(error instanceof SyntaxError))throw error;dependencies.logger({event:"learning-media-binding-failure",ownerId,failureKind:"MediaBindingUnverified"});}
              }
            }
          }
        }
        const candidate = parseCandidate(projected);
        if (candidate === null) return { ok: false, error: { kind: "LearningPairInvalid" } };
        parsed.push(candidate);
      }
      return { ok: true, value: Object.freeze(parsed) };
    } catch (error) {
      dependencies.logger({ event: "learning-batch-candidates-failure", ownerId, failureKind: "LearningBatchPersistenceFailed" });
      return { ok: false, error: { kind: "LearningBatchPersistenceFailed" } };
    }
  }

  /** @param {string} ownerId @returns {Promise<Result<BatchRow | null>>} */
  async function feedRow(ownerId) {
    try {
      const row = await database.prepare("SELECT batch_id, learning_day, status, item_ids_json, revision, created_at, completed_at FROM learner_feed_batches WHERE owner_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1").bind(ownerId).first();
      return { ok: true, value: row === null ? null : parseBatch(row, true) };
    } catch (error) {
      dependencies.logger({ event: "learning-feed-row-failure", ownerId, failureKind: "LearningBatchPersistenceFailed" });
      return { ok: false, error: { kind: "LearningBatchPersistenceFailed" } };
    }
  }

  /** @param {string} ownerId @returns {Promise<Result<BatchRow | null>>} */
  async function reviewRow(ownerId) {
    try {
      const row = await database.prepare("SELECT batch_id, learning_day, status, question_ids_json AS item_ids_json, revision, created_at, completed_at FROM learner_review_batches WHERE owner_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1").bind(ownerId).first();
      if (row === null) return { ok: true, value: null };
      const parsed = parseBatch(row, true);
      if (parsed === null) return { ok: false, error: { kind: "LearningBatchPersistenceFailed" } };
      return { ok: true, value: parsed };
    } catch (error) {
      dependencies.logger({ event: "learning-review-row-failure", ownerId, failureKind: "LearningBatchPersistenceFailed" });
      return { ok: false, error: { kind: "LearningBatchPersistenceFailed" } };
    }
  }

  /** @param {readonly string[]} ids @param {readonly LearnerCandidate[]} all @returns {Result<readonly LearnerCandidate[]>} */
  function hydrate(ids, all) {
    const byId = new Map(all.map((candidate) => [candidate.knowledgeId, candidate]));
    const hydrated = ids.flatMap((id) => {
      const candidate = byId.get(id);
      return candidate === undefined ? [] : [candidate];
    });
    return hydrated.length === ids.length ? { ok: true, value: Object.freeze(hydrated) } : { ok: false, error: { kind: "KnowledgePairNotFound" } };
  }

  /** @param {string} ownerId @param {string} day @param {readonly LearnerCandidate[]} all @param {string} idempotencyKey @returns {Promise<Result<unknown>>} */
  async function createFeed(ownerId, day, all, idempotencyKey) {
    const selection = selectKnowledgeBatch(all, { count: Math.min(MAX_BATCH_SIZE, all.length), random, now: dependencies.now() });
    if (!selection.ok) return selection;
    const batchId = `feed:${ownerId}:${day}:${crypto.randomUUID()}`;
    const createdAt = dependencies.now();
    if (!iso(createdAt)) return { ok: false, error: { kind: "LearningBatchClockInvalid" } };
    const selected = selection.value.flatMap((item) => all.find((candidate) => candidate.knowledgeId === item.knowledgeId) ?? []);
    if (selected.length !== selection.value.length) return { ok: false, error: { kind: "KnowledgePairNotFound" } };
    const result = await database.prepare("INSERT INTO learner_feed_batches (owner_id, batch_id, learning_day, status, item_ids_json, revision, idempotency_key, created_at, completed_at) VALUES (?, ?, ?, 'open', ?, 1, ?, ?, NULL)").bind(ownerId, batchId, day, JSON.stringify(selected.map((candidate) => candidate.knowledgeId)), idempotencyKey, createdAt).run();
    if (!changed(result)) return { ok: false, error: { kind: "LearningBatchPersistenceFailed" } };
    dependencies.logger({ event: "learning-feed-batch-created", ownerId, batchId, itemCount: selection.value.length });
    return { ok: true, value: Object.freeze({ batch: Object.freeze({ batchId, learningDay: day, status: "open", itemIds: Object.freeze(selected.map((candidate) => candidate.knowledgeId)), revision: 1, createdAt, completedAt: null }), items: Object.freeze(selected.map(publicCandidate)) }) };
  }

  /** @param {string} ownerId @param {string} day @param {boolean} [force] @returns {Promise<Result<unknown>>} */
  async function loadFeed(ownerId, day, force = false) {
    if (!text(ownerId) || !text(day)) return { ok: false, error: { kind: "LearningBatchCommandInvalid" } };
    const now = dependencies.now();
    const all = await candidates(ownerId, now);
    if (!all.ok) return all;
    const current = await feedRow(ownerId);
    if (!current.ok) return current;
    if (!force && current.value !== null && current.value.learningDay === day && current.value.status === "open") {
      let batch = current.value;
      const missing = batch.itemIds.filter(id => !all.value.some(candidate => candidate.knowledgeId === id && (candidate.dueAt === null || Date.parse(candidate.dueAt) <= Date.parse(now))));
      if (missing.length > 0) {
        const available = all.value.filter(candidate => !batch.itemIds.includes(candidate.knowledgeId) && (candidate.dueAt === null || Date.parse(candidate.dueAt) <= Date.parse(now)));
        const replacement = available.length === 0 ? { ok: /** @type {const} */ (true), value: [] } : selectKnowledgeBatch(available, { count: Math.min(missing.length, available.length), random, now });
        if (!replacement.ok) return replacement;
        const replacements = replacement.value.map(candidate => candidate.knowledgeId);
        const itemIds = batch.itemIds.flatMap(id => missing.includes(id) ? replacements.splice(0, 1) : [id]);
        if (itemIds.length === 0) return { ok: true, value: { batch: null, items: [] } };
        const written = await database.prepare("UPDATE learner_feed_batches SET item_ids_json = ?, revision = revision + 1 WHERE owner_id = ? AND batch_id = ? AND revision = ? AND status = 'open'").bind(JSON.stringify(itemIds), ownerId, batch.batchId, batch.revision).run();
        if (!changed(written)) return { ok: false, error: { kind: "LearningBatchPersistenceFailed" } };
        batch = { ...batch, itemIds, revision: batch.revision + 1 };
      }
      const hydrated = hydrate(batch.itemIds, all.value);
      if (!hydrated.ok) return hydrated;
      return { ok: true, value: Object.freeze({ batch, items: Object.freeze(hydrated.value.map(publicCandidate)) }) };
    }
    if (!force && current.value !== null && current.value.status === "open" && current.value.learningDay !== day) {
      dependencies.logger({ event: "learning-feed-incomplete-day-expired", ownerId, batchId: current.value.batchId });
    }
    const eligible = all.value.filter(candidate => candidate.dueAt === null || Date.parse(candidate.dueAt) <= Date.parse(now));
    if (eligible.length === 0) {
      dependencies.logger({ event: "learning-feed-batch-deferred", ownerId, itemCount: all.value.length, failureKind: "LearningBatchInsufficientCandidates" });
      return { ok: true, value: Object.freeze({ batch: null, items: Object.freeze([]) }) };
    }
    return createFeed(ownerId, day, eligible, `feed:${ownerId}:${day}:${force || current.value !== null ? crypto.randomUUID() : "daily"}`);
  }

  /** @param {unknown} command @returns {Promise<Result<unknown>>} */
  async function completeFeed(command) {
    if (!record(command) || !text(command.ownerId) || !text(command.batchId) || !text(command.idempotencyKey)) return { ok: false, error: { kind: "LearningBatchCommandInvalid" } };
    const input = /** @type {FeedCompleteCommand} */ (command);
    const replay = await commandResult(input.ownerId, input.idempotencyKey);
    if (!replay.ok) return replay;
    if (replay.value !== null) return replay.value;
    const current = await database.prepare("SELECT batch_id, learning_day, status, item_ids_json, revision, created_at, completed_at FROM learner_feed_batches WHERE owner_id = ? AND batch_id = ? LIMIT 1").bind(input.ownerId, input.batchId).first();
    const batch = parseBatch(current, true);
    if (batch === null) return { ok: false, error: { kind: "KnowledgePairNotFound" } };
    if (batch.status === "completed") return { ok: false, error: { kind: "LearningBatchAlreadyClosed" } };
    const now = dependencies.now();
    if (!iso(now)) return { ok: false, error: { kind: "LearningBatchClockInvalid" } };
    const statements = batch.itemIds.map((knowledgeId) => database.prepare("INSERT INTO learner_knowledge_state (owner_id, knowledge_id, source_id, view_count, last_answer_correct, scheduled_days, due_at, studied_at, review_count, preference, updated_at) SELECT ?, ?, source_id, 1, NULL, 0, ?, ?, 0, 0, ? FROM extraction_knowledge_points WHERE owner_id = ? AND knowledge_id = ? ON CONFLICT(owner_id, knowledge_id) DO UPDATE SET view_count = learner_knowledge_state.view_count + 1, studied_at = excluded.studied_at, due_at = COALESCE(learner_knowledge_state.due_at, excluded.due_at), updated_at = excluded.updated_at").bind(input.ownerId, knowledgeId, now, now, now, input.ownerId, knowledgeId));
    statements.push(database.prepare("UPDATE learner_feed_batches SET status = 'completed', revision = revision + 1, completed_at = ? WHERE owner_id = ? AND batch_id = ? AND status = 'open'").bind(now, input.ownerId, input.batchId));
    const result = { ownerId: input.ownerId, batchId: input.batchId, status: "completed", unlockedQuestionIds: batch.itemIds };
    statements.push(database.prepare("INSERT INTO learner_batch_commands (owner_id, idempotency_key, command_kind, result_json, created_at) VALUES (?, ?, 'feed-complete', ?, ?)").bind(input.ownerId, input.idempotencyKey, JSON.stringify(result), now));
    const written = await database.batch(statements);
    if (written.length !== statements.length || written.some((entry) => !entry.success)) return { ok: false, error: { kind: "LearningBatchPersistenceFailed" } };
    dependencies.logger({ event: "learning-feed-batch-completed", ownerId: input.ownerId, batchId: input.batchId, itemCount: batch.itemIds.length });
    return { ok: true, value: Object.freeze(result) };
  }

  /** @param {string} ownerId @param {string} idempotencyKey @returns {Promise<Result<null | { readonly ok: true, readonly value: unknown }>>} */
  async function commandResult(ownerId, idempotencyKey) {
    try {
      const row = await database.prepare("SELECT result_json FROM learner_batch_commands WHERE owner_id = ? AND idempotency_key = ? LIMIT 1").bind(ownerId, idempotencyKey).first();
      if (!record(row) || !text(row.result_json)) return { ok: true, value: null };
      const value = JSON.parse(row.result_json);
      return { ok: true, value: { ok: true, value } };
    } catch (error) {
      return { ok: false, error: { kind: "LearningBatchPersistenceFailed" } };
    }
  }

  /** @param {string} ownerId @param {string} batchId */
  async function reviewSkips(ownerId, batchId) {
    const rows = await database.prepare("SELECT result_json FROM learner_batch_commands WHERE owner_id = ? AND command_kind = 'review-skip' AND json_extract(result_json, '$.batchId') = ?").bind(ownerId, batchId).all();
    if (!rows.success || !Array.isArray(rows.results)) throw new Error("Review skips unavailable");
    /** @type {Map<string, {batchId:string,questionId:string,completed:boolean,feedback:{explanation:string,correctAnswer:string}}>} */
    const skipped = new Map();
    for (const row of rows.results) {
      if (!record(row) || !text(row.result_json)) throw new Error("Review skip invalid");
      const result = JSON.parse(row.result_json);
      if (!record(result) || result.batchId !== batchId || !text(result.questionId) || typeof result.completed !== "boolean" || !record(result.feedback) || !text(result.feedback.explanation) || !text(result.feedback.correctAnswer)) throw new Error("Review skip invalid");
      skipped.set(result.questionId, /** @type {{batchId:string,questionId:string,completed:boolean,feedback:{explanation:string,correctAnswer:string}}} */ (result));
    }
    return skipped;
  }

  /** @param {string} ownerId @param {BatchRow} batch @param {string} now */
  async function completeReview(ownerId, batch, now) {
    const count = await database.prepare("SELECT COUNT(*) AS count FROM (SELECT question_id FROM learner_review_answers WHERE owner_id = ? AND batch_id = ? UNION SELECT json_extract(result_json, '$.questionId') AS question_id FROM learner_batch_commands WHERE owner_id = ? AND command_kind = 'review-skip' AND json_extract(result_json, '$.batchId') = ?) WHERE question_id IN (SELECT value FROM json_each(?))").bind(ownerId, batch.batchId, ownerId, batch.batchId, JSON.stringify(batch.itemIds)).first();
    if (!record(count) || !nonNegativeInteger(count.count)) throw new Error("Review completion unavailable");
    if (count.count !== batch.itemIds.length) return false;
    const closed = await database.prepare("UPDATE learner_review_batches SET status = 'completed', revision = revision + 1, completed_at = ? WHERE owner_id = ? AND batch_id = ? AND status = 'open' AND question_ids_json = ?").bind(now, ownerId, batch.batchId, JSON.stringify(batch.itemIds)).run();
    if (!closed.success) throw new Error("Review completion unavailable");
    if (changed(closed)) return true;
    const current = await database.prepare("SELECT status FROM learner_review_batches WHERE owner_id = ? AND batch_id = ?").bind(ownerId, batch.batchId).first();
    return record(current) && current.status === "completed";
  }

  /** @param {unknown} command @returns {Promise<Result<unknown>>} */
  async function skipReview(command) {
    if (!record(command) || !text(command.ownerId) || !text(command.batchId) || !text(command.questionId) || !text(command.idempotencyKey) || !positiveInteger(command.questionRevision)) return { ok: false, error: { kind: "ReviewAnswerNotAllowed" } };
    try {
      const skipped = await reviewSkips(command.ownerId, command.batchId);
      const replay = skipped.get(command.questionId);
      const batch = parseBatch(await database.prepare("SELECT batch_id, learning_day, status, question_ids_json AS item_ids_json, revision, created_at, completed_at FROM learner_review_batches WHERE owner_id = ? AND batch_id = ? LIMIT 1").bind(command.ownerId, command.batchId).first(), true);
      if (batch === null || !batch.itemIds.includes(command.questionId)) return { ok: false, error: { kind: "ReviewAnswerNotAllowed" } };
      if (replay) return { ok: true, value: { ...replay, completed: await completeReview(command.ownerId, batch, dependencies.now()) } };
      if (batch.status !== "open") return { ok: false, error: { kind: "ReviewAnswerNotAllowed" } };
      const answered = await database.prepare("SELECT question_id FROM learner_review_answers WHERE owner_id = ? AND batch_id = ? AND question_id = ?").bind(command.ownerId, command.batchId, command.questionId).first();
      if (answered !== null) return { ok: false, error: { kind: "ReviewAnswerNotAllowed" } };
      const all = await candidates(command.ownerId, dependencies.now());
      if (!all.ok) return all;
      const candidate = separateQuestions(all.value).find(item => item.questionId === command.questionId);
      if (!candidate || candidate.studiedAt === null) return { ok: false, error: { kind: "KnowledgePairNotFound" } };
      if (candidate.question.revision !== command.questionRevision) return { ok: false, error: { kind: "ReviewAnswerNotAllowed" } };
      const answer = correctAnswer(candidate.question);
      if (answer === null) return { ok: false, error: { kind: "ReviewAnswerNotSupported" } };
      const now = dependencies.now();
      if (!iso(now)) return { ok: false, error: { kind: "LearningBatchClockInvalid" } };
      const result = { batchId: command.batchId, questionId: command.questionId, completed: false, feedback: { correctAnswer: answer, explanation: candidate.question.explanation } };
      const written = await database.prepare("INSERT INTO learner_batch_commands (owner_id, idempotency_key, command_kind, result_json, created_at) SELECT ?, ?, 'review-skip', ?, ? WHERE EXISTS (SELECT 1 FROM learner_review_batches WHERE owner_id = ? AND batch_id = ? AND status = 'open') AND NOT EXISTS (SELECT 1 FROM learner_review_answers WHERE owner_id = ? AND batch_id = ? AND question_id = ?) AND NOT EXISTS (SELECT 1 FROM learner_batch_commands WHERE owner_id = ? AND command_kind = 'review-skip' AND json_extract(result_json, '$.batchId') = ? AND json_extract(result_json, '$.questionId') = ?)").bind(command.ownerId, command.idempotencyKey, JSON.stringify(result), now, command.ownerId, command.batchId, command.ownerId, command.batchId, command.questionId, command.ownerId, command.batchId, command.questionId).run();
      if (!changed(written)) {
        const replay = (await reviewSkips(command.ownerId, command.batchId)).get(command.questionId);
        return replay ? { ok: true, value: { ...replay, completed: await completeReview(command.ownerId, batch, now) } } : { ok: false, error: { kind: "ReviewAnswerNotAllowed" } };
      }
      result.completed = await completeReview(command.ownerId, batch, now);
      const saved = await database.prepare("UPDATE learner_batch_commands SET result_json = ? WHERE owner_id = ? AND idempotency_key = ?").bind(JSON.stringify(result), command.ownerId, command.idempotencyKey).run();
      if (!changed(saved)) throw new Error("Review skip result unavailable");
      dependencies.logger({ event: "learning-review-skipped", ownerId: command.ownerId, batchId: command.batchId });
      return { ok: true, value: Object.freeze(result) };
    } catch (error) {
      dependencies.logger({ event: "learning-review-skip-failure", ownerId: command.ownerId, batchId: command.batchId, failureKind: "LearningBatchPersistenceFailed" });
      return { ok: false, error: { kind: "LearningBatchPersistenceFailed" } };
    }
  }

  /** @param {unknown} command @returns {Promise<Result<unknown>>} */
  async function replaceReview(command) {
    if (!record(command) || !text(command.ownerId) || !text(command.batchId) || !text(command.questionId) || !positiveInteger(command.questionRevision) || !text(command.idempotencyKey)) return { ok: false, error: { kind: "ReviewAnswerNotAllowed" } };
    try {
      const replay = await commandResult(command.ownerId, command.idempotencyKey);
      if (!replay.ok) return replay;
      if (replay.value !== null) {
        const saved = replay.value.value;
        return record(saved) && saved.questionId === command.questionId && record(saved.batch) && saved.batch.batchId === command.batchId ? replay.value : { ok: false, error: { kind: "ReviewAnswerNotAllowed" } };
      }
      const current = await reviewRow(command.ownerId);
      if (!current.ok) return current;
      const batch = current.value;
      if (!batch || batch.batchId !== command.batchId || !batch.itemIds.includes(command.questionId)) return { ok: false, error: { kind: "ReviewAnswerNotAllowed" } };
      const skipped = await reviewSkips(command.ownerId, batch.batchId);
      if (!skipped.has(command.questionId)) return { ok: false, error: { kind: "ReviewAnswerNotAllowed" } };
      const now = dependencies.now();
      if (!iso(now)) return { ok: false, error: { kind: "LearningBatchClockInvalid" } };
      const knowledge = await candidates(command.ownerId, now);
      if (!knowledge.ok) return knowledge;
      const all = await reviewCandidates(command.ownerId, knowledge.value);
      if (!all.ok) return all;
      const original = all.value.find(item => item.questionId === command.questionId);
      if (!original || original.question.revision !== command.questionRevision) return { ok: false, error: { kind: "ReviewAnswerNotAllowed" } };
      const removed = await database.prepare("SELECT json_extract(result_json, '$.questionId') AS question_id FROM learner_batch_commands WHERE owner_id = ? AND command_kind = 'review-remove'").bind(command.ownerId).all();
      if (!removed.success || removed.results.some(row => !record(row) || !text(row.question_id))) throw new Error("Removed quizzes unavailable");
      const removedIds = new Set(removed.results.map(row => /** @type {{question_id:string}} */ (row).question_id));
      const excluded = new Set([...batch.itemIds, ...skipped.keys(), ...removedIds]);
      const due = all.value.filter(item => !removedIds.has(item.questionId) && reviewEligible(item, now));
      const eligible = due.filter(item => !excluded.has(item.questionId));
      if (!eligible.length) return { ok: false, error: { kind: "ReviewReplacementUnavailable" } };
      const selection = selectKnowledgeBatch(eligible.map(item => ({ knowledgeId: item.questionId, sourceId: item.sourceId, questionId: item.questionId, viewCount: 0, lastAnswerCorrect: null, scheduledDays: item.scheduledDays, preference: 0 })), { count: 1, random, now });
      if (!selection.ok) return selection;
      const replacement = eligible.find(item => item.questionId === selection.value[0].questionId);
      if (!replacement) throw new Error("Replacement quiz unavailable");
      const nextBatch = { ...batch, itemIds: batch.itemIds.map(id => id === command.questionId ? replacement.questionId : id), status: "open", completedAt: null, revision: batch.revision + 1 };
      const result = { questionId: command.questionId, batch: nextBatch, questions: [await publicQuestion(replacement, batch.batchId)], dueCount: due.length };
      // Persist the replacement and replay together; concurrent refreshes/replacements cannot overwrite this batch.
      const saved = await database.batch([
        database.prepare("INSERT INTO learner_batch_commands (owner_id, idempotency_key, command_kind, result_json, created_at) SELECT ?, ?, 'review-replace', ?, ? WHERE EXISTS (SELECT 1 FROM learner_review_batches WHERE owner_id = ? AND batch_id = ? AND revision = ? AND batch_id = (SELECT batch_id FROM learner_review_batches WHERE owner_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1))").bind(command.ownerId, command.idempotencyKey, JSON.stringify(result), now, command.ownerId, batch.batchId, batch.revision, command.ownerId),
        database.prepare("UPDATE learner_review_batches SET question_ids_json = ?, status = 'open', completed_at = NULL, revision = revision + 1 WHERE owner_id = ? AND batch_id = ? AND revision = ? AND EXISTS (SELECT 1 FROM learner_batch_commands WHERE owner_id = ? AND idempotency_key = ? AND command_kind = 'review-replace')").bind(JSON.stringify(nextBatch.itemIds), command.ownerId, batch.batchId, batch.revision, command.ownerId, command.idempotencyKey),
      ]);
      if (!saved.every(changed)) return { ok: false, error: { kind: "ReviewAnswerNotAllowed" } };
      dependencies.logger({ event: "learning-review-replaced", ownerId: command.ownerId, batchId: batch.batchId });
      return { ok: true, value: result };
    } catch {
      dependencies.logger({ event: "learning-review-replace-failure", ownerId: command.ownerId, batchId: command.batchId, failureKind: "LearningBatchPersistenceFailed" });
      return { ok: false, error: { kind: "LearningBatchPersistenceFailed" } };
    }
  }

  /** @param {readonly LearnerCandidate[]} all @returns {readonly LearnerCandidate[]} */
  function separateQuestions(all) {
    return all.flatMap(candidate => candidate.question.pairedVariants?.map(variant => ({
      ...candidate, pairedQuestionId: candidate.questionId, questionId: `${candidate.questionId}:${variant.id}`,
      question: { ...candidate.question, ...variant, id: `${candidate.questionId}:${variant.id}`, acceptedAnswers: null, blankId: null, pairedVariants: null },
    })) ?? [candidate]);
  }

  /** @param {string} ownerId @param {readonly LearnerCandidate[]} all @returns {Promise<Result<readonly LearnerCandidate[]>>} */
  async function reviewCandidates(ownerId, all) {
    const separated = separateQuestions(all);
    if (!separated.some(candidate => candidate.pairedQuestionId !== undefined)) return { ok: true, value: separated };
    try {
      const saved = await database.prepare("SELECT question_id, last_answer_correct, scheduled_days, due_at FROM learner_question_state WHERE owner_id = ?").bind(ownerId).all();
      if (!saved.success || !Array.isArray(saved.results)) throw new Error("Question schedules unavailable");
      const states = new Map();
      for (const state of saved.results) {
        if (!record(state) || !text(state.question_id) || !nonNegativeInteger(state.scheduled_days) || !iso(state.due_at) || state.last_answer_correct !== null && state.last_answer_correct !== 0 && state.last_answer_correct !== 1) throw new Error("Question schedule invalid");
        states.set(state.question_id, state);
      }
      return { ok: true, value: separated.map(candidate => {
        const state = states.get(candidate.questionId);
        return { ...candidate, lastAnswerCorrect: state === undefined || state.due_at !== candidate.dueAt || state.scheduled_days !== candidate.scheduledDays || state.last_answer_correct === null ? null : state.last_answer_correct === 1 };
      }) };
    } catch (error) {
      dependencies.logger({ event: "learning-review-schedules-failure", ownerId, failureKind: "LearningBatchPersistenceFailed" });
      return { ok: false, error: { kind: "LearningBatchPersistenceFailed" } };
    }
  }

  /** @param {LearnerCandidate} candidate @param {string} now */
  function reviewEligible(candidate, now) {
    return candidate.studiedAt !== null && candidate.dueAt !== null &&
      Date.parse(candidate.dueAt) <= Date.parse(now) && Date.parse(candidate.studiedAt) >= Date.parse(candidate.dueAt) &&
      (candidate.pairedQuestionId === undefined || candidate.lastAnswerCorrect !== true);
  }

  /** @param {string} ownerId @param {string} day @param {boolean} [force] @returns {Promise<Result<unknown>>} */
  async function loadReview(ownerId, day, force = false) {
    if (!text(ownerId) || !text(day)) return { ok: false, error: { kind: "LearningBatchCommandInvalid" } };
    const knowledge = await candidates(ownerId, dependencies.now());
    if (!knowledge.ok) return knowledge;
    const all = await reviewCandidates(ownerId, knowledge.value);
    if (!all.ok) return all;
    let removed;
    try {
      const rows = await database.prepare("SELECT json_extract(result_json, '$.questionId') AS question_id FROM learner_batch_commands WHERE owner_id = ? AND command_kind = 'review-remove'").bind(ownerId).all();
      if (!rows.success || rows.results.some(row => !record(row) || !text(row.question_id))) throw new Error("Removed quizzes unavailable");
      removed = new Set(rows.results.map(row => /** @type {{question_id:string}} */ (row).question_id));
    } catch {
      dependencies.logger({ event: "learning-review-removals-failure", ownerId, failureKind: "LearningBatchPersistenceFailed" });
      return { ok: false, error: { kind: "LearningBatchPersistenceFailed" } };
    }
    const available = all.value.filter(candidate => !removed.has(candidate.questionId));
    const current = await reviewRow(ownerId);
    if (!current.ok) return current;
    if (!force && current.value !== null && current.value.learningDay === day && current.value.itemIds.every(id => all.value.some(candidate => candidate.questionId === id))) {
      const itemIds = current.value.itemIds.filter(id => !removed.has(id));
      if (itemIds.length) return hydrateReview(ownerId, { ...current.value, itemIds }, available);
    }
    const due = available.filter((candidate) => reviewEligible(candidate, dependencies.now()));
    if (due.length < 1) return { ok: true, value: Object.freeze({ batch: null, questions: Object.freeze([]), dueCount: 0 }) };
    const selection = selectKnowledgeBatch(due.map((candidate) => ({ knowledgeId: candidate.questionId, sourceId: candidate.sourceId, questionId: candidate.questionId, viewCount: 0, lastAnswerCorrect: null, scheduledDays: candidate.scheduledDays, preference: 0 })), { count: Math.min(MAX_BATCH_SIZE, due.length), random, now: dependencies.now() });
    if (!selection.ok) return selection;
    const byId = new Map(all.value.map((candidate) => [candidate.questionId, candidate]));
    const selected = selection.value.map((candidate) => byId.get(candidate.knowledgeId)).filter((candidate) => candidate !== undefined);
    if (selected.length !== selection.value.length) return { ok: false, error: { kind: "KnowledgePairNotFound" } };
    const batchId = `review:${ownerId}:${day}:${crypto.randomUUID()}`;
    const createdAt = dependencies.now();
    const inserted = await database.prepare("INSERT INTO learner_review_batches (owner_id, batch_id, learning_day, status, question_ids_json, revision, idempotency_key, created_at, completed_at) VALUES (?, ?, ?, 'open', ?, 1, ?, ?, NULL)").bind(ownerId, batchId, day, JSON.stringify(selected.map((candidate) => candidate.questionId)), `review:${ownerId}:${day}:${force || current.value !== null ? crypto.randomUUID() : "daily"}`, createdAt).run();
    if (!changed(inserted)) return { ok: false, error: { kind: "LearningBatchPersistenceFailed" } };
    return { ok: true, value: Object.freeze({ batch: Object.freeze({ batchId, learningDay: day, status: "open", itemIds: Object.freeze(selected.map((candidate) => candidate.questionId)), revision: 1, createdAt, completedAt: null }), questions: Object.freeze(await Promise.all(selected.map(candidate => publicQuestion(candidate, batchId)))), dueCount: due.length }) };
  }

  /** @param {string} ownerId @param {string | null} [sourceId] @returns {Promise<Result<unknown>>} */
  async function listKnowledge(ownerId, sourceId = null) {
    const all = await candidates(ownerId, dependencies.now());
    if (!all.ok) return all;
    const selected = sourceId === null
      ? all.value
      : all.value.filter((candidate) => candidate.sourceId === sourceId);
    dependencies.logger({ event: "learning-library-knowledge-listed", ownerId, itemCount: selected.length });
    return { ok: true, value: Object.freeze({ items: Object.freeze(selected.map(publicCandidate)) }) };
  }

  /** @param {string} ownerId @param {BatchRow} batch @param {readonly LearnerCandidate[]} all @returns {Promise<Result<unknown>>} */
  async function hydrateReview(ownerId, batch, all) {
    const byQuestion = new Map(all.map((candidate) => [candidate.questionId, candidate]));
    const selected = batch.itemIds.map((id) => byQuestion.get(id)).filter((candidate) => candidate !== undefined);
    if (selected.length !== batch.itemIds.length) return { ok: false, error: { kind: "KnowledgePairNotFound" } };
    let skipped;
    try { skipped = await reviewSkips(ownerId, batch.batchId); } catch (error) { return { ok: false, error: { kind: "LearningBatchPersistenceFailed" } }; }
    const answeredIds = new Set();
    if (batch.status === "open") {
      try {
        const answered = await database.prepare("SELECT question_id FROM learner_review_answers WHERE owner_id = ? AND batch_id = ?").bind(ownerId, batch.batchId).all();
        if (!answered.success || !Array.isArray(answered.results) || answered.results.some(row => !record(row) || !text(row.question_id))) throw new Error("Review answer projection invalid");
        for (const row of answered.results) answeredIds.add(/** @type {{question_id:string}} */ (row).question_id);
      } catch (error) {
        dependencies.logger({ event: "learning-review-hydration-failure", ownerId, batchId: batch.batchId, failureKind: "LearningBatchPersistenceFailed" });
        return { ok: false, error: { kind: "LearningBatchPersistenceFailed" } };
      }
    }
    return { ok: true, value: Object.freeze({ batch, skipped: Object.freeze([...skipped.values()].filter(item => batch.itemIds.includes(item.questionId))), questions: Object.freeze(await Promise.all(selected.filter(candidate => !answeredIds.has(candidate.questionId) && (batch.status === "completed" || skipped.has(candidate.questionId) || reviewEligible(candidate, dependencies.now()))).map(candidate => publicQuestion(candidate, batch.batchId)))), dueCount: all.filter((candidate) => reviewEligible(candidate, dependencies.now())).length }) };
  }

  /** @param {unknown} command @returns {Promise<Result<unknown>>} */
  async function removeReview(command) {
    if (!record(command) || !text(command.ownerId) || !text(command.batchId) || !text(command.questionId) || !positiveInteger(command.questionRevision) || !text(command.idempotencyKey)) return { ok: false, error: { kind: "ReviewRemovalNotAllowed" } };
    try {
      const replay = await commandResult(command.ownerId, command.idempotencyKey);
      if (!replay.ok) return replay;
      if (replay.value !== null) {
        const saved = replay.value.value;
        return record(saved) && saved.removed === true && saved.batchId === command.batchId && saved.questionId === command.questionId ? replay.value : { ok: false, error: { kind: "ReviewRemovalNotAllowed" } };
      }
      const knowledge = await candidates(command.ownerId, dependencies.now());
      if (!knowledge.ok) return knowledge;
      const question = separateQuestions(knowledge.value).find(item => item.questionId === command.questionId);
      if (!question || question.question.revision !== command.questionRevision) return { ok: false, error: { kind: "ReviewRemovalNotAllowed" } };
      const now = dependencies.now();
      if (!iso(now)) return { ok: false, error: { kind: "LearningBatchClockInvalid" } };
      const result = { batchId: command.batchId, questionId: command.questionId, removed: true };
      // Keep retrieval history and the paired task; suppress only this question ID.
      const written = await database.prepare("INSERT INTO learner_batch_commands (owner_id, idempotency_key, command_kind, result_json, created_at) SELECT ?, ?, 'review-remove', ?, ? WHERE EXISTS (SELECT 1 FROM learner_review_batches WHERE owner_id = ? AND batch_id = ? AND EXISTS (SELECT 1 FROM json_each(question_ids_json) WHERE value = ?)) AND (EXISTS (SELECT 1 FROM learner_review_answers WHERE owner_id = ? AND batch_id = ? AND question_id = ?) OR EXISTS (SELECT 1 FROM learner_batch_commands WHERE owner_id = ? AND command_kind = 'review-skip' AND json_extract(result_json, '$.batchId') = ? AND json_extract(result_json, '$.questionId') = ?))").bind(command.ownerId, command.idempotencyKey, JSON.stringify(result), now, command.ownerId, command.batchId, command.questionId, command.ownerId, command.batchId, command.questionId, command.ownerId, command.batchId, command.questionId).run();
      if (!changed(written)) return { ok: false, error: { kind: written.success ? "ReviewRemovalNotAllowed" : "LearningBatchPersistenceFailed" } };
      dependencies.logger({ event: "learning-review-removed", ownerId: command.ownerId, batchId: command.batchId });
      return { ok: true, value: result };
    } catch {
      dependencies.logger({ event: "learning-review-remove-failure", ownerId: command.ownerId, batchId: command.batchId, failureKind: "LearningBatchPersistenceFailed" });
      return { ok: false, error: { kind: "LearningBatchPersistenceFailed" } };
    }
  }

  /** @param {unknown} command @returns {Promise<Result<unknown>>} */
  async function answerReview(command) {
    if (!record(command) || !text(command.ownerId) || !text(command.batchId) || !text(command.questionId) || !text(command.idempotencyKey) || !Array.isArray(command.selectedChoiceIds) || command.selectedChoiceIds.some((id) => !text(id)) || (command.answerText !== undefined && command.answerText !== null && !text(command.answerText)) || (command.blankAnswers !== undefined && command.blankAnswers !== null && (!Array.isArray(command.blankAnswers) || command.blankAnswers.some((answer) => !record(answer) || !text(answer.id) || !text(answer.text)))) || (command.pairedBlankAnswers !== undefined && command.pairedBlankAnswers !== null && (!Array.isArray(command.pairedBlankAnswers) || command.pairedBlankAnswers.some((answer) => !record(answer) || !text(answer.id) || !text(answer.text))))) {
      dependencies.logger({ event: "learning-review-answer-failure", failureKind: "ReviewAnswerNotAllowed" });
      return { ok: false, error: { kind: "ReviewAnswerNotAllowed" } };
    }
    // Stale clients may send retired confidence metadata; never persist it.
    dependencies.logger({ event: "learning-review-answer-entry", ownerId: command.ownerId, batchId: command.batchId });
    /** @param {string} kind @returns {Result<never>} */
    const fail = (kind) => { dependencies.logger({ event: "learning-review-answer-failure", ownerId: /** @type {string} */ (command.ownerId), batchId: /** @type {string} */ (command.batchId), failureKind: kind }); return { ok: false, error: { kind } }; };
    try {
    const replay = await commandResult(command.ownerId, command.idempotencyKey);
    if (!replay.ok) return fail(replay.error.kind);
    if (replay.value !== null) { dependencies.logger({ event: "learning-review-answer-success", ownerId: command.ownerId, batchId: command.batchId }); return replay.value; }
    const batchRowValue = await database.prepare("SELECT batch_id, learning_day, status, question_ids_json AS item_ids_json, revision, created_at, completed_at FROM learner_review_batches WHERE owner_id = ? AND batch_id = ? LIMIT 1").bind(command.ownerId, command.batchId).first();
    const batch = parseBatch(batchRowValue, true);
    if (batch === null || batch.status !== "open" || !batch.itemIds.includes(command.questionId)) return fail("ReviewAnswerNotAllowed");
    if ((await reviewSkips(command.ownerId, command.batchId)).has(command.questionId)) return fail("ReviewAnswerNotAllowed");
    const knowledge = await candidates(command.ownerId, dependencies.now());
    if (!knowledge.ok) return fail(knowledge.error.kind);
    const all = await reviewCandidates(command.ownerId, knowledge.value);
    if (!all.ok) return fail(all.error.kind);
    const candidate = all.value.find((item) => item.questionId === command.questionId) ?? knowledge.value.find(item => item.questionId === command.questionId);
    if (candidate === undefined || candidate.studiedAt === null) return fail("KnowledgePairNotFound");
    if (candidate.pairedQuestionId !== undefined && command.questionRevision !== candidate.question.revision) return fail("ReviewAnswerNotAllowed");
    if (candidate.question.pairedVariants !== null) {
      if (candidate.question.pairedVariants.length !== 2 || command.questionRevision !== candidate.question.revision || command.selectedChoiceIds.length === 0 || command.pairedBlankAnswers === undefined || command.pairedBlankAnswers === null || command.answerText !== undefined && command.answerText !== null || command.blankAnswers !== undefined && command.blankAnswers !== null) return fail("ReviewAnswerNotAllowed");
      const choiceVariant = candidate.question.pairedVariants.find((variant) => variant.kind === "single-choice" || variant.kind === "multiple-choice");
      const blankVariant = candidate.question.pairedVariants.find((variant) => variant.kind === "fill-blank");
      if (choiceVariant === undefined || blankVariant === undefined || choiceVariant.choices === null || choiceVariant.correctChoiceIds === null || blankVariant.blanks === null || command.selectedChoiceIds.some((id) => !choiceVariant.choices?.some((choice) => choice.id === id)) || new Set(command.selectedChoiceIds).size !== command.selectedChoiceIds.length || choiceVariant.kind === "single-choice" && command.selectedChoiceIds.length !== 1) return fail("ReviewAnswerNotAllowed");
      const choiceCorrect = command.selectedChoiceIds.length === choiceVariant.correctChoiceIds.length && command.selectedChoiceIds.every((id) => choiceVariant.correctChoiceIds?.includes(id));
      const fillBlanks = blankVariant.blanks;
      if (fillBlanks.length === 0 || command.pairedBlankAnswers.length !== fillBlanks.length || command.pairedBlankAnswers.some((answer, index) => answer.id !== fillBlanks[index]?.id) || new Set(command.pairedBlankAnswers.map((answer) => answer.id)).size !== fillBlanks.length) return fail("ReviewAnswerNotAllowed");
      const pairedBlankAnswers = /** @type {readonly {readonly id:string,readonly text:string}[]} */ (command.pairedBlankAnswers);
      /** @type {(value:string)=>string} */
      const normalizeAnswer = (value) => value.normalize("NFKC").trim().toLocaleLowerCase().replace(/\s+/gu, " ");
      const blankCorrect = fillBlanks.map((blank, index) => blank.acceptedAnswers.some((answer) => normalizeAnswer(answer) === normalizeAnswer(pairedBlankAnswers[index].text)));
      if (blankCorrect.some((correct) => !correct)) {
        if (dependencies.semanticGrader === undefined) return fail("ReviewGradingUnavailable");
        let judged;
        const unresolved = fillBlanks.flatMap((blank, index) => blankCorrect[index] ? [] : [{ id: blank.id, response: pairedBlankAnswers[index].text, canonicalAnswers: blank.acceptedAnswers }]);
        try { judged = await dependencies.semanticGrader({ prompt: blankVariant.prompt, answers: unresolved }); } catch (error) { return fail("ReviewGradingUnavailable"); }
        if (!judged.ok || judged.value.length !== unresolved.length || judged.value.some((value) => typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1)) return fail("ReviewGradingUnavailable");
        let gradedIndex = 0;
        for (let index = 0; index < blankCorrect.length; index += 1) if (!blankCorrect[index]) blankCorrect[index] = judged.value[gradedIndex++] >= 0.7;
      }
      const fillCorrect = blankCorrect.every(Boolean);
      const correct = choiceCorrect && fillCorrect;
      const now = dependencies.now();
      if (!iso(now)) return fail("LearningBatchClockInvalid");
      const nextDays = correct ? Math.min(365, Math.max(1, candidate.scheduledDays === 0 ? 1 : candidate.scheduledDays * 2)) : candidate.scheduledDays;
      const dueAt = correct ? new Date(Date.parse(now) + nextDays * 86_400_000).toISOString() : candidate.dueAt;
      const correctChoiceLabels = choiceVariant.correctChoiceIds.map((id) => choiceVariant.choices?.find((choice) => choice.id === id)?.label);
      if (correctChoiceLabels.some((label) => !text(label))) return fail("LearningPairInvalid");
      const feedback = { explanation: `${choiceVariant.explanation} ${blankVariant.explanation}`, correctAnswer: `${correctChoiceLabels.join(", ")}; ${fillBlanks.map((blank) => blank.acceptedAnswers[0]).join(", ")}`, components: [{ id: choiceVariant.id, correct: choiceCorrect, correctAnswer: correctChoiceLabels.join(", ") }, ...fillBlanks.map((blank, index) => ({ id: blank.id, correct: blankCorrect[index], correctAnswer: blank.acceptedAnswers[0] }))] };
      const answer = { ownerId: command.ownerId, batchId: command.batchId, questionId: command.questionId, correct, score: correct ? 1 : 0, nextDueAt: dueAt, feedback, completed: false };
      const statements = [
        database.prepare("INSERT INTO learner_review_answers (owner_id, batch_id, question_id, selected_choice_ids_json, correct, score, answered_at, knowledge_id) SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM learner_review_batches WHERE owner_id = ? AND batch_id = ? AND status = 'open') AND NOT EXISTS (SELECT 1 FROM learner_batch_commands WHERE owner_id = ? AND command_kind = 'review-skip' AND json_extract(result_json, '$.batchId') = ? AND json_extract(result_json, '$.questionId') = ?)").bind(command.ownerId, command.batchId, command.questionId, JSON.stringify(command.selectedChoiceIds), correct ? 1 : 0, correct ? 1 : 0, now, candidate.knowledgeId, command.ownerId, command.batchId, command.ownerId, command.batchId, command.questionId),
        database.prepare("UPDATE learner_knowledge_state SET last_answer_correct = ?, scheduled_days = ?, due_at = ?, review_count = review_count + 1, updated_at = ? WHERE owner_id = ? AND knowledge_id = ? AND studied_at IS NOT NULL AND EXISTS (SELECT 1 FROM learner_review_answers WHERE owner_id = ? AND batch_id = ? AND question_id = ?)").bind(correct ? 1 : 0, nextDays, dueAt, now, command.ownerId, candidate.knowledgeId, command.ownerId, command.batchId, command.questionId),
        database.prepare("UPDATE learner_review_batches SET status = 'completed', revision = revision + 1, completed_at = ? WHERE owner_id = ? AND batch_id = ? AND status = 'open' AND (SELECT COUNT(*) FROM learner_review_answers WHERE owner_id = ? AND batch_id = ?) = json_array_length(question_ids_json)").bind(now, command.ownerId, command.batchId, command.ownerId, command.batchId),
        database.prepare("INSERT INTO learner_batch_commands (owner_id, idempotency_key, command_kind, result_json, created_at) SELECT ?, ?, 'review-answer', json_set(?, '$.completed', CASE WHEN (SELECT status FROM learner_review_batches WHERE owner_id = ? AND batch_id = ?) = 'completed' THEN json('true') ELSE json('false') END), ? WHERE EXISTS (SELECT 1 FROM learner_review_answers WHERE owner_id = ? AND batch_id = ? AND question_id = ?)").bind(command.ownerId, command.idempotencyKey, JSON.stringify(answer), command.ownerId, command.batchId, now, command.ownerId, command.batchId, command.questionId),
      ];
      const written = await database.batch(statements);
      if (written.length !== statements.length || written.some((entry) => !entry.success) || !changed(written[0]) || !changed(written[3])) return fail("LearningBatchPersistenceFailed");
      const result = Object.freeze({ ...answer, completed: await completeReview(command.ownerId, batch, now) });
      const saved = await database.prepare("UPDATE learner_batch_commands SET result_json = ? WHERE owner_id = ? AND idempotency_key = ?").bind(JSON.stringify(result), command.ownerId, command.idempotencyKey).run();
      if (!changed(saved)) return fail("LearningBatchPersistenceFailed");
      dependencies.logger({ event: "learning-review-answer-success", ownerId: command.ownerId, batchId: command.batchId });
      return { ok: true, value: result };
    }
    if (candidate.question.kind === "fill-blank" ? command.selectedChoiceIds.length !== 0 || (candidate.question.blanks === null ? command.blankAnswers !== undefined && command.blankAnswers !== null : command.answerText !== undefined && command.answerText !== null) : command.blankAnswers !== undefined && command.blankAnswers !== null || command.answerText !== undefined && command.answerText !== null) return fail("ReviewAnswerNotAllowed");
    let score;
    /** @type {{ id: string, correct: boolean, correctAnswer: string }[]} */
    const components = [];
    if (candidate.question.kind === "fill-blank") {
      const blanks = candidate.question.blanks ?? (candidate.question.acceptedAnswers !== null && candidate.question.blankId !== null ? [{ id: candidate.question.blankId, acceptedAnswers: candidate.question.acceptedAnswers }] : []);
      const submitted = candidate.question.blanks === null ? [{ id: candidate.question.blankId, text: command.answerText }] : command.blankAnswers;
      if (blanks.length === 0 || !Array.isArray(submitted) || submitted.length !== blanks.length || new Set(submitted.map(answer => answer.id)).size !== blanks.length || submitted.some((answer, index) => answer.id !== blanks[index].id || !text(answer.text))) return fail("ReviewAnswerNotAllowed");
      if (dependencies.semanticGrader === undefined) return fail("ReviewGradingUnavailable");
      let judged;
      try { judged = await dependencies.semanticGrader({ prompt: candidate.question.prompt, answers: blanks.map((blank, index) => ({ id: blank.id, response: /** @type {string} */ (submitted[index].text), canonicalAnswers: blank.acceptedAnswers })) }); } catch (error) { return fail("ReviewGradingUnavailable"); }
      if (!judged.ok || judged.value.length !== blanks.length || judged.value.some(value => typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1)) return fail("ReviewGradingUnavailable");
      const scores = judged.value;
      blanks.forEach((blank, index) => components.push({ id: blank.id, correct: scores[index] >= 0.7, correctAnswer: blank.acceptedAnswers[0] }));
      score = scores.reduce((sum, value) => sum + value, 0) / scores.length;
    } else {
      const expected = candidate.question.correctChoiceIds;
      const choices = candidate.question.choices;
      const selected = /** @type {string[]} */ (command.selectedChoiceIds);
      if (expected === null || choices === null || selected.length === 0 || new Set(selected).size !== selected.length || selected.some((id) => !choices.some((choice) => choice.id === id)) || (candidate.question.kind === "single-choice" && selected.length !== 1)) return fail("ReviewAnswerNotAllowed");
      const hits = selected.filter((id) => expected.includes(id)).length;
      const wrong = selected.length - hits;
      score = candidate.question.kind === "multiple-choice" ? hits === expected.length && wrong === 0 ? 1 : 0 : hits === 1 ? 1 : 0;
      choices.forEach((choice) => components.push({ id: choice.id, correct: expected.includes(choice.id) === selected.includes(choice.id), correctAnswer: expected.includes(choice.id) ? choice.label : "" }));
    }
    const now = dependencies.now();
    const correct = score >= 0.7;
    if (candidate.pairedQuestionId !== undefined && !reviewEligible(candidate, now)) return fail("ReviewAnswerNotAllowed");
    const siblings = all.value.filter(item => item.pairedQuestionId === candidate.pairedQuestionId && item.knowledgeId === candidate.knowledgeId);
    const pairComplete = correct && (candidate.pairedQuestionId === undefined || siblings.every(item => item.questionId === candidate.questionId || item.lastAnswerCorrect === true));
    const nextDays = pairComplete ? Math.min(365, Math.max(1, candidate.scheduledDays === 0 ? 1 : candidate.scheduledDays * 2)) : candidate.scheduledDays;
    const dueAt = pairComplete ? new Date(Date.parse(now) + nextDays * 86_400_000).toISOString() : candidate.dueAt;
    const answerText = correctAnswer(candidate.question);
    if (answerText === null) return fail("ReviewAnswerNotSupported");
    const answer = { ownerId: command.ownerId, batchId: command.batchId, questionId: command.questionId, correct, score, nextDueAt: dueAt, feedback: { explanation: candidate.question.explanation, correctAnswer: answerText, components } };
    const prior = await database.prepare("SELECT MAX(answered_at) AS answered_at FROM learner_review_answers WHERE owner_id = ? AND question_id = ?").bind(command.ownerId, command.questionId).first();
    if (prior !== null && (!record(prior) || (prior.answered_at !== null && !iso(prior.answered_at)))) return fail("ProgressDataInvalid");
    const lastAttemptAt = record(prior) && iso(prior.answered_at) ? prior.answered_at : candidate.lastAnswerCorrect === null ? candidate.studiedAt : null;
    const elapsedDays = lastAttemptAt === null ? null : (Date.parse(now) - Date.parse(lastAttemptAt)) / 86_400_000;
    if (elapsedDays !== null && (!Number.isFinite(elapsedDays) || elapsedDays < 0)) return fail("ProgressDataInvalid");
    const statements = [
      database.prepare("INSERT INTO learner_review_answers (owner_id, batch_id, question_id, selected_choice_ids_json, correct, score, answered_at, knowledge_id, elapsed_days, previous_correct) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM learner_review_batches WHERE owner_id = ? AND batch_id = ? AND status = 'open') AND NOT EXISTS (SELECT 1 FROM learner_batch_commands WHERE owner_id = ? AND command_kind = 'review-skip' AND json_extract(result_json, '$.batchId') = ? AND json_extract(result_json, '$.questionId') = ?)").bind(command.ownerId, command.batchId, command.questionId, JSON.stringify(command.selectedChoiceIds), correct ? 1 : 0, score, now, candidate.knowledgeId, elapsedDays, candidate.lastAnswerCorrect === null ? null : candidate.lastAnswerCorrect ? 1 : 0, command.ownerId, command.batchId, command.ownerId, command.batchId, command.questionId),
      database.prepare("UPDATE learner_knowledge_state SET last_answer_correct = ?, scheduled_days = ?, due_at = ?, review_count = review_count + 1, updated_at = ? WHERE owner_id = ? AND knowledge_id = ? AND studied_at IS NOT NULL AND EXISTS (SELECT 1 FROM learner_review_answers WHERE owner_id = ? AND batch_id = ? AND question_id = ?)").bind(correct ? 1 : 0, nextDays, dueAt, now, command.ownerId, candidate.knowledgeId, command.ownerId, command.batchId, command.questionId),
      database.prepare("INSERT INTO learner_batch_commands (owner_id, idempotency_key, command_kind, result_json, created_at) SELECT ?, ?, 'review-answer', ?, ? WHERE EXISTS (SELECT 1 FROM learner_review_answers WHERE owner_id = ? AND batch_id = ? AND question_id = ?)").bind(command.ownerId, command.idempotencyKey, JSON.stringify(answer), now, command.ownerId, command.batchId, command.questionId),
    ];
    if (candidate.pairedQuestionId !== undefined) {
      if (candidate.dueAt === null) return fail("ProgressDataInvalid");
      // The knowledge schedule owns the round; quiz rows retain successes only in that round.
      const accepted = "EXISTS (SELECT 1 FROM learner_review_answers WHERE owner_id = ? AND batch_id = ? AND question_id = ?)";
      const answerScope = [command.ownerId, command.batchId, command.questionId];
      statements.splice(1, 1);
      for (const sibling of siblings) {
        statements.push(database.prepare(`INSERT INTO learner_question_state (owner_id, question_id, knowledge_id, last_answer_correct, scheduled_days, due_at)
          SELECT ?, ?, ?, NULL, ?, ? WHERE ${accepted}
          ON CONFLICT(owner_id, question_id) DO UPDATE SET last_answer_correct = NULL, scheduled_days = excluded.scheduled_days, due_at = excluded.due_at
          WHERE learner_question_state.scheduled_days != excluded.scheduled_days OR learner_question_state.due_at != excluded.due_at`).bind(command.ownerId, sibling.questionId, candidate.knowledgeId, candidate.scheduledDays, candidate.dueAt, ...answerScope));
      }
      statements.push(database.prepare(`UPDATE learner_question_state SET last_answer_correct = ? WHERE owner_id = ? AND question_id = ? AND ${accepted}`).bind(correct ? 1 : 0, command.ownerId, command.questionId, ...answerScope));
      const mastered = "(SELECT COUNT(*) FROM learner_question_state WHERE owner_id = learner_knowledge_state.owner_id AND question_id IN (?, ?) AND last_answer_correct = 1) = 2";
      const ids = siblings.map(item => item.questionId);
      if (ids.length !== 2) return fail("LearningPairInvalid");
      statements.push(database.prepare(`UPDATE learner_knowledge_state SET
        last_answer_correct = CASE WHEN ${mastered} THEN 1 ELSE 0 END,
        due_at = CASE WHEN ${mastered} THEN strftime('%Y-%m-%dT%H:%M:%fZ', julianday(?) + MIN(365, MAX(1, scheduled_days * 2))) ELSE due_at END,
        scheduled_days = CASE WHEN ${mastered} THEN MIN(365, MAX(1, scheduled_days * 2)) ELSE scheduled_days END,
        review_count = review_count + 1, updated_at = ?
        WHERE owner_id = ? AND knowledge_id = ? AND due_at = ? AND scheduled_days = ? AND ${accepted}`).bind(...ids, ...ids, now, ...ids, now, command.ownerId, candidate.knowledgeId, candidate.dueAt, candidate.scheduledDays, ...answerScope));
      statements.push(database.prepare(`UPDATE learner_question_state SET last_answer_correct = NULL,
        scheduled_days = (SELECT scheduled_days FROM learner_knowledge_state WHERE owner_id = ? AND knowledge_id = ?),
        due_at = (SELECT due_at FROM learner_knowledge_state WHERE owner_id = ? AND knowledge_id = ?)
        WHERE owner_id = ? AND question_id IN (?, ?) AND EXISTS (SELECT 1 FROM learner_knowledge_state WHERE owner_id = ? AND knowledge_id = ? AND due_at > ?) AND ${accepted}`).bind(command.ownerId, candidate.knowledgeId, command.ownerId, candidate.knowledgeId, command.ownerId, ...ids, command.ownerId, candidate.knowledgeId, now, ...answerScope));
      // Reject stale batches after promotion and duplicate successes across refreshed batches.
      statements[0] = database.prepare(`INSERT INTO learner_review_answers (owner_id, batch_id, question_id, selected_choice_ids_json, correct, score, answered_at, knowledge_id, elapsed_days, previous_correct)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM learner_review_batches WHERE owner_id = ? AND batch_id = ? AND status = 'open')
        AND EXISTS (SELECT 1 FROM learner_knowledge_state WHERE owner_id = ? AND knowledge_id = ? AND due_at = ? AND scheduled_days = ? AND due_at <= studied_at AND due_at <= ?)
        AND NOT EXISTS (SELECT 1 FROM learner_question_state WHERE owner_id = ? AND question_id = ? AND due_at = ? AND scheduled_days = ? AND last_answer_correct = 1)
        AND NOT EXISTS (SELECT 1 FROM learner_batch_commands WHERE owner_id = ? AND command_kind = 'review-skip' AND json_extract(result_json, '$.batchId') = ? AND json_extract(result_json, '$.questionId') = ?)`)
        .bind(command.ownerId, command.batchId, command.questionId, JSON.stringify(command.selectedChoiceIds), correct ? 1 : 0, score, now, candidate.knowledgeId, elapsedDays, candidate.lastAnswerCorrect === null ? null : candidate.lastAnswerCorrect ? 1 : 0, command.ownerId, command.batchId, command.ownerId, candidate.knowledgeId, candidate.dueAt, candidate.scheduledDays, now, command.ownerId, command.questionId, candidate.dueAt, candidate.scheduledDays, command.ownerId, command.batchId, command.questionId);
    }
    const written = await database.batch(statements);
    if (written.length !== statements.length || written.some((entry) => !entry.success)) return fail("LearningBatchPersistenceFailed");
    if (!changed(written[0])) return fail("ReviewAnswerNotAllowed");
    const completed = await completeReview(command.ownerId, batch, now);
    const scheduled = candidate.pairedQuestionId === undefined ? null : await database.prepare("SELECT due_at FROM learner_knowledge_state WHERE owner_id = ? AND knowledge_id = ?").bind(command.ownerId, candidate.knowledgeId).first();
    if (candidate.pairedQuestionId !== undefined && (!record(scheduled) || !iso(scheduled.due_at))) return fail("ProgressDataInvalid");
    const result = Object.freeze({ ...answer, nextDueAt: record(scheduled) ? scheduled.due_at : answer.nextDueAt, completed });
    const savedReplay = await database.prepare("UPDATE learner_batch_commands SET result_json = ? WHERE owner_id = ? AND idempotency_key = ?").bind(JSON.stringify(result), command.ownerId, command.idempotencyKey).run();
    if (!changed(savedReplay)) return fail("LearningBatchPersistenceFailed");
    dependencies.logger({ event: "learning-review-answer-success", ownerId: command.ownerId, batchId: command.batchId });
    return { ok: true, value: result };
    } catch (error) { return fail("LearningBatchPersistenceFailed"); }
  }

  /** @param {unknown} command @returns {Promise<Result<unknown>>} */
  async function setPreference(command) {
    if (!record(command) || !text(command.ownerId) || !text(command.knowledgeId) || (command.choice !== "more" && command.choice !== "less") || !text(command.idempotencyKey)) return { ok: false, error: { kind: "LearningPreferenceInvalid" } };
    const preference = command.choice === "more" ? 1 : -1;
    const { ownerId, knowledgeId } = command;
    const now = dependencies.now();
    if (!iso(now)) return {ok:false,error:{kind:'LearningBatchClockInvalid'}};
    const replay = await commandResult(command.ownerId, command.idempotencyKey);
    if (!replay.ok) return replay;
    if (replay.value !== null) return replay.value;
    const value = Object.freeze({knowledgeId:command.knowledgeId,preference});
    // Derive adjacent intervals from the established one-day/doubling scheduler,
    // including its 365-day endpoint. Keep elapsed cooldown time and recall evidence.
    const nextInterval = command.choice === 'more'
      ? 'CASE WHEN scheduled_days = 0 THEN 0 ELSE COALESCE((SELECT MAX(days) FROM intervals WHERE days < scheduled_days), 1) END'
      : 'COALESCE((SELECT MIN(days) FROM intervals WHERE days > scheduled_days), 365)';
    try {
      const owned = await database.prepare('SELECT source_id FROM extraction_knowledge_points WHERE owner_id = ? AND knowledge_id = ? LIMIT 1').bind(command.ownerId,command.knowledgeId).first();
      if (!record(owned) || !text(owned.source_id)) return {ok:false,error:{kind:'KnowledgePairNotFound'}};
      const result = await database.batch([
        database.prepare("INSERT INTO learner_batch_commands (owner_id, idempotency_key, command_kind, result_json, created_at) VALUES (?, ?, 'preference', ?, ?)").bind(command.ownerId,command.idempotencyKey,JSON.stringify(value),now),
        database.prepare("INSERT INTO learner_preference_feedback (owner_id, knowledge_id, preference, choice, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(owner_id, knowledge_id) DO UPDATE SET preference = excluded.preference, choice = excluded.choice, created_at = excluded.created_at").bind(command.ownerId, command.knowledgeId, preference, command.choice, now),
        database.prepare("INSERT INTO learner_knowledge_state (owner_id, knowledge_id, source_id, view_count, last_answer_correct, scheduled_days, due_at, studied_at, review_count, preference, updated_at) VALUES (?, ?, ?, 0, NULL, 0, NULL, NULL, 0, ?, ?) ON CONFLICT(owner_id, knowledge_id) DO UPDATE SET preference = excluded.preference, updated_at = excluded.updated_at").bind(command.ownerId,command.knowledgeId,owned.source_id,preference,now),
        ...["learner_knowledge_state", "learner_question_state"].map(table => database.prepare(`WITH RECURSIVE intervals(days) AS (VALUES(1) UNION ALL SELECT MIN(365, days * 2) FROM intervals WHERE days < 365)
          UPDATE ${table} SET
            due_at = CASE WHEN ${nextInterval} = scheduled_days THEN due_at ELSE strftime('%Y-%m-%dT%H:%M:%fZ', MAX(julianday(?), julianday(due_at)) + (${nextInterval} - scheduled_days)) END,
            scheduled_days = ${nextInterval}
          WHERE owner_id = ? AND knowledge_id = ? ${table === "learner_knowledge_state" ? "AND studied_at IS NOT NULL" : ""} AND due_at IS NOT NULL`).bind(now,ownerId,knowledgeId)),
      ]);
      return result.every(entry=>entry.success) ? {ok:true,value} : {ok:false,error:{kind:'LearningPreferencePersistenceFailed'}};
    } catch (error) {
      // A concurrent retry can lose the unique-key race; the atomic batch rolls back.
      const saved = await commandResult(command.ownerId,command.idempotencyKey);
      if (saved.ok && saved.value !== null) return saved.value;
      dependencies.logger({event:'learning-preference-failure',ownerId:command.ownerId,knowledgeId:command.knowledgeId,failureKind:'LearningPreferencePersistenceFailed'});
      return {ok:false,error:{kind:'LearningPreferencePersistenceFailed'}};
    }
  }

  /** @param {unknown} command @returns {Promise<Result<unknown>>} */
  async function removeKnowledge(command) {
    if (!record(command) || !text(command.ownerId) || !text(command.knowledgeId) || !text(command.idempotencyKey)) return { ok: false, error: { kind: "KnowledgePurgeFailed" } };
    if (command.target !== undefined && command.target !== "image" && command.target !== "knowledge") return { ok: false, error: { kind: "LearningBatchCommandInvalid" } };
    if (command.target === "image") {
      try {
        const owned = await database.prepare("SELECT source_id FROM extraction_knowledge_points WHERE owner_id = ? AND knowledge_id = ? LIMIT 1").bind(command.ownerId, command.knowledgeId).first();
        if (!record(owned) || !text(owned.source_id)) return { ok: false, error: { kind: "KnowledgePairNotFound" } };
        const result = await database.prepare("UPDATE knowledge_workflow_media_assets SET revoked_at = ? WHERE owner_id = ? AND knowledge_id = ? AND revoked_at IS NULL").bind(dependencies.now(), command.ownerId, command.knowledgeId).run();
        return result.success ? { ok: true, value: { knowledgeId: command.knowledgeId, imageRemoved: true } } : { ok: false, error: { kind: "KnowledgePurgeFailed" } };
      } catch {
        dependencies.logger({ event: "learning-knowledge-image-remove-failure", ownerId: command.ownerId, knowledgeId: command.knowledgeId, failureKind: "KnowledgePurgeFailed" });
        return { ok: false, error: { kind: "KnowledgePurgeFailed" } };
      }
    }
    const media = await database.prepare("SELECT private_original_key, private_object_key FROM knowledge_workflow_media_assets a LEFT JOIN knowledge_workflow_media_derivatives d ON d.owner_id = a.owner_id AND d.asset_id = a.asset_id WHERE a.owner_id = ? AND a.knowledge_id = ?").bind(command.ownerId, command.knowledgeId).all();
    if (!media.success) return { ok: false, error: { kind: "KnowledgePurgeFailed" } };
    if (dependencies.bucket !== null && dependencies.bucket !== undefined) {
      for (const rawRow of media.results) {
        if (!record(rawRow)) return { ok: false, error: { kind: "KnowledgePurgeFailed" } };
        for (const key of [rawRow.private_original_key, rawRow.private_object_key]) {
          if (key === null) continue;
          if (!text(key)) return { ok: false, error: { kind: "KnowledgePurgeFailed" } };
          try { await dependencies.bucket.delete(key); } catch (error) { dependencies.logger({ event: "learning-knowledge-media-delete-failure", ownerId: command.ownerId, knowledgeId: command.knowledgeId, failureKind: "KnowledgePurgeFailed" }); return { ok: false, error: { kind: "KnowledgePurgeFailed" } }; }
        }
      }
    }
    const statements = [
      database.prepare("DELETE FROM learner_question_state WHERE owner_id = ? AND knowledge_id = ?").bind(command.ownerId, command.knowledgeId),
      database.prepare("DELETE FROM learner_knowledge_state WHERE owner_id = ? AND knowledge_id = ?").bind(command.ownerId, command.knowledgeId),
      database.prepare("DELETE FROM learner_preference_feedback WHERE owner_id = ? AND knowledge_id = ?").bind(command.ownerId, command.knowledgeId),
      database.prepare("DELETE FROM knowledge_workflow_media_derivatives WHERE owner_id = ? AND asset_id IN (SELECT asset_id FROM knowledge_workflow_media_assets WHERE owner_id = ? AND knowledge_id = ?)").bind(command.ownerId, command.ownerId, command.knowledgeId),
      database.prepare("DELETE FROM knowledge_workflow_media_assets WHERE owner_id = ? AND knowledge_id = ?").bind(command.ownerId, command.knowledgeId),
      database.prepare("DELETE FROM learning_generation_tasks WHERE owner_id = ? AND item_id = ?").bind(command.ownerId, command.knowledgeId),
      database.prepare("DELETE FROM learning_generation_units WHERE owner_id = ? AND item_id = ?").bind(command.ownerId, command.knowledgeId),
      database.prepare("DELETE FROM learning_generation_jobs WHERE owner_id = ? AND item_id = ?").bind(command.ownerId, command.knowledgeId),
      database.prepare("DELETE FROM knowledge_workflow_quizzes WHERE owner_id = ? AND knowledge_id = ?").bind(command.ownerId, command.knowledgeId),
      database.prepare("DELETE FROM knowledge_workflow_quiz_attempts WHERE owner_id = ? AND knowledge_id = ?").bind(command.ownerId, command.knowledgeId),
      database.prepare("DELETE FROM knowledge_workflow_restrictions WHERE owner_id = ? AND knowledge_id = ?").bind(command.ownerId, command.knowledgeId),
      database.prepare("DELETE FROM extraction_knowledge_points WHERE owner_id = ? AND knowledge_id = ?").bind(command.ownerId, command.knowledgeId),
    ];
    const written = await database.batch(statements);
    return written.length === statements.length && written.every((entry) => entry.success) ? { ok: true, value: Object.freeze({ knowledgeId: command.knowledgeId, removed: true }) } : { ok: false, error: { kind: "KnowledgePurgeFailed" } };
  }

  /** @param {unknown} command @returns {Promise<Result<unknown>>} */
  async function removeSource(command) {
    if (!record(command) || !text(command.ownerId) || !text(command.sourceId) || !text(command.idempotencyKey)) return { ok: false, error: { kind: "KnowledgePurgeFailed" } };
    const descendantQueries = [
      "SELECT kp.knowledge_id FROM extraction_knowledge_points kp WHERE kp.owner_id = ? AND kp.source_id = ? LIMIT ?",
      "SELECT q.knowledge_id FROM knowledge_workflow_quizzes q WHERE q.owner_id = ? AND q.source_id = ? LIMIT ?",
      "SELECT j.item_id AS knowledge_id FROM learning_generation_jobs j WHERE j.owner_id = ? AND j.source_id = ? LIMIT ?",
      "SELECT a.knowledge_id FROM knowledge_workflow_media_assets a JOIN learning_generation_jobs j ON j.owner_id = a.owner_id AND j.generation_id = a.run_id WHERE a.owner_id = ? AND j.source_id = ? LIMIT ?",
      "SELECT ls.knowledge_id FROM learner_knowledge_state ls WHERE ls.owner_id = ? AND ls.source_id = ? LIMIT ?",
    ];
    const knowledgeIds = new Set();
    for (const query of descendantQueries) {
      const rows = await database.prepare(query).bind(command.ownerId, command.sourceId, MAX_CANDIDATES).all();
      if (!rows.success || !Array.isArray(rows.results)) return { ok: false, error: { kind: "KnowledgePurgeFailed" } };
      for (const rawRow of rows.results) {
        if (!record(rawRow) || !text(rawRow.knowledge_id)) return { ok: false, error: { kind: "KnowledgePurgeFailed" } };
        knowledgeIds.add(rawRow.knowledge_id);
        if (knowledgeIds.size > MAX_CANDIDATES) return { ok: false, error: { kind: "KnowledgePurgeFailed" } };
      }
    }
    for (const knowledgeId of knowledgeIds) {
      const result = await removeKnowledge({ ownerId: command.ownerId, knowledgeId, idempotencyKey: `${command.idempotencyKey}:${knowledgeId}` });
      if (!result.ok) return result;
    }
    dependencies.logger({ event: "learning-source-content-removed", ownerId: command.ownerId, itemCount: knowledgeIds.size });
    return { ok: true, value: Object.freeze({ sourceId: command.sourceId, removedKnowledgeCount: knowledgeIds.size }) };
  }

  /** @param {string} ownerId @returns {Promise<Result<null>>} */
  async function clearGeneratedContent(ownerId) {
    if (!text(ownerId)) return { ok: false, error: { kind: "KnowledgePurgeFailed" } };
    const media = await database.prepare("SELECT private_original_key, asset_id FROM knowledge_workflow_media_assets WHERE owner_id = ?").bind(ownerId).all();
    if (!media.success || !Array.isArray(media.results)) return { ok: false, error: { kind: "KnowledgePurgeFailed" } };
    if (media.results.length > 0 && (dependencies.bucket === null || dependencies.bucket === undefined)) return { ok: false, error: { kind: "KnowledgePurgeFailed" } };
    if (dependencies.bucket !== null && dependencies.bucket !== undefined) {
      const derivatives = await database.prepare("SELECT private_object_key FROM knowledge_workflow_media_derivatives WHERE owner_id = ?").bind(ownerId).all();
      if (!derivatives.success || !Array.isArray(derivatives.results)) return { ok: false, error: { kind: "KnowledgePurgeFailed" } };
      for (const rawRow of [...media.results, ...derivatives.results]) {
        if (!record(rawRow)) return { ok: false, error: { kind: "KnowledgePurgeFailed" } };
        const key = text(rawRow.private_original_key) ? rawRow.private_original_key : rawRow.private_object_key;
        if (!text(key)) return { ok: false, error: { kind: "KnowledgePurgeFailed" } };
        try { await dependencies.bucket.delete(key); } catch (error) { return { ok: false, error: { kind: "KnowledgePurgeFailed" } }; }
      }
    }
    const result = await database.batch([
      database.prepare("DELETE FROM learner_review_answers WHERE owner_id = ?").bind(ownerId),
      database.prepare("DELETE FROM learner_review_batches WHERE owner_id = ?").bind(ownerId),
      database.prepare("DELETE FROM learner_feed_batches WHERE owner_id = ?").bind(ownerId),
      database.prepare("DELETE FROM learner_question_state WHERE owner_id = ?").bind(ownerId),
      database.prepare("DELETE FROM learner_knowledge_state WHERE owner_id = ?").bind(ownerId),
      database.prepare("DELETE FROM learner_batch_commands WHERE owner_id = ?").bind(ownerId),
      database.prepare("DELETE FROM knowledge_workflow_media_derivatives WHERE owner_id = ?").bind(ownerId),
      database.prepare("DELETE FROM knowledge_workflow_media_assets WHERE owner_id = ?").bind(ownerId),
      database.prepare("DELETE FROM knowledge_workflow_quiz_attempts WHERE owner_id = ?").bind(ownerId),
      database.prepare("DELETE FROM knowledge_workflow_restrictions WHERE owner_id = ?").bind(ownerId),
      database.prepare("DELETE FROM knowledge_workflow_quizzes WHERE owner_id = ?").bind(ownerId),
      database.prepare("DELETE FROM extraction_scratchpads WHERE owner_id = ?").bind(ownerId),
      database.prepare("DELETE FROM extraction_knowledge_points WHERE owner_id = ?").bind(ownerId),
      database.prepare("DELETE FROM learning_generation_tasks WHERE owner_id = ?").bind(ownerId),
      database.prepare("DELETE FROM learning_generation_units WHERE owner_id = ?").bind(ownerId),
      database.prepare("DELETE FROM learning_generation_jobs WHERE owner_id = ?").bind(ownerId),
    ]);
    const cleared = result.every((entry) => entry.success);
    dependencies.logger({ event: cleared ? "learning-generated-content-cleared" : "learning-generated-content-clear-failure", ownerId, failureKind: cleared ? undefined : "KnowledgePurgeFailed" });
    return cleared ? { ok: true, value: null } : { ok: false, error: { kind: "KnowledgePurgeFailed" } };
  }

  return Object.freeze({
    ...createLearningProgressService(dependencies),
    loadFeed,
    completeFeed,
    loadReview,
    listKnowledge,
    answerReview,
    skipReview,
    replaceReview,
    removeReview,
    setPreference,
    removeKnowledge,
    removeSource,
    clearGeneratedContent,
    listCandidates: candidates,
  });
}

export {};
