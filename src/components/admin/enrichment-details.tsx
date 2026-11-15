"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, ChevronRight, CircleAlert, TriangleAlert } from "lucide-react";
import { EnrichmentVehicles } from "./enrichment-vehicles";
import { StatusBadge } from "@/components/admin/status-badge";
import { formatDateTime, formatNumber } from "@/modules/admin/format";
import { dataSource, enrichmentStatuses, enrichmentStatusTones, gapText, matchLabels, sourceLabels, sourceNames } from "@/modules/admin/enrichment-labels";
import type { EnrichmentRow } from "@/modules/admin/enrichment-data";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Item, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableRow } from "@/components/ui/table";
import { productIdPath } from "@/modules/seo/product-id";

const number = formatNumber;
const date = (value: string) => formatDateTime(value);

// Dates arrive as ISO strings over JSON.
type Details = Omit<EnrichmentRow, "updated_at" | "imported_at"> & { updated_at: string; imported_at: string | null };

function DetailsBody({ row }: { row: Details }) {
  const source = dataSource(row.source_url), gaps = gapText(row);
  const rows: [string, React.ReactNode][] = [
    ["Durum", <StatusBadge key="status" tone={enrichmentStatusTones[row.status] ?? "neutral"}>{enrichmentStatuses[row.status] || row.status}</StatusBadge>],
    ["Eşleşme yöntemi", row.match_type ? matchLabels[row.match_type] : "Henüz doğrulanmadı"],
    ["Referans ürün", row.manufacturer ? `${row.manufacturer} ${row.manufacturer_part_number}` : "Henüz yok"],
    ["Veri kaynağı", source ? sourceLabels[source].name : "Henüz yok"],
    ["Aranan kaynaklar", row.searched.length ? sourceNames(row.searched) : "Henüz aranmadı"],
    ...(row.status === "partial" ? [["Eksik veri", gaps || "Belirtilmemiş"] as [string, string]] : []),
    ["Tedarikçi OEM", row.oem || "Belirtilmemiş"],
    ["Görsel", row.image_uploaded ? "Yönetici yükledi" : row.image_id && !row.image_shown ? "Otomatik görsel gizli" : row.image_id ? "Kaydedildi" : "Henüz yok"],
    ["Son işlem", `${date(row.imported_at || row.updated_at)} · ${row.attempts} deneme`],
  ];
  return <>
    <Table controls={false}><TableBody>{rows.map(([label, value]) => <TableRow key={label}><TableHead>{label}</TableHead><TableCell className="whitespace-normal">{value}</TableCell></TableRow>)}</TableBody></Table>
    <div className="grid grid-cols-3 gap-2">{([[row.oem_count, "OEM referansı"], [row.vehicle_count, "araç / motor"], [row.specification_count, "teknik özellik"]] as const).map(([value, label]) => <Item key={label} variant="muted"><ItemContent><ItemTitle className="text-xl tabular-nums">{number(value)}</ItemTitle><ItemDescription>{label}</ItemDescription></ItemContent></Item>)}</div>
    {row.last_error && <Alert variant="warning"><TriangleAlert aria-hidden="true"/><AlertDescription>Son işlem notu: {row.last_error}</AlertDescription></Alert>}
  </>;
}

export function EnrichmentDetails({ name, code, productId }: { name: string; code: string; productId: string }) {
  const [open, setOpen] = useState(false);
  const [row, setRow] = useState<Details | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    fetch(`/api/admin/enrichment-records/${productId}`, { cache: "no-store", signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error(response.status === 403 ? "Oturumun sona ermiş olabilir. Yönetici hesabınla yeniden giriş yap." : "Kayıt ayrıntıları yüklenemedi.");
        return response.json() as Promise<Details>;
      }).then(value => { setError(""); setRow(value); }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Kayıt ayrıntıları yüklenemedi."); });
    return () => controller.abort();
  }, [open, productId, attempt]);
  const sourceUrl = row?.source_url;
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger render={<Button variant="outline" size="sm" aria-label={`${code} kayıt ayrıntıları`}/>}>Ayrıntı<ChevronRight data-icon="inline-end" aria-hidden="true"/></DialogTrigger>
    <DialogContent className="flex max-h-5/6 flex-col sm:max-w-4xl">
      <DialogHeader>
        <DialogTitle>{name || code}</DialogTitle>
        <DialogDescription>Kaynak ve takip · <span className="font-mono">{code}</span></DialogDescription>
      </DialogHeader>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto *:shrink-0">
        {error ? <Alert variant="destructive" role="alert"><CircleAlert aria-hidden="true"/><AlertTitle>Kayıt ayrıntıları alınamadı</AlertTitle><AlertDescription>{error}</AlertDescription><AlertAction><Button variant="outline" onClick={() => { setError(""); setAttempt(value => value + 1); }}>Tekrar dene</Button></AlertAction></Alert>
        : !row ? <div className="flex flex-col gap-2" role="status"><span className="sr-only">Kayıt ayrıntıları yükleniyor…</span><Skeleton className="h-40 w-full"/><Skeleton className="h-16 w-full"/></div>
        : <DetailsBody row={row}/>}
        {open && <EnrichmentVehicles productId={productId}/>}
      </div>
      <DialogFooter>
        {sourceUrl ? <Button variant="outline" nativeButton={false} render={<Link href={sourceUrl} target="_blank"/>}>{new URL(sourceUrl).hostname}<ArrowUpRight data-icon="inline-end" aria-hidden="true"/></Button>
          : row ? <span className="text-sm text-muted-foreground sm:mr-auto">Henüz kaynak verisi kaydedilmedi.</span> : null}
        <Button nativeButton={false} render={<Link href={productIdPath(productId)}/>}>Ürün sayfasını aç<ArrowUpRight data-icon="inline-end" aria-hidden="true"/></Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
