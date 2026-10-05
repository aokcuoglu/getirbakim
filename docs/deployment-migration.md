# Mevcut repo üzerinden yeni sisteme geçiş

## Ayrılan ortamlar

| Ortam | Repo / klasör | Yayın |
| --- | --- | --- |
| Mevcut canlı | `main`, VPS `/opt/getirbakim` | getirbakim.com / www.getirbakim.com |
| Yeni sistem | `next-system`, VPS `/opt/getirbakim-v2` | yalnızca `127.0.0.1:3003` |
| Yerel geçiş kopyası | `/Users/void/www/getirbakim-migration` | Docker ve kod kontrolleri |

Kaynak geliştirme klasörleri `/Users/void/www/gb` ve `/Users/void/www/getirbakim` bu hazırlık sırasında değiştirilmez. Yeni sistem için devam eden commit'ler `getirbakim-migration` çalışma kopyasında yapılır. Mevcut sitenin kodu Git geçmişinde ve `main` branch'inde durur; geri dönüş için `v*` etiketi gönderilmez, çünkü mevcut canlı workflow'u bu etiketlerde tetiklenir.

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

2026-10-05 kullanıcı kararı: yeni sistem temiz verilerle başlar; eski sistem arşiv olarak korunur. Eski canlı kod `archive/legacy-20261005` branch'inde; kaynak, özel ortam dosyası, medya ve tam veritabanı snapshot'u VPS'te `/var/backups/getirbakim-legacy/20261005` altında saklanır. Müşteri/sipariş verisi yeni sisteme aktarılmaz. Canlı geçişte güncel son yedek ayrıca alınır.

- Arşiv yedeklerinin okunabilirliğini doğrulamak. Eski Prisma şemasını yeni şemaya doğrudan bağlamamak.
- Yeni uygulama için bağımsız production veritabanı/rolü, medya deposu, ortam değişkenleri ve tedarikçi zamanlayıcılarını hazırlamak.
- Eski URL'ler (`/tr`, `/en`, kategori ve ürün adresleri) için SEO yönlendirme eşlemesini hazırlamak.
- TAMI tahsilat akışının yeni uygulamada tamamlandığını ayrıca doğrulamak. Adaptör bulunması canlı tahsilatın hazır olduğu anlamına gelmez.
- Yönetici/servis girişi, sepet, sipariş, veri güncelliği ve medya erişimini doğrulamak.
- Tam veri/dosya yedeği ve doğrulanmış geri dönüş planı hazırlamak.
- Ortak edge nginx'in yapılandırmasını doğrulamak; mevcut eksik BakımX staging sertifikası sorununu çözmeden edge reload/recreate yapmamak.
- Ayrı production deploy akışı ve yeni uygulamanın edge upstream'ini hazırlamak. `next-system` branch'ini doğrudan `main` içine almak mevcut prod deploy'u değiştireceği için ancak geçiş hazırlıkları tamamlandığında yapmak.

2026-10-05 incelemesinde mevcut canlı commit `cd88d0d6c0f96b3c4ff83ad423052a2b8b9e210f`, edge nginx sağlıksız fakat Getirbakim/BakımX uygulamaları çalışır durumdaydı. Sunucuda yaklaşık 28 GB boş disk ve 3.2 GiB kullanılabilir RAM vardı. Bu değerler deploy anında yeniden kontrol edilir.
