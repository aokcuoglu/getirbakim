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
      (SELECT COUNT(*)::int FROM v0.dbrands) AS dbrands_total,
      (SELECT COUNT(*)::int FROM v0.ptbrands) AS manufacturer_total,
      (
        SELECT COUNT(DISTINCT dbrands_id)::int
        FROM v0.dproducts
      ) AS dproducts_brand_total,
      (
        SELECT COUNT(*)::int FROM (
          SELECT d.brand
          FROM v0.dbrands d
          INNER JOIN v0.ptbrands m
            ON LOWER(BTRIM(m.name)) = LOWER(BTRIM(d.brand))
        ) x
      ) AS dbrands_matching_manufacturer,
      (
        SELECT COUNT(*)::int FROM (
          SELECT d.brand
          FROM v0.dbrands d
          INNER JOIN v0.ptbrands m
            ON LOWER(BTRIM(m.name)) = LOWER(BTRIM(d.brand))
          WHERE NOT EXISTS (
            SELECT 1
            FROM v0.dproducts p
            WHERE p.dbrands_id = d.id
          )
        ) x
      ) AS manufacturer_only_in_dbrands,
      (
        SELECT COUNT(*)::int
        FROM v0.dproducts p
        LEFT JOIN v0.dbrands b ON b.id = p.dbrands_id
        WHERE b.id IS NULL
      ) AS dproducts_missing_in_dbrands
  `)

  const samples = await db.$queryRaw<Array<{ brand: string }>>(Prisma.sql`
    SELECT d.brand
    FROM v0.dbrands d
    INNER JOIN v0.ptbrands m
      ON LOWER(BTRIM(m.name)) = LOWER(BTRIM(d.brand))
    WHERE NOT EXISTS (
      SELECT 1
      FROM v0.dproducts p
      WHERE p.dbrands_id = d.id
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
      INSERT INTO v0.dbrands (brand)
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
 * Drops dbrands rows that duplicate v0.ptbrands names with no dproducts yet.
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
      FROM v0.dbrands d
      INNER JOIN v0.ptbrands m
        ON LOWER(BTRIM(m.name)) = LOWER(BTRIM(d.brand))
      WHERE NOT EXISTS (
        SELECT 1
        FROM v0.dproducts p
        WHERE p.dbrands_id = d.id
      )
      ${apiExclusion}
    `)
    return row?.count ?? 0
  }

  const deleted = await db.$executeRaw(Prisma.sql`
    DELETE FROM v0.dbrands d
    USING v0.ptbrands m
    WHERE LOWER(BTRIM(m.name)) = LOWER(BTRIM(d.brand))
      AND NOT EXISTS (
        SELECT 1
        FROM v0.dproducts p
        WHERE p.dbrands_id = d.id
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

  // dproducts.dbrands_id FK ensures parent rows exist; nothing to backfill from product strings.
  return 0
}

export async function syncDbrandsFromApi(
  dryRun: boolean
): Promise<{ inserted: number; apiBrandCount: number; brandNames: string[] }> {
  const { dinamikFetch } = await import('@/lib/dinamik')
  const apiBrandsResponse = await dinamikFetch('/api/Dnmk_Customer/getBrandList')
  const apiBrands: Array<{ brand: string }> = await apiBrandsResponse.json()
  const names = apiBrands
    .map((b: { brand: string }) => (typeof b.brand === 'string' ? b.brand.trim() : ''))
    .filter((name: string) => name.length > 0)

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
