import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile,readdir} from 'node:fs/promises';
import {imageHash} from '../worker/webpage-images.js';
import {loadMaterialImages,openMaterialImages,materialImageObjectKeys} from '../worker/material-image-cache.js';
import {D1WorkflowStageRepository} from '../worker/knowledge-workflow-stages-d1.js';
import {createMaterialImageContentStore} from '../worker/material-image-content.js';
import {createKnowledgeWorkflowCleanup} from '../worker/knowledge-workflow-cleanup.js';
import {embeddedPdf,officeArchive} from '../tests/fixtures/embedded-documents.js';
import {extractMaterialImages} from '../src/features/knowledge-workflows/material.js';
const scope={ownerId:'owner',runId:'run',sourceId:'source',sourceRevision:1},sourceUrl='https://source.example/document',now=()=> '2026-10-28T00:00:00.000Z';
const png=new Uint8Array([137,80,78,71,13,10,26,10]);
const fixtureImages=[1,2].map(n=>({path:`figure-${n}`,url:`${sourceUrl}#figure-${n}`,caption:'Synthetic caption',alt:'Synthetic diagram',context:'Synthetic context',mediaType:'image/png',bytes:png.slice()}));
async function fixture(){
 const db=new DatabaseSync(':memory:');
 for(const name of(await readdir('worker/migrations')).filter(n=>n.endsWith('.sql')).sort())db.exec(await readFile('worker/migrations/'+name,'utf8'));
 db.prepare("INSERT INTO knowledge_workflow_runs(owner_id,run_id,source_id,source_revision,canonical_source_identity,content_signature,state,revision,idempotency_key,config_digests_json,counts_json,reused,created_at,updated_at,run_json)VALUES(?,?,?,?,?,?,'extraction-loop',1,'key','{}','{}',0,'now','now','{}')").run(scope.ownerId,scope.runId,scope.sourceId,1,sourceUrl,'hash');
 db.prepare('INSERT INTO source_r2_account_capacity VALUES (?,0,?,?)').run('account',now(),now());
 const database={prepare(sql){let values=[];return {bind(...v){values=v;return this;},first:async()=>db.prepare(sql).get(...values)??null,all:async()=>({success:true,results:db.prepare(sql).all(...values)}),run:async()=>({success:true,meta:{changes:Number(db.prepare(sql).run(...values).changes)}})};},async batch(statements){db.exec('BEGIN IMMEDIATE');try{const results=[];for(const statement of statements)results.push(await statement.run());db.exec('COMMIT');return results;}catch(error){db.exec('ROLLBACK');throw error;}}};
 const objects=new Map(),logs=[];let puts=0,putHook,putFailure=false;
 const bucket={async put(key,bytes,options){puts++;if(putHook)await putHook(key);if(putFailure)throw Error('Synthetic interrupted private write');objects.set(key,{bytes:bytes.slice(),customMetadata:options.customMetadata});},async get(key){const object=objects.get(key);return object?{customMetadata:object.customMetadata,arrayBuffer:async()=>object.bytes.slice().buffer}:null;},async delete(key){objects.delete(key);}};
 let reservation=0;
 const store=createMaterialImageContentStore({database,bucket,ownerId:scope.ownerId,now,createId:()=>`reservation-${++reservation}`,policy:{accountScope:'account',storedBytesLimit:1024*1024*10,classAMonthlyLimit:1000,classBMonthlyLimit:1000,observationMaximumAgeMs:60000}});
 const stages=()=>new D1WorkflowStageRepository({database,now,logger:e=>logs.push(e)});
 const bytes=new TextEncoder().encode('Synthetic uploaded original');
 const material={...scope,sourceUrl,mediaType:'application/pdf',fileName:'synthetic.pdf',mode:'text',contentDigest:await imageHash(bytes),sections:[{id:'page',title:'Synthetic',text:'Synthetic original text',locator:'page:1'}],media:[],provenance:{kind:'authorized-user-material',attestationReference:'synthetic',basis:'test-owned',processingAllowed:true}};
 let extractions=0;
 const extract=async()=>{extractions++;return {ok:true,value:fixtureImages.map(image=>({...image,bytes:image.bytes.slice()}))};};
 const load=(options={})=>loadMaterialImages({scope,material,bytes,database,stages:stages(),store,extract,...options});
 const open=(options={})=>openMaterialImages({scope,material,bytes,database,stages:stages(),store,extract,...options});
 const run={...scope,canonicalSourceIdentity:sourceUrl,state:'extraction-loop'};
 const cleanup=createKnowledgeWorkflowCleanup({database,bucket,materialImageContent:store,now,logger:e=>logs.push(e),workflowRepository:{listBySource:async()=>({ok:true,value:[run]}),invalidateReuse:async()=>({ok:true,value:null}),markAbandoned:async()=>{db.prepare("UPDATE knowledge_workflow_runs SET state='abandoned'").run();return {ok:true,value:null};}}});
 const receipt=()=>JSON.parse(db.prepare("SELECT result_json FROM knowledge_workflow_stages WHERE stage_key GLOB 'material-image-manifest:*'").get().result_json).value;
 return {db,database,objects,material,bytes,load,open,receipt,cleanup,run,extract,store,logs,get puts(){return puts;},get extractions(){return extractions;},set putHook(v){putHook=v;},set putFailure(v){putFailure=v;}};
}

