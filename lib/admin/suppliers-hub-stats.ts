import 'server-only'

import { unstable_cache } from 'next/cache'
import { Prisma } from '@prisma/client'
import { getDinamikBrandMatchStats } from '@/lib/admin/dinamik-brand-match-stats'
import { db } from '@/lib/db'
import { loadAdminSupplierProvidersDashboard } from '@/lib/actions/admin-suppliers'
import { requireAdminAuth } from '@/lib/admin-auth'
import type {
  MappingStatusCounts,
  SuppliersHubOverview,
  SuppliersHubProviderCard
} from '@/lib/types/suppliers-hub'

export type {
  MappingStatusCounts,
  SuppliersHubOverview,
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
    FROM v0.dbrands_match
    GROUP BY mapping_status
  `)
  return mapStatusCounts(rows)
}

async function getDpmatchCounts(): Promise<MappingStatusCounts> {
  const rows = await db.$queryRaw<
    Array<{ mapping_status: string; count: bigint }>
  >(Prisma.sql`
    SELECT mapping_status, COUNT(*)::bigint AS count
    FROM v0.dpmatch
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
          WHERE p.normalized_model IS NOT NULL
            AND BTRIM(p.normalized_model) <> ''
        )::bigint AS with_model
      FROM v0.ptproducts p
    `),
    db.$queryRaw<Array<{ manufacturers: bigint }>>(Prisma.sql`
      SELECT COUNT(*)::bigint AS manufacturers FROM v0.ptbrands
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

/** Fast row estimate; exact COUNT(*) on dproducts can exceed pooler statement_timeout. */
async function getDinamikCatalogRowCount(): Promise<number> {
  const [estimateRow] = await db.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
    SELECT COALESCE(c.reltuples, 0)::bigint AS count
    FROM pg_class c
    INNER JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'v0'
      AND c.relname = 'dproducts'
  `)
  const estimate = Number(estimateRow?.count ?? 0)
  if (estimate > 0) return Math.round(estimate)

  const [exactRow] = await db.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
    SELECT COUNT(*)::bigint AS count FROM v0.dproducts
  `)
  return Number(exactRow?.count ?? 0)
}

