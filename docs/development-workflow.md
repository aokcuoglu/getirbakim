# Geliştirme, sürümleme ve yayın politikası

Karar tarihi: 11 Ekim 2026. Bu rehber sonraki geliştirme ve düzeltmelerin varsayılan çalışma akışıdır. Kullanıcının işe özel güncel talimatı önceliklidir. Ajanlar işe başlamadan önce bu rehberi okumalıdır.

## Geliştirme akışı

**Yerel inceleme → ayrı worktree → GitHub Issue → geliştirme ve doğrulama → PR → `dev` merge.**

1. Yerelde mevcut durumu, ilgili kodu ve çalışma ağacını incele. Ana checkout'taki devam eden işleri koru.
2. Güncel `origin/dev` üzerinden işe özel, ayrı worktree oluştur. Değişiklikleri bu worktree'de yap; ana checkout veya başka işe ait worktree'de geliştirme yapma.
3. Dosya değiştirmeden önce GitHub Issue aç. Amaç, kapsam ve kabul kriterlerini yaz. Issue numarası belli olduktan sonra branch adını `<tür>/<issue>-<kısa-konu>` biçimine getir: `feat/142-basbug-product-admin`, `fix/146-stock-filter`, `docs/145-development-release-policy`. Kapsam açıkça mevcut bir Issue'ya aitse o Issue'yu kullan.
4. Yalnızca ilgili işi uygula. Başka çalışmaların değişikliklerini PR'a taşıma; onların dosyalarını, commit'lerini veya worktree'lerini temizleme. Ortak yerel veritabanına yazan işlemler de diğer worktree'leri etkileyebilir; veri işlemlerinin kapsamını ayrıca kontrol et.
5. Değişikliğe uygun testleri, tür kontrolünü ve lint'i çalıştır. Arayüz değişikliklerini tarayıcıda masaüstü ve mobil görünümle doğrula. CI'daki zorunlu kontrolleri koru; geçmeyen kontrollerle merge yapma.
6. Hedefi `dev` olan PR aç. Başlıkta commit türünü kullan; açıklamada problem, ortaya çıkan davranış, doğrulama ve varsa migration/operasyon ihtiyacını yaz. `Closes #<issue>` ile Issue'yu bağla. Issue ve PR etiketlerini tutarlı uygula.
7. Güncel PR commit'i için zorunlu CI kontrolleri geçtikten sonra `dev`'e merge et. Kullanıcının farklı hedef veya bekleme talebi yoksa bu adım çalışma kapsamına dahildir; yeniden izin isteme. Korumaları atlama.
8. Issue/PR bağlantılarını, doğrulama sonucunu ve merge durumunu bildir. Worktree temizliği sırasında yalnız bu işe ait, merge edilmiş ve kirli olmayan worktree'yi kaldır; diğerlerini koru.

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

`dev` geliştirmelerin birleştiği branch'tir. `main` sürüme alınan kodu temsil eder. Rutin `dev` merge'i `main` merge yetkisi vermez. `main`'e geçiş, sürüm hazırlığı ve GitHub Release oluşturma kullanıcının sürüm çıkarma talebi kapsamında yapılır.

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
3. Hazırlığı kontrol ve PR üzerinden `dev`'e merge et. Sonrasında kapsamı belirli `dev` → `main` sürüm PR'ını aç; sürüm etiketini ve doğrulamayı ekle. Kullanıcının onayladığı sürüm kapsamı ve zorunlu CI geçtikten sonra merge et.
4. İlgili `main` merge commit'ine açıklamalı (annotated) `vX.Y.Z` Git tag'i koy ve aynı sürümün GitHub Release notlarını yayımla. Tag ve Release notlarında sürüm kapsamını ve PR'ı belirt. Mevcut tag'leri taşıma, silme veya üzerine yazma.
5. Merge, sürüm numarası, tag ve Release bağlantısını bildir. Tag/Release oluşturulması sunucu deploy'u başlatmaz.

11 Ekim 2026 itibarıyla `main` geçmişindeki en yüksek normal sürüm tag'i `v0.22.0`, mevcut paket sürümü ise `0.1.0`'dır. Eski GitHub Release kayıtları da legacy döneme aittir. Sonraki sürüm hazırlığında ilgili yeni sistemin tag geçmişi esas alınarak manifestler uyumlu hale getirilir; eski etiketlerden veya `0.1.0` değerinden bağımsız, geriye giden sürüm üretilmez. Bu politika çalışması sürüm artırmaz.

## Deploy ve staging kararı

- Commit, push, PR, `dev`/`main` merge, tag veya GitHub Release sonrasında **otomatik Contabo deploy yapılmaz**.
- Şu aşamada staging kurulmaz veya güncellenmez. AWS'e taşındıktan sonra staging, kullanıcının ayrı talebiyle tasarlanır ve devreye alınır. AWS geçişi tek başına staging/deploy otomasyonu açma yetkisi vermez.
- Production deploy yalnızca kullanıcının açık yayınlama talebiyle manuel başlatılır. `dev` merge veya `main` sürüm talebi kendi başına deploy talebi sayılmaz.
- PR CI kontrolleri devam eder. CI build'inde kullanılan ortam ayarları bir staging sunucusu kurmaz veya mevcut sunucuya bağlanmaz.
- Mevcut canlı servisler, zamanlayıcılar, yedekler ve veriler bu karar nedeniyle durdurulmaz veya silinmez. Bu karar geliştirme sonrası kod dağıtımını düzenler.

Repo tarafında staging workflow'u yalnızca duraklatma mesajı içerir; hiçbir SSH, image aktarımı veya deploy adımı yoktur. Production workflow'unda `push` tetikleyicisi kaldırılmıştır; yalnız `workflow_dispatch` ve `main` koşulu vardır. GitHub tarafında her iki deploy workflow'u da 11 Ekim 2026'da devre dışı bırakılmış, bekleyen/çalışan iki staging run'ı iptal edilmiştir.

Production workflow'u yeniden etkinleştirilmeden önce `main` üzerindeki dosyanın da manuel tetikleme politikasını içerdiği doğrulanmalıdır; değişiklik önce `dev`'e alınır. Yeniden etkinleştirme ve dispatch yalnızca açık deploy talebi kapsamında yapılır. Staging için önce AWS tasarımı ve workflow revizyonu gerekir. Operasyon dosyaları tarihsel bilgi olarak [geçiş rehberinde](deployment-migration.md) korunur; buradaki güncel yayın politikası önceliklidir.
