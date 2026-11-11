// Sélection anticipée, sans toucher au lecteur en cours.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NocturneEditCandidates = factory();
})(typeof globalThis === 'object' ? globalThis : this, () => {
  async function select({ discover, prepare, release, signal, onReady, onUpdate = () => {}, maxAttempts = 12, maxReady = 2 }) {
    const state = { attempted: [], rejected: [], videos: [], rounds: 0, accepted: 0, status: 'searching' };
    const attempted = new Set(), videos = new Map();
    onUpdate(state);
    try {
      for (let round = 0; round < 2 && attempted.size < maxAttempts; round++) {
        if (signal.aborted) break;
        state.rounds++; onUpdate(state);
        const result = await discover(round > 0, [...attempted]);
        if (signal.aborted) break;
        state.status = result.status;
        for (const edit of result.videos || []) videos.set(edit.videoId, edit);
        state.videos = [...videos.values()]; onUpdate(state);
        if (result.status !== 'ready') break;
        for (const edit of result.videos || []) {
          if (signal.aborted) break;
          if (!edit.streamAvailable || attempted.has(edit.videoId)) continue;
          if (attempted.size >= maxAttempts) break;
          attempted.add(edit.videoId); state.attempted = [...attempted]; onUpdate(state);
          let prepared;
          try { prepared = await prepare(edit, signal); }
          catch (error) { if (!signal.aborted) { state.rejected.push(edit.videoId); state.error = error.message; onUpdate(state); } continue; }
          if (signal.aborted) { release(prepared); break; }
          state.accepted++; onReady(prepared); onUpdate(state);
          if (state.accepted >= maxReady) { state.status = 'ready'; return state; }
        }
        // Les lecteurs intégrés seuls restent traités par le parcours habituel.
        if (!state.attempted.length) break;
      }
      state.status = signal.aborted ? 'cancelled' : state.accepted ? 'ready' : state.status === 'ready' ? 'exhausted' : state.status;
      return state;
    } finally { onUpdate(state); }
  }
  return { select };
});
