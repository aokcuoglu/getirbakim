"use client";

import { useId, useState } from "react";
import { Car, ChevronDown, CircleAlert, CircleCheck, Copy, Eye, EyeOff, GitMerge, Info, ListChecks, ListX, Plus, RotateCcw, Trash2, Undo2 } from "lucide-react";
import { addProductFitments, copyProductFitments, deleteProductFitment, removeProductFitment, undoProductFitmentBatch } from "@/app/yonetim/urunler/fitment-actions";
import { productFitmentAutomaticLimit, productFitmentBatch, productFitmentLimit } from "@/modules/admin/product-fitment-fields";
import type { FitmentVehicle, ProductFitments } from "@/modules/admin/product-fitment-store";
import type { CatalogVehicle } from "@/modules/store/vehicle-catalog";
import { formatNumber } from "@/modules/admin/format";
import { useVehicleCatalog } from "@/components/garage/use-vehicle-catalog";
import { useFitmentChange } from "@/components/admin/use-fitment-change";
import { OptionCombobox } from "@/components/admin/option-combobox";
import { StatusBadge } from "@/components/admin/status-badge";
import { ProductFitmentCopyDialog } from "@/components/admin/product-fitment-copy-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Row = FitmentVehicle & { status: "added" | "removed" | "automatic"; automatic: boolean; carried: boolean; id?: string };

// Automatic rows are shown this many at a time: a part can fit a thousand engine types.
const PAGE = 50;

const vehicleName = (vehicle: Pick<FitmentVehicle, "brand" | "model" | "engine">) => `${vehicle.brand} ${vehicle.model} ${vehicle.engine}`;
const years = (vehicle: Pick<FitmentVehicle, "from" | "to">) => `${vehicle.from} – ${vehicle.to ?? "…"}`;
const power = (vehicle: Pick<FitmentVehicle, "ps" | "kw" | "cc">) =>
  `${formatNumber(vehicle.ps)} PS / ${formatNumber(vehicle.kw)} kW${vehicle.cc ? ` · ${formatNumber(vehicle.cc)} cm³` : ""}`;

/**
 * Adds engine types to a product and removes automatic fitments from the store (#583). Every change goes through a
 * server action; the page refreshes with the stored list.
 */
