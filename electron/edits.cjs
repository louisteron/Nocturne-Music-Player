const fs = require('node:fs/promises');
const path = require('node:path');

const hosts = new Set(['tiktok.com', 'www.tiktok.com', 'm.tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com']);
function parseUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('Colle un lien de vidéo TikTok.');
  let url;
  try { url = new URL(value.trim().startsWith('https://') ? value.trim() : `https://${value.trim()}`); } catch { throw new Error('Lien TikTok invalide.'); }
  if (url.protocol !== 'https:' || !hosts.has(url.hostname) || url.username || url.password || url.port) throw new Error('Utilise un lien HTTPS provenant de TikTok.');
  return url;
}
function videoId(value) {
  const url = parseUrl(value);
  return url.pathname.match(/^\/@[^/]+\/video\/(\d{16,22})\/?$/)?.[1] || url.pathname.match(/^\/player\/v1\/(\d{16,22})\/?$/)?.[1] || null;
}
async function resolveVideo(value, request) {
  let url = parseUrl(value);
  for (let count = 0; count < 6; count++) {
    const id = videoId(url.href);
    if (id) return { id, url: `https://www.tiktok.com${url.pathname.replace(/\/$/, '')}` };
    if (!['vm.tiktok.com', 'vt.tiktok.com'].includes(url.hostname) && !url.pathname.startsWith('/t/')) throw new Error('Ce lien ne désigne pas une vidéo TikTok.');
    const response = await request(url.href, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(10000) });
    const location = response.headers.get('location');
    if (!location || response.status < 300 || response.status >= 400) throw new Error('Ce lien court ne peut pas être résolu. Copie le lien complet de la vidéo.');
    url = parseUrl(new URL(location, url).href);
  }
  throw new Error('Trop de redirections TikTok. Utilise le lien complet.');
}
async function installEdits({ app, ipcMain, authorize, getTrack, shell, request = fetch }) {
  const file = path.join(app.getPath('userData'), 'tiktok-edits.json');
  let entries = {};
  try {
    const saved = JSON.parse(await fs.readFile(file, 'utf8'));
    if (saved && !Array.isArray(saved) && typeof saved === 'object') {
      for (const [id, list] of Object.entries(saved)) if (Array.isArray(list)) entries[id] = list.filter(item => item && /^\d{16,22}$/.test(item.videoId) && videoId(item.url) === item.videoId);
    }
  } catch (error) { if (error.code !== 'ENOENT') console.warn('Associations TikTok illisibles :', error.message); }
  let writes = Promise.resolve();
  function update(change) {
    const job = writes.then(async () => {
      const next = change(entries);
      await fs.mkdir(app.getPath('userData'), { recursive: true });
      await fs.writeFile(file + '.tmp', JSON.stringify(next), 'utf8'); await fs.rename(file + '.tmp', file);
      entries = next;
    });
    writes = job.catch(() => {}); return job;
  }
  function track(id) { const item = typeof id === 'string' && getTrack(id); if (!item) throw new Error('Sélectionne un morceau de ta bibliothèque.'); return item; }
  ipcMain.handle('edits:get', (event, id) => { authorize(event); track(id); return entries[id] || []; });
  ipcMain.handle('edits:add', async (event, id, link) => {
    authorize(event); track(id);
    const video = await resolveVideo(link, request);
    let response;
    try { response = await request(`https://www.tiktok.com/oembed?${new URLSearchParams({ url: video.url })}`, { redirect: 'error', signal: AbortSignal.timeout(12000) }); }
    catch { throw new Error('TikTok est inaccessible. Réessaie la connexion ou utilise le lien complet.'); }
    if (!response.ok) throw new Error('Cette vidéo est indisponible ou ne permet pas la lecture intégrée.');
    const info = await response.json();
    if (info.type !== 'video' || String(info.embed_product_id || video.id) !== video.id) throw new Error('TikTok ne reconnaît pas ce lien comme une vidéo intégrable.');
    const item = { videoId: video.id, url: video.url, title: String(info.title || 'Edit TikTok').slice(0, 500), author: String(info.author_name || '').slice(0, 100), addedAt: new Date().toISOString() };
    await update(previous => ({ ...previous, [id]: [...(previous[id] || []).filter(edit => edit.videoId !== item.videoId), item] }));
    return entries[id];
  });
  ipcMain.handle('edits:remove', async (event, id, selected) => { authorize(event); track(id); await update(previous => ({ ...previous, [id]: (previous[id] || []).filter(edit => edit.videoId !== selected) })); return entries[id] || []; });
  ipcMain.handle('edits:search', async (event, id) => { authorize(event); const item = track(id); await shell.openExternal(`https://www.tiktok.com/search?${new URLSearchParams({ q: `${item.title} ${item.artist} edit` })}`); });
  ipcMain.handle('edits:open', async (event, id, selected) => { authorize(event); track(id); const edit = (entries[id] || []).find(item => item.videoId === selected); if (!edit) throw new Error('Edit indisponible.'); await shell.openExternal(edit.url); });
}
module.exports = { installEdits, parseUrl, videoId, resolveVideo };
