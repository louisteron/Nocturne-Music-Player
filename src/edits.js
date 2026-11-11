(() => {
  let enabled = localStorage.getItem('edits-enabled') === 'true';
  let edits = [], selected = null, token = 0, loadingTimer;
  let ready = false, readyPromise = Promise.resolve(false), resolveReady = () => {}, intent = 0;
  let failedEdits = new Set(), searchedAgain = false, alignmentFailed = false;
  const embedded = { paused: true, currentTime: 0, duration: NaN };
  let wantsPlayback = false;
  let continued = false, finishing = false, alignmentPromise = null;
  let preparation = null, mix = null, mixFrame = 0;
  let upcoming = null, standby = [];
  const masterVolume = () => Math.max(0, Math.min(1, Number($('volume').value)));
  function releaseCandidate(item) {
    for (const media of [item?.video, item?.audio]) if (media) { media.pause(); media.removeAttribute('src'); media.load(); }
  }
  function clearStandby() { standby.forEach(releaseCandidate); standby = []; }
  function releaseUpcoming() {
    const item = upcoming; upcoming = null;
    if (!item) return;
    item.controller.abort();
    releaseCandidate(item); item.backups.forEach(releaseCandidate);
  }
  function warmMedia(media, test, signal, timeout = 20000) {
    return new Promise((resolve, reject) => {
      const events = ['loadedmetadata', 'canplay', 'progress', 'seeked', 'error'];
      const cleanup = () => { clearTimeout(timer); clearInterval(poll); events.forEach(event => media.removeEventListener(event, check)); signal.removeEventListener('abort', check); };
      const check = () => {
        if (signal.aborted || media.error) { cleanup(); reject(new Error('Préchargement indisponible')); }
        else if (test()) { cleanup(); resolve(); }
      };
      const timer = setTimeout(() => { cleanup(); reject(new Error('Préchargement trop lent')); }, timeout);
      const poll = setInterval(check, 100);
      events.forEach(event => media.addEventListener(event, check)); signal.addEventListener('abort', check); check();
    });
  }
  async function prepareCandidate(track, edit, signal) {
    const candidate = { edit }, controller = new AbortController();
    const jobId = crypto.randomUUID();
    const abort = () => { controller.abort(); window.edits.cancelAlignment(jobId).catch(() => {}); };
    signal.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(abort, 30000);
    let accepted = false;
    try {
      signal.throwIfAborted();
      const video = document.createElement('video'); candidate.video = video;
      video.crossOrigin = 'anonymous'; video.preload = 'auto'; video.playsInline = true; video.src = `nocturne://edit-video/${edit.videoId}`;
      const buffered = warmMedia(video, () => bufferedMedia(video, 0), controller.signal);
      // Une vidéo en panne interrompt aussi son analyse ; une analyse refusée
      // passe au candidat suivant sans attendre la fin du tampon vidéo.
      const streamFailure = new Promise((resolve, reject) => { buffered.catch(reject); });
      const alignment = await Promise.race([window.edits.align(track.id, edit.videoId, jobId), streamFailure]);
      if (!alignment.matched || (alignment.syncVerified === false && !(alignment.distance <= 2.5)) || !(Number.isFinite(alignment.positionSeconds) || Number.isFinite(alignment.offsetSeconds))) throw new Error('Passage non reconnu dans cet edit.');
      await buffered; signal.throwIfAborted(); controller.signal.throwIfAborted();
      candidate.alignment = alignment;
      if (track.source !== 'youtube') {
        const original = document.createElement('audio'); candidate.audio = original;
        original.preload = 'auto'; original.src = `nocturne://audio/${track.id}`;
        await warmMedia(original, () => original.readyState >= 1, controller.signal);
        const anchor = alignment.anchorSeconds ?? video.duration, speed = alignment.speed || 1;
        const position = alignment.positionSeconds ?? video.duration + alignment.offsetSeconds;
        const start = alignment.fade ? Math.max(0, alignment.fade.startSeconds - .4) : (alignment.musicEndSeconds ?? video.duration);
        original.currentTime = Math.max(0, Math.min(original.duration, position + (start - anchor) * speed));
        await warmMedia(original, () => bufferedMedia(original, original.currentTime), controller.signal);
      }
      signal.throwIfAborted(); controller.signal.throwIfAborted();
      accepted = true; return candidate;
    } finally {
      clearTimeout(timeout); signal.removeEventListener('abort', abort);
      if (!accepted) { abort(); releaseCandidate(candidate); }
    }
  }
  function prepareUpcoming() {
    if (!enabled || !current || !ready) return;
    const track = upcomingTrack();
    if (!track) { releaseUpcoming(); return; }
    if (upcoming?.id === track.id) return;
    releaseUpcoming();
    const item = { id: track.id, controller: new AbortController(), createdAt: Date.now(), ready: false, backups: [], data: { rejected: [], videos: [], attempted: [], rounds: 0 } };
    upcoming = item;
    let resolveFirst;
    item.promise = new Promise(resolve => { resolveFirst = resolve; });
    const stop = () => resolveFirst();
    item.controller.signal.addEventListener('abort', stop, { once: true });
    const deadline = setTimeout(() => item.controller.abort(), 90000);
    item.work = NocturneEditCandidates.select({
      signal: item.controller.signal,
      discover: (force, excluded) => window.edits.discover(track.id, force, excluded),
      prepare: (edit, signal) => prepareCandidate(track, edit, signal),
      release: releaseCandidate,
      onUpdate: data => { item.data = data; item.edits = data.videos; item.error = data.error; },
      onReady: candidate => {
        if (upcoming !== item || item.controller.signal.aborted) { releaseCandidate(candidate); return; }
        if (!item.ready) { Object.assign(item, candidate); item.ready = true; resolveFirst(); }
        else item.backups.push(candidate);
      }
    }).catch(error => { item.error = error.message; }).finally(() => {
      clearTimeout(deadline); item.controller.signal.removeEventListener('abort', stop); resolveFirst();
    });
  }
  function stopMix() {
    clearTimeout(mixFrame); mixFrame = 0;
    const old = mix; mix = null;
    if (!old) return;
    if (old.item.youtube) window.youtubePlayback.mix({ play: false, rate: 1, volume: masterVolume() }).catch(() => {});
    else { audio.pause(); audio.playbackRate = 1; audio.preservesPitch = true; audio.volume = masterVolume(); }
    window.dispatchEvent(new Event('edits-audio-change'));
  }
  function updateMix(value, gain, rate) {
    rate = Math.max(.5, Math.min(2, rate));
    const volume = value.item.player.muted ? 0 : Math.min(1, masterVolume() * (value.item.fade.normalization || 1) * gain);
    if (value.item.youtube) {
      const now = performance.now();
      if (now - (value.lastSent || 0) < 50) return;
      value.lastSent = now;
      window.youtubePlayback.mix({ volume, rate }).catch(() => { if (mix === value) stopMix(); });
    } else { audio.volume = volume; audio.playbackRate = rate; }
  }
  function watchMix(player) {
    clearTimeout(mixFrame);
    const tick = () => {
      if (frame() !== player || player.paused || continued) return;
      const item = preparation;
      if (item?.ready && item.exact && item.fade && player.currentTime >= item.warmupStart && player.currentTime < player.duration - .05 && !mix && !item.mixFailed) beginMix(item, player);
      if (item?.exact && player.currentTime >= item.musicEnd && item.musicEnd < player.duration - .1) {
        if (!finishMix(player)) continueOriginal(player);
        if (continued) player.pause();
        return;
      }
      if (mix?.started && !mix.completed) {
        let rate=item.speed;
        if(player.currentTime<item.fadeStart){
          const media=item.youtube?window.youtubePlayback.media():audio;
          const clock=item.youtube?media.currentTime+(media.paused?0:Math.max(0,(Date.now()-(media.timestamp||Date.now()))/1000)*(media.rate||item.speed)):media.currentTime;
          const expected=item.position+(player.currentTime-item.anchorSeconds)*item.speed;
          rate+=Math.max(-.25,Math.min(.25,(expected-clock)*3));
        }
        updateMix(mix, NocturneCrossfade.gainAt(item.fade, player.currentTime - item.audioShift), rate);
      }
      mixFrame = setTimeout(tick, 16);
    };
    mixFrame = setTimeout(tick, 16);
  }
  async function beginMix(item, player) {
    const value = { item, started: false }; mix = value;
    const positionAt = () => Math.max(0, item.position + (player.currentTime - item.anchorSeconds) * item.speed);
    try {
      if (item.youtube) {
        await window.youtube.hold(false);
        if (mix !== value || player.paused) return;
        let state = await window.youtubePlayback.mix({ position: positionAt(), volume: 0, rate: item.speed, play: true, issuedAt: Date.now() });
        if (!state || state.cancelled || state.paused) throw new Error('Démarrage du morceau annulé');
        if (state && Math.abs(state.currentTime + (Date.now() - state.timestamp) / 1000 * item.speed - positionAt()) > .06 && mix === value)
          state = await window.youtubePlayback.mix({ position: positionAt(), volume: 0, rate: item.speed, play: true, issuedAt: Date.now() });
        if (state && Math.abs(state.currentTime + (Date.now() - state.timestamp) / 1000 * item.speed - positionAt()) > .08) throw new Error('Synchronisation non stabilisée');
      } else {
        audio.volume = 0; audio.muted = player.muted; audio.playbackRate = item.speed; audio.preservesPitch = false;
        if (Math.abs(audio.currentTime - positionAt()) > .03) audio.currentTime = positionAt();
        await audio.play();
        if (mix === value && Math.abs(audio.currentTime - positionAt()) > .045) {
          audio.currentTime = positionAt();
          await waitForAudio(() => !audio.seeking && audio.readyState >= 3, item.controller.signal, 3000);
        }
      }
      if (mix !== value || item.controller.signal.aborted || frame() !== player || player.paused) { if (mix === value) stopMix(); return; }
      value.started = true;
      status('Transition · le morceau prend progressivement le relais');
    } catch (error) { if (mix === value) { stopMix(); item.mixFailed = true; item.mixError = error.message; status('Fondu indisponible · relais direct préparé : ' + error.message); } }
  }
  function finishMix(player) {
    const value = mix;
    if (!value?.started || value.item.player !== player || (value.item.youtube ? window.youtubePlayback.media().ended : audio.ended)) return false;
    value.completed = true; continued = true; finishing = false; wantsPlayback = false;
    value.item.restore = false;
    clearTimeout(mixFrame);
    const started = performance.now();
    const settle = now => {
      if (mix !== value || current?.id !== value.item.id) return;
      const p = Math.min(1, (now - started) / 800), ease = p * p * (3 - 2 * p);
      updateMix(value, 1, value.item.speed + (1 - value.item.speed) * ease);
      if (p < 1) mixFrame = setTimeout(() => settle(performance.now()), 16);
      else { if (value.item.youtube) window.youtubePlayback.mix({ rate: 1, volume: Math.min(1, masterVolume() * (value.item.fade.normalization || 1)) }).catch(() => {}); else { audio.playbackRate = 1; audio.preservesPitch = true; } }
    };
    mixFrame = setTimeout(() => settle(performance.now()), 16);
    updateNow(); updatePlaybackTime(); playbackState(); window.dispatchEvent(new Event('edits-audio-change'));
    $('edit-panel').hidden = true;
    message('Transition terminée · le morceau continue.');
    return true;
  }
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
  function bufferedMedia(media, position, seconds = 3) {
    if (position >= media.duration - 0.1) return true;
    if (media.seeking || media.readyState < 3) return false;
    const end = Math.min(media.duration - 0.05, position + seconds);
    for (let i = 0; i < media.buffered.length; i++) if (media.buffered.start(i) <= position + 0.05 && media.buffered.end(i) >= end) return true;
    return false;
  }
  function bufferedAt(position, seconds = 3) { return bufferedMedia(audio, position, seconds); }
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
      item.speed = Number.isFinite(result.speed) ? result.speed : 1;
      item.fade = result.fade && result.matched && player instanceof HTMLVideoElement ? result.fade : null;
      item.anchorSeconds = Number.isFinite(result.anchorSeconds) ? result.anchorSeconds : duration;
      item.musicEnd = Number.isFinite(result.musicEndSeconds) ? result.musicEndSeconds : duration;
      item.audioShift = 0;
      item.fadeStart = item.fade ? item.fade.startSeconds + item.audioShift : duration;
      item.warmupStart = Math.max(0,item.fadeStart-.4);
      item.alignmentReason = result.reason;
      item.alignmentMessage = result.message;
      const signal = item.controller.signal;
      if (signal.aborted || preparation !== item || current?.id !== item.id) throw new DOMException('Préparation annulée', 'AbortError');
      if (item.youtube) {
        item.exact = result.matched && (result.syncVerified !== false || result.distance <= 2.5) && (Number.isFinite(result.positionSeconds) || Number.isFinite(result.offsetSeconds));
        item.position = Math.max(0, item.exact ? (result.positionSeconds ?? duration + result.offsetSeconds) : duration);
        item.preloadPosition = Math.max(0, item.position + ((item.fade ? item.warmupStart : item.musicEnd) - item.anchorSeconds) * item.speed);
        await window.youtubePlayback.prepare(item.preloadPosition, signal, item.id);
        return item;
      }
      audio.preload = 'auto';
      await loadOriginal(item);
      item.exact = result.matched && (result.syncVerified !== false || result.distance <= 2.5) && (Number.isFinite(result.positionSeconds) || Number.isFinite(result.offsetSeconds));
      item.position = Math.min(audio.duration, Math.max(0, (item.exact ? (result.positionSeconds ?? duration + result.offsetSeconds) : duration)));
      item.preloadPosition = Math.max(0, item.position + ((item.fade ? item.warmupStart : item.musicEnd) - item.anchorSeconds) * item.speed);
      if (Math.abs(audio.currentTime - item.preloadPosition) > 0.02) audio.currentTime = item.preloadPosition;
      return item;
    })();
    item.promise = item.positionPromise.then(async () => {
      if (!item.youtube) await waitForAudio(() => bufferedAt(item.preloadPosition), item.controller.signal);
      item.ready = true;
      if (frame() === player && !continued && !finishing) status(item.exact ? 'Son de l’edit · suite du morceau prête' : `Son de l’edit · ${item.alignmentMessage || 'passage non reconnu, reprise approximative'}`);
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
    if (frame() !== player || ready || player.dataset.preparing === 'true') return;
    clearTimeout(loadingTimer);
    if (!(player instanceof HTMLVideoElement)) { ready = true; resolveReady(true); prepareUpcoming(); return; }
    player.dataset.preparing = 'true';
    const item = prepareContinuation(player);
    status('Calage audio et préparation de la suite avant lecture…');
    // L'edit préanalysé peut démarrer pendant que le lecteur officiel charge sa suite.
    if (player.dataset.prealigned === 'true' && usesYouTube()) { player.controls = true; ready = true; resolveReady(true); prepareUpcoming(); }
    item?.promise.then(() => {
      if (frame() !== player || preparation !== item || item.controller.signal.aborted) return;
      if (!item.exact) { recover(player, 'alignment'); return; }
      if (!ready) { player.controls = true; ready = true; resolveReady(true); prepareUpcoming(); }
      status(item.exact ? 'Son de l’edit · suite calée et chargée' : 'Son de l’edit · passage non reconnu');
    }).catch(error => {
      if (frame() !== player || item.controller.signal.aborted || error.name === 'AbortError') return;
      if (player.dataset.prealigned === 'true' && !player.paused && !player.ended) status('Edit en lecture · la suite sera réessayée à la fin : ' + error.message);
      else fail('La suite n’a pas pu être préparée. ' + error.message);
    });
  }
  function fail(text) { clearTimeout(loadingTimer); ready = false; resolveReady(false); pausePlayback(); status(`${text} La musique reste en pause.`); }
  window.editPlayback = {
    upcomingState: () => ({ id: upcoming?.id, ready: Boolean(upcoming?.ready), phase: upcoming?.data.status, backupReady: Boolean(upcoming?.backups.length), rejected: upcoming?.data.rejected.length || 0, error: upcoming?.error, videoState: upcoming?.video?.readyState, bufferedUntil: upcoming?.video?.buffered.length ? upcoming.video.buffered.end(upcoming.video.buffered.length - 1) : 0 }),
    transitionState: () => ({ ready, continued, stage: mix ? (mix.completed ? 'complete' : mix.started ? 'playing' : 'starting') : 'idle', error: preparation?.mixError, fadeStart: preparation?.fadeStart, musicEnd: preparation?.musicEnd, anchor: preparation?.anchorSeconds, position: preparation?.position, editTime: frame()?.currentTime }),
    isCrossfading: () => Boolean(mix && !mix.completed),
    usesEditAudio: () => enabled && !continued,
    media: () => frame() instanceof HTMLVideoElement ? frame() : embedded,
    isEmbedded: () => frame() instanceof HTMLIFrameElement,
    seek: seconds => { stopMix(); if (finishing) { pausePlayback(); finishing = false; } const player = frame(); if (player instanceof HTMLVideoElement) player.currentTime = seconds; else if (player) { embedded.currentTime = seconds; send('seekTo', seconds); } },
    setVolume: volume => { const player = frame(); if (player instanceof HTMLVideoElement) { player.volume = volume; player.muted = false; } },
    prepare: () => refresh(),
    cancelPlay: () => { stopMix(); ++intent; wantsPlayback = false; finishing = false; embedded.paused = true; send('pause'); },
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
    stopMix(); audio.volume = masterVolume();
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
    if (finishMix(player)) return;
    const id = current.id, prepared = prepareContinuation(player, true);
    pausePlayback(); finishing = true;
    const request = ++playbackRequest;
    playbackPending = true; playbackState();
    status('Edit terminé · préparation de la suite du morceau…');
    const valid = () => request === playbackRequest && current?.id === id && frame() === player && enabled;
    try {
      if (!prepared) throw new Error('La durée de l’edit est indisponible.');
      const preparedItem = await prepared.positionPromise;
      const exact = preparedItem.exact, position = Math.max(0, preparedItem.position + ((preparedItem.musicEnd ?? preparedItem.duration) - (preparedItem.anchorSeconds ?? preparedItem.duration)) * (preparedItem.speed || 1));
      if (!valid()) return;
      if (prepared.fade) {
        if (prepared.youtube) await window.youtubePlayback.prepare(position, prepared.controller.signal, prepared.id);
        else if (Math.abs(audio.currentTime - position) > .03) audio.currentTime = position;
      }
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
  function recover(player, reason) {
    if (reason === 'alignment') alignmentFailed = true;
    if (frame() !== player || !enabled || !current || continued || finishing) return;
    if (selected) failedEdits.add(selected.videoId);
    const backup = standby.find(candidate => !failedEdits.has(candidate.edit.videoId) && candidate.video.readyState >= 3);
    if (backup) {
      standby = standby.filter(candidate => candidate !== backup);
      beginWait(); unload();
      if (backup.audio) { adoptPreparedAudio(backup.audio); backup.audio = null; }
      playEdit(backup.edit, false, backup);
      return;
    }
    const next = edits.find(edit => !failedEdits.has(edit.videoId));
    if (next && failedEdits.size < 6) { playEdit(next, true); return; }
    if (!searchedAgain && failedEdits.size < 6) { searchedAgain = true; refresh(true, true); return; }
    fail(alignmentFailed ? 'Aucun des edits trouvés n’a pu être calé sur ce morceau. Essaie un autre titre ou désactive le mode Edits.' : 'Les edits trouvés sont momentanément inaccessibles. Réessaie ou désactive le mode Edits pour écouter le morceau.');
  }
  function playEdit(edit, replacing = false, warmed = null) {
    if (replacing) beginWait();
    unload(); selected = edit;
    if (warmed?.alignment) alignmentPromise = Promise.resolve(warmed.alignment);
    if (edit.streamAvailable) {
      getAlignment();
      const player = warmed?.video || document.createElement('video'); player.crossOrigin = 'anonymous'; player.volume = masterVolume(); player.loop = false; player.controls = false; player.playsInline = true;
      player.setAttribute('aria-label', `Edit TikTok · ${current.title}`);
      if (warmed?.alignment) player.dataset.prealigned = 'true';
      if (!warmed?.video) player.src = `nocturne://edit-video/${edit.videoId}`;
      player.addEventListener('volumechange', () => { if (frame() !== player) return; audio.volume = player.volume; $('volume').value = player.volume; localStorage.setItem('volume', player.volume); });
      for (const event of ['loadedmetadata', 'timeupdate', 'seeked', 'play', 'pause', 'ended']) player.addEventListener(event, () => { if (frame() === player) { updatePlaybackTime(); playbackState(); } });
      player.addEventListener('play', () => { if (frame() === player) { wantsPlayback = true; watchMix(player); } });
      player.addEventListener('pause', () => { if (frame() === player && !player.error) { wantsPlayback = false; if (!continued && !player.ended && player.currentTime < player.duration - .05) stopMix(); } });
      player.addEventListener('loadedmetadata', () => { if (frame() === player) prepareContinuation(player); });
      player.addEventListener('canplay', () => { if (frame() !== player || continued || finishing) return; markReady(player); });
      player.addEventListener('playing', () => { if (frame() === player) watchMix(player); });
      player.addEventListener('waiting', () => { if (frame() === player) stopMix(); });
      player.addEventListener('ended', () => continueOriginal(player));
      player.addEventListener('seeking', () => { stopMix(); if (!player.paused) watchMix(player); if (frame() === player && finishing) pausePlayback(); });
      player.addEventListener('error', () => recover(player));
      $('edit-player').append(player); $('edit-open').disabled = false; $('edit-another').disabled = edits.length < 2;
      status(failedEdits.size ? `Edit indisponible · essai d’un autre (${failedEdits.size + 1}) · musique en attente…` : 'Chargement de l’edit · musique en attente…');
      loadingTimer = setTimeout(() => { if (frame() === player && !ready) recover(player); }, 20000);
      if (player.readyState >= 3) markReady(player);
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
    if (!recovering) { failedEdits = new Set(); searchedAgain = false; alignmentFailed = false; clearStandby(); }
    // Conserver une préparation en cours lors du passage au titre attendu.
    const warmed = !force && enabled && upcoming && current && upcoming.id === current.id && Date.now() - upcoming.createdAt < 15 * 60 * 1000 ? upcoming : null;
    if (!warmed) releaseUpcoming();
    beginWait();
    const request = ++token; unload(); edits = [];
    updateNow(); window.dispatchEvent(new Event('edits-audio-change'));
    if (!warmed) await window.edits.cancel();
    if (request !== token) return;
    $('edit-panel').hidden = !enabled; $('edits-switch').setAttribute('aria-checked', String(enabled));
    $('edit-title').textContent = current ? `${current.title} · ${current.artist}` : 'Choisis un morceau';
    if (!enabled) { resolveReady(true); return; }
    if (!current) { resolveReady(false); status('Sélection automatique d’un edit à la lecture du morceau.'); return; }
    const id = current.id; status('Recherche automatique d’edits · musique en attente…');
    try {
      if (warmed) await warmed.promise;
      if (request !== token || !enabled || current?.id !== id) return;
      if (warmed) { warmed.data.rejected.forEach(id => failedEdits.add(id)); searchedAgain = warmed.data.rounds > 1; }
      const result = warmed?.edits ? { status: !warmed.ready && ['needs-login', 'blocked'].includes(warmed.data.status) ? warmed.data.status : 'ready', videos: !warmed.ready && warmed.data.attempted.length ? [] : warmed.edits } : await window.edits.discover(id, force === true, [...failedEdits]);
      if (request !== token || !enabled || current?.id !== id) return;
      if (result.status === 'cancelled') { resolveReady(false); return; }
      if (result.status === 'needs-login') { fail('Connecte-toi une fois à TikTok pour essayer la recherche gratuite.'); $('edit-hint').textContent = 'Aucune API payante ni clé à fournir. La connexion se fait directement dans une fenêtre TikTok, puis reste sur cet ordinateur.'; return; }
      if (result.status === 'blocked') { fail('TikTok ne renvoie pas de résultats exploitables pour cette session.'); $('edit-hint').textContent = 'Ouvre la fenêtre TikTok pour vérifier la connexion ou une éventuelle demande de vérification, puis relance la recherche.'; return; }
      edits = result.videos.filter(edit => !failedEdits.has(edit.videoId));
      if (edits.length) {
        const prepared = warmed?.ready ? warmed : null;
        if (prepared) standby = [...prepared.backups];
        if (upcoming === warmed && warmed) { upcoming = null; warmed.controller.abort(); }
        if (prepared?.audio) { adoptPreparedAudio(prepared.audio); prepared.audio = null; }
        playEdit(prepared?.edit || edits[0], false, prepared);
        if (warmed?.audio) { warmed.audio.removeAttribute('src'); warmed.audio.load(); }
        if (!prepared && warmed?.video) { warmed.video.removeAttribute('src'); warmed.video.load(); }
      }
      else { if (warmed) releaseUpcoming(); fail(warmed?.data.attempted.length ? 'Aucun des edits vérifiés à l’avance ne se cale sur ce morceau.' : recovering ? 'Les edits trouvés sont momentanément inaccessibles.' : 'Aucun edit avec un son correspondant identifié dans les résultats.'); $('edit-hint').textContent = 'Essaie un autre titre, relance la recherche ou désactive le mode Edits pour écouter la musique seule.'; }
    } catch (error) { if (request === token) fail(error.message); }
  }
  $('edits-switch').onclick = () => { enabled = !enabled; localStorage.setItem('edits-enabled', String(enabled)); refresh(); };
  window.edits.onProgress(value => { if (enabled && current?.id === value.id) status(value.text); });
  window.addEventListener('playback-queue-change', prepareUpcoming);
  window.addEventListener('pagehide', () => { releaseUpcoming(); clearStandby(); });
  function bindAudio() { audio.addEventListener('emptied', () => { if (!audio.getAttribute('src') && !current) refresh(); }); }
  bindAudio(); window.addEventListener('audio-element-change', bindAudio);
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
