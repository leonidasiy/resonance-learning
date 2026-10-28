import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import {D1AgentMemoryRepository} from '../worker/knowledge-workflow-agents-d1.js';
import {createAgentMemoryStore} from '../src/features/knowledge-workflows/memory.js';
import {createAgentConfigurationLoader} from '../src/features/knowledge-workflows/config.js';
import {createContextCompactor} from '../src/features/knowledge-workflows/context.js';
import {createKnowledgeWorkflowAgentRuntime} from '../worker/knowledge-workflow-agent-runtime.js';

const stamp='2026-10-28T00:00:00.000Z',roles=['rights-assessor','knowledge-scraper','question-generator','question-evaluator'];
const loader=createAgentConfigurationLoader({sha256:async input=>`sha256:fixture-${input.length}`});
const snapshots=Object.fromEntries(await Promise.all(roles.map(async role=>{
 const result=await loader.load({source:await readFile(new URL(`../agent-config/${role}.yaml`,import.meta.url),'utf8'),expectedRole:role});
 assert(result.ok);return [role,result.value];
})));
async function fixture(projected=true){
 const db=new DatabaseSync(':memory:');db.exec(await readFile(new URL('../worker/migrations/0008_knowledge_workflows.sql',import.meta.url),'utf8'));db.exec('PRAGMA foreign_keys=OFF');
 const transfers=[],queries=[];
 const database={prepare(sql){let values=[];queries.push(sql);return {bind(...v){values=v;return this;},first:async()=>db.prepare(sql).get(...values)??null,all:async()=>{const results=db.prepare(sql).all(...values);transfers.push(Buffer.byteLength(JSON.stringify(results)));return {success:true,results};},run:async()=>({success:true,meta:{changes:Number(db.prepare(sql).run(...values).changes)}})};},batch:async()=>[]};
 const repository=new D1AgentMemoryRepository({database,logger:()=>{}});
 if(!projected)repository.listContextRecords=undefined;
 const memory=createAgentMemoryStore({repository,now:()=>stamp,logger:()=>{}});
 const created=await memory.createNamespace({ownerId:'owner',runId:'run',role:'question-evaluator'});assert(created.ok);const namespace=created.value;
 const envelope=payload=>({visibility:'private',retention:'run',integrityVersion:1,sourceEventId:'event',payload});
 function raw(id,stored,kind='working-memory',namespaceId=namespace.id,ownerId='owner'){
  db.prepare('INSERT INTO agent_memory_records (owner_id,namespace_id,record_id,kind,payload_json,occurred_at) VALUES (?,?,?,?,?,?)').run(ownerId,namespaceId,id,kind,typeof stored==='string'?stored:JSON.stringify(stored),stamp);
 }
 function seed(id,payload,kind='working-memory'){raw(id,{...envelope(payload),sourceEventId:`event:${id}`},kind);}
 return {db,repository,memory,namespace,seed,raw,envelope,transfers,queries};
}
async function request(f,thresholdTokens=500000){
 const calls=[],contexts=[];
 const compactor=createContextCompactor({now:()=>stamp,digest:value=>`digest:${value.length}`,appendRecord:async()=>null,logger:()=>{}});
 const runtime=createKnowledgeWorkflowAgentRuntime({memory:f.memory,configSnapshots:Object.fromEntries(roles.map(r=>[r,{...snapshots[r],limits:{...snapshots[r].limits,compactionThresholdTokens:thresholdTokens}}])),now:()=>stamp,logger:()=>{},eventLedger:{append:async()=>null},
  compactor:{compact:async command=>{contexts.push(structuredClone({...command,summarize:undefined}));return compactor.compact(command);}},
  model:{generate:async command=>{calls.push(command);return {ok:true,value:{output:command.input.operation==='compact-working-context'?{summary:'fixture summary'}:{answer:'fixture answer'},requestId:'fixture',reasoningTrace:null,inputTokens:1,outputTokens:1}};}}});
 const result=await runtime.run({ownerId:'owner',runId:'run',role:'question-evaluator',taskId:'fixture',systemPrompt:'fixture',input:{question:'fixture'},maxOutputTokens:16});
 return {result,calls,contexts};
}
function seedMixed(f){
 f.seed('01',{role:'question-evaluator',usage:{costNanodollars:900},configDigest:'config',inputDigest:'digest',notes:null});
 f.seed('02',{role:'question-evaluator',configDigest:'config',inputDigest:'digest',usage:{requestId:'synthetic'},notes:'\uD834\uDD1E 中文 \ud800 \udc00 '+ 'x'.repeat(3100),ignored:'retained unknown field'});
 f.seed('03',{output:{notes:'legacy notes',unused:'keep legacy output'}});
 f.seed('04',{output:{pages:[{notes:'first 🎵'},{notes:42},{notes:'second\ud800'}]}});
 f.seed('05',{type:'compacted-context',summary:'summary',tokenEstimate:3,coveredRecordIds:['01'],coveredEventIds:['event:01']});
 f.seed('06',{sourceText:'synthetic exact durable facts'},'durable-fact');
 f.seed('07',{notes:{malformed:true},type:['malformed'],unused:'ignored'});
 f.seed('08',{output:null,notes:'legacy presence preserved'});
 f.seed('09',null);f.seed('10',['unusual payload']);
 f.raw('foreign',f.envelope({notes:'must not appear'}),'working-memory',f.namespace.id,'another-owner');
 f.raw('foreign-namespace',f.envelope({notes:'must not appear'}),'working-memory','another-namespace');
}

