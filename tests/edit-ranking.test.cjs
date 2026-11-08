const test = require('node:test');
const assert = require('node:assert/strict');
const { rankVideos } = require('../electron/edit-ranking.cjs');
const track = { title: 'Let It Happen', artist: 'Tame Impala' };
const base = { video_id: '7696071803420134687', title: 'A cinematic edit #movie', music_info: { title: track.title, author: track.artist, original: false } };
test('Edits visuels : rejeter les paroles même avec le bon son ou des hashtags accolés', () => {
  for (const title of ['Let It Happen lyrics #edit', 'cinematic #songlyrics #edit', '#lyricedit', '#paroles #edit', '#karaoke #amv', '#textedit', '#typographyedit', 'edit traduction française', 'edit visualizer']) {
    assert.equal(rankVideos(track, [{ ...base, title }]).length, 0, title);
  }
});
test('Métadonnées : son exact prioritaire, titre ET artiste nécessaires pour un son original', () => {
  const caption = { ...base, video_id: '6718335390845095173', title: '#LetItHappen #TameImpala #animeedit', music_info: { title: 'original sound - editor', original: true } };
  const results = rankVideos(track, [caption, base]);
  assert.deepEqual(results.map(value => value.evidence), ['metadata', 'caption']);
  assert.equal(rankVideos(track, [{ ...caption, title: '#LetItHappen #animeedit' }]).length, 0);
  assert.equal(rankVideos(track, [{ ...caption, music_info: { title: 'Another song', author: 'Another artist', original: false } }]).length, 0);
  assert.equal(rankVideos(track, [{ ...base, images: [true] }, { ...base, is_ad: true }]).length, 0);
});
