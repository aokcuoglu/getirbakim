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

Eklenen OEM numaraları katalog aramasında da kullanılır. Kod araması önce `enrichment_oem_search(payload)` üzerindeki trigram indeksiyle (`product_enrichments_oem_search_idx`, `db/enrichment-search.sql`, #609) adayları daraltır, sonra her numarayı tek tek denetler; bu fonksiyon veya `search_compact` değişirse `REINDEX INDEX product_enrichments_oem_search_idx` gerekir. Kısmi bir paket tamamlanmış bir kaydın üzerine yazılamaz.

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

## Medya temizliği

Hiçbir yerden başvurulmayan `product_media_objects` satırlarını ve kovadaki nesnelerini `npm run media:gc` toplar (#597). Başvuru sayılanlar: `product_media_objects`'e giden her foreign key (çalışma anında `pg_constraint`'ten okunur; `db/*.sql`'de olmayan eski tablolar da korunur) ile FK'siz kopyalar `product_enrichment_shared_links.image_id` ve `enrichment_product_states.image_id`. FK'siz, tanınmayan bir `*image_id` / `*media_id` uuid kolonu varsa komut hiçbir şey silmeden durur. Kova hiç listelenmez; yalnız silinen satırın anahtarı silinir (kovada `internal/storefront-sync/…` gibi medya dışı anahtarlar da var).

```sh
npm run media:gc                                  # dry run: aday sayısı, bayt, klasör dökümü, ilk 20 anahtar (JSON)
npm run media:gc -- --apply                       # siler
npm run media:gc -- --min-age-days=14 --limit=500 --batch=200 --max-share=0.2
```

- **Yaş eşiği:** varsayılan 7 gün (en az 1). Yaş `GREATEST(created_at, stored_at)`: bir içe aktarma var olan görseli yeniden kaydettiğinde `stored_at` güncellenir, başvurusu yazılana kadar satır genç kalır.
- **Güvenlik sınırları:** adaylar toplamın `--max-share` oranını (varsayılan 0,2) aşarsa `--apply` reddedilir. Aynı anda tek koşu (advisory lock `20261001, 10`). Her parti önce satırları siler (FK ve koşullar yeniden denetlenir), sonra nesneleri siler, kova onaylayınca commit eder; kova silemediği nesnelerin satırlarını bırakır ve komut hata ile durur. Seçimden sonra başvuru alan satır kalır (`becameReferenced`); başka bir işlemin 5 sn'den uzun tuttuğu satır da kalır (`locked`).
- **Kova tek veritabanına aittir:** komut, kovadaki nesnelere yalnız bu veritabanının satırları başvurur varsayımıyla siler. Çıktıdaki `database` ve `bucket` alanlarının doğru çifti gösterdiğini kontrol edin; iki veritabanının paylaştığı kovada koşmayın.
- **Merge sonrası:** her ortamda önce `npm run db:setup` (AWS'de `release-aws` ile gelen kurulum) koşmalıdır; `stored_at` kolonu olmadan görsel yazımı `42703` (kolon yok) hatası verir.
- **Her ortamda ayrı koşu:** medya id'leri ortamlar arasında farklıdır; yerelde, VPS'te ve AWS'de ayrı koşulur. AWS'de operations görevi olarak: `node --conditions=react-server --import tsx scripts/media-gc.ts [--apply]` (`.env.local` yok, ortam değişkenleri görevden gelir).
- **Ne zaman koşulmaz:** zenginleştirme işçileri, kategori görseli içe aktarımları veya storefront sync çalışırken `--apply` koşmayın. Sync kilidi `.local/storefront-sync/sync.lock` varsa komut reddeder, ama bu kilit yalnız aynı checkout'taki sync'i korur: AWS'de veya VPS'te çalışan bir storefront import görevi olmadığını operatör kontrol eder.
- **Yetki:** yerel MinIO medya kullanıcısının politikasında `s3:DeleteObject` gerekir (`deploy/storage.compose.yml`; mevcut kurulumda politikayı güncellemek için `npm run storage:setup`). AWS'de operations görev rolüne kovada `s3:DeleteObject` verilmelidir (infra reposu). Kova sürümlemesi açıksa silme yalnız delete marker bırakır; eski sürümler yaşam döngüsü kuralıyla temizlenmelidir.

## Ürün–araç kataloğu bağlantıları

`product_vehicle_fitments`, kaynak araç satırını `supplier_item_id` ve `source_index` ile saklar. Eşleşen satırdaki `vehicle_type_id`, gerçek `vehicle_types.id` kaydına foreign key ile bağlıdır; marka ve model `vehicle_types → vehicle_models → vehicle_brands` ilişkisi üzerinden okunur. Aynı araç farklı ürünlere bağlanabilir. Kaynak motor kodları ve diğer ham değerler `source_vehicle` içinde korunur.

```sh
npm run fitment:rebuild
npm run fitment:rebuild -- --items=data/urunler.json
npm run test:fitment
npm run test:fitment-rebuild
npm run verify:fitment
npm run verify:fitment -- --drift-only
```

`fitment:rebuild` tabloyu idempotent biçimde kurar ve argümansız çalıştırıldığında mevcut tüm ürünleri aynı transaction içinde yeniden eşleştirir. `--items=<dosya>` (tedarikçi ürün kimliklerinden oluşan JSON dizi, boş dizi de geçerli) yalnız o ürünleri ve bağlantıları eski bir eşleştirici sürümüyle (`matcher_version`) kurulmuş ürünleri yeniden eşleştirir; zenginleştirmesi olmayan kimlikler yok sayılır. Bilinmeyen argüman ya da geçersiz kimlik hata verir, tam yeniden kuruluma dönmez. Çıktı yalnız özet JSON'dur (`mode`, `requested`, `outdated`, `products`, durum sayıları). Ürün veya kaynak verisini değiştirmez. `enrichment:prepare` de bağlantı tablosunu hazırlar. Kurulumdan sonra `enrichment:import` her ürünün kaynak verisini ve bağlantılarını aynı transaction içinde günceller. Eski araç satırları kaldırılır; tekrar aktarım çoğaltma yapmaz. `db:vehicles` de araç kataloğunu güncellediğinde kurulu ürün bağlantılarını yeniden hesaplar. Ürün ve araç aktarımları ortak advisory lock sırasıyla çalışır; eşzamanlı işlemler kısa süre sıraya girer.

Bağlantılar yalnız ürün payload'ındaki `vehicles`, araç kataloğu ve `FITMENT_MATCHER_VERSION`'dan türetilir. Bu yüzden tam yeniden kurulum nadiren gerekir: eşleştirici sürümü değişince kapsamlı çalıştırma eski sürümlü satırları kendiliğinden yeniden kurar, araç kataloğu aktarımı (`db:vehicles`) tümünü zaten yeniden hesaplar. Emin değilseniz `npm run verify:fitment` ile denetleyip argümansız `npm run fitment:rebuild` çalıştırın.

Kapsamlı çalıştırmanın kendiliğinden onaramadığı durum, bağlantısı payload'ından geri kalmış ve sonraki paketlerde gelmeyen üründür (ör. bağlantıları kurulmadan yarıda kalmış bir içe aktarma). `verify:fitment` önce salt-okunur bir sapma denetimi yapar: `payload->'vehicles'` uzunluğu `product_vehicle_fitments` satır sayısından farklı olan zenginleştirmeleri sayar ve ilk 20 kimliği yazar, sapma varsa hata ile çıkar. `--drift-only` yalnız bu denetimi koşar (yerelde ~9,3M satırda ~2-4 sn; AWS'de operations görevi olarak `node --import tsx scripts/verify-product-fitments.ts --drift-only`); bayraksız çalıştırma diğer denetimleri de yapar, bunlar satır kilidi alır, geri alınan bir transaction içinde yazar ve `VERIFY_URL`'den bir ürün sayfası okur. Sayı denetimi aynı uzunlukta ama farklı içerikli bir payload'ı yakalamaz; o durum bayraksız çalıştırmadaki "stale source links" denetimindedir.

- **Bir ortamdaki ilk kapsamlı aktarımdan önce** ve **başarısız bir içe aktarmadan sonra filigranı ileri almadan önce** (`--baseline`/`--force`) `verify:fitment -- --drift-only` çalıştırın; sapma bildirirse argümansız `fitment:rebuild` koşun.

`strict-v1`: büyük/küçük harf, aksan, boşluk ve katalog marka gösterim adı farkları normalize edilir. Model/kasa, motor adı, yakıt, cm³, PS/hp, kW ve üretim başlangıç/bitiş ayları birlikte eşleşmelidir. Motor adı kaynak metnindeki motor kodlarından ayrılarak karşılaştırılır; xDrive/4motion gibi uzun varyant adları önceliklidir. Birden fazla aynı aday varsa otomatik bağlantı kurulmaz. Motor kodları katalogda bulunmadığı için ayrıca doğrulanamaz. Bu bağlantı kaynak uyumluluk listesini yerel katalogla ilişkilendirir; üretici onayı anlamına gelmez.

Eşleşmeyen satırlar silinmez: `model_missing`, `attributes_missing`, `dates_differ`, `engine_name_differs` veya `ambiguous` durumuyla saklanır. Tarih farkları, yaklaşık ad eşleştirmeleri ve elle incelenmiş model takma adları otomatik olarak kabul edilmez. Ürün sayfası bağlı satırların marka/model ve teknik değerlerini katalogdan okur; diğer satırları “Kaynak kaydı” olarak gösterir. Kaynak gözlemi artık ürün payload'ıyla aynı değilse eski bağlantı gösterilmez. Garajdaki tip kimliği bağlı listede yer alıyorsa sayfada bu bilgi belirtilir.

`strict-v3` (#231) iki istisna ekler; diğer kurallar aynen geçerlidir:

- **Türkçe model adları.** Kaynaktaki model adı katalogda yoksa Türkçe seri ve gövde adları TecDoc İngilizcesine çevrilip tekrar aranır: `C-SERISI`→`C-CLASS`, `Station wagon`→`Estate`, `Sedan`→`Saloon`, `Cabrio`→`Convertible`, `Panelvan/Van`→`Van`, `Minibüs/Otobüs`→`Bus`, `Platform şasi`→`Platform/Chassis`, `Kasa/büyük limuzin`→`Box Body/MPV`, `Kombi van`→`Estate Van`, `Pick-up`→`Pickup`. Bazı katalog adlarında Türkçe kalıp durduğu için (`MEGANE I Kombi van (KA_)`) önce verilen ad denenir.
- **Açık bitiş tarihi.** Tam tarih eşleşmesi yoksa ve kaynak üretimi süren (bitişi boş) bir araç bildiriyorsa, başlangıç ayı aynı ve kataloğa göre üretimi kapanmış tipler aday olur. Öznitelik, motor adı ve tekillik kuralları değişmez: birden çok aday `ambiguous` kalır. Kaynak kapalı, katalog açık durumu eşleşmez.

15.10.2026'da tüm bağlantılar `rebuild-product-fitments` ile yeniden hesaplandı. Sonuç: otoparcasan satırlarında eşleşme %49,9'dan %90,7'ye (+1.601), Trodo'da 569.705'ten 569.898'e (+193) çıktı.

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

### Tüm katalog turu — 10.10.2026

`npm run enrichment:continue -- 4318 1000 --chrome`, bekleyen işleri 1.000'lik partilerle bitene kadar işler. Her yeni parti açılmadan önce `supplier_items` içindeki yeni ürünler kuyruğa eklenir. Parti sırası: önce storefront'ta satılabilir ve stoklu ürünler, sonra satılabilir stoksuzlar, en son artık satışta olmayanlar. Her katmanın içinde sıra sabit hash'e göredir. Pilotlardaki "her markadan bir ürün" kuralı katalog turunda uygulanmaz.

Parti tamamlanınca tarayıcı toplayıcıları durdurulur, koşu kilidi ve yerel köprü kapatılır; aynı süreç sıradaki 1.000 bekleyen üründen yeni parti oluşturur. Son partide 1.000'den az ürün kalırsa yalnızca kalanlar alınır. Kuyruk boşalınca süreç çıkar; kaynak engeli veya durdurma sinyali yeni parti açılmadan checkpoint'i koruyarak çalışmayı sonlandırır. Uzun koşularda bekleme callback'leri biriktirilmez; yalnızca etkin beklemeler kapanışta uyandırılır.

10.10.2026 ölçümü (koşu `be68aad8`): www.trodo.com için istek aralığı 10 sn. Tarayıcı çalışırken saatte ~354 istek yapılıyor, yani aralık sınırına dayanıyor. Ürün başına ortalama ~5,1 istek gidiyor: arama 1,55, OEM araması 0,7, ürün ve görünüm 0,8+0,8, araç listeleri 1,1. OEM ile doğrulanan bir eşleşme ~6, `not_found` 2,8–4,9 istek tutuyor. Yedek arama varyantları da eşleşme getiriyor: tamamlanan ürünlerin ~%16'sı bu varyantlarla bulundu. Bu nedenle istek sayısını kısmak yerine çalışma süresini uzatmak öncelikli. O gün kapak kapanınca Mac uyudu ve 2,5 saatlik bir duruş oldu; son 24 saatte çalışma oranı %43'tü. `/yonetim/urun-verileri` sayfasındaki "Katalog turu hızı" kartı son 24 saatte aranan ürünü, çalışma süresini, istek aralığını ve tahmini bitişi gösterir. Bir 10 dakikalık dilim, Trodo o dilimde en az bir kez yanıt verdiyse çalışılmış sayılır.

### Canlıya düzenli aktarım — 11.10.2026

Tarama yerel veritabanına yazar; canlı, aktarılana kadar eski veriyi gösterir. `npm run storefront:sync` şu adımları çalıştırır:

1. Son başarılı aktarımdan sonra içe aktarılan zenginleştirmeleri, bunların kategori eşlemelerini ve görsellerini dışa aktarır. Kategori ağacı, logolar, REPXPERT araç verisi ve tamamlanmış/kısmi zenginleştirme işlerinin durumları her seferinde tam gönderilir.
2. `vps` hedefinde paketi `PRODUCTION_SSH` (`.env.local`, ör. `root@<host>`) üzerinden VPS'te `.local/storefront-bundles/current` dizinine rsync ile kopyalar; yalnızca değişen dosyalar gider. `aws` hedefi aşağıda.
3. VPS'te sırasıyla `production-task.sh backup`, `import-storefront` kuru çalıştırması, `--apply` ve `rebuild-fitments` çalışır.

Filigran yalnızca canlı paketi uyguladıktan sonra ilerler; başarısız bir çalıştırma bir sonrakinde tamamen tekrarlanır. Anlık görüntü sırasında sürmekte olan içe aktarmaları kaçırmamak için 1 saat geri örtüşme bırakılır; içe aktarma upsert olduğu için tekrar zararsızdır.

`npm run storefront:sync:install` her gün 04:30'da çalışan launchd işini kurar. Mac o saatte uykudaysa iş uyanınca çalışır. Günlük `.local/storefront-sync/sync.log` dosyasına yazılır; kaldırmak için `npm run storefront:sync:uninstall`.

#### Hedefler, filigran ve bayraklar (#553)

`STOREFRONT_SYNC_TARGET` (`.env.local`) `vps` (varsayılan, yukarıdaki SSH akışı) ya da `aws` olur. `aws` hedefinde parçalar S3 inbound kovasına yüklenir ve tek bir ECS görevi `scripts/import-storefront-inbound.ts`'i çalıştırır: tüm parçaların kuru çalıştırması → uygulama → `rebuild-product-fitments.ts --items` (yalnız paketin yazdığı ürünler ve eski `matcher_version`'lı satırlar; liste görevin geçici dizinindeki `fitment-items.json`'dadır, `report.json`'a girmez) → paylaşılan bağlantı kuyruğunun boşaltılması (`product_enrichment_shared_sync()`) → `enrichment-states.ts sync`.

- **Filigran hedef başına ayrıdır:** `vps` → `.local/storefront-sync/state.json` (eskisi gibi), `aws` → `.local/storefront-sync/state.aws.json`. Durum dosyası `snapshotAt`, `syncedAt`, `target`, `since`, gönderilen sayıları ve gerekiyorsa `retry` listesini tutar. Yollar komutun çalıştığı dizine göredir; başka bir worktree'den çalıştırma ana checkout'un filigranına dokunmaz.
- **Bayraklar katıdır:** yalnız `--dry-run`, `--full`, `--force` ve `--baseline=<ISO>` kabul edilir; başka her argüman (`--dryrun`, `-n`, boşlukla yazılmış `--baseline 2026-…`) hata verir, gerçek çalıştırmaya dönüşmez.
- **`--baseline=<ISO>`:** `--dry-run` olmadan hedefin son anlık görüntüsünü `<ISO>` olarak kaydeder (`baseline: true`) ve çıkar; kilit altında çalışır, var olan durumu yalnızca `--force` ile ezer (varsa `retry` listesi korunur). Zaman dilimi açık yazılmalıdır (`Z` ya da `±hh:mm`); dilimsiz, gelecekteki ya da geçersiz zaman reddedilir. `--dry-run` ile birlikte yalnızca o çalıştırmanın filigranıdır, hiçbir şey yazılmaz.
- **`aws` hedefinde durum dosyası yoksa** çalıştırma durur: `--baseline=<ISO>` ile son aktarılan anı kaydedin ya da bilinçli olarak her şeyi göndermek için `--full` kullanın. `vps` hedefi eskisi gibi filigransız ilk çalıştırmada her şeyi gönderir.
- **`--full`:** filigranı yok sayıp tüm zenginleştirmeleri gönderir; `--baseline` ile birlikte kullanılamaz.
- **`--dry-run`:** dışa aktarır ve parçalara böler, hedefi, `since`, `snapshotAt`, satır sayılarını, MB'ı ve parça dökümünü (part-00 ayrı) JSON olarak yazar. Aktarım yapmaz, filigran yazmaz, kilit almaz; AWS profili ya da SSH ayarı istemez. Yerel veritabanı ve yerel nesne deposu (MinIO) okunur.
- **Kilit:** gerçek çalıştırmalar ve `--baseline` `.local/storefront-sync/sync.lock` (`{pid, startedAt, target}`) alır; launchd ve elle çalıştırma çakışmaz. Kilidi tutan süreç ölmüşse ya da kilit 24 saatten eskiyse devralınır; `startedAt` geçersizse devralınmaz, hata verilir; Ctrl-C/SIGTERM kilidi bırakır. Hata mesajı kilit dosyasının yolunu verir; o süreç bir aktarım değilse dosyayı silin.
- **Atlanan zenginleştirmeler (`retry`):** tedarikçi ürünü canlıda henüz yoksa (canlı ve yerel tedarikçi senkronları ayrı) zenginleştirme atlanır. İçe aktarma görevi uygulamadan sonra medya kovasına (`S3_BUCKET`, herkese kapalı) `internal/storefront-sync/storefront/current/report.json` anahtarıyla toplam sayıları ve atlanan ürünlerin anahtarlarını (`id`, `supplier`, `company`, `list_group`, `warehouse`, `code`) yazar. Yerel aktarım görev başarıyla bitince raporu indirir, atlanan varsa uyarır ve anahtarları `state.aws.json`'da `retry` olarak saklar. Sonraki dışa aktarım bu ürünlerin zenginleştirmelerini filigrandan bağımsız olarak yeniden gönderir (`export-storefront-bundle.ts --retry-file`, kimlik ya da doğal anahtar eşleşmesi); liste her çalıştırmada yeni raporun atlanan kümesiyle değiştirilir ve 10.000 anahtarla sınırlıdır (sayı her zaman tam raporlanır). Raporu yazamayan görev başarısız biter (veri yazılmış olsa da). Görev başarıyla bitmiş ama rapor yoksa (eski operations imajı) ya da rapordaki `snapshotAt` bu paketinkiyle uyuşmuyorsa aktarım iki durumu ayrı mesajla belirterek hata verir; filigran ve `retry` listesi ilerlemez, sonraki çalıştırma aynı veriyi yeniden gönderir (içe aktarma idempotent). Atlanan anahtar sayısı 10.000'i aşarsa uyarı, ürünler canlıya geldiğinde `--full` ile çalıştırmayı önerir. Rapor her çalıştırmada üzerine yazılır.
- **Kategori eşlemeleri değiştirilir:** paketteki her zenginleştirmenin canlıdaki `product_source_categories` satırları, paketin taşıdığı kaynaklar (ör. `trodo`) için silinip paketteki satırlarla aynı işlemde yeniden yazılır; kategorisi değişen ürün eski kategoriyi tutmaz.
- **`aws` ön kontrolü:** yüklemeden önce `aws ecs list-tasks --started-by storefront-sync --desired-status RUNNING` çalışır; süren bir içe aktarma görevi varsa ya da çağrı başarısız olursa çalıştırma durur.

#### Yerelde topla → AWS'ye aktar

Zenginleştirme işçileri (Trodo, otoparcasan, spareto, parts2world) yerelde çalışır ve yerel veritabanına yazar; canlıya yalnızca bu aktarım taşır.

1. `.env.local`: `STOREFRONT_SYNC_TARGET=aws`, `PRODUCTION_AWS_PROFILE` (adlandırılmış profil, `default` değil).
2. İlk kez: son aktarılan anı kaydedin, sonra kuru çalıştırma ile ne gideceğine bakın:
   ```bash
   npm run storefront:sync -- --baseline=2026-11-13T05:47:24Z
   npm run storefront:sync -- --dry-run
   ```
3. Gerçek yazma (`npm run storefront:sync`) yalnız kullanıcının açık onayıyla. Sonraki çalıştırmalar filigrandan devam eder; günlük çalıştırma için launchd işi isteğe bağlıdır (`npm run storefront:sync:install`).

İlk gerçek çalıştırmadan önce yeni bir operations imajı (`release-aws`) gerekir: iş durumlarını içe aktaran `import-storefront-bundle.ts` ve kuyrukları boşaltan `import-storefront-inbound.ts` imajın içindedir. Eski imaj paketteki `jobs` alanını yok sayar ve yeni zenginleştirmeler mağazaya düşmez. IAM değişikliği gerekmez: operations görev rolü inbound kovayı yalnız okuyabilir, raporu zaten yazabildiği medya kovasına yazar. Yerel aktarım medya kovasını Data yığınının `MediaBucketName` çıktısından, yoksa operations görev tanımındaki `S3_BUCKET`'tan bulur. Eski imaj rapor yazmadığı için yeni imaj olmadan aws hedefine gerçek çalıştırma filigranı ilerletmeden hata verir.

#### Tablo kararları

| Tablo | Karar | Not |
| --- | --- | --- |
| `product_enrichments`, `product_source_categories`, `product_media_objects`, kategori ağacı, logolar, `vehicle_type_specs` / `vehicle_type_images` | Pakette | Zenginleştirmeler `imported_at > since`; ağaç, logolar ve REPXPERT verisi her seferinde tam |
| `product_enrichment_jobs` (yalnız `complete`/`partial` ve zenginleştirme satırı olan) | Pakette, her seferinde tam, part-00'da | `product_enrichments`'ta durum yok; `enrichment_valid_data` (`db/enrichment-products.sql`) iş durumuna JOIN yapar. İşler gitmezse yeni zenginleştirme `product_enrichment_shared_links` → `storefront_enrichments`'a ulaşmaz. Yalnız değişen satır yazılır (`IS DISTINCT FROM`), aksi halde tetikleyiciler ~69k satırı her seferinde kuyruğa alır |
| `product_enrichment_shared_links`, `storefront_make_fits`, `storefront_model_fits` | AWS'de türetilir | İçe aktarma sonunda kuyruk boşaltılır; model tablosu (#639) marka tablosuyla aynı yenilemede yazılır |
| `enrichment_product_states` (+ kuyruk) | AWS'de türetilir | `scripts/enrichment-states.ts sync` |
| `product_vehicle_fitments` | AWS'de türetilir | `scripts/rebuild-product-fitments.ts --items`: paketin yazdığı ürünler + eski `matcher_version`'lı satırlar (#561); VPS akışı tam yeniden kurar |
| `product_override_fitments` | Aktarılmaz | Yöneticinin araç uyumu kararları (#583) AWS panelinde yönetilir; `products.id` ortama özgüdür. Yeniden kurulum yalnız `product_vehicle_fitments`'ı yazar, kararlar kalır |
| `product_override_fitment_hides` | Aktarılmaz | Yöneticinin mağazadan çıkardığı bağlanmamış kaynak satırları ve modeller (#661); kararlar gibi AWS panelinde yönetilir |
| `product_model_fitments` | AWS'de türetilir, aktarım başına değil | Canlının kendi Dinamik `supplier_items`'ından `description-fitments` derive (ayrı iş); yalnız değişen satırlar yazılır, değişmeyenin `derived_at`'i korunur (#798) — bu sürümden eski bir release ile AWS'de derive koşulmaz |
| `vehicle_type_oil_specs` | Aktarılmaz | `data/vehicle_type_oil_specs.csv` + `npm run db:vehicle-oils` |
| `vehicle_type_trodo_oils`, `product_enrichment_sources` | Aktarılmaz | Yerel kalır |

İş durumlarının doğruluk kaynağı yereldir: paketteki ürünlerin canlıdaki `product_enrichment_jobs` durumu (ve `supplier_code`, `supplier_brand`, `candidate_url`) paketteki değerle ezilir; canlıda o ürün için başka bir durum yazılmışsa korunmaz.

`enrichment-categories.ts backfill` `imported_at`'i yalnız kategoriler gerçekten değiştiğinde ilerletir; böylece bir backfill tüm Trodo zenginleştirmelerini yeniden göndermez.

Aktarılmayan değişiklikler: yerelde silinen zenginleştirmeler canlıda kalır; `complete`/`partial`'dan başka bir duruma düşen iş paketten çıkar ama canlıdaki satırı değişmez.

### Tarayıcı bağlantısı

Doğrudan HTTP erişimi engelli olduğu için işçi normal kaynak tarayıcısına ihtiyaç duyar. Yalnızca `127.0.0.1:4318` üzerinde yerel köprü açar. Köprü sadece iki kaynak origin'ine (`www.trodo.com`, `picdn.trodo.com`) CORS izni verir; her istekte çalışma anında oluşturulan geçici bearer anahtarını ve kaynak origin'ini doğrular. Veritabanı/S3 kimlik bilgileri tarayıcıya verilmez. Kaynak görevleri yalnızca tanımlı halka açık ürün/araç/görsel yollarına izin verir; hesap uçları kabul edilmez.

Çalışan işçinin ürettiği `.local/enrichment/browser-start.js` dosyasını her kaynak origin'inin geliştirici konsolunda çalıştırın. Firefox yerel cihaz erişimi için izin isteyebilir; gerekli izin kullanıcı onayıyla yalnızca bu oturumda verilir. Kaynak sekmeleri ve yerel işçi açık kalmalıdır. Sekme kapanırsa yeni istekler bekler; kaynak yanıtları ve ürün checkpoint'leri kaybolmaz. Tarayıcı bağlantısı tam sunucu tarafı gözetimsiz toplayıcı değildir. Sunucuya taşımak için erişilebilir/izinli bir API veya sağlayıcı aktarımı gerekir.

### Chrome sürücüsü (önerilen) — 07.10.2026

```sh
npm run enrichment:run -- <run-id> --chrome
```

İşçi, `.local/enrichment/chrome-profile` profiliyle normal Google Chrome'u `--remote-debugging-port=9222` ile açar (zaten açıksa bağlanır) ve kaynak isteklerini CDP `Runtime.evaluate` ile sekmenin içinden, konsol toplayıcısıyla aynı `fetchSourceJob` koduyla yapar. Yerel köprüye/konsola yapıştırmaya gerek yoktur. Chrome ayrık süreç olarak açılır; işçi yeniden başlasa da oturum ve çerezler korunur. `CHROME_PATH` ve `ENRICHMENT_CHROME_PORT` ile değiştirilebilir.

Gözlenen 403'lerin tamamı `cf-mitigated: challenge` idi (yaklaşık saatte bir tarayıcı doğrulaması), IP engeli değil. Bu yanıt artık devreyi açmaz: istek deneme hakkı harcanmadan kuyruğa döner, host `challenge_since` ile duraklatılır, sürücü sekmeyi siteye yeniden yükler ve sayfa normal görünene kadar bekler. 20 saniyede geçmezse macOS bildirimi gönderilir; Chrome'daki doğrulama kutucuğunu operatör tıklar. Doğrulama sonrası hemen tekrar challenge gelirse 1, 2, 4… (en çok 15) dakika beklenir; 45 dakikada geçilemezse host bloke edilir ve koşu checkpoint'le durur. Hız sınırları, 429 geri çekilmesi ve challenge olmayan 401/403 blokları değişmedi; proxy/parmak izi değiştirme yapılmaz. `enrichment-worker.ts unblock` host bloklarını elle sıfırlar ve bitmemiş koşularda bloğu tetikleyen istekleri kuyruğa geri alır; koşu devam ettirildiğinde aynı satıra takılıp yeniden durmaz. Konsol modunda betik başlarken `/cleared` ile challenge durumunu temizler.

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

## Parça tipi → kategori sözlüğü (#851)

Kendi kategorisi olmayan kaynaklar (spareto, parts2world) kategoriyi parça tipinden alır. Trodo ürün adı
"<parça tipi> <marka> <parça no>" biçimindedir (ör. "Sensor, coolant temperature AUTLOG AS2078"); diğer kaynaklar aynı
TecDoc tip adlarını kullanır. `product_type_categories` tablosu her tip slug'ı (`sensor-coolant-temperature`) için
Trodo kategorilerini, kaç üründe görüldüğünü (`support`) ve tipin toplam ürün sayısını (`total`) tutar. Sözlük Trodo ham
ürün API önbelleği ile kategorili Trodo zenginleştirmelerinden ürün slug'ı başına tekil olarak öğrenilir; ağaçta olmayan
kategori kimlikleri atlanır, ad değil `category_id` kullanılır.

- Eşikler: bir kategori, tipin ürünlerinin en az 0,8'inde ve en az 2 üründe görülmüşse tipe yazılır; eşiği geçen her
  kategori yazılır (bir tip birden çok kategoride olabilir). Değerler `type-categories.ts` içindeki
  `DEFAULT_MIN_SHARE` / `DEFAULT_MIN_SUPPORT` sabitleridir; işçi ve yazan backfill yalnız bunları kullanır. Farklı eşikler
  (`--min-share`, `--min-support`) yalnız `--dry-run` ile denenebilir; aksi halde yazılan kategoriler ürünler yeniden
  toplandıkça işçinin eşikleriyle geri değişirdi. Eşik değişecekse sabit değiştirilir.
- Eşleştirme yalnız tam tip adıyla yapılır; "-1" gibi sayısal kuyruk bir kez atılarak, sonra yalnız son kelimenin
  tekil/çoğul farkı (`v-ribbed-belts` → `v-ribbed-belt`; `glass`, `gas`, `chassis` gibi kelimeler hariç) denenir. Farklı
  kategorilere düşen çoğul katlamaları belirsiz sayılır. Sonek/alt dize eşleşmesi yoktur
  (`water-pump-and-timing-belt-set` bir `timing-belt-set` değildir).
- spareto işçisi sözlüğü açılışta yükler ve ürün sayfasındaki parça adının kategorilerini `payload.categories` içine
  yazar. Her yazım `product_source_categories`'i yeniden kurduğu için bu şarttır; kategorisiz yeniden toplama backfill'i silerdi.
  Tablo yoksa (şema güncellenmemiş yerel DB) veya sözlük boşsa işçi bir satır uyarı basar ve kategorisiz devam eder.
- Mağaza sözleşmesi değişmez: kategoriler yine `source: 'trodo'` olarak saklanır. Liste/kategori sayfası, kategori
  ağacı sayıları ve sitemap otomatik kategoriyi yalnız `exact_part` / donör-OEM eşleşmelerinde kullanır; ilgili ürün
  önerileri (`related-suggestions.ts`) ve bakım seti (`maintenance-kit.server.ts`) eşleşme türüne bakmaz.

Komutlar (`npm run enrichment:categories -- <komut>`):

- `learn-types` sözlüğü yeniden öğrenir (tek işlemde `source='trodo'` satırlarını siler ve yeniden yazar).
- `backfill-types --source spareto [--dry-run [--min-share N] [--min-support N]]` mevcut spareto zenginleştirmelerine
  URL'deki tipten kategori yazar; sayıları ve en sık 50 eşleşmeyen tipi basar. `--dry-run` yalnız okur. Kategorisi
  değişmeyen satıra dokunulmaz; `imported_at` yalnız değişenlerde ilerler, kaynak URL'si değişmiş satır atlanır. URL'sinden
  tip çıkarılamayan satır (`noType`) yalnız sayılır, işçinin sayfa adından yazdığı kategoriler korunur.
- `report-types [--min-share] [--min-support]` eşiklerde sözlük boyutunu ve dışarıda kalan tipleri gösterir.

Backfill sonrası yeniden kurma gerekmez: kategori listeleri `product_source_categories`'i canlı okur (yalnız süreç içi
10 dakikalık önbellek var). 16 Kasım 2026 yerel ölçümü: 14.177 Trodo ürününden 660 tip; spareto'nun 36.332 kaydının
`--min-support 2` ile %92,7'si (33.691), `--min-support 1` ile %94,0'ı (34.165) kategori alıyor; çoğul katlama 15 kayıt ekliyor.
URL'den tip çıkarılamayan 86 kayıt var (A.B.S. `ab-s-…`, CONTINENTAL CTAM `contitech-…`).

**İlk backfill'in storefront:sync maliyeti (tek seferlik):** ilk yazımda ~33,7 bin spareto kaydının `imported_at`'i
ilerler ve sonraki `storefront:sync` bunları yeniden gönderir:

- Dışa aktarım bu kayıtların görsellerini de pakete koyar (`export-storefront-bundle.ts`, `media` sorgusu); içe
  aktarım her görsel için S3'e PUT + doğrulama GET yapar (`import-storefront-bundle.ts`). Yerelde spareto görselleri
  ≈24 bin nesne / 2,6 GB, yani 100 MB'lık ≈25 parça.
- AWS, yazılan kayıtlar için araç uyumluluklarını yeniden kurar (`import-storefront-inbound.ts`, `rebuild-product-fitments`).
- IndexNow parmak izleri ve sitemap `lastmod` değerleri bu ürünlerde ilerler.
- Ana sayfadaki "son zenginleştirilen" rafı (`home.ts`, `imported_at DESC`) geçici olarak son backfill partisinden dolar.

Backfill'i bilinçli bir zamanda (gece sync'inden önce değil, izlenebilecek bir aralıkta) koşun ve önce
`npm run storefront:sync -- --dry-run` parça özetine (yalnız dışa aktarım + bölme, aktarım yok) bakın.

Canlıda komut gerekmez: `db:setup` boş tabloyu kurar, kategoriler `imported_at` ilerlediği için `storefront:sync` ile
taşınır. Yerelde birleştirmeden sonra: `learn-types` → `backfill-types --source spareto --dry-run` →
`backfill-types --source spareto` → tekrar koşunca `changed: 0`. spareto işçisi tabloyu okuduğu için yerel şema
(`db:setup` veya ilk `enrichment:categories` komutu) işçiden önce güncellenmelidir.

### parts2world parça tipleri (#852)

parts2world `article-info` yanıtı makalenin TecDoc genel makale adını `data.spareInfo` içinde verir ("V-ribbed Belt",
"Control/Trailing Arm, wheel suspension"; her zaman İngilizce). Bu ad `typeSlug` ile aynı sözlükten eşlenir.

- `parts2world_article_types` (yalnız yerel, mağaza paketine girmez): makale başına (`article_id`, `link_id`) yanıtın
  markası, parça numarası ve `spare_info`'su. Satırı olmayan makale henüz sorulmamış demektir (tablo aynı zamanda
  kaldığı yeri tutar). `spare_info` NULL = yanıt geldi ama ad/makale yok; `--retry` olmadan yeniden sorulmaz.
- `collect` her yanıtta adı tabloya yazar (kimlik kontrolünden önce; makalenin kendi bilgisi) ve sözlükteki
  kategorileri pakete koyar (`· kategori N`). Her yazım `product_source_categories`'i yeniden kurduğu için şarttır.
  Tablo yoksa bir kez uyarır ve o koşu boyunca adları saklamadan devam eder.
- `enrichment:parts2world -- fetch-types [--limit N] [--retry]` eski kayıtların makalelerini yeniden sorar ve
  yalnız adı saklar; zenginleştirmeye, görsele, deneme kayıtlarına dokunmaz. Varsayılan 50 makale, marka kümelenmesin
  diye karma sırayla. Sonunda `remainingBefore`, `named`, `noArticle`, `errors`, `rowsCovered` (adı alınan makalelerin
  kayıt sayısı), `mapped`/`mappedShare` (sözlükte karşılığı olanlar; kimlik kontrolünden önceki tahmin) ve sözlükte
  olmayan en sık 50 adı basar. 404, boş yanıt (`noArticle`) ve şemaya uymayan yanıt (`invalid`) kalıcı sayılır ve adsız
  satır olarak yazılır (`--retry` yeniden sorar); adı olan satır adsız bir yanıtla ezilmez. HTTP 403/429/503'te durur
  (çıkış kodu 2); ağ/5xx gibi geçici hatalar yazılmaz, sonraki koşuda yeniden denenir; art arda 10 geçici hatada koşu
  durur (çıkış kodu 2), iki kilit saatlerce tutulmaz.
- Kategorileri `enrichment:categories -- backfill-types --source parts2world [--dry-run]` yazar. Tip yalnız saklanan
  yanıtın markası ve parça numarası kaydın `manufacturer` / `manufacturer_part_number`'ı ile aynıysa sayılır; değilse
  veya ad yoksa satır `noType` olarak sayılır ve dokunulmaz. OE numarasıyla eşleşen kayıtlar (`oem_reference`, ≈%45)
  tipi OE'yi listeleyen makaleden alır (aynı OE = aynı parça tipi); bu, #422'deki "diğer makalenin verisi atılır"
  kuralına bilinçli bir istisnadır.

**Kilit ve sıra.** `fetch-types`, `collect` ile aynı iki kilidi alır (`parts2world-collect` denemeli,
`parts2world-source` bekleyerek); aynı host'a iki istemci yapısal olarak açılamaz. Bekleyen işçi o an koşuyorsa
`{"skipped":"another parts2world run is going"}` ile çıkar. Sırayı almak için işçiyi durdurun:
`launchctl kill SIGTERM gui/$(id -u)/com.getirbakim.parts2world-pending` ve `fetch-types`'ı hemen ardından başlatın:
işçi `StartInterval 1800` ile tetiklenir (KeepAlive yok), yani 30 dakika içinde kilidi yeniden alır. `fetch-types`
kilidi tuttukça launchd tetiklemeleri atlanır, bitince işçi kendiliğinden devam eder. `dev` çekildikten sonra koşan işçi yeniden başlayana dek
eski kodla (kategorisiz) çalışır; durdurup bıraktığınızda yeni kodla açılır.

**Operasyon sırası:** `fetch-types --limit 50` (örneklem, `mappedShare`'e bakın) → `backfill-types --source parts2world
--dry-run` → uzun koşu (≈34 bin tekil makale, istek başına ≥3 sn ile ≥28 saat) ya da gece dilimleri
(`fetch-types --limit 8000`) → `backfill-types --source parts2world`. Backfill tekrar koşunca `changed: 0` olmalı.

**storefront:sync maliyeti:** ilk yazımda ≈41–42 bin parts2world kaydının `imported_at`'i ilerler; ≈35 bin görsel
≈0,95 GB, 100 MB'lık ≈10 parça. AWS bu kayıtların araç uyumluluklarını yeniden kurar (parts2world kayıtları çok araçlı
olduğu için spareto'dan ağır); IndexNow/`lastmod` ve ana sayfa rafı da etkilenir. Yazan backfill'i 04:30 sync'inin hemen
öncesinde ve spareto backfill'i ile aynı gece koşmayın; önce `npm run storefront:sync -- --dry-run` özetine bakın.

### Bekletmeli yazım: `--hold` ve `release-categories` (#855)

Yukarıdaki iki backfill (spareto ≈33,7 bin, parts2world ≈41–42 bin kayıt) ilk yazımda `imported_at`'i ilerletir ve
sonraki `storefront:sync` hepsini görselleriyle birlikte gönderir. Bunu zamanlamak için:

1. `backfill-types --source spareto|parts2world --hold [--dry-run]`: aynı kategori ve `product_source_categories` yazımı,
   ama `imported_at` yerinde kalır (çıktıda `hold: true`); sync henüz bir şey taşımaz.
2. Yerelde kontrol edin (kategori listeleri, `changed: 0` ile tekrar koşu).
3. `release-categories --source spareto|parts2world|all [--dry-run]`: kaynağın kategorili (`payload->'categories'` boş
   değil) tüm kayıtlarının `imported_at`'ini şimdiye çeker; 5000'er satırlık ayrı işlemlerle çalışır, `--dry-run`
   yalnız sayar. Çıktı `{source, rows}`. Kaynağın işçilerin zaten gönderdiği kategorili kayıtlarını da yeniden gönderir
   (zararsız, içe aktarım idempotent); kategorisiz satırlara ve diğer kaynaklara dokunmaz. Kaynak URL ön ekleri
   `backfill-types` ile ortaktır (`typedSourceUrlPrefix`).
4. `npm run storefront:sync -- --dry-run` ile parça özetine bakın, sonra sync'in taşımasına izin verin.

Tek seferlik maliyet yukarıdaki "storefront:sync maliyeti" bölümleriyle aynıdır: kayıt sayısı (≈75 bin), görseller
(spareto ≈2,6 GB, parts2world ≈0,95 GB), AWS'de araç uyumluluklarının yeniden kurulması, IndexNow/`lastmod` ve ana sayfa
rafı. `--hold` ile bekletilenler, release edilene kadar sync'e girmez; ama işçi aynı satırı yeniden toplarsa o satırın
`imported_at`'i normal akışla ilerler.

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
- node --env-file=.env.local --conditions=react-server --import tsx scripts/category-images.ts
- node --env-file=.env.local --conditions=react-server --import tsx scripts/category-images.ts status

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

Katalog sidebar'ı kategori ağacı, çoklu üretici seçimi, kategoriye ait teknik filtreler, marka sınıfı ve stok durumunu gösterir. Teknik filtreler doğrulanmış enrichment kayıtlarından çıkarılır; EAN ve ölçü gibi yüksek çeşitliliğe sahip alanlar sidebar'a taşınmaz. Seçimler URL'de tutulur (`brands` JSON dizisi, `attributes` JSON nesnesi, `availability=in_stock|out_of_stock`); aynı gruptaki değerler OR, farklı gruplar AND ile eşleşir. Seçili filtreler mevcut seçenek listesini ortadan kaldırmaz. Seçenek metinleri sunucuda virgülle ayrılmış parça parça Türkçeleştirilir (`facetOptions`, `specification-translations.ts`); çevirisi aynı parça kümesine inen ham değerler (`Front Axle, Rear Axle` / `Rear Axle, Front Axle`) tek seçenek olur, URL ise ham değerleri taşımaya devam eder (seçenek tüm ham değerlerini ekler/çıkarır).

Kartlar grid/list görünümü, ilk dört teknik özellik ve genişletme, marka logosu, gerçek fiyat/stok, adet seçimi ve üç ürüne kadar karşılaştırma içerir. Fiyatı veya stoku güncel olmayan ürünler satın alınabilir gösterilmez. Bilinmeyen stok, “Stokta yok” filtresine dahil edilmez. OEM alternatifinden alınan teknik bilgiler kullanılabilir; alternatifin EAN, üretici, üretici parça numarası, ticari numaraları ve marka sınıfı kart kimliğine aktarılmaz. Marka sınıfı filtresi yalnızca birebir parça eşleşmelerini kullanır. Yöneticinin ürün sayfasında elle düzenlediği, eklediği veya gizlediği teknik özellikler (#603, `product_override_specs`) kartlarda, süzgeç seçeneklerinde ve öznitelik süzgecinde otomatik değerin önüne geçer.

Kontroller:
- `npm run test:catalog-filters`
- `node --env-file=.env.local --conditions=react-server --import tsx scripts/verify-catalog-filters.ts`

Trodo kartlarının görünür kalite/stok SVG simgeleri `/public/media/site/icons/` altında yerel olarak saklanır.

Katalog yerleşimi Trodo fren diskleri sayfası ile tarayıcıda karşılaştırılarak düzenlendi.
Masaüstünde 304 px sidebar, tek panel içindeki teknik filtreler, liste/ızgara kartları,
280 px kategori banner'ı ve kaydırınca sabitlenen arama alanı kullanılır. Fren banner'ı
yerel WebP dosyasından sunulur. İlgili kategori kartları ve alt bölüm aynı yerleşimi
izler; bağlantılar ve ticari bilgiler mağazanın kendi verileridir. Mobilde filtreler
kapalı başlar, ızgara kartlarının teknik ve satın alma alanları referanstaki gibi gizlenir.


### Ana ürün bazında Trodo kuyruğu — 11.10.2026

Trodo kapsamı `products` tablosundaki, başka ürüne yönlendirilmemiş ana ürünlerdir. Tedarikçi satırlarının toplamı bu kapsam değildir: aynı parçanın birden fazla teklifi ve ana kataloğa bağlanmamış fiyat listesi kayıtları ayrı kaynak ziyaretleri oluşturmaz.

`enrichment:prepare` mevcut eşleştirme şemasından sonra `db/enrichment-products.sql` dosyasını uygular. `enrichment_product_catalog` her ana ürün için tek temsilci ve durum seçer; önce geçerli tamamlanmış/kısmi kayıtlar, sonra mevcut sonuçlar, en son bekleyen teklifler seçilir. Otomatik kaynak bağları güncel kanonik marka/parça numarasına göre denetlenir; elle ayırma/birleştirme kararları korunur. Kimliği veya OEM'i değişmiş bir gözlem eski başarı olarak sayılmaz.

`product_enrichment_shared`, aynı ana ürünün tekliflerine özgün doğrulanmış gözlemi, görseli, kategori ve araç eşleştirmelerini paylaşır. Ham JSON ve araç satırları tedarikçi başına kopyalanmaz; doğrulama ve araç ayrıntıları özgün kaynak kaydı üzerinden okunur. Fiyat/stok ve muadil ürünler bağımsızdır. Teklif ayrılınca paylaşım anında sona erer. Ürün bağlantısı değişirse devam eden aktarım eski ana ürün adına kaydedilemez.

Mevcut koşular `product_id` ile ilişkilendirilir. Başlangıçta gereksiz bekleyen tekrarlar ve kapsam dışı teklifler `skipped` olur; eski sonuçlar, checkpoint ve kaynak önbelleği silinmez. Durdur/devam komutu aynıdır: `npm run enrichment:continue -- 4318 1000 --chrome`. Yeni partiler her ana ürünü bir kez seçer. Eski `product_enrichment_jobs` tablosu tedarikçi düzeyindeki geçmişi saklar; operasyonun toplam/kalan sayacı olarak kullanılmaz.

`/yonetim/urun-verileri` görünümü doğrudan okumaz: `db/enrichment-states.sql` her ana ürün için `enrichment_product_catalog` satırının materyalize hâlini `enrichment_product_states` tablosunda tutar (durum, temsilci tedarikçi satırı, OEM/araç/özellik sayıları, sıralama anahtarı). `products`, `product_sources`, `supplier_items` (kod, ürün verisi, varlık), `product_enrichment_jobs` ve `product_enrichments` üzerindeki trigger'lar etkilenen ürün kimliklerini `enrichment_product_state_queue` kuyruğuna yazar; `brands`/`supplier_brands` eşleme değişikliği tam yeniden kurma işareti bırakır. Sayfa her okumadan önce `enrichment_product_states_sync()` ile kuyruğu boşaltır: küçük kuyruk nokta nokta yenilenir, 20 binden büyük kuyruk veya işaret tüm tabloyu yeniden kurar (yerelde ~5 sn; görünüm için nested loop kapatılır, aksi hâlde dakikalar sürer). `npm run db:setup` ve `npm run enrichment:prepare` şemayı uygular; ilk kurulumda `db:setup` şema işleminden sonra bir senkron koşar. `npm run enrichment:states` tam yeniden kurar (`sync` argümanı yalnız kuyruğu boşaltır). Sayfadaki arama (#617) üç indeksli kimlik kümesinin birleşimidir: mağazayla aynı tedarikçi satırı eşleşmesi (`db/search.sql`), üretici parça numarası (`db/enrichment-search.sql` içindeki kısmi `enrichment_product_states_part_number_search_idx`) ve yalnız zenginleştirilmiş satırlarda OEM numaraları (`product_enrichments_oem_search_idx`); her küme birincil anahtardan okunur. `search_compact` değişirse bu indeks de `REINDEX INDEX enrichment_product_states_part_number_search_idx` ile yeniden kurulur.

`/yonetim/urun-verileri` kapsamı, durumları, zenginleştirme metrikleri ve son 24 saat hızını tekil ana ürünlerle hesaplar. Katalog turu hızı kartı süreç içinde bir dakika önbelleklenir. Parti kartı atlanan teklifleri ayrıca gösterir. Yerel şema geçişi için işçi önce SIGTERM ile durdurulur, `npm run enrichment:prepare` uygulanır ve aynı devam komutu yeniden başlatılır. Bu işlem deploy değildir; production şeması yalnız ayrıca istenen manuel yayın kapsamında uygulanır.

## otoparcasan.com ikinci kaynak — 14.10.2026

Trodo'da bulunamayan (`product_enrichment_jobs.status='not_found'`) ürünler otoparcasan.com'dan tamamlanır (#222). Kaynak düz HTTP ile okunur; tarayıcı gerekmez. İstekler sıralıdır, aralarında 1,5 sn + rastgele 0–0,75 sn beklenir (`OTOPARCASAN_INTERVAL_MS`). 403/429/503 ya da Cloudflare sayfası çalışmayı durdurur.

1. `POST Ajax/searchAll/` (CSRF'li; token her yanıtta yenilenir) ürün kodunu, bulunamazsa tedarikçi OEM'ini arar. Kod aramasında yalnız adresi stok koduyla **biten** ürünler aday olur: `FEBI 8098`'in araması `…-zp8098fmbp`'yi de döndürür.
2. Ürün sayfasından marka, stok kodu, "OEM Kodları" ve değeri olan "Teknik Bilgiler" satırları okunur. Kimlik Trodo ile aynı sözleşmeyle (`matchesEnrichment`) doğrulanır. Tedarikçi etiketinin yanında bağlı olduğu ana marka da kabul edilir: "KRAFTVOLL BALATA" etiketi "KRAFTVOLL" ana markasıyla sitedeki KRAFTVOLL ürünüyle eşleşir (#236). Mağaza aynı kontrolü `product_enrichment_shared.donor_master_brand` ile yineler. Kurallar: marka + parça, OE- tedarikçilerde orijinal parça numarası ya da tedarikçi OEM'inin sayfada kanıtlanması.
3. `POST Ajax/getCarsByStokAndMarkaAndModel` her araç markası için TecDoc araç satırlarını verir. Yakıtı boş satırlar TecDoc'un ticari araç ağacındandır (kamyon, çekici, beton mikseri) ve atılır; araç kataloğu yalnız binek ve hafif ticari araçları içerir. IVECO DAILY gibi kamyonetler binek ağacından gelir ve kalır.
4. Araçlar ortak katı eşleştiriciye (`strict-v3`) model adı (`MARKA MODEL`) ve tip adıyla verilir. Sitenin `typeId` alanı katalog id'si değildir.

Kaynak, araç üreticisini OEM numarasıyla birlikte vermez. Bu yüzden numaralar tek araç markası varsa o markanın, "PSA ORJINAL" gibi orijinal parçalarda o üreticinin, aksi halde `OE` başlığı altında tutulur. Kısaltılmış listelemeler atılır (`544103E100` yanında `544103`).

Ürün görseli sayfanın `og:image` adresidir (#227). Yalnız `image.otoparcasan.com/…/products/…` kabul edilir; görseli olmayan ürünlerde site istemci tarafında "ürün görseli hazırlanmaktadır" yer tutucusunu gösterir, bu kaydedilmez. İndirilen içerik PNG, JPEG ya da WebP olarak doğrulanır, gerçek genişlik/yükseklik başlıktan okunur ve görsel Trodo'yla aynı yoldan (`storeProductImage`, sha256 ile tekil) S3'e yazılır. Site uzantıdan bağımsız olarak WebP döndürebilir.

```bash
npm run enrichment:otoparcasan -- collect --limit 2000  # bulunan her ürünü anında yazar (Trodo işçisi gibi)
npm run enrichment:otoparcasan -- collect --dry-run     # yazmaz; paketler yalnız artifacts/otoparcasan/results.jsonl'e
npm run enrichment:otoparcasan -- report                # bulunan/OEM/özellik/araç ve katalogla eşleşen araç sayıları
npm run enrichment:otoparcasan -- import                # yazılmamış paketleri yazar (iş hâlâ not_found ise)
npm run enrichment:otoparcasan -- images                # görselsiz yazılmış otoparcasan ürünlerine görsel ekler
```

Her paket önce checkpoint'e eklenir, sonra `importEnrichments` ile yazılır (#224). Bağlantı hatasında 5 sn, 30 sn ve 2 dk sonra tekrar denenir. Yine olmazsa çalışma durur; paket checkpoint'te kalır ve bir sonraki `collect` ya da `import` önce bekleyenleri yazar. Sözleşmenin reddettiği ya da artık açık olmayan ürün atlanır. `--status pending` Trodo'nun henüz uğramadığı işleri arar; ana ürün başına tek tedarikçi satırı seçilir ve başka satırı zaten zenginleştirilmiş ürün atlanır (#236). `--status review` Trodo'nun aday bulup doğrulayamadığı işleri arar (#245). Yazımdan hemen önce iş hâlâ `not_found`, `pending` ya da `review` değilse (ör. Trodo bu arada tamamladıysa) ürün atlanır. `collect` kaldığı yerden devam eder; `--retry` önceki sonuçları (yazılanlar hariç) yeniden dener, `--ids <dosya>` belirli ürünleri işler. `images` görseli bulunmayan ürünleri `artifacts/otoparcasan/images.jsonl`'e yazar ve tekrar denemez; eklenen görselde `imported_at` güncellenir. Yazılan veri gece `storefront:sync` ile canlıya gider.

İlk 26 ürünlük örneklemde 19 ürün bulundu, yanlış eşleşme olmadı. 1.613 ticari araç satırı atıldı. Kalan 228 binek araç satırının 190'ı katalogdaki tek bir tiple eşleşti. Eşleşmeyenlerin nedenleri: modelin katalogda olmaması (20), sitenin bitiş tarihini açık bırakması (14), güç ya da motor adı farkı (4).
