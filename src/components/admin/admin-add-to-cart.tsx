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
  return <div className="flex flex-col gap-1">
    <form action={action} className="flex gap-2">
      <input type="hidden" name="productId" value={productId}/>
      <NativeSelect aria-label={`${name} için adet`} name="quantity" defaultValue={1} disabled={!available || pending}>
        {Array.from({ length: 99 }, (_, i) => <NativeSelectOption key={i + 1} value={i + 1}>{i + 1}</NativeSelectOption>)}
      </NativeSelect>
      <Button type="submit" variant={available ? "default" : "outline"} disabled={!available || pending}>{pending ? "Ekleniyor…" : "Sepete ekle"}</Button>
    </form>
    <p role="status" className="text-sm">
      {state.error && <span className="text-destructive">{state.error} </span>}
      {state.added && <span>Sepete eklendi · </span>}
      {(state.error || state.added) && <Button variant="link" nativeButton={false} render={<Link href="/sepet"/>}>Sepeti aç</Button>}
    </p>
  </div>;
}
