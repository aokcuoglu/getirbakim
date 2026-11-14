---
name: design-check
description: Audit getirbakim UI against the /yonetim stock-shadcn rule (AGENTS.md) and the storefront language (DESIGN.md) — deterministic admin-ui-lint first, then a getirbakim-ui-ux review of the diff (screenshots if a server is given). Use for "/design-check", "/design-check <path>", or before opening a PR that touches .tsx/.css files.
argument-hint: [--changed | yol…] [rotalar…]
---

Argümanlar: `$ARGUMENTS` (varsayılan `--changed`).

1. Worktree'de (repo geneli denetim için ana checkout'ta) `node scripts/harness/admin-ui-lint.mjs <argümanlar veya --changed>` koş; bulguları aynen yapıştır. `error` satırları PR için engelleyicidir (CI de koşar), `warning` (köşe/gölge) bağlamda yargılanır.
2. `getirbakim-ui-ux`'i worktree yolu, kapsamdaki dosya/yollar ve verilen rotalarla çağır. Ekran görüntüsü yalnız çalışan bir worktree sunucusu (ör. `/qa`'nın açtığı 31NN portu) varsa iste; 3000 ana checkout'u gösterir, worktree'yi değil.
3. Tek liste halinde birleştir: 🔴 → 🟡 → 🟢, dosya:satır ve düzeltmeyle. Repo geneli denetimde bileşen/sayfa bazında grupla ve yerinde düzeltmek yerine `/issue` ile Issue öner.
