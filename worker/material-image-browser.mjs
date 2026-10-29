// @ts-check
import puppeteer from '@cloudflare/puppeteer';
import { Buffer } from 'node:buffer';
import { extractMaterialImages } from '../src/features/knowledge-workflows/material.js';
import { extractPdfEmbeddedImagesWithLibrary } from '../src/features/knowledge-workflows/pdf-embedded-images.js';
import { imageSignature } from '../src/features/knowledge-workflows/image-upload.js';

const origin='https://material.invalid';
const maximumImageBytes=20*1024*1024, maximumTotalBytes=100*1024*1024, chunkBytes=512*1024;
/** @param {string} kind */
const fail=kind=>({ok:/** @type {const} */(false),error:{kind}});
/** @typedef {import('../src/features/knowledge-workflows/url-capture.js').CapturedImage} CapturedImage */
/** @param {{binding:import('@cloudflare/puppeteer').BrowserWorker,capacity:Pick<import('./browser-run-capacity-d1.js').D1BrowserRunCapacityLedger,'reserve'|'reconcile'>,assets:{fetch:(request:Request)=>Promise<Response>},now:()=>number,logger:(entry:{event:string,ownerId:string,failureKind?:string,stage?:string,durationMs?:number,count?:number,itemCount?:number})=>void,launcher?:Pick<typeof puppeteer,'launch'>}} dependencies */
export function createBrowserMaterialImageExtractor({binding,capacity,assets,now,logger,launcher=puppeteer}) {
  /** @param {import('../src/features/knowledge-workflows/material.js').AuthorizedMaterial} material @param {Uint8Array} bytes
   * @returns {Promise<{ok:true,value:readonly CapturedImage[]}|{ok:false,error:{kind:string}}>} */
  return async (material,bytes)=>{
    if(material.mediaType!=='application/pdf'||material.sections.some(section=>section.locator.startsWith('pdf:page=')))return extractMaterialImages(material,bytes);
    if(!(bytes instanceof Uint8Array)||bytes.length>maximumTotalBytes)return fail('MaterialByteLimitExceeded');
    // Only the bound static asset service sees this URL; no public fetch fallback.
    let library;
    try {
      const response=await assets.fetch(new Request(`${origin}/pdfjs.mjs`));
      if(!response.ok)return fail('MaterialImageBrowserAssetUnavailable');
      library=Buffer.from(await response.arrayBuffer());
    }catch{return fail('MaterialImageBrowserAssetUnavailable');}
    const reserved=await capacity.reserve({ownerId:material.ownerId,jobId:`material-images:${crypto.randomUUID()}`});
    if(!reserved.ok)return reserved;
    const started=now(),deadline=started+reserved.value.reservedMilliseconds;
    let browser,timer,closeFailed=false,timedOut=false;
    let stage='launch',phaseStarted=started,imageCount=0,chunkCount=0;
    const timeoutKind=()=>`MaterialImageBrowser${stage==='launch'?'Launch':stage==='decode'?'Decode':'Transfer'}TimedOut`;
    const logPhase=()=>logger({event:'material-image-browser-phase',ownerId:material.ownerId,stage,durationMs:Math.max(0,now()-phaseStarted),count:imageCount,itemCount:chunkCount});
    /** @param {string} next */
    const nextPhase=next=>{logPhase();stage=next;phaseStarted=now();};
    /** @type {import('@cloudflare/puppeteer').JSHandle|undefined} */let handle;
    /** @type {{ok:true,value:readonly CapturedImage[]}|{ok:false,error:{kind:string}}} */let result=fail('MaterialImageBrowserExtractionFailed');
    try {
      browser=await launcher.launch(binding,{keep_alive:reserved.value.reservedMilliseconds});
      nextPhase('decode');
      const session=browser;
      timer=setTimeout(()=>{timedOut=true;void session.close().catch(()=>{closeFailed=true;});},Math.max(1,deadline-now()));
      const page=await browser.newPage();
      const client=await page.createCDPSession();
      // Puppeteer's request.respond loops over every byte; CDP accepts native base64 directly.
      client.on('Fetch.requestPaused',async ({requestId,request})=>{
        try {
          if(request.method!=='GET')return await client.send('Fetch.failRequest',{requestId,errorReason:'BlockedByClient'});
          let body,contentType,headers=[];
          switch(request.url){
            case `${origin}/`:body=Buffer.from('<!doctype html><title>Document image extraction</title>').toString('base64');contentType='text/html';headers.push({name:'Content-Security-Policy',value:"default-src 'none'; script-src 'self'; connect-src 'self'; worker-src 'none'; base-uri 'none'; form-action 'none'"});break;
            case `${origin}/original`:body=Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength).toString('base64');contentType='application/pdf';break;
            case `${origin}/pdfjs.mjs`:body=library.toString('base64');contentType='text/javascript';break;
            default:return await client.send('Fetch.failRequest',{requestId,errorReason:'BlockedByClient'});
          }
          await client.send('Fetch.fulfillRequest',{requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:contentType},...headers],body});
        }catch{await client.send('Fetch.failRequest',{requestId,errorReason:'BlockedByClient'}).catch(()=>{});}
      });
      await client.send('Fetch.enable',{patterns:[{urlPattern:'*'}]});
      page.on('popup',popup=>{void popup?.close();});
      await page.goto(`${origin}/`,{waitUntil:'load',timeout:Math.max(1,deadline-now())});
      // CDP evaluates the shared function directly; document content is never executable code.
      handle=await page.evaluateHandle(`(async()=>{const pdfjs=await import('${origin}/pdfjs.mjs');const bytes=new Uint8Array(await(await fetch('${origin}/original')).arrayBuffer());return (${extractPdfEmbeddedImagesWithLibrary.toString()})(bytes,pdfjs);})()`);
      if(timedOut||now()>=deadline)throw new Error('MaterialImageTimedOut');
      const metadata=await handle.evaluate(result=>result.ok?{ok:true,value:result.value.map((/** @type {import('../src/features/knowledge-workflows/material.js').MaterialMedia} */ {bytes,...image})=>({...image,length:bytes.length}))}:result);
      if(!metadata||typeof metadata!=='object'||typeof metadata.ok!=='boolean')throw new TypeError('MaterialImageInvalid');
      if(!metadata.ok){
        if(!['MaterialPdfPageLimitExceeded','MaterialImageInvalid','MaterialByteLimitExceeded','MaterialPdfImageExtractionFailed','MaterialPdfCleanupFailed'].includes(metadata.error?.kind))throw new TypeError('MaterialImageInvalid');
        result=fail(metadata.error.kind);
      }else {
        if(!Array.isArray(metadata.value))throw new TypeError('MaterialImageInvalid');
        nextPhase('transfer');
        /** @type {CapturedImage[]} */const images=[];
        let total=0;
        for(const [index,image] of metadata.value.entries()){
          const path=typeof image?.path==='string'?/^page:([1-9]\d*):image:([1-9]\d*)$/u.exec(image.path):null;
          if(!path||Number(path[1])>100||Number(path[2])!==index+1||image.mediaType!=='image/png'||image.context!==`Embedded image on PDF page ${Number(path[1])}.`||!Number.isSafeInteger(image.length)||image.length<8||image.length>maximumImageBytes||total+image.length>maximumTotalBytes)throw new TypeError('MaterialImageInvalid');
          total+=image.length;
          const output=new Uint8Array(image.length);
          for(let offset=0;offset<image.length;offset+=chunkBytes){
            if(timedOut||now()>=deadline)throw new Error('MaterialImageTimedOut');
            const length=Math.min(chunkBytes,image.length-offset);
            const encoded=await handle.evaluate((result,index,offset,length)=>{
              const bytes=result.value[index].bytes.subarray(offset,offset+length);
              let binary='';for(let start=0;start<bytes.length;start+=8192)binary+=String.fromCharCode(...bytes.subarray(start,start+8192));
              return btoa(binary);
            },index,offset,length);
            if(typeof encoded!=='string'||encoded.length!==4*Math.ceil(length/3))throw new TypeError('MaterialImageInvalid');
            const decoded=/** @type {Uint8Array} */(/** @type {unknown} */(Buffer.from(encoded,'base64')));
            if(decoded.length!==length)throw new TypeError('MaterialImageInvalid');
            output.set(decoded,offset);
            chunkCount++;
          }
          if(imageSignature(output)!=='image/png')throw new TypeError('MaterialImageInvalid');
          const url=new URL(material.sourceUrl);url.hash=image.path;
          images.push({path:image.path,mediaType:'image/png',context:image.context,bytes:output,url:url.href,caption:'',alt:''});
          imageCount++;
        }
        result=timedOut||now()>=deadline?fail(timeoutKind()):{ok:true,value:images};
      }
    }catch(error){result=fail(timedOut||now()>=deadline?timeoutKind():error instanceof TypeError&&error.message==='MaterialImageInvalid'?'MaterialImageBrowserResultInvalid':'MaterialImageBrowserExtractionFailed');}
    finally {
      logPhase();
      // Release remote pixels before closing the session; browser close also covers failed disposal.
      if(handle)try{await handle.dispose();}catch{result=fail('MaterialImageBrowserCleanupFailed');}
      clearTimeout(timer);
      if(browser)try{await browser.close();}catch{closeFailed=true;}
      const reconciled=await capacity.reconcile({reservation:reserved.value,outcome:closeFailed||!browser?'uncertain':'completed',measuredMilliseconds:Math.max(0,now()-started)});
      if(!reconciled.ok)result=reconciled;
      if(closeFailed)result=fail('BrowserRunSessionCloseFailed');
      logger({event:result.ok?'material-image-extraction-success':'material-image-extraction-failure',ownerId:material.ownerId,...(result.ok?{}:{failureKind:result.error.kind})});
    }
    return result;
  };
}
