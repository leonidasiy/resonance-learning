import { readFile, access } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { Resolver } from "node:dns/promises";
import type { Logger } from "./contracts.ts";
import { createAcquisitionRuntime } from "./runtime.ts";
import { createImageDecoder } from "./image-decoder.ts";
import { ACQUISITION_POLICY as policy } from "../worker/acquisition-policy.js";

/** Environment reads belong to launchers; local apps can supply their own values. */
export async function createAcquisitionDeployment(deps: {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly nodePath: string;
  readonly platform: string;
  readonly logger: Logger;
}) {
  const env = deps.env;
  const invalid = (field: string): never => { throw new TypeError(`ConfigurationInvalid: ${field}`); };
  if (env.ACQUISITION_TOKEN && env.ACQUISITION_TOKEN_FILE) invalid("choose token or token file");
  const token = env.ACQUISITION_TOKEN_FILE
    ? (await readFile(env.ACQUISITION_TOKEN_FILE, "utf8")).trim()
    : env.ACQUISITION_TOKEN;
  if (!token || token.length < 32 || /\s/.test(token)) invalid("ACQUISITION_TOKEN (32+ characters)");
  const integer = (field: string, fallback: number) => {
    const text = env[field] ?? String(fallback);
    if (!/^\d+$/.test(text) || !Number.isSafeInteger(Number(text)) || Number(text) < 1) invalid(field);
    return Number(text);
  };
  const port = integer("ACQUISITION_PORT", 8788);
  if (port > 65535) invalid("ACQUISITION_PORT");
  const mode = env.ACQUISITION_TRANSPORT ?? "loopback";
  if (!["loopback", "tls"].includes(mode)) invalid("ACQUISITION_TRANSPORT");
  if (mode === "loopback" && env.ACQUISITION_HOST && env.ACQUISITION_HOST !== "127.0.0.1") invalid("loopback host must be 127.0.0.1");
  if (mode === "loopback" && (env.ACQUISITION_TLS_KEY_FILE || env.ACQUISITION_TLS_CERT_FILE)) invalid("TLS files require tls transport");
  const tlsFile = async (field: string) => {
    const path = env[field];
    if (!path) invalid(field);
    return await readFile(path!, "utf8");
  };
  const transport = mode === "tls"
    ? { kind: "tls" as const, key: await tlsFile("ACQUISITION_TLS_KEY_FILE"), cert: await tlsFile("ACQUISITION_TLS_CERT_FILE") }
    : { kind: "loopback" as const };
  const chromePath = env.ACQUISITION_CHROME_PATH || undefined;
  if (chromePath) {
    if (!isAbsolute(chromePath)) invalid("absolute ACQUISITION_CHROME_PATH");
    await access(chromePath);
  }
  const maximumActive = integer("ACQUISITION_MAX_ACTIVE", 2);
  const maximumRetained = integer("ACQUISITION_MAX_RETAINED", 1000);
  if (maximumRetained < maximumActive) invalid("ACQUISITION_MAX_RETAINED");
  const dnsServers = env.ACQUISITION_DNS_SERVERS?.split(",").map(server => server.trim());
  if (dnsServers !== undefined) {
    if (dnsServers.some(server => !server)) invalid("ACQUISITION_DNS_SERVERS");
    try { const resolver = new Resolver(); resolver.setServers(dnsServers); resolver.cancel(); }
    catch { invalid("ACQUISITION_DNS_SERVERS"); }
  }
  const runtime = createAcquisitionRuntime({
    policy, tokens: new Map([[token!, "self-hosted-client"]]),
    dnsServers,
    chromePath: chromePath ?? deps.nodePath,
    nodePath: deps.nodePath,
    platform: chromePath ? deps.platform : "portable",
    nowMs: Date.now, logger: deps.logger,
    maximumActive, maximumRetained, retentionMilliseconds: 60_000,
    transport,
    decodeImage: createImageDecoder({ policy, nodePath: deps.nodePath }),
  });
  return { ...runtime, host: mode === "loopback" ? "127.0.0.1" : env.ACQUISITION_HOST ?? "0.0.0.0", port, mode };
}
