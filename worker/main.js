import {resolveModelApi} from "./model-api.js";
import { createUrlPdfCapture } from "./url-pdf.mjs";
import { D1KnowledgeContentRepository } from "./knowledge-workflow-content-d1.js";
import { D1KnowledgeWorkflowProgressRepository } from './knowledge-workflow-progress-d1.js';
import { D1SourceRenameRepository } from "./source-rename-d1.js";
import { createSourceRenameService } from "../src/features/source-library/rename.js";
// @ts-check

import { CloudflareAccessAuthenticator } from "./access-authenticator.js";
import { SourceLibraryService } from "../src/features/source-library/service.js";
import { SourceCatalogQueryService } from "../src/features/source-library/query.js";
import { isRecord } from "./contracts.js";
import { validatePublisherDestination } from "./destination-policy.js";
import { createDiscoveryWorker } from "./handler.js";
import { createPrivateDocumentReadService } from "./private-document-read.js";
import { RssAtomAcquisitionAdapter } from "./rss-atom-adapter.js";
import { PublisherTranscriptAdapter } from "./transcript-adapter.js";
import {
  DurablePublisherTranscriptAuthorization,
  PublisherTranscriptAuthorizationDurableObject,
} from "./transcript-authorization.js";
import { YouTubeDiscoveryAdapter } from "./youtube-adapter.js";
import { createEducationalSearchPolicy } from "./educational-search-policy.js";
import { createCentralDiscoverySearch } from "./discovery-search.js";
import { instrumentCentralSearch } from "./search-observability.js";
import { createBraveSearchProvider } from "./brave-search-adapter.js";
import { createTaddySearchProvider } from "./taddy-search-adapter.js";
import { createYouTubeSearchProvider } from "./youtube-search-provider.js";
import { YouTubeOAuthService } from "./youtube-oauth.js";
import { D1SourceLibraryRepository } from "./source-library-d1.js";
import { D1SourceClassificationRepository } from "./source-classification-d1.js";
import { D1SourceClassificationBackfillRepository } from "./source-classification-backfill-d1.js";
import { createSourceClassifier } from "../src/features/source-classification/public.js";
import { createSourceClassificationBackfillRuntime } from "./source-classification-backfill.js";
import { D1ManualMaterialRepository } from "./manual-material-d1.js";
import { R2SourceContentStore } from "./source-content-r2.js";
import { SourcePolicyEvaluator } from "../src/features/source-library/ingestion-policy.js";
import { SourceRightsApprovalService } from "../src/features/source-library/rights-approval.js";
import { D1SourceIngestionRepository } from "./source-ingestion-d1.js";
import { D1SourceRightsRegistry } from "./source-rights-registry-d1.js";
import { D1BrowserRunCapacityLedger } from "./browser-run-capacity-d1.js";
import { D1R2CapacityLedger } from "./r2-capacity-d1.js";
import { PublicPageAcquirer } from "./public-page-acquirer.js";
import { createAcquisitionClient } from "./acquisition-client.js";
import { ACQUISITION_POLICY } from "./acquisition-policy.js";
import { SourceIngestionRunner } from "./source-ingestion-runner.js";
import { ManualMaterialService } from "../src/features/source-library/manual-material.js";
import { createSourceCursorCodec } from "./source-cursor.js";
import { createSemanticRanker } from "./local-semantic-index.js";
import { createOpenRouterKnowledgeModel } from "./knowledge-workflow-model.js";
import {
  DurableYouTubeOAuthStore,
  YouTubeOAuthDurableObject,
} from "./youtube-oauth-store.js";
import { D1LearningGenerationRepository } from "./learning-generation-d1.js";
import { D1LearningBudgetLedger } from "./learning-budget-d1.js";
import { createOpenRouterGlm53FlashAdapter } from "./openrouter-glm-5-3-flash-adapter.js";
import { LearningGenerationService } from "../src/features/learning-generation/service.js";
import { LearningReviewService } from "../src/features/learning-generation/review.js";
import { LearningReviewQueueService } from "../src/features/learning-generation/queue.js";
import { LearningRevocationService } from "../src/features/learning-generation/revocation.js";
import { LearningGenerationStatusService } from "../src/features/learning-generation/status.js";
import { LearningGenerationEnqueuer } from "./learning-generation-enqueuer.js";
import { createLearningCostModel } from "./learning-generation-cost.js";
import { D1KnowledgeWorkflowRepository } from "./knowledge-workflow-d1.js";
import { createKnowledgeWorkflowService, isWorkflowRetryStage } from "../src/features/knowledge-workflows/workflow.js";
import { D1KnowledgeMediaRepository } from "./knowledge-workflow-media-d1.js";
import { createMediaPipeline, createMediaPublicEgress } from "../src/features/knowledge-workflows/media.js";
import { createCloudflareImageDerivative, isCloudflareImageBinding } from "./knowledge-workflow-media-transform.js";
import { resolvePublicAddresses } from "./knowledge-workflow-network.js";
import { createKnowledgeWorkflowCleanup } from "./knowledge-workflow-cleanup.js";
import { createKnowledgeWorkflowSourceContentCleanup } from "./knowledge-workflow-source-content.js";
import { createKnowledgeWorkflowLogger } from "./knowledge-workflow-logging.js";
import { createDiscoveryRequestLogger } from "./request-logging.js";
import { sourceRightsProfileFor } from "./source-rights-profiles.js";
import { parseAuthorizedMaterial } from "../src/features/knowledge-workflows/material.js";
import { createKnowledgeWorkflowMaterialService } from "../src/features/knowledge-workflows/material-service.js";
import { D1KnowledgeWorkflowMaterialRepository } from "./knowledge-workflow-material-d1.js";
import { createKnowledgeWorkflowBackfill, createKnowledgeWorkflowReplay } from "../src/features/knowledge-workflows/backfill.js";
import { D1KnowledgeWorkflowBackfillRepository } from "./knowledge-workflow-backfill-d1.js";
import { createLearningBatchService } from "./learning-batches-d1.js";
import { createJevAnswerGrader, JEV_GRADER_CONFIGURATION } from "./jev-answer-grader.js";
import { createReminderRuntime } from "./reminders/runtime.js";

/** @import { Result, WorkerFailure } from "./contracts.js" */

/**
 * @typedef {{
 *   readonly ALLOWED_ORIGIN?: unknown,
 *   readonly ACCESS_ISSUER?: unknown,
 *   readonly ACCESS_AUDIENCE?: unknown,
 *   readonly ACCESS_OWNER_EMAIL?: unknown,
 *   readonly ACCESS_OWNER_ID?: unknown,
 *   readonly TRANSCRIPT_LANGUAGES?: unknown,
 *   readonly YOUTUBE_QUOTA?: unknown,
 *   readonly YOUTUBE_QUOTA_LEDGER?: unknown,
 *   readonly YOUTUBE_SEARCH_DAILY_LIMIT?: unknown,
 *   readonly YOUTUBE_GENERAL_DAILY_LIMIT?: unknown,
 *   readonly YOUTUBE_API_KEY?: unknown,
 *   readonly BRAVE_SEARCH_API_KEY?: unknown,
 *   readonly TADDY_USER_ID?: unknown,
 *   readonly TADDY_API_KEY?: unknown,
 *   readonly YOUTUBE_OAUTH_CLIENT_ID?: unknown,
 *   readonly YOUTUBE_OAUTH_CLIENT_SECRET?: unknown,
 *   readonly YOUTUBE_OAUTH_REDIRECT_URI?: unknown,
 *   readonly YOUTUBE_OAUTH_SCOPES?: unknown,
 *   readonly YOUTUBE_OAUTH_KEY_VERSION?: unknown,
 *   readonly YOUTUBE_OAUTH_ENCRYPTION_KEY?: unknown,
 *   readonly YOUTUBE_OAUTH_STORE?: unknown,
 *   readonly YOUTUBE_OAUTH_LEDGER?: unknown,
 *   readonly OPENROUTER_API_KEY?: unknown,
 *   readonly LLM_API_KEY?: unknown,
 *   readonly LLM_CHAT_ENDPOINT?: unknown,
 *   readonly LLM_MODEL?: unknown,
 *   readonly LLM_GRADING_MODEL?: unknown,
 *   readonly RERANK_API_KEY?: unknown,
 *   readonly RERANK_ENDPOINT?: unknown,
 *   readonly RERANK_MODEL?: unknown,
 *   readonly OPENROUTER_INPUT_USD_PER_MILLION?: unknown,
 *   readonly OPENROUTER_OUTPUT_USD_PER_MILLION?: unknown,
 *   readonly TRANSCRIPT_AUTHORIZATION?: unknown,
 *   readonly TRANSCRIPT_AUTHORIZATION_LEDGER?: unknown,
 *   readonly SOURCE_LIBRARY_DB?: unknown,
 *   readonly SOURCE_INGESTION_POLICY_VERSION?: unknown,
 *   readonly SOURCE_CURSOR_SECRET?: unknown,
 *   readonly SOURCE_CONTENT_BUCKET?: unknown,
 *   readonly IMAGES?: unknown,
 *   readonly SOURCE_MANUAL_MAX_BYTES?: unknown,
 *   readonly SOURCE_MANUAL_MAX_CHARACTERS?: unknown,
 *   readonly SOURCE_MANUAL_MEDIA_TYPES?: unknown,
 *   readonly SOURCE_R2_ACCOUNT_SCOPE?: unknown,
 *   readonly SOURCE_R2_STORED_BYTES_LIMIT?: unknown,
 *   readonly SOURCE_R2_CLASS_A_MONTHLY_LIMIT?: unknown,
 *   readonly SOURCE_R2_CLASS_B_MONTHLY_LIMIT?: unknown,
 *   readonly SOURCE_R2_OBSERVATION_MAX_AGE_MS?: unknown,
 *   readonly PUBLIC_ACQUISITION?: unknown,
 *   readonly PUBLIC_ACQUISITION_ENDPOINT?: unknown,
 *   readonly PUBLIC_ACQUISITION_TOKEN?: unknown,
 *   readonly SOURCE_BROWSER?: unknown,
 *   readonly SOURCE_BROWSER_ACCOUNT_SCOPE?: unknown,
 *   readonly KNOWLEDGE_WORKFLOW?: unknown,
 *   readonly KNOWLEDGE_WORKFLOW_ENABLED?: unknown,
 *   readonly KNOWLEDGE_WORKFLOW_CONFIG_DIGESTS?: unknown,
 *   readonly VAPID_PUBLIC_KEY?: unknown,
 *   readonly VAPID_PRIVATE_KEY?: unknown,
 *   readonly VAPID_SUBJECT?: unknown,
 *   readonly REMINDER_PUSH_ORIGINS?: unknown,
 * }} DiscoveryWorkerEnvironment
 */

/**
 * The binding must implement an atomic reservation against durable storage.
 * A successful response is `{ "used": positiveInteger }`; HTTP 429 means the
 * configured daily ceiling was reached.
 *
 * @typedef {{
 *   readonly fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
 * }} QuotaReservationBinding
 */

/**
 * @typedef {{
 *   readonly idFromName: (name: string) => unknown,
 *   readonly get: (id: unknown) => QuotaReservationBinding,
 * }} QuotaDurableObjectNamespace
 */

/** @typedef {{ readonly used: unknown }} QuotaRow */

/**
 * @typedef {{
 *   readonly exec: (query: string, ...bindings: readonly (string | number)[]) => Iterable<QuotaRow>,
 * }} QuotaSqlStorage
 */

/**
 * @typedef {{
 *   readonly sql: QuotaSqlStorage,
 *   readonly transactionSync: <T>(callback: () => T) => T,
 * }} QuotaDurableObjectStorage
 */

/** @typedef {{ readonly storage: QuotaDurableObjectStorage }} QuotaDurableObjectState */

/**
 * @typedef {{
 *   readonly kind: "DiscoveryDeploymentConfigurationMissing",
 *   readonly field: string,
 * } | {
 *   readonly kind: "DiscoveryDeploymentConfigurationInvalid",
 *   readonly field: string,
 * }} DiscoveryCompositionFailure
 */

/**
 * @typedef {{
 *   readonly fetch: typeof fetch,
 *   readonly now: () => Date,
 *   readonly subtle: SubtleCrypto,
 *   readonly randomBytes?: (length: number) => Uint8Array,
 *   readonly waitUntil?: (promise: Promise<unknown>) => void,
 *   readonly urlCapture?: (command: {ownerId:string,url:string}) => Promise<{ok:true,value:Uint8Array}|{ok:false,error:{kind:string}}>,
 *   readonly browserLauncher?: { readonly limits: (binding: unknown) => Promise<unknown>, readonly launch: (binding: unknown) => Promise<unknown> },
 *   readonly publicEgress?: import("../src/features/knowledge-workflows/media.js").MediaPublicEgress,
 * }} CloudflarePlatform
 */

/**
 * @typedef {{
 *   readonly id: string,
 *   readonly pause: () => Promise<void>,
 *   readonly resume: () => Promise<void>,
 *   readonly restart?: () => Promise<void>,
 *   readonly terminate: (options?: { readonly rollback?: boolean }) => Promise<void>,
 *   readonly status?: () => Promise<{ readonly status: string, readonly output?: unknown, readonly error?: {readonly name:string,readonly message:string} }>,
 *   readonly sendEvent: (event: { readonly type: string, readonly payload?: unknown }) => Promise<void>
 * }} KnowledgeWorkflowInstance
 */

/**
 * @typedef {{
 *   readonly create: (options: { readonly id: string, readonly params: unknown }) => Promise<KnowledgeWorkflowInstance>,
 *   readonly get: (id: string) => Promise<KnowledgeWorkflowInstance>
 * }} KnowledgeWorkflowBinding
 */

/**
 * @typedef {{
 *   readonly start: (command: unknown) => Promise<Result<{ readonly runId: string, readonly reused: boolean }, { readonly kind: string }>>,
 *   readonly status: (command: unknown) => Promise<Result<unknown, { readonly kind: string }>>,
 *   readonly sourceStatus: (command: unknown) => Promise<Result<unknown, { readonly kind: string }>>,
 *   readonly control: (command: unknown) => Promise<Result<unknown, { readonly kind: string }>>,
 *   readonly rightsApproved: (command: unknown) => Promise<Result<unknown, { readonly kind: string }>>,
 *   readonly material?: (command: unknown) => Promise<Result<unknown, { readonly kind: string }>>
 * }} KnowledgeWorkflowHandlerPort
 */

/**
 * @typedef {{ readonly fetch: (request: Request) => Promise<Response> }} DiscoveryWorker
 */

/**
 * SQLite-backed daily quota ledger. One stable Durable Object serializes and
 * commits the OAuth-backed search and general-read reservations atomically.
 */
export class YouTubeQuotaDurableObject {
  /** @type {QuotaDurableObjectStorage} */
  #storage;
  /** @type {{ readonly search: number, readonly general: number }} */
  #limits;

