const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');

(async () => {
  const root = path.resolve(__dirname, '..'), profile = await fs.mkdtemp(path.join(os.tmpdir(), 'nocturne-lyrics-e2e-'));
  const wav = Buffer.alloc(44 + 44100 * 12 * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(44100, 24); wav.writeUInt32LE(88200, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
  const file = path.join(profile, 'song.wav'); await fs.writeFile(file, wav);
  await fs.writeFile(path.join(profile, 'song.lrc'), '[00:00]Première ligne de test\n[00:03]Deuxième ligne de test\n[00:06]Troisième ligne de test\n[00:09]Dernière ligne de test');
  await fs.writeFile(path.join(profile, 'library.json'), JSON.stringify([{ id: 'lyrics-test', title: 'Test paroles', artist: 'Artiste', album: 'Album', path: file, duration: 12 }]));
  const env = { ...process.env, NOCTURNE_TEST_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: [root], env });
  try {
    const page = await app.firstWindow(); const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.locator('.track-select').waitFor(); await page.locator('#audio').evaluate(audio => audio.muted = true);
    const before = await page.locator('.disc-wrap').boundingBox();
    await page.locator('.track-select').click(); await page.waitForFunction(() => document.querySelector('#audio').currentTime > 0.1);
    await page.locator('#play').click(); await page.locator('#show-lyrics').click();
    await page.waitForFunction(() => document.querySelectorAll('.lyric-line').length === 4);
    assert.match(await page.locator('.lyric-line.active').innerText(), /Première/);
    await page.locator('#seek').fill('55'); await page.waitForFunction(() => document.querySelector('.lyric-line.active')?.textContent.includes('Troisième'));
    await page.locator('.lyric-line').nth(1).click(); await page.waitForFunction(() => document.querySelector('.lyric-line.active')?.textContent.includes('Deuxième'));
    assert.ok(Math.abs(await page.locator('#audio').evaluate(audio => audio.currentTime) - 3) < 0.2);
    await page.locator('#lyrics-later').click(); assert.match(await page.locator('#lyrics-offset').innerText(), /0,5/);
    const after = await page.locator('.disc-wrap').boundingBox(); assert.equal(before.width, after.width); assert.equal(before.height, after.height);
    await page.locator('#show-tracks').click(); await page.locator('#show-lyrics').click(); assert.equal(await page.locator('.lyric-line').count(), 4);
    assert.deepEqual(errors, []); await page.screenshot({ path: path.join(root, 'artifacts/nocturne-lyrics-test.png') });
    console.log('OK : LRC local, synchronisation de la ligne active, pause, recherche avant/arrière, clic sur ligne, décalage, onglets et CD inchangé.');
  } finally { await app.close(); await fs.rm(profile, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
