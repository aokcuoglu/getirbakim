# Ana sayfa tasarımı

7 Ekim 2026 tarihinde Trodo ana sayfası Chrome computer-use ile masaüstünde ve 393 px mobil görünümde incelendi. Ana sayfa, mevcut Getirbakim kimliği ve Türkçe içerikle bu düzeni kullanır: arama banner'ı, altı görselli ana kategori, kampanya slider'ı, kategori sekmeleri, kompakt ürün slider'ları, araç/üretici markaları, üç kategori koleksiyonu, tanıtım, bülten aboneliği ve footer.

`src/app/page.tsx` verileri sunucuda toplar. `src/styles/home.css` ana sayfaya özel stilleri içerir; ortak header/footer kuralları `catalog.css` içinde `.store-home` ve `.catalog-page` ile sınırlandırılmıştır. Kategori sekmelerine yalnızca kökler ve doğrudan çocukları aktarılır. Mobil slider'lar bir kampanya veya iki ürün; araç markaları üç, üreticiler dört sütun gösterir. Mobil footer grupları açılabilir.

Ürünler güncel tedarikçi kayıtlarıyla doğrulanmış, görseli bulunan zenginleştirmelerden seçilir; en fazla 24 ürün ve her koleksiyon için en fazla 24 kayıt okunur. Fiyatlar mevcut ticaret görünümünden, servis indirimleri mevcut hesaptan gelir. Fiyatı olmayan ürünlerde mevcut bekleme metni gösterilir. Aksesuar, el aletleri ve bisiklet koleksiyonlarında görselli ürün bulunmazsa gerçek alt kategori kartları gösterilir. Üretici logosu yoksa marka adı kullanılır. Trodo'ya ait indirim oranları, müşteri puanları ve teslimat vaatleri Getirbakim'e aktarılmadı.

Trodo'da gözlenen güncel görsellerden altı ana kategori ve on alt kategori görseli yerel depolamaya alındı. Kategori görselinin DB kaydı yeni medya kimliğiyle güncellendi; nesne uzunluğu ve SHA-256 değeri depolamada doğrulandı. Özellikle yanlış görseli olan bisiklet kategorisi düzeltildi. GATES, VALEO, INA, BLUE PRINT ve DELPHI logoları mevcut aynı marka/parça eşleşmesi kanıtıyla `manufacturer_logos` tablosuna eklendi.

## Tarayıcıdan indirilen kategori görsellerini içe aktarma

`scripts/import-category-image-files.ts` tarayıcıdan indirilmiş yerel dosyaları alır. JSON girdisi `categoryId`, `imageFile` ve `imageSource` alanlarını içerir:

```sh
node --env-file=.env.local --conditions=react-server --import tsx scripts/import-category-image-files.ts /path/to/category-images.json
```

HTTPS Trodo kaynak adresi, izin verilen 135/270/405 boyut yolu ve kategori ağacındaki dosya adı eşleşmelidir. Dosya boyutu/piksel sınırları uygulanır, WebP üretilir ve depolama doğrulandıktan sonra DB işlemi yapılır. Mevcut tarayıcı işçisi bu tasarım çalışmasında başlatılmadı.

## Doğrulama

Masaüstü 1175 px ve mobil 393 px görünümde yatay taşma olmadığı kontrol edildi. Mobil header 99 px, banner 288 px; masaüstü banner 280 px. Kategori sekmeleri, kampanya ve ürün slider'ı geçişleri, araç seçici ve OEM aramasının katalog sonuçlarına yönlenmesi kontrol edildi. Fren diskleri katalog sayfası 304 px sidebar ve önceki footer düzenini korur. TypeScript, hedeflenen ESLint kontrolleri ve üretim derlemesi başarılıdır.

## Bülten alanı

Alt banner, 340 px genişliğinde e-posta alanı, işaretsiz pazarlama izni kutusu, Abone ol butonu ve gizlilik bağlantısıyla kaynak görseldeki abonelik düzenini kullanır. `NewsletterSignup` ve `subscribeNewsletter` sunucu işlemi, doğrulanmış form girdisini `newsletter_subscriptions` tablosuna `pending` olarak kaydeder. Normalize edilmiş e-posta tekildir; tekrar başvuru mevcut onay kaydını değiştirmez. İzin metni/sürümü, talep zamanı ve kaynak birlikte saklanır. Honeypot ve kalıcı saatlik başvuru bütçesi bulunur.

Kurulum: `node --env-file=.env.local --import tsx scripts/migrate-newsletter.ts`. Doğrulama: `node --import tsx --test scripts/test-newsletter.ts`.

Bu akış e-posta göndermez. Gönderim hizmeti bağlandığında adres doğrulama, abonelikten ayrılma ve izin yönetimi akışları tamamlanmalıdır; bekleyen talepler doğrudan gönderim listesi değildir. Gizlilik ve KVKK sayfalarına fiilen saklanan bülten talebi alanları eklendi.
