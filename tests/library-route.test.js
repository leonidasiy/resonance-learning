import { renderLibraryRoute, renderProcessingStatus } from "../src/routes/library.js";
import { createLibraryPage } from "../src/startup/library-page.js";
import { createUploadPage } from "../src/features/uploads/page.js";
import { SUBJECTS } from "../src/features/knowledge-subjects/public.js";

// Supply the browser document boundary from the actual offline shell.
const shell = Deno.readTextFileSync("index.html");
Object.defineProperty(globalThis, "document", { configurable: true, value: {
  getElementById: (/** @type {string} */ id) => {
    const content = shell.match(new RegExp(`<script id="${id}" type="application/json">([\\s\\S]*?)</script>`))?.[1];
    return content === undefined ? null : { textContent: content };
  },
} });
/** @param {boolean} condition @param {string} message */
function assert(condition, message) {
  if (!condition) throw new Error(message);
}

Deno.test("Library static collection markup is supplied by the offline shell", async () => {
  const html = Deno.readTextFileSync("index.html");
  assert(html.includes('id="library-markup"'), "Library markup must live in the shell.");
  assert(html.includes("Browse saved sources, search extracted knowledge, and check processing status."), "Shell preserves Library copy.");
  assert(html.includes("Processing: generating and validating review quizzes."), "Shell carries processing copy too.");
  const messages = [
    "This source is unavailable. Return to Library and reopen Upload.",
    "Select an awaiting source or a new private document.",
    "The upload exceeds the 100 MiB limit.",
    "Pasted text exceeds the one-million-character limit.",
    "Provide either pasted text or one document.",
    "Turn on image processing to upload several images together.",
    "Choose a text, Markdown, PDF, PowerPoint, or raster image file.",
    "Image processing requires a PDF or raster images.",
    "Each image must be 20 MiB or less.",
    "Select image mode for raster image files.",
    "Give pasted material a title.",
    "Page ranges apply only to PDF image processing.",
  ];
  for (const message of messages) assert(html.includes(message), `Shell is missing upload validation: ${message}`);
  const page = createLibraryPage({
    fetch: async () => { throw new Error("Invalid uploads must not request the network."); },
    gatewayBaseUrl: "https://app.example/", escapeHtml: (value) => value, formatDate: (value) => value,
    createId: () => "validation", confirmDisable: () => true, createObserver: () => null,
    schedule: () => 1, cancel: () => {}, onNotice: () => {}, onError: () => {}, rerender: () => {},
  });
  const form = new FormData();
  await page.uploadMaterial("", form);
  assert(!page.uploadResult().ok && page.uploadResult().message === messages[4], "Missing content is explicit without a permission gate.");

  await page.uploadMaterial("", form);
  assert(page.uploadResult().message === messages[4], "Missing content copy is exact.");
  form.set("content", "x".repeat(1_000_001));
  await page.uploadMaterial("", form);
  assert(page.uploadResult().message === messages[3], "Oversized pasted text copy is exact.");
  form.set("content", "x".repeat(1_000_000));
  await page.uploadMaterial("", form);
  assert(page.uploadResult().message === messages[10], "Inclusive text limit reaches the title validation.");
  form.set("title", "Synthetic title");
  form.set("pageRange", "1");
  await page.uploadMaterial("", form);
  assert(page.uploadResult().message === messages[11], "Inapplicable PDF page range copy is exact.");

});

Deno.test("Library contains no embedded uploader", () => {
  const html = renderLibraryRoute(baseModel());
  assert(!html.includes("data-library-upload") && !html.includes("data-upload-form") && !html.includes('type="file"'), "Uploads belong on the Upload route.");
});

const source = Object.freeze({
  id: "source-a",
  ownerId: "owner-a",
  submittedUrl: "https://publisher.example/learn",
  canonicalUrl: "https://publisher.example/learn",
  title: "Harmony source",
  description: "Lessons on harmonic motion.",
  adapter: Object.freeze({
    id: "publisher adapter",
    version: "1",
    granularity: "course root",
    capabilities: Object.freeze(["metadata", "bounded pages"]),
  }),
  interestAreaIds: Object.freeze(["area-a"]),
  identityEvidence: Object.freeze([]),
  state: /** @type {const} */ ("active"),
  approvedAt: "2026-07-22T08:00:00.000Z",
  updatedAt: "2026-07-22T08:00:00.000Z",
  revision: 2,
});

/** @returns {import("../src/routes/library.js").LibraryRouteModel} */
function baseModel() {
  return {
    collection: {
      state: /** @type {const} */ ("success"),
      items: [source],
      nextCursor: "signed",
      query: "",
      pendingSourceId: null,
      message: null,
    },
    escapeHtml: (value) => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;"),
    formatDate: () => "Jul 22, 2026",
  };
}

const sourceB = Object.freeze({
  ...source,
  id: "source-b",
  title: "Rhythm source",
  interestAreaIds: Object.freeze(["area-a"]),
});

Deno.test("Library shelves default to All and sort newest first with stable ties", () => {
  const newer = { ...sourceB, approvedAt: "2026-09-19T08:00:00.000Z" };
  const tied = { ...newer, id: "source-c" };
  const knowledge = [source, newer, tied].map((item, i) => ({ knowledgeId: `k${i}`, sourceId: item.id, summary: "A retained idea.", questionLocked: true, primarySubject: SUBJECTS[i === 0 ? 0 : 1].id }));
  const model = { ...baseModel(), collection: { ...baseModel().collection, items: [source, newer, tied] }, knowledge };
  const html = renderLibraryRoute(model);
  assert(html.includes('value="all" selected'), "Library must default to All without a selected subject.");
  assert(html.includes('data-library-source="source-a"'), "The default shelf includes sources from other subjects.");
  assert(html.indexOf('data-library-source="source-c"') < html.indexOf('data-library-source="source-b"'), "Tied dates need stable descending source identity.");
  const sameSubject = renderLibraryRoute({ ...model, knowledge: knowledge.map(point => ({ ...point, primarySubject: SUBJECTS[1].id })) });
  assert(sameSubject.indexOf('data-library-source="source-b"') < sameSubject.indexOf('data-library-source="source-a"'), "Newer dates must precede older sources.");
  assert(html.includes('data-reveal="source:source-b"'), "Source cards must participate in progressive reveal.");
});

Deno.test("Library sources appear on each represented primary subject and legacy sources only on Unclassified", () => {
  const knowledge = SUBJECTS.slice(0, 2).map((subject, i) => ({ knowledgeId: `k${i}`, sourceId: source.id, summary: "A retained idea.", questionLocked: true, primarySubject: subject.id }));
  for (const selected of [SUBJECTS[0].id, SUBJECTS[1].id, "unclassified", SUBJECTS[2].id]) {
    const html = renderLibraryRoute({ ...baseModel(), collection: { ...baseModel().collection, subject: selected, items: [source, sourceB] }, knowledge });
    assert(html.includes('data-library-source="source-a"') === [SUBJECTS[0].id, SUBJECTS[1].id].includes(selected), "A multi-subject source belongs to both matching shelves only.");
    assert(html.includes('data-library-source="source-b"') === (selected === "unclassified"), "Legacy source needs its explicit neutral shelf.");
    if (selected === SUBJECTS[2].id) assert(html.includes("No loaded sources in this subject"), "An empty selected shelf must offer recovery.");
  }
  let rejected = false;
  try { renderLibraryRoute({ ...baseModel(), collection: { ...baseModel().collection, subject: "invented-subject" } }); } catch (error) { rejected = error instanceof TypeError; }
  assert(rejected, "Unknown selected subjects must fail validation.");
});

Deno.test("Library All shelf includes every subject and unclassified sources newest first without duplicates", () => {
  const newer = { ...sourceB, approvedAt: "2026-09-19T08:00:00.000Z", primarySubject: "computing" };
  const tied = { ...newer, id: "source-c", primarySubject: undefined };
  const knowledge = SUBJECTS.slice(0, 2).map((subject, i) => ({ knowledgeId: `k${i}`, sourceId: source.id, summary: "A retained idea.", questionLocked: true, primarySubject: subject.id }));
  const html = renderLibraryRoute({ ...baseModel(), collection: { ...baseModel().collection, subject: "all", items: [source, newer, tied], nextCursor: "next-page" }, knowledge });
  assert(html.includes('value="all" selected>All</option>'), "All must be selectable using the existing accessible shelf control.");
  const cards = [...html.matchAll(/data-library-source="([^"]+)"/g)].map(match => match[1]);
  assert(cards.join(",") === "source-c,source-b,source-a", "All includes classified, multi-subject and unclassified sources once, sorted newest first with stable ties.");
  assert(html.includes("3 loaded sources") && html.includes("data-library-load-more"), "All retains accurate counts and source pagination.");
});

Deno.test("Library keeps a classified source on its shelf while retry hides its published knowledge", () => {
  const classified = { ...source, primarySubject: "music" };
  for (const state of ["completed", "per-point-quiz-loop", "retryable-failure"]) {
    for (const subject of ["music", "unclassified"]) {
      const html = renderLibraryRoute({ ...baseModel(), collection: { ...baseModel().collection, items: [classified], subject }, knowledge: [], workflowStatuses: [workflowStatus(state)] });
      assert(html.includes('data-library-source="source-a"') === (subject === "music"), "Saved source classification must survive retry and page reload even without visible knowledge.");
    }
  }
});

Deno.test("Library restores subject selection and reports unavailable or invalid stored preferences", async () => {
  for (const stored of [SUBJECTS[1].id, "all", "unclassified", "invalid", "throws", null]) {
    const errors = /** @type {string[]} */ ([]);
    const page = createLibraryPage({
      fetch: async input => {
        const path = new URL(String(input)).pathname;
        if (path.endsWith("/source-library")) return Response.json({ result: { items: [source, sourceB], interestAreas: [], nextCursor: null } });
        if (path.endsWith("/library-knowledge")) return Response.json({ result: { items: [source, sourceB].map((item, i) => ({ knowledgeId: `k${i}`, sourceId: item.id, sourceRevision: item.revision, questionId: `q${i}`, title: item.title, summary: "A useful idea.", sourceUrl: item.canonicalUrl, evidenceAnchorIds: ["anchor"], media: null, questionLocked: true, sourceClassification: { mainSubject: SUBJECTS[i].id, topic: "Source context" }, sourceClassificationRevision: 0 })) } });
        if (path.endsWith("/source-status")) return Response.json({ result: { sourceId: new URL(String(input)).searchParams.get("sourceId"), run: null, reasonCode: null, message: null } });
        throw new Error(`Unexpected fixture path: ${path}`);
      },
      storage: { getItem: key => { assert(key === "resonance-library-subject", "Use the documented preference key."); if (stored === "throws") throw new Error("Synthetic storage denial"); return stored; }, setItem: () => { throw new Error("Reading must not write preferences"); } },
      gatewayBaseUrl: "https://app.example/", escapeHtml: value => value, formatDate: value => value, createId: () => "id", confirmDisable: () => true,
      createObserver: () => null, schedule: () => 1, cancel: () => {}, onNotice: () => {}, onError: message => errors.push(message), rerender: () => {},
    });
    await page.load();
    const selected = stored === SUBJECTS[1].id || stored === "unclassified" ? stored : "all";
    assert(page.render({}).includes(`value="${selected}" selected`), "Valid saved choices are restored; missing, invalid or inaccessible preferences default to All.");
    assert(errors.length === (stored === "throws" || stored === "invalid" ? 1 : 0), "Invalid and inaccessible preferences need an explicit notice, missing storage does not.");
  }
});

Deno.test("Library offers authorized material upload only for an awaiting-upload source", () => {
  const html = renderLibraryRoute({ ...baseModel(), workflowStatuses: [workflowStatus("awaiting-upload")] });
  assert(html.includes('href="#upload?sourceId=source-a&amp;runId=run-source-a'), "Blocked sources must hand off to the dedicated route.");
  assert(html.includes("sourceId=source-a") && html.includes("runId=run-source-a"), "Handoff must load the authoritative source title and revision through Upload context.");
  assert(!html.includes('data-library-upload'), "Cards must not contain upload forms.");
  for (const state of ["completed", "extraction-loop", "abandoned"]) {
    assert(!renderLibraryRoute({ ...baseModel(), workflowStatuses: [workflowStatus(state)] }).includes('href="#upload?'), `${state} must not offer a conflicting source attachment.`);
  }
});

