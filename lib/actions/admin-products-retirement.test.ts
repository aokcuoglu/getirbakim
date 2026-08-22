import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.cwd()
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')

const actions = read('lib/actions/admin-products.ts')
const types = read('lib/types/admin-products.ts')
const bulkActions = read(
  'app/[locale]/admin/products/_components/ProductsBulkActions.tsx'
)

function functionBody(name: string, nextName: string) {
  return actions.slice(
    actions.indexOf(`export async function ${name}`),
    actions.indexOf(`export async function ${nextName}`)
  )
}

describe('legacy admin product capability retirement', () => {
  it('removes visibility and inventory controls from UI and public action types', () => {
    expect(bulkActions).not.toContain('isVisible')
    expect(bulkActions).not.toContain('lockVisibility')
    expect(bulkActions).not.toContain('min_stock_level')
    expect(types).not.toContain('isVisible')
    expect(types).not.toContain('lockVisibility')
    expect(types).not.toContain('minStockLevel')
    expect(types).not.toContain('reservedStockQty')
  })

  it('update import accepts only truthful price override controls', () => {
    const source = functionBody('importAdminProductsCsv', 'getAdminDashboardData')
    expect(source).toContain('selling_price_override')
    expect(source).toContain('lock_price')
    expect(source).not.toContain('is_visible')
    expect(source).not.toContain('lock_visibility')
    expect(source).not.toContain('min_stock_level')
    expect(source).not.toContain('reserved_stock_qty')
  })

  it('new-product import does not accept retired fields', () => {
    const source = functionBody(
      'importAdminNewProductsCsv',
      'importAdminProductsCsv'
    )
    for (const field of [
      'is_visible',
      'lock_visibility',
      'min_stock_level',
      'reserved_stock_qty',
      'sync_status'
    ]) {
      expect(source).not.toContain(field)
    }
    expect(source).toContain('supplier_stock_qty')
    expect(source).toContain('lock_price')
    expect(source).toContain('note')
  })

  it('keeps both routes and canonical catalog flows', () => {
    const newPage = read('app/[locale]/admin/products/new/page.tsx')
    const toolsPage = read('app/[locale]/admin/products/tools/page.tsx')
    const canonicalAction = read('lib/actions/admin-catalog.ts')

    expect(newPage).toContain('ProductForm')
    expect(toolsPage).toContain('ProductsBulkActions')
    expect(canonicalAction).toContain('product_offers')
    expect(canonicalAction).toContain('last_synced_at')
    expect(canonicalAction).toContain('product_overrides')
    expect(canonicalAction).toContain('price_override')
    expect(canonicalAction).toContain('lock_price')
    expect(canonicalAction).toContain('note')
  })

  it('uses canonical product ids end-to-end for override mutations', () => {
    const bulk = functionBody('bulkUpdateAdminProducts', 'exportAdminProductsCsv')
    const updateImport = functionBody('importAdminProductsCsv', 'getAdminDashboardData')

    expect(actions).toContain('FROM catalog.products p')
    expect(actions).toContain('where: { id: productId }')
    expect(actions).not.toContain('where: { primary_part_id: partId }')
    expect(bulk).toContain('db.products.count')
    expect(bulk).toContain('existingCount !== productIds.length')
    expect(updateImport).toContain('db.products.findUnique')
    expect(updateImport).toContain('product_id: canonicalProductId')
    expect(updateImport).not.toContain('db.parts.findUnique')
  })

  it('rejects negative selling-price overrides at the server boundary', () => {
    expect(actions).toContain('function isInvalidSellingPrice')
    expect(actions).toContain("message: 'Satış fiyatı negatif olamaz.'")
  })
})
