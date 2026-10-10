import { cookies } from "next/headers";
import { AdminSidebar, type AdminNavStatus } from "@/components/admin/admin-nav";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { TooltipProvider } from "@/components/ui/tooltip";
import { requireAdmin } from "@/modules/auth/session";
import { adminNavCounts } from "@/modules/admin/data";
import { supplierHealth } from "@/modules/suppliers/health";
import { supplierStatuses } from "@/modules/suppliers/clients";
import { db } from "@/lib/db";

export const metadata = { title: "Yönetim | Getirbakim", robots: { index: false, follow: false } };

// Applies the saved workspace theme before first paint; the toggle lives in the account menu.
const themeScript = `try{document.documentElement.classList.toggle("dark",localStorage.getItem("gb-admin-theme")==="dark")}catch(e){}`;

// The workspace replaces the storefront header and footer with its own shell (see StorefrontChrome); .admin-app also
// scopes the shadcn theme tokens in globals.css. Every page and data loader still checks the session itself:
// layouts do not re-run on client navigation.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const account = await requireAdmin();
  const [counts, health, jar] = await Promise.all([adminNavCounts(), supplierHealth(db, process.env.BASBUG_FIRMA_ADI || "BASBUG").catch(() => null), cookies()]);
  const dinamik = supplierStatuses().find(s => s.name === "Dinamik");
  const status: AdminNavStatus = {
    ...counts,
    basbug: !health ? "danger" : health.healthy ? "success" : "warning",
    dinamik: dinamik?.verified ? "success" : "neutral",
  };
  return <div className="admin-app">
    <script dangerouslySetInnerHTML={{ __html: themeScript }}/>
    <TooltipProvider>
      <SidebarProvider defaultOpen={jar.get("sidebar_state")?.value !== "false"}>
        <AdminSidebar status={status} account={{ name: account.name, email: account.email }}/>
        <SidebarInset>
          <header className="sticky top-0 z-10 flex h-12 shrink-0 items-center gap-2 border-b bg-background/85 px-4 backdrop-blur supports-backdrop-filter:bg-background/70 md:px-6">
            <SidebarTrigger className="-ml-1" aria-label="Kenar çubuğunu aç/kapat"/>
            <Separator orientation="vertical" className="mr-1 data-[orientation=vertical]:h-4"/>
            <span className="text-sm font-medium text-muted-foreground">Yönetim paneli</span>
            <kbd className="ml-auto hidden rounded border bg-muted px-1.5 font-mono text-[11px] text-muted-foreground md:inline">⌘B</kbd>
          </header>
          <div className="mx-auto w-full max-w-[1320px] px-4 py-6 md:px-8 md:pb-16">{children}</div>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  </div>;
}
