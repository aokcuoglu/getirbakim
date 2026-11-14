---
name: qa
description: Run the getirbakim QA pass (admin-ui-lint, typecheck, lint, relevant tests, then a Chrome walk of the given routes on desktop and mobile on a short-lived worktree server) via the getirbakim-qa agent. Use for "/qa", "/qa <issue|worktree> <routes>", or when a change must be verified in the real app before review/merge.
argument-hint: [worktree yolu | issue no] [rotalar…]
---

Argümanlar: `$ARGUMENTS`

1. Worktree'yi bul: açık yol, Issue numarası (`/Users/void/www/getirbakim-<N>` veya `git worktree list`'te `/<N>-` geçen dal) ya da mevcut dizin (dalı `dev`/`main` değilse). Yalnız ana checkout varsa dur ve hangi worktree'nin test edileceğini sor.
2. Rota listesini kur: argümanlardan; yoksa dalın değişen dosyalarından (`git diff --name-only origin/dev...HEAD` → `src/app/<yol>/page.tsx` → `/<yol>`, `(legal)` gibi grup klasörlerini at, `[id]` için gerçek bir örnek kayıt bul). Issue numarası biliniyorsa kabul kriterlerini ekle.
3. `getirbakim-qa`'yı worktree yolu, rotalar, roller (/yonetim → admin, servis sayfaları → servis, mağaza → ziyaretçi) ve kabul kriterleriyle çağır.
4. QA raporunu kullanıcıya olduğu gibi ilet (tablo + karar). `/ship` içindeysen ve karar ❌ ise engelleyicileri geliştirici ajana gönder; değilse kullanıcıya bırak.