  /**
   * @param {QuotaDurableObjectState} state
   * @param {DiscoveryWorkerEnvironment} environment
   */
  constructor(state, environment) {
    if (
      !isQuotaStorage(state?.storage) ||
      typeof environment.YOUTUBE_SEARCH_DAILY_LIMIT !== "string" ||
      !positiveIntegerText(environment.YOUTUBE_SEARCH_DAILY_LIMIT) ||
      typeof environment.YOUTUBE_GENERAL_DAILY_LIMIT !== "string" ||
      !positiveIntegerText(environment.YOUTUBE_GENERAL_DAILY_LIMIT)
    ) {
      throw new TypeError(
        "YouTube quota Durable Object configuration is invalid.",
      );
    }
    this.#storage = state.storage;
    this.#limits = Object.freeze({
      search: Number(environment.YOUTUBE_SEARCH_DAILY_LIMIT),
      general: Number(environment.YOUTUBE_GENERAL_DAILY_LIMIT),
    });
    this.#storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS daily_quota (quota_day TEXT NOT NULL, bucket TEXT NOT NULL, used INTEGER NOT NULL CHECK (used >= 0), PRIMARY KEY (quota_day, bucket))",
    );
  }

  /** @param {Request} request */
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname !== "/reservations") {
      return json({ error: "Not found." }, 404);
    }
    if (request.method !== "POST") {
      return json({ error: "Method not allowed." }, 405, { Allow: "POST" });
    }
    const command = await readQuotaCommand(request, 512);
    if (!command.ok) return command.error;
    const used = this.#storage.transactionSync(() => {
      const rows = [...this.#storage.sql.exec(
        "SELECT used FROM daily_quota WHERE quota_day = ? AND bucket = ?",
        command.value.quotaDay,
        command.value.bucket,
      )];
      if (rows.length > 1) {
        throw new TypeError("Daily quota primary-key invariant is broken.");
      }
      const current = rows.length === 0 ? 0 : rows[0].used;
      if (
        typeof current !== "number" || !Number.isInteger(current) ||
        current < 0
      ) {
        throw new TypeError("Stored daily quota is invalid.");
      }
      const next = current + command.value.units;
      if (next > this.#limits[command.value.bucket]) return null;
      this.#storage.sql.exec(
        "INSERT INTO daily_quota (quota_day, bucket, used) VALUES (?, ?, ?) ON CONFLICT (quota_day, bucket) DO UPDATE SET used = excluded.used",
        command.value.quotaDay,
        command.value.bucket,
        next,
      );
      return next;
    });
    return used === null
      ? json({
        error: command.value.bucket === "search"
          ? "YouTubeSearchQuotaExceeded"
          : "YouTubeGeneralQuotaExceeded",
      }, 429)
      : json({ used }, 200);
  }
}

/**
 * @param {DiscoveryWorkerEnvironment} environment
 * @param {CloudflarePlatform} platform
 * @returns {Result<DiscoveryWorker, DiscoveryCompositionFailure>}
 */
