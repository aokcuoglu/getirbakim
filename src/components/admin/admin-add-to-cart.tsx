"use client";
import Link from "next/link";
import { useActionState } from "react";
import { addToCart } from "@/app/sepet/actions";
import type { PurchaseState } from "@/modules/store/purchase-types";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

const initial: PurchaseState = { error: null, added: null, suggestions: [] };

/** Compact add-to-cart for admin tables: same server action as the storefront, inline result instead of the popup. */
export function AdminAddToCart({ productId, name, available }: { productId: string; name: string; available: boolean }) {
  const [state, action, pending] = useActionState(addToCart, initial);
  return <div className="mt-2 flex flex-col gap-1">
    <form action={action} className="flex gap-1.5">
      <input type="hidden" name="productId" value={productId}/>
      <NativeSelect size="sm" className="w-16" aria-label={`${name} için adet`} name="quantity" defaultValue={1} disabled={!available || pending}>
        {Array.from({ length: 99 }, (_, i) => <NativeSelectOption key={i + 1} value={i + 1}>{i + 1}</NativeSelectOption>)}
      </NativeSelect>
      <Button type="submit" size="sm" variant={available ? "default" : "outline"} disabled={!available || pending}>{pending ? "Ekleniyor…" : "Sepete ekle"}</Button>
    </form>
    <p role="status" className="text-xs">
      {state.error && <span className="text-destructive">{state.error} </span>}
      {state.added && <span className="text-success">Sepete eklendi · </span>}
      {(state.error || state.added) && <Link className="font-medium text-primary hover:underline" href="/sepet">Sepeti aç</Link>}
    </p>
  </div>;
}
