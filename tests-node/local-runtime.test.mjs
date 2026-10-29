import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, mkdir, readFile, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {fileURLToPath} from 'node:url';
import { createDatabase, openLocalDatabase, createFileBucket } from '../local/storage.mjs';
import { createLocalWorkflows } from '../local/workflows.mjs';
import { createLocalApplication } from '../local/application.mjs';
import { createKnowledgeWorkflowService } from '../src/features/knowledge-workflows/workflow.js';
import { D1KnowledgeWorkflowRepository } from '../worker/knowledge-workflow-d1.js';
import { createCloudflareImageDerivative } from '../worker/knowledge-workflow-media-transform.js';
import { localImages } from '../local/images.mjs';
import sharp from 'sharp';
import {sourceRightsProfileFor} from '../worker/source-rights-profiles.js';
import {createLocalPipelineFixtureProvider,publishOwnedTextFixture} from './fixtures/local-pipeline.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const password='synthetic-local-password-for-tests';
const origin='http://127.0.0.1:8787';
async function temporary(work){const path=await mkdtemp(join(tmpdir(),'resonance-local-'));try{return await work(path);}finally{await rm(path,{recursive:true,force:true});}}
async function waitFor(check){for(let i=0;i<500;i++){const value=await check();if(value)return value;await new Promise(resolve=>setTimeout(resolve,10));}throw new Error('Synthetic local state did not settle.');}
function request(path,options={}) {return new Request(origin+path,{...options,headers:{host:'127.0.0.1:8787',...options.headers}});}
async function login(application,custom=password){const result=await application.fetch(request('/local/login',{method:'POST',headers:{origin},body:new URLSearchParams({password:custom})}));assert.equal(result.status,303);return result.headers.get('set-cookie').split(';')[0];}

test('computer database applies checked-in migrations once, resumes seed, and rolls back D1 batches',()=>temporary(async directory=>{
  const path=join(directory,'db.sqlite');
  let database=await openLocalDatabase(path,root);
  assert.equal(database.sqlite.prepare('SELECT COUNT(*) count FROM local_migrations').get().count,31);
  assert.equal(database.sqlite.prepare('SELECT COUNT(*) count FROM interest_areas').get().count,1);
  database.sqlite.prepare("DELETE FROM local_migrations WHERE name='seed:self-host'").run();
  database.sqlite.prepare('DELETE FROM interest_areas').run();
  database.close();
  database=await openLocalDatabase(path,root);
  assert.equal(database.sqlite.prepare('SELECT COUNT(*) count FROM interest_areas').get().count,1);
  database.sqlite.exec('CREATE TABLE fixture (id TEXT PRIMARY KEY) STRICT');
  await assert.rejects(database.batch([database.prepare('INSERT INTO fixture VALUES (?)').bind('a'),database.prepare('INSERT INTO fixture VALUES (?)').bind('a')]));
  assert.equal((await database.prepare('SELECT COUNT(*) count FROM fixture').first()).count,0);
  database.sqlite.prepare("UPDATE interest_areas SET label='My edited interest'").run();database.close();
  database=await openLocalDatabase(path,root);
  assert.equal((await database.prepare('SELECT label FROM interest_areas').first()).label,'My edited interest');
  database.close();
}));

test('computer setup refuses foreign databases and changed migration history',()=>temporary(async directory=>{
  const path=join(directory,'db.sqlite');let database=createDatabase(path);database.sqlite.exec('CREATE TABLE unrelated(id TEXT)');database.close();
  await assert.rejects(openLocalDatabase(path,root),/not created by computer setup/u);
  const owned=join(directory,'owned.sqlite');database=await openLocalDatabase(owned,root);database.sqlite.prepare("UPDATE local_migrations SET digest='changed' WHERE name LIKE '0001_%'").run();database.close();
  await assert.rejects(openLocalDatabase(owned,root),/Applied migration changed/u);
}));