export function createCloudflareDiscoveryWorker(environment, platform) {
  if (
    typeof platform.fetch !== "function" ||
    typeof platform.now !== "function" ||
    typeof platform.subtle?.digest !== "function"
  ) {
    throw new TypeError("Cloudflare platform dependencies are invalid.");
  }
  const configuration = parseEnvironment(environment);
  if (!configuration.ok) return configuration;
  const modelApi = resolveModelApi(/** @type {Record<string,unknown>} */(environment));
  if (!modelApi.ok) return {ok:false,error:{kind:"DiscoveryDeploymentConfigurationInvalid",field:modelApi.error.field}};
  const ai = modelApi.value;
  const knowledgeWorkflowLogger = createKnowledgeWorkflowLogger({
    sink: (record) => console.info(JSON.stringify(record)),
    now: () => platform.now().toISOString(),
  });
  const discoveryRequestLogger = createDiscoveryRequestLogger({
    sink: (record) => console.info(JSON.stringify(record)),
    now: () => platform.now().toISOString(),
  });

  /** @type {(bytes: Uint8Array) => Promise<Result<string, WorkerFailure>>} */
  const digest = async (bytes) => {
    try {
      const value = await platform.subtle.digest("SHA-256", bytes);
      return { ok: true, value: hex(new Uint8Array(value)) };
    } catch (error) {
      if (error instanceof Error) {
        return /** @type {const} */ ({
          ok: false,
          error: { kind: "DiscoveryDigestUnavailable" },
        });
      }
      throw error;
    }
  };
  const authenticator = new CloudflareAccessAuthenticator(
    {
      issuer: configuration.value.accessIssuer,
      audience: configuration.value.accessAudience,
      ownerByEmail: new Map([[
        configuration.value.ownerEmail,
        configuration.value.ownerId,
      ]]),
    },
    {
      nowEpochSeconds: () => Math.floor(platform.now().getTime() / 1_000),
      keyFor: (kid) =>
        accessKeyFor(
          configuration.value.accessIssuer,
          kid,
          platform.fetch,
        ),
      verify: (input) => verifyAccessSignature(input, platform.subtle),
    },
  );
  const rss = new RssAtomAcquisitionAdapter({
    fetch: platform.fetch,
    now: () => platform.now().toISOString(),
    digest,
    policy: {
      maximumBytes: 1_048_576,
      maximumRedirects: 3,
      timeoutMs: 15_000,
    },
  });
  const transcript = new PublisherTranscriptAdapter({
    fetch: platform.fetch,
    validateDestination: (url) => {
      const validated = validatePublisherDestination(url);
      return validated.ok
        ? validated
        : { ok: false, error: { kind: "DestinationRejected" } };
    },
    clock: platform.now,
    digest: async (bytes) => {
      const result = await digest(bytes);
      return result.ok
        ? result
        : { ok: false, error: { kind: "DigestUnavailable" } };
    },
    limits: {
      maximumBytes: 2_097_152,
      maximumRedirects: 3,
      maximumTextCharacters: 250_000,
      maximumExcerptCharacters: 8_000,
      supportedLanguages: configuration.value.transcriptLanguages,
    },
  });
  const authorization = new DurablePublisherTranscriptAuthorization(
    configuration.value.transcriptAuthorization,
  );
  if (
    configuration.value.sourceLibraryDatabase !== null &&
    typeof platform.randomBytes !== "function"
  ) {
    return {
      ok: false,
      error: {
        kind: "DiscoveryDeploymentConfigurationInvalid",
        field: "platform.randomBytes",
      },
    };
  }
  const sourceRepository = configuration.value.sourceLibraryDatabase === null
    ? null
    : new D1SourceLibraryRepository(configuration.value.sourceLibraryDatabase);
  const sourceClassification = configuration.value.sourceLibraryDatabase === null
    ? null
    : new D1SourceClassificationRepository({ database: /** @type {import("./source-classification-d1.js").SourceClassificationDatabase} */ (configuration.value.sourceLibraryDatabase), now: () => platform.now().toISOString(), logger: (entry) => console.info(JSON.stringify(entry)) });
  const sourceClassificationBackfill = configuration.value.sourceLibraryDatabase === null || ai.apiKey === null
    ? null
    : createSourceClassificationBackfillRuntime({
      backfillRepository: new D1SourceClassificationBackfillRepository({ database: /** @type {import("./source-classification-backfill-d1.js").D1DatabasePort} */ (configuration.value.sourceLibraryDatabase), now: () => platform.now().toISOString(), logger: (entry) => console.info(JSON.stringify(entry)) }),
      classificationRepository: /** @type {D1SourceClassificationRepository} */ (sourceClassification),
      classifier: createSourceClassifier({ provider: createOpenRouterKnowledgeModel({ apiKey: ai.apiKey, endpoint: ai.endpoint, apiStyle:ai.apiStyle, model: ai.model, timeoutMs: 15_000, maximumInputCharacters: 100_000, fetch: platform.fetch, now: () => platform.now().getTime(), logger: (entry) => console.info(JSON.stringify(entry)) }), logger: (entry) => console.info(JSON.stringify(entry)) }),
      now: () => platform.now().toISOString(),
      logger: (entry) => console.info(JSON.stringify(entry)),
    });
  const sourceLibrary = sourceRepository === null
    ? null
    : new SourceLibraryService({
      repository: sourceRepository,
      createId: () =>
        hex(
          /** @type {(length: number) => Uint8Array} */ (platform.randomBytes)(
            16,
          ),
        ),
      now: () => platform.now().toISOString(),
      ingestionPolicyVersion: /** @type {string} */ (
        configuration.value.sourceIngestionPolicyVersion
      ),
    });
  const sourceCatalog = sourceRepository === null
    ? null
    : new SourceCatalogQueryService({
      repository: sourceRepository,
      cursorCodec: createSourceCursorCodec(
        /** @type {string} */ (configuration.value.sourceCursorSecret),
        platform.subtle,
      ),
      // Dedicated reranker model: https://openrouter.ai/cohere/rerank-4-fast
      semanticRanker: createSemanticRanker({
        ...ai.rerank,
        fetch: platform.fetch,
        maximumCandidates: 20,
        timeoutMs: 3_000,
        logger: entry => console.info(JSON.stringify(entry)),
      }),
      maximumSemanticCandidates: 20,
      maximumPageSize: 50,
      maximumQueryLength: 200,
      fusionVersion: "rrf-v1",
    });
  const sourceCatalogForHandler = sourceCatalog === null
    ? null
    : {
      browse: (/** @type {unknown} */ command) => sourceCatalog.browse(command),
      search: (/** @type {unknown} */ command) => sourceCatalog.search(/** @type {{ readonly ownerId: string, readonly query: string, readonly limit: number, readonly mode: import("../src/features/source-library/contracts.js").SourceSearchMode, readonly scope: import("../src/features/source-library/contracts.js").SourceSearchScope }} */ (command)),
      suppressed: (/** @type {unknown} */ command) => sourceCatalog.suppressed(command),
      active: (/** @type {unknown} */ command) => sourceCatalog.active(command),
    };
  const manualConfiguration = configuration.value.manualMaterial;
  const manualRepository = sourceRepository === null ||
      manualConfiguration === null
    ? null
    : new D1ManualMaterialRepository(/** @type {import("./source-library-d1.js").D1DatabasePort} */ (configuration.value.sourceLibraryDatabase));
  const manualContentStore = manualConfiguration === null
    ? null
    : new R2SourceContentStore({
      bucket: manualConfiguration.bucket,
      capacityOwnerId: configuration.value.ownerId,
      capacity: new D1R2CapacityLedger({
        bucket: manualConfiguration.bucket,
        database: /** @type {import("./r2-capacity-d1.js").D1DatabasePort} */ (
          /** @type {unknown} */ (configuration.value.sourceLibraryDatabase)
        ),
        now: () => platform.now().toISOString(),
        createId: () => hex(
          /** @type {(length:number)=>Uint8Array} */ (platform.randomBytes)(16),
        ),
        policy: manualConfiguration.capacityPolicy,
      }),
    });
  const manualMaterial = manualRepository === null || manualContentStore === null
    ? null
    : new ManualMaterialService({
      sourceItems: manualRepository,
      repository: manualRepository,
      contentStore: manualContentStore,
      digest: async (bytes) => {
        const result = await digest(bytes);
        return result.ok ? result : { ok: false, error: { kind: /** @type {const} */ ("ManualUploadDigestUnavailable") } };
      },
      createId: () => hex(/** @type {(length: number) => Uint8Array} */ (platform.randomBytes)(16)),
      now: () => platform.now().toISOString(),
      supportedMediaTypes: /** @type {NonNullable<typeof manualConfiguration>} */ (manualConfiguration).mediaTypes,
      maximumBytes: /** @type {NonNullable<typeof manualConfiguration>} */ (manualConfiguration).maximumBytes,
      maximumCharacters: /** @type {NonNullable<typeof manualConfiguration>} */ (manualConfiguration).maximumCharacters,
    });
  /** @type {import("../src/features/learning-generation/contracts.js").LearningLogger} */
  const learningLogger = (entry) => console.info(JSON.stringify(entry));
  const sourceRightsRegistry = sourceRepository === null
    ? null
    : new D1SourceRightsRegistry({
      database: /** @type {import("./source-rights-registry-d1.js").D1DatabasePort} */ (/** @type {unknown} */ (configuration.value.sourceLibraryDatabase)),
      now: () => platform.now().toISOString(),
      logger: learningLogger,
    });
  const sourceRightsApproval = sourceRightsRegistry === null
    ? null
    : new SourceRightsApprovalService({
      repository: { approve: (record, fingerprint) => sourceRightsRegistry.approve(record, fingerprint) },
      createId: () => hex(/** @type {(length: number) => Uint8Array} */ (platform.randomBytes)(16)),
      now: () => platform.now().toISOString(),
      logger: learningLogger,
    });
  const learningPolicy = Object.freeze({
    version: "learning-generation-v1",
    unitization: Object.freeze({ version: "unitization-v1", maximumContentCharacters: 250_000, maximumWordsPerUnit: 80, maximumUnits: 32, maximumExcerptCharacters: 8_000 }),
    maximumProviderInputCharacters: 8_000,
    maximumProviderUnits: 8,
    maximumTasks: 12,
    maximumOutputTokens: 512,
    factualSamplingRatePercent: 30,
    samplingVersion: "factual-sampling-v1",
    providerInstruction: "Return only a JSON object with bounded, evidence-grounded learning tasks. Preserve unit and source anchor IDs.",
    monthlyBudgetUsd: 2,
  });
  const learningDatabase = configuration.value.sourceLibraryDatabase;
  const jevGrader = createJevAnswerGrader({ apiKey: ai.apiKey, ...(ai.gradingModel === null ? {} : {chat:{endpoint:ai.endpoint,model:ai.gradingModel,apiStyle:ai.apiStyle}}), configuration: JEV_GRADER_CONFIGURATION, fetch: platform.fetch, timeoutMs: 10_000, logger: (entry) => learningLogger({ event: entry.event, failureKind: entry.failureKind }) });
  const learningBatches = learningDatabase === null
    ? null
    : createLearningBatchService({
      database: learningDatabase,
      now: () => platform.now().toISOString(),
      random: () => globalThis.crypto.getRandomValues(new Uint32Array(1))[0] / 4_294_967_296,
      bucket: isMediaBucket(environment.SOURCE_CONTENT_BUCKET) ? environment.SOURCE_CONTENT_BUCKET : null,
      semanticGrader: async (command) => {
        const result = await jevGrader.grade(command);
        return result.ok ? { ok: true, value: result.value.probabilities } : { ok: false, error: result.error };
      },
      logger: (entry) => console.info(JSON.stringify(entry)),
    });
  const learningRepository = learningDatabase === null
    ? null
    : new D1LearningGenerationRepository({ database: learningDatabase, logger: learningLogger });
  const learningGenerationService = learningRepository === null || learningDatabase === null
    ? null
    : new LearningGenerationService({
      repository: learningRepository,
      provider: createOpenRouterGlm53FlashAdapter({ apiKey: ai.apiKey, endpoint: ai.endpoint, model: ai.model, maximumInputCharacters: learningPolicy.maximumProviderInputCharacters, maximumOutputTokens: learningPolicy.maximumOutputTokens, timeoutMs: 15_000, fetch: platform.fetch, now: () => platform.now().getTime(), logger: learningLogger }),
      budget: new D1LearningBudgetLedger({ database: learningDatabase, logger: learningLogger }),
      costModel: createLearningCostModel(configuration.value.learningCost),
      createId: () => hex(/** @type {(length:number)=>Uint8Array} */ (platform.randomBytes)(16)),
      now: () => platform.now().toISOString(),
      logger: learningLogger,
    });
  const learningEnqueuer = learningGenerationService === null
    ? null
    : new LearningGenerationEnqueuer({ generate: (command) => learningGenerationService.generate(command), now: () => platform.now().toISOString(), logger: learningLogger, maximumItems: 8 });
  const learningStatus = learningRepository === null ? null : new LearningGenerationStatusService({ repository: learningRepository, logger: learningLogger });
  const learningReview = learningRepository === null ? null : new LearningReviewService({ repository: learningRepository, now: () => platform.now().toISOString(), logger: learningLogger });
  const learningReviewQueue = learningRepository === null ? null : new LearningReviewQueueService({ repository: learningRepository, logger: learningLogger });
  const learningRevocation = learningRepository === null ? null : new LearningRevocationService({ repository: learningRepository, now: () => platform.now().toISOString(), logger: learningLogger });
  const acquisition = createAcquisitionClient({ binding: environment.PUBLIC_ACQUISITION, endpoint: environment.PUBLIC_ACQUISITION_ENDPOINT, token: environment.PUBLIC_ACQUISITION_TOKEN, policy: ACQUISITION_POLICY, createId: () => hex(/** @type {(length:number)=>Uint8Array} */ (platform.randomBytes)(16)) });
  const browserConfiguration = configuration.value.browserRun;
  const sourceIngestion = sourceRepository === null || sourceRightsRegistry === null || manualContentStore === null ||
      browserConfiguration === null
    ? null
    : new SourceIngestionRunner({
      policy: new SourcePolicyEvaluator({
        policy: browserRunSourcePolicy(/** @type {string} */ (configuration.value.sourceIngestionPolicyVersion)),
        now: () => platform.now().toISOString(),
      }),
      repository: new D1SourceIngestionRepository(/** @type {import("./source-ingestion-d1.js").D1DatabasePort} */ (/** @type {unknown} */ (configuration.value.sourceLibraryDatabase))),
      rightsRegistry: sourceRightsRegistry,
      capacity: new D1BrowserRunCapacityLedger({
        database: /** @type {import("./browser-run-capacity-d1.js").D1DatabasePort} */ (/** @type {unknown} */ (configuration.value.sourceLibraryDatabase)),
        now: () => platform.now().toISOString(),
        createId: () => hex(/** @type {(length: number) => Uint8Array} */ (platform.randomBytes)(16)),
        policy: browserRunCapacityPolicy(browserConfiguration.accountScope),
      }),
      acquirer: new PublicPageAcquirer({ client: acquisition, policy: ACQUISITION_POLICY, now: () => platform.now().toISOString(), maximumPagesPerRun: 5, maximumFrontierEntries: 500, maximumRunMilliseconds: 60_000, logger: (entry) => learningLogger(entry) }),
      contentStore: manualContentStore,
      digest: async (bytes) => {
        const result = await digest(bytes);
        return result.ok ? result : { ok: false, error: { kind: /** @type {const} */ ("CrawlDigestUnavailable") } };
      },
      createId: () => hex(/** @type {(length: number) => Uint8Array} */ (platform.randomBytes)(16)),
      now: () => platform.now().toISOString(),
      leaseDurationMs: 300_000,
      generationEnqueue: learningEnqueuer === null ? undefined : (command) => learningEnqueuer.enqueue({ .../** @type {Record<string, unknown>} */ (command), policy: learningPolicy }),
      logger: learningLogger,
    });
  const knowledgeWorkflowBinding = configuration.value.knowledgeWorkflowEnabled && isKnowledgeWorkflowBinding(environment.KNOWLEDGE_WORKFLOW)
    ? environment.KNOWLEDGE_WORKFLOW
    : null;
  const knowledgeWorkflowConfigDigests = configuration.value.knowledgeWorkflowConfigDigests;
  if (knowledgeWorkflowBinding !== null && knowledgeWorkflowConfigDigests === null) {
    return { ok: false, error: { kind: "DiscoveryDeploymentConfigurationMissing", field: "KNOWLEDGE_WORKFLOW_CONFIG_DIGESTS" } };
  }
  const knowledgeWorkflowRepository = sourceRepository === null || knowledgeWorkflowBinding === null
    ? null
    : new D1KnowledgeWorkflowRepository({
      database: /** @type {import("./knowledge-workflow-d1.js").D1DatabasePort} */ (configuration.value.sourceLibraryDatabase),
      logger: knowledgeWorkflowLogger,
    });
  const knowledgeWorkflowService = knowledgeWorkflowRepository === null
    ? null
    : createKnowledgeWorkflowService(knowledgeWorkflowRepository, {
      now: () => platform.now().toISOString(),
      createId: () => `knowledge-workflow:${hex(/** @type {(length: number) => Uint8Array} */ (platform.randomBytes)(16))}`,
      logger: (entry) => knowledgeWorkflowLogger({ event: entry.event, ownerId: entry.ownerId, runId: entry.runId, action: entry.action, failureKind: entry.failureKind }),
      cleanup: createKnowledgeWorkflowCleanup({
        database: /** @type {import("./knowledge-workflow-cleanup.js").D1DatabasePort} */ (configuration.value.sourceLibraryDatabase),
        sourceContent: manualContentStore === null
          ? undefined
          : createKnowledgeWorkflowSourceContentCleanup({
            database: /** @type {import("./knowledge-workflow-source-content.js").D1DatabasePort} */ (/** @type {unknown} */ (configuration.value.sourceLibraryDatabase)),
            contentStore: manualContentStore,
            logger: (entry) => knowledgeWorkflowLogger({ event: entry.event, ownerId: entry.ownerId, failureKind: entry.failureKind }),
          }),
        bucket: isMediaBucket(environment.SOURCE_CONTENT_BUCKET)
          ? /** @type {import("./knowledge-workflow-cleanup.js").CleanupBucket} */ (environment.SOURCE_CONTENT_BUCKET)
          : null,
        workflowRepository: {
          listBySource: (ownerId, sourceId, sourceRevision) => knowledgeWorkflowRepository.listBySource(ownerId, sourceId, sourceRevision),
          invalidateReuse: (command) => knowledgeWorkflowRepository.invalidateReuse(command),
          markAbandoned: (command) => knowledgeWorkflowRepository.markAbandoned(command),
        },
        now: () => platform.now().toISOString(),
        logger: (entry) => knowledgeWorkflowLogger({ event: entry.event, ownerId: entry.ownerId, runId: entry.runId, failureKind: entry.failureKind }),
      }),
    });
  const knowledgeWorkflowMaterialRepository = sourceRepository === null
    ? null
    : new D1KnowledgeWorkflowMaterialRepository({
      database: /** @type {import("./knowledge-workflow-material-d1.js").D1DatabasePort} */ (/** @type {unknown} */ (configuration.value.sourceLibraryDatabase)),
      logger: (entry) => knowledgeWorkflowLogger({ event: entry.event, ownerId: entry.ownerId, runId: entry.runId, failureKind: entry.failureKind }),
    });
  const knowledgeWorkflowMaterialService = knowledgeWorkflowMaterialRepository === null || manualContentStore === null || knowledgeWorkflowService === null || manualConfiguration === null
    ? null
    : createKnowledgeWorkflowMaterialService({
      parser: (command) => parseAuthorizedMaterial(command, {
        digest: async (bytes) => {
          const result = await digest(bytes);
          if (!result.ok) throw new Error("Workflow material digest unavailable.");
          return result.value;
        },
        maximumBytes: manualConfiguration.maximumBytes,
        maximumCharacters: manualConfiguration.maximumCharacters,
      }),
      repository: knowledgeWorkflowMaterialRepository,
      contentStore: manualContentStore,
      workflow: { status: (command) => knowledgeWorkflowService.status(command), attachMaterial: (command) => knowledgeWorkflowService.attachMaterial(command) },
      createId: () => hex(/** @type {(length: number) => Uint8Array} */ (platform.randomBytes)(16)),
      now: () => platform.now().toISOString(),
      logger: (entry) => knowledgeWorkflowLogger({ event: entry.event, ownerId: entry.ownerId, runId: entry.runId, failureKind: entry.failureKind }),
    });
  const knowledgeWorkflow = /** @type {KnowledgeWorkflowHandlerPort | null} */ (knowledgeWorkflowService === null || knowledgeWorkflowBinding === null
    ? null
    : {
      /** @param {unknown} command */
      start: async (command) => {
        const enrichedCommand = isRecord(command)
          ? Object.freeze({
            ...command,
            contentSignature: typeof command.contentSignature === "string" && command.contentSignature.trim() !== ""
              ? command.contentSignature
              : `source-revision:${String(command.sourceRevision)}`,
            configDigests: knowledgeWorkflowConfigDigests,
          })
          : command;
        const created = await knowledgeWorkflowService.createRun(enrichedCommand);
        if (!created.ok) return { ok: false, error: { kind: created.error.kind } };
        const workflowPayload = isRecord(enrichedCommand)
          ? Object.freeze({ ...enrichedCommand, runId: created.value.run.runId })
          : Object.freeze({ runId: created.value.run.runId, ownerId: created.value.run.ownerId });
        const launched = await reconcileKnowledgeWorkflowLaunch(knowledgeWorkflowBinding, created.value.run, workflowPayload, created.value.reused);
        if (!launched.ok) {
          knowledgeWorkflowLogger({ event: "knowledge-workflow-start-failure", failureKind: "WorkflowStartFailed", runId: created.value.run.runId });
          return /** @type {const} */ ({ ok: false, error: { kind: "WorkflowStartFailed" } });
        }
        return /** @type {const} */ ({ ok: true, value: { runId: created.value.run.runId, reused: created.value.reused } });
      },
      /** @param {unknown} command */
      status: async (command) => {
        const stored = await knowledgeWorkflowService.status(command);
        if (!stored.ok) return stored;
        const status = await projectKnowledgeWorkflowExecution(stored.value,knowledgeWorkflowBinding);
        if (!status.ok) return status;
        const progress = await new D1KnowledgeWorkflowProgressRepository({database:/** @type {import('./knowledge-workflow-d1.js').D1DatabasePort} */(configuration.value.sourceLibraryDatabase),logger:knowledgeWorkflowLogger}).read(status.value);
        return progress.ok ? {ok:true,value:{...status.value,progress:progress.value}} : progress;
      },
      /** @param {unknown} command */
      sourceStatus: async (command) => {
        if (!isRecord(command) || typeof command.ownerId !== "string" || command.ownerId.trim() === "" || typeof command.sourceId !== "string" || command.sourceId.trim() === "") return { ok: false, error: { kind: "WorkflowCommandInvalid" } };
        const listed = await /** @type {import("./knowledge-workflow-d1.js").D1KnowledgeWorkflowRepository} */ (knowledgeWorkflowRepository).listBySource(command.ownerId, command.sourceId, undefined);
        if (!listed.ok) return listed;
        const storedRun=listed.value[0] ?? null;
        const projected=storedRun===null?{ok:/** @type {const} */(true),value:null}:await projectKnowledgeWorkflowExecution(storedRun,knowledgeWorkflowBinding);
        if(!projected.ok)return projected;
        const run=projected.value;
        const warnings=run===null ? {ok:/** @type {const} */(true),value:[]} : await new D1KnowledgeContentRepository({database:/** @type {import('./knowledge-workflow-content-d1.js').D1DatabasePort} */(configuration.value.sourceLibraryDatabase),logger:knowledgeWorkflowLogger}).loadImageWarnings({ownerId:command.ownerId,runId:run.runId});
        if(!warnings.ok)return warnings;
        const progress = run === null ? {ok:/** @type {const} */(true),value:null} : await new D1KnowledgeWorkflowProgressRepository({database:/** @type {import('./knowledge-workflow-d1.js').D1DatabasePort} */(configuration.value.sourceLibraryDatabase),logger:knowledgeWorkflowLogger}).read(run);
        if (!progress.ok) return progress;
        return { ok: true, value: Object.freeze({ ownerId: command.ownerId, sourceId: command.sourceId, run:run === null ? null : {...run,progress:progress.value}, imageWarnings:warnings.value }) };
      },
      ...(knowledgeWorkflowMaterialService === null ? {} : {
        material: async (/** @type {unknown} */ command) => {
          const uploaded = await knowledgeWorkflowMaterialService.upload(command);
          if (!uploaded.ok) return uploaded;
          try {
            const instance = await knowledgeWorkflowBinding.get(workflowInstanceId(uploaded.value.runId));
            await instance.sendEvent({ type: "workflow-material-ready", payload: { runId: uploaded.value.runId, materialId: uploaded.value.materialId } });
          } catch (error) {
            if (!(error instanceof Error)) throw error;
            knowledgeWorkflowLogger({ event: "knowledge-workflow-material-event-failure", failureKind: "WorkflowInstanceEventFailed", runId: uploaded.value.runId });
            return /** @type {const} */ ({ ok: false, error: { kind: "WorkflowInstanceEventFailed" } });
          }
          return uploaded;
        },
      }),
      /** @param {unknown} command */
      control: async (command) => {
        const prior = isRecord(command) && (command.action === "resume" || command.action === "retry-quizzes")
          ? await knowledgeWorkflowService.status(command)
          : null;
        if (prior !== null && !prior.ok) return prior;
      const projected = prior?.ok ? await projectKnowledgeWorkflowExecution(prior.value,knowledgeWorkflowBinding) : null;
      if(projected!==null&&!projected.ok)return projected;
      const stopped = prior?.ok && projected?.ok && isWorkflowRetryStage(prior.value.state) && projected.value.state === "retryable-failure";
      const controlled = await knowledgeWorkflowService.control(command,{executionStopped:Boolean(stopped)});
      if (!controlled.ok) return controlled;
      if (!isRecord(command) || (command.action !== "stop" && command.action !== "resume" && command.action !== "generate" && command.action !== "abandon" && command.action !== "retry-quizzes")) return controlled;
      try {
        const instance = await knowledgeWorkflowBinding.get(workflowInstanceId(controlled.value.runId));
        await deliverKnowledgeWorkflowControl(instance, command.action, Boolean(prior?.ok && prior.value.state === "completed" && ["WorkflowPagesFailed","WorkflowQuizItemsFailed"].includes(prior.value.failureKind??"")));
      } catch (error) {
        if (!(error instanceof Error)) throw error;
        const rollback = workflowControlRollback(command, stopped && projected?.ok ? projected : prior, controlled);
        if (rollback !== null) {
          const rolledBack = await knowledgeWorkflowService.advance(rollback);
          knowledgeWorkflowLogger({
            event: "knowledge-workflow-control-rollback",
            failureKind: rolledBack.ok ? "WorkflowInstanceControlFailed" : "WorkflowControlRollbackFailed",
            runId: controlled.value.runId,
            action: command.action,
          });
        }
        knowledgeWorkflowLogger({ event: "knowledge-workflow-control-failure", failureKind: "WorkflowInstanceControlFailed", diagnosticToken: workflowControlDiagnosticToken(error), runId: controlled.value.runId, action: command.action });
        return /** @type {const} */ ({ ok: false, error: { kind: "WorkflowInstanceControlFailed" } });
      }
        return controlled;
      },
      /** @param {unknown} command */
      rightsApproved: async (command) => {
        const advanced = await knowledgeWorkflowService.rightsApproved(command);
        if (!advanced.ok) return advanced;
        if ((advanced.value.state === "robots-check" || advanced.value.state === "completed") && typeof advanced.value.runId === "string" && advanced.value.runId.trim() !== "") {
          try {
            const instance = await knowledgeWorkflowBinding.get(workflowInstanceId(advanced.value.runId));
            await instance.sendEvent({ type: "rights-approved", payload: { runId: advanced.value.runId } });
          } catch (error) {
            if (!(error instanceof Error)) throw error;
            knowledgeWorkflowLogger({ event: "knowledge-workflow-rights-event-failure", failureKind: "WorkflowInstanceEventFailed", runId: advanced.value.runId });
            return /** @type {const} */ ({ ok: false, error: { kind: "WorkflowInstanceEventFailed" } });
          }
        }
        return { ok: true, value: advanced.value };
      },
      /** @param {unknown} command */
      revokeSource: (command) => knowledgeWorkflowService.revokeSource(command),
    });
  const privateDocumentRead = sourceRepository === null || knowledgeWorkflowRepository === null || knowledgeWorkflowMaterialRepository === null || manualContentStore === null
    ? null
    : createPrivateDocumentReadService({
      source: { read: (/** @type {string} */ ownerId, /** @type {string} */ sourceId) => sourceRepository.read(ownerId, sourceId) },
      workflow: { latest: async (/** @type {string} */ ownerId, /** @type {string} */ sourceId, /** @type {number} */ sourceRevision) => { const listed = await knowledgeWorkflowRepository.listBySource(ownerId, sourceId, sourceRevision); return listed.ok ? { ok: /** @type {const} */ (true), value: listed.value[0] ?? null } : listed; } },
      material: { read: (/** @type {string} */ ownerId, /** @type {string} */ runId) => knowledgeWorkflowMaterialRepository.read(ownerId, runId) },
      content: { read: (/** @type {string} */ ownerId, /** @type {string} */ objectKey) => manualContentStore.read(ownerId, objectKey) },
    });
  /** @type {((ownerId: string) => Promise<Result<readonly import("../src/features/source-library/contracts.js").LibrarySource[], unknown>>) | null} */
  const activeSourceLister = sourceRepository === null
    ? null
    : async (/** @type {string} */ ownerId) => {
      /** @type {import("../src/features/source-library/contracts.js").LibrarySource[]} */ const sources = [];
      /** @type {{ readonly approvedAt: string, readonly sourceId: string } | null} */ let after = null;
      for (let page = 0; page < 20; page += 1) {
        const listed = await sourceRepository.browseActive({ ownerId, limit: 51, after });
        if (!listed.ok) return listed;
        const pageItems = listed.value.items.slice(0, 50);
        sources.push(...pageItems);
        if (listed.value.items.length <= 50) return { ok: /** @type {const} */ (true), value: Object.freeze([...sources]) };
        const tail = pageItems.at(-1);
        if (tail === undefined) return { ok: /** @type {const} */ (false), error: { kind: "SourceCatalogReadFailed" } };
        after = { approvedAt: tail.approvedAt, sourceId: tail.id };
      }
      return { ok: /** @type {const} */ (false), error: { kind: "SourceCatalogReadFailed" } };
    };
  const knowledgeWorkflowBackfill = knowledgeWorkflow === null || activeSourceLister === null || knowledgeWorkflowConfigDigests === null
    ? null
    : createKnowledgeWorkflowBackfill({
      list: activeSourceLister,
      start: (command) => knowledgeWorkflow.start(command),
      reset: learningBatches === null ? undefined : (ownerId) => learningBatches.clearGeneratedContent(ownerId),
      invalidateReuse: (command) => /** @type {import("./knowledge-workflow-d1.js").D1KnowledgeWorkflowRepository} */ (knowledgeWorkflowRepository).invalidateReuse(command),
      marker: new D1KnowledgeWorkflowBackfillRepository({
        database: /** @type {import("./knowledge-workflow-backfill-d1.js").D1DatabasePort} */ (/** @type {unknown} */ (configuration.value.sourceLibraryDatabase)),
        logger: (entry) => knowledgeWorkflowLogger({ event: entry.event, ownerId: entry.ownerId, failureKind: entry.failureKind }),
      }),
      profileFor: sourceRightsProfileFor,
      now: () => platform.now().toISOString(),
      logger: (entry) => knowledgeWorkflowLogger({ event: entry.event, ownerId: entry.ownerId, failureKind: entry.failureKind }),
    });
  const knowledgeWorkflowReplay = knowledgeWorkflow === null || activeSourceLister === null || knowledgeWorkflowConfigDigests === null || learningBatches === null
    ? null
    : createKnowledgeWorkflowReplay({
      list: activeSourceLister,
      start: (command) => knowledgeWorkflow.start(command),
      reset: (ownerId) => learningBatches.clearGeneratedContent(ownerId),
      invalidateReuse: (command) => /** @type {import("./knowledge-workflow-d1.js").D1KnowledgeWorkflowRepository} */ (knowledgeWorkflowRepository).invalidateReuse(command),
      marker: new D1KnowledgeWorkflowBackfillRepository({
        database: /** @type {import("./knowledge-workflow-backfill-d1.js").D1DatabasePort} */ (/** @type {unknown} */ (configuration.value.sourceLibraryDatabase)),
        logger: (entry) => knowledgeWorkflowLogger({ event: entry.event, ownerId: entry.ownerId, failureKind: entry.failureKind }),
      }),
      profileFor: sourceRightsProfileFor,
      now: () => platform.now().toISOString(),
      logger: (entry) => knowledgeWorkflowLogger({ event: entry.event, ownerId: entry.ownerId, failureKind: entry.failureKind }),
    });
  const learningMediaRepository = sourceRepository === null || !isMediaBucket(environment.SOURCE_CONTENT_BUCKET) || !isCloudflareImageBinding(environment.IMAGES)
    ? null
    : new D1KnowledgeMediaRepository({
      database: /** @type {import("./knowledge-workflow-media-d1.js").D1DatabasePort} */ (/** @type {unknown} */ (configuration.value.sourceLibraryDatabase)),
      bucket: /** @type {import("./knowledge-workflow-media-d1.js").MediaBucket} */ (environment.SOURCE_CONTENT_BUCKET),
      logger: (entry) => knowledgeWorkflowLogger({ event: entry.event, ownerId: entry.ownerId, stage: "media", failureKind: entry.failureKind }),
    });
  const learningMedia = learningMediaRepository === null
    ? null
    : createMediaPipeline({
      publicEgress: platform.publicEgress ?? createMediaPublicEgress(acquisition.mediaCapability),
      digest: async (bytes) => {
        const result = await digest(bytes);
        return result.ok ? result : { ok: false, error: { kind: "MediaDigestUnavailable" } };
      },
      quarantine: {
        put: async ({ key, bytes, mediaType }) => {
          try {
            await /** @type {import("./knowledge-workflow-media-d1.js").MediaBucket} */ (environment.SOURCE_CONTENT_BUCKET).put(key, bytes, { httpMetadata: { contentType: mediaType } });
            return { ok: true, value: null };
          } catch (error) {
            if (error instanceof Error) return { ok: false, error: { kind: "MediaQuarantineFailed" } };
            throw error;
          }
        },
        remove: async (key) => {
          try {
            await /** @type {import("./knowledge-workflow-media-d1.js").MediaBucket} */ (environment.SOURCE_CONTENT_BUCKET).delete(key);
            return { ok: true, value: null };
          } catch (error) {
            if (error instanceof Error) return { ok: false, error: { kind: "MediaCleanupFailed" } };
            throw error;
          }
        },
      },
      derivatives: { create: createCloudflareImageDerivative(/** @type {import("./knowledge-workflow-media-transform.js").ImageBinding} */ (environment.IMAGES)) },
      repository: learningMediaRepository,
      createId: () => hex(/** @type {(length:number)=>Uint8Array} */ (platform.randomBytes)(16)),
      now: () => platform.now().toISOString(),
      logger: (entry) => knowledgeWorkflowLogger({ event: entry.event, ownerId: entry.ownerId, stage: "media", failureKind: entry.failureKind }),
    });
  const youtubeConfiguration = configuration.value.youtube;
  const youtubeAdapter = youtubeConfiguration.status === "unavailable"
    ? null
    : new YouTubeDiscoveryAdapter(
      { maximumResults: 20, quotaTimeZone: "America/Los_Angeles" },
      {
        fetch: platform.fetch,
        now: platform.now,
        apiKeyForSearch: () => ({ ok: true, value: youtubeConfiguration.apiKey }),
        reserveSearchQuery: ({ quotaDay }) =>
          reserveYouTubeQuota(youtubeConfiguration.quota, "search", quotaDay, 1),
        reserveGeneralRead: ({ quotaDay, units }) =>
          reserveYouTubeQuota(youtubeConfiguration.quota, "general", quotaDay, units),
      },
    );
  const centralSearch = createCentralDiscoverySearch(
    { maximumLimit: 20 },
    {
      budget: {timeoutMs:25_000, now:() => platform.now().getTime(), timeoutSignal: milliseconds => AbortSignal.timeout(milliseconds)},
      policy: createEducationalSearchPolicy({
        version: "raw-provider-v1",
        maximumSubmittedCharacters: 120,
        maximumProviderCharacters: 240,
      }),
      providers: Object.freeze([
        createBraveSearchProvider(
          {
            providerId: "web",
            label: "Web",
            resultKind: "web",
            priority: 1,
            enabled: configuration.value.braveApiKey !== null,
            maximumResults: 20,
            apiVersion: "2023-10-11",
          },
          {
            credential: () => configuration.value.braveApiKey === null
              ? { ok: false, error: { kind: /** @type {const} */ ("SearchProviderCredentialMissing") } }
              : { ok: true, value: configuration.value.braveApiKey },
            fetch: platform.fetch,
          },
        ),
        createTaddySearchProvider(
          {
            providerId: "podcasts",
            label: "Podcasts",
            resultKind: "podcast",
            priority: 2,
            enabled: configuration.value.taddy !== null,
            maximumResults: 20,
            timeoutMs: 8_000,
          },
          {
            credentials: () => configuration.value.taddy === null
              ? { ok: false, error: { kind: /** @type {const} */ ("SearchProviderCredentialMissing") } }
              : { ok: true, value: configuration.value.taddy },
            timeoutSignal: (milliseconds) => AbortSignal.timeout(milliseconds),
            fetch: platform.fetch,
          },
        ),
        createYouTubeSearchProvider(
          {
            providerId: "youtube",
            label: "YouTube videos",
            resultKind: "video",
            priority: 3,
            enabled: youtubeAdapter !== null,
          },
          {
            adapter: youtubeAdapter ?? {
              search: async () => ({ ok: false, error: { kind: /** @type {const} */ ("YouTubeCredentialMissing") } }),
            },
          },
        ),
      ]),
    },
  );
  const observedCentralSearch = instrumentCentralSearch(
    centralSearch,
    (event) => console.info(JSON.stringify(event)),
  );
  const baseWorker = createDiscoveryWorker(
    {
      allowedOrigin: configuration.value.allowedOrigin,
      maximumCommandBytes: manualConfiguration === null
        ? 32_768
        : Math.min(Number.MAX_SAFE_INTEGER, manualConfiguration.maximumBytes * 2 + 16_384),
      maximumMaterialBytes: manualConfiguration === null
        ? 32_768
        : manualConfiguration.maximumBytes,
      maximumBackendOperationMs: 4_000,
    },
    {
      authenticate: (request) => authenticator.authenticate(request),
      acquireRss: async (command, ownerId) => {
        const acquired = await rss.acquire(command);
        if (!acquired.ok || acquired.value.status === "not-modified") {
          return acquired;
        }
        const result = acquired.value;
        const references = result.feed.items.flatMap((
          /** @type {import("./contracts.js").NormalizedFeedItem} */ item,
        ) =>
          item.podcast?.transcripts.map((
            /** @type {{ readonly url: string, readonly type: string, readonly language: string | null }} */ reference,
          ) =>
            Object.freeze({
              url: reference.url,
              type: reference.type,
              language: reference.language,
              itemIdentityKey: item.identityKey,
            })
          ) ?? []
        );
        const recorded = await authorization.recordReferences({
          ownerId,
          sourceRequestId: command.requestId,
          sourceUrl: result.canonicalUrl,
          observedAt: result.retrievedAt,
          references,
        });
        return recorded.ok ? acquired : recorded;
      },
      centralSearch: observedCentralSearch,
      sourceLibrary,
      sourceCatalog: sourceCatalogForHandler,
      sourceClassification: sourceClassification === null ? null : { updateManual: (command) => sourceClassification.updateManual(/** @type {Parameters<typeof sourceClassification.updateManual>[0]} */ (command)) },
      sourceClassificationBackfill,
      sourceRename: sourceRepository === null || configuration.value.sourceLibraryDatabase === null ? null : createSourceRenameService(
        new D1SourceRenameRepository(configuration.value.sourceLibraryDatabase), sourceRepository,
        { now:()=>platform.now().toISOString(), createId:()=>crypto.randomUUID(), logger:entry=>console.info(JSON.stringify(entry)) },
      ),
      sourceRightsApproval,
      sourceIngestion,
      sourceRightsProfileFor,
      knowledgeWorkflow,
      privateDocumentRead,
      knowledgeWorkflowBackfill: knowledgeWorkflowBackfill === null
        ? null
        : { run: (command) => knowledgeWorkflowBackfill.run(isRecord(command) ? Object.freeze({ ...command, configDigests: knowledgeWorkflowConfigDigests }) : command) },
      knowledgeWorkflowReplay: knowledgeWorkflowReplay === null
        ? null
        : { run: (command) => knowledgeWorkflowReplay.run(isRecord(command) ? Object.freeze({ ...command, configDigests: knowledgeWorkflowConfigDigests }) : command) },
      learningMedia: learningMedia === null ? null : { serve: (command) => learningMedia.serve(command) },
      learningBatches,
      reminders: learningDatabase === null ? null : createReminderRuntime({environment,database:learningDatabase,now:platform.now,fetch:platform.fetch,logger:(entry)=>console.info(JSON.stringify(entry))}),
      now: () => platform.now().toISOString(),
      requestLogger: discoveryRequestLogger,
      waitUntil: platform.waitUntil,
      urlCapture:platform.urlCapture ?? (browserConfiguration===null || configuration.value.sourceLibraryDatabase===null ? undefined : createUrlPdfCapture({
        binding:/** @type {import("@cloudflare/puppeteer").BrowserWorker} */ (browserConfiguration.binding),fetch:platform.fetch,now:()=>platform.now().getTime(),logger:entry=>console.info(JSON.stringify(entry)),
        capacity:new D1BrowserRunCapacityLedger({database:/** @type {import("./browser-run-capacity-d1.js").D1DatabasePort} */(/** @type {unknown} */(configuration.value.sourceLibraryDatabase)),now:()=>platform.now().toISOString(),createId:()=>crypto.randomUUID(),policy:browserRunCapacityPolicy(browserConfiguration.accountScope)}),
      })),
      manualMaterial,
      learningGeneration: learningRepository === null || learningStatus === null || learningReview === null || learningRevocation === null
        ? null
        : { status: (command) => learningStatus.get(command), review: { decide: (command) => learningReview.decide(command), queue: (ownerId) => learningReviewQueue === null ? Promise.resolve({ ok: false, error: { kind: "LearningReviewQueuePersistenceFailed" } }) : learningReviewQueue.list(ownerId), visible: (ownerId) => learningReview.visible(ownerId) }, revoke: { revoke: (command) => learningRevocation.revoke(command) } },
    },
  );

  return {
    ok: true,
    value: Object.freeze({
      async fetch(request) {
        const requestUrl = new URL(request.url);
        const pathname = requestUrl.pathname;
        /* Legacy OAuth routes intentionally removed from the deployed graph.
        if (pathname.startsWith("/api/discovery/youtube/oauth/")) {
          return baseWorker.fetch(request);
        }
        */
        /* Historical OAuth implementation retained only until the legacy
         * export/delete migration is verified. It is not compiled as a route.
        if (pathname.startsWith("/api/discovery/youtube/oauth/")) {
          const authenticated = await authenticator.authenticate(request);
          if (!authenticated.ok) {
            return workerFailureResponse(authenticated.error);
          }
          const youtube = configuration.value.youtube;
          const oauth = await oauthService();
          if (youtube.status === "unavailable" || oauth === null) {
            return json({ error: "YouTubeCredentialMissing" }, 503);
          }
          if (pathname.endsWith("/start")) {
            if (request.method !== "POST") {
              return json({ error: "Method not allowed." }, 405, {
                Allow: "POST",
              });
            }
            const origin = request.headers.get("origin");
            if (
              origin !== null && origin !== configuration.value.allowedOrigin
            ) {
              return json({ error: "DiscoveryOriginRejected" }, 403);
            }
            const started = await oauth.start(authenticated.value.ownerId);
            return started.ok
              ? new Response(null, {
                status: 303,
                headers: {
                  location: started.value.authorizationUrl,
                  "cache-control": "no-store",
                },
              })
              : oauthFailureResponse(started.error.kind);
          }
          if (pathname.endsWith("/callback")) {
            if (request.method !== "GET") {
              return json({ error: "Method not allowed." }, 405, {
                Allow: "GET",
              });
            }
            const state = requestUrl.searchParams.get("state");
            const code = requestUrl.searchParams.get("code");
            if (
              state === null || code === null ||
              requestUrl.searchParams.has("error")
            ) {
              return oauthFailureResponse("OAuthInputInvalid");
            }
            const completed = await oauth.complete({
              ownerId: authenticated.value.ownerId,
              state,
              code,
            });
            return completed.ok
              ? new Response(null, {
                status: 303,
                headers: {
                  location:
                    `${configuration.value.allowedOrigin}/?youtube=connected#discover`,
                  "cache-control": "no-store",
                },
              })
              : oauthFailureResponse(completed.error.kind);
          }
          if (pathname.endsWith("/connection")) {
            if (request.method !== "GET") {
              return json({ error: "Method not allowed." }, 405, {
                Allow: "GET",
              });
            }
            const connection = await oauth.getConnection(
              authenticated.value.ownerId,
            );
            return connection.ok
              ? json({ connection: connection.value }, 200)
              : oauthFailureResponse(connection.error.kind);
          }
          if (pathname.endsWith("/disconnect")) {
            if (request.method !== "POST") {
              return json({ error: "Method not allowed." }, 405, {
                Allow: "POST",
              });
            }
            const origin = request.headers.get("origin");
            if (
              origin !== null && origin !== configuration.value.allowedOrigin
            ) return json({ error: "DiscoveryOriginRejected" }, 403);
            const revoked = await oauth.revoke(authenticated.value.ownerId);
            return revoked.ok
              ? json({ connection: revoked.value }, 200)
              : oauthFailureResponse(revoked.error.kind);
          }
          return json({ error: "Not found." }, 404);
        }
        */
        if (
          pathname !== "/api/discovery/publisher-transcript" &&
          pathname !== "/api/discovery/publisher-transcript/authorize"
        ) {
          return baseWorker.fetch(request);
        }
        const authenticated = await authenticator.authenticate(request);
        if (!authenticated.ok) {
          return workerFailureResponse(authenticated.error);
        }
        const command = await readTranscriptCommand(
          request,
          configuration.value.allowedOrigin,
          32_768,
        );
        if (!command.ok) return command.error;
        if (pathname.endsWith("/authorize")) {
          const authorizationCommand = validateAuthorizationRequest(
            command.value,
            authenticated.value.ownerId,
          );
          if (!authorizationCommand.ok) return authorizationCommand.error;
          const persisted = await authorization.authorize(
            authorizationCommand.value,
          );
          return persisted.ok
            ? json({ ownerId: authenticated.value.ownerId, stored: true }, 201)
            : authorizationFailureResponse(persisted.error.kind);
        }
        const lookup = validateTranscriptRetrievalRequest(command.value);
        if (!lookup.ok) return lookup.error;
        const resolved = await authorization.resolve(
          authenticated.value.ownerId,
          {
            evidenceId: lookup.value.evidenceId,
            transcriptUrl: lookup.value.transcriptUrl,
          },
        );
        if (!resolved.ok) {
          return authorizationFailureResponse(resolved.error.kind);
        }
        if (resolved.value.access !== "allowed") {
          return authorizationFailureResponse(
            "TranscriptAuthorizationAccessNotPermitted",
          );
        }
        const retrieved = await transcript.retrieve({
          requestId: lookup.value.requestId,
          transcriptUrl: lookup.value.transcriptUrl,
          language: lookup.value.language,
          rights: resolved.value,
          jsonTextPath: lookup.value.jsonTextPath,
          retention: lookup.value.retention,
        });
        return retrieved.ok
          ? json({
            ownerId: authenticated.value.ownerId,
            result: retrieved.value,
          }, 200)
          : transcriptFailureResponse(retrieved.error.kind);
      },
    }),
  };
}

