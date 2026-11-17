"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, ChevronDown, ChevronRight, CircleAlert, Copy, Info, Link2, ListChecks, ListX, RotateCcw, Search, TriangleAlert } from "lucide-react";
import type { FitmentCopyGroup, FitmentCopyPreview, FitmentCopySource } from "@/modules/admin/product-fitment-copy";
import { fitmentSourceLabel } from "@/modules/admin/product-fitment-fields";
import { formatNumber } from "@/modules/admin/format";
import { StatusBadge } from "@/components/admin/status-badge";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { ScrollArea } from "@/components/ui/scroll-area";
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
const typeCount = (groups: readonly FitmentCopyGroup[]) => groups.reduce((sum, group) => sum + group.count, 0);

/** A make's models with new types in the copy, in the preview's order. */
type BrandGroup = { brandId: number; brand: string; models: FitmentCopyGroup[]; count: number };
function brandGroups(groups: readonly FitmentCopyGroup[]): BrandGroup[] {
  const brands = new Map<number, BrandGroup>();
  for (const group of groups) {
    const brand = brands.get(group.brandId);
    if (brand) { brand.models.push(group); brand.count += group.count; }
    else brands.set(group.brandId, { brandId: group.brandId, brand: group.brand, models: [group], count: group.count });
  }
  return [...brands.values()];
}

/** The source as "<brand> <code>"; the code alone when it starts with the brand (#869). */
function SourceName({ source }: { source: { brand_label: string; code: string } }) {
  return fitmentSourceLabel(source.brand_label, source.code) === source.code
    ? <span className="font-mono">{source.code}</span> : <>{source.brand_label} <span className="font-mono">{source.code}</span></>;
}

/**
 * "Başka üründen kopyala" (#662): pick a product (its linked equivalents first, or a part number, supplier code or OEM
 * search), see what its vehicle fitments would add here, choose the makes and models to copy (#815; all of them when
 * they fit the product's remaining decisions, none otherwise), then copy them as added types in one change.
 */
export function ProductFitmentCopyDialog({ productId, open, pending, error, onOpenChange, onCopy, onClearError }: {
  productId: string; open: boolean; pending: boolean; error: string | null;
  onOpenChange: (open: boolean) => void; onCopy: (sourceId: string, expected: number, modelIds: number[]) => void;
  /** Clears the last copy error (another source or back to the search). */
  onClearError: () => void;
}) {
  const ids = { query: useId(), summary: useId() };
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  // The chosen model ids; null until the admin changes the choice (then every model, or none when they do not fit).
  const [picked, setPicked] = useState<ReadonlySet<number> | null>(null);
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
  const showSource = (id: string | null) => { onClearError(); setPicked(null); setSourceId(id); };
  // A reloaded preview keeps the choice where its models still have new types.
  const data = preview?.data;
  const selected = !data ? [] : picked ? data.groups.filter(group => picked.has(group.modelId)) : data.exceeds ? [] : data.groups;
  const selectedCount = typeCount(selected);
  const over = Boolean(data && selectedCount > data.remaining);

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
                <Button type="button" variant="outline" size="sm" aria-label={`${fitmentSourceLabel(source.brand_label, source.code)} ürününden kopyala`}
                  onClick={() => showSource(source.id)}>Seç</Button></div></TableCell>
            </TableRow>)}</TableBody></Table>}
        <DialogFooter><DialogClose render={<Button type="button" variant="outline"/>}>Vazgeç</DialogClose></DialogFooter>
      </> : <>
        {!preview ? loading
          : preview.error ? failure(preview.error, "Önizleme alınamadı")
          : preview.data && <CopyPreview preview={preview.data} summaryId={ids.summary} selected={selected} disabled={pending}
            onChange={next => setPicked(next)}/>}
        {error && <Alert variant="destructive" role="alert"><CircleAlert aria-hidden="true"/><AlertDescription>{error}</AlertDescription></Alert>}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={pending} onClick={() => showSource(null)}><ArrowLeft data-icon="inline-start" aria-hidden="true"/>Geri</Button>
          <Button type="button" aria-describedby={ids.summary}
            disabled={pending || !data || !selectedCount || over}
            onClick={() => data && onCopy(data.source.id, selectedCount, selected.map(group => group.modelId))}>
            {pending ? <><Spinner data-icon="inline-start"/>Kopyalanıyor…</>
              : <><Copy data-icon="inline-start" aria-hidden="true"/>{data ? `${formatNumber(selectedCount)} araç tipini kopyala` : "Kopyala"}</>}</Button>
        </DialogFooter>
      </>}
    </DialogContent>
  </Dialog>;
}

