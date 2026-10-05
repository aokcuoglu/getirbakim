# Mevcut repo üzerinden yeni sisteme geçiş

## Ayrılan ortamlar

| Ortam | Repo / klasör | Yayın |
| --- | --- | --- |
| Mevcut canlı | `main`, VPS `/opt/getirbakim` | getirbakim.com / www.getirbakim.com |
| Yeni test sistemi | `next-system`, VPS `/opt/getirbakim-v2` | yalnızca `127.0.0.1:3003` |
| Yeni canlı sistem | `main`, VPS `/opt/getirbakim-v2-production` | `getirbakim-v2-live:3000` edge alias'ı |
| Geliştirme kaynağı | `/Users/void/www/getirbakim` | yerel PostgreSQL 18 ve MinIO |

Geliştirmeye `/Users/void/www/getirbakim` içinde devam edilir. Bu klasör mevcut GitHub repo geçmişine bağlanmıştır; önceki yerel ilk commit `local/pre-github-migration` branch'inde korunur. `.env.local`, yerel veritabanı ve MinIO değiştirilmez. `/Users/void/www/gb` eski projenin yerel arşividir. Canlı geçiş tamamlanınca `main` yeni sistemi yayınlar; eski kod `archive/legacy-20261005` branch'inde korunur.

## Test ortamına erişim

```sh
ssh -N -L 3103:127.0.0.1:3003 getirbakim-prod
```

Tünel açıkken `http://localhost:3103` üzerinden erişilir. Yönetim girişi `/giris`, yönetim ekranı `/yonetim` adresindedir. Staging giriş bilgileri yerelde `.local/staging-access.txt` içinde, sunucudaki uygulama ayarları `.env.staging` içinde tutulur. Bunlar Git'e eklenmez. Tünel portunu değiştirirken `SITE_URL` ve Docker build ayarı da güncellenmelidir.

Staging ayrı Compose projesi (`getirbakim-v2-staging`), özel ağ, PostgreSQL ve MinIO volume'ları kullanır. PostgreSQL ve MinIO dışarıya port açmaz; yalnızca uygulamanın loopback portu vardır. `robots.txt` tüm yolları engeller. Bu ilk ortamda tedarikçi ve ödeme sırları yoktur, otomatik tedarikçi işleri kurulmaz; eski müşteri/sipariş verileri taşınmaz. Araç kataloğu ve yerel görsel manifesti yüklenir.

## Otomatik staging deploy

`next-system` push'u `Deploy new system staging` workflow'unu çalıştırır:

