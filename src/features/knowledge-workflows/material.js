// @ts-check

import { getResolvedPDFJS } from "unpdf";
import { BUNDLE_TYPE, imageSignature, parseImageBundle } from "./image-upload.js";
import { URL_CAPTURE_TYPE, parseUrlCapture } from "./url-capture.js";
import { extractPdfEmbeddedImages } from "./pdf-embedded-images.js";

/** @template T, E @typedef {{ readonly ok: true, readonly value: T } | { readonly ok: false, readonly error: E }} Result */

/** @typedef {{ readonly ownsOrPermitted: true, readonly storageAllowed: true, readonly transformationAllowed: true, readonly processingAllowed: true, readonly basis: string, readonly reference: string }} MaterialRightsAttestation */
/** @typedef {{ readonly path: string, readonly mediaType: string, readonly bytes: Uint8Array, readonly url?: string, readonly caption?: string, readonly alt?: string, readonly context?: string }} MaterialMedia */
/** @typedef {{ readonly id: string, readonly title: string, readonly text: string, readonly locator: string }} MaterialSection */
/** @typedef {{ readonly ownerId: string, readonly runId: string, readonly sourceId: string, readonly sourceRevision: number, readonly sourceUrl: string, readonly mediaType: string, readonly fileName: string, readonly mode: "text" | "image", readonly contentDigest: string, readonly sections: readonly MaterialSection[], readonly media: readonly MaterialMedia[], readonly provenance: { readonly kind: "authorized-user-material", readonly attestationReference: string, readonly basis: string, readonly processingAllowed?: true } }} AuthorizedMaterial */

/** @typedef {{ readonly kind: "MaterialCommandInvalid", readonly field: string } | { readonly kind: "MaterialRightsAttestationMissing" } | { readonly kind: "MaterialContentTypeUnsupported", readonly mediaType: string } | { readonly kind: "MaterialImageModeUnsupported", readonly mediaType: string } | { readonly kind: "MaterialImageInvalid" | "MaterialImageBundleInvalid" | "MaterialUrlCaptureInvalid" } | { readonly kind: "MaterialByteLimitExceeded", readonly maximum: number } | { readonly kind: "MaterialTextLimitExceeded", readonly maximum: number } | { readonly kind: "MaterialEncodingInvalid" } | { readonly kind: "MaterialDigestUnavailable" } | { readonly kind: "MaterialPdfInvalid" } | { readonly kind: "MaterialPdfEncrypted" } | { readonly kind: "MaterialPdfCleanupFailed" } | { readonly kind: "MaterialPdfPageLimitExceeded", readonly maximum: number } | { readonly kind: "MaterialPdfTextExtractionUnavailable" } | { readonly kind: "MaterialPdfSelectionMissing" | "MaterialPdfSelectionAmbiguous" } | { readonly kind: "MaterialPdfSelectionInvalid" | "MaterialPdfSelectionConflict", readonly field: string } | { readonly kind: "MaterialPptxInvalid" } | { readonly kind: "MaterialPptxTextExtractionUnavailable" } | { readonly kind: "MaterialPptxCompressionUnsupported" } | { readonly kind: "MaterialArchiveTooLarge" }} MaterialFailure */

/** @typedef {{ readonly sourceDigest: string, readonly physicalPage: number, readonly textCodepointRange: readonly [number, number], readonly excerptDigest: string }} PdfTextSelection */

/** @typedef {{ readonly digest: (bytes: Uint8Array) => Promise<string>, readonly maximumBytes: number, readonly maximumCharacters: number }} MaterialDependencies */

const freeze = Object.freeze;
const textTypes = new Set(["text/plain", "text/markdown", "text/x-markdown"]);
const imageTypes = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const pdfType = "application/pdf";
const pptxType = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const MAXIMUM_PDF_PAGES = 100;
const MAXIMUM_PDF_IMAGE_PIXELS = 16_777_216;
const MAXIMUM_IMAGE_BYTES = 20 * 1024 * 1024;

