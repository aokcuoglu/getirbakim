"use client";
import { useState, useTransition } from "react";
import { changeCartQuantity } from "@/app/sepet/actions";

export function CartQuantity({ productId, name, quantity, maxQuantity = 99 }: { productId: string; name: string; quantity: number; maxQuantity?: number }) {
  const [value, setValue] = useState(quantity);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  return <div className="cart-quantity"><select aria-label={`${name} adedi`} value={value} disabled={pending} onChange={event => {
    const next=Number(event.target.value);
    startTransition(async () => {
      const result=await changeCartQuantity(productId,next);
      if(result.error) setError(result.error);
      else { setValue(next); setError(""); }
    });
  }}>{Array.from({length:Math.max(quantity,maxQuantity,1)},(_,i)=><option key={i+1} value={i+1}>{i+1}</option>)}</select>{error && <p className="purchase-error" role="alert">{error}</p>}</div>;
}
