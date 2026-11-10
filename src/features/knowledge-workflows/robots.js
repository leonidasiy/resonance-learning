// @ts-check

/** @template T, E @typedef {{ readonly ok: true, readonly value: T } | { readonly ok: false, readonly error: E }} Result */
/** @typedef {import("./rights.js").RightsDecision} RightsDecision */

/**
 * @typedef {{
 *   readonly status: "allowed" | "denied",
 *   readonly robotsUrl: string,
 *   readonly targetUrl: string,
 *   readonly httpStatus: number,
 *   readonly availability: "present" | "absent" | "unavailable",
 *   readonly content: string,
 *   readonly checkedAt: string,
 *   readonly matchedRule: string | null
 * }} RobotsDecision
 */

/** @typedef {Omit<RobotsDecision, "status">} RobotsEvidenceSnapshot */

/** @typedef {{ readonly kind: "RobotsCommandInvalid", readonly field: string } | { readonly kind: "RobotsCheckBeforeRightsForbidden" } | { readonly kind: "UnsafeDestination" } | { readonly kind: "RobotsNetworkRejected" } | { readonly kind: "RobotsFetchUnavailable", readonly causeKind?: string, readonly diagnosticToken?: string } | { readonly kind: "RobotsTargetUnavailable", readonly causeKind: string, readonly diagnosticToken?: string } | { readonly kind: "RobotsMalformed" } | { readonly kind: "RobotsPayloadTooLarge" } | { readonly kind: "RobotsDenied", readonly rule: string }} RobotsFailure */
/** @typedef {{ readonly fetch: typeof fetch, readonly fetchRobots?: (command: { readonly robotsUrl: string, readonly sourceUrl: string }) => Promise<Result<{ readonly status: number, readonly bytes: Uint8Array }, { readonly kind: string, readonly diagnosticToken?: string }>>, readonly cachedEvidence?: RobotsEvidenceSnapshot | null, readonly verifyTargetReachable?: (command: { readonly robotsUrl: string, readonly sourceUrl: string, readonly targetUrl: string }) => Promise<Result<null, { readonly kind: string, readonly diagnosticToken?: string }>>, readonly robotsUnavailablePolicy?: "fail-closed" | "allow-403-if-target-reachable" | "allow-unverified-if-public", readonly resolveAddresses: (hostname: string) => Promise<Result<readonly string[], { readonly kind: string }>>, readonly now: () => string, readonly maximumBytes?: number, readonly timeoutMs?: number, readonly logger: (entry: { readonly event: string, readonly failureKind?: string, readonly diagnosticToken?: string }) => void }} RobotsDependencies */

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function record(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }
/** @param {unknown} value @returns {value is string} */
function text(value) { return typeof value === "string" && value.trim() !== ""; }
/** @param {unknown} value @returns {value is number} */
function positiveInteger(value) { return typeof value === "number" && Number.isSafeInteger(value) && value > 0; }
/** @param {unknown} value @returns {boolean} */
function timestamp(value) { return text(value) && Number.isFinite(Date.parse(value)); }

/** @param {unknown} value @param {number} maximumBytes @returns {value is RobotsEvidenceSnapshot | null | undefined} */
function validCachedEvidence(value, maximumBytes) {
  if (value === undefined || value === null) return true;
  if (!record(value)) return false;
  const candidate = /** @type {Record<string, unknown>} */ (value);
  const httpStatus = typeof candidate.httpStatus === "number" ? candidate.httpStatus : null;
  if (!text(candidate.robotsUrl) || !URL.canParse(candidate.robotsUrl) || new URL(candidate.robotsUrl).protocol !== "https:" || !text(candidate.targetUrl) || !URL.canParse(candidate.targetUrl) || new URL(candidate.targetUrl).protocol !== "https:" || httpStatus === null || !Number.isInteger(httpStatus) || (httpStatus != 0 && (httpStatus < 100 || httpStatus > 599)) || !["present", "absent", "unavailable"].includes(String(candidate.availability)) || typeof candidate.content !== "string" || new TextEncoder().encode(candidate.content).byteLength > maximumBytes || !timestamp(candidate.checkedAt) || (candidate.matchedRule !== null && !text(candidate.matchedRule))) return false;
  const availability = String(candidate.availability);
  const content = /** @type {string} */ (candidate.content);
  return availability === "absent" ? content === "" && (httpStatus === 404 || httpStatus === 410) : availability === "unavailable" ? content === "" || httpStatus >= 200 && httpStatus <= 299 : httpStatus >= 200 && httpStatus <= 299;
}

