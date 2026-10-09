import Link from "next/link";
import { Truck, LockKeyhole } from "lucide-react";
import type { CartItem } from "@/modules/store/cart";
import { money, servicePrice } from "@/modules/store/catalog";
import { orderTotals, type ShippingRule } from "@/modules/store/orders";

export function OrderSummary({items,discount,shipping,checkout=false}:{items:CartItem[];discount:number;shipping:ShippingRule;checkout?:boolean}) {
  const quantity=items.reduce((sum,p)=>sum+p.quantity,0);
  const valid=items.every(p=>p.available && p.price_kurus && p.quantity<=p.max_quantity);
  const snapshot=items.some(p=>p.pricing_snapshot?.checkout_mode==="snapshot");
  const totals=orderTotals(items,discount,shipping);
  return <aside className="order-summary"><h2>Sipariş özeti</h2><p className="order-summary-count">Sepetinde {quantity} ürün var</p>
    <div className="order-summary-delivery"><Truck size={24}/><div><strong>Tek noktadan sevkiyat</strong><span>Stok ve teslimat süresi teyit edilecek</span><small>{totals.freeShippingRemaining>0 ? `${money(totals.freeShippingRemaining)} daha ekle, kargo ücretsiz olsun.` : totals.shipping ? `Kargo ücreti ${money(totals.shipping)}.` : "Kargo ücretsiz."}</small></div></div>
    {snapshot && <p className="order-snapshot-note">Fiyat ve stok bilgileri son kayıtlara dayanır. Siparişin fiyat ve stok teyidi bekleyecek.</p>}
    {checkout && <ul className="order-summary-items">{items.map(p=><li key={p.id}><span>{p.name} {p.brand}</span><span>{p.quantity} × {money(servicePrice(p.price_kurus??0,discount))}</span></li>)}</ul>}
    <dl className="order-summary-totals"><div><dt>Ürün toplamı</dt><dd>{money(totals.subtotal)}</dd></div><div><dt>Kargo bedeli</dt><dd>{totals.shipping ? money(totals.shipping) : "Ücretsiz"}</dd></div>{discount>0 && <div><dt>Servis indirimi</dt><dd>%{discount} uygulandı</dd></div>}</dl>
    <div className="order-grand-total"><span>Toplam <small>KDV dahil</small></span><strong>{money(totals.total)}</strong></div>
    {!checkout && <div className="order-summary-buttons"><Link className="purchase-outline" href="/katalog">Alışverişe devam et</Link>{valid ? <Link className="purchase-primary" href="/siparis-olustur"><LockKeyhole size={18}/>Siparişi tamamla</Link> : <p className="purchase-error">Siparişe devam etmek için uygun olmayan ürünleri kaldır veya adetlerini güncelle.</p>}</div>}
    <p className="order-no-payment">Ödeme TAMI güvenli ödeme sayfasında kartla alınır; kart bilgilerin Getirbakım’a iletilmez.</p>
  </aside>;
}
