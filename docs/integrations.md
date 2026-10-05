# Tedarikçi entegrasyon durumu — 1 Ekim 2026

Eski `gb` kodu, şeması, sorguları veya verileri okunmadı/taşınmadı. Yalnızca `.env` ve `.env.local` içinden gerekli bağlantı alanları seçildi. Gereksiz eski proxy, TLS güvensizliği, eşzamanlılık ve senkronizasyon ayarları taşınmadı.

## Dinamik

Kaynak bağlantı adresindeki `/swagger/v1/swagger.json` ve `/swagger/index.html` erişimi HTTP 401 döndü. `ApiKey` ve `SecretKey` başlıklarıyla yapılan dokümantasyon isteği `Access denied from IP` yanıtını verdi. Bu yalnızca erişim engelini doğrular; ürün uç noktası veya kimlik doğrulama sözleşmesini doğrulamaz. TLS doğrulaması uygulamada kapatılmadı.

Gerekli sonraki adım: uygulamanın çıkış IP'sine izin verilmesi ve güncel resmi OpenAPI/servis dokümanının alınması. Ardından yalnızca okuma yapan ürün kodu araması ve detay istekleri çalıştırılmalı; gerçek yanıtların alanları, kuruş dönüşümü, para birimi, vergi, stok ve müşteri özel fiyat anlamları doğrulanmalıdır.

## Başbuğ

Kullanıcının sağladığı Postman koleksiyonu ile `POST /auth/Login` ve yedi salt okunur ürün/grup/fiyat/stok/kur çağrısı canlı doğrulandı. Firma `BASBUG`; token 300 saniye, refresh token 3600 saniye geçerli. Swagger adresleri hâlâ 403 dönüyor ancak API çağrıları çalışıyor.

FIAT grubunda 18.921 ürün satırı, 19.106 fiyat satırı, MRK deposunda 18.921 stok satırı alındı. Tekrarlanan kodlar ve bir eksik fiyat kaydı var. Stok değerleri bu örnekte 0/1; gerçek adet olduğu doğrulanmadı. Fiyat türleri, vergi ve `k` anlamı da doğrulanmalı. Bu nedenle mağazaya aktarma kapalı tutuluyor. [Alanlar, veri kalitesi ve önerilen DB yapısı](basbug-data-analysis.md). Tekrar inceleme: `npm run supplier:basbug:inspect`; ham örnekler Git dışında `.local/basbug/` altında.

## Güvenli başlangıç sınırı

Sunucu katalog istemci giriş noktası henüz hata verir. Yönetim, Başbuğ için canlı erişimin doğrulandığını ve fiyat/stok anlamlarının beklediğini gösterir. İç normalize ürün şeması tedarikçi yanıt şeması değildir. Sırlar, tokenlar ve ham yanıtlar tarayıcıya aktarılmamalıdır. Kataloğa veri aktarımı fiyat/vergi/stok anlamları doğrulandıktan sonra eklenmelidir.
