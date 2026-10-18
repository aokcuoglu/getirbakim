"use client";

import { useEffect, useId, useMemo, useRef, useState, useTransition, type RefObject } from "react";
import Link from "next/link";
import { Dialog as SheetPrimitive } from "@base-ui/react/dialog";
import { ArrowLeft, CarFront, Check, ChevronRight, Search, Trash2, X } from "lucide-react";
import { VehicleImage, VehicleImageCredit } from "./vehicle-image";
import { Sheet, SheetClose, SheetTitle } from "@/components/ui/sheet";
import { DialogOverlay as SheetOverlay, DialogPortal as SheetPortal } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";
import { clearCatalogVehicle, garageVehicles, removeGarageVehicle, selectCatalogVehicle, switchGarageVehicle } from "@/app/garaj/actions";
import type { GarageEntry } from "@/modules/store/garage";
import { minSearchLength, searchTooShort } from "@/modules/search/query";
import { vehicleDetails, vehicleModelFamilies, vehicleModelFamilyKey, vehicleProductionDates, type CatalogVehicle, type SavedVehicle } from "@/modules/store/vehicle-catalog";
import { oilCapacity } from "@/modules/store/vehicle-oil";
import { useVehicleCatalog } from "./use-vehicle-catalog";

type Step = "brand" | "family" | "model" | "fuel" | "engine" | "confirm";
type Tab = "search" | "garage";
const titles: Record<Step, string> = { brand: "Marka seç", family: "Model seç", model: "Kasa / nesil seç", fuel: "Yakıt türü seç", engine: "Motor seç", confirm: "Aracını onayla" };

const plain = "h-auto min-h-0 rounded-none border-0 bg-transparent p-0 font-normal hover:bg-transparent";
const saveButton = "mt-4 flex h-auto min-h-12 w-full items-center justify-center gap-2.5 rounded-[5px] border border-brand bg-brand p-3 text-sm leading-5 font-medium text-white hover:border-brand-strong hover:bg-brand-strong disabled:border-[#e6e9ec] disabled:bg-[#e6e9ec] disabled:text-[#98a4af] disabled:opacity-100";
const secondaryButton = "mt-3 h-auto min-h-12 w-full rounded-[5px] border border-input bg-white px-[27px] py-[13px] text-sm leading-5 font-medium text-foreground hover:bg-[#f8f9f9] hover:text-foreground disabled:border-[#e6e9ec] disabled:bg-[#e6e9ec] disabled:text-[#98a4af] disabled:opacity-100";
const summaryBox = "mb-[22px] flex items-start gap-3.5 rounded-[5px] border border-border bg-[#f8f9f9] p-[18px] [&>span>svg]:text-muted-foreground [&_strong]:text-sm [&_strong]:leading-5 [&_strong]:font-semibold [&_p]:my-1.5 [&_p]:text-[13px] [&_p]:leading-5 [&_small]:text-xs [&_small]:leading-5 [&_small]:text-muted-foreground";
const emptyBox = "py-9 text-center text-muted-foreground [&>svg]:mx-auto [&>svg]:mb-4 [&>p]:mt-0 [&>p]:mb-2 [&>p]:text-sm [&>p]:leading-[22px] [&>p]:text-foreground [&>small]:text-xs [&>small]:leading-5";

export function VehicleSheet({ open, vehicle, onClose, initialTab = "search", finalFocus }: { open: boolean; vehicle: SavedVehicle | null; onClose: () => void; initialTab?: Tab; finalFocus?: RefObject<HTMLElement | null> }) {
  const busyRef = useRef(false);
  const id = useId();
  return <Sheet open={open} onOpenChange={next => { if (!next && !busyRef.current) onClose(); }}>
    <SheetPortal>
      <SheetOverlay className="bg-[rgba(33,43,54,.5)] supports-backdrop-filter:backdrop-blur-none" />
      <SheetPrimitive.Popup finalFocus={finalFocus} aria-labelledby={`${id}-title`}
        className="fixed inset-y-0 right-0 z-50 flex h-dvh max-h-dvh w-[420px] max-w-[100vw] flex-col overflow-hidden bg-white text-sm leading-5 text-foreground shadow-[-8px_0_32px_#212b3614] outline-none transition-transform duration-[220ms] ease-out data-ending-style:translate-x-full data-starting-style:translate-x-full max-[600px]:w-full motion-reduce:transition-none">
        <VehicleSheetBody id={id} vehicle={vehicle} initialTab={initialTab} onClose={onClose} busyRef={busyRef} />
      </SheetPrimitive.Popup>
    </SheetPortal>
  </Sheet>;
}

