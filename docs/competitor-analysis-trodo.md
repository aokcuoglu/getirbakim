# Rakip Analizi: Trodo.com

> **Amaç:** getirbakim'in birincil rakibi olarak görülen [trodo.com](https://www.trodo.com/)'un güçlü yanlarını —
> özellikle (1) kategoriler arası hızlı geçiş, (2) ürün listeleme sayfası, (3) ürün detay sayfası —
> analiz etmek ve bunları getirbakim'in **mevcut** uygulamasıyla karşılaştırıp somut iyileştirme adımları çıkarmak.
>
> **Tarih:** 2026-07-13 · **Kapsam:** UX / ürün / ön yüz mimarisi

---

## 1. Özet (TL;DR)

**Trodo neyi iyi yapıyor?**
- **Anlık kategori geçişi:** kategori tıklamalarında sayfa "yeniden yüklenmiyor" hissi — agresif prefetch + client-side içerik takası.
- **Zengin, TecDoc-beslemeli listeleme:** kartlarda marka logosu, OE/ürün no, stok/teslimat, fiyat; sol tarafta marka + fiyat + **teknik kriter** ve **araç uyumu** facet'leri.
- **Derin detay sayfası:** teknik özellik tablosu, OE numaraları, **çapraz-referans / muadil parçalar**, **uyumlu araçlar** (genişleyebilir), teslimat tahmini, yorumlar.
- **SEO-dostu düz URL:** `/oil-filters`, `/oil-filter-valeo-586506`.

**getirbakim nerede güçlü?**
- Kategori hız altyapısı **zaten büyük ölçüde mevcut** ve iyi kurgulanmış: SPA-benzeri shell, prefetch, in-memory cache, filtrede liste boşalmama (`keepPreviousData`).
- Detay sayfasında sağlam teknik temel: JSON-LD `Product`, ISR, iyi metadata, galeri, özellik tablosu, OEM çipleri, araç uyum listesi.

**getirbakim'de en yüksek getirili boşluklar (öncelik sırası):**
1. **Detay: çapraz-referans / muadil ürünler ve ilgili ürünler yok** — dönüşüm ve sepet büyüklüğü için en kritik eksik.
2. **Detay: OEM kodları ve araç uyum satırları tıklanamaz** — "bu OEM'e uyan ürünler" / "bu araca uyan parçalar" gezintisi yok.
3. **Listeleme: OEM / araç-uyumu / teknik-kriter facet'leri yok** — sadece marka + stok (+ aramada fiyat/kategori).
4. **Detay: breadcrumb minimal ve linksiz; sekme/akordeon ve yorum yok.**
5. **Hız: ince ayar** — prefetch kapsamı, iskelet tutarlılığı, algılanan gecikme.

---

## 2. Metodoloji ve kaynaklar

> **Şeffaflık notu — önemli:** Bu analiz hazırlanırken trodo.com sayfaları **doğrudan taranamadı**.
> Site **Cloudflare bot koruması + CAPTCHA** arkasında; denenen tüm otomatik erişim yolları
> (WebFetch, `curl` + gerçekçi User-Agent, Wayback Machine/`web.archive.org`, `r.jina.ai` reader-proxy)
> **HTTP 403 / "Just a moment…" CAPTCHA** döndürdü. Ekran görüntüsü/HTML seviyesinde doğrulama yapılamadı.

Analiz bu üç kaynağa dayanır:

