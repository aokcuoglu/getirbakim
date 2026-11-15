"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { productTabHref, tabOfAnchor, visibleProductTabs, type ProductTab } from "@/modules/admin/product-tabs";

/**
 * Old `…/urunler/<id>#birlestir` style links: the server never sees the hash, so the tab holding that card is opened
 * from here; the navigation keeps its default scroll, so the browser lands on the card by the hash. The active tab is
 * also brought into view in the strip on small screens. Renders nothing.
 */
export function ProductTabAnchor({ id, tab, merged }: { id: string; tab: ProductTab; merged: boolean }) {
  const router = useRouter();
  const search = useSearchParams();
  useEffect(() => {
    document.querySelector('[aria-label="Ürün bölümleri"] [aria-selected="true"]')?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [tab]);
  useEffect(() => {
    const hash = window.location.hash;
    const wanted = tabOfAnchor(hash);
    if (!wanted || wanted === tab || !visibleProductTabs(merged).some(item => item.key === wanted)) return;
    router.replace(productTabHref(id, wanted, { params: new URLSearchParams(search), hash: hash.slice(1), merged }));
  }, [id, tab, merged, search, router]);
  return null;
}
