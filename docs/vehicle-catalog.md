# TecDoc araç kataloğu

Katalog PostgreSQL'de tutulur. Mağazanın çalışma anında CSV okumaya veya bütün araç kataloğunu belleğe almaya ihtiyacı yoktur.

## Şema

Şemanın kaynağı `db/vehicle-schema.sql`; hem `db:setup` hem `db:vehicles` bu dosyayı uygular.

| Tablo | Kimlik ve ilişki | Alanlar |
| --- | --- | --- |
| `vehicle_brands` | `id`: TecDoc marka kimliği | Kaynak adı, gösterim adı, popülerlik |
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
4. Kod da yoksa ailenin üretim yılları örtüşen kodsuz serileri birleşir, ek başlangıç yılı (`clio-2025`, `midi-1984`); yılı bilinmeyen seride model kimliği.
5. Hâlâ çakışan slug en erken birimde kalır, sonraki `-<en küçük model id>` alır; yeni seri eklenince var olan adres değişmez.

Yerel katalogda 5.767 seri 4.372 birimdir; kural 5 bugün hiç devreye girmiyor. 10 marka ailesinin 273 serisi ve onlardan çıkan 128 adres `scripts/test-vehicle-model-groups.ts` içinde sabitlenmiştir: kural değişikliği var olan adresi taşıyamaz. Adres TecDoc adına bağlıdır; bir içe aktarım seri adını veya kodunu değiştirirse o adres 404 olur (kalıcı yönlendirme tablosu ancak böyle bir değişim görülürse).

Araç kataloğu parça uyumluluk ilişkisi değildir. Ürünlerin TecDoc tiplerine bağlanması ve katalogda araca göre filtrelenmesi ayrı bir çalışmadır. Plaka sorgulama servisi bağlı değildir.
