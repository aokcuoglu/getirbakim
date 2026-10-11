<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Geliştirme, sürümleme ve yayın kuralları

İşe başlamadan önce [geliştirme ve sürüm politikasını](docs/development-workflow.md) oku ve uygula. Kullanıcının işe özel güncel talimatı önceliklidir.

- Varsayılan akış: yerel inceleme → güncel `origin/dev` üzerinden ayrı worktree → dosya değiştirmeden GitHub Issue → geliştirme/doğrulama → Issue'ya bağlı PR → CI geçince `dev` merge. Kullanıcı farklı hedef veya bekleme istemediyse yeniden izin istemeden bu akışı tamamla.
- Başka çalışmaların dosyalarını ve worktree'lerini koru; PR'a yalnızca bu işin değişikliklerini dahil et.
- Commit/PR başlıklarında Conventional Commits; Issue/PR'da rehberdeki iş türü, alan ve gerektiğinde sürüm etkisi etiketlerini kullan.
- Her commit/PR için sürüm tag'i oluşturma. Kullanıcı `main` sürümü istediğinde önemli özellikleri `feat` / MINOR olarak sürümle; manifestleri ve changelog'u güncelle, `main` sürüm commit'ine annotated `vX.Y.Z` tag'i koy.
- Commit, push, PR, merge, tag veya Release sonrasında Contabo'ya otomatik deploy yapma. Şimdilik staging yok; AWS geçişinden sonra ayrı kullanıcı talebiyle ele alınacak.
- `main` merge/sürüm ve production deploy ayrı kullanıcı talepleridir. CI zorunludur; deploy workflow'larını veya staging'i açık talep olmadan etkinleştirme.
- Tamamlandığında Issue/PR bağlantılarını, doğrulama ve merge durumunu bildir; varsa sürüm/tag bilgisini ekle.
