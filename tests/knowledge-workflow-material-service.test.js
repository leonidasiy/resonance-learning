// @ts-check

import { createKnowledgeWorkflowMaterialService } from "../src/features/knowledge-workflows/material-service.js";
import { D1KnowledgeWorkflowMaterialRepository } from "../worker/knowledge-workflow-material-d1.js";

/** @import { StoredMaterial } from "../src/features/knowledge-workflows/material-service.js" */

function input(overrides = {}) {
  return {
    ownerId: "owner-a", runId: "run-a", sourceId: "source-a", sourceRevision: 1,
    sourceUrl: "https://example.test/learn", mediaType: "text/plain", fileName: "notes.txt",
    bytes: new TextEncoder().encode("A specific concept."), idempotencyKey: "material-a",
    rightsAttestation: { ownsOrPermitted: true, storageAllowed: true, transformationAllowed: true, processingAllowed: true, basis: "learner-provided copy", reference: "https://example.test/permission" },
    ...overrides,
  };
}

/** @param {Uint8Array} bytes */
async function digest(bytes) { return `sha256:${Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).map(byte => byte.toString(16).padStart(2, "0")).join("")}`; }

/** @param {Record<string, unknown>} [run] @param {{ readonly kind: string } | Error | null} [statusFailure] */
function fixture(run = {}, statusFailure = null) {
  /** @type {Map<string, StoredMaterial>} */ const records = new Map();
  /** @type {string[]} */ const staged = [];
  /** @type {string[]} */ const removed = [];
  /** @type {unknown[]} */ const attached = [];
  const service = createKnowledgeWorkflowMaterialService({
    parser: (command) => import("../src/features/knowledge-workflows/material.js").then((module) => module.parseAuthorizedMaterial(command, { digest, maximumBytes: 10_000, maximumCharacters: 10_000 })),
    repository: {
      async replay(ownerId, idempotencyKey) { const value = records.get(`${ownerId}:${idempotencyKey}`); return { ok: true, value: value ?? null }; },
      async persist(record) { records.set(`${record.ownerId}:${record.idempotencyKey}`, record); return { ok: true, value: null }; },
      async remove(record) { records.delete(`${record.ownerId}:${record.idempotencyKey}`); return { ok: true, value: null }; },
    },
    contentStore: {
      async stage(command) { staged.push(command.objectId); return { ok: true, value: { objectKey: `source-content/${command.objectId}` } }; },
      async remove(key) { removed.push(key); return { ok: true, value: null }; },
    },
    workflow: {
      async status(command) { if (statusFailure instanceof Error) throw statusFailure; return statusFailure === null ? { ok: true, value: { ownerId: "owner-a", runId: command.runId, sourceId: "source-a", sourceRevision: 1, canonicalSourceIdentity: "https://example.test/learn", state: "awaiting-upload", ...run } } : { ok: false, error: statusFailure }; },
      async attachMaterial(command) { attached.push(command); return { ok: true, value: { runId: command.runId, state: "extraction-loop" } }; },
    },
    createId: () => "id-a",
    now: () => "2026-08-17T00:00:00.000Z",
    logger: () => {},
  });
  return { service, records, staged, removed, attached };
}

/** @param {import("../src/features/knowledge-workflows/material.js").AuthorizedMaterial} material */
function fingerprint(material) {
 return JSON.stringify([material.ownerId, material.runId, material.sourceId, material.sourceRevision, material.mode, material.mediaType, material.fileName, material.contentDigest, material.provenance]);
}

Deno.test("legacy material replay preserves persisted authorization without a checkbox", async () => {
 const f = fixture(); const created = await f.service.upload(input()); if (!created.ok) throw new Error(created.error.kind);
 const stored = f.records.get("owner-a:material-a"); if (!stored) throw new Error("Missing fixture record.");
 const material = { ...stored.material, provenance: { kind: /** @type {const} */("authorized-user-material"), attestationReference: "legacy-grant", basis: "text:learner-provided copy", processingAllowed: /** @type {const} */(true) } };
 const legacy = { ...stored, material, fingerprint: fingerprint(material) }; f.records.set("owner-a:material-a", legacy);
 for (const rightsAttestation of [undefined, input().rightsAttestation]) {
  const replay = await f.service.upload(input({ rightsAttestation }));
  if (!replay.ok || !replay.value.reused) throw new Error(replay.ok ? "Replay was not reused." : replay.error.kind);
 }
 if (f.records.get("owner-a:material-a") !== legacy || f.staged.length !== 1) throw new Error("Replay rewrote history or bytes.");
 for (const change of [{ bytes: new TextEncoder().encode("B specific concept.") }, { fileName: "other.txt" }, { mode: "image" }, { runId: "run-b" }, { ownerId: "owner-b" }, { sourceId: "source-b" }, { sourceRevision: 2 }, { sourceUrl: "https://example.test/other" }]) {
  const result = await f.service.upload(input(change));
  if (result.ok) throw new Error("Different material replay accepted.");
 }
});

