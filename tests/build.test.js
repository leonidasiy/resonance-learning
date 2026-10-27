// @ts-check

import {
  ARTIFACT_BUDGETS,
  ESBUILD_VERSION,
  findInvalidTypedBooleanArtifacts,
  findRemoteRuntimeImports,
  generateServiceWorker,
  TERSER_VERSION,
  validateArtifactBudget,
} from "../scripts/build.mjs";

/** @param {boolean} condition @param {string} message */
function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/** @template T @param {T} actual @param {T} expected */
function assertEquals(actual, expected) {
  if (!Object.is(actual, expected)) {
    throw new Error(
      `Expected ${String(expected)}, received ${String(actual)}.`,
    );
  }
}

Deno.test("build command pins its build-only minifiers", async () => {
  const root = new URL("../", import.meta.url);
  const denoConfiguration = JSON.parse(
    await Deno.readTextFile(new URL("deno.json", root)),
  );
  const buildCommand = denoConfiguration.tasks?.build;
  assertEquals(ESBUILD_VERSION, "0.27.4");
  assertEquals(TERSER_VERSION, "5.44.1");
  assertEquals(
    buildCommand,
    "deno run --allow-read --allow-write --allow-run=npx scripts/build.mjs",
  );

  const buildSource = await Deno.readTextFile(
    new URL("scripts/build.mjs", root),
  );
  assert(
    buildSource.includes("esbuild@${ESBUILD_VERSION}"),
    "The build composition must invoke the exact pinned npm package.",
  );
  assert(
    buildSource.includes("terser@${TERSER_VERSION}") &&
      buildSource.includes('"passes=10,unsafe_arrows=true"') &&
      !buildSource.includes("booleans_as_integers"),
    "The build composition must invoke the exact pinned Terser package.",
  );
  assert(
    !buildSource.includes('from "npm:') && !buildSource.includes("from 'npm:"),
    "The build-only dependency must not become a browser runtime import.",
  );
});

Deno.test("production artifacts reject numeric typed booleans", () => {
  assertEquals(
    findInvalidTypedBooleanArtifacts(
      "service.playCue({enabled:!0,explicitActivation:!1});",
    ).length,
    0,
  );
  const invalid = findInvalidTypedBooleanArtifacts(
    "service.playCue({enabled:1,explicitActivation:0});create({enableFuzz:0,enableShortTerm:1,canAct:0});",
  );
  assertEquals(
    invalid.join(","),
    "enabled,explicitActivation,enableFuzz,enableShortTerm,canAct",
  );
});

Deno.test("Worker Browser Run pins Cloudflare Puppeteer without adding it to the client graph", async () => {
  const packageDocument = JSON.parse(await Deno.readTextFile("package.json"));
  assertEquals(
    packageDocument.devDependencies?.["@cloudflare/puppeteer"],
    "1.1.0",
  );
  const clientEntry = await Deno.readTextFile("src/app.js");
  const serviceWorker = await Deno.readTextFile("service-worker.js");
  assertEquals(clientEntry.includes("@cloudflare/puppeteer"), false);
  assertEquals(serviceWorker.includes("@cloudflare/puppeteer"), false);
});

Deno.test("production assets route shell and API requests through the Worker selectively", async () => {
  const configuration = await Deno.readTextFile(
    new URL("../wrangler.self-host.example.jsonc", import.meta.url),
  );
  const routes = configuration.match(/"run_worker_first"\s*:\s*(\[[\s\S]*?\])/);
  assert(routes !== null, "Assets must configure selective Worker-first routes.");
  if (routes === null) return;

  const configuredRoutes = JSON.parse(routes[1]);
  assertEquals(
    JSON.stringify(configuredRoutes),
    JSON.stringify(["/", "/index.html", "/api", "/api/*"]),
  );
  assertEquals(configuration.includes('"run_worker_first": true'), false);
});

Deno.test("production build copies only manifest-listed fallback media", async () => {
  const source = await Deno.readTextFile("scripts/build.mjs");
  assert(
    source.includes("readFallbackAssetPaths(sourceRoot)"),
    "The production build must read the fallback-media manifest.",
  );
  assert(
    source.includes('assets/fallback-media/manifest.json'),
    "The production build must copy the fallback-media manifest.",
  );
  assert(
    !source.includes('["assets", "assets"]'),
    "The production build must not publish unlisted fallback files.",
  );
});

