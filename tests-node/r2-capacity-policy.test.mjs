import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolveR2CapacityPolicy} from '../worker/r2-capacity-policy.js';
const environment={SOURCE_R2_ACCOUNT_SCOPE:' account ',SOURCE_R2_STORED_BYTES_LIMIT:'8589934592',SOURCE_R2_CLASS_A_MONTHLY_LIMIT:'100000',SOURCE_R2_CLASS_B_MONTHLY_LIMIT:'1000000',SOURCE_R2_OBSERVATION_MAX_AGE_MS:'86400000'};
test('uploads and extracted originals share the existing environment policy without changed limits',()=>{
 assert.deepEqual(resolveR2CapacityPolicy(environment),{ok:true,value:{accountScope:'account',storedBytesLimit:8589934592,classAMonthlyLimit:100000,classBMonthlyLimit:1000000,observationMaximumAgeMs:86400000}});
 for(const field of Object.keys(environment)){
  const missing={...environment};delete missing[field];assert.deepEqual(resolveR2CapacityPolicy(missing),{ok:false,error:{kind:'DiscoveryDeploymentConfigurationMissing',field}});
  for(const value of field==='SOURCE_R2_ACCOUNT_SCOPE'?['',1]:['',0,'0','01','-1','1.1','9007199254740992'])assert.deepEqual(resolveR2CapacityPolicy({...environment,[field]:value}),{ok:false,error:{kind:'DiscoveryDeploymentConfigurationInvalid',field}});
 }
});
