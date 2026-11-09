// Interopérabilité UMP : https://github.com/gsuberland/UMP_Format
// Spécification publiée dans le domaine public. Seules les parties MEDIA
// non chiffrées du flux déjà utilisé par le lecteur officiel sont décodées.
function audioUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.googlevideo.com') || url.username || url.password || url.port || url.pathname !== '/videoplayback') return null;
    if (!['139', '140', '141', '249', '250', '251', '599', '600'].includes(url.searchParams.get('itag'))) return null;
    return url;
  } catch { return null; }
}
function unwrapUMP(buffer) {
  let offset = 0;
  const chunks = [];
  function integer() {
    if (offset >= buffer.length) throw new Error('Flux YouTube incomplet.');
    const prefix = buffer[offset++]; let size = 1;
    while (size <= 5 && (prefix & (128 >> (size - 1)))) size++;
    if (size > 5 || offset + size - 1 > buffer.length) throw new Error('En-tête audio YouTube invalide.');
    if (size === 5) { const value = buffer.readUInt32LE(offset); offset += 4; return value; }
    let value = prefix & ((1 << (8 - size)) - 1);
    for (let i = 0; i < size - 1; i++) value += buffer[offset++] * 2 ** (8 - size + i * 8);
    return value;
  }
  while (offset < buffer.length) {
    const type = integer(), size = integer();
    if (size > buffer.length - offset) throw new Error('Flux YouTube tronqué.');
    if (type === 12) throw new Error('Ce flux YouTube est chiffré.');
    if (type === 21 && size > 1) chunks.push(buffer.subarray(offset + 1, offset + size));
    offset += size;
  }
  if (!chunks.length) throw new Error('YouTube ne fournit pas de données audio exploitables.');
  return Buffer.concat(chunks);
}
async function fetchAudio(session, value, signal) {
  let url = audioUrl(value);
  if (!url) throw new Error('Flux audio YouTube non autorisé.');
  const limit = 80000000;
  const length = Number(url.searchParams.get('clen'));
  if (length > limit) throw new Error('Ce morceau est trop long pour le repérage audio.');
  url.searchParams.set('range', `0-${length > 0 ? length - 1 : limit - 1}`);
  for (let count = 0; count < 5; count++) {
    const response = await session.fetch(url.href, { redirect: 'manual', signal, headers: { Referer: 'https://music.youtube.com/' } });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location'); await response.body?.cancel();
      url = location && audioUrl(new URL(location, url).href);
      if (!url) throw new Error('Redirection audio YouTube non autorisée.');
      continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`Flux audio YouTube indisponible (${response.status}).`); }
    const type = response.headers.get('content-type') || '';
    if (!/^(audio\/|video\/mp4|application\/(?:vnd.yt-ump|octet-stream))/i.test(type)) { await response.body?.cancel(); throw new Error('YouTube ne fournit pas un flux audio décodable.'); }
    const chunks = []; let size = 0;
    const reader = response.body.getReader();
    try {
      for (;;) {
        signal?.throwIfAborted();
        const result = await reader.read(); if (result.done) break;
        size += result.value.length;
        if (size > limit + 1000000) throw new Error('Flux audio trop volumineux.');
        chunks.push(Buffer.from(result.value));
      }
    } finally { await reader.cancel().catch(() => {}); }
    let buffer = Buffer.concat(chunks);
    if (/application\/vnd.yt-ump/i.test(type)) buffer = unwrapUMP(buffer);
    if (length > 0 && buffer.length !== length) throw new Error('YouTube a fourni seulement une partie du morceau.');
    return new Response(buffer, { headers: { 'Content-Type': 'application/octet-stream' } });
  }
  throw new Error('Trop de redirections audio YouTube.');
}
module.exports = { audioUrl, unwrapUMP, fetchAudio };
