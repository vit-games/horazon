import { useEffect, useState } from 'react';

/** Update status from the desktop app (desktop/src/updater.ts). */
export type UpdateStatus =
  | { state: 'unsupported' | 'idle' | 'checking' | 'latest' }
  | { state: 'downloading'; version: string; percent: number }
  | { state: 'ready'; version: string; notes: string | null }
  | { state: 'error'; message: string };

/** Capture and game as the desktop app sees them (desktop/src/main.ts connectionStatus). */
export interface Connection {
  capture: { state: 'off' | 'running' | 'stopping' | 'no-permission' } | { state: 'error'; message: string };
  game: boolean;
  autoCapture: boolean;
  platform: string;
}

/** What the desktop app's preload exposes; absent in a normal browser. */
interface DesktopBridge {
  version: string;
  onUpdate(callback: (status: UpdateStatus) => void): () => void;
  checkForUpdates(): void;
  installUpdate(): void;
  // Missing on desktop builds older than the Game connection card.
  onConnection?(callback: (status: Connection) => void): () => void;
  setCapture?(on: boolean): void;
  grantCapture?(): void;
}

export const desktop = (window as { horazonDesktop?: DesktopBridge }).horazonDesktop ?? null;

/** null in a browser (or an older desktop app): capture runs from the desktop app. */
export function useConnection(): Connection | null {
  const [status, setStatus] = useState<Connection | null>(null);
  useEffect(() => desktop?.onConnection?.(setStatus), []);
  return status;
}

export function useUpdateStatus(): UpdateStatus | null {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  useEffect(() => desktop?.onUpdate(setStatus), []);
  return status;
}