function CopyPreview({ preview, summaryId, selected, disabled, onChange }: {
  preview: FitmentCopyPreview; summaryId: string;
  /** The chosen models (#815). */
  selected: readonly FitmentCopyGroup[]; disabled: boolean;
  onChange: (modelIds: ReadonlySet<number>) => void;
}) {
  const { source, skipped, addCount, groups } = preview;
  // The preview step starts on its summary: screen readers read the counts, Tab continues from there.
  const summary = useRef<HTMLDivElement>(null);
  useEffect(() => { summary.current?.focus(); }, []);
  const brands = brandGroups(groups);
  // A short list starts open; a long one by make, its models a click away.
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set(groups.length <= 20 ? brands.map(brand => brand.brandId) : []));
  const chosen = new Set(selected.map(group => group.modelId));
  const selectedCount = typeCount(selected);
  const over = selectedCount > preview.remaining;
  const shown = preview.add.filter(vehicle => chosen.has(vehicle.modelId));
  const more = selectedCount - shown.length;

  const setModels = (modelIds: readonly number[], checked: boolean) => {
    const next = new Set(chosen);
    for (const id of modelIds) { if (checked) next.add(id); else next.delete(id); }
    onChange(next);
  };
  const toggleBrand = (brandId: number) => setExpanded(current => {
    const next = new Set(current);
    if (next.has(brandId)) next.delete(brandId); else next.add(brandId);
    return next;
  });

  return <div className="flex min-w-0 flex-col gap-4">
    <div className="flex flex-col gap-1">
      <p className="font-medium"><SourceName source={source}/></p>
      {source.name && <p className="truncate text-muted-foreground" title={source.name}>{source.name}</p>}
      <p className="text-muted-foreground">Kaynak üründe mağazada gösterilen {formatNumber(preview.total)} araç tipi var.</p>
    </div>
    <Alert ref={summary} tabIndex={-1} role="status" variant={addCount ? "info" : "warning"} id={summaryId}>{addCount ? <Info aria-hidden="true"/> : <TriangleAlert aria-hidden="true"/>}
      <AlertDescription>{addCount ? `${formatNumber(selectedCount)} araç tipi eklenecek.` : "Kaynak üründe bu ürüne eklenecek yeni araç tipi yok."}</AlertDescription></Alert>
    <p className="text-muted-foreground">Atlanan: {formatNumber(skipped.added)} araç tipi zaten elle ekli, {formatNumber(skipped.removed)} mağazadan çıkarılmış, {formatNumber(skipped.automatic)} zaten otomatik uyumlu.</p>
    {addCount > 0 && !preview.targetHasDecisions && <Alert variant="info"><Info aria-hidden="true"/>
      <AlertDescription>Bu üründe henüz araç kararı yok: ilk karar eklenince mağaza bu üründe model düzeyi listeleri (kaynak model listesi, açıklamadan okunan modeller) kullanmayı bırakır.</AlertDescription></Alert>}
    {preview.exceeds && !selectedCount && <Alert variant="info"><Info aria-hidden="true"/>
      <AlertDescription>Kaynakta eklenecek {formatNumber(addCount)} araç tipi var; bu üründe kalan karar hakkı {formatNumber(preview.remaining)}. Kopyalanacak marka ve modelleri seçin.</AlertDescription></Alert>}
    {over && <Alert variant="warning"><TriangleAlert aria-hidden="true"/>
      <AlertDescription>Seçilen {formatNumber(selectedCount)} araç tipi kalan karar hakkını ({formatNumber(preview.remaining)}) aşıyor; seçimi azaltın.</AlertDescription></Alert>}
    {addCount > 0 && <>
      <div className="flex flex-col gap-2">
        <h3 className="font-medium">Kopyalanacak modeller <span className="font-normal text-muted-foreground tabular-nums">({formatNumber(selected.length)} / {formatNumber(groups.length)} seçili)</span></h3>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" disabled={disabled || selected.length === groups.length}
            onClick={() => setModels(groups.map(group => group.modelId), true)}>
            <ListChecks data-icon="inline-start" aria-hidden="true"/>Tümünü seç ({formatNumber(groups.length)} model)</Button>
          <Button type="button" variant="outline" size="sm" disabled={disabled || !selected.length} onClick={() => onChange(new Set())}>
            <ListX data-icon="inline-start" aria-hidden="true"/>Seçimi temizle</Button>
        </div>
      </div>
      {/* A long tree scrolls on its own: the summary and the copy button stay in reach (mobile). */}
      <ScrollArea className={groups.length > 8 ? "h-64" : undefined}>
      <Table controls={false}><caption className="sr-only">Kopyalanacak marka ve modeller</caption>
        <TableHeader><TableRow><TableHead><span className="sr-only">Seç</span></TableHead><TableHead>Marka / Model</TableHead><TableHead>Araç tipi</TableHead></TableRow></TableHeader>
        <TableBody>{brands.map(brand => {
          const open = expanded.has(brand.brandId);
          const models = brand.models.map(group => group.modelId);
          const picked = models.filter(id => chosen.has(id)).length;
          return [<TableRow key={`b|${brand.brandId}`}>
            <TableCell><Checkbox checked={picked === models.length} indeterminate={picked > 0 && picked < models.length} disabled={disabled}
              aria-label={`${brand.brand} markasının tüm modellerini seç`} onCheckedChange={value => setModels(models, value)}/></TableCell>
            <TableCell><div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{brand.brand}</span>
              <span className="text-muted-foreground tabular-nums">{formatNumber(picked)} / {formatNumber(models.length)} model seçili</span>
              <Button type="button" variant="ghost" size="sm" aria-expanded={open} onClick={() => toggleBrand(brand.brandId)}>
                {open ? <ChevronDown data-icon="inline-start" aria-hidden="true"/> : <ChevronRight data-icon="inline-start" aria-hidden="true"/>}
                {open ? "Modelleri gizle" : "Modelleri göster"}<span className="sr-only">: {brand.brand}</span></Button>
            </div></TableCell>
            <TableCell className="tabular-nums">{formatNumber(brand.count)}</TableCell>
          </TableRow>, ...(open ? brand.models.map(group => <TableRow key={`m|${group.modelId}`}>
            <TableCell className="pl-6"><Checkbox checked={chosen.has(group.modelId)} disabled={disabled}
              aria-label={`${group.brand} ${group.model} modelini seç (${formatNumber(group.count)} araç tipi)`} onCheckedChange={value => setModels([group.modelId], value)}/></TableCell>
            <TableCell className="pl-6">{group.model}</TableCell>
            <TableCell className="tabular-nums">{formatNumber(group.count)}</TableCell>
          </TableRow>) : [])];
        })}</TableBody></Table>
      </ScrollArea>
    </>}
    {shown.length > 0 && <ScrollArea className={shown.length > 8 ? "h-64" : undefined}>
      <Table controls={false}><caption className="sr-only">Eklenecek araç tipleri</caption>
        <TableHeader><TableRow><TableHead>Marka</TableHead><TableHead>Model</TableHead><TableHead>Motor</TableHead><TableHead>Üretim</TableHead></TableRow></TableHeader>
        <TableBody>{shown.map(vehicle => <TableRow key={vehicle.typeId}>
          <TableCell>{vehicle.brand}</TableCell>
          <TableCell>{vehicle.model}</TableCell>
          <TableCell><div className="flex flex-col gap-1"><span>{vehicle.engine}</span><span className="text-muted-foreground">{vehicle.fuel} · tip {vehicle.typeId}</span></div></TableCell>
          <TableCell className="tabular-nums">{years(vehicle)}</TableCell>
        </TableRow>)}</TableBody></Table>
    </ScrollArea>}
    {selectedCount > 0 && more > 0 && <p className="text-muted-foreground">{shown.length ? `ve ${formatNumber(more)} araç tipi daha` : `Seçilen ${formatNumber(selectedCount)} araç tipi önizlemenin ilk ${formatNumber(preview.add.length)} satırında değil; kopyalanınca araç uyumu listesinde görünür.`}</p>}
  </div>;
}
