const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');

async function main() {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'nocturne-volumio-'));
  const root = path.resolve(__dirname, '..');
  const wav = Buffer.alloc(44 + 44100 * 12 * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(44100, 24); wav.writeUInt32LE(88200, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
  let fail = false;
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push([req.method, req.url]);
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/music/')) {
      const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
      const start = range ? Number(range[1]) : 0, end = range?.[2] ? Math.min(Number(range[2]), wav.length - 1) : wav.length - 1;
      res.writeHead(range ? 206 : 200, { 'Content-Type': 'audio/wav', 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes', ...(range ? { 'Content-Range': `bytes ${start}-${end}/${wav.length}` } : {}) });
      res.end(wav.subarray(start, end + 1)); return;
    }
    res.setHeader('Content-Type', 'application/json');
    if (url.pathname.endsWith('/getState')) { res.end(JSON.stringify({ status: 'stop' })); return; }
    if (url.pathname.endsWith('/browse')) {
      const uri = url.searchParams.get('uri');
      if (fail && uri.includes('Album 02')) { res.writeHead(503); res.end('{}'); return; }
      const items = uri === 'music-library' ? [{ type: 'folder', title: 'INTERNAL', uri: 'music-library/INTERNAL' }] : uri === 'music-library/INTERNAL' ? [{ type: 'internal-folder', title: 'Collection', uri: 'music-library/INTERNAL/Collection' }] : uri.endsWith('/Collection') ? Array.from({ length: 12 }, (_, index) => ({ type: 'internal-folder', title: `Album ${String(index + 1).padStart(2, '0')}`, uri: `music-library/INTERNAL/Collection/Album ${String(index + 1).padStart(2, '0')}` })) : [2, 1].map(number => ({ type: 'song', service: 'mpd', title: `Morceau ${number}`, artist: 'Louis', album: uri.split('/').at(-1), uri: `${uri}/0${number} titre.wav` }));
      res.end(JSON.stringify({ navigation: { lists: [{ items, count: items.length }] } })); return;
    }
    res.writeHead(404); res.end('{}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = `http://127.0.0.1:${server.address().port}`;
  const env = { ...process.env, NOCTURNE_TEST_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  const launch = () => electron.launch({ args: [root], env });
  let app;
  try {
    app = await launch(); let page = await app.firstWindow();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.locator('#server-settings').click(); await page.locator('#server-address').fill(address); await page.locator('#connect-server').click();
    await page.locator('.server-folder').waitFor(); await page.locator('.server-folder').click();
    await page.getByRole('button', { name: '↳ Collection →' }).click();
    await page.waitForFunction(() => document.querySelectorAll('.server-folder').length === 12);
    assert.match(await page.locator('#breadcrumbs').innerText(), /INTERNAL/);
    await page.locator('#breadcrumbs button').first().click();
    await page.waitForFunction(() => document.querySelectorAll('#breadcrumbs button').length === 1);
    await page.locator('#import-server').click();
    await page.waitForFunction(() => document.querySelectorAll('.album-card').length === 12);
    assert.equal(await page.locator('.track').count(), 2);
    assert.match(await page.locator('#album-title').innerText(), /Album 01/);
    assert.match(await page.locator('.track-select').first().innerText(), /Morceau 1/);
    assert.equal(await page.locator('#audio').evaluate(audio => audio.paused), true);
    const scales = await page.locator('.album-card').evaluateAll(cards => cards.map(card => Number(card.style.getPropertyValue('--scale'))));
    assert.ok(scales[0] > scales[1]);
    await page.locator('#albums').hover(); await page.mouse.wheel(0, 360);
    await page.waitForFunction(() => !document.querySelector('#album-title').textContent.includes('Album 01'));
    await page.locator('#albums').focus(); await page.keyboard.press('End');
    await page.waitForFunction(() => document.querySelector('#album-title').textContent === 'Album 12');
    await page.keyboard.press('Home'); await page.waitForFunction(() => document.querySelector('#album-title').textContent === 'Album 01');
    await page.locator('#audio').evaluate(audio => audio.muted = true);
    await page.locator('#play-album').click(); await page.waitForFunction(() => document.querySelector('#audio').currentTime > 0.1);
    assert.equal(await page.locator('#mini-title').innerText(), 'Morceau 1');
    await page.locator('#play').click(); await page.locator('#seek').fill('50');
    await page.waitForFunction(() => document.querySelector('#audio').currentTime >= 5.8);
    await page.locator('#next').click(); await page.waitForFunction(() => document.querySelector('#mini-title').textContent === 'Morceau 2');
    await page.locator('#play').click();
    fail = true;
    const failure = await page.evaluate(() => window.volumio.sync('music-library').then(() => null, error => error.message));
    assert.match(failure, /503/); assert.equal((await page.evaluate(() => window.volumio.load())).tracks.length, 24);
    fail = false;
    assert.deepEqual(errors, []);
    await app.close(); app = await launch(); page = await app.firstWindow();
    await page.waitForFunction(() => document.querySelectorAll('.album-card').length === 12);
    assert.equal(await page.locator('#source-volumio').getAttribute('aria-pressed'), 'true');
    assert.ok(requests.every(([method, url]) => method === 'GET' && !url.includes('commands') && !url.includes('replaceAndPlay')));
    console.log('OK : connexion Volumio, dossiers imbriqués, synchronisation, tri par album/piste, défilement molette/clavier, agrandissement central, lecture réseau sur ordinateur, recherche et cache conservé en cas d’échec. Aucune commande de lecture envoyée au serveur.');
  } finally {
    if (app) await app.close();
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    await fs.rm(profile, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
