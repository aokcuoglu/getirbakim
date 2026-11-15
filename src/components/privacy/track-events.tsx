"use client";

import { useEffect, useRef } from "react";
import { consentSnapshot, parseConsent, subscribeConsent } from "@/lib/cookie-consent";
import { search, selectItem, viewItem, viewItemList, type AnalyticsItem } from "@/modules/analytics/events";
import { track } from "@/modules/analytics/track";

/** Runs `send` once on mount, or once as soon as analytics consent arrives; the tag boots a tick after consent. */
function useSendOnce(send: () => void) {
  const sent = useRef(false);
  const latest = useRef(send);
  useEffect(() => { latest.current = send; });
  useEffect(() => {
    const attempt = () => {
      if (sent.current || !parseConsent(consentSnapshot())?.analytics) return;
      sent.current = true;
      latest.current();
    };
    attempt();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = subscribeConsent(() => { clearTimeout(timer); timer = setTimeout(attempt, 100); });
    return () => { unsubscribe(); clearTimeout(timer); };
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
    if (searchTerm) track("search", search(searchTerm));
    if (items.length) track("view_item_list", viewItemList({ listId, listName, items }));
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
