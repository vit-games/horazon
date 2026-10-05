import currency from '../data/currency.json';
import { ItemIcon } from './ItemIcon';
import { fmtNumber } from '../lib/series';
import type { Drop } from '../lib/types';

/** Named groups (currency.json) first, then everything else as plain currency. */
const GROUPS: [string, Set<string>][] = Object.entries(currency.groups as Record<string, string[]>).map(([name, codes]) => [name, new Set(codes)]);

const dateFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** Currency found in the period by group, one row per item: count, how often per map, last found. */
export function CurrencyTable({ drops, maps }: { drops: Drop[]; maps: number }) {
  const grouped = [
    ...GROUPS.map(([name, codes]) => ({ name, drops: drops.filter((d) => codes.has(d.item.base_code)) })),
    { name: 'Currency', drops: drops.filter((d) => !GROUPS.some(([, codes]) => codes.has(d.item.base_code))) },
  ];
  return (
    <>
      {grouped.map((g) => (
        <CurrencyGroup key={g.name} name={g.name} drops={g.drops} maps={maps} />
      ))}
    </>
  );
}

function CurrencyGroup({ name, drops, maps }: { name: string; drops: Drop[]; maps: number }) {
  const byCode = new Map<string, { sample: Drop; count: number; last: string }>();
  for (const d of drops) {
    const row = byCode.get(d.item.base_code) ?? { sample: d, count: 0, last: d.found_at };
    row.count += d.quantity;
    if (d.found_at > row.last) row.last = d.found_at;
    byCode.set(d.item.base_code, row);
  }
  const rows = [...byCode.values()].sort((a, b) => b.count - a.count || a.sample.item.name.localeCompare(b.sample.item.name));
  const cell = 'px-3 py-2 text-right tabular-nums';

  // A group with nothing found says nothing.
  if (!rows.length) return null;
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg text-text">{name}</h2>
      <div className="rounded-sm border border-line bg-panel">
      {(
        <div className="overflow-x-auto">
          {/* Fixed widths so the group tables line up with each other. */}
          <table className="w-full table-fixed text-sm">
            <colgroup>
              <col className="w-[44%]" />
              <col className="w-[14%]" />
              <col className="w-[20%]" />
              <col className="w-[22%]" />
            </colgroup>
            <thead className="text-xs text-muted">
              <tr className="border-b border-line">
                <th className="px-3 py-2 text-left font-normal">Item</th>
                <th className={`${cell} font-normal`}>Found</th>
                <th className={`${cell} font-normal`} title="Captured map runs in the period per item found">Rate</th>
                <th className={`${cell} font-normal`}>Last found</th>
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
                  <td className={cell}>{fmtNumber(count)}</td>
                  <td className={cell}>{maps ? `1 in ${(maps / count).toFixed(maps / count < 10 ? 1 : 0)} maps` : <span className="text-muted">—</span>}</td>
                  <td className={`${cell} text-muted`}>{dateFmt.format(new Date(last))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      </div>
    </section>
  );
}
