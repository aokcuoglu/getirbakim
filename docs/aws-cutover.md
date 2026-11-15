# AWS geçiş günü çalıştırma kılavuzu

getirbakim.com'un Contabo VPS'ten AWS'e (eu-central-1, Lokum Ops) taşınması. AWS veritabanı yalnız **yerel katalogdan** kurulur. VPS'ten veri taşınmaz: site canlıya hiç çıkmadı, VPS'teki siparişler demo ve tek hesap yerelde de olan admin (#457). İşlem tabloları (sipariş, ödeme, sepet, oturum, abonelik) AWS'te boş başlar; `accounts` yerelden gelir, `commerce_settings` `setup.ts`'in varsayılanlarıyla kurulur (Başbuğ ödeme kontrolü `live`, kargo 150 TL). Gerekçe ve ölçümler: [veritabanı kaynağı önerisi](https://claude.ai/artifact/AAxXMTXEFbkH7kt34Gpmu7).

Bakım penceresi Türkiye saatiyle 03:00–08:00. Medya bir gün önce yüklendiği için beklenen kesinti **~45–60 dk**; bunun ~15 dk'sı bizde, kalanı Lokum Ops'un geri yükleme ve doğrulaması. Süreler 12 Kasım 2026 provasından.

## Ön koşullar

- [ ] Lokum Ops yerel kaynaklı aktarımı onayladı. İki dosya kümesi için yükleme bağlantısı verecek: **M** medya (bir gün önce, Mac'ten), **A** veritabanı + yeni medya (geçiş günü, Mac'ten). 13 Kasım'a kadar planlanan **B** (VPS işlem verisi) kaldırıldı.
- [ ] AWS'te tedarikçi senkronizasyonu en az bir kez çalıştı ve Dinamik isteği VPS proxy'sinden geçti. Kontrol (VPS): `docker compose -f /opt/getirbakim-egress/compose.yml exec squid grep 18.194.217.212 /var/log/squid/access.log` → en az bir `CONNECT dinamikapp-api.dinamik.online:443 200`. 12 Kasım'da bu yol **hiç kullanılmamıştı**.
- [ ] VPS'te bakım modu kurulu: `bash /opt/edge/getirbakim-maintenance.sh status` → `flag: off`. Bkz. [infra/edge](../infra/edge/README.md).
- [ ] CloudFront getirbakim.com ve www için hazır (12 Kasım'da doğrulandı): `curl --resolve getirbakim.com:443:<CloudFront IP> https://getirbakim.com/` → 200, www → 301 apex, sertifika iki adı kapsıyor (28 Mayıs 2027'ye kadar).
- [ ] Mac'te SSH takma adı `getirbakim-prod` (root@173.249.36.2, `~/.ssh/vps_deploy_key`).

## Bir gün önce: medya

Mac'in yükleme hızı ~8 Mbit/sn (12 Kasım ölçümü): tüm medya (~4,4 GB) ~75 dk sürer. Bu yüzden medya bakım penceresinden önce gider; görseller içerik özetiyle adlandırıldığı için geçiş günü yalnız yeni olanlar eklenir.

```bash
bash scripts/cutover/export-local.sh media     # ~5 dk; çıktı: .local/aws-export-local-media-<zaman>/
```

`ls -lh` çıktısı LO'ya gider, LO **M** bağlantılarını üretir, Mac'ten yüklenir. Klasördeki `media-keys.txt` geçiş günü gerekecek; silinmez.

Arşiv macOS'un `._` meta veri girdileri olmadan oluşturulur (`COPYFILE_DISABLE=1`, #451). 13 Kasım aktarımında LO ~61 bin `._` dosyasını elle ayıklamıştı; macOS `tar -t` bunları göstermez, sayım için Python `tarfile` kullanılır.

## Geçiş günü

Saatler örnek. "Biz" = getirbakim, "LO" = Lokum Ops.

