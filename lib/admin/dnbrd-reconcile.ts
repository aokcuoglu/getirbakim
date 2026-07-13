import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import type { DbrandsAudit, DbrandsReconcileResult } from '@/lib/types/dnbrd'

export type { DbrandsAudit, DbrandsReconcileResult } from '@/lib/types/dnbrd'

const BATCH_SIZE = 500

export async function auditDbrands(): Promise<DbrandsAudit> {
  const [row] = await db.$queryRaw<
    Array<{
      dnbrd_total: number
      manufacturer_total: number
      dnprd_brand_total: number
      dpbrding_manufacturer: number
      manufacturer_only_in_dnbrd: number
      dnprd_missing_in_dnbrd: number
    }>
  >(Prisma.sql`
    SELECT
      (SELECT COUNT(*)::int FROM catalog.supplier_dinamik_brands) AS dnbrd_total,
      (SELECT COUNT(*)::int FROM v0.ptdrk_brands) AS manufacturer_total,
      (
        SELECT COUNT(DISTINCT brand_id)::int
        FROM catalog.supplier_dinamik_products
      ) AS dnprd_brand_total,
      (
        SELECT COUNT(*)::int FROM (
          SELECT d.brand
          FROM catalog.supplier_dinamik_brands d
          INNER JOIN v0.ptdrk_brands m
            ON LOWER(BTRIM(m.name)) = LOWER(BTRIM(d.brand))
        ) x
      ) AS dpbrding_manufacturer,
      (
        SELECT COUNT(*)::int FROM (
          SELECT d.brand
          FROM catalog.supplier_dinamik_brands d
          INNER JOIN v0.ptdrk_brands m
            ON LOWER(BTRIM(m.name)) = LOWER(BTRIM(d.brand))
          WHERE NOT EXISTS (
            SELECT 1
            FROM catalog.supplier_dinamik_products p
            WHERE p.brand_id = d.id
          )
        ) x
      ) AS manufacturer_only_in_dnbrd,
      (
        SELECT COUNT(*)::int
        FROM catalog.supplier_dinamik_products p
        LEFT JOIN catalog.supplier_dinamik_brands b ON b.id = p.brand_id
        WHERE b.id IS NULL
      ) AS dnprd_missing_in_dnbrd
  `)

  const samples = await db.$queryRaw<Array<{ brand: string }>>(Prisma.sql`
    SELECT d.brand
    FROM catalog.supplier_dinamik_brands d
    INNER JOIN v0.ptdrk_brands m
      ON LOWER(BTRIM(m.name)) = LOWER(BTRIM(d.brand))
    WHERE NOT EXISTS (
      SELECT 1
      FROM catalog.supplier_dinamik_products p
      WHERE p.brand_id = d.id
    )
    ORDER BY d.brand ASC
    LIMIT 20
  `)

  return {
    dnbrdTotal: row?.dnbrd_total ?? 0,
    manufacturerTotal: row?.manufacturer_total ?? 0,
    dnprdBrandTotal: row?.dnprd_brand_total ?? 0,
    dnbrdMatchingManufacturer: row?.dpbrding_manufacturer ?? 0,
    manufacturerOnlyInDbrands: row?.manufacturer_only_in_dnbrd ?? 0,
    dnprdMissingInDbrands: row?.dnprd_missing_in_dnbrd ?? 0,
    sampleManufacturerOnly: samples.map((s) => s.brand)
  }
}

/** Ensure parent rows exist before dpbrd inserts (FK). */
export async function ensureDbrandsRows(brands: string[]): Promise<number> {
  const unique = Array.from(
    new Set(
      brands
        .map((b) => b.trim())
        .filter((b) => b.length > 0)
    )
  )
  if (unique.length === 0) return 0

  let inserted = 0
  for (let i = 0; i < unique.length; i += BATCH_SIZE) {
    const batch = unique.slice(i, i + BATCH_SIZE)
    const values = batch.map((brand) => Prisma.sql`(${brand})`)
    const count = await db.$executeRaw(Prisma.sql`
      INSERT INTO catalog.supplier_dinamik_brands (brand)
      VALUES ${Prisma.join(values)}
      ON CONFLICT (brand) DO NOTHING
    `)
    inserted += Number(count)
  }

  return inserted
}

function normalizeBrandKeys(brands: string[]): string[] {
  return Array.from(
    new Set(
      brands
        .map((b) => b.trim().toLowerCase())
        .filter((b) => b.length > 0)
    )
  )
}

