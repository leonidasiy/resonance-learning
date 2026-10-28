// @ts-check

import { createBraveSearchProvider } from "../worker/brave-search-adapter.js";
import { createTaddySearchProvider } from "../worker/taddy-search-adapter.js";
import { createYouTubeSearchProvider } from "../worker/youtube-search-provider.js";

/** @template T @param {T} actual @param {T} expected */
function equal(actual, expected) {
  if (!Object.is(actual, expected)) {
    throw new Error(`Expected ${String(expected)}, received ${String(actual)}.`);
  }
}

const command = Object.freeze({
  providerId: "web",
  query: "vocal technique tutorial lesson course educational",
  limit: 8,
});

Deno.test("Brave provider preserves exact distinct same-host material URLs", async () => {
  /** @type {URL|null} */ let requestedUrl = null;
  /** @type {Headers|null} */ let requestedHeaders = null;
  const provider = createBraveSearchProvider(
    {
      providerId: "web",
      label: "Web",
      resultKind: "web",
      priority: 1,
      enabled: true,
      maximumResults: 20,
      apiVersion: "2023-10-11",
    },
    {
      credential: () => ({ ok: true, value: "brave-secret" }),
      fetch: async (input, init) => {
        requestedUrl = new URL(String(input));
        requestedHeaders = new Headers(init?.headers);
        return Response.json({
          web: {
            results: [{
              title: "Credential-bearing result is not eligible",
              url: "https://user:secret@blocked.example/article",
              description: "Do not forward credentials to assessment.",
            }, {
              title: "Fragment-bearing result is not eligible",
              url: "https://blocked.example/article#preview",
            }, {
              title: "Insecure result is not eligible",
              url: "http://legacy.example/tutorial",
              description: "A legacy result without transport security.",
            }, {
              title: "Singing lessons for healthy technique",
              url: "https://voice.example/articles/breath-support?ref=search",
              description: "A practical tutorial for vocalists.",
            }, {
              title: "Duplicate singing course",
              url: "https://voice.example/courses/foundations",
              description: "Educational course material.",
            }],
          },
        });
      },
    },
  );
  const result = await provider.search(command);
  equal(result.ok, true);
  if (!result.ok || requestedUrl === null || requestedHeaders === null) return;
  const braveUrl = /** @type {URL} */ (requestedUrl);
  const braveHeaders = /** @type {Headers} */ (requestedHeaders);
  equal(braveUrl.searchParams.get("q"), command.query);
  equal(braveUrl.searchParams.get("count"), "8");
  equal(braveUrl.searchParams.get("safesearch"), "strict");
  equal(braveHeaders.get("x-subscription-token"), "brave-secret");
  equal(result.value.length, 2);
  equal(result.value[0].canonicalUrl, "https://voice.example/articles/breath-support?ref=search");
  equal(result.value[1].canonicalUrl, "https://voice.example/courses/foundations");
  equal(result.value[0].sourceLevel, "document");
  equal(
    result.value[0].identityEvidence[0].provenanceUrl,
    "https://voice.example/articles/breath-support?ref=search",
  );
});

Deno.test("Web source results exclude YouTube URLs on initial and continued searches", async () => {
  const excluded = [
    "https://youtube.com/watch?v=instruments",
    "https://www.youtube.com/watch?v=instruments",
    "https://m.youtube.com/watch?v=instruments",
    "https://www.youtube.com/shorts/instruments",
    "https://youtu.be/instruments",
    "https://www.youtube-nocookie.com/embed/instruments",
    "https://WWW.YOUTUBE.COM./watch?v=instruments",
  ];
  const retained = [
    "https://music.example/instruments",
    "https://music.example/about-youtube",
    "https://youtube.com.example/instruments",
    "https://notyoutube.com/instruments",
  ];
  const provider = createBraveSearchProvider(
    { providerId: "web", label: "Web", resultKind: "web", priority: 1, enabled: true, maximumResults: 20, apiVersion: "2023-10-11" },
    {
      credential: () => ({ ok: true, value: "fixture" }),
      fetch: async () => Response.json({
        query: { more_results_available: true },
        web: { results: [...excluded, ...retained].map(url => ({ title: "Musical instruments — YouTube", url })) },
      }),
    },
  );
  for (const cursor of [undefined, "1:20"]) {
    const result = await provider.search({ ...command, limit: 20, ...(cursor === undefined ? {} : { cursor }) });
    equal(result.ok, true);
    if (!result.ok) throw new Error(result.error.kind);
    equal(JSON.stringify(result.value.map(item => item.canonicalUrl)), JSON.stringify(retained));
    equal(result.nextCursor, cursor === undefined ? "1:20" : "2:20");
  }
});

