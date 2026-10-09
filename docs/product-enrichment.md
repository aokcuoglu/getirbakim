# Ürün zenginleştirme ve yerel S3 deposu

OrbStack projesi: `getirbakim`. `deploy/storage.compose.yml`, MinIO ve bucket kurulum servisini içerir. Çalışan uygulamanın mevcut PostgreSQL bağlantısı korunur; bu dosya ikinci bir PostgreSQL başlatmaz. `product-media` Docker volume’u dosyaları yeniden başlatmalar arasında korur.

- S3 API: http://localhost:9002
- MinIO konsolu: http://localhost:9003
- Bucket: `product-media`, özel erişim
- Konsol hesabı: `.local/storage.env` içindeki `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD`
- Uygulama hesabı: yalnızca bu bucket için listeleme, okuma ve yazma yetkisi. Kök hesap uygulamada kullanılmaz.
- Dosya adresi: `/api/product-media/<uuid>`. Sunucu MinIO’dan okur; tarayıcıya S3 kimlik bilgileri gitmez.

## Kurulum ve kullanım

```sh
npm run storage:setup
npm run enrichment:prepare
npm run enrichment:import -- artifacts/trodo-sample/enrichment-import.json
npm run enrichment:import -- artifacts/trodo-sample/partial-enrichment-import.json
npm run enrichment:status
npm run enrichment:probe
node --import tsx --test scripts/test-product-enrichment.ts
```

`storage:setup` yerel gizli değişkenleri üretir ve `.env.local` dosyasına S3 bağlantısını ekler. Tekrar çalıştırıldığında aynı kimlik bilgilerini ve volume’u kullanır. Mevcut OrbStack konteynerlerini kaldırmaz. `createbuckets` tek seferlik kurulum işidir; MinIO sürekli çalışır.

`enrichment:prepare` şemayı oluşturur ve `supplier_items` kayıtlarını takip tablosuna ekler. Tekrar çalıştırılması tamamlanan kayıtları sıfırlamaz. Bu **kuyruk hazırlığıdır**; bekleyen ürünlerin kaynaktan çekildiği anlamına gelmez. Yeni tedarikçi kayıtları geldikten sonra yeniden çalıştırılabilir.

## Veriler

- `product_enrichments`: ürün kimliği, eşleştirilen tedarikçi marka/kodu, kaynak URL/yöntem, üretici parça kodu ve JSONB özellikler/OEM/muadil/araç verileri.
- `product_media_objects`: bucket, nesne anahtarı, SHA-256, MIME türü, dosya boyutu ve kaynak URL.
- `product_enrichment_jobs`: bekleyen, tamamlanan, kısmi, bulunamayan, inceleme gerektiren veya hata alan kayıtların takibi.
- `product_enrichment_sources`: kaynak erişim denemelerinin HTTP sonucu ve zamanı.

`supplier_items.product_data`, fiyat ve stok verileri değiştirilmez. Tedarikçi senkronizasyonu zenginleştirme verisini silmez. Tedarikçi marka/kodu değişirse eski eşleşme ürün sayfasında kullanılmaz.

Eklenen OEM numaraları katalog aramasında da kullanılır. Kısmi bir paket tamamlanmış bir kaydın üzerine yazılamaz.

İçe aktarma JSON’u tek kayıt veya kayıt dizisi olabilir. Tam örnek formatı `artifacts/trodo-sample/enrichment-import.json` içindedir. Görsel yolu çalışma dizinine göre çözülür. Görseller en fazla 10 MB; içerik imzası WebP/JPEG/PNG olarak doğrulanır. Nesne anahtarında SHA-256 kullanılır; aynı dosya birden çok kez depolanmaz. MinIO yazımı ve HEAD doğrulamasından sonra veritabanı kaydı tamamlanır. Veritabanı işlemi başarısız olursa depoda referansı olmayan bir nesne kalabilir; kullanıcıya yayımlanmaz.

Marka ve üretici parça kodu birlikte doğrulanır. Tedarikçi önekleri yalnızca açıkça tanımlı markalarda çıkarılır. Sadece OEM eşleşmesi farklı markalı ürünün görselini, özelliklerini veya araç listesini aktarmak için yeterli değildir. OEM ve muadil parça kodları ayrı alanlardır.

