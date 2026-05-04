import 'server-only'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'

export interface PartSearchDocument {
  id: string
  name: string
  brandId: number | null
  brandName: string
  categoryId: number | null
  categoryName: string
  articleLinkId: string
  oems: string[]
  eans: string[]
  crossRefCodes: string[]
  price: number | null
  isVisible: boolean
  hasStock: boolean
  updatedAt: number
}

type PartDocumentRow = {
  id: bigint
  name: string
  article_link_id: bigint
  updated_at: Date
  part_brands: { id: number; name: string } | null
  part_categories: { id: number; name: string } | null
  part_admin_overrides: { is_visible: boolean } | null
  part_pricing_inventory: {
    supplier_stock_qty: number
    computed_selling_price_ex_vat: Prisma.Decimal | null
    supplier_price: Prisma.Decimal | null
  } | null
  part_oens: { code: string }[]
  part_eans: { code: string }[]
  part_cross_references: { article_number: string }[]
}

async function fetchPartRows(partIds: bigint[]): Promise<PartDocumentRow[]> {
  const rows = await db.parts.findMany({
    where: { id: { in: partIds } },
    select: {
      id: true,
      name: true,
      article_link_id: true,
      updated_at: true,
      part_brands: { select: { id: true, name: true } },
      part_categories: { select: { id: true, name: true } },
      part_admin_overrides: { select: { is_visible: true } },
      part_pricing_inventory: {
        select: {
          supplier_stock_qty: true,
          computed_selling_price_ex_vat: true,
          supplier_price: true
        }
      },
      part_oens: { select: { code: true } },
      part_eans: { select: { code: true } },
      part_cross_references: { select: { article_number: true } }
    }
  })
  return rows as unknown as PartDocumentRow[]
}

function rowToDocument(row: PartDocumentRow): PartSearchDocument {
  const inv = row.part_pricing_inventory
  const priceDecimal = inv?.computed_selling_price_ex_vat ?? inv?.supplier_price ?? null
  const price = priceDecimal ? Number(priceDecimal.toString()) : null

  return {
    id: row.id.toString(),
    name: row.name,
    brandId: row.part_brands?.id ?? null,
    brandName: row.part_brands?.name ?? '',
    categoryId: row.part_categories?.id ?? null,
    categoryName: row.part_categories?.name ?? '',
    articleLinkId: row.article_link_id.toString(),
    oems: row.part_oens.map((o) => o.code),
    eans: row.part_eans.map((e) => e.code),
    crossRefCodes: row.part_cross_references.map((cr) => cr.article_number),
    price,
    isVisible: row.part_admin_overrides?.is_visible ?? true,
    hasStock: (inv?.supplier_stock_qty ?? 0) > 0,
    updatedAt: row.updated_at.getTime()
  }
}

export async function buildPartSearchDocumentsBatch(
  partIds: bigint[]
): Promise<PartSearchDocument[]> {
  if (partIds.length === 0) return []
  const rows = await fetchPartRows(partIds)
  return rows.map(rowToDocument)
}

export async function buildAllPartSearchDocumentsPaginated(
  batchSize = 1000,
  onBatch?: (docs: PartSearchDocument[], offset: number) => Promise<void>
): Promise<number> {
  let offset = 0
  let total = 0

  while (true) {
    const rawRows = await db.parts.findMany({
      skip: offset,
      take: batchSize,
      orderBy: { id: 'asc' },
      select: {
        id: true,
        name: true,
        article_link_id: true,
        updated_at: true,
        part_brands: { select: { id: true, name: true } },
        part_categories: { select: { id: true, name: true } },
        part_admin_overrides: { select: { is_visible: true } },
        part_pricing_inventory: {
          select: {
            supplier_stock_qty: true,
            computed_selling_price_ex_vat: true,
            supplier_price: true
          }
        },
        part_oens: { select: { code: true } },
        part_eans: { select: { code: true } },
        part_cross_references: { select: { article_number: true } }
      }
    })
    const rows = rawRows as unknown as PartDocumentRow[]

    if (rows.length === 0) break

    const docs = rows.map(rowToDocument)
    total += docs.length
    await onBatch?.(docs, offset)
    offset += batchSize

    if (rows.length < batchSize) break
  }

  return total
}
