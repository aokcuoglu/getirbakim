/**
 * Generate PT_UNMATCHED rows for ParcaTedarik products
 * that have normalized_model but no existing match in
 * dinamik_parcatedarik_model_matches.
 *
 * This allows manual matching from the admin UI - finding
 * a Dinamik product to pair with each unmatched ParcaTedarik product.
 *
 * Usage:
 *   DRY_RUN=true  bun scripts/generate-pt-unmatched.ts
 *   APPLY=true     bun scripts/generate-pt-unmatched.ts
 *
 * Optional:
 *   LIMIT=5000         Only process first N products
 *   BATCH_SIZE=1000    Batch size for inserts
 */

import 'dotenv/config'
import { db } from '../lib/db'
import { Prisma } from '@prisma/client'

const DRY_RUN = process.env.APPLY !== 'true'
const LIMIT = process.env.LIMIT ? parseInt(process.env.LIMIT, 10) : undefined
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE ?? '1000', 10)

interface Stats {
  ptProductsScanned: number
  ptWithModel: number
  alreadyMatched: number
  unmatchedInserted: number
  errors: number
}

async function main() {
  console.log('[pt-unmatched] PT_UNMATCHED Generation')
  console.log(`[pt-unmatched] MODE       = ${DRY_RUN ? 'DRY_RUN' : 'APPLY'}`)
  console.log(`[pt-unmatched] LIMIT      = ${LIMIT ?? 'none'}`)
  console.log(`[pt-unmatched] BATCH_SIZE = ${BATCH_SIZE}`)
  console.log()

  const stats: Stats = {
    ptProductsScanned: 0,
    ptWithModel: 0,
    alreadyMatched: 0,
    unmatchedInserted: 0,
    errors: 0
  }

  // Step 1: Find ParcaTedarik products with normalized_model that are NOT in matches
  console.log('[pt-unmatched] Loading already-matched ParcaTedarik product IDs...')
  const matchedIds = await db.$queryRaw<
    Array<{ parcatedarik_product_id: bigint }>
  >(Prisma.sql`
    SELECT DISTINCT parcatedarik_product_id
    FROM public.dinamik_parcatedarik_model_matches
  `)
  const matchedSet = new Set<number>()
  for (const row of matchedIds) {
    matchedSet.add(Number(row.parcatedarik_product_id))
  }
  console.log(`[pt-unmatched] ${matchedSet.size} ParcaTedarik products already have matches`)

  // Step 2: Load ParcaTedarik products with normalized_model
  console.log('[pt-unmatched] Loading ParcaTedarik products with normalized_model...')
  const limitClause = LIMIT ? Prisma.sql`LIMIT ${LIMIT}` : Prisma.sql``

  const ptProducts = await db.$queryRaw<
    Array<{
      id: number
      product_id: string
      title: string
      model: string | null
      normalized_model: string
      manufacturer_id: number
      manufacturer_name: string
    }>
  >(Prisma.sql`
    SELECT p.id, p.product_id, p.title, p.model, p.normalized_model,
           p.manufacturer_id, m.name AS manufacturer_name
    FROM parcatedarik.product p
    JOIN parcatedarik.manufacturer m ON m.id = p.manufacturer_id
    WHERE p.normalized_model IS NOT NULL
      AND p.normalized_model <> ''
    ORDER BY p.id
    ${limitClause}
  `)

  stats.ptProductsScanned = ptProducts.length
  console.log(`[pt-unmatched] Loaded ${ptProducts.length} ParcaTedarik products with normalized_model`)

  // Step 3: Filter out already-matched products
  const unmatched: Array<{
    parcatedarik_product_id: number
    parcatedarik_model: string
    normalized_model: string
    manufacturer_name: string
  }> = []

  for (const pt of ptProducts) {
    stats.ptWithModel++
    if (matchedSet.has(pt.id)) {
      stats.alreadyMatched++
      continue
    }

    unmatched.push({
      parcatedarik_product_id: pt.id,
      parcatedarik_model: pt.model || '',
      normalized_model: pt.normalized_model,
      manufacturer_name: pt.manufacturer_name
    })
  }

  console.log(`[pt-unmatched] ${stats.alreadyMatched} already matched, ${unmatched.length} unmatched`)

  if (unmatched.length === 0) {
    console.log('[pt-unmatched] No unmatched products to insert.')
    await db.$disconnect()
    return
  }

  // Step 4: Insert PT_UNMATCHED rows
  console.log()
  console.log('=== Generation Summary ===')
  console.log(`  parcaTedarikProductsScanned: ${stats.ptProductsScanned}`)
  console.log(`  parcaTedarikProductsWithModel: ${stats.ptWithModel}`)
  console.log(`  alreadyMatched:               ${stats.alreadyMatched}`)
  console.log(`  unmatchedToInsert:             ${unmatched.length}`)

  // Print sample
  console.log()
  console.log('=== Sample Unmatched (first 20) ===')
  for (const u of unmatched.slice(0, 20)) {
    console.log(
      `  pt_id=${u.parcatedarik_product_id} model="${u.parcatedarik_model}" ` +
      `norm="${u.normalized_model}" mfr="${u.manufacturer_name}"`
    )
  }

  if (DRY_RUN) {
    console.log()
    console.log('[pt-unmatched] DRY_RUN mode - no database writes performed.')
    console.log('[pt-unmatched] Re-run with APPLY=true to apply changes.')
    await db.$disconnect()
    return
  }

  console.log()
  console.log('[pt-unmatched] Inserting PT_UNMATCHED rows...')

  for (let i = 0; i < unmatched.length; i += BATCH_SIZE) {
    const batch = unmatched.slice(i, i + BATCH_SIZE)
    const valuesClauses = batch.map(u => {
      const pm = u.parcatedarik_model.replace(/'/g, "''")
      const nm = u.normalized_model.replace(/'/g, "''")
      return `(${u.parcatedarik_product_id}, '${pm}', '${nm}', 'PT_UNMATCHED', 0.0000)`
    })

    const sql = `
      INSERT INTO public.dinamik_parcatedarik_model_matches (
        parcatedarik_product_id, parcatedarik_model, normalized_model,
        match_reason, confidence, status,
        dinamik_barcode_field, dinamik_barcode_value, normalized_barcode_value
      ) VALUES ${valuesClauses.join(', ')}
      ON CONFLICT DO NOTHING
    `

    try {
      // For PT_UNMATCHED rows we need NULL dinamik_product_id
      // which requires a different approach since the unique constraint includes it
      // We'll use a raw insert that allows NULL dinamik_product_id
      const batchSql = `
        INSERT INTO public.dinamik_parcatedarik_model_matches (
          dinamik_product_id, parcatedarik_product_id,
          dinamik_barcode_field, dinamik_barcode_value, normalized_barcode_value,
          parcatedarik_model, normalized_model,
          match_reason, confidence, status
        ) VALUES ${batch.map(u => {
          const pm = u.parcatedarik_model.replace(/'/g, "''")
          const nm = u.normalized_model.replace(/'/g, "''")
          return `(NULL, ${u.parcatedarik_product_id}, 'none', '', '', '${pm}', '${nm}', 'PT_UNMATCHED', 0.0000, 'PT_UNMATCHED')`
        }).join(', ')}
        ON CONFLICT DO NOTHING
      `
      const result = await db.$executeRawUnsafe(batchSql)
      stats.unmatchedInserted += batch.length
      console.log(`  Batch ${Math.floor(i / BATCH_SIZE) + 1}: processed ${batch.length} rows`)
    } catch (error) {
      console.error(`  Batch ${Math.floor(i / BATCH_SIZE) + 1}: error inserting`, error)
      stats.errors++
    }
  }

  console.log()
  console.log(`[pt-unmatched] Total PT_UNMATCHED rows inserted: ${stats.unmatchedInserted}`)

  // Validation
  console.log()
  console.log('=== Validation ===')
  const totalMatches = await db.$queryRaw<
    Array<{ count: bigint }>
  >(Prisma.sql`SELECT COUNT(*) AS count FROM public.dinamik_parcatedarik_model_matches`)
  console.log(`  Total matches in table: ${totalMatches[0].count}`)

  const ptUnmatched = await db.$queryRaw<
    Array<{ count: bigint }>
  >(Prisma.sql`SELECT COUNT(*) AS count FROM public.dinamik_parcatedarik_model_matches WHERE status = 'PT_UNMATCHED'`)
  console.log(`  PT_UNMATCHED rows: ${ptUnmatched[0].count}`)

  const unmatchedNoDinamik = await db.$queryRaw<
    Array<{ count: bigint }>
  >(Prisma.sql`SELECT COUNT(*) AS count FROM public.dinamik_parcatedarik_model_matches WHERE dinamik_product_id IS NULL`)
  console.log(`  Rows with NULL dinamik_product_id: ${unmatchedNoDinamik[0].count}`)

  console.log()
  console.log('[pt-unmatched] Done.')
  await db.$disconnect()
}

main().catch((err) => {
  console.error('[pt-unmatched] Fatal error:', err)
  process.exit(1)
})