"use client";

import { useEffect, useRef } from "react";
import { claimRefundEvent } from "@/app/(store)/siparis/[id]/actions";
import { subscribeConsent } from "@/lib/cookie-consent";
import { TAG_READY_EVENT, canTrack, track } from "@/modules/analytics/track";

/**
 * A cancelled paid order's page (#750). Like the purchase, the server hands the refund event out once per order, so it is
 * only asked when the event can be queued right now; otherwise it waits for the tag or a consent change.
 */
export function TrackRefund({ orderId }: { orderId: string }) {
  const started = useRef(false);
  useEffect(() => {
    const attempt = () => {
      if (started.current || !canTrack()) return;
      started.current = true;
      claimRefundEvent(orderId).then(
        payload => { if (payload) track("refund", payload); },
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
