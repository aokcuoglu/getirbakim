import { Fragment } from "react";
import Link from "next/link";
import { ArrowRight, CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import { normalizeSearchParams, type SearchParams } from "@/lib/search-params";
import { requireAdmin } from "@/modules/auth/session";
import { supplierStatuses } from "@/modules/suppliers/clients";
import { supplierHealth } from "@/modules/suppliers/health";
import { DINAMIK_COMPANY } from "@/modules/suppliers/dinamik-import";
import { adminDinamikOverview } from "@/modules/admin/data";
import { adminDinamikItems } from "@/modules/admin/dinamik";
import { dinamikRegion, dinamikRegions } from "@/modules/suppliers/dinamik-stock";
import { SupplierTabs } from "@/components/admin/supplier-tabs";
import { SupplierPartTable } from "@/components/admin/supplier-part-table";
import { dinamikPartTableProps } from "@/components/admin/supplier-part-table-data";
import { SupplierBrowser } from "@/components/admin/supplier-browser";
import { DinamikProductFilters } from "@/components/admin/dinamik-product-filters";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Pagination, PaginationContent, PaginationEllipsis, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from "@/components/ui/pagination";
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
            <CardFooter><Button variant="link" nativeButton={false} render={<Link href="/yonetim/tedarikciler"/>}>Tüm tedarikçiler<ArrowRight data-icon="inline-end" aria-hidden="true"/></Button></CardFooter>
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
        <SupplierPartTable {...dinamikPartTableProps(rows, region, Boolean(data.items.present))}/>
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
