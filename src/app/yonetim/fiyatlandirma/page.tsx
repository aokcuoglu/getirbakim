import Link from "next/link";
import { adminPricing } from "@/modules/admin/data";
import { normalizeSearchParams, type SearchParams } from "@/lib/search-params";
import { requireAdmin } from "@/modules/auth/session";
import { savePricing, saveShipping } from "@/modules/admin/commerce-actions";
import { AdminPage, AdminPageHeader, AdminPanel, AffixInput, SettingRow, StatusMessage, TableRegion } from "@/components/admin/ui";

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

    <div className="admin-grid-main">
      <div className="admin-stack">
        <AdminPanel title="Satış kuralları" description="Satış fiyatı her ürün için bu oranlarla hesaplanır." flush>
          <form action={savePricing}>
            <div className="admin-settings">
              <SettingRow title="Maliyet üzerine kâr" description="NF × kur üzerine eklenir. Servis indirimi bu fiyat üzerinden uygulanır ve kârı azaltır.">
                <AffixInput suffix="%" aria-label="Maliyet üzerine kâr (%)" name="markup" type="number" step="0.01" min={0} max={1000} defaultValue={settings.markup_percent} required/>
              </SettingRow>
              <SettingRow title="KDV" description="Satış fiyatına eklenen vergi oranı.">
                <AffixInput suffix="%" aria-label="KDV (%)" name="vat" type="number" step="0.01" min={0} max={100} defaultValue={settings.vat_percent} required/>
              </SettingRow>
              <SettingRow title="Veri geçerliliği" description="Kur ve tedarikçi verisinin canlı doğrulama modunda geçerli sayıldığı süre.">
                <AffixInput suffix="saat" aria-label="Kur ve tedarikçi verisi geçerliliği (saat)" name="age" type="number" min={1} max={168} defaultValue={settings.max_age_hours} required/>
              </SettingRow>
            </div>
            <footer className="admin-panel-footer"><span>Örnek: 100,00 TL maliyet → <strong style={{ color: "var(--a-text)" }}>{tl(example)} TL</strong> KDV dahil satış</span><button>Kuralları kaydet</button></footer>
          </form>
        </AdminPanel>

        <AdminPanel title="Kargo" description="Ödeme sipariş anında alındığı için kargo ücreti toplam tutara eklenir." flush>
          <form action={saveShipping}>
            <div className="admin-settings">
              <SettingRow title="Kargo ücreti" description="KDV dahil. 0 girilirse tüm siparişlerde kargo ücretsizdir.">
                <AffixInput suffix="TL" aria-label="Kargo ücreti (TL, KDV dahil)" name="fee" type="number" step="0.01" min={0} max={100000} defaultValue={(settings.shipping_fee_kurus / 100).toFixed(2)} required/>
              </SettingRow>
              <SettingRow title="Ücretsiz kargo eşiği" description="Servis indirimi uygulanmış ürün toplamı bu tutara ulaşırsa kargo ücretsizdir. 0 = eşik yok.">
                <AffixInput suffix="TL" aria-label="Ücretsiz kargo eşiği (TL, 0 = eşik yok)" name="threshold" type="number" step="0.01" min={0} max={10000000} defaultValue={(settings.free_shipping_threshold_kurus / 100).toFixed(2)} required/>
              </SettingRow>
            </div>
            <footer className="admin-panel-footer"><span>Şu an: {settings.shipping_fee_kurus ? `${tl(settings.shipping_fee_kurus / 100)} TL` : "ücretsiz"}{settings.free_shipping_threshold_kurus ? ` · ${tl(settings.free_shipping_threshold_kurus / 100)} TL üzeri ücretsiz` : ""}</span><button>Kargo ayarlarını kaydet</button></footer>
          </form>
        </AdminPanel>
      </div>

      <div className="admin-stack">
        <AdminPanel title="Fiyat formülü">
          <p className="admin-formula">Satış = NF × döviz satış kuru<br/>× (1 + kâr / 100)<br/>× (1 + KDV / 100)</p>
          <p className="admin-hint" style={{ marginTop: 10 }}>Servis indirimi bu fiyat üzerinden uygulanır. <Link className="admin-link" href="/yonetim/servisler">Servis indirimleri →</Link></p>
        </AdminPanel>
        <AdminPanel title="Döviz satış kurları" description={`Başbuğ API · Son çekim: ${latest ? new Date(latest.completed_at).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" }) : "kayıt yok"}`}
          footer={<Link className="admin-link" href="/yonetim/tedarikciler/basbug">Senkronizasyon durumu →</Link>}>
          <TableRegion label="Döviz satış kurları"><table className="admin-table"><thead><tr><th>Para birimi</th><th className="num">TRY karşılığı</th></tr></thead><tbody>
            <tr><td><strong>TRY</strong></td><td className="num">1,0000</td></tr>
            {rates.map(r => <tr key={r.dovizCinsi}><td><strong>{r.dovizCinsi}</strong></td><td className="num" title={r.satis}>{rate(r.satis)}</td></tr>)}
          </tbody></table></TableRegion>
        </AdminPanel>
        <p className="admin-hint">Canlı doğrulama modunda süresi geçen kur veya ürün verisi satışa kapatılır. Kayıtlı veri modunda son fiyat, stok ve kur kullanılır; sipariş fiyat ve stok teyidi bekler.</p>
      </div>
    </div>
  </AdminPage>;
}
