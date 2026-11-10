import { collectWebpageEvidence } from '../src/features/knowledge-workflows/webpage-evidence.js';
import { Buffer } from "node:buffer";
import { chromium } from "playwright-core";
import type { Browser } from "playwright-core";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  Budget,
  Failure,
  Observation,
  Policy,
  Renderer,
  RequestCommand,
  Result,
} from "./contracts.ts";
import { fail } from "./contracts.ts";
import { inScope, publicUrl, validatePolicy } from "./gate.ts";

// OS enforcement applies to Chromium and all descendants, including UDP/WebRTC,
// DNS, service workers and browser-originated traffic outside interception.
// Unix IPC remains available for Chromium startup; CDP uses inherited pipes.
export const NETWORK_DENIAL_PROFILE =
  '(version 1)(allow default)(deny network* (local ip "*:*") (remote ip "*:*"))';
const execute = promisify(execFile);
function asBytes(value: unknown): Uint8Array {
  if (!(value instanceof Uint8Array)) throw new TypeError("BrowserFailed");
  return new Uint8Array(value);
}
function quoted(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
export async function probeIsolation(nodePath: string): Promise<boolean> {
  try {
    const { stdout } = await execute("/usr/bin/sandbox-exec", [
      "-p",
      NETWORK_DENIAL_PROFILE,
      nodePath,
      "-e",
      `const net=require('node:net'),udp=require('node:dgram');let n=0;function done(e){if(e.code!=='EPERM')process.exit(2);if(++n===4)process.exit(0);}for(const h of ['127.0.0.1','::1'])net.connect(9,h).on('error',done);for(const [t,h]of [['udp4','127.0.0.1'],['udp6','::1']]){const s=udp.createSocket(t);s.on('error',e=>{s.close();done(e)});s.send('x',9,h,e=>{if(e){s.close();done(e)}else process.exit(3);});}`,
    ], { timeout: 3000, env: { PATH: "/usr/bin:/bin" }, maxBuffer: 1024 });
    return stdout === "";
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return false;
  }
}

/** Only source-declared public scripts may load outside the source path. */
export function sourceScriptUrls(html: string, pageUrl: string, policy: Policy): ReadonlySet<string> {
  const urls = new Set<string>();
  for (const match of html.matchAll(/<script\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1/giu)) {
    try {
      const candidate = publicUrl(new URL(match[2], pageUrl).href, policy.urlCharacters);
      if (candidate.ok) urls.add(candidate.value.href);
    } catch { /* Invalid source URL is not an allowed resource. */ }
  }
  return urls;
}
export function imageMetadata(
  bytes: Uint8Array,
  type: string,
  policy: Policy,
): Result<{ width: number; height: number; frames: number }> {
  let width = 0, height = 0, frames = 1;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (start: number, end: number) =>
    new TextDecoder().decode(bytes.subarray(start, end));
  try {
    if (type === "image/png" && bytes.length >= 24 && ascii(1, 4) === "PNG") {
      width = view.getUint32(16);
      height = view.getUint32(20);
      for (let i = 8; i + 12 <= bytes.length;) {
        const length = view.getUint32(i);
        if (i + length + 12 > bytes.length) break;
        if (ascii(i + 4, i + 8) === "acTL") {
          if (length < 8) return fail("ImageDecodeFailed");
          frames = view.getUint32(i + 8);
        }
        i += length + 12;
      }
    } else if (
      type === "image/jpeg" && bytes.length >= 4 && bytes[0] === 255 &&
      bytes[1] === 216
    ) {
      let i = 2;
      while (i + 4 < bytes.length) {
        if (bytes[i++] !== 255) return fail("ImageDecodeFailed");
        while (bytes[i] === 255) i++;
        const marker = bytes[i++];
        if (marker === 217 || marker === 218) break;
        const length = view.getUint16(i);
        if (length < 2 || i + length > bytes.length) {
          return fail("ImageDecodeFailed");
        }
        if (
          [192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207]
            .includes(marker)
        ) {
          height = view.getUint16(i + 3);
          width = view.getUint16(i + 5);
          break;
        }
        i += length;
      }
    } else if (
      type === "image/gif" && bytes.length >= 13 &&
      ["GIF87a", "GIF89a"].includes(ascii(0, 6))
    ) {
      width = view.getUint16(6, true);
      height = view.getUint16(8, true);
      frames = 0;
      let i = 13 + ((bytes[10] & 128) ? 3 * (2 ** ((bytes[10] & 7) + 1)) : 0);
      const skip = () => {
        while (i < bytes.length) {
          const n = bytes[i++];
          if (n === 0) return;
          i += n;
        }
        throw new Error("ImageDecodeFailed");
      };
      while (i < bytes.length) {
        const tag = bytes[i++];
        if (tag === 59) break;
        if (tag === 33) {
          i++;
          skip();
        } else if (tag === 44) {
          if (i + 9 > bytes.length) return fail("ImageDecodeFailed");
          const w = view.getUint16(i + 4, true),
            h = view.getUint16(i + 6, true);
          if (w > width || h > height) return fail("ImageDecodeFailed");
          const packed = bytes[i + 8];
          i += 9 + ((packed & 128) ? 3 * (2 ** ((packed & 7) + 1)) : 0);
          i++;
          frames++;
          skip();
        } else return fail("ImageDecodeFailed");
      }
    } else if (
      type === "image/webp" && bytes.length >= 30 && ascii(0, 4) === "RIFF" &&
      ascii(8, 12) === "WEBP"
    ) {
      const chunk = ascii(12, 16);
      if (chunk === "VP8X") {
        width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16);
        height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16);
        if (bytes[20] & 2) frames = 2;
      } else if (
        chunk === "VP8 " && bytes[23] === 157 && bytes[24] === 1 &&
        bytes[25] === 42
      ) {
        width = view.getUint16(26, true) & 16383;
        height = view.getUint16(28, true) & 16383;
      } else if (chunk === "VP8L" && bytes[20] === 47) {
        const bits = view.getUint32(21, true);
        width = (bits & 16383) + 1;
        height = ((bits >>> 14) & 16383) + 1;
      }
    } else return fail("ImageTypeUnsupported");
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return fail("ImageDecodeFailed");
  }
  if (!width || !height || !frames) return fail("ImageDecodeFailed");
  if (width * height > policy.pixels) return fail("PixelLimitExceeded");
  if (frames > policy.frames) return fail("FrameLimitExceeded");
  return { ok: true, value: { width, height, frames } };
}
export function createRenderer(
  deps: {
    readonly policy: Policy;
    readonly chromePath: string;
    readonly nodePath: string;
    readonly platform: string;
    readonly request: (
      command: RequestCommand,
      budget: Budget,
      signal: AbortSignal,
    ) => Promise<Result<Observation>>;
  },
): Renderer {
  validatePolicy(deps.policy);
  if (
    !isAbsolute(deps.chromePath) || !isAbsolute(deps.nodePath) ||
    typeof deps.request !== "function"
  ) throw new TypeError("ConfigurationInvalid");
  async function isolated<T>(
    signal: AbortSignal,
    action: (browser: Browser) => Promise<Result<T>>,
  ): Promise<Result<T>> {
    if (signal.aborted) return fail("Cancelled");
    if (deps.platform !== "darwin" || !await probeIsolation(deps.nodePath)) {
      return fail("BrowserTransportUnsupported");
    }
    let directory: string | undefined, browser: Browser | undefined;
    let closeFailed = false;
    const abort = () => {
      void browser?.close().catch(() => {
        closeFailed = true;
      });
    };
    let result: Result<T>;
    try {
      await access(deps.chromePath);
      directory = await mkdtemp(join(tmpdir(), "acquisition-renderer-"));
      const wrapper = join(directory, "browser");
      await writeFile(
        wrapper,
        `#!/bin/sh\nexec /usr/bin/sandbox-exec -p ${
          quoted(NETWORK_DENIAL_PROFILE)
        } ${quoted(deps.chromePath)} "$@"\n`,
        { mode: 0o700 },
      );
      browser = await chromium.launch({
        executablePath: wrapper,
        headless: true,
        env: { HOME: directory, PATH: "/usr/bin:/bin", TMPDIR: directory },
        timeout: deps.policy.requestMilliseconds,
      });
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) {
        await browser.close();
        return fail("Cancelled");
      }
      result = await action(browser);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      result = fail(signal.aborted ? "Cancelled" : "BrowserFailed");
    } finally {
      signal.removeEventListener("abort", abort);
      try {
        await browser?.close();
      } catch (error) {
        if (!(error instanceof Error)) throw error;
        closeFailed = true;
      }
      if (directory) await rm(directory, { recursive: true, force: true });
    }
    return closeFailed ? fail("BrowserFailed", "close") : result;
  }
  return {
    async render(command, observation, budget, signal, screenshot) {
      const root = publicUrl(command.rootUrl, deps.policy.urlCharacters),
        target = publicUrl(observation.finalUrl, deps.policy.urlCharacters);
      if (!root.ok) return root;
      if (!target.ok) return target;
      if (!inScope(root.value, target.value)) return fail("ScopeRejected");
      const pixels = deps.policy.viewportWidth * deps.policy.viewportHeight;
      if (
        screenshot &&
        (budget.pixels + pixels > deps.policy.aggregatePixels ||
          pixels > deps.policy.pixels)
      ) return fail("PixelLimitExceeded");
      const resourceController = new AbortController();
      const declaredScripts = sourceScriptUrls(new TextDecoder().decode(observation.bytes), observation.finalUrl, deps.policy);
      signal = AbortSignal.any([signal, resourceController.signal]);
      let failure: Failure | undefined;
      const pendingResources = new Set<Promise<Result<Observation>>>();
      try {
        const result = await isolated(signal, async (browser) => {
          const context = await browser.newContext({
            viewport: {
              width: deps.policy.viewportWidth,
              height: deps.policy.viewportHeight,
            },
            serviceWorkers: "block",
            acceptDownloads: false,
          });
          const page = await context.newPage();
          let initial = true;

          await context.route("**/*", async (route) => {
            const req = route.request();
            const url = publicUrl(req.url(), deps.policy.urlCharacters);
            const sourceResource = url.ok && inScope(root.value, url.value);
            const declaredScript = url.ok && req.resourceType() === "script" && declaredScripts.has(url.value.href);
            if (
              !url.ok || (!sourceResource && !declaredScript) ||
              req.method() !== "GET" ||
              (req.isNavigationRequest() && req.frame() !== page.mainFrame()) ||
              ["image", "media", "font", "stylesheet"].includes(
                req.resourceType(),
              )
            ) {
              await route.abort();
              return;
            }
            let resource: Result<Observation>;
            if (
              initial && req.isNavigationRequest() &&
              url.value.href === observation.finalUrl
            ) {
              initial = false;
              resource = { ok: true, value: observation };
            } else {
              const pending = deps.request(
                {
                  ...command,
                  url: url.value.href,
                  rootUrl: sourceResource ? command.rootUrl : url.value.href,
                  purpose: "resource",
                  maximumBytes: deps.policy.htmlBytes,
                  redirectLimit: deps.policy.pageRedirects,
                },
                budget,
                signal,
              );
              pendingResources.add(pending);
              try {
                resource = await pending;
              } finally {
                pendingResources.delete(pending);
              }
            }
            if (!resource.ok) {
              failure ??= resource.error;
              resourceController.abort();
              await route.abort();
              return;
            }
            if (resource.value.status < 200 || resource.value.status > 299) {
              failure ??= { kind: "KnowledgePageFetchFailed" };
              resourceController.abort();
              await route.abort();
              return;
            }
            await route.fulfill({
              status: resource.value.status,
              headers: {
                ...resource.value.headers,
                "content-security-policy":
                  "frame-src 'none'; worker-src 'none'; object-src 'none'",
              },
              body: Buffer.from(resource.value.bytes),
            });
          });
          page.on("popup", (popup) => {
            void popup.close();
          });
          await page.goto(observation.finalUrl, {
            waitUntil: "networkidle",
            timeout: deps.policy.requestMilliseconds,
          });
          if (failure) return { ok: false, error: failure };
          const evidence = await page.evaluate(collectWebpageEvidence, {url:observation.finalUrl,textCharacters:deps.policy.renderedTextCharacters,candidateCount:32,occurrenceWindow:32});
          if (!evidence.ok) return fail("DecodedLimitExceeded", evidence.error.kind);
          const projection = await page.evaluate(
            ({ textCap, linksCap, htmlCap, urlCap }) => {
              const html = document.documentElement.outerHTML;
              if (new TextEncoder().encode(html).length > htmlCap) return null;
              const container = document.querySelector("main, article") ??
                document.body;
              const renderedText = (container instanceof HTMLElement
                ? container.innerText
                : container?.textContent ?? "").replace(/\s+/g, " ").trim();
              const links = [...document.querySelectorAll("a[href]")].filter(
                (a) =>
                  a.getClientRects().length > 0,
              );
              if (renderedText.length > textCap) {
                return null;
              }
              const navigationTruncated = links.length > linksCap;
              const visibleLinks = links.slice(0,linksCap).map((a) =>
                (a as HTMLAnchorElement).href
              );
              if (visibleLinks.some((link) => link.length > urlCap)) {
                return null;
              }
              return {
                html,
                renderedTitle: document.title.slice(0, 300),
                renderedText,
                visibleLinks, navigationTruncated,
              };
            },
            {
              textCap: deps.policy.renderedTextCharacters,
              linksCap: deps.policy.links,
              htmlCap: deps.policy.htmlBytes,
              urlCap: deps.policy.urlCharacters,
            },
          );
          if (projection === null) {
            return fail("DecodedLimitExceeded", "rendered-projection");
          }
          let png: Uint8Array | undefined;
          if (screenshot) {
            budget.pixels += pixels;
            png = asBytes(
              await page.screenshot({
                type: "png",
                timeout: deps.policy.requestMilliseconds,
              }),
            );
            if (png.byteLength > deps.policy.screenshotBytes) {
              return fail("EncodedLimitExceeded", "screenshot");
            }
            budget.encoded += png.byteLength;
            if (budget.encoded > deps.policy.encodedOperationBytes) {
              return fail("OperationLimitExceeded");
            }
          }
          return {
            ok: true,
            value: { projection: {...projection, evidence:{...evidence.value,warnings:projection.navigationTruncated?[...evidence.value.warnings,'WebpageNavigationLinkLimitExceeded']:evidence.value.warnings}}, ...(png ? { screenshot: png } : {}) },
          };
        });
        return failure ? { ok: false, error: failure } : result;
      } finally {
        resourceController.abort();
        await Promise.allSettled([...pendingResources]);
      }
    },
    async decodeImage(bytes, type, signal) {
      const metadata = imageMetadata(bytes, type, deps.policy);
      if (!metadata.ok) return metadata;
      return isolated(signal, async (browser) => {
        const page = await browser.newPage();
        const base64 = Buffer.from(bytes).toString("base64");
        const valid = await page.evaluate(
          async ({ body, type, width, height }) => {
            try {
              const bytes = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
              const image = await createImageBitmap(
                new Blob([bytes], { type }),
              );
              const valid = image.width === width && image.height === height;
              image.close();
              return valid;
            } catch (error) {
              if (!(error instanceof Error)) throw error;
              return false;
            }
          },
          {
            body: base64,
            type,
            width: metadata.value.width,
            height: metadata.value.height,
          },
        );
        return valid ? { ok: true, value: null } : fail("ImageDecodeFailed");
      });
    },
  };
}
