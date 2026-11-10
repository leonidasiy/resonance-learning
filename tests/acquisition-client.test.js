// @ts-check
/** @param {unknown} actual @param {unknown} expected */
function assertEquals(actual, expected) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error("assertEquals failed");
  }
}
import {
  createAcquisitionClient,
  createAcquisitionWorkflowBrowser,
} from "../worker/acquisition-client.js";
import { ACQUISITION_POLICY as policy } from "../worker/acquisition-policy.js";
const bytes = new TextEncoder().encode("<main>fixture</main>");
const wire = {
  peerAddress: "8.8.8.8",
  status: 200,
  headers: { "content-type": "text/html" },
  bodyBase64: btoa(String.fromCharCode(...bytes)),
  finalUrl: "https://source.example/article",
  redirectHops: [],
  projection: {
    html: "<main>fixture</main>",
    renderedTitle: "Fixture",
    renderedText: "fixture",
    visibleLinks: ["https://source.example/next"],
  },
};
Deno.test("acquisition client standard Fetcher binding composes webpage robots and media with no credential forwarding", async () => {
  /** @type {Request[]} */
  const requests = [];
  /** @type {string[]} */
  let pageRequestKeys = [];
  let n = 0;
  const client = createAcquisitionClient({
    binding: {
      fetch: async (/** @type {Request} */ r) => {
        requests.push(r);
        const c = await r.json();
        if (c.action === 'page') pageRequestKeys = Object.keys(c.request).sort();
        return Response.json({
          ok: true,
          value: { ...wire, finalUrl: c.request.url },
        });
      },
    },
    endpoint: "https://service.test/",
    token: "fixture-token-a",
    policy,
    createId: () => `fixture-id-${++n}-0000`,
  });
  const browser = createAcquisitionWorkflowBrowser({
    client,
    policy,
    logger: () => ({ ok: /** @type {const} */ (true), value: null }),
  });
  const page = await browser.readPage({
    rootUrl: "https://source.example/",
    url: wire.finalUrl,
    signal: new AbortController().signal,
  });
  assertEquals(page.ok, true);
  assertEquals(pageRequestKeys, ['maximumBytes', 'purpose', 'redirectLimit', 'rootUrl', 'url']);
  const robots = await browser.readRobots({
    sourceUrl: wire.finalUrl,
    robotsUrl: "https://source.example/robots.txt",
  });
  assertEquals(robots.ok, true);
  const request = new Request("https://source.example/image.png", {
    headers: { cookie: "never-forward", authorization: "never-forward" },
  });
  const media = await client.mediaCapability.request(request, {
    maximumBytes: 100,
    timeoutMilliseconds: 1000,
    redirectLimit: 4,
    validateEveryRedirect: true,
    publicAddressesOnly: true,
    signal: new AbortController().signal,
  });
  assertEquals(media.ok, true);
  assertEquals(requests.length, 3);
  assertEquals(
    requests.every((r) =>
      r.headers.get("authorization") === "Bearer fixture-token-a" &&
      r.headers.get("cookie") === null
    ),
    true,
  );
  assertEquals(requests.every((r) => !r.url.includes("source.example")), true);
  await browser.close();
});
Deno.test("acquisition missing binding preserves robots and media failure naming without raw fetch", async () => {
  const client = createAcquisitionClient({
    binding: undefined,
    endpoint: null,
    token: null,
    policy,
    createId: () => "fixture-id-0000",
  });
  const browser = createAcquisitionWorkflowBrowser({
    client,
    policy,
    logger: () => ({ ok: /** @type {const} */ (true), value: null }),
  });
  const robots = await browser.readRobots({
    sourceUrl: wire.finalUrl,
    robotsUrl: "https://source.example/robots.txt",
  });
  assertEquals(robots.ok, false);
  if (!robots.ok) {
    assertEquals(
      robots.error.kind,
      "KnowledgeRobotsRequestCapabilityUnavailable",
    );
  }
  const media = await client.mediaCapability.request(
    new Request(wire.finalUrl),
    {
      maximumBytes: 100,
      timeoutMilliseconds: 1000,
      redirectLimit: 4,
      validateEveryRedirect: true,
      publicAddressesOnly: true,
      signal: new AbortController().signal,
    },
  );
  if (!media.ok) assertEquals(media.error.kind, "MediaPublicEgressUnavailable");
});
Deno.test("acquisition rejects malformed and oversized wire response at typed boundary", async () => {
  for (
    const value of [
      { ...wire, bodyBase64: "?" },
      { ...wire, bodyBase64: btoa("x".repeat(policy.htmlBytes + 1)) },
      { ...wire, headers: { cookie: "secret" } },
      { ...wire, projection: { ...wire.projection, visibleLinks: [1] } },
    ]
  ) {
    const client = createAcquisitionClient({
      binding: { fetch: async () => Response.json({ ok: true, value }) },
      endpoint: "https://service.test/",
      token: "fixture-token-a",
      policy,
      createId: () => "fixture-id-0000",
    });
    const page = await client.perform("page", {
      url: wire.finalUrl,
      rootUrl: "https://source.example/",
      purpose: "page",
      maximumBytes: policy.htmlBytes,
      redirectLimit: 3,
    }, new AbortController().signal);
    assertEquals(page.ok, false);
  }
});
Deno.test("acquisition cancellation sends authenticated DELETE and waits for acknowledgement", async () => {
  /** @type {((response:Response)=>void)|undefined} */
  let finish;
  /** @type {Promise<Response>} */
  const pending = new Promise(
    /** @param {(r:Response)=>void} resolve */ (resolve) => {
      finish = resolve;
    },
  );
  /** @type {string[]} */
  const methods = [];
  const client = createAcquisitionClient({
    binding: {
      fetch: async (/** @type {Request} */ req) => {
        methods.push(req.method);
        if (req.method === "DELETE") {
          finish?.(Response.json({ ok: false, error: { kind: "Cancelled" } }));
          return Response.json({ ok: true, value: null });
        }
        return pending;
      },
    },
    endpoint: "https://service.test/",
    token: "fixture-token-a",
    policy,
    createId: () => "fixture-id-0000",
  });
  const c = new AbortController();
  const work = client.perform("request", {
    url: wire.finalUrl,
    rootUrl: "https://source.example/",
    purpose: "robots",
    maximumBytes: 100,
    redirectLimit: 0,
  }, c.signal);
  c.abort();
  const result = await work;
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error.kind, "Cancelled");
  assertEquals(methods, ["POST", "DELETE"]);
});
Deno.test("acquisition cancellation ends a non-cooperative POST only after explicit remote acknowledgement", async () => {
  let deleteCalled = false;
  const client = createAcquisitionClient({
    binding: {
      fetch: async (/** @type {Request} */ req) => {
        if (req.method === "POST") return new Promise(() => {});
        deleteCalled = true;
        return Response.json({ ok: true, value: null });
      },
    },
    endpoint: "https://service.test/",
    token: "fixture-token-a",
    policy,
    createId: () => "fixture-id-noncooperative",
  });
  const c = new AbortController();
  const pending = client.perform("request", {
    url: wire.finalUrl,
    rootUrl: "https://source.example/",
    purpose: "robots",
    maximumBytes: 100,
    redirectLimit: 0,
  }, c.signal);
  c.abort();
  let timer;
  const result = await Promise.race([
    pending,
    new Promise((resolve) => {
      timer = setTimeout(() => resolve("hung"), 100);
    }),
  ]);
  if (timer !== undefined) clearTimeout(timer);
  assertEquals(result === "hung", false);
  assertEquals(deleteCalled, true);
});
Deno.test("unavailable cancellation acknowledgement returns a named failure within its budget", async () => {
  const client = createAcquisitionClient({
    binding: { fetch: async () => new Promise(() => {}) },
    endpoint: "https://service.test/",
    token: "fixture-token-a",
    policy: { ...policy, requestMilliseconds: 20 },
    createId: () => "fixture-id-unconfirmed",
  });
  const c = new AbortController();
  const work = client.perform("request", {
    url: wire.finalUrl,
    rootUrl: "https://source.example/",
    purpose: "robots",
    maximumBytes: 100,
    redirectLimit: 0,
  }, c.signal);
  c.abort();
  let timer;
  const result = await Promise.race([
    work,
    new Promise((resolve) => {
      timer = setTimeout(() => resolve("hung"), 100);
    }),
  ]);
  if (timer !== undefined) clearTimeout(timer);
  assertEquals(result === "hung", false);
  if (
    typeof result === "object" && result !== null && "ok" in result &&
    !result.ok
  ) assertEquals(result.error.kind, "AcquisitionCancellationUnconfirmed");
});
