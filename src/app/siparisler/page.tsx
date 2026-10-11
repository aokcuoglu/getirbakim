import { currentOrders } from "@/modules/store/order-read";
import Link from 'next/link';
import { money } from '@/modules/store/catalog';
import { orderStatus, paymentStatus } from '@/modules/store/orders';
import { Card } from '@/components/ui/card';
export default async function Orders() {
   const orders = await currentOrders();
   return <section className="mx-auto min-h-[55vh] w-full max-w-[1280px] px-8 pt-7 pb-14 max-[600px]:px-5 max-[600px]:pt-6 max-[600px]:pb-10"><h1 className="mb-5 text-[32px] leading-[42px] font-semibold tracking-[-0.7px] wrap-anywhere max-[600px]:text-[27px] max-[600px]:leading-[35px]">Siparişlerim</h1>
      {orders.length ? <div className="grid gap-3">{orders.map(o => <Card className="gap-0 rounded-2xl border border-border bg-white p-[25px] ring-0 max-[600px]:p-5" key={o.id}><Link href={`/siparis/${o.id}`} className="w-fit hover:text-primary"><h2 className="text-[23px] leading-[34px] font-semibold">Sipariş #{o.number}</h2></Link><p className="text-[13px] leading-[1.7]">{orderStatus[o.status]} · {money(Number(o.total_kurus))}{o.payment_status !== 'none' && ` · ${paymentStatus[o.payment_status]}`}</p><small className="text-xs">{new Date(o.created_at).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })}</small></Card>)}</div>
         : <p className="text-sm leading-[22px] text-muted-foreground">Bu oturumda henüz sipariş bulunmuyor.</p>}</section>;
}
