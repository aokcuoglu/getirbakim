"use client";

import { useEffect, useId, useRef, useState, type SyntheticEvent } from "react";
import { flushSync } from "react-dom";
import Link from "next/link";
import { Search, ChevronRight, ArrowRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fitmentEagerModelOptions, mergeFitmentGroups, visibleFitmentGroups, type FitmentGroup, type FitmentView } from "@/modules/store/product-fitment-view";
import {storeButton} from "@/components/store-button";
import {cn} from "@/lib/utils";

const fuelLabels: Record<string, string> = {
  Electric: "Elektrik", Diesel: "Dizel", Petrol: "Benzin", "Petrol/Electric": "Benzin / Elektrik",
  "Diesel/Electric": "Dizel / Elektrik", "Petrol/Ethanol": "Benzin / Etanol",
  "Petrol/Ethanol/Electric": "Benzin / Etanol / Elektrik",
  "Petrol/Compressed Natural Gas (CNG)": "Benzin / CNG",
  "Petrol/Liquified Petroleum Gas (LPG)": "Benzin / LPG",
};

// One request per list, shared by every trigger; a failed one is forgotten so "Tekrar dene" asks again. No cookies: the
// list is the same for everyone and publicly cached (#966). Only the last few lists are kept for a page visited again.
const keptLists = 5;
const requests = new Map<string, Promise<FitmentGroup[]>>();
const loadedLists = new Map<string, FitmentGroup[]>();
function keep<T>(map: Map<string, T>, key: string, value: T) {
  map.delete(key);
  map.set(key, value);
  for (const oldest of map.keys()) if (map.size > keptLists) map.delete(oldest);
}

function fetchFitments(url: string) {
  let request = requests.get(url);
  if (!request) {
    request = fetch(url, { credentials: "omit", signal: AbortSignal.timeout(10_000) }).then(async response => {
      const data: unknown = await response.json();
      const groups = data && typeof data === "object" && "groups" in data ? data.groups : null;
      if (!response.ok || !Array.isArray(groups)) throw new Error("Uyumlu araçlar yüklenemedi.");
      keep(loadedLists, url, groups as FitmentGroup[]);
      return groups as FitmentGroup[];
    }).catch(error => {
      requests.delete(url);
      throw error;
    });
    keep(requests, url, request);
  }
  return request;
}

/** How long a load may take before it shows: a fast answer does not flash the loading state. */
const loadingDelay = 180;

