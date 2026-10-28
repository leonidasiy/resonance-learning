// @ts-check
import { extractMaterialImages } from '../src/features/knowledge-workflows/material.js';
import { imageSignature } from '../src/features/knowledge-workflows/image-upload.js';
import { imageHash } from './webpage-images.js';

// Bump when document extraction or its decoder dependencies change.
export const MATERIAL_IMAGE_EXTRACTOR_VERSION='material-images-v1';
const receiptVersion='material-image-cache-v1';
/** @typedef {import('../src/features/knowledge-workflows/url-capture.js').CapturedImage} CapturedImage */
/** @typedef {{ownerId:string,runId:string,sourceId:string,sourceRevision:number}} Scope */
/** @typedef {{digest:string,byteLength:number}} Original */
/** @typedef {Scope & {version:typeof receiptVersion,inputDigest:string,manifestDigest:string,images:Original[]}} Receipt */
/** @template T @typedef {{ok:true,value:T}|{ok:false,error:{kind:string}}} Result */
/** @param {unknown} value @returns {value is Record<string,unknown>} */
const record=value=>typeof value==='object'&&value!==null&&!Array.isArray(value);
/** @param {unknown} value @returns {value is string} */
const digest=value=>typeof value==='string'&&/^sha256:[a-f0-9]{64}$/u.test(value);
/** @param {string} kind */
const failed=kind=>({ok:/** @type {const} */(false),error:{kind}});

/** Journal entries contain only scoped hashes/lengths, never source captions or image bytes.
 * @param {unknown} value @param {Scope} scope @param {string} inputDigest @returns {value is Receipt} */
export function isMaterialImageReceipt(value,scope,inputDigest) {
 return record(value)&&Object.keys(value).sort().join(',')==='images,inputDigest,manifestDigest,ownerId,runId,sourceId,sourceRevision,version'&&value.version===receiptVersion&&value.ownerId===scope.ownerId&&value.runId===scope.runId&&value.sourceId===scope.sourceId&&value.sourceRevision===scope.sourceRevision&&digest(inputDigest)&&value.inputDigest===inputDigest&&digest(value.manifestDigest)&&Array.isArray(value.images)&&value.images.every(image=>record(image)&&Object.keys(image).sort().join(',')==='byteLength,digest'&&digest(image.digest)&&Number.isSafeInteger(image.byteLength)&&Number(image.byteLength)>0);
}

/** Derive every cleanup key; never trust a persisted object key.
 * @param {Receipt} receipt */
export async function materialImageObjectKeys(receipt) {
 const scopeHash=await imageHash(new TextEncoder().encode(JSON.stringify({ownerId:receipt.ownerId,runId:receipt.runId,sourceId:receipt.sourceId,sourceRevision:receipt.sourceRevision})));
 const prefix=`source-content/workflow-material-images-${scopeHash.slice(7)}-${receipt.inputDigest.slice(7)}-`;
 return {manifest:`${prefix}manifest-${receipt.manifestDigest.slice(7)}`,images:receipt.images.map(image=>prefix+image.digest.slice(7))};
}

/** Original bytes stay in private R2. The resume-safe stage journals their identities
 * before writes, allowing deletion and interrupted-write recovery without model calls.
 * @param {{material:import('../src/features/knowledge-workflows/material.js').AuthorizedMaterial,bytes:Uint8Array,scope:Scope,database:import('./knowledge-workflow-content-d1.js').D1DatabasePort,stages:import('./knowledge-workflow-stages-d1.js').D1WorkflowStageRepository,store:Pick<import('./source-content-r2.js').R2SourceContentStore,'read'|'stage'|'remove'>,extract?:typeof extractMaterialImages}} dependencies
 * @returns {Promise<Result<readonly CapturedImage[]>>} */
