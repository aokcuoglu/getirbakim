import { db } from '@/lib/db'
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

  if (input.brandMatch) {
    confidence = Math.min(confidence + 0.01, 0.99)
  }

  return { confidence: Math.round(confidence * 10000) / 10000, matchReason }
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
        normalized_model: string | null
        manufacturer_id: number
      }>
    >(Prisma.sql`
      SELECT p.id, p.model, p.normalized_model, p.manufacturer_id
      FROM parcatedarik.product p
      WHERE p.normalized_model = ${normalizedValue}
        AND p.normalized_model IS NOT NULL
        AND p.normalized_model <> ''
      LIMIT 50
    `)

    if (parcatedarikProducts.length === 0) continue

    const dinamikBrand = (input.brand || '').trim()

    if (parcatedarikProducts.length === 1) {
      const pt = parcatedarikProducts[0]
      const key = `${input.dinamikProductId}::${pt.id}::${field}::${normalizedValue}`
      if (seenKeys.has(key)) continue
      seenKeys.add(key)

      let brandMatch = false
      if (dinamikBrand && options?.parcatedarikManufacturerName) {
        const manufResult = await db.$queryRaw<Array<{ name: string }>>`
          SELECT name FROM parcatedarik.manufacturer WHERE id = ${pt.manufacturer_id}
        `
        if (manufResult.length > 0) {
          const normalizedMfrName = normalizeModel(manufResult[0].name)
          const normalizedDinamikBrand = normalizeModel(dinamikBrand)
          brandMatch = normalizedMfrName === normalizedDinamikBrand
        }
      }

      const { confidence, matchReason } = scoreCandidate({
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
        normalizedModel: pt.normalized_model || normalizedValue,
        matchReason,
        confidence,
        status: 'CANDIDATE'
      })
    } else {
      for (const pt of parcatedarikProducts) {
        const key = `${input.dinamikProductId}::${pt.id}::${field}::${normalizedValue}`
        if (seenKeys.has(key)) continue
        seenKeys.add(key)

        let brandMatch = false
        if (dinamikBrand) {
          const manufResult = await db.$queryRaw<Array<{ name: string }>>`
            SELECT name FROM parcatedarik.manufacturer WHERE id = ${pt.manufacturer_id}
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
          normalizedModel: pt.normalized_model || normalizedValue,
          matchReason: 'MULTIPLE_PARCA_MODEL_MATCHES',
          confidence,
          status: 'NEEDS_REVIEW'
        })
      }
    }
  }

  const limit = input.limit || 100
  return candidates.slice(0, limit)
}