test('real SQLite projection retains all ordered headers, raw Unicode, full history, legacy and compaction payloads',async()=>{
 const f=await fixture();try{
  seedMixed(f);const full=await f.repository.listRecords(f.namespace.id,'owner'),projected=await f.repository.listContextRecords(f.namespace.id,'owner');
  assert.deepEqual(projected.map(({payload,...header})=>header),full.map(({payload,...header})=>header));
  assert.deepEqual(projected.find(r=>r.id==='01').payload,{notes:null});
  assert.deepEqual(projected.find(r=>r.id==='02').payload,{notes:full.find(r=>r.id==='02').payload.notes,ignored:'retained unknown field'});
  for(const id of ['03','04','05','08','09','10'])assert.deepEqual(projected.find(r=>r.id===id),full.find(r=>r.id===id));
  assert.equal(full.find(r=>r.id==='06').payload.sourceText,'synthetic exact durable facts');
  assert.deepEqual(projected.find(r=>r.id==='06').payload,full.find(r=>r.id==='06').payload);
  assert(f.transfers.at(-1)<f.transfers.at(-2));
 }finally{f.db.close();}
});
for(const threshold of [500000,1])test(`runtime projection and repository fallback preserve exact model/compactor inputs at threshold ${threshold}`,async()=>{
 const full=await fixture(false),projected=await fixture();try{
  seedMixed(full);seedMixed(projected);
  assert.deepEqual(await request(projected,threshold),await request(full,threshold));
 }finally{full.db.close();projected.db.close();}
});

test('malformed envelopes, missing payloads and malformed JSON retain typed persistence failures',async()=>{
 for(const raw of ['{bad',{},[],{visibility:'private',retention:'run',integrityVersion:1,sourceEventId:'event'},
  {visibility:'private',retention:'run',integrityVersion:true,sourceEventId:'event',payload:{notes:'x'}},
  {visibility:null,retention:'run',integrityVersion:1,sourceEventId:'event',payload:{role:'question-evaluator',configDigest:'config',inputDigest:'digest',notes:null,usage:{}}},
  {visibility:'private',retention:'run',integrityVersion:1,sourceEventId:0,payload:{}}]){
  const a=await fixture(false),b=await fixture();try{a.db.exec('PRAGMA ignore_check_constraints=ON');b.db.exec('PRAGMA ignore_check_constraints=ON');a.raw('bad',raw);b.raw('bad',raw);
   assert.deepEqual(await b.memory.listContextRecords(b.namespace),await a.memory.listRecords(a.namespace));
   assert.deepEqual((await request(b)).result,(await request(a)).result);
  }finally{a.db.close();b.db.close();}
 }
});

