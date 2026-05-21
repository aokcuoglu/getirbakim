import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'
import { normalizeModel, splitReferenceTokens } from './code-normalization'

export type PartMatchType =
  | 'OEM_MATCH'
  | 'EAN_MATCH'
  | 'CROSS_REFERENCE_MATCH'
  | 'PART_NO_MATCH'

export interface ParcatedarikPartCandidate {
  partId: bigint
  matchType: PartMatchType
  confidence: number
  ambiguous: boolean
  matchedToken: string
  normalizedToken: string
}

export interface ParcatedarikToPartsResult {
  parcatedarikProductId: number
  candidates: ParcatedarikPartCandidate[]
  refTokens: string[]
  normalizedRefTokens: string[]
  ambiguous: boolean
}

export async function resolveParcatedarikToParts(
  parcatedarikProductId: number,
  refNo: string | null
): Promise<ParcatedarikToPartsResult> {
  const result: ParcatedarikToPartsResult = {
    parcatedarikProductId,
    candidates: [],
    refTokens: [],
    normalizedRefTokens: [],
    ambiguous: false
  }

  if (!refNo || !refNo.trim()) return result

  const tokens = splitReferenceTokens(refNo)
  result.refTokens = tokens
  result.normalizedRefTokens = tokens.map((t) => normalizeModel(t) || '').filter(Boolean)

  if (result.normalizedRefTokens.length === 0) return result

  const seenPartIds = new Set<string>()

  for (const token of tokens) {
    const normalized = normalizeModel(token)
    if (!normalized || normalized.length < 2) continue

    const partsFromPartNo = await db.$queryRaw<
      Array<{ id: bigint }>
    >(Prisma.sql`
      SELECT id FROM parts WHERE CAST(part_no AS TEXT) = ${normalized} LIMIT 10
    `)

    if (partsFromPartNo.length > 0) {
      const ambiguous = partsFromPartNo.length > 1
      for (const p of partsFromPartNo) {
        const key = `PART_NO_MATCH::${p.id.toString()}`
        if (seenPartIds.has(key)) continue
        seenPartIds.add(key)
        result.candidates.push({
          partId: p.id,
          matchType: 'PART_NO_MATCH',
          confidence: 0.90,
          ambiguous,
          matchedToken: token,
          normalizedToken: normalized
        })
      }
      if (ambiguous) result.ambiguous = true
    }

    const oenRows = await db.part_oens.findMany({
      where: { code: normalized },
      select: { part_id: true, brand: true, code: true },
      take: 10
    })

    if (oenRows.length > 0) {
      const ambiguous = oenRows.length > 1
      for (const oen of oenRows) {
        const key = `OEM_MATCH::${oen.part_id.toString()}`
        if (seenPartIds.has(key)) continue
        seenPartIds.add(key)
        result.candidates.push({
          partId: oen.part_id,
          matchType: 'OEM_MATCH',
          confidence: 0.98,
          ambiguous,
          matchedToken: token,
          normalizedToken: normalized
        })
      }
      if (ambiguous) result.ambiguous = true
    }

    const eanRows = await db.part_eans.findMany({
      where: { code: normalized },
      select: { part_id: true, code: true },
      take: 10
    })

    if (eanRows.length > 0) {
      const ambiguous = eanRows.length > 1
      for (const ean of eanRows) {
        const key = `EAN_MATCH::${ean.part_id.toString()}`
        if (seenPartIds.has(key)) continue
        seenPartIds.add(key)
        result.candidates.push({
          partId: ean.part_id,
          matchType: 'EAN_MATCH',
          confidence: 0.96,
          ambiguous,
          matchedToken: token,
          normalizedToken: normalized
        })
      }
      if (ambiguous) result.ambiguous = true
    }

    const crRows = await db.part_cross_references.findMany({
      where: { article_number: normalized },
      select: { part_id: true, brand_name: true, article_number: true },
      take: 10
    })

    if (crRows.length > 0) {
      const ambiguous = crRows.length > 1
      for (const cr of crRows) {
        const key = `CROSS_REFERENCE_MATCH::${cr.part_id.toString()}`
        if (seenPartIds.has(key)) continue
        seenPartIds.add(key)
        result.candidates.push({
          partId: cr.part_id,
          matchType: 'CROSS_REFERENCE_MATCH',
          confidence: 0.88,
          ambiguous,
          matchedToken: token,
          normalizedToken: normalized
        })
      }
      if (ambiguous) result.ambiguous = true
    }
  }

  result.candidates.sort((a, b) => {
    const typeOrder: Record<PartMatchType, number> = {
      OEM_MATCH: 0,
      EAN_MATCH: 1,
      PART_NO_MATCH: 2,
      CROSS_REFERENCE_MATCH: 3
    }
    const typeDiff = typeOrder[a.matchType] - typeOrder[b.matchType]
    if (typeDiff !== 0) return typeDiff
    return b.confidence - a.confidence
  })

  return result
}

export function classifyRefToken(token: string): PartMatchType {
  const normalized = normalizeModel(token)
  if (!normalized) return 'CROSS_REFERENCE_MATCH'

  if (/^[0-9]{8,}$/.test(normalized)) return 'EAN_MATCH'
  if (/^[A-Z]{2,5}[0-9]{3,}/.test(normalized)) return 'OEM_MATCH'
  return 'CROSS_REFERENCE_MATCH'
}