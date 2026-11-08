(() => {
  let enabled = localStorage.getItem('edits-enabled') === 'true';
  let edits = [], selected = null, token = 0, loadingTimer;
  let ready = false, readyPromise = Promise.resolve(false), resolveReady = () => {}, intent = 0;
  let failedEdits = new Set(), searchedAgain = false;
  const embedded = { paused: true, currentTime: 0, duration: NaN };
  let wantsPlayback = false;
  let continued = false, finishing = false, alignmentPromise = null;
  let preparation = null;
  function waitForAudio(test, signal, timeout = 20000) {
    return new Promise((resolve, reject) => {
      const events = ['loadedmetadata', 'loadeddata', 'canplay', 'progress', 'seeked', 'error'];
      const cleanup = () => { clearTimeout(timer); clearInterval(poll); events.forEach(event => audio.removeEventListener(event, check)); signal.removeEventListener('abort', check); };
      const check = () => {
        if (signal.aborted) { cleanup(); reject(new DOMException('Préparation annulée', 'AbortError')); }
        else if (audio.error) { cleanup(); reject(new Error('Le fichier musical est inaccessible.')); }
        else if (test()) { cleanup(); resolve(); }
      };
      const timer = setTimeout(() => { cleanup(); reject(new Error('La suite du morceau prend trop de temps à charger.')); }, timeout);
      const poll = setInterval(check, 100);
      events.forEach(event => audio.addEventListener(event, check)); signal.addEventListener('abort', check); check();
    });
  }
  function bufferedAt(position, seconds = 3) {
    if (position >= audio.duration - 0.1) return true;
    if (audio.seeking || audio.readyState < 3) return false;
    const end = Math.min(audio.duration - 0.05, position + seconds);
    for (let i = 0; i < audio.buffered.length; i++) if (audio.buffered.start(i) <= position + 0.05 && audio.buffered.end(i) >= end) return true;
    return false;
  }
  async function loadOriginal(item) {
    const signal = item.controller.signal;
    for (let attempt = 0; attempt < 2; attempt++) {
      signal.throwIfAborted();
      if (preparation !== item || current?.id !== item.id || audio.getAttribute('src') !== item.src) throw new DOMException('Préparation annulée', 'AbortError');
      // Une erreur média reste attachée à l'élément jusqu'à load().
      if (audio.error || attempt > 0) { audio.preload = 'auto'; audio.load(); }
      try { await waitForAudio(() => audio.readyState >= 1 && Number.isFinite(audio.duration), signal, 12000); return; }
      catch (error) { if (signal.aborted || attempt === 1) throw error; }
    }
  }
  function prepareContinuation(player, retry = false) {
    const duration = player instanceof HTMLVideoElement ? player.duration : embedded.duration;
    if (!Number.isFinite(duration) || !current || !selected || continued) return null;
    if (preparation?.player === player && preparation.duration === duration && !(retry && preparation.error)) return preparation;
    const previous = preparation; previous?.controller.abort();
    const item = { player, duration, id: current.id, youtube: usesYouTube(), src: audio.getAttribute('src'), previousTime: previous?.previousTime ?? (usesYouTube() ? window.youtubePlayback.media().currentTime : audio.currentTime), previousPreload: previous?.previousPreload ?? audio.preload, controller: new AbortController(), restore: true, ready: false };
    preparation = item;
    item.positionPromise = (async () => {
      const result = await getAlignment();
      const signal = item.controller.signal;
      if (signal.aborted || preparation !== item || current?.id !== item.id) throw new DOMException('Préparation annulée', 'AbortError');
      if (item.youtube) {
        item.exact = result.matched && Number.isFinite(result.offsetSeconds);
        item.position = Math.min(window.youtubePlayback.media().duration, Math.max(0, duration + (item.exact ? result.offsetSeconds : 0)));
        await window.youtubePlayback.prepare(item.position, signal, item.id);
        return item;
      }
      audio.preload = 'auto';
      await loadOriginal(item);
      item.exact = result.matched && Number.isFinite(result.offsetSeconds);
      item.position = Math.min(audio.duration, Math.max(0, duration + (item.exact ? result.offsetSeconds : 0)));
      if (Math.abs(audio.currentTime - item.position) > 0.02) audio.currentTime = item.position;
      return item;
    })();
    item.promise = item.positionPromise.then(async () => {
      if (!item.youtube) await waitForAudio(() => bufferedAt(item.position), item.controller.signal);
      item.ready = true;
      if (frame() === player && !continued && !finishing) status(item.exact ? 'Son de l’edit · suite du morceau prête' : 'Son de l’edit · suite chargée, repérage approximatif');
      return item;
    });
    item.promise.catch(error => { item.error = error; }); // Une erreur de préchargement ne coupe pas l'edit.
    return item;
  }
  function beginWait() {
    const player = frame();
    const resume = wantsPlayback || playbackPending || !audio.paused || (usesYouTube() && window.youtubePlayback && !window.youtubePlayback.media().paused) || (player instanceof HTMLVideoElement ? !player.paused : !embedded.paused);
    pausePlayback(); resolveReady(false); ready = false;
    continued = false; finishing = false;
    readyPromise = new Promise(resolve => { resolveReady = resolve; });
    if (resume) start();
  }
  function markReady(player) {
    if (frame() !== player) return;
    clearTimeout(loadingTimer); ready = true; resolveReady(true);
  }
  function fail(text) { clearTimeout(loadingTimer); ready = false; resolveReady(false); pausePlayback(); status(`${text} La musique reste en pause.`); }
  window.editPlayback = {
    usesEditAudio: () => enabled && !continued,
    media: () => frame() instanceof HTMLVideoElement ? frame() : embedded,
    isEmbedded: () => frame() instanceof HTMLIFrameElement,
    seek: seconds => { if (finishing) { pausePlayback(); finishing = false; } const player = frame(); if (player instanceof HTMLVideoElement) player.currentTime = seconds; else if (player) { embedded.currentTime = seconds; send('seekTo', seconds); } },
    setVolume: volume => { const player = frame(); if (player instanceof HTMLVideoElement) { player.volume = volume; player.muted = false; } },
    prepare: () => refresh(),
    cancelPlay: () => { ++intent; wantsPlayback = false; finishing = false; embedded.paused = true; send('pause'); },
    async requestPlay(id) {
      const request = ++intent;
      if (!enabled || continued) return true;
      wantsPlayback = true;
      if (!(ready || await readyPromise) || request !== intent || current?.id !== id) return false;
      if (!enabled || continued) return true;
      const player = frame();
      try {
        if (player instanceof HTMLVideoElement) await player.play();
        else if (player) { send('unMute'); send('play'); embedded.paused = false; playbackState(); }
        else return false;
      } catch (error) {
        if (frame() !== player || request !== intent || current?.id !== id) return false;
        if (error.name === 'NotAllowedError') fail('Clique sur Lecture dans la vidéo pour démarrer.');
        else recover(player);
        return false;
      }
      if (request !== intent || current?.id !== id) { if (player instanceof HTMLVideoElement && frame() === player && !playbackPending) player.pause(); return false; }
      return true;
    }
  };
  function frame() { return $('edit-player').querySelector('iframe, video'); }
  function send(type, value) {
    const player = frame();
    if (player instanceof HTMLVideoElement) { if (type === 'play') player.play().catch(() => status('Clique sur Lecture dans la vidéo pour démarrer.')); if (type === 'pause') player.pause(); }
    else player?.contentWindow?.postMessage({ type, value, 'x-tiktok-player': true }, 'https://www.tiktok.com');
  }
  function unload() {
    if (preparation) {
      const item = preparation; preparation = null; item.controller.abort();
      if (item.youtube) { if (item.restore && current?.id === item.id) window.youtubePlayback.seek(item.previousTime); }
      else if (audio.getAttribute('src') === item.src) { audio.preload = item.previousPreload; if (item.restore && Number.isFinite(item.previousTime)) audio.currentTime = item.previousTime; }
    }
    clearTimeout(loadingTimer); const player = frame(); player?.remove();
    if (player instanceof HTMLVideoElement) { player.pause(); player.removeAttribute('src'); player.load(); }
    embedded.paused = true; embedded.currentTime = 0; embedded.duration = NaN;
    alignmentPromise = null;
    selected = null; $('edit-open').disabled = $('edit-another').disabled = true;
    updatePlaybackTime(); playbackState();
  }
  function status(text) { $('edit-status').textContent = text; }
  function getAlignment() {
    if (!alignmentPromise && current && selected) alignmentPromise = window.edits.align(current.id, selected.videoId).catch(() => ({ matched: false }));
    return alignmentPromise || Promise.resolve({ matched: false });
  }
  async function continueOriginal(player) {
    if (frame() !== player || !enabled || continued || finishing || !current) return;
    const id = current.id, prepared = prepareContinuation(player, true);
    pausePlayback(); finishing = true;
    const request = ++playbackRequest;
    playbackPending = true; playbackState();
    status('Edit terminé · préparation de la suite du morceau…');
    const valid = () => request === playbackRequest && current?.id === id && frame() === player && enabled;
    try {
      if (!prepared) throw new Error('La durée de l’edit est indisponible.');
      const { exact, position } = await prepared.positionPromise;
      if (!valid()) return;
      // Le préchargement vise trois secondes ; au relais, on peut déjà lire
      // le tampon disponible sans attendre inutilement qu'il soit complet.
      if (!prepared.youtube && !bufferedAt(position, 0.15)) await waitForAudio(() => bufferedAt(position, 0.15), prepared.controller.signal);
      if (!valid()) return;
      if (player instanceof HTMLVideoElement) { audio.volume = player.volume; audio.muted = player.muted; }
      continued = true; finishing = false; wantsPlayback = false;
      prepared.restore = false;
      updateNow(); updatePlaybackTime(); window.dispatchEvent(new Event('edits-audio-change'));
      $('edit-panel').hidden = true;
      message(exact ? `Edit terminé · suite du morceau à ${time(position)}.` : `Edit terminé · reprise approximative à ${time(position)} : passage non reconnu.`);
      if (position >= (prepared.youtube ? window.youtubePlayback.media().duration : audio.duration) - 0.1) { playbackPending = false; playbackState(); next(1, true); }
      else await start();
    } catch (error) {
      if (!valid()) return;
      let text = error.message;
      if (current?.source === 'volumio') {
        try {
          const diagnostic = await window.volumio.checkAudio(id);
          if (diagnostic.status === 'offline') text = `Volumio est injoignable à ${diagnostic.baseUrl}. Vérifie qu’il est allumé et que ton ordinateur est sur le même réseau.`;
          else if (diagnostic.status === 'missing') text = 'Volumio répond, mais ce fichier est introuvable. Actualise la bibliothèque Volumio.';
          else if (diagnostic.status === 'refused') text = `Volumio refuse l’accès au fichier (erreur ${diagnostic.httpStatus}).`;
          else text = 'Le fichier répond sur Volumio, mais le lecteur ne parvient pas à le décoder ou à charger ce passage. Relance le morceau.';
        } catch { /* Conserver l'erreur initiale si le diagnostic est annulé. */ }
      }
      if (valid()) fail(text);
    }
    finally { if (request === playbackRequest) { finishing = false; playbackPending = false; playbackState(); } }
  }
  function recover(player) {
    if (frame() !== player || !enabled || !current || continued || finishing) return;
    if (selected) failedEdits.add(selected.videoId);
    const next = edits.find(edit => !failedEdits.has(edit.videoId));
    if (next && failedEdits.size < 6) { playEdit(next, true); return; }
    if (!searchedAgain && failedEdits.size < 6) { searchedAgain = true; refresh(true, true); return; }
    fail('Les edits trouvés sont momentanément inaccessibles. Réessaie ou désactive le mode Edits pour écouter le morceau.');
  }
  function playEdit(edit, replacing = false) {
    if (replacing) beginWait();
    unload(); selected = edit;
    if (edit.streamAvailable) {
      const player = document.createElement('video'); player.volume = audio.volume; player.loop = false; player.controls = true; player.playsInline = true;
      player.setAttribute('aria-label', `Edit TikTok · ${current.title}`);
      player.src = `nocturne://edit-video/${edit.videoId}`;
      player.addEventListener('volumechange', () => { if (frame() !== player) return; audio.volume = player.volume; $('volume').value = player.volume; localStorage.setItem('volume', player.volume); });
      for (const event of ['loadedmetadata', 'timeupdate', 'seeked', 'play', 'pause', 'ended']) player.addEventListener(event, () => { if (frame() === player) { updatePlaybackTime(); playbackState(); } });
      player.addEventListener('play', () => { if (frame() === player) wantsPlayback = true; });
      player.addEventListener('pause', () => { if (frame() === player && !player.error) wantsPlayback = false; });
      player.addEventListener('canplay', () => { if (frame() !== player || continued || finishing) return; markReady(player); prepareContinuation(player); status(`Son de l’edit · synchronisé avec la vidéo · ${edit.author || 'TikTok'}`); });
      player.addEventListener('ended', () => continueOriginal(player));
      player.addEventListener('seeking', () => { if (frame() === player && finishing) pausePlayback(); });
      player.addEventListener('error', () => recover(player));
      $('edit-player').append(player); $('edit-open').disabled = false; $('edit-another').disabled = edits.length < 2;
      status(failedEdits.size ? `Edit indisponible · essai d’un autre (${failedEdits.size + 1}) · musique en attente…` : 'Chargement de l’edit · musique en attente…');
      loadingTimer = setTimeout(() => { if (frame() === player && !ready) recover(player); }, 20000);
      return;
    }
    const player = document.createElement('iframe'); player.title = `Edit TikTok · ${current.title}`;
    player.setAttribute('allow', 'autoplay; fullscreen; encrypted-media');
    player.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation'); player.referrerPolicy = 'strict-origin-when-cross-origin';
    const params = new URLSearchParams({ autoplay: '0', loop: '0', force_muted: '0', controls: '1', music_info: '1', description: '1' });
    player.src = `https://www.tiktok.com/player/v1/${edit.videoId}?${params}`;
    $('edit-player').append(player); status('Chargement de l’edit sélectionné automatiquement…');
    $('edit-open').disabled = false; $('edit-another').disabled = edits.length < 2;
    updatePlaybackTime();
    loadingTimer = setTimeout(() => recover(player), 20000);
  }
  async function refresh(force = false, recovering = false) {
    if (!recovering) { failedEdits = new Set(); searchedAgain = false; }
    beginWait();
    const request = ++token; unload(); edits = [];
    updateNow(); window.dispatchEvent(new Event('edits-audio-change'));
    await window.edits.cancel();
    if (request !== token) return;
    $('edit-panel').hidden = !enabled; $('edits-switch').setAttribute('aria-checked', String(enabled));
    $('edit-title').textContent = current ? `${current.title} · ${current.artist}` : 'Choisis un morceau';
    if (!enabled) { resolveReady(true); return; }
    if (!current) { resolveReady(false); status('Sélection automatique d’un edit à la lecture du morceau.'); return; }
    const id = current.id; status('Recherche automatique d’edits · musique en attente…');
    try {
      const result = await window.edits.discover(id, force === true, [...failedEdits]);
      if (request !== token || !enabled || current?.id !== id) return;
      if (result.status === 'cancelled') { resolveReady(false); return; }
      if (result.status === 'needs-login') { fail('Connecte-toi une fois à TikTok pour essayer la recherche gratuite.'); $('edit-hint').textContent = 'Aucune API payante ni clé à fournir. La connexion se fait directement dans une fenêtre TikTok, puis reste sur cet ordinateur.'; return; }
      if (result.status === 'blocked') { fail('TikTok ne renvoie pas de résultats exploitables pour cette session.'); $('edit-hint').textContent = 'Ouvre la fenêtre TikTok pour vérifier la connexion ou une éventuelle demande de vérification, puis relance la recherche.'; return; }
      edits = result.videos.filter(edit => !failedEdits.has(edit.videoId));
      if (edits.length) playEdit(edits[0]);
      else { fail(recovering ? 'Les edits trouvés sont momentanément inaccessibles.' : 'Aucun edit avec un son correspondant identifié dans les résultats.'); $('edit-hint').textContent = 'Essaie un autre titre, relance la recherche ou désactive le mode Edits pour écouter la musique seule.'; }
    } catch (error) { if (request === token) fail(error.message); }
  }
  $('edits-switch').onclick = () => { enabled = !enabled; localStorage.setItem('edits-enabled', String(enabled)); refresh(); };
  window.edits.onProgress(value => { if (enabled && current?.id === value.id) status(value.text); });
  audio.addEventListener('emptied', () => { if (!audio.getAttribute('src') && !current) refresh(); });
  window.addEventListener('message', event => {
    if (event.origin !== 'https://www.tiktok.com' || event.source !== frame()?.contentWindow || !event.data || typeof event.data !== 'object' || event.data['x-tiktok-player'] !== true) return;
    const data = event.data;
    if (data.type === 'onPlayerReady') { markReady(frame()); getAlignment(); status(`Son de l’edit · synchronisé avec la vidéo · ${selected?.soundTitle || current?.title}`); }
    if (data.type === 'onStateChange') { if ([0, 1, 2].includes(data.value)) { embedded.paused = data.value !== 1; wantsPlayback = data.value === 1; } playbackState(); if (data.value === 0) continueOriginal(frame()); }
    if (data.type === 'onCurrentTime' && Number.isFinite(data.value?.currentTime) && Number.isFinite(data.value?.duration)) { embedded.currentTime = Math.max(0, data.value.currentTime); embedded.duration = Math.max(0, data.value.duration); prepareContinuation(frame()); updatePlaybackTime(); }
    if (data.type === 'onPlayerError' || data.type === 'onError') { if (data.value?.errorCode === 3002) fail('Clique sur Lecture dans la vidéo pour démarrer.'); else recover(frame()); }
  });
  async function openSettings() {
    $('edit-provider-dialog').showModal();
    try { const settings = await window.edits.provider(); $('edit-provider-status').textContent = settings.configured ? 'Session confirmée. Si TikTok demande une nouvelle connexion, ouvre sa fenêtre.' : 'Connecte-toi directement à TikTok dans sa fenêtre, puis clique sur « Connexion terminée ».'; $('edit-session-disconnect').disabled = !settings.configured; }
    catch (error) { $('edit-provider-status').textContent = error.message; }
  }
  $('edit-add').onclick = $('edit-empty-add').onclick = openSettings;
  $('edit-provider-close').onclick = () => $('edit-provider-dialog').close();
  $('edit-session-connect').onclick = async () => { try { await window.edits.connectSession(); $('edit-provider-status').textContent = 'La fenêtre TikTok est ouverte. Connecte-toi, puis reviens ici.'; } catch (error) { $('edit-provider-status').textContent = error.message; } };
  $('edit-session-confirm').onclick = async () => { try { await window.edits.confirmSession(); $('edit-provider-dialog').close(); if (enabled) refresh(); } catch (error) { $('edit-provider-status').textContent = error.message; } };
  $('edit-session-open').onclick = async () => { try { await window.edits.openSession(); } catch (error) { $('edit-provider-status').textContent = error.message; } };
  $('edit-session-disconnect').onclick = async () => { try { await window.edits.disconnectSession(); $('edit-provider-status').textContent = 'Session TikTok déconnectée sur cet ordinateur.'; $('edit-session-disconnect').disabled = true; if (enabled) refresh(); } catch (error) { $('edit-provider-status').textContent = error.message; } };
  $('edit-another').onclick = () => { const alternatives = edits.filter(edit => edit.videoId !== selected?.videoId && !failedEdits.has(edit.videoId)); if (alternatives.length) playEdit(alternatives[Math.floor(Math.random() * alternatives.length)], true); };
  $('edit-refresh').onclick = () => refresh(true);
  $('edit-browse').onclick = () => { $('edit-panel').hidden = true; };
  $('edit-open').onclick = async () => { if (selected && current) try { await window.edits.openAutomatic(current.id, selected.videoId); } catch (error) { status(error.message); } };
  refresh();
})();