test('invalid compaction coverage and events are rejected identically without model dispatch',async()=>{
 for(const patch of [{coveredRecordIds:['missing']},{coveredRecordIds:['01','01']},{coveredRecordIds:['05']},{coveredEventIds:['wrong']},{coveredRecordIds:['06']},{summary:3},{coveredEventIds:[null]}]){
  const a=await fixture(false),b=await fixture();try{for(const f of [a,b]){seedMixed(f);f.db.prepare('DELETE FROM agent_memory_records WHERE record_id=?').run('05');f.seed('05',{type:'compacted-context',summary:'summary',coveredRecordIds:['01'],coveredEventIds:['event:01'],...patch});}
   const actual=await request(b),expected=await request(a);assert.deepEqual(actual,expected);assert.equal(actual.result.ok,false);assert.equal(actual.calls.length,0);
  }finally{a.db.close();b.db.close();}
 }
});

test('duplicate JSON keys retain last-key behavior and escaped compacted types remain complete',async()=>{
 const a=await fixture(false),b=await fixture();try{for(const f of [a,b]){
  f.raw('01','{"visibility":"private","retention":"run","integrityVersion":1,"sourceEventId":"event:01","payload":{"role":"question-evaluator","configDigest":"config","inputDigest":"digest","usage":{},"notes":"first","notes":"last"}}');
  f.raw('02','{"visibility":"private","retention":"run","integrityVersion":1,"sourceEventId":"event:02","payload":{},"payload":{"notes":"last payload"}}');
  f.raw('03','{"visibility":"private","retention":"run","integrityVersion":1,"sourceEventId":"event:03","payload":{"type":"\\u0063ompacted-context","summary":"summary","coveredRecordIds":["01"],"coveredEventIds":["event:01"]}}');
 }
 assert.deepEqual(await request(b),await request(a));
 }finally{a.db.close();b.db.close();}
});

test('context retrieval enforces namespace isolation and falls back for existing repositories',async()=>{
 const f=await fixture(false);try{f.seed('01',{notes:'keep'});
  assert.deepEqual(await f.memory.listContextRecords(f.namespace),await f.memory.listRecords(f.namespace));
  assert.deepEqual(await f.memory.listContextRecords({...f.namespace,ownerId:'another-owner'}),{ok:false,error:{kind:'AgentMemoryIsolationViolation'}});
 }finally{f.db.close();}
});

test('runtime rejects foreign namespace records from either context or full-history ports',async()=>{
 for(const projected of [false,true]){const f=await fixture(projected);try{
  const full=f.memory;
  const read=async()=>({ok:true,value:[{id:'foreign',namespaceId:'another-namespace',kind:'working-memory',sourceEventId:'foreign-event',payload:{notes:'synthetic'}}]});
  f.memory={...full,listRecords:read,listContextRecords:projected?read:undefined};
  const result=await request(f);assert.deepEqual(result.result,{ok:false,error:{kind:'AgentMemoryIsolationViolation'}});assert.equal(result.calls.length,0);
 }finally{f.db.close();}}
});

