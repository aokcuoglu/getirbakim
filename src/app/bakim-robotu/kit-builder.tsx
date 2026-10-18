"use client";
import { useMemo, useState, useTransition } from "react";
import Image from "next/image";
import Link from "next/link";
import { Check, CircleAlert, CircleCheck, Download, Loader2, Minus, Plus, ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PartArtImage } from "@/components/part-art";
import { cn } from "@/lib/utils";
import { kitContentLine, kitCountLabel, kitImageHref, kitKindLabel, kitName, kitPackages, kitSlot, kitSlots, matchingPackage, orderSlotKeys, type KitSlotKey } from "@/modules/store/maintenance-kit";
import type { KitCandidate, KitSlotOptions } from "@/modules/store/maintenance-kit.server";
import { addKitToCart, type KitCartResult } from "./actions";

type Choice = { brand: string; productId: string; quantity: number };
const money = (kurus: number) => new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(kurus / 100);
const chip = "inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 py-1.5 text-[13px] leading-5 font-medium transition-colors";
const brandOrder = (candidates: KitCandidate[]) => [...new Set(candidates.map(candidate => candidate.brand))];

/** Default of a slot: its cheapest product, in that product's brand. */
function firstChoice(slot: KitSlotOptions): Choice | null {
  const first = slot.candidates[0];
  return first ? { brand: first.brand, productId: first.id, quantity: first.suggestedQuantity } : null;
}

