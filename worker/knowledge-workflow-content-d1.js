// @ts-check

import { normalizeQuizDraftLimits, QUIZ_MAX_ATTEMPTS } from "../src/features/knowledge-workflows/quiz.js";
import { quoteHash } from "./webpage-citations.js";
import { parseClassification } from "../src/features/knowledge-subjects/public.js";
import { QUIZ_ACCEPTANCE_SCORE, validateAssembledQuizPair } from "../src/features/knowledge-workflows/quiz-pair.js";

/** @import { ExtractionScratchpad, KnowledgePoint } from "../src/features/knowledge-workflows/extraction.js" */
/** @import { QuizAttempt, QuizRepository, QuestionDraft } from "../src/features/knowledge-workflows/quiz.js" */
/** @import { LearningGenerationRecord, LearningTask, LearningUnit } from "../src/features/learning-generation/contracts.js" */

/** @typedef {{ readonly success: boolean, readonly meta?: { readonly changes?: number } }} D1Result */
/** @typedef {{ readonly bind: (...values: readonly (string | number | null)[]) => D1Statement, readonly first: () => Promise<unknown | null>, readonly all: () => Promise<{ readonly success: boolean, readonly results: readonly unknown[] }>, readonly run: () => Promise<D1Result> }} D1Statement */
/** @typedef {{ readonly prepare: (query: string) => D1Statement, readonly batch: (statements: readonly D1Statement[]) => Promise<readonly D1Result[]> }} D1DatabasePort */
/** @typedef {{ readonly delete: (key: string) => Promise<unknown> }} MediaBucket */
/** @typedef {{ readonly event: string, readonly ownerId?: string, readonly runId?: string, readonly knowledgeId?: string, readonly failureKind?: string }} ContentD1Log */
/** @typedef {{ readonly ok: true, readonly value: null } | { readonly ok: false, readonly error: { readonly kind: string } }} ContentResult */

/** @param {unknown} value @returns {value is string} */
function text(value) { return typeof value === "string" && value.trim() !== ""; }
/** @param {unknown} value @returns {value is number} */
function positiveInteger(value) { return typeof value === "number" && Number.isSafeInteger(value) && value > 0; }
/** @param {D1Result} result */
function changed(result) { return result.success === true && result.meta?.changes === 1; }

export class D1KnowledgeContentRepository {
  /** @type {D1DatabasePort} */ #database;
  /** @type {(entry: ContentD1Log) => void} */ #logger;

  /** @param {{ readonly database: D1DatabasePort, readonly logger: (entry: ContentD1Log) => void }} dependencies */
  constructor(dependencies) {
    if (typeof dependencies?.database?.prepare !== "function" || typeof dependencies.database.batch !== "function" || typeof dependencies.logger !== "function") throw new TypeError("D1 knowledge-content dependencies are invalid.");
    this.#database = dependencies.database;
    this.#logger = dependencies.logger;
  }

  /** @param {{ readonly ownerId: string, readonly runId: string, readonly sourceId: string, readonly sourceRevision: number }} scope @returns {Promise<{ readonly ok: true, readonly value: ExtractionScratchpad } | { readonly ok: false, readonly error: { readonly kind: "ScratchpadPersistenceFailed" } }>} */
  async loadScratchpad(scope) {
    if (!text(scope?.ownerId) || !text(scope.runId) || !text(scope.sourceId) || !positiveInteger(scope.sourceRevision)) return { ok: false, error: { kind: "ScratchpadPersistenceFailed" } };
    try {
      const row = await this.#database.prepare("SELECT scratchpad_json FROM extraction_scratchpads WHERE owner_id = ? AND run_id = ? LIMIT 1").bind(scope.ownerId, scope.runId).first();
      if (row === null) return { ok: true, value: Object.freeze({ ownerId: scope.ownerId, runId: scope.runId, sourceId: scope.sourceId, sourceRevision: scope.sourceRevision, processedUrls: Object.freeze([]), frontier: Object.freeze([]), discoveredUrls: Object.freeze([]), acceptedHashes: Object.freeze([]), similarityEvidence: Object.freeze([]), coverage: Object.freeze([]), unresolvedGaps: Object.freeze([]), pageNotes: Object.freeze([]), consecutiveNoveltyZero: 0, revision: 1 }) };
      if (!isRecord(row) || !text(row.scratchpad_json)) return { ok: false, error: { kind: "ScratchpadPersistenceFailed" } };
      const parsed = JSON.parse(row.scratchpad_json);
      return isScratchpad(parsed, scope) ? { ok: true, value: parsed } : { ok: false, error: { kind: "ScratchpadPersistenceFailed" } };
    } catch (error) {
      this.#logger({ event: "knowledge-scratchpad-d1-failure", ownerId: scope.ownerId, runId: scope.runId, failureKind: "ScratchpadPersistenceFailed" });
      return { ok: false, error: { kind: "ScratchpadPersistenceFailed" } };
    }
  }

  /** @param {ExtractionScratchpad} scratchpad @param {string} updatedAt @returns {Promise<ContentResult>} */
  async saveScratchpad(scratchpad, updatedAt) {
    if (!isScratchpad(scratchpad) || !text(updatedAt)) return { ok: false, error: { kind: "ScratchpadPersistenceFailed" } };
    try {
      const result = await this.#database.prepare("INSERT INTO extraction_scratchpads (owner_id, run_id, source_id, source_revision, revision, scratchpad_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(owner_id, run_id) DO UPDATE SET source_id = excluded.source_id, source_revision = excluded.source_revision, revision = excluded.revision, scratchpad_json = excluded.scratchpad_json, updated_at = excluded.updated_at WHERE extraction_scratchpads.revision < excluded.revision").bind(scratchpad.ownerId, scratchpad.runId, scratchpad.sourceId, scratchpad.sourceRevision, scratchpad.revision, JSON.stringify(scratchpad), updatedAt).run();
      return changed(result) ? { ok: true, value: null } : { ok: false, error: { kind: "ScratchpadPersistenceFailed" } };
    } catch (error) {
      this.#logger({ event: "knowledge-scratchpad-d1-failure", ownerId: scratchpad.ownerId, runId: scratchpad.runId, failureKind: "ScratchpadPersistenceFailed" });
      return { ok: false, error: { kind: "ScratchpadPersistenceFailed" } };
    }
  }

  /** @param {KnowledgePoint} point @param {string} ownerId @param {string} runId @param {string} createdAt @returns {Promise<ContentResult>} */
  async appendKnowledgePoint(point, ownerId, runId, createdAt) {
    if (!isKnowledgePoint(point) || !text(ownerId) || !text(runId) || !text(createdAt)) return { ok: false, error: { kind: "KnowledgePersistenceFailed" } };
    try {
      const result = await this.#database.prepare("INSERT INTO extraction_knowledge_points (owner_id, run_id, knowledge_id, source_id, source_revision, normalized_hash, point_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING").bind(ownerId, runId, point.id, point.sourceId, point.sourceRevision, point.normalizedHash, JSON.stringify(point), createdAt).run();
      if (result.success && Number.isSafeInteger(result.meta?.changes) && /** @type {number} */ (result.meta?.changes) > 0) return { ok: true, value: null };
      if (!result.success || result.meta?.changes !== 0) return { ok: false, error: { kind: "KnowledgePersistenceFailed" } };
      const existing = await this.#database.prepare("SELECT point_json FROM extraction_knowledge_points WHERE owner_id = ? AND run_id = ? AND knowledge_id = ? LIMIT 1").bind(ownerId, runId, point.id).first();
      const parsed = isRecord(existing) && text(existing.point_json) ? JSON.parse(existing.point_json) : null;
      if (!isKnowledgePoint(parsed) || Object.entries(point).some(([key, value]) => JSON.stringify(parsed[key]) !== JSON.stringify(value))) {
        this.#logger({ event: "knowledge-point-d1-failure", runId, knowledgeId: point.id, failureKind: "KnowledgePersistenceConflict" });
        return { ok: false, error: { kind: "KnowledgePersistenceConflict" } };
      }
      this.#logger({ event: "knowledge-point-d1-replay", runId, knowledgeId: point.id });
      return { ok: true, value: null };
    } catch (error) {
      this.#logger({ event: "knowledge-point-d1-failure", runId, knowledgeId: point.id, failureKind: "KnowledgePersistenceFailed" });
      return { ok: false, error: { kind: "KnowledgePersistenceFailed" } };
    }
  }

