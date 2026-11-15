"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { productTabHref, tabOfAnchor, visibleProductTabs, type ProductTab } from "@/modules/admin/product-tabs";

/**
 * Old `…/urunler/<id>#birlestir` style links: the server never sees the hash, so the tab holding that card is opened
 * from here (and the browser scrolls to the card once it renders). Renders nothing.
 */
export function ProductTabAnchor({ id, tab, merged }: { id: string; tab: ProductTab; merged: boolean }) {
  const router = useRouter();
  const search = useSearchParams();
  useEffect(() => {
    const hash = window.location.hash;
    const wanted = tabOfAnchor(hash);
    if (!wanted || wanted === tab || !visibleProductTabs(merged).some(item => item.key === wanted)) return;
    router.replace(productTabHref(id, wanted, { params: new URLSearchParams(search), hash: hash.slice(1), merged }), { scroll: false });
  }, [id, tab, merged, search, router]);
  return null;
}
