import 'server-only'

import { unstable_cache } from 'next/cache'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import type {
  MappingStatusCounts,
  SuppliersHubOverview,
  SuppliersHubProviderCard
} from '@/lib/types/suppliers-hub'

export type {
  MappingStatusCounts,
  SuppliersHubPipelineStep,
  SuppliersHubProviderCard
} from '@/lib/types/suppliers-hub'

function mapStatusCounts(
  rows: Array<{ mapping_status: string; count: bigint | number }>
): MappingStatusCounts {
  const counts: MappingStatusCounts = {
    pending: 0,
    approved: 0,
    rejected: 0,
    ignored: 0,
    total: 0
  }

  for (const row of rows) {
    const n = Number(row.count ?? 0)
    const status = (row.mapping_status || '').toUpperCase()
    counts.total += n
    if (status === 'PENDING') counts.pending += n
    else if (status === 'APPROVED') counts.approved += n
    else if (status === 'REJECTED') counts.rejected += n
    else if (status === 'IGNORED') counts.ignored += n
  }

  return counts
}

async function getDbrandsMatchCounts(): Promise<MappingStatusCounts> {
  const rows = await db.$queryRaw<
    Array<{ mapping_status: string; count: bigint }>
  >(Prisma.sql`
    SELECT mapping_status, COUNT(*)::bigint AS count
    FROM catalog.brand_mappings
    GROUP BY mapping_status
  `)
  return mapStatusCounts(rows)
}

async function getDinamikCatalogRowCount(): Promise<number> {
  const [estimateRow] = await db.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
    SELECT COALESCE(c.reltuples, 0)::bigint AS count
    FROM pg_class c
    INNER JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'v0'
      AND c.relname = 'dnprd'
  `)
  const estimate = Number(estimateRow?.count ?? 0)
  if (estimate > 0) return Math.round(estimate)

  const [exactRow] = await db.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
    SELECT COUNT(*)::bigint AS count FROM catalog.supplier_dinamik_products
  `)
  return Number(exactRow?.count ?? 0)
}

async function getSupplierOfferCounts(): Promise<Record<string, number>> {
  const rows = await db.$queryRaw<Array<{ supplier_code: string; count: bigint }>>(Prisma.sql`
    SELECT supplier_code, COUNT(*)::bigint AS count
    FROM catalog.product_offers
    GROUP BY supplier_code
  `)
  return Object.fromEntries(rows.map((r) => [r.supplier_code, Number(r.count)]))
}

async function loadSuppliersHubOverviewData(): Promise<SuppliersHubOverview> {
  const [brandMappings, dinamikRowCount, offerCounts] = await Promise.all([
    getDbrandsMatchCounts(),
    getDinamikCatalogRowCount(),
    getSupplierOfferCounts()
  ])

  const buildCard = (
    id: 'dinamik' | 'basbug',
    name: string,
    subtitle: string,
    catalogRows: number
  ): SuppliersHubProviderCard => ({
    id,
    name,
    subtitle,
    integrationStatus: 'active',
    baseUrl: null,
    lastSyncAt: null,
    syncHealth: null,
    metrics: [
      { label: 'Katalog satırı', value: catalogRows },
      { label: 'Aktif teklif', value: offerCounts[id] ?? 0 }
    ],
    pipeline: [
      {
        id: 'brands',
        label: 'Marka eşleştirme',
        description: 'Onaylı kanonik marka bağları',
        count: brandMappings.approved,
        href: '/admin/eslestirme',
        status: brandMappings.pending > 0 ? 'warning' : 'ok'
      },
      {
        id: 'offers',
        label: 'Ürün teklifleri',
        description: 'Fiyat/stok verebildiğimiz satırlar',
        count: offerCounts[id] ?? 0,
        href: '/admin/eslestirme',
        status: 'ok'
      }
    ],
    actions: [{ label: 'Eşleştirmeye git', href: '/admin/eslestirme', variant: 'primary' }]
  })

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      totalDinamikProducts: dinamikRowCount,
      unmatchedDinamikBrands: brandMappings.pending,
      pendingBrandMatches: brandMappings.pending,
      pendingModelMatches: 0
    },
    providers: [
      buildCard('dinamik', 'Dinamik Otomotiv', 'Ana katalog kaynağı', dinamikRowCount),
      buildCard('basbug', 'Başbuğ Otomotiv', 'OEM bilgisi olan ikincil kaynak', offerCounts.basbug ?? 0)
    ]
  }
}

const getCachedSuppliersHubOverview = unstable_cache(
  loadSuppliersHubOverviewData,
  ['admin-suppliers-hub-overview'],
  { revalidate: 90 }
)

export async function getSuppliersHubOverview(): Promise<SuppliersHubOverview> {
  return getCachedSuppliersHubOverview()
}