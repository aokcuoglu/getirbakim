"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BadgePercent, Building2, ChevronsUpDown, ExternalLink, LayoutDashboard, Layers3, LogOut, Moon, PlugZap, ReceiptText, Sun, Truck, type LucideIcon } from "lucide-react";
import { logout } from "@/modules/auth/actions";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupLabel, SidebarHeader, SidebarMenu,
  SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem, SidebarRail, useSidebar,
} from "@/components/ui/sidebar";

export type AdminNavStatus = {
  orders: number; services: number; enrichment: number;
  basbug: "success" | "warning" | "danger" | "neutral";
  dinamik: "success" | "warning" | "danger" | "neutral";
};
type Item = { href: string; label: string; icon: LucideIcon; count?: keyof Pick<AdminNavStatus, "orders" | "services" | "enrichment">; dot?: "basbug" | "dinamik"; exact?: boolean };
const sections: { title: string; items: Item[] }[] = [
  { title: "Genel", items: [{ href: "/yonetim", label: "Genel bakış", icon: LayoutDashboard, exact: true }] },
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
const dotStyles = { success: "bg-success", warning: "bg-warning", danger: "bg-destructive", neutral: "bg-muted-foreground/40" };
const dotLabels = { success: "sağlıklı", warning: "dikkat gerekiyor", danger: "hata", neutral: "bağlı değil" };

export function AdminSidebar({ status, account }: { status: AdminNavStatus; account: { name: string; email: string } }) {
  const pathname = usePathname();
  const { isMobile, setOpenMobile } = useSidebar();
  const active = (item: Item) => item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
  const initials = account.name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]?.toLocaleUpperCase("tr")).join("") || "Y";
  return <Sidebar collapsible="icon">
    <SidebarHeader>
      <SidebarMenu><SidebarMenuItem>
        <SidebarMenuButton size="lg" render={<Link href="/yonetim"/>} tooltip="Genel bakış">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">g</span>
          <span className="grid flex-1 text-left leading-tight"><span className="truncate font-semibold text-foreground">getirbakim</span><span className="truncate text-xs">Yönetim paneli</span></span>
        </SidebarMenuButton>
      </SidebarMenuItem></SidebarMenu>
    </SidebarHeader>
    <SidebarContent>
      {sections.map(section => <SidebarGroup key={section.title}>
        <SidebarGroupLabel>{section.title}</SidebarGroupLabel>
        <SidebarMenu>{section.items.map(item => {
          const count = item.count ? status[item.count] : 0;
          const tone = item.dot ? status[item.dot] : null;
          return <SidebarMenuItem key={item.href}>
            <SidebarMenuButton isActive={active(item)} tooltip={item.label} onClick={() => isMobile && setOpenMobile(false)}
              render={<Link href={item.href} aria-current={active(item) ? "page" : undefined}/>}>
              <item.icon aria-hidden="true"/><span>{item.label}</span>
            </SidebarMenuButton>
            {count > 0 && <SidebarMenuBadge className={cn("rounded-full px-1.5 tabular-nums", (item.count === "orders" || item.count === "services") && "bg-warning/15 text-warning")}>
              <span className="sr-only">Bekleyen: </span>{count}
            </SidebarMenuBadge>}
            {tone && <SidebarMenuBadge><span className={cn("size-2 rounded-full", dotStyles[tone])} role="img" aria-label={dotLabels[tone]}/></SidebarMenuBadge>}
          </SidebarMenuItem>;
        })}</SidebarMenu>
      </SidebarGroup>)}
    </SidebarContent>
    <SidebarFooter>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton tooltip="Mağazayı aç" render={<Link href="/" target="_blank"/>}><ExternalLink aria-hidden="true"/><span>Mağazayı aç</span></SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <DropdownMenu>
            <DropdownMenuTrigger render={<SidebarMenuButton size="lg" className="data-popup-open:bg-sidebar-accent"/>}>
              <Avatar className="size-8 rounded-lg"><AvatarFallback className="rounded-lg bg-primary/10 text-xs font-semibold text-primary">{initials}</AvatarFallback></Avatar>
              <span className="grid flex-1 text-left leading-tight"><span className="truncate font-medium text-foreground">{account.name}</span><span className="truncate text-xs">{account.email}</span></span>
              <ChevronsUpDown className="ml-auto" aria-hidden="true"/>
            </DropdownMenuTrigger>
            <DropdownMenuContent side={isMobile ? "bottom" : "right"} align="end" className="min-w-56">
              <DropdownMenuGroup><DropdownMenuLabel className="truncate">{account.email}</DropdownMenuLabel></DropdownMenuGroup>
              <DropdownMenuSeparator/>
              <ThemeItem/>
              <DropdownMenuSeparator/>
              <DropdownMenuItem onClick={() => { void logout(); }}><LogOut aria-hidden="true"/>Çıkış yap</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarFooter>
    <SidebarRail/>
  </Sidebar>;
}

/** Light/dark switch for the workspace only; the storefront has no dark theme. */
function ThemeItem() {
  const toggle = () => {
    const dark = document.documentElement.classList.toggle("dark");
    try { localStorage.setItem("gb-admin-theme", dark ? "dark" : "light"); } catch {}
  };
  return <DropdownMenuItem onClick={toggle} closeOnClick={false}>
    <Sun className="dark:hidden" aria-hidden="true"/><Moon className="hidden dark:block" aria-hidden="true"/>
    <span className="dark:hidden">Koyu temaya geç</span><span className="hidden dark:inline">Açık temaya geç</span>
  </DropdownMenuItem>;
}