export async function loadMaterialImages(dependencies) {
 const {material,bytes,scope,database,stages,store}=dependencies,extract=dependencies.extract??extractMaterialImages;
 const inputDigest=await imageHash(new TextEncoder().encode(JSON.stringify({version:MATERIAL_IMAGE_EXTRACTOR_VERSION,...scope,sourceUrl:material.sourceUrl,mediaType:material.mediaType,contentDigest:material.contentDigest.replace(/^sha256:/u,''),locators:material.sections.map(section=>section.locator)})));
 /** @returns {Promise<boolean>} */
 async function active(){
  const row=await database.prepare("SELECT source_id,source_revision FROM knowledge_workflow_runs WHERE owner_id=? AND run_id=? AND state<>'abandoned' AND NOT EXISTS(SELECT 1 FROM knowledge_workflow_run_tombstones WHERE owner_id=? AND run_id=?)").bind(scope.ownerId,scope.runId,scope.ownerId,scope.runId).first();
  return record(row)&&row.source_id===scope.sourceId&&row.source_revision===scope.sourceRevision;
 }
 /** @type {{images:readonly CapturedImage[],manifest:Uint8Array}|undefined} */let prepared;
 /** @returns {Promise<Result<Receipt>>} */
 async function prepare(){
  const extracted=await extract(material,bytes);if(!extracted.ok)return extracted;
  const originals=await Promise.all(extracted.value.map(async image=>({digest:await imageHash(image.bytes),byteLength:image.bytes.length})));
  const manifest=new TextEncoder().encode(JSON.stringify(extracted.value.map(({bytes,...image},index)=>({...image,...originals[index]}))));
  /** @type {Receipt} */const receipt={version:receiptVersion,...scope,inputDigest,manifestDigest:await imageHash(manifest),images:originals};
  prepared={images:extracted.value,manifest};return {ok:true,value:receipt};
 }
 /** @param {string} key @returns {Promise<Result<Uint8Array|null>>} */
 async function read(key){const result=await store.read(scope.ownerId,key);return !result.ok&&result.error.kind==='SourceContentNotFound'?{ok:true,value:null}:result;}
 /** @param {string} key @param {Uint8Array} content @param {string} mediaType @param {string} contentDigest */
 async function write(key,content,mediaType,contentDigest){return store.stage({objectId:key.slice('source-content/'.length),ownerId:scope.ownerId,sourceId:scope.sourceId,itemId:scope.runId,itemVersionId:String(scope.sourceRevision),content,contentDigest,mediaType});}
 try{
  if(await imageHash(bytes)!==`sha256:${material.contentDigest.replace(/^sha256:/u,'')}`)return failed('UploadedImageHashMismatch');
  if(!await active())return failed('MaterialImageCacheUnavailable');
  const journal=await stages.run(scope,`material-image-manifest:${inputDigest}`,inputDigest,prepare,{resumeSafe:true});
  if(!journal.ok)return journal;
  if(!isMaterialImageReceipt(journal.value,scope,inputDigest))return failed('MaterialImageCacheReceiptInvalid');
  const receipt=journal.value,keys=await materialImageObjectKeys(receipt);
  const storedManifest=await read(keys.manifest);if(!storedManifest.ok)return storedManifest;
  if(storedManifest.value===null){
   if(prepared===undefined){const rebuilt=await prepare();if(!rebuilt.ok)return rebuilt;if(JSON.stringify(rebuilt.value)!==JSON.stringify(receipt))return failed('MaterialImageCacheExtractionChanged');}
   const rebuilt=/** @type {NonNullable<typeof prepared>} */(prepared);
   const written=new Set();
   for(const [index,image] of rebuilt.images.entries()){
    const key=keys.images[index];if(written.has(key))continue;written.add(key);
    if(!await active())return failed('MaterialImageCacheUnavailable');
    const stored=await read(key);if(!stored.ok)return stored;
    if(stored.value!==null){const original=stored.value;if(original.length!==receipt.images[index].byteLength||await imageHash(original)!==receipt.images[index].digest)return failed('MaterialImageCacheBytesChanged');}
    else {const saved=await write(key,image.bytes,image.mediaType,receipt.images[index].digest);if(!saved.ok)return saved;}
    if(!await active()){const removed=await store.remove(key);return removed.ok?failed('MaterialImageCacheUnavailable'):removed;}
   }
   if(!await active())return failed('MaterialImageCacheUnavailable');
   const saved=await write(keys.manifest,rebuilt.manifest,'text/plain',receipt.manifestDigest);if(!saved.ok)return saved;
   if(!await active()){const removed=await store.remove(keys.manifest);return removed.ok?failed('MaterialImageCacheUnavailable'):removed;}
   return {ok:true,value:rebuilt.images};
  }
  const manifestBytes=storedManifest.value;
  if(await imageHash(manifestBytes)!==receipt.manifestDigest)return failed('MaterialImageCacheManifestChanged');
  const manifest=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(manifestBytes));
  if(!Array.isArray(manifest)||manifest.length!==receipt.images.length)return failed('MaterialImageCacheManifestInvalid');
  /** @type {CapturedImage[]} */const images=[];
  /** @type {Map<string,Uint8Array>} */const originals=new Map();
  const paths=new Set();
  for(const [index,image] of manifest.entries()){
   if(!record(image)||Object.keys(image).sort().join(',')!=='alt,byteLength,caption,context,digest,mediaType,path,url'||!['path','url','caption','alt','context','mediaType'].every(key=>typeof image[key]==='string')||!image.path||paths.has(image.path)||image.digest!==receipt.images[index].digest||image.byteLength!==receipt.images[index].byteLength)return failed('MaterialImageCacheManifestInvalid');
   paths.add(image.path);
   const key=keys.images[index];let original=originals.get(key);
   if(original===undefined){const stored=await read(key);if(!stored.ok)return stored;if(stored.value===null)return failed('MaterialImageCacheMissing');original=stored.value;if(original.length!==image.byteLength||await imageHash(original)!==image.digest)return failed('MaterialImageCacheBytesChanged');originals.set(key,original);}
   if(original.length!==image.byteLength||imageSignature(original)!==image.mediaType)return failed('MaterialImageCacheBytesChanged');
   const {digest:originalDigest,byteLength,...metadata}=image;
   images.push({.../** @type {Omit<CapturedImage,'bytes'>} */(metadata),bytes:original.slice()});
  }
  return await active()?{ok:true,value:images}:failed('MaterialImageCacheUnavailable');
 }catch(error){if(!(error instanceof Error))throw error;return failed('MaterialImageCachePersistenceFailed');}
}
