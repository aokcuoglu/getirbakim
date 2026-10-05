# Başbuğ canlı veri incelemesi — 1 Ekim 2026

Kaynak: kullanıcının sağladığı `Basbug.postman_collection.json` ve yerel ortam bilgileriyle yapılan canlı, salt okunur çağrılar. Dinamik çağrılmadı. DB ve mağaza kataloğuna veri yazılmadı.

## Doğrulanan erişim

`POST https://api.basbug.com.tr/auth/Login` JSON gövdesinde `kullaniciAdi`, `parola`, `clientID`, `clientSecret` bekliyor. HTTP 200 yanıtı `token`, `refreshToken`, `tokenTipi`, `tokenBitisSuresi`, `refreshTokenBitisSuresi` içeriyor. Canlı yanıtta tip `Bearer`, erişim süresi 300 saniye, refresh süresi 3600 saniye. Sonraki çağrılar `Authorization: Bearer <token>` kullanıyor. Koleksiyonda `/auth/RefreshToken` da var; bu incelemede çağrılmadı.

Firma adı `BASBUG`. Swagger adresleri token ile de 403 dönüyor; bu, ürün servislerine erişimi engellemiyor.

## Başarılı çağrılar

| Uç nokta (`/material/` altında) | Parametreler | Yanıt |
| --- | --- | --- |
| `ListeGrubuGetir` | `FirmaAdi` | `malzemeGruplariListesi`: 15 grup; `kod`, `ad` |
| `MalzemeleriGetir` | `FirmaAdi`, `ListeGrubu=FIAT` | `malzemeListesi`: 18.921 satır, 18.918 farklı `no` |
| `MalzemeAra` | `FirmaAdi`, `MalzemeNo=COR 82016529` | Tek ürün nesnesi; fiyat ve depo stok alanlarını da içeriyor |
| `FiyatGetir` | `FirmaAdi`, `ListeGrubu=FIAT` | `fiyatListesi`: 19.106 satır, 18.917 farklı `no` |
| `StokGetir` | `FirmaAdi`, `ListeGrubu=FIAT`, `Depo=MRK` | `stokListesi`: 18.921 satır, 18.918 farklı `no` |
| `DovizBilgisiGetir` | `FirmaAdi` | `dovizListesi`: EUR ve USD; `alis`, `satis` sayısal metin |
| `TopluMalzemeAra` | `FirmaAdi`, virgülle ayrılmış `MalzemeListesi` | `malzemeListesi`; fiyat ve `sDepolar` depo dizisi |

Koleksiyondaki iki MAG koduyla toplu arama doğrulandı. Tek `COR 82016529` koduyla toplu çağrı HTTP 600 ve `Malzeme Listesi` koşulu hatası verdi; aynı kod tekil aramada çalışıyor. Toplu çağrıların kabul koşulları ayrıca doğrulanmalı.

## Alanlar ve DB etkileri

| Alan | Gözlem / saklama önerisi |
| --- | --- |
| `no` | Tedarikçinin parça kodu; boşluk ve noktalama içeriyor. Ham değeri korunmalı. Birleştirme anahtarı firma + parça kodu olmalı. |
| `ac`, `ac2` | Ürün adı ve ek açıklama |
| `uk` | Örneklerde CORTECO, PIERBURG gibi markalar |
| `oe` | OEM referans metni. Tek kod, boşluklu kod, `;` veya `|` ile ayrılmış kodlar var. Ham metin ve ayrı kod tablosu tutulmalı; yalnızca boşluktan bölünmemeli. |
| `lgk` | Liste grubu kodu. Ürün kategorisi veya kesin araç markası diye kullanılmamalı. |
| `m`, `mo`, `y` | Model, motor ve yıl açıklamalarına benzeyen serbest metin. `PALIO/SIENA/...`, `1,2-1,4`, `07-` örnekleri var. Kesin araç uyumluluk ilişkisi kurmak için yeterli değil. |
| `b` | Örnekte birim `ADET` |
| `dc` | Para birimi: FIAT ürün satırlarında 9.460 TL, 7.669 EUR, 1.792 USD. |
| `lf` | Ürün listesindeki fiyat. Anlamı henüz resmi alan açıklamasıyla doğrulanmadı. |
| `nf`, `mif`, `k` | Ayrı fiyat servisinde geliyor. `nf`/`mif` pozitif ondalık; `k` 0 veya 1. Fiyat türleri, vergi dahil/hariç durumu ve `k` anlamı henüz doğrulanmadı. |
| `stok`, `sYol`, `sFarkliDepo` | MRK örneğinde yalnızca 0/1. Bulunabilirlik bayrağı olabilir; gerçek adet olarak kullanılması için kanıt yok. |
| `sDepo`, `sDepolar` | Depo kodu ve toplu aramadaki depo bazlı stok dizisi. Depo ayrı boyut olmalı. |
| `mkk` | Anlamı doğrulanmadı; ham değer korunmalı. |

