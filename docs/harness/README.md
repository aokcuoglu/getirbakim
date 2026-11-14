# getirbakim ajan altyapısı (Claude Code)

> Claude Code'un getirbakim'i nasıl geliştirdiği: bir orkestratör, altı uzman alt ajan, deterministik kontroller ve sabit bir hat. Akış politikası: [`docs/development-workflow.md`](../development-workflow.md). Kurallar: [`AGENTS.md`](../../AGENTS.md), [`DESIGN.md`](../../DESIGN.md). Yapı plantx'teki ortamdan uyarlandı.

## Hat

```
/ship <issue>                 (ana oturum = orkestratör)
   │
   ├─ 1 worktree               ../getirbakim-<N>  (dal <tür>/<N>-<konu>, origin/dev'den)
   ├─ 2 getirbakim-planner     salt okur → plan (dosyalar, yeniden kullanım, SQL/yetki etkisi, testler, QA rotaları)
   ├─ 3 getirbakim-developer   worktree'de uygular, test ekler, commit'ler, lint + tsc + testler
   ├─ 4 getirbakim-reviewer  ┐ paralel, salt okur → bulgular → geliştiriciye (≤2 döngü)
   │    getirbakim-ui-ux     ┘ (yalnız .tsx/.css değiştiyse)
   ├─ 5 getirbakim-qa          kontroller + kısa ömürlü worktree sunucusunda (31NN) Chrome turu, masaüstü + mobil
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
- **Her düzenlemeden sonra** — `.claude/settings.json` PostToolUse hook'u (`post-edit-check.mjs`) düzenlenen yönetim dosyasını, dosyanın ait olduğu checkout'ta (worktree dahil) lint'ler ve bulguyu ajana bağlam olarak verir. Engellemez.
- **İstek üzerine** — `npm run harness:lint`, `npm run harness:test` (lint ve guard regresyon testleri).
- **CI** — `.github/workflows/ci.yml` lint'ten sonra `harness:lint` + `harness:test` koşar.

## Yerel ortam notları
- Ana checkout `/Users/void/www/getirbakim` dalı `dev`'de durur; dev sunucusu `localhost:3000` (öldürülmez, worktree kodunu göstermez).
- Worktree'ler `../getirbakim-<N>`; `.env.local` ve `node_modules` ana checkout'a symlink (lint/tsc/test için yeterli). Tarayıcı QA'sı için worktree'de gerçek `npm ci` + `npx next dev -p 31NN` (Turbopack symlink'li `node_modules` ile çalışmaz); QA bitince sunucu kapatılır.
- Herdr içinde worktree `herdr worktree create … --path ../getirbakim-<N>` ile açılır (kenar çubuğu ağacı).
- Yerel DB tüm worktree'lerin ortak veritabanıdır: veri yazan komutlar plan açıkça istemedikçe koşulmaz.

## Ajan eklemek/değiştirmek
1. `.claude/agents/<ad>.md` Markdown'ını düzenle (frontmatter: `name`, `description`, isteğe bağlı `tools`, `model`). Brief kendi kendine yetmeli: alt ajanlar sohbeti görmez.
2. `AGENTS.md`/`DESIGN.md`/akış kuralı değişirse onu uygulayan ajanı ve kural mekanikse lint/guard'ı (testleriyle) güncelle.
3. Değişikliği her iş gibi gönder: Issue → worktree → PR (`chore(platform): …`).
