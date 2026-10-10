import { normalizeSearchParams, type SearchParams } from "@/lib/search-params";
import { SupplierRefreshAll } from "@/components/admin/supplier-refresh-all";
import { SupplierHealthStatus } from "@/components/admin/supplier-health-status";
import { SupplierTabs } from "@/components/admin/supplier-tabs";
import { SupplierBrowser } from "@/components/admin/supplier-browser";
import Link from "next/link";
import { CalendarClock, ChevronLeft, ChevronRight, History, PackageSearch, Search, SearchX } from "lucide-react";
import { AdminAddToCart } from "@/components/admin/admin-add-to-cart";
import { AdminPage, AdminPageHeader, AdminPanel, ButtonLink, EmptyState, PagerLink, StatusBadge, StatusMessage } from "@/components/admin/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { adminBasbugData } from "@/modules/admin/basbug";
import { refreshBasbug, saveBasbugCheckoutMode } from "./actions";
import { supplierCheckoutMode } from "@/modules/store/supplier-checkout-policy";
import { money } from "@/modules/store/catalog";
import { SupplierRefreshButton } from "@/components/admin/supplier-refresh-button";

const number = (value: number) => new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 6 }).format(value);
// Remove only insignificant trailing zeroes; preserve the source precision.
const rate = (value: string) => value.includes(".") ? value.replace(/0+$/, "").replace(/\.$/, "") : value;
const date = (value: Date) => value.toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" });
const errors: Record<string, string> = {
  rejected: "Ürün sayısı veya veri eksikliği güvenlik eşiğini aştı. Çekim inceleme için reddedildi; güncel veriler korunuyor.",
  paused: "Başbuğ API çekimleri durduruldu. Mevcut veriler korunuyor.",
  busy: "Bir aktarım zaten devam ediyor. Biraz sonra yeniden deneyin.",
  config: "Başbuğ bağlantı bilgilerini kontrol edin.",
  contract: "İstek veya yanıt beklenen veri yapısına uymadı. Önceki veriler korunuyor.",
  upstream: "Başbuğ verileri alınamadı. Önceki veriler korunuyor; yeniden deneyebilirsiniz.",
  mode: "Sipariş veri kaynağını kontrol edin.",
};

function runError(reason: string) {
  if (reason === "product-drop-over-20-percent") return "Ürün sayısı %20’den fazla azaldı; inceleme gerekli";
  if (reason === "missing-prices-increased-over-10-points") return "Eksik fiyat oranı 10 puandan fazla arttı; inceleme gerekli";
  if (reason === "missing-stocks-increased-over-10-points") return "Eksik stok oranı 10 puandan fazla arttı; inceleme gerekli";
  if (reason === "worker-interrupted") return "İşlem tamamlanmadan kesildi";
  if (reason.startsWith("config")) return "Bağlantı ayarları eksik veya geçersiz";
  if (reason.startsWith("contract")) return "Yanıt veri yapısı doğrulanamadı";
  if (reason.startsWith("upstream:")) {
    const stage = reason.split(":")[1]?.trim();
    const service = ({ Auth: "Oturum açma", ListeGrubuGetir: "Grup listesi", MalzemeleriGetir: "Ürün listesi", FiyatGetir: "Fiyat", StokGetir: "Stok", DovizBilgisiGetir: "Kur" } as Record<string, string>)[stage];
    if (service) return `${service} servisi: ${reason.endsWith(": timeout") ? "yanıt zaman aşımına uğradı" : reason.match(/HTTP \d{3}$/)?.[0] || "veri alınamadı"}`;
  }
  return "Servis veya kayıt işlemi tamamlanamadı";
}