// The rows come grouped by model from the server (product-fitment-view.ts). Up to `fitmentInitialGroups` groups print
// until "Tüm … modeli göster", a search or a make/model choice (#642); a long model select fills when first used. A
// product with more groups ships only the first ones (#966): the rest loads from `view.rest` when the controls are
// pointed at or (past `fitmentEagerModelOptions` models) the list scrolls into view, and when they are used.
export function ProductFitment({ view }: { view: FitmentView }) {
  const inputId = useId();
  const sectionRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [make, setMake] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [allModels, setAllModels] = useState(false);
  const [all, setAll] = useState<FitmentGroup[] | null>(() => view.rest ? loadedLists.get(view.rest) ?? null : null);
  // "warming": asked ahead of use; "loading": a visitor's action waits for the list; "error": that action's load failed.
  const [status, setStatus] = useState<"idle" | "warming" | "loading" | "error">("idle");
  // Whether a load waited `loadingDelay`: the loading state shows from then on (aria-busy at once).
  const [slow, setSlow] = useState(false);
  // "Tekrar dene" was pressed: the alert stays (busy) until the answer, so its focused button does not vanish.
  const [retrying, setRetrying] = useState(false);
  // Whether the list opens once loaded ("Tüm … modeli göster", kept through a failure for "Tekrar dene"); read in the
  // request's callbacks only.
  const reveal = useRef(false);
  const pending = Boolean(view.rest) && !all;
  const merged = all && mergeFitmentGroups(view.groups, all);
  const shown: FitmentView = merged ? { ...view, groups: merged, groupCount: merged.length, rest: undefined } : view;
  const { groups, matches, hidden } = visibleFitmentGroups(shown, { make, model: selectedModel, query, showAll });
  const searching = Boolean(query.trim()), filtering = searching || Boolean(make || selectedModel);
  const loading = pending && status === "loading", failed = pending && status === "error", showLoading = loading && slow;
  const makeLabels = new Map(view.makes);
  const pairs = pending ? view.models : shown.groups.map((group): [string, string] => [group.make, group.model]);
  const models = (pairs ?? []).filter(([groupMake]) => !make || groupMake === make).map(([, model]) => model);
  const modelOptions = !pairs ? (selectedModel ? [selectedModel] : [])
    : make || allModels || models.length <= fitmentEagerModelOptions ? models : selectedModel ? [selectedModel] : [];

  useEffect(() => {
    if (!loading) return;
    const timer = setTimeout(() => setSlow(true), loadingDelay);
    return () => clearTimeout(timer);
  }, [loading]);

  const loaded = (list: FitmentGroup[]) => {
    // "Tekrar dene" leaves with the alert: its focus goes to the first new group, else the first group or the search.
    const retried = Boolean(alertRef.current?.contains(document.activeElement));
    const opening = reveal.current;
    reveal.current = false;
    flushSync(() => { setAll(list); setStatus("idle"); setSlow(false); setRetrying(false); if (opening) setShowAll(true); });
    const triggers = listRef.current?.querySelectorAll<HTMLElement>(".fitment-trigger");
    if (opening) triggers?.[view.groups.length]?.focus();
    else if (retried) (triggers?.[0] ?? document.getElementById(inputId))?.focus();
  };
  // A failed warm-up stays quiet; the next use asks again.
  const failedLoad = () => {
    setSlow(false);
    setRetrying(false);
    setStatus(current => current === "loading" ? "error" : current === "warming" ? "idle" : current);
  };
  const load = (definite: boolean) => {
    if (!view.rest || all || status === "loading" || (!definite && status !== "idle")) return;
    const asked = status === "warming";
    if (definite) setSlow(false);
    setStatus(definite ? "loading" : "warming");
    // A warm-up already asked: its callbacks answer the visitor's action too.
    if (!asked) fetchFitments(view.rest).then(loaded, failedLoad);
  };
  const warm = () => load(false);

  // Past `fitmentEagerModelOptions` models the page sends no model names: the list loads once the section is in view,
  // so the model select is filled before the first tap on a phone.
  const warmOnView = Boolean(view.rest && !view.models && !all);
  useEffect(() => {
    const section = sectionRef.current;
    if (!warmOnView || !view.rest || !section || typeof IntersectionObserver === "undefined") return;
    const url = view.rest;
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      setStatus(current => current === "idle" ? "warming" : current);
      fetchFitments(url).then(loaded, failedLoad);
    }, { rootMargin: "200px 0px" });
    observer.observe(section);
    return () => observer.disconnect();
    // The callbacks read refs and setters only; the observer runs once per list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [warmOnView, view.rest]);

  const revealAll = () => {
    if (pending) {
      if (loading) return;
      reveal.current = true;
      load(true);
      return;
    }
    flushSync(() => setShowAll(true));
    listRef.current?.querySelectorAll<HTMLElement>(".fitment-trigger")[view.groups.length]?.focus();
  };
  const reset = () => {
    setMake(""); setSelectedModel(""); setQuery("");
    if (failed) { reveal.current = false; setRetrying(false); setStatus("idle"); }
  };
  const pointModels = (event: SyntheticEvent) => {
    event.stopPropagation();
    setAllModels(true);
    warm();
  };
  const openModels = (event: SyntheticEvent) => {
    event.stopPropagation();
    setAllModels(true);
    load(!view.models);
  };
  const statusText = showLoading ? "Tüm araçlar yükleniyor…"
    : filtering ? `${matches} eşleşme bulundu` : `${shown.groupCount} model serisi · Motor ayrıntıları için aç`;

  const select="w-[200px] max-[1000px]:w-40 max-[750px]:w-full [&>select]:h-10 [&>select]:rounded-[5px] [&>select]:bg-white [&>select]:px-3 [&>select]:text-sm [&>svg]:text-foreground";
  return <section ref={sectionRef} className="mt-[42px] scroll-mt-[110px]" id="uyumlu-araclar" aria-labelledby="fitment-title">
    <h2 id="fitment-title" className="mb-6 text-[26px] leading-[34px] font-semibold tracking-[-.6px] max-[750px]:mb-5 max-[750px]:text-[23px] max-[750px]:leading-[30px]">Uyumlu araçlar</h2>
    <p className="-mt-2.5 mb-[18px] text-xs leading-5 text-[#53677d]">{view.total} uyumlu araç kaydı</p>
    <div className="flex flex-wrap items-center gap-2 rounded-t-lg border border-[#dce2e9] bg-white p-4" onPointerEnter={warm} onFocus={warm} onTouchStart={warm}>
      <label className="max-[750px]:min-w-[110px] max-[750px]:flex-1"><span className="sr-only">Araç markası</span><NativeSelect className={select} value={make} onChange={event => { setMake(event.target.value); setSelectedModel(""); if (event.target.value) load(true); }}><option value="">Marka</option>{view.makes.map(([value]) => <option key={value} value={value}>{makeLabels.get(value)}</option>)}</NativeSelect></label>
      <label className="max-[750px]:min-w-[110px] max-[750px]:flex-1"><span className="sr-only">Araç modeli</span><NativeSelect className={select} value={selectedModel} onPointerEnter={pointModels} onPointerDown={openModels} onTouchStart={openModels} onFocus={openModels} onChange={event => { setSelectedModel(event.target.value); if (event.target.value) load(true); }}><option value="">Model</option>{modelOptions.map(model => <option key={model} value={model}>{model}</option>)}{!pairs && <option disabled value="__loading">{failed ? "Modeller yüklenemedi" : "Modeller yükleniyor…"}</option>}</NativeSelect></label>
      <Button type="button" variant="ghost" className={cn(storeButton({intent:"ghost",size:"md"}),"px-5 text-[#0065c3] hover:text-[#0065c3]")} onClick={reset}>Sıfırla</Button>
    <label className="flex h-10 min-w-40 flex-1 items-center gap-3 rounded-[5px] border border-[#e5e7eb] px-3.5 text-muted-foreground focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 max-[750px]:basis-full" htmlFor={inputId}><Search size={18}/><input id={inputId} type="search" className="h-[38px] w-full min-w-0 border-0 bg-transparent py-2 text-[13px] text-foreground outline-none placeholder:text-muted-foreground" value={query} onChange={event => { setQuery(event.target.value); if (event.target.value.trim()) load(true); }} placeholder="Model, motor kodu veya yıl ara"/><span className="sr-only">Uyumlu araçlarda ara</span></label>
    </div>
    <p className="m-0 border-x border-[#dce2e9] bg-white px-4 py-3 text-xs leading-5 text-muted-foreground" role="status">{statusText}</p>
    {(failed || (loading && retrying)) && <div ref={alertRef} className="flex flex-wrap items-center gap-x-3 border-x border-t border-[#dce2e9] bg-white px-4 text-sm leading-5" role="alert"><span>Araç listesinin tamamı yüklenemedi.{filtering && ` Yalnız ilk ${view.groups.length} model içinde arandı.`}</span><Button type="button" variant="ghost" className="h-auto min-h-11 gap-2 px-2 text-primary hover:text-primary hover:underline aria-disabled:cursor-progress aria-disabled:no-underline" aria-busy={loading} aria-disabled={loading} onClick={() => { if (!loading) { setRetrying(true); load(true); } }}>{showLoading ? <><Loader2 className="animate-spin" aria-hidden="true"/>Yükleniyor…</> : "Tekrar dene"}</Button></div>}
    <div ref={listRef} className="overflow-hidden rounded-b-lg border border-t-0 border-[#dce2e9] bg-white">
      {groups.map(({ model, href, rows }) => <Collapsible key={model + (searching ? "-search" : "")} defaultOpen={searching} className="fitment-group">
        <div className="flex items-center hover:bg-[#f7f8fa]">
        <CollapsibleTrigger className="fitment-trigger"><ChevronRight size={18} aria-hidden="true"/><strong className="font-medium">{model}</strong><span className="fitment-count">{rows.length} seçenek</span></CollapsibleTrigger>
        {href && <Link prefetch={false} href={href} className="fitment-link"><span className="max-[750px]:sr-only">Model sayfası</span><span className="sr-only">: {model} parçaları</span><ArrowRight size={14} aria-hidden="true"/></Link>}
        </div>
        <CollapsibleContent>
        <div className="overflow-x-auto border-t border-border" tabIndex={0} role="region" aria-label={`${model} motor seçenekleri`}>
          <Table className="min-w-[540px] border-collapse text-left text-xs leading-5"><TableHeader className="[&_tr]:border-0"><TableRow className="hover:bg-transparent">{["Motor / motor kodu","Güç / hacim","Üretim aralığı","Veri bağlantısı"].map(label => <TableHead key={label} scope="col" className="h-auto bg-[#f7f8fa] px-4 py-3 font-medium text-muted-foreground">{label}</TableHead>)}</TableRow></TableHeader><TableBody>
            {rows.map(row => <TableRow key={`${row.engine}-${row.fuel}-${row.ps}-${row.kw}-${row.cc}-${row.from}-${row.to}`} className="fitment-row border-0 hover:bg-transparent">
              <TableCell className="w-[48%] whitespace-normal"><strong className="font-medium">{row.catalog ?? row.engine}</strong>{row.catalog && <small>Kaynak motor bilgisi: {row.engine}</small>}<small>{fuelLabels[row.fuel] || row.fuel}</small></TableCell>
              <TableCell className="whitespace-normal">{row.ps} PS · {row.kw} kW{row.cc > 0 && <small>{row.cc} cm³</small>}</TableCell>
              <TableCell className="whitespace-normal">{row.from} – {row.to || "Bitiş belirtilmemiş"}</TableCell>
              <TableCell>{row.typeId ? <span className="text-[11px] whitespace-nowrap text-[#26734d]" title={`Araç tipi: ${row.typeId}`}>Kataloğa bağlı</span> : <span className="text-[11px] whitespace-nowrap text-[#68778a]">Kaynak kaydı</span>}</TableCell>
            </TableRow>)}
          </TableBody></Table>
        </div>
        </CollapsibleContent>
      </Collapsible>)}
      {hidden > 0 && <Button type="button" variant="ghost" className="h-auto min-h-11 w-full gap-2 rounded-none border-0 border-t border-border px-4 py-3 text-primary hover:text-primary hover:underline aria-disabled:cursor-progress aria-disabled:no-underline" aria-busy={loading} aria-disabled={loading} onPointerEnter={warm} onFocus={warm} onTouchStart={warm} onClick={revealAll}>{showLoading ? <><Loader2 className="animate-spin" aria-hidden="true"/>Modeller yükleniyor…</> : `Tüm ${shown.groupCount} modeli göster`}</Button>}
    </div>
    {matches === 0 && !loading && !failed && <p className="rounded-lg bg-[#f7f8fa] p-6 text-sm">Bu aramayla eşleşen araç bulunamadı. Model veya motor koduyla tekrar ara.</p>}
  </section>;
}
