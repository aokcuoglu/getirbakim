import 'server-only'

import { unstable_cache } from 'next/cache'
import { Prisma } from '@prisma/client'
import { getDinamikBrandMatchStats } from '@/lib/admin/dinamik-brand-match-stats'
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

async function getParcaCatalogStats(): Promise<{
  products: number
  manufacturers: number
  brokenUrls: number
  withModel: number
}> {
  const [productRow, manufacturerRow] = await Promise.all([
    db.$queryRaw<
      Array<{
        products: bigint
        broken_urls: bigint
        with_model: bigint
      }>
    >(Prisma.sql`
      SELECT
        COUNT(*)::bigint AS products,
        COUNT(*) FILTER (
          WHERE p.url IS NULL
            OR BTRIM(p.url) = ''
            OR p.url NOT LIKE 'http%'
        )::bigint AS broken_urls,
        COUNT(*) FILTER (
          WHERE p.part_no IS NOT NULL
            AND BTRIM(p.part_no) <> ''
        )::bigint AS with_model
      FROM catalog.ptdrk_products p
    `),
    db.$queryRaw<Array<{ manufacturers: bigint }>>(Prisma.sql`
      SELECT COUNT(*)::bigint AS manufacturers FROM catalog.ptdrk_brands
    `)
  ])

  const row = productRow[0]
  return {
    products: Number(row?.products ?? 0),
    manufacturers: Number(manufacturerRow[0]?.manufacturers ?? 0),
    brokenUrls: Number(row?.broken_urls ?? 0),
    withModel: Number(row?.with_model ?? 0)
  }
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

async function loadSuppliersHubOverviewData(): Promise<SuppliersHubOverview> {
  const [brandStats, dnbrdMatch, parcaStats, dinamikRowCount] =
    await Promise.all([
      getDinamikBrandMatchStats(),
      getDbrandsMatchCounts(),
      getParcaCatalogStats(),
      getDinamikCatalogRowCount()
    ])

  const parcaCard: SuppliersHubProviderCard = {
    id: 'parcatedarik',
    name: 'ParçaTedarik',
    subtitle: 'Referans katalog — üretici ve ürün URL\'leri',
    integrationStatus: parcaStats.brokenUrls > 0 ? 'partial' : 'active',
    baseUrl: 'https://www.parcatedarik.com',
    lastSyncAt: null,
    syncHealth: null,
    metrics: [
      {
        label: 'Üretici',
        value: parcaStats.manufacturers
      },
      {
        label: 'Ürün kaydı',
        value: parcaStats.products
      },
      {
        label: 'Model normalize',
        value: parcaStats.withModel
      },
      {
        label: 'Bozuk / eksik URL',
        value: parcaStats.brokenUrls,
        hint: 'Sonra düzeltilecek — scraper veya import'
      }
    ],
    pipeline: [
      {
        id: 'manufacturers',
        label: 'Üreticiler',
        description: 'Eşleştirme hedef marka havuzu',
        count: parcaStats.manufacturers,
        href: '/admin/brands',
        status: 'ok'
      },
      {
        id: 'products',
        label: 'Ürünler',
        description: 'PT sitesinden toplanan ürün satırları',
        count: parcaStats.products,
        href: '/admin/products',
        status: parcaStats.brokenUrls > 0 ? 'warning' : 'ok'
      },
      {
        id: 'brand-links',
        label: 'Marka bağları',
        description: 'dpbrd onaylı kayıtlar',
        count: dnbrdMatch.approved,
        href: '/admin/brands',
        status: dnbrdMatch.pending > 0 ? 'warning' : 'ok'
      }
    ],
    actions: [
      {
        label: 'Marka eşleştir',
        href: '/admin/brands',
        variant: 'primary'
      }
    ]
  }

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      totalDinamikProducts: dinamikRowCount,
      unmatchedDinamikBrands: brandStats.unmatchedBrands,
      pendingBrandMatches: dnbrdMatch.pending,
      pendingModelMatches: 0,
      parcaProducts: parcaStats.products,
      parcaBrokenUrls: parcaStats.brokenUrls
    },
    providers: [parcaCard]
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