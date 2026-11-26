# TecDoc araç kataloğu

Katalog PostgreSQL'de tutulur. Mağazanın çalışma anında CSV okumaya veya bütün araç kataloğunu belleğe almaya ihtiyacı yoktur.

## Şema

Şemanın kaynağı `db/vehicle-schema.sql`; hem `db:setup` hem `db:vehicles` bu dosyayı uygular.

| Tablo | Kimlik ve ilişki | Alanlar |
| --- | --- | --- |
| `vehicle_brands` | `id`: TecDoc marka kimliği | Kaynak adı, gösterim adı (popüler markalar koddaki `popularVehicleMakes` listesinden gelir) |
| `vehicle_models` | `id`: TecDoc model kimliği; `brand_id` → marka | Model/kasa adı, üretim başlangıç/bitiş ayı |
| `vehicle_types` | `id`: TecDoc tip kimliği; `model_id` → model | Motor adı, cm³, kaynak yakıt adı, Türkçe yakıt adı, hp, kW, üretim ayları, normalize arama metni |

Kaynak kimlikler pozitif `integer` birincil anahtarlardır; yeniden numaralandırılmaz. İlişkiler foreign key ile korunur; marka/model silinmesi bağlı kayıtlar varken engellenir. Her tabloda `updated_at` bulunur ve yalnız değişen kayıtlar güncellenir.

Tarihler ay hassasiyetindedir; PostgreSQL `date` içinde ayın ilk günü olarak saklanır ve API'de `YYYY-MM` biçiminde döner. Kaynakta eksik model başlangıç/bitiş tarihleri ve motor hacimleri `NULL` kalır. Tipin başlangıcı zorunludur; bitişi `NULL` olduğunda arayüzde “devam ediyor” gösterilir ve seçilebilir son yıl güncel yıldır. Bitişin başlangıçtan önce olması, ayın ilk günü dışındaki tarihler ve pozitif olmayan teknik değerler DB kısıtlarıyla reddedilir.

Marka/model gezinmesi B-tree indekslerini kullanır. Türkçe karakterleri normalize edilmiş arama metninde marka/model/motor/yakıt ve VW/Volkswagen, hibrit/hybrid gibi adlar bulunur. `pg_trgm` GIN indeksi alt metin aramasını destekler. Arama SQL parametreleriyle çalışır; `%`, `_` ve ters eğik çizgi gerçek metin olarak aranır. Sonuçlar 60'lık sayfalara ayrılır; sayım ve sayfa aynı sorgu anını kullanır.

## Aktarım ve doğrulama

```sh
npm run db:vehicles
npm run test:vehicles
```

Aktarım `data/vehicle_brands.csv`, `vehicle_models.csv`, `vehicle_types.csv` dosyalarını okur. Hedef veritabanının `getirbakim`, kullanıcının `getirbakim_app` olduğu doğrulanır. CSV tırnakları/virgülleri, kimliklerin benzersizliği, ilişkiler, tarihler ve yakıt eşlemeleri kontrol edilir. Marka, model ve tipler bir transaction içinde, eşzamanlı aktarımları engelleyen advisory lock ile eklenir/güncellenir. Hata oluşursa transaction geri alınır. Kaynakta bulunmayan mevcut kayıtlar silinmez. Tekrar çalıştırma aynı kimlikleri günceller; veri değişmemişse sıfır kayıt güncellenir.

İlk aktarım: 251 marka, 5.767 model, 37.937 tip. Testler bütün kaynak alanlarını DB kayıtlarıyla karşılaştırır; ayrıca API, arama/sayfalama, hatalı kimlik/yıl, SQL arama karakterleri ve DB ilişki/tarih kısıtlarını sınar. Bunlar yerel DB üzerinde çalışan entegrasyon testleridir.

## Araç tercihi

Seçili araç `gb_vehicle` HttpOnly çerezinde 30 gün saklanır; seçim kaydedilirken tip kimliği ve yıl DB kataloğundan doğrulanır. Garaj birden fazla araç tutar. Ziyaretçide liste `gb_garage` çerezindedir (en çok 5 araç). Giriş yapmış B2B ve yönetim hesaplarında liste `account_vehicles` tablosundadır (`db/garage.sql`, en çok 20 araç) ve cihazlar arası görünür. Hesapta seçili araç çerezi yoksa en son seçilen kayıtlı araç kullanılır. Kaldırılan seçim `none` olarak işaretlenir, böylece eski bir araç kendiliğinden geri gelmez. Girişte ziyaretçi garajı hesaba taşınır. Aynı araç, tip + model yılı (serbest metinde marka/model/yıl) anahtarıyla tek kayıttır. Kural `src/modules/store/garage.ts` içindedir.

