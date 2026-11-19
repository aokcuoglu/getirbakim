# Ürün beslemesi: Google Merchant Center ve Meta (#643)

Mağazanın satılabilir ürünleri tek bir sıkıştırılmış dosyada Google Merchant Center'a (ücretsiz ürün listelemeleri, Alışveriş reklamları) ve Meta kataloğuna verilir.

- **Adres:** `https://getirbakim.com/feeds/google.xml.gz`
- **Biçim:** RSS 2.0 + `xmlns:g="http://base.google.com/ns/1.0"`, UTF-8, gzip. Dosyanın kendisi `.gz`; yanıt `Content-Type: application/gzip` döner, `Content-Encoding` yoktur. Google ve Meta zamanlanmış getirmede `.gz` dosyayı açar.
- **Erişim:** herkese açık, listelenmemiş adres. `robots.txt` ve site haritasında yer almaz. İçerik zaten herkese açık fiyatlardır. Kimlik doğrulama yoktur.

## Nasıl çalışır

- **Üretim:** istek anında değil, zamanlanmış koşuda (`scripts/merchant-feed.ts`, `npm run seo:feed`).
  - Site haritasının 64 ürün parçası, site haritasıyla **aynı dizin ölçütüyle** gezilir (`indexableProductsSql`, #641).
  - Her parçanın satırları mağazanın fiyat ve stok görünümünden okunur: `commerce_catalog` ve `withBestOffers`, gruplu üründe en ucuz satılabilir teklif. Sonuç ürün sayfasında anonim ziyaretçinin gördüğü fiyattır.
  - Öğeler gzip akışıyla geçici dosyaya yazılır. Bellek parça başına sınırlı kalır, katalog büyüse de sabittir.
- **Yükleme:** dosya `S3_BUCKET` içine `feeds/google.xml.gz` olarak, koşu özeti `feeds/google.json` (manifest) olarak yazılır.
- **Sunum:** `src/app/feeds/[file]/route.ts` S3 nesnesini akışla döner. Veritabanına dokunmaz; yalnız `google.xml.gz` adı sunulur, diğer adlar `404` döner.
  - Başlıklar: `Cache-Control: public, max-age=3600`, `ETag`, `Last-Modified`, `Content-Length`, `X-Content-Type-Options: nosniff`.
  - Henüz dosya yoksa `404`, depo hatasında `503` + `Retry-After: 300`, staging'de (`APP_ENV=staging`) `404`.
  - `src/proxy.ts` `/feeds/` yolunu atlar: yanıt oturum çerezi (`Set-Cookie`) taşımaz (#642).

## Hangi ürünler girer

Bir ürün yalnız şu koşulların hepsini sağlarsa girer:

1. Ürün sayfası dizine açık (site haritasında var): saklanmamış, ikincil teklif değil, asgari içeriği var (#641), demo değil.
2. Fiyatı var (`price_kurus ≥ 1`).
3. Sayfadaki Offer'ın kuralına göre **stokta**: `offerAvailability()` (`src/modules/seo/structured-data.ts`) `in_stock` dönmeli.
   - "Stokta yok" ürünler `out_of_stock` olarak **eklenmez**; kapsam yalnız satılabilir ürünlerdir.
   - "Stokta · Siparişten sonra teyit edilir" (teyitsiz stok) ve bilinmeyen stok da girmez.
4. Görseli var ve kısa kenarı en az 100 px.
   - Görsel, mağaza kartıyla aynı kuralla seçilir (`getCatalogProductImages`): yöneticinin ilk yüklemesi, yoksa gizlenmemiş otomatik zenginleştirme görseli.

### Sipariş modu "Kayıtlı veriler" (snapshot) iken besleme boştur

Snapshot modunda (`commerce_settings.basbug_checkout_mode='snapshot'`) her tedarikçi stoğu "Stokta · Siparişten sonra teyit edilir" (teyitsiz stok) olarak görünür. Bu durumda sayfa hiçbir ürünü stokta göstermez, besleme de **bilerek boş** çıkar.

- Koşu boş dosyayı yazar ve `completed` biter. Düşüş koruması bu durumda uygulanmaz, çünkü mod değişimi bilinçli bir toplu çıkıştır.
- Manifestte `checkoutMode: "snapshot"` ve `note` alanı nedeni yazar.
- Merchant Center'daki ürünler sonraki getirmede düşer.
- Mod `live`'a dönünce sonraki koşu beslemeyi yeniden doldurur. Boştan dolu duruma geçişte koruma devreye girmez.
- Bu davranış `scripts/test-merchant-feed.ts` içinde test edilir ("snapshot checkout…").

## Alanlar

| Alan | Değer |
| --- | --- |
| `g:id` | Satırın uuid'si (ürün adresinin sonundaki kimlik). |
| `g:title` | `productSeoTitle` (#641), en çok 150 karakter. Marka, ad ve parça no; araç adı yok (takip işi). "Belirtilmemiş" markası yazılmaz. |
| `g:description` | `productSeoDescription`, en çok 1000 karakter. Marka, parça no ve ad; OEM; ürün açıklaması. |
| `g:link` | Kanonik ürün adresi (`productPath`), mutlak. |
| `g:image_link` | Seçilen görselin mutlak adresi (`/api/product-media/<id>`). |
| `g:availability` | `in_stock` |
| `g:condition` | `new` |
| `g:price` | KDV dahil TRY, `1234.50 TRY` biçiminde. Kampanyada kampanyanın yerini aldığı liste fiyatı yazılır. |
| `g:sale_price` | Yalnız kampanyada: kampanya fiyatı. |
| `g:sale_price_effective_date` | Kampanyanın bitişi varsa: `<üretim anı>/<bitiş>` (ISO 8601, UTC, saniye hassasiyetinde: `2026-11-17T10:00:00Z/2026-11-20T21:00:00Z`). |
| `g:brand` | Mağazada görünen marka. "Belirtilmemiş" ise yazılmaz. |
| `g:mpn` | Görünen parça no, marka öneki olmadan (`numberWithoutBrand`), en çok 70 karakter; boşsa yazılmaz. |
| `g:gtin` | Yöneticinin girdiği ilk geçerli barkod (GTIN-8/12/13/14, kontrol basamağıyla, `gtin_valid`). Yoksa Dinamik `barkod1..3` içinde geçerli **tek** GTIN. Birden çok farklı geçerli barkod varsa yazılmaz. Dinamik'in yanlış barkodu gizlenemez; doğrusu yönetici barkodu olarak eklenince o kullanılır. |
| `g:identifier_exists` | GTIN yoksa ve marka da yoksa `no`. |
| `g:google_product_category` | `899` = Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts (Google taksonomisi 2021-09-21). |
| `g:product_type` | Mağaza kategori yolu, `Fren Sistemi > Balata` biçiminde. Yöneticinin kategorisi, yoksa güvenilir zenginleştirmenin Trodo kategorisi kullanılır. |
| `g:shipping` | **Yazılmaz.** Kargo ve iade Merchant Center hesabında tanımlanır (aşağıda). |

B2B (servis) indirimi beslemeye hiçbir yoldan girmez: koşu hesap, oturum ya da indirim okumaz.

## Korumalar

- Tek seferde tek koşu (`pg_try_advisory_lock(20261117,1)`). İkinci koşu `skipped` yazıp çıkar.
- **Düşüş koruması:** önceki beslemede 100'den fazla öğe varsa ve yeni koşu yarısından azını üretiyorsa koşu `failed` biter, çıkış kodu 1 olur. Eski dosya ve manifest yerinde kalır. Bozuk fiyat ya da stok içe aktarımı hesaplardaki ürünleri boşaltmasın diye vardır.
  - Bilinçli toplu düşüş `--force` ile yayınlanır; manifestte `note` alanı bunu kaydeder.
  - Snapshot modunda koruma uygulanmaz (yukarıda).
- Yazan koşu yalnız **açıkça verilmiş** `SITE_URL` ve `S3_BUCKET` ile çalışır. Aksi halde `disabled` olur, böylece yerelden canlı alan adıyla dosya yazılmaz. Staging'de koşu da route da kapalıdır.
- Geçici dosya her durumda silinir.

## Komutlar

```bash
npm run seo:feed -- --dry-run   # her ortamda: dosyayı geçici dizinde üretir, sayaçları yazar; depoyu okumaz/yazmaz
npm run seo:feed                # üretir ve S3_BUCKET'a yükler (SITE_URL ve S3_BUCKET şart)
npm run seo:feed -- --force     # düşüş korumasını aşarak yükler
npm run test:merchant-feed      # birim + izole şema testleri (ortak veritabanına yazmaz)
```

Çıktı tek satır JSON'dur. Alanlar:

- `feed`: `completed`, `failed`, `skipped` ya da `disabled`.
- `items`, `checked`
- `skipped`: elenme nedenlerine göre sayılar (`demo`, `noPrice`, `notAvailable`, `noImage`).
- `missing`: dizine açık olup satılabilir katalogda bulunmayanlar. Bunlar `noPrice` içinde de sayılır.
- `checkoutMode`, `bytes`, `ms`, varsa `previousItems`, `note`, `reason`, `error`.

Canlı ortamda (`operations` görevi) komut `node --conditions=react-server --import tsx scripts/merchant-feed.ts` olur (`.env.local` yok).

Yerel ölçüm (17 Kasım, yerel veritabanı, snapshot modu): 538.186 dizine açık ürün, 0 öğe, ~50 sn. Aynı katalog teyitsiz stok "stokta" sayılsaydı ~65.800 öğe, ~49 MB XML / ~9 MB gzip olurdu.

## Merchant Center kurulumu (kullanıcı)

1. Merchant Center hesabı açılır. İşletme bilgileri (ad, adres, telefon, müşteri hizmetleri) sitedekiyle aynı girilir.
2. **Alan adı doğrulama ve talep:** Search Console alan adı mülkü (`getirbakim.com`) aynı Google hesabındaysa doğrulama oradan alınır, sonra web sitesi talep edilir.
3. **Ürün kaynağı:** "Ürünler → Ürün kaynakları → Dosya ekle → Bir dosya bağlantısı ekleyin (zamanlanmış getirme)".
   - Adres: `https://getirbakim.com/feeds/google.xml.gz`
   - Ülke Türkiye, dil Türkçe, para birimi TRY.
   - Getirme sıklığı günlük; saat, besleme koşularından birinin hemen sonrası.
4. **Otomatik öğe güncellemeleri** (fiyat ve stok) açık bırakılır. Merchant Center iki getirme arasındaki fiyat farkını ürün sayfasındaki yapılandırılmış veriden (Offer) düzeltir.
5. **Kargo ayarı** (hesap düzeyi; beslemede `shipping` yok). Girilecek değerler:
   - Teslimat bölgesi: Türkiye.
   - Kargo ücreti ve ücretsiz kargo eşiği: `/yonetim`'deki değerlerle aynı. Yerel değerler 150 TL ve 1.500 TL eşik; canlı panelden teyit edilmeli.
   - Hazırlık süresi (iş günü), taşıma süresi (gün) ve sipariş kesim saati: kullanıcı belirler. Hukuki metin bunları sipariş anında bildirir.
   - Kargo firması: Yurtiçi Kargo.
6. **İade politikası** (hesap düzeyi), teslimat ve iade metniyle (`returnPolicy`) aynı: 14 gün, sebepsiz, iade kargo ücreti yok, kargo ile.
7. İlk getirmeden sonra "Ürünler → Tanılama" sekmesinde ret ve uyarılara bakılır. Beklenen uyarılar:
   - Küçük görseller (Google için sınır 100 px; bu sınırın altı zaten elenir).
   - GTIN eksikliği.

## Meta kataloğu (kullanıcı)

Commerce Manager'da "Katalog → Veri kaynakları → Veri akışı → Zamanlanmış akış" seçilir ve aynı adres verilir. Meta, Google biçimindeki RSS XML beslemesini kabul eder. Aşağıdakiler doğrulanmadı (takip işi):

- `in_stock` yazımı.
- WebP görseller.
- 500 px altı görseller: Meta en az 500×500 önerir, yerelde ~53.000 satır bu sınırın altında.

## AWS gereksinimleri (altyapı ortağı)

| Konu | İstek |
| --- | --- |
| Zamanlama | EventBridge → ECS `operations` görevi, günde 4 kez (ör. 00:30, 06:45, 12:30, 18:30 Europe/Istanbul; biri 06:30 IndexNow taramasından sonra). Komut `node --conditions=react-server --import tsx scripts/merchant-feed.ts`. Çıkış 1 = alarm. Koşu yerelde ~1 dk sürer. |
| Ortam (`operations`) | `APP_ENV=production`, `SITE_URL=https://getirbakim.com`, `S3_BUCKET`, `S3_REGION`. |
| IAM | `operations` rolü: `s3:GetObject` ve `s3:PutObject`, önek `feeds/*`. `app` rolü: `s3:GetObject`, önek `feeds/*`. Önek kısıtı yoksa mevcut izinler yeterlidir. |
| CloudFront `/feeds/*` | Kaynağın `Cache-Control` değerine uyulur (`max-age=3600`). Sorgu dizesi, çerez ve `Authorization` önbellek anahtarında olmaz. Ek sıkıştırma yapılmaz (dosya zaten gzip). |
| WAF | `/feeds/*` ve ürün sayfalarında engellenmeyecekler: Merchant Center'ın zamanlanmış getirme istekleri (kullanıcı aracısı doğrulanmadı), `Googlebot`, `Storebot-Google` ve `facebookexternalhit`. |

İlk yayın sırası:

1. `operations` görevinde `npm run seo:feed -- --dry-run` (ya da yukarıdaki node komutu `--dry-run` ile) koşulur ve sayaçlara bakılır.
2. Sonra gerçek koşu yapılır.
3. `curl -sI https://getirbakim.com/feeds/google.xml.gz` → `200 application/gzip`, `Set-Cookie` yok.
4. Merchant Center'a adres verilir.

## Takip işleri

- Meta kataloğu doğrulaması (`in_stock` yazımı, WebP ve 500 px altı görseller), gerekirse ayrı dosya.
- Başlık ve açıklamada uyumlu araç adları.
- GTIN kaynaklarını genişletme (zenginleştirme `EAN` özelliği, manuel liste barkodu) ve ürün sayfasında gösterme.
- `/yonetim`'de besleme durumu kartı: manifestten son koşu, öğe sayısı ve elenme nedenleri; manifest N saatten eskiyse (zamanlanmış koşu durmuşsa) uyarı.
- Kargo onaylanınca `g:shipping` ve JSON-LD `shippingDetails`.
- Kategoriye göre `google_product_category` eşlemesi (yağ, aksesuar).
