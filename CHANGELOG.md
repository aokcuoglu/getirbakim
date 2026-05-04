# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] - 2026-05-04

### Fixed
- Prisma/Supabase database connection: switched from transaction pooler (port 6543, pgbouncer=true) to session pooler (port 5432) for PrismaPg adapter compatibility
- PrismaPg pool size reduced to 10 to stay within Supabase session pool limit
- Added SSL configuration (`rejectUnauthorized: false`) for Supabase connections
- TypeScript error: added `autoMatchOrCreatePartAfterOemSave` stub returning `{ matched: false }` in `lib/actions/admin-suppliers.ts`
- TypeScript error: narrowed Prisma `string` to `DinamikJob['status']` and `DinamikJob['mode']` in `lib/suppliers/dinamik-job-queue.ts`
- Test: corrected `toVatIncludedDecimal` expectations from 23% to 20% VAT rate in `lib/orders/types.test.ts`
- Test: mocked `@/lib/suppliers/dinamik-catalog-seed` in catalog-seed route test to avoid `server-only` import error

### Added
- `docker-compose.local.yml` for local Docker builds
- Comprehensive `.env.example` with Supabase session pooler documentation
- `RELEASE_NOTES.md` and `CHANGELOG.md`

### Changed
- `.gitignore` now excludes `.env.*` (except `.env.example`) and `.env.bak-*`
- `NODE_ENV` in local `.env` set to `development`