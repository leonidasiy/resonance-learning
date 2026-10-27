// @ts-check

/** @template T, E @typedef {{ readonly ok: true, readonly value: T } | { readonly ok: false, readonly error: E }} Result */

/** @typedef {"rights-assessor" | "knowledge-scraper" | "question-generator" | "question-evaluator"} AgentRole */

/**
 * @typedef {{
 *   readonly id: string,
 *   readonly ownerId: string,
 *   readonly runId: string,
 *   readonly role: AgentRole,
 *   readonly mode: "enabled" | "disabled-by-task",
 *   readonly humanApprovalId: string | null,
 *   readonly createdAt: string
 * }} AgentMemoryNamespace
 */

/**
 * @typedef {{
 *   readonly id: string,
 *   readonly namespaceId: string,
 *   readonly kind: "working-memory" | "durable-fact" | "decision" | "unresolved",
 *   readonly visibility: "private" | "shared",
 *   readonly retention: "run" | "source" | "audit",
 *   readonly integrityVersion: number,
 *   readonly sourceEventId: string,
 *   readonly occurredAt: string,
 *   readonly payload: unknown
 * }} AgentMemoryRecord
 */

/**
 * @typedef {{
 *   readonly id: string,
 *   readonly producer: AgentMemoryNamespace,
 *   readonly consumer: AgentMemoryNamespace,
 *   readonly sourceEventId: string,
 *   readonly occurredAt: string,
 *   readonly payload: unknown
 * }} SharedHandoff
 */

/**
 * @typedef {{
 *   readonly ownerId: string,
 *   readonly runId: string,
 *   readonly role: AgentRole,
 *   readonly memoryMode?: "enabled" | "disabled-by-task",
 *   readonly humanApprovalId?: string
 * }} AgentMemoryNamespaceCommand
 */

/**
 * @typedef {{
 *   readonly id: string,
 *   readonly kind: AgentMemoryRecord["kind"],
 *   readonly visibility: AgentMemoryRecord["visibility"],
 *   readonly retention: AgentMemoryRecord["retention"],
 *   readonly integrityVersion: number,
 *   readonly sourceEventId: string,
 *   readonly payload: unknown
 * }} AgentMemoryRecordCommand
 */

/**
 * @typedef {{
 *   readonly id: string,
 *   readonly producer: AgentMemoryNamespace,
 *   readonly consumer: AgentMemoryNamespace,
 *   readonly sourceEventId: string,
 *   readonly payload: unknown
 * }} SharedHandoffCommand
 */

/**
 * @typedef {{
 *   readonly findNamespace: (id: string, ownerId: string) => Promise<AgentMemoryNamespace | null>,
 *   readonly createNamespace: (namespace: AgentMemoryNamespace) => Promise<null>,
 *   readonly appendRecord: (record: AgentMemoryRecord, ownerId: string) => Promise<null>,
 *   readonly listRecords: (namespaceId: string, ownerId: string) => Promise<readonly AgentMemoryRecord[]>,
 *   readonly appendHandoff: (handoff: SharedHandoff) => Promise<null>
 * }} AgentMemoryRepository
 */

/** @typedef {{ readonly repository: AgentMemoryRepository, readonly now: () => string, readonly logger: AgentMemoryLogger }} AgentMemoryDependencies */

/** @typedef {(entry: { readonly event: string, readonly ownerId?: string, readonly runId?: string, readonly role?: AgentRole, readonly failureKind?: string }) => void} AgentMemoryLogger */

/**
 * @typedef {{
 *   readonly kind: "AgentMemoryCommandInvalid",
 *   readonly field: string
 * } | {
 *   readonly kind: "AgentMemoryIsolationViolation"
 * } | {
 *   readonly kind: "MemoryModeDisabledWithoutApproval"
 * } | {
 *   readonly kind: "AgentMemoryNamespaceConflict"
 * } | {
 *   readonly kind: "SharedHandoffUnauthorized"
 * } | {
 *   readonly kind: "AgentMemoryPersistenceFailed"
 * }} AgentMemoryFailure
 */

/** @param {unknown} value @returns {value is string} */
function isNonEmptyText(value) {
  return typeof value === "string" && value.trim() !== "";
}

/** @param {unknown} value @returns {value is AgentRole} */
function isAgentRole(value) {
  return value === "rights-assessor" || value === "knowledge-scraper" ||
    value === "question-generator" || value === "question-evaluator";
}

