import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { normalizeCode } from './code-normalization'

export type PartMatchType =
  | 'OEM_MATCH'
  | 'EAN_MATCH'
  | 'CROSS_REFERENCE_MATCH'
  | 'PART_NO_MATCH'

export type PartCandidate = {
  partId: bigint
  matchType: PartMatchType
  confidence: number
  matchedCode: string
}

export function classifyRefToken(rawRef: string): PartMatchType {
  const normalized = normalizeCode(rawRef)

  if (/^\d{8,14}$/.test(normalized)) {
    return 'EAN_MATCH'
  }

  if (/^[A-Z]{2,}\d{3,}[A-Z0-9]*$/.test(normalized)) {
    return 'OEM_MATCH'
  }

  return 'CROSS_REFERENCE_MATCH'
}

function confidenceForMatchType(matchType: PartMatchType): number {
  switch (matchType) {
    case 'OEM_MATCH':
      return 0.98
    case 'EAN_MATCH':
      return 0.96
    case 'PART_NO_MATCH':
      return 0.9
    case 'CROSS_REFERENCE_MATCH':
    default:
      return 0.88
  }
}

export async function findPublicPartCandidatesByCode(input: {
  rawCode: string
  codeKind?: PartMatchType | 'OEM' | 'EAN' | 'CROSS_REFERENCE' | 'SKU'
  limit?: number
}): Promise<PartCandidate[]> {
  const normalized = normalizeCode(input.rawCode)
  if (!normalized) return []

  const limit = Math.max(1, Math.min(input.limit ?? 20, 100))
  const normSql = (field: Prisma.Sql) => Prisma.sql`
    UPPER(REGEXP_REPLACE(COALESCE(${field}::text, ''), '[^A-Za-z0-9]+', '', 'g'))
  `

  const candidates: PartCandidate[] = []

  const oenRows = await db.$queryRaw<Array<{ part_id: bigint; code: string }>>(Prisma.sql`
    SELECT part_id, code
    FROM public.part_oens
    WHERE ${normSql(Prisma.sql`code`)} = ${normalized}
    LIMIT ${limit}
  `)
  for (const row of oenRows) {
    candidates.push({
      partId: row.part_id,
      matchType: 'OEM_MATCH',
      confidence: confidenceForMatchType('OEM_MATCH'),
      matchedCode: row.code
    })
  }

  const eanRows = await db.$queryRaw<Array<{ part_id: bigint; code: string }>>(Prisma.sql`
    SELECT part_id, code
    FROM public.part_eans
    WHERE ${normSql(Prisma.sql`code`)} = ${normalized}
    LIMIT ${limit}
  `)
  for (const row of eanRows) {
    candidates.push({
      partId: row.part_id,
      matchType: 'EAN_MATCH',
      confidence: confidenceForMatchType('EAN_MATCH'),
      matchedCode: row.code
    })
  }

  const crossRows = await db.$queryRaw<
    Array<{ part_id: bigint; article_number: string }>
  >(Prisma.sql`
    SELECT part_id, article_number
    FROM public.part_cross_references
    WHERE ${normSql(Prisma.sql`article_number`)} = ${normalized}
    LIMIT ${limit}
  `)
  for (const row of crossRows) {
    candidates.push({
      partId: row.part_id,
      matchType: 'CROSS_REFERENCE_MATCH',
      confidence: confidenceForMatchType('CROSS_REFERENCE_MATCH'),
      matchedCode: row.article_number
    })
  }

  return candidates
}