  /** @param {{ readonly ownerId: string, readonly knowledgeId: string, readonly selection: { readonly assetId: string, readonly kind: string, readonly url: string, readonly attribution: string } }} command @returns {Promise<ContentResult>} */
  async attachMediaSelection(command) {
    if (!text(command?.ownerId) || !text(command.knowledgeId) || !isRecord(command.selection) || !text(command.selection.assetId) || !text(command.selection.kind) || !text(command.selection.url) || !text(command.selection.attribution)) return { ok: false, error: { kind: "MediaSelectionPersistenceFailed" } };
    try {
      const row = await this.#database.prepare("SELECT point_json FROM extraction_knowledge_points WHERE owner_id = ? AND knowledge_id = ? LIMIT 1").bind(command.ownerId, command.knowledgeId).first();
      if (!isRecord(row) || !text(row.point_json)) return { ok: false, error: { kind: "MediaSelectionPersistenceFailed" } };
      const point = JSON.parse(row.point_json);
      if (!isKnowledgePoint(point)) return { ok: false, error: { kind: "MediaSelectionPersistenceFailed" } };
      const updated = Object.freeze({ ...point, mediaSelection: Object.freeze({ assetId: command.selection.assetId, kind: command.selection.kind, url: command.selection.url, attribution: command.selection.attribution }) });
      const result = await this.#database.prepare("UPDATE extraction_knowledge_points SET point_json = ? WHERE owner_id = ? AND knowledge_id = ?").bind(JSON.stringify(updated), command.ownerId, command.knowledgeId).run();
      if (!changed(result)) return { ok: false, error: { kind: "MediaSelectionPersistenceFailed" } };
      this.#logger({ event: "knowledge-media-selection-attached", ownerId: command.ownerId, knowledgeId: command.knowledgeId });
      return { ok: true, value: null };
    } catch (error) {
      this.#logger({ event: "knowledge-media-selection-failure", ownerId: command.ownerId, knowledgeId: command.knowledgeId, failureKind: "MediaSelectionPersistenceFailed" });
      return { ok: false, error: { kind: "MediaSelectionPersistenceFailed" } };
    }
  }