## Toplu çekmenin mevcut durumu

Trodo, doğrudan ürün ve robots isteklerine HTTP 403 döndürüyor. `enrichment:probe` bu durumu kaydeder, çıkış kodu 2 ile durur ve bekleyen ürünleri “bulunamadı” diye işaretlemez. Şu an çalışan bir toplu Trodo tarayıcısı veya arka plan worker’ı yoktur. Bu nedenle kuyruk otomatik ilerlemez.

DEPO ve LuK kayıtları tarayıcı üzerinden doğrulanmıştır. LuK kaydı Zen Browser geliştirici konsolundaki ürün/OEM bileşenlerinden, açılmış üç araç modelindeki 19 motor satırından ve tarayıcıyla kaydedilen 1440 piksel görselden tamamlanmıştır. Kaynakta `0/0` olan bitiş tarihleri `null` saklanır. FEBI pilot kaydı hâlâ arama indeksinden gelen kısmi veridir; görsel ve motor ayrıntıları doğrulanmamıştır.

### Zen Browser konsolundan dışa aktarma

Ürün sayfasında F12 → Console açıp `scripts/trodo-console-export.js` içeriğini çalıştırın. Bu betik yalnızca herkese açık ürün bileşenlerini JSON dosyasına indirir; hesap veya oturum durumunu okumaz. Ürün özellikleri, OEM/muadil ayrımındaki kaynak işaretleri ve araç ağacı tek işlemde alınır. Betik Trodo'nun mevcut Vue bileşen yapısına bağlıdır; site değişirse yeniden doğrulanmalıdır.

Motor satırları sayfada ilgili model açıldığında yüklenebilir. Bu nedenle JSON dışa aktarmak tek başına tüm araçların alındığı anlamına gelmez: model gruplarını açıp motor kapsamını doğrulayın. Görsel ayrı kaydedilir; kaynak JSON, tedarikçi marka/parça kodu doğrulamasıyla normalleştirildikten sonra `enrichment:import` üzerinden PostgreSQL/MinIO'ya alınır. Bu araç henüz toplu tarayıcı worker'ı değildir.

Tüm ürünleri işlemek için erişilebilir bir ürün veri kaynağı (ör. sağlayıcı dışa aktarımı/API) ve doğrulanmış bir adaptör gerekir. İçe aktarma aracı bu kaynaklardan hazırlanmış aynı JSON formatını kabul eder. Yönetim takibi: `/yonetim/urun-verileri` (yönetici girişi gerekir).

### 100 ürünlük Zen pilotu — 03.10.2026

Bekleyen kayıtlardan marka filtresi olmadan, sabit tohumla 100 ürün seçildi (37 marka). Manifest, ham sonuçlar, çalıştırılan konsol kodları ve ölçüm raporu `artifacts/trodo-pilot-100/` altında saklanır. Hazırlık ve elenen önek hata ayıklama koşusu ölçüm sürelerine dahil değildir.

Zen'den yapılan normal aynı kaynak istekleriyle Trodo'nun arama, ürün ve görünüm uçları okunabildi. Arama + eşleşen ürünlerin temel/OEM verileri 126.198 ms sürdü: 24 kesin marka/parça eşleşmesi, 43 inceleme, 33 bu sorguda sonuç bulunamayan kayıt. Farklı üreticilerin OEM eşleşmeleri otomatik aktarılmadı. 24 görsel ayrı CDN oturumunda 29.539 ms'de, toplam 4.031.848 bayt olarak indirildi.

Araç aşamasında iki işçi ve istek başına 150 ms bekleme kullanıldı. 44.008 ms içinde 245 istek yapıldı; 243 başarılı yanıt alındı. Beş ürün tamamlandı, iki ürün HTTP 429 nedeniyle yarım kaldı ve kalan 17 araç sorgusu başlatılmadı. Önceki keşif/hata ayıklama istekleri de hız sınırına katkıda bulunmuş olabilir; bu ölçüm güvenli sürekli istek hızını belirlemez. Kaynak sınırı aşılmaya veya engel atlatılmaya çalışılmadı.

