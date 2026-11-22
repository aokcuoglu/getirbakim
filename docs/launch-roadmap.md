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
- [ ] Search Console hesabında doğrulama, Merchant Center ve ölçüm hesabı kurulmuş (adımlar: [seo-geo.md](seo-geo.md#2-yayın-günü-kontrol-listesi)).
- [ ] Reklam, ürün ve ödeme fiyatı/stoku aynı; reklam sadece satışa hazır ürünlerde.

`SITE_URL` kanonik alan adını, `GOOGLE_SITE_VERIFICATION` Search Console, `BING_SITE_VERIFICATION` Bing Webmaster, `YANDEX_SITE_VERIFICATION` Yandex Webmaster meta doğrulama değerini alır (boşsa etiket basılmaz). Sitemap sentetik demo ürünlerini dışarıda bırakır; tedarikçi hazırlık sayfaları noindex alır. Product JSON-LD (`src/modules/seo/structured-data.ts`) Offer'ı yalnız sayfanın kendi bireysel KDV dahil fiyatı ve kesin stok durumu (stokta / "Stokta yok") varken basar; fiyatsız, tedarik edilemeyen veya stok durumu belirsiz üründe Offer yoktur, B2B fiyatı hiç girmez. İade (14 gün, ücretsiz) hukuki metinden gelir. Puan/yorum basılmaz; kargo ayrıntısı (`shippingDetails`) ücret ve teslim süresi onayını bekliyor. Ürün, liste (CollectionPage/ItemList) ve sayfa kırıntıları BreadcrumbList taşır. gerçek ürün fotoğrafı ve doğrulanmış Offer eklenmeden zengin ürün sonucu veya Merchant Center uygunluğu iddia edilmez. Katalog filtre/arama sayfaları canonical ve noindex kurallarıyla yönetilir.

Ürün sayfası dizin politikası (#641, tek kaynak `src/modules/seo/indexing.ts`; site haritası aynı ölçütü SQL'de uygular ve `npm run test:sitemap` ikisini eşit tutar): tedarikçi ürünü yalnız asgari içerikle dizine açıktır; ad, marka ve parça numarası dışında en az biri gerekir: kod ve markası eşleşen zenginleştirme, tedarikçi açıklamasından çıkarılmış uyumlu araç modeli (ürünün ya da gruptaki tekliflerinin), yöneticinin gizlemediği tedarikçi OEM numarası veya yöneticinin yazdığı ya da eklediği içerik (#664). Yönetici içeriği olarak sayılanlar: ad, açıklama ya da kısa açıklama, yüklenen görsel, belirlenen teknik özellik, eklenen OEM / muadil / barkod numarası ve eklenen araç. Sayılmayanlar: SEO başlığı ve açıklaması, kategori, marka, parça numarası, fiyat, ürünü gizleme ve her gizleme / kaldırma kararı (özellik, numara, araç, otomatik görsel, tedarikçi OEM'i); bunlar yeni bir olgu eklemez. Site haritasının `lastmod` değeri ve IndexNow parmak izi yönetici düzenleme zamanını henüz içermez (ayrı iş). Mağaza ürünleri dizine açıktır; demo ürünleri dizine kapalıdır. Ölçüt dışı kalan sayfalar `noindex,follow` ile erişilebilir kalır ve sinyal kazanınca kendiliğinden dizine girer. Stok ölçüte girmez (30 dakikalık senkronla değişir, site haritasını çalkalar). Yerel ölçüm (2026-11-15, listelenen 773.118 tedarikçi satırı): yalnız zenginleştirme 80.207 (%10,4), zenginleştirme veya açıklamadan uyumluluk ~353 bin (%45,6), seçilen ölçüt (artı tedarikçi OEM'i) 536.560 (%69,4); hiçbir sinyali olmayan ~236,5 bin sayfa dizin dışında. Tedarik edilemeyen kart (hiçbir tedarikçi şu an satmıyor) 200 döner, "Şu an tedarik edilemiyor" yazar, `noindex,follow` alır, site haritasında yer almaz ve JSON-LD'de Offer basmaz; fiyatı olmayan ürün de Offer basmaz. Geçersiz/bilinmeyen id, yöneticinin gizlediği ve kanonik karşılığı olmayan satır gerçek 404 döner; ikincil teklif ve düşmüş mükerrer satır 307 ile birincil/kanonik sayfaya yönlenir. 410 ve "kalıcı kalkmış" tanımı henüz yok.

## Adres düzeni

SEO/GEO el kitabı (yapılandırılmış veri, robots, site haritası, ortam değişkenleri, yayın günü listesi, AWS gereksinimleri, izleme): [seo-geo.md](seo-geo.md).

Liste sayfalarının adresleri Türkçe ve yol tabanlıdır (#638); tek kaynak `src/modules/seo/paths.ts`. Kategori slug'ı sayısal son ekini (`fren-diskleri-269`) korur.

| Sayfa | Adres | Not |
| --- | --- | --- |
| Tüm ürünler ve arama | `/katalog`, `/katalog?q=…` | Arama ve süzgeçli adresler `noindex,follow` |
| Araç markaları | `/arac-markalari` | |
| Araç markası | `/yedek-parca/<marka>` | |
| Kategori | `/kategori/<kategori>` | Kök "Yedek parçalar" (`/kategori/yedek-parca`) `noindex,follow` ve site haritası dışı; "yedek parça" sorgusu için dizine açık sayfa `/katalog` (#1222) |
| Kategori × araç markası | `/kategori/<kategori>/<marka>` | #673: ürünsüz `404`, 10 üründen azı `noindex,follow` (model sayfasıyla aynı eşik) |
| Ürün | `/urun/<marka>-<ad>-<parça-no>-<id>` | #640; tek kaynak `src/modules/seo/product-path.ts` (`productPath`). Slug ASCII'dir ve yalnız okunur; ürünü sondaki 36 karakterlik kimlik bulur (`product-id.ts`). Slug boş kalırsa adres `/urun/<id>` |
| Araç modeli | `/yedek-parca/<marka>/<model>` | #639: model ailesi + nesil (`golf-7`, `passat-b8`, `tipo-356`, `3-e90`); ürünsüz model `404`, 10 üründen azı `noindex,follow` (`minIndexableListingProducts`); dizine açık olanlar site haritasında `/sitemaps/models.xml` (#673); sitemap verisi 6 saat sonra bayatlar (bayat okuma eski veriyi döner, yenilemeyi arka planda başlatır) ve 12 saatte düşer; sunucu başlangıçta (0-60 sn rastgele gecikmeyle) ve her 3 saatte bir dosyaları kendisi ısıtır (#778, `sitemap-warmup.ts`; veri en çok ~9 saat eski olur, aralık TTL − revalidate = 6 saatin altında kalmalı), süre ölçümü yerelde `npm run seo:sitemap-timings`, AWS operations görevinde `node --conditions=react-server --import tsx scripts/sitemap-model-timings.ts --explain` (`.env.local` yok) |
| Model × kategori | `/kategori/<kategori>/<marka>/<model>` | #673: modelin o kategori ve alt kategorilerindeki ürünleri; ürünsüz `404`, 10 üründen azı `noindex,follow`; kök "Yedek parçalar" × marka/model sayfası marka/model sayfasını tekrarladığı için her zaman `noindex,follow` ve site haritası dışı (200 döner). Marka ve model sayfaları (kart, kenar çubuğu, kategori araması) yalnız ürünü olan kategorileri bağlar (`scopeCategoryCounts`); dizine açık olanlar `/sitemaps/model-categories.xml`'de (`src/modules/seo/sitemap-models.server.ts`, `npm run test:vehicle-model-listing` sayfa kuralıyla eşit tutar) |
| Üretici | `/marka/<uretici>` | #660 için ayrıldı; bugün `/katalog?brand=` |

Ürün adresleri (#640): çıplak kimlik, bayat slug ya da büyük harfli kimlik sayfada tek adımda `308` ile güncel adrese gider; ikincil teklifin kimliği (`primaryId`) doğrudan birincil ürünün slug'lı adresine `307` ile gider (eşleştirme yenilenince değişebilir, kalıcılanmaz). Sorgu dizgesi (`utm_*`, `gclid`) her iki yönlendirmede korunur. `/yonetim` bağlantıları çıplak kimlik kullanır (`productIdPath`) ve bu yönlendirmelerden geçer.

Eski adresler tek adımda `301` ile taşınır (`src/proxy.ts`): `/automakers` → `/arac-markalari`, `/car-parts/<marka>` → `/yedek-parca/<marka>`, `/car-parts/<marka>?category=<k>` → `/kategori/<k>/<marka>`, `/katalog?category=<k>` → `/kategori/<k>`; diğer sorgu parametreleri korunur. Bilinmeyen kategori, marka veya model `404` döner.

Model sayfası birimi (#639) bir markanın bir model ailesi ve nesli, tüm kasa tipleriyle birlikte: TecDoc'ta kasa başına ayrı seri olan `GOLF VII`, `GOLF VII Variant`, `GOLF VII Van` tek sayfa (`golf-7`). Slug kuralı ve sabitlenen adresler `src/modules/store/vehicle-model-groups.ts` ve `scripts/test-vehicle-model-groups.ts` içinde; yerel katalogda 5.767 seri 4.372 birim, slug çakışması yok. Liste model düzeyindedir: motor düzeyi uyumluluk (`storefront_model_fits`) ile tedarikçi açıklamasından okunan model (`product_model_fitments`) birleşir; sayfa bunu söyler ve motor tipine göre doğrulama için garaj seçicisini sunar. Marka sayfası ürünü olan modelleri aile → nesil listesiyle bağlar; #674 ile marka listesi açıklamadan okunan modelleri de içerir, motosikletler ayrı bölümdedir, ürün sayfası uyumlu modelleri model sayfasına bağlar ve Türkiye pazar adları (Egea…) etikette görünür. CDN veya bakım modunda yola bağlı kural varsa yeni önekler (`/kategori/*`, `/yedek-parca/*`, `/arac-markalari`) eklenmelidir.

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
