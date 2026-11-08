const { _electron }=require('playwright');const path=require('node:path');
(async()=>{
 const env={...process.env,NOCTURNE_TEST_DATA:path.join(require('node:os').homedir(),'Library/Application Support/nocturne-player')};delete env.ELECTRON_RUN_AS_NODE;
 const app=await _electron.launch(process.env.NOCTURNE_LIVE_INSTALLED ? {executablePath:'/Applications/Nocturne.app/Contents/MacOS/Nocturne',env} : {args:[path.resolve(__dirname,'..')],env});let page,edits;
 try {
  page=await app.firstWindow();page.setDefaultTimeout(20000);await page.locator('.brand').waitFor();
  edits=await page.locator('#edits-switch').getAttribute('aria-checked');if(edits==='true')await page.locator('#edits-switch').click();
  await page.locator('#source-youtube').click();await page.locator('#youtube-query').fill('https://music.youtube.com/watch?v=-ed6UeDp1ek');await page.locator('#youtube-search-form button').click();
  const remote=code=>app.evaluate(async({webContents},code)=>{const w=webContents.getAllWebContents().find(w=>w.getURL().startsWith('https://music.youtube.com'));if(!w)return null;w.setAudioMuted(true);return w.executeJavaScript(code,true);},code);
  for(let i=0;i<45;i++){
   const ready=await remote(`(()=>{const v=document.querySelector('video');if(!v||v.readyState<2)return false;v.volume=.75;v.play().catch(()=>{});return !v.paused;})()`);if(ready)break;await new Promise(r=>setTimeout(r,1000));
  }
  await page.waitForFunction(()=>current?.source==='youtube');await page.locator('#show-visualizer').click();
  await page.waitForFunction(()=>document.querySelector('#visualizer').dataset.signal==='live' && Number(document.querySelector('#visualizer').dataset.rms) > .003,null,{timeout:15000});
  console.log('YouTube réel :',await page.locator('#visualizer').evaluate(p=>({signal:p.dataset.signal,rms:p.dataset.rms,preset:p.dataset.preset,hue:p.dataset.hue})));
  console.log('Lecteur :',await remote(`(()=>{const v=document.querySelector('video');return {paused:v.paused,crossOrigin:v.crossOrigin,srcType:v.currentSrc.startsWith('blob:')?'blob':'url'};})()`));
 }finally{
  if(page){console.log('État final :',await page.locator('#visualizer-state').textContent().catch(()=>''));await page.evaluate(()=>{pausePlayback();window.youtube.command('pause').catch(()=>{});}).catch(()=>{});if(edits==='true'&&await page.locator('#edits-switch').getAttribute('aria-checked')!=='true')await page.locator('#edits-switch').click().catch(()=>{});}
  await app.close();
 }
})().catch(e=>{console.error(e.message);process.exitCode=1;});
