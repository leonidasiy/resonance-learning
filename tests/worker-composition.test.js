// @ts-check

import {
  createCloudflareDiscoveryWorker,
  deliverKnowledgeWorkflowControl,
  projectKnowledgeWorkflowExecution,
  reconcileKnowledgeWorkflowLaunch,
  YouTubeOAuthDurableObject,
  YouTubeQuotaDurableObject,
  workflowInstanceId,
  workflowControlRollback,
} from "../worker/main.js";

Deno.test("workflow launch recovery creates a missing binding exactly once and never restarts a completed run", async () => {
  /** @type {string[]} */ const calls = [];
  const binding = {
    async get() { calls.push("get"); throw new Error("not found"); },
    async create(/** @type {{ readonly id: string }} */ options) { calls.push(`create:${options.id}`); return { id: options.id, pause: async () => {}, resume: async () => {}, terminate: async () => {}, sendEvent: async () => {} }; },
  };
  const active = await reconcileKnowledgeWorkflowLaunch(binding, { runId: "knowledge-workflow:run-a", state: "source-added" }, { ownerId: "owner-a" }, true);
  assertEquals(active.ok, true);
  assertEquals(calls.join("|"), "get|create:knowledge-workflow-run-a");
  const completed = await reconcileKnowledgeWorkflowLaunch(binding, { runId: "knowledge-workflow:run-b", state: "completed" }, { ownerId: "owner-a" }, true);
  assertEquals(completed.ok, true);
  assertEquals(calls.join("|"), "get|create:knowledge-workflow-run-a");
});

Deno.test("workflow launch recovery returns a typed failure for malformed binding results and create failures", async () => {
  const malformed = await reconcileKnowledgeWorkflowLaunch({ get: async () => ({ id: "other", pause: async () => {}, resume: async () => {}, terminate: async () => {}, sendEvent: async () => {} }), create: async () => ({ id: "unused", pause: async () => {}, resume: async () => {}, terminate: async () => {}, sendEvent: async () => {} }) }, { runId: "knowledge-workflow:run-a", state: "source-added" }, { ownerId: "owner-a" }, true);
  assertEquals(malformed.ok, false);
  if (!malformed.ok) assertEquals(malformed.error.kind, "WorkflowStartFailed");
  const rejected = await reconcileKnowledgeWorkflowLaunch({ get: async () => { throw new Error("not found"); }, create: async () => { throw new Error("unavailable"); } }, { runId: "knowledge-workflow:run-a", state: "source-added" }, { ownerId: "owner-a" }, true);
  assertEquals(rejected.ok, false);
  if (!rejected.ok) assertEquals(rejected.error.kind, "WorkflowStartFailed");
  const statusRejected = await reconcileKnowledgeWorkflowLaunch({ get: async () => ({ id: "knowledge-workflow-run-a", pause: async () => {}, resume: async () => {}, terminate: async () => {}, sendEvent: async () => {}, status: async () => { throw new Error("unavailable"); } }), create: async () => ({ id: "unused", pause: async () => {}, resume: async () => {}, terminate: async () => {}, sendEvent: async () => {} }) }, { runId: "knowledge-workflow:run-a", state: "source-added" }, { ownerId: "owner-a" }, true);
  assertEquals(statusRejected.ok, false);
  if (!statusRejected.ok) assertEquals(statusRejected.error.kind, "WorkflowStartFailed");
});

/**
 * @typedef {{
 *   readonly sql: {
 *     readonly exec: (query: string, ...bindings: readonly (string | number)[]) => Iterable<{ readonly used: unknown }>,
 *   },
 *   readonly transactionSync: <T>(callback: () => T) => T,
 * }} TestQuotaStorage
 */

/** @template T @param {T} actual @param {T} expected */
function assertEquals(actual, expected) {
  if (!Object.is(actual, expected)) {
    throw new Error(
      `Expected ${String(expected)}, received ${String(actual)}.`,
    );
  }
}

/** @param {boolean} condition @param {string} message */
function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const now = new Date("2026-07-21T00:00:00.000Z");
const issuer = "https://team.cloudflareaccess.com";
const ownerEmail = "member@example.test";
const oauthScopes =
  "openid email https://www.googleapis.com/auth/youtube.readonly";
/** @param {{ readonly failWrites?: boolean, readonly events?: string[] }} [options] */
function authorizationLedger(options = {}) {
  /** @type {Set<string>} */
  const references = new Set();
  /** @type {Map<string, Record<string, unknown>>} */
  const authorizations = new Map();
  let writes = 0;
  const binding = {
    async fetch(
      /** @type {RequestInfo | URL} */ input,
      /** @type {RequestInit | undefined} */ init,
    ) {
      const path = new URL(String(input)).pathname;
      options.events?.push(path);
      const body = /** @type {unknown} */ (JSON.parse(String(init?.body)));
      if (!isRecord(body)) return new Response(null, { status: 400 });
      if (options.failWrites && path !== "/resolve") {
        return new Response(null, { status: 503 });
      }
      if (path === "/source-references") {
        writes += 1;
        if (
          typeof body.ownerId !== "string" || !Array.isArray(body.references)
        ) {
          return new Response(null, { status: 400 });
        }
        for (const reference of body.references) {
          if (isRecord(reference) && typeof reference.url === "string") {
            references.add(`${body.ownerId}|${reference.url}`);
          }
        }
        return new Response(JSON.stringify({ stored: body.references.length }));
      }
      if (path === "/authorizations") {
        if (
          typeof body.ownerId !== "string" ||
          typeof body.transcriptUrl !== "string" ||
          typeof body.evidenceId !== "string"
        ) {
          return new Response(null, { status: 400 });
        }
        if (!references.has(`${body.ownerId}|${body.transcriptUrl}`)) {
          return new Response(null, { status: 409 });
        }
        writes += 1;
        authorizations.set(
          `${body.ownerId}|${body.evidenceId}|${body.transcriptUrl}`,
          body,
        );
        return new Response(JSON.stringify({ stored: true }));
      }
      if (path === "/resolve") {
        const record = authorizations.get(
          `${body.ownerId}|${body.evidenceId}|${body.transcriptUrl}`,
        );
        return record
          ? new Response(JSON.stringify(record))
          : new Response(null, { status: 404 });
      }
      return new Response(null, { status: 404 });
    },
  };
  return { binding, writes: () => writes };
}

/** @param {{ readonly fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> }} quota @param {{ readonly fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> }} [authorization] */
function environment(quota, authorization = authorizationLedger().binding) {
  return {
    ALLOWED_ORIGIN: "https://app.example",
    ACCESS_ISSUER: issuer,
    ACCESS_AUDIENCE: "access-audience",
    ACCESS_OWNER_EMAIL: ownerEmail,
    ACCESS_OWNER_ID: "owner-a",
    TRANSCRIPT_LANGUAGES: "en,zh-Hant",
    YOUTUBE_SEARCH_DAILY_LIMIT: "100",
    YOUTUBE_GENERAL_DAILY_LIMIT: "10000",
    YOUTUBE_API_KEY: "server-only-youtube-api-key",
    YOUTUBE_QUOTA: quota,
    TRANSCRIPT_AUTHORIZATION: authorization,
  };
}

const keys = /** @type {CryptoKeyPair} */ (
  await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  )
);
const publicJwk = await crypto.subtle.exportKey("jwk", keys.publicKey);
const accessJwk = Object.freeze({ ...publicJwk, kid: "access-key-1" });

/** @param {unknown} value */
function base64UrlJson(value) {
  return base64Url(new TextEncoder().encode(JSON.stringify(value)));
}

/** @param {Uint8Array} bytes */
function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll(
    "=",
    "",
  );
}

/** @param {Partial<{ readonly aud: string, readonly email: string }>} [overrides] */
async function accessToken(overrides = {}) {
  const header = base64UrlJson({ alg: "RS256", kid: "access-key-1" });
  const claims = base64UrlJson({
    iss: issuer,
    aud: overrides.aud ?? "access-audience",
    exp: Math.floor(now.getTime() / 1_000) + 600,
    email: overrides.email ?? ownerEmail,
  });
  const signingInput = new TextEncoder().encode(`${header}.${claims}`);
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    keys.privateKey,
    signingInput,
  );
  return `${header}.${claims}.${base64Url(new Uint8Array(signature))}`;
}

