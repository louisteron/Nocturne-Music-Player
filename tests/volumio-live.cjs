const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');

(async () => {
  if (!process.env.VOLUMIO_URL) throw new Error('Définir VOLUMIO_URL avec l’adresse du serveur à tester.');
  const root = path.resolve(__dirname, '..');
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'nocturne-live-'));
  const env = { ...process.env, NOCTURNE_TEST_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: [root], env });
  try {
    const page = await app.firstWindow();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.exposeFunction('reportProgress', progress => { if (progress.folders % 25 === 0) console.log(`Volumio : ${progress.folders} dossiers, ${progress.tracks} morceaux.`); });
    await page.evaluate(() => window.volumio.onProgress(progress => window.reportProgress(progress)));
    await page.locator('#server-settings').click(); await page.locator('#server-address').fill(process.env.VOLUMIO_URL);
    await page.locator('#connect-server').click(); await page.locator('.server-folder').first().waitFor();
    await page.locator('#import-server').click();
    await page.waitForFunction(() => !document.querySelector('#volumio-dialog').open, null, { timeout: 240000 });
    const cache = await page.evaluate(() => window.volumio.load());
    assert.ok(cache.tracks.length > 0);
    await fs.mkdir(path.join(root, 'artifacts'), { recursive: true });
    await fs.writeFile(path.join(root, 'artifacts/volumio-library.json'), JSON.stringify(cache));
    const target = cache.tracks.find(track => track.uri.endsWith('03 Kanye West - Heartless.flac')) || cache.tracks.find(track => /\.(flac|mp3|wav)$/i.test(track.uri));
    await page.locator('#audio').evaluate(audio => audio.muted = true);
    await page.evaluate(track => select(track, [track]), target);
    await page.waitForFunction(() => document.querySelector('#audio').currentTime > 0.2, null, { timeout: 30000 });
    const duration = await page.locator('#audio').evaluate(audio => audio.duration);
    assert.ok(Number.isFinite(duration) && duration > 1);
    await page.locator('#play').click(); await page.locator('#seek').fill('50');
    await page.waitForFunction(() => document.querySelector('#audio').currentTime > document.querySelector('#audio').duration * 0.45);
    await page.locator('#search').fill(target.album);
    await page.waitForFunction(() => document.querySelectorAll('.album-card').length > 0);
    await page.locator('#search').fill('');
    await page.locator('#album-down').click();
    await page.waitForFunction(() => document.querySelector('#album-position').textContent.startsWith('02'));
    await page.screenshot({ path: path.join(root, 'artifacts/nocturne-volumio.png') });
    assert.deepEqual(errors, []);
    console.log(`OK réel : ${cache.tracks.length} morceaux, ${await page.locator('.album-card').count()} albums ; décodage audio sur l’ordinateur, durée ${Math.round(duration)} s, déplacement à 50 %. Cache préparé pour l’application.`);
  } finally {
    await app.close(); await fs.rm(profile, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
