const { searchMetadata } = require('./search-metadata.cjs');
const ORIGIN = 'https://music.youtube.com';
function allowedNavigation(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && ['music.youtube.com', 'www.youtube.com', 'accounts.youtube.com', 'accounts.google.com', 'consent.youtube.com', 'consent.google.com'].includes(url.hostname) && !url.username && !url.password && !url.port; } catch { return false; }
}
function searchUrl(value) {
  if (typeof value !== 'string' || value.length > 1000 || !value.trim()) throw new Error('Indique un titre, un artiste ou un lien YouTube Music.');
  const text = value.trim();
  if (/^https?:\/\//i.test(text)) {
    const url = new URL(text);
    const id = url.hostname === 'youtu.be' ? url.pathname.slice(1) : ['music.youtube.com', 'www.youtube.com', 'youtube.com'].includes(url.hostname) ? url.searchParams.get('v') : null;
    if (!/^[\w-]{11}$/.test(id || '')) throw new Error('Utilise un lien vers un morceau YouTube ou YouTube Music.');
    return `${ORIGIN}/watch?v=${id}`;
  }
  return `${ORIGIN}/search?${new URLSearchParams({ q: text })}`;
}
function readPlayback() {
  if (location.origin !== 'https://music.youtube.com') return null;
  const player = document.querySelector('ytmusic-player-bar'), media = document.querySelector('video');
  if (!media) return null;
  const ad = Boolean(document.querySelector('#movie_player.ad-showing, #movie_player.ad-interrupting'));
  if (ad) return { ad: true };
  const metadata = navigator.mediaSession?.metadata;
  const title = metadata?.title || player?.querySelector('.title')?.textContent;
  const artist = metadata?.artist || player?.querySelector('.byline a')?.textContent;
  const link = player?.querySelector('a[href*="watch?v="]')?.getAttribute('href');
  const url = new URL(link || location.href, location.origin);
  const videoId = url.searchParams.get('v');
  if (!title || !artist || !/^[\w-]{11}$/.test(videoId || '')) return null;
  let bufferedAhead = 0;
  for (let i = 0; i < media.buffered.length; i++) if (media.buffered.start(i) <= media.currentTime + 0.05 && media.buffered.end(i) >= media.currentTime) bufferedAhead = media.buffered.end(i) - media.currentTime;
  return { videoId, title: title.trim().slice(0, 300), artist: artist.trim().slice(0, 300), album: (metadata?.album || '').slice(0, 300), paused: media.paused, currentTime: Number.isFinite(media.currentTime) ? media.currentTime : 0, duration: Number.isFinite(media.duration) ? media.duration : 0, volume: media.volume, muted: media.muted, readyState: media.readyState, ended: media.ended, bufferedAhead };
}
// Lecture locale de fréquences seulement : aucun enregistrement ni envoi audio.
function readSpectrum(active) {
  if (location.origin !== 'https://music.youtube.com') return null;
  const key = Symbol.for('nocturne.visualizer.audio');
  let tap = window[key];
  const media = document.querySelector('video');
  function release() {
    if (!tap) return;
    tap.source.disconnect(); tap.analyser.disconnect(); tap.silent.disconnect();
    tap.stream.getTracks().forEach(track => track.stop()); tap.context.close().catch(() => {}); delete window[key]; tap = null;
  }
  if (!active) { release(); return null; }
  if (!media || media.paused || media.readyState < 2 || document.querySelector('#movie_player.ad-showing, #movie_player.ad-interrupting')) return null;
  if (tap && (tap.media !== media || tap.url !== media.currentSrc || tap.stream.getAudioTracks().every(track => track.readyState === 'ended'))) release();
  try {
    if (!tap) {
      const stream = media.captureStream();
      if (!stream.getAudioTracks().length) { stream.getTracks().forEach(track => track.stop()); return null; }
      const context = new AudioContext(), source = context.createMediaStreamSource(stream), analyser = context.createAnalyser(), silent = context.createGain();
      analyser.fftSize = 2048; analyser.minDecibels = -100; analyser.maxDecibels = 0; analyser.smoothingTimeConstant = 0; silent.gain.value = 0;
      source.connect(analyser); analyser.connect(silent); silent.connect(context.destination);
      tap = window[key] = { media, url: media.currentSrc, stream, context, source, analyser, silent };
    }
    if (tap.context.state === 'suspended') tap.context.resume().catch(() => {});
    const wave = new Float32Array(2048), frequency = new Float32Array(1024); tap.analyser.getFloatTimeDomainData(wave); tap.analyser.getFloatFrequencyData(frequency); return { wave: Array.from(wave), frequency: Array.from(frequency), rate: tap.context.sampleRate };
  } catch { release(); return null; }
}
async function control(action, value) {
  if (location.origin !== 'https://music.youtube.com') throw new Error('Ouvre un morceau dans YouTube Music.');
  const media = document.querySelector('video');
  if (!media) throw new Error('Choisis d’abord un morceau dans YouTube Music.');
  if (action === 'play') await media.play();
  else if (action === 'pause') media.pause();
  else if (action === 'seek') {
    if (document.querySelector('#movie_player.ad-showing, #movie_player.ad-interrupting')) throw new Error('Attends la fin de la publicité YouTube Music.');
    if (Number.isFinite(media.duration)) media.currentTime = Math.min(media.duration, Math.max(0, value));
  } else if (action === 'volume') { media.volume = value; media.muted = false; }
  else if (action === 'next' || action === 'previous') {
    const button = document.querySelector(`ytmusic-player-bar .${action === 'next' ? 'next' : 'previous'}-button`);
    if (!button) throw new Error('Utilise les commandes de file d’attente YouTube Music.');
    button.click();
  }
}
function installYouTube({ app, WebContentsView, ipcMain, authorize, session, getWindow }) {
  let view = null, owner = null, polling = false, timer = null, visible = false, hold = false;
  let blocker = null, blockerReady = null, requestedUrl = null;
  function getBlocker() {
    if (!blocker) blocker = require('./youtube-adblock.cjs').createYouTubeBlocker({ app, session: session.fromPartition('persist:youtube-music'), allowUpdates: app.isPackaged || !process.env.NOCTURNE_TEST_DATA });
    return blocker;
  }
  const tracks = new Map();
  function send(channel, value) { const window = getWindow(); if (window && !window.isDestroyed()) window.webContents.send(channel, value); }
  async function poll() {
    if (polling || !view || view.webContents.isDestroyed()) return;
    polling = true;
    try {
      const state = await view.webContents.executeJavaScript(`(${readPlayback.toString()})()`);
      if (!state) return;
      if (state.ad) { send('youtube:state', { ad: true }); return; }
      const track = searchMetadata({ id: `youtube:${state.videoId}`, source: 'youtube', title: state.title, artist: state.artist, album: state.album || 'YouTube Music', duration: state.duration, videoId: state.videoId });
      tracks.set(track.id, track); if (tracks.size > 100) tracks.delete(tracks.keys().next().value);
      send('youtube:state', { ...state, track });
    } catch { /* Navigation en cours ou fenêtre fermée. */ }
    finally { polling = false; }
  }
  function ensure() {
    const window = getWindow();
    if (!window || window.isDestroyed()) throw new Error('La fenêtre Nocturne est fermée.');
    if (!view || view.webContents.isDestroyed()) {
      const youtubeSession = session.fromPartition('persist:youtube-music');
      youtubeSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
      view = new WebContentsView({ webPreferences: { session: youtubeSession, sandbox: true, nodeIntegration: false, contextIsolation: true } });
      view.webContents.setAudioMuted(hold);
      view.webContents.on('media-started-playing', () => { if (hold) view.webContents.setAudioMuted(true); });
      owner = window; owner.contentView.addChildView(view); view.setVisible(false);
      view.webContents.setWindowOpenHandler(({ url }) => { if (allowedNavigation(url)) view.webContents.loadURL(url).catch(() => {}); return { action: 'deny' }; });
      for (const event of ['will-navigate', 'will-redirect']) view.webContents.on(event, (event, url) => { if (!allowedNavigation(url)) event.preventDefault(); });
      view.webContents.on('did-finish-load', () => { const host = new URL(view.webContents.getURL()).hostname; send('youtube:status', { text: host === 'music.youtube.com' ? 'Choisis un morceau dans YouTube Music.' : 'Termine l’étape Google affichée dans le lecteur, puis reviens à YouTube Music.' }); poll(); });
      view.webContents.on('did-fail-load', (_event, code, _description, _url, mainFrame) => { if (mainFrame && code !== -3) send('youtube:status', { text: 'YouTube Music ne se charge pas. Vérifie la connexion puis réessaie.' }); });
      owner.once('closed', () => { clearInterval(timer); timer = null; if (view && !view.webContents.isDestroyed()) view.webContents.close(); view = null; owner = null; requestedUrl = null; blockerReady = null; });
      timer = setInterval(poll, 600);
      blockerReady = getBlocker().initialize().catch(() => { send('youtube:status', { text: 'Les filtres publicitaires ne sont pas disponibles. Tu peux réessayer avec le bouton du bloqueur.' }); });
      const created = view;
      blockerReady.then(() => { if (!requestedUrl && view === created && !created.webContents.isDestroyed()) created.webContents.loadURL(ORIGIN).catch(() => {}); });
    }
    return view;
  }
  ipcMain.handle('youtube:spectrum', async (event, active) => {
    authorize(event);
    if (typeof active !== 'boolean') throw new Error('État du visualiseur invalide.');
    if (!view || view.webContents.isDestroyed()) return null;
    return view.webContents.executeJavaScript(`(${readSpectrum.toString()})(${active})`, true).catch(() => null);
  });
  ipcMain.handle('youtube:layout', (event, rect, show) => {
    authorize(event); visible = show === true;
    if (!visible && !view) return;
    const current = ensure();
    const [width, height] = getWindow().getContentSize();
    if (rect && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(rect[key]))) current.setBounds({ x: Math.max(0, Math.min(width, Math.round(rect.x))), y: Math.max(0, Math.min(height, Math.round(rect.y))), width: Math.max(0, Math.min(width, Math.round(rect.width))), height: Math.max(0, Math.min(height, Math.round(rect.height))) });
    current.setVisible(visible);
  });
  async function navigate(url) { requestedUrl = url; const current = ensure(); await blockerReady; if (view === current && requestedUrl === url && !current.webContents.isDestroyed()) current.webContents.loadURL(url).catch(() => {}); }
  ipcMain.handle('youtube:search', async (event, query) => { authorize(event); return navigate(searchUrl(query)); });
  ipcMain.handle('youtube:home', event => { authorize(event); return navigate(ORIGIN); });
  ipcMain.handle('youtube:blocker-status', async event => { authorize(event); await getBlocker().initialize(); return blocker.status(); });
  ipcMain.handle('youtube:blocker-set', async (event, value) => {
    authorize(event); if (typeof value !== 'boolean') throw new Error('Réglage du bloqueur invalide.');
    const status = await getBlocker().setEnabled(value); if (view && !view.webContents.isDestroyed()) view.webContents.reload(); return status;
  });
  ipcMain.handle('youtube:blocker-update', async event => { authorize(event); const status = await getBlocker().update(); if (view && !view.webContents.isDestroyed()) view.webContents.reload(); return status; });
  ipcMain.handle('youtube:hold', (event, value) => { authorize(event); hold = value === true; if (view && !view.webContents.isDestroyed()) view.webContents.setAudioMuted(hold); });
  ipcMain.handle('youtube:command', async (event, action, value, videoId) => {
    authorize(event);
    if (!['play', 'pause', 'seek', 'volume', 'next', 'previous'].includes(action)) throw new Error('Commande YouTube Music invalide.');
    if (['seek', 'volume'].includes(action) && (!Number.isFinite(value) || value < 0 || (action === 'volume' && value > 1))) throw new Error('Valeur invalide.');
    if (videoId !== undefined && !/^[\w-]{11}$/.test(videoId)) throw new Error('Morceau invalide.');
    if (!view || view.webContents.isDestroyed()) { if (action === 'pause') return; throw new Error('Ouvre YouTube Music.'); }
    await view.webContents.executeJavaScript(`(async () => { if (${JSON.stringify(videoId || null)} && (${readPlayback.toString()})()?.videoId !== ${JSON.stringify(videoId || null)}) throw new Error('Le morceau YouTube Music a changé.'); await (${control.toString()})(${JSON.stringify(action)}, ${JSON.stringify(value ?? null)}); })()`, true);
    if (action === 'play') view.webContents.setAudioMuted(false);
    else if (action === 'pause' && hold) view.webContents.setAudioMuted(true);
    await poll();
  });
  return { getTrack: id => tracks.get(id), close: () => { clearInterval(timer); if (view && !view.webContents.isDestroyed()) view.webContents.close(); } };
}
module.exports = { installYouTube, searchUrl, allowedNavigation, readPlayback, control };
