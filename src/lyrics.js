// Ce panneau suit le morceau lu, indépendamment de l'album parcouru.
(() => {
  let visible = false, trackId = null, requestId = 0, data = null, index = -2, offset = 0, follow = true, animation = 0;
  const nodes = () => [...$('lyrics-lines').querySelectorAll('.lyric-line')];
  function setButtons() {
    $('lyrics-import').disabled = !current || usesEditAudio() || usesYouTube();
    $('lyrics-earlier').disabled = $('lyrics-later').disabled = !data?.lines?.length;
    $('lyrics-offset').textContent = `Décalage : ${offset.toLocaleString('fr-FR')} s`;
  }
  function draw(value) {
    data = value; index = -2; follow = true; $('lyrics-follow').hidden = true;
    $('lyrics-lines').replaceChildren();
    if (value.lines?.length) {
      $('lyrics-state').textContent = `Synchronisées · ${value.source}`;
      value.lines.forEach(line => {
        const button = element('button', 'lyric-line', line.text);
        button.setAttribute('aria-label', `${time(line.time)} ${line.text || 'Interlude'}`);
        button.onclick = () => { if (Number.isFinite(audio.duration)) { audio.currentTime = Math.max(0, Math.min(audio.duration, line.time + offset)); follow = true; $('lyrics-follow').hidden = true; update(true); } };
        $('lyrics-lines').append(button);
      });
    } else if (value.plain) {
      $('lyrics-state').textContent = `Paroles disponibles sans synchronisation · ${value.source}`;
      $('lyrics-lines').append(element('p', 'lyric-plain', value.plain));
    } else $('lyrics-state').textContent = value.instrumental ? 'Morceau instrumental.' : 'Pas de paroles trouvées pour cette version. Tu peux importer un fichier LRC.';
    setButtons(); update(true);
  }
  async function load() {
    const token = ++requestId;
    data = null; index = -2; trackId = current?.id || null;
    $('lyrics-lines').replaceChildren(); $('lyrics-title').textContent = current?.title || 'Paroles en direct';
    offset = Number(localStorage.getItem(`lyrics-offset:${trackId}`)) || 0; setButtons();
    if (usesEditAudio()) { $('lyrics-state').textContent = 'Mode Edits : le son et les paroles de la vidéo restent synchronisés. Désactive Edits pour afficher les paroles du morceau de ta bibliothèque.'; return; }
    if (usesYouTube()) { $('lyrics-state').textContent = 'Les paroles de ce titre sont accessibles dans le lecteur YouTube Music.'; return; }
    if (!current) { $('lyrics-state').textContent = 'Lance un morceau pour afficher ses paroles.'; return; }
    if (audio.readyState < 1) { $('lyrics-state').textContent = 'Chargement du morceau…'; return; }
    $('lyrics-state').textContent = 'Recherche des paroles…';
    try { const value = await window.lyrics.get(current.id, audio.duration); if (token === requestId && visible && trackId === current?.id) draw(value); }
    catch (error) { if (token === requestId && visible) $('lyrics-state').textContent = error.message; }
  }
  function update(force = false) {
    if (!visible || !data?.lines?.length || current?.id !== trackId) return;
    const next = LRC.active(data.lines, audio.currentTime - offset);
    if (!force && next === index) return;
    index = next;
    const lines = nodes();
    lines.forEach((node, i) => { node.classList.toggle('active', i === index); node.classList.toggle('past', i < index); if (i === index) node.setAttribute('aria-current', 'true'); else node.removeAttribute('aria-current'); });
    if (follow && index >= 0) {
      const container = $('lyrics-lines'), node = lines[index];
      container.scrollTo({ top: node.offsetTop - container.offsetTop - container.clientHeight / 2 + node.offsetHeight / 2, behavior: reducedMotion.matches || force ? 'instant' : 'smooth' });
    }
  }
  function tick() { animation = 0; if (visible) { update(); if (!audio.paused) animation = requestAnimationFrame(tick); } }
  function show(value) {
    visible = value; $('album-detail').hidden = value; $('lyrics-panel').hidden = !value;
    $('show-tracks').setAttribute('aria-pressed', String(!value)); $('show-lyrics').setAttribute('aria-pressed', String(value));
    if (value) { cancelAnimationFrame(animation); if (trackId !== current?.id || !data) load(); else update(true); tick(); }
    else { ++requestId; cancelAnimationFrame(animation); animation = 0; }
  }
  $('show-tracks').onclick = () => show(false); $('show-lyrics').onclick = () => show(true);
  audio.addEventListener('loadstart', () => { ++requestId; data = null; if (visible) load(); });
  audio.addEventListener('loadedmetadata', () => { if (visible) load(); });
  audio.addEventListener('emptied', () => { ++requestId; data = null; if (visible) load(); });
  window.addEventListener('edits-audio-change', () => { ++requestId; data = null; if (visible) load(); });
  audio.addEventListener('play', () => { if (visible && !animation) tick(); });
  for (const event of ['timeupdate', 'seeked', 'pause']) audio.addEventListener(event, () => update(event === 'seeked'));
  function adjust(amount) { offset = Math.round((offset + amount) * 10) / 10; localStorage.setItem(`lyrics-offset:${trackId}`, offset); setButtons(); update(true); }
  $('lyrics-earlier').onclick = () => adjust(-0.5); $('lyrics-later').onclick = () => adjust(0.5);
  for (const event of ['wheel', 'touchstart', 'pointerdown', 'keydown']) $('lyrics-lines').addEventListener(event, () => { if (data?.lines?.length) { follow = false; $('lyrics-follow').hidden = false; } }, { passive: true });
  $('lyrics-follow').onclick = () => { follow = true; $('lyrics-follow').hidden = true; update(true); };
  $('lyrics-import').onclick = async () => {
    if (!current) return;
    const id = current.id, token = ++requestId;
    try { const value = await window.lyrics.import(id); if (value && token === requestId && id === current?.id) draw(value); }
    catch (error) { if (token === requestId) $('lyrics-state').textContent = error.message; }
  };
  setButtons();
})();
