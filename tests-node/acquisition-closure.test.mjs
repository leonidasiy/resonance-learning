import test from 'node:test';
import assert from 'node:assert/strict';
import { createSocket } from 'node:dgram';
import { Resolver } from 'node:dns/promises';
import { createSystemResolver } from '../acquisition/runtime.ts';
import { createGate, validatePolicy } from '../acquisition/gate.ts';
import { createAcquisitionClient } from '../worker/acquisition-client.js';
import { createMediaPublicEgress } from '../src/features/knowledge-workflows/media.js';
import { ACQUISITION_POLICY as policy } from '../worker/acquisition-policy.js';
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const command = {url:'https://source.example/a',rootUrl:'https://source.example/',purpose:'page',maximumBytes:100,redirectLimit:3};
const budget = () => ({encoded:0,decoded:0,resources:0,pixels:0});

test('system resolver recovers dropped DNS responses within the existing request deadline',async()=>{
  const dns=createSocket('udp4'),queries=new Map();
  dns.on('message',(query,peer)=>{
    const type=query.readUInt16BE(query.length-4),count=(queries.get(type)??0)+1;queries.set(type,count);
    if(count===1)return;
    const response=Buffer.concat([query,...(type===1?[Buffer.from([0xc0,0x0c,0,1,0,1,0,0,0,60,0,4,8,8,8,8])]:[])]);
    response.writeUInt16BE(0x8180,2);response.writeUInt16BE(type===1?1:0,6);dns.send(response,peer.port,peer.address);
  });
  await new Promise(resolve=>dns.bind(0,'127.0.0.1',resolve));
  try{
    const resolve=createSystemResolver(1000,options=>{const r=new Resolver(options);r.setServers([`127.0.0.1:${dns.address().port}`]);return r;});
    assert.deepEqual(await resolve('fixture.example',AbortSignal.timeout(1000)),['8.8.8.8']);
    assert.deepEqual([...queries].sort((a,b)=>a[0]-b[0]),[[1,2],[28,2]]);
  }finally{await new Promise(resolve=>dns.close(resolve));}
});

// Exercise the complete media -> Worker client -> authenticated cancellation path.
for (const mode of ['delayed', 'rejected', 'absent', 'forged-status']) {
  test(`media deadline waits for bounded authenticated DELETE: ${mode}`, async () => {
    let acknowledged = false, settled = false;
    const requests = [];
    const client = createAcquisitionClient({
      binding:{fetch:async req => {
        requests.push(req);
        if(req.method === 'POST') return new Promise(() => {});
        if(mode === 'absent') return new Promise(() => {});
        await delay(40);
        if(mode === 'rejected') return Response.json({ok:false,error:{kind:'AuthenticationRequired'}},{status:401});
        if(mode === 'forged-status') return Response.json({ok:true,value:null},{status:401});
        acknowledged = true;
        return Response.json({ok:true,value:null});
      }},
      endpoint:'https://fixture-service.test/',token:'fixture-token-only',
      policy:{...policy,requestMilliseconds:100},createId:()=>`fixture-media-${mode}`,
    });
    const egress = createMediaPublicEgress(client.mediaCapability,{timeoutMilliseconds:10});
    const start = performance.now();
    const work = egress.fetch(new Request('https://source.example/image.png')).then(result=>{settled=true;return result;});
    await delay(25);
    assert.equal(settled,false,'caller settled before DELETE teardown/ack budget');
    const result = await work;
    assert.equal(result.ok,false);
    assert.equal(result.error.kind,mode === 'delayed' ? 'MediaPublicEgressTimeout' : 'MediaPublicEgressCancellationUnconfirmed');
    assert.equal(acknowledged,mode === 'delayed');
    assert.deepEqual(requests.map(r=>r.method),['POST','DELETE']);
    assert.equal(requests[0].url,requests[1].url);
    assert.equal(requests[1].headers.get('authorization'),'Bearer fixture-token-only');
    assert.ok(performance.now()-start < 500,'teardown is bounded');
  });
}
test('non-cooperative atomic media teardown is explicitly unconfirmed',async()=>{
  const egress=createMediaPublicEgress({request:async()=>new Promise(()=>{})},{timeoutMilliseconds:10});
  const result=await egress.fetch(new Request('https://source.example/image.png'));
  assert.equal(result.error.kind,'MediaPublicEgressCancellationUnconfirmed');
});
test('each required policy field is individually present, own, integer and positive',()=>{
  validatePolicy(policy);
  for(const field of Object.keys(policy)) {
    const missing={...policy}; delete missing[field];
    for(const invalid of [missing,Object.assign(Object.create({[field]:policy[field]}),missing),...[
      undefined,null,NaN,Infinity,-1,0,1.5,'1',{},[],Number.MAX_SAFE_INTEGER+1
    ].map(value=>({...policy,[field]:value}))]) assert.throws(()=>validatePolicy(invalid),/ConfigurationInvalid/,field);
  }
});
test('gate rejects every missing/malformed budget counter before DNS or dial; no NaN mutation',async()=>{
  let contacts=0;
  const gate=createGate({policy,resolve:async()=>{contacts++;return ['8.8.8.8'];},dial:async()=>{contacts++;throw new Error('forbidden');},logger:()=>{}});
  const invalids=[{},[],null,'budget'];
  for(const field of Object.keys(budget())) {
    const missing=budget(); delete missing[field];
    invalids.push(missing,Object.assign(Object.create({[field]:0}),missing));
    for(const value of [undefined,null,NaN,Infinity,-1,1.5,'0',{},[],Number.MAX_SAFE_INTEGER+1]) invalids.push({...budget(),[field]:value});
  }
  for(const invalid of invalids) {
    const before=invalid && typeof invalid === 'object' ? Object.entries(invalid) : invalid;
    const result=await gate.request(command,invalid,new AbortController().signal);
    assert.equal(result.ok,false);
    assert.equal(result.error.kind,'CommandInvalid');
    assert.equal(result.error.field,'budget');
    assert.deepEqual(invalid && typeof invalid === 'object' ? Object.entries(invalid) : invalid,before);
  }
  assert.equal(contacts,0);
});

