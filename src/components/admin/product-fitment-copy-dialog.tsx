"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, CircleAlert, Copy, Info, Link2, RotateCcw, Search, TriangleAlert } from "lucide-react";
import type { FitmentCopyPreview, FitmentCopySource } from "@/modules/admin/product-fitment-copy";
import { formatNumber } from "@/modules/admin/format";
import { StatusBadge } from "@/components/admin/status-badge";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Sources = { q: string; sources: FitmentCopySource[] };
/** A response kept with the request it answers: a newer request shows the loading state, never an older answer. */
type Loaded<T> = { key: string; data?: T; error?: string };

/** Reads `url` while `key` is set; a new key (a new query, product or retry) starts a new request. */
function useAdminJson<T>(url: string | null, key: string, failure: string) {
  const [state, setState] = useState<Loaded<T> | null>(null);
  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    fetch(url, { cache: "no-store", signal: controller.signal })
      .then(async response => {
        if (response.status === 403) throw new Error("Oturumunuz sona ermiş olabilir. Yönetici hesabınızla yeniden giriş yapın.");
        if (!response.ok) throw new Error(((await response.json().catch(() => null)) as { error?: string } | null)?.error ?? failure);
        return response.json() as Promise<T>;
      })
      .then(data => setState({ key, data }))
      .catch(reason => { if (!controller.signal.aborted) setState({ key, error: reason instanceof Error ? reason.message : failure }); });
    return () => controller.abort();
  }, [url, key, failure]);
  return url && state?.key === key ? state : null;
}

const years = (vehicle: { from: string; to: string | null }) => `${vehicle.from} – ${vehicle.to ?? "…"}`;

/**
 * "Başka üründen kopyala" (#662): pick a product (its linked equivalents first, or a part number, supplier code or OEM
 * search), see what its vehicle fitments would add here, then copy them as added types in one change.
 */
