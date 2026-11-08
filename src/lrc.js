(function (root) {
  function parse(text) {
    if (typeof text !== 'string') return [];
    const offset = Number(text.match(/\[offset:([+-]?\d+)\]/i)?.[1] || 0) / 1000;
    const lines = [];
    for (const line of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
      const tags = [...line.matchAll(/\[(\d+):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
      const words = line.replace(/\[[^\]]*\]/g, '').replace(/<\d+:\d+(?:\.\d+)?>/g, '').trim();
      for (const tag of tags) {
        if (Number(tag[2]) >= 60) continue;
        lines.push({ time: Math.max(0, Number(tag[1]) * 60 + Number(tag[2]) + (tag[3] ? Number(`0.${tag[3]}`) : 0) - offset), text: words });
      }
    }
    return lines.sort((a, b) => a.time - b.time);
  }
  function active(lines, seconds) {
    let low = 0, high = lines.length - 1, found = -1;
    while (low <= high) { const mid = (low + high) >> 1; if (lines[mid].time <= seconds) { found = mid; low = mid + 1; } else high = mid - 1; }
    return found;
  }
  if (typeof module !== 'undefined') module.exports = { parse, active };
  else root.LRC = { parse, active };
})(globalThis);
