import 'dotenv/config'
import { db } from '../lib/db'
import { Prisma } from '@prisma/client'

function stringifyReplacer(_key: string, value: any) {
  return typeof value === 'bigint' ? value.toString() : value
}

async function main() {
  // Sorgu 1: Aynı brand_list_id ile başka satırlarda dnmk/ptdrk var,
  // ama bu satırda dnmk+ptdrk boş ve bsbg dolu
  const rowsWithSiblings = await db.$queryRaw`
    SELECT 
      bm.id,
      bm.brand_list_id,
      bm.dnmk_brands_id,
      bm.ptdrk_brands_id,
      bm.bsbg_brands_id,
      bm.mapping_status,
      bm.match_method
    FROM v0.brand_mappings bm
    WHERE bm.bsbg_brands_id IS NOT NULL
      AND bm.dnmk_brands_id IS NULL
      AND bm.ptdrk_brands_id IS NULL
      AND EXISTS (
        SELECT 1 FROM v0.brand_mappings other
        WHERE other.brand_list_id = bm.brand_list_id
          AND other.id != bm.id
          AND (other.dnmk_brands_id IS NOT NULL OR other.ptdrk_brands_id IS NOT NULL)
      )
    ORDER BY bm.brand_list_id, bm.id
  `

  console.log('=== Sorgu 1: Sadece BSBG dolu, ama aynı markaya ait DNMK/PTDRK eşleşmesi olan satırlar ===')
  console.log(JSON.stringify(rowsWithSiblings, stringifyReplacer, 2))
  console.log(`Toplam: ${(rowsWithSiblings as any[]).length} satır\n`)

  // Sorgu 2: DNMK ve PTDRK'nin ikisi de boş, BSBG dolu olan TÜM satırlar
  const onlyBsbgRows = await db.$queryRaw`
    SELECT 
      bm.id,
      bm.brand_list_id,
      bm.dnmk_brands_id,
      bm.ptdrk_brands_id,
      bm.bsbg_brands_id,
      bm.mapping_status,
      bm.match_method
    FROM v0.brand_mappings bm
    WHERE bm.bsbg_brands_id IS NOT NULL
      AND bm.dnmk_brands_id IS NULL
      AND bm.ptdrk_brands_id IS NULL
    ORDER BY bm.brand_list_id, bm.id
  `

  console.log('=== Sorgu 2: DNMK+PTDRK boş, sadece BSBG dolu olan TÜM satırlar ===')
  console.log(JSON.stringify(onlyBsbgRows, stringifyReplacer, 2))
  console.log(`Toplam: ${(onlyBsbgRows as any[]).length} satır\n`)
}

main()
  .catch(console.error)
  .finally(() => db.$disconnect())
