import Link from "next/link";
import { randomUUID } from "node:crypto";
import { Check, LockKeyhole } from "lucide-react";
import { normalizeSearchParams, type SearchParams } from "@/lib/search-params";
import { currentAccount } from "@/modules/auth/session";
import { cartFor, currentCartOwner } from "@/modules/store/cart";
import { cartQuote, orderTotals, shippingRule } from "@/modules/store/orders";
import { paymentsEnabled } from "@/modules/payments/checkout";
import { OrderSummary } from "@/components/order-summary";
import { CheckoutForm } from "@/components/checkout-form";
import { money } from "@/modules/store/catalog";

const errors:Record<string,string>={supplier:"Tedarikçi fiyat ve stok bilgisi şu anda doğrulanamadı. Biraz sonra yeniden dene.",stock:"Ürün fiyatı veya stok durumu uygun değil. Sepetini kontrol edip güncelle.",price:"Fiyatlar, servis indirimi veya sipariş veri kaynağı değişti. Güncel toplamı kontrol ederek siparişini tekrar onayla.",validation:"İletişim ve teslimat bilgilerini tamamla; sözleşmeleri onayla.",session:"Sepet oturumu sona erdi.",payment:"Online ödeme şu anda kapalı. Lütfen daha sonra tekrar dene."};

export default async function Checkout({searchParams}:{searchParams:Promise<SearchParams>}) {
  const [account,owner,params]=await Promise.all([currentAccount(),currentCartOwner(),searchParams.then(normalizeSearchParams)]);
  const [items,shipping]=await Promise.all([cartFor(owner),shippingRule()]);
  const discount=account?.approved && account.role==="service" ? account.discount_percent : 0;
  const enabled=paymentsEnabled();
  const valid=enabled && items.length>0 && items.every(p=>p.available && p.price_kurus && p.quantity<=p.max_quantity);
  return <div className="checkout-page"><section className="shell checkout-content"><div className="checkout-heading"><h1>Siparişi tamamla</h1><ol className="checkout-steps"><li><Link href="/sepet"><span><Check size={16}/></span>Sepet</Link></li><li aria-current="step"><span>1</span>Teslimat</li><li><span>2</span>Ödeme</li></ol></div>
    {params.error && <p className="error" role="alert">{errors[params.error]??errors.stock}</p>}
    {!enabled && !params.error && items.length>0 && <p className="error" role="alert">{errors.payment}</p>}
    {items.length ? <div className="checkout-layout"><div className="checkout-customer"><h2>Müşteri ve teslimat bilgileri</h2><p className="checkout-account-note">{discount ? `${account!.name} · %${discount} servis indirimi uygulanıyor.` : "Üye olmadan sipariş verebilirsin."}</p>
      <CheckoutForm disabled={!valid} total={money(orderTotals(items,discount,shipping).total)} errors={errors}><input type="hidden" name="requestKey" value={randomUUID()}/><input type="hidden" name="quote" value={cartQuote(items,discount,shipping)}/>
        <label>Ad soyad / Firma <span>*</span><input name="name" autoComplete="name" minLength={2} maxLength={150} defaultValue={account?.name} required/></label>
        <label>E-posta <span>*</span><input type="email" name="email" autoComplete="email" maxLength={200} defaultValue={account?.email} required/></label>
        <label>Telefon <span>*</span><input type="tel" name="phone" autoComplete="tel" minLength={10} maxLength={20} required/></label>
        <label>Teslimat adresi <span>*</span><textarea name="address" autoComplete="street-address" minLength={15} maxLength={1000} rows={3} required/></label>
        <label>Sipariş notu<textarea name="note" maxLength={1000} rows={2}/></label>
        <label className="checkout-consent"><input type="checkbox" name="consent" required/><span><Link href="/on-bilgilendirme-formu" target="_blank">Ön bilgilendirme formunu</Link> ve <Link href="/mesafeli-satis-sozlesmesi" target="_blank">mesafeli satış sözleşmesini</Link> okudum, onaylıyorum. Ödemenin TAMI güvenli ödeme sayfasında alınacağını; tedarikçi stoku teyit edilemezse siparişin iptal edilip ödemenin iade edileceğini biliyorum.</span></label>
      </CheckoutForm><p className="checkout-legal"><LockKeyhole size={15}/>Bilgilerin yalnız sipariş işlemleri için kullanılır. <Link href="/gizlilik-politikasi">Gizlilik politikası</Link></p><Link href="/sepet">← Sepete dön</Link></div><OrderSummary items={items} discount={discount} shipping={shipping} checkout/></div> : <div className="shopping-cart-empty"><h2>Sepetin henüz boş.</h2><Link className="purchase-primary" href="/katalog">Alışverişe başla</Link></div>}
  </section></div>;
}