export function ProductFitmentsManager({ productId, fitments }: { productId: string; fitments: ProductFitments }) {
  const { pending, result, setResult, mutate, working } = useFitmentChange();
  const [dialog, setDialog] = useState<"add" | "copy" | null>(null);
  // A new key per opening: the dialog starts without the last make, model and selection (or source and search).
  const [opened, setOpened] = useState(0);
  const [shown, setShown] = useState(PAGE);
  const full = fitments.rows.length >= productFitmentLimit;

  const automaticIds = new Set([...fitments.automatic.map(vehicle => vehicle.typeId), ...fitments.rows.filter(row => row.automatic).map(row => row.typeId)]);
  const decided = new Map(fitments.rows.map(row => [row.typeId, row.mode]));
  // Fixed display order (added, removed, automatic), so a refresh after a change never moves rows under the pointer.
  const decisions: Row[] = [
    ...fitments.rows.filter(row => row.mode === "add").map(row => ({ ...row, status: "added" as const })),
    ...fitments.rows.filter(row => row.mode === "remove").map(row => ({ ...row, status: "removed" as const })),
  ];
  const automatic: Row[] = fitments.automatic.filter(vehicle => !decided.has(vehicle.typeId))
    .map(vehicle => ({ ...vehicle, status: "automatic" as const, automatic: true, carried: false }));
  const rows = [...decisions, ...automatic.slice(0, shown)];
  const hidden = automatic.length - Math.min(shown, automatic.length);
  const openDialog = (next: "add" | "copy") => { setResult(null); setOpened(count => count + 1); setDialog(next); };
  const closeDialog = (open: boolean) => { if (!open) { setDialog(null); setResult(null); } };
  const dialogError = dialog && result?.status === "error" ? result.message : null;

  return <div className="flex flex-col gap-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-muted-foreground">
        {formatNumber(fitments.automaticTotal)} otomatik uyum · {formatNumber(decisions.filter(row => row.status === "added").length)} elle eklenen · {formatNumber(decisions.filter(row => row.status === "removed").length)} mağazadan çıkarılan
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={pending || full} onClick={() => openDialog("copy")}>
          <Copy data-icon="inline-start" aria-hidden="true"/>Başka üründen kopyala</Button>
        <Button type="button" disabled={pending || full} onClick={() => openDialog("add")}>
          <Plus data-icon="inline-start" aria-hidden="true"/>Araç ekle</Button>
      </div>
    </div>
    {full && <Alert variant="warning"><CircleAlert aria-hidden="true"/><AlertDescription>Bu ürün {formatNumber(productFitmentLimit)} araç kararı sınırına ulaştı; yeni karar için önce birini geri alın.</AlertDescription></Alert>}
    {fitments.automaticTotal > productFitmentAutomaticLimit && <Alert variant="info"><Info aria-hidden="true"/><AlertDescription>
      Ürün {formatNumber(fitments.automaticTotal)} otomatik araç tipine bağlı; burada marka ve model sırasıyla ilk {formatNumber(productFitmentAutomaticLimit)} tanesi listeleniyor. Listede olmayan bir tipi “Araç ekle” ile seçip ekleyebilirsiniz.</AlertDescription></Alert>}

    <div aria-live="polite" className="empty:hidden">
      {/* A bulk add or copy can be taken back at once (#817); the undo's own result offers nothing more. */}
      {result?.status === "success" && <Alert variant="success"><CircleCheck aria-hidden="true"/><AlertDescription>{result.message}</AlertDescription>
        {result.undo && <div className="mt-2 flex"><Button type="button" variant="outline" size="sm" disabled={pending}
          aria-label={`Az önce eklenen ${formatNumber(result.undo.count)} araç tipini geri al`}
          onClick={() => { const batchId = result.undo?.batchId; if (batchId) mutate(() => undoProductFitmentBatch({ productId, batchId })); }}>
          <Undo2 data-icon="inline-start" aria-hidden="true"/>Geri al</Button></div>}</Alert>}
    </div>
    {/* While a dialog is open, its own alert shows the error. */}
    {result?.status === "error" && !dialog && <Alert variant="destructive" role="alert"><CircleAlert aria-hidden="true"/><AlertDescription>{result.message}</AlertDescription></Alert>}

    {/* No table search or filter: they would only see the rows "Daha fazla göster" has revealed. */}
    {rows.length ? <Table controls={false}><caption className="sr-only">Araç uyumu</caption>
      <TableHeader><TableRow><TableHead>Marka</TableHead><TableHead>Model</TableHead><TableHead>Motor</TableHead><TableHead>Güç / hacim</TableHead>
        <TableHead>Üretim</TableHead><TableHead>Durum</TableHead><TableHead><span className="sr-only">İşlem</span></TableHead></TableRow></TableHeader>
      <TableBody>{rows.map(row => {
        const name = vehicleName(row), rowKey = row.id ?? `a|${row.typeId}`;
        return <TableRow key={rowKey}>
          <TableCell>{row.brand}</TableCell>
          <TableCell>{row.model}</TableCell>
          <TableCell><div className="flex flex-col gap-1"><span>{row.engine}</span><span className="text-muted-foreground">{row.fuel} · tip {row.typeId}</span></div></TableCell>
          <TableCell className="tabular-nums">{power(row)}</TableCell>
          <TableCell className="tabular-nums">{years(row)}</TableCell>
          <TableCell><div className="flex flex-wrap gap-1">
            {row.status === "added" && <StatusBadge tone="success">Elle eklendi</StatusBadge>}
            {row.status === "removed" && <StatusBadge tone="warning" icon={EyeOff}>Mağazadan çıkarıldı</StatusBadge>}
            {row.status === "automatic" && <StatusBadge tone="neutral">Otomatik</StatusBadge>}
            {row.status === "added" && row.automatic && <StatusBadge tone="neutral">Otomatik kaynakta da var</StatusBadge>}
            {row.status === "removed" && !row.automatic && <StatusBadge tone="neutral">Otomatik kaynakta artık yok</StatusBadge>}
            {row.carried && <StatusBadge tone="info" icon={GitMerge}>Birleştirmeden taşındı</StatusBadge>}
          </div></TableCell>
          <TableCell><div className="flex flex-wrap justify-end gap-2">
            {row.status === "automatic" && <Button type="button" variant="outline" disabled={pending || full}
              aria-label={`${name} uyumunu mağazadan çıkar`} onClick={() => mutate(() => removeProductFitment({ productId, vehicleTypeId: row.typeId }), undefined, rowKey)}>
              {working(rowKey) ? <Spinner data-icon="inline-start"/> : <EyeOff data-icon="inline-start" aria-hidden="true"/>}Çıkar</Button>}
            {row.status === "removed" && row.id && <Button type="button" variant="outline" disabled={pending}
              aria-label={`${name} uyumunu yeniden göster`} onClick={() => mutate(() => deleteProductFitment({ productId, rowId: row.id!, restored: true }), undefined, rowKey)}>
              {working(rowKey) ? <Spinner data-icon="inline-start"/> : <Eye data-icon="inline-start" aria-hidden="true"/>}Yeniden göster</Button>}
            {row.status === "added" && row.id && <Button type="button" variant="outline" disabled={pending}
              aria-label={`${name} aracını kaldır`} onClick={() => mutate(() => deleteProductFitment({ productId, rowId: row.id! }), undefined, rowKey)}>
              {working(rowKey) ? <Spinner data-icon="inline-start"/> : <Trash2 data-icon="inline-start" aria-hidden="true"/>}Kaldır</Button>}
          </div></TableCell>
        </TableRow>;
      })}</TableBody></Table>
      : <Empty><EmptyHeader><EmptyMedia variant="icon"><Car/></EmptyMedia><EmptyTitle>Araç uyumu yok</EmptyTitle>
        <EmptyDescription>Bu ürünün otomatik araç uyumu yok; “Araç ekle” ile motor tipi seçerek ekleyebilirsiniz.</EmptyDescription></EmptyHeader></Empty>}
    {hidden > 0 && <div className="flex justify-center">
      <Button type="button" variant="outline" onClick={() => setShown(count => count + PAGE)}>
        <ChevronDown data-icon="inline-start" aria-hidden="true"/>Daha fazla göster ({formatNumber(hidden)} otomatik uyum daha)</Button>
    </div>}

    <AddFitmentsDialog key={`add|${opened}`} open={dialog === "add"} pending={pending} decided={decided} automaticIds={automaticIds}
      remaining={productFitmentLimit - fitments.rows.length} error={dialog === "add" ? dialogError : null} onOpenChange={closeDialog}
      onAdd={ids => mutate(() => addProductFitments({ productId, vehicleTypeIds: ids }), () => setDialog(null))}/>
    <ProductFitmentCopyDialog key={`copy|${opened}`} productId={productId} open={dialog === "copy"} pending={pending}
      error={dialog === "copy" ? dialogError : null} onOpenChange={closeDialog} onClearError={() => setResult(null)}
      onCopy={(sourceId, expected) => mutate(() => copyProductFitments({ productId, sourceId, expected }), () => setDialog(null))}/>
  </div>;
}

