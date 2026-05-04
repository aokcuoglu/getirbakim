# ZUPV2 Feature Gap and Roadmap (Automotiv Yedek Parca E-Ticaret)

## 1. Mevcut Feature Envanteri

### Storefront
- Locale tabanli uygulama yapisi (`tr`, `en`) ve i18n mesajlari.
- Ana sayfa: kategori vitrini, populer manufacturer alanlari, hero alanlari.
- Katalog sayfasi: kategoriye gore listeleme, filtreleme, paginasyon.
- Arama sayfasi: faceted search UX, siralama, liste/grid gorunum.
- Urun detay sayfasi: galeri, ozellikler, EAN/OEN verileri, iliskili urunler.
- Arac secici: marka/model/variant hiyerarsisi ve “garage” benzeri client state.
- Kimlik dogrulama: Supabase sign-in/sign-up/callback.

### Admin
- Admin guard (`requireAdminAuth`) ve locale admin route’lari.
- Urun, kategori, siparis, musteri panelleri.
- Tedarikci/mapping yonetimi (dinamik + supplier mapping + clone workflow).
- Dashboard KPI ve rapor ekranlari.

### API/Backend
- `app/api/*` endpointleri ile katalog, fiyat, arama, parca detay/sekmeleri.
- Prisma + PostgreSQL veri modeli (urun, kategori, arac, siparis, supplier).
- Meilisearch fallback stratejisi (Prisma fallback destekli).
- Redis API’si no-op fallback ile calisiyor (opsiyonel cache katmani).

## 2. Best-Practice Gap Matrisi

| Alan | Durum | Not |
|---|---|---|
| Type safety kapisi (`tsc`) | Tamamlandi | Bu calismada tum TS hatalari kapatildi. |
| Lint/quality gate | Kismi | `next lint` yerine calisan kalite scriptleri + CI eklendi. |
| CI pipeline | Tamamlandi | PR/branch quality gate workflow eklendi. |
| API validation | Kismi | Kritik endpointlerde Zod dogrulama eklendi. |
| API error contract | Kismi | Standart error sekli ve request/rate-limit header’lari eklendi. |
| Rate limit | Kismi | In-memory temel limit eklendi (degrade-safe). |
| SQL/ORM standardi | Kismi | Prisma-first hybrid politikasina gecis basladi. |
| Checkout + siparis olusturma | Eksik (P0) | Sepetten gercek siparis akisi henuz yok. |
| Odeme/teslimat entegrasyonu | Eksik (P0) | Production-grade checkout yok. |
| Observability (metrics/tracing) | Eksik (P1) | Endpoint p95 ve tracing su an parcali. |
| E2E/regression test seti | Eksik (P1) | Mevcut test kapsami sinirli. |

## 3. Veri Erisim Standardi (Prisma-First Hybrid)

### Kural
- Varsayilan: Prisma ORM (`findMany`, `count`, `groupBy`).
- Istisna: CTE / `DISTINCT ON` / `LATERAL` / kompleks dedup-hesaplama gereken ve ORM’de coklu sorgu + pahali post-process doguran durumlar.

### Bu repoda uygulanan kararlar
- ORM’a cevrilen: `getPopularPartIds` (groupBy SQL -> Prisma `order_items.groupBy`).
- SQL’de kalan: admin urun/supplier tarafindaki `LATERAL`, dedup ve hesaplama agir sorgular.

### SQL’de kalma zorunluluklari
- Sadece parametreli `Prisma.sql` / template raw kullan.
- `queryRawUnsafe` / `executeRawUnsafe` yasak.
- Kodda kisa gerekce yorumu + benchmark referansi bulunsun.
- Referans dosya: `docs/perf/data-access-benchmarks.md`.

## 4. Fazli Uygulama Roadmap

### Faz 1 (Tamamlanan + Baslatilan)
- TS hatalarinin kapatilmasi.
- CI quality gate (unsafe SQL guard + typecheck + lint + test).
- Kritik API endpointlerinde validation/error/rate-limit standardizasyonu.
- Guvenli repo temizligi baslangici (artifact/env policy).

### Faz 2 (P0)
- Gercek checkout akisi: sepet -> adres -> kargo -> odeme -> siparis olusturma.
- Siparis state machine + odeme geri donus senaryolari.
- Stok/fiyat atomik dogrulama (checkout aninda).

### Faz 3 (P1)
- Endpoint p95/p99 metrikleri ve tracing standardi.
- E2E test paketi (katalog, arama, urun detay, admin kritik akislari).
- Cache stratejilerinin gercek Redis ile olgunlastirilmasi.

## 5. Kabul Kriterleri (Bu iterasyon)
- `bunx tsc --noEmit` temiz.
- Kritik API endpointleri standart error sekli kullanir:
  - `{ error: { code, message }, requestId }`
- Rate limit header’lari dondurulur:
  - `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `Retry-After`.
- CI workflow aktif ve PR’da quality gate calisir.
