// @ts-check

export const ESBUILD_VERSION = "0.27.4";
export const TERSER_VERSION = "5.44.1";

export const ARTIFACT_BUDGETS = Object.freeze({
  javascript: Object.freeze({
    label: "Initial JavaScript",
    rawBytes: 65_000,
    gzipBytes: 20_000,
  }),
  lazyJavascript: Object.freeze({
    label: "Lazy JavaScript chunk",
    rawBytes: 40_000,
    gzipBytes: 13_000,
  }),
  aggregateJavascript: Object.freeze({
    label: "Aggregate JavaScript",
    // Measured inline-link feature allowance approved 2026-10-27.
    // Initial and lazy-chunk limits remain unchanged.
    rawBytes: 236_448,
    gzipBytes: 78_444,
  }),
  stylesheet: Object.freeze({
    label: "CSS",
    // Measured animated processing and shared source-card disclosures (2026-10-27).
    rawBytes: 48_723,
    gzipBytes: 10_494,
  }),
  pdfRenderer: Object.freeze({
    label: "On-demand PDF renderer",
    rawBytes: 2_000_000,
    gzipBytes: 650_000,
  }),
});

/**
 * @typedef {{
 *   ok: true,
 *   artifacts: readonly BuildArtifact[],
 * } | {
 *   ok: false,
 *   error: BuildFailure,
 * }} BuildResult
 */

/**
 * @typedef {{
 *   path: string,
 *   rawBytes: number,
 *   gzipBytes: number,
 * }} BuildArtifact
 */

/**
 * @typedef {{
 *   kind:
 *     | "InvalidBuildConfiguration"
 *     | "BuildInputMissing"
 *     | "BuildDependencyUnavailable"
 *     | "BuildDependencyVersionMismatch"
 *     | "JavaScriptBuildFailed"
 *     | "JavaScriptMinificationFailed"
 *     | "StylesheetBuildFailed"
 *     | "StaticCopyFailed"
 *     | "ServiceWorkerTemplateInvalid"
 *     | "ServiceWorkerGenerationFailed"
 *     | "BuiltArtifactMissing"
 *     | "RemoteRuntimeImport"
 *     | "TypedBooleanArtifactInvalid"
 *     | "ArtifactRawBudgetExceeded"
 *     | "ArtifactGzipBudgetExceeded"
 *     | "BuildPublishFailed"
 *     | "BuildCleanupFailed",
 *   message: string,
 * }} BuildFailure
 */

/**
 * @typedef {{
 *   sourceRoot: string,
 *   outputRoot: string,
 * }} BuildConfiguration
 */

/**
 * @typedef {{
 *   stage: "javascript" | "stylesheet",
 *   entryPoint: string,
 *   outputFile?: string,
 *   outputDirectory?: string,
 *   arguments: readonly string[],
 * }} EsbuildRequest
 */

/**
 * @typedef {{
 *   ok: true,
 * } | {
 *   ok: false,
 *   error: {
 *     kind:
 *       | "BuildDependencyUnavailable"
 *       | "BuildDependencyVersionMismatch"
 *       | "EsbuildInvocationFailed",
 *     message: string,
 *   },
 * }} EsbuildResult
 */

/** @typedef {(request: EsbuildRequest) => Promise<EsbuildResult>} EsbuildRunner */
/** @typedef {(paths: readonly string[]) => Promise<EsbuildResult>} TerserRunner */

/**
 * @typedef {{
 *   runEsbuild: EsbuildRunner,
 *   runTerser: TerserRunner,
 * }} BuildDependencies
 */

/**
 * Create the explicit build-only esbuild dependency used at the composition
 * boundary. Production uses the exact pinned npm package; tests may inject a
 * runner without granting network access.
 *
 * @param {{
 *   command: string,
 *   prefixArguments?: readonly string[],
 *   expectedVersion?: string,
 * }} configuration
 * @returns {EsbuildRunner}
 */
export function createEsbuildRunner(configuration) {
  const command = configuration.command.trim();
  const prefixArguments = [...(configuration.prefixArguments ?? [])];
  const expectedVersion = configuration.expectedVersion ?? ESBUILD_VERSION;
  /** @type {Promise<EsbuildResult> | null} */
  let versionCheck = null;

  return async (request) => {
    if (command.length === 0 || expectedVersion.length === 0) {
      return {
        ok: false,
        error: {
          kind: "BuildDependencyUnavailable",
          message: "The esbuild command is not configured.",
        },
      };
    }

    versionCheck ??= verifyEsbuildVersion(
      command,
      prefixArguments,
      expectedVersion,
    );
    const verified = await versionCheck;
    if (!verified.ok) return verified;

    const outputArgument = request.outputDirectory === undefined
      ? `--outfile=${request.outputFile ?? ""}`
      : `--outdir=${request.outputDirectory}`;
    const result = await executeCommand(command, [
      ...prefixArguments,
      request.entryPoint,
      ...request.arguments,
      outputArgument,
    ]);
    if (!result.ok) return result;
    if (result.exitCode !== 0) {
      return {
        ok: false,
        error: {
          kind: "EsbuildInvocationFailed",
          message: `${capitalize(request.stage)} build failed: ${
            summarizeCommandError(result.stderr)
          }`,
        },
      };
    }
    return { ok: true };
  };
}

