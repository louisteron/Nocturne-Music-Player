const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { parse, active } = require('../src/lrc.js');
const install = require('../electron/lyrics.cjs');

test('LRC : fractions, balises multiples, lignes vides, offset et recherche arrière', () => {
  const lines = parse('[ar:Test]\n[offset:500]\n[00:01.50][00:03.000]Premier\n[00:05]Second\n[00:06]\n[00:99]Invalide');
  assert.deepEqual(lines, [{ time: 1, text: 'Premier' }, { time: 2.5, text: 'Premier' }, { time: 4.5, text: 'Second' }, { time: 5.5, text: '' }]);
  assert.equal(active(lines, 0), -1); assert.equal(active(lines, 4.5), 2); assert.equal(active(lines, 2), 0);
  assert.deepEqual(parse('Pas de temps'), []);
});

test('Paroles : cache, requêtes groupées, import prioritaire et limitation du service', async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'nocturne-lyrics-unit-'));
  const handlers = new Map(); let requests = 0, limited = false;
  const tracks = [{ id: 'one', source: 'volumio', title: 'Test', artist: 'Artiste', album: 'Album' }, { id: 'two', source: 'volumio', title: 'Autre', artist: 'Artiste' }];
  const file = path.join(profile, 'manual.lrc'); await fs.writeFile(file, '[00:01]Import manuel');
  install({ app: { getPath: () => profile, getVersion: () => 'test' }, ipcMain: { handle: (key, fn) => handlers.set(key, fn) }, authorize: () => {}, getWindow: () => null, getTrack: id => tracks.find(track => track.id === id), dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [file] }) }, request: async () => { requests++; return limited ? new Response('{}', { status: 429, headers: { 'Retry-After': '60' } }) : new Response(JSON.stringify({ syncedLyrics: '[00:01]Première\n[00:05]Deuxième' })); } });
  try {
    const get = (id = 'one') => handlers.get('lyrics:get')({}, id, 12);
    const results = await Promise.all([get(), get()]); assert.equal(requests, 1); assert.equal(results[0].lines.length, 2);
    await get(); assert.equal(requests, 1);
    await handlers.get('lyrics:import')({}, 'one'); assert.equal((await get()).lines[0].text, 'Import manuel');
    limited = true; await assert.rejects(get('two'), /occupé/); await assert.rejects(get('two'), /limité/); assert.equal(requests, 2);
    await assert.rejects(get('unknown'), /indisponible/);
  } finally { await fs.rm(profile, { recursive: true, force: true }); }
});
