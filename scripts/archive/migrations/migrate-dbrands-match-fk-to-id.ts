/**
 * Migrate dbrands_match.dbrands_id from brand text → dbrands.id (bigint).
 *
 *   bun scripts/migrate-dbrands-match-fk-to-id.ts
 */

import 'dotenv/config'
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { db } from '../lib/db'

const scriptDir = dirname(fileURLToPath(import.meta.url))

async function main() {
  const sql = readFileSync(
    join(
      scriptDir,
      '../prisma/migrations/20260525140000_dbrands_match_fk_to_dbrands_id/migration.sql'
    ),
    'utf8'
  )

  const statements = sql
    .split(';')
    .map((s) => s.trim())
    .filter((line) => line.length > 0 && !line.startsWith('--'))

  for (const statement of statements) {
    console.log('[migrate] Running:', statement.slice(0, 80).replace(/\s+/g, ' '), '...')
    await db.$executeRawUnsafe(statement)
  }

  const [sample] = await db.$queryRaw<
    Array<{ match_id: number; dbrands_id: bigint | null; brand: string | null }>
  >`
    SELECT m.id AS match_id, m.dbrands_id, d.brand
    FROM v0.dbrands_match m
    LEFT JOIN v0.dbrands d ON d.id = m.dbrands_id
    WHERE m.dbrands_id IS NOT NULL
    LIMIT 5
  `
  console.log('[migrate] Sample rows:', sample)
  console.log('[migrate] Done.')
}

main().catch((error) => {
  console.error('[migrate] Failed:', error)
  process.exit(1)
})
