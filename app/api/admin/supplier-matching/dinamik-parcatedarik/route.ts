import { NextRequest } from 'next/server'
import { getAdminAuth } from '@/lib/admin-auth'
import {
  errorResponse,
  successResponse,
  withApiContext
} from '@/lib/api/route-utils'
import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'
import { resolveParcatedarikToParts } from '@/lib/matching/parcatedarik-to-parts-resolver'

const VALID_STATUSES = ['CANDIDATE', 'APPROVED', 'REJECTED', 'NEEDS_REVIEW', 'IGNORED', 'PT_UNMATCHED', 'MANUAL_MATCH'] as const
const VALID_BARCODE_FIELDS = ['barcode_1', 'barcode_2', 'barcode_3', 'none'] as const
const VALID_MATCH_REASONS = [
  'BARCODE_1_MODEL_EXACT',
  'BARCODE_2_MODEL_EXACT',
  'BARCODE_3_MODEL_EXACT',
  'MULTIPLE_PARCA_MODEL_MATCHES',
  'PT_UNMATCHED',
  'MANUAL_MATCH',
  'BRAND_ALIAS_DISAMBIGUATED'
] as const

function buildWhereClause(filters: {
  status?: string
  barcodeField?: string
  matchReason?: string
  confidenceMin?: number
  confidenceMax?: number
  dinamikBarcode?: string
}): Prisma.Sql {
  const conditions: Prisma.Sql[] = []

  if (filters.status) {
    conditions.push(Prisma.sql`m.status = ${filters.status}`)
  }
  if (filters.barcodeField) {
    conditions.push(Prisma.sql`m.dinamik_barcode_field = ${filters.barcodeField}`)
  }
  if (filters.matchReason) {
    conditions.push(Prisma.sql`m.match_reason = ${filters.matchReason}`)
  }
  if (filters.confidenceMin !== undefined && !isNaN(filters.confidenceMin)) {
    conditions.push(Prisma.sql`m.confidence >= ${filters.confidenceMin}`)
  }
  if (filters.confidenceMax !== undefined && !isNaN(filters.confidenceMax)) {
    conditions.push(Prisma.sql`m.confidence <= ${filters.confidenceMax}`)
  }
  if (filters.dinamikBarcode) {
    conditions.push(Prisma.sql`m.normalized_barcode_value ILIKE ${'%' + filters.dinamikBarcode + '%'}`)
  }

  if (conditions.length === 0) {
    return Prisma.sql`1=1`
  }

  return Prisma.sql`(${Prisma.join(conditions, ' AND ')})`
}

