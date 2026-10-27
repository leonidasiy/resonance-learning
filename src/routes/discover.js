// @ts-check

/** @typedef {"never-run" | "loading" | "partial" | "error" | "offline" | "empty" | "success"} DiscoverRouteState */
/** @typedef {"link-only" | "learner-notes" | "publisher-transcript" | "user-original"} DiscoverEvidenceStatus */
/** @typedef {{readonly exploreUnavailable:string,readonly exploreLink:string,readonly provider:string,readonly podcast:string,readonly extractionUnavailable:string,readonly decisionUnavailable:string,readonly offlineNotice:string,readonly stateNotice:string,readonly youtubeNotice:string,readonly workspace:string,readonly neverRunState:string,readonly loadingState:string,readonly emptyState:string,readonly errorState:string,readonly offlineState:string,readonly partialState:string,readonly route:string,readonly controls:string,readonly missingDetail:string,readonly selectDetail:string,readonly evidenceBoundary:string,readonly statePanel:string,readonly results:string,readonly resultRow:string,readonly youtubeConnected:string,readonly youtubeDisconnected:string,readonly youtubeUnavailable:string,readonly failureMessages:Readonly<Record<string,string>>,readonly youtubeSource:import("../startup/discovery-runtime.js").YouTubeSourceContract,readonly sourceUnavailable:string,readonly sourceLink:string,readonly detail:string,readonly youtubePolicy:string,readonly youtubeActions:string,readonly youtubeTranscriptGuidance:string,readonly manualUploadGuidance:string,readonly manualUpload:string,readonly decisionActions:string,readonly extractionScope:string,readonly sourceAreaRequired:string,readonly sourceAlreadyAdded:string,readonly sourceAdded:string,readonly uploadRequired:string,readonly uploadReadFailed:string,readonly uploadStoreFailed:string,readonly uploadStored:string,readonly sourceRejected:string,readonly enterDiscoveryValue:string,readonly sourceReconnect:string,readonly sourceSignIn:string,readonly sourceAreaMissing:string,readonly sourceDecisionFailed:string}} DiscoverMarkup */

/**
 * @typedef {{
 *   readonly id: string,
 *   readonly version: number,
 *   readonly title: string,
 *   readonly sourceLabel: string,
 *   readonly observedAtLabel: string,
 *   readonly rightsLabel: string,
 *   readonly provenanceLabel: string,
 *   readonly sourceUrl: string,
 *   readonly evidenceStatus: DiscoverEvidenceStatus,
 *   readonly youtubeWatchUrl: string | null,
 *   readonly podcastReferenceLabel: string | null,
 *   readonly candidate: {
 *     readonly submittedUrl: string,
 *     readonly canonicalUrl: string,
 *     readonly canonicalIdentity: string,
 *     readonly title: string,
 *     readonly description: string,
 *     readonly adapter: { readonly id: string, readonly version: string, readonly granularity: string, readonly capabilities: readonly string[] },
 *     readonly identityEvidence: readonly { readonly attribute: string, readonly value: string, readonly provenanceUrl: string, readonly observedAt: string }[],
 *     readonly initialItem: null | { readonly itemId: string, readonly versionId: string, readonly canonicalUrl: string, readonly title: string, readonly description: string, readonly contentDigest: string, readonly provenance: readonly { readonly method: string, readonly reference: string }[], readonly observedAt: string, readonly publishedAt: string | null }
 *   }
 * }} DiscoverRouteItem
 */