Sonuçta beş ürün `complete`, 19 ürün `partial` olarak PostgreSQL/MinIO'ya aktarıldı; 171 OEM referansı ve 607 motor satırı kaydedildi. 24 sayfa ve görsel SHA-256 ile doğrulandı. Tam araç listesi alınamayan ürünler kısmi bilgi gösterir. Diğer 76 kaydın iş durumu güncellendi. `not_found`, tek sorgunun sonucunu ifade eder; kaynakta kesinlikle bulunamayacağı anlamına gelmez.

Başarılı kaynak yanıtları `product_enrichment_vehicle_cache` tablosunda kaynak host/yoluna göre saklanır. Gelecek bir worker bu önbelleği kullanmalı, süre aşımı/429 yanıtında geri çekilmeli ve kaldığı yerden devam etmelidir. Arşivlenen konsol kodları ölçüm sırasında kullanılan parametreleri içerir; kalıcı üretim worker'ı değildir. Temel veri hızı, tam zenginleştirmenin toplam süresi olarak kullanılamaz.

## Yedekleme

PostgreSQL yedeğiyle birlikte `getirbakim_product-media` volume’unu ve `.local/storage.env` dosyasını yedekleyin. Veritabanı yedeği tek başına görselleri içermez. `docker compose down` dosyaları korur; `down -v` volume’u siler. Konsol ve API portları yalnızca yerel makineye bağlanır.

## Ürün–araç kataloğu bağlantıları

`product_vehicle_fitments`, kaynak araç satırını `supplier_item_id` ve `source_index` ile saklar. Eşleşen satırdaki `vehicle_type_id`, gerçek `vehicle_types.id` kaydına foreign key ile bağlıdır; marka ve model `vehicle_types → vehicle_models → vehicle_brands` ilişkisi üzerinden okunur. Aynı araç farklı ürünlere bağlanabilir. Kaynak motor kodları ve diğer ham değerler `source_vehicle` içinde korunur.

```sh
npm run fitment:rebuild
npm run test:fitment
npm run verify:fitment
```

`fitment:rebuild` tabloyu idempotent biçimde kurar ve mevcut tüm ürünleri aynı transaction içinde yeniden eşleştirir. Ürün veya kaynak verisini değiştirmez. `enrichment:prepare` de bağlantı tablosunu hazırlar. Kurulumdan sonra `enrichment:import` her ürünün kaynak verisini ve bağlantılarını aynı transaction içinde günceller. Eski araç satırları kaldırılır; tekrar aktarım çoğaltma yapmaz. `db:vehicles` de araç kataloğunu güncellediğinde kurulu ürün bağlantılarını yeniden hesaplar. Ürün ve araç aktarımları ortak advisory lock sırasıyla çalışır; eşzamanlı işlemler kısa süre sıraya girer.

`strict-v1`: büyük/küçük harf, aksan, boşluk ve katalog marka gösterim adı farkları normalize edilir. Model/kasa, motor adı, yakıt, cm³, PS/hp, kW ve üretim başlangıç/bitiş ayları birlikte eşleşmelidir. Motor adı kaynak metnindeki motor kodlarından ayrılarak karşılaştırılır; xDrive/4motion gibi uzun varyant adları önceliklidir. Birden fazla aynı aday varsa otomatik bağlantı kurulmaz. Motor kodları katalogda bulunmadığı için ayrıca doğrulanamaz. Bu bağlantı kaynak uyumluluk listesini yerel katalogla ilişkilendirir; üretici onayı anlamına gelmez.

Eşleşmeyen satırlar silinmez: `model_missing`, `attributes_missing`, `dates_differ`, `engine_name_differs` veya `ambiguous` durumuyla saklanır. Tarih farkları, yaklaşık ad eşleştirmeleri ve elle incelenmiş model takma adları otomatik olarak kabul edilmez. Ürün sayfası bağlı satırların marka/model ve teknik değerlerini katalogdan okur; diğer satırları “Kaynak kaydı” olarak gösterir. Kaynak gözlemi artık ürün payload'ıyla aynı değilse eski bağlantı gösterilmez. Garajdaki tip kimliği bağlı listede yer alıyorsa sayfada bu bilgi belirtilir.

