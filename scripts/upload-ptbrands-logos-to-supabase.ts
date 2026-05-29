/**
 * Download ptbrd logos from external URLs and host them in Supabase Storage.
 *
 * Usage:
 *   bun scripts/upload-ptbrd-logos-to-supabase.ts              # dry run (default)
 *   APPLY=true bun scripts/upload-ptbrd-logos-to-supabase.ts   # upload + update DB
 *
 * Optional:
 *   LIMIT=10           Process only N rows (for testing)
 *   CONCURRENCY=5      Parallel uploads (default 5)
 *   BRAND_ID=123       Process a single ptbrd id
 *   URL_KEYS=chery,mes Process specific url_key values (comma-separated)
 */

import 'dotenv/config'
import { db } from '../lib/db'
import { Prisma } from '@prisma/client'
import { ensureStorageBucket } from '../lib/suppliers/parts2world/common'
import {
  getStoragePublicUrl,
  uploadImageFromUrl
} from '../lib/supabase/storage'

const BUCKET = 'brand-logos'
const STORAGE_PREFIX = 'ptbrd'
const PARCATEDARIK_ORIGIN = 'https://parcatedarik.com'
const DRY_RUN = process.env.APPLY !== 'true'
const CONCURRENCY = Math.max(
  1,
  Number.parseInt(process.env.CONCURRENCY ?? '5', 10) || 5
)
const LIMIT =
  process.env.LIMIT != null
    ? Number.parseInt(process.env.LIMIT, 10)
    : undefined
const BRAND_ID =
  process.env.BRAND_ID != null
    ? Number.parseInt(process.env.BRAND_ID, 10)
    : undefined
const URL_KEYS = process.env.URL_KEYS
  ? process.env.URL_KEYS.split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  : undefined

type PtBrandRow = {
  id: number
  name: string
  url_key: string | null
  logo_url: string
}

type Stats = {
  candidates: number
  skippedAlreadyHosted: number
  uploaded: number
  updated: number
  failed: number
}

function extensionFromLogoUrl(logoUrl: string): string {
  try {
    const pathname = new URL(logoUrl).pathname
    const segment = pathname.split('.').pop()?.toLowerCase() ?? ''
    if (/^(jpg|jpeg|png|webp|gif|svg|avif)$/.test(segment)) {
      return segment === 'jpeg' ? 'jpg' : segment
    }
  } catch {
    // fall through
  }
  return 'png'
}

function sanitizeStorageKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function storagePathFor(row: PtBrandRow): string {
  const base =
    (row.url_key && sanitizeStorageKey(row.url_key)) ||
    `id-${row.id}`
  const ext = extensionFromLogoUrl(row.logo_url)
  return `${STORAGE_PREFIX}/${base}.${ext}`
}

function isAlreadyHosted(logoUrl: string): boolean {
  try {
    const url = new URL(logoUrl)
    return (
      url.hostname.includes('supabase.co') &&
      url.pathname.includes(`/object/public/${BUCKET}/${STORAGE_PREFIX}/`)
    )
  } catch {
    return false
  }
}

function isExternalCandidate(logoUrl: string): boolean {
  if (isAlreadyHosted(logoUrl)) return false
  try {
    const host = new URL(logoUrl).hostname
    return host.includes('parcatedarik.com') || !host.includes('supabase.co')
  } catch {
    return false
  }
}

async function fetchCandidates(): Promise<PtBrandRow[]> {
  const rows = await db.$queryRaw<PtBrandRow[]>(
    BRAND_ID != null
      ? Prisma.sql`
          SELECT id, name, url_key, logo_url
          FROM v0.ptdrk_brands
          WHERE id = ${BRAND_ID}
            AND logo_url IS NOT NULL
            AND BTRIM(logo_url) <> ''
        `
      : Prisma.sql`
          SELECT id, name, url_key, logo_url
          FROM v0.ptdrk_brands
          WHERE logo_url IS NOT NULL
            AND BTRIM(logo_url) <> ''
          ORDER BY id
        `
  )

  const filtered = rows.filter((row) => isExternalCandidate(row.logo_url))
  const byUrlKey =
    URL_KEYS != null && URL_KEYS.length > 0
      ? filtered.filter(
          (row) =>
            row.url_key != null &&
            URL_KEYS.includes(row.url_key.trim().toLowerCase())
        )
      : filtered
  if (LIMIT != null && LIMIT > 0) {
    return byUrlKey.slice(0, LIMIT)
  }
  return byUrlKey
}

