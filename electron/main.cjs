const { app, BrowserWindow, WebContentsView, dialog, ipcMain, protocol, session, shell } = require('electron');
const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const { Readable } = require('node:stream');
const path = require('node:path');
const { createHash } = require('node:crypto');
if (!app.isPackaged && process.env.NOCTURNE_TEST_DATA) app.setPath('userData', process.env.NOCTURNE_TEST_DATA);
protocol.registerSchemesAsPrivileged([{ scheme: 'nocturne', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
const extensions = new Set(['.mp3', '.m4a', '.wav', '.flac', '.ogg', '.aac', '.opus']);
let tracks = [];
let window;
let importing = false;
const store = () => path.join(app.getPath('userData'), 'library.json');
async function save() {
  await fs.mkdir(app.getPath('userData'), { recursive: true });
  await fs.writeFile(store() + '.tmp', JSON.stringify(tracks), 'utf8');
  await fs.rename(store() + '.tmp', store());
}
function authorize(event) {
  if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Accès refusé');
}
async function walk(folder) {
  const found = [];
  for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) {
      try { found.push(...await walk(file)); } catch { /* Dossier inaccessible. */ }
    } else if (entry.isFile() && extensions.has(path.extname(file).toLowerCase())) found.push(file);
  }
  return found;
}
function createWindow() {
  window = new BrowserWindow({ width: 1280, height: 820, minWidth: 850, minHeight: 600, backgroundColor: '#080f12', title: 'Nocturne', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.loadFile(path.join(__dirname, '../src/index.html'));
}
app.whenReady().then(async () => {
  try {
    tracks = JSON.parse(await fs.readFile(store(), 'utf8'));
    if (!Array.isArray(tracks) || tracks.some(track => !track || typeof track.id !== 'string' || typeof track.path !== 'string' || typeof track.title !== 'string' || typeof track.artist !== 'string' || typeof track.album !== 'string')) throw new Error('Format de bibliothèque invalide');
  } catch (error) {
    if (error.code !== 'ENOENT') dialog.showErrorBox('Bibliothèque illisible', 'La bibliothèque précédente ne peut pas être chargée. Une copie sera conservée.');
    if (error.code !== 'ENOENT') await fs.copyFile(store(), store() + '.backup').catch(() => {});
    tracks = [];
  }
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  const volumio = await require('./volumio-ipc.cjs')({ app, ipcMain, authorize, getWindow: () => window });
  const youtube = require('./youtube.cjs').installYouTube({ app, WebContentsView, ipcMain, authorize, session, getWindow: () => window });
  require('./lyrics.cjs')({ app, ipcMain, dialog, authorize, getWindow: () => window, getTrack: id => tracks.find(track => track.id === id) || volumio.getTrack(id) });
  await require('./edits.cjs').installEdits({ app, ipcMain, authorize, shell, getTrack: id => tracks.find(track => track.id === id) || volumio.getTrack(id) });
  const tiktok = await require('./tiktok-session.cjs').installTikTokSession({ app, BrowserWindow, ipcMain, authorize, shell, session: session.defaultSession, getTrack: id => youtube.getTrack(id) || tracks.find(track => track.id === id) || volumio.getTrack(id), sourceUrl: id => volumio.audioUrl(id), getWindow: () => window });
  protocol.handle('nocturne', async request => {
    const url = new URL(request.url);
    if (url.host === 'edit-video') return tiktok.serve(request, url.pathname.slice(1));
    if (url.host === 'cover') return volumio.serve(request, url.pathname.slice(1), 'cover');
    const track = tracks.find(item => item.id === url.pathname.slice(1));
    if (url.host !== 'audio') return new Response('Introuvable', { status: 404 });
    if (!track) return volumio.serve(request, url.pathname.slice(1), 'audio');
    try {
      const { size } = await fs.stat(track.path);
      const mime = { '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.flac': 'audio/flac', '.ogg': 'audio/ogg', '.aac': 'audio/aac', '.opus': 'audio/ogg' }[path.extname(track.path).toLowerCase()];
      const headers = { 'Content-Type': mime, 'Accept-Ranges': 'bytes' };
      let start = 0, end = size - 1, status = 200;
      const range = request.headers.get('range');
      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range);
        if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
        start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
        end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
        if (start > end || start >= size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
        headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
        status = 206;
      }
      headers['Content-Length'] = String(end - start + 1);
      const body = request.method === 'HEAD' ? null : Readable.toWeb(createReadStream(track.path, { start, end }));
      return new Response(body, { status, headers });
    }
    catch { return new Response('Fichier inaccessible', { status: 404 }); }
  });
  ipcMain.handle('library:load', event => { authorize(event); return tracks; });
  ipcMain.handle('library:import', async (event, folder) => {
    authorize(event);
    if (importing) throw new Error('Un import est déjà en cours.');
    importing = true;
    try {
      const selection = await dialog.showOpenDialog(window, { title: folder ? 'Choisir un dossier de musique' : 'Ajouter des morceaux', properties: folder ? ['openDirectory'] : ['openFile', 'multiSelections'], filters: [{ name: 'Audio', extensions: [...extensions].map(ext => ext.slice(1)) }] });
      if (selection.canceled) return { tracks, skipped: 0 };
      const files = folder ? await walk(selection.filePaths[0]) : selection.filePaths;
      const { parseFile } = await import('music-metadata');
      let skipped = 0;
      for (const file of files) {
        if (tracks.some(track => track.path === file)) continue;
        if (!extensions.has(path.extname(file).toLowerCase())) continue;
        try {
          const metadata = await parseFile(file);
          if (!metadata.format.codec || !metadata.format.sampleRate) throw new Error('Aucun flux audio reconnu');
          const picture = metadata.common.picture?.find(item => ['image/jpeg', 'image/png', 'image/webp'].includes(item.format));
          tracks.push({ id: createHash('sha256').update(file).digest('hex'), path: file, title: metadata.common.title || path.basename(file, path.extname(file)), artist: metadata.common.artist || 'Artiste inconnu', album: metadata.common.album || path.basename(path.dirname(file)), albumArtist: metadata.common.albumartist || '', compilation: Boolean(metadata.common.compilation), trackNumber: metadata.common.track.no || 0, discNumber: metadata.common.disk.no || 1, folder: path.dirname(file), folderName: path.basename(path.dirname(file)), duration: metadata.format.duration || 0, cover: picture ? `data:${picture.format};base64,${Buffer.from(picture.data).toString('base64')}` : null });
        } catch { skipped++; }
      }
      await save();
      return { tracks, skipped };
    } finally { importing = false; }
  });
  ipcMain.handle('library:remove', async (event, id) => {
    authorize(event);
    if (importing) throw new Error('Attends la fin de l’import.');
    tracks = tracks.filter(track => track.id !== id);
    await save();
    return tracks;
  });
  createWindow();
  if (process.argv.includes('--tiktok-connect')) tiktok.connect();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