Deno.test("Library offers private document creation without an existing source", async () => {
  assert(!renderLibraryRoute({ ...baseModel(), collection: { ...baseModel().collection, items: [], state: "empty" } }).includes('data-library-upload'), "Private uploads belong on Upload.");
  const documentSource = { ...source, id: "private-source", origin: "private-document", canonicalUrl: "https://app.example/api/private-documents/private-source", submittedUrl: "https://app.example/api/private-documents/private-source" };
  const requests = /** @type {string[]} */ ([]);
  let fail = true;
  const page = createLibraryPage({
    fetch: async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/private-documents")) {
        requests.push("create");
        return Response.json({ result: { source: documentSource, runId: "private-run", reused: requests.filter((v) => v === "create").length > 1 } });
      }
      if (url.pathname.endsWith("/material")) {
        requests.push("upload");
        if (!(init?.body instanceof FormData)) throw new Error("A private file must use multipart.");
        assert(init.body.get("sourceId") === documentSource.id && init.body.get("runId") === "private-run", "Private upload must use its own source/run.");
        return fail ? Response.json({ error: "WorkflowMaterialStorageFailed" }, { status: 503 }) : Response.json({ result: { status: "attached", materialId: "material-private", runId: "private-run", reused: false } });
      }
      if (url.pathname.endsWith("/source-status")) return Response.json({ result: workflowStatus("awaiting-upload", documentSource.id) });
      throw new Error(`Unexpected ${url.pathname}`);
    },
    gatewayBaseUrl: "https://app.example/", escapeHtml: (value) => value, formatDate: (value) => value, createId: () => "doc-id", confirmDisable: () => true,
    createObserver: () => null, schedule: () => 1, cancel: () => {}, onNotice: () => {}, onError: () => {}, rerender: () => {},
  });
  const form = new FormData();
  form.set("file", new File(["Synthetic authorized notes"], "lecture.txt"));
  await page.uploadMaterial("", form);
  fail = false;
  await page.uploadMaterial("", form);
  assert(requests.join(",") === "create,upload,create,upload", "A failed attachment must retry the idempotent creation and upload steps.");
});

Deno.test("Library uploads validated material to its persisted run and preserves retry after failure", async () => {
  /** @type {RequestInit[]} */ const uploads = [];
  /** @type {string[]} */ const errors = [];
  let failUpload = true;
  const page = createLibraryPage({
    fetch: async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/source-library")) return Response.json({ result: { items: [source], interestAreas: [], nextCursor: null } });
      if (url.pathname.endsWith("/library-knowledge")) return Response.json({ result: { items: [] } });
      if (url.pathname.endsWith("/source-status")) return Response.json({ result: workflowStatus("awaiting-upload") });
      if (url.pathname.endsWith("/material")) {
        uploads.push(init ?? {});
        return failUpload ? Response.json({ error: "WorkflowMaterialStorageFailed" }, { status: 503 }) : Response.json({ result: { status: "attached", materialId: "material-a", runId: "run-source-a", reused: false } });
      }
      throw new Error(`Unexpected request ${url.pathname}`);
    },
    gatewayBaseUrl: "https://app.example/", escapeHtml: (value) => value,
    formatDate: (value) => value, createId: () => "upload-id", confirmDisable: () => true,
    createObserver: () => null, schedule: () => 1, cancel: () => {},
    onNotice: () => {}, onError: (message) => errors.push(message), rerender: () => {},
  });
  await page.load();
  const form = new FormData();
  form.set("content", "A synthetic source explains a musical relation.");
  await page.uploadMaterial("unknown-source", form);
  assert(uploads.length === 0, "Unknown sources must not be transmitted.");
  await page.uploadMaterial("source-a", form);
  assert(uploads.length === 1, "Storage failure must follow one upload attempt.");
  assert(errors.length === 0, "Upload failures must not invoke the global error callback.");
  assert(!page.uploadResult().ok && page.uploadResult().message.length > 0, "Storage failure must retain its inline retry message.");
  assert(page.render({}).includes('href="#upload?'), "Failure must leave a retry action available.");
  const body = JSON.parse(String(uploads[0].body));
  assert(body.runId === "run-source-a" && body.sourceId === source.id && body.sourceRevision === source.revision && body.sourceUrl === source.canonicalUrl, "Upload must use the loaded source/run binding.");
  assert(!Object.hasOwn(body, "ownerId"), "The server owns authentication identity.");
  failUpload = false;
  await page.uploadMaterial("source-a", form);
  assert(uploads.length === 2, "A failed upload must remain retryable.");
  form.set("file", new File(["synthetic document"], "notes.txt", { type: "text/plain" }));
  await page.uploadMaterial("source-a", form);
  assert(uploads.length === 2, "Ambiguous pasted and file content must not be selected silently.");
  form.delete("content");
  await page.uploadMaterial("source-a", form);
  assert(uploads.length === 3 && uploads[2].body instanceof FormData, "Documents must use the existing multipart transport.");
  form.set("file", new File(["unsupported"], "archive.zip", { type: "application/zip" }));
  await page.uploadMaterial("source-a", form);
  assert(uploads.length === 3, "Unsupported formats must fail before transmission.");
});

Deno.test("Library batches selected raster files automatically without checkbox", async () => {
  /** @type {FormData[]} */ const uploads = [];
  const page = createLibraryPage({
    fetch: async (input, init) => {
      const pathname = new URL(String(input)).pathname;
      if (pathname.endsWith("/source-library")) return Response.json({ result: { items: [source], interestAreas: [], nextCursor: null } });
      if (pathname.endsWith("/library-knowledge")) return Response.json({ result: { items: [] } });
      if (pathname.endsWith("/source-status")) return Response.json({ result: workflowStatus("awaiting-upload") });
      if (pathname.endsWith("/material")) {
        if (!(init?.body instanceof FormData)) throw new Error("Expected multipart image upload.");
        uploads.push(init.body);
        return Response.json({ result: { status: "attached", materialId: "material-images", runId: "run-source-a", reused: false } });
      }
      throw new Error(`Unexpected ${pathname}`);
    },
    gatewayBaseUrl: "https://app.example/", escapeHtml: (value) => value, formatDate: (value) => value,
    createId: () => "image-id", confirmDisable: () => true, createObserver: () => null,
    schedule: () => 1, cancel: () => {}, onNotice: () => {}, onError: () => {}, rerender: () => {},
  });
  await page.load();
  const form = new FormData();

  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  for (let index = 1; index <= 3; index++) form.append("file", new File([png], `figure-${index}.png`, { type: "image/png" }));
  await page.uploadMaterial("source-a", form);

  assert(uploads.length === 1 && uploads[0].get("mode") === "image" && uploads[0].get("mediaType") === "application/x-knowledge-images", "Enabled processing must send one image bundle.");
});

/** @param {string} state @param {string} sourceId */
function workflowStatus(state, sourceId = "source-a") {
  return {
    sourceId,
    run: {
      runId: `run-${sourceId}`,
      state,
      revision: 1,
      counts: { pages: 0, knowledgePoints: 0, acceptedQuizzes: 0, pendingQuizzes: 0 },
      extractionStartedAt: null,
      extractionDeadlineAt: null,
      elapsedMs: null,
      remainingMs: null,
      decisionRequired: null,
      failureKind: null,
      robotsEvidence: null,
    },
    reasonCode: null,
    message: null,
  };
}

Deno.test("Library source cards render one list of retained extracted knowledge", () => {
  const html = renderLibraryRoute({
    ...baseModel(),
    knowledge: [{ knowledgeId: "knowledge-a", sourceId: "source-a", summary: "This lesson introduces harmonic motion, cadences, and how tonal tension resolves across a phrase.", questionLocked: true }],
  });
  for (const expected of [
    "Search saved sources",
    "Music",
    "Harmony source",
    "Open original source",
    "data-library-disable",
    "data-library-load-more",
    "About this source",
    "Extracted knowledge points (1)",
    "This lesson introduces harmonic motion",
  ]) assert(html.includes(expected), `Missing ${expected}.`);
  assert(!html.includes("data-library-knowledge-remove"), "Source cards must not expose individual knowledge controls.");
  assert(!html.includes("Question unlocks after Feed study"), "Source overviews must not expose quiz state for individual points.");
  assert(html.includes("Library · source collection") && !html.includes('aria-label="Library sections"'), "The source collection must be identified without the retired one-item tab bar.");
  assert(!html.includes("Review queue"), "Library must not render a human or scheduled review queue.");
  assert(!html.includes("Keep") && !html.includes("Discard"), "Library must not render human approval controls.");
});

Deno.test("Library can render a cross-source knowledge search result separately from source search", () => {
  const html = renderLibraryRoute({
    ...baseModel(),
    collection: { ...baseModel().collection, query: "cadence", searchScope: "knowledge" },
    knowledgeSearchResults: [{
      knowledgeId: "knowledge-cadence",
      sourceId: "source-a",
      sourceTitle: "Harmony source",
      summary: "A cadence resolves harmonic tension.",
      sourceUrl: source.canonicalUrl,
      score: 0.84,
      matchedBy: "semantic",
      questionLocked: true,
    }],
  });
  assert(html.includes("Search knowledge"), "Library must expose the knowledge search scope.");
  assert(html.includes("A cadence resolves harmonic tension."), "Knowledge search must render the matching point.");
  assert(html.includes('<a href="https://publisher.example/learn" target="_blank" rel="noopener noreferrer">Harmony source</a>'), "Knowledge search must embed the source link in its attribution.");
  assert(!html.includes(">Open source</a>"), "Knowledge search must not render a redundant separate source link.");
  assert(html.includes("semantic match"), "Knowledge search must disclose the match mode.");
});

Deno.test("Library source search keeps the extracted points with their source", () => {
  const knowledge = [
    { knowledgeId: "knowledge-a", sourceId: "source-a", summary: "This lesson introduces the piano keyboard and grand staff, including middle C and clefs.", questionLocked: true },
    { knowledgeId: "knowledge-b", sourceId: "source-a", summary: "This lesson explains half steps, whole steps, and accidentals in staff notation.", questionLocked: false },
  ];
  const html = renderLibraryRoute({
    ...baseModel(),
    collection: { ...baseModel().collection, query: "harmony", searchScope: "sources" },
    knowledge,
  });
  assert(html.includes("Harmony source"), "Source search must render the matching source card.");
  assert(html.includes("Extracted knowledge points (2)"), "The list must count the currently retained points.");
  assert(html.includes(knowledge[0].summary) && html.includes(knowledge[1].summary), "The source list must show each extracted summary.");
  assert(!html.includes("Related knowledge"), "The duplicate source overview must be removed.");
  assert(!html.includes("data-library-knowledge-remove"), "Source search must not expose individual knowledge controls.");
  assert(html.includes("Open original source"), "Source search must retain the source link.");
});

Deno.test("Library extracted list escapes summaries and excludes other sources", () => {
  const repeated = "This lesson covers scales, modes, and tonal centers in music theory.";
  const html = renderLibraryRoute({
    ...baseModel(),
    knowledge: [
      { knowledgeId: "knowledge-a", sourceId: "source-a", summary: repeated, sourceTopic: "Cadential harmony", questionLocked: true },
      { knowledgeId: "knowledge-b", sourceId: "source-a", summary: repeated, sourceTopic: "Cadential harmony", questionLocked: false },
      { knowledgeId: "knowledge-c", sourceId: "source-a", summary: `${repeated} <script>alert(1)</script>`, sourceTopic: "Cadential harmony", questionLocked: true },
      { knowledgeId: "other", sourceId: "source-b", summary: "Another source point", questionLocked: true },
    ],
  });
  assert(html.includes("Extracted knowledge points (3)"), "The list must count every retained point for this source.");
  assert(html.includes(repeated) && html.includes("&lt;script>"), "Retained summaries must be shown and escaped.");
  assert(!html.includes("<script>alert(1)</script>") && !html.includes("Another source point"), "No unsafe markup or another source's points may enter this list.");
  assert(!html.includes("Related knowledge") && !html.includes("Source topic:"), "A second source overview must not duplicate the points.");
});

Deno.test("Header announces the number of actively processing sources", () => {
  const html = renderProcessingStatus({
    ...baseModel(),
    workflowStatuses: [workflowStatus("extraction-loop")],
  });
  assert(html.includes('data-library-processing-status'), "Library must render a processing status chip for active work.");
  assert(html.includes("Processing 1 source"), "The status chip must report a singular active source.");
  assert(html.includes("extracting knowledge points"), "A single active source must expose its current processing stage.");
  assert(html.includes('role="status"'), "The processing chip must use status semantics.");
  assert(html.includes('aria-live="polite"'), "The processing chip must announce updates politely.");
  assert(html.includes('aria-atomic="true"'), "The processing announcement must be atomic.");
  assert(html.includes('aria-hidden="true"') && html.includes("⟳"), "The CSS spinner must be decorative and visible without replacing the text label.");
});

