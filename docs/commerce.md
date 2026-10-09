# Satış, servis indirimi ve sipariş

3 Ekim 2026: kullanıcı NF'nin Getirbakım için KDV hariç maliyet olduğunu doğruladı ve başlangıç kâr oranını %30 seçti.

## Yönetim

- `/yonetim/fiyatlandirma`: maliyet üzerine kâr, KDV ve kur/tedarikçi verisi geçerlilik süresi. Başlangıç %30 kâr, %20 KDV ve 36 saat geçerlilik. KDV oranı işletme tarafından panelden değiştirilebilir.
- `/yonetim/servisler`: servis hesabı oluşturma, onayı açma/kapatma ve %0–50 servis indirimi.
- `/yonetim/siparisler`: siparişleri inceleme, teyit bekleyen siparişi onaylama veya iptal; onaylı siparişi sevk etme veya iptal. İptal, ayrılmış mağaza stoklarını yalnız bir kez iade eder.

Satış fiyatı kuruş olarak `round(NF × döviz satış kuru × (1+kâr/100) × (1+KDV/100) × 100)` hesaplanır. Onaylı servisin indirimi bu satış fiyatına uygulanır. İndirim kârı azaltır; yüksek indirim maliyet altına satışa neden olabilir. Geçmiş sipariş fiyatları değişmez.

Kur kaynağı aynı firma için son başarılı `supplier_imports.currencies_data.dovizListesi` kaydının `satis` değeridir. TL/TRY için kur 1'dir. Canlı modda kur veya ürün/stok verisi geçerlilik süresini aşarsa satış engellenir. Eksik NF veya bilinmeyen döviz sıfır fiyatla değiştirilmez. LF/MIF/K satış formülünde kullanılmaz.

### Başbuğ bakım süresince kayıtlı veri modu

`/yonetim/tedarikciler/basbug` üzerindeki **Sipariş veri kaynağı** ayarı `commerce_settings.basbug_checkout_mode` alanını yönetir. Yeni kurulumlarda `live` varsayılandır. Kullanıcının 7 Ekim 2026 talebiyle yerel veritabanında `snapshot` etkinleştirildi.

- `snapshot`: son kayıtlı NF, stok sinyali ve döviz kuru kullanılır; güncellik süresi yalnız bu modda satışa engel değildir. Sepet ve sipariş API çağrısı yapmaz. Eksik/sıfır NF, bilinmeyen kur, eksik/boş stok, yalnız yoldaki stok, çelişkili ve pasif ürünler siparişe açılmaz.
- `live`: eski güncellik kuralları ve sipariş sırasında API doğrulaması tekrar uygulanır. Bu ayar API durdurma dosyasını kaldırmaz veya zamanlayıcıyı başlatmaz.

Kaynak tarihleri güncellenmez. Sipariş kaleminde `checkout_mode`, `source_fresh`, firma/grup/depo ve orijinal fiyat/stok/kur gözlem tarihleri saklanır. Sipariş “Teyit bekliyor” olarak oluşur; sepet, teslimat adımı ve sipariş detayında kayıtlı verilerle fiyat/stok teyidi beklendiği gösterilir. Mod veya fiyat/indirim değişirse toplam yeniden onaylanır.

## Stok ve sipariş

Başbuğ `stok` / `sFarkliDepo` pozitif sinyalleri bulunabilirliktir; gerçek adet gösterilmez. MRK'da stok varsa “Tedarikçide mevcut”, sadece başka depoda varsa “Diğer depoda mevcut” gösterilir. Yolda sinyali tek başına siparişe açmaz. Tedarikçi ürünleri için adet 1–99 talep edilebilir; tedarikçi gerçek adedi ve teslimat süresini operasyon teyit eder. API'ye sipariş gönderilmez.

Sepet misafir ve hesap oturumlarıyla çalışır; girişte misafir sepeti birleşir. Misafir siparişleri aynı 30 günlük sepet çerezi üzerinden görülebilir; giriş yaptıktan sonra da aynı çerez varsa erişilebilir. `/siparisler` ve `/siparis/[id]` yalnız sahibinin veya yöneticinin erişimine açıktır.

Katalog, ürün detayı ve Başbuğ yönetim tablosundaki **Sepete ekle** işlemi sayfadan ayrılmadan, Trodo referansındaki iki sütunlu ekleme penceresini açar. Pencerede mevcut ürünlerden öneriler, adet değiştirme, alışverişe devam, sepet ve sipariş bağlantıları bulunur. `/sepet` ürün tablosu ve ayrı sipariş özetini; `/siparis-olustur` iletişim/teslimat formu ve özeti gösterir. Adet değişince sepet ve toplamlar güncellenir.

Sipariş oluştururken iletişim ve adres alınır, fiyat/indirim/adet tekrar kontrol edilir. Fiyat değişmişse güncel toplam tekrar onaylanır. Aynı gönderimin tekrarı ikinci sipariş oluşturmaz. Mağaza stoku transaction içinde ayrılır; tedarikçi sinyali azaltılmaz. Satış fiyatı, NF/kur/kâr/KDV/indirim ve gözlem bilgileri sipariş kaleminde saklanır.

Ödeme sipariş anında TAMI ortak ödeme sayfasında kartla alınır; sipariş ödeme doğrulanınca “Teyit bekliyor” olur. Kargo sabit ücret + ücretsiz kargo eşiğiyle toplamda tahsil edilir. Ayrıntılar: [Online ödeme (TAMI)](payments.md). Tedarikçiye otomatik satın alma bağlı değildir.

## Kurulum ve doğrulama

`npm run db:commerce:migrate` mevcut DB'ye tabloları ve `commerce_catalog` görünümünü ekler. `npm run db:setup` yeni kurulumda da çalıştırır. Eski sepetler tek seferlik taşınır; geçiş yeniden çalıştırılabilir.

- `npm run verify:commerce`: fiyat formülü, stok sinyali, sepet, eşzamanlı sipariş/idempotency, fiyat değişimi ve stok ayırma.
- `npm run verify:commerce:http`: çalışan sunucuda gerçek Server Action formları, B2B fiyatı, sipariş yetkisi, yönetim ekranları, servis indirimi ve iptalde stok iadesi.
- `npm run test:supplier-checkout`: geçici şemada canlı API hata/fiyat/stok kontrolleri, kayıtlı modda eski NF/kur/stokla API’siz sipariş, eksik/çelişkili/pasif kayıtların reddi, adet sınırı, eşzamanlı gönderim ve değişmeyen sipariş fiyat/gözlem kayıtları. API yanıtları mock edilir; yerel durdurma dosyasına dokunulmaz.
- `npm run verify:catalog`: katalog arama/filtre/paginasyon ve ürün detayları.

Doğrulamalar geçici sentetik hesap/ürün/sipariş kayıtlarını sonunda siler. HTTP doğrulaması varsayılan `http://localhost:3000` kullanır; `VERIFY_URL` ile değiştirilebilir.
