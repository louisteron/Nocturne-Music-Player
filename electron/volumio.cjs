const { createHash } = require('node:crypto');

function serverAddress(address) {
  if (typeof address !== 'string' || !address.trim()) throw new Error('Indique l’adresse de Volumio.');
  const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(address.trim()) ? address.trim() : `http://${address.trim()}`);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Utilise l’adresse du serveur, par exemple http://volumio.local.');
  return url.origin;
}

class Volumio {
  constructor(baseUrl, request = fetch) { this.baseUrl = serverAddress(baseUrl); this.request = request; }
  async api(endpoint, { signal, body } = {}) {
    let response;
    try {
      response = await this.request(`${this.baseUrl}/api/v1/${endpoint}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12000)]) : AbortSignal.timeout(12000)
      });
    } catch (error) {
      if (signal?.aborted) throw new Error('Synchronisation annulée.');
      throw new Error(`Volumio est inaccessible à ${this.baseUrl}. Vérifie l’adresse et la connexion réseau.`, { cause: error });
    }
    if (!response.ok) throw new Error(`Volumio a répondu avec l’erreur ${response.status}.`);
    const result = await response.json();
    if (result?.success === false || result?.error || result?.Error) throw new Error(result.reason || result.error || result.Error || 'Volumio a refusé la demande.');
    return result;
  }
  async state() {
    const state = await this.api('getState');
    if (!state || !['play', 'pause', 'stop'].includes(state.status)) throw new Error('Cette adresse ne répond pas comme un serveur Volumio.');
    return state;
  }
  async browse(uri = 'music-library', signal) {
    if (typeof uri !== 'string' || !/^music-library(?:\/|$)/.test(uri)) throw new Error('Choisis un dossier de la bibliothèque musicale.');
    const result = [];
    const seen = new Set();
    let offset = 0;
    for (;;) {
      const response = await this.api(`browse?${new URLSearchParams({ uri, limit: '200', offset: String(offset) })}`, { signal });
      if (!response?.navigation) throw new Error('Réponse de bibliothèque Volumio invalide.');
      const lists = response.navigation.lists || [];
      const items = response.navigation.list || lists.flatMap(list => list.items || (list.uri ? [list] : []));
      if (!Array.isArray(items)) throw new Error('Liste Volumio invalide.');
      const count = Math.max(0, ...lists.map(list => Number(list.count) || 0));
      const signature = JSON.stringify(items.map(item => item.uri));
      if (items.length && seen.has(signature)) throw new Error('Volumio a répété une page de résultats. La synchronisation précédente est conservée.');
      seen.add(signature); result.push(...items); offset += items.length;
      if (!count || offset >= count) break;
      if (!items.length) throw new Error('Volumio a renvoyé une liste incomplète. Réessaie la synchronisation.');
    }
    return result;
  }
  async scan(uri, { signal, progress = () => {} } = {}) {
    const queue = [uri], visited = new Set(), songs = new Map();
    while (queue.length) {
      signal?.throwIfAborted();
      const folder = queue.shift();
      if (visited.has(folder)) continue;
      visited.add(folder);
      const items = await this.browse(folder, signal);
      for (const item of items) {
        if (['song', 'track'].includes(item.type) && item.uri && (!item.service || item.service === 'mpd')) {
          const parent = folder.split('/').filter(Boolean).at(-1) || 'Sans album';
          const id = createHash('sha256').update(`${this.baseUrl}\n${item.uri}`).digest('hex');
          let remoteCover = null;
          if (item.albumart) {
            try { const art = new URL(item.albumart, this.baseUrl); if (art.origin === this.baseUrl) remoteCover = art.href; } catch { /* Pochette absente. */ }
          }
          songs.set(item.uri, { id, source: 'volumio', server: this.baseUrl, uri: item.uri, service: 'mpd', title: String(item.title || item.name || item.uri.split('/').at(-1)), artist: String(item.artist || 'Artiste inconnu'), album: String(item.album || parent), albumArtist: item.albumartist || item.albumArtist || '', trackNumber: parseInt(item.tracknumber, 10) || Number(item.uri.split('/').at(-1).match(/^(\d{1,3})[\s._-]/)?.[1]) || 0, discNumber: parseInt(item.discnumber, 10) || Number(parent.match(/^(?:cd|disc|disk)\s*(\d+)$/i)?.[1]) || 1, folder, folderName: parent, duration: Number(item.duration) || 0, remoteCover, cover: remoteCover ? `nocturne://cover/${id}` : null });
        } else if ((item.type === 'category' || /(?:^|-)folder$/.test(item.type)) && typeof item.uri === 'string' && /^music-library(?:\/|$)/.test(item.uri) && !visited.has(item.uri)) queue.push(item.uri);
      }
      progress({ folders: visited.size, tracks: songs.size, folder });
    }
    return [...songs.values()];
  }
  audioUrl(uri) {
    // Le serveur HTTP de Volumio expose les fichiers sous /music/.
    // Les URI de navigation commencent par music-library, les URI MPD par mnt/.
    let file = uri.replace(/^music-library\//, 'mnt/').replace(/^\//, '');
    const parts = file.split('/');
    if (parts[0] !== 'mnt' || parts.some(part => part === '..' || part === '.' || part.includes('\\') || part.includes('\0'))) throw new Error('Ce morceau ne désigne pas un fichier musical Volumio.');
    return `${this.baseUrl}/music/${parts.map(encodeURIComponent).join('/')}`;
  }
}
module.exports = { Volumio, serverAddress };