Deno.test("Brave provider reports credential, quota, and document failures", async () => {
  const missing = createBraveSearchProvider(
    {
      providerId: "web",
      label: "Web",
      resultKind: "web",
      priority: 1,
      enabled: false,
      maximumResults: 20,
      apiVersion: "2023-10-11",
    },
    {
      credential: () => ({
        ok: false,
        error: { kind: "SearchProviderCredentialMissing" },
      }),
      fetch,
    },
  );
  const missingResult = await missing.search(command);
  equal(missingResult.ok, false);
  if (!missingResult.ok) {
    equal(missingResult.error.kind, "SearchProviderCredentialMissing");
  }
  const quota = createBraveSearchProvider(
    { providerId: missing.descriptor.id, label: missing.descriptor.label, resultKind: missing.descriptor.resultKind, priority: missing.descriptor.priority, enabled: true, maximumResults: 20, apiVersion: "2023-10-11" },
    {
      credential: () => ({ ok: true, value: "secret" }),
      fetch: async () => new Response(null, { status: 429 }),
    },
  );
  const quotaResult = await quota.search(command);
  equal(quotaResult.ok, false);
  if (!quotaResult.ok) equal(quotaResult.error.kind, "SearchProviderQuotaExceeded");
  const invalid = createBraveSearchProvider(
    { providerId: missing.descriptor.id, label: missing.descriptor.label, resultKind: missing.descriptor.resultKind, priority: missing.descriptor.priority, enabled: true, maximumResults: 20, apiVersion: "2023-10-11" },
    {
      credential: () => ({ ok: true, value: "secret" }),
      fetch: async () => Response.json({ web: { results: [{}] } }),
    },
  );
  const invalidResult = await invalid.search(command);
  equal(invalidResult.ok, false);
  if (!invalidResult.ok) equal(invalidResult.error.kind, "SearchProviderResponseInvalid");
});