Tekrar veri çekerken mevcut `enrichmentImportSchema` formatını kullanın: model adı marka ve kasa koduyla birlikte; motor bilgisi ayrı `engineAndCodes`; `kw`, `ps`, `cc` sayısal; tarihler `MM/YYYY`, bilinmeyen bitiş `null`. Yalnızca model adları bulunan ürünlerde motor/type bağlantısı kurulmaz; ayrıntılı `vehicles` satırları geldiğinde otomatik olarak değerlendirilir.

## Kalıcı pilot işçisi — 04.10.2026

Yeni işçi `scripts/enrichment-worker.ts`, kaynak adaptörü `src/modules/enrichment/` altındadır. Eski konsol dışa aktarımları arşiv örnekleridir; pilot bu betiklerden bağımsız çalışır.

```sh
npm run enrichment:prepare
npm run enrichment:pilot -- 1000 pilot-2026-10-04-v1
npm run enrichment:run -- <run-id>
npm run enrichment:report -- <run-id>
node --env-file=.env.local --conditions=react-server --import tsx scripts/enrichment-worker.ts retry-review <run-id>
npm run test:enrichment-worker
```

Pilot en fazla 1.000 bekleyen ürünü seçer: her tedarikçi markasından en az bir kayıt, geri kalanı sabit tohumlu hash örneklemi. Marka başına garanti nedeniyle saf rastgele örneklem değildir; sonuç yüzdeleri tüm kataloğun başarı oranı olarak yorumlanmaz. Manifest `artifacts/enrichment-pilot-<run-id>/manifest.json` içindedir. Tamamlanmamış koşu varken yeni örneklem açılmaz; aynı koşu devam ettirilir.

`enrichment_runs` koşuyu, `enrichment_run_items` ürünün aşama/checkpoint ve işçi kirasını, `enrichment_source_requests` kaynak isteklerini, `enrichment_source_cache` başarılı yanıtları ve `enrichment_request_events` ölçümleri tutar. PostgreSQL kirası ve `SKIP LOCKED` ile aynı istek aynı anda iki tarayıcıya verilmez. Süresi dolan kira yeni bağlantı tarafından devralınır; eski anahtarla gelen sonuç reddedilir. Koşu başına advisory lock ikinci ürün işçisini engeller. Ürün kimliği aktarma anında tekrar doğrulanır.

Her kaynak hostu için yeni istekler arasında en az 2.500 ms vardır; tüm bağlantılar aynı host sınırını paylaşır. 429 sonrasında hostun istek aralığı iki kat artırılır (en çok 30 saniye); pilot sırasında otomatik hızlandırılmaz. 429/503/ağ hatalarında en az 60, 120, 240 saniyelik bekleme uygulanır; `Retry-After` daha uzunsa o süre korunur. Dördüncü başarısız denemede devre açılır. 401/403 anında devreyi açar. Erişim engeli ürünün `not_found` olmasına yol açmaz: koşu durur ve ürün checkpoint'iyle kuyrukta kalır. Devre durumu `enrichment_source_hosts` içindedir; engel varken farklı tarayıcı/proxy ile otomatik yeniden deneme yapılmaz.

Arama yanıtları 1 gün, ürün/görünüm 7 gün, araç yanıtları 30 gün, görsel/logo 90 gün saklanır. Önceki başarılı araç önbelleği 30 gün içinde yeniden kullanılır. Hata yanıtları önbelleğe alınmaz. Görseller hash ile deduplike edilir ve MinIO HEAD ile doğrulanır. Araç eşleştirici işlem belleğinde tekrar kullanılır; katalog tablolarına yapılan yazımların statement trigger'ları revision artırır ve sonraki aktarma eşleştiriciyi yeniler. Aktarma ve katalog yazımları ortak kilit sırasını korur.

