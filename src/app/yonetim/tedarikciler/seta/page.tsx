import { CircleAlert, CircleCheck, PackageSearch } from "lucide-react";
import { FeedStatusBadge } from "@/components/admin/feed-status-badge";
import { adminSupplierFeedStatus } from "@/modules/admin/data";
import { requireAdmin } from "@/modules/auth/session";
import { supplierActivity } from "@/modules/suppliers/activity";
import { SupplierActivityBadge } from "@/components/admin/supplier-activity-badge";
import { db } from "@/lib/db";
import { normalizeSearchParams, type SearchParams } from "@/lib/search-params";
import { SupplierPage, SupplierSourceCard } from "@/components/admin/supplier-page";
import { SupplierPartTable } from "@/components/admin/supplier-part-table";
import { costNotes, setaPartTableProps } from "@/components/admin/supplier-part-table-data";
import { SupplierBrowser } from "@/components/admin/supplier-browser";
import { SupplierPagination } from "@/components/admin/supplier-pagination";
import { SupplierQualityCard } from "@/components/admin/supplier-quality-card";
import { SupplierRunHistory } from "@/components/admin/supplier-run-history";
import { SupplierRefreshButton } from "@/components/admin/supplier-refresh-button";
import { SetaProductFilters } from "@/components/admin/seta-product-filters";
import { SupplierFactCards } from "@/components/admin/supplier-fact-cards";
import { SupplierHealthStatus } from "@/components/admin/supplier-health-status";
import { supplierRunError } from "@/modules/suppliers/run-error";
import { runKindLabel, scheduleLines } from "@/modules/suppliers/run-status";
import { formatDate, formatNumber } from "@/modules/admin/format";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { adminSetaData } from "@/modules/admin/seta";
import { supplierCheckoutMode } from "@/modules/store/supplier-checkout-policy";
import { refreshSeta } from "./actions";

const errors: Record<string, string> = {
  rejected: "Ürün sayısı veya eksik fiyat oranı güvenlik eşiğini aştı. Çekim inceleme için reddedildi; güncel veriler korunuyor.",
  paused: "SETA API çekimleri durduruldu. Mevcut veriler korunuyor.",
  busy: "Bir SETA çekimi zaten devam ediyor. Biraz sonra yeniden deneyin.",
  config: "SETA_API_KEY tanımlı değil veya SETA_BASE_URL geçersiz.",
  contract: "Yanıt beklenen veri yapısına uymadı. Önceki veriler korunuyor.",
  upstream: "SETA verileri alınamadı. Önceki veriler korunuyor; yeniden deneyebilirsiniz.",
};
const filterKeys = ["q", "category", "stock", "quality", "presence"] as const;

const runError = (reason: string) => supplierRunError(reason, "seta");
type SetaRun = Awaited<ReturnType<typeof adminSetaData>>["recentRuns"][number];
// A full list's quality figures; a price · stock run only refreshes the list it found.
const runScope = (run: SetaRun) => run.run_kind === "full" && run.status === "succeeded"
  ? `Tam liste · ${formatNumber(run.quality.uniqueProducts)} ürün · ${formatNumber(run.quality.missingPrices)} fiyatsız · ${formatNumber(run.quality.outOfStock)} stokta yok`
  : runKindLabel(run.run_kind, "seta");