Tekil arama `sMrk`, `sIzm`, `sAnk`, `sAdn`, `sErz`, `sYol` alanları içeriyor. Toplu arama `sDepolar` içinde farklı depo kodları döndürüyor. Bu iki biçim sabit ve aynı depo listesi varsayılarak birleştirilmemeli.

## Veri kalitesi

- Ürün ve stok listesinde bir kod toplam dört kez geliyor; yinelenen kayıtlar birebir aynı.
- Fiyat listesinde 175 farklı kod tekrarlanıyor; yinelenen kayıtlar birebir aynı. Çelişkili tekrar görülmedi; importer gelecekteki çelişkileri raporlamalı.
- Ürün listesinde olup fiyat listesinde olmayan bir kod var. Eksik fiyat sıfır fiyatla değiştirilmemeli.
- Ürün ve stok listelerinin farklı kod kümeleri eşleşiyor. Fiyat listesinde ürün listesi dışında kod yok.
- MRK için 4.807 satırda `stok=1`, 400 satırda `sYol=1`, 4.091 satırda `sFarkliDepo=1`. Bunlar adet toplamı değildir; yinelenen satırlar dahil satır sayılarıdır.
- `k=0` 17.270 fiyat satırında, `k=1` 1.836 satırda görülüyor.

## Önerilen DB ayrımı

1. **Tedarikçi ürünleri:** firma + ham parça kodu, marka, açıklamalar, liste grubu, birim, ham OEM/araç metinleri, kaynak yanıt ve çekilme zamanı.
2. **OEM kodları:** ürünle çoklu ilişki; ham kod ve arama için normalize edilmiş karşılığı. OEM eşleşmesi tek başına iki tedarikçinin ürününü aynı fiziksel ürün saymak için yeterli değil.
3. **Tedarikçi fiyatları:** `lf`, `nf`, `mif` için ayrı ondalık değerler, ham para birimi, `k`, kaynak ve çekilme zamanı. Fiyat yanıtındaki para birimi ürün kaydından ilişkilendirilmeli; eksik ilişki kaydı ayrılmalı.
4. **Depo stok durumu:** ürün + depo, kaynak stok değeri, yolda/farklı depoda bilgisi; gerçek adet doğrulanana kadar adet alanı boş kalmalı.
5. **Kur gözlemleri:** alış/satış ondalıkları, para birimi, çekilme zamanı. API örneğinde kur tarihi yok; çekilme zamanı kurun yürürlük tarihi sayılmamalı.
6. **Senkronizasyon çalışmaları:** grup/depo, başlangıç/bitiş, ham/tekil/eksik/çelişkili kayıt sayıları ve sonuç. Farklı servislerden çekilen listeler atomik bir anlık görüntü gibi kabul edilmemeli.

Mevcut `products.price_kurus` mağaza satış fiyatı, `products.stock` adet olarak kullanılıyor. Başbuğ fiyatlarını ve 0/1 stok değerlerini doğrudan bu alanlara aktarmak doğru değil. Vergi, müşteri fiyat türü, kur ve satış marjı kuralları doğrulandıktan sonra mağaza fiyatı türetilmeli.

## Tekrar çalıştırma

`npm run supplier:basbug:inspect`

Varsayılanlar koleksiyondan: `BASBUG`, `FIAT`, `MRK`, tekil aramada `COR 82016529`, toplu aramada `MAG 359002805240,MAG 359003410380`. İsteğe bağlı `BASBUG_FIRMA_ADI`, `BASBUG_SAMPLE_GROUP`, `BASBUG_SAMPLE_WAREHOUSE`, `BASBUG_SAMPLE_CODE`, `BASBUG_SAMPLE_CODES` ile değiştirilebilir. Komut Auth alır ve yukarıdaki yedi okuma çağrısını yapar; alan tiplerini/satır sayılarını yazdırır. Ham örnekleri Git dışında `.local/basbug/` altında kısıtlı dosya izinleriyle saklar. Token/refresh token diske yazılmaz ve çıktıya verilmez. Yanıt dosyaları komut her çalıştığında güncellenir.

Bu inceleme tek grup ve MRK depo örneğidir; tam katalog, tüm depo erişimi, refresh akışı, rate limit ve düzenli senkronizasyon henüz sınanmadı.
