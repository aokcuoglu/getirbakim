import Link from "next/link";
import { Truck, LockKeyhole } from "lucide-react";
import type { CartItem } from "@/modules/store/cart";
import { money, servicePrice } from "@/modules/store/catalog";
import { orderTotals, type ShippingRule } from "@/modules/store/orders";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const action = "h-auto min-h-[42px] w-full gap-2.5 rounded-[5px] px-4 py-3 text-sm leading-5";

export function OrderSummary({items,discount,shipping,checkout=false,className}:{items:CartItem[];discount:number;shipping:ShippingRule;checkout?:boolean;className?:string}) {
  const quantity=items.reduce((sum,p)=>sum+p.quantity,0);
  const valid=items.every(p=>p.available && p.price_kurus && p.quantity<=p.max_quantity);
  const snapshot=items.some(p=>p.pricing_snapshot?.checkout_mode==="snapshot");
  const totals=orderTotals(items,discount,shipping);
  return <aside aria-labelledby="order-summary-title" className={cn("rounded-[10px] border border-border bg-card p-5 text-sm text-card-foreground", className)}>
    <h2 id="order-summary-title" className="m-0 text-xl leading-7 font-semibold tracking-[-0.5px]">Sipariş özeti</h2>
    <p className="mb-4 text-[13px] text-muted-foreground">Sepetinde {quantity} ürün var</p>
    <div className="flex items-center gap-4 border-y border-border py-4 text-sm leading-5">
      <Truck className="size-6 shrink-0 text-muted-foreground" aria-hidden/>
      <div><strong className="mb-1 block font-medium">Tek noktadan sevkiyat</strong><span className="block text-[13px] text-[#28652b]">Stok ve teslimat süresi teyit edilecek</span><small className="mt-1 block text-xs">{totals.freeShippingRemaining>0 ? `${money(totals.freeShippingRemaining)} daha ekle, kargo ücretsiz olsun.` : totals.shipping ? `Kargo ücreti ${money(totals.shipping)}.` : "Kargo ücretsiz."}</small></div>
    </div>
    {snapshot && <p className="m-0 pt-3 text-xs leading-[18px] text-muted-foreground">Fiyat ve stok bilgileri son kayıtlara dayanır. Siparişin fiyat ve stok teyidi bekleyecek.</p>}
    {checkout && <ul className="m-0 list-none p-0 pt-4 text-[13px]">{items.map(p=><li key={p.id} className="flex justify-between gap-5 border-b border-border py-2 leading-5"><span>{p.name} {p.brand}</span><span className="shrink-0 max-[760px]:max-w-[45%] max-[760px]:shrink max-[760px]:text-right">{p.quantity} × {money(servicePrice(p.price_kurus??0,discount))}</span></li>)}</ul>}
    <dl className="m-0 grid gap-2.5 border-b border-border py-4 text-sm leading-5">
      <div className="flex justify-between gap-3"><dt>Ürün toplamı</dt><dd className="m-0 text-right">{money(totals.subtotal)}</dd></div>
      <div className="flex justify-between gap-3"><dt>Kargo bedeli</dt><dd className="m-0 text-right">{totals.shipping ? money(totals.shipping) : "Ücretsiz"}</dd></div>
      {discount>0 && <div className="flex justify-between gap-3"><dt>Servis indirimi</dt><dd className="m-0 text-right">%{discount} uygulandı</dd></div>}
    </dl>
    <div className="mt-5 mb-4 flex items-start justify-between gap-3 text-base font-semibold"><span>Toplam <small className="mt-1 block text-xs font-normal text-muted-foreground">KDV dahil</small></span><strong className="text-lg font-semibold tabular-nums">{money(totals.total)}</strong></div>
    {!checkout && <div className="grid gap-4">
      <Button variant="outline" nativeButton={false} className={cn(action, "border-input bg-white font-medium text-foreground hover:bg-muted")} render={<Link href="/katalog"/>}>Alışverişe devam et</Button>
      {valid ? <Button nativeButton={false} className={cn(action, "font-semibold hover:bg-brand-strong")} render={<Link href="/siparis-olustur"/>}><LockKeyhole className="size-[18px]" aria-hidden/>Siparişi tamamla</Button>
        : <p className="my-2 max-w-[420px] text-[13px] leading-5 text-[#ae3025]">Siparişe devam etmek için uygun olmayan ürünleri kaldır veya adetlerini güncelle.</p>}
    </div>}
    <p className="mt-3.5 mb-0 text-center text-xs text-muted-foreground">Ödeme TAMI güvenli ödeme sayfasında kartla alınır; kart bilgilerin Getirbakım’a iletilmez.</p>
  </aside>;
}
