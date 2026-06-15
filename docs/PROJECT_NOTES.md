# GetirBakim V2 - Proje Notları

> Son güncelleme: 2026-05-04  
> Amaç: Proje mimarisini, veri modelini ve geliştirme kararlarını özetleyerek gelecekteki geliştirmelerde hızlı referans sağlamak.

---

## 1. Proje Özeti

Otomotiv yedek parça e-ticaret platformu. Türkçe/İngilizce çoklu dil desteği (next-intl). Marka, kategori ve araç uyumluluğu bazlı arama; OEM/EAN kodu ile parça bulma; tedarikçi entegrasyonları (Dinamik, SETA, Parts2World); Tami ödeme altyapısı; admin paneli ile ürün, sipariş ve tedarikçi yönetimi.

---

## 2. Teknoloji Yığını

| Katman | Teknoloji |
|--------|-----------|
| Framework | Next.js 16 (App Router, RSC) |
| Dil | TypeScript (strict mode) |
| Paket yöneticisi | Bun |
| Veritabanı | PostgreSQL (3 schema: `public`, `trodo`, `parcatedarik`) |
| ORM | Prisma 7 (`@prisma/adapter-pg`, connection pool 20) |
| Auth | NextAuth.js v5 (Credentials provider, bcryptjs hashing, JWT sessions) |
| Arama | Meilisearch (feature-flag `MEILI_ENABLED`, fallback: Prisma SQL) |
| Önbellek | Upstash Redis (serverless REST) + in-memory cache |
| Ödeme | Tami (Türk ödeme sağlayıcı, HMAC-SHA512 güvenlik) |
| i18n | next-intl (tr/en, prefix always, mesajlar `/messages/`) |
| UI | Radix UI + shadcn/ui + Tailwind CSS 4 |
| State | Zustand (garaj) + React Query (server state) |
| Test | Bun built-in test runner (`.test.ts` dosyaları) |
| AI | Google Gemini (mekanik tavsiyesi, kategori çevirisi) |
| Deploy | Docker (standalone output), nginx reverse proxy |

### Çevre Değişkenleri (önemli olanlar)

- `DATABASE_URL` — Prisma Accelerate (`prisma://`) veya standart PostgreSQL
- `NEXTAUTH_URL`, `NEXTAUTH_SECRET` — NextAuth.js session signing
- `MEILI_ENABLED` — Meilisearch aktif/pasif
- `NEXT_PUBLIC_MEILI_HOST`, `NEXT_PUBLIC_MEILI_SEARCH_KEY` — Meilisearch bağlantı
- `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` — Redis önbellek
- `TAMI_MERCHANT_NUMBER`, `TAMI_TERMINAL_NUMBER`, `TAMI_SECRET_KEY`, `TAMI_JWK_KID`, `TAMI_JWK_K` — Ödeme
- `DINAMIK_PROXY_URL`, `DINAMIK_API_KEY`, `DINAMIK_SECRET_KEY` — Dinamik tedarikçi API
- `NEXT_PUBLIC_SITE_URL` / `NEXT_PUBLIC_APP_URL` / `VERCEL_URL` — Site URL'si
- `API_KEY` / `NEXT_PUBLIC_GEMINI_API_KEY` — Gemini AI

---

## 3. Dizin Yapısı

