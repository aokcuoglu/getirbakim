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

Seçilen araç `gb_vehicle` HttpOnly çerezinde 30 gün saklanır; DB'de ziyaretçi tercih kaydı oluşturulmaz. Seçim kaydedilirken tip kimliği ve yıl DB kataloğundan doğrulanır. Mevcut hesaplar servis/yönetim kullanıcılarına yöneliktir; kişiler arası veya cihazlar arası garaj senkronizasyonu bulunmaz. İleride kişisel hesaplarla birden fazla araç ihtiyacı doğarsa hesaplara bağlı garaj tablosu eklenebilir.

Araç kataloğu parça uyumluluk ilişkisi değildir. Ürünlerin TecDoc tiplerine bağlanması ve katalogda araca göre filtrelenmesi ayrı bir çalışmadır. Plaka sorgulama servisi bağlı değildir.
