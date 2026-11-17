"use client";
import { startTransition, useActionState, useEffect, useId, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { CheckCircle2, LockKeyhole, Package, X } from "lucide-react";
import { addToCart, loadCartSuggestions } from "@/app/(store)/sepet/actions";
import { CartQuantity } from "./cart-quantity";
import type { PurchasePreview, PurchaseState } from "@/modules/store/purchase-types";
import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { addToCart as addToCartEvent, catalogItem } from "@/modules/analytics/events";
import { track } from "@/modules/analytics/track";
import { cartCount } from "@/modules/store/cart-count";

const initial: PurchaseState = { error:null, added:null, suggestions:[] };
// The dialog's follow-up request for related parts gives up after this.
const suggestionTimeoutMs=5000;
const money=(value:number)=>new Intl.NumberFormat("tr-TR",{style:"currency",currency:"TRY"}).format(value/100);
const outline="h-auto min-h-12 rounded-[5px] border-input bg-white px-4 py-3 text-sm leading-5 font-medium text-foreground hover:bg-muted";

// `variant="product"` is the larger product-page form; `className` adds layout classes from the caller.
export function PurchaseForm({productId,name,available,maxQuantity=99,className,variant="listing",price}:{productId:string;name:string;available:boolean;maxQuantity?:number;className?:string;variant?:"listing"|"product";price?:string}) {
  const [state,action,pending]=useActionState(addToCart,initial);
  const [open,setOpen]=useState(false);
  // A 60-card listing rendered 99 <option>s per card (~200 kB of HTML); the rest are added before the list can open.
  const [allQuantities,setAllQuantities]=useState(false);
  const quantities=Math.max(1,Math.min(maxQuantity,99));
  const titleId=useId();
  useEffect(()=>{
    // Opening the popup is the response to a finished add-to-cart action.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if(state.added) setOpen(true);
  },[state.added]);
  useEffect(()=>{
    // `added.price` is what the visitor pays (service discount applied); `addedQuantity` is this click's units.
    if(state.added) track("add_to_cart",addToCartEvent(catalogItem({id:state.added.itemId,name:state.added.itemName,brand:state.added.brand},state.added.price),state.addedQuantity??1));
  },[state.added,state.addedQuantity]);
  // Related parts that missed the action's time budget (#704) load after the dialog opens; `for` ties them to one answer.
  const [loaded,setLoaded]=useState<{for:PurchaseState;suggestions:PurchasePreview[]}|null>(null);
  useEffect(()=>{
    if(!state.suggestionsPending||!state.added) return;
    let current=true;
    const productId=state.added.id;
    let timer:ReturnType<typeof setTimeout>|undefined;
    // A slow or failed request ends as no suggestions (one column) rather than a skeleton left on screen.
    const timeout=new Promise<PurchasePreview[]>(resolve=>{timer=setTimeout(()=>resolve([]),suggestionTimeoutMs);});
    startTransition(async()=>{
      const suggestions=await Promise.race([loadCartSuggestions(productId),timeout]).catch(():PurchasePreview[]=>[]);
      clearTimeout(timer);
      if(current) setLoaded({for:state,suggestions});
    });
    return ()=>{current=false;clearTimeout(timer);};
  },[state]);
  // null: still loading; the column keeps its place (skeleton) so the dialog does not change size when they arrive.
  const suggestions=state.suggestionsPending ? (loaded?.for===state ? loaded.suggestions : null) : state.suggestions;
  // Announced only when the suggestions load after the dialog opened; immediate ones are read with the dialog.
  const status=suggestions===null ? "Öneriler yükleniyor" : state.suggestionsPending&&suggestions.length ? `${suggestions.length} öneri yüklendi` : "";
  useEffect(()=>{
    // The action skips layout revalidation (#707); the header badge takes the new total from here.
    if(state.cartCount!==undefined) cartCount.set(state.cartCount);
  },[state]);
  const product=variant==="product";
  // On the product page an orderable item gets a bottom bar at 600px and below (storefront.css .buy-bar); the catalog
  // card's form stays the direct child of its card (#642).
  const sticky=product&&available;
  const form=<form action={action} className={cn("buy-form",product&&"buy-form-product",className)}>
      <input type="hidden" name="productId" value={productId}/>
      {sticky&&price&&<span className="buy-bar-price" aria-hidden="true">{price}</span>}
      <select aria-label={`${name} için adet`} name="quantity" defaultValue={1} disabled={!available || pending}
        onPointerEnter={()=>setAllQuantities(true)} onFocus={()=>setAllQuantities(true)}
        className={cn("buy-quantity",product&&"buy-quantity-product")}>
        {Array.from({length:allQuantities?quantities:Math.min(quantities,10)},(_,i)=><option key={i+1} value={i+1}>{i+1}</option>)}
      </select>
      {/* ui/button's markup with one class (storefront.css) instead of ~940 characters per card. */}
      <ButtonPrimitive type="submit" data-slot="button" disabled={!available || pending} className={cn("buy-button",product&&"buy-button-product")}>{pending ? "Ekleniyor…" : "Sepete ekle"}</ButtonPrimitive>
    </form>;
  const error=state.error && <p className={cn("my-2 max-w-[420px] text-[13px] leading-5 text-[#ae3025]",sticky&&"max-[600px]:mt-2 max-[600px]:mb-0")} role="alert">{state.error} <Link className="text-[#0065a5] underline" href="/sepet">Sepeti aç</Link></p>;
  return <>
    {sticky ? <div className="buy-bar">{form}{error}</div> : <>{form}{error}</>}
    <Dialog open={open} onOpenChange={setOpen}>
      {state.added && <DialogContent aria-labelledby={titleId} showCloseButton={false} overlayClassName="bg-[#212b3673] supports-backdrop-filter:backdrop-blur-none"
        className={cn("top-[10dvh] grid max-h-[calc(90dvh-24px)] w-[calc(100%-40px)] max-w-[1020px] translate-y-0 grid-cols-2 gap-0 overflow-auto rounded-[10px] bg-white p-0 text-foreground shadow-[0_12px_50px_#212b3626] ring-0 sm:max-w-[1020px] max-[760px]:top-3 max-[760px]:max-h-[calc(100dvh-24px)] max-[760px]:w-[calc(100%-24px)] max-[760px]:grid-cols-1",
          // Pending suggestions that end empty keep the two-column height: only the width reflows, the dialog does not shrink.
          suggestions===null||suggestions.length ? "min-h-[490px]" : state.suggestionsPending ? "min-h-[490px] grid-cols-1" : "min-h-[300px] grid-cols-1")}>
        {/* Outside the suggestions column, so it stays when the column (or its skeleton) goes; sr-only takes no grid cell. */}
        <p role="status" aria-live="polite" className="sr-only">{status}</p>
        <DialogClose render={<Button variant="secondary" size="icon" className="min-h-0 p-0 absolute top-2.5 right-2.5 z-1 rounded-[5px] bg-[#e6e9ec] text-foreground hover:bg-[#d9dfe4]"/>} aria-label="Pencereyi kapat"><X className="size-5"/></DialogClose>
        {(suggestions===null||suggestions.length>0) && <section aria-busy={suggestions===null} className="border-r border-[#e0e4e8] p-8 max-[760px]:border-t max-[760px]:border-r-0 max-[760px]:px-5 max-[760px]:py-6">
          <h2 className="mb-9 text-center text-2xl leading-8 font-semibold tracking-[-.5px] max-[760px]:mb-7 max-[760px]:text-left max-[760px]:text-xl">Bunları da inceleyebilirsin</h2>
          {suggestions===null && <>{[0,1,2].map(i=><div key={i} aria-hidden className="grid grid-cols-[60px_1fr_auto] items-start gap-4 border-b border-[#dfe3e8] pt-[18px] pb-6 last:border-b-0 last:pb-0">
            <Skeleton className="h-20 w-[60px]"/><div><Skeleton className="h-4 w-full"/><Skeleton className="mt-2 h-4 w-2/3"/><Skeleton className="mt-3 h-4 w-20"/></div><Skeleton className="h-[42px] w-[86px]"/>
          </div>)}</>}
          {suggestions?.map(p=><article key={p.id} className="grid grid-cols-[60px_1fr_auto] items-start gap-4 border-b border-[#dfe3e8] pt-[18px] pb-6 last:border-b-0 last:pb-0">
          <Link className="flex h-20 items-center justify-center text-muted-foreground" href={p.href}>{p.image ? <Image className="max-h-20 max-w-[60px] object-contain" src={p.image} width={80} height={80} alt={p.name}/> : <Package size={36}/>}</Link>
          <div><Link className="block text-sm leading-5 font-medium text-foreground hover:text-primary" href={p.href}>{p.name}</Link><strong className="mt-2.5 mb-1 block text-sm text-[#007bc4]">{money(p.price)}</strong><small className="text-[13px] text-muted-foreground">KDV dahil · Kargo hariç</small></div>
          <form action={action}><input type="hidden" name="productId" value={p.id}/><input type="hidden" name="quantity" value="1"/><Button type="submit" variant="outline" className={cn(outline,"min-h-[42px] px-3 py-2.5 text-[13px]")} disabled={pending}>Sepete ekle</Button></form>
        </article>)}</section>}
        <section className="bg-[#f8f9f9] p-8 max-[760px]:row-start-1 max-[760px]:px-5 max-[760px]:py-7">
          <DialogTitle id={titleId} className="mb-9 flex items-center gap-2.5 text-2xl leading-8 font-semibold tracking-[-.5px] max-[760px]:mb-7 max-[760px]:text-[22px] max-[760px]:leading-7"><CheckCircle2 size={30} className="shrink-0 text-[#459938]"/>Ürün sepetine eklendi</DialogTitle>
          <div className="mb-8 flex items-start gap-6 text-sm leading-5">
            <Link className="grid size-20 shrink-0 place-items-center rounded-[5px] border border-input bg-white text-muted-foreground" href={state.added.href}>{state.added.image ? <Image className="size-16 object-contain" src={state.added.image} width={80} height={80} alt={state.added.name}/> : <Package size={36}/>}</Link>
            <div><Link className="mb-2.5 block font-medium text-foreground hover:text-primary" href={state.added.href}>{state.added.name}</Link><div className="flex items-center gap-6 [&_select]:h-8 [&_select]:min-h-8 [&_select]:w-[54px] max-md:[&_select]:h-11 max-md:[&_select]:min-h-11 max-md:[&_select]:w-[72px] [&_select]:rounded-[5px] [&_select]:border [&_select]:border-input [&_select]:bg-white [&_select]:px-2 [&_select]:py-1 [&_select]:text-sm"><CartQuantity key={`${state.added.id}-${state.added.quantity}`} productId={state.added.id} name={state.added.code} quantity={state.added.quantity} maxQuantity={state.added.maxQuantity} analyticsItem={catalogItem({id:state.added.itemId,name:state.added.itemName,brand:state.added.brand},state.added.price)}/><strong className="text-sm font-medium">{money(state.added.price)}</strong></div></div>
          </div>
          <DialogClose render={<Button variant="outline" className={cn(outline,"mb-4 w-full")}/>}>Alışverişe devam et</DialogClose>
          <Button className="h-auto min-h-12 w-full gap-2.5 rounded-[5px] border-[#007bc4] bg-[#007bc4] px-4 py-3 text-sm leading-5 font-semibold text-white hover:bg-[#006bb0]" nativeButton={false} render={<Link href="/siparis-olustur"/>}><LockKeyhole className="size-[18px]"/>Siparişi tamamla</Button>
          <Link className="mt-4 block text-center text-[13px] text-[#0065a5] hover:underline" href="/sepet">Sepeti görüntüle</Link>
        </section>
      </DialogContent>}
    </Dialog>
  </>;
}