/**
 * @typedef {{
 *   readonly state: DiscoverRouteState,
 *   readonly stateMessage: string | null,
 *   readonly page: "list" | "detail",
 *   readonly items: readonly DiscoverRouteItem[],
 *   readonly selectedItemId: string | null,
 *   readonly maxVisibleItems: number,
 *   readonly defaultExtractionScope?: "page"|"platform",
 *   readonly extractionScopes?: Readonly<Record<string,"page"|"platform">>,
 *   readonly pendingId: string | null,
 *   readonly canAct: boolean,
 *   readonly search: { readonly query:string, readonly limit:number, readonly capabilities:readonly {readonly id:string,readonly label:string,readonly resultKind:string,readonly priority:number,readonly enabled:boolean}[], readonly selectedProviderIds:readonly string[], readonly available:boolean },
 *   readonly loadMore?: {readonly available:boolean,readonly pending:boolean,readonly error:string|null},
 *   readonly markup: DiscoverMarkup,
 *   readonly escapeHtml: (value: string) => string
 * }} DiscoverRouteModel
 */

const ROUTE_STATES = new Set([
  "never-run",
  "loading",
  "partial",
  "error",
  "offline",
  "empty",
  "success",
]);

const EVIDENCE_LABELS = Object.freeze({
  "link-only": "Link only",
  "learner-notes": "Your notes",
  "publisher-transcript": "Publisher transcript",
  "user-original": "Your original",
});

const YOUTUBE_WATCH_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
]);
/**
 * Render the bounded, evidence-only discovery inbox.
 *
 * @param {DiscoverRouteModel} model
 * @returns {string}
 */
export function renderDiscoverRoute(model) {
  validateModel(model);
  const selected = model.selectedItemId === null
    ? null
    : model.items.find((item) => item.id === model.selectedItemId) ?? null;
  const selectedMissing = model.selectedItemId !== null && selected === null;

  const content = model.items.length === 0
    ? renderEmptyState(model)
    : template(model,"workspace",{results:renderResults(model),detail:renderDetail(model,selected,selectedMissing)});
  return template(model, "route", {
    state: model.state,
    page: model.page,
    body: renderDiscoveryControls(model) + renderStateNotice(model) + content,
  });
}

/** @param {DiscoverRouteModel} model */
function renderDiscoveryControls(model) {
  if (model.state === "loading") return "";
  const disabled = !model.search.available
    ? ' disabled aria-describedby="discover-offline-message"'
    : "";
  const providers = model.search.capabilities.map((provider) => {
    const checked = model.search.selectedProviderIds.includes(provider.id)
      ? " checked"
      : "";
    const unavailable = provider.enabled ? "" : " disabled";
    return template(model,"provider",{id:remoteText(model,provider.id),checked,unavailable,label:remoteText(model,provider.label)});
  }).join("");
  const limits = [5, 10, 20].map((limit) =>
    `<option value="${limit}"${model.search.limit === limit ? " selected" : ""}>${limit}</option>`
  ).join("");
  const controls = template(model, "controls", {
    disabled,
    query: remoteText(model, model.search.query),
    providerFilters: providers,
    limitOptions: limits,
  });
  return controls;
}

/** @param {DiscoverRouteModel} model */
function renderStateNotice(model) {
  const message = model.stateMessage === null
    ? ""
    : remoteText(model, model.stateMessage);
  if (model.state === "offline") return template(model,"offlineNotice",{message});
  const partial=model.state === "partial";
  return partial || model.state === "error" ? template(model,"stateNotice",{message,error:partial?"":" error",role:partial?"status":"alert"}) : "";
}

/** @param {DiscoverRouteModel} model */
function renderEmptyState(model) {
  if(model.state === "success")throw new TypeError("DiscoverItemMissing");
  const state=model.state === "never-run" ? "neverRun" : model.state;
  return template(model,/** @type {keyof DiscoverMarkup} */(`${state}State`),{});
}

