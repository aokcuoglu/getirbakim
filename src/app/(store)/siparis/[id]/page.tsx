import type { Metadata } from "next";
import { privatePageRobots } from "@/modules/seo/crawlers";
import { currentOrder, orderRefundedKurus } from "@/modules/store/order-read";
import Link from "next/link";
import { notFound } from "next/navigation";
import { normalizeSearchParams, type SearchParams } from "@/lib/search-params";
import { money } from "@/modules/store/catalog";
import { orderStatus, paymentStatus } from "@/modules/store/orders";
import { INTERACTIVE_RECONCILE_MS, paymentsEnabled, reconcileOrderPayments } from "@/modules/payments/checkout";
import { PaymentWatcher } from "@/components/payment-watcher";
import { PayButton } from "@/components/pay-button";
import { CancelOrderButton } from "@/components/cancel-order-button";
import { PAYMENT_NOTICE, paymentErrors } from "@/modules/payments/messages";
import { currentAccount } from "@/modules/auth/session";
import { orderReturns } from "@/modules/admin/data";
import { supplierNames } from "@/modules/admin/products";
import { snapshotNotes } from "@/modules/admin/order-supplier-note";
import { recordReturn } from "@/modules/admin/commerce-actions";
import { garageVehicleLabel, parseGarageVehicle } from "@/modules/store/garage";
import { fitmentLevelLabels } from "@/modules/store/fitment-level";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { CircleAlert, CircleCheck, Clock, Undo2 } from "lucide-react";
import { OrderProgress } from "@/components/order-progress";
import { TrackPurchase } from "@/components/privacy/track-commerce";
import { purchaseEventOpen } from "@/modules/analytics/purchase";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";
import { returnReasonLabels, returnReasons, type ReturnReason } from "@/modules/store/returns";
import { carrierLabel } from "@/modules/store/shipment";
import { catalogPath } from "@/modules/seo/paths";

const eyebrow="mb-2 block text-[11px] leading-[18px] font-medium tracking-[1.2px] text-muted-foreground max-[600px]:text-[10px]";
const noticeBox="rounded-md border-0 bg-[#eaf1f7] p-[15px] text-sm leading-5 text-[#50718e]";
const errorBox="rounded-md border-0 bg-[#fff0ec] p-3.5 text-sm leading-5 text-[#a74130]";
const muted="text-sm leading-[22px] text-muted-foreground";
const panel="rounded-2xl border border-border bg-white p-[25px] text-sm max-[600px]:p-5";
const panelTitle="text-[23px] leading-[34px] font-semibold";
const panelText="text-[13px] leading-[1.7]";
const panelMuted="text-[13px] leading-[1.7] text-muted-foreground";

// Outcomes of the customer cancel action (#607); "tamam" needs none, the order's own notice says it.
const cancelMessages:Record<string,{text:string;error:boolean}>={
  odendi:{text:"Ödemen bu sırada alındı, bu yüzden sipariş iptal edilmedi. Yine de vazgeçmek istersen aşağıdan iptal edebilirsin; ödemen iade edilir.",error:false},
  dogrulanamadi:{text:"Ödeme durumunu şu anda doğrulayamadık; sipariş iptal edilmedi. Birkaç dakika sonra yeniden dene.",error:true},
  kapali:{text:"Bu sipariş artık buradan iptal edilemiyor. Onaylanmış ya da kargoya verilmiş siparişler için bizimle iletişime geç.",error:true},
  hata:{text:"İptal işlemi tamamlanamadı. Yeniden dene.",error:true},
};

const time=(value:Date)=>new Date(value).toLocaleString("tr-TR",{timeZone:"Europe/Istanbul"});

