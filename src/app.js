import { parseAppRoute, renderNavigationButton } from "./routes/navigation.js";
// @ts-check

import { CatalogRepository } from "./features/catalog/repository.js";
import { ExposureRepository } from "./features/exposure/repository.js";
import { ExposureService } from "./features/exposure/service.js";
import { subjectPresentation } from "./features/knowledge-subjects/presentation.js";
import { FeedbackAudioService } from "./features/experience/audio.js";
import { applyPresentationUpdate, resolveTheme } from "./features/experience/presentation.js";
import { SettingsRepository } from "./features/experience/settings.js";
import { revealCards } from "./features/experience/reveal.js";
import { cancelSparkEffects } from "./features/experience/spark.js";
import { createCardReader } from "./features/learning-generation/card-reader.js";
import { PreferenceRepository } from "./features/preference/repository.js";
import { PreferenceService } from "./features/preference/service.js";
import { RecallRepository } from "./features/recall/repository.js";
import { StudyRepository } from "./features/study/repository.js";
import { StudyService } from "./features/study/service.js";
import { IndexedDbPersistence } from "./persistence/indexeddb.js";
import { RECORD_KINDS } from "./persistence/contracts.js";

const freeze = Object.freeze;
const revealedCards = new Set();
const cardReader = createCardReader();
/** @type {IntersectionObserver|null} */ let cardObserver = null;
import {
  installNotificationController,
  renderNotification,
  synchronizeNotification,
} from "./features/notifications/controller.js";

/** @import { CatalogCandidate, QuizVersion } from "./features/catalog/contracts.js" */
/** @import { FeedPage, FeedPolicy, RankedFeedItem } from "./features/feed/contracts.js" */
/** @import { PersistenceEnvelope, RecordKind } from "./persistence/contracts.js" */
/** @import { ExposureCommand } from "./features/exposure/contracts.js" */
/** @import { AudioContextPort, ExperienceSettings, SettingsFailure, ViewTransitionCapability } from "./features/experience/contracts.js" */
/** @import { PreferenceCommand } from "./features/preference/contracts.js" */
/** @import { RecallPrompt } from "./features/recall/contracts.js" */
/** @import { StudyCommand, StudyEvent } from "./features/study/contracts.js" */
/** @import { DailyLearningSettings, DailyStudySet } from "./features/daily-learning/contracts.js" */
/** @import { createLibraryPage } from "./startup/library-page.js" */
/** @import { createDiscoveryPage } from "./startup/discovery-page.js" */
/** @import { createExperienceActions } from "./startup/experience-actions.js" */

const LOCAL_OWNER_ID = "local-owner-v1";
const QUALIFIED_VIEW_MS = 30_000;
const SETTINGS_STORAGE_KEY = "resonance:experience";
const PRESETS =
  /** @type {{
   *   readonly visualThemes: readonly import("./features/experience/contracts.js").ExperiencePreset<import("./features/experience/contracts.js").VisualTheme>[],
   *   readonly layouts: readonly import("./features/experience/contracts.js").ExperiencePreset<import("./features/experience/contracts.js").LayoutMode>[]
   * }} */
  (readEmbeddedJson("experience-presets"));
const VISUAL_THEMES = PRESETS.visualThemes;
const LAYOUTS = PRESETS.layouts;
const APP_COPY =
  /** @type {{readonly cancelProcessing:string,readonly dailyTargetsCreate:string,readonly savedTargetsHidden:string,readonly savedSetHidden:string,readonly starterUnavailable:string,readonly discoveryUnavailable:string,readonly reviewRouteUnavailable:string,readonly libraryRouteUnavailable:string,readonly recallRuntimeUnavailable:string,readonly preferenceNotSaved:string,readonly preferenceSaveFailed:string,readonly studySaved:string,readonly answerSavedReload:string,readonly promptOutsideRecall:string,readonly exported:string,readonly exportFailed:string,readonly eraseFailed:string,readonly targetsSaved:string,readonly finishRecall:string,readonly soundsUnavailable:string,readonly feedExpired:string,readonly feedUnavailable:string,readonly pageSizeUnsupported:string,readonly cursorInvalid:string,readonly feedOwnerMismatch:string,readonly pageMismatch:string,readonly lessonUnavailable:string,readonly feedOpenFailed:string,readonly storageUnavailable:string,readonly learningDataUnavailable:string,readonly offlineMiss:string,readonly offlineUpgrade:string,readonly offlineFailed:string,readonly settingsRead:string,readonly settingsWrite:string,readonly settingsReset:string,readonly settingsInvalid:string,readonly openingApp:string,readonly retryFailedItems:string,readonly retryFailedQuizzes:string,readonly panelLoading:string,readonly panelFailed:string,readonly discoverMarkup:import("./routes/discover.js").DiscoverMarkup}} */
  (readEmbeddedJson("app-copy"));
const DEFAULT_SETTINGS = freeze({
  schemaVersion: /** @type {const} */ (2),
  themeMode: /** @type {const} */ ("system"),
  visualTheme: /** @type {const} */ ("studio-signal"),
  layoutMode: /** @type {const} */ ("split-desk"),
  soundEnabled: false,
});
/** @type {FeedPolicy} */
const feedPolicy = freeze({
  maxPageSize: 50,
  cursorLifetimeMs: 24 * 60 * 60_000,
  preferenceWeight: 0.45,
  exposurePenalty: 0.12,
  masteryPenalty: 0.4,
  dueBoost: 2,
  explorationFloor: 0.08,
  version: "local-ranking-v1",
});

const rootQuery = document.querySelector("#app");
if (!(rootQuery instanceof HTMLElement)) {
  throw new Error("AppRootMissing");
}
const root = /** @type {HTMLElement} */ (rootQuery);
root.addEventListener("click", (event) => {
  if (event.target instanceof Element && event.target.closest("button")) {
    const subject = event.target.closest("[data-subject]")?.getAttribute("data-subject");
    if (subject) void playInteractionCue(subject); else void playInteractionCue();
  }
});
const systemThemeQuery = matchMedia("(prefers-color-scheme: dark)");
const reducedMotionQuery = matchMedia("(prefers-reduced-motion: reduce)");
const settingsRepository = new SettingsRepository({
  storage: resolveSettingsStorage(),
  key: SETTINGS_STORAGE_KEY,
  ownerId: LOCAL_OWNER_ID,
  visualThemes: VISUAL_THEMES,
  layouts: LAYOUTS,
  defaultVisualTheme: DEFAULT_SETTINGS.visualTheme,
  defaultLayoutMode: DEFAULT_SETTINGS.layoutMode,
});
const transitions = resolveTransitionCapability(document);
const correctAudio = new FeedbackAudioService({
  createContext: resolveAudioContextFactory(),
  cue: freeze({
    frequencyHz: 740,
    durationSeconds: 0.1,
    peakGain: 0.025,
    oscillatorType: /** @type {const} */ ("sine"),
  }),
});
const incorrectAudio = new FeedbackAudioService({
  createContext: resolveAudioContextFactory(),
  cue: freeze({
    frequencyHz: 220,
    durationSeconds: 0.12,
    peakGain: 0.02,
    oscillatorType: /** @type {const} */ ("triangle"),
  }),
});
const interactionAudio = new FeedbackAudioService({
  createContext: resolveAudioContextFactory(),
  cue: freeze({
    frequencyHz: 392,
    durationSeconds: 0.06,
    peakGain: 0.018,
    oscillatorType: /** @type {const} */ ("sine"),
  }),
});

const {
  DailyLearningRepository,
  DailyLearningService,
  persistRecallCohort,
} = await import("./features/daily-learning/runtime.js");
const catalogResponse = await fetch("./assets/catalog-fixtures.json");
if (!catalogResponse.ok) {
  throw new Error("FixtureCatalogLoadFailed");
}
const catalogFixtures =
  /** @type {readonly CatalogCandidate[]} */ (await catalogResponse.json());
const catalogResult = CatalogRepository.create(
  catalogFixtures,
);
if (!catalogResult.ok) {
  throw new Error(`Fixture catalog invalid: ${catalogResult.error.kind}`);
}

const catalog = catalogResult.value;
const candidates = catalog.list();
const candidateIds = new Set(candidates.map((candidate) => candidate.id));
const preferenceScopes = new Set(candidates.map(scopeForCandidate));
/** @type {Map<string, RecallPrompt>} */
const prompts = new Map(candidates.map((candidate) => {
  const prompt = createRecallPrompt(
    candidate.quiz.id,
    candidate.id,
    `${candidate.knowledgeUnitIds[0]}:${candidate.quiz.id}`,
    candidate.quiz.prompt,
  );
  return [prompt.id, prompt];
}));