export function ProductFitmentCopyDialog({ productId, open, pending, error, onOpenChange, onCopy, onClearError }: {
  productId: string; open: boolean; pending: boolean; error: string | null;
  onOpenChange: (open: boolean) => void; onCopy: (sourceId: string, expected: number) => void;
  /** Clears the last copy error (another source or back to the search). */
  onClearError: () => void;
}) {
  const ids = { query: useId(), summary: useId() };
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const searchInput = useRef<HTMLInputElement>(null);
  // A refused copy (stale counts, the limit) reloads the preview, so it shows what a new attempt would write.
  const [seenError, setSeenError] = useState(error);
  if (error !== seenError) {
    setSeenError(error);
    if (error && sourceId) setAttempt(value => value + 1);
  }
  // Back on the search step, focus returns to the search field.
  useEffect(() => { if (!sourceId) searchInput.current?.focus(); }, [sourceId]);
  const base = `/api/admin/product-fitment-copy/${encodeURIComponent(productId)}`;
  const list = useAdminJson<Sources>(open && !sourceId ? `${base}?q=${encodeURIComponent(submitted)}` : null,
    `list|${submitted}|${attempt}`, "Ürünler yüklenemedi.");
  const preview = useAdminJson<FitmentCopyPreview>(open && sourceId ? `${base}?source=${encodeURIComponent(sourceId)}` : null,
    `preview|${sourceId}|${attempt}`, "Kopyalama önizlemesi yüklenemedi.");
  const retry = () => setAttempt(value => value + 1);
  const search = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // The same query again reloads the list.
    if (query.trim() === submitted) retry(); else setSubmitted(query.trim());
  };
  const showSource = (id: string | null) => { onClearError(); setSourceId(id); };

  const failure = (message: string, title: string) => <Alert variant="destructive" role="alert"><CircleAlert aria-hidden="true"/>
    <AlertTitle>{title}</AlertTitle><AlertDescription>{message}</AlertDescription>
    <AlertAction><Button type="button" variant="outline" onClick={retry}><RotateCcw data-icon="inline-start" aria-hidden="true"/>Tekrar dene</Button></AlertAction></Alert>;
  const loading = <div className="flex flex-col gap-2" role="status"><span className="sr-only">Yükleniyor…</span>
    <Skeleton className="h-8 w-full"/><Skeleton className="h-8 w-full"/><Skeleton className="h-8 w-full"/></div>;

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-5/6 overflow-y-auto sm:max-w-3xl">
      <DialogHeader><DialogTitle>Başka üründen kopyala</DialogTitle>
        <DialogDescription>Araç uyumunu kopyalayacağınız ürünü seçin. Kaynağın mağazada gösterdiği araç tipleri bu ürüne elle eklenmiş olarak yazılır; kaynağın mağazadan çıkardığı araçlar ve kaynak satırları kopyalanmaz.</DialogDescription></DialogHeader>

      {!sourceId ? <>
        <form className="flex flex-col gap-2" role="search" onSubmit={search}>
          <Field>
            <FieldLabel htmlFor={ids.query}>Parça no, tedarikçi kodu veya OEM</FieldLabel>
            <div className="flex flex-col gap-2 sm:flex-row">
              <InputGroup>
                <InputGroupAddon><Search aria-hidden="true"/></InputGroupAddon>
                <InputGroupInput ref={searchInput} id={ids.query} type="search" autoComplete="off" spellCheck={false} maxLength={100} value={query}
                  aria-describedby={`${ids.query}-description`} onChange={event => setQuery(event.target.value)}/>
              </InputGroup>
              <Button type="submit" variant="outline" className="w-full sm:w-auto" disabled={!list}><Search data-icon="inline-start" aria-hidden="true"/>Ara</Button>
            </div>
            <FieldDescription id={`${ids.query}-description`}>Boş arama bu ürüne bağlı muadilleri listeler. En az 3 karakter girin; OEM numarasıyla arama en az 5 karakter ve bir rakam ister.</FieldDescription>
          </Field>
        </form>
        {!list ? loading
          : list.error ? failure(list.error, "Ürünler alınamadı")
          : !list.data?.sources.length ? <Empty><EmptyHeader><EmptyMedia variant="icon"><Search/></EmptyMedia>
            <EmptyTitle>{!list.data?.q ? "Bağlı muadil yok" : list.data.q.length < 3 ? "Arama çok kısa" : "Ürün bulunamadı"}</EmptyTitle>
            <EmptyDescription>{!list.data?.q ? "Bu ürüne bağlı muadil ürün yok; parça no, tedarikçi kodu veya OEM numarasıyla arayın."
              : list.data.q.length < 3 ? "En az 3 harf veya rakam girin." : "Başka bir numarayla yeniden arayın."}</EmptyDescription></EmptyHeader></Empty>
          : <Table controls={false}><caption className="sr-only">{list.data.q ? "Arama sonuçları" : "Bağlı muadiller"}</caption>
            <TableHeader><TableRow><TableHead>Marka</TableHead><TableHead>Kod</TableHead><TableHead>Ad</TableHead><TableHead>Durum</TableHead>
              <TableHead><span className="sr-only">İşlem</span></TableHead></TableRow></TableHeader>
            <TableBody>{list.data.sources.map(source => <TableRow key={source.id}>
              <TableCell>{source.brand_label}</TableCell>
              <TableCell className="font-mono">{source.code}</TableCell>
              <TableCell className="max-w-64 truncate" title={source.name ?? ""}>{source.name || "—"}</TableCell>
              <TableCell>{source.equivalent ? <StatusBadge tone="info" icon={Link2}>Muadil</StatusBadge> : <span className="text-muted-foreground">—</span>}</TableCell>
              <TableCell><div className="flex justify-end">
                <Button type="button" variant="outline" size="sm" aria-label={`${source.brand_label} ${source.code} ürününden kopyala`}
                  onClick={() => showSource(source.id)}>Seç</Button></div></TableCell>
            </TableRow>)}</TableBody></Table>}
        <DialogFooter><DialogClose render={<Button type="button" variant="outline"/>}>Vazgeç</DialogClose></DialogFooter>
      </> : <>
        {!preview ? loading
          : preview.error ? failure(preview.error, "Önizleme alınamadı")
          : preview.data && <CopyPreview preview={preview.data} summaryId={ids.summary}/>}
        {error && <Alert variant="destructive" role="alert"><CircleAlert aria-hidden="true"/><AlertDescription>{error}</AlertDescription></Alert>}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={pending} onClick={() => showSource(null)}><ArrowLeft data-icon="inline-start" aria-hidden="true"/>Geri</Button>
          <Button type="button" aria-describedby={ids.summary}
            disabled={pending || !preview?.data || preview.data.exceeds || !preview.data.addCount}
            onClick={() => preview?.data && onCopy(preview.data.source.id, preview.data.addCount)}>
            {pending ? <><Spinner data-icon="inline-start"/>Kopyalanıyor…</>
              : <><Copy data-icon="inline-start" aria-hidden="true"/>{preview?.data ? `${formatNumber(preview.data.addCount)} araç tipini kopyala` : "Kopyala"}</>}</Button>
        </DialogFooter>
      </>}
    </DialogContent>
  </Dialog>;
}

