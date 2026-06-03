# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

Automotive spare parts e-commerce platform with multi-locale support (Turkish/English). Key concerns: product search, vehicle compatibility, supplier integrations, pricing/stock sync, and order management.

See `AGENTS.md` for detailed working principles, domain guidance, and engineering priorities — follow those rules.

---

## Commands

```bash
bun run dev            # Start dev server (port 3000)
bun run build          # prisma generate + next build
bun run lint           # TypeScript typecheck + unsafe raw SQL check
bun run typecheck      # TypeScript only
bun run test           # Run Bun tests
bun run db:generate    # Regenerate Prisma client after schema changes
bun run db:pull        # Pull schema from live DB
```

No Jest/Vitest config — tests use Bun's built-in test runner (`bun test`).

---

## Stack

- **Framework**: Next.js (App Router), React 19, TypeScript — package manager is **Bun**
- **Database**: PostgreSQL via Prisma 7 with `adapter-pg`; multi-schema (`public` + `trodo`)
- **Auth**: Supabase SSR
- **Search**: Meilisearch (optional, feature-flagged via `MEILI_ENABLED`); falls back to Prisma SQL
- **Cache**: Upstash Redis + Next.js `unstable_cache`
- **Payments**: Tami (Turkish payment processor)
- **i18n**: `next-intl`, routes prefixed `/:locale` (default: `tr`), messages in `/messages/{en,tr}.json`
- **UI**: Radix UI + shadcn/ui + Tailwind CSS 4

---

## Architecture

### Data flow

Server actions in `lib/actions/` are the primary data-fetching layer — they query Prisma directly and are called from both Server Components and client components. API routes in `app/api/` handle webhooks, internal cron endpoints, and search.

### Product data model

Products exist in the **internal catalog** (`parts` table), which is the source of truth for display. These are reconciled via OEM code cross-references (`part_oens`). Pricing is computed from supplier cost + markup policy, stored in `part_pricing_inventory`.

### Vehicle compatibility

Vehicle hierarchy: Make → Model → Engine/Variant. Part-to-vehicle relationships live in `part_vehicle_types` (cross-schema: `public` ↔ `trodo`). Compatibility is checked at search time and on product detail pages.

### Search

`lib/actions/search.ts` handles search. When Meilisearch is enabled, queries go there; otherwise it falls back to Prisma. Client hook: `hooks/use-search.ts`. Facets cover brand, category, price range, and OEM compatibility.

### Supplier sync

Triggered by cron endpoints (`app/api/internal/suppliers/`) or manually via admin UI. Sync flow: fetch catalog → normalize → OEM-match → update `part_pricing_inventory`. Concurrency is tunable via env vars (`DINAMIK_BRAND_CONCURRENCY`, etc.).

### Key directories

```
app/[locale]/           # All user-facing routes
app/api/                # Webhooks, cron, search API
lib/actions/            # Server actions (data fetching + mutations)
lib/suppliers/          # Supplier integration clients + sync logic
lib/pricing/            # Markup/VAT calculation
lib/search/             # Meilisearch catalog indexing
lib/types/              # Shared domain types
components/             # React components (ui/, account/, search/, etc.)
hooks/                  # Client-side React hooks
prisma/schema.prisma    # 46 models, ~900 lines
messages/               # i18n translation files
```

### Client vs server boundaries

- Server Components fetch data; Client Components handle interactivity
- `'use server'` actions in `lib/actions/` are called from both
- Do not move logic across server/client boundaries without a clear reason
- Watch for hydration issues in search, filtering, and cart state

### Lint constraint

The `bun run lint` script checks for `queryRawUnsafe` and `executeRawUnsafe` — these are banned in API/admin scope to prevent SQL injection.
