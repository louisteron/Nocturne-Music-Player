(function (root) {
  const compare = new Intl.Collator('fr', { numeric: true, sensitivity: 'base' }).compare;
  function group(tracks) {
    const albums = new Map();
    for (const track of tracks) {
      const name = track.album && track.album !== 'Album inconnu' ? track.album : track.folderName || 'Sans album';
      const artist = track.albumArtist || (track.compilation ? 'Artistes variés' : track.artist) || 'Artiste inconnu';
      const folder = (track.folder || track.path?.replace(/[/\\][^/\\]*$/, '') || '').replace(/[/\\](?:cd|disc|disk)\s*\d+$/i, '');
      // Les fichiers sans tags de deux dossiers différents restent séparés.
      const identity = track.album && track.album !== 'Album inconnu' ? [name, track.albumArtist || folder || artist] : [name, folder];
      const key = JSON.stringify([track.source || 'local', ...identity]);
      if (!albums.has(key)) albums.set(key, { key, title: name, artist, cover: null, tracks: [] });
      const album = albums.get(key);
      if (!album.cover && track.cover) album.cover = track.cover;
      album.tracks.push(track);
    }
    return [...albums.values()].sort((a, b) => compare(a.title, b.title) || compare(a.artist, b.artist)).map(album => ({
      ...album,
      artist: album.tracks.find(track => track.albumArtist)?.albumArtist || (new Set(album.tracks.map(track => track.artist)).size > 1 ? 'Artistes variés' : album.artist),
      tracks: album.tracks.sort((a, b) => (a.discNumber || 1) - (b.discNumber || 1) || (a.trackNumber || 0) - (b.trackNumber || 0) || compare(a.title, b.title))
    }));
  }
  if (typeof module !== 'undefined') module.exports = { group };
  else root.Albums = { group };
})(globalThis);
