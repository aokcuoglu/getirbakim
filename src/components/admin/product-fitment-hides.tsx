"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, CircleAlert, CircleCheck, Eye, EyeOff, GitMerge, Info } from "lucide-react";
import { hideProductFitment, showProductFitment } from "@/app/yonetim/urunler/fitment-actions";
import { productFitmentAutomaticLimit } from "@/modules/admin/product-fitment-fields";
import type { FitmentHide, FitmentHideTarget, OrphanHide, ProductFitmentSources } from "@/modules/admin/product-fitment-hide-store";
import { formatNumber } from "@/modules/admin/format";
import { StatusBadge } from "@/components/admin/status-badge";
import { useFitmentChange } from "@/components/admin/use-fitment-change";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

// Source rows are shown this many at a time: an enrichment can list hundreds of unlinked vehicles.
const PAGE = 50;

/**
 * The source rows no catalog type is linked to (#661): unlinked enrichment vehicles, the enrichment's model list and the
 * models read from supplier descriptions. Each can be left out of the store and shown again; every change goes through
 * a server action and the page refreshes with the stored list.
 */
export function ProductFitmentHidesManager({ productId, sources }: { productId: string; sources: ProductFitmentSources }) {
  const { pending, result, mutate, working } = useFitmentChange();
  const [shown, setShown] = useState(PAGE);
  const orphans = (kind: OrphanHide["kind"]) => sources.orphans.filter(row => row.kind === kind);
  // A hidden vehicle past the list's limit may still be in the source: only a complete list says it is gone.
  const vehicleListComplete = sources.vehiclesTotal <= productFitmentAutomaticLimit;
  const more = sources.vehicles.length - Math.min(shown, sources.vehicles.length);

  const hide = (target: FitmentHideTarget, rowKey: string) => mutate(() => hideProductFitment({ productId, target }), undefined, rowKey);
  const show = (rowId: string, rowKey: string) => mutate(() => showProductFitment({ productId, rowId }), undefined, rowKey);
  const status = (hidden: FitmentHide | null, unused = false) => <div className="flex flex-wrap gap-1">
    {hidden ? <StatusBadge tone="warning" icon={EyeOff}>Mağazadan çıkarıldı</StatusBadge>
      : <StatusBadge tone="neutral">{unused ? "Mağazada kullanılmıyor" : "Mağazada"}</StatusBadge>}
    {hidden?.carried && <StatusBadge tone="info" icon={GitMerge}>Birleştirmeden taşındı</StatusBadge>}
  </div>;
  const action = (hidden: FitmentHide | null, target: FitmentHideTarget, rowKey: string, name: string) => <div className="flex justify-end">
    {hidden ? <Button type="button" variant="outline" disabled={pending} aria-label={`${name} satırını yeniden göster`} onClick={() => show(hidden.id, rowKey)}>
      {working(rowKey) ? <Spinner data-icon="inline-start"/> : <Eye data-icon="inline-start" aria-hidden="true"/>}Yeniden göster</Button>
      : <Button type="button" variant="outline" disabled={pending} aria-label={`${name} satırını mağazadan çıkar`} onClick={() => hide(target, rowKey)}>
        {working(rowKey) ? <Spinner data-icon="inline-start"/> : <EyeOff data-icon="inline-start" aria-hidden="true"/>}Çıkar</Button>}
  </div>;
  // A hidden row its source no longer has: only "Yeniden göster" applies.
  const orphanRow = (row: OrphanHide, span: number, gone = true) => <TableRow key={row.id}>
    <TableCell colSpan={span}>{row.label}</TableCell>
    <TableCell><div className="flex flex-wrap gap-1">
      <StatusBadge tone="warning" icon={EyeOff}>Mağazadan çıkarıldı</StatusBadge>
      {gone && <StatusBadge tone="neutral">Kaynakta artık yok</StatusBadge>}
      {row.carried && <StatusBadge tone="info" icon={GitMerge}>Birleştirmeden taşındı</StatusBadge>}
    </div></TableCell>
    <TableCell><div className="flex justify-end">
      <Button type="button" variant="outline" disabled={pending} aria-label={`${row.label} satırını yeniden göster`} onClick={() => show(row.id, row.id)}>
        {working(row.id) ? <Spinner data-icon="inline-start"/> : <Eye data-icon="inline-start" aria-hidden="true"/>}Yeniden göster</Button>
    </div></TableCell>
  </TableRow>;

  const vehicleOrphans = orphans("source_vehicle"), modelOrphans = orphans("source_model"), descriptionOrphans = orphans("description_model");
  return <div className="flex flex-col gap-6">
    {sources.decided && <Alert variant="info"><Info aria-hidden="true"/><AlertDescription>Bu üründe araç kararı var; model düzeyi listeler mağazada kullanılmıyor.</AlertDescription></Alert>}
    <div aria-live="polite" className="empty:hidden">
      {result?.status === "success" && <Alert variant="success"><CircleCheck aria-hidden="true"/><AlertDescription>{result.message}</AlertDescription></Alert>}
    </div>
    {result?.status === "error" && <Alert variant="destructive" role="alert"><CircleAlert aria-hidden="true"/><AlertDescription>{result.message}</AlertDescription></Alert>}

    {(sources.vehicles.length > 0 || vehicleOrphans.length > 0) && <Section title="Bağlanmamış kaynak satırları"
      description={`Zenginleştirmenin katalogdaki hiçbir motor tipine bağlanamayan ${formatNumber(sources.vehiclesTotal)} araç satırı. Ürün sayfasında kaynaktaki yazılışıyla listelenir; araç süzgecini ve marka sayfalarını etkilemez.`}>
      {!vehicleListComplete && <Alert variant="info"><Info aria-hidden="true"/><AlertDescription>
        Burada ilk {formatNumber(productFitmentAutomaticLimit)} satır listeleniyor.</AlertDescription></Alert>}
      <Table controls={false}><caption className="sr-only">Bağlanmamış kaynak satırları</caption>
        <TableHeader><TableRow><TableHead>Model</TableHead><TableHead>Motor</TableHead><TableHead>Güç / hacim</TableHead><TableHead>Üretim</TableHead>
          <TableHead>Durum</TableHead><TableHead><span className="sr-only">İşlem</span></TableHead></TableRow></TableHeader>
        <TableBody>
          {sources.vehicles.slice(0, shown).map(row => {
            const rowKey = `v|${row.key}`;
            return <TableRow key={rowKey}>
              <TableCell>{row.model}</TableCell>
              <TableCell><div className="flex flex-col gap-1"><span>{row.engineAndCodes}</span>{row.fuel && <span className="text-muted-foreground">{row.fuel}</span>}</div></TableCell>
              <TableCell className="tabular-nums">{formatNumber(row.ps)} PS / {formatNumber(row.kw)} kW{row.cc ? ` · ${formatNumber(row.cc)} cm³` : ""}</TableCell>
              <TableCell className="tabular-nums">{row.from} – {row.to ?? "…"}</TableCell>
              <TableCell>{status(row.hidden)}</TableCell>
              <TableCell>{action(row.hidden, { kind: "source_vehicle", key: row.key }, rowKey, `${row.model} ${row.engineAndCodes}`)}</TableCell>
            </TableRow>;
          })}
          {vehicleOrphans.map(row => orphanRow(row, 4, vehicleListComplete))}
        </TableBody></Table>
      {more > 0 && <div className="flex justify-center">
        <Button type="button" variant="outline" onClick={() => setShown(count => count + PAGE)}>
          <ChevronDown data-icon="inline-start" aria-hidden="true"/>Daha fazla göster ({formatNumber(more)} satır daha)</Button>
      </div>}
    </Section>}

    {(sources.models.length > 0 || modelOrphans.length > 0) && <Section title="Kaynağın model listesi"
      description="Zenginleştirmenin motor tipi belirtmeden verdiği model adları. Ürün sayfasında ve arama sonucu açıklamasında uyumlu modeller olarak görünür.">
      <Table controls={false}><caption className="sr-only">Kaynağın model listesi</caption>
        <TableHeader><TableRow><TableHead>Model</TableHead><TableHead>Durum</TableHead><TableHead><span className="sr-only">İşlem</span></TableHead></TableRow></TableHeader>
        <TableBody>
          {sources.models.map(row => <TableRow key={`m|${row.name}`}>
            <TableCell>{row.name}</TableCell>
            <TableCell>{status(row.hidden, sources.decided)}</TableCell>
            <TableCell>{action(row.hidden, { kind: "source_model", key: row.name }, `m|${row.name}`, row.name)}</TableCell>
          </TableRow>)}
          {modelOrphans.map(row => orphanRow(row, 1))}
        </TableBody></Table>
    </Section>}

    {(sources.descriptionModels.length > 0 || descriptionOrphans.length > 0) && <Section title="Açıklamadan okunan modeller"
      description="Tedarikçinin ürün açıklamasından okunan araç modelleri. Ürün, bu modellerin marka ve model sayfalarında, model site haritalarında ve araç önerilerinde listelenir.">
      <Table controls={false}><caption className="sr-only">Açıklamadan okunan modeller</caption>
        <TableHeader><TableRow><TableHead>Marka / Model</TableHead><TableHead>Yıl</TableHead><TableHead>Durum</TableHead>
          <TableHead><span className="sr-only">İşlem</span></TableHead></TableRow></TableHeader>
        <TableBody>
          {sources.descriptionModels.map(row => {
            const name = `${row.brand} ${row.model}`, rowKey = `d|${row.modelId}`;
            return <TableRow key={rowKey}>
              <TableCell>{name}</TableCell>
              <TableCell className="tabular-nums">{row.yearFrom ? `${row.yearFrom} – ${row.yearTo ?? "…"}` : "—"}</TableCell>
              <TableCell>{status(row.hidden, sources.decided)}</TableCell>
              <TableCell>{action(row.hidden, { kind: "description_model", modelId: row.modelId }, rowKey, name)}</TableCell>
            </TableRow>;
          })}
          {descriptionOrphans.map(row => orphanRow(row, 2))}
        </TableBody></Table>
    </Section>}
  </div>;
}

function Section({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <section className="flex flex-col gap-3">
    <div className="flex flex-col gap-1"><h3 className="font-medium">{title}</h3><p className="text-muted-foreground">{description}</p></div>
    {children}
  </section>;
}
