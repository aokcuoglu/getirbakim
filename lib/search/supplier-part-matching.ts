import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'

export type MatchReason =
  | 'OEM_EXACT'
  | 'EAN_EXACT'
  | 'CROSS_REFERENCE_EXACT'
  | 'BRAND_ALIAS_REFERENCE'
  | 'NAME_SIMILARITY'

export interface CandidateMatch {
  supplierProductId: number
  providerId: number
  partId: bigint
  confidence: number
  matchReason: MatchReason
  autoApprove: boolean
}

const OEM_EXACT_CONFIDENCE_MIN = 0.95
const OEM_EXACT_CONFIDENCE_MAX = 0.99
const EAN_EXACT_CONFIDENCE_MIN = 0.95
const EAN_EXACT_CONFIDENCE_MAX = 0.99
const CROSS_REFERENCE_CONFIDENCE_MIN = 0.85
const CROSS_REFERENCE_CONFIDENCE_MAX = 0.95
const BRAND_ALIAS_CONFIDENCE_MIN = 0.75
const BRAND_ALIAS_CONFIDENCE_MAX = 0.90
const NAME_SIMILARITY_MIN = 0.40
const NAME_SIMILARITY_MAX = 0.70

const AUTO_APPROVE_THRESHOLD = 0.95
const LOW_CONFIDENCE_THRESHOLD = 0.75

function normalizeCode(code: string): string {
  return code
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
}

function computeConfidence(min: number, max: number, brandMatch?: boolean): number {
  const base = min + (max - min) * (brandMatch ? 0.8 : 0.3)
  return Math.round(base * 100) / 100
}

export async function findCandidateMatchesForOrphan(
  supplierProductId: number,
  providerId: number,
  options?: {
    supplierBrand?: string | null
    supplierName?: string | null
    supplierSku?: string | null
    barcodes?: (string | null)[]
    normalizedSku?: string | null
  }
): Promise<CandidateMatch[]> {
  const candidates: CandidateMatch[] = []
  const seen = new Set<string>()

  const oems = await db.supplier_product_oems.findMany({
    where: {
      supplier_product_id: supplierProductId,
      is_active: true
    },
    select: { normalized_oem_code: true, oem_brand: true }
  })

  const normalizedOemCodes = oems
    .map((o) => o.normalized_oem_code)
    .filter(Boolean)
  const oemBrands = oems.map((o) => o.oem_brand).filter(Boolean)

  if (normalizedOemCodes.length > 0) {
    const normalizedForQuery = normalizedOemCodes.map(normalizeCode)
    const oenRows = await db.part_oens.findMany({
      where: {
        code: {
          in: normalizedForQuery
        }
      },
      select: { part_id: true, brand: true, code: true }
    })

    for (const row of oenRows) {
      const key = row.part_id.toString()
      if (seen.has(key)) continue
      seen.add(key)

      const oemBrandMatch = oemBrands.some(
        (ob) => ob && row.brand && ob.toLowerCase() === row.brand.toLowerCase()
      )
      const confidence = computeConfidence(
        OEM_EXACT_CONFIDENCE_MIN,
        OEM_EXACT_CONFIDENCE_MAX,
        oemBrandMatch
      )

      candidates.push({
        supplierProductId,
        providerId,
        partId: row.part_id,
        confidence,
        matchReason: 'OEM_EXACT',
        autoApprove: confidence >= AUTO_APPROVE_THRESHOLD
      })
    }
  }

  const barcodes = (options?.barcodes || []).filter(Boolean) as string[]
  if (barcodes.length > 0) {
    const eanRows = await db.part_eans.findMany({
      where: {
        code: { in: barcodes.map(normalizeCode) }
      },
      select: { part_id: true, code: true }
    })

    for (const row of eanRows) {
      const key = row.part_id.toString()
      if (seen.has(key)) continue
      seen.add(key)

      const confidence = computeConfidence(
        EAN_EXACT_CONFIDENCE_MIN,
        EAN_EXACT_CONFIDENCE_MAX
      )

      candidates.push({
        supplierProductId,
        providerId,
        partId: row.part_id,
        confidence,
        matchReason: 'EAN_EXACT',
        autoApprove: confidence >= AUTO_APPROVE_THRESHOLD
      })
    }
  }

  const supplierSku = options?.supplierSku
  const supplierNormSku = options?.normalizedSku || (supplierSku ? normalizeCode(supplierSku) : null)
  if (supplierNormSku) {
    const crRows = await db.part_cross_references.findMany({
      where: {
        article_number: supplierNormSku
      },
      select: { part_id: true, brand_name: true, article_number: true }
    })

    for (const row of crRows) {
      const key = row.part_id.toString()
      if (seen.has(key)) continue
      seen.add(key)

      const supplierBrand = options?.supplierBrand
      const brandMatch = !!(supplierBrand && row.brand_name && supplierBrand.toLowerCase() === row.brand_name.toLowerCase())
      const confidence = computeConfidence(
        CROSS_REFERENCE_CONFIDENCE_MIN,
        CROSS_REFERENCE_CONFIDENCE_MAX,
        brandMatch
      )

      candidates.push({
        supplierProductId,
        providerId,
        partId: row.part_id,
        confidence,
        matchReason: 'CROSS_REFERENCE_EXACT',
        autoApprove: false
      })
    }
  }

  if (options?.supplierBrand) {
    const aliasRows = await db.supplier_brand_aliases.findMany({
      where: {
        provider_id: providerId,
        supplier_brand: { equals: options.supplierBrand, mode: 'insensitive' },
        mapping_status: 'APPROVED'
      },
      select: { part_brand_id: true }
    })

    const brandIds = aliasRows
      .map((a) => a.part_brand_id)
      .filter((id): id is number => id !== null)

    if (brandIds.length > 0 && (supplierNormSku || normalizedOemCodes.length > 0)) {
      const brandParts = await db.parts.findMany({
        where: { brand_id: { in: brandIds } },
        select: { id: true },
        take: 50
      })

      for (const part of brandParts) {
        const key = part.id.toString()
        if (seen.has(key)) continue
        seen.add(key)

        const confidence = computeConfidence(
          BRAND_ALIAS_CONFIDENCE_MIN,
          BRAND_ALIAS_CONFIDENCE_MAX
        )

        candidates.push({
          supplierProductId,
          providerId,
          partId: part.id,
          confidence,
          matchReason: 'BRAND_ALIAS_REFERENCE',
          autoApprove: false
        })
      }
    }
  }

  if (options?.supplierName) {
    const nameWords = options.supplierName
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length >= 3)
      .slice(0, 4)

    if (nameWords.length >= 2) {
      const nameParts = await db.parts.findMany({
        where: {
          AND: nameWords.map((word) => ({
            name: { contains: word, mode: 'insensitive' as const }
          }))
        },
        select: { id: true },
        take: 20
      })

      for (const part of nameParts) {
        const key = part.id.toString()
        if (seen.has(key)) continue
        seen.add(key)

        candidates.push({
          supplierProductId,
          providerId,
          partId: part.id,
          confidence: computeConfidence(NAME_SIMILARITY_MIN, NAME_SIMILARITY_MAX),
          matchReason: 'NAME_SIMILARITY',
          autoApprove: false
        })
      }
    }
  }

  return candidates.sort((a, b) => b.confidence - a.confidence).slice(0, 10)
}

