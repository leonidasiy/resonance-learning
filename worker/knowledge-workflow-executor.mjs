// Shared executor keeps hosted and computer runs on the same persistence and control paths.
import {resolveModelApi} from "./model-api.js";
import {observeWorkflowDatabase} from './knowledge-workflow-database.js';
import { WEBPAGE_IMAGE_POLICY } from './webpage-image-budget.js';
import { D1KnowledgeWorkflowRepository } from "./knowledge-workflow-d1.js";
import { D1KnowledgeWorkflowMaterialRepository } from "./knowledge-workflow-material-d1.js";
import { createKnowledgeWorkflowService, isWorkflowRetryStage } from "../src/features/knowledge-workflows/workflow.js";
import { createKnowledgeWorkflowRuntime } from "./knowledge-workflow-runtime.js";
import { createAgentConfigurationLoader } from "../src/features/knowledge-workflows/config.js";
import { D1KnowledgeMediaRepository } from "./knowledge-workflow-media-d1.js";
import { createMediaPipeline, createMediaPublicEgress, createUserAttestedLocalManifest } from "../src/features/knowledge-workflows/media.js";
import { resolvePublicAddresses } from "./knowledge-workflow-network.js";
import { createCloudflareImageDerivative, createCloudflareImageDecoder, isCloudflareImageBinding } from "./knowledge-workflow-media-transform.js";
import { createKnowledgeWorkflowLogger } from "./knowledge-workflow-logging.js";
import { executeRetryingWorkflowStep, requiresWorkflowUpload, workflowExecutionFailure } from "./knowledge-workflow-step.js";
import { createAcquisitionClient, createAcquisitionWorkflowBrowser } from "./acquisition-client.js";
import { ACQUISITION_POLICY } from "./acquisition-policy.js";
import { createFirecrawlWorkflowBrowser } from "./firecrawl-browser.js";
import { createHybridBrowserBudget } from "./hybrid-browser-budget.js";
import { createOpenSourceImageSearch } from "./open-source-image-search.js";
import { createReminderRuntime } from "./reminders/runtime.js";
import { notifyKnowledgeWorkflowOutcome } from "./knowledge-workflow-notifications.js";
import fallbackMediaEntries from "../assets/fallback-media/manifest.json" with { type: "json" };

const roleNames = /** @type {const} */ (["rights-assessor", "knowledge-scraper", "question-generator", "question-evaluator"]);
const supportedTools = new Set([
  "rights-evidence.read",
  "browser.page.read",
  "browser.navigation.inspect",
  "browser.navigation.click",
  "browser.screenshot.capture",
  "extraction.frontier.observe",
  "extraction.knowledge.commit",
  "quiz.question.validate",
  "quiz.evidence.lookup",
  "quiz.duplicate.check",
]);

/** @param {unknown} value @param {string} currentTime @returns {boolean} */
function isAutomaticExtractionContinuation(value, currentTime) {
  if (typeof value !== "object" || value === null || Array.isArray(value) || value.state !== "awaiting-time-limit-decision" || !Number.isFinite(Date.parse(currentTime))) return false;
  if (!("run" in value) || typeof value.run !== "object" || value.run === null || Array.isArray(value.run)) return false;
  if (!("extractionDeadlineAt" in value.run) || typeof value.run.extractionDeadlineAt !== "string" || !Number.isFinite(Date.parse(value.run.extractionDeadlineAt))) return false;
  return Date.parse(currentTime) < Date.parse(value.run.extractionDeadlineAt);
}

/** @param {string} input @returns {Promise<string>} */
async function sha256(input) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/** @param {Readonly<Record<string, string>>} expected @returns {Promise<import("../src/features/knowledge-workflows/config.js").Result<Readonly<Record<import("../src/features/knowledge-workflows/memory.js").AgentRole, import("../src/features/knowledge-workflows/config.js").AgentConfigurationSnapshot>>, { readonly kind: string }>>} */
async function loadConfigurationSnapshots(expected, sources) {
  const loader = createAgentConfigurationLoader({ sha256, supportedTools });
  /** @type {Partial<Record<import("../src/features/knowledge-workflows/memory.js").AgentRole, import("../src/features/knowledge-workflows/config.js").AgentConfigurationSnapshot>>} */
  const snapshots = {};
  for (const role of roleNames) {
    const source = sources[role];
    const digest = expected[role];
    if (typeof source !== "string" || typeof digest !== "string") return { ok: false, error: { kind: "WorkflowConfigurationSnapshotInvalid" } };
    const loaded = await loader.load({ source, expectedRole: role, expectedDigest: digest });
    if (!loaded.ok) return { ok: false, error: { kind: loaded.error.kind } };
    snapshots[role] = loaded.value;
  }
  return { ok: true, value: Object.freeze(/** @type {Readonly<Record<import("../src/features/knowledge-workflows/memory.js").AgentRole, import("../src/features/knowledge-workflows/config.js").AgentConfigurationSnapshot>>} */ (snapshots)) };
}