/** @param {unknown} value @returns {value is number} */
function isPositiveInteger(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/** @param {AgentMemoryNamespace} namespace @returns {string} */
function namespaceFingerprint(namespace) {
  return [namespace.ownerId, namespace.runId, namespace.role, namespace.mode, namespace.humanApprovalId ?? ""].join("\u001f");
}

/** @param {AgentMemoryNamespace} expected @param {AgentMemoryNamespace} actual @returns {boolean} */
function sameNamespace(expected, actual) {
  return expected.id === actual.id && namespaceFingerprint(expected) === namespaceFingerprint(actual);
}

/** @param {unknown} value @returns {value is AgentMemoryNamespace} */
function isNamespace(value) {
  if (!value || typeof value !== "object") return false;
  const candidate = /** @type {Partial<AgentMemoryNamespace>} */ (value);
  return isNonEmptyText(candidate.id) && isNonEmptyText(candidate.ownerId) &&
    isNonEmptyText(candidate.runId) && isAgentRole(candidate.role) &&
    (candidate.mode === "enabled" || candidate.mode === "disabled-by-task") &&
    (candidate.humanApprovalId === null || isNonEmptyText(candidate.humanApprovalId)) &&
    isNonEmptyText(candidate.createdAt);
}

/**
 * Creates the owner/run/role-isolated memory boundary. The repository is
 * injected so production can use D1 while tests can use a deterministic fake.
 * @param {AgentMemoryDependencies} dependencies
 */
export function createAgentMemoryStore(dependencies) {
  if (!dependencies || !dependencies.repository ||
    typeof dependencies.repository.findNamespace !== "function" ||
    typeof dependencies.repository.createNamespace !== "function" ||
    typeof dependencies.repository.appendRecord !== "function" ||
    typeof dependencies.repository.listRecords !== "function" ||
    typeof dependencies.repository.appendHandoff !== "function" ||
    typeof dependencies.now !== "function" || typeof dependencies.logger !== "function") {
    throw new TypeError("Agent memory dependencies are invalid.");
  }
  const { repository, now, logger } = dependencies;
  return Object.freeze({
    /** @param {AgentMemoryNamespaceCommand} command @returns {Promise<Result<AgentMemoryNamespace, AgentMemoryFailure>>} */
    async createNamespace(command) {
      if (!command || !isNonEmptyText(command.ownerId)) {
        return { ok: false, error: { kind: "AgentMemoryCommandInvalid", field: "ownerId" } };
      }
      if (!isNonEmptyText(command.runId)) {
        return { ok: false, error: { kind: "AgentMemoryCommandInvalid", field: "runId" } };
      }
      if (!isAgentRole(command.role)) {
        return { ok: false, error: { kind: "AgentMemoryCommandInvalid", field: "role" } };
      }
      const mode = command.memoryMode ?? "enabled";
      if (mode !== "enabled" && mode !== "disabled-by-task") {
        return { ok: false, error: { kind: "AgentMemoryCommandInvalid", field: "memoryMode" } };
      }
      if (mode === "disabled-by-task" && !isNonEmptyText(command.humanApprovalId)) {
        logger({ event: "agent-memory.failure", ownerId: command.ownerId, runId: command.runId, role: command.role, failureKind: "MemoryModeDisabledWithoutApproval" });
        return { ok: false, error: { kind: "MemoryModeDisabledWithoutApproval" } };
      }
      const namespace = /** @type {AgentMemoryNamespace} */ ({
        id: `agent-memory:${encodeURIComponent(command.ownerId)}:${encodeURIComponent(command.runId)}:${command.role}`,
        ownerId: command.ownerId,
        runId: command.runId,
        role: command.role,
        mode,
        humanApprovalId: mode === "disabled-by-task" ? command.humanApprovalId : null,
        createdAt: now(),
      });
      logger({ event: "agent-memory.entry", ownerId: namespace.ownerId, runId: namespace.runId, role: namespace.role });
      let existing;
      try {
        existing = await repository.findNamespace(namespace.id, namespace.ownerId);
      } catch {
        logger({ event: "agent-memory.failure", ownerId: namespace.ownerId, runId: namespace.runId, role: namespace.role, failureKind: "AgentMemoryPersistenceFailed" });
        return { ok: false, error: { kind: "AgentMemoryPersistenceFailed" } };
      }
      if (existing !== null) {
        if (!sameNamespace(namespace, existing)) {
          logger({ event: "agent-memory.failure", ownerId: namespace.ownerId, runId: namespace.runId, role: namespace.role, failureKind: "AgentMemoryNamespaceConflict" });
          return { ok: false, error: { kind: "AgentMemoryNamespaceConflict" } };
        }
        logger({ event: "agent-memory.success", ownerId: existing.ownerId, runId: existing.runId, role: existing.role });
        return { ok: true, value: existing };
      }
      try {
        await repository.createNamespace(namespace);
      } catch {
        logger({ event: "agent-memory.failure", ownerId: namespace.ownerId, runId: namespace.runId, role: namespace.role, failureKind: "AgentMemoryPersistenceFailed" });
        return { ok: false, error: { kind: "AgentMemoryPersistenceFailed" } };
      }
      logger({ event: "agent-memory.success", ownerId: namespace.ownerId, runId: namespace.runId, role: namespace.role });
      return { ok: true, value: namespace };
    },

    /** @param {AgentMemoryNamespace} namespace @param {AgentMemoryRecordCommand} command @returns {Promise<Result<AgentMemoryRecord, AgentMemoryFailure>>} */
    async appendRecord(namespace, command) {
      if (!isNamespace(namespace)) return { ok: false, error: { kind: "AgentMemoryIsolationViolation" } };
      if (!command || !isNonEmptyText(command.id)) return { ok: false, error: { kind: "AgentMemoryCommandInvalid", field: "id" } };
      if (!isNonEmptyText(command.kind)) return { ok: false, error: { kind: "AgentMemoryCommandInvalid", field: "kind" } };
      if (!isNonEmptyText(command.visibility)) return { ok: false, error: { kind: "AgentMemoryCommandInvalid", field: "visibility" } };
      if (!isNonEmptyText(command.retention)) return { ok: false, error: { kind: "AgentMemoryCommandInvalid", field: "retention" } };
      if (!isPositiveInteger(command.integrityVersion)) return { ok: false, error: { kind: "AgentMemoryCommandInvalid", field: "integrityVersion" } };
      if (!isNonEmptyText(command.sourceEventId)) return { ok: false, error: { kind: "AgentMemoryCommandInvalid", field: "sourceEventId" } };
      let stored;
      try {
        stored = await repository.findNamespace(namespace.id, namespace.ownerId);
      } catch {
        return { ok: false, error: { kind: "AgentMemoryPersistenceFailed" } };
      }
      if (stored === null || !sameNamespace(namespace, stored)) {
        logger({ event: "agent-memory.failure", ownerId: namespace.ownerId, runId: namespace.runId, role: namespace.role, failureKind: "AgentMemoryIsolationViolation" });
        return { ok: false, error: { kind: "AgentMemoryIsolationViolation" } };
      }
      const record = /** @type {AgentMemoryRecord} */ ({ ...command, namespaceId: namespace.id, occurredAt: now() });
      try {
        await repository.appendRecord(record, namespace.ownerId);
      } catch {
        logger({ event: "agent-memory.failure", ownerId: namespace.ownerId, runId: namespace.runId, role: namespace.role, failureKind: "AgentMemoryPersistenceFailed" });
        return { ok: false, error: { kind: "AgentMemoryPersistenceFailed" } };
      }
      logger({ event: "agent-memory.success", ownerId: namespace.ownerId, runId: namespace.runId, role: namespace.role });
      return { ok: true, value: record };
    },

    /** @param {AgentMemoryNamespace} namespace @returns {Promise<Result<readonly AgentMemoryRecord[], AgentMemoryFailure>>} */
    async listRecords(namespace) {
      if (!isNamespace(namespace)) return { ok: false, error: { kind: "AgentMemoryIsolationViolation" } };
      let stored;
      try {
        stored = await repository.findNamespace(namespace.id, namespace.ownerId);
      } catch {
        return { ok: false, error: { kind: "AgentMemoryPersistenceFailed" } };
      }
      if (stored === null || !sameNamespace(namespace, stored)) return { ok: false, error: { kind: "AgentMemoryIsolationViolation" } };
      try {
        return { ok: true, value: await repository.listRecords(namespace.id, namespace.ownerId) };
      } catch {
        return { ok: false, error: { kind: "AgentMemoryPersistenceFailed" } };
      }
    },

    /** @param {SharedHandoffCommand} command @returns {Promise<Result<SharedHandoff, AgentMemoryFailure>>} */
    async shareHandoff(command) {
      if (!command || !isNonEmptyText(command.id) || !isNonEmptyText(command.sourceEventId)) {
        return { ok: false, error: { kind: "AgentMemoryCommandInvalid", field: "handoff" } };
      }
      if (!isNamespace(command.producer) || !isNamespace(command.consumer) ||
        command.producer.ownerId !== command.consumer.ownerId ||
        command.producer.runId !== command.consumer.runId ||
        command.producer.role === command.consumer.role) {
        logger({ event: "agent-memory.failure", failureKind: "SharedHandoffUnauthorized" });
        return { ok: false, error: { kind: "SharedHandoffUnauthorized" } };
      }
      let producer;
      let consumer;
      try {
        producer = await repository.findNamespace(command.producer.id, command.producer.ownerId);
        consumer = await repository.findNamespace(command.consumer.id, command.consumer.ownerId);
      } catch {
        return { ok: false, error: { kind: "AgentMemoryPersistenceFailed" } };
      }
      if (producer === null || consumer === null || !sameNamespace(command.producer, producer) || !sameNamespace(command.consumer, consumer)) {
        logger({ event: "agent-memory.failure", failureKind: "SharedHandoffUnauthorized" });
        return { ok: false, error: { kind: "SharedHandoffUnauthorized" } };
      }
      const handoff = /** @type {SharedHandoff} */ ({ ...command, occurredAt: now() });
      try {
        await repository.appendHandoff(handoff);
      } catch {
        return { ok: false, error: { kind: "AgentMemoryPersistenceFailed" } };
      }
      logger({ event: "agent-memory.success", ownerId: producer.ownerId, runId: producer.runId, role: producer.role });
      return { ok: true, value: handoff };
    },
  });
}

export {};
