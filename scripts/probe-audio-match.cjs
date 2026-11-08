// Essai local explicite : aucune empreinte ni aucun audio ne sont envoyés.
const { _electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { Volumio } = require('../electron/volumio.cjs');
const run = promisify(execFile);
function bits(value) { value -= (value >>> 1) & 0x55555555; value = (value & 0x33333333) + ((value >>> 2) & 0x33333333); return (((value + (value >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24; }
function score(reference, clip) {
  if (reference.length < clip.length || clip.length < 24) return null;
  let best = Infinity, position = -1;
  for (let offset = 0; offset <= reference.length - clip.length; offset++) {
    let sum = 0;
    for (let index = 0; index < clip.length; index++) sum += bits((reference[offset + index] ^ clip[index]) >>> 0);
    if (sum / clip.length < best) { best = sum / clip.length; position = offset; }
  }
  return { distance: Math.round(best * 100) / 100, position, frames: clip.length };
}
(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'nocturne-audio-proof-'));
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  let app;
  try {
    const data = JSON.parse(await fs.readFile(path.resolve('artifacts/volumio-library.json'), 'utf8'));
    const track = data.tracks.find(t => t.title === 'Let It Happen' && t.artist === 'Tame Impala');
    const file = path.join(temp, 'original.flac');
    await run('curl', ['--fail', '--silent', '--show-error', '--connect-timeout', '5', '--max-time', '30', new Volumio(data.baseUrl).audioUrl(track.uri), '--output', file]);
    async function fingerprint(file) { const result = await run('/private/tmp/nocturne-fpcalc/chromaprint-fpcalc-1.6.2-macos-arm64/fpcalc', ['-json', '-raw', '-length', '0', file], { maxBuffer: 3000000 }); return JSON.parse(result.stdout).fingerprint; }
    const reference = await fingerprint(file); console.log('Empreinte locale calculée :', reference.length, 'trames.');
    app = await _electron.launch({ executablePath: '/Applications/Nocturne.app/Contents/MacOS/Nocturne', args: [], env });
    await app.firstWindow(); const pending = app.waitForEvent('window');
    await app.evaluate(({ BrowserWindow }) => { const w = new BrowserWindow({ show: false, width: 1080, height: 800, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } }); w.webContents.setAudioMuted(true); w.webContents.setWindowOpenHandler(() => ({ action: 'deny' })); w.loadURL('https://www.tiktok.com/search?q=Let%20It%20Happen%20Tame%20Impala%20edit'); });
    const page = await pending;
    await page.locator('[data-e2e="search_top-item-list"] [data-e2e="search_top-item"]').first().waitFor({ timeout: 25000 });
    const links = await page.locator('[data-e2e="search_top-item-list"] [data-e2e="search_top-item"] a[href*="/video/"]').evaluateAll(anchors => [...new Set(anchors.map(a => a.href))].slice(0, 10));
    for (let index = 0; index < links.length; index++) {
      const audio = await app.evaluate(async ({ session }, link) => {
        const response = await session.defaultSession.fetch(link, { redirect: 'error', signal: AbortSignal.timeout(8000) });
        const html = await response.text(); const raw = html.match(/<script\b[^>]*id=["']__UNIVERSAL_DATA_FOR_REHYDRATION__["'][^>]*>([\s\S]*?)<\/script>/i)?.[1];
        const item = raw ? JSON.parse(raw).__DEFAULT_SCOPE__?.['webapp.video-detail']?.itemInfo?.itemStruct : null;
        if (!item?.music?.playUrl || !/edit|amv|fmv/i.test(item.desc || '')) return null;
        const url = new URL(item.music.playUrl);
        if (url.protocol !== 'https:' || !/\.(?:tiktokcdn(?:-eu|-us)?\.com|tiktokv\.com|muscdn\.com|akamaized\.net)$/.test(url.hostname)) return null;
        const sound = await session.defaultSession.fetch(url.href, { redirect: 'error', signal: AbortSignal.timeout(12000) });
        if (!sound.ok) return { status: sound.status };
        const buffer = await sound.arrayBuffer(); if (buffer.byteLength > 15000000) return null;
        return { status: sound.status, body: Buffer.from(buffer).toString('base64') };
      }, links[index]);
      if (!audio?.body) { console.log('Extrait', index + 1, ': non disponible'); continue; }
      const sample = path.join(temp, `sample-${index}.mp3`); await fs.writeFile(sample, Buffer.from(audio.body, 'base64'));
      try { console.log('Extrait', index + 1, ':', JSON.stringify(score(reference, await fingerprint(sample)))); }
      catch { console.log('Extrait', index + 1, ': décodage impossible'); }
    }
  } finally { if (app) await app.close(); await fs.rm(temp, { recursive: true, force: true }); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
