# Tedarikçi entegrasyon durumu — 1 Ekim 2026 (Dinamik: 11 Ekim)

Eski `gb` kodu, şeması, sorguları veya verileri okunmadı/taşınmadı. Yalnızca `.env` ve `.env.local` içinden gerekli bağlantı alanları seçildi. Gereksiz eski proxy, TLS güvensizliği, eşzamanlılık ve senkronizasyon ayarları taşınmadı.

## Dinamik

11 Ekim 2026: canlı bağlandı. API (`https://dinamikapp-api.dinamik.online`, `ApiKey` + `SecretKey` başlıkları) yalnız VPS IP'sine (173.249.36.2) izin verir; production konteynerleri bu IP'den çıktığı için proxy gerekmez. Lokal geliştirmede `ssh -N -L 18443:dinamikapp-api.dinamik.online:443 root@173.249.36.2` + `DINAMIK_DIRECT_TUNNEL=127.0.0.1:18443` (SNI, sertifika ve `Host` gerçek ad kalır). Swagger 404; sözleşme canlı yanıtlardan doğrulandı.

Sunucu TLS zincirinde ara sertifikayı göndermiyor. Doğrulama kapatılmadı: Sectigo DV R36 ara sertifikası koda sabitlendi (kök, sistem güven deposundaki Sectigo Root R46; ara sertifika 2036'ya kadar geçerli).

| Uç nokta | İçerik |
| --- | --- |
| `GET /api/Dnmk_Customer/getBrandList` | 786 marka (`[{brand}]`) |
| `GET /api/Dnmk_Customer/getStockList/{marka}` | Ürün ayrıntısı + `varyok1..4` (İstanbul/Ankara/Sakarya/Kayseri), `varyokAll`, `kaporta` VAR/YOK bayrakları, `fiyat`, `kampanyaOrani`, paket/koli/ölçü/desi |
| `GET /api/Dnmk_Customer/getPriceList/{marka}` | `marka`, `stokKodu`, `fiyat`; stok listesinin üst kümesi |

Gözlemler (FEBI/BOSCH örneği): fiyat listesi stok listesinin ~2-3 katı; stok listesinde olup fiyat listesinde olmayan kod yok; iki listedeki fiyatlar birebir aynı. Stok değerleri adet değil VAR/YOK. Fiyatın KDV dahil/hariç, iskontolu/iskontosuz olduğu ve kampanya oranının uygulanma şekli **doğrulanmadı**; bu yüzden mağaza satışı kapalı (`commerce_supplier_items` yalnız Başbuğ). Ayrıntı: [supplier-sync.md](supplier-sync.md#dinamik--11-ekim-2026).

## Başbuğ

Kullanıcının sağladığı Postman koleksiyonu ile `POST /auth/Login` ve yedi salt okunur ürün/grup/fiyat/stok/kur çağrısı canlı doğrulandı. Firma `BASBUG`; token 300 saniye, refresh token 3600 saniye geçerli. Swagger adresleri hâlâ 403 dönüyor ancak API çağrıları çalışıyor.

FIAT grubunda 18.921 ürün satırı, 19.106 fiyat satırı, MRK deposunda 18.921 stok satırı alındı. Tekrarlanan kodlar ve bir eksik fiyat kaydı var. Stok değerleri bu örnekte 0/1; gerçek adet olduğu doğrulanmadı. Fiyat türleri, vergi ve `k` anlamı da doğrulanmalı. Bu nedenle mağazaya aktarma kapalı tutuluyor. [Alanlar, veri kalitesi ve önerilen DB yapısı](basbug-data-analysis.md). Tekrar inceleme: `npm run supplier:basbug:inspect`; ham örnekler Git dışında `.local/basbug/` altında.

## Güvenli başlangıç sınırı

Sunucu katalog istemci giriş noktası henüz hata verir. Yönetim, Başbuğ için canlı erişimin doğrulandığını ve fiyat/stok anlamlarının beklediğini gösterir. İç normalize ürün şeması tedarikçi yanıt şeması değildir. Sırlar, tokenlar ve ham yanıtlar tarayıcıya aktarılmamalıdır. Kataloğa veri aktarımı fiyat/vergi/stok anlamları doğrulandıktan sonra eklenmelidir.