/** @param {string} url @param {string} token @param {unknown} body */
function commandRequest(url, token, body) {
  return new Request(url, {
    method: "POST",
    headers: {
      "cf-access-jwt-assertion": token,
      "content-type": "application/json",
      origin: "https://app.example",
    },
    body: JSON.stringify(body),
  });
}

Deno.test("Missing YouTube configuration disables only YouTube", async () => {
  const result = createCloudflareDiscoveryWorker(
    {
      ...environment({ fetch: async () => new Response() }),
      YOUTUBE_API_KEY: undefined,
      YOUTUBE_QUOTA: undefined,
    },
    {
      fetch: /** @type {typeof fetch} */ (async (input) => {
        const url = String(input);
        if (url.endsWith("/cdn-cgi/access/certs")) {
          return Response.json({ keys: [accessJwk] });
        }
        throw new Error(`Unexpected outbound URL: ${url}`);
      }),
      now: () => now,
      subtle: crypto.subtle,
    },
  );
  assertEquals(result.ok, true);
  if (!result.ok) throw new Error(result.error.kind);
  const response = await result.value.fetch(new Request(
    "https://worker.example/api/discovery/search/capabilities",
    { headers: {
      "cf-access-jwt-assertion": await accessToken(),
      origin: "https://app.example",
    } },
  ));
  if (response.status !== 200) {
    throw new Error(`Expected capabilities, received ${response.status}: ${await response.text()}`);
  }
  const body = /** @type {Record<string,unknown>} */ (await response.json());
  const capabilities = /** @type {readonly Record<string,unknown>[]} */ (body.result);
  assertEquals(
    capabilities.find((provider) => provider.id === "youtube")?.enabled,
    false,
  );
});

Deno.test("Production composition exposes configured central providers and never invokes source assessment without query augmentation", async () => {
  /** @type {URL[]} */ const providerUrls = [];
  const result = createCloudflareDiscoveryWorker(
    {
      ...environment({ fetch: async () => new Response(JSON.stringify({ used: 1 })) }),
      OPENROUTER_API_KEY: "synthetic-model-key",
      BRAVE_SEARCH_API_KEY: "brave-server-secret",
      TADDY_USER_ID: "user-7",
      TADDY_API_KEY: "taddy-secret",
    },
    {
      fetch: /** @type {typeof fetch} */ (async (input, init) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith("/cdn-cgi/access/certs")) {
          return Response.json({ keys: [accessJwk] });
        }
        if (url.hostname === "openrouter.ai") throw new Error("Search must not invoke a model");
        providerUrls.push(url);
        assertEquals(
          new Headers(init?.headers).get("x-subscription-token"),
          "brave-server-secret",
        );
        return Response.json({
          web: { results: [{
            title: "Vocaloid tuning tutorial",
            url: "https://voice.example/guides/vocaloid",
            description: "A practical educational lesson.",
          }] },
        });
      }),
      now: () => now,
      subtle: crypto.subtle,
    },
  );
  assertEquals(result.ok, true);
  if (!result.ok) throw new Error(result.error.kind);
  const token = await accessToken();
  const capabilities = await result.value.fetch(new Request(
    "https://worker.example/api/discovery/search/capabilities",
    { headers: { "cf-access-jwt-assertion": token, origin: "https://app.example" } },
  ));
  assertEquals(capabilities.status, 200);
  const capabilitiesBody = /** @type {Record<string,unknown>} */ (await capabilities.json());
  const descriptors = /** @type {readonly Record<string,unknown>[]} */ (capabilitiesBody.result);
  assertEquals(JSON.stringify(descriptors.map((item) => item.id)), JSON.stringify(["web", "podcasts", "youtube"]));
  assertEquals(descriptors.every((item) => item.enabled === true), true);
  const searched = await result.value.fetch(commandRequest(
    "https://worker.example/api/discovery/search",
    token,
    { query: "  vocaloid  ", providerIds: ["web"], limit: 10 },
  ));
  assertEquals(searched.status, 200);
  assertEquals(providerUrls.length, 1);
  assertEquals(
    providerUrls[0].searchParams.get("q"),
    "vocaloid",
  );
  const searchedBody = /** @type {Record<string,unknown>} */ (await searched.json());
  const searchResult = /** @type {Record<string,unknown>} */ (searchedBody.result);
  assertEquals(searchResult.policyVersion, "raw-provider-v1");
});

Deno.test("Production composition advertises optional providers as disabled when their credentials are absent", async () => {
  const result = createCloudflareDiscoveryWorker(
    environment({ fetch: async () => new Response(JSON.stringify({ used: 1 })) }),
    {
      fetch: /** @type {typeof fetch} */ (async () => Response.json({ keys: [accessJwk] })),
      now: () => now,
      subtle: crypto.subtle,
    },
  );
  if (!result.ok) throw new Error(result.error.kind);
  const response = await result.value.fetch(new Request(
    "https://worker.example/api/discovery/search/capabilities",
    { headers: { "cf-access-jwt-assertion": await accessToken(), origin: "https://app.example" } },
  ));
  assertEquals(response.status, 200);
  const body = /** @type {Record<string,unknown>} */ (await response.json());
  const descriptors = /** @type {readonly Record<string,unknown>[]} */ (body.result);
  assertEquals(descriptors[0].id, "web");
  assertEquals(descriptors[0].enabled, false);
  assertEquals(descriptors[1].id, "podcasts");
  assertEquals(descriptors[1].enabled, false);
  assertEquals(descriptors[2].id, "youtube");
  assertEquals(descriptors[2].enabled, true);
});

Deno.test("Production composition rejects incomplete Taddy credentials field-specifically", () => {
  const missingKey = createCloudflareDiscoveryWorker(
    { ...environment({ fetch: async () => new Response(JSON.stringify({ used: 1 })) }), TADDY_USER_ID: "user-7" },
    { fetch, now: () => now, subtle: crypto.subtle },
  );
  assertEquals(missingKey.ok, false);
  if (missingKey.ok) throw new Error("Expected incomplete Taddy configuration failure.");
  assertEquals(missingKey.error.kind, "DiscoveryDeploymentConfigurationInvalid");
  assertEquals(missingKey.error.field, "TADDY_API_KEY");

  const missingUser = createCloudflareDiscoveryWorker(
    { ...environment({ fetch: async () => new Response(JSON.stringify({ used: 1 })) }), TADDY_API_KEY: "taddy-secret" },
    { fetch, now: () => now, subtle: crypto.subtle },
  );
  assertEquals(missingUser.ok, false);
  if (missingUser.ok) throw new Error("Expected incomplete Taddy configuration failure.");
  assertEquals(missingUser.error.kind, "DiscoveryDeploymentConfigurationInvalid");
  assertEquals(missingUser.error.field, "TADDY_USER_ID");
});

Deno.test("Production composition resolves one stable Durable Object stub", () => {
  const quota = {
    fetch: async () => new Response(JSON.stringify({ used: 101 })),
  };
  let resolvedName = "";
  const configured = environment(quota);
  const result = createCloudflareDiscoveryWorker(
    {
      ...configured,
      YOUTUBE_QUOTA: undefined,
      YOUTUBE_SEARCH_DAILY_LIMIT: "100",
      YOUTUBE_GENERAL_DAILY_LIMIT: "10000",
      YOUTUBE_QUOTA_LEDGER: {
        idFromName: (/** @type {string} */ name) => {
          resolvedName = name;
          return Object.freeze({ name });
        },
        get: () => quota,
      },
    },
    { fetch, now: () => now, subtle: crypto.subtle },
  );
  assertEquals(result.ok, true);
  assertEquals(resolvedName, "youtube-api-daily-quota");
});

