# Getirbakim

## Mevcut GitHub reposuna geçiş

Yeni sistem mevcut `aokcuoglu/getirbakim` reposunun `next-system` branch'inde hazırlanır. Eski uygulama ve repo geçmişi `main` üzerinde korunur. İzole Contabo test ortamı, GitHub Actions akışı ve canlıya geçiş koşulları: [geçiş rehberi](docs/deployment-migration.md).

Bireysel araç sahiplerine yönelik B2C yedek parça mağazası; profesyonel servisler için ayrı B2B erişimi. Next.js, TypeScript, App Router, Tailwind ve bağımsız PostgreSQL ile sıfırdan geliştirildi. Eski `gb` kodu, şeması ve verileri kullanılmaz; yalnızca tedarikçi bağlantı değişkenleri seçilmiştir.

## Çalıştırma

```sh
npm install
npm run db:setup
npm run db:assets
npm run dev -- --port 3100
```

Yerel `.env.local` hazırdır ve Git dışında tutulur. PostgreSQL 18 Homebrew servisi, `getirbakim` veritabanı ve bağımsız `getirbakim_app` rolü kullanılır. `db:setup` bunları doğrular, yeni tablolar/alanlar ekler ve ilk yöneticiyi oluşturur. Başka makinede `.env.example` alanlarını doldurun ve bağımsız rol/veritabanı oluşturun. `.env.example` yalnızca değişken adlarını içerir.

## B2C ve B2B

- **Bireysel müşteriler:** `/katalog` üzerinden ürün adı, marka, ürün veya OEM koduyla arama; kategori/marka filtreleri ve fiyat sıralaması; açık bireysel fiyatlar; üyelik olmadan detay ve kalıcı ziyaretçi sepeti.
- **Servisler:** `/giris` üzerinden onaylı hesapla giriş; servise tanımlı indirimle B2B fiyatları; ziyaretçi sepetinin girişte hesap sepetine aktarılması. Hesap sepeti veritabanında kalıcıdır.
- **Yönetim:** `/yonetim`, yalnızca yöneticilere açıktır. Yönetici e-posta/şifresi `.env.local` içindeki `ADMIN_EMAIL` ve `ADMIN_PASSWORD` alanlarındadır. Servis onayı ve indirim tanımı burada yapılır.
- **Başbuğ verileri:** `/yonetim/tedarikciler/basbug` admin için parça/OEM/ad/marka araması, grup/marka/para birimi/stok sinyali/veri kalitesi filtreleri, 50 satırlık sayfalama ve ürün detaylarını sunar. Kaynak fiyatlar, MRK depo sinyalleri, kur yanıtı, çekilme zamanları ve veri kalitesi sayıları gösterilir. “Seçili grubu API’den güncelle” yeni bir DB gözlemi oluşturur. Başbuğ’un 15 liste grubunun tamamı hazır; güncel veriler ve değişiklik geçmişi ayrı saklanır. [İşleyiş ve sınırlar](docs/basbug-admin.md).
- **Garaj:** `/garaj` marka/model/yıl bilgisini bu tarayıcıda 30 gün saklar. Henüz doğrulanmış araç-parça uyumluluk eşleştirmesi veya araçla katalog filtreleme yoktur. Araç seçimi paneli PostgreSQL `vehicle_brands`, `vehicle_models`, `vehicle_types` tablolarındaki TecDoc verilerini kullanır (251 marka, 5.767 model/kasa, 37.937 tip). Marka → model/kasa → yakıt → motor → model yılı akışı ve sayfalı arama `/api/vehicles` üzerinden seçim bazında sorgulanır. Kaydedilen `vehicleId` gerçek TecDoc tip kimliğidir; araç tercihi 30 günlük HttpOnly tarayıcı çerezinde saklanır. Plaka sorgulama servisi bağlı değildir. CSV aktarımı için `npm run db:vehicles`, DB kayıtlarıyla kaynak alanlarını ve API'yi doğrulamak için `npm run test:vehicles` çalıştırılır. [TecDoc şeması ve aktarım](docs/vehicle-catalog.md).

Ziyaretçi sepeti rastgele 256 bit token ile ilişkilendirilir; sunucuda yalnızca token özeti tutulur. Çerez HttpOnly/SameSite/Lax, production ortamında Secure'dür ve 30 gün geçerlidir. B2B oturumları 30 dakika geçerlidir. Fiyatlar, indirimler, stok sınırı ve hesap erişimi sunucuda kontrol edilir. Aynı ürünü yeniden eklemek adedi artırır; sepetten güncellemek adedi değiştirir.

`price_kurus` katalogdaki KDV dahil bireysel satış fiyatıdır. Başbuğ için NF maliyeti × döviz satış kuru × kâr oranı × KDV üzerinden TRY fiyatı hesaplanır; onaylı servisin indirimi bu tutara uygulanır. Eski veya eksik fiyat/kur verisi satışa kapatılır. Sepet ve sipariş ürün toplamını gösterir; sevkiyat bedeli teyit aşamasında belirlenir. **Sipariş talebi oluşturma, geçmiş siparişler ve yönetici durum geçişleri uygulanmıştır; çevrimiçi ödeme alınmaz.** Sipariş sırasında mağaza stoku rezerve edilir; iptalde geri eklenir. Tedarikçi stok sinyali adet olarak azaltılmaz. [Sipariş ve fiyatlandırma akışı](docs/commerce.md).

