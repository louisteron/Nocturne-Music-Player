const { _electron } = require('playwright');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
(async () => {
  const root = path.resolve(__dirname, '..'), original = await fs.readFile(path.join(root, 'tests/fixtures/transition-song.wav'));
  for (const youtube of [false, true]) {
    const speed=youtube?.8:1, musicEnd=youtube?15:12, beforeFade=youtube?12.3:9.8;
    const clip=await fs.readFile(path.join(root, youtube?'tests/fixtures/transition-slow-outro.mp4':'tests/fixtures/transition-edit-outro.mp4'));
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'nocturne-crossfade-')); let app;
    try {
      const file = path.join(temp, 'song.wav'); await fs.writeFile(file, original);
      await fs.writeFile(path.join(temp, 'library.json'), JSON.stringify([{ id: 'one', title: 'Test', artist: 'Artist', album: 'Test', duration: 60, path: file }]));
      const env = { ...process.env, NOCTURNE_TEST_DATA: temp }; delete env.ELECTRON_RUN_AS_NODE;
      app = await _electron.launch({ args: [root], env }); const page = await app.firstWindow(); page.setDefaultTimeout(15000);
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      await app.evaluate(({ app, ipcMain, protocol, session, BrowserWindow }, { original, clip, youtube }) => {
        BrowserWindow.getAllWindows()[0].webContents.setAudioMuted(true);
        for (const name of ['edits:discover', 'edits:align']) ipcMain.removeHandler(name);
        ipcMain.handle('edits:discover', () => ({ status: 'ready', videos: [{ videoId: '7696071803420134687', streamAvailable: true }] }));
        const {createMatcher}=process.mainModule.require(app.getAppPath()+'/electron/audio-match.cjs');
        const decoder=process.mainModule.require(app.getAppPath()+'/electron/audio-decode.cjs').createTailDecoder(()=>BrowserWindow.getAllWindows()[0]);
        const matcher=createMatcher({app,session:session.defaultSession,decodeTail:decoder,youtubeResponse:async()=>new Response(Buffer.from(original,'base64')),clipResponse:async()=>new Response(Buffer.from(clip,'base64'))});
        ipcMain.handle('edits:align',async(_event,id)=>{
          await new Promise(resolve=>setTimeout(resolve,300));
          const result=await matcher.alignment({id,source:youtube?'youtube':'local',path:app.getPath('userData')+'/song.wav'},{videoId:'7696071803420134687'},new AbortController().signal);
          globalThis.realAlignment=result;return result;
        });
        protocol.unhandle('nocturne'); protocol.handle('nocturne', request => {
          const data = Buffer.from(request.url.includes('edit-video') ? clip : original, 'base64');
          const range = request.headers.get('range')?.match(/bytes=([0-9]+)-([0-9]*)/);
          const start = range ? Number(range[1]) : 0, end = range?.[2] ? Math.min(data.length - 1, Number(range[2])) : data.length - 1;
          return new Response(data.subarray(start, end + 1), { status: range ? 206 : 200, headers: { 'Content-Type': request.url.includes('edit-video') ? 'video/mp4' : 'audio/wav', 'Access-Control-Allow-Origin': 'null', 'Accept-Ranges': 'bytes', 'Content-Length': String(end - start + 1), ...(range ? { 'Content-Range': `bytes ${start}-${end}/${data.length}` } : {}) } });
        });
        if (youtube) session.fromPartition('persist:youtube-music').protocol.handle('https', () => new Response(`<!doctype html><ytmusic-player-bar><span class="title">Test</span><span class="byline"><a>Artist</a></span><a href="/watch?v=dQw4w9WgXcQ">Test</a></ytmusic-player-bar><video controls></video><script>const v=document.querySelector('video');v.src=URL.createObjectURL(new Blob([Uint8Array.from(atob('${original}'),c=>c.charCodeAt(0))],{type:'audio/wav'}));navigator.mediaSession.metadata=new MediaMetadata({title:'Test',artist:'Artist'});</script>`, { headers: { 'Content-Type': 'text/html' } }));
      }, { original: original.toString('base64'), clip: clip.toString('base64'), youtube });
      await page.reload();
      const remote = code => app.evaluate(async ({ webContents }, code) => {
        const w = webContents.getAllWebContents().find(w => w.getURL().startsWith('https://music.youtube.com')); w.setAudioMuted(true); return w.executeJavaScript(code, true);
      }, code);
      await page.locator('.brand').waitFor(); if (youtube) await page.locator('#edits-switch').click();
      if (youtube) {
        await page.locator('#source-youtube').click(); await page.waitForFunction(() => document.querySelector('#youtube-state').textContent.includes('Artist'));
        await remote("document.querySelector('video').play()");
      } else { await page.locator('.track-select').first().click(); await page.locator('#edits-switch').click(); }
      await page.locator('#edit-player video').waitFor();
      await page.waitForFunction(()=>document.querySelector('#edit-player video')?.dataset.preparing==='true');
      assert.equal(await page.locator('#edit-player video').evaluate(v=>v.paused&&v.currentTime===0),true,'La vidéo attend le vrai calage avant de démarrer');
      await page.waitForFunction(() => document.querySelector('#edit-status').textContent.includes('suite calée et chargée'),null,{timeout:45000});
      const alignment=await app.evaluate(()=>globalThis.realAlignment);assert.equal(alignment.syncVerified,true);assert.ok(alignment.fade);assert.ok(Math.abs(alignment.musicEndSeconds-musicEnd)<.2);assert.ok(Math.abs(alignment.positionSeconds+(alignment.musicEndSeconds-alignment.anchorSeconds)*alignment.speed-26)<.15,'Le calcul retrouve la véritable fin du passage à 26 s');
      if(youtube) await app.evaluate(({BrowserWindow})=>{const view=BrowserWindow.getAllWindows()[0].contentView.children.find(view=>view.webContents?.getURL().startsWith('https://music.youtube.com'));view.setVisible(false);});
      const getOriginal = () => youtube ? remote("(()=>{const v=document.querySelector('video');return {paused:v.paused,time:v.currentTime,volume:v.volume,rate:v.playbackRate,clock:Date.now()}})()") : page.locator('#audio').evaluate(v => ({ paused: v.paused, time: v.currentTime, volume: v.volume, rate: v.playbackRate,clock:Date.now() }));
      assert.equal((await getOriginal()).paused, true, 'Aucun son original avant le fade-out');
      await page.locator('#edit-player video').evaluate((v,time) => { v.currentTime = time; },beforeFade);
      await page.waitForFunction(() => window.editPlayback.isCrossfading());
      await page.waitForFunction(fade=>NocturneCrossfade.gainAt(fade,document.querySelector('#edit-player video').currentTime)>.45,alignment.fade);
      await new Promise(resolve => setTimeout(resolve, 120));
      let state = await getOriginal();
      assert.equal(state.paused, false, 'Le morceau joue avant la fin de la vidéo');
      const edit = await page.locator('#edit-player video').evaluate(v=>({time:v.currentTime,clock:Date.now()}));
      const drift=state.time+(edit.clock-state.clock)/1000*state.rate-(14+edit.time*speed);
      assert.ok(Math.abs(drift)<.08, `Décalage pendant le fondu, horloges corrigées : ${drift}`);
      console.log(`Décalage mesuré ${youtube?'YouTube':'local'} : ${Math.round(drift*1000)} ms.`);
      assert.ok(state.time > 24 && state.time < 26, `Calage pendant le chevauchement : ${state.time}`);
      assert.ok(state.volume > .01 && state.volume <= 1, `Fondu entrant progressif : ${state.volume}, ${JSON.stringify(await page.evaluate(()=>window.editPlayback.transitionState()))}`);
      await page.locator('#play').click(); await new Promise(resolve => setTimeout(resolve, 120));
      assert.equal((await getOriginal()).paused, true, 'Pause : les deux sources sont suspendues');
      await page.locator('#seek').fill('50'); await page.locator('#seek').dispatchEvent('input');
      await new Promise(resolve => setTimeout(resolve, 150));
      assert.equal((await getOriginal()).paused, true, 'Un retour avant le fade ne laisse pas le morceau jouer');
      await page.locator('#edit-player video').evaluate((v,time) => { v.currentTime = time; },beforeFade);
      await page.locator('#play').click();
      await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].minimize());
      await page.waitForFunction(() => !usesEditAudio());
      await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].restore());
      assert.ok(await page.locator('#edit-player video').evaluate((v,end)=>v.currentTime<end+.2 && v.duration>end+2.5 && v.paused,musicEnd), 'Le relais précède l’outro sonore');
      state = await getOriginal(); assert.equal(state.paused, false); assert.ok(state.time >= 25.7 && state.time < 27);
      await new Promise(resolve => setTimeout(resolve, 950));
      state = await getOriginal(); assert.equal(state.rate, 1); assert.ok(state.volume > .1 && state.volume <= 1, 'Niveau mesuré conservé après la vidéo');
      assert.equal(await page.locator('#volume').inputValue(), '0.75', 'Le fondu ne modifie pas le volume choisi');
      assert.equal(await page.evaluate(() => localStorage.getItem('volume')), null, 'Le fondu ne sauvegarde pas ses gains comme préférence');
      assert.deepEqual(errors, []);
      console.log(`OK : fondu ${youtube ? 'YouTube' : 'local'}, chevauchement calé, pause/reprise, outro ignorée, niveau normalisé et relais sans arrêt.`);
    } finally { await app?.close(); await fs.rm(temp, { recursive: true, force: true }); }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