```
app/
  [locale]/              # Kullanıcıya açık tüm sayfalar (tr/en)
    page.tsx             # Anasayfa
    [...slug]/page.tsx   # Kategori sayfaları (catch-all)
    part/[id]/page.tsx   # Ürün detay
    search/page.tsx      # Arama sonuçları (client-side)
    catalog/page.tsx     # Katalog yönlendirme
    checkout/            # Ödeme akışı + sonuç sayfası
    admin/               # Admin paneli
    account/             # Kullanıcı hesabı
    auth/login/signup/   # Kimlik doğrulama
    (legal)/             # Hukuki sayfalar (KVKK, sözleşmeler vs.)
    orders/lookup/       # Misafir sipariş sorgulama
    supplier-product/    # Tedarikçi ürün detay
  api/                   # API route'ları
    search/              # Arama endpoint (POST, ~2086 satır)
    payments/tami/       # Tami callback
    cart/reconcile/      # Sepet mutabakat
    parts/               # Parça listeleme + related + tabs
    catalog/             # Katalog articles + prices
    internal/suppliers/  # Tedarikçi sync cron'ları
    admin/products/      # Admin ürün workbench
    notifications/       # Bildirim endpoint'leri
    me/                  # Kullanıcı bilgi endpoint
    dinamik/             # Dinamik proxy endpoint'leri

components/
  ui/                    # shadcn/ui bileşenleri (21 adet)
  admin/                 # Admin paneli bileşenleri (12 adet)
  auth/                  # Login/Signup formları
  category/              # Kategori sayfası bileşenleri
  hero/                  # Anasayfa hero bölümü
  navbar/                # Navbar alt-bileşenleri
  search/                # Arama sonuçları + filtreler
  selector/              # Araç seçici (dropdown/modal)
  ShopProvider.tsx       # Global state provider (~650 satır)
  ProductCard.tsx        # Ürün kartı
  Navbar.tsx             # Ana navbar (~315 satır)
  PartFinder.tsx         # Araç seçici hero bölümü

lib/
  actions/               # Server Actions (31 adet) — ana veri katmanı
  api/                   # API yardımcı fonksiyonları (client, categories, products)
  catalog/               # Katalog hit-merge + supplier item çözümlemesi
  client/                # Client-side category cache
  context/               # React context provider'ları (VehicleData, CategoryCache)
  legal/                 # Hukuki metin içerikleri
  notifications/         # Bildirim oluşturma
  orders/                # Sipariş yaşam döngüsü service + types
  payments/              # Tami ödeme entegrasyonu
  pricing/               # Fiyat hesaplama motoru
  search/                # Meilisearch indexing + hybrid search scoring
  seo/                   # Sitemap, structured data, URL yardımcıları
  auth/                  # Login/Signup formları
  suppliers/             # Tedarikçi sync (Dinamik, SETA, Parts2World)
  types/                 # Paylaşılan domain tip tanımları
  utils/                 # Yardımcı fonksiyonlar (formatter, vehicleSlug vb.)
  validations/           # Zod şemaları (auth, product, parts)

hooks/
  use-search.ts          # Arama hook'u (URL-synced, faceted, 417 satır)
  use-garage.ts          # Zustand vehicle state (localStorage-persisted)
  use-debounce.ts        # Debounce hook
  use-category-search.ts # Kategori arama hook'u
  use-instant-category-navigation.ts
  use-toast.ts

services/
  api.ts                 # Minimal auth API client
  geminiService.ts       # Gemini AI entegrasyonu

constants/
  vehicleData.ts         # Araç verisi tipi (veri DB'den geliyor)
  categoryData.ts        # Top-level kategori ağacı (statik)

prisma/
  schema.prisma          # 46 model, ~975 satır, 3 schema

messages/
  tr.json                # Türkçe çeviriler
  en.json                # İngilizce çeviriler
```

---

## 4. Veri Modeli (Prisma Schema)

### 4.1 Ana Şemalar

**`public` şeması** — Uygulamanın çekirdek verisi:

