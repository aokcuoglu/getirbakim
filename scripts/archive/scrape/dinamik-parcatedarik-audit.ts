/**
 * Dinamik-ParcaTedarik Audit Script (v0 schema only)
 *
 * Reports counts for ParcaTedarik data from v0 schema.
 *
 * Usage:
 *   bun scripts/dinamik-parcatedarik-audit.ts
 */

import 'dotenv/config'
import { db } from '../lib/db'

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
  console.log(`[audit] ParcaTedarik (v0) Audit`)
  console.log()

  // ParcaTedarik counts from v0 schema
  const [
    totalParcaProducts,
    withRefNo,
    totalManufacturers,
    sampleRefNos
  ] = await Promise.all([
    db.$queryRaw<[{ count: bigint }]>`SELECT COUNT(*) AS count FROM catalog.ptdrk_products`,
    db.$queryRaw<[{ count: bigint }]>`SELECT COUNT(*) AS count FROM catalog.ptdrk_products WHERE ref_no IS NOT NULL AND ref_no != ''`,
    db.$queryRaw<[{ count: bigint }]>`SELECT COUNT(*) AS count FROM catalog.ptdrk_brands`,
    db.$queryRaw<{ ref_no: string | null }[]>`
      SELECT ref_no FROM catalog.ptdrk_products
      WHERE ref_no IS NOT NULL AND ref_no != ''
      LIMIT 20
    `
  ])

  const allParcaRefNos = await db.$queryRaw<{ ref_no: string }[]>`
    SELECT ref_no FROM catalog.ptdrk_products WHERE ref_no IS NOT NULL AND ref_no != ''
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

  console.log('=== ParcaTedarik Counts (v0) ===')
  console.log(`  total_products: ${Number(totalParcaProducts[0].count)}`)
  console.log(`  with_ref_no: ${Number(withRefNo[0].count)}`)
  console.log(`  total_ref_no_tokens: ${totalTokens}`)
  console.log(`  distinct_normalized_tokens: ${distinctTokens}`)
  console.log(`  manufacturers: ${Number(totalManufacturers[0].count)}`)
  console.log(`  sample_ref_nos: ${sampleRefNos.map(r => r.ref_no).join(' | ')}`)

  await db.$disconnect()
}

main().catch(err => {
  console.error('[audit] Fatal error:', err)
  process.exit(1)
})