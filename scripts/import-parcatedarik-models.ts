/**
 * Import MODEL column from CSV into parcatedarik.products
 *
 * Matches CSV.id to parcatedarik.products.id and updates:
 *   model            = CSV.MODEL (raw)
 *   normalized_model = normalizeModel(CSV.MODEL)
 *   model_imported_at = now()
 *   model_source     = 'PARCATEDARIK_CSV_MODEL'
 *
 * Usage:
 *   DRY_RUN=true  CSV_PATH=/path/to/parca_tedarik.csv bun scripts/import-parcatedarik-models.ts
 *   APPLY=true     CSV_PATH=/path/to/parca_tedarik.csv bun scripts/import-parcatedarik-models.ts
 *
 * Optional:
 *   LIMIT=1000        Only process first N rows
 *   BATCH_SIZE=1000   Batch size for queries (default 1000)
 */

import 'dotenv/config'
import { createReadStream } from 'fs'
import { db } from '../lib/db'
import { Prisma } from '@prisma/client'
import { normalizeModel } from '../lib/matching/code-normalization'

const CSV_PATH = process.env.CSV_PATH
const DRY_RUN = process.env.APPLY !== 'true'
const LIMIT = process.env.LIMIT ? parseInt(process.env.LIMIT, 10) : undefined
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE ?? '1000', 10)

function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''").replace(/\\/g, '\\\\')
}

async function* parseCsvLines(filePath: string): AsyncGenerator<Record<string, string>> {
  const stream = createReadStream(filePath, { encoding: 'utf-8' })
  let buffer = ''
  let headers: string[] | null = null
  let rowsRead = 0

  for await (const chunk of stream) {
    buffer += chunk
    const lines = buffer.split('\n')
    buffer = lines.pop()!

    for (const line of lines) {
      if (!line.trim()) continue
      const fields = line.split(';').map(f => f.trim())

      if (!headers) {
        headers = fields
        continue
      }

      if (LIMIT !== undefined && rowsRead >= LIMIT) return

      const row: Record<string, string> = {}
      for (let i = 0; i < headers.length; i++) {
        row[headers[i]] = fields[i] ?? ''
      }
      rowsRead++
      yield row
    }
  }

  if (buffer.trim()) {
    const fields = buffer.trim().split(';').map(f => f.trim())
    if (headers) {
      const row: Record<string, string> = {}
      for (let i = 0; i < headers.length; i++) {
        row[headers[i]] = fields[i] ?? ''
      }
      yield row
    }
  }
}

interface UpdateRow {
  id: number
  model: string
  normalizedModel: string | null
  title: string
  oldModel: string | null
}

interface Stats {
  rowsRead: number
  rowsWithModel: number
  rowsSkippedNoModel: number
  productsMatchedById: number
  productsNotFoundById: number
  rowsWouldUpdate: number
  duplicateNormalizedModelCount: number
  errors: number
  rowsUpdated: number
}

