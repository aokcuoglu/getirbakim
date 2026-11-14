---
name: issue
description: Turn a short description into a well-formed getirbakim GitHub issue (type, area, goal, where, acceptance criteria, labels) after a quick code survey. Use for "/issue <description>" or when a new development or bug needs an issue before work starts.
argument-hint: <ne değişmeli ve neden>
---

Şunun için tek bir GitHub Issue aç: `$ARGUMENTS`

0. Önce ara: `gh issue list --state open --search "<anahtar kelimeler>"`. Açık bir Issue zaten kapsıyorsa yenisini açma, oraya yorum yaz.
1. Sınıflandır (`docs/development-workflow.md`):
   - tür ∈ feat|fix|perf|refactor|docs|test|ci|chore → etiket `enhancement`|`bug`|`refactor`|`documentation`|`ci`|`maintenance`
   - alan → `area:admin` (/yonetim), `area:suppliers` (Başbuğ/Dinamik/SETA/manuel sync), `area:catalog` (katalog, arama, zenginleştirme, araç/fitment), `area:commerce` (sepet, sipariş, ödeme, servis/B2B), `area:platform` (altyapı, CI, araçlar). Birden fazla olabilir.
   - davranış değişiyorsa `release:minor` (feat) / `release:patch` (fix); salt docs/CI/chore'a sürüm etiketi yok.
2. 1–3 dakika kodu tara (grep: özellik, metin, rota) ki **Nerede** gerçek dosyaları göstersin ve **Kabul kriterleri** test edilebilir olsun. /yonetim stiliyle ilgiliyse `node scripts/harness/admin-ui-lint.mjs <yol>` çıktısını ekle.
3. Tek PR boyunda tut; büyükse ilk dilimi aç, kalanları "Takip" altında listele.
4. Oluştur (başlık İngilizce conventional, gövde Türkçe):
```
gh issue create --title "<tür>(<alan>): <imperative English summary>" --label <tür etiketi> --label area:<…> [--label release:<…>] --body "$(cat <<'MD'
### Amaç
<Problem / ne değişmeli ve neden; önce kullanıcıya görünen davranış. 3–8 satır.>

### Nerede
- `src/...` — bugün ne var

### Kabul kriterleri
- [ ] test edilebilir kriter
- [ ] UI ise masaüstü + mobil (yönetimde açık + koyu tema)
- [ ] ilgili test eklendi/güncellendi

### Operasyon
- prod/veri adımı (ör. `npm run db:setup`, backfill) ya da "yok"

### Köken
- Found in #N / Part of #N (varsa)

### Takip
- (isteğe bağlı)
MD
)"
```
5. Issue URL'sini ve başlığı ver. İstenmedikçe işe başlama (istenirse `/ship <N>`).
