// @ts-check
import { isKnowledgeWorkflowRun } from '../src/features/knowledge-workflows/workflow.js';
import { readFailedQuizItems } from './knowledge-workflow-quiz-failures.js';
import { workflowPersistenceDiagnostic } from './knowledge-workflow-logging.js';
import { parseWorkflowProgress } from '../src/features/knowledge-workflows/progress.js';

/** @typedef {import('./knowledge-workflow-d1.js').D1DatabasePort} D1DatabasePort */
/** @typedef {import('../src/features/knowledge-workflows/workflow.js').KnowledgeWorkflowRun} KnowledgeWorkflowRun */
/** @typedef {import('../src/features/knowledge-workflows/progress.js').WorkflowProgress} WorkflowProgress */
/** @typedef {{readonly ownerId:string,readonly runId:string,readonly currentUrl?:string|null,readonly pageTitle?:string|null,readonly sectionTitle?:string|null,readonly stage?:string|null,readonly updatedAt:string}} ProgressWrite */
/** @template T @typedef {{ok:true,value:T}|{ok:false,error:{kind:string,diagnosticToken?:string}}} Result */
/** @param {unknown} value @returns {value is Record<string,unknown>} */
function record(value) { return typeof value === 'object' && value !== null && !Array.isArray(value); }
/** @param {unknown} value @returns {value is string} */
function text(value) { return typeof value === 'string' && value.trim() !== ''; }

