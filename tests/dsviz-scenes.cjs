const {_electron}=require('playwright');const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
(async()=>{
 const profile=await fs.mkdtemp(path.join(os.tmpdir(),'nocturne-dsviz-'));const env={...process.env,NOCTURNE_TEST_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;
 const app=await _electron.launch({args:[path.resolve(__dirname,'..')],env});
 try{
  const page=await app.firstWindow();await page.waitForFunction(()=>!!window.NocturneDsViz);
  const result=await page.evaluate(()=>{
   const canvas=document.createElement('canvas');canvas.style.cssText='position:fixed;width:160px;height:100px;left:0;top:0';document.body.append(canvas);
   const engine=window.NocturneDsViz.create(canvas),frequency=new Float32Array(1024).fill(-85),wave=new Float32Array(2048);frequency[9]=-12;
   for(let i=0;i<wave.length;i++)wave[i]=Math.sin(i*Math.PI*2*220/48000)*.12;
   const input={wave,frequency,rate:48000},gl=canvas.getContext('webgl2'),scenes=[];
   for(const scene of engine.scenes){engine.select(scene.index);for(let i=0;i<3;i++)engine.frame(input,1/60);const error=gl.getError();if(error)throw new Error(scene.name+' : WebGL '+error);scenes.push(scene.name);}
   engine.destroy();gl.getExtension('WEBGL_lose_context')?.loseContext();canvas.remove();return scenes;
  });
  if(result.length!==39)throw new Error('Nombre de scènes inattendu : '+result.length);
  if(result.some(name=>/henry/i.test(name)))throw new Error('Toutes les scènes Henry doivent être exclues.');
  console.log('OK : les 39 scènes actives dsViz compilent et rendent sans erreur WebGL, y compris fluides et agents.');
 }finally{await app.close();await fs.rm(profile,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
