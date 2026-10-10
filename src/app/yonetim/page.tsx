import Link from "next/link";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Building2, CheckCircle2, ChevronRight, Layers3, PackageCheck, ReceiptText, RotateCcw, Truck, Wallet } from "lucide-react";
import { adminDashboard, adminOverview } from "@/modules/admin/data";
import { normalizeSearchParams, type SearchParams } from "@/lib/search-params";
import { requireAdmin } from "@/modules/auth/session";
import { approveService } from "@/modules/admin/actions";
import { supplierHealth } from "@/modules/suppliers/health";
import { supplierStatuses } from "@/modules/suppliers/clients";
import { money } from "@/modules/store/catalog";
import { db } from "@/lib/db";
import { EnrichmentRefresh } from "@/components/admin/enrichment-refresh";
import { OrderStatusBadge, PaymentStatusBadge } from "@/components/admin/order-badges";
import { OrdersChart } from "@/components/admin/orders-chart";
import { AdminColumns, AdminPage, AdminPageHeader, AdminPanel, ProgressBar, Stat, StatGrid, StatusBadge, StatusMessage, EmptyState } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

const number = (value: number | string) => new Intl.NumberFormat("tr-TR").format(Number(value));
const time = (value: Date | string) => new Date(value).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const today = () => new Date().toLocaleDateString("tr-TR", { timeZone: "Europe/Istanbul", weekday: "long", day: "numeric", month: "long" });
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
  const [{ accounts }, data, health] = await Promise.all([
    adminOverview(), adminDashboard(), supplierHealth(db, process.env.BASBUG_FIRMA_ADI || "BASBUG").catch(() => null),
  ]);
  const pending = accounts.filter(a => !a.approved);
  const { orders, days, recent } = data;
  const revenue = Number(orders.revenue_30d), previous = Number(orders.revenue_prev_30d);
  const delta = previous > 0 ? (revenue - previous) / previous * 100 : null;
  const enrichment = Object.fromEntries(data.enrichment.map(row => [row.status, row.count])) as Record<string, number>;
  const enrichmentTotal = data.enrichment.reduce((sum, row) => sum + row.count, 0);
  const enrichmentAttention = (enrichment.review || 0) + (enrichment.blocked || 0) + (enrichment.failed || 0);
  const lastSuccess = [...(health?.scopes.map(scope => scope.commerce_last_success_at ?? scope.last_success_at) ?? []), data.lastSuccess?.completed_at]
    .filter((d): d is Date => Boolean(d)).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  const basbugTone = !health ? "danger" : health.healthy ? "success" : "warning";

  const attention = [
    { href: "/yonetim/siparisler?status=action", icon: ReceiptText, tone: "warning", title: "Teyit bekleyen sipariş", note: "Tedarikçi stok ve teslim süresini teyit edip onayla", count: orders.action },
    { href: "/yonetim/siparisler?status=shipping", icon: Truck, tone: "info", title: "Sevk bekleyen sipariş", note: "Onaylandı, kargoya verilmeyi bekliyor", count: orders.shipping },
    { href: "/yonetim/siparisler?status=refund", icon: RotateCcw, tone: "danger", title: "İade bekleyen ödeme", note: "TAMI portalından iade edip referansı kaydet", count: orders.refund },
    { href: "/yonetim/servisler", icon: Building2, tone: "warning", title: "Onay bekleyen servis başvurusu", note: "Onay, fiyat ve sepet erişimini açar", count: pending.length },
    { href: "/yonetim/urun-verileri?status=attention", icon: Layers3, tone: "warning", title: "Kontrol bekleyen zenginleştirme", note: "İnceleme, erişim veya işlem hatası", count: enrichmentAttention },
    { href: "/yonetim/tedarikciler/basbug", icon: AlertTriangle, tone: "danger", title: "Başbuğ senkronizasyon sorunu", note: health && !health.heartbeat?.alive ? "Zamanlayıcıdan çalışma sinyali alınamıyor" : "Güncelliği aşılan veya hata veren grup", count: health ? health.issues.length + (health.heartbeat?.alive ? 0 : 1) : 1 },
  ];
  const open = attention.filter(item => item.count > 0);

  const tones: Record<string, string> = { warning: "bg-warning/10 text-warning", danger: "bg-destructive/10 text-destructive", info: "bg-primary/10 text-primary" };

  return <AdminPage>
    <AdminPageHeader title="Genel bakış" description={<>Bugün {today()} · Siparişler, tedarikçi verisi ve katalog durumunun özeti.</>} actions={<EnrichmentRefresh/>}/>
    {approved && <StatusMessage>Servis başvurusu onaylandı.</StatusMessage>}
    {error && <StatusMessage tone="error">Başvuru onaylanamadı. İndirim %0–50 olmalı; başvuru daha önce onaylanmış olabilir.</StatusMessage>}

    <StatGrid label="Özet">
      <Stat icon={Wallet} label="Ciro · son 30 gün" value={money(revenue)}
        note={<>{number(orders.paid_30d)} ödenmiş sipariş{delta !== null && <> · <span className={cn("inline-flex items-center font-semibold", delta >= 0 ? "text-success" : "text-destructive")}>{delta >= 0 ? <ArrowUpRight className="size-3"/> : <ArrowDownRight className="size-3"/>}%{Math.abs(delta).toLocaleString("tr-TR", { maximumFractionDigits: 1 })}</span> önceki 30 güne göre</>}</>}/>
      <Stat icon={ReceiptText} label="İşlem bekleyen sipariş" value={number(orders.action + orders.refund)} tone={orders.action + orders.refund ? "warning" : "success"}
        note={`${number(orders.action)} teyit · ${number(orders.refund)} iade · ${number(orders.awaiting_payment)} ödeme bekliyor`} href="/yonetim/siparisler?status=action" linkLabel="Siparişlere git"/>
      <Stat icon={PackageCheck} label="Katalogdaki ürün" value={number(data.catalog.items)} note="Başbuğ güncel listesinde bulunan kayıtlar" href="/yonetim/tedarikciler/basbug" linkLabel="Ürünleri incele"/>
      <Stat icon={Truck} label="Başbuğ senkronizasyonu" tone={basbugTone} value={basbugTone === "success" ? "Sağlıklı" : basbugTone === "warning" ? "Dikkat" : "Hata"}
        note={`Son başarılı çekim ${ago(lastSuccess)} · ${health?.heartbeat?.alive ? "zamanlayıcı çalışıyor" : "zamanlayıcı sinyali yok"}`} href="/yonetim/tedarikciler/basbug" linkLabel="Durumu gör"/>
    </StatGrid>

    <AdminColumns wide>
      <AdminPanel title="Siparişler · son 14 gün" description={`Oluşturulma gününe göre · toplam ${number(days.reduce((sum, day) => sum + day.orders, 0))} sipariş`} actions={<Link className="font-medium text-primary hover:underline" href="/yonetim/siparisler">Tüm siparişler →</Link>}>
        <OrdersChart days={days}/>
      </AdminPanel>
      <AdminPanel title="Dikkat gerektirenler" description={open.length ? `${open.length} konu işlem bekliyor` : "Her şey yolunda"} flush>
        {open.length ? <ItemGroup className="gap-0!">{open.map(item => <Item key={item.title} size="sm" className="rounded-none border-0 px-4 py-3 hover:bg-muted/60 [&+&]:border-t" render={<Link href={item.href}/>}>
          <ItemMedia variant="icon" className={cn("rounded-md", tones[item.tone])}><item.icon aria-hidden="true"/></ItemMedia>
          <ItemContent><ItemTitle>{item.title}</ItemTitle><ItemDescription>{item.note}</ItemDescription></ItemContent>
          <ItemActions><span className="text-base font-semibold tabular-nums">{number(item.count)}</span><ChevronRight className="size-4 text-muted-foreground" aria-hidden="true"/></ItemActions>
        </Item>)}</ItemGroup> : <EmptyState title="Bekleyen iş yok" icon={<CheckCircle2/>}>Siparişler, başvurular ve senkronizasyon güncel.</EmptyState>}
      </AdminPanel>
    </AdminColumns>

    <AdminColumns wide>
      <AdminPanel title="Son siparişler" actions={<Link className="font-medium text-primary hover:underline" href="/yonetim/siparisler">Tümü →</Link>} flush>
        {recent.length ? <Table><TableHeader><TableRow><TableHead className="pl-4">Sipariş</TableHead><TableHead>Müşteri</TableHead><TableHead>Durum</TableHead><TableHead>Ödeme</TableHead><TableHead className="pr-4 text-right">Tutar</TableHead></TableRow></TableHeader><TableBody>
          {recent.map(order => <TableRow key={order.id}>
            <TableCell className="pl-4"><Link className="font-medium hover:text-primary hover:underline" href={`/siparis/${order.id}`}>#{order.number}</Link><div className="text-xs text-muted-foreground">{time(order.created_at)}</div></TableCell>
            <TableCell>{order.customer_name}</TableCell>
            <TableCell><OrderStatusBadge status={order.status}/></TableCell>
            <TableCell><PaymentStatusBadge status={order.payment_status}/></TableCell>
            <TableCell className="pr-4 text-right font-medium tabular-nums">{money(Number(order.total_kurus))}</TableCell>
          </TableRow>)}
        </TableBody></Table> : <EmptyState title="Henüz sipariş yok"/>}
      </AdminPanel>
      <div className="flex min-w-0 flex-col gap-4">
        <AdminPanel title="Ürün zenginleştirme" actions={<Link className="font-medium text-primary hover:underline" href="/yonetim/urun-verileri">Aç →</Link>}>
          <p className="mb-2 text-sm text-muted-foreground"><strong className="text-lg font-semibold text-foreground tabular-nums">{number(enrichmentTotal - (enrichment.pending || 0))}</strong> / {number(enrichmentTotal)} ürün incelendi</p>
          <ProgressBar label="Zenginleştirme ilerlemesi" total={enrichmentTotal} segments={[
            { value: enrichment.complete || 0, tone: "success" }, { value: enrichment.partial || 0 },
            { value: enrichmentAttention, tone: "warning" }, { value: enrichment.not_found || 0, tone: "muted" },
          ]}/>
          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground tabular-nums">
            <li className="flex items-center gap-1.5"><i className="size-2 rounded-sm bg-chart-2"/>{number(enrichment.complete || 0)} tamam</li>
            <li className="flex items-center gap-1.5"><i className="size-2 rounded-sm bg-primary"/>{number(enrichment.partial || 0)} kısmi</li>
            <li className="flex items-center gap-1.5"><i className="size-2 rounded-sm bg-chart-3"/>{number(enrichmentAttention)} kontrol</li>
            <li className="flex items-center gap-1.5"><i className="size-2 rounded-sm bg-chart-5"/>{number(enrichment.not_found || 0)} eşleşmeyen</li>
          </ul>
        </AdminPanel>
        <AdminPanel title="Tedarikçi bağlantıları" actions={<Link className="font-medium text-primary hover:underline" href="/yonetim/tedarikciler">Yönet →</Link>} flush>
          <ItemGroup className="gap-0!">{supplierStatuses().map(s => {
            const isBasbug = s.name === "Başbuğ";
            const tone = isBasbug ? basbugTone : "neutral";
            return <Item key={s.name} size="sm" className="rounded-none border-0 px-4 py-3 hover:bg-muted/60 [&+&]:border-t" render={<Link href={isBasbug ? "/yonetim/tedarikciler/basbug" : "/yonetim/tedarikciler/dinamik"}/>}>
              <ItemMedia variant="icon" className="rounded-md bg-muted font-semibold text-muted-foreground">{s.name.slice(0, 1)}</ItemMedia>
              <ItemContent><ItemTitle>{s.name}</ItemTitle><ItemDescription>{isBasbug ? `Son çekim ${ago(data.lastImport?.started_at)}${data.lastImport ? ` · ${data.lastImport.list_group}` : ""}` : s.configured ? "Değişkenler tanımlı · bağlantı doğrulanmadı" : "Bağlantı değişkenleri eksik"}</ItemDescription></ItemContent>
              <ItemActions><StatusBadge tone={tone === "danger" ? "error" : tone}>{isBasbug ? (tone === "success" ? "Sağlıklı" : tone === "warning" ? "Dikkat" : "Hata") : "Doğrulanmadı"}</StatusBadge></ItemActions>
            </Item>;
          })}</ItemGroup>
        </AdminPanel>
      </div>
    </AdminColumns>

    {pending.length > 0 && <AdminPanel title="Onay bekleyen servis başvuruları" description="Onay, servise fiyat ve sepet erişimini hemen açar." actions={<Link className="font-medium text-primary hover:underline" href="/yonetim/servisler">Tüm servisler →</Link>} flush>
      <ItemGroup className="gap-0!">{pending.map(a => <Item key={a.id} className="rounded-none border-0 px-4 py-3 [&+&]:border-t">
        <ItemContent><ItemTitle>{a.name}</ItemTitle><ItemDescription>{a.email}{a.contact_name && ` · ${a.contact_name} · ${a.phone} · ${a.city}`}</ItemDescription></ItemContent>
        <ItemActions><form action={approveService} className="flex items-end gap-2"><input type="hidden" name="id" value={a.id}/>
          <Field className="w-36 gap-1"><FieldLabel htmlFor={`discount-${a.id}`} className="text-xs">Özel indirim (%)</FieldLabel><Input id={`discount-${a.id}`} name="discount" type="number" min={0} max={50} defaultValue={0} required/></Field>
          <Button type="submit">Başvuruyu onayla</Button>
        </form></ItemActions>
      </Item>)}</ItemGroup>
    </AdminPanel>}
  </AdminPage>;
}
