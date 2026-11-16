"use client";

import { useEffect, useState, type ReactNode } from "react";
import { CircleAlert, CircleCheck, Maximize2, Merge, Pencil } from "lucide-react";
import { BrandLogoField, type BrandLogoState } from "@/components/admin/brand-logo-field";
import { StatusBadge } from "@/components/admin/status-badge";
import { SubmitButton } from "@/components/admin/submit-button";
import { formatNumber } from "@/modules/admin/format";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { confirmBrand, mergeBrand, moveBrandLabel, renameBrand } from "@/app/yonetim/urun-eslestirme/actions";
import { productIdPath } from "@/modules/seo/product-id";

function DetailTrigger({ label }: { label: string }) {
  return <DialogTrigger render={<Button variant="ghost" size="icon" aria-label={label} title={label}/>}><Maximize2 aria-hidden="true"/></DialogTrigger>;
}

type LinkedProductRow = { id: string; supplier: string; code: string; name: string | null; via: string };

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
          <TableCell className="max-w-40 truncate font-mono" title={product.code}><Button variant="link" className="h-auto p-0 font-mono" nativeButton={false} render={<a href={productIdPath(product.id)} target="_blank" rel="noreferrer"/>}>{product.code}</Button></TableCell>
          <TableCell className="max-w-64 truncate" title={product.name ?? ""}>{product.name || "—"}</TableCell>
          <TableCell className="max-w-40 truncate font-mono text-muted-foreground" title={product.via}>{product.via}</TableCell>
        </TableRow>)}</TableBody></Table>
    </DialogContent>
  </Dialog>;
}

export function StockLabel({ stock }: { stock: boolean | null }): ReactNode {
  if (stock === null) return <span className="text-muted-foreground">—</span>;
  return <StatusBadge tone={stock ? "success" : "neutral"}>{stock ? "Var" : "Yok"}</StatusBadge>;
}


type BrandLabelRow = { supplier: string; label: string; items: number; method: "auto" | "manual" };
const supplierNames: Record<string, string> = { basbug: "Başbuğ", dinamik: "Dinamik", seta: "SETA", manual: "Manuel liste" };
type BrandSuggestionRow = { id: string; name: string; evidence: string };
export type BrandRow = { id: string; key: string; name: string; items: string; pending: boolean; fresh: boolean; suggestion: BrandSuggestionRow | null; logo: BrandLogoState };

/** "Onayla": the automatically placed labels stay where they are. */
export function ConfirmBrand({ id, back }: { id: string; back: string }) {
  return <form action={confirmBrand}><input type="hidden" name="id" value={id}/><input type="hidden" name="back" value={back}/>
    <SubmitButton variant="outline" icon={<CircleCheck data-icon="inline-start" aria-hidden="true"/>}>Onayla</SubmitButton></form>;
}

/** A new brand joins the reviewed brand suggested for it (shared part numbers or a similar name). */
export function MergeSuggestion({ id, suggestion, back }: { id: string; suggestion: BrandSuggestionRow; back: string }) {
  return <form action={mergeBrand}><input type="hidden" name="id" value={id}/><input type="hidden" name="targetId" value={suggestion.id}/>
    <input type="hidden" name="back" value={back}/>
    <SubmitButton variant="outline" title={`Tüm etiketler ${suggestion.name} markasına geçer`} icon={<Merge data-icon="inline-start" aria-hidden="true"/>}>{suggestion.name} ile birleştir</SubmitButton></form>;
}

/**
 * Rename a master brand, move one of its supplier labels to another master brand (or make it a brand of its own),
 * or merge the whole brand into another, and set its store logo (#819). Its labels and the target-name suggestions load when it opens, so closed dialogs add nothing to the page.
 */
