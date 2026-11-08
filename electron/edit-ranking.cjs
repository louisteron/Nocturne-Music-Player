const { searchMetadata } = require('./search-metadata.cjs');
const { sameSound } = require('./edit-discovery.cjs');
const normalize = text => String(text || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
function mentions(text, phrase) {
  const normalized = normalize(phrase);
  if (normalized.length < 3) return false;
  if (` ${normalize(text)} `.includes(` ${normalized} `)) return true;
  const compact = normalized.replace(/ /g, '');
  return normalize(text).split(' ').some(word => [compact, compact + 'edit', compact + 'edits'].includes(word));
}
function visualEdit(video) {
  if (video.is_ad || video.images?.length) return false;
  const text = normalize(video.title);
  // Détecte aussi les hashtags accolés : #lyricsedit, #songlyrics, etc.
  if (/lyric|paroles|karaoke|traduction|translation|letra|subtitl|sous titre|typograph|textedit|text edit|visualiz|audio only|full song|full audio/.test(text)) return false;
  return /edit|\bamv\b|\bfmv\b|\bfanvid\b/.test(text);
}
function rankVideos(track, videos) {
  track = searchMetadata(track);
  const found = new Map();
  for (const video of videos) {
    if (!/^\d{16,22}$/.test(String(video.video_id)) || !visualEdit(video)) continue;
    const music = video.music_info;
    const exactSound = sameSound(track, music);
    const unknownSound = !music || music.original === true || /^(original sound|son original|original audio)/.test(normalize(music.title));
    const captionMatch = unknownSound && mentions(video.title, track.title) && mentions(video.title, track.artist);
    if (!exactSound && !captionMatch) continue;
    const visual = /cinema|movie|film|anime|manga|scene|character|personnage|football|basketball|sport|car edit|aesthetic|landscape|nature|montage/.test(normalize(video.title));
    const username = String(video.author?.unique_id || '');
    const id = String(video.video_id);
    found.set(id, {
      videoId: id, url: /^[a-zA-Z0-9_.]{1,40}$/.test(username) ? `https://www.tiktok.com/@${username}/video/${id}` : `https://www.tiktok.com/player/v1/${id}`,
      title: String(video.title || '').slice(0, 500), author: String(video.author?.nickname || username).slice(0, 100),
      automatic: true, musicId: String(music?.id || ''), soundTitle: track.title, soundArtist: track.artist,
      streamUrl: video.streamUrl, streamUrls: video.streamUrls, streamAvailable: Boolean(video.streamUrl),
      evidence: exactSound ? 'metadata' : 'caption', score: (exactSound ? 100 : 60) + (visual ? 10 : 0)
    });
  }
  return [...found.values()].sort((a, b) => b.score - a.score);
}
module.exports = { mentions, visualEdit, rankVideos };
