import { db } from '../lib/db'

function jsonReplacer(key: string, value: any): any {
  if (typeof value === 'bigint') {
    return Number(value)
  }
  return value
}

function logJson(label: string, data: any) {
  console.log(label, JSON.stringify(data, jsonReplacer, 2))
}

async function main() {
  const rows = await db.$queryRaw`
    SELECT 
      mb.id,
      mb.dnmk_brands_id,
      mb.ptdrk_brands_id,
      mb.brand,
      mb.mapping_status,
      mb.match_method,
      db.brand as dnmk_brand_name,
      pb.name as pt_brand_name
    FROM v0.brand_list mb
    LEFT JOIN v0.dnmk_brands db ON db.id = mb.dnmk_brands_id
    LEFT JOIN catalog.ptdrk_brands pb ON pb.id = mb.ptdrk_brands_id
    WHERE mb.brand = 'AKSA'
    ORDER BY mb.id
  `
  logJson('AKSA rows:', rows)

  // Product counts per dnmk_brands_id (corrected to use actual dnmk_brands_ids 15 and 16)
  const dnCounts = await db.$queryRaw`
    SELECT d.dnmk_brands_id, COUNT(*)::int as product_count
    FROM v0.dnmk_products d
    WHERE d.dnmk_brands_id IN (15, 16)
    GROUP BY d.dnmk_brands_id
  `
  logJson('Dinamik products (correct ids):', dnCounts)

  // Product counts per ptdrk_brands_id
  const ptCounts = await db.$queryRaw`
    SELECT p.ptdrk_brands_id, COUNT(*)::int as product_count
    FROM catalog.ptdrk_products p
    WHERE p.ptdrk_brands_id IN (SELECT ptdrk_brands_id FROM v0.brand_list WHERE brand = 'AKSA')
    GROUP BY p.ptdrk_brands_id
  `
  logJson('PT products:', ptCounts)

  // Additional: check what ids exist for dnmk_brands_ids and ptdrk_brands_ids
  const idSummary = await db.$queryRaw`
    SELECT 
      dnmk_brands_id, 
      ptdrk_brands_id
    FROM v0.brand_list
    WHERE brand = 'AKSA'
    ORDER BY dnmk_brands_id, ptdrk_brands_id
  `
  logJson('IDs Summary:', idSummary)

  await db.$disconnect()
}

main().catch(console.error)
