const fs = require('node:fs/promises');
const path = require('node:path');
const previousWarnings = process.env.ELECTRON_DISABLE_SECURITY_WARNINGS;
const { ElectronBlocker } = require('@ghostery/adblocker-electron');
if (previousWarnings === undefined) delete process.env.ELECTRON_DISABLE_SECURITY_WARNINGS;
else process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = previousWarnings;

function cosmeticOrigin(value) {
  try { return ['https://music.youtube.com', 'https://www.youtube.com'].includes(new URL(value).origin); } catch { return false; }
}
function createYouTubeBlocker({ app, session, allowUpdates = true }) {
  const directory = path.join(app.getPath('userData'), 'youtube-adblock');
  const cache = path.join(directory, `ads-${require('@ghostery/adblocker-electron/package.json').version}.bin`);
  const settings = path.join(directory, 'settings.json');
  const bundled = path.join(__dirname, 'filters/youtube-ads.bin');
  let engine = null, enabled = true, count = 0, initializing = null, updating = null, sequence = Promise.resolve();
  function secure(value) {
    value.updateFromDiff({ added: require('node:fs').readFileSync(path.join(__dirname, 'filters/youtube-specific.txt'), 'utf8').split('\n').filter(line => line && !line.startsWith('!')), removed: [] });
    const inject = value.onInjectCosmeticFilters;
    value.onInjectCosmeticFilters = (event, url, message) => {
      const frameUrl = event.senderFrame?.url || '';
      if (event.sender.session === session && cosmeticOrigin(frameUrl) && cosmeticOrigin(url) && new URL(frameUrl).origin === new URL(url).origin) return inject(event, url, message);
    };
    value.onIsMutationObserverEnabled = async event => event.sender.session === session && cosmeticOrigin(event.senderFrame?.url || '');
    value.on('request-blocked', () => { count++; });
    return value;
  }
  function apply() {
    if (!engine) return;
    if (enabled && !engine.isBlockingEnabled(session)) engine.enableBlockingInSession(session);
    if (!enabled && engine.isBlockingEnabled(session)) engine.disableBlockingInSession(session);
  }
  function status() { return { enabled, ready: Boolean(engine), blocked: count, updating: Boolean(updating) }; }
  async function initialize() {
    if (!initializing) initializing = (async () => {
      try { enabled = JSON.parse(await fs.readFile(settings, 'utf8')).enabled !== false; } catch { /* Actif par défaut. */ }
      let bytes, date;
      try { bytes = await fs.readFile(cache); engine = ElectronBlocker.deserialize(new Uint8Array(bytes)); date = (await fs.stat(cache)).mtimeMs; }
      catch {
        bytes = await fs.readFile(bundled); engine = ElectronBlocker.deserialize(new Uint8Array(bytes));
        date = Date.parse(JSON.parse(await fs.readFile(path.join(__dirname, 'filters/snapshot.json'), 'utf8')).date);
        await fs.mkdir(directory, { recursive: true }); await fs.writeFile(cache, bytes);
      }
      secure(engine); apply();
      if (allowUpdates && Date.now() - date > 86400000) update().catch(() => {});
      return status();
    })();
    return initializing;
  }
  async function update() {
    if (updating) return updating;
    updating = (async () => {
      const fresh = secure(await ElectronBlocker.fromPrebuiltAdsOnly(async url => {
        const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
        if (!response.ok) throw new Error('Les filtres ne peuvent pas être actualisés.');
        return response;
      }));
      const change = sequence.then(async () => {
        if (engine?.isBlockingEnabled(session)) engine.disableBlockingInSession(session);
        engine = fresh; apply();
        await fs.mkdir(directory, { recursive: true }); await fs.writeFile(cache + '.tmp', engine.serialize()); await fs.rename(cache + '.tmp', cache);
        return status();
      });
      sequence = change.catch(() => {}); return change;
    })().finally(() => { updating = null; });
    return updating;
  }
  async function setEnabled(value) {
    await initialize();
    const change = sequence.then(async () => {
      const previous = enabled; enabled = value; apply();
      try { await fs.writeFile(settings + '.tmp', JSON.stringify({ enabled })); await fs.rename(settings + '.tmp', settings); }
      catch (error) { enabled = previous; apply(); throw error; }
      return status();
    });
    sequence = change.catch(() => {}); return change;
  }
  return { initialize, status, setEnabled, update: async () => { await initialize(); return update(); } };
}
module.exports = { createYouTubeBlocker, cosmeticOrigin };
