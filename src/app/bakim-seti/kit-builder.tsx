"use client";

import { useMemo, useState, useTransition } from "react";
import { CircleAlert, CircleCheck, ExternalLink, ShoppingCart } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { NativeSelect, NativeSelectOptGroup, NativeSelectOption } from "@/components/ui/native-select";
import {
  familyName, kitBaseSvg, kitCanvas, kitImageQuery, kitLayout, kitSlots, packshotSvg, svgDataUri,
  type KitFilterKey, type KitItem, type KitSelection, type KitSlotKey, type KitSlotOptions,
} from "@/modules/store/maintenance-kit";
import { addKitToCart } from "./actions";

const money = (kurus: number) => new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(kurus / 100);
const filterKeys: KitFilterKey[] = ["air", "oil", "cabin", "fuel"];
const preferredFamilies = ["BOSCH", "MANN", "MAHLE", "FILTRON", "UFI", "HENGST"];
const percent = (value: number) => `${(value / kitCanvas) * 100}%`;

/** Same layers as the server image: template SVG, then one packshot or photo per slot in depth order. */
function KitStage({ selection }: { selection: KitSelection }) {
  const layers = useMemo(() => kitLayout(selection), [selection]);
  const base = useMemo(() => svgDataUri(kitBaseSvg(selection, layers)), [selection, layers]);
  return <div className="relative isolate aspect-square w-full overflow-hidden rounded-md bg-white">
    {/* eslint-disable-next-line @next/next/no-img-element -- generated SVG, nothing to optimise */}
    <img src={base} alt="" className="absolute inset-0 size-full" draggable={false}/>
    {/* The blend sits on the positioned layer itself: it is the stacking context that composites onto the template. */}
    {layers.map(layer => <div key={layer.key + layer.item.id} className={cn("absolute animate-in duration-300 fade-in zoom-in-95", layer.item.image && "mix-blend-multiply")}
      style={{ left: percent(layer.x), top: percent(layer.y), width: percent(layer.width), height: percent(layer.height), zIndex: layer.z }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- photos come from the media route, packshots are generated SVG */}
      <img src={layer.item.image ? layer.item.image.src : svgDataUri(packshotSvg(layer.key, layer.item))} alt=""
        className="size-full object-contain object-bottom" draggable={false}/>
    </div>)}
  </div>;
}

function defaultSelection(options: KitSlotOptions[]): KitSelection {
  const byKey = new Map(options.map(slot => [slot.key, slot]));
  const wanted: KitFilterKey[] = ["air", "oil", "cabin"];
  const family = preferredFamilies.find(name => wanted.every(key => byKey.get(key)?.items.some(item => item.family === name)));
  const selection: KitSelection = {};
  for (const key of wanted) {
    const items = byKey.get(key)?.items ?? [];
    const item = items.find(candidate => candidate.family === family) ?? items[0];
    if (item) selection[key] = item;
  }
  const oil = byKey.get("engineOil")?.items ?? [];
  const engineOil = oil.find(item => item.liters?.startsWith("4")) ?? oil[0];
  if (engineOil) selection.engineOil = engineOil;
  return selection;
}

