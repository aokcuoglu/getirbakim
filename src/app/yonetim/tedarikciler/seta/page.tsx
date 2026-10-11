import { supplierActivity } from "@/modules/suppliers/activity";
import { SupplierActivityBadge } from "@/components/admin/supplier-activity-badge";
import { db } from "@/lib/db";
import { normalizeSearchParams, type SearchParams } from "@/lib/search-params";
import { SupplierTabs } from "@/components/admin/supplier-tabs";
import { SupplierBrowser } from "@/components/admin/supplier-browser";
import { SupplierRefreshButton } from "@/components/admin/supplier-refresh-button";
import { AdminAddToCart } from "@/components/admin/admin-add-to-cart";
import Link from "next/link";
import { ChevronLeft, ChevronRight, History, PackageSearch, Search, SearchX } from "lucide-react";
import { AdminPage, AdminPageHeader, AdminPanel, ButtonLink, EmptyState, PagerLink, StatusBadge, StatusMessage } from "@/components/admin/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
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
      <form key={[params.q, params.category, params.stock, params.presence, params.quality].join("|")} className="flex flex-wrap items-center gap-2 border-b p-3" action="/yonetim/tedarikciler/seta">
        <InputGroup className="w-full sm:w-80"><InputGroupAddon><Search aria-hidden="true"/></InputGroupAddon><InputGroupInput name="q" aria-label="Ara" defaultValue={params.q} placeholder="Ürün kodu, OEM veya araç" maxLength={120}/></InputGroup>
        <NativeSelect aria-label="Kategori" name="category" defaultValue={params.category || ""}><NativeSelectOption value="">Tüm kategoriler</NativeSelectOption>{categories.map(c => <NativeSelectOption key={c} value={c}>{c}</NativeSelectOption>)}</NativeSelect>
        <NativeSelect aria-label="Stok" name="stock" defaultValue={params.stock || ""}><NativeSelectOption value="">Stok: tümü</NativeSelectOption><NativeSelectOption value="1">Stokta var</NativeSelectOption><NativeSelectOption value="0">Stokta yok</NativeSelectOption></NativeSelect>
        <NativeSelect aria-label="Listede bulunma" name="presence" defaultValue={params.presence || "present"}><NativeSelectOption value="present">Güncel listede var</NativeSelectOption><NativeSelectOption value="pending_missing">İlk kez bulunamadı</NativeSelectOption><NativeSelectOption value="inactive">İki çekimde bulunamadı</NativeSelectOption><NativeSelectOption value="all">Tüm kayıtlar</NativeSelectOption></NativeSelect>
        <NativeSelect aria-label="Veri kalitesi" name="quality" defaultValue={params.quality || ""}><NativeSelectOption value="">Kalite: tümü</NativeSelectOption><NativeSelectOption value="missing-price">Fiyatı eksik</NativeSelectOption><NativeSelectOption value="conflicts">Çelişkili kayıt</NativeSelectOption></NativeSelect>
        <Button type="submit">Filtrele</Button><ButtonLink variant="ghost" href="/yonetim/tedarikciler/seta">Temizle</ButtonLink>
      </form>
      {!snapshot ? <EmptyState title="SETA listesi henüz çekilmedi." icon={<PackageSearch/>}>Senkronizasyon sekmesinden listeyi API’den çekebilirsiniz.</EmptyState> : <div className="transition-opacity group-data-loading/browser:pointer-events-none group-data-loading/browser:opacity-45">
        <div className="flex justify-between gap-3 border-b px-4 py-2.5 text-sm text-muted-foreground tabular-nums"><span><strong className="text-foreground">{number(total)}</strong> ürün</span><span>Tek liste</span></div>
        {items.length ? <Table className="min-w-[960px]"><caption className="sr-only">SETA ürünleri ve kaynak fiyat/stok alanları</caption><TableHeader><TableRow><TableHead className="pl-4">Kod / OEM</TableHead><TableHead>Ürün / Araç</TableHead><TableHead>Çapraz referans</TableHead><TableHead className="text-right">Bayi fiyatı</TableHead><TableHead>Stok</TableHead><TableHead className="pr-4">Satış · KDV dahil</TableHead></TableRow></TableHeader><TableBody>{items.map(item => <TableRow key={item.id} className="align-top">
          <TableCell className="max-w-60 pl-4"><span className="font-mono text-xs font-medium">{item.code}</span><div className="truncate text-xs text-muted-foreground" title={item.product_data.oe}>OEM: {item.product_data.oe || "—"}</div></TableCell>
          <TableCell className="max-w-96 whitespace-normal"><div className="font-medium">{item.product_data.ac}</div><div className="text-xs text-muted-foreground">{[item.product_data.vehicle_brand, item.product_data.ac2].filter(Boolean).join(" · ")}</div></TableCell>
          <TableCell className="max-w-64 whitespace-normal text-xs text-muted-foreground">{Object.entries(item.product_data.cross ?? {}).map(([brand, code]) => `${brand || "?"} ${code}`).join(" · ") || "—"}</TableCell>
          <TableCell className="text-right tabular-nums">{item.price_data ? `${number(item.price_data.nf)} ${item.product_data.dc}` : <StatusBadge tone="warning">Fiyat yok</StatusBadge>}</TableCell>
          <TableCell>{item.presence !== "present" ? <StatusBadge tone="warning">{item.presence === "inactive" ? "Pasif" : "Listede yok"}</StatusBadge> : item.conflicting ? <StatusBadge tone="error">Çelişkili</StatusBadge> : <StatusBadge tone={item.stock_data?.stok ? "success" : "neutral"}>{item.stock_data?.stok ? "Var" : "Yok"}</StatusBadge>}</TableCell>
          <TableCell className="pr-4"><div className="font-semibold tabular-nums">{item.sale_price_kurus ? money(item.sale_price_kurus) : "Satışa kapalı"}</div><div className="text-xs text-muted-foreground">{item.sale_stock_label}</div><AdminAddToCart productId={item.id} name={item.product_data.ac} available={Boolean(item.sale_available && item.sale_price_kurus)}/></TableCell>
        </TableRow>)}</TableBody></Table> : <EmptyState title="Filtrelere uygun ürün bulunamadı." icon={<SearchX/>}>Aramayı veya filtreleri değiştirebilirsiniz.</EmptyState>}
        <nav className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-sm" aria-label="Ürün sayfaları">
          <span className="text-muted-foreground tabular-nums">Sayfa {number(page)} / {number(pages)}</span>
          <div className="flex flex-wrap items-center gap-1">
            <PagerLink href={page > 1 ? pageUrl(page - 1) : null}><ChevronLeft/>Önceki</PagerLink>
            {pageNumbers.map((n, i, ns) => <span key={n} className="flex items-center gap-1">{i > 0 && n - ns[i - 1] > 1 && <span className="px-1 text-muted-foreground">…</span>}<ButtonLink size="sm" variant={n === page ? "default" : "ghost"} href={pageUrl(n)} aria-current={n === page ? "page" : undefined}>{n}</ButtonLink></span>)}
            <PagerLink href={page < pages ? pageUrl(page + 1) : null}>Sonraki<ChevronRight/></PagerLink>
          </div>
          <Link className="font-medium text-primary hover:underline" href="/yonetim/fiyatlandirma">Fiyatlandırma →</Link>
        </nav>
      </div>}
    </Card></SupplierBrowser>
    }/>
  </AdminPage>;
}