## Tasarım ve yerel materyaller

Güncel tasarım dili [DESIGN.md](DESIGN.md) içinde tanımlıdır: mağazada Airbnb’den esinlenen açık yüzeyler, belirgin arama ve yuvarlatılmış kartlar; yönetimde Carbon’dan esinlenen düz paneller ve veri tabloları. Getirbakim’ın `#0077c7` mavisi ve yerel Inter fontları korunur. Trodo ölçümleri tarihsel referans ve yerel materyal kaynağıdır.

`src/styles/design-system.css` ortak kontrolleri, `storefront.css` gezinme ve ana sayfayı, `catalog.css` ürün listelerini, `commerce.css` ürün detayı/sepet yüzeylerini, `supplier-admin.css` yönetim alanını, `garage.css` garaj sayfasını düzenler. `globals.css` yalnızca belge resetini içerir; ortak tipografi, paneller ve durum mesajları tasarım sistemindedir. Bireysel katalog ızgara, servis kataloğu liste görünümüyle açılır; iki görünüm arasında geçiş yapılabilir. Mobil filtreler açılabilir; ürün detayında satın alma formu alt aksiyon alanına dönüşür. OEM / ürün kodu araması ve ürün / marka araması gerçek sorguya aktarılır. Garaj kaydı uyumluluk eşleştirmesi veya katalog filtreleme yapmaz.

52 görsel/font dosyası `public/media/trodo` altında yereldir. Ana sayfa hero, kategori, fren kartı ve bakım görselleri; üst alan ikonları ve Inter fontları bu dizinden sunulur. Sayfa render edilirken Trodo/CDN bağlantısına ihtiyaç duyulmaz. Trodo logosu, değerlendirme puanları, kampanya indirimleri veya ödeme/kargo şirketi taahhütleri kullanılmaz. Getirbakim marka ve Türkçe içerikleri korunur.

Kaynak URL, yerel yol, içerik türü, boyut ve SHA-256 özeti [materyal manifestinde](docs/design-reference/assets.json) bulunur. Referans CSS dosyaları da `docs/design-reference` altında saklanır; uygulamaya doğrudan yüklenmez. `npm run db:assets` dosya özetlerini doğrulayıp 52 görsel/font kaydını `media_assets` tablosuna işler. Binary dosyalar veritabanında çoğaltılmaz. Inter font lisansı font dizininde saklanır. [Ölçüm ve uygulama notları](docs/design-reference/README.md).

## Katalog ve entegrasyon sınırı

Başbuğ ürünleri genel `/katalog` sayfasında listelenir. Kategori bilgisi olmayan kayıtlar kategorisiz kalır ve kategori filtrelerinde görünmez; açık bir `product_data.category` değeri varsa ilgili kategoride görünür. Arama ürün kodu, OEM, ad ve markayı kapsar; sonuçlar 60 ürünlük sayfalarla gösterilir. Yalnızca mevcut (`present`), çelişkisiz MRK kayıtları yayınlanır. Satışa hazırlanmış aynı tedarikçi/kod `products` içinde varsa o kayıt önceliklidir. Ham maliyet ve stok işaretleri doğrudan satış fiyatı/adet olarak gösterilmez. Geçerli maliyet ve kurdan hesaplanan KDV dahil satış fiyatı gösterilir; fiyat verisi eksik veya eski olan ürünlerde hazırlık bilgisi görünür ve satın alma formu bulunmaz.

`npm run verify:catalog` yerel veriyle katalog, arama, filtre, sayfalama ve detay akışını salt okunur doğrular (varsayılan adres `http://localhost:3000`).

Dinamik IP erişimini reddetti. Başbuğ Auth ve ürün/fiyat/stok/kur çağrıları canlı doğrulandı; gözlemler ayrı tedarikçi tablolarına aktarılıp mağaza kataloğunda gösterilir. Güncel ve geçerli fiyat verileri satış fiyatına dönüştürülür; stok yanıtı bulunabilirlik sinyalidir, kesin adet ve sevkiyat sipariş sonrasında teyit edilir. Sırlar tarayıcıya gönderilmez. [Entegrasyon durumu](docs/integrations.md), [Başbuğ veri incelemesi ve DB önerisi](docs/basbug-data-analysis.md).

`npm run supplier:basbug:inspect` Auth alıp FIAT grubu ve MRK deposu örneklerini yeniden çeker. Ham yanıtlar Git dışında `.local/basbug/` altında tutulur; tokenlar yalnızca bellekte kalır.

`npm run supplier:basbug:import` seçilen grubun canlı ürün/fiyat/stok/kur verilerini admin tablolarına aktarır. `BASBUG_SAMPLE_GROUP` varsayılanı FIAT; doğrulanan depo MRK'dir. Mağaza `products` tablosuna yazmaz.

İsteğe bağlı, açıkça etiketli sentetik ürünlerle arayüz denenebilir:

