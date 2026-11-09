import { cookies } from "next/headers";
import { AdminTheme } from "@/components/admin/admin-theme";
import { AdminSidebar, type AdminNavStatus } from "@/components/admin/admin-nav";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { Kbd } from "@/components/ui/kbd";
import { TableControls } from "@/components/ui/table";
import { TooltipProvider } from "@/components/ui/tooltip";
import { requireAdmin } from "@/modules/auth/session";
import { adminNavCounts } from "@/modules/admin/data";
import { supplierHealth } from "@/modules/suppliers/health";
import { DINAMIK_COMPANY } from "@/modules/suppliers/dinamik-import";
import { db } from "@/lib/db";
import { setaCompany } from "@/modules/suppliers/storefront-sources";

export const metadata = { title: "Yönetim | Getirbakim", robots: { index: false, follow: false } };

// The workspace replaces the storefront header and footer with its own shell (see StorefrontChrome); .admin-app also
// scopes the stock shadcn neutral theme in globals.css. Every page and data loader still checks the session itself:
// layouts do not re-run on client navigation. TableControls gives every table sorting, header filters and search.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const account = await requireAdmin();
  const [counts, health, dinamik, setaHealth, jar] = await Promise.all([adminNavCounts(), supplierHealth(db, process.env.BASBUG_FIRMA_ADI || "BASBUG").catch(() => null),
    supplierHealth(db, DINAMIK_COMPANY).catch(() => null), supplierHealth(db, setaCompany).catch(() => null), cookies()]);
  const status: AdminNavStatus = {
    ...counts,
    basbug: !health ? "danger" : health.healthy ? "success" : "warning",
    dinamik: !dinamik ? "danger" : dinamik.healthy ? "success" : dinamik.scopes.some(scope => scope.last_success_at) ? "warning" : "neutral",
    seta: !process.env.SETA_API_KEY ? "neutral" : !setaHealth ? "danger" : setaHealth.healthy ? "success" : "warning",
  };
  return <div className="admin-app">
    <AdminTheme/>
    <TooltipProvider>
      <SidebarProvider defaultOpen={jar.get("sidebar_state")?.value !== "false"}>
        <AdminSidebar status={status} account={{ name: account.name, email: account.email }}/>
        <SidebarInset className="min-w-0">
          <header className="sticky top-0 z-10 flex h-12 shrink-0 items-center gap-2 border-b bg-background px-4">
            <SidebarTrigger className="-ml-1" aria-label="Kenar çubuğunu aç/kapat"/>
            <Separator orientation="vertical" className="mr-2 data-vertical:h-4 data-vertical:self-auto"/>
            <span className="text-sm font-medium">Yönetim paneli</span>
            <Kbd className="ml-auto hidden md:inline-flex">⌘B</Kbd>
          </header>
          <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col p-4 md:p-6"><TableControls>{children}</TableControls></div>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  </div>;
}
