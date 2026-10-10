import Link from "next/link";
import { ChevronLeft, ChevronRight, Inbox } from "lucide-react";
import { adminOrders, fitmentReturnReport, orderFilters, type OrderFilter } from "@/modules/admin/data";
import { fitmentLevelLabels, type FitmentLevel } from "@/modules/store/fitment-level";
import { normalizeSearchParams, type SearchParams } from "@/lib/search-params";
import { requireAdmin } from "@/modules/auth/session";
import { money } from "@/modules/store/catalog";
import { changeOrderStatus, recordRefund } from "@/modules/admin/commerce-actions";
import { OrderStatusBadge, PaymentStatusBadge } from "@/components/admin/order-badges";
import { AdminPage, AdminPageHeader, AdminPanel, AdminTabs, EmptyState, StatusMessage, TableRegion } from "@/components/admin/ui";

const time = (value: Date | string) => new Date(value).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const tabOrder: OrderFilter[] = ["all", "action", "shipping", "refund", "awaiting_payment", "shipped", "cancelled"];

export default async function Orders({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireAdmin();
  const params = normalizeSearchParams(await searchParams);
  const [{ orders, page, filter, counts }, fitment] = await Promise.all([adminOrders(params.page, params.status), fitmentReturnReport()]);
  const href = (changes: { status?: string; page?: number }) => {
    const query = new URLSearchParams();
    const status = changes.status ?? filter;
    if (status !== "all") query.set("status", status);
    if (changes.page && changes.page > 1) query.set("page", String(changes.page));
    return `/yonetim/siparisler${query.size ? `?${query}` : ""}`;
  };
  const shown = orders.slice(0, 50);
  return <AdminPage>
    <AdminPageHeader breadcrumbs={[{ label: "Yönetim", href: "/yonetim" }, { label: "Siparişler" }]} title="Siparişler"
      description="Ödemesi alınmış siparişlerde tedarikçi stokunu ve teslim süresini teyit ettikten sonra onayla. Stok yoksa iptal et; ödeme iadesini TAMI portalından yapıp referansı kaydet. Ödenmemiş siparişler süresi dolunca kendiliğinden iptal olur."/>
    {params.saved && <StatusMessage>Sipariş güncellendi.</StatusMessage>}
    {params.error && <StatusMessage tone="error">Bu değişikliğe izin verilmiyor. Listeyi yenileyin.</StatusMessage>}

    <AdminPanel flush>
      <div style={{ padding: "0 12px" }}><AdminTabs label="Sipariş durumları" tabs={tabOrder.map(key => ({ href: href({ status: key }), label: orderFilters[key].label, count: counts[key], current: filter === key }))}/></div>
      {shown.length ? <TableRegion label="Siparişler"><table className="admin-table">
        <thead><tr><th>Sipariş</th><th>Müşteri</th><th>Durum</th><th>Ödeme</th><th className="num">Tutar</th><th style={{ textAlign: "right" }}>İşlem</th></tr></thead>
        <tbody>{shown.map(o => <tr key={o.id}>
          <td className="nowrap"><Link className="admin-row-link" href={`/siparis/${o.id}`}>#{o.number}</Link><small>{time(o.created_at)}</small></td>
          <td style={{ minWidth: 220 }}><strong>{o.customer_name}</strong><small>{o.email} · {o.phone}</small>
            <details className="admin-disclosure" style={{ marginTop: 4 }}><summary>Teslimat ve ödeme ayrıntıları</summary>
              <dl className="admin-detail-grid">
                <div><dt>Adres</dt><dd>{o.address}</dd></div>
                {o.note && <div><dt>Not</dt><dd>{o.note}</dd></div>}
                {o.payments.length > 0 && <div><dt>TAMI</dt><dd>{o.payments.map(p => `${p.provider_order_id} (${p.status}${p.bank_reference ? ` · banka ref. ${p.bank_reference}` : ""})`).join(", ")}</dd></div>}
                {o.paid_at && <div><dt>Ödeme zamanı</dt><dd>{time(o.paid_at)}</dd></div>}
                {o.refund_reference && <div><dt>İade referansı</dt><dd>{o.refund_reference}</dd></div>}
              </dl>
            </details>
            {o.payment_note && <small style={{ color: "var(--a-danger)" }}>{o.payment_note}</small>}
          </td>
          <td><OrderStatusBadge status={o.status}/></td>
          <td><PaymentStatusBadge status={o.payment_status}/></td>
          <td className="num"><strong>{money(Number(o.total_kurus))}</strong>{Number(o.shipping_kurus) > 0 && <small>Kargo {money(Number(o.shipping_kurus))} dahil</small>}</td>
          <td>
            {["pending", "confirmed"].includes(o.status) && ["paid", "none"].includes(o.payment_status) && <form action={changeOrderStatus} className="admin-row-actions">
              <input type="hidden" name="id" value={o.id}/>
              <select name="status" aria-label={`#${o.number} yeni durum`}>{o.status === "pending" ? <option value="confirmed">Onayla</option> : <option value="shipped">Sevk edildi</option>}<option value="cancelled">{o.payment_status === "paid" ? "İptal et (iade gerekecek)" : "İptal et"}</option></select>
              <button>Uygula</button>
            </form>}
            {o.payment_status === "refund_required" && <form action={recordRefund} className="admin-row-actions">
              <input type="hidden" name="id" value={o.id}/>
              <input name="reference" aria-label={`#${o.number} TAMI iade referansı`} placeholder="TAMI iade ref." minLength={3} maxLength={120} required style={{ width: 150 }}/>
              <button>İade yapıldı</button>
            </form>}
          </td>
        </tr>)}</tbody>
      </table></TableRegion> : <EmptyState title={filter === "all" ? "Henüz sipariş yok" : "Bu durumda sipariş yok"} icon={<Inbox size={28}/>}>{filter !== "all" && <p><Link className="admin-link" href={href({ status: "all" })}>Tüm siparişleri göster</Link></p>}</EmptyState>}
      {(page > 1 || orders.length > 50) && <div className="admin-table-footer"><span>Sayfa {page}</span><div className="admin-pager">
        {page > 1 ? <Link href={href({ page: page - 1 })}><ChevronLeft size={14}/>Önceki</Link> : <span aria-disabled="true"><ChevronLeft size={14}/>Önceki</span>}
        {orders.length > 50 ? <Link href={href({ page: page + 1 })}>Sonraki<ChevronRight size={14}/></Link> : <span aria-disabled="true">Sonraki<ChevronRight size={14}/></span>}
      </div></div>}
    </AdminPanel>

    {fitment.length > 0 && <AdminPanel title="Uyumluluk ve iadeler" description="İptal edilmemiş siparişlerin satırları, sipariş anındaki uyumluluk durumuna göre. İadeler sevk edilen siparişin sayfasından kaydedilir.">
      <TableRegion label="Uyumluluk ve iadeler"><table className="admin-table"><thead><tr><th scope="col">Uyumluluk</th><th scope="col" className="num">Satır</th><th scope="col" className="num">İade edilen</th><th scope="col" className="num">“Aracıma uymadı”</th></tr></thead>
        <tbody>{fitment.map(row => <tr key={row.level}><td>{row.level === "unrecorded" ? "Kayıt yok (eski sipariş)" : fitmentLevelLabels[row.level as FitmentLevel] ?? row.level}</td><td className="num">{row.lines}</td><td className="num">{row.returned}</td><td className="num">{row.not_fit}</td></tr>)}</tbody></table></TableRegion>
    </AdminPanel>}
  </AdminPage>;
}
