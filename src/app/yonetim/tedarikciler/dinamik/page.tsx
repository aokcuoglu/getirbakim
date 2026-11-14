import Link from "next/link";
import { CircleAlert, CircleCheck, TriangleAlert } from "lucide-react";
import { normalizeSearchParams, type SearchParams } from "@/lib/search-params";
import { requireAdmin } from "@/modules/auth/session";
import { supplierHealth } from "@/modules/suppliers/health";
import { FeedStatusBadge } from "@/components/admin/feed-status-badge";
import { StatusBadge } from "@/components/admin/status-badge";
import { supplierRunError } from "@/modules/suppliers/run-error";
import { scheduleLines, type StatusTone } from "@/modules/suppliers/run-status";
import { formatDate, formatNumber } from "@/modules/admin/format";
import { SupplierFactCards } from "@/components/admin/supplier-fact-cards";
import { SupplierHealthStatus } from "@/components/admin/supplier-health-status";
import { DINAMIK_COMPANY } from "@/modules/suppliers/dinamik-import";
import { adminDinamikOverview, adminSupplierFeedStatus, adminSupplierRefreshPlan } from "@/modules/admin/data";
import { adminDinamikItems } from "@/modules/admin/dinamik";
import { dinamikRegion, dinamikRegions } from "@/modules/suppliers/dinamik-stock";
import { SupplierPage, SupplierSourceCard } from "@/components/admin/supplier-page";
import { SupplierPartTable } from "@/components/admin/supplier-part-table";
import { costNotes, dinamikPartTableProps } from "@/components/admin/supplier-part-table-data";
import { SupplierBrowser } from "@/components/admin/supplier-browser";
import { SupplierPagination } from "@/components/admin/supplier-pagination";
import { SupplierQualityCard } from "@/components/admin/supplier-quality-card";
import { SupplierRunHistory } from "@/components/admin/supplier-run-history";
import { DinamikProductFilters } from "@/components/admin/dinamik-product-filters";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { supplierCheckoutMode } from "@/modules/store/supplier-checkout-policy";
import { supplierActivity } from "@/modules/suppliers/activity";
import { SupplierActivityBadge } from "@/components/admin/supplier-activity-badge";
import { db } from "@/lib/db";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { SupplierRefreshButton } from "@/components/admin/supplier-refresh-button";
import { SupplierRefreshRunner } from "@/components/admin/supplier-refresh-runner";
import { refreshDinamik } from "./actions";

const runError = (reason: string) => supplierRunError(reason, "dinamik");
// Connection settings; only the missing ones are named (the feed badge and the overview already say "Bağlantı eksik").
const variables = ["DINAMIK_BASE", "DINAMIK_APIKEY", "DINAMIK_SECRETKEY"];
const errors: Record<string, string> = {
  busy: "Bir Dinamik çekimi zaten sürüyor. Biraz sonra yeniden deneyin.",
  config: "Dinamik bağlantı değişkenleri eksik.",
  contract: "Marka adı veya yanıt beklenen yapıya uymadı. Önceki veriler korunuyor.",
  rejected: "Veri kalite kontrolünden geçemedi; önceki veriler korunuyor.",
  upstream: "Dinamik verileri alınamadı. Önceki veriler korunuyor; yeniden deneyebilirsiniz.",
  forbidden: "Dinamik bu sunucunun IP adresine izin vermiyor (HTTP 401/403). Dinamik yalnız izinli IP'lerden çağrılabilir: AWS'te VPS proxy'si, yerelde SSH tüneli (DINAMIK_DIRECT_TUNNEL).",
};
const filterKeys = ["q", "brand", "group", "region", "stock", "quality", "presence"] as const;

