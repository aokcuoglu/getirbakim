import type { supplierHealth } from "@/modules/suppliers/health";
import { ChevronRight, TriangleAlert } from "lucide-react";
import { SupplierRefreshButton } from "./supplier-refresh-button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Field, FieldLabel } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Health = Awaited<ReturnType<typeof supplierHealth>>;
const date = (value: Date | null) => value ? value.toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" }) : "Henüz başarılı çekim yok";

export function SupplierHealthStatus({ health, group, refresh }: {
  health: Health; group: string; refresh: (form: FormData) => Promise<void>;
}) {
  const scopes = health.scopes.filter(scope => scope.supplier === "basbug" && scope.warehouse === "MRK" && (!group || scope.list_group === group));
  const affected = scopes.filter(scope => scope.catalog_stale || scope.commerce_stale || scope.consecutive_failures > 0 || scope.commerce_failures > 0);
  const schedulerAlive = Boolean(health.heartbeat?.alive);
  if (!affected.length && schedulerAlive) return null;
  const commerceStale = affected.filter(scope => scope.commerce_stale).length;
  const catalogStale = affected.filter(scope => scope.catalog_stale).length;
  const retries = affected.flatMap(scope => [
    ...(scope.enabled && (scope.catalog_stale || scope.consecutive_failures) ? [scope.next_run_at] : []),
    ...(scope.commerce_enabled && (scope.commerce_stale || scope.commerce_failures) ? [scope.commerce_next_run_at] : []),
  ]);
  const nextRetry = retries.sort((a, b) => a.getTime() - b.getTime())[0];
  const groups = affected.length ? affected : scopes;
  return <Alert className="border-warning/30 bg-warning/5" aria-labelledby="supplier-health-title">
    <TriangleAlert className="text-warning" aria-hidden="true"/>
    <AlertTitle id="supplier-health-title" className="text-warning">{commerceStale || catalogStale ? "Başbuğ verilerinin güncellenmesi gerekiyor" : affected.length ? "Başbuğ güncellemeleri yeniden deneme bekliyor" : "Otomatik güncelleme sinyali alınamıyor"}</AlertTitle>
    <AlertDescription className="flex flex-col gap-1">
      <div role="status" className="flex flex-col gap-0.5">
        <p>{affected.length > 0 ? `${affected.length} grupta güncelleme sorunu var. Son başarılı veriler gösteriliyor.` : "Zamanlayıcının çalıştığını ve bilgisayarın açık olduğunu kontrol edin."}</p>
        {(commerceStale > 0 || catalogStale > 0) && <p>{commerceStale > 0 && `Fiyat · stok · kur: ${commerceStale} grupta güncellik süresi aşıldı. `}{catalogStale > 0 && `Ürün listesi: ${catalogStale} grupta güncellik süresi aşıldı.`}</p>}
        <p>Zamanlayıcı: {schedulerAlive ? "Çalışma sinyali güncel" : "Çalışma sinyali yok"} · {nextRetry ? `${schedulerAlive ? "Sonraki deneme" : "Planlanan deneme"}: ${date(nextRetry)}${nextRetry.getTime() <= health.checked_at.getTime() ? " (çalıştırılması bekleniyor)" : ""}` : "Güncel zamanlama kaydı yok"} · İstanbul saati</p>
      </div>
      {groups.length > 0 && <Collapsible className="mt-2">
        <CollapsibleTrigger className="group inline-flex items-center gap-1 text-sm font-medium text-foreground hover:underline"><ChevronRight className="size-4 transition-transform group-data-panel-open:rotate-90" aria-hidden="true"/>Ayrıntıları gör{affected.length > 0 && ` · ${affected.map(scope => scope.list_group).join(", ")}`}</CollapsibleTrigger>
        <CollapsibleContent className="mt-2 overflow-hidden rounded-lg border bg-card text-foreground">
          <Table><caption className="sr-only">Başbuğ güncelleme durumu · İstanbul saati</caption>
            <TableHeader><TableRow><TableHead className="pl-3">Grup</TableHead><TableHead>Ürün listesi</TableHead><TableHead>Fiyat · stok · kur</TableHead><TableHead className="pr-3">Sonraki denemeler</TableHead></TableRow></TableHeader>
            <TableBody>{groups.map(scope => <TableRow key={`${scope.company}-${scope.list_group}-${scope.warehouse}`} className="align-top">
              <TableCell className="pl-3 font-medium">{scope.list_group}</TableCell>
              <TableCell>{!scope.enabled ? "Otomatik çekim kapalı" : scope.catalog_stale ? "Güncellik süresi aşıldı" : "Güncellik süresi içinde"}<div className="text-xs text-muted-foreground">Son başarı: {date(scope.last_success_at)}</div>{scope.consecutive_failures > 0 && <div className="text-xs text-destructive">Art arda {scope.consecutive_failures} başarısız çekim</div>}</TableCell>
              <TableCell>{!scope.commerce_enabled ? "Otomatik çekim kapalı" : scope.commerce_stale ? "Güncellik süresi aşıldı" : "Güncellik süresi içinde"}<div className="text-xs text-muted-foreground">Son başarı: {date(scope.commerce_last_success_at)}</div>{scope.commerce_failures > 0 && <div className="text-xs text-destructive">Art arda {scope.commerce_failures} başarısız çekim</div>}</TableCell>
              <TableCell className="pr-3 text-xs text-muted-foreground">{scope.enabled && <div>Ürün: {date(scope.next_run_at)}</div>}{scope.commerce_enabled && <div>Fiyat/stok/kur: {date(scope.commerce_next_run_at)}</div>}</TableCell>
            </TableRow>)}</TableBody>
          </Table>
        </CollapsibleContent>
      </Collapsible>}
      {groups.length > 0 && <form action={refresh} className="mt-3 flex flex-wrap items-end gap-2">
        <Field className="w-52 gap-1"><FieldLabel htmlFor="health-retry-group" className="text-foreground">Yeniden denenecek grup</FieldLabel>
          <NativeSelect id="health-retry-group" className="w-full" name="group" defaultValue={group || groups[0]?.list_group}>{groups.map(scope => <NativeSelectOption key={scope.list_group} value={scope.list_group}>{scope.list_group}</NativeSelectOption>)}</NativeSelect></Field>
        <SupplierRefreshButton label="Seçili grubu yeniden dene"/>
        <span className="basis-full text-xs">Ürün, fiyat, MRK stok ve kur verileri birlikte yenilenir.</span>
      </form>}
    </AlertDescription>
  </Alert>;
}
