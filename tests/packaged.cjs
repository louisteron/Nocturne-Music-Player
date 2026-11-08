const { _electron: electron } = require('playwright');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const executablePath = process.argv[2] || path.resolve('dist/mac-arm64/Nocturne.app/Contents/MacOS/Nocturne');
  const app = await electron.launch({ executablePath, args: [], env });
  try {
    const page = await app.firstWindow();
    await page.locator('.brand').waitFor();
    assert.equal(await page.title(), 'Nocturne');
    const state = await page.evaluate(async () => ({ bridge: typeof window.library.import, volumio: typeof window.volumio.sync, lyrics: typeof window.lyrics.get, edits: typeof window.edits.discover, node: typeof require, library: Array.isArray(await window.library.load()) }));
    assert.deepEqual(state, { bridge: 'function', volumio: 'function', lyrics: 'function', edits: 'function', node: 'undefined', library: true });
    const prefs = await app.evaluate(({ BrowserWindow }) => {
      const options = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
      return { sandbox: options.sandbox, isolated: options.contextIsolation, node: options.nodeIntegration };
    });
    assert.deepEqual(prefs, { sandbox: true, isolated: true, node: false });
    console.log('Données utilisateur :', await app.evaluate(({ app }) => app.getPath('userData')));
    if (process.env.NOCTURNE_EXPECT_REMOTE) {
      const remote = await page.evaluate(() => window.volumio.load());
      assert.equal(remote.tracks.length, Number(process.env.NOCTURNE_EXPECT_REMOTE));
      await page.waitForFunction(() => document.querySelectorAll('.album-card').length > 0);
      await page.locator('#album-down').click();
      await page.waitForFunction(() => document.querySelector('#album-position').textContent.startsWith('02'));
      await page.waitForFunction(() => { const image = document.querySelector('.album-card.centered img'); return image?.complete && image.naturalWidth > 0; });
      const cover = await page.locator('.album-card.centered .cover').evaluate(node => ({ parent: node.getBoundingClientRect().height, image: node.querySelector('img').getBoundingClientRect().height }));
      console.log('Pochette :', cover);
      assert.ok(Math.abs(cover.parent - cover.image) < 2);
      await page.screenshot({ path: path.resolve('artifacts/nocturne-installed.png') });
      console.log(`OK : ${remote.tracks.length} morceaux Volumio disponibles dans l'application installée.`);
    }
    console.log('OK : application compilée ouverte, interface et bibliothèque disponibles, processus isolé.');
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
