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

`enrichment:prepare` şemayı oluşturur ve `supplier_items` kayıtlarını takip tablosuna ekler. Tekrar çalıştırılması tamamlanan kayıtları sıfırlamaz. Şema dosyalarını 5 sn'lik `lock_timeout` ile uygular: her tablo kilidi için en fazla 5 sn bekler, alamazsa "schema is busy" hatasıyla çıkar; sonra yeniden deneyin. Alınan şema kilitleri yalnız şema dosyalarının transaction'ı boyunca tutulur; kuyruğu dolduran ve `enrichment_product_states`'i okuyan (#923) adım ayrı transaction'da, yalnız satır kilitleriyle koşar. İki `prepare` aynı anda koşmaz (oturum düzeyinde advisory lock). İşçiler (`enrichment:continue`, spareto, parts2world, `vehicles:oil-trodo`) açılışta şema uygulamaz, yalnız tabloların var olduğunu kilitsiz denetler; eksikse `npm run db:setup` ister (#921). Önceden her açılıştaki `ALTER TABLE`, uzun bir okumanın arkasında beklerken `/yonetim/urun-verileri` okumalarını da sıraya sokuyordu. Bu **kuyruk hazırlığıdır**; bekleyen ürünlerin kaynaktan çekildiği anlamına gelmez. Yeni tedarikçi kayıtları geldikten sonra yeniden çalıştırılabilir.

## Yer tutucu görseller

Mağazada gösterilmemesi gereken otomatik (zenginleştirme) görseller iki katmanda tutulur:

1. **Kod sabiti (yer tutucu listesi, #1098).** Yer tutucu (ürün fotoğrafı olmayan) kaynak görseller `src/modules/enrichment/placeholder-images.ts` içindeki SHA-256 listesinde tutulur; yerel işçiler, temizlik ve AWS mağazası aynı sabiti kullanır. Mağaza bu listeyi okuma anında uygular. `/yonetim/ortak-gorseller` listenin durumunu gösterir (kullanılıyor, temizlendi, bu veritabanında yok); bu liste panelden değiştirilmez. Akış: `npm run enrichment:placeholders -- candidates` → görsellere bakıp inceleme → sabite ekleme → `clean --apply` → `npm run storefront:sync`.
2. **Panel engeli (`product_image_blocks`, #1136).** `/yonetim/ortak-gorseller` listesinde ve görsel ayrıntısında "Engelle" ile bir görsel, onu kullanan bütün ürünlerde gizlenir; "Engellenen görseller" kartından "Engeli kaldır" ile geri gelir. Tablo SHA-256 ile tutulur (medya kimlikleri makineler arasında farklıdır). Kod listesindeki bir görsel panelden engellenemez; zaten gizlidir.

Panel engeli bağlantı türetilirken uygulanır: `product_enrichment_shared_refresh()` (`db/enrichment-shared-links.sql`), engelli bir görseli `product_enrichment_shared_links.image_id` alanına `NULL` olarak yazar. `product_enrichments.image_id` değişmez; bu yüzden engel kaldırılınca görsel geri gelir ve mağaza okumalarına ek maliyet binmez. Engelleme, görseli kullanan zenginleştirme kayıtlarını kuyruğa ekler ve bağlantıları hemen yeniden hesaplar (en çok paylaşılan görsel, 323 kayıt / 509 bağlantı, yerelde ~0,6 sn); kuyrukta tam yeniden kurma işareti veya 1000'den fazla kayıt varsa ya da senkron o an başka bir görevdeyse istek beklemez, 5 sn'lik döngü uygular. Engel, görseli artık hiçbir kayıt kullanmasa da kaldırılabilir. Panel engelli görseli yöneticiye `/api/admin/product-media/<uuid>` üzerinden gösterir (#1176): yalnız yönetici oturumuyla, `Cache-Control: private, no-store` ile ve yalnız o an engelli medya için yanıt verir; `/api/product-media` engelli görsel için 404 döndürmeye devam eder. Ürün sayfası, listeler, ana sayfa rafları, `/api/product-media` ve ürün akışı `storefront_enrichments` üzerinden okuduğu için hepsi aynı kaynaktan etkilenir; yönetici yüklemeleri etkilenmez.

- **`storefront:sync` engeli geri almaz:** paket zenginleştirmeleri taşır, bağlantıları AWS türetir; türetme engeli yeniden uygular.
- **Yerel ortam engelden habersizdir:** engel AWS veritabanında durur, yerele taşınmaz (izleyen iş). Yerelde aynı görsel gösterilmeye devam eder.
- **Panel engeli için `clearPlaceholderImages` / `enrichment:placeholders clean` ASLA çalıştırılmaz:** temizlik `product_enrichments.image_id` alanını siler; engel bu durumda geri alınamaz hale gelir (görsel ancak yeniden zenginleştirmeyle döner).
- **Önbellek:** `/api/product-media/<id>` yanıtları `Cache-Control: public, max-age=86400` ile gönderilir; görselin doğrudan adresi tarayıcı veya CDN önbelleğinden 24 saate kadar sunulabilir. `/_next/image` için `minimumCacheTTL` 31 gündür (`next.config.ts`, görev başına disk önbelleği): önceden optimize edilmiş bir varyant, görev değiştirilene kadar doğrudan adresiyle erişilebilir kalır; sayfalar ona hemen başvurmayı bırakır. Sayfalar ve listeler eylemle yenilenir (`revalidatePath`, listeleme epoch'u). Ürün akışı (merchant feed) görseli bir sonraki üretiminde düşürür.

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

1. Son başarılı aktarımdan sonra içe aktarılan zenginleştirmeleri, bunların kategori eşlemelerini ve görsellerini dışa aktarır. Kategori ağacı, logolar ve tamamlanmış/kısmi zenginleştirme işlerinin durumları her seferinde tam gönderilir; REPXPERT araç verisi yalnız değiştiğinde ya da tam gönderimin zorunlu olduğu durumlarda gider (#1359, aşağıda).
2. Paketi AWS'ye gönderir ve canlıda içe aktarır (ayrıntı aşağıda). Tek hedef AWS'dir; eski VPS hedefi (SSH + rsync, `production-task.sh import-storefront`) #563 ile kaldırıldı.

Filigran yalnızca canlı paketi uyguladıktan sonra ilerler; başarısız bir çalıştırma bir sonrakinde tamamen tekrarlanır. Anlık görüntü sırasında sürmekte olan içe aktarmaları kaçırmamak için 1 saat geri örtüşme bırakılır; içe aktarma upsert olduğu için tekrar zararsızdır.

`npm run storefront:sync:install` her gün 04:30'da çalışan launchd işini kurar. Mac o saatte uykudaysa iş uyanınca çalışır. Günlük `.local/storefront-sync/sync.log` dosyasına yazılır; kaldırmak için `npm run storefront:sync:uninstall`.

#### Hedef, filigran ve bayraklar (#553)

Parçalar S3 inbound kovasına yüklenir ve tek bir ECS görevi `scripts/import-storefront-inbound.ts`'i çalıştırır: tüm parçaların kuru çalıştırması → uygulama → `rebuild-product-fitments.ts --items` (yalnız paketin yazdığı ürünler ve eski `matcher_version`'lı satırlar; liste görevin geçici dizinindeki `fitment-items.json`'dadır, `report.json`'a girmez) → paylaşılan bağlantı kuyruğunun boşaltılması (`product_enrichment_shared_sync()`) → `enrichment-states.ts sync`.

- **Paket düzeni ve parçalar (#1316, #1317):** dışa aktarma `<paket>/full/` altına, zenginleştirilmiş ürün sayısıyla büyüyen her satır kümesini ayrı bir NDJSON dosyasına (satır başına bir JSON) yazar: `enrichments.ndjson` (zenginleştirmeler, `supplier_item_id` sırasıyla), `jobs.ndjson` (tüm `complete`/`partial` iş durumları), `items.ndjson` (tedarikçi ürün anahtarları), `products.ndjson` (kategori eşlemeleri) ve `media.ndjson` (medya satırları). `manifest.json` yalnız zenginleştirilmiş ürünle büyümeyen kalanı (kategori ağacı, logolar, REPXPERT araç verisi ve özeti `vehicleData`, silme kayıtları, sayılar) ve her dosyanın adını ve satır sayısını (`enrichmentsFile`/`enrichmentCount`, `jobsFile`/`jobCount`, `itemsFile`/`itemCount`, `productsFile`/`productCount`, `mediaFile`/`mediaCount`) taşır; medya dosyaları `media/` altındadır. Zenginleştirmeler aynı REPEATABLE READ anlık görüntüsünde 200'lük partilerle okunup dosyaya akıtılır; bu satırlar hiçbir adımda tek bir metin olmaz. Bölme NDJSON dosyalarını satır satır okur ve her parçayı kapanınca yazar. Sıra: `part-00` her seferinde tam giden veriyi (kategori görselleri, logolar, gönderildiyse REPXPERT verisi (#1359), silme kayıtları, `invalidatedJobs`) medyasıyla taşır ve iş taşımaz (`jobs: []`); hemen ardından **iş parçaları** tüm iş durumlarını, sonra zenginleştirme parçaları zenginleştirmeleri taşır. Parça 100 MB medya **veya** 64 MB JSON sınırında kesilir: iş parçasında işin satırı ve tedarikçi ürün anahtarı, zenginleştirme parçasında zenginleştirme satırı, eşlemeleri, parçaya ilk kez giren medya satırı ve anahtarı sayılır (görselsiz zenginleştirmeler de). Tek başına sınırı aşan satır kendi parçasına gider, boş parça oluşmaz. part-00'dan sonraki her parçada `tombstones: []` ve `invalidatedJobs: 0` olur; aksi halde silmeler yeniden uygulanır, geçersiz iş sayısı her parçada yeniden toplanırdı. Böylece hiçbir manifest zenginleştirilmiş ürün sayısıyla büyümez: iş ve zenginleştirme parçaları en çok boş parça (küçük kategori ağacı) + 64 MB'tır, ürün sayısı artınca yalnız parça sayısı artar (`scripts/test-storefront-split.ts`). part-00'ın bayt sınırı yoktur, ama zenginleştirilmiş ürünle de büyümez: silme kayıtları saklama penceresindeki (90 gün, `--full` ile tüm günlük) silmeler, REPXPERT verisi araç tipleri kadardır (2026-11-24: ~21 MB). `part-NN/manifest.json` biçimi (anahtar kümesi) değişmedi. Bölmenin çıktı biçimi altın dosyayla korunur (#1358): `scripts/test-storefront-split.ts` part-00, iş parçaları ve zenginleştirme parçalarının anahtar + değer türü şemasını `scripts/fixtures/storefront-part-format.json` ile karşılaştırır (üst düzey anahtarlar ve türler, her parça türünün boşalttığı diziler, gerçek satır biçimlerinin bozulmadan geçmesi). Dışa aktarım ya da içe aktarıcının sütun değişikliğini tek başına yakalamaz; o, veritabanında dışa aktarım→bölme→içe aktarım koşusu ister. AWS'deki içe aktarıcı bu biçimi okuduğundan değişiklik gerekiyorsa önce içe aktarıcıyı (geriye uyumlu) sürümleyin, sonra bölmeyi değiştirin ve altın dosyayı `UPDATE_GOLDEN=1 node --import tsx --test scripts/test-storefront-split.ts` ile yenileyin (CI'da reddedilir). `full/` dizini doğrudan `import-storefront-bundle.ts`'e verilemez (hata verir); yalnız parçaları içe aktarılır. Köken: 2026-11-23'te ~43 bin zenginleştirmelik fark (~729 MB JSON, çoğu `payload.vehicles`) tek `JSON.stringify(manifest)` ile V8'in ~512 MiB metin sınırını aştı (`RangeError: Invalid string length`); filigran yalnız başarılı içe aktarmada ilerlediği için hata kendiliğinden düzelmiyordu (#1316). Ardından temel manifest ve onun kopyası part-00, yalnız iş durumları (~53 MB) ve anahtarlarıyla (~28 MB) ~115 MB'a varmıştı ve zenginleştirilmiş ürünle doğrusal büyüyordu; sınır kabaca ~800 bin üründe aşılacaktı (#1317).
- **Geçiş (#1317):** parça biçimi değişmedi, yalnız iş durumları part-00 yerine ardından gelen iş parçalarında gider. v0.39.0'dan beri canlıdaki içe aktarıcı bir parçanın `jobs` listesini yalnız upsert eder (`storefront-bundle-jobs.ts`); listede olmayan işi silmez ya da sıfırlamaz. Silme kayıtları part-00'da, işlerden önce uygulanır (önceden de aynı parçada işlerden önceydi); rapor sayıları parçalar üzerinden toplanır ve senkron rapordan yalnız `snapshotAt`'i karşılaştırır. Bu yüzden önce içe aktarıcıyı sürümlemek gerekmez, `release-aws` gerekmez: değişiklik ana checkout bu commit'e geçince 04:30 launchd çalıştırmasıyla devreye girer. Aynı içe aktarıcı eski biçimi de okuduğundan geri dönüş ana checkout'u önceki commit'e almaktır. Bu sürümün bölmesi eski biçimli bir `full/` dizinini "export it again with this version" hatasıyla reddeder; senkron her çalıştırmada yeni dizin kullandığı için bu yalnız elle bölmede görülür.
- **REPXPERT araç verisi yalnız değişince gider (#1359):** dışa aktarma REPEATABLE READ anlık görüntüsü içinde `vehicle_type_specs` (hata olmayan satırlar), `vehicle_type_images` ve bu görsellerin medya satırlarının `[id, sha256, size_bytes]` değerlerinden, bir sürüm etiketiyle (`VEHICLE_DATA_VERSION`) birlikte sha256 özeti hesaplar (`storefront-bundle-export.ts` `vehicleDataDigest`). Senkron, canlının son onayladığı özeti `--vehicle-digest=<hex>` ile verir; özet aynıysa paket `vehicleSpecs: []` ve `vehicleImages: []` taşır, araç görselleri (~4 bin nesne) part-00'a girmez. Özet ve sayılar `manifest.vehicleData`'dadır (`{ digest, specs, images, sent }`); bölme bu anahtarı hiçbir parçaya koymaz, parça biçimi değişmez (altın dosya aynı). Argümansız elle dışa aktarma her zaman tam gönderir. Tam gönderim şu durumlarda zorunludur: (1) `state.aws.json`'da `vehicle` kaydı yok (ilk çalıştırma, yeni hedef, yeni `--baseline`); (2) özet değişti; (3) `--full`; (4) `--vehicle-data`; (5) son onaylı gönderim 7 gün (`VEHICLE_RESEND_DAYS`) ya da daha eski (saat geri alındığı için "gelecekte" görünen gönderim de); (6) önceki çalıştırma başka bir operations görev tanımı revizyonu gördü (bir `release-aws` içe aktarıcıyı değiştirmiş olabilir; revizyon zaten alınan `run-task` yanıtındaki `taskDefinitionArn`'dan okunur, IAM değişikliği gerekmez). `vehicle` kaydı yalnız rapor gönderilen her satırı hesaba kattığında yazılır: `totals.vehicleSpecs + totals.skippedVehicleSpecs` gönderilen spec sayısına, görseller için de aynısı eşit olmalıdır. Bu sayıları yazmayan (veriyi yok sayan) bir imaj ya da tutmayan sayılar hiçbir şey kaydettirmez; veri sonraki çalıştırmada yine tam gider (bugünkü gibi). Canlıda araç tipi olmadığı için atlanan satırlar (`skippedSpecs`/`skippedImages`) uyarıyla kaydedilir ve ancak bir sonraki tam gönderimde yeniden gider; veriyi atlayan her çalıştırma bu iki sayıyı ve gönderim zamanını, araç tipleri canlıya gelince `--vehicle-data` ile çalıştırma önerisiyle not olarak yazar. Yerelde silinen araç satırları canlıdan silinmez (önceden de öyleydi: içe aktarıcı yalnız upsert eder).
- **Ölçüm (#1359):** 2026-11-25 yerel kuru çalıştırma (`--dry-run --baseline=2026-11-25T01:32:15.465Z` ile tam gönderim, ardından aynı filigranlı `vehicle` kaydıyla `--dry-run`; `since` 2026-11-25T00:32:15Z; yerel REPXPERT verisi 37.937 spec, 26.617 görsel, 4.009 medya nesnesi, 2026-10-19'dan beri değişmedi). Tam gönderimde part-00: 4.455 medya + `manifest.json` = 4.456 nesne, 72,7 MB medya + 22,0 MB JSON (~90 MiB). Özet aynıyken: 446 medya + `manifest.json` = 447 nesne, 2,6 MB medya + 1,5 MB JSON (~3,9 MiB). Tüm paket: 8.126 → 4.129 medya, 218 → 149 MB medya, 182 → 161 MB JSON; dışa aktarma 15,2 → 7,1 sn.
- **Uçtan uca test (#1372):** `npm run test:storefront-e2e` (CI'da da koşar) iki yalıtılmış şema (kaynak, hedef) ve testin içindeki S3 saplaması arasında gerçek `export-storefront-bundle.ts` → `splitStorefrontBundle` → `import-storefront-bundle.ts` sürecini çalıştırır (tam; delta + silme kaydı + yeniden deneme; araç verisi değişince) ve taşınan her tabloyu satır satır karşılaştırır. Hem hedefte olmayan satırların eklenmesini (insert) hem hedefte olan satırların güncellenmesini (2. çalıştırma tablo başına bir satırın her anahtar olmayan sütununu değiştirir, 3. çalıştırma araç verisini) sınar; bu yüzden `ON CONFLICT DO UPDATE SET` listesinden unutulan bir sütun da testi düşürür. Karşılaştırmada farklı olabilecek tek yer, testteki `LOCAL_ONLY` listesidir (tablo başına sütun + gerekçe: ör. içe aktarıcının yazdığı `attempts`, yerel kalan `payload`); orada olmayan her fark testi düşürür; taşınan tablolarda hiçbir satırda dolu olmayan ya da yalnız sabit varsayılan değerini taşıyan bir sütun da (`assertColumnCoverage`) düşürür. `INSERT_ONLY` içe aktarıcının yalnız eklerken yazıp mevcut satırda güncellemediği sütunları (şimdilik `product_enrichment_jobs.oem` ve `last_attempt_at`) listeler: güncelleme sonrası karşılaştırmalar bunları atlar, böylece boşluk görünür kalır. Dışa aktarıcı SELECT'inde ya da içe aktarıcı INSERT'inde sütun değişen her PR `npm run test:storefront-e2e`'yi yeşil tutmalı; yeni sütun için fixture'a değer ekleyin ya da gerekçesiyle `LOCAL_ONLY`'ye yazın.
- **Geçiş (#1359):** içe aktarıcı değişmez, `release-aws` gerekmez: canlıdaki içe aktarıcı boş dizileri zaten işlemsiz geçer (part-00'dan sonraki her parça bugün de boş dizi taşır) ve `vehicleSpecs`/`skippedVehicleSpecs`/`vehicleImages`/`skippedVehicleImages` sayılarını rapora zaten yazar. Ana checkout bu commit'e geçtikten sonraki ilk çalıştırma (`vehicle` kaydı yok) veriyi tam gönderir ve rapor onaylayınca özeti kaydeder; sonrakiler veri değişmedikçe atlar. `STOREFRONT_SYNC_PREFIX_MODE=run`'da her çalıştırma boş önekten başlar; sabit `current` önekinde ilk atlayan çalıştırmanın `s3 sync --delete`'i part-00'daki ~4 bin araç görselini inbound kovasından bir kez siler (canlı veritabanı ve medya kovası etkilenmez). Geri dönüş ana checkout'u önceki commit'e almaktır: eski kod `vehicle` alanını okumaz, ilk yazışta düşürür ve her seferinde tam gönderir.
- **Hedef geri yüklenirse (#1359):** canlı veritabanı geri alınır (RDS PITR) ya da araç tabloları orada elle değiştirilirse senkron bunu görmez. Sonraki çalıştırmayı `npm run storefront:sync -- --vehicle-data` (yalnız araç verisi tam) ya da `--full` ile yapın; yeni bir hedef için `--baseline=<ISO> --force` `vehicle` kaydını zaten düşürür. Aksi halde veri en geç 7 gün içinde kendiliğinden yeniden gider.
- **Yükleme doğrulaması (#1129):** parçalar tek tek yüklenir; her biri geri listelenip kendi `manifest.json`'una göre denetlenir (nesneler var, boyutlar tutuyor, fazlalık yok). Önceki çalıştırmadan kalan parçalar silinir. Denetim iki denemede de geçmezse içe aktarma başlamaz ve filigran ilerlemez. Çalıştırma boyunca `caffeinate` tutulur; 2026-11-21'deki gecikmenin nedeni Mac'in uyumasıydı.
- **Çalıştırmaya özel önek (#1137, isteğe bağlı):** `STOREFRONT_SYNC_PREFIX_MODE=run` ile her çalıştırma `storefront/current/run-<snapshotAt>/` (ör. `run-20261121T085201308Z/`) altına yüklenir ve ECS görevi bu öneke yönlendirilir; eski bir çalıştırmanın nesneleri içe aktarılamaz. Rapor başarıyla okunup filigran yazıldıktan sonra sabit düzenin `part-NN/` dizinleri ve en yeni bir önceki çalıştırma dışındaki eski `run-*` önekleri silinir (`KEEP_RUNS = 2`; geçerli çalıştırma ve ondan yeni önekler hiç silinmez, tanınmayan dizinlere dokunulmaz; silme hatası yalnız uyarıdır). Varsayılan (`current` ya da tanımsız) tek sabit `storefront/current/` önekidir. Her operations imajı uyumludur: `import-storefront-inbound.ts` öneki argüman olarak alır ve yalnız `part-NN/` dizinlerini okur. **Engel:** görev raporu `internal/storefront-sync/storefront/current/run-…/report.json`'a yazar; senkron rolü bugün yalnız `…/storefront/current/report.json`'u okuyabilir. Sıra: getirbakim-infra `access-stack.ts` `ReadImportReport` kaynağına `…/${STOREFRONT_SYNC_PREFIX}/run-*/report.json` eklenir → onaylı CDK dağıtımı → `.env.local`'a `STOREFRONT_SYNC_PREFIX_MODE=run`. Altyapı değişikliği olmadan `run` modu içe aktarmayı tamamlar ama raporu okuyamaz (403) ve filigran ilerlemez. Yükleme, listeleme ve silme izinleri `storefront/current/*` altında zaten vardır. Çalıştırma raporları medya kovasında birikir (küçük JSON; rol silemez). İki modu aynı anda farklı checkout'lardan çalıştırmayın: kilit checkout'a özeldir ve varsayılan modun artık nesne temizliği `run-*` yüklemesini, `run` modunun temizliği de sabit düzenin `part-NN/` dizinlerini silebilir. Altyapı dağıtımı ve `infra#9`: getirbakim-infra PR #9.
- **Yükleme hızı ve oturum:** 15.632 medya / 463 MB'lık (5 parça) kuru çalıştırmada dışa aktarma + bölme 36 sn sürdü (2026-11-21); darboğaz yerel dışa aktarma değil yüklemedir. Her parça ayrı bir `aws s3 sync` sürecidir: profilin assume-role kimlik bilgisi her parçada CLI önbelleğinden alınır ya da yenilenir, tek bir yükleme bütün çalıştırmaya yayılmaz. `STOREFRONT_SYNC_S3_CONCURRENCY=<n>` (1–64) AWS CLI'ın `max_concurrent_requests` değerini (varsayılan 10) yalnız bu çalıştırmanın `aws s3` çağrılarında ayarlar: `~/.aws/config`'in geçici bir kopyası (paket dizininde, sonda silinir) `AWS_CONFIG_FILE` ile verilir, kullanıcının dosyası değişmez. Her parçanın `uploadMs` değeri günlüğe yazılır; kuru çalıştırma `exportMs` / `splitMs` verir.
- **Filigran:** `.local/storefront-sync/state.aws.json`. `STOREFRONT_SYNC_TARGET` artık okunmaz; `aws` dışında bir değer (eski `vps`) tanımlıysa betik hata verir. Durum dosyası `snapshotAt`, `syncedAt`, `target`, `since`, gönderilen sayıları, gerekiyorsa `retry` listesini ve canlının onayladığı REPXPERT verisinin `vehicle` kaydını (`digest`, `specs`, `images`, `sentAt`, `taskDefinition`, `skippedSpecs`, `skippedImages`; #1359) tutar. Yollar komutun çalıştığı dizine göredir; başka bir worktree'den çalıştırma ana checkout'un filigranına dokunmaz.
- **Bayraklar katıdır:** yalnız `--dry-run`, `--full`, `--force`, `--vehicle-data`, `--max-deletions=<n>` ve `--baseline=<ISO>` kabul edilir; başka her argüman (`--dryrun`, `-n`, boşlukla yazılmış `--baseline 2026-…`) hata verir, gerçek çalıştırmaya dönüşmez.
- **`--baseline=<ISO>`:** `--dry-run` olmadan hedefin son anlık görüntüsünü `<ISO>` olarak kaydeder (`baseline: true`) ve çıkar; kilit altında çalışır, var olan durumu yalnızca `--force` ile ezer (varsa `retry` listesi korunur; `vehicle` kaydı korunmaz, sonraki çalıştırma REPXPERT verisini tam gönderir). Zaman dilimi açık yazılmalıdır (`Z` ya da `±hh:mm`); dilimsiz, gelecekteki ya da geçersiz zaman reddedilir. `--dry-run` ile birlikte yalnızca o çalıştırmanın filigranıdır, hiçbir şey yazılmaz; REPXPERT kararı da gerçek bir baseline'dan sonraki çalıştırma gibi durum dosyasındaki `vehicle` kaydını yok sayar (`reason: no-state`, tam gönderim).
- **Durum dosyası yoksa** çalıştırma durur: `--baseline=<ISO>` ile son aktarılan anı kaydedin ya da bilinçli olarak her şeyi göndermek için `--full` kullanın.
- **`--full`:** filigranı yok sayıp tüm zenginleştirmeleri gönderir; `--baseline` ile birlikte kullanılamaz.
- **`--vehicle-data` (#1359):** özet aynı olsa da REPXPERT araç verisini tam gönderir; filigran ve zenginleştirmeler her zamanki gibidir. Gerçek `--baseline` ile kullanılamaz (`--dry-run --baseline` ile kullanılabilir).
- **`--max-deletions=<n>`:** içe aktarmanın yerel silmeler için canlıda silebileceği en fazla zenginleştirme sayısı (varsayılan 1000, pozitif tam sayı); aşağıdaki bölüme bakın.
- **`--dry-run`:** dışa aktarır ve parçalara böler, hedefi (`aws`), `since`, `snapshotAt`, REPXPERT verisinin özetini ve kararını (`vehicle`: `digest`, `specs`, `images`, `sent`, `reason` = `no-state` | `full` | `forced` | `stale` | `unchanged-candidate`; sonuncusunda `sent: true` özetin değiştiğini gösterir), satır sayılarını, MB'ı ve parça dökümünü (part-00 ayrı; her parçanın `mediaBytes` ve `manifest.json` boyutu olarak `jsonBytes` değeri) JSON olarak yazar. İş durumları iş parçalarında olduğundan part-00'ın `jobs` değeri 0'dır; toplam `totals.jobs`'tadır (#1317). Aktarım yapmaz, filigran yazmaz, kilit almaz; AWS profili istemez. Yerel veritabanı ve yerel nesne deposu (MinIO) okunur.
- **Kilit:** gerçek çalıştırmalar ve `--baseline` `.local/storefront-sync/sync.lock` (`{pid, startedAt, target}`) alır; launchd ve elle çalıştırma çakışmaz. Kilidi tutan süreç ölmüşse ya da kilit 24 saatten eskiyse devralınır; `startedAt` geçersizse devralınmaz, hata verilir; Ctrl-C/SIGTERM kilidi bırakır. Hata mesajı kilit dosyasının yolunu verir; o süreç bir aktarım değilse dosyayı silin.
- **Atlanan zenginleştirmeler (`retry`):** tedarikçi ürünü canlıda henüz yoksa (canlı ve yerel tedarikçi senkronları ayrı) zenginleştirme atlanır. İçe aktarma görevi uygulamadan sonra medya kovasına (`S3_BUCKET`, herkese kapalı) `internal/storefront-sync/<önek>/report.json` anahtarıyla (sabit önekte `internal/storefront-sync/storefront/current/report.json`) toplam sayıları ve atlanan ürünlerin anahtarlarını (`id`, `supplier`, `company`, `list_group`, `warehouse`, `code`) yazar. Yerel aktarım görev başarıyla bitince raporu indirir, atlanan varsa uyarır ve anahtarları `state.aws.json`'da `retry` olarak saklar. Sonraki dışa aktarım bu ürünlerin zenginleştirmelerini filigrandan bağımsız olarak yeniden gönderir (`export-storefront-bundle.ts --retry-file`, kimlik ya da doğal anahtar eşleşmesi); liste her çalıştırmada yeni raporun atlanan kümesiyle değiştirilir ve 10.000 anahtarla sınırlıdır (sayı her zaman tam raporlanır). Raporu yazamayan görev başarısız biter (veri yazılmış olsa da). Görev başarıyla bitmiş ama rapor yoksa (eski operations imajı) ya da rapordaki `snapshotAt` bu paketinkiyle uyuşmuyorsa aktarım iki durumu ayrı mesajla belirterek hata verir; filigran ve `retry` listesi ilerlemez, sonraki çalıştırma aynı veriyi yeniden gönderir (içe aktarma idempotent). Atlanan anahtar sayısı 10.000'i aşarsa uyarı, ürünler canlıya geldiğinde `--full` ile çalıştırmayı önerir. Rapor her çalıştırmada üzerine yazılır.
- **Kategori eşlemeleri değiştirilir:** paketteki her zenginleştirmenin canlıdaki `product_source_categories` satırları, paketin taşıdığı kaynaklar (ör. `trodo`) için silinip paketteki satırlarla aynı işlemde yeniden yazılır; kategorisi değişen ürün eski kategoriyi tutmaz.
- **`aws` ön kontrolü:** yüklemeden önce `aws ecs list-tasks --started-by storefront-sync --desired-status RUNNING` çalışır; süren bir içe aktarma görevi varsa ya da çağrı başarısız olursa çalıştırma durur.

#### Yerelde topla → AWS'ye aktar

Zenginleştirme işçileri (Trodo, otoparcasan, spareto, parts2world) yerelde çalışır ve yerel veritabanına yazar; canlıya yalnızca bu aktarım taşır.

1. `.env.local`: `PRODUCTION_AWS_PROFILE` (adlandırılmış profil, `default` değil).
2. İlk kez: son aktarılan anı kaydedin, sonra kuru çalıştırma ile ne gideceğine bakın:
   ```bash
   npm run storefront:sync -- --baseline=2026-11-13T05:47:24Z
   npm run storefront:sync -- --dry-run
   ```
3. Gerçek yazma (`npm run storefront:sync`) yalnız kullanıcının açık onayıyla. Sonraki çalıştırmalar filigrandan devam eder; günlük çalıştırma için launchd işi isteğe bağlıdır (`npm run storefront:sync:install`).

İlk gerçek çalıştırmadan önce yeni bir operations imajı (`release-aws`) gerekir: iş durumlarını içe aktaran `import-storefront-bundle.ts` ve kuyrukları boşaltan `import-storefront-inbound.ts` imajın içindedir. Eski imaj paketteki `jobs` alanını yok sayar ve yeni zenginleştirmeler mağazaya düşmez. IAM değişikliği gerekmez: operations görev rolü inbound kovayı yalnız okuyabilir, raporu zaten yazabildiği medya kovasına yazar. Yerel aktarım medya kovasını Data yığınının `MediaBucketName` çıktısından, yoksa operations görev tanımındaki `S3_BUCKET`'tan bulur. Eski imaj rapor yazmadığı için yeni imaj olmadan gerçek çalıştırma filigranı ilerletmeden hata verir.

#### Tablo kararları

| Tablo | Karar | Not |
| --- | --- | --- |
| `product_enrichments`, `product_source_categories`, `product_media_objects`, kategori ağacı, logolar, `vehicle_type_specs` / `vehicle_type_images` | Pakette | Zenginleştirmeler `imported_at > since`; ağaç ve logolar her seferinde tam; REPXPERT verisi özet değişince ya da zorunlu tam gönderimde (`vehicle` kaydı yoksa, `--full`, `--vehicle-data`, 7 gün, yeni görev tanımı; #1359), aksi halde boş |
| `product_enrichment_jobs` (yalnız `complete`/`partial` ve zenginleştirme satırı olan) | Pakette, her seferinde tam, part-00'dan sonraki iş parçalarında (#1317) | `product_enrichments`'ta durum yok; `enrichment_valid_data` (`db/enrichment-products.sql`) iş durumuna JOIN yapar. İşler gitmezse yeni zenginleştirme `product_enrichment_shared_links` → `storefront_enrichments`'a ulaşmaz. Yalnız değişen satır yazılır (`IS DISTINCT FROM`), aksi halde tetikleyiciler tüm satırları (2026-11-24'te ~198 bin) her seferinde kuyruğa alır; bir parçada olmayan iş silinmez ya da sıfırlanmaz |
| `product_enrichment_shared_links`, `storefront_make_fits`, `storefront_model_fits`, `storefront_make_description_fits` | AWS'de türetilir | İçe aktarma sonunda kuyruk boşaltılır; model tablosu (#639) ve açıklama modellerinin markaları (#956, `product_model_fitments` değişince kuyruğa girer) marka tablosuyla aynı yenilemede yazılır |
| `enrichment_product_states` (+ kuyruk) | AWS'de türetilir | `scripts/enrichment-states.ts sync` |
| `product_vehicle_fitments` | AWS'de türetilir | `scripts/rebuild-product-fitments.ts --items`: paketin yazdığı ürünler + eski `matcher_version`'lı satırlar (#561) |
| `product_override_fitments` | Aktarılmaz | Yöneticinin araç uyumu kararları (#583) AWS panelinde yönetilir; `products.id` ortama özgüdür. Yeniden kurulum yalnız `product_vehicle_fitments`'ı yazar, kararlar kalır |
| `product_override_fitment_hides` | Aktarılmaz | Yöneticinin mağazadan çıkardığı bağlanmamış kaynak satırları ve modeller (#661); kararlar gibi AWS panelinde yönetilir |
| `product_model_fitments` | AWS'de türetilir, aktarım başına değil | Canlının kendi Dinamik `supplier_items`'ından `description-fitments` derive (ayrı iş, aşağıda); yalnız değişen satırlar yazılır, değişmeyenin `derived_at`'i korunur (#798), zenginleştirilmiş ürünlerin satırlarına dokunulmaz (#1370) — bu sürümden eski bir release ile AWS'de derive koşulmaz |
| `vehicle_type_oil_specs` | Aktarılmaz | `data/vehicle_type_oil_specs.csv` + `npm run db:vehicle-oils` |
| `vehicle_type_trodo_oils`, `product_enrichment_sources` | Aktarılmaz | Yerel kalır |
| `product_enrichment_tombstones` (#564) | Pakette, son 90 gün her seferinde, part-00'da | Yerelde silinen/geçersizleşen zenginleştirmelerin günlüğü; canlıda yalnız `enrichment_deleted` uygulanır, `job_invalidated` sayılır. Tablo her ortamda kendi silmelerini de günlükler; 90 günden eski satırlar dışa aktarımdan ve `--apply`'dan sonra silinir |

İş durumlarının doğruluk kaynağı yereldir: paketteki ürünlerin canlıdaki `product_enrichment_jobs` durumu (ve `supplier_code`, `supplier_brand`, `candidate_url`) paketteki değerle ezilir; canlıda o ürün için başka bir durum yazılmışsa korunmaz.

`enrichment-categories.ts backfill` `imported_at`'i yalnız kategoriler gerçekten değiştiğinde ilerletir; böylece bir backfill tüm Trodo zenginleştirmelerini yeniden göndermez.

#### AWS'de açıklama uyumluluğu görevi (#562)

`product_model_fitments` canlıda yalnız canlının kendi türetmesiyle güncellenir. Görev, `PRODUCTION_DESCRIPTION_FITMENTS_ENABLED` açıkken (varsayılan kapalı) her gün 06:15'te (İstanbul) `node --import tsx scripts/description-fitments.ts derive` koşar; komut sunucuya özel modül içermez, `--conditions=react-server` gerekmez. Elle koşmak için getirbakim-infra'dan:

```bash
./scripts/run-task.sh production -- node --import tsx scripts/description-fitments.ts derive --dry-run
```

Türetme yalnız kullanılabilir zenginleştirmesi olmayan (paylaşılan zenginleştirmesi `complete` değil ve araç listelemiyor) canlı (`presence='present'`) Dinamik ürünlerinin açıklamasını okur. **Kullanılabilir zenginleştirmesi olan Dinamik ürünlerinin saklı satırları, `presence` ne olursa olsun korunur (#1370):** silinmez, güncellenmez, `kept` olarak sayılır. Bu satırlar ürün zenginleşmeden önce türetilmişti; `storefront_description_fits` zenginleştirilmiş ürünleri dışlamaz ve marka/model sayfaları, kategori sayıları, site haritaları ve ilgili öneriler onu motor uyumlarıyla (`storefront_model_fits` / `storefront_make_fits`) birleştirir. Zenginleştirmenin araçları her zaman katalog modellerine bağlanmaz: yerelde bu ürünlerin 349.491 açıklama satırının 122.446 (ürün, model) çifti (%35) motor uyumlarında yok, 63.703 üründen 9.130'unun hiç motor uyumu yok. Satırları silmek bu ürünleri o model sayfalarından (9.130'unu tüm marka/model sayfalarından, kategori sayılarından ve site haritalarından) düşürürdü; canlıdaki ilk `--dry-run` (2026-11-25) bu yüzden 1.372.559 satırın 366.114'ünü (%26,7) silmek isteyip silme korumasına takıldı. Bir listeyi kaçıran (`pending_missing`, sonra `inactive`) zenginleştirilmiş ürünün satırları da korunur: korunan ürün hiç yeniden türetilmediği için, silinseydi ürün geri geldiğinde satırları da geri gelmezdi (yerelde 2026-11-25: 129 `inactive` ürün, 603 satır). Diğer her saklı satır türetmede yoksa silinir: modelleri değişen ürünler, Dinamik'ten çıkan zenginleştirmesiz ürünler (yeniden `present` olunca tekrar türetilir), Dinamik olmayan ürünler ve açıklaması boşalan ürünler. Türetme ve senkron korunan kümeyi koşunun başında bir kez, tek bir sorgudan işlemin geçici `description_fitments_keep` tablosuna yüklenmiş haliyle okur: hiçbir ürün hem türetilip hem korunmaz. Yüklemeden sonra gelen bir zenginleştirme sonraki koşudan itibaren sayılır; bu koşu ürünü zenginleştirmesiz olarak türetir. Ürün koşular arasında zenginleşirse satırları olduğu gibi korunur, yeni açıklamasından satır türetilmez; zenginleştirmesi kullanılamaz hale gelirse yeniden türetilir.

Çıktı tek satır JSON'dur (`job`, `status`, `seconds`, `items`, `statuses`, `rows`, `existing`, `diff`, `written`, `top`). Çıkış kodları: `0` tamam, `1` hata, `2` koruma reddetti, `3` başka bir derive kilidi tutuyor (`pg_try_advisory_xact_lock(20261106,1)`), `64` hatalı kullanım. Koruma yazmadan önce durdurur: araç model kataloğu boşsa, okunacak Dinamik ürünü yoksa, ya da tabloda en az 1000 satır varken yazmadan sonra kalacak satırlar (türetilen + korunan, `rows + diff.kept`) saklı satırların %70'inin altına düşüyorsa veya silinen satırlar (`diff.deleted`; korunan satırlar silme sayılmaz) saklı satırların %10'unu aşıyorsa (yeni satırlar toplamı korusa da; yarım kalmış bir Dinamik durumu tabloyu boşaltmasın). Daralma ya da silme gerçekten bekleniyorsa fark incelendikten sonra bir kez `--allow-shrink` ile koşulur. `--dry-run` aynı farkı (`diff`: `inserted`/`updated`/`deleted`/`unchanged`/`kept`) geri alınan bir işlemde hesaplar; iki korumadan birine takılan koşu da farkı inceleme için yazar. Saklı satırlar `deleted + kept + updated + unchanged`, yazmadan sonraki tablo `rows + kept` satırdır. İşlem `lock_timeout=10s`, `statement_timeout=15min` ile sınırlıdır. Canlıda 30 günü aşkın süredir koşmadığı için ilk koşu önce `--dry-run` olur. Yerelde (canlıyla aynı 1.372.559 saklı satır) bu kuralla `--dry-run` (2026-11-25): `rows` 1.062.439, `inserted` 56.361, `updated` 5.845, `deleted` 16.387 (%1,2), `unchanged` 1.000.233, `kept` 350.094 (349.491'i `present`, 603'ü `inactive` ürünlerin); korumalar geçer, `--allow-shrink` gerekmez. Büyük bir koşu `product_model_fitments` tetikleyicileriyle 20.000'den fazla bağlantı senkronu satırı kuyruğa yazar: arka plan senkronu paylaşım bağlantılarını tümden yeniden kurar (~10–20 sn, okuyanlar bu sürede eski satırları görür) ve liste sayacını ilerletir. Büyük bir fark IndexNow'da gün başına `INDEXNOW_MAX_URLS` (varsayılan 50.000) ile birkaç güne yayılır.

#### Silinen/geçersizleşen zenginleştirmeler (#564)

Aktarım `imported_at`'e göre çalıştığı için yerelde silinen bir satır kendiliğinden canlıya ulaşmaz. `db/enrichment-tombstones.sql` bu yüzden yereldeki her `product_enrichments` silmesini (`enrichment_deleted`) ve `complete`/`partial`'dan çıkan ya da silinen her işi (`job_invalidated`) tedarikçi ürününün doğal anahtarıyla (`supplier`, `company`, `list_group`, `warehouse`, `code`) `product_enrichment_tombstones` tablosuna yazar. Tedarikçi ürünü silindiği için zincirleme silinen satırlar günlüğe girmez: ürünün varlığı canlıdaki tedarikçi senkronunun işidir.

- **Dışa aktarım:** her pakette son 90 günün günlüğü filigrandan bağımsız olarak `manifest.tombstones` olarak gider (`--full` ile tamamı); ürün başına en son satır, türü ürün yerelde hâlâ varsa bugünkü durumundan (zenginleştirme yok → `enrichment_deleted`, zenginleştirme var ama iş geçerli değil → `job_invalidated`); tedarikçi ürünü yerelde artık yoksa günlükteki tür korunur (zenginleştirmesi zincirleme gitmiştir, canlıda tekrarlanacak bir silme değildir). Yeniden zenginleştirilip geçerli olan ürünler (aynı doğal anahtarla yeni bir kimlik altında olsa da) ve `manual-upload` zenginleştirmeleri gönderilmez. Anahtarlar günlükten `manifest.items`'a eklenir; yerelde artık olmayan ürün de canlıda bulunur. Satırlar yalnız part-00'da taşınır; `job_invalidated` satırları canlı onları uygulamadığı sürece gönderilmez, yalnız sayıları (`manifest.invalidatedJobs`) gider. 90 günden eski günlük satırları yalnız gerçek çalıştırmada dışa aktarımdan sonra silinir (`--prune`); `--dry-run` yerel veritabanına yazmaz.
- **Canlıda (`import-storefront-bundle.ts`):** iş durumlarından ve zenginleştirmelerden önce, aynı işlemde: `enrichment_deleted` ürünün canlıdaki zenginleştirmesini siler; `manual-upload` olanlar ve silmeden sonra (`imported_at > recorded_at`) yazılmış olanlar kalır. Araç uyumları (`product_vehicle_fitments`) ve paylaşılan bağlantılar zincirleme gider, paylaşılan bağlantı kuyruğu içe aktarma sonunda boşaltılır; paketin kaynaklarının (`trodo` vb.) kategori eşlemeleri silinir, diğer kaynaklarınki kalır; `complete`/`partial` iş `pending` olur (`last_error`: `Enrichment removed locally (storefront sync #564)`). Tekrar uygulamak zararsızdır. Rapor `tombstones`, `removedEnrichments`, `removedEnrichmentMappings`, `resetJobs`, `invalidatedJobsReported` ve `tombstonesKept` (ürün canlıda yok, zenginleştirmesi yok, elle yüklenmiş ya da daha yeni) sayılarını taşır; yerel aktarım uygulanan silmeleri bir satırla yazar.
- **`job_invalidated` şimdilik yalnız raporlanır:** yerelde iş, tedarikçi ürününün OEM'i ya da kodu değişince de `pending`'e döner (`enqueueProductSources`); bu kimlikler canlıda farklı olabilir ve oradaki doğru zenginleştirme gizlenirdi. Uygulamak için `scripts/storefront-bundle-tombstones.ts`'teki `INVALIDATE_JOBS_ON_TARGET`'ı `true` yapın: satırlar pakete girer ve canlıdaki iş, geçersizleşmeden sonra güncellenmemişse ve elle yüklenmiş değilse `pending` olur (yerel ve canlı imajın ikisi de yeni değerle olmalı).
- **Silme sınırı:** paket `maxDeletions` (sync `--max-deletions=<n>`, varsayılan 1000) taşır. Canlıda bundan fazla zenginleştirme silinecekse içe aktarma kuru çalıştırmada da durur; görev başarısız biter, hiçbir parça uygulanmaz, filigran ilerlemez. Sınır aşılırsa önce yerel silmelerin bilinçli olduğunu doğrulayın (`SELECT kind, count(*) FROM product_enrichment_tombstones WHERE recorded_at > now() - interval '90 days' GROUP BY 1`), sonra `npm run storefront:sync -- --max-deletions=<n>` ile tekrar çalıştırın; istenmeyen silmeleri önce yerelde geri alın (yeniden zenginleştirilen ürün gönderilmez).
- **Eski operations imajı:** `manifest.tombstones`'u yok sayar ve raporunda `tombstones` sayısı olmaz; aktarım bunu hata değil uyarı olarak yazar ("operations image predates #564 … run release-aws"), filigran ilerler. Silmeler 90 gün boyunca her çalıştırmada yeniden gönderilir; `release-aws`'den sonraki ilk aktarım uygular.
- **Yayın sırası:** PR merge → yerel şemayı kullanıcı ana checkout'tan `npm run db:setup` ile günceller (tetikleyiciler ancak o andan sonraki silmeleri günlükler) → `release-aws` (canlıda `db:setup` aynı tabloyu kurar, yeni içe aktarma imajı silmeleri uygular). Sıra bozulursa veri kaybolmaz: günlük yoksa gönderilecek bir şey yoktur, eski imaj yalnız uyarı üretir.
- **Kapsam dışı:** silinen zenginleştirmelerin görselleri canlıda `npm run media:gc`'ye kalır (#597/#649). Tetikleyiciler kurulmadan önceki silmeler (#564 öncesi) günlükte yoktur ve kurtarılmaz; ayrı bir iş olarak ele alınmalıdır.

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
  (`water-pump-and-timing-belt-set` bir `timing-belt-set` değildir; bu tip artık küratörlü listede
  `water-pump-timing-belt-set`'in takma adıdır, aşağıdaki #860 bölümü).
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
- `report-unmapped`, `check-aliases`: küratörlü liste (#860, aşağıda). `backfill-types` çıktısındaki `curated`, küratörlü
  listeyle eşlenen kayıtları sayar.

Backfill sonrası yeniden kurma gerekmez: kategori listeleri `product_source_categories`'i canlı okur (yalnız süreç içi
10 dakikalık önbellek var). 16 Kasım 2026 yerel ölçümü: 14.177 Trodo ürününden 660 tip; spareto'nun 36.332 kaydının
`--min-support 2` ile %92,7'si (33.691), `--min-support 1` ile %94,0'ı (34.165) kategori alıyor; çoğul katlama 15 kayıt ekliyor.
URL'den tip çıkarılamayan 86 kayıt vardı (A.B.S. `ab-s-…`, CONTINENTAL CTAM `contitech-…`); #860'tan beri bu ön ekler
ve MAHLE'nin `mahle-original-…` ön eki `sparetoTypeFromUrl`'de markaya özel tanımlıdır.

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

### Küratörlü tip eşlemeleri (#860)

Öğrenilmiş sözlüğün eşleyemediği uzun kuyruk (eşanlamlılar ve Trodo'nun hiç görmediği tipler) elle tutulan, sürümlü bir
listeyle kapatılır: `src/modules/enrichment/type-aliases.ts` (`typeAliases`). Her kayıt bir tip slug'ı ve kısa bir
gerekçe notu (`note`) taşır; iki tür vardır:

- **Takma ad** (`alias`): aynı parçanın başka adı; hedef, eşikleri geçmiş öğrenilmiş bir tiptir ve kategorilerini ondan
  alır (`oxygen-sensor` → `lambda-sensor`, `multi-belt` → `v-ribbed-belt`).
- **Elle kategori** (`categories`): Trodo'nun hiç görmediği tip için `{id, name}` listesi; `name`
  `source_categories.name` ile birebir aynı olmalıdır (yanlış kimlik böyle yakalanır).

**Arama sırası** (`typeMatch` / `categoriesForType`): `override: true` kayıtlar → öğrenilmiş tam tip → sayısal kuyruk
("-1") atılmış öğrenilmiş tip → küratörlü liste (tam, sonra kuyruksuz) → öğrenilmiş çoğul katlama → boş. Öğrenilmiş veri
kazanır: öğrenilmiş bir tiple çakışan küratörlü kayıt `override` olmadıkça uygulanmaz ve `redundant` olarak raporlanır
(hata değil). Başlangıç listesinde `override` yoktur. Sonek eşleşmesi burada da yoktur.

**Doğrulama** (hepsi birlikte listelenir): bilinmeyen kategori kimliği, kimlik/ad uyuşmazlığı, hedefi öğrenilmiş tip
olmayan takma ad, takma ad zinciri (hedef de küratörlü), yinelenen tip, slug olmayan tip, boş kategori listesi.
`check-aliases`, `learn-types` (yeniden öğrenmeden sonra; öğrenme geri alınmaz) ve `backfill-types` katıdır: sorun
varsa hata/çıkış kodu 1. İstisna: `backfill-types --dry-run` özel `--min-share`/`--min-support` ile koşarsa takma ad
hedefi o eşikte kabul edilmemiş olabilir; o zaman uyarıp kaydı atlar (varsayılan eşikler katı kalır). İşçiler (spareto, parts2world) liste yüzünden durmaz: tek satırlık bir uyarıyla sorunlu
kayıtları atlar, geçerlileri uygular. Öğrenilmiş sözlük boşsa liste de uygulanmaz.

Komutlar (`npm run enrichment:categories -- <komut>`; ikisi de yalnız okur ve şema dosyasını uygulamaz):

- `report-unmapped [--source spareto|parts2world|all] [--limit 80] [--json]`: kaynak başına `rows`, `noType`,
  `learned`, `curated`, `unmapped` (spareto kayıtları, parts2world kayıtları ve saklanan parts2world makale adları
  — `parts2worldArticles`); sonra en sık eşleşmeyen tipler (spareto / parts2world kayıt / makale sayısı) ve en çok 3
  öneri: kelime örtüşmesi (Jaccard; son kelime tekilleştirilir, `and/for/of/the/system/kit/set` atılır) en yüksek
  öğrenilmiş tipler ve Trodo yaprak kategorileri. Öneriler yalnız yardımcıdır.
- `check-aliases`: listeyi öğrenilmiş sözlüğe ve ağaca karşı doğrular; `applied`, `redundant`, `resolvedWithout`
  (öğrenilmiş tipin sayısal kuyruk ya da çoğul katlamayla zaten eşlediği kayıtlar; bilgi, hata değil) ve `problems` basar.

**Listeyi büyütme:** `report-unmapped` → tipin gerçekten tek anlamlı olduğunu (Trodo'da aynı parçanın kategorisi, birkaç
ürün adı) kontrol edin → kaydı notuyla ekleyin → `check-aliases` → `npm run test:type-categories` →
`backfill-types --dry-run` ile `curated` sayısına bakın. Belirsiz tipler ve Trodo'nun kendi kategorisi olmayan setler
eşlenmeden kalır. Bilinçli olarak eklenmeyenler (tip adı altında karışık ürünler var):

- `fuse`: Trodo ağacında sigorta kategorisi yok. `bulb`: ampulün yeri (far, sinyal, sis…) adda yok, kategori belirsiz.
- `sway-bar-suspension`: 5 üründen bir kısmı DELPHI salıncak ve burçları, stabilizatör değil.
- `bulb-fog-light`: 14 üründen en az 6'sı H4 far ampulü.
- `mounting-stabilizer-coupling-rod`: 18 üründen ~11'i stabilizatör burcu, yalnız 4'ü gerçek z-rot.
- `trim-protection-strip-wing`: 6 üründen 4'ü FAST basamak/tampon parçası.
- `goods-to-assign`: spareto'nun "atanacak ürün" yer tutucusu, parça tipi değil.
- #1299'da bakılıp eklenmeyenler:
  - Karışık ürünler: `cylinder-head` (silindir kapağı, kapak contası ve üst takım conta), `repair-kit-manual-transmission`
    (çoğu şanzıman rulmanı, bir kısmı vites mekanizması), `spring-seat` (amortisör takozu, yay tablası, get lastiği),
    `repair-kit-control-arm` (salıncak, denge kolu, tamir takımı), `link-set-wheel-suspension`, `tie-bar-bush`
    (viraj demiri ve salıncak burcu, braket), `mounting-transfer-case` (motor/şanzıman takozu, diferansiyel burcu),
    `engine-cover` (motor üst kapağı ve alt muhafaza), `trim-protective-strip-bumper` (tampon bandı, panel köşesi,
    çamurluk bakaliti), `gear-lever-gaiter` (körük ve topuz), `cap-radiator` (radyatör ve yedek su deposu kapağı),
    `gasket-housing-cover-crankcase` (yan kapak ve yağ pompası contası), `bearing-wheel-bearing-housing` (adı
    rulman yuvası, ürünler salıncak/torsiyon burcu), `solenoid-valve` ve `solenoid-valve-shift-cylinder` (şanzıman,
    dorse, motor freni valfleri), `multifunctional-relay`, `relay-main-current` (röleler; tek bir kategori yok).
  - Trodo'da uygun kategori yok: `control-unit-glow-time` (kızdırma rölesi), `switch-unit-ignition-system` (ateşleme
    modülü), `lift-point-pad-jack` (kriko takozu), `low-temperature-cooler-charge-air-cooler` (turbo devresi su
    radyatörü), `valve-spring`, `panelling-mudguard` (çamurluk davlumbazı; `mudguard` paçalık),
    `oil-jet-piston-underside-cooling` (piston yağlama memesi), `air-dryer-cartridge-compressed-air-system` (ağır
    vasıta hava kurutucu; Klima kurutucuları değil).
  - Konumu belli olmayan ampuller (`bulb-cornering-light`, `bulb-interior-light`, `bulb-boot-interior-light`,
    `bulb-auxiliary-stop-light`): Trodo'da yalnız far, sis ve sinyal ampulü kategorileri var.

**Ölçüm (17 Kasım 2026, yerel, yalnız okuma):** başlangıç listesi 93 kayıt (33 takma ad, 60 elle). spareto 36.908
kaydın eşlenen payı %92,7 → %96,4 (öğrenilmiş 34.225 → 34.406, küratörlü 1.188; eşleşmeyen 2.596 → 1.312; tipsiz
87 → 2, marka ön ekleri sayesinde). parts2world tipli kayıtlarda %91,5 → %96,4 (1.437 tipli kaydın 70'i küratörlü),
saklanan makale adlarında %90,2 → %95,9 (1.091 makalenin 62'si; `fetch-types` sürerken).

**#1299 genişletmesi (22 Kasım 2026, yerel, `backfill-types --dry-run`):** 102 kayıt eklendi (57 takma ad, 45 elle;
liste 195 kayıt). spareto: eşlenen 53.435 → 53.866, küratörlü 1.626 → 1.997, eşleşmeyen tip 784 → 736, değişecek
kayıt 370. parts2world: eşlenen 91.236 → 94.675, küratörlü 4.125 → 7.297, eşleşmeyen tip 584 → 505, değişecek kayıt
3.162. `water-recirculation-pump-parking-heater` Trodo'nun `water-pump-parking-heater` (Park ısıtıcıları) tipine
bağlanmadı: 54 ürünün hepsi motorun ilave su pompası, bu yüzden Su pompaları.

**Operasyon:** canlıda komut yok (liste koddadır). Yerelde birleştirmeden sonra, son sürüme kadar bekletmeli:
`check-aliases` → `backfill-types --source spareto --hold` ve `backfill-types --source parts2world --hold`; yayın
`release-categories` ile (yukarıdaki #855 bölümü).

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
`parts2world-source` bekleyerek); aynı IP'den iki istemci açılamaz. Bekleyen işçi o an koşuyorsa
`{"skipped":"another parts2world run is going"}` ile çıkar. Çözüm `fetch-types --via-proxy` (#946): istekler
`SUPPLIER_EGRESS_PROXY` ile VPS'teki egress squid'den çıkar (kendi IP'si; `www.parts2world.com`
`infra/squid/allowed-hosts.txt` içinde olmalı) ve `parts2world-collect:proxy` / `parts2world-source:proxy` kilitlerini alır;
bekleyen işçiyle (doğrudan, kilit adları değişmez) aynı anda koşar, iki proxy'li koşu birbirini dışlar. Proxy değişkeni
yoksa ya da tünel açılamıyorsa koşu hemen hata verir, doğrudan bağlantıya dönmez. `--via-proxy` yalnız `fetch-types`
içindir; `collect` checkpoint ve kaynak koşusunu doğrudan işçiyle paylaştığı için desteklemez.
Proxy'siz çalıştırmak istenirse işçiyi durdurun:
`launchctl kill SIGTERM gui/$(id -u)/com.getirbakim.parts2world-pending` ve `fetch-types`'ı hemen ardından başlatın:
işçi `StartInterval 1800` ile tetiklenir (KeepAlive yok), yani 30 dakika içinde kilidi yeniden alır. `fetch-types`
kilidi tuttukça launchd tetiklemeleri atlanır, bitince işçi kendiliğinden devam eder. `dev` çekildikten sonra koşan işçi yeniden başlayana dek
eski kodla (kategorisiz) çalışır; durdurup bıraktığınızda yeniden başlayınca yeni kodla açılır.

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
   yalnız sayar. Çıktı `{source, rows, dryRun}`. Kaynağın işçilerin zaten gönderdiği kategorili kayıtlarını da yeniden gönderir
   (zararsız, içe aktarım idempotent); kategorisiz satırlara ve diğer kaynaklara dokunmaz. Kaynak URL ön ekleri
   `backfill-types` ile ortaktır (`typedSourceUrlPrefix`).
4. `npm run storefront:sync -- --dry-run` ile parça özetine bakın, sonra sync'in taşımasına izin verin.

Tek seferlik maliyet yukarıdaki "storefront:sync maliyeti" bölümleriyle aynıdır: kayıt sayısı (≈75 bin), görseller
(spareto ≈2,6 GB, parts2world ≈0,95 GB), AWS'de araç uyumluluklarının yeniden kurulması, IndexNow/`lastmod` ve ana sayfa
rafı.

**`--hold` sınırları.** Hold yalnız `imported_at`'i sync filtresinin (durum `snapshotAt` eksi 1 saatlik `OVERLAP_MS`)
altında kalan satırları bekletir; son sync'ten beri değişmiş satırlar (yerelde şu an ≈9,6 bin, işçilerle artıyor)
kategorileriyle bir sonraki sync'te yine de gider. Tam bekletme için önce bir sync koşup işçileri durdurmak gerekir.
Bekletilen satırın `imported_at`'ini başka yeniden yazan akışlar da ilerletir (işçinin yeniden toplaması,
`image-fill.ts`, `otoparcasan-enrichment.ts`, `manual-import.ts`); ayrıca sync'in yeniden deneme listesi
(`--retry-file`) satırları `imported_at`'e bakmadan gönderir.

**Release tekrarı.** `release-categories`'i yeniden koşmak tüm kümeyi yeniden gönderir (maliyet baştan ödenir). Release
ile yazan bir `backfill-types`'ı aynı anda koşmayın (kilitlenme olabilir; işlem temiz geri alınır, yeniden koşmak güvenli).

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

Kartlar grid/list görünümü, ilk dört teknik özellik ve genişletme, marka logosu, gerçek fiyat/stok, adet seçimi ve üç ürüne kadar karşılaştırma içerir. Fiyatı veya stoku güncel olmayan ürünler satın alınabilir gösterilmez. Bilinmeyen stok, “Stokta yok” filtresine dahil edilmez. “Stokta yok”, kartın kendi satırının “Stokta yok” olduğu ve gruplanmış tekliflerinden hiçbirinin satılamadığı kartlardır; bir kart iki filtrede birden görünmez, stoğu bilinmeyen ve tedarik edilemeyen kartlar ikisinde de yoktur (#1342). OEM alternatifinden alınan teknik bilgiler kullanılabilir; alternatifin EAN, üretici, üretici parça numarası, ticari numaraları ve marka sınıfı kart kimliğine aktarılmaz. Marka sınıfı filtresi yalnızca birebir parça eşleşmelerini kullanır. Yöneticinin ürün sayfasında elle düzenlediği, eklediği veya gizlediği teknik özellikler (#603, `product_override_specs`) kartlarda, süzgeç seçeneklerinde ve öznitelik süzgecinde otomatik değerin önüne geçer.

Süzgeç seçenekleri (`attributeFacetsSql`) ve öznitelik süzgeci (`catalogFilter`, #1248) enrichment payload'ını her istekte açmaz; teklif başına süzgeç anahtarlarının değerleri `storefront_facet_specs` tablosunda hazır tutulur (#994, `db/enrichment-shared-links.sql`). Satırlar okuyucuların koruduğu kurallarla çıkarılır: teklifin kendi kodu ve markası, çapraz referans eşleşmesi değil, 200 karakteri aşmayan değer, marka sınıfı yalnız birebir parça eşleşmesinden. Tablo `product_enrichment_shared_refresh` içinde `storefront_facet_specs_refresh` ile bağlantılarla aynı kapsamda yenilenir (tam yenilemede ANALYZE edilir); bağlantı silinince satırları da silinir. Kimlik koruması (kod ve marka) yenileme anında uygulanır: bir satırın kodu veya `uk` markası değişince süzgeç seçeneği bağlantı kuyruğunun bir sonraki boşaltılmasına ve ardından süzgeç önbelleğinin (10 dakika) yenilenmesine kadar eski kalabilir; öznitelik süzgeci ve kartlar korumayı okuma anında uygulamaya devam eder. Anahtar listesi SQL'de `storefront_facet_keys()` ile `facetSpecificationKeys` (`src/modules/store/catalog-filters.ts`) arasında aynalanır; test ikisinin eşitliğini denetler. Yöneticinin değerleri (`product_override_specs`) okunurken uygulanır. Tablo türetilmiştir, storefront paketine hiç girmez. Her kurulum bağlantılar için tam yenileme kuyruğa yazdığından `npm run db:setup` sonundaki `product_enrichment_shared_sync()` tabloyu doldurur; kurulumu atlayıp yalnız şemayı uygulayan bir ortamda şema dosyasının kuyruğa yazdığı tam yenileme işaretiyle `SELECT product_enrichment_shared_sync()` çalıştırılır (başka bir oturum kilidi tutuyorsa 0 döner, işaret kuyrukta kalır; tekrar denenir). Yalnız bu tabloyu doldurmak için `SELECT storefront_facet_specs_refresh()` de kullanılabilir; yalnız değişeni yazdığından güvenle tekrar çalıştırılır. Boş tabloda süzgeç seçenekleri yalnız yöneticinin değerlerini gösterir.

Öznitelik süzgeci (`attributes=…`) aynı satırları okur (#1248): seçilen anahtar ve değerlere uyan teklif kimlikleri sorgu içinde bir kez toplanır (`=ANY(ARRAY(...))`, InitPlan) ve katalog birincil anahtarla okunur; aynı küme `IN (...)` ile yazıldığında katalog tam taranıyordu. Kimlik koruması okuma anında da uygulanır: satır bağlantısı (`product_enrichment_shared_links`) ve `supplier_items` ile birleştirilir, kodu veya `uk` markası değişen teklif satırı henüz silinmemiş olsa da süzgeçte listelenmez. Değer ve eşleşme türü (`match_basis`) değişiklikleri, seçenekler gibi, bir sonraki bağlantı senkronuyla süzgece ulaşır (ardından 10 dakikalık liste önbelleği yenilenir). Yöneticinin değerleri eskisi gibi okunurken uygulanır. Yalnız `facetSpecificationKeys` anahtarları süzülebilir: sidebar başka anahtar sunmaz, elle yazılmış bir URL'deki başka anahtar (ör. `Thickness [mm]`) hiçbir ürünle eşleşmez. Yerelde (soğuk süreç, sıcak veritabanı) bir `/katalog` sayımı 1,5–3,6 s'den 50–140 ms'ye, kök kategori `yedek-parca` sayımı 2,2–5,3 s'den 240–450 ms'ye indi; fiyata göre sıralı öznitelik listesi 30 s sınırına takılıyordu, ~0,2 s'de döner.

Kontroller:
- `npm run test:catalog-filters`
- Elle (CI'da değil; yerel veritabanının canlı verisini okur, fikstür kategorisini oradan seçer; #1336): `PGOPTIONS="-c default_transaction_read_only=on" node --env-file=.env.local --conditions=react-server --experimental-test-module-mocks --import tsx scripts/verify-catalog-filters.ts`

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

`/yonetim/urun-verileri` görünümü doğrudan okumaz: `db/enrichment-states.sql` her ana ürün için `enrichment_product_catalog` satırının materyalize hâlini `enrichment_product_states` tablosunda tutar (durum, temsilci tedarikçi satırı, OEM/araç/özellik sayıları, sıralama anahtarı). `products`, `product_sources`, `supplier_items` (kod, ürün verisi, varlık), `product_enrichment_jobs` ve `product_enrichments` üzerindeki trigger'lar etkilenen ürün kimliklerini `enrichment_product_state_queue` kuyruğuna yazar; `brands`/`supplier_brands` eşleme değişikliği tam yeniden kurma işareti bırakır. Sayfa her okumadan önce `enrichment_product_states_sync()` ile kuyruğu boşaltır: küçük kuyruk nokta nokta yenilenir, 20 binden büyük kuyruk veya işaret tüm tabloyu yeniden kurar (yerelde ~5 sn; görünüm için nested loop kapatılır, aksi hâlde dakikalar sürer). `npm run db:setup` ve `npm run enrichment:prepare` şemayı uygular; ilk kurulumda `db:setup` şema işleminden sonra bir senkron koşar. `npm run enrichment:states` tam yeniden kurar (`sync` argümanı yalnız kuyruğu boşaltır). Bekleyen ürün seçimleri ve kuyruk doldurma da görünümü değil bu tabloyu okur (#921, #923): Trodo katalog turunun parti seçimi (`createRun`) ve kalan sayacı, kuyruğu dolduran `enqueueProductSources` (`enrichment:prepare`, `pilot`, katalog turu; yalnız işi olmayan ya da kodu/markası/OEM'i değişen satırları, kimlikleri canlı `supplier_items` satırıyla hâlâ aynıysa yazar; senkron atlandığında eski durum satırı bitmiş işi sıfırlamaz), spareto'nun bekleyen sırası (`src/modules/enrichment/pending-queue.ts`), parts2world'ün bekleyen kuyruğu, `retry-review`/`retry-partial` yeniden kuyruklamaları ve `enrichment:status` sayacı (#939; yerelde görünümle ~2,5–4 sn → tablodan ≤1 sn) önce `enrichment_product_states_sync()` koşar. Yeniden kuyruklamalar da durum satırını yalnız kodu/markası/OEM'i canlı `supplier_items` satırıyla hâlâ aynıysa koşuya ekler; senkron atlandığında eski kimlikle arama yapılmaz. `createRun` "aramada listelenmiş" denetimini yalnız arama ürünü olan markalarda yapar ve partiyi numaralamadan önce istenen boyuta keser (yerelde ~10 sn → ~4 sn). Görünüm her bekleyen satır için yeniden hesaplandığından spareto'nun 200'lük seçimi bir dakikayı aşıyordu. spareto sırayı yalnız kimlik olarak okur (en fazla 1.000 yeni ürün için), denenmişleri bellekte eler ve ayrıntıları aramadan hemen önce 200'lük parçalarla, durumu yeniden denetleyerek okur; denenen kimlik listesi sorguya gönderilmez; parça okuması ürünün kendi işinin hâlâ açık (`pending`/`not_found`/`review`) olduğunu da birincil anahtardan denetler. `enrichment_product_states_sync()` kilidi başka bir oturumdayken (`refresh_product_matches`, `db:setup`) senkron yapmadan döner; seçim o arada birkaç saniyelik eski durumu okuyabilir. Bu bilinçli bir ödünleşimdir: bekleyen seçimi kilidi beklemez; spareto ve parts2world yazmadan önce işin durumunu yeniden denetler, Trodo işçisi her ürünü ziyaretten önce görünüme karşı denetler. Sayfadaki arama (#617) üç indeksli kimlik kümesinin birleşimidir: mağazayla aynı tedarikçi satırı eşleşmesi (`db/search.sql`), üretici parça numarası (`db/enrichment-search.sql` içindeki kısmi `enrichment_product_states_part_number_search_idx`) ve yalnız zenginleştirilmiş satırlarda OEM numaraları (`product_enrichments_oem_search_idx`); her küme birincil anahtardan okunur. `search_compact` değişirse bu indeks de `REINDEX INDEX enrichment_product_states_part_number_search_idx` ile yeniden kurulur.

Gizlenen tedarikçi OEM'i (#865): `enrichment_valid_data`, OEM'i gizli tedarikçi satırlarının (`commerce_item_overrides.hide_oem`, ürün düzeyinde `product_overrides.hide_supplier_oem`'dan izdüşer) tedarikçi OEM'iyle eşleşmiş kayıtlarını (`match_basis.type='oem_reference'` ve `referenceSource` `supplier_oem` ya da boş) dışarıda bırakır; birebir parça, muadil kod ve kendi parça kodu (`original_manufacturer_part_code`, `replica_part_code`) eşleşmeleri kalır. Koşul `NOT (… AND EXISTS …)` biçimindedir: planlayıcı küçük override tablosunu tek bir hash'li SubPlan olarak okur, anti-join gibi join sırasını değiştirmez. Böylece paylaşım (`product_enrichment_shared_links`), marka/model listeleri (`storefront_make_fits`/`storefront_model_fits`), `storefront_enrichments`'tan okunan kategori yerleşimi (kategori listeleri, Bakım Robotu, ilgili ürün önerileri) ve panel durumu (`enrichment_product_states`) aynı kuralı izler; ürünün başka geçerli kaynağı yoksa bu yerlerden de düşer; ham `product_enrichments` ve `product_vehicle_fitments` satırları silinmez, gizlilik kalkınca veri geri gelir. İşi bitmiş (`complete`/`partial`) ama verisi bu yüzden düşen satır `enrichment_product_candidates`'te `not_found` sayılır, yani yeniden `pending` olmaz ve toplayıcılar (Trodo, spareto) onu döngüde yeniden toplamaz; önceliği `pending`'in arkasındadır, böylece aynı ürünün bekleyen başka bir teklifi varsa temsilci o olur ve toplanır. `commerce_item_overrides` üzerindeki deyim düzeyi trigger'lar yalnız `hide_oem` açık olan ya da değişen satırları (fiyat/ad/gizlilik düzenlemelerini değil) paylaşım kuyruğuna, ürünlerini durum kuyruğuna yazar. Trigger'lar her kurulumda yeniden yaratılmasın diye yalnız yoksa oluşturulur (gövde değişikliği için `CREATE OR REPLACE FUNCTION` yeter); trigger'ları ilk kuran kurulum o anda gizli olan ürünleri durum kuyruğuna bir kez ekler. Yönetimdeki "Tedarikçi OEM alanını gizle/yeniden göster" eylemi kuyrukları kendisi boşaltmaz (kuyrukta tam yeniden kurma işareti varsa istek içinde çalışırdı): mağaza bağlantılarını uygulama sürecindeki 5 sn'lik arka plan senkronu (`src/instrumentation.ts`), panel durumunu sayfanın okuma öncesi boşaltması uygular; değişiklik birkaç saniye içinde görünür. `storefront:sync` aynı kaydı yeni `imported_at` ile yeniden yazsa da kayıt gizli kaldıkça dışarıda kalır. Operasyon: görünüm tanımları yalnız `npm run db:setup` (ya da `enrichment:prepare`) ile değişir; işçiler açılışta şema uygulamaz (#921). `db:setup` sonrası yerel zenginleştirme işçileri yine güncel checkout'tan yeniden başlatılmalıdır, eski checkout'un sorguları yeni şemayla uyuşmayabilir.

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

## Fiyat listesi ürünleri (#1075)

Dinamik'in yalnız fiyat listesinde olan, stok listesinde satırı olmayan (`stock_data IS NULL`) ve hiçbir ana ürüne bağlanmamış kodları satılamaz, bu yüzden mağazanın bekleyen kuyruğuna (`enrichment_product_states`) hiç girmez. Zenginleşenler #1068 ile "Gelince haber ver" kartı olur (`storefront_price_only_items`). Bu kodlar spareto ve parts2world'e ortak, ikincil bir kademe olarak verilir (`src/modules/enrichment/price-only-queue.ts`):

- **Kayıt:** kuyruk ayrı bir tablo değil, satırların eski `product_enrichment_jobs` işleridir (yerelde ~379 bin `pending` iş, neredeyse hepsinin markası boş; ~20 bin satırın işi yok). Bir iş yalnız kodu ve markası canlı satırla aynıyken aranır, bu yüzden merge tek başına hiçbir şeyi değiştirmez. `enrichment:price-only -- enqueue` eksik işleri ekler, kodu/markası/OEM'i farklı açık işleri canlı kimliğe hizalayıp `pending` yapar (yalnız açılmış markalar değil, tüm markalar: parts2world'ün `match` adımı işleri okur); ikinci koşu hiçbir şey yazmaz.
- **Uygun satır:** Dinamik, fiyat listesinde (`presence='present'`), çakışmasız, ürün bağlantısız, işi `pending` ve hizalı; aynı marka anahtarı + parça numarasıyla bir ana ürün varsa atlanır (o ürün mağaza kuyruğundan zenginleşip paylaşılır).
- **spareto:** yalnız `enrichment_price_only_brands` tablosunda açılmış markaların satırlarını, spareto'nun henüz `found`/`not_found` demediklerini arar; parts2world arşivinde eşleşen satırlar sona kalır (onları parts2world alır), sonra ters hash sırası. Sıra `supplier_items_brand_label_idx` üzerinden okunur (yerelde 5 marka, ~70 bin satır: ~0,6–0,8 sn).
- **parts2world:** marka listesine bakmaz; arşiv makalesiyle eşleşmiş (`parts2world_job_articles`) tüm uygun satırları alır, vekil işçi ters yönden yürür (yerelde ~42 bin satır, ~0,8 sn).
- **Pay:** iki işçi de bekleyen turunda `--price-only-share F` ya da `ENRICHMENT_PRICE_ONLY_SHARE` kadarını bu kademeye verir (0–1 arası, varsayılan 0: kapalı). 0,2'de her beşinci arama fiyat listesi kodudur; mağaza sırası korunur ve bir taraf bitince diğeri devam eder. Hız ve bekleme aralıkları değişmez.
- **Kayıt ve sayaç:** bu aramalar `enrichment_source_attempts.queue='price_only'` ile yazılır. spareto'nun marka isabet oranları (`brandRateSql`) bunları saymaz; parts2world turu ilerlemesi bekleyen turda bunları da sayar. `/yonetim/urun-verileri` → Kaynaklar sekmesindeki "Fiyat listesi ürünleri (Dinamik)" kartı açık markaların kapsam / aranan / zenginleşen / yayında / kalan sayılarını gösterir (bir dakika önbellekli, yerelde ~1,5 sn; Kalan = henüz aranmamış kodlar).

```bash
npm run enrichment:price-only -- enqueue                       # işleri ekler/hizalar; sonra parts2world eşleşmesi:
npm run enrichment:parts2world -- match
npm run enrichment:price-only -- enable BLUEPRINT DELPHI SWAG VALEO FEBI --note "ilk parti"
npm run enrichment:price-only -- disable VALEO
npm run enrichment:price-only -- status                        # marka başına sayılar + her işçinin sıradaki 10 kodu
ENRICHMENT_PRICE_ONLY_SHARE=0.2 npm run enrichment:spareto -- collect --status pending --limit 2000
```

`enqueue` yalnız açık işleri (`pending`/`not_found`/`review`) hizalar; `complete`/`partial` bir işi yeniden açmaz (zenginleştirme gizlenir, AWS'nin uygulamadığı bir `job_invalidated` tombstone'u yazılırdı). İlk koşu ~380 bin işi günceller: paylaşım kuyruğu tek bir tam yeniden kurmaya döner (yerelde 10–20 sn) ve tabloda ~380 bin ölü satır kalır (autovacuum toplar). Pay, `db:setup` uygulanmadan yükseltilmez: `price_only` kuyruk değeri yoksa aramaların kaydı yazılamaz.

**GKL ve VICTOR REINZ (#1111).** Dinamik VICTOR REINZ kodlarını markanın tam adıyla yazar (`VICTOR REINZ 61-36960-00`); eşleşme sözleşmesi eskiden yalnız tek kelimelik öneki atıyordu, bu yüzden spareto `61-36960-00`'ı hiç aramıyor ve markanın kendi sayfasını reddediyordu (önceki 0/65, #1068 örneği 0/53). Artık kodun başındaki marka adı kaç kelime olursa olsun atılır (`KIT KTB`, `ELWIS ROYAL` de aynı yapıda); spareto bu markayı `VICTOR REINZ` adıyla, URL'de `reinz-` önekiyle listeler, Trodo `REINZ` der (takma ad). Düzeltmeden sonra 60 kodluk kuru örnek: 52 bulundu (45 aynı parça, 7 muadil), 38'i (%63) Türkçe etiketli kategoriyle yayına uygun; kalanların çoğu spareto'nun tipsiz `goods-to-assign` sayfaları. GKL ise Dinamik'in kendi 6 haneli kodlarıyla gelen kaporta/plastik parça markasıdır: spareto'da marka yok (marka ve kod aramaları yalnız başka markaların aynı numaralı kartlarını getirir), fiyat listesi satırlarında OEM alanı da yok; kapalı kalır. parts2world'ün site araması olmadığı için yalnız eski arşivdeki makalelere ulaşır ve arşivde (`parts2world_articles`) ne REINZ ne GKL makalesi var: iki marka da parts2world'den gelmez. Arama/listeleme anahtarları da (#1117) kodun her kelime son ekinden türetilir (`supplierPartKeys()`, SQL'de `enrichment_supplier_part_keys()`): Trodo arama ürünleri `VICTOR REINZ 61-36960-00` için de bulunur ve işçi eşleşmeye tedarikçi etiketinin yanında ana markayı da verir; eski `REINZ` marka anahtarlı arama ürünleri `db:setup` ile `VICTORREINZ`'e yeniden yazılır. SQL anahtarları (`enrichment_part_key()`, `enrichment_brand_key()`) da `partKey()`/`manufacturerBrandKey()` gibi aksanları katlar (#1139): eskiden ASCII olmayan harfi atıyorlardı (`LUBRİCO` → `LUBRCO`), bu yüzden `createRun` sorgu anında tedarikçi markasını TS'in yazdığı anahtarlarla (`LUBRICO`) eşleştiremiyordu; saklanan anahtarlar bozuk değildi. `db:setup` arama ürünlerinin marka anahtarını saklanan üreticiden yeniden hesaplar; takma ad değişiklikleri ve SQL/TS arasındaki olası sapmalar böylece kendiliğinden düzelir.

Açılış sırası: `db:setup` (marka tablosu ve `price_only` kuyruk değeri) → `enqueue` → `parts2world match` → `enable` → işçilerde `ENRICHMENT_PRICE_ONLY_SHARE=0.2` ve yeniden başlatma → 24 ve 72 saatte ölçüm. Pay süreç başlarken okunur; bekleyen üç işçinin hepsi yeniden başlatılmalı: `for j in spareto-pending parts2world-pending parts2world-proxy; do launchctl kickstart -k gui/$(id -u)/com.getirbakim.$j; done` (#1126: yeniden başlatılmayan `parts2world-proxy` bu kademeye ~18 saat hiç pay vermedi). Ölçüm sorguları:

```sql
-- Kaynak başına arama ve isabet (son 24 saat)
SELECT source,count(*) FILTER (WHERE outcome<>'blocked') AS aranan,count(*) FILTER (WHERE outcome='found') AS bulunan
FROM enrichment_source_attempts WHERE queue='price_only' AND attempted_at>now()-interval '24 hours' GROUP BY 1;
-- Kart olan fiyat listesi kodları
SELECT count(*) FROM storefront_price_only_items;
```
