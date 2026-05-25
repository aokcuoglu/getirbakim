/**
 * PT-only rows (Dinamik bekliyor): create dbrands from manufacturer name and APPROVE match.
 *
 *   DRY_RUN=true bun scripts/approve-pt-only-dbrands-match.ts
 *   APPLY=true bun scripts/approve-pt-only-dbrands-match.ts
 */

import 'dotenv/config'
import { Prisma } from '@prisma/client'
import { resolveDbrandsIdsByBrand } from '../lib/admin/dbrands-id'
import { db } from '../lib/db'

const APPLY = process.env.APPLY === 'true'

async function main() {
  const pending = await db.$queryRaw<
    Array<{ id: number; manufacturer_id: number; manufacturer_name: string; normalized: string | null }>
  >(Prisma.sql`
    SELECT
      a.id,
      a.manufacturer_id,
      m.name AS manufacturer_name,
      a.normalized
    FROM parcatedarik.dbrands_match a
    INNER JOIN parcatedarik.manufacturer m ON m.id = a.manufacturer_id
    WHERE a.dbrands_id IS NULL
      AND a.manufacturer_id IS NOT NULL
      AND a.mapping_status = 'PENDING'
    ORDER BY a.id
  `)

  console.log(`[approve-pt-only] PENDING PT-only rows: ${pending.length}`)

  const brandByMatchId = new Map<number, string>()
  const uniqueBrands = new Set<string>()

  for (const row of pending) {
    const brand =
      row.normalized?.trim() || row.manufacturer_name?.trim() || ''
    if (!brand) continue
    brandByMatchId.set(row.id, brand)
    uniqueBrands.add(brand)
  }

  console.log(`[approve-pt-only] Distinct brand names: ${uniqueBrands.size}`)

  if (!APPLY) {
    console.log('[approve-pt-only] DRY_RUN — APPLY=true ile uygulayın.')
    console.log('Sample:', [...uniqueBrands].slice(0, 15))
    return
  }

  const idByBrand = await resolveDbrandsIdsByBrand([...uniqueBrands])
  let updated = 0
  let skipped = 0

  for (const row of pending) {
    const brand = brandByMatchId.get(row.id)
    if (!brand) {
      skipped++
      continue
    }
    const dbrandsId = idByBrand.get(brand.trim().toLowerCase())
    if (dbrandsId == null) {
      skipped++
      continue
    }

    await db.$executeRaw(Prisma.sql`
      UPDATE parcatedarik.dbrands_match
      SET
        dbrands_id = ${dbrandsId},
        mapping_status = 'APPROVED',
        match_method = COALESCE(match_method, 'MANUAL')
      WHERE id = ${row.id}
        AND dbrands_id IS NULL
        AND mapping_status = 'PENDING'
    `)
    updated++
  }

  const [after] = await db.$queryRaw<
    Array<{ pending_pt_only: number; approved_paired: number; dbrands_total: number }>
  >(Prisma.sql`
    SELECT
      (SELECT COUNT(*)::int FROM parcatedarik.dbrands_match
        WHERE dbrands_id IS NULL AND manufacturer_id IS NOT NULL AND mapping_status = 'PENDING') AS pending_pt_only,
      (SELECT COUNT(*)::int FROM parcatedarik.dbrands_match
        WHERE dbrands_id IS NOT NULL AND manufacturer_id IS NOT NULL AND mapping_status = 'APPROVED') AS approved_paired,
      (SELECT COUNT(*)::int FROM parcatedarik.dbrands) AS dbrands_total
  `)

  console.log(`[approve-pt-only] Updated: ${updated}, skipped: ${skipped}`)
  console.log('[approve-pt-only] After:', after)
}

main().catch((error) => {
  console.error('[approve-pt-only] Failed:', error)
  process.exit(1)
})
