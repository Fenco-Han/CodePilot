// eslint-disable-next-line @typescript-eslint/no-require-imports
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  versions: {
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
  },
  shell: {
    openPath: (folderPath: string) => ipcRenderer.invoke('shell:open-path', folderPath),
  },
  dialog: {
    openFolder: (options?: { defaultPath?: string; title?: string }) =>
      ipcRenderer.invoke('dialog:open-folder', options),
  },
  install: {
    checkPrerequisites: () => ipcRenderer.invoke('install:check-prerequisites'),
    start: (options?: { includeNode?: boolean }) => ipcRenderer.invoke('install:start', options),
    cancel: () => ipcRenderer.invoke('install:cancel'),
    getLogs: () => ipcRenderer.invoke('install:get-logs'),
    onProgress: (callback: (data: unknown) => void) => {
      const listener = (_event: unknown, data: unknown) => callback(data);
      ipcRenderer.on('install:progress', listener);
      return () => { ipcRenderer.removeListener('install:progress', listener); };
    },
  },
  bridge: {
    isActive: () => ipcRenderer.invoke('bridge:is-active'),
  },
  // Native auto-updater bridge — disabled (code signature issues on macOS).
  // Users are directed to download from GitHub Releases.
  // TODO: Re-enable after obtaining Apple Developer certificate.
  // updater: {
  //   checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  //   downloadUpdate: () => ipcRenderer.invoke('updater:download'),
  //   quitAndInstall: () => ipcRenderer.invoke('updater:quit-and-install'),
  //   onStatus: (callback: (data: unknown) => void) => {
  //     const listener = (_event: unknown, data: unknown) => callback(data);
  //     ipcRenderer.on('updater:status', listener);
  //     return () => { ipcRenderer.removeListener('updater:status', listener); };
  //   },
  // },
});
