"use client";
import { useActionState, useEffect, useId, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import { CheckCircle2, LockKeyhole, Package, X } from "lucide-react";
import { addToCart } from "@/app/sepet/actions";
import { CartQuantity } from "./cart-quantity";
import type { PurchaseState } from "@/modules/store/purchase-types";

const initial: PurchaseState = { error:null, added:null, suggestions:[] };
const money=(value:number)=>new Intl.NumberFormat("tr-TR",{style:"currency",currency:"TRY"}).format(value/100);

export function PurchaseForm({productId,name,available,maxQuantity=99,className="listing-purchase"}:{productId:string;name:string;available:boolean;maxQuantity?:number;className?:string}) {
  const [state,action,pending]=useActionState(addToCart,initial);
  const dialog=useRef<HTMLDialogElement>(null);
  const titleId=useId();
  useEffect(()=>{
    if(state.added) dialog.current?.showModal();
  },[state.added]);
  const close=()=>dialog.current?.close();
  return <>
    <form action={action} className={className}>
      <input type="hidden" name="productId" value={productId}/>
      <select aria-label={`${name} için adet`} name="quantity" defaultValue={1} disabled={!available || pending}>{Array.from({length:Math.max(1,Math.min(maxQuantity,99))},(_,i)=><option key={i+1} value={i+1}>{i+1}</option>)}</select>
      <button disabled={!available || pending}>{pending ? "Ekleniyor…" : "Sepete ekle"}</button>
    </form>
    {state.error && <p className="purchase-error" role="alert">{state.error} <Link href="/sepet">Sepeti aç</Link></p>}
    <dialog ref={dialog} className="purchase-dialog" aria-labelledby={titleId} onClick={event=>{if(event.target===event.currentTarget)close();}}>
      {state.added && <div className={`purchase-popup${state.suggestions.length ? "" : " purchase-popup-single"}`}>
        <button className="purchase-close" onClick={close} aria-label="Pencereyi kapat"><X size={20}/></button>
        {state.suggestions.length>0 && <section className="purchase-suggestions"><h2>Bunları da inceleyebilirsin</h2>{state.suggestions.map(p=><article key={p.id}>
          <Link className="purchase-suggestion-image" href={`/urun/${p.id}`}>{p.image ? <Image src={p.image} width={80} height={80} alt={p.name} unoptimized/> : <Package size={36}/>}</Link>
          <div><Link href={`/urun/${p.id}`}>{p.name}</Link><strong>{money(p.price)}</strong><small>KDV dahil · Kargo hariç</small></div>
          <form action={action}><input type="hidden" name="productId" value={p.id}/><input type="hidden" name="quantity" value="1"/><button className="purchase-outline" disabled={pending}>Sepete ekle</button></form>
        </article>)}</section>}
        <section className="purchase-added"><h2 id={titleId}><CheckCircle2 size={30}/>Ürün sepetine eklendi</h2><div className="purchase-added-item">
          <Link className="purchase-added-image" href={`/urun/${state.added.id}`}>{state.added.image ? <Image src={state.added.image} width={80} height={80} alt={state.added.name} unoptimized/> : <Package size={36}/>}</Link>
          <div><Link href={`/urun/${state.added.id}`}>{state.added.name}</Link><div className="purchase-added-price"><CartQuantity key={`${state.added.id}-${state.added.quantity}`} productId={state.added.id} name={state.added.code} quantity={state.added.quantity} maxQuantity={state.added.maxQuantity}/><strong>{money(state.added.price)}</strong></div></div>
        </div><button className="purchase-outline purchase-continue" onClick={close}>Alışverişe devam et</button><Link className="purchase-primary" href="/siparis-olustur"><LockKeyhole size={18}/>Siparişi tamamla</Link><Link className="purchase-view-cart" href="/sepet">Sepeti görüntüle</Link></section>
      </div>}
    </dialog>
  </>;
}