/** Make → model → engine types (several at once) from the store's vehicle catalog (/api/vehicles). */
function AddFitmentsDialog({ open, pending, decided, automaticIds, remaining, error, onOpenChange, onAdd }: {
  open: boolean; pending: boolean; decided: ReadonlyMap<number, "add" | "remove">; automaticIds: ReadonlySet<number>;
  /** Decisions the product can still take (productFitmentLimit). */
  remaining: number; error: string | null;
  onOpenChange: (open: boolean) => void; onAdd: (ids: number[]) => void;
}) {
  const ids = { brand: useId(), model: useId(), selection: useId() };
  const [brandId, setBrandId] = useState("");
  const [modelId, setModelId] = useState("");
  // Kept across models: types of several series can be added in one go.
  const [selected, setSelected] = useState<Map<number, string>>(new Map());
  const brands = useVehicleCatalog(open ? "/api/vehicles" : null);
  const models = useVehicleCatalog(open && brandId ? `/api/vehicles?brandId=${encodeURIComponent(brandId)}` : null);
  const vehicles = useVehicleCatalog(open && modelId ? `/api/vehicles?modelId=${encodeURIComponent(modelId)}` : null);
  const brandOptions = (brands.data?.brands ?? []).map(brand => ({ value: brand.id, label: brand.name }));
  const modelOptions = (models.data?.models ?? []).map(model => ({ value: model.id,
    label: model.dateFrom ? `${model.name} (${model.dateFrom.slice(0, 4)}–${model.dateTo?.slice(0, 4) ?? ""})` : model.name }));
  // One batch at most, and no more than the product's remaining decisions.
  const capacity = Math.max(0, Math.min(productFitmentBatch, remaining));
  const full = selected.size >= capacity;
  const modelVehicles = modelId ? vehicles.data?.vehicles ?? [] : [];
  // "Modelin tüm tiplerini seç" skips decided and automatic types: an automatic type is pinned one by one.
  const selectable = modelVehicles.filter(vehicle => !decided.has(Number(vehicle.id)) && !automaticIds.has(Number(vehicle.id)));
  const unselected = selectable.filter(vehicle => !selected.has(Number(vehicle.id)));
  const selectedInModel = modelVehicles.filter(vehicle => selected.has(Number(vehicle.id))).length;

  const toggle = (vehicle: CatalogVehicle, checked: boolean) => setSelected(current => {
    const next = new Map(current);
    if (checked) next.set(Number(vehicle.id), `${vehicle.make} ${vehicle.model} ${vehicle.engine}`);
    else next.delete(Number(vehicle.id));
    return next;
  });
  const selectModel = () => setSelected(current => {
    const next = new Map(current);
    for (const vehicle of unselected.slice(0, Math.max(0, capacity - current.size))) next.set(Number(vehicle.id), `${vehicle.make} ${vehicle.model} ${vehicle.engine}`);
    return next;
  });
  const clearModel = () => setSelected(current => {
    const next = new Map(current);
    for (const vehicle of modelVehicles) next.delete(Number(vehicle.id));
    return next;
  });
  const failure = (state: { error?: string; retry: () => void }) => state.error && <Alert variant="destructive" role="alert"><CircleAlert aria-hidden="true"/>
    <AlertDescription className="flex flex-wrap items-center gap-2">{state.error}
      <Button type="button" variant="outline" size="sm" onClick={state.retry}><RotateCcw data-icon="inline-start" aria-hidden="true"/>Tekrar dene</Button></AlertDescription></Alert>;

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-5/6 overflow-y-auto sm:max-w-3xl">
      <DialogHeader><DialogTitle>Araç ekle</DialogTitle>
        <DialogDescription>Markayı ve modeli seçin, ürünün uyduğu motor tiplerini işaretleyin. Bir seferde en çok {formatNumber(capacity)} tip eklenir{capacity < productFitmentBatch ? " (ürünün kalan karar hakkı)" : ""}; farklı modellerden seçim yapabilirsiniz.</DialogDescription></DialogHeader>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor={ids.brand}>Marka</FieldLabel>
          {brands.loading ? <Skeleton className="h-8 w-full"/> : failure(brands) || <OptionCombobox id={ids.brand} name="brand" placeholder="Marka ara" emptyText="Marka bulunamadı."
            options={brandOptions} value={brandId} onValueChange={value => { setBrandId(value); setModelId(""); }}/>}
        </Field>
        <Field>
          <FieldLabel htmlFor={ids.model}>Model</FieldLabel>
          {!brandId ? <FieldDescription>Önce markayı seçin.</FieldDescription>
            : models.loading ? <Skeleton className="h-8 w-full"/>
            : failure(models) || <OptionCombobox id={ids.model} name="model" placeholder="Model ara" emptyText="Model bulunamadı."
              options={modelOptions} value={modelId} onValueChange={setModelId}/>}
        </Field>
      </div>
      {modelId && (vehicles.loading ? <div className="flex flex-col gap-2"><Skeleton className="h-8 w-full"/><Skeleton className="h-8 w-full"/><Skeleton className="h-8 w-full"/></div>
        : failure(vehicles) || (!vehicles.data?.vehicles?.length ? <Empty><EmptyHeader><EmptyMedia variant="icon"><Car/></EmptyMedia>
          <EmptyTitle>Bu model için motor tipi bulunamadı</EmptyTitle><EmptyDescription>Başka bir model seçin.</EmptyDescription></EmptyHeader></Empty>
        : <><div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" disabled={pending || full || !unselected.length} onClick={selectModel}>
              <ListChecks data-icon="inline-start" aria-hidden="true"/>Modelin tüm tiplerini seç ({formatNumber(selectable.length)})</Button>
            <Button type="button" variant="outline" size="sm" disabled={pending || !selectedInModel} onClick={clearModel}>
              <ListX data-icon="inline-start" aria-hidden="true"/>Bu modelin seçimini kaldır</Button>
          </div>
          <p className="text-muted-foreground">Kararı olan ve otomatik uyumlu tipler atlanır; otomatik bir tipi sabitlemek için tek tek işaretleyin.</p>
          {full && unselected.length > 0 && <p className="text-muted-foreground">Seçim sınırı doldu: bu modelin seçilebilir {formatNumber(selectable.length)} tipinden {formatNumber(selectable.length - unselected.length)} tanesi seçildi.</p>}
        </div>
        <Table controls={false}><caption className="sr-only">Motor tipleri</caption>
          <TableHeader><TableRow><TableHead><span className="sr-only">Seç</span></TableHead><TableHead>Motor</TableHead><TableHead>Yakıt</TableHead>
            <TableHead>Güç</TableHead><TableHead>Üretim</TableHead><TableHead>Durum</TableHead></TableRow></TableHeader>
          <TableBody>{(vehicles.data?.vehicles ?? []).map(vehicle => {
            const id = Number(vehicle.id), decision = decided.get(id), checked = selected.has(id);
            return <TableRow key={vehicle.id}>
              <TableCell><Checkbox checked={checked} disabled={pending || Boolean(decision) || (full && !checked)}
                aria-label={`${vehicle.make} ${vehicle.model} ${vehicle.engine} (${vehicle.dateFrom.slice(0, 4)}) seç`} onCheckedChange={value => toggle(vehicle, value)}/></TableCell>
              <TableCell>{vehicle.engine}</TableCell>
              <TableCell>{vehicle.fuel}</TableCell>
              <TableCell className="tabular-nums">{vehicle.power}{vehicle.cc ? ` · ${formatNumber(vehicle.cc)} cm³` : ""}</TableCell>
              <TableCell className="tabular-nums">{vehicle.from} – {vehicle.dateTo ? vehicle.to : "…"}</TableCell>
              <TableCell>{decision === "add" ? <StatusBadge tone="success">Elle eklendi</StatusBadge>
                : decision === "remove" ? <StatusBadge tone="warning" icon={EyeOff}>Mağazadan çıkarıldı</StatusBadge>
                : automaticIds.has(id) ? <StatusBadge tone="neutral">Otomatik</StatusBadge> : null}</TableCell>
            </TableRow>;
          })}</TableBody></Table></>))}
      <p id={ids.selection} className="text-muted-foreground" aria-live="polite">
        {selected.size ? `${formatNumber(selected.size)} araç tipi seçildi: ${[...selected.values()].slice(0, 3).join(", ")}${selected.size > 3 ? ` ve ${formatNumber(selected.size - 3)} tip daha` : ""}.` : "Henüz araç tipi seçilmedi."}
        {full && ` En çok ${formatNumber(capacity)} tip seçilebilir.`}
      </p>
      {error && <Alert variant="destructive" role="alert"><CircleAlert aria-hidden="true"/><AlertDescription>{error}</AlertDescription></Alert>}
      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline"/>}>Vazgeç</DialogClose>
        <Button type="button" disabled={pending || !selected.size} aria-describedby={ids.selection} onClick={() => onAdd([...selected.keys()])}>
          {pending ? <><Spinner data-icon="inline-start"/>Ekleniyor…</> : <><Plus data-icon="inline-start" aria-hidden="true"/>Seçilenleri ekle</>}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
