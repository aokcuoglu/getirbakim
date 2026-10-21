import { Fragment } from "react";
import Link from "next/link";
import { CircleAlert, X } from "lucide-react";
import { oilCapacity, vehicleOilFilters, type OilFilter, type VehicleOilSpec } from "@/modules/store/vehicle-oil";

const chip = "inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-full border px-3 py-1 text-[13px] leading-5 font-medium";

export function oilApprovalLabel(spec: VehicleOilSpec) {
  return [spec.acea.length ? `ACEA ${spec.acea.join(" / ")}` : "", ...spec.approvals].filter(Boolean).join(" · ");
}

/**
 * The garage vehicle's recommended engine oil above oil listings. `href` builds the listing URL with the
 * given oil filters, `total` is the listing's count while a filter is on; without `href` the banner only informs.
 */
export function VehicleOilBanner({ spec, vehicleName, active, total, href }: {
  spec: VehicleOilSpec; vehicleName: string; active: ReadonlySet<OilFilter>; total: number;
  href?: (filters: OilFilter[]) => string;
}) {
  const capacity = oilCapacity(spec);
  const facts = [
    spec.viscosities.length ? { label: "Viskozite", value: `SAE ${spec.viscosities.join(", ")}` } : null,
    spec.acea.length ? { label: "ACEA", value: spec.acea.join(", ") } : null,
    spec.api.length ? { label: "API", value: spec.api.join(", ") } : null,
    spec.approvals.length ? { label: "Üretici onayı", value: spec.approvals.join(", ") } : null,
  ].filter(fact => fact !== null);
  // A filter the vehicle's data cannot answer (no grade, no ACEA class or approval) would match no oil.
  const filters = vehicleOilFilters(spec).map(key => ({ key, label: key === "viscosity" ? spec.viscosities.join(" / ") : oilApprovalLabel(spec) }));
  const without = (key: OilFilter) => filters.map(filter => filter.key).filter(other => active.has(other) && other !== key);
  return <section aria-label="Aracın için önerilen motor yağı" className="mb-4 flex gap-3 rounded-[5px] border border-[#f1d08a] bg-[#fff9eb] px-4 py-3.5 text-[13px] leading-5 text-foreground max-[600px]:px-3.5">
    <CircleAlert size={22} className="mt-px shrink-0 fill-[#f0a020] text-white" aria-hidden="true"/>
    <div className="min-w-0 flex-1">
      {capacity ? <p className="m-0 text-[15px] leading-[22px]"><strong className="font-semibold">Aracın için önerilen yağ miktarı:</strong> {capacity}</p>
        : <p className="m-0 text-[15px] leading-[22px]"><strong className="font-semibold">Aracın için önerilen motor yağı</strong></p>}
      {facts.length > 0 && <p className="mt-1.5 mb-0 wrap-anywhere">{facts.map((fact, index) => <Fragment key={fact.label}>{index > 0 && <span className="mx-1.5 text-[#c9b27a]" aria-hidden="true">|</span>}<strong className="font-semibold">{fact.label}:</strong> {fact.value}</Fragment>)}</p>}
      <p className="mt-1.5 mb-0 text-xs text-muted-foreground">{vehicleName} için. Değerler bilgi amaçlıdır; aracının kullanım kılavuzuyla karşılaştır.</p>
      {href && filters.length > 0 && <div className="mt-3 flex flex-wrap items-center gap-2">
        {active.size ? <>
          {filters.filter(filter => active.has(filter.key)).map(filter => <Link key={filter.key} scroll={false} href={href(without(filter.key))}
            aria-label={`${filter.label} filtresini kaldır`} className={`${chip} border-[#d9dee3] bg-white hover:border-[#54626e]`}>
            <span className="truncate">{filter.label}</span><X size={14} className="shrink-0" aria-hidden="true"/></Link>)}
          {filters.filter(filter => !active.has(filter.key)).map(filter => <Link key={filter.key} scroll={false} href={href([...active, filter.key])}
            className="text-[13px] font-semibold text-primary hover:underline">+ {filter.key === "viscosity" ? "Viskoziteye" : "Onaya"} göre süz</Link>)}
          <Link scroll={false} href={href([])} className="text-[13px] font-semibold text-primary hover:underline">Tümünü temizle</Link>
          <span className="text-xs text-muted-foreground" role="status">{total.toLocaleString("tr-TR")} uygun yağ</span>
        </> : <Link scroll={false} href={href(filters.map(filter => filter.key))} className={`${chip} border-brand bg-brand text-white hover:bg-brand-strong`}>Bu özelliklere uygun yağları göster</Link>}
      </div>}
    </div>
  </section>;
}
