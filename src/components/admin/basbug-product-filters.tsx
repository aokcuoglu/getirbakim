"use client";

import { useState } from "react";
import Link from "next/link";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { basbugWarehouse, basbugWarehouses } from "@/modules/suppliers/basbug-stock";
import type { BasbugParams } from "@/modules/admin/basbug";

export function BasbugProductFilters({ params, groups, brands, currencies }: {
  params: BasbugParams;
  groups: { kod: string; ad: string; ready: boolean }[];
  brands: string[];
  currencies: string[];
}) {
  const [presence, setPresence] = useState(params.presence || "present");
  const [quality, setQuality] = useState(params.quality || "");
  const extraCount = Number(presence !== "present") + Number(Boolean(quality));
  return <form action="/yonetim/tedarikciler/basbug" aria-label="Ürün filtreleri" className="flex items-center gap-2 border-b p-3">
    <input type="hidden" name="presence" value={presence}/>
    <input type="hidden" name="quality" value={quality}/>
    <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto [&>[data-slot=native-select-wrapper]]:shrink-0">
      <InputGroup className="min-w-44 flex-1"><InputGroupAddon><Search aria-hidden="true"/></InputGroupAddon><InputGroupInput name="q" aria-label="Ara" defaultValue={params.q} placeholder="Parça, OEM, ürün veya marka" maxLength={120}/></InputGroup>
      <NativeSelect className="w-32" aria-label="Liste grubu" name="group" defaultValue={params.group || ""}><NativeSelectOption value="">Tüm gruplar</NativeSelectOption>{groups.map(g => <NativeSelectOption key={g.kod} value={g.kod}>{g.ad}{g.ready ? "" : " · Henüz çekilmedi"}</NativeSelectOption>)}</NativeSelect>
      <NativeSelect className="w-28" aria-label="Marka" name="brand" defaultValue={params.brand || ""}><NativeSelectOption value="">Markalar</NativeSelectOption>{brands.map(b => <NativeSelectOption key={b} value={b}>{b || "Belirtilmemiş"}</NativeSelectOption>)}</NativeSelect>
      <NativeSelect className="w-20" aria-label="Para birimi" name="currency" defaultValue={params.currency || ""}><NativeSelectOption value="">Döviz</NativeSelectOption>{currencies.map(c => <NativeSelectOption key={c} value={c}>{c}</NativeSelectOption>)}</NativeSelect>
      <NativeSelect className="w-20" aria-label="Stok deposu" name="warehouse" defaultValue={basbugWarehouse(params.warehouse)}>{basbugWarehouses.map(depot => <NativeSelectOption key={depot} value={depot}>{depot}</NativeSelectOption>)}</NativeSelect>
      <NativeSelect className="w-28" aria-label="Stok durumu" name="stock" defaultValue={params.stock || ""}><NativeSelectOption value="">Stok: tümü</NativeSelectOption><NativeSelectOption value="1">Stok var</NativeSelectOption><NativeSelectOption value="0">Stok yok</NativeSelectOption><NativeSelectOption value="unknown">Veri yok</NativeSelectOption></NativeSelect>
    </div>
    <div className="flex shrink-0 items-center gap-2">
      <Popover>
        <PopoverTrigger render={<Button type="button" size="icon" variant={extraCount ? "secondary" : "outline"} className="relative shrink-0" aria-label={extraCount ? `Diğer filtreler (${extraCount} etkin)` : "Diğer filtreler"} title="Listede bulunma ve veri kalitesi"/>}><SlidersHorizontal aria-hidden="true"/>{extraCount > 0 && <span className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-primary text-[10px] text-primary-foreground">{extraCount}</span>}</PopoverTrigger>
        <PopoverContent align="end" className="admin-app w-72 gap-3 p-4">
          <PopoverTitle>Diğer filtreler</PopoverTitle>
          <label className="flex flex-col gap-1.5 text-xs font-medium">Listede bulunma<NativeSelect className="w-full" aria-label="Listede bulunma" value={presence} onChange={event => setPresence(event.target.value)}><NativeSelectOption value="present">Güncel listede var</NativeSelectOption><NativeSelectOption value="pending_missing">İlk kez bulunamadı</NativeSelectOption><NativeSelectOption value="inactive">İki çekimde bulunamadı</NativeSelectOption><NativeSelectOption value="all">Tüm kayıtlar</NativeSelectOption></NativeSelect></label>
          <label className="flex flex-col gap-1.5 text-xs font-medium">Veri kalitesi<NativeSelect className="w-full" aria-label="Veri kalitesi" value={quality} onChange={event => setQuality(event.target.value)}><NativeSelectOption value="">Kalite: tümü</NativeSelectOption><NativeSelectOption value="missing-price">Fiyatı eksik</NativeSelectOption><NativeSelectOption value="duplicates">Tekrarlanan kod</NativeSelectOption><NativeSelectOption value="conflicts">Çelişkili kayıt</NativeSelectOption></NativeSelect></label>
          <p className="text-xs text-muted-foreground">Seçimlerini uygulamak için Filtrele düğmesini kullan.</p>
        </PopoverContent>
      </Popover>
      <Button type="submit" className="shrink-0">Filtrele</Button>
      <Link href="/yonetim/tedarikciler/basbug" aria-label="Filtreleri temizle" title="Filtreleri temizle" className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"><X className="size-4" aria-hidden="true"/></Link>
    </div>
  </form>;
}