Deno.test("Worker deployment routes outbound fetches through the public Internet", async () => {
  const configuration = await Deno.readTextFile(
    new URL("../wrangler.self-host.example.jsonc", import.meta.url),
  );
  const entry = await Deno.readTextFile(
    new URL("../worker/cloudflare-entry.mjs", import.meta.url),
  );
  assert(
    configuration.includes('"global_fetch_strictly_public"'),
    "Publisher fetches must not resolve through a private origin route.",
  );
  assert(
    configuration.includes('"workers_dev": true'),
    "The approved activation must serve from the exact workers.dev origin.",
  );
  assert(
    configuration.includes('"preview_urls": false'),
    "Private activation must not publish an additional preview URL.",
  );
  assert(
    configuration.includes('"directory": "./dist"'),
    "Workers Static Assets must publish only the production dist directory.",
  );
  assert(
    entry.includes("createUnifiedWorkerRouter") &&
      entry.includes("assets: environment.ASSETS"),
    "The entry module must route static assets before API composition.",
  );
  assert(
    entry.includes("YouTubeQuotaDurableObject") &&
      entry.includes("PublisherTranscriptAuthorizationDurableObject"),
    "The entry module must export every configured Durable Object class.",
  );
  assert(
    configuration.includes('"new_sqlite_classes"') &&
      configuration.includes('"YouTubeQuotaDurableObject"'),
    "Quota storage must use a same-Worker SQLite Durable Object migration.",
  );
  assert(
    configuration.includes('"name": "YOUTUBE_QUOTA_LEDGER"'),
    "The Worker must bind its quota Durable Object namespace.",
  );
  assert(
    configuration.includes('"binding": "SOURCE_LIBRARY_DB"') &&
      configuration.includes(
        '"database_id": "REPLACE_WITH_YOUR_D1_DATABASE_ID"',
      ) &&
      configuration.includes('"migrations_dir": "worker/migrations"'),
    "The template must require the user's D1 database and ordered migrations.",
  );
  assert(
    configuration.includes('"binding": "SOURCE_CONTENT_BUCKET"') &&
      configuration.includes(
        '"bucket_name": "my-resonance-content"',
      ),
    "The template must bind the user's private R2 bucket.",
  );
  assert(
    configuration.includes('"SOURCE_R2_STORED_BYTES_LIMIT": "8589934592"') &&
      configuration.includes('"SOURCE_R2_CLASS_A_MONTHLY_LIMIT": "100000"') &&
      configuration.includes('"SOURCE_R2_CLASS_B_MONTHLY_LIMIT": "1000000"'),
    "The deployment must inject the approved fail-closed R2 limits.",
  );
  assert(
    !configuration.includes("YOUTUBE_OAUTH") &&
      !configuration.includes("youtube.readonly"),
    "The deployed Worker must not bind OAuth storage or request YouTube scopes.",
  );
});

Deno.test("Cloudflare Access rejects before any outbound or quota request", async () => {
  let outboundCalls = 0;
  let quotaCalls = 0;
  const result = createCloudflareDiscoveryWorker(
    environment({
      fetch: async () => {
        quotaCalls += 1;
        return new Response(JSON.stringify({ used: 101 }));
      },
    }),
    {
      fetch: /** @type {typeof fetch} */ (async () => {
        outboundCalls += 1;
        return Response.error();
      }),
      now: () => now,
      subtle: crypto.subtle,
    },
  );
  if (!result.ok) throw new Error(result.error.kind);
  const response = await result.value.fetch(
    new Request("https://worker.example/api/discovery/search", {
      method: "POST",
      body: JSON.stringify({ query: "harmony", providerIds: ["youtube"], limit: 10 }),
    }),
  );
  assertEquals(response.status, 401);
  assertEquals(outboundCalls, 0);
  assertEquals(quotaCalls, 0);
});

Deno.test("source-library commands derive owner from Access and commit through D1", async () => {
  let d1Batches = 0;
  const d1 = {
    prepare: (/** @type {string} */ query) => {
      const statement = {
        /** @param {...(string | number | null)} _bindings */
        bind(..._bindings) {
          return statement;
        },
        first: async () =>
          query.includes("FROM interest_areas")
            ? { interest_area_id: "area-from-user-contract" }
            : null,
        run: async () => ({ success: true, meta: { changes: 1 } }),
        query,
      };
      return statement;
    },
    batch: async (/** @type {readonly unknown[]} */ statements) => {
      d1Batches += 1;
      return statements.map(() => ({ success: true, meta: { changes: 1 } }));
    },
  };
  const platformFetch =
    /** @type {typeof fetch} */ (async () =>
      new Response(JSON.stringify({ keys: [accessJwk] })));
  const result = createCloudflareDiscoveryWorker(
    {
      ...environment({
        fetch: async () => new Response(JSON.stringify({ used: 101 })),
      }),
      SOURCE_LIBRARY_DB: d1,
      SOURCE_INGESTION_POLICY_VERSION: "bounded-source-test-v1",
      SOURCE_CURSOR_SECRET: "test-source-cursor-secret-value-32",
    },
    {
      fetch: platformFetch,
      now: () => now,
      subtle: crypto.subtle,
      randomBytes: (length) => new Uint8Array(length).fill(9),
    },
  );
  if (!result.ok) throw new Error(result.error.kind);
  const approval = {
    submittedUrl: "https://publisher.example/learn?from=search",
    canonicalUrl: "https://publisher.example/learn",
    title: "Learning source",
    description: "Attributed source description.",
    identityStatus: "resolved",
    identityEvidence: [{
      attribute: "canonical-link",
      value: "https://publisher.example/learn",
      provenanceUrl: "https://publisher.example/learn",
      observedAt: now.toISOString(),
    }],
    adapter: {
      id: "adapter-from-registry",
      version: "1",
      granularity: "evidence-resolved",
      capabilities: ["metadata"],
    },
    interestAreaIds: ["area-from-user-contract"],
    idempotencyKey: "approve-source-1",
  };
  const response = await result.value.fetch(commandRequest(
    "https://worker.example/api/source-library/approve",
    await accessToken(),
    approval,
  ));
  assertEquals(response.status, 200);
  const document = await response.json();
  assertEquals(document.ownerId, "owner-a");
  assertEquals(document.result.source.ownerId, "owner-a");
  assertEquals(d1Batches, 1);

  const clientOwner = await result.value.fetch(commandRequest(
    "https://worker.example/api/source-library/approve",
    await accessToken(),
    { ...approval, ownerId: "owner-b", idempotencyKey: "approve-source-2" },
  ));
  assertEquals(clientOwner.status, 400);
  assertEquals(d1Batches, 1);
});

Deno.test("source-library Access rejection occurs before D1 work", async () => {
  let d1Calls = 0;
  const result = createCloudflareDiscoveryWorker(
    {
      ...environment({ fetch: async () => new Response() }),
      SOURCE_LIBRARY_DB: {
        prepare: () => {
          d1Calls += 1;
          throw new Error("D1 must not run.");
        },
        batch: async () => {
          d1Calls += 1;
          return [];
        },
      },
      SOURCE_INGESTION_POLICY_VERSION: "bounded-source-test-v1",
      SOURCE_CURSOR_SECRET: "test-source-cursor-secret-value-32",
    },
    {
      fetch: async () => Response.error(),
      now: () => now,
      subtle: crypto.subtle,
      randomBytes: (length) => new Uint8Array(length),
    },
  );
  if (!result.ok) throw new Error(result.error.kind);
  const response = await result.value.fetch(
    new Request("https://worker.example/api/source-library/approve", {
      method: "POST",
      body: "{}",
    }),
  );
  assertEquals(response.status, 401);
  assertEquals(d1Calls, 0);
});

