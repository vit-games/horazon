/**
 * Shared control styles: one look per job, in a regular and a compact size. Red belongs to
 * trouble, so destructive actions stay muted and only turn red on hover.
 */
export const btn = 'rounded-sm border border-line bg-panel-hi px-3 py-1.5 text-sm text-text hover:border-accent/50 disabled:opacity-50';
/** The compact primary action (glyph blue at 15%): Keep, Restart and update. */
export const btnPrimarySm = 'whitespace-nowrap rounded-sm border border-accent/70 bg-accent/15 px-2.5 py-1 text-xs text-text hover:bg-accent/25 disabled:opacity-50';
export const btnSm = 'whitespace-nowrap rounded-sm border border-line bg-panel-hi px-2.5 py-1 text-xs text-text hover:border-accent/50 disabled:opacity-50';
export const btnDanger = 'rounded-sm border border-line px-3 py-1.5 text-sm text-muted hover:border-q-red/60 hover:text-q-red disabled:opacity-50';
export const linkSm = 'text-xs text-muted hover:text-accent disabled:opacity-50';
export const linkDanger = 'text-xs text-muted hover:text-q-red hover:underline disabled:opacity-50';

/** Inputs inside a panel (inset on the void). */
export const field = 'rounded-sm border border-line bg-bg px-3 py-1.5 text-sm outline-none focus:border-accent/60';
export const fieldSm = 'rounded-sm border border-line bg-bg px-2 py-1 text-sm outline-none focus:border-accent/60';
/** Inputs and selects in a page toolbar (on the page ground). */
export const toolbar = 'rounded-sm border border-line bg-panel px-3 py-1.5 text-sm outline-none focus:border-accent/60';
export const toolbarSm = 'rounded-sm border border-line bg-panel px-2 py-1 text-xs text-text outline-none focus:border-accent/60';

/** A page's subtab row: one height on every page, with or without controls beside the tabs. */
export const subnav = 'flex min-h-10 items-end gap-1 border-b border-line text-sm';

/** Segmented choices (filters, switches): one look everywhere, the active one underlined in glyph blue. */
export const segGroup = 'flex flex-wrap divide-x divide-line overflow-hidden rounded-sm border border-line bg-panel';
export const segItem = (on: boolean) =>
  `flex items-center gap-1.5 px-3 py-1.5 text-sm transition-colors ${on ? 'bg-panel-hi text-text shadow-[inset_0_-2px_0_var(--color-accent)]' : 'text-muted hover:bg-panel-hi/60 hover:text-text'}`;
