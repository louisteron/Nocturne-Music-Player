(function(root) {
  function levels(pcm, rate, step = .1) {
    const result = [];
    for (let frame = 0; Math.round(frame * rate * step) < pcm.length / 2; frame++) {
      const start = Math.round(frame * rate * step), end = Math.min(pcm.length / 2, Math.round((frame + 1) * rate * step));
      let sum = 0, length = end - start;
      for (let i = 0; i < length; i++) { const value = pcm.readInt16LE((start + i) * 2) / 32768; sum += value * value; }
      result.push(Math.sqrt(sum / length));
    }
    return result;
  }
  const median = values => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)] || 0; };
  function detectFade(values, duration, step = .1) {
    if (values.length < 15 || !Number.isFinite(duration)) return null;
    const smooth = values.map((_, i) => median(values.slice(Math.max(0, i - 2), Math.min(values.length, i + 3))));
    const baseline = [...smooth.slice(0, Math.ceil(smooth.length * .7))].sort((a, b) => a - b)[Math.floor(smooth.length * .7 * .7)] || 0;
    if (baseline < .001 || median(smooth.slice(-3)) > baseline * .3) return null;
    let start = smooth.length - 1;
    while (start > 0 && smooth[start] < baseline * .93) start--;
    const length = (smooth.length - start) * step;
    if (length < .8 || length > 6) return null;
    const quarter = smooth[Math.min(smooth.length - 1, start + Math.floor((smooth.length - start) * .25))] / baseline;
    const middle = smooth[Math.min(smooth.length - 1, start + Math.floor((smooth.length - start) * .5))] / baseline;
    if (quarter < .3 || middle > .9) return null; // Coupe franche / silence ou simple respiration.
    let falls = 0, changes = 0;
    for (let i = start + 3; i < smooth.length; i += 3) { changes++; if (smooth[i] < smooth[i - 3] * 1.05) falls++; }
    if (!changes || falls / changes < .75) return null;
    const tailStart = duration - values.length * step;
    const points = [{ time: Math.max(0, tailStart + start * step), gain: 1 }];
    let gain = 1;
    for (let i = start + 1; i < smooth.length; i++) {
      gain = Math.min(gain, Math.max(0, smooth[i] / baseline));
      points.push({ time: Math.max(0, tailStart + (i + .5) * step), gain });
    }
    points.push({ time: duration, gain: 0 });
    return { startSeconds: points[0].time, endSeconds: duration, baseline, points };
  }
  function musicBoundary(values, duration, fade, step = .01) {
    const origin = duration - values.length * step;
    let minimum = Infinity, quiet = -1;
    for (let i = Math.max(0, Math.floor((fade.startSeconds - origin) / step)); i < values.length; i++) {
      const value = median(values.slice(Math.max(0, i - 2), i + 3));
      if (value < fade.baseline * .025) { if (quiet < 0) quiet = i; if ((i - quiet) * step >= .2) return Math.min(fade.endSeconds, origin + quiet * step + .08); }
      else quiet = -1;
      if (minimum < fade.baseline * .08 && value > Math.max(fade.baseline * .12, minimum * 3)) {
        const next = values.slice(i, i + Math.ceil(.12 / step));
        if (next.length >= Math.ceil(.1 / step) && median(next) > Math.max(fade.baseline * .12, minimum * 3)) return Math.min(fade.endSeconds, origin + i * step);
      }
      minimum = Math.min(minimum, value);
    }
    return fade.endSeconds;
  }
  function gainAt(fade, time) {
    if (time <= fade.startSeconds) return 0;
    const points = fade.points;
    for (let i = 1; i < points.length; i++) if (time <= points[i].time) {
      const previous = points[i - 1], next = points[i];
      const p = Math.max(0, Math.min(1, (time - previous.time) / Math.max(.001, next.time - previous.time)));
      const envelope = previous.gain + (next.gain - previous.gain) * p;
      return Math.sqrt(Math.max(0, 1 - envelope * envelope));
    }
    return 1;
  }
  const api = { levels, detectFade, gainAt, musicBoundary };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NocturneCrossfade = api;
})(typeof window !== 'undefined' ? window : globalThis);
