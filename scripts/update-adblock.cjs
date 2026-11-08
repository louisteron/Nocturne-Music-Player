const fs = require('node:fs/promises');
const path = require('node:path');
const { FiltersEngine } = require('@ghostery/adblocker-electron');
(async () => {
  const directory = path.resolve('electron/filters');
  await fs.mkdir(path.join(directory, 'sources'), { recursive: true });
  const engine = await FiltersEngine.fromPrebuiltAdsOnly(async url => {
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Liste de filtres : HTTP ${response.status}`);
    const text = await response.text();
    const relative = new URL(url).pathname.split('/assets/')[1];
    if (!relative || relative.includes('..')) throw new Error('Source de filtres inattendue.');
    const file = path.join(directory, 'sources', relative); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, text);
    return new Response(text);
  });
  await fs.writeFile(path.join(directory, 'youtube-ads.bin'), engine.serialize());
  await fs.writeFile(path.join(directory, 'snapshot.json'), JSON.stringify({ date: new Date().toISOString(), engine: require('@ghostery/adblocker-electron/package.json').version, source: 'https://github.com/ghostery/adblocker/tree/master/packages/adblocker/assets', preset: 'ads-only' }, null, 2));
  console.log('Filtres publicitaires et leurs sources intégrés.');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