/**
 * @param {DiscoveryWorkerEnvironment} environment
 * @returns {Result<{
 *   readonly allowedOrigin: string,
 *   readonly accessIssuer: string,
 *   readonly accessAudience: string,
 *   readonly ownerEmail: string,
 *   readonly ownerId: string,
 *   readonly transcriptLanguages: ReadonlySet<string>,
 *   readonly youtube: { readonly status: "unavailable" } | {
 *     readonly status: "configured",
 *     readonly apiKey: string,
 *     readonly quota: QuotaReservationBinding,
 *   },
 *   readonly braveApiKey: string | null,
 *   readonly taddy: { readonly userId: string, readonly apiKey: string } | null,
 *   readonly transcriptAuthorization: QuotaReservationBinding,
 *   readonly sourceLibraryDatabase: import("./source-library-d1.js").D1DatabasePort | null,
 *   readonly sourceIngestionPolicyVersion: string | null,
 *   readonly sourceCursorSecret: string | null,
 *   readonly manualMaterial: null | { readonly bucket: import("./source-content-r2.js").R2BucketPort, readonly maximumBytes: number, readonly maximumCharacters: number, readonly mediaTypes: ReadonlySet<string>, readonly capacityPolicy: {readonly accountScope:string,readonly storedBytesLimit:number,readonly classAMonthlyLimit:number,readonly classBMonthlyLimit:number,readonly observationMaximumAgeMs:number} },
 *   readonly browserRun: null | { readonly binding: object | Function, readonly accountScope: string },
 *   readonly openRouterApiKey: string | null,
 *   readonly learningCost: { readonly inputUsdPerMillionTokens: number, readonly outputUsdPerMillionTokens: number },
 *   readonly knowledgeWorkflowConfigDigests: Readonly<Record<string, string>> | null,
 *   readonly knowledgeWorkflowEnabled: boolean,
 * }, DiscoveryCompositionFailure>}
 */