Adaptör önce tam marka/parça eşleşmesini arar. Bulamazsa DB'deki OEM numaralarının tamamını sırayla sorgular. Farklı markalı adayın ürün kimliği tekrar doğrulanır; yalnızca kaynak `oe_numbers` verisindeki `oem=1` satırı tedarikçi OEM numarasıyla tam eşleşirse aktarılır. İlk doğrulanan aday kullanılır; muadil (`oem=0`) satırı veya arama sırası tek başına kanıt sayılmaz. Eşleşme `oem_reference` olarak, OEM numarası ve tedarikçinin mevcut OEM alanıyla kaydedilir; aktarım işlemi DB'deki güncel kimliği/OEM alanını yeniden kontrol eder. Tedarikçi marka/kodu korunur, farklı kaynak markasının logosu tedarikçi markasına yazılmaz. `retry-review` komutu OEM'i bulunan inceleme kayıtlarını mevcut koşuda tekrar kuyruğa alır ve eski checkpoint'i temizler; çalışan işçi varken çalışmaz ve kaynak engelini kaldırmaz. Yeni eklenen kayıtlarla pilot örneklem büyüyebilir; önceki pilot ölçümleriyle doğrudan karşılaştırılmamalıdır. `not_found` yalnızca denenmiş sorguların sonuç vermediğini anlatır. Tüm kaynak araç kimlikleri hesaplanmadan, geçersiz motor satırları varken veya doğrulanmış görsel olmadan ürün `complete` olmaz. Hatalı satırlar ve kapsam sayıları checkpoint'te kalır.

05.10.2026: Kaydedilmiş aynı marka/parça adaylarıyla doğrulanan tedarikçi önekleri (`FILT`, `DAY`, `TX`, `GTS` ve diğerleri) ortak eşleştirme sözleşmesine eklendi. OEM aramasında bulunan aday da kesin marka/parça eşleşmesini sağlıyorsa kullanılabilir. Aynı kaynak ürününün farklı sorgulardaki tekrarları kaynak kimliğiyle birleştirilir; birden fazla farklı kaynak kimliği eşleşirse inceleme sürer. Bu kurallarla pilotta 34 inceleme kaydı checkpoint'leri korunarak yeniden kuyruğa alındı; kanıt `artifacts/enrichment-pilot-f7f3779f-cec0-4f58-a399-61ed97a53bcc/exact-match-recovery.json` içindedir. FILTRON `FILT OE 672/10`, HART alternatifi yerine kendi FILTRON `OE 672/10` kaydıyla eşleşir.

### Tarayıcı bağlantısı

Doğrudan HTTP erişimi engelli olduğu için işçi normal kaynak tarayıcısına ihtiyaç duyar. Yalnızca `127.0.0.1:4318` üzerinde yerel köprü açar. Köprü sadece iki kaynak origin'ine (`www.trodo.com`, `picdn.trodo.com`) CORS izni verir; her istekte çalışma anında oluşturulan geçici bearer anahtarını ve kaynak origin'ini doğrular. Veritabanı/S3 kimlik bilgileri tarayıcıya verilmez. Kaynak görevleri yalnızca tanımlı halka açık ürün/araç/görsel yollarına izin verir; hesap uçları kabul edilmez.

Çalışan işçinin ürettiği `.local/enrichment/browser-start.js` dosyasını her kaynak origin'inin geliştirici konsolunda çalıştırın. Firefox yerel cihaz erişimi için izin isteyebilir; gerekli izin kullanıcı onayıyla yalnızca bu oturumda verilir. Kaynak sekmeleri ve yerel işçi açık kalmalıdır. Sekme kapanırsa yeni istekler bekler; kaynak yanıtları ve ürün checkpoint'leri kaybolmaz. Tarayıcı bağlantısı tam sunucu tarafı gözetimsiz toplayıcı değildir. Sunucuya taşımak için erişilebilir/izinli bir API veya sağlayıcı aktarımı gerekir.

### Chrome sürücüsü (önerilen) — 07.10.2026

```sh
npm run enrichment:run -- <run-id> --chrome
```

