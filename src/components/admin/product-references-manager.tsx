"use client";

import { useId, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, CircleCheck, Eye, EyeOff, GitMerge, Pencil, Plus, Trash2 } from "lucide-react";
import { addProductReference, hideProductReference, removeProductReference, type ProductReferenceActionResult } from "@/app/yonetim/urunler/reference-actions";
import { productReferenceLimit, referenceKindLabels, referenceKinds, type ReferenceKind } from "@/modules/admin/product-reference-fields";
import type { ProductReferences } from "@/modules/admin/product-reference-store";
import { StatusBadge } from "@/components/admin/status-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Row = { key: string; kind: ReferenceKind; brand: string; number: string; status: "manual" | "carried" | "automatic" | "hidden" | "supplier";
  carried?: boolean; id?: string };

const brandLabels: Record<ReferenceKind, string> = { oem: "Araç markası", cross: "Üretici", ean: "" };
const brandPlaceholders: Record<ReferenceKind, string> = { oem: "Örn. VW", cross: "Örn. BOSCH", ean: "" };
const numberPlaceholders: Record<ReferenceKind, string> = { oem: "Örn. 1K0615301AA", cross: "Örn. 0986424797", ean: "Örn. 4006584112301" };

/**
 * Adds OEM numbers, cross-reference codes and barcodes, and hides automatic (enrichment) numbers from the store (#582).
 * Every change goes through a server action; the page refreshes with the stored list.
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
  const rows: Row[] = [
    ...references.added.map(row => ({ key: row.id, id: row.id, kind: row.kind, brand: row.brand, number: row.number, status: row.carried ? "carried" as const : "manual" as const })),
    ...references.automatic.map(row => ({ key: `${row.supplierOem ? "s" : "a"}|${row.kind}|${row.brand}|${row.number}`, id: row.hiddenId ?? undefined,
      kind: row.kind, brand: row.brand, number: row.number, status: row.supplierOem ? "supplier" as const : row.hiddenId ? "hidden" as const : "automatic" as const })),
    // Hidden numbers the enrichment no longer lists stay here so they can be shown again.
    ...references.hidden.filter(row => !shownHidden.has(row.id)).map(row => ({ key: row.id, id: row.id, kind: row.kind, brand: row.brand, number: row.number,
      status: "hidden" as const, carried: row.carried })),
  ];

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
      <Button type="submit" disabled={pending || stored >= productReferenceLimit}><Plus data-icon="inline-start" aria-hidden="true"/>Ekle</Button>
      <FieldDescription className="sm:col-span-2 lg:col-span-4">
        {kind === "ean" ? "Barkod 8, 12, 13 veya 14 haneli olmalı; kontrol hanesi doğrulanır." : "Harf, rakam, boşluk, nokta, eğik çizgi ve tire kullanılabilir; aramada boşluk ve işaretler yok sayılır."}
        {stored >= productReferenceLimit && ` Bu ürün ${productReferenceLimit} kayıt sınırına ulaştı; yeni numara için önce birini kaldırın.`}
      </FieldDescription>
    </form>

    <div aria-live="polite" className="empty:hidden">
      {result?.status === "success" && <Alert variant="success"><CircleCheck aria-hidden="true"/><AlertDescription>{result.message}</AlertDescription></Alert>}
    </div>
    {result?.status === "error" && <Alert variant="destructive" role="alert"><CircleAlert aria-hidden="true"/><AlertDescription>{result.message}</AlertDescription></Alert>}

    {rows.length ? <Table><caption className="sr-only">Referans numaraları</caption>
      <TableHeader><TableRow><TableHead>Tür</TableHead><TableHead>Marka</TableHead><TableHead>Numara</TableHead><TableHead>Durum</TableHead><TableHead><span className="sr-only">İşlem</span></TableHead></TableRow></TableHeader>
      <TableBody>{rows.map(row => <TableRow key={row.key}>
        <TableCell>{referenceKindLabels[row.kind]}</TableCell>
        <TableCell className="max-w-48 truncate" title={row.brand}>{row.brand || <span className="text-muted-foreground">—</span>}</TableCell>
        <TableCell className="font-mono">{row.number}</TableCell>
        <TableCell><div className="flex flex-wrap gap-1">
          {row.status === "manual" && <StatusBadge tone="info" icon={Pencil}>Elle eklendi</StatusBadge>}
          {(row.status === "carried" || row.carried) && <StatusBadge tone="info" icon={GitMerge}>Birleştirmeden taşındı</StatusBadge>}
          {row.status === "automatic" && <StatusBadge tone="neutral">Otomatik</StatusBadge>}
          {row.status === "hidden" && <StatusBadge tone="warning" icon={EyeOff}>Mağazada gizli</StatusBadge>}
          {row.status === "supplier" && <StatusBadge tone="neutral">Tedarikçi verisi</StatusBadge>}
        </div></TableCell>
        <TableCell><div className="flex flex-wrap justify-end gap-2">
          {(row.status === "manual" || row.status === "carried") && row.id && <Button type="button" variant="outline" disabled={pending}
            onClick={() => mutate(() => removeProductReference({ productId, referenceId: row.id! }))}><Trash2 data-icon="inline-start" aria-hidden="true"/>Kaldır</Button>}
          {row.status === "automatic" && row.kind !== "ean" && <Button type="button" variant="outline" disabled={pending || stored >= productReferenceLimit}
            onClick={() => mutate(() => hideProductReference({ productId, kind: row.kind, brand: row.brand, number: row.number }))}><EyeOff data-icon="inline-start" aria-hidden="true"/>Gizle</Button>}
          {row.status === "hidden" && row.id && <Button type="button" variant="outline" disabled={pending}
            onClick={() => mutate(() => removeProductReference({ productId, referenceId: row.id!, shown: true }))}><Eye data-icon="inline-start" aria-hidden="true"/>Yeniden göster</Button>}
        </div></TableCell>
      </TableRow>)}</TableBody></Table>
      : <p className="text-muted-foreground">Bu ürünün referans numarası yok.</p>}
  </div>;
}