/**
 * Drops dnbrd rows that duplicate v0.ptdrk_brands names with no dnprd yet.
 * Dinamik getBrandList names are kept so pipeline step 2 can fetch their catalog.
 */
async function removeManufacturerOnlyDbrands(
  dryRun: boolean,
  protectedApiBrands: string[] = []
): Promise<number> {
  const protectedKeys = normalizeBrandKeys(protectedApiBrands)
  const apiExclusion =
    protectedKeys.length > 0
      ? Prisma.sql`AND LOWER(BTRIM(d.brand)) NOT IN (${Prisma.join(
          protectedKeys.map((key) => Prisma.sql`${key}`)
        )})`
      : Prisma.empty

  if (dryRun) {
    const [row] = await db.$queryRaw<Array<{ count: number }>>(Prisma.sql`
      SELECT COUNT(*)::int AS count
      FROM catalog.supplier_dinamik_brands d
      INNER JOIN v0.ptdrk_brands m
        ON LOWER(BTRIM(m.name)) = LOWER(BTRIM(d.brand))
      WHERE NOT EXISTS (
        SELECT 1
        FROM catalog.supplier_dinamik_products p
        WHERE p.brand_id = d.id
      )
      ${apiExclusion}
    `)
    return row?.count ?? 0
  }

  const deleted = await db.$executeRaw(Prisma.sql`
    DELETE FROM catalog.supplier_dinamik_brands d
    USING v0.ptdrk_brands m
    WHERE LOWER(BTRIM(m.name)) = LOWER(BTRIM(d.brand))
      AND NOT EXISTS (
        SELECT 1
        FROM catalog.supplier_dinamik_products p
        WHERE p.brand_id = d.id
      )
      ${apiExclusion}
  `)
  return Number(deleted)
}

async function upsertDbrandsFromDproducts(dryRun: boolean): Promise<number> {
  if (dryRun) {
    const audit = await auditDbrands()
    return audit.dnprdMissingInDbrands
  }

  // dnprd.dinamik_brand_id FK ensures parent rows exist; nothing to backfill from product strings.
  return 0
}

export async function syncDbrandsFromApi(
  dryRun: boolean
): Promise<{ inserted: number; apiBrandCount: number; brandNames: string[] }> {
  const { getBrandList } = await import('@/lib/suppliers/dinamik-client')
  const apiBrands = await getBrandList()
  const names = apiBrands
    .map((b) => (typeof b.brand === 'string' ? b.brand.trim() : ''))
    .filter((name) => name.length > 0)

  if (dryRun) {
    if (names.length === 0) {
      return { inserted: 0, apiBrandCount: 0, brandNames: [] }
    }

    const existing = await db.supplier_dinamik_brands.findMany({ select: { brand: true } })
    const existingKeys = new Set(
      existing.map((row) => row.brand.trim().toLowerCase())
    )
    const missing = names.filter(
      (name) => !existingKeys.has(name.trim().toLowerCase())
    )
    return {
      inserted: missing.length,
      apiBrandCount: names.length,
      brandNames: names
    }
  }

  const inserted = await ensureDbrandsRows(names)
  return { inserted, apiBrandCount: names.length, brandNames: names }
}

export async function reconcileDbrands(options?: {
  dryRun?: boolean
  syncFromApi?: boolean
}): Promise<DbrandsReconcileResult> {
  const dryRun = options?.dryRun !== false
  const syncFromApi = options?.syncFromApi !== false

  const auditBefore = await auditDbrands()

  const insertedFromDproducts = await upsertDbrandsFromDproducts(dryRun)

  let insertedFromApi = 0
  let apiBrandCount = 0
  let apiBrandNames: string[] = []
  if (syncFromApi) {
    const api = await syncDbrandsFromApi(dryRun)
    insertedFromApi = api.inserted
    apiBrandCount = api.apiBrandCount
    apiBrandNames = api.brandNames
  }

  // After API upsert: remove manufacturer-name duplicates that are not in getBrandList
  // and still have no dnprd (manual/stale rows). API brands stay for dnprd sync.
  const removedManufacturerOnly = await removeManufacturerOnlyDbrands(
    dryRun,
    apiBrandNames
  )

  const auditAfter = dryRun ? auditBefore : await auditDbrands()

  return {
    dryRun,
    removedManufacturerOnly,
    insertedFromDproducts,
    insertedFromApi,
    dnbrdTotalAfter: dryRun
      ? auditBefore.dnbrdTotal -
        removedManufacturerOnly +
        insertedFromDproducts +
        insertedFromApi
      : auditAfter.dnbrdTotal,
    audit: dryRun ? auditBefore : auditAfter
  }
}
