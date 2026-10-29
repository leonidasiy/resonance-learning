// @ts-check

import { createAgentConfigurationLoader } from "../src/features/knowledge-workflows/config.js";

Deno.test("every vendored YAML runtime file is tracked for fresh checkouts", async () => {
  const present = [];
  const directories = ["vendor/yaml/dist"];
  while (directories.length > 0) {
    const directory = directories.pop();
    if (directory === undefined) throw new Error("YAML directory traversal failed.");
    for await (const entry of Deno.readDir(directory)) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory) directories.push(path);
      else if (entry.isFile) present.push(path);
    }
  }
  if (present.length === 0) throw new Error("Vendored YAML runtime is missing.");
  const result = await new Deno.Command("git", { args: ["ls-files", "--", "vendor/yaml/dist"] }).output();
  if (!result.success) throw new Error("Git tracking check failed.");
  const tracked = new Set(new TextDecoder().decode(result.stdout).trim().split("\n"));
  for (const path of present) if (!tracked.has(path)) throw new Error(`Vendored YAML runtime is untracked: ${path}`);
});

/** @template T @param {T} actual @param {T} expected */
function assertEquals(actual, expected) {
  if (!Object.is(actual, expected)) {
    throw new Error(`Expected ${String(expected)}, received ${String(actual)}.`);
  }
}

/** @param {unknown} value */
function assertTrue(value) {
  if (value !== true) throw new Error("Expected true.");
}

const validYaml = `role: rights-assessor
version: rights-assessor-v2
model:
  provider: openrouter
  name: z-ai/glm-5.3-flash
procedureVersion: rights-procedure-v1
promptVersion: rights-prompt-v1
inputSchema: rights-assessment-command-v1
outputSchema: rights-decision-v1
allowedTools:
  - rights-evidence.read
memory:
  namespace: rights-assessor
  visibility: owner-run
limits:
  maxTurns: 3
  maxToolCalls: 8
  timeoutMs: 15000
  maxOutputBytes: 65536
  compactionThresholdTokens: 150000
retry:
  maxAttempts: 2
  backoffMs: 250
stopRules:
  - evidence-missing
  - evidence-conflicting
`;

function loader() {
  return createAgentConfigurationLoader({
    sha256: async (input) => `sha256:${input.length.toString(16)}`,
  });
}

Deno.test("configuration loader returns an immutable canonical snapshot", async () => {
  const result = await loader().load({ source: validYaml, expectedRole: "rights-assessor" });
  assertEquals(result.ok, true);
  if (!result.ok) return;
  assertEquals(result.value.role, "rights-assessor");
  assertEquals(result.value.model.name, "z-ai/glm-5.3-flash");
  assertEquals(result.value.promptVersion, "rights-prompt-v1");
  assertEquals(result.value.retry.maxAttempts, 2);
  assertEquals(result.value.limits.compactionThresholdTokens, 150000);
  assertEquals(result.value.digest, `sha256:${result.value.canonicalJson.length.toString(16)}`);
  assertTrue(Object.isFrozen(result.value));
  assertTrue(Object.isFrozen(result.value.limits));
});

Deno.test("optional model reasoning is validated and included in the immutable configuration digest", async () => {
  const canonical=createAgentConfigurationLoader({sha256:async input=>`sha256:${Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(input))),byte=>byte.toString(16).padStart(2,"0")).join("")}`});
  const original=await canonical.load({source:validYaml});assertTrue(original.ok);if(!original.ok)return;
  assertEquals(original.value.model.reasoningEffort,undefined);
  for(const effort of ["none","low","high"]) {
    const source=validYaml.replace("  name: z-ai/glm-5.3-flash",`  name: z-ai/glm-5.3-flash\n  reasoningEffort: ${effort}`);
    const loaded=await canonical.load({source});assertTrue(loaded.ok);if(!loaded.ok)return;
    assertEquals(loaded.value.model.reasoningEffort,effort);assertTrue(loaded.value.digest!==original.value.digest);assertTrue(Object.isFrozen(loaded.value.model));
    const stale=await canonical.load({source,expectedDigest:original.value.digest});assertEquals(stale.ok,false);
  }
  for(const effort of ["max","invalid","true","null","42","[high]","{value: high}"]) {
    const loaded=await canonical.load({source:validYaml.replace("  name: z-ai/glm-5.3-flash",`  name: z-ai/glm-5.3-flash\n  reasoningEffort: ${effort}`)});assertEquals(loaded.ok,false);
    if(!loaded.ok){assertEquals(loaded.error.kind,"WorkflowConfigurationFieldInvalid");if(loaded.error.kind==="WorkflowConfigurationFieldInvalid")assertEquals(loaded.error.field,"model.reasoningEffort");}
  }
});

