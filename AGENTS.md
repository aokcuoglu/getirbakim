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

## Yönetim paneli (/yonetim) UI kuralı

`/yonetim` ve `src/components/admin/**` yalnızca stok shadcn/ui bileşenleri ve varyantlarıyla kurulur (Card, Table, Badge, Alert, Empty, Tabs, Pagination, Field, InputGroup, Item, Dialog, Sidebar…; tam liste `src/components/ui`).

- Özel CSS dosyası, `style={}`, arbitrary Tailwind değeri (`rounded-[4px]`, `w-[45%]`, `min-w-[28rem]`), hex renk ve bileşenleri className ile yeniden renklendirme/köşe/gölge değiştirme yok. Sarmalayıcı "tasarım sistemi" bileşeni (eski `components/admin/ui`) yeniden eklenmez.
- className yalnız yerleşim ve aralık (flex/grid/gap/p/m/w/max-w-7xl/truncate/tabular-nums, responsive önekler) ve tema token'larına bağlı tipografi/renk (`text-muted-foreground`, `text-2xl font-semibold tracking-tight`, düz metin ve ikonlarda `text-success` / `text-warning` / `text-destructive` / `text-info`) için kullanılır.
- Renk dili IBM Carbon (VoltAgent/awesome-design-md `design-md/ibm`): IBM Blue birincil, gri nötrler, 4px köşe; token'lar `src/app/globals.css` içinde `.admin-app` altında (açık = g10, koyu = g100). Durumlar renkle ayrışmalı, ama anlamı metin de taşımalı:
  - Badge/Alert varyantları: `success` (olumlu: stok var, sağlıklı, başarılı, ödendi, artış), `warning` (dikkat: veri yok, bekliyor, kısmi, eski veri), `destructive` (olumsuz: hata, iptal, başarısız, düşüş, stok yok gerektiğinde), `info` (bilgi/süreçte), `outline`/`secondary` (nötr).
  - Badge'e uygun lucide ikonu `data-icon="inline-start"` ile eklenir (CircleCheck, TriangleAlert, CircleAlert, Info).
- `src/components/ui/*` registry'den geldiği gibi kalır; bilinçli ekler Badge ve Alert'teki `success` / `warning` / `info` varyantları ile `ui/table.tsx`'in data-table davranışıdır.
- Tablolar (`ui/table.tsx`, shadcn data-table düzeni): `/yonetim` layout'undaki `TableControls` altında her tablo başlıktan A→Z/Z→A sıralanır, başlıktaki filtre düğmesiyle süzülür, 8+ satırda araç çubuğundan aranır; değerler hücre metninden okunur (gerekirse `TableCell value`). Mağaza tabloları etkilenmez. Sayfalı tablolar `<Table server>` olur: yalnız `TableHead sortKey` (→ `?sort=&dir=`, sorguda `sortOrder()` ile `src/lib/table-sort.ts`) ve `filter={{ param, options }}` olan başlıklar kontrol alır; sayfanın link/form kurucuları `sort`/`dir`'i taşımalı. Gereksizse `controls={false}`. Sayfa sayfa TanStack tablosu yazılmaz. Eksik bileşen `npx shadcn@latest add` ile eklenir (CLI'nin yazdığı `import { cn } from "cn"` → `@/lib/utils`).
- Base UI: Link'i Button olarak render ederken `<Button nativeButton={false} render={<Link href/>}>`. Stok `PaginationPrevious/Next` düz `<a>` üretir; istemci tarafı gezinme için `PaginationItem` içinde bu Link-Button'u kullan. Taşabilecek `TabsList`'i `ScrollArea` + yatay `ScrollBar` içine al.