/** @param {unknown} value @returns {value is RightsDecision} */
function allowedRights(value) { return record(value) && value.status === "allowed" && text(value.canonicalUrl); }

/** @param {number} value @returns {boolean} */
function acceptedRobotsStatus(value) { return value >= 200 && value <= 299 || value === 404 || value === 410; }

/** @param {number} value @returns {boolean} */
function unavailableRobotsStatus(value) { return value >= 100 && value <= 599 && !acceptedRobotsStatus(value); }

/** @param {string} body @param {string} userAgent @param {string} targetPath @returns {Result<string | null, RobotsFailure>} */
function matchingRule(body, userAgent, targetPath) {
  /** @type {{ agents: string[], allow: string[], disallow: string[] }[]} */
  const groups = [];
  /** @type {{ agents: string[], allow: string[], disallow: string[] } | null} */
  let current = null;
  let malformed = false;
  for (const rawLine of body.split(/\r?\n/u)) {
    const line = rawLine.split("#", 1)[0].trim();
    if (line === "") continue;
    const separator = line.indexOf(":");
    if (separator <= 0) { malformed = true; continue; }
    const directive = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (directive === "user-agent") {
      if (value === "") { malformed = true; current = null; continue; }
      current = { agents: [value.toLowerCase()], allow: [], disallow: [] };
      groups.push(current);
    } else if (directive === "allow" || directive === "disallow") {
      if (current === null) { malformed = true; continue; }
      if (directive === "allow") current.allow.push(value);
      else current.disallow.push(value);
    }
  }
  const normalizedAgent = userAgent.toLowerCase();
  const relevant = groups.filter((group) => group.agents.includes("*") || group.agents.includes(normalizedAgent));
  const rules = relevant.flatMap((group) => [
    ...group.allow.filter((path) => path !== "").map((path) => ({ allowed: true, path })),
    ...group.disallow.filter((path) => path !== "").map((path) => ({ allowed: false, path })),
  ]).filter((rule) => targetPath.startsWith(rule.path));
  rules.sort((left, right) => right.path.length - left.path.length || (left.allowed ? -1 : 1));
  const selected = rules[0] ?? null;
  // An unrelated malformed line must not erase an observed explicit denial.
  if (malformed && (selected === null || selected.allowed)) return {ok:false,error:{kind:'RobotsMalformed'}};
  return { ok: true, value: selected === null || selected.allowed ? null : selected.path };
}

