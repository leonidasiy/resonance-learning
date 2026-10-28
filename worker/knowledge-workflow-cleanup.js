// @ts-check
import { parseOriginalImageReceipt } from "./webpage-image-cache.js";
import { isMaterialImageReceipt, materialImageObjectKeys } from "./material-image-cache.js";

/** @template T, E @typedef {{ readonly ok: true, readonly value: T } | { readonly ok: false, readonly error: E }} Result */
/** @typedef {{ readonly success: boolean, readonly meta?: { readonly changes?: number } }} D1Result */
/** @typedef {{ readonly bind: (...values: readonly (string | number | null)[]) => D1Statement, readonly first: () => Promise<unknown | null>, readonly all: () => Promise<{ readonly success: boolean, readonly results: readonly unknown[] }>, readonly run: () => Promise<D1Result> }} D1Statement */
/** @typedef {{ readonly prepare: (query: string) => D1Statement, readonly batch: (statements: readonly D1Statement[]) => Promise<readonly D1Result[]> }} D1DatabasePort */
/** @typedef {{ readonly delete: (key: string) => Promise<unknown> }} CleanupBucket */
/** @typedef {import("../src/features/knowledge-workflows/workflow.js").KnowledgeWorkflowRun} KnowledgeWorkflowRun */

/** @typedef {{ readonly event: string, readonly ownerId?: string, readonly runId?: string, readonly failureKind?: string }} CleanupLog */

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function record(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }
/** @param {unknown} value @returns {value is string} */
function text(value) { return typeof value === "string" && value.trim() !== ""; }
/** @param {unknown} value @returns {value is number} */
function positiveInteger(value) { return typeof value === "number" && Number.isSafeInteger(value) && value > 0; }
/** @param {D1Result} result @returns {boolean} */
function succeeded(result) { return result.success === true; }

/** @typedef {{ readonly listBySource: (ownerId: string, sourceId: string, sourceRevision?: number) => Promise<Result<readonly KnowledgeWorkflowRun[], unknown>>, readonly invalidateReuse: (command: { readonly canonicalSourceIdentity: string, readonly sourceRevision?: number }) => Promise<Result<null, unknown>>, readonly markAbandoned: (command: { readonly run: KnowledgeWorkflowRun, readonly reason: string, readonly updatedAt: string }) => Promise<Result<null, unknown>> }} CleanupWorkflowRepository */

/**
 * D1/R2 cleanup is deliberately a composition boundary. It owns no model
 * policy; it only removes content-bearing descendants after all public
 * commands have been authenticated and validated by the workflow service.
 *
 * @param {{ readonly database: D1DatabasePort, readonly bucket?: CleanupBucket | null, readonly materialImageContent?:Pick<import('./source-content-r2.js').R2SourceContentStore,'remove'>, readonly sourceContent?: { readonly purge: (scope: { readonly ownerId: string, readonly sourceId: string, readonly sourceRevision?: number }) => Promise<Result<null, unknown>> }, readonly workflowRepository: CleanupWorkflowRepository, readonly now: () => string, readonly logger: (entry: CleanupLog) => void }} dependencies
 */
