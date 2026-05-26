import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

describe('dbrands-match cleanup', () => {
  const source = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../dbrands-match-cleanup.ts'),
    'utf8'
  )

  it('removes dinamik stubs when a paired row exists', () => {
    expect(source.includes('a.ptbrands_id IS NULL')).toBe(true)
    expect(source.includes('b.ptbrands_id IS NOT NULL')).toBe(true)
  })

  it('removes PT-only rows when a paired row exists', () => {
    expect(source.includes('a.dbrands_id IS NULL')).toBe(true)
    expect(source.includes('b.dbrands_id IS NOT NULL')).toBe(true)
    expect(source.includes('b.ptbrands_id = a.ptbrands_id')).toBe(true)
  })
})
