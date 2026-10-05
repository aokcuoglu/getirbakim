> Bu dosya Trodo incelemelerinin tarihsel kaydıdır. Güncel Getirbakım tasarım kuralları [DESIGN.md](../../DESIGN.md) içindedir.

# Trodo bileşen ölçümleri — 1 Ekim 2026

Canlı referans: https://www.trodo.com/

Tarayıcı DOM'u ve `getComputedStyle` ile DevTools'un gösterdiği render edilmiş özellikler incelendi. Arama dropdownu, araç çekmecesi ve araç arama paneli açılarak durumlar ölçüldü. Ana sayfanın gözlemlenmiş görsel/font/stylesheet kaynakları tarayıcı materyal envanterinden indirildi. Scriptler, takip pikselleri, Trustpilot, Trodo logosu ve Google hesap bileşenleri projeye taşınmadı.

| Bileşen / özellik | Referans | Uygulama |
| --- | --- | --- |
| Yazı ailesi | Inter | Yerel Regular / Medium / SemiBold WOFF2 |
| Gövde metni | 14 px / 20 px | Ortak gövde ve kontroller |
| H1 | 600, 34 px / 42 px | Mağaza ve sayfa başlıkları |
| H2 | 600, 26 px / 34 px | Bölüm başlıkları |
| Ana renk | #0077c7 | Butonlar ve bağlantılar |
| Buton hover | #0063b4 | Ortak hover durumu |
| Metin | #212b36 | Ortak metin rengi |
| İkincil metin | #637381 | Placeholder ve açıklamalar |
| Kontrol kenarlığı | #c4cdd5 | Input ve dropdown |
| Kontrol köşesi | 6 px | Input, buton, dropdown, panel |
| Form inputları | 56 px | Garaj, servis girişi ve yönetim |
| Üst arama inputu | 38 px; 6/10 px padding | Üst arama kutusu |
| Dropdown açılır alanı | 0 2px 16px rgba(33,43,54,.08) | Seçim ve hesap paneli gölgesi |
| Araç çekmecesi | 420 px; tam ekran yüksekliği | Native modal dialog; mobilde tam genişlik |
| Hero | 280 px | Yerel Hero_image.webp |
| Kategori görseli | 135 × 90 px | Yerel kategori resimleri |
| Tanıtım kartı | 292 px, 6 px radius | Yerel fren disk/balata fotoğrafları |

Ölçüm aracının kesirli değerleri (örn. 55.996 px, 0.625 px border) cihaz ölçeğinden kaynaklanır; CSS değerleri 56 px ve 1 px olarak uygulanır.

`theme.css`, `inter.css`, `flag-icon.css` ve `flags.css` referans arşividir. Bunlar uygulamaya import edilmez; yeni bileşenler Getirbakim kodunda yazılmıştır. Arşivdeki göreli URL'lerin kopyalanması çalışma zamanında uzaktan çağrı oluşturmaz.

`assets.json` toplam 56 dosyayı kaydeder: 49 görsel/ikon, 3 font, 4 referans CSS. `media_assets` tablosu 52 görsel/font dosyasının metadata kaydıdır. Dosyalar `public/media/trodo` altında saklanır. Inter lisansı `fonts/LICENSE.txt` içindedir.

Eşleştirme görsel bileşenleri ve etkileşimleri kapsar. Araç kataloğu, kayıt sistemi, Trustpilot, ülke/para birimi seçimi, ödeme ve kampanya altyapısı Trodo'dan aktarılmaz. Getirbakim'in B2C/B2B modeli ve mevcut sunucu kontrolleri korunur.

Doğrulama: production build, TypeScript, ESLint; B2C/B2B akışları; dropdown klavye seçimi, hesap popoverı, kategori menüsü, ülke/para birimi seçicileri, garaj modalı ve mobil taşma kontrolleri.

## Ana layout karşılaştırması

Canlı sayfaya bu incelemede HTTP 403 nedeniyle erişilemedi; Chrome Computer Use erişimi de araç tarafından reddedildi. Aşağıdaki değerler arşivlenmiş Trodo `theme.css` dosyasından doğrulandı. Bunlar yeni bir canlı DevTools ölçümü değildir.