```sh
npm run db:demo
```

Arama kodu: `GB-DEMO-001`. Bunlar gerçek ürün, stok, fiyat veya araç uyumluluğu verisi değildir. Varsayılan kurulumda örnek ürünler eklenmez.

## Doğrulama

```sh
npm run typecheck
npm run lint
npm run build
npm run start -- --port 3100
npm run verify
npm run test:basbug
npm run verify:basbug
```

`verify` çalışan uygulamada bağımsız veritabanını, açık B2C fiyatlarını, ziyaretçi sepeti kalıcılığını/izolasyonunu, kategori filtresini, stok sınırını, B2B indirimi ve sepet aktarımını, yönetim erişimini, servis onayını, garaj kaydını ve CSRF korumasını sınar. Geçici test ürünlerini, servisleri ve sepetleri sonunda siler. `VERIFY_URL` ile test adresi değiştirilebilir.

Production'da HTTPS ve güvenli sır yönetimi gerekir. Çevrimiçi ödeme ve nihai teslimat koşulları tamamlanmadan otomatik tahsilata hazır değildir. Araç-parça uyumluluğu ayrıca doğrulanmalıdır.

Tedarikçi otomatik fiyat/stok/kur güncellemesi, macOS zamanlayıcısı ve bildirimleri, sipariş öncesi kontrol, değişiklik geçmişi ve saklama politikası: [Tedarikçi senkronizasyonu](docs/supplier-sync.md).

## Marka ve lansman hazırlığı

[Marka rehberi](docs/brand-guide.md), [90 günlük uygulama ve lansman kabul listesi](docs/launch-roadmap.md), [ilk ay içerik takvimi](docs/content-calendar.md). Logo, profil, favicon ve üç sosyal şablon SVG/PNG olarak `public/brand` altında. Marka yazımı **getirbakim / Getirbakim**.

`/servisler` tanıtımı ve `/servisler/basvuru` başvuru akışı, yönetici onayına bağlı hesap oluşturur. Şema eklemeleri için `npm run db:brand:migrate`; mevcut hesaplar korunur. `/yonetim` başvuru iletişim bilgilerini ve indirimli onayı sunar. Başvuru tekrarları mevcut hesabı değiştirmez; onay öncesi oturum açılmaz.

SEO: `SITE_URL` (varsayılan https://getirbakim.com), isteğe bağlı `GOOGLE_SITE_VERIFICATION`, `/robots.txt`, `/sitemap.xml`, ürün metadata ve Product JSON-LD. Ödeme/sevkiyat doğrulanana kadar Offer ve Merchant Center satış verisi yayınlanmaz. TAMI’nin mevcut canlı entegrasyonu ve ücretli B2B moto-kurye ticari tercihleri yol haritasında kayıtlı; TAMI taşıma adaptörü eski gb projesinden uyarlandı ve sahte imza/tutar/sipariş testleri eklendi. Nihai kargo ve kalıcı ödeme denemesi/dönüş akışı tamamlanmadan tahsilata bağlanmadı; reklam hesabı kurulmadı.

Marka doğrulaması: `npm run test:brand` (girdi ve TAMI sözleşmesi, sentetik/mocked veriler) ve çalışan uygulamada `npm run verify:brand` (başvuru → onay → giriş, CSRF, izolasyon ve SEO). İkinci komut geçici test hesabını sonunda siler.

## Kod organizasyonu

- `src/app`: route bileşenleri, metadata ve route'a özel action girişleri.
- `src/modules/auth`: ortak şifre/girdi şemaları, oturum ve giriş/çıkış action'ları. Şifreler en fazla 72 UTF-8 bayttır; yeni şifreler en az 12 karakter olmalıdır.
- `src/modules/store`: katalog, sepet, sipariş ve garaj iş kuralları; `src/modules/admin/data.ts`: yetki kontrollü yönetim sorguları.
- `src/components/ui`: genel Select ve ikon; `auth`, `garage`, `navigation`, `privacy`: işlevlere göre bileşenler.
- `src/lib/search-params.ts`: tekrarlanan URL parametrelerinde ilk değeri seçer. Katalog parametreleri ayrıca `catalog-query.ts` şemasıyla doğrulanır.

Üst alandaki hesap, garaj ve sepet ayrı `Suspense` sınırlarında yüklenir. Oturum sorgusu React render isteği kapsamında paylaşılır; sepet rozeti yalnızca adet toplamını okur. `global-error.tsx` kök render hatalarını karşılar.

Review regresyonları: `npm run test:review` ve çalışan uygulamada `npm run test:review:http` (`VERIFY_URL` ile adres seçilebilir).
# Ürün zenginleştirme ve MinIO

Yerel S3 uyumlu görsel deposu, PostgreSQL zenginleştirme tabloları ve içe aktarma komutları için [ürün zenginleştirme rehberine](docs/product-enrichment.md) bakın. Yönetim ekranı: `/yonetim/urun-verileri`. Kuyruk hazırlığı ürünlerin kaynaktan toplandığı anlamına gelmez; kaynak erişim durumu ve tamamlanan/kısmi kayıtlar ayrı izlenir.