const shapes={evaluator:[['working-memory',519,356260,28]],generator:[['working-memory',155,96959,0]],scraper:[['decision',28,318546,0],['durable-fact',187,783284,0],['unresolved',54,37221,0],['working-memory',83,69271,27]]};
async function shapedFixture(shape){
 const f=await fixture();let sequence=0;
 for(const [kind,count,bytes,notes] of shape)for(let i=0;i<count;i++){
  const id=`synthetic-${String(sequence++).padStart(4,'0')}`;
  const payload=kind==='working-memory'?{role:'question-evaluator',configDigest:'sha256:synthetic-config',inputDigest:'sha256:runtime-00000000',notes:i<notes?`synthetic note ${i}`:null,usage:{requestId:'synthetic-receipt',inputTokens:1000,outputTokens:100,costNanodollars:1000}}:{syntheticFact:'synthetic retained fact'};
  const stored={...f.envelope(payload),sourceEventId:`event:${id}`},target=Math.floor(bytes/count)+(i<bytes%count?1:0);
  const padding=kind==='working-memory'?payload.usage:payload;
  padding.padding='';padding.padding='x'.repeat(Math.max(0,target-Buffer.byteLength(JSON.stringify(stored))));
  f.raw(id,stored,kind);
 }
 return f;
}
async function wires(f){
 const rows=[];
 for(const projected of [false,true]){
  const query=projected?(await f.repository.listContextRecords(f.namespace.id,'owner'),f.queries.at(-1)):'SELECT namespace_id, record_id, kind, payload_json, occurred_at FROM agent_memory_records WHERE owner_id = ? AND namespace_id = ? ORDER BY occurred_at, record_id';
  rows.push(JSON.stringify(f.db.prepare(query).all('owner',f.namespace.id)));
 }
 return rows;
}
function replayFixture(f,wire){
 // SQLite/D1 server work is excluded: represent its response as serialized JSON.
 const repository=new D1AgentMemoryRepository({database:{prepare(){return {bind(){return this;},all:async()=>({success:true,results:JSON.parse(wire)})};},batch:async()=>[]},logger:()=>{}});
 repository.findNamespace=async()=>f.namespace;repository.appendRecord=async()=>null;
 return {memory:createAgentMemoryStore({repository,now:()=>stamp,logger:()=>{}})};
}
for(const [name,shape] of Object.entries(shapes))test(`synthetic ${name} history retains exact requests with reduced D1 response bytes`,async()=>{
 const f=await shapedFixture(shape);try{
  const [full,projected]=await wires(f);
  assert(Buffer.byteLength(projected)<Buffer.byteLength(full));
  assert.deepEqual(await request(replayFixture(f,projected)),await request(replayFixture(f,full)));
 }finally{f.db.close();}
});

test('optional synthetic preparation benchmark', {skip:process.env.RUN_AGENT_MEMORY_PROJECTION_BENCHMARK!=='1'},async()=>{
 const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)],samples=101;
 for(const [name,shape] of Object.entries(shapes)){
  const f=await shapedFixture(shape);try{
   const wire=await wires(f),cpu=[[],[]];
   // Fresh runtime/store each sample; 20 excluded warmups per variant. Alternate order.
   for(let i=-20;i<samples;i++)for(const index of i%2===0?[0,1]:[1,0]){
    const replay=replayFixture(f,wire[index]),start=process.cpuUsage();
    const result=await request(replay);const elapsed=process.cpuUsage(start);assert.equal(result.result.ok,true);
    if(i>=0)cpu[index].push((elapsed.user+elapsed.system)/1000);
   }
   console.log(JSON.stringify({benchmark:'synthetic-agent-preparation',shape:name,samples,warmupPerVariant:20,storedRecords:shape.reduce((n,s)=>n+s[1],0),storedPayloadBytes:shape.reduce((n,s)=>n+s[2],0),responseBytes:wire.map(v=>Buffer.byteLength(v)),medianProcessCpuMs:cpu.map(median),limitations:'Node process CPU; warm engine and fresh runtime; mocked provider; excludes D1 SQL/network; includes response JSON decode, repository hydration and complete agent preparation. Not Cloudflare CPU evidence.'}));
  }finally{f.db.close();}
 }
});

test('optional fresh-process preparation sample',{skip:!process.env.AGENT_MEMORY_PROJECTION_COLD_VARIANT},async()=>{
 const [name,variant]=process.env.AGENT_MEMORY_PROJECTION_COLD_VARIANT.split(':');
 const f=await shapedFixture(shapes[name]);try{
  const wire=(await wires(f))[Number(variant)],replay=replayFixture(f,wire),start=process.cpuUsage();
  const result=await request(replay);const elapsed=process.cpuUsage(start);assert.equal(result.result.ok,true);
  console.log(JSON.stringify({benchmark:'fresh-process-agent-preparation',shape:name,variant:Number(variant),processCpuMs:(elapsed.user+elapsed.system)/1000}));
 }finally{f.db.close();}
});
