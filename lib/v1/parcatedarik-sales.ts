import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'

export type V1AvailabilityStatus =
  | 'PURCHASABLE'
  | 'REQUEST_PRICE'
  | 'OUT_OF_STOCK'
  | 'NEEDS_MATCH_REVIEW'

export type V1ProductCTA =
  | 'ADD_TO_CART'
  | 'REQUEST_PRICE'
  | 'VERIFY_AVAILABILITY'

export type V1ParcatedarikProduct = {
  parcatedarikProductId: string
  title: string
  manufacturerName: string
  imageUrl: string | null
  model: string | null
  refNo: string | null
  dinamikProductId: string | null
  stockCode: string | null
  price: string | null
  stockQty: number
  currency: string
  matchStatus: string | null
  availabilityStatus: V1AvailabilityStatus
  cta: V1ProductCTA
}

export type V1ParcatedarikListResult = {
  products: V1ParcatedarikProduct[]
  page: number
  limit: number
  total: number
  hasMore: boolean
}

type V1AvailabilityInput = {
  matchStatus: string | null
  price: string | number | Prisma.Decimal | null
  stockQty: number | null
}

type V1ParcatedarikRow = {
  parcatedarik_product_id: number
  title: string
  image_url: string | null
  model: string | null
  ref_no: string | null
  manufacturer_name: string
  dinamik_product_id: bigint | null
  stock_code: string | null
  price: string | null
  stock_qty: number | null
  currency: string | null
  match_status: string | null
}

const SELLABLE_MATCH_STATUSES = new Set(['APPROVED', 'MANUAL_MATCH'])

function parsePositivePrice(value: V1AvailabilityInput['price']): boolean {
  if (value == null) return false
  const numeric = Number(value.toString())
  return Number.isFinite(numeric) && numeric > 0
}

export function resolveV1ParcatedarikAvailability(
  input: V1AvailabilityInput
): { availabilityStatus: V1AvailabilityStatus; cta: V1ProductCTA } {
  if (!input.matchStatus || !SELLABLE_MATCH_STATUSES.has(input.matchStatus)) {
    return {
      availabilityStatus: 'NEEDS_MATCH_REVIEW',
      cta: 'VERIFY_AVAILABILITY'
    }
  }

  const hasPrice = parsePositivePrice(input.price)
  if (!hasPrice) {
    return {
      availabilityStatus: 'REQUEST_PRICE',
      cta: 'REQUEST_PRICE'
    }
  }

  if ((input.stockQty ?? 0) <= 0) {
    return {
      availabilityStatus: 'OUT_OF_STOCK',
      cta: 'REQUEST_PRICE'
    }
  }

  return {
    availabilityStatus: 'PURCHASABLE',
    cta: 'ADD_TO_CART'
  }
}

export function mapV1ParcatedarikRow(row: V1ParcatedarikRow): V1ParcatedarikProduct {
  const availability = resolveV1ParcatedarikAvailability({
    matchStatus: row.match_status,
    price: row.price,
    stockQty: row.stock_qty
  })

  return {
    parcatedarikProductId: String(row.parcatedarik_product_id),
    title: row.title,
    manufacturerName: row.manufacturer_name,
    imageUrl: row.image_url,
    model: row.model,
    refNo: row.ref_no,
    dinamikProductId: row.dinamik_product_id?.toString() ?? null,
    stockCode: row.stock_code,
    price: row.price,
    stockQty: row.stock_qty ?? 0,
    currency: row.currency || 'TRY',
    matchStatus: row.match_status,
    ...availability
  }
}

export async function listV1ParcatedarikProducts(input: {
  page?: number
  limit?: number
  query?: string
  manufacturerId?: number
}): Promise<V1ParcatedarikListResult> {
  const page = Math.max(1, input.page ?? 1)
  const limit = Math.min(60, Math.max(1, input.limit ?? 24))
  const offset = (page - 1) * limit
  const conditions: Prisma.Sql[] = []

  if (input.query?.trim()) {
    const q = `%${input.query.trim()}%`
    conditions.push(Prisma.sql`(
      p.title ILIKE ${q}
      OR COALESCE(p.model, '') ILIKE ${q}
      OR COALESCE(p.ref_no, '') ILIKE ${q}
      OR m.name ILIKE ${q}
    )`)
  }

  if (input.manufacturerId && input.manufacturerId > 0) {
    conditions.push(Prisma.sql`p.manufacturer_id = ${input.manufacturerId}`)
  }

  const whereClause =
    conditions.length > 0
      ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`
      : Prisma.sql``

  const totalRows = await db.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
    SELECT COUNT(*) AS count
    FROM parcatedarik.product p
    JOIN parcatedarik.manufacturer m ON m.id = p.manufacturer_id
    ${whereClause}
  `)

  const rows = await db.$queryRaw<V1ParcatedarikRow[]>(Prisma.sql`
    SELECT
      p.id AS parcatedarik_product_id,
      p.title,
      p.image_url,
      p.model,
      p.ref_no,
      m.name AS manufacturer_name,
      best_match.dinamik_product_id,
      d.stock_code,
      COALESCE(sp.supplier_price::text, d.price::text) AS price,
      COALESCE(sp.supplier_stock_qty, 0)::int AS stock_qty,
      COALESCE(sp.currency, 'TRY') AS currency,
      best_match.status AS match_status
    FROM parcatedarik.product p
    JOIN parcatedarik.manufacturer m ON m.id = p.manufacturer_id
    LEFT JOIN LATERAL (
      SELECT mm.dinamik_product_id, mm.status, mm.confidence, mm.updated_at
      FROM public.dinamik_parcatedarik_model_matches mm
      WHERE mm.parcatedarik_product_id = p.id
      ORDER BY
        CASE
          WHEN mm.status IN ('APPROVED', 'MANUAL_MATCH') THEN 0
          WHEN mm.status = 'CANDIDATE' THEN 1
          WHEN mm.status = 'NEEDS_REVIEW' THEN 2
          WHEN mm.status = 'PT_UNMATCHED' THEN 3
          ELSE 4
        END,
        mm.confidence DESC,
        mm.updated_at DESC
      LIMIT 1
    ) best_match ON true
    LEFT JOIN dinamik.products d ON d.id = best_match.dinamik_product_id
    LEFT JOIN public.supplier_providers prv ON prv.code ILIKE 'dinamik'
    LEFT JOIN public.supplier_products sp
      ON sp.provider_id = prv.id
     AND sp.supplier_sku = d.stock_code
    ${whereClause}
    ORDER BY p.updated_at DESC NULLS LAST, p.id DESC
    LIMIT ${limit} OFFSET ${offset}
  `)

  const total = Number(totalRows[0]?.count ?? 0)

  return {
    products: rows.map(mapV1ParcatedarikRow),
    page,
    limit,
    total,
    hasMore: total > offset + rows.length
  }
}
