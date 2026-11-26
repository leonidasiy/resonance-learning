import { Resolver } from "node:dns/promises";
import { createAddressPolicy, createGate, pinnedRequest } from "./gate.ts";
import { createRenderer } from "./renderer.ts";
import {
  createAcquisitionHandler,
  createAcquisitionServer,
} from "./service.ts";
import type {
  Logger,
  Policy,
  Renderer,
  Resolver as AddressResolver,
} from "./contracts.ts";
export class DnsFailed extends Error {
  constructor(cause: unknown) {
    super("DnsFailed", { cause });
    this.name = "DnsFailed";
  }
}
export function createSystemResolver(
  timeoutMilliseconds: number,
  createResolver: (options: { timeout: number; tries: number }) =>
    Pick<Resolver, "resolve4" | "resolve6" | "cancel"> = (options) => new Resolver(options),
): AddressResolver {
  if (!Number.isSafeInteger(timeoutMilliseconds) || timeoutMilliseconds < 1 || typeof createResolver !== "function") {
    throw new TypeError("ConfigurationInvalid");
  }
  return async (hostname, signal) => {
    if (typeof hostname !== "string" || hostname.trim() === "" || !(signal instanceof AbortSignal)) {
      throw new TypeError("CommandInvalid");
    }
    const resolver = createResolver({ timeout: timeoutMilliseconds, tries: 1 });
    const abort = () => resolver.cancel();
    signal.addEventListener("abort", abort, { once: true });
    try {
      signal.throwIfAborted();
      const records = await Promise.allSettled([
        resolver.resolve4(hostname),
        resolver.resolve6(hostname),
      ]);
      const addresses: string[] = [];
      for (const result of records) {
        if (result.status === "fulfilled") addresses.push(...result.value);
        else {
          const reason: unknown = result.reason;
          const code = reason instanceof Error && "code" in reason
            ? String(reason.code)
            : "";
          if (!["ENODATA", "ENOTFOUND"].includes(code)) {
            throw new DnsFailed(reason);
          }
        }
      }
      signal.throwIfAborted();
      return [...new Set(addresses)];
    } finally {
      signal.removeEventListener("abort", abort);
      resolver.cancel();
    }
  };
}
/** Deployment-neutral composition; no environment/secret reads or live requests
 * occur at construction. Unsupported OS fails in renderer before launching. */
export function createAcquisitionRuntime(
  deps: {
    readonly policy: Policy;
    readonly tokens: ReadonlyMap<string, string>;
    readonly chromePath: string;
    readonly nodePath: string;
    readonly platform: string;
    readonly nowMs: () => number;
    readonly logger: Logger;
    readonly maximumActive: number;
    readonly maximumRetained: number;
    readonly retentionMilliseconds: number;
    readonly dnsServers?: readonly string[];
    readonly decodeImage?: Renderer["decodeImage"];
    readonly transport: { readonly kind: "loopback-fixture" | "loopback" } | {
      readonly kind: "tls";
      readonly key: string;
      readonly cert: string;
    };
  },
) {
  const gate = createGate({
    policy: deps.policy,
    addressAllowed: createAddressPolicy(),
    resolve: createSystemResolver(deps.policy.requestMilliseconds, options => {
      const resolver = new Resolver(options);
      if (deps.dnsServers !== undefined) resolver.setServers([...deps.dnsServers]);
      return resolver;
    }),
    dial: pinnedRequest,
    logger: deps.logger,
  });
  const renderer = createRenderer({
    policy: deps.policy,
    chromePath: deps.chromePath,
    nodePath: deps.nodePath,
    platform: deps.platform,
    request: gate.request,
  });
  const handler = createAcquisitionHandler({
    ...deps,
    gate,
    renderer: deps.decodeImage
      ? { ...renderer, decodeImage: deps.decodeImage }
      : renderer,
  });
  return {
    handler,
    server: createAcquisitionServer({
      handler,
      policy: deps.policy,
      transport: deps.transport,
    }),
  };
}
