import type { ReactNode } from 'react';
import type { Listing, ManualSale, Range } from '../lib/api';
import { Ledger } from './Ledger';
import { fmtHr } from '../lib/values';

const DAY = 24 * 3600e3;

/**
 * HR earned in the selected range: items sold on the trade site and manual sales, at the
 * prices you entered.
 */
export function Earnings({
  listings,
  manualSales,
  range,
  extra = [],
}: {
  listings: Listing[];
  manualSales: ManualSale[];
  range: Range;
  /** More figures for the same line (what's on the trade site...). */
  extra?: { value: ReactNode; label: string; title?: string }[];
}) {
  const since = range.since?.getTime() ?? null;
  const until = range.until?.getTime() ?? Date.now();
  const inRange = (t: string) => {
    const ms = new Date(t).getTime();
    return (since === null || ms >= since) && ms < until;
  };

  const sold = listings.filter((l) => l.outcome === 'sold' && l.closed_at && inRange(l.closed_at));
  const manualInRange = manualSales.filter((m) => inRange(m.sold_at));
  const items = sold.reduce((n, l) => n + (l.sold_hr ?? 0), 0);
  const manual = manualInRange.reduce((n, m) => n + m.sold_hr, 0);
  const times = [...sold.map((l) => new Date(l.closed_at!).getTime()), ...manualInRange.map((m) => new Date(m.sold_at).getTime())];

  const total = items + manual;
  // Average from the first sale in the range: tracking may have started after the range did.
  const start = times.length ? Math.min(...times) : until;
  const days = Math.max(1, Math.ceil((until - start) / DAY));

  const sales = sold.length + manualInRange.length;
  return (
    <Ledger
      items={[
        {
          value: fmtHr(total),
          label: `earned from ${sales} sale${sales === 1 ? '' : 's'}`,
          title: `Items sold ${fmtHr(items)} · manual sales ${fmtHr(manual)}, in the range picked at the top`,
        },
        // A rate needs a few sale days behind it, as the charts do; one or two say little.
        ...(new Set(times.map((t) => new Date(t).toDateString())).size >= 3 ? [{ value: fmtHr(total / days), label: days >= 7 ? 'per calendar day' : `per day over ${days} day${days === 1 ? '' : 's'}`, title: `Over ${days} day${days === 1 ? '' : 's'}, since the first sale in the range` }] : []),
        ...extra,
      ]}
    />
  );
}
