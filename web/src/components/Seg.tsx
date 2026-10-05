/** Small segmented buttons for chart headers (bucket size etc.); the same style on every chart. */
export function Seg<T extends string>({ options, value, onChange }: { options: readonly { key: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <span className="flex divide-x divide-line overflow-hidden rounded-sm border border-line">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          aria-pressed={o.key === value}
          onClick={() => onChange(o.key)}
          className={`px-2.5 py-1 text-[13px] ${o.key === value ? 'bg-panel-hi text-text shadow-[inset_0_-2px_0_var(--color-accent)]' : 'text-muted hover:bg-panel-hi/60 hover:text-text'}`}
        >
          {o.label}
        </button>
      ))}
    </span>
  );
}

export type Unit = 'day' | 'week' | 'month';
export const UNITS: { key: Unit; label: string }[] = [
  { key: 'day', label: 'Day' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
];