export const metadata: Metadata = { robots: privatePageRobots };
export default async function Order({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<SearchParams>}) {
  const [{id},query]=await Promise.all([params,searchParams.then(normalizeSearchParams)]);
  let result=await currentOrder(id);
  if(!result) notFound();
  if(result.order.payment_status==="awaiting" && query.odeme==="sonuc") {
    // Back from TAMI: the callback has normally reconciled already; this bounded check covers a slow callback.
    // Other views never wait on TAMI while rendering; PaymentWatcher checks once after the page is shown (#711).
    try { await reconcileOrderPayments(id,{minIntervalSeconds:5,deadlineMs:INTERACTIVE_RECONCILE_MS}); result=await currentOrder(id) ?? result; }
    catch(error) { console.error("Order page payment reconciliation failed",{id,error:error instanceof Error ? error.message : error}); }
  }
  const {order,items,agreement,mine}=result;
  const account=await currentAccount();
  const admin=Boolean(account?.approved && account.role==="admin");
  const returns=admin ? await orderReturns(order.id) : [];
  const refundedKurus=order.payment_status==="refunded" && order.refunded_at ? await orderRefundedKurus(order.id) ?? Number(order.total_kurus) : 0;
  const snapshotNoteTexts=admin ? snapshotNotes(items.map(item=>({code:item.code,supplierLabel:item.supplier ? supplierNames[item.supplier] ?? item.supplier : null,snapshot:item.pricing_snapshot}))) : [];
  const awaiting=order.status==="awaiting_payment" && order.payment_status==="awaiting";
  // Only the order's own customer cancels, and only before operations confirm it (#607).
  const pendingCancel=mine && order.status==="pending" && ["paid","none"].includes(order.payment_status);
  const awaitingCancel=mine && awaiting;
  const total=money(Number(order.total_kurus));
  const cancelButton=(expected:"awaiting_payment"|"pending")=><CancelOrderButton orderId={order.id} number={order.number} expected={expected} total={total} paid={order.payment_status==="paid"}/>;
  const returned=query.odeme==="sonuc",created=query.odeme==="yeni";
  const shipment=order.status==="shipped" || order.status==="delivered";
  // Shipment outranks the payment notes: shipped and delivered orders are paid (or legacy offline) orders.
  const notice=order.status==="delivered" ? "Siparişin teslim edildi."
    : order.status==="shipped" ? `Siparişin kargoya verildi.${order.tracking_no ? " Kargo takibi bölümünden izleyebilirsin." : ""}`
    : order.payment_status==="paid"
    ? (order.status==="pending" ? "Ödemen alındı. Stok ve fiyat teyidi bitince siparişini hazırlayacağız. Teyit edilemezse ödemenin tamamı iade edilir." : `Ödemen alındı. Sipariş durumu: ${orderStatus[order.status]}.`)
    : awaiting ? (returned ? "Ödemeni henüz doğrulayamadık. İşlemi tamamladıysan birkaç dakika içinde güncellenir; tamamlamadıysan yeniden deneyebilirsin."
      : created ? "Siparişin oluşturuldu. Ödemeyi kartla tamamla; güvenli ödeme penceresi bu sayfanın üzerinde açılır." : "Siparişin oluşturuldu, ödemeni bekliyoruz.")
    : order.payment_status==="expired" ? "Ödeme süresi içinde tamamlanmadığı için sipariş iptal edildi. Kartından tahsilat yapılmadı."
    : order.payment_status==="refund_required" && order.cancelled_by==="customer" ? "Siparişini iptal ettin. Ödemenin iadesini ekibimiz başlatacak; tamamlandığında bu sayfada görünür."
    : order.payment_status==="cancelled" ? "Siparişini iptal ettin. Kartından tahsilat yapılmadı."
    : order.payment_status==="refund_required" ? "Sipariş iptal edildi. Ödemenin iadesi başlatılacak."
    : order.payment_status==="refunded" ? (order.refunded_at
      ? `Sipariş iptal edildi; ${money(refundedKurus)} tutarındaki ödemen ${new Date(order.refunded_at).toLocaleDateString("tr-TR",{timeZone:"Europe/Istanbul"})} tarihinde iade edildi. Kartına yansıması bankana göre birkaç iş günü sürebilir.`
      : "Sipariş iptal edildi ve ödemen iade edildi. İadenin kartına yansıması bankana göre birkaç iş günü sürebilir.")
    : order.status==="pending" ? "Siparişin alındı. Fiyat, stok ve sevkiyat için seninle iletişime geçeceğiz. Henüz ödeme alınmadı." : `Sipariş durumu: ${orderStatus[order.status]}.`;
  const payNow=awaiting && paymentsEnabled();
  const error=query.odeme ? paymentErrors[query.odeme] ?? null : null;
  // An order already cancelled (expiry, operations) needs no "cannot cancel" message: its notice explains it.
  // "odendi" invites a cancel from the button below, so it shows only while that button does.
  const hiddenCancelMessage=(query.iptal==="kapali" && order.status==="cancelled") || (query.iptal==="odendi" && !pendingCancel && !awaitingCancel);
  const cancelMessage=query.iptal && !hiddenCancelMessage ? cancelMessages[query.iptal] ?? null : null;
  const date=new Date(order.created_at);
  const metaDate=`${date.toLocaleDateString("tr-TR",{day:"numeric",month:"long",year:"numeric",timeZone:"Europe/Istanbul"})}, ${date.toLocaleTimeString("tr-TR",{hour:"2-digit",minute:"2-digit",timeZone:"Europe/Istanbul"})}`;
  const PaymentIcon=order.payment_status==="paid" ? CircleCheck : order.payment_status==="awaiting" ? Clock : order.payment_status==="refunded" || order.payment_status==="refund_required" ? Undo2 : CircleAlert;
  const row="flex items-baseline justify-between gap-4";
  const value="m-0 text-right tabular-nums";
  const trackUrl=shipment && order.tracking_url;
  const cancelAction=pendingCancel ? cancelButton("pending") : awaitingCancel ? cancelButton("awaiting_payment") : null;
  return <section className="mx-auto min-h-[55vh] w-full max-w-[1280px] px-8 pt-7 pb-14 max-[600px]:px-5 max-[600px]:pt-6 max-[600px]:pb-10"><p className={eyebrow}>SİPARİŞ #{order.number}</p><h1 className="mb-2 text-[32px] leading-[42px] font-semibold tracking-[-0.7px] wrap-anywhere max-[600px]:text-[27px] max-[600px]:leading-[35px]">{orderStatus[order.status]}</h1>
    <p className={cn(muted,"mb-5")}><time dateTime={date.toISOString()}>{metaDate}</time>{order.discount_percent>0 && ` · %${order.discount_percent} servis indirimi`}</p>
    <OrderProgress order={order}/>{mine && !admin && order.payment_status==="paid" && purchaseEventOpen(order.paid_at,new Date()) && <TrackPurchase orderId={order.id}/>}
    {error && <Alert className={cn(errorBox,"mb-3")}>{error}</Alert>}
    {admin && query.iade==="kaydedildi" && <Alert role="status" className={cn(noticeBox,"mb-3")}>İade kaydedildi.</Alert>}
    {admin && query.iade==="hata" && <Alert className={cn(errorBox,"mb-3")}>İade kaydedilemedi: sipariş sevk ya da teslim edilmemiş veya adet sipariş edilenden fazla.</Alert>}
    {cancelMessage && <Alert role={cancelMessage.error ? "alert" : "status"} className={cn(cancelMessage.error ? errorBox : noticeBox,"mb-3")}>{cancelMessage.text}</Alert>}
    <Card className={cn(panel,"mb-6 gap-3 ring-0")}>
      <p role="status" className="m-0 text-[15px] leading-6">{notice}</p>
      {payNow && <PayButton orderId={order.id} total={total}/>}
      {payNow && <p className={panelMuted}>{PAYMENT_NOTICE}{order.payment_due_at && <><br/>Son ödeme zamanı: <time dateTime={new Date(order.payment_due_at).toISOString()}>{time(order.payment_due_at)}</time></>}</p>}
      {trackUrl && <Button nativeButton={false} className="h-auto min-h-12 w-full gap-2.5 rounded-lg px-5 py-3 text-sm leading-5 font-medium hover:bg-brand-strong" render={<a href={order.tracking_url ?? undefined} target="_blank" rel="noopener noreferrer"/>}>Kargoyu takip et<span className="sr-only"> (yeni sekmede açılır)</span></Button>}
      {cancelAction && <div className="flex flex-wrap items-center gap-x-3 border-t border-border pt-3">{pendingCancel && <p className={cn(muted,"m-0")}>Teyitten önce siparişini iptal edebilirsin.</p>}{cancelAction}</div>}
    </Card>
    {order.payment_status==="awaiting" && <PaymentWatcher orderId={order.id} state={`${order.status}:${order.payment_status}`}/>}
    <div className="mb-8 flex flex-col gap-6 min-[601px]:grid min-[601px]:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] min-[601px]:items-start">
      <div className="min-w-0 max-[600px]:contents"><Card className={cn(panel,"min-w-0 gap-0 ring-0 max-[600px]:order-2")}><h2 className={panelTitle}>Sipariş ürünleri</h2>{items.map(p=><div key={p.product_id} className="flex items-start justify-between gap-6 border-b border-border py-4 last:border-b-0 wrap-anywhere max-[600px]:flex-col max-[600px]:gap-2"><div className="min-w-0"><strong className="font-semibold">{p.name}</strong><p className={panelMuted}>{p.code} · {p.quantity} adet × {money(Number(p.unit_price_kurus))}</p>
        {admin && p.pricing_snapshot?.checkout_mode==="snapshot" && typeof p.pricing_snapshot.observed_at==="string" && <small className="text-sm leading-[22px] text-muted-foreground">Tedarikçi anlık görüntüsü: {time(new Date(p.pricing_snapshot.observed_at))}</small>}
        {(()=>{ const vehicle=parseGarageVehicle(p.vehicle); return vehicle && <p className={panelMuted}>Araç: {garageVehicleLabel(vehicle)}</p>; })()}
        {admin && p.fitment_level && <p className={panelMuted}>Uyumluluk (sipariş anında): {fitmentLevelLabels[p.fitment_level]}</p>}
        {admin && returns.filter(r=>r.product_id===p.product_id).map(r=><p key={r.id} className={panelMuted}>İade: {r.quantity} adet · {returnReasonLabels[r.reason as ReturnReason] ?? r.reason}{r.note ? ` · ${r.note}` : ""} · {time(r.created_at)}</p>)}
        {admin && shipment && <form action={recordReturn} className="mt-3 flex flex-wrap items-end gap-2.5"><input type="hidden" name="orderId" value={order.id}/><input type="hidden" name="productId" value={p.product_id}/>
          <Input className="h-10 w-[85px] bg-white" name="quantity" type="number" min={1} max={p.quantity} defaultValue={1} aria-label="İade adedi" required/>
          <NativeSelect className="[&>select]:h-10 [&>select]:bg-white" name="reason" aria-label="İade nedeni" defaultValue="not_fit">{returnReasons.map(reason=><NativeSelectOption key={reason} value={reason}>{returnReasonLabels[reason]}</NativeSelectOption>)}</NativeSelect>
          <Input className="h-10 min-w-[140px] flex-1 bg-white" name="note" maxLength={500} placeholder="Not (isteğe bağlı)" aria-label="İade notu"/><Button type="submit" className="h-10 px-4 hover:bg-brand-strong">İade kaydet</Button></form>}
      </div><strong className="shrink-0 font-semibold tabular-nums">{money(Number(p.unit_price_kurus)*p.quantity)}</strong></div>)}
      {snapshotNoteTexts.map(text=><p key={text} className={cn(muted,"mt-3")}>{text}</p>)}
      </Card></div>
      <div className="flex min-w-0 flex-col gap-6 max-[600px]:contents">
        <Card className={cn(panel,"min-w-0 gap-3 ring-0 max-[600px]:order-1")}><h2 className={panelTitle}>Ödeme özeti</h2>
          <dl className="m-0 grid gap-2.5 text-sm leading-5">
            <div className={row}><dt>Ürün toplamı</dt><dd className={value}>{money(Number(order.subtotal_kurus))}</dd></div>
            {order.discount_percent>0 && <div className={row}><dt>Servis indirimi</dt><dd className={value}>%{order.discount_percent} uygulandı</dd></div>}
            <div className={row}><dt>Kargo</dt><dd className={value}>{Number(order.shipping_kurus) ? money(Number(order.shipping_kurus)) : order.payment_status==="none" ? "Teyitte belirlenir" : "Ücretsiz"}</dd></div>
            <div className={cn(row,"text-base font-semibold")}><dt>Toplam <small className="font-normal text-muted-foreground">(KDV dahil)</small></dt><dd className={cn(value,"text-lg")}>{total}</dd></div>
          </dl>
          <Separator/>
          <dl className="m-0 grid gap-2.5 text-sm leading-5">
            <div className={row}><dt>Ödeme durumu</dt><dd className="m-0 flex items-center gap-1.5 text-right"><PaymentIcon className="size-4 shrink-0" aria-hidden/>{paymentStatus[order.payment_status]}</dd></div>
            {order.paid_at && <div className={row}><dt>Ödeme zamanı</dt><dd className={value}>{time(order.paid_at)}</dd></div>}
            {order.payment_status==="refunded" && order.refunded_at && <div className={row}><dt>İade</dt><dd className={value}>İade edilen: {money(refundedKurus)}, {new Date(order.refunded_at).toLocaleDateString("tr-TR",{timeZone:"Europe/Istanbul"})}</dd></div>}
          </dl>
          {order.payment_status==="paid" && <p className={cn(panelMuted,"m-0")}>Ödeme TAMI güvenli ödeme sayfasında kartla alındı.</p>}
        </Card>
        <Card className={cn(panel,"min-w-0 gap-1 ring-0 max-[600px]:order-3")}><h2 className={panelTitle}>Teslimat bilgileri</h2><p className={panelText}>{order.customer_name}</p><p className={panelText}>{order.email} · {order.phone}</p><p className={cn(panelText,"whitespace-pre-wrap wrap-anywhere")}>{order.address}</p>{order.note && <p className={panelText}>Not: {order.note}</p>}</Card>
        {shipment && <Card className={cn(panel,"min-w-0 gap-1 ring-0 max-[600px]:order-4")}><h2 className={panelTitle}>Kargo takibi</h2>
          {order.carrier ? <><p className={panelText}>{carrierLabel(order.carrier,order.carrier_name)}</p>{order.tracking_no && <p className={cn(panelText,"wrap-anywhere")}>Takip no: <strong className="font-semibold">{order.tracking_no}</strong></p>}
            {!order.tracking_url && <p className={panelMuted}>Takip numarasıyla kargo firmasının sitesinden sorgulayabilirsin.</p>}</>
            : <p className={panelMuted}>{order.status==="delivered" ? "Bu sipariş için kargo bilgisi kayıtlı değil." : "Kargo bilgisi henüz eklenmedi."}</p>}
          {order.shipped_at && <p className={panelMuted}>Kargoya veriliş: {time(order.shipped_at)}</p>}
          {order.delivered_at && <p className={panelMuted}>Teslim: {time(order.delivered_at)}</p>}</Card>}
        {agreement && <Card className={cn(panel,"min-w-0 gap-1 ring-0 max-[600px]:order-5")}><h2 className={panelTitle}>Sözleşmeler</h2><p className={panelText}>Ön bilgilendirme formunu ve mesafeli satış sözleşmesini {time(agreement.accepted_at)} tarihinde onayladın.</p><Link href={`/siparis/${order.id}/sozlesme`} className="mt-1 inline-flex min-h-11 items-center gap-1.5 text-sm leading-5 font-medium text-primary hover:underline">Sözleşme kopyasını görüntüle<span aria-hidden>→</span></Link></Card>}
      </div>
    </div>
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3 max-[600px]:flex-col-reverse max-[600px]:items-stretch">{mine && <Link href="/siparisler" className="inline-flex min-h-11 items-center text-sm leading-5 font-medium text-primary hover:underline">← Siparişlerime dön</Link>}<Button variant="outline" nativeButton={false} className="h-auto min-h-12 gap-2.5 rounded-lg border-input bg-white px-5 py-3 text-sm leading-5 font-medium text-foreground hover:bg-muted" render={<Link href={catalogPath}/>}>Alışverişe devam et</Button></div>
  </section>;
}
