// @ts-check

/** @template T @template E @typedef {{readonly ok:true,readonly value:T,readonly nextCursor?:string}|{readonly ok:false,readonly error:E}} Result */
/** @typedef {{readonly id:string,readonly label:string,readonly resultKind:string,readonly priority:number,readonly enabled:boolean}} SearchProviderDescriptor */
/** @typedef {{readonly kind:"SearchProviderInputInvalid"}|{readonly kind:"SearchProviderTimedOut"}|{readonly kind:"SearchProviderCredentialMissing"}|{readonly kind:"SearchProviderCredentialRejected"}|{readonly kind:"SearchProviderQuotaExceeded"}|{readonly kind:"SearchProviderUnavailable"}|{readonly kind:"SearchProviderResponseInvalid"}} SearchProviderFailure */
/** @typedef {{readonly providerId:string,readonly query:string,readonly limit:number,readonly cursor?:string}} SearchProviderCommand */
/** @typedef {{readonly providerId:string,readonly resultKind:string,readonly sourceLevel:"document",readonly title:string,readonly description:string|null,readonly canonicalUrl:string,readonly publisherLabel:null,readonly publishedAt:null,readonly identityEvidence:readonly {readonly attribute:string,readonly value:string,readonly provenanceUrl:string}[]}} BraveCandidate */
/** @typedef {{readonly providerId:string,readonly label:string,readonly resultKind:string,readonly priority:number,readonly enabled:boolean,readonly maximumResults:number,readonly apiVersion:string}} BraveSearchConfiguration */

/**
 * @param {BraveSearchConfiguration} configuration
 * @param {{readonly credential:()=>Result<string,SearchProviderFailure>,readonly fetch:typeof fetch}} dependencies
 */
export function createBraveSearchProvider(configuration, dependencies) {
  if (!configurationValid(configuration) || typeof dependencies?.credential !== "function" || typeof dependencies.fetch !== "function") {
    throw new TypeError("Invalid Brave search provider dependencies.");
  }
  const descriptor = Object.freeze({
    id: configuration.providerId,
    label: configuration.label,
    resultKind: configuration.resultKind,
    priority: configuration.priority,
    enabled: configuration.enabled,
  });
  return Object.freeze({
    descriptor,
    /** @param {SearchProviderCommand} command @param {import("./discovery-search.js").SearchExecution} [execution] @returns {Promise<Result<readonly BraveCandidate[],SearchProviderFailure>>} */
    async search(command, execution) {
      if (execution !== undefined && (!(execution.signal instanceof AbortSignal) || typeof execution.remainingMs !== "function")) throw new TypeError("Invalid Brave execution budget.");
      if (!commandValid(command, descriptor.id)) {
        throw new TypeError("Invalid Brave search command.");
      }
      const parts = command.cursor?.split(":");
      const page = parts === undefined ? 0 : Number(parts[0]);
      const count = parts === undefined ? Math.min(command.limit, configuration.maximumResults) : Number(parts[1]);
      if (parts !== undefined && parts.length !== 2 || !Number.isInteger(page) || page < 0 || page > 9 || !Number.isInteger(count) || count < 1 || count > Math.min(command.limit,configuration.maximumResults)) return {ok:false,error:{kind:"SearchProviderInputInvalid"}};
      const credential = dependencies.credential();
      if (!credential.ok) return credential;
      if (credential.value.trim() === "") {
        return { ok: false, error: { kind: "SearchProviderCredentialRejected" } };
      }
      const url = new URL("https://api.search.brave.com/res/v1/web/search");
      url.search = new URLSearchParams({
        q: command.query,
        count: String(count),
        safesearch: "strict",
        text_decorations: "false",
        result_filter: "web",
      }).toString();
      if (command.cursor !== undefined) url.searchParams.set("offset", String(page));
      const response = await request(dependencies.fetch, url, {
        accept: "application/json",
        "api-version": configuration.apiVersion,
        "x-subscription-token": credential.value,
      }, execution?.signal);
      if (!response.ok) return response;
      const document = await readDocument(response.value);
      if (!document.ok) return document;
      const parsed = parseDocument(document.value, descriptor);
      const query = record(document.value) && record(document.value.query) ? document.value.query : null;
      if (query?.more_results_available !== undefined && typeof query.more_results_available !== "boolean") return {ok:false,error:{kind:"SearchProviderResponseInvalid"}};
      return parsed.ok && query?.more_results_available === true && page < 9 ? {...parsed, nextCursor:`${page + 1}:${count}`} : parsed;
    },
  });
}

