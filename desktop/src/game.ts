import { execFile } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** The game's process (under Wine on Linux, named after the executable). */
const GAME_PROCESS = 'Game.exe';

/** Whether Project Diablo 2 is running on this machine. */
export async function isGameRunning() {
  if (process.platform === 'win32') {
    const { stdout } = await run('tasklist', ['/FI', `IMAGENAME eq ${GAME_PROCESS}`, '/FO', 'CSV', '/NH'], { windowsHide: true });
    return stdout.toLowerCase().includes(`"${GAME_PROCESS.toLowerCase()}"`);
  }
  const pids = (await readdir('/proc')).filter((p) => /^\d+$/.test(p));
  for (const pid of pids) {
    const comm = await readFile(`/proc/${pid}/comm`, 'utf8').catch(() => '');
    if (comm.trim() === GAME_PROCESS) return true;
  }
  return false;
}
