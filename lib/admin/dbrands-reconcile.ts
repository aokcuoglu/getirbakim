import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import type { DbrandsAudit, DbrandsReconcileResult } from '@/lib/types/dbrands'

export type { DbrandsAudit, DbrandsReconcileResult } from '@/lib/types/dbrands'

const BATCH_SIZE = 500

export async function auditDbrands(): Promise<DbrandsAudit> {
  const [row] = await db.$queryRaw<
    Array<{
      dbrands_total: number
      manufacturer_total: number
      dproducts_brand_total: number
      dbrands_matching_manufacturer: number
      manufacturer_only_in_dbrands: number
      dproducts_missing_in_dbrands: number
    }>
  >(Prisma.sql`
    SELECT
      (SELECT COUNT(*)::int FROM parcatedarik.dbrands) AS dbrands_total,
      (SELECT COUNT(*)::int FROM parcatedarik.manufacturer) AS manufacturer_total,
      (
        SELECT COUNT(*)::int FROM (
          SELECT DISTINCT BTRIM(brand) AS brand
          FROM parcatedarik.dproducts
          WHERE brand IS NOT NULL AND BTRIM(brand) <> ''
        ) x
      ) AS dproducts_brand_total,
      (
        SELECT COUNT(*)::int FROM (
          SELECT d.brand
          FROM parcatedarik.dbrands d
          INNER JOIN parcatedarik.manufacturer m
            ON LOWER(BTRIM(m.name)) = LOWER(BTRIM(d.brand))
        ) x
      ) AS dbrands_matching_manufacturer,
      (
        SELECT COUNT(*)::int FROM (
          SELECT d.brand
          FROM parcatedarik.dbrands d
          INNER JOIN parcatedarik.manufacturer m
            ON LOWER(BTRIM(m.name)) = LOWER(BTRIM(d.brand))
          WHERE NOT EXISTS (
            SELECT 1
            FROM parcatedarik.dproducts p
            WHERE LOWER(BTRIM(p.brand)) = LOWER(BTRIM(d.brand))
          )
        ) x
      ) AS manufacturer_only_in_dbrands,
      (
        SELECT COUNT(*)::int FROM (
          SELECT DISTINCT BTRIM(brand) AS brand
          FROM parcatedarik.dproducts
          WHERE brand IS NOT NULL AND BTRIM(brand) <> ''
          EXCEPT
          SELECT BTRIM(brand) FROM parcatedarik.dbrands
        ) x
      ) AS dproducts_missing_in_dbrands
  `)

  const samples = await db.$queryRaw<Array<{ brand: string }>>(Prisma.sql`
    SELECT d.brand
    FROM parcatedarik.dbrands d
    INNER JOIN parcatedarik.manufacturer m
      ON LOWER(BTRIM(m.name)) = LOWER(BTRIM(d.brand))
    WHERE NOT EXISTS (
      SELECT 1
      FROM parcatedarik.dproducts p
      WHERE LOWER(BTRIM(p.brand)) = LOWER(BTRIM(d.brand))
    )
    ORDER BY d.brand ASC
    LIMIT 20
  `)

  return {
    dbrandsTotal: row?.dbrands_total ?? 0,
    manufacturerTotal: row?.manufacturer_total ?? 0,
    dproductsBrandTotal: row?.dproducts_brand_total ?? 0,
    dbrandsMatchingManufacturer: row?.dbrands_matching_manufacturer ?? 0,
    manufacturerOnlyInDbrands: row?.manufacturer_only_in_dbrands ?? 0,
    dproductsMissingInDbrands: row?.dproducts_missing_in_dbrands ?? 0,
    sampleManufacturerOnly: samples.map((s) => s.brand)
  }
}

/** Ensure parent rows exist before dbrands_match inserts (FK). */
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
      INSERT INTO parcatedarik.dbrands (brand)
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
 * Drops dbrands rows that duplicate parcatedarik.manufacturer names with no dproducts yet.
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
      FROM parcatedarik.dbrands d
      INNER JOIN parcatedarik.manufacturer m
        ON LOWER(BTRIM(m.name)) = LOWER(BTRIM(d.brand))
      WHERE NOT EXISTS (
        SELECT 1
        FROM parcatedarik.dproducts p
        WHERE LOWER(BTRIM(p.brand)) = LOWER(BTRIM(d.brand))
      )
      ${apiExclusion}
    `)
    return row?.count ?? 0
  }

  const deleted = await db.$executeRaw(Prisma.sql`
    DELETE FROM parcatedarik.dbrands d
    USING parcatedarik.manufacturer m
    WHERE LOWER(BTRIM(m.name)) = LOWER(BTRIM(d.brand))
      AND NOT EXISTS (
        SELECT 1
        FROM parcatedarik.dproducts p
        WHERE LOWER(BTRIM(p.brand)) = LOWER(BTRIM(d.brand))
      )
      ${apiExclusion}
  `)
  return Number(deleted)
}

async function upsertDbrandsFromDproducts(dryRun: boolean): Promise<number> {
  if (dryRun) {
    const audit = await auditDbrands()
    return audit.dproductsMissingInDbrands
  }

  const inserted = await db.$executeRaw(Prisma.sql`
    INSERT INTO parcatedarik.dbrands (brand)
    SELECT DISTINCT BTRIM(brand)
    FROM parcatedarik.dproducts
    WHERE brand IS NOT NULL AND BTRIM(brand) <> ''
    ON CONFLICT (brand) DO NOTHING
  `)
  return Number(inserted)
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

    const existing = await db.dbrands.findMany({ select: { brand: true } })
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
  // and still have no dproducts (manual/stale rows). API brands stay for dproducts sync.
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
    dbrandsTotalAfter: dryRun
      ? auditBefore.dbrandsTotal -
        removedManufacturerOnly +
        insertedFromDproducts +
        insertedFromApi
      : auditAfter.dbrandsTotal,
    audit: dryRun ? auditBefore : auditAfter
  }
}
