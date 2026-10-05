import { currentOrder } from "@/modules/store/order-read";
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { money } from '@/modules/store/catalog';
import { orderStatus } from '@/modules/store/orders';
export default async function Order({params}:{params:Promise<{id:string}>}) {
 const {id}=await params;
 const result=await currentOrder(id);
 if(!result) notFound();
 const {order,items}=result;
 return <section className="shell page-section"><p className="eyebrow">SİPARİŞ #{order.number}</p><h1 className="page-title">{orderStatus[order.status]}</h1><p className="notice" role="status">{order.status === "pending" ? "Sipariş kaydın oluşturuldu. Stok ve sevkiyat teyidi için iletişime geçilecektir." : `Sipariş durumu: ${orderStatus[order.status]}.`} Ödeme alınmadı.</p><p className="muted">{new Date(order.created_at).toLocaleString('tr-TR',{timeZone:'Europe/Istanbul'})} · %{order.discount_percent} servis indirimi</p><div className="content-columns"><article className="panel"><h2>Sipariş ürünleri</h2>{items.map(p=><div key={p.product_id} className="commerce-line"><div><strong>{p.name}</strong><p className="muted">{p.code} · {p.quantity} adet × {money(Number(p.unit_price_kurus))}</p></div><strong>{money(Number(p.unit_price_kurus)*p.quantity)}</strong></div>)}<h3>Ürün toplamı: {money(Number(order.total_kurus))}</h3><p className="muted">KDV dahil. Sevkiyat bedeli teyit aşamasında belirlenir.</p></article><article className="panel"><h2>Teslimat bilgileri</h2><p>{order.customer_name}</p><p>{order.email} · {order.phone}</p><p className="commerce-address">{order.address}</p>{order.note && <p>Not: {order.note}</p>}</article></div><Link className="button" href="/katalog">Kataloğa dön →</Link></section>;
}