/**
 * Create the explicit build-only Terser dependency used after bundling.
 *
 * @param {{command:string,prefixArguments?:readonly string[],expectedVersion?:string}} configuration
 * @returns {TerserRunner}
 */
export function createTerserRunner(configuration) {
  const command = configuration.command.trim();
  const prefixArguments = [...(configuration.prefixArguments ?? [])];
  const expectedVersion = configuration.expectedVersion ?? TERSER_VERSION;
  /** @type {Promise<EsbuildResult> | null} */
  let versionCheck = null;
  return async (paths) => {
    if (command.length === 0 || expectedVersion.length === 0) {
      return dependencyUnavailable("Terser is not configured.");
    }
    versionCheck ??= verifyTerserVersion(
      command,
      prefixArguments,
      expectedVersion,
    );
    const verified = await versionCheck;
    if (!verified.ok) return verified;
    for (const path of paths) {
      const result = await executeCommand(command, [
        ...prefixArguments,
        path,
        "--compress",
        "passes=10,unsafe_arrows=true",
        "--mangle",
        "--module",
        "--ecma",
        "2022",
        "--output",
        path,
      ]);
      if (!result.ok) return result;
      if (result.exitCode !== 0) {
        return {
          ok: false,
          error: {
            kind: "EsbuildInvocationFailed",
            message: `Terser failed: ${summarizeCommandError(result.stderr)}`,
          },
        };
      }
    }
    return { ok: true };
  };
}

/**
 * Build the deployable static application in an isolated directory and publish
 * it only after every artifact and budget check succeeds.
 *
 * @param {BuildConfiguration} configuration
 * @param {BuildDependencies} dependencies
 * @returns {Promise<BuildResult>}
 */
