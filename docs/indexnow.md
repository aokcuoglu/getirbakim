# IndexNow bildirimi (#645)

Mağazanın dizine açık ürün sayfalarından içeriği değişenler günde bir kez IndexNow'a toplu bildirilir. Paylaşımlı uç nokta (`https://api.indexnow.org/indexnow`) adresleri protokole katılan arama motorlarına (Bing, Yandex…) iletir. Google IndexNow kullanmaz; onun için site haritası (`/sitemap.xml`, #634) geçerlidir.

## Nasıl çalışır

- Kanca ya da kuyruk yok. `scripts/indexnow.ts` site haritasının 64 ürün parçasını **aynı SQL ölçütüyle** gezer (`indexableProductsSql`, `src/modules/seo/sitemap.server.ts`; #641 asgari içerik dahil).
- Her dizine açık ürün için bir içerik parmak izi hesaplanır ve `indexnow_urls` tablosundaki "son bildirilen durum" ile karşılaştırılır. Yalnız fark gönderilir; tablo yalnız başarılı gönderimden sonra yazılır.
- Sync, yönetici eylemleri, eşleştirme ve zenginleştirme koduna dokunulmaz: hepsinin sonucu aynı sorguda göründüğü için tek noktadan yakalanır. IndexNow hatası bu akışları bozamaz.

### Ne bildirilir

- Dizine yeni giren ürün (yeni ürün ya da asgari içerik eşiğini yeni geçen).
- Dizinden çıkan ürün: pasif, çelişkili, gizlenen, birleştirmeyle ikincil teklif olan, asgari içeriğini yitiren. Sayfa artık `noindex`, 404 ya da yönlendirme döner; motor yeniden tarayıp düşürür.
- Parmak izi değişen ürün: görünen ad, marka, parça no, açıklama, mağazada görünen OEM ve zenginleştirme içe aktarımı (`imported_at`: görsel, özellik, uyumluluk). Mağaza (`store_products`) satırlarında ad, marka, kod, açıklama.
- Adresi değişen ürün: eski ve yeni adres birlikte.

### Ne bildirilmez

Salt fiyat ya da stok değişimi. Her senkronizasyonda kataloğun büyük kısmı değişir; fiyat tazeliğini site haritasındaki `lastmod` taşır. Yönetici görseli/özelliği/referansı ve açıklamadan okunan model uyumluluğu henüz parmak izinde değil (takip işi).

### Korumalar

- Tek seferde tek koşu (`pg_try_advisory_lock(20261115,1)`); ikinci koşu `skipped` yazıp çıkar.
- Günlük adres bütçesi (`INDEXNOW_MAX_URLS`, varsayılan 50.000): bütçe dolunca koşu `partial` biter, sonraki koşu kaldığı parçadan sürer (`indexnow_runs.next_chunk`). Koşunun ilk parçası her zaman işlenir.
- Bir parçada bilinen (>100) sayfaların yarısından fazlası aynı anda dizinden çıkıyorsa koşu `failed` olur: yanlış ortam ya da yarım yüklenmiş katalog toplu "silindi" bildirimi üretmesin. Bilinçli toplu çıkış `--seed` ile kabul edilir.
- İstek başına en çok 10.000 adres, istekler arası 1 sn. 429/5xx/ağ hatası yeniden denenir (`Retry-After`, yoksa 5/30 sn); 400/403/422 kesin hatadır. Başarısız parçanın durumu yazılmaz, sonraki koşu yeniden gönderir.

## Komutlar

```bash
npm run seo:indexnow -- --dry-run          # ağ ve yazma yok; sayaçlar (her ortamda çalışır)
npm run seo:indexnow -- --dry-run --limit=0
npm run seo:indexnow                        # gönderir (yalnız APP_ENV=production + INDEXNOW_KEY)
npm run seo:indexnow -- --seed              # göndermeden mevcut durumu kaydeder
npm run seo:indexnow -- --limit=0           # bütçesiz tek koşu
npm run test:indexnow
```

Çıktı tek satır JSON'dur (`indexnow`: `completed | partial | failed | skipped | disabled`, sayaçlar, süre). Anahtar boşsa ya da `APP_ENV` production değilse `{"indexnow":"disabled",…}` yazar ve 0 ile çıkar. Çıkış kodu yalnız `failed`'da 1'dir. Koşu geçmişi `indexnow_runs` tablosundadır.

## Anahtar dosyası

`INDEXNOW_KEY` (8–128 karakter, `a-z A-Z 0-9 -`; üretmek için `openssl rand -hex 16`) `https://<site>/<anahtar>.txt` adresinde düz metin olarak sunulur: `next.config.ts` içindeki rewrite isteği `src/app/api/indexnow/[key]/route.ts`'e yönlendirir. Başka bir ad ya da boş anahtar 404 döner. Anahtar herkese açık bir değerdir; gizli tutulması gerekmez.

## İlk yayın

Tablolar `db:setup` ile boş kurulur. Üç seçenek:

1. **Varsayılan:** günlük 50.000 bütçeyle damla damla geri doldurma (~532 bin adres, ~11 gün).
2. **`--limit=0`:** tek koşuda tüm adresler (~64 istek, birkaç dakika).
3. **`--seed`:** hiçbir şey bildirmeden mevcut durumu kaydet; sonrası yalnız fark. Mevcut adresler site haritasından zaten taranıyor.

## AWS gereksinimleri

- `INDEXNOW_KEY` secret'ı hem `app` (anahtar dosyası) hem `operations` (komut) görevine verilir. `operations` görevinde `APP_ENV=production` ve `SITE_URL` de bulunmalı.
- İsteğe bağlı `INDEXNOW_MAX_URLS`.
- Zamanlama: EventBridge `getirbakim-production-indexnow`, günde bir 06:30 Europe/Istanbul (gece tedarikçi taramalarından sonra). `operations` görev tanımı, komut `node --conditions=react-server --import tsx scripts/indexnow.ts`. Çıkış 1 = alarm.
- Dışarı çıkış `api.indexnow.org:443`'e doğrudan; tedarikçi egress proxy'si kullanılmaz.
