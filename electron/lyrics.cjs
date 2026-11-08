const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { parse } = require('../src/lrc.js');
function result(text, source) {
  const lines = parse(text);
  return { lines, plain: lines.length ? '' : text.trim(), source, instrumental: false };
}
module.exports = function installLyrics({ app, ipcMain, dialog, authorize, getTrack, getWindow, request = fetch }) {
  const directory = path.join(app.getPath('userData'), 'lyrics');
  const inflight = new Map();
  let chain = Promise.resolve(), nextRequest = 0;
  const digest = value => createHash('sha256').update(value).digest('hex');
  async function read(file) { const info = await fs.stat(file); if (info.size > 512000) throw new Error('Le fichier de paroles est trop volumineux.'); return fs.readFile(file, 'utf8'); }
  async function write(file, value) { await fs.mkdir(directory, { recursive: true }); await fs.writeFile(file + '.tmp', JSON.stringify(value), 'utf8'); await fs.rename(file + '.tmp', file); }
  async function lookup(track, duration) {
    try { return JSON.parse(await fs.readFile(path.join(directory, `${digest(track.id)}-manual.json`), 'utf8')); } catch { /* Pas d’importation. */ }
    if (track.source !== 'volumio') {
      try { return result(await read(track.path.replace(/\.[^./\\]+$/, '.lrc')), 'Fichier LRC local'); } catch { /* Pas de fichier voisin. */ }
    }
    const seconds = Number.isFinite(duration) && duration > 0 ? duration : Number(track.duration) || 0;
    const cacheFile = path.join(directory, `${digest(JSON.stringify([track.id, Math.round(seconds)]))}.json`);
    try { const cached = JSON.parse(await fs.readFile(cacheFile, 'utf8')); if (cached.value.lines.length || cached.value.plain || cached.value.instrumental || Date.now() - cached.date < 86400000) return cached.value; } catch { /* Pas de cache. */ }
    const params = new URLSearchParams({ track_name: track.title, artist_name: track.artist });
    if (track.album && track.album !== 'Album inconnu') params.set('album_name', track.album);
    if (seconds >= 1 && seconds <= 3600) params.set('duration', String(Math.round(seconds)));
    if (!track.title || !track.artist || track.artist === 'Artiste inconnu') return { lines: [], plain: '', source: '', unavailable: true };
    const fetchLyrics = async () => {
      if (Date.now() < nextRequest) throw new Error('Le service de paroles est temporairement limité. Réessaie dans quelques instants.');
      let response;
      try { response = await request(`https://lrclib.net/api/get?${params}`, { headers: { 'User-Agent': `Nocturne/${app.getVersion()} (Electron desktop music player)` }, signal: AbortSignal.timeout(12000), redirect: 'error' }); }
      catch { throw new Error('Les paroles en ligne sont inaccessibles. Tu peux importer un fichier LRC.'); }
      if (response.status === 429 || response.status === 503) {
        const retry = response.headers.get('retry-after');
        const delay = Number.isFinite(Number(retry)) && retry ? Number(retry) * 1000 : Math.max(1000, Date.parse(retry) - Date.now() || 60000);
        nextRequest = Date.now() + delay * (1 + Math.random() * 0.3);
        throw new Error('Le service de paroles est occupé. Réessaie dans quelques instants.');
      }
      let value;
      if (response.status === 404) value = { lines: [], plain: '', source: 'LRCLIB', unavailable: true };
      else {
        if (!response.ok) throw new Error('Le service de paroles ne répond pas correctement.');
        const record = await response.json();
        value = { ...result(record.syncedLyrics || record.plainLyrics || '', 'LRCLIB'), instrumental: Boolean(record.instrumental) };
      }
      await write(cacheFile, { date: Date.now(), value });
      await new Promise(resolve => setTimeout(resolve, 250));
      return value;
    };
    const job = chain.then(fetchLyrics, fetchLyrics); chain = job.catch(() => {}); return job;
  }
  ipcMain.handle('lyrics:get', async (event, id, duration) => {
    authorize(event); const track = getTrack(id); if (!track) throw new Error('Morceau indisponible.');
    const key = JSON.stringify([id, Math.round(Number(duration) || track.duration || 0)]);
    if (!inflight.has(key)) inflight.set(key, lookup(track, duration).finally(() => inflight.delete(key)));
    return inflight.get(key);
  });
  ipcMain.handle('lyrics:import', async (event, id) => {
    authorize(event); if (!getTrack(id)) throw new Error('Sélectionne un morceau.');
    const selected = await dialog.showOpenDialog(getWindow(), { title: 'Importer les paroles de ce morceau', properties: ['openFile'], filters: [{ name: 'Paroles synchronisées', extensions: ['lrc'] }] });
    if (selected.canceled) return null;
    const value = result(await read(selected.filePaths[0]), 'Fichier LRC importé');
    if (!value.lines.length) throw new Error('Ce fichier LRC ne contient pas de lignes horodatées.');
    await write(path.join(directory, `${digest(id)}-manual.json`), value); return value;
  });
};
