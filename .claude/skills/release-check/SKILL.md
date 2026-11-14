---
name: release-check
description: Show what is on dev but not yet on main in getirbakim, propose the next SemVer version and release scope, and — only after the user's explicit approval — prepare the versioned dev → main release (manifest + CHANGELOG PR into dev, dev → main PR, merge, annotated tag, GitHub Release). Never triggers the AWS production deploy without a separate approval. Use for "/release-check", "sürüm çıkaralım mı?", or when the session brief suggests a release.
---

Politika: `docs/development-workflow.md` → "`main` sürümleri ve Git tag'leri" ve "Deploy ve staging kararı". Kullanıcıyla Türkçe konuş.

## 1. Durum (salt okuma)
- `git fetch origin --tags`; son sürüm `git describe --tags --abbrev=0 origin/main`; `package.json` sürümü.
- Kapsam: `git log --first-parent --format='%h %s' origin/main..origin/dev` ve merge edilen PR'lar (`gh pr list --state merged --base dev --search "merged:>=<son sürüm tarihi>" --json number,title,labels`).
- Etki: herhangi bir `feat` / `release:minor` → MINOR; yalnız `fix`/`perf` → PATCH; MAJOR yalnız kullanıcı isterse. Salt docs/CI tek başına sürüm gerektirmez.
- `CHANGELOG.md` en üst bölümünü oku (biçimi koru).

## 2. Öneri ve ONAY
Kullanıcıya göster: mevcut sürüm → önerilen `vX.Y.Z`, PR listesi (tür ve alanla), dahil edilmeyecek/hazır olmayan işler (açık operasyon adımı, yarım özellik), kısa İngilizce başlık. **Açık onay iste** (AskUserQuestion). Onay yoksa burada dur. Bir sürüme verilen onay sonrakini kapsamaz.

## 3. Hazırlık (onaydan sonra)
1. `/issue` kurallarıyla `chore(release): prepare vX.Y.Z` Issue'su; worktree `../getirbakim-<N>` dal `chore/<N>-release-vX.Y.Z` (origin/dev'den).
2. `npm version X.Y.Z --no-git-tag-version` (package.json + lock birlikte); `CHANGELOG.md`'ye sürüm bölümü: özellikler, düzeltmeler, Issue/PR bağlantıları, migration/operasyon adımları.
3. PR → `dev`, CI yeşil, merge (normal `/ship` 6–7. adımları).
4. `gh pr create --base main --head dev --title "chore(release): vX.Y.Z" --label release:<…>` — gövdede kapsam ve doğrulama. CI'ı `/ship` 6. adımdaki kapıyla bekle ve doğrula (pipe'sız `gh pr checks --watch`, ardından `statusCheckRollup` hepsi `SUCCESS`); ancak o zaman `gh pr merge <PR> --merge` (guard onay sorar — kullanıcı onayı zaten alındı, sürüm ve kapsamı tekrar göster).
5. Main merge commit'ine annotated tag: `git tag -a vX.Y.Z <merge-sha> -m "vX.Y.Z — <başlık>"` + `git push origin vX.Y.Z`; `gh release create vX.Y.Z --title "vX.Y.Z — <başlık>" --notes-file <CHANGELOG bölümü>`. Var olan tag'i taşıma/silme.
6. dev'i main'e hizala: `git push origin origin/main:refs/heads/dev` (fast-forward; force değil) ve ana checkout'ta `git merge --ff-only origin/dev`.
7. Rapor: merge, sürüm, tag, Release bağlantısı.

## 4. Production yayını — AYRI adım
`main` merge'i deploy etmez. Yayını yalnız kullanıcı ayrıca ve açıkça isterse yap: `gh workflow run release-aws.yml --ref main`, GitHub `production` ortam onayını kullanıcıya bırak, `gh run watch` ile izle, sonucu ve smoke testleri (`https://getirbakim.com` ana sayfa, arama, `/api/health/suppliers`) bildir. Deploy workflow'larını değiştirme; Contabo workflow'larını etkinleştirme.
