// Downloads the embeddable Python for Windows into desktop/build/python (bundled with
// the installer; the capture script needs nothing beyond the standard library).
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = '3.13.9';
const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../build/python');
if (!existsSync(path.join(dir, 'pythonw.exe'))) await download();

// The embeddable Python's ._pth file replaces sys.path and leaves out the script's own
// folder, so the capture script could not import items.py next to it. The capture
// folder is next to python/ in the installed resources.
const pth = path.join(dir, readdirSync(dir).find((f) => f.endsWith('._pth')));
if (!readFileSync(pth, 'utf8').includes('../capture')) appendFileSync(pth, '\n../capture\n');

async function download() {
  const url = `https://www.python.org/ftp/python/${VERSION}/python-${VERSION}-embed-amd64.zip`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const zip = path.join(dir, '..', 'python.zip');
  writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
  // bsdtar (Windows 10+ tar.exe, libarchive on Linux) reads zip files. Windows' own by full path:
  // with Git's bash running npm scripts, a plain tar.exe is GNU tar, which reads D:\... as a host.
  const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'bsdtar';
  execFileSync(tar, ['-xf', zip, '-C', dir], { stdio: 'inherit' });
  rmSync(zip);
  console.log(`Python ${VERSION} in ${dir}`);
}
