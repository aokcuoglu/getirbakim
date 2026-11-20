import Link from "next/link";
import { ChevronLeft, ChevronRight, CircleAlert, CircleCheck, FileText, Inbox, Info, RefreshCw, TriangleAlert } from "lucide-react";
import { adminOrders, fitmentReturnReport, orderFilters, type AdminGeliverShipment, type OrderFilter } from "@/modules/admin/data";
import { fitmentLevelLabels, type FitmentLevel } from "@/modules/store/fitment-level";
import { normalizeSearchParams, type SearchParams } from "@/lib/search-params";
import { requireAdmin } from "@/modules/auth/session";
import { money } from "@/modules/store/catalog";
import { changeOrderStatus, checkGeliverShipment, checkTamiRefund, decideCancelRequest, recordRefund } from "@/modules/admin/commerce-actions";
import { refundablePayments, refundKindLabel, refundStatusLabel, reversalKind, type RefundStatus } from "@/modules/payments/refund-rules";
import { carrierLabel } from "@/modules/store/shipment";
import { isHandledPayment } from "@/modules/store/payment-states";
import { OrderShipmentDialog, type GeliverOption } from "@/components/admin/order-shipment-dialog";
import { geliverConfig } from "@/modules/shipping/geliver";
import { mailConfig } from "@/lib/mail";
import { OrderEmails } from "@/components/admin/order-emails";
import {
  geliverErrorMessage, geliverTestBlocked, geliverTestBlockedMessage, recipientBlockLabel, recipientOf, trackingLook, type GeliverMode, type RecipientOrder,
} from "@/modules/shipping/geliver-request";
import { StatusBadge } from "@/components/admin/status-badge";
import { OrderDeliveryDetails, OrderRecipient } from "@/components/admin/order-address";
import { OrderDeliveredDialog } from "@/components/admin/order-delivered-dialog";
import { OrderRefundDialog } from "@/components/admin/order-refund-dialog";
import { OrderLinesDialog } from "@/components/admin/order-lines-dialog";
import { supplierNames } from "@/modules/admin/products";
import { orderLineView } from "@/modules/admin/order-procurement";
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
/** The ship dialog's Geliver tab (#960): hidden without a Geliver token, else the mode or why this order cannot get a label. */
function geliverOption(mode: GeliverMode | null, order: RecipientOrder & { geliver: AdminGeliverShipment | null }): GeliverOption | undefined {
  if (!mode) return undefined;
  if (geliverTestBlocked(process.env)) return { blocked: geliverTestBlockedMessage, tone: "warning" };
  if (order.geliver?.status === "requested" || order.geliver?.status === "unknown") {
    return { blocked: "Önceki etiket isteğinin sonucu bekleniyor; önce \"Geliver'de kontrol et\" ile sonucu alın.", tone: "info" };
  }
  if (order.geliver?.status === "purchased") {
    return { blocked: "Bu sipariş için Geliver etiketi zaten alınmış; Geliver panelinden kontrol edin.", tone: "info" };
  }
  const recipient = recipientOf(order);
  return recipient.ok ? { mode } : { blocked: recipientBlockLabel[recipient.reason], tone: "warning" };
}
function LabelLink({ url, number }: { url: string; number: string }) {
  return <Button variant="outline" size="sm" nativeButton={false} render={<a href={url} target="_blank" rel="noopener noreferrer"/>}>
    <FileText data-icon="inline-start" aria-hidden="true"/>Etiketi aç (PDF)<span className="sr-only"> #{number}, yeni sekmede açılır</span>
  </Button>;
}
// The resend outcome carries the order number (#1035); digits only, else the alert stays generic.
const emailOrder = (value: string) => /^\d+$/.test(value) ? `#${value} siparişinin` : "Siparişin";
const tabOrder: OrderFilter[] = ["all", "action", "shipping", "cancel_request", "refund", "awaiting_payment", "shipped", "delivered", "cancelled"];