export async function GET(request: NextRequest) {
  const { context, limitedResponse } = withApiContext(request, {
    keyPrefix: 'api:admin:dpmm:list',
    limit: 120,
    windowMs: 60_000
  })
  if (limitedResponse) return limitedResponse

  const auth = await getAdminAuth()
  if (!auth?.user) {
    return errorResponse({ status: 401, code: 'UNAUTHENTICATED', message: 'Authentication required.', context })
  }
  if (auth.user.role !== 'ADMIN') {
    return errorResponse({ status: 403, code: 'ADMIN_REQUIRED', message: 'Admin access required.', context })
  }

  try {
    const params = request.nextUrl.searchParams
    const rawStatus = params.get('status') || undefined
    const rawBarcodeField = params.get('barcode_field') || undefined
    const rawMatchReason = params.get('match_reason') || undefined
    const confidenceMin = params.get('confidence_min') ? parseFloat(params.get('confidence_min')!) : undefined
    const confidenceMax = params.get('confidence_max') ? parseFloat(params.get('confidence_max')!) : undefined
    const rawDinamikBarcode = params.get('dinamik_barcode') || undefined
    const page = Math.max(1, parseInt(params.get('page') || '1', 10))
    const limit = Math.min(100, Math.max(1, parseInt(params.get('limit') || '20', 10)))
    const offset = (page - 1) * limit

    const status = rawStatus && VALID_STATUSES.includes(rawStatus as typeof VALID_STATUSES[number])
      ? rawStatus
      : undefined
    const barcodeField = rawBarcodeField && VALID_BARCODE_FIELDS.includes(rawBarcodeField as typeof VALID_BARCODE_FIELDS[number])
      ? rawBarcodeField
      : undefined
    const matchReason = rawMatchReason && VALID_MATCH_REASONS.includes(rawMatchReason as typeof VALID_MATCH_REASONS[number])
      ? rawMatchReason
      : undefined
    const dinamikBarcode = rawDinamikBarcode
      ? rawDinamikBarcode.replace(/[%_\\]/g, '\\$&')
      : undefined

    const whereClause = buildWhereClause({
      status,
      barcodeField,
      matchReason,
      confidenceMin,
      confidenceMax,
      dinamikBarcode
    })

    const countResult = await db.$queryRaw<[{ count: bigint }]>(
      Prisma.sql`SELECT COUNT(*) AS count FROM public.dinamik_parcatedarik_model_matches m WHERE ${whereClause}`
    )
    const total = Number(countResult[0].count)

    const rows = await db.$queryRaw<
      Array<{
        id: bigint
        dinamik_product_id: bigint
        parcatedarik_product_id: bigint
        dinamik_barcode_field: string
        dinamik_barcode_value: string
        normalized_barcode_value: string
        parcatedarik_model: string
        normalized_model: string
        match_reason: string
        confidence: bigint
        status: string
        review_note: string | null
        approved_by: string | null
        approved_at: Date | null
        rejected_by: string | null
        rejected_at: Date | null
        created_at: Date
        updated_at: Date
        dinamik_stock_code: string | null
        dinamik_stock_name: string | null
        dinamik_brand: string | null
        dinamik_price: string | null
        dinamik_barcode_1: string | null
        dinamik_barcode_2: string | null
        dinamik_barcode_3: string | null
        parcatedarik_title: string | null
        parcatedarik_ref_no: string | null
        parcatedarik_manufacturer_name: string | null
      }>
    >(Prisma.sql`
      SELECT
        m.*,
        d.stock_code AS dinamik_stock_code,
        d.stock_name AS dinamik_stock_name,
        d.brand AS dinamik_brand,
        d.price AS dinamik_price,
        d.barcode_1 AS dinamik_barcode_1,
        d.barcode_2 AS dinamik_barcode_2,
        d.barcode_3 AS dinamik_barcode_3,
        pt.title AS parcatedarik_title,
        pt.ref_no AS parcatedarik_ref_no,
        mfr.name AS parcatedarik_manufacturer_name
      FROM public.dinamik_parcatedarik_model_matches m
      LEFT JOIN dinamik.products d ON d.id = m.dinamik_product_id
      LEFT JOIN parcatedarik.product pt ON pt.id = m.parcatedarik_product_id
      LEFT JOIN parcatedarik.manufacturer mfr ON mfr.id = pt.manufacturer_id
      WHERE ${whereClause}
      ORDER BY m.confidence DESC, m.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `)

    const summaryResult = await db.$queryRaw<
      Array<{ status: string; count: bigint }>
    >(Prisma.sql`
      SELECT status, COUNT(*) AS count
      FROM public.dinamik_parcatedarik_model_matches
      GROUP BY status
      ORDER BY count DESC
    `)

    const totalDinamikResult = await db.$queryRaw<[{ count: bigint }]>(
      Prisma.sql`SELECT COUNT(*) AS count FROM dinamik.products`
    )
    const withBarcodeResult = await db.$queryRaw<[{ count: bigint }]>(
      Prisma.sql`SELECT COUNT(*) AS count FROM dinamik.products WHERE (barcode_1 IS NOT NULL AND barcode_1 <> '') OR (barcode_2 IS NOT NULL AND barcode_2 <> '') OR (barcode_3 IS NOT NULL AND barcode_3 <> '')`
    )
    const ptWithModelResult = await db.$queryRaw<[{ count: bigint }]>(
      Prisma.sql`SELECT COUNT(*) AS count FROM parcatedarik.product WHERE normalized_model IS NOT NULL AND normalized_model <> ''`
    )
    const uniqueExactResult = await db.$queryRaw<[{ count: bigint }]>(
      Prisma.sql`SELECT COUNT(*) AS count FROM public.dinamik_parcatedarik_model_matches WHERE match_reason NOT LIKE 'MULTIPLE%'`
    )
    const multipleResult = await db.$queryRaw<[{ count: bigint }]>(
      Prisma.sql`SELECT COUNT(*) AS count FROM public.dinamik_parcatedarik_model_matches WHERE match_reason = 'MULTIPLE_PARCA_MODEL_MATCHES'`
    )

    const serializeRow = (row: typeof rows[number]) => ({
      id: row.id.toString(),
      dinamikProductId: row.dinamik_product_id.toString(),
      parcatedarikProductId: row.parcatedarik_product_id.toString(),
      dinamikBarcodeField: row.dinamik_barcode_field,
      dinamikBarcodeValue: row.dinamik_barcode_value,
      normalizedBarcodeValue: row.normalized_barcode_value,
      parcatedarikModel: row.parcatedarik_model,
      normalizedModel: row.normalized_model,
      matchReason: row.match_reason,
      confidence: Number(row.confidence),
      status: row.status,
      reviewNote: row.review_note,
      approvedBy: row.approved_by,
      approvedAt: row.approved_at?.toISOString() || null,
      rejectedBy: row.rejected_by,
      rejectedAt: row.rejected_at?.toISOString() || null,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      dinamik: {
        stockCode: row.dinamik_stock_code,
        stockName: row.dinamik_stock_name,
        brand: row.dinamik_brand,
        price: row.dinamik_price ? String(row.dinamik_price) : null,
        barcode1: row.dinamik_barcode_1,
        barcode2: row.dinamik_barcode_2,
        barcode3: row.dinamik_barcode_3
      },
      parcatedarik: {
        title: row.parcatedarik_title,
        refNo: row.parcatedarik_ref_no,
        manufacturerName: row.parcatedarik_manufacturer_name
      }
    })

    return successResponse({
      rows: rows.map(serializeRow),
      pagination: {
        page,
        limit,
        total,
        pages: Math.max(1, Math.ceil(total / limit))
      },
      summary: {
        total: Number(summaryResult.reduce((acc, r) => acc + Number(r.count), 0)),
        byStatus: Object.fromEntries(summaryResult.map((r) => [r.status, Number(r.count)])),
        dinamikProducts: {
          total: Number(totalDinamikResult[0].count),
          withBarcode: Number(withBarcodeResult[0].count)
        },
        parcatedarikProductsWithModel: Number(ptWithModelResult[0].count),
        uniqueExactMatches: Number(uniqueExactResult[0].count),
        multipleMatches: Number(multipleResult[0].count)
      }
    }, context)
  } catch (error) {
    console.error('Error in GET /api/admin/supplier-matching/dinamik-parcatedarik:', error)
    return errorResponse({ status: 500, code: 'LIST_FAILED', message: 'Failed to list matches.', context })
  }
}

