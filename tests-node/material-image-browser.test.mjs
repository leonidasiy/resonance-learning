import {test} from 'node:test';
import assert from 'node:assert/strict';
import {getResolvedPDFJS} from 'unpdf';
import {embeddedPdf} from '../tests/fixtures/embedded-documents.js';
import {extractPdfEmbeddedImages,extractPdfEmbeddedImagesWithLibrary} from '../src/features/knowledge-workflows/pdf-embedded-images.js';
import {createBrowserMaterialImageExtractor} from '../worker/material-image-browser.mjs';

const material={ownerId:'owner',runId:'run',sourceUrl:'https://private.example/source?secret=never-send',mediaType:'application/pdf',sections:[]};
const bytes=embeddedPdf();

test('serialized parser has no module closure and preserves exact PNG bytes/provenance',async()=>{
  const isolated=Function(`return (${extractPdfEmbeddedImagesWithLibrary.toString()})`)();
  const before=bytes.slice();
  for(const inline of [false,true]){
    const input=embeddedPdf(inline);
    assert.deepEqual(await isolated(input,await getResolvedPDFJS()),await extractPdfEmbeddedImages(input));
  }
  assert.deepEqual(bytes,before);
  assert.deepEqual(await isolated(new Uint8Array([1,2]),await getResolvedPDFJS()),{ok:false,error:{kind:'MaterialPdfImageExtractionFailed'}});
});

async function fixture(options={}){
  const extracted=await extractPdfEmbeddedImages(bytes);assert(extracted.ok);
  const remote=options.remote??extracted;
  const calls={requests:[],cdp:[],reconciled:[],closed:0,disposed:0,launches:0,logs:[],chunks:[],assets:[]};
  let paused;
  const client={on(event,callback){assert.equal(event,'Fetch.requestPaused');paused=callback;},async send(method,args){calls.cdp.push({method,args});}};
  const handle={async evaluate(fn,...args){if(args.length)calls.chunks.push(args);return options.metadata!==undefined&&!args.length?options.metadata:fn(remote,...args);},async dispose(){calls.disposed++;if(options.disposeFail)throw Error('dispose');}};
  const page={async createCDPSession(){return client;},on(){},async goto(url){calls.requests.push(url);await paused({requestId:'root',request:{url,method:'GET'}});for(const [id,target,method]of [['pdf','https://material.invalid/original','GET'],['lib','https://material.invalid/pdfjs.mjs','GET'],['outside','https://evil.example/steal','GET'],['cookie','https://material.invalid/original?secret=1','GET'],['write','https://material.invalid/original','POST'],['file','file:///etc/passwd','GET'],['data','data:text/html,secret','GET']])await paused({requestId:id,request:{url:target,method}});},async evaluateHandle(source){if(options.delayed)await new Promise(resolve=>setTimeout(resolve,10));assert(!source.includes(material.sourceUrl));assert(source.includes(extractPdfEmbeddedImagesWithLibrary.toString()));if(options.evaluateFail)throw Error('remote');return handle;}};
  const dependencies={binding:{},assets:{async fetch(request){calls.assets.push(request.url);return new Response('static pdfjs');}},now:()=>100,logger:entry=>calls.logs.push(entry),capacity:{async reserve(){return options.denied??{ok:true,value:{reservedMilliseconds:options.delayed?1:60_000}};},async reconcile(command){calls.reconciled.push(command);return {ok:true,value:null};}},launcher:{async launch(){calls.launches++;if(options.launchFail)throw Error('launch');return {async newPage(){return page;},async close(){calls.closed++;if(options.closeFail)throw Error('close');}};}}};
  return {calls,extract:createBrowserMaterialImageExtractor(dependencies),extracted};
}

