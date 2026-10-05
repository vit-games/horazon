import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, renameSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, dialog, ipcMain, Menu, Notification, shell, systemPreferences, Tray, type MenuItemConstructorOptions } from 'electron';
import { LinuxCapture, WindowsCapture, type Capture, type CaptureStatus } from './capture.js';
import { loadConfig, saveConfig } from './config.js';
import { isGameRunning } from './game.js';
import { KillCounterWindow } from './killCounter.js';
import { Server, type ServerStatus } from './server.js';
import { ASSETS, TRAY_FRAME_MS, trayIcon, type IconState } from './trayIcon.js';
import { Updater, type UpdateStatus } from './updater.js';

const APP_NAME = 'Horazon';
app.setName(APP_NAME);
// The kill counter overlay must be placed by the app and stay above the game; Wayland
// allows neither, so the app runs through XWayland. The platform is picked before this
// code runs, so start again with the switch.
const relaunching = process.platform === 'linux' && app.commandLine.getSwitchValue('ozone-platform') !== 'x11';
if (relaunching) {
  // Not app.relaunch(): its helper starts the app with no_new_privs, which breaks pkexec.
  // An AppImage is started again from its file: this process runs from a mount that goes
  // away when it exits.
  spawn(process.env.APPIMAGE ?? process.execPath, [...process.argv.slice(1), '--ozone-platform=x11'], { detached: true, stdio: 'inherit' }).unref();
  app.exit(0);
}

/** This file is desktop/dist/main.js; server/ and web/ are next to desktop/ (in the repo and in the package). */
const DESKTOP_DIST = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(DESKTOP_DIST, '../..');
/** Files run by programs other than Electron (Python, PowerShell) are outside the app archive. */
const RESOURCES = app.isPackaged ? process.resourcesPath : ROOT;
const DATA = app.getPath('userData'); // ~/.config/Horazon, %APPDATA%\Horazon

// A Windows app has no console: keep the app's, server's and capture's output in a file
// (and the previous run's, which is the one that crashed when the app is started again).
// Only in the instance that keeps running, or a second start would move its log away.
const primary = !relaunching && app.requestSingleInstanceLock();
if (primary) {
  mkdirSync(DATA, { recursive: true });
  const logFile = path.join(DATA, 'horazon.log');
  if (existsSync(logFile)) renameSync(logFile, path.join(DATA, 'horazon.old.log'));
  const log = createWriteStream(logFile);
  for (const stream of [process.stdout, process.stderr]) {
    const write = stream.write.bind(stream);
    stream.write = ((...args: Parameters<typeof write>) => (log.write(args[0]), write(...args))) as typeof stream.write;
  }
  app.on('child-process-gone', (_e, d) => console.error(`${d.name ?? d.type} process gone: ${d.reason} (exit code ${d.exitCode})`));
  app.on('render-process-gone', (_e, _w, d) => console.error(`renderer gone: ${d.reason} (exit code ${d.exitCode})`));
}

const config = loadConfig();
const port = Number(process.env.HORAZON_PORT) || config.port;
const appUrl = `http://127.0.0.1:${port}`;

const server = new Server(path.join(ROOT, 'server/dist/index.js'));
const capture: Capture =
  process.platform === 'win32'
    ? new WindowsCapture({
        taskScript: path.join(RESOURCES, app.isPackaged ? 'windows' : 'desktop/windows', 'capture-task.ps1'),
        controlDir: path.join(process.env.ProgramData ?? 'C:\\ProgramData', 'Horazon', 'capture'),
        logFile: path.join(process.env.ProgramData ?? 'C:\\ProgramData', 'Horazon', 'logs', 'capture.log'),
      })
    : new LinuxCapture({
        script: path.join(RESOURCES, 'capture/pd2capture.py'),
        python: path.join(DATA, 'bin/python3-capture'),
        recordDir: path.join(DATA, 'recordings'),
      });
const updater = new Updater();