async function main() {
  if (!CSV_PATH) {
    console.error('[import] CSV_PATH is required')
    process.exit(1)
  }

  console.log('[import] ParçaTedarik MODEL import')
  console.log(`[import] CSV_PATH    = ${CSV_PATH}`)
  console.log(`[import] MODE        = ${DRY_RUN ? 'DRY_RUN' : 'APPLY'}`)
  console.log(`[import] LIMIT       = ${LIMIT ?? 'none'}`)
  console.log(`[import] BATCH_SIZE  = ${BATCH_SIZE}`)
  console.log()

  const stats: Stats = {
    rowsRead: 0,
    rowsWithModel: 0,
    rowsSkippedNoModel: 0,
    productsMatchedById: 0,
    productsNotFoundById: 0,
    rowsWouldUpdate: 0,
    duplicateNormalizedModelCount: 0,
    errors: 0,
    rowsUpdated: 0,
  }

  const updates: UpdateRow[] = []
  const idsWithModel: number[] = []
  const modelValues: Map<number, { model: string; normalizedModel: string | null }> = new Map()

  // Phase 1: Parse CSV
  console.log('[import] Phase 1: Parsing CSV...')
  for await (const row of parseCsvLines(CSV_PATH)) {
    stats.rowsRead++

    const id = parseInt(row.id, 10)
    if (isNaN(id)) {
      stats.errors++
      continue
    }

    const modelRaw = (row.MODEL ?? '').trim()
    if (!modelRaw) {
      stats.rowsSkippedNoModel++
      continue
    }

    stats.rowsWithModel++
    const normalizedModel = normalizeModel(modelRaw)
    modelValues.set(id, { model: modelRaw, normalizedModel })
    idsWithModel.push(id)
  }

  console.log(`[import] Parsed ${stats.rowsRead} rows, ${stats.rowsWithModel} with MODEL, ${stats.rowsSkippedNoModel} skipped`)

  // Phase 2: Match against DB
  console.log('[import] Phase 2: Matching against database...')
  const matchedIds: Set<number> = new Set()

  for (let i = 0; i < idsWithModel.length; i += BATCH_SIZE) {
    const batch = idsWithModel.slice(i, i + BATCH_SIZE)
    const products = await db.$queryRaw<
      Array<{ id: number; title: string; model: string | null }>
    >`SELECT id, title, model FROM parcatedarik.product WHERE id IN (${Prisma.join(batch)})`

    for (const p of products) {
      const mv = modelValues.get(p.id)
      if (!mv) continue

      stats.productsMatchedById++
      matchedIds.add(p.id)

      updates.push({
        id: p.id,
        model: mv.model,
        normalizedModel: mv.normalizedModel,
        title: p.title,
        oldModel: p.model,
      })
    }
  }

  for (const id of idsWithModel) {
    if (!matchedIds.has(id)) {
      stats.productsNotFoundById++
    }
  }

  stats.rowsWouldUpdate = updates.length

  // Compute duplicate normalized_model counts
  const normalizedCounts = new Map<string, number>()
  for (const u of updates) {
    if (u.normalizedModel) {
      normalizedCounts.set(u.normalizedModel, (normalizedCounts.get(u.normalizedModel) ?? 0) + 1)
    }
  }
  stats.duplicateNormalizedModelCount = Array.from(normalizedCounts.values()).filter(c => c > 1).length

  // Phase 3: Print summary
  console.log()
  console.log('=== Import Summary ===')
  console.log(`  rowsRead:                  ${stats.rowsRead}`)
  console.log(`  rowsWithModel:             ${stats.rowsWithModel}`)
  console.log(`  rowsSkippedNoModel:        ${stats.rowsSkippedNoModel}`)
  console.log(`  productsMatchedById:       ${stats.productsMatchedById}`)
  console.log(`  productsNotFoundById:      ${stats.productsNotFoundById}`)
  console.log(`  rowsWouldUpdate:            ${stats.rowsWouldUpdate}`)
  console.log(`  duplicateNormalizedModel:   ${stats.duplicateNormalizedModelCount}`)
  console.log(`  errors:                    ${stats.errors}`)

  // Print 20 sample updates
  console.log()
  console.log('=== Sample Updates (first 20) ===')
  const samples = updates.slice(0, 20)
  for (const s of samples) {
    console.log(
      `  id=${s.id} | model: "${s.oldModel ?? 'NULL'}" -> "${s.model}" | normalized: ${s.normalizedModel} | title: ${s.title.slice(0, 60)}`
    )
  }

  if (DRY_RUN) {
    console.log()
    console.log('[import] DRY_RUN mode - no database writes performed.')
    console.log('[import] Re-run with APPLY=true to apply changes.')
    await db.$disconnect()
    return
  }

  // Phase 4: Apply updates in batches using parameterized queries
  console.log()
  console.log('[import] Phase 4: Applying updates...')
  let totalUpdated = 0

  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const batch = updates.slice(i, i + BATCH_SIZE)
    const valuesClauses = batch.map(u => {
      const modelEscaped = escapeSqlString(u.model)
      const normalizedEscaped = u.normalizedModel ? `'${escapeSqlString(u.normalizedModel)}'` : 'NULL'
      return `(${u.id}, '${modelEscaped}', ${normalizedEscaped})`
    })

    const sql = `
      UPDATE parcatedarik.product AS p
      SET
        model = v.model,
        normalized_model = v.normalized_model,
        model_imported_at = now(),
        model_source = 'PARCATEDARIK_CSV_MODEL'
      FROM (VALUES ${valuesClauses.join(', ')}) AS v(id, model, normalized_model)
      WHERE p.id = v.id
    `

    const result = await db.$executeRawUnsafe(sql)
    totalUpdated += result
    console.log(`  Batch ${Math.floor(i / BATCH_SIZE) + 1}: updated ${result} rows`)
  }

  stats.rowsUpdated = totalUpdated
  console.log()
  console.log(`[import] Total rows updated: ${totalUpdated}`)

  // Phase 5: Validation
  console.log()
  console.log('=== Validation SQL ===')

  const totalProducts = await db.$queryRaw<Array<{ count: bigint }>>
    `SELECT COUNT(*) AS count FROM parcatedarik.product`
  console.log(`  Total products: ${totalProducts[0].count}`)

  const withModel = await db.$queryRaw<Array<{ count: bigint }>>
    `SELECT COUNT(*) AS count FROM parcatedarik.product WHERE model IS NOT NULL AND model <> ''`
  console.log(`  Products with model: ${withModel[0].count}`)

  const withNormalizedModel = await db.$queryRaw<Array<{ count: bigint }>>
    `SELECT COUNT(*) AS count FROM parcatedarik.product WHERE normalized_model IS NOT NULL AND normalized_model <> ''`
  console.log(`  Products with normalized_model: ${withNormalizedModel[0].count}`)

  const duplicateModels = await db.$queryRaw<
    Array<{ normalized_model: string; count: bigint }>
  >`
    SELECT normalized_model, COUNT(*) AS count
    FROM parcatedarik.product
    WHERE normalized_model IS NOT NULL
    GROUP BY normalized_model
    HAVING COUNT(*) > 1
    ORDER BY count DESC
    LIMIT 20
  `
  console.log('  Duplicate normalized_model values (top 20):')
  for (const d of duplicateModels) {
    console.log(`    ${d.normalized_model}: ${d.count}`)
  }

  const recentUpdates = await db.$queryRaw<
    Array<{ id: number; product_id: string; model: string | null; normalized_model: string | null; title: string }>
  >`
    SELECT id, product_id, model, normalized_model, title
    FROM parcatedarik.product
    WHERE model_source = 'PARCATEDARIK_CSV_MODEL'
    ORDER BY model_imported_at DESC
    LIMIT 20
  `
  console.log('  Recent updates (sample):')
  for (const r of recentUpdates) {
    console.log(`    id=${r.id} product_id=${r.product_id} model="${r.model}" normalized="${r.normalized_model}" title="${r.title.slice(0, 50)}"`)
  }

  // Phase 6: Dinamik barcode match potential report
  console.log()
  console.log('=== Dinamik Barcode vs ParçaTedarik Model Match Potential ===')

  const totalDinamik = await db.$queryRaw<Array<{ count: bigint }>>
    `SELECT COUNT(*) AS count FROM supplier_products sp JOIN supplier_providers spr ON sp.provider_id = spr.id WHERE spr.code ILIKE '%dinamik%'`
  console.log(`  Total Dinamik products: ${totalDinamik[0].count}`)

  const dinWithBarcode = await db.$queryRaw<Array<{ count: bigint }>>
    `SELECT COUNT(*) AS count FROM supplier_products sp JOIN supplier_providers spr ON sp.provider_id = spr.id WHERE spr.code ILIKE '%dinamik%' AND (sp.barcode_1 IS NOT NULL AND sp.barcode_1 <> '' OR sp.barcode_2 IS NOT NULL AND sp.barcode_2 <> '' OR sp.barcode_3 IS NOT NULL AND sp.barcode_3 <> '')`
  console.log(`  Dinamik products with any barcode: ${dinWithBarcode[0].count}`)

  const bar1Match = await db.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(DISTINCT sp.id) AS count
    FROM supplier_products sp
    JOIN supplier_providers spr ON sp.provider_id = spr.id
    WHERE spr.code ILIKE '%dinamik%'
      AND sp.barcode_1 IS NOT NULL AND sp.barcode_1 <> ''
      AND UPPER(REGEXP_REPLACE(sp.barcode_1, '[^A-Za-z0-9]', '', 'g')) IN (
        SELECT DISTINCT normalized_model FROM parcatedarik.product WHERE normalized_model IS NOT NULL AND normalized_model <> ''
      )`
  console.log(`  Matches via barcode_1: ${bar1Match[0].count}`)

  const bar2Match = await db.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(DISTINCT sp.id) AS count
    FROM supplier_products sp
    JOIN supplier_providers spr ON sp.provider_id = spr.id
    WHERE spr.code ILIKE '%dinamik%'
      AND sp.barcode_2 IS NOT NULL AND sp.barcode_2 <> ''
      AND UPPER(REGEXP_REPLACE(sp.barcode_2, '[^A-Za-z0-9]', '', 'g')) IN (
        SELECT DISTINCT normalized_model FROM parcatedarik.product WHERE normalized_model IS NOT NULL AND normalized_model <> ''
      )`
  console.log(`  Matches via barcode_2: ${bar2Match[0].count}`)

  const bar3Match = await db.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(DISTINCT sp.id) AS count
    FROM supplier_products sp
    JOIN supplier_providers spr ON sp.provider_id = spr.id
    WHERE spr.code ILIKE '%dinamik%'
      AND sp.barcode_3 IS NOT NULL AND sp.barcode_3 <> ''
      AND UPPER(REGEXP_REPLACE(sp.barcode_3, '[^A-Za-z0-9]', '', 'g')) IN (
        SELECT DISTINCT normalized_model FROM parcatedarik.product WHERE normalized_model IS NOT NULL AND normalized_model <> ''
      )`
  console.log(`  Matches via barcode_3: ${bar3Match[0].count}`)

  const combinedMatch = await db.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(DISTINCT sp.id) AS count
    FROM supplier_products sp
    JOIN supplier_providers spr ON sp.provider_id = spr.id
    WHERE spr.code ILIKE '%dinamik%'
      AND (
        (sp.barcode_1 IS NOT NULL AND sp.barcode_1 <> ''
          AND UPPER(REGEXP_REPLACE(sp.barcode_1, '[^A-Za-z0-9]', '', 'g')) IN (
            SELECT DISTINCT normalized_model FROM parcatedarik.product WHERE normalized_model IS NOT NULL AND normalized_model <> ''
          ))
        OR
        (sp.barcode_2 IS NOT NULL AND sp.barcode_2 <> ''
          AND UPPER(REGEXP_REPLACE(sp.barcode_2, '[^A-Za-z0-9]', '', 'g')) IN (
            SELECT DISTINCT normalized_model FROM parcatedarik.product WHERE normalized_model IS NOT NULL AND normalized_model <> ''
          ))
        OR
        (sp.barcode_3 IS NOT NULL AND sp.barcode_3 <> ''
          AND UPPER(REGEXP_REPLACE(sp.barcode_3, '[^A-Za-z0-9]', '', 'g')) IN (
            SELECT DISTINCT normalized_model FROM parcatedarik.product WHERE normalized_model IS NOT NULL AND normalized_model <> ''
          ))
      )`
  console.log(`  Distinct Dinamik products matched: ${combinedMatch[0].count}`)

  const ptMatched = await db.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(DISTINCT p.id) AS count
    FROM parcatedarik.product p
    WHERE p.normalized_model IS NOT NULL AND p.normalized_model <> ''
      AND (
        EXISTS (SELECT 1 FROM supplier_products sp JOIN supplier_providers spr ON sp.provider_id = spr.id
                WHERE spr.code ILIKE '%dinamik%'
                  AND sp.barcode_1 IS NOT NULL AND sp.barcode_1 <> ''
                  AND UPPER(REGEXP_REPLACE(sp.barcode_1, '[^A-Za-z0-9]', '', 'g')) = p.normalized_model)
        OR
        EXISTS (SELECT 1 FROM supplier_products sp JOIN supplier_providers spr ON sp.provider_id = spr.id
                WHERE spr.code ILIKE '%dinamik%'
                  AND sp.barcode_2 IS NOT NULL AND sp.barcode_2 <> ''
                  AND UPPER(REGEXP_REPLACE(sp.barcode_2, '[^A-Za-z0-9]', '', 'g')) = p.normalized_model)
        OR
        EXISTS (SELECT 1 FROM supplier_products sp JOIN supplier_providers spr ON sp.provider_id = spr.id
                WHERE spr.code ILIKE '%dinamik%'
                  AND sp.barcode_3 IS NOT NULL AND sp.barcode_3 <> ''
                  AND UPPER(REGEXP_REPLACE(sp.barcode_3, '[^A-Za-z0-9]', '', 'g')) = p.normalized_model)
      )`
  console.log(`  Distinct ParçaTedarik products matched: ${ptMatched[0].count}`)

  const ambiguous = await db.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*) AS count FROM (
      SELECT sp.id AS din_id, COUNT(DISTINCT p.id) AS pt_count
      FROM supplier_products sp
      JOIN supplier_providers spr ON sp.provider_id = spr.id
      JOIN parcatedarik.product p ON (
        (sp.barcode_1 IS NOT NULL AND sp.barcode_1 <> ''
          AND UPPER(REGEXP_REPLACE(sp.barcode_1, '[^A-Za-z0-9]', '', 'g')) = p.normalized_model)
        OR
        (sp.barcode_2 IS NOT NULL AND sp.barcode_2 <> ''
          AND UPPER(REGEXP_REPLACE(sp.barcode_2, '[^A-Za-z0-9]', '', 'g')) = p.normalized_model)
        OR
        (sp.barcode_3 IS NOT NULL AND sp.barcode_3 <> ''
          AND UPPER(REGEXP_REPLACE(sp.barcode_3, '[^A-Za-z0-9]', '', 'g')) = p.normalized_model)
      )
      WHERE spr.code ILIKE '%dinamik%'
        AND p.normalized_model IS NOT NULL AND p.normalized_model <> ''
      GROUP BY sp.id
      HAVING COUNT(DISTINCT p.id) > 1
    ) sub`
  console.log(`  Ambiguous matches (1 Dinamik -> 2+ PT): ${ambiguous[0].count}`)

  console.log()
  console.log('[import] Done.')
  await db.$disconnect()
}

main().catch(err => {
  console.error('[import] Fatal error:', err)
  process.exit(1)
})