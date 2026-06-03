import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'

export type V0ProductEnrichmentStats = {
  productCount: number
  sourceCount: number
  codeSignalCount: number
  publicPartLinkCount: number
  approvedPublicPartLinkCount: number
  candidatePublicPartLinkCount: number
  sourceCounts: Array<{
    sourceType: string
    count: number
  }>
  codeKindCounts: Array<{
    codeKind: string
    count: number
  }>
  recentProducts: Array<{
    id: string
    displayName: string
    brandName: string | null
    sourceCount: number
    codeSignalCount: number
    publicPartLinkCount: number
    approvedPartId: string | null
  }>
}

export async function getV0ProductEnrichmentStats(): Promise<V0ProductEnrichmentStats> {
  const [
    productRows,
    sourceRows,
    codeSignalRows,
    linkRows,
    sourceCounts,
    codeKindCounts,
    recentProducts
  ] = await Promise.all([
    db.$queryRaw<Array<{ count: number }>>(Prisma.sql`
      SELECT COUNT(*)::int AS count FROM v0.products
    `),
    db.$queryRaw<Array<{ count: number }>>(Prisma.sql`
      SELECT COUNT(*)::int AS count FROM v0.product_sources
    `),
    db.$queryRaw<Array<{ count: number }>>(Prisma.sql`
      SELECT COUNT(*)::int AS count FROM v0.product_code_signals
    `),
    db.$queryRaw<
      Array<{
        total_count: number
        approved_count: number
        candidate_count: number
      }>
    >(Prisma.sql`
      SELECT
        COUNT(*)::int AS total_count,
        COUNT(*) FILTER (WHERE status = 'APPROVED')::int AS approved_count,
        COUNT(*) FILTER (WHERE status = 'CANDIDATE')::int AS candidate_count
      FROM v0.product_public_part_links
    `),
    db.$queryRaw<Array<{ source_type: string; count: number }>>(Prisma.sql`
      SELECT source_type, COUNT(*)::int AS count
      FROM v0.product_sources
      GROUP BY source_type
      ORDER BY count DESC, source_type ASC
    `),
    db.$queryRaw<Array<{ code_kind: string; count: number }>>(Prisma.sql`
      SELECT code_kind, COUNT(*)::int AS count
      FROM v0.product_code_signals
      GROUP BY code_kind
      ORDER BY count DESC, code_kind ASC
    `),
    db.$queryRaw<
      Array<{
        id: bigint
        display_name: string
        brand_name: string | null
        source_count: number
        code_signal_count: number
        public_part_link_count: number
        approved_part_id: bigint | null
      }>
    >(Prisma.sql`
      SELECT
        p.id,
        p.display_name,
        p.brand_name,
        COUNT(DISTINCT s.id)::int AS source_count,
        COUNT(DISTINCT cs.id)::int AS code_signal_count,
        COUNT(DISTINCT l.id)::int AS public_part_link_count,
        MAX(l.part_id) FILTER (WHERE l.status = 'APPROVED') AS approved_part_id
      FROM v0.products p
      LEFT JOIN v0.product_sources s ON s.v0_product_id = p.id
      LEFT JOIN v0.product_code_signals cs ON cs.v0_product_id = p.id
      LEFT JOIN v0.product_public_part_links l ON l.v0_product_id = p.id
      GROUP BY p.id, p.display_name, p.brand_name
      ORDER BY p.id DESC
      LIMIT 25
    `)
  ])

  const linkSummary = linkRows[0]

  return {
    productCount: productRows[0]?.count ?? 0,
    sourceCount: sourceRows[0]?.count ?? 0,
    codeSignalCount: codeSignalRows[0]?.count ?? 0,
    publicPartLinkCount: linkSummary?.total_count ?? 0,
    approvedPublicPartLinkCount: linkSummary?.approved_count ?? 0,
    candidatePublicPartLinkCount: linkSummary?.candidate_count ?? 0,
    sourceCounts: sourceCounts.map((row) => ({
      sourceType: row.source_type,
      count: row.count
    })),
    codeKindCounts: codeKindCounts.map((row) => ({
      codeKind: row.code_kind,
      count: row.count
    })),
    recentProducts: recentProducts.map((row) => ({
      id: row.id.toString(),
      displayName: row.display_name,
      brandName: row.brand_name,
      sourceCount: row.source_count,
      codeSignalCount: row.code_signal_count,
      publicPartLinkCount: row.public_part_link_count,
      approvedPartId: row.approved_part_id?.toString() ?? null
    }))
  }
}