1. **Web araştırması** — Trustpilot değerlendirmeleri, kategori/ürün arama sonuçları, TecDoc ekosistem bilgisi (bkz. [Kaynaklar](#9-kaynaklar)).
2. **TecDoc tabanlı B2C parça mağazalarının bilinen UX kalıpları** — Trodo bir TecDoc mağazasıdır; TecDoc kataloğu araç seçici (make/model/motor, VIN, plaka/VRM), OE çapraz-referans ve teknik kriter facet'lerini standart olarak sağlar.
3. **getirbakim kod tabanının kendisi** — kod zaten "Trodo-style" navigasyon yorumları
   (`hooks/use-instant-category-navigation.ts`), `TrodoCategory` tipleri ve `getDbrandsMatch` gibi yapılarla
   Trodo'nun kalıplarını yakından örnek alıyor; bu, Trodo davranışını çapraz-doğrulamak için güçlü bir ikincil kaynaktır.

> **"(çıkarım)" etiketi:** Trodo'ya özgü, doğrudan doğrulanamayan iddialar aşağıda **(çıkarım)** ile işaretlenmiştir.
> Bu maddeler TecDoc-mağaza kalıplarından ve dolaylı kaynaklardan türetilmiştir; canlı sitede teyit edilmeleri önerilir.

---

## 3. Trodo genel bakış

- **İş modeli:** TecDoc kataloğu üzerine kurulu çok-ülkeli online yedek parça perakendecisi (Baltık kökenli; `.com`, `.se` vb. alan adları). Milyonlarca SKU; Bosch, Brembo, ATE, Denso, Mann-Filter, Monroe, Lemförder, Febi, Valeo gibi markalar.
- **URL yapısı (doğrulandı — kullanıcı örnekleri):** kısa, düz, SEO-dostu slug'lar.
  - Kategori: `trodo.com/oil-filters`
  - Ürün: `trodo.com/oil-filter-valeo-586506` (kategori + marka + parça-no deseni)
  - Locale/dil alt yollar yerine ayrı alan adlarıyla (çıkarım).
- **Araç seçici / "Garaj":** make → model → motor kademeli seçim; ayrıca VIN ve plaka (VRM) ile arama; seçilen araç oturum boyunca hatırlanır ve listeleme/detayda "aracınıza uyuyor" göstergesi olarak kullanılır **(çıkarım — TecDoc standardı)**.
- **Güven sinyalleri:** 30 gün iade; Visa/Mastercard/Maestro + PayPal; çok kanallı destek (telefon/e-posta/canlı sohbet); hızlı kargo vurgusu (kaynak: Trustpilot/inceleme siteleri).

---

## 4. Odak 1 — Kategoriler arası hızlı geçiş

### Trodo tarafı
- Kategori tıklamalarında tam sayfa yenilenmesi hissi yok; içerik anlık takas ediliyor, alt kategoriler hemen açılıyor **(çıkarım — kullanıcının gözlemi + TecDoc-mağaza SPA kalıbı)**.
- Muhtemel teknik kalıp: link üzerine gelince prefetch, client-side içerik takası, iskelet/placeholder ile algılanan gecikmenin gizlenmesi.

### getirbakim'de karşılığı — **zaten güçlü**
- `app/[locale]/[...slug]/_components/CategoryPageShell.tsx` — client-side SPA shell; `/api/category-page?href=…` payload'ını **in-memory cache**'ler (`cacheRef`), uçuştaki istekleri deduplike eder (`inflightRef`), içeriği `startTransition` içinde takas eder, URL'i `history.pushState` ile günceller — kategori tıklamasında **tam App Router navigasyonu yok**. `popstate` ile ileri/geri desteği var.
- `OptimizedCategoryLink` (`app/[locale]/[...slug]/_components/CategoryContent.tsx` içinde) — `mouseenter` / `touchstart` / `pointerdown` olaylarında hem `router.prefetch` hem shell prefetch tetikliyor.
- `hooks/use-instant-category-navigation.ts` — "çocukları hemen genişlet, navigasyonu bloklamadan yap" (kodda birebir "Trodo-style" yorumu).
- Filtre/sıralama/sayfa değişimi App Router navigasyonu tetiklemez; React Query `keepPreviousData` ile liste asla boşalmaz. Leaf kategori ilk sayfası **SSR + hydrate** (dehydrate/hydrate) edildiğinden ilk boyama iskelet değil, ürünlerle gelir.

### Fark tablosu

| Boyut | Trodo | getirbakim | Durum |
|---|---|---|---|
| Client-side içerik takası | Var (çıkarım) | Var (`CategoryPageShell`) | ✅ Eşit |
| Hover/touch prefetch | Var (çıkarım) | Var (`OptimizedCategoryLink`) | ✅ Eşit |
| In-memory payload cache | Var (çıkarım) | Var (`cacheRef`) | ✅ Eşit |
| Filtrede liste boşalmama | Var (çıkarım) | Var (`keepPreviousData`) | ✅ Eşit |
| İskelet/algılanan gecikme tutarlılığı | Cilalı (çıkarım) | İyi ama karışık (route `loading.tsx` + kart iskeleti + spinner + overlay) | 🟡 İnce ayar |

### Öneriler (ince ayar — hız zaten iyi)
- **İskelet tutarlılığı:** initial-load spinner'ı ile `ProductCardSkeleton`/route `loading.tsx` arasındaki geçişleri tek bir görsel dile indir; "spinner → iskelet → içerik" sıçramasını azalt.
- **Prefetch kapsamını ölç:** viewport'a giren kategori linklerini `IntersectionObserver` ile ön-prefetch etmeyi değerlendir (yalnız hover değil), fakat istek sayısını sınırlı tut.
- **Alt kategori açılışını** görsel olarak "anında" hissettir: içerik gelene kadar mevcut listeyi soluklaştırıp üstte ince bir progress bar göster (hard blank yerine).

---

## 5. Odak 2 — Ürün listeleme sayfası (ör. `/oil-filters`)

### Trodo tarafı
- **Kart içeriği:** marka logosu, ürün görseli, başlık, OE/ürün numarası, stok + teslimat süresi, fiyat, sepete ekle; seçili araç varsa "aracınıza uygun" rozeti **(çıkarım)**.
- **Facet sidebar:** marka/üretici, fiyat aralığı, **TecDoc teknik kriterleri** (ör. yükseklik, dış çap, filtre tipi), **araç uyumu** ve stok **(çıkarım — TecDoc standart facet seti)**.
- **Sıralama:** popülerlik/fiyat/isim; **breadcrumb** ve kategori altında **SEO metni**.
- **URL:** `trodo.com/oil-filters` — kısa, kategori-slug bazlı.

### getirbakim'de karşılığı
- **Rotalar:** `app/[locale]/[...slug]/page.tsx` (kategori; ilk sayfa SSR + hydrate, `revalidate = 3600`), `app/[locale]/search/` (Meilisearch faceted arama), `app/[locale]/b/[slug]/` (marka listeleme).
- **Kartlar:** `app/[locale]/[...slug]/_components/ProductCard.tsx` (liste) ve `GridProductCard.tsx` (grid); ortak durum `lib/product-card-state.ts`, i18n `lib/product-card-i18n.ts`. Kart içeriği zengin: marka logosu, görsel (`SafeImage` + fallback), ad, ürün no, EAN/OEM kodları, teknik özellikler, stok, teslimat tarihi, fiyat (KDV dahil), adet + sepete ekle **veya** fiyat yoksa `CustomerRequestDialog` ("fiyat sor / uygunluk doğrula"), karşılaştırmaya ekle.
- **Facet sidebar:** `components/search/SearchSidebar.tsx` — kategori sayfasında **marka + stok**; arama sayfasında ayrıca **fiyat + kategori**. Disjunctive faceting, facet sayaçları mevcut.
- **Görünüm:** liste/grid geçişi (`localStorage('categoryViewMode')`), sıralama (popülerlik/fiyat-artan/fiyat-azalan/isim), sayfa başına 24/48 (arama 24/48/96), klasik sayfalama (`components/ui/Pagination.tsx`).

### Fark tablosu

| Özellik | Trodo | getirbakim | Öncelik |
|---|---|---|---|
| Zengin kart (marka/OE/stok/fiyat/teslimat) | Var | Var | ✅ Eşit |
| Marka facet | Var | Var | ✅ |
| Fiyat facet | Var | Var (masaüstü kategori + arama; ~~mobil eksikti~~ → eklendi) | ✅ |
| **Araç-uyumu (fitment) facet** | Var (çıkarım) | **Yok** | 🔴 Yüksek |
| **OEM/OE numarası facet** | Var (çıkarım) | **Yok** | 🔴 Yüksek |
| **TecDoc teknik kriter facet'leri** | Var (çıkarım) | **Yok** | 🟠 Orta |
| Sıralama seçenekleri | Var | Var | ✅ |
| Breadcrumb + SEO metni | Var | Var (`BreadcrumbSection`, `CategorySeoContent`) | ✅ |
| Sonsuz kaydırma opsiyonu | — | Yok (klasik sayfalama) | 🟢 Düşük |

### Öneriler
- 🔴 **Araç-uyumu facet'i:** seçili araç (Garaj/`PartFinder`) varken listeyi "aracıma uyanlar" ile daraltan bir facet ekle. Veri zaten var: `part_vehicle_types` + `getPartsForVehicle`. Sidebar'a `SearchSidebar` `extraSections` ile eklenebilir.
- 🔴 **OEM/OE facet veya hızlı arama kutusu:** kartlarda `oemCodes` zaten gösteriliyor; sidebar'a "OE numarasına göre daralt" alanı ekle. Meilisearch tarafında OEM'i filtrelenebilir attribute yap.
- 🟠 **TecDoc teknik kriter facet'leri:** `product_properties` verisinden kategori-bağlamlı en ayırt edici 3-5 kriteri (ör. yağ filtresinde çap/yükseklik/tip) facet olarak üret.
- 🟠 **Kategori sayfasında fiyat facet'i:** `useCategorySearch` filtreleri fiyat min/max destekliyor; sidebar'da bu bölümü kategori sayfasında da göster (şu an yalnız arama sayfasında).
- 🟢 **Sonsuz kaydırma:** mobilde opsiyonel "daha fazla yükle"; SEO için sayfalamayı koru.

---

## 6. Odak 3 — Ürün detay sayfası (ör. `/oil-filter-valeo-586506`)

### Trodo tarafı
- **Galeri** + alış kutusu (başlık, marka, OE no, fiyat/KDV, stok, teslimat tahmini, adet, sepete ekle).
- **Teknik özellik tablosu** (TecDoc kriterleri).
- **OE numaraları listesi** + **çapraz-referans / muadil (analog) parçalar** — aynı işlevi gören alternatif markalar/ürünler **(çıkarım — TecDoc standardı; dönüşüm için kritik)**.
- **Uyumlu araçlar** bölümü — make/model/motor kırılımıyla, genişleyebilir liste **(çıkarım)**.
- Çapraz-satış / ilgili ürünler, yorumlar, teslimat/iade güven sinyalleri **(çıkarım)**.

### getirbakim'de karşılığı
- **Rota:** `app/[locale]/urun/[slug]/page.tsx` + `_components/CatalogProductDetail.tsx`; veri `getCatalogProductBySlug` (`lib/actions/catalog-store.ts`). ISR 300s, **JSON-LD `Product`** (sku/brand/offer/availability), iyi metadata + OpenGraph.
- **Gösterilenler:** galeri (ana görsel + thumbnail şeridi), alış kutusu (marka logosu/adı, `h1` ad, SKU, stok badge IN_STOCK/SUPPLYABLE/unavailable, stok adedi, fiyat "KDV dahil", teslimat satırı, adet 1–99, sepete ekle, teklif sayısı), **OEM kod çipleri**, **özellik tablosu** (`product_properties`), **EAN** çipleri, **araç uyum listesi** (`vehicleLabel()` ile, 80 satıra kadar + "+N daha").

### Boşluklar
- ❌ **Çapraz-referans / muadil ürün yok** (OE numarası eşleşen alternatif ürünlere köprü yok).
- ❌ **İlgili / alternatif / "birlikte alınanlar" yok.**
- ❌ **OEM kodları tıklanamaz** — chip'ler yalnız hover `title` gösteriyor; "bu OEM'e uyan ürünler" sayfasına gitmiyor.
- ❌ **Araç uyum satırları tıklanamaz** — düz metin; ilgili araç sayfasına/parça listesine link yok, make/model gruplaması yok.
- ❌ **Sekme/akordeon yok** (her şey düz yığılı); ❌ **yorum yok**; ⚠️ **breadcrumb minimal** (marka/kategori, linksiz — `CatalogProductDetail.tsx`).

### Fark tablosu

| Özellik | Trodo | getirbakim | Öncelik |
|---|---|---|---|
| Galeri + alış kutusu | Var | Var | ✅ |
| Teknik özellik tablosu | Var | Var (`product_properties`) | ✅ |
| OE numaraları | Var | Var (çip) | ✅ |
| **Çapraz-referans / muadil ürün** | Var (çıkarım) | **Yok** | 🔴 Yüksek |
| **İlgili / alternatif ürün** | Var (çıkarım) | **Yok** | 🔴 Yüksek |
| **Tıklanabilir OEM → ürün listesi** | Var (çıkarım) | **Yok** | 🔴 Yüksek |
| **Tıklanabilir/ gruplu araç uyumu** | Var (çıkarım) | Yok (düz metin) | 🟠 Orta |
| Zengin, linkli breadcrumb | Var | Minimal, linksiz | 🟠 Orta |
| Sekme/akordeon | Var (çıkarım) | Yok | 🟢 Düşük |
| Yorumlar | Var (çıkarım) | Yok | 🟢 Düşük |
| JSON-LD / SEO | — | **Var (güçlü)** | ✅ getirbakim önde |

### Öneriler
- 🔴 **Çapraz-referans / muadil ürünler:** ürünün OEM kodlarını (`product_oems`) paylaşan **diğer** ürünleri sorgulayıp "Muadil parçalar" bölümü olarak göster. Veri ilişkisi mevcut (`part_oens` / `product_oems`); `catalog-store.ts` içine `getCrossReferenceProducts(partId)` benzeri bir action eklenebilir. **En yüksek getirili tek iyileştirme.**
- 🔴 **İlgili ürünler:** aynı kategori + (varsa) aynı araç uyumundan popülerlik sıralı 8-12 ürün. Kart projeksiyonu `getCatalogProductsForStore()` zaten mevcut, yeniden kullanılabilir.
- 🔴 **OEM çiplerini tıklanabilir yap:** her OEM çipini "bu OE'ye uyan ürünler" listelemesine bağla (arama/`b/[slug]` veya yeni `/oem/[code]` rotası).
- 🟠 **Araç uyumunu gruplandır + linkle:** make → model → motor kırılımıyla akordeon; her satır ilgili araç parça listesine (`getPartsForVehicle`) link.
- 🟠 **Breadcrumb'ı zenginleştir:** detay sayfasında da `BreadcrumbSection` kalıbını (kategori route'unda mevcut) linkli olarak kullan.
- 🟢 **Uzun bölümleri sekme/akordeon'a al** (Özellikler / Uyumlu araçlar / OE numaraları / Muadiller) — mobil okunabilirliği artırır.

---

## 7. Kategori-bazlı fark özeti

| Alan | Özellik | Trodo | getirbakim | Öncelik |
|---|---|---|---|---|
| Hız | Client-side geçiş + prefetch | ✅ | ✅ | — |
| Hız | İskelet/algılanan gecikme cilası | ✅ | 🟡 | Düşük |
| Listeleme | Zengin kart | ✅ | ✅ | — |
| Listeleme | Araç-uyumu facet | ✅ | ❌ | 🔴 |
| Listeleme | OEM facet/arama | ✅ | ❌ | 🔴 |
| Listeleme | Teknik kriter facet | ✅ | ❌ | 🟠 |
| Listeleme | Kategoride fiyat facet | ✅ | ❌ | 🟠 |
| Detay | Çapraz-referans/muadil | ✅ | ❌ | 🔴 |
| Detay | İlgili ürünler | ✅ | ❌ | 🔴 |
| Detay | Tıklanabilir OEM | ✅ | ❌ | 🔴 |
| Detay | Gruplu/linkli araç uyumu | ✅ | ❌ | 🟠 |
| Detay | Linkli breadcrumb | ✅ | ⚠️ | 🟠 |
| SEO | JSON-LD / ISR / metadata | ? | ✅ | getirbakim önde |

---

## 8. Öncelikli aksiyon planı

### Dalga 1 — Quick wins (yüksek etki / düşük efor)
1. **Detay: ilgili ürünler bölümü** — aynı kategori, popülerlik sıralı; `getCatalogProductsForStore()` yeniden kullan. → `CatalogProductDetail.tsx`, `lib/actions/catalog-store.ts`
2. **Detay: OEM çiplerini tıklanabilir yap** — mevcut arama/marka listelemesine bağla. → `CatalogProductDetail.tsx`
3. **Detay: linkli breadcrumb** — kategori route'undaki `BreadcrumbSection` kalıbını uygula. → `app/[locale]/[...slug]/_components/BreadcrumbSection.tsx` → `urun/[slug]`
4. **Listeleme: kategori fiyat facet'inde mobil parite** — masaüstünde zaten bağlıydı; mobil sheet'e de fiyat propları geçirildi. → `CategoryContent.tsx`, `CategoryClientWrapper.tsx`

### Dalga 2 — Orta (yüksek etki / orta efor)
5. **Detay: çapraz-referans / muadil ürünler** — OEM paylaşan diğer ürünleri sorgula (`getCrossReferenceProducts`). → `lib/actions/catalog-store.ts`, `CatalogProductDetail.tsx`
6. **Listeleme: araç-uyumu facet'i** — Garaj/`PartFinder` seçili aracıyla daralt; veri `part_vehicle_types` / `getPartsForVehicle`. → `SearchSidebar.tsx`, `hooks/use-category-search.ts`
7. **Listeleme: OEM facet/hızlı arama** — Meilisearch'te OEM'i filtrelenebilir attribute yap. → `lib/search/*`, `SearchSidebar.tsx`
8. **Detay: araç uyumunu gruplandır + linkle** (make/model/motor akordeon). → `CatalogProductDetail.tsx`

### Dalga 3 — Büyük (stratejik)
9. **TecDoc teknik kriter facet'leri** — kategori-bağlamlı dinamik facet üretimi (`product_properties`).
10. **Detay sekmeleri/akordeon + yorum altyapısı** (mobil okunabilirlik + sosyal kanıt).
11. **Hız cilası** — iskelet birleştirme, viewport-prefetch ölçümü.

> **Not:** getirbakim'in kategori-hız altyapısı ve SEO temeli Trodo'ya **eşit veya önde**. En büyük mesafe **detay sayfasının derinliğinde** (çapraz-referans, ilgili ürün, tıklanabilir OEM/araç) ve **listeleme facet zenginliğinde** (araç/OEM/teknik). Bu iki alan ciro ve sepet büyüklüğünü doğrudan etkiler.

---

## 9. Kaynaklar

- [Trodo.com — Car spare parts online](https://www.trodo.com/) (Cloudflare nedeniyle doğrudan taranamadı)
- [Trodo.com — Car parts](https://www.trodo.com/car-parts)
- [Trodo.com — Oil filters](https://www.trodo.com/oil-filters)
- [Trodo.com — About Us](https://www.trodo.com/about-us)
- [Trustpilot — Trodo.com değerlendirmeleri](https://www.trustpilot.com/review/trodo.com)
- [Realreviews.io — Trodo.com](https://realreviews.io/reviews/trodo.com)
- [TecAlliance — TecDoc Catalogue](https://www.tecalliance.net/tecdoc-catalogue/) (araç seçici / OE çapraz-referans / teknik kriter standardı)

---

*Bu doküman, canlı sitenin doğrudan taranamadığı kısıtı altında hazırlanmıştır; **(çıkarım)** etiketli maddeler
Trodo'da canlı olarak teyit edildikçe güncellenmelidir. getirbakim tarafı bulguları kod tabanı keşfiyle doğrulanmıştır.*