test('opening a replay reads only its validated manifest, then restores only chosen pixels',async()=>{
 const f=await fixture();try{
  const distinct=fixtureImages.map((image,index)=>({...image,bytes:new Uint8Array([...image.bytes,index])}));
  assert((await f.load({extract:async()=>({ok:true,value:distinct})})).ok);
  const keys=await materialImageObjectKeys(f.receipt()),reads=[];
  f.objects.get(keys.images[1]).bytes[0]^=1;
  const store={...f.store,read:async(owner,key)=>{reads.push(key);return f.store.read(owner,key);}};
  const opened=await f.open({store,extract:async()=>assert.fail('Lazy replay must not re-extract')});assert(opened.ok);
  assert.deepEqual(reads,[keys.manifest]);assert.equal(opened.value.images.length,2);
  for(const [index,image] of opened.value.images.entries()){
   const {bytes,...metadata}=distinct[index];assert.deepEqual(image,{...metadata,digest:await imageHash(bytes)});assert(!('bytes'in image));
  }
  assert.deepEqual(await opened.value.read(distinct[0].path),{ok:true,value:distinct[0]});
  assert.deepEqual(reads,[keys.manifest,keys.images[0]]);
  assert.deepEqual(await opened.value.read(distinct[0].path),{ok:true,value:distinct[0]});
  assert.deepEqual(reads,[keys.manifest,keys.images[0]],'One inventory reuses verified originals');
  assert.deepEqual(await opened.value.read(distinct[1].path),{ok:false,error:{kind:'MaterialImageCacheBytesChanged'}});
  assert.deepEqual(reads,[keys.manifest,keys.images[0],keys.images[1]]);
  assert.equal((await opened.value.read('unknown-path')).error.kind,'MaterialImageCacheMissing');
 }finally{f.db.close();}
});

test('fresh inventories reuse extracted pixels and lazy reads honor abandonment before storage access',async()=>{
 const f=await fixture();try{
  const reads=[],store={...f.store,read:async(owner,key)=>{reads.push(key);return f.store.read(owner,key);}};
  const opened=await f.open({store});assert(opened.ok);reads.length=0;
  const first=await opened.value.read(fixtureImages[0].path);assert.deepEqual(first,{ok:true,value:fixtureImages[0]});assert.deepEqual(reads,[]);
  first.value.bytes[0]=0;assert.deepEqual(await opened.value.read(fixtureImages[0].path),{ok:true,value:fixtureImages[0]});
  assert((await f.cleanup.abandonRun({run:f.run,reason:'cancelled'})).ok);
  assert.deepEqual(await opened.value.read(fixtureImages[1].path),{ok:false,error:{kind:'MaterialImageCacheUnavailable'}});assert.deepEqual(reads,[]);
 }finally{f.db.close();}
});

test('restart restores complete independent image inventory, preserving private metadata and exact bytes without re-extraction',async()=>{
 const f=await fixture();try{
  assert.deepEqual((await f.load()).value,fixtureImages);assert.equal(f.extractions,1);assert.equal(f.puts,2,'Identical originals store once, plus one metadata manifest');
  const rows=f.db.prepare('SELECT * FROM knowledge_workflow_stages').all(),journal=JSON.stringify(rows);
  assert(!journal.includes('Synthetic caption'));assert(!journal.includes('Synthetic context'));assert(!journal.includes('base64'));assert(!journal.includes('137,80'));
  const writes=f.db.prepare("SELECT COUNT(*) n FROM source_r2_reservations WHERE operation='write' AND outcome='completed'").get().n;assert.equal(writes,2);
  const restored=await f.load({extract:async()=>assert.fail('Successful restart must skip the PDF/PPTX parser')});assert(restored.ok);assert.deepEqual(restored.value,fixtureImages);
  restored.value[0].bytes[0]=0;assert.deepEqual((await f.load()).value,fixtureImages);assert.equal(f.puts,2);assert.equal(f.extractions,1);
  assert.deepEqual(f.db.prepare('SELECT * FROM knowledge_workflow_stages').all(),rows);
  assert.equal(f.db.prepare('SELECT stored_bytes FROM source_r2_account_capacity').get().stored_bytes,[...f.objects.values()].reduce((sum,o)=>sum+o.bytes.length,0));
 }finally{f.db.close();}
});

