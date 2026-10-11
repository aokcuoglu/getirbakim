import { currentOrder } from "@/modules/store/order-read";
import Link from "next/link";
import { notFound } from "next/navigation";
import { normalizeSearchParams, type SearchParams } from "@/lib/search-params";
import { money } from "@/modules/store/catalog";
import { orderStatus, paymentStatus } from "@/modules/store/orders";
import { paymentsEnabled, reconcileOrderPayments } from "@/modules/payments/checkout";
import { PaymentWatcher } from "@/components/payment-watcher";
import { PayButton } from "@/components/pay-button";
import { paymentErrors } from "@/modules/payments/messages";
import { currentAccount } from "@/modules/auth/session";
import { orderReturns } from "@/modules/admin/data";
import { recordReturn } from "@/modules/admin/commerce-actions";
import { garageVehicleLabel, parseGarageVehicle } from "@/modules/store/garage";
import { fitmentLevelLabels } from "@/modules/store/fitment-level";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";
import { returnReasonLabels, returnReasons, type ReturnReason } from "@/modules/store/returns";

const eyebrow="mb-2 block text-[11px] leading-[18px] font-medium tracking-[1.2px] text-muted-foreground max-[600px]:text-[10px]";
const title="mb-5 text-[32px] leading-[42px] font-semibold tracking-[-0.7px] wrap-anywhere max-[600px]:text-[27px] max-[600px]:leading-[35px]";
const noticeBox="rounded-md border-0 bg-[#eaf1f7] p-[15px] text-sm leading-5 text-[#50718e]";
const errorBox="rounded-md border-0 bg-[#fff0ec] p-3.5 text-sm leading-5 text-[#a74130]";
const muted="text-sm leading-[22px] text-muted-foreground";
const panel="rounded-2xl border border-border bg-white p-[25px] text-sm max-[600px]:p-5";
const panelTitle="text-[23px] leading-[34px] font-semibold";
const panelText="text-[13px] leading-[1.7]";
const panelMuted="text-[13px] leading-[1.7] text-muted-foreground";
const cta="h-auto min-h-12 gap-2.5 rounded-lg border-primary px-[27px] py-[13px] text-sm leading-5 font-medium hover:bg-brand-strong";

const time=(value:Date)=>new Date(value).toLocaleString("tr-TR",{timeZone:"Europe/Istanbul"});