/**
 * Cloudflare's Workflow runtime supplies the base class and step context. D1
 * remains authoritative; the Workflow result contains only bounded IDs and
 * lifecycle digests.
 */
export async function executeKnowledgeWorkflow(environment, event, step, sources, workerFetch = globalThis.fetch.bind(globalThis)) {
    const modelApi = resolveModelApi(environment);
    if (!modelApi.ok) throw new Error(`ModelApiConfigurationInvalid:${modelApi.error.field}`);
    const ai = modelApi.value;
    const payload = event?.payload;
    if (!payload || typeof payload !== "object" || Array.isArray(payload) ||
      typeof payload.runId !== "string" || payload.runId.trim() === "" ||
      typeof payload.ownerId !== "string" || payload.ownerId.trim() === "") {
      throw new TypeError("Knowledge workflow payload is invalid.");
    }
    const runId = payload.runId;
    const ownerId = payload.ownerId;
    let database = environment.SOURCE_LIBRARY_DB;
    if (!database || typeof database.prepare !== "function" || typeof database.batch !== "function") {
      throw new TypeError("Knowledge workflow database binding is unavailable.");
    }
    const bucket = environment.SOURCE_CONTENT_BUCKET;
    if (!bucket || typeof bucket.put !== "function" || typeof bucket.get !== "function" || typeof bucket.delete !== "function") throw new TypeError("Knowledge workflow media bucket binding is unavailable.");
    if (!isCloudflareImageBinding(environment.IMAGES)) throw new TypeError("Knowledge workflow image derivative binding is unavailable.");
    const now = () => new Date().toISOString();
    const logger = createKnowledgeWorkflowLogger({ sink: (record) => console.info(JSON.stringify(record)), now });
    database=observeWorkflowDatabase(database,entry=>logger({...entry,ownerId,runId}));
    const acquisition = createAcquisitionClient({
      binding: environment.PUBLIC_ACQUISITION,
      endpoint: environment.PUBLIC_ACQUISITION_ENDPOINT,
      token: environment.PUBLIC_ACQUISITION_TOKEN,
      policy: ACQUISITION_POLICY,
      createId: () => crypto.randomUUID(),
    });
    const browserLogger=(entry)=>logger({event:entry.event,ownerId,runId,stage:'browser',failureKind:entry.failureKind,diagnosticToken:entry.diagnosticToken,field:entry.operationStage??entry.stage,httpStatus:entry.httpStatus});
    // The owner's navigation test authorizes at most 100 provider credits; reservations persist across workflow steps.
    const browserBudget=createHybridBrowserBudget({database,ownerId,runId,maximumCredits:100,now,createId:()=>crypto.randomUUID(),logger:browserLogger});
    const createBrowser = () => {
      const acquisitionBrowser=createAcquisitionWorkflowBrowser({client:acquisition,policy:ACQUISITION_POLICY,logger:browserLogger});
      return createFirecrawlWorkflowBrowser({apiKey:typeof environment.FIRECRAWL_API_KEY==='string'?environment.FIRECRAWL_API_KEY:null,fetch:workerFetch,policy:ACQUISITION_POLICY,
        resolveAddresses:(hostname)=>resolvePublicAddresses(hostname,workerFetch),reserveSession:browserBudget.reserveSession,nowMs:()=>Date.now(),logger:browserLogger,
        readRobots:acquisitionBrowser.readRobots,closeRobots:acquisitionBrowser.close});
    };
    const mediaRepository = new D1KnowledgeMediaRepository({ database, bucket, logger: (entry) => logger({ event: entry.event, ownerId: entry.ownerId, stage: "media", failureKind: entry.failureKind }) });
    const publicEgress = createMediaPublicEgress(acquisition.mediaCapability);
    const fallbackManifest = createUserAttestedLocalManifest(fallbackMediaEntries);
    if (!fallbackManifest.ok) throw new Error(fallbackManifest.error.kind);
    const decodeImage=createCloudflareImageDecoder(environment.IMAGES,{logger:entry=>logger({...entry,ownerId,runId,stage:"media"})});
    const media = createMediaPipeline({
      publicEgress,
      digest: async (bytes) => {
        const digest = await crypto.subtle.digest("SHA-256", bytes);
        return { ok: true, value: `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}` };
      },
      quarantine: {
        put: async ({ key, bytes, mediaType }) => { try { await bucket.put(key, bytes, { httpMetadata: { contentType: mediaType } }); return { ok: true, value: null }; } catch (error) { if (error instanceof Error) return { ok: false, error: { kind: "MediaQuarantineFailed" } }; throw error; } },
        remove: async (key) => { try { await bucket.delete(key); return { ok: true, value: null }; } catch (error) { if (error instanceof Error) return { ok: false, error: { kind: "MediaCleanupFailed" } }; throw error; } },
      },
      derivatives: { create: createCloudflareImageDerivative(/** @type {import("./knowledge-workflow-media-transform.js").ImageBinding} */ (environment.IMAGES)) },
      repository: mediaRepository,
      createId: () => crypto.randomUUID(),
      now,
      logger: (entry) => logger({ event: entry.event, ownerId: entry.ownerId, stage: "media", failureKind: entry.failureKind }),
    });
    const imageSearch = createOpenSourceImageSearch({
      fetch: workerFetch,
      logger: (entry) => logger({ event: entry.event, ownerId, stage: "media", failureKind: entry.failureKind }),
    });
    const repository = new D1KnowledgeWorkflowRepository({
      database,
      logger,
    });
    const materialRepository = new D1KnowledgeWorkflowMaterialRepository({
      database,
      logger: (entry) => logger({ event: entry.event, runId: entry.runId, ownerId: entry.ownerId, stage: "material", failureKind: entry.failureKind }),
    });
    const materialContent = {
      read: async (materialOwnerId, objectKey, identity) => {
        if (typeof materialOwnerId !== "string" || materialOwnerId.trim() === "" || typeof objectKey !== "string" || !objectKey.startsWith("source-content/") || objectKey.includes("..")) return { ok: false, error: { kind: "WorkflowMaterialImageUnavailable" } };
        try {
          const object = await bucket.get(objectKey);
          if (object === null || object.customMetadata?.owner !== materialOwnerId || object.customMetadata?.source !== identity.sourceId || object.customMetadata?.item !== identity.runId || object.customMetadata?.version !== String(identity.sourceRevision) || object.customMetadata?.digest !== identity.digest) return { ok: false, error: { kind: "WorkflowMaterialImageUnavailable" } };
          return { ok: true, value: new Uint8Array(await object.arrayBuffer()) };
        } catch (error) {
          if (error instanceof Error) return { ok: false, error: { kind: "WorkflowMaterialImageUnavailable" } };
          throw error;
        }
      },
    };
    const service = createKnowledgeWorkflowService(repository, {
      now,
      createId: () => crypto.randomUUID(),
      logger: (entry) => logger({ event: entry.event, runId: entry.runId, ownerId: entry.ownerId, action: entry.action, failureKind: entry.failureKind }),
    });
    const notifications = createReminderRuntime({environment:environment,database,now:()=>new Date(),fetch:workerFetch,logger:(entry)=>console.info(JSON.stringify(entry))});
    const notifyOutcome = async (run) => {
      const delivered = await notifyKnowledgeWorkflowOutcome({run,now,notify:notifications.notifySource,load:()=>service.status({ownerId,runId})});
      if (!delivered.ok) logger({event:"knowledge-workflow-notification-failure",ownerId,runId,failureKind:delivered.error.kind});
      return delivered;
    };
    let current = await step.do("load knowledge workflow run", async () => service.status({ ownerId, runId }));
    if (!current.ok) throw new Error(current.error.kind);
    const configurations = await step.do("validate workflow role configurations", async () => loadConfigurationSnapshots(current.value.configDigests, sources));
    if (!configurations.ok) throw new Error(configurations.error.kind);
    const createRuntime = (executionAttempt = 1,cpuLimited = false) => createKnowledgeWorkflowRuntime({
      executionAttempt,cpuLimited,
      imagePolicy:WEBPAGE_IMAGE_POLICY,
      database,
      fetch: workerFetch,
      browser: createBrowser(),
      apiKey: ai.apiKey,
      endpoint: ai.endpoint,
      apiStyle:ai.apiStyle,
      gradingModel:ai.gradingModel ?? undefined,
      now,
      nowMs: () => Date.now(),
      logger: (entry) => logger({...entry,ownerId,runId}),
      configSnapshots: configurations.value,
      media,
      publicEgress,
      imageSearch,
      fallbackManifest: fallbackManifest.value,
      mediaBucket: bucket,
      reviewMedia: {readOriginal:(scope)=>mediaRepository.readOriginal(scope)},
      material: { read: (materialOwnerId, materialRunId) => materialRepository.read(materialOwnerId, materialRunId) },
      materialContent,
      decodeImage,
      resolveAddresses: (hostname) => resolvePublicAddresses(hostname, workerFetch),
      transition: (command) => service.advance({ ownerId: command.run.ownerId, runId: command.run.runId, expectedRevision: command.run.revision, nextState: command.nextState, ...(command.counts === undefined ? {} : { counts: command.counts }), ...(command.failureKind === undefined ? {} : { failureKind: command.failureKind }), ...(command.robotsEvidence === undefined ? {} : { robotsEvidence: command.robotsEvidence }) }),
    });
    const continueFromCheckpoint=run=>({runId,state:run.state,revision:run.revision,configDigests:run.configDigests,continuation:true});
    if (current.value.state === "source-added") {
      const assessed = await step.do("begin rights assessment", async () => service.advance({ ownerId, runId, expectedRevision: current.value.revision, nextState: "rights-assessment" }));
      if (!assessed.ok) throw new Error(assessed.error.kind);
      current = { ok: true, value: assessed.value };
    }
    if (current.value.state === "awaiting-rights-review") {
      await step.do(`notify rights decision ${current.value.revision}`, () => notifyOutcome(current.value));
      try {
        await step.waitForEvent("wait for rights approval", { type: "rights-approved", timeout: "24 hours" });
      } catch (error) {
        throw new Error("WorkflowRightsApprovalTimeout");
      }
      current = await step.do("reload after rights approval", async () => service.status({ ownerId, runId }));
      if (!current.ok) throw new Error(current.error.kind);
    }
    /** @param {string} stepName @returns {Promise<import("../src/features/knowledge-workflows/workflow.js").Result<unknown, { readonly kind: string, readonly detailKind?: string, readonly detailDiagnosticToken?: string }>>} */
    async function executeOrAwaitMaterial(stepName) {
      let executed;
      try {
      executed = await executeRetryingWorkflowStep({
        step,
        name: stepName,
        now: Date.now,
        load: () => service.status({ ownerId, runId }),
        execute: (authoritativeRun,executionAttempt,cpuLimited)=>createRuntime(executionAttempt,cpuLimited).execute(authoritativeRun),
      });
      } catch (error) {
        if (!(error instanceof Error)) throw error;
        executed = {ok:false,error:workflowExecutionFailure(error)};
      }
      if (executed.ok) return executed;
      const latest = await step.do(`${stepName}: reload after failure`, () => service.status({ ownerId, runId }));
      if (!latest.ok) throw new Error(latest.error.kind);
      const failureKind = executed.error.detailKind?.trim() || executed.error.kind;
      const category=executed.error.detailDiagnosticToken??executed.error.diagnosticToken;
      const diagnosticToken = typeof category === "string" && /^[a-z0-9-]+$/u.test(category) ? category : undefined;
      logger({ event: "knowledge-workflow-execution-failure", ownerId, runId, stage: "executor", failureKind, ...(diagnosticToken === undefined ? {} : { diagnosticToken }) });
      const persistedFailureKind = diagnosticToken === undefined ? failureKind : `${failureKind}:${diagnosticToken}`;
      const offerUpload = latest.value.materialId == null && latest.value.counts.knowledgePoints === 0 && requiresWorkflowUpload(executed.error);
      const retryable = !offerUpload;
      if (retryable && !isWorkflowRetryStage(latest.value.state)) throw new Error(executed.error.kind);
      const changed = await step.do(`persist workflow failure ${latest.value.revision}`, () => service.advance({ ownerId, runId, expectedRevision: latest.value.revision, nextState: retryable && !offerUpload ? "retryable-failure" : "awaiting-upload", failureKind: offerUpload ? `WorkflowExtractionFailed:${persistedFailureKind}` : persistedFailureKind }));
      if (!changed.ok) throw new Error(changed.error.kind);
      return { ok: true, value: { state: changed.value.state, run: changed.value } };
    }
    let executed = await executeOrAwaitMaterial("execute knowledge extraction and quiz stages");
    let result = executed.value;
    while (result && typeof result === "object" && !Array.isArray(result)) {
      // A replayed step result can predate later committed chunks. This control read
      // must be live: caching it would restore the same expired-deadline branch.
      current = await service.status({ ownerId, runId });
      if (!current.ok) throw new Error(current.error.kind);
      if (result.state !== current.value.state || result.run?.revision !== current.value.revision) result = { ...result, state: current.value.state, run: current.value };
      // Release the invocation after every bounded chunk; native steps alone retain accumulated CPU work.
      if (result.state === "extraction-loop" || result.state === "per-point-quiz-loop") {
        return continueFromCheckpoint(current.value);
      }
      if (isWorkflowRetryStage(result.state)) {
        executed = await executeOrAwaitMaterial(`resume knowledge workflow ${current.value.revision}`);
        result = executed.value;
        continue;
      }
      if (!["paused", "awaiting-time-limit-decision", "awaiting-upload", "retryable-failure"].includes(result.state)) break;
      if (isAutomaticExtractionContinuation(result, now())) {
        const chunkRun = /** @type {import("../src/features/knowledge-workflows/workflow.js").KnowledgeWorkflowRun} */ (result.run);
        const continued = await step.do(`continue bounded extraction chunk ${chunkRun.revision}`, async () => service.advance({ ownerId, runId, expectedRevision: chunkRun.revision, nextState: "extraction-loop" }));
        if (!continued.ok) throw new Error(continued.error.kind);
        return continueFromCheckpoint(continued.value);
      }
      await step.do(`notify workflow decision ${result.run?.revision}`, () => notifyOutcome(result.run));
      try {
        await step.waitForEvent(`wait for ${result.state} ${result.run?.revision}`, { type: result.state === "awaiting-upload" ? "workflow-material-ready" : "workflow-control", timeout: "24 hours" });
      } catch (error) {
        throw new Error(result.state === "awaiting-upload" ? "WorkflowMaterialTimeout" : "WorkflowControlTimeout");
      }
      current = await step.do(`reload after ${result.state} ${result.run?.revision}`, async () => service.status({ ownerId, runId }));
      if (!current.ok) throw new Error(current.error.kind);
      executed = await executeOrAwaitMaterial(`resume knowledge workflow ${current.value.revision}`);
      result = executed.value;
    }
    if (!result || typeof result !== "object" || Array.isArray(result) || typeof result.state !== "string") throw new Error("WorkflowRuntimeOutputInvalid");
    const finalRun = "run" in result && result.run && typeof result.run === "object" && !Array.isArray(result.run) ? result.run : current.value;
    if (!finalRun || typeof finalRun !== "object" || Array.isArray(finalRun) || typeof finalRun.revision !== "number") throw new Error("WorkflowRuntimeOutputInvalid");
    const restrictedUntil = "restrictedUntil" in result && typeof result.restrictedUntil === "string" ? result.restrictedUntil : null;
    await step.do(`notify workflow outcome ${finalRun.revision}`, () => notifyOutcome(finalRun));
    const restrictedKnowledgeIds = "restrictedKnowledgeIds" in result && Array.isArray(result.restrictedKnowledgeIds) && result.restrictedKnowledgeIds.every((value) => typeof value === "string" && value.trim() !== "") ? result.restrictedKnowledgeIds : [];
    if (restrictedUntil !== null && restrictedKnowledgeIds.length > 0) {
      const expiryMs = Date.parse(restrictedUntil);
      if (!Number.isFinite(expiryMs)) throw new Error("WorkflowRuntimeOutputInvalid");
      await step.sleepUntil("wait for quiz-attempt retention expiry", new Date(expiryMs));
      for (const knowledgeId of restrictedKnowledgeIds) {
        const purged = await step.do(`purge retained quiz attempt ${knowledgeId}`, async () => createRuntime().purgeExpired({ run: /** @type {import("../src/features/knowledge-workflows/workflow.js").KnowledgeWorkflowRun} */ (finalRun), knowledgeId, restrictedUntil, before: restrictedUntil }));
        if (!purged.ok) throw new Error(purged.error.kind);
      }
    }
    return { runId, state: result.state, revision: finalRun.revision, configDigests: current.value.configDigests };
}
