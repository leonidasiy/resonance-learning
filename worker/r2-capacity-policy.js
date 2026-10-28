// @ts-check
/** Same account-wide capacity contract for source uploads and extracted originals.
 * @param {Readonly<Record<string,unknown>>} environment
 * @returns {{ok:true,value:ConstructorParameters<typeof import('./r2-capacity-d1.js').D1R2CapacityLedger>[0]['policy']}|{ok:false,error:{kind:'DiscoveryDeploymentConfigurationMissing'|'DiscoveryDeploymentConfigurationInvalid',field:string}}} */
export function resolveR2CapacityPolicy(environment) {
 const fields=['SOURCE_R2_ACCOUNT_SCOPE','SOURCE_R2_STORED_BYTES_LIMIT','SOURCE_R2_CLASS_A_MONTHLY_LIMIT','SOURCE_R2_CLASS_B_MONTHLY_LIMIT','SOURCE_R2_OBSERVATION_MAX_AGE_MS'];
 const field=fields.find(field=>typeof environment[field]!=='string'||environment[field].trim()===''||field!=='SOURCE_R2_ACCOUNT_SCOPE'&&(!/^[1-9]\d*$/u.test(environment[field])||!Number.isSafeInteger(Number(environment[field]))));
 if(field!==undefined)return {ok:false,error:{kind:environment[field]===undefined?'DiscoveryDeploymentConfigurationMissing':'DiscoveryDeploymentConfigurationInvalid',field}};
 return {ok:true,value:Object.freeze({accountScope:/** @type {string} */(environment.SOURCE_R2_ACCOUNT_SCOPE).trim(),storedBytesLimit:Number(environment.SOURCE_R2_STORED_BYTES_LIMIT),classAMonthlyLimit:Number(environment.SOURCE_R2_CLASS_A_MONTHLY_LIMIT),classBMonthlyLimit:Number(environment.SOURCE_R2_CLASS_B_MONTHLY_LIMIT),observationMaximumAgeMs:Number(environment.SOURCE_R2_OBSERVATION_MAX_AGE_MS)})};
}
