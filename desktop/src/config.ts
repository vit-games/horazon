import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

export interface Config {
  port: number;
  /** Start capture when the game starts and stop it when the game exits. */
  autoCapture: boolean;
  /** Look for updates at startup and every few hours. */
  autoUpdate: boolean;
  /** Map kill counter overlay; `position` once it has been moved; `compact`: the broadcast version; `scale`: its size. */
  killCounter: { enabled: boolean; compact: boolean; scale: number; position: { x: number; y: number } | null };
}

const DEFAULTS: Config = { port: 8080, autoCapture: true, autoUpdate: true, killCounter: { enabled: true, compact: false, scale: 1, position: null } };

const file = () => path.join(app.getPath('userData'), 'config.json');

export function loadConfig(): Config {
  let stored: Partial<Config> = {};
  try {
    stored = JSON.parse(readFileSync(file(), 'utf8'));
  } catch {
    // first start
  }
  return { ...DEFAULTS, ...stored, killCounter: { ...DEFAULTS.killCounter, ...stored.killCounter } };
}

export function saveConfig(config: Config) {
  writeFileSync(file(), JSON.stringify(config, null, 2));
}
