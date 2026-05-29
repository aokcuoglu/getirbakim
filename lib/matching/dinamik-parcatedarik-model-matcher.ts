import { db } from '@/lib/db'
import { ptproductNormalizedModelExpr } from '@/lib/sql/ptproduct-model'
import { Prisma } from '@prisma/client'
import { normalizeModel } from './code-normalization'

export type DinamikBarcodeField = 'barcode_1' | 'barcode_2' | 'barcode_3'

export type ModelMatchReason =
  | 'BARCODE_1_MODEL_EXACT'
  | 'BARCODE_2_MODEL_EXACT'
  | 'BARCODE_3_MODEL_EXACT'
  | 'MULTIPLE_PARCA_MODEL_MATCHES'

export type ModelMatchStatus =
  | 'CANDIDATE'
  | 'APPROVED'
  | 'REJECTED'
  | 'NEEDS_REVIEW'
  | 'IGNORED'

export interface DinamikParcatedarikModelMatch {
  dinamikProductId: bigint
  parcatedarikProductId: number
  dinamikBarcodeField: DinamikBarcodeField
  dinamikBarcodeValue: string
  normalizedBarcodeValue: string
  parcatedarikModel: string
  normalizedModel: string
  matchReason: ModelMatchReason
  confidence: number
  status: ModelMatchStatus
}

export function normalizeDinamikBarcode(value: string | null | undefined): string | null {
  return normalizeModel(value)
}

export function scoreCandidate(input: {
  barcodeField: DinamikBarcodeField
  brandMatch: boolean
  brandAliasMatch?: boolean
}): { confidence: number; matchReason: ModelMatchReason } {
  let confidence: number
  let matchReason: ModelMatchReason

  switch (input.barcodeField) {
    case 'barcode_1':
      confidence = 0.98
      matchReason = 'BARCODE_1_MODEL_EXACT'
      break
    case 'barcode_2':
      confidence = 0.96
      matchReason = 'BARCODE_2_MODEL_EXACT'
      break
    case 'barcode_3':
      confidence = 0.94
      matchReason = 'BARCODE_3_MODEL_EXACT'
      break
    default:
      confidence = 0.90
      matchReason = 'BARCODE_3_MODEL_EXACT'
  }

  if (input.brandAliasMatch) {
    confidence = Math.min(confidence + 0.02, 0.99)
  } else if (input.brandMatch) {
    confidence = Math.min(confidence + 0.01, 0.99)
  }

  return { confidence: Math.round(confidence * 10000) / 10000, matchReason }
}

type BrandAliasMap = Map<string, Map<number, number>>

async function loadBrandAliasMap(): Promise<BrandAliasMap> {
  const aliases = await db.$queryRaw<
    Array<{
      dinamik_brand: string
      normalized_brand: string
      ptdrk_brands_id: number
    }>
  >(Prisma.sql`
    SELECT db.brand AS dinamik_brand, a.normalized_brand, a.ptdrk_brands_id
    FROM v0.dnmk_ptdrk_brands a
    INNER JOIN v0.dnmk_brands db ON db.id = a.dnmk_brands_id
    WHERE a.mapping_status = 'APPROVED'
  `)

  const map: BrandAliasMap = new Map()
  for (const ba of aliases) {
    const key = normalizeModel(ba.dinamik_brand) || ba.normalized_brand
    if (!map.has(key)) {
      map.set(key, new Map())
    }
    map.get(key)!.set(ba.ptdrk_brands_id, 0.95)
  }
  return map
}

