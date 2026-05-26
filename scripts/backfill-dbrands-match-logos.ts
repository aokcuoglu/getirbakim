/**
 * Backfill v0.dbrands_match.logo_url from ptbrands.logo_url (via ptbrands_id join)
 * with fallback to public.part_brands.logo_url (matched by brand name).
 *
 * Usage:
 *   bun scripts/backfill-dbrands-match-logos.ts              # dry run (default)
 *   APPLY=true bun scripts/backfill-dbrands-match-logos.ts   # write to DB
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
  fromPartBrands: number
  updated: number
  stillMissing: number
}

async function applyMigration() {
  if (SKIP_MIGRATION) {
    console.log('[backfill-dbrands-match-logos] Skipping migration (SKIP_MIGRATION=true)')
    return
  }

  const scriptDir = dirname(fileURLToPath(import.meta.url))
  const migrationPath = join(
    scriptDir,
    '../prisma/migrations/20260526150000_dbrands_match_logo_url/migration.sql'
  )
  const sql = readFileSync(migrationPath, 'utf8')
  await db.$executeRawUnsafe(sql)
  console.log('[backfill-dbrands-match-logos] Applied migration:', migrationPath)
}

async function fetchStats(): Promise<BackfillStats> {
  const rows = await db.$queryRaw<
    Array<{
      total_rows: bigint
      already_set: bigint
      candidates: bigint
      from_ptbrands: bigint
      from_part_brands: bigint
      still_missing: bigint
    }>
  >(Prisma.sql`
    WITH resolved AS (
      SELECT
        dm.id,
        dm.logo_url AS current_logo_url,
        pt.logo_url AS pt_logo_url,
        pb.logo_url AS pb_logo_url,
        COALESCE(pt.logo_url, pb.logo_url) AS resolved_logo_url
      FROM v0.dbrands_match dm
      LEFT JOIN v0.ptbrands pt ON pt.id = dm.ptbrands_id
      LEFT JOIN v0.dbrands d ON d.id = dm.dbrands_id
      LEFT JOIN LATERAL (
        SELECT logo_url
        FROM public.part_brands pb
        WHERE LOWER(pb.name) = LOWER(
          COALESCE(
            NULLIF(BTRIM(dm.normalized), ''),
            pt.name,
            d.brand
          )
        )
          AND pb.logo_url IS NOT NULL
        LIMIT 1
      ) pb ON TRUE
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
      )::bigint AS from_ptbrands,
      COUNT(*) FILTER (
        WHERE resolved_logo_url IS NOT NULL
          AND pt_logo_url IS NULL
          AND pb_logo_url IS NOT NULL
          AND (
            ${FORCE}
            OR current_logo_url IS NULL
            OR BTRIM(current_logo_url) = ''
          )
      )::bigint AS from_part_brands,
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
    fromPtbrands: Number(row?.from_ptbrands ?? 0),
    fromPartBrands: Number(row?.from_part_brands ?? 0),
    updated: DRY_RUN ? 0 : candidates,
    stillMissing: Number(row?.still_missing ?? 0)
  }
}

async function runBackfill(): Promise<number> {
  const result = await db.$executeRaw(Prisma.sql`
    UPDATE v0.dbrands_match dm
    SET logo_url = sub.resolved_logo_url
    FROM (
      SELECT
        dm2.id,
        COALESCE(pt.logo_url, pb.logo_url) AS resolved_logo_url
      FROM v0.dbrands_match dm2
      LEFT JOIN v0.ptbrands pt ON pt.id = dm2.ptbrands_id
      LEFT JOIN v0.dbrands d ON d.id = dm2.dbrands_id
      LEFT JOIN LATERAL (
        SELECT logo_url
        FROM public.part_brands pb
        WHERE LOWER(pb.name) = LOWER(
          COALESCE(
            NULLIF(BTRIM(dm2.normalized), ''),
            pt.name,
            d.brand
          )
        )
          AND pb.logo_url IS NOT NULL
        LIMIT 1
      ) pb ON TRUE
      WHERE COALESCE(pt.logo_url, pb.logo_url) IS NOT NULL
        AND (
          ${FORCE}
          OR dm2.logo_url IS NULL
          OR BTRIM(dm2.logo_url) = ''
        )
    ) sub
    WHERE dm.id = sub.id
  `)

  return Number(result)
}

async function main() {
  console.log(
    `[backfill-dbrands-match-logos] Mode: ${DRY_RUN ? 'DRY RUN' : 'APPLY'}${FORCE ? ' (FORCE)' : ''}`
  )

  await applyMigration()

  const before = await fetchStats()
  console.log('[backfill-dbrands-match-logos] Stats before apply:', before)

  if (!DRY_RUN && before.candidates > 0) {
    const updated = await runBackfill()
    console.log('[backfill-dbrands-match-logos] Rows updated:', updated)

    const after = await fetchStats()
    console.log('[backfill-dbrands-match-logos] Stats after apply:', after)
  } else if (DRY_RUN) {
    console.log(
      `[backfill-dbrands-match-logos] Would update ${before.candidates} row(s). Set APPLY=true to write.`
    )
  } else {
    console.log('[backfill-dbrands-match-logos] Nothing to update.')
  }
}

main()
  .catch((error) => {
    console.error('[backfill-dbrands-match-logos] Failed:', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await db.$disconnect()
  })