const persistence = new IndexedDbPersistence();
const {
  FeedService,
  FixturePromptRuntime,
  createFeedSourceEligibility,
  restoreLocalState,
} = await import(
  "./startup/local-runtime.js"
);
const promptRuntime = new FixturePromptRuntime({
  candidates,
  ownerId: LOCAL_OWNER_ID,
  now: () => new Date().toISOString(),
  write: async (event) => {
    const result = await persistence.append({
      id: event.idempotencyKey,
      ownerId: event.ownerId,
      kind: "prompt_generation",
      payloadJson: JSON.stringify(event),
      recordedAt: event.generatedAt,
    });
    return result.ok
      ? { ok: true, value: /** @type {const} */ (true) }
      : { ok: false, error: result.error };
  },
});
const preferenceRepository = new PreferenceRepository();
const preferenceService = new PreferenceService(
  preferenceRepository,
  preferenceScopes,
  () => crypto.randomUUID(),
);
const exposureRepository = new ExposureRepository();
const exposureService = new ExposureService(
  exposureRepository,
  candidateIds,
  QUALIFIED_VIEW_MS,
  () => crypto.randomUUID(),
);
const studyRepository = new StudyRepository();
const studyService = new StudyService({
  repository: studyRepository,
  knownCandidates: candidateIds,
  createId: () => crypto.randomUUID(),
  writeEvent: async (command) => {
    const persisted = await persistence.append({
      id: command.idempotencyKey,
      ownerId: command.ownerId,
      kind: "manual_study",
      payloadJson: JSON.stringify(command),
      recordedAt: command.occurredAt,
    });
    return persisted.ok ? { ok: true, value: /** @type {const} */ (true) } : {
      ok: false,
      error: { kind: /** @type {const} */ ("StudyWriteUnavailable") },
    };
  },
});
const recallRepository = new RecallRepository();
/** @type {{ readonly kind: "LocalStateReadFailed" | "LocalStateCorrupt", readonly message: string } | null} */
let startupRestoreIssue = null;
const dailyLearningRepository = new DailyLearningRepository();
const dailyLearningService = new DailyLearningService({
  repository: dailyLearningRepository,
  selector: freeze({
    version: "ranked-daily-selector-v1",
    select: (input) => freeze(input.candidates.slice(0, input.count)),
  }),
  createId: () => crypto.randomUUID(),
});

let revealProcessingOnNavigation = false;
let activeView = parseRoute(location.hash).view;
let discoveryItemId = parseRoute(location.hash).discoveryItemId;
/** @type {import("./features/feed/service.js").FeedService | null} */
let feedService = null;
/** @type {FeedPage | null} */
let feedPage = null;
/** @type {ReturnType<import("./features/learning-generation/learner.js").createLearnerController> | null} */
let learnerController = null;
/** @type {ReturnType<import("./features/progress/page.js").createProgressPage>|null} */
let progressPage = null;
/** @type {ReturnType<import("./features/reminders/page.js").createSettingsPage>|null} */
let settingsPage = null;
/** @type {Set<string>} */
const routeLoads = new Set(), routeFailures = new Set();
/** @type {Map<string, string>} */
const loadedRoutes = new Map();
let progressDirty = false, progressDay = "";
let renderedView = activeView;
/** @type {Map<string, ReturnType<typeof captureTransientViewState>>} */
const panelDrafts = new Map();
/** @type {RankedFeedItem[]} */
let visibleItems = [];
let revealedStudyItems = 1;
/** @type {DailyLearningSettings | null} */
let dailySettings = null;
/** @type {ReturnType<typeof setTimeout> | null} */
let promptEligibilityTimer = null;
/** @type {ReturnType<typeof createLibraryPage> | null} */
let libraryPageController = null;
/** @type {ReturnType<import("./features/uploads/page.js").createUploadPage>|null} */
let uploadPage = null;
/** @type {import("./features/uploads/page.js").UploadPrefill|null} */
let uploadPrefill = null;
/** @type {Promise<void> | null} */
let libraryRouteLoad = null;
/** @type {string | null} */
let libraryRouteIssue = null;
/** @type {ReturnType<typeof createDiscoveryPage> | null} */
let discoveryPage = null;
/** @type {ReturnType<typeof createExperienceActions> | null} */
let experienceActions = null;
/** @type {string | null} */
let notice = null;
/** @type {string | null} */
let errorMessage = null;
const notifications = installNotificationController({
  durationMs: 4_000,
  root,
  document,
  createId: () => crypto.randomUUID(),
  now: () => performance.now(),
  setTimer: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimer: (timerId) => clearTimeout(timerId),
  onChange: (notification) => {
    if (notification === null) {
      notice = null;
      errorMessage = null;
    }
    renderMessagesOnly();
  },
});
/** @type {"cursor-expired" | null} */
let feedRecovery = null;
/** @type {ExperienceSettings} */
let experienceSettings = DEFAULT_SETTINGS;
/** @type {SettingsFailure | null} */
let settingsIssue = null;
let sessionStartPending = false;
/** @type {Set<string>} */
const pendingWrites = new Set();

loadExperienceSettings();
applyExperiencePresentation();
renderLoading();
registerOfflineSupport();
await initialize().catch(() => { routeFailures.add(activeView); render(); });

async function initialize() {
  const restored = await restoreLocalState({
    ownerId: LOCAL_OWNER_ID,
    persistence,
    dailyLearningRepository,
    promptRuntime,
    preferenceService,
    exposureService,
    studyRepository,
    studyService,
  });
  if (!restored.ok) {
    startupRestoreIssue = restoreRecoveryFor(restored.error);
    render();
    return;
  }
  dailySettings = restored.value.dailySettings;
  if (!(await persistCatalog())) {
    render();
    return;
  }
  if (!(await ensureDailySettings())) {
    render();
    return;
  }
  await loadLearnerController();
  await loadActiveRoute();
  loadedRoutes.set("feed", "feed");
  loadedRoutes.set("review", "review");
  render();
  void syncReminderTimeZone();
  setInterval(() => { if (document.visibilityState === "visible") void learnerController?.refreshDay(); }, 60_000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void learnerController?.refreshDay();
  });
}

/** @returns {Promise<boolean>} */
async function persistCatalog() {
  for (const candidate of candidates) {
    const persisted = await appendEnvelope({
      id: `catalog:${candidate.id}`,
      ownerId: LOCAL_OWNER_ID,
      kind: "catalog",
      payloadJson: JSON.stringify(candidate),
      recordedAt: candidate.discovery.retrievedAt,
    }, true);
    if (!persisted) return false;
  }
  return true;
}

/** @returns {Promise<boolean>} */
async function ensureDailySettings() {
  const restored = dailyLearningRepository.getSettings(LOCAL_OWNER_ID);
  if (restored !== null) {
    dailySettings = restored;
    return true;
  }
  const now = new Date().toISOString();
  const saved = dailyLearningService.saveSettings({
    ownerId: LOCAL_OWNER_ID,
    dailyStudyTarget: 5,
    dailyRecallLimit: 5,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    expectedRevision: 0,
    updatedAt: now,
  });
  if (!saved.ok) {
    errorMessage = APP_COPY.dailyTargetsCreate;
    return false;
  }
  return await commitDailySettings(saved.value);
}

/** @param {DailyLearningSettings} settings */
async function commitDailySettings(settings) {
  dailyLearningRepository.rollbackSettings(
    settings.ownerId,
    settings.revision,
  );
  const persisted = await appendEnvelope({
    id: `daily-settings:${settings.ownerId}:${settings.revision}`,
    ownerId: settings.ownerId,
    kind: "daily_learning_settings",
    payloadJson: JSON.stringify(settings),
    recordedAt: settings.updatedAt,
  }, false);
  if (!persisted) return false;
  const committed = dailyLearningRepository.recordSettings(settings);
  if (!committed.ok) {
    errorMessage = APP_COPY.savedTargetsHidden;
    return false;
  }
  dailySettings = committed.value;
  return true;
}

/** @param {DailyStudySet} studySet */
async function issueRecallCohort(studySet) {
  const result = await persistRecallCohort(studySet, {
    ownerId: LOCAL_OWNER_ID,
    now: () => new Date().toISOString(),
    repository: dailyLearningRepository,
    service: dailyLearningService,
    promptRuntime,
    prompts,
    studyRepository,
    recallRepository,
    append: (envelope) => appendEnvelope(envelope, false),
  });
  if (!result.ok) {
    errorMessage = result.error.kind === "RecallCohortCommitFailed"
      ? "Saved recall is hidden. Reload."
      : "Today's recall could not be assigned.";
    return false;
  }
  return true;
}

function syncVisibleAssignment() {
  if (dailySettings === null || feedPage === null) {
    visibleItems = [];
    return;
  }
  const assigned = dailyLearningRepository.listStudySets(
    LOCAL_OWNER_ID,
    learningDay(dailySettings.timeZone),
  ).flatMap((set) => set.items);
  const ranked = new Map(
    feedPage.items.map((/** @type {RankedFeedItem} */ item) => [
      item.candidateId,
      item,
    ]),
  );
  visibleItems = assigned.slice(0, revealedStudyItems).flatMap((item) => {
    const rankedItem = ranked.get(item.contentId);
    return rankedItem === undefined ? [] : [rankedItem];
  });
}

