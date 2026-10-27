// @ts-check

const freeze = Object.freeze;
import { loadOptions, saveOptions } from "../features/experience/options.js";
import { isRecord } from "../features/source-library/contracts.js";

/** @typedef {{providerIds:string[],limit:number,extractionScope:"page"|"platform"}} DiscoveryOptions */
/** @param {unknown} value @returns {value is DiscoveryOptions} */
function validOptions(value) {
  return isRecord(value) && Array.isArray(value.providerIds) && value.providerIds.every(id => typeof id === "string" && id.trim() !== "") && new Set(value.providerIds).size === value.providerIds.length && [5,10,20].includes(/** @type {number} */(value.limit)) && (value.extractionScope === "page" || value.extractionScope === "platform");
}

import {
  createDiscoveryRuntime,
  renderDiscoverRoute,
  toDiscoverRouteModel,
} from "./discovery-runtime.js";
import { SourceLibraryGatewayClient } from "../features/source-library/gateway.js";
import { DiscoverySearchGatewayClient, validCentralSearchCommand } from "../features/discovery/gateway.js";
import {
  createYouTubeConnectionController,
  friendlyDiscoveryFailure,
} from "./youtube-connection.js";

/** @import { PersistenceEnvelope, PersistenceFailure, RecordKind } from "../persistence/contracts.js" */
/** @template T @template E @typedef {{readonly ok:true,readonly value:T}|{readonly ok:false,readonly error:E}} Result */
/** @typedef {{appendBatch(records:readonly PersistenceEnvelope[]):Promise<Result<readonly PersistenceEnvelope[],PersistenceFailure>>,list(ownerId:string,kind:RecordKind):Promise<Result<readonly PersistenceEnvelope[],PersistenceFailure>>}} DiscoveryPersistence */

/**
 * @param {{readonly ownerId:string,readonly persistence:DiscoveryPersistence,readonly fetch:typeof fetch,readonly gatewayBaseUrl:string,readonly policyStorage:{readonly getItem:(key:string)=>string|null,readonly setItem:(key:string,value:string)=>void},readonly starterInventory:unknown,readonly markup:import("../routes/discover.js").DiscoverMarkup,readonly escapeHtml:(value:string)=>string,readonly createId:()=>string,readonly now:()=>string,readonly onNotice:(message:string)=>void,readonly onError:(message:string)=>void,readonly navigateToLibrary:(sourceId:string)=>void,readonly confirmUpload?:(message:string,sourceUrl?:string)=>boolean,readonly navigateToUpload:(prefill:import("../features/uploads/page.js").UploadPrefill)=>void,readonly rerender:()=>void}} dependencies
 */
