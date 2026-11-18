"use client";

import { useId, useRef, useState, type SyntheticEvent } from "react";
import { flushSync } from "react-dom";
import Link from "next/link";
import { Search, ChevronRight, ArrowRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fitmentEagerModelOptions, mergeFitmentGroups, visibleFitmentGroups, type FitmentGroup, type FitmentView } from "@/modules/store/product-fitment-view";

const fuelLabels: Record<string, string> = {
  Electric: "Elektrik", Diesel: "Dizel", Petrol: "Benzin", "Petrol/Electric": "Benzin / Elektrik",
  "Diesel/Electric": "Dizel / Elektrik", "Petrol/Ethanol": "Benzin / Etanol",
  "Petrol/Ethanol/Electric": "Benzin / Etanol / Elektrik",
  "Petrol/Compressed Natural Gas (CNG)": "Benzin / CNG",
  "Petrol/Liquified Petroleum Gas (LPG)": "Benzin / LPG",
};

// One request per list and page load, shared by every trigger; a failed one is forgotten so "Tekrar dene" asks again.
// No cookies: the list is the same for everyone and publicly cached (#966).
const requests = new Map<string, Promise<FitmentGroup[]>>();
const loadedLists = new Map<string, FitmentGroup[]>();

function fetchFitments(url: string) {
  let request = requests.get(url);
  if (!request) {
    request = fetch(url, { credentials: "omit", signal: AbortSignal.timeout(10_000) }).then(async response => {
      const data: unknown = await response.json();
      const groups = data && typeof data === "object" && "groups" in data ? data.groups : null;
      if (!response.ok || !Array.isArray(groups)) throw new Error("Uyumlu araçlar yüklenemedi.");
      loadedLists.set(url, groups as FitmentGroup[]);
      return groups as FitmentGroup[];
    }).catch(error => {
      requests.delete(url);
      throw error;
    });
    requests.set(url, request);
  }
  return request;
}

