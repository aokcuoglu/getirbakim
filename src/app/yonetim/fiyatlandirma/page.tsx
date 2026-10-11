import Link from "next/link";
import { ArrowUpRight, CheckCircle2, CircleAlert } from "lucide-react";
import { adminPricing } from "@/modules/admin/data";
import { normalizeSearchParams, type SearchParams } from "@/lib/search-params";
import { requireAdmin } from "@/modules/auth/session";
import { PricingWorkspace } from "@/components/admin/pricing-workspace";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const number = (value: number, digits = 2) => value.toLocaleString("tr-TR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const currencyNames: Record<string, string> = {
  TRY: "Türk lirası", CHF: "İsviçre frangı", CNY: "Çin yuanı", EUR: "Euro",
  GBP: "İngiliz sterlini", JPY: "Japon yeni", RUB: "Rus rublesi", USD: "ABD doları",
};

export default async function Pricing({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireAdmin();
  const params = normalizeSearchParams(await searchParams);
  const { settings, latest, rates } = await adminPricing();
  const currencies = [{ dovizCinsi: "TRY", satis: "1" }, ...rates.filter(r => r.dovizCinsi !== "TRY")];
  const updated = latest ? new Date(latest.completed_at) : null;

  return <div className="flex min-w-0 flex-col gap-6">
    <header className="flex flex-col gap-2">
      <Breadcrumb><BreadcrumbList>
        <BreadcrumbItem><BreadcrumbLink render={<Link href="/yonetim"/>}>Yönetim</BreadcrumbLink></BreadcrumbItem>
        <BreadcrumbSeparator/>
        <BreadcrumbItem><BreadcrumbPage>Fiyatlandırma</BreadcrumbPage></BreadcrumbItem>
      </BreadcrumbList></Breadcrumb>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Fiyatlandırma ve kargo</h1>
          <p className="text-muted-foreground">Satış fiyatını ve siparişlerin kargo koşullarını belirleyin.</p>
        </div>
        <Button variant="outline" nativeButton={false} render={<Link href="/yonetim/servisler"/>}>Servis indirimleri<ArrowUpRight data-icon="inline-end" aria-hidden="true"/></Button>
      </div>
    </header>

    {params.saved && <Alert role="status"><CheckCircle2 aria-hidden="true"/><AlertTitle>Ayarlar kaydedildi</AlertTitle><AlertDescription>Katalog ve sepetler yeni oranları kullanıyor.</AlertDescription></Alert>}
    {params.error && <Alert variant="destructive"><CircleAlert aria-hidden="true"/><AlertTitle>Ayarlar kaydedilemedi</AlertTitle><AlertDescription>Kâr, KDV, veri geçerliliği ve kargo alanlarının izin verilen aralıklarda olduğunu kontrol edin.</AlertDescription></Alert>}

    <PricingWorkspace key={JSON.stringify(settings)} settings={settings} currencies={currencies}>
      <div className="flex flex-col gap-4">
          <p className="text-muted-foreground">Başbuğ API · 1 birimin TL karşılığı</p>
          <ScrollArea className="h-64" aria-label="Başbuğ döviz satış kurları">
            <Table>
              <TableHeader><TableRow><TableHead>Para birimi</TableHead><TableHead className="text-right">Satış kuru</TableHead></TableRow></TableHeader>
              <TableBody>{currencies.map(r => <TableRow key={r.dovizCinsi}>
                <TableCell><Badge variant="outline">{r.dovizCinsi}</Badge><span className="ml-2 text-xs text-muted-foreground">{currencyNames[r.dovizCinsi]}</span></TableCell>
                <TableCell className="text-right tabular-nums" title={r.satis}>{number(Number(r.satis), 4)}</TableCell>
              </TableRow>)}</TableBody>
            </Table>
          </ScrollArea>
          {updated ? <p className="text-xs text-muted-foreground">Son çekim: <time dateTime={updated.toISOString()}>{updated.toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", dateStyle: "short", timeStyle: "short" })}</time></p>
            : <Empty><EmptyHeader><EmptyTitle>Henüz kur kaydı yok</EmptyTitle><EmptyDescription>Dövizli fiyat önizlemesi için başarılı bir Başbuğ senkronizasyonu gerekir.</EmptyDescription></EmptyHeader></Empty>}
          <Button className="self-start" variant="link" nativeButton={false} render={<Link href="/yonetim/tedarikciler/basbug"/>}>Senkronizasyon durumu<ArrowUpRight data-icon="inline-end" aria-hidden="true"/></Button>
      </div>
    </PricingWorkspace>
  </div>;
}
