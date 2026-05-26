import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'

/** Dinamik-only stub rows superseded by a paired row for the same dbrands_id. */
export async function countRedundantDinamikStubs(): Promise<number> {
  const [row] = await db.$queryRaw<Array<{ count: number }>>(Prisma.sql`
    SELECT COUNT(*)::int AS count
    FROM v0.dbrands_match a
    WHERE a.ptbrands_id IS NULL
      AND a.dbrands_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM v0.dbrands_match b
        WHERE b.dbrands_id = a.dbrands_id
          AND b.ptbrands_id IS NOT NULL
          AND b.id <> a.id
      )
  `)
  return row?.count ?? 0
}

/** PT-only rows superseded by a paired row for the same ptbrands_id. */
export async function countRedundantPtOnlyRows(): Promise<number> {
  const [row] = await db.$queryRaw<Array<{ count: number }>>(Prisma.sql`
    SELECT COUNT(*)::int AS count
    FROM v0.dbrands_match a
    WHERE a.dbrands_id IS NULL
      AND a.ptbrands_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM v0.dbrands_match b
        WHERE b.ptbrands_id = a.ptbrands_id
          AND b.dbrands_id IS NOT NULL
          AND b.id <> a.id
      )
  `)
  return row?.count ?? 0
}

export async function removeRedundantDinamikStubs(): Promise<number> {
  return Number(
    await db.$executeRaw(Prisma.sql`
      DELETE FROM v0.dbrands_match a
      WHERE a.ptbrands_id IS NULL
        AND a.dbrands_id IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM v0.dbrands_match b
          WHERE b.dbrands_id = a.dbrands_id
            AND b.ptbrands_id IS NOT NULL
            AND b.id <> a.id
        )
    `)
  )
}

export async function removeRedundantPtOnlyRows(): Promise<number> {
  return Number(
    await db.$executeRaw(Prisma.sql`
      DELETE FROM v0.dbrands_match a
      WHERE a.dbrands_id IS NULL
        AND a.ptbrands_id IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM v0.dbrands_match b
          WHERE b.ptbrands_id = a.ptbrands_id
            AND b.dbrands_id IS NOT NULL
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
