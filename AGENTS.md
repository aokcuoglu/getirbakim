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
- **`main` = yayınlanabilir sürüm.** `main`'e push, `dev → main` merge veya `main`'i değiştiren her işlemden önce kullanıcıdan **açık onay** al (sürüm numarasını ve kapsamı göstererek). Önceki onay sonraki sürümü kapsamaz.
- **AWS production (getirbakim.com) yayını ayrı ve elle tetiklenen adımdır:** `main` üzerinden `release-aws.yml` workflow'u (`workflow_dispatch`, `-f version=<package.json sürümü>`; koruma işi `main` dışı dalı, depo sahibi dışındaki tetikleyiciyi ve uyuşmayan sürümü AWS'ye ulaşmadan durdurur). `main` merge'i deploy etmez; workflow'u yalnız kullanıcının ayrı ve açık yayın onayıyla tetikle.
- Geliştirme yalnız `dev` üzerinden yapılır; olgunlaşan işler `main`'e yalnız sürümlü release olarak gider. `main`'e doğrudan commit veya hotfix push yok; acil düzeltme de `dev` → sürüm PR'ı ile gider.
- Contabo'ya otomatik deploy yok; staging yok (ayrı kullanıcı talebiyle ele alınacak). CI zorunludur; deploy workflow'larını veya staging'i açık talep olmadan değiştirme/etkinleştirme.
- Tamamlandığında Issue/PR bağlantılarını, doğrulama ve merge durumunu bildir; varsa sürüm/tag bilgisini ekle.

## Ajan altyapısı (Claude Code)

Geliştirmeler sabit bir çok-ajanlı hattan geçer: [`docs/harness/README.md`](docs/harness/README.md). Ana oturum `/ship <issue>` skill'iyle **orkestratör** olur ve `.claude/agents/` altındaki `getirbakim-planner` → `getirbakim-developer` → `getirbakim-reviewer` + `getirbakim-ui-ux` → `getirbakim-qa` ajanlarına iş verir. Diğer skill'ler: `/issue`, `/qa`, `/design-check`, `/backlog`, `/release-check`. Deterministik kontroller `scripts/harness/` (`admin-ui-lint.mjs`: her düzenlemeden sonra hook, `npm run harness:lint`, CI) ve akış hook'ları `scripts/flow/` (oturum özeti, `dev`/`main` koruması; `.claude/settings.json`).

## Yönetim paneli (/yonetim) UI kuralı

`/yonetim` ve `src/components/admin/**` yalnızca stok shadcn/ui bileşenleri ve varyantlarıyla kurulur (Card, Table, Badge, Alert, Empty, Tabs, Pagination, Field, InputGroup, Item, Dialog, Sidebar…; tam liste `src/components/ui`).

- Özel CSS dosyası, `style={}`, arbitrary Tailwind değeri (`rounded-[4px]`, `w-[45%]`, `min-w-[28rem]`), hex renk ve bileşenleri className ile yeniden renklendirme/köşe/gölge değiştirme yok. Sarmalayıcı "tasarım sistemi" bileşeni (eski `components/admin/ui`) yeniden eklenmez.
- className yalnız yerleşim ve aralık (flex/grid/gap/p/m/w/max-w-7xl/truncate/tabular-nums, responsive önekler) ve tema token'larına bağlı tipografi/renk (`text-muted-foreground`, `text-2xl font-semibold tracking-tight`, düz metin ve ikonlarda `text-success` / `text-warning` / `text-destructive` / `text-info`) için kullanılır.
- Renk dili IBM Carbon (VoltAgent/awesome-design-md `design-md/ibm`): IBM Blue birincil, gri nötrler, 4px köşe; token'lar `src/app/globals.css` içinde `.admin-app` altında (açık = g10, koyu = g100). Durumlar renkle ayrışmalı, ama anlamı metin de taşımalı:
  - Badge/Alert varyantları: `success` (olumlu: stok var, sağlıklı, başarılı, ödendi, artış), `warning` (dikkat: veri yok, bekliyor, kısmi, eski veri), `destructive` (olumsuz: hata, iptal, başarısız, düşüş, stok yok gerektiğinde), `info` (bilgi/süreçte), `outline`/`secondary` (nötr).
  - Badge'e uygun lucide ikonu `data-icon="inline-start"` ile eklenir (CircleCheck, TriangleAlert, CircleAlert, Info).
- Çerçeveli Accordion (ayrıntı/geçmiş blokları) `<Card size="sm" className="py-0"><CardContent><Accordion>` kalıbıyla kurulur (#520); köşe ve gölge Card'ın kendisinden gelir, `rounded-*`/`border` eklenmez. Stok sidebar bloklarındaki (logo karosu, NavUser avatarı) köşe sınıfları satırda gerekçeli `admin-ui-lint-ignore` taşır.
- `src/components/ui/*` registry'den geldiği gibi kalır; bilinçli ekler Badge ve Alert'teki `success` / `warning` / `info` varyantları, `ui/table.tsx`'in data-table davranışı ve stok bileşenlerdeki ekran okuyucu/varsayılan metinlerin Türkçeleştirilmesidir (Kapat, Yükleniyor, Önceki/Sonraki…). Registry'den yeni bileşen eklenince İngilizce metinler aynı şekilde Türkçeleştirilir.
- Tablolar (`ui/table.tsx`, shadcn data-table düzeni): `/yonetim` layout'undaki `TableControls` altında her tablo başlıktan A→Z/Z→A sıralanır, başlıktaki filtre düğmesiyle süzülür, 8+ satırda araç çubuğundan aranır; değerler hücre metninden okunur (gerekirse `TableCell value`). Mağaza tabloları etkilenmez. Sayfalı tablolar `<Table server>` olur: yalnız `TableHead sortKey` (→ `?sort=&dir=`, sorguda `sortOrder()` ile `src/lib/table-sort.ts`) ve `filter={{ param, options }}` olan başlıklar kontrol alır; sayfanın link/form kurucuları `sort`/`dir`'i taşımalı. Gereksizse `controls={false}`. Sayfa sayfa TanStack tablosu yazılmaz. Eksik bileşen `npx shadcn@latest add` ile eklenir (CLI'nin yazdığı `import { cn } from "cn"` → `@/lib/utils`).
- Base UI: Link'i Button olarak render ederken `<Button nativeButton={false} render={<Link href/>}>`. Stok `PaginationPrevious/Next` düz `<a>` üretir; istemci tarafı gezinme için `PaginationItem` içinde bu Link-Button'u kullan. Taşabilecek `TabsList`'i `ScrollArea` + yatay `ScrollBar` içine al.
