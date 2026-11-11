(() => {
  let visible = false, attached = false, adopting = false, boundaryTimer = null, pendingTrack = null, preparing = null;
  const media = { paused: true, currentTime: 0, duration: 0, readyState: 0, bufferedAhead: 0, track: null };
  function report(error) { $('youtube-state').textContent = error.message; }
  function showBlocker(state) {
    $('youtube-adblock').setAttribute('aria-pressed', String(state.enabled));
    $('youtube-adblock').textContent = state.enabled ? 'Bloqueur activé' : 'Bloqueur désactivé';
    $('youtube-adblock').title = `${state.blocked} requêtes publicitaires bloquées. Cliquer pour ${state.enabled ? 'désactiver' : 'activer'}.`;
  }
  async function command(action, value) { return window.youtube.command(action, value, ['play', 'seek', 'mix'].includes(action) ? media.track?.videoId : undefined); }
  function updateLayout() {
    const rect = $('youtube-native-host').getBoundingClientRect();
    window.youtube.layout({ x: rect.x, y: rect.y, width: rect.width, height: rect.height }, visible && rect.height > 0 && !document.querySelector('dialog[open]') && !document.body.classList.contains('visualizer-open')).catch(report);
  }
  window.youtubeMusicUI = {
    setVisible(value) {
      visible = value; if (value) { attached = true; window.youtube.blockerStatus().then(showBlocker).catch(report); }
      document.querySelector('.library').classList.toggle('youtube-active', value);
      $('youtube-source').hidden = !value;
      $('source-youtube').setAttribute('aria-pressed', String(value));
      if (value) { $('source-local').setAttribute('aria-pressed', 'false'); $('source-volumio').setAttribute('aria-pressed', 'false'); }
      requestAnimationFrame(updateLayout);
    }
  };
  window.youtubePlayback = {
    media: () => media,
    upcoming: () => media.nextTrack || null,
    async play() { await command('volume', audio.volume); await command('play'); media.paused = false; updatePlaybackTime(); playbackState(); },
    pause() { clearTimeout(boundaryTimer); if (preparing) return; media.paused = true; command('pause').catch(() => {}); if (usesYouTube()) playbackState(); },
    detach() { attached = false; this.pause(); },
    seek(seconds) { command('seek', seconds).catch(report); },
    next(direction) {
      clearTimeout(boundaryTimer);
      const track = direction > 0 ? media.nextTrack : null;
      const prepared = window.editPlayback?.upcomingState();
      if (track && prepared?.ready && prepared.id === track.id) {
        pendingTrack = { id: track.id, previous: media.track?.id, until: Date.now() + 15000 };
        const previousVideoId = media.track?.videoId;
        select(track, [track]);
        window.youtube.command('next', undefined, previousVideoId).catch(report);
      } else command(direction < 0 ? 'previous' : 'next').catch(report);
    },
    mix(value) { return command('mix', value); },
    setVolume(value) { command('volume', value).catch(report); },
    async prepare(position, signal, id) {
      const request = { id }; preparing = request;
      const cancel = () => window.youtube.command('pause').catch(() => {});
      const valid = () => !signal.aborted && current?.id === id && preparing === request;
      signal.addEventListener('abort', cancel, { once: true });
      try {
        signal.throwIfAborted();
        if (media.track?.id !== id) await new Promise((resolve, reject) => {
          const cleanup = () => { clearTimeout(timer); clearInterval(poll); signal.removeEventListener('abort', check); };
          const check = () => {
            if (!valid()) { cleanup(); reject(new DOMException('Préparation annulée', 'AbortError')); }
            else if (media.track?.id === id) { cleanup(); resolve(); }
          };
          const timer = setTimeout(() => { cleanup(); reject(new Error('YouTube Music ne charge pas le prochain titre.')); }, 15000);
          const poll = setInterval(check, 50); signal.addEventListener('abort', check); check();
        });
        if (!valid()) throw new DOMException('Préparation annulée', 'AbortError');
        // L'ID vient du morceau demandé, jamais d'un ancien état du lecteur.
        const result = await window.youtube.command('prepare', position, id.slice('youtube:'.length)).catch(error => { if (error.message?.includes('Préparation annulée')) throw new DOMException('Préparation annulée', 'AbortError'); throw error; });
        if (!valid() || result?.cancelled) throw new DOMException('Préparation annulée', 'AbortError');
        Object.assign(media, result);
      } finally { signal.removeEventListener('abort', cancel); if (preparing === request) preparing = null; }
    }
  };
  window.youtube.onState(state => {
    if (state.ad) { clearTimeout(boundaryTimer); $('youtube-state').textContent = 'Publicité YouTube Music · la recherche d’edits attend le morceau.'; return; }
    if (!state.track) return;
    if (pendingTrack && Date.now() < pendingTrack.until && state.track.id === pendingTrack.previous) return;
    pendingTrack = null;
    const previousNext = media.nextTrack?.id;
    Object.assign(media, state);
    $('youtube-state').textContent = `${state.track.title} · ${state.track.artist}`;
    if ((attached || visible) && !adopting && !state.paused && current?.id !== state.track.id) {
      adopting = true; attached = true;
      select(state.track, [state.track]);
      adopting = false;
    } else if (current?.id === state.track.id) {
      if (usesEditAudio() && !window.editPlayback?.isCrossfading() && !preparing && !state.paused) window.youtubePlayback.pause();
      else if (!usesEditAudio()) { updatePlaybackTime(); playbackState(); }
    }
    if (current?.id === state.track.id && previousNext !== media.nextTrack?.id) window.dispatchEvent(new Event('playback-queue-change'));
    clearTimeout(boundaryTimer);
    if (current?.id === state.track.id && !usesEditAudio() && !state.paused && media.duration > 0) {
      const remaining = Math.max(0, (media.duration - media.currentTime) / (media.rate || 1) - Math.max(0, (Date.now() - (media.timestamp || Date.now())) / 1000));
      if (remaining < 3) boundaryTimer = setTimeout(() => {
        const prepared = window.editPlayback?.upcomingState();
        if (!usesEditAudio() && current?.id === state.track.id && !media.paused && prepared?.ready && prepared.id === media.nextTrack?.id) window.youtubePlayback.next(1);
      }, remaining * 1000);
    }
  });
  window.youtube.onStatus(state => { $('youtube-state').textContent = state.text; });
  $('source-youtube').onclick = () => selectSource('youtube');
  $('youtube-home').onclick = () => window.youtube.home().catch(report);
  $('youtube-adblock').onclick = async () => {
    const button = $('youtube-adblock'); button.disabled = true;
    try { showBlocker(await window.youtube.setBlocker(button.getAttribute('aria-pressed') !== 'true')); }
    catch (error) { report(error); }
    finally { button.disabled = false; }
  };
  $('youtube-adblock-update').onclick = async () => {
    const button = $('youtube-adblock-update'); button.disabled = true;
    try { showBlocker(await window.youtube.updateBlocker()); }
    catch (error) { report(error); }
    finally { button.disabled = false; }
  };
  new ResizeObserver(updateLayout).observe($('youtube-native-host'));
  new MutationObserver(updateLayout).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'] });
  window.addEventListener('resize', updateLayout);
  window.addEventListener('visualizer-change', updateLayout);
  window.addEventListener('edits-audio-change', () => window.youtube.hold(usesEditAudio() && !window.editPlayback?.isCrossfading()).catch(report));
  window.youtube.hold(usesEditAudio() && !window.editPlayback?.isCrossfading()).catch(report);
  window.youtubeMusicUI.setVisible(source === 'youtube');
})();
