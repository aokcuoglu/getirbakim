"use client";

import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { loadedPublicList, publicListFetch } from "@/components/public-list-fetch";
import { isReferenceRow, type ReferenceRow, type ReferenceView } from "@/modules/store/product-reference-view";

/** How long a load may take before it shows: a fast answer does not flash the loading state. */
const loadingDelay = 180;

// The product page's OEM and equivalent numbers (#1211). The rows come finished from the server
// (product-reference-view.ts), so the markup goes out once (HTML) plus the compact rows. A long list ships a capped
// selection; "Tüm {n} markayı göster" ("Tüm numaraları göster" when only numbers were left out) loads the whole list
// from `view.rest` (public-list-fetch.ts) in its place, moves focus to it and says so in a status line.
export function ProductReferences({ view, title }: { view: ReferenceView; title: string }) {
  const listRef = useRef<HTMLDivElement>(null);
  const [all, setAll] = useState<ReferenceRow[] | null>(() => view.rest ? loadedPublicList<ReferenceRow>(view.rest) : null);
  const [loading, setLoading] = useState(false);
  // Whether the load waited `loadingDelay`: the loading label shows from then on (aria-busy at once).
  const [slow, setSlow] = useState(false);
  // A load failed: the button reads "Tekrar dene" from then on; the alert shows while no new load runs.
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!loading) return;
    const timer = setTimeout(() => setSlow(true), loadingDelay);
    return () => clearTimeout(timer);
  }, [loading]);

  const load = () => {
    if (!view.rest || loading) return;
    setSlow(false);
    setLoading(true);
    publicListFetch(view.rest, "rows", isReferenceRow, "Numaraların tamamı yüklenemedi.").then(list => {
      // The button leaves with the printed selection: focus goes to the whole list.
      flushSync(() => { setAll(list); setLoading(false); });
      listRef.current?.focus();
    }, () => { setLoading(false); setFailed(true); });
  };

  // Every brand is printed and only numbers were left out: the button and the status line speak of numbers.
  const everyBrand = view.rows.length === view.rowCount;
  const showAll = everyBrand ? "Tüm numaraları göster" : `Tüm ${view.rowCount} markayı göster`;
  const listed = everyBrand ? "Tüm numaralar listelendi" : `Tüm ${view.rowCount} marka listelendi`;
  return <section className="mt-[42px] scroll-mt-[110px]" id="oem-numaralari">
    <h2 className="reference-title">{title}</h2>
    <div ref={listRef} className="reference-list" tabIndex={0} role="region" aria-label="OEM ve muadil numaraları"><dl>{(all ?? view.rows).map(([brand, codes, more]) => <div key={brand} className="reference-row">
      <dt>{brand}</dt>
      <dd>
        {codes.map(code => typeof code === "string" ? <span key={code}>{code}</span> : <Link key={code[0]} className="reference-link" href={code[1]}>{code[0]}</Link>)}
        {more ? <span className="reference-more">{`+${more} numara`}</span> : null}
      </dd>
    </div>)}</dl></div>
    {view.rest && <p className="sr-only" role="status">{all ? listed : ""}</p>}
    {view.rest && !all && <div className="mt-2 flex flex-wrap items-center gap-x-3 text-sm leading-5">
      {failed && !loading && <span role="alert">Numaraların tamamı yüklenemedi.</span>}
      <button type="button" className="fitment-text-button w-full" aria-busy={loading} aria-disabled={loading} onClick={load}>
        {loading && slow ? <><Loader2 className="animate-spin" aria-hidden="true"/>Yükleniyor…</> : failed ? "Tekrar dene" : showAll}
      </button>
    </div>}
  </section>;
}
