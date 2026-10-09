import type { Metadata } from "next";
import Link from "next/link";
export const metadata: Metadata = {
  title: "Servisler için Getirbakim | Güvenilir parça tedariki",
  description: "Oto servisin için Getirbakim’e başvur. Onaylı hesabında servisine özel fiyatları gör, ürün ve OEM koduyla parça ara.",
  alternates: { canonical: "/servisler" },
};
export default function Services() {
  return <section className="shell page-section service-landing">
    <p className="eyebrow">SERVİSLER İÇİN GETİRBAKİM</p>
    <h1 className="page-title">Servisinin parça ihtiyacı için güvenilir tedarik.</h1>
    <p className="lead">Parçadan anlayan bir ekiple çalış. Kendi stokumuz ve tedarik ağımız üzerinden parçaları incele, onaylı servis hesabınla sana özel fiyatlara ulaş.</p>
    <div className="service-actions"><Link href="/servisler/basvuru" className="button">Servis hesabına başvur</Link><Link href="/giris" className="button outline">B2B hesabıma giriş yap</Link></div>
    <div className="brand-paths">
      <article className="panel"><h2>Servisine özel fiyatlar</h2><p>Bireysel fiyatlar herkese açık. Servisine tanımlanan indirim, hesabın onaylandıktan sonra katalogda ve sepette uygulanır.</p></article>
      <article className="panel"><h2>Kodla kolay parça arama</h2><p>Ürün ve OEM koduyla ara; üretici, motor ve araç özelliklerini karşılaştır. Uyumluluk konusunda destek almak için ekibimize ulaş.</p></article>
    </div>
    <article className="panel">
      <h2>Nasıl başlarım?</h2>
      <ol className="service-steps"><li>Servis ve iletişim bilgilerinle başvurunu gönder.</li><li>Ekibimiz servis bilgilerini kontrol edip seninle iletişime geçsin.</li><li>Onaydan sonra belirlediğin şifreyle giriş yap ve fiyatlarını gör.</li></ol>
      <p>Başvuru ücretsizdir. Onay otomatik verilmez; ticari koşullar servis bazında değerlendirilir.</p>
    </article>
    <article className="panel"><h2>Acil parça ihtiyacın mı var?</h2><p>Servisin için ek ücretli moto-kurye teslimatını destek ekibimize sor. Uygun stok, adres ve hizmet saatleri kontrol edilir; kurye ücreti ve teslimat zamanı gönderim öncesinde birlikte netleştirilir.</p><a className="service-link" href="tel:+902163870078">Moto-kurye için destek al: 0216 387 00 78</a></article>
    <p className="notice">Katalog ve sepet kullanıma açık. Sipariş talepleri stok ve sevkiyat teyidiyle değerlendirilir. Nihai sevkiyat hesabı ve çevrimiçi ödeme hazırlanıyor; şu anda ödeme alınmıyor.</p>
    <p>Destek: <a href="tel:+902163870078">0216 387 00 78</a> · <a href="mailto:info@ergulenerji.com">info@ergulenerji.com</a></p>
  </section>;
}
