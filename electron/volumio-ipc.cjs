const fs = require('node:fs/promises');
const path = require('node:path');
const { Volumio } = require('./volumio.cjs');

module.exports = async function installVolumio({ app, ipcMain, authorize, getWindow }) {
  const file = path.join(app.getPath('userData'), 'volumio.json');
  let data = { baseUrl: '', rootUri: 'music-library', tracks: [], syncedAt: null };
  try {
    const saved = JSON.parse(await fs.readFile(file, 'utf8'));
    if (typeof saved.baseUrl === 'string' && Array.isArray(saved.tracks)) {
      if (saved.baseUrl) new Volumio(saved.baseUrl);
      data = saved;
    }
  } catch (error) { if (error.code !== 'ENOENT') console.warn('Cache Volumio ignoré :', error.message); }
  let scanning = null, connecting = false;
  async function save(next) {
    await fs.mkdir(app.getPath('userData'), { recursive: true });
    await fs.writeFile(file + '.tmp', JSON.stringify(next), 'utf8');
    await fs.rename(file + '.tmp', file);
    data = next;
  }
  function client() { if (!data.baseUrl) throw new Error('Connecte ton serveur Volumio.'); return new Volumio(data.baseUrl); }
  async function checkAudio(id) {
    const track = data.tracks.find(item => item.id === id);
    if (!track || track.server !== data.baseUrl) throw new Error('Morceau Volumio indisponible.');
    try {
      const response = await fetch(client().audioUrl(track.uri), { redirect: 'error', headers: { Range: 'bytes=0-0' }, signal: AbortSignal.timeout(4000) });
      const mime = response.headers.get('content-type') || '';
      await response.body?.cancel();
      const status = response.status === 404 ? 'missing' : !response.ok || /text\/html/i.test(mime) ? 'refused' : 'available';
      return { status, baseUrl: data.baseUrl, httpStatus: response.status };
    } catch { return { status: 'offline', baseUrl: data.baseUrl }; }
  }
  ipcMain.handle('volumio:load', event => { authorize(event); return data; });
  ipcMain.handle('volumio:check-audio', (event, id) => { authorize(event); return checkAudio(id); });
  ipcMain.handle('volumio:connect', async (event, address) => {
    authorize(event);
    if (scanning || connecting) throw new Error('Une connexion ou synchronisation est déjà en cours.');
    connecting = true;
    try {
      const remote = new Volumio(address);
      await remote.state();
      const items = await remote.browse('music-library');
      await save(remote.baseUrl === data.baseUrl ? data : { baseUrl: remote.baseUrl, rootUri: 'music-library', tracks: [], syncedAt: null });
      return { ...data, items };
    } finally { connecting = false; }
  });
  ipcMain.handle('volumio:browse', async (event, uri) => { authorize(event); return client().browse(uri); });
  ipcMain.handle('volumio:sync', async (event, uri) => {
    authorize(event);
    if (scanning || connecting) throw new Error('Une synchronisation est déjà en cours.');
    scanning = new AbortController();
    try {
      const tracks = await client().scan(uri, { signal: scanning.signal, progress: progress => { const window = getWindow(); if (window && !window.isDestroyed()) window.webContents.send('volumio:progress', progress); } });
      scanning.signal.throwIfAborted();
      await save({ ...data, rootUri: uri, tracks, syncedAt: new Date().toISOString() });
      return data;
    } finally { scanning = null; }
  });
  ipcMain.handle('volumio:cancel', event => { authorize(event); scanning?.abort(); });
  return {
    getTrack: id => data.tracks.find(track => track.id === id),
    audioUrl: id => { const track = data.tracks.find(item => item.id === id); if (!track) throw new Error('Morceau indisponible.'); return client().audioUrl(track.uri); },
    checkAudio,
    async serve(request, id, kind) {
      const track = data.tracks.find(item => item.id === id);
      if (!track || track.server !== data.baseUrl) return new Response('Introuvable', { status: 404 });
      try {
        const remote = client();
        const url = kind === 'cover' ? track.remoteCover : remote.audioUrl(track.uri);
        if (!url || new URL(url).origin !== data.baseUrl) return new Response('Introuvable', { status: 404 });
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 12000);
        let response;
        try {
          response = await fetch(url, { redirect: 'error', method: request.method === 'HEAD' ? 'HEAD' : 'GET', headers: request.headers.has('range') && kind === 'audio' ? { Range: request.headers.get('range') } : {}, signal: AbortSignal.any([controller.signal, request.signal]) });
        } finally { clearTimeout(timeout); }
        const mime = response.headers.get('content-type') || '';
        if (kind === 'audio' && response.status === 416) {
          await response.body?.cancel();
          return new Response(null, { status: 416, headers: response.headers.has('content-range') ? { 'Content-Range': response.headers.get('content-range') } : {} });
        }
        if (!response.ok || (kind === 'cover' ? !/^image\/(jpeg|png|webp|gif)(;|$)/i.test(mime) : /text\/html/i.test(mime))) { await response.body?.cancel(); return new Response('Fichier indisponible sur Volumio', { status: response.status >= 400 && response.status <= 599 ? response.status : 502 }); }
        const headers = new Headers({ 'Access-Control-Allow-Origin': 'null' });
        for (const key of ['content-type', 'content-length', 'accept-ranges', 'content-range']) if (response.headers.has(key)) headers.set(key, response.headers.get(key));
        return new Response(response.body, { status: response.status, headers });
      } catch { return new Response('Volumio est inaccessible', { status: 503 }); }
    }
  };
};
