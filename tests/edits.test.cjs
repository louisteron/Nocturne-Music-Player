const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { videoId, resolveVideo, installEdits } = require('../electron/edits.cjs');
const link = 'https://www.tiktok.com/@sample/video/7696071803420134687';
test('TikTok : liens directs, liens courts et rejet des destinations étrangères', async () => {
  assert.equal(videoId(link + '?x=1'), '7696071803420134687');
  assert.equal((await resolveVideo('https://vm.tiktok.com/example/', async () => new Response(null, { status: 302, headers: { location: link } }))).id, '7696071803420134687');
  assert.throws(() => videoId('https://www.tiktok.com.evil.test/@x/video/7696071803420134687'));
  assert.throws(() => videoId('javascript:alert(1)'));
  assert.throws(() => videoId('https://user:password@www.tiktok.com/@x/video/7696071803420134687'));
  await assert.rejects(resolveVideo('https://vm.tiktok.com/example/', async () => new Response(null, { status: 302, headers: { location: 'https://example.com/private' } })), /TikTok/);
  await assert.rejects(resolveVideo('https://www.tiktok.com/@sample', async () => { throw new Error('Ne doit pas être appelé'); }), /vidéo/);
});
test('TikTok : associations persistantes par morceau, doublons, retrait et recherche ciblée', async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'nocturne-edits-unit-'));
  let handlers, requests = 0; const external = [];
  const install = async () => {
    handlers = new Map();
    await installEdits({ app: { getPath: () => profile }, ipcMain: { handle: (key, fn) => handlers.set(key, fn) }, authorize: () => {}, getTrack: id => id === 'one' ? { title: 'Titre & musique', artist: 'Artiste' } : null, shell: { openExternal: async url => external.push(url) }, request: async () => { requests++; return new Response(JSON.stringify({ type: 'video', embed_product_id: '7696071803420134687' })); } });
  };
  try {
    await install(); await handlers.get('edits:add')({}, 'one', link); await handlers.get('edits:add')({}, 'one', link);
    assert.equal(handlers.get('edits:get')({}, 'one').length, 1); assert.equal(requests, 2);
    await install(); assert.equal(handlers.get('edits:get')({}, 'one').length, 1);
    await handlers.get('edits:search')({}, 'one');
    assert.equal(new URL(external[0]).searchParams.get('q'), 'Titre & musique Artiste edit');
    await handlers.get('edits:open')({}, 'one', '7696071803420134687'); assert.equal(external[1], link);
    await assert.rejects(handlers.get('edits:open')({}, 'one', 'unknown'), /indisponible/);
    await assert.rejects(handlers.get('edits:add')({}, 'unknown', link), /morceau/);
    await handlers.get('edits:remove')({}, 'one', '7696071803420134687'); assert.deepEqual(handlers.get('edits:get')({}, 'one'), []);
  } finally { await fs.rm(profile, { recursive: true, force: true }); }
});
