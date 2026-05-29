import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

describe('dpbrd repair migration', () => {
  const sql = readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      '../../../prisma/migrations/20260525210000_dpbrd_repair/migration.sql'
    ),
    'utf8'
  )

  it('renames legacy dinamik_brand when needed', () => {
    expect(sql.includes("RENAME COLUMN dinamik_brand TO dnmk_brands_id")).toBe(true)
  })

  it('converts text dnmk_brands_id via temporary dnbrd_fk', () => {
    expect(sql.includes('dnbrd_fk')).toBe(true)
    expect(sql.includes('RENAME COLUMN dnbrd_fk TO dnmk_brands_id')).toBe(true)
  })

  it('ensures FK to dnbrd.id and drops normalized_name', () => {
    expect(sql.includes('fk_dpbrd_brand')).toBe(true)
    expect(sql.includes('REFERENCES parcatedarik.dnbrd (id)')).toBe(true)
    expect(sql.includes('DROP COLUMN IF EXISTS normalized_name')).toBe(true)
  })
})