export function KitBuilder({ options }: { options: KitSlotOptions[] }) {
  const [selection, setSelection] = useState<KitSelection>(() => defaultSelection(options));
  const [view, setView] = useState<"live" | "server">("live");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);
  const byKey = useMemo(() => new Map(options.map(slot => [slot.key, slot])), [options]);
  const chosen = (Object.entries(selection) as [KitSlotKey, KitItem | undefined][]).filter((entry): entry is [KitSlotKey, KitItem] => Boolean(entry[1]));
  const total = chosen.reduce((sum, [, item]) => sum + item.priceKurus, 0);
  const query = kitImageQuery(selection);
  // A slot taken out of the kit is removed, not kept as an empty key.
  const choose = (key: KitSlotKey, item: KitItem | undefined) => {
    setResult(null);
    setSelection(current => {
      const next = { ...current };
      if (item) next[key] = item; else delete next[key];
      return next;
    });
  };
  const enabledFilters = filterKeys.filter(key => selection[key]);
  // "All Bosch": brands every enabled filter slot can offer.
  const sharedFamilies = enabledFilters.length > 1 ? [...new Set(byKey.get(enabledFilters[0])?.items.map(item => item.family))]
    .filter(family => enabledFilters.every(key => byKey.get(key)?.items.some(item => item.family === family))) : [];
  const oilGroups = useMemo(() => {
    const groups = new Map<string, KitItem[]>();
    for (const item of byKey.get("engineOil")?.items ?? []) groups.set(item.family, [...groups.get(item.family) ?? [], item]);
    return [...groups];
  }, [byKey]);

  return <div className="grid grid-cols-[minmax(0,560px)_minmax(0,1fr)] items-start gap-8 max-[900px]:grid-cols-1 max-[900px]:gap-6">
    <div className="sticky top-4 max-[900px]:static">
      <div className="rounded-lg border border-border p-3">
        <div className="mb-3 flex gap-1 rounded-md bg-muted p-1 text-[13px]" role="group" aria-label="Görsel kaynağı">
          {(["live", "server"] as const).map(option => <button key={option} type="button" aria-pressed={view === option} onClick={() => setView(option)}
            className={cn("h-8 flex-1 cursor-pointer rounded-[5px] font-medium text-muted-foreground transition-colors", view === option && "bg-white text-foreground shadow-sm")}>
            {option === "live" ? "Anlık önizleme" : "Sunucu görseli (WebP)"}</button>)}
        </div>
        {chosen.length ? view === "live" ? <KitStage selection={selection}/>
          // eslint-disable-next-line @next/next/no-img-element -- the route already returns the final WebP
          : <img key={query} src={`/api/bakim-seti/gorsel?${query}`} alt="Bakım seti görseli" className="aspect-square w-full rounded-md bg-white animate-in fade-in"/>
          : <div className="grid aspect-square place-items-center rounded-md bg-muted text-muted-foreground">Sete en az bir parça ekle.</div>}
        <div className="mt-2 flex items-center justify-between gap-3 text-[11px] leading-4 text-muted-foreground">
          <span>Temsili görseldir; ambalaj tasarımı üreticiye göre değişebilir.</span>
          {chosen.length > 0 && <a className="inline-flex shrink-0 items-center gap-1 font-medium text-primary hover:underline" href={`/api/bakim-seti/gorsel?${query}`} target="_blank" rel="noreferrer">Görseli aç<ExternalLink className="size-3" aria-hidden/></a>}
        </div>
      </div>
    </div>

    <div className="grid min-w-0 gap-4">
      {sharedFamilies.length > 0 && <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] text-muted-foreground">Hızlı seçim:</span>
        {sharedFamilies.slice(0, 6).map(family => <Button key={family} variant="outline" size="sm" onClick={() => {
          setResult(null);
          setSelection(current => ({ ...current, ...Object.fromEntries(enabledFilters.map(key => [key, byKey.get(key)!.items.find(item => item.family === family)!])) }));
        }}>Tüm filtreler {familyName(family)}</Button>)}
      </div>}

      {filterKeys.map(key => {
        const slot = byKey.get(key)!, selected = selection[key];
        return <fieldset key={key} className={cn("min-w-0 rounded-lg border border-border p-4", !selected && "bg-muted/40")}>
          <div className="mb-3 flex items-center justify-between gap-3">
            <legend className="contents"><span className="text-[15px] font-semibold">{kitSlots[key].label}</span></legend>
            <label className="flex items-center gap-2 text-[13px] text-muted-foreground">Sette
              <Switch checked={Boolean(selected)} disabled={!slot.items.length} onCheckedChange={checked => choose(key, checked ? slot.items[0] : undefined)}/></label>
          </div>
          <p className={cn("mb-3 flex items-center gap-1.5 text-[12px]", slot.fitted ? "text-[#1e5e3e]" : "text-amber-800")}>
            {slot.fitted ? <><CircleCheck className="size-3.5" aria-hidden/>Aracına bağlı ürünler</> : <><CircleAlert className="size-3.5" aria-hidden/>Örnek ürünler: araç uyumu doğrulanmadı</>}
          </p>
          {slot.items.length ? <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={`${kitSlots[key].label} markası`}>
            {slot.items.slice(0, 12).map(item => <button key={item.id} type="button" role="radio" aria-checked={selected?.id === item.id} onClick={() => choose(key, item)}
              className={cn("flex min-w-[104px] cursor-pointer flex-col items-start rounded-md border border-border px-3 py-2 text-left transition-colors hover:border-primary/60",
                selected?.id === item.id && "border-primary bg-primary/5 ring-1 ring-primary")}>
              <span className="text-[13px] font-semibold">{familyName(item.family)}</span>
              <span className="text-[12px] text-muted-foreground">{money(item.priceKurus)}</span>
            </button>)}
          </div> : <p className="text-[13px] text-muted-foreground">Bu parça için stokta ürün yok.</p>}
          {selected && <p className="mt-3 truncate text-[12px] text-muted-foreground" title={selected.name}>{selected.brand} · {selected.code} · {selected.name}{selected.image ? "" : " · görsel: genel kutu"}</p>}
        </fieldset>;
      })}

      <fieldset className={cn("min-w-0 rounded-lg border border-border p-4", !selection.engineOil && "bg-muted/40")}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <legend className="contents"><span className="text-[15px] font-semibold">Motor yağı</span></legend>
          <label className="flex items-center gap-2 text-[13px] text-muted-foreground">Sette
            <Switch checked={Boolean(selection.engineOil)} disabled={!oilGroups.length} onCheckedChange={checked => choose("engineOil", checked ? byKey.get("engineOil")!.items[0] : undefined)}/></label>
        </div>
        <p className="mb-3 flex items-center gap-1.5 text-[12px] text-amber-800"><CircleAlert className="size-3.5" aria-hidden/>Viskozite ve üretici onayını araç kılavuzundan kontrol et.</p>
        <NativeSelect className="w-full" aria-label="Motor yağı" value={selection.engineOil?.id ?? ""} disabled={!selection.engineOil}
          onChange={event => choose("engineOil", byKey.get("engineOil")!.items.find(item => item.id === event.target.value))}>
          {oilGroups.map(([family, items]) => <NativeSelectOptGroup key={family} label={familyName(family)}>
            {items.map(item => <NativeSelectOption key={item.id} value={item.id}>{[item.viscosity, item.liters].filter(Boolean).join(" · ")} — {money(item.priceKurus)} — {item.name.slice(0, 60)}</NativeSelectOption>)}
          </NativeSelectOptGroup>)}
        </NativeSelect>
      </fieldset>

      <div className="rounded-lg border border-border bg-[#f8fafc] p-4">
        <ul className="mb-3 grid gap-1.5 text-[13px]">
          {chosen.map(([key, item]) => <li key={key} className="flex justify-between gap-3"><span className="min-w-0 truncate">{kitSlots[key].label} · {familyName(item.family)}</span><span className="shrink-0 tabular-nums">{money(item.priceKurus)}</span></li>)}
        </ul>
        <div className="mb-3 flex items-baseline justify-between border-t border-border pt-3"><span className="font-semibold">{chosen.length} parça toplam</span><strong className="text-[20px] tabular-nums">{money(total)}</strong></div>
        <Button className="h-11 w-full bg-brand hover:bg-brand-strong" disabled={!chosen.length || pending} onClick={() => startTransition(async () => {
          const response = await addKitToCart(chosen.map(([, item]) => item.id));
          setResult(response.error ?? (response.failed.length ? `${response.added} ürün eklendi; ${response.failed.length} ürünün stok veya fiyatı uygun değil.` : `${response.added} ürün sepete eklendi.`));
        })}><ShoppingCart className="size-4" aria-hidden/>{pending ? "Ekleniyor…" : "Seti sepete ekle"}</Button>
        {result && <p className="mt-2 text-[13px]" role="status">{result}</p>}
      </div>
    </div>
  </div>;
}