Deno.test("configuration loader rejects unknown fields, missing limits, secrets, and role conflicts", async () => {
  const unknown = await loader().load({ source: `${validYaml}unknownField: true` });
  assertEquals(unknown.ok, false);
  if (!unknown.ok) assertEquals(unknown.error.kind, "WorkflowConfigurationFieldUnknown");

  const missing = await loader().load({ source: validYaml.replace("  maxTurns: 3\n", "") });
  assertEquals(missing.ok, false);
  if (!missing.ok) assertEquals(missing.error.kind, "WorkflowConfigurationFieldMissing");

  const secret = await loader().load({ source: `${validYaml}apiKey: forbidden` });
  assertEquals(secret.ok, false);
  if (!secret.ok) assertEquals(secret.error.kind, "WorkflowConfigurationSecretFieldForbidden");

  const conflict = await loader().load({ source: validYaml, expectedRole: "knowledge-scraper" });
  assertEquals(conflict.ok, false);
  if (!conflict.ok) assertEquals(conflict.error.kind, "WorkflowConfigurationRoleMismatch");

  const unsupportedParameter = await loader().load({ source: validYaml.replace("  name: z-ai/glm-5.3-flash", "  name: z-ai/glm-5.3-flash\n  temperature: 0") });
  assertEquals(unsupportedParameter.ok, false);
  if (!unsupportedParameter.ok) {
    assertEquals(unsupportedParameter.error.kind, "WorkflowConfigurationFieldUnknown");
    if (unsupportedParameter.error.kind === "WorkflowConfigurationFieldUnknown") assertEquals(unsupportedParameter.error.field, "model.temperature");
  }
});

Deno.test("configuration loader rejects aliases, tags, duplicate keys, and multiple documents", async () => {
  const alias = await loader().load({ source: validYaml.replace("  - evidence-missing\n", "  - &rule evidence-missing\n  - *rule\n") });
  assertEquals(alias.ok, false);
  if (!alias.ok) assertEquals(alias.error.kind, "WorkflowConfigurationYamlUnsafe");

  const tag = await loader().load({ source: validYaml.replace("version: rights-assessor-v2", "version: !!str rights-assessor-v2") });
  assertEquals(tag.ok, false);
  if (!tag.ok) assertEquals(tag.error.kind, "WorkflowConfigurationYamlUnsafe");

  const duplicate = await loader().load({ source: validYaml.replace("version: rights-assessor-v2", "version: rights-assessor-v2\nversion: duplicate") });
  assertEquals(duplicate.ok, false);
  if (!duplicate.ok) assertEquals(duplicate.error.kind, "WorkflowConfigurationYamlInvalid");

  const multiple = await loader().load({ source: `${validYaml}\n---\n${validYaml}` });
  assertEquals(multiple.ok, false);
  if (!multiple.ok) assertEquals(multiple.error.kind, "WorkflowConfigurationYamlInvalid");
});

