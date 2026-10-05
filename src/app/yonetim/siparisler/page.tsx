import { adminOrders } from "@/modules/admin/data";
import { normalizeSearchParams, type SearchParams } from "@/lib/search-params";
import Link from 'next/link';
import { requireAdmin } from '@/modules/auth/session';
import { money } from '@/modules/store/catalog';
import { orderStatus } from '@/modules/store/orders';
import { changeOrderStatus } from '@/modules/admin/commerce-actions';
export default async function Orders({searchParams}:{searchParams:Promise<SearchParams>}) {
 await requireAdmin();const params=normalizeSearchParams(await searchParams);
 const {orders,page}=await adminOrders(params.page);
 return <section className="shell page-section"><p className="eyebrow">OPERASYON</p><h1 className="page-title">Sipariş yönetimi</h1><p className="muted">Tedarikçi stoku, sevkiyat bedeli ve teslimat süresini müşteriyle teyit ettikten sonra siparişi onaylayın.</p>{params.saved && <p className="notice" role="status">Sipariş durumu güncellendi.</p>}{params.error && <p className="error" role="alert">Bu durum değişikliğine izin verilmiyor. Listeyi yenileyin.</p>}{orders.slice(0,50).map(o=><article key={o.id} className="panel"><div className="commerce-line"><div><Link href={`/siparis/${o.id}`}><h2>Sipariş #{o.number} · {o.customer_name}</h2></Link><p>{o.email} · {o.phone}</p><p className="commerce-address">{o.address}</p>{o.note && <p>{o.note}</p>}<small>{new Date(o.created_at).toLocaleString('tr-TR',{timeZone:'Europe/Istanbul'})}</small></div><div><strong>{money(Number(o.total_kurus))}</strong><p>{orderStatus[o.status]}</p></div></div>{['pending','confirmed'].includes(o.status) && <form action={changeOrderStatus} className="inline-form"><input type="hidden" name="id" value={o.id}/><select name="status" aria-label="Yeni sipariş durumu">{o.status==='pending' ? <option value="confirmed">Onaylandı</option> : <option value="shipped">Sevk edildi</option>}<option value="cancelled">İptal edildi</option></select><button>Durumu güncelle</button></form>}</article>)}{!orders.length && <p className="muted">Henüz sipariş yok.</p>}<div className="commerce-nav">{page>1 && <Link href={`?page=${page-1}`}>← Önceki</Link>}{orders.length>50 && <Link href={`?page=${page+1}`}>Sonraki →</Link>}</div></section>;
}