| Saat | Kim | Adım | Komut / not | Süre |
| --- | --- | --- | --- | --- |
| 02:30 | Biz | Yerel işçileri durdur | `bash scripts/cutover/local-workers.sh stop` | 1 dk |
| 02:30 | Biz | Başbuğ + SETA tazele, ana katalog | `bash scripts/cutover/refresh-local-suppliers.sh` | 4–10 dk |
| 03:00 | Biz | VPS bakım modu | VPS'te `bash /opt/edge/getirbakim-maintenance.sh on` (DNS değişene kadar demo siparişi alınmasın) | 1 dk |
| 03:01 | Biz | Veritabanı + yeni medya | `bash scripts/cutover/export-local.sh final <media klasörü>/media-keys.txt` | ~4 dk |
| 03:05 | Biz → LO | Klasörün `ls -lh` çıktısı | LO **A** bağlantılarını üretir | LO |
| 03:15 | Biz | Yükleme | A Mac'ten (~0,75 GB, ~12 dk). Komutlar değiştirilmeden; her biri HTTP 200 | ~12 dk |
| 03:30 | LO | Geri yükleme | 1) boş DB'ye A dump'ı, 2) `setup.ts`, 3) `ANALYZE`, 4) M + A medyası → S3 | LO |
| — | LO | Doğrulama | SHA-256; tablolar A'nın `table-counts.txt`'siyle birebir. `excluded-table-data.txt`'deki tablolar boş, yalnız `commerce_settings` tek satır (`setup.ts`) | LO |
| — | Biz | AWS zamanlayıcıları | `getirbakim-production` grubunda önce `supplier-sync` ve `nightly-jobs`, DNS'ten hemen sonra `payment-reconciliation` açılır (aşağıda). Geçişe kadar üçü de kapalı | 2 dk |
| — | Biz | DNS | Aşağıda | 5 dk |
| — | Birlikte | Kontrol | Aşağıda | 15 dk |
| Sonra | Biz | Yerel işçileri başlat | `.env.local`: `STOREFRONT_SYNC_TARGET=aws` + AWS profili, sonra `bash scripts/cutover/local-workers.sh start` | 1 dk |

Başbuğ tazelemesi VPS'teki canlı senkronizasyonla aynı anda çalışabiliyor (provada denendi). Dinamik geçişe dahil değil: Dinamik canlıda bugün satılmıyor; AWS'te zamanlayıcı onları proxy üzerinden tazeledikçe fiyatları görünür.

## Canlı ödeme kontrol listesi

DNS'ten önce kontrol edilir (14 Kasım 2026 durumu parantez içinde):

- [x] `getirbakim-production/app` secret'ında canlı TAMI çifti: `TAMI_PAYMENT_API_BASE_URL=https://paymentapi.tami.com.tr`, `TAMI_PORTAL_BASE_URL=https://portal.tami.com.tr`; üye işyeri, terminal, secret key ve JWK değerleri dolu (tanımlı).
- [x] `TAMI_CHECKOUT_ENABLED=true` (tanımlı).
- [x] `PAYMENT_RECONCILIATION_SECRET` ≥32 karakter, uygulama ve mutabakat görevi aynı değeri okur (64 karakter).
- [x] App görev tanımında `SITE_URL=https://getirbakim.com`; TAMI callback adresi bundan üretilir (tanımlı).
- [ ] `/yonetim/fiyatlandirma` → Kargo: gerçek ücret ve ücretsiz kargo eşiği. AWS DB `setup.ts` varsayılanlarıyla kuruldu (150 TL / 1.500 TL); bunlar yer tutucudur.
- [ ] DNS'ten hemen sonra mutabakat zamanlayıcısını aç:

