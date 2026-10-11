import Link from "next/link";
import { ChevronLeft, ChevronRight, CircleAlert, CircleCheck, Inbox } from "lucide-react";
import { adminOrders, fitmentReturnReport, orderFilters, type OrderFilter } from "@/modules/admin/data";
import { fitmentLevelLabels, type FitmentLevel } from "@/modules/store/fitment-level";
import { normalizeSearchParams, type SearchParams } from "@/lib/search-params";
import { requireAdmin } from "@/modules/auth/session";
import { money } from "@/modules/store/catalog";
import { changeOrderStatus, recordRefund } from "@/modules/admin/commerce-actions";
import { OrderStatusBadge, PaymentStatusBadge } from "@/components/admin/order-badges";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Pagination, PaginationContent, PaginationItem } from "@/components/ui/pagination";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

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
  return <div className="flex flex-col gap-6">
    <div className="flex flex-col gap-2">
      <Breadcrumb><BreadcrumbList>
        <BreadcrumbItem><BreadcrumbLink render={<Link href="/yonetim"/>}>Yönetim</BreadcrumbLink></BreadcrumbItem>
        <BreadcrumbSeparator/>
        <BreadcrumbItem><BreadcrumbPage>Siparişler</BreadcrumbPage></BreadcrumbItem>
      </BreadcrumbList></Breadcrumb>
      <h1 className="text-2xl font-semibold tracking-tight">Siparişler</h1>
      <p className="max-w-3xl text-muted-foreground">Ödemesi alınmış siparişlerde tedarikçi stokunu ve teslim süresini teyit ettikten sonra onayla. Stok yoksa iptal et; ödeme iadesini TAMI portalından yapıp referansı kaydet. Ödenmemiş siparişler süresi dolunca kendiliğinden iptal olur.</p>
    </div>
    {params.saved && <Alert variant="success" role="status"><CircleCheck/><AlertDescription>Sipariş güncellendi.</AlertDescription></Alert>}
    {params.error && <Alert variant="destructive"><CircleAlert/><AlertDescription>Bu değişikliğe izin verilmiyor. Listeyi yenileyin.</AlertDescription></Alert>}

    <Tabs value={filter}><ScrollArea className="pb-2">
      <TabsList variant="line" aria-label="Sipariş durumları">
        {tabOrder.map(key => <TabsTrigger key={key} value={key} nativeButton={false} render={<Link href={href({ status: key })} scroll={false}/>}>
          {orderFilters[key].label}<Badge variant="secondary" className="tabular-nums">{new Intl.NumberFormat("tr-TR").format(counts[key])}</Badge>
        </TabsTrigger>)}
      </TabsList>
      <ScrollBar orientation="horizontal"/>
    </ScrollArea></Tabs>

    <Card>
      <CardContent>
        {shown.length ? <Table>
          <TableHeader><TableRow><TableHead>Sipariş</TableHead><TableHead>Müşteri</TableHead><TableHead>Durum</TableHead><TableHead>Ödeme</TableHead><TableHead className="text-right">Tutar</TableHead><TableHead className="text-right">İşlem</TableHead></TableRow></TableHeader>
          <TableBody>{shown.map(o => <TableRow key={o.id} className="align-top">
            <TableCell><Link className="font-medium underline-offset-4 hover:underline" href={`/siparis/${o.id}`}>#{o.number}</Link><div className="text-muted-foreground">{time(o.created_at)}</div></TableCell>
            <TableCell className="min-w-56 whitespace-normal">
              <div className="font-medium">{o.customer_name}</div><div className="text-muted-foreground">{o.email} · {o.phone}</div>
              <Accordion><AccordionItem value="details">
                <AccordionTrigger>Teslimat ve ödeme</AccordionTrigger>
                <AccordionContent>
                  <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                    <div><dt className="text-muted-foreground">Adres</dt><dd>{o.address}</dd></div>
                    {o.note && <div><dt className="text-muted-foreground">Not</dt><dd>{o.note}</dd></div>}
                    {o.payments.length > 0 && <div><dt className="text-muted-foreground">TAMI</dt><dd className="break-all">{o.payments.map(p => `${p.provider_order_id} (${p.status}${p.bank_reference ? ` · banka ref. ${p.bank_reference}` : ""})`).join(", ")}</dd></div>}
                    {o.paid_at && <div><dt className="text-muted-foreground">Ödeme zamanı</dt><dd>{time(o.paid_at)}</dd></div>}
                    {o.refund_reference && <div><dt className="text-muted-foreground">İade referansı</dt><dd>{o.refund_reference}</dd></div>}
                  </dl>
                </AccordionContent>
              </AccordionItem></Accordion>
              {o.payment_note && <p className="mt-1 text-destructive">{o.payment_note}</p>}
            </TableCell>
            <TableCell><OrderStatusBadge status={o.status}/></TableCell>
            <TableCell><PaymentStatusBadge status={o.payment_status}/></TableCell>
            <TableCell className="text-right"><div className="font-medium tabular-nums">{money(Number(o.total_kurus))}</div>{Number(o.shipping_kurus) > 0 && <div className="text-muted-foreground tabular-nums">Kargo {money(Number(o.shipping_kurus))} dahil</div>}</TableCell>
            <TableCell>
              {["pending", "confirmed"].includes(o.status) && ["paid", "none"].includes(o.payment_status) && <form action={changeOrderStatus} className="flex justify-end gap-2">
                <input type="hidden" name="id" value={o.id}/>
                <NativeSelect name="status" aria-label={`#${o.number} yeni durum`}>{o.status === "pending" ? <NativeSelectOption value="confirmed">Onayla</NativeSelectOption> : <NativeSelectOption value="shipped">Sevk edildi</NativeSelectOption>}<NativeSelectOption value="cancelled">{o.payment_status === "paid" ? "İptal et (iade gerekecek)" : "İptal et"}</NativeSelectOption></NativeSelect>
                <Button type="submit">Uygula</Button>
              </form>}
              {o.payment_status === "refund_required" && <form action={recordRefund} className="flex justify-end gap-2">
                <input type="hidden" name="id" value={o.id}/>
                <Input className="w-40" name="reference" aria-label={`#${o.number} TAMI iade referansı`} placeholder="TAMI iade ref." minLength={3} maxLength={120} required/>
                <Button type="submit">İade yapıldı</Button>
              </form>}
            </TableCell>
          </TableRow>)}</TableBody>
        </Table> : <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon"><Inbox/></EmptyMedia>
            <EmptyTitle>{filter === "all" ? "Henüz sipariş yok" : "Bu durumda sipariş yok"}</EmptyTitle>
            {filter !== "all" && <EmptyDescription>Başka bir durum sekmesi seçebilir veya tüm siparişlere dönebilirsin.</EmptyDescription>}
          </EmptyHeader>
          {filter !== "all" && <EmptyContent><Button variant="outline" nativeButton={false} render={<Link href={href({ status: "all" })}/>}>Tüm siparişleri göster</Button></EmptyContent>}
        </Empty>}
      </CardContent>
      {(page > 1 || orders.length > 50) && <CardFooter className="justify-between gap-4">
        <span className="text-muted-foreground">Sayfa {page}</span>
        <Pagination className="mx-0 w-auto"><PaginationContent>
          <PaginationItem>{page > 1 ? <Button variant="ghost" aria-label="Önceki sayfa" nativeButton={false} render={<Link href={href({ page: page - 1 })} scroll={false}/>}><ChevronLeft data-icon="inline-start"/>Önceki</Button> : <Button variant="ghost" disabled><ChevronLeft data-icon="inline-start"/>Önceki</Button>}</PaginationItem>
          <PaginationItem>{orders.length > 50 ? <Button variant="ghost" aria-label="Sonraki sayfa" nativeButton={false} render={<Link href={href({ page: page + 1 })} scroll={false}/>}>Sonraki<ChevronRight data-icon="inline-end"/></Button> : <Button variant="ghost" disabled>Sonraki<ChevronRight data-icon="inline-end"/></Button>}</PaginationItem>
        </PaginationContent></Pagination>
      </CardFooter>}
    </Card>

    {fitment.length > 0 && <Card>
      <CardHeader>
        <CardTitle>Uyumluluk ve iadeler</CardTitle>
        <CardDescription>İptal edilmemiş siparişlerin satırları, sipariş anındaki uyumluluk durumuna göre. İadeler sevk edilen siparişin sayfasından kaydedilir.</CardDescription>
      </CardHeader>
      <CardContent>
        <Table><TableHeader><TableRow><TableHead>Uyumluluk</TableHead><TableHead className="text-right">Satır</TableHead><TableHead className="text-right">İade edilen</TableHead><TableHead className="text-right">“Aracıma uymadı”</TableHead></TableRow></TableHeader>
          <TableBody>{fitment.map(row => <TableRow key={row.level}><TableCell>{row.level === "unrecorded" ? "Kayıt yok (eski sipariş)" : fitmentLevelLabels[row.level as FitmentLevel] ?? row.level}</TableCell><TableCell className="text-right tabular-nums">{row.lines}</TableCell><TableCell className="text-right tabular-nums">{row.returned}</TableCell><TableCell className="text-right tabular-nums">{row.not_fit}</TableCell></TableRow>)}</TableBody></Table>
      </CardContent>
    </Card>}
  </div>;
}
