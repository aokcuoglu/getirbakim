# Başbuğ admin ekranı

Admin hesabıyla `/yonetim` ekranındaki **Başbuğ verilerini incele** bağlantısından veya doğrudan `/yonetim/tedarikciler/basbug` adresinden açılır. Servis hesapları ve ziyaretçiler ekranı, detaylarını veya güncelleme işlemini kullanamaz.

## Görünen bilgiler

- Grup bazında farklı ürün, eksik fiyat, tekrarlanan kod ve çelişkili kod sayıları.
- Parça kodu, ham OEM referansları, ürün adı, ek açıklama, marka, kaynak para birimi, LF/NF/MIF/K alanları ve MRK stok sinyali.
- Son başarılı aktarım, her servisin çekilme zamanı, ham/tekil satır sayıları ve eşleşmeyen fiyat/stok kayıtlarının sayısı.
- Kaynak alış/satış kur değerleri. API kurun yürürlük tarihini vermediği için böyle bir tarih gösterilmez.
- Parça/OEM/ad/marka araması; liste grubu, marka, para birimi, 0/1 stok sinyali ve veri kalitesi filtreleri. Sayfada en fazla 50 kayıt.
- Parça koduna tıklayarak kaynak model/motor/yıl metinlerini, fiyat/depo alanlarını ve JSON alanlarını inceleme. Çelişkili tekrarların farklı değerleri saklanır ve detayda görülebilir.

NF kullanıcı tarafından KDV hariç maliyet olarak doğrulandı. Satış fiyatı TRY kuru, yönetilebilir kâr ve KDV üzerinden hesaplanır. LF/MIF/K satış formülünde kullanılmaz. Stok sinyalleri adet olarak sunulmaz. Model/motor/yıl metni kesin araç uyumluluğu sayılmaz. [Satış ve sipariş yönetimi](commerce.md).

## Güncelleme

İstenen liste grubunu seçip **Seçili grubu API’den güncelle** düğmesine basın. MRK, Postman koleksiyonunda doğrulanmış depo olduğu için bu sürümde sabittir. İşlem sırasında düğme devre dışı kalır. Grup, Başbuğ'un güncel grup yanıtıyla doğrulanır.

İşlem Auth alır; grup listesi, ürünler, fiyatlar, MRK stokları ve kurları çeker. Tokenlar bellekte tutulur; erişim süresi dolmaya yaklaşırsa yeniden Auth alınır. Logout/refresh-token akışı bu sürümde kullanılmaz.

Yanıtlar doğrulandıktan sonra güncel kayıtlar `supplier_items` tablosunda tek transaction ile güncellenir. `supplier_imports` her denemenin durumunu ve sayaçlarını; `supplier_item_changes` yalnız içerik veya listede bulunma değişikliklerini tutar. Eski `supplier_import_items` tablosuna yeni veri yazılmaz. Kayıp ürün iki başarılı çekimde pasife alınır; geri gelirse aynı kimlikle etkinleşir. Şüpheli ürün sayısı / eksik fiyat-stok artışı çekimi reddeder. Hata ve reddedilen çekimde güncel veri korunur.

Ürün listesi varsayılan gece saati İstanbul 03:00; etkin gruplarda fiyat/stok/kur saatte bir, ticari bayatlık sınırı iki saat. Yönetim ekranında bağımsız zamanlayıcı sinyali ve grup bazında ticari güncelleme planı da gösterilir; zamanlayıcı `npm run supplier:sync` komutunu 15 dakikada bir çalıştırır. Yönetim ekranında son çalışmalar, değişiklik sayaçları, bayatlık ve hata uyarıları; detayda önceki/sonraki değerler görünür. [Tam yaşam döngüsü ve sunucu kurulumu](supplier-sync.md).
Aynı kodun birebir tekrarları tek satırda birleşir ve kaynak satır sayıları korunur. Çelişkili kayıtlar işaretlenir, alternatif değerleri saklanır. Eksik fiyat veya stok sıfırla değiştirilmez. Ürünle eşleşmeyen fiyat/stok sayıları raporlanır; bunlar ürün listesine eklenmez.

CLI: `npm run supplier:basbug:import`. `BASBUG_SAMPLE_GROUP` ile grup değiştirilebilir; varsayılan FIAT. Önce `npm run db:setup` çalıştırılmalıdır. CLI bağımsız `getirbakim/getirbakim_app` DB kontrolünü yapar.

## Doğrulama

