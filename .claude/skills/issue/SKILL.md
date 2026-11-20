---
name: issue
description: Turn a short description into a well-formed getirbakim GitHub issue (type, area, goal, where, acceptance criteria, labels) after a quick code survey. Use for "/issue <description>" or when a new development or bug needs an issue before work starts.
argument-hint: <what should change and why>
---

Open a single GitHub Issue for: `$ARGUMENTS`

0. Search first: `gh issue list --state open --search "<keywords>"`. If an open Issue already covers it, comment there instead of opening a new one.
1. Classify (`docs/development-workflow.md`):
   - type ∈ feat|fix|perf|refactor|docs|test|ci|chore → label `enhancement`|`bug`|`refactor`|`documentation`|`ci`|`maintenance`
   - area → `area:admin` (/yonetim), `area:suppliers` (Başbuğ/Dinamik/SETA/manual sync), `area:catalog` (catalog, search, enrichment, vehicle/fitment), `area:commerce` (cart, order, payment, service/B2B), `area:platform` (infra, CI, tooling). Several allowed.
   - behaviour change → `release:minor` (feat) / `release:patch` (fix); no release label for docs/CI/chore only.
2. Survey the code for 1–3 minutes (grep: feature, copy, route) so **Nerede** points at real files and **Kabul kriterleri** are testable. For /yonetim styling add the output of `node scripts/harness/admin-ui-lint.mjs <path>`.
3. Keep it one PR in size; if bigger, open the first slice and list the rest under "Takip".
4. Create it (title English conventional, body Turkish):
```
gh issue create --title "<type>(<area>): <imperative English summary>" --label <type label> --label area:<…> [--label release:<…>] --body "$(cat <<'MD'
### Amaç
<Problem / what should change and why; user-visible behaviour first. 3–8 lines.>

### Nerede
- `src/...` — what exists today

### Kabul kriterleri
- [ ] testable criterion
- [ ] for UI: desktop + mobile (admin: light + dark theme)
- [ ] related test added/updated

### Operasyon
- prod/data step (e.g. `npm run db:setup`, backfill) or "yok"

### Köken
- Found in #N / Part of #N (if any)

### Takip
- (optional)
MD
)"
```
5. Give the Issue URL and title. Do not start work unless asked (then `/ship <N>`).
