import { cookies } from "next/headers";
import { AdminBreadcrumb } from "@/components/admin/admin-breadcrumb";
import { AdminTheme } from "@/components/admin/admin-theme";
import { AdminSidebar, type AdminNavStatus } from "@/components/admin/admin-nav";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { Kbd } from "@/components/ui/kbd";
import { TableControls } from "@/components/ui/table";
import { TooltipProvider } from "@/components/ui/tooltip";
import { requireAdmin } from "@/modules/auth/session";
import { adminNavCounts, adminSupplierFeedStatus } from "@/modules/admin/data";
import { feedNavTone } from "@/modules/suppliers/data-status";

export const metadata = { title: { default: "Yönetim", template: "%s | Getirbakim" }, robots: { index: false, follow: false } };

// The workspace has its own shell: storefront header and footer live in (store)/layout.tsx only. .admin-app also
// scopes the stock shadcn neutral theme in globals.css. Every page and data loader still checks the session itself:
// layouts do not re-run on client navigation. TableControls gives every table sorting, header filters and search.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const account = await requireAdmin();
  const [counts, feeds, jar] = await Promise.all([adminNavCounts(), adminSupplierFeedStatus().catch(() => null), cookies()]);
  // Dots follow the supplier overview: data freshness and open feed problems, not the scheduler heartbeat.
  const status: AdminNavStatus = {
    ...counts,
    basbug: feeds ? feedNavTone(feeds.basbug) : "danger",
    dinamik: feeds ? feedNavTone(feeds.dinamik) : "danger",
    seta: feeds ? feedNavTone(feeds.seta) : "danger",
  };
  // <main id="main-content"> is the skip link target from the root layout.
  return <main id="main-content" tabIndex={-1}><div className="admin-app">
    <AdminTheme/>
    <TooltipProvider>
      <SidebarProvider defaultOpen={jar.get("sidebar_state")?.value !== "false"}>
        <AdminSidebar status={status} account={{ name: account.name, email: account.email }}/>
        <SidebarInset className="min-w-0">
          <header className="sticky top-0 z-10 flex h-12 shrink-0 items-center gap-2 border-b bg-background px-4">
            <SidebarTrigger className="-ml-1" aria-label="Kenar çubuğunu aç/kapat"/>
            <Separator orientation="vertical" className="mr-2 data-vertical:h-4 data-vertical:self-auto"/>
            <AdminBreadcrumb/>
            <Kbd className="ml-auto hidden md:inline-flex">⌘B</Kbd>
          </header>
          <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col p-4 md:p-6"><TableControls>{children}</TableControls></div>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  </div></main>;
}
