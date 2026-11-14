import type { supplierHealth } from "@/modules/suppliers/health";
import { feedStateLabels } from "@/modules/suppliers/data-status";
import { Info, TriangleAlert } from "lucide-react";
import { SupplierRefreshButton } from "./supplier-refresh-button";
import { ScopeCombobox } from "./scope-combobox";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Health = Awaited<ReturnType<typeof supplierHealth>>;
type Scope = Health["scopes"][number];
const date = (value: Date | null) => value ? value.toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" }) : "Henüz başarılı çekim yok";
const number = (value: number) => new Intl.NumberFormat("tr-TR").format(value);
// Unit of one sync scope: a Başbuğ list group, a Dinamik brand, SETA's single list.
const units = {
  grup: { title: "Grup", locative: "grupta", accusative: "grubu" },
  marka: { title: "Marka", locative: "markada", accusative: "markayı" },
  liste: { title: "Liste", locative: "listede", accusative: "listeyi" },
} as const;
export type SupplierScopeUnit = keyof typeof units;
const scopeName = (scope: Scope) => scope.list_group === "ALL" ? "Tüm liste" : scope.list_group;
const failures = (scope: Scope) => scope.consecutive_failures + scope.commerce_failures;

/**
 * Staleness / retry warning for one supplier's sync scopes, shown above the supplier page's tabs.
 * Silent while every scope is fresh and the scheduler reports in; a neutral note when the scheduler is off on purpose.
 */