test('encoded operation equality/+1 and zero-byte exhausted budgets have explicit outcomes',async()=>{
  const { Readable } = await import('node:stream');
  for(const size of [5,6]) {
    const b=budget(); b.encoded=policy.encodedOperationBytes-5;
    const gate=createGate({policy,resolve:async()=>['8.8.8.8'],dial:async()=>{
      const r=Readable.from([Buffer.alloc(size)]);r.statusCode=200;r.headers={};r.socket={remoteAddress:'8.8.8.8'};return r;
    },logger:()=>{}});
    const result=await gate.request(command,b,new AbortController().signal);
    assert.equal(result.ok,size===5);
    if(!result.ok) assert.equal(result.error.kind,'OperationLimitExceeded');
    assert.equal(b.encoded,policy.encodedOperationBytes+(size===6?1:0));
  }
});
test('system resolver validates entry and names a partial-family DNS failure with its cause',async()=>{
  const {createSystemResolver,DnsFailed}=await import('../acquisition/runtime.ts');
  assert.equal(typeof DnsFailed,'function');
  let cancelled=0,calls=0;
  const cause=Object.assign(new Error('synthetic resolver timeout'),{code:'ETIMEOUT'});
  const resolve=createSystemResolver(50,()=>({
    resolve4:async()=>{calls++;return ['8.8.8.8'];},
    resolve6:async()=>{calls++;throw cause;},cancel:()=>{cancelled++;},
  }));
  await assert.rejects(resolve('source.example',new AbortController().signal),error=>error instanceof DnsFailed && error.name==='DnsFailed' && error.cause===cause);
  assert.equal(calls,2); assert.equal(cancelled,1);
  for(const [host,signal] of [[null,new AbortController().signal],['',new AbortController().signal],['source.example',null]]) {
    await assert.rejects(resolve(host,signal),/CommandInvalid/);
  }
  assert.equal(calls,2);
});

