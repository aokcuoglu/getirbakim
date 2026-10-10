"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { BadgePercent, Building2, ExternalLink, LayoutDashboard, Layers3, LogOut, Menu, PlugZap, ReceiptText, Truck, X, type LucideIcon } from "lucide-react";
import { logout } from "@/modules/auth/actions";

export type AdminNavStatus = {
  orders: number; services: number; enrichment: number;
  basbug: "success" | "warning" | "danger" | "neutral";
  dinamik: "success" | "warning" | "danger" | "neutral";
};
type Item = { href: string; label: string; icon: LucideIcon; count?: keyof Pick<AdminNavStatus, "orders" | "services" | "enrichment">; dot?: "basbug" | "dinamik"; exact?: boolean };
const sections: { title?: string; items: Item[] }[] = [
  { items: [{ href: "/yonetim", label: "Genel bakış", icon: LayoutDashboard, exact: true }] },
  { title: "Satış", items: [
    { href: "/yonetim/siparisler", label: "Siparişler", icon: ReceiptText, count: "orders" },
    { href: "/yonetim/servisler", label: "B2B servisler", icon: Building2, count: "services" },
    { href: "/yonetim/fiyatlandirma", label: "Fiyatlandırma", icon: BadgePercent },
  ] },
  { title: "Katalog", items: [
    { href: "/yonetim/urun-verileri", label: "Ürün zenginleştirme", icon: Layers3, count: "enrichment" },
  ] },
  { title: "Entegrasyonlar", items: [
    { href: "/yonetim/tedarikciler", label: "Tüm tedarikçiler", icon: PlugZap, exact: true },
    { href: "/yonetim/tedarikciler/basbug", label: "Başbuğ API", icon: Truck, dot: "basbug" },
    { href: "/yonetim/tedarikciler/dinamik", label: "Dinamik API", icon: Truck, dot: "dinamik" },
  ] },
];
const dotLabels = { success: "sağlıklı", warning: "dikkat gerekiyor", danger: "hata", neutral: "bağlı değil" };

export function AdminSidebar({ status, account }: { status: AdminNavStatus; account: { name: string; email: string } }) {
  const pathname = usePathname();
  // The drawer belongs to the path it was opened on, so navigating closes it.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const setOpen = (value: boolean) => setOpenOn(value ? pathname : null);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setOpenOn(null); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);
  const active = (item: Item) => item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
  const initials = account.name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]?.toLocaleUpperCase("tr")).join("");
  return <>
    <div className="admin-mobilebar">
      <button type="button" aria-label="Yönetim menüsünü aç" aria-expanded={open} aria-controls="admin-sidebar" onClick={() => setOpen(true)}><Menu size={18}/></button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <Link href="/yonetim"><img src="/brand/logo-light.svg" alt="getirbakim yönetim" width={120} height={27}/></Link>
    </div>
    {open && <div className="admin-scrim" onClick={() => setOpen(false)} aria-hidden="true"/>}
    <aside id="admin-sidebar" className={`admin-sidebar${open ? " is-open" : ""}`}>
      <div className="admin-sidebar-brand">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <Link href="/yonetim"><img src="/brand/logo-light.svg" alt="getirbakim" width={106} height={24}/></Link><span>Yönetim</span>
        {open && <button type="button" className="admin-btn-ghost" style={{ marginLeft: "auto" }} aria-label="Menüyü kapat" onClick={() => setOpen(false)}><X size={16}/></button>}
      </div>
      <nav className="admin-nav" aria-label="Yönetim">
        {sections.map((section, index) => <div key={section.title ?? index}>
          {section.title && <p className="admin-nav-title">{section.title}</p>}
          <ul>{section.items.map(item => {
            const count = item.count ? status[item.count] : 0;
            const tone = item.dot ? status[item.dot] : null;
            return <li key={item.href}>
              <Link href={item.href} aria-current={active(item) ? "page" : undefined}>
                <item.icon size={16} aria-hidden="true"/>{item.label}
                {count > 0 && <span className={`admin-nav-count${item.count === "services" || item.count === "orders" ? " is-alert" : ""}`}><span className="sr-only">, bekleyen: </span>{count}</span>}
                {tone && <span className={`admin-nav-dot is-${tone}`} role="img" aria-label={dotLabels[tone]}/>}
              </Link>
            </li>;
          })}</ul>
        </div>)}
      </nav>
      <div className="admin-sidebar-footer">
        <Link href="/" target="_blank"><ExternalLink size={16} aria-hidden="true"/>Mağazayı aç</Link>
        <div className="admin-account"><span className="admin-avatar" aria-hidden="true">{initials || "Y"}</span><div><strong>{account.name}</strong><small>{account.email}</small></div></div>
        <form action={logout}><button type="submit"><LogOut size={16} aria-hidden="true"/>Çıkış yap</button></form>
      </div>
    </aside>
  </>;
}