export async function findDinamikParcatedarikModelCandidates(
  input: {
    dinamikProductId: bigint
    barcode1: string | null
    barcode2: string | null
    barcode3: string | null
    brand?: string | null
    limit?: number
  },
  options?: {
    parcatedarikManufacturerName?: string | null
  }
): Promise<DinamikParcatedarikModelMatch[]> {
  const candidates: DinamikParcatedarikModelMatch[] = []
  const seenKeys = new Set<string>()

  const brandAliasMap = await loadBrandAliasMap()

  const barcodeFields: Array<{
    field: DinamikBarcodeField
    value: string | null
  }> = [
    { field: 'barcode_1', value: input.barcode1 },
    { field: 'barcode_2', value: input.barcode2 },
    { field: 'barcode_3', value: input.barcode3 }
  ]

  for (const { field, value } of barcodeFields) {
    if (!value) continue

    const normalizedValue = normalizeDinamikBarcode(value)
    if (!normalizedValue) continue

    const parcatedarikProducts = await db.$queryRaw<
      Array<{
        id: number
        model: string | null
        ptdrk_brands_id: number
      }>
    >(Prisma.sql`
      SELECT p.id, p.product_model AS model, p.ptdrk_brands_id
      FROM v0.ptdrk_products p
      WHERE ${ptproductNormalizedModelExpr} = ${normalizedValue}
        AND p.product_model IS NOT NULL
        AND BTRIM(p.product_model) <> ''
      LIMIT 50
    `)

    if (parcatedarikProducts.length === 0) continue

    const dinamikBrand = (input.brand || '').trim()
    const dinamikBrandNorm = normalizeModel(dinamikBrand) || ''

    const brandAliasManufacturers = dinamikBrandNorm ? brandAliasMap.get(dinamikBrandNorm) : null

    if (parcatedarikProducts.length === 1) {
      const pt = parcatedarikProducts[0]
      const key = `${input.dinamikProductId}::${pt.id}::${field}::${normalizedValue}`
      if (seenKeys.has(key)) continue
      seenKeys.add(key)

      let brandMatch = false
      let brandAliasMatch = false
      if (dinamikBrand && options?.parcatedarikManufacturerName) {
        const manufResult = await db.$queryRaw<Array<{ name: string }>>`
          SELECT name FROM v0.ptdrk_brands WHERE id = ${pt.ptdrk_brands_id}
        `
        if (manufResult.length > 0) {
          const normalizedMfrName = normalizeModel(manufResult[0].name)
          const normalizedDinamikBrand = normalizeModel(dinamikBrand)
          brandMatch = normalizedMfrName === normalizedDinamikBrand
        }
      }
      if (brandAliasManufacturers && brandAliasManufacturers.has(pt.ptdrk_brands_id)) {
        brandAliasMatch = true
      }

      const { confidence, matchReason } = scoreCandidate({
        barcodeField: field,
        brandMatch,
        brandAliasMatch
      })

      candidates.push({
        dinamikProductId: input.dinamikProductId,
        parcatedarikProductId: pt.id,
        dinamikBarcodeField: field,
        dinamikBarcodeValue: value,
        normalizedBarcodeValue: normalizedValue,
        parcatedarikModel: pt.model || '',
        normalizedModel: normalizeModel(pt.model) || normalizedValue,
        matchReason,
        confidence,
        status: 'CANDIDATE'
      })
    } else {
      let disambiguatedPt: typeof parcatedarikProducts[0] | null = null
      if (brandAliasManufacturers && brandAliasManufacturers.size > 0) {
        for (const pt of parcatedarikProducts) {
          if (brandAliasManufacturers.has(pt.ptdrk_brands_id)) {
            disambiguatedPt = pt
            break
          }
        }
      }

      if (disambiguatedPt) {
        const key = `${input.dinamikProductId}::${disambiguatedPt.id}::${field}::${normalizedValue}`
        if (!seenKeys.has(key)) {
          seenKeys.add(key)

          const { confidence, matchReason } = scoreCandidate({
            barcodeField: field,
            brandMatch: false,
            brandAliasMatch: true
          })

          candidates.push({
            dinamikProductId: input.dinamikProductId,
            parcatedarikProductId: disambiguatedPt.id,
            dinamikBarcodeField: field,
            dinamikBarcodeValue: value,
            normalizedBarcodeValue: normalizedValue,
            parcatedarikModel: disambiguatedPt.model || '',
            normalizedModel: normalizeModel(disambiguatedPt.model) || normalizedValue,
            matchReason,
            confidence,
            status: 'CANDIDATE'
          })
        }

        for (const pt of parcatedarikProducts) {
          if (pt.id === disambiguatedPt.id) continue
          const key = `${input.dinamikProductId}::${pt.id}::${field}::${normalizedValue}`
          if (seenKeys.has(key)) continue
          seenKeys.add(key)

          const { confidence } = scoreCandidate({
            barcodeField: field,
            brandMatch: false
          })

          candidates.push({
            dinamikProductId: input.dinamikProductId,
            parcatedarikProductId: pt.id,
            dinamikBarcodeField: field,
            dinamikBarcodeValue: value,
            normalizedBarcodeValue: normalizedValue,
            parcatedarikModel: pt.model || '',
            normalizedModel: normalizeModel(pt.model) || normalizedValue,
            matchReason: 'MULTIPLE_PARCA_MODEL_MATCHES',
            confidence,
            status: 'NEEDS_REVIEW'
          })
        }
      } else {
        for (const pt of parcatedarikProducts) {
          const key = `${input.dinamikProductId}::${pt.id}::${field}::${normalizedValue}`
          if (seenKeys.has(key)) continue
          seenKeys.add(key)

          let brandMatch = false
          if (dinamikBrand) {
            const manufResult = await db.$queryRaw<Array<{ name: string }>>`
              SELECT name FROM v0.ptdrk_brands WHERE id = ${pt.ptdrk_brands_id}
            `
            if (manufResult.length > 0) {
              const normalizedMfrName = normalizeModel(manufResult[0].name)
              const normalizedDinamikBrand = normalizeModel(dinamikBrand)
              brandMatch = normalizedMfrName === normalizedDinamikBrand
            }
          }

          const { confidence } = scoreCandidate({
            barcodeField: field,
            brandMatch
          })

          candidates.push({
            dinamikProductId: input.dinamikProductId,
            parcatedarikProductId: pt.id,
            dinamikBarcodeField: field,
            dinamikBarcodeValue: value,
            normalizedBarcodeValue: normalizedValue,
            parcatedarikModel: pt.model || '',
            normalizedModel: normalizeModel(pt.model) || normalizedValue,
            matchReason: 'MULTIPLE_PARCA_MODEL_MATCHES',
            confidence,
            status: 'NEEDS_REVIEW'
          })
        }
      }
    }
  }

  const limit = input.limit || 100
  return candidates.slice(0, limit)
}