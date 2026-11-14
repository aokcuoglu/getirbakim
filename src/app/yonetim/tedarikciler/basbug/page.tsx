import { CalendarClock, CircleAlert, CircleCheck, History, PackageSearch } from "lucide-react";
import { normalizeSearchParams, type SearchParams } from "@/lib/search-params";
import { SupplierRefreshRunner } from "@/components/admin/supplier-refresh-runner";
import { SupplierHealthStatus } from "@/components/admin/supplier-health-status";
import { FeedStatusBadge } from "@/components/admin/feed-status-badge";
import { StatusBadge } from "@/components/admin/status-badge";
import { adminSupplierFeedStatus } from "@/modules/admin/data";
import { SupplierFactCards } from "@/components/admin/supplier-fact-cards";
import { supplierRunError } from "@/modules/suppliers/run-error";
import { runKindLabel, scheduleLines } from "@/modules/suppliers/run-status";
import { durationSeconds, formatDate, formatInterval, formatNumber } from "@/modules/admin/format";
import { SupplierPage, SupplierSourceCard } from "@/components/admin/supplier-page";
import { SupplierPartTable } from "@/components/admin/supplier-part-table";
import { basbugPartTableProps, costNotes } from "@/components/admin/supplier-part-table-data";
import { SupplierBrowser } from "@/components/admin/supplier-browser";
import { SupplierPagination } from "@/components/admin/supplier-pagination";
import { SupplierQualityCard } from "@/components/admin/supplier-quality-card";
import { SupplierRunHistory } from "@/components/admin/supplier-run-history";
import { BasbugProductFilters } from "@/components/admin/basbug-product-filters";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item";
import { GroupFreshnessChart, RunDurationChart } from "@/components/admin/basbug-sync-charts";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { adminBasbugData } from "@/modules/admin/basbug";
import { refreshBasbug } from "./actions";
import { supplierCheckoutMode } from "@/modules/store/supplier-checkout-policy";
import { supplierActivity } from "@/modules/suppliers/activity";
import { SupplierActivityBadge } from "@/components/admin/supplier-activity-badge";
import { db } from "@/lib/db";
import { requireAdmin } from "@/modules/auth/session";
import { SupplierRefreshButton } from "@/components/admin/supplier-refresh-button";
import { basbugWarehouse, basbugWarehouses } from "@/modules/suppliers/basbug-stock";

// Remove only insignificant trailing zeroes; preserve the source precision.
const rate = (value: string) => value.includes(".") ? value.replace(/0+$/, "").replace(/\.$/, "") : value;
const errors: Record<string, string> = {
  rejected: "Ürün sayısı veya veri eksikliği güvenlik eşiğini aştı. Çekim inceleme için reddedildi; güncel veriler korunuyor.",
  paused: "Başbuğ API çekimleri durduruldu. Mevcut veriler korunuyor.",
  busy: "Bir çekim zaten devam ediyor. Biraz sonra yeniden deneyin.",
  config: "Başbuğ bağlantı bilgilerini kontrol edin.",
  contract: "İstek veya yanıt beklenen veri yapısına uymadı. Önceki veriler korunuyor.",
  upstream: "Başbuğ verileri alınamadı. Önceki veriler korunuyor; yeniden deneyebilirsiniz.",
};
const filterKeys = ["group", "q", "brand", "currency", "warehouse", "stock", "quality", "presence"] as const;
const commerceLabel = runKindLabel("commerce", "basbug");

const runError = (reason: string) => supplierRunError(reason, "basbug");

