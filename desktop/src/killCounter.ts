import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { app, BrowserWindow, screen } from 'electron';
import type { Config } from './config.js';
import { ASSETS } from './trayIcon.js';

/** Window sizes at scale 1: the pilot slab, and compact (the broadcast slab, 640px + padding, as viewers see it). */
const FULL = { width: 380, height: 500 };
const COMPACT = { width: 680, height: 210 };
/** The page clamps `scale` to the same range (web/src/lib/overlay.ts). */
const MIN_SCALE = 0.5;
const MAX_SCALE = 3;

/**
 * The map kill counter (/killcounter) as a transparent, click-through window above the
 * game. The page titles itself "active" while there is a run to show; the window is
 * hidden otherwise. In move mode it shows sample data and can be dragged, and resized to
 * scale it.
 */
export class KillCounterWindow {
  private win: BrowserWindow | null = null;
  private url: string | null = null;
  editing = false;

  constructor(
    private readonly settings: Config['killCounter'],
    private readonly save: () => void,
  ) {}

  private get base() {
    return this.settings.compact ? COMPACT : FULL;
  }

  /** Show it for the server at `appUrl` (null: server not running). */
  load(appUrl: string | null) {
    this.url = appUrl;
    if (!appUrl) return this.win?.hide();
    const q = new URLSearchParams({
      ...(this.editing ? { edit: '1' } : {}),
      ...(this.settings.compact ? { view: 'broadcast' } : {}),
      ...(this.settings.scale !== 1 ? { scale: String(this.settings.scale) } : {}),
    }).toString();
    void this.window().loadURL(`${appUrl}/killcounter${q ? `?${q}` : ''}`);
  }

  /** Move mode: a normal, draggable window with sample data (the overlay itself can't be grabbed). */
  setEditing(editing: boolean) {
    this.editing = editing;
    this.reload();
  }

  /** Rebuild the window, e.g. after switching between the full and compact versions (they differ in size). */
  reload() {
    if (!this.url) return;
    this.close();
    this.load(this.url);
    if (this.editing) this.window().show();
  }

  close() {
    this.win?.destroy();
    this.win = null;
  }

  private window() {
    if (this.win) return this.win;
    const { base } = this;
    const width = Math.round(base.width * this.settings.scale);
    const height = Math.round(base.height * this.settings.scale);
    const area = screen.getPrimaryDisplay().workArea;
    const pos = this.settings.position ?? { x: area.x + area.width - width - 24, y: area.y + 120 };
    // Not `focusable: false`: KWin then ignores the window's hints (title, keep above).
    // A notification window sits in KWin's highest layer and never takes focus.
    const win = new BrowserWindow({
      ...pos,
      width,
      height,
      title: `${app.getName()} kill counter`,
      icon: path.join(ASSETS, 'icon.png'),
      // Move mode is opaque: transparent windows can't be resized on every platform.
      ...(this.editing ? { backgroundColor: '#0b0a1a' } : { type: 'notification', transparent: true }),
      frame: false,
      resizable: this.editing,
      minWidth: Math.round(base.width * MIN_SCALE),
      minHeight: Math.round(base.height * MIN_SCALE),
      maxWidth: base.width * MAX_SCALE,
      maxHeight: base.height * MAX_SCALE,
      skipTaskbar: true,
      hasShadow: false,
      show: false,
      webPreferences: { backgroundThrottling: false },
    });
    if (this.editing) win.setAspectRatio(base.width / base.height);
    else {
      win.setIgnoreMouseEvents(true);
      aboveFullscreen(win);
    }
    // X11 window managers ignore these hints until the window is mapped.
    win.on('show', () =>
      setTimeout(() => {
        if (win.isDestroyed()) return;
        win.setAlwaysOnTop(true, 'screen-saver');
        win.setSkipTaskbar(true);
        win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      }, 300),
    );
    win.on('page-title-updated', (e, title) => {
      e.preventDefault();
      if (this.editing || title === 'active') {
        if (!win.isVisible()) win.showInactive();
      } else {
        win.hide();
      }
    });
    // 'moved' is macOS/Windows only; 'move' fires continuously while dragging.
    let saveTimer: NodeJS.Timeout | undefined;
    win.on('move', () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        if (win.isDestroyed()) return;
        const [x, y] = win.getPosition();
        this.settings.position = { x, y };
        this.save();
      }, 500);
    });
    // Resizing scales the page: once the drag settles, reload it at the new scale.
    let resizeTimer: NodeJS.Timeout | undefined;
    win.on('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (win.isDestroyed()) return;
        const scale = Math.round((win.getSize()[0] / base.width) * 100) / 100;
        if (scale === this.settings.scale) return;
        this.settings.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
        this.save();
        this.load(this.url);
      }, 300);
    });
    this.win = win;
    return win;
  }
}

/**
 * KWin keeps the active fullscreen window (the game) above notification windows; a
 * critical notification goes above it and keeps its position (an on-screen display
 * would rank higher, but KWin places those itself). Electron can't ask for that type,
 * so it is set on the X11 window before it is first shown.
 */
function aboveFullscreen(win: BrowserWindow) {
  if (process.platform !== 'linux') return;
  const xid = win.getNativeWindowHandle().readUInt32LE(0);
  try {
    execFileSync('xprop', ['-id', String(xid), '-f', '_NET_WM_WINDOW_TYPE', '32a', '-set', '_NET_WM_WINDOW_TYPE', '_KDE_NET_WM_WINDOW_TYPE_CRITICAL_NOTIFICATION']);
  } catch (err) {
    console.warn('kill counter: could not place it above fullscreen windows (xprop missing?):', (err as Error).message);
  }
}
