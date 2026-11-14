import Link from "next/link";
import { ArrowRight, ArrowUpRight, CheckCircle2, CircleAlert } from "lucide-react";
import { adminPricing } from "@/modules/admin/data";
import { saveCheckoutMode } from "@/modules/admin/commerce-actions";
import { supplierCheckoutMode } from "@/modules/store/supplier-checkout-policy";
import { normalizeSearchParams, type SearchParams } from "@/lib/search-params";
import { requireAdmin } from "@/modules/auth/session";
import { PricingWorkspace } from "@/components/admin/pricing-workspace";
import { SubmitButton } from "@/components/admin/submit-button";
import { formatDecimal } from "@/modules/admin/format";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const currencyNames: Record<string, string> = {
  TRY: "Türk lirası", CHF: "İsviçre frangı", CNY: "Çin yuanı", EUR: "Euro",
  GBP: "İngiliz sterlini", JPY: "Japon yeni", RUB: "Rus rublesi", USD: "ABD doları",
};

export default async function Pricing({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireAdmin();
  const params = normalizeSearchParams(await searchParams);
  const [{ settings, latest, rates }, checkoutMode] = await Promise.all([adminPricing(), supplierCheckoutMode()]);
  const currencies = [{ dovizCinsi: "TRY", satis: "1" }, ...rates.filter(r => r.dovizCinsi !== "TRY")];
  const updated = latest ? new Date(latest.completed_at) : null;

  return <div className="flex min-w-0 flex-col gap-6">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex min-w-0 max-w-3xl flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Fiyatlandırma ve kargo</h1>
        <p className="text-muted-foreground">Satış fiyatını ve siparişlerin kargo koşullarını belirleyin.</p>
      </div>
      <Button variant="outline" nativeButton={false} render={<Link href="/yonetim/servisler"/>}>Servis indirimleri<ArrowUpRight data-icon="inline-end" aria-hidden="true"/></Button>
    </div>

    {params.saved && <Alert variant="success" role="status"><CheckCircle2 aria-hidden="true"/><AlertTitle>Ayarlar kaydedildi</AlertTitle><AlertDescription>Katalog ve sepetler yeni oranları kullanıyor.</AlertDescription></Alert>}
    {params.modeSaved === "1" && <Alert variant="success" role="status"><CheckCircle2 aria-hidden="true"/><AlertTitle>Sipariş veri kaynağı kaydedildi</AlertTitle><AlertDescription>Sepet ve siparişler yeni ayarı kullanıyor.</AlertDescription></Alert>}
    {params.error === "mode" && <Alert variant="destructive" role="alert"><CircleAlert aria-hidden="true"/><AlertTitle>Sipariş veri kaynağı kaydedilemedi</AlertTitle><AlertDescription>Listeden bir seçenek seçip yeniden deneyin.</AlertDescription></Alert>}
    {params.error && params.error !== "mode" && <Alert variant="destructive" role="alert"><CircleAlert aria-hidden="true"/><AlertTitle>Ayarlar kaydedilemedi</AlertTitle><AlertDescription>Kâr, KDV, veri geçerliliği ve kargo alanlarının izin verilen aralıklarda olduğunu kontrol edin.</AlertDescription></Alert>}

    <PricingWorkspace key={JSON.stringify(settings)} settings={settings} currencies={currencies}>
      <div className="flex flex-col gap-4">
          <p className="text-muted-foreground">Başbuğ API · 1 birimin TL karşılığı</p>
          <ScrollArea className="h-64" aria-label="Başbuğ döviz satış kurları">
            <Table controls={false}>
              <TableHeader><TableRow><TableHead>Para birimi</TableHead><TableHead className="text-right">Satış kuru</TableHead></TableRow></TableHeader>
              <TableBody>{currencies.map(r => <TableRow key={r.dovizCinsi}>
                <TableCell><Badge variant="outline">{r.dovizCinsi}</Badge><span className="ml-2 text-xs text-muted-foreground">{currencyNames[r.dovizCinsi]}</span></TableCell>
                <TableCell className="text-right tabular-nums" title={r.satis}>{formatDecimal(Number(r.satis), 4)}</TableCell>
              </TableRow>)}</TableBody>
            </Table>
          </ScrollArea>
          {updated ? <p className="text-xs text-muted-foreground">Son çekim: <time dateTime={updated.toISOString()}>{updated.toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", dateStyle: "short", timeStyle: "short" })}</time></p>
            : <Empty><EmptyHeader><EmptyTitle>Henüz kur kaydı yok</EmptyTitle><EmptyDescription>Dövizli fiyat önizlemesi için başarılı bir Başbuğ senkronizasyonu gerekir.</EmptyDescription></EmptyHeader></Empty>}
          <Button className="self-start" variant="link" nativeButton={false} render={<Link href="/yonetim/tedarikciler/basbug"/>}>Senkronizasyon durumu<ArrowUpRight data-icon="inline-end" aria-hidden="true"/></Button>
      </div>
    </PricingWorkspace>

    {/* Shared by every supplier (Başbuğ, Dinamik, SETA): the supplier pages' "Sipariş veri kaynağı" card links here. */}
    <Card id="siparis-veri-kaynagi" role="region" aria-labelledby="checkout-mode-title">
      <CardHeader>
        <CardTitle><h2 id="checkout-mode-title">Sipariş veri kaynağı</h2></CardTitle>
        <CardDescription>Tüm tedarikçilerde sepet ve siparişte fiyat ile stoğun nereden okunacağı.</CardDescription>
        <CardAction className="flex flex-wrap gap-1">
          <Button variant="link" nativeButton={false} render={<Link href="/sepet"/>}>Sepet<ArrowRight data-icon="inline-end" aria-hidden="true"/></Button>
          <Button variant="link" nativeButton={false} render={<Link href="/yonetim/siparisler"/>}>Siparişler<ArrowRight data-icon="inline-end" aria-hidden="true"/></Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <form action={saveCheckoutMode}><Field>
          <FieldLabel htmlFor="checkout-mode">Veri kaynağı</FieldLabel>
          <div className="flex flex-wrap gap-2"><NativeSelect id="checkout-mode" name="checkoutMode" defaultValue={checkoutMode}><NativeSelectOption value="snapshot">Kayıtlı veriler · Bakım süresince</NativeSelectOption><NativeSelectOption value="live">Canlı API doğrulaması</NativeSelectOption></NativeSelect><SubmitButton>Kaydet</SubmitButton></div>
          <FieldDescription>{checkoutMode === "snapshot" ? "Siparişte API çağrılmaz; kayıtlar teyit bekler." : "Siparişte fiyat ve stok API’den doğrulanır; güncellik süresini aşan ürünlerin fiyatı satışta gizlenir."}</FieldDescription>
        </Field></form>
      </CardContent>
    </Card>
  </div>;
}
