import { EventEmitter } from 'node:events';
import { app } from 'electron';
import updaterPkg from 'electron-updater';

const { autoUpdater } = updaterPkg;

export type UpdateStatus =
  | { state: 'unsupported' | 'idle' | 'checking' | 'latest' }
  | { state: 'downloading'; version: string; percent: number }
  | { state: 'ready'; version: string; notes: string | null }
  | { state: 'error'; message: string };

const CHECK_EVERY_MS = 6 * 3600_000;

/**
 * Updates from GitHub Releases (electron-updater): a found update is downloaded in the
 * background and installed when the user restarts from the tray or the in-app banner,
 * or on the next quit. The data folder is never touched by an install.
 */
export class Updater extends EventEmitter<{ change: []; ready: [version: string] }> {
  status: UpdateStatus;
  private timer: NodeJS.Timeout | null = null;

  constructor() {
    super();
    // Packaged builds only (on Linux: the AppImage).
    this.status = { state: app.isPackaged ? 'idle' : 'unsupported' };
    if (!app.isPackaged) return;

    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.logger = { info: () => {}, warn: console.warn, error: () => {}, debug: () => {} };
    autoUpdater.on('checking-for-update', () => this.set({ state: 'checking' }));
    autoUpdater.on('update-not-available', () => this.set({ state: 'latest' }));
    autoUpdater.on('update-available', (info) => this.set({ state: 'downloading', version: info.version, percent: 0 }));
    autoUpdater.on('download-progress', (p) => {
      if (this.status.state === 'downloading') this.set({ ...this.status, percent: Math.round(p.percent) });
    });
    autoUpdater.on('update-downloaded', (info) => {
      const notes = typeof info.releaseNotes === 'string' ? info.releaseNotes : (info.releaseNotes?.map((n) => n.note).join('\n') ?? null);
      this.set({ state: 'ready', version: info.version, notes });
      this.emit('ready', info.version);
    });
    autoUpdater.on('error', (err) => {
      // The newest tag's release is still a draft (being built): nothing to install yet.
      if ((err as { code?: string }).code === 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND') {
        if (this.status.state !== 'ready') this.set({ state: 'latest' });
        return;
      }
      console.warn('update check failed:', err.message);
      // A downloaded update stays installable.
      if (this.status.state !== 'ready') this.set({ state: 'error', message: err.message.split('\n')[0] });
    });
  }

  get supported() {
    return this.status.state !== 'unsupported';
  }

  /** Check now and then every few hours (`enabled` false: stop checking). */
  schedule(enabled: boolean) {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (!enabled || !this.supported) return;
    void this.check();
    this.timer = setInterval(() => void this.check(), CHECK_EVERY_MS);
  }

  async check() {
    if (!this.supported || this.status.state === 'ready' || this.status.state === 'downloading') return;
    await autoUpdater.checkForUpdates().catch(() => {}); // reported through 'error'
  }

  /** Quit and install the downloaded update, then start the new version. Call after shutting down. */
  install() {
    autoUpdater.quitAndInstall(true, true);
  }

  private set(status: UpdateStatus) {
    this.status = status;
    this.emit('change');
  }
}
