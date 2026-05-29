/**
 * Dinamik-ParcaTedarik Audit Script
 *
 * Phase 1: Schema and data audit for the OEM bridge.
 * Reports counts for Dinamik supplier_products, ParcaTedarik data,
 * and bridge potential between them.
 *
 * Usage:
 *   bun scripts/dinamik-parcatedarik-audit.ts
 *   DRY_RUN=true bun scripts/dinamik-parcatedarik-audit.ts
 */

import 'dotenv/config'
import { db } from '../lib/db'
import { Prisma } from '@prisma/client'
import { writeFileSync } from 'fs'
import { join } from 'path'

function normalizeCode(value: string): string {
  if (!value) return ''
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function splitRefNo(refNo: string | null): string[] {
  if (!refNo) return []
  return refNo
    .split(/[,;|/]/)
    .map(t => t.trim())
    .filter(t => t.length >= 2)
}

async function main() {
  const dryRun = process.env.DRY_RUN !== 'false'
  console.log(`[audit] Dinamik-ParcaTedarik Audit`)
  console.log(`[audit] DRY_RUN=${dryRun}`)
  console.log()

  // 1. Identify Dinamik provider
  const providers = await db.supplier_providers.findMany({
    where: {
      OR: [
        { code: { contains: 'dinamik', mode: 'insensitive' } },
        { name: { contains: 'dinamik', mode: 'insensitive' } }
      ]
    },
    select: { id: true, code: true, name: true, status: true }
  })

  console.log('=== Dinamik Provider ===')
  console.log(JSON.stringify(providers, null, 2))

  if (providers.length === 0) {
    console.error('[audit] No Dinamik provider found. Exiting.')
    process.exit(1)
  }

  const dinamikProviderId = providers[0].id

  // 2. Dinamik supplier_products counts
  const [
    totalDinamik,
    withPrice,
    withStock,
    withOems,
    withMappings,
    withOffers
  ] = await Promise.all([
    db.supplier_products.count({ where: { provider_id: dinamikProviderId } }),
    db.supplier_products.count({ where: { provider_id: dinamikProviderId, supplier_price: { not: null } } }),
    db.supplier_products.count({ where: { provider_id: dinamikProviderId, supplier_stock_qty: { gt: 0 } } }),
    db.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(DISTINCT spo.supplier_product_id) AS count
      FROM supplier_product_oems spo
      JOIN supplier_products sp ON sp.id = spo.supplier_product_id
      WHERE sp.provider_id = ${dinamikProviderId} AND spo.is_active = true
    `,
    db.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) AS count
      FROM supplier_part_mappings spm
      JOIN supplier_products sp ON sp.id = spm.supplier_product_id
      WHERE sp.provider_id = ${dinamikProviderId}
    `,
    db.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(DISTINCT pso.supplier_product_id) AS count
      FROM part_supplier_offers pso
      JOIN supplier_products sp ON sp.id = pso.supplier_product_id
      WHERE sp.provider_id = ${dinamikProviderId} AND pso.is_active = true
    `
  ])

  const dinamikOems = Number(withOems[0].count)
  const dinamikMappings = Number(withMappings[0].count)
  const dinamikOffers = Number(withOffers[0].count)

  // Map statuses
  const mappingStatuses = await db.$queryRaw<
    { status: string; count: bigint }[]
  >`
    SELECT spm.status, COUNT(*) AS count
    FROM supplier_part_mappings spm
    JOIN supplier_products sp ON sp.id = spm.supplier_product_id
    WHERE sp.provider_id = ${dinamikProviderId}
    GROUP BY spm.status
    ORDER BY count DESC
  `

  console.log('\n=== Dinamik Supplier Products ===')
  console.log(`  total: ${totalDinamik}`)
  console.log(`  with_price: ${withPrice}`)
  console.log(`  with_stock_gt_0: ${withStock}`)
  console.log(`  with_oems: ${dinamikOems}`)
  console.log(`  with_mappings: ${dinamikMappings}`)
  console.log(`  with_offers: ${dinamikOffers}`)
  console.log(`  mapping_statuses: ${JSON.stringify(mappingStatuses.map(m => ({ status: m.status, count: Number(m.count) })))}`)

  // 3. ParcaTedarik counts
  const [
    totalParcaProducts,
    withRefNo,
    totalManufacturers,
    sampleRefNos
  ] = await Promise.all([
    db.$queryRaw<[{ count: bigint }]>`SELECT COUNT(*) AS count FROM v0.ptdrk_products`,
    db.$queryRaw<[{ count: bigint }]>`SELECT COUNT(*) AS count FROM v0.ptdrk_products WHERE ref_no IS NOT NULL AND ref_no != ''`,
    db.$queryRaw<[{ count: bigint }]>`SELECT COUNT(*) AS count FROM v0.ptdrk_brands`,
    db.$queryRaw<{ ref_no: string | null }[]>`
      SELECT ref_no FROM v0.ptdrk_products
      WHERE ref_no IS NOT NULL AND ref_no != ''
      LIMIT 20
    `
  ])

  // Compute total ref_no tokens
  const allParcaRefNos = await db.$queryRaw<{ ref_no: string }[]>`
    SELECT ref_no FROM v0.ptdrk_products WHERE ref_no IS NOT NULL AND ref_no != ''
  `

  const tokenSet = new Set<string>()
  let totalTokens = 0
  for (const row of allParcaRefNos) {
    const tokens = splitRefNo(row.ref_no)
    totalTokens += tokens.length
    for (const t of tokens) {
      const n = normalizeCode(t)
      if (n) tokenSet.add(n)
    }
  }
  const distinctTokens = tokenSet.size

  console.log('\n=== ParcaTedarik Counts ===')
  console.log(`  total_products: ${Number(totalParcaProducts[0].count)}`)
  console.log(`  with_ref_no: ${Number(withRefNo[0].count)}`)
  console.log(`  total_ref_no_tokens: ${totalTokens}`)
  console.log(`  distinct_normalized_tokens: ${distinctTokens}`)
  console.log(`  manufacturers: ${Number(totalManufacturers[0].count)}`)
  console.log(`  sample_ref_nos: ${sampleRefNos.map(r => r.ref_no).join(' | ')}`)

  // 4. Bridge potential
  console.log('\n=== Bridge Potential ===')

  const tokenArray = Array.from(tokenSet)

  // Batch check against part_oens
  const oenMatches = await db.$queryRaw<[{ count: bigint }]>`
    SELECT COUNT(DISTINCT po.code) AS count
    FROM part_oens po
    WHERE po.code IN (${Prisma.join(tokenArray.slice(0, 10000))})
  `
  console.log(`  tokens_matching_part_oens: ${Number(oenMatches[0]?.count ?? 0)}`)

  // EAN matches
  const eanMatches = await db.$queryRaw<[{ count: bigint }]>`
    SELECT COUNT(DISTINCT pe.code) AS count
    FROM part_eans pe
    WHERE pe.code IN (${Prisma.join(tokenArray.slice(0, 10000))})
  `
  console.log(`  tokens_matching_part_eans: ${Number(eanMatches[0]?.count ?? 0)}`)

  // Cross-reference matches
  const crMatches = await db.$queryRaw<[{ count: bigint }]>`
    SELECT COUNT(DISTINCT pcr.article_number) AS count
    FROM part_cross_references pcr
    WHERE pcr.article_number IN (${Prisma.join(tokenArray.slice(0, 10000))})
  `
  console.log(`  tokens_matching_cross_references: ${Number(crMatches[0]?.count ?? 0)}`)

  // Part_no matches
  const partNoMatches = await db.$queryRaw<[{ count: bigint }]>`
    SELECT COUNT(DISTINCT p.part_no) AS count
    FROM parts p
    WHERE p.part_no IS NOT NULL AND CAST(p.part_no AS TEXT) IN (${Prisma.join(tokenArray.slice(0, 10000))})
  `
  console.log(`  tokens_matching_parts_part_no: ${Number(partNoMatches[0]?.count ?? 0)}`)

  // Dinamik SKU matches against ParcaTedarik ref_no tokens
  const dinSkus = await db.supplier_products.findMany({
    where: { provider_id: dinamikProviderId, normalized_sku: { not: null } },
    select: { id: true, normalized_sku: true, supplier_brand: true },
    take: 50000
  })

  const dinNormSkus = new Set<string>()
  for (const s of dinSkus) {
    if (s.normalized_sku) dinNormSkus.add(s.normalized_sku.toUpperCase())
  }

  let skuRefMatches = 0
  for (const n of tokenSet) {
    if (dinNormSkus.has(n)) skuRefMatches++
  }
  console.log(`  dinamik_sku_matching_parca_ref_tokens: ${skuRefMatches}`)

  // Dinamik brand + SKU matches
  const dinBrands = await db.supplier_products.findMany({
    where: { provider_id: dinamikProviderId },
    select: { id: true, supplier_brand: true, normalized_sku: true },
    take: 50000
  })

  const parcaManufacturers = await db.$queryRaw<
    { id: number; name: string }[]
  >`SELECT id, name FROM v0.ptdrk_brands`
  const mfrNameMap = new Map<string, number>()
  for (const m of parcaManufacturers) {
    mfrNameMap.set(normalizeCode(m.name), m.id)
  }

  let brandSkuMatches = 0
  const brandAliasMap = await db.supplier_brand_aliases.findMany({
    where: { provider_id: dinamikProviderId, mapping_status: 'APPROVED' },
    select: { supplier_brand: true, part_brand_id: true }
  })

  for (const d of dinBrands) {
    if (!d.normalized_sku || !d.supplier_brand) continue
    const normSku = d.normalized_sku.toUpperCase()
    const normBrand = normalizeCode(d.supplier_brand)
    // Check if brand matches directly
    if (tokenSet.has(normSku)) {
      for (const [mfrName] of mfrNameMap) {
        if (mfrName === normBrand) {
          brandSkuMatches++
          break
        }
      }
    }
  }
  console.log(`  dinamik_brand_sku_matching_parca: ${brandSkuMatches}`)

  // Write audit doc
  const auditDoc = `# Dinamik-ParcaTedarik Audit Report

Generated: ${new Date().toISOString()}

## Dinamik Provider

| Field | Value |
|---|---|
| ID | ${dinamikProviderId} |
| Code | ${providers[0].code} |
| Name | ${providers[0].name} |
| Status | ${providers[0].status} |

## Dinamik Supplier Products

| Metric | Count |
|---|---|
| Total Dinamik products | ${totalDinamik} |
| With supplier_price | ${withPrice} |
| With supplier_stock_qty > 0 | ${withStock} |
| With supplier_product_oems | ${dinamikOems} |
| With supplier_part_mappings | ${dinamikMappings} |
| With part_supplier_offers | ${dinamikOffers} |

### Mapping Status Breakdown

${mappingStatuses.map(m => `- ${m.status}: ${Number(m.count)}`).join('\n')}

## ParcaTedarik Data

| Metric | Count |
|---|---|
| Total v0.ptdrk_products rows | ${Number(totalParcaProducts[0].count)} |
| Rows with ref_no | ${Number(withRefNo[0].count)} |
| Total ref_no tokens | ${totalTokens} |
| Distinct normalized ref_no tokens | ${distinctTokens} |
| Manufacturers | ${Number(totalManufacturers[0].count)} |

## Bridge Potential

| Match Type | Count |
|---|---|
| ref_no tokens matching part_oens.code | ${Number(oenMatches[0]?.count ?? 0)} |
| ref_no tokens matching part_eans.code | ${Number(eanMatches[0]?.count ?? 0)} |
| ref_no tokens matching part_cross_references.article_number | ${Number(crMatches[0]?.count ?? 0)} |
| ref_no tokens matching parts.part_no | ${Number(partNoMatches[0]?.count ?? 0)} |
| Dinamik normalized_sku matching ParcaTedarik ref_no tokens | ${skuRefMatches} |
| Dinamik brand+SKU matching ParcaTedarik manufacturer+ref_no | ${brandSkuMatches} |
`

  const auditPath = join(process.cwd(), 'docs', 'DINAMIK_PARCA_TEDARIK_AUDIT.md')
  writeFileSync(auditPath, auditDoc, 'utf-8')
  console.log(`\n[audit] Written to ${auditPath}`)

  await db.$disconnect()
}

main().catch(err => {
  console.error('[audit] Fatal error:', err)
  process.exit(1)
})