Deno.test("Header pluralizes active processing sources and excludes waiting states", () => {
  const activeModel = {
    ...baseModel(),
    collection: { ...baseModel().collection, items: [source, sourceB] },
    workflowStatuses: [
      workflowStatus("source-added", "source-a"),
      workflowStatus("per-point-quiz-loop", "source-b"),
      { ...workflowStatus("awaiting-upload", "source-a"), message: "Upload content instead." },
    ],
  };
  const active = renderProcessingStatus(activeModel) + renderLibraryRoute(activeModel);
  assert(active.includes("Processing 2 sources"), "The status chip must pluralize and count active sources once each.");
  assert(active.includes("generating and validating review quizzes"), "An active quiz-generation status must explain what processing is doing.");

  const terminalModel = {
    ...baseModel(),
    workflowStatuses: [
      { ...workflowStatus("awaiting-upload"), message: "Upload content instead." },
      workflowStatus("completed", "source-b"),
    ],
  };
  const terminal = renderProcessingStatus(terminalModel) + renderLibraryRoute(terminalModel);
  assert(!terminal.includes('data-library-processing-status'), "Waiting and completed sources must not keep the spinner visible.");
  assert(terminal.includes("Upload content instead."), "The source card must retain the specific upload explanation.");
});

Deno.test("Library offers unchecked external AI search consent and explains its bounded scope", () => {
  const html = renderLibraryRoute(baseModel());
  const checkbox = html.match(/<input[^>]*name="externalProcessingAllowed"[^>]*>/)?.[0];
  assert(checkbox !== undefined && !checkbox.includes("checked"), "AI processing must be an explicit opt-in.");
  assert(html.includes("with OpenRouter"), "Search must disclose external processing.");
  assert(html.includes("20 candidates"), "Search must disclose its bounded candidate scope.");
  assert(!html.includes("library-search-help") && !html.includes("Searches exact terms by default"), "The consent line must not be repeated in a second explanation.");
});

Deno.test("Library search has the approved dedicated search composition and shared select styling", async () => {
  const css = await Deno.readTextFile(new URL("../src/styles.css", import.meta.url));
  assert(!css.includes(".library-knowledge-search {"), "Knowledge search must use the shared section layout.");
  assert(css.includes(".library-search .library-search-row {"), "Approved redesign gives Library a distinct responsive search composition.");
  assert(!css.includes(".library-search-row select {"), "Library search must not add a one-off select rule.");
});

Deno.test("Library processing spinner respects reduced-motion CSS", async () => {
  const css = await Deno.readTextFile(new URL("../src/styles.css", import.meta.url));
  assert(css.includes(".library-processing-spinner"), "The processing indicator must have a dedicated spinner style.");
  assert(css.includes("@media (prefers-reduced-motion: reduce)"), "The stylesheet must declare reduced-motion behavior.");
  assert(css.includes("animation-duration: 0.01ms"), "Reduced motion must shorten the spinner animation.");
});

Deno.test("Library omits incomplete knowledge placeholders", () => {
  const html = renderLibraryRoute({ ...baseModel(), knowledge: [] });
  assert(!html.includes("Knowledge is still being processed"), "Incomplete material must not appear as knowledge.");
  assert(!html.includes("Policy assessment pending"), "Retired policy placeholder must not remain in Library.");
});

Deno.test("Library explains why a blocked source needs uploaded content", () => {
  const html = renderLibraryRoute({
    ...baseModel(),
    workflowStatuses: [{
      sourceId: "source-a",
      run: null,
      reasonCode: "audio-video-transcription-unavailable",
      message: "This source contains audio or video, but native audio/video transcription is not available yet. Upload an authorized transcript or text/document instead.",
    }],
  });
  assert(html.includes("native audio/video transcription is not available yet"), "Library must display the concrete upload reason.");
  assert(html.includes("Upload an authorized transcript"), "Library must tell the learner what to upload.");
});

Deno.test("Library shows the planner failure reason and retry action", () => {
  const html = renderLibraryRoute({
    ...baseModel(),
    workflowStatuses: [{
      ...workflowStatus("retryable-failure"),
      reasonCode: "retryable-failure",
      message: "Automatic extraction stopped because the planner returned an invalid ExtractionPlan after one correction attempt (ExtractionPlanInvalid). Retry processing to try again.",
    }],
  });
  assert(html.includes("invalid ExtractionPlan"), "Library must show the concrete planner failure.");
  assert(html.includes("Retry processing"), "Library must offer a retry action.");
  assert(html.includes('data-library-workflow-retry="run-source-a"'), "Retry action must carry the workflow run ID.");
  assert(!html.includes("data-library-processing-status"), "Retryable failure must not keep the processing spinner visible.");
});

Deno.test("Library treats an expired extraction as stopped and retryable", () => {
  const status = workflowStatus("extraction-loop");
  const html = renderLibraryRoute({
    ...baseModel(),
    workflowStatuses: [{
      ...status,
      run: {
        ...status.run,
        extractionStartedAt: "2026-08-13T00:00:00.000Z",
        extractionDeadlineAt: "2026-08-13T00:30:00.000Z",
        elapsedMs: 1_800_001,
        remainingMs: 0,
      },
      reasonCode: "retryable-failure",
      message: "Automatic extraction stopped after its processing deadline elapsed. Retry processing to try again.",
    }],
  });
  assert(!html.includes('data-library-processing-status'), "An expired extraction must not keep the processing spinner visible.");
  assert(html.includes("processing deadline elapsed"), "The expired run must explain why processing stopped.");
  assert(html.includes("Retry processing"), "The expired run must remain retryable.");
});

Deno.test("Library dispatches Retry processing for a deadline-expired extraction", async () => {
  let resumed = false;
  let posts = 0;
  /** @type {(()=>void)|null} */ let click = null;
  /** @type {import("../src/features/source-library/gateway.js").WorkflowSourceStatus} */
  const expired = {...workflowStatus("extraction-loop"),run:{...workflowStatus("extraction-loop").run,extractionStartedAt:"2026-08-13T00:00:00.000Z",extractionDeadlineAt:"2026-08-13T00:30:00.000Z",remainingMs:0}, reasonCode:"retryable-failure", message:"Automatic extraction stopped after its processing deadline elapsed. Retry processing to try again."};
  if (expired.run === null) throw new Error("Missing expired fixture run");
  const errors = /** @type {string[]} */ ([]);
  const page = createLibraryPage({
    fetch: async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/source-library")) return Response.json({result:{items:[source],interestAreas:[],nextCursor:null}});
      if (path.endsWith("/library-knowledge")) return Response.json({result:{items:[]}});
      if (path.endsWith("/control")) {
        posts++;
        const command = JSON.parse(String(init?.body));
        assert(command.action === "resume" && command.expectedRevision === 1 && command.runId === "run-source-a", "Retry must target the expired run at its current revision.");
        resumed = true;
        return Response.json({result:{...workflowStatus("extraction-loop").run,revision:2}});
      }
      return Response.json({result:resumed?workflowStatus("extraction-loop"):expired});
    }, gatewayBaseUrl:"https://app.example/",escapeHtml:v=>v,formatDate:v=>v,createId:()=>"id",confirmDisable:()=>true,createObserver:()=>null,schedule:()=>1,cancel:()=>{},onNotice:()=>{},onError:message=>errors.push(message),rerender:()=>{},
  });
  try {
    await page.load();
    assert(page.render({}).includes('data-library-workflow-retry="run-source-a"'), "The expired card offers Retry processing.");
    page.bind(/** @type {HTMLElement} */ (/** @type {unknown} */ ({querySelector:()=>null,querySelectorAll:(/** @type {string} */ selector)=>selector==="[data-library-workflow-retry], [data-library-workflow-cancel]"?[{hasAttribute:()=>false,getAttribute:(/** @type {string} */ name)=>name.endsWith("revision")?"1":"run-source-a",addEventListener:(/** @type {string} */ _event,/** @type {()=>void} */ handler)=>{click=handler;}}]:[]})));
    if (click === null) throw new Error("Retry action not bound");
    /** @type {()=>void} */ (click)();
    await new Promise(resolve=>setTimeout(resolve,0));
    assert(posts === 1, "Clicking Retry processing must dispatch one resume request for the expired run.");
    assert(errors.length === 0 && !page.render({}).includes("deadline elapsed"), "Successful retry replaces the expired status without an error.");
  } finally {page.dispose();}
});

Deno.test("Library offers Continue processing only when interrupted work has saved progress", () => {
  for (const saved of ["none", "pages", "knowledge", "live"]) {
    const status = {...workflowStatus("retryable-failure"),reasonCode:"retryable-failure",run:{...workflowStatus("retryable-failure").run,...(saved === "live" ? {progress:{currentUrl:null,pageTitle:null,sectionTitle:null,stage:"Reviewing knowledge",updatedAt:"2026-10-16T11:00:00.000Z",knowledgePoints:[{knowledgeId:"point-a",summary:"Saved progress"}],generatedQuizQuestions:0,processedPageCount:0,totalPages:1}} : {})}};
    if (saved === "pages") status.run.counts.pages = 1;
    if (saved === "knowledge") status.run.counts.knowledgePoints = 1;
    const html = renderLibraryRoute({...baseModel(),workflowStatuses:[status]});
    assert(html.includes(saved === "none" ? ">Retry processing</button>" : ">Continue processing</button>"), "The action must distinguish a fresh retry from resuming saved work.");
  }
});

Deno.test("Library keeps robots evidence out of cards", () => {
  const present = renderLibraryRoute({
    ...baseModel(),
    workflowStatuses: [{
      ...workflowStatus("completed"),
      run: {
        ...workflowStatus("completed").run,
        robotsEvidence: {
          robotsUrl: "https://publisher.example/robots.txt",
          targetUrl: source.canonicalUrl,
          httpStatus: 200,
          availability: "present",
          content: "User-agent: *\nDisallow: /private\n",
          checkedAt: "2026-07-22T08:05:00.000Z",
          matchedRule: null,
        },
      },
    }],
  });
  assert(!present.includes("View robots.txt"), "Library must offer the robots evidence disclosure.");
  assert(!present.includes("Disallow: /private"), "Library must show the bounded robots content.");
  assert(!present.includes("Open robots.txt"), "Library must link to the source robots file.");

  const absent = renderLibraryRoute({
    ...baseModel(),
    workflowStatuses: [{
      ...workflowStatus("completed"),
      run: {
        ...workflowStatus("completed").run,
        robotsEvidence: {
          robotsUrl: "https://publisher.example/robots.txt",
          targetUrl: source.canonicalUrl,
          httpStatus: 404,
          availability: "absent",
          content: "",
          checkedAt: "2026-07-22T08:05:00.000Z",
          matchedRule: null,
        },
      },
    }],
  });
  assert(!absent.includes("robots.txt"), "Library must distinguish an explicit missing robots file.");

  const unavailable = renderLibraryRoute({
    ...baseModel(),
    workflowStatuses: [{
      ...workflowStatus("completed"),
      run: {
        ...workflowStatus("completed").run,
        robotsEvidence: {
          robotsUrl: "https://publisher.example/robots.txt",
          targetUrl: source.canonicalUrl,
          httpStatus: 403,
          availability: "unavailable",
          content: "",
          checkedAt: "2026-07-22T08:05:00.000Z",
          matchedRule: null,
        },
      },
    }],
  });
  assert(!unavailable.includes("robots.txt"), "Library must disclose an origin robots 403 separately from an explicit denial.");
  assert(!unavailable.includes("source page was reachable"), "Library must explain why extraction continued after the robots 403.");
});

Deno.test("Library controller loads source knowledge and removes one knowledge pair", async () => {
  /** @type {string[]} */ const requests = [];
  /** @type {(() => void) | null} */ let removeListener = null;
  const page = createLibraryPage({
    fetch: (input, init) => {
      const url = new URL(String(input));
      requests.push(`${init?.method ?? "GET"} ${url.pathname}${url.search}`);
      if (url.pathname.endsWith("/source-library")) return Promise.resolve(Response.json({ result: { items: [source], interestAreas: [], nextCursor: null } }));
      if (url.pathname.endsWith("/library-knowledge")) return Promise.resolve(Response.json({ result: { items: [{ knowledgeId: "knowledge-a", sourceId: "source-a", sourceRevision: source.revision, sourceClassification: null, sourceClassificationRevision: 0, questionId: "question-a", title: "Harmony source", summary: "A cadence resolves musical tension.", sourceUrl: source.canonicalUrl, evidenceAnchorIds: ["anchor-a"], media: null, questionLocked: false }] } }));
      if (url.pathname.endsWith("/knowledge-remove")) return Promise.resolve(Response.json({ result: { knowledgeId: "knowledge-a", removed: true } }));
      return Promise.resolve(Response.json({ error: "Not found" }, { status: 404 }));
    },
    gatewayBaseUrl: "https://app.example/",
    escapeHtml: (value) => value,
    formatDate: (value) => value,
    createId: () => "id-a",
    confirmDisable: () => true,
    createObserver: () => null,
    schedule: () => 1,
    cancel: () => {},
    onNotice: () => {},
    onError: () => {},
    rerender: () => {},
  });
  await page.load();
  const initial = page.render({});
  assert(initial.includes("Extracted knowledge points (1)"), "Library must show the retained point in its source list.");
  page.bind(/** @type {HTMLElement} */ (/** @type {unknown} */ ({
    querySelector: () => null,
    querySelectorAll: (/** @type {string} */ selector) => {
      assert(selector !== "[data-library-upload]", "Library must not bind an embedded upload form.");
      return selector === "[data-library-knowledge-remove]"
      ? [{ getAttribute: (/** @type {string} */ name) => name === "data-library-knowledge-remove" ? "knowledge-a" : null, addEventListener: (/** @type {string} */ _event, /** @type {() => void} */ listener) => { removeListener = listener; } }]
      : [];
    },
  })));
  if (removeListener === null) throw new Error("Knowledge removal action was not bound.");
  const action = /** @type {() => void} */ (removeListener);
  action();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert(requests.some((request) => request.includes("POST /api/learning-generation/knowledge-remove")), "Library must call the paired knowledge removal endpoint.");
  assert(!page.render({}).includes("A cadence resolves musical tension."), "Removed knowledge must disappear from the current Library projection.");
});