/** @param {typeof fetch} fetchDependency @param {URL} url @param {HeadersInit} headers @param {AbortSignal} [signal] @returns {Promise<Result<Response,SearchProviderFailure>>} */
async function request(fetchDependency, url, headers, signal) {
  /** @type {Response} */ let response;
  try {
    response = await fetchDependency(url, { headers, signal });
  } catch (error) {
    if (signal?.aborted) return {ok:false,error:{kind:"SearchProviderTimedOut"}};
    if (error instanceof Error) {
      return { ok: false, error: { kind: "SearchProviderUnavailable" } };
    }
    throw error;
  }
  if (response.status === 401 || response.status === 403) {
    return { ok: false, error: { kind: "SearchProviderCredentialRejected" } };
  }
  if (response.status === 429) {
    return { ok: false, error: { kind: "SearchProviderQuotaExceeded" } };
  }
  if (!response.ok) {
    return { ok: false, error: { kind: "SearchProviderUnavailable" } };
  }
  return { ok: true, value: response };
}

/** @param {Response} response @returns {Promise<Result<unknown,SearchProviderFailure>>} */
async function readDocument(response) {
  try {
    return { ok: true, value: /** @type {unknown} */ (await response.json()) };
  } catch (error) {
    if (error instanceof SyntaxError) {
      return { ok: false, error: { kind: "SearchProviderResponseInvalid" } };
    }
    throw error;
  }
}

/** @param {unknown} value @param {SearchProviderDescriptor} descriptor @returns {Result<readonly BraveCandidate[],SearchProviderFailure>} */
function parseDocument(value, descriptor) {
  if (!record(value) || !record(value.web) || !Array.isArray(value.web.results) || value.web.results.length > 100) {
    return { ok: false, error: { kind: "SearchProviderResponseInvalid" } };
  }
  /** @type {BraveCandidate[]} */ const candidates = [];
  for (const item of value.web.results) {
    if (!record(item) || !text(item.title) || !text(item.url) || !URL.canParse(item.url) || (item.description !== undefined && typeof item.description !== "string") || (item.author !== undefined && typeof item.author !== "string")) {
      return { ok: false, error: { kind: "SearchProviderResponseInvalid" } };
    }
    const resultUrl = new URL(item.url);
    if (resultUrl.protocol !== "https:" || resultUrl.username !== "" || resultUrl.password !== "" || resultUrl.hash !== "") continue;
    // YouTube sources belong to the separately selected YouTube provider.
    const host = resultUrl.hostname.replace(/\.$/, "");
    if (["youtube.com", "youtu.be", "youtube-nocookie.com"].some(domain => host === domain || host.endsWith(`.${domain}`))) continue;
    const canonicalUrl = item.url;
    candidates.push(Object.freeze({
      providerId: descriptor.id,
      resultKind: descriptor.resultKind,
      sourceLevel: "document",
      title: item.title.trim(),
      description: typeof item.description === "string" ? item.description.trim() || null : null,
      canonicalUrl,
      publisherLabel: null,
      publishedAt: null,
      identityEvidence: Object.freeze([Object.freeze({
        attribute: "provider-result-page",
        value: item.url,
        provenanceUrl: item.url,
      }),
        ...(typeof item.description === "string" && item.description.trim() !== "" ? [Object.freeze({attribute:"provider-result-description",value:item.description,provenanceUrl:item.url})] : []),
        ...(typeof item.author === "string" && item.author.trim() !== "" ? [Object.freeze({attribute:"provider-result-author",value:item.author,provenanceUrl:item.url})] : []),
      ]),
    }));
  }
  return { ok: true, value: Object.freeze(candidates) };
}

/** @param {unknown} value @returns {value is BraveSearchConfiguration} */
function configurationValid(value) {
  return record(value) && Object.keys(value).length === 7 &&
    [value.providerId, value.label, value.resultKind, value.apiVersion].every(text) &&
    positive(value.priority) && typeof value.enabled === "boolean" &&
    positive(value.maximumResults) && value.maximumResults <= 20;
}

/** @param {unknown} value @param {string} providerId */
function commandValid(value, providerId) {
  return record(value) && Object.keys(value).every(key => ["providerId","query","limit","cursor"].includes(key)) && (value.cursor === undefined || text(value.cursor)) && value.providerId === providerId &&
    text(value.query) && positive(value.limit);
}

/** @param {unknown} value @returns {value is Record<string,unknown>} */
function record(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }
/** @param {unknown} value @returns {value is string} */
function text(value) { return typeof value === "string" && value.trim() !== ""; }
/** @param {unknown} value @returns {value is number} */
function positive(value) { return typeof value === "number" && Number.isInteger(value) && value > 0; }