/** @param {DiscoverRouteModel} model */
function renderResults(model) {
  const rows = model.items.map((item) => {
    const selected = item.id === model.selectedItemId;
    const url = item.youtubeWatchUrl === null
      ? validatedSourceUrl(item.sourceUrl)
      : validatedYouTubeWatchUrl(item.sourceUrl);
    const exploreAction=model.state === "offline" || url === null ? model.markup.exploreUnavailable : template(model,"exploreLink",{url:remoteText(model,url),title:remoteText(model,item.title)});
    return template(model, "resultRow", {
      exploreAction,
      urlId: remoteText(model, encodeURIComponent(item.id)),
      itemId: remoteText(model, item.id),
      selected: selected ? 'aria-current="true"' : "",
      source: remoteText(model, item.sourceLabel),
      title: remoteText(model, item.title),
      description: remoteText(model, item.candidate.description),
      observed: remoteText(model, item.observedAtLabel),
      evidence: evidenceLabel(item.evidenceStatus),
    });
  }).join("");
  const more = model.loadMore;
  const footer = more?.available ? `<div class="discover-actions"><button class="button secondary" type="button" data-discovery-more data-focus-key="discovery-more" ${more.pending ? 'aria-disabled="true" aria-busy="true"' : ""}>${more.pending ? "Loading…" : "Load more"}</button>${more.error === null ? "" : `<p role="alert">${remoteText(model,more.error)}</p>`}</div>` : "";
  return template(model, "results", {
    count: String(model.items.length),
    rows,
    more: footer,
  });
}

/**
 * @param {DiscoverRouteModel} model
 * @param {DiscoverRouteItem | null} selected
 * @param {boolean} selectedMissing
 */
function renderDetail(model, selected, selectedMissing) {
  if (selectedMissing) {
    return model.markup.missingDetail;
  }
  if (selected === null) {
    return model.markup.selectDetail;
  }

  const watchUrl = validatedYouTubeWatchUrl(selected.youtubeWatchUrl);
  const youtube = selected.youtubeWatchUrl !== null;
  const offline = model.state === "offline";
  const title = remoteText(model, selected.title);
  return template(model, "detail", {
    itemId: remoteText(model, selected.id),
    title,
    sourceLabel: remoteText(model, selected.sourceLabel),
    observed: remoteText(model, selected.observedAtLabel),
    rights: remoteText(model, selected.rightsLabel),
    provenance: remoteText(model, selected.provenanceLabel),
    evidence: evidenceLabel(selected.evidenceStatus),
    podcast: selected.podcastReferenceLabel === null
      ? ""
      : template(model,"podcast",{reference:remoteText(model,selected.podcastReferenceLabel)}),
    boundary: model.markup.evidenceBoundary,
    sourceAction: renderSourceAction(
      model,
      title,
      youtube ? watchUrl : validatedSourceUrl(selected.sourceUrl),
      youtube,
      offline,
    ) + renderDecisionActions(model, selected, offline),
  });
}

/** @param {DiscoverRouteModel} model @param {DiscoverRouteItem} item @param {boolean} offline */
function renderDecisionActions(model, item, offline) {
  const pending = model.pendingId === item.id;
  const unsupported = item.youtubeWatchUrl !== null || ["video", "feed", "episode", "unknown"].includes(item.candidate.adapter.granularity);
  const unavailable = offline || !model.canAct || pending;
  const manualUpload = template(model, "manualUpload", {
    itemId: remoteText(model, item.id),
    submitDisabled: pending ? "disabled" : "",
    label: item.youtubeWatchUrl !== null ? "Upload video transcript" : "Provide permitted learning material",
  });
  if (item.youtubeWatchUrl !== null) return model.markup.youtubePolicy + manualUpload;
  return template(model, "decisionActions", {
    itemId: remoteText(model, item.id),
    sourceGranularity: remoteText(model, item.candidate.adapter.granularity),
    sourceCapabilities: remoteText(model, item.candidate.adapter.capabilities.join(",")),
    submitDisabled: unsupported || unavailable ? "disabled" : "",
    submitLabel: pending ? "Starting…" : "Extract Knowledge Points",
    extractionScope: unsupported ? "" : template(model, "extractionScope", {
      scopeDisabled: unavailable ? "disabled" : "",
      pageSelected: (model.extractionScopes?.[item.id] ?? model.defaultExtractionScope) !== "platform" ? "selected" : "",
      platformSelected: (model.extractionScopes?.[item.id] ?? model.defaultExtractionScope) === "platform" ? "selected" : "",
    }),
    unavailable: unsupported
      ? model.markup.extractionUnavailable
      : model.canAct
      ? ""
      : model.markup.decisionUnavailable,
  }) + manualUpload;
}

