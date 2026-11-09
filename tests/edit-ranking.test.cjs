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

test('Métadonnées : feat retiré et véritable artiste déduit des titres YouTube', () => {
  const { searchMetadata, cleanTitle } = require('../electron/search-metadata.cjs');
  assert.equal(cleanTitle('Popular (feat. Playboi Carti & Madonna)'), 'Popular');
  assert.equal(cleanTitle('Popular FEAT. Madonna'), 'Popular');
  assert.equal(cleanTitle('Song [ft. Guest] (Live)'), 'Song (Live)');
  assert.equal(cleanTitle('FEAT'), 'FEAT');
  const youtube = searchMetadata({ source: 'youtube', title: 'Playboi Carti - Timeless (feat. The Weeknd) (Official Audio)', artist: 'Fan uploads' });
  assert.equal(youtube.title, 'Timeless'); assert.equal(youtube.artist, 'Playboi Carti');
  assert.equal(searchMetadata({ source: 'youtube', title: 'Heartless – Kanye West', artist: 'Kanye West' }).title, 'Heartless');
  assert.equal(searchMetadata({ source: 'youtube', title: 'JAY-Z - Song', artist: 'Uploads' }).artist, 'JAY-Z');
  assert.equal(searchMetadata({ source: 'youtube', title: 'Song', artist: 'Uploader' }).artist, 'Uploader');
  assert.equal(searchMetadata({ title: 'Artist - Song', artist: 'Actual artist' }).title, 'Artist - Song');
  const videos = [{ video_id: '6718335390845095173', title: 'movie edit', music_info: { title: 'Timeless', author: 'Playboi Carti' } }];
  assert.equal(rankVideos(youtube, videos).length, 1);
});

test('Métadonnées : conserver les versions et éviter un second découpage', () => {
  const { searchMetadata } = require('../electron/search-metadata.cjs');
  const track = searchMetadata({ source: 'youtube', title: 'Song - Live', artist: 'Artist' });
  assert.equal(track.title, 'Song - Live'); assert.equal(track.artist, 'Artist');
  assert.deepEqual(searchMetadata(track), track);
});
test('Recherche TikTok : premier artiste, annotations retirées et crédits YouTube intégrés', () => {
  const { tiktokSearchMetadata, searchMetadata } = require('../electron/search-metadata.cjs');
  const track = { source:'youtube', title:'DISCO TOMORROW (Video) · Joey Valence & Brae', artist:'Uploads' };
  assert.equal(tiktokSearchMetadata(track).title, 'DISCO TOMORROW');
  assert.equal(tiktokSearchMetadata(track).artist, 'Joey Valence');
  assert.equal(tiktokSearchMetadata({title:'Song (Deluxe) [Official Video]',artist:'First, Second & Third'}).artist,'First');
  assert.equal(tiktokSearchMetadata({title:'Song (Deluxe) [Official Video]',artist:'First, Second'}).title,'Song');
  assert.equal(tiktokSearchMetadata({title:'ARE WE STILL FRIENDS?',artist:'Tyler, The Creator, Guest'}).artist,'Tyler, The Creator');
  assert.equal(tiktokSearchMetadata({title:'Song',artist:'Display credit',artists:[{name:'Real first artist'},{name:'Guest'}]}).artist,'Real first artist');
  assert.equal(searchMetadata(track).title.includes('(Video)'),true,'Les métadonnées générales restent intactes');
  assert.deepEqual(tiktokSearchMetadata(tiktokSearchMetadata(track)),tiktokSearchMetadata(track));
});
