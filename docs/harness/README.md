# getirbakim ajan altyapısı (Claude Code)

> Claude Code'un getirbakim'i nasıl geliştirdiği: bir orkestratör, altı uzman alt ajan, deterministik kontroller ve sabit bir hat. Akış politikası: [`docs/development-workflow.md`](../development-workflow.md). Kurallar: [`AGENTS.md`](../../AGENTS.md), [`DESIGN.md`](../../DESIGN.md). Yapı plantx'teki ortamdan uyarlandı.

## Hat

```
/ship <issue>                 (ana oturum = orkestratör)
   │
   ├─ 1 worktree               ../getirbakim-<N>  (dal <tür>/<N>-<konu>, origin/dev'den)
   ├─ 2 getirbakim-planner     salt okur → plan (dosyalar, yeniden kullanım, SQL/yetki etkisi, testler, QA rotaları)
   ├─ 3 getirbakim-developer   worktree'de uygular, test ekler, commit'ler, lint + tsc + testler (bir kez, SHA ile raporlar)
   ├─ 4 getirbakim-reviewer  ┐ paralel, salt okur → bulgular → geliştiriciye (≤2 döngü); kontrolleri yeniden koşmaz
   │    getirbakim-ui-ux     ┘ (yalnız .tsx/.css değiştiyse; küçük salt-UI değişiklikte tek başına)
   ├─ 5 getirbakim-qa          kısa ömürlü worktree sunucusunda (31NN) Chrome turu, masaüstü + mobil; kontrolleri SHA eşleşirse atlar
   ├─ 6 PR → dev               rebase, push, gh pr create (Closes #N + etiketler), CI'ı bekle;
   │                           merge öncesi statusCheckRollup hepsi SUCCESS (pipe'sız, #532)
   └─ 7 merge → dev            izin sormadan (politika); ana checkout ff, kendi worktree/dalını temizle
                               main'e yalnız /release-check ile, kullanıcının açık onayıyla
```

Orkestratör ürün kodu yazmaz; ajanlara brief verir, bulguları taşır, kapsamı Issue'da tutar. Altyapı akışın önüne yapı ekler, onu atlatmaz: `dev`'e her şey yine PR + yeşil CI ile girer, `main` ve AWS yayını ayrı onaylardır.

## Ajanlar (`.claude/agents/`)

| Ajan | Rol | Model | Kod yazar mı? | Brief |
|------|-----|-------|---------------|-------|
| `getirbakim-planner` | Mimar: kodu tarar, uygulanabilir plan döner | fable | hayır | Issue no, worktree |
| `getirbakim-developer` | Mühendis: uygular, `db/*.sql` idempotent değişiklik, test, commit | sonnet | evet | worktree, Issue, plan |
| `getirbakim-reviewer` | Kod incelemesi: yetki, SQL/veri bütünlüğü, Next 16, performans, testler | fable | hayır | worktree veya PR no |
| `getirbakim-ui-ux` | /yonetim stok-shadcn kuralı + DESIGN.md; isteğe bağlı ekran görüntüsü | sonnet | hayır | worktree, rotalar, sunucu adresi |
| `getirbakim-qa` | Kontroller + tarayıcı turu (masaüstü/mobil, admin/servis/ziyaretçi) | sonnet | hayır | worktree, rotalar, roller, kabul kriterleri |
| `getirbakim-triage` | Backlog: her açık Issue'yu kanıtla sınıflar, paralel dalga önerir | sonnet | hayır | — (`/backlog`) |

**Model seçimi:** yargısı sonraki her adımı belirleyen planlayıcı ve veri kaybı/yetki açığının tek kapısı olan inceleyici fable (orkestratörden farklı model → bağımsız ikinci göz; az token harcadıkları için ayrı Fable kotası burada değerlendirilir); mekanik ağırlıklı geliştirme, UI denetimi, QA ve triage sonnet. Orkestratör `getirbakim-developer`'a `model: "opus"` geçer: `db/*.sql` şema değişikliği, yetki/ödeme/sipariş, tedarikçi sync çekirdeği, modüller arası refactor ya da iki inceleme döngüsünde kalan sonnet çalışması.