async function refreshPromptAvailability() {
  if (promptEligibilityTimer !== null) clearTimeout(promptEligibilityTimer);
  promptEligibilityTimer = null;
  if (dailySettings === null) return;
  const nowMs = Date.now();
  const studied = candidates.flatMap((candidate) => {
    const fact = studyRepository.list(LOCAL_OWNER_ID, candidate.id).at(0);
    return fact === undefined
      ? []
      : [{ candidate, studiedAt: fact.occurredAt }];
  });
  const generation = await promptRuntime.generateDue(studied);
  if (!generation.ok) {
    errorMessage = generation.error.kind === "PromptGenerationPersistenceFailed"
      ? "Recall prompts could not be saved."
      : "Recall prompts could not be prepared.";
    return;
  }
  if (generation.value.nextEligibleAt !== null) {
    promptEligibilityTimer = setTimeout(
      () => {
        void refreshPromptAvailability().then(() => render());
      },
      Math.min(
        2_147_483_647,
        Math.max(0, Date.parse(generation.value.nextEligibleAt) - nowMs),
      ),
    );
  }
  for (const generated of generation.value.prompts) {
    if (prompts.has(generated.id)) continue;
    const candidate = candidates.find((item) =>
      item.id === generated.contentId
    );
    if (candidate === undefined) continue;
    prompts.set(
      generated.id,
      createRecallPrompt(
        generated.id,
        generated.contentId,
        `${
          candidate.knowledgeUnitIds[0]
        }:${generated.id}:v${generated.version}`,
        generated.prompt,
      ),
    );
  }
  await Promise.all(
    dailyLearningRepository.listStudySets(
      LOCAL_OWNER_ID,
      learningDay(dailySettings.timeZone),
    ).map(issueRecallCohort),
  );
}

/** @param {string} id @param {string} contentId @param {string} knowledgeUnitId @param {string} promptText @returns {RecallPrompt} */
function createRecallPrompt(id, contentId, knowledgeUnitId, promptText) {
  return freeze({
    id,
    contentId,
    knowledgeUnitId,
    prompt: promptText,
    choices: freeze([
      freeze({ id: `${id}-grade-correct`, label: "Correct" }),
      freeze({ id: `${id}-grade-incorrect`, label: "Needs work" }),
    ]),
    correctChoiceId: `${id}-grade-correct`,
    status: "active",
  });
}

async function loadActiveRoute() {
  if (startupRestoreIssue !== null) return;
  const view = activeView, hash = location.hash;
  const key = view === "upload" ? hash : view;
  if (loadedRoutes.get(view) === key && (view !== "upload" || uploadPrefill === null)) {
    if (view === "progress" && (progressDirty || progressDay !== new Date().toISOString().slice(0, 10))) {
      progressDirty = false;
      progressDay = new Date().toISOString().slice(0, 10);
      void progressPage?.load();
    }
    render();
    return;
  }
  if (routeLoads.has(view)) return;
  routeLoads.add(view);
  routeFailures.delete(view);
  render();
  try {
    const libraryAlreadyLoaded = libraryPageController !== null;
    await loadLibraryRoute();
    if (view === "library") {
      if (libraryAlreadyLoaded) await libraryPageController?.load();
    }
    if (view === "upload") {
      if (libraryPageController === null) throw new Error("LibraryUnavailable");
      if (libraryPageController !== null) {
        if (uploadPage === null) {
          const { createUploadPage } = await import("./features/uploads/page.js");
          const library = libraryPageController;
          uploadPage = createUploadPage({ storage:resolveSettingsStorage(),onError:message=>{errorMessage=message;notice=null;},fetch, baseUrl:new URL("./",location.href).href,createId:()=>crypto.randomUUID(),onChange:()=>render(),onRenamed:(id,title)=>library.renamed(id,title),onExtracted:()=> (learnerController?.refreshFeed(),location.hash="library"),upload:async(id,form,context)=>{await library.uploadMaterial(id,form,context);return library.uploadResult();} });
        }
        const prefill = uploadPrefill;
        uploadPrefill = null;
        if (!await uploadPage.load(hash, prefill)) return;
      }
    }
    if (view === "progress") {
      if (progressPage === null) {
        const module = await import("./features/progress/page.js");
        progressPage = module.createProgressPage({ fetch, baseUrl: new URL("./", location.href).href, escapeHtml, onChange: () => render() });
      }
      progressDirty = false;
      progressDay = new Date().toISOString().slice(0, 10);
      await progressPage.load();
    }
    if (view === "settings") {
      if (settingsPage === null) {
        const [{ createSettingsPage }, { createReminderClient }] = await Promise.all([
          import("./features/reminders/page.js"), import("./features/reminders/client.js"),
        ]);
        settingsPage = createSettingsPage({ client: createReminderClient({ ownerId: LOCAL_OWNER_ID, fetch, storage: localStorage, navigator }), renderPreferences: renderSettingsPreferences, onChange: () => render() });
        await settingsPage.load();
      }
    }
    if (view === "discover") {
      if (discoveryPage === null) {
        /** @type {unknown} */ let starterInventory = null;
        try {
          const response = await fetch("./assets/discovery-starters.json");
          if (response.ok) starterInventory = await response.json();
        } catch (error) {
          if (!(error instanceof Error)) throw error;
        }
        const module = await import("./startup/discovery-page.js");
        discoveryPage = module.createDiscoveryPage({
          ownerId: LOCAL_OWNER_ID,
          persistence,
          fetch,
          gatewayBaseUrl: new URL("./", location.href).href,
          policyStorage: globalThis.localStorage,
          starterInventory,
          markup: APP_COPY.discoverMarkup,
          createId: () => crypto.randomUUID(),
          now: () => new Date().toISOString(),
          escapeHtml,
          onNotice: (message) => {
            notice = message;
            errorMessage = null;
          },
          onError: (message) => {
            errorMessage = message;
            notice = null;
          },
          confirmUpload,
          navigateToUpload: (prefill) => {
            uploadPrefill = prefill;
            location.hash = "upload";
          },
          navigateToLibrary: (sourceId) => {
            learnerController?.refreshFeed();
            void libraryPageController?.revealSource(sourceId).catch(() => {
              libraryRouteIssue = APP_COPY.libraryRouteUnavailable;
              render();
            });
            activeView = "library";
            location.hash = "library";
          },
          rerender: () => render(),
        });
      }
      const loaded = await discoveryPage.load();
      if (!loaded.ok) {
        errorMessage = APP_COPY.discoveryUnavailable;
        return;
      }
    }
    loadedRoutes.set(view, key);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    routeFailures.add(view);
  } finally {
    routeLoads.delete(view);
    render();
  }
}

async function loadLearnerController() {
  if (learnerController !== null) {
    await Promise.all([learnerController.loadFeed(), learnerController.loadReview()]);
    return;
  }
  const module = await import("./features/learning-generation/learner.js");
  learnerController = module.createLearnerController({
    fetch,
    baseUrl: new URL("./", location.href).href,
    timeoutMs: 15_000,
    escapeHtml,
    now: () => new Date().toISOString(),
    createId: () => crypto.randomUUID(),
    getDailyTargets: () => ({ learning: dailySettings?.dailyStudyTarget ?? 5, review: dailySettings?.dailyRecallLimit ?? 5 }),
    onChange: (message, preferredFocusKey = null, fallbackHeadingId = null, refreshedView, preserveScroll = false) => {
      notice = message ?? null;
      progressDirty = true;
      if (message === undefined) {
        const position = preserveScroll ? { top: scrollY, left: scrollX } : null;
        const refreshed = refreshedView === activeView;
        render(refreshed ? `${activeView}-title` : preferredFocusKey, refreshed ? `${activeView}-title` : fallbackHeadingId);
        if (refreshed) {
          cardReader.stop();
          scrollTo({ top: 0, left: 0, behavior: "instant" });
        }
        else if (position !== null) scrollTo({ ...position, behavior: "instant" });
      }
      else { errorMessage = null; renderMessagesOnly(); }
    },
  });
  await Promise.all([learnerController.loadFeed(), learnerController.loadReview()]);
}

async function loadLibraryRoute() {
  if (libraryRouteLoad !== null) {
    await libraryRouteLoad;
    return;
  }
  if (libraryPageController !== null) return;
  libraryRouteLoad ??= import("./startup/library-page.js").then(
    (module) => {
      libraryPageController = module.createLibraryPage({
        fetch,
        storage: localStorage,
        gatewayBaseUrl: new URL("./", location.href).href,
        escapeHtml,
          formatDate,
          createId: () => crypto.randomUUID(),
          confirmDisable: (source) =>
            confirm(
            `Remove "${source.title}" and all paired knowledge, questions, media, and schedules? Activity history will be preserved.`,
            ),
        confirmRetryFailed: (count,quizzes) => confirm((quizzes?APP_COPY.retryFailedQuizzes:APP_COPY.retryFailedItems).replace("{}",String(count))),
        confirmCancel: (source) => confirm(APP_COPY.cancelProcessing.replace("{}",()=>source.title)),
        confirmUpload,
        navigateToUpload: (hash, prefill) => { uploadPrefill=prefill??null;location.hash = hash; },
        createObserver: (load) => {
          if (!("IntersectionObserver" in globalThis)) return null;
          const observer = new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting)) load();
          }, { rootMargin: "400px 0px" });
          return {
            observe: (element) => observer.observe(element),
            disconnect: () => observer.disconnect(),
          };
        },
        schedule: (callback, delayMs) => setTimeout(callback, delayMs),
        cancel: (handle) => clearTimeout(handle),
        onNotice: (message) => {
          notice = message;
          errorMessage = null;
        },
        onError: (message) => {
          errorMessage = message;
          notice = null;
        },
        rerender: () => { progressDirty = true; render(); },
      });
      return libraryPageController.load();
    },
  ).then(() => {
    libraryRouteIssue = null;
    loadedRoutes.set("library", "library");
  }).catch(() => {
    libraryRouteIssue = APP_COPY.libraryRouteUnavailable;
  }).finally(() => {
    libraryRouteLoad = null;
  });
  await libraryRouteLoad;
}

