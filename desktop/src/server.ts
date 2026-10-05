import { EventEmitter } from 'node:events';
import net from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import { utilityProcess, type UtilityProcess } from 'electron';

export type ServerStatus = { state: 'stopped' | 'starting' | 'running' } | { state: 'error'; message: string };

/** The Fastify server (server/dist/index.js) in an Electron utility process. */
export class Server extends EventEmitter<{ change: [] }> {
  status: ServerStatus = { state: 'stopped' };
  private proc: UtilityProcess | null = null;
  private stopping = false;

  constructor(private readonly entry: string) {
    super();
  }

  async start(port: number, env: Record<string, string>) {
    if (this.proc) return;
    if (!(await portFree(port))) return this.set({ state: 'error', message: `port ${port} is in use` });

    this.stopping = false;
    this.set({ state: 'starting' });
    const childEnv = { ...process.env, ...env, PORT: String(port), HOST: '127.0.0.1' } as Record<string, string>;
    const proc = utilityProcess.fork(this.entry, [], { env: childEnv, stdio: 'pipe', serviceName: 'Horazon server' });
    this.proc = proc;

    let lastError = '';
    proc.stdout?.on('data', (d: Buffer) => process.stdout.write(`[server] ${d}`));
    proc.stderr?.on('data', (d: Buffer) => {
      process.stderr.write(`[server] ${d}`);
      lastError = lastLine(d) || lastError;
    });
    proc.on('exit', (code) => {
      if (this.proc === proc) this.proc = null;
      this.set(this.stopping ? { state: 'stopped' } : { state: 'error', message: lastError || `exited with code ${code}` });
    });

    // Running once the API answers (migrations run before it listens).
    while (this.proc === proc) {
      const ok = await fetch(`http://127.0.0.1:${port}/api/capture/status`).then((r) => r.ok, () => false);
      if (ok && this.proc === proc) return this.set({ state: 'running' });
      await sleep(300);
    }
  }

  stop(): Promise<void> {
    const proc = this.proc;
    if (!proc) return Promise.resolve();
    this.stopping = true;
    return new Promise((resolve) => {
      proc.once('exit', () => resolve());
      proc.kill(); // SIGTERM: the server closes the database and exits
    });
  }

  private set(status: ServerStatus) {
    this.status = status;
    this.emit('change');
  }
}

function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
  });
}

export function lastLine(d: Buffer) {
  return d.toString().trim().split('\n').pop()?.trim() ?? '';
}