function parseEnvironment(environment) {
  const required = /** @type {const} */ ([
    "ALLOWED_ORIGIN",
    "ACCESS_ISSUER",
    "ACCESS_AUDIENCE",
    "ACCESS_OWNER_EMAIL",
    "ACCESS_OWNER_ID",
    "TRANSCRIPT_LANGUAGES",
  ]);
  for (const field of required) {
    if (environment[field] === undefined) {
      return {
        ok: false,
        error: { kind: "DiscoveryDeploymentConfigurationMissing", field },
      };
    }
    if (
      typeof environment[field] !== "string" || environment[field].trim() === ""
    ) {
      return {
        ok: false,
        error: { kind: "DiscoveryDeploymentConfigurationInvalid", field },
      };
    }
  }
  const transcriptAuthorization = resolveTranscriptAuthorizationBinding(
    environment,
  );
  if (!transcriptAuthorization.ok) return transcriptAuthorization;
  if (
    environment.SOURCE_LIBRARY_DB !== undefined &&
    !isD1Database(environment.SOURCE_LIBRARY_DB)
  ) {
    return {
      ok: false,
      error: {
        kind: "DiscoveryDeploymentConfigurationInvalid",
        field: "SOURCE_LIBRARY_DB",
      },
    };
  }
  const manualMaterial = resolveManualMaterialConfiguration(environment);
  if (!manualMaterial.ok) return manualMaterial;
  const browserRun = resolveBrowserRunConfiguration(environment);
  if (!browserRun.ok) return browserRun;
  const knowledgeWorkflowConfigDigests = resolveKnowledgeWorkflowConfigDigests(environment);
  if (!knowledgeWorkflowConfigDigests.ok) return knowledgeWorkflowConfigDigests;
  const braveApiKey = optionalSecret(environment.BRAVE_SEARCH_API_KEY);
  if (!braveApiKey.ok) {
    return { ok: false, error: { kind: "DiscoveryDeploymentConfigurationInvalid", field: "BRAVE_SEARCH_API_KEY" } };
  }
  const openRouterApiKey = optionalSecret(environment.OPENROUTER_API_KEY);
  if (!openRouterApiKey.ok) {
    return { ok: false, error: { kind: "DiscoveryDeploymentConfigurationInvalid", field: "OPENROUTER_API_KEY" } };
  }
  const learningInputRate = optionalRate(environment.OPENROUTER_INPUT_USD_PER_MILLION, 1);
  if (!learningInputRate.ok) return { ok: false, error: { kind: "DiscoveryDeploymentConfigurationInvalid", field: "OPENROUTER_INPUT_USD_PER_MILLION" } };
  const learningOutputRate = optionalRate(environment.OPENROUTER_OUTPUT_USD_PER_MILLION, 1);
  if (!learningOutputRate.ok) return { ok: false, error: { kind: "DiscoveryDeploymentConfigurationInvalid", field: "OPENROUTER_OUTPUT_USD_PER_MILLION" } };
  const taddy = taddyCredentials(
    environment.TADDY_USER_ID,
    environment.TADDY_API_KEY,
  );
  if (!taddy.ok) {
    return { ok: false, error: { kind: "DiscoveryDeploymentConfigurationInvalid", field: taddy.error.field } };
  }
  if (
    environment.SOURCE_LIBRARY_DB !== undefined &&
    (typeof environment.SOURCE_CURSOR_SECRET !== "string" ||
      environment.SOURCE_CURSOR_SECRET.length < 32)
  ) {
    return {
      ok: false,
      error: {
        kind: environment.SOURCE_CURSOR_SECRET === undefined
          ? "DiscoveryDeploymentConfigurationMissing"
          : "DiscoveryDeploymentConfigurationInvalid",
        field: "SOURCE_CURSOR_SECRET",
      },
    };
  }
  if (
    environment.SOURCE_LIBRARY_DB !== undefined &&
    (typeof environment.SOURCE_INGESTION_POLICY_VERSION !== "string" ||
      environment.SOURCE_INGESTION_POLICY_VERSION.trim() === "")
  ) {
    return {
      ok: false,
      error: {
        kind: environment.SOURCE_INGESTION_POLICY_VERSION === undefined
          ? "DiscoveryDeploymentConfigurationMissing"
          : "DiscoveryDeploymentConfigurationInvalid",
        field: "SOURCE_INGESTION_POLICY_VERSION",
      },
    };
  }
  const allowedOrigin = /** @type {string} */ (environment.ALLOWED_ORIGIN);
  const accessIssuer = /** @type {string} */ (environment.ACCESS_ISSUER);
  if (!isOrigin(allowedOrigin)) {
    return {
      ok: false,
      error: {
        kind: "DiscoveryDeploymentConfigurationInvalid",
        field: "ALLOWED_ORIGIN",
      },
    };
  }
  if (!isOrigin(accessIssuer)) {
    return {
      ok: false,
      error: {
        kind: "DiscoveryDeploymentConfigurationInvalid",
        field: "ACCESS_ISSUER",
      },
    };
  }
  const transcriptLanguages = new Set(
    /** @type {string} */ (environment.TRANSCRIPT_LANGUAGES)
      .split(",").map((language) => language.trim()).filter((language) =>
        language !== ""
      ),
  );
  if (transcriptLanguages.size === 0) {
    return {
      ok: false,
      error: {
        kind: "DiscoveryDeploymentConfigurationInvalid",
        field: "TRANSCRIPT_LANGUAGES",
      },
    };
  }
  return {
    ok: true,
    value: Object.freeze({
      allowedOrigin,
      accessIssuer,
      accessAudience: /** @type {string} */ (environment.ACCESS_AUDIENCE),
      ownerEmail: /** @type {string} */ (environment.ACCESS_OWNER_EMAIL),
      ownerId: /** @type {string} */ (environment.ACCESS_OWNER_ID),
      transcriptLanguages,
      youtube: resolveYoutubeConfiguration(environment),
      braveApiKey: braveApiKey.value,
      openRouterApiKey: openRouterApiKey.value,
      learningCost: Object.freeze({ inputUsdPerMillionTokens: learningInputRate.value, outputUsdPerMillionTokens: learningOutputRate.value }),
      taddy: taddy.value,
      transcriptAuthorization: transcriptAuthorization.value,
      sourceLibraryDatabase: environment.SOURCE_LIBRARY_DB === undefined
        ? null
        : environment.SOURCE_LIBRARY_DB,
      sourceIngestionPolicyVersion:
        typeof environment.SOURCE_INGESTION_POLICY_VERSION === "string"
          ? environment.SOURCE_INGESTION_POLICY_VERSION.trim()
          : null,
      sourceCursorSecret: typeof environment.SOURCE_CURSOR_SECRET === "string"
        ? environment.SOURCE_CURSOR_SECRET
        : null,
      manualMaterial: manualMaterial.value,
      browserRun: browserRun.value,
      knowledgeWorkflowConfigDigests: knowledgeWorkflowConfigDigests.value,
      knowledgeWorkflowEnabled: resolveKnowledgeWorkflowEnabled(environment),
    }),
  };
}

/**
 * Workflow configuration digests are deployment configuration, not secrets.
 * Requiring all four role digests when the Workflow binding is present keeps a
 * deployed run tied to the reviewed YAML snapshots.
 * @param {DiscoveryWorkerEnvironment} environment
 * @returns {Result<Readonly<Record<string, string>> | null, DiscoveryCompositionFailure>}
 */
function resolveKnowledgeWorkflowConfigDigests(environment) {
  const workflowConfigured = environment.KNOWLEDGE_WORKFLOW !== undefined;
  if (workflowConfigured && !isKnowledgeWorkflowBinding(environment.KNOWLEDGE_WORKFLOW)) {
    return { ok: false, error: { kind: "DiscoveryDeploymentConfigurationInvalid", field: "KNOWLEDGE_WORKFLOW" } };
  }
  if (environment.KNOWLEDGE_WORKFLOW_CONFIG_DIGESTS === undefined) {
    return workflowConfigured
      ? { ok: false, error: { kind: "DiscoveryDeploymentConfigurationMissing", field: "KNOWLEDGE_WORKFLOW_CONFIG_DIGESTS" } }
      : { ok: true, value: null };
  }
  if (typeof environment.KNOWLEDGE_WORKFLOW_CONFIG_DIGESTS !== "string" || environment.KNOWLEDGE_WORKFLOW_CONFIG_DIGESTS.trim() === "") {
    return { ok: false, error: { kind: "DiscoveryDeploymentConfigurationInvalid", field: "KNOWLEDGE_WORKFLOW_CONFIG_DIGESTS" } };
  }
  let parsed;
  try {
    parsed = JSON.parse(environment.KNOWLEDGE_WORKFLOW_CONFIG_DIGESTS);
  } catch (error) {
    if (error instanceof SyntaxError) return { ok: false, error: { kind: "DiscoveryDeploymentConfigurationInvalid", field: "KNOWLEDGE_WORKFLOW_CONFIG_DIGESTS" } };
    throw error;
  }
  if (!isRecord(parsed)) return { ok: false, error: { kind: "DiscoveryDeploymentConfigurationInvalid", field: "KNOWLEDGE_WORKFLOW_CONFIG_DIGESTS" } };
  const roles = ["rights-assessor", "knowledge-scraper", "question-generator", "question-evaluator"];
  const keys = Object.keys(parsed);
  if (keys.length !== roles.length || roles.some((role) => !Object.hasOwn(parsed, role))) {
    return { ok: false, error: { kind: "DiscoveryDeploymentConfigurationInvalid", field: "KNOWLEDGE_WORKFLOW_CONFIG_DIGESTS" } };
  }
  /** @type {Record<string, string>} */
  const digests = {};
  for (const role of roles) {
    const digest = parsed[role];
    if (typeof digest !== "string" || !/^sha256:[0-9a-f]{64}$/.test(digest)) {
      return { ok: false, error: { kind: "DiscoveryDeploymentConfigurationInvalid", field: `KNOWLEDGE_WORKFLOW_CONFIG_DIGESTS.${role}` } };
    }
    digests[role] = digest;
  }
  return { ok: true, value: Object.freeze(digests) };
}

/** @param {DiscoveryWorkerEnvironment} environment @returns {boolean} */
function resolveKnowledgeWorkflowEnabled(environment) {
  if (environment.KNOWLEDGE_WORKFLOW_ENABLED === undefined) return false;
  if (typeof environment.KNOWLEDGE_WORKFLOW_ENABLED !== "string") throw new TypeError("KNOWLEDGE_WORKFLOW_ENABLED must be a string.");
  if (environment.KNOWLEDGE_WORKFLOW_ENABLED === "true") return true;
  if (environment.KNOWLEDGE_WORKFLOW_ENABLED === "false") return false;
  throw new TypeError("KNOWLEDGE_WORKFLOW_ENABLED must be true or false.");
}

