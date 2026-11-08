const { _electron } = require('playwright');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'nocturne-adblock-live-'));
  const env = { ...process.env, NOCTURNE_TEST_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ args: [path.resolve('.')], env });
  try {
    const page = await app.firstWindow(); await page.locator('.brand').waitFor();
    await page.locator('#edits-switch').click(); // Garde le lecteur YouTube silencieux pendant cet essai.
    await page.locator('#source-youtube').click();
    await page.evaluate(() => window.youtube.search('https://music.youtube.com/watch?v=dQw4w9WgXcQ'));
    let adSamples = 0, ready = false;
    const start = Date.now();
    for (let i = 0; i < 120; i++) {
      const state = await app.evaluate(async ({ webContents }) => {
        const consent = webContents.getAllWebContents().find(w => /^https:\/\/consent\.(youtube|google)\.com/.test(w.getURL()));
        if (consent) await consent.executeJavaScript(`(() => { const b=[...document.querySelectorAll('button')].find(b=>/Reject all|Tout refuser|Refuser tout/i.test(b.textContent)); b?.click(); })()`, true);
        const music = webContents.getAllWebContents().find(w => w.getURL().startsWith('https://music.youtube.com'));
        if (!music) return null;
        return music.executeJavaScript(`({ad:Boolean(document.querySelector('#movie_player.ad-showing,#movie_player.ad-interrupting')),title:navigator.mediaSession?.metadata?.title,artist:navigator.mediaSession?.metadata?.artist,duration:document.querySelector('video')?.duration})`);
      });
      if (state?.ad) adSamples++;
      if (state && !state.ad && state.artist === 'Rick Astley' && state.duration > 30) { console.log('Lecture réelle :', state, 'en', Date.now() - start, 'ms'); ready = true; break; }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    const blocker = await page.evaluate(() => window.youtube.blockerStatus());
    console.log('Bloqueur :', blocker, 'Observations de publicité :', adSamples);
    assert.equal(blocker.enabled, true); assert.equal(blocker.ready, true); assert.equal(ready, true, 'Le morceau doit rester lisible');
    console.log('OK : filtre actif dans un profil neuf et musique officielle lisible.');
  } finally { await app.close(); await fs.rm(profile, { recursive: true, force: true }); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
