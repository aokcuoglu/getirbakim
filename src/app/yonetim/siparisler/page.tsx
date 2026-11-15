import Link from "next/link";
import { ChevronLeft, ChevronRight, CircleAlert, CircleCheck, Inbox, Info, RefreshCw, TriangleAlert } from "lucide-react";
import { adminOrders, fitmentReturnReport, orderFilters, type OrderFilter } from "@/modules/admin/data";
import { fitmentLevelLabels, type FitmentLevel } from "@/modules/store/fitment-level";
import { normalizeSearchParams, type SearchParams } from "@/lib/search-params";
import { requireAdmin } from "@/modules/auth/session";
import { money } from "@/modules/store/catalog";
import { changeOrderStatus, checkTamiRefund, recordRefund } from "@/modules/admin/commerce-actions";
import { refundablePayments, refundKindLabel, refundStatusLabel, reversalKind, type RefundStatus } from "@/modules/payments/refund-rules";
import { carrierLabel } from "@/modules/store/shipment";
import { OrderShipmentDialog } from "@/components/admin/order-shipment-dialog";
import { OrderDeliveredDialog } from "@/components/admin/order-delivered-dialog";
import { OrderRefundDialog } from "@/components/admin/order-refund-dialog";
import { OrderLinesDialog } from "@/components/admin/order-lines-dialog";
import { supplierNames } from "@/modules/admin/products";
import { OrderStatusBadge, PaymentStatusBadge } from "@/components/admin/order-badges";
import { formatDateTime, formatNumber } from "@/modules/admin/format";
import { SubmitButton } from "@/components/admin/submit-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Pagination, PaginationContent, PaginationItem } from "@/components/ui/pagination";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const time = (value: Date | string) => formatDateTime(value, { year: true });
const refundBadge: Record<RefundStatus, { variant: "success" | "destructive" | "warning" | "info"; icon: typeof CircleCheck }> = {
  succeeded: { variant: "success", icon: CircleCheck }, failed: { variant: "destructive", icon: CircleAlert },
  unknown: { variant: "warning", icon: TriangleAlert }, requested: { variant: "info", icon: Info },
};
function RefundStatusBadge({ status }: { status: RefundStatus }) {
  const { variant, icon: Icon } = refundBadge[status];
  return <Badge variant={variant}><Icon data-icon="inline-start"/>{refundStatusLabel[status]}</Badge>;
}
const tabOrder: OrderFilter[] = ["all", "action", "shipping", "refund", "awaiting_payment", "shipped", "delivered", "cancelled"];