/** @param {unknown} value @returns {Result<string|null,{readonly kind:"SecretInvalid"}>} */
function optionalSecret(value) {
  if (value === undefined) return { ok: true, value: null };
  return typeof value === "string" && value.trim() !== ""
    ? { ok: true, value }
    : { ok: false, error: { kind: "SecretInvalid" } };
}

/** @param {unknown} value @param {number} defaultValue @returns {Result<number, { readonly kind: "RateInvalid" }>} */
function optionalRate(value, defaultValue) {
  if (value === undefined) return { ok: true, value: defaultValue };
  if (typeof value !== "string" || value.trim() === "" || !Number.isFinite(Number(value)) || Number(value) <= 0) return { ok: false, error: { kind: "RateInvalid" } };
  return { ok: true, value: Number(value) };
}

/** @param {unknown} userId @param {unknown} apiKey @returns {Result<{readonly userId:string,readonly apiKey:string}|null,{readonly kind:"SecretPairInvalid",readonly field:string}>} */
function taddyCredentials(userId, apiKey) {
  if (userId === undefined && apiKey === undefined) return { ok: true, value: null };
  if (typeof userId !== "string" || userId.trim() === "") {
    return { ok: false, error: { kind: "SecretPairInvalid", field: "TADDY_USER_ID" } };
  }
  if (typeof apiKey !== "string" || apiKey.trim() === "") {
    return { ok: false, error: { kind: "SecretPairInvalid", field: "TADDY_API_KEY" } };
  }
  return { ok: true, value: Object.freeze({ userId, apiKey }) };
}

/** @param {DiscoveryWorkerEnvironment} environment @returns {Result<null | { readonly binding: object | Function, readonly accountScope: string }, DiscoveryCompositionFailure>} */
function resolveBrowserRunConfiguration(environment) {
  if (environment.SOURCE_BROWSER === undefined) return { ok: true, value: null };
  if ((typeof environment.SOURCE_BROWSER !== "object" && typeof environment.SOURCE_BROWSER !== "function") || environment.SOURCE_BROWSER === null) {
    return { ok: false, error: { kind: "DiscoveryDeploymentConfigurationInvalid", field: "SOURCE_BROWSER" } };
  }
  if (environment.SOURCE_LIBRARY_DB === undefined) return { ok: false, error: { kind: "DiscoveryDeploymentConfigurationMissing", field: "SOURCE_LIBRARY_DB" } };
  if (environment.SOURCE_CONTENT_BUCKET === undefined) return { ok: false, error: { kind: "DiscoveryDeploymentConfigurationMissing", field: "SOURCE_CONTENT_BUCKET" } };
  if (typeof environment.SOURCE_BROWSER_ACCOUNT_SCOPE !== "string" || environment.SOURCE_BROWSER_ACCOUNT_SCOPE.trim() === "") {
    return { ok: false, error: { kind: environment.SOURCE_BROWSER_ACCOUNT_SCOPE === undefined ? "DiscoveryDeploymentConfigurationMissing" : "DiscoveryDeploymentConfigurationInvalid", field: "SOURCE_BROWSER_ACCOUNT_SCOPE" } };
  }
  return { ok: true, value: Object.freeze({ binding: environment.SOURCE_BROWSER, accountScope: environment.SOURCE_BROWSER_ACCOUNT_SCOPE.trim() }) };
}

/** Approved Sequence 3 Option B Free-plan limits, injected at the composition boundary. @param {string} version */
function browserRunSourcePolicy(version) {
  return Object.freeze({ version, initialDepth: 2, maximumDepth: 5, maximumPages: 5, maximumDecodedBytes: 1_000_000, maximumConcurrency: 1, maximumDurationMs: 60_000, maximumRedirects: 3, refreshIntervalMs: 604_800_000 });
}

/** Approved Sequence 3 account-level Browser Run reservation policy. @param {string} accountScope */
function browserRunCapacityPolicy(accountScope) {
  return Object.freeze({ accountScope, dailyLimitMilliseconds: 600_000, maximumConcurrentSessions: 1, minimumLaunchIntervalMilliseconds: 20_000, reservationMilliseconds: 60_000 });
}

/** Approved bounded DOM-extraction policy. */
function browserRunAcquisitionPolicy() {
  return Object.freeze({ maximumPagesPerRun: 5, maximumRunMilliseconds: 60_000, navigationTimeoutMilliseconds: 15_000, maximumHtmlBytes: 1_000_000, maximumTextCharacters: 250_000, maximumLinksPerPage: 100, maximumFrontierEntries: 500 });
}

