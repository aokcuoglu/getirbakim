import { Fragment } from "react";
import Link from "next/link";
import { supplierActivity } from "@/modules/suppliers/activity";
import { SupplierActivityBadge } from "@/components/admin/supplier-activity-badge";
import { db } from "@/lib/db";
import { normalizeSearchParams, type SearchParams } from "@/lib/search-params";
import { SupplierTabs } from "@/components/admin/supplier-tabs";
import { SupplierPartTable } from "@/components/admin/supplier-part-table";
import { setaPartTableProps } from "@/components/admin/supplier-part-table-data";
import { SupplierBrowser } from "@/components/admin/supplier-browser";
import { SupplierRefreshButton } from "@/components/admin/supplier-refresh-button";
import { SetaProductFilters } from "@/components/admin/seta-product-filters";
import { CircleAlert, CircleCheck, History, Info, PackageSearch, TriangleAlert } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Pagination, PaginationContent, PaginationEllipsis, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from "@/components/ui/pagination";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { adminSetaData } from "@/modules/admin/seta";
import { supplierCheckoutMode } from "@/modules/store/supplier-checkout-policy";
import { refreshSeta } from "./actions";

type Tone = "success" | "warning" | "error" | "info" | "neutral";
const statusBadge = (tone: Tone, text: string) => tone === "success" ? <Badge variant="success"><CircleCheck data-icon="inline-start" aria-hidden="true"/>{text}</Badge>
  : tone === "error" ? <Badge variant="destructive"><CircleAlert data-icon="inline-start" aria-hidden="true"/>{text}</Badge>
  : tone === "warning" ? <Badge variant="warning"><TriangleAlert data-icon="inline-start" aria-hidden="true"/>{text}</Badge>
  : tone === "info" ? <Badge variant="info"><Info data-icon="inline-start" aria-hidden="true"/>{text}</Badge> : <Badge variant="outline">{text}</Badge>;

const number = (value: number) => new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 }).format(value);
const date = (value: Date) => value.toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" });
const errors: Record<string, string> = {
  rejected: "Ürün sayısı veya eksik fiyat oranı güvenlik eşiğini aştı. Çekim inceleme için reddedildi; güncel veriler korunuyor.",
  paused: "SETA API çekimleri durduruldu. Mevcut veriler korunuyor.",
  busy: "Bir SETA aktarımı zaten devam ediyor. Biraz sonra yeniden deneyin.",
  config: "SETA_API_KEY tanımlı değil veya SETA_BASE_URL geçersiz.",
  contract: "Yanıt beklenen veri yapısına uymadı. Önceki veriler korunuyor.",
  upstream: "SETA verileri alınamadı. Önceki veriler korunuyor; yeniden deneyebilirsiniz.",
};
const runLabels: Record<string, string> = { running: "Çalışıyor", succeeded: "Başarılı", failed: "Başarısız", rejected: "İnceleme gerekli" };
const runTones: Record<string, Tone> = { running: "info", succeeded: "success", failed: "error", rejected: "warning" };

function runError(reason: string) {
  if (reason === "product-drop-over-20-percent") return "Ürün sayısı %20’den fazla azaldı; inceleme gerekli";
  if (reason === "missing-prices-increased-over-10-points") return "Eksik fiyat oranı 10 puandan fazla arttı; inceleme gerekli";
  if (reason === "worker-interrupted") return "İşlem tamamlanmadan kesildi";
  if (reason.startsWith("config")) return "Bağlantı ayarları eksik veya geçersiz";
  if (reason.startsWith("contract")) return "Yanıt veri yapısı doğrulanamadı";
  if (reason.startsWith("upstream:")) return `Ürün servisi: ${reason.endsWith(": timeout") ? "yanıt zaman aşımına uğradı" : reason.match(/HTTP \d{3}$/)?.[0] || "veri alınamadı"}`;
  return "Servis veya kayıt işlemi tamamlanamadı";
}

