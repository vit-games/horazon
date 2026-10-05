import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, realpathSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';
import { lastLine } from './server.js';

const run = promisify(execFile);

export type CaptureStatus = { state: 'off' | 'running' | 'stopping' | 'no-permission' } | { state: 'error'; message: string };

/** capture/pd2capture.py, run with the right to read raw network traffic. */
export interface Capture extends EventEmitter<{ change: [] }> {
  status: CaptureStatus;
  /** Start capturing; events are posted to the server on `port`. */
  start(port: number): Promise<void>;
  /** Stop; the capture posts its queued events first (up to 30 s). */
  stop(): Promise<void>;
  /** Ask for the admin password once so capture can run without it from then on. */
  grantPermission(): Promise<boolean>;
}

abstract class BaseCapture extends EventEmitter<{ change: [] }> {
  status: CaptureStatus = { state: 'off' };

  protected set(status: CaptureStatus) {
    this.status = status;
    this.emit('change');
  }
}

/**
 * Linux: run by a private copy of the system Python that carries cap_net_raw (granted
 * once through pkexec), so neither the app nor the system python3 needs root.
 */
export class LinuxCapture extends BaseCapture implements Capture {
  private proc: ChildProcess | null = null;
  private wanted = false;

  constructor(private readonly opts: { script: string; python: string; recordDir: string }) {
    super();
  }

  /** Whether the private Python can open the raw socket (also fails once a Python upgrade broke the copy). */
  async hasPermission() {
    if (!existsSync(this.opts.python)) return false;
    const probe = 'import socket; socket.socket(socket.AF_PACKET, socket.SOCK_DGRAM).close()';
    return run(this.opts.python, ['-c', probe]).then(() => true, () => false);
  }

  /** Copy the system Python and give the copy cap_net_raw; asks for the admin password. */
  async grantPermission() {
    const script = 'install -D -m 0755 "$1" "$2" && setcap cap_net_raw+ep "$2"';
    await run('pkexec', ['/bin/sh', '-c', script, 'sh', systemPython(), this.opts.python]);
    if (this.status.state === 'no-permission') this.set({ state: 'off' });
    return this.hasPermission();
  }

  async start(port: number) {
    this.wanted = true;
    if (this.proc) return;
    if (!(await this.hasPermission())) return this.set({ state: 'no-permission' });
    if (this.proc || !this.wanted) return; // started or stopped meanwhile

    mkdirSync(this.opts.recordDir, { recursive: true });
    const postUrl = `http://127.0.0.1:${port}/api/capture/events`;
    const args = ['-u', this.opts.script, 'live', '--post', postUrl, '--record-dir', this.opts.recordDir];
    const proc = spawn(this.opts.python, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    this.proc = proc;
    this.set({ state: 'running' });

    let lastError = '';
    proc.stdout?.on('data', (d: Buffer) => process.stdout.write(`[capture] ${d}`));
    proc.stderr?.on('data', (d: Buffer) => {
      process.stderr.write(`[capture] ${d}`);
      lastError = lastLine(d) || lastError;
    });
    proc.on('exit', (code, signal) => {
      if (this.proc !== proc) return;
      this.proc = null;
      const stopped = this.status.state === 'stopping' || code === 0;
      this.set(stopped ? { state: 'off' } : { state: 'error', message: lastError || `exited with ${signal ?? `code ${code}`}` });
    });
  }

  /** SIGTERM lets the capture post its queued events first (up to 30 s). */
  stop(): Promise<void> {
    this.wanted = false;
    const proc = this.proc;
    if (!proc) {
      if (this.status.state !== 'off') this.set({ state: 'off' });
      return Promise.resolve();
    }
    this.set({ state: 'stopping' });
    return new Promise((resolve) => {
      const kill = setTimeout(() => proc.kill('SIGKILL'), 35_000);
      proc.once('exit', () => {
        clearTimeout(kill);
        resolve();
      });
      proc.kill('SIGTERM');
    });
  }
}

function systemPython() {
  for (const dir of (process.env.PATH ?? '/usr/bin').split(':')) {
    const candidate = path.join(dir, 'python3');
    if (existsSync(candidate)) return realpathSync(candidate);
  }
  throw new Error('python3 not found');
}

const TASK = 'Horazon Capture';

/**
 * Windows: raw sockets need Administrator, so the capture runs as an elevated scheduled
 * task (windows/capture-task.ps1, registered by the installer). Any user process can
 * start that task but not signal it, so it is told what to do through files: run.json
 * (the server port) and a stop flag in the control folder. It logs to the logs folder.
 */
export class WindowsCapture extends BaseCapture implements Capture {
  private wanted = false;
  private watching = false;