Deno.test("Library controller searches retained knowledge across sources", async () => {
  const page = createLibraryPage({
    fetch: (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/source-library")) return Promise.resolve(Response.json({ result: { items: [source], interestAreas: [], nextCursor: null } }));
      if (url.pathname.endsWith("/library-knowledge")) return Promise.resolve(Response.json({ result: { items: [] } }));
      if (url.pathname.endsWith("/source-status")) return Promise.resolve(Response.json({ result: { sourceId: source.id, run: null, reasonCode: null, message: null } }));
      if (url.pathname.endsWith("/source-library/search")) {
        assert(url.searchParams.get("scope") === "knowledge", "A query without a scope must search knowledge.");
        return Promise.resolve(Response.json({ result: [{ knowledge: { knowledgeId: "knowledge-cadence", sourceId: source.id, sourceTitle: source.title, summary: "A cadence resolves harmonic tension.", sourceUrl: source.canonicalUrl, evidenceAnchorIds: ["anchor-cadence"], questionLocked: true }, score: 0.84, matchedBy: "semantic" }] }));
      }
      return Promise.resolve(Response.json({ error: "Not found" }, { status: 404 }));
    },
    gatewayBaseUrl: "https://app.example/",
    escapeHtml: (value) => value,
    formatDate: (value) => value,
    createId: () => "id-a",
    confirmDisable: () => true,
    createObserver: () => null,
    schedule: () => 1,
    cancel: () => {},
    onNotice: () => {},
    onError: () => {},
    rerender: () => {},
  });
  await page.load();
  const form = new FormData();
  form.set("query", "cadence");
  await page.search(form);
  const html = page.render({});
  assert(html.includes("A cadence resolves harmonic tension."), "Knowledge search must replace source cards with retained knowledge matches.");
  assert(html.includes('<a href="https://publisher.example/learn" target="_blank" rel="noopener noreferrer">Harmony source</a>'), "Knowledge search must preserve linked source provenance.");
  assert(html.includes("semantic match"), "Knowledge search must preserve the match type.");
});

Deno.test("Library defaults to knowledge search and preserves source topic from classification", async () => {
  let requestedScope = null;
  const page = createLibraryPage({
    fetch: (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/source-library")) return Promise.resolve(Response.json({ result: { items: [source], interestAreas: [], nextCursor: null } }));
      if (url.pathname.endsWith("/library-knowledge")) return Promise.resolve(Response.json({ result: { items: [{ knowledgeId: "k-topic", sourceId: source.id, sourceRevision: source.revision, questionId: "q-topic", title: "Point", summary: "A summary without the rare phrase.", sourceUrl: source.canonicalUrl, evidenceAnchorIds: ["anchor"], media: null, questionLocked: true, sourceClassification: { mainSubject: "music", topic: "Xylophone archival taxonomy" }, sourceClassificationRevision: 2 }] } }));
      if (url.pathname.endsWith("/source-status")) return Promise.resolve(Response.json({ result: { sourceId: source.id, run: null, reasonCode: null, message: null } }));
      if (url.pathname.endsWith("/source-library/search")) {
        requestedScope = url.searchParams.get("scope");
        return Promise.resolve(Response.json({ result: [{ knowledge: { knowledgeId: "k-topic", sourceId: source.id, sourceTitle: source.title, summary: "A summary without the rare phrase.", sourceUrl: source.canonicalUrl, evidenceAnchorIds: ["anchor"], questionLocked: true }, score: 1, matchedBy: "exact" }] }));
      }
      return Promise.resolve(Response.json({ error: "Not found" }, { status: 404 }));
    },
    gatewayBaseUrl: "https://app.example/", escapeHtml: (value) => value, formatDate: (value) => value,
    createId: () => "id-topic", confirmDisable: () => true, createObserver: () => null, schedule: () => 1, cancel: () => {}, onNotice: () => {}, onError: () => {}, rerender: () => {},
  });
  await page.load();
  const form = new FormData();
  form.set("query", "Xylophone archival taxonomy");
  await page.search(form);
  assert(requestedScope === "knowledge", "Default Library query searches retained knowledge.");
  assert(page.render({}).includes("A summary without the rare phrase."), "Topic-only hit renders without selecting a scope.");
});

Deno.test("Library renders source cards before secondary knowledge requests finish", async () => {
  /** @type {(response: Response) => void} */ let resolveKnowledge = () => {};
  const knowledgePending = new Promise((resolve) => {
    resolveKnowledge = resolve;
  });
  let rendered = "";
  /** @type {ReturnType<typeof createLibraryPage>} */ let page;
  page = createLibraryPage({
    fetch: (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/source-library")) return Promise.resolve(Response.json({ result: { items: [source], interestAreas: [], nextCursor: null } }));
      if (url.pathname.endsWith("/library-knowledge")) return knowledgePending;
      if (url.pathname.endsWith("/source-status")) return Promise.resolve(Response.json({ result: { sourceId: source.id, run: null, reasonCode: null, message: null } }));
      return Promise.resolve(Response.json({ error: "Not found" }, { status: 404 }));
    },
    gatewayBaseUrl: "https://app.example/",
    escapeHtml: (value) => value,
    formatDate: (value) => value,
    createId: () => "id-a",
    confirmDisable: () => true,
    createObserver: () => null,
    schedule: () => 1,
    cancel: () => {},
    onNotice: () => {},
    onError: () => {},
    rerender: () => {
      rendered = page.render({});
    },
  });
  const loading = page.load();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert(rendered.includes("Harmony source"), "Source cards must render before secondary knowledge loading completes.");
  resolveKnowledge(Response.json({ result: { items: [] } }));
  await loading;
});

Deno.test("Library controller loads workflow status so upload blockers survive a refresh", async () => {
  const page = createLibraryPage({
    fetch: (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/source-library")) return Promise.resolve(Response.json({ result: { items: [source], interestAreas: [], nextCursor: null } }));
      if (url.pathname.endsWith("/library-knowledge")) return Promise.resolve(Response.json({ result: { items: [] } }));
      if (url.pathname.endsWith("/source-status")) return Promise.resolve(Response.json({ result: { sourceId: "source-a", run: null, reasonCode: "paywall-or-login", message: "This source could not be scraped because it is behind a paywall or requires sign-in. Upload authorized text, PDF, PPTX, or a transcript instead." } }));
      return Promise.resolve(Response.json({ error: "Not found" }, { status: 404 }));
    },
    gatewayBaseUrl: "https://app.example/",
    escapeHtml: (value) => value,
    formatDate: (value) => value,
    createId: () => "id-a",
    confirmDisable: () => true,
    createObserver: () => null,
    schedule: () => 1,
    cancel: () => {},
    onNotice: () => {},
    onError: () => {},
    rerender: () => {},
  });
  await page.load();
  assert(page.render({}).includes("behind a paywall"), "Library must show the persisted workflow blocker after reload.");
});

Deno.test("Library controller retains prior source pages when continuation fails", async () => {
  let call = 0;
  const page = createLibraryPage({
    fetch: () => {
      call += 1;
      return Promise.resolve(call === 1
        ? Response.json({ result: { items: [source], interestAreas: [], nextCursor: "signed-next" } })
        : Response.json({ error: "SourceCursorStale" }, { status: 409 }));
    },
    gatewayBaseUrl: "https://app.example/",
    escapeHtml: (value) => value,
    formatDate: (value) => value,
    createId: () => "id-a",
    confirmDisable: () => true,
    createObserver: () => null,
    schedule: () => 1,
    cancel: () => {},
    onNotice: () => {},
    onError: () => {},
    rerender: () => {},
  });
  await page.load();
  await page.load(false);
  const html = page.render({});
  assert(html.includes("Harmony source"), "Loaded sources must remain visible.");
  assert(html.includes("Previously loaded sources remain below"), "The retained page must disclose its stale state.");
  assert(html.includes("Refresh sources"), "A stale continuation must offer a reset action.");
});

Deno.test("Library polls active workflow status and stops after completion", async () => {
  /** @type {{ readonly callback: () => void, readonly delayMs: number }[]} */
  const scheduled = [];
  let statusCalls = 0;
  let knowledgeCalls = 0;
  /** @type {string[]} */ const notices = [];
  const page = createLibraryPage({
    fetch: (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/source-library")) return Promise.resolve(Response.json({ result: { items: [source], interestAreas: [], nextCursor: null } }));
      if (url.pathname.endsWith("/library-knowledge")) {knowledgeCalls++;return Promise.resolve(Response.json({ result: { items: [] } }));}
      if (url.pathname.endsWith("/source-status")) {
        statusCalls += 1;
        const status=workflowStatus(statusCalls === 1 ? "extraction-loop" : "completed");
        return Promise.resolve(Response.json({ result: statusCalls===1?status:{...status,run:{...status.run,counts:{pages:1,knowledgePoints:1,acceptedQuizzes:1,pendingQuizzes:0}}} }));
      }
      return Promise.resolve(Response.json({ error: "Not found" }, { status: 404 }));
    },
    gatewayBaseUrl: "https://app.example/",
    escapeHtml: (value) => value,
    formatDate: (value) => value,
    createId: () => "id-a",
    confirmDisable: () => true,
    createObserver: () => null,
    schedule: (/** @type {() => void} */ callback, /** @type {number} */ delayMs) => {
      scheduled.push({ callback, delayMs });
      return scheduled.length;
    },
    cancel: () => {},
    onNotice: message => notices.push(message),
    onError: () => {},
    rerender: () => {},
  });
  await page.load();
  assert(notices.length === 0, "In-progress work must not announce completion.");
  assert(statusCalls === 1, "Library must load workflow status with the source list.");
  assert(scheduled.length === 1 && scheduled[0].delayMs === 60_000, "Active work must schedule one one-minute refresh.");
  assert(page.renderProcessingStatus().includes("Processing 1 source"), "The active source must be visible before the poll completes.");

  scheduled[0].callback();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert(notices.length === 1 && notices[0] === "Processing complete. Your knowledge and quizzes are ready in Library.", "A confirmed transition to published knowledge announces readiness.");
  await page.load();
  assert(notices.length === 1, "Reloading a completed source cannot repeat the notification.");
  assert(statusCalls === 3, "The scheduled refresh must fetch the latest workflow status.");
  assert(knowledgeCalls === 3, "Completion must reload classified knowledge and quizzes without a manual refresh.");
  assert(!page.renderProcessingStatus().includes('data-library-processing-status'), "The chip must disappear after the source completes.");
  assert(scheduled.length === 1, "Polling must stop after a terminal workflow state.");
});

Deno.test("Library preserves a known active status when a poll fails", async () => {
  /** @type {(() => void)[]} */ const scheduled = [];
  /** @type {string[]} */ const errors = [];
  let statusCalls = 0;
  const page = createLibraryPage({
    fetch: (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/source-library")) return Promise.resolve(Response.json({ result: { items: [source], interestAreas: [], nextCursor: null } }));
      if (url.pathname.endsWith("/library-knowledge")) return Promise.resolve(Response.json({ result: { items: [] } }));
      if (url.pathname.endsWith("/source-status")) {
        statusCalls += 1;
        return statusCalls === 1
          ? Promise.resolve(Response.json({ result: workflowStatus("extraction-loop") }))
          : Promise.resolve(Response.json({ error: "temporary status outage" }, { status: 503 }));
      }
      return Promise.resolve(Response.json({ error: "Not found" }, { status: 404 }));
    },
    gatewayBaseUrl: "https://app.example/",
    escapeHtml: (value) => value,
    formatDate: (value) => value,
    createId: () => "id-a",
    confirmDisable: () => true,
    createObserver: () => null,
    schedule: (/** @type {() => void} */ callback) => {
      scheduled.push(callback);
      return scheduled.length;
    },
    cancel: () => {},
    onNotice: () => {},
    onError: (message) => errors.push(message),
    rerender: () => {},
  });
  await page.load();
  scheduled[0]();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert(page.render({}).includes("Harmony source"), "A status outage must not erase the Library source.");
  assert(page.renderProcessingStatus().includes("Processing 1 source"), "A status outage must retain the last confirmed processing state.");
  assert(errors.length === 1, "A status outage must be reported to the user.");
  assert(scheduled.length === 2, "A known active source may retry with one replacement poll after a transient status failure.");
});

