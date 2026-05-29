import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

describe('dnbrd-match cleanup', () => {
  const source = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../dnbrd-match-cleanup.ts'),
    'utf8'
  )

  it('removes dinamik stubs when a paired row exists', () => {
    expect(source.includes('a.ptdrk_brands_id IS NULL')).toBe(true)
    expect(source.includes('b.ptdrk_brands_id IS NOT NULL')).toBe(true)
  })

  it('removes PT-only rows when a paired row exists', () => {
    expect(source.includes('a.dnmk_brands_id IS NULL')).toBe(true)
    expect(source.includes('b.dnmk_brands_id IS NOT NULL')).toBe(true)
    expect(source.includes('b.ptdrk_brands_id = a.ptdrk_brands_id')).toBe(true)
  })
})
