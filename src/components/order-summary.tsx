import Link from "next/link";
import { Truck, LockKeyhole, ChevronDown } from "lucide-react";
import type { CartItem } from "@/modules/store/cart";
import { money, servicePrice } from "@/modules/store/catalog";
import { orderTotals, type ShippingRule } from "@/modules/store/orders";
import { Button } from "@/components/ui/button";
import { cartOrderable } from "@/components/cart-orderable";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { PAYMENT_NOTICE } from "@/modules/payments/messages";
import { catalogPath } from "@/modules/seo/paths";
import { InstallmentAmount, InstallmentFeeRow } from "./checkout-installments";

const action = "h-auto min-h-11 w-full gap-2.5 rounded-[5px] px-4 py-3 text-sm leading-5";

function SummaryLines({items,discount}:{items:CartItem[];discount:number}) {
  return <ul className="m-0 list-none p-0 pt-4 text-[13px]">{items.map(p=><li key={p.id} className="flex justify-between gap-5 border-b border-border py-2 leading-5"><span>{p.name} {p.display_brand}</span><span className="shrink-0 max-[760px]:max-w-[45%] max-[760px]:shrink max-[760px]:text-right">{p.quantity} × {money(servicePrice(p.price_kurus??0,discount))}</span></li>)}</ul>;
}

/** `checkout`: the total follows the payment option chosen on the checkout page (#886); the cart shows the cash total. */
function SummaryTotals({totals,discount,checkout=false}:{totals:ReturnType<typeof orderTotals>;discount:number;checkout?:boolean}) {
  return <>
    <dl className="m-0 grid gap-2.5 border-b border-border py-4 text-sm leading-5">
      <div className="flex justify-between gap-3"><dt>Ürün toplamı</dt><dd className="m-0 text-right">{money(totals.subtotal)}</dd></div>
      <div className="flex justify-between gap-3"><dt>Kargo bedeli</dt><dd className="m-0 text-right">{totals.shipping ? money(totals.shipping) : "Ücretsiz"}</dd></div>
      {discount>0 && <div className="flex justify-between gap-3"><dt>Servis indirimi</dt><dd className="m-0 text-right">%{discount} uygulandı</dd></div>}
      {checkout && <InstallmentFeeRow/>}
    </dl>
    <div className="mt-5 mb-4 flex items-start justify-between gap-3 text-base font-semibold"><span>Toplam <small className="mt-1 block text-xs font-normal text-muted-foreground">KDV dahil</small></span><strong className="text-lg font-semibold tabular-nums">{checkout ? <InstallmentAmount fallbackKurus={totals.total}/> : money(totals.total)}</strong></div>
  </>;
}

export function OrderSummary({items,discount,shipping,checkout=false,className}:{items:CartItem[];discount:number;shipping:ShippingRule;checkout?:boolean;className?:string}) {
  const quantity=items.reduce((sum,p)=>sum+p.quantity,0);
  const valid=cartOrderable(items);
  const snapshot=items.some(p=>p.pricing_snapshot?.checkout_mode==="snapshot");
  const totals=orderTotals(items,discount,shipping);
  return <aside aria-labelledby="order-summary-title" className={cn("rounded-[10px] border border-border bg-card p-5 text-sm text-card-foreground", checkout && "max-[760px]:hidden", className)}>
    <h2 id="order-summary-title" className="m-0 text-xl leading-7 font-semibold tracking-[-0.5px]">Sipariş özeti</h2>
    <p className="mb-4 text-[13px] text-muted-foreground">Sepetinde {quantity} ürün var</p>
    <div className="flex items-center gap-4 border-y border-border py-4 text-sm leading-5">
      <Truck className="size-6 shrink-0 text-muted-foreground" aria-hidden/>
      <div><strong className="mb-1 block font-medium">Tek noktadan sevkiyat</strong><span className="block text-[13px] text-[#28652b]">Stok ve teslimat süresi teyit edilecek</span><small className="mt-1 block text-xs">{totals.freeShippingRemaining>0 ? `${money(totals.freeShippingRemaining)} daha ekle, kargo ücretsiz olsun.` : totals.shipping ? `Kargo ücreti ${money(totals.shipping)}.` : "Kargo ücretsiz."}</small></div>
    </div>
    {snapshot && <p className="m-0 pt-3 text-xs leading-[18px] text-muted-foreground">Fiyat ve stok bilgileri son kayıtlara dayanır. Siparişin fiyat ve stok teyidi bekleyecek.</p>}
    {checkout && <SummaryLines items={items} discount={discount}/>}
    <SummaryTotals totals={totals} discount={discount} checkout={checkout}/>
    {!checkout && <div className="grid gap-4">
      {valid ? <Button nativeButton={false} className={cn(action, "font-semibold hover:bg-brand-strong max-[760px]:hidden")} render={<Link href="/siparis-olustur"/>}><LockKeyhole className="size-[18px]" aria-hidden/>Siparişi tamamla</Button>
        : <p id="cart-invalid" className="my-2 max-w-[420px] text-[13px] leading-5 text-[#ae3025]">Siparişe devam etmek için uygun olmayan ürünleri kaldır veya adetlerini güncelle.</p>}
      <Button variant="outline" nativeButton={false} className={cn(action, "border-input bg-white font-medium text-foreground hover:bg-muted max-[760px]:hidden")} render={<Link href={catalogPath}/>}>Alışverişe devam et</Button>
    </div>}
    <p className="mt-3.5 mb-0 text-center text-xs text-muted-foreground">{PAYMENT_NOTICE}</p>
  </aside>;
}

/** Phone-only collapsed summary on the checkout page (the aside is hidden there); the total stays in view (#877). */
export function CheckoutSummaryToggle({items,discount,shipping}:{items:CartItem[];discount:number;shipping:ShippingRule}) {
  const quantity=items.reduce((sum,p)=>sum+p.quantity,0);
  const snapshot=items.some(p=>p.pricing_snapshot?.checkout_mode==="snapshot");
  const totals=orderTotals(items,discount,shipping);
  return <Collapsible className="rounded-[10px] border border-border bg-card text-sm min-[761px]:hidden">
    <CollapsibleTrigger className="flex min-h-12 w-full cursor-pointer items-center justify-between gap-3 rounded-[10px] px-4 py-3 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 [&[data-panel-open]>svg]:rotate-180">
      <span>Sipariş özeti · {quantity} ürün</span><strong className="ml-auto tabular-nums"><InstallmentAmount fallbackKurus={totals.total}/></strong><ChevronDown className="size-4" aria-hidden/>
    </CollapsibleTrigger>
    <CollapsibleContent className="border-t border-border px-4 pb-4">
      <SummaryLines items={items} discount={discount}/>
      <SummaryTotals totals={totals} discount={discount} checkout/>
      {snapshot && <p className="m-0 pb-3 text-xs leading-[18px] text-muted-foreground">Fiyat ve stok bilgileri son kayıtlara dayanır. Siparişin fiyat ve stok teyidi bekleyecek.</p>}
      <small className="block text-xs">{totals.freeShippingRemaining>0 ? `${money(totals.freeShippingRemaining)} daha ekle, kargo ücretsiz olsun.` : totals.shipping ? `Kargo ücreti ${money(totals.shipping)}.` : "Kargo ücretsiz."}</small>
      <p className="mt-3.5 mb-0 text-center text-xs text-muted-foreground">{PAYMENT_NOTICE}</p>
    </CollapsibleContent>
  </Collapsible>;
}
