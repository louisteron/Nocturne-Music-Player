const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { rankVideos } = require('./edit-ranking.cjs');
const { createMatcher, mediaUrl, fetchMedia } = require('./audio-match.cjs');
function searchState() {
  if (location.origin !== 'https://www.tiktok.com' || !location.pathname.startsWith('/search')) return { links: [], blocked: true };
  const results = document.querySelector('[data-e2e="search_top-item-list"]');
  const links = [...new Set([...(results?.querySelectorAll('[data-e2e="search_top-item"] a[href*="/video/"]') || [])].map(a => a.href))].filter(value => {
    try { const url = new URL(value); return url.origin === 'https://www.tiktok.com' && /^\/@[^/]+\/video\/\d{16,22}/.test(url.pathname); } catch { return false; }
  }).slice(0, 16);
  return { links, blocked: Boolean(document.querySelector('iframe[src*="captcha"], [id*="captcha"]')) || /verify you are human|vérifi.*humain|une erreur est survenue|something went wrong/i.test(results?.innerText || '') };
}

function allowedNavigation(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && (url.hostname === 'tiktok.com' || url.hostname.endsWith('.tiktok.com') || ['accounts.google.com', 'appleid.apple.com'].includes(url.hostname)); } catch { return false; }
}
function publicVideo(html) {
  const raw = html.match(/<script\b[^>]*id=["']__UNIVERSAL_DATA_FOR_REHYDRATION__["'][^>]*>([\s\S]*?)<\/script>/i)?.[1];
  if (!raw) return null;
  try {
    const item = JSON.parse(raw).__DEFAULT_SCOPE__?.['webapp.video-detail']?.itemInfo?.itemStruct;
    if (!item) return null;
    const video = item.video || {};
    const urls = value => { if (typeof value === 'string') return [value]; const list = value?.UrlList || value?.urlList; return Array.isArray(list) ? list : []; };
    const h264 = (Array.isArray(video.bitrateInfo) ? video.bitrateInfo : []).filter(value => value.CodecType === 'h264').flatMap(value => urls(value.PlayAddr));
    const streamUrls = [...new Set([...urls(video.downloadAddr), ...(video.codecType === 'h264' ? urls(video.playAddr) : []), ...h264, ...urls(video.playAddr)].map(mediaUrl).filter(Boolean))].slice(0, 6);
    return { video_id: item.id, title: item.desc, is_ad: item.isAd, images: item.imagePost ? [true] : [], soundUrl: mediaUrl(item.music?.playUrl), streamUrl: streamUrls[0] || null, streamUrls, music_info: item.music ? { id: item.music.id, title: item.music.title, author: item.music.authorName, original: item.music.original } : null, author: { unique_id: item.author?.uniqueId, nickname: item.author?.nickname } };
  } catch { return null; }
}
async function installTikTokSession({ app, BrowserWindow, ipcMain, authorize, getTrack, session, shell, getWindow, sourceUrl, matcher: suppliedMatcher }) {
  let serveVideo;
  const matcher = suppliedMatcher || createMatcher({ app, session, sourceUrl, clipResponse: (id, signal) => serveVideo(new Request(`nocturne://edit-video/${id}`, { signal }), id) });
  const settingsFile = path.join(app.getPath('userData'), 'tiktok-session.json');
  const cacheFile = path.join(app.getPath('userData'), 'tiktok-session-cache.json');
  let confirmed = false, cache = {}, browser = null, generation = 0, sequence = Promise.resolve(), lastSearch = 0;
  const available = new Map();
  const unavailable = new Map();
  const refreshing = new Map();
  let controller = new AbortController();
  function cancel() { ++generation; controller.abort(); controller = new AbortController(); }
  function progress(id, text) { const window = getWindow?.(); if (window && !window.isDestroyed()) window.webContents.send('edits:progress', { id, text }); }
  try { confirmed = JSON.parse(await fs.readFile(settingsFile, 'utf8')).confirmed === true; } catch { /* Première connexion. */ }
  try { const saved = JSON.parse(await fs.readFile(cacheFile, 'utf8')); if (saved && typeof saved === 'object' && !Array.isArray(saved)) cache = saved; } catch { /* Pas de cache. */ }
  async function save(file, value) { await fs.mkdir(app.getPath('userData'), { recursive: true }); await fs.writeFile(file + '.tmp', JSON.stringify(value)); await fs.rename(file + '.tmp', file); }
  function guard(window) {
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, url) => { if (!allowedNavigation(url)) event.preventDefault(); });
    window.webContents.on('will-redirect', (event, url) => { if (!allowedNavigation(url)) event.preventDefault(); });
  }
  function getBrowser(show = false) {
    if (!browser || browser.isDestroyed()) {
      browser = new BrowserWindow({ width: 1080, height: 800, minWidth: 760, minHeight: 600, show, title: 'TikTok — connexion Nocturne', autoHideMenuBar: true, backgroundColor: '#121212', webPreferences: { session, nodeIntegration: false, contextIsolation: true, sandbox: true } });
      browser.webContents.setAudioMuted(true); guard(browser);
      browser.on('closed', () => { browser = null; cancel(); });
    }
    if (show) { browser.show(); browser.focus(); }
    return browser;
  }
  async function connect() {
    cancel();
    const window = getBrowser(true);
    window.loadURL('https://www.tiktok.com/login').catch(() => {});
    return { opened: true };
  }
  function status() { return { provider: 'TikTok', free: true, configured: confirmed, requiresSession: true }; }
  function track(id) { const item = typeof id === 'string' && getTrack(id); if (!item) throw new Error('Morceau indisponible.'); return item; }
  ipcMain.handle('edits:provider', event => { authorize(event); return status(); });
  ipcMain.handle('edits:session-connect', async event => { authorize(event); return connect(); });
  ipcMain.handle('edits:session-confirm', async event => { authorize(event); await save(settingsFile, { confirmed: true }); confirmed = true; if (browser && !browser.isDestroyed()) browser.hide(); return status(); });
  ipcMain.handle('edits:session-open', event => { authorize(event); const window = getBrowser(true); if (!window.webContents.getURL()) window.loadURL('https://www.tiktok.com/').catch(() => {}); });
  ipcMain.handle('edits:session-disconnect', async event => {
    authorize(event); cancel(); confirmed = false;
    if (browser && !browser.isDestroyed()) browser.close();
    await session.clearStorageData({ origin: 'https://www.tiktok.com', storages: ['cookies', 'localstorage', 'indexdb', 'serviceworkers', 'cachestorage'] });
    await save(settingsFile, { confirmed: false }); return status();
  });
  ipcMain.handle('edits:cancel', event => { authorize(event); cancel(); });
  async function discover(id, force, request, excluded = []) {
    const item = track(id);
    if (request !== generation) return { status: 'cancelled', videos: [] };
    if (!confirmed) return { status: 'needs-login', videos: [] };
    const signal = controller.signal;
    const skip = new Set(excluded);
    const usable = video => !skip.has(video.videoId) && !(unavailable.get(video.videoId) > Date.now());
    const key = crypto.createHash('sha256').update(JSON.stringify(['visual-metadata-v1', item.title, item.artist])).digest('hex');
    if (!force && cache[key] && Date.now() - cache[key].date < (cache[key].videos?.length ? 86400000 : 300000)) {
      const videos = cache[key].videos.filter(usable);
      if (videos.length || !cache[key].videos.length) { available.set(id, videos); return { status: 'ready', videos, cached: true }; }
    }
    while (Date.now() - lastSearch < 2000) { if (request !== generation) return { status: 'cancelled', videos: [] }; await new Promise(resolve => setTimeout(resolve, 200)); }
    const window = getBrowser(false), contents = window.webContents;
    lastSearch = Date.now();
    const url = `https://www.tiktok.com/search?${new URLSearchParams({ q: `${item.title} ${item.artist} edit` })}`;
    try { await contents.loadURL(url); } catch { if (request !== generation) return { status: 'cancelled', videos: [] }; throw new Error('La recherche TikTok ne peut pas être ouverte.'); }
    let links = [];
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline && request === generation) {
      if (window.isDestroyed()) return { status: 'cancelled', videos: [] };
      const current = new URL(contents.getURL());
      if (current.hostname !== 'www.tiktok.com' || !current.pathname.startsWith('/search')) return { status: 'needs-login', videos: [] };
      // Uniquement les liens publics de résultats. Aucun accès aux champs de
      // connexion, mots de passe, cookies ou jetons de session.
      const state = await contents.executeJavaScript(`(${searchState.toString()})()`);
      links = [...new Set(state.links)];
      if (links.length) break;
      if (state.blocked) return { status: 'blocked', videos: [] };
      await new Promise(resolve => setTimeout(resolve, 600));
    }
    if (request !== generation) return { status: 'cancelled', videos: [] };
    if (!links.length) return { status: 'blocked', videos: [] };
    let matches = [];
    progress(id, 'Recherche par titre et artiste · sélection des edits visuels…');
    // Quatre pages publiques en parallèle, sans télécharger ni analyser le son.
    for (let offset = 0; offset < Math.min(links.length, 12); offset += 4) {
      if (request !== generation) return { status: 'cancelled', videos: [] };
      const batch = await Promise.allSettled(links.slice(offset, offset + 4).map(async link => {
        const response = await session.fetch(link, { redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(6000)]) });
        if (!response.ok) return null;
        const html = await response.text();
        return html.length <= 4000000 ? publicVideo(html) : null;
      }));
      matches = rankVideos(item, batch.filter(result => result.status === 'fulfilled' && result.value).map(result => result.value)).filter(usable).map(video => ({ ...video, streamRefreshedAt: Date.now() }));
      if (matches.length) break;
    }
    if (request !== generation) return { status: 'cancelled', videos: [] };
    cache[key] = { date: Date.now(), videos: matches };
    await save(cacheFile, cache); available.set(id, matches);
    return { status: 'ready', videos: matches, cached: false };
  }
  ipcMain.handle('edits:discover', (event, id, force, excluded = []) => {
    authorize(event); track(id); const request = generation;
    if (!Array.isArray(excluded) || excluded.length > 16 || excluded.some(value => typeof value !== 'string' || !/^\d{16,22}$/.test(value))) throw new Error('Liste d’edits invalide.');
    const job = sequence.then(() => discover(id, Boolean(force), request, excluded)); sequence = job.catch(() => {}); return job;
  });
  ipcMain.handle('edits:auto-open', async (event, id, selected) => { authorize(event); track(id); const edit = available.get(id)?.find(value => value.videoId === selected); if (!edit) throw new Error('Edit indisponible.'); await shell.openExternal(edit.url); });
  ipcMain.handle('edits:align', async (event, id, selected) => {
    authorize(event); const item = track(id), edit = available.get(id)?.find(value => value.videoId === selected);
    if (!edit) throw new Error('Edit indisponible.');
    if (item.source === 'youtube') return { matched: false, reason: 'streaming-source' };
    if (!edit.streamUrl) return { matched: false };
    const signal = controller.signal;
    try { const result = await matcher.alignment(item, edit, signal); return signal.aborted ? { matched: false, cancelled: true } : result; }
    catch { return { matched: false, cancelled: signal.aborted }; }
  });
  async function renew(edit) {
    if (!refreshing.has(edit.videoId)) refreshing.set(edit.videoId, (async () => {
      const page = await session.fetch(edit.url, { redirect: 'error', headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(8000) });
      if (!page.ok) return;
      const fresh = publicVideo(await page.text());
      if (fresh?.video_id !== edit.videoId || !fresh.streamUrls.length) return;
      edit.streamUrl = fresh.streamUrl; edit.streamUrls = fresh.streamUrls; edit.streamRefreshedAt = Date.now();
    })().finally(() => refreshing.delete(edit.videoId)));
    return refreshing.get(edit.videoId);
  }
  async function openMedia(url, request, headers) {
    const timeout = new AbortController(), timer = setTimeout(() => timeout.abort(), 7000);
    try { return await fetchMedia(session, url, { signal: AbortSignal.any([request.signal, timeout.signal]), headers }); }
    finally { clearTimeout(timer); } // Le délai concerne les en-têtes, pas la durée du flux.
  }
  return { connect, status, close: () => { if (browser && !browser.isDestroyed()) browser.close(); },
    serve: serveVideo = async function(request, id) {
      const edit = [...available.values()].flat().find(value => value.videoId === id && value.streamUrl);
      if (!edit) return new Response('Edit indisponible', { status: 404 });
      try {
        if (!edit.streamRefreshedAt || Date.now() - edit.streamRefreshedAt > 900000) await renew(edit).catch(() => {});
        const headersIn = { Referer: 'https://www.tiktok.com/' };
        if (request.headers.has('range')) headersIn.Range = request.headers.get('range');
        const tried = new Set();
        for (let pass = 0; pass < 2; pass++) {
          for (const url of [edit.streamUrl, ...(edit.streamUrls || [])].filter(Boolean)) {
            if (tried.has(url) || tried.size >= 4 || request.signal.aborted) continue;
            tried.add(url);
            try {
              const response = await openMedia(url, request, headersIn);
              const type = response.headers.get('content-type') || '';
              if ((response.ok && /^(video\/|application\/octet-stream)/i.test(type)) || response.status === 416) {
                const headers = new Headers();
                for (const key of ['content-type', 'content-length', 'content-range', 'accept-ranges']) if (response.headers.has(key)) headers.set(key, response.headers.get(key));
                if (response.ok) { edit.streamUrl = url; unavailable.delete(id); }
                return new Response(response.body, { status: response.status, headers });
              }
              await response.body?.cancel();
            } catch { if (request.signal.aborted) break; }
          }
          if (request.signal.aborted) break;
          if (pass === 0) await renew(edit).catch(() => {});
        }
        if (!request.signal.aborted) unavailable.set(id, Date.now() + 300000);
        return new Response('Vidéo TikTok inaccessible', { status: 503 });
      } catch { return new Response('Vidéo TikTok inaccessible', { status: 503 }); }
    }
  };
}
module.exports = { installTikTokSession, allowedNavigation, publicVideo };
