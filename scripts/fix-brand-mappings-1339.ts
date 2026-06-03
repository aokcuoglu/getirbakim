import { db } from '../lib/db'
import { Prisma } from '@prisma/client'

function stringifyReplacer(_key: string, value: any) {
  return typeof value === 'bigint' ? value.toString() : value
}

async function main() {
  const mappings = [
    { mappingId: 178, dnmkBrandId: 2658n, normalizedBrand: 'BREVETTE' },
    { mappingId: 185, dnmkBrandId: 2789n, normalizedBrand: 'FOMOCO' },
    { mappingId: 186, dnmkBrandId: 2827n, normalizedBrand: 'GSF' },
    { mappingId: 187, dnmkBrandId: 2885n, normalizedBrand: 'KITRONIC-E-SATIS' },
    { mappingId: 188, dnmkBrandId: 2868n, normalizedBrand: 'KALE DISK' },
    { mappingId: 189, dnmkBrandId: 2874n, normalizedBrand: 'KARSAN' },
    { mappingId: 190, dnmkBrandId: 3064n, normalizedBrand: 'MOTOCRAFT' },
    { mappingId: 191, dnmkBrandId: 15520n, normalizedBrand: 'MICHELIN' },
  ]

  console.log('=== BEFORE: brand_mappings with brand_list_id=1339 ===')
  const before = await db.$queryRaw`
    SELECT bm.id, bm.brand_list_id, bm.dnmk_brands_id, bm.mapping_status, bm.match_method
    FROM v0.brand_mappings bm 
    WHERE bm.brand_list_id = 1339
    ORDER BY bm.id
  `
  console.log(JSON.stringify(before, stringifyReplacer, 2))

  console.log('\nbrand_list id=1339:')
  const oldBrandList = await db.$queryRaw`SELECT * FROM v0.brand_list WHERE id = 1339`
  console.log(JSON.stringify(oldBrandList, stringifyReplacer, 2))

  for (const m of mappings) {
    console.log(`\n--- Processing mapping ${m.mappingId}: ${m.normalizedBrand} ---`)

    const insertResult = await db.$queryRaw<Array<{ id: bigint; brand: string }>>`
      INSERT INTO v0.brand_list (brand)
      VALUES (UPPER(BTRIM(${m.normalizedBrand})))
      ON CONFLICT (brand) DO NOTHING
      RETURNING id, brand
    `

    let newBrandListId: number

    if (insertResult.length > 0) {
      newBrandListId = Number(insertResult[0].id)
      console.log(`  Created new brand_list: id=${newBrandListId}, brand=${insertResult[0].brand}`)
    } else {
      const existing = await db.$queryRaw<Array<{ id: bigint; brand: string }>>`
        SELECT id, brand FROM v0.brand_list WHERE brand = UPPER(BTRIM(${m.normalizedBrand}))
      `
      newBrandListId = Number(existing[0].id)
      console.log(`  brand_list already exists: id=${newBrandListId}, brand=${existing[0].brand}`)
    }

    await db.$executeRaw`
      UPDATE v0.brand_mappings
      SET brand_list_id = ${newBrandListId}
      WHERE id = ${m.mappingId}
    `
    console.log(`  Updated mapping ${m.mappingId} -> brand_list id=${newBrandListId}`)
  }

  console.log('\n=== AFTER: updated brand_mappings ===')
  const mappingIds = mappings.map(m => m.mappingId)
  const after = await db.$queryRaw`
    SELECT bm.id, bm.brand_list_id, bm.dnmk_brands_id, bm.mapping_status, bm.match_method
    FROM v0.brand_mappings bm 
    WHERE bm.id IN (${Prisma.join(mappingIds)})
    ORDER BY bm.id
  `
  console.log(JSON.stringify(after, stringifyReplacer, 2))

  console.log('\n=== Remaining mappings on brand_list id=1339 ===')
  const remaining = await db.$queryRaw`
    SELECT bm.id, bm.brand_list_id, bm.dnmk_brands_id
    FROM v0.brand_mappings bm 
    WHERE bm.brand_list_id = 1339
  `
  console.log(JSON.stringify(remaining, stringifyReplacer, 2))

  if ((remaining as any[]).length === 0) {
    console.log('\nNo remaining mappings. brand_list id=1339 is now orphaned (brand=NULL). You can delete it from admin panel or I can delete it now.')
  }
}

main()
  .catch(console.error)
  .finally(() => db.$disconnect())