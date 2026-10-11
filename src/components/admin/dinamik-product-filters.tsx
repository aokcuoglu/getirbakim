"use client";

import { useState } from "react";
import Link from "next/link";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { dinamikRegion, dinamikRegions } from "@/modules/suppliers/dinamik-stock";
import type { DinamikParams } from "@/modules/admin/dinamik";

export function DinamikProductFilters({ params, brands, groups }: { params: DinamikParams; brands: string[]; groups: string[] }) {
  const [presence, setPresence] = useState(params.presence || "present");
  const [quality, setQuality] = useState(params.quality || "");
  const extraCount = Number(presence !== "present") + Number(Boolean(quality));
  return <form action="/yonetim/tedarikciler/dinamik" aria-label="Ürün filtreleri" className="flex items-center gap-2 border-b p-3">
    <input type="hidden" name="presence" value={presence}/>
    <input type="hidden" name="quality" value={quality}/>
    <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto [&>[data-slot=native-select-wrapper]]:shrink-0">
      <InputGroup className="min-w-44 flex-1"><InputGroupAddon><Search aria-hidden="true"/></InputGroupAddon><InputGroupInput name="q" aria-label="Ara" defaultValue={params.q} placeholder="Stok kodu, ürün adı veya OEM" maxLength={120}/></InputGroup>
      <NativeSelect className="w-36" aria-label="Marka" name="brand" defaultValue={params.brand || ""}><NativeSelectOption value="">Tüm markalar</NativeSelectOption>{brands.map(brand => <NativeSelectOption key={brand} value={brand}>{brand}</NativeSelectOption>)}</NativeSelect>
      <NativeSelect className="w-36" aria-label="Ürün grubu" name="group" defaultValue={params.group || ""}><NativeSelectOption value="">Ürün grupları</NativeSelectOption>{groups.map(group => <NativeSelectOption key={group} value={group}>{group}</NativeSelectOption>)}</NativeSelect>
      <NativeSelect className="w-28" aria-label="Stok bölgesi" name="region" defaultValue={dinamikRegion(params.region)}><NativeSelectOption value="any">Herhangi bölge</NativeSelectOption>{dinamikRegions.map(region => <NativeSelectOption key={region.key} value={region.key}>{region.label}</NativeSelectOption>)}</NativeSelect>
      <NativeSelect className="w-28" aria-label="Stok durumu" name="stock" defaultValue={params.stock || ""}><NativeSelectOption value="">Stok: tümü</NativeSelectOption><NativeSelectOption value="1">Stok var</NativeSelectOption><NativeSelectOption value="0">Stok yok</NativeSelectOption><NativeSelectOption value="unknown">Veri yok</NativeSelectOption></NativeSelect>
    </div>
    <div className="flex shrink-0 items-center gap-2">
      <Popover>
        <PopoverTrigger render={<Button type="button" size="icon" variant={extraCount ? "secondary" : "outline"} className="relative shrink-0" aria-label={extraCount ? `Diğer filtreler (${extraCount} etkin)` : "Diğer filtreler"} title="Listede bulunma ve veri kalitesi"/>}><SlidersHorizontal aria-hidden="true"/>{extraCount > 0 && <span className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-primary text-[10px] text-primary-foreground">{extraCount}</span>}</PopoverTrigger>
        <PopoverContent align="end" className="admin-app w-72 gap-3 p-4">
          <PopoverTitle>Diğer filtreler</PopoverTitle>
          <label className="flex flex-col gap-1.5 text-xs font-medium">Listede bulunma<NativeSelect className="w-full" aria-label="Listede bulunma" value={presence} onChange={event => setPresence(event.target.value)}><NativeSelectOption value="present">Güncel listede var</NativeSelectOption><NativeSelectOption value="pending_missing">İlk kez bulunamadı</NativeSelectOption><NativeSelectOption value="inactive">İki çekimde bulunamadı</NativeSelectOption><NativeSelectOption value="all">Tüm kayıtlar</NativeSelectOption></NativeSelect></label>
          <label className="flex flex-col gap-1.5 text-xs font-medium">Veri kalitesi<NativeSelect className="w-full" aria-label="Veri kalitesi" value={quality} onChange={event => setQuality(event.target.value)}><NativeSelectOption value="">Kalite: tümü</NativeSelectOption><NativeSelectOption value="price-only">Yalnız fiyat listesinde</NativeSelectOption><NativeSelectOption value="missing-price">Fiyatı eksik</NativeSelectOption><NativeSelectOption value="campaign">Kampanyalı</NativeSelectOption><NativeSelectOption value="duplicates">Tekrarlanan kod</NativeSelectOption><NativeSelectOption value="conflicts">Çelişkili kayıt</NativeSelectOption></NativeSelect></label>
          <p className="text-xs text-muted-foreground">Seçimlerini uygulamak için Filtrele düğmesini kullan.</p>
        </PopoverContent>
      </Popover>
      <Button type="submit" className="shrink-0">Filtrele</Button>
      <Link href="/yonetim/tedarikciler/dinamik" aria-label="Filtreleri temizle" title="Filtreleri temizle" className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"><X className="size-4" aria-hidden="true"/></Link>
    </div>
  </form>;
}
