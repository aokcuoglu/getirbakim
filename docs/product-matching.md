# Tedarikçiler arası ürün eşleştirme

Başbuğ, Dinamik ve SETA aynı fiziksel ürünü farklı kod, marka yazımı ve önekle listeler. Bu katman aynı ürünleri gruplar, marka eşlemelerini inceletir ve SETA'nın muadil bağlantılarını tutar. **Mağazayı henüz etkilemez.** Karar (11 Ekim 2026): mağazada grup başına tek ürün ve en uygun tedarikçi teklifi gösterilecek. Bu adım Dinamik satışa açıldıktan sonra yapılacak. Takip: #144.

## Kimlik

Ürün kimliği = **(kanonik marka, parça no)**.

- **Parça no:** Başbuğ/Dinamik kodundan ilk kelime (tedarikçiye özgü marka öneki: `SCH` = SACHS, `MANN`, `PSA-E`) atılır, kalan harf/rakamlar büyük harfe çevrilir (`MANN W 712/95` → `W71295`). Başbuğ orijinal parçaları (`OE-*`) ve SETA kodları önek taşımaz, bütünü kullanılır. 4 karakterden kısa numaralar eşleşmeye girmez.
- **Marka anahtarı:** marka alanından (Başbuğ `uk`, Dinamik `marka`) yazım farkı ve `-AV` eki atılarak üretilir. Tüm orijinal parça etiketleri (`OE-PSA`, `IOE-HYU`, `PSA ORIJINAL`, `ORJINAL`, `OPAR`, `GM`) tek `ORIJINAL` ailesine girer; orada OEM numarası belirleyicidir.
- **Onaylı takma adlar** (`product_brand_aliases`) marka anahtarını kanonik markaya çevirir.

## Marka çifti kararları (arşiv)

Ortak parça numarası/barkod üzerinden marka çifti önerisi ve "Benzer marka önerileri" sekmesi, tüm ana markalar elle incelendikten sonra kaldırıldı (#218). Marka birleştirme artık Markalar sekmesindeki düzenleme dialog'undan yapılır. Önceden verilmiş kararlar `product_brand_pair_decisions`'ta durur ve yenilemede uygulanmaya devam eder: "muadil" kararları ortak numaralı ürünleri birbirine muadil bağlar (`product_equivalents`, kind `brand`).

## Yeni markalar (#469)

Tedarikçiden ilk kez gelen marka etiketi yenilemede `sync_supplier_brands()` ile yerleşir: aynı anahtarlı bir etiket varsa onun ana markasına, yoksa yeni ana markaya (`method='auto'`). Akış:

1. **Otomatik yenileme.** Tedarikçi zamanlayıcısı (`scripts/sync-suppliers.ts`, zamanlanmış turlar) son yenilemeden beri tedarikçi kaydı değiştiyse ve son yenileme `PRODUCT_MATCH_INTERVAL_HOURS` (varsayılan 6, `0` = kapalı) saatten eskiyse tur sonunda `refresh_product_matches()` koşar (~1–2 dk). Elle tetiklenen (`--force`) turlar yenilemez. Başarısız yenileme önceki sonuçları korur ve log'a `productMatch: "failed"` yazar; tur başarısız sayılmaz.
2. **Birleştirme önerisi.** Yenileme, tüm etiketleri otomatik olan (yeni) ana markalar için `brand_merge_suggestions`'ı yeniden kurar. Kanıt sırası: anahtar/ad öneki (`KRAFTVOLL AKS` → `KRAFTVOLL`, en uzun önek), 5+ karakterli parça numaralarının en az 3'ü ve yarısı ortak, ad benzerliği (`pg_trgm` ≥ 0,4). Hedef incelenmiş markalardır; aynı turda gelen başka bir yeni marka yalnız anahtarı bu markanın daha kısa öneki ise hedef olur (`PRESTOLITE AV` → `PRESTOLITE`, tersi değil; #471), incelenmiş hedef önce gelir. `ORIJINAL` hedef olmaz. Yerel ölçüm: daha önce elle birleştirilen 154 etiketin 148'i doğru markaya önerilir; ayrı olduğu onaylanmış 598 markanın 95'ine öneri çıkar (19'u parça no, kalanı ad benzerliği).
3. **İnceleme.** `/yonetim/urun-eslestirme` → Markalar → Bekleyen: yeni markalar "Yeni marka" rozetiyle, öneri "Benzer: X · kanıt" satırıyla görünür. "X ile birleştir" `brand_merge` çağırır; "Onayla" markayı ayrı tutar ve öneri kalkar. Kararlar ürünlere bir sonraki yenilemede yansır.
4. **Uyarı.** Bekleyen ana marka sayısı kenar çubuğunda "Ürün eşleştirme"nin yanında ve genel bakışta "Onay bekleyen marka" olarak görünür.

## Tablolar ve çalıştırma

`refresh_product_matches()` tek transaction'da yeniden kurar (~45 sn; `DELETE` kullanır, ekran yenileme sırasında eski sonuçları göstermeye devam eder): `product_match_items` (her güncel kayıt için marka/parça no/ad), `product_match_groups` (iki+ kayıtlı anahtarlar), `product_references` (SETA rakip kodları ve OEM numaraları; aynı ürün değil muadil). Kararlar `product_brand_pair_decisions`, takma adlar `product_brand_aliases` tablosundadır ve yenilemede korunur.

```sh
npm run products:match     # yeniden eşleştir
npm run test:matching      # SQL yardımcıları (yerel DB)
```

Yönetim: `/yonetim/urun-eslestirme` (özet, marka çiftleri, ürün grupları, "Eşleştirmeyi yenile").

## İlk ölçüm (yerel, 11 Ekim 2026)

1,24 milyon kayıt → 96.335 grup; **91.787 tedarikçiler arası**, 4.548 tedarikçi içi tekrar. Başbuğ kayıtlarının %29'u, Dinamik'in %11'i başka tedarikçide de var. 231 marka çifti (73 güçlü benzerlik). 1.133 SETA ürününün muadil bağlantısı var. Yalnız MAGNETI MARELLI çiftinin onayı grup sayısını +1.634 artırıyor.

Bilinen sınırlar: Dinamik'in 386 bin kaydı yalnız fiyat listesinden gelir (ad yok); `oemListe`/`esdegerListe` boş; Dinamik `fiyat` alanının anlamı (KDV/liste) doğrulanmadı. Grup ekranındaki fiyatlar kaynak değerdir, dönüştürülmez.