1. Node 22 ile typecheck, lint, mevcut birim testleri ve production build.
2. GitHub runner üzerinde uygulama, operasyon ve medya Docker image'larının build'i. VPS'te build yapılmaz. Hazır MinIO registry image'larına erişilemediğinden [resmi kaynak koddan build yöntemi](https://github.com/minio/minio#build-docker-image) kullanılır; MinIO `9e49d5e7a648f00e26f2246f4dc28e6b07f8c84a`, mc `7394ce0dd2a80935aded936b09fa12cbb3cb8096` commit'lerine sabitlenmiştir.
3. Mevcut `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY` repo sırlarıyla image aktarımı.
4. Yalnızca `/opt/getirbakim-v2` klasöründe ilgili commit'e geçiş. Kirli checkout durdurulur.
5. Yalnızca staging veritabanının yedeği, şema kurulumu, görsel/araç kataloğu aktarımı ve uygulamanın güncellenmesi.
6. Sağlık ve temel sayfa kontrolleri; gerçek yönetici girişi/oturumu, özel medya upload/download ve geçici sentetik kayıtlarla sepet/sipariş/iptal/erişim kontrolleri.

`VPS_PROJECT_PATH` ve `VPS_DOMAIN` kullanılmaz; mevcut canlı path veya yönlendirme seçilmez. Yeni branch'te eski Bun/Prisma/Meilisearch workflow'ları bulunmaz. `main` üzerinde mevcut workflow'lar geçiş tamamlanana kadar aynen kalır. `next-system` workflow'u başka branch veya etiket üzerinden staging deploy etmez.

İlk sunucu hazırlığı ayrıca `.env.staging` oluşturmayı ve aynı repo origin'ine sahip temiz `/opt/getirbakim-v2` Git checkout'unu gerektirir. Ayar şablonu `deploy/staging.env.example` içindedir. Parolalar rastgele hexadecimal üretilir, dosya izinleri `600` olur.

```sh
cd /opt/getirbakim-v2
BUILD_VERSION=<commitin-ilk-12-karakteri> docker compose --env-file .env.staging -f deploy/staging.compose.yml ps
bash scripts/smoke-staging.sh
```

Deploy scripti yalnızca checkout ile aynı tam `DEPLOY_SHA` değerini kabul eder. Image'lar önceden yüklüyse `STAGING_IMAGES_READY=1` kullanılır. Detached checkout için `STAGING_DETACHED_RELEASE=1` gerekir. Staging yedekleri `.local/backups` içinde saklanır. Image etiketiyle `BUILD_VERSION` birlikte seçilmelidir.

## Canlı geçişten önce

2026-10-05 düzeltilen kullanıcı kararı: yalnızca eski `gb` sisteminden bağımsız başlanır. Yeni `/Users/void/www/getirbakim` projesindeki TÜM veritabanı kayıtları, ürün zenginleştirmeleri, eşleşmeler, kuyruklar ve MinIO nesneleri canlıya taşınır; boş veritabanı veya yeniden ürün toplama kullanılmaz. Eski canlı kod `archive/legacy-20261005` branch'inde; kaynak, özel ortam dosyası, medya ve tam veritabanı snapshot'u VPS'te `/var/backups/getirbakim-legacy/20261005` altında saklanır.

## Yerel verinin canlıya aktarımı

`scripts/export-live-snapshot.ts`, PostgreSQL 18'de tek bir exported snapshot üzerinden özel-format dump ve 38 tablonun kesin kayıt sayılarını üretir. S3 bucket'ındaki tüm nesneleri indirir; veritabanındaki medya referanslarının SHA-256/boyutlarıyla karşılaştırır. Dosyalar `.local` altında özel izinlerle tutulur ve Git'e eklenmez.

Yeni production PostgreSQL 18 ayrı volume üzerinde kurulur; uygulama rolü superuser değildir. Dump yalnızca boş yeni veritabanına, tek transaction ile restore edilir. `scripts/verify-live-snapshot.ts` tüm tablo sayılarını; `scripts/import-live-media.ts` her nesnenin aktarım öncesi ve sonrası SHA-256 özetini doğrular. Kaynak kimlikler korunur. Restore sadece ilk hazırlıkta yapılır; sonraki deploy'lar canlı veriyi yerel dump ile ezmez.

`deploy/production.compose.yml` ve `scripts/deploy-production.sh` ayrı production stack'ini yönetir. GitHub `Deploy production` workflow'u `main` push'larında image'ları runner'da derler, tam commit'e bağlı deploy yapar ve her şema güncellemesi öncesi canlı yedeği alır. İlk hazırlık için `launch/local-data` branch'i de aynı workflow'u tetikler. Medya image'ları daha önce doğrulanmış `STORAGE_VERSION` sürümünden kullanılır.

Canlı tedarikçi zamanlayıcısı yalnızca aktarım doğrulandıktan sonra kurulur. Günlük yedekler ve supplier systemd timer'ları production stack'ine aittir. Uygulamanın mevcut ödeme ve uyumluluk özellikleri aynen korunur.

- Arşiv yedeklerinin okunabilirliğini doğrulamak. Eski Prisma şemasını yeni şemaya doğrudan bağlamamak.
- Yeni uygulama için bağımsız production veritabanı/rolü, medya deposu, ortam değişkenleri ve tedarikçi zamanlayıcılarını hazırlamak.
- Eski URL'ler (`/tr`, `/en`, kategori ve ürün adresleri) için SEO yönlendirme eşlemesini hazırlamak.
- TAMI tahsilat akışının yeni uygulamada tamamlandığını ayrıca doğrulamak. Adaptör bulunması canlı tahsilatın hazır olduğu anlamına gelmez.
- Yönetici/servis girişi, sepet, sipariş, veri güncelliği ve medya erişimini doğrulamak.
- Tam veri/dosya yedeği ve doğrulanmış geri dönüş planı hazırlamak.
- Ortak edge nginx'in yapılandırmasını doğrulamak; mevcut eksik BakımX staging sertifikası sorununu çözmeden edge reload/recreate yapmamak.
- Ayrı production deploy akışı ve yeni uygulamanın edge upstream'ini hazırlamak. `next-system` branch'ini doğrudan `main` içine almak mevcut prod deploy'u değiştireceği için ancak geçiş hazırlıkları tamamlandığında yapmak.

2026-10-05 incelemesinde mevcut canlı commit `cd88d0d6c0f96b3c4ff83ad423052a2b8b9e210f`, edge nginx sağlıksız fakat Getirbakim/BakımX uygulamaları çalışır durumdaydı. Sunucuda yaklaşık 28 GB boş disk ve 3.2 GiB kullanılabilir RAM vardı. Bu değerler deploy anında yeniden kontrol edilir.
