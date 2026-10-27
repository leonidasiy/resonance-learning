export type Result<T> = { readonly ok: true; readonly value: T } | {
  readonly ok: false;
  readonly error: Failure;
};
export const FAILURE_KINDS = [
  "CommandInvalid",
  "ConfigurationInvalid",
  "UrlInvalid",
  "CredentialsRejected",
  "HttpsRequired",
  "PortRejected",
  "AddressRejected",
  "DnsFailed",
  "ConnectFailed",
  "TlsFailed",
  "RedirectRejected",
  "RedirectLimitExceeded",
  "ScopeRejected",
  "EncodedLimitExceeded",
  "DecodedLimitExceeded",
  "OperationLimitExceeded",
  "EncodingUnsupported",
  "DecodeFailed",
  "TimedOut",
  "Cancelled",
  "AuthenticationRequired",
  "OperationConflict",
  "OperationNotFound",
  "BrowserTransportUnsupported",
  "BrowserFailed",
  "ImageTypeUnsupported",
  "ImageDecodeFailed",
  "PixelLimitExceeded",
  "FrameLimitExceeded",
  "KnowledgePageAuthenticationRequired",
  "KnowledgePagePaywallDetected",
  "KnowledgePageBotAccessDenied",
  "KnowledgePageRateLimited",
  "KnowledgePageFetchFailed",
  "KnowledgePageTypeUnsupported",
] as const;
export type FailureKind = typeof FAILURE_KINDS[number];
export type Failure = { readonly kind: FailureKind; readonly field?: string };
export type Purpose = "page" | "robots" | "image" | "resource";
export type RequestCommand = {
  readonly url: string;
  readonly rootUrl: string;
  readonly purpose: Purpose;
  readonly maximumBytes: number;
  readonly redirectLimit: number;
};
export type Observation = {
  readonly peerAddress: string;
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly bytes: Uint8Array;
  readonly finalUrl: string;
  readonly redirectHops: readonly string[];
};
export type WireObservation = Omit<Observation, "bytes"> & {
  readonly bodyBase64: string;
};
export type WebpageEvidence = {
  readonly url: string;
  readonly headings: readonly {readonly id:string; readonly sectionId:string; readonly locator:string; readonly text:string; readonly level:number}[];
  readonly blocks: readonly {readonly id:string; readonly sectionId:string; readonly locator:string; readonly kind:'text'|'caption'; readonly text:string; readonly inlineLinks?:readonly import('../src/features/knowledge-workflows/inline-links.js').InlineLink[]; readonly figureId:string|null}[];
  readonly images: readonly {readonly id:string; readonly url:string; readonly occurrences: readonly {readonly id:string; readonly locator:string; readonly sectionId:string; readonly figureId:string|null; readonly captionId:string|null; readonly alt:string}[]; readonly occurrenceWindows:readonly (readonly string[])[]}[];
  readonly warnings:readonly string[];
};
export type PageProjection = {
  readonly evidence?: WebpageEvidence;
  readonly renderedTitle: string;
  readonly renderedText: string;
  readonly visibleLinks: readonly string[];
  readonly html: string;
};
export type Policy = {
  readonly htmlBytes: number;
  readonly robotsBytes: number;
  readonly screenshotBytes: number;
  readonly imageBytes: number;
  readonly attachmentCount: number;
  readonly attachmentBytes: number;
  readonly pageRedirects: number;
  readonly mediaRedirects: number;
  readonly encodedResourceBytes: number;
  readonly encodedOperationBytes: number;
  readonly decodedOperationBytes: number;
  readonly resources: number;
  readonly operationMilliseconds: number;
  readonly requestMilliseconds: number;
  readonly pixels: number;
  readonly frames: number;
  readonly aggregatePixels: number;
  readonly renderedTextCharacters: number;
  readonly links: number;
  readonly urlCharacters: number;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
};
export type Budget = {
  encoded: number;
  decoded: number;
  resources: number;
  pixels: number;
};
export type LogEntry = {
  readonly event:
    | "acquisition-entry"
    | "acquisition-success"
    | "acquisition-failure";
  readonly failureKind?: FailureKind;
  readonly resources?: number;
};
export type Logger = (entry: LogEntry) => void;
export type Resolver = (
  hostname: string,
  signal: AbortSignal,
) => Promise<readonly string[]>;

export type Renderer = {
  render(
    command: RequestCommand,
    observation: Observation,
    budget: Budget,
    signal: AbortSignal,
    screenshot: boolean,
  ): Promise<
    Result<
      { readonly projection: PageProjection; readonly screenshot?: Uint8Array }
    >
  >;
  decodeImage(
    bytes: Uint8Array,
    mediaType: string,
    signal: AbortSignal,
  ): Promise<Result<null>>;
};
export const fail = (
  kind: FailureKind,
  field?: string,
): { readonly ok: false; readonly error: Failure } => ({
  ok: false,
  error: { kind, ...(field === undefined ? {} : { field }) },
});

export function validatePolicy(policy: Policy): void {
  if (
    !policy || typeof policy !== "object" || Array.isArray(policy) ||
    ([
      "htmlBytes",
      "robotsBytes",
      "screenshotBytes",
      "imageBytes",
      "attachmentCount",
      "attachmentBytes",
      "pageRedirects",
      "mediaRedirects",
      "encodedResourceBytes",
      "encodedOperationBytes",
      "decodedOperationBytes",
      "resources",
      "operationMilliseconds",
      "requestMilliseconds",
      "pixels",
      "frames",
      "aggregatePixels",
      "renderedTextCharacters",
      "links",
      "urlCharacters",
      "viewportWidth",
      "viewportHeight",
    ] as const).some((key) =>
      !Object.hasOwn(policy, key) || !Number.isSafeInteger(policy[key]) ||
      policy[key] <= 0
    ) || policy.htmlBytes > 1_000_000 || policy.robotsBytes > 262_144 ||
    policy.imageBytes > 20 * 1024 * 1024 ||
    policy.screenshotBytes > 2_000_000 || policy.pageRedirects > 3 ||
    policy.mediaRedirects > 4 ||
    policy.viewportWidth * policy.viewportHeight > policy.pixels
  ) throw new TypeError("ConfigurationInvalid");
}