Deno.test("configuration loader rejects malformed YAML and invalid exact limits", async () => {
  const malformed = await loader().load({ source: "role: [" });
  assertEquals(malformed.ok, false);
  if (!malformed.ok) assertEquals(malformed.error.kind, "WorkflowConfigurationYamlInvalid");

  const invalidLimit = await loader().load({ source: validYaml.replace("  maxTurns: 3", "  maxTurns: 0") });
  assertEquals(invalidLimit.ok, false);
  if (!invalidLimit.ok) assertEquals(invalidLimit.error.kind, "WorkflowConfigurationFieldInvalid");

  const invalidThreshold = await loader().load({ source: validYaml.replace("  compactionThresholdTokens: 150000", "  compactionThresholdTokens: 149999") });
  assertEquals(invalidThreshold.ok, false);
  if (!invalidThreshold.ok) assertEquals(invalidThreshold.error.kind, "WorkflowConfigurationFieldInvalid");
});

Deno.test("configuration loader rejects unsupported dispatch targets and resume mutations", async () => {
  const constrained = createAgentConfigurationLoader({
    sha256: async (input) => `sha256:${input.length.toString(16)}`,
    supportedModels: new Set(["openrouter/z-ai/glm-5.3-flash"]),
    supportedTools: new Set(["rights-evidence.read"]),
  });
  const unsupportedModel = await constrained.load({ source: validYaml.replace("z-ai/glm-5.3-flash", "unknown-model") });
  assertEquals(unsupportedModel.ok, false);
  if (!unsupportedModel.ok) assertEquals(unsupportedModel.error.kind, "WorkflowConfigurationModelUnsupported");
  const unsupportedTool = await constrained.load({ source: validYaml.replace("rights-evidence.read", "unknown.tool") });
  assertEquals(unsupportedTool.ok, false);
  if (!unsupportedTool.ok) assertEquals(unsupportedTool.error.kind, "WorkflowConfigurationToolUnsupported");
  const accepted = await loader().load({ source: validYaml });
  if (!accepted.ok) throw new Error("Expected valid configuration.");
  const mutated = await loader().load({ source: validYaml.replace("rights-prompt-v1", "mutated-prompt-v2"), expectedDigest: accepted.value.digest });
  assertEquals(mutated.ok, false);
  if (!mutated.ok) assertEquals(mutated.error.kind, "WorkflowConfigurationDigestMismatch");
});

Deno.test("all checked-in role configurations satisfy the closed schema", async () => {
  const roles = /** @type {const} */ ([
    "rights-assessor",
    "knowledge-scraper",
    "question-generator",
    "question-evaluator",
  ]);
  for (const role of roles) {
    const source = await Deno.readTextFile(new URL(`../agent-config/${role}.yaml`, import.meta.url));
    const result = await loader().load({ source, expectedRole: role });
    assertEquals(result.ok, true);
    if (result.ok) {
      assertEquals(result.value.role, role);
      assertEquals(result.value.limits.compactionThresholdTokens, 500_000);
      if (role === "question-evaluator") {
        assertEquals(result.value.model.name, "xiaomi/mimo-v2.6-flash");
        assertEquals(result.value.model.reasoningEffort, "none");
      }
    }
  }
});

Deno.test("setup template workflow digests match the checked-in role configurations", async () => {
  const config = await Deno.readTextFile(new URL("../wrangler.self-host.example.jsonc", import.meta.url));
  const encoded = /"KNOWLEDGE_WORKFLOW_CONFIG_DIGESTS":\s*("(?:\\.|[^"\\])*")/.exec(config)?.[1];
  if (encoded === undefined) throw new Error("Workflow digest configuration is missing.");
  const digests = JSON.parse(JSON.parse(encoded));
  const hash = async (/** @type {string} */ input) => `sha256:${Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input))),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("")}`;
  const canonical = createAgentConfigurationLoader({ sha256: hash });
  for (const role of ["rights-assessor", "knowledge-scraper", "question-generator", "question-evaluator"]) {
    const source = await Deno.readTextFile(new URL(`../agent-config/${role}.yaml`, import.meta.url));
    const loaded = await canonical.load({ source, expectedRole: /** @type {import("../src/features/knowledge-workflows/config.js").AgentRole} */ (role), expectedDigest: digests[role] });
    if (!loaded.ok) throw new Error(`${role}: ${loaded.error.kind}`);
  }
});
