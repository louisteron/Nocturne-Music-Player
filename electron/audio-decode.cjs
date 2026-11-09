// Décodage local dans le moteur Chromium déjà livré avec Electron.
// Aucun micro, module distant ou envoi du contenu audio.
async function decodeTail(base64, options = {}) {
  const bytes = Uint8Array.from(atob(base64), value => value.charCodeAt(0));
  const context = new OfflineAudioContext(1, 1, 11025);
  const audio = await context.decodeAudioData(bytes.buffer);
  if (options.levelsOnly) {
    const rms = [];
    const channels = Array.from({ length: audio.numberOfChannels }, (_, i) => audio.getChannelData(i));
    for (let frame = 0; Math.round(frame * audio.sampleRate * .01) < audio.length; frame++) {
      const start = Math.round(frame * audio.sampleRate * .01), end = Math.min(audio.length, Math.round((frame + 1) * audio.sampleRate * .01));
      const length = end - start; let sum = 0;
      for (let i = 0; i < length; i++) { let value = 0; for (const channel of channels) value += channel[start + i] / channels.length; sum += value * value; }
      rms.push(Math.sqrt(sum / length));
    }
    return { rms, step: .01, duration: audio.duration };
  }
  const length = Math.min(audio.length, 15 * audio.sampleRate);
  const start = audio.length - length, pcm = new Uint8Array(length * 2);
  const view = new DataView(pcm.buffer);
  const channels = Array.from({ length: audio.numberOfChannels }, (_, i) => audio.getChannelData(i));
  for (let i = 0; i < length; i++) {
    let value = 0;
    for (const channel of channels) value += channel[start + i] / channels.length;
    view.setInt16(i * 2, Math.round(Math.max(-1, Math.min(1, value)) * 32767), true);
  }
  let binary = '';
  for (let i = 0; i < pcm.length; i += 8192) binary += String.fromCharCode(...pcm.subarray(i, i + 8192));
  return { pcm: btoa(binary), rate: audio.sampleRate, duration: audio.duration };
}
function createTailDecoder(getWindow) {
  return async (file, signal, options = {}) => {
    signal?.throwIfAborted();
    const data = await require('node:fs/promises').readFile(file);
    const window = getWindow();
    if (!window || window.isDestroyed()) throw new Error('Lecteur fermé pendant l’analyse.');
    const result = await window.webContents.executeJavaScript(`(${decodeTail.toString()})(${JSON.stringify(data.toString('base64'))}, ${JSON.stringify(options)})`);
    signal?.throwIfAborted();
    return options.levelsOnly ? result : { ...result, pcm: Buffer.from(result.pcm, 'base64') };
  };
}
function wav(pcm, rate) {
  const header = Buffer.alloc(44);
  header.write('RIFF'); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
module.exports = { createTailDecoder, decodeTail, wav };
