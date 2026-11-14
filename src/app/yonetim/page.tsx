import Link from "next/link";
import { AlertTriangle, Building2, CheckCircle2, ChevronRight, CircleAlert, CircleCheck, Layers3, PackageCheck, ReceiptText, RotateCcw, Tags, TrendingDown, TrendingUp, Truck, Wallet } from "lucide-react";
import { adminDashboard, adminOverview, adminSupplierFeedStatus } from "@/modules/admin/data";
import { feedIssueCount, feedNavTone, feedStateLabels } from "@/modules/suppliers/data-status";
import { normalizeSearchParams, type SearchParams } from "@/lib/search-params";
import { requireAdmin } from "@/modules/auth/session";
import { approveService } from "@/modules/admin/actions";
import { supplierStatuses } from "@/modules/suppliers/clients";
import { money } from "@/modules/store/catalog";
import { formatAgo, formatDateTime, formatNumber } from "@/modules/admin/format";
import { StatusBadge, type StatusTone } from "@/components/admin/status-badge";
import { SubmitButton } from "@/components/admin/submit-button";
import { LiveRefresh } from "@/components/admin/live-refresh";
import { OrderStatusBadge, PaymentStatusBadge } from "@/components/admin/order-badges";
import { OrdersChart } from "@/components/admin/orders-chart";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemSeparator, ItemTitle } from "@/components/ui/item";
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const number = formatNumber;
const today = () => new Date().toLocaleDateString("tr-TR", { timeZone: "Europe/Istanbul", weekday: "long", day: "numeric", month: "long" });
// The sidebar's feed tones (feedNavTone) in the badge vocabulary.
const navTones = { success: "success", warning: "warning", danger: "error", neutral: "neutral" } as const satisfies Record<ReturnType<typeof feedNavTone>, StatusTone>;
type Tone = keyof typeof navTones;