İşçi, `.local/enrichment/chrome-profile` profiliyle normal Google Chrome'u `--remote-debugging-port=9222` ile açar (zaten açıksa bağlanır) ve kaynak isteklerini CDP `Runtime.evaluate` ile sekmenin içinden, konsol toplayıcısıyla aynı `fetchSourceJob` koduyla yapar. Yerel köprüye/konsola yapıştırmaya gerek yoktur. Chrome ayrık süreç olarak açılır; işçi yeniden başlasa da oturum ve çerezler korunur. `CHROME_PATH` ve `ENRICHMENT_CHROME_PORT` ile değiştirilebilir.

Gözlenen 403'lerin tamamı `cf-mitigated: challenge` idi (yaklaşık saatte bir tarayıcı doğrulaması), IP engeli değil. Bu yanıt artık devreyi açmaz: istek deneme hakkı harcanmadan kuyruğa döner, host `challenge_since` ile duraklatılır, sürücü sekmeyi siteye yeniden yükler ve sayfa normal görünene kadar bekler. 20 saniyede geçmezse macOS bildirimi gönderilir; Chrome'daki doğrulama kutucuğunu operatör tıklar. Doğrulama sonrası hemen tekrar challenge gelirse 1, 2, 4… (en çok 15) dakika beklenir; 45 dakikada geçilemezse host bloke edilir ve koşu checkpoint'le durur. Hız sınırları, 429 geri çekilmesi ve challenge olmayan 401/403 blokları değişmedi; proxy/parmak izi değiştirme yapılmaz. `enrichment-worker.ts unblock` host bloklarını elle sıfırlar. Konsol modunda betik başlarken `/cleared` ile challenge durumunu temizler.

07.10.2026 akşam denemesi: sürücü açılışta doğrulamayı ~6 saniyede geçti, istekler 10 saniye aralıkla 200 döndü. Yaklaşık 10 dakika sonra arama ucu yeniden `cf-mitigated: challenge` döndürdü. Ana sayfa yüklenebiliyordu, ancak `/rest/V1/catalogsearch/...` sekmede belge olarak açıldığında çözülebilir bir doğrulama yerine Cloudflare blok sayfası ("Sorry, you have been blocked") çıktı; farklı bir sorguda da sonuç aynıydı. Yani XHR'deki challenge başlığı bu durumda gerçek bir engeli gizliyor. Sürücü artık blok sayfasını görünce hostu bloke edip durur. Engel aşılmaya çalışılmadı; `www.trodo.com` blocked, koşu `stopped`, 656 ürün checkpoint'le kuyrukta.

**Düzeltme (aynı akşam):** Blok sayfası, API adresinin sekmede doğrudan belge olarak açılmasıyla ortaya çıkmıştı; site kullanıcıyı engellemiyordu. Asıl mekanizma şu: Trodo'nun arama sayfası `catalogsearch` isteği 403 challenge alınca sayfadaki Turnstile bileşeniyle doğrulamayı kendisi çözüp aynı aramayı tekrar yapıyor ve ikinci istek 200 dönüyor. Bu nedenle sürücü artık ziyaretçi gibi çalışıyor:

- Arama: `https://www.trodo.com/catalogsearch/result?q=<sorgu>&searchby=name` sayfası açılır; sayfanın kendi yüklediği `catalogsearch` yanıtı CDP Network ile okunur. Önce 403, sonra 200 gelirse 200 alınır.
- Ürün: `https://www.trodo.com/<slug>` açılır; sayfanın yüklediği `product-url` ve `view-data` yanıtları birlikte alınır.
- Logo HTML'i açık ürün sayfasının DOM'undan okunur. Araç listeleri (`vehicle/models`, `vehicle/type`) ürün sayfasından, görseller `picdn` sekmesinden sayfa içi `fetch` ile alınır. Görsel boyutu `createImageBitmap` ile okunur, çünkü gizli sekmede `img.decode()` hiç tamamlanmıyor.
- Eşleştirme operatör akışını izler: parça numarası aramasının ilk 3 adayı açılır, `oe_numbers` içinde oem=1 satırı tedarikçi OEM'iyle normalize edilerek eşleşen ilk aday kabul edilir (`oem_reference`). Bulunamazsa OEM numaralarıyla aranır ve ilk 5 aday aynı kuralla denetlenir. Örnek: EUROREPAR `1676014280` (OEM `H1BC 1125 A1A`) → QUARO QD6428, FORD `H1BC1125A1A` oem=1 → complete.

