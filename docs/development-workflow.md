# Geliştirme, sürümleme ve yayın politikası

Karar tarihi: 11 Ekim 2026. Bu rehber sonraki geliştirme ve düzeltmelerin varsayılan çalışma akışıdır. Kullanıcının işe özel güncel talimatı önceliklidir. Ajanlar işe başlamadan önce bu rehberi okumalıdır.

## Geliştirme akışı

**Yerel inceleme → ayrı worktree → GitHub Issue → geliştirme ve doğrulama → PR → `dev` merge.**

1. Yerelde mevcut durumu, ilgili kodu ve çalışma ağacını incele. Ana checkout'taki devam eden işleri koru.
2. Güncel `origin/dev` üzerinden işe özel, ayrı worktree oluştur. Değişiklikleri bu worktree'de yap; ana checkout veya başka işe ait worktree'de geliştirme yapma.
3. Dosya değiştirmeden önce GitHub Issue aç. Amaç, kapsam ve kabul kriterlerini yaz. Issue numarası belli olduktan sonra branch adını `<tür>/<issue>-<kısa-konu>` biçimine getir: `feat/142-basbug-product-admin`, `fix/146-stock-filter`, `docs/145-development-release-policy`. Kapsam açıkça mevcut bir Issue'ya aitse o Issue'yu kullan.
4. Yalnızca ilgili işi uygula. Başka çalışmaların değişikliklerini PR'a taşıma; onların dosyalarını, commit'lerini veya worktree'lerini temizleme. Ortak yerel veritabanına yazan işlemler de diğer worktree'leri etkileyebilir; veri işlemlerinin kapsamını ayrıca kontrol et. `npm run db:setup` öncesi dalı `origin/dev` üzerine rebase et (betik gerideki dalı reddeder; bilinçli geçiş `DB_SETUP_ALLOW_STALE=1`) ve ortak kurulumu diğer oturumlara haber vererek çalıştır.
5. Değişikliğe uygun testleri, tür kontrolünü ve lint'i çalıştır. Arayüz değişikliklerini tarayıcıda masaüstü ve mobil görünümle doğrula. CI'daki zorunlu kontrolleri koru; geçmeyen kontrollerle merge yapma.
6. Hedefi `dev` olan PR aç. Başlıkta commit türünü kullan; açıklamada problem, ortaya çıkan davranış, doğrulama ve varsa migration/operasyon ihtiyacını yaz. `Closes #<issue>` ile Issue'yu bağla. Issue ve PR etiketlerini tutarlı uygula.
7. Güncel PR commit'i için zorunlu CI kontrolleri geçtikten sonra `dev`'e merge et. Kullanıcının farklı hedef veya bekleme talebi yoksa bu adım çalışma kapsamına dahildir; yeniden izin isteme. Korumaları atlama.
8. Issue/PR bağlantılarını, doğrulama sonucunu ve merge durumunu bildir. Worktree temizliği sırasında yalnız bu işe ait, merge edilmiş ve kirli olmayan worktree'yi kaldır; diğerlerini koru.

