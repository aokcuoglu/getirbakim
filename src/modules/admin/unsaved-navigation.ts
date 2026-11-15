export type ClickInfo = {
  href: string | null; target: string; download: boolean; button: number; modified: boolean; defaultPrevented: boolean;
};

/**
 * The absolute URL a plain click on a link would navigate to, or null when the click stays on this page or is not a
 * same-tab navigation (new tab, download, modifier key, other origin, hash-only change, or the same tab with other params) (#698).
 */
export function leavesPage(click: ClickInfo, current: string): string | null {
  if (!click.href || click.button !== 0 || click.modified || click.defaultPrevented || click.download) return null;
  if (click.target !== "" && click.target !== "_self") return null;
  const here = new URL(current);
  const next = new URL(click.href, current);
  if (next.origin !== here.origin) return null;
  if (next.pathname === here.pathname && next.searchParams.get("tab") === here.searchParams.get("tab")) return null;
  return next.href;
}
