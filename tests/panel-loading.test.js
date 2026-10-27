// @ts-check
const app = Deno.readTextFileSync(new URL("../src/app.js", import.meta.url));
const shell = Deno.readTextFileSync(new URL("../index.html", import.meta.url));
const copy = JSON.parse(shell.match(/<script id="app-copy" type="application\/json">([\s\S]*?)<\/script>/u)?.[1] ?? "{}");
const routeLoader = app.slice(app.indexOf("async function loadActiveRoute()"), app.indexOf("async function loadLearnerController()"));
/** @param {boolean} condition @param {string} message */
function assert(condition, message) { if (!condition) throw new Error(message); }
/** @param {string} view */
function fixture(view) {
  /** @type {{view:string,busy:boolean,failed:boolean}[]} */
  const renders = [];
  const state = {
    activeView: view, startupRestoreIssue: null, routeLoads: new Set(), routeFailures: new Set(),
    loadedRoutes: new Map(), progressDirty: false, progressDay: "",
    libraryPageController: { load: async () => {} }, loadLibraryRoute: async () => {},
    learnerController: { loadFeed: async () => {}, loadReview: async () => {} },
    discoveryPage: { load: async () => ({ ok: true }) },
    progressPage: { load: async () => {} }, settingsPage: {},
    uploadPage: { load: async () => true }, uploadPrefill: null,
    location: { hash: "#" + view }, APP_COPY: copy, errorMessage: null,
    fetch: async () => Response.json([]),
    importModule: async () => { throw new TypeError("Isolated module request failed"); },
    render: () => { renders.push({ view: state.activeView, busy: state.routeLoads.has(state.activeView), failed: state.routeFailures.has(state.activeView) }); },
  };
  const load = new Function("state", `with (state) { return (${routeLoader.replaceAll("await import(", "await importModule(")})(); }`);
  return { state, renders, load: () => /** @type {Promise<void>} */ (load(state)) };
}
Deno.test("all navigation panels announce loading immediately and stop after completion", async () => {
  for (const view of ["feed", "discover", "review", "library", "upload", "progress", "settings"]) {
    const { state, renders, load } = fixture(view);
    let release = () => {};
    state.loadLibraryRoute = () => new Promise((resolve) => { release = () => resolve(); });
    const task = load();
    assert(renders[0]?.busy === true && renders[0]?.failed === false, `${view} must show pending work before awaited loading.`);
    assert(state.routeLoads.has(view), `${view} must remain pending on a delayed connection.`);
    release(); await task;
    assert(!state.routeLoads.has(view) && !state.routeFailures.has(view), `${view} must leave loading after success.`);
  }
});
Deno.test("Discover shows failure only after its lazy module genuinely rejects", async () => {
  const { state, renders, load } = fixture("discover");
  Object.assign(state, { discoveryPage: null });
  const task = load();
  assert(renders[0]?.busy === true && !renders[0]?.failed, "Discover must initially show loading, not a failure.");
  await task;
  assert(state.routeFailures.has("discover") && !state.routeLoads.has("discover"), "A failed module request must show an actual failure and settle loading.");
});
Deno.test("failed Upload dependency stops loading and a later navigation can recover", async () => {
  const { state, load } = fixture("upload");
  Object.assign(state, { libraryPageController: null });
  await load();
  assert(state.routeFailures.has("upload") && !state.routeLoads.has("upload"), "A failed Library module cannot leave Upload pending forever.");
  Object.assign(state, { libraryPageController: { load: async () => {} } });
  await load();
  assert(!state.routeFailures.has("upload") && !state.routeLoads.has("upload"), "A successful later navigation must replace a genuine previous failure.");
});
Deno.test("navigation during pending work preserves the requested route and isolates failures", async () => {
  const { state, load } = fixture("library");
  let release = () => {};
  state.libraryPageController.load = () => new Promise((_resolve, reject) => { release = () => reject(new TypeError("Isolated connection failed")); });
  const task = load();
  await Promise.resolve();
  state.activeView = "review";
  release(); await task;
  assert(state.routeFailures.has("library") && !state.routeFailures.has("review"), "A background failure must not replace the new panel.");
  assert(!state.loadedRoutes.has("library"), "Failures must not be cached as loaded.");
});
Deno.test("opened panels return immediately without another loader or loading screen", async () => {
  for (const view of ["feed", "review", "library", "discover", "upload", "progress", "settings"]) {
    const { state, renders, load } = fixture(view);
    let reads = 0;
    state.loadLibraryRoute = async () => { reads++; };
    await load();
    const initialReads = reads;
    state.activeView = "feed"; state.location.hash = "#feed"; await load();
    state.activeView = view; state.location.hash = "#" + view;
    renders.length = 0;
    await load();
    assert(reads === initialReads + (view === "feed" ? 0 : 1), `${view} must reuse its initialized controller.`);
    assert(renders.length > 0 && renders.every(render => !render.busy), `${view} must render without a loading screen.`);
  }
});
Deno.test("pending first load is reused and new Upload contexts still load", async () => {
  const { state, load } = fixture("upload");
  let reads = 0, release = () => {};
  state.uploadPage.load = () => { reads++; return new Promise(resolve => { release = () => resolve(true); }); };
  const first = load(); await Promise.resolve(); await Promise.resolve();
  await load(); assert(reads === 1, "Returning during a request must not duplicate it.");
  release(); await first;
  state.location.hash = "#upload?sourceId=new&runId=next";
  const next = load(); await Promise.resolve(); await Promise.resolve();
  assert(reads === 2, "A different upload target must not reuse another source context.");
  release(); await next;
  const prefill = { title: "New source" };
  Object.assign(state, { uploadPrefill: prefill, uploadPage: { load: async () => { reads++; return true; } } });
  await load(); assert(reads === 3, "A new prefill must reset the upload panel even with the same hash.");
});
Deno.test("dirty Progress refreshes in the background while cached navigation stays ready", async () => {
  const { state, renders, load } = fixture("progress");
  await load(); let reads = 0, release = () => {};
  state.progressPage.load = () => { reads++; return new Promise(resolve => { release = () => resolve(); }); };
  state.progressDirty = true; renders.length = 0;
  await load();
  assert(reads === 1 && !state.progressDirty && renders.every(render => !render.busy), "New learning activity refreshes data without hiding cached content.");
  await load(); assert(reads === 1, "Returning during a refresh must reuse its pending content."); release();
  state.progressDay = "2020-01-01"; await load(); assert(reads === 2, "A new UTC day refreshes cached metrics."); release();
});
Deno.test("failed Discover probes remain retryable instead of cached", async () => {
  const { state, load } = fixture("discover");
  Object.assign(state, { discoveryPage: { load: async () => ({ ok: false }) } });
  await load(); assert(!state.loadedRoutes.has("discover"), "Incomplete discovery initialization must retry.");
  state.discoveryPage.load = async () => ({ ok: true });
  await load(); assert(state.loadedRoutes.has("discover"), "Recovered content can be cached.");
});
Deno.test("loading markup is accessible, has restrained art, and excludes failure copy", () => {
  assert(copy.panelLoading.includes('role="status"') && copy.panelLoading.includes('aria-busy="true"') && copy.panelLoading.includes('aria-hidden="true"'), "Loading status must be announced and decoration hidden from assistive technology.");
  assert(!copy.panelLoading.includes("could not") && copy.panelFailed.includes('role="alert"'), "Pending and failed states must remain distinct.");
  assert(shell.includes('<div id="app"><main id="main-content" class="loading-screen"'), "The first paint must contain a loading state before module loading.");
  assert([copy.panelLoading, copy.openingApp, shell.match(/<div id="app">(.*?)<\/div>/s)?.[1] ?? ""].every(markup => markup.includes("empty-states.svg#loading") && !markup.includes("empty-states.svg#discover")), "Initial and panel loading use dedicated artwork instead of Discover's telescope.");
  assert(copy.discoverMarkup.neverRunState.includes("empty-states.svg#discover"), "Discover keeps its distinct empty-state artwork.");
});
Deno.test("desktop Discover navigation starts loading before the detail-preservation path can apply", async () => {
  let click = () => {}, hashchange = () => {}, loads = 0;
  const state = {
    activeView: "feed", discoveryItemId: null, revealProcessingOnNavigation: false, location: { hash: "#feed" },
    root: { querySelectorAll: () => [{ getAttribute: () => "discover", addEventListener: (/** @type {string} */ _event, /** @type {()=>void} */ callback) => { click = callback; } }], querySelector: () => null },
    addEventListener: (/** @type {string} */ _event, /** @type {()=>void} */ callback) => { hashchange = callback; },
    parseRoute: () => ({ view: "discover", discoveryItemId: null }),
    matchMedia: () => ({ matches: true }),
    loadActiveRoute: async () => { loads++; }, renderWithTransition: () => {}, render: () => {},
  };
  const bindings = app.slice(app.indexOf('  root.querySelectorAll("[data-view]")'), app.indexOf('  if (activeView === "progress") progressPage?.bind(root);'));
  const hashHandler = app.slice(app.indexOf('  addEventListener("hashchange"'), app.indexOf('  if ("serviceWorker" in navigator)'));
  new Function("state", `with (state) { ${bindings}\n${hashHandler} }`)(state);
  click(); hashchange();
  await Promise.resolve();
  assert(loads === 1 && state.activeView === "discover", "A new desktop Discover entry must request loading, even though detail navigation can preserve existing results.");
});

Deno.test("an unavailable Upload context remains retryable on navigation", async () => {
  const { state, load } = fixture("upload");
  state.uploadPage.load = async () => false;
  await load(); assert(!state.loadedRoutes.has("upload"), "Unavailable context cannot become a completed cached load.");
  state.uploadPage.load = async () => true;
  await load(); assert(state.loadedRoutes.has("upload"), "A recovered context can be cached.");
});
