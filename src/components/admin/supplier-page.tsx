import type { ReactNode } from "react";
import Link from "next/link";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { SupplierTabs } from "@/components/admin/supplier-tabs";

export type SupplierTab = "products" | "transfer";

/**
 * The one rule for the tab a supplier page opens on: the sync tab ("Senkronizasyon ve kalite" / "Yükleme ve kontrol")
 * when the page reports something to act on there (an `?error=`, or Manuel's open draft) or there is no data to
 * browse yet; otherwise the product list. A success notice (`?updated=1`) opens the products, which the refresh
 * redirect already filters to the refreshed group or brand.
 */
export function supplierInitialTab({ attention, hasData }: { attention: boolean; hasData: boolean }): SupplierTab {
  return attention || !hasData ? "transfer" : "products";
}

/**
 * Skeleton of every supplier page (Başbuğ, Dinamik, SETA, Manuel): breadcrumb, title and description, a badge slot on
 * the right (activity badge + FeedStatusBadge, or Manuel's template download), alerts, fact cards, then two tabs
 * [Ürünler, <syncLabel>]. Supplier-specific parts are passed in as slots.
 */
export function SupplierPage({ crumb, title, description, badge, alerts, facts, products, sync, tabsLabel, syncLabel, attention, hasData, tabKey = "" }: {
  /** Breadcrumb leaf, e.g. "Başbuğ". */
  crumb: string;
  title: string;
  description: ReactNode;
  badge?: ReactNode;
  alerts?: ReactNode;
  facts?: ReactNode;
  products: ReactNode;
  sync: ReactNode;
  tabsLabel: string;
  syncLabel?: string;
  attention: boolean;
  hasData: boolean;
  /** Changes when a redirect brings new state (error, update, draft) so the tabs reopen on the rule's tab. */
  tabKey?: string;
}) {
  const initialTab = supplierInitialTab({ attention, hasData });
  return <div className="flex flex-col gap-6">
    <div className="flex flex-col gap-2">
      <Breadcrumb><BreadcrumbList>
        <BreadcrumbItem><BreadcrumbLink render={<Link href="/yonetim"/>}>Yönetim</BreadcrumbLink></BreadcrumbItem><BreadcrumbSeparator/>
        <BreadcrumbItem><BreadcrumbLink render={<Link href="/yonetim/tedarikciler"/>}>Tedarikçiler</BreadcrumbLink></BreadcrumbItem><BreadcrumbSeparator/>
        <BreadcrumbItem><BreadcrumbPage>{crumb}</BreadcrumbPage></BreadcrumbItem>
      </BreadcrumbList></Breadcrumb>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="text-muted-foreground">{description}</p>
        </div>
        {badge}
      </div>
    </div>
    {alerts}
    {facts}
    <SupplierTabs key={`${initialTab}|${tabKey}`} label={tabsLabel} transferLabel={syncLabel} initialTab={initialTab} transfer={sync} products={products}/>
  </div>;
}

/** First card of every API supplier's sync tab: refresh one scope (or the whole list) now, and the automatic plan. */
export function SupplierSourceCard({ description, badge, schedule, children, footer }: {
  description: ReactNode;
  badge?: ReactNode;
  /** Plan lines read from supplier_sync_scopes (see scheduleLines). */
  schedule?: string[];
  children: ReactNode;
  footer?: ReactNode;
}) {
  return <Card>
    <CardHeader><CardTitle><h2>Kaynağı güncelle</h2></CardTitle><CardDescription>{description}</CardDescription>{badge && <CardAction>{badge}</CardAction>}</CardHeader>
    <CardContent className="flex flex-col gap-3">
      {children}
      {schedule && <p className="text-muted-foreground">Otomatik plan: {schedule.length ? schedule.join(" · ") : "kapsam tanımlı değil"}</p>}
    </CardContent>
    {footer && <CardFooter>{footer}</CardFooter>}
  </Card>;
}
