# GetirBakim V0 Archive Overview

Archive tag: `v0-current-platform`

## Purpose

This document records the current platform state before the V1 fast-sales strategy. The codebase is not moved into a `v0/` folder because that would create broad import, route, build, and deployment risk. The archive boundary is the git tag plus these notes.

## Current Platform Shape

- Next.js App Router storefront with `tr` and `en` locale routes.
- Canonical catalog centered on `public.parts`, `part_categories`, `part_brands`, OEM/EAN/cross-reference tables, and vehicle fitment tables.
- Search is Meilisearch-first when enabled, with PostgreSQL catalog/offer fallback.
- Supplier model supports `supplier_products`, `supplier_part_mappings`, `part_supplier_offers`, pricing inventory, and admin overrides.
- Dinamik, SETA, and Parts2World integrations exist, with Dinamik-ParcaTedarik matching work in progress.
- Checkout, order, payment, stock reservation, notifications, customer requests, and admin panels are present.

## Active Worktree Notes

At archive time, the working tree already contained active Dinamik-ParcaTedarik matching changes. Those changes are treated as V1 transition work and are intentionally not reverted.

Key active areas:

- Dinamik-ParcaTedarik brand alias admin.
- Dinamik-ParcaTedarik model matching admin.
- Manual matching and Dinamik search API routes.
- Search normalization and Meilisearch setup changes.
- Prisma migration for unmatched ParcaTedarik rows.

## V0 Risks

- Vehicle fitment and part compatibility are high-risk and not ready to carry the first V1 sales experience.
- Canonical `public.parts` flow is powerful but too broad for the fastest sale path.
- Supplier matching can accidentally make a wrong product sellable if approval rules are loose.
- Search and category behavior currently mixes canonical catalog and supplier offer concerns.

## Restore / Rollback

To inspect the archived baseline:

```bash
git checkout v0-current-platform
```

To return to V1 work:

```bash
git checkout codex/v1-fast-sales
```

If a release needs to roll back, deploy the commit referenced by `v0-current-platform` and use the existing Docker deployment runbook.