export function createKnowledgeWorkflowCleanup(dependencies) {
  if (typeof dependencies?.database?.prepare !== "function" || typeof dependencies.database.batch !== "function" || (dependencies.sourceContent !== undefined && typeof dependencies.sourceContent.purge !== "function") || !dependencies.workflowRepository || typeof dependencies.workflowRepository.listBySource !== "function" || typeof dependencies.workflowRepository.markAbandoned !== "function" || typeof dependencies.workflowRepository.invalidateReuse !== "function" || typeof dependencies.now !== "function" || typeof dependencies.logger !== "function" || (dependencies.bucket !== undefined && dependencies.bucket !== null && typeof dependencies.bucket.delete !== "function")) throw new TypeError("Knowledge workflow cleanup dependencies are invalid.");

  /** @param {KnowledgeWorkflowRun} run @param {string} reason @param {boolean} markTerminal @returns {Promise<Result<null, { readonly kind: "WorkflowCleanupFailed" }>>} */
  async function purgeRun(run, reason, markTerminal) {
    const occurredAt = dependencies.now();
    if (!text(occurredAt) || !Number.isFinite(Date.parse(occurredAt))) throw new TypeError("Knowledge workflow cleanup clock returned an invalid timestamp.");
    dependencies.logger({ event: "knowledge-workflow-cleanup-entry", ownerId: run.ownerId, runId: run.runId });
    if (markTerminal) {
      const marked = await dependencies.workflowRepository.markAbandoned({ run, reason, updatedAt: occurredAt });
      if (!marked.ok) {
        dependencies.logger({ event: "knowledge-workflow-cleanup-failure", ownerId: run.ownerId, runId: run.runId, failureKind: "WorkflowCleanupFailed" });
        return { ok: false, error: { kind: "WorkflowCleanupFailed" } };
      }
    }
    // Remove learner-visible artifacts before any remote storage operation. Media
    // rows retain their keys until remote cleanup succeeds, so retries stay safe.
    try {
      const generationPrefix = `knowledge-workflow-generation:${run.runId}:`;
      const visible = [
        dependencies.database.prepare('DELETE FROM learning_generation_tasks WHERE owner_id=? AND generation_id IN (SELECT generation_id FROM learning_generation_jobs WHERE owner_id=? AND substr(generation_id,1,?)=?)').bind(run.ownerId,run.ownerId,generationPrefix.length,generationPrefix),
        dependencies.database.prepare('DELETE FROM learning_generation_units WHERE owner_id=? AND generation_id IN (SELECT generation_id FROM learning_generation_jobs WHERE owner_id=? AND substr(generation_id,1,?)=?)').bind(run.ownerId,run.ownerId,generationPrefix.length,generationPrefix),
        dependencies.database.prepare('DELETE FROM learning_generation_jobs WHERE owner_id=? AND substr(generation_id,1,?)=?').bind(run.ownerId,generationPrefix.length,generationPrefix),
        dependencies.database.prepare('DELETE FROM extraction_knowledge_points WHERE owner_id=? AND run_id=?').bind(run.ownerId,run.runId),
        dependencies.database.prepare('DELETE FROM knowledge_workflow_quizzes WHERE owner_id=? AND run_id=?').bind(run.ownerId,run.runId),
        dependencies.database.prepare('DELETE FROM extraction_scratchpads WHERE owner_id=? AND run_id=?').bind(run.ownerId,run.runId),
        dependencies.database.prepare('DELETE FROM knowledge_workflow_progress WHERE owner_id=? AND run_id=?').bind(run.ownerId,run.runId),
        dependencies.database.prepare('INSERT OR IGNORE INTO knowledge_workflow_run_tombstones (owner_id,tombstone_id,run_id,purged_before,reason,occurred_at) VALUES (?,?,?,?,?,?)').bind(run.ownerId,`run-purge:${run.runId}`,run.runId,occurredAt,reason,occurredAt),
      ];
      const deleted = await dependencies.database.batch(visible);
      if (deleted.length !== visible.length || deleted.some(result => !succeeded(result))) return {ok:false,error:{kind:'WorkflowCleanupFailed'}};
    } catch (error) {
      dependencies.logger({event:'knowledge-workflow-cleanup-failure',ownerId:run.ownerId,runId:run.runId,failureKind:'WorkflowCleanupFailed'});
      return {ok:false,error:{kind:'WorkflowCleanupFailed'}};
    }
    if (markTerminal && dependencies.sourceContent !== undefined) {
      const sourceContent = await dependencies.sourceContent.purge({ ownerId: run.ownerId, sourceId: run.sourceId, sourceRevision: run.sourceRevision });
      if (!sourceContent.ok) {
        dependencies.logger({ event: "knowledge-workflow-cleanup-failure", ownerId: run.ownerId, runId: run.runId, failureKind: "WorkflowCleanupFailed" });
        return { ok: false, error: { kind: "WorkflowCleanupFailed" } };
      }
    }
    let mediaRows;
    try {
      const selected = await dependencies.database.prepare("SELECT a.private_original_key AS object_key FROM knowledge_workflow_media_assets a WHERE a.owner_id = ? AND a.run_id = ? UNION ALL SELECT d.private_object_key AS object_key FROM knowledge_workflow_media_derivatives d JOIN knowledge_workflow_media_assets a ON a.owner_id = d.owner_id AND a.asset_id = d.asset_id WHERE a.owner_id = ? AND a.run_id = ? UNION ALL SELECT object_key FROM knowledge_workflow_materials m WHERE owner_id = ? AND run_id = ? AND NOT EXISTS (SELECT 1 FROM source_content_references c WHERE c.owner_id = m.owner_id AND c.object_key = m.object_key) AND NOT EXISTS (SELECT 1 FROM knowledge_workflow_materials other WHERE other.owner_id = m.owner_id AND other.object_key = m.object_key AND other.run_id != m.run_id)").bind(run.ownerId, run.runId, run.ownerId, run.runId, run.ownerId, run.runId).all();
      if (!selected.success) return { ok: false, error: { kind: "WorkflowCleanupFailed" } };
      mediaRows = selected.results;
    } catch (error) {
      dependencies.logger({ event: "knowledge-workflow-cleanup-failure", ownerId: run.ownerId, runId: run.runId, failureKind: "WorkflowCleanupFailed" });
      return { ok: false, error: { kind: "WorkflowCleanupFailed" } };
    }
    try {
      const cached = await dependencies.database.prepare("SELECT page_url,attempt_key,output_json FROM knowledge_workflow_image_attempts WHERE owner_id=? AND run_id=? AND attempt_key GLOB 'read:*' AND json_extract(output_json,'$.version')='webpage-original-image-v1'").bind(run.ownerId,run.runId).all();
      if(!cached.success)return {ok:false,error:{kind:'WorkflowCleanupFailed'}};
      for(const row of cached.results){
        if(!record(row)||!text(row.page_url)||!text(row.attempt_key)||!text(row.output_json))return {ok:false,error:{kind:'WorkflowCleanupFailed'}};
        const raw=JSON.parse(row.output_json);
        if(!record(raw)||!text(raw.imageUrl)||!text(raw.imageId)||row.attempt_key!==`read:${raw.imageId}`)return {ok:false,error:{kind:'WorkflowCleanupFailed'}};
        const receipt=await parseOriginalImageReceipt(raw,{ownerId:run.ownerId,runId:run.runId,sourceRevision:run.sourceRevision,pageUrl:row.page_url},{id:raw.imageId,url:raw.imageUrl});
        if(receipt===null)return {ok:false,error:{kind:'WorkflowCleanupFailed'}};
        mediaRows=[...mediaRows,{object_key:receipt.objectKey}];
      }
      const materials=await dependencies.database.prepare("SELECT stage_key,input_digest,result_json FROM knowledge_workflow_stages WHERE owner_id=? AND run_id=? AND stage_key GLOB 'material-image-manifest:*' AND status='completed'").bind(run.ownerId,run.runId).all();
      if(!materials.success)return {ok:false,error:{kind:'WorkflowCleanupFailed'}};
      for(const row of materials.results){
        if(!record(row)||!text(row.stage_key)||!text(row.input_digest)||!text(row.result_json)||row.stage_key!==`material-image-manifest:${row.input_digest}`)return {ok:false,error:{kind:'WorkflowCleanupFailed'}};
        const result=JSON.parse(row.result_json);
        if(!record(result)||result.ok!==true||!isMaterialImageReceipt(result.value,run,row.input_digest))return {ok:false,error:{kind:'WorkflowCleanupFailed'}};
        const keys=await materialImageObjectKeys(result.value);
        if(!dependencies.materialImageContent)return {ok:false,error:{kind:'WorkflowCleanupFailed'}};
        for(const key of [keys.manifest,...new Set(keys.images)]){const removed=await dependencies.materialImageContent.remove(key);if(!removed.ok)return {ok:false,error:{kind:'WorkflowCleanupFailed'}};}
      }
      // Keep cache key receipts with the debit history: a pending write can
      // finish after this deletion and still needs a retryable cleanup key.
    }catch(error){
      dependencies.logger({event:'knowledge-workflow-cleanup-failure',ownerId:run.ownerId,runId:run.runId,failureKind:'WorkflowCleanupFailed'});
      return {ok:false,error:{kind:'WorkflowCleanupFailed'}};
    }
    if (dependencies.bucket !== undefined && dependencies.bucket !== null) {
      for (const row of mediaRows) {
        if (!record(row)) return { ok: false, error: { kind: "WorkflowCleanupFailed" } };
        const key = row.object_key;
        if (!text(key)) return { ok: false, error: { kind: "WorkflowCleanupFailed" } };
        try { await dependencies.bucket.delete(key); } catch (error) {
          dependencies.logger({ event: "knowledge-workflow-cleanup-failure", ownerId: run.ownerId, runId: run.runId, failureKind: "WorkflowCleanupFailed" });
          return { ok: false, error: { kind: "WorkflowCleanupFailed" } };
        }
      }
    } else if (mediaRows.length > 0) {
      return { ok: false, error: { kind: "WorkflowCleanupFailed" } };
    }
    try {
      const generationPrefix = `knowledge-workflow-generation:${run.runId}:`;
      const statements = [
        dependencies.database.prepare("DELETE FROM knowledge_workflow_stages WHERE owner_id=? AND run_id=? AND stage_key NOT GLOB 'material-image-manifest:*'").bind(run.ownerId,run.runId),
        dependencies.database.prepare("DELETE FROM knowledge_workflow_review_evidence WHERE owner_id=? AND run_id=?").bind(run.ownerId,run.runId),
        dependencies.database.prepare("DELETE FROM source_classification_review_issues WHERE owner_id = ? AND run_id = ?").bind(run.ownerId,run.runId),
        dependencies.database.prepare("DELETE FROM source_classifications WHERE owner_id = ? AND run_id = ?").bind(run.ownerId,run.runId),
        dependencies.database.prepare("DELETE FROM learning_generation_tasks WHERE owner_id = ? AND generation_id IN (SELECT generation_id FROM learning_generation_jobs WHERE owner_id = ? AND substr(generation_id, 1, ?) = ?)").bind(run.ownerId, run.ownerId, generationPrefix.length, generationPrefix),
        dependencies.database.prepare("DELETE FROM learning_generation_units WHERE owner_id = ? AND generation_id IN (SELECT generation_id FROM learning_generation_jobs WHERE owner_id = ? AND substr(generation_id, 1, ?) = ?)").bind(run.ownerId, run.ownerId, generationPrefix.length, generationPrefix),
        dependencies.database.prepare("DELETE FROM learning_generation_jobs WHERE owner_id = ? AND substr(generation_id, 1, ?) = ?").bind(run.ownerId, generationPrefix.length, generationPrefix),
        dependencies.database.prepare("DELETE FROM knowledge_workflow_media_derivatives WHERE owner_id = ? AND asset_id IN (SELECT asset_id FROM knowledge_workflow_media_assets WHERE owner_id = ? AND run_id = ?)").bind(run.ownerId, run.ownerId, run.runId),
        dependencies.database.prepare("DELETE FROM knowledge_workflow_media_assets WHERE owner_id = ? AND run_id = ?").bind(run.ownerId, run.runId),
        dependencies.database.prepare("DELETE FROM knowledge_workflow_materials WHERE owner_id = ? AND run_id = ?").bind(run.ownerId, run.runId),
        dependencies.database.prepare("DELETE FROM extraction_knowledge_points WHERE owner_id = ? AND run_id = ?").bind(run.ownerId, run.runId),
        dependencies.database.prepare("DELETE FROM knowledge_workflow_page_image_warnings WHERE owner_id = ? AND run_id = ?").bind(run.ownerId,run.runId),
        dependencies.database.prepare("DELETE FROM extraction_scratchpads WHERE owner_id = ? AND run_id = ?").bind(run.ownerId, run.runId),
        dependencies.database.prepare("DELETE FROM knowledge_workflow_quiz_retry_attempts WHERE owner_id = ? AND run_id = ?").bind(run.ownerId, run.runId),
        dependencies.database.prepare("DELETE FROM knowledge_workflow_restrictions WHERE owner_id = ? AND run_id = ?").bind(run.ownerId, run.runId),
        dependencies.database.prepare("DELETE FROM knowledge_workflow_quiz_attempts WHERE owner_id = ? AND run_id = ?").bind(run.ownerId, run.runId),
        dependencies.database.prepare("DELETE FROM knowledge_workflow_quizzes WHERE owner_id = ? AND run_id = ?").bind(run.ownerId, run.runId),
        dependencies.database.prepare("DELETE FROM knowledge_workflow_rights_decisions WHERE owner_id = ? AND run_id = ?").bind(run.ownerId, run.runId),
        dependencies.database.prepare("DELETE FROM agent_memory_records WHERE owner_id = (SELECT owner_id FROM knowledge_workflow_runs WHERE owner_id = ? AND run_id = ?) AND namespace_id IN (SELECT namespace_id FROM agent_memory_namespaces WHERE owner_id = ? AND run_id = ?)").bind(run.ownerId, run.runId, run.ownerId, run.runId),
        dependencies.database.prepare("DELETE FROM agent_memory_namespaces WHERE owner_id = ? AND run_id = ?").bind(run.ownerId, run.runId),
        dependencies.database.prepare("DELETE FROM agent_compaction_records WHERE owner_id = ? AND run_id = ?").bind(run.ownerId, run.runId),
        dependencies.database.prepare("DELETE FROM agent_shared_handoffs WHERE owner_id = ? AND run_id = ?").bind(run.ownerId, run.runId),
        dependencies.database.prepare("DELETE FROM agent_event_ledger WHERE owner_id = ? AND run_id = ?").bind(run.ownerId, run.runId),
        dependencies.database.prepare("INSERT OR IGNORE INTO knowledge_workflow_run_tombstones (owner_id, tombstone_id, run_id, purged_before, reason, occurred_at) VALUES (?, ?, ?, ?, ?, ?)").bind(run.ownerId, `run-purge:${run.runId}`, run.runId, occurredAt, reason, occurredAt),
      ];
      const results = await dependencies.database.batch(statements);
      if (results.length !== statements.length || results.some((result) => !succeeded(result))) return { ok: false, error: { kind: "WorkflowCleanupFailed" } };
      if (markTerminal) {
        const invalidated = await dependencies.workflowRepository.invalidateReuse({ canonicalSourceIdentity: run.canonicalSourceIdentity, sourceRevision: run.sourceRevision });
        if (!invalidated.ok) return { ok: false, error: { kind: "WorkflowCleanupFailed" } };
      }
      dependencies.logger({ event: "knowledge-workflow-cleanup-success", ownerId: run.ownerId, runId: run.runId });
      return { ok: true, value: null };
    } catch (error) {
      dependencies.logger({ event: "knowledge-workflow-cleanup-failure", ownerId: run.ownerId, runId: run.runId, failureKind: "WorkflowCleanupFailed" });
      return { ok: false, error: { kind: "WorkflowCleanupFailed" } };
    }
  }

  return Object.freeze({
    /** @param {{ readonly run: KnowledgeWorkflowRun, readonly reason: string }} command @returns {Promise<Result<null, { readonly kind: "WorkflowCleanupFailed" }>>} */
    abandonRun: (command) => {
      if (!record(command) || !record(command.run) || !text(command.reason) || !text(command.run.ownerId) || !text(command.run.runId)) return Promise.resolve({ ok: false, error: { kind: "WorkflowCleanupFailed" } });
      return purgeRun(/** @type {KnowledgeWorkflowRun} */ (command.run), command.reason, false);
    },
  /** @param {{ readonly ownerId: string, readonly sourceId: string, readonly sourceRevision?: number, readonly canonicalSourceIdentity?: string, readonly reason: string }} command @returns {Promise<Result<null, { readonly kind: "WorkflowCleanupFailed" }>>} */
    async revokeSource(command) {
      if (!record(command) || !text(command.ownerId) || !text(command.sourceId) || (command.sourceRevision !== undefined && !positiveInteger(command.sourceRevision)) || !text(command.reason)) return { ok: false, error: { kind: "WorkflowCleanupFailed" } };
      const listed = await dependencies.workflowRepository.listBySource(command.ownerId, command.sourceId, command.sourceRevision);
      if (!listed.ok) return { ok: false, error: { kind: "WorkflowCleanupFailed" } };
      for (const run of listed.value) {
        const purged = await purgeRun(run, command.reason, run.state !== "abandoned");
        if (!purged.ok) return purged;
      }
      if (dependencies.sourceContent !== undefined) {
        const sourceContent = await dependencies.sourceContent.purge({ ownerId: command.ownerId, sourceId: command.sourceId, ...(command.sourceRevision === undefined ? {} : { sourceRevision: command.sourceRevision }) });
        if (!sourceContent.ok) return { ok: false, error: { kind: "WorkflowCleanupFailed" } };
      }
      const canonical = text(command.canonicalSourceIdentity) ? command.canonicalSourceIdentity : listed.value[0]?.canonicalSourceIdentity;
      if (canonical !== undefined) {
        const invalidated = await dependencies.workflowRepository.invalidateReuse({ canonicalSourceIdentity: canonical, sourceRevision: command.sourceRevision });
        if (!invalidated.ok) return { ok: false, error: { kind: "WorkflowCleanupFailed" } };
      }
      return { ok: true, value: null };
    },
  });
}

export {};
