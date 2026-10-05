# Getirbakim marka rehberi

## Konumlandırma ve dil

**Getirbakim, araç sahipleri ve oto servisleri için, parçadan anlayan insanların yedek parça mağazasıdır.**

Marka yazımı logoda `getirbakim`, metinde `Getirbakim`. Son harf noktalı i; büyük harfli Türkçe yazım `GETİRBAKİM`. Ana renk #0077c7, metin #222831, beyaz #ffffff, yardımcı zemin #eef7fd. Yerel, lisanslı Inter Regular / Medium / SemiBold kullanılır. Logo bir bütün olarak okunur; kelimeyi bölmeyin.

İmza: **Bir bakalım, doğru parçayı bulalım.** Ana başlık: **Aradığın parçaya birlikte bakalım.** Açıklama: **Araç sahiplerine ve oto servislerine yedek parça.** B2C mesajı: “Aracın için doğru parçayı birlikte bulalım.” B2B mesajı: “Servisinin parça ihtiyacı için güvenilir tedarik.” Kontroller: Parça ara / Sepete ekle / Siparişi tamamla (yalnız çalışan ödeme akışında).

Getirbakim, günlük dildeki “getir bir bakayım”dan geliyor. Bir parçayı eline alıp inceleyen, sorunu dinleyen ve çözüm arayan ustanın yaklaşımını taşıyor. ERGUL ENERJI SAN TIC LTD STI’nin servis deneyimi, kendi stoku, Mutlu Akü distribütörlüğü ve tedarik ağı hikâyenin kanıtlarını oluşturur. Gerçek servis/depo/ekip fotoğrafları kullanıcı tarafından hazırlanacaktır; referans görselleri işletmenin fotoğrafları olarak sunmayın.

## Teslim edilen görsel paket

`public/brand/` altında:

| Dosya | Kullanım |
| --- | --- |
| logo-light.svg / .png | Açık zemin, mavi yazı; PNG 920×208, şeffaf |
| logo-dark.svg / .png | Koyu zemin, beyaz yazı; PNG 920×208, şeffaf |
| profile.svg / .png | Arama merceğinde noktalı i; profil PNG 512×512 |
| favicon-32.png | 32×32 tarayıcı simgesi; uygulamanın icon.svg dosyası aynı sembol |
| social-getirbakim.svg / .png | “Getirbakim nedir?” sabit gönderisi |
| social-bir-bakalim.svg / .png | “Doğru parçayı nasıl buluruz?” sabit gönderisi |
| social-servisler.svg / .png | “Servisler için Getirbakim” sabit gönderisi |

SVG metinleri Inter harflerinden çizgilere dönüştürülmüştür; alıcının bilgisayarında font gerekmez. Sosyal şablonlar 1080×1080. Logonun çevresinde en az bir i harfi yüksekliğinde boşluk bırakın; sıkıştırmayın, döndürmeyin. Beyaz sürümü #222831 gibi koyu zeminde kullanın. Sembol yazı logosunun profil boyutundaki alternatifidir. PNG çıktıları `node scripts/render-brand.mjs` ile üretilir (Next.js bağımlılığı sharp). SVG çıktıları `scripts/generate-brand.py` ile, `fonttools[woff]` kurulu ayrı bir Python ortamında yeniden üretilebilir.

## İsim testi — ilk hafta

10 araç sahibi ve 5 servis çalışanına logoyu önce açıklamasız gösterin. “Nasıl okudun?”, “Ne sattığını düşündün?”, “Aklına hangi şirket geldi?” sorularını kaydedin. Sonra hikâyeyi okuyun ve tekrar sorun. Son i’nin doğru okunması, yedek parça çağrışımı ve Getir çağrışımını ayrı sütunlarda sayın. TÜRKPATENT benzerlik/tescil incelemesi ayrı bir uzmanlık işidir; bu paket tescil uygunluğu sonucu vermez.

## İletişimde doğruluk

Doğrulanmış kayıt olmadan otomatik/AI uyumluluk, puan, Trustpilot değerlendirmesi, stok adedi, indirim veya teslimat saati yayınlamayın. Akü distribütörlüğü dışında ürünlere yetkili satıcılık izlenimi vermeyin. Ürünler OEM, motor, model ve üretim bilgileriyle kontrol edilir. Kargo ve saha hizmetinin ilçe, saat ve ücretleri ticari olarak belirlenince yayınlanır.
