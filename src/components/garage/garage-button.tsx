"use client";

import { useRef, useState } from "react";
import { SiteIcon } from "@/components/site/site-icon";
import { CarFront } from "lucide-react";
import { headerToolClass } from "@/components/navigation/header-tool";
import { cn } from "@/lib/utils";
import { useStoreRoute } from "@/components/layout/store-route";
import { VehicleSheet } from "./vehicle-sheet";
import type { SavedVehicle } from "@/modules/store/vehicle-catalog";

type Variant = "header" | "hero" | "catalog" | "product";

const variantClass: Record<Variant, string> = {
  header: headerToolClass,
  product: "block h-auto min-h-0 rounded-none border-0 bg-transparent p-0 text-left text-sm leading-5 font-medium text-[#212b36] underline underline-offset-4 hover:bg-transparent hover:text-[#0069c7]",
  catalog: "flex h-14 min-h-14 w-[320px] items-center justify-between gap-2.5 rounded-md border-2 border-white bg-white py-4 pr-[18px] pl-[15px] text-left text-base leading-6 font-normal text-[#54626e] hover:border-white hover:bg-white max-[850px]:text-sm min-[601px]:max-[850px]:w-60 min-[601px]:max-[850px]:shrink-0 max-[600px]:mt-3 max-[600px]:w-full [&>span]:truncate",
  hero: "inline-flex min-h-16 max-w-full min-w-[260px] items-center gap-3 rounded-xl border border-border bg-[#f7f8fa] px-4 py-2.5 text-left text-foreground shadow-none hover:border-[#b8d9ee] hover:bg-accent",
};

export function GarageButton({ vehicle, variant = "header", className }: { vehicle: SavedVehicle | null; variant?: Variant; className?: string }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  // In the home hero the phone layout already separates the button from the search field.
  const home = useStoreRoute() === "home";
  return <>
    <button ref={trigger} type="button" className={cn("cursor-pointer", variantClass[variant], home && variant === "catalog" && "max-[600px]:mt-0", className)} aria-label={vehicle ? `Araç seçimi, ${vehicle.make} ${vehicle.model}` : "Marka ve modele göre araç seç"} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
      {variant === "product" ? "Aracını seç, uyumluluk bilgilerini karşılaştır"
        : variant === "header" ? <><SiteIcon name="garage" size={32} /><span><strong>Garajım <SiteIcon name="chevron" size={13} /></strong><small>{vehicle ? `${vehicle.make} ${vehicle.model}` : "Aracını seç"}</small></span></>
        : variant === "catalog" ? <><span>{vehicle ? `${vehicle.make} ${vehicle.model}` : "Marka ve modele göre seç"}</span><SiteIcon name="chevron" size={16} className="-rotate-90" /></>
        : <><div className="flex size-[38px] flex-[0_0_38px] items-center justify-center rounded-full bg-white text-primary"><CarFront size={24} aria-hidden="true" /></div><span className="min-w-0 flex-1"><strong className="block text-sm leading-[22px] font-medium [overflow-wrap:anywhere]">{vehicle ? `${vehicle.make} ${vehicle.model}` : "Marka ve modele göre seç"}</strong><small className="block text-xs leading-[18px] text-muted-foreground">{vehicle ? `${vehicle.year}${vehicle.engine ? ` · ${vehicle.engine}` : " · Garajına kayıtlı"}` : "Aracına ait seçenekleri keşfet"}</small></span><SiteIcon name="chevron" size={18} className="text-muted-foreground" /></>}
    </button>
    <VehicleSheet open={open} vehicle={vehicle} initialTab={vehicle && variant === "header" ? "garage" : "search"} onClose={() => setOpen(false)} finalFocus={trigger} />
  </>;
}