Deno.test("legacy material replay verifies D1 provenance projection and terminal reuse", async () => {
 const run = { state: "awaiting-upload" }; const f = fixture(run);
 const result = await f.service.upload(input()); if (!result.ok) throw new Error(result.error.kind);
 const stored = f.records.get("owner-a:material-a"); if (!stored) throw new Error("Missing record.");
 const material = { ...stored.material, provenance: { ...stored.material.provenance, basis: "text:legacy grant", attestationReference: "legacy-reference" } };
 const row = { material_id: stored.materialId, command_fingerprint: fingerprint(material), object_key: stored.objectKey, material_json: JSON.stringify(material), created_at: stored.createdAt };
 const repository = new D1KnowledgeWorkflowMaterialRepository({ database: { prepare() { return { bind() { return this; }, async first() { return row; }, async run() { return { success: true, meta: { changes: 1 } }; } }; } }, logger: () => {} });
 const projected = await repository.replay("owner-a", "material-a"); if (!projected.ok || !projected.value) throw new Error("D1 projection unavailable.");
 if (projected.value.material.provenance.processingAllowed !== undefined) throw new Error("Fixture must exercise the historical D1 projection.");
 const legacy = { ...stored, ...projected.value }; f.records.set("owner-a:material-a", legacy); run.state = "completed";
 const replay = await f.service.upload(input({ rightsAttestation: undefined }));
 if (!replay.ok || !replay.value.reused || f.staged.length !== 1 || f.attached.length !== 1 || f.records.get("owner-a:material-a") !== legacy) throw new Error("Terminal D1 replay changed history or storage.");
 for (const fingerprint of ["{malformed", "[]", JSON.stringify([material.ownerId, material.runId])]) {
  f.records.set("owner-a:material-a", { ...legacy, fingerprint });
  const corrupt = await f.service.upload(input({ rightsAttestation: undefined }));
  if (corrupt.ok || corrupt.error.kind !== "WorkflowMaterialIdempotencyConflict") throw new Error("Malformed fingerprint accepted.");
 }
});

Deno.test("legacy material replay rejects corrupt provenance and fingerprints", async () => {
 for (const provenance of [{ kind: "authorized-user-material", attestationReference: "", basis: "text:legacy", processingAllowed: true }, { kind: "authorized-user-material", attestationReference: "legacy", basis: "text:legacy", processingAllowed: false }]) {
  const f = fixture(); await f.service.upload(input()); const stored = f.records.get("owner-a:material-a"); if (!stored) throw new Error("Missing record.");
  // Persisted rows are an external boundary; deliberately inject malformed data.
  const material = { ...stored.material, provenance }; const corrupt = JSON.parse(JSON.stringify({ ...stored, material, fingerprint: fingerprint(stored.material) }));
  f.records.set("owner-a:material-a", corrupt);
  const result = await f.service.upload(input({ rightsAttestation: undefined }));
  if (result.ok || result.error.kind !== "WorkflowMaterialIdempotencyConflict") throw new Error("Corrupt legacy replay accepted.");
 }
});

Deno.test("material service stages, records, and attaches authorized text without logging content", async () => {
  const fixtureValue = fixture();
  const result = await fixtureValue.service.upload(input());
  if (!result.ok) throw new Error(result.error.kind);
  if (result.value.status !== "attached" || fixtureValue.staged.length !== 1 || fixtureValue.attached.length !== 1) throw new Error("Expected material attachment.");
  const replay = await fixtureValue.service.upload(input());
  if (!replay.ok || !replay.value.reused) throw new Error("Expected idempotent material replay.");
});

