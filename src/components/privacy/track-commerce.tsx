"use client";

import { useEffect, useRef } from "react";
import { claimPurchaseEvent } from "@/app/(store)/siparis/[id]/actions";
import { subscribeConsent } from "@/lib/cookie-consent";
import { beginCheckout, removeFromCart, viewCart, type AnalyticsItem } from "@/modules/analytics/events";
import { TAG_READY_EVENT, canTrack, track } from "@/modules/analytics/track";
import { useSendOnce } from "./track-events";

/** The cart page (#675): view_cart once, remove_from_cart when a line's "Kaldır" form (`data-cart-remove`) is submitted. */
export function TrackCart({ items }: { items: AnalyticsItem[] }) {
  useSendOnce(() => !items.length || track("view_cart", viewCart(items)));
  // A double click submits "Kaldır" twice; the line leaves the cart once.
  const removed = useRef(new Set<string>());
  useEffect(() => {
    const onSubmit = (event: SubmitEvent) => {
      const form = (event.target as Element | null)?.closest<HTMLFormElement>("form[data-cart-remove]");
      const id = form?.querySelector<HTMLInputElement>("input[name='productId']")?.value;
      const item = items.find(entry => entry.item_id === id);
      if (!item || removed.current.has(item.item_id)) return;
      removed.current.add(item.item_id);
      track("remove_from_cart", removeFromCart(item, item.quantity));
    };
    document.addEventListener("submit", onSubmit);
    return () => document.removeEventListener("submit", onSubmit);
  }, [items]);
  return null;
}

/** The checkout page (#675): begin_checkout once, for the priced lines. */
export function TrackBeginCheckout({ items }: { items: AnalyticsItem[] }) {
  useSendOnce(() => !items.length || track("begin_checkout", beginCheckout(items)));
  return null;
}

/**
 * A paid order's page (#675). The server hands the purchase event out once per order, so it is only asked when the event can
 * be queued right now (tag loaded, analytics allowed); otherwise it waits for the tag or a consent change. A tab closed
 * before the answer arrives loses the event (at most once, never twice).
 */
export function TrackPurchase({ orderId }: { orderId: string }) {
  const started = useRef(false);
  useEffect(() => {
    const attempt = () => {
      if (started.current || !canTrack()) return;
      started.current = true;
      claimPurchaseEvent(orderId).then(
        payload => { if (payload) track("purchase", payload); },
        // No answer (network, deploy): try again on the next signal; an order already claimed just answers null.
        () => { started.current = false; },
      );
    };
    attempt();
    const unsubscribe = subscribeConsent(attempt);
    window.addEventListener(TAG_READY_EVENT, attempt);
    return () => { unsubscribe(); window.removeEventListener(TAG_READY_EVENT, attempt); };
  }, [orderId]);
  return null;
}
