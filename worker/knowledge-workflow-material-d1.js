// @ts-check

import { isRecord } from "../src/features/source-library/contracts.js";

/** @import { StoredMaterial } from "../src/features/knowledge-workflows/material-service.js" */
/** @import { AuthorizedMaterial, MaterialMedia, MaterialSection } from "../src/features/knowledge-workflows/material.js" */

/** @typedef {{ readonly success: boolean, readonly meta?: { readonly changes?: number } }} D1Result */
/** @typedef {{ readonly bind: (...values: readonly (string | number | null)[]) => D1Statement, readonly first: () => Promise<unknown | null>, readonly run: () => Promise<D1Result> }} D1Statement */
/** @typedef {{ readonly prepare: (query: string) => D1Statement }} D1DatabasePort */
/** @typedef {{ readonly event: string, readonly ownerId?: string, readonly runId?: string, readonly failureKind?: string }} MaterialD1Log */

/** @param {unknown} value @returns {value is string} */
function text(value) { return typeof value === "string" && value.trim() !== ""; }
/** @param {unknown} value @returns {value is number} */
function positiveInteger(value) { return typeof value === "number" && Number.isSafeInteger(value) && value > 0; }
/** @param {D1Result} result @returns {boolean} */
function changed(result) { return result.success === true && result.meta?.changes === 1; }

/** @param {unknown} value @returns {AuthorizedMaterial | null} */
function parseMaterial(value) {
  if (!isRecord(value) || !text(value.ownerId) || !text(value.runId) || !text(value.sourceId) || !positiveInteger(value.sourceRevision) || !text(value.sourceUrl) || !text(value.mediaType) || !text(value.fileName) || (value.mode !== undefined && value.mode !== "text" && value.mode !== "image") || !text(value.contentDigest) || !isRecord(value.provenance) || value.provenance.kind !== "authorized-user-material" || !text(value.provenance.attestationReference) || !text(value.provenance.basis) || !Array.isArray(value.sections) || !Array.isArray(value.media)) return null;
  if(value.oneKnowledgePointOnly !== undefined && typeof value.oneKnowledgePointOnly !== "boolean")return null;
  const sections = [];
  for (const section of value.sections) {
    if (!isRecord(section) || !text(section.id) || !text(section.title) || typeof section.text !== "string" || !text(section.locator)) return null;
    sections.push(Object.freeze({ id: section.id, title: section.title, text: section.text, locator: section.locator }));
  }
  const media = [];
  for (const entry of value.media) {
    if (!isRecord(entry) || !text(entry.path) || !text(entry.mediaType)) return null;
    if (entry.url !== undefined && (typeof entry.url !== "string" || !URL.canParse(entry.url) || new URL(entry.url).protocol !== "https:" || [entry.caption, entry.alt, entry.context].some(value => typeof value !== "string"))) return null;
    media.push(Object.freeze({ path: entry.path, mediaType: entry.mediaType, bytes: new Uint8Array(), ...(entry.url === undefined ? {} : { url: entry.url, caption: /** @type {string} */(entry.caption), alt: /** @type {string} */(entry.alt), context: /** @type {string} */(entry.context) }) }));
  }
  return Object.freeze({ ownerId: value.ownerId, runId: value.runId, sourceId: value.sourceId, sourceRevision: value.sourceRevision, sourceUrl: value.sourceUrl, mediaType: value.mediaType, fileName: value.fileName, mode: value.mode === "image" ? "image" : "text", contentDigest: value.contentDigest, ...(value.oneKnowledgePointOnly ? {oneKnowledgePointOnly:true} : {}), sections: Object.freeze(sections), media: Object.freeze(media), provenance: Object.freeze({ kind: "authorized-user-material", attestationReference: value.provenance.attestationReference, basis: value.provenance.basis }) });
}

export class D1KnowledgeWorkflowMaterialRepository {
  /** @type {D1DatabasePort} */ #database;
  /** @type {(entry: MaterialD1Log) => void} */ #logger;

  /** @param {{ readonly database: D1DatabasePort, readonly logger: (entry: MaterialD1Log) => void }} dependencies */
  constructor(dependencies) {
    if (typeof dependencies?.database?.prepare !== "function" || typeof dependencies.logger !== "function") throw new TypeError("D1 workflow-material dependencies are invalid.");
    this.#database = dependencies.database;
    this.#logger = dependencies.logger;
  }

