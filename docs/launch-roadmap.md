# Getirbakim — ilk 90 gün uygulama planı

## Mevcut teslim ve ticari kararlar

Marka metinleri, Hakkımızda hikâyesi, iki müşteri yolu, logo/profil/favicon ve üç sosyal şablon hazır. `/servisler` tanıtımından `/servisler/basvuru` üzerinden başvuru alınır. Başvurular `/yonetim` içinde indirim oranıyla onaylanır. Başvuru şifreyi bcrypt ile saklar, onay bekleyen hesap giriş yapamaz; mevcut hesap bir tekrar başvuruyla değiştirilmez. Eklemeli şema: `npm run db:brand:migrate`; yeni kurulumda `db:setup` da aynı alanları ekler.

Ödeme için **mevcut canlı TAMI POST entegrasyonu ilk tercih**. Kuveyt Türk anlaşması görüşülüyor; ikinci sağlayıcı olarak değerlendirilecek. `/Users/void/www/gb/lib/payments/tami.ts` ve hosted-checkout/verification akışları incelendi. Kart bilgilerini uygulamada toplamayan hosted token, ödeme sorgusu ve imza doğrulama taşıma katmanı `src/modules/payments/tami.ts` içine uyarlandı; `.env.example` yalnız değişken adlarını içerir. Sandbox varsayılanı, endpoint çifti doğrulaması, kurus cinsinden tutar karşılaştırması ve sahte dönüş reddi test edilir. Sırlar eski projeden kopyalanmadı. Siparişin nihai vergi/kargo tutarı, kalıcı ödeme denemesi, callback/reconciliation ve iade akışları tamamlanmadan checkout’a bağlanmaz. Bu adaptör henüz canlı ödeme almaz. Mevcut canlı siteyle bu geliştirme ortamının ödeme altyapısı ayrı doğrulanmalıdır. Resmî referans: [TAMI geliştirici portalı](https://dev.tami.com.tr/). Canlı sağlayıcı alanlarını/anahtarlarını tahmin etmeyin; kaynak kod ve güncel sağlayıcı dokümanını birlikte doğrulayın.

Kargo için startup şirketlerle anlaşma yapılacak. **Acil B2B parça ihtiyaçlarında ek ücretli moto-kurye** seçeneği sunulacak. Hizmet bölgesi, stok hazırlığı, çalışma saatleri ve ücret müşteri tarafından kabul edilmeden “hemen teslim” sözü verilmez. Başlangıçta destek ekibi uygunluk ve ücreti teyit eder; çevrimiçi seçeneğin açılması için tarife ve adres kuralları gerekir. Akü saha hizmetinin ilçeleri, saatleri ve montaj ücretleri de henüz netleşmedi.

## Takvim ve sorumlular

| Dönem | İş | Sorumlu | Çıkış ölçütü |
| --- | --- | --- | --- |
| Gün 1–7 | İsim testi (10 araç sahibi, 5 servis), marka araştırması; maliyet, stok, kargo ve akü sınırları | İşletme sahibi | Tek sayfa marka rehberi, 50–100 reklam ürünü adayı, onaylı ticari koşullar |
| Gün 8–21 | Marka paketi, gerçek fotoğraf; TAMI uyarlaması, sipariş/ödeme ve teslimat; servis başvuruları | Geliştirici, ekip, işletme sahibi | Mobilde uçtan uca B2C/B2B ödeme; doğrulanmış fiyat/stok; hizmet tarifeleri |
| Gün 22–30 | B2C/B2B pilot, dönüşüm ölçümü, Merchant Center ve reklam hazırlığı | Ekip, geliştirici | 5 B2C ve 5 B2B siparişin ödeme/teslimat kanıtı |
| Gün 31–60 | Kontrollü Google/Instagram lansmanı; mevcut servis ağı; haftalık rapor | İşletme sahibi, ekip | Ürün/kanal/müşteri türü bazında satış ve katkı raporu |
| Gün 61–90 | Kârlı ürünlerde bütçe artışı, ürün sayfası iyileştirmesi, tekrar sipariş | İşletme sahibi, ekip | İki haftalık teslim edilmiş sipariş kârlılığı; tekrar sipariş veren servisler |
| Ay 4–6 | Başarılı kategorileri genişlet, içerik ve tedarik süreçlerini geliştir | İşletme sahibi | Kapasite ve katkıyla birlikte büyüme |

30 gün hazırlık hedefidir; reklamın başlama koşulu aşağıdaki kabul listesidir. Hazır olmayan tedarikçi ürünleri hazır ürünlerin lansmanını bekletmez. Marka/tescil incelemesi, gerçek çekimler, şirket anlaşmaları, ödeme hesabı ve harici hesaplarda yayınlama işletme tarafında tamamlanır.

## Lansman kabul listesi

- [x] Marka yazımı ve B2C/B2B yolları tutarlı.
- [x] B2B başvuru ve yönetici onayı; sunucuda doğrulama ve parola özeti.
- [x] SVG/PNG marka paketi ve üç sosyal şablon.
- [x] Sitemap/robots, ürün başlıkları, güvenli Product JSON-LD temel bilgileri.
- [ ] Gerçek maliyet, KDV, ödeme gideri, kargo/paketleme, iade payı ve B2B indiriminin katkısı onaylı.
- [ ] Kendi stokunun ve tedarikçi bulunabilirliğinin anlamı, sevk süreleri ve bayat veri kuralları doğrulanmış.
- [ ] TAMI test ödeme/dönüş, başarısız ödeme, tutar uyuşmazlığı, tekrar dönüş ve tekrar ödeme testleri tamam.
- [ ] Mobil B2C ve onaylı B2B ödeme; misafir/hesap sipariş izolasyonu; sipariş öncesi fiyat/stok yeniden kontrolü tamam.
- [ ] Fiyat/stok değişimi, iptal, iade ve stok rezervasyonu çözülmüş.
- [ ] Kargo sözleşmesi, moto-kurye hizmet alanı/ek ücreti, akü montaj ilçeleri/saatleri yayınlanmış.
- [ ] Gerçek işletme fotoğrafları ve siparişe özgü teslimat/iade açıklamaları hazırlanmış.
- [ ] 5 B2C ve 5 B2B pilot ödeme ve teslimat operasyon ekibince doğrulanmış.
- [ ] Search Console hesabında doğrulama, Merchant Center ve ölçüm hesabı kurulmuş.
- [ ] Reklam, ürün ve ödeme fiyatı/stoku aynı; reklam sadece satışa hazır ürünlerde.

`SITE_URL` kanonik alan adını, `GOOGLE_SITE_VERIFICATION` Search Console meta doğrulama değerini alır. Sitemap sentetik demo ürünlerini dışarıda bırakır; tedarikçi hazırlık sayfaları noindex alır. Product JSON-LD ödeme/vergi/sevk tamamlanana kadar Offer ve puan yayınlamaz; gerçek ürün fotoğrafı ve doğrulanmış Offer eklenmeden zengin ürün sonucu veya Merchant Center uygunluğu iddia edilmez. Katalog filtre/arama sayfaları canonical ve noindex kurallarıyla yönetilir.

## Bütçe ve karar kuralı

Reklam bütçesi yazılım/logo/içerikten ayrı: ilk ay **15.000 TL**. Google Arama %70 = 10.500 TL, Instagram/Meta %20 = 3.000 TL, test %10 = 1.500 TL. Üst sınır 30.000 TL’de aynı paylar 21.000 / 6.000 / 3.000 TL. Google’da ürün/OEM ve marka-model-parça aramaları; yerel akü hizmeti ayrı kampanya. 50–100 ürün stok doğruluğu, talep, sevk ve katkıyla seçilir.

**Reklam öncesi katkı = KDV hariç net satış − ürün maliyeti − ödeme gideri − sevk/paketleme − montaj/saha gideri − iade payı.**

Başlangıç müşteri edinme maliyeti hedefi bu katkının en fazla yarısı. Bütçe artışı için iki hafta teslim edilmiş siparişlerde kârlılık ve yeterli operasyon kapasitesi gerekir. Moto-kurye geliri ve gideri sipariş katkısında ayrı görünür. Ciro tek başına büyütme gerekçesi değildir.

## Haftalık rapor ve olay sözleşmesi

Her hafta kanal, ürün, müşteri türü ve teslimat biçimi bazında: tamamlanan/teslim edilen sipariş, yeni müşteri sayısı, reklam gideri, edinme maliyeti, reklam sonrası katkı, stok iptali, uyumluluk iadesi, zamanında sevk, servis başvurusu → onay → ilk sipariş → tekrar sipariş.

| Olay | Gerçek tetikleyici | Alanlar |
| --- | --- | --- |
| view_item | Ürün detayının görüntülenmesi | Ürün id/kod, TRY, gösterilen fiyat, B2C/B2B |
| add_to_cart | Sunucunun sepet eklemesini kabul etmesi | Ürün id, kabul edilen adet, birim fiyat |
| begin_checkout | Doğrulanmış ödeme başlangıcı | Sipariş/taslak id, ürünler, nihai tutar |
| purchase | Sağlayıcı doğrulamasıyla başarılı tahsilat | Tekil işlem/sipariş id, nihai tutar, vergi, sevk |
| service_application | Yeni başvurunun sunucuda kaydı | Tekil başvuru id; e-posta/telefon/parola yok |
| contact_click | Telefon veya WhatsApp bağlantısı | Kanal; satıştan ayrı |

Mevcut çerez tercihleri analiz/reklam entegrasyonlarını sınırlar. Bu teslimde harici analiz/reklam hesabı veya piksel kurulmamıştır; olay sözleşmesi entegrasyon için hazırdır. `purchase` yalnız doğrulanmış ödemeden, tekilleştirilerek üretilir; sipariş talebi veya teşekkür URL’si satış sayılmaz. Tercih reddedildiyse ilgili entegrasyon yüklenmez; tercih kaldırıldığında sonraki olaylar durur.

## B2B pilot

Mevcut ağdan 20 servis seçilir. Hedef 10 ilk sipariş, 5 ikinci sipariş; satış tahmini değildir. Her servisin başvuru/onay/ilk/ikinci sipariş tarihini ve engellerini kaydedin. Acil ihtiyaç, moto-kurye ek ücret kabulü, hazırlama ve teslimat süresini ayrıca ölçün.

## Bu teslimin doğrulama kanıtı

`npm run test:brand`: 4 test geçti — başvuru doğrulaması, bcrypt bayt sınırı, TAMI imza/tutar/sipariş güvenliği ve mocked hosted-token/query sözleşmesi. `npm run verify:brand`: çalışan üretim sunucusunda başvuru, tekrar başvuru, yönetici onayı, onay öncesi giriş engeli, servis/yönetici sınırı, CSRF ve sitemap/robots doğrulandı. `npm run typecheck`, `npm run lint` ve `npm run build` geçti. Marka PNG boyutları ve açık/koyu logo ile sosyal şablonlar görsel olarak kontrol edildi. Tarayıcı bağlantısı bu oturumda kullanılamadı; sayfaların mobil ekran görüntüsü doğrulaması açık. TAMI testleri sağlayıcıya istek göndermez; gerçek sandbox/live tahsilat, iptal/iade, kargo ve pilot teslimat doğrulanmadı.