async function loadSuppliersHubOverviewData(): Promise<SuppliersHubOverview> {
  const [dbProviders, brandStats, matchCounts, parcaStats, dinamikRowCount] =
    await Promise.all([
      loadAdminSupplierProvidersDashboard(),
      getDinamikBrandMatchStats(),
      Promise.all([getDbrandsMatchCounts(), getDpmatchCounts()]),
      getParcaCatalogStats(),
      getDinamikCatalogRowCount()
    ])

  const [dbrandsMatch, dpmatch] = matchCounts

  const dinamikProvider = dbProviders.find((p) => p.code === 'dinamik')
  const supplierProducts = dinamikProvider?.productCounts.total ?? 0
  const mappingQueue = dinamikProvider?.productCounts.queue ?? 0
  const mappingApproved = dinamikProvider?.productCounts.approved ?? 0

  const unmatchedBrands = brandStats.unmatchedBrands

  const dinamikCard: SuppliersHubProviderCard = {
    id: 'dinamik',
    name: 'Dinamik',
    subtitle: 'B2B API — stok ve fiyat kaynağı',
    integrationStatus: 'active',
    baseUrl: dinamikProvider?.baseUrl ?? process.env.DINAMIK_BASE ?? null,
    lastSyncAt: dinamikProvider?.lastSyncAt ?? null,
    syncHealth: dinamikProvider
      ? {
          lastRunStatus: dinamikProvider.syncStats.lastRunStatus,
          failedRate30d: dinamikProvider.syncStats.failedRate30d,
          totalRuns30d: dinamikProvider.syncStats.totalRuns30d
        }
      : null,
    metrics: [
      {
        label: 'Ham katalog (dproducts)',
        value: dinamikRowCount,
        hint: 'API/sync ile v0 şemasına yazılan satırlar (yaklaşık satır sayısı)'
      },
      {
        label: 'Staging ürün (supplier_products)',
        value: supplierProducts,
        hint: 'Katalog eşleştirme için normalize edilmiş kayıtlar'
      },
      {
        label: 'Eşleşmeyen marka',
        value: unmatchedBrands,
        hint: 'dbrands_match veya onaylı alias yok'
      },
      {
        label: 'Mapping kuyruğu',
        value: mappingQueue,
        hint: 'Parça ↔ tedarikçi SKU bekleyen'
      }
    ],
    pipeline: [
      {
        id: 'api',
        label: 'API verisi',
        description: 'Dinamik uç noktalarından çekilen ham ürünler',
        count: dinamikRowCount,
        href: '/admin/suppliers/dinamik',
        status: dinamikRowCount > 0 ? 'ok' : 'warning'
      },
      {
        id: 'brands',
        label: 'Marka eşleştirme',
        description: 'Dinamik marka → ParçaTedarik üretici',
        count: dbrandsMatch.approved,
        href: '/admin/eslestirme?tab=brands',
        status:
          unmatchedBrands > 0
            ? 'warning'
            : dbrandsMatch.approved > 0
              ? 'ok'
              : 'muted'
      },
      {
        id: 'models',
        label: 'Model / ürün eşleştirme',
        description: 'Barkod ve model ile dpmatch satırları',
        count: dpmatch.approved,
        href: '/admin/eslestirme?tab=products',
        status: dpmatch.pending > 0 ? 'warning' : 'ok'
      },
      {
        id: 'catalog',
        label: 'Katalog mapping',
        description: 'Onaylı supplier_part_mappings',
        count: mappingApproved,
        href: '/admin/suppliers/dinamik',
        status: mappingQueue > 0 ? 'warning' : 'ok'
      }
    ],
    actions: [
      {
        label: 'API & Sync',
        href: '/admin/suppliers/dinamik',
        variant: 'primary'
      },
      {
        label: 'Marka eşleştir',
        href: '/admin/eslestirme?tab=brands',
        variant: 'secondary'
      },
      {
        label: 'Ürün eşleştir',
        href: '/admin/eslestirme?tab=products',
        variant: 'secondary'
      }
    ]
  }

  const parcaCard: SuppliersHubProviderCard = {
    id: 'parcatedarik',
    name: 'ParçaTedarik',
    subtitle: 'Referans katalog — üretici ve ürün URL’leri',
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
        href: '/admin/eslestirme?tab=brands',
        status: 'ok'
      },
      {
        id: 'products',
        label: 'Ürünler',
        description: 'PT sitesinden toplanan ürün satırları',
        count: parcaStats.products,
        href: '/admin/eslestirme?tab=products',
        status: parcaStats.brokenUrls > 0 ? 'warning' : 'ok'
      },
      {
        id: 'brand-links',
        label: 'Marka bağları',
        description: 'dbrands_match onaylı kayıtlar',
        count: dbrandsMatch.approved,
        href: '/admin/eslestirme?tab=brands',
        status: dbrandsMatch.pending > 0 ? 'warning' : 'ok'
      },
      {
        id: 'model-links',
        label: 'Model bağları',
        description: 'dpmatch onaylı ürün çiftleri',
        count: dpmatch.approved,
        href: '/admin/eslestirme?tab=products',
        status: dpmatch.pending > 0 ? 'warning' : 'ok'
      }
    ],
    actions: [
      {
        label: 'Marka eşleştir',
        href: '/admin/eslestirme?tab=brands',
        variant: 'primary'
      },
      {
        label: 'Ürün / model',
        href: '/admin/eslestirme?tab=products',
        variant: 'secondary'
      }
    ]
  }

  const basbugCard: SuppliersHubProviderCard = {
    id: 'basbug',
    name: 'Başbuğ',
    subtitle: 'Planlanan entegrasyon — API bağlantısı henüz yok',
    integrationStatus: 'planned',
    baseUrl: null,
    lastSyncAt: null,
    syncHealth: null,
    metrics: [
      { label: 'Staging ürün', value: 0 },
      { label: 'Marka alias', value: 0 },
      { label: 'Sync run', value: 0 }
    ],
    pipeline: [
      {
        id: 'api',
        label: 'API bağlantısı',
        description: 'Sağlayıcı kaydı ve credential yapılandırması',
        count: 0,
        href: '/admin/suppliers',
        status: 'blocked'
      },
      {
        id: 'catalog',
        label: 'Katalog içe aktarma',
        description: 'Ürün ve OEM verisi',
        count: 0,
        href: '/admin/suppliers',
        status: 'blocked'
      },
      {
        id: 'match',
        label: 'Eşleştirme',
        description: 'Marka ve parça eşleştirme kuyruğu',
        count: 0,
        href: '/admin/eslestirme',
        status: 'blocked'
      }
    ],
    actions: [
      {
        label: 'Yakında',
        href: '/admin/suppliers',
        variant: 'secondary'
      }
    ]
  }

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      totalDinamikProducts: dinamikRowCount,
      unmatchedDinamikBrands: unmatchedBrands,
      pendingBrandMatches: dbrandsMatch.pending,
      pendingModelMatches: dpmatch.pending,
      parcaProducts: parcaStats.products,
      parcaBrokenUrls: parcaStats.brokenUrls
    },
    providers: [dinamikCard, parcaCard, basbugCard]
  }
}

const getCachedSuppliersHubOverview = unstable_cache(
  loadSuppliersHubOverviewData,
  ['admin-suppliers-hub-overview'],
  { revalidate: 90 }
)

export async function getSuppliersHubOverview(): Promise<SuppliersHubOverview> {
  await requireAdminAuth()
  return getCachedSuppliersHubOverview()
}