Deno.test("browser acceptance pins Playwright Core outside the production browser graph", async () => {
  const packageDocument = JSON.parse(await Deno.readTextFile("package.json"));
  assertEquals(packageDocument.devDependencies?.["playwright-core"], "1.61.1");

  const denoConfiguration = JSON.parse(await Deno.readTextFile("deno.json"));
  assertEquals(
    denoConfiguration.tasks?.["browser:acceptance"],
    "node scripts/browser-acceptance.mjs",
  );
  assertEquals(
    denoConfiguration.tasks?.["browser:acceptance:login"],
    "node scripts/browser-acceptance-login.mjs",
  );
  const checkedSources = String(denoConfiguration.tasks?.check ?? "");
  for (const sourcePath of [
    "scripts/browser-acceptance-composition.mjs",
    "scripts/browser-acceptance-core.mjs",
    "scripts/browser-acceptance-login-core.mjs",
    "scripts/browser-acceptance-login.mjs",
    "scripts/browser-acceptance.mjs",
    "scripts/browser-session-state.mjs",
  ]) {
    assert(checkedSources.includes(sourcePath), `${sourcePath} must be included in strict checking.`);
  }

  for (const sourcePath of ["src/app.js", "service-worker.js"]) {
    const source = await Deno.readTextFile(sourcePath);
    assertEquals(source.includes("playwright-core"), false);
  }

  const manifest = await Deno.readTextFile("dist/asset-manifest.json");
  assertEquals(manifest.includes("playwright"), false);

  /** @param {string} directory @returns {Promise<string[]>} */
  async function generatedJavaScript(directory) {
    /** @type {string[]} */
    const paths = [];
    for await (const entry of Deno.readDir(directory)) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory) {
        paths.push(...await generatedJavaScript(path));
      } else if (entry.isFile && path.endsWith(".js")) {
        paths.push(path);
      }
    }
    return paths;
  }

  const generatedPaths = await generatedJavaScript("dist");
  assert(
    generatedPaths.length > 0,
    "The production build must emit JavaScript artifacts to scan.",
  );
  for (const path of generatedPaths) {
    const artifact = await Deno.readTextFile(path);
    assertEquals(/playwright/i.test(artifact), false);
  }
});

Deno.test("artifact budgets accept exact production boundaries", async () => {
  const javascript = validateArtifactBudget(
    {
      path: "src/app.js",
      rawBytes: ARTIFACT_BUDGETS.javascript.rawBytes,
      gzipBytes: ARTIFACT_BUDGETS.javascript.gzipBytes,
    },
    ARTIFACT_BUDGETS.javascript,
  );
  const stylesheet = validateArtifactBudget(
    {
      path: "src/styles.css",
      rawBytes: ARTIFACT_BUDGETS.stylesheet.rawBytes,
      gzipBytes: ARTIFACT_BUDGETS.stylesheet.gzipBytes,
    },
    ARTIFACT_BUDGETS.stylesheet,
  );
  assertEquals(javascript.ok, true);
  assertEquals(stylesheet.ok, true);
  assertEquals(ARTIFACT_BUDGETS.stylesheet.rawBytes, 48_723);
  assertEquals(ARTIFACT_BUDGETS.stylesheet.gzipBytes, 10_494);
  const oversizedStylesheet = validateArtifactBudget(
    { path: "src/styles.css", rawBytes: ARTIFACT_BUDGETS.stylesheet.rawBytes + 1, gzipBytes: 1 },
    ARTIFACT_BUDGETS.stylesheet,
  );
  assertEquals(oversizedStylesheet.ok, false);
  if (!oversizedStylesheet.ok) assertEquals(oversizedStylesheet.error.kind, "ArtifactRawBudgetExceeded");
  assertEquals(ARTIFACT_BUDGETS.aggregateJavascript.rawBytes, 237_174);
  assertEquals(ARTIFACT_BUDGETS.aggregateJavascript.gzipBytes, 78_568);
  /** @type {string[]} */
  const manifest = JSON.parse(await Deno.readTextFile("dist/asset-manifest.json"));
  const measured = { path: "src/*.js", rawBytes: 0, gzipBytes: 0 };
  const javascriptPaths = manifest.filter(path => path.startsWith("./src/") && path.endsWith(".js"));
  assert(javascriptPaths.length > 0, "Production JavaScript must exist before measuring the aggregate.");
  for (const path of javascriptPaths) {
    const bytes = await Deno.readFile(`dist/${path}`);
    measured.rawBytes += bytes.byteLength;
    measured.gzipBytes += (await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer()).byteLength;
  }
  assertEquals(validateArtifactBudget(measured, ARTIFACT_BUDGETS.aggregateJavascript).ok, true);
  const exactAggregate = validateArtifactBudget({ ...measured, rawBytes: ARTIFACT_BUDGETS.aggregateJavascript.rawBytes, gzipBytes: ARTIFACT_BUDGETS.aggregateJavascript.gzipBytes }, ARTIFACT_BUDGETS.aggregateJavascript);
  assertEquals(exactAggregate.ok, true);
  const oversizedAggregateRaw = validateArtifactBudget(
    { ...measured, rawBytes: ARTIFACT_BUDGETS.aggregateJavascript.rawBytes + 1 },
    ARTIFACT_BUDGETS.aggregateJavascript,
  );
  assertEquals(oversizedAggregateRaw.ok, false);
  if (!oversizedAggregateRaw.ok) assertEquals(oversizedAggregateRaw.error.kind, "ArtifactRawBudgetExceeded");
  const oversizedAggregateGzip = validateArtifactBudget(
    { ...measured, gzipBytes: ARTIFACT_BUDGETS.aggregateJavascript.gzipBytes + 1 },
    ARTIFACT_BUDGETS.aggregateJavascript,
  );
  assertEquals(oversizedAggregateGzip.ok, false);
  if (!oversizedAggregateGzip.ok) assertEquals(oversizedAggregateGzip.error.kind, "ArtifactGzipBudgetExceeded");
});

