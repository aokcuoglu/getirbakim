# Online ödeme (TAMI)

9 Ekim 2026: kullanıcı kararı — tek ödeme yöntemi TAMI ortak ödeme sayfası (hosted); ödeme sipariş anında, tedarikçi stok teyidinden önce alınır. Kargo sabit ücret + ücretsiz kargo eşiği. Ödemesiz sipariş yolu kaldırıldı. 15 Kasım 2026 (#619): iade/iptal `/yonetim/siparisler`'den TAMI API ile yapılır; portal + elle referans yalnız yedek yoldur.

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
- **Stok iadesi** (#516): her sipariş satırı gerçekten düşülen mağaza stokunu `commerce_order_items.reserved_quantity` alanında tutar. İptal ve süre dolumu yalnız bu adedi iade eder ve alanı 0'a çeker; ikinci iptal hiçbir şey iade etmez. Geç ödemede stok yetmeyen satır 0 olarak kalır, yani sonradan yapılan iptal o satır için stok iade etmez. `reserved_quantity` NULL olan eski satırlarda eski kural geçerlidir (tam adet). `db:setup` backfill'i bu alanı yalnız NULL satırlarda doldurur: "mağaza stoku yetersiz" notu taşıyan geç ödenmiş siparişlerin bütün satırları 0 sayılır. Bu siparişlerin stoğunu operasyon elle düzeltmelidir.
- **Mükerrer ödeme** (aynı siparişe ikinci başarılı deneme): `payment_note` "fazla tahsilatı Siparişler'den TAMI ile iade edin" uyarısı alır; fazla deneme aşağıdaki API yoluyla iade edilir.
- **İptal**: yönetim yalnız ödenmiş (veya ödeme öncesi dönemden kalan `none`) siparişleri onaylar/iptal eder. Ödenmiş sipariş iptal edilince `refund_required`; `/yonetim/siparisler`'de "TAMI'den iade et" ile iade edilince (ya da yedek yolda referans elle girilince) `refunded` + `refunded_at`.

## İptal / iade (API, #619)

- **Uçlar:** `POST {TAMI_PAYMENT_API_BASE_URL}/api/v0/payment/void` (aynı gün, gün sonundan önce) ve `/api/v0/payment/refund`. Belgelenen yol `/api/v0` önekli; mevcut hosted/sorgu çağrıları öneksiz çalışıyor. Önekli yol 404 dönerse aynı istek öneksiz yola bir kez gönderilir (`SIGNED_PATH_PREFIXES`, `src/modules/payments/tami.ts`). Sandbox'ta hangisinin yanıt verdiği aşağıdaki gözlem bölümüne yazılır.
- **v4 imzalama** (TAMI Node örneği `tamiToken.js` ile aynı, yalnız `node:crypto`): gövde `{ "signedRequest": "<JWE>" }`. İçteki JWS HS512, başlık `{alg:"HS512",kid:TAMI_JWK_KID,typ:"JWT"}`, anahtar `base64url-decode(TAMI_JWK_K)`; iddialar `iss="<merchant>:<terminal>"`, `aud="tami"`, `jti`, `iat`, `nbf`, `exp=+600 sn`, `tami:body`, `tami:apiVersion="v4"`. Dış JWE kompakt `<başlık>..<iv>.<şifreli>.<etiket>`: `{alg:"dir",enc:"A256GCM",cty:"JWT"}`, anahtar `SHA-256(base64url-decode(k))`, 12 baytlık IV, AAD = başlığın base64url ASCII'si. Başlıklar: `PG-Api-Version: v4`, `PG-Auth-Token`, `correlationId` (her çağrıda yeni; satırın `correlation_id`'si). Tutar string, iki ondalık (`"200.00"`); iade hep tam tutarı açıkça gönderir.
- **Yanıt:** başarıda `{ signedResponse }` düz JWS (HS512): imza `timingSafeEqual`, `aud="<merchant>:<terminal>"`, `exp+60 ≥ şimdi`, gövde `tami:body`.
- **Sonuç sınıfları:**
  - `succeeded`: imza/aud/exp geçerli, `success:true`, `correlationId` (varsa) bizimki, `currency` (varsa) `TRY`, `amount` kuruşu kuruşuna eşit (iadede zorunlu, iptalde alan varsa).
  - `failed` (kesin, yeniden denenebilir): HTTP 4xx + JSON `success:false` + `errorCode`, ya da imzalı gövdede `success:false`.
  - `unknown`: ağ hatası, zaman aşımı (15 sn), 5xx, JSON olmayan yanıt, imza/aud/exp hatası, tutar/para birimi/correlationId uyuşmazlığı. Sipariş `refund_required` kalır, aynı deneme için yeni istek kilitlenir.
- **İptal mi iade mi:** deneme (`commerce_payments.paid_at`) İstanbul saatiyle bugün tahsil edildiyse önce iptal; TAMI iptali kesin reddederse aynı işlemde iade gönderilir. Daha eski ödeme doğrudan iade edilir. Her çağrı ayrı satır ve ayrı correlationId.
- **Kayıt:** `commerce_payment_refunds` (çağrı başına bir satır; `requested` → `succeeded|failed|unknown`). Satır TAMI çağrılmadan **önce** commit edilir (sipariş satırı `FOR UPDATE` kilidiyle). Kısmi tekil indeks: deneme başına tek etkin (`requested|unknown|succeeded`) kayıt → çift tıklama/yarış tek çağrı. Yalnız tam iade (kısmi iade kapsam dışı).
- **Sipariş:** iptal edilmiş (`refund_required`) siparişin tüm başarılı denemeleri iade edilince `refunded`, `refunded_at`, `refund_reference = "TAMI <İptal|İade> <deneme> · banka ref. …"`. Ödenmiş siparişte yalnız fazla denemeler iade edilebilir (en az biri kalır); iade notu `payment_note`'a eklenir. Müşteri sayfası iade tarihini gösterir.
- **Sonucu bilinmeyen çağrı:** listede "İade sonucu bilinmiyor" + "TAMI'de kontrol et". Bu, imzalı `/payment/query` ile bakar (çağrıdan ≥1 dk sonra): başarılı iptal/iade işlemi görünürse `succeeded`; çağrıdan 15 dk sonra yalnız başarılı AUTH görünürse `failed` ("TAMI'de iade kaydı yok; yeniden deneyin"); diğer her durumda `unknown` kalır. İade işlemi türlerinin sorgudaki adı belgelenmemiş: `REVERSAL_TRANSACTION_TYPES` (`src/modules/payments/refunds.ts`, şimdilik `REFUND`/`VOID`/`CANCEL`) sandbox gözlemiyle daraltılmalı.
- **Yedek yol:** TAMI'ye ulaşılamıyorsa iade portaldan yapılır ve referans "Elle: TAMI iade ref." alanına girilir; bu `refund_required` siparişi `refunded` yapar, sonucu bilinmeyen çağrı satırlarına dokunmaz. Sandbox portalı için ayrı test portal kullanıcısı gerekir (TeknikDestek@tami.com.tr); mevcut girişle portal ekranı yanıt vermeden bekliyor.

### Sandbox'ta gözlenen yanıt/sorgu biçimleri

> **YER TUTUCU (#619 orkestratör):** sandbox uçtan uca (#36, `GB2-36-1`) sonrası doldurulacak: hangi yol yanıt verdi (`/api/v0/payment/...` mı öneksiz mi), iptal/iade yanıtı gövde alanları (`amount` biçimi, `correlationId` dönüyor mu), red yanıtı örneği ve `errorCode`, iade sonrası `/payment/query` çıktısında `transactionType`/`orderStatus` değerleri.

## Ayarlar

- `/yonetim/fiyatlandirma` → Kargo: ücret (varsayılan 150 TL) ve ücretsiz kargo eşiği (varsayılan 1.500 TL, 0 = eşik yok). Eşik servis indirimi sonrası ürün toplamına uygulanır. **Varsayılanlar yer tutucudur; canlıya almadan önce gerçek değerleri girin.**
- Ortam: `TAMI_MERCHANT_NUMBER`, `TAMI_TERMINAL_NUMBER`, `TAMI_SECRET_KEY`, `TAMI_JWK_KID`, `TAMI_JWK_K`, `TAMI_PAYMENT_API_BASE_URL`, `TAMI_PORTAL_BASE_URL` (sandbox veya canlı çift; karışık çift reddedilir), `TAMI_CHECKOUT_ENABLED=true` (yeni ödemeleri açar; kapalıyken checkout devre dışı, callback/mutabakat çalışmaya devam eder), `PAYMENT_RECONCILIATION_SECRET` (≥32 karakter), `SITE_URL` (callback adresi bundan üretilir).
- Zamanlanmış mutabakat: 5 dakikada bir `POST /api/payments/tami/reconcile` çağrılır (geç ödemeleri yakalar, süresi dolan siparişleri kapatıp stoku iade eder). Çağrılmazsa geç ödeme yakalanmaz ve süresi dolan sipariş stoku tutmaya devam eder.
  - **AWS (canlı):** EventBridge Scheduler `getirbakim-production/getirbakim-production-payment-reconciliation`, `rate(5 minutes)`, yeniden deneme yok. ECS görev tanımı `getirbakim-production-payment-reconciliation` (operations imajı, 256 CPU / 512 MB) `node -e fetch(...)` ile iç ALB'deki `RECONCILE_URL`'e `Authorization: Bearer $PAYMENT_RECONCILIATION_SECRET` gönderir; 240 sn zaman aşımı, 2xx dışı yanıtta çıkış kodu 1. Secret uygulamayla aynı değerdir (Secrets Manager). Altyapı Lokum Ops CDK'sında tanımlı, bu repoda değil. Zamanlayıcı DNS geçişine kadar **kapalıdır**; geçişte açılır ([AWS geçişi](aws-cutover.md)).
  - **VPS (eski):** `deploy/getirbakim-production-payments.{service,timer}` aynı ucu çağırır. VPS geçişe kadar bakım modunda; AWS'e geçildikten sonra kullanılmaz.

## Test

- `npm run test:payments`: geçici şemada, sentetik anahtarla imzalanmış mock TAMI yanıtlarıyla; token tekrar kullanımı, imzalı callback, tutar uyuşmazlığı, eşzamanlı mutabakat, mükerrer/geç ödeme, süre dolumu ve stok iadesi, ağ hatası/sahte "işlem yok" yanıtında iptal etmeme.
- `npm run test:payment-refunds`: geçici şemada sentetik anahtarla imzalanmış mock yanıtlarla; v4 istek şifreleme/imza, imzalı yanıt doğrulama (imza/aud/exp/alg), İstanbul günü sınırı, iptal→iade geçişi, kesin ret, belirsiz sonuçlar (ağ, 5xx, imzasız, tutar/para birimi/correlationId), yarış, sorguyla mutabakat, mükerrer tahsilat, elle yedek yol.
- `npm run test:supplier-checkout`, `npm run verify:commerce`: sipariş artık `awaiting_payment` oluşur ve sepet korunur.
- Sandbox uçtan uca: checkout → TAMI sayfası doğru tutarla açıldı → yayımlanmış Garanti test kartı gönderildi → sorgu `NOT_COMPLETED` döndü ve sipariş doğru şekilde ödenmemiş kaldı. 3D OTP adımı (Garanti test ACS) otomasyonda yüklenmediği için **başarılı tahsilat sandbox'ta henüz uçtan uca doğrulanmadı**; gerçek tarayıcıda elle bir ödeme ile doğrulanmalı.
