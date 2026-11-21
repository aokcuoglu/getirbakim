"use client";

import { useRef, useState } from "react";
import { SiteIcon } from "@/components/site/site-icon";
import { CarFront } from "lucide-react";
import { headerToolClass } from "@/components/navigation/header-tool";
import { cn } from "@/lib/utils";
import { storeButton } from "@/components/store-button";
import { lazyModule } from "@/lib/lazy-module";
import type { ShownVehicle } from "@/modules/store/vehicle-catalog";

// The sheet (Base UI dialog + tabs, ~40 kB) is fetched on the first hover, focus or click, not with every page (#1017).
const vehicleSheet = lazyModule(() => import("./vehicle-sheet"));

type Variant = "header" | "hero" | "catalog" | "home" | "product";

const variantClass: Record<Variant, string> = {
  header: headerToolClass,
  product: cn(storeButton({ intent: "link", size: "md" }), "block px-0 text-left whitespace-normal underline"),
  catalog: "flex h-14 min-h-14 w-[320px] items-center justify-between gap-2.5 rounded-md border-2 border-white bg-white py-4 pr-[18px] pl-[15px] text-left text-base leading-6 font-normal text-muted-foreground hover:border-white hover:bg-white max-[850px]:text-sm min-[600px]:max-[850px]:w-60 min-w-0 max-[600px]:mt-3 max-[600px]:w-full [&>span]:truncate",
  home: cn("inline-flex max-w-full min-w-0 items-center justify-center border max-[600px]:w-full", storeButton({ intent: "secondary", size: "hero" }), "focus-visible:outline-white"),
  hero: "inline-flex min-h-16 max-w-full min-w-[260px] items-center gap-3 rounded-xl border border-border bg-muted px-4 py-2.5 text-left text-foreground shadow-none hover:border-primary hover:bg-accent",
};

export function GarageButton({ vehicle, variant = "header", className }: { vehicle: ShownVehicle | null; variant?: Variant; className?: string }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const sheet = vehicleSheet.useModule();
  return <>
    <button ref={trigger} type="button" className={cn("cursor-pointer", variantClass[variant], className)} aria-label={variant === "product" ? undefined : vehicle ? `Araç seçimi, ${vehicle.makeLabel} ${vehicle.modelLabel}` : variant === "home" ? "Aracını seç: marka ve modele göre" : "Marka ve modele göre araç seç"} aria-haspopup="dialog" aria-expanded={open} aria-busy={open && !sheet ? true : undefined}
      onPointerEnter={vehicleSheet.preload} onFocus={vehicleSheet.preload}
      onClick={() => { setOpen(true); vehicleSheet.preload().catch(() => setOpen(false)); }}>
      {variant === "product" ? (vehicle ? <>Aracın: <strong>{vehicle.makeLabel} {vehicle.modelLabel}{vehicle.engine ? ` ${vehicle.engine}` : ""}</strong> · Değiştir</> : "Aracını seç, uyumluluk bilgilerini karşılaştır")
        : variant === "header" ? <><SiteIcon name="garage" size={32} /><span><strong>Garajım <SiteIcon name="chevron" size={13} /></strong><small>{vehicle ? `${vehicle.makeLabel} ${vehicle.modelLabel}` : "Aracını seç"}</small></span></>
        : variant === "home" ? <><CarFront size={22} aria-hidden="true" /><span className="truncate">{vehicle ? `${vehicle.makeLabel} ${vehicle.modelLabel}` : "Aracını seç"}</span><SiteIcon name="chevron" size={16} className="shrink-0 -rotate-90" /></>
        : variant === "catalog" ? <><span>{vehicle ? `${vehicle.makeLabel} ${vehicle.modelLabel}` : "Marka ve modele göre seç"}</span><SiteIcon name="chevron" size={16} className="shrink-0 -rotate-90" /></>
        : <><div className="flex size-[38px] flex-[0_0_38px] items-center justify-center rounded-full bg-white text-primary"><CarFront size={24} aria-hidden="true" /></div><span className="min-w-0 flex-1"><strong className="block text-sm leading-[22px] font-medium [overflow-wrap:anywhere]">{vehicle ? `${vehicle.makeLabel} ${vehicle.modelLabel}` : "Marka ve modele göre seç"}</strong><small className="block text-xs leading-[18px] text-muted-foreground">{vehicle ? `${vehicle.year}${vehicle.engine ? ` · ${vehicle.engine}` : " · Garajına kayıtlı"}` : "Aracına ait seçenekleri keşfet"}</small></span><SiteIcon name="chevron" size={18} className="text-muted-foreground" /></>}
    </button>
    {sheet && <sheet.VehicleSheet open={open} vehicle={vehicle} initialTab={vehicle ? "garage" : "search"} onClose={() => setOpen(false)} finalFocus={trigger} />}
  </>;
}
