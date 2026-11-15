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

Eşleşenler listesi `?linked=manual` ("Bağlantı türü" seçimi ya da "Bağlı teklifler" başlığındaki süzgeç) ile yalnız elle bağlanmış teklifi olan gruplara daralır; `manualGroupsSql` (`method='manual'` kaynakların `product_offers.primary_id` değerleri) önbellekli grup dizini ile birlikte okunur, böylece `product_grouping_version` değişince ve işlem sonrası `forgetSameProducts` ile dizin gibi yenilenir (#611).

## Elle ürün düzenleme (override katmanı, #575)

`/yonetim/urunler/[id]` "Mağaza bilgileri" kartı ürünün mağaza adını, açıklamasını, kategorisini, SEO başlığı/açıklamasını ve görünürlüğünü elle belirler. Değerler ana ürüne (`products.id`) bağlıdır ve `db/product-overrides.sql`'deki ayrı tablolarda tutulur:

- `product_overrides`: ürün başına tek satır; `NULL` alan otomatik kaynaktan (tedarikçi kaydı, zenginleştirme) gelir, dolu alan onun yerine geçer. `hidden=true` ürünü her yerde satıştan kaldırır (mağaza, sepet, bayi API'si, bakım setleri). Tüm alanlar boşa dönünce satır silinir.
- `product_override_changes`: her kayıtta değişen her alan için eski/yeni değer, kim ve ne zaman (`NULL` = otomatik). "Otomatiğe dön" tek alanı `NULL`'a (görünürlükte yayına) çeker ve o da geçmişe yazılır.
- `commerce_item_overrides` (`db/commerce.sql`): ad, açıklama ve gizlilik değerlerinin tedarikçi satırı başına kopyası. Katalog görünümleri (`commerce_catalog`, `commerce_catalog_entries`, `storefront_catalog*`, `commerce_unavailable_items`) ana katalogdan önce kurulduğu için bu kopyayı okur. Kopyayı yalnız `product_overrides_project(ids)` yazar: kayıt sırasında, kurulumda (`db:setup`) ve `product_sources` üzerindeki üç deyim tetikleyicisiyle (`product_overrides_sources_*`; kurulum yalnız eksikse oluşturur, her kurulumda DROP/CREATE `product_sources`'u transaction boyunca kilitlerdi). Böylece eşleştirme yenilemesi, birleştirme, ayırma veya geri alma bir kaydı başka ürüne taşıdığında kayıt yeni ürününün düzenlemesini alır; düzenleme yoksa tetikleyici hemen döner.

Bu tablolara tedarikçi senkronları (`src/modules/suppliers/*-import.ts`), eşleştirme yenilemesi, zenginleştirme importu (`src/modules/enrichment/import.ts`), uyum yeniden kurulumu (`fitment-sync.ts`, `rebuild-product-fitments.ts`) ve mağaza paketi (`storefront-bundle-*`, `import-storefront-bundle.ts`) hiç yazmaz; elle değerler canlı panelde girilir ve yerel→AWS paket aktarımı onları ezmez (`npm run test:product-overrides` yapısal olarak denetler).

Mağaza okuma yolu: ürün sayfası adı düzenleme > zenginleştirme `displayName` > tedarikçi adı sırasıyla, açıklamayı aynı sırayla seçer; SEO alanları `generateMetadata`'ya, kategori kırıntı yoluna gider (`src/modules/store/product-overrides.ts`, `product-override-display.ts`). Arama düzenlenmiş adla da bulur (`overrideItemMatch`) ve bu satırları saklanan `search_doc` yerine görünüm sütunlarından sıralar. Kategori sayfası (`categoryProductIds`) düzenlenmiş kategoriyi otomatik kategorilerin yerine koyar. Ürün sayfası anında güncellenir; liste sayımları, kategori ve sayfa önbellekleri 10 dakikalık süreç önbelleğinden dolayı en geç 10 dakika içinde yenilenir.

Birleştirmede (ürün sayfası "Birleştir", eşleştirme sayfası "Aynı ürün" ve toplu birleştirme) eylem `product_merge`'ten hemen sonra `product_overrides_carry(source, target, actor)` çağırır: hedefin boş (`NULL`) alanları birleşen ürünün değerini alır, hedefte dolu alanlar korunur; gizlilik ise `kaynak.hidden OR hedef.hidden` olur (aynı fiziksel ürünü yönetici satıştan kaldırmıştı). Fonksiyon taşınan alanları ve gizliliğin taşınıp taşınmadığını döndürür; ürün sayfası birleştirme sonrası uyarı gösterir, eşleştirme sayfası "Aynı ürün" bildiriminde ve toplu birleştirme özetinde gizliliği hedefe taşınan ürün sayısını yazar. Taşınan her alan hedefin geçmişine (`reason='carry'`) ve `product_override_carries` kaydına yazılır. Birleştirme geri alınınca ("Geri al" → `product_reset_item` veya yenileme birleşen ürünü yeniden canlandırıp `merged_into`'yu temizleyince) `products` üzerindeki `product_overrides_products_restored` tetikleyicisi `product_overrides_uncarry`'yi çağırır: hedefte hâlâ taşınan değeri taşıyan alanlar otomatiğe (gizlilik yayına) döner ve geçmişe `reason='uncarry'` ile "Sistem: birleştirme geri alındı" olarak yazılır. Yöneticinin taşımadan sonra hedefte değiştirdiği alanlar kayıttan düşer ve geri alınmaz. Düzenleme birleştirilen ürünün kimliğinde de kalır; birleştirilmiş ürün sayfasında form gösterilmez. Ürün sayfası, düzenlenmiş bir üründe birleştirme ve ayırma bölümlerinde uyarı gösterir. Marka ve parça numarası bu dilimde düzenlenmez (zenginleştirme, logo ve süzgeçlerin kimlik anahtarı).

Bilinen sınırlar (gizlilik ve diğer düzenlemeler ürün düzeyinde tutulur, satır düzeyinde uygulanır):

- **Yeni tedarikçi satırı:** düzenlenmiş (ör. gizli) bir ürüne ait yeni bir tedarikçi satırı, bir sonraki `refresh_product_matches()` onu `product_sources`'a bağlayana kadar ürüne ait değildir; o arada mağazada kendi otomatik değerleriyle görünür ve satılabilir. Bağlandığı anda tetikleyici düzenlemeyi uygular (`test:product-overrides` bu davranışı belgeler).
- **Satırın ürün değiştirmesi:** yenileme bir otomatik satırı başka ürüne taşırsa (yeni marka takma adı vb.) veya satır "Ayır" ile ayrılırsa satır yeni ürününün düzenlemelerini alır; eski ürünün gizliliği ve adı onunla gitmez. Birleştirme bunun tek istisnasıdır (yukarıdaki taşıma).
- **Kategori:** elle kategori yalnız `categoryProductIds` okuyanları etkiler: mağazanın kategori sayfaları (`/katalog?category=`) ve bakım seti yuvaları (`maintenance-kit.server.ts`), ayrıca ürün sayfasındaki kırıntı yolu. Yönetim ürün listesindeki kategori süzgeci, ana sayfa sekmeleri ve kart kategori etiketleri (`home.ts`) otomatik (zenginleştirme) kategorilerini okumaya devam eder.
- **Yönetim ürün listesi:** `/yonetim/urunler` listesi ürün adını ve kategoriyi hâlâ tedarikçi/zenginleştirme verisinden gösterir; elle düzenlenenleri "Elle düzenlenen" ve "Mağazada gizli" süzgeçleri bulur, düzenlenmiş değerler ürün sayfasındadır.

### Görseller (#581)

`/yonetim/urunler/[id]` "Görseller" kartı ürüne elle görsel yükler, sıralar, siler ve otomatik (zenginleştirme) görselini mağazada gizler. Tablolar `db/product-override-images.sql`'dedir (kurulumda `product-overrides`'tan hemen sonra):

- `product_override_images`: ana ürün (`products.id`) başına yüklenen görseller; `media_id` → `product_media_objects` (sha256 ile tekil; nesne `admin/` önekiyle saklanır), `position` (en küçüğü ana görsel; ayrı bir `is_primary` sütunu yok), `width`/`height`, `file_name`, `carried_from` (birleştirmeyle gelen görselin kaynağı), `created_by`. Aynı görsel bir ürüne iki kez eklenmez (`UNIQUE(product_id,media_id)`).
- `product_override_image_settings`: satır yalnız "Otomatik görseli mağazada gizle" açıkken vardır (`hide_automatic`); `hide_carried_from` gizliliğin birleştirmeyle geldiği ürünü tutar.
- Geçmiş `product_override_changes`'a yazılır: `image_added` (yeni = dosya adı), `image_removed` (eski = dosya adı), `image_primary` (eski/yeni ana görselin dosya adı), `auto_image_hidden` (`'true'`/`NULL`).

Okuma sırası: ürün sayfası önce yüklenen görselleri sırasıyla, ardından gizlenmediyse otomatik görseli gösterir (aynı görsel bir kez; `galleryImages`, `src/modules/store/product-image-display.ts`). Kartlar, sepet, bayi API'si ve bakım setleri (`getCatalogProductImages`) ilk yüklenen görseli, yoksa gizlenmemiş otomatik görseli, o da yoksa bugünkü çizimi (PartArt) gösterir. Okuma istek anındadır: `product_sources` (PK) → `product_override_images` birleşimi (`src/modules/store/product-images.ts`); izdüşüm tablosu yoktur, katalog görünümleri değişmez. `getProductEnrichment().imagePath` otomatik görsel olarak kalır. `/api/product-media/<uuid>` yüklenen görselleri de sunar (`servableProductMedia`).

Yükleme: Server Action, çağrı başına bir dosya (istemci seçilen dosyaları sırayla gönderir, sonda `finishProductImageUpload` önbelleği bir kez yeniler); ham dosya en çok 8 MB ve 25 megapiksel, ürün başına en çok 12 görsel; sharp süreç başına tek görsel işler. Yalnız tek kareli JPEG/PNG/WebP, iki kenar da en az 200 px; sharp EXIF yönüne göre döndürür, 2000×2000 içine sığdırır (büyütmez), WebP (kalite 85) yazar, EXIF/GPS düşer (`src/modules/admin/product-image-upload.ts`). Nesne deposuna yazım ürün kilidinin dışında, satır ekleme ürün satırı kilitliyken yapılır (`product-image-store.ts`).

Birleştirme: eylemler `product_overrides_carry`'nin yanında `product_override_images_carry(source, target, actor)` çağırır. Hedefin hiç görseli yoksa birleşen ürünün görselleri `carried_from=source` ile kopyalanır; birleşen ürün otomatik görseli gizliyorsa ve hedef gizlemiyorsa gizlilik `hide_carried_from=source` ile taşınır; her ikisi geçmişe `reason='carry'` ile yazılır. Birleştirme geri alınınca (`merged_into` temizlenince) `product_override_images_products_restored` tetikleyicisi `product_override_images_uncarry`'yi çağırır: hâlâ taşınmış duran görseller ve gizlilik geri alınır (`reason='uncarry'`). Yönetici hedefte galeride herhangi bir değişiklik yaparsa (ekleme, silme, sıralama, gizleme) o ürünün tüm `carried_from`/`hide_carried_from` değerleri temizlenir: görseller artık onundur ve geri almada kalır.

Kararlar ve sınırlar:

- **Ortamlar arası aktarım yok:** yüklemeler yapıldıkları ortamda yaşar (kaynak AWS yönetim paneli). `products.id` ortamlar arasında farklı olduğundan mağaza paketi (#553) bu tabloları ne dışa aktarır ne içe alır; aktarım aracı yoktur (`test:product-override-images` yapısal olarak denetler).
- **Silme yalnız satırı kaldırır:** `product_override_images` satırı silinir; `product_media_objects` kaydı ve S3'teki baytlar kalır. Başka bir yükleme veya zenginleştirme kullanmıyorsa `/api/product-media` onu artık sunmaz. Kullanılmayan nesneleri toplama ayrı iştir (#597).
- **Tarayıcı önbelleği:** `/api/product-media` yanıtları `Cache-Control: public, max-age=86400` taşır; silinen veya gizlenen bir görsel, onu daha önce yüklemiş tarayıcıda (ve CDN'de) en çok 1 gün görünebilir.
- **Gizli ürünlerin görselleri:** mağazada gizli (`product_overrides.hidden`) bir ürünün yüklenen görselleri mağazada listelenmez, ama adresini bilen `/api/product-media/<uuid>` üzerinden açabilir; birleştirilmiş ürünlerin yüklemeleri ise sunulmaz.
- **Zincirleme taşıma:** A, B'ye birleşip görselleri B'ye taşındıktan sonra B de C'ye birleşirse C'deki kopyaların kaynağı B olur (`carried_from=B`); A→B birleştirmesini geri almak B'deki kopyaları kaldırır ama C'dekilere dokunmaz (onlar ancak B→C geri alınınca gider).

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
