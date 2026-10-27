// @ts-check

/** @template T, E @typedef {{ readonly ok: true, readonly value: T } | { readonly ok: false, readonly error: E }} Result */

/** @typedef {"active" | "disabled"} LibrarySourceState */
/** @typedef {"web" | "private-document"} LibrarySourceOrigin */

/** @typedef {"keyword" | "semantic" | "combined"} SourceSearchMode */
/** @typedef {"sources" | "knowledge"} SourceSearchScope */

/**
 * @typedef {{
 *   readonly attribute: string,
 *   readonly value: string,
 *   readonly provenanceUrl: string,
 *   readonly observedAt: string
 * }} SourceIdentityEvidence
 */

/**
 * @typedef {{
 *   readonly id: string,
 *   readonly version: string,
 *   readonly granularity: string,
 *   readonly capabilities: readonly string[]
 * }} SourceAdapterContract
 */

/**
 * @typedef {{
 *   readonly itemId: string,
 *   readonly versionId: string,
 *   readonly canonicalUrl: string,
 *   readonly title: string,
 *   readonly description: string,
 *   readonly contentDigest: string,
 *   readonly provenance: readonly { readonly method: string, readonly reference: string }[],
 *   readonly observedAt: string,
 *   readonly publishedAt: string | null
 * }} SourceApprovalInitialItem
 */

/**
 * @typedef {{
 *   readonly id: string,
 *   readonly ownerId: string,
 *   readonly origin?: LibrarySourceOrigin,
 *   readonly submittedUrl: string,
 *   readonly canonicalUrl: string,
 *   readonly title: string,
 *   readonly description: string,
 *   readonly adapter: SourceAdapterContract,
 *   readonly primarySubject?: string | null,
 *   readonly sourceTopic?: string | null,
 *   readonly interestAreaIds: readonly string[],
 *   readonly identityEvidence: readonly SourceIdentityEvidence[],
 *   readonly state: LibrarySourceState,
 *   readonly approvedAt: string,
 *   readonly updatedAt: string,
 *   readonly revision: number
 * }} LibrarySource
 */

/**
 * @typedef {{
 *   readonly id: string,
 *   readonly ownerId: string,
 *   readonly title: string,
 *   readonly provenance: string
 * }} SourceInterestArea
 */

/**
 * @typedef {{
 *   readonly items: readonly LibrarySource[],
 *   readonly interestAreas: readonly SourceInterestArea[],
 *   readonly nextCursor: string | null
 * }} SourceCatalogPage
 */

/**
 * @typedef {{
 *   readonly source: LibrarySource,
 *   readonly score: number
 * }} SourceSearchHit
 */

/**
 * @typedef {{
 *   readonly knowledgeId: string,
 *   readonly sourceId: string,
 *   readonly sourceTitle: string,
 *   readonly summary: string,
 *   readonly sourceUrl: string,
 *   readonly evidenceAnchorIds: readonly string[],
 *   readonly questionLocked: boolean
 * }} LibraryKnowledgeSearchResult
 */

/**
 * @typedef {{
 *   readonly knowledge: LibraryKnowledgeSearchResult,
 *   readonly score: number,
 *   readonly matchedBy: "exact" | "semantic" | "combined"
 * }} KnowledgeSearchHit
 */

/**
 * @typedef {{
 *   readonly id: string,
 *   readonly ownerId: string,
 *   readonly canonicalIdentity: string,
 *   readonly identityEvidence: readonly SourceIdentityEvidence[],
 *   readonly idempotencyKey: string,
 *   readonly createdAt: string
 * }} SourceSuppression
 */

/**
 * @typedef {{
 *   readonly id: string,
 *   readonly ownerId: string,
 *   readonly sourceId: string,
 *   readonly sourceRevision: number,
 *   readonly policyVersion: string,
 *   readonly state: "pending",
 *   readonly createdAt: string
 * }} SourceIngestionJob
 */

/**
 * @typedef {{
 *   readonly id: string,
 *   readonly ownerId: string,
 *   readonly sourceId: string,
 *   readonly kind: "approved" | "revised" | "disabled" | "restored",
 *   readonly sourceRevision: number,
 *   readonly idempotencyKey: string,
 *   readonly occurredAt: string
 * }} LibrarySourceEvent
 */

