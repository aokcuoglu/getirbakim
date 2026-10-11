# Tedarikçiler arası ürün eşleştirme

Başbuğ, Dinamik ve SETA aynı fiziksel ürünü farklı kod, marka yazımı ve önekle listeler. Bu katman aynı ürünleri gruplar, marka eşlemelerini inceletir ve SETA'nın muadil bağlantılarını tutar. **Mağazayı henüz etkilemez.** Karar (11 Ekim 2026): mağazada grup başına tek ürün ve en uygun tedarikçi teklifi gösterilecek. Bu adım Dinamik satışa açıldıktan sonra yapılacak. Takip: #144.

## Kimlik

Ürün kimliği = **(kanonik marka, parça no)**.

- **Parça no:** Başbuğ/Dinamik kodundan ilk kelime (tedarikçiye özgü marka öneki: `SCH` = SACHS, `MANN`, `PSA-E`) atılır, kalan harf/rakamlar büyük harfe çevrilir (`MANN W 712/95` → `W71295`). Başbuğ orijinal parçaları (`OE-*`) ve SETA kodları önek taşımaz, bütünü kullanılır. 4 karakterden kısa numaralar eşleşmeye girmez.
- **Marka anahtarı:** marka alanından (Başbuğ `uk`, Dinamik `marka`) yazım farkı ve `-AV` eki atılarak üretilir. Tüm orijinal parça etiketleri (`OE-PSA`, `IOE-HYU`, `PSA ORIJINAL`, `ORJINAL`, `OPAR`, `GM`) tek `ORIJINAL` ailesine girer; orada OEM numarası belirleyicidir.
- **Onaylı takma adlar** (`product_brand_aliases`) marka anahtarını kanonik markaya çevirir.

## Marka çifti incelemesi

Aynı parça no farklı tedarikçilerde farklı markayla geçiyorsa çift önerilir (en az 20 ortak numara). İnceleme birimi satır değil marka çiftidir. Ürün adı benzerliği (pg_trgm) yol gösterir: ölçümde gerçek eşlemeler %15–37, rastlantılar %2–5 çıktı.

| Karar | Anlamı | Etkisi |
| --- | --- | --- |
| Aynı marka | İki etiket aynı ürünü satar (M.MARELLI / MAGNETI MARELLI, MAHLE / MAHLE FILTRE) | Takma ad eklenir (çok kayıtlı marka kanonik olur); bir sonraki yenilemede gruplar birleşir |
| Muadil | Aynı numaralandırma, farklı ürün (CONTITECH / DAYCO kayış ölçüsü, EUROREPAR / ORIJINAL OEM numarası) | Kaydedilir; ileride muadil bağlantısı olarak kullanılacak |
| İlgisiz | Numaralar rastlantısal (FEBI / IBRAS) | Kaydedilir, tekrar önerilmez |

## Tablolar ve çalıştırma

`refresh_product_matches()` tek transaction'da yeniden kurar (~45 sn; `DELETE` kullanır, ekran yenileme sırasında eski sonuçları göstermeye devam eder): `product_match_items` (her güncel kayıt için marka/parça no/ad), `product_match_groups` (iki+ kayıtlı anahtarlar), `product_brand_pair_suggestions`, `product_references` (SETA rakip kodları ve OEM numaraları; aynı ürün değil muadil). Kararlar `product_brand_pair_decisions`, takma adlar `product_brand_aliases` tablosundadır ve yenilemede korunur.

```sh
npm run products:match     # yeniden eşleştir
npm run test:matching      # SQL yardımcıları (yerel DB)
```

Yönetim: `/yonetim/urun-eslestirme` (özet, marka çiftleri, ürün grupları, "Eşleştirmeyi yenile").

## İlk ölçüm (yerel, 11 Ekim 2026)

1,24 milyon kayıt → 96.335 grup; **91.787 tedarikçiler arası**, 4.548 tedarikçi içi tekrar. Başbuğ kayıtlarının %29'u, Dinamik'in %11'i başka tedarikçide de var. 231 marka çifti (73 güçlü benzerlik). 1.133 SETA ürününün muadil bağlantısı var. Yalnız MAGNETI MARELLI çiftinin onayı grup sayısını +1.634 artırıyor.

Bilinen sınırlar: Dinamik'in 386 bin kaydı yalnız fiyat listesinden gelir (ad yok); `oemListe`/`esdegerListe` boş; Dinamik `fiyat` alanının anlamı (KDV/liste) doğrulanmadı. Grup ekranındaki fiyatlar kaynak değerdir, dönüştürülmez.