/** @param {RobotsDependencies} dependencies */
export function createRobotsGate(dependencies) {
  const maximumBytes = dependencies?.maximumBytes ?? 256 * 1024;
  const timeoutMs = dependencies?.timeoutMs ?? 5_000;
  const policy = dependencies?.robotsUnavailablePolicy ?? "fail-closed";
  const verify = dependencies?.verifyTargetReachable;
  if (!dependencies || typeof dependencies.fetch !== "function" || (dependencies.fetchRobots !== undefined && typeof dependencies.fetchRobots !== "function") || !validCachedEvidence(dependencies.cachedEvidence, maximumBytes) || typeof dependencies.resolveAddresses !== "function" || typeof dependencies.now !== "function" || typeof dependencies.logger !== "function" || !positiveInteger(maximumBytes) || !positiveInteger(timeoutMs)) throw new TypeError("Robots-gate dependencies are invalid.");
  if (!["fail-closed", "allow-403-if-target-reachable", "allow-unverified-if-public"].includes(policy)) throw new TypeError("Robots-gate unavailable policy is invalid.");
  if (policy !== "fail-closed" && typeof verify !== "function") throw new TypeError("Robots-gate target reachability verifier is required for the configured unavailable policy.");
  /** @type {Map<string, {status:number,bytes:Uint8Array,unavailable?:boolean}>} */
  const cache = new Map();
  return Object.freeze({
    /** @param {unknown} command @returns {Promise<Result<RobotsDecision, RobotsFailure>>} */
    async check(command) {
      if (!record(command) || !allowedRights(command.rights)) return {ok:false,error:{kind:"RobotsCheckBeforeRightsForbidden"}};
      if (!text(command.userAgent ?? "knowledge-platform") || !URL.canParse(command.rights.canonicalUrl)) return {ok:false,error:{kind:"RobotsCommandInvalid",field:"userAgent"}};
      const source = new URL(command.rights.canonicalUrl);
      let target;
      try { target = new URL(text(command.targetUrl) ? command.targetUrl : source.href); }
      catch (error) { return {ok:false,error:{kind:"RobotsCommandInvalid",field:"targetUrl"}}; }
      if (source.protocol !== "https:" || target.protocol !== "https:" || target.origin !== source.origin) return {ok:false,error:{kind:"UnsafeDestination"}};
      const robotsUrl = new URL("/robots.txt", source.origin).href;
      dependencies.logger({event:"robots-check-entry"});
      /** Requires the injected normal acquisition boundary to verify public content and reject blockers.
       * Status 0 records that no HTTP response was available, never a fabricated response.
       * @param {number} status @param {RobotsFailure} failure @param {string} [retainedContent] @returns {Promise<Result<RobotsDecision, RobotsFailure>>} */
      const unavailable = async (status, failure, retainedContent = "") => {
        dependencies.logger({event:"robots-check-unavailable",failureKind:failure.kind});
        if (policy !== "allow-unverified-if-public" && !(policy === "allow-403-if-target-reachable" && status === 403)) return {ok:false,error:failure};
        // Retain malformed directives so another target still observes known denials.
        cache.set(robotsUrl,{status,bytes:new TextEncoder().encode(retainedContent),unavailable:retainedContent === ""});
        let reachable;
        try {
          if (typeof verify !== "function") return {ok:false,error:failure};
          reachable = await verify({robotsUrl,sourceUrl:source.href,targetUrl:target.href});
        } catch (error) {
          return {ok:false,error:{kind:"RobotsTargetUnavailable",causeKind:"RobotsTargetReachabilityCheckFailed"}};
        }
        if (!reachable.ok) {
          const causeKind = record(reachable.error) && text(reachable.error.kind) ? reachable.error.kind : "RobotsTargetReachabilityCheckFailed";
          const diagnosticToken = record(reachable.error) && typeof reachable.error.diagnosticToken === "string" && /^[a-z0-9-]+$/u.test(reachable.error.diagnosticToken) ? reachable.error.diagnosticToken : undefined;
          dependencies.logger({event:"robots-check-failure",failureKind:"RobotsTargetUnavailable"});
          return {ok:false,error:{kind:"RobotsTargetUnavailable",causeKind,...(diagnosticToken === undefined ? {} : {diagnosticToken})}};
        }
        const checkedAt = dependencies.now();
        if (!timestamp(checkedAt)) throw new TypeError("Robots-gate clock returned an invalid timestamp.");
        dependencies.logger({event:"robots-check-allowed-after-unavailable"});
        return {ok:true,value:Object.freeze({status:"allowed",robotsUrl,targetUrl:target.href,httpStatus:status,availability:"unavailable",content:retainedContent,checkedAt,matchedRule:null})};
      };
      let fetched = cache.get(robotsUrl);
      const saved = dependencies.cachedEvidence;
      if (fetched === undefined && saved !== undefined && saved !== null) {
        if (saved.robotsUrl !== robotsUrl || new URL(saved.targetUrl).origin !== source.origin) return {ok:false,error:{kind:"RobotsCommandInvalid",field:"cachedEvidence"}};
        if (saved.availability !== "unavailable" || saved.content !== "") {
          fetched = {status:saved.httpStatus,bytes:new TextEncoder().encode(saved.content)};
          cache.set(robotsUrl,fetched);
          dependencies.logger({event:"robots-check-cache-hit"});
        }
      }
      if (fetched?.unavailable) return unavailable(fetched.status,{kind:"RobotsFetchUnavailable"});
      if (fetched === undefined) {
        let resolved;
        try { resolved = await dependencies.resolveAddresses(source.hostname); }
        catch (error) { resolved = {ok:false,error:{kind:"RobotsNetworkRejected"}}; }
        // Destination safety is mandatory even when robots cannot be verified.
        if (!resolved.ok || !resolved.value?.length) return {ok:false,error:{kind:"RobotsNetworkRejected"}};
        if (dependencies.fetchRobots !== undefined) {
          let acquired;
          try { acquired = await dependencies.fetchRobots({robotsUrl,sourceUrl:source.href}); }
          catch (error) { return unavailable(0,{kind:"RobotsFetchUnavailable",causeKind:"RobotsFetcherThrew"}); }
          if (!acquired.ok) return unavailable(0,{kind:"RobotsFetchUnavailable",causeKind:acquired.error.kind,...(acquired.error.diagnosticToken === undefined ? {} : {diagnosticToken:acquired.error.diagnosticToken})});
          if (!Number.isInteger(acquired.value.status) || (!acceptedRobotsStatus(acquired.value.status) && !unavailableRobotsStatus(acquired.value.status)) || !(acquired.value.bytes instanceof Uint8Array)) return {ok:false,error:{kind:"RobotsFetchUnavailable",causeKind:"RobotsResponseInvalid"}};
          fetched = {status:acquired.value.status,bytes:acquired.value.bytes};
        } else {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), timeoutMs);
          let response;
          try {
            response = await dependencies.fetch(robotsUrl,{method:"GET",redirect:"manual",signal:controller.signal});
            if (!acceptedRobotsStatus(response.status)) return unavailable(response.status,{kind:"RobotsFetchUnavailable"});
            fetched = {status:response.status,bytes:new Uint8Array(await response.arrayBuffer())};
          } catch (error) { return unavailable(response?.status ?? 0,{kind:"RobotsFetchUnavailable"}); }
          finally { clearTimeout(timer); }
        }
        if (fetched.bytes.byteLength > maximumBytes) return unavailable(fetched.status,{kind:"RobotsPayloadTooLarge"});
        cache.set(robotsUrl,{...fetched,bytes:new Uint8Array(fetched.bytes)});
      }
      if (!acceptedRobotsStatus(fetched.status)) return unavailable(fetched.status,{kind:"RobotsFetchUnavailable"});
      const absent = fetched.status === 404 || fetched.status === 410;
      const body = absent ? "" : new TextDecoder().decode(fetched.bytes);
      const selected = absent ? /** @type {Result<string|null,RobotsFailure>} */ ({ok:true,value:null}) : matchingRule(body,text(command.userAgent) ? command.userAgent : "knowledge-platform",target.pathname);
      if (!selected.ok) return policy === "allow-unverified-if-public" ? unavailable(fetched.status,selected.error,body) : selected;
      const checkedAt = dependencies.now();
      if (!timestamp(checkedAt)) throw new TypeError("Robots-gate clock returned an invalid timestamp.");
      if (selected.value !== null) {
        dependencies.logger({event:"robots-check-failure",failureKind:"RobotsDenied"});
        return {ok:false,error:{kind:"RobotsDenied",rule:selected.value}};
      }
      dependencies.logger({event:"robots-check-success"});
      return {ok:true,value:Object.freeze({status:"allowed",robotsUrl,targetUrl:target.href,httpStatus:fetched.status,availability:absent ? "absent" : "present",content:body,checkedAt,matchedRule:null})};
    },
  });
}

export {};
