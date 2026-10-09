# Online ödeme (TAMI)

9 Ekim 2026: kullanıcı kararı — tek ödeme yöntemi TAMI ortak ödeme sayfası (hosted); ödeme sipariş anında, tedarikçi stok teyidinden önce alınır. Kargo sabit ücret + ücretsiz kargo eşiği. İade TAMI portalından manuel yapılır. Ödemesiz sipariş yolu kaldırıldı.

## Akış

0. **Neden popup + modal:** TAMI ödeme sayfası iframe'e gömülemez (`frame-ancestors` yalnız TAMI alan adları; sandbox ve canlıda 9 Eki 2026'da curl ile doğrulandı) ve başarısız ödemede siteye geri yönlendirmez. Bu yüzden "Ödemeye geç" tıklanınca (`CheckoutForm`) önce kullanıcı jesti içinde `getirbakim-tami` adlı popup açılır, ardından `placeOrder` siparişi oluşturur ve `POST /api/payments/tami/start` o pencereye gönderilir. Site arkada `PaymentDialog` modalıyla açık kalır: modal 4 sn'de bir durumu sorar, popup kapanırsa "yeniden dene / daha sonra öde" sunar, ödeme doğrulanınca sipariş sayfasına geçer. Callback ve start hataları popup'ta küçük bir dönüş sayfası (`popupReturn`) döner: opener'a `postMessage` gönderip pencereyi kapatır; popup engellenmişse, JS yoksa ya da mobilde sekme olarak açıldıysa sipariş sayfasına yönlendirir. Sipariş sayfasındaki "Kartla öde" (`PayButton`) aynı modalı kullanır. JS yokken form eski yoldan çalışır (sipariş sayfası, yeni sekme).
1. `/siparis-olustur` → `submitOrder`: sipariş `awaiting_payment` / `payment_status=awaiting` oluşur, 45 dk ödeme süresi (`payment_due_at`) başlar, mağaza stoku ayrılır. **Sepet silinmez**; kart reddedilirse müşteri yeniden dener.
2. `startPayment`: önce açık denemeleri TAMI'ye sorar (başka sekmede ödenmiş olabilir), sonra `commerce_payments` satırını commit eder ve `/hosted/create-one-time-hosted-token` çağırır. TAMI orderId = `GB2-<sipariş no>-<deneme no>` (eski vitrinle aynı üye işyerinde çakışmasın diye önekli, ≤50 karakter). Taze (5 dk) ve TAMI'de henüz işlemi olmayan deneme varsa aynı sayfa tekrar kullanılır; token tek kullanımlık olduğundan işlem görmüş (reddedilmiş dahil) denemeden sonra yeni deneme açılır; sipariş başına en fazla 6 deneme.
3. Müşteri TAMI sayfasında kartı girer (kart bilgisi uygulamaya hiç gelmez). Dönüş `/api/payments/tami/callback?order=…&sig=…` (GET/POST; çerez yok, HMAC imzalı). Callback içeriğine güvenilmez.
4. `reconcileOrderPayments`: her açık deneme için imzalı `/payment/query`. Ödendi sayılması için: imza geçerli, `success`, orderId eşleşir, `TRY`, tutar kuruşu kuruşuna eşit, `orderStatus=AUTH` **ve** AUTH işleminin `transactionStatus=SUCCESS`. Ödenince sipariş `pending` (Teyit bekliyor) + `paid` olur, sepetten yalnız satın alınan ürünler silinir.
5. Süre dolunca (yalnız TAMI'den kesin "işlem yok" yanıtı alınmışsa) sipariş `cancelled` / `expired` olur, mağaza stoku iade edilir.

### Sandbox'ta doğrulanan sağlayıcı davranışları

- Henüz işlem yoksa sorgu imzalı `HTTP 400, errorCode 2013` ("Bu sipariş üye işyerine ait değildir.") döner → "işlem yok" kanıtı yalnız imza geçerliyse kabul edilir; ağ hatası/imzasız yanıt siparişi asla iptal ettirmez.
- 3D doğrulaması tamamlanmamış ödeme: `success:true, orderStatus:"AUTH"` ama `paymentStatus` ve işlem `transactionStatus` = `NOT_COMPLETED`. Yalnız `success`/`orderStatus`'a bakmak bu yüzden yanlış olur.
- Sorgu yanıtı `orderId` içerir; `securityHash` gerçek yanıtla doğrulandı.
- Telefon `905xxxxxxxxx` biçiminde gönderilir. Token test ortamında 15 dk; ödeme sayfası prod'da 6 dk işlem yapılmazsa zaman aşımına uğrar. Fail callback TAMI tarafında kullanılmıyor.
- Masterpass OTP'sinde hata: deneme sorguda yine `AUTH/NOT_COMPLETED` görünür; "reddedildi" ile "hâlâ OTP ekranında" ayırt edilemez. Sandbox OTP kodu yayımlanmamış.
- Ortak ödeme sayfası headless tarayıcı kullanıcı ajanını reddeder ("Özür dileriz…") — otomasyon testlerinde normal UA kullanın.

### Kenar durumlar

- **Geç ödeme** (süre dolup iptal edildikten sonra): sipariş `pending`+`paid` olarak geri alınır, mağaza stoku yeniden ayrılmaya çalışılır, `payment_note` ile işaretlenir. Denemeler oluşturulduktan sonra 2 saat izlenir, sonra `abandoned`.
- **Mükerrer ödeme** (aynı siparişe ikinci başarılı deneme): `payment_note` "fazla tahsilatı iade edin" uyarısı alır.
- **İptal**: yönetim yalnız ödenmiş (veya ödeme öncesi dönemden kalan `none`) siparişleri onaylar/iptal eder. Ödenmiş sipariş iptal edilince `refund_required`; iade TAMI portalından yapılıp referansı `/yonetim/siparisler`'de girilince `refunded`.

## Ayarlar

- `/yonetim/fiyatlandirma` → Kargo: ücret (varsayılan 150 TL) ve ücretsiz kargo eşiği (varsayılan 1.500 TL, 0 = eşik yok). Eşik servis indirimi sonrası ürün toplamına uygulanır. **Varsayılanlar yer tutucudur; canlıya almadan önce gerçek değerleri girin.**
- Ortam: `TAMI_MERCHANT_NUMBER`, `TAMI_TERMINAL_NUMBER`, `TAMI_SECRET_KEY`, `TAMI_JWK_KID`, `TAMI_JWK_K`, `TAMI_PAYMENT_API_BASE_URL`, `TAMI_PORTAL_BASE_URL` (sandbox veya canlı çift; karışık çift reddedilir), `TAMI_CHECKOUT_ENABLED=true` (yeni ödemeleri açar; kapalıyken checkout devre dışı, callback/mutabakat çalışmaya devam eder), `PAYMENT_RECONCILIATION_SECRET` (≥32 karakter), `SITE_URL` (callback adresi bundan üretilir).
- Zamanlanmış mutabakat: `deploy/getirbakim-production-payments.{service,timer}` 5 dakikada bir `POST /api/payments/tami/reconcile` çağırır (geç ödemeleri yakalar, süresi dolan siparişleri kapatır). VPS'e kurulması ayrı adımdır.

## Test

- `npm run test:payments`: geçici şemada, sentetik anahtarla imzalanmış mock TAMI yanıtlarıyla; token tekrar kullanımı, imzalı callback, tutar uyuşmazlığı, eşzamanlı mutabakat, mükerrer/geç ödeme, süre dolumu ve stok iadesi, ağ hatası/sahte "işlem yok" yanıtında iptal etmeme.
- `npm run test:supplier-checkout`, `npm run verify:commerce`: sipariş artık `awaiting_payment` oluşur ve sepet korunur.
- Sandbox uçtan uca: checkout → TAMI sayfası doğru tutarla açıldı → yayımlanmış Garanti test kartı gönderildi → sorgu `NOT_COMPLETED` döndü ve sipariş doğru şekilde ödenmemiş kaldı. 3D OTP adımı (Garanti test ACS) otomasyonda yüklenmediği için **başarılı tahsilat sandbox'ta henüz uçtan uca doğrulanmadı**; gerçek tarayıcıda elle bir ödeme ile doğrulanmalı.