test('private filesystem bucket preserves bytes and metadata across restart and never uses keys as paths',()=>temporary(async directory=>{
  let database=createDatabase(join(directory,'db.sqlite'));
  let bucket=await createFileBucket(join(directory,'objects'),database);
  await bucket.put('../../outside',new Uint8Array([0,1,255]),{httpMetadata:{contentType:'image/png'},customMetadata:{owner:'fixture-owner'}});
  database.close();database=createDatabase(join(directory,'db.sqlite'));bucket=await createFileBucket(join(directory,'objects'),database);
  const value=await bucket.get('../../outside');assert.deepEqual(new Uint8Array(await value.arrayBuffer()),new Uint8Array([0,1,255]));assert.equal(value.customMetadata.owner,'fixture-owner');assert.equal(value.httpMetadata.contentType,'image/png');
  assert.deepEqual((await bucket.list()).objects.map(v=>v.key),['../../outside']);
  await bucket.delete('../../outside');assert.equal(await bucket.get('../../outside'),null);database.close();
}));

test('local workflow persists a consent wait, consumes a queued event after restart, and replays successful steps once',()=>temporary(async directory=>{
  const database=createDatabase(join(directory,'db.sqlite'));let first=0,second=0;
  const execute=async(event,step)=>{const value=await step.do('first',async()=>{first++;return event.payload.value;});const approved=await step.waitForEvent('consent',{type:'rights-approved',timeout:'24 hours'});await step.do('second',async()=>{second++;return null;});return {value,approved};};
  let workflows=createLocalWorkflows({database,execute,logger:()=>{}});
  let instance=await workflows.create({id:'fixture',params:{value:42}});await waitFor(async()=> (await instance.status()).status==='waiting');await workflows.close();
  workflows=createLocalWorkflows({database,execute,logger:()=>{}});instance=await workflows.get('fixture');workflows.restore();
  await instance.sendEvent({type:'rights-approved',payload:{approved:true}});
  await waitFor(async()=> (await instance.status()).status==='complete');
  assert.deepEqual((await instance.status()).output,{value:42,approved:{approved:true}});assert.equal(first,1);assert.equal(second,1);
  await workflows.close();database.close();
}));

test('local workflow restores paused waits and interrupted executions without silently reissuing work',()=>temporary(async directory=>{
  const database=createDatabase(join(directory,'db.sqlite'));
  let workflows=createLocalWorkflows({database,execute:async(_event,step)=>{await step.sleepUntil('later',new Date(Date.now()+3_600_000));return 'done';},logger:()=>{}});
  let instance=await workflows.create({id:'paused',params:{}});await waitFor(async()=> (await instance.status()).status==='waiting');await instance.pause();await workflows.close();
  database.sqlite.prepare("INSERT INTO local_workflows(id,payload,status) VALUES('interrupted','{}','running')").run();
  workflows=createLocalWorkflows({database,execute:async()=>assert.fail('Interrupted or paused work must not run at restore.'),logger:()=>{}});workflows.restore();
  assert.equal((await (await workflows.get('paused')).status()).status,'paused');assert.equal((await (await workflows.get('interrupted')).status()).status,'errored');
  await workflows.close();database.close();
}));

test('computer gateway authenticates real APIs with generated assertions and rejects foreign origins, hosts, stale sessions and oversized login bodies',()=>temporary(async directory=>{
  let calls=0;
  const create=custom=>createLocalApplication({root,dataDirectory:directory,password:custom??password,fetch:async()=>{calls++;throw new Error('Fixture never uses external services');},logger:()=>{}});
  let application=await create();
  assert.equal((await application.fetch(request('/api/learning-generation/progress?days=7&subject='))).status,401);
  assert.equal((await application.fetch(new Request(origin+'/local/login',{headers:{host:'evil.invalid'}}))).status,403);
  assert.equal((await application.fetch(request('/local/login',{method:'POST',headers:{origin:'https://evil.invalid'},body:'password=x'}))).status,403);
  assert.equal((await application.fetch(request('/local/login',{method:'POST',headers:{origin},body:'x'.repeat(4097)}))).status,413);
  const cookie=await login(application);
  assert.equal((await application.fetch(request('/api/learning-generation/progress?days=7',{headers:{cookie,origin:'https://evil.invalid'}}))).status,403);
  const progress=await application.fetch(request('/api/learning-generation/progress?days=7',{headers:{cookie}}));assert.equal(progress.status,200,await progress.clone().text());
  const body=await progress.json();assert.equal(body.result.attempts.count,0);
  assert.equal(application.environment.REMINDER_PUSH_ORIGINS,'["https://fcm.googleapis.com"]');
  await application.start();await application.close();
  application=await create(password+'-rotated');
  assert.equal((await application.fetch(request('/api/learning-generation/progress?days=7',{headers:{cookie}}))).status,401);
  await login(application,password+'-rotated');await application.close();assert.equal(calls,0);
}));

