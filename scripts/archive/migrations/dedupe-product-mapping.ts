/**
 * Dedupe product_mapping rows by merging rows with the same (brand_list_id, part_no).
 *
 * Priority for KEEP row: dnmk_products_id > bsbg_products_id > ptdrk_products_id
 *
 * Usage:
 *   bun scripts/dedupe-product-mapping.ts --brand-list-id=5 [--dry-run]
 *   bun scripts/dedupe-product-mapping.ts --brand-list-id=5 --apply
 *   bun scripts/dedupe-product-mapping.ts --all --dry-run
 *   bun scripts/dedupe-product-mapping.ts --all --apply
 */

import 'dotenv/config'
import { db } from '../lib/db'

const args = process.argv.slice(2)

function parseArg(key: string): string | null {
  const prefix = `--${key}=`
  for (const arg of args) {
    if (arg.startsWith(prefix)) return arg.slice(prefix.length)
  }
  return null
}

function hasFlag(flag: string): boolean {
  return args.includes(`--${flag}`)
}

const brandListId = parseArg('brand-list-id')
const all = hasFlag('all')
const dryRun = hasFlag('dry-run')
const apply = hasFlag('apply')

type Row = {
  id: number
  dnmk_products_id: string | null
  ptdrk_products_id: number | null
  bsbg_products_id: string | null
  part_no: string | null
  brand_list_id: number | null
  mapping_status: string
  match_method: string | null
}

function priorityScore(row: Row): number {
  if (row.dnmk_products_id) return 0
  if (row.bsbg_products_id) return 1
  if (row.ptdrk_products_id) return 2
  return 3
}

function pickKeepRow(rows: Row[]): Row {
  let best = rows[0]
  for (const row of rows) {
    if (priorityScore(row) < priorityScore(best)) {
      best = row
    } else if (priorityScore(row) === priorityScore(best) && row.id < best.id) {
      best = row
    }
  }
  return best
}

function hasConflict(rows: Row[]): { conflict: boolean; reason?: string } {
  const dnmkIds = new Set(rows.map(r => r.dnmk_products_id).filter(Boolean))
  const ptIds = new Set(rows.map(r => r.ptdrk_products_id).filter(Boolean))
  const bsbgIds = new Set(rows.map(r => r.bsbg_products_id).filter(Boolean))

  if (dnmkIds.size > 1) return { conflict: true, reason: `dnmk_products_id: [${[...dnmkIds].join(', ')}]` }
  if (ptIds.size > 1) return { conflict: true, reason: `ptdrk_products_id: [${[...ptIds].join(', ')}]` }
  if (bsbgIds.size > 1) return { conflict: true, reason: `bsbg_products_id: [${[...bsbgIds].join(', ')}]` }

  return { conflict: false }
}

function mergeValues(keep: Row, others: Row[]): { dnmk: string | null; pt: number | null; bsbg: string | null } {
  let dnmk = keep.dnmk_products_id
  let pt = keep.ptdrk_products_id
  let bsbg = keep.bsbg_products_id

  for (const row of others) {
    if (row.dnmk_products_id && !dnmk) dnmk = row.dnmk_products_id
    if (row.ptdrk_products_id != null && pt == null) pt = row.ptdrk_products_id
    if (row.bsbg_products_id && !bsbg) bsbg = row.bsbg_products_id
  }

  return { dnmk, pt, bsbg }
}