Deno.test("Library uses approved descriptive copy and keeps intake on Upload", () => {
  const html = renderLibraryRoute(baseModel());
  assert(html.includes('<h1 id="library-title">Library</h1>'), "Library heading must name the panel.");
  assert(html.includes("Browse saved sources, search extracted knowledge, and check processing status."), "Library subtitle must explain its purpose.");
  assert(!html.includes("data-library-upload"), "Intake belongs on Upload.");
  assert(html.includes("shares your query and text from up to 20 candidates with OpenRouter"), "Consent must identify data and recipient.");
});

Deno.test("Upload attaches validated source context without depending on Library pagination", async () => {
  let uploaded = false;
  const page = createLibraryPage({
    fetch: async (url, init) => {
      if(String(url).includes("source-status")) return Response.json({result:workflowStatus("extraction-loop")});
      assert(String(url).endsWith("/material"), "Bound upload must never create a private source or read pagination.");
      const command = JSON.parse(String(init?.body));
      assert(command.sourceId === source.id && command.runId === "run-a" && command.sourceRevision === source.revision, "Bound material keeps current identity and revision.");
      uploaded = true;
      return Response.json({result:{status:"attached",materialId:"material-a",runId:"run-a",reused:false}});
    }, gatewayBaseUrl:"https://app.example/", escapeHtml:value=>value, formatDate:value=>value, createId:()=>"id", confirmDisable:()=>true, createObserver:()=>null, schedule:()=>1, cancel:()=>{},onNotice:()=>{},onError:()=>{},rerender:()=>{},
  });
  const form = new FormData(); form.set("title",source.title);form.set("content","Synthetic material");form.set("attested","on");
  await page.uploadMaterial(source.id,form,{source,runId:"run-a",reason:"Authorized material required."});
  assert(uploaded,"Validated source-bound upload must work after direct navigation.");
});
Deno.test("Upload material failure retains inline retry context without a global toast", async () => {
  /** @type {string[]} */ const errors = [];
  let materialRequests = 0;
  /** @type {typeof fetch} */ const fetchFixture = async (url) => {
    const path = new URL(String(url)).pathname;
    if (path.endsWith("/upload-context")) return Response.json({ result: { source, runId: "run-a", reason: "Authorized material required." } });
    if (path.endsWith("/source-status")) return Response.json({result:workflowStatus("awaiting-upload")});
    assert(path.endsWith("/material"), `Unexpected upload fixture request: ${path}`);
    materialRequests += 1;
    return Response.json({ error: "SyntheticUnavailable" }, { status: 503 });
  };
  const library = createLibraryPage({
    fetch: fetchFixture, gatewayBaseUrl: "https://app.example/",
    escapeHtml: value => value, formatDate: value => value, createId: () => "id",
    confirmDisable: () => true, createObserver: () => null, schedule: () => 1,
    cancel: () => {}, onNotice: () => {}, onError: message => errors.push(message), rerender: () => {},
  });
  const upload = createUploadPage({
    fetch: fetchFixture, baseUrl: "https://app.example/", createId: () => "id",
    onChange: () => {}, onRenamed: () => {},
    upload: async (sourceId, form, context) => {
      await library.uploadMaterial(sourceId, form, context);
      return library.uploadResult();
    },
  });
  await upload.load("#upload?sourceId=source-a&runId=run-a");
  assert(errors.length === 0, "Loading upload context must not call onError.");
  const form = new FormData();
  form.set("title", source.title);
  form.set("content", "Synthetic retained retry draft.");

  assert(await upload.submit(form) === false, "Material failure must report an unsuccessful upload.");
  assert(materialRequests === 1, "The regression must reach the failing material endpoint exactly once.");
  const html = upload.render();
  assert(html.includes(`Title saved. Upload failed: ${library.uploadResult().message} Your draft is ready to retry.`), "Upload must retain its inline failure and retry message.");
  assert(html.includes("Authorized material required.") && html.includes(source.title), "Upload must retain its source context and title.");
  assert(html.includes("Synthetic retained retry draft."), "Upload must retain the material draft for retry.");
  assert(html.includes("Upload and process") && !html.includes(' disabled'), "Upload must re-enable submission for retry.");
  assert(errors.length === 0, `Upload material failure must not call global onError; received ${errors.length} call(s): ${JSON.stringify(errors)}`);
});

Deno.test("Library refresh invalidates previously loaded knowledge before replacement arrives", async () => {
  let reads = 0;
  const page = createLibraryPage({fetch:async url=>{
    if(String(url).includes("library-knowledge")) return ++reads === 1 ? Response.json({result:{items:[{knowledgeId:"k",sourceId:source.id,sourceRevision:source.revision,sourceClassification:{mainSubject:"music",topic:"Previously retained idea"},sourceClassificationRevision:0,questionId:"q",title:source.title,summary:"A point summary",sourceUrl:source.canonicalUrl,evidenceAnchorIds:["a"],media:null,questionLocked:true}]}}) : Response.json({error:"Unavailable"},{status:503});
    if(String(url).includes("source-status")) return Response.json({result:{sourceId:source.id,run:null,reasonCode:null,message:null}});
    return Response.json({result:{items:[source],interestAreas:[],nextCursor:null}});
  },gatewayBaseUrl:"https://app.example/",escapeHtml:value=>value,formatDate:value=>value,createId:()=>"id",confirmDisable:()=>true,createObserver:()=>null,schedule:()=>1,cancel:()=>{},onNotice:()=>{},onError:()=>{},rerender:()=>{}});
  await page.load(); assert(page.render({}).includes("A point summary"),"Initial retained knowledge is shown.");
  await page.load(); assert(!page.render({}).includes("A point summary"),"Failed refresh cannot leave stale knowledge visible.");
});
Deno.test("Source search invalidates old knowledge when the source revision changes", async () => {
 let reads=0;
 const page=createLibraryPage({fetch:async url=>{
  const path=new URL(String(url)).pathname;
  if(path.endsWith("library-knowledge"))return Response.json({result:{items:++reads===1?[{knowledgeId:"k",sourceId:source.id,questionId:"q",title:source.title,summary:"Old revision knowledge",sourceUrl:source.canonicalUrl,evidenceAnchorIds:["a"],media:null,questionLocked:true}]:[]}});
  if(path.endsWith("source-status"))return Response.json({result:{sourceId:source.id,run:null,reasonCode:null,message:null}});
  if(path.endsWith("/search"))return Response.json({result:[{source:{...source,revision:3},score:1,matchedBy:"exact"}]});
  return Response.json({result:{items:[source],interestAreas:[],nextCursor:null}});
 },gatewayBaseUrl:"https://app.example/",escapeHtml:value=>value,formatDate:value=>value,createId:()=>"id",confirmDisable:()=>true,createObserver:()=>null,schedule:()=>1,cancel:()=>{},onNotice:()=>{},onError:()=>{},rerender:()=>{}});
 await page.load();const form=new FormData();form.set("query","Harmony");form.set("searchScope","sources");await page.search(form);
 assert(!page.render({}).includes("Old revision knowledge"),"Source search must not reattach stale knowledge from a previous revision.");
});

Deno.test("Contextual image upload is checkbox-free and ignores stale image state", async () => {
 /** @type {FormData|null} */ let sent=null;
 const page=createLibraryPage({fetch:async(input,init)=>{
  if(String(input).includes("/material")){sent=/** @type {FormData} */(init?.body);return Response.json({result:{status:"attached",materialId:"m",runId:"run-a",reused:false}});}
  if(String(input).includes("source-status"))return Response.json({result:workflowStatus("extraction-loop")});
  return Response.json({error:"Unexpected"},{status:404});
 },gatewayBaseUrl:"https://app.example/",escapeHtml:v=>v,formatDate:v=>v,createId:()=>"id",confirmDisable:()=>false,createObserver:()=>null,schedule:()=>1,cancel:()=>{},onNotice:()=>{},onError:()=>{},rerender:()=>{}});
 const form=new FormData();form.set("title",source.title);form.set("file",new File([new Uint8Array([137,80,78,71,13,10,26,10])],"image.png",{type:"image/png"}));form.set("imageProcessing","off");
 await page.uploadMaterial(source.id,form,{source,runId:"run-a",reason:"awaiting attachment"});
 assert(page.uploadResult().ok,"Context upload must work without checkbox.");
 assert(/** @type {FormData|null} */(sent)?.get("mode")==="image","Image mode must be unconditional.");
});

Deno.test("Library exposes cancellation for active attempts and retains explicit image warnings",()=>{
  const status=workflowStatus("extraction-loop");
  const html=renderLibraryRoute({...baseModel(),workflowStatuses:[{...status,message:"Image warning: MediaStorageFailed. Text retained."}]});
  assert(html.includes('data-library-workflow-cancel="run-source-a"'),"Active run must expose cancellation");
  assert(html.includes('MediaStorageFailed'),"Image warning must be visible");
  for(const state of ["completed","abandoned"])assert(!renderLibraryRoute({...baseModel(),workflowStatuses:[workflowStatus(state)]}).includes("data-library-workflow-cancel"),"Terminal attempt cannot be canceled again");
});

Deno.test("failed cancellation remains retryable after the run is already abandoned",()=>{
  const html=renderLibraryRoute({...baseModel(),workflowStatuses:[workflowStatus("abandoned")],cancellationRetries:["run-source-a"]});assert(html.includes('data-library-workflow-cancel="run-source-a"'),"Cleanup/termination retry must remain available");
});

/** @returns {import('../src/features/knowledge-workflows/progress.js').WorkflowProgress} */
function sampleProgress(){return {currentUrl:'https://publisher.example/learn/lesson-2',pageTitle:'Rhythm <lesson>',sectionTitle:'2.1 Meter & pulse',stage:'Extracting knowledge',updatedAt:'2026-10-13T10:00:00.000Z',knowledgePoints:[{knowledgeId:'knowledge-a',summary:'A beat groups durations into recurring patterns.'}],generatedQuizQuestions:2,processedPageCount:1,totalPages:3};}
Deno.test('Library source card renders current lesson, section, extracted summaries and actual quiz question count accessibly',()=>{
 const status={...workflowStatus('extraction-loop'),run:{...workflowStatus('extraction-loop').run,progress:sampleProgress()}};
 const html=renderLibraryRoute({...baseModel(),workflowStatuses:[status]});
 for(const label of ['Extracting knowledge','1 knowledge point','2 quiz questions generated','2.1 Meter &amp; pulse','A beat groups durations into recurring patterns.','1 of 3','Updates every minute while processing.'])assert(html.includes(label),`Missing source progress information: ${label}`);
 assert(html.includes('<progress aria-label="Pages processed" max="3" value="1"'),'Progress shows measured pages without inventing an overall percentage.');
 assert(!html.includes('<details open>')&&!html.includes('Rhythm &lt;lesson>')&&!html.includes('https://publisher.example/learn/lesson-2'),'Summaries start collapsed and transport diagnostics stay out of the card.');
 assert(html.includes('library-processing-spinner'),'An actively processing source has a loading indicator.');
 assert(html.includes('data-library-workflow-progress')&&html.includes('aria-live="polite"')&&html.includes('aria-labelledby="library-progress-source-a"'),'Source-scoped status must be labeled and announced politely.');
 assert(!html.includes('Rhythm <lesson>'),'External page titles must be escaped.');
 assert(html.indexOf('data-library-workflow-progress')>html.indexOf('data-library-source="source-a"'),'Progress must render inside its source card.');
 assert(!renderLibraryRoute({...baseModel(),workflowStatuses:[{...status,run:{...status.run,state:'abandoned'}}]}).includes('A beat groups'),'Canceled run output must disappear from the card.');
 for(const origin of /** @type {const} */(['web','private-document'])){
   const card=renderLibraryRoute({...baseModel(),collection:{...baseModel().collection,items:[{...source,origin}]},workflowStatuses:[status]});
   assert(card.includes('library-processing-spinner')&&card.includes('<progress'),'Web sources and uploaded documents share active progress feedback.');
   assert(card.includes(origin==='web'?'publisher.example':'Uploaded material'),'Source identity is readable for each origin.');
 }
});