/** @returns {Promise<boolean>} */
async function startFeedSession() {
  notice = null;
  errorMessage = null;
  feedRecovery = null;
  const now = new Date().toISOString();
  const feedCandidates = candidates.map((candidate) => {
    const scope = scopeForCandidate(candidate);
    const preference = preferenceService.snapshot(LOCAL_OWNER_ID, scope);
    const exposureCount =
      exposureRepository.list(LOCAL_OWNER_ID, candidate.id).length;
    const memory = recallRepository.getMemory(
      LOCAL_OWNER_ID,
      prompts.get(candidate.quiz.id)?.knowledgeUnitId ??
        candidate.knowledgeUnitIds[0],
    );
    return freeze({
      candidateId: candidate.id,
      sourceId: candidate.librarySourceId,
      title: candidate.title,
      knowledgeUnitIds: candidate.knowledgeUnitIds,
      eligible: true,
      signals: freeze({
        preference: preference.affinity,
        qualifiedExposures: exposureCount,
        mastery: memory === null ? null : Math.min(0.95, memory.stability / 30),
        dueAt: memory?.dueAt ?? null,
      }),
    });
  });
  const sourceEligibility = await createFeedSourceEligibility({
    fetch,
    baseUrl: new URL("./", location.href).href,
    ownerId: LOCAL_OWNER_ID,
    candidates: feedCandidates,
  });
  if (!sourceEligibility.ok) {
    errorMessage = friendlyFailure("SourceEligibilityUnavailable");
    feedPage = null;
    visibleItems = [];
    return false;
  }
  feedService = new FeedService(
    feedCandidates,
    feedPolicy,
    () => crypto.randomUUID(),
    (candidateId) => catalog.get(candidateId).ok,
    sourceEligibility.value,
  );
  const result = feedService.getPage({
    ownerId: LOCAL_OWNER_ID,
    limit: candidates.length,
    now,
  });
  if (!result.ok) {
    errorMessage = friendlyFailure(result.error.kind);
    feedPage = null;
    visibleItems = [];
    return false;
  }
  const persisted = await appendEnvelope({
    id: `feed:${result.value.sessionId}:page:0`,
    ownerId: LOCAL_OWNER_ID,
    kind: "feed_session",
    payloadJson: JSON.stringify(result.value),
    recordedAt: now,
  }, false);
  if (!persisted) {
    feedPage = null;
    visibleItems = [];
    return false;
  }
  feedPage = result.value;
  syncVisibleAssignment();
  return true;
}

function renderLoading() {
  root.innerHTML = APP_COPY.openingApp;
}

/** @param {HTMLFormElement} form @returns {string | null} */
function transientFormKey(form) {
  if (form.matches("[data-reminder-form]")) return `reminder:${form.dataset.reminderVersion}`;
  if (form.dataset.classification) return `classification:${form.dataset.classification}`;
  if (form.dataset.learnerReviewQuestion) return `review:${form.dataset.learnerReviewBatch}:${form.dataset.learnerReviewQuestion}`;
  if (form.matches("[data-library-search]")) return "library-search";
  if (form.matches("[data-discovery-search-form]")) return "discovery-search";
  const sourceId = form.getAttribute("data-library-upload") ?? form.getAttribute("data-upload-form");
  return sourceId === null ? null : `library-upload:${sourceId}`;
}

/** @param {HTMLFormElement} form @returns {(HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement)[]} */
function transientFormControls(form) {
  return Array.from(form.elements).filter((element) =>
    element instanceof HTMLInputElement ||
    element instanceof HTMLSelectElement ||
    element instanceof HTMLTextAreaElement
  );
}

/** @param {string} formKey @param {HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement} control @param {number} index @returns {string} */
function transientControlKey(formKey, control, index) {
  const type = control instanceof HTMLInputElement
    ? control.type
    : control.tagName.toLowerCase();
  return `${formKey}:${index}:${type}:${control.name}`;
}

/**
 * Capture only user-editable Library/Discover/Upload state. These routes are rebuilt
 * by background refreshes, while their draft state is not yet persisted.
 * @returns {{ readonly forms: readonly { readonly key: string, readonly controls: readonly { readonly key: string, readonly value: string, readonly checked: boolean | null, readonly files: readonly File[], readonly selectionStart: number | null, readonly selectionEnd: number | null }[] }[], readonly details: readonly { readonly key: string, readonly open: boolean }[], readonly focus: { readonly key: string, readonly selectionStart: number | null, readonly selectionEnd: number | null } | null } | null}
 */
function captureTransientViewState() {
  const forms = Array.from(root.querySelectorAll("form")).flatMap((form) => {
    if (!(form instanceof HTMLFormElement)) return [];
    const key = transientFormKey(form);
    if (key === null) return [];
    const controls = transientFormControls(form).map((control, index) => {
      const isCheckable = control instanceof HTMLInputElement &&
        (control.type === "checkbox" || control.type === "radio");
      const isTextControl = control instanceof HTMLInputElement ||
        control instanceof HTMLTextAreaElement;
      return {
        key: transientControlKey(key, control, index),
        value: control.value,
        checked: isCheckable ? control.checked : null,
        files: control instanceof HTMLInputElement && control.type === "file"
          ? Array.from(control.files ?? [])
          : [],
        selectionStart: isTextControl ? control.selectionStart : null,
        selectionEnd: isTextControl ? control.selectionEnd : null,
      };
    });
    return [{ key, controls }];
  });
  const details = Array.from(root.querySelectorAll("details")).flatMap((detail, index) => {
    const form = detail.closest("form");
    const formKey = form instanceof HTMLFormElement
      ? transientFormKey(form)
      : null;
    const explicitKey = detail.getAttribute("data-library-details-key");
    if (explicitKey === null && formKey === null) return [];
    return [{ key: explicitKey ?? `${formKey}:details:${index}`, open: detail.open }];
  });
  const active = document.activeElement;
  let focus = null;
  if (active instanceof HTMLInputElement || active instanceof HTMLSelectElement || active instanceof HTMLTextAreaElement) {
    const form = active.form;
    const formKey = form === null ? null : transientFormKey(form);
    if (form !== null && formKey !== null) {
      const index = transientFormControls(form).indexOf(active);
      const isTextControl = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement;
      focus = {
        key: transientControlKey(formKey, active, index),
        selectionStart: isTextControl ? active.selectionStart : null,
        selectionEnd: isTextControl ? active.selectionEnd : null,
      };
    }
  }
  return forms.length === 0 && details.length === 0 && focus === null
    ? null
    : { forms, details, focus };
}

/** @param {ReturnType<typeof captureTransientViewState>} state */
function restoreTransientViewState(state) {
  if (state === null) return;
  const forms = Array.from(root.querySelectorAll("form")).flatMap((form) => {
    if (!(form instanceof HTMLFormElement)) return [];
    const key = transientFormKey(form);
    return key === null ? [] : [{ key, form }];
  });
  for (const savedForm of state.forms) {
    const current = forms.find((form) => form.key === savedForm.key)?.form;
    if (current === undefined) continue;
    const controls = transientFormControls(current);
    for (const savedControl of savedForm.controls) {
      const match = controls.find((control, index) => transientControlKey(savedForm.key, control, index) === savedControl.key);
      if (match === undefined) continue;
      if (match instanceof HTMLInputElement && match.type === "file") {
        if (savedControl.files.length > 0 && typeof DataTransfer === "function") {
          const transfer = new DataTransfer();
          for (const file of savedControl.files) transfer.items.add(file);
          match.files = transfer.files;
        }
        continue;
      }
      match.value = savedControl.value;
      if (savedControl.checked !== null && match instanceof HTMLInputElement) match.checked = savedControl.checked;
    }
  }
  const details = Array.from(root.querySelectorAll("details")).flatMap((detail, index) => {
    const form = detail.closest("form");
    const formKey = form instanceof HTMLFormElement ? transientFormKey(form) : null;
    const explicitKey = detail.getAttribute("data-library-details-key");
    return explicitKey === null && formKey === null
      ? []
      : [{ key: explicitKey ?? `${formKey}:details:${index}`, detail }];
  });
  for (const savedDetail of state.details) {
    const current = details.find((detail) => detail.key === savedDetail.key)?.detail;
    if (current !== undefined) current.open = savedDetail.open;
  }
  if (state.focus !== null) {
    const focused = forms.flatMap(({ key, form }) => transientFormControls(form).map((control, index) => ({ key: transientControlKey(key, control, index), control }))).find((entry) => entry.key === state.focus?.key)?.control;
    if (focused instanceof HTMLElement) {
      focused.focus({ preventScroll: true });
      if ((focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement) && state.focus.selectionStart !== null && state.focus.selectionEnd !== null) {
        focused.setSelectionRange(state.focus.selectionStart, state.focus.selectionEnd);
      }
    }
  }
}

