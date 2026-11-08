// Test explicite de la session existante ; ne lit aucun identifiant de connexion.
const { _electron } = require('playwright');
const assert = require('node:assert/strict');
(async () => {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ executablePath: '/Applications/Nocturne.app/Contents/MacOS/Nocturne', env });
  let page, savedVolume;
  try {
    page = await app.firstWindow(); await page.locator('.brand').waitFor(); savedVolume = await page.locator('#audio').evaluate(a => a.volume);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setAudioMuted(true));
    await page.exposeFunction('reportProgress', value => console.log(value.text));
    await page.evaluate(() => window.edits.onProgress(window.reportProgress));
    const started = Date.now();
    const result = await page.evaluate(async options => {
      const library = await window.volumio.load();
      const track = library.tracks.find(t => options.artist ? t.artist.toLowerCase() === options.artist.toLowerCase() && (!options.title || t.title === options.title) : t.title === 'Let It Happen' && t.artist === 'Tame Impala');
      if (!track) throw new Error('Morceau de test absent.');
      const found = await window.edits.discover(track.id, options.fresh);
      return { id: track.id, track: track.title, artist: track.artist, status: found.status, videos: found.videos.map(v => ({ evidence: v.evidence, title: v.title.slice(0, 160), streamAvailable: v.streamAvailable })) };
    }, { fresh: process.argv.includes('--fresh'), artist: process.env.NOCTURNE_LIVE_ARTIST, title: process.env.NOCTURNE_LIVE_TITLE });
    console.log('Durée recherche :', (Date.now() - started) / 1000, 's');
    console.log('Recherche :', JSON.stringify(result));
    assert.ok(result.videos.some(v => v.streamAvailable), 'Aucun edit lisible trouvé');
    await page.evaluate(async id => {
      const library = await window.volumio.load(); const track = library.tracks.find(t => t.id === id);
      audio.muted = true;
      if (document.querySelector('#edits-switch').getAttribute('aria-checked') !== 'true') document.querySelector('#edits-switch').click();
      window.earlyAudio = [];
      audio.addEventListener('play', () => { if (usesEditAudio()) window.earlyAudio.push('Le fichier de la bibliothèque a démarré pendant l’edit'); });
      select(track, [track]);
      if (!audio.paused || audio.currentTime !== 0) throw new Error('La musique ne patiente pas');
    }, result.id);
    try { await page.waitForFunction(() => document.querySelector('#edit-player video')?.currentTime > 0.3 || document.querySelector('#edit-player video')?.error, null, { timeout: 60000 }); } catch (error) { console.log('État lecteur :', await page.evaluate(() => { const v = document.querySelector('#edit-player video'); return { status: document.querySelector('#edit-status').textContent, video: v && { ready: v.readyState, network: v.networkState, error: v.error?.code, paused: v.paused }, audioPaused: audio.paused }; })); throw error; }
    assert.ok(await page.locator('#edit-player video').evaluate(v => v.currentTime > 0.3), 'La vidéo ne démarre pas');
    console.log('Lecture :', await page.locator('#edit-player video').evaluate(v => ({ time: v.currentTime, duration: v.duration, muted: v.muted, audioBytes: v.webkitAudioDecodedByteCount, ready: v.readyState })));
    assert.equal(await page.locator('#audio').evaluate(a => a.paused), true);
    assert.equal(await page.locator('#edit-player video').evaluate(v => v.muted), false);
    await page.locator('#play').click();
    assert.equal(await page.locator('#edit-player video').evaluate(v => v.paused), true);
    await page.locator('#seek').fill('50'); await page.locator('#seek').dispatchEvent('input');
    assert.ok(await page.locator('#edit-player video').evaluate(v => Math.abs(v.currentTime - v.duration / 2) < 0.1));
    await page.locator('#volume').fill('0.3'); await page.locator('#volume').dispatchEvent('input');
    assert.ok(await page.locator('#edit-player video').evaluate(v => Math.abs(v.volume - 0.3) < 0.01));
    await page.locator('#play').click();
    await page.waitForFunction(() => !document.querySelector('#edit-player video').paused);
    assert.deepEqual(await page.evaluate(() => window.earlyAudio), []);
    if (process.argv.includes('--continuation')) {
      const model = await page.evaluate(async id => { const video = document.querySelector('#edit-player video'); return window.edits.align(id, new URL(video.src).pathname.slice(1)); }, result.id);
      console.log('Repérage :', model);
      await page.waitForFunction(() => audio.paused && !audio.seeking && audio.readyState >= 3 && audio.buffered.length && audio.buffered.end(audio.buffered.length - 1) >= Math.min(audio.duration - 0.05, audio.currentTime + 3), null, { timeout: 180000 });
      console.log('Suite préchargée pendant la vidéo :', await page.evaluate(() => ({ position: audio.currentTime, paused: audio.paused, buffered: audio.buffered.end(audio.buffered.length - 1), videoPlaying: !document.querySelector('#edit-player video').paused })));
      await page.evaluate(() => { document.querySelector('#edit-player video').addEventListener('ended', () => window.editEndedAt = performance.now(), { once: true }); audio.addEventListener('playing', () => window.originalPlayingAt = performance.now(), { once: true }); });
      await page.locator('#edit-player video').evaluate(v => { v.currentTime = v.duration - 0.15; });
      await page.waitForFunction(() => !usesEditAudio() && !audio.paused, null, { timeout: 180000 });
      const continuation = await page.evaluate(() => ({ position: audio.currentTime, duration: audio.duration, status: document.querySelector('#status').textContent, id: current.id, videoEnded: document.querySelector('#edit-player video').ended, transitionMs: window.originalPlayingAt - window.editEndedAt }));
      console.log('Suite du morceau :', continuation);
      assert.equal(continuation.id, result.id);
      assert.equal(continuation.videoEnded, true);
      if (model.matched) { const duration = await page.locator('#edit-player video').evaluate(v => v.duration); assert.ok(Math.abs(continuation.position - (model.offsetSeconds + duration)) < 1.5); }
    }
    await page.evaluate(() => pausePlayback());
    console.log('OK : recherche et lecture TikTok réelles ; son TikTok synchronisé, fichier local arrêté, pause/reprise, progression et volume.');
  } finally { if (page && savedVolume !== undefined) await page.evaluate(volume => { $('volume').value = volume; $('volume').dispatchEvent(new Event('input')); }, savedVolume).catch(() => {}); await app.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
