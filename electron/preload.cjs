const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('appWindow', { onVisibility: callback => { const handler = (_event, visible) => callback(visible === true); ipcRenderer.on('window:visibility', handler); return () => ipcRenderer.removeListener('window:visibility', handler); } });
contextBridge.exposeInMainWorld('youtube', {
  spectrum: active => ipcRenderer.invoke('youtube:spectrum', active),
  layout: (bounds, show) => ipcRenderer.invoke('youtube:layout', bounds, show),
  search: query => ipcRenderer.invoke('youtube:search', query),
  home: () => ipcRenderer.invoke('youtube:home'),
  hold: value => ipcRenderer.invoke('youtube:hold', value),
  blockerStatus: () => ipcRenderer.invoke('youtube:blocker-status'),
  setBlocker: value => ipcRenderer.invoke('youtube:blocker-set', value),
  updateBlocker: () => ipcRenderer.invoke('youtube:blocker-update'),
  command: (action, value, videoId) => ipcRenderer.invoke('youtube:command', action, value, videoId),
  onState: callback => { const handler = (_event, state) => callback(state); ipcRenderer.on('youtube:state', handler); return () => ipcRenderer.removeListener('youtube:state', handler); },
  onStatus: callback => { const handler = (_event, status) => callback(status); ipcRenderer.on('youtube:status', handler); return () => ipcRenderer.removeListener('youtube:status', handler); }
});
contextBridge.exposeInMainWorld('edits', {
  discover: (id, force, excluded = []) => ipcRenderer.invoke('edits:discover', id, Boolean(force), excluded),
  align: (id, videoId, jobId) => ipcRenderer.invoke('edits:align', id, videoId, jobId),
  cancelAlignment: jobId => ipcRenderer.invoke('edits:cancel-alignment', jobId),
  provider: () => ipcRenderer.invoke('edits:provider'),
  connectSession: () => ipcRenderer.invoke('edits:session-connect'),
  confirmSession: () => ipcRenderer.invoke('edits:session-confirm'),
  openSession: () => ipcRenderer.invoke('edits:session-open'),
  disconnectSession: () => ipcRenderer.invoke('edits:session-disconnect'),
  cancel: () => ipcRenderer.invoke('edits:cancel'),
  onProgress: callback => { const handler = (_event, value) => callback(value); ipcRenderer.on('edits:progress', handler); return () => ipcRenderer.removeListener('edits:progress', handler); },
  openAutomatic: (id, videoId) => ipcRenderer.invoke('edits:auto-open', id, videoId),
  get: id => ipcRenderer.invoke('edits:get', id),
  add: (id, url) => ipcRenderer.invoke('edits:add', id, url),
  remove: (id, videoId) => ipcRenderer.invoke('edits:remove', id, videoId),
  search: id => ipcRenderer.invoke('edits:search', id),
  open: (id, videoId) => ipcRenderer.invoke('edits:open', id, videoId)
});
contextBridge.exposeInMainWorld('lyrics', {
  get: (id, duration) => ipcRenderer.invoke('lyrics:get', id, duration),
  import: id => ipcRenderer.invoke('lyrics:import', id)
});
contextBridge.exposeInMainWorld('library', {
  load: () => ipcRenderer.invoke('library:load'),
  import: (folder) => ipcRenderer.invoke('library:import', Boolean(folder)),
  remove: (id) => ipcRenderer.invoke('library:remove', id)
});
contextBridge.exposeInMainWorld('volumio', {
  load: () => ipcRenderer.invoke('volumio:load'),
  checkAudio: id => ipcRenderer.invoke('volumio:check-audio', id),
  connect: address => ipcRenderer.invoke('volumio:connect', address),
  browse: uri => ipcRenderer.invoke('volumio:browse', uri),
  sync: uri => ipcRenderer.invoke('volumio:sync', uri),
  cancel: () => ipcRenderer.invoke('volumio:cancel'),
  onProgress: callback => {
    const handler = (_event, progress) => callback(progress);
    ipcRenderer.on('volumio:progress', handler);
    return () => ipcRenderer.removeListener('volumio:progress', handler);
  }
});
