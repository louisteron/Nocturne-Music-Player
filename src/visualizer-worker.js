'use strict';
self.window=self;
importScripts('vendor/dsviz/dsviz.js');
let canvas,engine,running=false,raf=0,last=0,input=null,received=0,lastReport=0,group='auto',command=0;
function recycle(value){if(value?.wave?.buffer?.byteLength&&value?.frequency?.buffer?.byteLength)postMessage({type:'recycle',wave:value.wave.buffer,frequency:value.frequency.buffer},[value.wave.buffer,value.frequency.buffer]);}
function reportError(error){postMessage({type:'error',message:error.message||String(error)});}
function tick(now){
 raf=0;if(!running||!engine)return;
 const raw=(now-(last||now))/1000||1/60;last=now;
 try{
  const value=now-received<350?input:null,state=engine.frame(value,Math.min(.05,raw),raw);
  if(now-lastReport>100){postMessage({type:'state',state});lastReport=now;}
 }catch(error){reportError(error);}
 raf=requestAnimationFrame(tick);
}
function start(){if(running)return;running=true;last=0;raf=requestAnimationFrame(tick);}
function stop(){running=false;cancelAnimationFrame(raf);raf=0;last=0;recycle(input);input=null;}
onmessage=event=>{
 const message=event.data;
 try{
  if(message.type==='init'){
   canvas=message.canvas;canvas.clientWidth=message.width;canvas.clientHeight=message.height;self.devicePixelRatio=message.dpr;
   engine=self.NocturneDsViz.create(canvas);
   canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();stop();postMessage({type:'recovering'});});
   canvas.addEventListener('webglcontextrestored',()=>{try{engine=self.NocturneDsViz.create(canvas);engine.group(group).catch(reportError);postMessage({type:'ready',scenes:engine.scenes});start();}catch(error){reportError(error);}});
   postMessage({type:'ready',scenes:engine.scenes});start();
  }else if(message.type==='audio'){
   recycle(input);input=message.wave?{wave:new Float32Array(message.wave),frequency:new Float32Array(message.frequency),rate:message.rate}:null;received=performance.now();
  }else if(message.type==='layout'){
   canvas.clientWidth=message.width;canvas.clientHeight=message.height;self.devicePixelRatio=message.dpr;engine.resize();
  }else if(message.type==='start')start();
  else if(message.type==='stop')stop();
  else if(message.type==='reset')engine.resetAudio();
  else if(message.type==='group'){group=message.value;engine.group(group).catch(reportError);}
  else if(message.type==='next'||message.type==='select'){
   const request=++command,t0=performance.now();
   (message.type==='select'?engine.asyncSelect(message.index):engine.next()).then(changed=>{if(request===command)postMessage({type:'changed',changed,waitMs:performance.now()-t0});}).catch(reportError);
  }
 }catch(error){reportError(error);}
};