test('actual loopback HTTP adapter awaits delayed DELETE cleanup before media timeout returns',async()=>{
  const {createAcquisitionHandler,createAcquisitionServer}=await import('../acquisition/service.ts');
  let entered,cleaned=false,deleteAcknowledged=false;
  const ready=new Promise(resolve=>{entered=resolve;});
  const localPolicy={...policy,requestMilliseconds:200,operationMilliseconds:1000};
  const handler=createAcquisitionHandler({policy:localPolicy,tokens:new Map([['fixture-token-only','fixture-client']]),maximumActive:1,maximumRetained:10,retentionMilliseconds:2000,nowMs:Date.now,logger:()=>{},
    gate:{request:async(_c,_b,signal)=>{
      entered(); await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));
      await delay(40); cleaned=true; return {ok:false,error:{kind:'Cancelled'}};
    }},renderer:{render:async()=>{throw new Error('unused');},decodeImage:async()=>{throw new Error('unused');}},
  });
  const server=createAcquisitionServer({policy:localPolicy,handler,transport:{kind:'loopback-fixture'}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const methods=[];
    const client=createAcquisitionClient({policy:localPolicy,endpoint:'https://fixture-service.test/',token:'fixture-token-only',createId:()=> 'fixture-http-media-0001',binding:{fetch:async req=>{
      methods.push(req.method);
      const response=await fetch(`http://127.0.0.1:${server.address().port}${new URL(req.url).pathname}`,{method:req.method,headers:req.headers,body:req.method==='POST'?await req.text():undefined});
      if(req.method==='DELETE') {assert.equal(cleaned,true);deleteAcknowledged=true;}
      return response;
    }}});
    const work=createMediaPublicEgress(client.mediaCapability,{timeoutMilliseconds:100}).fetch(new Request('https://source.example/image.png'));
    await ready;
    const result=await work;
    assert.equal(result.error.kind,'MediaPublicEgressTimeout');
    assert.equal(cleaned,true);assert.equal(deleteAcknowledged,true);
    assert.deepEqual(methods,['POST','DELETE']);
  } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('current macOS sandbox-exec denies IPv4/IPv6 TCP/UDP with actual EPERM evidence',async()=>{
  const {execFileSync}=await import('node:child_process');
  const {NETWORK_DENIAL_PROFILE,probeIsolation}=await import('../acquisition/renderer.ts');
  const {writeFile,mkdir}=await import('node:fs/promises');
  assert.equal(process.platform,'darwin','local isolation acceptance requires current macOS');
  const script=`const net=require('node:net'),udp=require('node:dgram');const outcomes={};function done(k,e){if(!e||e.code!=='EPERM')process.exit(2);outcomes[k]=e.code;if(Object.keys(outcomes).length===4){process.stdout.write(JSON.stringify(outcomes));process.exit(0);}}for(const [k,h]of [['tcp4','127.0.0.1'],['tcp6','::1']])net.connect(9,h).on('connect',()=>process.exit(3)).on('error',e=>done(k,e));for(const [k,h]of [['udp4','127.0.0.1'],['udp6','::1']]){const s=udp.createSocket(k);s.on('error',e=>{s.close();done(k,e)});s.send('x',9,h,e=>{if(e){s.close();done(k,e)}else process.exit(3)});}`;
  const outcomes=JSON.parse(execFileSync('/usr/bin/sandbox-exec',['-p',NETWORK_DENIAL_PROFILE,process.execPath,'-e',script],{encoding:'utf8',timeout:3000,env:{PATH:'/usr/bin:/bin'}}));
  assert.deepEqual(outcomes,{tcp4:'EPERM',tcp6:'EPERM',udp4:'EPERM',udp6:'EPERM'});
  assert.equal(await probeIsolation(process.execPath),true);
  await mkdir('test-results/acquisition-closure',{recursive:true});
  await writeFile('test-results/acquisition-closure/isolation.json',JSON.stringify({at:new Date().toISOString(),platform:process.platform,node:process.version,profile:NETWORK_DENIAL_PROFILE,outcomes},null,2));
});
test('local startup is runnable and rejects missing credentials/invalid port without requests',async()=>{
  const {spawn,execFileSync}=await import('node:child_process');
  const {existsSync}=await import('node:fs');
  assert.equal(existsSync('scripts/acquisition-local.mjs'),true,'missing runnable local entry');
  const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  assert.throws(()=>execFileSync(process.execPath,['scripts/acquisition-local.mjs',chrome,'0'],{env:{PATH:'/usr/bin:/bin'},stdio:'pipe'}),error=>error.stderr.toString().includes('ConfigurationInvalid: ACQUISITION_LOCAL_TOKEN'));
  assert.throws(()=>execFileSync(process.execPath,['scripts/acquisition-local.mjs',chrome,'no-port'],{env:{PATH:'/usr/bin:/bin',ACQUISITION_LOCAL_TOKEN:'fixture-token-only'},stdio:'pipe'}),error=>error.stderr.toString().includes('ConfigurationInvalid: port'));
  const child=spawn(process.execPath,['scripts/acquisition-local.mjs',chrome,'0'],{env:{PATH:'/usr/bin:/bin',ACQUISITION_LOCAL_TOKEN:'fixture-token-only'},stdio:['ignore','pipe','pipe']});
  try {
    const line=await new Promise((resolve,reject)=>{
      child.stdout.once('data',chunk=>resolve(chunk.toString()));
      child.once('error',reject);child.once('exit',code=>reject(new Error(`startup exited ${code}`)));
    });
    const event=JSON.parse(line);
    assert.equal(event.event,'acquisition-local-listening');assert.equal(event.host,'127.0.0.1');assert.ok(event.port>0);
    assert.equal(line.includes('fixture-token-only'),false);
  } finally {child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve));}
});

