const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { candidates, installDiscovery } = require('../electron/edit-discovery.cjs');
const track = { id: 'one', title: 'Heartless', artist: 'Kanye West' };
const video = { video_id: '7696071803420134687', title: 'A cinematic edit #edit', music_info: { id: '123', title: 'Heartless', author: 'Kanye West', original: false }, author: { unique_id: 'editor', nickname: 'Editor' } };
test('Recherche automatique : correspondance du son et exclusion des faux résultats', () => {
  const results = candidates(track, [video, video, { ...video, video_id: '6718335390845095173', music_info: { ...video.music_info, title: 'Heartless (sped up)' } }, { ...video, music_info: { ...video.music_info, author: 'Autre artiste' } }, { ...video, music_info: { ...video.music_info, original: true } }, { ...video, title: 'Clip officiel' }, { ...video, is_ad: true }]);
  assert.equal(results.length, 1); assert.equal(results[0].soundTitle, track.title); assert.equal(results[0].automatic, true);
  assert.equal(results[0].url, 'https://www.tiktok.com/@editor/video/7696071803420134687');
});
test('Service API : aucune recherche sans clé, clé opaque, cache, persistance et suppression', async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'nocturne-discovery-'));
  let handlers, calls = 0; const savedKey = 'unit-test-api-key';
  const safeStorage = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from([...value].reverse().join('')), decryptString: buffer => [...buffer.toString()].reverse().join('') };
  const install = async () => {
    handlers = new Map();
    await installDiscovery({ app: { getPath: () => profile }, ipcMain: { handle: (name, fn) => handlers.set(name, fn) }, authorize: () => {}, getTrack: id => id === 'one' ? track : null, safeStorage, shell: { openExternal: async () => {} }, request: async (url, options) => { calls++; assert.equal(new URL(url).hostname, 'api.tikliveapi.com'); assert.equal(options.headers['X-Api-Key'], savedKey); assert.equal(new URL(url).searchParams.get('keyword'), 'Heartless Kanye West edit'); return new Response(JSON.stringify({ videos: [video] })); } });
  };
  try {
    await install(); const discover = () => handlers.get('edits:discover')({}, 'one');
    assert.equal((await discover()).status, 'needs-key'); assert.equal(calls, 0);
    await handlers.get('edits:provider-save')({}, savedKey);
    assert.equal(handlers.get('edits:provider')({}).configured, true); assert.equal(JSON.stringify(handlers.get('edits:provider')({})).includes(savedKey), false);
    assert.equal((await fs.readFile(path.join(profile, 'edits-search-settings.json'), 'utf8')).includes(savedKey), false);
    assert.equal((await discover()).videos.length, 1); assert.equal((await discover()).cached, true); assert.equal(calls, 1);
    await install(); assert.equal(handlers.get('edits:provider')({}).configured, true); assert.equal((await discover()).cached, true); assert.equal(calls, 1);
    await handlers.get('edits:provider-remove')({}); assert.equal((await discover()).status, 'needs-key');
    await assert.rejects(handlers.get('edits:discover')({}, 'unknown'), /indisponible/);
  } finally { await fs.rm(profile, { recursive: true, force: true }); }
});