Deno.test("enabled knowledge workflow receives the persisted run identifier in its start payload", async () => {
  /** @type {unknown[]} */
  const starts = [];
  const d1 = {
    prepare: (/** @type {string} */ query) => {
      const statement = {
        /** @param {...(string | number | null)} _bindings */
        bind(..._bindings) { return statement; },
        first: async () => query.includes("FROM interest_areas") ? { interest_area_id: "area-from-user-contract" } : null,
        all: async () => ({ success: true, results: [] }),
        run: async () => ({ success: true, meta: { changes: 1 } }),
      };
      return statement;
    },
    batch: async (/** @type {readonly unknown[]} */ statements) => statements.map(() => ({ success: true, meta: { changes: 1 } })),
  };
  const workflow = {
    async create(/** @type {{ readonly id: string, readonly params: unknown }} */ options) { starts.push(options); return { id: options.id, pause: async () => {}, resume: async () => {}, terminate: async () => {}, sendEvent: async () => {} }; },
    async get(/** @type {string} */ id) { return { id, pause: async () => {}, resume: async () => {}, terminate: async () => {}, sendEvent: async () => {} }; },
  };
  const result = createCloudflareDiscoveryWorker({
    ...environment({ fetch: async () => new Response(JSON.stringify({ used: 1 })) }),
    SOURCE_LIBRARY_DB: d1,
    SOURCE_INGESTION_POLICY_VERSION: "bounded-source-test-v1",
    SOURCE_CURSOR_SECRET: "test-source-cursor-secret-value-32",
    KNOWLEDGE_WORKFLOW: workflow,
    KNOWLEDGE_WORKFLOW_ENABLED: "true",
    KNOWLEDGE_WORKFLOW_CONFIG_DIGESTS: JSON.stringify({
      "rights-assessor": "sha256:0527746e185e451dad9f7b0e4ea038829b1314d85472846045c072392a4c8da8",
      "knowledge-scraper": "sha256:6c872bf81db03d74bc35de5f52d2d0479f1761ba41887fc2457227e071377e72",
      "question-generator": "sha256:d6e4dee53367eed2e6f8de4b5e83d2ce3edbddf6a476473290dd2cd7b8ad8d82",
      "question-evaluator": "sha256:0debcf2680759d5e626c8e3b959cf6a49a562b94de4cecb5f64ad81876f85d2c",
    }),
  }, {
    fetch: /** @type {typeof fetch} */ (async () => Response.json({ keys: [accessJwk] })),
    now: () => now,
    subtle: crypto.subtle,
    randomBytes: (length) => new Uint8Array(length).fill(7),
  });
  if (!result.ok) throw new Error(`${result.error.kind}:${result.error.field}`);
  const response = await result.value.fetch(commandRequest(
    "https://worker.example/api/source-library/approve",
    await accessToken(),
    {
      submittedUrl: "https://publisher.example/learn",
      canonicalUrl: "https://publisher.example/learn",
      title: "Learning source",
      description: "Attributed source description.",
      identityStatus: "resolved",
      identityEvidence: [{ attribute: "canonical-link", value: "https://publisher.example/learn", provenanceUrl: "https://publisher.example/learn", observedAt: now.toISOString() }],
      adapter: { id: "adapter-from-registry", version: "1", granularity: "evidence-resolved", capabilities: ["metadata"] },
      interestAreaIds: ["area-from-user-contract"],
      idempotencyKey: "workflow-source-approve-1",
    },
  ));
  assertEquals(response.status, 200);
  assertEquals(starts.length, 1);
  const options = /** @type {{ readonly id: string, readonly params: Record<string, unknown> }} */ (starts[0]);
  assertEquals(options.id, workflowInstanceId(/** @type {string} */ (options.params.runId)));
  assertEquals(options.params.ownerId, "owner-a");
});

Deno.test("retryable workflow control delivers the event to a waiting instance", async () => {
  /** @type {string[]} */ const calls = [];
  await deliverKnowledgeWorkflowControl({
    pause: async () => { calls.push("pause"); },
    resume: async () => { calls.push("resume"); },
    sendEvent: async (event) => { calls.push(`event:${JSON.stringify(event)}`); },
    terminate: async () => { calls.push("terminate"); },
  }, "resume");
  assertEquals(calls.join("|"), 'event:{"type":"workflow-control","payload":{"action":"resume"}}');
});

Deno.test("paused workflow controls resume even when the event queue accepts delivery", async () => {
  for (const action of ["resume", "retry-quizzes"]) {
    /** @type {string[]} */ const calls = [];
    let status = "paused";
    await deliverKnowledgeWorkflowControl({
      status: async () => ({ status }),
      resume: async () => { calls.push("resume"); status = "running"; },
      sendEvent: async () => { calls.push("event"); },
    }, action);
    assertEquals(status, "running");
    assertEquals(calls.join("|"), "resume|event");
  }
});

Deno.test("active database runs expose a paused platform instance as recoverable", async () => {
  /** @type {import("../src/features/knowledge-workflows/workflow.js").KnowledgeWorkflowRun} */
  const run = {
    ownerId: "owner-a", runId: "run-a", sourceId: "source-a", sourceRevision: 1,
    canonicalSourceIdentity: "https://example.test", contentSignature: "signature",
    state: "extraction-loop", revision: 2, idempotencyKey: "start-a", configDigests: {},
    extractionStartedAt: null, extractionDeadlineAt: null, decisionRequired: null,
    counts: { pages: 18, knowledgePoints: 68, acceptedQuizzes: 65, pendingQuizzes: 0 },
    failureKind: null, reused: false, createdAt: now.toISOString(), updatedAt: now.toISOString(),
  };
  const binding = {
    get: async () => ({ id: "run-a", status: async () => ({ status: "paused" }), pause: async () => {}, resume: async () => {}, sendEvent: async () => {}, terminate: async () => {} }),
    create: async () => { throw new Error("Recovery must use the existing instance"); },
  };
  const projected = await projectKnowledgeWorkflowExecution(run, binding);
  assertEquals(projected.ok, true);
  if (!projected.ok) throw new Error(projected.error.kind);
  assertEquals(projected.value.state, "retryable-failure");
  assertEquals(projected.value.retryState, "extraction-loop");
  assertEquals(projected.value.failureKind, "WorkflowExecutionStopped");
  assertEquals(projected.value.counts, run.counts);
  const paused = { ...run, state: /** @type {const} */ ("paused") };
  const preserved = await projectKnowledgeWorkflowExecution(paused, binding);
  assertEquals(preserved.ok && preserved.value, paused);
});

Deno.test("workflow control falls back to resume after direct event delivery is rejected", async () => {
  /** @type {string[]} */ const calls = [];
  let directEvents = 0;
  await deliverKnowledgeWorkflowControl({
    resume: async () => { calls.push("resume"); },
    sendEvent: async (event) => {
      calls.push(`event:${JSON.stringify(event)}`);
      directEvents += 1;
      if (directEvents <= 3) {
        throw new Error("workflow is paused");
      }
    },
  }, "resume");
  assertEquals(calls.join("|"), 'event:{"type":"workflow-control","payload":{"action":"resume"}}|event:{"type":"workflow-control","payload":{"action":"resume"}}|event:{"type":"workflow-control","payload":{"action":"resume"}}|resume|event:{"type":"workflow-control","payload":{"action":"resume"}}');
});

Deno.test("workflow control propagates a non-Error event failure", async () => {
  let events = 0;
  let failed = false;
  try {
    await deliverKnowledgeWorkflowControl({
      resume: async () => { throw new Error("resume must not run"); },
      sendEvent: async () => { events += 1; throw "invalid-event-failure"; },
    }, "resume");
  } catch (error) {
    failed = error === "invalid-event-failure";
  }
  assertEquals(failed, true);
  assertEquals(events, 1);
});

Deno.test("workflow control rejects an invalid action without touching the instance", async () => {
  let calls = 0;
  let failed = false;
  try {
    await deliverKnowledgeWorkflowControl({ resume: async () => { calls += 1; } }, "invalid-action");
  } catch (error) {
    failed = error instanceof TypeError;
  }
  assertEquals(failed, true);
  assertEquals(calls, 0);
});

Deno.test("failed retry control produces an owner-scoped rollback at the new revision", () => {
  const rollback = workflowControlRollback(
    { action: "resume" },
    { ok: true, value: { ownerId: "owner-a", runId: "run-a", state: "retryable-failure", revision: 5, failureKind: "KnowledgePageFetchFailed" } },
    { ok: true, value: { ownerId: "owner-a", runId: "run-a", state: "extraction-loop", revision: 6 } },
  );
  assertEquals(JSON.stringify(rollback), JSON.stringify({ ownerId: "owner-a", runId: "run-a", expectedRevision: 6, nextState: "retryable-failure", failureKind: "KnowledgePageFetchFailed" }));
  const quizRollback=workflowControlRollback({action:"resume"},{ok:true,value:{ownerId:"owner-a",runId:"run-a",state:"retryable-failure",retryState:"per-point-quiz-loop",failureKind:"WorkflowQuizFailed"}},{ok:true,value:{state:"per-point-quiz-loop",revision:9}});
  assertEquals(JSON.stringify(quizRollback),JSON.stringify({ownerId:"owner-a",runId:"run-a",expectedRevision:9,nextState:"retryable-failure",failureKind:"WorkflowQuizFailed"}));
});

