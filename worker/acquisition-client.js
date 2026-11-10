// @ts-check
import { FAILURE_KINDS, validatePolicy } from "../acquisition/contracts.ts";
/** @import { Policy, RequestCommand, Observation, PageProjection, Failure } from '../acquisition/contracts.ts' */
/** @template T @typedef {{readonly ok:true,readonly value:T}|{readonly ok:false,readonly error:ClientFailure}} ClientResult */
/** @typedef {{readonly kind:Failure['kind']|'AcquisitionBindingUnavailable'|'AcquisitionAuthenticationUnavailable'|'AcquisitionEndpointInvalid'|'AcquisitionProtocolInvalid'|'AcquisitionTransportFailed'|'AcquisitionCancellationUnconfirmed',readonly field?:string}} ClientFailure */
/** @typedef {Observation&{readonly projection?:PageProjection,readonly screenshot?:Uint8Array}} ClientObservation */
/** @typedef {{readonly fetch:(request:Request)=>Promise<Response>}} Fetcher */
/** @param {unknown} value @returns {value is Record<string,unknown>} */
function record(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** @param {string} body @param {number} maximum @returns {Uint8Array|null} */
function decode(body, maximum) {
  if (
    body.length > 4 * Math.ceil(maximum / 3) ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      body,
    )
  ) return null;
  try {
    const bytes = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
    return bytes.length <= maximum ? bytes : null;
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return null;
  }
}
/** @param {unknown} value @returns {value is RequestCommand} */
function validRequestCommand(value) {
  return record(value) && typeof value.url === "string" &&
    typeof value.rootUrl === "string" && URL.canParse(value.url) &&
    URL.canParse(value.rootUrl) &&
    ["page", "robots", "image", "resource"].includes(String(value.purpose)) &&
    typeof value.maximumBytes === "number" &&
    Number.isSafeInteger(value.maximumBytes) && value.maximumBytes > 0 &&
    typeof value.redirectLimit === "number" &&
    Number.isSafeInteger(value.redirectLimit) && value.redirectLimit >= 0;
}
/** @param {ClientFailure['kind']} kind @returns {{readonly ok:false,readonly error:ClientFailure}} */
function failure(kind) {
  return { ok: false, error: { kind } };
}
/** Standard remote Fetcher binding. No ambient fetch, JS-function env variable,
 * browser interception guarantee or caller credential forwarding.
 * @param {{readonly binding:unknown,readonly endpoint:unknown,readonly token:unknown,readonly policy:Policy,readonly createId:()=>string}} deps */