function VehicleSheetBody({ id, vehicle, onClose, initialTab, busyRef }: { id: string; vehicle: SavedVehicle | null; onClose: () => void; initialTab: Tab; busyRef: RefObject<boolean> }) {
  const content = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [step, setStep] = useState<Step>("brand");
  const [brandId, setBrandId] = useState("");
  const [familyKey, setFamilyKey] = useState("");
  const [modelId, setModelId] = useState("");
  const [fuel, setFuel] = useState("");
  const [selected, setSelected] = useState<CatalogVehicle | null>(null);
  const [year, setYear] = useState(0);
  const [query, setQuery] = useState("");
  const [plate, setPlate] = useState("");
  const [plateMessage, setPlateMessage] = useState("");
  const [searchOffset, setSearchOffset] = useState(0);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const [garage, setGarage] = useState<{ signedIn: boolean; vehicles: GarageEntry[]; activeKey: string | null } | null>(null);
  const brandsRequest = useVehicleCatalog("/api/vehicles");
  const modelsRequest = useVehicleCatalog(brandId ? `/api/vehicles?brandId=${encodeURIComponent(brandId)}` : null);
  const typesRequest = useVehicleCatalog(modelId ? `/api/vehicles?modelId=${encodeURIComponent(modelId)}` : null);
  const tooShort = searchTooShort(query);
  const searchRequest = useVehicleCatalog(query.trim() && !tooShort ? `/api/vehicles?q=${encodeURIComponent(query.trim())}&offset=${searchOffset}` : null, 250);
  // The saved vehicle only carries ids; its series photograph is looked up when the garage tab shows it.
  const savedRequest = useVehicleCatalog(tab === "garage" && vehicle?.vehicleId ? `/api/vehicles?vehicleId=${encodeURIComponent(vehicle.vehicleId)}` : null);
  const savedImage = savedRequest.data?.vehicles?.[0]?.image;
  const savedOil = savedRequest.data?.vehicles?.[0]?.oil;
  const vehicleBrands = brandsRequest.data?.brands ?? [];
  const vehicleModels = modelsRequest.data?.models ?? [];
  const variants = typesRequest.data?.vehicles ?? [];
  const families = useMemo(() => vehicleModelFamilies(modelsRequest.data?.models ?? []), [modelsRequest.data]);
  const family = families.find(f => f.key === familyKey);
  const brand = vehicleBrands.find(b => b.id === brandId);
  const model = vehicleModels.find(m => m.id === modelId);
  const searchResults = searchRequest.data?.vehicles ?? [];
  const searchTotal = searchRequest.data?.total ?? 0;
  const activeRequest = query.trim() ? searchRequest : step === "brand" ? brandsRequest : step === "family" || step === "model" ? modelsRequest : typesRequest;

  useEffect(() => { busyRef.current = pending; }, [busyRef, pending]);
  const firstStep = useRef(true);
  useEffect(() => {
    if (firstStep.current) { firstStep.current = false; return; }
    content.current?.scrollTo(0, 0); heading.current?.focus();
  }, [step]);
  useEffect(() => { content.current?.scrollTo(0, 0); }, [tab]);
  // Saved vehicles load when the garage tab opens; the active vehicle itself comes from the page.
  useEffect(() => {
    if (tab !== "garage") return;
    let current = true;
    garageVehicles().then(result => { if (current) setGarage(result); }).catch(() => { if (current) setError("Kayıtlı araçlar yüklenemedi."); });
    return () => { current = false; };
  }, [tab]);
  const others = garage?.vehicles.filter(entry => entry.key !== garage.activeKey) ?? [];
  function switchTo(key: string) {
    startTransition(async () => {
      try { const result = await switchGarageVehicle(key); if (result.error) setError(result.error); else onClose(); }
      catch { setError("Araç seçilemedi. Lütfen tekrar dene."); }
    });
  }
  function forget(key: string) {
    startTransition(async () => {
      try { await removeGarageVehicle(key); setGarage(await garageVehicles()); }
      catch { setError("Araç kaldırılamadı. Lütfen tekrar dene."); }
    });
  }

  function go(next: Step) { setStep(next); setQuery(""); setSearchOffset(0); setError(""); }
  function pick(v: CatalogVehicle) {
    setBrandId(v.brandId); setFamilyKey(vehicleModelFamilyKey(v.model)); setModelId(v.modelId); setFuel(v.fuel);
    setSelected(v); setYear(v.to); go("confirm");
  }
  function back() {
    // A family with a single series skipped the series list, so going back skips it too.
    const previous: Record<Step, Step> = { brand: "brand", family: "brand", model: "family", fuel: family?.models.length === 1 ? "family" : "model", engine: "fuel", confirm: "engine" };
    go(previous[step]);
  }
  function lookupPlate(event: React.FormEvent) {
    event.preventDefault();
    setPlateMessage("Plaka sorgulama henüz bağlı değil. Marka ve model seçerek devam edebilirsin.");
  }
  function save() {
    if (!selected) return;
    startTransition(async () => {
      try { const result = await selectCatalogVehicle(selected.id, year); if (result.error) setError(result.error); else onClose(); }
      catch { setError("Araç kaydedilemedi. Lütfen tekrar dene."); }
    });
  }
  function remove() {
    startTransition(async () => {
      try { await clearCatalogVehicle(); setTab("search"); go("brand"); }
      catch { setError("Araç kaldırılamadı. Lütfen tekrar dene."); }
    });
  }
  function rows(items: { key: string; label: string; action: () => void; detail?: string }[]) {
    const detailed = items.some(item => item.detail);
    return <ul className="m-0 list-none p-0">{items.map(({ key, label, action, detail }) => <li key={key}>
      <Button type="button" onClick={action} className={cn(plain, "flex min-h-8 w-full items-center justify-between gap-3 bg-white py-[7px] text-left text-sm leading-5 whitespace-normal text-foreground hover:bg-[#f1f7fb] hover:text-brand [&>svg]:shrink-0", detailed && "border-b border-[#f1f3f5] py-3")}>
        <span>{label}{detail && <small className="mt-[3px] block text-xs leading-[18px] text-muted-foreground">{detail}</small>}</span><ChevronRight size={14} aria-hidden="true" />
      </Button>
    </li>)}</ul>;
  }
  const selectedDetails = selected ? vehicleDetails(selected, year) : null;
  const stepHeading = "m-0 text-base leading-6 font-semibold outline-none";

  return <Tabs value={tab} onValueChange={value => { setTab(value as Tab); setError(""); }} className="flex min-h-0 flex-1 flex-col gap-0">
    <div className="relative shrink-0 bg-[linear-gradient(90deg,rgba(20,25,33,.8),rgba(20,25,33,.4)),url('/hero-car.jpg')] bg-cover bg-[center_55%] px-5 pt-5 text-white max-[600px]:pt-[max(20px,env(safe-area-inset-top))]">
      <SheetTitle id={`${id}-title`} className="mt-0 mr-10 mb-5 text-xl leading-7 font-semibold text-white">Araç seçimi</SheetTitle>
      <SheetClose aria-label="Araç seçimini kapat" disabled={pending} className="absolute top-3.5 right-3.5 grid size-[30px] min-h-[30px] place-items-center rounded-[4px] border-0 bg-white/15 p-0 text-white hover:bg-white/25 disabled:bg-white/15 disabled:text-white"><X size={16} /></SheetClose>
      <TabsList aria-label="Araç seçimi sekmeleri" className="h-auto! gap-6 rounded-none bg-transparent p-0">
        {([["search", "Ara"], ["garage", "Garajım"]] as const).map(([value, label]) => <TabsTrigger key={value} value={value}
          className="h-auto! min-h-9 flex-none rounded-none border-0 border-b-2 border-transparent bg-transparent px-0 pt-0 pb-2.5 text-sm font-normal text-white/70 after:hidden hover:bg-transparent hover:text-white focus-visible:ring-white/60 data-active:border-white data-active:bg-transparent data-active:text-white data-active:shadow-none">{label}</TabsTrigger>)}
      </TabsList>
    </div>
    <div ref={content} className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-width:thin]">
      <TabsContent value="search">
        <div className="bg-[#f8f9f9] p-5">
          <form className="flex items-center gap-2" onSubmit={lookupPlate}>
            <label className="flex h-12 min-w-0 flex-1 overflow-hidden rounded-[5px] border border-input bg-white focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand">
              <span aria-hidden="true" className="flex w-[35px] shrink-0 flex-col items-center justify-center bg-[#003399] text-[17px] leading-[19px] text-white">🇹🇷<b className="text-[11px] leading-[15px]">TR</b></span>
              <input aria-label="Plaka" placeholder="34 ABC 123" value={plate} onChange={event => { setPlate(event.target.value); setPlateMessage(""); }} maxLength={12}
                className="h-[46px] w-full min-w-0 rounded-none border-0 bg-white px-3 py-2.5 text-sm text-foreground uppercase outline-none placeholder:text-sm placeholder:text-muted-foreground focus:outline-none focus-visible:outline-none" />
            </label>
            <Button type="submit" disabled={!plate.trim()} aria-label="Plakayla araç ara" className="grid size-12 min-h-12 shrink-0 place-items-center rounded-[5px] border border-brand bg-brand p-0 text-white hover:bg-brand-strong disabled:border-[#e6e9ec] disabled:bg-[#e6e9ec] disabled:text-[#98a4af] disabled:opacity-100 [&_svg:not([class*='size-'])]:size-5"><Search size={20} /></Button>
          </form>
          <p className="mt-[9px] mb-0 text-[11px] leading-[17px] text-muted-foreground">Aracını marka ve modele göre seçebilirsin.</p>
          {plateMessage && <p role="status" className="mt-[9px] mb-0 text-[11px] leading-[17px] text-muted-foreground">{plateMessage}</p>}
        </div>
        <div className="p-5">
          <label className="mb-8 flex h-[46px] items-center gap-3 rounded-[5px] border border-input px-3 text-foreground focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand [&>svg]:shrink-0">
            <Search size={19} aria-hidden="true" />
            <input aria-label="Marka, model veya yakıt türü ara" placeholder="Marka, model, yakıt türü ara" value={query} maxLength={120} onChange={event => { setQuery(event.target.value); setSearchOffset(0); }}
              className="h-11 w-full min-w-0 flex-1 rounded-none border-0 bg-transparent p-0 text-sm text-foreground outline-none placeholder:text-sm placeholder:text-muted-foreground focus:outline-none focus-visible:outline-none" />
            {query && <Button type="button" aria-label="Aramayı temizle" onClick={() => { setQuery(""); setSearchOffset(0); }} className={cn(plain, "grid size-6 min-h-6 shrink-0 place-items-center text-muted-foreground hover:text-foreground")}><X size={16} /></Button>}
          </label>
          <div className="mb-[18px] flex items-center gap-3">
            {step !== "brand" && !query.trim() && <Button type="button" aria-label="Önceki seçim adımına dön" onClick={back} className={cn(plain, "grid size-6 min-h-6 place-items-center text-foreground [&_svg:not([class*='size-'])]:size-[18px]")}><ArrowLeft size={18} /></Button>}
            <h3 ref={heading} tabIndex={-1} className={stepHeading}>{query.trim() ? "Arama sonuçları" : titles[step]}</h3>
          </div>
          {!query.trim() && step !== "brand" && <nav className="mb-[22px] flex flex-wrap items-center gap-1.5 text-muted-foreground [&>button]:min-h-6 [&>button]:text-xs [&>button]:text-muted-foreground [&>button:hover]:text-brand [&>button:hover]:underline" aria-label="Araç seçim adımları">
            <Button type="button" className={plain} onClick={() => go("brand")}>{brand?.name}</Button>
            {family && step !== "family" && <><ChevronRight size={12} /><Button type="button" className={plain} onClick={() => go("family")}>{family.name}</Button></>}
            {model && !["family", "model"].includes(step) && <><ChevronRight size={12} /><Button type="button" className={plain} onClick={() => go(family?.models.length === 1 ? "family" : "model")}>{model.name}</Button></>}
            {fuel && ["engine", "confirm"].includes(step) && <><ChevronRight size={12} /><Button type="button" className={plain} onClick={() => go("fuel")}>{fuel}</Button></>}
          </nav>}
          {query.trim() && tooShort ? <p className="mt-0 mb-3 text-xs text-muted-foreground" role="status">Aramak için en az {minSearchLength} harf veya rakam yaz.</p>
            : activeRequest.loading ? <p className="mt-0 mb-3 text-xs text-muted-foreground" role="status">Araç verileri yükleniyor…</p>
            : activeRequest.error ? <div className={emptyBox}><p role="alert">{activeRequest.error}</p><Button type="button" className={secondaryButton} onClick={activeRequest.retry}>Tekrar dene</Button></div>
            : query.trim() ? <>
              <p className="mt-0 mb-3 text-xs text-muted-foreground">{searchTotal} araç seçeneği{searchTotal > 60 && ` · ${searchOffset + 1}–${Math.min(searchOffset + 60, searchTotal)} gösteriliyor`}</p>
              {searchRequest.data?.correctedQuery && <p className="mt-0 mb-3 text-xs text-muted-foreground" role="status">“{query.trim()}” bulunamadı, “{searchRequest.data.correctedQuery}” için sonuçlar gösteriliyor.</p>}
              {searchResults.length ? rows(searchResults.map(v => { const details = vehicleDetails(v, v.to); return { key: v.id, label: `${details.make} ${v.generation}`, action: () => pick(v), detail: `${v.engine} · ${v.fuel} · ${v.power} · ${vehicleProductionDates(v.dateFrom, v.dateTo)}` }; }))
                : <div className={emptyBox}><Search size={28} /><p>Aradığın araç bulunamadı.</p><small>Başka bir marka, model veya yakıt türü dene.</small></div>}
              {searchTotal > 60 && <div className="mt-4 flex gap-3">
                <Button type="button" className={cn(secondaryButton, "mt-0")} disabled={searchOffset === 0} onClick={() => { setSearchOffset(value => Math.max(0, value - 60)); content.current?.scrollTo(0, 0); }}>Önceki</Button>
                <Button type="button" className={cn(secondaryButton, "mt-0")} disabled={searchOffset + 60 >= searchTotal} onClick={() => { setSearchOffset(value => value + 60); content.current?.scrollTo(0, 0); }}>Sonraki</Button>
              </div>}
            </> : <>
              {step === "brand" && [true, false].map(popular => <div className="border-[#dfe3e8] [&+&]:mt-[22px] [&+&]:border-t [&+&]:pt-[22px]" key={String(popular)}>
                <h4 className="mt-0 mb-2 text-[11px] leading-4 font-semibold tracking-[.3px] text-[#54626e]">{popular ? "POPÜLER MARKALAR" : "TÜM MARKALAR"}</h4>
                {rows(vehicleBrands.filter(b => b.popular === popular).map(b => ({ key: b.id, label: b.name.toLocaleUpperCase("tr"), action: () => { setBrandId(b.id); setFamilyKey(""); setModelId(""); setFuel(""); go("family"); } })))}
              </div>)}
              {step === "family" && rows(families.map(f => ({ key: f.key, label: f.name, action: () => {
                setFamilyKey(f.key); setFuel("");
                if (f.models.length === 1) { setModelId(f.models[0].id); go("fuel"); } else { setModelId(""); go("model"); }
              }, detail: `${f.models.length > 1 ? `${f.models.length} kasa / nesil · ` : ""}${vehicleProductionDates(f.dateFrom, f.dateTo)}` })))}
              {step === "model" && rows((family?.models ?? []).map(m => ({ key: m.id, label: m.name, action: () => { setModelId(m.id); setFuel(""); go("fuel"); }, detail: vehicleProductionDates(m.dateFrom, m.dateTo) })))}
              {step === "fuel" && rows([...new Set(variants.map(v => v.fuel))].map(name => ({ key: name, label: name, action: () => { setFuel(name); go("engine"); } })))}
              {step === "engine" && rows(variants.filter(v => v.fuel === fuel).map(v => ({ key: v.id, label: v.engine, action: () => pick(v), detail: `${v.power}${v.cc ? ` · ${v.cc} cm³` : ""} · ${vehicleProductionDates(v.dateFrom, v.dateTo)}` })))}
              {step === "confirm" && selected && selectedDetails && <div>
                <div className={summaryBox}><VehicleImage image={selected.image} alt={`${selectedDetails.make} ${selectedDetails.model}`} /><div className="min-w-0"><strong>{selectedDetails.make} {selectedDetails.model}</strong><p>{vehicleProductionDates(selected.dateFrom, selected.dateTo)}</p><small>{selected.engine} · {selected.fuel}<br />{selected.power}{selected.cc ? ` · ${selected.cc} cm³` : ""}</small><VehicleImageCredit image={selected.image} className="mt-1.5" /></div></div>
                <label className="mb-2 block text-[13px] font-medium" htmlFor={`${id}-year`}>Model yılı</label>
                <NativeSelect id={`${id}-year`} value={year} onChange={event => setYear(Number(event.target.value))} className="mb-5 w-full [&>select]:h-[52px] [&>select]:rounded-[5px] [&>select]:bg-white [&>select]:pl-3.5 [&>select]:text-sm [&>select]:text-foreground">
                  {Array.from({ length: selected.to - selected.from + 1 }, (_, index) => selected.to - index).map(value => <NativeSelectOption key={value} value={value}>{value}</NativeSelectOption>)}
                </NativeSelect>
                <Button className={saveButton} type="button" disabled={pending} onClick={save}><Check size={18} />{pending ? "Kaydediliyor…" : "Aracımı seç"}</Button>
                <p className="mt-[18px] mb-0 text-xs leading-5 text-muted-foreground">Parça uyumluluğunu OEM kodu ve araç özellikleriyle ayrıca kontrol et.</p>
              </div>}
            </>}
        </div>
      </TabsContent>
      <TabsContent value="garage" className="p-5">
        <h3 ref={tab === "garage" ? heading : undefined} tabIndex={-1} className={cn(stepHeading, "mt-1 mb-6")}>{vehicle ? "Seçili aracın" : others.length ? "Garajındaki araçlar" : garage ? "Garajın henüz boş" : "Garajım"}</h3>
        {vehicle ? <>
          <div className={summaryBox}><VehicleImage image={savedImage} alt={`${vehicle.make} ${vehicle.model}`} /><div className="min-w-0"><strong>{vehicle.make} {vehicle.model}</strong><p>{vehicle.year}{vehicle.generation && vehicle.generation !== vehicle.model && ` · ${vehicle.generation}`}</p>{vehicle.engine && <small>{vehicle.engine} · {vehicle.fuel}<br />{vehicle.power}</small>}<VehicleImageCredit image={savedImage} className="mt-1.5" /></div></div>
          {savedOil && <dl className="-mt-2.5 mb-[22px] grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-[5px] border border-border px-[18px] py-3.5 text-[13px] leading-5 [&>dt]:text-muted-foreground [&>dd]:m-0 [&>dd]:wrap-anywhere" aria-label="Önerilen motor yağı">
            <dt>Yağ miktarı</dt><dd className="font-semibold">{oilCapacity(savedOil)}</dd>
            <dt>Viskozite</dt><dd>SAE {savedOil.viscosities.join(", ")}</dd>
            {savedOil.acea.length > 0 && <><dt>ACEA</dt><dd>{savedOil.acea.join(", ")}</dd></>}
            {savedOil.api.length > 0 && <><dt>API</dt><dd>{savedOil.api.join(", ")}</dd></>}
            {savedOil.approvals.length > 0 && <><dt>Üretici onayı</dt><dd>{savedOil.approvals.join(", ")}</dd></>}
          </dl>}
          <Button className={saveButton} type="button" onClick={onClose}>Bu araçla devam et <ChevronRight size={16} /></Button>
          <Button className={secondaryButton} type="button" disabled={pending} onClick={() => { setTab("search"); go("brand"); }}>Başka araç seç</Button>
          <Button className={cn(plain, "mx-auto mt-4 flex min-h-9 items-center justify-center gap-2 py-2 text-xs text-muted-foreground hover:text-[#c53333] disabled:bg-transparent")} type="button" disabled={pending} onClick={remove}><Trash2 size={15} />{pending ? "Kaldırılıyor…" : "Aracı garajımdan kaldır"}</Button>
        </> : garage && !others.length && <div className={emptyBox}><CarFront size={52} strokeWidth={1.3} /><p>Aracın her zaman elinin altında olsun.</p><small>Marka ve model seçerek aracını garajına ekle.</small><Button className={saveButton} type="button" onClick={() => { setTab("search"); go("brand"); }}>Araç seç <ChevronRight size={16} /></Button></div>}
        {others.length > 0 && <div className="mt-6"><h4 className="mb-2 text-[11px] leading-[18px] font-medium tracking-[1.2px] text-muted-foreground">{vehicle ? "DİĞER KAYITLI ARAÇLAR" : "KAYITLI ARAÇLAR"}</h4>
          <ul className="m-0 list-none p-0">{others.map(entry => <li key={entry.key} className="flex items-center gap-2 border-b border-[#f1f3f5]">
            <Button type="button" disabled={pending} onClick={() => switchTo(entry.key)} className={cn(plain, "flex min-h-8 flex-1 items-center justify-between gap-3 bg-white py-3 text-left text-sm leading-5 whitespace-normal text-foreground hover:bg-[#f1f7fb] hover:text-brand [&>svg]:shrink-0")}><span>{entry.make} {entry.model}<small className="block text-xs text-muted-foreground">{[entry.year, entry.engine, entry.fuel].filter(Boolean).join(" · ")}</small></span><ChevronRight size={14} aria-hidden="true" /></Button>
            <Button type="button" variant="ghost" size="icon" disabled={pending} className="size-8 text-muted-foreground hover:text-[#c53333]" aria-label={`${entry.make} ${entry.model} aracını garajdan kaldır`} onClick={() => forget(entry.key)}><Trash2 size={15} /></Button>
          </li>)}</ul></div>}
        {!vehicle && !others.length && !garage && <p className="text-xs text-muted-foreground" role="status">Kayıtlı araçlar yükleniyor…</p>}
        {garage && !garage.signedIn && <p className="mt-[18px] mb-0 text-xs leading-5 text-muted-foreground">Araçların bu tarayıcıda saklanır (en çok 5). B2B hesabınla giriş yaparsan hesabına kaydedilir ve her cihazda görünür.</p>}
      </TabsContent>
      {error && <p className="mx-5 mt-0 mb-5 rounded-[5px] bg-[#fff0ec] p-3 text-[13px] leading-5 text-[#a74130]" role="alert">{error}</p>}
    </div>
    <div className="shrink-0 border-t border-border bg-white p-5 max-[600px]:pb-[max(20px,env(safe-area-inset-bottom))]">
      <Button nativeButton={false} render={<Link href="/katalog" onClick={onClose} />}
        className="flex h-auto min-h-11 w-full items-center justify-center rounded-[5px] border border-input bg-white px-3 py-2.5 text-[13px] leading-5 font-medium text-foreground hover:border-[#54626e] hover:bg-[#f9fafb] hover:text-foreground">Araç seçmeden alışveriş yap</Button>
    </div>
  </Tabs>;
}
