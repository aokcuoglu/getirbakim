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
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Empty, EmptyMedia } from "@/components/ui/empty";
import { updateCart } from "./actions";

const benefit = "flex-row gap-3.5 rounded-[5px] p-5 text-sm leading-[22px] ring-0 border border-border [&>svg]:size-[23px] [&>svg]:shrink-0";

export default async function Cart({searchParams}:{searchParams:Promise<SearchParams>}) {
  const [account,owner,params]=await Promise.all([currentAccount(),currentCartOwner(),searchParams.then(normalizeSearchParams)]);
  const [items,shipping]=await Promise.all([cartFor(owner),shippingRule()]);
  const images=await getCatalogProductImages(items);
  const discount=account?.approved && account.role==="service" ? account.discount_percent : 0;
  return <div className="bg-[#f8f9f9] text-foreground"><section className="mx-auto min-h-[550px] w-full max-w-[1350px] px-[15px] pb-12 max-[760px]:px-3">
    <nav className="mb-7 flex items-center gap-2 pt-4 text-[13px] text-muted-foreground" aria-label="Sayfa yolu"><Link href="/" className="hover:text-primary hover:underline">Ana sayfa</Link><ChevronRight className="size-[13px]" aria-hidden/><span aria-current="page">Sepetim</span></nav>
    <div className="mb-9 flex items-center gap-6 max-[760px]:mb-6 max-[760px]:flex-col max-[760px]:items-start max-[760px]:gap-2"><h1 className="m-0 text-[36px] leading-[44px] font-semibold tracking-[-1px] max-[760px]:text-[30px]">Sepetim</h1><Link href="/siparisler" className="text-sm text-[#0065a5] hover:underline">Siparişlerimi görüntüle</Link></div>
    {params.error && <Alert className="mb-4 rounded-md border-0 bg-[#fff0ec] p-3.5 text-sm leading-5 text-[#a74130]">Ürün fiyatı veya stok durumu uygun değil. Sepetini kontrol edip güncelle.</Alert>}
    {items.length ? <div className="grid grid-cols-[minmax(0,1.76fr)_minmax(320px,1fr)] items-start gap-4 max-[1000px]:grid-cols-[minmax(0,1.6fr)_minmax(280px,1fr)] max-[760px]:grid-cols-1"><div>
      <Card className="gap-0 rounded-[10px] py-0 ring-0 border border-border">
        <div className="grid grid-cols-[1fr_64px_90px] gap-6 border-b border-border px-5 py-[18px] text-sm max-[1000px]:grid-cols-[1fr_56px_80px] max-[1000px]:gap-3 max-[1000px]:px-4 max-[760px]:hidden" aria-hidden><span>Ürün</span><span>Adet</span><span className="text-right">Fiyat</span></div>
        {items.map(p=>{
          const image=images.get(p.id),unit=servicePrice(p.price_kurus??0,discount);
          return <article className="grid grid-cols-[80px_minmax(0,1fr)_64px_90px] items-start gap-6 border-b border-border px-5 py-6 text-sm leading-5 last:border-b-0 max-[1000px]:grid-cols-[60px_minmax(0,1fr)_56px_80px] max-[1000px]:gap-3 max-[1000px]:px-4 max-[1000px]:py-5 max-[760px]:grid-cols-[60px_minmax(0,1fr)_80px]" key={p.id}>
            <Link className="mt-2 grid h-[100px] place-items-center max-[760px]:row-span-2" href={`/urun/${p.id}`}>{image ? <Image className="max-h-[100px] w-20 object-contain max-[1000px]:w-[60px]" src={image.src} width={100} height={100} alt={`${p.name} ${p.brand}`} unoptimized/> : <PartArt className="size-20" kind={categories.find(c=>c.slug===p.category)?.art}/>}</Link>
            <div className="max-[760px]:col-span-2"><Link href={`/urun/${p.id}`} className="hover:text-primary"><h2 className="mt-0.5 mb-2 text-base leading-[22px] font-medium wrap-anywhere">{p.name} {p.brand}</h2></Link><p className="mb-3.5 text-[13px] text-muted-foreground">Kod: {p.code}</p><p className="mb-3 flex items-start gap-2"><CalendarCheck className="mt-0.5 size-[18px] shrink-0" aria-hidden/>{p.stock_label}</p>
              {(!p.available || !p.price_kurus || p.quantity>p.max_quantity) && <p className="my-2 max-w-[420px] text-[13px] leading-5 text-[#ae3025]">Sipariş için uygun değil; adedi güncelle veya ürünü kaldır.</p>}
              <form action={updateCart}><input type="hidden" name="productId" value={p.id}/><input type="hidden" name="quantity" value="0"/><Button type="submit" variant="link" className="h-6 min-h-6 border-0 bg-transparent p-0 text-sm font-medium text-[#0065a5] hover:bg-transparent">Kaldır</Button></form>
            </div>
            <CartQuantity className="max-[1000px]:[&_select]:w-14 max-[760px]:col-start-2" key={`${p.id}-${p.quantity}`} productId={p.id} name={p.code} quantity={p.quantity} maxQuantity={p.max_quantity}/>
            <div className="pt-2 text-right wrap-anywhere max-[760px]:col-start-3 max-[760px]:row-start-2"><strong className="block text-base font-medium">{p.price_kurus ? money(unit*p.quantity) : "Fiyat bekleniyor"}</strong>{p.price_kurus && <small className="mt-1 block text-[13px] text-muted-foreground">{money(unit)} / adet</small>}</div>
          </article>;
        })}
      </Card>
      <div className="mt-4 grid gap-4 max-[760px]:hidden">
        <Card className={benefit}><ShieldCheck aria-hidden/><span><strong className="block font-medium">Güvenli ödeme</strong><small className="mt-1 block text-[13px] text-muted-foreground">Kartla ödeme TAMI güvenli ödeme sayfasında alınır; siparişin stok teyidinden sonra hazırlanır.</small></span></Card>
        <Card className={benefit}><RotateCcw aria-hidden/><span><strong className="block font-medium">İade ve değişim</strong><small className="mt-1 block text-[13px] text-muted-foreground"><Link href="/teslimat-ve-iade" className="hover:text-primary hover:underline">İade koşullarını ve sürecini incele.</Link></small></span></Card>
        <Card className={benefit}><ClipboardCheck aria-hidden/><span><strong className="block font-medium">Araç uyumluluğu</strong><small className="mt-1 block text-[13px] text-muted-foreground">OEM kodunu, motor ve model bilgilerini karşılaştır.</small></span></Card>
      </div></div>
      <OrderSummary className="max-[760px]:mt-2" items={items} discount={discount} shipping={shipping}/></div>
    : <Empty className="gap-6 rounded-none border-0 px-4 py-16"><EmptyMedia className="mb-0"><ShoppingCart className="size-12" aria-hidden/></EmptyMedia><h2 className="m-0 text-2xl leading-[34px] font-semibold">Sepetin henüz boş.</h2><Button nativeButton={false} className="h-auto min-h-12 gap-2.5 rounded-[5px] px-4 py-3 text-sm leading-5 font-semibold hover:bg-brand-strong" render={<Link href="/katalog"/>}>Alışverişe başla</Button></Empty>}
  </section></div>;
}