export function createDiscoveryPage(dependencies) {
  if (
    typeof dependencies.ownerId !== "string" ||
    dependencies.ownerId.trim() === "" ||
    typeof dependencies.persistence?.appendBatch !== "function" ||
    typeof dependencies.persistence?.list !== "function" ||
    typeof dependencies.fetch !== "function" ||
    !URL.canParse(dependencies.gatewayBaseUrl) ||
    typeof dependencies.policyStorage?.getItem !== "function" ||
    typeof dependencies.policyStorage?.setItem !== "function" ||
    typeof dependencies.escapeHtml !== "function" ||
    typeof dependencies.createId !== "function" ||
    typeof dependencies.now !== "function" ||
    typeof dependencies.onNotice !== "function" ||
    typeof dependencies.onError !== "function" ||
    typeof dependencies.navigateToLibrary !== "function" ||
    typeof dependencies.navigateToUpload !== "function" ||
    typeof dependencies.rerender !== "function"
  ) throw new TypeError("DiscoveryDependenciesInvalid");
  const {
    createId,
    fetch: requestFetch,
    gatewayBaseUrl,
    navigateToLibrary,
    now,
    policyStorage,
  } = dependencies;
  const markup = dependencies.markup;
  const escapeHtml = dependencies.escapeHtml;
  const onNotice = dependencies.onNotice;
  const onError = dependencies.onError;
  const rerender = dependencies.rerender;
  const issued = new Map();
  const sessionSeed = createId();
  const runtime = createDiscoveryRuntime({
    ownerId: dependencies.ownerId,
    persistence: dependencies.persistence,
    clock: freeze({
      now: () => ({
        ok: /** @type {const} */ (true),
        value: now(),
      }),
    }),
    createId,
    cursorCodec: freeze({
      encode: (cursor) => {
        const token = createId();
        issued.set(token, cursor);
        return { ok: true, value: token };
      },
      decode: (token) => {
        const cursor = issued.get(token);
        return cursor === undefined
          ? {
            ok: false,
            error: {
              kind: /** @type {const} */ ("DiscoveryPageCursorInvalid"),
              reason: "unknown-or-tampered",
            },
          }
          : { ok: true, value: cursor };
      },
    }),
    starterInventory:
      /** @type {Parameters<typeof createDiscoveryRuntime>[0]["starterInventory"]} */ (
        withSessionSeed(dependencies.starterInventory, sessionSeed)
      ),
  });
  const sourceLibrary = new SourceLibraryGatewayClient({
    fetch: requestFetch,
    baseUrl: gatewayBaseUrl,
    timeoutMs: 15_000,
  });
  const centralGateway = new DiscoverySearchGatewayClient({
    fetch: requestFetch,
    baseUrl: gatewayBaseUrl,
    timeoutMs: 30_000,
  });
  const youtubeConnection = createYouTubeConnectionController({
    storage: policyStorage,
    now,
    markup,
    onNotice,
    onError,
    rerender,
  });
  let searchPending = false;
  let searchInitialized = false;
  let searchGeneration = 0;
  let morePending = false;
  /** @type {string|null} */ let moreFailure = null;
  /** @type {{query:string,limit:number,cursors:Readonly<Record<string,string>>}|null} */ let continuation = null;
  /** @type {import("../features/discovery/gateway.js").GatewaySearchCapability[]} */ let searchCapabilities = [];
  /** @type {import("../routes/discover.js").DiscoverRouteItem[]|null} */ let centralRouteItems = null;
  /** @type {string|null} */ let searchFailure = null;
  let searchQuery = "";
  const optionsKey = `resonance:discovery-options:${encodeURIComponent(dependencies.ownerId)}`;
  const savedOptions = loadOptions(policyStorage, optionsKey, validOptions, onError);
  let searchLimit = savedOptions?.limit ?? 10;
  /** @type {"page"|"platform"} */ let extractionScope = savedOptions?.extractionScope ?? "page";
  /** @type {string[]} */ let selectedProviderIds = [];
  /** @type {string | null} */ let pendingDecisionItemId = null;
  /** @type {Map<string, import("../routes/discover.js").DiscoverRouteItem>} */ const routeItems =
    new Map();
  /** @type {Set<string>} */ const suppressed = new Set();
  /** @type {Record<string,"page"|"platform">} */ const extractionScopes = {};
  let sourceActionsAvailable = false;
  return freeze({
    async load() {
      const youtubePolicy = youtubeConnection.load();
      if (!youtubePolicy.ok) {
        onError("YouTube policy preference could not be read.");
      }
      const [loaded, capabilities, areas] = await Promise.all([
        runtime.load(),
        centralGateway.capabilities(),
        sourceLibrary.browse({ limit: 1 }),
      ]);
      if (capabilities.ok) {
        const initializeProviders = searchCapabilities.length === 0;
        searchCapabilities = [...capabilities.value];
        if (!searchInitialized) {
          if (initializeProviders) {
            selectedProviderIds = savedOptions === null ? searchCapabilities.filter((provider) =>
              provider.enabled && provider.id !== "youtube"
            ).map((provider) => provider.id) : savedOptions.providerIds.filter(id => searchCapabilities.some(provider => provider.id === id && provider.enabled));
          }
          searchFailure = null;
        }
      } else if (!searchInitialized) {
        searchFailure = friendlyDiscoveryFailure(
          capabilities.error,
          markup,
        );
      }
      if (areas.ok) {
        sourceActionsAvailable = true;
      }
      if (loaded.ok && sourceActionsAvailable) await syncSuppressions();
      return !loaded.ok ? loaded : !capabilities.ok ? capabilities : !areas.ok ? areas : loaded;
    },
    /** @param {{readonly selectedItemId:string|null,readonly online:boolean}} route */
    render(route) {
      if (searchPending) return loading(escapeHtml, markup);
      const projected = runtime.renderModel({
        name: "discover",
        cursor: null,
        selectedItemId: route.selectedItemId,
        online: route.online,
        starterOnly: route.online && centralRouteItems === null,
      });

      if (projected.ok) {
        return renderItems(projected.value, route, centralRouteItems);
      }

      if (
        projected.error.kind === "DiscoveryRuntimeSelectedItemUnknown" &&
        route.selectedItemId !== null
      ) {
        const list = runtime.renderModel({
          name: "discover",
          cursor: null,
          selectedItemId: null,
          online: route.online,
          starterOnly: route.online && centralRouteItems === null,
        });

        if (list.ok) {
          return renderItems(list.value, route, centralRouteItems);
        }
      }
      return renderDiscoverRoute({
        ...emptyRoute(escapeHtml, markup),
        state: "error",
        stateMessage: friendlyDiscoveryFailure(
          projected.error,
          markup,
        ),
        markup,
        search: searchModel(route.online),
      });
    },
    /** @param {ParentNode} root */
    bind(root) {
      youtubeConnection.bind(root);
      const searchForm = root.querySelector("[data-discovery-search-form]");
      searchForm?.addEventListener(
        "submit",
        (event) => {
          event.preventDefault();
          if (!(event.currentTarget instanceof HTMLFormElement)) return;
          const form = new FormData(event.currentTarget);
          const query = form.get("query");
          const providerIds = form.getAll("provider").filter((value) =>
            typeof value === "string"
          );
          const limit = Number(form.get("limit"));
          if (typeof query === "string") {
            void search({ query, providerIds, limit });
          }
        },
      );
      searchForm?.setAttribute("data-discovery-search-bound", "true");
      const rememberOptions = () => {
        if (!(searchForm instanceof HTMLFormElement)) return;
        const values = new FormData(searchForm);
        searchQuery = String(values.get("query") ?? "");
        selectedProviderIds = values.getAll("provider").map(String);
        searchLimit = Number(values.get("limit"));
        persistOptions();
      };
      searchForm?.addEventListener("input", rememberOptions);
      searchForm?.addEventListener("change", rememberOptions);
      root.querySelectorAll('[name="extractionScope"]').forEach(element => element.addEventListener("change", () => {
        if (!(element instanceof HTMLSelectElement)) return;
        extractionScope = element.value === "platform" ? "platform" : "page";
        const itemId = element.closest("[data-discovery-approve]")?.getAttribute("data-discovery-approve");
        if (itemId) extractionScopes[itemId] = extractionScope;
        persistOptions();
      }));
      root.querySelector("[data-discovery-more]")?.addEventListener("click", () => { void loadMore(); });
      root.querySelectorAll("[data-discovery-approve]").forEach((element) =>
        element.addEventListener("submit", (event) => {
          event.preventDefault();
          if (!(event.currentTarget instanceof HTMLFormElement)) return;
          const itemId = event.currentTarget.getAttribute(
            "data-discovery-approve",
          );
          if (itemId !== null) {
            const scope = new FormData(event.currentTarget).get("extractionScope");
            void approve(itemId, scope === "platform" ? "platform" : "page");
          }
        })
      );
      root.querySelectorAll("[data-discovery-open-upload]").forEach((element) =>
        element.addEventListener("click", () => {
          const result = openUpload(element.getAttribute("data-discovery-open-upload"));
          if (!result.ok) { onError("Source unavailable. Select it again in Discover."); rerender(); }
        })
      );
    },
    search,
    loadMore,
    openUpload,
    approve,
  });

  function persistOptions() {
    saveOptions(policyStorage, optionsKey, {providerIds:selectedProviderIds,limit:searchLimit,extractionScope}, onError);
  }

  /**
   * Render one stable item projection. Central search results are intentionally
   * kept in memory until the user approves them, so they must remain the
   * source of truth while a result detail is open.
   *
   * @param {import("./discovery-runtime.js").DiscoveryRenderModel} projected
   * @param {{readonly selectedItemId:string|null,readonly online:boolean}} route
   * @param {import("../routes/discover.js").DiscoverRouteItem[]|null} liveItems
   */
  function renderItems(projected, route, liveItems) {
    const projectedModel = toDiscoverRouteModel(
      projected,
      escapeHtml,
    );
    const visibleItems = liveItems ?? [];
    const items = visibleItems.filter((item) =>
      !suppressed.has(item.candidate.canonicalIdentity)
    );
    routeItems.clear();
    for (const item of items) routeItems.set(item.id, item);
    return renderDiscoverRoute(
      freeze({
        ...projectedModel,
        page: route.selectedItemId !== null
          ? /** @type {const} */ ("detail")
          : /** @type {const} */ ("list"),
        items: freeze(items),
        maxVisibleItems: Math.max(projectedModel.maxVisibleItems, items.length),
        loadMore: {available: route.online && continuation !== null, pending: morePending, error: moreFailure},
        state: route.online
          ? searchFailure === null
            ? items.length === 0
              ? searchInitialized
                ? /** @type {const} */ ("empty")
                : /** @type {const} */ ("never-run")
              : /** @type {const} */ ("success")
            : items.length === 0
            ? /** @type {const} */ ("error")
            : /** @type {const} */ ("partial")
          : projectedModel.state,
        stateMessage: route.online
          ? searchFailure
          : projectedModel.stateMessage,
        selectedItemId: route.selectedItemId,
        pendingId: pendingDecisionItemId,
        extractionScopes,
        defaultExtractionScope: extractionScope,
        canAct: sourceActionsAvailable && route.online,
        search: searchModel(route.online),
        markup,
      }),
    );
  }

  /** @param {unknown} command */
  async function search(command) {
    const stagedCommand = validCentralSearchCommand(command) ? {...command,providerIds:[...command.providerIds]} : null;
    if (stagedCommand !== null) {
      saveOptions(policyStorage, optionsKey, {providerIds:stagedCommand.providerIds,limit:stagedCommand.limit,extractionScope}, onError);
    }
    const generation = ++searchGeneration;
    morePending = false;
    moreFailure = null;
    if (
      stagedCommand !== null && stagedCommand.providerIds.includes("youtube") &&
      !youtubeConnection.isAccepted()
    ) {
      searchInitialized = true;
      searchQuery = stagedCommand.query;
      selectedProviderIds = [...stagedCommand.providerIds];
      searchLimit = stagedCommand.limit;
      const failure = { kind: /** @type {const} */ ("YouTubePolicyAcceptanceRequired") };
      searchFailure = friendlyDiscoveryFailure(failure, markup);
      onError(searchFailure);
      rerender();
      return { ok: false, error: failure };
    }
    if (stagedCommand !== null && !searchInitialized) {
      searchInitialized = true;
      searchQuery = stagedCommand.query;
      selectedProviderIds = [...stagedCommand.providerIds];
      searchLimit = stagedCommand.limit;
    }
    searchPending = true;
    rerender();
    const result = await centralGateway.search(command);
    if (generation !== searchGeneration) {
      return {
        ok: false,
        error: { kind: /** @type {const} */ ("DiscoverySearchSuperseded") },
      };
    }
    searchPending = false;
    if (!result.ok) {
      searchFailure = friendlyDiscoveryFailure(result.error, markup);
      onError(searchFailure);
      rerender();
      return result;
    }
    searchQuery = result.value.submittedQuery;
    if (stagedCommand !== null) {
      selectedProviderIds = [...stagedCommand.providerIds];
      searchLimit = stagedCommand.limit;
    }
    centralRouteItems = result.value.items.map((item) =>
      centralRouteItem(item, result.value.policyVersion)
    );
    searchFailure = null;
    continuation = result.value.nextCursors === undefined ? null : {query:result.value.submittedQuery,limit:searchLimit,cursors:result.value.nextCursors};
    if (sourceActionsAvailable) {
      await syncIdentities(centralRouteItems.map((item) =>
        item.candidate.canonicalIdentity
      ), generation);
    }
    if (generation !== searchGeneration) {
      return {
        ok: false,
        error: { kind: /** @type {const} */ ("DiscoverySearchSuperseded") },
      };
    }
    rerender();
    return result;
  }

  async function loadMore() {
    if (searchPending || morePending || continuation === null) return;
    const generation = searchGeneration;
    const command = continuation;
    morePending = true;
    moreFailure = null;
    rerender();
    const result = await centralGateway.search({...command,providerIds:Object.keys(command.cursors)});
    if (generation !== searchGeneration) return;
    morePending = false;
    if (!result.ok) {
      moreFailure = friendlyDiscoveryFailure(result.error, markup);
      rerender();
      return result;
    }
    const items = centralRouteItems ?? [];
    const known = new Set(items.map(item => item.candidate.canonicalUrl));
    const added = result.value.items.filter(item => {
      if (known.has(item.canonicalUrl)) return false;
      known.add(item.canonicalUrl);
      return true;
    }).map(item => centralRouteItem(item, result.value.policyVersion));
    centralRouteItems = [...items, ...added];
    continuation = result.value.nextCursors === undefined || Object.keys(result.value.nextCursors).length === 0 ? null : {...command,cursors:result.value.nextCursors};
    if (sourceActionsAvailable) await syncIdentities(added.map(item => item.candidate.canonicalIdentity), generation);
    if (generation === searchGeneration) rerender();
    return result;
  }

  /** @param {string} itemId @param {"page"|"platform"} [extractionScope] */
  async function approve(itemId, extractionScope = extractionScopes[itemId] ?? "page") {
    if (pendingDecisionItemId !== null) return;
    const item = routeItems.get(itemId);
    if (item === undefined) { onError(markup.sourceUnavailable); return; }
    if (["video", "feed", "episode", "unknown"].includes(item.candidate.adapter.granularity)) {
      onError(markup.failureMessages.SourceFormatUnsupported ?? markup.sourceUnavailable);
      return;
    }
    extractionScopes[item.id] = extractionScope;
    pendingDecisionItemId = item.id;
    rerender();
    const result = await sourceLibrary.extract({
      ...item.candidate,
      extractionScope,
      identityStatus: "resolved",
      interestAreaIds: [],
      idempotencyKey: `approve:${createId()}`,
    });
    pendingDecisionItemId = null;
    if (!result.ok) {
      const message = friendlySource(result.error, markup);
      if (result.error.kind === "SourceGatewayRejected" && dependencies.confirmUpload) {
        if (dependencies.confirmUpload(`${message}\n\n${markup.manualUploadGuidance}`, item.candidate.canonicalUrl)) openUpload(item.id);
      } else onError(message);
    } else {
      onNotice(
        result.value.reused
          ? markup.sourceAlreadyAdded
          : markup.sourceAdded,
      );
      navigateToLibrary(result.value.source.id);
    }
    rerender();
  }

  /** @param {string|null} itemId @returns {Result<undefined,{readonly kind:"DiscoveryUploadSourceUnavailable"}>} */
  function openUpload(itemId) {
    const item = typeof itemId === "string" ? routeItems.get(itemId) : undefined;
    if (item === undefined) return { ok: false, error: { kind: "DiscoveryUploadSourceUnavailable" } };
    dependencies.navigateToUpload({
      title: item.title,
      ...(item.youtubeWatchUrl===null ? {url:item.candidate.canonicalUrl} : {}),
      reason: item.youtubeWatchUrl !== null
        ? markup.youtubeTranscriptGuidance
        : markup.manualUploadGuidance,
    });
    return { ok: true, value: undefined };
  }

  async function syncSuppressions() {
    const projected = runtime.renderModel({
      name: "discover",
      cursor: null,
      selectedItemId: null,
      online: true,
    });
    if (!projected.ok) return;
    const identities = [
      ...new Set(
        toDiscoverRouteModel(projected.value, escapeHtml).items
          .map((item) => item.candidate.canonicalIdentity),
      ),
    ];
    await syncIdentities(identities);
  }

  /** @param {readonly string[]} identities @param {number|null} [generation] */
  async function syncIdentities(identities, generation = null) {
    if (identities.length === 0) return;
    const checked = await sourceLibrary.suppressed(identities);
    if (generation !== null && generation !== searchGeneration) return;
    if (!checked.ok) {
      sourceActionsAvailable = false;
      return;
    }
    for (const identity of checked.value) suppressed.add(identity);
  }

  /** @param {boolean} online */
  function searchModel(online) {
    return freeze({
      query: searchQuery,
      limit: searchLimit,
      capabilities: freeze([...searchCapabilities]),
      selectedProviderIds: freeze([...selectedProviderIds]),
      available: online && searchCapabilities.some((provider) => provider.enabled),
    });
  }

  /** @param {import("../features/discovery/gateway.js").GatewayCentralCandidate} item @param {string} policyVersion */
  function centralRouteItem(item, policyVersion) {
    const observedAt = now();
    const providerId = item.providerId;
    const canonicalUrl = item.canonicalUrl;
    const provider = searchCapabilities.find((entry) => entry.id === providerId);
    const youtube = item.sourceLevel === "video";
    const feed = item.sourceLevel === "feed";
    const id = createId();
    const retainedTitle = item.title;
    const retainedDescription = item.description ?? "";
    return freeze({
      id,
      version: 1,
      title: item.title,
      sourceLabel: item.publisherLabel ?? provider?.label ?? item.resultKind,
      observedAtLabel: observedAt,
      rightsLabel: "Not assessed",
      provenanceLabel: canonicalUrl,
      sourceUrl: (feed ? item.identityEvidence.find(evidence=>evidence.attribute==="taddy-publisher-website")?.value : canonicalUrl)??"",
      evidenceStatus: /** @type {const} */ ("link-only"),
      youtubeWatchUrl: youtube ? item.canonicalUrl : null,
      podcastReferenceLabel: null,
      candidate: freeze({
        submittedUrl: canonicalUrl,
        canonicalUrl,
        canonicalIdentity: canonicalUrl,
        title: retainedTitle,
        description: retainedDescription,
        adapter: freeze({
          id: `central-search:${providerId}`,
          version: policyVersion,
          granularity: item.sourceLevel,
          capabilities: freeze(youtube ? ["metadata", "manual-transcript"] : feed ? ["metadata"] : ["metadata", "bounded-ingestion"]),
        }),
        identityEvidence: freeze(item.identityEvidence.filter((evidence) => !youtube || ["youtube-api-video-id", "youtube-channel-id"].includes(evidence.attribute)).map((evidence) => freeze({ ...evidence, observedAt }))),
        initialItem: youtube ? freeze({
          itemId: id,
          versionId: policyVersion,
          canonicalUrl,
          title: retainedTitle,
          description: retainedDescription,
          contentDigest: `provider-metadata:${policyVersion}:${canonicalUrl}`,
          provenance: freeze([{ method: "provider-metadata", reference: canonicalUrl }]),
          observedAt,
          publishedAt: null,
        }) : null,
      }),
    });
  }
}


