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

## Ürün önerileri ve toplu birleştirme (#524)

Otomatik anahtarın kaçırdığı olası aynı ürünler `product_match_candidates`'a üç nedenle düşer: kod ön eki farkı (`prefix`, ör. CONTITECH `CT 978K1` ↔ `978K1`), baştaki sıfır farkı (`leading_zero`) ve son ek farkı (`suffix`). "Tümünü birleştir" yalnız `prefix` ve `leading_zero` için ve bir marka süzülüyken görünür; kural tek yerde, `src/modules/admin/product-matching-sql.ts` içindeki `bulkAcceptableSql`'dedir (sayaç, eylem ve testler aynı parçayı kullanır). Toplu birleştirmede tanımı farklı (`name_conflict`), Dinamik ürünü birden çok Başbuğ ürününe önerilen ("Birden çok eş") ve Başbuğ ürününe farklı kodlu birden çok Dinamik ürünü önerilen ya da zaten bağlanmış ("Birden çok kod") öneriler atlanır ve tek tek karar bekler. Son ek farkı hiç topluca birleştirilmez: fazladan hane veya ek çoğu zaman farklı parçadır (FEBI `100261` ↔ `1002610`…`1002619`). 2026-11-14 denetiminde elle birleştirilen 1.281 eşleşmenin 91'i yanlış çıktı; çoğu son ek farkıydı.

