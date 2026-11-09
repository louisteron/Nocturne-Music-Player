const fs = require('node:fs/promises');
const { createWriteStream } = require('node:fs');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');
const crypto = require('node:crypto');
const execute = promisify(execFile);
const { wav } = require('./audio-decode.cjs');
const crossfade = require('../src/crossfade.js');
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
function createMatcher({ app, session, sourceUrl, clipResponse, decodeTail, youtubeResponse }) {
  const directory = path.join(app.getPath('userData'), 'audio-fingerprints');
  const binary = app.isPackaged ? path.join(process.resourcesPath, 'fpcalc', process.platform === 'win32' ? 'fpcalc.exe' : 'fpcalc') : path.join(__dirname, '../vendor/fpcalc', `${process.platform === 'darwin' ? 'mac' : 'win'}-${process.arch}`, process.platform === 'win32' ? 'fpcalc.exe' : 'fpcalc');
  const pending = new Map();
  async function fingerprint(file, signal) {
    let stdout;
    try { ({ stdout } = await execute(binary, ['-json', '-raw', '-length', '0', file], { signal, timeout: 60000, maxBuffer: 5000000, windowsHide: true })); }
    catch (error) { if (signal?.aborted || !error.stdout) throw error; stdout = error.stdout; }
    const result = JSON.parse(stdout);
    if (!Array.isArray(result.fingerprint)) throw new Error('Empreinte audio illisible.');
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
    if (!['volumio', 'youtube'].includes(track.source)) { const stat = await fs.stat(track.path); stamp = `${stat.size}:${stat.mtimeMs}`; }
    const key = `reference-levels-v3:${track.id}:${stamp}`, cacheFile = path.join(directory, `${hash(key)}.json`);
    try { const entry = JSON.parse(await fs.readFile(cacheFile, 'utf8')); if (Date.now() - entry.date < 7 * 86400000 && Array.isArray(entry.data?.fingerprint) && entry.data.fingerprint.length >= 32 && Object.hasOwn(entry.data, 'levels')) return entry.data; } catch { /* Empreinte / niveau à calculer. */ }
    if (!pending.has(key)) pending.set(key, (async () => {
      await fs.mkdir(directory, { recursive: true });
      const temp = await fs.mkdtemp(path.join(directory, 'reference-'));
      try {
        const combined = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(150000)]);
        let file = track.path;
        if (['volumio', 'youtube'].includes(track.source)) {
          const response = track.source === 'youtube' ? await youtubeResponse(track, combined) : await session.fetch(sourceUrl(track.id), { redirect: 'error', signal: combined });
          file = path.join(temp, 'original.audio'); await download(response, file, 512000000, combined);
        }
        const fingerprintValue = await fingerprint(file, combined);
        let levels = null;
        if (decodeTail) { try { levels = await decodeTail(file, combined, { levelsOnly: true }); } catch { combined.throwIfAborted(); } }
        const data = { fingerprint: fingerprintValue, levels };
        await fs.writeFile(cacheFile + '.tmp', JSON.stringify({ date: Date.now(), data })); await fs.rename(cacheFile + '.tmp', cacheFile);
        return data;
      } finally { await fs.rm(temp, { recursive: true, force: true }); }
    })().finally(() => pending.delete(key)));
    return pending.get(key);
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
    return compare(reference.fingerprint, sample);
  }
  async function alignment(track, video, signal) {
    const combined = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(120000)]);
    await fs.mkdir(directory, { recursive: true });
    const temp = await fs.mkdtemp(path.join(directory, 'alignment-'));
    try {
      const [reference, file] = await Promise.all([
        original(track, combined),
        (async () => {
          const response = await clipResponse(video.videoId, combined);
          const file = path.join(temp, 'video.audio');
          await download(response, file, 80000000, combined);
          return file;
        })()
      ]);
      if (!decodeTail) return alignEnd(reference.fingerprint, await fingerprint(file, combined));
      const decoded = await decodeTail(file, combined);
      const calculate = async (pcm, rate) => {
        combined.throwIfAborted();
        const sample = path.join(temp, 'tail.wav'); await fs.writeFile(sample, wav(pcm, rate));
        return fingerprint(sample, combined);
      };
      let result = { matched: false, reason: 'no-confident-match' };
      // Chercher la musique avant une éventuelle signature / outro. Les
      // fenêtres comparées restent limitées aux dix dernières secondes utiles.
      for (const trim of [0, .5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5]) {
        const count = decoded.pcm.length - Math.round(trim * decoded.rate) * 2;
        if (count < decoded.rate * 5 * 2) break;
        const pcm = decoded.pcm.subarray(Math.max(0, count - decoded.rate * 10 * 2), count);
        const part = { ...decoded, pcm, duration: decoded.duration - trim };
        const coarse = await alignTail(reference.fingerprint, part, calculate, combined);
        if (!coarse.matched) continue;
        const matchedPcm = pcm.subarray(Math.max(0, pcm.length - coarse.windowSeconds * decoded.rate * 2));
        const precise = require('./audio-sync.cjs').refine(reference.levels, crossfade.levels(matchedPcm, decoded.rate, .01), coarse);
        if (precise) {
          result = { ...coarse, ...precise, syncVerified: true, anchorSeconds: part.duration, musicEndSeconds: part.duration };
          break;
        }
        // Garder un relais simple si la correspondance temporelle n’est pas
        // suffisamment précise ; ne jamais superposer deux passages incertains.
        if (!result.matched || coarse.distance < result.distance - .5) { result = { ...coarse, anchorSeconds: part.duration, musicEndSeconds: part.duration, syncVerified: false }; }
      }
      if (result.matched && result.syncVerified) {
        let fade = null;
        const normalized = (pcm, end, step = .1) => require('./audio-sync.cjs').relativeLevels(reference.levels, crossfade.levels(pcm, decoded.rate, step), end, step, result);
        // L’ancre peut précéder la dernière seconde devenue presque muette.
        // Prolonger jusqu’à la vraie fin du fade, sans inclure le jingle suivant.
        const limit = Math.min(decoded.duration, result.anchorSeconds + 1.5);
        for (let end = Math.max(decoded.duration - decoded.pcm.length / (decoded.rate * 2) + 4.5, result.anchorSeconds - 3.5); end <= limit + .001; end += .1) {
          const boundary = decoded.pcm.length - Math.round((decoded.duration - Math.min(end, decoded.duration)) * decoded.rate) * 2;
          const tail = decoded.pcm.subarray(Math.max(0, boundary - decoded.rate * result.windowSeconds * 2), boundary);
          const candidate = crossfade.detectFade(normalized(tail, Math.min(end, decoded.duration)), Math.min(end, decoded.duration));
          if (candidate && candidate.startSeconds <= result.anchorSeconds) fade = candidate;
        }
        // Inclure exactement l’extrémité, même si elle n’est pas sur le pas de 100 ms.
        if (limit === decoded.duration) {
          const candidate = crossfade.detectFade(normalized(decoded.pcm.subarray(Math.max(0, decoded.pcm.length - decoded.rate * result.windowSeconds * 2)), decoded.duration), decoded.duration);
          if (candidate && candidate.startSeconds <= result.anchorSeconds) fade = candidate;
        }
        if (fade) {
          const boundary = crossfade.musicBoundary(normalized(decoded.pcm, decoded.duration, .01), decoded.duration, fade);
          if (boundary < fade.endSeconds) {
            fade.endSeconds = boundary;
            fade.points = [...fade.points.filter(point => point.time < boundary), { time: boundary, gain: 0 }];
          }
          result.musicEndSeconds = fade.endSeconds;
          // Le rapport edit / original retire les accents propres à la musique
          // avant de détecter le fade, et fournit directement le gain cible.
          fade.normalization = Math.max(.25, Math.min(2, fade.baseline));
          result.fade = fade;
        }
      }
      return result;
    } finally { await fs.rm(temp, { recursive: true, force: true }); }
  }
  return { match, alignment };
}
// On corrige la hauteur ET le tempo avant de calculer l’empreinte, plutôt
// que d’étirer des empreintes déjà calculées (ce qui ne corrige pas la hauteur).
async function alignTail(reference, decoded, fingerprint, signal) {
  const step = 1365 / 11025;
  let best = null;
  for (const seconds of [10, 5]) {
    const pcm = decoded.pcm.subarray(Math.max(0, decoded.pcm.length - seconds * decoded.rate * 2));
    if (pcm.length < 4.5 * decoded.rate * 2) continue;
    const tested = new Set(), candidates = [];
    async function attempt(speed) {
      const rate = Math.round(decoded.rate / speed);
      if (tested.has(rate)) return;
      tested.add(rate); signal?.throwIfAborted();
      const sample = await fingerprint(pcm, rate);
      const result = compare(reference, sample, { minFrames: 16 });
      if (result && Number.isFinite(result.distance)) candidates.push({ speed: decoded.rate / rate, distance: result.distance });
      if (!result || result.distance > 7.5) return;
      const other = compare(reference, sample, { minFrames: 16, skipOffset: result.offset });
      const margin = other ? other.distance - result.distance : Infinity;
      const strong = result.distance <= (seconds === 5 ? 2.5 : 4.5) && margin >= (seconds === 5 ? 0.8 : 0.6);
      let verified = false;
      if (!strong && seconds === 10 && margin >= 2.5) {
        // Reverb / filtre : une distance moins bonne n’est tolérée que si
        // une seconde fenêtre de fin retrouve le même point à la même vitesse.
        const suffix = decoded.pcm.subarray(Math.max(0, decoded.pcm.length - 7 * decoded.rate * 2));
        const checkSample = await fingerprint(suffix, rate);
        const check = compare(reference, checkSample, { minFrames: 16 });
        if (check && check.distance <= 7.5) {
          const alternative = compare(reference, checkSample, { minFrames: 16, skipOffset: check.offset });
          const endpoint = check.offset * step + suffix.length / 2 / rate;
          verified = (!alternative || alternative.distance - check.distance >= 2) && Math.abs(endpoint - (result.offset * step + pcm.length / 2 / rate)) < .35;
        }
      }
      if (!strong && !verified) return;
      if (!best || result.distance < best.distance) best = {
        matched: true, positionSeconds: result.offset * step + pcm.length / 2 / rate,
        distance: result.distance, windowSeconds: seconds, speed: decoded.rate / rate
      };
    }
    await attempt(1);
    if (best?.distance < 2) return best;
    for (let value = 0.65; value <= 1.501; value += 0.025) await attempt(value);
    // Une vitesse intermédiaire peut donner une mauvaise empreinte au pas
    // grossier : affiner aussi les candidats qui ne passent pas encore le seuil.
    const centers = candidates.sort((a, b) => a.distance - b.distance).slice(0, 4).map(candidate => candidate.speed);
    for (const center of centers) {
      for (let delta = -0.0225; delta <= 0.023; delta += 0.0025) {
        const speed = center + delta;
        if (speed >= .65 && speed <= 1.5) await attempt(speed);
      }
      if (best?.distance < 2) return best;
    }
    if (best) return best;
  }
  return { matched: false, reason: 'no-confident-match' };
}
module.exports = { createMatcher, compare, alignEnd, alignTail, mediaUrl, fetchMedia };
