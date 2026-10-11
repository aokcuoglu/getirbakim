import { Fragment } from "react";
import { normalizeSearchParams, type SearchParams } from "@/lib/search-params";
import { SupplierRefreshAll } from "@/components/admin/supplier-refresh-all";
import { SupplierHealthStatus } from "@/components/admin/supplier-health-status";
import { SupplierTabs } from "@/components/admin/supplier-tabs";
import { SupplierPartTable } from "@/components/admin/supplier-part-table";
import { basbugPartTableProps } from "@/components/admin/supplier-part-table-data";
import { SupplierBrowser } from "@/components/admin/supplier-browser";
import Link from "next/link";
import { ArrowRight, CalendarClock, CircleAlert, CircleCheck, History, Info, PackageSearch, TriangleAlert } from "lucide-react";
import { BasbugProductFilters } from "@/components/admin/basbug-product-filters";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item";
import { GroupFreshnessChart, RunDurationChart } from "@/components/admin/basbug-sync-charts";
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
import { SupplierRefreshButton } from "@/components/admin/supplier-refresh-button";
import { basbugWarehouse, basbugWarehouses } from "@/modules/suppliers/basbug-stock";

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
const statusBadge = (tone: Tone, text: string) => tone === "success" ? <Badge variant="success"><CircleCheck data-icon="inline-start" aria-hidden="true"/>{text}</Badge>
  : tone === "error" ? <Badge variant="destructive"><CircleAlert data-icon="inline-start" aria-hidden="true"/>{text}</Badge>
  : tone === "warning" ? <Badge variant="warning"><TriangleAlert data-icon="inline-start" aria-hidden="true"/>{text}</Badge>
  : tone === "info" ? <Badge variant="info"><Info data-icon="inline-start" aria-hidden="true"/>{text}</Badge> : <Badge variant="outline">{text}</Badge>;

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
  const scopes = data.health.scopes.filter(scope => !group || scope.list_group === group);
  const scopeState = (scope: typeof scopes[number]) => scope.catalog_stale || scope.commerce_stale ? "stale" : scope.commerce_failures || scope.consecutive_failures ? "retry" : "fresh";
  const freshness = { fresh: 0, retry: 0, stale: 0 };
  for (const scope of scopes) freshness[scopeState(scope)]++;
  const runDuration = (run: typeof data.recentRuns[number]) => run.completed_at ? `${number(Math.max(0, Math.round((run.completed_at.getTime() - run.started_at.getTime()) / 1000)))} sn` : "Devam ediyor";
  const runBars = [...data.recentRuns].reverse().map(run => ({ id: run.id, status: run.status, seconds: run.completed_at ? Math.max(0, Math.round((run.completed_at.getTime() - run.started_at.getTime()) / 1000)) : 0,
    label: run.started_at.toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) }));
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
    {params.updated === "1" && <Alert variant="success" role="status"><CircleCheck aria-hidden="true"/><AlertDescription>Veriler API’den çekildi ve güncel kayıtlar yenilendi.</AlertDescription></Alert>}
    {params.error && <Alert variant="destructive" role="alert"><CircleAlert aria-hidden="true"/><AlertDescription>{errors[params.error] || errors.upstream}</AlertDescription></Alert>}
    {params.modeSaved === "1" && <Alert variant="success" role="status"><CircleCheck aria-hidden="true"/><AlertDescription>Sipariş veri kaynağı kaydedildi.</AlertDescription></Alert>}
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" role="region" aria-label="Başbuğ özet">
      {facts.map(([label, value, note]) => <Card key={label} size="sm">
        <CardHeader><CardDescription>{label}</CardDescription><CardTitle className="tabular-nums">{value}</CardTitle></CardHeader>
        <CardContent className="text-muted-foreground">{note}</CardContent>
      </Card>)}
    </div>
    <SupplierHealthStatus health={data.health} group={group} refresh={refreshBasbug}/>
    <SupplierTabs key={params.error ? `error-${params.error}` : params.updated ? `updated-${params.updated}` : "workspace"} initialTab={params.error ? "transfer" : "products"} transfer={<div className="flex flex-col gap-6">
      <div className="grid items-start gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle><h2>Grup güncelliği</h2></CardTitle><CardDescription>{group || "Tüm liste grupları"}</CardDescription><CardAction><Badge variant={data.sync?.enabled ? "success" : "outline"}>{data.sync?.enabled ? "Periyodik çekim etkin" : "Periyodik çekim kapalı"}</Badge></CardAction></CardHeader>
          <CardContent className="flex flex-col gap-4">
            {scopes.length ? <div className="grid items-center gap-4 sm:grid-cols-2">
              <GroupFreshnessChart fresh={freshness.fresh} retry={freshness.retry} stale={freshness.stale}/>
              <ItemGroup>{([["fresh", "success", "Güncel"], ["retry", "warning", "Yeniden deneme bekliyor"], ["stale", "destructive", "Güncellik aşıldı"]] as const).map(([key, variant, label]) => <Item key={key} size="sm" variant="muted">
                <ItemContent><ItemTitle>{label}</ItemTitle></ItemContent>
                <ItemActions><Badge variant={variant} className="tabular-nums">{number(freshness[key])}</Badge></ItemActions>
              </Item>)}</ItemGroup>
            </div> : <Empty><EmptyHeader><EmptyMedia variant="icon"><CalendarClock/></EmptyMedia><EmptyTitle>Otomatik güncelleme kapsamı tanımlı değil</EmptyTitle><EmptyDescription>Zamanlayıcı yapılandırıldığında gruplar burada listelenir.</EmptyDescription></EmptyHeader></Empty>}
            {scopes.length > 0 && <Accordion className="rounded-lg border"><AccordionItem value="plan" className="px-4">
              <AccordionTrigger>Grup bazında plan</AccordionTrigger>
              <AccordionContent><Table><TableHeader><TableRow><TableHead>Grup</TableHead><TableHead>Ürün listesi</TableHead><TableHead>Fiyat · stok · kur</TableHead><TableHead>Son ticari güncelleme</TableHead><TableHead>Durum</TableHead></TableRow></TableHeader><TableBody>{scopes.map(scope => <TableRow key={`${scope.company}-${scope.list_group}-${scope.warehouse}`}>
                <TableCell className="font-medium">{scope.list_group}</TableCell><TableCell>{scope.enabled ? `${scope.interval_minutes} dk` : "Kapalı"}</TableCell><TableCell>{scope.commerce_enabled ? `${scope.commerce_interval_minutes} dk` : "Kapalı"}</TableCell><TableCell className="tabular-nums">{scope.commerce_last_success_at ? date(scope.commerce_last_success_at) : "Henüz yok"}</TableCell>
                <TableCell>{statusBadge(scopeState(scope) === "stale" ? "error" : scopeState(scope) === "retry" ? "warning" : "success", scopeState(scope) === "stale" ? "Güncellik aşıldı" : scopeState(scope) === "retry" ? "Yeniden deneme bekliyor" : "Güncel")}</TableCell>
              </TableRow>)}</TableBody></Table></AccordionContent>
            </AccordionItem></Accordion>}
          </CardContent>
          <CardFooter className="text-muted-foreground">Sonraki deneme: {data.sync ? date(data.sync.next_run_at) : "zamanlama kaydı yok"}</CardFooter>
        </Card>
        <Card>
          <CardHeader><CardTitle><h2>Son çekimler</h2></CardTitle><CardDescription>Son {data.recentRuns.length} işlemin süresi (sn)</CardDescription></CardHeader>
          <CardContent className="flex flex-col gap-4">
            {data.recentRuns.length ? <>
              <RunDurationChart runs={runBars}/>
              <ItemGroup>{data.recentRuns.slice(0, 5).map(run => <Item key={run.id} size="sm" variant="outline">
                <ItemContent><ItemTitle>{run.list_group} · {run.run_kind === "commerce" ? "Fiyat · stok · kur" : "Tam liste"}</ItemTitle><ItemDescription className="tabular-nums"><time dateTime={run.started_at.toISOString()}>{date(run.started_at)}</time></ItemDescription></ItemContent>
                <ItemActions><span className="text-muted-foreground tabular-nums">{runDuration(run)}</span>{runStatus(run.status)}</ItemActions>
              </Item>)}</ItemGroup>
              <Accordion className="rounded-lg border"><AccordionItem value="runs" className="px-4">
                <AccordionTrigger>Tüm çekimler</AccordionTrigger>
                <AccordionContent><Table><caption className="sr-only">Başbuğ veri çekim geçmişi</caption><TableHeader><TableRow><TableHead>Başlangıç</TableHead><TableHead>Kapsam</TableHead><TableHead>Durum</TableHead><TableHead className="text-right">Süre</TableHead><TableHead>Sonuç</TableHead></TableRow></TableHeader><TableBody>{data.recentRuns.map(run => <TableRow key={run.id} className="align-top">
                  <TableCell className="tabular-nums"><time dateTime={run.started_at.toISOString()}>{date(run.started_at)}</time><code className="block font-mono text-muted-foreground" title={run.id}>#{run.id.slice(0,8)}</code></TableCell>
                  <TableCell><div className="font-medium">{run.list_group}</div><div className="text-muted-foreground">{run.run_kind === "commerce" ? "Fiyat · stok · kur" : "Tam ürün listesi"} · {run.warehouse}</div></TableCell>
                  <TableCell>{runStatus(run.status)}</TableCell>
                  <TableCell className="text-right tabular-nums">{runDuration(run)}</TableCell>
                  <TableCell className="whitespace-normal">{run.status === "succeeded" ? <div className="grid grid-cols-3 gap-x-4 gap-y-1 text-muted-foreground tabular-nums">{([["added","yeni"],["changed","değişen"],["unchanged","aynı"],["missing","kayıp"],["inactive","pasif"],["restored","geri gelen"]] as const).map(([key,label]) => <span key={key}><b className="font-medium text-foreground">{number(run.stats[key] ?? 0)}</b> {label}</span>)}</div> : run.error_reason ? runError(run.error_reason) : "İşlem sürüyor"}{run.review_note && <div className="text-muted-foreground">İnceleme notu: {run.review_note}</div>}</TableCell>
                </TableRow>)}</TableBody></Table></AccordionContent>
              </AccordionItem></Accordion>
            </> : <Empty><EmptyHeader><EmptyMedia variant="icon"><History/></EmptyMedia><EmptyTitle>Henüz çekim kaydı bulunmuyor</EmptyTitle><EmptyDescription>Periyodik çekim için sunucuda zamanlayıcı çalışmalı.</EmptyDescription></EmptyHeader></Empty>}
          </CardContent>
        </Card>
      </div>
      {snapshot && <Card>
        <CardHeader><CardTitle><h2>Veri kalitesi</h2></CardTitle><CardDescription>{snapshot.list_group} / {snapshot.warehouse} · {date(snapshot.completed_at)}</CardDescription></CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {([["Farklı ürün", snapshot.quality.uniqueProducts, null, null], ["Eksik fiyat", snapshot.quality.missingPrices, "missing-price", "warning"], ["Tekrarlanan kod", snapshot.quality.duplicateCodes, "duplicates", "warning"], ["Çelişkili kod", snapshot.quality.conflictingCodes, "conflicts", "destructive"]] as const).map(([label, value, quality, tone]) => <Card key={label} size="sm">
              <CardHeader><CardDescription>{label}</CardDescription><CardTitle><span className="text-2xl font-semibold tabular-nums">{number(value)}</span></CardTitle>
                <CardAction>{!tone ? <Badge variant="info">{number(snapshot.quality.productRows)} satır</Badge> : value ? <Badge variant={tone}>{tone === "destructive" ? <CircleAlert data-icon="inline-start" aria-hidden="true"/> : <TriangleAlert data-icon="inline-start" aria-hidden="true"/>}İncele</Badge> : <Badge variant="success"><CircleCheck data-icon="inline-start" aria-hidden="true"/>Sorun yok</Badge>}</CardAction>
              </CardHeader>
              {quality && value > 0 && <CardContent><Button variant="link" nativeButton={false} render={<Link data-supplier-tab="products" href={`?${new URLSearchParams({ group: snapshot.list_group, quality })}`}/>}>Kayıtları incele<ArrowRight data-icon="inline-end" aria-hidden="true"/></Button></CardContent>}
            </Card>)}
          </div>
          <p className="text-muted-foreground tabular-nums">{([["Fiyat satırı", snapshot.quality.priceRows], ["Stok satırı", snapshot.quality.stockRows], ["Eksik stok", snapshot.quality.missingStocks], ["Eşleşmeyen fiyat/stok", `${number(snapshot.quality.orphanPrices)}/${number(snapshot.quality.orphanStocks)}`]] as const).map(([label, value]) => `${label}: ${typeof value === "number" ? number(value) : value}`).join(" · ")}</p>
        </CardContent>
      </Card>}
      <Card>
        <CardHeader><CardTitle><h2>İşlemler</h2></CardTitle><CardAction className="flex flex-wrap gap-1">
          <Button variant="link" nativeButton={false} render={<Link href="/sepet"/>}>Sepet<ArrowRight data-icon="inline-end" aria-hidden="true"/></Button>
          <Button variant="link" nativeButton={false} render={<Link href="/yonetim/siparisler"/>}>Siparişler<ArrowRight data-icon="inline-end" aria-hidden="true"/></Button>
        </CardAction></CardHeader>
        <CardContent className="grid gap-6 md:grid-cols-2">
          <form action={refreshBasbug}><Field>
            <FieldLabel htmlFor="refresh-group">Kaynağı güncelle</FieldLabel>
            <div className="flex flex-wrap gap-2"><NativeSelect id="refresh-group" name="group" defaultValue={group || "FIAT"}>{knownGroups.map(g => <NativeSelectOption key={g.kod} value={g.kod}>{g.ad} ({g.kod})</NativeSelectOption>)}</NativeSelect><SupplierRefreshButton/></div>
            <FieldDescription>Seçilen grup {basbugWarehouses.join(" · ")} depolarından çekilir.</FieldDescription>
          </Field></form>
          <form action={saveBasbugCheckoutMode}><Field>
            <FieldLabel htmlFor="checkout-mode">Sipariş veri kaynağı</FieldLabel>
            <div className="flex flex-wrap gap-2"><NativeSelect id="checkout-mode" name="checkoutMode" defaultValue={checkoutMode}><NativeSelectOption value="snapshot">Kayıtlı veriler · Bakım süresince</NativeSelectOption><NativeSelectOption value="live">Canlı API doğrulaması</NativeSelectOption></NativeSelect><Button type="submit">Kaydet</Button></div>
            <FieldDescription>{checkoutMode === "snapshot" ? "Siparişte API çağrılmaz; kayıtlar teyit bekler." : "Siparişte fiyat ve stok API’den doğrulanır."}</FieldDescription>
          </Field></form>
        </CardContent>
        <CardFooter><SupplierRefreshAll groups={knownGroups.map(group => group.kod)}/></CardFooter>
      </Card>
      {snapshot && <Card>
        <CardHeader><CardTitle><h2>Döviz kurları</h2></CardTitle><CardDescription>Kaynak API · {snapshot.list_group} · {date(snapshot.completed_at)}</CardDescription></CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">{snapshot.currencies_data.dovizListesi.map(c => <Item key={c.dovizCinsi} variant="outline" size="sm">
            <ItemContent><ItemTitle>{c.dovizCinsi} <span className="font-normal text-muted-foreground">/ TRY</span></ItemTitle>
              <span className="text-lg font-semibold tabular-nums" title={`Satış: ${c.satis}`}>{rate(c.satis)}</span>
              <ItemDescription className="tabular-nums" title={c.alis}>Alış {rate(c.alis)}</ItemDescription>
            </ItemContent>
          </Item>)}</div>
          <Accordion className="rounded-lg border"><AccordionItem value="observations" className="px-4">
            <AccordionTrigger>Verilerin çekilme zamanları</AccordionTrigger>
            <AccordionContent><Table><caption className="sr-only">Kaynak verilerinin çekilme zamanları</caption><TableHeader><TableRow><TableHead>Veri kaynağı</TableHead><TableHead>Liste / Depo</TableHead><TableHead>Çekilme zamanı (İstanbul)</TableHead></TableRow></TableHeader><TableBody>{Object.entries(snapshot.observations).filter(([key]) => key !== "StokGetir" || !snapshot.observations["StokGetir:MRK"]).map(([key,value]) => { const [service,depot,error] = key.split(":"); return <TableRow key={key}><TableCell className="font-medium"><div className="flex items-center gap-2">{({MalzemeleriGetir:"Ürünler",FiyatGetir:"Fiyatlar",StokGetir:"Stoklar",DovizBilgisiGetir:"Kurlar",ListeGrubuGetir:"Liste grupları",products:"Ürünler",prices:"Fiyatlar",stocks:"Stoklar",currencies:"Kurlar",groups:"Liste grupları"} as Record<string,string>)[service] || service}{error === "607" && statusBadge("warning", "Depo erişimi yok (607)")}</div></TableCell><TableCell>{snapshot.list_group} / {depot || snapshot.warehouse}</TableCell><TableCell className="tabular-nums"><time dateTime={new Date(value).toISOString()}>{date(new Date(value))}</time></TableCell></TableRow>; })}</TableBody></Table></AccordionContent>
          </AccordionItem></Accordion>
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
        <SupplierPartTable {...basbugPartTableProps(items, basbugWarehouse(params.warehouse))}/>
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