Deno.test("configured Browser Run composition reaches the authoritative job repository", async () => {
  let jobReads = 0;
  const d1 = {
    prepare: (/** @type {string} */ query) => {
      const statement = {
        /** @param {...(string | number | null)} _bindings */
        bind(..._bindings) {
          return statement;
        },
        first: async () => {
          if (query.startsWith("SELECT j.job_id")) jobReads += 1;
          return null;
        },
        all: async () => ({ success: true, results: [] }),
        run: async () => ({ success: true, meta: { changes: 1 } }),
      };
      return statement;
    },
    batch: async (/** @type {readonly unknown[]} */ statements) =>
      statements.map(() => ({ success: true, meta: { changes: 1 } })),
  };
  const bucket = { put: async () => null, get: async () => null, delete: async () => undefined };
  const result = createCloudflareDiscoveryWorker(
    {
      ...environment({
        fetch: async () => new Response(JSON.stringify({ used: 1 })),
      }),
      SOURCE_LIBRARY_DB: d1,
      SOURCE_INGESTION_POLICY_VERSION: "browser-run-source-test-v1",
      SOURCE_CURSOR_SECRET: "test-source-cursor-secret-value-32",
      SOURCE_CONTENT_BUCKET: bucket,
      SOURCE_MANUAL_MAX_BYTES: "1048576",
      SOURCE_MANUAL_MAX_CHARACTERS: "250000",
      SOURCE_MANUAL_MEDIA_TYPES: "text/plain,text/markdown",
      SOURCE_R2_ACCOUNT_SCOPE: "free-account-r2",
      SOURCE_R2_STORED_BYTES_LIMIT: "8589934592",
      SOURCE_R2_CLASS_A_MONTHLY_LIMIT: "100000",
      SOURCE_R2_CLASS_B_MONTHLY_LIMIT: "1000000",
      SOURCE_R2_OBSERVATION_MAX_AGE_MS: "86400000",
      SOURCE_BROWSER: {},
      SOURCE_BROWSER_ACCOUNT_SCOPE: "free-account-test",
    },
    {
      fetch:
        /** @type {typeof fetch} */ (async () =>
          new Response(JSON.stringify({ keys: [accessJwk] }))),
      now: () => now,
      subtle: crypto.subtle,
      randomBytes: (length) => new Uint8Array(length).fill(4),
      browserLauncher: {
        limits: async () => ({
          activeSessions: [],
          allowedBrowserAcquisitions: 1,
          maxConcurrentSessions: 1,
          timeUntilNextAllowedBrowserAcquisition: 0,
        }),
        launch: async () => {
          throw new Error("A missing job must not launch Browser Run.");
        },
      },
    },
  );
  if (!result.ok) throw new Error(`${result.error.kind}:${result.error.field}`);
  const response = await result.value.fetch(commandRequest(
    "https://worker.example/api/source-library/ingestion/run",
    await accessToken(),
    { jobId: "missing-job" },
  ));
  assertEquals(response.status, 400);
  assertEquals((await response.json()).error, "IngestionJobNotFound");
  assertEquals(jobReads, 1);
});

Deno.test("Browser Run binding configuration fails explicitly when incomplete", () => {
  const result = createCloudflareDiscoveryWorker(
    {
      ...environment({ fetch: async () => new Response() }),
      SOURCE_BROWSER: {},
    },
    { fetch, now: () => now, subtle: crypto.subtle },
  );
  if (result.ok) {
    throw new Error("Expected incomplete Browser Run configuration failure.");
  }
  assertEquals(result.error.kind, "DiscoveryDeploymentConfigurationMissing");
  assertEquals(result.error.field, "SOURCE_LIBRARY_DB");
});

Deno.test("R2 binding requires the complete fail-closed capacity policy", () => {
  const result = createCloudflareDiscoveryWorker(
    {
      ...environment({ fetch: async () => new Response() }),
      SOURCE_LIBRARY_DB: {
        prepare: () => ({
          bind() {
            return this;
          },
          run: async () => ({ success: true }),
          first: async () => null,
        }),
        batch: async () => [],
      },
      SOURCE_CONTENT_BUCKET: {
        put: async () => {},
        delete: async () => {},
      },
      SOURCE_MANUAL_MAX_BYTES: "1048576",
      SOURCE_MANUAL_MAX_CHARACTERS: "250000",
      SOURCE_MANUAL_MEDIA_TYPES: "text/plain",
    },
    { fetch, now: () => now, subtle: crypto.subtle },
  );
  if (result.ok) {
    throw new Error("Expected incomplete R2 capacity configuration.");
  }
  assertEquals(result.error.kind, "DiscoveryDeploymentConfigurationMissing");
  assertEquals(result.error.field, "SOURCE_R2_ACCOUNT_SCOPE");
});

Deno.test("Worker exposes no YouTube OAuth routes", async () => {
  /** @type {Record<string, unknown> | null} */
  let transaction = null;
  /** @type {Record<string, unknown> | null} */
  let consumedTransaction = null;
  /** @type {Record<string, unknown> | null} */
  let connection = null;
  const oauthStore = {
    async fetch(
      /** @type {RequestInfo | URL} */ input,
      /** @type {RequestInit | undefined} */ init,
    ) {
      const path = new URL(String(input)).pathname;
      const body = init?.body === undefined
        ? null
        : /** @type {unknown} */ (JSON.parse(String(init.body)));
      if (
        path === "/transactions" && init?.method === "PUT" && isRecord(body)
      ) {
        transaction = body;
        return new Response(null, { status: 204 });
      }
      if (
        path === "/transactions/consume" && init?.method === "POST" &&
        isRecord(body) && transaction !== null &&
        body.stateDigest === transaction.stateDigest &&
        body.ownerId === transaction.ownerId
      ) {
        const consumed = transaction;
        consumedTransaction = consumed;
        transaction = null;
        return new Response(JSON.stringify(consumed));
      }
      if (path === "/connections" && init?.method === "PUT" && isRecord(body)) {
        connection = body;
        return new Response(null, { status: 204 });
      }
      return new Response(null, { status: 404 });
    },
  };
  const googleJwk = Object.freeze({ ...accessJwk, kid: "google-key-1" });
  const platformFetch = /** @type {typeof fetch} */ (async (input) => {
    const url = String(input);
    if (url.endsWith("/cdn-cgi/access/certs")) {
      return new Response(JSON.stringify({ keys: [accessJwk] }));
    }
    if (url === "https://oauth2.googleapis.com/token") {
      if (
        consumedTransaction === null ||
        typeof consumedTransaction.nonce !== "string"
      ) {
        return new Response(null, { status: 400 });
      }
      const header = base64UrlJson({ alg: "RS256", kid: "google-key-1" });
      const claims = base64UrlJson({
        iss: "https://accounts.google.com",
        aud: "youtube-client.apps.googleusercontent.com",
        exp: Math.floor(now.getTime() / 1_000) + 600,
        sub: "google-user-a",
        email: ownerEmail,
        email_verified: true,
        nonce: consumedTransaction.nonce,
      });
      const signature = await crypto.subtle.sign(
        "RSASSA-PKCS1-v1_5",
        keys.privateKey,
        new TextEncoder().encode(`${header}.${claims}`),
      );
      return new Response(JSON.stringify({
        access_token: "youtube-access-token",
        expires_in: 3600,
        token_type: "Bearer",
        refresh_token: "provider-refresh-token",
        id_token: `${header}.${claims}.${base64Url(new Uint8Array(signature))}`,
        scope: oauthScopes,
      }));
    }
    if (url === "https://www.googleapis.com/oauth2/v3/certs") {
      return new Response(JSON.stringify({ keys: [googleJwk] }));
    }
    throw new Error(`Unexpected OAuth URL: ${url}`);
  });
  const result = createCloudflareDiscoveryWorker(
    {
      ...environment({ fetch: async () => new Response() }),
      YOUTUBE_OAUTH_STORE: oauthStore,
    },
    {
      fetch: platformFetch,
      now: () => now,
      subtle: crypto.subtle,
      randomBytes: (length) => new Uint8Array(length).fill(11),
    },
  );
  if (!result.ok) throw new Error(result.error.kind);
  const token = await accessToken();
  const started = await result.value.fetch(commandRequest(
    "https://worker.example/api/discovery/youtube/oauth/start",
    token,
    {},
  ));
  assertEquals(started.status, 404);
  assertEquals(transaction, null);
  assertEquals(connection, null);
  return;
  // Legacy callback fixtures below remain temporarily for the export/delete
  // migration unit and are unreachable from production composition.
  // @ts-ignore Unreachable legacy fixture retained until migration verification.
  const authorization = new URL(String(started.headers.get("location")));
  assertEquals(authorization.origin, "https://accounts.google.com");
  const state = authorization.searchParams.get("state");
  assert(state !== null, "Expected an OAuth state value.");
  // @ts-ignore Unreachable legacy fixture retained until migration verification.
  const callback = await result.value.fetch(
    new Request(
      `https://worker.example/api/discovery/youtube/oauth/callback?state=${
        encodeURIComponent(String(state))
      }&code=authorization-code`,
      { headers: { "cf-access-jwt-assertion": token } },
    ),
  );
  assertEquals(callback.status, 303);
  assertEquals(
    callback.headers.get("location"),
    "https://app.example/?youtube=connected#discover",
  );
  assert(connection !== null, "Expected an encrypted connection record.");
  assert(
    !JSON.stringify(connection).includes("provider-refresh-token"),
    "Refresh token must be encrypted before persistence.",
  );
});

