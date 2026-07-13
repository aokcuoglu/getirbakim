import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'

/** Dinamik-only stub rows superseded by a paired row for the same dinamik_brand_id. */
export async function countRedundantDinamikStubs(): Promise<number> {
  const [row] = await db.$queryRaw<Array<{ count: number }>>(Prisma.sql`
    SELECT COUNT(*)::int AS count
    FROM catalog.brand_mappings a
    WHERE a.ptdrk_brand_id IS NULL
      AND a.dinamik_brand_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM catalog.brand_mappings b
        WHERE b.dinamik_brand_id = a.dinamik_brand_id
          AND b.ptdrk_brand_id IS NOT NULL
          AND b.id <> a.id
      )
  `)
  return row?.count ?? 0
}

/** PT-only rows superseded by a paired row for the same ptdrk_brand_id. */
export async function countRedundantPtOnlyRows(): Promise<number> {
  const [row] = await db.$queryRaw<Array<{ count: number }>>(Prisma.sql`
    SELECT COUNT(*)::int AS count
    FROM catalog.brand_mappings a
    WHERE a.dinamik_brand_id IS NULL
      AND a.ptdrk_brand_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM catalog.brand_mappings b
        WHERE b.ptdrk_brand_id = a.ptdrk_brand_id
          AND b.dinamik_brand_id IS NOT NULL
          AND b.id <> a.id
      )
  `)
  return row?.count ?? 0
}

export async function removeRedundantDinamikStubs(): Promise<number> {
  return Number(
    await db.$executeRaw(Prisma.sql`
      DELETE FROM catalog.brand_mappings a
      WHERE a.ptdrk_brand_id IS NULL
        AND a.dinamik_brand_id IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM catalog.brand_mappings b
          WHERE b.dinamik_brand_id = a.dinamik_brand_id
            AND b.ptdrk_brand_id IS NOT NULL
            AND b.id <> a.id
        )
    `)
  )
}

export async function removeRedundantPtOnlyRows(): Promise<number> {
  return Number(
    await db.$executeRaw(Prisma.sql`
      DELETE FROM catalog.brand_mappings a
      WHERE a.dinamik_brand_id IS NULL
        AND a.ptdrk_brand_id IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM catalog.brand_mappings b
          WHERE b.ptdrk_brand_id = a.ptdrk_brand_id
            AND b.dinamik_brand_id IS NOT NULL
            AND b.id <> a.id
        )
    `)
  )
}

/** Remove dinamik stubs and PT-only rows superseded by an existing paired match. */
export async function removeRedundantDbrandsMatchRows(): Promise<{
  removedDinamikStubs: number
  removedPtOnlyRows: number
}> {
  const removedDinamikStubs = await removeRedundantDinamikStubs()
  const removedPtOnlyRows = await removeRedundantPtOnlyRows()
  return { removedDinamikStubs, removedPtOnlyRows }
}
