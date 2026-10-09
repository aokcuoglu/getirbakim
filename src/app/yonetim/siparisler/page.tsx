import { adminOrders } from "@/modules/admin/data";
import { normalizeSearchParams, type SearchParams } from "@/lib/search-params";
import Link from 'next/link';
import { requireAdmin } from '@/modules/auth/session';
import { money } from '@/modules/store/catalog';
import { orderStatus, paymentStatus } from '@/modules/store/orders';
import { changeOrderStatus, recordRefund } from '@/modules/admin/commerce-actions';
const time=(value:Date|string)=>new Date(value).toLocaleString('tr-TR',{timeZone:'Europe/Istanbul'});
export default async function Orders({searchParams}:{searchParams:Promise<SearchParams>}) {
 await requireAdmin();const params=normalizeSearchParams(await searchParams);
 const {orders,page}=await adminOrders(params.page);
 return <section className="shell page-section"><p className="eyebrow">OPERASYON</p><h1 className="page-title">Sipariş yönetimi</h1><p className="muted">Ödemesi alınmış siparişlerde tedarikçi stokunu ve teslimat süresini teyit ettikten sonra onaylayın. Stok yoksa iptal edin; ödeme iadesini TAMI portalından yapıp iade referansını kaydedin. Ödenmemiş siparişler süresi dolunca kendiliğinden iptal olur.</p>{params.saved && <p className="notice" role="status">Sipariş güncellendi.</p>}{params.error && <p className="error" role="alert">Bu değişikliğe izin verilmiyor. Listeyi yenileyin.</p>}
  {orders.slice(0,50).map(o=><article key={o.id} className="panel"><div className="commerce-line"><div><Link href={`/siparis/${o.id}`}><h2>Sipariş #{o.number} · {o.customer_name}</h2></Link><p>{o.email} · {o.phone}</p><p className="commerce-address">{o.address}</p>{o.note && <p>{o.note}</p>}<small>{time(o.created_at)}</small>
   {o.payments.length>0 && <p className="muted">TAMI: {o.payments.map(p=>`${p.provider_order_id} (${p.status}${p.bank_reference ? ` · banka ref. ${p.bank_reference}` : ''})`).join(', ')}</p>}
   {o.payment_note && <p className="error">{o.payment_note}</p>}{o.refund_reference && <p className="muted">İade referansı: {o.refund_reference}</p>}</div>
   <div><strong>{money(Number(o.total_kurus))}</strong>{Number(o.shipping_kurus)>0 && <p className="muted">Kargo {money(Number(o.shipping_kurus))} dahil</p>}<p>{orderStatus[o.status]}</p><p>{paymentStatus[o.payment_status]}{o.paid_at ? ` · ${time(o.paid_at)}` : ''}</p></div></div>
   {['pending','confirmed'].includes(o.status) && ['paid','none'].includes(o.payment_status) && <form action={changeOrderStatus} className="inline-form"><input type="hidden" name="id" value={o.id}/><select name="status" aria-label="Yeni sipariş durumu">{o.status==='pending' ? <option value="confirmed">Onaylandı</option> : <option value="shipped">Sevk edildi</option>}<option value="cancelled">{o.payment_status==='paid' ? 'İptal edildi (iade gerekecek)' : 'İptal edildi'}</option></select><button>Durumu güncelle</button></form>}
   {o.payment_status==='refund_required' && <form action={recordRefund} className="inline-form"><input type="hidden" name="id" value={o.id}/><input name="reference" aria-label="TAMI iade referansı" placeholder="TAMI iade referansı" minLength={3} maxLength={120} required/><button>İade yapıldı olarak işaretle</button></form>}
  </article>)}{!orders.length && <p className="muted">Henüz sipariş yok.</p>}<div className="commerce-nav">{page>1 && <Link href={`?page=${page-1}`}>← Önceki</Link>}{orders.length>50 && <Link href={`?page=${page+1}`}>Sonraki →</Link>}</div></section>;
}
