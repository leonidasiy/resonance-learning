import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import {D1AgentMemoryRepository} from '../worker/knowledge-workflow-agents-d1.js';

test('agent memory reads use owner indexes and exclude unrelated owner history',async()=>{
 const db=new DatabaseSync(':memory:'),plans=[];
 try{
  db.exec(await readFile('worker/migrations/0008_knowledge_workflows.sql','utf8'));
  db.exec('PRAGMA foreign_keys=OFF');
  const database={prepare(sql){let values=[];return {bind(...bound){values=bound;return this;},first:async()=>{plans.push(...db.prepare('EXPLAIN QUERY PLAN '+sql).all(...values));return db.prepare(sql).get(...values)??null;},all:async()=>{plans.push(...db.prepare('EXPLAIN QUERY PLAN '+sql).all(...values));return {success:true,results:db.prepare(sql).all(...values)};},run:async()=>({success:true,meta:{changes:Number(db.prepare(sql).run(...values).changes)}})};},batch:async()=>[]};
  const memory=new D1AgentMemoryRepository({database,logger:()=>{}}),stamp='2026-10-28T00:00:00Z';
  for(const ownerId of ['owner-a','owner-b'])await memory.createNamespace({id:'same-namespace',ownerId,runId:'run',role:'knowledge-scraper',mode:'enabled',humanApprovalId:null,createdAt:stamp});
  const record={id:'record',namespaceId:'same-namespace',kind:'working-memory',visibility:'private',retention:'run',integrityVersion:1,sourceEventId:'event',occurredAt:stamp,payload:{fixture:true}};
  await memory.appendRecord({...record,id:'other-owner'},'owner-a');
  await memory.appendRecord(record,'owner-b');
  assert.equal((await memory.findNamespace('same-namespace','owner-b')).ownerId,'owner-b');
  assert.deepEqual((await memory.listRecords('same-namespace','owner-b')).map(r=>r.id),['record']);
  assert(plans.every(plan=>!/^SCAN /u.test(plan.detail)),JSON.stringify(plans));
 }finally{db.close();}
});
