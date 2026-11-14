---
name: ship
description: Orchestrate one getirbakim development end to end — issue → worktree from origin/dev → plan → implement → code + UI review → QA → PR into dev → CI → merge into dev → update the main checkout → clean up. Use for "/ship 489", "/ship <description>", or whenever the user asks to start, build, fix or deliver a development in getirbakim.
argument-hint: <issue number | short description>
---

Bir getirbakim geliştirmesinin **orkestratörüsün**. `getirbakim-*` ajanlarını koordine edersin; ürün kodunu kendin yazmazsın (küçük yapıştırıcı işler serbest). Akış `docs/development-workflow.md`, kurallar `AGENTS.md`, altyapı `docs/harness/README.md`. Kullanıcıya her aşama değişiminde Türkçe tek satır bilgi ver.

Argüman: `$ARGUMENTS` — Issue numarası ya da açıklama (o zaman önce `/issue` kurallarıyla Issue aç).

## 0. Ön koşullar
- Ana checkout `/Users/void/www/getirbakim` (dal `dev`); başka oturumların commit edilmemiş işine dokunma. `git fetch origin`.
- `gh issue view <N>`; `<tür>` (feat|fix|perf|refactor|docs|chore|ci|test), `<alan>`, `<konu>` (kebab, ≤5 kelime) çıkar.
- `git worktree list` + `gh pr list`: aynı Issue için dal/worktree/PR zaten varsa onu kullan, yenisini açma.

## 1. Worktree
```
git worktree add ../getirbakim-<N> -b <tür>/<N>-<konu> origin/dev
ln -s /Users/void/www/getirbakim/.env.local ../getirbakim-<N>/.env.local
ln -s /Users/void/www/getirbakim/node_modules ../getirbakim-<N>/node_modules   # lint/tsc/test için yeterli; tarayıcı QA'sı gerçek npm ci yapar
```
Herdr içindeysen (`HERDR_ENV=1`) aynı işi `herdr worktree create --branch <tür>/<N>-<konu> --base origin/dev --path ../getirbakim-<N>` ile yap (kenar çubuğu ağacı için). `WT=/Users/void/www/getirbakim-<N>`; her ajana bu yolu ver. `package.json` bağımlılığı değişecekse symlink yerine worktree'de `npm ci`.

## 2. Plan
`getirbakim-planner`'ı Issue no + `WT` ile çağır (tek dosyalık küçük düzeltmede atla). Plan geliştiricinin brief'i ve QA rota listesidir. Plan "çok büyük" diyorsa takip Issue'larını şimdi aç, ilk dilimle devam et.

## 3. Uygulama
`getirbakim-developer`'ı `WT`, Issue no ve planın tamamıyla çağır. Varsayılan sonnet; `db/*.sql` şema değişikliği, yetki/ödeme/sipariş kodu, tedarikçi sync çekirdeği, modüller arası refactor veya iki inceleme döngüsünde kalan sonnet çalışması için `model: "opus"` geç. Rapordaki **Kontroller** ve **Yapılmayanlar**'ı oku; başarısız kontrolü aynı ajana SendMessage ile geri gönder (yeni ajan açma).

## 4. İnceleme (paralel)
Tek mesajda:
- `getirbakim-reviewer` (`WT`).
- `getirbakim-ui-ux` (`WT` + QA rotaları) — yalnız `.tsx`/`.css` değiştiyse.
🔴 ve 🟡 bulguları geliştiriciye gönder → ilgili inceleyiciyi bir kez yeniden çalıştır. En fazla iki düzeltme döngüsü; sonra kalanları kullanıcıya raporla.

## 5. QA
Rota/bileşen değiştiyse `getirbakim-qa`'yı `WT`, plandaki rotalar/roller ve Issue kabul kriterleriyle çağır. Tarayıcı QA'sı aynı anda yalnız bir tane (Chrome tek). ❌ → geliştiriciye bir döngü, sonra kullanıcıya.

## 6. PR
`WT`'de:
- `git status` temiz; commit'ler conventional; `git fetch origin && git rebase origin/dev` (çakışmayı geliştirici çözer); `git push -u origin <dal>`.
- `gh pr create --base dev --title "<tür>(<alan>): <özet>" --body-file -` — gövde: Özet (problem, ortaya çıkan davranış), Doğrulama (inceleme/QA kararları, koşulan testler), Operasyon (prod'da gereken komut ya da "yok"), `Closes #<N>`; sonunda sistem hatırlatmasındaki attribution satırı. Etiketler Issue ile aynı: tür etiketi + `area:*` + davranış değişiyorsa `release:minor|patch` (`--label`).
- CI'ı bekle. CI kapısı (atlanamaz): `gh pr checks <PR> --watch --fail-fast` komutunu **pipe'sız** koş (`| tail` gibi bir zincir çıkış kodunu yutar, #528). Merge'den hemen önce her kontrolü ayrıca doğrula:
  ```
  gh pr view <PR> --json statusCheckRollup -q '[.statusCheckRollup[] | .conclusion] | all(. == "SUCCESS")'
  ```
  Çıktı `true` değilse merge YOK. Hata bu PR'ın koduyla ilgisiz ve dalgalı görünüyorsa: `gh run rerun <run> --failed`, yeniden bekle, yine doğrula; ilgisiz dalgalı test için Issue aç (`Found in #<PR>`) ve PR'a not düş.
- Kırmızıysa ve hata bu PR'dan geliyorsa log'u (`gh run view --log-failed`) geliştiriciye ver, düzelt, push, tekrar bekle.

## 7. Merge ve temizlik (izin sormadan — politika bunu kapsar)
1. Yukarıdaki CI kapısı `true` + `gh pr view <PR> --json mergeable,baseRefName` (base `dev` olmalı) → `gh pr merge <PR> --merge --delete-branch` (guard base=dev'i serbest bırakır; başka base onaya düşer — o zaman DUR).
2. Ana checkout'u güncelle: `cd /Users/void/www/getirbakim && git merge --ff-only origin/dev` (önce `git fetch`). Başka oturumun commit edilmemiş dosyası ff'yi durdurursa dosya origin/dev ile birebir aynıysa (`cmp`) stash → ff → stash drop; farklıysa dokunma, kullanıcıya söyle. 3000'deki dev sunucusunu öldürme; yeni bağımlılık geldiyse `npm install` + `touch next.config.ts`.
3. Yalnız bu işin worktree'sini kaldır: `git worktree remove ../getirbakim-<N>` (temizse; symlink'ler engel değil) + `git worktree prune`; yerel dal `git branch -D <dal>`; `git fetch --prune`.
4. Rapor: Issue ve PR bağlantıları, tek paragraf özet, inceleme/QA kararları, CI sonucu, merge commit'i, operasyon adımı, kapsam dışı kalanlar (açılan takip Issue'larıyla). dev'de biriken iş çoksa `/release-check` öner — ama main'e yalnız kullanıcı onayıyla.

## Kurallar
- `dev`/`main` üzerinde commit yok; main'e push, dev→main merge, version tag, `release-aws` — yalnız `/release-check` akışında, kullanıcının açık onayıyla.
- Kapsamı genişletme. Keşfedilen başka işler yeni Issue olur (önce `gh issue list --search`), gövdeye `Found in #N`.
- Başka worktree'leri, dalları, ana checkout'taki commit edilmemiş işleri ve 3000'deki dev sunucusunu koru.
