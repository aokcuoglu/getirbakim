import { Fragment } from "react";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, CircleAlert, CircleCheck, Info, SearchX, TriangleAlert } from "lucide-react";
import { normalizeSearchParams, type SearchParams } from "@/lib/search-params";
import { requireAdmin } from "@/modules/auth/session";
import { supplierStatuses } from "@/modules/suppliers/clients";
import { supplierHealth } from "@/modules/suppliers/health";
import { DINAMIK_COMPANY } from "@/modules/suppliers/dinamik-import";
import { adminDinamikOverview } from "@/modules/admin/data";
import { adminDinamikItems } from "@/modules/admin/dinamik";
import { dinamikRegion, dinamikRegions, dinamikRegionStock } from "@/modules/suppliers/dinamik-stock";
import { SupplierTabs } from "@/components/admin/supplier-tabs";
import { SupplierBrowser } from "@/components/admin/supplier-browser";
import { SupplierProductDetails } from "@/components/admin/supplier-product-details";
import { DinamikProductFilters } from "@/components/admin/dinamik-product-filters";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { DialogTrigger } from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Pagination, PaginationContent, PaginationEllipsis, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from "@/components/ui/pagination";
import { money } from "@/modules/store/catalog";
import { supplierCheckoutMode } from "@/modules/store/supplier-checkout-policy";
import { supplierActivity } from "@/modules/suppliers/activity";
import { SupplierActivityBadge } from "@/components/admin/supplier-activity-badge";
import { db } from "@/lib/db";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const number = (value: number | null | undefined) => new Intl.NumberFormat("tr-TR").format(value ?? 0);
const time = (value: Date | null | undefined) => value ? value.toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "Henüz yok";
const runLabels: Record<string, string> = { running: "Çalışıyor", succeeded: "Başarılı", failed: "Başarısız", rejected: "İnceleme gerekli" };
const runTones: Record<string, Tone> = { succeeded: "success", failed: "error", rejected: "warning", running: "info" };
const variables = ["DINAMIK_BASE", "DINAMIK_APIKEY", "DINAMIK_SECRETKEY"];
const price = (value: number | null | undefined) => value == null ? null : new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
const filterKeys = ["q", "brand", "group", "region", "stock", "quality", "presence"] as const;
type Tone = "success" | "warning" | "error" | "info" | "neutral";
const statusBadge = (tone: Tone, text: string) => tone === "success" ? <Badge variant="success"><CircleCheck data-icon="inline-start" aria-hidden="true"/>{text}</Badge>
  : tone === "error" ? <Badge variant="destructive"><CircleAlert data-icon="inline-start" aria-hidden="true"/>{text}</Badge>
  : tone === "warning" ? <Badge variant="warning"><TriangleAlert data-icon="inline-start" aria-hidden="true"/>{text}</Badge>
  : tone === "info" ? <Badge variant="info"><Info data-icon="inline-start" aria-hidden="true"/>{text}</Badge> : <Badge variant="outline">{text}</Badge>;

