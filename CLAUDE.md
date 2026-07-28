# CLAUDE.md

## Project overview

Automotive spare parts e-commerce platform with multi-locale support (Turkish/English). Key concerns: product search, vehicle compatibility, supplier integrations, pricing/stock sync, and order management.

See `AGENTS.md` for detailed working principles, domain guidance, and engineering priorities — follow those rules.

---

## Banned commands

`prisma migrate dev`, `prisma migrate reset` and `prisma db push` must never run
against any database in this project — local included, local especially. Local
`public` holds a 129 GB TecDoc archive (`part_vehicle_types` alone ~931M rows) that
exists in no other environment and in no backup; these commands drop whatever does
not match the datamodel.

```bash
bun run db:target                  # which database am I pointed at?
bun run db:diff:check              # is the target in sync with schema.prisma?
bun run db:migration:new <name>    # author a migration via a throwaway shadow DB
bun run db:migrate                 # prisma migrate deploy
```

`scripts/db-guard.sh` rejects the three commands, but only when it is invoked — it
is not a hook, so nothing intercepts a bare `bunx prisma …`. Full rationale in
`AGENTS.md` → Banned commands.

---

## Architecture

### Data flow

Server actions in `lib/actions/` are the primary data-fetching layer — they query Prisma directly and are called from both Server Components and client components. API routes in `app/api/` handle webhooks, internal cron endpoints, and search.

### Product data model

Products exist in the **internal catalog** (`parts` table), which is the source of truth for display. These are reconciled via OEM code cross-references (`part_oens`). Pricing is computed from supplier cost + markup policy.

Note: `part_pricing_inventory` is referenced by `lib/pricing/public-pricing.ts` and `lib/actions/admin-products.ts` but does **not** exist in `prisma/schema.prisma` — those code paths are broken. Treat the persisted-pricing layer as unbuilt, not as something you can query.

### Vehicle compatibility

Vehicle hierarchy: Make → Model → Engine/Variant. Part-to-vehicle relationships live in `part_vehicle_types` (`public` schema, joining `parts` ↔ `vehicle_types`). Compatibility is checked at search time and on product detail pages.

### Search

`lib/actions/search.ts` handles search. When Meilisearch is enabled, queries go there; otherwise it falls back to Prisma. Client hook: `hooks/use-search.ts`. Facets cover brand, category, price range, and OEM compatibility.

### Supplier sync

Triggered by cron endpoints (`app/api/internal/suppliers/`) or manually via admin UI. Sync flow: fetch catalog → normalize → OEM-match → update pricing/stock. Concurrency is tunable via env vars (`DINAMIK_BRAND_CONCURRENCY`, etc.).

### Client vs server boundaries

- Server Components fetch data; Client Components handle interactivity
- `'use server'` actions in `lib/actions/` are called from both
- Do not move logic across server/client boundaries without a clear reason
- Watch for hydration issues in search, filtering, and cart state

### Lint constraint

The `bun run lint` script checks for `queryRawUnsafe` and `executeRawUnsafe` — these are banned in API/admin scope to prevent SQL injection.
