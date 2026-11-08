const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

async function main() {
  const root = path.resolve(__dirname, '..');
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'nocturne-test-'));
  const profile = path.join(temp, 'profile');
  const music = path.join(temp, 'musique');
  await fs.mkdir(profile); await fs.mkdir(music);
  // Un vrai WAV PCM, 12 secondes : permet de tester décodage et déplacement.
  const samples = 44100 * 12;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(44100, 24); wav.writeUInt32LE(88200, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36);
  wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 220 / 44100) * 300), 44 + i * 2);
  const first = path.join(music, 'Première nuit.wav');
  const second = path.join(music, 'Second voyage.wav');
  await fs.writeFile(first, wav); await fs.writeFile(second, wav);
  await fs.writeFile(path.join(music, 'invalide.mp3'), 'invalid audio');
  const env = { ...process.env, NOCTURNE_TEST_DATA: profile };
  delete env.ELECTRON_RUN_AS_NODE;
  const launch = () => electron.launch({ args: [root], env });
  let app;
  try {
    app = await launch();
    let page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.locator('.empty').waitFor();
    await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, music);
    await page.locator('#folder').click();
    await page.waitForFunction(() => !document.querySelector('#folder').disabled);
    console.log('Import :', await page.locator('#status').innerText());
    assert.equal(await page.locator('.track').count(), 2);
    assert.match(await page.locator('#status').innerText(), /1 fichier/);
    await page.locator('.track-select').first().click();
    await page.waitForFunction(() => document.querySelector('#audio').currentTime > 0.2);
    assert.ok(await page.locator('#audio').evaluate(audio => Number.isFinite(audio.duration) && audio.duration >= 11.9));
    const activeId = await page.locator('#audio').evaluate(audio => new URL(audio.src).pathname.slice(1));
    const partial = await app.evaluate(async ({ net }, id) => {
      const response = await net.fetch(`nocturne://audio/${id}`, { headers: { Range: 'bytes=0-9' } });
      return { status: response.status, length: (await response.arrayBuffer()).byteLength, range: response.headers.get('content-range') };
    }, activeId);
    assert.equal(partial.status, 206); assert.equal(partial.length, 10);
    assert.match(partial.range, /^bytes 0-9\//);
    await page.locator('#play').click();
    assert.equal(await page.locator('#audio').evaluate(audio => audio.paused), true);
    await page.locator('#seek').fill('50');
    console.log('Progression :', await page.locator('#audio').evaluate(audio => ({ position: audio.currentTime, duration: audio.duration, range: document.querySelector('#seek').value, seekable: audio.seekable.length ? audio.seekable.end(0) : 0 })));
    await page.waitForFunction(() => document.querySelector('#audio').currentTime >= 5.8);
    await page.locator('#next').click();
    await page.waitForFunction(() => document.querySelector('#title').textContent === 'Second voyage');
    await page.locator('#volume').fill('0.3');
    await page.locator('#search').fill('Première');
    assert.equal(await page.locator('.track').count(), 1);
    await page.locator('#search').fill('introuvable');
    assert.match(await page.locator('.empty').innerText(), /Aucun résultat/);
    await page.locator('#search').fill('');
    // Réimporter le dossier ne duplique pas les morceaux.
    await page.locator('#folder').click();
    await page.waitForFunction(() => !document.querySelector('#folder').disabled);
    assert.equal(await page.locator('.track').count(), 2);
    await fs.mkdir(path.join(root, 'artifacts'), { recursive: true });
    await page.screenshot({ path: path.join(root, 'artifacts', 'nocturne-desktop.png') });
    assert.deepEqual(errors, []);
    await app.close(); app = await launch(); page = await app.firstWindow();
    await page.waitForFunction(() => document.querySelectorAll('.track').length === 2);
    assert.equal(await page.locator('#audio').evaluate(audio => audio.volume), 0.3);
    await page.locator('.track-select').first().click();
    await page.waitForFunction(() => document.querySelector('#audio').currentTime > 0.1);
    // Retirer un morceau conserve le fichier et arrête la lecture courante.
    await page.locator('.track.selected .remove').click();
    await page.waitForFunction(() => document.querySelectorAll('.track').length === 1);
    assert.equal(await page.locator('#audio').evaluate(audio => audio.paused), true);
    await fs.access(first);
    // Le protocole refuse tout fichier absent de la bibliothèque.
    const status = await app.evaluate(async ({ net }) => (await net.fetch('nocturne://audio/unknown')).status);
    assert.equal(status, 404);
    await fs.unlink(second);
    await page.locator('.track-select').click();
    await page.waitForFunction(() => /impossible|inaccessible/i.test(document.querySelector('#status').textContent));
    console.log('OK : import récursif, métadonnées, doublons, fichier invalide, lecture WAV, requêtes partielles, pause, progression, suivant, recherche, volume, persistance, retrait sans suppression, fichier déplacé et protocole restreint.');
  } finally {
    if (app) await app.close();
    await fs.rm(temp, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