const killCounter = new KillCounterWindow(config.killCounter, () => saveConfig(config));

let tray: Tray | null = null;
let win: BrowserWindow | null = null;
let gameRunning = false;
let quitting = false;

if (relaunching) {
  // replaced by the relaunched process
} else if (!primary) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.on('window-all-closed', () => {}); // keep running in the tray
  app.on('before-quit', (e) => {
    if (quitting) return;
    e.preventDefault();
    quitting = true;
    refresh();
    // Quit even if shutting down failed: a tray app stuck at "Quitting…" can't be closed at all.
    void shutdown()
      .catch((err) => console.error('[shutdown]', err))
      .finally(() => app.quit());
  });
  void app.whenReady().then(start);
}

async function shutdown() {
  killCounter.close();
  // Capture first, so its last events still reach the server.
  await capture.stop();
  // A downloaded update is installed once this process exits: keep a copy of the data as this version left it.
  if (updater.status.state === 'ready') await backup('update');
  await server.stop();
}

async function installUpdate() {
  if (quitting || updater.status.state !== 'ready') return;
  quitting = true;
  refresh();
  await shutdown();
  updater.install();
}

async function start() {
  Menu.setApplicationMenu(null);
  tray = new Tray(trayIcon('idle'));
  tray.on('click', showWindow);
  server.on('change', onServerChange);
  capture.on('change', refresh);
  updater.on('change', onUpdateChange);
  updater.on('ready', (version) => {
    const n = new Notification({ title: APP_NAME, body: `Version ${version} is ready. Click to restart and install it, or it installs when you quit.` });
    n.on('click', () => void installUpdate());
    n.show();
  });
  ipcMain.on('app:version', (e) => (e.returnValue = app.getVersion()));
  ipcMain.on('update:subscribe', (e) => e.sender.send('update:status', updater.status));
  ipcMain.on('update:check', () => void updater.check());
  ipcMain.on('update:install', () => void installUpdate());
  ipcMain.on('connection:subscribe', (e) => e.sender.send('connection:status', connectionStatus()));
  ipcMain.on('connection:capture', (_e, on: boolean) => void setCapture(on === true).then(refresh));
  ipcMain.on('connection:grant', () => void grantPermission());
  refresh();

  void startServer();
  if (!process.argv.includes('--hidden')) showWindow();
  void watchGame();
  // Not while the app is starting up.
  setTimeout(() => updater.schedule(config.autoUpdate), 15_000);
}

function onUpdateChange() {
  win?.webContents.send('update:status', updater.status);
  refresh();
}

function startServer() {
  return server.start(port, {
    PGLITE_DIR: path.join(DATA, 'db'),
    CACHE_DIR: path.join(DATA, 'cache'),
    BACKUP_DIR: path.join(DATA, 'backups'),
    WEB_DIST: path.join(ROOT, 'web/dist'),
  });
}

function onServerChange() {
  const s = server.status;
  if (config.killCounter.enabled) killCounter.load(s.state === 'running' ? appUrl : null);
  if (s.state === 'running') void win?.loadURL(appUrl);
  if (s.state === 'error') void win?.loadURL(statusPage(`Server error: ${s.message}`));
  refresh();
}

