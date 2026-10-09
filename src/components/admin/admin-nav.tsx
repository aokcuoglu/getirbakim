"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BadgePercent, Building2, LayoutDashboard, Layers3, ReceiptText, Truck, type LucideIcon } from "lucide-react";

type Item = { href: string; label: string; icon: LucideIcon };
const sections: { title?: string; items: Item[] }[] = [
  { items: [{ href: "/yonetim", label: "Genel bakış", icon: LayoutDashboard }] },
  { title: "Satış", items: [
    { href: "/yonetim/siparisler", label: "Siparişler", icon: ReceiptText },
    { href: "/yonetim/fiyatlandirma", label: "Fiyatlandırma", icon: BadgePercent },
    { href: "/yonetim/servisler", label: "B2B servisler", icon: Building2 },
  ] },
  { title: "Katalog", items: [
    { href: "/yonetim/tedarikciler", label: "Tedarikçiler", icon: Truck },
    { href: "/yonetim/urun-verileri", label: "Ürün zenginleştirme", icon: Layers3 },
  ] },
];

export function AdminNav() {
  const pathname = usePathname();
  const active = (href: string) => href === "/yonetim" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  return <nav className="admin-nav" aria-label="Yönetim">
    {sections.map((section, index) => <div className="admin-nav-section" key={section.title ?? index}>
      {section.title && <p className="admin-nav-title">{section.title}</p>}
      <ul>{section.items.map(({ href, label, icon: Icon }) => <li key={href}>
        <Link href={href} aria-current={active(href) ? "page" : undefined}><Icon size={16} aria-hidden="true"/>{label}</Link>
      </li>)}</ul>
    </div>)}
  </nav>;
}