test('phone private HTTPS origin receives Secure sessions; public HTTP configuration and placeholder passwords fail closed',()=>temporary(async directory=>{
  await assert.rejects(createLocalApplication({root,dataDirectory:directory,password:'REPLACE_WITH_A_PASSWORD'}),/unique password/u);
  await assert.rejects(createLocalApplication({root,dataDirectory:directory,password,origin:'http://192.168.1.3:8787'}),/exact private HTTPS/u);
  const application=await createLocalApplication({root,dataDirectory:directory,password,origin:'https://my-computer.example.ts.net',logger:()=>{}});
  const result=await application.fetch(new Request('https://my-computer.example.ts.net/local/login',{method:'POST',headers:{host:'my-computer.example.ts.net',origin:'https://my-computer.example.ts.net'},body:new URLSearchParams({password})}));
  assert.equal(result.status,303);assert.match(result.headers.get('set-cookie'),/; Secure/u);
  const proxied=await application.fetch(new Request('https://my-computer.example.ts.net/local/login',{method:'POST',headers:{host:'127.0.0.1:8787',origin:'https://my-computer.example.ts.net'},body:new URLSearchParams({password})}));
  assert.equal(proxied.status,303);assert.match(proxied.headers.get('set-cookie'),/; Secure/u);await application.close();
}));

test('computer workflow validates canonical role digests and reaches own model boundary through shared executor',()=>temporary(async directory=>{
  const providerCalls=[];
  const application=await createLocalApplication({root,dataDirectory:directory,password,environment:{OPENROUTER_API_KEY:'synthetic-own-key'},fetch:async(input,init)=>{
    providerCalls.push({url:String(input),authorization:new Headers(init?.headers).get('authorization')});return new Response(null,{status:402});
  },logger:()=>{}});
  const service=createKnowledgeWorkflowService(new D1KnowledgeWorkflowRepository({database:application.database,logger:()=>{}}),{now:()=>new Date().toISOString(),createId:()=> 'fixture-run',logger:()=>{}});
  const created=await service.createRun({ownerId:'self-host-owner-v1',sourceId:'fixture-source',sourceRevision:1,canonicalSourceIdentity:'https://viva.pressbooks.pub/openmusictheory/',rightsProfile:sourceRightsProfileFor('https://viva.pressbooks.pub/openmusictheory/'),contentSignature:'fixture',configDigests:JSON.parse(application.environment.KNOWLEDGE_WORKFLOW_CONFIG_DIGESTS),idempotencyKey:'fixture-create'});
  assert.equal(created.ok,true,JSON.stringify(created));
  await application.workflows.create({id:'fixture-run',params:{runId:'fixture-run',ownerId:'self-host-owner-v1'}});
  await waitFor(()=>providerCalls.length>0);
  assert.equal(providerCalls[0].url,'https://openrouter.ai/api/v1/chat/completions');assert.equal(providerCalls[0].authorization,'Bearer synthetic-own-key');
  assert(!providerCalls.some(call=>call.url.includes('lirenleonidas')||call.url.includes('workers.dev')));
  await application.close();
}));

test('computer image binding decodes and emits bounded metadata-free WebP via the shared derivative boundary',async()=>{
  const original=await sharp({create:{width:12,height:10,channels:3,background:'#387099'}}).png().toBuffer();
  const result=await createCloudflareImageDerivative(localImages)({assetId:'fixture',variant:'thumbnail',bytes:original,mediaType:'image/png'});
  assert.equal(result.ok,true);assert.equal(result.value.mediaType,'image/webp');const metadata=await sharp(result.value.bytes).metadata();assert.equal(metadata.width,12);assert.equal(metadata.height,10);assert.equal(metadata.exif,undefined);
  assert.equal((await createCloudflareImageDerivative(localImages)({assetId:'fixture',variant:'thumbnail',bytes:new Uint8Array([1,2,3]),mediaType:'image/png'})).ok,false);
});

