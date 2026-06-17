/**
 * Backfill v0.brand_list.logo_url from ptbrd.logo_url (via ptdrk_brands_id join).
 *
 * Usage:
 *   bun scripts/backfill-dnbrd-match-logos.ts              # dry run (default)
 *   APPLY=true bun scripts/backfill-dnbrd-match-logos.ts   # write to DB
 *
 * Optional:
 *   SKIP_MIGRATION=true  Skip ADD COLUMN migration (column already exists)
 *   FORCE=true           Overwrite existing logo_url values
 */

import 'dotenv/config'
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { db } from '../lib/db'
import { Prisma } from '@prisma/client'

const DRY_RUN = process.env.APPLY !== 'true'
const SKIP_MIGRATION = process.env.SKIP_MIGRATION === 'true'
const FORCE = process.env.FORCE === 'true'

type BackfillStats = {
  totalRows: number
  alreadySet: number
  candidates: number
  fromPtbrands: number
  updated: number
  stillMissing: number
}

async function applyMigration() {
  if (SKIP_MIGRATION) {
    console.log('[backfill-dnbrd-match-logos] Skipping migration (SKIP_MIGRATION=true)')
    return
  }

  const scriptDir = dirname(fileURLToPath(import.meta.url))
  const migrationPath = join(
    scriptDir,
    '../prisma/migrations/20260526150000_dpbrd_logo_url/migration.sql'
  )
  const sql = readFileSync(migrationPath, 'utf8')
  await db.$executeRawUnsafe(sql)
  console.log('[backfill-dnbrd-match-logos] Applied migration:', migrationPath)
}

async function fetchStats(): Promise<BackfillStats> {
  const rows = await db.$queryRaw<
    Array<{
      total_rows: bigint
      already_set: bigint
      candidates: bigint
      from_ptbrd: bigint
      still_missing: bigint
    }>
  >(Prisma.sql`
    WITH resolved AS (
      SELECT DISTINCT ON (cb.id)
        cb.id,
        cb.logo_url AS current_logo_url,
        pt.logo_url AS pt_logo_url,
        pt.logo_url AS resolved_logo_url
      FROM v0.brand_list cb
      JOIN v0.brand_mappings m ON m.brand_list_id = cb.id
      LEFT JOIN v0.ptdrk_brands pt ON pt.id = m.ptdrk_brands_id
    )
    SELECT
      COUNT(*)::bigint AS total_rows,
      COUNT(*) FILTER (
        WHERE current_logo_url IS NOT NULL AND BTRIM(current_logo_url) <> ''
      )::bigint AS already_set,
      COUNT(*) FILTER (
        WHERE resolved_logo_url IS NOT NULL
          AND (
            ${FORCE}
            OR current_logo_url IS NULL
            OR BTRIM(current_logo_url) = ''
          )
      )::bigint AS candidates,
      COUNT(*) FILTER (
        WHERE resolved_logo_url IS NOT NULL
          AND pt_logo_url IS NOT NULL
          AND (
            ${FORCE}
            OR current_logo_url IS NULL
            OR BTRIM(current_logo_url) = ''
          )
      )::bigint AS from_ptbrd,
      COUNT(*) FILTER (
        WHERE resolved_logo_url IS NULL
      )::bigint AS still_missing
    FROM resolved
  `)

  const row = rows[0]
  const candidates = Number(row?.candidates ?? 0)

  return {
    totalRows: Number(row?.total_rows ?? 0),
    alreadySet: Number(row?.already_set ?? 0),
    candidates,
    fromPtbrands: Number(row?.from_ptbrd ?? 0),
    updated: DRY_RUN ? 0 : candidates,
    stillMissing: Number(row?.still_missing ?? 0)
  }
}

async function runBackfill(): Promise<number> {
  const result = await db.$executeRaw(Prisma.sql`
    UPDATE v0.brand_list cb
    SET logo_url = sub.resolved_logo_url
    FROM (
      SELECT DISTINCT ON (cb2.id)
        cb2.id,
        pt.logo_url AS resolved_logo_url
      FROM v0.brand_list cb2
      JOIN v0.brand_mappings m ON m.brand_list_id = cb2.id
      LEFT JOIN v0.ptdrk_brands pt ON pt.id = m.ptdrk_brands_id
      WHERE pt.logo_url IS NOT NULL
        AND (
          ${FORCE}
          OR cb2.logo_url IS NULL
          OR BTRIM(cb2.logo_url) = ''
        )
    ) sub
    WHERE cb.id = sub.id
  `)

  return Number(result)
}

async function main() {
  console.log(
    `[backfill-dnbrd-match-logos] Mode: ${DRY_RUN ? 'DRY RUN' : 'APPLY'}${FORCE ? ' (FORCE)' : ''}`
  )

  await applyMigration()

  const before = await fetchStats()
  console.log('[backfill-dnbrd-match-logos] Stats before apply:', before)

  if (!DRY_RUN && before.candidates > 0) {
    const updated = await runBackfill()
    console.log('[backfill-dnbrd-match-logos] Rows updated:', updated)

    const after = await fetchStats()
    console.log('[backfill-dnbrd-match-logos] Stats after apply:', after)
  } else if (DRY_RUN) {
    console.log(
      `[backfill-dnbrd-match-logos] Would update ${before.candidates} row(s). Set APPLY=true to write.`
    )
  } else {
    console.log('[backfill-dnbrd-match-logos] Nothing to update.')
  }
}

main()
  .catch((error) => {
    console.error('[backfill-dnbrd-match-logos] Failed:', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await db.$disconnect()
  })