| Yerleşim | Önce | Referansa göre düzeltme |
| --- | --- | --- |
| Ana container | 1440 px | 1358 px; iki yanda 15 px padding |
| Kampanya kartlarının kapsayıcısı | `max-width: none` | Ana container ile aynı sınır |
| Kategori/kampanya arka planı | İçerik kapsayıcısında | Tam genişlikte ayrı dış kapsayıcı |
| B2B panelinin maksimum genişliği | 1410 px | 1328 px (container iç genişliği) |
| Masaüstü header dikey padding | 20 px | 24 px |
| Masaüstü menü dikey boşluğu | 8 px üst/alt | 0 px üst, 15 px alt; 27 px satır yüksekliği |
| Araç seçim kutusu | Dışta 14 px dikey padding | Metinde 13 px dikey padding; 40 px ikon; 64 px minimum yükseklik |

1440 px ekran genişliğinde ana içeriğin başlangıcı 15 px yerine 56 px olur: `(1440 - 1358) / 2 + 15`. Kampanya kartları da bu çizgiye oturur. Mevcut mobil menü ve arama davranışları korunmuştur; Trodo'nun mobil header yapısı farklı olduğundan birebir eşleşme iddiası yoktur. Hero'nun gerçek yüksekliği içerik ve margin toplamına bağlıdır; yukarıdaki eski 280 px kaydı yalnızca `min-height` değerini ifade eder. Canlı görsel karşılaştırma henüz doğrulanmadı.

## Giriş ve kayıt modalları — 2 Ekim 2026

Trodo.com Chrome Computer Use ile açıldı; Profile menüsündeki Log In ve Register butonlarından iki modal da canlı incelendi. Ortak yapı 1020 px genişlik, iki eşit sütun, 622 px minimum yükseklik ve 12 px köşe yarıçapıyla uygulandı. Form kontrolleri 48 px, sütun iç boşluğu 32 px, avantaj paneli iç boşluğu 48 px. `register-img-v2.png` kaynağı Chrome üzerinden indirildi; sunucu WebP gönderdiği için yerelde `register-img-v2.webp` olarak saklandı. Kaynak ve dosya özeti `assets.json` içinde.

Hesabım menüsünde Giriş yap ve Kayıt ol seçenekleri, modal içinden form geçişleri, native dialog odak sınırı, Escape/dış alan/kapat butonu ve mobil tam ekran görünüm bulunuyor. Formlar Türkçe ve avantaj metinleri mevcut Getirbakim özelliklerine göre düzenlendi. Giriş mevcut sunucu action'ını kullanır; hata halinde mevcut `/giris` sayfasına yönlendirir. Kayıt, sosyal giriş, şifre yenileme ve hukuki metinler henüz altyapıya bağlı değildir; ilgili kontroller durum mesajı gösterir. Üyelik veya e-posta gönderimi yapılmaz.

Tarayıcı kontrolü: 1440 px masaüstü ve 768/390/320 px görünümde yatay modal taşması yok; şifre eşleşmesi, zorunlu alanlar, modal geçişleri, Escape, dış alana tıklama ve header butonuna odak dönüşü doğrulandı. Mobil header'ın genel span gizleme kuralı yalnızca header butonuna daraltılarak form etiketlerinin görünmesi sağlandı.

## Kategori / ürün listesi — 2 Ekim 2026

`https://www.trodo.com/brake-discs` Chrome üzerinden `orca computer` ile canlı incelendi. Üst bölüm ve PageDown sonrası yatay ürün satırları gözlemlendi. `/katalog` sayfalarına 280 px kategori hero'su, kod arama / araç seçimi, breadcrumb, açıklama, popüler marka metni, 304 px filtre sütunu ve 32 px sütun aralığı uygulandı. Üretici araması, kategori araması, URL üzerinden marka filtresi ve sıralama, liste/ızgara görünümü, mevcut garaj dialog'u ve sepet action'ı bağlıdır. Kartlar katalogdaki gerçek alanları gösterir; olmayan teknik özellikler, indirimler, değerlendirmeler ve sevkiyat tarihleri üretilmez.

Bu ilk uygulama tam piksel eşleşmesi değildir: referanstaki fren fotoğrafı yerine mevcut yerel hero görseli; plaka servisi yerine OEM / ürün kodu araması; Trustpilot yerine Getirbakım metni kullanılır. Ürün görselleri mevcut PartArt bileşenidir. Yerel `yedek-parca` kategorisinde ürün olmadığı için canlı ürün satırlarının görsel karşılaştırması yapılamadı; boş durum doğrulandı.

Doğrulama: TypeScript, değişen TSX dosyalarında ESLint ve production build geçti. Playwright ile 1440, 768, 390 ve 320 px genişliklerde yatay taşma ve JS hatası olmadığı; liste/ızgara geçişi, araç dialog'unun açılışı ve Escape ile kapanışı doğrulandı. Masaüstü görünüm ayrıca Chrome Computer Use ekran görüntüsüyle incelendi.
