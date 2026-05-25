import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

describe('dbrands_match repair migration', () => {
  const sql = readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      '../../../prisma/migrations/20260525210000_dbrands_match_repair/migration.sql'
    ),
    'utf8'
  )

  it('renames legacy dinamik_brand when needed', () => {
    expect(sql.includes("RENAME COLUMN dinamik_brand TO dbrands_id")).toBe(true)
  })

  it('converts text dbrands_id via temporary dbrands_fk', () => {
    expect(sql.includes('dbrands_fk')).toBe(true)
    expect(sql.includes('RENAME COLUMN dbrands_fk TO dbrands_id')).toBe(true)
  })

  it('ensures FK to dbrands.id and drops normalized_name', () => {
    expect(sql.includes('fk_dbrands_match_brand')).toBe(true)
    expect(sql.includes('REFERENCES parcatedarik.dbrands (id)')).toBe(true)
    expect(sql.includes('DROP COLUMN IF EXISTS normalized_name')).toBe(true)
  })
})
