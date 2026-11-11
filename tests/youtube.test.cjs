const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { searchUrl, allowedNavigation, readPlayback, preparePlayback, control } = require('../electron/youtube.cjs');
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
  const context = { location: { origin: 'https://music.youtube.com', href: 'https://music.youtube.com/watch?v=dQw4w9WgXcQ' }, navigator: { mediaSession: { metadata: { title: 'Titre', artist: 'Artiste', album: 'Album' } } }, URL, document: { querySelector: selector => { queries++; if (selector === 'ytmusic-player-bar') return { querySelector: () => null }; if (selector === 'video') return media; if (selector === 'ytmusic-player-queue') return null; if (selector.includes('ad-showing')) return ad; throw new Error('Lecture inattendue'); } } };
  const run = () => vm.runInNewContext(`(${readPlayback.toString()})()`, context);
  assert.equal(run().title, 'Titre'); assert.equal(run().bufferedAhead, 7);
  ad = true; assert.equal(run().ad, true);
  context.location.origin = 'https://accounts.google.com'; queries = 0;
  assert.equal(run(), null); assert.equal(queries, 0);
  context.location.origin = 'https://music.youtube.com';
  await assert.rejects(vm.runInNewContext(`(${control.toString()})('seek', 20)`, context), /publicité/);
});

