"use client";

import { useRef, useState } from "react";
import { SiteIcon } from "@/components/site/site-icon";
import { CarFront } from "lucide-react";
import { VehicleSheet } from "./vehicle-sheet";
import type { SavedVehicle } from "@/modules/store/vehicle-catalog";

export function GarageButton({ vehicle, variant = "header" }: { vehicle: SavedVehicle | null; variant?: "header" | "hero" | "catalog" | "product" }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return <>
    <button ref={trigger} type="button" className={variant === "header" ? "garage-tool header-tool" : variant === "product" ? "pdp-vehicle-button" : variant === "catalog" ? "catalog-vehicle-button" : "vehicle-picker"} aria-label={vehicle ? `Araç seçimi, ${vehicle.make} ${vehicle.model}` : "Marka ve modele göre araç seç"} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
      {variant === "product" ? "Aracını seç, uyumluluk bilgilerini karşılaştır" : variant === "header" ? <><SiteIcon name="garage" size={32} /><span><strong>Garajım <SiteIcon name="chevron" size={13} /></strong><small>{vehicle ? `${vehicle.make} ${vehicle.model}` : "Aracını seç"}</small></span></> : variant === "catalog" ? <><span>{vehicle ? `${vehicle.make} ${vehicle.model}` : "Marka ve modele göre seç"}</span><SiteIcon name="chevron" size={16} /></> : <><div className="vehicle-icon"><CarFront size={24} aria-hidden="true" /></div><span><strong>{vehicle ? `${vehicle.make} ${vehicle.model}` : "Marka ve modele göre seç"}</strong><small>{vehicle ? `${vehicle.year}${vehicle.engine ? ` · ${vehicle.engine}` : " · Garajına kayıtlı"}` : "Aracına ait seçenekleri keşfet"}</small></span><SiteIcon name="chevron" size={18} /></>}
    </button>
    {open && <VehicleSheet vehicle={vehicle} initialTab={vehicle && variant === "header" ? "garage" : "search"} onClose={() => { setOpen(false); requestAnimationFrame(() => trigger.current?.focus()); }} />}
  </>;
}
