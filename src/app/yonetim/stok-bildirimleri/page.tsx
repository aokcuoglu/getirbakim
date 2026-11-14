import Link from "next/link";
import { BellRing, CircleAlert, CircleCheck, Clock, Info } from "lucide-react";
import { normalizeSearchParams, type SearchParams } from "@/lib/search-params";
import { requireAdmin } from "@/modules/auth/session";
import { money } from "@/modules/store/catalog";
import { loadRestockRequests, restockListLimit, type RestockTab } from "@/modules/admin/restock";
import { deleteRestockRequestAction, markRestockNotifiedAction } from "@/modules/admin/restock-actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const metadata = { title: "Stok bildirimleri | Getirbakim" };
const time = (value: Date | string) => new Date(value).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const tabs: { key: RestockTab; label: string }[] = [{ key: "pending", label: "Bekleyen" }, { key: "notified", label: "Bildirilen" }];

// "Gelince haber ver" requests (#475). The store sends no email yet: the admin tells the shopper and marks it here.
export default async function RestockRequests({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireAdmin();
  const params = normalizeSearchParams(await searchParams);
  const tab: RestockTab = params.tab === "notified" ? "notified" : "pending";
  const { rows, more, counts } = await loadRestockRequests(tab);
  const due = rows.filter(row => row.offer_id).length;
  return <div className="flex flex-col gap-6">
    <div className="flex flex-col gap-2">
      <Breadcrumb><BreadcrumbList>
        <BreadcrumbItem><BreadcrumbLink render={<Link href="/yonetim"/>}>Yönetim</BreadcrumbLink></BreadcrumbItem>
        <BreadcrumbSeparator/>
        <BreadcrumbItem><BreadcrumbPage>Stok bildirimleri</BreadcrumbPage></BreadcrumbItem>
      </BreadcrumbList></Breadcrumb>
      <h1 className="text-2xl font-semibold tracking-tight">Stok bildirimleri</h1>
      <p className="max-w-3xl text-muted-foreground">Tedarik edilemeyen ürünler için bırakılan &quot;Gelince haber ver&quot; talepleri. Mağaza e-posta göndermez: ürün yeniden satışa çıktığında müşteriye bir kez haber ver ve talebi bildirildi olarak işaretle. Bildirilen talepler 30 gün, bekleyenler 12 ay sonra kendiliğinden silinir.</p>
    </div>
    {params.saved && <Alert variant="success" role="status"><CircleCheck/><AlertDescription>{params.saved === "deleted" ? "Talep silindi." : "Talep bildirildi olarak işaretlendi."}</AlertDescription></Alert>}
    {params.error && <Alert variant="destructive"><CircleAlert/><AlertDescription>Talep güncellenemedi. Listeyi yenileyin.</AlertDescription></Alert>}
    {tab === "pending" && due > 0 && <Alert variant="info"><Info/><AlertDescription>{due} talebin ürünü yeniden satışta; müşteriye haber verip işaretle.</AlertDescription></Alert>}

    <Tabs value={tab}><ScrollArea className="pb-2">
      <TabsList variant="line" aria-label="Talep durumları">
        {tabs.map(({ key, label }) => <TabsTrigger key={key} value={key} nativeButton={false} render={<Link href={key === "pending" ? "/yonetim/stok-bildirimleri" : "/yonetim/stok-bildirimleri?tab=notified"} scroll={false}/>}>
          {label}<Badge variant="secondary" className="tabular-nums">{new Intl.NumberFormat("tr-TR").format(counts[key])}</Badge>
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
              {row.supplier_item_id ? <Link className="font-medium underline-offset-4 hover:underline" href={`/urun/${row.supplier_item_id}`} target="_blank">{row.brand} {row.name}</Link> : <span className="font-medium">{row.brand} {row.name}</span>}
              <div className="text-muted-foreground">{row.code}</div>
            </TableCell>
            <TableCell className="break-all">{row.email}</TableCell>
            <TableCell className="tabular-nums" value={new Date(row.notified_at ?? row.requested_at).toISOString()}>{time(row.notified_at ?? row.requested_at)}</TableCell>
            <TableCell>
              {row.status === "notified" ? <Badge variant="secondary"><CircleCheck data-icon="inline-start"/>Bildirildi</Badge>
                : row.offer_id ? <div className="flex flex-col items-start gap-1">
                  <Badge variant="success" render={<Link href={`/urun/${row.offer_id}`} target="_blank"/>}><CircleCheck data-icon="inline-start"/>Bildirilecek</Badge>
                  <span className="text-muted-foreground tabular-nums">{money(row.offer_price_kurus!)} · {row.offer_stock_label}</span>
                </div>
                : <Badge variant="outline"><Clock data-icon="inline-start"/>Tedarik bekleniyor</Badge>}
            </TableCell>
            <TableCell>
              <div className="flex justify-end gap-2">
                {row.status === "pending" && <form action={markRestockNotifiedAction}>
                  <input type="hidden" name="id" value={row.id}/>
                  <Button type="submit" variant={row.offer_id ? "default" : "outline"}><BellRing data-icon="inline-start"/>Bildirildi</Button>
                </form>}
                <form action={deleteRestockRequestAction}>
                  <input type="hidden" name="id" value={row.id}/><input type="hidden" name="tab" value={tab}/>
                  <Button type="submit" variant="ghost" aria-label={`${row.email} talebini sil`}>Sil</Button>
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
        {more && <p className="mt-4 text-muted-foreground">İlk {restockListLimit} talep gösteriliyor.</p>}
      </CardContent>
    </Card>
  </div>;
}
