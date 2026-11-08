const fs = require('node:fs/promises');
const { createWriteStream } = require('node:fs');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');
const crypto = require('node:crypto');
const execute = promisify(execFile);
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
function bitCount(value) { value -= (value >>> 1) & 0x55555555; value = (value & 0x33333333) + ((value >>> 2) & 0x33333333); return (((value + (value >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24; }
function compare(reference, sample, { minFrames = 32, skipOffset = null } = {}) {
  if (sample.length < minFrames || reference.length < sample.length || new Set(sample).size < 8) return null;
  let best = Infinity, position = -1;
  for (let offset = 0; offset <= reference.length - sample.length; offset++) {
    if (skipOffset !== null && Math.abs(offset - skipOffset) <= 8) continue;
    let distance = 0;
    for (let index = 0; index < sample.length; index++) {
      distance += bitCount((reference[offset + index] ^ sample[index]) >>> 0);
      if (distance > best * sample.length) break;
    }
    if (distance / sample.length < best) { best = distance / sample.length; position = offset; }
  }
  return { distance: best, offset: position, matched: best <= 4.5 };
}
function alignEnd(reference, sample) {
  // Chromaprint 1.6.2, algorithme par défaut : pas de 1365 / 11025 s.
  // Une empreinte couvre aussi 2,6 s de contexte : on les inclut dans la
  // fenêtre pour ne jamais comparer du son antérieur aux dix dernières secondes.
  const step = 1365 / 11025, context = 28666 / 11025;
  for (const windowSeconds of [10, 5]) {
    const count = Math.floor((windowSeconds - context) / step);
    const start = Math.max(0, sample.length - count), tail = sample.slice(start);
    const result = compare(reference, tail, { minFrames: windowSeconds === 10 ? 32 : 16 });
    if (!result?.matched) continue;
    if (windowSeconds === 5) {
      // Une courte phrase répétée ne suffit pas à choisir un point de reprise.
      const other = compare(reference, tail, { minFrames: 16, skipOffset: result.offset });
      if (result.distance > 2.5 || (other && other.distance - result.distance < 0.8)) continue;
    }
    return { matched: true, offsetSeconds: (result.offset - start) * step, distance: result.distance, windowSeconds };
  }
  return { matched: false };
}
function mediaUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    if (/\.(?:tiktokcdn(?:-eu|-us)?\.com|tiktokv\.com|muscdn\.com|akamaized\.net)$/.test(url.hostname) || (url.hostname.endsWith('.tiktok.com') && (url.hostname !== 'www.tiktok.com' || url.pathname.startsWith('/aweme/v1/play')))) return url.href;
  } catch { /* URL absente. */ }
  return null;
}
async function fetchMedia(session, value, options = {}) {
  let url = mediaUrl(value);
  if (!url) throw new Error('Source TikTok non autorisée.');
  for (let count = 0; count < 5; count++) {
    const response = await session.fetch(url, { ...options, redirect: 'manual' });
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get('location'); await response.body?.cancel();
    url = location && mediaUrl(new URL(location, url).href);
    if (!url) throw new Error('Redirection média non autorisée.');
  }
  throw new Error('Trop de redirections média.');
}
function createMatcher({ app, session, sourceUrl, clipResponse }) {
  const directory = path.join(app.getPath('userData'), 'audio-fingerprints');
  const binary = app.isPackaged ? path.join(process.resourcesPath, 'fpcalc', process.platform === 'win32' ? 'fpcalc.exe' : 'fpcalc') : path.join(__dirname, '../vendor/fpcalc', `${process.platform === 'darwin' ? 'mac' : 'win'}-${process.arch}`, process.platform === 'win32' ? 'fpcalc.exe' : 'fpcalc');
  const pending = new Map();
  async function fingerprint(file, signal) {
    let stdout;
    try { ({ stdout } = await execute(binary, ['-json', '-raw', '-length', '0', file], { signal, timeout: 60000, maxBuffer: 5000000, windowsHide: true })); }
    catch (error) { if (signal?.aborted || !error.stdout) throw error; stdout = error.stdout; }
    const result = JSON.parse(stdout);
    if (!Array.isArray(result.fingerprint) || result.fingerprint.length < 32) throw new Error('Extrait trop court pour comparer le son.');
    return result.fingerprint;
  }
  async function download(response, file, limit, signal) {
    if (!response.ok || /text\/html/.test(response.headers.get('content-type') || '')) throw new Error('Audio inaccessible.');
    let size = 0;
    await pipeline(Readable.fromWeb(response.body), new Transform({ transform(chunk, _encoding, callback) { size += chunk.length; callback(size > limit ? new Error('Audio trop volumineux pour cette analyse.') : null, chunk); } }), createWriteStream(file), { signal });
  }
  async function cached(key, operation) {
    const file = path.join(directory, `${hash(key)}.json`);
    try { const entry = JSON.parse(await fs.readFile(file, 'utf8')); if (Date.now() - entry.date < 7 * 86400000 && Array.isArray(entry.fingerprint) && entry.fingerprint.length >= 32) return entry.fingerprint; } catch { /* Pas d’empreinte. */ }
    if (!pending.has(key)) pending.set(key, (async () => {
      await fs.mkdir(directory, { recursive: true });
      const value = await operation();
      await fs.writeFile(file + '.tmp', JSON.stringify({ date: Date.now(), fingerprint: value })); await fs.rename(file + '.tmp', file);
      return value;
    })().finally(() => pending.delete(key)));
    return pending.get(key);
  }
  async function original(track, signal) {
    let stamp = '';
    if (track.source !== 'volumio') { const stat = await fs.stat(track.path); stamp = `${stat.size}:${stat.mtimeMs}`; }
    return cached(`original:${track.id}:${stamp}`, async () => {
      if (track.source !== 'volumio') return fingerprint(track.path, signal);
      const temp = await fs.mkdtemp(path.join(directory, 'download-'));
      try {
        const combined = signal ? AbortSignal.any([signal, AbortSignal.timeout(150000)]) : AbortSignal.timeout(150000);
        const response = await session.fetch(sourceUrl(track.id), { redirect: 'error', signal: combined });
        const file = path.join(temp, 'original.audio'); await download(response, file, 512000000, combined);
        return await fingerprint(file, signal);
      } finally { await fs.rm(temp, { recursive: true, force: true }); }
    });
  }
  async function match(track, video, signal) {
    if (!mediaUrl(video.soundUrl)) return null;
    const reference = await original(track, signal);
    const sample = await cached(`tiktok:${video.music_info?.id || video.video_id}`, async () => {
      const temp = await fs.mkdtemp(path.join(directory, 'sample-'));
      try {
        const combined = signal ? AbortSignal.any([signal, AbortSignal.timeout(25000)]) : AbortSignal.timeout(25000);
        const response = await fetchMedia(session, video.soundUrl, { signal: combined });
        const file = path.join(temp, 'sample.audio'); await download(response, file, 20000000, combined);
        return await fingerprint(file, signal);
      } finally { await fs.rm(temp, { recursive: true, force: true }); }
    });
    return compare(reference, sample);
  }
  async function alignment(track, video, signal) {
    const [reference, sample] = await Promise.all([
      original(track, signal),
      cached(`video:${video.videoId}`, async () => {
        const temp = await fs.mkdtemp(path.join(directory, 'video-'));
        try {
          const combined = AbortSignal.any([signal, AbortSignal.timeout(90000)]);
          const response = await clipResponse(video.videoId, combined);
          const file = path.join(temp, 'video.audio'); await download(response, file, 80000000, combined);
          return await fingerprint(file, combined);
        } finally { await fs.rm(temp, { recursive: true, force: true }); }
      })
    ]);
    return alignEnd(reference, sample);
  }
  return { match, alignment };
}
module.exports = { createMatcher, compare, alignEnd, mediaUrl, fetchMedia };
