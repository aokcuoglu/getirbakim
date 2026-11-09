"use client";

import { useState } from "react";
import Link from "next/link";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { dinamikRegion, dinamikRegions } from "@/modules/suppliers/dinamik-stock";
import type { DinamikParams } from "@/modules/admin/dinamik";

export function DinamikProductFilters({ params, brands, groups }: { params: DinamikParams; brands: string[]; groups: string[] }) {
  const [presence, setPresence] = useState(params.presence || "present");
  const [quality, setQuality] = useState(params.quality || "");
  const extraCount = Number(presence !== "present") + Number(Boolean(quality));
  return <form action="/yonetim/tedarikciler/dinamik" aria-label="Ürün filtreleri" className="flex items-center gap-2">
    <input type="hidden" name="presence" value={presence}/>
    <input type="hidden" name="quality" value={quality}/>
    <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
      <InputGroup className="min-w-44 flex-1"><InputGroupAddon><Search aria-hidden="true"/></InputGroupAddon><InputGroupInput name="q" aria-label="Ara" defaultValue={params.q} placeholder="Stok kodu, ürün adı veya OEM" maxLength={120}/></InputGroup>
      <NativeSelect className="w-36" aria-label="Marka" name="brand" defaultValue={params.brand || ""}><NativeSelectOption value="">Tüm markalar</NativeSelectOption>{brands.map(brand => <NativeSelectOption key={brand} value={brand}>{brand}</NativeSelectOption>)}</NativeSelect>
      <NativeSelect className="w-36" aria-label="Ürün grubu" name="group" defaultValue={params.group || ""}><NativeSelectOption value="">Ürün grupları</NativeSelectOption>{groups.map(group => <NativeSelectOption key={group} value={group}>{group}</NativeSelectOption>)}</NativeSelect>
      <NativeSelect className="w-28" aria-label="Stok bölgesi" name="region" defaultValue={dinamikRegion(params.region)}><NativeSelectOption value="any">Herhangi bölge</NativeSelectOption>{dinamikRegions.map(region => <NativeSelectOption key={region.key} value={region.key}>{region.label}</NativeSelectOption>)}</NativeSelect>
      <NativeSelect className="w-28" aria-label="Stok durumu" name="stock" defaultValue={params.stock || ""}><NativeSelectOption value="">Stok: tümü</NativeSelectOption><NativeSelectOption value="1">Stok var</NativeSelectOption><NativeSelectOption value="0">Stok yok</NativeSelectOption><NativeSelectOption value="unknown">Veri yok</NativeSelectOption></NativeSelect>
    </div>
    <div className="flex shrink-0 items-center gap-2">
      <Popover>
        <PopoverTrigger render={<Button type="button" variant="outline" aria-label={extraCount ? `Diğer filtreler (${extraCount} etkin)` : "Diğer filtreler"} title="Listede bulunma ve veri kalitesi"/>}><SlidersHorizontal data-icon="inline-start" aria-hidden="true"/>Diğer{extraCount > 0 && <Badge variant="secondary">{extraCount}</Badge>}</PopoverTrigger>
        <PopoverContent align="end" className="w-72">
          <PopoverHeader><PopoverTitle>Diğer filtreler</PopoverTitle></PopoverHeader>
          <FieldGroup>
            <Field><FieldLabel htmlFor="filter-presence">Listede bulunma</FieldLabel><NativeSelect id="filter-presence" value={presence} onChange={event => setPresence(event.target.value)}><NativeSelectOption value="present">Güncel listede var</NativeSelectOption><NativeSelectOption value="pending_missing">İlk kez bulunamadı</NativeSelectOption><NativeSelectOption value="inactive">İki çekimde bulunamadı</NativeSelectOption><NativeSelectOption value="all">Tüm kayıtlar</NativeSelectOption></NativeSelect></Field>
            <Field><FieldLabel htmlFor="filter-quality">Veri kalitesi</FieldLabel><NativeSelect id="filter-quality" value={quality} onChange={event => setQuality(event.target.value)}><NativeSelectOption value="">Kalite: tümü</NativeSelectOption><NativeSelectOption value="price-only">Yalnız fiyat listesinde</NativeSelectOption><NativeSelectOption value="missing-price">Fiyatı eksik</NativeSelectOption><NativeSelectOption value="campaign">Kampanyalı</NativeSelectOption><NativeSelectOption value="duplicates">Tekrarlanan kod</NativeSelectOption><NativeSelectOption value="conflicts">Çelişkili kayıt</NativeSelectOption></NativeSelect></Field>
            <FieldDescription>Seçimlerini uygulamak için Filtrele düğmesini kullan.</FieldDescription>
          </FieldGroup>
        </PopoverContent>
      </Popover>
      <Button type="submit">Filtrele</Button>
      <Button variant="ghost" size="icon" aria-label="Filtreleri temizle" title="Filtreleri temizle" nativeButton={false} render={<Link href="/yonetim/tedarikciler/dinamik"/>}><X aria-hidden="true"/></Button>
    </div>
  </form>;
}
