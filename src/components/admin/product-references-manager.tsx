"use client";

import { useId, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, CircleCheck, Eye, EyeOff, GitMerge, Hash, Pencil, Plus, Trash2 } from "lucide-react";
import { addProductReference, hideProductReference, removeProductReference, setSupplierOemHidden, type ProductReferenceActionResult } from "@/app/yonetim/urunler/reference-actions";
import { productReferenceLimit, referenceKindLabels, referenceKinds, type ReferenceKind } from "@/modules/admin/product-reference-fields";
import type { ProductReferences } from "@/modules/admin/product-reference-store";
import { StatusBadge } from "@/components/admin/status-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Row = { key: string; kind: ReferenceKind; brand: string; number: string; status: "manual" | "carried" | "automatic" | "hidden" | "supplier";
  carried?: boolean; id?: string };

const compact = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, "");
const rowKey = (kind: string, brand: string, number: string) => `${kind}|${compact(brand)}|${compact(number)}`;
// Fixed display order, so a refresh after a change never moves rows under the pointer.
const statusOrder: Record<Row["status"], number> = { manual: 0, carried: 0, hidden: 1, automatic: 2, supplier: 3 };

const brandLabels: Record<ReferenceKind, string> = { oem: "Araç markası", cross: "Üretici", ean: "" };
const brandPlaceholders: Record<ReferenceKind, string> = { oem: "Örn. VW", cross: "Örn. BOSCH", ean: "" };
const numberPlaceholders: Record<ReferenceKind, string> = { oem: "Örn. 1K0615301AA", cross: "Örn. 0986424797", ean: "Örn. 4006584112301" };

/**
 * Adds OEM numbers, cross-reference codes and barcodes, and hides automatic (enrichment) numbers from the store (#582).
 * The supplier rows' OEM field is hidden or shown as a whole for the product (#615). Every change goes through a server
 * action; the page refreshes with the stored list.
 */
