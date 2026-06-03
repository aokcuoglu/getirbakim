import { db } from '@/lib/db'
import { resolveNormalizedForLink } from '@/lib/admin/dpprd-normalized'
import { Prisma } from '@prisma/client'

export type DpmatchLinkInput = {
  dnprdId: bigint
  productId: number
  mappingStatus?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'IGNORED'
  matchMethod?: string | null
  part_no?: string | null
}

export type DpmatchLinkResult = {
  id: number
  action: 'updated' | 'inserted'
}

/**
 * Link one Dinamik dproduct to one PT product in a dpprd row.
 * Supports many ptprd per dproduct (and many dnprd per ptproduct).
 * Merges single-side placeholder rows when present; otherwise inserts a new pair row.
 */
export async function linkDpmatchPair(input: DpmatchLinkInput): Promise<DpmatchLinkResult> {
  const status = input.mappingStatus ?? 'APPROVED'
  const method = input.matchMethod ?? 'MANUAL'
  const normalized = input.part_no ?? await resolveNormalizedForLink(input.dnprdId, input.productId)

  const existingPairRows = await db.$queryRaw<Array<{ id: number }>>(
    Prisma.sql`
      SELECT id
      FROM v0.product_mapping
      WHERE dnmk_products_id = ${input.dnprdId}
        AND ptdrk_products_id = ${input.productId}
      LIMIT 1
    `
  )
  const existingPair = existingPairRows[0]

  if (existingPair) {
    await db.$executeRaw(Prisma.sql`
      UPDATE v0.product_mapping
      SET mapping_status = ${status},
          match_method = ${method},
          part_no = COALESCE(${normalized}, part_no)
      WHERE id = ${existingPair.id}
    `)
    return { id: existingPair.id, action: 'updated' }
  }

  const dproductPlaceholderRows = await db.$queryRaw<Array<{ id: number }>>(
    Prisma.sql`
      SELECT id
      FROM v0.product_mapping
      WHERE dnmk_products_id = ${input.dnprdId}
        AND ptdrk_products_id IS NULL
      LIMIT 1
    `
  )
  const dproductPlaceholder = dproductPlaceholderRows[0]

  if (dproductPlaceholder) {
    await db.$executeRaw(Prisma.sql`
      UPDATE v0.product_mapping
      SET ptdrk_products_id = ${input.productId},
          mapping_status = ${status},
          match_method = ${method},
          part_no = COALESCE(${normalized}, part_no)
      WHERE id = ${dproductPlaceholder.id}
    `)

    await db.$executeRaw(Prisma.sql`
      DELETE FROM v0.product_mapping
      WHERE dnmk_products_id IS NULL
        AND ptdrk_products_id = ${input.productId}
    `)

    return { id: dproductPlaceholder.id, action: 'updated' }
  }

  const productPlaceholderRows = await db.$queryRaw<Array<{ id: number }>>(
    Prisma.sql`
      SELECT id
      FROM v0.product_mapping
      WHERE ptdrk_products_id = ${input.productId}
        AND dnmk_products_id IS NULL
      LIMIT 1
    `
  )
  const productPlaceholder = productPlaceholderRows[0]

  if (productPlaceholder) {
    await db.$executeRaw(Prisma.sql`
      UPDATE v0.product_mapping
      SET dnmk_products_id = ${input.dnprdId},
          mapping_status = ${status},
          match_method = ${method},
          part_no = COALESCE(${normalized}, part_no)
      WHERE id = ${productPlaceholder.id}
    `)
    return { id: productPlaceholder.id, action: 'updated' }
  }

  const inserted = await db.$queryRaw<Array<{ id: number }>>(
    Prisma.sql`
      INSERT INTO v0.product_mapping (
        dnmk_products_id, ptdrk_products_id, mapping_status, match_method, part_no
      ) VALUES (
        ${input.dnprdId}, ${input.productId}, ${status}, ${method}, ${normalized}
      )
      RETURNING id
    `
  )

  return { id: inserted[0]!.id, action: 'inserted' }
}

/**
 * Apply exact-match upserts for explicit pair links (used by batch tooling).
 */
export async function applyExactDpmatchLinks(
  links: Array<{ dnprdId: bigint; productId: number; part_no: string }>
): Promise<{ updated: number; inserted: number; deletedOrphans: number }> {
  if (links.length === 0) return { updated: 0, inserted: 0, deletedOrphans: 0 }

  let updated = 0
  let inserted = 0
  let deletedOrphans = 0

  for (const link of links) {
    const existingPairRows = await db.$queryRaw<Array<{ id: number }>>(
      Prisma.sql`
        SELECT id
        FROM v0.product_mapping
        WHERE dnmk_products_id = ${link.dnprdId}
          AND ptdrk_products_id = ${link.productId}
        LIMIT 1
      `
    )

    if (existingPairRows.length > 0) {
      await db.$executeRaw(Prisma.sql`
        UPDATE v0.product_mapping
        SET part_no = ${link.part_no},
            mapping_status = 'APPROVED',
            match_method = 'EXACT_MATCH'
        WHERE id = ${existingPairRows[0]!.id}
      `)
      updated += 1
    } else {
      const placeholderRows = await db.$queryRaw<Array<{ id: number }>>(
        Prisma.sql`
          SELECT id
          FROM v0.product_mapping
          WHERE dnmk_products_id = ${link.dnprdId}
            AND ptdrk_products_id IS NULL
          LIMIT 1
        `
      )

      if (placeholderRows.length > 0) {
        await db.$executeRaw(Prisma.sql`
          UPDATE v0.product_mapping
          SET ptdrk_products_id = ${link.productId},
              part_no = ${link.part_no},
              mapping_status = 'APPROVED',
              match_method = 'EXACT_MATCH'
          WHERE id = ${placeholderRows[0]!.id}
        `)
        updated += 1
      } else {
        await db.$executeRaw(Prisma.sql`
          INSERT INTO v0.product_mapping (
        dnmk_products_id, ptdrk_products_id, mapping_status, match_method, part_no
          ) VALUES (
            ${link.dnprdId}, ${link.productId}, 'APPROVED', 'EXACT_MATCH', ${link.part_no}
          )
        `)
        inserted += 1
      }
    }

    const orphanDelete = await db.$executeRaw(
      Prisma.sql`
        DELETE FROM v0.product_mapping
        WHERE dnmk_products_id IS NULL
          AND ptdrk_products_id = ${link.productId}
      `
    )
    deletedOrphans += orphanDelete
  }

  return { updated, inserted, deletedOrphans }
}
