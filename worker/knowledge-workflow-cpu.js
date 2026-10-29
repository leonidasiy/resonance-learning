// @ts-check

const cpuKeys=['workflow-cpu-backpressure:v1','workflow-cpu-backpressure:v2:1','workflow-cpu-backpressure:v2:2'];
/** @typedef {{ownerId:string,runId:string}} Scope */
/** @typedef {{database:import('./knowledge-workflow-content-d1.js').D1DatabasePort,stages:import('./knowledge-workflow-stages-d1.js').D1WorkflowStageRepository,run:Scope}} Dependencies */
/** @param {unknown} value @returns {value is Record<string,unknown>} */
function record(value){return value!==null&&typeof value==='object'&&!Array.isArray(value);}

/** @param {Dependencies} dependencies @returns {Promise<import('./knowledge-workflow-stages-d1.js').Result<number>>} */
export async function readWorkflowCpuWidth({database,stages,run}) {
  try {
    const profiles=await database.prepare('SELECT stage_key,status,input_digest,result_json FROM knowledge_workflow_stages WHERE owner_id=? AND run_id=? AND stage_key IN (?,?,?)').bind(run.ownerId,run.runId,...cpuKeys).all();
    if(!profiles.success)return {ok:false,error:{kind:'WorkflowStagePersistenceFailed'}};
    let width=3;
    for(const profile of profiles.results) {
      if(!record(profile)||typeof profile.stage_key!=='string'||!cpuKeys.includes(profile.stage_key)||profile.input_digest!==profile.stage_key)return {ok:false,error:{kind:'WorkflowStagePersistenceFailed'}};
      const cpuFailures=cpuKeys.indexOf(profile.stage_key),expected=cpuFailures===0?null:{width:3-cpuFailures,cpuFailures};
      let result=typeof profile.result_json==='string'?JSON.parse(profile.result_json):null;
      if(profile.status==='claimed') {
        result=await stages.run(run,profile.stage_key,profile.stage_key,async()=>({ok:true,value:expected}),{resumeSafe:true});
      }else if(profile.status!=='completed')return {ok:false,error:{kind:'WorkflowStagePersistenceFailed'}};
      if(!record(result)||Object.keys(result).sort().join(',')!=='ok,value'||result.ok!==true||(expected===null?result.value!==null:!record(result.value)||Object.keys(result.value).sort().join(',')!=='cpuFailures,width'||result.value.width!==expected.width||result.value.cpuFailures!==expected.cpuFailures))return {ok:false,error:{kind:'WorkflowStagePersistenceFailed'}};
      width=Math.min(width,expected?.width??1);
    }
    return {ok:true,value:width};
  }catch{return {ok:false,error:{kind:'WorkflowStagePersistenceFailed'}};}
}

/** Persist the decision before its profile, so replaying one crash cannot narrow twice.
 * @param {Dependencies & {observationKey:string}} dependencies
 * @returns {Promise<import('./knowledge-workflow-stages-d1.js').Result<number>>} */
export async function recordWorkflowCpuFailure({database,stages,run,observationKey}) {
  const key=`workflow-cpu-observation:${observationKey}`;
  const decision=await stages.run(run,key,key,async()=>{
    const current=await readWorkflowCpuWidth({database,stages,run});
    return current.ok?{ok:true,value:Math.max(1,current.value-1)}:current;
  },{resumeSafe:true});
  if(!decision.ok)return decision;
  if(decision.value!==1&&decision.value!==2)return {ok:false,error:{kind:'WorkflowStagePersistenceFailed'}};
  const cpuFailures=3-decision.value,profileKey=cpuKeys[cpuFailures],value={width:decision.value,cpuFailures};
  const saved=await stages.run(run,profileKey,profileKey,async()=>({ok:true,value}),{resumeSafe:true});
  if(!saved.ok)return saved;
  if(JSON.stringify(saved.value)!==JSON.stringify(value))return {ok:false,error:{kind:'WorkflowStagePersistenceFailed'}};
  return decision;
}