function CopyPreview({ preview, summaryId }: { preview: FitmentCopyPreview; summaryId: string }) {
  const { source, skipped, addCount } = preview;
  // The preview step starts on its summary: screen readers read the counts, Tab continues from there.
  const summary = useRef<HTMLDivElement>(null);
  useEffect(() => { summary.current?.focus(); }, []);
  const more = addCount - preview.add.length;
  return <div className="flex min-w-0 flex-col gap-4">
    <div className="flex flex-col gap-1">
      <p className="font-medium">{source.brand_label} <span className="font-mono">{source.code}</span></p>
      {source.name && <p className="truncate text-muted-foreground" title={source.name}>{source.name}</p>}
      <p className="text-muted-foreground">Kaynak üründe mağazada gösterilen {formatNumber(preview.total)} araç tipi var.</p>
    </div>
    <Alert ref={summary} tabIndex={-1} role="status" variant={addCount ? "info" : "warning"} id={summaryId}>{addCount ? <Info aria-hidden="true"/> : <TriangleAlert aria-hidden="true"/>}
      <AlertDescription>{addCount ? `${formatNumber(addCount)} araç tipi eklenecek.` : "Kaynak üründe bu ürüne eklenecek yeni araç tipi yok."} Atlanan: {formatNumber(skipped.added)} zaten elle ekli, {formatNumber(skipped.removed)} mağazadan çıkarılmış, {formatNumber(skipped.automatic)} zaten otomatik uyumlu.</AlertDescription></Alert>
    {addCount > 0 && !preview.targetHasDecisions && <Alert variant="info"><Info aria-hidden="true"/>
      <AlertDescription>Bu üründe henüz araç kararı yok: ilk karar eklenince mağaza bu üründe model düzeyi listeleri (kaynak model listesi, açıklamadan okunan modeller) kullanmayı bırakır.</AlertDescription></Alert>}
    {preview.exceeds && <Alert variant="warning"><TriangleAlert aria-hidden="true"/>
      <AlertDescription>Kaynakta eklenecek {formatNumber(addCount)} tip var; bu üründe kalan karar hakkı {formatNumber(preview.remaining)}. Önce kararları azaltın ya da modelleri “Araç ekle” ile seçin.</AlertDescription></Alert>}
    {addCount > 0 && <>
      <Table controls={false}><caption className="sr-only">Eklenecek araç tipleri</caption>
        <TableHeader><TableRow><TableHead>Marka</TableHead><TableHead>Model</TableHead><TableHead>Motor</TableHead><TableHead>Üretim</TableHead></TableRow></TableHeader>
        <TableBody>{preview.add.map(vehicle => <TableRow key={vehicle.typeId}>
          <TableCell>{vehicle.brand}</TableCell>
          <TableCell>{vehicle.model}</TableCell>
          <TableCell><div className="flex flex-col gap-1"><span>{vehicle.engine}</span><span className="text-muted-foreground">{vehicle.fuel} · tip {vehicle.typeId}</span></div></TableCell>
          <TableCell className="tabular-nums">{years(vehicle)}</TableCell>
        </TableRow>)}</TableBody></Table>
      {more > 0 && <p className="text-muted-foreground">ve {formatNumber(more)} tip daha</p>}
    </>}
  </div>;
}