/**
 * @param {string | null} [preferredFocusKey]
 * @param {string | null} [fallbackHeadingId]
 */
function render(preferredFocusKey = null, fallbackHeadingId = null) {
  learnerController?.unbind();
  cancelSparkEffects();
  cardObserver?.disconnect();
  const transientState = captureTransientViewState();
  panelDrafts.set(renderedView, transientState);
  const panelState = renderedView === activeView ? transientState : panelDrafts.get(activeView) ?? null;
  renderedView = activeView;
  const activeElement = document.activeElement;
  const previousFocusKey = activeElement instanceof HTMLElement
    ? activeElement.dataset.focusKey ?? null
    : null;
  synchronizeNotification(notifications, notice, errorMessage);
  root.innerHTML =
    `<div class="app-shell">${renderHeader()}<div class="app-layout">${renderNavigation()}<main class="workspace" id="main-content" tabindex="-1">${
      startupRestoreIssue !== null
        ? renderStartupRecovery()
        : routeLoads.has(activeView) ? renderPanelState(APP_COPY.panelLoading)
        : routeFailures.has(activeView) ? renderPanelState(APP_COPY.panelFailed)
        : `${activeView === "feed" ? renderFeed() : ""}${
          activeView === "review" ? renderReviewView() : ""
        }${activeView === "library" ? renderLibraryView() : ""}${activeView === "upload" ? uploadPage?.render() ?? renderPanelState(APP_COPY.panelLoading) : ""}${
          activeView === "discover" ? renderDiscoverView() : ""}${activeView === "progress" ? renderProgressView() : ""}${activeView === "settings" ? renderSettingsView() : ""
        }`
    }<footer class="app-footer"><span>Made for a curious mind.<br>A place for what stays.</span><span>Learn. Connect. Return.</span></footer></main></div><div class="toast-region" aria-atomic="true">${
      renderNotification(notifications.current(), escapeHtml)
    }</div></div>`;
  bindInteractions();
  restoreFocus(preferredFocusKey ?? previousFocusKey, fallbackHeadingId);
  restoreTransientViewState(panelState);
  cardObserver = revealCards(root, revealedCards, typeof IntersectionObserver === "undefined" ? null : IntersectionObserver);
}

function renderStartupRecovery() {
  if (startupRestoreIssue === null) return "";
  return `<section class="wide-view state-panel" aria-labelledby="restore-title">
    <p class="eyebrow">Saved learning</p>
    <h1 id="restore-title">Your saved learning needs attention</h1>
    <p>${escapeHtml(startupRestoreIssue.message)}</p>
    <p>Your saved answers have not been changed. Export a backup before resetting this browser's learning data.</p>
    <div class="state-actions">
      <button class="button secondary" type="button" data-action="export">Export backup</button>
      <button class="button primary" type="button" data-action="reset">Reset local data</button>
    </div>
  </section>`;
}

function renderHeader() {
  return `<header class="topbar"><div class="brand-group"><button class="brand" type="button" data-view="feed" data-focus-key="brand" aria-label="Resonance home"><svg class="brand-symbol" viewBox="0 0 40 64" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M18 2h4v5c0 5 13 8 13 16 0 5-8 8-11 9 3 1 11 4 11 9 0 8-13 11-13 16v5h-4v-5C18 52 5 49 5 41c0-5 8-8 11-9-3-1-11-4-11-9 0-8 13-11 13-16Zm2 9c-3 3-8 7-8 12 0 4 5 6 8 8 3-2 8-4 8-8 0-5-5-9-8-12Zm0 22c-3 2-8 4-8 8 0 5 5 9 8 12 3-3 8-7 8-12 0-4-5-6-8-8Z"/></svg><span>resonance</span></button><span class="brand-caption">A place for <br>what stays.</span></div><div class="topbar-actions">${libraryPageController?.renderProcessingStatus() ?? ""}${
    navigator.onLine ? "" : '<span class="local-badge">Offline</span>'
  }<button class="button quiet" type="button" data-view="settings" data-focus-key="settings-button"${activeView === "settings" ? ' aria-current="page"' : ""}>Settings</button></div></header>`;
}

function renderNavigation() {
  return `<nav class="primary-nav" aria-label="Primary">${
    navButton("feed", "Feed")
  }${navButton("discover", "Discover")}${navButton("review", "Review", learnerController?.hasDueReview() ?? false)}${
    navButton("library", "Library")}${navButton("upload", "Upload")}${navButton("progress", "Progress")
  }<span class="nav-caption">A little curiosity,<br>every day.</span></nav>`;
}

/** @param {string} markup */
function renderPanelState(markup) {
  return markup.replaceAll("{}", activeView[0].toUpperCase() + activeView.slice(1));
}

function renderSettingsView() {
  return settingsPage?.render() ?? renderPanelState(APP_COPY.panelLoading);
}

function renderProgressView() {
  return progressPage?.render() ?? renderPanelState(APP_COPY.panelLoading);
}

function renderDiscoverView() {
  if (discoveryPage === null) {
    return renderPanelState(APP_COPY.panelLoading);
  }
  return discoveryPage.render({
    selectedItemId: discoveryItemId,
    online: navigator.onLine,
  });
}

function renderSettingsPreferences() {
  return `<fieldset class="settings-group"><legend>Appearance</legend><p class="settings-form-note">An open notebook by day. An observatory by night. Each has its own layout.</p><div class="segmented-control">${
    themeOption("system", "System")
  }${themeOption("light", "Fieldnotes")}${
    themeOption("dark", "Observatory")
  }</div></fieldset><label class="switch-control"><span><strong>Interface sounds</strong><small>Interaction and quiz cues</small></span><input type="checkbox" data-setting="sound" data-focus-key="setting-sound" ${
    experienceSettings.soundEnabled ? "checked" : ""
  }></label><label class="switch-control"><span><strong>Interface motion</strong><small>Device reduced-motion settings take priority</small></span><input type="checkbox" data-setting="motion" data-focus-key="setting-motion" ${experienceSettings.motionEnabled === false ? "" : "checked"}></label><form class="daily-settings-form" data-daily-settings-form><fieldset class="settings-group"><legend>Daily learning</legend><label for="daily-study-target">Daily learning target</label><input id="daily-study-target" name="daily-study-target" type="number" min="1" max="50" step="1" value="${
    dailySettings?.dailyStudyTarget ?? 5
  }"><label for="daily-recall-limit">Daily review target</label><input id="daily-recall-limit" name="daily-recall-limit" type="number" min="0" step="1" value="${
    dailySettings?.dailyRecallLimit ?? 5
  }"><p class="settings-form-note">Independent daily goals: knowledge cards studied on Feed and quiz cards completed on Review. Both pages show up to five cards at a time.</p><p class="settings-form-error" data-daily-settings-error tabindex="-1"></p><button class="button secondary" type="submit">Save learning targets</button></fieldset></form>${
    settingsIssue === null ? "" : `<div class="settings-recovery" role="status">
            <p>${escapeHtml(friendlySettingsFailure(settingsIssue.kind))}</p>
            <button class="button secondary" type="button" data-action="reset-settings" data-focus-key="reset-settings">Reset display settings</button>
          </div>`
  }<details class="youtube-information"><summary>YouTube information</summary>${APP_COPY.discoverMarkup.youtubeConnected}</details>`;
}

/** @param {"system" | "light" | "dark"} mode @param {string} label */
function themeOption(mode, label) {
  return `<label><input type="radio" name="theme-mode" value="${mode}" data-setting="theme" data-focus-key="theme-${mode}" ${
    experienceSettings.themeMode === mode ? "checked" : ""
  }><span>${label}<small>${mode === "system" ? "Use device" : mode === "light" ? "Light" : "Dark"}</small></span></label>`;
}

function renderFeed() {
  if (learnerController !== null) return learnerController.renderFeed();
  return renderPanelState(APP_COPY.panelLoading);
}

function renderReviewView() {
  if (learnerController !== null) return learnerController.renderReview();
  return renderPanelState(APP_COPY.panelLoading);
}

function renderLibraryView() {
  if (libraryRouteIssue !== null) {
    return renderRouteFailure("library", "Library", libraryRouteIssue);
  }
  if (libraryPageController === null) {
    return renderPanelState(APP_COPY.panelLoading);
  }
  return libraryPageController.render({});
}

/** @param {"library"} route @param {string} title @param {string} message */
function renderRouteFailure(route, title, message) {
  return `<section class="wide-view state-panel" aria-labelledby="${route}-title"><h1 id="${route}-title">${title}</h1><p>${
    escapeHtml(message)
  }</p><button class="button primary" type="button" data-action="retry-route" data-route="${route}">Try again</button></section>`;
}

