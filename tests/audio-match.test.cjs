const test = require('node:test');
const assert = require('node:assert/strict');
const { compare, alignEnd, mediaUrl, fetchMedia } = require('../electron/audio-match.cjs');
test('Empreintes : extrait décalé reconnu, autre son rejeté, silence et clips trop courts exclus', () => {
  let seed = 123456;
  const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0; };
  const original = Array.from({ length: 500 }, random);
  assert.equal(compare(original, original.slice(120, 220)).matched, true);
  assert.equal(compare(original, original.slice(120, 220)).offset, 120);
  assert.equal(compare(original, original.slice(120, 220).map(value => value ^ 3)).matched, true);
  assert.equal(compare(original, Array.from({ length: 100 }, random)).matched, false);
  assert.equal(compare(original, new Array(100).fill(0)), null);
  assert.equal(compare(original, original.slice(0, 10)), null);
  const tail = original.slice(120, 320);
  assert.ok(Math.abs(alignEnd(original, tail).offsetSeconds - 120 * 1365 / 11025) < 1e-9);
  // Le début du montage peut contenir une autre scène ou une coupe musicale.
  const cut = [...Array.from({ length: 60 }, random), ...original.slice(200, 340)];
  assert.ok(Math.abs(alignEnd(original, cut).offsetSeconds - 140 * 1365 / 11025) < 1e-9);
  assert.equal(alignEnd(original, Array.from({ length: 200 }, random)).matched, false);
});
test('Reprise : dix dernières secondes, repli sur cinq et rejet des fins ambiguës', () => {
  let seed = 654321;
  const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0; };
  const reference = Array.from({ length: 1000 }, random);
  // Seules les ~10 dernières secondes sont communes ; le montage avant diffère.
  const ten = [...Array.from({ length: 141 }, random), ...reference.slice(400, 459)];
  const full = alignEnd(reference, ten);
  assert.equal(full.windowSeconds, 10);
  assert.ok(Math.abs(full.offsetSeconds - (400 - 141) * 1365 / 11025) < 1e-9);
  const five = [...Array.from({ length: 181 }, random), ...reference.slice(700, 719)];
  const short = alignEnd(reference, five);
  assert.equal(short.windowSeconds, 5);
  assert.ok(Math.abs(short.offsetSeconds - (700 - 181) * 1365 / 11025) < 1e-9);
  reference.splice(200, 19, ...reference.slice(700, 719));
  assert.equal(alignEnd(reference, five).matched, false, 'Une courte fin identique à plusieurs endroits est ambiguë');
});
test('Médias TikTok : destinations bornées, aucune redirection vers un service arbitraire', async () => {
  assert.ok(mediaUrl('https://v16.tiktokcdn.com/video/test'));
  assert.equal(mediaUrl('http://127.0.0.1/private'), null);
  assert.equal(mediaUrl('https://evil.test/video'), null);
  assert.equal(mediaUrl('https://tiktokcdn.com.evil.test/video'), null);
  assert.equal(mediaUrl('https://user:secret@v16.tiktokcdn.com/video'), null);
  await assert.rejects(fetchMedia({ fetch: async () => new Response(null, { status: 302, headers: { location: 'https://evil.test/steal' } }) }, 'https://v16.tiktokcdn.com/video/test'), /non autorisée/);
});