export default async function SetaAdmin({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireAdmin();
  const params = normalizeSearchParams(await searchParams);
  const [data, checkoutMode, activity, feeds] = await Promise.all([adminSetaData(params), supplierCheckoutMode(), supplierActivity(db, "seta"), adminSupplierFeedStatus()]);
  const { snapshot, lastSucceeded, health, items, categories, total, page, pages, capped } = data;
  const lastRun = data.recentRuns[0];
  const scope = health.scopes[0];
  const schedule = scheduleLines(health.scopes);
  return <SupplierPage crumb="SETA" title="SETA API" tabsLabel="SETA yönetimi"
    description="Seta Filtre B2B listesi: ürün, OEM, çapraz referans, KDV hariç bayi fiyatı ve stok durumu."
    badge={<SupplierActivityBadge supplier="seta" initial={activity} unit="liste"><FeedStatusBadge status={feeds.seta}/></SupplierActivityBadge>}
    attention={Boolean(params.error)} hasData={Boolean(snapshot)} tabKey={[params.error, params.updated].join("|")}
    alerts={<>
      {params.updated === "1" && <Alert variant="success" role="status"><CircleCheck aria-hidden="true"/><AlertDescription>Liste API’den çekildi ve güncel kayıtlar yenilendi.</AlertDescription></Alert>}
      {params.error && <Alert variant="destructive" role="alert"><CircleAlert aria-hidden="true"/><AlertDescription>{errors[params.error] || errors.upstream}</AlertDescription></Alert>}
    </>}
    facts={<>
      <SupplierFactCards label="SETA özet" health={health} feed={feeds.seta} checkoutMode={checkoutMode} checkoutNote="Tüm tedarikçilerde ortak ayar"
        lastSuccess={lastSucceeded?.completed_at ? { at: lastSucceeded.completed_at, status: lastSucceeded.status, scope: runScope(lastSucceeded) } : null}
        lastRun={lastRun ? { at: lastRun.started_at, status: lastRun.status, scope: runScope(lastRun) } : null}
        notes={{
          scheduler: schedule,
          success: [
            snapshot?.completed_at && snapshot.id !== lastSucceeded?.id && `Son tam liste: ${formatDate(snapshot.completed_at)} · ${formatNumber(snapshot.quality.outOfStock)} stokta yok`,
            scope?.commerce_last_success_at && `Son fiyat · stok: ${formatDate(scope.commerce_last_success_at)}`,
            !snapshot && "İlk çekimi başlatın",
          ],
          run: [lastRun?.error_reason && runError(lastRun.error_reason)],
        }}/>
      <SupplierHealthStatus health={health} supplier="seta" name="SETA" unit="liste" refresh={refreshSeta} liveCheckout={checkoutMode === "live"}
        refreshDescription="Tüm liste tek istekle çekilir (yaklaşık 1.400 ürün, birkaç saniye)."/>
    </>}
    sync={<div className="flex flex-col gap-4">
      <SupplierSourceCard description="Tüm liste tek istekle çekilir (yaklaşık 1.400 ürün, birkaç saniye)." badge={<Badge variant="outline">API · tek liste</Badge>}
        schedule={scope ? [...schedule, scope.enabled ? `sonraki tam liste ${formatDate(scope.next_run_at)}` : null].filter((line): line is string => Boolean(line)) : []}>
        <form action={refreshSeta} className="flex flex-wrap items-end gap-2"><SupplierRefreshButton label="Listeyi API’den güncelle" pendingLabel="SETA verileri çekiliyor…"/></form>
        <p className="text-muted-foreground">Maliyet KDV hariç bayi alışıdır; satış fiyatı fiyatlandırma ekranındaki kâr ve KDV ile hesaplanır. 0,00 TL fiyatlı ürünler satışa kapalıdır. Stok adet değil, var/yok sinyalidir.</p>
      </SupplierSourceCard>
      {/* The last full list: its duplicate/conflict counts match the product filters (price · stock runs recount the source only). */}
      <SupplierQualityCard quality={snapshot?.quality} completedAt={snapshot?.completed_at}
        scope={snapshot ? `Tüm liste · ${runKindLabel(snapshot.run_kind, "seta")}` : undefined}>
        {snapshot && <p className="text-muted-foreground tabular-nums">Stokta yok: {formatNumber(snapshot.quality.outOfStock)} · Kaynak satırı: {formatNumber(snapshot.quality.productRows)}</p>}
      </SupplierQualityCard>
      <SupplierRunHistory runs={data.recentRuns} supplier="seta" name="SETA"/>
    </div>}
    products={<SupplierBrowser><Card>
      <CardHeader className="border-b">
        <SetaProductFilters key={filterKeys.map(key => params[key]).join("|")} params={params} categories={categories}/>
      </CardHeader>
      {!snapshot ? <CardContent><Empty><EmptyHeader><EmptyMedia variant="icon"><PackageSearch/></EmptyMedia><EmptyTitle>SETA listesi henüz çekilmedi.</EmptyTitle><EmptyDescription>Senkronizasyon sekmesinden listeyi API’den çekebilirsiniz.</EmptyDescription></EmptyHeader></Empty></CardContent> : <>
      <CardContent className="flex flex-col gap-3 group-data-loading/browser:pointer-events-none group-data-loading/browser:opacity-50">
        <div className="flex flex-wrap justify-between gap-2 text-muted-foreground tabular-nums"><span><strong className="text-foreground">{formatNumber(total)}</strong> ürün · {params.category || "Tüm kategoriler"}{params.stock && ` · ${params.stock === "1" ? "Stok var" : params.stock === "0" ? "Stok yok" : "Veri yok"}`}</span><span>{costNotes.seta}</span></div>
        <SupplierPartTable {...setaPartTableProps(items)}/>
      </CardContent>
      <CardFooter><SupplierPagination base="/yonetim/tedarikciler/seta" params={params} keys={filterKeys} page={page} pages={pages} capped={capped}/></CardFooter>
      </>}
    </Card></SupplierBrowser>}/>;
}
