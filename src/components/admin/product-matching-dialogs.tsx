"use client";

import type { ReactNode } from "react";
import { CircleAlert, CircleCheck, Maximize2, Pencil, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { confirmBrand, mergeBrand, moveBrandLabel, renameBrand } from "@/app/yonetim/urun-eslestirme/actions";

function DetailTrigger({ label }: { label: string }) {
  return <DialogTrigger render={<Button variant="ghost" size="icon" aria-label={label} title={label}/>}><Maximize2 aria-hidden="true"/></DialogTrigger>;
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
  const Icon = stock ? CircleCheck : CircleAlert;
  return <Badge variant={stock ? "success" : "outline"}><Icon data-icon="inline-start" aria-hidden="true"/>{stock ? "Var" : "Yok"}</Badge>;
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