export default async function Orders({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireAdmin();
  const params = normalizeSearchParams(await searchParams);
  const [{ orders, page, filter, procurement, counts }, fitment] = await Promise.all([adminOrders(params.page, params.status, params, params.tedarik), fitmentReturnReport()]);
  const href = (changes: { status?: string; page?: number; procurement?: string }) => {
    const query = new URLSearchParams();
    const status = changes.status ?? filter;
    if (status !== "all") query.set("status", status);
    const tedarik = changes.procurement ?? procurement;
    if (tedarik !== "all") query.set("tedarik", tedarik);
    if (params.sort) query.set("sort", params.sort);
    if (params.dir) query.set("dir", params.dir);
    if (changes.page && changes.page > 1) query.set("page", String(changes.page));
    return `/yonetim/siparisler${query.size ? `?${query}` : ""}`;
  };
  const shown = orders.slice(0, 50);
  // Actions return to this tab, sort and page.
  const back = href({ page });
  return <div className="flex flex-col gap-6">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex min-w-0 max-w-3xl flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Siparişler</h1>
        <p className="text-muted-foreground">Ödemesi alınmış siparişlerde tedarikçi stokunu ve teslim süresini teyit ettikten sonra onayla. Stok yoksa iptal et; ödemeyi buradan TAMI ile iade et (TAMI&apos;ye ulaşılamazsa iadeyi portaldan yapıp referansı elle kaydet). Ödenmemiş siparişler süresi dolunca kendiliğinden iptal olur. Tedarik sütunundan kalemlerin tedarikçisini, deposunu ve maliyetini görüp tedarik durumunu işaretle.</p>
      </div>
    </div>
    {params.saved && <Alert variant="success" role="status"><CircleCheck aria-hidden="true"/><AlertDescription>Sipariş güncellendi.</AlertDescription></Alert>}
    {params.error && <Alert variant="destructive" role="alert"><CircleAlert aria-hidden="true"/><AlertDescription>Bu değişikliğe izin verilmiyor. Listeyi yenileyin.</AlertDescription></Alert>}
    {params.refunded && <Alert variant="success" role="status"><CircleCheck aria-hidden="true"/><AlertDescription>TAMI iadeyi onayladı; sipariş güncellendi.</AlertDescription></Alert>}
    {params.refund_void_failed && <Alert variant="destructive" role="alert"><CircleAlert aria-hidden="true"/><AlertDescription>TAMI iptali reddetti (hata kodu siparişin İadeler satırında). Tekrar &quot;TAMI&apos;den iade et&quot; derseniz iade olarak gönderilir.</AlertDescription></Alert>}
    {params.refund_failed && <Alert variant="destructive" role="alert"><CircleAlert aria-hidden="true"/><AlertDescription>TAMI iadeyi reddetti; ayrıntı siparişin İadeler satırında. Sorunu giderip yeniden deneyebilirsiniz.</AlertDescription></Alert>}
    {params.refund_unknown && <Alert variant="warning" role="alert"><TriangleAlert aria-hidden="true"/><AlertDescription>TAMI yanıtı doğrulanamadı. TAMI&apos;de kontrol edin; iade görünüyorsa &quot;TAMI&apos;de kontrol et&quot; ile sonucu alın ya da referansı elle kaydedin.</AlertDescription></Alert>}
    {params.refund_unavailable && <Alert variant="destructive" role="alert"><CircleAlert aria-hidden="true"/><AlertDescription>TAMI ayarları eksik; TAMI&apos;ye istek gönderilmedi. Teknik ekibe bildirin; acilse iadeyi TAMI portalından yapıp referansı elle kaydedin.</AlertDescription></Alert>}
    {params.refund_busy && <Alert variant="info" role="status"><Info aria-hidden="true"/><AlertDescription>Bu ödeme için başka bir TAMI isteği sürüyor veya sonucu bekleniyor. Listeyi yenileyip sonucu kontrol edin.</AlertDescription></Alert>}

    <Tabs value={filter}><ScrollArea className="pb-2">
      <TabsList variant="line" aria-label="Sipariş durumları">
        {tabOrder.map(key => <TabsTrigger key={key} value={key} nativeButton={false} render={<Link href={href({ status: key })} scroll={false}/>}>
          {orderFilters[key].label}<Badge variant="secondary" className="tabular-nums">{formatNumber(counts[key])}</Badge>
        </TabsTrigger>)}
      </TabsList>
      <ScrollBar orientation="horizontal"/>
    </ScrollArea></Tabs>

    <Card>
      <CardContent>
        {shown.length ? <Table server>
          <TableHeader><TableRow><TableHead sortKey="created">Sipariş</TableHead><TableHead sortKey="customer">Müşteri</TableHead>
            <TableHead filter={{ param: "status", options: tabOrder.filter(key => key !== "all").map(key => ({ value: key, label: orderFilters[key].label })) }}>Durum</TableHead><TableHead filter={{ param: "tedarik", options: [{ value: "open", label: "Tedarik bekleyen" }, { value: "done", label: "Tedariki tamam" }] }}>Tedarik</TableHead><TableHead>Ödeme</TableHead><TableHead sortKey="total" className="text-right">Tutar</TableHead><TableHead className="text-right">İşlem</TableHead></TableRow></TableHeader>
          <TableBody>{shown.map(o => {
            const refundable = refundablePayments(o, o.payments, o.refunds);
            const pendingRefunds = o.refunds.filter(r => r.status === "requested" || r.status === "unknown");
            return <TableRow key={o.id} className="align-top">
            <TableCell><Link className="font-medium underline-offset-4 hover:underline" href={`/siparis/${o.id}`}>#{o.number}</Link><div className="text-muted-foreground">{time(o.created_at)}</div></TableCell>
            <TableCell className="min-w-56 whitespace-normal">
              <div className="font-medium">{o.customer_name}</div><div className="text-muted-foreground">{o.email} · {o.phone}</div>
              <Accordion><AccordionItem value="details">
                <AccordionTrigger>Teslimat ve ödeme</AccordionTrigger>
                <AccordionContent>
                  <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                    <div><dt className="text-muted-foreground">Adres</dt><dd>{o.address}</dd></div>
                    {o.note && <div><dt className="text-muted-foreground">Not</dt><dd>{o.note}</dd></div>}
                    {o.payments.length > 0 && <div><dt className="text-muted-foreground">TAMI</dt><dd className="break-all">{o.payments.map(p => `${p.provider_order_id} (${p.status}${p.bank_reference ? ` · banka ref. ${p.bank_reference}` : ""})`).join(", ")}</dd></div>}
                    {o.paid_at && <div><dt className="text-muted-foreground">Ödeme zamanı</dt><dd>{time(o.paid_at)}</dd></div>}
                    {o.refund_reference && <div><dt className="text-muted-foreground">İade referansı</dt><dd className="break-all">{o.refund_reference}</dd></div>}
                    {o.refunded_at && <div><dt className="text-muted-foreground">İade zamanı</dt><dd>{time(o.refunded_at)}</dd></div>}
                    {o.refunds.length > 0 && <div className="sm:col-span-2"><dt className="text-muted-foreground">İadeler</dt>
                      <div className="flex flex-col gap-2">{o.refunds.map(r => <dd key={r.id} className="flex flex-col items-start gap-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span>TAMI {refundKindLabel[r.kind].toLocaleLowerCase("tr-TR")} · {r.provider_order_id} · <span className="tabular-nums">{money(Number(r.amount_kurus))}</span></span>
                          <RefundStatusBadge status={r.status}/>
                        </span>
                        <span className="text-muted-foreground">{time(r.completed_at ?? r.requested_at)}{r.bank_reference ? ` · banka ref. ${r.bank_reference}` : ""}</span>
                        {(r.error_code || r.error_message) && <span className="break-all text-muted-foreground">{r.error_code ? `Hata ${r.error_code}: ` : ""}{r.error_message}</span>}
                      </dd>)}</div>
                    </div>}
                    {["shipped", "delivered"].includes(o.status) && <div className="sm:col-span-2"><dt className="text-muted-foreground">Kargo</dt>
                      {o.carrier ? <dd className="flex flex-col gap-1">
                        <span className="break-all">{carrierLabel(o.carrier, o.carrier_name)} · {o.tracking_no}</span>
                        {o.tracking_url && <a className="w-fit underline-offset-4 hover:underline" href={o.tracking_url} target="_blank" rel="noopener noreferrer">Kargoyu takip et<span className="sr-only"> (yeni sekmede açılır)</span></a>}
                      </dd> : o.status === "delivered" ? <dd className="text-muted-foreground">Bu sipariş için kargo bilgisi kayıtlı değil.</dd>
                        : <dd><Badge variant="warning"><TriangleAlert data-icon="inline-start"/>Kargo bilgisi girilmedi</Badge></dd>}
                      {o.shipped_at && <dd className="text-muted-foreground">Kargoya veriliş: {time(o.shipped_at)}</dd>}
                      {o.delivered_at && <dd className="text-muted-foreground">Teslim: {time(o.delivered_at)}</dd>}
                    </div>}
                    <div className="sm:col-span-2"><dt className="text-muted-foreground">Sözleşme onayı</dt>
                      {o.agreement_at ? <dd className="flex flex-col items-start gap-2">
                        <Badge variant="success"><CircleCheck data-icon="inline-start"/>Sözleşme onaylandı</Badge>
                        <span>{time(o.agreement_at)} · IP {o.agreement_ip ?? "kaydedilmedi"} · Sürüm {o.agreement_version}</span>
                        <span className="break-all text-muted-foreground">{o.agreement_user_agent ?? "Tarayıcı bilgisi yok"}</span>
                        <Button variant="outline" size="sm" nativeButton={false} render={<Link href={`/siparis/${o.id}/sozlesme`}/>}>Sözleşme kopyası</Button>
                      </dd> : <dd><Badge variant="warning"><TriangleAlert data-icon="inline-start"/>Onay kaydı yok</Badge></dd>}
                    </div>
                  </dl>
                </AccordionContent>
              </AccordionItem></Accordion>
              {o.payment_note && <p className="mt-1 text-destructive">{o.payment_note}</p>}
            </TableCell>
            <TableCell><OrderStatusBadge status={o.status}/></TableCell>
            <TableCell><OrderLinesDialog number={o.number} orderId={o.id} orderStatus={o.status}
              editable={["pending", "confirmed"].includes(o.status) && ["paid", "none"].includes(o.payment_status)}
              lines={o.lines.map(line => ({ ...line, supplier_label: supplierNames[line.supplier] ?? line.supplier }))}/></TableCell>
            <TableCell><PaymentStatusBadge status={o.payment_status}/></TableCell>
            <TableCell className="text-right"><div className="font-medium tabular-nums">{money(Number(o.total_kurus))}</div>{Number(o.shipping_kurus) > 0 && <div className="text-muted-foreground tabular-nums">Kargo {money(Number(o.shipping_kurus))} dahil</div>}</TableCell>
            <TableCell>
              {["pending", "confirmed"].includes(o.status) && ["paid", "none"].includes(o.payment_status) && <div className="flex flex-wrap justify-end gap-2">
                {o.status === "confirmed" && <OrderShipmentDialog orderId={o.id} number={o.number} back={back} mode="ship"/>}
                <form action={changeOrderStatus} className="flex justify-end gap-2">
                  <input type="hidden" name="id" value={o.id}/>
                  <input type="hidden" name="back" value={back}/>
                  <NativeSelect name="status" aria-label={`#${o.number} yeni durum`}>{o.status === "pending" && <NativeSelectOption value="confirmed">Onayla</NativeSelectOption>}<NativeSelectOption value="cancelled">{o.payment_status === "paid" ? "İptal et (iade gerekecek)" : "İptal et"}</NativeSelectOption></NativeSelect>
                  <SubmitButton>Uygula</SubmitButton>
                </form>
              </div>}
              {o.status === "shipped" && ["paid", "none"].includes(o.payment_status) && <div className="flex flex-wrap justify-end gap-2">
                <OrderDeliveredDialog orderId={o.id} number={o.number} back={back}/>
                <OrderShipmentDialog orderId={o.id} number={o.number} back={back} mode="edit"
                  initial={{ carrier: o.carrier, carrierName: o.carrier_name, trackingNo: o.tracking_no, trackingUrl: o.tracking_url }}/>
              </div>}
              {(refundable.length > 0 || pendingRefunds.length > 0) && <div className="mt-2 flex flex-col items-end gap-2">
                {refundable.map(p => <OrderRefundDialog key={p.id} orderId={o.id} number={o.number} paymentId={p.id} providerOrderId={p.provider_order_id}
                  amountKurus={Number(p.amount_kurus)} kind={reversalKind(p.paid_at, o.refunds.filter(r => r.payment_id === p.id))}
                  several={o.payments.filter(x => x.status === "succeeded").length > 1} orderPaid={o.payment_status === "paid"} back={back}/>)}
                {pendingRefunds.map(r => <form key={r.id} action={checkTamiRefund} className="flex flex-wrap items-center justify-end gap-2">
                  <input type="hidden" name="refund" value={r.id}/>
                  <input type="hidden" name="order" value={o.id}/>
                  <input type="hidden" name="back" value={back}/>
                  <RefundStatusBadge status={r.status}/>
                  <SubmitButton variant="outline" aria-label={`#${o.number} ${r.provider_order_id} iadesini TAMI'de kontrol et`} pendingLabel="Sorgulanıyor…"
                    icon={<RefreshCw data-icon="inline-start" aria-hidden="true"/>}>TAMI&apos;de kontrol et</SubmitButton>
                </form>)}
              </div>}
              {o.payment_status === "refund_required" && <form action={recordRefund} className="mt-2 flex justify-end gap-2">
                <input type="hidden" name="id" value={o.id}/>
                <input type="hidden" name="back" value={back}/>
                <Input className="w-40" name="reference" aria-label={`#${o.number} elle TAMI iade referansı`} placeholder="Elle: TAMI iade ref." minLength={3} maxLength={120} required/>
                <SubmitButton variant="outline">İade yapıldı</SubmitButton>
              </form>}
            </TableCell>
          </TableRow>;
          })}</TableBody>
        </Table> : <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon"><Inbox/></EmptyMedia>
            <EmptyTitle>{filter === "all" && procurement === "all" ? "Henüz sipariş yok" : "Bu filtrede sipariş yok"}</EmptyTitle>
            {(filter !== "all" || procurement !== "all") && <EmptyDescription>Başka bir durum sekmesi seçebilir, tedarik filtresini kaldırabilir veya tüm siparişlere dönebilirsin.</EmptyDescription>}
          </EmptyHeader>
          {(filter !== "all" || procurement !== "all") && <EmptyContent><Button variant="outline" nativeButton={false} render={<Link href={href({ status: "all", procurement: "all" })}/>}>Tüm siparişleri göster</Button></EmptyContent>}
        </Empty>}
      </CardContent>
      {(page > 1 || orders.length > 50) && <CardFooter className="justify-between gap-4">
        <span className="text-muted-foreground">Sayfa {page}</span>
        <Pagination aria-label="Sayfalar" className="mx-0 w-auto"><PaginationContent>
          <PaginationItem>{page > 1 ? <Button variant="ghost" aria-label="Önceki sayfa" nativeButton={false} render={<Link href={href({ page: page - 1 })} scroll={false}/>}><ChevronLeft data-icon="inline-start" aria-hidden="true"/>Önceki</Button> : <Button variant="ghost" aria-label="Önceki sayfa" disabled><ChevronLeft data-icon="inline-start" aria-hidden="true"/>Önceki</Button>}</PaginationItem>
          <PaginationItem>{orders.length > 50 ? <Button variant="ghost" aria-label="Sonraki sayfa" nativeButton={false} render={<Link href={href({ page: page + 1 })} scroll={false}/>}>Sonraki<ChevronRight data-icon="inline-end" aria-hidden="true"/></Button> : <Button variant="ghost" aria-label="Sonraki sayfa" disabled>Sonraki<ChevronRight data-icon="inline-end" aria-hidden="true"/></Button>}</PaginationItem>
        </PaginationContent></Pagination>
      </CardFooter>}
    </Card>

    {fitment.length > 0 && <Card>
      <CardHeader>
        <CardTitle>Uyumluluk ve iadeler</CardTitle>
        <CardDescription>İptal edilmemiş siparişlerin satırları, sipariş anındaki uyumluluk durumuna göre. İadeler kargoya verilen veya teslim edilen siparişin sayfasından kaydedilir.</CardDescription>
      </CardHeader>
      <CardContent>
        <Table controls={false}><TableHeader><TableRow><TableHead>Uyumluluk</TableHead><TableHead className="text-right">Satır</TableHead><TableHead className="text-right">İade edilen</TableHead><TableHead className="text-right">“Aracıma uymadı”</TableHead></TableRow></TableHeader>
          <TableBody>{fitment.map(row => <TableRow key={row.level}><TableCell>{row.level === "unrecorded" ? "Kayıt yok (eski sipariş)" : fitmentLevelLabels[row.level as FitmentLevel] ?? row.level}</TableCell><TableCell className="text-right tabular-nums">{row.lines}</TableCell><TableCell className="text-right tabular-nums">{row.returned}</TableCell><TableCell className="text-right tabular-nums">{row.not_fit}</TableCell></TableRow>)}</TableBody></Table>
      </CardContent>
    </Card>}
  </div>;
}
