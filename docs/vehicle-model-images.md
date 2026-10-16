# Araç seçiminde model görselleri

Araç seçimi paneli ("Aracını onayla" adımı ve Garajım sekmesi) model serisinin yanında gerçek bir fotoğraf gösterir. Kaynak Wikidata (`image`, P18) ve Wikimedia Commons'tır; yalnız serbest lisanslı dosyalar (CC0, CC BY, CC BY-SA, kamu malı) alınır ve her görsel yazar + lisans satırıyla gösterilir (Commons dosya sayfasına bağlantılı). Issue: #251.

## Veri

- `vehicle_model_images` (`db/vehicle-model-images.sql`): `vehicle_models` başına bir satır; görsel baytları `product_media_objects` (object storage, `vehicles/` klasörü, 480 px WebP). `match_kind`: `generation` = Wikidata öğesi serinin kendisi (veya TecDoc adı nesil belirtmiyor); `family` = yalnız model ailesi eşleşti, fotoğraf başka nesle ait olabilir. `status`: `pending` → `approved` / `rejected`; mağaza yalnız `approved` satırları gösterir.
- `vehicle_model_image_lookups`: deneme kaydı; tekrar koşmada denenmiş seriler atlanır, `--retry` ile yeniden denenir.

## Eşleştirme

```
npm run vehicles:images -- match [--limit=N] [--brand=RENAULT] [--since=2005] [--retry]
npm run vehicles:images -- status
npm run vehicles:images -- approve --kind=generation [--brand=RENAULT]
```

TecDoc adından sorgular üretilir (`CLIO V (B7_)` → `Renault Clio V`, `Renault Clio Mk5`, `Renault Clio B7`, …, `Renault Clio`), Wikidata'da aranır, üretici adı etiket/açıklamada doğrulanır, ilk görselli öğe alınır. Fotoğrafın çekim yılı serinin üretim aralığının dışındaysa (1 yıl önce / 2 yıl sonra toleransla) aday atlanır ve sıradaki denenir. Wikimedia kullanım politikası gereği istekler sıralı ve `User-Agent` tanımlıdır (`WIKIMEDIA_CONTACT`, `WIKIMEDIA_PAUSE_MS`).

Ölçüm (16 Ekim 2026, 2005 sonrası seriler): ~%60 nesil, ~%15 aile eşleşmesi, ~%25 bulunamadı (çok yeni seriler, lisanssız/NC dosyalar, Wikidata'da öğesi olmayan modeller).

## Onay ve yayın

`/yonetim/arac-gorselleri`: görsel, Wikidata öğesi, eşleşme türü, lisans ve durum; tek tek onay/ret, nesil eşleşmelerinin toplu onayı. Aile eşleşmeleri onaysız yayına çıkmaz.

Prod'a taşıma `storefront:sync` paketinin parçasıdır: `vehicleImages` satırları (onay durumuyla) ve medya nesneleri her pakette tam gider; prod'da aynı TecDoc model id'si yoksa satır atlanır ve sayılır.
