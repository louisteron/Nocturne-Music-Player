// Vrai décodeur Chromium + vrai fpcalc ; sons générés, sans réseau ni comptes.
const { _electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const execute = require('node:util').promisify(require('node:child_process').execFile);
const { decodeTail, wav } = require('../electron/audio-decode.cjs');
const { alignTail } = require('../electron/audio-match.cjs');
function music(seed) {
  const rate = 11025, pcm = Buffer.alloc(rate * 45 * 2);
  const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
  const notes = Array.from({ length: 200 }, () => 110 * 2 ** (Math.floor(random() * 30) / 12));
  for (let i = 0; i < pcm.length / 2; i++) {
    const t = i / rate, index = Math.floor(t * 4), f = notes[index], g = notes[(index + 17) % notes.length];
    const phase = t % .25, envelope = Math.min(1, phase * 150) * Math.exp(-phase * 3);
    const value = envelope * (.26 * Math.sin(2 * Math.PI * f * t) + .13 * Math.sin(2 * Math.PI * f * 2 * t) + .15 * Math.sin(2 * Math.PI * g * t)) + (random() - .5) * .08 * Math.exp(-phase * 45);
    pcm.writeInt16LE(Math.round(value * 32767), i * 2);
  }
  return pcm;
}
(async () => {
  const root = path.resolve(__dirname, '..'), temp = await fs.mkdtemp(path.join(os.tmpdir(), 'nocturne-audio-test-'));
  const binary = path.join(root, 'vendor/fpcalc', `${process.platform === 'darwin' ? 'mac' : 'win'}-${process.arch}`, process.platform === 'win32' ? 'fpcalc.exe' : 'fpcalc');
  const env = { ...process.env, NOCTURNE_TEST_DATA: temp }; delete env.ELECTRON_RUN_AS_NODE;
  let app;
  try {
    const pcm = music(1234567), original = path.join(temp, 'original.wav'); await fs.writeFile(original, wav(pcm, 11025));
    async function fingerprint(file) {
      let stdout;
      try { ({ stdout } = await execute(binary, ['-raw', '-json', '-length', '0', file], { maxBuffer: 5000000 })); }
      catch (error) { if (!error.stdout) throw error; stdout = error.stdout; }
      return JSON.parse(stdout).fingerprint;
    }
    const reference = await fingerprint(original);
    app = await _electron.launch({ args: [root], env }); const page = await app.firstWindow();
    for (const speed of [1, 1.125, .9]) {
      const file = wav(pcm.subarray(14 * 11025 * 2, 26 * 11025 * 2), Math.round(11025 * speed));
      const decoded = await page.evaluate(async ({ fn, body }) => eval(`(${fn})`)(body), { fn: decodeTail.toString(), body: file.toString('base64') });
      decoded.pcm = Buffer.from(decoded.pcm, 'base64');
      const result = await alignTail(reference, decoded, async (sample, rate) => {
        const file = path.join(temp, 'tail.wav'); await fs.writeFile(file, wav(sample, rate)); return fingerprint(file);
      });
      assert.equal(result.matched, true, `Extrait ${speed}× reconnu`);
      assert.ok(Math.abs(result.positionSeconds - 26) < .5, `Point attendu 26 s, obtenu ${result.positionSeconds}`);
      assert.ok(Math.abs(result.speed - speed) < .015, `Vitesse attendue ${speed}, obtenue ${result.speed}`);
      console.log(`OK : audio réel ${speed}× → reprise ${result.positionSeconds.toFixed(2)} s (attendue 26 s).`);
    }
  } finally { await app?.close(); await fs.rm(temp, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