export async function POST(request: NextRequest) {
  const { context, limitedResponse } = withApiContext(request, {
    keyPrefix: 'api:admin:dpmm:generate',
    limit: 10,
    windowMs: 300_000
  })
  if (limitedResponse) return limitedResponse

  const auth = await getAdminAuth()
  if (!auth?.user) {
    return errorResponse({ status: 401, code: 'UNAUTHENTICATED', message: 'Authentication required.', context })
  }
  if (auth.user.role !== 'ADMIN') {
    return errorResponse({ status: 403, code: 'ADMIN_REQUIRED', message: 'Admin access required.', context })
  }

  try {
    const body = await request.json()
    const apply = body.apply === true
    const limit = body.limit ? parseInt(body.limit, 10) : undefined

    const { execSync } = await import('child_process')
    const env = Object.assign({}, process.env, { APPLY: apply ? 'true' : 'false' } as Record<string, string>)
    if (limit) env.LIMIT = String(limit)

    const result = execSync(
      'bun scripts/generate-dinamik-parcatedarik-model-matches.ts',
      { env: env as NodeJS.ProcessEnv, timeout: 300_000, encoding: 'utf-8' }
    )

    return successResponse({
      message: apply ? 'Match generation applied.' : 'Match generation dry-run completed.',
      apply,
      limit,
      output: result.slice(-3000)
    }, context)
  } catch (error) {
    console.error('Error in POST /api/admin/supplier-matching/dinamik-parcatedarik:', error)
    return errorResponse({ status: 500, code: 'GENERATE_FAILED', message: 'Failed to generate matches.', context })
  }
}