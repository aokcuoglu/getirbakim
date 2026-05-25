import { db } from '@/lib/db'
import { resolveNormalizedForLink } from '@/lib/admin/dpmatch-normalized'
import { Prisma } from '@prisma/client'

export type DpmatchLinkInput = {
  dproductsId: bigint
  productId: number
  mappingStatus?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'IGNORED'
  matchMethod?: string | null
  normalized?: string | null
}

export type DpmatchLinkResult = {
  id: number
  action: 'updated' | 'inserted'
}

export class DpmatchLinkError extends Error {
  constructor(
    public readonly code: 'DPRODUCT_ALREADY_LINKED' | 'PRODUCT_ALREADY_LINKED',
    message: string
  ) {
    super(message)
    this.name = 'DpmatchLinkError'
  }
}

/**
 * Link one Dinamik dproduct to one PT product in a single dpmatch row.
 * Merges placeholder rows instead of creating duplicates.
 */
export async function linkDpmatchPair(input: DpmatchLinkInput): Promise<DpmatchLinkResult> {
  const status = input.mappingStatus ?? 'APPROVED'
  const method = input.matchMethod ?? 'MANUAL'
  const normalized = input.normalized ?? await resolveNormalizedForLink(input.dproductsId, input.productId)

  const productRows = await db.$queryRaw<Array<{ id: number; dproducts_id: bigint | null }>>(
    Prisma.sql`
      SELECT id, dproducts_id
      FROM parcatedarik.dpmatch
      WHERE product_id = ${input.productId}
      LIMIT 1
    `
  )
  const productRow = productRows[0]

  if (
    productRow?.dproducts_id != null &&
    productRow.dproducts_id !== input.dproductsId
  ) {
    throw new DpmatchLinkError(
      'PRODUCT_ALREADY_LINKED',
      'Bu PT ürünü başka bir Dinamik ürünle eşleşmiş.'
    )
  }

  const dproductRows = await db.$queryRaw<Array<{ id: number; product_id: number | null }>>(
    Prisma.sql`
      SELECT id, product_id
      FROM parcatedarik.dpmatch
      WHERE dproducts_id = ${input.dproductsId}
      LIMIT 1
    `
  )
  const dproductRow = dproductRows[0]

  if (
    dproductRow?.product_id != null &&
    dproductRow.product_id !== input.productId
  ) {
    throw new DpmatchLinkError(
      'DPRODUCT_ALREADY_LINKED',
      'Bu Dinamik ürün başka bir PT ürünüyle eşleşmiş.'
    )
  }

  if (dproductRow) {
    await db.$executeRaw(Prisma.sql`
      UPDATE parcatedarik.dpmatch
      SET product_id = ${input.productId},
          mapping_status = ${status},
          match_method = ${method},
          normalized = COALESCE(${normalized}, normalized)
      WHERE id = ${dproductRow.id}
    `)

    if (productRow && productRow.id !== dproductRow.id) {
      await db.$executeRaw(Prisma.sql`DELETE FROM parcatedarik.dpmatch WHERE id = ${productRow.id}`)
    }

    return { id: dproductRow.id, action: 'updated' }
  }

  if (productRow) {
    await db.$executeRaw(Prisma.sql`
      UPDATE parcatedarik.dpmatch
      SET dproducts_id = ${input.dproductsId},
          mapping_status = ${status},
          match_method = ${method},
          normalized = COALESCE(${normalized}, normalized)
      WHERE id = ${productRow.id}
    `)
    return { id: productRow.id, action: 'updated' }
  }

  const inserted = await db.$queryRaw<Array<{ id: number }>>(
    Prisma.sql`
      INSERT INTO parcatedarik.dpmatch (
        dproducts_id, product_id, mapping_status, match_method, normalized
      ) VALUES (
        ${input.dproductsId}, ${input.productId}, ${status}, ${method}, ${normalized}
      )
      RETURNING id
    `
  )

  return { id: inserted[0]!.id, action: 'inserted' }
}

/**
 * Apply exact-match updates after populate inserts placeholder rows.
 */
export async function applyExactDpmatchLinks(
  links: Array<{ dproductsId: bigint; productId: number; normalized: string }>
): Promise<{ updated: number; deletedOrphans: number }> {
  if (links.length === 0) return { updated: 0, deletedOrphans: 0 }

  let updated = 0
  let deletedOrphans = 0

  for (const link of links) {
    const dproductRows = await db.$queryRaw<Array<{ id: number }>>(
      Prisma.sql`
        UPDATE parcatedarik.dpmatch
        SET product_id = ${link.productId},
            normalized = ${link.normalized},
            mapping_status = 'APPROVED',
            match_method = 'EXACT_MATCH'
        WHERE dproducts_id = ${link.dproductsId}
        RETURNING id
      `
    )

    if (dproductRows.length > 0) {
      updated += 1
      const orphanDelete = await db.$executeRaw(
        Prisma.sql`
          DELETE FROM parcatedarik.dpmatch
          WHERE dproducts_id IS NULL
            AND product_id = ${link.productId}
        `
      )
      deletedOrphans += orphanDelete
    }
  }

  return { updated, deletedOrphans }
}