export default async function DinamikAdmin({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireAdmin();
  const params = normalizeSearchParams(await searchParams);
  const overview = adminDinamikOverview();
  const [data, health, list, activity, checkoutMode, plan, feeds] = await Promise.all([overview, supplierHealth(db, DINAMIK_COMPANY).catch(() => null), adminDinamikItems(params, overview.then(o => o.items.present, () => 0)),
    supplierActivity(db, "dinamik"), supplierCheckoutMode(), adminSupplierRefreshPlan(), adminSupplierFeedStatus().catch(() => null)]);
  const { items: rows, total, page, pages, capped } = list;
  const region = dinamikRegion(params.region);
  const { items, scopes, runs } = data;
  const lastRun = data.recent[0];
  const { lastSucceeded } = data;
  const missingVariables = variables.filter(name => !process.env[name]);
  const schedule = scheduleLines(health?.scopes ?? [], { catalogLabel: "Markalar" });
  const stats: [string, string, string, StatusTone?][] = [
    ["Güncel ürün", formatNumber(items.present), `${formatNumber(items.brands)} marka · ${formatNumber(items.priced)} fiyatlı`],
    ["Bölgede stokta", formatNumber(items.available), "En az bir depoda VAR (adet değil)"],
    ["Markalar", `${formatNumber(scopes.synced)} / ${formatNumber(scopes.enabled)}`, data.discovery ? `Liste ${formatDate(data.discovery.checked_at)} okundu · ${formatNumber(data.discovery.listed)} marka` : "Marka listesi henüz okunmadı",
      scopes.failing ? "warning" : scopes.synced === scopes.enabled && scopes.enabled ? "success" : "neutral"],
    ["Son 24 saat", `${formatNumber(runs.total)} çekim`, runs.failed ? `${formatNumber(runs.failed)} başarısız / inceleme · ${formatNumber(scopes.due)} sırada` : `Hatasız · ${formatNumber(scopes.due)} sırada`, runs.failed ? "warning" : "success"],
  ];
  return <SupplierPage crumb="Dinamik" title="Dinamik API" tabsLabel="Dinamik yönetimi"
    description="Marka bazlı stok ve fiyat listeleri; her marka ayrı kapsam olarak Başbuğ ile aynı zamanlayıcıda çekilir."
    badge={<SupplierActivityBadge supplier="dinamik" initial={activity} unit="marka">{feeds ? <FeedStatusBadge status={feeds.dinamik}/> : <StatusBadge tone="error">Okunamadı</StatusBadge>}</SupplierActivityBadge>}
    attention={Boolean(params.error) || params.updated === "1"} hasData={items.present > 0} tabKey={[params.error, params.updated, params.brand].join("|")}
    alerts={<>
      {params.updated === "1" && <Alert variant="success" role="status"><CircleCheck aria-hidden="true"/><AlertDescription>{params.brand ? `${params.brand} markası` : "Marka"} API’den çekildi ve güncel kayıtlar yenilendi.</AlertDescription></Alert>}
      {params.error && <Alert variant="destructive" role="alert"><CircleAlert aria-hidden="true"/><AlertDescription>{errors[params.error] || errors.upstream}</AlertDescription></Alert>}
      {missingVariables.length > 0 && <Alert variant="warning"><TriangleAlert aria-hidden="true"/><AlertTitle>Dinamik bağlantı ayarları eksik</AlertTitle>
        <AlertDescription>Tanımlanmayan ortam değişkenleri: <span className="font-mono">{missingVariables.join(", ")}</span>. Tanımlanana kadar veri çekilemez.</AlertDescription></Alert>}
    </>}
    facts={<>
      <SupplierFactCards label="Dinamik özet" health={health} feed={feeds?.dinamik} checkoutMode={checkoutMode}
        checkoutNote={checkoutMode === "snapshot" ? "Tüm tedarikçilerde ortak ayar · teyit bekler" : "Siparişte marka listesi yeniden çekilir"}
        lastSuccess={lastSucceeded?.completed_at ? { at: lastSucceeded.completed_at, status: lastSucceeded.status, scope: `${lastSucceeded.list_group} · ${formatNumber(lastSucceeded.quality.uniqueProducts)} ürün` } : null}
        lastRun={lastRun ? { at: lastRun.started_at, status: lastRun.status, scope: lastRun.status === "running" ? `${lastRun.list_group} · çekiliyor` : `${lastRun.list_group}${lastRun.status === "succeeded" ? ` · ${formatNumber(lastRun.quality.uniqueProducts)} ürün` : ""}` } : null}
        notes={{ scheduler: schedule, run: [lastRun?.error_reason && runError(lastRun.error_reason)] }}/>
      {health && <SupplierHealthStatus health={health} supplier="dinamik" name="Dinamik" unit="marka" refresh={refreshDinamik} refreshField="brand"
        liveCheckout={checkoutMode === "live"} refreshDescription="Seçilen markanın stok ve fiyat listesi birlikte yenilenir. Tüm güncel olmayan markalar için Senkronizasyon sekmesini kullanın."/>}
    </>}
    sync={<div className="flex flex-col gap-4">
      <SupplierSourceCard description="Her marka tek istekle çekilir (stok ve fiyat listesi birlikte). Zamanlayıcı kapalıyken veriler buradan tazelenir."
        badge={<Badge variant="outline">API · marka bazlı</Badge>} schedule={schedule}
        footer={<SupplierRefreshRunner tasks={plan.dinamikStale.map(brand => ({ supplier: "dinamik" as const, group: brand }))} label={`Güncel olmayan ${formatNumber(plan.dinamikStale.length)} markayı yenile`}
          description="En eskiden başlayarak sırayla yenilenir (marka başına birkaç saniye); sayfayı açık tutun. Tek markanın hatası turu durdurmaz." ariaLabel="Güncel olmayan Dinamik markalarını güncelle"/>}>
        <form action={refreshDinamik}><Field>
          <FieldLabel htmlFor="refresh-brand">Tek marka</FieldLabel>
          <div className="flex flex-wrap gap-2"><NativeSelect id="refresh-brand" name="brand" defaultValue={params.brand && plan.dinamikBrands.includes(params.brand) ? params.brand : plan.dinamikStale[0] ?? plan.dinamikBrands[0]}>{plan.dinamikBrands.map(brand => <NativeSelectOption key={brand} value={brand}>{brand}</NativeSelectOption>)}</NativeSelect><SupplierRefreshButton label="Seçili markayı API’den güncelle" pendingLabel="Dinamik verileri çekiliyor…"/></div>
          <FieldDescription>{formatNumber(plan.dinamikBrands.length)} etkin marka · {formatNumber(plan.dinamikStale.length)} marka son 24 saatte güncellenmedi.</FieldDescription>
        </Field></form>
      </SupplierSourceCard>
      <SupplierQualityCard quality={lastSucceeded?.quality} completedAt={lastSucceeded?.completed_at} scope={lastSucceeded?.list_group}
        filters={{ brand: lastSucceeded?.list_group }}>
        {lastSucceeded && <p className="text-muted-foreground tabular-nums">Yalnız son çekilen marka · Stok satırı: {formatNumber(lastSucceeded.quality.stockRows)} · Fiyat satırı: {formatNumber(lastSucceeded.quality.priceRows)} · Tüm markalarda çelişkili kod: {formatNumber(items.conflicting)}</p>}
      </SupplierQualityCard>
      <SupplierRunHistory runs={data.recent} supplier="dinamik" name="Dinamik" emptyDescription="Zamanlayıcı marka listesini okuyup markaları sırayla çeker."/>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" role="region" aria-label="Dinamik marka kapsamı">
        {stats.map(([label, value, note, statTone]) => <Card key={label}>
          <CardHeader>
            <CardDescription>{label}</CardDescription>
            <CardTitle className="text-2xl font-semibold tabular-nums">{value}</CardTitle>
            {statTone && statTone !== "neutral" && <CardAction><StatusBadge tone={statTone}>{statTone === "success" ? "Güncel" : "Dikkat"}</StatusBadge></CardAction>}
          </CardHeader>
          <CardContent className="text-muted-foreground">{note}</CardContent>
        </Card>)}
      </div>
      <Card>
        <CardHeader><CardTitle><h2>Hata veren markalar</h2></CardTitle><CardDescription>En eski güncel marka: {formatDate(scopes.oldest_success, { fallback: "Henüz yok" })} · en son: {formatDate(scopes.last_success, { fallback: "Henüz yok" })}</CardDescription></CardHeader>
        <CardContent>
          {data.failing.length ? <Table><TableBody>{data.failing.map(scope => <TableRow key={scope.list_group}>
            <TableCell className="whitespace-normal"><div className="font-medium">{scope.list_group}</div><div className="text-muted-foreground">{scope.error_reason ? runError(scope.error_reason) : "Bilinmeyen hata"}</div></TableCell>
            <TableCell className="text-right text-muted-foreground tabular-nums">{scope.consecutive_failures}× · sonraki {formatDate(scope.next_run_at)}</TableCell>
          </TableRow>)}</TableBody></Table> : <p className="text-muted-foreground">Hata veren marka yok.</p>}
        </CardContent>
      </Card>
    </div>}
    products={<SupplierBrowser><Card>
      <CardHeader className="border-b">
        <DinamikProductFilters key={[...filterKeys, "sort", "dir"].map(key => params[key]).join("|")} params={params} brands={list.brands} groups={list.groups}/>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 group-data-loading/browser:pointer-events-none group-data-loading/browser:opacity-50">
        <div className="flex flex-wrap justify-between gap-2 text-muted-foreground tabular-nums"><span><strong className="text-foreground">{formatNumber(total)}</strong> ürün · {params.brand || "Tüm markalar"}{params.stock && ` · ${region === "any" ? "Herhangi bölge" : dinamikRegions.find(r => r.key === region)?.label}: ${params.stock === "1" ? "Stok var" : params.stock === "0" ? "Stok yok" : "Veri yok"}`}</span><span>{costNotes.dinamik} (<Link className="underline" href="/yonetim/fiyatlandirma">oranlar</Link>) · Ürün bilgisi olmayan kodlar mağazada yok</span></div>
        <SupplierPartTable {...dinamikPartTableProps(rows, region, Boolean(data.items.present), { brands: list.brands, groups: list.groups })}/>
      </CardContent>
      <CardFooter><SupplierPagination base="/yonetim/tedarikciler/dinamik" params={params} keys={filterKeys} page={page} pages={pages} capped={capped}/></CardFooter>
    </Card></SupplierBrowser>}/>;
}