for(const compatible of [false,true])test(`${compatible?'Alternate compatible API':'OpenRouter'}: own-text upload completes the local pipeline, publishes paired quizzes, records study/review, and survives restart without external calls`,()=>temporary(async directory=>{
  const chatEndpoint='https://alternate-api.example.test/v1/chat/completions',model='synthetic/alternate-model';
  const {provider,sentences,calls}=createLocalPipelineFixtureProvider(compatible?{chatEndpoint,model}:{});
  let application,cookie,applicationRoot=root;
  if(compatible){
    applicationRoot=join(directory,'configured-project');await mkdir(join(applicationRoot,'agent-config'),{recursive:true});await symlink(join(root,'worker'),join(applicationRoot,'worker'),'dir');
    for(const role of ['rights-assessor','knowledge-scraper','question-generator','question-evaluator']){
      const source=await readFile(join(root,'agent-config',`${role}.yaml`),'utf8');
      await writeFile(join(applicationRoot,'agent-config',`${role}.yaml`),source.replace('provider: openrouter','provider: openai-compatible').replace(/name: [^\n]+/,`name: ${model}`));
    }
  }
  const create=()=>createLocalApplication({root:applicationRoot,dataDirectory:join(directory,'data'),password,environment:compatible?{LLM_API_KEY:'synthetic-own-key',LLM_CHAT_ENDPOINT:chatEndpoint,LLM_MODEL:model,LLM_GRADING_MODEL:model}:{OPENROUTER_API_KEY:'synthetic-own-key'},fetch:provider,logger:()=>{}});
  const api=async(path,body)=>{const response=await application.fetch(request(path,{method:body===undefined?'GET':'POST',headers:{cookie,...(body===undefined?{}:{origin,'content-type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)}));const result=await response.json();assert.equal(response.status,200,`${path}: ${JSON.stringify(result)}`);return result.result;};
  try{
    application=await create();cookie=await login(application);
    await publishOwnedTextFixture({application,api,sentences});
    const day=new Date().toISOString().slice(0,10),feed=await api(`/api/learning-generation/feed-batch?day=${day}`);
    assert.equal(feed.items.length,5);
    await api('/api/learning-generation/feed-batch/complete',{batchId:feed.batch.batchId,idempotencyKey:'fixture-study-owned'});
    const review=await api(`/api/learning-generation/review-batch?day=${day}`),question=review.questions.find(question=>question.kind!=='fill-blank');
    assert(question,'The paired quiz batch includes a choice variant.');
    await api('/api/learning-generation/review-batch/answer',{batchId:review.batch.batchId,questionId:question.questionId,questionRevision:question.revision,selectedChoiceIds:['choice-a'],idempotencyKey:'fixture-answer-owned'});
    if(compatible){
      const blank=review.questions.find(question=>question.kind==='fill-blank');assert(blank);
      await api('/api/learning-generation/review-batch/answer',{batchId:review.batch.batchId,questionId:blank.questionId,questionRevision:blank.revision,selectedChoiceIds:[],blankAnswers:[{id:blank.blanks[0].id,text:'the fixture'}],idempotencyKey:'fixture-semantic-answer'});
    }
    const expected=compatible?2:1,progress=await api('/api/learning-generation/progress?days=7');
    assert.equal(progress.attempts.count,expected);assert.equal(progress.attempts.correct,expected);
    assert.equal(progress.activity.at(-1).studyItems,5);assert.equal(progress.activity.at(-1).studyBatches,1);assert.equal(progress.activity.at(-1).reviewAttempts,expected);
    const callsBefore=calls();
    await application.close();application=await create();cookie=await login(application);
    assert.deepEqual(await api('/api/learning-generation/progress?days=7'),progress);
    assert.equal(calls(),callsBefore,'Reading saved progress after restart makes no provider calls.');
  }finally{await application?.close();}
}));
