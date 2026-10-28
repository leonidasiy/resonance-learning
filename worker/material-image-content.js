// @ts-check
import { R2SourceContentStore } from './source-content-r2.js';
import { D1R2CapacityLedger } from './r2-capacity-d1.js';

/** Existing source storage is create-once; consult its journal before first reads
 * and repeated deletion so absent cache objects need no unaccounted R2 operation.
 * @param {{database:import('./knowledge-workflow-content-d1.js').D1DatabasePort,bucket:import('./source-content-r2.js').R2BucketPort,ownerId:string,policy:ConstructorParameters<typeof D1R2CapacityLedger>[0]['policy'],now:()=>string,createId:()=>string}} dependencies */
export function createMaterialImageContentStore({database,bucket,ownerId,policy,now,createId}) {
 const store=new R2SourceContentStore({bucket,capacityOwnerId:ownerId,capacity:new D1R2CapacityLedger({database,bucket,policy,now,createId})});
 /** @param {string} key */
 async function exists(key){return await database.prepare('SELECT state FROM source_r2_object_ledger WHERE account_scope=? AND object_key=?').bind(policy.accountScope,key).first()!==null;}
 return Object.freeze({
  stage:store.stage.bind(store),
  /** @param {string} owner @param {string} key */
  async read(owner,key){return await exists(key)?store.read(owner,key):{ok:/** @type {const} */(false),error:{kind:/** @type {const} */('SourceContentNotFound')}};},
  /** @param {string} key */
  async remove(key){return await exists(key)?store.remove(key):{ok:/** @type {const} */(true),value:null};},
 });
}