```bash
export AWS_PROFILE=getirbakim-prod
aws scheduler get-schedule --group-name getirbakim-production --name getirbakim-production-payment-reconciliation --output json \
  | jq '{Name,GroupName,ScheduleExpression,ScheduleExpressionTimezone,FlexibleTimeWindow,Target,Description,State:"ENABLED"}' > /tmp/s.json \
  && aws scheduler update-schedule --cli-input-json file:///tmp/s.json
```

  İlk çalışma 5 dk içinde `/getirbakim-production/operations` günlüğüne `200 {"checked":…}` yazar. Görev tanımı ve zamanlayıcı ayrıntıları: [Online ödeme](payments.md#ayarlar).

## DNS değişikliği (Cloudflare, getirbakim.com zone)

| Kayıt | Şu an (geri dönüş değeri) | Geçişte |
| --- | --- | --- |
| `getirbakim.com` | A `173.249.36.2`, Proxied | CNAME `d3nb3fa5r23q3l.cloudfront.net`, **DNS only** |
| `www` | CNAME `getirbakim.com`, Proxied | CNAME `d3nb3fa5r23q3l.cloudfront.net`, **DNS only** |

Proxy kapalı olmalı: sertifika, önbellek ve WAF CloudFront'ta. Apex'te A kaydı silinip CNAME eklenir (Cloudflare apex CNAME'i düzleştirir). ACM ve SES DKIM CNAME'lerine dokunulmaz. Kontrol: `dig +short getirbakim.com @1.1.1.1` CloudFront IP'leri döner; `curl -sI https://getirbakim.com/` → `via: … (CloudFront)`.

## Doğrulama

- `https://getirbakim.com/api/health` → `ok` ve AWS sürümü.
- Katalogda Başbuğ fiyatları görünüyor ("Fiyat bilgisi güncelleniyor" yok); ürün sayfası, kodla arama, araç seçimi, üye girişi, yönetim paneli.
- Dinamik ürünü sepete: sipariş adımındaki canlı stok kontrolü proxy'den geçer (squid loguna `18.194.217.212 … CONNECT dinamikapp-api… 200`).
- Ödeme akışı LO ile birlikte, küçük tutarlı gerçek bir siparişle; ardından iade.

## Geri dönüş

1. Cloudflare: iki kaydı "Şu an" değerlerine al (apex A `173.249.36.2` Proxied, www CNAME `getirbakim.com` Proxied).
2. VPS'te `bash /opt/edge/getirbakim-maintenance.sh off`.
3. AWS'te geçişten sonra gerçek sipariş/üyelik oluştuysa VPS'e elle aktarılır.

VPS, birkaç gün sorunsuz çalışmadan ve Dinamik AWS IP'sini allow-list'e ekledikten sonra kapatılır.

## Prova notları (12 Kasım 2026)

| Adım | Sonuç |
| --- | --- |
| CloudFront (getirbakim.com / www) | 200 / 301 → apex; Amazon sertifikası iki adı kapsıyor |
| Dinamik proxy (AWS → VPS:3128) | Squid'de AWS IP'sinden hiç istek yok: yol denenmedi |
| Yerel tedarikçi verisi (öncesi) | Başbuğ/Dinamik/SETA son senkron 11 Ekim; taze ürün 0 |
| Başbuğ tam tur | 1. deneme FORD'da `upstream (StokGetir)` ile durdu (140 sn); 2. deneme 15 grup, 407 sn, 319.533 / 324.196 taze |
| SETA | 1.395 ürün, 45 sn |
| Dinamik tam tur (SSH tüneli) | 28 marka / 15.406 ürün tazelendi; `ART`'ta 303 sn zaman aşımı, devre kesici 769 markayı atladı (toplam 2.140 sn) |
| Ana katalog (`match-products`) | 78–97 sn |
| Yerel dışa aktarım | dump 742–752 MB / 41 sn; medya 60.315 nesne, arşiv 4,4 GB; toplam ~4,5 dk |
| Mac yükleme hızı | 200 MB / 200 sn ≈ 8 Mbit/sn |
| VPS işlem verisi | 13 tablo, 6,8 KB (demo); 14 Kasım'da taşınmamasına karar verildi (#457) |
