"use client";

import { useEffect, useRef } from "react";
import { subscribeConsent } from "@/lib/cookie-consent";
import { search, selectItem, viewItem, viewItemList, type AnalyticsItem } from "@/modules/analytics/events";
import { TAG_READY_EVENT, track } from "@/modules/analytics/track";

/** Runs `send` until it reports the event queued: on mount, when the tag becomes ready, or when consent changes. */
function useSendOnce(send: () => boolean) {
  const sent = useRef(false);
  const latest = useRef(send);
  useEffect(() => { latest.current = send; });
  useEffect(() => {
    // Marked sent only once the event is queued: on a full load this effect runs before the tag boots,
    // so it retries when the tag announces itself (and after a consent change).
    const attempt = () => {
      if (sent.current) return;
      sent.current = latest.current();
    };
    attempt();
    const unsubscribe = subscribeConsent(attempt);
    window.addEventListener(TAG_READY_EVENT, attempt);
    return () => { unsubscribe(); window.removeEventListener(TAG_READY_EVENT, attempt); };
  }, []);
}

export function TrackViewItem({ item }: { item: AnalyticsItem }) {
  return <ViewItem key={item.item_id} item={item} />;
}

function ViewItem({ item }: { item: AnalyticsItem }) {
  useSendOnce(() => track("view_item", viewItem(item)));
  return null;
}

type ListProps = { listId: string; listName: string; items: AnalyticsItem[]; searchTerm?: string };

export function TrackItemList(props: ListProps) {
  // A new filter, page or search on the same route is a new list view.
  return <ItemList key={`${props.listId}|${props.searchTerm ?? ""}|${props.items.map(item => item.item_id).join(",")}`} {...props} />;
}

function ItemList({ listId, listName, items, searchTerm }: ListProps) {
  useSendOnce(() => {
    // Both events are gated on the same conditions, so a retry never sends `search` twice.
    if (searchTerm && !track("search", search(searchTerm))) return false;
    if (!items.length) return true;
    return track("view_item_list", viewItemList({ listId, listName, items }));
  });
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest<HTMLAnchorElement>("[data-catalog-page] a[href^='/urun/']");
      const id = link?.getAttribute("href")?.split(/[/?#]/)[2];
      const item = items.find(entry => entry.item_id === id);
      if (item) track("select_item", selectItem({ listId, listName, items: [item] }));
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [listId, listName, items]);
  return null;
}
