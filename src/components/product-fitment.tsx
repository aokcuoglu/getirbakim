"use client";

import { useId, useState } from "react";
import { Search, ChevronRight } from "lucide-react";

type Vehicle = {
  model: string | null; engineAndCodes: string; fuel: string;
  kw: number; ps: number; cc: number; from: string; to: string | null;
  vehicleTypeId?: number | null; brandId?: number | null; modelId?: number | null; catalogEngine?: string | null; catalogBrand?: string | null;
};

const fuelLabels: Record<string, string> = {
  Electric: "Elektrik", Diesel: "Dizel", Petrol: "Benzin", "Petrol/Electric": "Benzin / Elektrik",
  "Diesel/Electric": "Dizel / Elektrik", "Petrol/Ethanol": "Benzin / Etanol",
  "Petrol/Ethanol/Electric": "Benzin / Etanol / Elektrik",
  "Petrol/Compressed Natural Gas (CNG)": "Benzin / CNG",
  "Petrol/Liquified Petroleum Gas (LPG)": "Benzin / LPG",
};

export function ProductFitment({ vehicles }: { vehicles: Vehicle[] }) {
  const inputId = useId();
  const linkedCount = vehicles.filter(vehicle => vehicle.vehicleTypeId).length;
  const [query, setQuery] = useState("");
  const [make, setMake] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const models = [...new Set(vehicles.map(vehicle => vehicle.model))];
  const makes = [...new Set(vehicles.map(vehicle => vehicle.catalogBrand || vehicle.model?.split(" ")[0]).filter(Boolean))] as string[];
  const normalized = query.trim().toLocaleLowerCase("tr");
  const matches = vehicles.filter(vehicle =>
    (!make || vehicle.model?.startsWith(`${make} `)) && (!selectedModel || vehicle.model === selectedModel) &&
    `${vehicle.model} ${vehicle.engineAndCodes} ${vehicle.from} ${vehicle.to || ""} ${vehicle.ps} ${vehicle.kw}`
      .toLocaleLowerCase("tr").includes(normalized));

  return <section className="detail-information fitment-section" id="uyumlu-araclar" aria-labelledby="fitment-title">
    <div className="detail-section-heading"><div><span className="detail-eyebrow">ARAÇ EŞLEŞMELERİ</span><h2 id="fitment-title">Uyumlu araçlar</h2></div><span className="detail-count">{vehicles.length} motor seçeneği</span></div>
    <p className="muted">Modelini seç, motor kodu ve üretim tarihini karşılaştır. Sipariş öncesinde araç bilgilerini ve OEM kodunu doğrula.</p>
    <p className="fitment-link-summary">{linkedCount} araç kaydı araç kataloğuna bağlı{vehicles.length > linkedCount && ` · ${vehicles.length - linkedCount} kaynak kaydı henüz eşleştirilmedi`}</p>
    <div className="fitment-filters">
      <label><span className="sr-only">Araç markası</span><select value={make} onChange={event => { setMake(event.target.value); setSelectedModel(""); }}><option value="">Marka</option>{makes.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
      <label><span className="sr-only">Araç modeli</span><select value={selectedModel} onChange={event => setSelectedModel(event.target.value)}><option value="">Model</option>{models.filter(model => !make || model?.startsWith(`${make} `)).map(model => <option key={model} value={model || ""}>{model}</option>)}</select></label>
      <button type="button" onClick={() => { setMake(""); setSelectedModel(""); setQuery(""); }}>Sıfırla</button>
    <label className="fitment-search" htmlFor={inputId}><Search size={18}/><input id={inputId} type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Model, motor kodu veya yıl ara"/><span className="sr-only">Uyumlu araçlarda ara</span></label>
    </div>
    <p className="fitment-result" role="status">{normalized || make || selectedModel ? `${matches.length} eşleşme bulundu` : `${models.length} model serisi · Motor ayrıntıları için aç`}</p>
    <div className="fitment-models">
      {models.map(model => {
        const rows = matches.filter(vehicle => vehicle.model === model);
        if (!rows.length) return null;
        return <details key={model} className="fitment-model" open={normalized ? true : undefined}>
          <summary><ChevronRight size={18} aria-hidden="true"/><strong>{model}</strong><span>{rows.length} seçenek</span></summary>
          <div className="fitment-table-wrap" tabIndex={0} role="region" aria-label={`${model} motor seçenekleri`}>
            <table className="fitment-table"><thead><tr><th scope="col">Motor / motor kodu</th><th scope="col">Güç / hacim</th><th scope="col">Üretim aralığı</th><th scope="col">Veri bağlantısı</th></tr></thead><tbody>
              {rows.map(vehicle => <tr key={`${vehicle.engineAndCodes}-${vehicle.fuel}-${vehicle.ps}-${vehicle.kw}-${vehicle.cc}-${vehicle.from}-${vehicle.to}`}><td><strong>{vehicle.catalogEngine || vehicle.engineAndCodes}</strong>{vehicle.catalogEngine && vehicle.engineAndCodes !== vehicle.catalogEngine && <small>Kaynak motor bilgisi: {vehicle.engineAndCodes}</small>}<small>{fuelLabels[vehicle.fuel] || vehicle.fuel}</small></td><td>{vehicle.ps} PS · {vehicle.kw} kW{vehicle.cc > 0 && <small>{vehicle.cc} cm³</small>}</td><td>{vehicle.from} – {vehicle.to || "Bitiş belirtilmemiş"}</td><td>{vehicle.vehicleTypeId ? <span className="fitment-linked" title={`Araç tipi: ${vehicle.vehicleTypeId}`}>Kataloğa bağlı</span> : <span className="fitment-unlinked">Kaynak kaydı</span>}</td></tr>)}
            </tbody></table>
          </div>
        </details>;
      })}
    </div>
    {matches.length === 0 && <p className="fitment-empty">Bu aramayla eşleşen araç bulunamadı. Model veya motor koduyla tekrar ara.</p>}
  </section>;
}