function bindInteractions() {
  cardReader.bind(root);
  root.querySelectorAll("[data-view]").forEach((element) => {
    element.addEventListener("click", () => {
      const view = element.getAttribute("data-view");
      if (
        view === "feed" || view === "discover" || view === "review" ||
        view === "library" || view === "progress" || view === "settings" || view === "upload"
      ) {
        location.hash = view;
      }
    });
  });
  root.querySelector("[data-library-processing-open]")?.addEventListener("click", () => {
    if (activeView === "library") void libraryPageController?.revealProcessing();
    else { revealProcessingOnNavigation = true; location.hash = "library"; }
  });
  if (activeView === "progress") progressPage?.bind(root);
  if (activeView === "settings") settingsPage?.bind(root);
  if (activeView === "discover") discoveryPage?.bind(root);
  if (activeView === "library") libraryPageController?.bind(root);
  if (activeView === "upload") uploadPage?.bind(root);
  if (learnerController !== null && (activeView === "feed" || activeView === "review")) learnerController.bind(root);
  root.querySelectorAll("[data-action='new-session']").forEach((element) => {
    element.addEventListener("click", () => void beginNewSession());
  });
  root.querySelector("[data-action='retry']")?.addEventListener(
    "click",
    () => void beginNewSession(),
  );
  root.querySelector("[data-action='load-more']")?.addEventListener(
    "click",
    () => void loadMore(),
  );
  root.querySelectorAll("[data-action='mark-studied']").forEach((element) => {
    element.addEventListener("click", (event) => {
      void recordManualStudy(
        /** @type {HTMLElement} */ (event.currentTarget),
      );
    });
  });
  root.querySelector("[data-action='export']")?.addEventListener(
    "click",
    exportLocalData,
  );
  root.querySelector("[data-action='reset']")?.addEventListener(
    "click",
    resetLocalData,
  );
  root.querySelector("[data-action='retry-route']")?.addEventListener(
    "click",
    (event) => void retryRoute(event.currentTarget),
  );
  root.querySelectorAll("[data-setting='theme']").forEach((element) => {
    element.addEventListener(
      "change",
      () =>
        void loadExperienceActions().then((actions) =>
          actions.updateTheme(element)
        ),
    );
  });
  root.querySelector("[data-setting='motion']")?.addEventListener("change", event => { void loadExperienceActions().then(actions => actions.updateMotion(event)); });
  root.querySelector("[data-setting='sound']")?.addEventListener(
    "change",
    (event) =>
      void loadExperienceActions().then((actions) =>
        actions.updateSound(event)
      ),
  );
  root.querySelector("[data-action='reset-settings']")?.addEventListener(
    "click",
    () => void loadExperienceActions().then((actions) => actions.reset()),
  );
  root.querySelector("[data-daily-settings-form]")?.addEventListener(
    "submit",
    (event) => void saveDailySettings(event),
  );
}

async function loadMore(restoreAppendedFocus = true) {
  if (!hasHiddenAssignedItems()) return;
  revealedStudyItems += 1;
  syncVisibleAssignment();
  if (!restoreAppendedFocus) {
    render();
    return;
  }
  const appended = visibleItems.at(-1);
  await renderWithTransition(
    appended ? `card-heading:${appended.candidateId}` : "cursor-restart",
    "feed-title",
  );
}

async function beginNewSession() {
  if (sessionStartPending) return;
  sessionStartPending = true;
  render("new-session", "feed-title");
  await startFeedSession();
  sessionStartPending = false;
  await renderWithTransition("new-session", "feed-title");
}

/** @param {HTMLElement} element */
async function recordManualStudy(element) {
  const candidateId = element.getAttribute("data-candidate-id") ?? "";
  const idempotencyKey = studyKey(candidateId, 1);
  if (pendingWrites.has(idempotencyKey)) return;
  pendingWrites.add(idempotencyKey);
  element.setAttribute("disabled", "");
  const command = freeze({
    ownerId: LOCAL_OWNER_ID,
    candidateId,
    contentVersion: 1,
    idempotencyKey,
    occurredAt: new Date().toISOString(),
  });
  const recorded = await studyService.record(command);
  pendingWrites.delete(idempotencyKey);
  element.removeAttribute("disabled");
  if (!recorded.ok) {
    notice = recorded.error.kind === "StudyAlreadyRecorded"
      ? "This lesson is already studied."
      : recorded.error.kind === "StudyPersistenceFailed"
      ? "This study status could not be saved."
      : "The lesson could not be marked studied.";
    render();
    return;
  }
  notice = APP_COPY.studySaved;
  await refreshPromptAvailability();
  render(`card-heading:${candidateId}`, "feed-title");
}

async function exportLocalData() {
  if (!(await runLocalDataExport())) return;
  notice = APP_COPY.exported;
  render();
}

/** @returns {Promise<boolean>} */
async function runLocalDataExport() {
  const { exportLocalData: runExport } = await import(
    "./startup/local-data-actions.js"
  );
  const result = await runExport({
    ownerId: LOCAL_OWNER_ID,
    persistence,
    recordKinds: RECORD_KINDS,
    experienceSettings,
    now: () => new Date().toISOString(),
    document,
    url: URL,
  });
  if (!result.ok) {
    errorMessage = APP_COPY.exportFailed;
    render();
    return false;
  }
  return true;
}

/** @param {EventTarget | null} target */
async function retryRoute(target) {
  if (!(target instanceof Element)) return;
  const route = target.getAttribute("data-route");
  if (route !== "library") return;
  libraryRouteIssue = null;
  loadedRoutes.delete(route);
  await loadActiveRoute();
  render(`${route}-title`, `${route}-title`);
}

async function resetLocalData() {
  if (!confirm("Erase all Resonance data in this browser?")) {
    return;
  }
  const { eraseLocalData } = await import("./startup/local-data-actions.js");
  const erased = await eraseLocalData({
    ownerId: LOCAL_OWNER_ID,
    persistence,
    settings: settingsRepository,
  });
  if (!erased.ok && erased.error.kind === "LocalDataLearningEraseFailed") {
    errorMessage = APP_COPY.eraseFailed;
    render();
    return;
  }
  if (!erased.ok) {
    alert(
      "Learning records were erased, but display settings could not be removed.",
    );
    location.reload();
    return;
  }
  location.reload();
}

/**
 * @param {PersistenceEnvelope} envelope
 * @param {boolean} allowDuplicate
 * @returns {Promise<boolean>}
 */
async function appendEnvelope(envelope, allowDuplicate) {
  const result = await persistence.append(envelope);
  if (
    !result.ok &&
    !(allowDuplicate && result.error.kind === "PersistenceDuplicate")
  ) {
    errorMessage = friendlyPersistenceError(result.error.kind);
    return false;
  }
  return true;
}

function renderMessagesOnly() {
  synchronizeNotification(notifications, notice, errorMessage);
  const region = root.querySelector(".toast-region");
  if (region) {
    region.innerHTML = renderNotification(notifications.current(), escapeHtml);
  }
}

function loadExperienceSettings() {
  const loaded = settingsRepository.load();
  if (loaded.ok) {
    experienceSettings = loaded.value;
    settingsIssue = null;
    return;
  }
  experienceSettings = DEFAULT_SETTINGS;
  settingsIssue = loaded.error.kind === "SettingsMissing" ? null : loaded.error;
}

function applyExperiencePresentation() {
  const resolved = resolveTheme(
    experienceSettings.themeMode,
    systemThemeQuery.matches,
  );
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.motion = experienceSettings.motionEnabled === false ? "off" : "on";
  // Legacy presets remain readable/exportable, but only appearance owns composition.
  document.documentElement.style.colorScheme = resolved;
  const themeMeta = document.querySelector("meta[name='theme-color']");
  if (themeMeta instanceof HTMLMetaElement) {
    themeMeta.content = getComputedStyle(document.documentElement)
      .backgroundColor;
  }
}

async function loadExperienceActions() {
  if (experienceActions !== null) return experienceActions;
  const module = await import("./startup/experience-actions.js");
  experienceActions = module.createExperienceActions({
    store: settingsRepository,
    getSettings: () => experienceSettings,
    setSettings: (settings, issue) => {
      experienceSettings = settings;
      settingsIssue = issue;
    },
    defaultSettings: DEFAULT_SETTINGS,
    visualThemes: VISUAL_THEMES,
    layouts: LAYOUTS,
    applyPresentation: applyExperiencePresentation,
    transitions,
    reducedMotion: () => reducedMotionQuery.matches || experienceSettings.motionEnabled === false,
    render,
    playInteractionCue: () => void playInteractionCue(),
  });
  return experienceActions;
}

/** @param {Event} event */
async function saveDailySettings(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!(form instanceof HTMLFormElement) || dailySettings === null) return;
  const data = new FormData(form);
  const target = Number(data.get("daily-study-target"));
  const limit = Number(data.get("daily-recall-limit"));
  const result = dailyLearningService.saveSettings({
    ownerId: LOCAL_OWNER_ID,
    dailyStudyTarget: target,
    dailyRecallLimit: limit,
    timeZone: dailySettings.timeZone,
    expectedRevision: dailySettings.revision,
    updatedAt: new Date().toISOString(),
  });
  if (!result.ok) {
    const error = form.querySelector("[data-daily-settings-error]");
    if (error instanceof HTMLElement) {
      error.textContent = "Use a 1–50 learning target and a non-negative whole-number review target.";
      error.focus();
    }
    return;
  }
  if (!(await commitDailySettings(result.value))) return;
  notice = APP_COPY.targetsSaved;
  render("settings-summary", null);
}

