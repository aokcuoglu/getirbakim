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
import { returnReasonLabels, returnReasons, type ReturnReason } from "@/modules/store/returns";

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
  return <section className="shell page-section"><p className="eyebrow">SİPARİŞ #{order.number}</p><h1 className="page-title">{orderStatus[order.status]}</h1>
    {error && <p className="error" role="alert">{error}</p>}
    {admin && query.iade==="kaydedildi" && <p className="notice" role="status">İade kaydedildi.</p>}
    {admin && query.iade==="hata" && <p className="error" role="alert">İade kaydedilemedi: sipariş sevk edilmemiş ya da adet sipariş edilenden fazla.</p>}
    <p className="notice" role="status">{notice}</p>
    {awaiting && paymentsEnabled() && <div className="panel"><PayButton orderId={order.id} total={money(Number(order.total_kurus))}>{order.payment_due_at && <small className="muted">Son ödeme zamanı: {time(order.payment_due_at)}</small>}</PayButton>
      <p className="muted">Ödeme TAMI’nin güvenli penceresinde alınır; site arkada açık kalır. Ödeme tamamlanınca bu sayfa kendiliğinden güncellenir. Hata alırsan pencereyi kapatıp yeniden dene; sepetin ve siparişin korunur.</p>
      <PaymentWatcher orderId={order.id} state={`${order.status}:${order.payment_status}`}/></div>}
    {snapshotOrder && <p className="muted">Bu sipariş Başbuğ’un kayıtlı fiyat ve stok verileriyle oluşturuldu. Sipariş anında canlı API doğrulaması yapılmadı.</p>}
    <p className="muted">{time(order.created_at)} · %{order.discount_percent} servis indirimi · Ödeme: {paymentStatus[order.payment_status]}{order.paid_at ? ` (${time(order.paid_at)})` : ""}</p>
    <div className="content-columns"><article className="panel"><h2>Sipariş ürünleri</h2>{items.map(p=><div key={p.product_id} className="commerce-line"><div><strong>{p.name}</strong><p className="muted">{p.code} · {p.quantity} adet × {money(Number(p.unit_price_kurus))}</p>{p.pricing_snapshot?.checkout_mode==="snapshot" && typeof p.pricing_snapshot.observed_at==="string" && <small className="muted">Kaynak veri: {time(new Date(p.pricing_snapshot.observed_at))}</small>}
        {(()=>{ const vehicle=parseGarageVehicle(p.vehicle); return vehicle && <p className="muted">Araç: {garageVehicleLabel(vehicle)}</p>; })()}
        {admin && p.fitment_level && <p className="muted">Uyumluluk (sipariş anında): {fitmentLevelLabels[p.fitment_level]}</p>}
        {admin && returns.filter(r=>r.product_id===p.product_id).map(r=><p key={r.id} className="muted">İade: {r.quantity} adet · {returnReasonLabels[r.reason as ReturnReason] ?? r.reason}{r.note ? ` · ${r.note}` : ""} · {time(r.created_at)}</p>)}
        {admin && order.status==="shipped" && <form action={recordReturn} className="inline-form"><input type="hidden" name="orderId" value={order.id}/><input type="hidden" name="productId" value={p.product_id}/>
          <input name="quantity" type="number" min={1} max={p.quantity} defaultValue={1} aria-label="İade adedi" required/>
          <select name="reason" aria-label="İade nedeni" defaultValue="not_fit">{returnReasons.map(reason=><option key={reason} value={reason}>{returnReasonLabels[reason]}</option>)}</select>
          <input name="note" maxLength={500} placeholder="Not (isteğe bağlı)" aria-label="İade notu"/><button>İade kaydet</button></form>}
      </div><strong>{money(Number(p.unit_price_kurus)*p.quantity)}</strong></div>)}
      <p>Ürün toplamı: {money(Number(order.subtotal_kurus))}</p><p>Kargo: {Number(order.shipping_kurus) ? money(Number(order.shipping_kurus)) : order.payment_status==="none" ? "Teyitte belirlenir" : "Ücretsiz"}</p>
      <h3>Toplam: {money(Number(order.total_kurus))}</h3><p className="muted">KDV dahil.</p>
    </article><article className="panel"><h2>Teslimat bilgileri</h2><p>{order.customer_name}</p><p>{order.email} · {order.phone}</p><p className="commerce-address">{order.address}</p>{order.note && <p>Not: {order.note}</p>}</article></div><Link className="button" href="/katalog">Kataloğa dön →</Link>
  </section>;
}