// The rows come grouped by model from the server (product-fitment-view.ts). Up to `fitmentInitialGroups` groups print
// until "Tüm … modeli göster", a search or a make/model choice (#642); a long model select fills when first used. A
// product with more groups ships only the first ones (#966): the rest loads from `view.rest` when the filters are
// pointed at (warm) or used, or the button is pressed.
export function ProductFitment({ view }: { view: FitmentView }) {
  const inputId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [make, setMake] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [allModels, setAllModels] = useState(false);
  const [all, setAll] = useState<FitmentGroup[] | null>(() => view.rest ? loadedLists.get(view.rest) ?? null : null);
  // "warming": asked ahead of use (pointer or focus on the controls); "loading": a visitor's action waits for the list.
  const [status, setStatus] = useState<"idle" | "warming" | "loading" | "error">("idle");
  // Whether the button's reveal waits for the list; read in the request's callback only.
  const reveal = useRef(false);
  const pending = Boolean(view.rest) && !all;
  const merged = all && mergeFitmentGroups(view.groups, all);
  const shown: FitmentView = merged ? { ...view, groups: merged, groupCount: merged.length, rest: undefined } : view;
  const { groups, matches, hidden } = visibleFitmentGroups(shown, { make, model: selectedModel, query, showAll });
  const searching = Boolean(query.trim()), filtering = searching || Boolean(make || selectedModel);
  const loading = pending && status === "loading", failed = pending && status === "error";
  const makeLabels = new Map(view.makes);
  const pairs = pending ? view.models : shown.groups.map((group): [string, string] => [group.make, group.model]);
  const models = (pairs ?? []).filter(([groupMake]) => !make || groupMake === make).map(([, model]) => model);
  const modelOptions = !pairs ? (selectedModel ? [selectedModel] : [])
    : make || allModels || models.length <= fitmentEagerModelOptions ? models : selectedModel ? [selectedModel] : [];
  // The first newly shown model takes the focus the removed button had.
  const focusFirstNew = () => listRef.current?.querySelectorAll<HTMLElement>(".fitment-trigger")[view.groups.length]?.focus();
  const load = (definite: boolean) => {
    if (!view.rest || all || status === "loading" || (!definite && status !== "idle")) return;
    const request = status !== "warming";
    setStatus(definite ? "loading" : "warming");
    // A warm-up already asked: its callbacks answer the visitor's action too.
    if (!request) return;
    fetchFitments(view.rest).then(list => {
      if (reveal.current) {
        reveal.current = false;
        flushSync(() => { setAll(list); setShowAll(true); setStatus("idle"); });
        focusFirstNew();
      } else { setAll(list); setStatus("idle"); }
    }, () => {
      reveal.current = false;
      // A failed warm-up stays quiet; the next use asks again.
      setStatus(current => current === "loading" ? "error" : "idle");
    });
  };
  const warm = () => load(false);
  const revealAll = () => {
    if (pending) {
      if (loading) return;
      reveal.current = true;
      load(true);
      return;
    }
    flushSync(() => setShowAll(true));
    focusFirstNew();
  };
  const reset = () => {
    setMake(""); setSelectedModel(""); setQuery("");
    if (failed) setStatus("idle");
  };
  // Pointing at the model select fills it; opening it (press, touch, focus) waits for the list when the page has no models.
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

  const select="w-[200px] max-[1000px]:w-40 max-[750px]:w-full [&>select]:h-10 [&>select]:rounded-[5px] [&>select]:bg-white [&>select]:px-3 [&>select]:text-sm [&>svg]:text-foreground";
  return <section className="mt-[42px] scroll-mt-[110px]" id="uyumlu-araclar" aria-labelledby="fitment-title">
    <h2 id="fitment-title" className="mb-6 text-[26px] leading-[34px] font-semibold tracking-[-.6px] max-[750px]:mb-5 max-[750px]:text-[23px] max-[750px]:leading-[30px]">Uyumlu araçlar</h2>
    <p className="-mt-2.5 mb-[18px] text-xs leading-5 text-[#53677d]">{view.total} uyumlu araç kaydı</p>
    <div className="flex flex-wrap items-center gap-2 rounded-t-lg border border-[#dce2e9] bg-white p-4" onPointerEnter={warm} onFocus={warm} onTouchStart={warm}>
      <label className="max-[750px]:min-w-[110px] max-[750px]:flex-1"><span className="sr-only">Araç markası</span><NativeSelect className={select} value={make} onChange={event => { setMake(event.target.value); setSelectedModel(""); if (event.target.value) load(true); }}><option value="">Marka</option>{view.makes.map(([value]) => <option key={value} value={value}>{makeLabels.get(value)}</option>)}</NativeSelect></label>
      <label className="max-[750px]:min-w-[110px] max-[750px]:flex-1"><span className="sr-only">Araç modeli</span><NativeSelect className={select} value={selectedModel} onPointerEnter={pointModels} onPointerDown={openModels} onTouchStart={openModels} onFocus={openModels} onChange={event => { setSelectedModel(event.target.value); if (event.target.value) load(true); }}><option value="">Model</option>{modelOptions.map(model => <option key={model} value={model}>{model}</option>)}{!pairs && <option disabled value="__loading">Modeller yükleniyor…</option>}</NativeSelect></label>
      <Button type="button" variant="ghost" className="h-10 min-h-0 bg-transparent px-5 text-sm text-[#0065c3] hover:bg-muted hover:text-[#0065c3]" onClick={reset}>Sıfırla</Button>
    <label className="flex h-10 min-w-40 flex-1 items-center gap-3 rounded-[5px] border border-[#e5e7eb] px-3.5 text-muted-foreground focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 max-[750px]:basis-full" htmlFor={inputId}><Search size={18}/><input id={inputId} type="search" className="h-[38px] w-full min-w-0 border-0 bg-transparent py-2 text-[13px] text-foreground outline-none placeholder:text-muted-foreground" value={query} onChange={event => { setQuery(event.target.value); if (event.target.value.trim()) load(true); }} placeholder="Model, motor kodu veya yıl ara"/><span className="sr-only">Uyumlu araçlarda ara</span></label>
    </div>
    <p className="m-0 border-x border-[#dce2e9] bg-white px-4 py-3 text-xs leading-5 text-muted-foreground" role="status">{!filtering ? `${shown.groupCount} model serisi · Motor ayrıntıları için aç`
      : loading ? "Tüm araçlar yükleniyor…" : failed ? `${matches} eşleşme bulundu · Yalnız ilk ${view.groups.length} model içinde arandı` : `${matches} eşleşme bulundu`}</p>
    {failed && <div className="flex flex-wrap items-center gap-x-3 border-x border-t border-[#dce2e9] bg-white px-4 text-sm leading-5" role="alert"><span>Araç listesinin tamamı yüklenemedi.</span><button type="button" className="min-h-11 cursor-pointer border-0 bg-transparent font-medium text-[#0065c3] hover:underline focus-visible:outline-2 focus-visible:outline-[#2e78c7]" onClick={() => load(true)}>Tekrar dene</button></div>}
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
      {hidden > 0 && <button type="button" className="flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 border-0 border-t border-[#e0e5eb] bg-transparent px-4 py-3 text-sm leading-5 font-medium text-[#0065c3] hover:bg-[#f7f8fa] hover:underline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#2e78c7] aria-disabled:cursor-progress" aria-busy={loading} aria-disabled={loading} onPointerEnter={warm} onFocus={warm} onTouchStart={warm} onClick={revealAll}>{loading ? <><Loader2 size={16} className="animate-spin" aria-hidden="true"/>Modeller yükleniyor…</> : `Tüm ${shown.groupCount} modeli göster`}</button>}
    </div>
    {matches === 0 && !loading && <p className="rounded-lg bg-[#f7f8fa] p-6 text-sm">Bu aramayla eşleşen araç bulunamadı. Model veya motor koduyla tekrar ara.</p>}
  </section>;
}