/**
 * @param {DiscoverRouteModel} model
 * @param {string} title
 * @param {string | null} sourceUrl
 * @param {boolean} youtube
 * @param {boolean} offline
 */
function renderSourceAction(model, title, sourceUrl, youtube, offline) {
  if (offline || sourceUrl === null) {
    return template(model, "sourceUnavailable", {
      description: offline ? 'aria-describedby="discover-offline-message"' : "",
      label: youtube ? "Watch" : "Source",
    });
  }
  const action = youtube ? "Watch on YouTube" : "Open source";
  return template(model, "sourceLink", {
    url: remoteText(model, sourceUrl),
    action,
    title,
  });
}

/** @param {DiscoverEvidenceStatus} status */
function evidenceLabel(status) {
  return EVIDENCE_LABELS[status];
}

/** @param {string | null} value */
function validatedYouTubeWatchUrl(value) {
  if (value === null || !URL.canParse(value)) return null;
  const parsed = new URL(value);
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" || parsed.password !== "" ||
    !YOUTUBE_WATCH_HOSTS.has(parsed.hostname.toLowerCase())
  ) return null;
  return parsed.href;
}

/** @param {string} value */
function validatedSourceUrl(value) {
  if (!URL.canParse(value)) return null;
  const parsed = new URL(value);
  return parsed.protocol === "https:" && parsed.username === "" &&
      parsed.password === "" && parsed.hash === ""
    ? parsed.href
    : null;
}

/** @param {DiscoverRouteModel} model @param {string} value */
function remoteText(model, value) {
  const escaped = model.escapeHtml(value);
  if (typeof escaped !== "string") {
    throw new TypeError("DiscoverEscapeInvalid");
  }
  return escaped;
}

/** @param {DiscoverRouteModel} model */
function validateModel(model) {
  if (
    model === null || typeof model !== "object" ||
    typeof model.escapeHtml !== "function" ||
    !ROUTE_STATES.has(model.state) ||
    (model.page !== "list" && model.page !== "detail") ||
    !Array.isArray(model.items) ||
    typeof model.canAct !== "boolean" ||
    !validSearch(model.search) ||
    (model.pendingId !== null && typeof model.pendingId !== "string") ||
    !Number.isInteger(model.maxVisibleItems) ||
    model.maxVisibleItems < 1 ||
    model.items.length > model.maxVisibleItems ||
    !validMarkup(model.markup) ||
    (model.selectedItemId !== null &&
      (typeof model.selectedItemId !== "string" ||
        model.selectedItemId.trim() === "")) ||
    (model.page === "detail" && model.selectedItemId === null)
  ) {
    throw new TypeError("DiscoverModelInvalid");
  }
  const messageState = model.state === "partial" || model.state === "error" ||
    model.state === "offline";
  if (
    messageState &&
    (typeof model.stateMessage !== "string" ||
      model.stateMessage.trim() === "")
  ) {
    throw new TypeError("DiscoverMessageMissing");
  }
  if (!messageState && model.stateMessage !== null) {
    throw new TypeError("DiscoverMessageForbidden");
  }
  if (
    (model.state === "never-run" || model.state === "loading" ||
      model.state === "empty") && model.items.length !== 0
  ) {
    throw new TypeError("DiscoverUnexpectedResults");
  }
  if (model.state === "success" && model.items.length === 0) {
    throw new TypeError("DiscoverResultsMissing");
  }

  const ids = new Set();
  for (const item of model.items) {
    if (!isRouteItem(item) || ids.has(item.id)) {
      throw new TypeError("DiscoverItemInvalid");
    }
    ids.add(item.id);
  }
}

