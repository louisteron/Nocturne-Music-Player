const test = require('node:test'), assert = require('node:assert/strict');
const { detectFade, gainAt, levels } = require('../src/crossfade.js');
test('Fondu : repérer une descente progressive, ignorer coupe franche, silence et respiration', () => {
  for (const seconds of [1, 2, 4]) {
    const rms = Array.from({ length: 100 }, (_, i) => .2 * (i < 100 - seconds * 10 ? 1 : (100 - i) / (seconds * 10)));
    const fade = detectFade(rms, 20);
    assert.ok(fade); assert.ok(Math.abs(fade.startSeconds - (20 - seconds)) < .35);
    assert.equal(gainAt(fade, fade.startSeconds), 0); assert.equal(gainAt(fade, 20), 1);
    let previous = 0;
    for (let t = fade.startSeconds; t <= 20; t += .01) { const gain = gainAt(fade, t); assert.ok(gain >= previous && gain <= 1); previous = gain; }
  }
  assert.equal(detectFade(Array(100).fill(.2), 10), null);
  assert.equal(detectFade([...Array(95).fill(.2), ...Array(5).fill(0)], 10), null);
  assert.equal(detectFade(Array(100).fill(0), 10), null);
  assert.equal(detectFade([...Array(60).fill(.2), ...Array(10).fill(.04), ...Array(30).fill(.2)], 10), null);
});
test('Niveau sonore : mesure RMS indépendante de la polarité, sans normaliser un silence', () => {
  const pcm = Buffer.alloc(22050); for (let i = 0; i < 11025; i++) pcm.writeInt16LE(i % 2 ? 8192 : -8192, i * 2);
  for (const value of levels(pcm, 11025)) assert.ok(Math.abs(value - .25) < .00001);
  assert.equal(detectFade(levels(Buffer.alloc(220500), 11025), 10), null);
});