export default async function BasbugAdmin({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = normalizeSearchParams(await searchParams);
  await requireAdmin();
  const [data, checkoutMode, activity, feeds] = await Promise.all([adminBasbugData(params), supplierCheckoutMode(), supplierActivity(db, "basbug"), adminSupplierFeedStatus()]);
  const { snapshot, group, knownGroups, items, currencies, total, page, pages, capped } = data;
  const mrkScopes = data.health.scopes.filter(scope => scope.warehouse === "MRK");
  const schedule = scheduleLines(mrkScopes, { commerceLabel });
  const lastCommerce = mrkScopes.map(scope => scope.commerce_last_success_at).filter((d): d is Date => Boolean(d)).sort((a, b) => b.getTime() - a.getTime())[0]
    ?? (snapshot?.observations.DovizBilgisiGetir ? new Date(snapshot.observations.DovizBilgisiGetir) : undefined);
  const scopes = data.health.scopes.filter(scope => !group || scope.list_group === group);
  const scopeState = (scope: typeof scopes[number]) => scope.catalog_stale || scope.commerce_stale ? "stale" : scope.commerce_failures || scope.consecutive_failures ? "retry" : "fresh";
  const freshness = { fresh: 0, retry: 0, stale: 0 };
  for (const scope of scopes) freshness[scopeState(scope)]++;
  const runBars = [...data.recentRuns].reverse().map(run => ({ id: run.id, status: run.status, seconds: durationSeconds(run.started_at, run.completed_at) ?? 0, label: formatDate(run.started_at) }));
  const { lastSucceeded } = data;
  const lastRun = data.recentRuns[0];
  const groupCount = new Set(knownGroups.map(g => g.kod)).size;
  return <SupplierPage crumb="Başbuğ" title="Başbuğ API" tabsLabel="Başbuğ yönetimi"
    description="Ürün, kaynak fiyat ve depo stok verilerini incele; senkronizasyonu yönet."
    badge={<SupplierActivityBadge supplier="basbug" initial={activity}><FeedStatusBadge status={feeds.basbug}/></SupplierActivityBadge>}
    attention={Boolean(params.error)} hasData={data.snapshots.length > 0} tabKey={[params.error, params.updated, group].join("|")}
    alerts={<>
      {params.updated === "1" && <Alert variant="success" role="status"><CircleCheck aria-hidden="true"/><AlertDescription>Veriler API’den çekildi ve güncel kayıtlar yenilendi.</AlertDescription></Alert>}
      {params.error && <Alert variant="destructive" role="alert"><CircleAlert aria-hidden="true"/><AlertDescription>{errors[params.error] || errors.upstream}</AlertDescription></Alert>}
    </>}
    facts={<>
      <SupplierFactCards label="Başbuğ özet" health={data.health} feed={feeds.basbug} checkoutMode={checkoutMode}
        checkoutNote={checkoutMode === "snapshot" ? "Tüm tedarikçilerde ortak ayar · teyit bekler" : "Siparişte API doğrulaması"}
        lastSuccess={lastSucceeded ? { at: lastSucceeded.completed_at, status: lastSucceeded.status, scope: `${lastSucceeded.list_group} · ${runKindLabel(lastSucceeded.run_kind, "basbug")} · ${formatNumber(lastSucceeded.quality.uniqueProducts)} ürün` } : null}
        lastRun={lastRun ? { at: lastRun.started_at, status: lastRun.status, scope: `${lastRun.list_group} · ${runKindLabel(lastRun.run_kind, "basbug")}${lastRun.status === "succeeded" ? ` · ${formatNumber(lastRun.quality.uniqueProducts)} ürün` : ""}` } : null}
        notes={{
          scheduler: [`${formatNumber(mrkScopes.length)} grup otomatik izleniyor`, ...schedule],
          success: [`Son ${commerceLabel.toLocaleLowerCase("tr")}: ${formatDate(lastCommerce, { fallback: "henüz yok" })}`],
          run: [lastRun?.error_reason && runError(lastRun.error_reason)],
        }}/>
      <SupplierHealthStatus health={data.health} supplier="basbug" name="Başbuğ" unit="grup" warehouse="MRK" group={group} refresh={refreshBasbug} refreshField="group"
        commerceLabel={commerceLabel} liveCheckout={checkoutMode === "live"} refreshDescription="Ürün, fiyat, MRK stok ve kur verileri birlikte yenilenir."/>
    </>}
    sync={<div className="flex flex-col gap-4">
      <SupplierSourceCard description="Seçilen grubun ürün, fiyat, stok ve kur verileri birlikte çekilir." badge={<Badge variant="outline">API · grup bazlı</Badge>} schedule={schedule}
        footer={<SupplierRefreshRunner scopes={[{ supplier: "basbug", groups: [...new Set(knownGroups.map(g => g.kod))] }]} label="Tüm grupları API’den yenile" description={`${groupCount} grup sırayla yenilenir; sayfayı açık tutun.`} ariaLabel="Tüm Başbuğ gruplarını güncelle"/>}>
        <form action={refreshBasbug}><Field>
          <FieldLabel htmlFor="refresh-group">Tek grup</FieldLabel>
          <div className="flex flex-wrap gap-2"><NativeSelect id="refresh-group" name="group" defaultValue={group || "FIAT"}>{knownGroups.map(g => <NativeSelectOption key={g.kod} value={g.kod}>{g.ad} ({g.kod})</NativeSelectOption>)}</NativeSelect><SupplierRefreshButton label="Seçili grubu API’den güncelle" pendingLabel="Başbuğ verileri çekiliyor…"/></div>
          <FieldDescription>Seçilen grup {basbugWarehouses.join(" · ")} depolarından çekilir.</FieldDescription>
        </Field></form>
      </SupplierSourceCard>
      <SupplierQualityCard quality={snapshot?.quality} completedAt={snapshot?.completed_at} scope={snapshot ? `${snapshot.list_group} / ${snapshot.warehouse}` : undefined}
        filters={{ group: snapshot?.list_group }}>
        {snapshot && <p className="text-muted-foreground tabular-nums">{([["Fiyat satırı", snapshot.quality.priceRows], ["Stok satırı", snapshot.quality.stockRows], ["Eksik stok", snapshot.quality.missingStocks], ["Eşleşmeyen fiyat/stok", `${formatNumber(snapshot.quality.orphanPrices)}/${formatNumber(snapshot.quality.orphanStocks)}`]] as const).map(([label, value]) => `${label}: ${typeof value === "number" ? formatNumber(value) : value}`).join(" · ")}</p>}
      </SupplierQualityCard>
      <SupplierRunHistory runs={data.recentRuns} supplier="basbug" name="Başbuğ" emptyDescription="Periyodik çekim için sunucuda zamanlayıcı çalışmalı."/>
      <div className="grid items-start gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle><h2>Grup güncelliği</h2></CardTitle><CardDescription>{group || "Tüm liste grupları"}</CardDescription><CardAction><Badge variant={data.sync?.enabled ? "success" : "outline"}>{data.sync?.enabled ? "Periyodik çekim etkin" : "Periyodik çekim kapalı"}</Badge></CardAction></CardHeader>
          <CardContent className="flex flex-col gap-4">
            {scopes.length ? <div className="grid items-center gap-4 sm:grid-cols-2">
              <GroupFreshnessChart fresh={freshness.fresh} retry={freshness.retry} stale={freshness.stale}/>
              <ItemGroup>{([["fresh", "success", "Güncel"], ["retry", "warning", "Yeniden deneme bekliyor"], ["stale", "destructive", "Güncellik aşıldı"]] as const).map(([key, variant, label]) => <Item key={key} size="sm" variant="muted">
                <ItemContent><ItemTitle>{label}</ItemTitle></ItemContent>
                <ItemActions><Badge variant={variant} className="tabular-nums">{formatNumber(freshness[key])}</Badge></ItemActions>
              </Item>)}</ItemGroup>
            </div> : <Empty><EmptyHeader><EmptyMedia variant="icon"><CalendarClock/></EmptyMedia><EmptyTitle>Otomatik güncelleme kapsamı tanımlı değil</EmptyTitle><EmptyDescription>Zamanlayıcı yapılandırıldığında gruplar burada listelenir.</EmptyDescription></EmptyHeader></Empty>}
            {scopes.length > 0 && <Accordion className="rounded-lg border"><AccordionItem value="plan" className="px-4">
              <AccordionTrigger>Grup bazında plan</AccordionTrigger>
              <AccordionContent><Table><TableHeader><TableRow><TableHead>Grup</TableHead><TableHead>Ürün listesi</TableHead><TableHead>{commerceLabel}</TableHead><TableHead>Son {commerceLabel.toLocaleLowerCase("tr")}</TableHead><TableHead>Durum</TableHead></TableRow></TableHeader><TableBody>{scopes.map(scope => <TableRow key={`${scope.company}-${scope.list_group}-${scope.warehouse}`}>
                <TableCell className="font-medium">{scope.list_group}</TableCell><TableCell>{scope.enabled ? formatInterval(scope.interval_minutes, scope.daily_at) : "Kapalı"}</TableCell><TableCell>{scope.commerce_enabled ? formatInterval(scope.commerce_interval_minutes) : "Kapalı"}</TableCell><TableCell className="tabular-nums">{formatDate(scope.commerce_last_success_at, { fallback: "Henüz yok" })}</TableCell>
                <TableCell><StatusBadge tone={scopeState(scope) === "stale" ? "error" : scopeState(scope) === "retry" ? "warning" : "success"}>{scopeState(scope) === "stale" ? "Güncellik aşıldı" : scopeState(scope) === "retry" ? "Yeniden deneme bekliyor" : "Güncel"}</StatusBadge></TableCell>
              </TableRow>)}</TableBody></Table></AccordionContent>
            </AccordionItem></Accordion>}
          </CardContent>
          <CardFooter className="text-muted-foreground">Sonraki deneme: {data.sync ? formatDate(data.sync.next_run_at) : "zamanlama kaydı yok"}</CardFooter>
        </Card>
        <Card>
          <CardHeader><CardTitle><h2>Çekim süreleri</h2></CardTitle><CardDescription>Son {formatNumber(data.recentRuns.length)} çekimin süresi (sn)</CardDescription></CardHeader>
          <CardContent>{data.recentRuns.length ? <RunDurationChart runs={runBars}/>
            : <Empty><EmptyHeader><EmptyMedia variant="icon"><History/></EmptyMedia><EmptyTitle>Henüz çekim kaydı bulunmuyor</EmptyTitle></EmptyHeader></Empty>}</CardContent>
        </Card>
      </div>
      {snapshot && <Card>
        <CardHeader><CardTitle><h2>Döviz kurları</h2></CardTitle><CardDescription>Kaynak API · {snapshot.list_group} · {formatDate(snapshot.completed_at)}</CardDescription></CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">{snapshot.currencies_data.dovizListesi.map(c => <Item key={c.dovizCinsi} variant="outline" size="sm">
            <ItemContent><ItemTitle>{c.dovizCinsi} <span className="font-normal text-muted-foreground">/ TRY</span></ItemTitle>
              <span className="text-lg font-semibold tabular-nums" title={`Satış: ${c.satis}`}>{rate(c.satis)}</span>
              <ItemDescription className="tabular-nums" title={c.alis}>Alış {rate(c.alis)}</ItemDescription>
            </ItemContent>
          </Item>)}</div>
          <Accordion className="rounded-lg border"><AccordionItem value="observations" className="px-4">
            <AccordionTrigger>Verilerin çekilme zamanları</AccordionTrigger>
            <AccordionContent><Table><caption className="sr-only">Kaynak verilerinin çekilme zamanları</caption><TableHeader><TableRow><TableHead>Veri kaynağı</TableHead><TableHead>Liste / Depo</TableHead><TableHead>Çekilme zamanı (İstanbul)</TableHead></TableRow></TableHeader><TableBody>{Object.entries(snapshot.observations).filter(([key]) => key !== "StokGetir" || !snapshot.observations["StokGetir:MRK"]).map(([key,value]) => { const [service,depot,error] = key.split(":"); return <TableRow key={key}><TableCell className="font-medium"><div className="flex items-center gap-2">{({MalzemeleriGetir:"Ürünler",FiyatGetir:"Fiyatlar",StokGetir:"Stoklar",DovizBilgisiGetir:"Kurlar",ListeGrubuGetir:"Liste grupları",products:"Ürünler",prices:"Fiyatlar",stocks:"Stoklar",currencies:"Kurlar",groups:"Liste grupları"} as Record<string,string>)[service] || service}{error === "607" && <StatusBadge tone="warning">Depo erişimi yok (607)</StatusBadge>}</div></TableCell><TableCell>{snapshot.list_group} / {depot || snapshot.warehouse}</TableCell><TableCell className="tabular-nums"><time dateTime={new Date(value).toISOString()}>{formatDate(new Date(value))}</time></TableCell></TableRow>; })}</TableBody></Table></AccordionContent>
          </AccordionItem></Accordion>
        </CardContent>
      </Card>}
    </div>}
    products={<SupplierBrowser><Card>
      <CardHeader className="border-b">
        <BasbugProductFilters key={[group,params.q,params.brand,params.currency,params.warehouse,params.stock,params.presence,params.quality].join("|")} params={params} groups={knownGroups.map(g => ({ ...g, ready: data.snapshots.some(s => s.list_group === g.kod) }))} currencies={currencies}/>
      </CardHeader>
      {!snapshot ? <CardContent><Empty><EmptyHeader><EmptyMedia variant="icon"><PackageSearch/></EmptyMedia><EmptyTitle>Bu grubun verileri henüz çekilmedi.</EmptyTitle><EmptyDescription>Senkronizasyon sekmesinden liste grubunu seçip API’den çekebilirsiniz.</EmptyDescription></EmptyHeader></Empty></CardContent> : <>
      <CardContent className="flex flex-col gap-3 group-data-loading/browser:pointer-events-none group-data-loading/browser:opacity-50">
        <div className="flex flex-wrap justify-between gap-2 text-muted-foreground tabular-nums"><span><strong className="text-foreground">{formatNumber(total)}</strong> ürün · {group || "Tüm liste grupları"}{params.stock && ` · ${basbugWarehouse(params.warehouse)}: ${params.stock === "1" ? "Stok var" : params.stock === "0" ? "Stok yok" : "Veri yok"}`}</span><span>{costNotes.basbug}</span></div>
        <SupplierPartTable {...basbugPartTableProps(items, basbugWarehouse(params.warehouse), { brands: data.brands, currencies: data.currencies })}/>
      </CardContent>
      <CardFooter><SupplierPagination base="/yonetim/tedarikciler/basbug" params={params} keys={filterKeys} page={page} pages={pages} capped={capped}/></CardFooter>
      </>}
    </Card></SupplierBrowser>}/>;
}
