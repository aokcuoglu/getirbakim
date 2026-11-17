import Link from "next/link";
import { X } from "lucide-react";

/**
 * The listing's selected filters as removable chips above the results, at every width (#883). Each chip is a plain link
 * to the listing without that filter (the sort stays, the page number drops), so it works before hydration too.
 */
export function CatalogActiveFilters({ items, clearHref }: { items: { key: string; label: string; href: string }[]; clearHref: string }) {
  if (!items.length) return null;
  const chip = "inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] leading-5 max-[768px]:min-h-11";
  return <div className="mb-4 flex flex-wrap items-center gap-2" role="group" aria-label="Seçili filtreler">
    {items.map(item => <Link key={item.key} href={item.href} scroll={false}
      className={`${chip} max-w-full border-input bg-white text-foreground hover:border-brand hover:text-primary`}>
      <span className="wrap-anywhere">{item.label}<span className="sr-only"> filtresini kaldır</span></span><X size={14} className="shrink-0" aria-hidden="true" />
    </Link>)}
    <Link href={clearHref} scroll={false} className={`${chip} border-transparent font-medium text-brand-strong hover:underline`}>Tümünü temizle</Link>
  </div>;
}
