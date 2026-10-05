// Bridge between the app window (the web UI served by the local server) and the
// desktop app; the web UI checks for `window.horazonDesktop` and works without it.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

contextBridge.exposeInMainWorld('horazonDesktop', {
  version: ipcRenderer.sendSync('app:version') as string,
  /** Calls back with the update status now and on every change; returns an unsubscribe function. */
  onUpdate(callback: (status: unknown) => void) {
    const listener = (_e: IpcRendererEvent, status: unknown) => callback(status);
    ipcRenderer.on('update:status', listener);
    ipcRenderer.send('update:subscribe');
    return () => ipcRenderer.removeListener('update:status', listener);
  },
  checkForUpdates: () => ipcRenderer.send('update:check'),
  installUpdate: () => ipcRenderer.send('update:install'),
  /** Capture, game and log-folder state for Setup's Game connection card, now and on every change. */
  onConnection(callback: (status: unknown) => void) {
    const listener = (_e: IpcRendererEvent, status: unknown) => callback(status);
    ipcRenderer.on('connection:status', listener);
    ipcRenderer.send('connection:subscribe');
    return () => ipcRenderer.removeListener('connection:status', listener);
  },
  setCapture: (on: boolean) => ipcRenderer.send('connection:capture', on),
  grantCapture: () => ipcRenderer.send('connection:grant'),
});
