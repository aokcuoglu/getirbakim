import Link from "next/link";
import { adminPricing } from "@/modules/admin/data";
import { normalizeSearchParams, type SearchParams } from "@/lib/search-params";
import { requireAdmin } from "@/modules/auth/session";
import { savePricing, saveShipping } from "@/modules/admin/commerce-actions";
import { AdminColumns, AdminPage, AdminPageHeader, AdminPanel, AffixInput, SettingRow, StatusMessage } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const tl = (value: number) => value.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// Source rates carry up to 10 decimals; four are enough to read, the title keeps the source value.
const rate = (value: string) => Number(value).toLocaleString("tr-TR", { minimumFractionDigits: 4, maximumFractionDigits: 4 });

export default async function Pricing({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireAdmin();
  const params = normalizeSearchParams(await searchParams);
  const { settings, latest, rates } = await adminPricing();
  const markup = Number(settings.markup_percent), vat = Number(settings.vat_percent);
  const example = 100 * (1 + markup / 100) * (1 + vat / 100);
  return <AdminPage>
    <AdminPageHeader breadcrumbs={[{ label: "Yönetim", href: "/yonetim" }, { label: "Fiyatlandırma" }]} title="Fiyatlandırma ve kargo"
      description="Başbuğ NF tutarı KDV hariç maliyettir. Kâr oranı maliyet üzerine eklenir; tüm satış fiyatları TRY gösterilir."/>
    {params.saved && <StatusMessage>Ayarlar kaydedildi. Katalog ve sepetler yeni oranları kullanıyor.</StatusMessage>}
    {params.error && <StatusMessage tone="error">Oranları ve veri geçerlilik süresini kontrol edin.</StatusMessage>}

    <AdminColumns wide>
      <div className="flex min-w-0 flex-col gap-4">
        <form action={savePricing}>
          <AdminPanel title="Satış kuralları" description="Satış fiyatı her ürün için bu oranlarla hesaplanır." flush
            footer={<><span>Örnek: 100,00 TL maliyet → <strong className="font-semibold text-foreground tabular-nums">{tl(example)} TL</strong> KDV dahil satış</span><Button type="submit">Kuralları kaydet</Button></>}>
            <SettingRow title={<label htmlFor="markup">Maliyet üzerine kâr</label>} description="NF × kur üzerine eklenir. Servis indirimi bu fiyat üzerinden uygulanır ve kârı azaltır.">
              <AffixInput suffix="%" id="markup" name="markup" type="number" step="0.01" min={0} max={1000} defaultValue={settings.markup_percent} required/>
            </SettingRow>
            <SettingRow title={<label htmlFor="vat">KDV</label>} description="Satış fiyatına eklenen vergi oranı.">
              <AffixInput suffix="%" id="vat" name="vat" type="number" step="0.01" min={0} max={100} defaultValue={settings.vat_percent} required/>
            </SettingRow>
            <SettingRow title={<label htmlFor="age">Veri geçerliliği</label>} description="Kur ve tedarikçi verisinin canlı doğrulama modunda geçerli sayıldığı süre.">
              <AffixInput suffix="saat" id="age" name="age" type="number" min={1} max={168} defaultValue={settings.max_age_hours} required/>
            </SettingRow>
          </AdminPanel>
        </form>
        <form action={saveShipping}>
          <AdminPanel title="Kargo" description="Ödeme sipariş anında alındığı için kargo ücreti toplam tutara eklenir." flush
            footer={<><span>Şu an: {settings.shipping_fee_kurus ? `${tl(settings.shipping_fee_kurus / 100)} TL` : "ücretsiz"}{settings.free_shipping_threshold_kurus ? ` · ${tl(settings.free_shipping_threshold_kurus / 100)} TL üzeri ücretsiz` : ""}</span><Button type="submit">Kargo ayarlarını kaydet</Button></>}>
            <SettingRow title={<label htmlFor="fee">Kargo ücreti</label>} description="KDV dahil. 0 girilirse tüm siparişlerde kargo ücretsizdir.">
              <AffixInput suffix="TL" id="fee" name="fee" type="number" step="0.01" min={0} max={100000} defaultValue={(settings.shipping_fee_kurus / 100).toFixed(2)} required/>
            </SettingRow>
            <SettingRow title={<label htmlFor="threshold">Ücretsiz kargo eşiği</label>} description="Servis indirimi uygulanmış ürün toplamı bu tutara ulaşırsa kargo ücretsizdir. 0 = eşik yok.">
              <AffixInput suffix="TL" id="threshold" name="threshold" type="number" step="0.01" min={0} max={10000000} defaultValue={(settings.free_shipping_threshold_kurus / 100).toFixed(2)} required/>
            </SettingRow>
          </AdminPanel>
        </form>
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        <AdminPanel title="Fiyat formülü">
          <pre className="overflow-x-auto rounded-lg border bg-muted/50 p-3 font-mono text-xs leading-5">Satış = NF × döviz satış kuru{"\n"}× (1 + kâr / 100){"\n"}× (1 + KDV / 100)</pre>
          <p className="mt-3 text-sm text-muted-foreground">Servis indirimi bu fiyat üzerinden uygulanır. <Link className="font-medium text-primary hover:underline" href="/yonetim/servisler">Servis indirimleri →</Link></p>
        </AdminPanel>
        <AdminPanel title="Döviz satış kurları" description={`Başbuğ API · Son çekim: ${latest ? new Date(latest.completed_at).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" }) : "kayıt yok"}`} flush
          footer={<Link className="font-medium text-primary hover:underline" href="/yonetim/tedarikciler/basbug">Senkronizasyon durumu →</Link>}>
          <Table><TableHeader><TableRow><TableHead className="pl-4">Para birimi</TableHead><TableHead className="pr-4 text-right">TRY karşılığı</TableHead></TableRow></TableHeader><TableBody>
            <TableRow><TableCell className="pl-4 font-medium">TRY</TableCell><TableCell className="pr-4 text-right tabular-nums">1,0000</TableCell></TableRow>
            {rates.map(r => <TableRow key={r.dovizCinsi}><TableCell className="pl-4 font-medium">{r.dovizCinsi}</TableCell><TableCell className="pr-4 text-right tabular-nums" title={r.satis}>{rate(r.satis)}</TableCell></TableRow>)}
          </TableBody></Table>
        </AdminPanel>
        <p className="text-xs text-muted-foreground">Canlı doğrulama modunda süresi geçen kur veya ürün verisi satışa kapatılır. Kayıtlı veri modunda son fiyat, stok ve kur kullanılır; sipariş fiyat ve stok teyidi bekler.</p>
      </div>
    </AdminColumns>
  </AdminPage>;
}
