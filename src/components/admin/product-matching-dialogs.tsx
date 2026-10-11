"use client";

import type { ReactNode } from "react";
import { CircleHelp, Maximize2 } from "lucide-react";
import { StatusBadge } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { decideBrandPair } from "@/app/yonetim/urun-eslestirme/actions";

export type PairRow = { brand_a: string; brand_b: string; shared_parts: string; shared_eans: string | null; similarity: string | null; strong: boolean;
  samples: { part: string; a: string | null; b: string | null }[]; ean_samples: { ean: string; part_a: string; a: string | null; part_b: string; b: string | null }[] };
// `relation` is set for equivalence groups: whether the item owns the reference number or states it.
export type GroupMemberRow = { id: string; supplier: string; code: string; brand: string | null; name: string | null; cost: string; stock: boolean | null; sale: string; relation?: string };

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
    <DialogContent className="sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>{pair.brand_a} ↔ {pair.brand_b}</DialogTitle>
        <DialogDescription>{pair.shared_parts} ortak parça numarası{pair.shared_eans ? ` · ${pair.shared_eans} ortak barkod` : ""} · ürün adı benzerliği {pair.similarity ?? "—"}</DialogDescription>
      </DialogHeader>
      <div className="grid max-h-[55dvh] gap-3 overflow-auto">
        {pair.samples.length > 0 && <div className="rounded-lg border">
          <Table className="table-fixed text-xs [&_td]:py-1.5 [&_td]:[overflow-wrap:anywhere]"><TableHeader><TableRow className="bg-muted/40"><TableHead className="w-24 pl-3">Parça no</TableHead><TableHead>{pair.brand_a}</TableHead><TableHead className="pr-3">{pair.brand_b}</TableHead></TableRow></TableHeader>
            <TableBody>{pair.samples.map((sample, index) => <TableRow key={index} className="align-top">
              <TableCell className="pl-3 font-mono">{sample.part}</TableCell>
              <TableCell className="whitespace-normal">{sample.a || "—"}</TableCell>
              <TableCell className="pr-3 whitespace-normal">{sample.b || "—"}</TableCell>
            </TableRow>)}</TableBody></Table>
        </div>}
        {pair.ean_samples.length > 0 && <div className="rounded-lg border">
          <Table className="table-fixed text-xs [&_td]:py-1.5 [&_td]:[overflow-wrap:anywhere]"><TableHeader><TableRow className="bg-muted/40"><TableHead className="w-28 pl-3">Barkod</TableHead><TableHead>{pair.brand_a}</TableHead><TableHead className="pr-3">{pair.brand_b}</TableHead></TableRow></TableHeader>
            <TableBody>{pair.ean_samples.map(sample => <TableRow key={sample.ean} className="align-top">
              <TableCell className="pl-3 font-mono">{sample.ean}</TableCell>
              <TableCell className="whitespace-normal"><span className="font-mono">{sample.part_a}</span> · {sample.a || "—"}</TableCell>
              <TableCell className="pr-3 whitespace-normal"><span className="font-mono">{sample.part_b}</span> · {sample.b || "—"}</TableCell>
            </TableRow>)}</TableBody></Table>
        </div>}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-xs text-muted-foreground">Karar markanın tüm ortak parçalarına uygulanır.</span><PairDecision pair={pair} back={back} size="sm"/></div>
    </DialogContent>
  </Dialog>;
}