export async function buildProject(configuration, dependencies) {
  const validated = validateBuildConfiguration(configuration, dependencies);
  if (!validated.ok) return validated;

  const sourceRoot = normalizeDirectory(configuration.sourceRoot);
  const outputRoot = normalizeDirectory(configuration.outputRoot);
  const temporaryRoot = `${outputRoot}.tmp-${crypto.randomUUID()}`;
  const requiredInputs = [
    "index.html",
    "manifest.webmanifest",
    "service-worker.js",
    "src/app.js",
    "src/styles.css",
    "assets",
  ];

  const inputCheck = await validateInputs(sourceRoot, requiredInputs);
  if (!inputCheck.ok) return inputCheck;

  const preparation = await prepareTemporaryDirectory(temporaryRoot);
  if (!preparation.ok) return preparation;

  try {
    await Deno.mkdir(joinPath(temporaryRoot, "src"), { recursive: true });

    const fallbackPaths = await readFallbackAssetPaths(sourceRoot);
    if (!fallbackPaths.ok) {
      return await failWithCleanup(fallbackPaths.error, temporaryRoot);
    }
    const staticCopies = [
      ["index.html", "index.html"],
      ["manifest.webmanifest", "manifest.webmanifest"],
      ["assets/app-icon-192.png", "assets/app-icon-192.png"],
      ["assets/app-icon-512.png", "assets/app-icon-512.png"],
      ["assets/fonts/fraunces-latin.woff2", "assets/fonts/fraunces-latin.woff2"],
      ["assets/fonts/manrope-latin.woff2", "assets/fonts/manrope-latin.woff2"],
      ["assets/fonts/syne-latin.woff2", "assets/fonts/syne-latin.woff2"],
      ["assets/fonts/LICENSE.txt", "assets/fonts/LICENSE.txt"],
      ["service-worker.js", "service-worker.js"],
      ["assets/catalog-fixtures.json", "assets/catalog-fixtures.json"],
      ["assets/discovery-starters.json", "assets/discovery-starters.json"],
      ["assets/empty-states.svg", "assets/empty-states.svg"],
      ["assets/fallback-media/manifest.json", "assets/fallback-media/manifest.json"],
      ["node_modules/unpdf/dist/pdfjs.mjs", "pdfjs.mjs"],
      ...fallbackPaths.value.map((path) => [path, path]),
    ];
    for (const [source, destination] of staticCopies) {
      const copied = await copyPath(
        joinPath(sourceRoot, source),
        joinPath(temporaryRoot, destination),
      );
      if (!copied.ok) {
        return await failWithCleanup(copied.error, temporaryRoot);
      }
    }
    const pdfRenderer = await measureArtifact(joinPath(temporaryRoot, "pdfjs.mjs"), "pdfjs.mjs");
    if (!pdfRenderer.ok) return await failWithCleanup(pdfRenderer.error, temporaryRoot);
    const rendererBudget = validateArtifactBudget(pdfRenderer.artifact, ARTIFACT_BUDGETS.pdfRenderer);
    if (!rendererBudget.ok) return await failWithCleanup(rendererBudget.error, temporaryRoot);

    const javascriptOutput = joinPath(temporaryRoot, "src/app.js");
    const javascriptBuild = await dependencies.runEsbuild({
      stage: "javascript",
      entryPoint: joinPath(sourceRoot, "src/app.js"),
      outputDirectory: joinPath(temporaryRoot, "src"),
      arguments: [
        "--bundle",
        "--minify",
        "--format=esm",
        "--splitting",
        "--entry-names=[name]",
        "--chunk-names=chunks/[name]-[hash]",
        "--platform=browser",
        "--target=es2022",
        "--legal-comments=none",
      ],
    });
    if (!javascriptBuild.ok) {
      return await failWithCleanup(
        mapEsbuildFailure("javascript", javascriptBuild.error),
        temporaryRoot,
      );
    }

    const stylesheetOutput = joinPath(temporaryRoot, "src/styles.css");
    const stylesheetBuild = await dependencies.runEsbuild({
      stage: "stylesheet",
      entryPoint: joinPath(sourceRoot, "src/styles.css"),
      outputFile: stylesheetOutput,
      arguments: [
        "--bundle",
        "--external:*.woff2",
        "--minify",
        "--target=es2022",
        "--legal-comments=none",
      ],
    });
    if (!stylesheetBuild.ok) {
      return await failWithCleanup(
        mapEsbuildFailure("stylesheet", stylesheetBuild.error),
        temporaryRoot,
      );
    }

    const javascriptPaths = await listFiles(
      joinPath(temporaryRoot, "src"),
      ".js",
    );
    const optimized = await dependencies.runTerser(javascriptPaths);
    if (!optimized.ok) {
      return await failWithCleanup(
        mapTerserFailure(optimized.error),
        temporaryRoot,
      );
    }
    /** @type {BuildArtifact[]} */
    const javascriptArtifacts = [];
    for (const path of javascriptPaths) {
      const source = await readBuiltText(path);
      if (!source.ok) return await failWithCleanup(source.error, temporaryRoot);
      const remoteImports = findRemoteRuntimeImports(source.value);
      if (remoteImports.length > 0) {
        return await failWithCleanup({
          kind: "RemoteRuntimeImport",
          message: `The application bundle contains a remote runtime import: ${
            remoteImports[0]
          }`,
        }, temporaryRoot);
      }
      const invalidBooleans = findInvalidTypedBooleanArtifacts(source.value);
      if (invalidBooleans.length > 0) {
        return await failWithCleanup({
          kind: "TypedBooleanArtifactInvalid",
          message: `The application bundle emitted a numeric typed boolean: ${
            invalidBooleans[0]
          }`,
        }, temporaryRoot);
      }
      const displayPath = path.slice(temporaryRoot.length + 1);
      const measured = await measureArtifact(path, displayPath);
      if (!measured.ok) {
        return await failWithCleanup(measured.error, temporaryRoot);
      }
      const budget = displayPath === "src/app.js"
        ? ARTIFACT_BUDGETS.javascript
        : ARTIFACT_BUDGETS.lazyJavascript;
      const checked = validateArtifactBudget(measured.artifact, budget);
      if (!checked.ok) {
        return await failWithCleanup(checked.error, temporaryRoot);
      }
      javascriptArtifacts.push(measured.artifact);
    }
    const aggregate = {
      path: "src/*.js",
      rawBytes: javascriptArtifacts.reduce(
        (sum, item) => sum + item.rawBytes,
        0,
      ),
      gzipBytes: javascriptArtifacts.reduce(
        (sum, item) => sum + item.gzipBytes,
        0,
      ),
    };
    const aggregateBudget = validateArtifactBudget(
      aggregate,
      ARTIFACT_BUDGETS.aggregateJavascript,
    );
    if (!aggregateBudget.ok) {
      return await failWithCleanup(aggregateBudget.error, temporaryRoot);
    }
    await Deno.writeTextFile(
      joinPath(temporaryRoot, "asset-manifest.json"),
      JSON.stringify(javascriptArtifacts.map((item) => `./${item.path}`)),
    );

    const stylesheetArtifact = await measureArtifact(
      stylesheetOutput,
      "src/styles.css",
    );
    if (!stylesheetArtifact.ok) {
      return await failWithCleanup(stylesheetArtifact.error, temporaryRoot);
    }
    const stylesheetBudget = validateArtifactBudget(
      stylesheetArtifact.artifact,
      ARTIFACT_BUDGETS.stylesheet,
    );
    if (!stylesheetBudget.ok) {
      return await failWithCleanup(stylesheetBudget.error, temporaryRoot);
    }

    const generatedWorker = await generateServiceWorker(temporaryRoot);
    if (!generatedWorker.ok) {
      return await failWithCleanup(generatedWorker.error, temporaryRoot);
    }

    const published = await publishBuild(temporaryRoot, outputRoot);
    if (!published.ok) return published;

    return {
      ok: true,
      artifacts: [
        ...javascriptArtifacts,
        stylesheetArtifact.artifact,
      ],
    };
  } catch (cause) {
    return await failWithCleanup(
      {
        kind: "BuildPublishFailed",
        message: `The production build could not be completed: ${
          errorMessage(cause)
        }`,
      },
      temporaryRoot,
    );
  }
}

