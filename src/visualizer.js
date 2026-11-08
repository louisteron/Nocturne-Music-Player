(() => {
 const panel=$('visualizer'),output=$('visualizer-output'),button=$('show-visualizer'),mode=$('visualizer-mode');
 let worker,ready=false,opened=false,raf=0,lastAudio=0,context,tap,retryAt=0,remote=null,remoteBusy=false,remoteAt=0,remoteReceived=0,remoteActive=false,epoch=0,idle,previousId=null,playing=false,lastValue=false;
 const wave=new Float32Array(2048),frequency=new Float32Array(1024),buffers=[];
 const send=message=>worker?.postMessage(message);
 function report(error){$('visualizer-state').textContent=error.message||error;}
 function audioContext(){context||=new AudioContext();if(context.state==='suspended')context.resume().catch(()=>{});return context;}
 function disconnect(){if(!tap)return;tap.source.disconnect();tap.analyser.disconnect();tap.silent.disconnect();tap.stream.getTracks().forEach(t=>t.stop());tap=null;}
 function localAudio(media,now){
  if(!(media instanceof HTMLMediaElement)||media.paused||media.readyState<2)return null;
  if(tap?.media!==media||tap?.url!==media.currentSrc||tap?.stream.getAudioTracks().every(t=>t.readyState==='ended')){
   disconnect();if(now<retryAt)return null;retryAt=now+750;
   try{const stream=media.captureStream();if(!stream.getAudioTracks().length){stream.getTracks().forEach(t=>t.stop());return null;}
    const ac=audioContext(),source=ac.createMediaStreamSource(stream),analyser=ac.createAnalyser(),silent=ac.createGain();analyser.fftSize=2048;analyser.smoothingTimeConstant=0;analyser.minDecibels=-100;analyser.maxDecibels=0;silent.gain.value=0;source.connect(analyser);analyser.connect(silent);silent.connect(ac.destination);tap={media,url:media.currentSrc,stream,source,analyser,silent};
   }catch{return null;}
  }
  tap.analyser.getFloatTimeDomainData(wave);tap.analyser.getFloatFrequencyData(frequency);return{wave,frequency,rate:context.sampleRate};
 }
 function input(now){
  const media=playbackMedia();playing=Boolean(current&&!media.paused&&!media.ended);if(!playing)return null;
  if(usesYouTube()&&!usesEditAudio()){
   disconnect();remoteActive=true;
   if(!remoteBusy&&now-remoteAt>32){remoteBusy=true;remoteAt=now;const request=epoch;window.youtube.spectrum(true).then(value=>{if(opened&&epoch===request){remote=value;remoteReceived=performance.now();}}).catch(()=>{remote=null;}).finally(()=>{remoteBusy=false;});}
   return now-remoteReceived<300?remote:null;
  }
  if(remoteActive){remoteActive=false;window.youtube.spectrum(false).catch(()=>{});}remote=null;return localAudio(media,now);
 }
 function resize(){if(!worker||!opened)return;const rect=panel.getBoundingClientRect();send({type:'layout',width:rect.width,height:rect.height,dpr:devicePixelRatio||1});}
 function state(value){
  if(!opened)return;
  panel.dataset.preset=value.name;panel.dataset.rms=value.rms.toFixed(6);panel.dataset.hue=value.hue.toFixed(2);panel.dataset.scenes=value.count;panel.dataset.engine='dsviz-worker';panel.dataset.transition=value.transition<1?'crossfade':'steady';panel.dataset.width=value.width;panel.dataset.height=value.height;panel.dataset.gpuMs=value.gpuMs.toFixed(2);panel.dataset.frameMs=value.frameMs.toFixed(2);panel.dataset.parallelShaders=String(value.parallelShaders);
  panel.dataset.signal=!playing?'paused':value.live?'live':lastValue?'silent':'unavailable';
  $('visualizer-preset').textContent=`${value.name} · ${value.index+1} / ${value.count}`;
  $('visualizer-title').textContent=current?.title||'La musique prend forme.';$('visualizer-artist').textContent=current?.artist||'Choisis un morceau.';
  $('visualizer-state').textContent=!playing?'En attente de lecture':value.live?'Réagit au son · Échap pour fermer':lastValue?'Silence détecté':'Analyse audio indisponible pour cette source';
 }
 function ensure(){
  if(worker)return;
  worker=new Worker('visualizer-worker.js');worker.onerror=event=>report(event.message);
  worker.onmessage=event=>{const m=event.data;if(m.type==='recycle'){if(buffers.length<3)buffers.push({wave:m.wave,frequency:m.frequency});}else if(m.type==='ready'){ready=true;panel.dataset.worker='ready';resize();if(!opened||document.hidden)send({type:'stop'});}else if(m.type==='state')state(m.state);else if(m.type==='changed')panel.dataset.switchWait=m.waitMs.toFixed(1);else if(m.type==='recovering')report('Le moteur graphique redémarre…');else if(m.type==='error')report(m.message);};
  for(let i=0;i<3;i++)buffers.push({wave:new ArrayBuffer(2048*4),frequency:new ArrayBuffer(1024*4)});
  const rect=panel.getBoundingClientRect(),canvas=output.transferControlToOffscreen();worker.postMessage({type:'init',canvas,width:rect.width,height:rect.height,dpr:devicePixelRatio||1},[canvas]);
 }
 function pump(now){
  if(!opened||document.hidden){raf=0;return;}
  if(ready&&now-lastAudio>=32){
   lastAudio=now;if(previousId!==current?.id){previousId=current?.id;remote=null;send({type:'reset'});}
   const value=input(now);lastValue=Boolean(value);
   if(value&&buffers.length){const b=buffers.pop();new Float32Array(b.wave).set(value.wave);new Float32Array(b.frequency).set(value.frequency);worker.postMessage({type:'audio',...b,rate:value.rate},[b.wave,b.frequency]);}
   else if(!value)send({type:'audio'});
  }
  raf=requestAnimationFrame(pump);
 }
 function awake(){panel.classList.remove('quiet');clearTimeout(idle);idle=setTimeout(()=>{if(opened)panel.classList.add('quiet');},4000);}
 async function toggle(value){
  opened=value;epoch++;panel.hidden=!value;button.setAttribute('aria-pressed',String(value));document.body.classList.toggle('visualizer-open',value);window.dispatchEvent(new Event('visualizer-change'));
  if(value){try{audioContext();ensure();resize();send({type:'start'});if(!raf)raf=requestAnimationFrame(pump);awake();$('visualizer-close').focus();}catch(error){report(error);}}
  else{cancelAnimationFrame(raf);raf=0;send({type:'stop'});disconnect();remote=null;clearTimeout(idle);context?.suspend().catch(()=>{});window.youtube.spectrum(false).catch(()=>{});if(document.fullscreenElement===panel)await document.exitFullscreen();button.focus();}
 }
 button.onclick=()=>toggle(!opened);$('visualizer-close').onclick=()=>toggle(false);
 mode.onchange=()=>{send({type:'group',value:mode.value});awake();};$('visualizer-next').onclick=()=>{send({type:'next'});awake();};
 $('visualizer-fullscreen').onclick=()=>{(document.fullscreenElement?document.exitFullscreen():panel.requestFullscreen()).catch(report);};
 panel.addEventListener('pointermove',awake);panel.addEventListener('pointerdown',awake);panel.addEventListener('dblclick',event=>{if(event.target===output)$('visualizer-fullscreen').click();});
 document.addEventListener('keydown',event=>{if(!opened)return;if(event.key==='ArrowRight'&&event.target.tagName!=='SELECT'){event.preventDefault();send({type:'next'});awake();}if(event.key==='Escape'&&!document.fullscreenElement){event.preventDefault();toggle(false);}});
 document.addEventListener('fullscreenchange',()=>{$('visualizer-fullscreen').textContent=document.fullscreenElement?'Réduire':'Plein écran';resize();awake();});
 document.addEventListener('visibilitychange',()=>{if(document.hidden){cancelAnimationFrame(raf);raf=0;send({type:'stop'});}else if(opened&&!raf){send({type:'start'});raf=requestAnimationFrame(pump);}});
 new ResizeObserver(resize).observe(panel);window.addEventListener('pagehide',()=>worker?.terminate());button.disabled=false;
})();