export default async function Orders({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireAdmin();
  const params = normalizeSearchParams(await searchParams);
  const geliverMode = geliverConfig()?.mode ?? null;
  const mailReady = mailConfig().kind !== "none";
  const [{ orders, page, filter, procurement, owner, counts }, fitment] = await Promise.all([adminOrders(params.page, params.status, params, params.tedarik, params.sahip), fitmentReturnReport()]);
  const href = (changes: { status?: string; page?: number; procurement?: string; owner?: string }) => {
    const query = new URLSearchParams();
    const status = changes.status ?? filter;
    if (status !== "all") query.set("status", status);
    const tedarik = changes.procurement ?? procurement;
    if (tedarik !== "all") query.set("tedarik", tedarik);
    const sahip = changes.owner ?? owner;
    if (sahip !== "all") query.set("sahip", sahip);
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
        <p className="text-muted-foreground">Ödemesi alınmış siparişlerde tedarikçi stokunu ve teslim süresini teyit ettikten sonra onayla. Stok yoksa iptal et; ödemeyi buradan TAMI ile iade et (TAMI&apos;ye ulaşılamazsa iadeyi portaldan yapıp referansı elle kaydet). Ödenmemiş siparişler süresi dolunca kendiliğinden iptal olur. Müşteri, ödenmemiş ya da henüz onaylanmamış siparişini kendisi iptal edebilir; ödenmiş olanlar &quot;İade bekleyen&quot; sekmesine düşer. Tedarik sütunundan kalemlerin tedarikçisini, deposunu ve maliyetini görüp tedarik durumunu işaretle. Partner (API) siparişleri cari hesaba yazılır; partner onaylanmış bir siparişi iptal etmek isterse &quot;İptal talebi&quot; sekmesine düşer, onaylayana ya da reddedene kadar kargoya verilemez.</p>
      </div>
    </div>
    {params.saved && <Alert variant="success" role="status"><CircleCheck aria-hidden="true"/><AlertDescription>Sipariş güncellendi.</AlertDescription></Alert>}
    {params.error && <Alert variant="destructive" role="alert"><CircleAlert aria-hidden="true"/><AlertDescription>Bu değişikliğe izin verilmiyor. Listeyi yenileyin.</AlertDescription></Alert>}
    {params.refunded && <Alert variant="success" role="status"><CircleCheck aria-hidden="true"/><AlertDescription>TAMI iadeyi onayladı; sipariş güncellendi.</AlertDescription></Alert>}
    {params.refund_void_failed && <Alert variant="destructive" role="alert"><CircleAlert aria-hidden="true"/><AlertDescription>TAMI iptali reddetti (hata kodu siparişin İadeler satırında). Tekrar &quot;TAMI&apos;den iade et&quot; derseniz iade olarak gönderilir.</AlertDescription></Alert>}
    {params.refund_failed && <Alert variant="destructive" role="alert"><CircleAlert aria-hidden="true"/><AlertDescription>TAMI iadeyi reddetti; ayrıntı siparişin İadeler satırında. Sorunu giderip yeniden deneyebilirsiniz.</AlertDescription></Alert>}
    {params.refund_unknown && <Alert variant="warning" role="alert"><TriangleAlert aria-hidden="true"/><AlertDescription>TAMI yanıtı doğrulanamadı. TAMI&apos;de kontrol edin; iade görünüyorsa &quot;TAMI&apos;de kontrol et&quot; ile sonucu alın ya da referansı elle kaydedin.</AlertDescription></Alert>}
    {params.refund_unavailable && <Alert variant="destructive" role="alert"><CircleAlert aria-hidden="true"/><AlertDescription>TAMI ayarları eksik; TAMI&apos;ye istek gönderilmedi. Teknik ekibe bildirin; acilse iadeyi TAMI portalından yapıp referansı elle kaydedin.</AlertDescription></Alert>}
    {params.label_created && <Alert variant="success" role="status"><CircleCheck aria-hidden="true"/><AlertDescription>Geliver etiketi oluşturuldu; sipariş kargoya verildi. Etiketi siparişin İşlem sütunundan açıp yazdırın.</AlertDescription></Alert>}
    {params.label_unknown && <Alert variant="warning" role="alert"><TriangleAlert aria-hidden="true"/><AlertDescription>Geliver yanıtı doğrulanamadı; etiket alınmış olabilir. Birkaç dakika içinde siparişteki &quot;Geliver&apos;de kontrol et&quot; ile sonucu alın; o zamana kadar yeni etiket istenemez.</AlertDescription></Alert>}
    {params.label_failed && <Alert variant="destructive" role="alert"><CircleAlert aria-hidden="true"/><AlertDescription>Geliver etiketi oluşturulamadı; ayrıntı siparişin İşlem sütununda. Yeniden deneyebilir ya da elle sevk edebilirsiniz.</AlertDescription></Alert>}
    {params.label_orphan && <Alert variant="warning" role="alert"><TriangleAlert aria-hidden="true"/><AlertDescription>{/^\d+$/.test(params.label_orphan) ? `#${params.label_orphan} siparişinin Geliver etiketi` : "Geliver etiketi"} alındı ama sipariş durumu değişmişti; etiketi Geliver panelinden iptal edin.</AlertDescription></Alert>}
    {params.label_held && <Alert variant="warning" role="alert"><TriangleAlert aria-hidden="true"/><AlertDescription>{/^\d+$/.test(params.label_held) ? `#${params.label_held} siparişinin Geliver etiketi` : "Geliver etiketi"} alındı ama partnerin iptal talebi karar bekliyor. Talebi reddederseniz sipariş bu etiketle kargoya verilir; onaylarsanız etiketi Geliver panelinden iptal edin.</AlertDescription></Alert>}
    {params.label_busy && <Alert variant="info" role="status"><Info aria-hidden="true"/><AlertDescription>Bu sipariş için başka bir Geliver isteği sürüyor veya sonucu bekleniyor. Listeyi yenileyip sonucu kontrol edin.</AlertDescription></Alert>}
    {params.email_sent && <Alert variant="success" role="status"><CircleCheck aria-hidden="true"/><AlertDescription>{emailOrder(params.email_sent)} e-postası gönderildi. Ayrıntı siparişin &quot;Teslimat ve ödeme&quot; bölümündeki E-posta satırında.</AlertDescription></Alert>}
    {params.email_skipped && <Alert variant="warning" role="alert"><TriangleAlert aria-hidden="true"/><AlertDescription>{emailOrder(params.email_skipped)} e-postası gönderilmedi. Nedenini görmek için siparişin &quot;Teslimat ve ödeme&quot; bölümünü açın (E-posta satırı).</AlertDescription></Alert>}
    {params.email_pending && <Alert variant="info" role="status"><Info aria-hidden="true"/><AlertDescription>{emailOrder(params.email_pending)} e-postası şu an gönderilemedi ya da sırada; sistem kendiliğinden yeniden dener. Son hata için siparişin &quot;Teslimat ve ödeme&quot; bölümünü açın (E-posta satırı).</AlertDescription></Alert>}
    {params.email_busy && <Alert variant="info" role="status"><Info aria-hidden="true"/><AlertDescription>{emailOrder(params.email_busy)} e-postası şu an gönderiliyor ya da artık gönderilemez; siparişin &quot;Teslimat ve ödeme&quot; bölümündeki E-posta satırına bakın.</AlertDescription></Alert>}
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
          <TableHeader><TableRow><TableHead sortKey="created">Sipariş</TableHead><TableHead sortKey="customer" filter={{ param: "sahip", options: [{ value: "partner", label: "Partner" }, { value: "store", label: "Mağaza" }] }}>Müşteri</TableHead>
            <TableHead filter={{ param: "status", options: tabOrder.filter(key => key !== "all").map(key => ({ value: key, label: orderFilters[key].label })) }}>Durum</TableHead><TableHead filter={{ param: "tedarik", options: [{ value: "open", label: "Tedarik bekleyen" }, { value: "done", label: "Tedarik edilen" }] }}>Tedarik</TableHead><TableHead>Ödeme</TableHead><TableHead sortKey="total" className="text-right">Tutar</TableHead><TableHead className="text-right">İşlem</TableHead></TableRow></TableHeader>
          <TableBody>{shown.map(o => {
            const refundable = refundablePayments(o, o.payments, o.refunds);
            const pendingRefunds = o.refunds.filter(r => r.status === "requested" || r.status === "unknown");
            const lines = o.lines.map(line => orderLineView(line, supplierNames[line.supplier] ?? line.supplier));
            // A cancelled order whose supplier lines were already ordered or procured needs the supplier order checked (#607).
            const supplierOrdered = o.status === "cancelled" && lines.some(line => line.needsProcurement && line.procurement_status !== "pending");
            const partner = o.owner_kind === "partner";
            // A partner's undecided cancel request (#426): operations approve or reject it before the order may ship.
            const cancelRequest = o.status === "confirmed" && o.cancel_requested_at !== null && o.cancel_request_rejected_at === null;
            return <TableRow key={o.id} className="align-top">
            <TableCell><Link className="font-medium underline-offset-4 hover:underline" href={`/siparis/${o.id}`}>#{o.number}</Link><div className="text-muted-foreground">{time(o.created_at)}</div></TableCell>
            <TableCell className="min-w-56 whitespace-normal">
              <div className="flex flex-col items-start gap-1">
                {partner && <Badge variant="outline">Partner · {o.owner_id}</Badge>}
                <div className="font-medium">{o.customer_name}</div>
              </div>
              <div className="text-muted-foreground">{[o.email, o.phone].filter(Boolean).join(" · ")}</div>
              <Accordion><AccordionItem value="details">
                <AccordionTrigger>Teslimat ve ödeme</AccordionTrigger>
                <AccordionContent>
                  <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                    <OrderDeliveryDetails order={o}/>
                    {o.note && <div><dt className="text-muted-foreground">Not</dt><dd>{o.note}</dd></div>}
                    {partner && o.status === "delivered" && <div><dt className="text-muted-foreground">Partner faturası</dt><dd className="break-all">{o.partner_invoice_ref && o.partner_invoiced_at
                      ? `${o.partner_invoice_ref} · ${new Date(o.partner_invoiced_at).toLocaleDateString("tr-TR", { timeZone: "Europe/Istanbul" })}${o.partner_invoiced_by_name ? ` · işaretleyen ${o.partner_invoiced_by_name}` : ""}`
                      : "Faturalanmadı (limitte sayılıyor)"}</dd></div>}
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
                        <span className="break-all">{carrierLabel(o.carrier, o.carrier_name)} · {o.tracking_no ?? "Takip numarası bekleniyor"}</span>
                        {o.tracking_url && <a className="w-fit underline-offset-4 hover:underline" href={o.tracking_url} target="_blank" rel="noopener noreferrer">Kargoyu takip et<span className="sr-only"> (yeni sekmede açılır)</span></a>}
                      </dd> : o.status === "delivered" ? <dd className="text-muted-foreground">Bu sipariş için kargo bilgisi kayıtlı değil.</dd>
                        : <dd><Badge variant="warning"><TriangleAlert data-icon="inline-start"/>Kargo bilgisi girilmedi</Badge></dd>}
                      {o.geliver?.status === "purchased" && <dd className="flex flex-col items-start gap-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <StatusBadge tone={trackingLook(o.geliver.tracking_status_code, o.geliver.tracking_sub_status_code).tone}>
                            {trackingLook(o.geliver.tracking_status_code, o.geliver.tracking_sub_status_code).label}
                          </StatusBadge>
                          {o.geliver.test && <Badge variant="outline">Test etiketi</Badge>}
                        </span>
                        {(o.geliver.tracking_status_details || o.geliver.tracking_location || o.geliver.tracking_status_at) && <span className="text-muted-foreground">
                          {[o.geliver.tracking_status_details, o.geliver.tracking_location, o.geliver.tracking_status_at && time(o.geliver.tracking_status_at)].filter(Boolean).join(" · ")}
                        </span>}
                        {o.geliver.barcode && <span className="tabular-nums">Geliver barkodu {o.geliver.barcode}</span>}
                      </dd>}
                      {o.shipped_at && <dd className="text-muted-foreground">Kargoya veriliş: {time(o.shipped_at)}</dd>}
                      {o.delivered_at && <dd className="text-muted-foreground">Teslim: {time(o.delivered_at)}</dd>}
                    </div>}
                    <OrderEmails order={o} emails={o.emails} back={back} mailReady={mailReady}/>
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
            <TableCell><div className="flex flex-col items-start gap-1">
              <OrderStatusBadge status={o.status}/>
              {o.status === "cancelled" && o.cancelled_by === "customer" && <>
                <Badge variant="info"><Info data-icon="inline-start"/>{partner ? "Partner iptal etti" : "Müşteri iptal etti"}</Badge>
                {o.cancelled_at && <span className="text-muted-foreground tabular-nums">{time(o.cancelled_at)}</span>}
              </>}
              {cancelRequest && <>
                <Badge variant="warning"><TriangleAlert data-icon="inline-start"/>İptal talebi</Badge>
                {o.cancel_requested_at && <span className="text-muted-foreground tabular-nums">{time(o.cancel_requested_at)}</span>}
                {o.geliver?.status === "purchased" && <Badge variant="info"><Info data-icon="inline-start"/>Geliver etiketi alındı, karar bekliyor</Badge>}
              </>}
              {o.cancel_request_rejected_at && o.status !== "cancelled" && <Badge variant="secondary"><Info data-icon="inline-start"/>İptal talebi reddedildi</Badge>}
              {supplierOrdered && <Badge variant="warning"><TriangleAlert data-icon="inline-start"/>Tedarikçiye sipariş verilmişti</Badge>}
            </div></TableCell>
            <TableCell><OrderLinesDialog number={o.number} orderId={o.id} orderStatus={o.status}
              editable={["pending", "confirmed"].includes(o.status) && isHandledPayment(o.payment_status)}
              lines={lines}/></TableCell>
            <TableCell><PaymentStatusBadge status={o.payment_status}/></TableCell>
            <TableCell className="text-right"><div className="font-medium tabular-nums">{money(Number(o.total_kurus))}</div>{Number(o.shipping_kurus) > 0 && <div className="text-muted-foreground tabular-nums">Kargo {money(Number(o.shipping_kurus))} dahil</div>}
              {Number(o.installment_fee_kurus) > 0 && <div className="text-muted-foreground tabular-nums">Vade farkı {money(Number(o.installment_fee_kurus))} · {o.installment_count} taksit</div>}
              {o.payments.some(p => p.status === "succeeded" && Number.isInteger(p.installment_count) && p.installment_count! >= 1 && p.installment_count !== o.installment_count)
                && <Badge variant="warning" className="mt-1" title="Ödenen taksit sayısı siparişten farklı"><TriangleAlert data-icon="inline-start"/>Taksit sayısı farklı<span className="sr-only">: ödenen taksit sayısı siparişten farklı</span></Badge>}</TableCell>
            <TableCell>
              {cancelRequest && isHandledPayment(o.payment_status) && <div className="flex flex-wrap justify-end gap-2">
                <form action={decideCancelRequest}>
                  <input type="hidden" name="id" value={o.id}/>
                  <input type="hidden" name="decision" value="approve"/>
                  <input type="hidden" name="back" value={back}/>
                  <SubmitButton variant="destructive" aria-label={`#${o.number}: İptali onayla (partner iptal talebi)`}>İptali onayla</SubmitButton>
                </form>
                <form action={decideCancelRequest}>
                  <input type="hidden" name="id" value={o.id}/>
                  <input type="hidden" name="decision" value="reject"/>
                  <input type="hidden" name="back" value={back}/>
                  <SubmitButton variant="outline" aria-label={`#${o.number}: Talebi reddet (partner iptal talebi)`}>Talebi reddet</SubmitButton>
                </form>
              </div>}
              {!cancelRequest && ["pending", "confirmed"].includes(o.status) && isHandledPayment(o.payment_status) && <div className="flex flex-wrap justify-end gap-2">
                {o.status === "confirmed" && <OrderShipmentDialog orderId={o.id} number={o.number} back={back} mode="ship" recipient={<OrderRecipient order={o}/>}
                  geliver={geliverOption(geliverMode, o)}/>}
                <form action={changeOrderStatus} className="flex justify-end gap-2">
                  <input type="hidden" name="id" value={o.id}/>
                  <input type="hidden" name="back" value={back}/>
                  <NativeSelect name="status" aria-label={`#${o.number} yeni durum`}>{o.status === "pending" && <NativeSelectOption value="confirmed">Onayla</NativeSelectOption>}<NativeSelectOption value="cancelled">{o.payment_status === "paid" ? "İptal et (iade gerekecek)" : o.payment_status === "on_account" ? "İptal et (iade yok, cari hesap)" : "İptal et"}</NativeSelectOption></NativeSelect>
                  <SubmitButton>Uygula</SubmitButton>
                </form>
              </div>}
              {(o.geliver?.status === "requested" || o.geliver?.status === "unknown") && <form action={checkGeliverShipment} className="mt-2 flex flex-wrap items-center justify-end gap-2">
                <input type="hidden" name="shipment" value={o.geliver.id}/>
                <input type="hidden" name="order" value={o.id}/>
                <input type="hidden" name="back" value={back}/>
                <Badge variant="warning"><TriangleAlert data-icon="inline-start"/>Geliver etiketi doğrulanamadı</Badge>
                <SubmitButton variant="outline" aria-label={`#${o.number} Geliver etiketini Geliver'de kontrol et`} pendingLabel="Sorgulanıyor…"
                  icon={<RefreshCw data-icon="inline-start" aria-hidden="true"/>}>Geliver&apos;de kontrol et</SubmitButton>
              </form>}
              {o.status === "confirmed" && o.geliver?.status === "failed" && <div className="mt-2 flex flex-col items-end gap-1 text-right">
                <Badge variant="destructive"><CircleAlert data-icon="inline-start"/>Geliver etiketi oluşturulamadı</Badge>
                <span className="text-muted-foreground">{o.geliver.error_code ? geliverErrorMessage(o.geliver.error_code, o.geliver.error_message)
                  : "Geliver'de etiket alınamadı; yeniden deneyebilir ya da Elle giriş sekmesinden kargoya verebilirsiniz."}</span>
              </div>}
              {o.status === "delivered" && o.geliver?.status === "purchased" && o.geliver.label_url && <div className="flex justify-end">
                <LabelLink url={o.geliver.label_url} number={o.number}/>
              </div>}
              {o.status === "shipped" && isHandledPayment(o.payment_status) && <div className="flex flex-wrap justify-end gap-2">
                {o.geliver?.status === "purchased" && o.geliver.label_url && <LabelLink url={o.geliver.label_url} number={o.number}/>}
                <OrderDeliveredDialog orderId={o.id} number={o.number} back={back}/>
                <OrderShipmentDialog orderId={o.id} number={o.number} back={back} mode="edit" recipient={<OrderRecipient order={o}/>}
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
            <EmptyTitle>{filter === "all" && procurement === "all" && owner === "all" ? "Henüz sipariş yok" : "Bu filtrede sipariş yok"}</EmptyTitle>
            {(filter !== "all" || procurement !== "all" || owner !== "all") && <EmptyDescription>Başka bir durum sekmesi seçebilir, tedarik filtresini kaldırabilir veya tüm siparişlere dönebilirsin.</EmptyDescription>}
          </EmptyHeader>
          {(filter !== "all" || procurement !== "all" || owner !== "all") && <EmptyContent><Button variant="outline" nativeButton={false} render={<Link href={href({ status: "all", procurement: "all", owner: "all" })}/>}>Tüm siparişleri göster</Button></EmptyContent>}
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