/** @param {boolean} correct */
async function playAnswerCue(correct) {
  const service = correct ? correctAudio : incorrectAudio;
  await playFeedbackCue(service);
}

/** @param {string|null} [subject] */
async function playInteractionCue(subject = null) {
  await playFeedbackCue(interactionAudio, subjectPresentation(subject)?.cue);
}

/** @param {FeedbackAudioService} service @param {import("./features/experience/contracts.js").AudioCue} [cue] */
async function playFeedbackCue(service, cue) {
  const played = await service.playCue({
    enabled: experienceSettings.soundEnabled,
    ...(cue === undefined ? {} : { cue }),
    explicitActivation: true,
  });
  if (played.ok || played.error.kind === "AudioActivationRequired") return;
  const disabled = freeze({
    ...experienceSettings,
    soundEnabled: false,
  });
  const saved = settingsRepository.save(disabled);
  if (saved.ok) {
    experienceSettings = saved.value;
  } else {
    settingsIssue = saved.error;
  }
  const soundToggle = root.querySelector("[data-setting='sound']");
  if (soundToggle instanceof HTMLInputElement) soundToggle.checked = false;
  notice = APP_COPY.soundsUnavailable;
  renderMessagesOnly();
}

/**
 * @param {string | null} focusKey
 * @param {string | null} fallbackHeadingId
 */
async function renderWithTransition(focusKey, fallbackHeadingId) {
  await applyPresentationUpdate({
    update: () => render(focusKey, fallbackHeadingId),
    transitions,
    reducedMotion: reducedMotionQuery.matches || experienceSettings.motionEnabled === false,
  });
}

/** @param {string | null} focusKey @param {string | null} headingId */
function restoreFocus(focusKey, headingId) {
  const escapedKey = focusKey === null ? null : CSS.escape(focusKey);
  const preferred = escapedKey === null
    ? null
    : root.querySelector(`[data-focus-key="${escapedKey}"]`) ?? (focusKey === "discovery-more" ? root.querySelector(".discover-result:last-child > a") : null);
  if (preferred instanceof HTMLElement) {
    preferred.focus({preventScroll: focusKey === "discovery-more"});
    if (document.activeElement === preferred) return;
  }
  const heading = headingId === null
    ? null
    : document.getElementById(headingId);
  if (heading instanceof HTMLElement) {
    heading.tabIndex = -1;
    heading.focus();
    if (document.activeElement === heading) return;
  }
  if (focusKey !== null || headingId !== null) {
    const workspace = root.querySelector("#main-content");
    if (workspace instanceof HTMLElement) workspace.focus();
  }
}

function registerOfflineSupport() {
  addEventListener("pagehide", () => cardReader.stop());
  addEventListener("online", () => render());
  addEventListener("offline", () => render());
  addEventListener("pagehide", () => libraryPageController?.dispose());
  addEventListener("pageshow", () => { void libraryPageController?.resume(); });
  systemThemeQuery.addEventListener("change", () => {
    if (experienceSettings.themeMode !== "system") return;
    void applyPresentationUpdate({
      update: () => {
        applyExperiencePresentation();
      },
      transitions,
      reducedMotion: reducedMotionQuery.matches || experienceSettings.motionEnabled === false,
    });
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      void refreshPromptAvailability().then(() => render());
      if (settingsPage !== null) void settingsPage.syncTimeZone(); else void syncReminderTimeZone();
    }
  });
  addEventListener("hashchange", () => {
    const route = parseRoute(location.hash);
    const preserveResults = activeView === "discover" && route.view === "discover" && matchMedia("(min-width: 801px)").matches;
    activeView = route.view;
    discoveryItemId = route.discoveryItemId;
    if (preserveResults) {
      const top = scrollY;
      render();
      const selected = root.querySelector('.discover-result a[aria-current="true"]');
      if (selected instanceof HTMLElement) selected.focus({ preventScroll: true });
      scrollTo(0, top);
      return;
    }
    void loadActiveRoute().then(async () => {
      await renderWithTransition(
        `nav-${route.view}`,
        route.view === "feed" ? "feed-title" : `${route.view}-title`,
      );
      if (revealProcessingOnNavigation && route.view === "library") {
        revealProcessingOnNavigation = false;
        await libraryPageController?.revealProcessing();
      }
    });
  });
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("message", (event) => {
      if (event.data?.type === "resonance-reminder-open" || event.data?.type === "resonance-source-update-open") {
        activeView = event.data.type === "resonance-reminder-open" ? "review" : "library";
        discoveryItemId = null;
        if (activeView === "library") loadedRoutes.delete("library");
        else void learnerController?.loadReview();
        if (location.hash === `#${activeView}`) {
          const view = activeView;
          void loadActiveRoute().then(() =>
            renderWithTransition(`nav-${view}`, `${view}-title`)
          );
        } else {
          location.hash = activeView;
        }
        return;
      }
      if (!isOfflineFailureMessage(event.data)) return;
      showOfflineFailure(event.data.kind);
    });
    navigator.serviceWorker.register("./service-worker.js")
      .then(watchServiceWorkerInstall)
      .catch(() => showOfflineFailure("OfflineRegistrationFailed"));
  }
}

async function syncReminderTimeZone() {
  try {
    if (localStorage.getItem(`resonance:reminder:${LOCAL_OWNER_ID}:enrolled`) !== "true") return;
    const { createReminderClient } = await import("./features/reminders/client.js");
    const client = createReminderClient({ ownerId: LOCAL_OWNER_ID, fetch, storage: localStorage, navigator });
    const result = await client.syncTimeZone();
    if (result.message) errorMessage = result.message;
  } catch (error) { if (!(error instanceof Error)) throw error; errorMessage = "Reminder settings could not refresh. Open Settings to retry."; }
}

/** @param {ServiceWorkerRegistration} registration */
function watchServiceWorkerInstall(registration) {
  observeInstallingWorker(
    registration.installing,
    navigator.serviceWorker.controller !== null,
  );
  registration.addEventListener("updatefound", () => {
    observeInstallingWorker(
      registration.installing,
      navigator.serviceWorker.controller !== null,
    );
  });
}

/** @param {ServiceWorker | null} installing @param {boolean} isUpgrade */
function observeInstallingWorker(installing, isUpgrade) {
  if (installing === null) return;
  installing.addEventListener("statechange", () => {
    if (installing.state !== "redundant") return;
    showOfflineFailure(
      isUpgrade ? "OfflineUpgradeFailed" : "OfflineCacheInstallFailed",
    );
  });
}

/**
 * @param {"OfflineRegistrationFailed" | "OfflineCacheInstallFailed" | "OfflineUpgradeFailed" | "OfflineCacheMiss"} kind
 */
function showOfflineFailure(kind) {
  errorMessage = friendlyOfflineFailure(kind);
  renderMessagesOnly();
}

/**
 * @param {unknown} value
 * @returns {value is {
 *   readonly type: "resonance-offline-failure",
 *   readonly kind: "OfflineCacheInstallFailed" | "OfflineUpgradeFailed" | "OfflineCacheMiss"
 * }}
 */
function isOfflineFailureMessage(value) {
  if (!isRecord(value) || value.type !== "resonance-offline-failure") {
    return false;
  }
  return value.kind === "OfflineCacheInstallFailed" ||
    value.kind === "OfflineUpgradeFailed" ||
    value.kind === "OfflineCacheMiss";
}

/** @param {CatalogCandidate} candidate */
function scopeForCandidate(candidate) {
  return `related:${candidate.knowledgeUnitIds.join("+")}`;
}

function currentStudySets() {
  if (dailySettings === null) return [];
  return dailyLearningRepository.listStudySets(
    LOCAL_OWNER_ID,
    learningDay(dailySettings.timeZone),
  );
}

function hasHiddenAssignedItems() {
  const assigned = currentStudySets().reduce(
    (total, set) => total + set.items.length,
    0,
  );
  return revealedStudyItems < assigned;
}