export default async function Order({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<SearchParams>}) {
  const [{id},query]=await Promise.all([params,searchParams.then(normalizeSearchParams)]);
  let result=await currentOrder(id);
  if(!result) notFound();
  if(result.order.payment_status==="awaiting") {
    // The customer may land here before TAMI's callback; ask the provider directly.
    try { await reconcileOrderPayments(id,{minIntervalSeconds:5}); result=await currentOrder(id) ?? result; }
    catch(error) { console.error("Order page payment reconciliation failed",{id,error:error instanceof Error ? error.message : error}); }
  }
  const {order,items}=result;
  const account=await currentAccount();
  const admin=Boolean(account?.approved && account.role==="admin");
  const returns=admin ? await orderReturns(order.id) : [];
  const snapshotOrder=items.some(item=>item.pricing_snapshot?.checkout_mode==="snapshot");
  const awaiting=order.status==="awaiting_payment" && order.payment_status==="awaiting";
  const returned=query.odeme==="sonuc",created=query.odeme==="yeni";
  const notice=order.payment_status==="paid"
    ? (order.status==="pending" ? "Ödemen alındı. Tedarikçi stok teyidinden sonra siparişin hazırlanacak; stok teyit edilemezse ödemen iade edilir." : `Ödemen alındı. Sipariş durumu: ${orderStatus[order.status]}.`)
    : awaiting ? (returned ? "Ödemen henüz doğrulanmadı. Kart işlemi tamamlanmadıysa yeniden deneyebilirsin; tamamladıysan birkaç dakika içinde güncellenecek."
      : created ? "Siparişin oluşturuldu. Kartla ödemek için aşağıdaki butona bas; TAMI güvenli ödeme penceresi bu sayfanın üzerinde açılır." : "Siparişin oluşturuldu, ödemen bekleniyor.")
    : order.payment_status==="expired" ? "Ödeme süresi içinde tamamlanmadığı için sipariş iptal edildi. Kartından tahsilat yapılmadı."
    : order.payment_status==="refund_required" ? "Sipariş iptal edildi. Ödemenin iadesi başlatılacak."
    : order.payment_status==="refunded" ? "Sipariş iptal edildi ve ödemen iade edildi. İadenin kartına yansıması bankana göre birkaç iş günü sürebilir."
    : order.status==="pending" ? "Sipariş kaydın oluşturuldu. Fiyat, stok ve sevkiyat teyidi için iletişime geçilecektir. Ödeme alınmadı." : `Sipariş durumu: ${orderStatus[order.status]}.`;
  const error=query.odeme ? paymentErrors[query.odeme] ?? null : null;
  return <section className="mx-auto min-h-[55vh] w-full max-w-[1280px] px-8 pt-7 pb-14 max-[600px]:px-5 max-[600px]:pt-6 max-[600px]:pb-10"><p className={eyebrow}>SİPARİŞ #{order.number}</p><h1 className={title}>{orderStatus[order.status]}</h1>
    {error && <Alert className={errorBox}>{error}</Alert>}
    {admin && query.iade==="kaydedildi" && <Alert role="status" className={noticeBox}>İade kaydedildi.</Alert>}
    {admin && query.iade==="hata" && <Alert className={errorBox}>İade kaydedilemedi: sipariş sevk edilmemiş ya da adet sipariş edilenden fazla.</Alert>}
    <Alert role="status" className={noticeBox}>{notice}</Alert>
    {awaiting && paymentsEnabled() && <Card className={cn(panel,"mt-3 gap-3 ring-0")}><PayButton orderId={order.id} total={money(Number(order.total_kurus))}>{order.payment_due_at && <small className="text-sm leading-[22px] text-muted-foreground">Son ödeme zamanı: {time(order.payment_due_at)}</small>}</PayButton>
      <p className={panelMuted}>Ödeme TAMI’nin güvenli penceresinde alınır; site arkada açık kalır. Ödeme tamamlanınca bu sayfa kendiliğinden güncellenir. Hata alırsan pencereyi kapatıp yeniden dene; sepetin ve siparişin korunur.</p>
      <PaymentWatcher orderId={order.id} state={`${order.status}:${order.payment_status}`}/></Card>}
    {snapshotOrder && <p className={muted}>Bu sipariş Başbuğ’un kayıtlı fiyat ve stok verileriyle oluşturuldu. Sipariş anında canlı API doğrulaması yapılmadı.</p>}
    <p className={muted}>{time(order.created_at)} · %{order.discount_percent} servis indirimi · Ödeme: {paymentStatus[order.payment_status]}{order.paid_at ? ` (${time(order.paid_at)})` : ""}</p>
    <div className="mb-[45px] grid grid-cols-2 gap-[60px] max-[1000px]:gap-[30px] max-[600px]:grid-cols-1 max-[600px]:gap-5"><article className={cn(panel,"mb-3 min-w-0")}><h2 className={panelTitle}>Sipariş ürünleri</h2>{items.map(p=><div key={p.product_id} className="flex items-start justify-between gap-6 border-b border-border py-4 wrap-anywhere max-[600px]:flex-col max-[600px]:gap-2"><div className="min-w-0"><strong className="font-semibold">{p.name}</strong><p className={panelMuted}>{p.code} · {p.quantity} adet × {money(Number(p.unit_price_kurus))}</p>{p.pricing_snapshot?.checkout_mode==="snapshot" && typeof p.pricing_snapshot.observed_at==="string" && <small className="text-sm leading-[22px] text-muted-foreground">Kaynak veri: {time(new Date(p.pricing_snapshot.observed_at))}</small>}
        {(()=>{ const vehicle=parseGarageVehicle(p.vehicle); return vehicle && <p className={panelMuted}>Araç: {garageVehicleLabel(vehicle)}</p>; })()}
        {admin && p.fitment_level && <p className={panelMuted}>Uyumluluk (sipariş anında): {fitmentLevelLabels[p.fitment_level]}</p>}
        {admin && returns.filter(r=>r.product_id===p.product_id).map(r=><p key={r.id} className={panelMuted}>İade: {r.quantity} adet · {returnReasonLabels[r.reason as ReturnReason] ?? r.reason}{r.note ? ` · ${r.note}` : ""} · {time(r.created_at)}</p>)}
        {admin && order.status==="shipped" && <form action={recordReturn} className="mt-3 flex flex-wrap items-end gap-2.5"><input type="hidden" name="orderId" value={order.id}/><input type="hidden" name="productId" value={p.product_id}/>
          <Input className="h-10 w-[85px] bg-white" name="quantity" type="number" min={1} max={p.quantity} defaultValue={1} aria-label="İade adedi" required/>
          <NativeSelect className="[&>select]:h-10 [&>select]:bg-white" name="reason" aria-label="İade nedeni" defaultValue="not_fit">{returnReasons.map(reason=><NativeSelectOption key={reason} value={reason}>{returnReasonLabels[reason]}</NativeSelectOption>)}</NativeSelect>
          <Input className="h-10 min-w-[140px] flex-1 bg-white" name="note" maxLength={500} placeholder="Not (isteğe bağlı)" aria-label="İade notu"/><Button type="submit" className="h-10 px-4 hover:bg-brand-strong">İade kaydet</Button></form>}
      </div><strong className="shrink-0 font-semibold">{money(Number(p.unit_price_kurus)*p.quantity)}</strong></div>)}
      <p className={panelText}>Ürün toplamı: {money(Number(order.subtotal_kurus))}</p><p className={panelText}>Kargo: {Number(order.shipping_kurus) ? money(Number(order.shipping_kurus)) : order.payment_status==="none" ? "Teyitte belirlenir" : "Ücretsiz"}</p>
      <h3 className="mt-[18px] mb-3 text-[21px] leading-[29px] font-semibold">Toplam: {money(Number(order.total_kurus))}</h3><p className={panelMuted}>KDV dahil.</p>
    </article><article className={cn(panel,"mb-3 min-w-0")}><h2 className={panelTitle}>Teslimat bilgileri</h2><p className={panelText}>{order.customer_name}</p><p className={panelText}>{order.email} · {order.phone}</p><p className={cn(panelText,"whitespace-pre-wrap wrap-anywhere")}>{order.address}</p>{order.note && <p className={panelText}>Not: {order.note}</p>}</article></div><Button nativeButton={false} className={cta} render={<Link href="/katalog"/>}>Kataloğa dön →</Button>
  </section>;
}