Deno.test('Library polls only active source statuses every minute and dispose invalidates scheduled work',async()=>{
 const requests=/** @type {string[]} */([]),timers=new Map();let next=0;
 const page=createLibraryPage({fetch:async input=>{const url=new URL(String(input));if(url.pathname.endsWith('/source-library'))return Response.json({result:{items:[source,sourceB],interestAreas:[],nextCursor:null}});if(url.pathname.endsWith('/library-knowledge'))return Response.json({result:{items:[]}});const id=url.searchParams.get('sourceId')??'';requests.push(id);return Response.json({result:workflowStatus(id===source.id?'extraction-loop':'completed',id)});},gatewayBaseUrl:'https://app.example/',escapeHtml:v=>v,formatDate:v=>v,createId:()=> 'id',confirmDisable:()=>true,createObserver:()=>null,schedule:(callback,delay)=>{timers.set(++next,{callback,delay});return next;},cancel:id=>{timers.delete(id);},onNotice:()=>{},onError:()=>{},rerender:()=>{}});
 await page.load();assert(requests.length===2,'Initial status read includes each loaded source.');const initial=[...timers.values()][0];assert(initial.delay===60000,'Processing card refresh cadence is one minute.');timers.clear();initial.callback();await new Promise(r=>setTimeout(r,0));assert(requests.join(',')==='source-a,source-b,source-a','Terminal sources are not re-polled.');const stale=[...timers.values()][0];page.dispose();assert(timers.size===0,'Disposal removes the timer.');stale.callback();await new Promise(r=>setTimeout(r,0));assert(requests.length===3,'An already queued callback cannot fetch after unmount.');
 await page.resume();assert(timers.size===1,'Restoring a mounted controller resumes exactly one poll.');page.dispose();
});

Deno.test('Cancel processing asks confirmation, preserves data on decline, and removes the source card before refresh finishes',async()=>{
 let confirmed=false,canceled=false,disabled=false,posts=0,confirmations=0,refreshPending=false;
 /** @type {(response:Response)=>void} */let finishRefresh=()=>{};
 const pending=new Promise(resolve=>{finishRefresh=resolve;});
 const active={...workflowStatus('extraction-loop'),run:{...workflowStatus('extraction-loop').run,progress:sampleProgress()}};
 const knowledgeCard={knowledgeId:'knowledge-a',sourceId:source.id,sourceRevision:source.revision,questionId:'q-a',title:'Point',summary:'A beat groups durations into recurring patterns.',sourceUrl:source.canonicalUrl,evidenceAnchorIds:['anchor'],media:null,questionLocked:false,sourceClassification:null,sourceClassificationRevision:0};
 const page=createLibraryPage({fetch:async(input,init)=>{const url=new URL(String(input));if(url.pathname.endsWith('/source-library'))return Response.json({result:{items:disabled?[]:[source],interestAreas:[],nextCursor:null}});if(url.pathname.endsWith('/disable')){assert(canceled,'Stop processing before removing the source.');const command=JSON.parse(String(init?.body));assert(command.sourceId===source.id&&command.expectedRevision===source.revision,'Remove only the selected source at its known revision.');disabled=true;return Response.json({result:{...source,state:'disabled',revision:source.revision+1}});}if(url.pathname.endsWith('/library-knowledge')){if(canceled){refreshPending=true;return await pending;}return Response.json({result:{items:[knowledgeCard]}});}if(url.pathname.endsWith('/control')){posts++;const command=JSON.parse(String(init?.body));assert(command.action==='abandon'&&command.runId===active.run.runId,'Cancel command must target the selected run.');canceled=true;return Response.json({result:{...workflowStatus('abandoned').run,revision:2}});}return Response.json({result:canceled?workflowStatus('abandoned'):active});},gatewayBaseUrl:'https://app.example/',escapeHtml:v=>v,formatDate:v=>v,createId:()=> 'id',confirmDisable:()=>true,confirmCancel:()=>{confirmations++;return confirmed;},createObserver:()=>null,schedule:()=>1,cancel:()=>{},onNotice:()=>{},onError:()=>{},rerender:()=>{}});
 await page.load();
 /** @type {(()=>void)|null} */let listener=null;
 page.bind(/** @type {HTMLElement} */(/** @type {unknown} */({querySelector:()=>null,querySelectorAll:(/** @type {string} */selector)=>selector==='[data-library-workflow-retry], [data-library-workflow-cancel]'?[{hasAttribute:(/** @type {string} */name)=>name==='data-library-workflow-cancel',getAttribute:(/** @type {string} */name)=>name==='data-library-workflow-cancel'?'run-source-a':'1',addEventListener:(/** @type {string} */_event,/** @type {()=>void} */handler)=>{listener=handler;}}]:[]})));
 if(listener===null)throw new Error('Cancel action not bound.');const click=/** @type {()=>void} */(listener);click();await new Promise(r=>setTimeout(r,0));assert(confirmations===1&&posts===0,'Declining confirmation cannot dispatch cancellation.');assert(page.render({}).includes(knowledgeCard.summary),'Declined cancellation preserves extracted content.');
 confirmed=true;click();await new Promise(r=>setTimeout(r,0));assert(confirmations===2&&posts===1&&refreshPending,'Confirmed cancellation dispatches once and immediately refreshes knowledge.');assert(disabled&&!page.render({}).includes('data-library-source="source-a"'),'Canceled source card disappears while the refresh is still pending.');assert(!page.render({}).includes(knowledgeCard.summary),'Purged summaries disappear while the refresh is still pending.');assert(!page.renderProcessingStatus().includes('Processing'),'Confirmed canceled run stops the processing indicator immediately.');finishRefresh(Response.json({result:{items:[]}}));await new Promise(r=>setTimeout(r,0));canceled=false;await page.load();assert(!page.render({}).includes('data-library-source="source-a"'),"Removed source stays absent after reloading Library.");page.dispose();
});

Deno.test('Extraction redirect opens a reused source on a later Library page and focuses its own shelf card',async()=>{
 const descriptor=Object.getOwnPropertyDescriptor(globalThis,'HTMLElement');
 let focused=false,scrolled=false;
 class FocusCard {isConnected=true;getAttribute(){return source.id;}setAttribute(){}focus(){focused=true;}scrollIntoView(){scrolled=true;}}
 Object.defineProperty(globalThis,'HTMLElement',{configurable:true,value:FocusCard});
 try{
  const scheduled=/** @type {{callback:()=>void,delay:number}[]} */([]);const card=new FocusCard();
  const point={knowledgeId:'knowledge-a',sourceId:source.id,sourceRevision:source.revision,questionId:'q-a',title:'Point',summary:'Synthetic retained point.',sourceUrl:source.canonicalUrl,evidenceAnchorIds:['a'],media:null,questionLocked:true,sourceClassification:{mainSubject:'music',topic:'Meter'},sourceClassificationRevision:1};
  const page=createLibraryPage({fetch:async input=>{const url=new URL(String(input));if(url.pathname.endsWith('/source-library'))return Response.json({result:{items:[url.searchParams.has('cursor')?source:sourceB],interestAreas:[],nextCursor:url.searchParams.has('cursor')?null:'second-page'}});if(url.pathname.endsWith('/library-knowledge'))return Response.json({result:{items:[point]}});return Response.json({result:workflowStatus('completed',url.searchParams.get('sourceId')??source.id)});},gatewayBaseUrl:'https://app.example/',storage:{getItem:()=> 'science',setItem:()=>{}},escapeHtml:v=>v,formatDate:v=>v,createId:()=> 'id',confirmDisable:()=>true,createObserver:()=>null,schedule:(callback,delay)=>{scheduled.push({callback,delay});return scheduled.length;},cancel:()=>{},onNotice:()=>{},onError:()=>{},rerender:()=>{}});
  await page.revealSource(source.id);const html=page.render({});assert(html.includes('data-library-source="source-a"'),'The selected source must be loaded even on a later catalog page.');assert(html.includes('value="music" selected'),'Extraction opens the shelf containing the selected source.');assert(html.includes('data-focus-key="library-source:source-a"'),'Card focus identity must survive later progress refreshes.');
  page.bind(/** @type {HTMLElement} */(/** @type {unknown} */({querySelector:()=>null,querySelectorAll:(/** @type {string} */selector)=>selector==='[data-library-source]'?[card]:[]})));
  const focus=scheduled.find(item=>item.delay===0);assert(focus!==undefined,'Card focus follows rendering, without waiting for a status interval.');focus?.callback();assert(focused&&scrolled,'The matching card receives keyboard focus and is brought into view.');page.dispose();
 }finally{if(descriptor)Object.defineProperty(globalThis,'HTMLElement',descriptor);else Reflect.deleteProperty(globalThis,'HTMLElement');}
});

Deno.test("Library awaiting upload overrides stale progress and does not imply active extraction", () => {
  for (const message of [null, "Automatic scraping is blocked because permission is not verified."]) {
    const waiting = workflowStatus("awaiting-upload");
    const html = renderLibraryRoute({...baseModel(), workflowStatuses:[{...waiting, message, run:{...waiting.run, progress:sampleProgress()}}]});
    assert(html.includes(message ?? "Processing is paused. Action is required to continue."), "Waiting status must describe the required action.");
    assert(!html.includes("Extracting knowledge") && !html.includes("completing the knowledge workflow"), "Stale progress cannot imply ongoing extraction.");
    assert(!html.includes("library-processing-spinner") && !html.includes("Updates every minute"), "Waiting for upload is not active processing.");
    assert(html.includes("Upload text or documents"), "The recovery action stays available.");
  }
});

Deno.test("Library retains failed source and offers a titled upload before removal",async()=>{
 const errors=/** @type {string[]} */([]);let failed=false;const timers=/** @type {(()=>void)[]} */([]);const uploads=/** @type {string[]} */([]);let prompts=0;let promptedUrl;
 const page=createLibraryPage({fetch:async input=>{const u=new URL(String(input));if(u.pathname.endsWith("/source-library"))return Response.json({result:{items:[source],interestAreas:[],nextCursor:null}});if(u.pathname.endsWith("/library-knowledge"))return Response.json({result:{items:[]}});return Response.json({result:failed?{...workflowStatus("awaiting-upload"),reasonCode:"failed",message:"Automatic processing failed. Would you like to upload source-related text or documents instead?"}:workflowStatus("extraction-loop")});},gatewayBaseUrl:"https://app.example/",escapeHtml:v=>v,formatDate:v=>v,createId:()=>"id",confirmDisable:()=>true,confirmUpload:(_message,url)=>{prompts++;promptedUrl=url;return true;},navigateToUpload:hash=>uploads.push(hash),createObserver:()=>null,schedule:callback=>{timers.push(callback);return timers.length;},cancel:()=>{},onNotice:()=>{},onError:message=>errors.push(message),rerender:()=>{}});
 await page.load();assert(page.render({}).includes(source.title),"Processing source is visible.");failed=true;timers[0]();await new Promise(r=>setTimeout(r,0));assert(page.render({}).includes(source.title),"Failed source stays until the learner chooses.");assert(errors.length===0,"Popup must not duplicate the failure in a toast.");assert(promptedUrl===source.canonicalUrl,"Confirmation receives the website URL.");const html=page.render({});assert(html.includes("#upload?sourceId=source-a") && html.includes("runId=run-source-a"),"Upload link identifies the source whose title is loaded by Upload.");assert(html.includes("data-library-disable"),"Removal remains an explicit learner choice.");assert(prompts===1 && uploads[0].includes("sourceId=source-a") && uploads[0].includes("runId=run-source-a"),"Confirmed failure popup redirects to the bound Upload route.");page.dispose();
});