/**
 * Return only locally approved fallback files from the fallback manifest.
 * Unlisted files in the developer's fallback directory are never copied into
 * the hosted artifact.
 *
 * @param {string} sourceRoot
 * @returns {Promise<{ ok: true, value: readonly string[] } | { ok: false, error: BuildFailure }>}
 */
async function readFallbackAssetPaths(sourceRoot) {
  const manifestPath = joinPath(sourceRoot, "assets/fallback-media/manifest.json");
  try {
    const document = JSON.parse(await Deno.readTextFile(manifestPath));
    if (!Array.isArray(document)) {
      return { ok: false, error: { kind: "StaticCopyFailed", message: "The fallback-media manifest must be an array." } };
    }
    const paths = new Set();
    for (const entry of document) {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry) || typeof entry.url !== "string" || entry.url.trim() === "") {
        return { ok: false, error: { kind: "StaticCopyFailed", message: "The fallback-media manifest contains an invalid asset entry." } };
      }
      let parsed;
      try {
        parsed = new URL(entry.url, "https://fallback-assets.invalid/");
      } catch (error) {
        return { ok: false, error: { kind: "StaticCopyFailed", message: "The fallback-media manifest contains an invalid asset URL." } };
      }
      if (parsed.origin !== "https://fallback-assets.invalid" || parsed.search !== "" || parsed.hash !== "" || !parsed.pathname.startsWith("/assets/fallback-media/")) {
        return { ok: false, error: { kind: "StaticCopyFailed", message: "Fallback assets must be local files below assets/fallback-media/." } };
      }
      let relative;
      try {
        relative = decodeURIComponent(parsed.pathname.slice(1));
      } catch (error) {
        return { ok: false, error: { kind: "StaticCopyFailed", message: "The fallback-media manifest contains an improperly encoded path." } };
      }
      if (relative.includes("..") || relative.endsWith("/") || relative === "assets/fallback-media/manifest.json") {
        return { ok: false, error: { kind: "StaticCopyFailed", message: "The fallback-media manifest contains an unsafe asset path." } };
      }
      paths.add(relative);
    }
    return { ok: true, value: Object.freeze([...paths].sort()) };
  } catch (cause) {
    return { ok: false, error: { kind: "StaticCopyFailed", message: `The fallback-media manifest could not be read: ${errorMessage(cause)}` } };
  }
}

const SERVICE_WORKER_BUILD_TOKEN = "__RESONANCE_BUILD_ID__";

/**
 * Replace the service-worker template token with a deterministic fingerprint
 * of every other published file. Hashed lazy chunks therefore force a worker
 * update before the new cache graph can become active.
 *
 * @param {string} outputRoot
 * @returns {Promise<
 *   {ok: true, cacheId: string} |
 *   {ok: false, error: BuildFailure}
 * >}
 */
export async function generateServiceWorker(outputRoot) {
  const workerPath = joinPath(outputRoot, "service-worker.js");
  try {
    const template = await Deno.readTextFile(workerPath);
    const tokenMatches = template.match(
      new RegExp(SERVICE_WORKER_BUILD_TOKEN, "g"),
    );
    if (tokenMatches?.length !== 1) {
      return {
        ok: false,
        error: {
          kind: "ServiceWorkerTemplateInvalid",
          message:
            "The service-worker template must contain exactly one build identity token.",
        },
      };
    }

    const precache = await validateServiceWorkerPrecache(outputRoot, template);
    if (!precache.ok) return precache;

    const paths = (await listFilesRecursively(outputRoot))
      .filter((path) => path !== workerPath)
      .sort();
    if (paths.length === 0) {
      return {
        ok: false,
        error: {
          kind: "ServiceWorkerGenerationFailed",
          message: "The service-worker cache graph is empty.",
        },
      };
    }

    const fingerprintLines = [
      `service-worker.js:${await sha256Hex(
        new TextEncoder().encode(template),
      )}`,
    ];
    for (const path of paths) {
      const relativePath = path.slice(
        normalizeDirectory(outputRoot).length + 1,
      );
      const contentDigest = await sha256Hex(await Deno.readFile(path));
      fingerprintLines.push(`${relativePath}:${contentDigest}`);
    }
    const graphDigest = await sha256Hex(
      new TextEncoder().encode(fingerprintLines.join("\n")),
    );
    const cacheId = graphDigest.slice(0, 24);
    await Deno.writeTextFile(
      workerPath,
      template.replace(SERVICE_WORKER_BUILD_TOKEN, cacheId),
    );
    return { ok: true, cacheId };
  } catch (cause) {
    return {
      ok: false,
      error: {
        kind: "ServiceWorkerGenerationFailed",
        message: `The production service worker could not be generated: ${
          errorMessage(cause)
        }`,
      },
    };
  }
}

