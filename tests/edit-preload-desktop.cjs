const { _electron } = require('playwright');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
(async () => {
  const root = path.resolve(__dirname, '..');
  const original = await fs.readFile(path.join(root, 'tests/fixtures/transition-song.wav'));
  const clip = await fs.readFile(path.join(root, 'tests/fixtures/transition-edit-outro.mp4'));
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'nocturne-next-edit-'));
  let app;
  try {
    const song = path.join(profile, 'song.wav'); await fs.writeFile(song, original);
    const tracks = ['one', 'two', 'three'].map((id, i) => ({ id, title: 'Titre ' + (i + 1), artist: 'Artist', album: 'Album', duration: 45, path: song, trackNumber: i + 1 }));
    await fs.writeFile(path.join(profile, 'library.json'), JSON.stringify(tracks));
    const env = { ...process.env, NOCTURNE_TEST_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
    app = await _electron.launch({ args: [root], env }); const page = await app.firstWindow(); page.setDefaultTimeout(15000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await app.evaluate(({ app, ipcMain, protocol, BrowserWindow, session }, { original, clip, tracks }) => {
      BrowserWindow.getAllWindows()[0].webContents.setAudioMuted(true);
      globalThis.preloadCalls = { search: {}, align: {}, videos: {}, queries: [] };
      for (const name of ['edits:discover', 'edits:align']) ipcMain.removeHandler(name);
      ipcMain.handle('edits:discover', async (_event, id, force, excluded) => {
        globalThis.preloadCalls.search[id] = (globalThis.preloadCalls.search[id] || 0) + 1;
        globalThis.preloadCalls.queries.push({ id, force, excluded });
        await new Promise(resolve => setTimeout(resolve, 100));
        const ids = id === 'two' ? (force ? ['7000000000000000001', '7000000000000000002', '7000000000000000003'] : ['7000000000000000000', '7000000000000000001']) : [id === 'three' ? '7000000000000000004' : '7696071803420134687'];
        return { status: 'ready', videos: ids.map(videoId => ({ videoId, streamAvailable: true })) };
      });
      const { createMatcher } = process.mainModule.require(app.getAppPath() + '/electron/audio-match.cjs');
      const decodeTail = process.mainModule.require(app.getAppPath() + '/electron/audio-decode.cjs').createTailDecoder(() => BrowserWindow.getAllWindows()[0]);
      const matcher = createMatcher({ app, session: session.defaultSession, decodeTail, clipResponse: async () => new Response(Buffer.from(clip, 'base64')) });
      ipcMain.handle('edits:align', async (_event, id, videoId) => {
        globalThis.preloadCalls.align[id] = (globalThis.preloadCalls.align[id] || 0) + 1;
        globalThis.preloadCalls.videos[videoId] = (globalThis.preloadCalls.videos[videoId] || 0) + 1;
        if (videoId === '7000000000000000000') { await new Promise(resolve => setTimeout(resolve, 100)); return { matched: false }; }
        if (videoId === '7000000000000000001') { await new Promise(resolve => setTimeout(resolve, 2000)); return { matched: false }; }
        if (id === 'three' && globalThis.failThree) return { matched: false };
        return matcher.alignment(tracks.find(track => track.id === id), { videoId }, new AbortController().signal);
      });
      protocol.unhandle('nocturne'); protocol.handle('nocturne', async request => {
        if (request.url.includes('edit-video/7000000000000000000')) await new Promise(resolve => { globalThis.releaseBadVideo = resolve; });
        if (request.url.includes('edit-video/7000000000000000001')) return new Response(null, { status: 404 });
        const video = request.url.includes('edit-video');
        const data = Buffer.from(video ? clip : original, 'base64');
        const range = request.headers.get('range')?.match(/bytes=([0-9]+)-([0-9]*)/);
        const start = range ? Number(range[1]) : 0, end = range?.[2] ? Math.min(data.length - 1, Number(range[2])) : data.length - 1;
        return new Response(data.subarray(start, end + 1), { status: range ? 206 : 200, headers: { 'Content-Type': video ? 'video/mp4' : 'audio/wav', 'Access-Control-Allow-Origin': 'null', 'Accept-Ranges': 'bytes', 'Content-Length': String(end - start + 1), ...(range ? { 'Content-Range': `bytes ${start}-${end}/${data.length}` } : {}) } });
      });
    }, { original: original.toString('base64'), clip: clip.toString('base64'), tracks });
    await page.reload();
    await page.locator('.track-select').first().waitFor();
    await page.locator('.track-select').first().click(); await page.locator('#edits-switch').click();
    await page.waitForFunction(() => window.editPlayback.upcomingState().ready, null, { timeout: 45000 });
    assert.equal(await page.evaluate(() => window.editPlayback.upcomingState().id), 'two');
    assert.equal(await page.evaluate(() => current.id), 'one');
    assert.equal(await page.locator('#edit-player video').evaluate(video => video.paused), false);
    await page.waitForFunction(() => window.editPlayback.upcomingState().backupReady, null, { timeout: 45000 });
    assert.deepEqual(await app.evaluate(() => ({ search: globalThis.preloadCalls.search.two, align: globalThis.preloadCalls.align.two })), { search: 2, align: 4 });
    assert.equal(await page.evaluate(() => window.editPlayback.upcomingState().rejected), 2);
    assert.deepEqual(await app.evaluate(() => globalThis.preloadCalls.queries.filter(query => query.id === 'two')[1].excluded), ['7000000000000000000', '7000000000000000001']);
    await app.evaluate(() => globalThis.releaseBadVideo?.());
    // Rejoindre vraiment la suite du premier morceau, puis laisser son événement ended avancer la file.
    if (await page.evaluate(() => usesEditAudio())) {
      await page.locator('#edit-player video').evaluate(video => { video.currentTime = 10; });
      await page.waitForFunction(() => !usesEditAudio(), null, { timeout: 10000 });
    }
    await page.evaluate(() => { if (audio.paused) return audio.play(); });
    await page.evaluate(() => {
      window.oldAudio = audio;
      audio.addEventListener('ended', () => { window.endedAt = performance.now(); }, { once: true });
      const observer = new MutationObserver(() => {
        const video = document.querySelector('#edit-player video');
        if (current.id === 'two' && video && video !== window.firstVideo) {
          video.addEventListener('playing', () => { window.nextPlayingAt = performance.now(); }, { once: true }); observer.disconnect();
        }
      });
      window.firstVideo = document.querySelector('#edit-player video'); observer.observe(document.querySelector('#edit-player'), { childList: true });
      audio.currentTime = audio.duration - .15;
    });
    try { await page.waitForFunction(() => current.id === 'two' && window.nextPlayingAt); } catch(error) { console.log(await page.evaluate(()=>({current:current?.id,endedAt:window.endedAt,nextPlayingAt:window.nextPlayingAt,upcoming:window.editPlayback.upcomingState(),state:window.editPlayback.transitionState(),status:document.querySelector('#edit-status').textContent,audio:{time:audio.currentTime,paused:audio.paused,ready:audio.readyState,src:audio.getAttribute('src')},errors:document.querySelector('#status').textContent})));console.log(errors);throw error; }
    const result = await page.evaluate(() => ({ gap: window.nextPlayingAt - window.endedAt, replaced: audio !== window.oldAudio, time: audio.currentTime, ready: audio.readyState }));
    assert.equal(result.replaced, true, 'Réutiliser le véritable élément audio déjà tamponné');
    assert.ok(result.gap >= 0 && result.gap < 250, `Relais trop lent : ${result.gap.toFixed(0)} ms`);
    assert.ok(result.time > 20 && result.ready >= 3, 'Le passage de la suite est prêt sans nouveau seek réseau');
    assert.deepEqual(await app.evaluate(() => ({ search: globalThis.preloadCalls.search.two, align: globalThis.preloadCalls.align.two })), { search: 2, align: 4 }, 'Aucune nouvelle recherche/analyse lors du relais');
    assert.equal(await page.locator('#edit-player video').evaluate(video => video.src.endsWith('7000000000000000002')), true, 'Le premier edit validé est celui du relais');
    const rescuedAt = await page.locator('#edit-player video').evaluate(video => {
      const start = performance.now();
      new MutationObserver((changes, observer) => { const replacement = document.querySelector('#edit-player video'); if (replacement && replacement !== video) { replacement.addEventListener('playing', () => { window.backupGap = performance.now() - start; }, { once: true }); observer.disconnect(); } }).observe(document.querySelector('#edit-player'), { childList: true });
      video.dispatchEvent(new Event('error')); return start;
    });
    await page.waitForFunction(() => Number.isFinite(window.backupGap));
    assert.ok(await page.evaluate(() => window.backupGap < 250), 'Le secours déjà calé remplace une vidéo refusée sans nouvelle recherche');
    assert.equal(await page.locator('#edit-player video').evaluate(video => video.src.endsWith('7000000000000000003')), true);
    assert.deepEqual(await app.evaluate(() => ({ search: globalThis.preloadCalls.search.two, align: globalThis.preloadCalls.align.two })), { search: 2, align: 4 });
    await page.waitForFunction(() => window.editPlayback.upcomingState().ready, null, { timeout: 45000 });
    assert.equal(await page.evaluate(() => window.editPlayback.upcomingState().id), 'three');
    await page.locator('#shuffle').click();
    await page.waitForFunction(() => window.editPlayback.upcomingState().ready, null, { timeout: 45000 });
    assert.equal(await page.evaluate(() => window.editPlayback.upcomingState().id === upcomingTrack().id), true, 'Le tirage préparé est celui de la prochaine lecture');
    await app.evaluate(() => { globalThis.failThree = true; });
    await page.evaluate(() => { shuffled = false; queue = [current, tracks[0]]; queueChanged(); });
    await page.evaluate(() => { queue = [current, tracks[2]]; queueChanged(); });
    await page.waitForFunction(() => window.editPlayback.upcomingState().phase === 'exhausted', null, { timeout: 45000 });
    const callsBefore = await app.evaluate(() => ({ search: globalThis.preloadCalls.search.three, align: globalThis.preloadCalls.align.three }));
    assert.equal(await page.evaluate(() => current.id), 'two', 'Un prochain titre sans edit reconnu ne coupe pas celui en lecture');
    await page.locator('#next').click();
    await page.waitForFunction(() => document.querySelector('#edit-status').textContent.includes('vérifiés à l’avance'));
    assert.deepEqual(await app.evaluate(() => ({ search: globalThis.preloadCalls.search.three, align: globalThis.preloadCalls.align.three })), callsBefore, 'Ne pas retenter les edits déjà refusés au relais');
    assert.equal(await page.locator('#edit-player video').count(), 0);
    assert.equal(await page.evaluate(() => audio.paused), true);
    await page.locator('#edits-switch').click();
    assert.equal(await page.evaluate(() => window.editPlayback.upcomingState().id), undefined, 'Désactiver Edits libère les tampons');
    assert.deepEqual(errors, []);
    console.log(`OK : recherche et vrai calage anticipés, audio et vidéo réutilisés sans double analyse, relais automatique en ${result.gap.toFixed(0)} ms, edits non reconnus et vidéo refusée écartés en avance, recherche renouvelée avec exclusions, secours immédiat, aucun rejeu des échecs, tirage aléatoire cohérent et libération des tampons.`);
  } finally { if (app) await app.close(); await fs.rm(profile, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
