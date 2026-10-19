"use client";

import { useId, useState } from "react";
import { Search, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

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

  const select="w-[200px] max-[1000px]:w-40 max-[750px]:w-full [&>select]:h-10 [&>select]:rounded-[5px] [&>select]:bg-white [&>select]:px-3 [&>select]:text-sm [&>svg]:text-foreground";
  return <section className="mt-[42px] scroll-mt-[110px]" id="uyumlu-araclar" aria-labelledby="fitment-title">
    <div className="flex items-center justify-between gap-4"><div><span className="hidden">ARAÇ EŞLEŞMELERİ</span><h2 id="fitment-title" className="mb-6 text-[26px] leading-[34px] font-semibold tracking-[-.6px] max-[750px]:mb-5 max-[750px]:text-[23px] max-[750px]:leading-[30px]">Uyumlu araçlar</h2></div><span className="hidden">{vehicles.length} motor seçeneği</span></div>
    <p className="hidden">Modelini seç, motor kodu ve üretim tarihini karşılaştır. Sipariş öncesinde araç bilgilerini ve OEM kodunu doğrula.</p>
    <p className="-mt-2.5 mb-[18px] text-xs leading-5 text-[#53677d]">{vehicles.length} uyumlu araç kaydı</p>
    <div className="flex flex-wrap items-center gap-2 rounded-t-lg border border-[#dce2e9] bg-white p-4">
      <label className="max-[750px]:min-w-[110px] max-[750px]:flex-1"><span className="sr-only">Araç markası</span><NativeSelect className={select} value={make} onChange={event => { setMake(event.target.value); setSelectedModel(""); }}><NativeSelectOption value="">Marka</NativeSelectOption>{makes.map(value => <NativeSelectOption key={value} value={value}>{value}</NativeSelectOption>)}</NativeSelect></label>
      <label className="max-[750px]:min-w-[110px] max-[750px]:flex-1"><span className="sr-only">Araç modeli</span><NativeSelect className={select} value={selectedModel} onChange={event => setSelectedModel(event.target.value)}><NativeSelectOption value="">Model</NativeSelectOption>{models.filter(model => !make || model?.startsWith(`${make} `)).map(model => <NativeSelectOption key={model} value={model || ""}>{model}</NativeSelectOption>)}</NativeSelect></label>
      <Button type="button" variant="ghost" className="h-10 min-h-0 bg-transparent px-5 text-sm text-[#0065c3] hover:bg-muted hover:text-[#0065c3]" onClick={() => { setMake(""); setSelectedModel(""); setQuery(""); }}>Sıfırla</Button>
    <label className="flex h-10 min-w-40 flex-1 items-center gap-3 rounded-[5px] border border-[#e5e7eb] px-3.5 text-muted-foreground focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 max-[750px]:basis-full" htmlFor={inputId}><Search size={18}/><input id={inputId} type="search" className="h-[38px] w-full min-w-0 border-0 bg-transparent py-2 text-[13px] text-foreground outline-none placeholder:text-muted-foreground" value={query} onChange={event => setQuery(event.target.value)} placeholder="Model, motor kodu veya yıl ara"/><span className="sr-only">Uyumlu araçlarda ara</span></label>
    </div>
    <p className="m-0 border-x border-[#dce2e9] bg-white px-4 py-3 text-xs leading-5 text-muted-foreground" role="status">{normalized || make || selectedModel ? `${matches.length} eşleşme bulundu` : `${models.length} model serisi · Motor ayrıntıları için aç`}</p>
    <div className="overflow-hidden rounded-b-lg border border-t-0 border-[#dce2e9] bg-white">
      {models.map(model => {
        const rows = matches.filter(vehicle => vehicle.model === model);
        if (!rows.length) return null;
        return <Collapsible key={model + (normalized ? "-search" : "")} defaultOpen={Boolean(normalized)} className="border-t border-[#e0e5eb]">
          <CollapsibleTrigger className="group/model flex w-full cursor-pointer rounded-none border-0 bg-transparent text-foreground items-center gap-3 px-4 py-5 text-left text-base leading-5 outline-none hover:bg-[#f7f8fa] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#2e78c7]"><ChevronRight size={18} aria-hidden="true" className="shrink-0 text-[#53677d] transition-transform group-data-panel-open/model:rotate-90"/><strong className="font-medium">{model}</strong><span className="ml-auto text-[11px] whitespace-nowrap text-muted-foreground">{rows.length} seçenek</span></CollapsibleTrigger>
          <CollapsibleContent>
          <div className="overflow-x-auto border-t border-border" tabIndex={0} role="region" aria-label={`${model} motor seçenekleri`}>
            <Table className="min-w-[540px] border-collapse text-left text-xs leading-5"><TableHeader className="[&_tr]:border-0"><TableRow className="hover:bg-transparent">{["Motor / motor kodu","Güç / hacim","Üretim aralığı","Veri bağlantısı"].map(label => <TableHead key={label} scope="col" className="h-auto bg-[#f7f8fa] px-4 py-3 font-medium text-muted-foreground">{label}</TableHead>)}</TableRow></TableHeader><TableBody>
              {rows.map(vehicle => <TableRow key={`${vehicle.engineAndCodes}-${vehicle.fuel}-${vehicle.ps}-${vehicle.kw}-${vehicle.cc}-${vehicle.from}-${vehicle.to}`} className="border-0 hover:bg-transparent [&>td]:border-t [&>td]:border-border [&>td]:px-4 [&>td]:py-3.5 [&>td]:align-top [&_small]:mt-1 [&_small]:block [&_small]:text-[11px] [&_small]:text-muted-foreground">
                <TableCell className="w-[48%] whitespace-normal"><strong className="font-medium">{vehicle.catalogEngine || vehicle.engineAndCodes}</strong>{vehicle.catalogEngine && vehicle.engineAndCodes !== vehicle.catalogEngine && <small>Kaynak motor bilgisi: {vehicle.engineAndCodes}</small>}<small>{fuelLabels[vehicle.fuel] || vehicle.fuel}</small></TableCell>
                <TableCell className="whitespace-normal">{vehicle.ps} PS · {vehicle.kw} kW{vehicle.cc > 0 && <small>{vehicle.cc} cm³</small>}</TableCell>
                <TableCell className="whitespace-normal">{vehicle.from} – {vehicle.to || "Bitiş belirtilmemiş"}</TableCell>
                <TableCell>{vehicle.vehicleTypeId ? <span className="text-[11px] whitespace-nowrap text-[#26734d]" title={`Araç tipi: ${vehicle.vehicleTypeId}`}>Kataloğa bağlı</span> : <span className="text-[11px] whitespace-nowrap text-[#68778a]">Kaynak kaydı</span>}</TableCell>
              </TableRow>)}
            </TableBody></Table>
          </div>
          </CollapsibleContent>
        </Collapsible>;
      })}
    </div>
    {matches.length === 0 && <p className="rounded-lg bg-[#f7f8fa] p-6 text-sm">Bu aramayla eşleşen araç bulunamadı. Model veya motor koduyla tekrar ara.</p>}
  </section>;
}
