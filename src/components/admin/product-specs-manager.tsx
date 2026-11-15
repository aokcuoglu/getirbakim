"use client";

import { useId, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, CircleCheck, Eye, EyeOff, GitMerge, ListChecks, Pencil, Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import { hideProductSpec, removeProductSpec, setProductSpec, type ProductSpecActionResult } from "@/app/yonetim/urunler/spec-actions";
import { productSpecLimit } from "@/modules/admin/product-spec-fields";
import type { ProductSpecs } from "@/modules/admin/product-spec-store";
import { facetSpecificationKeys, specificationLabel } from "@/modules/store/catalog-filters";
import { StatusBadge } from "@/components/admin/status-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Row = { key: string; value: string | null; automatic: string[]; status: "added" | "edited" | "hidden" | "automatic"; carried: boolean; id?: string };

// Fixed display order, so a refresh after a change never moves rows under the pointer.
const statusOrder: Record<Row["status"], number> = { added: 0, edited: 0, hidden: 1, automatic: 2 };

/**
 * Sets, adds and hides technical specifications of a product (#603). Every change goes through a server action; the
 * page refreshes with the stored list.
 */
export function ProductSpecsManager({ productId, specs }: { productId: string; specs: ProductSpecs }) {
  const router = useRouter();
  const ids = { key: useId(), value: useId(), edit: useId() };
  const [pending, startTransition] = useTransition();
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [editing, setEditing] = useState<{ key: string; value: string; several: boolean } | null>(null);
  const [result, setResult] = useState<ProductSpecActionResult | null>(null);
  const full = specs.rows.length >= productSpecLimit;

  const mutate = (action: () => Promise<ProductSpecActionResult>, onSuccess?: () => void) => {
    setResult(null);
    startTransition(async () => {
      const next = await action().catch((): ProductSpecActionResult => ({ status: "error", message: "Bağlantı kesildi; yeniden deneyin." }));
      setResult(next);
      if (next.status === "success") onSuccess?.();
      router.refresh();
    });
  };
  const add = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    mutate(() => setProductSpec({ productId, key, value }), () => { setKey(""); setValue(""); });
  };
  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (editing) mutate(() => setProductSpec({ productId, key: editing.key, value: editing.value }), () => setEditing(null));
  };

  const automatic = new Map<string, string[]>();
  for (const row of specs.automatic) automatic.set(row.key, [...automatic.get(row.key) ?? [], row.value]);
  const decided = new Set(specs.rows.map(row => row.key));
  const rows: Row[] = [
    ...specs.rows.map(row => ({ key: row.key, value: row.value, automatic: automatic.get(row.key) ?? [], id: row.id, carried: row.carried,
      status: row.action === "hide" ? "hidden" as const : automatic.has(row.key) ? "edited" as const : "added" as const })),
    ...[...automatic].filter(([name]) => !decided.has(name)).map(([name, values]) => ({ key: name, value: null, automatic: values, carried: false, status: "automatic" as const })),
  ].map((row, index) => ({ row, index })).sort((a, b) => statusOrder[a.row.status] - statusOrder[b.row.status] || a.index - b.index).map(({ row }) => row);

  return <div className="flex flex-col gap-4">
    <form className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 lg:items-end" onSubmit={add}>
      <Field>
        <FieldLabel htmlFor={ids.key}>Özellik</FieldLabel>
        <Input id={ids.key} value={key} maxLength={200} required disabled={pending || full} placeholder="Örn. Montaj konumu" autoComplete="off"
          onChange={event => setKey(event.target.value)}/>
      </Field>
      <Field>
        <FieldLabel htmlFor={ids.value}>Değer</FieldLabel>
        <Input id={ids.value} value={value} maxLength={500} required disabled={pending || full} placeholder="Örn. Ön aks" autoComplete="off"
          onChange={event => setValue(event.target.value)}/>
      </Field>
      <Button type="submit" disabled={pending || full}>
        {pending ? <><Spinner data-icon="inline-start"/>Kaydediliyor…</> : <><Plus data-icon="inline-start" aria-hidden="true"/>Ekle</>}</Button>
      <FieldDescription className="sm:col-span-2 lg:col-span-3">
        Özellik adını Türkçe (“Montaj konumu”) ya da kaynaktaki İngilizce adıyla (“Fitting Position”) yazabilirsiniz; aynı özellik tek ada çevrilir ve otomatik değerin yerine geçer.
        Şu özellik adları katalog süzgeçlerinde de kullanılır: {facetSpecificationKeys.map(specificationLabel).join(", ")}.
        {full && ` Bu ürün ${productSpecLimit} kayıt sınırına ulaştı; yeni özellik için önce birini kaldırın.`}
      </FieldDescription>
    </form>

    <div aria-live="polite" className="empty:hidden">
      {result?.status === "success" && <Alert variant="success"><CircleCheck aria-hidden="true"/><AlertDescription>{result.message}</AlertDescription></Alert>}
    </div>
    {/* While the edit dialog is open, its own alert shows the error. */}
    {result?.status === "error" && !editing && <Alert variant="destructive" role="alert"><CircleAlert aria-hidden="true"/><AlertDescription>{result.message}</AlertDescription></Alert>}

    {rows.length ? <Table controls={false}><caption className="sr-only">Teknik özellikler</caption>
      <TableHeader><TableRow><TableHead>Özellik</TableHead><TableHead>Değer</TableHead><TableHead>Durum</TableHead><TableHead><span className="sr-only">İşlem</span></TableHead></TableRow></TableHeader>
      <TableBody>{rows.map(row => {
        const label = specificationLabel(row.key);
        const automaticText = row.automatic.join(", ");
        return <TableRow key={row.id ?? `a|${row.key}`}>
          <TableCell><div className="flex flex-col gap-1">
            <span>{label}</span>
            {label !== row.key && <span className="text-muted-foreground">{row.key}</span>}
          </div></TableCell>
          <TableCell className="max-w-md"><div className="flex flex-col gap-1">
            {row.status === "hidden" ? <span className="text-muted-foreground">{automaticText || "Otomatik kaynakta artık yok"}</span>
              : <span className="wrap-anywhere">{row.value ?? automaticText}</span>}
            {row.status === "edited" && <span className="text-muted-foreground">Otomatik: {automaticText}</span>}
          </div></TableCell>
          <TableCell><div className="flex flex-wrap gap-1">
            {row.status === "added" && <StatusBadge tone="success">Elle eklendi</StatusBadge>}
            {row.status === "edited" && <StatusBadge tone="info" icon={Pencil}>Elle düzenlendi</StatusBadge>}
            {row.status === "hidden" && <StatusBadge tone="warning" icon={EyeOff}>Mağazada gizli</StatusBadge>}
            {row.status === "automatic" && <StatusBadge tone="neutral">Otomatik</StatusBadge>}
            {row.carried && <StatusBadge tone="info" icon={GitMerge}>Birleştirmeden taşındı</StatusBadge>}
          </div></TableCell>
          <TableCell><div className="flex flex-wrap justify-end gap-2">
            {row.status !== "hidden" && <Button type="button" variant="outline" disabled={pending || (row.status === "automatic" && full)}
              aria-label={`${label} özelliğini düzenle`} onClick={() => { setResult(null); setEditing({ key: row.key, value: row.value ?? automaticText, several: row.value === null && row.automatic.length > 1 }); }}>
              <Pencil data-icon="inline-start" aria-hidden="true"/>Düzenle</Button>}
            {row.status === "automatic" && <Button type="button" variant="outline" disabled={pending || full}
              aria-label={`${label} özelliğini mağazada gizle`} onClick={() => mutate(() => hideProductSpec({ productId, key: row.key }))}>
              <EyeOff data-icon="inline-start" aria-hidden="true"/>Gizle</Button>}
            {row.status === "edited" && row.id && <Button type="button" variant="outline" disabled={pending}
              aria-label={`${label} özelliğini otomatiğe dön`} onClick={() => mutate(() => removeProductSpec({ productId, specId: row.id! }))}>
              <RotateCcw data-icon="inline-start" aria-hidden="true"/>Otomatiğe dön</Button>}
            {row.status === "added" && row.id && <Button type="button" variant="outline" disabled={pending}
              aria-label={`${label} özelliğini kaldır`} onClick={() => mutate(() => removeProductSpec({ productId, specId: row.id! }))}>
              <Trash2 data-icon="inline-start" aria-hidden="true"/>Kaldır</Button>}
            {row.status === "hidden" && row.id && <Button type="button" variant="outline" disabled={pending}
              aria-label={`${label} özelliğini yeniden göster`} onClick={() => mutate(() => removeProductSpec({ productId, specId: row.id!, shown: true }))}>
              <Eye data-icon="inline-start" aria-hidden="true"/>Yeniden göster</Button>}
          </div></TableCell>
        </TableRow>;
      })}</TableBody></Table>
      : <Empty><EmptyHeader><EmptyMedia variant="icon"><ListChecks/></EmptyMedia><EmptyTitle>Teknik özellik yok</EmptyTitle>
        <EmptyDescription>Bu ürünün otomatik teknik özelliği yok; yukarıdaki formla elle ekleyebilirsiniz.</EmptyDescription></EmptyHeader></Empty>}

    <Dialog open={editing !== null} onOpenChange={open => { if (!open) { setEditing(null); setResult(null); } }}>
      <DialogContent>
        <form className="flex flex-col gap-4" onSubmit={save}>
          <DialogHeader><DialogTitle>{editing ? `${specificationLabel(editing.key)} özelliğini düzenle` : "Özelliği düzenle"}</DialogTitle>
            <DialogDescription>Kaydedilen değer otomatik değerin yerine geçer; tedarikçi güncellemeleri onu değiştirmez.{editing?.several && " Birden çok otomatik değer tek değerle değişir."}</DialogDescription></DialogHeader>
          <Field>
            <FieldLabel htmlFor={ids.edit}>Değer</FieldLabel>
            <Input id={ids.edit} value={editing?.value ?? ""} maxLength={500} required disabled={pending} autoComplete="off"
              onChange={event => setEditing(current => current && { ...current, value: event.target.value })}/>
          </Field>
          {result?.status === "error" && <Alert variant="destructive" role="alert"><CircleAlert aria-hidden="true"/><AlertDescription>{result.message}</AlertDescription></Alert>}
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline"/>}>Vazgeç</DialogClose>
            <Button type="submit" disabled={pending}>
              {pending ? <><Spinner data-icon="inline-start"/>Kaydediliyor…</> : <><Save data-icon="inline-start" aria-hidden="true"/>Kaydet</>}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </div>;
}
