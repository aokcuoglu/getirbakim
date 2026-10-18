"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BadgePercent, Building2, CarFront, CircleAlert, CircleCheck, CircleDashed, GitCompareArrows, ChevronsUpDown, ExternalLink, LayoutDashboard, Layers3, LogOut, Moon, Package, PlugZap, ReceiptText, Sun, TriangleAlert, Truck, type LucideIcon } from "lucide-react";
import { logout } from "@/modules/auth/actions";
import { ADMIN_THEME_KEY } from "@/components/admin/admin-theme";
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
  seta: "success" | "warning" | "danger" | "neutral";
};
type Item = { href: string; label: string; icon: LucideIcon; count?: keyof Pick<AdminNavStatus, "orders" | "services" | "enrichment">; dot?: "basbug" | "dinamik" | "seta"; exact?: boolean };
const sections: { title: string; items: Item[] }[] = [
  { title: "Genel", items: [{ href: "/yonetim", label: "Genel bakış", icon: LayoutDashboard, exact: true }] },
  { title: "Satış", items: [
    { href: "/yonetim/siparisler", label: "Siparişler", icon: ReceiptText, count: "orders" },
    { href: "/yonetim/servisler", label: "B2B servisler", icon: Building2, count: "services" },
    { href: "/yonetim/fiyatlandirma", label: "Fiyatlandırma", icon: BadgePercent },
  ] },
  { title: "Katalog", items: [
    { href: "/yonetim/urunler", label: "Ürünler", icon: Package },
    { href: "/yonetim/urun-verileri", label: "Ürün zenginleştirme", icon: Layers3, count: "enrichment" },
    { href: "/yonetim/urun-eslestirme", label: "Ürün eşleştirme", icon: GitCompareArrows },
    { href: "/yonetim/arac-gorselleri", label: "Araç görselleri", icon: CarFront },
  ] },
  { title: "Entegrasyonlar", items: [
    { href: "/yonetim/tedarikciler", label: "Tüm tedarikçiler", icon: PlugZap, exact: true },
    { href: "/yonetim/tedarikciler/basbug", label: "Başbuğ API", icon: Truck, dot: "basbug" },
    { href: "/yonetim/tedarikciler/dinamik", label: "Dinamik API", icon: Truck, dot: "dinamik" },
    { href: "/yonetim/tedarikciler/seta", label: "SETA API", icon: Truck, dot: "seta" },
  ] },
];
const dotIcons = { success: CircleCheck, warning: TriangleAlert, danger: CircleAlert, neutral: CircleDashed };
const dotLabels = { success: "sağlıklı", warning: "dikkat gerekiyor", danger: "hata", neutral: "bağlı değil" };
const dotColors = { success: "text-success", warning: "text-warning", danger: "text-destructive", neutral: "text-muted-foreground" };

export function AdminSidebar({ status, account }: { status: AdminNavStatus; account: { name: string; email: string } }) {
  const pathname = usePathname();
  const { isMobile, setOpenMobile } = useSidebar();
  const active = (item: Item) => item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
  const initials = account.name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]?.toLocaleUpperCase("tr")).join("") || "Y";
  return <Sidebar collapsible="icon">
    <SidebarHeader>
      <SidebarMenu><SidebarMenuItem>
        <SidebarMenuButton size="lg" render={<Link href="/yonetim"/>} tooltip="Genel bakış">
          <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">g</div>
          <div className="grid flex-1 text-left text-sm leading-tight"><span className="truncate font-medium">getirbakim</span><span className="truncate text-xs">Yönetim paneli</span></div>
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
            {count > 0 && <SidebarMenuBadge><span className="sr-only">Bekleyen: </span>{count}</SidebarMenuBadge>}
            {tone && <SidebarMenuBadge><ToneIcon tone={tone}/></SidebarMenuBadge>}
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
            <DropdownMenuTrigger render={<SidebarMenuButton size="lg" className="data-popup-open:bg-sidebar-accent data-popup-open:text-sidebar-accent-foreground"/>}>
              <Avatar className="size-8 rounded-lg"><AvatarFallback className="rounded-lg">{initials}</AvatarFallback></Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight"><span className="truncate font-medium">{account.name}</span><span className="truncate text-xs">{account.email}</span></div>
              <ChevronsUpDown className="ml-auto size-4" aria-hidden="true"/>
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

function ToneIcon({ tone }: { tone: keyof typeof dotIcons }) {
  const Icon = dotIcons[tone];
  return <Icon className={`size-3.5 ${dotColors[tone]}`} role="img" aria-label={dotLabels[tone]}/>;
}

/** Light/dark switch for the workspace only; the storefront has no dark theme. */
function ThemeItem() {
  const toggle = () => {
    const dark = document.documentElement.classList.toggle("dark");
    try { localStorage.setItem(ADMIN_THEME_KEY, dark ? "dark" : "light"); } catch {}
  };
  return <DropdownMenuItem onClick={toggle} closeOnClick={false}>
    <Sun className="dark:hidden" aria-hidden="true"/><Moon className="hidden dark:block" aria-hidden="true"/>
    <span className="dark:hidden">Koyu temaya geç</span><span className="hidden dark:inline">Açık temaya geç</span>
  </DropdownMenuItem>;
}
