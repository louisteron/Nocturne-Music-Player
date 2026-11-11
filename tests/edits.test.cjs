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

const { select: selectCandidates } = require('../src/edit-candidates.js');
const candidate = videoId => ({ videoId, streamAvailable: true });
test('Préchargement : rejeter les mauvais edits avant lecture, renouveler la recherche et préparer un secours', async () => {
  const searches = [], attempted = [], accepted = [], released = [];
  let releaseBackup;
  const backup = new Promise(resolve => { releaseBackup = resolve; });
  let firstReady;
  const ready = new Promise(resolve => { firstReady = resolve; });
  const job = selectCandidates({ signal: new AbortController().signal,
    discover: async (force, excluded) => { searches.push({ force, excluded }); return { status: 'ready', videos: (force ? ['bad-one', 'good', 'backup'] : ['bad-one', 'bad-two']).map(candidate) }; },
    prepare: async edit => { attempted.push(edit.videoId); if (edit.videoId.startsWith('bad')) throw new Error('Passage non reconnu'); if (edit.videoId === 'backup') await backup; return { edit }; },
    release: value => released.push(value), onReady: value => { accepted.push(value.edit.videoId); firstReady(); }
  });
  await ready;
  assert.deepEqual(accepted, ['good'], 'Le premier edit validé est disponible sans attendre son secours');
  assert.deepEqual(searches, [{ force: false, excluded: [] }, { force: true, excluded: ['bad-one', 'bad-two'] }]);
  releaseBackup(); const result = await job;
  assert.deepEqual(attempted, ['bad-one', 'bad-two', 'good', 'backup']);
  assert.deepEqual(accepted, ['good', 'backup']); assert.deepEqual(result.rejected, ['bad-one', 'bad-two']);
  assert.equal(result.status, 'ready'); assert.deepEqual(released, []);
});
test('Préchargement : une ancienne analyse ne peut pas remplacer le prochain edit après annulation', async () => {
  const controller = new AbortController(), accepted = [], released = [];
  let finish;
  const job = selectCandidates({ signal: controller.signal, discover: async () => ({ status: 'ready', videos: [candidate('old')] }),
    prepare: () => new Promise(resolve => { finish = resolve; }), release: value => released.push(value.edit.videoId), onReady: value => accepted.push(value) });
  await new Promise(setImmediate); controller.abort(); finish({ edit: candidate('old') });
  assert.equal((await job).status, 'cancelled'); assert.deepEqual(accepted, []); assert.deepEqual(released, ['old']);
});
test('Préchargement : budget borné et aucun edit refusé remis en lecture par défaut', async () => {
  const attempted = [], accepted = [];
  const result = await selectCandidates({ signal: new AbortController().signal, maxAttempts: 4,
    discover: async () => ({ status: 'ready', videos: ['one', 'two', 'three', 'four', 'five'].map(candidate) }),
    prepare: async edit => { attempted.push(edit.videoId); throw new Error('Non reconnu'); }, release() {}, onReady: value => accepted.push(value) });
  assert.deepEqual(attempted, ['one', 'two', 'three', 'four']); assert.deepEqual(accepted, []);
  assert.equal(result.status, 'exhausted'); assert.equal(result.rejected.length, 4);
});
