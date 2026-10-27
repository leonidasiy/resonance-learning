// @ts-check
import { createDiscoveryPage } from "../src/startup/discovery-page.js";
import { createLibraryPage } from "../src/startup/library-page.js";
import { createUploadPage } from "../src/features/uploads/page.js";
import { MemoryPersistence } from "../src/persistence/memory.js";

const shell = Deno.readTextFileSync("index.html");
Object.defineProperty(globalThis, "document", {configurable:true,value:{getElementById:(/** @type {string} */id)=>({textContent:shell.match(new RegExp(`<script id="${id}" type="application/json">(.*?)</script>`))?.[1]})}});
const markup = JSON.parse(shell.match(/<script id="app-copy" type="application\/json">([\s\S]*?)<\/script>/)?.[1] ?? "{}").discoverMarkup;
/** @param {unknown} value @param {string} message */
function assert(value, message) { if (!value) throw new Error(message); }
function fixture() {
  const values = new Map();
  const errors = /** @type {string[]} */([]);
  const storage = {getItem:(/** @type {string} */key)=>values.get(key) ?? null,setItem:(/** @type {string} */key,/** @type {string} */value)=>{values.set(key,value);}};
  return {values,storage,errors};
}

Deno.test("Discover restores provider and result options in a fresh session without saving search text", async () => {
  const {values,storage,errors} = fixture();
  const persistence = new MemoryPersistence();
  let searches = 0;
  const dependencies = {
    ownerId:"sample-owner", persistence, policyStorage:storage, markup, starterInventory:JSON.parse(Deno.readTextFileSync("assets/discovery-starters.json")),
    fetch:/** @type {typeof fetch} */(async input=>{
      const path = new URL(input instanceof Request ? input.url : String(input)).pathname;
      if (path.endsWith("/capabilities")) return Response.json({result:[{id:"web",label:"Web",resultKind:"web",priority:1,enabled:true},{id:"podcasts",label:"Podcasts",resultKind:"podcast",priority:2,enabled:true}]});
      if (path.endsWith("/search")) { searches++; return Response.json({result:{items:[],providerFailures:[],submittedQuery:"private search",providerQuery:"private search",policyVersion:"v1"}}); }
      return Response.json({result:{items:[],interestAreas:[],nextCursor:null}});
    }),
    gatewayBaseUrl:"https://sample.example/",escapeHtml:(/** @type {string} */v)=>v,createId:()=>crypto.randomUUID(),now:()=>"2026-10-27T00:00:00.000Z",
    onNotice:()=>{},onError:(/** @type {string} */v)=>errors.push(v),navigateToLibrary:()=>{},navigateToUpload:()=>{},rerender:()=>{},
  };
  const page = createDiscoveryPage(dependencies);
  const loaded = await page.load();
  assert(loaded.ok,JSON.stringify(loaded));
  await page.search({query:"private search",providerIds:["podcasts"],limit:20});
  const restored = createDiscoveryPage(dependencies);
  const reopened = await restored.load();
  assert(reopened.ok,JSON.stringify(reopened));
  const html = restored.render({selectedItemId:null,online:true});
  assert(html.includes('value="20" selected') && /value="podcasts"[^>]*checked/.test(html) && !/value="web"[^>]*checked/.test(html), "The next session restores the selected providers and count.");
  assert(searches === 1 && !JSON.stringify([...values]).includes("private search"), "Restoring settings neither replays search nor saves its private query.");
  const key = [...values.keys()][0];
  values.set(key,JSON.stringify({providerIds:[],limit:5,extractionScope:"platform"}));
  const empty = createDiscoveryPage(dependencies); await empty.load();
  assert(!/name="provider"[^>]*checked/.test(empty.render({selectedItemId:null,online:true})), "Intentionally deselecting all providers survives a new session.");
  values.set(key,JSON.stringify({providerIds:["retired-provider"],limit:10,extractionScope:"page"}));
  const retired = createDiscoveryPage(dependencies); await retired.load();
  assert(!retired.render({selectedItemId:null,online:true}).includes("retired-provider"), "Unavailable provider IDs cannot invalidate the restored view.");
  assert(errors.length === 0, "Valid saved options do not produce errors.");
});

