const {_electron}=require('playwright'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
(async()=>{
 const profile=await fs.mkdtemp(path.join(os.tmpdir(),'nocturne-viz-perf-')),env={...process.env,NOCTURNE_TEST_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;
 const app=await _electron.launch({args:[path.resolve(__dirname,'..')],env});
 try{
  const page=await app.firstWindow();await page.waitForFunction(()=>!!window.NocturneDsViz);
  const result=await page.evaluate(async()=>{
   const canvas=document.createElement('canvas');canvas.style.cssText='position:fixed;inset:0;width:100vw;height:100vh';document.body.append(canvas);
   const worker=new Worker('visualizer-worker.js'),offscreen=canvas.transferControlToOffscreen();
   let scenes=[],states=[],errors=[],changed=null,last=performance.now(),maxGap=0;
   const heartbeat=setInterval(()=>{const now=performance.now();maxGap=Math.max(maxGap,now-last);last=now;},10);
   let initialized;const ready=new Promise(resolve=>initialized=resolve);
   worker.onmessage=e=>{const m=e.data;if(m.type==='ready'){scenes=m.scenes;initialized();}if(m.type==='state')states.push(m.state);if(m.type==='error')errors.push(m.message);if(m.type==='changed'&&changed){changed(m);changed=null;}};
   worker.postMessage({type:'init',canvas:offscreen,width:innerWidth,height:innerHeight,dpr:devicePixelRatio},[offscreen]);
   const timeout=p=>Promise.race([p,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Visualiseur sans réponse')),25000))]);
   try{
    await timeout(ready);const wave=new Float32Array(2048),frequency=new Float32Array(1024).fill(-70);frequency[9]=-12;
    for(let i=0;i<wave.length;i++)wave[i]=Math.sin(i*Math.PI*2*220/48000)*.12;
    const audio=setInterval(()=>{worker.postMessage({type:'audio',wave:wave.buffer.slice(0),frequency:frequency.buffer.slice(0),rate:48000});},30);
    const switches=[];
    try{
     for(const name of ['Slime Mould','Tungsten','Glass Tide','Murmuration']){
      const scene=scenes.find(s=>s.name===name);if(!scene)throw new Error('Scène absente : '+name);
      const done=new Promise(resolve=>changed=resolve);worker.postMessage({type:'select',index:scene.index});const info=await timeout(done);switches.push({name,prepareMs:Math.round(info.waitMs)});
      await new Promise(resolve=>setTimeout(resolve,1300));
     }
    }finally{clearInterval(audio);}
    return{maxUiGap:Math.round(maxGap),frames:states.length,parallel:states.some(s=>s.parallelShaders),errors,switches,last:states.at(-1)};
   }finally{clearInterval(heartbeat);worker.terminate();canvas.remove();}
  });
  console.log(JSON.stringify(result,null,2));assert.deepEqual(result.errors,[]);assert.ok(result.frames>=15);assert.ok(result.maxUiGap<180,'Interface bloquée '+result.maxUiGap+' ms');
  console.log('OK : interface réactive pendant la préparation et le rendu des scènes lourdes dans le worker.');
 }finally{await app.close();await fs.rm(profile,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
