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
import type { ManualParams } from "@/modules/admin/manual";

export function ManualProductFilters({ params, list, lists, categories }: { params: ManualParams; list: string; lists: { value: string; label: string }[]; categories: string[] }) {
  const [presence, setPresence] = useState(params.presence || "present");
  const [quality, setQuality] = useState(params.quality || "");
  const extraCount = Number(presence !== "present") + Number(Boolean(quality));
  return <form action="/yonetim/tedarikciler/manuel" aria-label="Ürün filtreleri" className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
    <input type="hidden" name="presence" value={presence}/>
    <input type="hidden" name="quality" value={quality}/>
    <div className="flex min-w-0 flex-1 basis-full items-center gap-2 overflow-x-auto sm:basis-auto">
      {lists.length > 1 ? <NativeSelect className="w-40" aria-label="Liste" name="liste" defaultValue={list}>{lists.map(entry => <NativeSelectOption key={entry.value} value={entry.value}>{entry.label}</NativeSelectOption>)}</NativeSelect> : <input type="hidden" name="liste" value={list}/>}
      <InputGroup className="min-w-44 flex-1"><InputGroupAddon><Search aria-hidden="true"/></InputGroupAddon><InputGroupInput name="q" aria-label="Ara" defaultValue={params.q} placeholder="Ürün kodu, adı veya marka" maxLength={120}/></InputGroup>
      <NativeSelect className="w-40" aria-label="Kategori" name="category" defaultValue={params.category || ""}><NativeSelectOption value="">Tüm kategoriler</NativeSelectOption>{categories.map(category => <NativeSelectOption key={category} value={category}>{category}</NativeSelectOption>)}</NativeSelect>
      <NativeSelect className="w-32" aria-label="Stok durumu" name="stock" defaultValue={params.stock || ""}><NativeSelectOption value="">Stok: tümü</NativeSelectOption><NativeSelectOption value="1">Stok var</NativeSelectOption><NativeSelectOption value="0">Stok yok</NativeSelectOption><NativeSelectOption value="none">Stok bilgisi yok</NativeSelectOption></NativeSelect>
    </div>
    <div className="flex shrink-0 items-center gap-2">
      <Popover>
        <PopoverTrigger render={<Button type="button" variant="outline" aria-label={extraCount ? `Diğer filtreler (${extraCount} etkin)` : "Diğer filtreler"} title="Listede bulunma ve veri kalitesi"/>}><SlidersHorizontal data-icon="inline-start" aria-hidden="true"/>Diğer{extraCount > 0 && <Badge variant="secondary">{extraCount}</Badge>}</PopoverTrigger>
        <PopoverContent align="end" className="w-72">
          <PopoverHeader><PopoverTitle>Diğer filtreler</PopoverTitle></PopoverHeader>
          <FieldGroup>
            <Field><FieldLabel htmlFor="filter-presence">Listede bulunma</FieldLabel><NativeSelect id="filter-presence" value={presence} onChange={event => setPresence(event.target.value)}><NativeSelectOption value="present">Güncel listede var</NativeSelectOption><NativeSelectOption value="pending_missing">Son yüklemede yok</NativeSelectOption><NativeSelectOption value="inactive">İki yüklemede yok</NativeSelectOption><NativeSelectOption value="all">Tüm kayıtlar</NativeSelectOption></NativeSelect></Field>
            <Field><FieldLabel htmlFor="filter-quality">Veri kalitesi</FieldLabel><NativeSelect id="filter-quality" value={quality} onChange={event => setQuality(event.target.value)}><NativeSelectOption value="">Kalite: tümü</NativeSelectOption><NativeSelectOption value="missing-price">Fiyatı eksik</NativeSelectOption><NativeSelectOption value="missing-package">Ambalajı eksik</NativeSelectOption><NativeSelectOption value="missing-image">Resmi yok</NativeSelectOption></NativeSelect></Field>
            <FieldDescription>Seçimlerini uygulamak için Filtrele düğmesini kullan.</FieldDescription>
          </FieldGroup>
        </PopoverContent>
      </Popover>
      <Button type="submit">Filtrele</Button>
      <Button variant="ghost" size="icon" aria-label="Filtreleri temizle" title="Filtreleri temizle" nativeButton={false} render={<Link href={`/yonetim/tedarikciler/manuel?liste=${list}`}/>}><X aria-hidden="true"/></Button>
    </div>
  </form>;
}