export function createAcquisitionClient(deps) {
  if (!deps || typeof deps.createId !== "function" || !deps.policy) {
    throw new TypeError("ConfigurationInvalid");
  }
  validatePolicy(deps.policy);
  const binding =
    record(deps.binding) && typeof deps.binding.fetch === "function"
      ? /** @type {Fetcher} */ (deps.binding)
      : null;
  const endpoint =
    typeof deps.endpoint === "string" && URL.canParse(deps.endpoint) &&
      new URL(deps.endpoint).protocol === "https:" &&
      !new URL(deps.endpoint).username && !new URL(deps.endpoint).password &&
      new URL(deps.endpoint).pathname === "/" &&
      !new URL(deps.endpoint).search && !new URL(deps.endpoint).hash
      ? new URL(deps.endpoint)
      : null;
  const token = typeof deps.token === "string" && deps.token.length >= 12 &&
      !/[\r\n]/.test(deps.token)
    ? deps.token
    : null;
  /** @param {'request'|'page'|'screenshot'} action @param {RequestCommand} command @param {AbortSignal} signal @returns {Promise<ClientResult<ClientObservation>>} */
  async function perform(action, command, signal) {
    if (binding === null) return failure("AcquisitionBindingUnavailable");
    if (endpoint === null) return failure("AcquisitionEndpointInvalid");
    if (token === null) return failure("AcquisitionAuthenticationUnavailable");
    if (
      !command || !["request", "page", "screenshot"].includes(action) ||
      !(signal instanceof AbortSignal)
    ) return failure("CommandInvalid");
    if (
      !validRequestCommand(command) ||
      command.url.length > deps.policy.urlCharacters ||
      command.rootUrl.length > deps.policy.urlCharacters
    ) return failure("CommandInvalid");
    if (signal.aborted) return failure("Cancelled");
    const id = deps.createId();
    if (!/^[a-zA-Z0-9_-]{12,80}$/.test(id)) {
      throw new TypeError("ConfigurationInvalid");
    }
    const url = new URL(`/v1/operations/${id}`, endpoint);
    const operationSignal = AbortSignal.any([
      signal,
      AbortSignal.timeout(deps.policy.operationMilliseconds),
    ]);
    /** @type {Promise<boolean>|null} */
    let cancellation = null;
    const cancel = () => {
      if (cancellation !== null) return;
      const controller = new AbortController();
      /** @type {ReturnType<typeof setTimeout>|undefined} */ let timer;
      const deadline = new Promise((resolve) => {
        timer = setTimeout(() => {
          controller.abort();
          resolve(false);
        }, deps.policy.requestMilliseconds);
      });
      const acknowledged = (async () => {
        try {
          const response = await binding.fetch(
            new Request(url, {
              method: "DELETE",
              headers: { authorization: `Bearer ${token}` },
              signal: controller.signal,
            }),
          );
          const reader = response.body?.getReader();
          if (!reader) return false;
          const abort = () => {
            void reader.cancel();
          };
          controller.signal.addEventListener("abort", abort, { once: true });
          let text = "";
          let bytes = 0;
          const decoder = new TextDecoder();
          try {
            while (true) {
              const item = await reader.read();
              if (controller.signal.aborted) return false;
              if (item.done) break;
              bytes += item.value.length;
              if (bytes > 1024) {
                await reader.cancel();
                return false;
              }
              text += decoder.decode(item.value, { stream: true });
            }
            text += decoder.decode();
          } finally {
            controller.signal.removeEventListener("abort", abort);
            reader.releaseLock();
          }
          const result = JSON.parse(text);
          return record(result) &&
            ((response.ok && result.ok === true && result.value === null) ||
              (response.status === 404 && result.ok === false && record(result.error) &&
                result.error.kind === "OperationNotFound" &&
                result.error.field === "cancellation-tombstone"));
        } catch (error) {
          if (!(error instanceof Error)) throw error;
          return false;
        }
      })();
      cancellation = Promise.race([acknowledged, deadline]).then((value) => {
        if (timer !== undefined) clearTimeout(timer);
        return value === true;
      });
    };
    /** @param {Promise<Response>} post @returns {Promise<Response>} */
    async function waitForHeaders(post) {
      let aborted = () => {};
      try {
        return await Promise.race([
          post,
          new Promise((resolve, reject) => {
            aborted = () => reject(new AcquisitionRequestFailure("Cancelled"));
            operationSignal.addEventListener("abort", aborted, { once: true });
            if (operationSignal.aborted) aborted();
          }),
        ]);
      } finally {
        operationSignal.removeEventListener("abort", aborted);
      }
    }
    operationSignal.addEventListener("abort", cancel, { once: true });
    try {
      const response = await waitForHeaders(binding.fetch(
        new Request(url, {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ action, request: command }),
          signal: operationSignal,
        }),
      ));
      if (operationSignal.aborted) {
        cancel();
        return await cancellation
          ? failure(signal.aborted ? "Cancelled" : "TimedOut")
          : failure("AcquisitionCancellationUnconfirmed");
      }
      // Bound encoded protocol bytes while consuming; base64 inflates body by 4/3.
      const reader = response.body?.getReader();
      if (!reader) return failure("AcquisitionProtocolInvalid");
      const maximum = 4 * Math.ceil(command.maximumBytes / 3) +
        4 * Math.ceil(deps.policy.screenshotBytes / 3) +
        deps.policy.htmlBytes * 6 +
        deps.policy.renderedTextCharacters * 6 +
        deps.policy.links * deps.policy.urlCharacters * 6 + 100_000;
      let length = 0;
      const decoder = new TextDecoder();
      let body = "";
      const stop = () => {
        void reader.cancel();
      };
      operationSignal.addEventListener("abort", stop, { once: true });
      try {
        while (true) {
          const item = await reader.read();
          if (operationSignal.aborted) {
            cancel();
            return await cancellation
              ? failure(signal.aborted ? "Cancelled" : "TimedOut")
              : failure("AcquisitionCancellationUnconfirmed");
          }
          if (item.done) break;
          length += item.value.length;
          if (length > maximum) {
            await reader.cancel();
            cancel();
            await cancellation;
            return failure("AcquisitionProtocolInvalid");
          }
          body += decoder.decode(item.value, { stream: true });
        }
        body += decoder.decode();
      } finally {
        operationSignal.removeEventListener("abort", stop);
        reader.releaseLock();
      }
      /** @type {unknown} */
      let result;
      try {
        result = JSON.parse(body);
      } catch (error) {
        if (!(error instanceof Error)) throw error;
        return failure("AcquisitionProtocolInvalid");
      }
      if (!record(result) || typeof result.ok !== "boolean") {
        return failure("AcquisitionProtocolInvalid");
      }
      if (!result.ok) {
        if (
          !record(result.error) || typeof result.error.kind !== "string" ||
          !new Set(/** @type {readonly string[]} */ (FAILURE_KINDS)).has(
            result.error.kind,
          )
        ) return failure("AcquisitionProtocolInvalid");
        return { ok: false, error: /** @type {Failure} */ (result.error) };
      }
      const v = result.value;
      if (
        !record(v) || typeof v.peerAddress !== "string" ||
        !Number.isInteger(v.status) || typeof v.status !== "number" ||
        v.status < 200 || v.status > 599 || !record(v.headers) ||
        !Object.entries(v.headers).every(([k, h]) =>
          ["content-type", "retry-after"].includes(k) && typeof h === "string"
        ) || typeof v.bodyBase64 !== "string" ||
        typeof v.finalUrl !== "string" ||
        v.finalUrl.length > deps.policy.urlCharacters ||
        !URL.canParse(v.finalUrl) ||
        !Array.isArray(v.redirectHops) || !v.redirectHops.every((h) =>
          typeof h === "string"
        ) || v.redirectHops.length > command.redirectLimit
      ) return failure("AcquisitionProtocolInvalid");
      const bytes = decode(v.bodyBase64, command.maximumBytes);
      if (bytes === null) return failure("AcquisitionProtocolInvalid");
      /** @type {PageProjection|undefined} */
      let projection;
      if (v.projection !== undefined) {
        const p = v.projection;
        if (
          !record(p) || typeof p.html !== "string" ||
          new TextEncoder().encode(p.html).length > deps.policy.htmlBytes ||
          typeof p.renderedTitle !== "string" || p.renderedTitle.length > 300 ||
          typeof p.renderedText !== "string" ||
          p.renderedText.length > deps.policy.renderedTextCharacters ||
          !Array.isArray(p.visibleLinks) ||
          p.visibleLinks.length > deps.policy.links ||
          !p.visibleLinks.every((x) =>
            typeof x === "string" && x.length <= deps.policy.urlCharacters
          )
        ) return failure("AcquisitionProtocolInvalid");
        projection = /** @type {PageProjection} */ (p);
      }
      if (action !== "request" && projection === undefined) {
        return failure("AcquisitionProtocolInvalid");
      }
      let screenshot;
      if (v.screenshotBase64 !== undefined) {
        if (typeof v.screenshotBase64 !== "string") {
          return failure("AcquisitionProtocolInvalid");
        }
        screenshot = decode(v.screenshotBase64, deps.policy.screenshotBytes);
        if (screenshot === null) return failure("AcquisitionProtocolInvalid");
      }
      return {
        ok: true,
        value: {
          peerAddress: v.peerAddress,
          status: v.status,
          headers: /** @type {Readonly<Record<string,string>>} */ (v.headers),
          bytes,
          finalUrl: v.finalUrl,
          redirectHops: /** @type {string[]} */ (v.redirectHops),
          ...(projection ? { projection } : {}),
          ...(screenshot ? { screenshot } : {}),
        },
      };
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      if (operationSignal.aborted) {
        cancel();
        return await cancellation
          ? failure(signal.aborted ? "Cancelled" : "TimedOut")
          : failure("AcquisitionCancellationUnconfirmed");
      }
      return failure("AcquisitionTransportFailed");
    } finally {
      operationSignal.removeEventListener("abort", cancel);
    }
  }
  const mediaCapability = {
    cancellationMilliseconds: deps.policy.requestMilliseconds,
    /** @param {Request} request @param {import('../src/features/knowledge-workflows/media.js').MediaPublicEgressPolicy} policy @returns {Promise<import('../src/features/knowledge-workflows/media.js').Result<{readonly response:Response,readonly redirectHops:readonly string[]},import('../src/features/knowledge-workflows/media.js').MediaPublicEgressFailure>>} */
    async request(request, policy) {
      if (
        !(request instanceof Request) || request.method !== "GET" || !policy ||
        !(policy.signal instanceof AbortSignal)
      ) return { ok: false, error: { kind: "MediaPublicEgressFailed" } };
      const result = await perform("request", {
        url: request.url,
        rootUrl: new URL("/", request.url).href,
        purpose: "image",
        maximumBytes: policy.maximumBytes,
        redirectLimit: policy.redirectLimit,
      }, AbortSignal.any([request.signal, policy.signal]));
      if (!result.ok) {
        if (result.error.kind === "AcquisitionBindingUnavailable") {
          return { ok: false, error: { kind: "MediaPublicEgressUnavailable" } };
        }
        if (result.error.kind === "AcquisitionCancellationUnconfirmed") {
          return { ok: false, error: { kind: "MediaPublicEgressCancellationUnconfirmed" } };
        }
        if (result.error.kind.startsWith("Acquisition")) {
          return {
            ok: false,
            error: {
              kind: "MediaAcquisitionTransportFailed",
              causeKind: result.error.kind,
            },
          };
        }
        return { ok: false, error: /** @type {Failure} */ (result.error) };
      }
      return {
        ok: true,
        value: {
          response: new Response(
            result.value.status === 204 ? null : result.value.bytes,
            { status: result.value.status, headers: result.value.headers },
          ),
          redirectHops: result.value.redirectHops,
        },
      };
    },
  };
  // Legacy robots callable is now an adapter over a standard remote Fetcher.
  /** @param {{readonly url:string,readonly timeout:number}} command */
  async function sourceBrowserRequest(command) {
    if (
      !record(command) || typeof command.url !== "string" ||
      !URL.canParse(command.url) || !Number.isSafeInteger(command.timeout) ||
      command.timeout <= 0
    ) throw new AcquisitionRequestFailure("CommandInvalid");
    const c = new AbortController();
    const result = await perform("request", {
      url: command.url,
      rootUrl: new URL("/", command.url).href,
      purpose: "robots",
      maximumBytes: deps.policy.robotsBytes,
      redirectLimit: 0,
    }, AbortSignal.any([c.signal, AbortSignal.timeout(command.timeout)]));
    if (!result.ok) throw new AcquisitionRequestFailure(result.error.kind);
    return {
      status: () => result.value.status,
      url: () => result.value.finalUrl,
      headers: () => result.value.headers,
      text: async () => new TextDecoder().decode(result.value.bytes),
    };
  }
  return Object.freeze({ perform, mediaCapability, sourceBrowserRequest });
}
class AcquisitionRequestFailure extends Error {
  /** @param {string} kind */
  constructor(kind) {
    super(kind);
    this.name = kind;
  }
}
/** @param {{readonly client:ReturnType<typeof createAcquisitionClient>,readonly policy:Policy,readonly logger:(entry:{readonly event:string,readonly failureKind?:string})=>{readonly ok:true,readonly value:null}|{readonly ok:false,readonly error:{readonly kind:string}}}} deps */
export function createAcquisitionWorkflowBrowser(deps) {
  if (typeof deps?.logger !== "function") {
    throw new TypeError("ConfigurationInvalid");
  }
  let closed = false;
  /** @type {AbortController|null} */
  let active = null;
  /** @type {Promise<unknown>|null} */
  let pending = null;
  /** @template T @param {()=>Promise<T>} action @returns {Promise<T|{readonly ok:false,readonly error:{readonly kind:string,readonly diagnosticToken?:string}}>} */
  async function operation(action) {
    if (closed) return { ok: false, error: { kind: "KnowledgeBrowserClosed" } };
    if (active) {
      return {
        ok: false,
        error: { kind: "KnowledgeBrowserOperationConflict" },
      };
    }
    const entryLog = deps.logger({ event: "knowledge-browser-entry" });
    if (!entryLog.ok) {
      return {
        ok: false,
        error: {
          kind: "KnowledgeBrowserLoggingFailed",
          diagnosticToken: entryLog.error.kind,
        },
      };
    }
    active = new AbortController();
    try {
      const work = action();
      pending = work;
      const result = await work;
      const log = deps.logger({
        event: record(result) && result.ok === true
          ? "knowledge-browser-success"
          : "knowledge-browser-failure",
        ...(record(result) && result.ok === false && record(result.error) &&
            typeof result.error.kind === "string"
          ? { failureKind: result.error.kind }
          : {}),
      });
      if (!log.ok) {
        return {
          ok: false,
          error: {
            kind: "KnowledgeBrowserLoggingFailed",
            diagnosticToken: log.error.kind,
          },
        };
      }
      return result;
    } finally {
      active = null;
      pending = null;
    }
  }
  return Object.freeze({
    /** @param {{readonly rootUrl:string,readonly url:string,readonly signal?:AbortSignal}} command */
    readPage(command) {
      return operation(async () => {
        const result = await deps.client.perform("page", {
          url: command.url,
          rootUrl: command.rootUrl,
          purpose: "page",
          maximumBytes: deps.policy.htmlBytes,
          redirectLimit: deps.policy.pageRedirects,
        }, command.signal===undefined?/** @type {AbortController} */ (active).signal:AbortSignal.any([/** @type {AbortController} */ (active).signal,command.signal]));
        if (!result.ok) {
          return result.error.kind === "AcquisitionBindingUnavailable"
            ? {
              ok: /** @type {const} */ (false),
              error: {
                kind: "KnowledgeBrowserLaunchFailed",
                diagnosticToken: "acquisition-binding-unavailable",
              },
            }
            : result;
        }
        const p = result.value.projection;
        if (!p) return failure("AcquisitionProtocolInvalid");
        return {
          ok: /** @type {const} */ (true),
          value: {
            url: command.url,
            responseUrl: result.value.finalUrl,
            contentType: result.value.headers["content-type"] ?? "",
            bytes: new TextEncoder().encode(p.html),
            redirects: result.value.redirectHops.length,
            renderedTitle: p.renderedTitle,
            renderedText: p.renderedText,
            ...(p.evidence === undefined ? {} : { evidence:p.evidence }),
            visibleLinks: p.visibleLinks,
          },
        };
      });
    },
    /** @param {{readonly sourceUrl:string,readonly robotsUrl:string}} command */
    readRobots(command) {
      return operation(async () => {
        if (
          !record(command) || typeof command.sourceUrl !== "string" ||
          typeof command.robotsUrl !== "string"
        ) return failure("CommandInvalid");
        if (
          !URL.canParse(command.sourceUrl) ||
          !URL.canParse(command.robotsUrl) ||
          command.robotsUrl !==
            `${new URL(command.sourceUrl).origin}/robots.txt`
        ) {
          return {
            ok: /** @type {const} */ (false),
            error: { kind: "KnowledgeBrowserNavigationRejected" },
          };
        }
        const r = await deps.client.perform("request", {
          url: command.robotsUrl,
          rootUrl: command.sourceUrl,
          purpose: "robots",
          maximumBytes: deps.policy.robotsBytes,
          redirectLimit: 0,
        }, /** @type {AbortController} */ (active).signal);
        if (!r.ok) {
          return r.error.kind === "AcquisitionBindingUnavailable"
            ? {
              ok: /** @type {const} */ (false),
              error: { kind: "KnowledgeRobotsRequestCapabilityUnavailable" },
            }
            : r;
        }
        if (
          !((r.value.status >= 200 && r.value.status <= 299) ||
            [403, 404, 410].includes(r.value.status))
        ) {
          return {
            ok: /** @type {const} */ (false),
            error: { kind: "KnowledgeRobotsFetchUnavailable" },
          };
        }
        return {
          ok: /** @type {const} */ (true),
          value: {
            status: r.value.status,
            headers: r.value.headers,
            bytes: r.value.status === 403 ? new Uint8Array() : r.value.bytes,
          },
        };
      });
    },
    /** @param {{readonly rootUrl:string,readonly url:string}} command */
    screenshot(command) {
      return operation(async () => {
        const r = await deps.client.perform("screenshot", {
          ...command,
          purpose: "page",
          maximumBytes: deps.policy.htmlBytes,
          redirectLimit: deps.policy.pageRedirects,
        }, /** @type {AbortController} */ (active).signal);
        if (!r.ok) return r;
        if (!r.value.screenshot) {
          return {
            ok: /** @type {const} */ (false),
            error: { kind: "WorkflowBrowserScreenshotUnavailable" },
          };
        }
        return {
          ok: /** @type {const} */ (true),
          value: {
            url: command.url,
            mediaType: /** @type {const} */ ("image/png"),
            bytes: r.value.screenshot,
          },
        };
      });
    },
    async close() {
      closed = true;
      active?.abort();
      const result = await pending;
      if (
        record(result) && result.ok === false && record(result.error) &&
        result.error.kind === "AcquisitionCancellationUnconfirmed"
      ) {
        return {
          ok: /** @type {const} */ (false),
          error: { kind: "KnowledgeBrowserSessionCloseFailed" },
        };
      }
      return { ok: /** @type {const} */ (true), value: null };
    },
  });
}