Deno.test("Taddy provider searches once and safety-checks the bounded batch once", async () => {
  /** @type {URL[]} */ const requestedUrls = [];
  /** @type {Headers[]} */ const requestedHeaders = [];
  /** @type {unknown[]} */ const requestedBodies = [];
  const provider = createTaddySearchProvider(
    {
      providerId: "podcasts",
      label: "Podcasts",
      resultKind: "podcast",
      priority: 2,
      enabled: true,
      maximumResults: 6,
      timeoutMs: 5_000,
    },
    {
      credentials: () => ({
        ok: true,
        value: { userId: "user-7", apiKey: "taddy-secret" },
      }),
      timeoutSignal: () => new AbortController().signal,
      fetch: async (input, init) => {
        requestedUrls.push(new URL(String(input)));
        requestedHeaders.push(new Headers(init?.headers));
        requestedBodies.push(JSON.parse(String(init?.body)));
        if (requestedBodies.length % 2 === 1) return Response.json({ data: { searchForTerm: {
            searchId: "search-1",
            podcastSeries: [{
              uuid: "6bdfd429-f58b-427d-8072-353d478aa15f",
              websiteUrl: null,
            }],
            rankingDetails: [{ uuid: "6bdfd429-f58b-427d-8072-353d478aa15f", rankingScore: 0.875 }],
        } } });
        return Response.json({ data: { getMultiplePodcastSeries: [{
          uuid: "6bdfd429-f58b-427d-8072-353d478aa15f",
          name: "Song Exploder lessons",
          description: "Artists explain harmony and arrangement with worked examples",
          authorName: "Song Exploder",
          websiteUrl: "https://publisher.example/show",
          rssUrl: "https://feeds.example/song-exploder.xml",
          isBlocked: null,
          feedRefreshDetails: {
            uuid: "9f9d9083-e718-47cd-b7f1-62abdd18d270",
            priority: "HIGH",
            priorityReason: null,
            dateLastRefreshed: 1785242096,
          },
        }] } });
      },
    },
  );
  const result = await provider.search({ ...command, providerId: "podcasts" });
  equal(result.ok, true);
  if (!result.ok) return;
  equal(requestedUrls.length, 2);
  equal(requestedUrls.every((url) => url.href === "https://api.taddy.org/"), true);
  equal(requestedHeaders.every((headers) => headers.get("x-user-id") === "user-7"), true);
  equal(requestedHeaders.every((headers) => headers.get("x-api-key") === "taddy-secret"), true);
  equal(requestedHeaders.every((headers) => headers.get("content-type") === "application/json"), true);
  const body = /** @type {Record<string,unknown>} */ (requestedBodies[0]);
  const detailsBody = /** @type {Record<string,unknown>} */ (requestedBodies[1]);
  equal(body.variables, undefined);
  equal(detailsBody.variables, undefined);
  const query = String(body.query);
  const detailsQuery = String(detailsBody.query);
  const compactQuery = query.replaceAll(/\s+/g, "");
  const compactDetailsQuery = detailsQuery.replaceAll(/\s+/g, "");
  equal(compactQuery.startsWith("{searchForTerm("), true);
  equal(query.includes(`term:${JSON.stringify(command.query)}`), true);
  equal(compactQuery.includes("limitPerPage:6"), true);
  equal(compactQuery.includes("searchForTerm("), true);
  equal(compactQuery.includes("filterForTypes:PODCASTSERIES"), true);
  equal(compactQuery.includes("isSafeMode:true"), true);
  equal(query.includes("podcastEpisodes"), false);
  equal(query.includes("audioUrl"), false);
  equal(query.includes("imageUrl"), false);
  equal(query.includes("transcript"), false);
  equal(query.includes("page:1"), true);
  equal(query.includes("searchResultsBoostType:"), false);
  equal(query.includes("includeSearchOperator:OR"), true);
  equal(query.includes("isBlocked"), false);
  equal(query.includes("feedRefreshDetails"), false);
  equal(query.includes("rankingDetails"), true);
  equal(query.includes("rankingDetails{id uuid rankingScore}"), true);
  equal(query.includes("searchId"), true);
  equal(query.includes("description"), true);
  equal(query.includes("websiteUrl"), true);
  equal(query.includes("authorName"), true);
  equal(detailsQuery.includes("getMultiplePodcastSeries"), true);
  equal(detailsQuery.includes("getMultiplePodcastSeries"), true);
  equal(detailsQuery.includes(JSON.stringify("6bdfd429-f58b-427d-8072-353d478aa15f")), true);
  equal(detailsQuery.includes("description"), true);
  equal(detailsQuery.includes("authorName"), true);
  equal(detailsQuery.includes("websiteUrl"), true);
  equal(detailsQuery.includes("isBlocked"), true);
  equal(detailsQuery.includes("feedRefreshDetails"), true);
  const paged = await provider.search({...command,providerId:"podcasts",limit:1});
  equal(paged.ok,true);
  if (paged.ok) {
    equal(paged.nextCursor,"2:1");
    const next = await provider.search({...command,providerId:"podcasts",cursor:paged.nextCursor});
    equal(next.ok,true);
    const nextQuery = String(/** @type {{query:string}} */ (requestedBodies[4]).query);
    equal(nextQuery.includes("page:2"),true);
    equal(nextQuery.includes("limitPerPage:1"),true);
  }

  equal(compactDetailsQuery.endsWith("}}}"), true);
  equal(compactDetailsQuery.endsWith("}}}}"), false);
  equal(result.value[0].canonicalUrl, "https://feeds.example/song-exploder.xml");
  equal(result.value[0].sourceLevel, "feed");
  equal(result.value[0].description, "Artists explain harmony and arrangement with worked examples");
  equal(result.value[0].publisherLabel, "Song Exploder");
  equal(result.value[0].identityEvidence.some((entry) => entry.attribute === "taddy-series-uuid"), true);
  equal(result.value[0].identityEvidence.some((entry) => entry.attribute === "podcast-feed"), true);
  equal(result.value[0].identityEvidence.find(entry=>entry.attribute==="taddy-publisher-website")?.value,"https://publisher.example/show");
});

