const fs=require('node:fs');const path=require('node:path');
const base=path.join(__dirname,'../vendor/dsviz/upstream/src');
const read=name=>fs.readFileSync(path.join(base,name),'utf8');
let audio=read('02-audio.js').split('// Stand-in signal')[0];
audio=audio.slice(0,audio.indexOf('function ensureCtx()'))+audio.slice(audio.indexOf('function stats('));
let main=read('07-main.js').split('function tick(now)')[0];
main=main.replace("const $ = id => document.getElementById(id);",'');
main=main.replace('    P.warpProg = program(VERT, HEAD + P.warp + WARP_MAIN); P.compProg = program(VERT, HEAD + COMP_LIB + P.comp + COMP_MAIN);\n    if (P.sim) P.simProg = program(VERT, HEAD + P.sim + SIM_MAIN);\n    if (P.agents) AGENTS.setup(P);','');
main=main.replace('cur = makeState(PRESETS[i]);', 'cur = preparedStates.get(i) || makeState(PRESETS[i]); preparedStates.delete(i);');
main=main.replace('function makeState(P) {','function makeState(P) { compileScene(P);');
const labelStart=main.indexOf('function label() {'),labelEnd=main.indexOf('function go(',labelStart);
main=main.slice(0,labelStart)+'function label() {}\n'+main.slice(labelEnd);
main=main.replace("label(); document.documentElement.style.setProperty('--accent', cur.P.accent);",'label();');
main=main.replace('Math.min(window.devicePixelRatio || 1, 3)','Math.min(window.devicePixelRatio || 1, 2)').replace('Math.min(1, capH / ch)','Math.min(1, capH / ch, 3840 / cw)');
let gl=read('01-gl.js').replace("const canvas = document.getElementById('c');",'');
gl=gl.replace("const HDR =", "if(!gl)throw new Error('WebGL2 indisponible.');\nconst HDR =");
const cfg=read('00-config.js').replace("'afterimage.settings.v3'","'nocturne.dsviz.settings.v1'")+`\nObject.assign(CFG,{intensity:.8,speed:.7,punch:.5,bright:.72,glow:.6,sat:.8,cam:.25,sceneSec:14,transSec:8,detail:3,auto:true,favOnly:false,hide:{}});\n`;
let scenes=fs.readdirSync(base).filter(name=>/^0[456].*\.js$/.test(name)).sort().map(read).join('\n');
const programStart=gl.indexOf('function program('),programEnd=gl.indexOf('function target(',programStart);
gl=gl.slice(0,programStart)+fs.readFileSync(path.join(__dirname,'dsviz-programs.js'),'utf8')+'\n'+gl.slice(programEnd);
scenes=scenes.replace('    ok, setup,', `    ok, setup,
    async prepare(P){const a=P.agents;await Promise.all([programAsync(VERT,HEAD+a.update+UPD),programAsync(VH.replace('void main',a.deposit+'\\nvoid main'),PF),a.draw?programAsync(VH.replace('void main',a.draw+'\\nvoid main'),PF):null]);if(!P.ag)setup(P);},
    async prepareState(S,asp){const g=S.P.ag;if(!g.a){g.a=ftarget(g.w,g.h);g.b=ftarget(g.w,g.h);}const arr=new Float32Array(g.n*4),f=S.P.agents.seed;for(let start=0;start<g.n;start+=8192){for(let i=start;i<Math.min(start+8192,g.n);i++){const o=i*4;if(f)f(i,arr,o,asp);else{arr[o]=(Math.random()*2-1)*asp;arr[o+1]=Math.random()*2-1;arr[o+2]=Math.random()*6.2831853;arr[o+3]=Math.random();}}await new Promise(resolve=>setTimeout(resolve,0));}gl.bindTexture(gl.TEXTURE_2D,g.a.tex);gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,g.w,g.h,gl.RGBA,gl.FLOAT,arr);S.agSeeded=true;},`);
const bridge=`
function compileScene(P) {
 if(P.warpProg)return;
 P.warpProg=program(VERT,HEAD+P.warp+WARP_MAIN);P.compProg=program(VERT,HEAD+COMP_LIB+P.comp+COMP_MAIN);
 if(P.sim)P.simProg=program(VERT,HEAD+P.sim+SIM_MAIN);
 if(P.agents)AGENTS.setup(P);
}
${fs.readFileSync(path.join(__dirname,'dsviz-performance.js'),'utf8')}
for(let i=PRESETS.length-1;i>=0;i--)if(/henry/i.test(PRESETS[i].name))PRESETS.splice(i,1);
build();capH=1440;go(Math.max(0,PRESETS.findIndex(p=>p.name==='Silk Ribbons')),true);resize();
let input=null,disposed=false;
analyser={getFloatFrequencyData:out=>out.set(input.frequency),getFloatTimeDomainData:out=>out.set(input.wave)};
actx={sampleRate:48000};
return {
 get scenes(){return PRESETS.map((p,i)=>({index:i,name:p.name,group:p.group}));},
 resetAudio(){primed=0;resetLevels();for(const k in avg)avg[k]=0;plog.fill(0);fluxLo.fill(0);fluxHi.fill(0);A.raw=0;},
 prepare, prefetch,
 next(){return requestScene(candidate());},
 group(value){const group=({'0':'Light','1':'Life','2':'Liquid','3':'Signal'})[value];CFG.hide={};for(const p of PRESETS)if(group&&p.group!==group)CFG.hide[p.name]=true;bag=[];switchEpoch++;pendingIndex=-1;pendingSwitch=null;return requestScene(candidate());},
 select(index){if(Number.isInteger(index)&&index>=0&&index<PRESETS.length)go(index);},
 resize(){resize();},
 asyncSelect(index){return requestScene(index);},
 frame(value,dt,rawDt=dt){
  if(disposed)return null;
  dt=Math.max(1/240,Math.min(.05,dt||1/60));input=value;A.live=Boolean(input&&input.wave?.length===FFT&&input.frequency?.length===FFT/2);
  if(A.live)actx.sampleRate=input.rate||48000;else A.raw=0;
  analyze(dt);resize();
  const live=A.live&&A.raw>1e-5;
  if(live){clock+=dt;sinceSwitch+=Math.min(1,rawDt||dt);if(!old&&sinceSwitch>1)prefetch();if(!old&&!pendingSwitch&&((sinceSwitch>=12&&A.onKick)||sinceSwitch>=16))requestScene(candidate()).catch(()=>{});const timed=performanceBefore(rawDt||dt);try{render(dt);}finally{if(timed)gl.endQuery(timerExt.TIME_ELAPSED_EXT);}}
  return {name:cur.P.name,count:PRESETS.length,index:cur.i,group:cur.P.group,rms:A.raw,live,bass:A.bassA,mid:A.midA,treb:A.trebA,beats:A.beats,hue:A.hue*360,transition:old?trans:1,width:W,height:H,gpuMs,frameMs:cpuMs,parallelShaders:Boolean(parallelCompile),preparing:pendingIndex>=0,error:prepareError};
 },
 destroy(){disposed=true;}
};`;
const result='/* dsViz / lemondrop — source fournie, révision 889b2c5. Voir NOTICE.txt. */\nwindow.NocturneDsViz={create(canvas){\n"use strict";\n'+[cfg,gl,audio,scenes,main,bridge].join('\n')+'\n}};\n';
const out=path.join(__dirname,'../src/vendor/dsviz');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'dsviz.js'),result);console.log('Moteur dsViz et scènes générés depuis les sources originales.');
