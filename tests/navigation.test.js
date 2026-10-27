// @ts-check
import {
  parseAppRoute,
  renderNavigationButton,
} from "../src/routes/navigation.js";
/** @param {boolean} value @param {string} message */
function assert(value, message) {
  if (!value) throw new Error(message);
}

/** Execute the app's browser event registration with isolated browser boundaries. */
async function notificationHarness(initialHash = "#library") {
  const source = await Deno.readTextFile(new URL("../src/app.js", import.meta.url));
  const start = source.indexOf("function registerOfflineSupport() {");
  const end = source.indexOf("\nasync function syncReminderTimeZone()", start);
  assert(start >= 0 && end > start, "App event registration must exist.");
  const events = new EventTarget();
  const serviceWorker = new EventTarget();
  let hash = initialHash;
  const location = {
    get hash() { return hash; },
    set hash(value) {
      const next = value.startsWith("#") ? value : `#${value}`;
      if (next === hash) return;
      hash = next;
      queueMicrotask(() => events.dispatchEvent(new Event("hashchange")));
    },
  };
  /** @type {string[]} */
  const actions = [];
  const loadedRoutes = new Map([["library", "library"], ["review", "review"]]);
  const bindings = {
    loadedRoutes,
    learnerController: { loadReview: async () => { actions.push("review"); } },
    addEventListener: events.addEventListener.bind(events),
    document: new EventTarget(),
    systemThemeQuery: new EventTarget(),
    navigator: { serviceWorker: Object.assign(serviceWorker, {
      register: () => Promise.resolve({}),
    }) },
    location,
    parseRoute: (/** @type {string} */ hash) => parseAppRoute(hash, ""),
    loadActiveRoute: async () => { actions.push("load"); },
    renderWithTransition: async (/** @type {string} */ focus, /** @type {string} */ heading) => {
      actions.push(`render:${focus}:${heading}`);
    },
    watchServiceWorkerInstall: () => {},
    isOfflineFailureMessage: () => false,
    showOfflineFailure: () => { throw new Error("UnexpectedOfflineFailure"); },
  };
  new Function(...Object.keys(bindings),
    `let activeView = "library", discoveryItemId = null, revealProcessingOnNavigation = false;\n${source.slice(start, end)}\nregisterOfflineSupport();`
  )(...Object.values(bindings));
  return {
    actions, location, loadedRoutes,
    async open(type = "resonance-source-update-open") {
      serviceWorker.dispatchEvent(new MessageEvent("message", { data: { type } }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

Deno.test("Source notification refreshes and renders Library when its hash is unchanged", async () => {
  const app = await notificationHarness();
  await app.open();
  assert(app.location.hash === "#library", "Library route must remain active.");
  assert(!app.loadedRoutes.has("library"), "An explicit source update must invalidate cached Library content.");
  assert(JSON.stringify(app.actions) === JSON.stringify(["load", "render:nav-library:library-title"]),
    `Expected Library reload followed by render, got ${JSON.stringify(app.actions)}`);
});

Deno.test("Source notification navigates from another route and refreshes Library once", async () => {
  const app = await notificationHarness("#review");
  await app.open();
  assert(app.location.hash === "#library", "Source notification must navigate to Library.");
  assert(JSON.stringify(app.actions) === JSON.stringify(["load", "render:nav-library:library-title"]),
    `Expected one Library load/render, got ${JSON.stringify(app.actions)}`);
});

Deno.test("Unrelated service worker messages do not navigate or reload Library", async () => {
  const app = await notificationHarness();
  await app.open("unrelated-message");
  assert(app.location.hash === "#library" && app.actions.length === 0,
    "Unrelated messages must leave the route alone.");
});
Deno.test("Source notification cold start routes to Library", () => {
  assert(
    parseAppRoute("", "?view=library").view === "library",
    "Source notification cold start must route to Library.",
  );
});
Deno.test("Review notification cold start routes to Review", () => {
  assert(
    parseAppRoute("", "?view=review").view === "review",
    "Review notification cold start must route to Review.",
  );
});
Deno.test("Upload hash route takes precedence over Library notification query", () => {
  assert(
    parseAppRoute("#upload", "?view=library").view === "upload",
    "Upload hash route must take precedence over the Library query.",
  );
});
Deno.test("Upload route retains bound URL context and its sixth navigation label", () => {
  for (
    const hash of [
      "#upload",
      "#upload?sourceId=a&runId=b",
      "#upload?sourceId=",
      "#upload?title=x",
    ]
  ) {
    assert(
      parseAppRoute(hash, "").view === "upload",
      "Every Upload context must reach explicit Upload validation.",
    );
  }
  assert(
    parseAppRoute("", "?view=review").view === "review",
    "Notification review routing stays intact.",
  );
  const html = renderNavigationButton("upload", "Upload", "upload");
  assert(
    html.includes('data-view="upload"') &&
      html.includes('aria-current="page"') &&
      html.includes('<span class="nav-label">Upload</span>'),
    "Upload must be a labelled active navigation entry.",
  );
  const review = renderNavigationButton("review", "Review", "review", true);
  assert(
    review.includes('<span class="nav-label">Review</span>') &&
      review.includes('aria-label="Review due"'),
    "Notification dot must sit outside label geometry.",
  );
});

Deno.test("Review notification refreshes its controller while preserving navigation caching", async () => {
  const app = await notificationHarness("#review");
  await app.open("resonance-reminder-open");
  assert(JSON.stringify(app.actions) === JSON.stringify(["review", "load", "render:nav-review:review-title"]), "Review reminders explicitly refresh current questions.");
});

Deno.test("Processing navigation focuses its source after the Library transition finishes", async () => {
  const app = await Deno.readTextFile("src/app.js");
  let click = () => {}, hashchange = () => {}, finish = () => {};
  const transition = new Promise(resolve => { finish = () => resolve(undefined); });
  const actions = /** @type {string[]} */([]);
  const state = {
    activeView: "feed", discoveryItemId: null, revealProcessingOnNavigation: false,
    location: {hash:"#feed"}, root:{querySelector:()=>({addEventListener:(/** @type {string} */_event,/** @type {()=>void} */callback)=>{click=callback;}})},
    addEventListener:(/** @type {string} */_event,/** @type {()=>void} */callback)=>{hashchange=callback;},
    parseRoute:()=>({view:"library",discoveryItemId:null}),matchMedia:()=>({matches:false}),
    loadActiveRoute:async()=>{actions.push("load");},renderWithTransition:async()=>{actions.push("render");await transition;},
    libraryPageController:{revealProcessing:async()=>{actions.push("reveal");}},
  };
  const binding = app.slice(app.indexOf('  root.querySelector("[data-library-processing-open]")'),app.indexOf('  if (activeView === "progress") progressPage?.bind(root);'));
  const handler = app.slice(app.indexOf('  addEventListener("hashchange"'),app.indexOf('  if ("serviceWorker" in navigator)'));
  new Function("state",`with (state) { ${binding}\n${handler} }`)(state);
  click();hashchange();await Promise.resolve();await Promise.resolve();
  assert(state.location.hash === "library" && actions.join(",") === "load,render", "Processing navigation must wait while the page transition owns focus.");
  finish();await new Promise(resolve=>setTimeout(resolve,0));
  assert(actions.join(",") === "load,render,reveal" && !state.revealProcessingOnNavigation,"The active source is revealed after transition focus settles.");
  click();await Promise.resolve();
  assert(actions.join(",") === "load,render,reveal,reveal","Clicking status within Library reveals immediately without another navigation.");
});
