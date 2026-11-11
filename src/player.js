const $ = id => document.getElementById(id);
let audio = $('audio');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let tracks = [], remote = { tracks: [], baseUrl: '', rootUri: 'music-library' };
let source = localStorage.getItem('source') || 'local';
let albums = [], focused = null, current = null, queue = [], shuffled = false, repeat = false, busy = false;
let messageTimer, frame = 0, cardGeometry = [];
let playbackRequest = 0, playbackPending = false, plannedNext = null;
const time = value => { const seconds = Number.isFinite(value) ? Math.floor(value) : 0; return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; };
const collection = () => source === 'volumio' ? remote.tracks : tracks;
const query = () => $('search').value.trim().toLocaleLowerCase();
const matches = track => `${track.title} ${track.artist} ${track.album}`.toLocaleLowerCase().includes(query());
const usesEditAudio = () => window.editPlayback?.usesEditAudio() === true;
const usesYouTube = () => current?.source === 'youtube';
const playbackMedia = () => usesEditAudio() ? window.editPlayback.media() : usesYouTube() ? window.youtubePlayback.media() : audio;
function message(text) { $('status').textContent = text; clearTimeout(messageTimer); messageTimer = setTimeout(() => $('status').textContent = '', 7000); }
function cover(node, item) {
  node.replaceChildren();
  if (item?.cover) { const img = document.createElement('img'); img.src = item.cover; img.alt = ''; img.loading = 'lazy'; img.onerror = () => { node.textContent = '♫'; }; node.append(img); }
  else node.textContent = '♫';
}
function element(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
function render() {
  const previousKey = focused?.key;
  albums = Albums.group(collection()).filter(album => album.tracks.some(matches));
  $('count').textContent = `${albums.length} album${albums.length > 1 ? 's' : ''} · ${collection().length} morceaux`;
  $('source-local').setAttribute('aria-pressed', String(source === 'local'));
  $('source-volumio').setAttribute('aria-pressed', String(source === 'volumio'));
  $('sync').hidden = source !== 'volumio' || !remote.baseUrl;
  $('folder').textContent = source === 'volumio' ? '↳ Parcourir les dossiers Volumio' : '↳ Importer un dossier';
  $('folder-label').textContent = source === 'volumio' ? remote.rootUri.replace('music-library', 'Bibliothèque') : 'DÉFILE POUR EXPLORER';
  $('server-settings').textContent = remote.baseUrl ? '⚙ Volumio' : '＋ Connecter Volumio';
  const list = $('albums'); list.replaceChildren(); cardGeometry = [];
  if (!albums.length) {
    const empty = element('div', 'empty');
    empty.append(element('h2', '', collection().length ? 'Aucun résultat.' : source === 'volumio' ? 'Tes albums, en réseau.' : 'Une place pour tes albums.'), element('p', '', collection().length ? 'Essaie un autre album, artiste ou titre.' : source === 'volumio' ? 'Connecte Volumio et choisis un dossier à synchroniser, avec tous ses sous-dossiers.' : 'Importe un dossier de musique pour explorer ta collection par album.'));
    list.append(empty); focused = null; renderDetail(); updateCarousel(); return;
  }
  albums.forEach(album => {
    const slot = element('div', 'album-slot');
    const button = element('button', 'album-card'); button.dataset.key = album.key;
    button.setAttribute('aria-label', `${album.title}, ${album.artist}, ${album.tracks.length} morceaux`);
    const art = element('div', 'cover'); cover(art, album);
    const info = element('div', 'track-info');
    info.append(element('strong', '', album.title), element('span', '', album.artist), element('span', 'album-count', `${String(album.tracks.length).padStart(2, '0')} TITRE${album.tracks.length > 1 ? 'S' : ''}`));
    button.append(art, info); button.onclick = () => scrollToAlbum(albums.indexOf(album)); slot.append(button); list.append(slot);
  });
  focused = albums.find(album => album.key === previousKey) || albums[0];
  renderDetail();
  requestAnimationFrame(() => { sizeCarousel(); scrollToAlbum(albums.indexOf(focused), false); updateCarousel(); });
}
function renderDetail() {
  $('album-title').textContent = focused?.title || 'La nuit t’appartient.';
  $('album-artist').textContent = focused?.artist || 'Ajoute tes albums pour commencer.';
  $('album-meta').textContent = focused ? `${focused.tracks.length} TITRES · ${source === 'volumio' ? 'VOLUMIO / LECTURE SUR CET ORDINATEUR' : 'BIBLIOTHÈQUE LOCALE'}` : 'TA COLLECTION';
  $('play-album').disabled = !focused;
  $('tracks').replaceChildren();
  if (!focused) return;
  focused.tracks.filter(matches).forEach((track, index) => {
    const row = element('div', `track ${current?.id === track.id ? 'selected' : ''}`); row.dataset.id = track.id;
    const button = element('button', 'track-select'); button.setAttribute('aria-label', `Lire ${track.title}, ${track.artist}`);
    const info = element('div', 'track-info'); info.append(element('strong', '', track.title), element('span', '', track.artist));
    button.append(element('span', 'track-number', String(track.trackNumber || index + 1).padStart(2, '0')), info, element('span', 'track-duration', track.duration ? time(track.duration) : '—'));
    button.onclick = () => select(track, focused.tracks); row.append(button);
    if (source === 'local') {
      const remove = element('button', 'remove', '×'); remove.title = 'Retirer de la bibliothèque (conserve le fichier)'; remove.setAttribute('aria-label', `Retirer ${track.title}`);
      remove.onclick = async () => {
        try {
          tracks = await window.library.remove(track.id); queue = queue.filter(item => item.id !== track.id); queueChanged();
          if (current?.id === track.id) { pausePlayback(); audio.removeAttribute('src'); audio.load(); current = null; window.editPlayback?.prepare(); updateNow(); if ('mediaSession' in navigator) navigator.mediaSession.metadata = null; }
          render();
        } catch (error) { message(error.message); }
      }; row.append(remove);
    }
    $('tracks').append(row);
  });
}
function sizeCarousel() {
  const list = $('albums'), height = list.querySelector('.album-slot')?.offsetHeight || 174;
  list.style.paddingBlock = `${Math.max(0, (list.clientHeight - height) / 2)}px`;
  // Mesurer une fois après la mise en page, jamais entre deux transformations.
  cardGeometry = [...list.querySelectorAll('.album-slot')].map(slot => ({ button: slot.firstElementChild, center: slot.offsetTop + slot.offsetHeight / 2, height: slot.offsetHeight }));
}
function scrollToAlbum(index, smooth = true) {
  const list = $('albums'), slots = list.querySelectorAll('.album-slot');
  const slot = slots[Math.min(slots.length - 1, Math.max(0, index))];
  if (slot) list.scrollTo({ top: slot.offsetTop + slot.offsetHeight / 2 - list.clientHeight / 2, behavior: smooth && !reducedMotion.matches ? 'smooth' : 'instant' });
}
function updateCarousel() {
  frame = 0;
  const list = $('albums'), center = list.scrollTop + list.clientHeight / 2;
  let nearest = -1, best = Infinity;
  cardGeometry.forEach(({ button, center: cardCenter, height }, index) => {
    const distance = Math.abs(cardCenter - center);
    const influence = Math.max(0, 1 - distance / (height * 1.55));
    button.style.setProperty('--scale', String(0.78 + influence * 0.28));
    button.style.setProperty('--opacity', String(0.28 + influence * 0.72));
    if (distance < best) { best = distance; nearest = index; }
  });
  cardGeometry.forEach(({ button }, index) => { button.classList.toggle('centered', index === nearest); button.tabIndex = index === nearest ? 0 : -1; button.setAttribute('aria-current', String(index === nearest)); });
  if (nearest >= 0 && albums[nearest]?.key !== focused?.key) { focused = albums[nearest]; renderDetail(); }
  $('album-position').textContent = `${String(nearest + 1).padStart(2, '0')} / ${String(albums.length).padStart(2, '0')}`;
  $('album-up').disabled = nearest <= 0; $('album-down').disabled = nearest >= albums.length - 1 || nearest < 0;
}
$('albums').addEventListener('scroll', () => { if (!frame) frame = requestAnimationFrame(updateCarousel); }, { passive: true });
new ResizeObserver(() => { sizeCarousel(); scrollToAlbum(albums.indexOf(focused), false); updateCarousel(); }).observe($('albums'));
$('album-up').onclick = () => scrollToAlbum(albums.indexOf(focused) - 1);
$('album-down').onclick = () => scrollToAlbum(albums.indexOf(focused) + 1);
$('albums').onkeydown = event => {
  let target;
  if (event.key === 'ArrowDown') target = albums.indexOf(focused) + 1;
  else if (event.key === 'ArrowUp') target = albums.indexOf(focused) - 1;
  else if (event.key === 'Home') target = 0;
  else if (event.key === 'End') target = albums.length - 1;
  if (target !== undefined) { event.preventDefault(); scrollToAlbum(target); }
};
function updateSelected() { document.querySelectorAll('.track').forEach(row => row.classList.toggle('selected', row.dataset.id === current?.id)); }
function updateNow() {
  $('title').textContent = current?.title || 'La nuit t’appartient.';
  $('artist').textContent = current ? `${current.artist} · ${current.album}` : 'Ajoute tes morceaux pour commencer.';
  $('mini-title').textContent = current?.title || 'Aucun morceau';
  $('mini-artist').textContent = current ? `${current.artist}${usesEditAudio() ? ' · Son de l’edit TikTok' : usesYouTube() ? ' · YouTube Music' : current.source === 'volumio' ? ' · Volumio → cet ordinateur' : ''}` : 'Ta bibliothèque locale';
  $('connection-label').textContent = usesEditAudio() ? '● TIKTOK · SON SYNCHRONISÉ' : usesYouTube() ? '● YOUTUBE MUSIC' : current?.source === 'volumio' ? '● VOLUMIO → CET ORDINATEUR' : '● SON SUR CET ORDINATEUR'; cover($('mini-cover'), current);
}
async function start() {
  const id = current?.id, request = ++playbackRequest;
  playbackPending = true; playbackState();
  try {
    const ready = await (window.editPlayback?.requestPlay(id) ?? true);
    if (!ready || request !== playbackRequest || current?.id !== id) return;
    if (!usesEditAudio()) { if (usesYouTube()) await window.youtubePlayback.play(); else await audio.play(); }
  }
  catch (error) { if (current?.id === id && error.name !== 'AbortError') message(usesYouTube() ? error.message : current?.source === 'volumio' ? 'Lecture impossible : vérifie que Volumio est connecté et que ce fichier est accessible.' : 'Lecture impossible : vérifie que le fichier existe et que son format est pris en charge.'); }
  finally { if (request === playbackRequest) { playbackPending = false; playbackState(); } }
}
function pausePlayback() {
  ++playbackRequest; playbackPending = false;
  window.editPlayback?.cancelPlay(); audio.pause(); playbackState();
  window.youtubePlayback?.pause();
}
function select(track, albumQueue = queue) {
  pausePlayback();
  if (track.source !== 'youtube') window.youtubePlayback?.detach();
  current = track; plannedNext = null; queue = albumQueue.length ? [...albumQueue] : [track];
  if (track.source !== 'youtube' && source === 'youtube') selectSource(track.source === 'volumio' ? 'volumio' : 'local');
  if (usesYouTube()) { audio.removeAttribute('src'); audio.load(); }
  else audio.src = `nocturne://audio/${track.id}`;
  window.editPlayback?.prepare(); updateNow(); updateSelected(); start();
  if ('mediaSession' in navigator) navigator.mediaSession.metadata = new MediaMetadata({ title: track.title, artist: track.artist, album: track.album });
}
function toggle() { if (!current && focused) select(focused.tracks[0], focused.tracks); else if (current) playbackMedia().paused && !playbackPending ? start() : pausePlayback(); else message('Ajoute un album pour commencer.'); }
function seekPlayback(seconds) {
  const media = playbackMedia();
  if (!Number.isFinite(media.duration)) return;
  const position = Math.max(0, Math.min(media.duration, seconds));
  if (usesEditAudio()) window.editPlayback.seek(position); else if (usesYouTube()) window.youtubePlayback.seek(position); else audio.currentTime = position;
  updatePlaybackTime();
}
// Fixer aussi le tirage aléatoire : le titre préparé doit être celui qui sera lu.
function upcomingTrack() {
  if (!current) return null;
  if (usesYouTube()) { const track = window.youtubePlayback?.upcoming(); return track?.id !== current.id ? track || null : null; }
  const available = queue.length ? queue : focused?.tracks || [];
  if (plannedNext?.from === current.id && available.some(track => track.id === plannedNext.track.id)) return plannedNext.track;
  const index = available.findIndex(track => track.id === current.id);
  let track;
  if (shuffled && available.length > 1) { const others = available.filter(track => track.id !== current.id); track = others[Math.floor(Math.random() * others.length)]; }
  else track = available[index + 1] || (repeat ? available[0] : null);
  plannedNext = track ? { from: current.id, track } : null;
  return track || null;
}
function queueChanged() { plannedNext = null; window.dispatchEvent(new Event('playback-queue-change')); }
function next(direction = 1, automatic = false) {
  if (usesYouTube()) { window.youtubePlayback.next(direction); return; }
  const available = queue.length ? queue : focused?.tracks || [];
  if (!available.length) return;
  if (direction < 0 && playbackMedia().currentTime > 3) { seekPlayback(0); return; }
  const index = available.findIndex(track => track.id === current?.id); let target = index + direction;
  if (direction > 0) { const prepared = upcomingTrack(); if (prepared) { select(prepared, available); return; } }
  if (shuffled && available.length > 1) { const others = available.filter(track => track.id !== current?.id); select(others[Math.floor(Math.random() * others.length)], available); return; }
  if (automatic && target >= available.length && !repeat) return;
  target = (target + available.length) % available.length; select(available[target], available);
}
async function importMusic(folder) {
  if (busy) return;
  busy = true; $('add').disabled = $('folder').disabled = true; message('Sélection et analyse des fichiers…');
  try { const result = await window.library.import(folder); tracks = result.tracks; source = 'local'; localStorage.setItem('source', source); render(); message(result.skipped ? `Bibliothèque mise à jour. ${result.skipped} fichier(s) illisible(s).` : 'Bibliothèque à jour.'); }
  catch (error) { message(`Import impossible : ${error.message}`); }
  finally { busy = false; $('add').disabled = $('folder').disabled = false; }
}
$('add').onclick = () => importMusic(false);
$('folder').onclick = () => source === 'volumio' ? openServer() : importMusic(true);
$('search').oninput = render;
$('play-album').onclick = () => { if (focused) select(focused.tracks[0], focused.tracks); };
$('play').onclick = toggle; $('previous').onclick = () => next(-1); $('next').onclick = () => next();
$('shuffle').onclick = () => { shuffled = !shuffled; $('shuffle').setAttribute('aria-pressed', String(shuffled)); queueChanged(); };
$('repeat').onclick = () => { repeat = !repeat; $('repeat').setAttribute('aria-pressed', String(repeat)); queueChanged(); };
const savedVolume = Number(localStorage.getItem('volume') ?? 0.75);
audio.volume = Number.isFinite(savedVolume) ? Math.min(1, Math.max(0, savedVolume)) : 0.75; $('volume').value = audio.volume;
$('volume').oninput = () => { audio.volume = Number($('volume').value); localStorage.setItem('volume', audio.volume); window.editPlayback?.setVolume(audio.volume); if (usesYouTube() && !usesEditAudio()) window.youtubePlayback.setVolume(audio.volume); };
$('seek').oninput = () => seekPlayback(Number($('seek').value) / 100 * playbackMedia().duration);
function updatePlaybackTime() {
  const media = playbackMedia();
  $('elapsed').textContent = time(media.currentTime); $('duration').textContent = time(media.duration);
  $('seek').value = Number.isFinite(media.duration) && media.duration > 0 ? media.currentTime / media.duration * 100 : 0;
  $('volume').disabled = usesEditAudio() && window.editPlayback.isEmbedded();
  $('volume').title = $('volume').disabled ? 'Utilise le volume dans le lecteur TikTok' : 'Volume';
  $('shuffle').disabled = $('repeat').disabled = usesYouTube();
}
function playbackState() { const paused = playbackMedia().paused; const playing = !paused || playbackPending; $('play').textContent = playing ? 'Ⅱ' : '▶'; $('play').setAttribute('aria-label', playing ? 'Pause' : 'Lire'); $('play').setAttribute('aria-busy', String(playbackPending)); $('disc').classList.toggle('spinning', !paused); }
function bindAudio() {
  audio.ontimeupdate = audio.onloadedmetadata = audio.onemptied = updatePlaybackTime;
  audio.onplay = audio.onpause = playbackState;
  audio.onended = () => { if (!usesEditAudio()) next(1, true); };
  audio.onerror = () => { if (!usesEditAudio()) message(current?.source === 'volumio' ? 'Fichier Volumio inaccessible. Vérifie la connexion au serveur et le format audio.' : 'Fichier inaccessible ou format non pris en charge. Tu peux le retirer et le réimporter.'); };
}
function adoptPreparedAudio(prepared) {
  if (!prepared || prepared === audio) return;
  const old = audio;
  prepared.id = 'audio'; prepared.muted = old.muted; prepared.volume = Number($('volume').value);
  old.pause(); old.replaceWith(prepared); audio = prepared; bindAudio();
  old.removeAttribute('src'); old.load();
  window.dispatchEvent(new Event('audio-element-change'));
}
bindAudio();
document.addEventListener('keydown', event => { if (event.code === 'Space' && !['INPUT', 'BUTTON', 'TEXTAREA'].includes(event.target.tagName) && !$('volumio-dialog').open) { event.preventDefault(); toggle(); } });
if ('mediaSession' in navigator) {
  navigator.mediaSession.setActionHandler('play', () => current ? start() : toggle());
  navigator.mediaSession.setActionHandler('pause', pausePlayback);
  navigator.mediaSession.setActionHandler('previoustrack', () => next(-1)); navigator.mediaSession.setActionHandler('nexttrack', () => next());
}

// Le catalogue vient de Volumio ; les fichiers sont lus par l'ordinateur.
let folderPath = [{ title: 'Bibliothèque', uri: 'music-library' }], folderBusy = false, syncing = false;
function selectSource(value) { source = value; localStorage.setItem('source', value); focused = null; $('search').value = ''; render(); window.youtubeMusicUI?.setVisible(value === 'youtube'); }
$('source-local').onclick = () => selectSource('local');
$('source-volumio').onclick = () => { selectSource('volumio'); if (!remote.baseUrl) openServer(); };
async function openServer() {
  $('server-address').value = remote.baseUrl || 'http://volumio.local'; $('volumio-dialog').showModal();
  if (remote.baseUrl) await browseFolder('music-library', 'Bibliothèque', 0);
}
$('server-settings').onclick = openServer;
$('close-server').onclick = () => { if (syncing) window.volumio.cancel(); $('volumio-dialog').close(); };
$('volumio-dialog').addEventListener('cancel', () => { if (syncing) window.volumio.cancel(); });
function showFolders(items) {
  $('breadcrumbs').replaceChildren();
  folderPath.forEach((part, index) => { const button = element('button', '', `${index ? ' / ' : ''}${part.title}`); button.onclick = () => browseFolder(part.uri, part.title, index); $('breadcrumbs').append(button); });
  const folders = items.filter(item => (item.type === 'category' || /(?:^|-)folder$/.test(item.type)) && /^music-library(?:\/|$)/.test(item.uri || ''));
  const songs = items.filter(item => ['song', 'track'].includes(item.type)); $('server-folders').replaceChildren();
  folders.forEach(item => { const button = element('button', 'server-folder'); button.append(element('span', '', '↳'), element('span', '', item.title || item.name || item.uri.split('/').at(-1)), element('span', '', '→')); button.onclick = () => browseFolder(item.uri, item.title || item.name); $('server-folders').append(button); });
  if (songs.length) $('server-folders').append(element('div', 'server-song', `${songs.length} morceau${songs.length > 1 ? 'x' : ''} dans ce dossier`));
  if (!folders.length && !songs.length) $('server-folders').append(element('p', 'server-song', 'Ce dossier est vide.'));
  $('server-folder-count').textContent = `${folders.length} dossiers · sous-dossiers inclus à la synchronisation`; $('import-server').disabled = false;
}
async function browseFolder(uri, title, index) {
  if (folderBusy || syncing) return;
  folderBusy = true; $('import-server').disabled = true; $('server-message').textContent = 'Ouverture du dossier…';
  try {
    const items = await window.volumio.browse(uri);
    folderPath = index !== undefined ? folderPath.slice(0, index + 1) : [...folderPath, { title, uri }];
    showFolders(items); $('server-message').textContent = 'Choisis un dossier. Tous ses sous-dossiers seront inclus. Le son sera lu sur cet ordinateur.';
  } catch (error) { $('server-message').textContent = error.message; }
  finally { folderBusy = false; }
}
$('server-form').onsubmit = async event => {
  event.preventDefault(); if (folderBusy || syncing) return;
  folderBusy = true; $('connect-server').disabled = true; $('import-server').disabled = true; $('server-message').textContent = 'Connexion à Volumio…';
  try {
    const result = await window.volumio.connect($('server-address').value);
    remote = result; folderPath = [{ title: 'Bibliothèque', uri: 'music-library' }];
    showFolders(result.items); $('server-message').textContent = 'Connecté. Choisis le dossier à synchroniser avec ses sous-dossiers. Lecture sur cet ordinateur.'; selectSource('volumio');
  } catch (error) { $('server-message').textContent = error.message; }
  finally { folderBusy = false; $('connect-server').disabled = false; }
};
window.volumio.onProgress(progress => { const text = `${progress.folders} dossiers parcourus · ${progress.tracks} morceaux trouvés`; $('server-message').textContent = text; $('folder-label').textContent = text; });
async function syncFolder(uri) {
  if (syncing || folderBusy) return;
  syncing = true; $('sync').disabled = $('import-server').disabled = $('connect-server').disabled = true;
  $('server-message').textContent = 'Synchronisation des dossiers et sous-dossiers…'; message('Synchronisation de Volumio…');
  try {
    remote = await window.volumio.sync(uri);
    if (current?.source === 'volumio') { const available = new Map(remote.tracks.map(track => [track.id, track])); queue = queue.map(track => available.get(track.id)).filter(Boolean); queueChanged(); }
    selectSource('volumio'); $('volumio-dialog').close(); message(`${remote.tracks.length} morceaux synchronisés. Lecture sur cet ordinateur.`);
  } catch (error) { $('server-message').textContent = error.message; message(error.message); }
  finally { syncing = false; $('sync').disabled = $('connect-server').disabled = false; $('import-server').disabled = !remote.baseUrl; render(); }
}
$('import-server').onclick = () => syncFolder(folderPath.at(-1).uri);
$('sync').onclick = () => syncFolder(remote.rootUri || 'music-library');
function clock() { $('clock').textContent = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); }
clock(); setInterval(clock, 30000);
Promise.all([window.library.load(), window.volumio.load()]).then(([local, network]) => {
  tracks = local; remote = network;
  if (!localStorage.getItem('source') && remote.tracks.length) source = 'volumio';
  render();
}).catch(error => message(`Chargement impossible : ${error.message}`));