/** @param {unknown} value */
function validSearch(value) {
  if (
    value === null || typeof value !== "object" || Array.isArray(value) ||
    typeof /** @type {Record<string,unknown>} */ (value).query !== "string" ||
    ![5, 10, 20].includes(/** @type {number} */ (/** @type {Record<string,unknown>} */ (value).limit)) ||
    typeof /** @type {Record<string,unknown>} */ (value).available !== "boolean" ||
    !Array.isArray(/** @type {Record<string,unknown>} */ (value).capabilities) ||
    !Array.isArray(/** @type {Record<string,unknown>} */ (value).selectedProviderIds)
  ) return false;
  const search = /** @type {DiscoverRouteModel["search"]} */ (value);
  const ids = new Set();
  for (const capability of search.capabilities) {
    if (
      capability === null || typeof capability !== "object" ||
      typeof capability.id !== "string" || capability.id.trim() === "" ||
      typeof capability.label !== "string" || capability.label.trim() === "" ||
      typeof capability.resultKind !== "string" || capability.resultKind.trim() === "" ||
      !Number.isInteger(capability.priority) || capability.priority < 1 ||
      typeof capability.enabled !== "boolean" || ids.has(capability.id)
    ) return false;
    ids.add(capability.id);
  }
  return search.selectedProviderIds.every((id) => typeof id === "string" && ids.has(id)) &&
    new Set(search.selectedProviderIds).size === search.selectedProviderIds.length;
}

/** @param {unknown} value @returns {value is DiscoverMarkup} */
function validMarkup(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const markup = /** @type {Record<string, unknown>} */ (value);
  const messages = markup.failureMessages;
  const failureMessages = messages !== null && typeof messages === "object" &&
      !Array.isArray(messages)
    ? /** @type {Record<string, unknown>} */ (messages)
    : null;
  return Object.entries(markup).every(([key, entry]) =>
    key === "failureMessages" || key === "youtubeSource" ||
    (typeof entry === "string" && entry.length > 0)
  ) && failureMessages !== null &&
    Object.entries(failureMessages).every(([key, entry]) =>
      key.trim() !== "" && typeof entry === "string" && entry.length > 0
    ) && typeof failureMessages.default === "string" &&
    failureMessages.default.length > 0;
}

/** @param {DiscoverRouteModel} model @param {keyof DiscoverMarkup} name @param {Readonly<Record<string,string>>} values */
function template(model, name, values) {
  let result = model.markup[name];
  if (typeof result !== "string" || result.length === 0) {
    throw new TypeError("DiscoverMarkupInvalid");
  }
  for (const [key, value] of Object.entries(values)) {
    result = result.replaceAll(`{{${key}}}`, value);
  }
  return result;
}

/** @param {unknown} value @returns {value is DiscoverRouteItem} */
function isRouteItem(value) {
  if (value === null || typeof value !== "object") return false;
  const item = /** @type {Record<string, unknown>} */ (value);
  return typeof item.id === "string" && item.id.trim() !== "" &&
    Number.isInteger(item.version) && Number(item.version) > 0 &&
    typeof item.title === "string" && item.title.trim() !== "" &&
    typeof item.sourceLabel === "string" &&
    typeof item.observedAtLabel === "string" &&
    typeof item.rightsLabel === "string" &&
    typeof item.provenanceLabel === "string" &&
    typeof item.sourceUrl === "string" &&
    typeof item.evidenceStatus === "string" &&
    Object.hasOwn(EVIDENCE_LABELS, item.evidenceStatus) &&
    (item.youtubeWatchUrl === null ||
      typeof item.youtubeWatchUrl === "string") &&
    item.candidate !== null &&
    typeof item.candidate === "object" &&
    !Array.isArray(item.candidate) &&
    (item.podcastReferenceLabel === null ||
      typeof item.podcastReferenceLabel === "string");
}
