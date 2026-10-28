// @ts-check
import { getResolvedPDFJS } from "unpdf";

/** @param {string} type @param {Uint8Array} data */
function pngChunk(type, data) {
  const chunk = new Uint8Array(data.length + 12);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk.set(new TextEncoder().encode(type), 4);
  chunk.set(data, 8);
  let crc = 0xffffffff;
  for (const byte of chunk.subarray(4, -4)) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  view.setUint32(chunk.length - 4, (crc ^ 0xffffffff) >>> 0);
  return chunk;
}
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

/** @typedef {{width:number,height:number,kind:number,data:Uint8Array|Uint8ClampedArray}} PdfImage */
/** Encode decoded PDF pixels without a native canvas or a new image dependency.
 * @param {PdfImage} image */
async function png(image) {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, image.width); view.setUint32(4, image.height);
  const channels = image.kind === 1 ? 1 : image.kind === 2 ? 3 : image.kind === 3 ? 4 : 0;
  if (!channels) throw new TypeError("PdfImageKindUnsupported");
  header[8] = image.kind === 1 ? 1 : 8; header[9] = channels === 1 ? 0 : channels === 3 ? 2 : 6;
  let row = 0;
  const stride = image.kind === 1 ? Math.ceil(image.width / 8) : image.width * channels;
  if (image.data.length !== stride * image.height) throw new TypeError("PdfImagePixelsInvalid");
  const rows = new ReadableStream({ pull(controller) {
    if (row === image.height) { controller.close(); return; }
    const bytes = new Uint8Array(stride + 1);
    bytes.set(image.data.subarray(row * stride, ++row * stride), 1);
    controller.enqueue(bytes);
  } });
  const compressed = new Uint8Array(await new Response(rows.pipeThrough(new CompressionStream("deflate"))).arrayBuffer());
  return new Uint8Array(await new Blob([new Uint8Array([137,80,78,71,13,10,26,10]), pngChunk("IHDR", header), pngChunk("IDAT", compressed), pngChunk("IEND", new Uint8Array())]).arrayBuffer());
}

/** Extract embedded raster objects, preserving page provenance rather than rendering pages.
 * @param {Uint8Array} bytes @returns {Promise<{ok:true,value:import('./material.js').MaterialMedia[]}|{ok:false,error:{kind:string}}>} */
export async function extractPdfEmbeddedImages(bytes) {
  let task;
  /** @type {Awaited<ReturnType<typeof extractPdfEmbeddedImages>>} */ let result;
  try {
    const pdfjs = await getResolvedPDFJS();
    const options = { data: bytes.slice(), useWorkerFetch:false, useSystemFonts:false, disableFontFace:true, isEvalSupported:false, isOffscreenCanvasSupported:false, isImageDecoderSupported:false, maxImageSize:16_777_216, stopAtErrors:true, verbosity:0 };
    task = pdfjs.getDocument(options);
    const pdf = await task.promise;
    if (pdf.numPages > 100) return {ok:false,error:{kind:"MaterialPdfPageLimitExceeded"}};
    /** @type {import('./material.js').MaterialMedia[]} */ const images = [];
    const seen = new Set();
    let totalBytes = 0;
    for (let page = 1; page <= pdf.numPages; page++) {
      const sourcePage = await pdf.getPage(page);
      const operators = await sourcePage.getOperatorList();
      for (const [index, operator] of operators.fnArray.entries()) {
        const args = operators.argsArray[index];
        /** @type {PdfImage} */ let image;
        if (operator === pdfjs.OPS.paintImageXObject || operator === pdfjs.OPS.paintImageXObjectRepeat) {
          const key = args[0];
          if (seen.has(key)) continue;
          seen.add(key);
          image = await new Promise(resolve => (key.startsWith("g_") ? sourcePage.commonObjs : sourcePage.objs).get(key, resolve));
        } else if (operator === pdfjs.OPS.paintInlineImageXObject) image = args[0];
        else continue;
        if (!image || !Number.isSafeInteger(image.width) || !Number.isSafeInteger(image.height) || image.width < 1 || image.height < 1 || !(image.data instanceof Uint8Array || image.data instanceof Uint8ClampedArray)) return {ok:false,error:{kind:"MaterialImageInvalid"}};
        if (image.width * image.height > 16_777_216) return {ok:false,error:{kind:"MaterialImageInvalid"}};
        const bytes = await png(image);
        totalBytes += bytes.length;
        if (bytes.length > 20 * 1024 * 1024 || totalBytes > 100 * 1024 * 1024) return {ok:false,error:{kind:"MaterialByteLimitExceeded"}};
        images.push({path:`page:${page}:image:${images.length + 1}`,mediaType:"image/png",bytes,context:`Embedded image on PDF page ${page}.`});
      }
    }
    result = {ok:true,value:images};
  } catch {
    result = {ok:false,error:{kind:"MaterialPdfImageExtractionFailed"}};
  } finally {
    if (task !== undefined) {
      try { await task.destroy(); } catch { return {ok:false,error:{kind:"MaterialPdfCleanupFailed"}}; }
    }
  }
  return result;
}