| Model | Açıklama | Anahtar İlişkiler |
|-------|----------|-------------------|
| `parts` | Ürün (yedek parça) | brand → `part_brands`, category → `part_categories` |
| `part_brands` | Marka | 1:N → `parts` |
| `part_categories` | Kategori (ağaç yapısı) | parent_id (self-ref), 1:N → `parts` |
| `part_oens` | OEM kodları | N:1 → `parts` |
| `part_eans` | EAN/barkod | N:1 → `parts` |
| `part_cross_references` | Çapraz referans | N:1 → `parts` |
| `part_images` | Ürün görseli | N:1 → `parts` |
| `part_properties` | Teknik özellikler | N:1 → `parts` |
| `part_vehicle_types` | Araç uyumluluğu | N:N (parts ↔ v0.vtypes) |
| `part_pricing_inventory` | Fiyat + stok | 1:1 → `parts` |
| `makes` / `models` / `vehicles` | Eski araç hiyerarşisi (trodo'dan önce) | make → model → vehicle |
| `v0.vbrands` / `v0.vmodels` / `v0.vtypes` | Aktif araç hiyerarşisi | brand → model → type |
| `v0.vtype_details` | Araç detay özellikleri | 1:1 → `v0.vtypes` |
| `oil_capacities` | Yağ kapasitesi | 1:1 → `v0.vtypes` |
| `users` | Kullanıcı | NextAuth credentials (email+password, bcryptjs) |
| `orders` / `order_items` / `order_payments` | Sipariş ve ödeme | order → items → parts |
| `customer_requests` | Müşteri talep/bildirim | N:1 → `parts` (opsiyonel) |
| `notifications` | Kullanıcı bildirimleri | N:1 → `users` |
| `user_vehicles` | Kullanıcı garajı | N:1 → `users` |

**`trodo` şeması** — Trodo'dan migrate edilmiş araç katalog verisi:
- `variants` — Araç varyant (motor, cc, kw, yıl aralığı)
- `category_tree` — Varyant bazlı kategori ağacı (SEO URL'ler dahil)

**`parcatedarik` şeması** — ParcaTedarik.com scrape verisi:
- `manufacturer` — Üretici
- `product` — Ürün (scrape)
- `price_history` — Fiyat geçmişi

### 4.2 Önemli İlişkiler

```
parts → part_brands (marka)
parts → part_categories (kategori)
parts → part_oens (OEM kodları)
parts → part_vehicle_types → v0.vtypes (uyumluluk)
parts → part_pricing_inventory (fiyat/stok)
```

---

## 5. Mimarî Desenler

### 5.1 Veri Akışı

```
[Client Component/Server Component]
       ↓ çağırır
[Server Action] (lib/actions/)
       ↓ sorgular
[Prisma Client] (lib/db.ts)
       ↓ bağlanır
[PostgreSQL] (3 schema)
```

- **Server Actions** (`lib/actions/`) ana veri katmanı — hem Server Component'ler hem Client Component'ler tarafından çağrılır
- **API Routes** (`app/api/`) webhook'lar, cron job'lar ve arama için
- Server Component'ler doğrudan veri çeker; Client Component'ler interaktivite sağlar

### 5.2 Arama Sistemi

```
[use-search.ts hook] → POST /api/search
       ↓
[Meilisearch aktif mi?]
  EVET → Meilisearch multi-search (disjunctive faceting)
  HAYIR → Prisma hybrid search (lib/search/hybrid-search.ts)
       ↓
Sonuçlar + fiyatlandırma + önbellek (Redis 5dk TTL)
       ↓
[SearchHit] → Client facet render
```

- Arama URL parametreleri ile senkronize edilir (` setSearchParams`)
- Hybrid scoring: `codeRank` (OEM/EAN eşleşme) + `phraseRank` + `tokenMatches`
- Türkçe karakter normalizasyonu (ç→c, ğ→g vb.)

### 5.3 Fiyatlandırma

```
supplier_price (tedarikçi fiyatı)
       ↓ applyPolicyForPart()
computed_cost_ex_vat (maliyet KDV hariç)
       ↓ + margin + KDV
computed_selling_price_ex_vat (satış fiyatı KDV hariç)
       ↓ × 1.20 (KDV %20)
fiyat gösterimi (KDV dahil)
```

- Stok: `supplier_stock_qty - reserved_stock_qty`
- Satın alınabilirlik: fiyat var VE stok > 0

### 5.4 Tedarikçi Sync Akışı

```
[CRON/API endpoint çağırır]
       ↓
handleDinamikScheduledSyncRequest / handleSetaSyncRequest
       ↓
1. Tedarikçi API'den katalog çek
2. Marka alias çözümlemesi
3. OEM eşleşme + candidate matching
4. part_pricing_inventory güncelle
5. cross-reference mirror
6. Meilisearch index güncelle
7. Redis önbellek invalidasyon
```

### 5.5 Ödeme Akışı (Tami)

```
[Checkout form] → lib/actions/checkout.ts
       ↓
1. Sipariş taslağı oluştur (stok rezervasyonu dahil)
2. Tami payment session başlat
       ↓
[Tami hosted/direct ödeme]
       ↓
3. Callback → finalizeTamiPaymentFromCallback()
4. Sipariş/sipariş ödeme durumu güncelle
5. Yönlendirme → /checkout/result
```

### 5.6 Auth Akışı

```
[NextAuth.js]
   - Credentials provider (email + password)
   - bcryptjs password hashing
   - JWT session tokens
        ↓
[middleware.ts] —
   1. next-intl locale yönlendirme
   2. NextAuth session validation (auth cookie varsa)
   3. Admin route koruması (role = ADMIN kontrolü)
   4. CSP + güvenlik header'ları
   5. CDN önbellekleme header'ları (anonim GET için s-maxage=300)
```

### 5.7 Araç Seçici (Garaj)

```
[Zustand store] (use-garage.ts)
  - selectedVehicle, vehicleHistory
  - localStorage persist
       ↓
[VehicleDataProvider.tsx] — React context
  - Marka → Model → Tip hiyerarşisi lazy loading
  - Server actions: getMakes, getModels, getVehicles...
       ↓
[VehicleSelector.tsx] — Dropdown bileşeni
  - Kaskad seçici (5 seviye)
  - URL ile de seçilebilir (?variant= url_key)
```

---

## 6. Sayfa ve Route Haritası

### Kullanıcı Sayfaları

| Route | Dosya | Açıklama |
|-------|-------|----------|
| `/` | `page.tsx` | Anasayfa (hero, popüler markalar, kategoriler) |
| `/[slug]` | `[...slug]/page.tsx` | Kategori sayfası (catch-all, ISR 3600s) |
| `/part/[id]` | `part/[id]/page.tsx` | Ürün detay (ISR 3600s) |
| `/search` | `search/page.tsx` | Arama (client-side) |
| `/catalog` | `catalog/page.tsx` | Katalog → kategori yönlendirme |
| `/checkout` | `checkout/page.tsx` | Ödeme sayfası |
| `/checkout/result` | `checkout/result/page.tsx` | Ödeme sonucu |
| `/account` | `account/page.tsx` | Hesap sayfası |
| `/account/orders` | `account/orders/page.tsx` | Siparişlerim |
| `/auth` | `auth/page.tsx` | Giriş/Kayıt |
| `/login` | `login/page.tsx` | Giriş |
| `/signup` | `signup/page.tsx` | Kayıt |
| `/supplier-product/[id]` | `supplier-product/[id]/page.tsx` | Tedarikçi ürün detay |
| `/(legal)/*` | Legal sayfalar | KVKK, sözleşmeler, iletişim vb. |

### Admin Sayfaları

| Route | Açıklama |
|-------|----------|
| `/admin` | Dashboard |
| `/admin/products` | Ürün yönetimi |
| `/admin/products/new` | Yeni ürün ekleme |
| `/admin/products/tools` | Ürün araçları |
| `/admin/suppliers` | Tedarikçi yönetimi |
| `/admin/suppliers/mappings` | Eşleştirme yönetimi |
| `/admin/suppliers/seta` | SETA sync |
| `/admin/suppliers/dinamik` | Dinamik sync |
| `/admin/orders` | Sipariş yönetimi |
| `/admin/customers` | Müşteri yönetimi |
| `/admin/requests` | Müşteri talepleri |
| `/admin/categories` | Kategori yönetimi |

### API Route'ları

| Endpoint | Yöntem | Açıklama |
|----------|--------|----------|
| `POST /api/search` | POST | Ana arama (Meilisearch/Prisma) |
| `GET /api/parts` | GET | Kategori bazlı ürün listeleme |
| `GET /api/parts/related` | GET | İlgili ürünler |
| `GET /api/parts/tabs` | GET | Ürün detay tab verileri |
| `POST /api/cart/reconcile` | POST | Sepet mutabakat |
| `GET/POST /api/payments/tami/callback` | GET/POST | Tami ödeme callback |
| `GET /api/catalog/articles` | GET | Katalog makaleleri |
| `GET /api/catalog/prices` | GET | Katalog fiyatları |
| `GET /api/me` | GET | Kullanıcı bilgisi |
| `GET /api/account/orders` | GET | Kullanıcı siparişleri |
| `GET /api/account/orders/[id]` | GET | Sipariş detay |
| `POST /api/orders/guest-lookup` | POST | Misafir sipariş sorgulama |
| `GET /api/notifications` | GET | Bildirimler |
| `GET /api/health` | GET | Sağlık kontrolü |
| `GET /api/category-page` | GET | Kategori sayfa verisi |
| `GET /api/internal/suppliers/dinamik/sync` | GET | Dinamik sync trigger |
| `GET /api/internal/suppliers/seta/sync` | GET | SETA sync trigger |
| `POST /api/internal/search/index-parts` | POST | Meilisearch indexleme |
| `GET /api/internal/search/setup` | GET | Meilisearch kurulumu |
| `GET /api/admin/products/workbench` | GET | Admin ürün workbench |
| `GET /api/admin/products/options` | GET | Admin ürün seçenekleri |
| `GET /api/dinamik/stock` | GET | Dinamik stok sorgulama |
| `GET /api/dinamik/price-list` | GET | Dinamik fiyat listesi |
| `GET /api/dinamik/brand-list` | GET | Dinamik marka listesi |
| `GET /api/dinamik/stock-list` | GET | Dinamik stok listesi |

---

## 7. Server Actions Referansı

| Action Dosyası | Sorumlu Olduğu Alan |
|---------------|---------------------|
| `search.ts` | Global arama (kategori, OEM, EAN, cross-ref, ürün adı) |
| `checkout.ts` | Ödeme akışı (sipariş oluşturma, ödeme başlatma) |
| `vehicles.ts` | Araç hiyerarşisi (marka, model, tip, varyant) |
| `products.ts` | Ürün filtreleme (şu an stub) |
| `product-actions.ts` | Ürün CRUD işlemleri |
| `categories.ts` | Kategori sorgulama |
| `category-actions.ts` | Kategori CRUD |
| `getPartById.ts` | Tek ürün detay çekme |
| `getPartCategories.ts` | Ürün kategorileri |
| `getPartsForVehicle.ts` | Araç bazlı parça listesi |
| `getCatalogArticles.ts` / `getCatalogCategories.ts` | Katalog verisi |
| `getPopularManufacturers.ts` / `getPopularPartIds.ts` | Popüler veri |
| `getBrandLogos.ts` / `getBrandsForCategory.ts` | Marka verisi |
| `topCategories.ts` | Ana navigasyon kategorileri |
| `filters.ts` | Filtre seçenekleri |
| `auth.ts` / `auth-actions.ts` | Kimlik doğrulama |
| `user-vehicles.ts` | Kullanıcı garaj yönetimi |
| `customer-requests.ts` | Müşteri talepleri |
| `admin-products.ts` | Admin ürün yönetimi |
| `admin-orders.ts` | Admin sipariş yönetimi |
| `admin-customers.ts` | Admin müşteri yönetimi |
| `admin-suppliers.ts` | Admin tedarikçi yönetimi |
| `update-product.ts` | Ürün güncelleme |
| `getCachedParts.ts` | Önbellekli parça çekme |

---

## 8. Bileşen Referansı

### Global Provider'lar

| Bileşen | Açıklama |
|---------|----------|
| `ShopProvider.tsx` | Global state: sepet, garaj, filtre, auth (~650 satır) |
| `QueryProvider.tsx` | React Query provider |
| `VehicleDataProvider.tsx` | Araç verisi context |
| `CategoryCacheProvider.tsx` | Kategori önbellek context |

### Önemli Client Bileşenleri

| Bileşen | Açıklama |
|---------|----------|
| `Navbar.tsx` | Ana navigasyon çubuğu (~315 satır) |
| `MegaMenu.tsx` | Kategori mega menüsü |
| `CatalogSheet.tsx` | Katalog slide-out |
| `PartFinder.tsx` | Anasayfa araç seçici |
| `ProductCard.tsx` | Ürün kartı |
| `FilterSidebar.tsx` | Arama filtre sidebar |
| `CartDrawer.tsx` / `GlobalCartDrawer.tsx` | Sepet çekmecesi |
| `ChatAssistant.tsx` | Gemini AI sohbet asistanı |
| `SearchInput.tsx` | Arama giriş alanı |
| `SearchResults.tsx` | Arama sonuçları |
| `VehicleSelector.tsx` | Araç seçici dropdown |
| `LanguageSwitcher.tsx` | Dil değiştirici |
| `LoginModal.tsx` | Giriş modal |

### Admin Bileşenleri

`stats-cards`, `sales-report`, `activity-feed`, `recent-orders-widget`, `sidebar`, `admin-layout`, `responsive-data-view`, `regional-stock-summary`, `performance-overview`, `quick-actions`, `transactions-table`

---

## 9. Fiyatlandırma Motoru Detayı

**`lib/pricing/calculate-selling-price.ts`** — Temel fiyat hesaplama:
1. `standardDiscountRate` — Standart indirim oranı
2. `campaignRate` — Kampanya indirimi
3. `marginRate` — Kar marjı
4. `fixedFee` — Sabit ücret
5. `lockedSellingPrice` — Kilitli admin fiyatı varsa bunu kullan
6. Hepsi yarım yukarı yuvarlama (half-up), 2 ondalık

**`lib/pricing/public-pricing.ts`** — Satış fiyatı çözümlemesi:
- Öncelik: `admin_override` → `computed_selling_price` → `supplier_price` (fallback)
- Kategori minimum fiyat bazlı placeholder fiyat oluşturma
- `resolvePublicPriceAndPurchasability()` — satın alınabilirlik kontrolü

---

## 10. Önbellek Stratejisi

| Katman | Teknoloji | TTL | Kullanım |
|--------|-----------|-----|----------|
| Next.js ISR | `revalidate = 3600` | 1 saat | Kategori ve ürün sayfaları |
| Redis | Upstash Redis | 5 dk (arama), 7 gün (hiyerarşi) | Arama sonuçları, araç verisi |
| In-memory | `lib/cache.ts` | 1-5 dk | Admin API önbelleği |
| CDN | `s-maxage=300, stale-while-revalidate=900` | 5 dk | Anonim sayfalar |
| Meilisearch | Meilisearch index | Manuel güncelleme | Arama indexi |

---

## 11. i18n Yapısı

- `messages/tr.json` ve `messages/en.json`
- `next-intl` ile `/:locale/` prefix zorunlu
- Destekeklenen diller: `tr` (default), `en`
- Admin sayfaları `createAdminTranslator(locale)` kullanır (basit çeviri)
- Top-level i18n anahtarları: Hero, CatalogSection, Navbar, TopUtilityBar, LoginModal, Footer, Part, ProductCard, PartFinder, CategoryPage, CustomerRequests, common, account, CatalogSheet, VehicleSelector, admin, GlobalSearch, SearchInput, SearchResults, FacetedFilterSidebar, GuestOrderLookup, AuthPage, CategorySeoContent, DinamikProducts, DinamikProductDetail, AccountWorkspace

---

## 12. Güvenlik ve Middleware

**middleware.ts** kritik güvenlik katmanı:
1. next-intl locale yönlendirme
2. Yinelenen locale prefix canonicalization (`/tr/tr/...` → `/tr/...`)
3. NextAuth oturum doğrulama (auth cookie varsa veya protected path'lerde)
4. Admin route koruması — `ADMIN` rolü kontrolü, değilse anasayfaya yönlendirme
5. API route'ları auth'dan muaf (`/api/` prefix → passthrough)
6. Güvenlik header'ları: HSTS, X-Content-Type-Options, X-Frame-Options, CSP, Referrer-Policy, Permissions-Policy

**Lint kuralı:** `queryRawUnsafe` ve `executeRawUnsafe` API/admin scope'ta yasaklı.

---

## 13. Deploy ve Altyapı

- **Docker**: Multi-stage build (Bun install → Next.js build → Node.js runtime)
- **Standalone output**: `next.config.mjs` → `output: 'standalone'`
- **Prisma Accelerate** desteği (prisma:// URL tespiti)
- **nginx**: Reverse proxy (docker-compose.yml)
- **NextAuth.js**: Self-hosted auth (JWT sessions, bcryptjs)
- **Upstash Redis**: Serverless REST Redis
- **Meilisearch**: Opsiyonel arama motoru (`MEILI_ENABLED` flag)

---

## 14. Test Yaklaşımı

- **Test runner**: Bun built-in (`bun test`)
- **Test dosyaları**: `.test.ts` soneki ile (7 adet)
  - `lib/search/hybrid-search.test.ts` — Arama scoring testleri
  - `lib/pricing/calculate-selling-price.test.ts` — Fiyat hesaplama testleri
  - `lib/pricing/public-pricing.test.ts` — Public fiyat testleri
  - `lib/catalog-url.test.ts` — URL oluşturma testleri
  - `lib/suppliers/dinamik-stock.test.ts` — Dinamik stok testleri
  - `lib/suppliers/parts2world/article-info-sync-helpers.test.ts` — Parts2World sync testleri
  - `lib/orders/types.test.ts` — Sipariş tip testleri
- **Tip tanımları**: `types/bun-test.d.ts` — Bun test modülü tiplemesi

---

## 15. Script'ler

| Script | Açıklama |
|--------|----------|
| `bun run dev` | Dev server (port 3000) |
| `bun run build` | Prisma generate + Next.js build |
| `bun run lint` | Tip kontrolü + unsafe SQL kontrolü |
| `bun run typecheck` | Sadece TypeScript kontrolü |
| `bun run test` | Test çalıştırma |
| `bun run db:pull` | Prisma DB pull (şemayı DB'den çek) |
| `bun run db:generate` | Prisma client generate |
| `parts2world:sync-*` | Parts2World sync script'leri |
| `bun run env:check:*` | Çevre değişken doğrulama (local/staging/production) |
| `bun run perf:smoke` | Performans smoke test |
| `bun run smoke:live` | Canlı smoke test |

---

## 16. Dikkat Edilmesi Gereken Noktalar

### Yüksek Riskli Alanlar
1. **Araç uyumluluğu** — `part_vehicle_types` ve `v0.vtypes` arasındaki eşleşme hataları müşteriye yanlış parça satabilir
2. **OEM kod eşleşmesi** — `part_oens` normalize edilmiş karşılaştırma, Türkçe karakter hassasiyeti
3. **Fiyat hesaplama** — KDV, indirim, kampanya marin sıralaması ve yuvarlama hataları
4. **Stok mutabakat** — `reserved_stock_qty` ve `supplier_stock_qty` tutarsızlığı sipariş reddine yol açabilir
5. **Tedarikçi sync** — Dinamik sync ~1764 satır, kompleks job; partial failure durumları
6. **Ödeme** — Tami HMAC-SHA512 imzalama, amount mismatch kontrolü, pending verification durumu

### Bilinen Eksiklikler / Geliştirme Fırsatları
1. `lib/actions/products.ts` — Stub (boş dizi döndürüyor), yeniden implemente edilmesi gerekli
2. `server-only` import bazı server action'larda eksik olabilir
3. `lib/db.ts` — Prisma client singleton'da stale instance kontrolü var ama development hmr ile risk olabilir
4. Meilisearch feature-flag — Prodüksiyonda aktif edilip edilmediğini kontrol et
5. `types.ts` (kök dizin) — Eski tip tanımları, muhtemelen kullanılmıyor; `lib/types/` daha güncel
6. `constants.ts` (kök dizin) — Mock/seed verisi, kaldırılabilir
7. Test coverage düşük — sadece 7 test dosyası, kritik alanlar (checkout, sync, pricing) yeterince testlenmemiş

### Mimari Tekrarlar / Temizlik
1. `services/api.ts` — Basit auth client, `any` tiplemesi var
2. `lib/cache.ts` — Basit in-memory cache, production'da Redis tercih edilmeli
3. `components/ProductCard.tsx` — Legacy/static ürün kartı, güncel olan muhtemelen search ile gelen

---

## 17. Hızlı Geliştirme Rehberi

### Yeni bir sayfa eklemek
1. `app/[locale]/yeni-sayfa/page.tsx` oluştur
2. Server Component ise server action'lardan veri çek
3. Client Component ise `useShop()` veya `useSearch()` hook'larını kullan
4. i18n mesajlarını `messages/tr.json` ve `messages/en.json`'a ekle
5. SEO metadata için `lib/seo/` yardımcılarını kullan

### Yeni bir server action eklemek
1. `lib/actions/yeni-action.ts` oluştur
2. `'use server'` direktifini ekle
3. Prisma sorgularını yaz
4. Gerekirse Redis önbellek kullan
5. Client Component'ten doğrudan veya API Route'tan çağır

### Yeni bir API endpoint eklemek
1. `app/api/yeni-endpoint/route.ts` oluştur
2. `GET`/`POST` export et
3. Admin route'larda `requireAdminAuth` ile koru
4. Tip güvenliği için Zod validation kullan

### Yeni bir tedarikçi entegrasyonu eklemek
1. `lib/suppliers/yeni-ssatici-client.ts` — HTTP client
2. `lib/suppliers/sync-yeni-ssatici.ts` — Sync orchestration
3. `app/api/internal/suppliers/yeni-ssatici/sync/route.ts` — Cron trigger

### Yeni bir veritabanı modeli eklemek
1. `prisma/schema.prisma`'ya model ekle
2. `bun run db:generate` ile client oluştur
3. İlgili server action'ları güncelle
4. Meilisearch index güncellemesi gerekebilir

---

## 18. Ortam Değişkenleri Tam Listesi

```env
# Veritabanı
DATABASE_URL=

# NextAuth.js
NEXTAUTH_URL=
NEXTAUTH_SECRET=

# Meilisearch
MEILI_ENABLED=
NEXT_PUBLIC_MEILI_HOST=
NEXT_PUBLIC_MEILI_SEARCH_KEY=
MEILI_ADMIN_KEY=

# Redis (Upstash)
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=

# Ödeme (Tami)
TAMI_MERCHANT_NUMBER=
TAMI_TERMINAL_NUMBER=
TAMI_SECRET_KEY=
TAMI_JWK_KID=
TAMI_JWK_K=

# Tedarikçi - Dinamik
DINAMIK_API_URL=
DINAMIK_API_KEY=
DINAMIK_SECRET_KEY=
DINAMIK_PROXY_URL=
DINAMIK_BRAND_CONCURRENCY=

# Tedarikçi - SETA
SETA_API_URL=
SETA_API_KEY=
SETA_SECRET_KEY=

# Tedarikçi - Parts2World
P2W_API_URL=
P2W_API_KEY=

# Site
NEXT_PUBLIC_SITE_URL=
NEXT_PUBLIC_APP_URL=
VERCEL_URL=

# Gemini AI
API_KEY=
NEXT_PUBLIC_GEMINI_API_KEY=

# CookieYes
NEXT_PUBLIC_ENABLE_COOKIEYES=
NEXT_PUBLIC_COOKIEYES_CLIENT_ID=
NEXT_PUBLIC_COOKIEYES_ALLOWED_HOSTS=

# Build
NEXT_PUBLIC_BUILD_VERSION=

# Slow Query Threshold
SLOW_QUERY_THRESHOLD=
```