function currentLearningDay() {
  return learningDay(
    dailySettings?.timeZone ??
      Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
}

/** @param {string} timeZone */
function learningDay(timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

/** @param {string} day @param {number} count */
function subtractLearningDays(day, count) {
  const [year, month, date] = day.split("-").map(Number);
  if (
    !Number.isInteger(year) || !Number.isInteger(month) ||
    !Number.isInteger(date) || !Number.isInteger(count) || count < 0
  ) {
    throw new TypeError("LearningDayDateInvalid");
  }
  return new Date(Date.UTC(year, month - 1, date) - count * 86_400_000)
    .toISOString().slice(0, 10);
}

/** @param {string} promptId @returns {CatalogCandidate | undefined} */
function candidateForPrompt(promptId) {
  const direct = candidates.find((candidate) => candidate.quiz.id === promptId);
  if (direct !== undefined) return direct;
  const generated = promptRuntime.listPrompts(LOCAL_OWNER_ID).find((prompt) =>
    prompt.id === promptId
  );
  if (generated === undefined) return undefined;
  const source = candidates.find((candidate) =>
    candidate.id === generated.contentId
  );
  if (source === undefined) return undefined;
  return freeze({
    ...source,
    quiz: freeze({
      ...source.quiz,
      id: generated.id,
      prompt: generated.prompt,
      version: generated.version,
    }),
  });
}

/**
 * @param {CatalogCandidate} candidate
 * @returns {import("./features/questions/contracts.js").Question}
 */
function questionForCandidate(candidate) {
  const quiz = candidate.quiz;
  const metadata = {
    contentId: candidate.id,
    contentVersion: 1,
    knowledgeUnitIds:
      /** @type {[string, ...string[]]} */ ([...candidate.knowledgeUnitIds]),
    sourceAnchorIds:
      /** @type {[string, ...string[]]} */ ([...candidate.knowledgeUnitIds]),
    generatorVersion: "fixture-generator-v2",
    version: quiz.version,
    scorerVersion: quiz.kind === "free-response" || quiz.kind === "case-study"
      ? "local-concept-v1"
      : "local-exact-v1",
    provenance: "fixture-generator",
  };
  if (quiz.kind === "single-choice" || quiz.kind === "multiple-choice") {
    const choices = quiz.choices.map((
      /** @type {string} */ label,
      /** @type {number} */ index,
    ) => ({
      id: String(index),
      label,
    }));
    return /** @type {import("./features/questions/contracts.js").Question} */ ({
      id: quiz.id,
      prompt: quiz.prompt,
      kind: quiz.kind,
      choices,
      correctChoiceIds: quiz.correctChoices.map(String),
      explanation: quiz.explanation,
      ...metadata,
    });
  }
  if (quiz.kind === "fill-blank") {
    return {
      id: quiz.id,
      prompt: quiz.prompt,
      kind: quiz.kind,
      blankId: `${quiz.id}:blank-1`,
      acceptedAnswers:
        /** @type {[string, ...string[]]} */ ([...quiz.acceptedAnswers]),
      explanation: quiz.explanation,
      ...metadata,
    };
  }
  if (quiz.kind === "case-study") {
    return {
      id: quiz.id,
      prompt: quiz.prompt,
      kind: quiz.kind,
      stimulus: quiz.stimulus ?? "",
      childQuestionIds:
        /** @type {[string, ...string[]]} */ ([`${quiz.id}:response`]),
      explanation: quiz.explanation,
      ...metadata,
    };
  }
  return {
    id: quiz.id,
    prompt: quiz.prompt,
    kind: /** @type {const} */ ("free-response"),
    expectedConcepts:
      /** @type {[string, ...string[]]} */ ([...quiz.expectedConcepts]),
    minimumWords: quiz.minimumWords,
    explanation: quiz.explanation,
    ...metadata,
  };
}

/** @param {CatalogCandidate} candidate */
function caseChildForCandidate(candidate) {
  const quiz = candidate.quiz;
  if (quiz.kind !== "case-study") return null;
  return freeze({
    id: `${quiz.id}:response`,
    prompt: quiz.prompt,
    kind: /** @type {const} */ ("free-response"),
    expectedConcepts:
      /** @type {[string, ...string[]]} */ ([...quiz.expectedConcepts]),
    minimumWords: quiz.minimumWords,
    explanation: quiz.explanation,
    contentId: candidate.id,
    contentVersion: 1,
    knowledgeUnitIds:
      /** @type {[string, ...string[]]} */ ([...candidate.knowledgeUnitIds]),
    sourceAnchorIds:
      /** @type {[string, ...string[]]} */ ([...candidate.knowledgeUnitIds]),
    generatorVersion: "fixture-generator-v2",
    version: quiz.version,
    scorerVersion: "local-concept-v1",
    provenance: "fixture-generator",
  });
}

/** @param {string} candidateId @param {number} contentVersion */
function studyKey(candidateId, contentVersion) {
  return `study:${LOCAL_OWNER_ID}:${candidateId}:v${contentVersion}`;
}

/** @param {string} hash */
function parseRoute(hash) { return parseAppRoute(hash, location.search); }
/** @param {"feed"|"discover"|"review"|"library"|"upload"|"progress"} view @param {string} label @param {boolean} [hasNotification] */
function navButton(view,label,hasNotification=false) { return renderNavigationButton(view,label,activeView,hasNotification); }

/** @param {string} elementId @returns {unknown} */
function readEmbeddedJson(elementId) {
  const element = document.getElementById(elementId);
  if (!(element instanceof HTMLScriptElement)) {
    throw new TypeError(`EmbeddedDataMissing:${elementId}`);
  }
  try {
    return /** @type {unknown} */ (JSON.parse(element.textContent ?? ""));
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new TypeError(`EmbeddedDataMalformed:${elementId}`);
  }
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return typeof value === "object" && value !== null;
}

/** @param {string} value */
function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) =>
    ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    })[character] ?? character);
}

/** @param {string} value */
function formatDate(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "invalid date";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

/** @param {string} kind */
function friendlyFailure(kind) {
  if (kind === "CursorExpired") {
    return APP_COPY.feedExpired;
  }
  if (kind === "FeedSessionMissing") {
    return APP_COPY.feedUnavailable;
  }
  if (kind === "InvalidPageLimit") {
    return APP_COPY.pageSizeUnsupported;
  }
  if (kind === "CursorMalformed") {
    return APP_COPY.cursorInvalid;
  }
  if (kind === "CursorOwnerMismatch") {
    return APP_COPY.feedOwnerMismatch;
  }
  if (kind === "CursorSessionMismatch") {
    return APP_COPY.pageMismatch;
  }
  if (kind === "CandidateUnavailable" || kind === "CandidateSourceDisabled") {
    return APP_COPY.lessonUnavailable;
  }
  return APP_COPY.feedOpenFailed;
}

/** @param {string} kind */
function friendlyPersistenceError(kind) {
  if (kind === "PersistenceUnavailable") {
    return APP_COPY.storageUnavailable;
  }
  return APP_COPY.learningDataUnavailable;
}

/**
 * @param {{ readonly kind: "LocalStateReadFailed", readonly persistenceKind: import("./persistence/contracts.js").PersistenceFailure["kind"] } | { readonly kind: "LocalStateCorrupt", readonly recordKind: RecordKind, readonly recordId: string }} failure
 * @returns {{ readonly kind: "LocalStateReadFailed" | "LocalStateCorrupt", readonly message: string }}
 */
function restoreRecoveryFor(failure) {
  if (failure.kind === "LocalStateReadFailed") {
    return freeze({
      kind: failure.kind,
      message: friendlyPersistenceError(failure.persistenceKind),
    });
  }
  return freeze({
    kind: failure.kind,
    message:
      "Resonance could not safely open part of this browser's saved learning data.",
  });
}

/** @param {string} kind */
function friendlyOfflineFailure(kind) {
  if (kind === "OfflineCacheMiss") {
    return APP_COPY.offlineMiss;
  }
  if (kind === "OfflineUpgradeFailed") {
    return APP_COPY.offlineUpgrade;
  }
  return APP_COPY.offlineFailed;
}

/** @param {string} kind */
function friendlySettingsFailure(kind) {
  if (kind === "SettingsReadUnavailable") {
    return APP_COPY.settingsRead;
  }
  if (kind === "SettingsWriteUnavailable") {
    return APP_COPY.settingsWrite;
  }
  if (kind === "SettingsEraseUnavailable") {
    return APP_COPY.settingsReset;
  }
  return APP_COPY.settingsInvalid;
}

/** @returns {import("./features/experience/contracts.js").SettingsStorage} */
function resolveSettingsStorage() {
  try {
    return window.localStorage;
  } catch {
    const unavailable = () => {
      throw new DOMException("Storage unavailable", "InvalidStateError");
    };
    return {
      getItem() {
        unavailable();
        return null;
      },
      setItem() {
        unavailable();
      },
      removeItem() {
        unavailable();
      },
    };
  }
}

/** @param {Document} targetDocument @returns {ViewTransitionCapability | null} */
function resolveTransitionCapability(targetDocument) {
  const capableDocument = /** @type {Document & {
    startViewTransition?: (update: () => void) => import("./features/experience/contracts.js").ViewTransitionHandle
  }} */
    (targetDocument);
  const start = capableDocument.startViewTransition?.bind(capableDocument);
  return start === undefined ? null : { start };
}

/** @returns {(() => AudioContextPort) | null} */
function resolveAudioContextFactory() {
  if (typeof AudioContext !== "function") return null;
  return () => /** @type {AudioContextPort} */ (
    /** @type {unknown} */ (new AudioContext())
  );
}

/** @param {string} message @param {string} [sourceUrl] */
function confirmUpload(message, sourceUrl) {
  errorMessage = notice = null;
  if (!confirm(message)) return false;
  if (sourceUrl) open(sourceUrl, "_blank", "noopener,noreferrer");
  return true;
}