`db/*.sql` dosyaları her yayında, önceki sürüm trafik alırken yeniden koşar; ikinci koşu hiçbir tablo veya görünümde ACCESS EXCLUSIVE almamalıdır (#925, #954). Yeni kolon `pg_attribute` bekçili `DO $$` bloğuyla yalnız eksikse eklenir (`ADD COLUMN IF NOT EXISTS` boşa da kilitler); görünüm geçici `pg_temp.setup_view_probe` görünümüyle `pg_get_viewdef` karşılaştırılarak yalnız tanımı değişince değiştirilir (örnek `db/commerce.sql`; kolon silme/yeniden sıralama yine `DROP VIEW` ister); sıcak tablodaki tetikleyici `tgrelid` + `tgname` bekçisiyle yalnız yoksa oluşturulur; her `CREATE INDEX` `pg_index` + `indrelid` bekçili `DO $$` bloğunda yalnız yoksa oluşturulur (`CREATE INDEX IF NOT EXISTS` boşa da SHARE alıp yazıcıları bekletir, #964, #993). `npm run test:setup-locks` (CI) bunları izole şemada denetler.

Yerel sunucu başlatırken port çakışmasını kontrol et. `.env.local`, API yanıtları, veri snapshot'ları, tokenlar ve erişim bilgileri Git'e girmez. Next.js kodu değişecekse `AGENTS.md` içindeki kurala göre kurulu sürümün ilgili rehberini önce oku.

## Commit ve branch adları

Commit ve PR başlıklarında [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) kullanılır: `<tür>(<alan>): <somut değişiklik>`.

| Tür | Kullanım | Örnek |
| --- | --- | --- |
| `feat` | Yeni özellik veya belirgin işlev geliştirmesi | `feat(suppliers): depo stoklarını yönetimde göster` |
| `fix` | Hatalı davranışın düzeltilmesi | `fix(stock): eksik depo verisini stok yok sayma` |
| `perf` | Performans iyileştirmesi | `perf(sync): değişiklik sorgusuna indeks ekle` |
| `refactor` | Davranışı koruyan kod düzenlemesi | `refactor(admin): ortak filtre bileşenini ayır` |
| `docs` | Dokümantasyon | `docs(workflow): geliştirme politikasını tanımla` |
| `test`, `ci`, `chore` | Test, CI ve bakım işleri | `ci(deploy): otomatik Contabo yayınını kapat` |

Uyumluluğu bozan değişikliklerde `!` ve açıklayıcı `BREAKING CHANGE:` gövdesi kullanılır; etkiler ve geçiş adımları Issue/PR'da yazılır. Commit gövdesinde veya başlığının sonunda Issue numarası belirtilir. Küçük, anlamlı commit'ler tercih edilir.

## GitHub etiketleri

Her Issue ve PR'a bir ana iş türü ve en az bir alan etiketi verilir. Birden fazla alan etkileniyorsa ilgili alanlar birlikte kullanılabilir. Eksik etiket aynı ad ve açıklamayla oluşturulur.

| Etiket | Anlamı |
| --- | --- |
| `enhancement` | Özellik (`feat`) |
| `bug` | Hata düzeltmesi (`fix`) |
| `documentation` | Dokümantasyon (`docs`) |
| `refactor` | İç düzenleme veya performans (`refactor`, `perf`) |
| `ci` | CI veya deploy workflow değişikliği |
| `maintenance` | Diğer bakım ve test işleri (`chore`, `test`) |
| `area:admin`, `area:suppliers`, `area:catalog`, `area:commerce`, `area:platform` | Yönetim, tedarikçiler, katalog, ticaret veya altyapı alanı |
| `release:minor`, `release:patch`, `release:major` | Özellik, düzeltme veya uyumluluk bozan değişikliğin planlanan sürüm etkisi |

Davranış değişikliği taşıyan işlerde sürüm etkisi etiketi kullanılır; salt dokümantasyon/CI işine kendiliğinden ürün sürümü atanmaz. Etiketler sınıflandırma içindir; sürüm yayımlamaz ve deploy başlatmaz.

## `main` sürümleri ve Git tag'leri

`dev` geliştirmelerin birleştiği branch'tir. `main` production'a çıkabilecek sürümlü kodu temsil eder; AWS yayını `main` üzerinden elle tetiklenir (aşağıdaki deploy kararı). Rutin `dev` merge'i `main` merge yetkisi vermez; `main`'e push, `dev` → `main` merge veya `main`'i değiştiren her işlem (doğrudan push, `gh api` ref güncellemesi dahil) öncesinde kullanıcının **açık onayı** alınır. Onay istenirken sürüm numarası ve kapsam gösterilir; bir sürüm için verilen onay sonrakini kapsamaz. `main`'e doğrudan commit veya hotfix push yapılmaz; acil düzeltmeler de `dev` üzerinden sürüm PR'ı ile gider. `main`'e geçiş, sürüm hazırlığı ve GitHub Release oluşturma kullanıcının sürüm çıkarma talebi kapsamında yapılır.

Sürüm numarası [SemVer](https://semver.org/) biçimindedir: `MAJOR.MINOR.PATCH`. Önemli, geriye uyumlu özellikler `feat` olarak sınıflandırılır ve `main` sürümünde **MINOR** artırılır. Bir sürüm birden fazla işi içerebilir; en yüksek etki sürüm artışını belirler.

| İçerik | Artış | Örnek |
| --- | --- | --- |
| Yeni veya önemli, geriye uyumlu özellik | MINOR; PATCH sıfırlanır | `0.22.3 → 0.23.0` |
| Geriye uyumlu hata düzeltmesi | PATCH | `0.23.0 → 0.23.1` |
| Kararlı API/sözleşmede uyumluluğu bozan değişiklik | MAJOR; MINOR/PATCH sıfırlanır | `1.4.2 → 2.0.0` |

`0.x` geliştirme döneminde kararlılık ve `1.0.0` geçişi ayrıca kararlaştırılır; otomatik olarak büyük sürüm ilan edilmez. Salt dokümantasyon/CI düzenlemesi tek başına ürün sürümü gerektirmez. Her commit veya PR için sürüm tag'i oluşturulmaz; tag tamamlanmış `main` sürümünü işaretler.

Sürüm çıkarırken:

1. `origin/main..origin/dev` kapsamını, son ilgili `main` sürüm tag'ini ve manifest sürümlerini incele. Release içine girecek tüm işleri ve sürüm etkilerini listele; ilgisiz veya hazır olmayan işleri dahil etme.
2. Sürüm hazırlığını ayrı worktree/branch ve Issue ile takip et. `package.json` ve `package-lock.json` sürümlerini birlikte güncelle. `CHANGELOG.md` dosyasına sürümün özelliklerini, düzeltmelerini, Issue/PR bağlantılarını ve varsa migration adımlarını yaz; dosya yoksa ilk sürüm hazırlığında oluştur.
3. Hazırlığı kontrol ve PR üzerinden `dev`'e merge et. Sonrasında kapsamı belirli `dev` → `main` sürüm PR'ını aç; sürüm etiketini ve doğrulamayı ekle. Merge'den hemen önce kullanıcıdan açık onay al; onaylanan sürüm kapsamı ve zorunlu CI geçtikten sonra merge et. Merge deploy başlatmaz.
4. İlgili `main` merge commit'ine açıklamalı (annotated) `vX.Y.Z` Git tag'i koy ve aynı sürümün GitHub Release notlarını yayımla. Tag ve Release notlarında sürüm kapsamını ve PR'ı belirt. Mevcut tag'leri taşıma, silme veya üzerine yazma.
5. Merge, sürüm numarası, tag ve Release bağlantısını bildir.
6. Production yayını ayrı adımdır: kullanıcı açıkça onaylarsa `main` üzerinden `release-aws` workflow'unu elle tetikle, GitHub `production` ortam onayını kullanıcıya bırak, sonucu ve smoke testleri bildir.
7. Sürümde `data/vehicle_type_oil_specs.csv` veya `scripts/import-vehicle-oils.ts` değiştiyse: `release-aws` / `db:setup` bu veriyi içe aktarmaz. CHANGELOG "Deploy and operations" bölümüne yaz ve yayından sonra operations görevinde `scripts/import-vehicle-oils.ts` çalıştırılmasını hatırlat (`release-check` skill'inde `ecs run-task` biçimi var). AWS'de bunun için tanımlı bir otomasyon yoktur; açık iştir (#565).

11 Ekim 2026 itibarıyla `main` geçmişindeki en yüksek normal sürüm tag'i `v0.22.0`, mevcut paket sürümü ise `0.1.0`'dır. Eski GitHub Release kayıtları da legacy döneme aittir. Sonraki sürüm hazırlığında ilgili yeni sistemin tag geçmişi esas alınarak manifestler uyumlu hale getirilir; eski etiketlerden veya `0.1.0` değerinden bağımsız, geriye giden sürüm üretilmez. Bu politika çalışması sürüm artırmaz.

## Deploy ve staging kararı

Karar tarihi: 14 Kasım 2026 (11 Ekim 2026 Contabo kararının yerine geçer).

- Production AWS'tedir. Yayın, `main` üzerinden `release-aws.yml` workflow'unun elle (`workflow_dispatch`) tetiklenmesiyle yapılır; GitHub `production` ortamı onay ister. `main`'e push/merge kendi başına deploy etmez.
- Akış: `dev`'de geliştirme → kullanıcı onayıyla sürümlü `dev → main` merge → kullanıcının ayrı ve açık yayın onayıyla `release-aws` tetikleme. İki onay birbirinin yerine geçmez.
- `dev` merge'i hiçbir ortama deploy etmez. Staging yoktur; kurulması kullanıcının ayrı talebiyle tasarlanır.
- Contabo'ya otomatik deploy yapılmaz. Eski `deploy-production.yml` / `deploy-staging.yml` workflow'ları GitHub'da devre dışıdır ve açık talep olmadan etkinleştirilmez.
- CI kontrolleri zorunludur; geçmeyen kontrollerle `dev`'e de `main`'e de merge yapılmaz. Deploy workflow'larını açık talep olmadan değiştirme veya tetikleme.
- Mevcut canlı servisler, zamanlayıcılar, yedekler ve veriler bu karar nedeniyle durdurulmaz veya silinmez.

Operasyon dosyaları tarihsel bilgi olarak [geçiş rehberinde](deployment-migration.md) korunur; buradaki güncel yayın politikası önceliklidir.
