const comparable = value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
function cleanTitle(value) {
  const original = String(value || '').trim();
  const cleaned = original
    .replace(/\s*[([]\s*(?:feat\.?|ft\.?|featuring)\s+[^)\]]*[)\]]/gi, '')
    .replace(/\s+(?:feat\.?|ft\.?|featuring)\s+.*$/i, '')
    .replace(/\s*[([]\s*(?:official\s+(?:music\s+)?(?:video|audio)|music video|audio officiel|clip officiel|(?:official\s+)?lyrics?|(?:official\s+)?lyric video)\s*[)\]]/gi, '')
    .trim();
  return cleaned || original;
}
function searchMetadata(track) {
  let title = String(track.title || '').trim(), artist = String(track.artist || '').trim();
  if (track.source === 'youtube' && track.searchMetadataVersion !== 1) {
    // Les publications non officielles suivent souvent « Artiste - Titre ».
    // Exiger des espaces évite de découper les noms comme JAY-Z.
    const parts = title.split(/\s+[-–—|]\s+/);
    if (parts.length === 2 && parts.every(part => part.trim()) && !/^(?:live|remix|sped up|slowed|instrumental|official\b|lyrics?\b|audio\b)/i.test(parts[1].trim())) {
      const [left, right] = parts.map(part => part.trim());
      if (comparable(right) === comparable(artist)) { title = left; artist = right; }
      else { artist = left; title = right; }
    } else if (artist && title.toLowerCase().startsWith(artist.toLowerCase() + ': ')) {
      title = title.slice(artist.length + 2).trim();
    }
  }
  return { ...track, title: cleanTitle(title), artist, searchMetadataVersion: 1 };
}
module.exports = { cleanTitle, searchMetadata };
// Nettoyage réservé à TikTok : conserver les métadonnées d’affichage.
function withoutAnnotations(value) {
  let text = String(value || '').trim(), previous;
  do { previous = text; text = text.replace(/\([^()]*\)|\[[^\[\]]*\]/g, ' '); } while (text !== previous);
  return text.replace(/\s+/g, ' ').trim() || String(value || '').trim();
}
function firstArtist(value) {
  const text = String(value || '').replace(/\s+(?:feat\.?|ft\.?|featuring)\s+.*$/i, '').trim();
  // La virgule fait partie du nom de cet artiste, pas d’une liste de crédits.
  const protectedName = text.replace(/Tyler,\s*the Creator/gi, 'Tyler\u0001 The Creator');
  return protectedName.split(/\s*(?:;|·|,|&|×)\s*|\s+[xX/]\s+/)[0].replace(/\u0001 /g, ', ').trim();
}
function tiktokSearchMetadata(track) {
  let base = searchMetadata(track);
  // Certaines publications incluent déjà « titre · artiste » dans le titre.
  const parts = String(base.title || '').split(/\s+[·•]\s+/);
  if (parts.length >= 2 && parts.every(part => part.trim())) base = { ...base, title: parts[0], artist: parts[1] };
  const credit = Array.isArray(track.artists) && track.artists.length ? (typeof track.artists[0] === 'string' ? track.artists[0] : track.artists[0]?.name) : base.artist;
  return { ...base, title: withoutAnnotations(base.title), artist: firstArtist(withoutAnnotations(credit || base.artist)) };
}
module.exports.tiktokSearchMetadata = tiktokSearchMetadata;
module.exports.firstArtist = firstArtist;
