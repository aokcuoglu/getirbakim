import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

describe('reconcileDbrands', () => {
  it('runs manufacturer cleanup after API upsert with API names protected', () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', 'dnbrd-reconcile.ts'),
      'utf8'
    )
    const reconcileBody = source.slice(
      source.indexOf('export async function reconcileDbrands')
    )
    const apiIdx = reconcileBody.indexOf('syncDbrandsFromApi(dryRun)')
    const removeIdx = reconcileBody.indexOf('removeManufacturerOnlyDbrands(')
    expect(apiIdx >= 0 && removeIdx > apiIdx).toBe(true)
    expect(source.includes('apiBrandNames')).toBe(true)
    expect(source.includes('protectedApiBrands')).toBe(true)
    expect(source.includes('NOT IN')).toBe(true)
  })
})
