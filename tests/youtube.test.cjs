const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { searchUrl, allowedNavigation, readPlayback, control } = require('../electron/youtube.cjs');
test('YouTube Music : recherche officielle et liens bornés', () => {
  assert.equal(new URL(searchUrl('Tame Impala')).searchParams.get('q'), 'Tame Impala');
  assert.equal(searchUrl('https://youtu.be/dQw4w9WgXcQ'), 'https://music.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.throws(() => searchUrl('https://evil.test/watch?v=dQw4w9WgXcQ'));
  assert.equal(allowedNavigation('https://accounts.google.com/ServiceLogin'), true);
  assert.equal(allowedNavigation('https://music.youtube.com.evil.test/'), false);
  assert.equal(allowedNavigation('file:///etc/passwd'), false);
});
test('YouTube Music : seules les métadonnées du lecteur sont lues, pas les pages de connexion ni les publicités', async () => {
  let queries = 0, ad = false;
  const media = { paused: false, currentTime: 3, duration: 100, volume: 0.7, muted: false, readyState: 4, buffered: { length: 1, start: () => 0, end: () => 10 } };
  const context = { location: { origin: 'https://music.youtube.com', href: 'https://music.youtube.com/watch?v=dQw4w9WgXcQ' }, navigator: { mediaSession: { metadata: { title: 'Titre', artist: 'Artiste', album: 'Album' } } }, URL, document: { querySelector: selector => { queries++; if (selector === 'ytmusic-player-bar') return { querySelector: () => null }; if (selector === 'video') return media; if (selector.includes('ad-showing')) return ad; throw new Error('Lecture inattendue'); } } };
  const run = () => vm.runInNewContext(`(${readPlayback.toString()})()`, context);
  assert.equal(run().title, 'Titre'); assert.equal(run().bufferedAhead, 7);
  ad = true; assert.equal(run().ad, true);
  context.location.origin = 'https://accounts.google.com'; queries = 0;
  assert.equal(run(), null); assert.equal(queries, 0);
  context.location.origin = 'https://music.youtube.com';
  await assert.rejects(vm.runInNewContext(`(${control.toString()})('seek', 20)`, context), /publicité/);
});
