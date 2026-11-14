import Link from "next/link";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import { Suspense, type ReactNode } from "react";
import { requireAdmin } from "@/modules/auth/session";
import { adminSupplierCatalogMetrics, adminSupplierFeeds, adminSupplierRefreshPlan } from "@/modules/admin/data";
import { adminManualLists } from "@/modules/admin/manual";
import { supplierSchedulerManual } from "@/modules/suppliers/health";
import { feedIssueCount, feedStateLabels, feedStateTones, importErrorLabel, type FeedStatus } from "@/modules/suppliers/data-status";
import { SupplierRefreshRunner, type SupplierRefreshTask } from "@/components/admin/supplier-refresh-runner";
import { formatDate, formatInterval, formatNumber } from "@/modules/admin/format";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const number = formatNumber;
const percent = (part: number, whole: number) => whole
  ? `%${new Intl.NumberFormat("tr-TR", { maximumFractionDigits: part === whole || part === 0 ? 0 : 1 }).format(Math.floor(part / whole * 1000) / 10)}` : "—";
const time = (value: Date | null | undefined) => formatDate(value);
const ago = (value: Date | null | undefined, now: Date) => {
  if (!value) return "Hiç çekilmedi";
  const minutes = Math.max(0, Math.round((now.getTime() - value.getTime()) / 60_000));
  if (minutes < 1) return "Az önce";
  if (minutes < 60) return `${minutes} dk önce`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} sa önce`;
  return `${Math.round(minutes / 1440)} gün önce`;
};
const duration = (minutes: number | null) => !minutes ? "—" : minutes % 1440 === 0 && minutes > 1440 ? `${minutes / 1440} gün` : `${Math.round(minutes / 60)} saat`;
const icons = { success: CircleCheck, warning: TriangleAlert, destructive: CircleAlert, info: Info, outline: Info } as const;
const toneBadge = (tone: keyof typeof icons, text: string) => {
  const Icon = icons[tone];
  return <Badge variant={tone}><Icon data-icon="inline-start" aria-hidden="true"/>{text}</Badge>;
};
const issueColor = { destructive: "text-destructive", warning: "text-warning", info: "text-info" } as const;
const sample = (names: string[], limit = 6) => names.length > limit ? `${names.slice(0, limit).join(", ")} ve ${number(names.length - limit)} diğer` : names.join(", ");

// Issue links open the supplier page already filtered to the products the issue counts (filters of each page's table).
const scopeParam: Record<string, string | undefined> = { basbug: "group", dinamik: "brand" };
const filtered = (href: string, params: Record<string, string | undefined>) => {
  const query = new URLSearchParams(Object.entries(params).filter((entry): entry is [string, string] => Boolean(entry[1])));
  return query.size ? `${href}?${query}` : href;
};
const scopeHref = (key: string, href: string, scopes: { list_group: string }[]) =>
  filtered(href, scopes.length === 1 && scopeParam[key] ? { [scopeParam[key]!]: scopes[0].list_group } : {});

type CatalogMetrics = Awaited<ReturnType<typeof adminSupplierCatalogMetrics>>;
// The store-side figures (in stock, saleable) read commerce_catalog, which takes seconds; they stream in after the rest.
async function CatalogFigure({ catalog, render }: { catalog: Promise<CatalogMetrics>; render: (metrics: CatalogMetrics) => ReactNode }) {
  return render(await catalog);
}
const streamed = (catalog: Promise<CatalogMetrics>, render: (metrics: CatalogMetrics) => ReactNode, size: string) =>
  <Suspense fallback={<Skeleton className={size}><span className="sr-only">Yükleniyor…</span></Skeleton>}><CatalogFigure catalog={catalog} render={render}/></Suspense>;

type Issue = { key: string; tone: keyof typeof issueColor; title: string; description: string; href: string; action: string };
type Row = {
  key: keyof CatalogMetrics; name: string; source: string; href: string; status: ReactNode; last: Date | null; scope: string; scopeNote: string;
  present: number; priced: number;
};

// Modeled on supplier-feed dashboards: one row per feed answering "is the data current, how complete is it,
// what is open". Freshness is judged per scope against its SLA (stale_minutes), not by whether the scheduler runs.
export default async function Suppliers() {
  await requireAdmin();
  const catalog = adminSupplierCatalogMetrics();
  const [{ status, metrics, attempts, scheduler }, manualLists, plan] = await Promise.all([adminSupplierFeeds(), adminManualLists(), adminSupplierRefreshPlan()]);
  const now = new Date();
  const feeds = [
    { key: "basbug" as const, name: "Başbuğ", source: "API · ürün, NF maliyet, MRK stoğu, döviz kuru", unit: "grup", href: "/yonetim/tedarikciler/basbug", feed: status.basbug },
    { key: "dinamik" as const, name: "Dinamik", source: "API · marka bazlı ürün, fiyat, bölge stoğu", unit: "marka", href: "/yonetim/tedarikciler/dinamik", feed: status.dinamik },
    { key: "seta" as const, name: "SETA", source: "API · filtre, OEM, bayi fiyatı, stok", unit: "liste", href: "/yonetim/tedarikciler/seta", feed: status.seta },
  ] as const;

  // SETA is one quick list, Başbuğ 15 groups, Dinamik only the brands not refreshed in the last day.
  const refreshTasks: SupplierRefreshTask[] = [
    ...(plan.seta ? [{ supplier: "seta" as const, group: "ALL" }] : []),
    ...(status.basbug.state !== "unconfigured" ? plan.basbug.map(group => ({ supplier: "basbug" as const, group })) : []),
    ...(status.dinamik.state !== "unconfigured" ? plan.dinamikStale.map(group => ({ supplier: "dinamik" as const, group })) : []),
  ];

  const method = (feed: FeedStatus) => feed.automated === 0 ? "Elle güncellenir"
    : feed.automated === feed.tracked ? `Otomatik, ${formatInterval(feed.intervalMinutes)}`
    : `${number(feed.automated)} / ${number(feed.tracked)} kapsam otomatik`;
  const rows: Row[] = feeds.map(({ key, name, source, unit, href, feed }) => {
    const m = metrics[key];
    return {
      key, name, source, href, last: feed.lastSuccess, present: m.present, priced: m.priced,
      status: toneBadge(feedStateTones[feed.state], feedStateLabels[feed.state]),
      scope: feed.tracked ? `${number(feed.fresh)} / ${number(feed.tracked)} ${unit}` : "—",
      scopeNote: feed.tracked ? `${method(feed)} · süre ${duration(feed.staleMinutes)}` : "Kapsam tanımlı değil",
    };
  });
  const manualPresent = manualLists.reduce((sum, list) => sum + list.present, 0);
  const manualMissing = manualLists.reduce((sum, list) => sum + list.missing_prices, 0);
  const manualLast = manualLists.reduce<Date | null>((latest, list) => list.last_import && (!latest || list.last_import > latest) ? list.last_import : latest, null);
  rows.push({
    key: "manual", name: "Manuel yükleme", source: `Excel · ${manualLists.map(list => list.list_name).join(", ") || "liste yok"}`, href: "/yonetim/tedarikciler/manuel",
    last: manualLast, present: manualPresent, priced: manualPresent - manualMissing,
    status: !manualLists.length ? toneBadge("outline", "Liste yok") : manualMissing ? toneBadge("warning", "Fiyat eksik") : toneBadge("success", "Yüklendi"),
    scope: `${number(manualLists.length)} liste`, scopeNote: "Onaylı dosya yüklemesi",
  });

  const issues: Issue[] = [];
  for (const { key, name, unit, href, feed } of feeds) {
    if (feed.state === "unconfigured") { issues.push({ key: `${key}-config`, tone: "warning", title: `${name}: bağlantı ayarları eksik`, description: "Ortam değişkenleri tanımlanmadan veri çekilemez.", href, action: "Ayrıntılar" }); continue; }
    if (feed.stale.length) issues.push({ key: `${key}-stale`, tone: "destructive", href: scopeHref(key, href, feed.stale), action: "Yenile",
      title: `${name}: ${number(feed.stale.length)} ${unit} güncellik süresini aştı`,
      description: `${sample(feed.stale.map(scope => scope.list_group))}. En eski başarılı çekim ${time(feed.oldestSuccess)}; mağaza bu ürünleri son bilinen fiyat ve stokla gösteriyor.` });
    if (feed.never.length) issues.push({ key: `${key}-never`, tone: "warning", href: scopeHref(key, href, feed.never), action: "Yenile",
      title: `${name}: ${number(feed.never.length)} ${unit} hiç çekilmedi`, description: sample(feed.never.map(scope => scope.list_group)) });
    const retrying = feed.failing.filter(scope => !feed.stale.includes(scope) && !feed.never.includes(scope));
    if (retrying.length) {
      const reasons = [...new Set(retrying.map(scope => importErrorLabel(scope.error_reason, key)))];
      issues.push({ key: `${key}-failing`, tone: "warning", href: scopeHref(key, href, retrying), action: "İncele",
        title: `${name}: ${number(retrying.length)} ${unit} son denemede güncellenemedi`,
        description: `${sample(retrying.map(scope => scope.list_group))} · ${reasons.join("; ")}. Önceki veri güncellik süresi içinde olduğu için mağazada kullanılmaya devam ediyor.` });
    }
  }
  if (manualMissing) issues.push({ key: "manual-prices", tone: "warning", href: filtered("/yonetim/tedarikciler/manuel", { quality: "missing-price" }), action: "Fiyat gir",
    title: `Manuel yükleme: ${number(manualMissing)} ürünün fiyatı yok`, description: "Fiyatı olmayan ürünler mağazada satışa kapalı kalır." });
  for (const { key, name, href } of feeds) {
    const unstocked = metrics[key].unstocked;
    if (unstocked) issues.push({ key: `${key}-unstocked`, tone: "info", href: filtered(href, { quality: key === "dinamik" ? "price-only" : undefined }), action: "İncele",
      title: `${name}: ${number(unstocked)} ürün stok listesinde yok`, description: "Tedarikçi bu ürünlerin fiyatını gönderiyor ama stok bilgisini göndermiyor; stok bilgisi gelene kadar satışa açılmazlar." });
    const conflicting = metrics[key].conflicting;
    if (conflicting) issues.push({ key: `${key}-conflict`, tone: "info", href: filtered(href, { quality: "conflicts" }), action: "İncele",
      title: `${name}: ${number(conflicting)} ürün kodu çakışıyor`, description: "Tedarikçi aynı kod için birbirini tutmayan satırlar (ör. farklı fiyat) gönderiyor; hangisinin doğru olduğu belirsiz olduğu için satışa açılmaz." });
  }

  const apiFeeds = feeds.map(entry => entry.feed);
  const feedProblems = apiFeeds.reduce((sum, feed) => sum + (feed.state === "unconfigured" ? 1 : feedIssueCount(feed)), 0);
  const lastUpdate = [...apiFeeds.map(feed => feed.lastSuccess), manualLast].filter((value): value is Date => Boolean(value)).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  const totals = rows.reduce((sum, row) => ({ present: sum.present + row.present, priced: sum.priced + row.priced }), { present: 0, priced: 0 });
  const catalogTotals = (all: CatalogMetrics) => Object.values(all).reduce((sum, m) => ({ available: sum.available + m.available, saleable: sum.saleable + m.saleable }),
    { available: 0, saleable: 0 });
  const allFresh = apiFeeds.every(feed => feed.state === "fresh");
  const automated = apiFeeds.some(feed => feed.automated > 0);
  const manualScheduler = supplierSchedulerManual();
  const history = feeds.map(({ key, name }) => ({ key, name, ...attempts[key] })).filter(row => row.total);

  const kpis: { label: string; value: ReactNode; note: ReactNode }[] = [
    { label: "Tedarikçi ürünü", value: number(totals.present), note: `${number(rows.length)} kaynağın güncel listelerinde` },
    { label: "Satışa açık", value: streamed(catalog, all => number(catalogTotals(all).saleable), "h-8 w-24"),
      note: streamed(catalog, all => `${percent(catalogTotals(all).saleable, totals.present)} · fiyatlı ve stokta`, "h-4 w-32") },
    { label: "Fiyat bilgisi olan", value: percent(totals.priced, totals.present), note: `${number(totals.priced)} ürün` },
    { label: "Stokta olan", value: streamed(catalog, all => percent(catalogTotals(all).available, totals.present), "h-8 w-24"),
      note: streamed(catalog, all => `${number(catalogTotals(all).available)} ürün`, "h-4 w-32") },
  ];

  return <div className="flex flex-col gap-6">
    <div className="flex flex-col gap-2">
      <Breadcrumb><BreadcrumbList>
        <BreadcrumbItem><BreadcrumbLink render={<Link href="/yonetim"/>}>Yönetim</BreadcrumbLink></BreadcrumbItem><BreadcrumbSeparator/>
        <BreadcrumbItem><BreadcrumbPage>Tedarikçiler</BreadcrumbPage></BreadcrumbItem>
      </BreadcrumbList></Breadcrumb>
      <h1 className="text-2xl font-semibold tracking-tight">Tedarikçi veri akışları</h1>
      <p className="text-muted-foreground">Tedarikçilerden gelen ürün, fiyat ve stok verilerinin güncelliği, kapsamı ve açık sorunları.</p>
    </div>

    {feedProblems === 0 && allFresh
      ? <Alert variant="success"><CircleCheck aria-hidden="true"/><AlertTitle>Tüm tedarikçi verileri güncel</AlertTitle>
          <AlertDescription>Son güncelleme {time(lastUpdate)}. API akışlarının bütün kapsamları güncellik süresi içinde çekildi; eksik veya hata veren kapsam yok.</AlertDescription></Alert>
      : <Alert variant="warning"><TriangleAlert aria-hidden="true"/><AlertTitle>{number(feedProblems)} kapsamda veri sorunu var</AlertTitle>
          <AlertDescription>Ayrıntılar “Açık sorunlar” bölümünde. Sorunlu kapsamlarda mağaza son başarılı çekimin verisini kullanıyor.</AlertDescription></Alert>}
    {!scheduler?.alive && <Alert variant="info"><Info aria-hidden="true"/><AlertTitle>{manualScheduler ? "Otomatik güncelleme kapalı" : "Otomatik güncelleme çalışmıyor"}</AlertTitle>
      <AlertDescription>
        {manualScheduler ? "Bu ortamda zamanlayıcı bilerek çalıştırılmıyor (SUPPLIER_SCHEDULER=manual)." : automated ? "Zamanlayıcıdan çalışma sinyali gelmiyor; veriler kendiliğinden yenilenmeyecek." : "Bütün kapsamlarda otomatik çekim kapalı."} Güncellik süresi dolmadan “Tüm tedarikçileri güncelle” ile yenileyin. Son otomatik geçiş: {scheduler ? `${time(scheduler.finished_at ?? scheduler.started_at)}${scheduler.succeeded === false ? " (hatayla bitti)" : ""}` : "kayıt yok"}.
      </AlertDescription></Alert>}

    <Card role="region" aria-labelledby="supplier-refresh">
      <CardHeader><CardTitle><h2 id="supplier-refresh">Verileri güncelle</h2></CardTitle>
        <CardDescription>Zamanlayıcıyı beklemeden API’lerden çeker: SETA, Başbuğ’un {number(plan.basbug.length)} grubu ve son 24 saatte güncellenmemiş {number(plan.dinamikStale.length)} Dinamik markası.</CardDescription></CardHeader>
      <CardContent><SupplierRefreshRunner tasks={refreshTasks} label="Tüm tedarikçileri güncelle" ariaLabel="Tüm tedarikçileri güncelle"
        description={`${number(refreshTasks.length)} kapsam sırayla yenilenir; Dinamik markaları birkaç saniye, Başbuğ grupları yarım dakikaya kadar sürer. Sayfayı açık tutun.`}/></CardContent>
    </Card>

    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {kpis.map(kpi => <Card key={kpi.label} size="sm">
        <CardHeader><CardDescription>{kpi.label}</CardDescription><CardTitle className="text-2xl font-semibold tabular-nums">{kpi.value}</CardTitle></CardHeader>
        <CardFooter className="text-muted-foreground">{kpi.note}</CardFooter>
      </Card>)}
    </div>

    <Card role="region" aria-labelledby="supplier-feeds">
      <CardHeader><CardTitle><h2 id="supplier-feeds">Veri akışları</h2></CardTitle>
        <CardDescription>Durum, her kapsamın güncellik süresi içinde çekilip çekilmediğini gösterir; zamanlayıcıdan bağımsızdır. Oranlar tedarikçinin güncel listesindeki ürünlere göredir; satışa açık ürün fiyatlı ve stokta olandır.</CardDescription></CardHeader>
      <CardContent>
        <Table controls={false}>
          <caption className="sr-only">Tedarikçi veri akışları · İstanbul saati</caption>
          <TableHeader><TableRow>
            <TableHead>Tedarikçi</TableHead><TableHead>Durum</TableHead><TableHead>Son güncelleme</TableHead><TableHead>Güncel kapsam</TableHead>
            <TableHead className="text-right">Ürün</TableHead><TableHead className="text-right">Fiyatlı</TableHead><TableHead className="text-right">Stokta</TableHead>
            <TableHead className="text-right">Satışa açık</TableHead>
          </TableRow></TableHeader>
          <TableBody>{rows.map(row => <TableRow key={row.key} className="align-top">
            <TableCell><Link href={row.href} className="font-medium underline-offset-4 hover:underline">{row.name}</Link><div className="text-muted-foreground">{row.source}</div></TableCell>
            <TableCell>{row.status}</TableCell>
            <TableCell><div>{ago(row.last, now)}</div><div className="text-muted-foreground tabular-nums">{time(row.last)}</div></TableCell>
            <TableCell><div className="tabular-nums">{row.scope}</div><div className="text-muted-foreground">{row.scopeNote}</div></TableCell>
            <TableCell className="text-right tabular-nums">{number(row.present)}</TableCell>
            <TableCell className="text-right"><div className="tabular-nums">{percent(row.priced, row.present)}</div><div className="text-muted-foreground tabular-nums">{number(row.priced)}</div></TableCell>
            <TableCell className="text-right">{streamed(catalog, all => <>
              <div className="tabular-nums">{percent(all[row.key].available, row.present)}</div><div className="text-muted-foreground tabular-nums">{number(all[row.key].available)}</div>
            </>, "ml-auto h-10 w-16")}</TableCell>
            <TableCell className="text-right tabular-nums">{streamed(catalog, all => number(all[row.key].saleable), "ml-auto h-5 w-16")}</TableCell>
          </TableRow>)}</TableBody>
        </Table>
      </CardContent>
    </Card>

    <Card role="region" aria-labelledby="supplier-issues">
      <CardHeader><CardTitle><h2 id="supplier-issues">Açık sorunlar</h2></CardTitle>
        <CardDescription>Yalnız şu an geçerli olanlar. Sonradan başarıyla yenilenen kapsamların eski hataları burada yer almaz.</CardDescription></CardHeader>
      <CardContent>
        {issues.length ? <ItemGroup>{issues.map(issue => {
          const Icon = icons[issue.tone];
          return <Item key={issue.key} variant="outline" size="sm">
            <ItemMedia variant="icon"><Icon aria-hidden="true" className={issueColor[issue.tone]}/></ItemMedia>
            <ItemContent><ItemTitle>{issue.title}</ItemTitle><ItemDescription>{issue.description}</ItemDescription></ItemContent>
            <ItemActions><Button variant="outline" size="sm" nativeButton={false} render={<Link href={issue.href}/>}>{issue.action}</Button></ItemActions>
          </Item>;
        })}</ItemGroup>
        : <Empty className="border"><EmptyHeader><EmptyMedia variant="icon"><CircleCheck aria-hidden="true" className="text-success"/></EmptyMedia>
            <EmptyTitle>Açık sorun yok</EmptyTitle><EmptyDescription>Tüm akışlar güncellik süresi içinde ve son denemeler başarılı.</EmptyDescription></EmptyHeader></Empty>}
      </CardContent>
    </Card>

    <Card role="region" aria-labelledby="supplier-history">
      <CardHeader><CardTitle><h2 id="supplier-history">Son 24 saatteki çekimler</h2></CardTitle>
        <CardDescription>Geçmiş kaydıdır. Başarısız ya da kalite kontrolünde reddedilen bir denemeden sonra aynı kapsam başarıyla yenilendiyse çözülmüş sayılır; reddedilen çekimlerde önceki veri korunur.</CardDescription></CardHeader>
      <CardContent>
        {history.length ? <Table controls={false}>
          <caption className="sr-only">Son 24 saatteki tedarikçi çekimleri</caption>
          <TableHeader><TableRow><TableHead>Tedarikçi</TableHead><TableHead className="text-right">Deneme</TableHead><TableHead className="text-right">Başarılı</TableHead>
            <TableHead className="text-right">Başarısız</TableHead><TableHead className="text-right">Kalite reddi</TableHead><TableHead>Çözülmemiş</TableHead></TableRow></TableHeader>
          <TableBody>{history.map(row => <TableRow key={row.key}>
            <TableCell className="font-medium">{row.name}</TableCell>
            <TableCell className="text-right tabular-nums">{number(row.total)}</TableCell>
            <TableCell className="text-right tabular-nums">{number(row.succeeded)}</TableCell>
            <TableCell className="text-right tabular-nums">{number(row.failed)}</TableCell>
            <TableCell className="text-right tabular-nums">{number(row.rejected)}</TableCell>
            <TableCell>{row.unresolved ? toneBadge("warning", `${number(row.unresolved)} kapsam`) : toneBadge("success", "Yok")}</TableCell>
          </TableRow>)}</TableBody>
        </Table>
        : <p className="text-muted-foreground">Son 24 saatte çekim yapılmadı.</p>}
      </CardContent>
    </Card>
  </div>;
}