/** @param {string} hostname @param {typeof fetch} fetchDependency @returns {Promise<import("../src/features/source-library/ingestion-contracts.js").Result<readonly string[], import("../src/features/source-library/ingestion-contracts.js").SourceIngestionFailure>>} */
async function resolveAddresses(hostname, fetchDependency) {
  if (!/^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(hostname)) return { ok: false, error: { kind: "CrawlDestinationRejected", reason: "hostname" } };
  try {
    const responses = await Promise.all(["A", "AAAA"].map((type) => fetchDependency(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=${type}`, { headers: { accept: "application/dns-json" } })));
    const addresses = [];
    for (const response of responses) {
      if (!response.ok) return { ok: false, error: { kind: "CrawlFetchUnavailable" } };
      const document = /** @type {unknown} */ (await response.json());
      if (!isRecord(document) || (document.Status !== 0 && document.Status !== 3) || (document.Answer !== undefined && !Array.isArray(document.Answer))) return { ok: false, error: { kind: "CrawlFetchUnavailable" } };
      for (const answer of Array.isArray(document.Answer) ? document.Answer : []) {
        if (isRecord(answer) && (answer.type === 1 || answer.type === 28) && typeof answer.data === "string") addresses.push(answer.data);
      }
    }
    return { ok: true, value: Object.freeze(addresses) };
  } catch (error) {
    if (error instanceof Error) return { ok: false, error: { kind: "CrawlFetchUnavailable" } };
    throw error;
  }
}

/** @param {DiscoveryWorkerEnvironment} environment @returns {Result<null | { readonly bucket: import("./source-content-r2.js").R2BucketPort, readonly maximumBytes: number, readonly maximumCharacters: number, readonly mediaTypes: ReadonlySet<string>, readonly capacityPolicy: {readonly accountScope:string,readonly storedBytesLimit:number,readonly classAMonthlyLimit:number,readonly classBMonthlyLimit:number,readonly observationMaximumAgeMs:number} }, DiscoveryCompositionFailure>} */
function resolveManualMaterialConfiguration(environment) {
  if (environment.SOURCE_CONTENT_BUCKET === undefined) return { ok: true, value: null };
  if (!isR2Bucket(environment.SOURCE_CONTENT_BUCKET)) return { ok: false, error: { kind: "DiscoveryDeploymentConfigurationInvalid", field: "SOURCE_CONTENT_BUCKET" } };
  if (environment.SOURCE_LIBRARY_DB === undefined) return { ok: false, error: { kind: "DiscoveryDeploymentConfigurationMissing", field: "SOURCE_LIBRARY_DB" } };
  const bytes = typeof environment.SOURCE_MANUAL_MAX_BYTES === "string" && positiveIntegerText(environment.SOURCE_MANUAL_MAX_BYTES) ? Number(environment.SOURCE_MANUAL_MAX_BYTES) : null;
  const characters = typeof environment.SOURCE_MANUAL_MAX_CHARACTERS === "string" && positiveIntegerText(environment.SOURCE_MANUAL_MAX_CHARACTERS) ? Number(environment.SOURCE_MANUAL_MAX_CHARACTERS) : null;
  const mediaTypes = typeof environment.SOURCE_MANUAL_MEDIA_TYPES === "string" ? new Set(environment.SOURCE_MANUAL_MEDIA_TYPES.split(",").map((value) => value.trim().toLowerCase()).filter((value) => value.startsWith("text/") || ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(value))) : new Set();
  const capacityFields = /** @type {const} */ ([
    "SOURCE_R2_ACCOUNT_SCOPE",
    "SOURCE_R2_STORED_BYTES_LIMIT",
    "SOURCE_R2_CLASS_A_MONTHLY_LIMIT",
    "SOURCE_R2_CLASS_B_MONTHLY_LIMIT",
    "SOURCE_R2_OBSERVATION_MAX_AGE_MS",
  ]);
  const invalidCapacity = capacityFields.find((field) =>
    typeof environment[field] !== "string" ||
    environment[field].trim() === "" ||
    (field !== "SOURCE_R2_ACCOUNT_SCOPE" &&
      !positiveIntegerText(environment[field]))
  );
  if (bytes === null || characters === null || mediaTypes.size === 0 || invalidCapacity !== undefined) {
    const field = bytes === null ? "SOURCE_MANUAL_MAX_BYTES" : characters === null ? "SOURCE_MANUAL_MAX_CHARACTERS" : mediaTypes.size === 0 ? "SOURCE_MANUAL_MEDIA_TYPES" : /** @type {NonNullable<typeof invalidCapacity>} */ (invalidCapacity);
    return { ok: false, error: { kind: environment[field] === undefined ? "DiscoveryDeploymentConfigurationMissing" : "DiscoveryDeploymentConfigurationInvalid", field } };
  }
  return { ok: true, value: Object.freeze({
    bucket: environment.SOURCE_CONTENT_BUCKET,
    maximumBytes: bytes,
    maximumCharacters: characters,
    mediaTypes,
    capacityPolicy: Object.freeze({
      accountScope: /** @type {string} */ (environment.SOURCE_R2_ACCOUNT_SCOPE).trim(),
      storedBytesLimit: Number(environment.SOURCE_R2_STORED_BYTES_LIMIT),
      classAMonthlyLimit: Number(environment.SOURCE_R2_CLASS_A_MONTHLY_LIMIT),
      classBMonthlyLimit: Number(environment.SOURCE_R2_CLASS_B_MONTHLY_LIMIT),
      observationMaximumAgeMs: Number(environment.SOURCE_R2_OBSERVATION_MAX_AGE_MS),
    }),
  }) };
}

/**
 * Tests and non-Cloudflare compositions may inject a fetch-shaped quota port.
 * Production resolves one stable SQLite Durable Object for both quota buckets.
 *
 * @param {DiscoveryWorkerEnvironment} environment
 * @returns {Result<QuotaReservationBinding, DiscoveryCompositionFailure>}
 */
function resolveQuotaBinding(environment) {
  if (environment.YOUTUBE_QUOTA !== undefined) {
    return isQuotaBinding(environment.YOUTUBE_QUOTA)
      ? { ok: true, value: environment.YOUTUBE_QUOTA }
      : {
        ok: false,
        error: {
          kind: "DiscoveryDeploymentConfigurationInvalid",
          field: "YOUTUBE_QUOTA",
        },
      };
  }
  if (environment.YOUTUBE_QUOTA_LEDGER === undefined) {
    return {
      ok: false,
      error: {
        kind: "DiscoveryDeploymentConfigurationMissing",
        field: "YOUTUBE_QUOTA_LEDGER",
      },
    };
  }
  if (!isQuotaNamespace(environment.YOUTUBE_QUOTA_LEDGER)) {
    return {
      ok: false,
      error: {
        kind: "DiscoveryDeploymentConfigurationInvalid",
        field: "YOUTUBE_QUOTA_LEDGER",
      },
    };
  }
  try {
    const id = environment.YOUTUBE_QUOTA_LEDGER.idFromName(
      "youtube-api-daily-quota",
    );
    const stub = environment.YOUTUBE_QUOTA_LEDGER.get(id);
    return isQuotaBinding(stub) ? { ok: true, value: stub } : {
      ok: false,
      error: {
        kind: "DiscoveryDeploymentConfigurationInvalid",
        field: "YOUTUBE_QUOTA_LEDGER",
      },
    };
  } catch (error) {
    if (error instanceof Error) {
      return {
        ok: false,
        error: {
          kind: "DiscoveryDeploymentConfigurationInvalid",
          field: "YOUTUBE_QUOTA_LEDGER",
        },
      };
    }
    throw error;
  }
}

/** @param {DiscoveryWorkerEnvironment} environment */
function resolveYoutubeConfiguration(environment) {
  const fields = /** @type {const} */ ([
    "YOUTUBE_SEARCH_DAILY_LIMIT",
    "YOUTUBE_GENERAL_DAILY_LIMIT",
    "YOUTUBE_API_KEY",
  ]);
  if (
    fields.some((field) =>
      typeof environment[field] !== "string" || environment[field].trim() === ""
    )
  ) {
    return /** @type {const} */ ({ status: "unavailable" });
  }
  const searchLimit =
    /** @type {string} */ (environment.YOUTUBE_SEARCH_DAILY_LIMIT);
  const generalLimit =
    /** @type {string} */ (environment.YOUTUBE_GENERAL_DAILY_LIMIT);
  const quota = resolveQuotaBinding(environment);
  if (
    !positiveIntegerText(searchLimit) || !positiveIntegerText(generalLimit) ||
    !quota.ok
  ) {
    return /** @type {const} */ ({ status: "unavailable" });
  }
  return Object.freeze({
    status: /** @type {const} */ ("configured"),
    apiKey: /** @type {string} */ (environment.YOUTUBE_API_KEY),
    quota: quota.value,
  });
}

/** @param {DiscoveryWorkerEnvironment} environment @returns {Result<QuotaReservationBinding, DiscoveryCompositionFailure>} */
function resolveOAuthStoreBinding(environment) {
  if (environment.YOUTUBE_OAUTH_STORE !== undefined) {
    return isQuotaBinding(environment.YOUTUBE_OAUTH_STORE)
      ? { ok: true, value: environment.YOUTUBE_OAUTH_STORE }
      : {
        ok: false,
        error: {
          kind: "DiscoveryDeploymentConfigurationInvalid",
          field: "YOUTUBE_OAUTH_STORE",
        },
      };
  }
  if (!isQuotaNamespace(environment.YOUTUBE_OAUTH_LEDGER)) {
    return {
      ok: false,
      error: {
        kind: "DiscoveryDeploymentConfigurationMissing",
        field: "YOUTUBE_OAUTH_LEDGER",
      },
    };
  }
  try {
    const id = environment.YOUTUBE_OAUTH_LEDGER.idFromName(
      "youtube-oauth-owner-connections",
    );
    const stub = environment.YOUTUBE_OAUTH_LEDGER.get(id);
    return isQuotaBinding(stub) ? { ok: true, value: stub } : {
      ok: false,
      error: {
        kind: "DiscoveryDeploymentConfigurationInvalid",
        field: "YOUTUBE_OAUTH_LEDGER",
      },
    };
  } catch (error) {
    if (error instanceof Error) {
      return {
        ok: false,
        error: {
          kind: "DiscoveryDeploymentConfigurationInvalid",
          field: "YOUTUBE_OAUTH_LEDGER",
        },
      };
    }
    throw error;
  }
}

/**
 * @param {DiscoveryWorkerEnvironment} environment
 * @returns {Result<QuotaReservationBinding, DiscoveryCompositionFailure>}
 */
function resolveTranscriptAuthorizationBinding(environment) {
  if (environment.TRANSCRIPT_AUTHORIZATION !== undefined) {
    return isQuotaBinding(environment.TRANSCRIPT_AUTHORIZATION)
      ? { ok: true, value: environment.TRANSCRIPT_AUTHORIZATION }
      : {
        ok: false,
        error: {
          kind: "DiscoveryDeploymentConfigurationInvalid",
          field: "TRANSCRIPT_AUTHORIZATION",
        },
      };
  }
  if (environment.TRANSCRIPT_AUTHORIZATION_LEDGER === undefined) {
    return {
      ok: false,
      error: {
        kind: "DiscoveryDeploymentConfigurationMissing",
        field: "TRANSCRIPT_AUTHORIZATION_LEDGER",
      },
    };
  }
  if (!isQuotaNamespace(environment.TRANSCRIPT_AUTHORIZATION_LEDGER)) {
    return {
      ok: false,
      error: {
        kind: "DiscoveryDeploymentConfigurationInvalid",
        field: "TRANSCRIPT_AUTHORIZATION_LEDGER",
      },
    };
  }
  try {
    const id = environment.TRANSCRIPT_AUTHORIZATION_LEDGER.idFromName(
      "publisher-transcript-rights",
    );
    const stub = environment.TRANSCRIPT_AUTHORIZATION_LEDGER.get(id);
    return isQuotaBinding(stub) ? { ok: true, value: stub } : {
      ok: false,
      error: {
        kind: "DiscoveryDeploymentConfigurationInvalid",
        field: "TRANSCRIPT_AUTHORIZATION_LEDGER",
      },
    };
  } catch (error) {
    if (error instanceof Error) {
      return {
        ok: false,
        error: {
          kind: "DiscoveryDeploymentConfigurationInvalid",
          field: "TRANSCRIPT_AUTHORIZATION_LEDGER",
        },
      };
    }
    throw error;
  }
}

/**
 * @param {Request} request
 * @param {number} maximumBytes
 * @returns {Promise<Result<{ readonly bucket: "search" | "general", readonly quotaDay: string, readonly units: number }, Response>>}
 */
async function readQuotaCommand(request, maximumBytes) {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maximumBytes) {
    return {
      ok: false,
      error: json({ error: "QuotaCommandTooLarge" }, 413),
    };
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maximumBytes) {
    return {
      ok: false,
      error: json({ error: "QuotaCommandTooLarge" }, 413),
    };
  }
  /** @type {unknown} */
  let document;
  try {
    document = JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) {
      return {
        ok: false,
        error: json({ error: "QuotaCommandInvalid", field: "body" }, 400),
      };
    }
    throw error;
  }
  if (
    !isRecord(document) ||
    Object.keys(document).sort().join(",") !== "bucket,quotaDay,units"
  ) {
    return {
      ok: false,
      error: json({ error: "QuotaCommandInvalid", field: "body" }, 400),
    };
  }
  if (document.bucket !== "search" && document.bucket !== "general") {
    return {
      ok: false,
      error: json({ error: "QuotaCommandInvalid", field: "bucket" }, 400),
    };
  }
  if (
    typeof document.quotaDay !== "string" || !validUtcDay(document.quotaDay)
  ) {
    return {
      ok: false,
      error: json({ error: "QuotaCommandInvalid", field: "quotaDay" }, 400),
    };
  }
  if (
    typeof document.units !== "number" ||
    !Number.isSafeInteger(document.units) ||
    document.units < 1
  ) {
    return {
      ok: false,
      error: json({ error: "QuotaCommandInvalid", field: "units" }, 400),
    };
  }
  return {
    ok: true,
    value: Object.freeze({
      bucket: document.bucket,
      quotaDay: document.quotaDay,
      units: document.units,
    }),
  };
}

/**
 * @param {QuotaReservationBinding} binding
 * @param {"search" | "general"} bucket
 * @param {string} quotaDay
 * @param {number} units
 * @returns {Promise<Result<number, WorkerFailure>>}
 */
async function reserveYouTubeQuota(binding, bucket, quotaDay, units) {
  /** @type {Response} */
  let response;
  try {
    response = await binding.fetch(
      "https://youtube-quota.internal/reservations",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bucket, quotaDay, units }),
      },
    );
  } catch (error) {
    if (error instanceof Error) {
      return { ok: false, error: { kind: "DiscoveryFetchUnavailable" } };
    }
    throw error;
  }
  if (response.status === 429) {
    return {
      ok: false,
      error: {
        kind: bucket === "search"
          ? "YouTubeSearchQuotaExceeded"
          : "YouTubeGeneralQuotaExceeded",
      },
    };
  }
  if (!response.ok) {
    return { ok: false, error: { kind: "DiscoveryFetchUnavailable" } };
  }
  /** @type {unknown} */
  let document;
  try {
    document = await response.json();
  } catch (error) {
    if (error instanceof SyntaxError) {
      return { ok: false, error: { kind: "YouTubeResponseInvalid" } };
    }
    throw error;
  }
  if (
    !isRecord(document) || typeof document.used !== "number" ||
    !Number.isInteger(document.used) || document.used < 1
  ) {
    return { ok: false, error: { kind: "YouTubeResponseInvalid" } };
  }
  return { ok: true, value: document.used };
}

/**
 * @param {{ readonly status: "unavailable" } | { readonly status: "configured", readonly clientId: string, readonly clientSecret: string, readonly redirectUri: string, readonly scopes: readonly string[], readonly keyVersion: string, readonly encryptionKey: string, readonly oauthStore: QuotaReservationBinding }} configuration
 * @param {CloudflarePlatform} platform
 */
async function createOAuthService(configuration, platform) {
  if (
    configuration.status === "unavailable" ||
    typeof platform.randomBytes !== "function"
  ) return null;
  const bytes = decodeBase64Url(configuration.encryptionKey);
  if (bytes === null || bytes.byteLength !== 32) return null;
  try {
    const key = await platform.subtle.importKey(
      "raw",
      bytes,
      { name: "AES-GCM" },
      false,
      ["encrypt", "decrypt"],
    );
    const store = new DurableYouTubeOAuthStore(configuration.oauthStore);
    return new YouTubeOAuthService({
      authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenEndpoint: "https://oauth2.googleapis.com/token",
      revocationEndpoint: "https://oauth2.googleapis.com/revoke",
      issuer: "https://accounts.google.com",
      clientId: configuration.clientId,
      clientSecret: configuration.clientSecret,
      redirectUri: configuration.redirectUri,
      requestedScopes: configuration.scopes,
      transactionTtlMs: 10 * 60_000,
      keyVersion: configuration.keyVersion,
      encryptionKeys: new Map([[configuration.keyVersion, key]]),
    }, {
      fetch: platform.fetch,
      now: platform.now,
      subtle: platform.subtle,
      randomBytes: platform.randomBytes,
      transactions: store.transactions,
      connections: store.connections,
      verifyIdToken: (input) =>
        verifyGoogleIdToken(input, platform.fetch, platform.subtle),
    });
  } catch (error) {
    if (error instanceof Error) return null;
    throw error;
  }
}

/**
 * Verify Google's signed ID token locally so no token enters an outbound URL.
 * @param {{ readonly token: string, readonly expectedIssuer: string, readonly expectedAudience: string, readonly now: Date }} input
 * @param {typeof fetch} fetchClient
 * @param {SubtleCrypto} subtle
 */
async function verifyGoogleIdToken(input, fetchClient, subtle) {
  try {
    const segments = input.token.split(".");
    if (segments.length !== 3) {
      return /** @type {const} */ ({
        ok: false,
        error: { kind: "OAuthIdTokenVerificationFailed" },
      });
    }
    const header = parseBase64UrlJson(segments[0]);
    const claims = parseBase64UrlJson(segments[1]);
    if (
      !isRecord(header) || header.alg !== "RS256" ||
      typeof header.kid !== "string" || !isRecord(claims)
    ) {
      return /** @type {const} */ ({
        ok: false,
        error: { kind: "OAuthIdTokenVerificationFailed" },
      });
    }
    const response = await fetchClient(
      "https://www.googleapis.com/oauth2/v3/certs",
      {
        headers: { accept: "application/json" },
      },
    );
    const keySet = response.ok
      ? /** @type {unknown} */ (await response.json())
      : null;
    const jwk = isRecord(keySet) && Array.isArray(keySet.keys)
      ? keySet.keys.find((key) => isRecord(key) && key.kid === header.kid)
      : undefined;
    if (!isRecord(jwk)) {
      return /** @type {const} */ ({
        ok: false,
        error: { kind: "OAuthIdTokenVerificationFailed" },
      });
    }
    const verificationKey = await subtle.importKey(
      "jwk",
      /** @type {JsonWebKey} */ (jwk),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const signature = decodeBase64Url(segments[2]);
    const verified = signature !== null && await subtle.verify(
      "RSASSA-PKCS1-v1_5",
      verificationKey,
      signature,
      new TextEncoder().encode(`${segments[0]}.${segments[1]}`),
    );
    if (
      !verified ||
      !(claims.iss === input.expectedIssuer ||
        (input.expectedIssuer === "https://accounts.google.com" &&
          claims.iss === "accounts.google.com")) ||
      claims.aud !== input.expectedAudience ||
      typeof claims.exp !== "number" ||
      claims.exp <= Math.floor(input.now.getTime() / 1_000) ||
      typeof claims.sub !== "string" || claims.sub === "" ||
      typeof claims.email !== "string" || claims.email === "" ||
      claims.email_verified !== true || typeof claims.nonce !== "string" ||
      claims.nonce === ""
    ) {
      return /** @type {const} */ ({
        ok: false,
        error: { kind: "OAuthIdTokenVerificationFailed" },
      });
    }
    return /** @type {const} */ ({
      ok: true,
      value: Object.freeze({
        subject: claims.sub,
        email: claims.email,
        emailVerified: true,
        nonce: claims.nonce,
      }),
    });
  } catch (error) {
    if (error instanceof Error) {
      return /** @type {const} */ ({
        ok: false,
        error: { kind: "OAuthIdTokenVerificationFailed" },
      });
    }
    throw error;
  }
}

/** @param {string} value */
function parseBase64UrlJson(value) {
  const bytes = decodeBase64Url(value);
  if (bytes === null) return null;
  try {
    return /** @type {unknown} */ (JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ));
  } catch (error) {
    if (error instanceof Error) return null;
    throw error;
  }
}

/** @param {string} kind */
function oauthFailureResponse(kind) {
  const status = kind === "OAuthConnectionMissing"
    ? 404
    : kind === "OAuthTransactionOwnerMismatch" ||
        kind === "OAuthIdTokenNonceMismatch"
    ? 403
    : kind === "OAuthTransactionMissing" ||
        kind === "OAuthTransactionExpired" || kind === "OAuthConnectionRevoked"
    ? 409
    : kind.endsWith("Unavailable") || kind.endsWith("PersistenceFailed")
    ? 503
    : kind === "OAuthTokenExchangeRejected" ||
        kind === "OAuthProviderRevocationFailed"
    ? 502
    : 400;
  return json({ error: kind }, status);
}

/** @param {string} value */
function validEncryptionKeyText(value) {
  const bytes = decodeBase64Url(value);
  return bytes !== null && bytes.byteLength === 32;
}

/** @param {string} value */
function decodeBase64Url(value) {
  try {
    const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
    const binary = atob(
      normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="),
    );
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch (error) {
    if (error instanceof Error) return null;
    throw error;
  }
}

/**
 * @param {string} issuer
 * @param {string} kid
 * @param {typeof fetch} fetchClient
 * @returns {Promise<Result<JsonWebKey, WorkerFailure>>}
 */
async function accessKeyFor(issuer, kid, fetchClient) {
  /** @type {Response} */
  let response;
  try {
    response = await fetchClient(new URL("/cdn-cgi/access/certs", issuer), {
      headers: { accept: "application/json" },
    });
  } catch (error) {
    if (error instanceof Error) {
      return { ok: false, error: { kind: "DiscoveryFetchUnavailable" } };
    }
    throw error;
  }
  if (!response.ok) {
    return { ok: false, error: { kind: "DiscoveryFetchUnavailable" } };
  }
  /** @type {unknown} */
  let document;
  try {
    document = await response.json();
  } catch (error) {
    if (error instanceof SyntaxError) {
      return { ok: false, error: { kind: "DiscoveryAccessTokenInvalid" } };
    }
    throw error;
  }
  if (!isRecord(document) || !Array.isArray(document.keys)) {
    return { ok: false, error: { kind: "DiscoveryAccessTokenInvalid" } };
  }
  for (const key of document.keys) {
    if (isRecord(key) && key.kid === kid) {
      return { ok: true, value: /** @type {JsonWebKey} */ (key) };
    }
  }
  return { ok: false, error: { kind: "DiscoveryAccessTokenInvalid" } };
}

/**
 * @param {{ readonly key: JsonWebKey, readonly signingInput: Uint8Array, readonly signature: Uint8Array }} input
 * @param {SubtleCrypto} subtle
 */
async function verifyAccessSignature(input, subtle) {
  try {
    const key = await subtle.importKey(
      "jwk",
      input.key,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    return await subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      input.signature,
      input.signingInput,
    );
  } catch (error) {
    if (error instanceof Error) return false;
    throw error;
  }
}

/**
 * @param {Request} request
 * @param {string} allowedOrigin
 * @param {number} maximumBytes
 * @returns {Promise<Result<unknown, Response>>}
 */
async function readTranscriptCommand(request, allowedOrigin, maximumBytes) {
  if (request.method !== "POST") {
    return {
      ok: false,
      error: json({ error: "Method not allowed." }, 405, { Allow: "POST" }),
    };
  }
  const origin = request.headers.get("origin");
  if (origin !== null && origin !== allowedOrigin) {
    return {
      ok: false,
      error: json({ error: "DiscoveryOriginRejected" }, 403),
    };
  }
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maximumBytes) {
    return {
      ok: false,
      error: json({ error: "DiscoveryRequestTooLarge" }, 413),
    };
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maximumBytes) {
    return {
      ok: false,
      error: json({ error: "DiscoveryRequestTooLarge" }, 413),
    };
  }
  try {
    return { ok: true, value: /** @type {unknown} */ (JSON.parse(text)) };
  } catch (error) {
    if (error instanceof SyntaxError) {
      return {
        ok: false,
        error: json({ error: "PodcastTranscriptCommandInvalid" }, 400),
      };
    }
    throw error;
  }
}

/** @param {unknown} value @param {string} ownerId @returns {Result<{ readonly ownerId: string, readonly evidenceId: string, readonly transcriptUrl: string, readonly access: "allowed" | "denied" | "unknown", readonly storage: "allowed" | "denied" | "unknown", readonly display: "allowed" | "denied" | "unknown", readonly transformation: "allowed" | "denied" | "unknown", readonly attribution: "allowed" | "denied" | "unknown", readonly attributionText: string, readonly evidenceBasis: string, readonly evidenceReference: string, readonly scope: string, readonly expiresAt: string }, Response>} */
function validateAuthorizationRequest(value, ownerId) {
  if (!isRecord(value)) return invalidTranscriptCommand("body");
  const fields = [
    "attributionText",
    "evidenceBasis",
    "evidenceId",
    "evidenceReference",
    "expiresAt",
    "transcriptUrl",
  ];
  if (Object.keys(value).sort().join(",") !== fields.sort().join(",")) {
    return invalidTranscriptCommand("body");
  }
  if (
    !nonBlankText(value.evidenceId) || !safeHttpsUrl(value.transcriptUrl) ||
    !nonBlankText(value.attributionText) ||
    !nonBlankText(value.evidenceBasis) ||
    !safeHttpsUrl(value.evidenceReference) ||
    !validTimestamp(value.expiresAt)
  ) return invalidTranscriptCommand("authorization");
  const allowed = "allowed";
  return {
    ok: true,
    value:
      /** @type {{ readonly ownerId: string, readonly evidenceId: string, readonly transcriptUrl: string, readonly access: "allowed", readonly storage: "allowed", readonly display: "allowed", readonly transformation: "allowed", readonly attribution: "allowed", readonly attributionText: string, readonly evidenceBasis: string, readonly evidenceReference: string, readonly scope: string, readonly expiresAt: string }} */ (
        Object.freeze({
          ownerId,
          ...value,
          access: allowed,
          storage: allowed,
          display: allowed,
          transformation: allowed,
          attribution: allowed,
          scope: "transcript-retention-and-transformation",
        })
      ),
  };
}

/** @param {unknown} value @returns {Result<{ readonly requestId: string, readonly evidenceId: string, readonly transcriptUrl: string, readonly language: string, readonly jsonTextPath: readonly string[] | null, readonly retention: { readonly mode: "plain-text" } | { readonly mode: "excerpt", readonly startCharacter: number, readonly characterCount: number } }, Response>} */
function validateTranscriptRetrievalRequest(value) {
  if (!isRecord(value)) return invalidTranscriptCommand("body");
  const fields = [
    "evidenceId",
    "jsonTextPath",
    "language",
    "requestId",
    "retention",
    "transcriptUrl",
  ];
  if (Object.keys(value).sort().join(",") !== fields.sort().join(",")) {
    return invalidTranscriptCommand("body");
  }
  if (
    !nonBlankText(value.requestId) || !nonBlankText(value.evidenceId) ||
    !safeHttpsUrl(value.transcriptUrl) || !nonBlankText(value.language) ||
    !(value.jsonTextPath === null ||
      (Array.isArray(value.jsonTextPath) && value.jsonTextPath.length > 0 &&
        value.jsonTextPath.length <= 8 &&
        value.jsonTextPath.every(nonBlankText))) ||
    !isRecord(value.retention)
  ) return invalidTranscriptCommand("body");
  const retention = value.retention;
  if (
    !(
      Object.keys(retention).length === 1 && retention.mode === "plain-text"
    ) && !(
      Object.keys(retention).sort().join(",") ===
        "characterCount,mode,startCharacter" &&
      retention.mode === "excerpt" &&
      Number.isSafeInteger(retention.startCharacter) &&
      Number(retention.startCharacter) >= 0 &&
      Number.isSafeInteger(retention.characterCount) &&
      Number(retention.characterCount) > 0
    )
  ) return invalidTranscriptCommand("retention");
  return {
    ok: true,
    value:
      /** @type {{ readonly requestId: string, readonly evidenceId: string, readonly transcriptUrl: string, readonly language: string, readonly jsonTextPath: readonly string[] | null, readonly retention: { readonly mode: "plain-text" } | { readonly mode: "excerpt", readonly startCharacter: number, readonly characterCount: number } }} */ (
        Object.freeze({ ...value })
      ),
  };
}

/** @param {string} field */
function invalidTranscriptCommand(field) {
  return /** @type {const} */ ({
    ok: false,
    error: json({ error: "PodcastTranscriptCommandInvalid", field }, 400),
  });
}

/** @param {unknown} value @returns {value is string} */
function nonBlankText(value) {
  return typeof value === "string" && value.trim() !== "" &&
    value.length <= 1_024;
}

/** @param {unknown} value @returns {value is string} */
function safeHttpsUrl(value) {
  return nonBlankText(value) && URL.canParse(value) &&
    new URL(value).protocol === "https:";
}

/** @param {unknown} value @returns {value is string} */
function validTimestamp(value) {
  return nonBlankText(value) && Number.isFinite(Date.parse(value));
}

/** @param {WorkerFailure} failure */
function workerFailureResponse(failure) {
  const status = failure.kind === "DiscoveryAccessTokenMissing" ||
      failure.kind === "DiscoveryAccessTokenInvalid"
    ? 401
    : failure.kind === "DiscoveryAccessAudienceMismatch" ||
        failure.kind === "DiscoveryAccessIdentityUnmapped"
    ? 403
    : 503;
  return json({ error: failure.kind }, status);
}

/** @param {string} kind */
function transcriptFailureResponse(kind) {
  const status =
    kind === "TranscriptRightsUnknown" || kind.endsWith("NotPermitted") ||
      kind === "TranscriptAttributionMissing"
      ? 403
      : kind === "PodcastTranscriptMissing"
      ? 404
      : kind === "PodcastTranscriptTooLarge"
      ? 413
      : kind === "PodcastTranscriptFetchFailed" ||
          kind === "PodcastTranscriptDigestFailed"
      ? 503
      : 400;
  return json({ error: kind }, status);
}

/** @param {string} kind */
function authorizationFailureResponse(kind) {
  const status = kind === "TranscriptAuthorizationMissing"
    ? 404
    : kind === "TranscriptAuthorizationReferenceMismatch"
    ? 409
    : kind === "TranscriptAuthorizationAccessNotPermitted"
    ? 403
    : 503;
  return json({ error: kind }, status);
}

/** @param {unknown} body @param {number} status @param {HeadersInit} [headers] */
function json(body, status, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

/** @param {unknown} value @returns {value is QuotaReservationBinding} */
function isQuotaBinding(value) {
  return isRecord(value) && typeof value.fetch === "function";
}

/** @param {unknown} value @returns {value is import("./source-library-d1.js").D1DatabasePort} */
function isD1Database(value) {
  return isRecord(value) && typeof value.prepare === "function" &&
    typeof value.batch === "function";
}

/** @param {unknown} value @returns {value is import("./source-content-r2.js").R2BucketPort} */
function isR2Bucket(value) {
  return isRecord(value) && typeof value.put === "function" && typeof value.delete === "function";
}

/** @param {unknown} value @returns {value is import("./knowledge-workflow-media-d1.js").MediaBucket} */
function isMediaBucket(value) {
  return isRecord(value) && typeof value.put === "function" && typeof value.get === "function" && typeof value.delete === "function";
}

/** @param {unknown} value @returns {value is KnowledgeWorkflowBinding} */
function isKnowledgeWorkflowBinding(value) {
  return isRecord(value) && typeof value.create === "function" && typeof value.get === "function";
}

/** @param {unknown} value @returns {value is QuotaDurableObjectNamespace} */
function isQuotaNamespace(value) {
  return isRecord(value) && typeof value.idFromName === "function" &&
    typeof value.get === "function";
}

/** @param {unknown} value @returns {value is QuotaDurableObjectStorage} */
function isQuotaStorage(value) {
  return isRecord(value) && isRecord(value.sql) &&
    typeof value.sql.exec === "function" &&
    typeof value.transactionSync === "function";
}

/** @param {string} value */
function positiveIntegerText(value) {
  return /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value));
}

/** @param {string} value */
function validUtcDay(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value;
}

/** @param {string} value */
function isOrigin(value) {
  return URL.canParse(value) && new URL(value).origin === value &&
    new URL(value).protocol === "https:";
}

/** @param {Uint8Array} bytes */
function hex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * D1 run IDs are human-readable and retain a colon separator. Workflow
 * instance IDs use a conservative URL-safe alphabet so the same instance can
 * be addressed consistently by create(), get(), and event delivery.
 * @param {string} runId
 * @returns {string}
 */
function workflowInstanceId(runId) {
  if (typeof runId !== "string" || runId.trim() === "") throw new TypeError("Knowledge workflow run ID is invalid.");
  const normalized = runId.startsWith("knowledge-workflow:")
    ? `knowledge-workflow-${runId.slice("knowledge-workflow:".length)}`
    : runId.replace(/[^A-Za-z0-9_-]/gu, "-");
  if (!/^[A-Za-z0-9_-]{1,100}$/u.test(normalized)) throw new TypeError("Knowledge workflow instance ID is invalid.");
  return normalized;
}

/**
 * Reconciles the durable D1 run with its named Workflow instance. A replay
 * first checks an existing binding; a missing binding is safely re-created
 * with the same ID because the platform rejects duplicate IDs.
 * @param {KnowledgeWorkflowBinding} binding
 * @param {{ readonly runId: string, readonly state: string }} run
 * @param {unknown} params
 * @param {boolean} reused
 * @returns {Promise<Result<null, { readonly kind: "WorkflowStartFailed" }>>}
 */
async function reconcileKnowledgeWorkflowLaunch(binding, run, params, reused) {
  if (!binding || typeof binding.get !== "function" || typeof binding.create !== "function" || !run || typeof run.runId !== "string" || run.runId.trim() === "") throw new TypeError("Knowledge workflow launch dependencies are invalid.");
  if (run.state === "completed" || run.state === "abandoned") return { ok: true, value: null };
  const instanceId = workflowInstanceId(run.runId);
  if (reused) {
    let existing = null;
    try {
      existing = await binding.get(instanceId);
    } catch (error) {
      // A named instance may be absent after a prior create failure; create
      // below is still safe because the platform rejects duplicate IDs.
    }
    if (existing !== null) {
      if (existing.id !== instanceId) return { ok: false, error: { kind: "WorkflowStartFailed" } };
      if (typeof existing.status === "function") {
        let status;
        try { status = await existing.status(); } catch (error) { return { ok: false, error: { kind: "WorkflowStartFailed" } }; }
        if (!status || typeof status.status !== "string" || status.status.trim() === "") return { ok: false, error: { kind: "WorkflowStartFailed" } };
      }
      return { ok: true, value: null };
    }
  }
  try {
    const created = await binding.create({ id: instanceId, params });
    return created && created.id === instanceId
      ? { ok: true, value: null }
      : { ok: false, error: { kind: "WorkflowStartFailed" } };
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    try {
      const winner = await binding.get(instanceId);
      if (winner?.id === instanceId && typeof winner.status === "function") {
        const status = await winner.status();
        if (status && typeof status.status === "string" && status.status.trim() !== "") return {ok:true,value:null};
      }
    } catch (readError) {
      if (!(readError instanceof Error)) throw readError;
      console.error(JSON.stringify({event:"workflow-launch-reconciliation-failure",runId:run.runId,failureKind:"WorkflowStartFailed"}));
    }
    return { ok: false, error: { kind: "WorkflowStartFailed" } };
  }
}

/** A platform crash may prevent the executor from saving its retryable state to D1.
 * @param {import("../src/features/knowledge-workflows/workflow.js").KnowledgeWorkflowRun} run
 * @param {KnowledgeWorkflowBinding} binding
 * @returns {Promise<Result<import("../src/features/knowledge-workflows/workflow.js").KnowledgeWorkflowRun,{kind:string}>>} */
async function projectKnowledgeWorkflowExecution(run,binding) {
  if(!isWorkflowRetryStage(run.state))return {ok:true,value:run};
  try {
    const instance=await binding.get(workflowInstanceId(run.runId));
    if(typeof instance.status!=="function" || !["errored","paused"].includes((await instance.status()).status))return {ok:true,value:run};
    return {ok:true,value:{...run,state:"retryable-failure",retryState:run.state,failureKind:"WorkflowExecutionStopped"}};
  }catch(error){if(!(error instanceof Error))throw error;return {ok:false,error:{kind:"WorkflowInstanceStatusFailed"}};}
}

/**
 * Deliver a control command to a live Workflow instance. A retryable Workflow
 * is waiting at step.waitForEvent, so the matching event is authoritative and
 * is delivered with bounded retries. A paused instance must be resumed even
 * when its event queue accepts delivery; rejected delivery also retries resume.
 * @param {{ readonly status?: () => Promise<{readonly status:string}>, readonly restart?: () => Promise<void>, readonly pause?: () => Promise<void>, readonly resume?: () => Promise<void>, readonly sendEvent?: (event: { readonly type: string, readonly payload?: unknown }) => Promise<void>, readonly terminate?: (options: { readonly rollback: boolean }) => Promise<void> }} instance
 * @param {unknown} action
 * @param {boolean} [restartCompleted]
 * @returns {Promise<void>}
 */
async function deliverKnowledgeWorkflowControl(instance, action, restartCompleted = false) {
  if (instance === null || typeof instance !== "object") throw new TypeError("Knowledge workflow instance is invalid.");
  if (action === "stop") {
    if (typeof instance.pause !== "function") throw new TypeError("Knowledge workflow pause control is unavailable.");
    await instance.pause();
    return;
  }
  if (action === "resume" || action === "retry-quizzes") {
    const status = restartCompleted ? "complete" : typeof instance.status === "function" ? (await instance.status()).status : null;
    if (["errored","complete"].includes(status ?? "")) {
      if (typeof instance.restart !== "function") throw new TypeError("Knowledge workflow restart is unavailable.");
      await instance.restart();
      return;
    }
    if (typeof instance.resume !== "function" || typeof instance.sendEvent !== "function") throw new TypeError("Knowledge workflow resume control is unavailable.");
    if (status === "paused") await instance.resume();
    const event = { type: "workflow-control", payload: { action } };
    let lastError = null;
    for (const delay of [0, 100, 250]) {
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      try {
        await instance.sendEvent(event);
        return;
      } catch (error) {
        if (!(error instanceof Error)) throw error;
        lastError = error;
      }
    }
    if (lastError === null) throw new Error("Workflow control event delivery failed.");
    await instance.resume();
    await instance.sendEvent(event);
    return;
  }
  if (action === "generate") {
    if (typeof instance.sendEvent !== "function") throw new TypeError("Knowledge workflow generation control is unavailable.");
    await instance.sendEvent({ type: "workflow-control", payload: { action } });
    return;
  }
  if (action === "abandon") {
    if (typeof instance.terminate !== "function") throw new TypeError("Knowledge workflow abandonment control is unavailable.");
    await instance.terminate({ rollback: false });
    return;
  }
  throw new TypeError("Knowledge workflow control action is invalid.");
}

/**
 * Returns the only retry rollback currently safe to perform after a Workflow
 * event delivery failure. The original failure is retained so the public
 * status remains actionable and a later retry can use the latest revision.
 * @param {unknown} command
 * @param {unknown} prior
 * @param {unknown} controlled
 * @returns {{ readonly ownerId: string, readonly runId: string, readonly expectedRevision: number, readonly nextState: "retryable-failure", readonly failureKind: string } | null}
 */
function workflowControlRollback(command, prior, controlled) {
  if (!isRecord(command) || (command.action !== "resume" && command.action !== "retry-quizzes") || !isRecord(prior) || prior.ok !== true || !isRecord(prior.value) || !isRecord(controlled) || controlled.ok !== true || !isRecord(controlled.value)) return null;
  const previous = prior.value;
  const transitioned = controlled.value;
  if (!(previous.state === "retryable-failure" || previous.state === "completed" && (previous.failureKind === "WorkflowPagesFailed" || previous.failureKind === "WorkflowQuizItemsFailed")) || transitioned.state !== (command.action === "retry-quizzes" ? "per-point-quiz-loop" : previous.retryState ?? "extraction-loop") || typeof previous.ownerId !== "string" || typeof previous.runId !== "string" || typeof transitioned.revision !== "number" || !Number.isSafeInteger(transitioned.revision)) return null;
  return Object.freeze({ ownerId: previous.ownerId, runId: previous.runId, expectedRevision: transitioned.revision, nextState: "retryable-failure", failureKind: previous.state === "completed" ? command.action === "retry-quizzes" ? "WorkflowRetryFailedQuizzes" : "WorkflowRetryFailedPages" : typeof previous.failureKind === "string" && previous.failureKind.trim() !== "" ? previous.failureKind : "WorkflowInstanceControlFailed" });
}

/** @param {unknown} error @returns {string} */
function workflowControlDiagnosticToken(error) {
  if (!(error instanceof Error)) return "unknown";
  const message = error.message.toLowerCase();
  if (message.includes("not found") || message.includes("unknown instance")) return "instance-not-found";
  if (message.includes("resume") || message.includes("paused")) return "resume-failed";
  if (message.includes("event") || message.includes("wait")) return "event-delivery-failed";
  if (message.includes("terminate") || message.includes("rollback")) return "termination-failed";
  if (message.includes("pause")) return "pause-failed";
  return "control-failed";
}

/** @type {{ readonly fetch: (request: Request, environment: DiscoveryWorkerEnvironment) => Promise<Response> }} */
const worker = Object.freeze({
  async fetch(request, environment) {
    const composed = createCloudflareDiscoveryWorker(environment, {
      fetch: globalThis.fetch,
      now: () => new Date(),
      subtle: globalThis.crypto.subtle,
      randomBytes: (length) =>
        globalThis.crypto.getRandomValues(new Uint8Array(length)),
    });
    return composed.ok
      ? composed.value.fetch(request)
      : json({ error: composed.error.kind, field: composed.error.field }, 503);
  },
});

export default worker;

export {
  PublisherTranscriptAuthorizationDurableObject,
  YouTubeOAuthDurableObject,
  deliverKnowledgeWorkflowControl,
  workflowControlRollback,
  workflowInstanceId,
  reconcileKnowledgeWorkflowLaunch,
  projectKnowledgeWorkflowExecution,
};
