"use client";

import type { ReactNode } from "react";
import { CircleCheck, CircleHelp, Maximize2, Pencil, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { confirmBrand, decideBrandPair, mergeBrand, moveBrandLabel, renameBrand } from "@/app/yonetim/urun-eslestirme/actions";

export type PairRow = { brand_a: string; brand_b: string; name_a: string; name_b: string; shared_parts: string; shared_eans: string | null; similarity: string | null; strong: boolean;
  samples: { part: string; a: string | null; b: string | null }[]; ean_samples: { ean: string; part_a: string; a: string | null; part_b: string; b: string | null }[] };

const decisions = [["same", "Aynı marka", "default"], ["equivalent", "Muadil", "outline"], ["unrelated", "İlgisiz", "ghost"]] as const;

/** Same / equivalent / unrelated buttons for one brand pair; `back` keeps the reviewer on the current page. */
export function PairDecision({ pair, back }: { pair: Pick<PairRow, "brand_a" | "brand_b">; back: string }) {
  return <div className="flex gap-1">{decisions.map(([status, label, variant]) =>
    <form key={status} action={decideBrandPair}>
      <input type="hidden" name="brand_a" value={pair.brand_a}/><input type="hidden" name="brand_b" value={pair.brand_b}/>
      <input type="hidden" name="status" value={status}/><input type="hidden" name="back" value={back}/>
      <Button type="submit" variant={variant}>{label}</Button>
    </form>)}</div>;
}

function DetailTrigger({ label }: { label: string }) {
  return <DialogTrigger render={<Button variant="ghost" size="icon" aria-label={label} title={label}/>}><Maximize2 aria-hidden="true"/></DialogTrigger>;
}

export function PairDialog({ pair, back }: { pair: PairRow; back: string }) {
  return <Dialog>
    <DetailTrigger label={`${pair.name_a} ↔ ${pair.name_b} örneklerini aç`}/>
    <DialogContent className="max-h-5/6 overflow-y-auto sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>{pair.name_a} ↔ {pair.name_b}</DialogTitle>
        <DialogDescription>{pair.shared_parts} ortak parça numarası{pair.shared_eans ? ` · ${pair.shared_eans} ortak barkod` : ""} · ürün adı benzerliği {pair.similarity ?? "—"}</DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-3">
        {pair.samples.length > 0 && <Table><TableHeader><TableRow><TableHead>Parça no</TableHead><TableHead>{pair.name_a}</TableHead><TableHead>{pair.name_b}</TableHead></TableRow></TableHeader>
          <TableBody>{pair.samples.map((sample, index) => <TableRow key={index} className="align-top">
            <TableCell className="font-mono">{sample.part}</TableCell>
            <TableCell className="whitespace-normal break-words">{sample.a || "—"}</TableCell>
            <TableCell className="whitespace-normal break-words">{sample.b || "—"}</TableCell>
          </TableRow>)}</TableBody></Table>}
        {pair.ean_samples.length > 0 && <Table><TableHeader><TableRow><TableHead>Barkod</TableHead><TableHead>{pair.name_a}</TableHead><TableHead>{pair.name_b}</TableHead></TableRow></TableHeader>
          <TableBody>{pair.ean_samples.map(sample => <TableRow key={sample.ean} className="align-top">
            <TableCell className="font-mono">{sample.ean}</TableCell>
            <TableCell className="whitespace-normal break-words"><span className="font-mono">{sample.part_a}</span> · {sample.a || "—"}</TableCell>
            <TableCell className="whitespace-normal break-words"><span className="font-mono">{sample.part_b}</span> · {sample.b || "—"}</TableCell>
          </TableRow>)}</TableBody></Table>}
      </div>
      <DialogFooter className="items-center sm:justify-between"><span className="text-muted-foreground">“Aynı marka” iki ana markayı ve tüm ürünlerini birleştirir.</span><PairDecision pair={pair} back={back}/></DialogFooter>
    </DialogContent>
  </Dialog>;
}

export type LinkedProductRow = { id: string; supplier: string; code: string; name: string | null; via: string };

/** The store listings a SETA product is shown on as an equivalent. */
export function SetaDialog({ title, description, products }: { title: string; description: string; products: LinkedProductRow[] }) {
  return <Dialog>
    <DetailTrigger label={`${title} bağlantılarını aç`}/>
    <DialogContent className="max-h-5/6 overflow-y-auto sm:max-w-3xl">
      <DialogHeader><DialogTitle className="font-mono">{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
      <Table><TableHeader><TableRow>
        <TableHead>Tedarikçi</TableHead><TableHead>Kod</TableHead><TableHead>Ad</TableHead><TableHead>Ortak numara</TableHead>
      </TableRow></TableHeader>
        <TableBody>{products.map(product => <TableRow key={product.id}>
          <TableCell>{product.supplier}</TableCell>
          <TableCell className="max-w-40 truncate font-mono" title={product.code}><Button variant="link" className="h-auto p-0 font-mono" nativeButton={false} render={<a href={`/urun/${product.id}`} target="_blank" rel="noreferrer"/>}>{product.code}</Button></TableCell>
          <TableCell className="max-w-64 truncate" title={product.name ?? ""}>{product.name || "—"}</TableCell>
          <TableCell className="max-w-40 truncate font-mono text-muted-foreground" title={product.via}>{product.via}</TableCell>
        </TableRow>)}</TableBody></Table>
    </DialogContent>
  </Dialog>;
}

export function StockLabel({ stock }: { stock: boolean | null }): ReactNode {
  if (stock === null) return <span className="text-muted-foreground">—</span>;
  return <Badge variant={stock ? "success" : "outline"}>{stock ? "Var" : "Yok"}</Badge>;
}

export function DecisionHelp() {
  return <Dialog>
    <DialogTrigger render={<Button variant="ghost"/>}><CircleHelp data-icon="inline-start" aria-hidden="true"/>Nasıl karar verilir?</DialogTrigger>
    <DialogContent className="sm:max-w-lg">
      <DialogHeader><DialogTitle>Benzer marka kararları</DialogTitle><DialogDescription>Aynı parça numarası farklı tedarikçilerde farklı ana markayla geçiyor. Karar çiftin tüm ortak parçalarına uygulanır.</DialogDescription></DialogHeader>
      <dl className="flex flex-col gap-3">
        <div><dt className="font-medium">Aynı marka</dt><dd className="text-muted-foreground">İki ana marka aynı firmanın farklı yazılışı (M.MARELLI / MAGNETI MARELLI, MAHLE / MAHLE FILTRE). Az kayıtlı marka, etiketleriyle birlikte diğerine katılır; ürünler bir sonraki yenilemede birleşir, ortak numaralar tek ürün olur.</dd></div>
        <div><dt className="font-medium">Muadil</dt><dd className="text-muted-foreground">Aynı numaralandırma, farklı ürün: kayış ölçüsü (CONTITECH / DAYCO) veya OEM numarasını kod olarak kullanan yan sanayi (ITHAL, EUROREPAR / ORIJINAL). Ürünler ayrı kalır; ortak numaralılar birbirine muadil olarak bağlanır.</dd></div>
        <div><dt className="font-medium">Ortak barkod</dt><dd className="text-muted-foreground">Dinamik’te iki markanın ürünleri aynı barkodu taşıyorsa (WENDER / WENDERPARTS) bu güçlü bir “aynı marka” kanıtıdır. Ad benzerliği düşükse barkodlar yer tutucudur; ilgisiz seçin.</dd></div>
        <div><dt className="font-medium">İlgisiz</dt><dd className="text-muted-foreground">Numaralar rastlantısal (FEBI / IBRAS). Çift tekrar önerilmez.</dd></div>
      </dl>
      <p className="flex items-center gap-2 text-muted-foreground"><Badge variant="success"><CircleCheck data-icon="inline-start" aria-hidden="true"/>%15+</Badge>Ürün adı benzerliği gerçek eşlemelerde genelde %10’un üzerinde, rastlantılarda %2–5 çıkar.</p>
    </DialogContent>
  </Dialog>;
}

export type BrandLabelRow = { supplier: string; supplierName: string; label: string; items: string; method: "auto" | "manual" };
export type BrandRow = { id: string; key: string; name: string; items: string; pending: boolean; labels: BrandLabelRow[] };

/** "Onayla": the automatically placed labels stay where they are. */
export function ConfirmBrand({ id, back }: { id: string; back: string }) {
  return <form action={confirmBrand}><input type="hidden" name="id" value={id}/><input type="hidden" name="back" value={back}/>
    <Button type="submit" variant="outline"><CircleCheck data-icon="inline-start" aria-hidden="true"/>Onayla</Button></form>;
}

/**
 * Rename a master brand, move one of its supplier labels to another master brand (or make it a brand of its own),
 * or merge the whole brand into another. Target names come from the page's single `brand-names` datalist.
 */
export function BrandDialog({ brand, back }: { brand: BrandRow; back: string }) {
  const hidden = <input type="hidden" name="back" value={back}/>;
  return <Dialog>
    <DialogTrigger render={<Button variant="ghost" size="icon" aria-label={`${brand.name} markasını düzenle`} title="Düzenle"/>}><Pencil aria-hidden="true"/></DialogTrigger>
    <DialogContent className="max-h-5/6 overflow-y-auto sm:max-w-3xl">
      <DialogHeader>
        <DialogTitle>{brand.name}</DialogTitle>
        <DialogDescription>{brand.items} kayıt · eşleştirme anahtarı <span className="font-mono">{brand.key}</span>. Değişiklikler bir sonraki “Eşleştirmeyi yenile” ile ürünlere uygulanır.</DialogDescription>
      </DialogHeader>
      <div className="flex min-w-0 flex-col gap-4">
        <form action={renameBrand} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="id" value={brand.id}/>{hidden}
          <Field className="w-full sm:w-72"><FieldLabel htmlFor={`brand-name-${brand.id}`}>Ana marka adı</FieldLabel>
            <Input id={`brand-name-${brand.id}`} name="name" defaultValue={brand.name} maxLength={80} required/></Field>
          <Button type="submit" variant="outline">Adı kaydet</Button>
        </form>
        <Separator/>
        <Table><caption className="sr-only">Tedarikçi etiketleri</caption>
          <TableHeader><TableRow><TableHead>Tedarikçi</TableHead><TableHead>Etiket</TableHead><TableHead className="text-right">Kayıt</TableHead><TableHead>Durum</TableHead><TableHead>Başka ana markaya taşı</TableHead></TableRow></TableHeader>
          <TableBody>{brand.labels.map(label => <TableRow key={`${label.supplier}|${label.label}`}>
            <TableCell>{label.supplierName}</TableCell>
            <TableCell className="max-w-40 truncate font-medium" title={label.label}>{label.label}</TableCell>
            <TableCell className="text-right tabular-nums">{label.items}</TableCell>
            <TableCell>{label.method === "auto" ? <Badge variant="warning"><TriangleAlert data-icon="inline-start" aria-hidden="true"/>Otomatik</Badge>
              : <Badge variant="success"><CircleCheck data-icon="inline-start" aria-hidden="true"/>Onaylı</Badge>}</TableCell>
            <TableCell><form action={moveBrandLabel} className="flex items-center gap-2">
              <input type="hidden" name="supplier" value={label.supplier}/><input type="hidden" name="label" value={label.label}/>{hidden}
              <Input name="target" list="brand-names" aria-label={`${label.label} için hedef ana marka`} placeholder="Ana marka adı" maxLength={80} className="w-40"/>
              <Button type="submit" name="mode" value="move" variant="outline">Taşı</Button>
              <Button type="submit" name="mode" value="new" variant="ghost" title="Bu etiket ayrı bir ana marka olsun">Ayrı marka</Button>
            </form></TableCell>
          </TableRow>)}</TableBody></Table>
        <Separator/>
        <form action={mergeBrand} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="id" value={brand.id}/>{hidden}
          <Field className="w-full sm:w-72"><FieldLabel htmlFor={`brand-merge-${brand.id}`}>Başka bir ana markayla birleştir</FieldLabel>
            <Input id={`brand-merge-${brand.id}`} name="target" list="brand-names" placeholder="Ana marka adı" maxLength={80} required/>
            <FieldDescription>Tüm etiketler hedef markaya geçer; {brand.name} listeden kalkar.</FieldDescription></Field>
          <Button type="submit" variant="outline">Birleştir</Button>
        </form>
      </div>
      {brand.pending && <DialogFooter className="items-center sm:justify-between"><span className="text-muted-foreground">Etiketler doğruysa onaylayın; onaylı etiketler otomatik taşınmaz.</span><ConfirmBrand id={brand.id} back={back}/></DialogFooter>}
    </DialogContent>
  </Dialog>;
}