/** @param {(value:string)=>string} escapeHtml @param {import("../routes/discover.js").DiscoverMarkup} markup */
function emptyRoute(escapeHtml, markup) {
  return {
    state: /** @type {const} */ ("loading"),
    stateMessage: null,
    page: /** @type {const} */ ("list"),
    items: freeze([]),
    selectedItemId: null,
    maxVisibleItems: 20,
    pendingId: null,
    canAct: false,
    search: freeze({ query: "", limit: 10, capabilities: freeze([]), selectedProviderIds: freeze([]), available: false }),
    markup,
    escapeHtml,
  };
}

/** @param {import("../features/source-library/gateway.js").SourceGatewayFailure} failure @param {import("../routes/discover.js").DiscoverMarkup} failureCopy */
function friendlySource(failure, failureCopy) {
  return failureCopy.failureMessages[failure.kind === "SourceGatewayRejected" ? failure.failureKind : failure.kind] ?? failureCopy.sourceDecisionFailed;
}

/** @param {(value:string)=>string} escapeHtml @param {import("../routes/discover.js").DiscoverMarkup} markup */
function loading(escapeHtml, markup) {
  return renderDiscoverRoute(emptyRoute(escapeHtml, markup));
}

/** @param {unknown} inventory @param {string} sessionSeed */
function withSessionSeed(inventory, sessionSeed) {
  return inventory !== null && typeof inventory === "object" &&
      !Array.isArray(inventory)
    ? freeze({ ...inventory, sessionSeed })
    : inventory;
}
