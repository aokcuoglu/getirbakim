"use client";

import type { ReactNode } from "react";
import { CircleCheck, CircleHelp, Maximize2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { decideBrandPair } from "@/app/yonetim/urun-eslestirme/actions";

export type PairRow = { brand_a: string; brand_b: string; shared_parts: string; shared_eans: string | null; similarity: string | null; strong: boolean;
  samples: { part: string; a: string | null; b: string | null }[]; ean_samples: { ean: string; part_a: string; a: string | null; part_b: string; b: string | null }[] };

const decisions = [["same", "Aynı marka", "default"], ["equivalent", "Muadil", "outline"], ["unrelated", "İlgisiz", "ghost"]] as const;

/** Same / equivalent / unrelated buttons for one brand pair; `back` keeps the reviewer on the current page. */
export function PairDecision({ pair, back, size = "xs" }: { pair: Pick<PairRow, "brand_a" | "brand_b">; back: string; size?: "xs" | "sm" }) {
  return <div className="flex gap-1">{decisions.map(([status, label, variant]) =>
    <form key={status} action={decideBrandPair}>
      <input type="hidden" name="brand_a" value={pair.brand_a}/><input type="hidden" name="brand_b" value={pair.brand_b}/>
      <input type="hidden" name="status" value={status}/><input type="hidden" name="back" value={back}/>
      <Button type="submit" size={size} variant={variant}>{label}</Button>
    </form>)}</div>;
}

function DetailTrigger({ label }: { label: string }) {
  return <DialogTrigger render={<Button variant="ghost" size="icon-xs" aria-label={label} title={label}/>}><Maximize2 aria-hidden="true"/></DialogTrigger>;
}

export function PairDialog({ pair, back }: { pair: PairRow; back: string }) {
  return <Dialog>
    <DetailTrigger label={`${pair.brand_a} ↔ ${pair.brand_b} örneklerini aç`}/>
    <DialogContent className="max-h-5/6 overflow-y-auto sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>{pair.brand_a} ↔ {pair.brand_b}</DialogTitle>
        <DialogDescription>{pair.shared_parts} ortak parça numarası{pair.shared_eans ? ` · ${pair.shared_eans} ortak barkod` : ""} · ürün adı benzerliği {pair.similarity ?? "—"}</DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-3">
        {pair.samples.length > 0 && <Table><TableHeader><TableRow><TableHead>Parça no</TableHead><TableHead>{pair.brand_a}</TableHead><TableHead>{pair.brand_b}</TableHead></TableRow></TableHeader>
          <TableBody>{pair.samples.map((sample, index) => <TableRow key={index} className="align-top">
            <TableCell className="font-mono">{sample.part}</TableCell>
            <TableCell className="whitespace-normal break-words">{sample.a || "—"}</TableCell>
            <TableCell className="whitespace-normal break-words">{sample.b || "—"}</TableCell>
          </TableRow>)}</TableBody></Table>}
        {pair.ean_samples.length > 0 && <Table><TableHeader><TableRow><TableHead>Barkod</TableHead><TableHead>{pair.brand_a}</TableHead><TableHead>{pair.brand_b}</TableHead></TableRow></TableHeader>
          <TableBody>{pair.ean_samples.map(sample => <TableRow key={sample.ean} className="align-top">
            <TableCell className="font-mono">{sample.ean}</TableCell>
            <TableCell className="whitespace-normal break-words"><span className="font-mono">{sample.part_a}</span> · {sample.a || "—"}</TableCell>
            <TableCell className="whitespace-normal break-words"><span className="font-mono">{sample.part_b}</span> · {sample.b || "—"}</TableCell>
          </TableRow>)}</TableBody></Table>}
      </div>
      <DialogFooter className="items-center sm:justify-between"><span className="text-muted-foreground">Karar markanın tüm ortak parçalarına uygulanır.</span><PairDecision pair={pair} back={back} size="sm"/></DialogFooter>
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
  return <Badge variant={stock ? "secondary" : "outline"}>{stock ? "Var" : "Yok"}</Badge>;
}

export function DecisionHelp() {
  return <Dialog>
    <DialogTrigger render={<Button variant="ghost" size="sm"/>}><CircleHelp data-icon="inline-start" aria-hidden="true"/>Nasıl karar verilir?</DialogTrigger>
    <DialogContent className="sm:max-w-lg">
      <DialogHeader><DialogTitle>Marka çifti kararları</DialogTitle><DialogDescription>Aynı parça numarası farklı tedarikçilerde farklı markayla geçiyor. Karar çiftin tüm ortak parçalarına uygulanır.</DialogDescription></DialogHeader>
      <dl className="flex flex-col gap-3">
        <div><dt className="font-medium">Aynı marka</dt><dd className="text-muted-foreground">İki etiket aynı ürünü satar (M.MARELLI / MAGNETI MARELLI, MAHLE / MAHLE FILTRE). Kayıtlar bir sonraki yenilemede tek üründe birleşir.</dd></div>
        <div><dt className="font-medium">Muadil</dt><dd className="text-muted-foreground">Aynı numaralandırma, farklı ürün: kayış ölçüsü (CONTITECH / DAYCO) veya OEM numarasını kod olarak kullanan yan sanayi (EUROREPAR / ORIJINAL).</dd></div>
        <div><dt className="font-medium">Ortak barkod</dt><dd className="text-muted-foreground">Dinamik’te iki markanın ürünleri aynı barkodu taşıyorsa (WENDER / WENDERPARTS) bu güçlü bir “aynı marka” kanıtıdır. Ad benzerliği düşükse barkodlar yer tutucudur; ilgisiz seçin.</dd></div>
        <div><dt className="font-medium">İlgisiz</dt><dd className="text-muted-foreground">Numaralar rastlantısal (FEBI / IBRAS). Çift tekrar önerilmez.</dd></div>
      </dl>
      <p className="flex items-center gap-2 text-muted-foreground"><Badge variant="secondary"><CircleCheck data-icon="inline-start" aria-hidden="true"/>%15+</Badge>Ürün adı benzerliği gerçek eşlemelerde genelde %10’un üzerinde, rastlantılarda %2–5 çıkar.</p>
    </DialogContent>
  </Dialog>;
}