// Reproduire l'ordre natif : les enfants disparaissent avant BrowserWindow.closed.
function lifecycleFixture({ initialize = Promise.resolve(), created = () => {} } = {}) {
  const { EventEmitter } = require('node:events');
  const fs = require('node:fs'), path = require('node:path'), { createRequire } = require('node:module');
  const filename = path.resolve(__dirname, '../electron/youtube.cjs'), localRequire = createRequire(filename);
  const handlers = new Map(), timers = new Set(), views = [], sent = [];
  class Contents extends EventEmitter {
    constructor() { super(); this.destroyed = false; this.loads = []; this.execute = async () => null; }
    isDestroyed() { return this.destroyed; }
    close() { this.destroyed = true; }
    setAudioMuted() { assert.equal(this.destroyed, false, 'Ne pas modifier un lecteur détruit'); }
    setWindowOpenHandler() {}
    loadURL(url) { assert.equal(this.destroyed, false); this.loads.push(url); return Promise.resolve(); }
    executeJavaScript(code) { assert.equal(this.destroyed, false); return this.execute(code); }
    send(channel, value) { sent.push({ channel, value }); }
  }
  class View {
    constructor() { this.contents = new Contents(); views.push(this); created(this, views.length); }
    get webContents() { return this.contents.destroyed ? undefined : this.contents; }
    setVisible() {} setBounds() {}
  }
  function window() {
    const owner = new EventEmitter(), contents = new Contents();
    owner.destroyed = false; owner.children = [];
    Object.defineProperty(owner, 'webContents', { get: () => contents.destroyed ? undefined : contents });
    owner.contentView = { addChildView: child => owner.children.push(child) };
    owner.isDestroyed = () => owner.destroyed; owner.getContentSize = () => [800, 600];
    owner.destroy = () => { owner.children.forEach(child => child.contents.close()); contents.close(); owner.destroyed = true; owner.emit('closed'); };
    return owner;
  }
  let owner = window();
  const session = { webRequest: { onSendHeaders() {} }, setPermissionRequestHandler() {} };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports, URL, AbortSignal, process: { env: { NOCTURNE_TEST_DATA: 'fixture' } },
    require: name => name === './youtube-adblock.cjs' ? { createYouTubeBlocker: () => ({ initialize: () => initialize }) } : localRequire(name),
    setInterval: callback => { const timer = { callback }; timers.add(timer); return timer; }, clearInterval: timer => timers.delete(timer)
  }, { filename });
  const service = module.exports.installYouTube({ app: { isPackaged: false }, WebContentsView: View, ipcMain: { handle: (name, fn) => handlers.set(name, fn) }, authorize() {}, session: { fromPartition: () => session }, getWindow: () => owner });
  return { service, views, timers, sent, get owner() { return owner; }, reopen() { owner = window(); }, call: (name, ...args) => handlers.get(name)({}, ...args) };
}
test('YouTube : fermeture native avant closed, double nettoyage et réouverture sans exception', async () => {
  let finish;
  const fixture = lifecycleFixture({ initialize: new Promise(resolve => { finish = resolve; }) });
  fixture.call('youtube:layout', null, true);
  const first = fixture.views[0];
  assert.equal(fixture.timers.size, 1);
  assert.doesNotThrow(() => fixture.owner.destroy());
  assert.equal(first.webContents, undefined, 'Le getter natif peut déjà être vide');
  assert.equal(fixture.timers.size, 0);
  assert.doesNotThrow(() => { fixture.service.close(); fixture.service.close(); });
  finish(); await new Promise(setImmediate);
  assert.equal(first.contents.loads.length, 0, 'Ne pas naviguer après la destruction');
  fixture.reopen(); fixture.call('youtube:layout', null, true);
  await new Promise(setImmediate);
  assert.equal(fixture.views.length, 2); assert.equal(fixture.timers.size, 1);
  fixture.service.close();
  assert.equal(fixture.owner.listenerCount('closed'), 0, 'Retirer le rappel de l’ancienne vue');
  assert.doesNotThrow(() => fixture.owner.destroy());
  assert.equal(fixture.timers.size, 0);
});
test('YouTube : une commande et un relevé tardifs ne réutilisent pas une vue fermée', async () => {
  const fixture = lifecycleFixture(); fixture.call('youtube:layout', null, true);
  await new Promise(setImmediate);
  let finishPoll;
  fixture.views[0].contents.execute = () => new Promise(resolve => { finishPoll = resolve; });
  const poll = [...fixture.timers][0].callback();
  fixture.service.close();
  finishPoll({ videoId: 'aaaaaaaaaaa', title: 'Ancien morceau', artist: 'Artiste' }); await poll;
  assert.equal(fixture.sent.some(event => event.channel === 'youtube:state'), false);
  fixture.reopen(); fixture.call('youtube:layout', null, true); await new Promise(setImmediate);
  let finishCommand;
  fixture.views[1].contents.execute = () => new Promise(resolve => { finishCommand = resolve; });
  const command = fixture.call('youtube:command', 'play'); await new Promise(setImmediate);
  fixture.service.close(); finishCommand({ currentTime: 1 });
  assert.equal((await command).cancelled, true);
});
test('YouTube : annuler une référence peut fermer deux fois son webContents sans TypeError', async () => {
  const controller = new AbortController();
  const fixture = lifecycleFixture({ created: (_view, count) => { if (count === 2) queueMicrotask(() => controller.abort()); } });
  fixture.call('youtube:layout', null, true); await new Promise(setImmediate);
  fixture.views[0].contents.execute = async () => ({ videoId: 'aaaaaaaaaaa' });
  await assert.rejects(fixture.service.audioResponse({ videoId: 'bbbbbbbbbbb' }, controller.signal), error => error.name === 'AbortError');
  assert.equal(fixture.views[1].webContents, undefined);
  assert.equal(fixture.views[0].contents.isDestroyed(), false, 'Garder le lecteur actif');
  assert.doesNotThrow(() => { fixture.service.close(); fixture.owner.destroy(); });
});