## Skill'ler (`.claude/skills/`)

| Skill | Ne yapar |
|-------|----------|
| `/ship <N veya açıklama>` | Hattın tamamı; `dev`'e merge + temizlik dahil |
| `/issue <açıklama>` | Kısa kod taramasıyla etiketli, kabul kriterli Issue |
| `/qa [worktree\|N] [rotalar]` | Yalnız QA aşaması |
| `/design-check [--changed\|yollar]` | admin-ui-lint + `getirbakim-ui-ux` incelemesi |
| `/backlog` | `getirbakim-triage` + kanıtlı düzenlemeler (checklist, kapatma, mükerrer) |
| `/release-check` | dev→main kapsamı ve SemVer önerisi; **onaydan sonra** sürüm PR'ı, tag, Release; AWS yayını ayrıca onaylanır |

## Deterministik kontroller

| Script | Kontrol | Başarısız olur |
|--------|---------|----------------|
| `scripts/harness/admin-ui-lint.mjs` | `src/app/yonetim/**`, `src/components/admin/**`: `style={}`, arbitrary değer/variant, hex, ham palet rengi, `text/bg-white/black`, `dark:` renk, eski `components/admin/ui`, `from "cn"`, CSS importu (hata); className ile köşe/gölge (uyarı) | herhangi bir hata (`--warn` yalnız raporlar) |
| `scripts/flow/claude-guard.mjs` | Bash komutlarında akış: `dev`/`main` üzerinde commit, `--no-verify`, leasesiz force push, Contabo workflow'larını açma → **engel**; main'e push, base≠dev `gh pr merge`, main/ref değiştiren `gh api`, sürüm tag'i, `gh release create`, `release-aws` / `gh run rerun`, dev'e doğrudan push → **onay sorar** | — |
| `scripts/flow/claude-brief.mjs` | Oturum başında akış kuralları + son sürüm, dev'in main'den farkı, açık PR'lar, diğer worktree'ler | hiç (hata yalnız özeti kısaltır) |

