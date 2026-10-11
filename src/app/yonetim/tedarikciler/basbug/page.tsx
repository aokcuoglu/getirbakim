import { Fragment } from "react";
import { normalizeSearchParams, type SearchParams } from "@/lib/search-params";
import { SupplierRefreshAll } from "@/components/admin/supplier-refresh-all";
import { SupplierHealthStatus } from "@/components/admin/supplier-health-status";
import { SupplierTabs } from "@/components/admin/supplier-tabs";
import { SupplierBrowser } from "@/components/admin/supplier-browser";
import { SupplierProductDetails } from "@/components/admin/supplier-product-details";
import { AdminAddToCart } from "@/components/admin/admin-add-to-cart";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, CalendarClock, ChevronsUpDown, CircleAlert, CircleCheck, History, Info, PackageSearch, SearchX, TriangleAlert } from "lucide-react";
import { BasbugProductFilters } from "@/components/admin/basbug-product-filters";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { DialogTrigger } from "@/components/ui/dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Pagination, PaginationContent, PaginationEllipsis, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from "@/components/ui/pagination";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { adminBasbugData } from "@/modules/admin/basbug";
import { refreshBasbug, saveBasbugCheckoutMode } from "./actions";
import { supplierCheckoutMode } from "@/modules/store/supplier-checkout-policy";
import { supplierActivity } from "@/modules/suppliers/activity";
import { SupplierActivityBadge } from "@/components/admin/supplier-activity-badge";
import { db } from "@/lib/db";
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

type Tone = "success" | "warning" | "error" | "info" | "neutral";
const statusBadge = (tone: Tone, text: string) => tone === "success" ? <Badge variant="secondary"><CircleCheck data-icon="inline-start" aria-hidden="true"/>{text}</Badge>
  : tone === "error" ? <Badge variant="destructive"><CircleAlert data-icon="inline-start" aria-hidden="true"/>{text}</Badge>
  : tone === "warning" ? <Badge variant="outline"><TriangleAlert data-icon="inline-start" aria-hidden="true"/>{text}</Badge>
  : tone === "info" ? <Badge variant="outline"><Info data-icon="inline-start" aria-hidden="true"/>{text}</Badge> : <Badge variant="outline">{text}</Badge>;