Deno.test("Taddy provider maps transport and GraphQL failures distinctly", async () => {
  const configuration = {
    providerId: "podcasts",
    label: "Podcasts",
    resultKind: "podcast",
    priority: 2,
    enabled: true,
    maximumResults: 20,
    timeoutMs: 5_000,
  };
  const credentials = () => ({
    ok: /** @type {const} */ (true),
    value: { userId: "user-7", apiKey: "secret" },
  });
  const cases = [
    ["SearchProviderCredentialMissing", () => createTaddySearchProvider(configuration, {
      credentials: () => ({ ok: false, error: { kind: /** @type {const} */ ("SearchProviderCredentialMissing") } }),
      timeoutSignal: () => new AbortController().signal,
      fetch,
    })],
    ["SearchProviderCredentialRejected", () => createTaddySearchProvider(configuration, {
      credentials, timeoutSignal: () => new AbortController().signal,
      fetch: async () => new Response(null, { status: 401 }),
    })],
    ["SearchProviderQuotaExceeded", () => createTaddySearchProvider(configuration, {
      credentials, timeoutSignal: () => new AbortController().signal,
      fetch: async () => new Response(null, { status: 429 }),
    })],
    ["SearchProviderUpstreamRejected", () => createTaddySearchProvider(configuration, {
      credentials, timeoutSignal: () => new AbortController().signal,
      fetch: async () => new Response(null, { status: 502 }),
    })],
    ["SearchProviderNetworkFailed", () => createTaddySearchProvider(configuration, {
      credentials, timeoutSignal: () => new AbortController().signal,
      fetch: async () => { throw new TypeError("network unavailable"); },
    })],
    ["SearchProviderTimedOut", () => createTaddySearchProvider(configuration, {
      credentials, timeoutSignal: () => AbortSignal.abort(new DOMException("timed out", "TimeoutError")),
      fetch: async (_input, init) => { throw init?.signal?.reason; },
    })],
    ["SearchProviderInputInvalid", () => createTaddySearchProvider(configuration, {
      credentials, timeoutSignal: () => new AbortController().signal,
      fetch: async () => Response.json({ errors: [{ code: "BAD_USER_INPUT", message: "invalid" }], data: { searchForTerm: null } }),
    })],
    ["SearchProviderQueryInvalid", () => createTaddySearchProvider(configuration, {
      credentials, timeoutSignal: () => new AbortController().signal,
      fetch: async () => Response.json({ errors: [{ code: "INVALID_QUERY_OR_SYNTAX", message: "Cannot query field on this type" }] }),
    })],
    ["SearchProviderCredentialRejected", () => createTaddySearchProvider(configuration, {
      credentials, timeoutSignal: () => new AbortController().signal,
      fetch: async () => Response.json({ errors: [{ code: "API_KEY_INVALID", message: "invalid key" }] }),
    })],
    ["SearchProviderCredentialRejected", () => createTaddySearchProvider(configuration, {
      credentials, timeoutSignal: () => new AbortController().signal,
      fetch: async () => Response.json({ errors: [{ code: "API_KEY_INVALID", message: "invalid key" }] }, { status: 500 }),
    })],
    ["SearchProviderQuotaExceeded", () => createTaddySearchProvider(configuration, {
      credentials, timeoutSignal: () => new AbortController().signal,
      fetch: async () => Response.json({ errors: [{ code: "API_RATE_LIMIT_EXCEEDED", message: "quota" }] }),
    })],
    ["SearchProviderResponseInvalid", () => createTaddySearchProvider(configuration, {
      credentials, timeoutSignal: () => new AbortController().signal,
      fetch: async () => new Response("not-json", { headers: { "content-type": "application/json" } }),
    })],
  ];
  for (const [expected, create] of cases) {
    const result = await /** @type {()=>ReturnType<typeof createTaddySearchProvider>} */ (create)()
      .search({ ...command, providerId: "podcasts" });
    equal(result.ok, false);
    if (!result.ok) equal(result.error.kind, expected);
  }
});