  constructor(private readonly opts: { taskScript: string; controlDir: string; logFile: string }) {
    super();
  }

  hasPermission() {
    return run('schtasks', ['/Query', '/TN', TASK], { windowsHide: true }).then(() => true, () => false);
  }

  /** Register the task again (e.g. removed by hand); shows a UAC prompt. */
  async grantPermission() {
    const args = `-NoProfile -ExecutionPolicy Bypass -File "${this.opts.taskScript}" install`;
    const command = `$p = Start-Process powershell.exe -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList '${args.replace(/'/g, "''")}'; exit $p.ExitCode`;
    await run('powershell.exe', ['-NoProfile', '-Command', command], { windowsHide: true });
    if (this.status.state === 'no-permission') this.set({ state: 'off' });
    return this.hasPermission();
  }

  async start(port: number) {
    this.wanted = true;
    if (this.status.state === 'running') return;
    if (!(await this.hasPermission())) return this.set({ state: 'no-permission' });
    if (!this.wanted) return;

    mkdirSync(this.opts.controlDir, { recursive: true });
    await rm(path.join(this.opts.controlDir, 'stop'), { force: true });
    await writeFile(path.join(this.opts.controlDir, 'run.json'), JSON.stringify({ port }));
    if (!(await this.taskRunning())) {
      try {
        await run('schtasks', ['/Run', '/TN', TASK], { windowsHide: true });
      } catch (err) {
        return this.set({ state: 'error', message: (err as Error).message });
      }
    }
    this.set({ state: 'running' });
    void this.watch();
  }

  async stop() {
    this.wanted = false;
    if (this.status.state !== 'running' && this.status.state !== 'stopping') {
      if (this.status.state !== 'off') this.set({ state: 'off' });
      return;
    }
    this.set({ state: 'stopping' });
    mkdirSync(this.opts.controlDir, { recursive: true });
    await writeFile(path.join(this.opts.controlDir, 'stop'), '');
    for (let waited = 0; waited < 35_000 && (await this.taskRunning()); waited += 1000) await sleep(1000);
    await run('schtasks', ['/End', '/TN', TASK], { windowsHide: true }).catch(() => {});
    this.set({ state: 'off' });
  }

  /** Notice the task ending on its own (an error, or killed). */
  private async watch() {
    if (this.watching) return;
    this.watching = true;
    try {
      while (this.status.state === 'running') {
        await sleep(5000);
        if (this.status.state !== 'running' || (await this.taskRunning())) continue;
        if (this.status.state !== 'running') break;
        const log = await readFile(this.opts.logFile, 'utf8').catch(() => '');
        this.set({ state: 'error', message: lastLine(Buffer.from(log)) || 'the capture task stopped' });
      }
    } finally {
      this.watching = false;
    }
  }

  /** The task's state by name (schtasks prints it translated). */
  private async taskRunning() {
    const command = `(Get-ScheduledTask -TaskName '${TASK}' -ErrorAction SilentlyContinue).State`;
    const { stdout } = await run('powershell.exe', ['-NoProfile', '-Command', command], { windowsHide: true }).catch(() => ({ stdout: '' }));
    return stdout.trim() === 'Running';
  }
}
