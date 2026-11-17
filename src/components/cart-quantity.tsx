"use client";
import { useState, useTransition } from "react";
import { changeCartQuantity } from "@/app/(store)/sepet/actions";
import { cartCount } from "@/modules/store/cart-count";
import { addToCart, removeFromCart, type AnalyticsItem } from "@/modules/analytics/events";
import { track } from "@/modules/analytics/track";

/**
 * Native select on purpose: callers (cart page, purchase popup) restyle it with `[&_select]:` utilities.
 * `refreshPage` (cart page) re-renders the page with the change; otherwise (popup) only the header badge is updated.
 * Either way the new total goes to the badge store, which also updates other tabs.
 * With `analyticsItem` a change is measured as add_to_cart / remove_from_cart for the difference (#675).
 */
export function CartQuantity({ productId, name, quantity, maxQuantity = 99, className, refreshPage = false, analyticsItem }: { productId: string; name: string; quantity: number; maxQuantity?: number; className?: string; refreshPage?: boolean; analyticsItem?: AnalyticsItem }) {
  const [value, setValue] = useState(quantity);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  return <div className={className}><select aria-label={`${name} adedi`} value={value} disabled={pending} className="h-12 w-16 max-[767.98px]:w-[72px] rounded-[5px] border border-input bg-white px-2.5 py-2 text-sm text-foreground transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60" onChange={event => {
    const next=Number(event.target.value);
    startTransition(async () => {
      const result=await changeCartQuantity(productId,next,refreshPage);
      if(result.error) setError(result.error);
      else {
        const delta=next-value;
        setValue(next); setError("");
        if(analyticsItem && delta<0) track("remove_from_cart",removeFromCart(analyticsItem,-delta));
        else if(analyticsItem && delta>0) track("add_to_cart",addToCart(analyticsItem,delta));
        // Also on the cart page: the refreshed page brings this tab's badge, set() reaches the other tabs.
        if(result.cartCount!==undefined) cartCount.set(result.cartCount);
      }
    });
  }}>{Array.from({length:Math.max(quantity,maxQuantity,1)},(_,i)=><option key={i+1} value={i+1}>{i+1}</option>)}</select>{error && <p className="my-2 max-w-[420px] text-[13px] leading-5 text-[#ae3025]" role="alert">{error}</p>}</div>;
}
