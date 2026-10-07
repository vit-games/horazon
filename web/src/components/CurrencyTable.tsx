import { ItemIcon } from './ItemIcon';
import type { Drop } from '../lib/types';

const dateFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** Currency found in the period, one row per item: count and last found (most of it doesn't come from maps, so no per-map rate). */
export function CurrencyTable({ drops }: { drops: Drop[] }) {
  const byCode = new Map<string, { sample: Drop; count: number; last: string }>();
  for (const d of drops) {
    const row = byCode.get(d.item.base_code) ?? { sample: d, count: 0, last: d.found_at };
    row.count += d.quantity;
    if (d.found_at > row.last) row.last = d.found_at;
    byCode.set(d.item.base_code, row);
  }
  const rows = [...byCode.values()].sort((a, b) => b.count - a.count || a.sample.item.name.localeCompare(b.sample.item.name));
  const cell = 'px-3 py-1.5 text-right';

  // Nothing found says nothing.
  if (!rows.length) return null;
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg text-text">Currency</h2>
      <div className="max-w-3xl rounded-sm border border-line bg-panel">
        <div className="overflow-x-auto">
          <table className="w-full table-fixed text-sm">
            <colgroup>
              <col className="w-[60%]" />
              <col className="w-[14%]" />
              <col className="w-[26%]" />
            </colgroup>
            <thead className="text-xs text-muted">
              <tr className="border-b border-line">
                <th className="px-3 py-2 text-left font-normal">Item</th>
                <th className="px-3 py-2 text-right font-normal">Found</th>
                <th className="px-3 py-2 text-right font-normal">Last found</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ sample, count, last }) => (
                <tr key={sample.item.base_code} className="border-b border-line/60 last:border-0">
                  <td className="px-3 py-1.5">
                    <span className="flex items-center gap-2">
                      <ItemIcon item={sample.item} box={24} />
                      {sample.item.name}
                    </span>
                  </td>
                  <td className={cell}>{count}</td>
                  <td className={`${cell} font-medium text-muted`}>{dateFmt.format(new Date(last))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