/**
 * Validate literal shell paths when the production template declares them.
 * Generated lazy chunks remain authoritative in asset-manifest.json.
 *
 * @param {string} outputRoot
 * @param {string} template
 * @returns {Promise<{ok:true}|{ok:false,error:BuildFailure}>}
 */
async function validateServiceWorkerPrecache(outputRoot, template) {
  const declaration = template.match(/const SHELL_URLS = (\[[\s\S]*?\]);/);
  if (declaration === null) return { ok: true };
  let paths;
  try {
    paths = /** @type {unknown} */ (
      JSON.parse(declaration[1].replace(/,\s*]$/, "]"))
    );
  } catch {
    return {
      ok: false,
      error: {
        kind: "ServiceWorkerTemplateInvalid",
        message: "The service-worker shell list is invalid.",
      },
    };
  }
  if (
    !Array.isArray(paths) ||
    !paths.every((path) =>
      typeof path === "string" && path.startsWith("./") &&
      !path.startsWith("./../")
    )
  ) {
    return {
      ok: false,
      error: {
        kind: "ServiceWorkerTemplateInvalid",
        message: "The service-worker shell list is invalid.",
      },
    };
  }
  for (const path of paths) {
    let localPath;
    try {
      localPath = decodeURIComponent(path.slice(2));
    } catch {
      return {
        ok: false,
        error: {
          kind: "ServiceWorkerTemplateInvalid",
          message: "The service-worker shell list contains an invalid URL path.",
        },
      };
    }
    if (
      localPath.startsWith("/") ||
      localPath.split("/").some((segment) => segment === "..")
    ) {
      return {
        ok: false,
        error: {
          kind: "ServiceWorkerTemplateInvalid",
          message: "The service-worker shell list contains an unsafe URL path.",
        },
      };
    }
    try {
      await Deno.stat(joinPath(outputRoot, localPath));
    } catch (cause) {
      if (cause instanceof Deno.errors.NotFound) {
        return {
          ok: false,
          error: {
            kind: "BuiltArtifactMissing",
            message: `The service-worker shell asset is missing: ${path}`,
          },
        };
      }
      throw cause;
    }
  }
  return { ok: true };
}

/** @param {string} directory @returns {Promise<readonly string[]>} */
async function listFilesRecursively(directory) {
  /** @type {string[]} */
  const paths = [];
  for await (const entry of Deno.readDir(directory)) {
    const path = joinPath(directory, entry.name);
    if (entry.isDirectory) {
      paths.push(...await listFilesRecursively(path));
    } else if (entry.isFile) {
      paths.push(path);
    }
  }
  return paths;
}

/** @param {Uint8Array} content */
async function sha256Hex(content) {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", content),
  );
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * @param {BuildArtifact} artifact
 * @param {{label: string, rawBytes: number, gzipBytes: number}} budget
 * @returns {{ok: true} | {ok: false, error: BuildFailure}}
 */
export function validateArtifactBudget(artifact, budget) {
  if (artifact.rawBytes > budget.rawBytes) {
    return {
      ok: false,
      error: {
        kind: "ArtifactRawBudgetExceeded",
        message:
          `${budget.label} ${artifact.path} is ${artifact.rawBytes} bytes; the limit is ${budget.rawBytes} bytes.`,
      },
    };
  }
  if (artifact.gzipBytes > budget.gzipBytes) {
    return {
      ok: false,
      error: {
        kind: "ArtifactGzipBudgetExceeded",
        message:
          `${budget.label} ${artifact.path} is ${artifact.gzipBytes} bytes gzip; the limit is ${budget.gzipBytes} bytes.`,
      },
    };
  }
  return { ok: true };
}

/**
 * @param {string} source
 * @returns {readonly string[]}
 */
export function findRemoteRuntimeImports(source) {
  const specifiers = [];
  const patterns = [
    /\bimport\s*\(\s*["'](https?:\/\/[^"']+)["']\s*\)/g,
    /\bimport\s+["'](https?:\/\/[^"']+)["']/g,
    /\b(?:import|export)\s+[^;]*?\bfrom\s*["'](https?:\/\/[^"']+)["']/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      if (match[1] !== undefined) specifiers.push(match[1]);
    }
  }
  return Object.freeze(specifiers);
}

/**
 * Reject minifier output that changes strict boolean contracts into numbers.
 *
 * @param {string} source
 * @returns {readonly string[]}
 */
export function findInvalidTypedBooleanArtifacts(source) {
  /** @type {string[]} */
  const fields = [];
  const pattern =
    /\b(enabled|explicitActivation|enableFuzz|enableShortTerm|canAct):[01](?!\d)/g;
  for (const match of source.matchAll(pattern)) {
    if (match[1] !== undefined && !fields.includes(match[1])) {
      fields.push(match[1]);
    }
  }
  return Object.freeze(fields);
}

