import {spawn} from 'node:child_process';
import {readFile,writeFile,rename} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import process from 'node:process';
import {createAcquisitionClient} from '../worker/acquisition-client.js';
import {ACQUISITION_POLICY} from '../worker/acquisition-policy.js';

/** Keep the private bridge destination current while preserving its stable client identity.
 * @param {string} source @param {string} origin */
export function updateAcquisitionOrigin(source,origin) {
  const url=new URL(origin);
  if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('Acquisition tunnel origin is invalid');
  const fields=[...source.matchAll(/"ACQUISITION_ORIGIN"\s*:\s*"[^"\r\n]*"/g)];
  if(fields.length!==1)throw new Error('Bridge config must contain one ACQUISITION_ORIGIN');
  return source.replace(/("ACQUISITION_ORIGIN"\s*:\s*)"[^"\r\n]*"/,(_match,prefix)=>prefix+JSON.stringify(url.origin));
}

async function run() {
  const [cloudflared,wrangler,config]=process.argv.slice(2);
  if(!cloudflared||!wrangler||!config)throw new Error('Usage: acquisition-tunnel.mjs CLOUDFLARED WRANGLER_CLI BRIDGE_CONFIG');
  const token=process.env.ACQUISITION_TOKEN_FILE?(await readFile(process.env.ACQUISITION_TOKEN_FILE,'utf8')).trim():process.env.ACQUISITION_TOKEN;
  if(!token)throw new Error('Acquisition token is unavailable');
  const log=(/** @type {string} */event,/** @type {string|undefined} */origin=undefined)=>console.info(JSON.stringify({event,occurredAt:new Date().toISOString(),...(origin?{origin}:{})}));
  const abort=new AbortController();
  /** @type {import('node:child_process').ChildProcess|undefined} */ let deployment;
  const tunnel=spawn(cloudflared,['tunnel','--url',`http://127.0.0.1:${process.env.ACQUISITION_PORT??8788}`,'--no-autoupdate'],{stdio:['ignore','pipe','pipe']});
  const stop=()=>{abort.abort();tunnel.kill('SIGTERM');deployment?.kill('SIGTERM');};
  process.once('SIGTERM',stop);process.once('SIGINT',stop);
  const exited=new Promise((resolve,reject)=>{tunnel.once('error',reject);tunnel.once('exit',code=>{abort.abort();resolve(code);});});
  let published=false;
  /** @type {Promise<void>|undefined} */ let publishing;
  /** @type {unknown} */ let publishError;
  const publish=async(/** @type {string} */origin)=>{
    log('acquisition-tunnel-detected',origin);
    const client=createAcquisitionClient({binding:{fetch:(/** @type {Request} */request)=>fetch(request,{redirect:'error'})},endpoint:origin,token,policy:ACQUISITION_POLICY,createId:()=>crypto.randomUUID()});
    // DNS/edge registration can lag the URL announcement. No source or AI call is made here.
    while(!abort.signal.aborted){
      if(await client.available())break;
      await new Promise(resolve=>{const timer=setTimeout(done,5000);function done(){clearTimeout(timer);abort.signal.removeEventListener('abort',done);resolve(null);}abort.signal.addEventListener('abort',done,{once:true});});
    }
    if(abort.signal.aborted)return;
    const source=await readFile(config,'utf8');
    if(!/"ACQUISITION_CLIENT_ORIGIN"\s*:\s*"https:\/\//.test(source))throw new Error('Bridge config requires a stable ACQUISITION_CLIENT_ORIGIN');
    await writeFile(`${config}.tmp`,updateAcquisitionOrigin(source,origin),{mode:0o600});
    await rename(`${config}.tmp`,config);
    const child=spawn(process.execPath,[wrangler,'deploy','--config',config],{stdio:'ignore'});
    deployment=child;
    const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
    if(code!==0)throw new Error('Acquisition bridge deployment failed');
    published=true;log('acquisition-tunnel-published');
  };
  let buffer='';
  const observe=(/** @type {import('node:buffer').Buffer} */chunk)=>{
    buffer=(buffer+chunk.toString()).slice(-8192);
    const origin=buffer.match(/https:\/\/[a-z0-9]+(?:-[a-z0-9]+)*\.trycloudflare\.com\b/)?.[0];
    if(origin&&!publishing)publishing=publish(origin).catch(error=>{publishError=error;stop();});
  };
  tunnel.stdout.on('data',observe);tunnel.stderr.on('data',observe);
  try{
    await exited;
    await publishing;
    if(publishError)throw publishError;
    if(!published&&!process.exitCode)log('acquisition-tunnel-not-published');
  }finally{stop();process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)run().catch(()=>{console.error(JSON.stringify({event:'acquisition-tunnel-failed'}));process.exitCode=1;});