test('address CIDR endpoints and adjacent values preserve conservative exclusions; mapped IPv6 fails closed',async()=>{
  const {publicAddress,createAddressPolicy}=await import('../acquisition/gate.ts');
  assert.equal(typeof createAddressPolicy,'function');
  const addressAllowed=createAddressPolicy();
  // These are explicit implementation boundary vectors, pending registry provenance approval.
  for(const [first,last,before,after] of [
    ['0.0.0.0','0.255.255.255',null,'1.0.0.0'],
    ['10.0.0.0','10.255.255.255','9.255.255.255','11.0.0.0'],
    ['100.64.0.0','100.127.255.255','100.63.255.255','100.128.0.0'],
    ['127.0.0.0','127.255.255.255','126.255.255.255','128.0.0.0'],
    ['169.254.0.0','169.254.255.255','169.253.255.255','169.255.0.0'],
    ['172.16.0.0','172.31.255.255','172.15.255.255','172.32.0.0'],
    ['192.0.0.0','192.0.0.255','191.255.255.255','192.0.1.0'],
    ['192.0.2.0','192.0.2.255','192.0.1.255','192.0.3.0'],
    ['192.88.99.0','192.88.99.255','192.88.98.255','192.88.100.0'],
    ['192.168.0.0','192.168.255.255','192.167.255.255','192.169.0.0'],
    ['198.18.0.0','198.19.255.255','198.17.255.255','198.20.0.0'],
    ['198.51.100.0','198.51.100.255','198.51.99.255','198.51.101.0'],
    ['203.0.113.0','203.0.113.255','203.0.112.255','203.0.114.0'],
    ['224.0.0.0','255.255.255.255','223.255.255.255',null],
    ['2001::','2001:1ff:ffff:ffff:ffff:ffff:ffff:ffff','2000:ffff:ffff:ffff:ffff:ffff:ffff:ffff','2001:200::'],
    ['2001:db8::','2001:db8:ffff:ffff:ffff:ffff:ffff:ffff','2001:db7:ffff:ffff:ffff:ffff:ffff:ffff','2001:db9::'],
    ['2002::','2002:ffff:ffff:ffff:ffff:ffff:ffff:ffff','2001:ffff:ffff:ffff:ffff:ffff:ffff:ffff','2003::'],
    ['3fff::','3fff:fff:ffff:ffff:ffff:ffff:ffff:ffff','3ffe:ffff:ffff:ffff:ffff:ffff:ffff:ffff','3fff:1000::'],
  ]) {
    for(const denied of [first,last]) {assert.equal(addressAllowed(denied),false,denied);assert.equal(publicAddress(denied),false,denied);}
    for(const allowed of [before,after].filter(Boolean)) assert.equal(addressAllowed(allowed),true,allowed);
  }
  for(const denied of ['1fff:ffff:ffff:ffff:ffff:ffff:ffff:ffff','4000::','::ffff:8.8.8.8','::ffff:808:808','::ffff:10.0.0.1','::ffff:a00:1']) assert.equal(addressAllowed(denied),false,denied);
  assert.equal(addressAllowed('2000::'),true);assert.equal(addressAllowed('3fff:ffff:ffff:ffff:ffff:ffff:ffff:ffff'),true);
});
