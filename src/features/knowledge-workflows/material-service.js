// @ts-check

/** @template T, E @typedef {{ readonly ok: true, readonly value: T } | { readonly ok: false, readonly error: E }} Result */
/** @typedef {import("./material.js").AuthorizedMaterial} AuthorizedMaterial */
/** @typedef {import("./material.js").MaterialFailure} MaterialFailure */

/** @typedef {{ readonly materialId: string, readonly ownerId: string, readonly runId: string, readonly idempotencyKey: string, readonly fingerprint: string, readonly objectKey: string, readonly material: AuthorizedMaterial, readonly createdAt: string }} StoredMaterial */
/** @typedef {{ readonly fingerprint: string, readonly materialId: string, readonly objectKey: string, readonly material: AuthorizedMaterial, readonly createdAt: string }} MaterialReplay */
/** @typedef {{ readonly kind: "WorkflowMaterialCommandInvalid", readonly field: string } | { readonly kind: "WorkflowMaterialBindingInvalid" } | { readonly kind: "WorkflowMaterialStatusFailed", readonly cause: string } | { readonly kind: "WorkflowMaterialStateInvalid", readonly state: string } | { readonly kind: "WorkflowMaterialIdempotencyConflict" } | { readonly kind: "WorkflowMaterialPersistenceFailed" } | { readonly kind: "WorkflowMaterialStorageFailed" } | { readonly kind: "WorkflowMaterialCleanupFailed" } | { readonly kind: "WorkflowMaterialAttachFailed" } | MaterialFailure } MaterialServiceFailure */
/** @typedef {{ readonly status: "attached", readonly materialId: string, readonly runId: string, readonly reused: boolean }} MaterialUploadResult */

const freeze = Object.freeze;

/** @param {unknown} value @returns {value is string} */
function text(value) { return typeof value === "string" && value.trim() !== ""; }
/** @param {unknown} value @returns {value is number} */
function positiveInteger(value) { return typeof value === "number" && Number.isSafeInteger(value) && value > 0; }
/** @param {unknown} value @returns {value is Record<string, unknown>} */
function record(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }

/** @param {AuthorizedMaterial} material @returns {string} */
function materialFingerprint(material) {
  return JSON.stringify([material.ownerId, material.runId, material.sourceId, material.sourceRevision, material.mode, material.mediaType, material.fileName, material.contentDigest, material.provenance, ...(material.oneKnowledgePointOnly ? [true] : [])]);
}

/** @param {MaterialReplay} replay @param {AuthorizedMaterial} material @returns {boolean} */
function replayMatches(replay, material) {
  let fields;
  try { fields = JSON.parse(replay.fingerprint); }
  catch (error) { if (error instanceof SyntaxError) return false; throw error; }
  if (!Array.isArray(fields) || (fields.length !== 9 && fields.length !== 10)) return false;
  const provenance = fields[8];
  const stored = replay.material.provenance;
  if (!record(provenance) || provenance.kind !== "authorized-user-material" || !text(provenance.attestationReference) || !text(provenance.basis) ||
    (provenance.processingAllowed !== undefined && provenance.processingAllowed !== true) ||
    Object.keys(provenance).some(key => !["kind", "attestationReference", "basis", "processingAllowed"].includes(key)) ||
    !record(stored) || stored.kind !== provenance.kind || stored.attestationReference !== provenance.attestationReference || stored.basis !== provenance.basis ||
    (stored.processingAllowed !== undefined && stored.processingAllowed !== true) ||
    (stored.processingAllowed === true && provenance.processingAllowed !== true) || replay.material.sourceUrl !== material.sourceUrl) return false;
  // D1's legacy projection omits processingAllowed; verify it in the recorded fingerprint.
  const authorization = { kind: /** @type {const} */("authorized-user-material"), attestationReference: provenance.attestationReference, basis: provenance.basis, ...(provenance.processingAllowed === true ? { processingAllowed: /** @type {const} */(true) } : {}) };
  return replay.fingerprint === materialFingerprint({ ...replay.material, provenance: authorization }) &&
    replay.fingerprint === materialFingerprint({ ...material, provenance: authorization });
}