function coldPreparation(cancelAt = Infinity, stalledSeek = false, stalledMetadata = false) {
  let clock = 0, loaded = false, primed = false, position = 39, seekPending = false;
  const seeks = [], warmed = [];
  const media = { volume: .75, muted: false, playbackRate: 1, preservesPitch: true, paused: true, get seeking() { return seekPending; },
    get duration() { return loaded ? 70 : 40; }, get readyState() { return loaded ? (primed ? 4 : stalledMetadata ? 0 : 2) : 4; },
    get currentSrc() { return loaded ? 'second-source' : 'first-source'; },
    get currentTime() { return position; }, set currentTime(value) { seeks.push({ value, loaded }); position = value; seekPending = stalledSeek && !primed; },
    buffered: { length: 1, start: () => loaded ? 58 : 0, end: () => loaded ? 70 : 40 },
    pause() { this.paused = true; },
    play() { warmed.push({ volume: this.volume, muted: this.muted, position }); primed = true; seekPending = false; this.paused = false; return Promise.resolve(); }
  };
  const context = { URL, Symbol, DOMException, location: { origin: 'https://music.youtube.com', href: 'https://music.youtube.com/watch?v=bbbbbbbbbbb' },
    Date: { now: () => clock },
    document: { querySelector: selector => selector === 'video' ? media : selector === '#movie_player' ? { getPlayerResponse: () => ({ videoDetails: { videoId: 'bbbbbbbbbbb', lengthSeconds: '70' } }) } : null },
    setTimeout(callback, duration) {
      clock += duration;
      if (!loaded && clock >= 900) { loaded = true; position = 0; }
      if (clock >= cancelAt) vm.runInNewContext("globalThis[Symbol.for('nocturne.youtube.preparation')]?.cancel()", context);
      queueMicrotask(callback);
    }
  };
  const result = vm.runInNewContext(`(${preparePlayback.toString()})('bbbbbbbbbbb', 60)`, context);
  return { result, media, seeks, warmed, context };
}
test('YouTube : attendre le vrai flux puis charger en silence à 60 s malgré l’ancien morceau de 40 s', async () => {
  const fixture = coldPreparation(), result = await fixture.result;
  assert.equal(result.currentTime, 60); assert.equal(result.duration, 70); assert.equal(result.paused, true);
  assert.ok(fixture.seeks.length > 0 && fixture.seeks.every(seek => seek.loaded && seek.value === 60));
  assert.ok(fixture.warmed.length > 0 && fixture.warmed.every(sample => sample.volume === 0 && sample.muted && sample.position === 60));
  assert.equal(fixture.media.volume, .75); assert.equal(fixture.media.muted, false); assert.equal(fixture.media.paused, true);
});
test('YouTube : annuler le chargement silencieux restaure le volume et arrête son attente', async () => {
  const fixture = coldPreparation(1000);
  await assert.rejects(fixture.result, error => error.name === 'AbortError');
  assert.equal(fixture.media.volume, .75); assert.equal(fixture.media.muted, false); assert.equal(fixture.media.paused, true);
  assert.equal(fixture.context[Symbol.for('nocturne.youtube.preparation')], undefined);
});

test('YouTube : un seek bloqué en pause se débloque par une lecture silencieuse', async () => {
  const fixture = coldPreparation(Infinity, true), result = await fixture.result;
  assert.equal(result.currentTime, 60); assert.equal(result.paused, true);
  assert.ok(fixture.warmed.length > 0); assert.equal(fixture.media.volume, .75);
});
test('YouTube : le chargement silencieux initialise aussi un flux sans métadonnées média', async () => {
  const fixture = coldPreparation(Infinity, false, true), result = await fixture.result;
  assert.equal(result.currentTime, 60); assert.equal(result.readyState, 4);
  assert.ok(fixture.warmed.every(sample => sample.volume === 0 && sample.muted));
});

test('YouTube : adopter le titre suivant avant de préparer la nouvelle file conserve son edit en cours de validation', () => {
  const fs = require('node:fs'), path = require('node:path'), events = [];
  let onState;
  const node = { classList: { toggle() {} }, setAttribute() {}, getBoundingClientRect: () => ({ x: 0, y: 0, width: 500, height: 300 }) };
  const youtube = { onState: callback => { onState = callback; }, onStatus() {}, hold: async () => {}, layout: async () => {}, blockerStatus: async () => ({ enabled: true, blocked: 0 }), command: async () => {} };
  const context = { source: 'local', current: { id: 'youtube:one' }, audio: { volume: .75 }, Event,
    $: () => node, document: { querySelector: () => node, body: { classList: { contains: () => false } } },
    ResizeObserver: class { observe() {} }, MutationObserver: class { observe() {} }, requestAnimationFrame() {}, clearTimeout, setTimeout,
    updatePlaybackTime() {}, playbackState() {}, selectSource() {}, usesYouTube: () => true, usesEditAudio: () => true,
    select: track => { events.push('select:' + track.id); context.current = track; },
    window: { youtube, editPlayback: { isCrossfading: () => false }, addEventListener() {}, dispatchEvent: () => events.push('queue:' + context.current.id) }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/youtube.js'), 'utf8'), context);
  context.window.youtubeMusicUI.setVisible(true);
  onState({ track: { id: 'youtube:one' }, nextTrack: { id: 'youtube:two' }, paused: true });
  events.length = 0;
  onState({ track: { id: 'youtube:two' }, nextTrack: { id: 'youtube:three' }, paused: false });
  assert.deepEqual(events, ['select:youtube:two', 'queue:youtube:two']);
});
