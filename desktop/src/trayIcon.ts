import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nativeImage } from 'electron';

export type IconState = 'idle' | 'game' | 'capturing' | 'error';

/** desktop/assets: the app icon (window) and the tray icon (assets/*.svg are the sources). */
export const ASSETS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../assets');

/**
 * The tray icon is the app's portal (web/src/components/Portal.tsx), drawn here pixel by pixel
 * because the tray can't render SVG on every platform. Same geometry and colours:
 *   capturing  lit, its swirls turning (the frames below)   error  red, cracked
 *   idle       dim and still                                 game   dim with an amber ring: the
 *                                                                   game runs but nothing records
 */
type Rgb = [number, number, number];
interface Look {
  ring: Rgb;
  glow: Rgb | null;
  core: Rgb;
  mid: Rgb;
  deep: Rgb;
  crack?: boolean;
}
const hex = (h: number): Rgb => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
const LOOKS: Record<IconState, Look> = {
  capturing: { ring: hex(0x9dbcff), glow: hex(0x5b82ff), core: hex(0xd6e3ff), mid: hex(0x5b82ff), deep: hex(0x1d2f8a) },
  error: { ring: hex(0xef5d5d), glow: hex(0xa3262a), core: hex(0xffb3a8), mid: hex(0xa3262a), deep: hex(0x3a0c12), crack: true },
  // Idle is a touch brighter than in the app, so it still reads on a dark taskbar.
  idle: { ring: hex(0x6b75a8), glow: null, core: hex(0x5a6390), mid: hex(0x2a3260), deep: hex(0x141832) },
  game: { ring: hex(0xf0b13c), glow: null, core: hex(0x5a6390), mid: hex(0x2a3260), deep: hex(0x141832) },
};

const SIZE = 64; // shown as a 32-pixel icon at scale factor 2
const SCALE = 1.12; // portal units (a 40×52 viewBox, as in the app) to pixels
const SS = 3; // supersamples per axis, for antialiasing

/** Frames in one turn of the swirls, and how long each shows: a 9 s loop, as in the app. */
export const TRAY_FRAMES = 24;
export const TRAY_FRAME_MS = 375;

const CRACK: [number, number][] = [[21, 5], [18, 14], [23, 19], [19, 27], [23, 33], [20, 42]];

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
/** Normalised ellipse radius: 1 on the ellipse. */
const ell = (x: number, y: number, cx: number, cy: number, rx: number, ry: number) => Math.hypot((x - cx) / rx, (y - cy) / ry);
/** Coverage of a stroke of width w around an ellipse (distance approximated in portal units). */
const ellStroke = (x: number, y: number, rx: number, ry: number, w: number) => {
  const e = ell(x, y, 20, 26, rx, ry);
  return Math.abs(e - 1) * Math.min(rx, ry) < w / 2;
};
function segDist(px: number, py: number, [ax, ay]: [number, number], [bx, by]: [number, number]) {
  const t = clamp01(((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2));
  return Math.hypot(px - ax - t * (bx - ax), py - ay - t * (by - ay));
}
/** A dashed circle stroke (SVG dash pattern, starting at 3 o'clock, clockwise), rotated by `turn` (0-1). */
function dashed(x: number, y: number, cx: number, cy: number, r: number, w: number, dash: number[], turn: number) {
  const d = Math.hypot(x - cx, y - cy);
  if (Math.abs(d - r) > w / 2) return false;
  const circ = 2 * Math.PI * r;
  let along = (((Math.atan2(y - cy, x - cx) / (2 * Math.PI) - turn) % 1) + 1) % 1 * circ;
  const period = dash.reduce((a, b) => a + b, 0);
  along %= period;
  for (let i = 0; i < dash.length; i++) {
    if (along < dash[i]) return i % 2 === 0;
    along -= dash[i];
  }
  return false;
}
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** One sample: colour and alpha (straight, not premultiplied) of the portal at portal coordinates. */
function sample(x: number, y: number, look: Look, frame: number): [Rgb, number] {
  let rgb: Rgb = [0, 0, 0];
  let a = 0;
  const over = (c: Rgb, alpha: number) => {
    if (alpha <= 0) return;
    const out = alpha + a * (1 - alpha);
    rgb = mix(rgb, c, alpha / out);
    a = out;
  };
  const phase = frame / TRAY_FRAMES;

  // Halo: a soft ring of glow light around the portal (lit and error only).
  if (look.glow) {
    const d = Math.abs(ell(x, y, 20, 26, 16, 22) - 1) * 17;
    over(look.glow, 0.55 * Math.exp(-((d / 2.6) ** 2)));
  }
  // Dark rim under the ring, so the icon stands off light taskbars too.
  if (ellStroke(x, y, 15, 21, 4)) over([5, 6, 13], 0.85);
  // Core: radial gradient from a point just below the centre; it breathes while lit.
  const inCore = ell(x, y, 20, 26, 14, 20) <= 1;
  if (inCore) {
    const t = clamp01(ell(x, y, 20, 28.6, 15.4, 22));
    const c = t < 0.45 ? mix(look.core, look.mid, t / 0.45) : mix(look.mid, look.deep, (t - 0.45) / 0.55);
    const breathe = look === LOOKS.capturing ? 0.875 + 0.125 * Math.cos(phase * 3 * 2 * Math.PI) : 1;
    over(c, breathe);
    // Swirls, clipped to the core: the outer one turns clockwise, the inner one back.
    const turning = look === LOOKS.capturing ? phase : 0;
    if (dashed(x, y, 20, 27, 11, 2.2, [14, 9, 5, 12], turning)) over(look.core, 0.8);
    if (dashed(x, y, 20, 25, 6.5, 1.8, [8, 6, 3, 8], -turning)) over(look.core, 0.9);
  }
  if (ellStroke(x, y, 15, 21, 2.4)) over(look.ring, 1);
  if (look.crack && CRACK.slice(1).some((p, i) => segDist(x, y, CRACK[i], p) < 1.2)) over([11, 13, 26], 1);
  return [rgb, a];
}

const cache = new Map<string, Electron.NativeImage>();

/** The tray icon for a state; `frame` (0 to TRAY_FRAMES-1) turns the swirls while capturing. */
export function trayIcon(state: IconState, frame = 0) {
  const key = `${state}:${state === 'capturing' ? frame % TRAY_FRAMES : 0}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const look = LOOKS[state];
  const buf = Buffer.alloc(SIZE * SIZE * 4); // BGRA, premultiplied
  for (let py = 0; py < SIZE; py++) {
    for (let px = 0; px < SIZE; px++) {
      let r = 0, g = 0, b = 0, alpha = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) / SS - SIZE / 2) / SCALE + 20;
          const y = (py + (sy + 0.5) / SS - SIZE / 2) / SCALE + 26;
          const [c, a] = sample(x, y, look, frame % TRAY_FRAMES);
          r += c[0] * a;
          g += c[1] * a;
          b += c[2] * a;
          alpha += a;
        }
      }
      const n = SS * SS;
      const i = (py * SIZE + px) * 4;
      buf[i] = Math.round(b / n);
      buf[i + 1] = Math.round(g / n);
      buf[i + 2] = Math.round(r / n);
      buf[i + 3] = Math.round((alpha / n) * 255);
    }
  }
  const img = nativeImage.createFromBitmap(buf, { width: SIZE, height: SIZE, scaleFactor: 2 });
  cache.set(key, img);
  return img;
}