export function SupplierHealthStatus({ health, supplier, name, unit, warehouse, group = "", refresh, refreshField, refreshDescription, commerceLabel = "Fiyat · stok", liveCheckout = false, limit = 50 }: {
  health: Health;
  supplier: "basbug" | "dinamik" | "seta";
  /** Supplier name used in titles, e.g. "Başbuğ". */
  name: string;
  unit: SupplierScopeUnit;
  /** Only scopes of this warehouse (Başbuğ watches MRK). */
  warehouse?: string;
  /** Only this scope (the page's selected group). */
  group?: string;
  refresh: (form: FormData) => Promise<void>;
  /** Form field the refresh action reads the scope from; without one the action refreshes the whole source. */
  refreshField?: "group" | "brand";
  refreshDescription: string;
  commerceLabel?: string;
  /** In live checkout, stale scopes' prices are hidden from sale. */
  liveCheckout?: boolean;
  /** Rows in the details table (Dinamik has ~800 brands). */
  limit?: number;
}) {
  const words = units[unit];
  const scopes = health.scopes.filter(scope => scope.supplier === supplier && (!warehouse || scope.warehouse === warehouse) && (!group || scope.list_group === group));
  const affected = scopes.filter(scope => scope.catalog_stale || scope.commerce_stale || scope.consecutive_failures > 0 || scope.commerce_failures > 0);
  const schedulerAlive = Boolean(health.heartbeat?.alive);
  if (!affected.length && (schedulerAlive || health.manual)) {
    if (!health.manual) return null;
    return <Alert variant="info" role="status">
      <Info aria-hidden="true"/>
      <AlertTitle>Otomatik güncelleme kapalı</AlertTitle>
      <AlertDescription>Bu ortamda zamanlayıcı bilerek çalıştırılmıyor; {name} verileri elle yenileniyor. Son yenileme zamanı yukarıdaki kartlarda.</AlertDescription>
    </Alert>;
  }
  const commerceStale = affected.filter(scope => scope.commerce_stale).length;
  const catalogStale = affected.filter(scope => scope.catalog_stale).length;
  const retries = affected.flatMap(scope => [
    ...(scope.enabled && (scope.catalog_stale || scope.consecutive_failures) ? [scope.next_run_at] : []),
    ...(scope.commerce_enabled && (scope.commerce_stale || scope.commerce_failures) ? [scope.commerce_next_run_at] : []),
  ]);
  const nextRetry = retries.sort((a, b) => a.getTime() - b.getTime())[0];
  // Most failing first, so a capped table still shows the scopes that need attention.
  const listed = [...(affected.length ? affected : scopes)].sort((a, b) => failures(b) - failures(a));
  const shown = listed.slice(0, limit);
  const commerce = listed.some(scope => scope.commerce_enabled);
  const names = listed.slice(0, 5).map(scopeName).join(", ") + (listed.length > 5 ? ` +${number(listed.length - 5)}` : "");
  const titleId = `${supplier}-health-title`;
  // Same vocabulary as the feed status badge: all watched scopes past their SLA = "Güncel değil", some = "Kısmen güncel".
  const staleScopes = affected.filter(scope => scope.catalog_stale || scope.commerce_stale).length;
  const staleLabel = feedStateLabels[staleScopes === scopes.length ? "stale" : "partial"].toLocaleLowerCase("tr");
  // Without affected scopes the only finding is a silent scheduler: an operational notice, the data itself is current.
  return <Alert variant={affected.length ? "warning" : "info"} aria-labelledby={titleId}>
    {affected.length ? <TriangleAlert aria-hidden="true"/> : <Info aria-hidden="true"/>}
    <AlertTitle id={titleId}>{staleScopes ? `${name} verileri ${staleLabel}; güncelleme gerekiyor` : affected.length ? `${name} güncellemeleri yeniden deneme bekliyor` : "Otomatik güncelleme çalışmıyor"}</AlertTitle>
    <AlertDescription className="flex flex-col gap-2">
      <div role="status" className="flex flex-col gap-1">
        <p>{affected.length > 0 ? `${number(affected.length)} ${words.locative} güncelleme sorunu var. Son başarılı veriler gösteriliyor.` : "Veriler güncel; ancak zamanlayıcıdan sinyal gelmediği için kendiliğinden yenilenmeyecek. Gerekirse elle güncelleyin."}{health.manual && " Otomatik güncelleme kapalı; veriyi elle yenileyin."}{liveCheckout && (commerceStale > 0 || catalogStale > 0) && " Canlı API kipinde güncelliği aşılan ürünlerin fiyatları satışta gizlenir."}</p>
        {(commerceStale > 0 || catalogStale > 0) && <p>{commerceStale > 0 && `${commerceLabel}: ${number(commerceStale)} ${words.locative} güncellik süresi aşıldı. `}{catalogStale > 0 && `Ürün listesi: ${number(catalogStale)} ${words.locative} güncellik süresi aşıldı.`}</p>}
        <p>Zamanlayıcı: {health.manual ? "Kapalı (elle yenileme)" : schedulerAlive ? "Çalışma sinyali güncel" : "Çalışma sinyali yok"} · {health.manual ? "Otomatik deneme yok" : nextRetry ? `${schedulerAlive ? "Sonraki deneme" : "Planlanan deneme"}: ${date(nextRetry)}${nextRetry.getTime() <= health.checked_at.getTime() ? " (çalıştırılması bekleniyor)" : ""}` : "Güncel zamanlama kaydı yok"} · İstanbul saati</p>
      </div>
      {listed.length > 0 && <Accordion className="rounded-lg border"><AccordionItem value="details" className="px-4">
        <AccordionTrigger>Ayrıntıları gör{affected.length > 0 && ` · ${names}`}</AccordionTrigger>
        <AccordionContent className="flex flex-col gap-2">
          <Table><caption className="sr-only">{name} güncelleme durumu · İstanbul saati</caption>
            <TableHeader><TableRow><TableHead>{words.title}</TableHead><TableHead>Ürün listesi</TableHead>{commerce && <TableHead>{commerceLabel}</TableHead>}<TableHead>Sonraki denemeler</TableHead></TableRow></TableHeader>
            <TableBody>{shown.map(scope => <TableRow key={`${scope.company}-${scope.list_group}-${scope.warehouse}`} className="align-top">
              <TableCell className="font-medium">{scopeName(scope)}</TableCell>
              <TableCell>{!scope.enabled ? "Otomatik çekim kapalı" : scope.catalog_stale ? "Güncellik süresi aşıldı" : "Güncellik süresi içinde"}<div className="text-muted-foreground">Son başarı: {date(scope.last_success_at)}</div>{scope.consecutive_failures > 0 && <div className="text-destructive">Art arda {scope.consecutive_failures} başarısız çekim</div>}</TableCell>
              {commerce && <TableCell>{!scope.commerce_enabled ? "Otomatik çekim kapalı" : scope.commerce_stale ? "Güncellik süresi aşıldı" : "Güncellik süresi içinde"}<div className="text-muted-foreground">Son başarı: {date(scope.commerce_last_success_at)}</div>{scope.commerce_failures > 0 && <div className="text-destructive">Art arda {scope.commerce_failures} başarısız çekim</div>}</TableCell>}
              <TableCell className="text-muted-foreground">{scope.enabled && <div>Ürün: {date(scope.next_run_at)}</div>}{scope.commerce_enabled && <div>{commerceLabel}: {date(scope.commerce_next_run_at)}</div>}</TableCell>
            </TableRow>)}</TableBody>
          </Table>
          {listed.length > shown.length && <p className="text-muted-foreground">+{number(listed.length - shown.length)} {unit} daha; en çok başarısız olan {number(shown.length)} {unit} gösteriliyor.</p>}
        </AccordionContent>
      </AccordionItem></Accordion>}
      {listed.length > 0 && <form action={refresh} className="flex flex-wrap items-end gap-2">
        {refreshField && <Field className="w-52"><FieldLabel htmlFor={`${supplier}-health-retry`}>Yeniden denenecek {unit}</FieldLabel>
          <ScopeCombobox id={`${supplier}-health-retry`} name={refreshField} values={[...new Set(listed.map(scope => scope.list_group))]} defaultValue={group || listed[0]?.list_group} empty={`Eşleşen ${unit} yok.`}/></Field>}
        <SupplierRefreshButton label={refreshField ? `Seçili ${words.accusative} yeniden dene` : `${words.accusative[0].toLocaleUpperCase("tr-TR")}${words.accusative.slice(1)} yeniden dene`} pendingLabel={`${name} verileri çekiliyor…`}/>
        <FieldDescription className="basis-full">{refreshDescription}</FieldDescription>
      </form>}
    </AlertDescription>
  </Alert>;
}