/**
 * @param {BuildConfiguration} configuration
 * @param {BuildDependencies} dependencies
 * @returns {{ok: true} | {ok: false, error: BuildFailure}}
 */
function validateBuildConfiguration(configuration, dependencies) {
  if (
    typeof configuration.sourceRoot !== "string" ||
    configuration.sourceRoot.trim().length === 0 ||
    typeof configuration.outputRoot !== "string" ||
    configuration.outputRoot.trim().length === 0 ||
    typeof dependencies.runEsbuild !== "function" ||
    typeof dependencies.runTerser !== "function"
  ) {
    return {
      ok: false,
      error: {
        kind: "InvalidBuildConfiguration",
        message: "The production build configuration is incomplete.",
      },
    };
  }
  if (
    normalizeDirectory(configuration.sourceRoot) ===
      normalizeDirectory(configuration.outputRoot)
  ) {
    return {
      ok: false,
      error: {
        kind: "InvalidBuildConfiguration",
        message: "The build output must be separate from the source root.",
      },
    };
  }
  return { ok: true };
}

/**
 * @param {string} sourceRoot
 * @param {readonly string[]} requiredInputs
 * @returns {Promise<{ok: true} | {ok: false, error: BuildFailure}>}
 */
async function validateInputs(sourceRoot, requiredInputs) {
  for (const input of requiredInputs) {
    const path = joinPath(sourceRoot, input);
    try {
      await Deno.stat(path);
    } catch (cause) {
      return {
        ok: false,
        error: {
          kind: "BuildInputMissing",
          message: `Required build input is unavailable: ${input}. ${
            errorMessage(cause)
          }`,
        },
      };
    }
  }
  return { ok: true };
}

/**
 * @param {string} directory
 * @returns {Promise<{ok: true} | {ok: false, error: BuildFailure}>}
 */
async function prepareTemporaryDirectory(directory) {
  const removed = await removePath(directory);
  if (!removed.ok) return removed;
  try {
    await Deno.mkdir(directory, { recursive: true });
    return { ok: true };
  } catch (cause) {
    return {
      ok: false,
      error: {
        kind: "BuildPublishFailed",
        message: `The temporary build directory could not be created: ${
          errorMessage(cause)
        }`,
      },
    };
  }
}

/**
 * @param {string} source
 * @param {string} destination
 * @returns {Promise<{ok: true} | {ok: false, error: BuildFailure}>}
 */
async function copyPath(source, destination) {
  try {
    const stat = await Deno.stat(source);
    if (stat.isDirectory) {
      await Deno.mkdir(destination, { recursive: true });
      for await (const entry of Deno.readDir(source)) {
        const copied = await copyPath(
          joinPath(source, entry.name),
          joinPath(destination, entry.name),
        );
        if (!copied.ok) return copied;
      }
    } else if (stat.isFile) {
      await Deno.mkdir(parentPath(destination), { recursive: true });
      await Deno.copyFile(source, destination);
    } else {
      return {
        ok: false,
        error: {
          kind: "StaticCopyFailed",
          message: `Unsupported static build input: ${source}.`,
        },
      };
    }
    return { ok: true };
  } catch (cause) {
    return {
      ok: false,
      error: {
        kind: "StaticCopyFailed",
        message: `Static build input could not be copied: ${
          errorMessage(cause)
        }`,
      },
    };
  }
}

/**
 * @param {string} path
 * @returns {Promise<
 *   {ok: true, value: string} | {ok: false, error: BuildFailure}
 * >}
 */
async function readBuiltText(path) {
  try {
    return { ok: true, value: await Deno.readTextFile(path) };
  } catch (cause) {
    return {
      ok: false,
      error: {
        kind: "BuiltArtifactMissing",
        message: `A required built artifact is unavailable: ${
          errorMessage(cause)
        }`,
      },
    };
  }
}

/**
 * @param {string} directory
 * @param {string} extension
 * @returns {Promise<readonly string[]>}
 */
async function listFiles(directory, extension) {
  /** @type {string[]} */
  const paths = [];
  for await (const entry of Deno.readDir(directory)) {
    const path = joinPath(directory, entry.name);
    if (entry.isDirectory) {
      paths.push(...await listFiles(path, extension));
    } else if (entry.isFile && entry.name.endsWith(extension)) {
      paths.push(path);
    }
  }
  return paths.sort();
}

/**
 * @param {string} path
 * @param {string} displayPath
 * @returns {Promise<
 *   {ok: true, artifact: BuildArtifact} |
 *   {ok: false, error: BuildFailure}
 * >}
 */