## Model sayfaları

`/yedek-parca/<marka>/<model>` (#639) bir model ailesinin bir neslini gösterir; TecDoc'un kasa başına serileri birleşir. `vehicle_models`'te aile/nesil alanı yoktur, birim addan çıkarılır (`src/modules/store/vehicle-model-groups.ts`, açıklama eşleştiricisinin `ROMAN`/`BODY` sözlükleriyle). Slug marka içinde tekildir:

1. Roma rakamı nesil → `<aile>-<sayı>`: `golf-7`, `megane-3`, `clio-4`, `focus-3`. `GOLF SPORTSVAN VII`, `GOLF PLUS V` ayrı ailedir.
2. Addaki kod sözcüğü → `<aile>-<kod>`: `passat-b8`, `a4-b8`, `transporter-t5`, `passat-b3-b4`, `passat-b5-5`.
3. Yoksa parantezdeki şasi kodunu paylaşan seriler birleşir, ek en erken serinin ilk kodu: `tipo-356` (Saloon + Hatchback + Estate), `doblo-223`, `3-e90`, `c-class-w205`. BMW/Mercedes kasaları ayrı koda sahip olduğu için ayrı kalır (`3-e91`).
4. Koddan ve romen rakamından sonra aileyi izleyen ilk sözcük salt sayıysa sayı modeli adlandırır: `tiggo-7`, `atto-3`, `seal-6`, `mg-5`, `r-1200`, `ram-1500`. Sayı nesil değil modeldir; açıklama eşleştiricisi (`describe()`) aynı sözcüğü aynı şekilde okur. Kodlu seri (`MG 4 (EH32)` → `mg-eh32`) kodunu kullanır.
5. Kod da sayı da yoksa ailenin üretim yılları örtüşen kodsuz serileri birleşir, ek başlangıç yılı (`clio-2025`, `midi-1984`); yılı bilinmeyen seride model kimliği. Bitiş yılı boş (hâlâ üretimde) seri, ailenin 4+ yıl sonra başlayan sonraki neslinin başlangıcında biter (eşleştiricideki kuralın aynısı): `ford-usa/mustang-2004` 2014 Mustang'e kadar gider, `mustang-2014` ve `mustang-2023` ayrı birimdir. Sınır: aynı nesle 4+ yıl sonra eklenen yeni gövde (ör. `DACIA Spring Cargo`) ayrı birim olur.
6. Hâlâ çakışan slug en erken birimde kalır, sonraki `-<en küçük model id>` alır.

Yerel katalogda 5.767 seri 4.442 birimdir. 15 marka/ailenin serileri ve onlardan çıkan adresler `scripts/test-vehicle-model-groups.ts` içinde sabitlenmiştir (kodsuz sayılı seriler için Chery Tiggo, BYD Atto/Seal, MG, BMW motosiklet; açık uçlu Mustang dahil): kural değişikliği var olan adresi taşıyamaz. Marka sayfası yalnızca listelenebilir ürünü olan birimleri bağlar (`getListedModelGroups`, `catalog.ts`); ürünü olmayan model sayfası 404 verir. Model × kategori sayfası (`/kategori/<kategori>/<marka>/<model>`, #673) aynı uyum listesini kategoriyle daraltır; model sayfası yalnız bu modelde ürünü olan kategorileri bağlar (`src/modules/store/listing-categories.server.ts`).

Marka sayfasının ürün listesi (#674) iki kaynağın birleşimidir: motor düzeyi uyumluluk (`storefront_make_fits`) ve markanın serilerinde tedarikçi açıklamasından okunan model (`storefront_description_fits`: `product_model_fitments`, yöneticinin çıkardığı modeller ve araç kararı olan ürünler hariç, #661; ikincil teklif birincil ürün olarak sayılır). Açıklama modellerinin markası (#956) uyan tedarikçi satırı başına `storefront_make_description_fits` tablosunda önceden hesaplanır (`storefront_make_fits_refresh` ile aynı yenilemede; `product_model_fitments` ve `product_override_fitment_hides` tetikleyicileri satırı/ürünü kuyruğa yazar); ikincil teklifin birincile çevrilmesi okumada yapılır, böylece teklif gruplaması değişince yenileme gerekmez. Yenileme uyum satırı değiştirdiğinde arka plan senkronu uyum sayacını (`fits_epoch`, #1368) ilerletir (en çok 30 sn'de bir), önbellekli marka listesi de birkaç saniye içinde güncellenir; uyum okumayan üretici ve kategori listeleri bu artışla yeniden yüklenmez. VW için okuma ~60 ms'den ~22 ms'ye indi (yerel, sıcak), liste aynıdır. Birleşim `makeFitsSql` (`catalog.ts`) ile sorgu içinde bir kez (InitPlan) okunur, kimlikler Node'a taşınmaz; site haritasının marka dosyası (`loadMakeSlugs`) aynı iki kaynağı okur. Model birimleri iki bölümde listelenir: her serisinin REPXPERT gövde tipi `İki tekerlekli taşıt` olan birimler (`getMotorcycleModelIds`, `vehicle_type_specs`) “‹Marka› motosiklet modelleri” başlığı altında, diğerleri “‹Marka› modelleri” altında; spesifikasyonu olmayan veya karışık seri otomobil sayılır.

Model sayfasının özeti (`getModelGroupFacts`) REPXPERT verisinden birimin görselini (serilerin sırasıyla görseli olan ilk seri), gövde tiplerini ve motor kodlarını (ilk 20, sıklığa göre) gösterir. Ürün sayfasındaki uyumlu araç başlıkları ve açıklamadan okunan model rozetleri model sayfasına bağlanır (`getModelPagePaths`); motor düzeyi satır yalnızca `storefront_model_fits` ürünü listelediğinde bağlanır, böylece bağlantı senkronu gecikse de 404'e gidilmez.

Parça + araç diye okunan aramalar (“fren balatası passat”, mağaza araması ve bayi API'si, `vehicleSearchScope` ve `vehicleFittedHits`, `catalog.ts`, #1395, #1407) önce araç sözcüklerinin kapsamını okur: bütün tiplerini kapsadığı modeller (“bmw”, “passat”) ve yalnız bazı tipleri eşleşen modellerin tipleri (“passat tdi”). Uyum #1407'den beri aramanın bulduğu ürünlerden okunur: bir isabet, bütün eşleşen modellerde `storefront_model_fits`'te varsa, kısmi tiplerde güvenilen zenginleştirme bağlantısı, payload ile uyuşan uyumluluk satırı ve yöneticinin tip kararlarıyla (`fittedProductIds` ile aynı kural) uyumlu sayılır; sonuç isabet sırasıyla döner. Maliyet tip sayısını değil isabet sayısını izler. Yerelde, tekrar okumada, aynı kimlik kümesiyle (üst uçlar yüklü makinede): “fren balatası dizel” (400 model + 10.649 tip) 31,6-46,9 sn → 0,6-1,0 sn, “yağ filtresi benzin” (2.720 + 14.547) 39-54 sn → 0,5-1,0 sn, “silecek benzin” 41,8-56,4 sn → 0,24-0,77 sn, “fren balatası volkswagen tdi” (13 + 769) 10,2-14,3 sn → 0,8-2,3 sn, “fren balatası tdi” (21 + 1.890) 10,8-20,8 sn → 0,8-1,2 sn, “fren balatası passat tdi” (120 tip) 1,2-2,8 sn → 0,8-1,4 sn, “fren balatası bmw” (183 model) 0,30-0,41 sn → 0,05-0,09 sn; bir isabet kümesinin ilk okuması daha yavaştır (2-5 sn'ye kadar). Tip başına en az 300 isabet düşen okumada (az tip, çok isabet: “filtre passat tdi”, 41.628 isabet, 120 tip) eski okuma, yani modellerin uyumu ve tiplerin canlı okuması (`fittedProductIds`), daha hızlıdır (1,3-2,3 sn, isabetlerden 1,5-5,1 sn) ve o seçilir. Sorgudaki iki plan tuzağı bilinçli olarak önlenir: `f.vehicle_type_id+0` olmadan planlayıcı `product_vehicle_fitments_type_idx`'i her tip ve bağışçı için ayrı yoklar (“fren balatası passat tdi”: 6,1 milyon yoklama, 6,5 sn), `+0` ile bağışçının uyumluluk satırları birincil anahtardan okunup tip dizisiyle karşılaştırılır; bütün modellerin satırları da önce bir kez okunup isabetlerle birleştirilir, isabet başına `EXISTS` ile planlayıcı birkaç düzine modelde anahtarı model ve isabet başına ayrı arar (“fren balatası golf”, 30 model: 672 bin arama, 0,4-0,7 sn; “filtre golf” 1,1 sn → 0,04-0,07 sn). Model satırları paylaşılan bağlantı yenilemesi kadar günceldir (uyum değişikliği veya yönetici kararı arka plan senkronu ve uyum sayacının artışıyla en geç ~30 sn sonra görünür), marka ve model sayfalarıyla aynı; açıklamadan okunan modeller aramaya eskisi gibi eklenmez. Kısmen eşleşen modellerden 500'den fazla tip getiren bölme (`VEHICLE_SEARCH_MAX_LIVE_TYPES`; motor veya yakıt sözcüğü: “tdi” 1.890 tip, “volkswagen tdi” 769, “dizel” 10.649, “benzin” 14.547) #1395'teki gibi atlanmaz, ertelenir: önce öteki bölmeler denenir (“fren balatası passat tdi” yine “tdi” yerine “passat tdi” okur), hiçbiri uyumlu ürün bulmazsa ertelenenler en uzun araç ifadesinden başlayarak okunur ve uyumlu ürün bulan ilki araç bildirimiyle sonuçtur: “fren balatası dizel”, “yağ filtresi benzin”, “silecek benzin” #1395'teki sınırdan önceki gibi yeniden dizel/benzinli tiplere uyan parçaları listeler. Bunun bedeli uyum okumasıdır: bayi API'sinde (yerel, yüklü makine) “fren balatası dizel” 0,15 sn → 1,7-2,1 sn, “yağ filtresi benzin” 0,15 sn → 1,1-1,5 sn, “silecek benzin” 0,4 sn → 0,5-0,9 sn, “fren balatası volkswagen tdi” 0,2-0,3 sn → 2,3-3,2 sn, “fren balatası tdi” 0,13 sn → 1,3-4,5 sn; RDS'te soğuk okuma ayrıca izlenir. Ertelenen bölme uyumlu ürün bulmazsa “uyumlu bulunamadı” denmez (bu kadar geniş bir sözcük için anlamlı değildir): varsa başka bölmenin uyumsuz okuması, yoksa ilk ertelenen bölmenin parça kısmının eşleşmeleri araç bildirimi olmadan listelenir (parça kısmı yazım düzeltmesiyle bulunduysa düzeltme bildirilir). 0, kısmen eşleşen modeli olan her bölmeyi erteler.

### Türkiye pazar adları

TecDoc serileri Avrupa adıyla yazar; bazı birimler Türkiye'de başka adla bilinir. Bu adlar `modelAliases` tablosundadır (`src/modules/store/vehicle-model-groups.ts`, anahtar `<marka slug>/<model slug>`): `fiat/tipo-356` → Egea, `renault/thalia-1` → Clio Symbol, `renault/thalia-2` → Symbol, `hyundai/accent-3` → Accent Era, `hyundai/accent-4` → Accent Blue. Etiket “Fiat Egea (Tipo 356)”, H1 “Fiat Egea (Tipo 356, 2015–) yedek parçaları” olur; adres, kanonik ve arama değişmez. Ad eklerken birimin tek nesil olduğunu ve o adla satıldığını seri adları ve üretim yıllarıyla doğrula (`npm run vehicles:slugs -- snapshot <dosya>`), birimin serilerini `scripts/test-vehicle-model-groups.ts` kataloğuna ekleyip adresini sabitle: test her takma adın sabitlenmiş bir adresi gösterdiğini denetler.

### Adres kararlılığı ve içe aktarım kontrolü

Adres, birimin en erken serisinin adından ve yıllarından türer; TecDoc adı, kodu veya tarihi değişirse ya da katalog yeni seri kazanırsa adres taşınabilir. Daha yeni bir seri (sonraki nesil) var olan adresleri değiştirmez, en çok açık uçlu birimi böler ve önceki parça adresini korur. Bir birimin en erken serisinden önce başlayan veya iki yıl aralığını/şasi kodunu köprüleyen tek seri eklemesi adresi taşır; yerel katalogda 141 böyle tek seri ekleme ölçüldü (2026-11-15). Bu bilinen sınırdır; kalıcı yönlendirme tablosu ancak canlıda böyle bir taşınma görülürse eklenir.

Her araç kataloğu içe aktarımından önce ve sonra (yalnız okur, yazma yapmaz):

```
npm run vehicles:slugs -- snapshot data/model-slugs-before.json   # içe aktarımdan önce
npm run vehicles:slugs -- compare data/model-slugs-before.json    # içe aktarımdan sonra
```

`compare` var olan adreslerden kaybolanları (`LOST`, sayfa 404 olur; serilerin gittiği yeni slug `->` sonrasında yazılır) ve aynı adreste başka serilerle kalanları (`CHANGED`) listeler, özet satırı `kept/new/changed/lost` verir; kaybolan varsa çıkış kodu 1'dir. `LOST` adresler yayına çıkmadan önce yönlendirme veya aktarım düzeltmesiyle ele alınmalıdır.

Araç kataloğu parça uyumluluk ilişkisi değildir. Ürünlerin TecDoc tiplerine bağlanması ve katalogda araca göre filtrelenmesi ayrı bir çalışmadır. Plaka sorgulama servisi bağlı değildir.
