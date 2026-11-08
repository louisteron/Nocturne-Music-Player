(() => {
  let visible = false, attached = false, adopting = false;
  const media = { paused: true, currentTime: 0, duration: 0, readyState: 0, bufferedAhead: 0, track: null };
  function report(error) { $('youtube-state').textContent = error.message; }
  function showBlocker(state) {
    $('youtube-adblock').setAttribute('aria-pressed', String(state.enabled));
    $('youtube-adblock').textContent = state.enabled ? 'Bloqueur activé' : 'Bloqueur désactivé';
    $('youtube-adblock').title = `${state.blocked} requêtes publicitaires bloquées. Cliquer pour ${state.enabled ? 'désactiver' : 'activer'}.`;
  }
  async function command(action, value) { return window.youtube.command(action, value, ['play', 'seek'].includes(action) ? media.track?.videoId : undefined); }
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
    async play() { await command('volume', audio.volume); await command('play'); media.paused = false; updatePlaybackTime(); playbackState(); },
    pause() { media.paused = true; command('pause').catch(() => {}); if (usesYouTube()) playbackState(); },
    detach() { attached = false; this.pause(); },
    seek(seconds) { command('seek', seconds).catch(report); },
    next(direction) { command(direction < 0 ? 'previous' : 'next').catch(report); },
    setVolume(value) { command('volume', value).catch(report); },
    async prepare(position, signal, id) {
      if (media.track?.id !== id) throw new Error('Le morceau YouTube Music a changé.');
      this.pause(); await command('seek', position);
      await new Promise((resolve, reject) => {
        const cleanup = () => { clearTimeout(timer); clearInterval(poll); signal.removeEventListener('abort', check); };
        const check = () => {
          if (signal.aborted || media.track?.id !== id) { cleanup(); reject(new DOMException('Préparation annulée', 'AbortError')); }
          else if (Math.abs(media.currentTime - position) < 1 && media.readyState >= 3) { cleanup(); resolve(); }
        };
        const timer = setTimeout(() => { cleanup(); reject(new Error('YouTube Music ne peut pas préparer la suite. Ouvre son lecteur pour vérifier la lecture.')); }, 15000);
        const poll = setInterval(check, 100); signal.addEventListener('abort', check); check();
      });
    }
  };
  window.youtube.onState(state => {
    if (state.ad) { $('youtube-state').textContent = 'Publicité YouTube Music · la recherche d’edits attend le morceau.'; return; }
    if (!state.track) return;
    Object.assign(media, state);
    $('youtube-state').textContent = `${state.track.title} · ${state.track.artist}`;
    if ((attached || visible) && !adopting && !state.paused && current?.id !== state.track.id) {
      adopting = true; attached = true;
      select(state.track, [state.track]);
      adopting = false;
    } else if (current?.id === state.track.id) {
      if (usesEditAudio() && !state.paused) window.youtubePlayback.pause();
      else if (!usesEditAudio()) { updatePlaybackTime(); playbackState(); }
    }
  });
  window.youtube.onStatus(state => { $('youtube-state').textContent = state.text; });
  $('source-youtube').onclick = () => selectSource('youtube');
  $('youtube-search-form').onsubmit = event => { event.preventDefault(); window.youtube.search($('youtube-query').value).catch(report); };
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
  window.addEventListener('edits-audio-change', () => window.youtube.hold(usesEditAudio()).catch(report));
  window.youtube.hold(usesEditAudio()).catch(report);
  window.youtubeMusicUI.setVisible(source === 'youtube');
})();
