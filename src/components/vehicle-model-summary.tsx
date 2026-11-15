import { GarageButton } from "@/components/garage/garage-button";
import { getModelGroupEngines } from "@/modules/store/vehicle-model-groups.server";
import { vehicleProductionDates, type ShownVehicle } from "@/modules/store/vehicle-catalog";
import type { VehicleModelGroup } from "@/modules/store/vehicle-model-groups";

const number = (value: number) => value.toLocaleString("tr-TR");
const range = (values: [number, number] | null, unit: string) =>
  values && (values[0] === values[1] ? `${number(values[0])} ${unit}` : `${number(values[0])}–${number(values[1])} ${unit}`);

// A vehicle model page's facts (#639): production dates, the TecDoc series it merges and its engines per fuel. The
// list is model-level, so the garage picker is offered to narrow it to an engine type.
export async function VehicleModelSummary({ name, model, vehicle }: { name: string; model: VehicleModelGroup; vehicle: ShownVehicle | null }) {
  const engines = await getModelGroupEngines(model.models.map(series => series.id));
  return <section aria-label={`${name} bilgileri`} className="mt-4 grid gap-6 rounded-xl border border-[#e5e7eb] bg-[#f7f8fa] p-6 min-[769px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] max-[600px]:p-4">
    <dl className="grid content-start gap-3 text-[13px] leading-[18px]">
      <div><dt className="font-semibold">Üretim</dt><dd className="text-muted-foreground">{vehicleProductionDates(model.dateFrom, model.dateTo)}</dd></div>
      <div><dt className="font-semibold">Kasa ve seriler</dt><dd className="text-muted-foreground">{model.models.map(series => series.name).join(", ")}</dd></div>
      {engines.length > 0 && <div><dt className="font-semibold">Motor seçenekleri</dt><dd>
        <ul className="text-muted-foreground">{engines.map(engine => <li key={engine.fuel}>
          {[engine.fuel, `${number(engine.engines)} motor tipi`, range(engine.cc, "cm³"), range(engine.hp, "HP")].filter(Boolean).join(" · ")}
        </li>)}</ul>
      </dd></div>}
    </dl>
    <div className="flex flex-col items-start justify-center gap-3">
      <p className="text-[13px] leading-[18px]">Bu liste model düzeyindedir. Motor tipine göre doğrulamak için aracını seç.</p>
      <GarageButton vehicle={vehicle} variant="hero" />
    </div>
  </section>;
}
