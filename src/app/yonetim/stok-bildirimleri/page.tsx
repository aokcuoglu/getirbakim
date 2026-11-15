import Link from "next/link";
import { BellRing, CircleAlert, CircleCheck, Clock, Info } from "lucide-react";
import { normalizeSearchParams, type SearchParams } from "@/lib/search-params";
import { requireAdmin } from "@/modules/auth/session";
import { money } from "@/modules/store/catalog";
import { loadRestockRequests, restockListLimit, type RestockTab } from "@/modules/admin/restock";
import { deleteRestockRequestAction, markRestockNotifiedAction } from "@/modules/admin/restock-actions";
import { formatDateTime, formatNumber } from "@/modules/admin/format";
import { StatusBadge } from "@/components/admin/status-badge";
import { SubmitButton } from "@/components/admin/submit-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { productIdPath } from "@/modules/seo/product-id";

export const metadata = { title: "Stok bildirimleri" };
const tabs: { key: RestockTab; label: string }[] = [{ key: "pending", label: "Bekleyen" }, { key: "notified", label: "Bildirilen" }];

// "Gelince haber ver" requests (#475). The store sends no email yet: the admin tells the shopper and marks it here.
export default async function RestockRequests({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireAdmin();
  const params = normalizeSearchParams(await searchParams);
  const tab: RestockTab = params.tab === "notified" ? "notified" : "pending";
  const { rows, more, counts } = await loadRestockRequests(tab);
  const due = rows.filter(row => row.offer_id).length;
  return <div className="flex flex-col gap-6">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex min-w-0 max-w-3xl flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Stok bildirimleri</h1>
        <p className="text-muted-foreground">Tedarik edilemeyen ürünler için bırakılan &quot;Gelince haber ver&quot; talepleri. Mağaza e-posta göndermez: ürün yeniden satışa çıktığında müşteriye bir kez haber ver ve talebi bildirildi olarak işaretle. Bildirilen talepler 30 gün, bekleyenler 12 ay sonra kendiliğinden silinir.</p>
      </div>
    </div>
    {params.saved && <Alert variant="success" role="status"><CircleCheck aria-hidden="true"/><AlertDescription>{params.saved === "deleted" ? "Talep silindi." : "Talep bildirildi olarak işaretlendi."}</AlertDescription></Alert>}
    {params.error && <Alert variant="destructive" role="alert"><CircleAlert aria-hidden="true"/><AlertDescription>Talep güncellenemedi. Listeyi yenileyin.</AlertDescription></Alert>}
    {tab === "pending" && due > 0 && <Alert variant="info"><Info aria-hidden="true"/><AlertDescription>{formatNumber(due)} talebin ürünü yeniden satışta; müşteriye haber verip işaretle.</AlertDescription></Alert>}

    <Tabs value={tab}><ScrollArea className="pb-2">
      <TabsList variant="line" aria-label="Talep durumları">
        {tabs.map(({ key, label }) => <TabsTrigger key={key} value={key} nativeButton={false} render={<Link href={key === "pending" ? "/yonetim/stok-bildirimleri" : "/yonetim/stok-bildirimleri?tab=notified"} scroll={false}/>}>
          {label}<Badge variant="secondary" className="tabular-nums">{formatNumber(counts[key])}</Badge>
        </TabsTrigger>)}
      </TabsList>
      <ScrollBar orientation="horizontal"/>
    </ScrollArea></Tabs>

    <Card>
      <CardContent>
        {rows.length ? <Table>
          <TableHeader><TableRow><TableHead>Ürün</TableHead><TableHead>E-posta</TableHead><TableHead>{tab === "pending" ? "Talep" : "Bildirim"}</TableHead><TableHead>Durum</TableHead><TableHead className="text-right">İşlem</TableHead></TableRow></TableHeader>
          <TableBody>{rows.map(row => <TableRow key={row.id} className="align-top">
            <TableCell className="min-w-56 whitespace-normal">
              {row.supplier_item_id ? <Link className="font-medium underline-offset-4 hover:underline" href={productIdPath(row.supplier_item_id)} target="_blank">{row.brand} {row.name}</Link> : <span className="font-medium">{row.brand} {row.name}</span>}
              <div className="text-muted-foreground">{row.code}</div>
            </TableCell>
            <TableCell className="break-all">{row.email}</TableCell>
            <TableCell className="tabular-nums" value={new Date(row.notified_at ?? row.requested_at).toISOString()}>{formatDateTime(row.notified_at ?? row.requested_at, { year: true })}</TableCell>
            <TableCell>
              {row.status === "notified" ? <StatusBadge tone="neutral" icon={CircleCheck}>Bildirildi</StatusBadge>
                : row.offer_id ? <div className="flex flex-col items-start gap-1">
                  <StatusBadge tone="success" render={<Link href={productIdPath(row.offer_id)} target="_blank"/>}>Bildirilecek</StatusBadge>
                  <span className="text-muted-foreground tabular-nums">{money(row.offer_price_kurus)} · {row.offer_stock_label}</span>
                </div>
                : <StatusBadge tone="neutral" icon={Clock}>Tedarik bekleniyor</StatusBadge>}
            </TableCell>
            <TableCell>
              <div className="flex justify-end gap-2">
                {row.status === "pending" && <form action={markRestockNotifiedAction}>
                  <input type="hidden" name="id" value={row.id}/>
                  <SubmitButton variant={row.offer_id ? "default" : "outline"} icon={<BellRing data-icon="inline-start" aria-hidden="true"/>}>Bildirildi</SubmitButton>
                </form>}
                <form action={deleteRestockRequestAction}>
                  <input type="hidden" name="id" value={row.id}/><input type="hidden" name="tab" value={tab}/>
                  <SubmitButton variant="ghost" aria-label={`${row.email} talebini sil`}>Sil</SubmitButton>
                </form>
              </div>
            </TableCell>
          </TableRow>)}</TableBody>
        </Table> : <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon"><BellRing/></EmptyMedia>
            <EmptyTitle>{tab === "pending" ? "Bekleyen talep yok" : "Bildirilen talep yok"}</EmptyTitle>
            <EmptyDescription>{tab === "pending" ? "Müşteriler tedarik edilemeyen ürünlerin sayfasından talep bırakabilir." : "Bildirildi olarak işaretlenen talepler 30 gün burada kalır."}</EmptyDescription>
          </EmptyHeader>
        </Empty>}
        {more && <p className="mt-4 text-muted-foreground">İlk {formatNumber(restockListLimit)} talep gösteriliyor.</p>}
      </CardContent>
    </Card>
  </div>;
}