  /** @param {string} ownerId @param {string} idempotencyKey @returns {Promise<{ readonly ok: true, readonly value: { readonly fingerprint: string, readonly materialId: string, readonly objectKey: string, readonly material: AuthorizedMaterial, readonly createdAt: string } | null } | { readonly ok: false, readonly error: { readonly kind: "WorkflowMaterialPersistenceFailed" } }>} */
  async replay(ownerId, idempotencyKey) {
    try {
      const row = await this.#database.prepare("SELECT command_fingerprint, material_id, object_key, material_json, created_at FROM knowledge_workflow_materials WHERE owner_id = ? AND idempotency_key = ? LIMIT 1").bind(ownerId, idempotencyKey).first();
      if (row === null) return { ok: true, value: null };
      if (!isRecord(row) || !text(row.command_fingerprint) || !text(row.material_id) || !text(row.object_key) || !text(row.material_json) || !text(row.created_at)) return { ok: false, error: { kind: "WorkflowMaterialPersistenceFailed" } };
      const material = parseMaterial(JSON.parse(row.material_json));
      return material === null ? { ok: false, error: { kind: "WorkflowMaterialPersistenceFailed" } } : { ok: true, value: Object.freeze({ fingerprint: row.command_fingerprint, materialId: row.material_id, objectKey: row.object_key, material, createdAt: row.created_at }) };
    } catch (error) {
      this.#logger({ event: "knowledge-workflow-material-d1-failure", ownerId, failureKind: "WorkflowMaterialPersistenceFailed" });
      return { ok: false, error: { kind: "WorkflowMaterialPersistenceFailed" } };
    }
  }

  /** @param {StoredMaterial} record @returns {Promise<{ readonly ok: true, readonly value: null } | { readonly ok: false, readonly error: { readonly kind: "WorkflowMaterialPersistenceFailed" } }>} */
  async persist(record) {
    try {
      const result = await this.#database.prepare("INSERT INTO knowledge_workflow_materials (owner_id, material_id, run_id, source_id, source_revision, idempotency_key, command_fingerprint, object_key, content_digest, media_type, file_name, material_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(record.ownerId, record.materialId, record.runId, record.material.sourceId, record.material.sourceRevision, record.idempotencyKey, record.fingerprint, record.objectKey, record.material.contentDigest, record.material.mediaType, record.material.fileName, JSON.stringify(record.material), record.createdAt).run();
      if (!changed(result)) return { ok: false, error: { kind: "WorkflowMaterialPersistenceFailed" } };
      this.#logger({ event: "knowledge-workflow-material-d1-success", ownerId: record.ownerId, runId: record.runId });
      return { ok: true, value: null };
    } catch (error) {
      this.#logger({ event: "knowledge-workflow-material-d1-failure", ownerId: record.ownerId, runId: record.runId, failureKind: "WorkflowMaterialPersistenceFailed" });
      return { ok: false, error: { kind: "WorkflowMaterialPersistenceFailed" } };
    }
  }

  /** @param {StoredMaterial} record @returns {Promise<{ readonly ok: true, readonly value: null } | { readonly ok: false, readonly error: { readonly kind: "WorkflowMaterialPersistenceFailed" } }>} */
  async remove(record) {
    try {
      const result = await this.#database.prepare("DELETE FROM knowledge_workflow_materials WHERE owner_id = ? AND material_id = ?").bind(record.ownerId, record.materialId).run();
      return result.success === true ? { ok: true, value: null } : { ok: false, error: { kind: "WorkflowMaterialPersistenceFailed" } };
    } catch (error) {
      this.#logger({ event: "knowledge-workflow-material-d1-failure", ownerId: record.ownerId, runId: record.runId, failureKind: "WorkflowMaterialPersistenceFailed" });
      return { ok: false, error: { kind: "WorkflowMaterialPersistenceFailed" } };
    }
  }

  /** @param {string} ownerId @param {string} runId @returns {Promise<{ readonly ok: true, readonly value: StoredMaterial | null } | { readonly ok: false, readonly error: { readonly kind: "WorkflowMaterialPersistenceFailed" } }>} */
  async read(ownerId, runId) {
    try {
      const row = await this.#database.prepare("SELECT material_id, idempotency_key, command_fingerprint, object_key, material_json, created_at FROM knowledge_workflow_materials WHERE owner_id = ? AND run_id = ? ORDER BY created_at DESC, material_id DESC LIMIT 1").bind(ownerId, runId).first();
      if (row === null) return { ok: true, value: null };
      if (!isRecord(row) || !text(row.material_id) || !text(row.idempotency_key) || !text(row.command_fingerprint) || !text(row.object_key) || !text(row.material_json) || !text(row.created_at)) return { ok: false, error: { kind: "WorkflowMaterialPersistenceFailed" } };
      const material = parseMaterial(JSON.parse(row.material_json));
      return material === null ? { ok: false, error: { kind: "WorkflowMaterialPersistenceFailed" } } : { ok: true, value: Object.freeze({ materialId: row.material_id, ownerId, runId, idempotencyKey: row.idempotency_key, fingerprint: row.command_fingerprint, objectKey: row.object_key, material, createdAt: row.created_at }) };
    } catch (error) {
      this.#logger({ event: "knowledge-workflow-material-d1-failure", ownerId, runId, failureKind: "WorkflowMaterialPersistenceFailed" });
      return { ok: false, error: { kind: "WorkflowMaterialPersistenceFailed" } };
    }
  }
}

export {};