export function KitBuilder({ slots, vehicleName, oilCapacityLabel, oilViscosities }: { slots: KitSlotOptions[]; vehicleName: string; oilCapacityLabel: string | null; oilViscosities: string[] }) {
  const byKey = useMemo(() => new Map(slots.map(slot => [slot.key, slot])), [slots]);
  const [enabled, setEnabled] = useState<Set<KitSlotKey>>(() => new Set(kitPackages[0].slots));
  const [choices, setChoices] = useState<Partial<Record<KitSlotKey, Choice>>>(() => Object.fromEntries(slots.flatMap(slot => { const choice = firstChoice(slot); return choice ? [[slot.key, choice]] : []; })));
  const [result, setResult] = useState<KitCartResult | null>(null);
  const [pending, startTransition] = useTransition();

  const activeKeys = orderSlotKeys(enabled);
  // Pieces: enabled slots that have a chosen, still-listed product.
  const pieces = activeKeys.flatMap(key => {
    const choice = choices[key], slot = byKey.get(key);
    const candidate = slot?.candidates.find(item => item.id === choice?.productId);
    return candidate && choice ? [{ key, candidate, quantity: choice.quantity }] : [];
  });
  const missing = activeKeys.filter(key => !pieces.some(piece => piece.key === key));
  const total = pieces.reduce((sum, piece) => sum + piece.candidate.priceKurus * piece.quantity, 0);
  const pack = matchingPackage(activeKeys);
  const kitKeys = pieces.map(piece => piece.key);
  const title = kitName(vehicleName, kitKeys);
  const imageHref = pieces.length ? kitImageHref(pieces.map(piece => piece.candidate.id)) : null;

  const toggle = (key: KitSlotKey) => { setResult(null); setEnabled(current => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; }); };
  const choosePackage = (keys: readonly KitSlotKey[]) => { setResult(null); setEnabled(new Set(keys)); };
  const choose = (key: KitSlotKey, update: Partial<Choice>) => { setResult(null); setChoices(current => ({ ...current, [key]: { ...(current[key] ?? { brand: "", productId: "", quantity: 1 }), ...update } })); };
  const chooseBrand = (slot: KitSlotOptions, brand: string) => {
    const first = slot.candidates.find(candidate => candidate.brand === brand);
    if (first) choose(slot.key, { brand, productId: first.id, quantity: first.suggestedQuantity });
  };
  const submit = () => startTransition(async () => {
    setResult(await addKitToCart(pieces.map(piece => ({ productId: piece.candidate.offerId, quantity: piece.quantity, name: piece.candidate.code }))));
  });

  return <div className="grid grid-cols-[minmax(0,1fr)_420px] items-start gap-8 max-[1000px]:grid-cols-1 max-[1000px]:gap-6">
    <div className="min-w-0">
      <section aria-labelledby="kit-package" className="mb-6">
        <h2 id="kit-package" className="mb-1 flex items-center gap-2.5 text-[23px] leading-[29px] font-semibold tracking-[-.5px] max-[768px]:text-xl"><span className="grid size-7 place-items-center rounded-full bg-brand text-sm font-semibold text-white">1</span>Paketini seç</h2>
        <p className="mb-4 text-[13px] leading-[18px] text-muted-foreground"><strong className="font-medium text-foreground">{vehicleName}</strong> için hazır paketlerden başla; yuvaları ekleyip çıkararak setini özelleştir.</p>
        <div className="flex flex-wrap gap-2.5" role="group" aria-label="Hazır paketler">
          {kitPackages.map(option => { const active = pack?.size === option.size; return <button key={option.size} type="button" aria-pressed={active} onClick={() => choosePackage(option.slots)}
            className={cn("relative flex min-h-[72px] min-w-[220px] items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors max-[600px]:min-w-full", active ? "border-brand bg-[#eef7fd] ring-1 ring-brand" : "border-border bg-white hover:border-[#b8d9ee]")}>
            <span className={cn("grid size-11 shrink-0 place-items-center rounded-lg text-[15px] leading-none font-bold transition-colors", active ? "bg-brand text-white" : "bg-[#eef1f4] text-[#54626e]")}>{kitCountLabel(option.size, true)}</span>
            <span className="min-w-0"><span className="block text-base leading-6 font-semibold">{kitCountLabel(option.size)} {kitKindLabel(option.slots)}</span><span className="block text-xs leading-[18px] text-muted-foreground">{option.description}</span></span>
            {active && <CircleCheck size={18} className="absolute top-2 right-2 fill-brand text-white" aria-hidden="true"/>}</button>; })}
        </div>
        <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Set yuvaları">
          {kitSlots.map(slot => { const on = enabled.has(slot.key), count = byKey.get(slot.key)?.candidates.length ?? 0; return <button key={slot.key} type="button" aria-pressed={on} onClick={() => toggle(slot.key)} disabled={!count && !on}
            className={cn(chip, on ? "border-brand bg-brand text-white hover:bg-brand-strong" : "border-border bg-white text-foreground hover:border-[#54626e] disabled:cursor-not-allowed disabled:opacity-60")}>
            {on ? <Check size={15} aria-hidden="true"/> : count ? <Plus size={15} aria-hidden="true"/> : <Minus size={15} aria-hidden="true"/>}{slot.name}{!count && <span className="text-[11px] font-normal opacity-80">(ürün yok)</span>}</button>; })}
        </div>
      </section>
      <h2 className="mb-3 flex items-center gap-2.5 text-[23px] leading-[29px] font-semibold tracking-[-.5px] max-[768px]:text-xl"><span className="grid size-7 place-items-center rounded-full bg-brand text-sm font-semibold text-white">2</span>Markaları seç</h2>
      <div className="grid gap-4">
        {activeKeys.map(key => { const slot = byKey.get(key)!, choice = choices[key], meta = kitSlot(key);
          const selected = slot.candidates.find(candidate => candidate.id === choice?.productId) ?? null;
          const inBrand = slot.candidates.filter(candidate => candidate.brand === choice?.brand);
          return <section key={key} aria-labelledby={`slot-${key}`} className="rounded-xl border border-border bg-white p-5 max-[600px]:p-4">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><h3 id={`slot-${key}`} className="flex items-center gap-3 text-lg leading-7 font-semibold"><span className="grid size-10 place-items-center rounded-lg bg-[#f2f5f8]"><PartArtImage kind={meta.art} className="size-7 object-contain"/></span>{meta.name}
              {selected && <span className="inline-flex items-center gap-1 rounded-full bg-[#ebf5ed] px-2 py-0.5 text-xs leading-[18px] font-medium text-[#397247]"><Check size={13} aria-hidden="true"/>{selected.brand}</span>}</h3>
              {key === "engineOil" && oilCapacityLabel && <span className="text-[13px] leading-5 text-muted-foreground">Önerilen miktar {oilCapacityLabel}{oilViscosities.length ? ` · SAE ${oilViscosities.join(" / ")}` : ""}</span>}</div>
            {!slot.candidates.length ? <p className="rounded-lg bg-[#f7f8fa] px-3.5 py-3 text-[13px] leading-5 text-muted-foreground">{key === "engineOil"
                ? "Bu araç için yağ önerisi veya uygun motor yağı henüz kayıtlı değil. Yağı katalogdan seçebilirsin."
                : "Bu araca bağlı " + meta.name.toLocaleLowerCase("tr") + " henüz kayıtlı değil. Katalogda OEM numarasıyla arayabilirsin."}</p>
              : <>
              {key === "engineOil" && slot.oilMatch === "viscosity" && <p className="mb-3 flex items-start gap-2 rounded-lg border border-[#f1d08a] bg-[#fff9eb] px-3.5 py-2.5 text-[13px] leading-5"><CircleAlert size={18} className="mt-px shrink-0 fill-[#f0a020] text-white" aria-hidden="true"/>Bu yağlar aracının viskozitesine uyar; üretici onayını ürün sayfasından kontrol et.</p>}
              <div className="flex flex-wrap gap-2" role="group" aria-label={`${meta.name} markası`}>
                {brandOrder(slot.candidates).map(brand => { const active = choice?.brand === brand, logo = slot.candidates.find(candidate => candidate.brand === brand)?.logo, cheapest = slot.candidates.find(candidate => candidate.brand === brand)!;
                  return <button key={brand} type="button" aria-pressed={active} onClick={() => chooseBrand(slot, brand)} title={brand}
                    className={cn(chip, "min-h-12", active ? "border-brand bg-[#eef7fd] ring-1 ring-brand" : "border-border bg-white hover:border-[#54626e]")}>
                    {logo ? <Image src={logo.src} width={logo.width} height={logo.height} alt={brand} style={{ width: 72, height: 24, objectFit: "contain" }} unoptimized/> : <span>{brand}</span>}
                    <span className="text-xs font-normal text-muted-foreground">{money(cheapest.priceKurus)}{inBrand.length > 1 && active ? "+" : ""}</span></button>; })}
              </div>
              {selected && <div className="mt-4 grid grid-cols-[72px_minmax(0,1fr)] items-center gap-4 max-[600px]:grid-cols-[56px_minmax(0,1fr)]">
                <Link href={`/urun/${selected.id}`} className="grid size-[72px] place-items-center rounded-lg border border-border bg-white max-[600px]:size-14" aria-label={`${selected.brand} ${selected.code} ürün sayfası`}>
                  {selected.image ? <Image src={selected.image.src} width={selected.image.width} height={selected.image.height} alt="" className="size-16 object-contain max-[600px]:size-12" unoptimized/> : <PartArtImage kind={meta.art} className="size-12"/>}</Link>
                <div className="min-w-0">
                  {inBrand.length > 1 ? <label className="block"><span className="mb-1 block text-xs leading-4 text-muted-foreground">{selected.brand} ürünü</span>
                      <select value={selected.id} onChange={event => { const next = inBrand.find(candidate => candidate.id === event.target.value); if (next) choose(key, { productId: next.id, quantity: next.suggestedQuantity }); }}
                        className="h-11 w-full max-w-[520px] rounded-lg border border-input bg-white px-3 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50">
                        {inBrand.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.code} · {candidate.name} · {money(candidate.priceKurus)}</option>)}</select></label>
                    : <p className="m-0 truncate text-sm leading-5 font-medium" title={selected.name}>{selected.code} · {selected.name}</p>}
                  <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] leading-5 text-muted-foreground"><strong className="font-semibold text-foreground">{money(selected.priceKurus)}</strong><span>{selected.stockLabel}</span>
                    {key === "engineOil" && <label className="inline-flex items-center gap-1.5">Adet <select value={choice!.quantity} onChange={event => choose(key, { quantity: Number(event.target.value) })} aria-label="Motor yağı adedi"
                      className="h-8 rounded-md border border-input bg-white px-2 text-sm text-foreground">{Array.from({ length: Math.max(1, Math.min(selected.maxQuantity, 10)) }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}</select>
                      {selected.packLitres ? <span>× {selected.packLitres.toLocaleString("tr-TR")} L</span> : null}</label>}</p>
                </div>
              </div>}
            </>}
          </section>; })}
      </div>
    </div>
    <aside className="sticky top-6 rounded-xl border border-border bg-white p-5 shadow-[0_8px_30px_#212b3614] max-[1000px]:static max-[600px]:p-4" aria-label="Set özeti">
      <KitImage href={imageHref} title={title}/>
      <h2 className="mt-4 text-lg leading-7 font-semibold wrap-anywhere">{title}</h2>
      {kitKeys.length > 0 && <p className="mt-0.5 text-xs leading-[18px] tracking-[.6px] text-muted-foreground uppercase">{kitContentLine(kitKeys)}</p>}
      <ul className="mt-4 divide-y divide-border border-y border-border">
        {pieces.map(piece => <li key={piece.key} className="flex items-center justify-between gap-3 py-2.5 text-[13px] leading-5"><span className="min-w-0"><span className="block font-medium">{kitSlot(piece.key).name}</span><span className="block truncate text-muted-foreground">{piece.candidate.code}{piece.quantity > 1 ? ` × ${piece.quantity}` : ""}</span></span><span className="shrink-0 font-semibold tabular-nums">{money(piece.candidate.priceKurus * piece.quantity)}</span></li>)}
        {missing.map(key => <li key={key} className="flex items-center justify-between gap-3 py-2.5 text-[13px] leading-5 text-muted-foreground"><span>{kitSlot(key).name}</span><span>Ürün yok</span></li>)}
      </ul>
      <p className="mt-4 flex items-baseline justify-between gap-3"><span className="text-sm leading-5 text-muted-foreground">Set toplamı · KDV dahil</span><strong className="text-[22px] leading-7 font-semibold tabular-nums">{money(total)}</strong></p>
      <p className="mt-0.5 text-xs leading-[18px] text-muted-foreground">{pieces.length} parça · Kargo hariç · Parçalar sepete tek tek girer.</p>
      <Button type="button" onClick={submit} disabled={!pieces.length || pending} className="mt-4 h-12 w-full gap-2 rounded-lg border-brand bg-brand text-sm font-semibold text-white hover:bg-brand-strong disabled:border-[#e6e9ec] disabled:bg-[#e6e9ec] disabled:text-muted-foreground disabled:opacity-100">
        {pending ? <Loader2 size={18} className="animate-spin" aria-hidden="true"/> : <ShoppingCart size={18} aria-hidden="true"/>}{pending ? "Ekleniyor…" : "Seti sepete ekle"}</Button>
      {result && (result.error ? <p role="alert" className="mt-3 text-[13px] leading-5 text-[#ae3025]">{result.error}</p>
        : <div role="status" className={cn("mt-3 rounded-lg px-3.5 py-3 text-[13px] leading-5", result.failed.length ? "border border-[#f1d08a] bg-[#fff9eb]" : "bg-[#ebf5ed] text-[#397247]")}>
          <p className="m-0 flex items-start gap-2">{result.failed.length ? <CircleAlert size={18} className="mt-px shrink-0 fill-[#f0a020] text-white" aria-hidden="true"/> : <CircleCheck size={18} className="mt-px shrink-0" aria-hidden="true"/>}
            <span>{result.added} parça sepetine eklendi.{result.failed.length ? ` Eklenemeyen: ${result.failed.join(", ")} (stok veya fiyat uygun değil).` : ""}</span></p>
          <Link href="/sepet" className="mt-2 inline-block font-semibold text-primary underline-offset-4 hover:underline">Sepete git</Link></div>)}
      {imageHref && <a href={imageHref} download className="mt-3 inline-flex items-center gap-1.5 text-[13px] leading-5 font-medium text-primary underline-offset-4 hover:underline"><Download size={15} aria-hidden="true"/>Set görselini indir</a>}
      <p className="mt-3 text-[11px] leading-4 text-muted-foreground">Görsel temsilidir; set, seçtiğin ürünlerden oluşur. Siparişten önce ürün sayfalarındaki araç uyumluluğunu kontrol et.</p>
    </aside>
  </div>;
}