/**
 * @typedef {{
 *   readonly kind: "SourceCatalogCommandInvalid",
 *   readonly field: string
 * } | {
 *   readonly kind: "SourceIdentityMissing"
 * } | {
 *   readonly kind: "SourceIdentityAmbiguous"
 * } | {
 *   readonly kind: "SourceIdentityConflict"
 * } | {
 *   readonly kind: "SourceNotFound",
 *   readonly sourceId: string
 * } | {
 *   readonly kind: "SourceOwnerMismatch",
 *   readonly sourceId: string
 * } | {
 *   readonly kind: "SourceRevisionStale",
 *   readonly expectedRevision: number,
 *   readonly actualRevision: number
 * } | {
 *   readonly kind: "SourceStateConflict",
 *   readonly sourceId: string,
 *   readonly state: LibrarySourceState,
 *   readonly revision: number
 * } | {
 *   readonly kind: "SourceIdempotencyConflict",
 *   readonly idempotencyKey: string
 * } | {
 *   readonly kind: "SourceInterestAreaMissing",
 *   readonly interestAreaId: string
 * } | {
 *   readonly kind: "SourceApprovalPersistenceFailed"
 * } | {
 *   readonly kind: "SourceCrawlEnqueueFailed"
 * } | {
 *   readonly kind: "SourceDisablePersistenceFailed"
 * } | {
 *   readonly kind: "SourceSuppressionFailed"
 * } | {
 *   readonly kind: "SourceCatalogReadFailed"
 * } | {
 *   readonly kind: "SourceCursorInvalid"
 * } | {
 *   readonly kind: "SourceCursorStale"
 * } | {
 *   readonly kind: "SourceCursorOwnerMismatch"
 * } | {
 *   readonly kind: "SourceSearchQueryInvalid"
 * } | {
 *   readonly kind: "SourceSearchQueryTooLong",
 *   readonly maximum: number
 * } | {
 *   readonly kind: "SourceKeywordSearchUnavailable"
 * } | {
 *   readonly kind: "SourceEmbeddingUnavailable"
 * } | {
 *   readonly kind: "SourceEmbeddingModelMismatch"
 * } | {
 *   readonly kind: "SourceEmbeddingDimensionMismatch"
 * } | {
 *   readonly kind: "SourceSemanticIndexUnavailable",
 *   readonly reason?: "NotConfigured" | "InvalidCommand" | "InvalidResponse" | "ProviderRejected" | "TransportFailed" | "TimedOut"
 * } | {
 *   readonly kind: "SourceSemanticConsentRequired"
 * } | {
 *   readonly kind: "SourceSemanticIndexOutOfSync"
 * }} SourceLibraryFailure
 */

/** @param {unknown} value @returns {value is Record<string, unknown>} */
export function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** @param {unknown} value @returns {value is string} */
export function isNonEmptyText(value) {
  return typeof value === "string" && value.trim() !== "";
}

/** @param {unknown} value @returns {value is string} */
export function isIsoDateTime(value) {
  return isNonEmptyText(value) && Number.isFinite(Date.parse(value));
}

/** @param {unknown} value @returns {value is string} */
export function isPublicHttpsUrl(value) {
  if (!isNonEmptyText(value) || !URL.canParse(value)) return false;
  const url = new URL(value);
  return url.protocol === "https:" && url.username === "" &&
    url.password === "" && url.hash === "";
}

export {};

/**
 * Validate a publisher destination before every request and redirect.
 * DNS-resolved addresses remain the responsibility of the injected fetch boundary.
 *
 * @param {unknown} value
 * @returns {Result<URL, {readonly kind:"DiscoverySourceUrlInvalid"}|{readonly kind:"DiscoverySourceProtocolUnsupported",readonly protocol:string}|{readonly kind:"DiscoveryDestinationForbidden",readonly reason:string}>}
 */
export function validatePublisherDestination(value) {
  if (typeof value !== "string" || !URL.canParse(value)) {
    return { ok: false, error: { kind: "DiscoverySourceUrlInvalid" } };
  }
  const url = new URL(value);
  if (url.protocol !== "https:") {
    return {
      ok: false,
      error: {
        kind: "DiscoverySourceProtocolUnsupported",
        protocol: url.protocol,
      },
    };
  }
  if (url.username !== "" || url.password !== "") {
    return {
      ok: false,
      error: { kind: "DiscoveryDestinationForbidden", reason: "credentials" },
    };
  }
  if (url.port !== "" && url.port !== "443") {
    return {
      ok: false,
      error: { kind: "DiscoveryDestinationForbidden", reason: "port" },
    };
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (
    hostname === "localhost" || hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") || hostname === "0"
  ) {
    return {
      ok: false,
      error: { kind: "DiscoveryDestinationForbidden", reason: "local-host" },
    };
  }
  if (hostname.includes(":")) {
    return {
      ok: false,
      error: { kind: "DiscoveryDestinationForbidden", reason: "ip-literal" },
    };
  }
  const ipv4 = parseIpv4(hostname);
  if (ipv4 !== null && isForbiddenIpv4(ipv4)) {
    return {
      ok: false,
      error: {
        kind: "DiscoveryDestinationForbidden",
        reason: "reserved-address",
      },
    };
  }
  return { ok: true, value: url };
}

/** @param {string} hostname @returns {readonly number[] | null} */
function parseIpv4(hostname) {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return null;
  const parts = hostname.split(".").map(Number);
  return parts.every((part) =>
      Number.isInteger(part) && part >= 0 && part <= 255
    )
    ? Object.freeze(parts)
    : null;
}

/** @param {readonly number[]} address */
function isForbiddenIpv4(address) {
  const [a, b, c] = address;
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) ||
    (a === 203 && b === 0 && c === 113);
}