SIGINT/SIGTERM işçiyi ürün checkpoint'ini koruyarak durdurur. Aynı `enrichment:run -- <run-id>` komutu koşuyu sürdürür; yeni geçici anahtar üretildiği için tarayıcı betiği yeniden çalıştırılır. Rapor sonuçları, HTTP hatalarını, önbellek kullanımını, marka dağılımını ve araç/görsel sayısını içerir; yönetim sayfasındaki pilot kartı da bu tablolardan okunur.

### Pilot erişim kontrolü

04.10.2026 tarihinde 182 markalı 1.000 ürün örneklemiyle yerel tarayıcı köprüsü açıldı. İlk aynı kaynak arama isteği HTTP 403 ve `cf-mitigated: challenge` döndürdü; kaynak devresi açıldı. Koşu `f7f3779f-cec0-4f58-a399-61ed97a53bcc` bloke durumda ve 1.000 ürün checkpoint kuyruğunda kaldı. Veri aktarımı olmadı; önceki 62 tamamlanmış ürün ve 319.236 bekleyen ürün korunuyor. Kanıt `artifacts/enrichment-pilot-<run-id>/source-incident.json` içinde. Bu sonuç 1.000 ürün başarı/performans ölçümü değildir. Kaynak erişimi sağlanmadan aynı koşu otomatik tekrar başlatılmamalıdır.

Başlatma betiği artık tek satır üretilir ve `void` ile çalıştırılır; tarayıcı konsolunda satır satır yürütülmemelidir. Yeni bağlantı önceki kolektörü durdurur.
# Trodo kategori verileri

Ana sayfanın `/rest/V1/initial-config` yanıtındaki `relationships.catTree` verisi
`artifacts/trodo-categories/tree-20261007.json` dosyasına arşivlendi. Kaynak 5 ana bölüm
ve 586 kategori içeriyor. `source_categories` tablosu kaynak kimliği, üst kategori,
ad, slug, tam kimlik yolu, kaynak URL ve ham veriyi saklar; Magento'nun dahili 1/2
ataları kullanıcıya ait kategori yoluna dahil edilmez.

`node --env-file=.env.local --import tsx scripts/enrichment-categories.ts import-tree FILE`
ağacı doğrulayıp aktarır. Ürün API'sindeki `category` / `category_ids` alanları worker
tarafından `product_enrichments.payload.categories` içine ad ve tam kategori yolu ile
kaydedilir. Kaynağı bilinmeyen bir üst kategori tahmin edilmez. Bu kaynak kategorileri
mevcut mağaza kategorilerinin üzerine yazılmaz; çeviri ve mağaza kategorisi eşlemesi ayrı çalışmadır.

`node --env-file=.env.local --import tsx scripts/enrichment-categories.ts backfill`
mevcut ürün URL'sine ait ham API önbelleğinden kategori verilerini tamamlar; ürün ve
tedarikçi kimliğini yeniden doğrular, görselleri veya zenginleştirme durumunu değiştirmez.
07 Ekim aktarımında 203 kayıt tamamlandı; 62 eski kayıtta bu API önbelleği bulunmadı.

## Trodo kategori ağacı ve görselleri

Kategori kaynağı Trodo ana sayfasının /rest/V1/initial-config yanıtındaki catTree alanıdır.
source_categories kaynak adını, hiyerarşiyi, kategori URL'sini ve ham kaydı korur.
source_category_labels Türkçe adları ve site bağlantılarını tutar.
Ürün kaydı yapılırken doğrulanmış kaynak kategorileri product_source_categories ile bağlanır;
ana kategori filtresi alt kategorilerdeki ürünleri de kapsar. OEM eşleşme kanıtı ve güncel
tedarikçi kimliği kategori filtrelerinde de doğrulanır.

