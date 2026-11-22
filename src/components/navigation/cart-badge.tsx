"use client";
import { startTransition, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { IntentLink } from "@/components/intent-link";
import { useRouter } from "next/navigation";
import { SiteIcon } from "@/components/site/site-icon";
import { cartCount } from "@/modules/store/cart-count";

/** The header cart link; the server count seeds the client store, add-to-cart actions update it without re-rendering the page. */
export function CartBadge({ count, renderedAt, className }: { count: number; renderedAt: number; className?: string }) {
  useLayoutEffect(() => cartCount.seed(count, renderedAt), [count, renderedAt]);
  const shown = useSyncExternalStore(cartCount.subscribe, () => cartCount.get() ?? count, () => count);
  return <IntentLink href="/sepet" className={className} aria-label={`Sepetim, ${shown} ürün`}>
    <SiteIcon name="cart" size={32} />
    {shown > 0 && <b className="absolute top-1 right-0.5 h-4 min-w-4 rounded-full bg-[#d7452f] px-[3px] text-center text-[10px] leading-4 font-bold text-white">{shown}</b>}
  </IntentLink>;
}

/**
 * On cart-backed pages (sepet, checkout): when the cart changed elsewhere (another tab, or a back/forward
 * cache entry rendered before an add), refresh the page once so its lines match the badge.
 */
export function CartFreshness({ count }: { count: number }) {
  const router = useRouter();
  const refreshedFor = useRef<number | null>(null);
  useEffect(() => {
    const check = () => {
      const current = cartCount.get();
      if (current === null || current === count || refreshedFor.current === current) return;
      refreshedFor.current = current;
      startTransition(() => router.refresh());
    };
    check();
    return cartCount.subscribe(check);
  }, [count, router]);
  return null;
}
