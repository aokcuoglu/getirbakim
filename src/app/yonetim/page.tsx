import Link from "next/link";
import { AlertTriangle, Building2, CheckCircle2, ChevronRight, CircleAlert, CircleCheck, Clock, Layers3, PackageCheck, ReceiptText, RotateCcw, TrendingDown, TrendingUp, TriangleAlert, Truck, Wallet, type LucideIcon } from "lucide-react";
import { adminDashboard, adminOverview } from "@/modules/admin/data";
import { normalizeSearchParams, type SearchParams } from "@/lib/search-params";
import { requireAdmin } from "@/modules/auth/session";
import { approveService } from "@/modules/admin/actions";
import { supplierHealth } from "@/modules/suppliers/health";
import { DINAMIK_COMPANY } from "@/modules/suppliers/dinamik-import";
import { supplierStatuses } from "@/modules/suppliers/clients";
import { money } from "@/modules/store/catalog";
import { db } from "@/lib/db";
import { EnrichmentRefresh } from "@/components/admin/enrichment-refresh";
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

const number = (value: number | string) => new Intl.NumberFormat("tr-TR").format(Number(value));
const time = (value: Date | string) => new Date(value).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const today = () => new Date().toLocaleDateString("tr-TR", { timeZone: "Europe/Istanbul", weekday: "long", day: "numeric", month: "long" });
type Tone = "success" | "warning" | "danger" | "neutral";
const looks: Record<Tone, { variant: "secondary" | "outline" | "destructive"; icon: LucideIcon }> = {
  success: { variant: "secondary", icon: CircleCheck }, warning: { variant: "outline", icon: TriangleAlert },
  danger: { variant: "destructive", icon: CircleAlert }, neutral: { variant: "outline", icon: Clock },
};
function ToneBadge({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  const look = looks[tone];
  return <Badge variant={look.variant}><look.icon data-icon="inline-start" aria-hidden="true"/>{children}</Badge>;
}
const healthLabel = (tone: Tone) => tone === "success" ? "Sağlıklı" : tone === "warning" ? "Dikkat" : tone === "neutral" ? "Bekliyor" : "Hata";

function ago(value: Date | null | undefined) {
  if (!value) return "Henüz yok";
  const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60000);
  if (minutes < 1) return "az önce";
  if (minutes < 60) return `${minutes} dk önce`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} sa önce`;
  return `${Math.round(minutes / 1440)} gün önce`;
}

export default async function Admin({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireAdmin();
  const { approved, error } = normalizeSearchParams(await searchParams);
  const [{ accounts }, data, health, dinamikHealth] = await Promise.all([
    adminOverview(), adminDashboard(), supplierHealth(db, process.env.BASBUG_FIRMA_ADI || "BASBUG").catch(() => null),
    supplierHealth(db, DINAMIK_COMPANY).catch(() => null),
  ]);
  const dinamikLast = dinamikHealth?.scopes.reduce<Date | null>((latest, scope) => scope.last_success_at && (!latest || scope.last_success_at > latest) ? scope.last_success_at : latest, null);
  const dinamikTone: Tone = !dinamikHealth ? "danger" : dinamikHealth.healthy ? "success" : dinamikLast ? "warning" : "neutral";
  const pending = accounts.filter(a => !a.approved);
  const { orders, days, recent } = data;
  const revenue = Number(orders.revenue_30d), previous = Number(orders.revenue_prev_30d);
  const delta = previous > 0 ? (revenue - previous) / previous * 100 : null;
  const enrichment = Object.fromEntries(data.enrichment.map(row => [row.status, row.count])) as Record<string, number>;
  const enrichmentTotal = data.enrichment.reduce((sum, row) => sum + row.count, 0);
  const enrichmentAttention = (enrichment.review || 0) + (enrichment.blocked || 0) + (enrichment.failed || 0);
  const lastSuccess = [...(health?.scopes.map(scope => scope.commerce_last_success_at ?? scope.last_success_at) ?? []), data.lastSuccess?.completed_at]
    .filter((d): d is Date => Boolean(d)).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  const basbugTone: Tone = !health ? "danger" : health.healthy ? "success" : "warning";

  const attention = [
    { href: "/yonetim/siparisler?status=action", icon: ReceiptText, tone: "warning", title: "Teyit bekleyen sipariş", note: "Tedarikçi stok ve teslim süresini teyit edip onayla", count: orders.action },
    { href: "/yonetim/siparisler?status=shipping", icon: Truck, tone: "neutral", title: "Sevk bekleyen sipariş", note: "Onaylandı, kargoya verilmeyi bekliyor", count: orders.shipping },
    { href: "/yonetim/siparisler?status=refund", icon: RotateCcw, tone: "danger", title: "İade bekleyen ödeme", note: "TAMI portalından iade edip referansı kaydet", count: orders.refund },
    { href: "/yonetim/servisler", icon: Building2, tone: "warning", title: "Onay bekleyen servis başvurusu", note: "Onay, fiyat ve sepet erişimini açar", count: pending.length },
    { href: "/yonetim/urun-verileri?status=attention", icon: Layers3, tone: "warning", title: "Kontrol bekleyen zenginleştirme", note: "İnceleme, erişim veya işlem hatası", count: enrichmentAttention },
    { href: "/yonetim/tedarikciler/basbug", icon: AlertTriangle, tone: "danger", title: "Başbuğ senkronizasyon sorunu", note: health && !health.heartbeat?.alive ? "Zamanlayıcıdan çalışma sinyali alınamıyor" : "Güncelliği aşılan veya hata veren grup", count: health ? health.issues.length + (health.heartbeat?.alive ? 0 : 1) : 1 },
  ];
  const open = attention.filter(item => item.count > 0);

  const reviewed = enrichmentTotal - (enrichment.pending || 0);

  return <div className="flex flex-col gap-6">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Genel bakış</h1>
        <p className="text-muted-foreground">Bugün {today()} · Siparişler, tedarikçi verisi ve katalog durumunun özeti.</p>
      </div>
      <div className="flex flex-wrap gap-2"><EnrichmentRefresh/></div>
    </div>
    {approved && <Alert role="status"><CircleCheck/><AlertDescription>Servis başvurusu onaylandı.</AlertDescription></Alert>}
    {error && <Alert variant="destructive"><CircleAlert/><AlertDescription>Başvuru onaylanamadı. İndirim %0–50 olmalı; başvuru daha önce onaylanmış olabilir.</AlertDescription></Alert>}

    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Özet">
      <Card>
        <CardHeader>
          <CardDescription>Ciro · son 30 gün</CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums">{money(revenue)}</CardTitle>
          {delta !== null && <CardAction><Badge variant="outline">{delta >= 0 ? <TrendingUp data-icon="inline-start"/> : <TrendingDown data-icon="inline-start"/>}%{Math.abs(delta).toLocaleString("tr-TR", { maximumFractionDigits: 1 })}</Badge></CardAction>}
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
          <CardAction><ToneBadge tone={orders.action + orders.refund ? "warning" : "success"}>{orders.action + orders.refund ? "Bekliyor" : "Güncel"}</ToneBadge></CardAction>
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
          <CardDescription>Başbuğ senkronizasyonu</CardDescription>
          <CardTitle className="text-2xl font-semibold">{basbugTone === "success" ? "Sağlıklı" : basbugTone === "warning" ? "Dikkat" : "Hata"}</CardTitle>
          <CardAction><ToneBadge tone={basbugTone}>{health?.heartbeat?.alive ? "Zamanlayıcı çalışıyor" : "Sinyal yok"}</ToneBadge></CardAction>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1 text-sm">
          <div className="flex items-center gap-2 font-medium"><Truck className="size-4" aria-hidden="true"/>Son başarılı çekim {ago(lastSuccess)}</div>
          <Link className="text-muted-foreground underline-offset-4 hover:underline" href="/yonetim/tedarikciler/basbug">Durumu gör</Link>
        </CardFooter>
      </Card>
    </section>

    <div className="grid items-start gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Siparişler · son 14 gün</CardTitle>
          <CardDescription>Oluşturulma gününe göre · toplam {number(days.reduce((sum, day) => sum + day.orders, 0))} sipariş</CardDescription>
          <CardAction><Button variant="outline" size="sm" nativeButton={false} render={<Link href="/yonetim/siparisler"/>}>Tüm siparişler</Button></CardAction>
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
              <ItemActions><Badge variant={item.tone === "danger" ? "destructive" : "secondary"} className="tabular-nums">{number(item.count)}</Badge><ChevronRight className="size-4" aria-hidden="true"/></ItemActions>
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
          <CardAction><Button variant="outline" size="sm" nativeButton={false} render={<Link href="/yonetim/siparisler"/>}>Tümü</Button></CardAction>
        </CardHeader>
        <CardContent>
          {recent.length ? <Table><TableHeader><TableRow><TableHead>Sipariş</TableHead><TableHead>Müşteri</TableHead><TableHead>Durum</TableHead><TableHead>Ödeme</TableHead><TableHead className="text-right">Tutar</TableHead></TableRow></TableHeader><TableBody>
            {recent.map(order => <TableRow key={order.id}>
              <TableCell><Link className="font-medium underline-offset-4 hover:underline" href={`/siparis/${order.id}`}>#{order.number}</Link><div className="text-muted-foreground">{time(order.created_at)}</div></TableCell>
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
            <CardAction><Button variant="outline" size="sm" nativeButton={false} render={<Link href="/yonetim/urun-verileri"/>}>Aç</Button></CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Progress value={enrichmentTotal ? Math.round(reviewed / enrichmentTotal * 100) : 0}>
              <ProgressLabel>Zenginleştirme ilerlemesi</ProgressLabel>
              <ProgressValue/>
            </Progress>
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary" className="tabular-nums">{number(enrichment.complete || 0)} tamam</Badge>
              <Badge variant="outline" className="tabular-nums">{number(enrichment.partial || 0)} kısmi</Badge>
              <Badge variant={enrichmentAttention ? "destructive" : "outline"} className="tabular-nums">{number(enrichmentAttention)} kontrol</Badge>
              <Badge variant="outline" className="tabular-nums">{number(enrichment.not_found || 0)} eşleşmeyen</Badge>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Tedarikçi bağlantıları</CardTitle>
            <CardAction><Button variant="outline" size="sm" nativeButton={false} render={<Link href="/yonetim/tedarikciler"/>}>Yönet</Button></CardAction>
          </CardHeader>
          <CardContent>
            <ItemGroup>{supplierStatuses().map((s, index) => {
              const isBasbug = s.name === "Başbuğ", isDinamik = s.name === "Dinamik";
              const tone: Tone = isBasbug ? basbugTone : isDinamik ? dinamikTone : s.verified ? "success" : "neutral";
              return <div key={s.name}>
                {index > 0 && <ItemSeparator/>}
                <Item size="sm" render={<Link href={s.href}/>}>
                  <ItemContent><ItemTitle>{s.name}</ItemTitle><ItemDescription>{isBasbug ? `Son çekim ${ago(data.lastImport?.started_at)}${data.lastImport ? ` · ${data.lastImport.list_group}` : ""}` : !s.configured ? "Bağlantı değişkenleri eksik" : isDinamik ? `Son çekim ${ago(dinamikLast)} · ${dinamikHealth?.scopes.length ?? 0} marka` : s.verified ? "Bağlantı doğrulandı" : "Değişkenler tanımlı · bağlantı doğrulanmadı"}</ItemDescription></ItemContent>
                  <ItemActions><ToneBadge tone={tone}>{isBasbug || isDinamik ? healthLabel(tone) : s.verified ? "Bağlı" : "Doğrulanmadı"}</ToneBadge></ItemActions>
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
        <CardAction><Button variant="outline" size="sm" nativeButton={false} render={<Link href="/yonetim/servisler"/>}>Tüm servisler</Button></CardAction>
      </CardHeader>
      <CardContent>
        <ItemGroup>{pending.map((a, index) => <div key={a.id}>
          {index > 0 && <ItemSeparator/>}
          <Item>
            <ItemContent><ItemTitle>{a.name}</ItemTitle><ItemDescription>{a.email}{a.contact_name && ` · ${a.contact_name} · ${a.phone} · ${a.city}`}</ItemDescription></ItemContent>
            <ItemActions><form action={approveService} className="flex items-end gap-2"><input type="hidden" name="id" value={a.id}/>
              <Field className="w-36"><FieldLabel htmlFor={`discount-${a.id}`}>Özel indirim (%)</FieldLabel><Input id={`discount-${a.id}`} name="discount" type="number" min={0} max={50} defaultValue={0} required/></Field>
              <Button type="submit">Başvuruyu onayla</Button>
            </form></ItemActions>
          </Item>
        </div>)}</ItemGroup>
      </CardContent>
    </Card>}
  </div>;
}
