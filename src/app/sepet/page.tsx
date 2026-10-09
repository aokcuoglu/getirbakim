import { normalizeSearchParams, type SearchParams } from "@/lib/search-params";
import Link from "next/link";
import Image from "next/image";
import { ShoppingCart, ChevronRight, CalendarCheck, ShieldCheck, RotateCcw, ClipboardCheck } from "lucide-react";
import { currentAccount } from "@/modules/auth/session";
import { cartFor, currentCartOwner } from "@/modules/store/cart";
import { shippingRule } from "@/modules/store/orders";
import { money, servicePrice, categories } from "@/modules/store/catalog";
import { getCatalogProductImages } from "@/modules/store/product-enrichment";
import { PartArt } from "@/components/part-art";
import { OrderSummary } from "@/components/order-summary";
import { CartQuantity } from "@/components/cart-quantity";
import { updateCart } from "./actions";
import "@/styles/catalog.css";

export default async function Cart({searchParams}:{searchParams:Promise<SearchParams>}) {
  const [account,owner,params]=await Promise.all([currentAccount(),currentCartOwner(),searchParams.then(normalizeSearchParams)]);
  const [items,shipping]=await Promise.all([cartFor(owner),shippingRule()]);
  const images=await getCatalogProductImages(items);
  const discount=account?.approved && account.role==="service" ? account.discount_percent : 0;
  return <div className="cart-page"><section className="shell shopping-cart">
    <nav className="cart-breadcrumbs" aria-label="Sayfa yolu"><Link href="/">Ana sayfa</Link><ChevronRight size={13}/><span aria-current="page">Sepetim</span></nav>
    <div className="cart-title-row"><h1>Sepetim</h1><Link href="/siparisler">Siparişlerimi görüntüle</Link></div>
    {params.error && <p role="alert" className="error">Ürün fiyatı veya stok durumu uygun değil. Sepetini kontrol edip güncelle.</p>}
    {items.length ? <div className="shopping-cart-layout"><div className="shopping-cart-main"><div className="shopping-cart-table">
      <div className="shopping-cart-table-head"><span>Ürün</span><span>Adet</span><span>Fiyat</span></div>
      {items.map(p=>{
        const image=images.get(p.id),unit=servicePrice(p.price_kurus??0,discount);
        return <article className="shopping-cart-item" key={p.id}>
          <Link className="shopping-cart-image" href={`/urun/${p.id}`}>{image ? <Image src={image.src} width={100} height={100} alt={`${p.name} ${p.brand}`} unoptimized/> : <PartArt kind={categories.find(c=>c.slug===p.category)?.art}/>}</Link>
          <div className="shopping-cart-description"><Link href={`/urun/${p.id}`}><h2>{p.name} {p.brand}</h2></Link><p className="shopping-cart-code">Kod: {p.code}</p><p className="shopping-cart-stock"><CalendarCheck size={18}/>{p.stock_label}</p>
            {(!p.available || !p.price_kurus || p.quantity>p.max_quantity) && <p className="purchase-error">Sipariş için uygun değil; adedi güncelle veya ürünü kaldır.</p>}
            <form action={updateCart}><input type="hidden" name="productId" value={p.id}/><input type="hidden" name="quantity" value="0"/><button className="shopping-cart-remove">Kaldır</button></form>
          </div>
          <CartQuantity key={`${p.id}-${p.quantity}`} productId={p.id} name={p.code} quantity={p.quantity} maxQuantity={p.max_quantity}/>
          <div className="shopping-cart-price"><strong>{p.price_kurus ? money(unit*p.quantity) : "Fiyat bekleniyor"}</strong>{p.price_kurus && <small>{money(unit)} / adet</small>}</div>
        </article>;
      })}
    </div><div className="shopping-cart-benefits"><div><ShieldCheck size={23}/><span><strong>Güvenli ödeme</strong><small>Kartla ödeme TAMI güvenli ödeme sayfasında alınır; siparişin stok teyidinden sonra hazırlanır.</small></span></div><div><RotateCcw size={23}/><span><strong>İade ve değişim</strong><small><Link href="/teslimat-ve-iade">İade koşullarını ve sürecini incele.</Link></small></span></div><div><ClipboardCheck size={23}/><span><strong>Araç uyumluluğu</strong><small>OEM kodunu, motor ve model bilgilerini karşılaştır.</small></span></div></div></div>
    <OrderSummary items={items} discount={discount} shipping={shipping}/></div> : <div className="shopping-cart-empty"><ShoppingCart size={48}/><h2>Sepetin henüz boş.</h2><Link className="purchase-primary" href="/katalog">Alışverişe başla</Link></div>}
  </section></div>;
}