Deno.test("material service refuses an idempotency conflict and cleans up failed attachment", async () => {
  const fixtureValue = fixture();
  const first = await fixtureValue.service.upload(input());
  if (!first.ok) throw new Error(first.error.kind);
  const conflict = await fixtureValue.service.upload(input({ bytes: new TextEncoder().encode("different") }));
  if (conflict.ok || conflict.error.kind !== "WorkflowMaterialIdempotencyConflict") throw new Error("Expected material idempotency conflict.");
});

Deno.test("material service accepts a matching idempotent replay after workflow progress", async () => {
  const run = { state: "awaiting-upload" };
  const fixtureValue = fixture(run);
  const first = await fixtureValue.service.upload(input());
  if (!first.ok) throw new Error(first.error.kind);
  run.state = "completed";
  const replay = await fixtureValue.service.upload(input());
  if (!replay.ok || !replay.value.reused || fixtureValue.staged.length !== 1 || fixtureValue.attached.length !== 1) throw new Error("Expected terminal idempotent replay without restaging or reattachment.");
});

for (const [label, command, run] of [
  ["owner", input({ ownerId: "owner-b" }), { ownerId: "owner-a" }],
  ["source", input({ sourceId: "source-b" }), { sourceId: "source-a" }],
  ["revision", input({ sourceRevision: 2 }), { sourceRevision: 1 }],
  ["canonical URL", input({ sourceUrl: "https://example.test/other" }), { canonicalSourceIdentity: "https://example.test/learn" }],
]) {
  Deno.test(`material service rejects a mismatched ${label} before storage`, async () => {
    const fixtureValue = fixture(/** @type {Record<string, unknown>} */ (run));
    const result = await fixtureValue.service.upload(command);
    if (result.ok || result.error.kind !== "WorkflowMaterialBindingInvalid") throw new Error("Expected binding failure.");
    if (fixtureValue.staged.length !== 0 || fixtureValue.records.size !== 0 || fixtureValue.attached.length !== 0) throw new Error("Mismatched material must not change the run or storage.");
  });
}

Deno.test("material service preserves a typed workflow status failure before storage", async () => {
  const fixtureValue = fixture({}, { kind: "WorkflowPersistenceFailed" });
  const result = await fixtureValue.service.upload(input());
  if (result.ok || result.error.kind !== "WorkflowMaterialStatusFailed" || result.error.cause !== "WorkflowPersistenceFailed") throw new Error("Expected status failure.");
  if (fixtureValue.staged.length !== 0) throw new Error("Status failure must not stage material.");
});

Deno.test("material service converts a rejected workflow status to a typed failure before storage", async () => {
  const fixtureValue = fixture({}, new TypeError("unavailable"));
  const result = await fixtureValue.service.upload(input());
  if (result.ok || result.error.kind !== "WorkflowMaterialStatusFailed" || result.error.cause !== "TypeError") throw new Error("Expected caught status failure.");
  if (fixtureValue.staged.length !== 0 || fixtureValue.records.size !== 0 || fixtureValue.attached.length !== 0) throw new Error("Rejected status must not change storage or the run.");
});

for (const [label, run] of [
  ["run", { runId: "run-b" }],
  ["canonical URL", { canonicalSourceIdentity: "not-a-url" }],
  ["state", { state: "completed" }],
]) {
  Deno.test(`material service rejects invalid ${label} status before storage`, async () => {
    const fixtureValue = fixture(/** @type {Record<string, unknown>} */ (run));
    const result = await fixtureValue.service.upload(input());
    const expected = label === "state" ? "WorkflowMaterialStateInvalid" : "WorkflowMaterialBindingInvalid";
    if (result.ok || result.error.kind !== expected) throw new Error("Expected typed status rejection.");
    if (fixtureValue.staged.length !== 0 || fixtureValue.records.size !== 0 || fixtureValue.attached.length !== 0) throw new Error("Invalid status must not change storage or the run.");
  });
}

Deno.test("one-point material replay preserves the option and rejects changing it under the same key", async () => {
  const {service}=fixture();
  const first=await service.upload(input({oneKnowledgePointOnly:true}));if(!first.ok)throw new Error("One-point upload attaches.");
  const replay=await service.upload(input({oneKnowledgePointOnly:true}));if(!replay.ok||!replay.value.reused)throw new Error("Identical one-point request reuses durable material.");
  const changed=await service.upload(input({oneKnowledgePointOnly:false}));if(changed.ok||changed.error.kind!=="WorkflowMaterialIdempotencyConflict")throw new Error("Cardinality is part of upload identity.");
});