Komutlar:
- node --env-file=.env.local --import tsx scripts/enrichment-categories.ts import-tree artifacts/trodo-categories/tree-20261007.json
- node --env-file=.env.local --import tsx scripts/localize-categories.ts
- node --env-file=.env.local --import tsx scripts/enrichment-categories.ts backfill
- node --env-file=.env.local --import tsx scripts/category-images.ts
- node --env-file=.env.local --import tsx scripts/category-images.ts status

Görsel köprüsü yalnızca 127.0.0.1:4319 üzerinde çalışır. Ürettiği
.local/enrichment/category-image-start.js dosyası gizli, geçici erişim anahtarı içerir;
açık Trodo ana sayfasının konsolunda çalıştırılır. Bu dosyayı paylaşmayın veya Git'e eklemeyin.
Tarayıcı bir seferde bir kaynak görseli indirir; en az bir saniye aralık kullanır.
Kaynak erişimi 401/403/429 döndürürse durur. Tarayıcı sekmesini işlem bitene kadar
yenilemeyin/kapatmayın. Yeniden başlatmada yeni konsol dosyası gerekir; tamamlanmış
görseller tekrar indirilmez, süresi dolmuş işler yeniden alınır.

Görseller WebP olarak MinIO'ya kaydedilir; SHA-256 ve boyut depolama üzerinde doğrulanır.
source_category_images kategori ile medya kaydını bağlar, site görselleri
/api/category-media/[id] üzerinden sunar. Kaynakta görsel adı olmayan kategoride
genel parça simgesi gösterilir. Ürün görsellerinin erişim kuralları ayrı kalır.

Menü 360 px yan panel, 45×30 px satır görseli, alt kategoriye panel içinde geçiş,
geri düğmesi ve kategori yolu kullanır. Katalogda dört sütunlu görsel kategori kartları,
mobilde iki sütun bulunur; tüm kategori verileri DB'den okunur.

### Katalog filtreleri ve ürün kartları

Katalog sidebar'ı kategori ağacı, çoklu üretici seçimi, kategoriye ait teknik filtreler, marka sınıfı ve stok durumunu gösterir. Teknik filtreler doğrulanmış enrichment kayıtlarından çıkarılır; EAN ve ölçü gibi yüksek çeşitliliğe sahip alanlar sidebar'a taşınmaz. Seçimler URL'de tutulur (`brands` JSON dizisi, `attributes` JSON nesnesi, `availability=in_stock|out_of_stock`); aynı gruptaki değerler OR, farklı gruplar AND ile eşleşir. Seçili filtreler mevcut seçenek listesini ortadan kaldırmaz.

Kartlar grid/list görünümü, ilk dört teknik özellik ve genişletme, marka logosu, gerçek fiyat/stok, adet seçimi ve üç ürüne kadar karşılaştırma içerir. Fiyatı veya stoku güncel olmayan ürünler satın alınabilir gösterilmez. Bilinmeyen stok, “Stokta yok” filtresine dahil edilmez. OEM alternatifinden alınan teknik bilgiler kullanılabilir; alternatifin EAN, üretici, üretici parça numarası, ticari numaraları ve marka sınıfı kart kimliğine aktarılmaz. Marka sınıfı filtresi yalnızca birebir parça eşleşmelerini kullanır.

Kontroller:
- `node --import tsx --test scripts/test-catalog-filters.ts`
- `node --env-file=.env.local --conditions=react-server --import tsx scripts/verify-catalog-filters.ts`

Trodo kartlarının görünür kalite/stok SVG simgeleri `/public/media/trodo/icons/` altında yerel olarak saklanır.

Katalog yerleşimi Trodo fren diskleri sayfası ile tarayıcıda karşılaştırılarak düzenlendi.
Masaüstünde 304 px sidebar, tek panel içindeki teknik filtreler, liste/ızgara kartları,
280 px kategori banner'ı ve kaydırınca sabitlenen arama alanı kullanılır. Fren banner'ı
yerel WebP dosyasından sunulur. İlgili kategori kartları ve alt bölüm aynı yerleşimi
izler; bağlantılar ve ticari bilgiler mağazanın kendi verileridir. Mobilde filtreler
kapalı başlar, ızgara kartlarının teknik ve satın alma alanları referanstaki gibi gizlenir.
