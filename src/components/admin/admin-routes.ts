import { BadgePercent, BellRing, Building2, Droplets, GitCompareArrows, LayoutDashboard, Layers3, Package, PlugZap, ReceiptText, type LucideIcon } from "lucide-react";

export type AdminNavStatus = {
  orders: number; services: number; enrichment: number; brands: number;
  /** Restock requests whose product can be ordered again ("Bildirilecek", #475). */
  restock: number;
  basbug: "success" | "warning" | "danger" | "neutral";
  dinamik: "success" | "warning" | "danger" | "neutral";
  seta: "success" | "warning" | "danger" | "neutral";
};
export type AdminRoute = {
  href: string; label: string; icon?: LucideIcon;
  count?: keyof Pick<AdminNavStatus, "orders" | "services" | "enrichment" | "brands" | "restock">;
  dot?: "basbug" | "dinamik" | "seta"; exact?: boolean; children?: AdminRoute[];
};

/** The one list of /yonetim pages: the sidebar renders it and the header breadcrumb takes its labels from it. */
export const adminSections: { title: string; items: AdminRoute[] }[] = [
  { title: "Genel", items: [{ href: "/yonetim", label: "Genel bakış", icon: LayoutDashboard, exact: true }] },
  { title: "Satış", items: [
    { href: "/yonetim/siparisler", label: "Siparişler", icon: ReceiptText, count: "orders" },
    { href: "/yonetim/servisler", label: "B2B servisler", icon: Building2, count: "services" },
    { href: "/yonetim/stok-bildirimleri", label: "Stok bildirimleri", icon: BellRing, count: "restock" },
    { href: "/yonetim/fiyatlandirma", label: "Fiyatlandırma", icon: BadgePercent },
  ] },
  { title: "Katalog", items: [
    { href: "/yonetim/urunler", label: "Ürünler", icon: Package },
    { href: "/yonetim/urun-verileri", label: "Ürün zenginleştirme", icon: Layers3, count: "enrichment" },
    { href: "/yonetim/urun-eslestirme", label: "Ürün eşleştirme", icon: GitCompareArrows, count: "brands" },
    { href: "/yonetim/yag-verileri", label: "Yağ verileri", icon: Droplets },
  ] },
  { title: "Entegrasyonlar", items: [
    { href: "/yonetim/tedarikciler", label: "Tedarikçiler", icon: PlugZap, exact: true, children: [
      { href: "/yonetim/tedarikciler/basbug", label: "Başbuğ", dot: "basbug" },
      { href: "/yonetim/tedarikciler/dinamik", label: "Dinamik", dot: "dinamik" },
      { href: "/yonetim/tedarikciler/seta", label: "SETA", dot: "seta" },
      { href: "/yonetim/tedarikciler/manuel", label: "Manuel yükleme" },
    ] },
  ] },
];

const flat = (items: AdminRoute[]): AdminRoute[] => items.flatMap(item => [item, ...flat(item.children ?? [])]);
const labels = new Map(flat(adminSections.flatMap(section => section.items)).map(route => [route.href, route.label]));

/**
 * Whether a sidebar entry is the current page. The collapsed rail hides the sub list, so a parent with children then
 * stands for every page below it.
 */
export function isAdminRouteActive(item: AdminRoute, pathname: string, collapsed: boolean): boolean {
  const prefix = pathname === item.href || pathname.startsWith(`${item.href}/`);
  return item.exact && !(item.children && collapsed) ? pathname === item.href : prefix;
}

/** Breadcrumb trail for the route segments below /yonetim (as useSelectedLayoutSegments reports them). */
export function adminBreadcrumb(segments: string[]): { label: string; href?: string }[] {
  if (!segments.length) return [{ label: "Genel bakış" }];
  const trail: { label: string; href?: string }[] = [{ label: "Yönetim", href: "/yonetim" }];
  let href = "/yonetim", matched = 0;
  for (const segment of segments.slice(0, 2)) {
    href += `/${segment}`;
    const label = labels.get(href);
    if (!label) break;
    trail.push({ label, href });
    matched += 1;
  }
  // Only product detail pages carry a generic leaf: urunler/<id> and tedarikciler/<supplier>/urun/<id>.
  const detail = (segments[0] === "urunler" && segments.length === 2 && matched === 1)
    || (segments[0] === "tedarikciler" && segments.length === 4 && segments[2] === "urun" && matched === 2);
  if (detail) trail.push({ label: "Ürün ayrıntısı" });
  delete trail[trail.length - 1].href;
  return trail;
}