export default async function BasbugAdmin({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = normalizeSearchParams(await searchParams);
  const data = await adminBasbugData(params);
  const checkoutMode = await supplierCheckoutMode();
  const { snapshot, group, knownGroups, items, brands, currencies, total, page, pages } = data;
  function pageUrl(target: number) {
    const query = new URLSearchParams({ group, page: String(target) });
    for (const key of ["q", "brand", "currency", "stock", "quality", "presence"] as const) if (params[key]) query.set(key, params[key]!);
    return `/yonetim/tedarikciler/basbug?${query}`;
  }
  const mrkScopes = data.health.scopes.filter(scope => scope.warehouse === "MRK");
  const lastCommerce = mrkScopes.map(scope => scope.commerce_last_success_at).filter((d): d is Date => Boolean(d)).sort((a, b) => b.getTime() - a.getTime())[0];
  const runTones: Record<string, "success" | "error" | "warning" | "info"> = { running: "info", succeeded: "success", failed: "error", rejected: "warning" };
  const runStatus = (status: string) => <StatusBadge tone={runTones[status] ?? "neutral"}>{({running:"Çalışıyor",succeeded:"Başarılı",failed:"Başarısız",rejected:"İnceleme gerekli"} as Record<string,string>)[status] || status}</StatusBadge>;
  const pageNumbers = Array.from(new Set([1, ...Array.from({length:5},(_,i)=>Math.max(1,Math.min(page-2,pages-4))+i),pages])).filter(n=>n>=1&&n<=pages).sort((a,b)=>a-b);
  const facts: [string, string, string][] = [
    ["Zamanlayıcı", data.health.heartbeat?.alive ? "Çalışıyor" : "Sinyal yok", `Son kontrol: ${data.health.heartbeat?.finished_at ? date(data.health.heartbeat.finished_at) : "henüz yok"}`],
    ["Son fiyat · stok · kur", lastCommerce ? date(lastCommerce) : "Henüz yok", `${mrkScopes.length} grup otomatik izleniyor`],
    ["Son tam aktarım", snapshot ? date(snapshot.completed_at) : "Henüz yok", snapshot ? `${snapshot.list_group} · ${number(snapshot.quality.uniqueProducts)} ürün` : "Grup seçilmedi"],
    ["Sipariş veri kaynağı", checkoutMode === "snapshot" ? "Kayıtlı veriler" : "Canlı API", checkoutMode === "snapshot" ? "Sipariş fiyat/stok teyidi bekler" : "Siparişte API doğrulaması"],
  ];
  return <AdminPage>
    <AdminPageHeader breadcrumbs={[{ label: "Yönetim", href: "/yonetim" }, { label: "Tedarikçiler", href: "/yonetim/tedarikciler" }, { label: "Başbuğ" }]} title="Başbuğ API"
      description="Ürün, kaynak fiyat ve depo stok verilerini incele; senkronizasyonu yönet." actions={<StatusBadge tone={data.health.healthy ? "success" : "warning"}>{data.health.healthy ? "Senkronizasyon sağlıklı" : "Dikkat gerekiyor"}</StatusBadge>}/>
    {params.updated === "1" && <StatusMessage>Veriler API’den çekildi ve güncel kayıtlar yenilendi.</StatusMessage>}
    {params.error && <StatusMessage tone="error">{errors[params.error] || errors.upstream}</StatusMessage>}
    {params.modeSaved === "1" && <StatusMessage>Sipariş veri kaynağı kaydedildi.</StatusMessage>}
    <Card className="py-0" role="region" aria-label="Başbuğ özet">
      <dl className="grid grid-cols-2 xl:grid-cols-4">{facts.map(([label, value, note], index) => <div key={label} className={cn("px-4 py-3", index % 2 === 1 && "border-l", index > 1 && "border-t xl:border-t-0", index > 0 && "xl:border-l")}>
        <dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 font-semibold tabular-nums">{value}<span className="block text-xs font-normal text-muted-foreground">{note}</span></dd>
      </div>)}</dl>
    </Card>
    <SupplierHealthStatus health={data.health} group={group} refresh={refreshBasbug}/>
    <SupplierTabs key={params.error ? `error-${params.error}` : params.updated ? `updated-${params.updated}` : "workspace"} initialTab={params.error ? "transfer" : "products"} transfer={<div className="flex flex-col gap-4">
      <AdminPanel title="Kaynağı güncelle" description="Başbuğ API’sinden çekilecek grubu seç. Bu seçim ürün filtrelerinden bağımsızdır." actions={<Badge variant="outline">API · MRK deposu</Badge>}>
        <form action={refreshBasbug} className="flex flex-wrap items-end gap-2">
          <Field className="w-full max-w-xs gap-1.5"><FieldLabel htmlFor="refresh-group">Çekilecek liste grubu</FieldLabel><NativeSelect id="refresh-group" className="w-full" name="group" defaultValue={group || "FIAT"}>{knownGroups.map(g => <NativeSelectOption key={g.kod} value={g.kod}>{g.ad} ({g.kod})</NativeSelectOption>)}</NativeSelect></Field>
          <SupplierRefreshButton/>
        </form>
        <p className="mt-2 mb-4 text-sm text-muted-foreground">Depo: MRK · Güncelleme seçilen grubu kapsar. NF, KDV hariç maliyettir; satış fiyatı döviz kuru, yönetilebilir kâr ve KDV ile hesaplanır. Stok sinyalleri adet değildir.</p>
        <SupplierRefreshAll groups={knownGroups.map(group => group.kod)}/>
      </AdminPanel>
      <AdminPanel title="Sepet ve sipariş" description={checkoutMode === "snapshot" ? "Kayıtlı fiyat, kur ve stok verileri kullanılıyor. Siparişte API çağrısı yapılmaz; kayıtlar stok ve fiyat teyidi bekler." : "Sipariş sırasında Başbuğ API’sinden fiyat ve stok doğrulanır. Güncellik sınırını aşan kayıtlar satışa kapanır."}
        actions={<><Link className="font-medium text-primary hover:underline" href="/sepet">Sepet →</Link><Link className="font-medium text-primary hover:underline" href="/yonetim/siparisler">Siparişler →</Link></>}>
        <form action={saveBasbugCheckoutMode} className="flex flex-wrap items-end gap-2">
          <Field className="w-full max-w-xs gap-1.5"><FieldLabel htmlFor="checkout-mode">Sipariş veri kaynağı</FieldLabel><NativeSelect id="checkout-mode" className="w-full" name="checkoutMode" defaultValue={checkoutMode}><NativeSelectOption value="snapshot">Kayıtlı veriler · Bakım süresince</NativeSelectOption><NativeSelectOption value="live">Canlı API doğrulaması</NativeSelectOption></NativeSelect></Field>
          <Button type="submit">Kaydet</Button>
        </form>
      </AdminPanel>
      <AdminPanel title="Otomatik güncelleme planı" description={`${data.sync?.enabled ? "Periyodik çekim etkin" : "Periyodik çekim kapalı"} · ${data.sync ? `Sonraki deneme: ${date(data.sync.next_run_at)}` : "Zamanlama kaydı bulunmuyor"} · ${group || "Tüm liste grupları"} · İstanbul saati`} flush>
        {data.health.scopes.length ? <Table><TableHeader><TableRow><TableHead className="pl-4">Grup</TableHead><TableHead>Ürün listesi</TableHead><TableHead>Fiyat · stok · kur</TableHead><TableHead>Son ticari güncelleme</TableHead><TableHead className="pr-4">Durum</TableHead></TableRow></TableHeader><TableBody>{data.health.scopes.filter(scope => !group || scope.list_group===group).map(scope => <TableRow key={`${scope.company}-${scope.list_group}-${scope.warehouse}`}>
          <TableCell className="pl-4 font-medium">{scope.list_group}</TableCell><TableCell>{scope.enabled ? `${scope.interval_minutes} dakikada bir` : "Kapalı"}</TableCell><TableCell>{scope.commerce_enabled ? `${scope.commerce_interval_minutes} dakikada bir` : "Kapalı"}</TableCell><TableCell className="tabular-nums">{scope.commerce_last_success_at ? date(scope.commerce_last_success_at) : "Henüz yok"}</TableCell>
          <TableCell className="pr-4"><StatusBadge tone={scope.catalog_stale || scope.commerce_stale ? "error" : scope.commerce_failures || scope.consecutive_failures ? "warning" : "success"}>{scope.catalog_stale || scope.commerce_stale ? "Güncellik aşıldı" : scope.commerce_failures || scope.consecutive_failures ? "Yeniden deneme bekliyor" : "Güncel"}</StatusBadge></TableCell>
        </TableRow>)}</TableBody></Table> : <EmptyState title="Otomatik güncelleme kapsamı tanımlı değil" icon={<CalendarClock/>}>Zamanlayıcı yapılandırıldığında gruplar burada listelenir.</EmptyState>}
      </AdminPanel>
      <AdminPanel title="Çekim geçmişi" description={`Son ${data.recentRuns.length} işlem · Periyodik çekim için zamanlayıcı komutunun sunucuda çalışması gerekir.`} flush>
        {data.recentRuns.length ? <Table><caption className="sr-only">Başbuğ veri çekim geçmişi</caption><TableHeader><TableRow><TableHead className="pl-4">Başlangıç</TableHead><TableHead>Kapsam</TableHead><TableHead>Durum</TableHead><TableHead className="text-right">Süre</TableHead><TableHead className="pr-4">Sonuç</TableHead></TableRow></TableHeader><TableBody>{data.recentRuns.map(run => <TableRow key={run.id} className="align-top">
          <TableCell className="pl-4 tabular-nums"><time dateTime={run.started_at.toISOString()}>{date(run.started_at)}</time><code className="block font-mono text-xs text-muted-foreground" title={run.id}>#{run.id.slice(0,8)}</code></TableCell>
          <TableCell><div className="font-medium">{run.list_group}</div><div className="text-xs text-muted-foreground">{run.run_kind === "commerce" ? "Fiyat · stok · kur" : "Tam ürün listesi"} · {run.warehouse}</div></TableCell>
          <TableCell>{runStatus(run.status)}</TableCell>
          <TableCell className="text-right tabular-nums">{run.completed_at ? `${number(Math.max(0,(run.completed_at.getTime()-run.started_at.getTime())/1000))} sn` : "Devam ediyor"}</TableCell>
          <TableCell className="pr-4 whitespace-normal">{run.status === "succeeded" ? <div className="grid grid-cols-3 gap-x-4 gap-y-0.5 text-xs text-muted-foreground tabular-nums">{([["added","yeni"],["changed","değişen"],["unchanged","aynı"],["missing","kayıp"],["inactive","pasif"],["restored","geri gelen"]] as const).map(([key,label]) => <span key={key}><b className="font-semibold text-foreground">{number(run.stats[key] ?? 0)}</b> {label}</span>)}</div> : run.error_reason ? runError(run.error_reason) : "İşlem sürüyor"}{run.review_note && <div className="text-xs text-muted-foreground">İnceleme notu: {run.review_note}</div>}</TableCell>
        </TableRow>)}</TableBody></Table> : <EmptyState title="Henüz çekim kaydı bulunmuyor" icon={<History/>}/>}
      </AdminPanel>
      {snapshot && <AdminPanel title="Veri kalitesi" description={`${snapshot.list_group} / ${snapshot.warehouse} · Son başarılı aktarım: ${date(snapshot.completed_at)} (İstanbul)`}
        footer={<span>{number(snapshot.quality.priceRows)} fiyat, {number(snapshot.quality.stockRows)} stok satırı · Eksik stok: {snapshot.quality.missingStocks} · Ürünle eşleşmeyen fiyat/stok: {snapshot.quality.orphanPrices}/{snapshot.quality.orphanStocks}</span>}>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {([["Aktarımdaki farklı ürün", snapshot.quality.uniqueProducts, null, `${number(snapshot.quality.productRows)} kaynak satırı`], ["Eksik fiyat", snapshot.quality.missingPrices, "missing-price", null], ["Tekrarlanan kod", snapshot.quality.duplicateCodes, "duplicates", null], ["Çelişkili kod", snapshot.quality.conflictingCodes, "conflicts", null]] as const).map(([label, value, quality, note]) => <div key={label} className="flex flex-col gap-1 rounded-lg border bg-muted/40 p-3">
            <span className="text-xs text-muted-foreground">{label}</span><strong className="text-xl font-semibold tabular-nums">{number(value)}</strong>
            {quality ? <Link data-supplier-tab="products" className="text-xs font-medium text-primary hover:underline" href={`?${new URLSearchParams({ group: snapshot.list_group, quality })}`}>Kayıtları incele →</Link> : <span className="text-xs text-muted-foreground">{note}</span>}
          </div>)}
        </div>
      </AdminPanel>}
      {snapshot && <AdminPanel title="Döviz kurları" description={`Kaynak API pariteleri · ${snapshot.list_group} · Çekim: ${date(snapshot.completed_at)} · Yürürlük tarihi API yanıtında bulunmuyor.`}>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-2">{snapshot.currencies_data.dovizListesi.map(c => <div key={c.dovizCinsi} className="rounded-lg border bg-muted/40 px-3 py-2">
          <div className="text-sm font-semibold">{c.dovizCinsi} <span className="font-normal text-muted-foreground">/ TRY</span></div>
          <dl className="mt-1 grid grid-cols-2 gap-2"><div><dt className="text-xs text-muted-foreground">Alış</dt><dd className="font-semibold tabular-nums" title={c.alis}>{rate(c.alis)}</dd></div><div><dt className="text-xs text-muted-foreground">Satış</dt><dd className="font-semibold tabular-nums" title={c.satis}>{rate(c.satis)}</dd></div></dl>
        </div>)}</div>
        <Collapsible className="mt-4">
          <CollapsibleTrigger className="group inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground"><ChevronRight className="size-4 transition-transform group-data-panel-open:rotate-90" aria-hidden="true"/>Verilerin çekilme zamanları</CollapsibleTrigger>
          <CollapsibleContent className="mt-2 overflow-hidden rounded-lg border"><Table><caption className="sr-only">Kaynak verilerinin çekilme zamanları</caption><TableHeader><TableRow><TableHead className="pl-3">Veri kaynağı</TableHead><TableHead>Liste / Depo</TableHead><TableHead className="pr-3">Çekilme zamanı (İstanbul)</TableHead></TableRow></TableHeader><TableBody>{Object.entries(snapshot.observations).map(([key,value]) => <TableRow key={key}><TableCell className="pl-3 font-medium">{({products:"Ürünler",prices:"Fiyatlar",stocks:"Stoklar",currencies:"Kurlar",groups:"Liste grupları"} as Record<string,string>)[key] || key}</TableCell><TableCell>{snapshot.list_group} / {snapshot.warehouse}</TableCell><TableCell className="pr-3 tabular-nums"><time dateTime={new Date(value).toISOString()}>{date(new Date(value))}</time></TableCell></TableRow>)}</TableBody></Table></CollapsibleContent>
        </Collapsible>
      </AdminPanel>}
    </div>} products={

    <SupplierBrowser><Card className="gap-0 py-0">
      <form key={[group,params.q,params.brand,params.currency,params.stock,params.presence,params.quality].join("|")} className="flex flex-wrap items-center gap-2 border-b p-3" action="/yonetim/tedarikciler/basbug">
        <InputGroup className="w-full sm:w-80"><InputGroupAddon><Search aria-hidden="true"/></InputGroupAddon><InputGroupInput name="q" aria-label="Ara" defaultValue={params.q} placeholder="Parça kodu, OEM, ürün adı veya marka" maxLength={120}/></InputGroup>
        <NativeSelect aria-label="Liste grubu" name="group" defaultValue={group}><NativeSelectOption value="">Tüm çekilmiş gruplar</NativeSelectOption>{knownGroups.map(g => <NativeSelectOption key={g.kod} value={g.kod}>{g.ad}{data.snapshots.some(s => s.list_group === g.kod) ? " · Verisi hazır" : " · Henüz çekilmedi"}</NativeSelectOption>)}</NativeSelect>
        <NativeSelect aria-label="Marka" name="brand" defaultValue={params.brand || ""}><NativeSelectOption value="">Tüm markalar</NativeSelectOption>{brands.map(b => <NativeSelectOption key={b} value={b}>{b || "Belirtilmemiş"}</NativeSelectOption>)}</NativeSelect>
        <NativeSelect aria-label="Para birimi" name="currency" defaultValue={params.currency || ""}><NativeSelectOption value="">Tüm para birimleri</NativeSelectOption>{currencies.map(c => <NativeSelectOption key={c} value={c}>{c}</NativeSelectOption>)}</NativeSelect>
        <NativeSelect aria-label="MRK stok sinyali" name="stock" defaultValue={params.stock || ""}><NativeSelectOption value="">MRK stok: tümü</NativeSelectOption><NativeSelectOption value="1">MRK stok sinyali: 1</NativeSelectOption><NativeSelectOption value="0">MRK stok sinyali: 0</NativeSelectOption></NativeSelect>
        <NativeSelect aria-label="Listede bulunma" name="presence" defaultValue={params.presence || "present"}><NativeSelectOption value="present">Güncel listede var</NativeSelectOption><NativeSelectOption value="pending_missing">İlk kez bulunamadı</NativeSelectOption><NativeSelectOption value="inactive">İki çekimde bulunamadı</NativeSelectOption><NativeSelectOption value="all">Tüm kayıtlar</NativeSelectOption></NativeSelect>
        <NativeSelect aria-label="Veri kalitesi" name="quality" defaultValue={params.quality || ""}><NativeSelectOption value="">Kalite: tümü</NativeSelectOption><NativeSelectOption value="missing-price">Fiyatı eksik</NativeSelectOption><NativeSelectOption value="duplicates">Tekrarlanan kod</NativeSelectOption><NativeSelectOption value="conflicts">Çelişkili kayıt</NativeSelectOption></NativeSelect>
        <Button type="submit">Filtrele</Button><ButtonLink variant="ghost" href={`?group=${group}`}>Temizle</ButtonLink>
      </form>
      {!snapshot ? <EmptyState title="Bu grubun verileri henüz çekilmedi." icon={<PackageSearch/>}>Senkronizasyon sekmesinden liste grubunu seçip API’den çekebilirsiniz.</EmptyState> : <div className="transition-opacity group-data-loading/browser:pointer-events-none group-data-loading/browser:opacity-45">
        <div className="flex justify-between gap-3 border-b px-4 py-2.5 text-sm text-muted-foreground tabular-nums"><span><strong className="text-foreground">{number(total)}</strong> ürün</span><span>{group || "Tüm liste grupları"} · MRK</span></div>
        {items.length ? <Table className="min-w-[1080px]"><caption className="sr-only">Başbuğ ürünleri ve kaynak fiyat/stok alanları</caption><TableHeader><TableRow><TableHead className="pl-4">Parça / OEM</TableHead><TableHead>Ürün / Marka</TableHead><TableHead>Para birimi</TableHead><TableHead className="text-right">LF</TableHead><TableHead className="text-right">NF</TableHead><TableHead className="text-right">MIF</TableHead><TableHead className="text-right">K</TableHead><TableHead title="Stok sinyalleri adet değildir">MRK sinyali</TableHead><TableHead>Kontrol</TableHead><TableHead className="pr-4">Satış · KDV dahil</TableHead></TableRow></TableHeader><TableBody>{items.map(item => <TableRow key={item.id} className="align-top">
          <TableCell className="max-w-60 pl-4"><Link className="font-mono text-xs font-medium text-primary hover:underline" href={`/yonetim/tedarikciler/basbug/urun/${item.id}`}>{item.code}</Link><div className="truncate text-xs text-muted-foreground">OEM: {item.product_data.oe || "—"}</div></TableCell>
          <TableCell className="max-w-80 whitespace-normal"><div className="font-medium">{item.product_data.ac}</div><div className="text-xs text-muted-foreground">{item.product_data.uk} · {item.product_data.ac2}</div></TableCell>
          <TableCell>{item.product_data.dc}</TableCell><TableCell className="text-right tabular-nums">{number(item.product_data.lf)}</TableCell><TableCell className="text-right tabular-nums">{item.price_data ? number(item.price_data.nf) : "Eksik"}</TableCell><TableCell className="text-right tabular-nums">{item.price_data ? number(item.price_data.mif) : "Eksik"}</TableCell><TableCell className="text-right tabular-nums">{item.price_data?.k ?? "—"}</TableCell>
          <TableCell title="Kaynak stok sinyali; adet doğrulanmadı"><StatusBadge tone={item.stock_data ? (Number(item.stock_data.stok) > 0 ? "success" : "neutral") : "warning"}>{item.stock_data ? `Sinyal ${item.stock_data.stok}` : "Eksik"}</StatusBadge></TableCell>
          <TableCell>{item.presence !== "present" ? <StatusBadge tone="warning">{item.presence === "inactive" ? "Pasif" : "Listede yok"}</StatusBadge> : item.conflicting ? <StatusBadge tone="error">Çelişkili</StatusBadge> : !item.price_data ? <StatusBadge tone="warning">Fiyat eksik</StatusBadge> : item.product_count > 1 || item.price_count > 1 || item.stock_count > 1 ? <StatusBadge tone="info">Tekrar var</StatusBadge> : <span className="text-muted-foreground">—</span>}<Link className="mt-1 block text-xs font-medium text-primary hover:underline" href={`/yonetim/tedarikciler/basbug/urun/${item.id}`}>Detay →</Link></TableCell>
          <TableCell className="pr-4"><div className="font-semibold tabular-nums">{item.sale_price_kurus ? money(item.sale_price_kurus) : "Satışa kapalı"}</div><div className="text-xs text-muted-foreground">{item.sale_stock_label}</div><AdminAddToCart productId={item.id} name={item.product_data.ac} available={Boolean(item.sale_available && item.sale_price_kurus)}/></TableCell>
        </TableRow>)}</TableBody></Table> : <EmptyState title="Filtrelere uygun ürün bulunamadı." icon={<SearchX/>}>Aramayı veya filtreleri değiştirebilirsiniz.</EmptyState>}
        <nav className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-sm" aria-label="Ürün sayfaları">
          <span className="text-muted-foreground tabular-nums">Sayfa {number(page)} / {number(pages)}</span>
          <div className="flex flex-wrap items-center gap-1">
            <PagerLink href={page > 1 ? pageUrl(page - 1) : null}><ChevronLeft/>Önceki</PagerLink>
            {pageNumbers.map((n,i,ns)=><span key={n} className="flex items-center gap-1">{i>0 && n-ns[i-1]>1 && <span className="px-1 text-muted-foreground">…</span>}<ButtonLink size="sm" variant={n===page ? "default" : "ghost"} href={pageUrl(n)} aria-current={n===page ? "page" : undefined}>{n}</ButtonLink></span>)}
            <PagerLink href={page < pages ? pageUrl(page + 1) : null}>Sonraki<ChevronRight/></PagerLink>
          </div>
          <form action="/yonetim/tedarikciler/basbug" className="flex items-center gap-2">{Object.entries(params).filter(([key])=>!["page","updated","error"].includes(key)).map(([key,value])=><input key={key} type="hidden" name={key} value={value || ""}/>)}<label htmlFor="page-jump" className="text-muted-foreground">Sayfaya git</label><Input id="page-jump" className="h-7 w-16" type="number" name="page" min={1} max={pages} defaultValue={page}/><Button type="submit" size="sm" variant="outline">Git</Button></form>
        </nav>
      </div>}
    </Card></SupplierBrowser>
    }/>
  </AdminPage>;
}
