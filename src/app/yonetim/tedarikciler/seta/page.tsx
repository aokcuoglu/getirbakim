import { supplierActivity } from "@/modules/suppliers/activity";
import { SupplierActivityBadge } from "@/components/admin/supplier-activity-badge";
import { db } from "@/lib/db";
import { normalizeSearchParams, type SearchParams } from "@/lib/search-params";
import { SupplierTabs } from "@/components/admin/supplier-tabs";
import { SupplierBrowser } from "@/components/admin/supplier-browser";
import { SupplierRefreshButton } from "@/components/admin/supplier-refresh-button";
import { SetaProductFilters } from "@/components/admin/seta-product-filters";
import { SetaProductDetails } from "@/components/admin/seta-product-details";
import { ChevronLeft, ChevronRight, History, PackageSearch, SearchX } from "lucide-react";
import { AdminPage, AdminPageHeader, AdminPanel, ButtonLink, EmptyState, PagerLink, StatusBadge, StatusMessage } from "@/components/admin/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { adminSetaData } from "@/modules/admin/seta";
import { supplierCheckoutMode } from "@/modules/store/supplier-checkout-policy";
import { money } from "@/modules/store/catalog";
import { refreshSeta } from "./actions";

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
const runTones: Record<string, "success" | "error" | "warning" | "info"> = { running: "info", succeeded: "success", failed: "error", rejected: "warning" };

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
  return <AdminPage>
    <AdminPageHeader breadcrumbs={[{ label: "Yönetim", href: "/yonetim" }, { label: "Tedarikçiler", href: "/yonetim/tedarikciler" }, { label: "SETA" }]} title="SETA API"
      description="Seta Filtre B2B listesi: ürün, OEM, çapraz referans, KDV hariç bayi fiyatı ve stok durumu."
      actions={<SupplierActivityBadge supplier="seta" initial={activity}><StatusBadge tone={!scope ? "neutral" : health.healthy ? "success" : "warning"}>{!scope ? "Henüz aktarılmadı" : health.healthy ? "Senkronizasyon sağlıklı" : "Dikkat gerekiyor"}</StatusBadge></SupplierActivityBadge>}/>
    {params.updated === "1" && <StatusMessage>Liste API’den çekildi ve güncel kayıtlar yenilendi.</StatusMessage>}
    {params.error && <StatusMessage tone="error">{errors[params.error] || errors.upstream}</StatusMessage>}
    <Card className="py-0" role="region" aria-label="SETA özet">
      <dl className="grid grid-cols-2 xl:grid-cols-4">{facts.map(([label, value, note], index) => <div key={label} className={cn("px-4 py-3", index % 2 === 1 && "border-l", index > 1 && "border-t xl:border-t-0", index > 0 && "xl:border-l")}>
        <dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 font-semibold tabular-nums">{value}<span className="block text-xs font-normal text-muted-foreground">{note}</span></dd>
      </div>)}</dl>
    </Card>
    <SupplierTabs label="SETA yönetimi" key={params.error ? `error-${params.error}` : params.updated ? "updated" : "workspace"} initialTab={params.error || !snapshot ? "transfer" : "products"} transfer={<div className="flex flex-col gap-4">
      <AdminPanel title="Kaynağı güncelle" description="Tüm liste tek istekle çekilir (yaklaşık 1.400 ürün, birkaç saniye)." actions={<Badge variant="outline">API · tek liste</Badge>}>
        <form action={refreshSeta} className="flex flex-wrap items-end gap-2"><SupplierRefreshButton label="Listeyi API’den güncelle" pendingLabel="SETA verileri çekiliyor…"/></form>
        <p className="mt-2 text-sm text-muted-foreground">Fiyat KDV hariç bayi alışıdır; satış fiyatı fiyatlandırma ekranındaki kâr ve KDV ile hesaplanır. 0,00 TL fiyatlı ürünler satışa kapalıdır. Stok adet değil, var/yok sinyalidir.</p>
      </AdminPanel>
      <AdminPanel title="Otomatik güncelleme planı" description={scope ? `${scope.enabled ? `Ürün listesi: ${scope.interval_minutes === 1440 ? "her gün" : `${scope.interval_minutes} dakikada bir`} · sonraki ${date(scope.next_run_at)}` : "Ürün listesi çekimi kapalı"} · ${scope.commerce_enabled ? `Fiyat/stok: ${scope.commerce_interval_minutes} dakikada bir` : "Fiyat/stok çekimi kapalı"}` : "İlk başarılı aktarım günlük planı oluşturur."}>
        <p className="text-sm text-muted-foreground">Plan ayarı: <code className="font-mono text-xs">supplier-configure --supplier=seta --group=ALL --daily-at=03:00 --commerce-enabled=true --commerce-interval-minutes=30 --commerce-stale-minutes=90</code></p>
        {scope && (scope.catalog_stale || scope.commerce_stale || scope.consecutive_failures > 0 || scope.commerce_failures > 0) && <p className="mt-2 text-sm text-warning">{scope.catalog_stale || scope.commerce_stale ? "Güncellik süresi aşıldı; fiyatlar satışta gizleniyor." : `Son çekimler başarısız; sonraki deneme ${date(scope.commerce_failures ? scope.commerce_next_run_at : scope.next_run_at)}.`}</p>}
      </AdminPanel>
      <AdminPanel title="Çekim geçmişi" description={`Son ${data.recentRuns.length} işlem`} flush>
        {data.recentRuns.length ? <Table><caption className="sr-only">SETA veri çekim geçmişi</caption><TableHeader><TableRow><TableHead className="pl-4">Başlangıç</TableHead><TableHead>Tür</TableHead><TableHead>Durum</TableHead><TableHead className="text-right">Süre</TableHead><TableHead className="pr-4">Sonuç</TableHead></TableRow></TableHeader><TableBody>{data.recentRuns.map(run => <TableRow key={run.id} className="align-top">
          <TableCell className="pl-4 tabular-nums"><time dateTime={run.started_at.toISOString()}>{date(run.started_at)}</time><code className="block font-mono text-xs text-muted-foreground" title={run.id}>#{run.id.slice(0, 8)}</code></TableCell>
          <TableCell>{run.run_kind === "commerce" ? "Fiyat · stok" : "Tam liste"}</TableCell>
          <TableCell><StatusBadge tone={runTones[run.status] ?? "neutral"}>{runLabels[run.status] || run.status}</StatusBadge></TableCell>
          <TableCell className="text-right tabular-nums">{run.completed_at ? `${number(Math.max(0, (run.completed_at.getTime() - run.started_at.getTime()) / 1000))} sn` : "Devam ediyor"}</TableCell>
          <TableCell className="pr-4 whitespace-normal">{run.status === "succeeded" ? <div className="grid grid-cols-3 gap-x-4 gap-y-0.5 text-xs text-muted-foreground tabular-nums">{([["added", "yeni"], ["changed", "değişen"], ["unchanged", "aynı"], ["missing", "kayıp"], ["inactive", "pasif"], ["restored", "geri gelen"]] as const).map(([key, label]) => <span key={key}><b className="font-semibold text-foreground">{number(run.stats[key] ?? 0)}</b> {label}</span>)}</div> : run.error_reason ? runError(run.error_reason) : "İşlem sürüyor"}{run.review_note && <div className="text-xs text-muted-foreground">İnceleme notu: {run.review_note}</div>}</TableCell>
        </TableRow>)}</TableBody></Table> : <EmptyState title="Henüz çekim kaydı bulunmuyor" icon={<History/>}/>}
      </AdminPanel>
    </div>} products={
    <SupplierBrowser><Card className="gap-0 py-0">
      <SetaProductFilters key={[params.q, params.category, params.stock, params.presence, params.quality].join("|")} params={params} categories={categories}/>
      {!snapshot ? <EmptyState title="SETA listesi henüz çekilmedi." icon={<PackageSearch/>}>Senkronizasyon sekmesinden listeyi API’den çekebilirsiniz.</EmptyState> : <div className="transition-opacity group-data-loading/browser:pointer-events-none group-data-loading/browser:opacity-45">
        <div className="flex flex-wrap justify-between gap-2 border-b px-4 py-2 text-xs text-muted-foreground tabular-nums"><span><strong className="text-foreground">{number(total)}</strong> ürün · {params.category || "Tüm kategoriler"}{params.stock && ` · ${params.stock === "1" ? "Stok var" : "Stok yok"}`}</span><span>NF: KDV hariç bayi fiyatı · Satış: KDV dahil · Stok: var/yok</span></div>
        {items.length ? <Table className="min-w-[1120px] table-fixed text-xs [&_td]:py-1.5"><caption className="sr-only">SETA ürünleri, fiyatları ve stok durumları</caption>
          <colgroup><col className="w-[110px]"/><col className="w-[110px]"/><col className="w-[190px]"/><col className="w-[90px]"/><col className="w-[130px]"/><col className="w-[36px]"/><col className="w-[80px]"/><col className="w-[100px]"/><col className="w-[80px]"/><col className="w-[90px]"/><col className="w-[34px]"/></colgroup>
          <TableHeader><TableRow className="bg-muted/40"><TableHead className="pl-4">Parça kodu</TableHead><TableHead>OEM</TableHead><TableHead>Ürün adı</TableHead><TableHead>Araç</TableHead><TableHead>Çapraz referans</TableHead><TableHead title="Kaynak para birimi">PB</TableHead><TableHead className="text-right" title="KDV hariç bayi fiyatı">NF</TableHead><TableHead className="text-right">Satış (₺)</TableHead><TableHead className="text-center">Stok</TableHead><TableHead>Kontrol</TableHead><TableHead><span className="sr-only">Ürün detayı</span></TableHead></TableRow></TableHeader>
          <TableBody>{items.map(item => {
            const cross = Object.entries(item.product_data.cross ?? {}).map(([brand, code]) => `${brand || "?"} ${code}`).join(" · ");
            const stock = item.stock_data?.stok ?? null;
            return <TableRow key={item.id}>
              <TableCell className="truncate pl-4 font-mono font-medium" title={item.code}>{item.code}</TableCell>
              <TableCell className="truncate text-muted-foreground" title={item.product_data.oe}>{item.product_data.oe || "—"}</TableCell>
              <TableCell className="truncate font-medium" title={[item.product_data.ac, item.product_data.ac2].filter(Boolean).join(" · ")}>{item.product_data.ac}</TableCell>
              <TableCell className="truncate text-muted-foreground" title={[item.product_data.vehicle_brand, item.product_data.ac2].filter(Boolean).join(" · ")}>{item.product_data.vehicle_brand || "—"}</TableCell>
              <TableCell className="truncate text-muted-foreground" title={cross}>{cross || "—"}</TableCell>
              <TableCell className="text-muted-foreground">{item.product_data.dc}</TableCell>
              <TableCell className="truncate text-right tabular-nums" title={item.price_data ? number(item.price_data.nf) : "Fiyat eksik"}>{item.price_data ? number(item.price_data.nf) : "Eksik"}</TableCell>
              <TableCell className="truncate text-right font-semibold tabular-nums" title={item.sale_price_kurus ? `${money(item.sale_price_kurus)} · ${item.sale_stock_label || ""}` : "Satışa kapalı"}>{item.sale_price_kurus ? money(item.sale_price_kurus) : "—"}</TableCell>
              <TableCell className="text-center"><span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap", stock === null ? "text-amber-700 dark:text-amber-400" : stock > 0 ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground")} title="Kaynak adet değil, var/yok bildirir"><span className={cn("size-1.5 shrink-0 rounded-full", stock === null ? "bg-amber-500" : stock > 0 ? "bg-emerald-500" : "bg-muted-foreground/40")} aria-hidden="true"/>{stock === null ? "Veri yok" : stock > 0 ? "Var" : "Yok"}</span></TableCell>
              <TableCell>{item.presence !== "present" ? <StatusBadge tone="warning">{item.presence === "inactive" ? "Pasif" : "Listede yok"}</StatusBadge> : item.conflicting ? <StatusBadge tone="error">Çelişkili</StatusBadge> : !item.price_data ? <StatusBadge tone="warning">Fiyat eksik</StatusBadge> : item.product_count > 1 ? <StatusBadge tone="info">Tekrar var</StatusBadge> : <span className="text-muted-foreground">—</span>}</TableCell>
              <TableCell className="pr-3"><SetaProductDetails item={item} cost={item.price_data ? `${number(item.price_data.nf)} ${item.product_data.dc}` : "Fiyat eksik"} salePrice={item.sale_price_kurus ? money(item.sale_price_kurus) : "Satışa kapalı"}/></TableCell>
            </TableRow>;
          })}</TableBody>
        </Table> : <EmptyState title="Filtrelere uygun ürün bulunamadı." icon={<SearchX/>}>Aramayı veya filtreleri değiştirebilirsiniz.</EmptyState>}
        <nav className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-sm" aria-label="Ürün sayfaları">
          <span className="text-muted-foreground tabular-nums">Sayfa {number(page)} / {number(pages)}</span>
          <div className="flex flex-wrap items-center gap-1">
            <PagerLink href={page > 1 ? pageUrl(page - 1) : null}><ChevronLeft/>Önceki</PagerLink>
            {pageNumbers.map((n, i, ns) => <span key={n} className="flex items-center gap-1">{i > 0 && n - ns[i - 1] > 1 && <span className="px-1 text-muted-foreground">…</span>}<ButtonLink size="sm" variant={n === page ? "default" : "ghost"} href={pageUrl(n)} aria-current={n === page ? "page" : undefined}>{n}</ButtonLink></span>)}
            <PagerLink href={page < pages ? pageUrl(page + 1) : null}>Sonraki<ChevronRight/></PagerLink>
          </div>
          <form action="/yonetim/tedarikciler/seta" className="flex items-center gap-2">{Object.entries(params).filter(([key]) => ["q", "category", "stock", "quality", "presence"].includes(key)).map(([key, value]) => <input key={key} type="hidden" name={key} value={value || ""}/>)}<label htmlFor="page-jump" className="text-muted-foreground">Sayfaya git</label><Input id="page-jump" className="h-7 w-16" type="number" name="page" min={1} max={pages} defaultValue={page}/><Button type="submit" size="sm" variant="outline">Git</Button></form>
        </nav>
      </div>}
    </Card></SupplierBrowser>
    }/>
  </AdminPage>;
}