**Son ek kuralları (#534).** Bilinen farklı parça desenleri son ek önerisi olarak hiç üretilmez. Kurallar `db/product-matching.sql` içinde iki fonksiyondadır: `product_suffix_rules()` (marka anahtarı veya `*`, kısa numaranın deseni, ekin deseni, karar) ve `product_suffix_verdict(marka, numara, numara)` — biri diğerini uzatmıyorsa `NULL`, yoksa `different` (önerilmez), `same` (önerilir, topluca birleştirilebilir, #535) veya `review` (önerilir, elle karar verilir; hiçbir satır tutmazsa varsayılan). Çakışan satırlar belirlenimli çözülür: önce marka satırları `*`'dan önce gelir; aynı kapsamda `different` > `review` > `same` (güvenlik önce); eşitlikte satır sırası (`WITH ORDINALITY`). Bu yüzden bir marka `same` satırı `*` `different` satırını ezer (STONE `1`). Marka satırları kanonik marka anahtarını (`products.brand`) kullanır; bir marka anahtarı birleştirilir veya yeniden adlandırılırsa satırı da güncelleyin. `refresh_product_matches()` `different` çiftleri atlar, `db:setup` daha önce yazılmış böyle adayları siler. Kurallar:

- `*`: rakamla biten numaraya tek hane eki (FEBI `100261` ↔ `1002610`, TRW `GDB328` ↔ `GDB3281`, MANN `/1`).
- `*`: yalnız rakamdan oluşan numaraya 2–3 hane eki (ORIJINAL `425270` ↔ `42527025`).
- OSRAM `…nHB` (ikili kutu), DAYCO `KPV…HD`, DAYCO/GATES `…SF`, SILBAK harfle biten numaraya `2`, CONTITECH `…PKnnn` ↔ `…Kn`.

Ölçüm (yerel, 2026-11-14; tamamı karara bağlanmış 438 son ek çifti, 240 farklı / 198 aynı):

| Kural | Farklı | Aynı |
| --- | ---: | ---: |
| Tek hane eki (G1) | 186 | 3 |
| Rakam numaraya 2–3 hane (G2) | 5 | 0 |
| OSRAM `nHB` | 10 | 0 |
| DAYCO `KPV…HD` | 5 | 0 |
| DAYCO/GATES `SF` | 2 | 0 |
| SILBAK `2` | 4 | 0 |
| CONTITECH `Kn` | 1 | 0 |
| **Toplam** | **213** | **3** |

İsabet %98,6; farklı çiftlerin %88,8'i engellenir. Belirsiz desenler bilerek öneride (`review`) bırakıldı: DAYCO/GATES `xPK…HD` (4 farklı / 6 aynı), RAPRO harf ekleri, VW indeks harfleri gibi. Yeni desen = `product_suffix_rules()`'a bir satır + `scripts/test-product-matching.ts`'e test.

**Güvenli ekler ve toplu birleştirme (#535).** İncelenmiş güvenli ek desenleri `same` satırlarıdır; bu son ek önerileri "Tümünü birleştir" sayısına girer (`bulkAcceptableSql`: `c.reason='suffix' AND product_suffix_verdict(a.brand,a.part_number,b.part_number)='same'`, ayrıca tanımı farklı / birden çok eş / birden çok kod olanlar yine atlanır). `acceptCandidates` aynı SQL kuralını uygular; form yalnız marka ve nedeni taşır. Listede yalnız gerçekten topluca birleştirilecek satırlar "Güvenli ek" rozetini taşır, düğme "Güvenli olanları birleştir (N)" der; kalan son ek önerileri tek tek karar bekler. `scripts/test-product-matching.ts` yerelde farklı denmiş hiçbir çiftin `same` almadığını da denetler. Satırlar (yerel ölçüm 2026-11-14, karara bağlanmış çiftler, hiçbiri farklı değil):

| Marka | Kısa numara | Ek | Aynı | Farklı |
| --- | --- | --- | ---: | ---: |
| ORIJINAL (Ford renk) | Ford biçimi `KK21R19952BB` + `5YZ` | `9` | 6 | 0 |
| ORIJINAL (Ford renk) | Ford biçimi `BM51F31148AF` + `3JA` | `6` | 2 | 0 |
| MAYSAN | `PN/PS/N/S` + 7 hane | `MM`, `WM`, `PM` | 57 | 0 |
| KENTPAR | `nnnTnnn` | `01` | 18 | 0 |
| GMB | `GHnnnnn` | `M`, `T`, `A` | 12 | 0 |
| STONE | rakamla biten | `1` | 9 | 0 |
| OSRAM | herhangi | `1BL` | 7 | 0 |

STONE'da `4` eki farklı çıktı (1 çift) ve `*` kuralında kalır. OSRAM `2BL`…`9BL` çoklu blister paketidir ve `nHB` gibi `different` satırıdır: Dinamik tekli ve `-2BL` ürünü ayrı ve 2,2–2,9 kat fiyatla satar (ör. 5007ULT 38,08 TL, 5007ULT-2BL 96,88 TL; adlarında "(IKILI AMBALAJ)"); yerelde aynı denmiş 4 `2BL` kararı (5007ULT, 5008ULT, 7506ULT, 7528ULT) bu yüzden yanlıştır. SKF `VKJA…` + `G` kararlarda 9 aynı / 0 farklı çıksa da güvenli sayılmadı ve `review` kalır: Başbuğ fiyat listesinde ayrı satılan 8 çiftin 2'si çok farklı fiyatlı (VKJA3028 46,28 / VKJA3028G 18,09 EUR; VKJA8015 43,50 / VKJA8015G 20,88 EUR). Yeni güvenli desen = ölçüm (0 farklı, makul n) + `same` satırı + test.

## Eşleşenler: tek teklifi ayırma ve elle kararlar (#523)

Eşleşenler tablosunda gruptaki her bağlı teklifin (birincil Başbuğ satırı hariç) kendi "Ayır" düğmesi vardır; yalnız o kayıt gruptan çıkar (`product_split_offer(item, expected_primary, actor)`): elle birleştirilmiş bir kayıt kendi anahtarının ürününe döner (`product_reset_item`), anahtarıyla gruplanmış bir kayıt kilitli yeni bir varyant olur (`product_split_item`). Her iki durumda çift `product_match_decisions`'a "different" yazılır ve tekrar önerilmez; form, gösterildiği grubun birincil kaydını (`expected_primary` = `product_offers.primary_id`) taşır; kayıt artık o grubun birincil olmayan teklifi değilse (yenileme, başka bir yönetici veya önceki bir tıklama onu taşıdıysa) bayat form hiçbir şey değiştirmez ve "Ayrılamadı" uyarısı çıkar. "Satıştaki teklif" süzgecindeki **Elle kararlar** görünümü (`scope=manual`; eski `scope=split` bağlantıları da açılır) tüm `method='manual'` kaynakları sayfalı listeler: karar türü (Birleştirme / Ayırma), tedarikçi kaydı, bağlı ürün ve tarih; arama kelime kelimedir ve her kelime tutmalıdır ("FEBI 100261" = FEBI markalı 100261): bir kelime tedarikçi kodunda veya parça noda (sıkıştırılmış), ya da kaydın adı, ürünün markası ve adında (`search_normalize`) geçebilir. Liste başlıktan sıralanır ve "Geri al" kaydı kendi anahtarının ürününe döndürür; geri alınan bir birleştirme, önceden karar satırı olmasa da `product_match_decisions`'a "different" (product_a = birleştirildiği ürün) yazılır ve çift tekrar önerilmez (#551); aday üretimi kararı iki yönde de arar, ürün sayfasından yapılan birleştirme aday sırasına (a = Başbuğ/API tarafı, b = katılan) uymasa da geçerlidir.

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
