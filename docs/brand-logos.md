# Vitrin marka logoları

Ana sayfadaki iki slider ve `/arac-markalari` sayfası için araç markası logoları ile 48 üretici logosu `public/media/logos/` altında tutulur. `data/brand-logos.json` her dosyanın kaynak adresini, boyutlarını ve SHA-256 değerini kaydeder. Görsellerin dış boşlukları temizlenip 2x ekranlar için gösterim boyutunun iki katı kutulara sığacak WebP dosyaları oluşturulmuştur: araç markaları en fazla 184 × 84 px (`.make-tile-logo` 92 × 42), üreticiler en fazla 240 × 100 px (`.home-brand-logo` en büyük 120 × 50); logoların oranları ve renkleri korunur.

Araç logoları [VehicleSpecs marka koleksiyonundan](https://github.com/vehiclespecs/brand-logos) alınmıştır. KIA için güncel [Simple Icons vektörü](https://github.com/simple-icons/simple-icons/blob/develop/icons/kia.svg) kullanılır. VehicleSpecs'te olmayan markalar [car-logos-dataset](https://github.com/filippofilip95/car-logos-dataset) ve Wikidata'nın logo kayıtlarındaki Wikimedia Commons dosyalarından tamamlanmıştır; rozet fotoğrafı olan kayıtlar alınmamıştır. FORD AUSTRALIA/OTOSAN/USA ve MINI (GB) ana markanın logosunu kullanır. Logosu bulunamayan markalarda `/arac-markalari` adın ilk iki harfini gösterir.

Yeni araç logosu eklemek için marka adını (`vehicle_brands.display_name`) kaynak adresine eşleyen bir JSON dosyası hazırlanır ve `node --import tsx scripts/vehicle-logos.ts kaynaklar.json` çalıştırılır; script dosyayı indirir, kırpar, WebP'ye çevirir ve kaydı günceller. Wikimedia sık isteklerde uzun süreli 429 döndürür; script istekleri aralıklı yapar ve `Retry-After` süresini bekler. Üreticilerde mevcut Trodo kayıtları kullanılmış; eksikler üreticilerin siteleri, DRiV, Autodoc ve kayıt dosyasında belirtilen diğer kaynaklarla tamamlanmıştır. Marka logoları ilgili sahiplerine aittir ve markaları tanıtmak için gösterilir.

`storefront-logos.ts` yerel dosyaları döndürür. Üreticiler mevcut marka eş adı kurallarıyla eşleştirilir. `getManufacturerLogos` bilinen logoları yerelden, diğer üreticileri mevcut veritabanı kayıtlarından okur. Dosya adresindeki içerik sürümü eski görselin önbellekte kalmasını önler.

Araç kartlarında logo ve marka adı birlikte gösterilir. Üretici logoları sabit bir alana, kırpılmadan yerleştirilir. Slider okları logoları kapatmamak için sayfa göstergesi hizasına taşınmıştır.

## Yönetimden marka logosu (#819)

Üretici logosu üç kaynaktan gelir ve bir ana markanın tüm yazılışları (tedarikçi etiketleri ve ana marka adı) aynı logoyu gösterir:

1. **Elle logo** — `/yonetim/urun-eslestirme` → Markalar → marka düzenle penceresindeki "Logo" alanından dosya (PNG, SVG, WebP, JPEG; en çok 1 MB) yüklenir ya da adresten alınır. Adres SSRF korumalı `fetchRemoteImage` ile indirilir. Her logo `sharp` ile WebP'ye çevrilir (SVG rasterleştirilir; SVG dosyası hiç saklanmaz veya sunulmaz), kenar boşluğu kırpılır, saydamlık korunur ve en çok 640 × 288 px'e sığdırılır. Kayıt `brand_logos` tablosundadır (`db/product-matching.sql`) ve `/api/brand-logos/<marka id>?v=<sha256>` adresinden `image/webp` + `nosniff` ile sunulur. Tedarikçi senkronu, zenginleştirme ve vitrin paketi (`storefront:sync`) bu tabloya yazmaz; canlıda girilen logo ezilmez. Paket elle logoları taşımaz: canlıda girilen logo yalnız canlıda görünür. `brand_logos` mağazanın her sayfasındaki logo sorgusunda okunduğundan yayında `db:setup` uygulamadan önce koşmalıdır.
2. **Sitede hazır logo** — `data/brand-logos.json` + `public/media/logos/manufacturers/`.
3. **Zenginleştirme logosu** — `manufacturer_logos`.

Çözümleme (`getManufacturerLogos`): etiket önce ana markasına bağlanır (aynı adlı ana marka, yoksa etiketin en çok kayıtlı eşleşmesi). Ana markanın `brand_logos` satırı varsa o kazanır; satırda görsel yoksa ("Logoyu kaldır") marka logosuz görünür, otomatik logo da gösterilmez. Satır yoksa sırayla etiketin kendisi, ana marka adı ve markanın diğer etiketleri (çok kayıtlıdan aza) için önce hazır, sonra zenginleştirme logosu aranır; ilk bulunan gösterilir. Ana markası olmayan etiket yalnız kendi yazılışını dener. SVG'de canlı yazı (`<text>`), filtre, entity, 3000'den çok öğe, 16'dan çok `<use>`, 8'den çok `url(#…)` başvurusu veya iç içe `<mask>`/`<pattern>`/`<clipPath>` kabul edilmez (sunucuda yazı tipi yok; librsvg'nin işlemesi `sharp` zaman aşımıyla durmaz); tamamen saydam çıkan logo reddedilir. "Otomatik logoya dön" satırı siler. Ana markalar birleştirilince elle logo hedefe taşınır: hedefin kendi elle logosu varsa o kalır, hedefte yalnız gizleme kaydı varsa kaynağın gerçek logosu onun yerine geçer. Marka silinince logosu da silinir.

Markalar tablosundaki "Logo" filtresi ("Logosu olmayanlar") logosu eksik markaları kayıt sayısına göre listeler; eksikler buradan tek tek tamamlanır.

## Yeniden kodlama (#1029)

`src/modules/store/logo-encode.ts` `fitLogo` ile logoyu kutuya sığdırır; yeniden kodlama dosyayı büyütecekse sığdırılmaz (büyütmez, kutuya zaten sığanı olduğu gibi bırakır; ikinci geçiş kayıplı sıkıştırma eklemez).

- `npm run logos:reencode -- static`: `public/media/logos/**` ve `data/brand-logos.json` için kuru çalıştırma (varsayılan, yazmaz). `-- static --apply` dosyaları ve kayıt defterindeki width/height/sha256 değerlerini yazar.
- `npm run logos:reencode -- db`: yerel `manufacturer_logos` satırları için kuru çalıştırma (önce veritabanı sunucusu/adı yazılır). `-- db --apply` tek işlemde, eski sha256 korumasıyla günceller; `imported_at` değişmez.
- İkinci çalıştırma 0 değişiklik bildirir.
- Yeni içe aktarmalar (`scripts/vehicle-logos.ts`, `importManufacturerLogo`) aynı kutulara sığdırır.
- `/api/manufacturer-logos/[key]?v=` eski bir sürümle istenirse 404 yerine güncel logo `public, max-age=3600` ile döner.

### AWS yolu

1. Önce sürüm yayınlanır (statik dosyalar imajla gider).
2. Ardından yerelde `logos:reencode -- db --apply` ve `storefront:sync`; bunun için açık kullanıcı onayı gerekir.
3. Prod durumu salt-okunur tünelle `-- db` kuru çalıştırmasıyla kontrol edilir; yazma tüneliyle asla `--apply` çalıştırılmaz.