test('real PDF/PPTX parsers resume exact originals and selected PDF text never restores broader images',async()=>{
 for(const format of ['pdf','pptx']){const f=await fixture();try{
  const bytes=format==='pdf'?embeddedPdf():officeArchive([{name:'ppt/media/image1.png',bytes:png},{name:'ppt/media/image2.png',bytes:png}]);
  const material={...f.material,mediaType:format==='pdf'?'application/pdf':'application/vnd.openxmlformats-officedocument.presentationml.presentation',contentDigest:await imageHash(bytes)};
  const expected=await extractMaterialImages(material,bytes);assert(expected.ok);assert(expected.value.length>0);
  const first=await f.load({material,bytes,extract:extractMaterialImages});assert.deepEqual(first,expected);
  assert.deepEqual(await f.load({material,bytes,extract:async()=>assert.fail('Do not repeat actual document parsing')}),expected);
  const selected={...material,sections:[{...material.sections[0],locator:'pdf:page=1;selection=synthetic'}]};
  assert.deepEqual(await f.load({material:selected,bytes,extract:extractMaterialImages}),{ok:true,value:[]});
 }finally{f.db.close();}}
});

test('foreign scopes, changed source input, corrupt manifests and originals cannot replay cached images',async()=>{
 for(const variant of ['owner','run','source','revision','input','manifest','original','receipt']){const f=await fixture();try{
  assert((await f.load()).ok);const receipt=f.receipt(),keys=await materialImageObjectKeys(receipt);let options={extract:async()=>assert.fail('Untrusted cache must not re-extract')};
  if(['owner','run','source','revision'].includes(variant)){const fields={owner:'ownerId',run:'runId',source:'sourceId',revision:'sourceRevision'};options.scope={...scope,[fields[variant]]:variant==='revision'?2:'foreign'};}
  if(variant==='input')options.bytes=new Uint8Array([1]);
  if(variant==='manifest')f.objects.get(keys.manifest).bytes[0]^=1;
  if(variant==='original')f.objects.get(keys.images[0]).bytes[0]^=1;
  if(variant==='receipt'){receipt.images[0].digest='foreign-key';f.db.prepare('UPDATE knowledge_workflow_stages SET result_json=?').run(JSON.stringify({ok:true,value:receipt}));}
  const result=await f.load(options);assert.equal(result.ok,false,variant);assert.equal(f.puts,2);
  if(variant==='receipt'){assert.equal((await f.cleanup.abandonRun({run:f.run,reason:'cancelled'})).ok,false);assert.equal(f.objects.size,2,'Invalid receipts never delete arbitrary private objects');}
 }finally{f.db.close();}}
});

test('interrupted writes keep hash-only intent, enforce quota, and recover the same deterministic extraction',async()=>{
 const f=await fixture();try{
  f.putFailure=true;const first=await f.load();assert.equal(first.ok,false);assert.equal(first.error.kind,'R2CapacityUsageUncertain');assert(f.receipt());assert.equal(f.objects.size,0);
  f.putFailure=false;const halted=await f.load();assert.equal(halted.ok,false);assert.equal(halted.error.kind,'R2CapacityUsageUncertain');assert.equal(f.puts,1,'Unknown historical R2 accounting is never bypassed');
 }finally{f.db.close();}
 const g=await fixture();try{
  let stopped=false;const store={...g.store,stage:async command=>{if(!stopped){stopped=true;return {ok:false,error:{kind:'SyntheticNotStarted'}};}return g.store.stage(command);}};
  assert.equal((await g.load({store})).error.kind,'SyntheticNotStarted');assert(g.receipt());assert.equal(g.puts,0);
  assert((await g.load()).ok);assert.equal(g.extractions,2);assert.equal(g.puts,2,'Known not-started storage resumes from the same journaled extraction');
 }finally{g.db.close();}
});

test('existing account capacity denies new cache storage before any physical R2 write',async()=>{
 const f=await fixture();try{
  f.db.prepare('UPDATE source_r2_account_capacity SET stored_bytes=?').run(10485760);
  const result=await f.load();assert.equal(result.ok,false);assert.equal(result.error.kind,'R2StorageCapacityExceeded');assert.equal(f.puts,0);assert.equal(f.objects.size,0);assert(f.receipt());
 }finally{f.db.close();}
});

test('abandonment deletes all cache objects with accounted removal and retains noncontent receipts for late-write cleanup',async()=>{
 const f=await fixture();try{
  assert((await f.load()).ok);const receipt=f.receipt();assert((await f.cleanup.abandonRun({run:f.run,reason:'cancelled'})).ok);assert.equal(f.objects.size,0);assert.deepEqual(f.receipt(),receipt);
  assert.equal(f.db.prepare('SELECT stored_bytes FROM source_r2_account_capacity').get().stored_bytes,0);
  assert.equal((await f.load()).error.kind,'MaterialImageCacheUnavailable');assert.equal(f.extractions,1);
 }finally{f.db.close();}
 const g=await fixture();try{
  let release,started;const pending=new Promise(r=>release=r),entered=new Promise(r=>started=r);g.putHook=async()=>{started();await pending;};
  const loading=g.load();await entered;assert(g.receipt(),'Intent precedes any private object write');
  assert.equal((await g.cleanup.abandonRun({run:g.run,reason:'cancelled'})).ok,false,'Pending R2 capacity is preserved until its write settles');release();assert.equal((await loading).ok,false);assert.equal(g.objects.size,0);
  assert((await g.cleanup.abandonRun({run:g.run,reason:'cancelled'})).ok);assert.equal(g.objects.size,0);
 }finally{g.db.close();}
});