async function main() {
  console.log(
    `[upload-ptbrd-logos] Mode: ${DRY_RUN ? 'DRY RUN' : 'APPLY'} | bucket=${BUCKET}/${STORAGE_PREFIX}`
  )

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required')
  }

  const candidates = await fetchCandidates()
  const stats: Stats = {
    candidates: candidates.length,
    skippedAlreadyHosted: 0,
    uploaded: 0,
    updated: 0,
    failed: 0
  }

  console.log(`[upload-ptbrd-logos] External logo candidates: ${stats.candidates}`)

  if (stats.candidates === 0) {
    console.log('[upload-ptbrd-logos] Nothing to process.')
    return
  }

  if (DRY_RUN) {
    console.log('\nSample work (first 10):')
    for (const row of candidates.slice(0, 10)) {
      const path = storagePathFor(row)
      const publicUrl = getStoragePublicUrl(path, BUCKET)
      console.log(
        `  id=${row.id} ${row.name} (${row.url_key ?? 'no url_key'})\n    from: ${row.logo_url}\n    to:   ${publicUrl}`
      )
    }
    console.log('\nRe-run with APPLY=true to upload and update v0.ptdrk_brands.logo_url')
    return
  }

  await ensureStorageBucket(BUCKET, true)

  const failures: Array<{ id: number; name: string; reason: string }> = []
  let cursor = 0

  async function worker() {
    while (cursor < candidates.length) {
      const index = cursor
      cursor += 1
      const row = candidates[index]
      const storagePath = storagePathFor(row)
      const expectedPublicUrl = getStoragePublicUrl(storagePath, BUCKET)

      if (row.logo_url === expectedPublicUrl) {
        stats.skippedAlreadyHosted += 1
        continue
      }

      const referer = row.logo_url.includes('parcatedarik.com')
        ? PARCATEDARIK_ORIGIN
        : undefined

      const result = await uploadImageFromUrl(row.logo_url, storagePath, {
        bucket: BUCKET,
        referer
      })

      if (!result.publicUrl) {
        stats.failed += 1
        failures.push({
          id: row.id,
          name: row.name,
          reason: result.error ?? `HTTP ${result.status ?? 'unknown'}`
        })
        continue
      }

      stats.uploaded += 1

      await db.$executeRaw(Prisma.sql`
        UPDATE v0.ptdrk_brands
        SET logo_url = ${result.publicUrl}, updated_at = NOW()
        WHERE id = ${row.id}
      `)
      stats.updated += 1

      if ((index + 1) % 25 === 0 || index + 1 === candidates.length) {
        console.log(
          `[upload-ptbrd-logos] Progress ${index + 1}/${candidates.length} | uploaded=${stats.uploaded} updated=${stats.updated} failed=${stats.failed}`
        )
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, candidates.length) }, () =>
      worker()
    )
  )

  console.log('\n[upload-ptbrd-logos] Summary:')
  console.log(`  candidates: ${stats.candidates}`)
  console.log(`  uploaded:   ${stats.uploaded}`)
  console.log(`  updated:    ${stats.updated}`)
  console.log(`  failed:     ${stats.failed}`)
  console.log(`  skipped:    ${stats.skippedAlreadyHosted}`)

  if (failures.length > 0) {
    console.log('\nFailures (first 20):')
    for (const item of failures.slice(0, 20)) {
      console.log(`  - id=${item.id} ${item.name}: ${item.reason}`)
    }
    if (failures.length > 20) {
      console.log(`  ... and ${failures.length - 20} more`)
    }
    process.exitCode = 1
  }
}

main()
  .catch((err) => {
    console.error('[upload-ptbrd-logos] Failed:', err)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
