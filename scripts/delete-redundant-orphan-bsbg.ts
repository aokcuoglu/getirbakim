import 'dotenv/config'
import { db } from '../lib/db'

async function main() {
  // Bu 7 satırın bsbg_brands_id değeri hedef satırda zaten mevcut.
  // Sadece silmek yeterli.
  const idsToDelete = [2591, 2597, 2599, 2607, 2608, 2630, 2654]

  console.log(`Deleting ${idsToDelete.length} redundant orphaned rows...`)

  const result = await db.brand_mappings.deleteMany({
    where: { id: { in: idsToDelete } }
  })

  console.log(`Done. Deleted ${result.count} rows.`)
}

main()
  .catch(console.error)
  .finally(() => db.$disconnect())
