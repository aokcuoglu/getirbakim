"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { ArrowLeft, CarFront, Check, ChevronRight, Search, Trash2, X } from "lucide-react";
import { clearCatalogVehicle, selectCatalogVehicle } from "@/app/garaj/actions";
import { vehicleDetails, vehicleProductionDates, type CatalogVehicle, type SavedVehicle } from "@/modules/store/vehicle-catalog";
import { useVehicleCatalog } from "./use-vehicle-catalog";

type Step = "brand" | "model" | "fuel" | "engine" | "confirm";
const titles: Record<Step, string> = { brand: "Marka seç", model: "Model / kasa seç", fuel: "Yakıt türü seç", engine: "Motor seç", confirm: "Aracını onayla" };

export function VehicleSheet({ vehicle, onClose, initialTab = "search" }: { vehicle: SavedVehicle | null; onClose: () => void; initialTab?: "search" | "garage" }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const id = useId();
  const [tab, setTab] = useState(initialTab);
  const [step, setStep] = useState<Step>("brand");
  const [brandId, setBrandId] = useState("");
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
  const brandsRequest = useVehicleCatalog("/api/vehicles");
  const modelsRequest = useVehicleCatalog(brandId ? `/api/vehicles?brandId=${encodeURIComponent(brandId)}` : null);
  const typesRequest = useVehicleCatalog(modelId ? `/api/vehicles?modelId=${encodeURIComponent(modelId)}` : null);
  const searchRequest = useVehicleCatalog(query.trim() ? `/api/vehicles?q=${encodeURIComponent(query.trim())}&offset=${searchOffset}` : null, 250);
  const vehicleBrands = brandsRequest.data?.brands ?? [];
  const vehicleModels = modelsRequest.data?.models ?? [];
  const variants = typesRequest.data?.vehicles ?? [];
  const brand = vehicleBrands.find(b => b.id === brandId);
  const model = vehicleModels.find(m => m.id === modelId);
  const searchResults = searchRequest.data?.vehicles ?? [];
  const searchTotal = searchRequest.data?.total ?? 0;
  const activeRequest = query.trim() ? searchRequest : step === "brand" ? brandsRequest : step === "model" ? modelsRequest : typesRequest;

  useEffect(() => {
    const element = dialog.current!;
    const previous = document.body.style.overflow;
    element.showModal();
    document.body.style.overflow = "hidden";
    return () => { element.close(); document.body.style.overflow = previous; };
  }, []);
  useEffect(() => { content.current?.scrollTo(0, 0); heading.current?.focus(); }, [step]);
  useEffect(() => { content.current?.scrollTo(0, 0); }, [tab]);

  function go(next: Step) { setStep(next); setQuery(""); setSearchOffset(0); setError(""); }
  function pick(v: CatalogVehicle) {
    setBrandId(v.brandId); setModelId(v.modelId); setFuel(v.fuel);
    setSelected(v); setYear(v.to); go("confirm");
  }
  function back() {
    const previous: Record<Step, Step> = { brand: "brand", model: "brand", fuel: "model", engine: "fuel", confirm: "engine" };
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
  function row(key: string, label: string, action: () => void, detail?: string) {
    return <li key={key}><button type="button" className="vehicle-row" onClick={action}><span>{label}{detail && <small>{detail}</small>}</span><ChevronRight size={14} aria-hidden="true" /></button></li>;
  }
  const selectedDetails = selected ? vehicleDetails(selected, year) : null;

  return <dialog ref={dialog} className="vehicle-sheet" aria-labelledby={`${id}-title`} onCancel={event => { event.preventDefault(); if (!pending) onClose(); }} onClick={event => {
    if (event.target === dialog.current && !pending) { const rect = dialog.current.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose(); }
  }}>
    <div className="vehicle-sheet-header">
      <h2 id={`${id}-title`}>Araç seçimi</h2>
      <button type="button" className="vehicle-sheet-close" aria-label="Araç seçimini kapat" disabled={pending} onClick={onClose}><X size={16} /></button>
      <div className="vehicle-sheet-tabs" role="tablist" aria-label="Araç seçimi sekmeleri">
        {([['search', 'Ara'], ['garage', 'Garajım']] as const).map(([value, label]) => <button key={value} type="button" role="tab" id={`${id}-${value}-tab`} aria-controls={`${id}-panel`} aria-selected={tab === value} tabIndex={tab === value ? 0 : -1} onClick={() => { setTab(value); setError(""); }} onKeyDown={event => {
          if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) { event.preventDefault(); const next = event.key === "Home" ? "search" : event.key === "End" ? "garage" : tab === "search" ? "garage" : "search"; setTab(next); document.getElementById(`${id}-${next}-tab`)?.focus(); }
        }}>{label}</button>)}
      </div>
    </div>
    <div className="vehicle-sheet-content" ref={content} role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${tab}-tab`}>
      {tab === "search" ? <>
        <div className="vehicle-plate-area">
          <form className="vehicle-plate-form" onSubmit={lookupPlate}><label className="vehicle-plate"><span aria-hidden="true">🇹🇷<b>TR</b></span><input aria-label="Plaka" placeholder="34 ABC 123" value={plate} onChange={event => { setPlate(event.target.value); setPlateMessage(""); }} maxLength={12} /></label><button type="submit" disabled={!plate.trim()} aria-label="Plakayla araç ara"><Search size={20} /></button></form>
          <p>Aracını marka ve modele göre seçebilirsin.</p>
          {plateMessage && <p role="status">{plateMessage}</p>}
        </div>
        <div className="vehicle-sheet-body">
          <label className="vehicle-search"><Search size={19} aria-hidden="true" /><input aria-label="Marka, model veya yakıt türü ara" placeholder="Marka, model, yakıt türü ara" value={query} maxLength={120} onChange={event => { setQuery(event.target.value); setSearchOffset(0); }} />{query && <button type="button" aria-label="Aramayı temizle" onClick={() => { setQuery(""); setSearchOffset(0); }}><X size={16} /></button>}</label>
          <div className="vehicle-step-heading">{step !== "brand" && !query.trim() && <button type="button" aria-label="Önceki seçim adımına dön" onClick={back}><ArrowLeft size={18} /></button>}<h3 ref={heading} tabIndex={-1}>{query.trim() ? "Arama sonuçları" : titles[step]}</h3></div>
          {!query.trim() && step !== "brand" && <nav className="vehicle-breadcrumbs" aria-label="Araç seçim adımları"><button type="button" onClick={() => go("brand")}>{brand?.name}</button>{model && step !== "model" && <><ChevronRight size={12} /><button type="button" onClick={() => go("model")}>{model.name}</button></>}{fuel && ["engine", "confirm"].includes(step) && <><ChevronRight size={12} /><button type="button" onClick={() => go("fuel")}>{fuel}</button></>}</nav>}
          {activeRequest.loading ? <p className="vehicle-result-count" role="status">Araç verileri yükleniyor…</p> : activeRequest.error ? <div className="vehicle-empty"><p role="alert">{activeRequest.error}</p><button type="button" className="vehicle-secondary" onClick={activeRequest.retry}>Tekrar dene</button></div> : query.trim() ? <><p className="vehicle-result-count">{searchTotal} araç seçeneği{searchTotal > 60 && ` · ${searchOffset + 1}–${Math.min(searchOffset + 60, searchTotal)} gösteriliyor`}</p>{searchResults.length ? <ul className="vehicle-list">{searchResults.map(v => { const details = vehicleDetails(v, v.to); return row(v.id, `${details.make} ${v.generation}`, () => pick(v), `${v.engine} · ${v.fuel} · ${v.power} · ${vehicleProductionDates(v.dateFrom, v.dateTo)}`); })}</ul> : <div className="vehicle-empty"><Search size={28} /><p>Aradığın araç bulunamadı.</p><small>Başka bir marka, model veya yakıt türü dene.</small></div>}{searchTotal > 60 && <div className="vehicle-search-pages"><button type="button" className="vehicle-secondary" disabled={searchOffset === 0} onClick={() => { setSearchOffset(value => Math.max(0, value - 60)); content.current?.scrollTo(0, 0); }}>Önceki</button><button type="button" className="vehicle-secondary" disabled={searchOffset + 60 >= searchTotal} onClick={() => { setSearchOffset(value => value + 60); content.current?.scrollTo(0, 0); }}>Sonraki</button></div>}</> : <>
            {step === "brand" && <>{[true, false].map(popular => <div className="vehicle-list-group" key={String(popular)}><h4>{popular ? "POPÜLER MARKALAR" : "TÜM MARKALAR"}</h4><ul className="vehicle-list">{vehicleBrands.filter(b => b.popular === popular).map(b => row(b.id, b.name.toLocaleUpperCase("tr"), () => { setBrandId(b.id); setModelId(""); setFuel(""); go("model"); }))}</ul></div>)}</>}
            {step === "model" && <ul className="vehicle-list">{vehicleModels.map(m => row(m.id, m.name, () => { setModelId(m.id); setFuel(""); go("fuel"); }, vehicleProductionDates(m.dateFrom, m.dateTo)))}</ul>}
            {step === "fuel" && <ul className="vehicle-list">{[...new Set(variants.map(v => v.fuel))].map(name => row(name, name, () => { setFuel(name); go("engine"); }))}</ul>}
            {step === "engine" && <ul className="vehicle-list">{variants.filter(v => v.fuel === fuel).map(v => row(v.id, v.engine, () => pick(v), `${v.power}${v.cc ? ` · ${v.cc} cm³` : ""} · ${vehicleProductionDates(v.dateFrom, v.dateTo)}`))}</ul>}
            {step === "confirm" && selected && selectedDetails && <div className="vehicle-confirm"><div className="vehicle-summary"><CarFront size={32} /><div><strong>{selectedDetails.make} {selectedDetails.model}</strong><p>{vehicleProductionDates(selected.dateFrom, selected.dateTo)}</p><small>{selected.engine} · {selected.fuel}<br />{selected.power}{selected.cc ? ` · ${selected.cc} cm³` : ""}</small></div></div><label className="vehicle-year" htmlFor={`${id}-year`}>Model yılı</label><select className="vehicle-year-select" id={`${id}-year`} value={year} onChange={event => setYear(Number(event.target.value))}>{Array.from({ length: selected.to - selected.from + 1 }, (_, index) => selected.to - index).map(value => <option key={value} value={value}>{value}</option>)}</select><button className="vehicle-save" type="button" disabled={pending} onClick={save}><Check size={18} />{pending ? "Kaydediliyor…" : "Aracımı seç"}</button><p className="vehicle-note">Parça uyumluluğunu OEM kodu ve araç özellikleriyle ayrıca kontrol et.</p></div>}
          </>}
        </div>
      </> : <div className="vehicle-sheet-body vehicle-garage"><h3 ref={heading} tabIndex={-1}>{vehicle ? "Kayıtlı aracın" : "Garajın henüz boş"}</h3>{vehicle ? <><div className="vehicle-summary"><CarFront size={32} /><div><strong>{vehicle.make} {vehicle.model}</strong><p>{vehicle.year}{vehicle.generation && vehicle.generation !== vehicle.model && ` · ${vehicle.generation}`}</p>{vehicle.engine && <small>{vehicle.engine} · {vehicle.fuel}<br />{vehicle.power}</small>}</div></div><button className="vehicle-save" type="button" onClick={onClose}>Bu araçla devam et <ChevronRight size={16} /></button><button className="vehicle-secondary" type="button" disabled={pending} onClick={() => { setTab("search"); go("brand"); }}>Başka araç seç</button><button className="vehicle-remove" type="button" disabled={pending} onClick={remove}><Trash2 size={15} />{pending ? "Kaldırılıyor…" : "Aracı garajımdan kaldır"}</button></> : <div className="vehicle-empty"><CarFront size={52} strokeWidth={1.3} /><p>Aracın her zaman elinin altında olsun.</p><small>Marka ve model seçerek aracını garajına ekle.</small><button className="vehicle-save" type="button" onClick={() => { setTab("search"); go("brand"); }}>Araç seç <ChevronRight size={16} /></button></div>}</div>}
      {error && <p className="vehicle-sheet-error" role="alert">{error}</p>}
    </div>
    <div className="vehicle-sheet-footer"><Link className="button outline" href="/katalog" onClick={onClose}>Araç seçmeden alışveriş yap</Link></div>
  </dialog>;
}
