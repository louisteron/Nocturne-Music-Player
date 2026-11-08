const test = require('node:test');
const assert = require('node:assert/strict');
const { group } = require('../src/albums.js');
const { Volumio, serverAddress } = require('../electron/volumio.cjs');

test('albums : invités, disques, ordre numérique et dossiers sans tags', () => {
  const tracks = [
    { title: 'Dernier', artist: 'Invité', album: 'Nuit', folder: '/Nuit/CD2', discNumber: 2, trackNumber: 1 },
    { title: 'Dix', artist: 'Louis', album: 'Nuit', folder: '/Nuit/CD1', trackNumber: 10 },
    { title: 'Deux', artist: 'Louis', album: 'Nuit', folder: '/Nuit/CD1', trackNumber: 2 },
    { title: 'Un', artist: 'Louis', album: 'Nuit', folder: '/Nuit/CD1', trackNumber: 1 },
    { title: 'Sans tags', artist: 'Inconnu', album: 'Album inconnu', folderName: 'Autre', folder: '/Autre' }
  ];
  const albums = group(tracks);
  assert.equal(albums.length, 2);
  assert.equal(albums[1].artist, 'Artistes variés');
  assert.deepEqual(albums[1].tracks.map(track => track.title), ['Un', 'Deux', 'Dix', 'Dernier']);
});

test('Volumio : pagination, dossiers internes, cycles et URI Unicode', async () => {
  const calls = [];
  const client = new Volumio('http://volumio.local/playback', async url => {
    const u = new URL(url), uri = u.searchParams.get('uri'), offset = Number(u.searchParams.get('offset'));
    calls.push([uri, offset]);
    const songs = Array.from({ length: 205 }, (_, index) => ({ type: 'song', service: 'mpd', title: `Titre ${index + 1}`, uri: `music-library/INTERNAL/Été & nuit/${String(index + 1).padStart(3, '0')} titre.flac`, album: 'Été', artist: 'Louis', albumart: '/albumart?path=ete' }));
    const items = uri === 'music-library' ? [{ type: 'internal-folder', uri: 'music-library/INTERNAL' }] : uri === 'music-library/INTERNAL' ? [{ type: 'folder', uri: 'music-library/INTERNAL/Été & nuit' }, { type: 'folder', uri: 'music-library' }] : songs.slice(offset, offset + 200);
    return new Response(JSON.stringify({ navigation: { lists: [{ items, count: uri.includes('Été') ? 205 : items.length }] } }));
  });
  const tracks = await client.scan('music-library');
  assert.equal(tracks.length, 205);
  assert.equal(tracks[204].trackNumber, 205);
  assert.ok(calls.some(([, offset]) => offset === 200));
  assert.equal(client.audioUrl(tracks[0].uri), 'http://volumio.local/music/mnt/INTERNAL/%C3%89t%C3%A9%20%26%20nuit/001%20titre.flac');
  assert.throws(() => client.audioUrl('music-library/../../etc/passwd'));
  assert.throws(() => serverAddress('file:///etc/passwd'));
});

test('Volumio : une page répétée ou une annulation ne devient pas un succès partiel', async () => {
  const client = new Volumio('localhost', async () => new Response(JSON.stringify({ navigation: { lists: [{ count: 2, items: [{ type: 'song', uri: 'music-library/INTERNAL/01 test.mp3' }] }] } })));
  await assert.rejects(client.browse('music-library'), /répété/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(client.scan('music-library', { signal: controller.signal }));
});
