import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'

type ExecuteRawClient = Pick<typeof db, '$executeRaw'>

function normalizeProviderCode(input: string | null | undefined): string | null {
  const value = input?.trim()
  if (!value) return null
  return value.toUpperCase()
}

function normalizeSupplierSku(input: string | null | undefined): string | null {
  const value = input?.trim()
  if (!value) return null
  return value
}

export async function ensureSupplierMappingCrossReference(input: {
  partId: bigint
  providerCode: string | null | undefined
  supplierSku: string | null | undefined
  tx?: ExecuteRawClient
}): Promise<boolean> {
  const brandName = normalizeProviderCode(input.providerCode)
  const articleNumber = normalizeSupplierSku(input.supplierSku)

  if (!brandName || !articleNumber) {
    return false
  }

  const client = input.tx ?? db
  const inserted = await client.$executeRaw(
    Prisma.sql`
      INSERT INTO part_cross_references (brand_name, article_number, part_id)
      SELECT ${brandName}, ${articleNumber}, ${input.partId}
      WHERE NOT EXISTS (
        SELECT 1
        FROM part_cross_references pcr
        WHERE pcr.part_id = ${input.partId}
          AND lower(pcr.brand_name) = lower(${brandName})
          AND lower(pcr.article_number) = lower(${articleNumber})
      )
    `
  )

  return inserted > 0
}