/** Read original uploaded images for the shared caption/association workflow; never fetch document links.
 * @param {AuthorizedMaterial} material @param {Uint8Array} bytes
 * @returns {Promise<Result<readonly import('./url-capture.js').CapturedImage[], {kind:string}>>} */
export async function extractMaterialImages(material, bytes) {
  // A selected text excerpt never authorizes images elsewhere on its page or in the document.
  if (material.sections.some(section => section.locator.startsWith("pdf:page="))) return {ok:true,value:[]};
  if (material.mediaType === URL_CAPTURE_TYPE) {
    const capture = parseUrlCapture(bytes);
    if (!capture.ok) return capture;
    return capture.value.sourceUrl === material.sourceUrl ? {ok:true,value:capture.value.images} : {ok:false,error:{kind:"WorkflowMaterialInvalid"}};
  }
  /** @type {readonly MaterialMedia[]} */ let media = [];
  if (material.mediaType === pdfType) {
    const extracted = await extractPdfEmbeddedImages(bytes);
    if (!extracted.ok) return extracted;
    media = extracted.value;
  } else if (material.mediaType === pptxType) {
    const archive = await readZip(bytes, 200 * 1024 * 1024);
    if (!archive.ok) return archive;
    media = [...archive.value].flatMap(([path, bytes]) => {
      const mediaType = mediaTypeForPath(path);
      return path.startsWith("ppt/media/") && mediaType !== null && imageTypes.has(mediaType) ? [{path,bytes,mediaType,context:"Embedded PowerPoint image."}] : [];
    });
  }
  const images = [];
  let totalBytes = 0;
  for (const image of media) {
    totalBytes += image.bytes.length;
    if (image.bytes.length > MAXIMUM_IMAGE_BYTES || totalBytes > 100 * 1024 * 1024) return {ok:false,error:{kind:"MaterialByteLimitExceeded"}};
    if (imageSignature(image.bytes) !== image.mediaType) return {ok:false,error:{kind:"MaterialImageInvalid"}};
    const url = new URL(material.sourceUrl); url.hash = image.path;
    images.push({...image,url:url.href,caption:image.caption ?? "",alt:image.alt ?? "",context:image.context ?? ""});
  }
  return {ok:true,value:images};
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function record(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }
/** @param {unknown} value @returns {value is string} */
function text(value) { return typeof value === "string" && value.trim() !== ""; }
/** @param {unknown} value @returns {value is number} */
function positiveInteger(value) { return typeof value === "number" && Number.isSafeInteger(value) && value > 0; }
/** @param {unknown} value @returns {boolean} */
function timestamp(value) { return text(value) && Number.isFinite(Date.parse(value)); }
/** @param {unknown} value @returns {boolean} */
function secureUrl(value) { return text(value) && URL.canParse(value) && new URL(value).protocol === "https:"; }

/** @param {unknown} selection @param {string} sourceDigest @returns {Result<PdfTextSelection, MaterialFailure>} */
export function validatePdfTextSelection(selection, sourceDigest) {
  if (!text(sourceDigest)) throw new TypeError("PDF selection source digest is invalid.");
  if (selection === undefined || selection === null) return { ok: false, error: { kind: "MaterialPdfSelectionMissing" } };
  if (Array.isArray(selection)) return { ok: false, error: { kind: "MaterialPdfSelectionAmbiguous" } };
  if (!record(selection) || Object.keys(selection).sort().join(",") !== "excerptDigest,physicalPage,sourceDigest,textCodepointRange" ||
    typeof selection.sourceDigest !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(selection.sourceDigest) ||
    typeof selection.excerptDigest !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(selection.excerptDigest) || !positiveInteger(selection.physicalPage) ||
    !Array.isArray(selection.textCodepointRange) || selection.textCodepointRange.length !== 2 ||
    !Number.isSafeInteger(selection.textCodepointRange[0]) || selection.textCodepointRange[0] < 0 ||
    !Number.isSafeInteger(selection.textCodepointRange[1]) || selection.textCodepointRange[1] <= selection.textCodepointRange[0])
    return { ok: false, error: { kind: "MaterialPdfSelectionInvalid", field: "physicalPage/textCodepointRange/digests" } };
  if (selection.sourceDigest !== sourceDigest) return { ok: false, error: { kind: "MaterialPdfSelectionConflict", field: "sourceDigest" } };
  return { ok: true, value: freeze({ sourceDigest: selection.sourceDigest, physicalPage: selection.physicalPage,
    textCodepointRange: freeze(/** @type {[number, number]} */ ([selection.textCodepointRange[0], selection.textCodepointRange[1]])), excerptDigest: selection.excerptDigest }) };
}

/** @param {unknown} input @returns {Result<{ readonly ownerId: string, readonly runId: string, readonly sourceId: string, readonly sourceRevision: number, readonly sourceUrl: string, readonly mediaType: string, readonly fileName: string, readonly mode: "text" | "image", readonly bytes: Uint8Array, readonly rightsAttestation: MaterialRightsAttestation, readonly idempotencyKey: string, readonly pdfTextSelection?: PdfTextSelection }, MaterialFailure>} */
function validateCommand(input) {
  if (!record(input)) return invalid("command");
  const candidate = /** @type {Record<string, unknown>} */ (input);
  for (const field of ["ownerId", "runId", "sourceId", "sourceUrl", "mediaType", "fileName", "idempotencyKey"]) if (!text(candidate[field])) return invalid(field);
  if (!positiveInteger(candidate.sourceRevision)) return invalid("sourceRevision");
  if (!secureUrl(candidate.sourceUrl)) return invalid("sourceUrl");
  if (!(candidate.bytes instanceof Uint8Array)) return invalid("bytes");
  const attestation = {basis:"user-owned upload authorization",reference:`user-upload:${candidate.idempotencyKey}`};
  const ownerId = /** @type {string} */ (candidate.ownerId);
  const runId = /** @type {string} */ (candidate.runId);
  const sourceId = /** @type {string} */ (candidate.sourceId);
  const sourceUrl = /** @type {string} */ (candidate.sourceUrl);
  const mediaType = /** @type {string} */ (candidate.mediaType);
  const fileName = /** @type {string} */ (candidate.fileName);
  const idempotencyKey = /** @type {string} */ (candidate.idempotencyKey);
  if (candidate.mode !== undefined && candidate.mode !== "text" && candidate.mode !== "image") return invalid("mode");
  const mode = imageTypes.has(mediaType.trim().toLowerCase()) || mediaType.trim().toLowerCase() === BUNDLE_TYPE ? "image" : candidate.mode === "image" ? "image" : "text";
  const sourceRevision = /** @type {number} */ (candidate.sourceRevision);
  const bytes = /** @type {Uint8Array} */ (candidate.bytes);
  return { ok: true, value: freeze({ ownerId: ownerId.trim(), runId: runId.trim(), sourceId: sourceId.trim(), sourceRevision, sourceUrl: new URL(sourceUrl).href, mediaType: mediaType.trim().toLowerCase(), fileName: fileName.trim(), mode, bytes, rightsAttestation: freeze({ ownsOrPermitted: true, storageAllowed: true, transformationAllowed: true, processingAllowed: true, basis: attestation.basis.trim(), reference: attestation.reference.trim() }), idempotencyKey: idempotencyKey.trim() }) };
}

/** @param {unknown} command @param {MaterialDependencies} dependencies @returns {Promise<Result<AuthorizedMaterial, MaterialFailure>>} */
export async function parseAuthorizedMaterial(command, dependencies) {
  const parsed = validateCommand(command);
  if (!parsed.ok) return parsed;
  if (typeof dependencies?.digest !== "function" || !positiveInteger(dependencies.maximumBytes) || !positiveInteger(dependencies.maximumCharacters)) throw new TypeError("Material parser dependencies are invalid.");
  const value = parsed.value;
  if (value.bytes.byteLength > dependencies.maximumBytes) return { ok: false, error: { kind: "MaterialByteLimitExceeded", maximum: dependencies.maximumBytes } };
  if (value.mode === "image" && value.mediaType !== BUNDLE_TYPE && value.bytes.byteLength > MAXIMUM_IMAGE_BYTES) return { ok: false, error: { kind: "MaterialByteLimitExceeded", maximum: MAXIMUM_IMAGE_BYTES } };
  if (!textTypes.has(value.mediaType) && value.mediaType !== pdfType && value.mediaType !== pptxType && value.mediaType !== BUNDLE_TYPE && value.mediaType !== URL_CAPTURE_TYPE && !imageTypes.has(value.mediaType)) return { ok: false, error: { kind: "MaterialContentTypeUnsupported", mediaType: value.mediaType } };
  if (value.mode === "image" && value.mediaType !== BUNDLE_TYPE && !imageTypes.has(value.mediaType)) return { ok: false, error: { kind: "MaterialImageModeUnsupported", mediaType: value.mediaType } };
  if (value.mode === "text" && value.mediaType === BUNDLE_TYPE) return { ok: false, error: { kind: "MaterialImageModeUnsupported", mediaType: value.mediaType } };
  if (Object.hasOwn(/** @type {object} */ (command), "pdfTextSelection") && value.mediaType !== pdfType) return invalid("pdfTextSelection/mediaType");
  let digest;
  try { digest = await dependencies.digest(value.bytes); } catch (error) { return { ok: false, error: { kind: "MaterialDigestUnavailable" } }; }
  if (!text(digest)) return { ok: false, error: { kind: "MaterialDigestUnavailable" } };
  if (value.mediaType === URL_CAPTURE_TYPE) {
    if (value.mode !== "text") return invalid("mode");
    const captured = parseUrlCapture(value.bytes);
    if (!captured.ok) return captured;
    if (captured.value.sourceUrl !== value.sourceUrl) return invalid("sourceUrl");
    const parsedPdf = await parsePdf({ ...value, bytes: captured.value.pdf }, digest, dependencies);
    return parsedPdf.ok ? { ok: true, value: freeze({ ...parsedPdf.value, media: freeze(captured.value.images) }) } : parsedPdf;
  }
  if (value.mode === "image") return value.mediaType === BUNDLE_TYPE ? parseBundledImages(value, digest) : parseImage(value, digest);
  if (textTypes.has(value.mediaType)) return parseText(value, digest, dependencies.maximumCharacters);
  if (value.mediaType === pdfType) {
    const selected = Object.hasOwn(/** @type {object} */ (command), "pdfTextSelection") ? validatePdfTextSelection(/** @type {Record<string, unknown>} */ (command).pdfTextSelection, digest) : null;
    if (selected !== null && !selected.ok) return selected;
    return await parsePdf({ ...value, ...(selected?.ok ? { pdfTextSelection: selected.value } : {}) }, digest, dependencies);
  }
  return await parsePptx(value, digest, dependencies.maximumCharacters, dependencies.maximumBytes);
}

/** @param {ReturnType<typeof validateCommand> extends infer T ? T extends { readonly ok: true, readonly value: infer V } ? V : never : never} value @param {string} digest @param {number} maximumCharacters @returns {Result<AuthorizedMaterial, MaterialFailure>} */
function parseText(value, digest, maximumCharacters) {
  const decoded = decodeUtf8(value.bytes);
  if (decoded === null) return { ok: false, error: { kind: "MaterialEncodingInvalid" } };
  const normalized = normalizeText(decoded);
  if (normalized.length === 0) return { ok: false, error: { kind: "MaterialTextLimitExceeded", maximum: maximumCharacters } };
  if (normalized.length > maximumCharacters) return { ok: false, error: { kind: "MaterialTextLimitExceeded", maximum: maximumCharacters } };
  return { ok: true, value: material(value, digest, sectionsFromText(normalized, "text"), [], "text") };
}

/** @param {ReturnType<typeof validateCommand> extends infer T ? T extends { readonly ok: true, readonly value: infer V } ? V : never : never} value @param {string} digest @returns {Result<AuthorizedMaterial, MaterialFailure>} */
function parseImage(value, digest) {
  if (value.bytes.byteLength === 0 || imageSignature(value.bytes) !== value.mediaType) return { ok: false, error: { kind: "MaterialImageInvalid" } };
  return { ok: true, value: material(value, digest, [freeze({ id: "image-1", title: value.fileName, text: "", locator: "image:1" })], [], "image") };
}

/** @param {ReturnType<typeof validateCommand> extends infer T ? T extends { readonly ok: true, readonly value: infer V } ? V : never : never} value @param {string} digest @returns {Result<AuthorizedMaterial, MaterialFailure>} */
function parseBundledImages(value, digest) {
  const parsed = parseImageBundle(value.bytes);
  if (!parsed.ok) return { ok: false, error: { kind: "MaterialImageBundleInvalid" } };
  const sections = parsed.value.map((page) => freeze({ id: page.locator.replace(":", "-"), title: page.name, text: "", locator: page.locator }));
  const media = parsed.value.map((page) => freeze({ path: page.locator, mediaType: page.mediaType, bytes: page.bytes }));
  return { ok: true, value: material(value, digest, sections, media, "image-bundle") };
}

/** @param {ReturnType<typeof validateCommand> extends infer T ? T extends { readonly ok: true, readonly value: infer V } ? V : never : never} value @param {string} digest @param {MaterialDependencies} dependencies @returns {Promise<Result<AuthorizedMaterial, MaterialFailure>>} */
async function parsePdf(value, digest, dependencies) {
  /** @type {ReturnType<Awaited<ReturnType<typeof getResolvedPDFJS>>["getDocument"]> | null} */
  let loadingTask = null;
  const { maximumCharacters } = dependencies;
  const selection = value.pdfTextSelection;
  /** @type {Result<AuthorizedMaterial, MaterialFailure> | null} */
  let result = null;
  try {
    const pdfjs = await getResolvedPDFJS();
    const options = {
      data: value.bytes.slice(),
      cMapUrl: undefined,
      standardFontDataUrl: undefined,
      useWorkerFetch: false,
      useSystemFonts: false,
      disableFontFace: true,
      isEvalSupported: false,
      maxImageSize: MAXIMUM_PDF_IMAGE_PIXELS,
      stopAtErrors: true,
      verbosity: 0,
    };
    loadingTask = pdfjs.getDocument(options);
    const document = await loadingTask.promise;
    if (!positiveInteger(document.numPages)) result = { ok: false, error: { kind: "MaterialPdfInvalid" } };
    else if (selection !== undefined && selection.physicalPage > document.numPages) result = { ok: false, error: { kind: "MaterialPdfSelectionInvalid", field: "physicalPage" } };
    else if (selection === undefined && document.numPages > MAXIMUM_PDF_PAGES) result = { ok: false, error: { kind: "MaterialPdfPageLimitExceeded", maximum: MAXIMUM_PDF_PAGES } };
    else {
      const sections = [];
      let totalCharacters = 0;
      for (let pageNumber = selection?.physicalPage ?? 1; pageNumber <= (selection?.physicalPage ?? document.numPages); pageNumber += 1) {
        const page = await document.getPage(pageNumber);
        const textContent = await page.getTextContent();
        const strings = [];
        for (const item of textContent.items) if (textItem(item)) strings.push(item.str + (item.hasEOL ? "\n" : ""));
        let content = selection === undefined ? normalizeText(strings.join("")) : strings.join("").trim();
        if (selection !== undefined) {
          const codepoints = Array.from(content), [start, end] = selection.textCodepointRange;
          if (end > codepoints.length) { result = { ok: false, error: { kind: "MaterialPdfSelectionInvalid", field: "textCodepointRange" } }; break; }
          content = codepoints.slice(start, end).join("");
          let excerptDigest;
          try { excerptDigest = await dependencies.digest(new TextEncoder().encode(content)); }
          catch (error) { if (!(error instanceof Error)) throw error; result = { ok: false, error: { kind: "MaterialDigestUnavailable" } }; break; }
          if (!text(excerptDigest)) { result = { ok: false, error: { kind: "MaterialDigestUnavailable" } }; break; }
          if (excerptDigest !== selection.excerptDigest) { result = { ok: false, error: { kind: "MaterialPdfSelectionConflict", field: "excerptDigest" } }; break; }
        }
        totalCharacters += content.length;
        if (totalCharacters > maximumCharacters) { result = { ok: false, error: { kind: "MaterialTextLimitExceeded", maximum: maximumCharacters } }; break; }
        sections.push(freeze({ id: `page-${pageNumber}`, title: `Page ${pageNumber}`, text: content, locator: selection === undefined ? `page:${pageNumber}` : `pdf:page=${pageNumber};text-codepoints=${selection.textCodepointRange[0]}:${selection.textCodepointRange[1]}` }));
      }
      if (result === null) result = totalCharacters === 0 ? { ok: false, error: { kind: "MaterialPdfTextExtractionUnavailable" } } : { ok: true, value: material(value, digest, sections, [], "pdf") };
    }
  } catch (error) {
    result = error instanceof Error && error.name === "PasswordException" ? { ok: false, error: { kind: "MaterialPdfEncrypted" } } : { ok: false, error: { kind: "MaterialPdfInvalid" } };
  }
  if (result === null) result = { ok: false, error: { kind: "MaterialPdfInvalid" } };
  if (loadingTask === null) return result;
  try { await loadingTask.destroy(); } catch (error) { if (!result.ok) return result; return { ok: false, error: { kind: "MaterialPdfCleanupFailed" } }; }
  return result;
}

/** @param {unknown} item @returns {item is { readonly str: string, readonly hasEOL: boolean }} */
function textItem(item) { return record(item) && typeof item.str === "string" && typeof item.hasEOL === "boolean"; }

/** @param {ReturnType<typeof validateCommand> extends infer T ? T extends { readonly ok: true, readonly value: infer V } ? V : never : never} value @param {string} digest @param {number} maximumCharacters @param {number} maximumBytes @returns {Promise<Result<AuthorizedMaterial, MaterialFailure>>} */
async function parsePptx(value, digest, maximumCharacters, maximumBytes) {
  const entries = await readZip(value.bytes, maximumBytes * 2);
  if (!entries.ok) return entries;
  const slides = [...entries.value.entries()].filter(([path]) => /^ppt\/slides\/slide\d+\.xml$/u.test(path)).sort(([left], [right]) => slideNumber(left) - slideNumber(right));
  if (slides.length === 0) return { ok: false, error: { kind: "MaterialPptxInvalid" } };
  const sections = [];
  for (const [path, bytes] of slides) {
    const xml = decodeUtf8(bytes);
    if (xml === null) return { ok: false, error: { kind: "MaterialPptxInvalid" } };
    const runs = [...xml.matchAll(/<(?:[A-Za-z0-9_]+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:[A-Za-z0-9_]+:)?t>/gu)].map((match) => decodeXml(match[1] ?? ""));
    const content = normalizeText(runs.join(""));
    sections.push(freeze({ id: `slide-${slideNumber(path)}`, title: `Slide ${slideNumber(path)}`, text: content, locator: `slide:${slideNumber(path)}` }));
  }
  const totalCharacters = sections.reduce((total, section) => total + section.text.length, 0);
  if (totalCharacters === 0) return { ok: false, error: { kind: "MaterialPptxTextExtractionUnavailable" } };
  if (totalCharacters > maximumCharacters) return { ok: false, error: { kind: "MaterialTextLimitExceeded", maximum: maximumCharacters } };
  const media = [];
  for (const [path, bytes] of entries.value) {
    const mediaType = mediaTypeForPath(path);
    if (mediaType !== null) media.push(freeze({ path, mediaType, bytes }));
  }
  return { ok: true, value: material(value, digest, sections, media, "pptx") };
}

/** @param {ReturnType<typeof validateCommand> extends infer T ? T extends { readonly ok: true, readonly value: infer V } ? V : never : never} value @param {string} digest @param {readonly MaterialSection[]} sections @param {readonly MaterialMedia[]} media @param {string} kind @returns {AuthorizedMaterial} */
function material(value, digest, sections, media, kind) {
  return freeze({ ownerId: value.ownerId, runId: value.runId, sourceId: value.sourceId, sourceRevision: value.sourceRevision, sourceUrl: value.sourceUrl, mediaType: value.mediaType, fileName: value.fileName, mode: value.mode, contentDigest: digest, sections: freeze([...sections]), media: freeze([...media]), provenance: freeze({ kind: "authorized-user-material", attestationReference: value.rightsAttestation.reference, basis: `${kind}:${value.rightsAttestation.basis}`, processingAllowed: true }) });
}

/** @param {string} value @param {string} prefix @returns {readonly MaterialSection[]} */
function sectionsFromText(value, prefix) {
  const lines = value.split("\n");
  /** @type {{ title: string, body: string[] }[]} */ const groups = [];
  /** @type {{ title: string, body: string[] }} */ let current = { title: "", body: [] };
  for (const line of lines) {
    const heading = /^(#{1,6})\s+(.+)$/u.exec(line.trim());
    if (heading !== null && current.body.join("\n").trim() !== "") {
      groups.push(current);
      current = { title: heading[2].trim(), body: [] };
    } else if (heading !== null) {
      current.title = heading[2].trim();
    } else current.body.push(line);
  }
  if (current.body.join("\n").trim() !== "" || groups.length === 0) groups.push(current);
  return freeze(groups.map((group, index) => freeze({ id: `${prefix}-${index + 1}`, title: group.title || `Section ${index + 1}`, text: normalizeText(group.body.join("\n")), locator: `${prefix}:${index + 1}` })));
}

/** @param {Uint8Array} value @returns {string | null} */
function decodeUtf8(value) { try { return new TextDecoder("utf-8", { fatal: true }).decode(value); } catch (error) { return null; } }
/** @param {string} value @returns {string} */
function normalizeText(value) { return value.normalize("NFKC").replace(/\r\n?/gu, "\n").replace(/[\u0000\u000b\u000c]/gu, " ").replace(/[ \t]+/gu, " ").replace(/\n{3,}/gu, "\n\n").trim(); }


/** @param {string} value @returns {string} */
function decodeXml(value) { return value.replace(/&amp;/gu, "&").replace(/&lt;/gu, "<").replace(/&gt;/gu, ">").replace(/&quot;/gu, '"').replace(/&apos;/gu, "'").replace(/&#(\d+);/gu, (_, code) => String.fromCodePoint(Number(code))).replace(/&#x([\da-f]+);/giu, (_, code) => String.fromCodePoint(Number.parseInt(code, 16))); }
/** @param {string} path @returns {number} */
function slideNumber(path) { return Number(/slide(\d+)\.xml$/u.exec(path)?.[1] ?? "0"); }

/** @param {Uint8Array} bytes @param {number} maximumInflated @returns {Promise<Result<Map<string, Uint8Array>, MaterialFailure>>} */
async function readZip(bytes, maximumInflated) {
  const endOffset = findSignature(bytes, 0x06054b50, Math.max(0, bytes.length - 65_557));
  if (endOffset < 0) return { ok: false, error: { kind: "MaterialPptxInvalid" } };
  const end = new DataView(bytes.buffer, bytes.byteOffset + endOffset, 22);
  const count = end.getUint16(10, true);
  const centralSize = end.getUint32(12, true);
  const centralOffset = end.getUint32(16, true);
  if (count > 1_000 || centralOffset + centralSize > bytes.byteLength) return { ok: false, error: { kind: "MaterialPptxInvalid" } };
  const result = new Map();
  let cursor = centralOffset;
  let inflated = 0;
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > bytes.byteLength || new DataView(bytes.buffer, bytes.byteOffset + cursor, 4).getUint32(0, true) !== 0x02014b50) return { ok: false, error: { kind: "MaterialPptxInvalid" } };
    const header = new DataView(bytes.buffer, bytes.byteOffset + cursor, 46);
    const flags = header.getUint16(8, true);
    const method = header.getUint16(10, true);
    const compressedSize = header.getUint32(20, true);
    const uncompressedSize = header.getUint32(24, true);
    const nameLength = header.getUint16(28, true);
    const extraLength = header.getUint16(30, true);
    const commentLength = header.getUint16(32, true);
    const localOffset = header.getUint32(42, true);
    const name = decodeUtf8(bytes.slice(cursor + 46, cursor + 46 + nameLength));
    if (name === null || localOffset + 30 > bytes.byteLength || compressedSize > bytes.byteLength || uncompressedSize > maximumInflated || inflated + uncompressedSize > maximumInflated) return { ok: false, error: { kind: "MaterialArchiveTooLarge" } };
    if ((flags & 1) !== 0 || (flags & 0x8) !== 0 && compressedSize === 0) return { ok: false, error: { kind: "MaterialPptxInvalid" } };
    const local = new DataView(bytes.buffer, bytes.byteOffset + localOffset, 30);
    if (local.getUint32(0, true) !== 0x04034b50) return { ok: false, error: { kind: "MaterialPptxInvalid" } };
    const localNameLength = local.getUint16(26, true);
    const localExtraLength = local.getUint16(28, true);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    if (start + compressedSize > bytes.byteLength) return { ok: false, error: { kind: "MaterialPptxInvalid" } };
    const compressed = bytes.slice(start, start + compressedSize);
    let data;
    if (method === 0) data = compressed;
    else if (method === 8) {
      if (typeof DecompressionStream !== "function") return { ok: false, error: { kind: "MaterialPptxCompressionUnsupported" } };
      const reader = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
      // Enforce the declared size while inflating; a ZIP header is untrusted.
      data = new Uint8Array(uncompressedSize);
      let size = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          if (size + chunk.value.byteLength > uncompressedSize) {
            await reader.cancel();
            return { ok: false, error: { kind: "MaterialArchiveTooLarge" } };
          }
          data.set(chunk.value, size);
          size += chunk.value.byteLength;
        }
        if (size !== uncompressedSize) return { ok: false, error: { kind: "MaterialPptxInvalid" } };
      } catch (error) { return { ok: false, error: { kind: "MaterialPptxInvalid" } }; }
      finally { reader.releaseLock(); }
    } else return { ok: false, error: { kind: "MaterialPptxCompressionUnsupported" } };
    if (data.byteLength !== uncompressedSize || inflated + data.byteLength > maximumInflated) return { ok: false, error: { kind: "MaterialArchiveTooLarge" } };
    result.set(name, data);
    inflated += data.byteLength;
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return { ok: true, value: result };
}

/** @param {Uint8Array} bytes @param {number} signature @param {number} start @returns {number} */
function findSignature(bytes, signature, start) { for (let index = bytes.length - 22; index >= start; index -= 1) if (new DataView(bytes.buffer, bytes.byteOffset + index, 4).getUint32(0, true) === signature) return index; return -1; }
/** @param {string} path @returns {string | null} */
function mediaTypeForPath(path) { const extension = path.toLowerCase().split(".").at(-1); return extension === "png" ? "image/png" : extension === "jpg" || extension === "jpeg" ? "image/jpeg" : extension === "gif" ? "image/gif" : extension === "webp" ? "image/webp" : extension === "mp3" ? "audio/mpeg" : extension === "mp4" ? "video/mp4" : null; }
/** @param {Uint8Array} bytes @returns {string | null} */
/** @param {string} field @returns {Result<never, MaterialFailure>} */
function invalid(field) { return { ok: false, error: { kind: "MaterialCommandInvalid", field } }; }

export {};