/** The composite picture: the previous one stays while the next renders, so brand changes never flash an empty box. */
function KitImage({ href, title }: { href: string | null; title: string }) {
  const [loaded, setLoaded] = useState<string | null>(href);
  const [failed, setFailed] = useState(false);
  // Without pieces there is nothing to show; otherwise the last loaded picture stays until the next one arrives.
  const shown = href ? loaded : null;
  const loading = Boolean(href) && href !== shown;
  return <div className="relative aspect-square w-full overflow-hidden rounded-lg border border-border bg-white">
    {shown ? <Image key={shown} src={shown} alt={title} width={1200} height={1200} className="size-full object-contain" unoptimized/>
      : <div className="grid size-full place-items-center text-[13px] text-muted-foreground">{href ? "Set görseli hazırlanıyor…" : "Setine parça ekle"}</div>}
    {href && href !== shown && <Image key={href} src={href} alt="" width={1200} height={1200} className="absolute inset-0 size-full object-contain opacity-0" unoptimized onLoad={() => { setLoaded(href); setFailed(false); }} onError={() => setFailed(true)}/>}
    {loading && !failed && <div className="absolute inset-0 grid place-items-center bg-white/60"><Loader2 size={28} className="animate-spin text-primary" aria-hidden="true"/><span className="sr-only">Set görseli güncelleniyor</span></div>}
    {failed && <p className="absolute inset-x-0 bottom-0 m-0 bg-[#fff0ec] px-3 py-2 text-center text-xs text-[#a74130]">Görsel şu an oluşturulamadı; seçimin yine de geçerli.</p>}
  </div>;
}
