// Essai explicite avec la session TikTok existante et le lecteur YouTube officiel.
const { _electron } = require('playwright');
const assert = require('node:assert/strict');
(async () => {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ executablePath: '/Applications/Nocturne.app/Contents/MacOS/Nocturne', env });
  let page, savedVolume;
  try {
    page = await app.firstWindow(); await page.locator('.brand').waitFor();
    savedVolume = await page.locator('#volume').inputValue();
    await page.locator('#volume').fill('0'); await page.locator('#volume').dispatchEvent('input');
    if (await page.locator('#edits-switch').getAttribute('aria-checked') !== 'true') await page.locator('#edits-switch').click();
    await page.locator('#source-youtube').click();
    await page.locator('#youtube-query').fill('https://music.youtube.com/watch?v=-ed6UeDp1ek');
    await page.locator('#youtube-search-form button').click();
    let adSamples = 0;
    for (let i = 0; i < 90; i++) {
      const observation = await app.evaluate(async ({ webContents }) => {
        const w = webContents.getAllWebContents().find(w => /^https:\/\/consent\.(youtube|google)\.com/.test(w.getURL()));
        let consent = false;
        if (w) consent = await w.executeJavaScript(`(() => { const button = [...document.querySelectorAll('button')].find(b => /Reject all|Tout refuser|Refuser tout/i.test(b.textContent)); if (!button) return false; button.click(); return true; })()`, true);
        const music = webContents.getAllWebContents().find(w => w.getURL().startsWith('https://music.youtube.com'));
        const ad = music ? await music.executeJavaScript("Boolean(document.querySelector('#movie_player.ad-showing,#movie_player.ad-interrupting'))") : false;
        return { consent, ad };
      });
      if (observation.consent) console.log('Consentement : cookies facultatifs refusés.');
      if (observation.ad) adSamples++;
      const ready = await page.evaluate(() => current?.source === 'youtube' && document.querySelector('#edit-player video')?.currentTime > 0.3);
      if (ready) break;
      if (i === 89) throw new Error(await page.locator('#youtube-state').textContent() + ' / ' + await page.locator('#edit-status').textContent());
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    const state = await page.evaluate(() => ({ title: current.title, artist: current.artist, source: current.source, youtubePaused: window.youtubePlayback.media().paused, localPaused: audio.paused, editPlaying: !document.querySelector('#edit-player video').paused }));
    console.log('Bloqueur installé :', await page.evaluate(() => window.youtube.blockerStatus()), 'Publicités vidéo observées :', adSamples);
    console.log('Edit réel depuis YouTube Music :', state);
    assert.equal(state.source, 'youtube'); assert.equal(state.youtubePaused, true); assert.equal(state.localPaused, true); assert.equal(state.editPlaying, true);
    await page.waitForFunction(() => window.youtubePlayback.media().readyState >= 3 && window.youtubePlayback.media().currentTime > 20, null, { timeout: 30000 });
    await page.locator('#edit-player video').evaluate(v => { v.currentTime = v.duration - 0.2; });
    await page.waitForFunction(() => !usesEditAudio() && !window.youtubePlayback.media().paused, null, { timeout: 30000 });
    console.log('Reprise YouTube Music :', await page.evaluate(() => ({ position: window.youtubePlayback.media().currentTime, title: current.title, status: document.querySelector('#status').textContent })));
    await page.evaluate(() => pausePlayback()); await page.evaluate(() => window.youtube.command('pause'));
    console.log('OK : vrai morceau YouTube Music → edit TikTok réel → reprise YouTube Music.');
  } finally {
    if (page && savedVolume !== undefined) await page.evaluate(volume => { $('volume').value = volume; $('volume').dispatchEvent(new Event('input')); }, savedVolume).catch(() => {});
    await app.close();
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