Deno.test("service-worker cache identity follows the complete build graph", async () => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${root}/src/chunks`, { recursive: true });
    const template =
      `const CACHE_NAME = "resonance-shell-__RESONANCE_BUILD_ID__";`;
    await Deno.writeTextFile(`${root}/service-worker.js`, template);
    await Deno.writeTextFile(`${root}/asset-manifest.json`, '["./src/app.js"]');
    await Deno.writeTextFile(
      `${root}/src/app.js`,
      "import('./chunks/review-A.js')",
    );
    await Deno.writeTextFile(`${root}/src/chunks/review-A.js`, "export{};");

    const first = await generateServiceWorker(root);
    assertEquals(first.ok, true);
    if (!first.ok) return;
    const firstWorker = await Deno.readTextFile(`${root}/service-worker.js`);
    assert(
      firstWorker.includes(`resonance-shell-${first.cacheId}`) &&
        !firstWorker.includes("__RESONANCE_BUILD_ID__"),
      "The published worker must contain only the generated cache identity.",
    );

    await Deno.writeTextFile(`${root}/service-worker.js`, template);
    await Deno.writeTextFile(
      `${root}/src/chunks/review-A.js`,
      "export{1 as updated};",
    );
    const second = await generateServiceWorker(root);
    assertEquals(second.ok, true);
    if (!second.ok) return;
    assert(
      second.cacheId !== first.cacheId,
      "Changing any built lazy chunk must change the service-worker identity.",
    );

    const revisedTemplate = template.replace(
      "const CACHE_NAME",
      "let CACHE_NAME",
    );
    await Deno.writeTextFile(`${root}/service-worker.js`, revisedTemplate);
    const third = await generateServiceWorker(root);
    assertEquals(third.ok, true);
    if (!third.ok) return;
    assert(
      third.cacheId !== second.cacheId,
      "Changing the worker template must not reuse the active cache.",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("service-worker generation rejects missing or repeated identity tokens", async () => {
  for (
    const template of [
      "const worker = 'missing';",
      "__RESONANCE_BUILD_ID____RESONANCE_BUILD_ID__",
    ]
  ) {
    const root = await Deno.makeTempDir();
    try {
      await Deno.writeTextFile(`${root}/service-worker.js`, template);
      await Deno.writeTextFile(`${root}/index.html`, "<!doctype html>");
      const result = await generateServiceWorker(root);
      assertEquals(result.ok, false);
      if (!result.ok) {
        assertEquals(result.error.kind, "ServiceWorkerTemplateInvalid");
      }
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  }
});

Deno.test("service-worker generation rejects source-only precache paths", async () => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      `${root}/service-worker.js`,
      `const BUILD_ID = "__RESONANCE_BUILD_ID__";\nconst SHELL_URLS = ["./src/missing.js"];`,
    );
    await Deno.writeTextFile(`${root}/index.html`, "<!doctype html>");
    const missing = await generateServiceWorker(root);
    assertEquals(missing.ok, false);
    if (!missing.ok) assertEquals(missing.error.kind, "BuiltArtifactMissing");

    await Deno.mkdir(`${root}/src`);
    await Deno.writeTextFile(`${root}/src/missing.js`, "export{};");
    const present = await generateServiceWorker(root);
    assertEquals(present.ok, true);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("service-worker generation resolves encoded local shell paths", async () => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      `${root}/service-worker.js`,
      `const BUILD_ID = "__RESONANCE_BUILD_ID__";\nconst SHELL_URLS = ["./assets/music%20image.jpg"];`,
    );
    await Deno.mkdir(`${root}/assets`);
    await Deno.writeTextFile(`${root}/assets/music image.jpg`, "image");

    const result = await generateServiceWorker(root);
    assertEquals(result.ok, true);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("service-worker generation rejects malformed and encoded traversal paths", async () => {
  for (const shellPath of ["./assets/%E0%A4%A", "./%2e%2e/secret.js"]) {
    const root = await Deno.makeTempDir();
    try {
      await Deno.writeTextFile(
        `${root}/service-worker.js`,
        `const BUILD_ID = "__RESONANCE_BUILD_ID__";\nconst SHELL_URLS = [${JSON.stringify(shellPath)}];`,
      );
      const result = await generateServiceWorker(root);
      assertEquals(result.ok, false);
      if (!result.ok) assertEquals(result.error.kind, "ServiceWorkerTemplateInvalid");
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  }
});

Deno.test("production build splits lazy routes and budgets the whole graph", async () => {
  const root = new URL("../", import.meta.url);
  const buildSource = await Deno.readTextFile(
    new URL("scripts/build.mjs", root),
  );
  const application = await Deno.readTextFile(
    new URL("src/app.js", root),
  );
  assert(
    buildSource.includes('"--splitting"') &&
      buildSource.includes('"--chunk-names=chunks/[name]-[hash]"') &&
      buildSource.includes("ARTIFACT_BUDGETS.lazyJavascript") &&
      buildSource.includes("ARTIFACT_BUDGETS.aggregateJavascript"),
    "The production graph must budget the entry, lazy chunks, and aggregate.",
  );
  assert(
    /import\(\s*["']\.\/features\/learning-generation\/learner\.js["']\s*\)/.test(application) &&
      /import\(\s*["']\.\/startup\/library-page\.js["']\s*\)/.test(
        application,
      ) &&
      /import\(\s*["']\.\/startup\/discovery-page\.js["']\s*\)/.test(
        application,
      ) &&
      !/import\(\s*["']\.\/routes\/review\.js["']\s*\)/.test(application) &&
      !/import\(\s*["']\.\/features\/questions\/grading\.js["']\s*\)/.test(application),
    "Learner, Library, and Discover must stay lazy without restoring the retired Review or local grader graph.",
  );
});

Deno.test("artifact budgets return distinct raw and gzip failures", () => {
  const rawFailure = validateArtifactBudget(
    { path: "src/app.js", rawBytes: 80_001, gzipBytes: 1 },
    ARTIFACT_BUDGETS.javascript,
  );
  const gzipFailure = validateArtifactBudget(
    { path: "src/styles.css", rawBytes: 1, gzipBytes: ARTIFACT_BUDGETS.stylesheet.gzipBytes + 1 },
    ARTIFACT_BUDGETS.stylesheet,
  );
  assertEquals(rawFailure.ok, false);
  assertEquals(gzipFailure.ok, false);
  if (!rawFailure.ok) {
    assertEquals(rawFailure.error.kind, "ArtifactRawBudgetExceeded");
  }
  if (!gzipFailure.ok) {
    assertEquals(gzipFailure.error.kind, "ArtifactGzipBudgetExceeded");
  }
});

Deno.test("runtime import validation rejects static and dynamic remote modules", () => {
  const source = `
    import "https://example.test/side-effect.js";
    export { value } from "http://example.test/export.js";
    const lazy = import("https://example.test/lazy.js");
  `;
  const imports = findRemoteRuntimeImports(source);
  assertEquals(imports.length, 3);
  const importSet = new Set(imports);
  assert(
    importSet.has("https://example.test/side-effect.js"),
    "Static side-effect imports must be rejected.",
  );
  assert(
    importSet.has("http://example.test/export.js"),
    "Remote re-exports must be rejected.",
  );
  assert(
    importSet.has("https://example.test/lazy.js"),
    "Dynamic remote imports must be rejected.",
  );
});

Deno.test("runtime import validation permits bundled application URLs as data", () => {
  const source = `
    const sourceLink = "https://example.test/article";
    const localDynamicModule = import("./local.js");
  `;
  const imports = findRemoteRuntimeImports(source);
  assertEquals(imports.length, 0);
});

Deno.test("repository ignore rules classify local and generated outputs", async () => {
  const root = new URL("../", import.meta.url);
  const command = new Deno.Command("git", {
    args: ["check-ignore", "--no-index", "--stdin"],
    cwd: root,
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  });
  const child = command.spawn();
  const writer = child.stdin.getWriter();
  await writer.write(
    new TextEncoder().encode(".playwright-cli/output.json\nskills-lock.json\n"),
  );
  await writer.close();

  const output = await child.output();
  assertEquals(output.code, 0);
  assertEquals(
    new TextDecoder().decode(output.stdout),
    ".playwright-cli/output.json\nskills-lock.json\n",
  );
});