export function ProductReferencesManager({ productId, references }: { productId: string; references: ProductReferences }) {
  const router = useRouter();
  const ids = { kind: useId(), brand: useId(), number: useId() };
  const [pending, startTransition] = useTransition();
  const [kind, setKind] = useState<ReferenceKind>("oem");
  const [brand, setBrand] = useState("");
  const [number, setNumber] = useState("");
  const [result, setResult] = useState<ProductReferenceActionResult | null>(null);
  const stored = references.added.length + references.hidden.length;
  const supplierHidden = references.supplierOemHidden;
  // Product-level: shown while there is a supplier OEM, and while the flag is set (it can be reverted after the rows left).
  const supplierControl = supplierHidden || references.automatic.some(row => row.supplierOem);

  const mutate = (action: () => Promise<ProductReferenceActionResult>, onSuccess?: () => void) => {
    setResult(null);
    startTransition(async () => {
      const next = await action().catch((): ProductReferenceActionResult => ({ status: "error", message: "Bağlantı kesildi; yeniden deneyin." }));
      setResult(next);
      if (next.status === "success") onSuccess?.();
      router.refresh();
    });
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    mutate(() => addProductReference({ productId, kind, brand: kind === "ean" ? "" : brand, number }), () => setNumber(""));
  };

  const shownHidden = new Set(references.automatic.map(row => row.hiddenId).filter(Boolean));
  // An automatic number the admin also added by hand cannot be hidden (same key) until the added row is removed.
  const addedKeys = new Set(references.added.map(row => rowKey(row.kind, row.brand, row.number)));
  const rows: Row[] = [
    ...references.added.map(row => ({ key: row.id, id: row.id, kind: row.kind, brand: row.brand, number: row.number, status: row.carried ? "carried" as const : "manual" as const })),
    ...references.automatic.map(row => ({ key: `${row.supplierOem ? "s" : "a"}|${row.kind}|${row.brand}|${row.number}`, id: row.hiddenId ?? undefined,
      kind: row.kind, brand: row.brand, number: row.number, status: row.supplierOem ? "supplier" as const : row.hiddenId ? "hidden" as const : "automatic" as const })),
    // Hidden numbers the enrichment no longer lists stay here so they can be shown again.
    ...references.hidden.filter(row => !shownHidden.has(row.id)).map(row => ({ key: row.id, id: row.id, kind: row.kind, brand: row.brand, number: row.number,
      status: "hidden" as const, carried: row.carried })),
  ].map((row, index) => ({ row, index })).sort((a, b) => statusOrder[a.row.status] - statusOrder[b.row.status] || a.index - b.index).map(({ row }) => row);

  return <div className="flex flex-col gap-4">
    <form className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:items-end" onSubmit={submit}>
      <Field>
        <FieldLabel htmlFor={ids.kind}>Tür</FieldLabel>
        <NativeSelect id={ids.kind} className="w-full" value={kind} disabled={pending} onChange={event => setKind(event.target.value as ReferenceKind)}>
          {referenceKinds.map(value => <NativeSelectOption key={value} value={value}>{referenceKindLabels[value]}</NativeSelectOption>)}
        </NativeSelect>
      </Field>
      {kind !== "ean" && <Field>
        <FieldLabel htmlFor={ids.brand}>{brandLabels[kind]}</FieldLabel>
        <Input id={ids.brand} value={brand} maxLength={80} required disabled={pending} placeholder={brandPlaceholders[kind]} autoComplete="off"
          onChange={event => setBrand(event.target.value)}/>
      </Field>}
      <Field>
        <FieldLabel htmlFor={ids.number}>Numara</FieldLabel>
        <Input id={ids.number} value={number} minLength={3} maxLength={60} required disabled={pending} placeholder={numberPlaceholders[kind]} autoComplete="off"
          className="font-mono" onChange={event => setNumber(event.target.value)}/>
      </Field>
      <Button type="submit" disabled={pending || stored >= productReferenceLimit}>
        {pending ? <><Spinner data-icon="inline-start"/>Kaydediliyor…</> : <><Plus data-icon="inline-start" aria-hidden="true"/>Ekle</>}</Button>
      <FieldDescription className="sm:col-span-2 lg:col-span-4">
        {kind === "ean" ? "Barkod 8, 12, 13 veya 14 haneli olmalı; kontrol hanesi doğrulanır." : "Harf, rakam, boşluk, nokta, eğik çizgi ve tire kullanılabilir; aramada boşluk ve işaretler yok sayılır."}
        {stored >= productReferenceLimit && ` Bu ürün ${productReferenceLimit} kayıt sınırına ulaştı; yeni numara için önce birini kaldırın.`}
      </FieldDescription>
    </form>

    <div aria-live="polite" className="empty:hidden">
      {result?.status === "success" && <Alert variant="success"><CircleCheck aria-hidden="true"/><AlertDescription>{result.message}</AlertDescription></Alert>}
    </div>
    {result?.status === "error" && <Alert variant="destructive" role="alert"><CircleAlert aria-hidden="true"/><AlertDescription>{result.message}</AlertDescription></Alert>}

    {supplierControl && <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-muted-foreground">Tedarikçi OEM alanı ürün genelinde gizlenir veya gösterilir; ürünün tüm tedarikçi kayıtları etkilenir. Gizlenen tedarikçi OEM&apos;i muadil eşleştirmede de kullanılmaz; bu OEM&apos;den doğan muadil bağlantıları kaldırılır, elle eklenenler korunur.</p>
      <Button type="button" variant="outline" disabled={pending} onClick={() => mutate(() => setSupplierOemHidden({ productId, hidden: !supplierHidden }))}>
        {supplierHidden ? <><Eye data-icon="inline-start" aria-hidden="true"/>Tedarikçi OEM alanını yeniden göster</>
          : <><EyeOff data-icon="inline-start" aria-hidden="true"/>Tedarikçi OEM alanını mağazada gizle</>}</Button>
    </div>}

    {rows.length ? <Table controls={false}><caption className="sr-only">Referans numaraları</caption>
      <TableHeader><TableRow><TableHead>Tür</TableHead><TableHead>Marka</TableHead><TableHead>Numara</TableHead><TableHead>Durum</TableHead><TableHead><span className="sr-only">İşlem</span></TableHead></TableRow></TableHeader>
      <TableBody>{rows.map(row => <TableRow key={row.key}>
        <TableCell>{referenceKindLabels[row.kind]}</TableCell>
        <TableCell className="max-w-48 truncate" title={row.brand}>{row.brand || <><span className="text-muted-foreground" aria-hidden="true">—</span><span className="sr-only">Marka yok</span></>}</TableCell>
        <TableCell className="font-mono">{row.number}</TableCell>
        <TableCell><div className="flex flex-wrap gap-1">
          {row.status === "manual" && <StatusBadge tone="info" icon={Pencil}>Elle eklendi</StatusBadge>}
          {(row.status === "carried" || row.carried) && <StatusBadge tone="info" icon={GitMerge}>Birleştirmeden taşındı</StatusBadge>}
          {row.status === "automatic" && <StatusBadge tone="neutral">Otomatik</StatusBadge>}
          {row.status === "hidden" && <StatusBadge tone="warning" icon={EyeOff}>Mağazada gizli</StatusBadge>}
          {row.status === "supplier" && <StatusBadge tone="neutral">Tedarikçi verisi</StatusBadge>}
          {row.status === "supplier" && supplierHidden && <StatusBadge tone="warning" icon={EyeOff}>Mağazada gizli</StatusBadge>}
        </div></TableCell>
        <TableCell><div className="flex flex-wrap justify-end gap-2">
          {(row.status === "manual" || row.status === "carried") && row.id && <Button type="button" variant="outline" disabled={pending}
            aria-label={`${row.number} numarasını kaldır`} onClick={() => mutate(() => removeProductReference({ productId, referenceId: row.id! }))}><Trash2 data-icon="inline-start" aria-hidden="true"/>Kaldır</Button>}
          {row.status === "automatic" && addedKeys.has(rowKey(row.kind, row.brand, row.number))
            && <span className="text-muted-foreground">Gizlemek için önce elle eklenen numarayı kaldırın.</span>}
          {row.status === "automatic" && row.kind !== "ean" && !addedKeys.has(rowKey(row.kind, row.brand, row.number)) && <Button type="button" variant="outline"
            disabled={pending || stored >= productReferenceLimit} aria-label={`${row.number} numarasını mağazada gizle`} onClick={() => mutate(() => hideProductReference({ productId, kind: row.kind, brand: row.brand, number: row.number }))}><EyeOff data-icon="inline-start" aria-hidden="true"/>Gizle</Button>}
          {row.status === "hidden" && row.id && <Button type="button" variant="outline" disabled={pending}
            aria-label={`${row.number} numarasını yeniden göster`} onClick={() => mutate(() => removeProductReference({ productId, referenceId: row.id!, shown: true }))}><Eye data-icon="inline-start" aria-hidden="true"/>Yeniden göster</Button>}
        </div></TableCell>
      </TableRow>)}</TableBody></Table>
      : <Empty><EmptyHeader><EmptyMedia variant="icon"><Hash/></EmptyMedia><EmptyTitle>Referans numarası yok</EmptyTitle>
        <EmptyDescription>Bu ürünün otomatik OEM veya muadil numarası yok; yukarıdaki formla elle ekleyebilirsiniz.</EmptyDescription></EmptyHeader></Empty>}
  </div>;
}
