// Assembles desktop/build/app, the folder electron-builder packages: the compiled
// desktop, server and web parts in the same layout as the repo, plus a package.json
// with only the runtime dependencies (pinned to the versions installed here).
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'desktop/build/app');
const json = (file) => JSON.parse(readFileSync(path.join(root, file), 'utf8'));

const desktop = json('desktop/package.json');
const server = json('server/package.json');
const installed = (name) => json(`node_modules/${name}/package.json`).version;

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const copy = (from, to = from) => cpSync(path.join(root, from), path.join(out, to), { recursive: true });
copy('desktop/dist');
copy('desktop/assets');
copy('server/dist');
copy('web/dist');
for (const file of ['game-data.json', 'areas.json', 'currency.json']) copy(`web/src/data/${file}`, `server/dist/data/${file}`);

const runtime = { ...server.dependencies, ...desktop.dependencies };
writeFileSync(
  path.join(out, 'package.json'),
  JSON.stringify(
    {
      name: 'horazon',
      productName: desktop.productName,
      version: desktop.version,
      description: desktop.description,
      author: desktop.author,
      homepage: desktop.homepage,
      license: desktop.license,
      type: 'module',
      main: 'desktop/dist/main.js',
      dependencies: Object.fromEntries(Object.keys(runtime).sort().map((name) => [name, installed(name)])),
    },
    null,
    2,
  ),
);
console.log(`staged ${desktop.productName} ${desktop.version} in ${path.relative(root, out)}`);
