/**
 * Apply idempotent v0 column renames (manufacturer_id → ptbrands_id, etc.).
 * Run after deploy if admin suppliers / eşleştirme queries fail with missing ptbrands_id.
 *
 *   bun scripts/apply-v0-column-renames.ts
 */
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { db } from '@/lib/db'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const migrationPath = join(
  scriptDir,
  '../prisma/migrations/20260525230000_v0_column_renames/migration.sql'
)

async function main() {
  const sql = readFileSync(migrationPath, 'utf8')
  await db.$executeRawUnsafe(sql)
  console.log('[apply-v0-column-renames] Applied:', migrationPath)
}

main()
  .catch((err) => {
    console.error('[apply-v0-column-renames] Failed:', err)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
