const { firstArtist, tiktokSearchMetadata: searchMetadata } = require('./search-metadata.cjs');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const normalize = text => String(text || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
function sameSound(track, music) {
  if (!music || music.original === true) return false;
  track = searchMetadata(track);
  const title = normalize(track.title), artist = normalize(track.artist), author = normalize(firstArtist(music.author));
  return Boolean(title && artist.length >= 3 && title === normalize(searchMetadata({ title: music.title, artist: music.author }).title) && (author === artist || author.split(/\s+/).length > 1 && (` ${artist} `).includes(` ${author} `)));
}
function candidates(track, videos) {
  const found = new Map();
  for (const video of videos) {
    if (!/^\d{16,22}$/.test(String(video.video_id)) || !sameSound(track, video.music_info) || !/\b(?:edit|edits|amv|fmv|fanedit)\b/i.test(video.title || '') || video.is_ad || video.images?.length) continue;
    const id = String(video.video_id), username = String(video.author?.unique_id || '');
    found.set(id, { videoId: id, url: /^[a-zA-Z0-9_.]{1,40}$/.test(username) ? `https://www.tiktok.com/@${username}/video/${id}` : `https://www.tiktok.com/player/v1/${id}`, title: String(video.title || '').slice(0, 500), author: String(video.author?.nickname || username).slice(0, 100), automatic: true, musicId: String(video.music_info.id || ''), soundTitle: String(video.music_info.title), soundArtist: String(video.music_info.author) });
  }
  return [...found.values()];
}
async function installDiscovery({ app, ipcMain, authorize, getTrack, safeStorage, shell, request = fetch }) {
  const directory = app.getPath('userData'), settingsFile = path.join(directory, 'edits-search-settings.json'), cacheFile = path.join(directory, 'edits-search-cache.json');
  let apiKey = '', cache = {}, cooldown = 0, sequence = Promise.resolve();
  try { const settings = JSON.parse(await fs.readFile(settingsFile, 'utf8')); if (safeStorage.isEncryptionAvailable()) apiKey = safeStorage.decryptString(Buffer.from(settings.encryptedKey, 'base64')); } catch { /* Aucune clé utilisable. */ }
  try { cache = JSON.parse(await fs.readFile(cacheFile, 'utf8')); if (!cache || Array.isArray(cache) || typeof cache !== 'object') cache = {}; } catch { /* Aucun cache. */ }
  const pending = new Map(), available = new Map();
  function status() { return { provider: 'TikLiveAPI', configured: Boolean(apiKey), secureStorage: safeStorage.isEncryptionAvailable() }; }
  async function write(file, value) { await fs.mkdir(directory, { recursive: true }); await fs.writeFile(file + '.tmp', JSON.stringify(value), 'utf8'); await fs.rename(file + '.tmp', file); }
  function track(id) { const value = typeof id === 'string' && getTrack(id); if (!value) throw new Error('Morceau indisponible.'); return searchMetadata(value); }
  ipcMain.handle('edits:provider', event => { authorize(event); return status(); });
  ipcMain.handle('edits:provider-save', async (event, value) => {
    authorize(event);
    if (typeof value !== 'string' || !/^[\x21-\x7e]{8,4096}$/.test(value.trim())) throw new Error('Renseigne une clé TikLiveAPI valide.');
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Le stockage sécurisé des clés est indisponible sur cet ordinateur.');
    const key = value.trim(); await write(settingsFile, { provider: 'TikLiveAPI', encryptedKey: safeStorage.encryptString(key).toString('base64') }); apiKey = key; cooldown = 0; return status();
  });
  ipcMain.handle('edits:provider-remove', async event => { authorize(event); await write(settingsFile, { provider: 'TikLiveAPI', encryptedKey: '' }); apiKey = ''; return status(); });
  ipcMain.handle('edits:provider-account', async event => { authorize(event); await shell.openExternal('https://www.tikliveapi.com/'); });
  async function discover(id, force) {
    const item = track(id);
    if (!apiKey) return { status: 'needs-key', videos: [] };
    const key = crypto.createHash('sha256').update(JSON.stringify(['metadata-v3',item.title, item.artist])).digest('hex');
    if (!force && cache[key] && Date.now() - cache[key].date < (cache[key].videos.length ? 86400000 : 3600000)) {
      available.set(id, cache[key].videos); return { status: 'ready', videos: cache[key].videos, cached: true };
    }
    if (cooldown > Date.now()) throw new Error('Le service de recherche est temporairement limité. Réessaie plus tard.');
    const keyAtStart = apiKey;
    let response;
    try { response = await request(`https://api.tikliveapi.com/search-video/?${new URLSearchParams({ keyword: `${item.title} ${item.artist} edit`, count: '35', sort_by: '0', publish_time: '0' })}`, { headers: { 'X-Api-Key': keyAtStart }, redirect: 'error', signal: AbortSignal.timeout(20000) }); }
    catch { throw new Error('Le service de recherche est inaccessible. Vérifie ta connexion.'); }
    if (response.status === 429) { cooldown = Date.now() + Math.max(1000, (Number(response.headers.get('retry-after')) || 60) * 1000); throw new Error('Limite du service atteinte. Réessaie plus tard.'); }
    if (!response.ok) throw new Error('Le service de recherche a refusé la demande. Vérifie la clé et les crédits du compte.');
    const body = await response.json();
    if (!Array.isArray(body.videos)) throw new Error('Recherche refusée ou réponse invalide. Vérifie la clé TikLiveAPI et les crédits de ton compte.');
    if (apiKey !== keyAtStart) return { status: 'needs-key', videos: [] };
    const videos = candidates(item, body.videos);
    const previous = cache[key]; cache[key] = { date: Date.now(), videos };
    try { await write(cacheFile, cache); } catch (error) { if (previous) cache[key] = previous; else delete cache[key]; throw error; }
    available.set(id, videos); return { status: 'ready', videos, cached: false };
  }
  ipcMain.handle('edits:discover', async (event, id, force = false) => {
    authorize(event); track(id);
    if (!pending.has(id)) {
      const job = sequence.then(() => discover(id, Boolean(force)));
      sequence = job.catch(() => {});
      pending.set(id, job.finally(() => pending.delete(id)));
    }
    return pending.get(id);
  });
  ipcMain.handle('edits:auto-open', async (event, id, selected) => { authorize(event); track(id); const edit = available.get(id)?.find(video => video.videoId === selected); if (!edit) throw new Error('Edit indisponible.'); await shell.openExternal(edit.url); });
  return { status };
}
module.exports = { installDiscovery, sameSound, candidates };
