const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ElectronBlocker, Request } = require('@ghostery/adblocker-electron');
const { cosmeticOrigin } = require('../electron/youtube-adblock.cjs');
test('Bloqueur fourni hors ligne : publicités bloquées, morceaux et connexion préservés', () => {
  const engine = ElectronBlocker.deserialize(new Uint8Array(fs.readFileSync(path.resolve('electron/filters/youtube-ads.bin'))));
  const blocked = (url, type = 'xmlhttprequest') => engine.match(Request.fromRawDetails({ url, sourceUrl: 'https://music.youtube.com/watch?v=dQw4w9WgXcQ', type })).match;
  assert.equal(blocked('https://googleads.g.doubleclick.net/pagead/ads?test=1'), true);
  assert.equal(blocked('https://www.youtube.com/pagead/ads?test=1'), true);
  assert.equal(blocked('https://music.youtube.com/watch?v=dQw4w9WgXcQ', 'main_frame'), false);
  assert.equal(blocked('https://rr1---sn.example.googlevideo.com/videoplayback?id=music', 'media'), false);
  assert.equal(blocked('https://accounts.google.com/ServiceLogin', 'main_frame'), false);
});
test('Filtres de page limités à YouTube : pas d’injection dans Google, TikTok ou Nocturne', () => {
  assert.equal(cosmeticOrigin('https://music.youtube.com/watch?v=dQw4w9WgXcQ'), true);
  assert.equal(cosmeticOrigin('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), true);
  for (const url of ['https://accounts.google.com', 'https://consent.youtube.com', 'https://www.tiktok.com', 'file:///app/src/index.html', 'https://music.youtube.com.evil.test']) assert.equal(cosmeticOrigin(url), false);
});
