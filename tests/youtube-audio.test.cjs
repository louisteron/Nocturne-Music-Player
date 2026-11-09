const test = require('node:test');
const assert = require('node:assert/strict');
const { audioUrl, unwrapUMP, fetchAudio } = require('../electron/youtube-audio.cjs');
function vint(value) {
  if (value < 128) return Buffer.from([value]);
  if (value < 16384) return Buffer.from([128 | (value & 63), value >> 6]);
  if (value < 2097152) return Buffer.from([192 | (value & 31), (value >> 5) & 255, value >> 13]);
  return Buffer.from([224 | (value & 15), (value >> 4) & 255, (value >> 12) & 255, value >> 20]);
}
const part = (type, data) => Buffer.concat([vint(type), vint(data.length), data]);
test('YouTube UMP : extraction des seules données média, gros blocs et troncatures refusées', () => {
  const small = Buffer.from([0, 1, 2, 3]);
  const big = Buffer.alloc(500000, 7); big[0] = 0;
  const buffer = Buffer.concat([part(58, Buffer.from([8, 1])), part(20, Buffer.from([1, 2, 3])), part(21, small), part(21, big), part(22, Buffer.from([0]))]);
  assert.deepEqual(unwrapUMP(buffer), Buffer.concat([small.subarray(1), big.subarray(1)]));
  assert.throws(() => unwrapUMP(buffer.subarray(0, buffer.length - 10)), /tronqué/);
  assert.throws(() => unwrapUMP(part(12, small)), /chiffré/);
  assert.throws(() => unwrapUMP(Buffer.from([255])), /invalide/);
});
test('Flux YouTube : borné aux pistes audio officielles, pas de redirection externe', async () => {
  const url = 'https://rr1---example.googlevideo.com/videoplayback?itag=251&clen=3';
  assert.ok(audioUrl(url));
  for (const invalid of ['http://127.0.0.1/videoplayback?itag=251', 'https://googlevideo.com.evil.test/videoplayback?itag=251', 'https://user@rr1.googlevideo.com/videoplayback?itag=251', 'https://rr1.googlevideo.com/videoplayback?itag=137']) assert.equal(audioUrl(invalid), null);
  const response = await fetchAudio({ fetch: async value => {
    assert.equal(new URL(value).searchParams.get('range'), '0-2');
    return new Response(part(21, Buffer.from([0, 1, 2, 3])), { headers: { 'Content-Type': 'application/vnd.yt-ump' } });
  } }, url);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.from([1, 2, 3]));
  await assert.rejects(fetchAudio({ fetch: async () => new Response(null, { status: 302, headers: { Location: 'https://evil.test' } }) }, url), /non autorisée/);
  await assert.rejects(fetchAudio({ fetch: async () => new Response('no', { headers: { 'Content-Type': 'text/plain' } }) }, url), /décodable/);
});
