const preparedStates=new Map(),preparations=new Map();
let switchEpoch=0,pendingIndex=-1,pendingSwitch=null,prepareError=null;
const timerExt=gl.getExtension('EXT_disjoint_timer_query_webgl2');
let gpuQuery=null,gpuMs=0,cpuMs=16,slowFrames=0,fastFrames=0,qualityCooldown=0;
function candidate(){
 const allowed=pool().filter(i=>i!==cur.i&&i!==old?.i);bag=bag.filter(i=>allowed.includes(i));if(!bag.length)bag=allowed.sort(()=>Math.random()-.5);return bag.at(-1)??cur.i;
}
async function prepare(index){
 if(preparedStates.has(index))return preparedStates.get(index);if(preparations.has(index))return preparations.get(index);
 const P=PRESETS[index];
 const promise=(async()=>{
  const programs=await Promise.all([programAsync(VERT,HEAD+P.warp+WARP_MAIN),programAsync(VERT,HEAD+COMP_LIB+P.comp+COMP_MAIN),P.sim?programAsync(VERT,HEAD+P.sim+SIM_MAIN):null]);
  P.warpProg=programs[0];P.compProg=programs[1];if(P.sim)P.simProg=programs[2];
  if(P.agents)await AGENTS.prepare(P);
  const state=makeState(P);state.i=index;if(P.agents)await AGENTS.prepareState(state,W/H);
  preparedStates.set(index,state);while(preparedStates.size>2)preparedStates.delete(preparedStates.keys().next().value);return state;
 })().finally(()=>preparations.delete(index));preparations.set(index,promise);return promise;
}
function prefetch(){const index=candidate();if(index!==cur.i)prepare(index).catch(error=>{prepareError=error.message;});}
function requestScene(index){
 if(index===cur.i)return Promise.resolve(false);if(index===pendingIndex)return pendingSwitch;
 const request=++switchEpoch;pendingIndex=index;
 const job=prepare(index).then(()=>{if(request!==switchEpoch||disposed)return false;bag=bag.filter(i=>i!==index);go(index);return true;}).catch(error=>{prepareError=error.message;throw error;}).finally(()=>{if(request===switchEpoch){pendingIndex=-1;pendingSwitch=null;}});pendingSwitch=job;return job;
}
function performanceBefore(rawDt){
 cpuMs+=(Math.min(.5,rawDt)*1000-cpuMs)*.08;
 if(gpuQuery&&gl.getQueryParameter(gpuQuery,gl.QUERY_RESULT_AVAILABLE)){
  if(!gl.getParameter(timerExt.GPU_DISJOINT_EXT)){const elapsed=gl.getQueryParameter(gpuQuery,gl.QUERY_RESULT)/1e6;gpuMs=gpuMs?gpuMs+(elapsed-gpuMs)*.25:elapsed;}
  gl.deleteQuery(gpuQuery);gpuQuery=null;
 }
 qualityCooldown=Math.max(0,qualityCooldown-rawDt);
 const heavy=gpuMs>23||cpuMs>26;slowFrames=heavy?slowFrames+1:Math.max(0,slowFrames-2);fastFrames=!heavy&&gpuMs>0&&gpuMs<11&&cpuMs<19?fastFrames+1:0;
 if(!qualityCooldown&&slowFrames>20&&capH>900){capH=Math.max(900,Math.round(capH*.82));slowFrames=fastFrames=0;qualityCooldown=2;resize();}
 else if(!qualityCooldown&&fastFrames>450&&capH<2160){capH=Math.min(2160,Math.round(capH*1.1));fastFrames=0;qualityCooldown=8;resize();}
 if(timerExt&&!gpuQuery){gpuQuery=gl.createQuery();gl.beginQuery(timerExt.TIME_ELAPSED_EXT,gpuQuery);return true;}return false;
}
