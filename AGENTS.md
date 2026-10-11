<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Geliştirme çalışma akışı

Bu tür geliştirme ve düzeltme çalışmalarında kullanıcının tercih ettiği akış:

1. Kod değişikliğine başlamadan önce GitHub Issue aç ve işi bu Issue ile takip et.
2. Güncel `origin/dev` üzerinden işe özel branch ve ayrı worktree oluştur; değişiklikleri bu worktree'de yap.
3. Başka çalışmaların değişikliklerini koru ve PR'a yalnız bu işin kapsamındaki dosyaları dahil et.
4. İlgili testleri, tür kontrolünü ve lint'i çalıştır; arayüz değişikliklerini tarayıcıda doğrula.
5. Issue'yu kapatacak şekilde `Closes #<issue>` içeren, hedefi `dev` olan PR aç.
6. CI ve gerekli kontroller geçtikten sonra PR'ı `dev` branch'ine merge et. Kullanıcı farklı bir hedef veya bekleme talebi belirttiyse onu uygula.
7. Tamamlandığında Issue ve PR bağlantılarını, test sonucunu ve merge durumunu kullanıcıya bildir.