export default async function Admin({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireAdmin();
  const { approved, error } = normalizeSearchParams(await searchParams);
  const [{ accounts }, data, feeds] = await Promise.all([adminOverview(), adminDashboard(), adminSupplierFeedStatus().catch(() => null)]);
  // Supplier tones follow the supplier overview: data freshness and open feed problems, not the scheduler heartbeat.
  const dinamikTone: Tone = feeds ? feedNavTone(feeds.dinamik) : "danger";
  const setaTone: Tone = feeds ? feedNavTone(feeds.seta) : "danger";
  const pending = accounts.filter(a => !a.approved);
  const { orders, days, recent } = data;
  const revenue = Number(orders.revenue_30d), previous = Number(orders.revenue_prev_30d);
  const delta = previous > 0 ? (revenue - previous) / previous * 100 : null;
  const enrichment = Object.fromEntries(data.enrichment.map(row => [row.status, row.count])) as Record<string, number>;
  const enrichmentTotal = data.enrichment.reduce((sum, row) => sum + row.count, 0);
  const enrichmentAttention = (enrichment.review || 0) + (enrichment.blocked || 0) + (enrichment.failed || 0);
  const lastSuccess = [feeds?.basbug.lastSuccess, data.lastSuccess?.completed_at]
    .filter((d): d is Date => Boolean(d)).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  const basbugTone: Tone = feeds ? feedNavTone(feeds.basbug) : "danger";
  const feedProblems = feeds ? [feeds.basbug, feeds.dinamik, feeds.seta].reduce((sum, feed) => sum + feedIssueCount(feed), 0) : 1;
  const feedLabel = (key: "basbug" | "dinamik" | "seta") => feeds ? feedStateLabels[feeds[key].state] : "Okunamadı";

  const attention = [
    { href: "/yonetim/siparisler?status=action", icon: ReceiptText, tone: "warning", title: "Teyit bekleyen sipariş", note: "Tedarikçi stok ve teslim süresini teyit edip onayla", count: orders.action },
    { href: "/yonetim/siparisler?status=shipping", icon: Truck, tone: "neutral", title: "Sevk bekleyen sipariş", note: "Onaylandı, kargoya verilmeyi bekliyor", count: orders.shipping },
    { href: "/yonetim/siparisler?status=refund", icon: RotateCcw, tone: "danger", title: "İade bekleyen ödeme", note: "TAMI portalından iade edip referansı kaydet", count: orders.refund },
    { href: "/yonetim/servisler", icon: Building2, tone: "warning", title: "Onay bekleyen servis başvurusu", note: "Onay, fiyat ve sepet erişimini açar", count: pending.length },
    { href: `/yonetim/urun-verileri?status=${enrichment.review ? "review" : "error"}`, icon: Layers3, tone: "warning", title: "Kontrol bekleyen zenginleştirme", note: "İnceleme, erişim veya işlem hatası", count: enrichmentAttention },
    { href: "/yonetim/urun-eslestirme?scope=pending", icon: Tags, tone: "warning", title: "Onay bekleyen marka", note: data.brands.fresh ? `${number(data.brands.fresh)} yeni marka; tedarikçi etiketini doğrula veya mevcut markayla birleştir` : "Otomatik eklenen tedarikçi etiketini doğrula", count: data.brands.pending },
    { href: "/yonetim/tedarikciler", icon: AlertTriangle, tone: "danger", title: "Tedarikçi veri sorunu", note: feeds ? "Güncellik süresini aşan veya son denemede güncellenemeyen kapsam" : "Tedarikçi durumu okunamadı", count: feedProblems },
  ];
  const open = attention.filter(item => item.count > 0);

  const reviewed = enrichmentTotal - (enrichment.pending || 0);

  return <div className="flex flex-col gap-6">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Genel bakış</h1>
        <p className="text-muted-foreground">Bugün {today()} · Siparişler, tedarikçi verisi ve katalog durumunun özeti.</p>
      </div>
      <LiveRefresh seconds={30} defaultOn={false}/>
    </div>
    {approved && <Alert variant="success" role="status"><CircleCheck aria-hidden="true"/><AlertDescription>Servis başvurusu onaylandı.</AlertDescription></Alert>}
    {error && <Alert variant="destructive" role="alert"><CircleAlert aria-hidden="true"/><AlertDescription>Başvuru onaylanamadı. İndirim %0–50 olmalı; başvuru daha önce onaylanmış olabilir.</AlertDescription></Alert>}

    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Özet">
      <Card>
        <CardHeader>
          <CardDescription>Ciro · son 30 gün</CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums">{money(revenue)}</CardTitle>
          {delta !== null && <CardAction><StatusBadge tone={delta >= 0 ? "success" : "error"} icon={delta >= 0 ? TrendingUp : TrendingDown}>%{Math.abs(delta).toLocaleString("tr-TR", { maximumFractionDigits: 1 })}</StatusBadge></CardAction>}
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1 text-sm">
          <div className="flex items-center gap-2 font-medium"><Wallet className="size-4" aria-hidden="true"/>{number(orders.paid_30d)} ödenmiş sipariş</div>
          <div className="text-muted-foreground">{delta !== null ? `Önceki 30 güne göre ${delta >= 0 ? "artış" : "düşüş"}` : "Karşılaştırma için önceki dönem yok"}</div>
        </CardFooter>
      </Card>
      <Card>
        <CardHeader>
          <CardDescription>İşlem bekleyen sipariş</CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums">{number(orders.action + orders.refund)}</CardTitle>
          <CardAction><StatusBadge tone={orders.action + orders.refund ? "warning" : "success"}>{orders.action + orders.refund ? "Bekliyor" : "Güncel"}</StatusBadge></CardAction>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1 text-sm">
          <div className="flex items-center gap-2 font-medium"><ReceiptText className="size-4" aria-hidden="true"/>{number(orders.action)} teyit · {number(orders.refund)} iade · {number(orders.awaiting_payment)} ödeme bekliyor</div>
          <Link className="text-muted-foreground underline-offset-4 hover:underline" href="/yonetim/siparisler?status=action">Siparişlere git</Link>
        </CardFooter>
      </Card>
      <Card>
        <CardHeader>
          <CardDescription>Katalogdaki ürün</CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums">{number(data.catalog.items)}</CardTitle>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1 text-sm">
          <div className="flex items-center gap-2 font-medium"><PackageCheck className="size-4" aria-hidden="true"/>Başbuğ güncel listesinde bulunan kayıtlar</div>
          <Link className="text-muted-foreground underline-offset-4 hover:underline" href="/yonetim/tedarikciler/basbug">Ürünleri incele</Link>
        </CardFooter>
      </Card>
      <Card>
        <CardHeader>
          <CardDescription>Başbuğ verileri</CardDescription>
          <CardTitle className="text-2xl font-semibold">{feedLabel("basbug")}</CardTitle>
          <CardAction><StatusBadge tone={navTones[basbugTone]}>{!feeds ? "Okunamadı" : feeds.basbug.automated ? "Otomatik çekim" : "Elle güncelleniyor"}</StatusBadge></CardAction>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1 text-sm">
          <div className="flex items-center gap-2 font-medium"><Truck className="size-4" aria-hidden="true"/>Son başarılı çekim {formatAgo(lastSuccess)}</div>
          <Link className="text-muted-foreground underline-offset-4 hover:underline" href="/yonetim/tedarikciler/basbug">Durumu gör</Link>
        </CardFooter>
      </Card>
    </section>

    <div className="grid items-start gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Siparişler · son 14 gün</CardTitle>
          <CardDescription>Oluşturulma gününe göre · toplam {number(days.reduce((sum, day) => sum + day.orders, 0))} sipariş</CardDescription>
          <CardAction><Button variant="outline" nativeButton={false} render={<Link href="/yonetim/siparisler"/>}>Tüm siparişler</Button></CardAction>
        </CardHeader>
        <CardContent><OrdersChart days={days}/></CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Dikkat gerektirenler</CardTitle>
          <CardDescription>{open.length ? `${open.length} konu işlem bekliyor` : "Her şey yolunda"}</CardDescription>
        </CardHeader>
        <CardContent>
          {open.length ? <ItemGroup>{open.map((item, index) => <div key={item.title}>
            {index > 0 && <ItemSeparator/>}
            <Item size="sm" render={<Link href={item.href}/>}>
              <ItemMedia variant="icon"><item.icon aria-hidden="true"/></ItemMedia>
              <ItemContent><ItemTitle>{item.title}</ItemTitle><ItemDescription>{item.note}</ItemDescription></ItemContent>
              <ItemActions><Badge variant={item.tone === "danger" ? "destructive" : item.tone === "warning" ? "warning" : "secondary"} className="tabular-nums">{number(item.count)}</Badge><ChevronRight className="size-4" aria-hidden="true"/></ItemActions>
            </Item>
          </div>)}</ItemGroup> : <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon"><CheckCircle2/></EmptyMedia>
              <EmptyTitle>Bekleyen iş yok</EmptyTitle>
              <EmptyDescription>Siparişler, başvurular ve senkronizasyon güncel.</EmptyDescription>
            </EmptyHeader>
          </Empty>}
        </CardContent>
      </Card>
    </div>

    <div className="grid items-start gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Son siparişler</CardTitle>
          <CardAction><Button variant="outline" nativeButton={false} render={<Link href="/yonetim/siparisler"/>}>Tümü</Button></CardAction>
        </CardHeader>
        <CardContent>
          {recent.length ? <Table controls={false}><TableHeader><TableRow><TableHead>Sipariş</TableHead><TableHead>Müşteri</TableHead><TableHead>Durum</TableHead><TableHead>Ödeme</TableHead><TableHead className="text-right">Tutar</TableHead></TableRow></TableHeader><TableBody>
            {recent.map(order => <TableRow key={order.id}>
              <TableCell><Link className="font-medium underline-offset-4 hover:underline" href={`/siparis/${order.id}`}>#{order.number}</Link><div className="text-muted-foreground">{formatDateTime(order.created_at)}</div></TableCell>
              <TableCell>{order.customer_name}</TableCell>
              <TableCell><OrderStatusBadge status={order.status}/></TableCell>
              <TableCell><PaymentStatusBadge status={order.payment_status}/></TableCell>
              <TableCell className="text-right font-medium tabular-nums">{money(Number(order.total_kurus))}</TableCell>
            </TableRow>)}
          </TableBody></Table> : <Empty><EmptyHeader><EmptyTitle>Henüz sipariş yok</EmptyTitle></EmptyHeader></Empty>}
        </CardContent>
      </Card>
      <div className="flex min-w-0 flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Ürün zenginleştirme</CardTitle>
            <CardDescription>{number(reviewed)} / {number(enrichmentTotal)} ürün incelendi</CardDescription>
            <CardAction><Button variant="outline" nativeButton={false} render={<Link href="/yonetim/urun-verileri"/>}>Aç</Button></CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Progress value={enrichmentTotal ? Math.round(reviewed / enrichmentTotal * 100) : 0}>
              <ProgressLabel>Zenginleştirme ilerlemesi</ProgressLabel>
              <ProgressValue/>
            </Progress>
            <div className="flex flex-wrap gap-2">
              <StatusBadge tone="success" className="tabular-nums">{number(enrichment.complete || 0)} tamam</StatusBadge>
              <StatusBadge tone="warning" className="tabular-nums">{number(enrichment.partial || 0)} kısmi</StatusBadge>
              <StatusBadge tone={enrichmentAttention ? "warning" : "neutral"} className="tabular-nums">{number(enrichmentAttention)} kontrol</StatusBadge>
              <StatusBadge tone={enrichment.not_found ? "error" : "neutral"} className="tabular-nums">{number(enrichment.not_found || 0)} eşleşmeyen</StatusBadge>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Tedarikçi bağlantıları</CardTitle>
            <CardAction><Button variant="outline" nativeButton={false} render={<Link href="/yonetim/tedarikciler"/>}>Yönet</Button></CardAction>
          </CardHeader>
          <CardContent>
            <ItemGroup>{supplierStatuses().map((s, index) => {
              const isBasbug = s.name === "Başbuğ", isDinamik = s.name === "Dinamik", isSeta = s.name === "SETA";
              const tone: Tone = isBasbug ? basbugTone : isDinamik ? dinamikTone : isSeta ? setaTone : s.verified ? "success" : "neutral";
              return <div key={s.name}>
                {index > 0 && <ItemSeparator/>}
                <Item size="sm" render={<Link href={s.href}/>}>
                  <ItemContent><ItemTitle>{s.name}</ItemTitle><ItemDescription>{isBasbug ? `Son çekim ${formatAgo(data.lastImport?.started_at)}${data.lastImport ? ` · ${data.lastImport.list_group}` : ""}` : !s.configured ? "Bağlantı değişkenleri eksik" : isDinamik ? `Son çekim ${formatAgo(feeds?.dinamik.lastSuccess)} · ${feeds?.dinamik.tracked ?? 0} marka` : s.verified ? "Bağlantı doğrulandı" : "Değişkenler tanımlı · bağlantı doğrulanmadı"}</ItemDescription></ItemContent>
                  <ItemActions><StatusBadge tone={navTones[tone]}>{isBasbug ? feedLabel("basbug") : isDinamik ? feedLabel("dinamik") : isSeta ? feedLabel("seta") : s.verified ? "Bağlı" : "Doğrulanmadı"}</StatusBadge></ItemActions>
                </Item>
              </div>;
            })}</ItemGroup>
          </CardContent>
        </Card>
      </div>
    </div>

    {pending.length > 0 && <Card>
      <CardHeader>
        <CardTitle>Onay bekleyen servis başvuruları</CardTitle>
        <CardDescription>Onay, servise fiyat ve sepet erişimini hemen açar.</CardDescription>
        <CardAction><Button variant="outline" nativeButton={false} render={<Link href="/yonetim/servisler"/>}>Tüm servisler</Button></CardAction>
      </CardHeader>
      <CardContent>
        <ItemGroup>{pending.map((a, index) => <div key={a.id}>
          {index > 0 && <ItemSeparator/>}
          <Item>
            <ItemContent><ItemTitle>{a.name}</ItemTitle><ItemDescription>{a.email}{a.contact_name && ` · ${a.contact_name} · ${a.phone} · ${a.city}`}</ItemDescription></ItemContent>
            <ItemActions><form action={approveService} className="flex items-end gap-2"><input type="hidden" name="id" value={a.id}/>
              <Field className="w-36"><FieldLabel htmlFor={`discount-${a.id}`}>Özel indirim (%)</FieldLabel><Input id={`discount-${a.id}`} name="discount" type="number" min={0} max={50} defaultValue={0} required/></Field>
              <SubmitButton>Başvuruyu onayla</SubmitButton>
            </form></ItemActions>
          </Item>
        </div>)}</ItemGroup>
      </CardContent>
    </Card>}
  </div>;
}
