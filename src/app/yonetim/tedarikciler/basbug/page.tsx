import { normalizeSearchParams, type SearchParams } from "@/lib/search-params";
import { SupplierRefreshAll } from "@/components/admin/supplier-refresh-all";
import { SupplierHealthStatus } from "@/components/admin/supplier-health-status";
import { SupplierTabs } from "@/components/admin/supplier-tabs";
import { SupplierBrowser } from "@/components/admin/supplier-browser";
import { SupplierProductDetails } from "@/components/admin/supplier-product-details";
import { AdminAddToCart } from "@/components/admin/admin-add-to-cart";
import Link from "next/link";
import { ArrowUpRight, CalendarClock, ChevronLeft, ChevronRight, History, PackageSearch, SearchX } from "lucide-react";
import { BasbugProductFilters } from "@/components/admin/basbug-product-filters";
import { AdminPage, AdminPageHeader, AdminPanel, ButtonLink, EmptyState, PagerLink, StatusBadge, StatusMessage } from "@/components/admin/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DialogTrigger } from "@/components/ui/dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { adminBasbugData } from "@/modules/admin/basbug";
import { refreshBasbug, saveBasbugCheckoutMode } from "./actions";
import { supplierCheckoutMode } from "@/modules/store/supplier-checkout-policy";
import { money } from "@/modules/store/catalog";
import { SupplierRefreshButton } from "@/components/admin/supplier-refresh-button";
import { basbugStockLabel, basbugWarehouse, basbugWarehouses, basbugWarehouseStock } from "@/modules/suppliers/basbug-stock";

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
    for (const key of ["q", "brand", "currency", "warehouse", "stock", "quality", "presence"] as const) if (params[key]) query.set(key, params[key]!);
    return `/yonetim/tedarikciler/basbug?${query}`;
  }
  const mrkScopes = data.health.scopes.filter(scope => scope.warehouse === "MRK");
  const lastCommerce = mrkScopes.map(scope => scope.commerce_last_success_at).filter((d): d is Date => Boolean(d)).sort((a, b) => b.getTime() - a.getTime())[0]
    ?? (snapshot?.observations.DovizBilgisiGetir ? new Date(snapshot.observations.DovizBilgisiGetir) : undefined);
  const runTones: Record<string, "success" | "error" | "warning" | "info"> = { running: "info", succeeded: "success", failed: "error", rejected: "warning" };
  const runStatus = (status: string) => <StatusBadge tone={runTones[status] ?? "neutral"}>{({running:"Çalışıyor",succeeded:"Başarılı",failed:"Başarısız",rejected:"İnceleme gerekli"} as Record<string,string>)[status] || status}</StatusBadge>;
  const pageNumbers = Array.from(new Set([1, ...Array.from({length:5},(_,i)=>Math.max(1,Math.min(page-2,pages-4))+i),pages])).filter(n=>n>=1&&n<=pages).sort((a,b)=>a-b);
  const facts: [string, string, string][] = [
    ["Zamanlayıcı", data.health.heartbeat?.alive ? "Çalışıyor" : "Sinyal yok", `Son kontrol: ${data.health.heartbeat?.finished_at ? date(data.health.heartbeat.finished_at) : "henüz yok"}`],
    ["Son fiyat · stok · kur", lastCommerce ? date(lastCommerce) : "Henüz yok", `${mrkScopes.length} grup otomatik izleniyor`],
    ["Son aktarım", snapshot ? date(snapshot.completed_at) : "Henüz yok", snapshot ? `${snapshot.list_group} · ${number(snapshot.quality.uniqueProducts)} ürün` : "Grup seçilmedi"],
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
      <AdminPanel title="Kaynağı güncelle" description="Başbuğ API’sinden çekilecek grubu seç. Bu seçim ürün filtrelerinden bağımsızdır." actions={<Badge variant="outline">API · Depo bazlı stok</Badge>}>
        <form action={refreshBasbug} className="flex flex-wrap items-end gap-2">
          <Field className="w-full max-w-xs gap-1.5"><FieldLabel htmlFor="refresh-group">Çekilecek liste grubu</FieldLabel><NativeSelect id="refresh-group" className="w-full" name="group" defaultValue={group || "FIAT"}>{knownGroups.map(g => <NativeSelectOption key={g.kod} value={g.kod}>{g.ad} ({g.kod})</NativeSelectOption>)}</NativeSelect></Field>
          <SupplierRefreshButton/>
        </form>
        <p className="mt-2 mb-4 text-sm text-muted-foreground">{basbugWarehouses.join(" · ")} depoları ayrı ayrı sorgulanır. Erişilemeyen depo için “Veri yok” gösterilir. Güncelleme seçilen grubu kapsar. NF, KDV hariç maliyettir; satış fiyatı döviz kuru, yönetilebilir kâr ve KDV ile hesaplanır.</p>
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
          <CollapsibleContent className="mt-2 overflow-hidden rounded-lg border"><Table><caption className="sr-only">Kaynak verilerinin çekilme zamanları</caption><TableHeader><TableRow><TableHead className="pl-3">Veri kaynağı</TableHead><TableHead>Liste / Depo</TableHead><TableHead className="pr-3">Çekilme zamanı (İstanbul)</TableHead></TableRow></TableHeader><TableBody>{Object.entries(snapshot.observations).filter(([key]) => key !== "StokGetir" || !snapshot.observations["StokGetir:MRK"]).map(([key,value]) => { const [service,depot,error] = key.split(":"); return <TableRow key={key}><TableCell className="pl-3 font-medium">{({MalzemeleriGetir:"Ürünler",FiyatGetir:"Fiyatlar",StokGetir:"Stoklar",DovizBilgisiGetir:"Kurlar",ListeGrubuGetir:"Liste grupları",products:"Ürünler",prices:"Fiyatlar",stocks:"Stoklar",currencies:"Kurlar",groups:"Liste grupları"} as Record<string,string>)[service] || service}{error === "607" && <span className="ml-2 text-xs text-amber-700 dark:text-amber-400">Depo erişimi yok (607)</span>}</TableCell><TableCell>{snapshot.list_group} / {depot || snapshot.warehouse}</TableCell><TableCell className="pr-3 tabular-nums"><time dateTime={new Date(value).toISOString()}>{date(new Date(value))}</time></TableCell></TableRow>; })}</TableBody></Table></CollapsibleContent>
        </Collapsible>
      </AdminPanel>}
    </div>} products={

    <SupplierBrowser><Card className="gap-0 py-0">
      <BasbugProductFilters key={[group,params.q,params.brand,params.currency,params.warehouse,params.stock,params.presence,params.quality].join("|")} params={params} groups={knownGroups.map(g => ({ ...g, ready: data.snapshots.some(s => s.list_group === g.kod) }))} brands={brands} currencies={currencies}/>
      {!snapshot ? <EmptyState title="Bu grubun verileri henüz çekilmedi." icon={<PackageSearch/>}>Senkronizasyon sekmesinden liste grubunu seçip API’den çekebilirsiniz.</EmptyState> : <div className="transition-opacity group-data-loading/browser:pointer-events-none group-data-loading/browser:opacity-45">
        <div className="flex flex-wrap justify-between gap-2 border-b px-4 py-2 text-xs text-muted-foreground tabular-nums"><span><strong className="text-foreground">{number(total)}</strong> ürün · {group || "Tüm liste grupları"}{params.stock && ` · ${basbugWarehouse(params.warehouse)}: ${params.stock === "1" ? "Stok var" : params.stock === "0" ? "Stok yok" : "Veri yok"}`}</span><span>NF: KDV hariç maliyet · Satış: KDV dahil</span></div>
        {items.length ? <Table className="min-w-[1220px] table-fixed text-xs [&_td]:py-1.5"><caption className="sr-only">Başbuğ ürünleri, fiyatları ve depo bazlı stok durumları</caption>
          <colgroup><col className="w-[112px]"/><col className="w-[92px]"/><col className="w-[184px]"/><col className="w-[80px]"/><col className="w-[36px]"/><col className="w-[78px]"/><col className="w-[100px]"/>{basbugWarehouses.map(depot => <col key={depot} className="w-[82px]"/>)}<col className="w-[90px]"/><col className="w-[34px]"/></colgroup>
          <TableHeader><TableRow className="bg-muted/40"><TableHead className="pl-4">Parça kodu</TableHead><TableHead>OEM</TableHead><TableHead>Ürün adı</TableHead><TableHead>Marka</TableHead><TableHead title="Kaynak para birimi">PB</TableHead><TableHead className="text-right" title="KDV hariç maliyet">NF</TableHead><TableHead className="text-right">Satış (₺)</TableHead>{basbugWarehouses.map(depot => <TableHead key={depot} className={cn("text-center", depot === basbugWarehouse(params.warehouse) && "bg-primary/5")} title={`${depot} depo stok durumu`}>{depot}</TableHead>)}<TableHead>Kontrol</TableHead><TableHead><span className="sr-only">Ürün detayı</span></TableHead></TableRow></TableHeader>
          <TableBody>{items.map(item => <SupplierProductDetails key={item.id} code={item.code} title={item.product_data.ac || "Ürün bilgisi yok"} supplier="Başbuğ" detailHref={`/yonetim/tedarikciler/basbug/urun/${item.id}`}
            fields={[
              ["Marka", item.product_data.uk], ["OEM", item.product_data.oe],
              ["Ek açıklama", item.product_data.ac2], ["Model", item.product_data.m],
              ["Motor", item.product_data.mo], ["Yıl", item.product_data.y],
              ["Birim", item.product_data.b], ["Liste grubu", item.product_data.lgk],
              ["NF · KDV hariç maliyet", item.price_data ? `${number(item.price_data.nf)} ${item.product_data.dc}` : "Fiyat eksik"],
              ["Satış fiyatı · KDV dahil", item.sale_price_kurus ? money(item.sale_price_kurus) : "Satışa kapalı"],
              ["Satış durumu", item.sale_stock_label || "Satışa kapalı"],
              ["Listede bulunma", item.presence === "present" ? "Güncel listede var" : item.presence === "inactive" ? "Pasif" : "Listede yok"],
              ["Veri kontrolü", item.conflicting ? "Çelişkili kayıt" : !item.price_data ? "Fiyat eksik" : item.product_count > 1 || item.price_count > 1 || item.stock_count > 1 ? "Tekrarlanan kod" : "—"],
              ["Kaynak satırları", `${item.product_count} ürün · ${item.price_count} fiyat · ${item.stock_count} stok`],
            ]}
            stockTitle="Depo stokları" stocks={basbugWarehouses.map(depot => { const stock = basbugWarehouseStock(item.stock_data, depot); return { label: depot, available: stock === null ? null : stock > 0 }; })}
            footer={<AdminAddToCart productId={item.id} name={item.product_data.ac} available={Boolean(item.sale_available && item.sale_price_kurus)}/>}>
          <TableRow>
            <TableCell className="pl-4"><DialogTrigger className="block w-full truncate text-left font-mono font-medium text-primary hover:underline" title={item.code} aria-label={`${item.code} ürün ayrıntılarını aç`}>{item.code}</DialogTrigger></TableCell>
            <TableCell className="truncate text-muted-foreground" title={item.product_data.oe}>{item.product_data.oe || "—"}</TableCell>
            <TableCell className="truncate font-medium" title={[item.product_data.ac,item.product_data.ac2].filter(Boolean).join(" · ")}>{item.product_data.ac}</TableCell>
            <TableCell className="truncate text-muted-foreground" title={item.product_data.uk}>{item.product_data.uk || "—"}</TableCell>
            <TableCell className="text-muted-foreground">{item.product_data.dc}</TableCell>
            <TableCell className="truncate text-right tabular-nums" title={item.price_data ? number(item.price_data.nf) : "Fiyat eksik"}>{item.price_data ? number(item.price_data.nf) : "Eksik"}</TableCell>
            <TableCell className="truncate text-right font-semibold tabular-nums" title={item.sale_price_kurus ? money(item.sale_price_kurus) : "Satış fiyatı yok"}>{item.sale_price_kurus ? money(item.sale_price_kurus) : "—"}</TableCell>
            {basbugWarehouses.map(depot => {
              const stock = basbugWarehouseStock(item.stock_data, depot);
              return <TableCell key={depot} className={cn("text-center", depot === basbugWarehouse(params.warehouse) && "bg-primary/5")}><span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap", stock === null ? "text-amber-700 dark:text-amber-400" : stock > 0 ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground")} title={stock === null ? `${depot}: Stok verisi alınamadı veya bu depoya erişim yok` : `${depot}: ${basbugStockLabel(stock)}`}><span className={cn("size-1.5 shrink-0 rounded-full", stock === null ? "bg-amber-500" : stock > 0 ? "bg-emerald-500" : "bg-muted-foreground/40")} aria-hidden="true"/>{basbugStockLabel(stock)}</span></TableCell>;
            })}
            <TableCell>{item.presence !== "present" ? <StatusBadge tone="warning">{item.presence === "inactive" ? "Pasif" : "Listede yok"}</StatusBadge> : item.conflicting ? <StatusBadge tone="error">Çelişkili</StatusBadge> : !item.price_data ? <StatusBadge tone="warning">Fiyat eksik</StatusBadge> : item.product_count > 1 || item.price_count > 1 || item.stock_count > 1 ? <StatusBadge tone="info">Tekrar var</StatusBadge> : <span className="text-muted-foreground">—</span>}</TableCell>
            <TableCell className="pr-3"><DialogTrigger className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-primary" aria-label={`${item.code} ürün detayı`} title="Ürün detayını aç"><ArrowUpRight className="size-3.5" aria-hidden="true"/></DialogTrigger></TableCell>
          </TableRow></SupplierProductDetails>)}</TableBody>
        </Table> : <EmptyState title="Filtrelere uygun ürün bulunamadı." icon={<SearchX/>}>Aramayı veya filtreleri değiştirebilirsiniz.</EmptyState>}
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
