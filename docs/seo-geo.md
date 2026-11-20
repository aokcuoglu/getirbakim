# SEO/GEO el kitabı (#647, üst iş #633)

Arama motoru (SEO) ve yapay zekâ yanıt motoru (GEO) görünürlüğünün kodda ne olduğunu, yayın günü hangi hesap/doğrulama adımlarının gerektiğini, altyapı ortağından ne istendiğini ve yayından sonra neyin izleneceğini tek yerde toplar. Her kod iddiası bu dalda ilgili dosyadan doğrulanmıştır; dosya yolları parantez içindedir. Canlı alan adı: `https://getirbakim.com` (kök alan adı kanoniktir, `www` köke yönlenir).

## 1. Teknik envanter

### 1.1 Adres düzeni ve dizin politikası

Tek kaynak `src/modules/seo/paths.ts`. Ayrıntılı adres tablosu ve ölçümler: [launch-roadmap.md](launch-roadmap.md#adres-düzeni).

| Sayfa | Adres | Dizin kuralı |
| --- | --- | --- |
| Ana sayfa, katalog, araç markaları, bakım robotu, servisler, bilgi ve hukuki sayfalar | `/`, `/katalog`, `/arac-markalari`, `/bakim-robotu`, `/servisler`, `/bilgi/<slug>`, `/<hukuki-slug>` | Dizine açık; `staticPaths` ile site haritasında (`src/modules/seo/sitemap.ts`) |
| Rehber | `/rehber`, `/rehber/<slug>` | Dizine açık; `staticPaths` ile site haritasında (`lastModified` = yazının `updated` tarihi); `dynamicParams = false`, bilinmeyen slug `404` |
| Kategori | `/kategori/<kategori>` | Yalın liste dizine açık (`isIndexableListing`: arama, süzgeç, sıralama, 2. sayfa yok) |
| Araç markası | `/yedek-parca/<marka>` | Yalın liste kuralı |
| Araç modeli | `/yedek-parca/<marka>/<model>` | Yalın liste + en az 10 ürün (`minIndexableListingProducts`, `src/modules/seo/indexing.ts`); ürünsüz `404`, 10'dan azı `noindex,follow` |
| Kategori × marka, kategori × marka × model | `/kategori/<kategori>/<marka>[/<model>]` | Aynı eşik; kök "Yedek parçalar" kategorisi × marka/model her zaman `noindex,follow` ve site haritası dışı (`listingIndexable`) |
| Parça üreticisi | `/marka/<uretici>` | Yalın liste + en az 10 ürün, "üretici olmayan" gruplar hariç (`manufacturerIndexable`, `src/modules/store/manufacturers.ts`) |
| Ürün | `/urun/<marka>-<ad>-<parça-no>-<id>` | `src/modules/seo/indexing.ts` (aşağıda) |

Ürün adı (#686, #915; `shownProductName`, `src/modules/store/product-name.ts`): yönetici adı yazıldığı gibi > (yalnız ürün sayfasında) zenginleştirme adı > bilinen İngilizce tedarikçi tip adının Türkçesi ("BRAKE PAD SET, DISC BRAKE" → "Disk Fren Balata Seti") > tedarikçi adının okunur biçimi. Bilinmeyen İngilizce ad okunur biçimde kalır (yalnız arama önerilerinde gizlenir). Sözlük kodda: `src/modules/store/suggestion-names.ts`. Kartlar, ürün sayfası, öneriler, Merchant feed, analitik ve slug aynı adı okur; `/yonetim` ham tedarikçi adını gösterir. Sözlüğe eklenen her kayıt o adı taşıyan ürünlerin slug'ını değiştirir: eski adres `308` ile yeniye gider, IndexNow ikisini de bildirir.

Uyumlu araçlar (#642, #966; `src/components/product-fitment.tsx`): ürün sayfasının HTML'i ilk 20 model grubunu (garajdaki aracın grupları önde), her grubun motor satırlarını ve "Model sayfası" bağlantılarını taşır; marka listesi ve toplam araç sayısı da HTML'dedir. Kalan gruplar ziyaretçi listeyi açınca, süzünce veya arayınca `GET /api/product-fitments/[id]?v=<sürüm>` ile yüklenir (çerezsiz, herkese aynı; sürüm, garajdan bağımsız sıralı listenin özetidir ve liste değişince adres de değişir). JSON-LD ve uyumluluk özeti tüm araçlardan üretilir.

Ürün dizin politikası (#641, #659; `productIndexPolicy` ve `contentSignals`): demo ürün ve tedarik edilemeyen kart (hiçbir tedarikçi şu an satmıyor) `noindex,follow`, Offer basmaz, site haritasında yok. Mağaza ürünleri dizine açık. Tedarikçi ürünü adı, markası ve parça no dışında en az bir doğrulanabilir olgu taşıyorsa açık: eşleşen zenginleştirme, açıklamadan okunan uyumlu model, gizlenmemiş tedarikçi OEM numarası veya yönetici içeriği. Stok ölçüte girmez. Site haritası aynı ölçütü SQL'de uygular; `npm run test:sitemap` ikisini eşit tutar. Ölçüt dışı sayfalar `noindex,follow` ile erişilebilir kalır, sinyal kazanınca kendiliğinden dizine girer.

Dinamik'in yalnız fiyat listesinde olan kodları (#1068; `stock_data IS NULL`, stok listesinde satırı yok) hiçbir zaman satılamaz. İçerik taşıyanlar SEO/GEO için sayfa alır: kendi kodu ve markasıyla eşleşen paylaşılan zenginleştirme (`product_enrichment_shared_links`) ve Türkçe etiketli en az bir kategori (`source_category_labels`, `tr`). Ad, en derin kategorinin Türkçe etiketidir. Liste `storefront_price_only_items` tablosunda tutulur; `storefront_price_only_refresh()` yalnız değişen satırları yazar (uygulama: bağlantılar değişince en geç 1 dk, her durumda 10 dk'da bir; aralık `storefront_price_only_runs` ile veritabanında tutulur, birden çok görev aralık başına tek yenileme yapar; `db:setup` ve `storefront:import-inbound` aralıksız koşar). Ad değişince `qualified_at` ilerler (site haritası `lastmod`). `commerce_unavailable_items` bu satırları ayrı bir dalla canlı koşullarla (fiyat listesinde, çakışmasız, aynı kod veya ürün grubu başka yerde satılmıyor ya da tedarik edilemeyen kartı yok, gizlenmemiş) listeler. Kart fiyatsızdır, "Stok bilgisi bekleniyor" der ve "Gelince haber ver" formunu taşır; diğer tedarik edilemeyen kartların aksine `index` olur (`productIndexPolicy.priceOnly`, minimum içerik şartıyla), site haritasına ve IndexNow'a girer (`indexableProductsSql` üçüncü dalı), Offer basmaz ve ürün beslemesine (merchant feed) hiç girmez (`missing` sayacını da büyütmez). Yalın marka + kod satırları sayfa, liste, arama ve site haritası dışında kalır. Stok listesi satırı gelince ürün hemen satılabilir yola geçer, bir sonraki yenilemede listeden düşer.

Bu kodların zenginleştirilmesi spareto ve parts2world'de ayrı bir pay olarak yürür (#1075, `docs/product-enrichment.md` → "Fiyat listesi ürünleri"); zenginleşen ve Türkçe kategori alan kod bir sonraki yenilemede kart olur.

Yönlendirmeler ve durum kodları:

- Eski adresler tek adımda `301`: `/automakers`, `/car-parts/<marka>`, `/katalog?category=`, `/katalog?brand=` (`src/proxy.ts`, `src/modules/seo/legacy-redirects.ts`); `/yedek-parca` → `/arac-markalari`, `/kategori` → `/katalog` (`next.config.ts`); `/tr`, `/en` önekleri `308` (`next.config.ts`). `/katalog?brand=<etiket>` adresi yazımı farklı bir ana marka diline düşerse (ör. "BLUE PRINT") ikinci bir `308` daha verir (`legacy-redirects.ts`).
- Ürün adresi: çıplak kimlik, bayat slug ve büyük harfli kimlik `308` ile güncel adrese; ikincil teklif ve düşmüş mükerrer satır `307` ile birincil sayfaya (`src/app/(store)/urun/[id]/page.tsx`). Geçersiz id ve gizlenmiş/karşılıksız ürün gerçek `404`. `410` tanımı yok.
- Özel yüzeyler (`/sepet`, `/giris`, `/garaj`, `/siparis*`, `/siparis-olustur`, `/servisler/basvuru`) `noindex,nofollow` (`privatePageRobots`).

### 1.2 Yapılandırılmış veri envanteri

Kurucular `src/modules/seo/structured-data.ts` ve `src/lib/site.ts`; basım `src/components/json-ld.tsx` (`<` kaçışlıdır); `Organization`/`WebSite` bunun dışında `(store)/layout.tsx` içinde satır içi basılır.

| Sayfa | schema.org türleri | Kaynak |
| --- | --- | --- |
| Tüm mağaza sayfaları (düzen) | `Organization` (+ `ContactPoint`, `PostalAddress`, `sameAs`), `WebSite` | `src/app/(store)/layout.tsx`, `siteJsonLd` |
| Ürün | `Product` (`sku`, `mpn`, `brand`, `gtin*`, `image`, `isAccessoryOrSparePartFor` → `Vehicle`, en çok 20), `Offer` (+ `MerchantReturnPolicy`), `BreadcrumbList` | `urun/[id]/page.tsx`, `productJsonLd` |
| Kategori, marka, model, model × kategori, üretici, katalog | `BreadcrumbList`; yalın ve boş olmayan listede `CollectionPage` + `ItemList` | `katalog/catalog-view.tsx` |
| Araç markaları | `BreadcrumbList` | `arac-markalari/page.tsx` |
| Bilgi ve hukuki sayfalar | `BreadcrumbList` | `bilgi/[slug]/page.tsx`, `src/components/legal-page.tsx` |
| Rehber listesi | `BreadcrumbList`, `CollectionPage` + `ItemList` | `rehber/page.tsx` |
| Rehber yazısı | `Article` (yazar ve yayıncı Organization `@id`; kişi adı yok), `BreadcrumbList` | `rehber/[slug]/page.tsx`, `articleJsonLd` |
| Yardım (`/bilgi/yardim`) | `FAQPage` (görünen cevapla aynı düz metin; Accordion yok) | `src/content/faq.ts`, `faqJsonLd` |
| Hakkımızda (`/bilgi/hakkimizda`) | `AboutPage` (`mainEntity` = Organization `@id`; Organization yeniden basılmaz) | `aboutPageJsonLd` |

`Offer` yalnız sayfanın kendi bireysel KDV dahil fiyatı ve kesin stok durumu varken basılır; fiyatsız, tedarik edilemeyen veya stoku belirsiz üründe yoktur; B2B fiyatı hiç girmez. Puan/yorum ve `shippingDetails` basılmaz (ücret ve teslim süresi onayı bekliyor). Demo ürün JSON-LD basmaz.

### 1.3 robots ve yapay zekâ tarayıcı politikası

`src/app/robots.ts` → `robotsPolicy` (`src/modules/seo/crawlers.ts`):

- `APP_ENV=staging` ise her şey `Disallow: /` ve site haritası dosyaları boş.
- Aksi halde `User-agent: *` ve adıyla anılan arama/yapay zekâ botlarına aynı kural: `Allow: /` ve herkese açık medya (`/api/product-media/`, `/api/category-media/`, `/api/vehicle-media/`, `/api/manufacturer-logos/`); `Disallow`: `/yonetim`, `/api/`, `/sepet`, `/giris`, `/garaj`, `/siparis/`, `/siparisler`, `/siparis-olustur`, `/servisler/basvuru` ve liste adreslerinde sınırsız kombinasyon üreten sorgu parametreleri (`q`, `sort`, `brands`, `attributes`, `availability`, `fits`, `oil`). `category`, `brand`, `page` açık kalır.
- Adıyla anılan botlar (`aiCrawlers`): GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot, Claude-SearchBot, Claude-User, PerplexityBot, Perplexity-User, Google-Extended, Applebot, Applebot-Extended, Bingbot, CCBot, Amazonbot, meta-externalagent, DuckAssistBot, MistralAI-User. Hepsine izin verilir (genel görünürlük kararı); eğitim botlarını kapatmak ayrı bir iş kararıdır ve `aiCrawlers` listesinden/kuralından yapılır.
- `Sitemap: <SITE_URL>/sitemap.xml` satırı eklenir.
- `/llms.txt` (`src/app/llms.txt/route.ts`, içerik `src/modules/seo/llms.ts`): statik düz metin site özeti; `Cache-Control: public, max-age=3600, s-maxage=86400`.

### 1.4 Site haritası yapısı

`/sitemap.xml` dizin dosyasıdır (`src/app/sitemap.xml/route.ts`, veritabanı okumaz); parçalar `/sitemaps/<dosya>` (`src/app/sitemaps/[file]/route.ts`):

| Dosya | İçerik |
| --- | --- |
| `pages.xml` | Sabit mağaza ve hukuki sayfalar (`lastmod`: hukuki metin tarihi) |
| `categories.xml`, `makes.xml`, `manufacturers.xml` | Kategori, araç markası, dizine açık üretici sayfaları |
| `models.xml`, `model-categories.xml` | Dizine açık model ve model × kategori sayfaları (#673) |
| `products-00.xml` … `products-63.xml` | Dizine açık ürünler, kimliğin ilk baytına göre 64 parça, `lastmod` ile; parça başına üst sınır 45.000 adres |

Önbellek: yanıt `Cache-Control: public, max-age=3600` (`xmlHeaders`). Veri önbelleği 6 saatte bayatlar, 12 saatte düşer. Sunucunun başlangıçta ve her 3 saatte bir kendisi ısıttığı dosyalar yalnız `models.xml`, `model-categories.xml` ve `manufacturers.xml`'dir (`warmedSitemapFiles`, `src/modules/seo/sitemap-warmup.ts`, #778); ürün parçaları, `categories.xml` ve `makes.xml` ısıtılmaz, tazeliği tarayıcı isteklerine bağlıdır (en çok ~12 saat bayat + 1 saat CDN; soğuk ilk istek sorguyu bekler). Salt fiyat/stok değişimi IndexNow'a gitmez; fiyat tazeliğini `lastmod` taşır. IndexNow ayrıntıları: [indexnow.md](indexnow.md).

### 1.5 Ortam değişkenleri

| Değişken | Amaç | Nerede okunur |
| --- | --- | --- |
| `SITE_URL` | Kanonik alan adı (varsayılan `https://getirbakim.com`); site haritası, robots, JSON-LD, TAMI geri dönüşü. Canlıda `https://getirbakim.com`; IndexNow için açıkça verilmeli | `src/lib/site.ts`, `src/modules/seo/indexnow.ts` |
| `APP_ENV` | `staging` ise robots kapalı, site haritası boş; IndexNow yalnız `production`'da gönderir | `src/app/robots.ts`, `src/modules/seo/sitemap.ts`, `src/modules/seo/indexnow.ts` |
| `GOOGLE_SITE_VERIFICATION` | Search Console meta doğrulaması (boşsa etiket yok) | `siteVerification()` (`src/lib/site.ts`), etiketler `src/app/layout.tsx` metadata'sında basılır |
| `BING_SITE_VERIFICATION` | Bing Webmaster `msvalidate.01` değeri | `src/lib/site.ts`, `src/app/layout.tsx` |
| `YANDEX_SITE_VERIFICATION` | Yandex Webmaster meta değeri | `src/lib/site.ts`, `src/app/layout.tsx` |
| `INDEXNOW_KEY` | IndexNow anahtarı (8–128 karakter); `/<anahtar>.txt` ile sunulur. Yerelde tanımlanmaz | `src/modules/seo/indexnow.ts`, `src/app/api/indexnow/[key]/route.ts` |
| `INDEXNOW_MAX_URLS` | Günlük adres bütçesi (varsayılan 50.000, 0 = sınırsız) | `scripts/indexnow.ts` |
| `SITEMAP_WARMUP_INTERVAL_MS` | Site haritası ısıtma aralığı (varsayılan 3 saat, 6 saatin altında kalmalı) | `src/modules/seo/sitemap-warmup.ts` |
| `GA4_MEASUREMENT_ID` | GA4 ölçüm kimliği (`G-…`); boş ya da biçimsiz ise etiket yüklenmez ve çerez bandı "analiz kullanılmıyor" der. Yöneticiler ölçülmez | `src/modules/analytics/config.ts`, `src/components/privacy/store-tags.tsx` |
| `GOOGLE_ADS_ID` | Google Ads kimliği (`AW-` + en az 6 rakam); yalnız reklam çerezi rızasıyla yüklenir. Boş ya da biçimsizse etiket yok (#676) | `src/modules/analytics/config.ts`, `src/modules/analytics/track.ts` |
| `GOOGLE_ADS_PURCHASE_LABEL` | Satın alma dönüşümünün etiketi (harf, rakam, `_`, `-`; en az 6); yalnız `GOOGLE_ADS_ID` ile anlamlıdır. Boşsa Google Ads'e dönüşüm gitmez | `src/modules/analytics/config.ts`, `src/modules/analytics/ads.ts` |
| `META_PIXEL_ID` | Meta Pixel kimliği (10–20 rakam); yalnız reklam çerezi rızasıyla yüklenir. Boş ya da biçimsizse etiket yok | `src/modules/analytics/config.ts`, `src/modules/analytics/track.ts` |

Ürün beslemesi (#643) yeni değişken istemez: `SITE_URL` (açıkça verilmeli), `APP_ENV` ve `S3_BUCKET` / `S3_REGION` kullanır. Ayrıntılar: [merchant-feed.md](merchant-feed.md). Google Ads ve Meta Pixel (#676) yalnız reklam çerezi rızasıyla ve yukarıdaki değişkenler doluysa yüklenir; değişkenler, bu kodu taşıyan sürüm ve güncel çerez politikası (Google Ads ve Meta Pixel paragrafı) canlıdayken app görev tanımına eklenir. Ayrıntılar: [commerce.md](commerce.md#ölçüm).

### 1.2.1 Yeni rehber yazısı ekleme (#646)

1. `src/content/guides/index.ts` içindeki `guides` listesine kayıt ekle: `slug` (küçük harf, tire), `title`, `description`, `answer` (2–3 cümle, en çok 400 karakter), `published`/`updated` (YYYY-MM-DD), `categories` (`legacyCategoryIds` anahtarları), `sources` (en az bir; teknik iddia kaynaksız yazılmaz), isteğe bağlı `related`.
2. Gövdeyi `src/content/guides/bodies.tsx` içine aynı slug'la bir bileşen olarak ekle: H1 yok, soru biçiminde `<h2>`, tablolar `<div tabIndex={0} role="region" aria-label="Tablo" className="overflow-x-auto">` içinde düz `<table>`.
3. Kuralları `npm run test:guides` denetler; site haritası ve `llms.txt` listeden otomatik beslenir. İçeriği değiştirince `updated` tarihini güncelle.
4. Şirket olgusu (kuruluş yılı, personel, fatura türü, kargo firması, ücret) yalnızca depodaki kaynaklardan yazılır; yazar adı yerine Getirbakim ekibi gösterilir, `reviewedBy` onaylı bir gözden geçiren olana kadar boş kalır.

## 2. Yayın günü kontrol listesi

Sıra: önce hesaplar ve doğrulama değerleri hazırlanır (DNS'ten önce yapılabilir), DNS geçişinden sonra doğrulama ve gönderim yapılır. DNS geçişinin kendisi: [aws-cutover.md](aws-cutover.md).

**DNS'ten önce**

- [ ] Search Console **alan adı mülkü** (`getirbakim.com`, DNS TXT) açılır; TXT kaydı Cloudflare zone'una eklenir (ACM ve SES DKIM CNAME'lerine dokunulmaz). Meta etiket yedeği için `GOOGLE_SITE_VERIFICATION` app görev tanımına.
- [ ] Bing Webmaster hesabı açılır; `BING_SITE_VERIFICATION` app görev tanımına (Search Console'dan içe aktarma da kullanılabilir).
- [ ] Yandex Webmaster hesabı açılır; `YANDEX_SITE_VERIFICATION` app görev tanımına.
- [ ] `INDEXNOW_KEY` üretilir (`openssl rand -hex 16`), `app` ve `operations` görevlerine secret olarak verilir; `operations`'ta `APP_ENV=production` ve `SITE_URL` bulunur. İlk koşu stratejisi (`--seed` / `--limit=0` / damla damla): [indexnow.md](indexnow.md).
- [ ] GA4 mülkü ve Google Ads hesabı açılır. **#749 engelleyicisi:** çerez politikasına satın alma ve sipariş değeri ölçümü metni (#749) canlıya çıkmadan `GA4_MEASUREMENT_ID` prod'da **etkinleştirilmez**; değişken boş kalır.
- [ ] Merchant Center hesabı açılır, alan adı doğrulanır ve talep edilir; kargo ve iade ayarları hesapta girilir ([merchant-feed.md](merchant-feed.md#merchant-center-kurulumu-kullanıcı)). Sipariş modu "Kayıtlı veriler" (snapshot) iken besleme bilerek boştur.
- [ ] Meta Events Manager'da "Automatic Advanced Matching" ve Google Ads'te "Enhanced conversions" **kapalı** kalır (açılırsa etiketler kod değişmeden formlardan karma e-posta/telefon toplar; çerez politikası e-posta gönderilmediğini söyler).
- [ ] `GOOGLE_ADS_ID` / `GOOGLE_ADS_PURCHASE_LABEL` / `META_PIXEL_ID` rıza sürümü 3'ü getiren sürümle birlikte tanımlanır; daha sonra açılırlarsa o sürümde `CONSENT_VERSION` artırılır (4), böylece hizmet yokken seçim yapmış ziyaretçilere yeniden sorulur.
- [ ] Meta Business hesabı açılır, Pixel oluşturulur; `META_PIXEL_ID` (ve Google Ads için `GOOGLE_ADS_ID`, `GOOGLE_ADS_PURCHASE_LABEL`) app görev tanımına, #676 sürümü ve çerez politikası canlıdayken eklenir.
- [ ] Google İşletme Profili (Kartal Oto Sanayi Sitesi adresi, telefon, çalışma saatleri) doğrulama kartı/aramasıyla açılır; adres ve telefon `Organization` verisi ile (`src/lib/site.ts`) aynı olmalı.

**DNS geçişinden sonra**

- [ ] `curl -sI http://getirbakim.com/`, `https://www.getirbakim.com/`, `http://www.getirbakim.com/` her biri **tek adımda** `301` ile `https://getirbakim.com/` adresine gider (zincir yok).
- [ ] `curl -s https://getirbakim.com/robots.txt`: `Disallow: /` yok, `Sitemap: https://getirbakim.com/sitemap.xml` var, `APP_ENV` staging değil. `curl -sI https://getirbakim.com/llms.txt` → 200 `text/plain`.
- [ ] `https://getirbakim.com/sitemap.xml` 70 dosya (6 sabit + 64 ürün) listeler; `products-00.xml` gerçek ürün adresi döner (boş değil).
- [ ] Eski adres örnekleri tek adım `301`: `/automakers`, `/car-parts/bmw`, `/katalog?category=fren-diskleri-269`. Bilinmeyen adres ve geçersiz ürün id gerçek `404` (ve `200` "soft 404" değil).
- [ ] Zengin sonuç testi (search.google.com/test/rich-results) ve Schema Markup Validator: bir ürün (Offer: fiyat, stok, iade), bir kategori (`BreadcrumbList`, `CollectionPage`), ana sayfa (`Organization`).
- [ ] Search Console: `https://getirbakim.com/sitemap.xml` gönderilir; "URL denetimi" ile ana sayfa, bir kategori, bir model, bir ürün ve bir üretici sayfası denetlenip dizine eklenmesi istenir. Bing ve Yandex'e de aynı site haritası gönderilir.
- [ ] Ürün beslemesi (#643): `operations` görevinde `--dry-run` sayaçları, sonra gerçek koşu; `curl -sI https://getirbakim.com/feeds/google.xml.gz` → `200 application/gzip`, `Set-Cookie` yok; adres Merchant Center'a zamanlanmış getirme olarak verilir.
- [ ] IndexNow: `https://getirbakim.com/<anahtar>.txt` anahtarı döndürür; `npm run seo:indexnow -- --dry-run` (operations) sayaçları verir, sonra seçilen ilk yayın modu koşulur.
- [ ] `https://getirbakim.com/api/health` yayınlanan sürümü gösterir ([aws-cutover.md](aws-cutover.md#doğrulama)).
- [ ] GA4 yalnızca #749 metni yayında ve rıza akışı (#644) doğrulandıysa açılır: değişken eklenir, DebugView'da `view_item` ve rıza öncesi isteğin gitmediği (Ağ sekmesi) kontrol edilir.

## 3. AWS gereksinimleri (altyapı ortağı için)

Durum işaretleri: **Var** = repo/belgede doğrulanmış; **İstek** = ortaktan beklenen; **Doğrulanmadı** = repo'da kanıt yok, ortak teyit etmeli.

| Konu | İstek | Durum |
| --- | --- | --- |
| CloudFront önünde alan adı | `getirbakim.com` ve `www`, sertifika iki adı kapsar | Var: 12 Kasım'da `curl --resolve` ile doğrulandı, `www` → `301` apex ([aws-cutover.md](aws-cutover.md)); DNS CloudFront'a henüz çevrilmedi |
| HTTP → HTTPS ve `www` → kök | Her iki yönlendirme **tek adımda** `301`, kalıcı; `http://www` → `https://apex` tek atlamada | `www` → apex var; `http` → `https` ve `http://www` zinciri **Doğrulanmadı** (yayın günü kontrolü §2) |
| `/sitemap*` | `/sitemap.xml` ve `/sitemaps/*` kaynağın `Cache-Control` değerine uyulur (`max-age=3600`); sorgu dizesi, çerez ve `Authorization` önbellek anahtarında yok; CloudFront'ta TTL en çok 1 saat. Çerezli istekte bile aynı yanıt | İstek |
| `/robots.txt` | Kısa TTL (≤ 1 saat), çerez/sorgu anahtarda yok; kaynak staging'te `Disallow: /` döndüğü için üretimde yanlış kaynağa yönlenmediği doğrulanmalı | İstek |
| `/llms.txt` | Kaynak `s-maxage=86400` verir; kaynak başlığına uyulur | İstek |
| `/<indexnow-anahtarı>.txt` | Kaynağa geçirilir (`/api/indexnow/*` rewrite'ı); aşırı önbelleklenmez | İstek |
| Besleme dosyası (Merchant Center / Meta, #643) | `/feeds/google.xml.gz`: kaynağın `max-age=3600` değerine uyulur, çerez/sorgu/`Authorization` anahtarda yok, ek sıkıştırma yok; Merchant Center getirmesi, `Storebot-Google` ve `facebookexternalhit` engellenmez. `operations` rolünde `feeds/*` için `s3:GetObject`/`s3:PutObject`, `app` rolünde `s3:GetObject` ([merchant-feed.md](merchant-feed.md#aws-gereksinimleri-altyapı-ortağı)) | Kod var; CloudFront/IAM **İstek** |
| Statik varlıklar | `/_next/static/*` değişmez içerik (`immutable`, Next varsayılanı). `/media/*` ve `/brand/*`: `max-age=86400, s-maxage=604800` (`next.config.ts`). `/api/product-media/*` ve `/api/category-media/*`: kendi route'ları `public, max-age=86400` verir, `s-maxage` yok, yani CloudFront TTL'i `max-age`'i izler (ETag var). `/api/vehicle-media/*`: sürümlüyse `max-age=31536000, immutable`, değilse `max-age=86400`. `/api/categories`: `max-age=300, s-maxage=3600` (`src/app/api/categories/route.ts`). `/api/product-fitments/[id]?v=<sürüm>`: sürüm sayfanınkiyle eşleşirse `max-age=86400, s-maxage=604800, stale-while-revalidate=604800`, eşleşmez veya yoksa `max-age=300`, `404` `max-age=60`, `500` `no-store`; sorgu dizesi (`v`) önbellek anahtarında olmalı. `/_next/image` önbelleğe alınabilir. Yanıtın `Set-Cookie` taşımaması `/api/categories*`, `/api/category-media/*`, `/api/product-media/*`, `/api/product-fitments/*` için güvence altındadır (`src/proxy.ts` bu yolları atlar); `/api/vehicle-media/*` ve `/api/manufacturer-logos/*` bu güvencenin **dışındadır**, önbellek politikasında çerez/`Set-Cookie` yine de anahtara ve önbelleğe alınmamalıdır | Başlıklar kodda var; CloudFront davranışları **Doğrulanmadı** |
| HTML sayfaları | Kaynak başlığına uyulur; önbelleğe alma kararı (şimdilik "önbelleksiz" bırakılırsa) açıkça yazılır; oturum çerezli istek (`gb_session`) kişisel içerik taşır, paylaşımlı önbelleğe girmez | İstek |
| Sıkıştırma ve HTTP/3 | Brotli (+ gzip) ve HTTP/3 etkin. Kodda `compress: true` kaynağı sıkıştırır (CloudFront "caching disabled" politikası sıkıştırmaz, #453); önbelleğe alınan yollarda CloudFront sıkıştırması ve politikada `Accept-Encoding` kabulü | Kaynak sıkıştırması var; CloudFront Brotli/HTTP/3 **Doğrulanmadı** |
| WAF | Doğrulanmış arama ve yapay zekâ botlarına izin (Googlebot, Bingbot, YandexBot, Applebot, `OAI-SearchBot`, `GPTBot`, `ClaudeBot`, `PerplexityBot`… yayıncı belgelerindeki ters DNS/IP doğrulamasıyla, yalnız UA'ya güvenmeden); kötü botlara ve kazıyıcılara hız sınırı (özellikle `/katalog?q=`, `/api/*`, giriş); AWS yönetilen bot kontrolünün doğrulanmış botları engellemediği izlenir. Yanlış engel yayın günü indekslemeyi durdurur | İstek |
| Günlükler | CloudFront standart günlükleri S3'e; Athena tablosu ve "bot tarama raporu" sorgusu (UA'ya göre istek, durum kodu, URL grubu, günlük) | İstek |
| Zamanlanmış operations görevi | IndexNow: EventBridge `getirbakim-production-indexnow`, günde bir 06:30 Europe/Istanbul, komut `node --conditions=react-server --import tsx scripts/indexnow.ts`, çıkış 1 = alarm; `INDEXNOW_KEY`, `APP_ENV=production`, `SITE_URL` görevde. Besleme üretimi (#643): aynı görev tanımında günde 4 kez `node --conditions=react-server --import tsx scripts/merchant-feed.ts`, çıkış 1 = alarm ([merchant-feed.md](merchant-feed.md)). Site haritası ısıtması uygulama içindedir, ayrı görev gerekmez | Zamanlayıcı [indexnow.md](indexnow.md#aws-gereksinimleri) belgesinde istendi; kurulduğu **Doğrulanmadı** |
| Hata sayfaları | `404` `404`, `5xx` `5xx` kalmalı; CloudFront özel hata sayfaları (ör. 404 → `200` ana sayfa) tanımlanmaz; bakım sayfası `503` (+ `Retry-After`) döner, `200` değil | İstek (uygulama `notFound()` ile gerçek `404` verir) |
| Çıkış | `api.indexnow.org:443` doğrudan (tedarikçi proxy'si kullanılmaz) | İstek |

## 4. Yayın sonrası izleme

Haftalık (sahibi: pazarlama + geliştirici; bulgular Issue olarak açılır):

- **Search Console** — Sayfa dizinleme: dizine alınan sayfa sayısı, "Bulundu, dizine eklenmedi", "Taranmış, dizine eklenmedi", `noindex` ve "robots.txt tarafından engellendi" nedenleri; site haritası başına gönderilen/dizine alınan oranı (`products-NN.xml` ayrı izlenir); Core Web Vitals (mobil ve masaüstü: LCP, INP, CLS); Tarama istatistikleri (ana makine durumu, yanıt süresi, 5xx); manuel işlem/güvenlik sorunları; Arama performansı (model, kategori, üretici ve ürün sayfaları ayrı filtrelerle).
- **Bing/Yandex Webmaster** — dizinleme ve IndexNow gönderim durumu.
- **Bot günlükleri (Athena)** — Googlebot/Bingbot/yapay zekâ botları için istek sayısı, `4xx`/`5xx` oranı, en çok taranan adres grupları; parametreli liste adreslerine ve `/api/` yollarına tarama bütçesi akıyor mu; WAF'ın doğrulanmış bota verdiği engeller.
- **IndexNow koşuları** — `indexnow_runs` tablosu: `completed|partial|failed`; `failed` alarmdır.
- **Zengin sonuç raporları** (Search Console → Geliştirilmiş: Ürün satıcı listesi, Kırıntı) ve Merchant Center tanılamaları (besleme sonrası).

Dizinlenen sayfa hedefleri (yerel ölçüm 15 Kas 2026'ya göre; ürün ölçütü `indexing.ts` açıklamasında): site haritasında 536.560 (kod yorumundaki yerel ölçüm, `src/modules/seo/indexing.ts`; 15 Kas 2026) tedarikçi ürünü + mağaza ürünleri, 6 sabit parça. Dizine alınan sayfa sayısı için ilk hedefler, **öneri olarak** ve ilk iki haftanın gerçek verisiyle yeniden ayarlanır:

| Gün | Hedef |
| --- | --- |
| 7 | Tüm site haritaları "Başarılı"; sabit, kategori, marka, model sayfalarının %80'i dizinde; sitemap'ten şikâyet (hata/uyarı) 0 |
| 30 | Model + model × kategori + üretici sayfalarının %80'i dizinde; ürünlerin ilk %10'u (~50 bin) dizinde |
| 90 | Ürünlerin %50'si dizinde; "Taranmış, dizine eklenmedi" payı düşüş eğiliminde |

Eşikler: Core Web Vitals "iyi" oranı mobilde ≥ %75 (#642 açık iş); tarama `5xx` oranı < %1; haftalık dizine alınan sayfa artışı iki hafta üst üste düşerse inceleme açılır.

## 5. Açık işler ve ilgili belgeler

- Açık iş kalemleri: #642 (HTML ağırlığı, Core Web Vitals), #646 (rehber/SSS), #676 (Ads + Pixel), #749 (çerez politikası ölçüm metni).
- [launch-roadmap.md](launch-roadmap.md) — lansman kabul listesi ve adres düzeni.
- [aws-cutover.md](aws-cutover.md) — geçiş günü ve DNS.
- [indexnow.md](indexnow.md) — IndexNow çalışma ve AWS ayrıntıları.