function partialStatus() {
  const completed = workflowStatus("completed");
  return { ...completed, reasonCode: "partial-failure", run: { ...completed.run, revision: 4, failureKind: "WorkflowPagesFailed", progress: { ...sampleProgress(), failedItems: [{ url: "https://publisher.example/learn#section=page-3", title: "Page <3>", failureKind: "KnowledgeReviewOutputInvalid", attempts: 2 }] } } };
}
Deno.test("Library completion removes progress while preserving failed-unit reports and retries", () => {
  {
  const partial = partialStatus();
  partial.run.progress.processedPageCount = 17; partial.run.progress.totalPages = 23;
  partial.run.progress.failedItems = Array.from({ length: 6 }, (_, index) => ({ ...partial.run.progress.failedItems[0], title: `Page ${index + 1}` }));
  const completedReport = renderLibraryRoute({ ...baseModel(), workflowStatuses: [partial] });
  assert(!completedReport.includes("<progress") && !completedReport.includes("data-library-workflow-progress"), "Completed partial work removes the finished processing panel.");
  assert(partial.run.progress.processedPageCount === 17 && completedReport.includes("Failed items (6)"), "Attempted progress must not change successful counts or hide the failure report.");
  const active = renderLibraryRoute({ ...baseModel(), workflowStatuses: [{ ...partial, run: { ...partial.run, state: "extraction-loop" } }] });
  assert(active.includes('value="17" class="library-processing-spinner"') && active.includes("17 of 23 pages reviewed"), "Active processing preserves successful counts and motion.");
  const successful = renderLibraryRoute({ ...baseModel(), workflowStatuses: [{ ...partial, reasonCode: "completed", run: { ...partial.run, progress: { ...partial.run.progress, processedPageCount: 23, failedItems: [] } } }] });
  assert(!successful.includes("<progress") && !successful.includes("need retry") && !successful.includes("library-processing-spinner"), "Successful completion removes the finished progress panel and retry wording.");
  }
  for (const title of ["https://publisher.example/learn — captured page.pdf.pkpi — Page 3", "My document.pdf — Page 3", "How transformers work — Page 3", "My captured page.pdf.pkpi — Page 3"]) {
    const state = partialStatus(); state.run.progress.failedItems[0].title = title;
    const report = renderLibraryRoute({ ...baseModel(), workflowStatuses: [state] });
    const expected = title.startsWith("https://") ? "Page 3" : title;
    assert(report.includes(`>${expected}</a>`), "Only the internal URL capture label is shortened; user filenames and ordinary page titles remain intact.");
    if (title.startsWith("https://")) assert(!report.includes("captured page.pdf.pkpi"), "Legacy internal capture filenames must not clutter the failed item report.");
  }
  const html = renderLibraryRoute({ ...baseModel(), workflowStatuses: [partialStatus()] });
  for (const text of ["Failed items (1)", "Page &lt;3>", "The review response was invalid.", "2 attempts", "Retry failed items", "Successful knowledge and quizzes are retained."]) assert(html.includes(text), `Missing partial completion detail: ${text}`);
  assert(!html.includes("library-processing-spinner") && !html.includes("Updates every minute"), "Partial completion stops processing motion and polling copy.");
  assert(!html.includes("quality checks"), "Malformed reviewer output is a technical failure, not a negative quality decision.");
  assert(!html.includes("KnowledgeReviewOutputInvalid") && html.includes('rel="noopener noreferrer"'), "Failure codes stay internal and unit links retain safe external-link attributes.");
  const partial = partialStatus();
  const interrupted = renderLibraryRoute({ ...baseModel(), workflowStatuses: [{ ...partial, run: { ...partial.run, progress: { ...partial.run.progress, failedItems: [{ url: "https://publisher.example/learn#section=page-9", title: "Page 9", failureKind: "WorkflowProcessingInterrupted", attempts: 1 }] } } }] });
  assert(interrupted.includes("Processing was interrupted before this item finished.") && !interrupted.includes("after retries"), "Interruption must not falsely claim exhausted retries.");
  const active = renderLibraryRoute({ ...baseModel(), workflowStatuses: [{ ...partialStatus(), reasonCode: null, run: { ...partialStatus().run, state: "extraction-loop" } }] });
  assert(!active.includes("remaining items has finished") && !active.includes("Retry failed items"), "Recorded failures cannot claim completion while remaining extraction is active.");
});

Deno.test("Library asks once after completion, keeps report on decline, and retries only after approval", async () => {
  for (const cold of [false, true]) {
    let completed = cold, approved = false, prompts = 0, posts = 0;
    /** @type {(()=>void)[]} */ const timers = [];
    /** @type {string[]} */ const errors = [];
    /** @type {(()=>void)|null} */ let click = null;
    const page = createLibraryPage({
      fetch: async (input, init) => {
        const path = new URL(String(input)).pathname;
        if (path.endsWith("/source-library")) return Response.json({ result: { items: [source], interestAreas: [], nextCursor: null } });
        if (path.endsWith("/library-knowledge")) return Response.json({ result: { items: [] } });
        if (path.endsWith("/control")) {
          posts++; const command = JSON.parse(String(init?.body));
          assert(command.action === "resume" && command.expectedRevision === 4 && command.runId === "run-source-a", "Approval must resume the exact failed run revision.");
          completed = false;
          return Response.json({ result: { ...workflowStatus("extraction-loop").run, revision: 5 } });
        }
        return Response.json({ result: completed ? partialStatus() : workflowStatus("extraction-loop") });
      }, gatewayBaseUrl: "https://app.example/", escapeHtml: baseModel().escapeHtml, formatDate: v => v,
      createId: () => "id", confirmDisable: () => true,
      confirmRetryFailed: count => { prompts++; assert(count === 1, "Modal must report failed count."); assert(page.render({}).includes("Failed items (1)"), "The report must render before asking approval."); return approved; },
      createObserver: () => null, schedule: callback => { timers.push(callback); return timers.length; }, cancel: () => {},
      onNotice: () => {}, onError: message => errors.push(message), rerender: () => {},
    });
    await page.load();
    assert(prompts === 0 && posts === 0, "Initial navigation cannot auto-retry or interrupt an already completed report.");
    if (!cold) { completed = true; timers[0](); await new Promise(r => setTimeout(r, 0)); assert(prompts === 1 && posts === 0, "Declining transition approval must keep successful output and avoid retry."); }
    page.dispose(); await page.resume();
    assert(prompts === (cold ? 0 : 1), "Repeated status reads cannot prompt twice for the same completion revision.");
    assert(page.render({}).includes("Retry failed items") && errors.length === 0, "Decline leaves a retry button and report without a duplicate failure toast.");
    page.bind(/** @type {HTMLElement} */ (/** @type {unknown} */ ({ querySelector: () => null, querySelectorAll: (/** @type {string} */ selector) => selector === "[data-library-workflow-retry], [data-library-workflow-cancel]" ? [{ hasAttribute: () => false, getAttribute: (/** @type {string} */ name) => name.endsWith("revision") ? "4" : "run-source-a", addEventListener: (/** @type {string} */ _event, /** @type {()=>void} */ callback) => { click = callback; } }] : [] })));
    if (click === null) throw new Error("Retry action not bound");
    approved = true; const retry = /** @type {()=>void} */ (click); retry();
    await new Promise(r => setTimeout(r, 0));
    assert(posts === 1, "Explicit approval dispatches one failed-item retry.");
    page.dispose();
  }
});

Deno.test("All-failed public source offers a new manual upload without binding the completed run", async () => {
  const state = partialStatus();
  let target = "";
  /** @type {import('../src/features/uploads/page.js').UploadPrefill|undefined} */ let prefill;
  /** @type {(()=>void)|null} */ let click = null;
  const page = createLibraryPage({ fetch: async input => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/source-library")) return Response.json({ result: { items: [source], interestAreas: [], nextCursor: null } });
    if (path.endsWith("/library-knowledge")) return Response.json({ result: { items: [] } });
    return Response.json({ result: state });
  }, gatewayBaseUrl: "https://app.example/", escapeHtml: baseModel().escapeHtml, formatDate: v => v,
  createId: () => "id", confirmDisable: () => false, navigateToUpload: (hash, value) => { target = hash; prefill = value; },
  createObserver: () => null, schedule: () => 1, cancel: () => {}, onNotice: () => {}, onError: () => {}, rerender: () => {} });
  await page.load();
  assert(page.render({}).includes("Upload source content"), "An all-failed website must retain the manual fallback action.");
  page.bind(/** @type {HTMLElement} */ (/** @type {unknown} */ ({ querySelector: () => null, querySelectorAll: (/** @type {string} */ selector) => selector === "[data-library-manual-source]" ? [{ getAttribute: () => source.id, addEventListener: (/** @type {string} */ _event, /** @type {()=>void} */ handler) => { click = handler; } }] : [] })));
  if (click === null) throw new Error("Manual action not bound");
  const handoff = /** @type {()=>void} */ (click); handoff();
  assert(target === "#upload" && prefill?.title === source.title && prefill?.url === source.canonicalUrl && prefill?.manual === true, "Manual intake receives the title and URL without sourceId/runId binding.");
  page.dispose();
});

Deno.test("Library separates failed quiz and page reports and approves the exact retry target",async()=>{
 for(const quizzes of [false,true]){
  const partial=partialStatus();
  const failedQuizItems=[{knowledgeId:"point-failed",summary:"Retained <point>",failureKind:"KnowledgeModelUnavailable",attempts:4}];
  const state={...partial,run:{...partial.run,failureKind:"WorkflowQuizItemsFailed",counts:{...partial.run.counts,knowledgePoints:3,acceptedQuizzes:2},progress:{...partial.run.progress,generatedQuizQuestions:4,failedQuizItems}}};
  let approved=false,posts=0;let promptCount=0;
  /** @type {(()=>void)|undefined} */ let click;
  const page=createLibraryPage({fetch:async(input,init)=>{
   const path=new URL(String(input)).pathname;
   if(path.endsWith("/source-library"))return Response.json({result:{items:[source],interestAreas:[],nextCursor:null}});
   if(path.endsWith("/library-knowledge"))return Response.json({result:{items:[]}});
   if(path.endsWith("/control")){posts++;const command=JSON.parse(String(init?.body));assert(command.action===(quizzes?"retry-quizzes":"resume"),"Only the approved quiz/page action is sent.");assert(command.expectedRevision===4,"Approval remains revision-bound.");return Response.json({result:{...state.run,state:quizzes?"per-point-quiz-loop":"extraction-loop",revision:5}});}
   return Response.json({result:state});
  },gatewayBaseUrl:"https://app.example/",escapeHtml:baseModel().escapeHtml,formatDate:v=>v,createId:()=>"quiz-fixture",confirmDisable:()=>false,
  confirmRetryFailed:(count,target)=>{promptCount++;assert(count===1&&!!target===quizzes,"Confirmation count and target match the clicked report.");return approved;},createObserver:()=>null,schedule:()=>1,cancel:()=>{},onNotice:()=>{},onError:()=>{},rerender:()=>{}});
  await page.load();
  const html=page.render({});
  for(const text of ["Failed items (1)","Failed quiz items (1)","Retained &lt;point>","4 attempts","saved drafts are retained","Retry failed items","Retry failed quizzes"])assert(html.includes(text),`Missing separate report detail ${text}`);
  assert(!html.includes("KnowledgeModelUnavailable")&&!html.includes("library-processing-spinner"),"Internal codes and processing motion stay absent after partial completion.");
  assert(promptCount===0&&posts===0,"Cold completed reports do not prompt or retry automatically.");
  page.bind(/** @type {HTMLElement} */(/** @type {unknown} */({querySelector:()=>null,querySelectorAll:(/** @type {string} */ selector)=>selector==="[data-library-workflow-retry], [data-library-workflow-cancel]"?[{hasAttribute:(/** @type {string} */ name)=>name==="data-library-workflow-quiz"&&quizzes,getAttribute:(/** @type {string} */ name)=>name.endsWith("revision")?"4":"run-source-a",addEventListener:(/** @type {string} */ _event,/** @type {()=>void} */ callback)=>{click=callback;}}]:[]})));
  if(!click)throw new Error("Retry not bound");click();await new Promise(r=>setTimeout(r,0));
  assert(posts===0&&page.render({}).includes("Failed quiz items (1)"),"Decline keeps all records and sends no control call.");
  approved=true;click();await new Promise(r=>setTimeout(r,0));assert(posts===1,"Approval dispatches one retry.");page.dispose();
  const onlyQuiz=renderLibraryRoute({...baseModel(),workflowStatuses:[{...state,run:{...state.run,progress:{...state.run.progress,failedItems:[]}}}]});
  assert(onlyQuiz.includes("Retry failed quizzes")&&!onlyQuiz.includes(">Retry failed items</button>"),"Quiz-only failure never offers source extraction retry.");
  const retryable=renderLibraryRoute({...baseModel(),workflowStatuses:[{...state,reasonCode:"retryable-failure",run:{...state.run,state:"retryable-failure"}}]});
  assert(!retryable.includes("Retry failed quizzes")&&retryable.includes("Continue processing"),"A retained deferred list cannot offer completed-only quiz control during a general retryable failure.");
 }
});

