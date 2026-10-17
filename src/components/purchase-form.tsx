"use client";
import { useActionState, useEffect, useId, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { CheckCircle2, LockKeyhole, Package, X } from "lucide-react";
import { addToCart } from "@/app/sepet/actions";
import { CartQuantity } from "./cart-quantity";
import type { PurchaseState } from "@/modules/store/purchase-types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const initial: PurchaseState = { error:null, added:null, suggestions:[] };
const money=(value:number)=>new Intl.NumberFormat("tr-TR",{style:"currency",currency:"TRY"}).format(value/100);
const outline="h-auto min-h-12 rounded-[5px] border-input bg-white px-4 py-3 text-sm leading-5 font-medium text-foreground hover:bg-muted";

// `variant="product"` is the larger product-page form; `className` adds layout classes from the caller.
export function PurchaseForm({productId,name,available,maxQuantity=99,className,variant="listing"}:{productId:string;name:string;available:boolean;maxQuantity?:number;className?:string;variant?:"listing"|"product"}) {
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
  const product=variant==="product";
  return <>
    <form action={action} className={cn("mb-4 flex gap-2",product&&"mb-5 items-center gap-2.5",className)}>
      <input type="hidden" name="productId" value={productId}/>
      <select aria-label={`${name} için adet`} name="quantity" defaultValue={1} disabled={!available || pending}
        onPointerEnter={()=>setAllQuantities(true)} onFocus={()=>setAllQuantities(true)}
        className={cn("h-12 w-[66px] flex-[0_0_66px] cursor-pointer rounded-md border border-input bg-white px-3 py-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed max-[600px]:group-data-[view=grid]/listing:w-12 max-[600px]:group-data-[view=grid]/listing:flex-[0_0_48px] max-[600px]:group-data-[view=grid]/listing:px-2",
          product&&"w-16 flex-[0_0_64px] rounded-[5px] py-2.5")}>
        {Array.from({length:allQuantities?quantities:Math.min(quantities,10)},(_,i)=><option key={i+1} value={i+1}>{i+1}</option>)}
      </select>
      <Button type="submit" disabled={!available || pending}
        className={cn("h-12 min-w-0 flex-1 rounded-md border-brand bg-brand px-2 py-[13px] text-sm font-medium text-white hover:bg-brand-strong disabled:border-[#e6e9ec] disabled:bg-[#e6e9ec] disabled:text-muted-foreground disabled:opacity-100 max-[600px]:group-data-[view=grid]/listing:px-1 max-[600px]:group-data-[view=grid]/listing:text-xs",
          product&&"w-60 flex-none rounded-[5px] border-[#2e78c7] bg-[#2e78c7] font-semibold hover:bg-[#2168b1] disabled:text-[#7a8490] max-[750px]:w-auto max-[750px]:flex-1")}>{pending ? "Ekleniyor…" : "Sepete ekle"}</Button>
    </form>
    {state.error && <p className="my-2 max-w-[420px] text-[13px] leading-5 text-[#ae3025]" role="alert">{state.error} <Link className="text-[#0065a5] underline" href="/sepet">Sepeti aç</Link></p>}
    <Dialog open={open} onOpenChange={setOpen}>
      {state.added && <DialogContent aria-labelledby={titleId} showCloseButton={false} overlayClassName="bg-[#212b3673] supports-backdrop-filter:backdrop-blur-none"
        className={cn("top-[10dvh] grid max-h-[calc(90dvh-24px)] w-[calc(100%-40px)] max-w-[1020px] translate-y-0 grid-cols-2 gap-0 overflow-auto rounded-[10px] bg-white p-0 text-foreground shadow-[0_12px_50px_#212b3626] ring-0 sm:max-w-[1020px] max-[760px]:top-3 max-[760px]:max-h-[calc(100dvh-24px)] max-[760px]:w-[calc(100%-24px)] max-[760px]:grid-cols-1",
          state.suggestions.length ? "min-h-[490px]" : "min-h-[300px] grid-cols-1")}>
        <DialogClose render={<Button variant="secondary" size="icon" className="min-h-0 p-0 absolute top-2.5 right-2.5 z-1 rounded-[5px] bg-[#e6e9ec] text-foreground hover:bg-[#d9dfe4]"/>} aria-label="Pencereyi kapat"><X className="size-5"/></DialogClose>
        {state.suggestions.length>0 && <section className="border-r border-[#e0e4e8] p-8 max-[760px]:border-t max-[760px]:border-r-0 max-[760px]:px-5 max-[760px]:py-6">
          <h2 className="mb-9 text-center text-2xl leading-8 font-semibold tracking-[-.5px] max-[760px]:mb-7 max-[760px]:text-left max-[760px]:text-xl">Bunları da inceleyebilirsin</h2>
          {state.suggestions.map(p=><article key={p.id} className="grid grid-cols-[60px_1fr_auto] items-start gap-4 border-b border-[#dfe3e8] pt-[18px] pb-6 last:border-b-0 last:pb-0">
          <Link className="flex h-20 items-center justify-center text-muted-foreground" href={`/urun/${p.id}`}>{p.image ? <Image className="max-h-20 max-w-[60px] object-contain" src={p.image} width={80} height={80} alt={p.name} unoptimized/> : <Package size={36}/>}</Link>
          <div><Link className="block text-sm leading-5 font-medium text-foreground hover:text-primary" href={`/urun/${p.id}`}>{p.name}</Link><strong className="mt-2.5 mb-1 block text-sm text-[#007bc4]">{money(p.price)}</strong><small className="text-[13px] text-muted-foreground">KDV dahil · Kargo hariç</small></div>
          <form action={action}><input type="hidden" name="productId" value={p.id}/><input type="hidden" name="quantity" value="1"/><Button type="submit" variant="outline" className={cn(outline,"min-h-[42px] px-3 py-2.5 text-[13px]")} disabled={pending}>Sepete ekle</Button></form>
        </article>)}</section>}
        <section className="bg-[#f8f9f9] p-8 max-[760px]:row-start-1 max-[760px]:px-5 max-[760px]:py-7">
          <DialogTitle id={titleId} className="mb-9 flex items-center gap-2.5 text-2xl leading-8 font-semibold tracking-[-.5px] max-[760px]:mb-7 max-[760px]:text-[22px] max-[760px]:leading-7"><CheckCircle2 size={30} className="shrink-0 text-[#459938]"/>Ürün sepetine eklendi</DialogTitle>
          <div className="mb-8 flex items-start gap-6 text-sm leading-5">
            <Link className="grid size-20 shrink-0 place-items-center rounded-[5px] border border-input bg-white text-muted-foreground" href={`/urun/${state.added.id}`}>{state.added.image ? <Image className="size-16 object-contain" src={state.added.image} width={80} height={80} alt={state.added.name} unoptimized/> : <Package size={36}/>}</Link>
            <div><Link className="mb-2.5 block font-medium text-foreground hover:text-primary" href={`/urun/${state.added.id}`}>{state.added.name}</Link><div className="flex items-center gap-6 [&_select]:h-8 [&_select]:min-h-8 [&_select]:w-[54px] [&_select]:rounded-[5px] [&_select]:border [&_select]:border-input [&_select]:bg-white [&_select]:px-2 [&_select]:py-1 [&_select]:text-sm"><CartQuantity key={`${state.added.id}-${state.added.quantity}`} productId={state.added.id} name={state.added.code} quantity={state.added.quantity} maxQuantity={state.added.maxQuantity}/><strong className="text-sm font-medium">{money(state.added.price)}</strong></div></div>
          </div>
          <DialogClose render={<Button variant="outline" className={cn(outline,"mb-4 w-full")}/>}>Alışverişe devam et</DialogClose>
          <Button className="h-auto min-h-12 w-full gap-2.5 rounded-[5px] border-[#007bc4] bg-[#007bc4] px-4 py-3 text-sm leading-5 font-semibold text-white hover:bg-[#006bb0]" nativeButton={false} render={<Link href="/siparis-olustur"/>}><LockKeyhole className="size-[18px]"/>Siparişi tamamla</Button>
          <Link className="mt-4 block text-center text-[13px] text-[#0065a5] hover:underline" href="/sepet">Sepeti görüntüle</Link>
        </section>
      </DialogContent>}
    </Dialog>
  </>;
}
