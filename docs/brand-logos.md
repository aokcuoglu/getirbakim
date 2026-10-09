# Vitrin marka logoları

Ana sayfadaki iki slider ve `/automakers` sayfası için araç markası logoları ile 48 üretici logosu `public/media/logos/` altında tutulur. `data/brand-logos.json` her dosyanın kaynak adresini, boyutlarını ve SHA-256 değerini kaydeder. Görsellerin dış boşlukları temizlenip en fazla 320 × 144 px WebP dosyaları oluşturulmuştur; logoların oranları ve renkleri korunur.

Araç logoları [VehicleSpecs marka koleksiyonundan](https://github.com/vehiclespecs/brand-logos) alınmıştır. KIA için güncel [Simple Icons vektörü](https://github.com/simple-icons/simple-icons/blob/develop/icons/kia.svg) kullanılır. VehicleSpecs'te olmayan markalar [car-logos-dataset](https://github.com/filippofilip95/car-logos-dataset) ve Wikidata'nın logo kayıtlarındaki Wikimedia Commons dosyalarından tamamlanmıştır; rozet fotoğrafı olan kayıtlar alınmamıştır. FORD AUSTRALIA/OTOSAN/USA ve MINI (GB) ana markanın logosunu kullanır. Logosu bulunamayan markalarda `/automakers` adın ilk iki harfini gösterir.

Yeni araç logosu eklemek için marka adını (`vehicle_brands.display_name`) kaynak adresine eşleyen bir JSON dosyası hazırlanır ve `node --import tsx scripts/vehicle-logos.ts kaynaklar.json` çalıştırılır; script dosyayı indirir, kırpar, WebP'ye çevirir ve kaydı günceller. Wikimedia sık isteklerde uzun süreli 429 döndürür; script istekleri aralıklı yapar ve `Retry-After` süresini bekler. Üreticilerde mevcut Trodo kayıtları kullanılmış; eksikler üreticilerin siteleri, DRiV, Autodoc ve kayıt dosyasında belirtilen diğer kaynaklarla tamamlanmıştır. Marka logoları ilgili sahiplerine aittir ve markaları tanıtmak için gösterilir.

`storefront-logos.ts` yerel dosyaları döndürür. Üreticiler mevcut marka eş adı kurallarıyla eşleştirilir. `getManufacturerLogos` bilinen logoları yerelden, diğer üreticileri mevcut veritabanı kayıtlarından okur. Dosya adresindeki içerik sürümü eski görselin önbellekte kalmasını önler.

Araç kartlarında logo ve marka adı birlikte gösterilir. Üretici logoları sabit bir alana, kırpılmadan yerleştirilir. Slider okları logoları kapatmamak için sayfa göstergesi hizasına taşınmıştır.