Deno.test("YouTube composition reserves durable quota before official metadata calls", async () => {
  /** @type {string[]} */
  const events = [];
  const quota = {
    fetch: async (
      /** @type {RequestInfo | URL} */ _input,
      /** @type {RequestInit | undefined} */ init,
    ) => {
      events.push("quota");
      const command = /** @type {unknown} */ (JSON.parse(String(init?.body)));
      assert(isRecord(command), "Expected a quota reservation command.");
      if (!isRecord(command)) return new Response(null, { status: 400 });
      const expected = events.filter((event) => event === "quota").length === 1
        ? { bucket: "search", quotaDay: "2026-07-20", units: 1 }
        : { bucket: "general", quotaDay: "2026-07-20", units: 1 };
      assertEquals(JSON.stringify(command), JSON.stringify(expected));
      return new Response(JSON.stringify({ used: 1 }));
    },
  };
  const platformFetch = /** @type {typeof fetch} */ (async (input) => {
    const url = String(input);
    if (url.endsWith("/cdn-cgi/access/certs")) {
      events.push("access-key");
      return new Response(JSON.stringify({ keys: [accessJwk] }));
    }
    if (url === "https://oauth2.googleapis.com/token") {
      events.push("oauth-refresh");
      return new Response(JSON.stringify({
        access_token: "youtube-access-token",
        expires_in: 3600,
        token_type: "Bearer",
        scope: oauthScopes,
      }));
    }
    if (url === "https://openrouter.ai/api/v1/chat/completions") {
      throw new Error("Link-only search must not invoke a model");
    }
    if (url.includes("/youtube/v3/search")) {
      events.push("youtube-search");
      return new Response(JSON.stringify({
        items: [{
          id: { videoId: "video-1" },
          snippet: {
            title: "Harmony tutorial",
            channelTitle: "Publisher",
            publishedAt: "2026-07-01T00:00:00Z",
            description: "Worked examples of functional harmony",
          },
        }],
      }));
    }
    if (url.includes("/youtube/v3/videos")) {
      events.push("youtube-status");
      return new Response(JSON.stringify({
        items: [{
          id: "video-1",
          status: { embeddable: true, madeForKids: false },
        }],
      }));
    }
    throw new Error(`Unexpected outbound URL: ${url}`);
  });
  const result = createCloudflareDiscoveryWorker(
    {...environment(quota), OPENROUTER_API_KEY:"synthetic-model-key"},
    {
      fetch: platformFetch,
      now: () => now,
      subtle: crypto.subtle,
      randomBytes: (length) => new Uint8Array(length).fill(9),
    },
  );
  if (!result.ok) throw new Error(result.error.kind);
  const response = await result.value.fetch(commandRequest(
    "https://worker.example/api/discovery/search",
    await accessToken(),
    { query: "music harmony", providerIds: ["youtube"], limit: 10 },
  ));
  assertEquals(response.status, 200);
  assertEquals(
    events.join(","),
    "access-key,quota,youtube-search,quota,youtube-status",
  );
  const body = /** @type {unknown} */ (await response.json());
  assert(isRecord(body) && isRecord(body.result), "Expected a result envelope.");
  if (isRecord(body) && isRecord(body.result) && Array.isArray(body.result.items)) {
    const candidate = body.result.items[0];
    assert(isRecord(candidate), "Expected a YouTube candidate.");
    if (isRecord(candidate)) assertEquals(candidate.description, "Worked examples of functional harmony");
  }
  assert(
    events.every((event) =>
      !event.includes("caption") && !event.includes("media")
    ),
    "YouTube media and captions must not be requested.",
  );
});

Deno.test("Rejected durable quota prevents every YouTube API request", async () => {
  /** @type {string[]} */
  const outbound = [];
  const platformFetch = /** @type {typeof fetch} */ (async (input) => {
    const url = String(input);
    outbound.push(url);
    if (url.endsWith("/cdn-cgi/access/certs")) {
      return new Response(JSON.stringify({ keys: [accessJwk] }));
    }
    if (url === "https://oauth2.googleapis.com/token") {
      return new Response(JSON.stringify({
        access_token: "youtube-access-token",
        expires_in: 3600,
        token_type: "Bearer",
        scope: oauthScopes,
      }));
    }
    throw new Error(`YouTube must not be called after quota rejection: ${url}`);
  });
  const result = createCloudflareDiscoveryWorker(
    environment({ fetch: async () => new Response(null, { status: 429 }) }),
    {
      fetch: platformFetch,
      now: () => now,
      subtle: crypto.subtle,
      randomBytes: (length) => new Uint8Array(length).fill(9),
    },
  );
  if (!result.ok) throw new Error(result.error.kind);
  const response = await result.value.fetch(commandRequest(
    "https://worker.example/api/discovery/search",
    await accessToken(),
    { query: "music harmony", providerIds: ["youtube"], limit: 10 },
  ));
  assertEquals(response.status, 429);
  assertEquals(outbound.length, 1);
  assertEquals(
    outbound[0],
    "https://team.cloudflareaccess.com/cdn-cgi/access/certs",
  );
});

Deno.test("Publisher transcript requires an observed RSS reference and separately persisted owner rights", async () => {
  /** @type {string[]} */
  const events = [];
  const ledger = authorizationLedger({ events });
  const platformFetch = /** @type {typeof fetch} */ (async (input) => {
    const url = String(input);
    if (url.endsWith("/cdn-cgi/access/certs")) {
      events.push("access-key");
      return new Response(JSON.stringify({ keys: [accessJwk] }));
    }
    if (url === "https://publisher.example/feed.xml") {
      events.push("rss-fetch");
      return new Response(
        `<?xml version="1.0"?><rss version="2.0" xmlns:podcast="https://podcastindex.org/namespace/1.0"><channel><title>Publisher</title><link>https://publisher.example/</link><item><guid isPermaLink="false">episode-1</guid><title>Episode</title><link>https://publisher.example/episode</link><podcast:transcript url="https://publisher.example/transcript.txt" type="text/plain" language="en"/><enclosure url="https://publisher.example/audio.mp3" type="audio/mpeg" length="123"/></item></channel></rss>`,
        { headers: { "content-type": "application/rss+xml" } },
      );
    }
    events.push("publisher-transcript");
    return new Response("Preparation creates directed dissonance.", {
      headers: { "content-type": "text/plain" },
    });
  });
  const result = createCloudflareDiscoveryWorker(
    environment(
      { fetch: async () => new Response(JSON.stringify({ used: 101 })) },
      ledger.binding,
    ),
    { fetch: platformFetch, now: () => now, subtle: crypto.subtle },
  );
  if (!result.ok) throw new Error(result.error.kind);
  const token = await accessToken();
  const acquired = await result.value.fetch(commandRequest(
    "https://worker.example/api/discovery/rss",
    token,
    {
      sourceUrl: "https://publisher.example/feed.xml",
      requestId: "rss-request-1",
      etag: null,
      lastModified: null,
    },
  ));
  assertEquals(acquired.status, 200);
  const authorized = await result.value.fetch(commandRequest(
    "https://worker.example/api/discovery/publisher-transcript/authorize",
    token,
    {
      evidenceId: "rights-1",
      transcriptUrl: "https://publisher.example/transcript.txt",
      attributionText: "Publisher transcript",
      evidenceBasis: "Publisher license",
      evidenceReference: "https://publisher.example/license",
      expiresAt: "2027-07-21T00:00:00.000Z",
    },
  ));
  assertEquals(authorized.status, 201);
  const response = await result.value.fetch(commandRequest(
    "https://worker.example/api/discovery/publisher-transcript",
    token,
    {
      requestId: "transcript-request-1",
      transcriptUrl: "https://publisher.example/transcript.txt",
      evidenceId: "rights-1",
      language: "en",
      jsonTextPath: null,
      retention: { mode: "plain-text" },
    },
  ));
  assertEquals(response.status, 200);
  assert(
    events.indexOf("/source-references") < events.indexOf("/authorizations") &&
      events.indexOf("/authorizations") < events.indexOf("/resolve") &&
      events.indexOf("/resolve") < events.indexOf("publisher-transcript"),
    "Source and rights records must persist before outbound transcript fetch.",
  );
  const text = await response.text();
  assert(
    text.includes("Preparation creates directed dissonance."),
    "Expected retained transcript text.",
  );
});