test('local virtual origin denies every other request and roundtrips bounded base64 PNGs',async()=>{
  const {calls,extract,extracted}=await fixture();
  const result=await extract(material,bytes);assert(result.ok);
  assert.deepEqual(result.value.map(({bytes})=>bytes),extracted.value.map(({bytes})=>bytes));
  assert.equal(result.value[0].url,material.sourceUrl+'#page:1:image:1');
  assert.deepEqual(calls.assets,['https://material.invalid/pdfjs.mjs']);
  const fulfills=calls.cdp.filter(call=>call.method==='Fetch.fulfillRequest');
  assert.deepEqual(fulfills.map(call=>call.args.requestId),['root','pdf','lib']);
  assert.deepEqual(Buffer.from(fulfills[1].args.body,'base64'),Buffer.from(bytes));
  assert.match(fulfills[0].args.responseHeaders.find(header=>header.name==='Content-Security-Policy').value,/connect-src 'self'; worker-src 'none'/);
  assert.deepEqual(calls.cdp.filter(call=>call.method==='Fetch.failRequest').map(call=>call.args.requestId),['outside','cookie','write','file','data']);
  assert(calls.chunks.every(([, ,length])=>length<=48*1024));
  assert.equal(calls.disposed,1);assert.equal(calls.closed,1);assert.equal(calls.reconciled[0].outcome,'completed');
  assert(!JSON.stringify(calls.logs).includes('secret'));
});

test('quota rejection is retained and launches no browser',async()=>{
  const denied={ok:false,error:{kind:'BrowserRunDailyBudgetExceeded'}};
  const {calls,extract}=await fixture({denied});
  assert.deepEqual(await extract(material,bytes),denied);assert.equal(calls.launches,0);assert.equal(calls.reconciled.length,0);
});

test('selected PDF excerpts and non-PDF sources bypass assets and browser entirely',async()=>{
  const {calls,extract}=await fixture();
  assert.deepEqual(await extract({...material,sections:[{locator:'pdf:page=1;text-codepoints=0:9'}]},bytes),{ok:true,value:[]});
  assert.deepEqual(await extract({...material,mediaType:'text/plain'},new Uint8Array()),{ok:true,value:[]});
  assert.equal(calls.launches,0);assert.equal(calls.assets.length,0);
});

test('malformed remote results and signatures fail explicitly and release pixels/session',async()=>{
  for(const options of [{metadata:{ok:true,value:[{path:'page:1:image:1',mediaType:'image/png',context:'Embedded image on PDF page 1.',length:Infinity}]}},{remote:{ok:true,value:[{path:'page:1:image:1',mediaType:'image/png',context:'Embedded image on PDF page 1.',bytes:new Uint8Array(10)}]}},{metadata:{ok:false,error:{kind:'invented'}}}]){
    const {calls,extract}=await fixture(options);
    assert.deepEqual(await extract(material,bytes),{ok:false,error:{kind:'MaterialImageBrowserResultInvalid'}});
    assert.equal(calls.disposed,1);assert.equal(calls.closed,1);assert.equal(calls.reconciled[0].outcome,'completed');
  }
});

test('launch and close uncertainty retain full ledger charge; failed evaluation still closes',async()=>{
  for(const [options,kind,outcome]of [[{launchFail:true},'MaterialImageBrowserExtractionFailed','uncertain'],[{closeFail:true},'BrowserRunSessionCloseFailed','uncertain'],[{evaluateFail:true},'MaterialImageBrowserExtractionFailed','completed'],[{disposeFail:true},'MaterialImageBrowserCleanupFailed','completed']]){
    const {calls,extract}=await fixture(options);
    assert.deepEqual(await extract(material,bytes),{ok:false,error:{kind}});
    assert.equal(calls.reconciled.length,1);assert.equal(calls.reconciled[0].outcome,outcome);
    assert.equal(calls.closed,options.launchFail?0:1);
  }
});

test('large outputs use several bounded chunks and preserve every byte and image',async()=>{
  const png=new Uint8Array(120_000);png.set([137,80,78,71,13,10,26,10]);
  const remote={ok:true,value:Array.from({length:101},(_,index)=>({path:`page:1:image:${index+1}`,context:'Embedded image on PDF page 1.',mediaType:'image/png',bytes:index===0?png:png.subarray(0,8)}))};
  const {calls,extract}=await fixture({remote});
  const result=await extract(material,bytes);assert(result.ok);assert.equal(result.value.length,101);
  assert.deepEqual(result.value[0].bytes,png);assert.equal(calls.chunks.filter(([index])=>index===0).length,3);
  assert(calls.chunks.every(([, ,length])=>length<=48*1024));
});

test('reservation deadline closes remote session and cannot report late success',async()=>{
  const {calls,extract}=await fixture({delayed:true});
  assert.deepEqual(await extract(material,bytes),{ok:false,error:{kind:'MaterialImageBrowserTimedOut'}});
  assert.equal(calls.disposed,1);assert.equal(calls.closed,2);assert.equal(calls.reconciled[0].outcome,'completed');
});
