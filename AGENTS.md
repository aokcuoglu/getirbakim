# getirbakim.com — Agent Instructions

## Project Overview

getirbakim.com is an open-source automotive spare parts e-commerce platform for Türkiye. The current release (v0.2.0) is the Real Supplier API Integration Foundation.

## Architecture

- **Next.js 16 App Router** with TypeScript and Tailwind CSS v4
- **Supabase Pro** for database/auth/storage
- **Supplier Adapter Pattern** — each supplier has its own adapter implementing a common interface
- **Mock adapter** works without real API credentials for local development
- **SUPPLIER_MODE** env var: `mock` | `live` | `hybrid` (default: `mock`)
- **In-memory search cache** with configurable TTL
- **In-memory rate limiter** for /api/search

## Key Rules

- Supplier API credentials **must only** live in environment variables — never expose to browser
- Never expose raw supplier API responses to the browser — always normalize into internal DTOs
- If one supplier fails, search must still return results from other suppliers
- Product search must support partial failure
- Use mock supplier data until real API credentials are added
- Keep architecture ready for future: OEM/OEN matching, vehicle fitment, VIN/chassis search, plate search
- UI: clean, minimal, trustworthy — black, white, gray
- Admin routes are protected by HTTP Basic Auth via `ADMIN_USERNAME`/`ADMIN_PASSWORD` env vars
- Admin API routes under `/api/admin/` require admin auth
- If `ADMIN_PASSWORD` is not set, admin routes fail closed (401)
- KVKK consent is required before any personal data submission
- Customer PII must never be exposed without authentication
- Never log API keys or raw supplier payloads
- Cache only successful normalized results, never cache errors

## File Conventions

- Pages: `src/app/<route>/page.tsx`
- API routes: `src/app/api/<route>/route.ts`
- Components: `src/components/<name>.tsx`
- Types: `src/types/index.ts` (business DTOs), `src/types/database.ts` (Supabase)
- Suppliers: `src/suppliers/`
- Utilities: `src/lib/utils.ts`
- Rate limiter: `src/lib/rate-limit.ts`
- Supabase clients: `src/lib/supabase/server.ts`, `src/lib/supabase/client.ts`
- Middleware: `src/proxy.ts` (admin auth + /api/admin/ protection)

## Commands

- `npm run dev` — start dev server
- `npm run build` — production build
- `npm run lint` — ESLint
- `npm run typecheck` — TypeScript check

## Env Variables

- `ADMIN_USERNAME` / `ADMIN_PASSWORD` — protect /admin and admin API routes
- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase connection
- `SUPPLIER_MODE` — `mock` | `live` | `hybrid` (default: `mock`)
- `SUPPLIER_A_ENABLED` — `true` | `false` (default: `false`)
- `SUPPLIER_A_API_KEY` / `SUPPLIER_A_BASE_URL` — Supplier A API credentials
- `SUPPLIER_A_TIMEOUT_MS` — Supplier A request timeout (default: `8000`)
- `SUPPLIER_B_API_KEY` / `SUPPLIER_B_BASE_URL` — Supplier B API credentials
- `SUPPLIER_C_API_KEY` / `SUPPLIER_C_BASE_URL` — Supplier C API credentials
- `SEARCH_CACHE_TTL_SECONDS` — Search cache TTL (default: `60`)
- `SEARCH_RATE_LIMIT_WINDOW_SECONDS` — Rate limit window (default: `60`)
- `SEARCH_RATE_LIMIT_MAX` — Max requests per window per IP (default: `30`)

## Supplier Mode Behavior

- **mock**: Only mock supplier adapter is used. No real API calls.
- **live**: Only real supplier adapters (A, B, C) are used. Mock is excluded.
- **hybrid**: Real adapters are included when enabled and configured; mock is always included as fallback.

## Database

- Schema: `supabase/migrations/001_initial_schema.sql`
- KVKK migration: `supabase/migrations/002_kvkk_consent.sql`
- Request statuses migration: `supabase/migrations/003_request_statuses.sql`
- Run on Supabase dashboard or via `supabase` CLI