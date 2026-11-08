const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const install = require('../electron/volumio-ipc.cjs');
test('Volumio : distinguer fichier absent, refus et serveur arrêté ; conserver les réponses de plages', async () => {
  let status = 206;
  const server = http.createServer((_req, res) => {
    res.writeHead(status, { 'Content-Type': 'audio/flac', 'Content-Range': status === 416 ? 'bytes */4' : 'bytes 0-0/4' });
    res.end(status === 206 ? 'f' : '');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'nocturne-stream-'));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    await fs.writeFile(path.join(profile, 'volumio.json'), JSON.stringify({ baseUrl, tracks: [{ id: 'one', server: baseUrl, uri: 'music-library/INTERNAL/song.flac' }] }));
    const integration = await install({ app: { getPath: () => profile }, ipcMain: { handle: () => {} }, authorize: () => {}, getWindow: () => null });
    assert.equal((await integration.checkAudio('one')).status, 'available');
    status = 404; assert.equal((await integration.checkAudio('one')).status, 'missing');
    status = 503; assert.equal((await integration.checkAudio('one')).status, 'refused');
    let response = await integration.serve(new Request('nocturne://audio/one'), 'one', 'audio');
    assert.equal(response.status, 503);
    status = 416;
    response = await integration.serve(new Request('nocturne://audio/one', { headers: { Range: 'bytes=4-' } }), 'one', 'audio');
    assert.equal(response.status, 416); assert.equal(response.headers.get('content-range'), 'bytes */4');
    await new Promise(resolve => server.close(resolve));
    assert.equal((await integration.checkAudio('one')).status, 'offline');
    await assert.rejects(integration.checkAudio('unknown'), /indisponible/);
  } finally { server.close(); await fs.rm(profile, { recursive: true, force: true }); }
});