export function GroupDialog({ title, description, members }: { title: string; description: string; members: GroupMemberRow[] }) {
  const relation = members.some(member => member.relation);
  return <Dialog>
    <DetailTrigger label={`${title} kayıtlarını aç`}/>
    <DialogContent className="sm:max-w-4xl">
      <DialogHeader><DialogTitle className="font-mono">{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
      <div className="max-h-[60dvh] overflow-auto rounded-lg border">
        <Table className={`${relation ? "min-w-[880px]" : "min-w-[760px]"} table-fixed text-xs [&_td]:py-1.5`}><TableHeader><TableRow className="bg-muted/40">
          <TableHead className="w-24 pl-3">Tedarikçi</TableHead>{relation && <TableHead className="w-28">Bağ</TableHead>}<TableHead className="w-40">Kod</TableHead><TableHead className="w-32">Kaynak marka</TableHead><TableHead>Ad</TableHead>
          <TableHead className="w-28 text-right">Kaynak fiyat</TableHead><TableHead className="w-16 text-center">Stok</TableHead><TableHead className="w-28 pr-3 text-right">Mağaza</TableHead>
        </TableRow></TableHeader>
          <TableBody>{members.map(member => <TableRow key={member.id}>
            <TableCell className="pl-3">{member.supplier}</TableCell>
            {relation && <TableCell className="text-muted-foreground">{member.relation}</TableCell>}
            <TableCell className="truncate font-mono" title={member.code}>{member.code}</TableCell>
            <TableCell className="truncate text-muted-foreground" title={member.brand ?? ""}>{member.brand || "—"}</TableCell>
            <TableCell className="truncate" title={member.name ?? ""}>{member.name || "—"}</TableCell>
            <TableCell className="text-right tabular-nums">{member.cost}</TableCell>
            <TableCell className="text-center"><StockLabel stock={member.stock}/></TableCell>
            <TableCell className="pr-3 text-right tabular-nums text-muted-foreground">{member.sale}</TableCell>
          </TableRow>)}</TableBody></Table>
      </div>
    </DialogContent>
  </Dialog>;
}

export function StockLabel({ stock }: { stock: boolean | null }): ReactNode {
  if (stock === null) return <span className="text-muted-foreground">—</span>;
  return <span className={stock ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"}>{stock ? "Var" : "Yok"}</span>;
}

export function DecisionHelp() {
  return <Dialog>
    <DialogTrigger render={<Button variant="ghost" size="sm"/>}><CircleHelp aria-hidden="true"/>Nasıl karar verilir?</DialogTrigger>
    <DialogContent className="sm:max-w-lg">
      <DialogHeader><DialogTitle>Marka çifti kararları</DialogTitle><DialogDescription>Aynı parça numarası farklı tedarikçilerde farklı markayla geçiyor. Karar çiftin tüm ortak parçalarına uygulanır.</DialogDescription></DialogHeader>
      <dl className="grid gap-3 text-sm">
        <div><dt className="font-medium">Aynı marka</dt><dd className="text-muted-foreground">İki etiket aynı ürünü satar (M.MARELLI / MAGNETI MARELLI, MAHLE / MAHLE FILTRE). Kayıtlar bir sonraki yenilemede tek üründe birleşir.</dd></div>
        <div><dt className="font-medium">Muadil</dt><dd className="text-muted-foreground">Aynı numaralandırma, farklı ürün: kayış ölçüsü (CONTITECH / DAYCO) veya OEM numarasını kod olarak kullanan yan sanayi (EUROREPAR / ORIJINAL).</dd></div>
        <div><dt className="font-medium">Ortak barkod</dt><dd className="text-muted-foreground">Dinamik’te iki markanın ürünleri aynı barkodu taşıyorsa (WENDER / WENDERPARTS) bu güçlü bir “aynı marka” kanıtıdır. Ad benzerliği düşükse barkodlar yer tutucudur; ilgisiz seçin.</dd></div>
        <div><dt className="font-medium">İlgisiz</dt><dd className="text-muted-foreground">Numaralar rastlantısal (FEBI / IBRAS). Çift tekrar önerilmez.</dd></div>
      </dl>
      <p className="flex items-center gap-2 text-xs text-muted-foreground"><StatusBadge tone="success">%15+</StatusBadge>Ürün adı benzerliği gerçek eşlemelerde genelde %10’un üzerinde, rastlantılarda %2–5 çıkar.</p>
    </DialogContent>
  </Dialog>;
}
