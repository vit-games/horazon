import type { ReactNode } from 'react';

export function Card({ title, children, footer }: { title: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <section className="rounded-sm border border-line bg-panel">
      <h2 className="border-b border-line px-4 py-3 text-sm text-text">{title}</h2>
      <div className="flex flex-col gap-3 px-4 py-3 text-sm">{children}</div>
      {footer && <div className="border-t border-line px-4 py-2 text-xs text-muted">{footer}</div>}
    </section>
  );
}
