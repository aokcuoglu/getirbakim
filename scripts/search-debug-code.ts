/**
 * Search Debug: Code Diagnostic Script
 *
 * Searches the database for a given code across all code tables
 * to diagnose why a code might not appear in search results.
 *
 * Usage:
 *   CODE=0445110376 bun scripts/search-debug-code.ts
 */

import 'dotenv/config'
import { db } from '../lib/db'
import { Prisma } from '@prisma/client'
import { normalizeCode, compactCode } from '../lib/search/code-normalization'

const SEARCH_CODE = process.env.CODE || process.argv[2] || ''

async function main() {
  if (!SEARCH_CODE) {
    console.error('Usage: CODE=0445110376 bun scripts/search-debug-code.ts')
    process.exit(1)
  }

  const raw = SEARCH_CODE.trim()
  const norm = normalizeCode(raw)
  const compact = compactCode(raw)

  console.log(`\n=== Code Diagnostic: "${raw}" ===`)
  console.log(`Normalized: "${norm}"`)
  console.log(`Compact:    "${compact}"\n`)

  if (norm !== compact.toUpperCase() && norm !== compact) {
    console.log(`[WARN] Normalized and compact differ: "${norm}" vs "${compact.toUpperCase()}"`)
  }

  let totalMatches = 0

  // 1. part_oens
  console.log('--- part_oens ---')
  const oenRows = await db.$queryRaw<{ id: bigint; code: string; brand: string | null; part_id: bigint }[]>`
    SELECT id, code, brand, part_id FROM part_oens
    WHERE UPPER(code) = UPPER(${raw}) OR UPPER(REPLACE(REPLACE(REPLACE(code, ' ', ''), '-', ''), '.', '')) = ${norm}
    LIMIT 20
  `
  totalMatches += oenRows.length
  if (oenRows.length === 0) {
    console.log('  No matches')
  } else {
    for (const row of oenRows) {
      console.log(`  id=${row.id} code="${row.code}" brand="${row.brand}" part_id=${row.part_id}`)
    }
  }

  // 2. part_eans
  console.log('\n--- part_eans ---')
  const eanRows = await db.$queryRaw<{ id: bigint; code: string; part_id: bigint }[]>`
    SELECT id, code, part_id FROM part_eans
    WHERE code = ${raw} OR UPPER(code) = ${norm}
    LIMIT 20
  `
  totalMatches += eanRows.length
  if (eanRows.length === 0) {
    console.log('  No matches')
  } else {
    for (const row of eanRows) {
      console.log(`  id=${row.id} code="${row.code}" part_id=${row.part_id}`)
    }
  }

  // 3. part_cross_references
  console.log('\n--- part_cross_references ---')
  const xrefRows = await db.$queryRaw<{ id: bigint; article_number: string; brand_name: string | null; part_id: bigint }[]>`
    SELECT id, article_number, brand_name, part_id FROM part_cross_references
    WHERE UPPER(article_number) = UPPER(${raw}) OR UPPER(REPLACE(REPLACE(REPLACE(article_number, ' ', ''), '-', ''), '.', '')) = ${norm}
    LIMIT 20
  `
  totalMatches += xrefRows.length
  if (xrefRows.length === 0) {
    console.log('  No matches')
  } else {
    for (const row of xrefRows) {
      console.log(`  id=${row.id} article_number="${row.article_number}" brand="${row.brand_name}" part_id=${row.part_id}`)
    }
  }

  // 4. parts.part_no
  console.log('\n--- parts (by article_link_id) ---')
  const partRows = await db.$queryRaw<{ id: bigint; name: string; article_link_id: bigint | null }[]>`
    SELECT id, name, article_link_id FROM parts
    WHERE CAST(article_link_id AS TEXT) = ${raw} OR UPPER(CAST(article_link_id AS TEXT)) = ${norm}
    LIMIT 20
  `
  totalMatches += partRows.length
  if (partRows.length === 0) {
    console.log('  No matches')
  } else {
    for (const row of partRows) {
      console.log(`  id=${row.id} name="${row.name}" article_link_id=${row.article_link_id}`)
    }
  }

  // 5. supplier_products (by sku, normalized_sku, barcodes)
  console.log('\n--- supplier_products ---')
  const spRows = await db.$queryRaw<{ id: number; supplier_sku: string; normalized_sku: string | null; supplier_brand: string | null; supplier_name: string | null; barcode_1: string | null; barcode_2: string | null; barcode_3: string | null }[]>`
    SELECT id, supplier_sku, normalized_sku, supplier_brand, supplier_name, barcode_1, barcode_2, barcode_3
    FROM supplier_products
    WHERE UPPER(supplier_sku) = UPPER(${raw})
       OR UPPER(normalized_sku) = ${norm}
       OR barcode_1 = ${raw}
       OR barcode_2 = ${raw}
       OR barcode_3 = ${raw}
    LIMIT 20
  `
  totalMatches += spRows.length
  if (spRows.length === 0) {
    console.log('  No matches')
  } else {
    for (const row of spRows) {
      console.log(`  id=${row.id} sku="${row.supplier_sku}" normalized_sku="${row.normalized_sku}" brand="${row.supplier_brand}" name="${row.supplier_name}" barcodes=[${[row.barcode_1, row.barcode_2, row.barcode_3].filter(Boolean).join(',')}]`)
    }
  }

  // 6. supplier_product_oems
  console.log('\n--- supplier_product_oems ---')
  const spoRows = await db.$queryRaw<{ id: number; oem_code: string; normalized_oem_code: string | null; supplier_product_id: number; is_active: boolean }[]>`
    SELECT id, oem_code, normalized_oem_code, supplier_product_id, is_active
    FROM supplier_product_oems
    WHERE UPPER(oem_code) = UPPER(${raw}) OR UPPER(normalized_oem_code) = ${norm}
    LIMIT 20
  `
  totalMatches += spoRows.length
  if (spoRows.length === 0) {
    console.log('  No matches')
  } else {
    for (const row of spoRows) {
      console.log(`  id=${row.id} oem_code="${row.oem_code}" normalized="${row.normalized_oem_code}" sp_id=${row.supplier_product_id} active=${row.is_active}`)
    }
  }

  // 7. supplier_part_mappings
  console.log('\n--- supplier_part_mappings (by sku) ---')
  const spmRows = await db.$queryRaw<{ id: number; supplier_product_id: number; part_id: bigint | null; supplier_sku: string; status: string; match_reason: string | null }[]>`
    SELECT id, supplier_product_id, part_id, supplier_sku, status, match_reason
    FROM supplier_part_mappings
    WHERE UPPER(supplier_sku) = UPPER(${raw})
    LIMIT 20
  `
  totalMatches += spmRows.length
  if (spmRows.length === 0) {
    console.log('  No matches')
  } else {
    for (const row of spmRows) {
      console.log(`  id=${row.id} sp_id=${row.supplier_product_id} part_id=${row.part_id} sku="${row.supplier_sku}" status=${row.status} reason=${row.match_reason}`)
    }
  }

  // 8. part_supplier_offers
  console.log('\n--- part_supplier_offers (by sp_id from above) ---')
  const matchedSpIds = spoRows.map(r => r.supplier_product_id)
  const matchedPartIds = [...new Set([
    ...oenRows.map(r => r.part_id),
    ...eanRows.map(r => r.part_id),
    ...xrefRows.map(r => r.part_id),
    ...partRows.map(r => r.id),
    ...spmRows.map(r => r.part_id).filter(Boolean) as bigint[]
  ])]

  if (matchedPartIds.length > 0 || matchedSpIds.length > 0) {
    const ids = matchedPartIds.slice(0, 100)
    if (ids.length > 0) {
      const psoRows = await db.$queryRaw<{ id: number; part_id: bigint; supplier_product_id: number; supplier_price: Prisma.Decimal | null; supplier_stock_qty: number; is_active: boolean }[]>`
        SELECT id, part_id, supplier_product_id, supplier_price, supplier_stock_qty, is_active
        FROM part_supplier_offers
        WHERE part_id IN (${Prisma.join(ids)})
           OR supplier_product_id IN (${Prisma.join(matchedSpIds.length > 0 ? matchedSpIds : [0])})
        LIMIT 50
      `
      totalMatches += psoRows.length
      if (psoRows.length === 0) {
        console.log('  No offers found for matched part/supplier IDs')
      } else {
        for (const row of psoRows) {
          console.log(`  id=${row.id} part_id=${row.part_id} sp_id=${row.supplier_product_id} price=${row.supplier_price} stock=${row.supplier_stock_qty} active=${row.is_active}`)
        }
      }
    }
  } else {
    console.log('  No matched IDs to check')
  }

  // 9. Meilisearch index check
  console.log('\n--- Meilisearch Index Coverage ---')
  const allPartIds = [...new Set([
    ...oenRows.map(r => r.part_id),
    ...eanRows.map(r => r.part_id),
    ...xrefRows.map(r => r.part_id),
    ...partRows.map(r => r.id),
    ...spmRows.filter(r => r.part_id).map(r => r.part_id as bigint)
  ])]
  const allSpIds = [...new Set([
    ...spRows.map(r => r.id),
    ...spoRows.map(r => r.supplier_product_id),
    ...spmRows.map(r => r.supplier_product_id)
  ])]

  if (allPartIds.length > 0) {
    const indexedParts = await db.$queryRaw<{ id: bigint }[]>`
      SELECT p.id FROM parts p
      WHERE p.id IN (${Prisma.join(allPartIds.slice(0, 50))})
    `
    console.log(`  Parts found in DB: ${indexedParts.length}/${allPartIds.length}`)

    const mappedStatus = await db.$queryRaw<{ part_id: bigint; mapping_count: bigint }[]>`
      SELECT spm.part_id, COUNT(*) as mapping_count
      FROM supplier_part_mappings spm
      WHERE spm.part_id IN (${Prisma.join(allPartIds.slice(0, 50))}) AND spm.status = 'APPROVED'
      GROUP BY spm.part_id
    `
    const mappedPartIds = new Set(mappedStatus.map(r => r.part_id.toString()))
    const unmappedPartIds = allPartIds.filter(id => !mappedPartIds.has(id.toString()))

    for (const pid of allPartIds.slice(0, 20)) {
      const isMapped = mappedPartIds.has(pid.toString())
      const isSupplierBacked = allSpIds.length > 0
      let docType = isMapped ? 'supplier_offer' : 'canonical_part'
      let likely_indexed = isMapped ? 'YES (supplier-backed phase)' : 'MAYBE (catalog-only phase, depends on limit)'
      const partFromMapped = spmRows.find(r => r.part_id?.toString() === pid.toString())
      if (partFromMapped && partFromMapped.part_id) {
        likely_indexed = 'YES (has APPROVED mapping)'
      } else if (unmappedPartIds.includes(pid)) {
        likely_indexed = 'MAYBE (catalog-only, subject to 30k limit)'
        docType = 'canonical_part'
      }
      console.log(`  part_id=${pid} mapped=${isMapped} likely_indexed="${likely_indexed}" doc_type=${docType}`)
    }
  }

  if (allSpIds.length > 0) {
    const orphanSpIds = await db.$queryRaw<{ id: number }[]>`
      SELECT sp.id FROM supplier_products sp
      WHERE sp.id IN (${Prisma.join(allSpIds.slice(0, 50))})
        AND NOT EXISTS (SELECT 1 FROM supplier_part_mappings spm WHERE spm.supplier_product_id = sp.id AND spm.status = 'APPROVED')
        AND NOT EXISTS (SELECT 1 FROM part_supplier_offers pso WHERE pso.supplier_product_id = sp.id AND pso.is_active = true)
    `
    for (const spId of allSpIds.slice(0, 20)) {
      const isOrphan = orphanSpIds.some(o => o.id === spId)
      const hasApprovedMapping = spmRows.some(m => m.supplier_product_id === spId && m.status === 'APPROVED')
      console.log(`  sp_id=${spId} has_mapping=${hasApprovedMapping} is_orphan=${isOrphan} likely_indexed="${hasApprovedMapping ? 'YES (supplier-backed)' : isOrphan ? 'MAYBE (orphan phase, subject to 10k limit)' : 'NO (has offer but no mapping)'}"`)
    }
  }

  // Summary
  console.log(`\n=== Summary ===`)
  console.log(`Total DB matches: ${totalMatches}`)
  console.log(`Part IDs found: ${allPartIds.length}`)
  console.log(`Supplier Product IDs found: ${allSpIds.length}`)
  if (totalMatches === 0) {
    console.log(`\n[DIAGNOSIS] Code "${raw}" was NOT found in any code table.`)
    console.log(`  Possible causes:`)
    console.log(`  - Code does not exist in the database`)
    console.log(`  - Code exists with different format/spacing/dashes`)
    console.log(`  - Code is in a table not covered by this diagnostic`)
  } else if (allPartIds.length === 0 && allSpIds.length === 0) {
    console.log(`\n[DIAGNOSIS] Code "${raw}" found in code tables but no part/supplier mapping.`)
  } else {
    console.log(`\n[DIAGNOSIS] Code "${raw}" has ${allPartIds.length} part(s) and ${allSpIds.length} supplier product(s).`)
    console.log(`  If search returns 0 results, the records may be excluded by index limits or normalization mismatch.`)
  }
}

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})