export default async function SetaAdmin({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = normalizeSearchParams(await searchParams);
  const [data, checkoutMode, activity] = await Promise.all([adminSetaData(params), supplierCheckoutMode(), supplierActivity(db, "seta")]);
  const { snapshot, health, items, categories, total, page, pages } = data;
  const scope = health.scopes[0];
  const pageUrl = (target: number) => {
    const query = new URLSearchParams({ page: String(target) });
    for (const key of ["q", "category", "stock", "quality", "presence"] as const) if (params[key]) query.set(key, params[key]!);
    return `/yonetim/tedarikciler/seta?${query}`;
  };
  const pageNumbers = Array.from(new Set([1, ...Array.from({ length: 5 }, (_, i) => Math.max(1, Math.min(page - 2, pages - 4)) + i), pages])).filter(n => n >= 1 && n <= pages).sort((a, b) => a - b);
  const facts: [string, string, string][] = [
    ["Son tam aktarım", snapshot?.completed_at ? date(snapshot.completed_at) : "Henüz yok", snapshot ? `${number(snapshot.quality.uniqueProducts)} ürün · ${number(snapshot.quality.missingPrices)} fiyatsız` : "İlk aktarımı başlatın"],
    ["Son fiyat · stok", scope?.commerce_last_success_at ? date(scope.commerce_last_success_at) : "Henüz yok", scope?.commerce_enabled ? `${scope.commerce_interval_minutes} dakikada bir` : "Periyodik fiyat/stok kapalı"],
    ["Stokta yok", snapshot ? number(snapshot.quality.outOfStock) : "—", "Kaynak yalnız var/yok bildirir"],
    ["Sipariş veri kaynağı", checkoutMode === "snapshot" ? "Kayıtlı veriler" : "Canlı API", "Başbuğ ile ortak ayar"],
  ];
  return <div className="flex flex-col gap-6">
    <div className="flex flex-col gap-2">
      <Breadcrumb><BreadcrumbList>
        <BreadcrumbItem><BreadcrumbLink render={<Link href="/yonetim"/>}>Yönetim</BreadcrumbLink></BreadcrumbItem><BreadcrumbSeparator/>
        <BreadcrumbItem><BreadcrumbLink render={<Link href="/yonetim/tedarikciler"/>}>Tedarikçiler</BreadcrumbLink></BreadcrumbItem><BreadcrumbSeparator/>
        <BreadcrumbItem><BreadcrumbPage>SETA</BreadcrumbPage></BreadcrumbItem>
      </BreadcrumbList></Breadcrumb>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">SETA API</h1>
          <p className="text-muted-foreground">Seta Filtre B2B listesi: ürün, OEM, çapraz referans, KDV hariç bayi fiyatı ve stok durumu.</p>
        </div>
        <SupplierActivityBadge supplier="seta" initial={activity}>{statusBadge(!scope ? "neutral" : health.healthy ? "success" : "warning", !scope ? "Henüz aktarılmadı" : health.healthy ? "Senkronizasyon sağlıklı" : "Dikkat gerekiyor")}</SupplierActivityBadge>
      </div>
    </div>
    {params.updated === "1" && <Alert variant="success" role="status"><CircleCheck aria-hidden="true"/><AlertDescription>Liste API’den çekildi ve güncel kayıtlar yenilendi.</AlertDescription></Alert>}
    {params.error && <Alert variant="destructive" role="alert"><CircleAlert aria-hidden="true"/><AlertDescription>{errors[params.error] || errors.upstream}</AlertDescription></Alert>}
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" role="region" aria-label="SETA özet">
      {facts.map(([label, value, note]) => <Card key={label} size="sm">
        <CardHeader><CardDescription>{label}</CardDescription><CardTitle className="tabular-nums">{value}</CardTitle></CardHeader>
        <CardContent className="text-muted-foreground">{note}</CardContent>
      </Card>)}
    </div>
    <SupplierTabs label="SETA yönetimi" key={params.error ? `error-${params.error}` : params.updated ? "updated" : "workspace"} initialTab={params.error || !snapshot ? "transfer" : "products"} transfer={<div className="flex flex-col gap-4">
      <Card>
        <CardHeader><CardTitle><h2>Kaynağı güncelle</h2></CardTitle><CardDescription>Tüm liste tek istekle çekilir (yaklaşık 1.400 ürün, birkaç saniye).</CardDescription><CardAction><Badge variant="outline">API · tek liste</Badge></CardAction></CardHeader>
        <CardContent className="flex flex-col gap-3">
          <form action={refreshSeta} className="flex flex-wrap items-end gap-2"><SupplierRefreshButton label="Listeyi API’den güncelle" pendingLabel="SETA verileri çekiliyor…"/></form>
          <p className="text-muted-foreground">Fiyat KDV hariç bayi alışıdır; satış fiyatı fiyatlandırma ekranındaki kâr ve KDV ile hesaplanır. 0,00 TL fiyatlı ürünler satışa kapalıdır. Stok adet değil, var/yok sinyalidir.</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle><h2>Otomatik güncelleme planı</h2></CardTitle><CardDescription>{scope ? `${scope.enabled ? `Ürün listesi: ${scope.interval_minutes === 1440 ? "her gün" : `${scope.interval_minutes} dakikada bir`} · sonraki ${date(scope.next_run_at)}` : "Ürün listesi çekimi kapalı"} · ${scope.commerce_enabled ? `Fiyat/stok: ${scope.commerce_interval_minutes} dakikada bir` : "Fiyat/stok çekimi kapalı"}` : "İlk başarılı aktarım günlük planı oluşturur."}</CardDescription></CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-muted-foreground">Plan ayarı: <code className="font-mono">supplier-configure --supplier=seta --group=ALL --daily-at=03:00 --commerce-enabled=true --commerce-interval-minutes=30 --commerce-stale-minutes=90</code></p>
          {scope && (scope.catalog_stale || scope.commerce_stale || scope.consecutive_failures > 0 || scope.commerce_failures > 0) && <Alert variant="warning"><TriangleAlert aria-hidden="true"/><AlertDescription>{scope.catalog_stale || scope.commerce_stale ? "Güncellik süresi aşıldı; fiyatlar satışta gizleniyor." : `Son çekimler başarısız; sonraki deneme ${date(scope.commerce_failures ? scope.commerce_next_run_at : scope.next_run_at)}.`}</AlertDescription></Alert>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle><h2>Çekim geçmişi</h2></CardTitle><CardDescription>Son {data.recentRuns.length} işlem</CardDescription></CardHeader>
        <CardContent>
          {data.recentRuns.length ? <Table><caption className="sr-only">SETA veri çekim geçmişi</caption><TableHeader><TableRow><TableHead>Başlangıç</TableHead><TableHead>Tür</TableHead><TableHead>Durum</TableHead><TableHead className="text-right">Süre</TableHead><TableHead>Sonuç</TableHead></TableRow></TableHeader><TableBody>{data.recentRuns.map(run => <TableRow key={run.id} className="align-top">
            <TableCell className="tabular-nums"><time dateTime={run.started_at.toISOString()}>{date(run.started_at)}</time><code className="block font-mono text-muted-foreground" title={run.id}>#{run.id.slice(0, 8)}</code></TableCell>
            <TableCell>{run.run_kind === "commerce" ? "Fiyat · stok" : "Tam liste"}</TableCell>
            <TableCell>{statusBadge(runTones[run.status] ?? "neutral", runLabels[run.status] || run.status)}</TableCell>
            <TableCell className="text-right tabular-nums">{run.completed_at ? `${number(Math.max(0, (run.completed_at.getTime() - run.started_at.getTime()) / 1000))} sn` : "Devam ediyor"}</TableCell>
            <TableCell className="whitespace-normal">{run.status === "succeeded" ? <div className="grid grid-cols-3 gap-x-4 gap-y-1 text-muted-foreground tabular-nums">{([["added", "yeni"], ["changed", "değişen"], ["unchanged", "aynı"], ["missing", "kayıp"], ["inactive", "pasif"], ["restored", "geri gelen"]] as const).map(([key, label]) => <span key={key}><b className="font-medium text-foreground">{number(run.stats[key] ?? 0)}</b> {label}</span>)}</div> : run.error_reason ? runError(run.error_reason) : "İşlem sürüyor"}{run.review_note && <div className="text-muted-foreground">İnceleme notu: {run.review_note}</div>}</TableCell>
          </TableRow>)}</TableBody></Table> : <Empty><EmptyHeader><EmptyMedia variant="icon"><History/></EmptyMedia><EmptyTitle>Henüz çekim kaydı bulunmuyor</EmptyTitle></EmptyHeader></Empty>}
        </CardContent>
      </Card>
    </div>} products={
    <SupplierBrowser><Card>
      <CardHeader className="border-b">
        <SetaProductFilters key={[params.q, params.category, params.stock, params.presence, params.quality].join("|")} params={params} categories={categories}/>
      </CardHeader>
      {!snapshot ? <CardContent><Empty><EmptyHeader><EmptyMedia variant="icon"><PackageSearch/></EmptyMedia><EmptyTitle>SETA listesi henüz çekilmedi.</EmptyTitle><EmptyDescription>Senkronizasyon sekmesinden listeyi API’den çekebilirsiniz.</EmptyDescription></EmptyHeader></Empty></CardContent> : <>
      <CardContent className="flex flex-col gap-3 group-data-loading/browser:pointer-events-none group-data-loading/browser:opacity-50">
        <div className="flex flex-wrap justify-between gap-2 text-muted-foreground tabular-nums"><span><strong className="text-foreground">{number(total)}</strong> ürün · {params.category || "Tüm kategoriler"}{params.stock && ` · ${params.stock === "1" ? "Stok var" : "Stok yok"}`}</span><span>NF: KDV hariç bayi fiyatı · Satış: KDV dahil · Stok: var/yok</span></div>
        <SupplierPartTable {...setaPartTableProps(items)}/>
      </CardContent>
      <CardFooter className="flex-wrap justify-between gap-3">
        <span className="text-muted-foreground tabular-nums">Sayfa {number(page)} / {number(pages)}</span>
        <Pagination className="mx-0 w-auto" aria-label="Ürün sayfaları"><PaginationContent>
          <PaginationItem><PaginationPrevious text="Önceki" aria-label="Önceki sayfa" href={page > 1 ? pageUrl(page - 1) : undefined} aria-disabled={page <= 1 || undefined}/></PaginationItem>
          {pageNumbers.map((n, i, ns) => <Fragment key={n}>{i > 0 && n - ns[i - 1] > 1 && <PaginationItem><PaginationEllipsis/></PaginationItem>}<PaginationItem><PaginationLink href={pageUrl(n)} isActive={n === page}>{n}</PaginationLink></PaginationItem></Fragment>)}
          <PaginationItem><PaginationNext text="Sonraki" aria-label="Sonraki sayfa" href={page < pages ? pageUrl(page + 1) : undefined} aria-disabled={page >= pages || undefined}/></PaginationItem>
        </PaginationContent></Pagination>
        <form action="/yonetim/tedarikciler/seta" className="flex items-center gap-2">{Object.entries(params).filter(([key]) => ["q", "category", "stock", "quality", "presence"].includes(key)).map(([key, value]) => <input key={key} type="hidden" name={key} value={value || ""}/>)}<Label htmlFor="page-jump">Sayfaya git</Label><Input id="page-jump" className="w-20" type="number" name="page" min={1} max={pages} defaultValue={page}/><Button type="submit" variant="outline">Git</Button></form>
      </CardFooter>
      </>}
    </Card></SupplierBrowser>
    }/>
  </div>;
}
