# Mevcut repo üzerinden yeni sisteme geçiş

## Ayrılan ortamlar

| Ortam | Repo / klasör | Yayın |
| --- | --- | --- |
| Eski sistem arşivi | `archive/legacy-20261005`, VPS `/opt/getirbakim` | Canlı yönlendirmeden çıkarıldı |
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

`VPS_PROJECT_PATH` ve `VPS_DOMAIN` kullanılmaz; mevcut canlı path veya yönlendirme seçilmez. Yeni branch'te eski Bun/Prisma/Meilisearch workflow'ları bulunmaz. `main` artık yeni production workflow'unu kullanır; eski Bun deploy'u çalıştırılmaz. `next-system` workflow'u başka branch veya etiket üzerinden staging deploy etmez.

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

`deploy/production.compose.yml` ve `scripts/deploy-production.sh` ayrı production stack'ini yönetir. GitHub `Deploy production` workflow'u `main` push'larında image'ları runner'da derler, tam commit'e bağlı deploy yapar ve her şema güncellemesi öncesi canlı yedeği alır. İlk hazırlıkta kullanılan `launch/local-data` branch'i main'e girdikten sonra silindi. Medya image'ları daha önce doğrulanmış `STORAGE_VERSION` sürümünden kullanılır.

Canlı tedarikçi zamanlayıcısı yalnızca aktarım doğrulandıktan sonra kurulur. Günlük yedekler ve supplier systemd timer'ları production stack'ine aittir. Uygulamanın mevcut ödeme ve uyumluluk özellikleri aynen korunur.

## Canlı doğrulama ve işletim

2026-10-05 aktarımında 38 tablonun kesin kayıt sayıları ve 83 özel medya nesnesinin SHA-256/boyutları kaynakla eşleşti. 319.388 tedarikçi kaydı, zenginleştirmeler, 7.046 araç eşleştirmesi, üretici logoları, mevcut hesap/sepet/sipariş kayıtları ve kuyruklar korundu. Snapshot zamanı `2026-10-05T18:19:34Z`'dir. Geliştirmesi devam eden yerel zenginleştirme/eşleştirme kod değişiklikleri kullanıcının tercihiyle bu yayına dahil edilmedi.

Gerçek veriyle testte, 319.351 katalog kaydının kimlikleri/markaları ve varsayılan liste, marka filtresi, arama sonuçları değişmeden kaldı. Katalog metadata sorguları fiyat hesaplamalarından ayrıldı; varsayılan sayfanın fiyatları yalnızca seçilen ürünler için hesaplanır. Production sorgusu yaklaşık 12 saniyeden 2,3 saniyeye indi. PostgreSQL istatistikleri deploy sonrasında `ANALYZE` ile güncellenir.

HTTPS üzerinde ana sayfa/katalog, ürün ve marka görselleri, gerçek yönetici girişi, Secure/HttpOnly oturum ve mobil/masaüstü görünüm doğrulandı. `www` apex'e; `/tr` ve `/en` ana sayfaya yönlenir. Locale içeren eski yönetim ve arama yolları da yeni sayfalara yönlendirilir. Eski ürün slug'ları için bire bir eşleme bu aktarımın kapsamına dahil değildir.

Paylaşılan edge `/opt/edge` içindedir. Yalnızca Getirbakim upstream'i `getirbakim-v2-live:3000` olarak seçildi. Edge'in eskimiş bind mount'u, host üzerindeki geçerli yapılandırmalarla yeniden oluşturuldu; BakımX production yönlendirmeleri korundu ve kontrol edildi. Önceki dosyalar `/var/backups/getirbakim-edge-20261005` altında saklanır.

Tedarikçi API notu: geçiş sırasında Başbuğ Login HTTP 200 döndü; FiyatGetir hem yerelde hem VPS'te 180 saniyelik denemede zaman aşımına uğradı. Güncellik kuralları gevşetilmedi. API toparlanınca zamanlayıcı mevcut scope ve geri deneme kurallarıyla güncelleme yapar; yönetimde tedarikçi sağlık ekranı izlenmelidir.

`getirbakim-production-sync.timer` biten çalışmadan 15 dakika sonra due scope'ları kontrol eder. `getirbakim-production-backup.timer` günlük 03:30 UTC civarında özel-format PostgreSQL yedeği alır. Günlük yedekler `.local/backups` içinde 14 gün tutulur; deploy öncesi yedekler ayrı dosyalardır. Başarılı deploy sonrası uygulama/operasyon image'larının mevcut ve bir önceki sürümü tutulur; legacy image'larına ve volume'lara dokunulmaz. MinIO kalıcı ayrı volume'dadır; ilk aktarımın nesne kopyası ve manifesti `.local/import/snapshot` içinde korunur.

```sh
cd /opt/getirbakim-v2-production
BUILD_VERSION=$(git rev-parse --short=12 HEAD) docker compose --env-file .env.production -f deploy/production.compose.yml ps
systemctl list-timers getirbakim-production-\*.timer
journalctl -u getirbakim-production-sync.service --since today
bash scripts/production-task.sh backup
```

Canlı ayarlar `/opt/getirbakim-v2-production/.env.production` içindedir ve Git'e eklenmez. `.env.local` geliştirme ayarlarıdır. `main` push'ları kodu yayınlar; canlı veritabanı veya MinIO yerel verilerle tekrar ezilmez.

## Legacy arşivi ve geri dönüş

İlk tam kaynak/ortam/medya/veritabanı arşivi `/var/backups/getirbakim-legacy/20261005` içindedir. Cutover sonrasındaki son veritabanı ve medya kopyası `/var/backups/getirbakim-legacy/20261005-cutover` altındadır. Arşivler özel izinlerle saklanır; SHA-256 ve `pg_restore --list` kontrolleri yapılır. Tam restore provası yapılmadı. Eski servislerin volume'ları ve `getirbakim-legacy:20261005` image'ı korunur.

Geri dönüşte önce eski PostgreSQL, Meilisearch ve Squid; ardından eski uygulama başlatılır. Sağlık kontrolünden sonra yalnızca Getirbakim edge dosyası önceki upstream'e alınır ve nginx doğrulanıp reload edilir. Yeni production veritabanını legacy dump ile restore etmeyin; iki şema bağımsızdır.

```sh
docker start getirbakim-postgres getirbakim-meilisearch getirbakim-squid
docker start getirbakim-app
# Eski uygulama sağlıklı olduktan sonra:
cp /var/backups/getirbakim-edge-20261005/getirbakim.host.conf /opt/edge/conf.d/getirbakim.conf
docker exec edge-nginx nginx -t
docker exec edge-nginx nginx -s reload
```
