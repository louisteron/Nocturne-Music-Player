const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { EventEmitter } = require('node:events');
const { allowedNavigation, publicVideo, installTikTokSession } = require('../electron/tiktok-session.cjs');
const html = `<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__">${JSON.stringify({ __DEFAULT_SCOPE__: { 'webapp.app-context': { neverRead: 'private-context' }, 'webapp.video-detail': { itemInfo: { itemStruct: { id: '7696071803420134687', desc: 'Un edit #edit', video: { downloadAddr: 'https://webapp-no1a.tiktok.com/unavailable.mp4', playAddr: 'https://v16-webapp-prime.tiktok.com/video.mp4', bitrateInfo: [{ CodecType: 'h265_hvc1', PlayAddr: { UrlList: ['https://v16-webapp-prime.tiktok.com/unsupported.mp4'] } }] }, music: { id: '123', title: 'Test', authorName: 'Artiste', original: false }, author: { uniqueId: 'editor', nickname: 'Editor' } } } } } })}</script>`;
test('Session TikTok : navigation HTTPS bornée et extraction des seules métadonnées vidéo', () => {
  assert.equal(allowedNavigation('https://www.tiktok.com/login'), true);
  assert.equal(allowedNavigation('https://www.tiktok.com.evil.test/login'), false);
  assert.equal(allowedNavigation('file:///etc/passwd'), false);
  assert.equal(publicVideo(html).music_info.author, 'Artiste');
  assert.deepEqual(publicVideo(html).streamUrls, ['https://webapp-no1a.tiktok.com/unavailable.mp4', 'https://v16-webapp-prime.tiktok.com/video.mp4']);
  assert.equal(JSON.stringify(publicVideo(html)).includes('private-context'), false);
  assert.equal(publicVideo('<html>Se connecter</html>'), null);
});
test('Session gratuite : confirmation, recherche publique, cache et déconnexion sans lire les cookies', async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'nocturne-session-test-'));
  const handlers = new Map(); let window, navigations = 0, fetched = 0, cleared = 0, rejected = 0, expired = false, renewed = 0, pendingMode = false; const analysisSignals = [];
  class Browser extends EventEmitter {
    constructor(options) { super(); window = this; this.options = options; this.destroyed = false; this.webContents = new EventEmitter(); Object.assign(this.webContents, { setAudioMuted: () => {}, setWindowOpenHandler: () => {}, getURL: () => this.url, loadURL: async url => { this.url = url; navigations++; }, executeJavaScript: async script => { assert.ok(script.includes('querySelectorAll')); return { links: ['https://www.tiktok.com/@editor/video/7696071803420134687'], blocked: false }; } }); }
    loadURL(url) { return this.webContents.loadURL(url); }
    isDestroyed() { return this.destroyed; } show() {} focus() {} hide() {}
    close() { this.destroyed = true; this.emit('closed'); }
  }
  const session = { fetch: async (url, options) => { if (url === 'https://webapp-no1a.tiktok.com/unavailable.mp4') { rejected++; return new Response('Forbidden', { status: 403, headers: { 'content-type': 'application/json' } }); } if (url === 'https://v16-webapp-prime.tiktok.com/video.mp4' && expired) return new Response('Expired', { status: 403 }); if (url === 'https://v16-webapp-prime.tiktok.com/video.mp4' || url === 'https://v16-webapp-prime.tiktok.com/fresh.mp4') { if (url.endsWith('/fresh.mp4')) renewed++; assert.equal(options.headers.Referer, 'https://www.tiktok.com/'); assert.equal(options.headers.Range, 'bytes=0-3'); return new Response(new Uint8Array([1, 2, 3, 4]), { status: 206, headers: { 'content-type': 'video/mp4', 'content-range': 'bytes 0-3/4' } }); } assert.ok(url.startsWith('https://www.tiktok.com/@editor/video/')); fetched++; return new Response(expired ? html.replaceAll('/video.mp4', '/fresh.mp4') : html); }, clearStorageData: async options => { assert.equal(options.origin, 'https://www.tiktok.com'); cleared++; } };
  try {
    const integration = await installTikTokSession({ app: { getPath: () => profile }, BrowserWindow: Browser, ipcMain: { handle: (key, fn) => handlers.set(key, fn) }, authorize: () => {}, getTrack: id => id === 'one' ? { title: 'Test', artist: 'Artiste' } : null, matcher: { alignment: async (_track, video, signal) => { if (!pendingMode) return { matched: true, offsetSeconds: 42, videoId: video.videoId }; analysisSignals.push(signal); return new Promise(resolve => { if (signal.aborted) resolve({ matched: false }); else signal.addEventListener('abort', () => resolve({ matched: false }), { once: true }); }); } }, session, shell: { openExternal: async () => {} } });
    const discover = () => handlers.get('edits:discover')({}, 'one', false);
    assert.equal((await discover()).status, 'needs-login'); assert.equal(navigations, 0);
    await handlers.get('edits:session-connect')({}); assert.equal(window.url, 'https://www.tiktok.com/login'); assert.equal(window.options.webPreferences.nodeIntegration, false); assert.equal(window.options.webPreferences.sandbox, true);
    await handlers.get('edits:session-confirm')({}); const result = await discover(); assert.equal(result.videos.length, 1); assert.equal(fetched, 1);
    assert.equal((await discover()).cached, true); assert.equal(fetched, 1);
    assert.equal((await handlers.get('edits:align')({}, 'one', '7696071803420134687')).offsetSeconds, 42);
    await assert.rejects(handlers.get('edits:align')({}, 'one', '0000000000000000000'), /indisponible/);
    pendingMode = true;
    const foreground = handlers.get('edits:align')({}, 'one', '7696071803420134687');
    const background = handlers.get('edits:align')({}, 'one', '7696071803420134687', 'preload-candidate');
    handlers.get('edits:cancel-alignment')({}, 'preload-candidate');
    assert.equal((await background).cancelled, true);
    assert.equal(analysisSignals[0].aborted, false, 'Annuler un candidat ne coupe pas le calage du morceau actif');
    handlers.get('edits:cancel')({}); await foreground; pendingMode = false;

    const media = await integration.serve(new Request('nocturne://edit-video/7696071803420134687', { headers: { Range: 'bytes=0-3' } }), '7696071803420134687'); assert.equal(media.status, 206); assert.equal((await media.arrayBuffer()).byteLength, 4); assert.equal(rejected, 1);
    const again = await integration.serve(new Request('nocturne://edit-video/7696071803420134687', { headers: { Range: 'bytes=0-3' } }), '7696071803420134687'); assert.equal(again.status, 206); assert.equal(rejected, 1, 'Le lien valide doit être réutilisé'); await again.body.cancel();
    expired = true;
    const refreshed = await integration.serve(new Request('nocturne://edit-video/7696071803420134687', { headers: { Range: 'bytes=0-3' } }), '7696071803420134687'); assert.equal(refreshed.status, 206); assert.equal(renewed, 1, 'Renouveler les liens après un refus du CDN'); await refreshed.body.cancel();
    assert.equal((await handlers.get('edits:discover')({}, 'one', false, ['7696071803420134687'])).videos.length, 0);
    assert.equal((await discover()).videos.length, 1, 'Une recherche avec exclusions ne vide pas le cache des vidéos déjà trouvées');
    assert.equal((await handlers.get('edits:align')({}, 'one', '7696071803420134687')).matched, true, 'La vidéo préparée reste disponible après une recherche de secours');

    await handlers.get('edits:session-disconnect')({}); assert.equal(cleared, 1); assert.equal((await discover()).status, 'needs-login');
  } finally { await fs.rm(profile, { recursive: true, force: true }); }
});
