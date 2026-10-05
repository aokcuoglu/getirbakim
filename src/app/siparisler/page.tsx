import { currentOrders } from "@/modules/store/order-read";
import Link from 'next/link';
import { money } from '@/modules/store/catalog';
import { orderStatus } from '@/modules/store/orders';
export default async function Orders() {
 const orders=await currentOrders();
 return <section className="shell page-section"><h1 className="page-title">Siparişlerim</h1>{orders.length ? orders.map(o=><article className="panel" key={o.id}><Link href={`/siparis/${o.id}`}><h2>Sipariş #{o.number}</h2></Link><p>{orderStatus[o.status]} · {money(Number(o.total_kurus))}</p><small>{new Date(o.created_at).toLocaleString('tr-TR',{timeZone:'Europe/Istanbul'})}</small></article>) : <p className="muted">Bu oturumda henüz sipariş bulunmuyor.</p>}</section>;
}