export function BrandDialog({ brand, back }: { brand: BrandRow; back: string }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{ labels: BrandLabelRow[]; names: string[] } | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    fetch(`/api/admin/brand-dialog/${brand.id}`, { cache: "no-store", signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error(response.status === 403 ? "Oturumun sona ermiş olabilir. Yönetici hesabınla yeniden giriş yap." : "Marka etiketleri yüklenemedi.");
        return response.json() as Promise<{ labels: BrandLabelRow[]; names: string[] }>;
      }).then(value => { setError(""); setData(value); }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Marka etiketleri yüklenemedi."); });
    return () => controller.abort();
  }, [open, brand.id, attempt]);
  const hidden = <input type="hidden" name="back" value={back}/>;
  const labels = data?.labels ?? [];
  return <Dialog open={open} onOpenChange={setOpen}>
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
          <SubmitButton variant="outline">Adı kaydet</SubmitButton>
        </form>
        <Separator/>
        <BrandLogoField brandId={brand.id} brandName={brand.name} state={brand.logo}/>
        <Separator/>
        {error ? <Alert variant="destructive" role="alert"><CircleAlert aria-hidden="true"/><AlertTitle>Etiketler alınamadı</AlertTitle><AlertDescription>{error}</AlertDescription><AlertAction><Button variant="outline" onClick={() => { setError(""); setAttempt(value => value + 1); }}>Tekrar dene</Button></AlertAction></Alert>
        : !data ? <div className="flex flex-col gap-2" role="status"><span className="sr-only">Etiketler yükleniyor…</span><Skeleton className="h-8 w-full"/><Skeleton className="h-24 w-full"/></div>
        : <><datalist id="brand-names">{data.names.map(name => <option key={name} value={name}/>)}</datalist>
        <Table><caption className="sr-only">Tedarikçi etiketleri</caption>
          <TableHeader><TableRow><TableHead>Tedarikçi</TableHead><TableHead>Etiket</TableHead><TableHead className="text-right">Kayıt</TableHead><TableHead>Durum</TableHead><TableHead>Başka ana markaya taşı</TableHead></TableRow></TableHeader>
          <TableBody>{labels.map(label => <TableRow key={`${label.supplier}|${label.label}`}>
            <TableCell>{supplierNames[label.supplier] ?? label.supplier}</TableCell>
            <TableCell className="max-w-40 truncate font-medium" title={label.label}>{label.label}</TableCell>
            <TableCell className="text-right tabular-nums">{formatNumber(label.items)}</TableCell>
            <TableCell>{label.method === "auto" ? <StatusBadge tone="warning">Otomatik</StatusBadge> : <StatusBadge tone="success">Onaylı</StatusBadge>}</TableCell>
            <TableCell><form action={moveBrandLabel} className="flex items-center gap-2">
              <input type="hidden" name="supplier" value={label.supplier}/><input type="hidden" name="label" value={label.label}/>{hidden}
              <Input name="target" list="brand-names" aria-label={`${label.label} için hedef ana marka`} placeholder="Ana marka adı" maxLength={80} className="w-40"/>
              <SubmitButton name="mode" value="move" variant="outline">Taşı</SubmitButton>
              <SubmitButton name="mode" value="new" variant="ghost" title="Bu etiket ayrı bir ana marka olsun">Ayrı marka</SubmitButton>
            </form></TableCell>
          </TableRow>)}</TableBody></Table></>}
        <Separator/>
        <form action={mergeBrand} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="id" value={brand.id}/>{hidden}
          <Field className="w-full sm:w-72"><FieldLabel htmlFor={`brand-merge-${brand.id}`}>Başka bir ana markayla birleştir</FieldLabel>
            <Input id={`brand-merge-${brand.id}`} name="target" list="brand-names" placeholder="Ana marka adı" maxLength={80} required defaultValue={brand.suggestion?.name}/>
            <FieldDescription>{brand.suggestion && <>Öneri: {brand.suggestion.name} ({brand.suggestion.evidence}). </>}Tüm etiketler hedef markaya geçer; {brand.name} listeden kalkar.</FieldDescription></Field>
          <SubmitButton variant="outline">Birleştir</SubmitButton>
        </form>
      </div>
      {brand.pending && <DialogFooter className="items-center sm:justify-between"><span className="text-muted-foreground">Etiketler doğruysa onaylayın; onaylı etiketler otomatik taşınmaz.</span><ConfirmBrand id={brand.id} back={back}/></DialogFooter>}
    </DialogContent>
  </Dialog>;
}