`npm run test:supplier-sync` gerçek PostgreSQL üzerinde geçici şemada güncelleme, kayıp/geri dönüş, rollback, migration, hata ve saklama politikasını sınar.

`npm run test:basbug` normalizasyon, tekrar/çelişki, eksik/eşleşmeyen kayıt ve hatalı yanıt sınamalarını çalıştırır.

`npm run verify:basbug` çalışan uygulamada admin/servis/ziyaretçi erişimini, detayları, OEM aramasını, filtreleri, sayfalamayı, Server Action yetkisini/CSRF kontrolünü, değişiklik geçmişini ve aktarım kilidini doğrular. Geçici servis ve oturumları temizler. Canlı FIAT/MRK verisi ve örnek `COR 82016529` kaydı gerekir. `VERIFY_URL` varsayılanı `http://localhost:3100`.

Kaynak verileri mağaza `products` tablosundan ayrıdır. Çelişkisiz, listede mevcut Başbuğ ürünleri ortak `commerce_catalog` görünümü üzerinden müşteri kataloğu, sepet ve siparişe bağlanır. Yönetim tablosundaki **Satış · KDV dahil** sütunu aynı görünümden fiyat/stok ve sepete eklemeyi gösterir; kaynak NF/LF/MIF/K alanları korunur.

7 Ekim 2026: Başbuğ bakımı nedeniyle **Kayıtlı veriler · Bakım süresince** sipariş modu eklendi ve yerelde etkinleştirildi. Son kaydedilmiş fiyat, kur ve stok sinyalleriyle sepet ve teyit bekleyen sipariş oluşturulur; API çağrısı yapılmaz. Yeni kurulumda canlı mod varsayılandır. Ayar bu sayfadaki **Sepet ve sipariş** kutusundan değiştirilebilir. Kaynak tarihlerine ve API durdurma dosyasına dokunulmaz. [Mod kuralları ve sipariş akışı](commerce.md).

## Güncellik durum kutusu

Ürünler sekmesinin üzerinde tek durum kutusu, seçili kapsamda etkilenen grup sayısını ve ürün listesi ile fiyat/stok/kur güncelliğini ayrı gösterir. Ayrıntılar her grubun son başarılı çekimini, başarısızlık sayısını ve planlanan sonraki denemelerini İstanbul saatiyle gösterir. Zamanlayıcı sinyali yoksa deneme saati yalnız plan olarak sunulur.

Kutudaki **Seçili grubu yeniden dene** işlemi aynı admin yetkisi, grup doğrulaması, tedarikçi kilidi ve kalite korumalarıyla tam çekim yapar. Tüm grupları aynı anda başlatmaz. Güncellik eşikleri değiştirilmez. Yeni çekim geçmişinde zaman aşımı ve HTTP hata kodu, yanıt gövdesi veya bağlantı sırları saklanmadan kaydedilir; eski genel servis hataları kesin zaman aşımı olarak etiketlenmez.

**Tüm grupları API’den yenile** düğmesi, son başarılı API grup listesindeki tüm grupları ürün filtrelerinden bağımsız olarak sırayla yeniler. Her grup ayrı admin yetkili istekte tam çekilir; mevcut kilit ve kalite eşikleri uygulanır. İlerleme ve grup bazında sonuçlar ekranda gösterilir. Servis veya kalite hatasında sıradaki gruba devam edilir. Başka bir çekim kilidi varsa ya da istek sonucu alınamazsa toplu işlem durur ve kalan gruplar başlatılmadı olarak gösterilir. Sayfa işlem boyunca açık tutulmalıdır; işlem kalıcı bir arka plan kuyruğu değildir. Otomatik çekim ayarları değiştirilmez.

### Operatör tarafından durdurma

6 Ekim 2026'da kullanıcının isteğiyle Başbuğ çekimleri durduruldu. `.local/basbug-paused` dosyası mevcutken ortak importer, manuel/toplu/zamanlayıcı/sipariş çekimlerini API çağrısından önce `paused` sonucu ile engeller. Toplu işlem bu sonuçta kalan grupları başlatmaz. Yerel `com.getirbakim.supplier-sync` ve `com.getirbakim.supplier-monitor` launchd görevleri de kaldırıldı (plist dosyaları korunur). Yeniden başlatma yalnız kullanıcı istediğinde yapılmalıdır; durdurma dosyasını kaldırmak ve yerel otomasyon gerekiyorsa `npm run supplier:auto:install` çalıştırmak gerekir. Durdurma ürün veya zenginleştirme verisini silmez.