Deno.test("Library restores search scope and explicit AI ranking preference", async () => {
  const {storage,errors} = fixture();
  const commands = /** @type {URL[]} */([]);
  const dependencies = {storage,fetch:/** @type {typeof fetch} */(async input=>{
    const url = new URL(input instanceof Request ? input.url : String(input)); commands.push(url);
    return Response.json({result:url.pathname.endsWith("/search")?[]:{items:[],interestAreas:[],nextCursor:null}});
  }),gatewayBaseUrl:"https://sample.example/",escapeHtml:(/** @type {string} */v)=>v,formatDate:(/** @type {string} */v)=>v,createId:()=>"id",confirmDisable:()=>true,createObserver:()=>null,schedule:()=>1,cancel:()=>{},onNotice:()=>{},onError:(/** @type {string} */v)=>errors.push(v),rerender:()=>{}};
  const page = createLibraryPage(dependencies);
  const form = new FormData();form.set("query","sample");form.set("searchScope","sources");form.set("externalProcessingAllowed","on");
  await page.search(form);
  const restored = createLibraryPage(dependencies);await restored.load();
  const html = restored.render({});
  assert(html.includes('value="sources" selected') && /name="externalProcessingAllowed" checked/.test(html), "Library options survive its initial catalog load.");
  assert(commands.some(url=>url.searchParams.get("externalProcessingAllowed")==="true"), "Explicit ranking consent reaches the existing search boundary.");
  assert(errors.length === 0,"Saved valid settings load without errors.");
  page.dispose();restored.dispose();
});

Deno.test("Upload remembers format and PDF image setting but keeps source data out of preferences", async () => {
  const {values,storage,errors} = fixture();
  const dependencies = {storage,fetch:/** @type {typeof fetch} */(async()=>{throw new Error("No network expected");}),baseUrl:"https://sample.example/",onChange:()=>{},createId:()=>"id",onRenamed:()=>{},upload:async()=>({ok:true,message:"Uploaded"}),onError:(/** @type {string} */v)=>errors.push(v)};
  const page = createUploadPage(dependencies);await page.select("pdf");
  const form = new FormData();form.set("title","private title");form.set("content","private text");form.set("pageRange","9-12");form.set("imageProcessing","on");form.set("file",new File(["private file"],"private.pdf"));page.remember(form);
  const restored = createUploadPage(dependencies);await restored.load("#upload");
  const html = restored.render();
  assert(html.includes('value="pdf" selected') && html.includes('name="imageProcessing" checked'), "Format and image processing survive a fresh page instance and load.");
  assert(!JSON.stringify([...values]).includes("private") && !html.includes("9-12"), "Files, content, titles, and document-specific ranges remain outside saved options.");
  await restored.load("#upload",{title:"Video transcript",reason:"Paste a permitted transcript"});
  assert(restored.render().includes('value="text" selected'), "Explicit transcript handoff takes precedence over the saved format.");
  assert(errors.length === 0,"Valid options need no error message.");
  values.set("resonance-upload-options",'{bad json');
  const malformed = createUploadPage(dependencies);
  assert(malformed.render().includes('value="text" selected') && errors.length === 1,"Corrupt storage uses default controls and reports the problem.");
  const unavailable = createUploadPage({...dependencies,storage:{getItem:()=>{throw new Error("denied");},setItem:()=>{throw new Error("denied");}}});
  await unavailable.select("pdf");
  assert(errors.length === 3 && unavailable.render().includes('value="pdf" selected'),"Unavailable storage reports failed reads and writes while controls remain usable.");
});
