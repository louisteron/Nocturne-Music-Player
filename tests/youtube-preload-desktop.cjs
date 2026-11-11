const { _electron } = require('playwright');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
(async () => {
  const root = path.resolve(__dirname, '..'), profile = await fs.mkdtemp(path.join(os.tmpdir(), 'nocturne-yt-next-'));
  let app;
  try {
    const original = await fs.readFile(path.join(root, 'tests/fixtures/transition-song.wav'));
    const second = Buffer.alloc(44 + Math.round(70 * original.readUInt32LE(28)));
    original.copy(second, 0, 0, 44); second.writeUInt32LE(second.length - 8, 4); second.writeUInt32LE(second.length - 44, 40);
    for (let offset = 44; offset < second.length; offset += original.length - 44) original.copy(second, offset, 44, Math.min(original.length, 44 + second.length - offset));
    const clip = await fs.readFile(path.join(root, 'tests/fixtures/transition-edit-outro.mp4'));
    const env = { ...process.env, NOCTURNE_TEST_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
    app = await _electron.launch({ args: [root], env }); const page = await app.firstWindow(); page.setDefaultTimeout(20000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await app.evaluate(({ app, session, ipcMain, protocol, BrowserWindow, WebContentsView }, { original, second, clip }) => {
      const main = BrowserWindow.getAllWindows()[0]; main.webContents.setAudioMuted(true);
      const firstData = Buffer.from(original, 'base64'), secondData = Buffer.from(second, 'base64');
      const html = `<!doctype html><ytmusic-player-bar><span class="title"></span><a class="song-link"></a><button class="next-button">Next</button><button class="previous-button">Previous</button></ytmusic-player-bar><ytmusic-player-queue></ytmusic-player-queue><div id="movie_player"></div><video controls></video><script>
      const ids=['aaaaaaaaaaa','bbbbbbbbbbb','ccccccccccc'];let index=Math.max(0,ids.indexOf(new URL(location.href).searchParams.get('v')));
      const v=document.querySelector('video'), nativePlay=v.play.bind(v);let primed=false,resetTimer;
      const ready=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'readyState').get;
      Object.defineProperty(v,'readyState',{get(){return index===1&&!primed&&ready.call(v)>=1?2:ready.call(v)}});
      v.play=()=>{if(index===1&&v.currentTime>50){primed=true;window.silentPrimed={time:v.currentTime,volume:v.volume,muted:v.muted}}return nativePlay()};
      function load(){const id=ids[index];history.replaceState({},'', '/watch?v='+id);navigator.mediaSession.metadata=new MediaMetadata({title:index===0?'Cico Buff':'Heaven or Las Vegas',artist:'Cocteau Twins'});document.querySelector('.song-link').href='/watch?v='+id;document.querySelector('.title').textContent='Titre '+(index+1);const q=document.querySelector('ytmusic-player-queue');q.replaceChildren();ids.forEach((id,i)=>{const row=document.createElement('ytmusic-player-queue-item');row.data={videoId:id,title:{runs:[{text:i===0?'Cico Buff':'Heaven or Las Vegas'}]},longBylineText:{runs:[{text:'Cocteau Twins'}]}};if(i===index)row.setAttribute('selected','');q.append(row)});document.querySelector('#movie_player').getPlayerResponse=()=>({videoDetails:{videoId:id,lengthSeconds:String(index===1?70:45)},streamingData:{adaptiveFormats:[{mimeType:'audio/wav',itag:140,lastModified:String(index+1)}]}});const loadAudio=()=>{primed=index!==1;v.src='https://r1---sn-test.googlevideo.com/videoplayback?itag=140&lmt='+(index+1)+'&clen='+(index===1?${secondData.length}:${firstData.length})};clearTimeout(resetTimer);if(index===1&&v.currentSrc)resetTimer=setTimeout(loadAudio,900);else loadAudio();}
      document.querySelector('.next-button').onclick=()=>{index=Math.min(ids.length-1,index+1);load();v.play().catch(()=>{})};document.querySelector('.previous-button').onclick=()=>{index=Math.max(0,index-1);load()};load();</script>`;
      session.fromPartition('persist:youtube-music').protocol.handle('https', request => {
        if (new URL(request.url).hostname.endsWith('.googlevideo.com')) {
          const data = new URL(request.url).searchParams.get('lmt') === '2' ? secondData : firstData;
          const range = request.headers.get('range')?.match(/bytes=([0-9]+)-([0-9]*)/);
          const start = range ? Number(range[1]) : 0, end = range?.[2] ? Math.min(data.length-1, Number(range[2])) : data.length-1;
          return new Response(data.subarray(start,end+1), { status: range?206:200, headers:{'Content-Type':'audio/wav','Accept-Ranges':'bytes','Content-Length':String(end-start+1),...(range?{'Content-Range':`bytes ${start}-${end}/${data.length}`}:{})} });
        }
        return new Response(html, { headers: { 'Content-Type': 'text/html' } });
      });
      // Instance isolée du service officiel pour vérifier le décodage du titre suivant.
      const handlers = new Map();
      const isolated = process.mainModule.require(app.getAppPath()+'/electron/youtube.cjs').installYouTube({app,session,WebContentsView,ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},authorize:()=>{},getWindow:()=>main});
      globalThis.referenceTest = { service: isolated, handlers };
      globalThis.nextCalls = { search: {}, align: {} };
      for(const name of ['edits:discover','edits:align'])ipcMain.removeHandler(name);
      ipcMain.handle('edits:discover',async(_event,id)=>{globalThis.nextCalls.search[id]=(globalThis.nextCalls.search[id]||0)+1;await new Promise(resolve=>setTimeout(resolve,300));return{status:'ready',videos:[{videoId:id.endsWith('bbbbbbbbbbb')?'7000000000000000002':'7000000000000000001',streamAvailable:true}]}});
      ipcMain.handle('edits:align',async(_event,id)=>{globalThis.nextCalls.align[id]=(globalThis.nextCalls.align[id]||0)+1;await new Promise(resolve=>setTimeout(resolve,300));return{matched:true,syncVerified:true,positionSeconds:id.endsWith('bbbbbbbbbbb')?60:26,anchorSeconds:12,musicEndSeconds:12,speed:1}});
      protocol.unhandle('nocturne');protocol.handle('nocturne',request=>{
        const data=Buffer.from(clip,'base64'),range=request.headers.get('range')?.match(/bytes=([0-9]+)-([0-9]*)/);
        const start=range?Number(range[1]):0,end=range?.[2]?Math.min(data.length-1,Number(range[2])):data.length-1;
        return new Response(data.subarray(start,end+1),{status:range?206:200,headers:{'Content-Type':'video/mp4','Access-Control-Allow-Origin':'null','Accept-Ranges':'bytes','Content-Length':String(end-start+1),...(range?{'Content-Range':`bytes ${start}-${end}/${data.length}`}:{})}});
      });
    }, { original: original.toString('base64'), second: second.toString('base64'), clip: clip.toString('base64') });
    const closingErrors = await app.evaluate(async ({ app, BrowserWindow, WebContentsView, session }) => {
      const errors = [], capture = error => errors.push(error.message);
      process.on('uncaughtException', capture);
      try {
        for (let attempt = 0; attempt < 2; attempt++) {
          const owner = new BrowserWindow({ show: false, webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true } });
          const handlers = new Map();
          const service = process.mainModule.require(app.getAppPath()+'/electron/youtube.cjs').installYouTube({app,session,WebContentsView,ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},authorize:()=>{},getWindow:()=>owner});
          handlers.get('youtube:layout')({}, null, true);
          if (attempt) await new Promise(setImmediate);
          owner.destroy(); service.close(); service.close();
          await new Promise(setImmediate);
        }
        return errors;
      } finally { process.removeListener('uncaughtException', capture); }
    });
    assert.deepEqual(closingErrors, [], 'La destruction native du parent ne doit pas provoquer d’exception');
    await app.evaluate(async()=>globalThis.referenceTest.handlers.get('youtube:search')({},'https://youtu.be/aaaaaaaaaaa'));
    await page.waitForFunction(()=>window.youtubePlayback.media().track?.videoId==='aaaaaaaaaaa');
    const reference = await app.evaluate(async({webContents})=>{
      const active=webContents.getAllWebContents().find(w=>w.getURL().includes('watch?v=aaaaaaaaaaa'));
      active.setAudioMuted(true);await active.executeJavaScript("document.querySelector('video').pause();document.querySelector('video').currentTime=7");
      const result=await globalThis.referenceTest.service.audioResponse({videoId:'bbbbbbbbbbb'},AbortSignal.timeout(20000));
      const bytes=(await result.arrayBuffer()).byteLength;
      const state=await active.executeJavaScript("({time:document.querySelector('video').currentTime,paused:document.querySelector('video').paused,id:new URL(location.href).searchParams.get('v')})");
      const references=webContents.getAllWebContents().filter(w=>w.getURL().includes('watch?v=bbbbbbbbbbb')).length;
      globalThis.referenceTest.service.close();return{bytes,state,references};
    });
    assert.equal(reference.bytes,second.length);assert.equal(reference.state.id,'aaaaaaaaaaa');assert.ok(Math.abs(reference.state.time-7)<.1);assert.equal(reference.state.paused,true);assert.equal(reference.references,0,'Le lecteur temporaire doit être fermé après téléchargement');
    await page.reload();await page.locator('#edits-switch').click();await page.locator('#source-youtube').click();
    await page.waitForFunction(()=>window.youtubePlayback.media().track?.videoId==='aaaaaaaaaaa');
    const remote=code=>app.evaluate(({webContents},code)=>{const w=webContents.getAllWebContents().find(w=>w.getURL().includes('watch?v=aaaaaaaaaaa'));w.setAudioMuted(true);return w.executeJavaScript(code,true)},code);
    await remote("document.querySelector('video').play()");
    try { await page.waitForFunction(()=>window.editPlayback.upcomingState().ready); } catch(error) { console.log(await page.evaluate(()=>({current:current?.id,status:document.querySelector('#edit-status').textContent,upcoming:window.editPlayback.upcomingState(),media:window.youtubePlayback.media()})));throw error; }
    assert.equal(await page.evaluate(()=>window.editPlayback.upcomingState().id),'youtube:bbbbbbbbbbb');
    await page.locator('#edit-player video').evaluate(v=>{v.currentTime=12.1});
    await page.waitForFunction(()=>!usesEditAudio());
    await page.evaluate(()=>{
      const previous=document.querySelector('#edit-player video');
      const observer=new MutationObserver(()=>{const video=document.querySelector('#edit-player video');if(current?.videoId==='bbbbbbbbbbb'&&video&&video!==previous){video.addEventListener('playing',()=>{window.nextVideoAt=Date.now()},{once:true});observer.disconnect()}});
      observer.observe(document.querySelector('#edit-player'),{childList:true});
    });
    const callsBeforeRelay=await app.evaluate(()=>({search:globalThis.nextCalls.search['youtube:bbbbbbbbbbb'],align:globalThis.nextCalls.align['youtube:bbbbbbbbbbb']}));
    const ending=await remote("(()=>{const v=document.querySelector('video');v.currentTime=44.2;return{clock:Date.now(),time:v.currentTime,duration:v.duration,rate:v.playbackRate}})()");
    await page.waitForFunction(()=>current?.videoId==='bbbbbbbbbbb'&&!document.querySelector('#edit-player video')?.paused);
    const next=await page.evaluate(()=>({at:window.nextVideoAt,id:current.id,prealigned:document.querySelector('#edit-player video').dataset.prealigned,playing:!document.querySelector('#edit-player video').paused}));
    assert.equal(next.prealigned,'true');assert.equal(next.playing,true);
    const gap=next.at-(ending.clock+(ending.duration-ending.time)/ending.rate*1000);assert.ok(Math.abs(gap)<250,`Relais YouTube trop tardif ou anticipé : ${gap.toFixed(0)} ms`);
    const calls=await app.evaluate(()=>({search:globalThis.nextCalls.search['youtube:bbbbbbbbbbb'],align:globalThis.nextCalls.align['youtube:bbbbbbbbbbb']}));
    assert.deepEqual(calls,callsBeforeRelay,'Le prochain edit YouTube démarre sans refaire la recherche ou le calage');
    await page.waitForFunction(()=>window.youtubePlayback.media().track?.videoId==='bbbbbbbbbbb'&&window.youtubePlayback.media().paused&&Math.abs(window.youtubePlayback.media().currentTime-60)<.15);
    const primed=await app.evaluate(({webContents})=>{const w=webContents.getAllWebContents().find(w=>w.getURL().includes('watch?v=bbbbbbbbbbb'));return w.executeJavaScript('window.silentPrimed')});
    assert.ok(primed&&primed.volume===0&&primed.muted,'Charger silencieusement le passage du deuxième titre');
    await page.locator('#edit-player video').evaluate(v=>{v.currentTime=12.1});
    try { await page.waitForFunction(()=>!usesEditAudio()&&!window.youtubePlayback.media().paused&&window.youtubePlayback.media().currentTime>=60&&window.youtubePlayback.media().currentTime<62); } catch(error) { console.log(await page.evaluate(()=>({status:document.querySelector('#edit-status').textContent,state:window.editPlayback.transitionState(),media:window.youtubePlayback.media(),pending:playbackPending})));throw error; }
    assert.equal(await page.evaluate(()=>current.videoId),'bbbbbbbbbbb','La suite est celle du deuxième titre');
    assert.deepEqual(errors,[]);
    console.log(`Relais YouTube entre deux morceaux : ${gap.toFixed(0)} ms.`);
    console.log('OK : file YouTube officielle, référence suivante téléchargée par une vue isolée muette puis fermée sans toucher la lecture active, edit préchargé démarré automatiquement, flux tardif réinitialisé, tampon débloqué en silence et vraie suite du deuxième titre à 60 s, aucun réseau réel.');
  }finally{if(app)await app.close();await fs.rm(profile,{recursive:true,force:true})}
})().catch(error=>{console.error(error);process.exitCode=1});
