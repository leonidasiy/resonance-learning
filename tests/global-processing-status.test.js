// @ts-check
import { createLibraryPage } from "../src/startup/library-page.js";
import { SourceLibraryGatewayClient } from "../src/features/source-library/gateway.js";
const shell = Deno.readTextFileSync("index.html");
Object.defineProperty(globalThis,"document",{configurable:true,value:{getElementById:(/** @type {string} */ id)=>({textContent:shell.match(new RegExp(`<script id="${id}" type="application/json">([\\s\\S]*?)</script>`))?.[1]})}});
/** @param {unknown} value @param {string} message */
function assert(value,message){if(!value)throw new Error(message);}
/** @param {string} id */
function source(id){return {id,ownerId:"owner-a",origin:/** @type {const} */("private-document"),submittedUrl:`https://app.example/api/private-documents/${id}`,canonicalUrl:`https://app.example/api/private-documents/${id}`,title:"Synthetic source",description:"fixture.txt",adapter:{id:"private-document",version:"1",granularity:"document",capabilities:["owner-private-document"]},interestAreaIds:[],identityEvidence:[],state:/** @type {const} */("active"),revision:1,approvedAt:"2026-10-05T00:00:00.000Z",updatedAt:"2026-10-05T00:00:00.000Z"};}
/** @param {string} id @param {string} state */
function status(id,state){return {sourceId:id,run:{runId:`run-${id}`,state,revision:1,counts:{pages:0,knowledgePoints:0,acceptedQuizzes:0,pendingQuizzes:0},extractionStartedAt:null,extractionDeadlineAt:null,elapsedMs:null,remainingMs:/** @type {number|null} */(null),decisionRequired:null,failureKind:null,robotsEvidence:null},reasonCode:state==='retryable-failure'?'retryable-failure':null,message:null};}
/** @param {typeof fetch} fetch */
function fixture(fetch){
 const timers=new Map();const errors=/** @type {string[]} */([]);let timerId=0;
 const page=createLibraryPage({fetch,gatewayBaseUrl:"https://app.example/",escapeHtml:v=>v,formatDate:v=>v,createId:()=>"id",confirmDisable:()=>true,createObserver:()=>null,schedule:callback=>{timers.set(++timerId,callback);return timerId;},cancel:handle=>{timers.delete(handle);},onNotice:()=>{},onError:message=>errors.push(message),rerender:()=>{}});
 return {page,timers,errors,poll:async()=>{assert(timers.size===1,"Exactly one poll must be scheduled");const [id,callback]=[...timers][0];timers.delete(id);callback();await new Promise(r=>setTimeout(r,0));await new Promise(r=>setTimeout(r,0));}};
}
Deno.test("empty-description source reaches global status discovery and polling", async () => {
 let requests = 0;
 const f = fixture(async input => {
  if (String(input).includes("source-status")) { requests++; return Response.json({ result: status("a", "extraction-loop") }); }
  return Response.json({ result: { items: [{ ...source("a"), description: "" }], interestAreas: [], nextCursor: null } });
 });
 await f.page.load();
 assert(requests === 1, "Empty description must not block initial status request");
 assert(f.page.renderProcessingStatus().includes("extracting knowledge points"), "Global header tracks the source");
 await f.poll(); assert(requests === 2, "Tracking keeps polling");
});
Deno.test("Library keeps watching an acquisition outage and displays automatic recovery without a reload",async()=>{
 for(const failureKind of ['AcquisitionServiceUnavailable','AcquisitionProtocolInvalid:automatic-retries-exhausted']){
  let recovering=false,reads=0;
  const f=fixture(async input=>{
   if(String(input).includes('source-status')){reads++;const current=status('a',recovering?'extraction-loop':'retryable-failure');return Response.json({result:recovering?current:{...current,run:{...current.run,failureKind},reasonCode:'retryable-failure',message:'The acquisition service is offline. Processing will resume automatically.'}});}
   return Response.json({result:{items:[source('a')],interestAreas:[],nextCursor:null}});
  });
  await f.page.load();assert(f.timers.size===1,'An outage awaiting automatic recovery must keep one refresh scheduled');
  assert(f.page.renderProcessingStatus()==='','Waiting for acquisition must not animate active processing');
  recovering=true;await f.poll();assert(reads===2,'The waiting source must be included in the next status request');
  assert(f.page.renderProcessingStatus().includes('extracting knowledge points'),'The open page must show resumed extraction');
 }
});
Deno.test("global processing discovers later pages after refresh and remains independent of Library search",async()=>{
 let state="extraction-loop";const requested=/** @type {string[]} */([]);
 const f=fixture(async input=>{const url=new URL(String(input));requested.push(url.pathname+url.search);
 if(url.pathname.endsWith("/source-library"))return Response.json({result:{items:[source(url.searchParams.has("cursor")?"b":"a")],interestAreas:[],nextCursor:url.searchParams.has("cursor")?null:"page-two"}});
 if(url.pathname.endsWith("/source-status")){const id=url.searchParams.get("sourceId")??"";return Response.json({result:status(id,id==="b"?state:"completed")});}
 if(url.pathname.endsWith("/search"))return Response.json({result:[]});
 return Response.json({result:{items:[]}});
 });
 await f.page.load();
 assert(requested.some(url=>url.includes("cursor=page-two")),"Refresh must discover processing beyond first page");
 assert(f.page.renderProcessingStatus().includes("extracting knowledge points"),"Header carries real extraction stage");
 assert(!f.page.render({}).includes("data-library-processing-status"),"Only the global header owns the chip");
 const form=new FormData();form.set("query","synthetic");await f.page.search(form);
 assert(f.page.renderProcessingStatus().includes("Processing 1 source"),"Search cannot erase another route's processing");
 state="per-point-quiz-loop";await f.poll();assert(f.page.renderProcessingStatus().includes("generating and validating review quizzes"),"Quiz stage is truthful");
 state="completed";await f.poll();assert(f.page.renderProcessingStatus()==="" && f.timers.size===0,"Completion removes spinner and stops polling");
});
Deno.test("contextual uploads announce local uploading and restart tracking after success and failure",async()=>{
 for(const fail of [false,true]){
 let release=/** @type {((value:Response)=>void)|undefined} */(undefined);let phase="extraction-loop";
 let reached=/** @type {(()=>void)|undefined} */(undefined);
 const materialReached=new Promise(resolve=>{reached=()=>resolve(null);});
 const f=fixture(async input=>{
 if(String(input).includes("/material"))return await new Promise(resolve=>{release=resolve;reached?.();});
 if(String(input).includes("source-status")){const id=new URL(String(input)).searchParams.get("sourceId")??"";return Response.json({result:status(id,phase)});}
 return Response.json({result:{items:[source("a")],interestAreas:[],nextCursor:null}});
 });
 await f.page.load();const form=new FormData();form.set("content","Synthetic owned notes");form.set("title","Synthetic source");
 const uploading=f.page.uploadMaterial("b",form,{source:source("b"),runId:"run-b",reason:"Re-upload material"});
 assert(f.page.renderProcessingStatus().includes("Uploading"),"Show actual local upload immediately");
 await materialReached;assert(release,"Material endpoint reached");
 release?.(fail?Response.json({error:"SyntheticUnavailable"},{status:503}):Response.json({result:{status:"attached",runId:"run-b",materialId:"m",reused:false}}));
 await uploading;
 assert(!f.page.renderProcessingStatus().includes("Uploading"),"Local upload ends on success or failure");
 assert(f.page.renderProcessingStatus().includes("Processing 2 sources"),"Other processing and context source both survive");
 assert(f.timers.size===1,"Context upload restarts exactly one poll");
 phase="abandoned";await f.poll();assert(f.page.renderProcessingStatus()==="","Abandoned runs do not spin");
 }
});
Deno.test("status outages disclose uncertainty without animation and retry once; forbidden statuses clear private state",async()=>{
 for(const failure of ["malformed","offline","http"]){
 let mode="ok";
 const f=fixture(async input=>{
 if(!String(input).includes("source-status"))return Response.json({result:{items:[source("a")],interestAreas:[],nextCursor:null}});
 if(mode==="denied")return Response.json({error:"Forbidden"},{status:403});
 if(mode!=="ok"){
 if(failure==="offline")throw new TypeError("Synthetic offline");
 return failure==="malformed"?Response.json({result:{sourceId:"a"}}):Response.json({error:"Unavailable"},{status:503});
 }
 return Response.json({result:status("a","extraction-loop")});
 });
 await f.page.load();mode="fail";await f.poll();
 const chip=f.page.renderProcessingStatus();assert(chip.includes("Status unavailable"),"Status uncertainty must be explicit");assert(!chip.includes("library-processing-spinner"),"Offline/stale confirmation must not animate");assert(f.timers.size===1,"Failed polling retries without duplication");
 const form=new FormData();form.set("title","Synthetic source");form.set("content","Synthetic owned material");
 const uploading=f.page.uploadMaterial("a",form,{source:source("a"),runId:"run-a",reason:"Re-upload"});
 assert(!f.page.renderProcessingStatus().includes("Processing"),"Local uploading cannot present stale processing as current during an outage");await uploading;
 mode="ok";await f.poll();assert(f.page.renderProcessingStatus().includes("library-processing-spinner"),"Confirmed work restores animation");
 mode="denied";await f.poll();assert(!f.page.renderProcessingStatus().includes("Processing"),"Cross-owner/expired access cannot retain private processing");assert(f.timers.size===0,"Authorization failure stops polling");
 }
});
Deno.test("global startup uses existing controller and source status is strictly bound",async()=>{
 const app=Deno.readTextFileSync("src/app.js");assert(/async function loadActiveRoute\(\)[\s\S]*?await loadLibraryRoute\(\)/u.test(app),"All routes initialize global controller");
 assert(app.slice(app.indexOf("function renderHeader()"),app.indexOf("function renderNavigation()")).includes("renderProcessingStatus"),"Existing header renders global status");
 const gateway=new SourceLibraryGatewayClient({fetch:async()=>Response.json({result:status("other-source","extraction-loop")}),baseUrl:"https://app.example/",timeoutMs:100});
 const result=await gateway.workflowStatus("a");assert(!result.ok && result.error.kind==="SourceGatewayResponseInvalid","Mismatched source cannot become tracked status");
});
Deno.test("initial catalog outage retries bounded discovery without claiming processing",async()=>{
 let offline=true;
 const f=fixture(async input=>{
 if(offline)throw new TypeError("Synthetic offline");
 if(String(input).includes("source-status"))return Response.json({result:status("a","extraction-loop")});
 return Response.json({result:{items:[source("a")],interestAreas:[],nextCursor:null}});
 });
 await f.page.load();assert(f.page.renderProcessingStatus().includes("Status unavailable"),"Initial outage is visible globally");
 assert(!f.page.renderProcessingStatus().includes("library-processing-spinner"),"No claimed work during outage");
 offline=false;await f.poll();assert(f.page.renderProcessingStatus().includes("extracting knowledge points"),"Recovery discovers source-bound work");
});
Deno.test("stale completion cannot erase contextual upload and concurrent refresh keeps one read and timer",async()=>{
 let reached=/** @type {(()=>void)|undefined} */(undefined);
 const materialReached=new Promise(resolve=>{reached=()=>resolve(null);});
 let reads=0;let release=/** @type {((value:Response)=>void)|undefined} */(undefined);let block=false;
 const f=fixture(async input=>{
 if(String(input).includes("source-status")){
 reads++;if(block && new URL(String(input)).searchParams.get("sourceId")==="a") {block=false;return await new Promise(resolve=>{release=resolve;});}
 return Response.json({result:status(new URL(String(input)).searchParams.get("sourceId")??"","extraction-loop")});
 }
 if(String(input).includes("/material")){reached?.();return Response.json({result:{status:"attached",materialId:"m",runId:"run-b",reused:false}});}
 return Response.json({result:{items:[source("a")],interestAreas:[],nextCursor:null}});
 });
 await f.page.load();block=true;const polling=f.poll();await new Promise(r=>setTimeout(r,0));
 const form=new FormData();form.set("title","Synthetic source");form.set("content","Synthetic notes");
 const upload=f.page.uploadMaterial("b",form,{source:source("b"),runId:"run-b",reason:"Re-upload"});
 await materialReached;
 const refresh=f.page.load();await new Promise(r=>setTimeout(r,0));
 release?.(Response.json({result:status("a","completed")}));await Promise.all([polling,upload,refresh]);
 assert(f.page.renderProcessingStatus().includes("Processing 2 sources"),"Late old completion cannot hide newly confirmed runs");
 assert(reads===4,"One stale request plus one replacement batch; no overlapping duplicate reads");
 assert(f.timers.size===1,"One timer remains after upload and navigation refresh");
});
Deno.test("waiting failure abandoned and expired workflows stop animation while every active stage is truthful",async()=>{
 for(const state of ["source-added","rights-assessment","robots-check","extraction-loop","extraction-finalized","per-point-quiz-loop","completed","retryable-failure","abandoned","awaiting-upload","awaiting-rights-review","paused"]){
 const f=fixture(async input=>String(input).includes("source-status")?Response.json({result:status("a",state)}):Response.json({result:{items:[source("a")],interestAreas:[],nextCursor:null}}));
 await f.page.load();const active=["source-added","rights-assessment","robots-check","extraction-loop","extraction-finalized","per-point-quiz-loop"].includes(state);
 assert(f.page.renderProcessingStatus().includes("library-processing-spinner")===active,`Truthful animation for ${state}`);assert(f.timers.size===(active||state==='retryable-failure'?1:0),`Watch active or retryable work for ${state}`);
 }
 const expired=status("a","extraction-loop");expired.run.remainingMs=0;
 const f=fixture(async input=>String(input).includes("source-status")?Response.json({result:expired}):Response.json({result:{items:[source("a")],interestAreas:[],nextCursor:null}}));
 await f.page.load();assert(f.page.renderProcessingStatus()==="" && f.timers.size===0,"Expired extraction never spins");
});
