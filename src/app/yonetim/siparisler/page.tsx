import Link from "next/link";
import { ChevronLeft, ChevronRight, Inbox } from "lucide-react";
import { adminOrders, fitmentReturnReport, orderFilters, type OrderFilter } from "@/modules/admin/data";
import { fitmentLevelLabels, type FitmentLevel } from "@/modules/store/fitment-level";
import { normalizeSearchParams, type SearchParams } from "@/lib/search-params";
import { requireAdmin } from "@/modules/auth/session";
import { money } from "@/modules/store/catalog";
import { changeOrderStatus, recordRefund } from "@/modules/admin/commerce-actions";
import { OrderStatusBadge, PaymentStatusBadge } from "@/components/admin/order-badges";
import { AdminPage, AdminPageHeader, AdminPanel, AdminTabs, EmptyState, StatusMessage } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { PagerLink } from "@/components/admin/ui";
import { Card, CardFooter } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const time = (value: Date | string) => new Date(value).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const tabOrder: OrderFilter[] = ["all", "action", "shipping", "refund", "awaiting_payment", "shipped", "cancelled"];

export default async function Orders({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireAdmin();
  const params = normalizeSearchParams(await searchParams);
  const [{ orders, page, filter, counts }, fitment] = await Promise.all([adminOrders(params.page, params.status), fitmentReturnReport()]);
  const href = (changes: { status?: string; page?: number }) => {
    const query = new URLSearchParams();
    const status = changes.status ?? filter;
    if (status !== "all") query.set("status", status);
    if (changes.page && changes.page > 1) query.set("page", String(changes.page));
    return `/yonetim/siparisler${query.size ? `?${query}` : ""}`;
  };
  const shown = orders.slice(0, 50);
  return <AdminPage>
    <AdminPageHeader breadcrumbs={[{ label: "Yönetim", href: "/yonetim" }, { label: "Siparişler" }]} title="Siparişler"
      description="Ödemesi alınmış siparişlerde tedarikçi stokunu ve teslim süresini teyit ettikten sonra onayla. Stok yoksa iptal et; ödeme iadesini TAMI portalından yapıp referansı kaydet. Ödenmemiş siparişler süresi dolunca kendiliğinden iptal olur."/>
    {params.saved && <StatusMessage>Sipariş güncellendi.</StatusMessage>}
    {params.error && <StatusMessage tone="error">Bu değişikliğe izin verilmiyor. Listeyi yenileyin.</StatusMessage>}

    <Card className="gap-0 py-0">
      <AdminTabs label="Sipariş durumları" tabs={tabOrder.map(key => ({ href: href({ status: key }), label: orderFilters[key].label, count: counts[key], current: filter === key }))}/>
      {shown.length ? <Table>
        <TableHeader><TableRow><TableHead className="pl-4">Sipariş</TableHead><TableHead>Müşteri</TableHead><TableHead>Durum</TableHead><TableHead>Ödeme</TableHead><TableHead className="text-right">Tutar</TableHead><TableHead className="pr-4 text-right">İşlem</TableHead></TableRow></TableHeader>
        <TableBody>{shown.map(o => <TableRow key={o.id} className="align-top">
          <TableCell className="pl-4"><Link className="font-medium hover:text-primary hover:underline" href={`/siparis/${o.id}`}>#{o.number}</Link><div className="text-xs text-muted-foreground">{time(o.created_at)}</div></TableCell>
          <TableCell className="min-w-56 whitespace-normal">
            <div className="font-medium">{o.customer_name}</div><div className="text-xs text-muted-foreground">{o.email} · {o.phone}</div>
            <Collapsible className="mt-1">
              <CollapsibleTrigger className="group inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"><ChevronRight className="size-3.5 transition-transform group-data-panel-open:rotate-90" aria-hidden="true"/>Teslimat ve ödeme</CollapsibleTrigger>
              <CollapsibleContent>
                <dl className="mt-2 grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2">
                  <div><dt className="text-muted-foreground">Adres</dt><dd>{o.address}</dd></div>
                  {o.note && <div><dt className="text-muted-foreground">Not</dt><dd>{o.note}</dd></div>}
                  {o.payments.length > 0 && <div><dt className="text-muted-foreground">TAMI</dt><dd className="break-all">{o.payments.map(p => `${p.provider_order_id} (${p.status}${p.bank_reference ? ` · banka ref. ${p.bank_reference}` : ""})`).join(", ")}</dd></div>}
                  {o.paid_at && <div><dt className="text-muted-foreground">Ödeme zamanı</dt><dd>{time(o.paid_at)}</dd></div>}
                  {o.refund_reference && <div><dt className="text-muted-foreground">İade referansı</dt><dd>{o.refund_reference}</dd></div>}
                </dl>
              </CollapsibleContent>
            </Collapsible>
            {o.payment_note && <p className="mt-1 text-xs text-destructive">{o.payment_note}</p>}
          </TableCell>
          <TableCell><OrderStatusBadge status={o.status}/></TableCell>
          <TableCell><PaymentStatusBadge status={o.payment_status}/></TableCell>
          <TableCell className="text-right"><div className="font-medium tabular-nums">{money(Number(o.total_kurus))}</div>{Number(o.shipping_kurus) > 0 && <div className="text-xs text-muted-foreground tabular-nums">Kargo {money(Number(o.shipping_kurus))} dahil</div>}</TableCell>
          <TableCell className="pr-4">
            {["pending", "confirmed"].includes(o.status) && ["paid", "none"].includes(o.payment_status) && <form action={changeOrderStatus} className="flex justify-end gap-2">
              <input type="hidden" name="id" value={o.id}/>
              <NativeSelect size="sm" name="status" aria-label={`#${o.number} yeni durum`}>{o.status === "pending" ? <NativeSelectOption value="confirmed">Onayla</NativeSelectOption> : <NativeSelectOption value="shipped">Sevk edildi</NativeSelectOption>}<NativeSelectOption value="cancelled">{o.payment_status === "paid" ? "İptal et (iade gerekecek)" : "İptal et"}</NativeSelectOption></NativeSelect>
              <Button type="submit" size="sm">Uygula</Button>
            </form>}
            {o.payment_status === "refund_required" && <form action={recordRefund} className="flex justify-end gap-2">
              <input type="hidden" name="id" value={o.id}/>
              <Input className="h-7 w-40" name="reference" aria-label={`#${o.number} TAMI iade referansı`} placeholder="TAMI iade ref." minLength={3} maxLength={120} required/>
              <Button type="submit" size="sm">İade yapıldı</Button>
            </form>}
          </TableCell>
        </TableRow>)}</TableBody>
      </Table> : <EmptyState title={filter === "all" ? "Henüz sipariş yok" : "Bu durumda sipariş yok"} icon={<Inbox/>}>{filter !== "all" && <Link className="text-primary hover:underline" href={href({ status: "all" })}>Tüm siparişleri göster</Link>}</EmptyState>}
      {(page > 1 || orders.length > 50) && <CardFooter className="justify-between border-t py-3 text-sm text-muted-foreground"><span>Sayfa {page}</span><div className="flex gap-2">
        <PagerLink href={page > 1 ? href({ page: page - 1 }) : null}><ChevronLeft/>Önceki</PagerLink>
        <PagerLink href={orders.length > 50 ? href({ page: page + 1 }) : null}>Sonraki<ChevronRight/></PagerLink>
      </div></CardFooter>}
    </Card>

    {fitment.length > 0 && <AdminPanel title="Uyumluluk ve iadeler" description="İptal edilmemiş siparişlerin satırları, sipariş anındaki uyumluluk durumuna göre. İadeler sevk edilen siparişin sayfasından kaydedilir." flush>
      <Table><TableHeader><TableRow><TableHead className="pl-4">Uyumluluk</TableHead><TableHead className="text-right">Satır</TableHead><TableHead className="text-right">İade edilen</TableHead><TableHead className="pr-4 text-right">“Aracıma uymadı”</TableHead></TableRow></TableHeader>
        <TableBody>{fitment.map(row => <TableRow key={row.level}><TableCell className="pl-4">{row.level === "unrecorded" ? "Kayıt yok (eski sipariş)" : fitmentLevelLabels[row.level as FitmentLevel] ?? row.level}</TableCell><TableCell className="text-right tabular-nums">{row.lines}</TableCell><TableCell className="text-right tabular-nums">{row.returned}</TableCell><TableCell className="pr-4 text-right tabular-nums">{row.not_fit}</TableCell></TableRow>)}</TableBody></Table>
    </AdminPanel>}
  </AdminPage>;
}