export default async function BasbugAdmin({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = normalizeSearchParams(await searchParams);
  const data = await adminBasbugData(params);
  const [checkoutMode, activity] = await Promise.all([supplierCheckoutMode(), supplierActivity(db, "basbug")]);
  const { snapshot, group, knownGroups, items, brands, currencies, total, page, pages } = data;
  function pageUrl(target: number) {
    const query = new URLSearchParams({ group, page: String(target) });
    for (const key of ["q", "brand", "currency", "warehouse", "stock", "quality", "presence"] as const) if (params[key]) query.set(key, params[key]!);
    return `/yonetim/tedarikciler/basbug?${query}`;
  }
  const mrkScopes = data.health.scopes.filter(scope => scope.warehouse === "MRK");
  const lastCommerce = mrkScopes.map(scope => scope.commerce_last_success_at).filter((d): d is Date => Boolean(d)).sort((a, b) => b.getTime() - a.getTime())[0]
    ?? (snapshot?.observations.DovizBilgisiGetir ? new Date(snapshot.observations.DovizBilgisiGetir) : undefined);
  const runTones: Record<string, Tone> = { running: "info", succeeded: "success", failed: "error", rejected: "warning" };
  const runStatus = (status: string) => statusBadge(runTones[status] ?? "neutral", ({running:"Çalışıyor",succeeded:"Başarılı",failed:"Başarısız",rejected:"İnceleme gerekli"} as Record<string,string>)[status] || status);
  const pageNumbers = Array.from(new Set([1, ...Array.from({length:5},(_,i)=>Math.max(1,Math.min(page-2,pages-4))+i),pages])).filter(n=>n>=1&&n<=pages).sort((a,b)=>a-b);
  const facts: [string, string, string][] = [
    ["Zamanlayıcı", data.health.heartbeat?.alive ? "Çalışıyor" : "Sinyal yok", `Son kontrol: ${data.health.heartbeat?.finished_at ? date(data.health.heartbeat.finished_at) : "henüz yok"}`],
    ["Son fiyat · stok · kur", lastCommerce ? date(lastCommerce) : "Henüz yok", `${mrkScopes.length} grup otomatik izleniyor`],
    ["Son aktarım", snapshot ? date(snapshot.completed_at) : "Henüz yok", snapshot ? `${snapshot.list_group} · ${number(snapshot.quality.uniqueProducts)} ürün` : "Grup seçilmedi"],
    ["Sipariş veri kaynağı", checkoutMode === "snapshot" ? "Kayıtlı veriler" : "Canlı API", checkoutMode === "snapshot" ? "Sipariş fiyat/stok teyidi bekler" : "Siparişte API doğrulaması"],
  ];
  return <div className="flex flex-col gap-6">
    <div className="flex flex-col gap-2">
      <Breadcrumb><BreadcrumbList>
        <BreadcrumbItem><BreadcrumbLink render={<Link href="/yonetim"/>}>Yönetim</BreadcrumbLink></BreadcrumbItem><BreadcrumbSeparator/>
        <BreadcrumbItem><BreadcrumbLink render={<Link href="/yonetim/tedarikciler"/>}>Tedarikçiler</BreadcrumbLink></BreadcrumbItem><BreadcrumbSeparator/>
        <BreadcrumbItem><BreadcrumbPage>Başbuğ</BreadcrumbPage></BreadcrumbItem>
      </BreadcrumbList></Breadcrumb>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Başbuğ API</h1>
          <p className="text-muted-foreground">Ürün, kaynak fiyat ve depo stok verilerini incele; senkronizasyonu yönet.</p>
        </div>
        <SupplierActivityBadge supplier="basbug" initial={activity}>{statusBadge(data.health.healthy ? "success" : "warning", data.health.healthy ? "Senkronizasyon sağlıklı" : "Dikkat gerekiyor")}</SupplierActivityBadge>
      </div>
    </div>
    {params.updated === "1" && <Alert role="status"><CircleCheck aria-hidden="true"/><AlertDescription>Veriler API’den çekildi ve güncel kayıtlar yenilendi.</AlertDescription></Alert>}
    {params.error && <Alert variant="destructive" role="alert"><CircleAlert aria-hidden="true"/><AlertDescription>{errors[params.error] || errors.upstream}</AlertDescription></Alert>}
    {params.modeSaved === "1" && <Alert role="status"><CircleCheck aria-hidden="true"/><AlertDescription>Sipariş veri kaynağı kaydedildi.</AlertDescription></Alert>}
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" role="region" aria-label="Başbuğ özet">
      {facts.map(([label, value, note]) => <Card key={label} size="sm">
        <CardHeader><CardDescription>{label}</CardDescription><CardTitle className="tabular-nums">{value}</CardTitle></CardHeader>
        <CardContent className="text-muted-foreground">{note}</CardContent>
      </Card>)}
    </div>
    <SupplierHealthStatus health={data.health} group={group} refresh={refreshBasbug}/>
    <SupplierTabs key={params.error ? `error-${params.error}` : params.updated ? `updated-${params.updated}` : "workspace"} initialTab={params.error ? "transfer" : "products"} transfer={<div className="flex flex-col gap-4">
      <Card>
        <CardHeader><CardTitle><h2>Kaynağı güncelle</h2></CardTitle><CardDescription>Başbuğ API’sinden çekilecek grubu seç. Bu seçim ürün filtrelerinden bağımsızdır.</CardDescription><CardAction><Badge variant="outline">API · Depo bazlı stok</Badge></CardAction></CardHeader>
        <CardContent className="flex flex-col gap-4">
          <form action={refreshBasbug} className="flex flex-wrap items-end gap-2">
            <Field className="max-w-xs"><FieldLabel htmlFor="refresh-group">Çekilecek liste grubu</FieldLabel><NativeSelect id="refresh-group" name="group" defaultValue={group || "FIAT"}>{knownGroups.map(g => <NativeSelectOption key={g.kod} value={g.kod}>{g.ad} ({g.kod})</NativeSelectOption>)}</NativeSelect></Field>
            <SupplierRefreshButton/>
          </form>
          <p className="text-muted-foreground">{basbugWarehouses.join(" · ")} depoları ayrı ayrı sorgulanır. Erişilemeyen depo için “Veri yok” gösterilir. Güncelleme seçilen grubu kapsar. NF, KDV hariç maliyettir; satış fiyatı döviz kuru, yönetilebilir kâr ve KDV ile hesaplanır.</p>
        </CardContent>
        <CardFooter><SupplierRefreshAll groups={knownGroups.map(group => group.kod)}/></CardFooter>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle><h2>Sepet ve sipariş</h2></CardTitle>
          <CardDescription>{checkoutMode === "snapshot" ? "Kayıtlı fiyat, kur ve stok verileri kullanılıyor. Siparişte API çağrısı yapılmaz; kayıtlar stok ve fiyat teyidi bekler." : "Sipariş sırasında Başbuğ API’sinden fiyat ve stok doğrulanır. Güncellik sınırını aşan kayıtlar satışa kapanır."}</CardDescription>
          <CardAction className="flex flex-wrap gap-1">
            <Button variant="link" size="sm" nativeButton={false} render={<Link href="/sepet"/>}>Sepet<ArrowRight data-icon="inline-end" aria-hidden="true"/></Button>
            <Button variant="link" size="sm" nativeButton={false} render={<Link href="/yonetim/siparisler"/>}>Siparişler<ArrowRight data-icon="inline-end" aria-hidden="true"/></Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          <form action={saveBasbugCheckoutMode} className="flex flex-wrap items-end gap-2">
            <Field className="max-w-xs"><FieldLabel htmlFor="checkout-mode">Sipariş veri kaynağı</FieldLabel><NativeSelect id="checkout-mode" name="checkoutMode" defaultValue={checkoutMode}><NativeSelectOption value="snapshot">Kayıtlı veriler · Bakım süresince</NativeSelectOption><NativeSelectOption value="live">Canlı API doğrulaması</NativeSelectOption></NativeSelect></Field>
            <Button type="submit">Kaydet</Button>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle><h2>Otomatik güncelleme planı</h2></CardTitle><CardDescription>{`${data.sync?.enabled ? "Periyodik çekim etkin" : "Periyodik çekim kapalı"} · ${data.sync ? `Sonraki deneme: ${date(data.sync.next_run_at)}` : "Zamanlama kaydı bulunmuyor"} · ${group || "Tüm liste grupları"} · İstanbul saati`}</CardDescription></CardHeader>
        <CardContent>
          {data.health.scopes.length ? <Table><TableHeader><TableRow><TableHead>Grup</TableHead><TableHead>Ürün listesi</TableHead><TableHead>Fiyat · stok · kur</TableHead><TableHead>Son ticari güncelleme</TableHead><TableHead>Durum</TableHead></TableRow></TableHeader><TableBody>{data.health.scopes.filter(scope => !group || scope.list_group===group).map(scope => <TableRow key={`${scope.company}-${scope.list_group}-${scope.warehouse}`}>
            <TableCell className="font-medium">{scope.list_group}</TableCell><TableCell>{scope.enabled ? `${scope.interval_minutes} dakikada bir` : "Kapalı"}</TableCell><TableCell>{scope.commerce_enabled ? `${scope.commerce_interval_minutes} dakikada bir` : "Kapalı"}</TableCell><TableCell className="tabular-nums">{scope.commerce_last_success_at ? date(scope.commerce_last_success_at) : "Henüz yok"}</TableCell>
            <TableCell>{statusBadge(scope.catalog_stale || scope.commerce_stale ? "error" : scope.commerce_failures || scope.consecutive_failures ? "warning" : "success", scope.catalog_stale || scope.commerce_stale ? "Güncellik aşıldı" : scope.commerce_failures || scope.consecutive_failures ? "Yeniden deneme bekliyor" : "Güncel")}</TableCell>
          </TableRow>)}</TableBody></Table> : <Empty><EmptyHeader><EmptyMedia variant="icon"><CalendarClock/></EmptyMedia><EmptyTitle>Otomatik güncelleme kapsamı tanımlı değil</EmptyTitle><EmptyDescription>Zamanlayıcı yapılandırıldığında gruplar burada listelenir.</EmptyDescription></EmptyHeader></Empty>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle><h2>Çekim geçmişi</h2></CardTitle><CardDescription>Son {data.recentRuns.length} işlem · Periyodik çekim için zamanlayıcı komutunun sunucuda çalışması gerekir.</CardDescription></CardHeader>
        <CardContent>
          {data.recentRuns.length ? <Table><caption className="sr-only">Başbuğ veri çekim geçmişi</caption><TableHeader><TableRow><TableHead>Başlangıç</TableHead><TableHead>Kapsam</TableHead><TableHead>Durum</TableHead><TableHead className="text-right">Süre</TableHead><TableHead>Sonuç</TableHead></TableRow></TableHeader><TableBody>{data.recentRuns.map(run => <TableRow key={run.id} className="align-top">
            <TableCell className="tabular-nums"><time dateTime={run.started_at.toISOString()}>{date(run.started_at)}</time><code className="block font-mono text-muted-foreground" title={run.id}>#{run.id.slice(0,8)}</code></TableCell>
            <TableCell><div className="font-medium">{run.list_group}</div><div className="text-muted-foreground">{run.run_kind === "commerce" ? "Fiyat · stok · kur" : "Tam ürün listesi"} · {run.warehouse}</div></TableCell>
            <TableCell>{runStatus(run.status)}</TableCell>
            <TableCell className="text-right tabular-nums">{run.completed_at ? `${number(Math.max(0,(run.completed_at.getTime()-run.started_at.getTime())/1000))} sn` : "Devam ediyor"}</TableCell>
            <TableCell className="whitespace-normal">{run.status === "succeeded" ? <div className="grid grid-cols-3 gap-x-4 gap-y-1 text-muted-foreground tabular-nums">{([["added","yeni"],["changed","değişen"],["unchanged","aynı"],["missing","kayıp"],["inactive","pasif"],["restored","geri gelen"]] as const).map(([key,label]) => <span key={key}><b className="font-medium text-foreground">{number(run.stats[key] ?? 0)}</b> {label}</span>)}</div> : run.error_reason ? runError(run.error_reason) : "İşlem sürüyor"}{run.review_note && <div className="text-muted-foreground">İnceleme notu: {run.review_note}</div>}</TableCell>
          </TableRow>)}</TableBody></Table> : <Empty><EmptyHeader><EmptyMedia variant="icon"><History/></EmptyMedia><EmptyTitle>Henüz çekim kaydı bulunmuyor</EmptyTitle></EmptyHeader></Empty>}
        </CardContent>
      </Card>
      {snapshot && <Card>
        <CardHeader><CardTitle><h2>Veri kalitesi</h2></CardTitle><CardDescription>{snapshot.list_group} / {snapshot.warehouse} · Son başarılı aktarım: {date(snapshot.completed_at)} (İstanbul)</CardDescription></CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {([["Aktarımdaki farklı ürün", snapshot.quality.uniqueProducts, null, `${number(snapshot.quality.productRows)} kaynak satırı`], ["Eksik fiyat", snapshot.quality.missingPrices, "missing-price", null], ["Tekrarlanan kod", snapshot.quality.duplicateCodes, "duplicates", null], ["Çelişkili kod", snapshot.quality.conflictingCodes, "conflicts", null]] as const).map(([label, value, quality, note]) => <Card key={label} size="sm">
              <CardHeader><CardDescription>{label}</CardDescription><CardTitle className="text-2xl font-semibold tabular-nums">{number(value)}</CardTitle></CardHeader>
              <CardContent>{quality ? <Button variant="link" size="xs" nativeButton={false} render={<Link data-supplier-tab="products" href={`?${new URLSearchParams({ group: snapshot.list_group, quality })}`}/>}>Kayıtları incele<ArrowRight data-icon="inline-end" aria-hidden="true"/></Button> : <span className="text-muted-foreground">{note}</span>}</CardContent>
            </Card>)}
          </div>
        </CardContent>
        <CardFooter className="text-muted-foreground">{number(snapshot.quality.priceRows)} fiyat, {number(snapshot.quality.stockRows)} stok satırı · Eksik stok: {snapshot.quality.missingStocks} · Ürünle eşleşmeyen fiyat/stok: {snapshot.quality.orphanPrices}/{snapshot.quality.orphanStocks}</CardFooter>
      </Card>}
      {snapshot && <Card>
        <CardHeader><CardTitle><h2>Döviz kurları</h2></CardTitle><CardDescription>Kaynak API pariteleri · {snapshot.list_group} · Çekim: {date(snapshot.completed_at)} · Yürürlük tarihi API yanıtında bulunmuyor.</CardDescription></CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">{snapshot.currencies_data.dovizListesi.map(c => <Card key={c.dovizCinsi} size="sm">
            <CardHeader><CardTitle>{c.dovizCinsi} <span className="font-normal text-muted-foreground">/ TRY</span></CardTitle></CardHeader>
            <CardContent><dl className="grid grid-cols-2 gap-2"><div><dt className="text-muted-foreground">Alış</dt><dd className="font-medium tabular-nums" title={c.alis}>{rate(c.alis)}</dd></div><div><dt className="text-muted-foreground">Satış</dt><dd className="font-medium tabular-nums" title={c.satis}>{rate(c.satis)}</dd></div></dl></CardContent>
          </Card>)}</div>
          <Collapsible>
            <CollapsibleTrigger render={<Button variant="link" size="sm"/>}><ChevronsUpDown data-icon="inline-start" aria-hidden="true"/>Verilerin çekilme zamanları</CollapsibleTrigger>
            <CollapsibleContent><Table><caption className="sr-only">Kaynak verilerinin çekilme zamanları</caption><TableHeader><TableRow><TableHead>Veri kaynağı</TableHead><TableHead>Liste / Depo</TableHead><TableHead>Çekilme zamanı (İstanbul)</TableHead></TableRow></TableHeader><TableBody>{Object.entries(snapshot.observations).filter(([key]) => key !== "StokGetir" || !snapshot.observations["StokGetir:MRK"]).map(([key,value]) => { const [service,depot,error] = key.split(":"); return <TableRow key={key}><TableCell className="font-medium"><div className="flex items-center gap-2">{({MalzemeleriGetir:"Ürünler",FiyatGetir:"Fiyatlar",StokGetir:"Stoklar",DovizBilgisiGetir:"Kurlar",ListeGrubuGetir:"Liste grupları",products:"Ürünler",prices:"Fiyatlar",stocks:"Stoklar",currencies:"Kurlar",groups:"Liste grupları"} as Record<string,string>)[service] || service}{error === "607" && statusBadge("warning", "Depo erişimi yok (607)")}</div></TableCell><TableCell>{snapshot.list_group} / {depot || snapshot.warehouse}</TableCell><TableCell className="tabular-nums"><time dateTime={new Date(value).toISOString()}>{date(new Date(value))}</time></TableCell></TableRow>; })}</TableBody></Table></CollapsibleContent>
          </Collapsible>
        </CardContent>
      </Card>}
    </div>} products={
    <SupplierBrowser><Card>
      <CardHeader className="border-b">
        <BasbugProductFilters key={[group,params.q,params.brand,params.currency,params.warehouse,params.stock,params.presence,params.quality].join("|")} params={params} groups={knownGroups.map(g => ({ ...g, ready: data.snapshots.some(s => s.list_group === g.kod) }))} brands={brands} currencies={currencies}/>
      </CardHeader>
      {!snapshot ? <CardContent><Empty><EmptyHeader><EmptyMedia variant="icon"><PackageSearch/></EmptyMedia><EmptyTitle>Bu grubun verileri henüz çekilmedi.</EmptyTitle><EmptyDescription>Senkronizasyon sekmesinden liste grubunu seçip API’den çekebilirsiniz.</EmptyDescription></EmptyHeader></Empty></CardContent> : <>
      <CardContent className="flex flex-col gap-3 group-data-loading/browser:pointer-events-none group-data-loading/browser:opacity-50">
        <div className="flex flex-wrap justify-between gap-2 text-muted-foreground tabular-nums"><span><strong className="text-foreground">{number(total)}</strong> ürün · {group || "Tüm liste grupları"}{params.stock && ` · ${basbugWarehouse(params.warehouse)}: ${params.stock === "1" ? "Stok var" : params.stock === "0" ? "Stok yok" : "Veri yok"}`}</span><span>NF: KDV hariç maliyet · Satış: KDV dahil</span></div>
        {items.length ? <Table><caption className="sr-only">Başbuğ ürünleri, fiyatları ve depo bazlı stok durumları</caption>
          <TableHeader><TableRow><TableHead>Parça kodu</TableHead><TableHead>OEM</TableHead><TableHead>Ürün adı</TableHead><TableHead>Marka</TableHead><TableHead title="Kaynak para birimi">PB</TableHead><TableHead className="text-right" title="KDV hariç maliyet">NF</TableHead><TableHead className="text-right">Satış (₺)</TableHead>{basbugWarehouses.map(depot => <TableHead key={depot} className="text-center" title={`${depot} depo stok durumu`}>{depot === basbugWarehouse(params.warehouse) ? <strong>{depot}</strong> : depot}</TableHead>)}<TableHead>Kontrol</TableHead><TableHead><span className="sr-only">Ürün detayı</span></TableHead></TableRow></TableHeader>
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
            <TableCell><DialogTrigger render={<Button variant="link" size="sm" className="font-mono" title={item.code} aria-label={`${item.code} ürün ayrıntılarını aç`}/>}>{item.code}</DialogTrigger></TableCell>
            <TableCell className="max-w-32 truncate text-muted-foreground" title={item.product_data.oe}>{item.product_data.oe || "—"}</TableCell>
            <TableCell className="max-w-64 truncate font-medium" title={[item.product_data.ac,item.product_data.ac2].filter(Boolean).join(" · ")}>{item.product_data.ac}</TableCell>
            <TableCell className="max-w-32 truncate text-muted-foreground" title={item.product_data.uk}>{item.product_data.uk || "—"}</TableCell>
            <TableCell className="text-muted-foreground">{item.product_data.dc}</TableCell>
            <TableCell className="text-right tabular-nums" title={item.price_data ? number(item.price_data.nf) : "Fiyat eksik"}>{item.price_data ? number(item.price_data.nf) : <Badge variant="outline">Eksik</Badge>}</TableCell>
            <TableCell className="text-right font-medium tabular-nums" title={item.sale_price_kurus ? money(item.sale_price_kurus) : "Satış fiyatı yok"}>{item.sale_price_kurus ? money(item.sale_price_kurus) : "—"}</TableCell>
            {basbugWarehouses.map(depot => {
              const stock = basbugWarehouseStock(item.stock_data, depot);
              return <TableCell key={depot} className="text-center"><Badge variant={stock !== null && stock > 0 ? "secondary" : "outline"} title={stock === null ? `${depot}: Stok verisi alınamadı veya bu depoya erişim yok` : `${depot}: ${basbugStockLabel(stock)}`}>{basbugStockLabel(stock)}</Badge></TableCell>;
            })}
            <TableCell>{item.presence !== "present" ? statusBadge("warning", item.presence === "inactive" ? "Pasif" : "Listede yok") : item.conflicting ? statusBadge("error", "Çelişkili") : !item.price_data ? statusBadge("warning", "Fiyat eksik") : item.product_count > 1 || item.price_count > 1 || item.stock_count > 1 ? statusBadge("info", "Tekrar var") : <span className="text-muted-foreground">—</span>}</TableCell>
            <TableCell><DialogTrigger render={<Button variant="ghost" size="icon-xs" aria-label={`${item.code} ürün detayı`} title="Ürün detayını aç"/>}><ArrowUpRight aria-hidden="true"/></DialogTrigger></TableCell>
          </TableRow></SupplierProductDetails>)}</TableBody>
        </Table> : <Empty><EmptyHeader><EmptyMedia variant="icon"><SearchX/></EmptyMedia><EmptyTitle>Filtrelere uygun ürün bulunamadı.</EmptyTitle><EmptyDescription>Aramayı veya filtreleri değiştirebilirsiniz.</EmptyDescription></EmptyHeader></Empty>}
      </CardContent>
      <CardFooter className="flex-wrap justify-between gap-3">
        <span className="text-muted-foreground tabular-nums">Sayfa {number(page)} / {number(pages)}</span>
        <Pagination className="mx-0 w-auto" aria-label="Ürün sayfaları"><PaginationContent>
          <PaginationItem><PaginationPrevious text="Önceki" aria-label="Önceki sayfa" href={page > 1 ? pageUrl(page - 1) : undefined} aria-disabled={page <= 1 || undefined}/></PaginationItem>
          {pageNumbers.map((n, i, ns) => <Fragment key={n}>{i > 0 && n - ns[i - 1] > 1 && <PaginationItem><PaginationEllipsis/></PaginationItem>}<PaginationItem><PaginationLink href={pageUrl(n)} isActive={n === page}>{n}</PaginationLink></PaginationItem></Fragment>)}
          <PaginationItem><PaginationNext text="Sonraki" aria-label="Sonraki sayfa" href={page < pages ? pageUrl(page + 1) : undefined} aria-disabled={page >= pages || undefined}/></PaginationItem>
        </PaginationContent></Pagination>
        <form action="/yonetim/tedarikciler/basbug" className="flex items-center gap-2">{Object.entries(params).filter(([key])=>!["page","updated","error"].includes(key)).map(([key,value])=><input key={key} type="hidden" name={key} value={value || ""}/>)}<Label htmlFor="page-jump">Sayfaya git</Label><Input id="page-jump" className="w-20" type="number" name="page" min={1} max={pages} defaultValue={page}/><Button type="submit" variant="outline">Git</Button></form>
      </CardFooter>
      </>}
    </Card></SupplierBrowser>
    }/>
  </div>;
}