Deno.test("Completed Library lists only current retained points even after deletions", () => {
  const status = workflowStatus("completed");
  status.run.counts.knowledgePoints = 61;
  const finished = { ...status, run: { ...status.run, progress: sampleProgress() } };
  const knowledge = [{ knowledgeId: "retained", sourceId: source.id, summary: "Currently retained point", questionLocked: true }];
  for (const origin of /** @type {const} */ (["web", "private-document"])) {
    const model = { ...baseModel(), collection: { ...baseModel().collection, items: [{ ...source, origin }] }, workflowStatuses: [finished] };
    const html = renderLibraryRoute({ ...model, knowledge });
    assert(html.includes("Extracted knowledge points (1)") && html.includes(knowledge[0].summary), "Final list reflects the retained projection for every source type.");
    assert((html.match(/Extracted knowledge points/g) ?? []).length === 1, "A source has exactly one knowledge list.");
    for (const retired of ["Related knowledge", "Processing complete", "<progress", "61 knowledge", "A beat groups", "quiz questions generated"]) assert(!html.includes(retired), `Completed clutter must be absent: ${retired}`);
    const empty = renderLibraryRoute({ ...model, knowledge: [] });
    assert(empty.includes("Extracted knowledge points (0)") && !empty.includes("Currently retained point") && !empty.includes("A beat groups"), "Removed points cannot reappear from historical progress.");
    const active = renderLibraryRoute({ ...model, knowledge, workflowStatuses: [{ ...finished, run: { ...finished.run, state: "extraction-loop" } }] });
    assert((active.match(/Extracted knowledge points/g) ?? []).length === 1 && active.includes("<progress"), "Active sources keep their live progress and one list.");
  }
});

Deno.test("failed knowledge search keeps its query and retries without displaying stale source cards", async () => {
  let failure = true;
  const phrase = "The decoder consists of a stack of identical layers";
  const citation = "https://publisher.example/learn#section=page-13";
  const page = createLibraryPage({ fetch: async input => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/source-library")) return Response.json({ result: { items: [source], interestAreas: [], nextCursor: null } });
    if (url.pathname.endsWith("/library-knowledge")) return Response.json({ result: { items: [] } });
    if (url.pathname.endsWith("/source-status")) return Response.json({ result: { sourceId: source.id, run: null, reasonCode: null, message: null } });
    assert(url.searchParams.get("scope") === "knowledge" && url.searchParams.get("q") === phrase, "Retries must preserve the requested scope and phrase.");
    return failure ? Response.json({ error: "SourceKeywordSearchUnavailable" }, { status: 503 }) : Response.json({ result: [{ knowledge: { knowledgeId: "decoder", sourceId: source.id, sourceTitle: source.title, summary: `${phrase}, each with three sub-components.`, sourceUrl: citation, evidenceAnchorIds: ["page-13"], questionLocked: true }, score: 14.03, matchedBy: "exact" }] });
  }, gatewayBaseUrl: "https://app.example/", escapeHtml: baseModel().escapeHtml, formatDate: v => v, createId: () => "search", confirmDisable: () => false, createObserver: () => null, schedule: () => 1, cancel: () => {}, onNotice: () => {}, onError: () => {}, rerender: () => {} });
  try {
    await page.load();
    const form = new FormData(); form.set("query", phrase); form.set("searchScope", "knowledge");
    await page.search(form);
    const failed = page.render({});
    assert(failed.includes(`value="${phrase}"`) && failed.includes("Try again"), "A failed search must retain its query and offer retry.");
    assert(!failed.includes("data-library-source=") && !failed.includes("Previously loaded sources remain below"), "A failed knowledge search cannot masquerade as a returned source result.");
    failure = false; await page.search(form);
    const results = page.render({});
    assert(results.includes('data-library-knowledge="decoder"') && results.includes(`${phrase}, each with three sub-components.`), "Retry returns the individual matching knowledge card.");
    assert(results.includes(`href="${citation}"`) && !results.includes("data-library-source=") && !results.includes("could not complete"), "Valid section provenance is retained without error or source-card fallback.");
  } finally { page.dispose(); }
});

Deno.test('Cancellation keeps the source and a retry action until both run cancellation and removal succeed', async () => {
  for (const failure of ['control', 'disable']) {
    let canceled = false, disabled = false, failed = false;
    const calls = /** @type {{path:string,key:string}[]} */ ([]);
    const errors = /** @type {string[]} */ ([]);
    const page = createLibraryPage({fetch:async(input, init) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith('/source-library')) return Response.json({result:{items:disabled?[]:[source],interestAreas:[],nextCursor:null}});
      if (path.endsWith('/library-knowledge')) return Response.json({result:{items:[]}});
      if (path.endsWith('/control') || path.endsWith('/disable')) {
        const command = JSON.parse(String(init?.body));calls.push({path,key:command.idempotencyKey});
        if (!failed && path.endsWith('/'+failure)) {failed=true;return Response.json({error:'FixtureUnavailable'},{status:503});}
        if (path.endsWith('/control')) {canceled=true;return Response.json({result:{...workflowStatus('abandoned').run,revision:2}});}
        assert(canceled, 'Removal must follow confirmed cancellation.');disabled=true;
        return Response.json({result:{...source,state:'disabled',revision:source.revision+1}});
      }
      return Response.json({result:canceled?{...workflowStatus('abandoned'),run:{...workflowStatus('abandoned').run,revision:2}}:workflowStatus('extraction-loop')});
    },gatewayBaseUrl:'https://app.example/',escapeHtml:v=>v,formatDate:v=>v,createId:()=> 'id',confirmDisable:()=>true,confirmCancel:()=>true,createObserver:()=>null,schedule:()=>1,cancel:()=>{},onNotice:()=>{},onError:message=>errors.push(message),rerender:()=>{}});
    await page.load();
    /** @type {(()=>void)|null} */ let click=null;
    page.bind(/** @type {HTMLElement} */(/** @type {unknown} */({querySelector:()=>null,querySelectorAll:(/** @type {string} */selector)=>selector==='[data-library-workflow-retry], [data-library-workflow-cancel]'?[{hasAttribute:()=>true,getAttribute:(/** @type {string} */name)=>name==='data-library-workflow-cancel'?'run-source-a':'1',addEventListener:(/** @type {string} */_event,/** @type {()=>void} */handler)=>{click=handler;}}]:[]})));
    if (click===null) throw new Error('Cancel action missing.');
    const cancel=/** @type {()=>void} */(click);cancel();await new Promise(r=>setTimeout(r,0));
    assert(errors.length===1 && page.render({}).includes('data-library-source="source-a"') && page.render({}).includes('data-library-workflow-cancel'), 'Failed cancellation/removal retains a truthful retry action.');
    if (failure==='control') assert(calls.length===1, 'A failed cancellation must not remove the source.');
    cancel();await new Promise(r=>setTimeout(r,0));
    assert(disabled && !page.render({}).includes('data-library-source="source-a"'), 'Retry completes removal after cancellation.');
    const controls=calls.filter(c=>c.path.endsWith('/control'));assert(controls.length===2 && controls[0].key===controls[1].key, 'Retry reuses the cancellation identity.');
    const removals=calls.filter(c=>c.path.endsWith('/disable'));assert(removals.every(c=>c.key===removals[0].key), 'Removal retry reuses its identity.');
    page.dispose();
  }
});

Deno.test("Library keeps automatic extraction chunks active and polling instead of showing an action-required pause",()=>{
 const base=workflowStatus("extraction-loop");
 const status={...base,run:{...base.run,state:"awaiting-time-limit-decision",remainingMs:1000,decisionRequired:null}};
 const html=renderLibraryRoute({...baseModel(),workflowStatuses:[status]});
 assert(html.includes('library-processing-spinner'),"The automatic continuation remains active.");
 assert(!html.includes('Processing is paused. Action is required to continue.'),"A bounded chunk needs no learner action.");
});

Deno.test("Library completion notices exclude cold history, partial failures and unpublished quizzes",async()=>{
 for(const outcome of ['history','partial','pending']){
  let done=outcome==='history';/** @type {string[]} */ const notices=[];
  const page=createLibraryPage({fetch:async input=>{
   const url=new URL(String(input));
   if(url.pathname.endsWith('/source-library'))return Response.json({result:{items:[source],interestAreas:[],nextCursor:null}});
   if(url.pathname.endsWith('/library-knowledge'))return Response.json({result:{items:[]}});
   const status=workflowStatus(done?'completed':'extraction-loop');
   return Response.json({result:done?{...status,reasonCode:outcome==='partial'?'partial-failure':null,run:{...status.run,failureKind:outcome==='partial'?'WorkflowQuizItemsFailed':null,counts:{pages:1,knowledgePoints:1,acceptedQuizzes:1,pendingQuizzes:outcome==='pending'?1:0}}}:status});
  },gatewayBaseUrl:'https://app.example/',escapeHtml:value=>value,formatDate:value=>value,createId:()=> 'id',confirmDisable:()=>true,createObserver:()=>null,schedule:()=>1,cancel:()=>{},onNotice:message=>notices.push(message),onError:()=>{},rerender:()=>{}});
  await page.load();done=true;await page.load();
  assert(notices.length===0,'Never announce a ready source for '+outcome);page.dispose();
 }
});

Deno.test("Library dismisses completed failures without removing the source or knowledge and handles failed requests",async()=>{
 const partial=partialStatus();
 let state={...partial,reasonCode:/** @type {string|null} */(partial.reasonCode),run:{...partial.run,failureKind:"WorkflowQuizItemsFailed",progress:{...partial.run.progress,failedQuizItems:[{knowledgeId:"no-quiz",summary:"Retained point",failureKind:"KnowledgeModelUnavailable",attempts:4}]}}};
 let fail=true,posts=0,disables=0;const errors=/** @type {string[]} */([]),notices=/** @type {string[]} */([]);
 /** @type {(()=>void)|undefined} */let click;
 const retained={knowledgeId:"keep",sourceId:source.id,summary:"Retain this knowledge",sourceRevision:source.revision,questionId:"q-keep",title:source.title,sourceUrl:source.canonicalUrl,evidenceAnchorIds:["anchor"],media:null,questionLocked:true,sourceClassification:null,sourceClassificationRevision:0};
 const page=createLibraryPage({fetch:async(input,init)=>{
  const path=new URL(String(input)).pathname;
  if(path.endsWith("/source-library"))return Response.json({result:{items:[source],interestAreas:[],nextCursor:null}});
  if(path.endsWith("/library-knowledge"))return Response.json({result:{items:[retained]}});
  if(path.endsWith("/control")){
   posts++;const command=JSON.parse(String(init?.body));assert(command.action==="dismiss-failures"&&command.expectedRevision===4&&command.runId===state.run.runId,"Dismiss targets the exact completed revision.");
   if(fail)return Response.json({error:"WorkflowPersistenceFailed"},{status:503});
   state={...state,reasonCode:null,message:null,run:{...state.run,revision:5,failureKind:"WorkflowFailedItemsDismissed",progress:{...state.run.progress,failedItems:[],failedQuizItems:[]}}};
   return Response.json({result:state.run});
  }
  if(init?.method==="POST"){disables++;throw new Error("Unexpected mutation");}
  return Response.json({result:state});
 },gatewayBaseUrl:"https://app.example/",escapeHtml:baseModel().escapeHtml,formatDate:v=>v,createId:()=>`dismiss-${posts}`,confirmDisable:()=>{throw new Error("Must not remove source");},createObserver:()=>null,schedule:()=>1,cancel:()=>{},onNotice:message=>notices.push(message),onError:message=>errors.push(message),rerender:()=>{}});
 await page.load();assert(page.render({}).includes("Dismiss failed items")&&page.render({}).includes("Remove source"),"Distinct actions explain their scope.");
 page.bind(/** @type {HTMLElement} */(/** @type {unknown} */({querySelector:()=>null,querySelectorAll:(/** @type {string} */ selector)=>selector==="[data-library-workflow-dismiss]"?[{getAttribute:(/** @type {string} */ name)=>name.endsWith("revision")?"4":state.run.runId,addEventListener:(/** @type {string} */ _event,/** @type {()=>void} */ handler)=>{click=handler;}}]:[]})));
 if(!click)throw new Error("Dismiss not bound");click();await new Promise(r=>setTimeout(r,0));
 assert(posts===1&&errors.length===1&&page.render({}).includes("Failed quiz items (1)"),`Failed writes keep reports and retry options visible: posts=${posts}, errors=${JSON.stringify(errors)}.`);
 fail=false;click();click();await new Promise(r=>setTimeout(r,0));
 const html=page.render({});assert(posts===2&&disables===0&&notices.length===1,"Double clicks issue one dismiss command and no delete calls.");
 assert(!html.includes("Failed quiz items")&&!html.includes("Failed items (")&&!html.includes("Retry failed")&&!html.includes("Dismiss failed items"),"A refresh clears reports and retry actions.");
 assert(html.includes(source.title)&&html.includes(retained.summary)&&html.includes("Extracted knowledge points (1)"),"Source and accepted knowledge remain visible.");page.dispose();
 const active=renderLibraryRoute({...baseModel(),workflowStatuses:[{...partial,run:{...partial.run,state:"extraction-loop"}}]});assert(!active.includes("Dismiss failed items"),"Running jobs cannot be dismissed.");
});
