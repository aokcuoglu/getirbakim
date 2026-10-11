"use client";
import { useState, useTransition } from "react";
import { changeCartQuantity } from "@/app/sepet/actions";

/** Native select on purpose: callers (cart page, purchase popup) restyle it with `[&_select]:` utilities. */
export function CartQuantity({ productId, name, quantity, maxQuantity = 99, className }: { productId: string; name: string; quantity: number; maxQuantity?: number; className?: string }) {
  const [value, setValue] = useState(quantity);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  return <div className={className}><select aria-label={`${name} adedi`} value={value} disabled={pending} className="h-12 w-16 rounded-[5px] border border-input bg-white px-2.5 py-2 text-sm text-foreground transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60" onChange={event => {
    const next=Number(event.target.value);
    startTransition(async () => {
      const result=await changeCartQuantity(productId,next);
      if(result.error) setError(result.error);
      else { setValue(next); setError(""); }
    });
  }}>{Array.from({length:Math.max(quantity,maxQuantity,1)},(_,i)=><option key={i+1} value={i+1}>{i+1}</option>)}</select>{error && <p className="my-2 max-w-[420px] text-[13px] leading-5 text-[#ae3025]" role="alert">{error}</p>}</div>;
}