Deno.test("Taddy provider fails closed for blocked, private, duplicate, invalid, or missing feeds", async () => {
  const configuration = { providerId: "podcasts", label: "Podcasts", resultKind: "podcast", priority: 2, enabled: true, maximumResults: 20, timeoutMs: 5_000 };
  const series = {
    uuid: "6bdfd429-f58b-427d-8072-353d478aa15f",
    name: "Music course",
    rssUrl: "https://feeds.example/show.xml",
    isBlocked: false,
    feedRefreshDetails: { uuid: "9f9d9083-e718-47cd-b7f1-62abdd18d270", priority: "REGULAR", priorityReason: null, dateLastRefreshed: 1785242096 },
  };
  const cases = [
    ["SearchProviderFeedBlocked", { ...series, isBlocked: true }],
    ["SearchProviderFeedPrivate", { ...series, feedRefreshDetails: { ...series.feedRefreshDetails, priority: "NEVER", priorityReason: "PRIVATE_PODCAST_FEED" } }],
    ["SearchProviderFeedDuplicate", { ...series, feedRefreshDetails: { ...series.feedRefreshDetails, priority: "LOW", priorityReason: "DUPLICATE_FEED" } }],
    ["SearchProviderFeedInvalid", { ...series, feedRefreshDetails: { ...series.feedRefreshDetails, priority: "LOW", priorityReason: "FEED_URL_NOT_WORKING" } }],
    ["SearchProviderFeedInvalid", { ...series, rssUrl: "http://feeds.example/show.xml" }],
    ["SearchProviderFeedMissing", { ...series, rssUrl: null }],
  ];
  for (const [expected, item] of cases) {
    const provider = createTaddySearchProvider(configuration, {
      credentials: () => ({ ok: true, value: { userId: "user-7", apiKey: "secret" } }),
      timeoutSignal: () => new AbortController().signal,
      fetch: async (_input, init) => String(init?.body).includes("getMultiplePodcastSeries")
        ? Response.json({ data: { getMultiplePodcastSeries: [item] } })
        : Response.json({ data: { searchForTerm: {
          podcastSeries: [{ uuid: series.uuid }],
          rankingDetails: [{ uuid: series.uuid, rankingScore: 0.5 }],
        } } }),
    });
    const result = await provider.search({ ...command, providerId: "podcasts" });
    equal(result.ok, false);
    if (!result.ok) equal(result.error.kind, expected);
  }
});