async function measureArtifact(path, displayPath) {
  try {
    const content = await Deno.readFile(path);
    const compressed = content.byteLength === 0
      ? new Uint8Array()
      : new Uint8Array(
        await new Response(
          new Blob([content]).stream().pipeThrough(
            new CompressionStream("gzip"),
          ),
        ).arrayBuffer(),
      );
    return {
      ok: true,
      artifact: {
        path: displayPath,
        rawBytes: content.byteLength,
        gzipBytes: compressed.byteLength,
      },
    };
  } catch (cause) {
    return {
      ok: false,
      error: {
        kind: "BuiltArtifactMissing",
        message: `A required built artifact could not be measured: ${
          errorMessage(cause)
        }`,
      },
    };
  }
}

/**
 * @param {string} temporaryRoot
 * @param {string} outputRoot
 * @returns {Promise<{ok: true} | {ok: false, error: BuildFailure}>}
 */
async function publishBuild(temporaryRoot, outputRoot) {
  const removed = await removePath(outputRoot);
  if (!removed.ok) return removed;
  try {
    await Deno.rename(temporaryRoot, outputRoot);
    return { ok: true };
  } catch (cause) {
    return {
      ok: false,
      error: {
        kind: "BuildPublishFailed",
        message: `The validated production build could not be published: ${
          errorMessage(cause)
        }`,
      },
    };
  }
}

/**
 * @param {string} path
 * @returns {Promise<{ok: true} | {ok: false, error: BuildFailure}>}
 */
async function removePath(path) {
  try {
    await Deno.remove(path, { recursive: true });
    return { ok: true };
  } catch (cause) {
    if (cause instanceof Deno.errors.NotFound) return { ok: true };
    return {
      ok: false,
      error: {
        kind: "BuildCleanupFailed",
        message: `A previous build directory could not be removed: ${
          errorMessage(cause)
        }`,
      },
    };
  }
}

/**
 * @param {BuildFailure} failure
 * @param {string} temporaryRoot
 * @returns {Promise<{ok: false, error: BuildFailure}>}
 */
async function failWithCleanup(failure, temporaryRoot) {
  const cleanup = await removePath(temporaryRoot);
  return cleanup.ok ? { ok: false, error: failure } : cleanup;
}

/**
 * @param {"javascript" | "stylesheet"} stage
 * @param {Exclude<EsbuildResult, {ok: true}>["error"]} error
 * @returns {BuildFailure}
 */
function mapEsbuildFailure(stage, error) {
  if (
    error.kind === "BuildDependencyUnavailable" ||
    error.kind === "BuildDependencyVersionMismatch"
  ) {
    return { kind: error.kind, message: error.message };
  }
  return {
    kind: stage === "javascript"
      ? "JavaScriptBuildFailed"
      : "StylesheetBuildFailed",
    message: error.message,
  };
}

/** @param {Exclude<EsbuildResult, {ok:true}>["error"]} error @returns {BuildFailure} */
function mapTerserFailure(error) {
  if (
    error.kind === "BuildDependencyUnavailable" ||
    error.kind === "BuildDependencyVersionMismatch"
  ) return { kind: error.kind, message: error.message };
  return { kind: "JavaScriptMinificationFailed", message: error.message };
}

/**
 * @param {string} command
 * @param {readonly string[]} prefixArguments
 * @param {string} expectedVersion
 * @returns {Promise<EsbuildResult>}
 */
async function verifyEsbuildVersion(command, prefixArguments, expectedVersion) {
  const result = await executeCommand(command, [
    ...prefixArguments,
    "--version",
  ]);
  if (!result.ok) return result;
  if (result.exitCode !== 0) {
    return {
      ok: false,
      error: {
        kind: "BuildDependencyUnavailable",
        message: `esbuild could not start: ${
          summarizeCommandError(result.stderr)
        }`,
      },
    };
  }
  const actualVersion = result.stdout.trim();
  if (actualVersion !== expectedVersion) {
    return {
      ok: false,
      error: {
        kind: "BuildDependencyVersionMismatch",
        message: `Expected esbuild ${expectedVersion}, received ${
          actualVersion || "an unknown version"
        }.`,
      },
    };
  }
  return { ok: true };
}

/** @param {string} command @param {readonly string[]} prefixArguments @param {string} expectedVersion @returns {Promise<EsbuildResult>} */
async function verifyTerserVersion(command, prefixArguments, expectedVersion) {
  const result = await executeCommand(command, [
    ...prefixArguments,
    "--version",
  ]);
  if (!result.ok) return result;
  if (result.exitCode !== 0) {
    return dependencyUnavailable(
      `Terser could not start: ${summarizeCommandError(result.stderr)}`,
    );
  }
  const actualVersion = result.stdout.trim().replace(/^terser\s+/, "");
  return actualVersion === expectedVersion ? { ok: true } : {
    ok: false,
    error: {
      kind: "BuildDependencyVersionMismatch",
      message: `Expected Terser ${expectedVersion}, received ${
        actualVersion || "an unknown version"
      }.`,
    },
  };
}

/** @param {string} message @returns {EsbuildResult} */
function dependencyUnavailable(message) {
  return { ok: false, error: { kind: "BuildDependencyUnavailable", message } };
}