async function processBrand(brandListId: number) {
  console.log(`\n=== brand_list_id=${brandListId} ===`)

  const total = await db.$queryRawUnsafe<Array<{ count: number }>>(
    'SELECT COUNT(*)::int AS count FROM v0.product_mapping WHERE brand_list_id = $1',
    brandListId
  )
  console.log(`  Toplam satir: ${total[0].count}`)

  const duplicateGroups = await db.$queryRawUnsafe<Array<{ part_no: string | null; cnt: number }>>(
    `SELECT part_no, COUNT(*)::int AS cnt
     FROM v0.product_mapping
     WHERE brand_list_id = $1 AND part_no IS NOT NULL AND part_no != ''
     GROUP BY part_no
     HAVING COUNT(*) > 1
     ORDER BY part_no`,
    brandListId
  )

  if (duplicateGroups.length === 0) {
    console.log('  Tekrarlanan part_no bulunamadi.')
    return { groups: 0, rows: 0, skipped: 0, merged: 0 }
  }

  const groupPartNos = duplicateGroups.map(g => g.part_no).filter(Boolean) as string[]

  const duplicateRows = await db.$queryRawUnsafe<Row[]>(
    `SELECT id, dnmk_products_id::text, ptdrk_products_id, bsbg_products_id::text,
            part_no, brand_list_id, mapping_status, match_method
     FROM v0.product_mapping
     WHERE brand_list_id = $1 AND part_no = ANY($2::text[])
     ORDER BY part_no, id`,
    brandListId, groupPartNos
  )

  const groups = new Map<string, Row[]>()
  for (const row of duplicateRows) {
    const key = row.part_no ?? ''
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(row)
  }

  console.log(`  Tekrarlanan part_no grup sayisi: ${groups.size}`)
  let totalRows = 0
  let totalSkipped = 0
  let totalMerged = 0
  let skippedGroups: Array<{ part_no: string; reason: string }> = []

  const updates: Array<{ id: number; dnmk: string | null; pt: number | null; bsbg: string | null }> = []
  const deleteIds: number[] = []

  for (const [partNo, rows] of groups) {
    totalRows += rows.length

    const conflict = hasConflict(rows)
    if (conflict.conflict) {
      totalSkipped += rows.length
      skippedGroups.push({ part_no: partNo, reason: conflict.reason! })
      continue
    }

    totalMerged += rows.length

    const keep = pickKeepRow(rows)
    const others = rows.filter(r => r.id !== keep.id)
    const merged = mergeValues(keep, others)

    if (merged.dnmk !== keep.dnmk_products_id ||
        merged.pt !== keep.ptdrk_products_id ||
        merged.bsbg !== keep.bsbg_products_id) {
      updates.push({ id: keep.id, dnmk: merged.dnmk, pt: merged.pt, bsbg: merged.bsbg })
    }

    for (const other of others) {
      deleteIds.push(other.id)
    }
  }

  console.log(`  [${dryRun ? 'DRY-RUN' : apply ? 'APPLY' : 'ANALYSE'}]`)
  console.log(`    Grup: ${groups.size}, Satir: ${totalRows}`)
  console.log(`    Merge edilecek satir: ${totalMerged}`)
  console.log(`    Net azalma: ${totalMerged - groups.size}`)
  console.log(`    Atlanan (cakisma): ${totalSkipped} satir, ${skippedGroups.length} grup`)

  if (skippedGroups.length > 0) {
    console.log(`    Atlanan gruplar:`)
    for (const sg of skippedGroups) {
      console.log(`      part_no="${sg.part_no}": ${sg.reason}`)
    }
  }

  if (!apply || dryRun) {
    return { groups: groups.size, rows: totalRows, skipped: totalSkipped, merged: totalMerged }
  }

  console.log('  Applying... (oncekiler silinecek)')

  if (deleteIds.length > 0) {
    const CHUNK = 500
    for (let i = 0; i < deleteIds.length; i += CHUNK) {
      const chunk = deleteIds.slice(i, i + CHUNK)
      const placeholders = chunk.map((_, idx) => `$${idx + 1}::int`).join(', ')
      await db.$queryRawUnsafe(
        `DELETE FROM v0.product_mapping WHERE id IN (${placeholders})`,
        ...chunk
      )
    }
  }

  console.log('  Applying... (kalanlar merge)')

  if (updates.length > 0) {
    function val(v: string | number | null, type: string): string {
      if (v == null) return `NULL::${type}`
      if (typeof v === 'number') return `${v}::${type}`
      return `'${v}'::${type}`
    }

    const CHUNK = 100
    for (let i = 0; i < updates.length; i += CHUNK) {
      const chunk = updates.slice(i, i + CHUNK)
      const valueRows = chunk.map(u =>
        `(${val(u.id, 'int')}, ${val(u.dnmk, 'bigint')}, ${val(u.pt, 'int')}, ${val(u.bsbg, 'bigint')})`
      )
      await db.$queryRawUnsafe(
        `UPDATE v0.product_mapping m
         SET dnmk_products_id = COALESCE(u.dnmk, m.dnmk_products_id),
             ptdrk_products_id = COALESCE(u.pt, m.ptdrk_products_id),
             bsbg_products_id = COALESCE(u.bsbg, m.bsbg_products_id),
             mapping_status = 'APPROVED'
         FROM (VALUES ${valueRows.join(', ')}) AS u(id, dnmk, pt, bsbg)
         WHERE m.id = u.id`
      )
    }
  }

  return { groups: groups.size, rows: totalRows, skipped: totalSkipped, merged: totalMerged }
}

async function main() {
  console.log('=== Dedupe product_mapping ===')
  console.log(`Mode: ${dryRun ? 'DRY-RUN' : apply ? 'APPLY' : 'ANALYSE'}`)
  console.log()

  if (!brandListId && !all) {
    console.error('Hata: --brand-list-id veya --all parametresi gerekli.')
    process.exit(1)
  }

  if (all) {
    const brandIds = await db.$queryRawUnsafe<Array<{ brand_list_id: number }>>(
      `SELECT DISTINCT brand_list_id
       FROM v0.product_mapping
       WHERE brand_list_id IS NOT NULL AND part_no IS NOT NULL AND part_no != ''
       GROUP BY brand_list_id, part_no
       HAVING COUNT(*) > 1
       ORDER BY brand_list_id`
    )

    let totalGroups = 0
    let totalRows = 0
    let totalSkipped = 0
    let totalMerged = 0

    for (const { brand_list_id: bid } of brandIds) {
      const result = await processBrand(bid)
      totalGroups += result.groups
      totalRows += result.rows
      totalSkipped += result.skipped
      totalMerged += result.merged
    }

    console.log(`\n=== TOPLAM ===`)
    console.log(`  Grup: ${totalGroups}`)
    console.log(`  Satir: ${totalRows}`)
    console.log(`  Net azalma: ${totalMerged - totalGroups}`)
  } else {
    await processBrand(parseInt(brandListId!, 10))
  }
}

main()
  .then(() => process.exit(0))
  .catch(e => {
    console.error('Hata:', e)
    process.exit(1)
  })
