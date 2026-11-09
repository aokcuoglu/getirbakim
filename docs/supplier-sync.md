# Tedarikçi verilerinin yaşam döngüsü

## Karar ve mevcut verilerin taşınması

Her gece tüm ürünleri kalıcı geçmiş tablosuna kopyalamak bu uygulama için uygun değil. 43.068 satır/gün aynı büyüklükte tekrarlandığında yılda 15.719.820 satır ekler. Güncel durum + yalnızca değişiklik geçmişi + çalışma özeti kullanıyoruz. PostgreSQL unique constraint ve `ON CONFLICT` aynı ürünün aynı kapsamda ikinci güncel satırının oluşmasını engeller; transaction tüm kapsamın birlikte uygulanmasını sağlar. Kaynaklar: [INSERT / UPSERT](https://www.postgresql.org/docs/current/sql-insert.html), [advisory locks](https://www.postgresql.org/docs/current/explicit-locking.html#ADVISORY-LOCKS).

2 Ekim 2026 taşımasında 43.068 ham satırdan **24.150 güncel kayıt** üretildi: FIAT 18.920, AV 5.230. İki FIAT çekimi arasında 2 yeni kayıt, 2.722 değişiklik ve 16.196 değişmeyen kayıt vardı. İlk görülme olayları dahil 26.872 geçmiş olayı oluştu. Eski ham kopyalar baştan sona işlenip farkları geçmişe aktarıldı; her kapsamın yalnızca son eski ham kopyası bırakıldı (24.150 satır). Taşıma öncesi imports/items verileri `.local/supplier-backups/` altında izinleri 0600 olan sıkıştırılmış yedekte saklandı. Dosya Git dışında; uzak veya kalıcı yedek yerine geçmez.

Ardından gerçek FIAT API çekimiyle 18.920 ürünün tamamının değişmediği doğrulandı: **0 yeni güncel kayıt, 0 yeni geçmiş olayı**, yalnızca son görülme ve kaynak tekrar sayıları güncellendi.

## Tabloların sorumlulukları

| Tablo | İçerik | Büyüme / saklama |
| --- | --- | --- |
| `supplier_items` | Her tedarikçi/firma/grup/depo/kod için güncel kaynak durum, sabit UUID, ilk/son görülme, son değişim, listede bulunma ve kalite | Yeni gerçek kapsam/kod geldikçe büyür; her çekimde çoğalmaz |
| `supplier_item_changes` | Yeni ürün, içerik değişimi, kayıp, pasif ve geri dönüş; önceki/sonraki değerler | Yalnız değişiklikte eklenir; 90 gün |
| `supplier_imports` | Çalıştırma durumu, zamanlar, servis gözlem zamanları, kurlar, kalite, sayaçlar, hata / inceleme notu | Çalıştırma başına bir küçük özet; 365 gün, referans verilen ve kapsamın son başarılı çalıştırması korunur |
| `supplier_sync_scopes` | Etkin gruplar, periyot, gece saati, güncellik eşiği, sonraki deneme, başarısızlık sayısı | Kapsam başına bir kayıt |
| `supplier_import_items` | Önceki uygulamadan kalan ham tam listeler | Yeni çekimler buraya yazmaz; 7 gün sonra temizlenir |

Anahtarın grup/depo içermesi bilinçlidir: FIAT çekiminde AV ürünleri pasife alınmaz; başka depodaki stok da etkilenmez. Aynı kaynak kodu başka grupta gelirse ayrı kapsam gözlemi olur; farklı tedarikçilerin aynı/OEM kodları otomatik aynı satış ürünü sayılmaz. Gelecekteki satış eşlemesi tedarikçi + firma + kod üzerinden katalog kimliğine bağlanır; gruplar üyelik, depolar stok boyutudur. Çelişen kapsam gözlemleri yayın öncesinde çözülmelidir.

Pasif güncel kayıtlar kimlik ve tekrar geri gelme bağlantısını korumak için silinmez. Dolayısıyla yaşam boyu yeni kod sayısıyla büyüme devam eder; günlük aynı listenin kopyalanmasıyla büyüme sona erer. Eski pasifleri arşivlemek gerekirse satış/sepet/sipariş referansları belirlendikten sonra ayrı politika gerekir. PostgreSQL autovacuum silinen/güncellenen satır alanını yeniden kullanır; dosyanın hemen küçülmesi beklenmez. Periyodik boyut ve autovacuum takibi yapılmalı; normal zamanlayıcıda `VACUUM FULL` kullanılmaz.

## Bir çekimin akışı

1. Başbuğ için PostgreSQL session advisory lock alınır. Web düğmesi ve CLI aynı kilidi kullanır. İkinci işlem `busy` sonucu alır; mevcut işlem bozulmaz. Farklı gruplar da seri çekilerek API eşzamanlı yükü sınırlandırılır.
2. `running` çalışma kaydı yazılır. Kilidi kaybetmiş önceki worker'ın `running` kaydı bir sonraki çekimde `worker-interrupted` olarak kapatılır.
3. Auth, grup, ürün, fiyat, MRK stok ve kur servisleri çağrılır. Token yalnız bellekte; isteklerde timeout, HTTPS/host kontrolü ve redirect yasağı var. Ağ beklerken uzun DB transaction açık tutulmaz.
4. Sözleşmeler doğrulanır, birebir tekrarlar birleştirilir, çelişkili alternatifler saklanır. Eksik fiyat/stok `null`; sıfırla tamamlanmaz.
5. Aynı kapsamın son başarılı çekimiyle kalite karşılaştırılır. Boş/bozuk ürün listesi uygulanmaz. Ürün sayısında **%20'den fazla düşüş**, eksik fiyat veya stok oranında **10 yüzde puanından fazla artış** şüpheli sayılır. İlk çekimde geçmiş baz olmadığı için bu göreli eşikler uygulanamaz; alan ve doluluk kontrolleri yine çalışır.
6. Kabul edilen tam liste tek transaction içinde güncel duruma işlenir. JSON alan sırası değişiklik sayılmaz. Değişmeyen büyük JSON'lar yeniden yazılmaz; son görülme ve kalite sayaçları güncellenir. Kaynak satır sayısının tek başına değişmesi ürün geçmiş olayı oluşturmaz. Fiyat, stok, ürün, para birimi, çelişki veya alternatif içerik değişimi olay oluşturur.
7. Çalışma `succeeded` olur, sayaçlar yazılır, hata sayısı sıfırlanır. Hata / reddedilen yanıt güncel ürünlere ve kayıp sayaçlarına dokunmaz; `failed` / `rejected` çalışma özeti bırakır. Reddedilen çekimin kalite bilgisi saklanır; tam yanıtı sürekli arşivlenmez.

Ürün/fiyat/stok ayrı isteklerle gelir; servis gözlem zamanları ayrı saklanır. DB'de birlikte uygulanmaları tedarikçi tarafında aynı ana ait oldukları anlamına gelmez. Belgelenmemiş sayfalama veya delta API'si uydurulmaz. Başbuğ'un mevcut listeleri tam kapsam olarak değerlendiriliyor; eşikler sessiz eksik yanıtları tamamen tespit edemez. İleride Dinamik veya sayfalı adaptör eklenirken bütün sayfalar tamamlanmadan snapshot uygulanmamalı; delta yanıtında yokluk pasiflik kanıtı sayılamaz.

## Kaybolan ve geri gelen ürünler

- İlk **kabul edilmiş başarılı tam çekimde** yok: `pending_missing`; son bilinen değerler inceleme için korunur, listede bulunamadığı açıkça gösterilir.
- İkinci ardışık başarılı çekimde de yok: `inactive`. Aynı kayıp için her gece yeni olay yazılmaz.
- Yeniden görünürse: aynı UUID ile `present`, kayıp sayacı sıfır, `restored` olayı.
- Başarısız veya reddedilen çekimler bu iki çekim sayacını ilerletmez.
- Güncel listede olan fakat fiyatı/stoku eksik veya çelişkili üründe bu durum korunur. Eski fiyat sessizce güncel fiyat diye kullanılmaz.

Koruma eşiğini aşan **gerçek** bir tedarikçi değişimi araştırılmalı. Kanıt varsa operatör notuyla yeni canlı çekim yapılabilir:

```sh
BASBUG_SAMPLE_GROUP=FIAT npm run supplier:basbug:import -- --accept-anomaly="Tedarikçi grup daralmasını doğruladı; destek kaydı 12345"
```

Bu seçenek sadece göreli kalite eşiğini atlar; bozuk sözleşme / boş ürün listesi kabul edilmez. Gerekçe `review_note` alanında saklanır. Zamanlayıcı bu seçeneği kullanmaz. Eski reddedilmiş dosyayı körlemesine onaylamak yerine yeniden canlı veri çekilir.

## Periyodik çalışma ve işletim

FIAT/MRK ve AV/MRK etkin; varsayılan **her gece İstanbul 03:00**, bayatlık eşiği **36 saat**. Günlük periyot 1440 dakika olduğunda bir sonraki başarı takvime göre ertesi gün aynı yerel saate ayarlanır; daha kısa periyotlar başarı zamanına göre hesaplanır. Tüm API grupları kendiliğinden etkinleştirilmez.

```sh
# Mevcut eski veri varsa önce yedekli taşıma:
npm run db:supplier:migrate
# Yeni boş kurulum veya taşıma sonrası admin/şema kurulumu:
npm run db:setup
# Yeni bir grubu gece çekimine ekleme / gece saatini ayarlama:
npm run supplier:sync:configure -- --group=FIAT --daily-at=03:00
# Geçici durdurma:
npm run supplier:sync:configure -- --group=FIAT --enabled=false
# Örneğin 2 saatte bir (bayatlık periyottan uzun olmalı):
npm run supplier:sync:configure -- --group=FIAT --interval-minutes=120 --stale-minutes=240
# Süresi gelen kapsamları çekme + saklama temizliği + sağlık kontrolü:
npm run supplier:sync
```

Çekim hatasında yeniden deneme 15, 30, 60, 120, 240 ve en fazla 360 dakika aralığına uzar. Zamanlayıcı her 15 dakikada çalıştırılır; her çağrıda tüm grupları çekmez. Kendi ayrı advisory lock'u çakışan zamanlayıcı süreçlerini önler. Beklenmeyen kesintide işletim sistemi bağlantıyı kapatınca kilit serbest kalır. Worker son hatayı `stderr`'e, sonucu ve temizleme sayaçlarını `stdout`'a yazar. Hata veya etkin kapsamda bayat veri varsa exit code 1 döner; bu sonucun izleme sisteminde alarm üretmesi gerekir. Görev zamanlayıcı hiç çalışmazsa CLI kendi kendini uyaramaz: dışarıdan timer/cron heartbeat izlenmelidir.

Linux sunucusu için [service](../deploy/getirbakim-supplier-sync.service) ve [timer](../deploy/getirbakim-supplier-sync.timer) hazır. Dosyalardaki `/srv/getirbakim`, `/usr/bin/node` ve `User=getirbakim` sunucuya göre uyarlanmalı; Node/tsx runtime ve `.env.local` sunucuda mevcut olmalı. Gizli dosya izinlerini 0600 tutun.

```sh
sudo cp deploy/getirbakim-supplier-sync.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now getirbakim-supplier-sync.timer
systemctl list-timers getirbakim-supplier-sync.timer
journalctl -u getirbakim-supplier-sync.service
```

Alternatif cron (mutlak Node yolu ve proje yolunu sunucuya göre değiştirin):

```cron
*/15 * * * * cd /srv/getirbakim && /usr/bin/node --env-file=.env.local --import tsx scripts/sync-suppliers.ts >> /var/log/getirbakim-supplier-sync.log 2>&1
```

Cron logu döndürülmeli ve exit/heartbeat dışarıdan izlenmeli. Sistem saat diliminden bağımsız gece hesaplaması DB'de `Europe/Istanbul` kullanır. Bu değişiklik geliştirme bilgisayarına gizli bir arka plan görevi kurmaz; üretim sunucusundaki timer/cron kurulumu dağıtım adımıdır.

## Yönetim ekranı

`/yonetim/tedarikciler/basbug` güncel tablodan okur. Son 10 çalıştırma, sonuç/hata, yeni/değişen/aynı/kayıp/pasif/geri gelen sayıları, sonraki deneme ve bayatlık/başarısızlık uyarısı gösterilir. Varsayılan filtre `present`; ilk kayıp ve pasifler ayrıca seçilir. Detay bağlantısı yeni çekimlerle değişmeyen ürün UUID'sine gider; detayda son 90 günün son 20 değişikliğinin önceki/sonraki kaynak değerleri görülebilir.

## Mağaza, fiyatlama ve sipariş sınırı

Mağaza mevcut ticari kurallarla NF maliyet, kur, kâr ve KDV üzerinden fiyat türetiyor; kaynak stok değerleri adet yerine bulunabilirlik sinyali olarak kullanılıyor. Yeni tedarikçi entegrasyonunda alan anlamları ve ticari sözleşme doğrulanmalı. Dinamik 11 Ekim 2026'dan beri aynı tablolara çekiliyor ve mağazada satılıyor (aşağıda).

Satış adaptörü açılırken uygulanması gereken sözleşme:

- Kaynak `present`, güncel, çelişkisiz ve fiyat/stok anlamları doğrulanmış olmalı. `pending_missing`, `inactive`, bayat veya eksik veride yeni satışa izin verilmemeli.
- Kaynak tutarlar PostgreSQL decimal olarak / tam ondalık hesapla ele alınmalı; doğrulanmış vergi, kur, marj ve müşteri indirimiyle satış fiyatı kuruşa çevrilmeli. JS kayan nokta aritmetiğiyle doğrudan ticari hesap yapılmamalı.
- Kur değişimi fiyat alanı değişmese bile türetilen TL fiyatını etkiler; fiyat hesaplama sürümü ve kullanılan kur/vergi bilgisi korunmalı.
- Sepet tedarikçi rezervasyonu sayılmaz. Sipariş öncesinde ilgili grupların fiyat/stok/kur verileri canlı yenilenir; değişen tutar müşteriye gösterilmeli. Gece çekimi stok garantisi vermez. Stok uç noktası izin veriyorsa daha sık ayrı stok/fiyat işi eklenmeli.
- Kesinleşen sipariş satırları ürün adı, kod, birim fiyat, kur, vergi ve indirim anlık değerlerini saklamalı; sonraki tedarikçi güncellemeleri eski siparişleri değiştirmemeli.

Mağaza ortak ticari görünümden fiyat ve bulunabilirlik okur. Siparişler teyit bekleyen durumda oluşturulur; kaynak stoğu rezerve edilmiş sayılmaz. Bu otomasyon ödeme sağlayıcısı veya tedarikçi rezervasyon entegrasyonu eklemez.

## Doğrulama ve bakım

- `npm run test:basbug`: ham sözleşme, tekrarlar, çelişkiler, eksikler, boş/bozuk yanıt.
- `npm run test:supplier-sync`: gerçek PostgreSQL'de geçici şema; aynı veri tekrarı, fiyat değişimi, kayıp/pasif/geri dönüş, null alanlar, kapsam izolasyonu, rollback, eski verileri idempotent taşıma, hata/reddedilme, dead worker, kilit ve saklama temizliği. Canlı tedarikçiye çağrı yapmaz; geçici şema sonunda silinir.
- `VERIFY_URL=http://localhost:3000 npm run verify:basbug`: çalışan uygulamada yetki/CSRF, arama/filtre/sayfalama, kalıcı detay, geçmiş ve katalog sınırı. Sentetik başarısız import gerçek çalışma tablosuna eklenmez.
- `npm run lint`, `npm run typecheck`, `npm run build`.

Daha büyük hacimde yalnız değişiklik geçmişine partition, indeks maliyeti takibi, soğuk geçmişi nesne depolamaya aktarma ve doğrulanmış delta/cursor adaptörleri eklenebilir. Güncel listeyi her gece çoğaltmak bu ölçeklendirme adımlarının yerine geçmez.

## Tüm listeleri sıfırdan yeniden oluşturma

```sh
npm run supplier:rebuild -- --reset
```

Bu açık sıfırlama komutu Başbuğ'un canlı grup listesini keşfeder, tüm grupları MRK ürün/fiyat/stok/kur verileriyle ayrı bir PostgreSQL şemasına seri olarak çeker ve doğrular. Geçici ağ hataları en fazla üç kez denenir. Bir grup alınamazsa mevcut tedarikçi tabloları korunur. Tüm gruplar hazırsa uygulama DB'sinin doğrulanmış `pg_dump` yedeği alınır; tedarikçi güncel kayıtları, çalışma geçmişi ve kapsam ayarları tek transaction içinde temiz başlangıç verileriyle değiştirilir. Hesap, oturum, mağaza ürünleri, sepetler ve materyaller korunur. Yedek ve grup bazında sonuç raporu Git dışındaki `.local/supplier-backups/` dizinindedir.

Her kapsamın yalnız bir başarılı başlangıç çekimi ve her güncel kaydın bir `added` geçmiş olayı olur. Eski `supplier_import_items` boş kalır. Bütün çekilen kapsamlar İstanbul 03:00 günlük planına etkin olarak eklenir. Kaynak eksikliği veya çelişkisi uydurma değerlerle tamamlanmaz; kalite işaretiyle saklanır. Bu komut eski tedarikçi UUID'lerini de sıfırlar; rutin günlük güncelleme için `supplier:sync` kullanılmalıdır. Komut yerel `pg_dump` ve `pg_restore` araçlarını gerektirir.


2 Ekim 2026 temiz yeniden yükleme tamamlandı: AV, BMW, CIN, EV, FIAT, FORD, JAPON, KORE, MERCEDES, OPEL, PSA, RENAULT, UNI, VOLVO, VW. Toplam **319.344 güncel kapsam/kod kaydı**, **15 başarılı başlangıç çekimi**, **319.344 ilk görülme olayı**, **0 eski ham kopya**, **0 yinelenen kapsam/kod**. Kaynakta 165 eksik fiyat, 2 çelişkili kayıt ve 0 eksik stok bulunuyor; bu durumlar kalite işaretiyle korunuyor. Hesap, oturum ve materyal kayıtları korunmuştur. Başlangıç olayları günlük tam kopya değildir; sonraki çekimler yalnız değişiklikte yeni olay ekler. Her 15 kapsamın günlük İstanbul 03:00 ayarı etkin; otomatik çalıştırma için sunucu timer/cron kurulum adımı geçerlidir.

## Otomatik fiyat/stok işletimi — 4 Ekim 2026

İki ayrı iş vardır: `full` ürün listesini ve ticari verileri yeniler; `commerce` yalnız doğrulanmış `FiyatGetir`, `StokGetir`, `DovizBilgisiGetir` uç noktalarını çağırır. Ürün bilgilerini son başarılı tam aktarım ve mevcut kayıtlar üzerinden kullanır. Ürün/grup gözlem zamanları korunur. Ticari iş yeni ürün keşfetmez, kayıp/pasif sayaçlarını ilerletmez ve kayıp ürünü geri getirmez. Çelişkili ürün alternatifleri korunur. Bir tam aktarım iki planı da karşılar. Tam aktarım anomali kontrolü son tam aktarımı esas alır.

Başlangıç planı: mevcut 15 etkin Başbuğ/MRK grubu her gece İstanbul 03:00 ürün listesi; 60 dakikada bir fiyat/stok/kur, ticari bayatlık 120 dakika. Zamanlayıcı her 15 dakikada zamanı gelen grupları seri işler; bu, tüm katalog her 15 dakikada çekilir anlamına gelmez. Başarısız işler 15–360 dakika artan aralıklarla yeniden denenir. API limitleri doğrulanmadan 5 dakikalık tam liste çekimi yapılmaz. Stok ve fiyat şu an birlikte güncellenir; ayrı zamanlama, doğrulanmış delta/webhook desteği ve rezervasyon ayrı sonraki entegrasyonlardır.

```sh
npm run db:supplier:automation
# Var olan etkin, doğrulanmış gruplar için ticari planı etkinleştirir.
npm run supplier:auto:install
npm run supplier:health
# Kaldırma: verileri veya plan ayarlarını silmez; yalnız macOS görevlerini kaldırır.
npm run supplier:auto:uninstall
# Grup bazında ayar:
npm run supplier:sync:configure -- --group=FIAT --daily-at=03:00 --commerce-enabled=true --commerce-interval-minutes=60 --commerce-stale-minutes=120
```

macOS kurulumu `~/Library/LaunchAgents/com.getirbakim.supplier-{sync,monitor}.plist` dosyalarını oluşturur. Kullanıcı oturumunda her 15 dakikada çalışan iki görev vardır: işçi ve bağımsız sağlık kontrolü. İşçi kurulunca hemen başlar; sonraki oturum açılışlarında da yüklenir. Bilgisayar uyurken/kapalıyken çalışmaz; uyanınca sonraki kontrolde geciken gruplar işlenir. Sürekli üretim işletimi için Linux timer ya da daima açık bir sunucuya taşınmalıdır. Node sürümü veya proje yolu değişirse kurulumu yeniden çalıştırın. `.env.local` görev başına okunur; kimlik bilgileri plist'e kopyalanmaz.

İşçi en fazla 90 dakika çalışır. Kalıcı çalışma sinyali `supplier_scheduler_health` tablosundadır. Bağımsız kontrol tamamlanan son kontrolün 35 dakikadan eski olmasını veya süren işin 90 dakikayı aşmasını sağlıksız sayar. Tek bir grubun eskimesi de raporlanır. Hata/bayatlıkta macOS bildirimi en fazla saatte bir gösterilir; sağlıklı duruma dönüşte bildirim sayacı sıfırlanır. macOS bildirim izinleri/odak ayarları bildirimin görünmesini etkileyebilir. `supplier:health` JSON döndürür; sağlıksız durumda exit code 1 verir. Üretimde dış izleme buna bağlanmalıdır.

İşçi ve izleme günlükleri `.local/supplier-logs/` altında 0600 izinleriyle saklanır; yedi günden eski günlükler temizlenir. Token, parola veya ham API yanıtı yazdırılmaz.

Yönetim ekranı zamanlayıcı sinyalini, grup bazında planı, son ticari başarıyı ve işlem türünü gösterir. Tüm gruplar görünümünde herhangi bir grubun bayatlığı uyarı üretir. Ticari bayatlık sınırını veya ürün listesi bayatlık sınırını aşan kaynaklar satışa uygun sayılmaz; ticari bayatlıkta fiyat gizlenir.

Sipariş, ağ çağrısı boyunca DB transaction tutmadan ilgili grupları canlı yeniler. Kaynak hatası/çakışan çekim, tükenen stok veya güncel olmayan veri siparişi durdurur. Fiyat değişirse mevcut fiyat doğrulama akışı müşteriyi yeniden fiyat onayına yönlendirir. API çağrısı sırasında sepete farklı bir tedarikçi grubu eklenirse sipariş tekrar kontrol ister. Tamamlanan aynı istek anahtarı yeniden geldiğinde yeni API çağrısı yapılmaz. Sipariş fiyat/kurlar/vergi anlık değerlerini saklar; sonraki kaynak güncellemeleri geçmiş sipariş fiyatını değiştirmez. Grup bazındaki canlı kontrol sepet büyüklüğüne göre gecikebilir; doğrulanmış ürün bazlı servis sözleşmesine geçildiğinde daraltılabilir.

Doğrulama: `npm run test:basbug`, `npm run test:supplier-sync`, `npm run test:supplier-checkout`, `npm run lint`, `npm run typecheck`, `npm run build`. PostgreSQL testleri geçici şemaları kullanır ve sonunda kaldırır. Advisory lock'lar veritabanı genelindedir: testler zamanlayıcı kilidini alır; canlı işçi çalışırken hızlıca durup tekrar denemeyi ister.

## Production işletimi ve manuel tetikleme — 9 Ekim 2026

6 Ekim'deki FiyatGetir kesintisinde production'da tüm kapsamlar kapatılmış ve `getirbakim-production-sync.service` maskelenmişti; veri 5 Ekim'de kaldı. 9 Ekim ölçümü: API normal (FIAT ürün 2,3 sn / fiyat 1,1 sn / stok 1,0 sn, token ömrü 300 sn). Yerelde 15 grubun zorla tam aktarımı **2 dk 5 sn**, yalnız fiyat/stok/kur turu **1 dk 15 sn** sürdü (321.206 güncel kayıt).

Zamanlayıcıya iki ekleme yapıldı:

- **Devre kesici:** Bir grup `upstream`, `config`, `busy` veya `paused` ile başarısız olursa o turdaki kalan gruplar denenmez (`circuitOpen` + `skipped` loglanır). Kesintide her 15 dakikalık tur en fazla bir grubu dener; eskiden 15 grubun her biri 60 sn zaman aşımı bekliyordu. `rejected`/`contract` grup özelinde olduğu için diğer gruplar devam eder. Başarısız grup kendi geri çekilme süresine girer, sonraki tur sıradaki grubu dener; API dönünce gruplar kendiliğinden toparlanır.
- **Manuel tetikleme:** `--force` plan ve `enabled` bayrağına bakmadan çeker. Varsayılan `full`; `--mode=commerce` yalnız fiyat/stok/kur.

```sh
# Yerel (otomatik görev kurulu değil; ihtiyaç oldukça elle):
npm run supplier:sync -- --force                      # tüm gruplar, tam aktarım
npm run supplier:sync -- --force --mode=commerce      # tüm gruplar, fiyat/stok/kur
npm run supplier:sync -- --force --group=FIAT,AV      # seçili gruplar
npm run supplier:health

# Production (/opt/getirbakim-v2-production):
bash scripts/production-task.sh supplier-sync --force
bash scripts/production-task.sh supplier-health
bash scripts/production-task.sh supplier-configure --group=ALL --daily-at=03:00 \
  --commerce-enabled=true --commerce-interval-minutes=30 --commerce-stale-minutes=90
sudo systemctl unmask getirbakim-production-sync.service
sudo systemctl enable --now getirbakim-production-sync.timer
```

`--group=ALL` aynı planı tedarikçinin bilinen tüm kapsamlarına uygular. Production planı: ürün listesi her gece İstanbul 03:00, fiyat/stok/kur **30 dakikada bir**, ticari bayatlık 90 dakika. Sipariş anındaki canlı doğrulama bunun üzerine ayrıca çalışır.

Acil durdurma: `supplier-configure --group=ALL --enabled=false --commerce-enabled=false` (veriler korunur, satış bayatlık kuralına göre kapanır). Servisi maskelemek yerine bunu tercih edin; maskelenmiş servis sağlık ucunda `stopped` görünür.

**Dış izleme:** `GET /api/health/suppliers` zamanlayıcı durmuşsa ya da etkin bir grup bayat/başarısızsa **503** döner; gövdede yalnız toplu durum (`status`, `scheduler`, `groups`, `issues`, `oldest_commerce_success`) vardır. Bir uptime izleyicisine (ör. 5 dakikada bir, 2 ardışık 503'te alarm) bağlanmalı; macOS bildirimi yalnız yerel kurulum içindir.

## Dinamik — 11 Ekim 2026

Dinamik aynı motoru (`supplier_items`, `supplier_item_changes`, `supplier_imports`, `supplier_sync_scopes`) kullanır. API'de sayfalama yok; marka başına bir stok ve bir fiyat listesi döner. Bu yüzden **her marka bir kapsamdır**: `supplier='dinamik'`, `company='DINAMIK'`, `list_group=<marka>`, `warehouse='ALL'`. Bir markanın hatası diğerlerine dokunmaz; kayıp/pasif mantığı marka içinde çalışır. Sözleşme ve erişim: [integrations.md](integrations.md#dinamik).

- **Kayıt biçimi:** `product_data` stok listesindeki ürün alanları (fiyat ve VAR/YOK bayrakları hariç); `price_data` fiyat listesi satırı + stok listesindeki `kampanyaOrani`; `stock_data` `varyok1..4`, `varyokAll`, `kaporta`. Yalnız fiyat listesinde olan kodda `product_data` sadece `stokKodu`/`marka`, `stock_data` `null` — eksik değer uydurulmaz. İki listenin fiyatı farklıysa kayıt çelişkili işaretlenir (`source_variants.stockListPrice`).
- **Marka listesi:** zamanlayıcı günde bir kez `getBrandList` okur (`supplier_discovery`). Yeni markalar etkin kapsam olarak eklenir; listeden düşen markanın kapsamı kapatılır, kayıtları silinmez.
- **Plan:** her marka günde bir, İstanbul **04:00** (Başbuğ'un 03:00 tam listesinden sonra), bayatlık 36 saat. İlk tam tarama (11 Ekim, lokal, tünel üzerinden): 786 marka, **920.830 kayıt**, 0 hata, toplam ~16 dk çekim+yazma; en büyük marka ORIJINAL (35.462 kod, 17 MB yanıt, ~36 sn, ~550 MB bellek → `operations` konteyneri 1 GB). DB'de ~750 MB güncel kayıt + ilk görülme olaylarıyla ~1 GB değişiklik geçmişi (90 günde temizlenir). Zamanlayıcı Başbuğ kapsamlarını önce işler, sonra yeni Dinamik markalarını yalnız tur başına **10 dakika** başlatır (`DINAMIK_TICK_MINUTES`); kalanlar sonraki turlara kalır. Böylece Başbuğ'un 30 dakikalık fiyat/stok işi gecikmez; gece taraması ~04:00–05:00 arasında tamamlanır.
- **Ayrı kilit:** Dinamik aktarımı `pg_advisory_lock(20261001,3)` kullanır; Başbuğ aktarımıyla (anahtar 1) çakışmaz. Devre kesici tedarikçi başınadır: Dinamik `upstream` hatası verirse o turda kalan Dinamik markaları atlanır, Başbuğ etkilenmez.
- **Koruma eşikleri** Başbuğ ile aynıdır (%20 ürün düşüşü, 10 puan eksik fiyat/stok artışı). Hiç ürünü olmamış marka boş liste dönebilir (başarılı, 0 kayıt); ürünü olan markanın boş dönmesi reddedilir.
- **Mağaza satışı:** SETA gibi Dinamik satırları da Başbuğ alan adlarını taşır (`ac` ad, `uk` üretici `kull3s`, `oe` OEM listesi, `dc`=TRY, `price_data.nf`=`fiyat`, `stock_data.stok`= bölgelerden biri VAR ise 1). `fiyat` KDV hariç maliyet kabul edilir (ticari karar); satış fiyatı `nf × (1+kâr) × (1+KDV)`, oranlar `/yonetim/fiyatlandirma`'daki ortak ayarlardır. `kampanyaOrani` saklanır ama uygulanmaz. Yalnız fiyat listesinde olan (adı olmayan) kodlar `commerce_supplier_items`'a girmez. Siparişte canlı modda yalnız sepetteki Dinamik kodları tek tek yenilenir (`getStock`, `POST {STOK_KODU}`, kod başına ~0,5 sn, 4'erli paralel; eskiden marka listesinin tamamı, en büyükte ~35 sn). Yalnız fiyat/stok güncellenir, değişen satır `supplier_item_changes`'a `source: checkout` ile yazılır; artık listede olmayan kod satışa kapanır (tüm bölgeler YOK). Marka çekim kilidini beklemez.
- **Ayrı fiyat/stok işi yok:** stok ve fiyat aynı iki çağrıyla gelir; daha sık güncellik gerekirse `--interval-minutes` kısaltılır.

```sh
# Lokal (tünel açıkken, DINAMIK_DIRECT_TUNNEL=127.0.0.1:18443):
npm run supplier:dinamik:import -- --discover            # marka listesi → kapsamlar
npm run supplier:dinamik:import -- --brand="FEBI"        # tek marka
npm run supplier:sync -- --force --supplier=dinamik --group="FEBI,BOSCH"

# Production (/opt/getirbakim-v2-production):
bash scripts/production-task.sh supplier-sync --force --supplier=dinamik --group=FEBI
bash scripts/production-task.sh supplier-configure --supplier=dinamik --group=ALL --enabled=false   # acil durdurma
bash scripts/production-task.sh supplier-configure --supplier=dinamik --group=ALL --daily-at=04:00   # yeniden açma
```

`--force --supplier=dinamik` grup verilmeden tüm markaları bütçesiz çeker ve ~16 dk+ boyunca zamanlayıcı kilidini tutar; bu sürede Başbuğ fiyat/stok turları bekler. Production'da tüm markalar için zorlama yerine normal zamanlayıcıyı bekleyin veya `--group` ile sınırlayın.

Yönetim: `/yonetim/tedarikciler/dinamik` Başbuğ ekranı gibi iki sekmelidir. **Ürünler:** marka, ürün grubu (`kull7s`), bölge + stok durumu, listede bulunma ve kalite (yalnız fiyat listesinde, fiyatı eksik, kampanyalı, tekrar, çelişki) filtreli, 50'şer sayfalı tablo; arama kelime başlarını ad/kod/OEM/eşdeğer/ürün tipinde arar, parça numarasını ayraçsız da bulur (Türkçe harfler desende katlanır; ~1M satırda ~0,3 sn, markayla ~20 ms). Her satır `/yonetim/tedarikciler/dinamik/urun/<id>` detayına (kaynak alanlar, bölge stokları, değişiklik geçmişi) gider. **Senkronizasyon ve kalite:** güncel ürün, bölgede stokta, güncel/etkin marka, son 24 saat, son çekimler ve hata veren markaları gösterir. `/api/health/suppliers` Dinamik kapsamlarını da kapsar: hata veren ya da 36 saatten bayat marka 503 üretir.

## SETA — 11 Ekim 2026

SETA (Seta Filtre) tüm B2B listesini tek uç noktadan verir: `GET https://b2b-api.ismyazilim.com/seta/products`, `XApiKey` başlığı. Grup, depo, sayfalama veya kur yok; tek kapsam kullanılır: `seta / SETA / ALL / MAIN`. Canlı yanıt (1.392 satır, ~575 KB, ~3 sn) doğrulandı; adaptör `src/modules/suppliers/seta-import.ts`.

| Kaynak alan | Anlamı | Saklandığı yer |
| --- | --- | --- |
| `product_no` | SETA kodu (boşluk içerebilir: `TRA SET 1`) | `code` |
| `price` | **KDV hariç bayi alışı**, TRY (kullanıcı teyidi). `0.00` = fiyat yok | `price_data.nf` (0 ise `price_data` null) |
| `stock` | Var/yok, adet değil | `stock_data.stok` 1/0 |
| `category` | `Hava Filtreleri` vb.; birkaç satırda boş → kod önekinden (STA/STO/STF/STC) | ad (`ac`) + mağaza kategorisi `filtre` / `yedek-parca` |
| `product_name` | Uyumlu araçlar (filtrelerde) / parça adı (`Yedek Parça`) | `ac2` veya `ac` |
| `brand` | **Araç markası**, parça markası değil | `vehicle_brand`; parça markası `uk = SETA` |
| `oems` | OEM numaraları | `oe` (` / ` ile) + `oems` |
| `cross` | Rakip referansları (Mann, Mahle…); boşsa `[]` gelir | `cross` (nesne); aramaya dahil değil |

Mağaza, arama ve zenginleştirme Başbuğ alan adlarını okuduğundan SETA satırları aynı adlarla (`ac`, `ac2`, `uk`, `oe`, `dc`, `nf`, `stok`) ve kendi alanlarıyla birlikte yazılır. `commerce_supplier_items` artık Başbuğ MRK + SETA'yı satar; satış fiyatı Başbuğ'la aynı formül: `nf × (1 + kâr) × (1 + KDV)` (ör. 105 TL → 163,80 TL). Mağaza sorguları firma listesini `storefrontCompanies()`'ten alır.

- **Tam** çekim ürünleri keşfeder ve kayıp/pasif sayaçlarını ilerletir. **Ticari** çekim aynı isteği yapar ama yalnız mevcut ürünlerin fiyat/stoğunu yazar (ürün alanları tam çekime aittir). Sipariş anında canlı modda ticari çekim yapılır; sipariş veri kaynağı ayarı Başbuğ ile ortaktır.
- Kilit `pg_advisory_lock(20261001,4)` (Başbuğ 1, zamanlayıcı 2, Dinamik 3); uzun bir Başbuğ turu SETA siparişlerini bekletmez. `db:setup` her ikisini de alır.
- Sözleşme dışı yanıt (boş liste, TRY dışı para birimi, bozuk fiyat) `contract` olur, mevcut veri korunur. Göreli kalite eşikleri (ürün düşüşü %20, eksik fiyat +10 puan) Başbuğ'la aynıdır. Durdurma: `.local/seta-paused`.

```sh
# İlk aktarım (kapsamı da oluşturur) ve plan:
npm run supplier:sync -- --force --supplier=seta
npm run supplier:sync:configure -- --supplier=seta --group=ALL --daily-at=03:00 \
  --commerce-enabled=true --commerce-interval-minutes=30 --commerce-stale-minutes=90
# Production:
bash scripts/production-task.sh supplier-sync --force --supplier=seta
bash scripts/production-task.sh supplier-configure --supplier=seta --group=ALL --daily-at=03:00 \
  --commerce-enabled=true --commerce-interval-minutes=30 --commerce-stale-minutes=90
```

Ortam: `SETA_API_KEY` (zorunlu), `SETA_BASE_URL` (isteğe bağlı; yalnız `https://b2b-api.ismyazilim.com`). Yönetim: `/yonetim/tedarikciler/seta`. Test: `npm run test:seta`.