export async function findOrphanSupplierProducts(
  limit: number = 500,
  offset: number = 0
): Promise<
  Array<{
    id: number
    provider_id: number
    supplier_sku: string
    supplier_brand: string | null
    supplier_name: string | null
    normalized_sku: string | null
    barcode_1: string | null
    barcode_2: string | null
    barcode_3: string | null
    supplier_price: Prisma.Decimal | null
    supplier_stock_qty: number
    currency: string
    image_url: string | null
    provider_code: string
    provider_name: string
  }>
> {
  const rows = await db.$queryRaw<
    Array<{
      id: number
      provider_id: number
      supplier_sku: string
      supplier_brand: string | null
      supplier_name: string | null
      normalized_sku: string | null
      barcode_1: string | null
      barcode_2: string | null
      barcode_3: string | null
      supplier_price: Prisma.Decimal | null
      supplier_stock_qty: number
      currency: string
      image_url: string | null
      provider_code: string
      provider_name: string
    }>
  >(Prisma.sql`
    SELECT
      sp.id,
      sp.provider_id,
      sp.supplier_sku,
      sp.supplier_brand,
      sp.supplier_name,
      sp.normalized_sku,
      sp.barcode_1,
      sp.barcode_2,
      sp.barcode_3,
      sp.supplier_price,
      sp.supplier_stock_qty,
      sp.currency,
      sp.image_url,
      prv.code AS provider_code,
      prv.name AS provider_name
    FROM supplier_products sp
    JOIN supplier_providers prv ON prv.id = sp.provider_id AND prv.status = 'ACTIVE'
    WHERE NOT EXISTS (
      SELECT 1 FROM supplier_part_mappings spm
      WHERE spm.supplier_product_id = sp.id AND spm.status = 'APPROVED'
    )
    AND NOT EXISTS (
      SELECT 1 FROM part_supplier_offers pso
      WHERE pso.supplier_product_id = sp.id AND pso.is_active = true
    )
    ORDER BY sp.supplier_stock_qty DESC, sp.last_seen_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `)

  return rows
}

export async function countOrphanSupplierProducts(): Promise<number> {
  const result = await db.$queryRaw<[{ count: bigint }]>`
    SELECT COUNT(*) AS count
    FROM supplier_products sp
    JOIN supplier_providers prv ON prv.id = sp.provider_id AND prv.status = 'ACTIVE'
    WHERE NOT EXISTS (
      SELECT 1 FROM supplier_part_mappings spm
      WHERE spm.supplier_product_id = sp.id AND spm.status = 'APPROVED'
    )
    AND NOT EXISTS (
      SELECT 1 FROM part_supplier_offers pso
      WHERE pso.supplier_product_id = sp.id AND pso.is_active = true
    )
  `
  return Number(result[0].count)
}

export async function findOrCreateMapping(
  match: CandidateMatch,
  isManual: boolean = false
): Promise<{ created: boolean; id: number }> {
  const existing = await db.supplier_part_mappings.findFirst({
    where: {
      provider_id: match.providerId,
      supplier_product_id: match.supplierProductId
    }
  })

  if (existing) {
    return { created: false, id: existing.id }
  }

  const status = match.autoApprove ? 'APPROVED' : match.confidence >= LOW_CONFIDENCE_THRESHOLD ? 'CANDIDATE' : 'QUEUE'

  const created = await db.supplier_part_mappings.create({
    data: {
      provider_id: match.providerId,
      supplier_product_id: match.supplierProductId,
      supplier_sku: '',
      part_id: match.partId,
      status,
      workflow_status: match.autoApprove ? 'APPROVED' : 'NEW',
      confidence: new Prisma.Decimal(match.confidence),
      match_reason: match.matchReason,
      is_manual: isManual
    }
  })

  return { created: true, id: created.id }
}