async function watchGame() {
  for (;;) {
    const running = await isGameRunning().catch(() => false);
    if (running !== gameRunning) {
      gameRunning = running;
      if (config.autoCapture) void setCapture(running);
      refresh();
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
}

function setCapture(on: boolean) {
  return on ? capture.start(port) : capture.stop();
}

function showWindow() {
  if (!win) {
    win = new BrowserWindow({
      width: 1400,
      height: 900,
      title: APP_NAME,
      // Linux shows it in the taskbar and window switcher (Windows uses the exe's icon).
      icon: path.join(ASSETS, 'icon.png'),
      backgroundColor: '#0b0b0d',
      autoHideMenuBar: true,
      webPreferences: { preload: path.join(DESKTOP_DIST, 'preload.cjs') },
    });
    win.on('close', (e) => {
      if (quitting) return;
      e.preventDefault();
      win?.hide();
    });
    // Closed while quitting: later status changes (the server stopping) must not reach a destroyed window.
    win.on('closed', () => (win = null));
    win.webContents.setWindowOpenHandler(({ url }) => {
      void shell.openExternal(url);
      return { action: 'deny' };
    });
    if (server.status.state === 'running') void win.loadURL(appUrl);
    else void win.loadURL(statusPage(`Starting ${APP_NAME}…`));
  }
  win.show();
  win.focus();
}

function statusPage(text: string) {
  const body = `<body style="background:#0b0b0d;color:#aaa;font:14px system-ui;display:grid;place-items:center;height:90vh"></body>`;
  const html = body.replace('></body>', `>${text.replace(/[<&]/g, (c) => (c === '<' ? '&lt;' : '&amp;'))}</body>`);
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

async function grantPermission() {
  try {
    if ((await capture.grantPermission()) && (gameRunning || !config.autoCapture)) await setCapture(true);
  } catch (err) {
    void dialog.showMessageBox({ type: 'error', title: 'Capture permission', message: 'Could not grant the capture permission', detail: (err as Error).message });
  }
  refresh();
}

function openBackups() {
  const dir = path.join(DATA, 'backups');
  mkdirSync(dir, { recursive: true });
  void shell.openPath(dir);
}

/** Back up the database through the server; the backup's name, or null when it failed. */
async function backup(kind: 'manual' | 'update') {
  if (server.status.state !== 'running') return null;
  const res = await fetch(`${appUrl}/api/backups?kind=${kind}`, { method: 'POST' }).catch(() => null);
  const body = (await res?.json().catch(() => null)) as { name?: string } | null;
  return body?.name ?? null;
}

async function backupNow() {
  const name = await backup('manual');
  if (name) new Notification({ title: APP_NAME, body: `Backup saved: ${name}` }).show();
  else void dialog.showMessageBox({ type: 'error', title: 'Backup', message: 'The backup failed; see the server log.' });
}

/** While capturing, the tray's portal turns (unless the system asks for less animation). */
let trayTimer: ReturnType<typeof setInterval> | null = null;
let trayFrame = 0;
function showTrayIcon(state: IconState) {
  let animate = state === 'capturing';
  try {
    animate &&= systemPreferences.getAnimationSettings().shouldRenderRichAnimation;
  } catch {
    // not reported on this platform: animate
  }
  if (!animate) {
    if (trayTimer) clearInterval(trayTimer);
    trayTimer = null;
    tray?.setImage(trayIcon(state));
    return;
  }
  if (trayTimer) return; // already turning
  tray?.setImage(trayIcon(state, trayFrame));
  trayTimer = setInterval(() => tray?.setImage(trayIcon('capturing', ++trayFrame)), TRAY_FRAME_MS);
}

function iconState(): IconState {
  if (server.status.state === 'error' || capture.status.state === 'error') return 'error';
  if (capture.status.state === 'running') return 'capturing';
  return gameRunning ? 'game' : 'idle';
}

function serverText(s: ServerStatus) {
  if (s.state === 'running') return `Server: running on :${port}`;
  if (s.state === 'error') return `Server: error – ${s.message}`;
  return `Server: ${s.state}`;
}

function captureText(s: CaptureStatus) {
  if (s.state === 'error') return `Capture: error – ${s.message}`;
  if (s.state === 'no-permission') return 'Capture: needs permission';
  return `Capture: ${{ off: 'off', running: 'recording', stopping: 'stopping…' }[s.state]}`;
}

function updateText(s: UpdateStatus) {
  switch (s.state) {
    case 'checking':
      return 'Checking for updates…';
    case 'latest':
      return `Up to date (${app.getVersion()})`;
    case 'downloading':
      return `Downloading ${s.version}… ${s.percent}%`;
    case 'ready':
      return `Update ${s.version} ready`;
    case 'error':
      return `Update check failed: ${s.message}`;
    default:
      return `Version ${app.getVersion()}`;
  }
}

function updateItems(): MenuItemConstructorOptions[] {
  const s = updater.status;
  if (s.state === 'unsupported') return [];
  return [
    { label: updateText(s), enabled: false },
    s.state === 'ready'
      ? { label: `Restart and install ${s.version}`, enabled: !quitting, click: () => void installUpdate() }
      : { label: 'Check for updates', enabled: s.state !== 'checking' && s.state !== 'downloading', click: () => void updater.check() },
    {
      label: 'Check for updates automatically',
      type: 'checkbox',
      checked: config.autoUpdate,
      click: () => {
        config.autoUpdate = !config.autoUpdate;
        saveConfig(config);
        updater.schedule(config.autoUpdate);
        refresh();
      },
    },
    { type: 'separator' },
  ];
}

/** What the app window's Setup shows about capture (web/src/lib/desktop.ts). */
function connectionStatus() {
  return { capture: capture.status, game: gameRunning, autoCapture: config.autoCapture, platform: process.platform };
}

function refresh() {
  win?.webContents.send('connection:status', connectionStatus());
  if (!tray) return;
  const capturing = capture.status.state === 'running';
  const lines = [serverText(server.status), captureText(capture.status), `Game: ${gameRunning ? 'running' : 'not running'}`];
  const template: MenuItemConstructorOptions[] = [
    ...lines.map((label) => ({ label, enabled: false })),
    { type: 'separator' },
    {
      label: 'Capture',
      type: 'checkbox',
      checked: capturing,
      enabled: !quitting && capture.status.state !== 'stopping',
      click: () => void setCapture(!capturing),
    },
    {
      label: 'Start and stop capture with the game',
      type: 'checkbox',
      checked: config.autoCapture,
      click: () => {
        config.autoCapture = !config.autoCapture;
        saveConfig(config);
        if (config.autoCapture) void setCapture(gameRunning);
        refresh();
      },
    },
    {
      label: 'Map kill counter overlay',
      type: 'checkbox',
      checked: config.killCounter.enabled,
      click: () => {
        config.killCounter.enabled = !config.killCounter.enabled;
        saveConfig(config);
        if (config.killCounter.enabled) killCounter.load(server.status.state === 'running' ? appUrl : null);
        else killCounter.close();
        refresh();
      },
    },
    {
      label: 'Compact kill counter',
      type: 'checkbox',
      checked: config.killCounter.compact,
      enabled: config.killCounter.enabled,
      click: () => {
        config.killCounter.compact = !config.killCounter.compact;
        saveConfig(config);
        killCounter.reload();
        refresh();
      },
    },
    {
      label: killCounter.editing ? 'Lock kill counter position' : 'Move kill counter…',
      enabled: config.killCounter.enabled && server.status.state === 'running',
      click: () => {
        killCounter.setEditing(!killCounter.editing);
        refresh();
      },
    },
    ...(capture.status.state === 'no-permission'
      ? [{ label: 'Grant capture permission…', click: () => void grantPermission() }]
      : []),
    { type: 'separator' },
    ...updateItems(),
    { label: `Open ${APP_NAME}`, click: showWindow },
    { label: 'Open in browser', enabled: server.status.state === 'running', click: () => void shell.openExternal(appUrl) },
    { label: 'Back up now', enabled: server.status.state === 'running', click: () => void backupNow() },
    { label: 'Open backups folder', click: openBackups },
    { label: 'Open data folder', click: () => void shell.openPath(DATA) },
    { label: 'Restart server', click: () => void server.stop().then(startServer) },
    { type: 'separator' },
    { label: quitting ? 'Quitting…' : 'Quit', enabled: !quitting, click: () => app.quit() },
  ];
  showTrayIcon(iconState());
  tray.setToolTip(`${APP_NAME}\n${lines.join('\n')}`);
  tray.setContextMenu(Menu.buildFromTemplate(template));
}