Deno.test("Missing, wrong-owner, mismatched, failed, expired, and denied rights never fetch or write transcript data", async () => {
  const cases = [
    { name: "missing", resolveStatus: 404, expected: 404, record: null },
    { name: "wrong-owner", resolveStatus: 404, expected: 404, record: null },
    { name: "mismatched-url", resolveStatus: 409, expected: 409, record: null },
    {
      name: "persistence-failure",
      resolveStatus: 503,
      expected: 503,
      record: null,
    },
    {
      name: "expired",
      resolveStatus: 200,
      expected: 400,
      record: {
        access: "allowed",
        storage: "allowed",
        display: "allowed",
        transformation: "allowed",
        attribution: "allowed",
        expiresAt: "2026-07-20T00:00:00.000Z",
      },
    },
    {
      name: "denied",
      resolveStatus: 200,
      expected: 403,
      record: {
        access: "allowed",
        storage: "denied",
        display: "allowed",
        transformation: "allowed",
        attribution: "allowed",
        expiresAt: "2027-07-21T00:00:00.000Z",
      },
    },
  ];
  for (const testCase of cases) {
    let transcriptFetches = 0;
    let writes = 0;
    const binding = {
      async fetch(
        /** @type {RequestInfo | URL} */ input,
        /** @type {RequestInit | undefined} */ init,
      ) {
        const path = new URL(String(input)).pathname;
        if (path !== "/resolve") writes += 1;
        if (testCase.resolveStatus !== 200) {
          return new Response(null, { status: testCase.resolveStatus });
        }
        const body = /** @type {Record<string, unknown>} */ (JSON.parse(
          String(init?.body),
        ));
        return new Response(JSON.stringify({
          evidenceId: body.evidenceId,
          transcriptUrl: body.transcriptUrl,
          attributionText: "Publisher transcript",
          ...testCase.record,
        }));
      },
    };
    const result = createCloudflareDiscoveryWorker(
      environment(
        { fetch: async () => new Response(JSON.stringify({ used: 101 })) },
        binding,
      ),
      {
        fetch: /** @type {typeof fetch} */ (async (input) => {
          if (String(input).endsWith("/cdn-cgi/access/certs")) {
            return new Response(JSON.stringify({ keys: [accessJwk] }));
          }
          transcriptFetches += 1;
          return new Response("must not fetch");
        }),
        now: () => now,
        subtle: crypto.subtle,
      },
    );
    if (!result.ok) throw new Error(result.error.kind);
    const response = await result.value.fetch(commandRequest(
      "https://worker.example/api/discovery/publisher-transcript",
      await accessToken(),
      {
        requestId: `request-${testCase.name}`,
        transcriptUrl: "https://publisher.example/transcript.txt",
        evidenceId: "rights-1",
        language: "en",
        jsonTextPath: null,
        retention: { mode: "plain-text" },
      },
    ));
    assertEquals(response.status, testCase.expected);
    assertEquals(transcriptFetches, 0);
    assertEquals(writes, 0);
  }
});

Deno.test("Retrieval rejects request-supplied allowed claims before rights lookup", async () => {
  let ledgerCalls = 0;
  let transcriptFetches = 0;
  const result = createCloudflareDiscoveryWorker(
    environment(
      { fetch: async () => new Response(JSON.stringify({ used: 101 })) },
      {
        fetch: async () => {
          ledgerCalls += 1;
          return new Response(null, { status: 500 });
        },
      },
    ),
    {
      fetch: /** @type {typeof fetch} */ (async (input) => {
        if (String(input).endsWith("/cdn-cgi/access/certs")) {
          return new Response(JSON.stringify({ keys: [accessJwk] }));
        }
        transcriptFetches += 1;
        return new Response("must not fetch");
      }),
      now: () => now,
      subtle: crypto.subtle,
    },
  );
  if (!result.ok) throw new Error(result.error.kind);
  const response = await result.value.fetch(commandRequest(
    "https://worker.example/api/discovery/publisher-transcript",
    await accessToken(),
    {
      requestId: "literal-rights",
      transcriptUrl: "https://publisher.example/transcript.txt",
      evidenceId: "rights-1",
      language: "en",
      rights: {
        storage: "allowed",
        display: "allowed",
        transformation: "allowed",
        attribution: "allowed",
      },
      jsonTextPath: null,
      retention: { mode: "plain-text" },
    },
  ));
  assertEquals(response.status, 400);
  assertEquals(ledgerCalls, 0);
  assertEquals(transcriptFetches, 0);
});

Deno.test("Caption and media routes remain absent after Access authentication", async () => {
  /** @type {string[]} */
  const outbound = [];
  const platformFetch = /** @type {typeof fetch} */ (async (input) => {
    const url = String(input);
    outbound.push(url);
    return new Response(JSON.stringify({ keys: [accessJwk] }));
  });
  const result = createCloudflareDiscoveryWorker(
    environment({
      fetch: async () => new Response(JSON.stringify({ used: 101 })),
    }),
    { fetch: platformFetch, now: () => now, subtle: crypto.subtle },
  );
  if (!result.ok) throw new Error(result.error.kind);
  for (const path of ["captions", "media"]) {
    const response = await result.value.fetch(commandRequest(
      `https://worker.example/api/discovery/youtube/${path}`,
      await accessToken(),
      {},
    ));
    assertEquals(response.status, 404);
  }
  assertEquals(outbound.length, 2);
  assert(
    outbound.every((url) => url.endsWith("/cdn-cgi/access/certs")),
    "Only Access keys may be fetched.",
  );
});

Deno.test("SQLite quota object validates route and exact command contract", async () => {
  const fixture = quotaStorageFixture();
  const ledger = new YouTubeQuotaDurableObject(
    { storage: fixture.storage },
    { YOUTUBE_SEARCH_DAILY_LIMIT: "2", YOUTUBE_GENERAL_DAILY_LIMIT: "202" },
  );
  const wrongPath = await ledger.fetch(
    new Request("https://quota.internal/unknown", {
      method: "POST",
      body: "{}",
    }),
  );
  assertEquals(wrongPath.status, 404);
  const wrongMethod = await ledger.fetch(
    new Request("https://quota.internal/reservations"),
  );
  assertEquals(wrongMethod.status, 405);
  const invalidCommands = [
    "{",
    JSON.stringify({}),
    JSON.stringify({ bucket: "unknown", quotaDay: "2026-07-21", units: 1 }),
    JSON.stringify({ bucket: "search", quotaDay: "2026-02-30", units: 1 }),
    JSON.stringify({ bucket: "search", quotaDay: "2026-07-21", units: 0 }),
    JSON.stringify({
      bucket: "search",
      quotaDay: "2026-07-21",
      units: 1,
      unknown: true,
    }),
  ];
  for (const body of invalidCommands) {
    const response = await ledger.fetch(
      new Request(
        "https://quota.internal/reservations",
        { method: "POST", body },
      ),
    );
    assertEquals(response.status, 400);
  }
  assertEquals(fixture.transactionCount(), 0);
});