  /** @param {{ownerId:string,runId:string,knowledgeId:string,sourceRevision:number,imageId:string,score:number,model:string,caption:string}} command @returns {Promise<ContentResult>} */
  async attachCapturedImage(command) {
    if(!text(command?.ownerId)||!text(command.runId)||!text(command.knowledgeId)||!positiveInteger(command.sourceRevision)||!text(command.imageId)||!text(command.model)||!text(command.caption)||!Number.isFinite(command.score)||command.score<0.8||command.score>1)return {ok:false,error:{kind:'MediaSelectionPersistenceFailed'}};
    try{
      const patch={mediaCandidates:[{visualId:command.imageId}],imageAssociation:{score:command.score,model:command.model,imageId:command.imageId,caption:command.caption}};
      const result=await this.#database.prepare("UPDATE extraction_knowledge_points SET point_json=json_patch(point_json,json(?)) WHERE owner_id=? AND run_id=? AND knowledge_id=? AND source_revision=?").bind(JSON.stringify(patch),command.ownerId,command.runId,command.knowledgeId,command.sourceRevision).run();
      return result.success&&(result.meta?.changes??0)>0?{ok:true,value:null}:{ok:false,error:{kind:'MediaSelectionPersistenceFailed'}};
    }catch(error){this.#logger({event:'knowledge-media-selection-failure',ownerId:command.ownerId,runId:command.runId,failureKind:'MediaSelectionPersistenceFailed'});if(!(error instanceof Error))throw error;return {ok:false,error:{kind:'MediaSelectionPersistenceFailed'}};}
  }

  /** @param {{ownerId:string,runId:string,knowledgeId:string,warnings:readonly string[],clearMedia?:boolean}} command @returns {Promise<ContentResult>} */
  async updateImageWarnings(command) {
    if(!text(command?.ownerId)||!text(command.runId)||!text(command.knowledgeId)||!Array.isArray(command.warnings)||!command.warnings.every(text)||(command.clearMedia!==undefined&&typeof command.clearMedia!=="boolean"))return {ok:false,error:{kind:"ImageWarningPersistenceFailed"}};
    try {
      const result=await this.#database.prepare("UPDATE extraction_knowledge_points SET point_json = json_patch(point_json, json(?)) WHERE owner_id = ? AND run_id = ? AND knowledge_id = ?").bind(JSON.stringify({imageWarnings:command.warnings,...(command.clearMedia?{mediaCandidates:[]}:{})}),command.ownerId,command.runId,command.knowledgeId).run();
      return result.success && (result.meta?.changes ?? 0)>0 ? {ok:true,value:null} : {ok:false,error:{kind:"ImageWarningPersistenceFailed"}};
    } catch(error) {if(!(error instanceof Error))throw error;this.#logger({event:"image-warning-persistence-failure",ownerId:command.ownerId,runId:command.runId,failureKind:"ImageWarningPersistenceFailed"});return {ok:false,error:{kind:"ImageWarningPersistenceFailed"}};}
  }

  /** @param {{ownerId:string,runId:string,pageUrl:string,warnings:readonly string[]}} command @returns {Promise<ContentResult>} */
  async savePageImageWarnings(command) {
    if (!text(command?.ownerId) || !text(command.runId) || !text(command.pageUrl) || !URL.canParse(command.pageUrl) || new URL(command.pageUrl).protocol !== "https:" || !Array.isArray(command.warnings) || command.warnings.length === 0 || !command.warnings.every(text)) return {ok:false,error:{kind:"ImageWarningPersistenceFailed"}};
    this.#logger({event:"image-page-warning-entry",ownerId:command.ownerId,runId:command.runId});
    try {
      const result=await this.#database.prepare("INSERT INTO knowledge_workflow_page_image_warnings (owner_id,run_id,page_url,warnings_json) SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM knowledge_workflow_runs WHERE owner_id = ? AND run_id = ? AND state <> 'abandoned') AND NOT EXISTS (SELECT 1 FROM knowledge_workflow_run_tombstones WHERE owner_id = ? AND run_id = ?) ON CONFLICT(owner_id,run_id,page_url) DO UPDATE SET warnings_json = (SELECT json_group_array(value) FROM (SELECT value FROM json_each(knowledge_workflow_page_image_warnings.warnings_json) UNION SELECT value FROM json_each(excluded.warnings_json)))").bind(command.ownerId,command.runId,command.pageUrl,JSON.stringify(command.warnings),command.ownerId,command.runId,command.ownerId,command.runId).run();
      if (!changed(result)) return {ok:false,error:{kind:"ImageWarningPersistenceFailed"}};
      this.#logger({event:"image-page-warning-success",ownerId:command.ownerId,runId:command.runId});
      return {ok:true,value:null};
    } catch(error) {
      this.#logger({event:"image-page-warning-failure",ownerId:command.ownerId,runId:command.runId,failureKind:"ImageWarningPersistenceFailed"});
      if (!(error instanceof Error)) throw error;
      return {ok:false,error:{kind:"ImageWarningPersistenceFailed"}};
    }
  }

  /** @param {{readonly ownerId:string,readonly runId:string}} scope @returns {Promise<import('../src/features/source-library/contracts.js').Result<readonly string[],{readonly kind:"ImageWarningReadFailed"}>>} */
  async loadImageWarnings(scope) {
    if (!text(scope?.ownerId) || !text(scope.runId)) return {ok:false,error:{kind:"ImageWarningReadFailed"}};
    try {
      const rows=await this.#database.prepare("SELECT json_extract(point_json, '$.imageWarnings') AS warnings_json FROM extraction_knowledge_points WHERE owner_id = ? AND run_id = ? UNION ALL SELECT warnings_json FROM knowledge_workflow_page_image_warnings WHERE owner_id = ? AND run_id = ?").bind(scope.ownerId,scope.runId,scope.ownerId,scope.runId).all();
      if (!rows.success) return {ok:false,error:{kind:"ImageWarningReadFailed"}};
      const warnings=new Set();
      for(const row of rows.results) {
        if(!isRecord(row) || !(row.warnings_json === null || text(row.warnings_json))) return {ok:false,error:{kind:"ImageWarningReadFailed"}};
        const values=row.warnings_json === null ? [] : JSON.parse(/** @type {string} */(row.warnings_json));
        if(!Array.isArray(values)||!values.every(text))return {ok:false,error:{kind:"ImageWarningReadFailed"}};
        for(const warning of values)warnings.add(warning);
      }
      return {ok:true,value:[...warnings]};
    } catch(error) {
      this.#logger({event:"knowledge-image-warning-read-failure",ownerId:scope.ownerId,runId:scope.runId,failureKind:"ImageWarningReadFailed"});
      if(!(error instanceof Error))throw error;
      return {ok:false,error:{kind:"ImageWarningReadFailed"}};
    }
  }

  /** Current owner preferences without loading quiz history or unrelated knowledge.
   * @param {{ownerId:string,runId:string,sourceId:string,knowledgeId:string}} scope
   * @returns {Promise<{ok:true,value:{lessOften:{id:string,summary:string}[]}}|{ok:false,error:{kind:string}}>} */
  async preferenceContext(scope) {
    try {
      const rows=await this.#database.prepare("SELECT p.knowledge_id,p.point_json FROM extraction_knowledge_points p JOIN learner_preference_feedback f ON f.owner_id=p.owner_id AND f.knowledge_id=p.knowledge_id AND f.choice='less' WHERE p.owner_id=? AND (p.knowledge_id=? OR p.source_id=? OR EXISTS (SELECT 1 FROM source_classifications selected JOIN source_classifications wanted ON wanted.owner_id=selected.owner_id AND wanted.main_subject=selected.main_subject WHERE selected.owner_id=p.owner_id AND selected.source_id=p.source_id AND wanted.source_id=? AND selected.status='classified' AND wanted.status='classified') OR NOT EXISTS (SELECT 1 FROM source_classifications wanted WHERE wanted.owner_id=p.owner_id AND wanted.source_id=? AND wanted.status='classified')) ORDER BY p.created_at,p.knowledge_id").bind(scope.ownerId,scope.knowledgeId,scope.sourceId,scope.sourceId,scope.sourceId).all();
      if(!rows.success)return {ok:false,error:{kind:'KnowledgeReviewContextFailed'}};
      const lessOften=[];
      for(const row of rows.results) {
        if(!isRecord(row)||!text(row.point_json)||!text(row.knowledge_id))return {ok:false,error:{kind:'KnowledgeReviewContextFailed'}};
        const point=JSON.parse(row.point_json);
        if(!isKnowledgePoint(point))return {ok:false,error:{kind:'KnowledgeReviewContextFailed'}};
        lessOften.push({id:row.knowledge_id,summary:point.summary});
      }
      return {ok:true,value:{lessOften}};
    }catch(error){this.#logger({event:'knowledge-preference-context-failure',ownerId:scope.ownerId,runId:scope.runId,failureKind:'KnowledgeReviewContextFailed'});return {ok:false,error:{kind:'KnowledgeReviewContextFailed'}};}
  }

  /** @param {{ownerId:string,runId:string,sourceId:string,knowledgeId:string}} scope @returns {Promise<{ok:true,value:import('../src/features/knowledge-workflows/quality-review.js').ReviewContext}|{ok:false,error:{kind:string}}>} */
  async reviewContext(scope) {
    try {
      // Classification follows extraction: retain owner preferences for semantic review until a subject is known.
      const points=await this.#database.prepare("SELECT p.knowledge_id,p.source_id,p.point_json,f.choice FROM extraction_knowledge_points p LEFT JOIN learner_preference_feedback f ON f.owner_id=p.owner_id AND f.knowledge_id=p.knowledge_id WHERE p.owner_id=? AND (p.knowledge_id<>? OR p.run_id<>?) AND (p.source_id=? OR f.choice='less' AND EXISTS (SELECT 1 FROM source_classifications selected JOIN source_classifications wanted ON wanted.owner_id=selected.owner_id AND wanted.main_subject=selected.main_subject WHERE selected.owner_id=p.owner_id AND selected.source_id=p.source_id AND wanted.source_id=? AND selected.status='classified' AND wanted.status='classified') OR f.choice='less' AND NOT EXISTS (SELECT 1 FROM source_classifications wanted WHERE wanted.owner_id=p.owner_id AND wanted.source_id=? AND wanted.status='classified')) ORDER BY p.created_at,p.knowledge_id").bind(scope.ownerId,scope.knowledgeId,scope.runId,scope.sourceId,scope.sourceId,scope.sourceId).all();
      const quizzes=await this.#database.prepare('SELECT draft_json FROM knowledge_workflow_quizzes WHERE owner_id=? AND source_id=? AND (knowledge_id<>? OR run_id<>?) ORDER BY created_at,quiz_id').bind(scope.ownerId,scope.sourceId,scope.knowledgeId,scope.runId).all();
      if(!points.success||!quizzes.success)return {ok:false,error:{kind:'KnowledgeReviewContextFailed'}};
      const previousKnowledge=[],lessOften=[],previousQuizzes=[];
      for(const row of points.results) {
        if(!isRecord(row)||!text(row.point_json)||!text(row.knowledge_id))return {ok:false,error:{kind:'KnowledgeReviewContextFailed'}};
        const point=JSON.parse(row.point_json);
        if(!isKnowledgePoint(point))return {ok:false,error:{kind:'KnowledgeReviewContextFailed'}};
        const summary={id:row.knowledge_id,summary:point.summary};
        if(row.source_id===scope.sourceId)previousKnowledge.push(summary);
        if(row.choice==='less')lessOften.push(summary);
      }
      const ownPreference=await this.#database.prepare("SELECT choice FROM learner_preference_feedback WHERE owner_id=? AND knowledge_id=?").bind(scope.ownerId,scope.knowledgeId).first();
      if(isRecord(ownPreference)&&ownPreference.choice==='less') {
        const ownPoint=await this.#database.prepare('SELECT point_json FROM extraction_knowledge_points WHERE owner_id=? AND knowledge_id=?').bind(scope.ownerId,scope.knowledgeId).first();
        const parsed=isRecord(ownPoint)&&text(ownPoint.point_json)?JSON.parse(ownPoint.point_json):null;
        if(isKnowledgePoint(parsed))lessOften.push({id:scope.knowledgeId,summary:parsed.summary});
      }
      for(const row of quizzes.results) {
        if(!isRecord(row)||!text(row.draft_json))return {ok:false,error:{kind:'KnowledgeReviewContextFailed'}};
        const draft=JSON.parse(row.draft_json);
        if(!isDraft(draft))return {ok:false,error:{kind:'KnowledgeReviewContextFailed'}};
        const pair=draft.pairedQuiz;
        if(pair===undefined)previousQuizzes.push({prompt:draft.prompt,answer:draft.answer,...(draft.options.length===0?{}:{options:draft.options}),...(draft.blanks===undefined?{}:{blanks:draft.blanks}),...(draft.explanation===undefined?{}:{explanation:draft.explanation})});
        else {
          const correctAnswers=pair.multipleChoice.correctOptionKeys.map(key=>pair.multipleChoice.options.find(option=>option.key===key)?.text);
          const pairedAnswer=pair.multipleChoice.kind==='single-choice'?correctAnswers[0]:correctAnswers;
          previousQuizzes.push({pairedQuiz:{
            multipleChoice:{kind:pair.multipleChoice.kind,prompt:pair.multipleChoice.prompt,options:pair.multipleChoice.options,correctOptionKeys:pair.multipleChoice.correctOptionKeys,explanation:pair.multipleChoice.explanation},
            fillBlank:{kind:pair.fillBlank.kind,prompt:pair.fillBlank.prompt,blanks:pair.fillBlank.blanks,explanation:pair.fillBlank.explanation},
          },...(JSON.stringify(draft.answer)===JSON.stringify(pairedAnswer)?{}:{answer:draft.answer}),...(draft.explanation===undefined||draft.explanation===pair.multipleChoice.explanation?{}:{explanation:draft.explanation})});
        }
      }
      return {ok:true,value:{lessOften,previousKnowledge,previousQuizzes}};
    }catch(error){this.#logger({event:'knowledge-review-context-failure',ownerId:scope.ownerId,runId:scope.runId,failureKind:'KnowledgeReviewContextFailed'});return {ok:false,error:{kind:'KnowledgeReviewContextFailed'}};}
  }

  /** @param {{ownerId:string,runId:string,knowledgeId:string,sourceRevision:number,evidenceDigest:string,evidence:unknown}} command @returns {Promise<ContentResult>} */
  async saveReviewEvidence(command) {
    try {
      const result=await this.#database.prepare("INSERT INTO knowledge_workflow_review_evidence (owner_id,run_id,knowledge_id,source_revision,evidence_digest,evidence_json) SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM knowledge_workflow_runs WHERE owner_id=? AND run_id=? AND state <> 'abandoned') AND NOT EXISTS (SELECT 1 FROM knowledge_workflow_run_tombstones WHERE owner_id=? AND run_id=?) ON CONFLICT DO NOTHING").bind(command.ownerId,command.runId,command.knowledgeId,command.sourceRevision,command.evidenceDigest,JSON.stringify(command.evidence),command.ownerId,command.runId,command.ownerId,command.runId).run();
      if(!result.success)return {ok:false,error:{kind:'KnowledgeReviewEvidenceFailed'}};
      if(result.meta?.changes===1)return {ok:true,value:null};
      const row=await this.#database.prepare('SELECT evidence_digest FROM knowledge_workflow_review_evidence WHERE owner_id=? AND run_id=? AND knowledge_id=? AND source_revision=?').bind(command.ownerId,command.runId,command.knowledgeId,command.sourceRevision).first();
      return isRecord(row)&&row.evidence_digest===command.evidenceDigest?{ok:true,value:null}:{ok:false,error:{kind:'KnowledgeReviewEvidenceChanged'}};
    }catch(error){return {ok:false,error:{kind:'KnowledgeReviewEvidenceFailed'}};}
  }

  /** @param {{ownerId:string,runId:string,knowledgeId:string,sourceRevision:number}} scope @returns {Promise<{ok:true,value:unknown}|{ok:false,error:{kind:string}}>} */
  async readReviewEvidence(scope) {
    try {
      const row=await this.#database.prepare('SELECT evidence_json,evidence_digest FROM knowledge_workflow_review_evidence WHERE owner_id=? AND run_id=? AND knowledge_id=? AND source_revision=?').bind(scope.ownerId,scope.runId,scope.knowledgeId,scope.sourceRevision).first();
      return isRecord(row)&&text(row.evidence_json)&&await quoteHash(row.evidence_json)===row.evidence_digest?{ok:true,value:JSON.parse(row.evidence_json)}:{ok:false,error:{kind:'KnowledgeReviewEvidenceUnavailable'}};
    }catch(error){return {ok:false,error:{kind:'KnowledgeReviewEvidenceFailed'}};}
  }

  /** @param {{ readonly ownerId: string, readonly runId: string, readonly sourceId: string, readonly sourceRevision: number }} scope @returns {Promise<{ readonly ok: true, readonly value: readonly KnowledgePoint[] } | { readonly ok: false, readonly error: { readonly kind: "KnowledgePersistenceFailed" } }>} */
  async listKnowledgePoints(scope) {
    if (!text(scope?.ownerId) || !text(scope.runId) || !text(scope.sourceId) || !positiveInteger(scope.sourceRevision)) return { ok: false, error: { kind: "KnowledgePersistenceFailed" } };
    try {
      const result = await this.#database.prepare("SELECT point_json FROM extraction_knowledge_points WHERE owner_id = ? AND run_id = ? AND source_id = ? AND source_revision = ? ORDER BY created_at ASC, knowledge_id ASC").bind(scope.ownerId, scope.runId, scope.sourceId, scope.sourceRevision).all();
      if (!Array.isArray(result.results)) return { ok: false, error: { kind: "KnowledgePersistenceFailed" } };
      const points = [];
      for (const row of result.results) {
        if (!isRecord(row) || !text(row.point_json)) return { ok: false, error: { kind: "KnowledgePersistenceFailed" } };
        const parsed = JSON.parse(row.point_json);
        if (!isKnowledgePoint(parsed) || parsed.sourceId !== scope.sourceId || parsed.sourceRevision !== scope.sourceRevision) return { ok: false, error: { kind: "KnowledgePersistenceFailed" } };
        points.push(parsed);
      }
      return { ok: true, value: Object.freeze(points) };
    } catch (error) {
      this.#logger({ event: "knowledge-point-d1-failure", ownerId: scope.ownerId, runId: scope.runId, failureKind: "KnowledgePersistenceFailed" });
      return { ok: false, error: { kind: "KnowledgePersistenceFailed" } };
    }
  }
}

export class D1QuizRepository {
  /** @type {D1DatabasePort} */ #database;
  /** @type {(entry: ContentD1Log) => void} */ #logger;
  /** @type {() => string} */ #now;
  /** @type {MediaBucket | null} */ #bucket;

  /** @param {{ readonly database: D1DatabasePort, readonly logger: (entry: ContentD1Log) => void, readonly now: () => string, readonly bucket?: MediaBucket | null }} dependencies */
  constructor(dependencies) {
    if (typeof dependencies?.database?.prepare !== "function" || typeof dependencies.database.batch !== "function" || typeof dependencies.logger !== "function" || typeof dependencies.now !== "function" || (dependencies.bucket !== undefined && dependencies.bucket !== null && typeof dependencies.bucket.delete !== "function")) throw new TypeError("D1 quiz dependencies are invalid.");
    this.#database = dependencies.database;
    this.#logger = dependencies.logger;
    this.#now = dependencies.now;
    this.#bucket = dependencies.bucket ?? null;
  }

  /** @param {{readonly ownerId:string,readonly runId:string,readonly knowledgeId:string}} scope @returns {Promise<import('../src/features/knowledge-workflows/quiz.js').Result<{status:'published'|'pending-review',attempt:number}|null,unknown>>} */
  async findPublished(scope) {
    if (!text(scope?.ownerId) || !text(scope.runId) || !text(scope.knowledgeId)) return {ok:false,error:{kind:"QuizPersistenceFailed"}};
    this.#logger({event:"quiz-publication-read-entry",ownerId:scope.ownerId,runId:scope.runId});
    try {
      const row=await this.#database.prepare("SELECT status,attempt_number FROM knowledge_workflow_quizzes WHERE owner_id=? AND run_id=? AND knowledge_id=? LIMIT 1").bind(scope.ownerId,scope.runId,scope.knowledgeId).first();
      if (row===null) { this.#logger({event:"quiz-publication-read-success",ownerId:scope.ownerId,runId:scope.runId}); return {ok:true,value:null}; }
      if (!isRecord(row) || (row.status!=="published" && row.status!=="pending-review") || !positiveInteger(row.attempt_number) || row.attempt_number>QUIZ_MAX_ATTEMPTS) {
        this.#logger({event:"quiz-publication-read-failure",failureKind:"QuizPersistenceFailed"});
        return {ok:false,error:{kind:"QuizPersistenceFailed"}};
      }
      this.#logger({event:"quiz-publication-read-success",ownerId:scope.ownerId,runId:scope.runId});
      return {ok:true,value:{status:row.status,attempt:row.attempt_number}};
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      this.#logger({event:"quiz-publication-read-failure",failureKind:"QuizPersistenceFailed"});
      return {ok:false,error:{kind:"QuizPersistenceFailed"}};
    }
  }

  /** @param {QuizAttempt} attempt @returns {Promise<ContentResult>} */
  async appendAttempt(attempt) {
    if (!isQuizAttempt(attempt)) return { ok: false, error: { kind: "QuizPersistenceFailed" } };
    this.#logger({event:"quiz-attempt-d1-entry",ownerId:attempt.ownerId,runId:attempt.runId});
    try {
      const values=[attempt.ownerId,attempt.id,attempt.runId,attempt.knowledgeId,attempt.attempt,attempt.draftId,attempt.score,attempt.feedback,attempt.failureKind,attempt.createdAt];
      const results=await this.#database.batch([
        this.#database.prepare("INSERT INTO knowledge_workflow_quiz_attempts (owner_id, attempt_id, run_id, knowledge_id, attempt_number, draft_id, score, feedback, failure_kind, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(owner_id,run_id,knowledge_id,attempt_number) DO NOTHING").bind(...values),
        this.#database.prepare("INSERT INTO knowledge_workflow_quiz_retry_attempts (owner_id, attempt_id, run_id, knowledge_id, attempt_number, draft_id, score, feedback, failure_kind, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(owner_id,attempt_id) DO NOTHING").bind(...values),
      ]);
      if (results.length!==2 || !results[0]?.success || !results[1]?.success) {
        this.#logger({event:"quiz-attempt-d1-failure",failureKind:"QuizPersistenceFailed"});
        return {ok:false,error:{kind:"QuizPersistenceFailed"}};
      }
      this.#logger({event:"quiz-attempt-d1-success",ownerId:attempt.ownerId,runId:attempt.runId});
      return {ok:true,value:null};
    } catch (error) {
      this.#logger({ event: "quiz-attempt-d1-failure", ownerId: attempt.ownerId, runId: attempt.runId, knowledgeId: attempt.knowledgeId, failureKind: "QuizPersistenceFailed" });
      return { ok: false, error: { kind: "QuizPersistenceFailed" } };
    }
  }

  /** @param {{ readonly ownerId: string, readonly sourceId: string, readonly sourceRevision: number, readonly knowledgeId: string, readonly draft: unknown }} command @returns {Promise<{ readonly ok: true, readonly value: boolean } | { readonly ok: false, readonly error: { readonly kind: "QuizDuplicateCheckFailed" } }>} */
  async hasDuplicateDraft(command) {
    const fingerprint = draftFingerprint(command?.draft);
    if (!text(command?.ownerId) || !text(command?.sourceId) || !positiveInteger(command.sourceRevision) || !text(command.knowledgeId) || fingerprint === null) return { ok: false, error: { kind: "QuizDuplicateCheckFailed" } };
    try {
      const result = await this.#database.prepare("SELECT 1 FROM knowledge_workflow_quizzes WHERE owner_id = ? AND source_id = ? AND source_revision = ? AND draft_fingerprint = ? AND knowledge_id <> ? LIMIT 1").bind(command.ownerId, command.sourceId, command.sourceRevision, fingerprint, command.knowledgeId).first();
      return { ok: true, value: result !== null };
    } catch (error) {
      this.#logger({ event: "quiz-duplicate-d1-failure", ownerId: command.ownerId, failureKind: "QuizDuplicateCheckFailed" });
      return { ok: false, error: { kind: "QuizDuplicateCheckFailed" } };
    }
  }

  /** @param {{ readonly ownerId: string, readonly runId: string, readonly knowledge: KnowledgePoint, readonly draft: QuestionDraft, readonly score: number, readonly attempt: number, readonly status: "published" | "pending-review" }} command @returns {Promise<ContentResult | { readonly ok: false, readonly error: { readonly kind: "QuizDuplicate" } }>} */
  async publish(command) {
    const limited = normalizeQuizDraftLimits(command?.draft);
    if (!isDraft(limited)) return { ok: false, error: { kind: "QuizPublicationFailed" } };
    command = { ...command, draft: limited };
    const fingerprint = draftFingerprint(command?.draft);
    if (!text(command?.ownerId) || !text(command.runId) || !isKnowledgePoint(command.knowledge) || !isDraft(command.draft) || fingerprint === null || !Number.isInteger(command.score) || command.score < QUIZ_ACCEPTANCE_SCORE || command.score > 10 || !positiveInteger(command.attempt) || (command.status !== "published" && command.status !== "pending-review")) return { ok: false, error: { kind: "QuizPublicationFailed" } };
    try {
      const createdAt = this.#now();
      if (!text(createdAt) || !Number.isFinite(Date.parse(createdAt))) return { ok: false, error: { kind: "QuizPublicationFailed" } };
      const projected = projectReviewQueue(command, createdAt);
      const statements = [
        this.#database.prepare("INSERT INTO knowledge_workflow_quizzes (owner_id, quiz_id, run_id, knowledge_id, source_id, source_revision, draft_fingerprint, draft_json, score, attempt_number, status, created_at) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM knowledge_workflow_quizzes WHERE owner_id = ? AND source_id = ? AND source_revision = ? AND draft_fingerprint = ? AND knowledge_id <> ?)").bind(command.ownerId, `quiz:${command.runId}:${command.knowledge.id}`, command.runId, command.knowledge.id, command.knowledge.sourceId, command.knowledge.sourceRevision, fingerprint, JSON.stringify(command.draft), command.score, command.attempt, command.status, createdAt, command.ownerId, command.knowledge.sourceId, command.knowledge.sourceRevision, fingerprint, command.knowledge.id),
        this.#database.prepare("INSERT INTO learning_generation_jobs (owner_id, generation_id, source_id, source_revision, item_id, item_version_id, content_digest, source_kind, rights_evidence_id, attribution_json, policy_version, status, local_only, provider_request_id, failure_kind, idempotency_key, command_fingerprint, record_json, created_at) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1").bind(projected.record.ownerId, projected.record.id, projected.record.sourceId, projected.record.sourceRevision, projected.record.itemId, projected.record.itemVersionId, projected.record.contentDigest, projected.record.sourceKind, projected.record.rightsEvidenceId, projected.record.attribution === null ? null : JSON.stringify(projected.record.attribution), projected.record.policyVersion, projected.record.status, projected.record.localOnly ? 1 : 0, projected.record.providerRequestId, projected.record.failureKind, projected.record.idempotencyKey, projected.fingerprint, JSON.stringify(projected.record), projected.record.createdAt),
        this.#database.prepare("INSERT INTO learning_generation_units (owner_id, generation_id, unit_id, source_revision, item_id, item_version_id, unit_json) SELECT ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1").bind(command.ownerId, projected.record.id, projected.unit.id, projected.unit.sourceRevision, projected.unit.itemId, projected.unit.itemVersionId, JSON.stringify(projected.unit)),
        this.#database.prepare("INSERT INTO learning_generation_tasks (owner_id, generation_id, task_id, source_revision, item_id, item_version_id, status, revision, task_json) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1").bind(projected.task.ownerId, projected.record.id, projected.task.id, projected.task.sourceRevision, projected.task.itemId, projected.task.itemVersionId, projected.task.status, projected.task.revision, JSON.stringify(projected.task)),
      ];
      const results = await this.#database.batch(statements);
      if (results.length > 0 && results[0]?.success === true && results[0]?.meta?.changes === 0) return { ok: false, error: { kind: "QuizDuplicate" } };
      return results.length === statements.length && results.every(changed) ? { ok: true, value: null } : { ok: false, error: { kind: "QuizPublicationFailed" } };
    } catch (error) {
      this.#logger({ event: "quiz-publish-d1-failure", ownerId: command.ownerId, runId: command.runId, knowledgeId: command.knowledge.id, failureKind: "QuizPublicationFailed" });
      return { ok: false, error: { kind: "QuizPublicationFailed" } };
    }
  }

  /** @param {{ readonly ownerId: string, readonly runId: string, readonly knowledgeId: string, readonly restrictedUntil: string, readonly reason: string }} command @returns {Promise<ContentResult>} */
  async restrict(command) {
    if (!text(command?.ownerId) || !text(command.runId) || !text(command.knowledgeId) || !text(command.restrictedUntil) || !text(command.reason)) return { ok: false, error: { kind: "QuizRestrictionPersistenceFailed" } };
    try {
      const createdAt = this.#now();
      if (!text(createdAt) || !Number.isFinite(Date.parse(createdAt))) return { ok: false, error: { kind: "QuizRestrictionPersistenceFailed" } };
      const result = await this.#database.prepare("INSERT INTO knowledge_workflow_restrictions (owner_id, restriction_id, run_id, knowledge_id, restricted_until, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(command.ownerId, `restriction:${command.runId}:${command.knowledgeId}`, command.runId, command.knowledgeId, command.restrictedUntil, command.reason, createdAt).run();
      return changed(result) ? { ok: true, value: null } : { ok: false, error: { kind: "QuizRestrictionPersistenceFailed" } };
    } catch (error) {
      this.#logger({ event: "quiz-restriction-d1-failure", ownerId: command.ownerId, runId: command.runId, knowledgeId: command.knowledgeId, failureKind: "QuizRestrictionPersistenceFailed" });
      return { ok: false, error: { kind: "QuizRestrictionPersistenceFailed" } };
    }
  }

  /** @param {{ readonly ownerId: string, readonly runId: string }} scope @returns {Promise<{ readonly ok: true, readonly value: readonly { readonly knowledgeId: string, readonly restrictedUntil: string }[] } | { readonly ok: false, readonly error: { readonly kind: "QuizRestrictionPersistenceFailed" } }>} */
  async listRestrictions(scope) {
    if (!text(scope?.ownerId) || !text(scope.runId)) return { ok: false, error: { kind: "QuizRestrictionPersistenceFailed" } };
    try {
      const result = await this.#database.prepare("SELECT knowledge_id, restricted_until FROM knowledge_workflow_restrictions WHERE owner_id = ? AND run_id = ? ORDER BY restricted_until, knowledge_id").bind(scope.ownerId, scope.runId).all();
      if (result.success !== true) return { ok: false, error: { kind: "QuizRestrictionPersistenceFailed" } };
      const restrictions = [];
      for (const row of result.results) {
        if (!isRecord(row) || !text(row.knowledge_id) || !text(row.restricted_until) || !Number.isFinite(Date.parse(row.restricted_until))) return { ok: false, error: { kind: "QuizRestrictionPersistenceFailed" } };
        restrictions.push(Object.freeze({ knowledgeId: row.knowledge_id, restrictedUntil: row.restricted_until }));
      }
      return { ok: true, value: Object.freeze(restrictions) };
    } catch (error) {
      this.#logger({ event: "quiz-restrictions-d1-failure", ownerId: scope.ownerId, runId: scope.runId, failureKind: "QuizRestrictionPersistenceFailed" });
      return { ok: false, error: { kind: "QuizRestrictionPersistenceFailed" } };
    }
  }

  /** @param {{ readonly ownerId: string, readonly runId: string, readonly knowledgeId: string, readonly before: string, readonly reason?: "quiz-attempt-retention" | "no-meaningful-quiz" }} command @returns {Promise<ContentResult>} */
  async purge(command) {
    if (!text(command?.ownerId) || !text(command.runId) || !text(command.knowledgeId) || !text(command.before)) return { ok: false, error: { kind: "QuizPurgeFailed" } };
    const reason = command.reason ?? "quiz-attempt-retention";
    if (reason !== "quiz-attempt-retention" && reason !== "no-meaningful-quiz") return { ok: false, error: { kind: "QuizPurgeFailed" } };
    try {
      const media = await this.#database.prepare("SELECT a.private_original_key, d.private_object_key FROM knowledge_workflow_media_assets a LEFT JOIN knowledge_workflow_media_derivatives d ON d.owner_id = a.owner_id AND d.asset_id = a.asset_id WHERE a.owner_id = ? AND a.run_id = ? AND a.knowledge_id = ?").bind(command.ownerId, command.runId, command.knowledgeId).all();
      if (!media.success || !Array.isArray(media.results)) return { ok: false, error: { kind: "QuizPurgeFailed" } };
      if (this.#bucket === null && media.results.length > 0) return { ok: false, error: { kind: "QuizPurgeFailed" } };
      if (this.#bucket !== null) {
        for (const row of media.results) {
          if (!isRecord(row)) return { ok: false, error: { kind: "QuizPurgeFailed" } };
          for (const key of [row.private_original_key, row.private_object_key]) {
            if (key === null) continue;
            if (!text(key)) return { ok: false, error: { kind: "QuizPurgeFailed" } };
            await this.#bucket.delete(key);
          }
        }
      }
      const generationId = `knowledge-workflow-generation:${command.runId}:${command.knowledgeId}`;
      const taskId = `knowledge-workflow-task:${command.runId}:${command.knowledgeId}`;
      const statements = [
        this.#database.prepare("DELETE FROM learning_generation_tasks WHERE owner_id = ? AND task_id = ?").bind(command.ownerId, taskId),
        this.#database.prepare("DELETE FROM learning_generation_units WHERE owner_id = ? AND generation_id = ?").bind(command.ownerId, generationId),
        this.#database.prepare("DELETE FROM learning_generation_jobs WHERE owner_id = ? AND generation_id = ?").bind(command.ownerId, generationId),
        this.#database.prepare("DELETE FROM knowledge_workflow_media_derivatives WHERE owner_id = ? AND asset_id IN (SELECT asset_id FROM knowledge_workflow_media_assets WHERE owner_id = ? AND run_id = ? AND knowledge_id = ?)").bind(command.ownerId, command.ownerId, command.runId, command.knowledgeId),
        this.#database.prepare("DELETE FROM knowledge_workflow_media_assets WHERE owner_id = ? AND run_id = ? AND knowledge_id = ?").bind(command.ownerId, command.runId, command.knowledgeId),
        this.#database.prepare("DELETE FROM extraction_knowledge_points WHERE owner_id = ? AND run_id = ? AND knowledge_id = ?").bind(command.ownerId, command.runId, command.knowledgeId),
        this.#database.prepare("DELETE FROM knowledge_workflow_quiz_attempts WHERE owner_id = ? AND run_id = ? AND knowledge_id = ?").bind(command.ownerId, command.runId, command.knowledgeId),
        this.#database.prepare("DELETE FROM knowledge_workflow_quizzes WHERE owner_id = ? AND run_id = ? AND knowledge_id = ?").bind(command.ownerId, command.runId, command.knowledgeId),
        this.#database.prepare("INSERT OR IGNORE INTO knowledge_workflow_purge_tombstones (owner_id, tombstone_id, run_id, knowledge_id, purged_before, reason, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(command.ownerId, `purge:${command.runId}:${command.knowledgeId}:${command.before}`, command.runId, command.knowledgeId, command.before, reason, this.#now()),
        reason === "no-meaningful-quiz"
          ? this.#database.prepare("DELETE FROM knowledge_workflow_restrictions WHERE owner_id = ? AND run_id = ? AND knowledge_id = ?").bind(command.ownerId, command.runId, command.knowledgeId)
          : this.#database.prepare("DELETE FROM knowledge_workflow_restrictions WHERE owner_id = ? AND run_id = ? AND knowledge_id = ? AND restricted_until <= ?").bind(command.ownerId, command.runId, command.knowledgeId, command.before),
      ];
      const results = await this.#database.batch(statements);
      if (results.length !== statements.length || !results.every((result) => result.success === true)) return { ok: false, error: { kind: "QuizPurgeFailed" } };
      this.#logger({ event: reason === "no-meaningful-quiz" ? "quiz-point-discarded" : "quiz-purge-success", ownerId: command.ownerId, runId: command.runId, knowledgeId: command.knowledgeId });
      return { ok: true, value: null };
    } catch (error) {
      this.#logger({ event: "quiz-purge-d1-failure", ownerId: command.ownerId, runId: command.runId, knowledgeId: command.knowledgeId, failureKind: "QuizPurgeFailed" });
      return { ok: false, error: { kind: "QuizPurgeFailed" } };
    }
  }

  /** @param {{ readonly ownerId: string, readonly runId: string, readonly knowledgeId: string, readonly reason: "no-meaningful-quiz" }} command @returns {Promise<ContentResult>} */
  async discard(command) {
    if (command?.reason !== "no-meaningful-quiz") return { ok: false, error: { kind: "QuizPurgeFailed" } };
    return this.purge({ ownerId: command.ownerId, runId: command.runId, knowledgeId: command.knowledgeId, before: this.#now(), reason: command.reason });
  }
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }
/** @param {unknown} value @param {{ readonly ownerId: string, readonly runId: string, readonly sourceId: string, readonly sourceRevision: number } | undefined} scope @returns {value is ExtractionScratchpad} */
function isScratchpad(value, scope = undefined) { return isRecord(value) && (scope === undefined || (value.ownerId === scope.ownerId && value.runId === scope.runId && value.sourceId === scope.sourceId && value.sourceRevision === scope.sourceRevision)) && Array.isArray(value.processedUrls) && (value.frontier === undefined || Array.isArray(value.frontier)) && (value.discoveredUrls === undefined || Array.isArray(value.discoveredUrls)) && Array.isArray(value.acceptedHashes) && Array.isArray(value.similarityEvidence) && Array.isArray(value.coverage) && Array.isArray(value.unresolvedGaps) && typeof value.consecutiveNoveltyZero === "number" && typeof value.revision === "number"; }
/** @param {unknown} value @returns {value is KnowledgePoint} */
function isKnowledgePoint(value) { return isRecord(value) && typeof value.id === "string" && typeof value.sourceId === "string" && typeof value.sourceRevision === "number" && typeof value.summary === "string" && typeof value.normalizedHash === "string" && Array.isArray(value.evidenceAnchors) && (value.classification === undefined || parseClassification(value.classification).ok); }
/** @param {unknown} value @returns {value is QuizAttempt} */
function isQuizAttempt(value) { return isRecord(value) && typeof value.id === "string" && typeof value.ownerId === "string" && typeof value.runId === "string" && typeof value.knowledgeId === "string" && positiveInteger(value.attempt) && (value.draftId === null || typeof value.draftId === "string") && (value.score === null || (typeof value.score === "number" && Number.isInteger(value.score) && value.score >= 1 && value.score <= 10)) && (value.feedback === null || typeof value.feedback === "string") && (value.failureKind === null || typeof value.failureKind === "string") && typeof value.createdAt === "string"; }
/** @param {unknown} value @returns {value is QuestionDraft} */
function isDraft(value) {
  if (!isRecord(value) || !text(value.id) || !text(value.knowledgeId) || !positiveInteger(value.knowledgeRevision) || !text(value.kind) || !text(value.prompt) || !Array.isArray(value.options) || !value.options.every(text) || !Array.isArray(value.citedEvidenceUrls) || value.citedEvidenceUrls.length === 0 || !value.citedEvidenceUrls.every(text)) return false;
  if (value.pairedQuiz !== undefined && (!validateAssembledQuizPair(value.pairedQuiz) || value.kind !== value.pairedQuiz.multipleChoice.kind || value.prompt !== value.pairedQuiz.multipleChoice.prompt || value.knowledgeId === "")) return false;
  if (!text(value.answer) && !(Array.isArray(value.answer) && value.answer.length > 0 && value.answer.every(text))) return false;
  const options = value.options;
  if (value.kind === "single-choice" && (options.length < 2 || options.length > 5 || typeof value.answer !== "string" || !options.includes(value.answer))) return false;
  if (value.kind === "multiple-choice" && (options.length > 5 || !Array.isArray(value.answer) || value.answer.length > 3 || value.answer.length >= options.length || new Set(value.answer).size !== value.answer.length || value.answer.some((answer) => !options.includes(answer)))) return false;
  if (value.kind === "fill-blank" && options.length !== 0) return false;
  if (value.blanks === undefined) return true;
  if (value.kind !== "fill-blank" || !Array.isArray(value.answer) || !Array.isArray(value.blanks) || value.blanks.length < 2 || value.blanks.length > 3 || value.blanks.length !== value.answer.length || (value.prompt.match(/_{2,}/gu) ?? []).length !== value.blanks.length) return false;
  const blanks = value.blanks;
  const answers = value.answer;
  return blanks.every((blank, index) => isRecord(blank) && blank.id === `blank-${index + 1}` && Array.isArray(blank.acceptedAnswers) && blank.acceptedAnswers.length > 0 && blank.acceptedAnswers.every(text) && blank.acceptedAnswers[0] === answers[index]);
}

/** @param {unknown} draft @returns {string | null} */
export function draftFingerprint(draft) {
  if (!isDraft(draft)) return null;
  const answer = Array.isArray(draft.answer) ? [...draft.answer].sort() : draft.answer;
  const canonical = JSON.stringify({ kind: draft.kind, prompt: draft.prompt.trim(), options: [...draft.options], answer, blanks: draft.blanks, pairedQuiz: draft.pairedQuiz ?? null, citedEvidenceUrls: [...draft.citedEvidenceUrls].sort() });
  let hash = 2166136261;
  for (const character of canonical) { hash ^= character.codePointAt(0) ?? 0; hash = Math.imul(hash, 16777619); }
  return `sha256:quiz-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/** @param {{ readonly ownerId: string, readonly runId: string, readonly knowledge: KnowledgePoint, readonly draft: QuestionDraft, readonly score: number, readonly attempt: number, readonly status: "published" | "pending-review" }} command @param {string} createdAt @returns {{ readonly record: LearningGenerationRecord, readonly unit: LearningUnit, readonly task: LearningTask, readonly fingerprint: string }} */
function projectReviewQueue(command, createdAt) {
  const generationId = `knowledge-workflow-generation:${command.runId}:${command.knowledge.id}`;
  const unitId = `knowledge-workflow-unit:${command.runId}:${command.knowledge.id}`;
  const taskId = `knowledge-workflow-task:${command.runId}:${command.knowledge.id}`;
  const itemVersionId = `${command.knowledge.sourceId}:${command.knowledge.sourceRevision}:${command.knowledge.id}`;
  const anchors = Object.freeze([...command.draft.citedEvidenceUrls]);
  const unit = /** @type {LearningUnit} */ (Object.freeze({
    id: unitId,
    ownerId: command.ownerId,
    sourceId: command.knowledge.sourceId,
    sourceRevision: command.knowledge.sourceRevision,
    itemId: command.knowledge.id,
    itemVersionId,
    contentDigest: command.knowledge.normalizedHash,
    ordinal: 1,
    text: command.knowledge.summary,
    startOffset: 0,
    endOffset: command.knowledge.summary.length,
    wordCount: Math.max(1, command.knowledge.summary.trim().split(/\s+/u).length),
    sourceAnchorIds: anchors,
    provenance: "deterministic-unitization",
    policyVersion: "knowledge-workflow-v1",
  }));
  const task = /** @type {LearningTask} */ (Object.freeze({
    id: taskId,
    ownerId: command.ownerId,
    sourceId: command.knowledge.sourceId,
    sourceRevision: command.knowledge.sourceRevision,
    itemId: command.knowledge.id,
    itemVersionId,
    contentDigest: command.knowledge.normalizedHash,
    version: 1,
    kind: projectedTaskKind(command.draft.kind),
    prompt: command.draft.prompt,
    // Historical v1 drafts have no rationale; preserve their source summary.
    // The current production generator requires a validated LLM explanation.
    explanation: command.draft.explanation === undefined ? command.knowledge.summary : command.draft.explanation,
    unitIds: /** @type {[string, ...string[]]} */ ([unitId]),
    sourceAnchorIds: /** @type {[string, ...string[]]} */ ([...anchors]),
    choices: choiceProjection(command.draft),
    correctChoiceIds: correctChoiceProjection(command.draft),
    blankId: command.draft.kind === "fill-blank" && command.draft.blanks === undefined ? `${taskId}:blank` : null,
    acceptedAnswers: acceptedAnswerProjection(command.draft),
    blanks: command.draft.blanks === undefined ? null : Object.freeze(command.draft.blanks.map((/** @type {{ readonly id: string, readonly acceptedAnswers: readonly string[] }} */ blank) => Object.freeze({ id: blank.id, acceptedAnswers: Object.freeze([...blank.acceptedAnswers]) }))),
    ...(command.draft.pairedQuiz === undefined ? {} : { pairedVariants: Object.freeze([
      Object.freeze({ id: command.draft.pairedQuiz.multipleChoice.id, kind: command.draft.pairedQuiz.multipleChoice.kind, prompt: command.draft.pairedQuiz.multipleChoice.prompt, explanation: command.draft.pairedQuiz.multipleChoice.explanation, choices: Object.freeze(command.draft.pairedQuiz.multipleChoice.options.map((option) => Object.freeze({ id: option.key, label: option.text }))), correctChoiceIds: Object.freeze([...command.draft.pairedQuiz.multipleChoice.correctOptionKeys]) }),
      Object.freeze({ id: command.draft.pairedQuiz.fillBlank.id, kind: command.draft.pairedQuiz.fillBlank.kind, prompt: command.draft.pairedQuiz.fillBlank.prompt, explanation: command.draft.pairedQuiz.fillBlank.explanation, blanks: Object.freeze(command.draft.pairedQuiz.fillBlank.blanks.map((blank) => Object.freeze({ id: blank.id, acceptedAnswers: Object.freeze([...blank.acceptedAnswers]) }))) }),
    ]) }),
    expectedConcepts: expectedConceptProjection(command.draft),
    minimumWords: responseKind(command.draft.kind) === "text" && command.draft.kind === "short-response" ? 1 : null,
    stimulus: command.draft.kind === "case-study" || command.draft.kind === "symbolic" || command.draft.kind === "notation" ? command.knowledge.summary : null,
    responseKind: responseKind(command.draft.kind),
    generatorVersion: "knowledge-workflow-question-generator-v1",
    policyVersion: "knowledge-workflow-v1",
    provenance: "provider-draft",
    reviewRequired: command.status === "pending-review",
    status: command.status,
    reviewDecision: null,
    reviewedAt: null,
    revision: 1,
    generatedAt: createdAt,
  }));
  const record = /** @type {LearningGenerationRecord} */ (Object.freeze({
    id: generationId,
    ownerId: command.ownerId,
    sourceId: command.knowledge.sourceId,
    sourceRevision: command.knowledge.sourceRevision,
    itemId: command.knowledge.id,
    itemVersionId,
    contentDigest: command.knowledge.normalizedHash,
    sourceKind: "public-text",
    rightsEvidenceId: `knowledge-workflow-rights:${command.runId}`,
    attribution: Object.freeze({ label: command.knowledge.attribution.sourceUrl, sourceUrl: command.knowledge.attribution.sourceUrl }),
    policyVersion: "knowledge-workflow-v1",
    units: Object.freeze([unit]),
    tasks: Object.freeze([task]),
    status: "completed",
    localOnly: false,
    providerRequestId: null,
    failureKind: null,
    idempotencyKey: generationId,
    createdAt,
  }));
  return { record, unit, task, fingerprint: JSON.stringify([generationId, command.draft.id, command.score, command.attempt, command.status]) };
}

/** @param {QuestionDraft["kind"]} kind @returns {LearningTask["kind"]} */
function projectedTaskKind(kind) {
  if (kind === "symbolic") return "symbolic-midi";
  if (kind === "notation") return "notation";
  return kind;
}
/** @param {QuestionDraft["kind"]} kind @returns {"text" | null} */
function responseKind(kind) { return kind === "short-response" || kind === "case-study" || kind === "symbolic" || kind === "notation" ? "text" : null; }
/** @param {QuestionDraft} draft @returns {LearningTask["choices"]} */
function choiceProjection(draft) {
  if (draft.kind !== "single-choice" && draft.kind !== "multiple-choice") return null;
  const options = /** @type {readonly string[]} */ (draft.options);
  return Object.freeze(options.map((label, index) => Object.freeze({ id: `choice-${index + 1}`, label })));
}
/** @param {QuestionDraft} draft @returns {LearningTask["correctChoiceIds"]} */
function correctChoiceProjection(draft) {
  if (draft.kind !== "single-choice" && draft.kind !== "multiple-choice") return null;
  const answers = Array.isArray(draft.answer) ? draft.answer : [draft.answer];
  const options = /** @type {readonly string[]} */ (draft.options);
  const typedAnswers = /** @type {readonly string[]} */ (answers);
  const ids = typedAnswers.map((answer) => `choice-${options.indexOf(answer) + 1}`);
  return /** @type {[string, ...string[]]} */ (Object.freeze(ids));
}
/** @param {QuestionDraft} draft @returns {LearningTask["acceptedAnswers"]} */
function acceptedAnswerProjection(draft) {
  if (draft.kind !== "fill-blank" || draft.blanks !== undefined) return null;
  const answers = Array.isArray(draft.answer) ? draft.answer : [draft.answer];
  return /** @type {[string, ...string[]]} */ (Object.freeze([...answers]));
}
/** @param {QuestionDraft} draft @returns {LearningTask["expectedConcepts"]} */
function expectedConceptProjection(draft) {
  return draft.kind === "short-response" || draft.kind === "symbolic" || draft.kind === "notation" ? /** @type {readonly [string, ...string[]]} */ (Object.freeze([draft.prompt])) : null;
}

export {};