/**
 * @param {string} command
 * @param {readonly string[]} arguments_
 * @returns {Promise<
 *   {ok: true, exitCode: number, stdout: string, stderr: string} |
 *   {ok: false, error: Exclude<EsbuildResult, {ok: true}>["error"]}
 * >}
 */
async function executeCommand(command, arguments_) {
  try {
    const output = await new Deno.Command(command, {
      args: [...arguments_],
      stdout: "piped",
      stderr: "piped",
    }).output();
    const decoder = new TextDecoder();
    return {
      ok: true,
      exitCode: output.code,
      stdout: decoder.decode(output.stdout),
      stderr: decoder.decode(output.stderr),
    };
  } catch (cause) {
    return {
      ok: false,
      error: {
        kind: "BuildDependencyUnavailable",
        message: `Build dependency could not be executed: ${
          errorMessage(cause)
        }`,
      },
    };
  }
}

/** @param {unknown} cause */
function errorMessage(cause) {
  return cause instanceof Error ? cause.message : String(cause);
}

/** @param {string} value */
function normalizeDirectory(value) {
  return value.replace(/[\\/]+$/, "");
}

/** @param {string} directory @param {string} child */
function joinPath(directory, child) {
  return `${normalizeDirectory(directory)}/${child.replace(/^[\\/]+/, "")}`;
}

/** @param {string} path */
function parentPath(path) {
  const index = path.lastIndexOf("/");
  return index <= 0 ? "." : path.slice(0, index);
}

/** @param {string} value */
function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** @param {string} stderr */
function summarizeCommandError(stderr) {
  const summary = stderr.trim().split(/\r?\n/, 1)[0];
  return summary.length > 0
    ? summary
    : "Build dependency returned a non-zero exit code.";
}

/**
 * @param {readonly string[]} arguments_
 * @returns {{
 *   sourceRoot: string,
 *   outputRoot: string,
 *   esbuildBinary: string | null,
 *   terserBinary: string | null,
 * }}
 */
function parseArguments(arguments_) {
  const projectRoot = decodeURIComponent(
    new URL("../", import.meta.url).pathname,
  ).replace(/\/$/, "");
  let sourceRoot = projectRoot;
  let outputRoot = joinPath(projectRoot, "dist");
  /** @type {string | null} */
  let esbuildBinary = null;
  /** @type {string | null} */
  let terserBinary = null;

  for (const argument of arguments_) {
    if (argument.startsWith("--source-root=")) {
      sourceRoot = argument.slice("--source-root=".length);
    } else if (argument.startsWith("--output-root=")) {
      outputRoot = argument.slice("--output-root=".length);
    } else if (argument.startsWith("--esbuild-binary=")) {
      esbuildBinary = argument.slice("--esbuild-binary=".length);
    } else if (argument.startsWith("--terser-binary=")) {
      terserBinary = argument.slice("--terser-binary=".length);
    } else {
      throw new Error(`Unknown build argument: ${argument}`);
    }
  }
  return { sourceRoot, outputRoot, esbuildBinary, terserBinary };
}

if (import.meta.main) {
  let parsed;
  try {
    parsed = parseArguments(Deno.args);
  } catch (cause) {
    console.error(`[InvalidBuildConfiguration] ${errorMessage(cause)}`);
    Deno.exit(1);
  }

  const runner = parsed.esbuildBinary === null
    ? createEsbuildRunner({
      command: "npx",
      prefixArguments: ["--yes", `esbuild@${ESBUILD_VERSION}`],
    })
    : createEsbuildRunner({ command: parsed.esbuildBinary });
  const terser = parsed.terserBinary === null
    ? createTerserRunner({
      command: "npx",
      prefixArguments: ["--yes", `terser@${TERSER_VERSION}`],
    })
    : createTerserRunner({ command: parsed.terserBinary });
  const result = await buildProject(
    { sourceRoot: parsed.sourceRoot, outputRoot: parsed.outputRoot },
    { runEsbuild: runner, runTerser: terser },
  );
  if (!result.ok) {
    console.error(`[${result.error.kind}] ${result.error.message}`);
    Deno.exit(1);
  }
  for (const artifact of result.artifacts) {
    console.log(
      `${artifact.path}: ${artifact.rawBytes} bytes raw, ${artifact.gzipBytes} bytes gzip`,
    );
  }
  const javascript = result.artifacts.filter((artifact) => artifact.path.startsWith("src/") && artifact.path.endsWith(".js"));
  console.log(`Aggregate JavaScript: ${javascript.reduce((sum, artifact) => sum + artifact.rawBytes, 0)} bytes raw / ${ARTIFACT_BUDGETS.aggregateJavascript.rawBytes} cap, ${javascript.reduce((sum, artifact) => sum + artifact.gzipBytes, 0)} bytes gzip / ${ARTIFACT_BUDGETS.aggregateJavascript.gzipBytes} cap`);
}
