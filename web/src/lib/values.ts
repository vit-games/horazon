import { createContext, useContext, useEffect, useState } from 'react';
import { useChanges } from './live';

/** Loaded once for the whole app (and each overlay): the user's item tiers. */
export interface ValuesData {
  /** The user's item tiers; null = the built-in default (lib/tiers.ts). */
  tiers: import('./tiers').TierConfig | null;
}

const EMPTY: ValuesData = { tiers: null };
export const ValuesContext = createContext<ValuesData>(EMPTY);
export const useValues = () => useContext(ValuesContext);

export function useValuesLoader(): ValuesData {
  const [data, setData] = useState<ValuesData>(EMPTY);
  const version = useChanges('values');
  useEffect(() => {
    fetch('/api/values')
      .then((r) => (r.ok ? r.json() : EMPTY))
      .then(setData)
      .catch(() => {});
  }, [version]);
  return data;
}

/** An HR amount you entered for a sale (Trade tab). */
export const fmtHr = (n: number) => `${n >= 10 ? Math.round(n) : Number(n.toFixed(2))} HR`;