export default async function DinamikAdmin({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireAdmin();
  const params = normalizeSearchParams(await searchParams);
  const status = supplierStatuses().find(s => s.name === "Dinamik");
  const [data, health, list, activity, checkoutMode] = await Promise.all([adminDinamikOverview(), supplierHealth(db, DINAMIK_COMPANY).catch(() => null), adminDinamikItems(params),
    supplierActivity(db, "dinamik"), supplierCheckoutMode()]);
  const { items: rows, total, page, pages } = list;
  const region = dinamikRegion(params.region);
  function pageUrl(target: number) {
    const query = new URLSearchParams({ page: String(target) });
    for (const key of filterKeys) if (params[key]) query.set(key, params[key]!);
    return `/yonetim/tedarikciler/dinamik?${query}`;
  }
  const pageNumbers = Array.from(new Set([1, ...Array.from({ length: 5 }, (_, i) => Math.max(1, Math.min(page - 2, pages - 4)) + i), pages])).filter(n => n >= 1 && n <= pages).sort((a, b) => a - b);
  const { items, scopes, runs } = data;
  const lastRun = data.recent[0];
  const facts: [string, string, string][] = [
    ["Zamanlayıcı", health?.heartbeat?.alive ? "Çalışıyor" : "Sinyal yok", health?.heartbeat && !health.heartbeat.finished_at ? `Tur sürüyor · başladı ${time(health.heartbeat.started_at)}` : `Son kontrol: ${health?.heartbeat?.finished_at ? time(health.heartbeat.finished_at) : "henüz yok"}`],
    ["Son başarılı çekim", time(scopes.last_success), `${number(scopes.synced)} / ${number(scopes.enabled)} marka · her gece 04:00`],
    ["Son aktarım", lastRun ? time(lastRun.started_at) : "Henüz yok", !lastRun ? "Kayıt yok" : lastRun.status === "running" ? `${lastRun.list_group} · çekiliyor` : `${lastRun.list_group} · ${number(lastRun.quality.uniqueProducts)} ürün · ${runLabels[lastRun.status] ?? lastRun.status}`],
    ["Sipariş veri kaynağı", checkoutMode === "snapshot" ? "Kayıtlı veriler" : "Canlı API", checkoutMode === "snapshot" ? "Başbuğ ile ortak ayar · teyit bekler" : "Siparişte marka listesi yeniden çekilir"],
  ];
  const tone: Tone = !health ? "error" : health.healthy ? "success" : scopes.synced ? "warning" : "neutral";
  const stats: [string, string, string, Tone?][] = [
    ["Güncel ürün", number(items.present), `${number(items.brands)} marka · ${number(items.priced)} fiyatlı`],
    ["Bölgede stokta", number(items.available), "En az bir depoda VAR (adet değil)"],
    ["Markalar", `${number(scopes.synced)} / ${number(scopes.enabled)}`, data.discovery ? `Liste ${time(data.discovery.checked_at)} okundu · ${number(data.discovery.listed)} marka` : "Marka listesi henüz okunmadı",
      scopes.failing ? "warning" : scopes.synced === scopes.enabled && scopes.enabled ? "success" : "neutral"],
    ["Son 24 saat", `${number(runs.total)} çekim`, runs.failed ? `${number(runs.failed)} başarısız / inceleme · ${number(scopes.due)} sırada` : `Hatasız · ${number(scopes.due)} sırada`, runs.failed ? "warning" : "success"],
  ];
  return <div className="flex flex-col gap-6">
    <div className="flex flex-col gap-2">
      <Breadcrumb><BreadcrumbList>
        <BreadcrumbItem><BreadcrumbLink render={<Link href="/yonetim"/>}>Yönetim</BreadcrumbLink></BreadcrumbItem><BreadcrumbSeparator/>
        <BreadcrumbItem><BreadcrumbLink render={<Link href="/yonetim/tedarikciler"/>}>Tedarikçiler</BreadcrumbLink></BreadcrumbItem><BreadcrumbSeparator/>
        <BreadcrumbItem><BreadcrumbPage>Dinamik</BreadcrumbPage></BreadcrumbItem>
      </BreadcrumbList></Breadcrumb>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Dinamik API</h1>
          <p className="text-muted-foreground">Marka bazlı stok ve fiyat listeleri; her marka ayrı kapsam olarak Başbuğ ile aynı zamanlayıcıda çekilir.</p>
        </div>
        <SupplierActivityBadge supplier="dinamik" initial={activity} unit="marka">{statusBadge(tone, !health ? "Okunamadı" : health.healthy ? "Sağlıklı" : scopes.synced ? "Dikkat gerekiyor" : "İlk çekim bekleniyor")}</SupplierActivityBadge>
      </div>
    </div>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" role="region" aria-label="Dinamik özet">
      {facts.map(([label, value, note]) => <Card key={label} size="sm">
        <CardHeader><CardDescription>{label}</CardDescription><CardTitle className="tabular-nums">{value}</CardTitle></CardHeader>
        <CardContent className="text-muted-foreground">{note}</CardContent>
      </Card>)}
    </div>
    <SupplierTabs label="Dinamik yönetimi" transfer={<div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" role="region" aria-label="Dinamik özeti">
        {stats.map(([label, value, note, statTone]) => <Card key={label}>
          <CardHeader>
            <CardDescription>{label}</CardDescription>
            <CardTitle className="text-2xl font-semibold tabular-nums">{value}</CardTitle>
            {statTone && statTone !== "neutral" && <CardAction>{statusBadge(statTone, statTone === "success" ? "Güncel" : "Dikkat")}</CardAction>}
          </CardHeader>
          <CardContent className="text-muted-foreground">{note}</CardContent>
        </Card>)}
      </div>
      <div className="grid items-start gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader><CardTitle><h2>Son çekimler</h2></CardTitle><CardDescription>En eski güncel marka: {time(scopes.oldest_success)} · en son: {time(scopes.last_success)}</CardDescription></CardHeader>
          <CardContent>
            {data.recent.length ? <Table><caption className="sr-only">Son Dinamik çekimleri</caption>
              <TableHeader><TableRow><TableHead>Marka</TableHead><TableHead>Başlangıç</TableHead><TableHead className="text-right">Ürün</TableHead><TableHead className="text-right">Yeni / değişen</TableHead><TableHead>Durum</TableHead></TableRow></TableHeader>
              <TableBody>{data.recent.map(run => <TableRow key={`${run.list_group}-${run.started_at.toISOString()}`}>
                <TableCell className="font-medium">{run.list_group}</TableCell>
                <TableCell className="tabular-nums">{time(run.started_at)}</TableCell>
                <TableCell className="text-right tabular-nums">{number(run.quality.uniqueProducts)}</TableCell>
                <TableCell className="text-right tabular-nums">{number(run.stats.added)} / {number((run.stats.changed ?? 0) + (run.stats.restored ?? 0))}</TableCell>
                <TableCell><div className="flex items-center gap-2">{statusBadge(runTones[run.status] ?? "neutral", runLabels[run.status] ?? run.status)}{run.error_reason && <span className="text-muted-foreground">{run.error_reason}</span>}</div></TableCell>
              </TableRow>)}</TableBody>
            </Table> : <Empty><EmptyHeader><EmptyTitle>Henüz çekim yok</EmptyTitle><EmptyDescription>Zamanlayıcı marka listesini okuyup markaları sırayla çeker.</EmptyDescription></EmptyHeader></Empty>}
          </CardContent>
        </Card>
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader><CardTitle><h2>Hata veren markalar</h2></CardTitle></CardHeader>
            <CardContent>
              {data.failing.length ? <Table><TableBody>{data.failing.map(scope => <TableRow key={scope.list_group}>
                <TableCell className="whitespace-normal"><div className="font-medium">{scope.list_group}</div><div className="text-muted-foreground">{scope.error_reason ?? "Bilinmeyen hata"}</div></TableCell>
                <TableCell className="text-right text-muted-foreground tabular-nums">{scope.consecutive_failures}× · sonraki {time(scope.next_run_at)}</TableCell>
              </TableRow>)}</TableBody></Table> : <p className="text-muted-foreground">Hata veren marka yok.</p>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle><h2>Ortam değişkenleri</h2></CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-3">
              <Table><TableBody>{variables.map(name => <TableRow key={name}><TableCell className="font-mono">{name}</TableCell><TableCell className="text-right">{statusBadge(process.env[name] ? "success" : "warning", process.env[name] ? "Tanımlı" : "Eksik")}</TableCell></TableRow>)}</TableBody></Table>
              <p className="text-muted-foreground">{status?.message}</p>
            </CardContent>
            <CardFooter><Button variant="link" size="sm" nativeButton={false} render={<Link href="/yonetim/tedarikciler"/>}>Tüm tedarikçiler<ArrowRight data-icon="inline-end" aria-hidden="true"/></Button></CardFooter>
          </Card>
        </div>
      </div>
    </div>} products={
    <SupplierBrowser><Card>
      <CardHeader className="border-b">
        <DinamikProductFilters key={filterKeys.map(key => params[key]).join("|")} params={params} brands={list.brands} groups={list.groups}/>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 group-data-loading/browser:pointer-events-none group-data-loading/browser:opacity-50">
        <div className="flex flex-wrap justify-between gap-2 text-muted-foreground tabular-nums"><span><strong className="text-foreground">{number(total)}</strong> ürün · {params.brand || "Tüm markalar"}{params.stock && ` · ${region === "any" ? "Herhangi bölge" : dinamikRegions.find(r => r.key === region)?.label}: ${params.stock === "1" ? "Stok var" : params.stock === "0" ? "Stok yok" : "Veri yok"}`}</span><span>Fiyat: KDV hariç maliyet · Satış: kâr + KDV dahil (<Link className="underline" href="/yonetim/fiyatlandirma">oranlar</Link>) · Stok: VAR/YOK · Ürün bilgisi olmayan kodlar mağazada yok</span></div>
        {rows.length ? <Table><caption className="sr-only">Dinamik ürünleri, liste fiyatları ve bölge stok durumları</caption>
          <TableHeader><TableRow><TableHead>Stok kodu</TableHead><TableHead>Ürün adı</TableHead><TableHead>Marka</TableHead><TableHead>Araç</TableHead><TableHead>Grup</TableHead><TableHead className="text-right" title="KDV hariç maliyet (₺)">Fiyat (₺)</TableHead><TableHead className="text-right" title="Mağaza satış fiyatı, KDV dahil">Satış (₺)</TableHead><TableHead className="text-right" title="Kampanya oranı">Kamp.</TableHead>{dinamikRegions.map(r => <TableHead key={r.key} className="text-center" title={`${r.label} stok durumu (${r.key})`}>{r.key === region ? <strong>{r.short}</strong> : r.short}</TableHead>)}<TableHead>Kontrol</TableHead><TableHead><span className="sr-only">Ürün detayı</span></TableHead></TableRow></TableHeader>
          <TableBody>{rows.map(item => { const p = item.product_data; const href = `/yonetim/tedarikciler/dinamik/urun/${item.id}`; const campaign = Number(item.price_data?.kampanyaOrani ?? 0); return <SupplierProductDetails key={item.id} code={item.code} title={p.stokAdi || "Ürün bilgisi yok"} supplier="Dinamik" detailHref={href}
            fields={[
              ["Marka", item.list_group], ["İngilizce adı", p.ingilizceAdi],
              ["Araç", p.kull1s], ["Üretici", p.kull3s],
              ["Ürün grubu", p.kull7s], ["Ürün tipi", p.kull8s],
              ["OEM listesi", p.oemListe], ["Eşdeğer listesi", p.esdegerListe],
              ["Barkod", [p.barkod1, p.barkod2, p.barkod3].filter(Boolean).join(" · ")],
              ["Paket / koli", p.paketMiktari !== undefined ? `${p.paketMiktari} / ${p.koliMiktari ?? "—"} ${p.olcuBirimi ?? ""}` : null],
              ["Maliyet · KDV hariç (₺)", price(item.price_data?.fiyat) ?? "Fiyat eksik"],
              ["Satış fiyatı · KDV dahil", item.sale_price_kurus ? money(item.sale_price_kurus) : item.stock_data ? "Satışa kapalı" : "Mağazada gösterilmiyor"],
              ["Kampanya oranı", campaign ? `%${number(campaign > 1 ? campaign : campaign * 100)}` : "—"],
              ["Listede bulunma", item.presence === "present" ? "Güncel listede var" : item.presence === "inactive" ? "Pasif" : "Listede yok"],
              ["Veri kontrolü", item.conflicting ? "Çelişkili kayıt" : item.price_data?.fiyat == null ? "Fiyat eksik" : !item.stock_data ? "Yalnız fiyat kaydı; stok listesinde yok" : item.price_count > 1 || item.stock_count > 1 ? "Tekrarlanan kod" : "—"],
              ["Kaynak satırları", `${item.price_count} fiyat · ${item.stock_count} stok`],
            ]}
            stockTitle="Bölge stokları" stocks={dinamikRegions.map(region => ({ label: region.label, available: dinamikRegionStock(item.stock_data, region.key) }))}
            footer={<p className="text-muted-foreground">Liste fiyatı KDV hariç maliyet kabul edilir; satış fiyatı ortak kâr + KDV ile hesaplanır, kampanya oranı uygulanmaz. Stoklar adet yerine var/yok bildirir.</p>}>
          <TableRow>
            <TableCell><DialogTrigger render={<Button variant="link" size="sm" className="font-mono" title={item.code} aria-label={`${item.code} ürün ayrıntılarını aç`}/>}>{item.code}</DialogTrigger></TableCell>
            <TableCell className="max-w-64 truncate font-medium" title={p.stokAdi ?? "Yalnız fiyat listesinde; ürün bilgisi yok"}>{p.stokAdi || <span className="font-normal text-muted-foreground">Ürün bilgisi yok</span>}</TableCell>
            <TableCell className="max-w-32 truncate text-muted-foreground" title={item.list_group}>{item.list_group}</TableCell>
            <TableCell className="max-w-32 truncate text-muted-foreground" title={p.kull1s}>{p.kull1s || "—"}</TableCell>
            <TableCell className="max-w-40 truncate text-muted-foreground" title={[p.kull7s, p.kull8s].filter(Boolean).join(" · ")}>{p.kull8s || p.kull7s || "—"}</TableCell>
            <TableCell className="text-right tabular-nums">{price(item.price_data?.fiyat) ?? <Badge variant="warning">Eksik</Badge>}</TableCell>
            <TableCell className="text-right font-medium tabular-nums" title={item.sale_stock_label ?? "Satışa kapalı"}>{item.sale_price_kurus ? money(item.sale_price_kurus) : "—"}</TableCell>
            <TableCell className="text-right tabular-nums text-muted-foreground">{campaign ? `%${number(campaign > 1 ? campaign : campaign * 100)}` : "—"}</TableCell>
            {dinamikRegions.map(r => { const stock = dinamikRegionStock(item.stock_data, r.key); return <TableCell key={r.key} className="text-center"><Badge variant={stock ? "success" : "outline"} title={stock === null ? `${r.label}: stok listesinde yok` : `${r.label}: ${stock ? "VAR" : "YOK"}`}>{stock === null ? "—" : stock ? "Var" : "Yok"}</Badge></TableCell>; })}
            <TableCell>{item.presence !== "present" ? statusBadge("warning", item.presence === "inactive" ? "Pasif" : "Listede yok") : item.conflicting ? statusBadge("error", "Çelişkili") : item.price_data?.fiyat == null ? statusBadge("warning", "Fiyat eksik") : !item.stock_data ? statusBadge("neutral", "Yalnız fiyat") : item.price_count > 1 || item.stock_count > 1 ? statusBadge("info", "Tekrar var") : <span className="text-muted-foreground">—</span>}</TableCell>
            <TableCell><DialogTrigger render={<Button variant="ghost" size="icon-xs" aria-label={`${item.code} ürün detayı`} title="Ürün detayını aç"/>}><ArrowUpRight aria-hidden="true"/></DialogTrigger></TableCell>
          </TableRow></SupplierProductDetails>; })}</TableBody>
        </Table> : <Empty><EmptyHeader><EmptyMedia variant="icon"><SearchX/></EmptyMedia><EmptyTitle>Filtrelere uygun ürün bulunamadı.</EmptyTitle><EmptyDescription>{data.items.present ? "Aramayı veya filtreleri değiştirebilirsiniz." : "Henüz Dinamik verisi çekilmedi; zamanlayıcı markaları sırayla çeker."}</EmptyDescription></EmptyHeader></Empty>}
      </CardContent>
      <CardFooter className="flex-wrap justify-between gap-3">
        <span className="text-muted-foreground tabular-nums">Sayfa {number(page)} / {number(pages)}</span>
        <Pagination className="mx-0 w-auto" aria-label="Ürün sayfaları"><PaginationContent>
          <PaginationItem><PaginationPrevious text="Önceki" aria-label="Önceki sayfa" href={page > 1 ? pageUrl(page - 1) : undefined} aria-disabled={page <= 1 || undefined}/></PaginationItem>
          {pageNumbers.map((n, i, ns) => <Fragment key={n}>{i > 0 && n - ns[i - 1] > 1 && <PaginationItem><PaginationEllipsis/></PaginationItem>}<PaginationItem><PaginationLink href={pageUrl(n)} isActive={n === page}>{n}</PaginationLink></PaginationItem></Fragment>)}
          <PaginationItem><PaginationNext text="Sonraki" aria-label="Sonraki sayfa" href={page < pages ? pageUrl(page + 1) : undefined} aria-disabled={page >= pages || undefined}/></PaginationItem>
        </PaginationContent></Pagination>
        <form action="/yonetim/tedarikciler/dinamik" className="flex items-center gap-2">{filterKeys.filter(key => params[key]).map(key => <input key={key} type="hidden" name={key} value={params[key] || ""}/>)}<Label htmlFor="page-jump">Sayfaya git</Label><Input id="page-jump" className="w-20" type="number" name="page" min={1} max={pages} defaultValue={page}/><Button type="submit" variant="outline">Git</Button></form>
      </CardFooter>
    </Card></SupplierBrowser>
    }/>
  </div>;
}