Hedefler (`admin-ui-lint`): argümansız tüm yönetim dosyaları; `--changed` = dalın `origin/dev...HEAD` farkı + staged/unstaged + izlenmeyen dosyalar (mevcut dizinin checkout'unda); ya da açık yollar. Kaçış: satıra `admin-ui-lint-ignore` (neden olduğunu yorumda yaz). Taban (2026-11-14): 0 hata, 13 köşe uyarısı (`rounded-lg border` sarmalayıcıları).

Nerede koşar:
- **Geliştirici bir kez, SHA ile** — kontroller developer raporunda commit SHA'sıyla gelir; inceleyici ve QA SHA HEAD ile aynı ve sonuç yeşilse yeniden koşmaz (rapor yok, SHA farklı ya da bulgu doğrulaması dışında). **CI son kapıdır**; QA sonrası küçük düzeltmelerde yerelde yalnız `admin-ui-lint --changed` (gerekirse `tsc`).
- **Küçük salt-UI** — ≤2 `.tsx`/`.css` dosyası; `db/`, `src/modules/`, `src/lib/`, `actions.ts`, `route.ts`, yetki/ödeme/sync dokunuşu yok → yalnız `getirbakim-ui-ux` incelemesi (bariz kod sorunlarını da not eder).
- **CI kotası** — CI ~5-6 dk/koşu, 1–19 Kas 2026'da ~2.140 dk (ayda ~3.400); private + Free'de 2.000 dk/ay kotayı aşar. Bu yüzden private depoda CI `CI_RUNS_ON` ile sahibin Mac'indeki runner'a alınır ([CI için Mac runner](../ci-mac-runner.md)); AWS yayını GitHub-hosted kalır ve `production` ortam onayı yerine koruma işiyle (dal `main`, tetikleyen depo sahibi, `version` = `package.json`) çalışır. Gereksiz push/rerun yapılmaz.
- **Her düzenlemeden sonra** — `.claude/settings.json` PostToolUse hook'u (`post-edit-check.mjs`) düzenlenen yönetim dosyasını, dosyanın ait olduğu checkout'ta (worktree dahil) lint'ler ve bulguyu ajana bağlam olarak verir. Engellemez.
- **İstek üzerine** — `npm run harness:lint`, `npm run harness:test` (lint ve guard regresyon testleri).
- **CLS ölçümü** — `npm run harness:cls -- <url> [mobile|desktop] [slow] [--quiet]` (başsız Chrome + CDP; her kaymanın düğümü/dikdörtgeni, toplam CLS en son satırda: `tail -1`; `--quiet`/`CLS_QUIET=1` yalnız toplamı basar; CI'da koşmaz, `CHROME_PATH`/`CLS_WIDTH`/`CHROME_ARGS` ile ayarlanır). Android taklidi: Arial'siz Linux (Docker `node:24-bookworm` + `apt install chromium fonts-roboto`), `CHROME_PATH=/usr/bin/chromium CHROME_ARGS="--no-sandbox --disable-dev-shm-usage"` ve hedef `http://host.docker.internal:<port>`; gerçek cihaz değildir (#755).
- **Mağaza ölçümü (tek komut)** — `npm run harness:measure -- [--build] [--port N] [--base <url>] [--lighthouse] [--lh-runs N] [--runs N] [--product </urun/…>] [--out <dosya.md>] [<yol>...]` (#642): üretim derlemesini ayrı portta (varsayılan 3642) başlatır, `harness:html --json` ile HTML boyutu/RSC payı/gzip/TTFB'yi ve istemci prop baytını ölçer, bitince süreç grubunu kapatır; Markdown tablo basar (`--out` ile dosyaya da yazar; `Text %` sütunu görünür metnin HTML içindeki payıdır, #1289). Varsayılan yollar: `/`, `/katalog`, `/kategori/filtre`, `/marka/bosch`, `/yedek-parca/volkswagen` ve `/kategori/filtre`den seçilen iki ürün (biri uyumlu araçlı); `--product` ürünü değiştirir; arama URL'si kullanılmaz. Port kuralı: 3000 (dev sunucusu) ya da dinleyen herhangi bir port reddedilir (çıkış 2), yabancı süreç öldürülmez; `--base <url>` derleme/başlatmayı atlar (3000 yine reddedilir). `--build` yoksa `.next/BUILD_ID` gerekir; `node_modules` symlink ise (worktree) `--webpack` ile derlenir (Turbopack symlink'li `node_modules` ile derleyemez). Sunucu `STOREFRONT_WARMUP=0`, `ENRICHMENT_LINK_SYNC_INTERVAL_MS=0` ve `BUILD_VERSION=measure-<sha>` ile başlar. `--lighthouse` isteğe bağlıdır: yol başına `--lh-runs` (varsayılan 3) mobil Lighthouse 13.6.0 koşusunun medyanı (LCP/CLS/TBT); ilk kullanımda `npx` paketi indirir, `CHROME_PATH` dikkate alınır, hata olursa sütunlar `—` kalır. Yalnız rapor verir; bir sayfa 200 değilse çıkış 1. Taban (canlı getirbakim.com v0.36.0, 2026-11-21, yalnız boyutlar):

  | Route | HTML KB | RSC KB (%) | gzip KB | Client props KB | Target | Status |
  |---|---|---|---|---|---|---|
  | / | 368.3 | 179.7 (49) | 53.6 | 61.5 | ≤400 | ok |
  | /katalog | 335.6 | 167.6 (50) | 45.3 | 44.7 | ≤400 | ok |
  | /marka/bosch | 318.1 | 160.3 (50) | 41.5 | 37.7 | ≤400 | ok |
  | /kategori/filtre | 384.5 | 188.6 (49) | 48.6 | 57.6 | ≤400 | ok |
  | /yedek-parca/volkswagen | 386.0 | 201.7 (52) | 49.2 | 47.4 | ≤400 | ok |
  | /arac-markalari | 313.3 | 180.6 (58) | 38.2 | 45.6 | ≤400 | ok |
  | ürün, tipik (FEBI 108358) | 137.4 | 73.9 (54) | 25.3 | 9.8 | ≤150 | ok |
  | ürün, 48'in en ağırı (SWAG 50104788) | 219.5 | 120.6 (55) | — | 23.8 | ≤150 | +70 |
- **HTML ağırlığı ölçümü** — `npm run harness:html -- <taban-url> <yol>... [--runs N] [--top N] [--budget "<önek>=<KB>,…"]` (bağımlılıksız; saf işlevler `scripts/harness/html-weight.mjs`te; yol başına HTML boyutu, `__next_f` RSC payı, class öznitelikleri (`classKB`), payload modül satırları (`modKB`), gzip, ilk koşu hariç TTFB medyanı ve istemci bileşeni başına prop baytı; CI'da koşmaz). Üretim derlemesine (`npm run build` + `npx next start -p <port>`) karşı koşulur; arama URL'leri (`/katalog?q=`) aramayı veritabanına yazdığı için kullanılmaz. #642 hedefleri (ürün sayfası ≤ 150 KB, liste sayfası ≤ 350 KB ham HTML) henüz tutturulmadı; 18 Kas 2026 üretim derlemesi ölçümü: liste 374–445 KB (gzip 48–60 KB), tipik ürün 169–176 KB, en uzun uyumlu araç listesi (BOSCH 1457436088) 437 KB. Liste hedefinin ham ≤ 400 KB / gzip ≤ 60 KB olarak yeniden belirlenmesi önerildi; **sahip kararı (22 Kas 2026, #1212/#1214): liste sayfaları ve ana sayfa ≤ 400 KB ham HTML** (`harness:measure` bütçesi ana sayfa için #1295 sonrası `/=250`, yerel webpack ölçümü 268,5 → 228,5 KB; liste önekleri `=400`, ürün `/urun/=150`).
  `--budget "/urun/=160,/=410"`: en uzun eşleşen yol öneki o sayfanın ham HTML sınırını (KB) verir (`/` yalnız ana sayfayı eşler); aşılırsa çıkış kodu 1. Bulgu (#642, ilk dilim): büyük sunucu→istemci prop kalmadı; kalan ağırlık kabuk (~100 KB/sayfa) ile sunucuda render edilen işaretlemedeki utility class dizilerinin HTML + flight'ta iki kez gönderilmesidir. Bu yüzden tekrarlanan öğeler `src/app/storefront.css`teki adlı sınıflara (aynı utility'lerin `@apply` kopyası, görünüm aynı) taşındı; `npm run test:html-weight` kart/chip boyutunu korur. Yerel `next build --webpack` + `next start` ölçümü (5 koşu), önce → sonra (htmlKB): `/katalog` 392,5 → 375,4; `/kategori/filtre` 438,5 → 416,0; `/marka/bosch` 357,6 → 349,2; `/yedek-parca/volkswagen` 443,9 → 429,3; `/arac-markalari`, ürün sayfaları ve `/iletisim` değişmedi (bu dilimin dokunduğu işaretleme yok; ürün 140–145 KB, uyumlu araçlı BLUEPRINT ürünü 240 KB); `classKB` 66,6 → 52,9 (katalog), 70,9 → 57,2 (filtre), 67,9 → 55,9 (volkswagen). Ana sayfa 398,6 → 399,8 (veri farkı; `.home-*` sınıfları zaten vardı).
  Kabuk kırpma (#1133): ödeme altbilgisi yalnız `/siparis-olustur` yerleşiminde, ülke/para birimi `Select`leri düz metin, 404 `ui/button` olmadan, `HeaderPin` `RouteFrame`e katıldı ve üst bilgi/altbilgi/sosyal bağlantı/çerez düğmesi adlı sınıflara taşındı (aynı BUILD_VERSION ile iki derleme, 5 koşu), önce → sonra (htmlKB): `/iletisim` 99,6 → 75,0; `/sepet` 104,6 → 80,6; `/siparis-olustur` 105,6 → 90,8; `/` 405,2 → 381,6; `/katalog` 368,8 → 344,9; `/kategori/filtre` 411,8 → 387,8; ürün sayfası 209,8 → 185,2. Tek amaçlı görsel fark: ≥601 px'te ülke/para birimi okunun kalkması (tek seçenekli açılır liste).
  İstemci görünümleri (#1212, #1214): sunucu bileşeninin işaretlemesi iki kez gider (HTML + RSC flight), istemci bileşenininki bir kez (HTML) artı prop'ları. Bu yüzden tekrarlanan listeler küçük `"use client"` görünümlerdir ve sunucuda hazırlanmış, serileştirilebilir dizgi prop'larıyla beslenir: liste kartı `CatalogProduct` (sunucu adaptörü; fiyat, servis indirimi, kampanya metni `listingCardModel` ile sunucuda) → `CatalogProductCard`; ana sayfa kartı `HomeProductCard` → `HomeProductCardView`; marka sayfası model listesi `VehicleModelList` → `VehicleModelListView` (`[başlık, [slug, ad, yıllar][]]`). SSR HTML'i, DOM ve sınıf adları aynı kalır (SEO/görünüm aynı); istemcide tarih/sayı biçimleme ya da ad sözlüğü yoktur. `npm run test:html-weight` görünümlerin `"use client"` olduğunu ve adaptörlerin kendi işaretlemesi olmadığını, `npm run test:listing-card` kart modelini korur. Yerel `next build --webpack` + `next start`, 5 koşu, önce (`ba9d71f42`) → sonra (htmlKB / RSC KB): `/` 385,4 / 187,4 → 344,8 / 146,7; `/katalog` 351,2 / 179,1 → 293,3 / 121,2; `/kategori/filtre` 387,1 / 193,5 → 323,4 / 129,8; `/marka/bosch` 345,9 / 177,0 → 283,3 / 114,4; `/yedek-parca/volkswagen` 415,4 / 220,5 → 318,3 / 123,4; `/yedek-parca/volkswagen/golf-7` 364,3 → 303,6; `/kategori/filtre/volkswagen` 381,1 → 317,0; `/arac-markalari` (dokunulmadı) 317,1 → 317,1; ürün sayfası 149,7 → 149,7. gzip 1–4 KB azaldı.
- **CSS ağırlığı ölçümü** — `npm run harness:css [-- <dosya.css>... --next]` (projenin PostCSS + Tailwind'i dışında bağımlılıksız; `compileCss` işlevi `scripts/test-stylesheet-scope.ts`te de kullanılır; CI'da koşmaz). Varsayılan olarak `src/app/globals.css` (vitrin) ve `src/app/admin.css` (`/yonetim`) sayfalarını derlemedeki gibi küçültüp ham ve gzip -9 boyutunu yazar; `--next` son `npm run build`ün `.next/static/chunks/*.css` parçalarını da listeler ve `/yonetim` kenar çubuğu utility'lerini (`collapsible=icon`) taşıyanı `admin` diye işaretler. #1027 ölçümü (küçültülmüş, gzip -9): eski `globals.css` 318,6 / 48,1 KB → vitrin `globals.css` 245,3 / 37,7 KB; `admin.css` 248,4 / 38,7 KB (yalnız `/yonetim` yükler, vitrin sayfasından istemci gezinmesiyle gelindiğinde kalır). `--breakdown` her sayfa için üst düzey blok başına bayt döker (`@layer theme/base/components/utilities`, `@property`, diğer). **Vitrin stil sayfası ağırlığı (#1288):** `dark:` varyantları vitrinde kullanılmaz (`.dark` yalnız `/yonetim` altında açılır), bu yüzden 26 sınıf `globals.css`te `@source not inline(...)` ile dışarıda tutulur (`admin.css` yine üretir; `npm run test:stylesheet-scope` iki yönü de doğrular; 244,8 → 238,4 KB, gzip 37,6 → 37,0 KB). Bileşim (öncesi): utilities 167,6 KB (48,8 KB'ı yalnız `ui/*`ten), components 62,7 KB, `@property` 10,1 KB, base/theme ~13 KB. Liste/ürün kurallarını rota stil sayfasına taşımak reddedildi: ikinci bir render-blocking istek ekler. Yalnız-anasayfa stil sayfası ayrı bir spike: sayfalar arası cascade riski var ve Tailwind 4.3.3 `@layer` içinde iç içe `@source`/`@utility`ye izin vermiyor. `npm run harness:css-chunks` (CI'da `npm run build` sonrası) derleme manifestlerinden (`entryCSSFiles`) `/yonetim` dışındaki hiçbir segmentin `admin` parçasını bağlamadığını ve `/yonetim` segmentlerinde vitrin sayfasının önce geldiğini doğrular.
- **CI** — `.github/workflows/ci.yml` lint'ten sonra `harness:lint` + `harness:test` koşar.

## Ürün sayfası HTML bütçesi (#1211)

Uzun uyumlu araç ve OEM listeli ürün sayfaları `/urun/=150` bütçesinin çok üstündeydi: OEM satırları sunucuda render edildiği için HTML + flight'ta iki kez gidiyordu, "Uyumlu araçlar" 20 grup başlığı (her birinde iki lucide svg) ve bu grupların motor satırlarını prop olarak taşıyordu. Değişiklik: "Uyumlu araçlar" ilk 8 grubu basar (`fitmentInitialGroups`), grup başlığında svg yok (chevron ve ok `storefront.css`te CSS maskesi), seçimler ve metin düğmeleri adlı sınıflı düz öğeler (`.fitment-select`, `.fitment-text-button`); "OEM ve muadil numaraları" `ProductReferences` istemci bileşenidir, uzun listede önce bağlantılı, sonra araç üreticisi OEM, sonra diğer marka satırlarından en çok 24 satır / satırda 6 / toplam 72 numara basar, tamamı `/api/product-references/[id]?v=` ile yüklenir. Yerel `next build --webpack` + `next start`, 5 koşu (`npm run harness:measure -- --build --port <port> <yollar>`), htmlKB / RSC KB / gzip KB:

| Ürün | Önce (`df512696e`) | Sonra |
|---|---|---|
| SWAG 50104788 | 229,5 / 127,6 / 35,6 | 155,9 / 87,8 / 28,5 |
| BOSCH 0258986507 | 376,9 / 232,0 / 58,9 | 152,2 / 82,5 / 28,9 |
| BLUEPRINT ADM54282 | 363,4 / 228,3 / 51,0 | 176,0 / 103,7 / 31,6 |
| FEBI 07022 | 339,2 / 207,0 / 51,5 | 160,0 / 88,5 / 29,9 |
| FEBI 102793 (16 model) | 385,6 / 248,9 / 58,2 | 174,1 / 102,5 / 31,6 |
| MAG 300704004900 | 257,1 / 152,2 / 38,4 | 175,3 / 103,7 / 30,9 |

Bütçe ağır örneklerde henüz tutmuyor. Kalan ağırlık: basılan grupların motor satırları `ProductFitment` prop'larında (satır başına ~135 bayt; ağır örneklerde 8 grupta 129–140 satır, flight'ta ~20–23 KB; kapalı panel DOM'da olmadığı halde) ve webpack derlemesinin istemci referans satırları (`I[…]`, sayfa başına ~27 KB; canlıdaki Turbopack derlemesinde daha kısa). Sıradaki adım motor satırlarını grup açılınca yüklemek ya da satırları dizi olarak taşımaktır.

## Yerel ortam notları
- Ana checkout `/Users/void/www/getirbakim` dalı `dev`'de durur; dev sunucusu `localhost:3000` (öldürülmez, worktree kodunu göstermez).
- Worktree'ler `../getirbakim-<N>`; `.env.local` ve `node_modules` ana checkout'a symlink (lint/tsc/test için yeterli). Tarayıcı QA'sı için worktree'de gerçek `npm ci` + `npx next dev -p 31NN` (Turbopack symlink'li `node_modules` ile çalışmaz); QA bitince sunucu kapatılır.
- Herdr içinde worktree `herdr worktree create … --path ../getirbakim-<N>` ile açılır (kenar çubuğu ağacı).
- Yerel DB tüm worktree'lerin ortak veritabanıdır: veri yazan komutlar plan açıkça istemedikçe koşulmaz. `npm run db:setup` ortak DB'ye dalın `db/*.sql` kümesini uygular; önce `git fetch origin && git rebase origin/dev` şart, `scripts/flow/db-setup-guard.mjs` dal `origin/dev`'in gerisindeyse reddeder (bilinçli geçiş: `DB_SETUP_ALLOW_STALE=1`). Ajanlar ortak kurulum yerine izole şema testini (`scripts/isolated-schema.ts`) tercih eder; ortak kurulumdan önce diğer oturumlara haber verilir (#589).
- Eşleştirici kilitleri (20261001, 5 = eşleştirici/durum senkronu, 6 = yönetim yeniden gruplama, 7 = marka kararları) `public` dışındaki şemalarda şemaya özgü türetilir (`schema_lock_key`); `public` anahtarları değişmez. İzole şema testleri bu kilitleri beklemez: `public`'te çalışan bir eşleştirici izole `refresh_product_matches()` çağrısını bekletmez (#792, #829).

## Ajan eklemek/değiştirmek
1. `.claude/agents/<ad>.md` Markdown'ını düzenle (frontmatter: `name`, `description`, `tools`, `model`). `tools` her ajanda yazılır: yoksa ajan oturumdaki tüm MCP araçlarını devralır ve her çağrıda ~45k token fazladan yükler (#1086). Brief kendi kendine yetmeli: alt ajanlar sohbeti görmez. Ajan/oturum başına ilk tur bağlamını `node scripts/harness/context-usage.mjs [YYYY-AA-GG]` ölçer.
2. Ajan/skill talimatları ve `AGENTS.md` **İngilizce** yazılır (Türkçe aynı içerik için ~%30–50 daha fazla token tutar; bu dosyalar her oturumda ve her alt ajanda yüklenir). Kullanıcıya dönüş, Issue gövdesi ve UI metinleri Türkçe kalır; bunlar talimatta kural olarak yazılır. İnsanlara yönelik belgeler (`docs/**`) Türkçe kalır (#1079).
3. Proje `.claude/settings.json` içinde ilgisiz kullanıcı eklentilerini kapatır (`enabledPlugins`, ör. Vercel — proje AWS'de); yeni bir eklenti her oturuma skill/araç listesi ekler, gerekmedikçe açma.
4. `AGENTS.md`/`DESIGN.md`/akış kuralı değişirse onu uygulayan ajanı ve kural mekanikse lint/guard'ı (testleriyle) güncelle.
5. Değişikliği her iş gibi gönder: Issue → worktree → PR (`chore(platform): …`).