/** @param {{ readonly parser: (command: unknown) => Promise<Result<AuthorizedMaterial, MaterialFailure>>, readonly repository: { readonly replay: (ownerId: string, idempotencyKey: string) => Promise<Result<MaterialReplay | null, MaterialServiceFailure>>, readonly persist: (record: StoredMaterial) => Promise<Result<null, MaterialServiceFailure>>, readonly remove: (record: StoredMaterial) => Promise<Result<null, MaterialServiceFailure>> }, readonly contentStore: { readonly stage: (command: { readonly objectId: string, readonly ownerId: string, readonly sourceId: string, readonly itemId: string, readonly itemVersionId: string, readonly content: Uint8Array, readonly contentDigest: string, readonly mediaType: string }) => Promise<Result<{ readonly objectKey: string }, MaterialServiceFailure>>, readonly remove: (key: string) => Promise<Result<null, MaterialServiceFailure>> }, readonly workflow: { readonly status: (command: { readonly ownerId: string, readonly runId: string }) => Promise<Result<{ readonly ownerId: string, readonly runId: string, readonly sourceId: string, readonly sourceRevision: number, readonly canonicalSourceIdentity: string, readonly state: string }, { readonly kind: string }>>, readonly attachMaterial: (command: { readonly ownerId: string, readonly runId: string, readonly materialId: string }) => Promise<Result<unknown, { readonly kind: string }>> }, readonly createId: () => string, readonly now: () => string, readonly logger: (entry: { readonly event: string, readonly ownerId?: string, readonly runId?: string, readonly failureKind?: string }) => void }} dependencies */
export function createKnowledgeWorkflowMaterialService(dependencies) {
  if (typeof dependencies?.parser !== "function" || typeof dependencies.repository?.replay !== "function" || typeof dependencies.repository.persist !== "function" || typeof dependencies.repository.remove !== "function" || typeof dependencies.contentStore?.stage !== "function" || typeof dependencies.contentStore.remove !== "function" || typeof dependencies.workflow?.status !== "function" || typeof dependencies.workflow.attachMaterial !== "function" || typeof dependencies.createId !== "function" || typeof dependencies.now !== "function" || typeof dependencies.logger !== "function") throw new TypeError("Knowledge workflow material dependencies are invalid.");
  return Object.freeze({
    /** @param {unknown} command @returns {Promise<Result<MaterialUploadResult, MaterialServiceFailure>>} */
    async upload(command) {
      if (!record(command) || !text(command.ownerId)) return { ok: false, error: { kind: "WorkflowMaterialCommandInvalid", field: "ownerId" } };
      const ownerId = command.ownerId.trim();
      dependencies.logger({ event: "knowledge-workflow-material-entry", ownerId });
      const parsed = await dependencies.parser(command);
      if (!parsed.ok) {
        dependencies.logger({ event: "knowledge-workflow-material-failure", ownerId, failureKind: parsed.error.kind });
        return parsed;
      }
      const material = parsed.value;
      let run;
      try {
        run = await dependencies.workflow.status({ ownerId: material.ownerId, runId: material.runId });
      } catch (error) {
        const cause = error instanceof Error ? error.name : "UnknownStatusFailure";
        dependencies.logger({ event: "knowledge-workflow-material-failure", ownerId: material.ownerId, runId: material.runId, failureKind: "WorkflowMaterialStatusFailed" });
        return { ok: false, error: { kind: "WorkflowMaterialStatusFailed", cause } };
      }
      if (!run.ok) {
        dependencies.logger({ event: "knowledge-workflow-material-failure", ownerId: material.ownerId, runId: material.runId, failureKind: run.error.kind });
        return { ok: false, error: { kind: "WorkflowMaterialStatusFailed", cause: run.error.kind } };
      }
      let canonicalSourceIdentity;
      try { canonicalSourceIdentity = new URL(run.value.canonicalSourceIdentity).href; } catch (error) { canonicalSourceIdentity = null; }
      if (run.value.ownerId !== material.ownerId || run.value.runId !== material.runId || run.value.sourceId !== material.sourceId || run.value.sourceRevision !== material.sourceRevision || canonicalSourceIdentity !== material.sourceUrl) {
        dependencies.logger({ event: "knowledge-workflow-material-failure", ownerId: material.ownerId, runId: material.runId, failureKind: "WorkflowMaterialBindingInvalid" });
        return { ok: false, error: { kind: "WorkflowMaterialBindingInvalid" } };
      }
      if (!text(command.idempotencyKey)) return { ok: false, error: { kind: "WorkflowMaterialCommandInvalid", field: "idempotencyKey" } };
      const idempotencyKey = command.idempotencyKey.trim();
      const replay = await dependencies.repository.replay(material.ownerId, idempotencyKey);
      if (!replay.ok) return replay;
      const fingerprint = materialFingerprint(material);
      if (replay.value !== null) {
        if (!replayMatches(replay.value, material)) return { ok: false, error: { kind: "WorkflowMaterialIdempotencyConflict" } };
        if (run.value.state === "completed" || run.value.state === "abandoned") {
          return { ok: true, value: freeze({ status: "attached", materialId: replay.value.materialId, runId: material.runId, reused: true }) };
        }
        const attachedReplay = await dependencies.workflow.attachMaterial({ ownerId: material.ownerId, runId: material.runId, materialId: replay.value.materialId });
        if (!attachedReplay.ok) return { ok: false, error: { kind: "WorkflowMaterialAttachFailed" } };
        return { ok: true, value: freeze({ status: "attached", materialId: replay.value.materialId, runId: material.runId, reused: true }) };
      }
      if (run.value.state !== "awaiting-upload") {
        dependencies.logger({ event: "knowledge-workflow-material-failure", ownerId: material.ownerId, runId: material.runId, failureKind: "WorkflowMaterialStateInvalid" });
        return { ok: false, error: { kind: "WorkflowMaterialStateInvalid", state: run.value.state } };
      }
      const createdAt = dependencies.now();
      if (!text(createdAt) || !Number.isFinite(Date.parse(createdAt))) throw new TypeError("Knowledge workflow material clock returned an invalid timestamp.");
      const materialId = `material:${dependencies.createId()}`;
      if (!text(materialId)) throw new TypeError("Knowledge workflow material identity is invalid.");
      let staged;
      try {
        staged = await dependencies.contentStore.stage({ objectId: materialId, ownerId: material.ownerId, sourceId: material.sourceId, itemId: material.runId, itemVersionId: String(material.sourceRevision), content: /** @type {Uint8Array} */ (command.bytes), contentDigest: material.contentDigest, mediaType: material.mediaType });
      } catch (error) {
        if (error instanceof Error) return { ok: false, error: { kind: "WorkflowMaterialStorageFailed" } };
        throw error;
      }
      if (!staged.ok) {
        dependencies.logger({ event: "knowledge-workflow-material-failure", ownerId: material.ownerId, runId: material.runId, failureKind: staged.error.kind });
        return { ok: false, error: { kind: "WorkflowMaterialStorageFailed" } };
      }
      const stored = freeze({ materialId, ownerId: material.ownerId, runId: material.runId, idempotencyKey, fingerprint, objectKey: staged.value.objectKey, material: freeze({ ...material, media: freeze(material.media.map((entry) => freeze({ ...entry, bytes: new Uint8Array() }))) }), createdAt });
      const persisted = await dependencies.repository.persist(stored);
      if (!persisted.ok) {
        const removed = await dependencies.contentStore.remove(staged.value.objectKey);
        return removed.ok ? persisted : { ok: false, error: { kind: "WorkflowMaterialCleanupFailed" } };
      }
      const attached = await dependencies.workflow.attachMaterial({ ownerId: material.ownerId, runId: material.runId, materialId });
      if (!attached.ok) {
        const removedRecord = await dependencies.repository.remove(stored);
        const removedObject = await dependencies.contentStore.remove(staged.value.objectKey);
        if (!removedRecord.ok || !removedObject.ok) return { ok: false, error: { kind: "WorkflowMaterialCleanupFailed" } };
        return { ok: false, error: { kind: "WorkflowMaterialAttachFailed" } };
      }
      dependencies.logger({ event: "knowledge-workflow-material-success", ownerId: material.ownerId, runId: material.runId });
      return { ok: true, value: freeze({ status: "attached", materialId, runId: material.runId, reused: false }) };
    },
  });
}

export {};