Deno.test("Taddy provider classifies query diagnostics without retaining provider messages", async () => {
  const provider = createTaddySearchProvider(
    { providerId: "podcasts", label: "Podcasts", resultKind: "podcast", priority: 2, enabled: true, maximumResults: 20, timeoutMs: 5_000 },
    {
      credentials: () => ({ ok: true, value: { userId: "user-7", apiKey: "secret" } }),
      timeoutSignal: () => new AbortController().signal,
      fetch: async () => Response.json({ errors: [{ code: "INVALID_QUERY_OR_SYNTAX", message: "Cannot query field private-field on type Query" }] }),
    },
  );
  const result = await provider.search({ ...command, providerId: "podcasts" });
  equal(result.ok, false);
  if (!result.ok) {
    equal(result.error.kind, "SearchProviderQueryInvalid");
    equal("reason" in result.error ? result.error.reason : null, "field");
    equal("diagnosticTokens" in result.error ? JSON.stringify(result.error.diagnosticTokens) : null, JSON.stringify(["search", "query", "field"]));
    equal(JSON.stringify(result.error).includes("private-field"), false);
  }
});

Deno.test("Taddy provider rejects a malformed mixed batch atomically", async () => {
  const provider = createTaddySearchProvider(
    { providerId: "podcasts", label: "Podcasts", resultKind: "podcast", priority: 2, enabled: true, maximumResults: 20, timeoutMs: 5_000 },
    {
      credentials: () => ({ ok: true, value: { userId: "user-7", apiKey: "secret" } }),
      timeoutSignal: () => new AbortController().signal,
      fetch: async () => Response.json({ data: { searchForTerm: {
        podcastSeries: [{
          uuid: "6bdfd429-f58b-427d-8072-353d478aa15f", name: "Valid lesson",
          rssUrl: "https://feeds.example/valid.xml",
          isBlocked: false,
          feedRefreshDetails: { uuid: "9f9d9083-e718-47cd-b7f1-62abdd18d270", priority: "REGULAR", priorityReason: null, dateLastRefreshed: 1785242096 },
        }, { uuid: "not-a-uuid" }],
        rankingDetails: [{ uuid: "6bdfd429-f58b-427d-8072-353d478aa15f", rankingScore: 0.5 }],
      } } }),
    },
  );
  const result = await provider.search({ ...command, providerId: "podcasts" });
  equal(result.ok, false);
  if (!result.ok) equal(result.error.kind, "SearchProviderResponseInvalid");
});

Deno.test("YouTube provider forwards the centralized query without modifying it", async () => {
  /** @type {unknown} */ let received = null;
  const provider = createYouTubeSearchProvider(
    {
      providerId: "youtube",
      label: "YouTube videos",
      resultKind: "video",
      priority: 3,
      enabled: true,
    },
    {
      adapter: {
        search: async (input) => {
          received = input;
          return {
            ok: /** @type {const} */ (true),
            value: [{
              videoId: "video-1",
              description: "Worked examples of phrasing and pitch control",
              channelId: "channel-1",
              title: "Vocaloid tuning tutorial",
              publisherLabel: "Music Teacher",
              publishedAt: "2026-07-01T00:00:00.000Z",
              canonicalUrl: "https://www.youtube.com/watch?v=video-1",
              embedUrl: "https://www.youtube-nocookie.com/embed/video-1",
              madeForKids: false,
              refreshBy: "2026-08-01T00:00:00.000Z",
            }],
          };
        },
      },
    },
  );
  const result = await provider.search({ ...command, providerId: "youtube" });
  equal(JSON.stringify(received), JSON.stringify({ query: command.query, limit: command.limit }));
  equal(result.ok, true);
  if (!result.ok) return;
  equal(result.value[0].description, "Worked examples of phrasing and pitch control");
  equal(result.value[0].identityEvidence.some(entry => entry.attribute === "youtube-channel-id" && entry.value === "channel-1"), true);
  equal(result.value[0].sourceLevel, "video");
  equal(result.value[0].canonicalUrl, "https://www.youtube.com/watch?v=video-1");
});