export class D1KnowledgeWorkflowProgressRepository {
  /** @type {D1DatabasePort} */ #database;
  /** @type {(entry:{event:string,ownerId?:string,runId?:string,failureKind?:string,diagnosticToken?:string})=>void} */ #logger;
  /** @param {{database:D1DatabasePort,logger:(entry:{event:string,ownerId?:string,runId?:string,failureKind?:string,diagnosticToken?:string})=>void}} dependencies */
  constructor(dependencies) {
    if (typeof dependencies?.database?.prepare !== 'function' || typeof dependencies.logger !== 'function') throw new TypeError('Workflow progress dependencies are invalid.');
    this.#database = dependencies.database; this.#logger = dependencies.logger;
  }
  /** @param {ProgressWrite} command @returns {Promise<Result<null>>} */
  async save(command) {
    if (!record(command) || !text(command.ownerId) || !text(command.runId) || !text(command.updatedAt) || parseWorkflowProgress({currentUrl:command.currentUrl ?? null,pageTitle:command.pageTitle ?? null,sectionTitle:command.sectionTitle ?? null,stage:command.stage ?? null,updatedAt:command.updatedAt,knowledgePoints:[],generatedQuizQuestions:0}) === null) return {ok:false,error:{kind:'WorkflowProgressCommandInvalid'}};
    try {
      const saved = await this.#database.prepare(`INSERT INTO knowledge_workflow_progress(owner_id,run_id,current_url,page_title,section_title,stage,updated_at)
        SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM knowledge_workflow_runs WHERE owner_id=? AND run_id=? AND state NOT IN('abandoned','completed'))
        AND NOT EXISTS(SELECT 1 FROM knowledge_workflow_run_tombstones WHERE owner_id=? AND run_id=?)
        ON CONFLICT(owner_id,run_id) DO UPDATE SET current_url=CASE WHEN ? THEN excluded.current_url ELSE knowledge_workflow_progress.current_url END,
        page_title=CASE WHEN ? THEN excluded.page_title ELSE knowledge_workflow_progress.page_title END,
        section_title=CASE WHEN ? THEN excluded.section_title ELSE knowledge_workflow_progress.section_title END,
        stage=CASE WHEN ? THEN excluded.stage ELSE knowledge_workflow_progress.stage END,updated_at=excluded.updated_at
        WHERE knowledge_workflow_progress.updated_at<=excluded.updated_at`).bind(command.ownerId,command.runId,command.currentUrl ?? null,command.pageTitle ?? null,command.sectionTitle ?? null,command.stage ?? null,command.updatedAt,command.ownerId,command.runId,command.ownerId,command.runId,Number(command.currentUrl !== undefined),Number(command.pageTitle !== undefined),Number(command.sectionTitle !== undefined),Number(command.stage !== undefined)).run();
      if (saved.success && saved.meta?.changes === 1) return {ok:true,value:null};
      // Concurrent reviewers can arrive out of order; retaining newer display progress is successful.
      const newer = saved.success && saved.meta?.changes === 0 ? await this.#database.prepare(`SELECT p.updated_at FROM knowledge_workflow_progress p JOIN knowledge_workflow_runs r USING(owner_id,run_id)
        WHERE p.owner_id=? AND p.run_id=? AND p.updated_at>? AND r.state NOT IN('abandoned','completed')
        AND NOT EXISTS(SELECT 1 FROM knowledge_workflow_run_tombstones WHERE owner_id=p.owner_id AND run_id=p.run_id)`).bind(command.ownerId,command.runId,command.updatedAt).first() : null;
      if (record(newer)) return {ok:true,value:null};
      this.#logger({event:'workflow-progress-save-failure',ownerId:command.ownerId,runId:command.runId,failureKind:'WorkflowProgressPersistenceFailed',diagnosticToken:'write-not-applied'});
      return {ok:false,error:{kind:'WorkflowProgressPersistenceFailed'}};
    } catch (error) {
      this.#logger({event:'workflow-progress-save-failure',ownerId:command.ownerId,runId:command.runId,failureKind:'WorkflowProgressPersistenceFailed',diagnosticToken:workflowPersistenceDiagnostic(error)});
      return {ok:false,error:{kind:'WorkflowProgressPersistenceFailed',diagnosticToken:workflowPersistenceDiagnostic(error)}};
    }
  }
  /** Current run only; source/run ownership is checked in the database as well as
   * the authenticated workflow service. Counts come from committed artifacts.
   * @param {KnowledgeWorkflowRun} run @returns {Promise<Result<WorkflowProgress>>} */
  async read(run) {
    if (!isKnowledgeWorkflowRun(run)) return {ok:false,error:{kind:'WorkflowProgressCommandInvalid'}};
    try {
      const row = await this.#database.prepare(`SELECT r.state,r.failure_kind,r.updated_at AS run_updated_at,p.current_url,p.page_title,p.section_title,p.stage,p.updated_at,s.scratchpad_json,s.updated_at AS scratchpad_updated_at
        FROM knowledge_workflow_runs r LEFT JOIN knowledge_workflow_progress p ON p.owner_id=r.owner_id AND p.run_id=r.run_id
        LEFT JOIN extraction_scratchpads s ON s.owner_id=r.owner_id AND s.run_id=r.run_id
        WHERE r.owner_id=? AND r.run_id=? AND r.source_id=? AND r.source_revision=?`).bind(run.ownerId,run.runId,run.sourceId,run.sourceRevision).first();
      if (!record(row)) return {ok:false,error:{kind:'WorkflowProgressNotFound'}};
      const points = await this.#database.prepare('SELECT knowledge_id,point_json FROM extraction_knowledge_points WHERE owner_id=? AND run_id=? ORDER BY created_at,knowledge_id').bind(run.ownerId,run.runId).all();
      const questions = await this.#database.prepare(`SELECT COALESCE(SUM(CASE WHEN json_type(draft_json,'$.pairedQuiz')='object'
        THEN COALESCE(json_type(draft_json,'$.pairedQuiz.multipleChoice')='object',0)+COALESCE(json_type(draft_json,'$.pairedQuiz.fillBlank')='object',0)
        ELSE 1 END),0) AS n FROM knowledge_workflow_quizzes WHERE owner_id=? AND run_id=?`).bind(run.ownerId,run.runId).first();
      if (!points.success || !record(questions)) return {ok:false,error:{kind:'WorkflowProgressReadFailed'}};
      const knowledgePoints = points.results.map(point => {
        if (!record(point) || !text(point.knowledge_id) || !text(point.point_json)) throw new TypeError('Workflow point projection invalid.');
        const parsed = JSON.parse(point.point_json);
        if (!record(parsed) || parsed.id !== point.knowledge_id || !text(parsed.summary)) throw new TypeError('Workflow point projection invalid.');
        return {knowledgeId:point.knowledge_id,summary:parsed.summary};
      });
      const scratchpad = row.scratchpad_json === null ? null : JSON.parse(String(row.scratchpad_json));
      if (scratchpad !== null && (!record(scratchpad) || scratchpad.ownerId !== run.ownerId || scratchpad.runId !== run.runId || scratchpad.sourceId !== run.sourceId || scratchpad.sourceRevision !== run.sourceRevision || !Array.isArray(scratchpad.processedUrls) || !scratchpad.processedUrls.every(text) || scratchpad.discoveredUrls !== undefined && (!Array.isArray(scratchpad.discoveredUrls) || !scratchpad.discoveredUrls.every(text)))) return {ok:false,error:{kind:'WorkflowProgressReadFailed'}};
      const processed = scratchpad?.processedUrls ?? [], discovered = scratchpad?.discoveredUrls ?? [];
      const latest = Array.isArray(scratchpad?.pageNotes) ? scratchpad.pageNotes.at(-1) : null;
      const timestamps = [row.run_updated_at,row.updated_at,row.scratchpad_updated_at].filter(text).sort();
      // Keep paid attempts for diagnostics; dismissed failures leave the user's retry list.
      const dismissed=row.state==='completed'&&row.failure_kind==='WorkflowFailedItemsDismissed';
      const failedQuizzes=dismissed?{ok:/** @type {const} */(true),value:[]}:await readFailedQuizItems(this.#database,run);if(!failedQuizzes.ok)return failedQuizzes;
      const progress = parseWorkflowProgress({currentUrl:row.current_url ?? (record(latest) ? latest.url ?? null : null),pageTitle:row.page_title ?? (record(latest) ? latest.title ?? null : null),sectionTitle:row.section_title ?? null,stage:row.state === 'completed' || row.state === 'abandoned' ? null : row.stage ?? null,updatedAt:timestamps.at(-1) ?? null,knowledgePoints,generatedQuizQuestions:questions.n,failedItems:dismissed?[]:scratchpad?.failedPages,failedQuizItems:failedQuizzes.value,processedPageCount:processed.length,totalPages:discovered.length ? new Set([...processed,...discovered]).size : null});
      return progress === null ? {ok:false,error:{kind:'WorkflowProgressReadFailed'}} : {ok:true,value:progress};
    } catch (error) {
      this.#logger({event:'workflow-progress-read-failure',ownerId:run.ownerId,runId:run.runId,failureKind:'WorkflowProgressReadFailed'});
      return {ok:false,error:{kind:'WorkflowProgressReadFailed'}};
    }
  }
}
