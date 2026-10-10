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
import { AdminPage, AdminPageHeader, AdminPanel, ProgressBar, Stat, StatGrid, StatusBadge, StatusMessage, EmptyState, TableRegion } from "@/components/admin/ui";

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
  const maxDay = Math.max(1, ...days.map(day => day.orders));
  const dayLabel = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString("tr-TR", { day: "numeric", month: "short" });

  const attention = [
    { href: "/yonetim/siparisler?status=action", icon: ReceiptText, tone: "warning", title: "Teyit bekleyen sipariş", note: "Tedarikçi stok ve teslim süresini teyit edip onayla", count: orders.action },
    { href: "/yonetim/siparisler?status=shipping", icon: Truck, tone: "info", title: "Sevk bekleyen sipariş", note: "Onaylandı, kargoya verilmeyi bekliyor", count: orders.shipping },
    { href: "/yonetim/siparisler?status=refund", icon: RotateCcw, tone: "danger", title: "İade bekleyen ödeme", note: "TAMI portalından iade edip referansı kaydet", count: orders.refund },
    { href: "/yonetim/servisler", icon: Building2, tone: "warning", title: "Onay bekleyen servis başvurusu", note: "Onay, fiyat ve sepet erişimini açar", count: pending.length },
    { href: "/yonetim/urun-verileri?status=attention", icon: Layers3, tone: "warning", title: "Kontrol bekleyen zenginleştirme", note: "İnceleme, erişim veya işlem hatası", count: enrichmentAttention },
    { href: "/yonetim/tedarikciler/basbug", icon: AlertTriangle, tone: "danger", title: "Başbuğ senkronizasyon sorunu", note: health && !health.heartbeat?.alive ? "Zamanlayıcıdan çalışma sinyali alınamıyor" : "Güncelliği aşılan veya hata veren grup", count: health ? health.issues.length + (health.heartbeat?.alive ? 0 : 1) : 1 },
  ];
  const open = attention.filter(item => item.count > 0);

  return <AdminPage>
    <AdminPageHeader title="Genel bakış" description={<>Bugün {today()} · Siparişler, tedarikçi verisi ve katalog durumunun özeti.</>} actions={<EnrichmentRefresh/>}/>
    {approved && <StatusMessage>Servis başvurusu onaylandı.</StatusMessage>}
    {error && <StatusMessage tone="error">Başvuru onaylanamadı. İndirim %0–50 olmalı; başvuru daha önce onaylanmış olabilir.</StatusMessage>}

    <StatGrid label="Özet">
      <Stat icon={Wallet} label="Ciro · son 30 gün" value={money(revenue)}
        note={<>{number(orders.paid_30d)} ödenmiş sipariş{delta !== null && <> · <span className={`admin-delta ${delta >= 0 ? "is-up" : "is-down"}`}>{delta >= 0 ? <ArrowUpRight size={12}/> : <ArrowDownRight size={12}/>}%{Math.abs(delta).toLocaleString("tr-TR", { maximumFractionDigits: 1 })}</span> önceki 30 güne göre</>}</>}/>
      <Stat icon={ReceiptText} label="İşlem bekleyen sipariş" value={number(orders.action + orders.refund)} tone={orders.action + orders.refund ? "warning" : "success"}
        note={`${number(orders.action)} teyit · ${number(orders.refund)} iade · ${number(orders.awaiting_payment)} ödeme bekliyor`} href="/yonetim/siparisler?status=action" linkLabel="Siparişlere git"/>
      <Stat icon={PackageCheck} label="Katalogdaki ürün" value={number(data.catalog.items)} note="Başbuğ güncel listesinde bulunan kayıtlar" href="/yonetim/tedarikciler/basbug" linkLabel="Ürünleri incele"/>
      <Stat icon={Truck} label="Başbuğ senkronizasyonu" tone={basbugTone} value={basbugTone === "success" ? "Sağlıklı" : basbugTone === "warning" ? "Dikkat" : "Hata"}
        note={`Son başarılı çekim ${ago(lastSuccess)} · ${health?.heartbeat?.alive ? "zamanlayıcı çalışıyor" : "zamanlayıcı sinyali yok"}`} href="/yonetim/tedarikciler/basbug" linkLabel="Durumu gör"/>
    </StatGrid>

    <div className="admin-grid-main">
      <AdminPanel title="Siparişler · son 14 gün" description={`Oluşturulma gününe göre · toplam ${number(days.reduce((sum, day) => sum + day.orders, 0))} sipariş · en yüksek ${number(maxDay)}/gün`} actions={<Link className="admin-link" href="/yonetim/siparisler">Tüm siparişler →</Link>}>
        <div className="admin-bars" role="img" aria-label={`Son 14 günde ${number(days.reduce((s, d) => s + d.orders, 0))} sipariş`}>
          {days.map(day => <div key={day.day} title={`${dayLabel(day.day)}: ${day.orders} sipariş · ${money(day.revenue_kurus)} ödenmiş`}>
            <span style={{ height: `${day.orders / maxDay * 100}%` }}/><small>{dayLabel(day.day).split(" ")[0]}</small>
          </div>)}
        </div>
      </AdminPanel>
      <AdminPanel title="Dikkat gerektirenler" description={open.length ? `${open.length} konu işlem bekliyor` : "Her şey yolunda"} flush>
        {open.length ? <ul className="admin-actions-list">{open.map(item => <li key={item.title}><Link href={item.href}>
          <span className={`admin-action-icon is-${item.tone}`}><item.icon size={16} aria-hidden="true"/></span>
          <div><strong>{item.title}</strong><small>{item.note}</small></div><b>{number(item.count)}</b><ChevronRight size={16} className="admin-chevron" aria-hidden="true"/>
        </Link></li>)}</ul> : <EmptyState title="Bekleyen iş yok" icon={<CheckCircle2 size={28}/>}><p>Siparişler, başvurular ve senkronizasyon güncel.</p></EmptyState>}
      </AdminPanel>
    </div>

    <div className="admin-grid-main">
      <AdminPanel title="Son siparişler" actions={<Link className="admin-link" href="/yonetim/siparisler">Tümü →</Link>}>
        {recent.length ? <TableRegion label="Son siparişler"><table className="admin-table"><thead><tr><th>Sipariş</th><th>Müşteri</th><th>Durum</th><th>Ödeme</th><th className="num">Tutar</th></tr></thead><tbody>
          {recent.map(order => <tr key={order.id}>
            <td className="nowrap"><Link className="admin-row-link" href={`/siparis/${order.id}`}>#{order.number}</Link><small>{time(order.created_at)}</small></td>
            <td>{order.customer_name}</td>
            <td><OrderStatusBadge status={order.status}/></td>
            <td><PaymentStatusBadge status={order.payment_status}/></td>
            <td className="num"><strong>{money(Number(order.total_kurus))}</strong></td>
          </tr>)}
        </tbody></table></TableRegion> : <EmptyState title="Henüz sipariş yok"/>}
      </AdminPanel>
      <div className="admin-stack">
        <AdminPanel title="Ürün zenginleştirme" actions={<Link className="admin-link" href="/yonetim/urun-verileri">Aç →</Link>}>
          <p className="admin-hint" style={{ marginBottom: 8 }}><strong style={{ color: "var(--a-text)", fontSize: 18 }}>{number(enrichmentTotal - (enrichment.pending || 0))}</strong> / {number(enrichmentTotal)} ürün incelendi</p>
          <ProgressBar label="Zenginleştirme ilerlemesi" total={enrichmentTotal} segments={[
            { value: enrichment.complete || 0, tone: "success" }, { value: enrichment.partial || 0 },
            { value: enrichmentAttention, tone: "warning" }, { value: enrichment.not_found || 0, tone: "muted" },
          ]}/>
          <ul className="admin-legend">
            <li><i style={{ background: "#22a356" }}/>{number(enrichment.complete || 0)} tamam</li>
            <li><i/>{number(enrichment.partial || 0)} kısmi</li>
            <li><i style={{ background: "#e6a23c" }}/>{number(enrichmentAttention)} kontrol</li>
            <li><i style={{ background: "#c3cad2" }}/>{number(enrichment.not_found || 0)} eşleşmeyen</li>
          </ul>
        </AdminPanel>
        <AdminPanel title="Tedarikçi bağlantıları" actions={<Link className="admin-link" href="/yonetim/tedarikciler">Yönet →</Link>} flush>
          <ul className="admin-actions-list">{supplierStatuses().map(s => {
            const isBasbug = s.name === "Başbuğ";
            const tone = isBasbug ? basbugTone : s.configured ? "neutral" : "warning";
            return <li key={s.name}><Link href={isBasbug ? "/yonetim/tedarikciler/basbug" : "/yonetim/tedarikciler/dinamik"}>
              <span className="admin-action-icon">{s.name.slice(0, 1)}</span>
              <div><strong>{s.name}</strong><small>{isBasbug ? `Son çekim ${ago(data.lastImport?.started_at)}${data.lastImport ? ` · ${data.lastImport.list_group}` : ""}` : s.configured ? "Değişkenler tanımlı · bağlantı doğrulanmadı" : "Bağlantı değişkenleri eksik"}</small></div>
              <StatusBadge tone={tone === "danger" ? "error" : tone}>{isBasbug ? (tone === "success" ? "Sağlıklı" : tone === "warning" ? "Dikkat" : "Hata") : "Doğrulanmadı"}</StatusBadge>
            </Link></li>;
          })}</ul>
        </AdminPanel>
      </div>
    </div>

    {pending.length > 0 && <AdminPanel title="Onay bekleyen servis başvuruları" description="Onay, servise fiyat ve sepet erişimini hemen açar." actions={<Link className="admin-link" href="/yonetim/servisler">Tüm servisler →</Link>}>
      <ul className="admin-list">{pending.map(a => <li key={a.id} className="admin-row">
        <div><h3>{a.name}</h3><p>{a.email}</p>{a.contact_name && <p>{a.contact_name} · {a.phone} · {a.city}</p>}</div>
        <form action={approveService} className="admin-inline-form" style={{ marginTop: 0 }}><input type="hidden" name="id" value={a.id}/><label>Servise özel indirim (%)<input name="discount" type="number" min={0} max={50} defaultValue={0} required/></label><button>Başvuruyu onayla</button></form>
      </li>)}</ul>
    </AdminPanel>}
  </AdminPage>;
}