Deno.test("YouTube provider maps quota and response failures", async () => {
  const create = (/** @type {string} */ kind) => createYouTubeSearchProvider(
    {
      providerId: "youtube",
      label: "YouTube videos",
      resultKind: "video",
      priority: 3,
      enabled: true,
    },
    { adapter: { search: async () => ({ ok: false, error: { kind } }) } },
  );
  const quota = await create("YouTubeProviderQuotaExceeded").search({
    ...command,
    providerId: "youtube",
  });
  equal(quota.ok, false);
  if (!quota.ok) equal(quota.error.kind, "SearchProviderQuotaExceeded");
  const invalid = await create("YouTubeResponseInvalid").search({
    ...command,
    providerId: "youtube",
  });
  equal(invalid.ok, false);
  if (!invalid.ok) equal(invalid.error.kind, "SearchProviderResponseInvalid");
});

Deno.test("Taddy retains search order and original fields when detail hydration is reversed", async () => {
 const ids=["6bdfd429-f58b-427d-8072-353d478aa15f","7bdfd429-f58b-427d-8072-353d478aa15f"];
 let requests=0;
 const provider=createTaddySearchProvider({providerId:"podcasts",label:"Podcasts",resultKind:"podcast",priority:2,enabled:true,maximumResults:6,timeoutMs:5000},{credentials:()=>({ok:true,value:{userId:"fixture",apiKey:"fixture"}}),timeoutSignal:()=>new AbortController().signal,fetch:async()=> ++requests===1?Response.json({data:{searchForTerm:{podcastSeries:ids.map((uuid,i)=>({uuid,name:` Search ${i} `,description:` Snippet ${i} `,rssUrl:`https://feeds.example/${i}`,authorName:`Publisher ${i}`,websiteUrl:null})),rankingDetails:[...ids].reverse().map(uuid=>({uuid,rankingScore:1}))}}}):Response.json({data:{getMultiplePodcastSeries:[...ids].reverse().map(uuid=>({uuid,name:"Hydrated",description:"Replacement",authorName:"Replacement",websiteUrl:null,rssUrl:"https://feeds.example/hydrated",isBlocked:null,feedRefreshDetails:{uuid,priority:"HIGH",priorityReason:null,dateLastRefreshed:1785242096}}))}})});
 const result=await provider.search({...command,providerId:"podcasts"});equal(result.ok,true);if(!result.ok)return;
 equal(JSON.stringify(result.value.map(c=>c.title)),JSON.stringify([" Search 0 "," Search 1 "]));equal(result.value[0].description," Snippet 0 ");equal(result.value[0].canonicalUrl,"https://feeds.example/0");equal(result.value[1].canonicalUrl,"https://feeds.example/1");
});

Deno.test("Brave follows provider pagination even when a page is short and stops when exhausted", async () => {
  const offsets = /** @type {(string|null)[]} */ ([]);
  const counts = /** @type {(string|null)[]} */ ([]);
  const provider = createBraveSearchProvider({providerId:'web',label:'Web',resultKind:'web',priority:1,enabled:true,maximumResults:20,apiVersion:'2023-10-11'}, {credential:()=>({ok:true,value:'fixture'}),fetch:async input=>{const url=new URL(String(input));offsets.push(url.searchParams.get('offset'));counts.push(url.searchParams.get('count'));return Response.json({query:{more_results_available:offsets.length===1},web:{results:[{title:'Lesson',url:'https://example.test/'+offsets.length}]}});}});
  const first=await provider.search(command);
  equal(first.ok,true);
  if (!first.ok) return;
  equal(first.value.length,1);
  equal(first.nextCursor,'1:8');
  const second=await provider.search({...command,limit:20,cursor:first.nextCursor});
  equal(second.ok,true);
  if (second.ok) equal(second.nextCursor,undefined);
  equal(JSON.stringify(offsets),JSON.stringify([null,'1']));
  equal(JSON.stringify(counts),JSON.stringify(['8','8']));
  const invalid=await provider.search({...command,cursor:'10'});
  equal(invalid.ok,false);
  equal(offsets.length,2);
});