Deno.test("OAuth Durable Object consumes owner-bound state exactly once", async () => {
  /** @type {Map<string, unknown>} */
  const records = new Map();
  const storage = {
    get: (/** @type {string} */ key) => Promise.resolve(records.get(key)),
    put: (/** @type {string} */ key, /** @type {unknown} */ value) => {
      records.set(key, value);
      return Promise.resolve();
    },
    delete: (/** @type {string} */ key) => Promise.resolve(records.delete(key)),
    /** @template T @param {(transaction: { get: (key: string) => Promise<unknown>, delete: (key: string) => Promise<boolean> }) => Promise<T>} callback @returns {Promise<T>} */
    async transaction(callback) {
      return await callback({ get: storage.get, delete: storage.delete });
    },
  };
  const ledger = new YouTubeOAuthDurableObject({ storage });
  const transaction = {
    ownerId: "owner-a",
    stateDigest: "state-digest",
    codeVerifier: "code-verifier",
    nonce: "nonce",
    expiresAt: "2026-07-21T00:10:00.000Z",
  };
  const saved = await ledger.fetch(
    new Request("https://oauth.internal/transactions", {
      method: "PUT",
      body: JSON.stringify(transaction),
    }),
  );
  assertEquals(saved.status, 204);
  const consume = (/** @type {string} */ ownerId) =>
    ledger.fetch(
      new Request("https://oauth.internal/transactions/consume", {
        method: "POST",
        body: JSON.stringify({ ownerId, stateDigest: "state-digest" }),
      }),
    );
  assertEquals((await consume("owner-b")).status, 409);
  assertEquals((await consume("owner-a")).status, 200);
  assertEquals((await consume("owner-a")).status, 404);
});

Deno.test("SQLite quota object reserves an exact daily limit atomically", async () => {
  const fixture = quotaStorageFixture();
  const ledger = new YouTubeQuotaDurableObject(
    { storage: fixture.storage },
    { YOUTUBE_SEARCH_DAILY_LIMIT: "2", YOUTUBE_GENERAL_DAILY_LIMIT: "202" },
  );
  const reserve = (
    /** @type {"search" | "general"} */ bucket,
    /** @type {string} */ quotaDay,
    /** @type {number} */ units,
  ) =>
    ledger.fetch(
      new Request(
        "https://quota.internal/reservations",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ bucket, quotaDay, units }),
        },
      ),
    );
  const first = await reserve("general", "2026-07-21", 101);
  const second = await reserve("general", "2026-07-21", 101);
  const exceeded = await reserve("general", "2026-07-21", 1);
  const separateBucket = await reserve("search", "2026-07-21", 1);
  const nextDay = await reserve("general", "2026-07-22", 1);
  assertEquals(first.status, 200);
  assertEquals(second.status, 200);
  assertEquals(exceeded.status, 429);
  assertEquals(separateBucket.status, 200);
  assertEquals(nextDay.status, 200);
  assertEquals(await first.text(), JSON.stringify({ used: 101 }));
  assertEquals(await second.text(), JSON.stringify({ used: 202 }));
  assertEquals(await nextDay.text(), JSON.stringify({ used: 1 }));
  assertEquals(fixture.usage.get("2026-07-21|general"), 202);
  assertEquals(fixture.usage.get("2026-07-21|search"), 1);
  assertEquals(fixture.usage.get("2026-07-22|general"), 1);
  assertEquals(fixture.transactionCount(), 5);
});

function quotaStorageFixture() {
  /** @type {Map<string, number>} */
  const usage = new Map();
  let transactions = 0;
  /** @type {TestQuotaStorage} */
  const storage = {
    sql: {
      exec(query, ...bindings) {
        if (query.startsWith("CREATE TABLE")) return [];
        if (query.startsWith("SELECT used")) {
          const quotaDay = bindings[0];
          const bucket = bindings[1];
          if (typeof quotaDay !== "string" || typeof bucket !== "string") {
            throw new TypeError("Expected quota key bindings.");
          }
          const used = usage.get(`${quotaDay}|${bucket}`);
          return used === undefined ? [] : [{ used }];
        }
        if (query.startsWith("INSERT INTO daily_quota")) {
          const quotaDay = bindings[0];
          const bucket = bindings[1];
          const used = bindings[2];
          if (
            typeof quotaDay !== "string" || typeof bucket !== "string" ||
            typeof used !== "number"
          ) {
            throw new TypeError("Expected quota upsert bindings.");
          }
          usage.set(`${quotaDay}|${bucket}`, used);
          return [];
        }
        throw new TypeError(`Unexpected SQL statement: ${query}`);
      },
    },
    transactionSync(callback) {
      transactions += 1;
      return callback();
    },
  };
  return Object.freeze({
    storage,
    usage,
    transactionCount: () => transactions,
  });
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

Deno.test("abandon terminates without rolling back preexisting shared data",async()=>{
  let rollback;
  await deliverKnowledgeWorkflowControl({terminate:async options=>{rollback=options?.rollback;}},"abandon");
  assertEquals(rollback,false);
});

Deno.test("concurrent launch duplicate creation verifies and reuses the winning platform instance",async()=>{
 const instances=new Map();
 const binding={get:async(/** @type {string} */id)=>{const instance=instances.get(id);if(!instance)throw new Error("not found");return instance;},create:async(/** @type {{id:string}} */ options)=>{await Promise.resolve();if(instances.has(options.id))throw new Error("duplicate instance");const instance={id:options.id,pause:async()=>{},resume:async()=>{},terminate:async()=>{},sendEvent:async()=>{},status:async()=>({status:"running"})};instances.set(options.id,instance);return instance;}};
 const results=await Promise.all([reconcileKnowledgeWorkflowLaunch(binding,{runId:"same-attempt",state:"source-added"},{},false),reconcileKnowledgeWorkflowLaunch(binding,{runId:"same-attempt",state:"source-added"},{},true)]);
 assertEquals(results.every(result=>result.ok),true);assertEquals(instances.size,1);
});

Deno.test("approved completed partial workflows restart without delivering events to the completed instance",async()=>{
 /** @type {string[]} */ const calls=[];
 for(const action of ["resume","retry-quizzes"]){
 calls.length=0;
 await deliverKnowledgeWorkflowControl({restart:async()=>{calls.push("restart");},sendEvent:async()=>{calls.push("event");},resume:async()=>{calls.push("resume");}},action,true);
 assertEquals(calls.join(","),"restart");
 }
 const rollback=workflowControlRollback({action:"retry-quizzes"},{ok:true,value:{ownerId:"owner-a",runId:"run-a",state:"completed",failureKind:"WorkflowQuizItemsFailed"}},{ok:true,value:{state:"per-point-quiz-loop",revision:7}});
 assertEquals(JSON.stringify(rollback),JSON.stringify({ownerId:"owner-a",runId:"run-a",expectedRevision:7,nextState:"retryable-failure",failureKind:"WorkflowRetryFailedQuizzes"}));
 const pages=workflowControlRollback({action:"resume"},{ok:true,value:{ownerId:"owner-a",runId:"run-a",state:"completed",failureKind:"WorkflowQuizItemsFailed"}},{ok:true,value:{state:"extraction-loop",revision:7}});
 assertEquals(pages?.failureKind,"WorkflowRetryFailedPages");
 let rejected=false;try{await deliverKnowledgeWorkflowControl({},"resume",true);}catch(error){rejected=error instanceof TypeError;}
 assertEquals(rejected,true);
});

Deno.test("retry restarts an errored platform instance instead of sending an unusable event", async () => {
  /** @type {string[]} */ const calls = [];
  await deliverKnowledgeWorkflowControl({
    status: async () => ({status:"errored"}),
    restart: async () => {calls.push("restart");},
    resume: async () => {throw new Error("An errored instance cannot be resumed");},
    sendEvent: async () => {throw new Error("An errored instance cannot receive events");},
  }, "resume");
  assertEquals(calls.join(","), "restart");
});
