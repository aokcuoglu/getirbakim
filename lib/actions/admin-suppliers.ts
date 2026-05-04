'use server'

import { Prisma } from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { requireAdminAuth } from '@/lib/admin-auth'
import { db } from '@/lib/db'
import { deleteCachePattern } from '@/lib/redis'
import { createAdminClient } from '@/lib/supabase/storage'
import {
  getBrandList,
  getPriceList,
  getStockBySku,
  getStockList
} from '@/lib/suppliers/dinamik-client'
import { parseDinamikRegionalStock } from '@/lib/suppliers/dinamik-stock'
import {
  applyPolicyForPart,
  mapDate,
  mapSupplierProductPrice,
  runDinamikSyncJob
} from '@/lib/suppliers/sync-dinamik'
import { runSetaCatalogOemRemapJob, runSetaSyncJob } from '@/lib/suppliers/sync-seta'
import { ensureSupplierMappingCrossReference } from '@/lib/suppliers/cross-reference-mirror'
import {
  DEFAULT_PRICING_POLICY,
  resolvePricingPolicyFromProviderConfig
} from '@/lib/pricing/calculate-selling-price'
import type {
  PartTechnicalReferenceInput,
  MappingCandidate,
  PartReferenceLink,
  SupplierReferenceCloneDraft,
  SupplierReferenceCloneEditableFields,
  SupplierReferenceCloneInput,
  SupplierPartSearchAdvancedInput,
  SupplierPartMapping,
  SupplierProductMappingDetail,
  SupplierProductMappingRow,
  SupplierProvider
} from '@/lib/types/admin-products'

function toNumber(
  value: string | number | null | undefined,
  fallback = 0
): number {
  if (value == null) return fallback
  const num = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(num) ? num : fallback
}

function normalizeText(value: string | null | undefined): string | null {
  const text = (value || '').trim()
  return text.length > 0 ? text : null
}

const PRISMA_GENERATE_HINT =
  "Prisma client güncel değil. 'bunx prisma generate' çalıştırıp dev server'ı yeniden başlatın."
const MAX_SUPPLIER_PRODUCT_MAPPINGS_EXPORT_ROWS = 1000000

function buildSupplierMappingsCsvCell(
  value: string | number | boolean | null | undefined
): string {
  if (value == null) return ''
  const text = String(value)
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

function getSupplierProductOemsDelegate() {
  return (db as unknown as {
    supplier_product_oems?: {
      findMany: (...args: any[]) => Promise<any>
      updateMany: (...args: any[]) => Promise<any>
      upsert: (...args: any[]) => Promise<any>
    }
  }).supplier_product_oems
}

interface AutoMatchResult {
  matched: boolean
  created?: boolean
  partBrand?: string | null
  partName?: string | null
  reason?: string | null
}

async function autoMatchOrCreatePartAfterOemSave(_input: {
  provider: { id: number; code: string; name: string } | null
  supplierProduct: {
    id: number
    supplier_sku: string
    supplier_brand: string | null
    supplier_price: Prisma.Decimal | null
    supplier_stock_qty: number
    currency: string
  } | null
  normalizedRows: { oem_code: string; normalized_oem_code: string }[]
  oemBrand: string | null
}): Promise<AutoMatchResult> {
  return { matched: false }
}

function isMissingSupplierProductOemsTableError(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2021') {
    const table = (error.meta as { table?: string } | undefined)?.table
    if (!table) return true
    return table.includes('supplier_product_oems')
  }

  const message = error instanceof Error ? error.message : String(error)
  return (
    message.toLocaleLowerCase('en-US').includes('supplier_product_oems') &&
    message.toLocaleLowerCase('en-US').includes('does not exist')
  )
}

function getRegionalStockFromRawJson(raw: unknown) {
  return parseDinamikRegionalStock(raw)
}

function normalizeTextList(values: string[] | undefined): string[] {
  const unique = new Set<string>()
  for (const value of values || []) {
    const normalized = normalizeText(value)
    if (normalized) unique.add(normalized)
  }
  return Array.from(unique)
}

function parsePositiveInt(value: unknown): number | null {
  if (value == null) return null
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num)) return null
  const intValue = Math.trunc(num)
  return intValue > 0 ? intValue : null
}

function parsePositiveDecimal(value: unknown): Prisma.Decimal | null {
  if (value == null || value === '') return null
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num) || num < 0) return null
  return new Prisma.Decimal(num)
}

function parsePositiveBigInt(value: unknown): bigint | null {
  if (value == null) return null
  if (typeof value === 'bigint') return value > BigInt(0) ? value : null

  const text = String(value).trim()
  if (!/^\d+$/.test(text)) return null

  try {
    const parsed = BigInt(text)
    return parsed > BigInt(0) ? parsed : null
  } catch {
    return null
  }
}

function isIdUniqueConstraintError(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false
  if (error.code !== 'P2002') return false

  const target = (error.meta as { target?: string[] | string } | undefined)
    ?.target
  if (Array.isArray(target)) return target.includes('id')
  if (typeof target === 'string') return target.includes('id')

  return error.message.includes('(`id`)')
}

async function alignPartPropertiesIdSequence(tx: Prisma.TransactionClient) {
  await tx.$executeRaw(Prisma.sql`
    SELECT setval(
      pg_get_serial_sequence('"part_properties"', 'id'),
      COALESCE((SELECT MAX(id) FROM "part_properties"), 0) + 1,
      false
    )
  `)
}

async function createPartPropertiesRows(
  tx: Prisma.TransactionClient,
  partId: bigint,
  rows: Array<{ key: string; value: string }>
) {
  if (rows.length === 0) return

  const data = rows.map((row) => ({
    part_id: partId,
    key: row.key,
    value: row.value
  }))

  try {
    await tx.part_properties.createMany({ data })
  } catch (error) {
    if (!isIdUniqueConstraintError(error)) throw error

    await alignPartPropertiesIdSequence(tx)
    await tx.part_properties.createMany({ data })
  }
}

function buildArticleLinkIdFromSupplier(source: {
  sku: string
  rawPartNo?: string | null
}): bigint {
  const partNoDigits = (source.rawPartNo || '').replace(/\D/g, '').slice(0, 18)
  if (partNoDigits) return BigInt(partNoDigits)

  const skuDigits = source.sku.replace(/\D/g, '').slice(0, 18)
  if (skuDigits) return BigInt(skuDigits)

  return BigInt(String(Date.now()).slice(0, 13))
}

function buildNewPartId(): bigint {
  return BigInt(
    `${Date.now()}${Math.floor(Math.random() * 1000)
      .toString()
      .padStart(3, '0')}`
  )
}

const REFERENCE_CLONE_IMAGE_BUCKET =
  process.env.SUPABASE_PART_IMAGES_BUCKET || 'part-images'
const REFERENCE_CLONE_DOCUMENT_BUCKET =
  process.env.SUPABASE_PART_DOCUMENTS_BUCKET ||
  process.env.SUPABASE_PART_IMAGES_BUCKET ||
  'part-images'
const REFERENCE_CLONE_DOCUMENT_TYPE_ID = 1
const REFERENCE_CLONE_DOCUMENT_TYPE_NAME = 'DOKUMAN'

function sanitizeStorageSegment(value: string | null | undefined): string {
  const normalized = (value || '')
    .trim()
    .toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return normalized.slice(0, 64) || 'unknown'
}

function getFileExtension(fileName: string): string | null {
  const extension = fileName.split('.').pop()?.trim().toLocaleLowerCase('en-US')
  if (!extension || !/^[a-z0-9]{1,8}$/.test(extension)) return null
  return extension
}

function getFileExtensionFromMime(mimeType: string | null): string | null {
  if (!mimeType) return null

  const known: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/svg+xml': 'svg',
    'application/pdf': 'pdf',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      'docx',
    'application/vnd.ms-excel': 'xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'text/plain': 'txt'
  }

  return known[mimeType] || null
}

type SupplierMappingWorkflowStatus =
  | 'NEW'
  | 'NEEDS_BRAND_MAPPING'
  | 'NEEDS_CATEGORY_MAPPING'
  | 'MATCHED_EXISTING'
  | 'READY_TO_CLONE'
  | 'CLONED_DRAFT'
  | 'IGNORED'

function mapWorkflowStatus(
  value: string | null | undefined,
  fallback: SupplierMappingWorkflowStatus = 'NEW'
): SupplierMappingWorkflowStatus {
  switch (value) {
    case 'NEW':
    case 'NEEDS_BRAND_MAPPING':
    case 'NEEDS_CATEGORY_MAPPING':
    case 'MATCHED_EXISTING':
    case 'READY_TO_CLONE':
    case 'CLONED_DRAFT':
    case 'IGNORED':
      return value
    default:
      return fallback
  }
}

function normalizeStringArray(values: string[] | undefined): string[] {
  return Array.from(
    new Set(
      (values || [])
        .map((value) => normalizeText(value))
        .filter((value): value is string => Boolean(value))
    )
  )
}

function normalizeReferenceRows<T extends Record<string, string>>(
  rows: T[],
  fields: Array<keyof T>,
  dedupeFields?: Array<keyof T>
): T[] {
  const dedupeBy = dedupeFields ?? fields
  return Array.from(
    new Map(
      rows
        .map((row) => {
          const normalized = { ...row }
          for (const field of fields) {
            normalized[field] = normalizeText(row[field]) as T[keyof T]
          }
          return normalized
        })
        .filter((row) => fields.every((field) => Boolean(row[field])))
        .map((row) => [
          dedupeBy
            .map((field) => String(row[field]).trim().toLocaleLowerCase('tr'))
            .join('::'),
          row
        ])
    ).values()
  )
}

function normalizeReferenceCloneDocuments(
  rows: SupplierReferenceCloneEditableFields['documents']
) {
  return rows
    .map((row) => ({
      id: row.id ?? null,
      name: normalizeText(row.name),
      fileTypeName: normalizeText(row.fileTypeName),
      docId: normalizeText(row.docId),
      docTypeId: parsePositiveInt(row.docTypeId),
      docTypeName: normalizeText(row.docTypeName),
      url: normalizeText(row.url)
    }))
    .filter(
      (
        row
      ): row is {
        id: number | null
        name: string
        fileTypeName: string
        docId: string
        docTypeId: number
        docTypeName: string
        url: string | null
      } =>
        Boolean(
          row.name &&
          row.fileTypeName &&
          row.docId &&
          row.docTypeId &&
          row.docTypeName
        )
    )
}

function normalizeReferenceCloneImages(
  rows: SupplierReferenceCloneEditableFields['images']
) {
  return rows
    .map((row) => ({
      image: normalizeText(row.image),
      thumb: normalizeText(row.thumb)
    }))
    .filter((row): row is { image: string; thumb: string | null } =>
      Boolean(row.image)
    )
}

function normalizeReferenceCloneVehicleTypes(
  rows: SupplierReferenceCloneEditableFields['vehicleTypes']
) {
  return Array.from(
    new Map(
      rows
        .map((row) => ({
          id: parsePositiveInt(row.id),
          label: normalizeText(row.label) || ''
        }))
        .filter((row): row is { id: number; label: string } => row.id != null)
        .map((row) => [row.id, row])
    ).values()
  )
}

function buildReferenceCloneProvenanceNote(input: {
  sourcePartId: bigint
  supplierSku: string
  providerCode: string
}) {
  return [
    `supplier-reference:${input.providerCode}`,
    `sku:${input.supplierSku}`,
    `source-part:${input.sourcePartId.toString()}`
  ].join(' | ')
}

function extractSupplierPropertyRows(raw: Record<string, unknown>) {
  const excludedKeys = new Set([
    'query_brand',
    'part_no',
    'stock_code',
    'stock_name',
    'brand',
    'price',
    'barcode_1',
    'barcode_2',
    'barcode_3',
    'oem',
    'oem_codes',
    'oemCodes',
    'oem_kodlari',
    'oemKodlari',
    'referans',
    'reference',
    'references',
    'cross',
    'crossReferences',
    'images',
    'documents'
  ])

  const rows: Array<{ key: string; value: string }> = []
  for (const [key, value] of Object.entries(raw)) {
    if (excludedKeys.has(key)) continue

    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      const normalizedKey = normalizeText(key)
      const normalizedValue = normalizeText(String(value))
      if (normalizedKey && normalizedValue) {
        rows.push({ key: normalizedKey, value: normalizedValue })
      }
    }
  }

  return normalizeReferenceRows(rows, ['key', 'value'], ['key'])
}

async function resolveSupplierBrandAlias(input: {
  providerId: number
  supplierBrand: string | null
  sourceBrandId: number
}) {
  const supplierBrand = normalizeText(input.supplierBrand)
  if (!supplierBrand) {
    const sourceBrand = await db.part_brands.findUnique({
      where: { id: input.sourceBrandId },
      select: { id: true, name: true }
    })

    return {
      brandId: sourceBrand?.id ?? input.sourceBrandId,
      brandName: sourceBrand?.name ?? null,
      status: 'FALLBACK_SOURCE' as const
    }
  }

  const alias = await db.supplier_brand_aliases.findFirst({
    where: {
      provider_id: input.providerId,
      supplier_brand: supplierBrand
    },
    include: {
      part_brands: {
        select: { id: true, name: true }
      }
    }
  })

  if (alias?.part_brand_id && alias.mapping_status === 'APPROVED') {
    return {
      brandId: alias.part_brand_id,
      brandName: alias.part_brands?.name ?? supplierBrand,
      status: 'APPROVED' as const
    }
  }

  const sourceBrand = await db.part_brands.findUnique({
    where: { id: input.sourceBrandId },
    select: { id: true, name: true }
  })

  if (sourceBrand) {
    return {
      brandId: sourceBrand.id,
      brandName: sourceBrand.name,
      status: 'FALLBACK_SOURCE' as const
    }
  }

  return {
    brandId: null,
    brandName: supplierBrand,
    status: 'UNRESOLVED' as const
  }
}

async function getAdminUserId() {
  const auth = await requireAdminAuth()
  if (!auth?.user?.id) {
    throw new Error('Yetkisiz işlem.')
  }
  return auth.user.id
}

function revalidateSupplierPaths() {
  invalidateSupplierProvidersDashboardCache()
  dinamikProviderCache = null
  setaProviderCache = null
  void deleteCachePattern('catalog:articles:v*')
  void deleteCachePattern('meilisearch:search:v*')
  void deleteCachePattern('meilisearch:fallback:v*')
  revalidatePath('/admin/suppliers')
  revalidatePath('/admin/suppliers/dinamik')
  revalidatePath('/admin/suppliers/seta')
  revalidatePath('/admin/suppliers/mappings')
  revalidatePath('/tr/admin/suppliers')
  revalidatePath('/tr/admin/suppliers/dinamik')
  revalidatePath('/tr/admin/suppliers/seta')
  revalidatePath('/tr/admin/suppliers/mappings')
  revalidatePath('/en/admin/suppliers')
  revalidatePath('/en/admin/suppliers/dinamik')
  revalidatePath('/en/admin/suppliers/seta')
  revalidatePath('/en/admin/suppliers/mappings')
  revalidatePath('/admin/products')
  revalidatePath('/tr/admin/products')
  revalidatePath('/en/admin/products')
}

const DEFAULT_DINAMIK_PROVIDER_CONFIG = {
  stockListPath: '/api/Dnmk_Customer/getStockList/{brand}',
  priceListPath: '/api/Dnmk_Customer/getPriceList/{brand}',
  stockPath: '/api/Dnmk_Customer/getStock',
  supportsRealtimeStock: true,
  pricing: {
    ...DEFAULT_PRICING_POLICY,
    rounding: 'HALF_UP_2',
    vatMode: 'EXCLUDED'
  }
}
const DEFAULT_SETA_PROVIDER_CONFIG = {
  productsPath: '/seta/products',
  supportsDelta: true
}

type SupplierMappingCreationOptions = SupplierProductMappingDetail['options']
type SupplierProviderOption = { code: string; name: string }
type SupplierQueryBrandOption = { queryBrand: string; totalProducts: number }

const SUPPLIER_MAPPING_OPTIONS_TTL_MS = 5 * 60 * 1000
const SUPPLIER_LIST_FILTER_OPTIONS_TTL_MS = 5 * 60 * 1000
const SUPPLIER_PROVIDERS_DASHBOARD_TTL_MS = 60 * 1000
const DINAMIK_PROVIDER_CACHE_TTL_MS = 5 * 60 * 1000
const SETA_PROVIDER_CACHE_TTL_MS = 5 * 60 * 1000
const SUPPLIER_SUMMARY_CACHE_TTL_MS = 30 * 1000
const supplierMappingOptionsCache = new Map<
  string,
  {
    expiresAt: number
    options: SupplierMappingCreationOptions
  }
>()
let supplierProviderOptionsCache: {
  expiresAt: number
  options: SupplierProviderOption[]
} | null = null
const supplierQueryBrandOptionsCache = new Map<
  string,
  {
    expiresAt: number
    options: SupplierQueryBrandOption[]
  }
>()
let supplierProvidersDashboardCache: {
  expiresAt: number
  data: SupplierProvider[]
} | null = null
let dinamikProviderCache: {
  expiresAt: number
  provider: Awaited<ReturnType<typeof db.supplier_providers.findUnique>>
} | null = null
let setaProviderCache: {
  expiresAt: number
  provider: Awaited<ReturnType<typeof db.supplier_providers.findUnique>>
} | null = null
const supplierSummaryCache = new Map<
  string,
  {
    expiresAt: number
    data: { total: number; matched: number; unmatched: number }
  }
>()

function invalidateSupplierMappingOptionsCache(providerCode?: string) {
  if (!providerCode) {
    supplierMappingOptionsCache.clear()
    return
  }

  supplierMappingOptionsCache.delete(providerCode)
}

function invalidateSupplierProvidersDashboardCache() {
  supplierProvidersDashboardCache = null
}

async function getSupplierMappingCreationOptions(provider: {
  id: number
  code: string
}): Promise<SupplierMappingCreationOptions> {
  const now = Date.now()
  const cached = supplierMappingOptionsCache.get(provider.code)
  if (cached && cached.expiresAt > now) {
    return cached.options
  }

  const [brands, categories, supplierBrandRows] = await Promise.all([
    db.part_brands.findMany({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
      take: 500
    }),
    db.part_categories.findMany({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
      take: 500
    }),
    provider.code === 'dinamik'
      ? db.$queryRaw<Array<{ brand: string }>>(Prisma.sql`
          SELECT DISTINCT d.brand
          FROM dinamik.products d
          WHERE d.brand IS NOT NULL
            AND BTRIM(d.brand) <> ''
          ORDER BY d.brand ASC
          LIMIT 1000
        `)
      : db.$queryRaw<Array<{ brand: string }>>(Prisma.sql`
          SELECT DISTINCT sp.supplier_brand AS brand
          FROM supplier_products sp
          WHERE sp.provider_id = ${provider.id}
            AND sp.supplier_brand IS NOT NULL
            AND BTRIM(sp.supplier_brand) <> ''
          ORDER BY sp.supplier_brand ASC
          LIMIT 1000
        `)
  ])

  const options: SupplierMappingCreationOptions = {
    brands,
    categories,
    supplierBrands: normalizeTextList(
      supplierBrandRows.map((item) => item.brand)
    )
  }

  supplierMappingOptionsCache.set(provider.code, {
    expiresAt: now + SUPPLIER_MAPPING_OPTIONS_TTL_MS,
    options
  })

  return options
}

async function getSupplierProviderOptionsCached(): Promise<
  SupplierProviderOption[]
> {
  await ensureDefaultProviders()

  const now = Date.now()
  if (
    supplierProviderOptionsCache &&
    supplierProviderOptionsCache.expiresAt > now
  ) {
    return supplierProviderOptionsCache.options
  }

  const options = await db.supplier_providers.findMany({
    select: { code: true, name: true },
    orderBy: [{ priority: 'asc' }, { name: 'asc' }]
  })

  supplierProviderOptionsCache = {
    expiresAt: now + SUPPLIER_LIST_FILTER_OPTIONS_TTL_MS,
    options
  }

  return options
}

async function getSupplierQueryBrandOptionsCached(provider: {
  id: number
  code: string
}): Promise<SupplierQueryBrandOption[]> {
  const now = Date.now()
  const cached = supplierQueryBrandOptionsCache.get(provider.code)
  if (cached && cached.expiresAt > now) {
    return cached.options
  }

  const rows =
    provider.code === 'dinamik'
      ? await db.$queryRaw<
          Array<{ query_brand: string; product_count: number | string }>
        >(Prisma.sql`
          SELECT
            sp.supplier_brand AS query_brand,
            COUNT(*)::int AS product_count
          FROM supplier_products sp
          WHERE sp.provider_id = ${provider.id}
            AND sp.supplier_brand IS NOT NULL
            AND sp.supplier_brand <> ''
          GROUP BY sp.supplier_brand
          ORDER BY sp.supplier_brand ASC
        `)
      : await db.$queryRaw<
          Array<{ query_brand: string; product_count: number | string }>
        >(Prisma.sql`
          SELECT
            sp.supplier_brand AS query_brand,
            COUNT(*)::int AS product_count
          FROM supplier_products sp
          WHERE sp.provider_id = ${provider.id}
            AND sp.supplier_brand IS NOT NULL
            AND sp.supplier_brand <> ''
          GROUP BY sp.supplier_brand
          ORDER BY sp.supplier_brand ASC
        `)

  const options = rows.map((row) => ({
    queryBrand: row.query_brand,
    totalProducts: toNumber(row.product_count, 0)
  }))

  supplierQueryBrandOptionsCache.set(provider.code, {
    expiresAt: now + SUPPLIER_LIST_FILTER_OPTIONS_TTL_MS,
    options
  })

  return options
}

async function ensureDinamikProvider() {
  const now = Date.now()
  if (
    dinamikProviderCache &&
    dinamikProviderCache.expiresAt > now &&
    dinamikProviderCache.provider
  ) {
    return dinamikProviderCache.provider
  }

  const existing = await db.supplier_providers.findUnique({
    where: { code: 'dinamik' }
  })
  if (existing) {
    dinamikProviderCache = {
      expiresAt: now + DINAMIK_PROVIDER_CACHE_TTL_MS,
      provider: existing
    }
    return existing
  }

  const created = await db.supplier_providers.create({
    data: {
      code: 'dinamik',
      name: 'Dinamik',
      status: 'ACTIVE',
      priority: 10,
      schedule: 'HOURLY',
      base_url: 'https://dinamikapp-api.dinamik.online',
      config: DEFAULT_DINAMIK_PROVIDER_CONFIG
    }
  })

  dinamikProviderCache = {
    expiresAt: now + DINAMIK_PROVIDER_CACHE_TTL_MS,
    provider: created
  }

  return created
}

async function ensureSetaProvider() {
  const now = Date.now()
  if (setaProviderCache && setaProviderCache.expiresAt > now && setaProviderCache.provider) {
    return setaProviderCache.provider
  }

  const existing = await db.supplier_providers.findUnique({
    where: { code: 'seta' }
  })
  if (existing) {
    setaProviderCache = {
      expiresAt: now + SETA_PROVIDER_CACHE_TTL_MS,
      provider: existing
    }
    return existing
  }

  const created = await db.supplier_providers.create({
    data: {
      code: 'seta',
      name: 'SETA',
      status: 'ACTIVE',
      priority: 20,
      schedule: 'HOURLY',
      base_url: 'https://b2b-api.ismyazilim.com',
      config: DEFAULT_SETA_PROVIDER_CONFIG
    }
  })

  setaProviderCache = {
    expiresAt: now + SETA_PROVIDER_CACHE_TTL_MS,
    provider: created
  }

  return created
}

async function ensureDefaultProviders() {
  await Promise.all([ensureDinamikProvider(), ensureSetaProvider()])
}

type ProviderStatsRow = {
  provider_id: number
  total_runs_30d: number
  failed_rate_30d: string
}

export async function getAdminSupplierProviders(): Promise<SupplierProvider[]> {
  await requireAdminAuth()

  const now = Date.now()
  if (
    supplierProvidersDashboardCache &&
    supplierProvidersDashboardCache.expiresAt > now
  ) {
    return supplierProvidersDashboardCache.data
  }

  await ensureDefaultProviders()

  const [providers, statsRows, productGroups, mappingGroups] = await Promise.all([
    db.supplier_providers.findMany({
      select: {
        id: true,
        code: true,
        name: true,
        status: true,
        priority: true,
        schedule: true,
        base_url: true,
        last_sync_at: true,
        supplier_sync_runs: {
          orderBy: { started_at: 'desc' },
          take: 1,
          select: {
            status: true,
            started_at: true
          }
        }
      },
      orderBy: [{ priority: 'asc' }, { name: 'asc' }]
    }),
    db.$queryRaw<ProviderStatsRow[]>(Prisma.sql`
      SELECT
        provider_id,
        COUNT(*)::int AS total_runs_30d,
        CASE
          WHEN COALESCE(SUM(total_count), 0) = 0 THEN 0
          ELSE ROUND((COALESCE(SUM(failed_count), 0)::numeric / NULLIF(SUM(total_count), 0)::numeric) * 100, 2)
        END::text AS failed_rate_30d
      FROM supplier_sync_runs
      WHERE started_at >= NOW() - INTERVAL '30 days'
      GROUP BY provider_id
    `),
    db.supplier_products.groupBy({
      by: ['provider_id'],
      _count: { id: true }
    }),
    db.supplier_part_mappings.groupBy({
      by: ['provider_id', 'status'],
      _count: { id: true }
    })
  ])

  const statsByProvider = new Map<number, ProviderStatsRow>(
    statsRows.map((row) => [row.provider_id, row])
  )

  const productCountByProvider = new Map<number, number>(
    productGroups.map((g) => [g.provider_id, g._count.id])
  )

  const mappingCountsByProvider = new Map<
    number,
    { QUEUE: number; APPROVED: number; IGNORED: number }
  >()
  for (const g of mappingGroups) {
    const entry = mappingCountsByProvider.get(g.provider_id) ?? {
      QUEUE: 0,
      APPROVED: 0,
      IGNORED: 0
    }
    if (g.status === 'QUEUE' || g.status === 'APPROVED' || g.status === 'IGNORED') {
      entry[g.status] = g._count.id
    }
    mappingCountsByProvider.set(g.provider_id, entry)
  }

  const data = providers.map((provider) => {
    const latest = provider.supplier_sync_runs[0]
    const stats = statsByProvider.get(provider.id)
    const counts = mappingCountsByProvider.get(provider.id) ?? {
      QUEUE: 0,
      APPROVED: 0,
      IGNORED: 0
    }

    return {
      id: provider.id,
      code: provider.code,
      name: provider.name,
      status: provider.status,
      priority: provider.priority,
      schedule: provider.schedule,
      baseUrl: provider.base_url,
      lastSyncAt: mapDate(provider.last_sync_at),
      syncStats: {
        lastRunStatus: latest?.status ?? null,
        lastRunAt: mapDate(latest?.started_at),
        failedRate30d: toNumber(stats?.failed_rate_30d, 0),
        totalRuns30d: stats?.total_runs_30d ?? 0
      },
      productCounts: {
        total: productCountByProvider.get(provider.id) ?? 0,
        approved: counts.APPROVED,
        queue: counts.QUEUE,
        ignored: counts.IGNORED
      }
    }
  })

  supplierProvidersDashboardCache = {
    expiresAt: now + SUPPLIER_PROVIDERS_DASHBOARD_TTL_MS,
    data
  }

  return data
}

export async function getAdminSupplierProviderDetail(providerCode: string) {
  await requireAdminAuth()
  await ensureDefaultProviders()

  const provider = await db.supplier_providers.findUnique({
    where: { code: providerCode },
    include: {
      supplier_sync_runs: {
        orderBy: { started_at: 'desc' },
        take: 20
      }
    }
  })

  if (!provider) {
    return {
      success: false,
      message: 'Tedarikçi bulunamadı.'
    }
  }

  const [productCount, offerCount, queueCount, approvedCount, ignoredCount] =
    await Promise.all([
      db.supplier_products.count({ where: { provider_id: provider.id } }),
      db.part_supplier_offers.count({ where: { provider_id: provider.id } }),
      db.supplier_part_mappings.count({
        where: { provider_id: provider.id, status: 'QUEUE' }
      }),
      db.supplier_part_mappings.count({
        where: { provider_id: provider.id, status: 'APPROVED' }
      }),
      db.supplier_part_mappings.count({
        where: { provider_id: provider.id, status: 'IGNORED' }
      })
    ])

  return {
    success: true,
    data: {
      provider: {
        id: provider.id,
        code: provider.code,
        name: provider.name,
        status: provider.status,
        priority: provider.priority,
        schedule: provider.schedule,
        baseUrl: provider.base_url,
        config: provider.config,
        pricingPolicy: resolvePricingPolicyFromProviderConfig(provider.config),
        updatedAt: mapDate(provider.updated_at),
        lastSyncAt: mapDate(provider.last_sync_at)
      },
      counts: {
        productCount,
        offerCount,
        queueCount,
        approvedCount,
        ignoredCount
      },
      runs: provider.supplier_sync_runs.map((run) => ({
        id: run.id,
        triggerType: run.trigger_type,
        endpoint: run.endpoint,
        status: run.status,
        startedAt: mapDate(run.started_at),
        endedAt: mapDate(run.ended_at),
        totalCount: run.total_count,
        successCount: run.success_count,
        failedCount: run.failed_count,
        errorSummary: run.error_summary,
        meta: run.meta
      }))
    }
  }
}

export async function getAdminSupplierMappingsQueue(input?: {
  providerCode?: string
  status?: 'QUEUE' | 'APPROVED' | 'IGNORED' | 'all'
  q?: string
  page?: number
  limit?: number
}) {
  await requireAdminAuth()
  await ensureDinamikProvider()

  const providerCode = input?.providerCode?.trim() || 'dinamik'
  const status = input?.status || 'QUEUE'
  const q = input?.q?.trim() || ''
  const page = input?.page && input.page > 0 ? input.page : 1
  const limit =
    input?.limit && input.limit > 0 ? Math.min(input.limit, 100) : 20

  const provider = await db.supplier_providers.findUnique({
    where: { code: providerCode },
    select: { id: true, code: true, name: true }
  })

  if (!provider) {
    return {
      success: false,
      message: 'Tedarikçi bulunamadı.',
      data: {
        provider: null,
        items: [] as SupplierPartMapping[],
        pagination: {
          page,
          limit,
          total: 0,
          pages: 1
        }
      }
    }
  }

  const where: Prisma.supplier_part_mappingsWhereInput = {
    provider_id: provider.id,
    ...(status !== 'all' ? { status } : {})
  }

  if (q) {
    where.OR = [
      {
        supplier_sku: {
          contains: q,
          mode: 'insensitive'
        }
      },
      {
        supplier_products: {
          is: {
            supplier_name: {
              contains: q,
              mode: 'insensitive'
            }
          }
        }
      },
      {
        parts: {
          is: {
            name: {
              contains: q,
              mode: 'insensitive'
            }
          }
        }
      }
    ]
  }

  const [total, mappings] = await Promise.all([
    db.supplier_part_mappings.count({ where }),
    db.supplier_part_mappings.findMany({
      where,
      orderBy: [{ confidence: 'desc' }, { updated_at: 'desc' }],
      skip: (page - 1) * limit,
      take: limit,
      include: {
        supplier_products: true,
        parts: {
          include: {
            part_brands: {
              select: { name: true }
            }
          }
        }
      }
    })
  ])

  const items: SupplierPartMapping[] = mappings.map((mapping) => ({
    id: mapping.id,
    providerId: mapping.provider_id,
    supplierProductId: mapping.supplier_product_id,
    supplierSku: mapping.supplier_sku,
    partId: mapping.part_id ? mapping.part_id.toString() : null,
    status: mapping.status as SupplierPartMapping['status'],
    workflowStatus: mapWorkflowStatus(mapping.workflow_status),
    confidence: mapping.confidence
      ? Number(mapping.confidence.toString())
      : null,
    matchReason: mapping.match_reason,
    isManual: mapping.is_manual,
    approvedBy: mapping.approved_by,
    approvedAt: mapDate(mapping.approved_at),
    ignoredReason: mapping.ignored_reason,
    supplierProduct: {
      id: mapping.supplier_products.id,
      sku: mapping.supplier_products.supplier_sku,
      name: mapping.supplier_products.supplier_name,
      brand: mapping.supplier_products.supplier_brand,
      price: mapSupplierProductPrice(mapping.supplier_products.supplier_price),
      stockQty: mapping.supplier_products.supplier_stock_qty,
      currency: mapping.supplier_products.currency,
      lastSeenAt: mapping.supplier_products.last_seen_at.toISOString()
    },
    part: mapping.parts
      ? {
          id: mapping.parts.id.toString(),
          articleLinkId: mapping.parts.article_link_id.toString(),
          name: mapping.parts.name,
          brand: mapping.parts.part_brands?.name || null
        }
      : null
  }))

  return {
    success: true,
    data: {
      provider,
      items,
      pagination: {
        page,
        limit,
        total,
        pages: Math.max(1, Math.ceil(total / limit))
      }
    }
  }
}

interface DinamikBrandMappingRow {
  supplier_brand: string
  alias_id: number | null
  mapped_part_brand_id: number | null
  mapped_part_brand_name: string | null
  mapping_status: string | null
  confidence: string | null
  updated_at: Date | null
  exact_part_brand_id: number | null
  exact_part_brand_name: string | null
}

interface DinamikBrandSummaryRow {
  total: number | string
  mapped_total: number | string
  pending_total: number | string
  unmapped_total: number | string
}

interface DinamikBrandCountRow {
  total: number | string
}

interface DinamikBrandAutoMatchRow {
  supplier_brand: string
  part_brand_id: number
}

type DinamikBrandStatusFilter = 'all' | 'mapped' | 'unmapped' | 'pending'

export async function getDinamikBrandMappings(input?: {
  q?: string
  status?: DinamikBrandStatusFilter
  page?: number
  limit?: number
}) {
  await requireAdminAuth()
  const provider = await ensureDinamikProvider()

  const q = input?.q?.trim() || ''
  const status = input?.status || 'all'
  const page = input?.page && input.page > 0 ? input.page : 1
  const limit =
    input?.limit && input.limit > 0 ? Math.min(input.limit, 100) : 20
  const offset = (page - 1) * limit

  const like = `%${q}%`
  const qCondition = q ? Prisma.sql`AND d.brand ILIKE ${like}` : Prisma.sql``
  const statusCondition =
    status === 'mapped'
      ? Prisma.sql`AND sba.part_brand_id IS NOT NULL AND sba.mapping_status = 'APPROVED'`
      : status === 'unmapped'
        ? Prisma.sql`AND (sba.id IS NULL OR sba.part_brand_id IS NULL OR sba.mapping_status <> 'APPROVED')`
        : status === 'pending'
          ? Prisma.sql`AND sba.mapping_status = 'PENDING'`
          : Prisma.sql``

  try {
    // Prisma-first hybrid rule:
    // Keep SQL here because LATERAL joins + "latest alias per brand" semantics
    // are not reliably representable in a single Prisma ORM query.
    // Performance reference: docs/perf/data-access-benchmarks.md
    const [countRows, summaryRows, rows] = await Promise.all([
      db.$queryRaw<DinamikBrandCountRow[]>(Prisma.sql`
        SELECT COUNT(*)::int AS total
        FROM dinamik.brands d
        LEFT JOIN LATERAL (
          SELECT a.*
          FROM supplier_brand_aliases a
          WHERE a.provider_id = ${provider.id}
            AND LOWER(TRIM(a.supplier_brand)) = LOWER(TRIM(d.brand))
          ORDER BY a.updated_at DESC
          LIMIT 1
        ) sba ON TRUE
        WHERE d.brand IS NOT NULL
          AND d.brand <> ''
          ${qCondition}
          ${statusCondition}
      `),
      db.$queryRaw<DinamikBrandSummaryRow[]>(Prisma.sql`
        SELECT
          COUNT(*)::int AS total,
          SUM(CASE WHEN sba.part_brand_id IS NOT NULL AND sba.mapping_status = 'APPROVED' THEN 1 ELSE 0 END)::int AS mapped_total,
          SUM(CASE WHEN sba.mapping_status = 'PENDING' THEN 1 ELSE 0 END)::int AS pending_total,
          SUM(CASE WHEN sba.id IS NULL OR sba.part_brand_id IS NULL OR sba.mapping_status <> 'APPROVED' THEN 1 ELSE 0 END)::int AS unmapped_total
        FROM dinamik.brands d
        LEFT JOIN LATERAL (
          SELECT a.*
          FROM supplier_brand_aliases a
          WHERE a.provider_id = ${provider.id}
            AND LOWER(TRIM(a.supplier_brand)) = LOWER(TRIM(d.brand))
          ORDER BY a.updated_at DESC
          LIMIT 1
        ) sba ON TRUE
        WHERE d.brand IS NOT NULL
          AND d.brand <> ''
          ${qCondition}
      `),
      db.$queryRaw<DinamikBrandMappingRow[]>(Prisma.sql`
        SELECT
          d.brand AS supplier_brand,
          sba.id AS alias_id,
          sba.part_brand_id AS mapped_part_brand_id,
          mapped_pb.name AS mapped_part_brand_name,
          sba.mapping_status,
          sba.confidence::text AS confidence,
          sba.updated_at,
          exact_pb.id AS exact_part_brand_id,
          exact_pb.name AS exact_part_brand_name
        FROM dinamik.brands d
        LEFT JOIN LATERAL (
          SELECT a.*
          FROM supplier_brand_aliases a
          WHERE a.provider_id = ${provider.id}
            AND LOWER(TRIM(a.supplier_brand)) = LOWER(TRIM(d.brand))
          ORDER BY a.updated_at DESC
          LIMIT 1
        ) sba ON TRUE
        LEFT JOIN part_brands mapped_pb ON mapped_pb.id = sba.part_brand_id
        LEFT JOIN LATERAL (
          SELECT pb.id, pb.name
          FROM part_brands pb
          WHERE LOWER(TRIM(pb.name)) = LOWER(TRIM(d.brand))
          ORDER BY pb.id DESC
          LIMIT 1
        ) exact_pb ON TRUE
        WHERE d.brand IS NOT NULL
          AND d.brand <> ''
          ${qCondition}
          ${statusCondition}
        ORDER BY d.brand ASC
        LIMIT ${limit}
        OFFSET ${offset}
      `)
    ])

    const total = toNumber(countRows[0]?.total, 0)
    const summary = summaryRows[0]

    const mappedRows = rows.map((row) => {
      const mapped =
        row.mapped_part_brand_id != null
          ? {
              id: row.mapped_part_brand_id,
              name: row.mapped_part_brand_name || '-'
            }
          : null

      const exact =
        row.exact_part_brand_id != null
          ? {
              id: row.exact_part_brand_id,
              name: row.exact_part_brand_name || '-'
            }
          : null

      let effectiveStatus: 'APPROVED' | 'PENDING' | 'UNMAPPED' = 'UNMAPPED'
      if (mapped && row.mapping_status === 'APPROVED') {
        effectiveStatus = 'APPROVED'
      } else if (row.mapping_status === 'PENDING') {
        effectiveStatus = 'PENDING'
      }

      return {
        supplierBrand: row.supplier_brand,
        mappedPartBrand: mapped,
        exactCandidate: exact,
        status: effectiveStatus,
        confidence: row.confidence ? toNumber(row.confidence, 0) : null,
        updatedAt: row.updated_at ? row.updated_at.toISOString() : null
      }
    })

    return {
      rows: mappedRows,
      pagination: {
        page,
        limit,
        total,
        pages: Math.max(1, Math.ceil(total / limit))
      },
      summary: {
        total: toNumber(summary?.total, 0),
        mapped: toNumber(summary?.mapped_total, 0),
        pending: toNumber(summary?.pending_total, 0),
        unmapped: toNumber(summary?.unmapped_total, 0)
      },
      filters: {
        q,
        status
      }
    }
  } catch (error) {
    console.error('[brand-mapping] list failed:', error)
    return {
      rows: [] as Array<{
        supplierBrand: string
        mappedPartBrand: { id: number; name: string } | null
        exactCandidate: { id: number; name: string } | null
        status: 'APPROVED' | 'PENDING' | 'UNMAPPED'
        confidence: number | null
        updatedAt: string | null
      }>,
      pagination: {
        page: 1,
        limit,
        total: 0,
        pages: 1
      },
      summary: {
        total: 0,
        mapped: 0,
        pending: 0,
        unmapped: 0
      },
      filters: {
        q,
        status
      }
    }
  }
}

export async function searchPublicPartBrandsForSupplierMapping(input: {
  q?: string
  limit?: number
}) {
  await requireAdminAuth()

  const q = input.q?.trim() || ''
  const limit = input.limit && input.limit > 0 ? Math.min(input.limit, 100) : 20

  const brands = await db.part_brands.findMany({
    where: q
      ? {
          name: {
            contains: q,
            mode: 'insensitive'
          }
        }
      : undefined,
    orderBy: { name: 'asc' },
    take: limit,
    select: {
      id: true,
      name: true
    }
  })

  return brands
}

export async function saveDinamikBrandMapping(input: {
  supplierBrand: string
  partBrandId?: number | null
}) {
  await requireAdminAuth()
  const provider = await ensureDinamikProvider()

  const supplierBrand = input.supplierBrand.trim()
  if (!supplierBrand) {
    return { success: false, message: 'Dinamik marka adı zorunludur.' }
  }

  const existingAlias = await db.supplier_brand_aliases.findFirst({
    where: {
      provider_id: provider.id,
      supplier_brand: {
        equals: supplierBrand,
        mode: 'insensitive'
      }
    }
  })

  if (input.partBrandId == null) {
    if (existingAlias) {
      await db.supplier_brand_aliases.update({
        where: { id: existingAlias.id },
        data: {
          supplier_brand: supplierBrand,
          normalized_brand: supplierBrand.toLocaleUpperCase('tr'),
          part_brand_id: null,
          mapping_status: 'PENDING',
          confidence: null
        }
      })
    } else {
      await db.supplier_brand_aliases.create({
        data: {
          provider_id: provider.id,
          supplier_brand: supplierBrand,
          normalized_brand: supplierBrand.toLocaleUpperCase('tr'),
          part_brand_id: null,
          mapping_status: 'PENDING',
          confidence: null
        }
      })
    }

    revalidateSupplierPaths()
    return {
      success: true,
      message: `${supplierBrand} için marka eşleştirmesi temizlendi.`
    }
  }

  const partBrand = await db.part_brands.findUnique({
    where: { id: input.partBrandId },
    select: { id: true, name: true }
  })

  if (!partBrand) {
    return { success: false, message: 'Public marka bulunamadı.' }
  }

  if (existingAlias) {
    await db.supplier_brand_aliases.update({
      where: { id: existingAlias.id },
      data: {
        supplier_brand: supplierBrand,
        normalized_brand: supplierBrand.toLocaleUpperCase('tr'),
        part_brand_id: partBrand.id,
        mapping_status: 'APPROVED',
        confidence: new Prisma.Decimal(1)
      }
    })
  } else {
    await db.supplier_brand_aliases.create({
      data: {
        provider_id: provider.id,
        supplier_brand: supplierBrand,
        normalized_brand: supplierBrand.toLocaleUpperCase('tr'),
        part_brand_id: partBrand.id,
        mapping_status: 'APPROVED',
        confidence: new Prisma.Decimal(1)
      }
    })
  }

  revalidateSupplierPaths()

  return {
    success: true,
    message: `${supplierBrand} -> ${partBrand.name} eşleştirmesi kaydedildi.`
  }
}

export async function autoMapDinamikBrandsByName(input?: {
  q?: string
  limit?: number
}) {
  await requireAdminAuth()
  const provider = await ensureDinamikProvider()

  const q = input?.q?.trim() || ''
  const limit =
    input?.limit && input.limit > 0 ? Math.min(input.limit, 5000) : 1000
  const like = `%${q}%`
  const qCondition = q ? Prisma.sql`AND d.brand ILIKE ${like}` : Prisma.sql``

  const rows = await db.$queryRaw<DinamikBrandAutoMatchRow[]>(Prisma.sql`
    SELECT
      d.brand AS supplier_brand,
      pb.id AS part_brand_id
    FROM dinamik.brands d
    JOIN part_brands pb ON LOWER(TRIM(pb.name)) = LOWER(TRIM(d.brand))
    WHERE d.brand IS NOT NULL
      AND d.brand <> ''
      ${qCondition}
    ORDER BY d.brand ASC
    LIMIT ${limit}
  `)

  if (rows.length === 0) {
    return {
      success: true,
      message: 'Otomatik marka eşleşmesi için uygun kayıt bulunamadı.',
      data: {
        scanned: 0,
        mapped: 0
      }
    }
  }

  let mapped = 0
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]

    const existingAlias = await db.supplier_brand_aliases.findFirst({
      where: {
        provider_id: provider.id,
        supplier_brand: {
          equals: row.supplier_brand,
          mode: 'insensitive'
        }
      }
    })

    if (existingAlias) {
      await db.supplier_brand_aliases.update({
        where: { id: existingAlias.id },
        data: {
          supplier_brand: row.supplier_brand,
          normalized_brand: row.supplier_brand.toLocaleUpperCase('tr'),
          part_brand_id: row.part_brand_id,
          mapping_status: 'APPROVED',
          confidence: new Prisma.Decimal(1)
        }
      })
    } else {
      await db.supplier_brand_aliases.create({
        data: {
          provider_id: provider.id,
          supplier_brand: row.supplier_brand,
          normalized_brand: row.supplier_brand.toLocaleUpperCase('tr'),
          part_brand_id: row.part_brand_id,
          mapping_status: 'APPROVED',
          confidence: new Prisma.Decimal(1)
        }
      })
    }

    mapped += 1
  }

  revalidateSupplierPaths()

  return {
    success: true,
    message: `${mapped} marka otomatik eşleştirildi.`,
    data: {
      scanned: rows.length,
      mapped
    }
  }
}

type SupplierProductListMatchState = 'all' | 'matched' | 'unmatched'
type SupplierProductListMappingStatus =
  | 'all'
  | 'approved'
  | 'ignored'
  | 'candidate'
  | 'unmatched'

interface SupplierProductListRowRaw {
  supplier_product_id: number
  query_brand: string | null
  part_no: string | null
  stock_code: string
  stock_name: string | null
  brand: string | null
  price: string | null
  currency: string | null
  barcode_1: string | null
  barcode_2: string | null
  barcode_3: string | null
  updated_at: Date | null
  supplier_stock_qty: number
  workflow_status: string | null
  mapping_status: 'QUEUE' | 'APPROVED' | 'IGNORED' | null
  matched_part_id: string | null
  matched_part_article_link_id: string | null
  matched_part_name: string | null
  matched_part_brand: string | null
}

function normalizeSupplierProductListMappingStatus(
  value: string | null | undefined
): SupplierProductListMappingStatus {
  if (value === 'approved') return 'approved'
  if (value === 'ignored') return 'ignored'
  if (value === 'candidate') return 'candidate'
  if (value === 'unmatched') return 'unmatched'
  return 'all'
}

function getSupplierProductMappingStatusConditionForDinamik(
  mappingStatus: SupplierProductListMappingStatus
) {
  if (mappingStatus === 'approved') {
    return Prisma.sql`AND spm.status = 'APPROVED'`
  }

  if (mappingStatus === 'ignored') {
    return Prisma.sql`AND spm.status = 'IGNORED'`
  }

  if (mappingStatus === 'candidate') {
    return Prisma.sql`
      AND COALESCE(spm.status, '') NOT IN ('APPROVED', 'IGNORED')
      AND (
        spm.part_id IS NOT NULL
        OR (
          d.part_no IS NOT NULL
          AND d.part_no <> ''
          AND EXISTS (
            SELECT 1
            FROM parts p
            WHERE CAST(p.part_no AS TEXT) = CAST(d.part_no AS TEXT)
            LIMIT 1
          )
        )
      )
    `
  }

  if (mappingStatus === 'unmatched') {
    return Prisma.sql`
      AND COALESCE(spm.status, '') NOT IN ('APPROVED', 'IGNORED')
      AND spm.part_id IS NULL
      AND (
        d.part_no IS NULL
        OR d.part_no = ''
        OR NOT EXISTS (
          SELECT 1
          FROM parts p
          WHERE CAST(p.part_no AS TEXT) = CAST(d.part_no AS TEXT)
          LIMIT 1
        )
      )
    `
  }

  return Prisma.sql``
}

function getSupplierProductMappingStatusCondition(
  mappingStatus: SupplierProductListMappingStatus
) {
  if (mappingStatus === 'approved') {
    return Prisma.sql`AND m.status = 'APPROVED'`
  }

  if (mappingStatus === 'ignored') {
    return Prisma.sql`AND m.status = 'IGNORED'`
  }

  if (mappingStatus === 'candidate') {
    return Prisma.sql`
      AND COALESCE(m.status, '') NOT IN ('APPROVED', 'IGNORED')
      AND m.part_id IS NOT NULL
    `
  }

  if (mappingStatus === 'unmatched') {
    return Prisma.sql`
      AND COALESCE(m.status, '') NOT IN ('APPROVED', 'IGNORED')
      AND m.part_id IS NULL
    `
  }

  return Prisma.sql``
}

function getSupplierProductMappingStatusLabel(row: SupplierProductMappingRow): string {
  if (row.mappingStatus === 'APPROVED') return 'Eşleşti'
  if (row.mappingStatus === 'IGNORED') return 'Yoksayıldı'
  if (row.matchedPart) return 'Aday'
  return 'Eşleşmeyen'
}

async function getSupplierProviderByCode(providerCode?: string) {
  await ensureDefaultProviders()

  const code = normalizeText(providerCode) || 'dinamik'
  return db.supplier_providers.findUnique({
    where: { code },
    select: { id: true, code: true, name: true }
  })
}

async function ensureSupplierProductFromDinamikRow(
  providerId: number,
  row: SupplierProductListRowRaw
) {
  const supplierName = normalizeText(row.stock_name)
  const supplierBrand = normalizeText(row.brand)
  const productKey = `${row.query_brand || 'manual'}::${row.stock_code}`
  const supplierPrice = row.price != null ? new Prisma.Decimal(row.price) : null

  const result = await db.supplier_products.upsert({
    where: {
      provider_id_supplier_sku: {
        provider_id: providerId,
        supplier_sku: row.stock_code
      }
    },
    update: {
      supplier_product_key: productKey,
      supplier_name: supplierName,
      supplier_brand: supplierBrand,
      normalized_sku: row.stock_code.replace(/[^a-zA-Z0-9]/g, '').toUpperCase(),
      normalized_name: supplierName
        ? supplierName.replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
        : null,
      barcode_1: row.barcode_1,
      barcode_2: row.barcode_2,
      barcode_3: row.barcode_3,
      supplier_price: supplierPrice,
      currency: row.currency || 'TRY',
      raw_json: {
        query_brand: row.query_brand,
        part_no: row.part_no,
        stock_code: row.stock_code,
        stock_name: row.stock_name,
        brand: row.brand,
        price: row.price,
        barcode_1: row.barcode_1,
        barcode_2: row.barcode_2,
        barcode_3: row.barcode_3
      } as Prisma.InputJsonValue,
      last_seen_at: row.updated_at || new Date()
    },
    create: {
      provider_id: providerId,
      supplier_product_key: productKey,
      supplier_sku: row.stock_code,
      supplier_name: supplierName,
      supplier_brand: supplierBrand,
      normalized_sku: row.stock_code.replace(/[^a-zA-Z0-9]/g, '').toUpperCase(),
      normalized_name: supplierName
        ? supplierName.replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
        : null,
      barcode_1: row.barcode_1,
      barcode_2: row.barcode_2,
      barcode_3: row.barcode_3,
      supplier_price: supplierPrice,
      supplier_stock_qty: 0,
      currency: row.currency || 'TRY',
      raw_json: {
        query_brand: row.query_brand,
        part_no: row.part_no,
        stock_code: row.stock_code,
        stock_name: row.stock_name,
        brand: row.brand,
        price: row.price,
        barcode_1: row.barcode_1,
        barcode_2: row.barcode_2,
        barcode_3: row.barcode_3
      } as Prisma.InputJsonValue,
      last_seen_at: row.updated_at || new Date()
    },
    select: { id: true }
  })

  return result.id
}

async function ensureSupplierProductFromDinamikStockCode(
  providerId: number,
  input: { stockCode: string; queryBrand?: string | null }
) {
  const stockCode = normalizeText(input.stockCode)
  if (!stockCode) return null

  const queryBrand = normalizeText(input.queryBrand)
  const brandCondition = queryBrand
    ? Prisma.sql`AND d.query_brand = ${queryBrand}`
    : Prisma.sql``

  const rows = await db.$queryRaw<
    Array<{
      query_brand: string | null
      part_no: string | null
      stock_code: string
      stock_name: string | null
      brand: string | null
      price: string | null
      barcode_1: string | null
      barcode_2: string | null
      barcode_3: string | null
      updated_at: Date | null
    }>
  >(Prisma.sql`
    SELECT
      d.query_brand,
      d.part_no,
      d.stock_code,
      d.stock_name,
      d.brand,
      d.price::text AS price,
      d.barcode_1,
      d.barcode_2,
      d.barcode_3,
      d.updated_at
    FROM dinamik.products d
    WHERE d.stock_code = ${stockCode}
      ${brandCondition}
    ORDER BY d.updated_at DESC
    LIMIT 1
  `)

  const source = rows[0]
  if (!source) return null

  const supplierProductId = await ensureSupplierProductFromDinamikRow(
    providerId,
    {
      supplier_product_id: 0,
      query_brand: source.query_brand,
      part_no: source.part_no,
      stock_code: source.stock_code,
      stock_name: source.stock_name,
      brand: source.brand,
      price: source.price,
      currency: 'TRY',
      barcode_1: source.barcode_1,
      barcode_2: source.barcode_2,
      barcode_3: source.barcode_3,
      updated_at: source.updated_at,
      supplier_stock_qty: 0,
      workflow_status: null,
      mapping_status: null,
      matched_part_id: null,
      matched_part_article_link_id: null,
      matched_part_name: null,
      matched_part_brand: null
    }
  )

  return supplierProductId
}

function mapSupplierProductListRow(
  provider: { id: number; code: string; name: string },
  row: SupplierProductListRowRaw
): SupplierProductMappingRow {
  return {
    supplierProductId: row.supplier_product_id,
    providerId: provider.id,
    providerCode: provider.code,
    providerName: provider.name,
    queryBrand: row.query_brand,
    partNo: row.part_no,
    stockCode: row.stock_code,
    stockName: row.stock_name,
    brand: row.brand,
    price: row.price ? toNumber(row.price, 0) : null,
    currency: row.currency || 'TRY',
    barcode1: row.barcode_1,
    barcode2: row.barcode_2,
    barcode3: row.barcode_3,
    updatedAt: row.updated_at ? row.updated_at.toISOString() : null,
    mappingStatus: row.mapping_status,
    supplierStockQty: row.supplier_stock_qty ?? 0,
    workflowStatus: row.workflow_status ?? null,
    matchedPart: row.matched_part_id
      ? {
          id: row.matched_part_id,
          articleLinkId: row.matched_part_article_link_id || '-',
          name: row.matched_part_name || '-',
          brand: row.matched_part_brand
        }
      : null
  }
}

export async function listSupplierProductsForManualMapping(input?: {
  providerCode?: string
  q?: string
  queryBrand?: string | null
  matchState?: SupplierProductListMatchState
  mappingStatus?: SupplierProductListMappingStatus
  page?: number
  limit?: number
}) {
  const [listResult, summaryResult, brandOptions] = await Promise.all([
    getSupplierProductMappingsList(input),
    getSupplierProductMappingsSummary(input),
    getSupplierProductMappingBrandOptions(input)
  ])

  return {
    success: listResult.success,
    message: listResult.message,
    provider: listResult.provider,
    rows: listResult.rows,
    pagination: listResult.pagination,
    filters: {
      providerCode: listResult.providerCode,
      q: listResult.currentQuery,
      queryBrand:
        listResult.currentBrand === 'all' ? null : listResult.currentBrand,
      matchState: listResult.currentMatchState,
      mappingStatus: listResult.currentMappingStatus
    },
    summary: summaryResult,
    options: {
      providers: listResult.providers,
      queryBrands: brandOptions
    }
  }
}

export async function getSupplierProductMappingsList(input?: {
  providerCode?: string
  q?: string
  queryBrand?: string | null
  matchState?: SupplierProductListMatchState
  mappingStatus?: SupplierProductListMappingStatus
  page?: number
  limit?: number
  allowLargeLimit?: boolean
  includeTotal?: boolean
}) {
  await requireAdminAuth()
  const provider = await getSupplierProviderByCode(input?.providerCode)
  const providerOptions = await getSupplierProviderOptionsCached()

  const q = normalizeText(input?.q) || ''
  const queryBrand = normalizeText(input?.queryBrand) || null
  const matchState = input?.matchState || 'all'
  const mappingStatus = normalizeSupplierProductListMappingStatus(
    input?.mappingStatus
  )
  const page = input?.page && input.page > 0 ? input.page : 1
  const limit =
    input?.limit && input.limit > 0
      ? Math.min(
          input.limit,
          input?.allowLargeLimit ? MAX_SUPPLIER_PRODUCT_MAPPINGS_EXPORT_ROWS : 100
        )
      : 20
  const offset = (page - 1) * limit
  const includeTotal = input?.includeTotal ?? true

  if (!provider) {
    return {
      success: false,
      message: 'Tedarikçi bulunamadı.',
      providerCode: normalizeText(input?.providerCode) || 'dinamik',
      provider: null,
      providers: providerOptions,
      rows: [] as SupplierProductMappingRow[],
      pagination: {
        page,
        limit,
        total: 0,
        pages: 1
      },
      filters: {
        providerCode: normalizeText(input?.providerCode) || 'dinamik',
        q,
        queryBrand,
        matchState,
        mappingStatus
      },
      currentQuery: q,
      currentBrand: queryBrand || 'all',
      currentMatchState: matchState,
      currentMappingStatus: mappingStatus
    }
  }

  if (provider.code === 'dinamik') {
    const like = `%${q}%`
    const brandCondition = queryBrand
      ? Prisma.sql`AND COALESCE(sp.supplier_brand, '') = ${queryBrand}`
      : Prisma.sql``
    const qCondition = q
      ? Prisma.sql`
          AND (
            COALESCE(sp.supplier_sku, '')
            || ' '
            || COALESCE(sp.supplier_name, '')
            || ' '
            || COALESCE(sp.supplier_brand, '')
            || ' '
            || COALESCE(sp.barcode_1, '')
            || ' '
            || COALESCE(sp.barcode_2, '')
            || ' '
            || COALESCE(sp.barcode_3, '')
          ) ILIKE ${like}
        `
      : Prisma.sql``

    const rowMatchCondition =
      matchState === 'matched'
        ? Prisma.sql`
            AND m.part_id IS NOT NULL
            AND m.status = 'APPROVED'
          `
        : matchState === 'unmatched'
          ? Prisma.sql`
              AND (m.part_id IS NULL OR m.status <> 'APPROVED')
            `
          : Prisma.sql``
    const rowMappingStatusCondition =
      getSupplierProductMappingStatusCondition(mappingStatus)

    let total = 0
    if (includeTotal) {
      const countRows = await db.$queryRaw<
        Array<{ total: number | string }>
      >(Prisma.sql`
        SELECT COUNT(*)::int AS total
        FROM supplier_products sp
        LEFT JOIN supplier_part_mappings m
          ON m.provider_id = sp.provider_id
         AND m.supplier_product_id = sp.id
        WHERE sp.provider_id = ${provider.id}
          ${brandCondition}
          ${qCondition}
          ${rowMatchCondition}
          ${rowMappingStatusCondition}
      `)

      total = toNumber(countRows[0]?.total, 0)
    }

    const rows = await db.$queryRaw<SupplierProductListRowRaw[]>(
      Prisma.sql`
        SELECT
          sp.id::int AS supplier_product_id,
          sp.supplier_brand AS query_brand,
          COALESCE(
            CAST((sp.raw_json ->> 'part_no') AS TEXT),
            CAST((sp.raw_json ->> 'partNo') AS TEXT),
            CAST((sp.raw_json ->> 'product_no') AS TEXT),
            CAST((sp.raw_json ->> 'productNo') AS TEXT)
          ) AS part_no,
          sp.supplier_sku AS stock_code,
          sp.supplier_name AS stock_name,
          sp.supplier_brand AS brand,
          sp.supplier_price::text AS price,
          sp.currency,
          sp.barcode_1,
          sp.barcode_2,
          sp.barcode_3,
          sp.updated_at,
          COALESCE(sp.supplier_stock_qty, 0)::int AS supplier_stock_qty,
          m.workflow_status::text AS workflow_status,
          m.status::text AS mapping_status,
          p.id::text AS matched_part_id,
          p.article_link_id::text AS matched_part_article_link_id,
          p.name AS matched_part_name,
          pb.name AS matched_part_brand
        FROM supplier_products sp
        LEFT JOIN supplier_part_mappings m
          ON m.provider_id = sp.provider_id
         AND m.supplier_product_id = sp.id
        LEFT JOIN parts p
          ON p.id = m.part_id
        LEFT JOIN part_brands pb ON pb.id = p.brand_id
        WHERE sp.provider_id = ${provider.id}
          ${brandCondition}
          ${qCondition}
          ${rowMatchCondition}
          ${rowMappingStatusCondition}
        ORDER BY sp.updated_at DESC
        LIMIT ${limit}
        OFFSET ${offset}
      `
    )

    return {
      success: true,
      message: null,
      providerCode: provider.code,
      provider,
      providers: providerOptions,
      rows: rows.map((row) => mapSupplierProductListRow(provider, row)),
      pagination: {
        page,
        limit,
        total,
        pages: includeTotal ? Math.max(1, Math.ceil(total / limit)) : 1
      },
      filters: {
        providerCode: provider.code,
        q,
        queryBrand,
        matchState,
        mappingStatus
      },
      currentQuery: q,
      currentBrand: queryBrand || 'all',
      currentMatchState: matchState,
      currentMappingStatus: mappingStatus
    }
  }

  const like = `%${q}%`
  const brandCondition = queryBrand
    ? Prisma.sql`AND COALESCE(sp.supplier_brand, '') = ${queryBrand}`
    : Prisma.sql``
  const qCondition = q
    ? Prisma.sql`
        AND (
          COALESCE(sp.supplier_sku, '')
          || ' '
          || COALESCE(sp.supplier_name, '')
          || ' '
          || COALESCE(sp.supplier_brand, '')
          || ' '
          || COALESCE(sp.barcode_1, '')
          || ' '
          || COALESCE(sp.barcode_2, '')
          || ' '
          || COALESCE(sp.barcode_3, '')
        ) ILIKE ${like}
      `
    : Prisma.sql``
  const rowMatchCondition =
    matchState === 'matched'
      ? Prisma.sql`
          AND m.part_id IS NOT NULL
          AND m.status = 'APPROVED'
      `
      : matchState === 'unmatched'
        ? Prisma.sql`
            AND (m.part_id IS NULL OR m.status <> 'APPROVED')
          `
        : Prisma.sql``
  const rowMappingStatusCondition =
    getSupplierProductMappingStatusCondition(mappingStatus)

  let total = 0
  if (includeTotal) {
    const countRows = await db.$queryRaw<Array<{ total: number | string }>>(Prisma.sql`
      SELECT COUNT(*)::int AS total
      FROM supplier_products sp
      LEFT JOIN supplier_part_mappings m
        ON m.provider_id = sp.provider_id
       AND m.supplier_product_id = sp.id
      WHERE sp.provider_id = ${provider.id}
        ${brandCondition}
        ${qCondition}
        ${rowMatchCondition}
        ${rowMappingStatusCondition}
    `)

    total = toNumber(countRows[0]?.total, 0)
  }

  const rows = await db.$queryRaw<SupplierProductListRowRaw[]>(Prisma.sql`
    SELECT
      sp.id::int AS supplier_product_id,
      sp.supplier_brand AS query_brand,
      COALESCE(
        CAST((sp.raw_json ->> 'part_no') AS TEXT),
        CAST((sp.raw_json ->> 'partNo') AS TEXT),
        CAST((sp.raw_json ->> 'product_no') AS TEXT),
        CAST((sp.raw_json ->> 'productNo') AS TEXT)
      ) AS part_no,
      sp.supplier_sku AS stock_code,
      sp.supplier_name AS stock_name,
      sp.supplier_brand AS brand,
      sp.supplier_price::text AS price,
      sp.currency,
      sp.barcode_1,
      sp.barcode_2,
      sp.barcode_3,
      sp.updated_at,
      COALESCE(sp.supplier_stock_qty, 0)::int AS supplier_stock_qty,
      m.workflow_status::text AS workflow_status,
      m.status::text AS mapping_status,
      p.id::text AS matched_part_id,
      p.article_link_id::text AS matched_part_article_link_id,
      p.name AS matched_part_name,
      pb.name AS matched_part_brand
    FROM supplier_products sp
    LEFT JOIN supplier_part_mappings m
      ON m.provider_id = sp.provider_id
     AND m.supplier_product_id = sp.id
    LEFT JOIN parts p
      ON p.id = m.part_id
    LEFT JOIN part_brands pb ON pb.id = p.brand_id
    WHERE sp.provider_id = ${provider.id}
      ${brandCondition}
      ${qCondition}
      ${rowMatchCondition}
      ${rowMappingStatusCondition}
    ORDER BY sp.updated_at DESC
    LIMIT ${limit}
    OFFSET ${offset}
  `)

  return {
    success: true,
    message: null,
    providerCode: provider.code,
    provider,
    providers: providerOptions,
    rows: rows.map((row) => mapSupplierProductListRow(provider, row)),
    pagination: {
      page,
      limit,
      total,
      pages: includeTotal ? Math.max(1, Math.ceil(total / limit)) : 1
    },
    filters: {
      providerCode: provider.code,
      q,
      queryBrand,
      matchState,
      mappingStatus
    },
    currentQuery: q,
    currentBrand: queryBrand || 'all',
    currentMatchState: matchState,
    currentMappingStatus: mappingStatus
  }
}

export async function exportSupplierProductMappingsCsv(input?: {
  providerCode?: string
  q?: string
  queryBrand?: string | null
  matchState?: SupplierProductListMatchState
  mappingStatus?: SupplierProductListMappingStatus
}): Promise<{
  success: boolean
  filename?: string
  csv?: string
  message?: string
}> {
  type CompactRow = {
    partNo: string | null
    stockCode: string
    stockName: string | null
    queryBrand: string | null
    brand: string | null
    price: number | null
    currency: string | null
    updatedAt: string | null
    mappingStatus: 'QUEUE' | 'APPROVED' | 'IGNORED' | null
    matchedPart: {
      id: string
      articleLinkId: string
      name: string
    } | null
  }

  function getSupplierProductMappingStatusLabelCompact(row: CompactRow): string {
    if (row.mappingStatus === 'APPROVED') return 'Eşleşti'
    if (row.mappingStatus === 'IGNORED') return 'Yoksayıldı'
    if (row.matchedPart) return 'Aday'
    return 'Eşleşmeyen'
  }

  const maxExportRows = MAX_SUPPLIER_PRODUCT_MAPPINGS_EXPORT_ROWS
  const batchSize = Math.min(10_000, maxExportRows)

  await requireAdminAuth()
  const provider = await getSupplierProviderByCode(input?.providerCode)

  const q = normalizeText(input?.q) || ''
  const queryBrand = normalizeText(input?.queryBrand) || null
  const matchState = input?.matchState || 'all'
  const mappingStatus = normalizeSupplierProductListMappingStatus(input?.mappingStatus)

  if (!provider) {
    return {
      success: false,
      message: 'Tedarikçi bulunamadı.'
    }
  }

  const providerNonNull = provider

  const headers = [
    'part_no',
    'stock_code',
    'stock_name',
    'updated_at',
    'brand',
    'price',
    'currency',
    'part_name',
    'part_id',
    'article_link_id',
    'durum'
  ]

  const lines = [headers.join(',')]

  async function fetchPage(
    page: number,
    limit: number,
    includeTotal: boolean
  ): Promise<{ rows: CompactRow[]; total: number }> {
    const offset = (page - 1) * limit

    if (providerNonNull.code === 'dinamik') {
      const like = `%${q}%`
      const brandCondition = queryBrand
        ? Prisma.sql`AND d.query_brand = ${queryBrand}`
        : Prisma.sql``

      const qCondition = q
        ? Prisma.sql`
            AND (
              COALESCE(d.part_no, '')
              || ' '
              || COALESCE(d.stock_code, '')
              || ' '
              || COALESCE(d.stock_name, '')
              || ' '
              || COALESCE(d.brand, '')
              || ' '
              || COALESCE(d.barcode_1, '')
            ) ILIKE ${like}
          `
        : Prisma.sql``

      const rowMatchCondition =
        matchState === 'matched'
          ? Prisma.sql`
              AND spm.part_id IS NOT NULL
              AND spm.status = 'APPROVED'
            `
          : matchState === 'unmatched'
            ? Prisma.sql`
                AND (spm.part_id IS NULL OR spm.status <> 'APPROVED')
              `
            : Prisma.sql``

      const rowMappingStatusCondition =
        getSupplierProductMappingStatusConditionForDinamik(mappingStatus)

      let total = 0
      if (includeTotal) {
        const countRows = await db.$queryRaw<Array<{ total: number | string }>>(
          Prisma.sql`
            SELECT COUNT(*)::int AS total
            FROM dinamik.products d
            LEFT JOIN supplier_part_mappings spm
              ON spm.provider_id = ${providerNonNull.id}
             AND spm.supplier_sku = d.stock_code
            WHERE 1=1
              ${brandCondition}
              ${qCondition}
              ${rowMatchCondition}
              ${rowMappingStatusCondition}
          `
        )
        total = toNumber(countRows[0]?.total, 0)
      }

      const rows = await db.$queryRaw<
        Array<{
          supplier_product_id: number
          query_brand: string | null
          part_no: string | null
          stock_code: string
          stock_name: string | null
          brand: string | null
          price: string | null
          currency: string | null
          updated_at: Date | null
          mapping_status: 'QUEUE' | 'APPROVED' | 'IGNORED' | null
          matched_part_id: string | null
          matched_part_article_link_id: string | null
          matched_part_name: string | null
        }>
      >(Prisma.sql`
        SELECT
          COALESCE(sp.id, 0)::int AS supplier_product_id,
          d.query_brand,
          d.part_no,
          d.stock_code,
          d.stock_name,
          d.brand,
          d.price::text AS price,
          COALESCE(sp.currency, 'TRY') AS currency,
          COALESCE(sp.updated_at, d.updated_at) AS updated_at,
          spm.status::text AS mapping_status,
          COALESCE(mapped.id::text, fallback.id::text) AS matched_part_id,
          COALESCE(
            mapped.article_link_id::text,
            fallback.article_link_id::text
          ) AS matched_part_article_link_id,
          COALESCE(mapped.name, fallback.name) AS matched_part_name
        FROM dinamik.products d
        LEFT JOIN supplier_products sp
          ON sp.provider_id = ${providerNonNull.id}
         AND sp.supplier_sku = d.stock_code
        LEFT JOIN supplier_part_mappings spm
          ON spm.provider_id = ${providerNonNull.id}
         AND spm.supplier_sku = d.stock_code
        LEFT JOIN LATERAL (
          SELECT
            p.id,
            p.article_link_id,
            p.name
          FROM parts p
          WHERE p.id = spm.part_id
          LIMIT 1
        ) mapped ON TRUE
        LEFT JOIN LATERAL (
          SELECT
            p.id,
            p.article_link_id,
            p.name
          FROM parts p
          WHERE spm.part_id IS NULL
            AND d.part_no IS NOT NULL
            AND d.part_no <> ''
            AND CAST(p.part_no AS TEXT) = CAST(d.part_no AS TEXT)
          ORDER BY p.updated_at DESC
          LIMIT 1
        ) fallback ON TRUE
        WHERE 1=1
          ${brandCondition}
          ${qCondition}
          ${rowMatchCondition}
          ${rowMappingStatusCondition}
        ORDER BY d.updated_at DESC
        LIMIT ${limit}
        OFFSET ${offset}
      `)

      const compactRows: CompactRow[] = rows.map((row) => ({
        partNo: row.part_no,
        stockCode: row.stock_code,
        stockName: row.stock_name,
        queryBrand: row.query_brand,
        brand: row.brand,
        price: row.price != null ? toNumber(row.price, 0) : null,
        currency: row.currency || 'TRY',
        updatedAt: row.updated_at ? row.updated_at.toISOString() : null,
        mappingStatus: row.mapping_status,
        matchedPart: row.matched_part_id
          ? {
              id: row.matched_part_id,
              articleLinkId: row.matched_part_article_link_id || '-',
              name: row.matched_part_name || '-'
            }
          : null
      }))

      return { rows: compactRows, total }
    }

    // provider.code !== 'dinamik'
    const like = `%${q}%`
    const brandCondition = queryBrand
      ? Prisma.sql`AND COALESCE(sp.supplier_brand, '') = ${queryBrand}`
      : Prisma.sql``

    const qCondition = q
      ? Prisma.sql`
          AND (
            COALESCE(sp.supplier_sku, '')
            || ' '
            || COALESCE(sp.supplier_name, '')
            || ' '
            || COALESCE(sp.supplier_brand, '')
            || ' '
            || COALESCE(sp.barcode_1, '')
            || ' '
            || COALESCE(sp.barcode_2, '')
            || ' '
            || COALESCE(sp.barcode_3, '')
          ) ILIKE ${like}
        `
      : Prisma.sql``

    const rowMatchCondition =
      matchState === 'matched'
        ? Prisma.sql`
            AND m.part_id IS NOT NULL
            AND m.status = 'APPROVED'
          `
        : matchState === 'unmatched'
          ? Prisma.sql`
              AND (m.part_id IS NULL OR m.status <> 'APPROVED')
            `
          : Prisma.sql``

    const rowMappingStatusCondition = getSupplierProductMappingStatusCondition(mappingStatus)

    let total = 0
    if (includeTotal) {
      const countRows = await db.$queryRaw<Array<{ total: number | string }>>(
        Prisma.sql`
          SELECT COUNT(*)::int AS total
          FROM supplier_products sp
          LEFT JOIN supplier_part_mappings m
            ON m.provider_id = sp.provider_id
           AND m.supplier_product_id = sp.id
          WHERE sp.provider_id = ${providerNonNull.id}
            ${brandCondition}
            ${qCondition}
            ${rowMatchCondition}
            ${rowMappingStatusCondition}
        `
      )
      total = toNumber(countRows[0]?.total, 0)
    }

    const rows = await db.$queryRaw<
      Array<{
        supplier_product_id: number
        query_brand: string | null
        part_no: string | null
        stock_code: string
        stock_name: string | null
        brand: string | null
        price: string | null
        currency: string | null
        updated_at: Date | null
        mapping_status: 'QUEUE' | 'APPROVED' | 'IGNORED' | null
        matched_part_id: string | null
        matched_part_article_link_id: string | null
        matched_part_name: string | null
      }>
    >(Prisma.sql`
      SELECT
        sp.id::int AS supplier_product_id,
        sp.supplier_brand AS query_brand,
        COALESCE(
          CAST((sp.raw_json ->> 'part_no') AS TEXT),
          CAST((sp.raw_json ->> 'partNo') AS TEXT),
          CAST((sp.raw_json ->> 'product_no') AS TEXT),
          CAST((sp.raw_json ->> 'productNo') AS TEXT)
        ) AS part_no,
        sp.supplier_sku AS stock_code,
        sp.supplier_name AS stock_name,
        sp.supplier_brand AS brand,
        sp.supplier_price::text AS price,
        sp.currency,
        sp.updated_at,
        m.status::text AS mapping_status,
        p.id::text AS matched_part_id,
        p.article_link_id::text AS matched_part_article_link_id,
        p.name AS matched_part_name
      FROM supplier_products sp
      LEFT JOIN supplier_part_mappings m
        ON m.provider_id = sp.provider_id
       AND m.supplier_product_id = sp.id
      LEFT JOIN parts p
        ON p.id = m.part_id
      WHERE sp.provider_id = ${providerNonNull.id}
        ${brandCondition}
        ${qCondition}
        ${rowMatchCondition}
        ${rowMappingStatusCondition}
      ORDER BY sp.updated_at DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `)

    const compactRows: CompactRow[] = rows.map((row) => ({
      partNo: row.part_no,
      stockCode: row.stock_code,
      stockName: row.stock_name,
      queryBrand: row.query_brand,
      brand: row.brand,
      price: row.price != null ? toNumber(row.price, 0) : null,
      currency: row.currency || 'TRY',
      updatedAt: row.updated_at ? row.updated_at.toISOString() : null,
      mappingStatus: row.mapping_status,
      matchedPart: row.matched_part_id
        ? {
            id: row.matched_part_id,
            articleLinkId: row.matched_part_article_link_id || '-',
            name: row.matched_part_name || '-'
          }
        : null
    }))

    return { rows: compactRows, total }
  }

  const firstPage = await fetchPage(1, batchSize, true)
  const totalFromFirstPage = firstPage.total

  let exportedRows = 0
  let page = 1
  let currentRows = firstPage.rows

  while (currentRows.length > 0 && exportedRows < maxExportRows) {
    for (const row of currentRows) {
      if (exportedRows >= maxExportRows) break

      const brandText = row.brand || row.queryBrand || '-'
      const priceText = row.price != null ? Number(row.price.toFixed(2)) : null

      lines.push(
        [
          row.partNo || '',
          row.stockCode,
          row.stockName || '',
          row.updatedAt || '',
          brandText,
          priceText,
          row.currency || '',
          row.matchedPart?.name || '',
          row.matchedPart?.id || '',
          row.matchedPart?.articleLinkId || '',
          getSupplierProductMappingStatusLabelCompact(row)
        ]
          .map((item) => buildSupplierMappingsCsvCell(item))
          .join(',')
      )

      exportedRows++
    }

    if (exportedRows >= maxExportRows) break

    page++
    const nextPage = await fetchPage(page, batchSize, false)
    currentRows = nextPage.rows
  }

  const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  const hasMoreRows = totalFromFirstPage > exportedRows

  return {
    success: true,
    filename: `supplier-mappings-${provider.code}-${timestamp}.csv`,
    csv: lines.join('\n'),
    message: hasMoreRows
      ? `CSV, ilk ${maxExportRows.toLocaleString('tr-TR')} kayıt ile sınırlandı.`
      : undefined
  }
}

export async function getSupplierProductMappingsSummary(input?: {
  providerCode?: string
  q?: string
  queryBrand?: string | null
  matchState?: SupplierProductListMatchState
}) {
  await requireAdminAuth()
  const provider = await getSupplierProviderByCode(input?.providerCode)
  const q = normalizeText(input?.q) || ''
  const queryBrand = normalizeText(input?.queryBrand) || null

  if (!provider) {
    return {
      total: 0,
      matched: 0,
      unmatched: 0
    }
  }

  const cacheKey = `${provider.code}::${q}::${queryBrand || ''}`
  const now = Date.now()
  const cached = supplierSummaryCache.get(cacheKey)
  if (cached && cached.expiresAt > now) {
    return cached.data
  }

  const like = `%${q}%`

  if (provider.code === 'dinamik') {
    const brandCondition = queryBrand
      ? Prisma.sql`AND COALESCE(sp.supplier_brand, '') = ${queryBrand}`
      : Prisma.sql``
    const qCondition = q
      ? Prisma.sql`
          AND (
            COALESCE(sp.supplier_sku, '')
            || ' '
            || COALESCE(sp.supplier_name, '')
            || ' '
            || COALESCE(sp.supplier_brand, '')
            || ' '
            || COALESCE(sp.barcode_1, '')
            || ' '
            || COALESCE(sp.barcode_2, '')
            || ' '
            || COALESCE(sp.barcode_3, '')
          ) ILIKE ${like}
        `
      : Prisma.sql``

    const summaryRows = await db.$queryRaw<
      Array<{ total_all: number | string; matched_total: number | string }>
    >(Prisma.sql`
      SELECT
        COUNT(*)::int AS total_all,
        COUNT(*) FILTER (
          WHERE m.part_id IS NOT NULL
            AND m.status = 'APPROVED'
        )::int AS matched_total
      FROM supplier_products sp
      LEFT JOIN supplier_part_mappings m
        ON m.provider_id = sp.provider_id
       AND m.supplier_product_id = sp.id
      WHERE sp.provider_id = ${provider.id}
        ${brandCondition}
        ${qCondition}
    `)

    const total = toNumber(summaryRows[0]?.total_all, 0)
    const matched = toNumber(summaryRows[0]?.matched_total, 0)

    const data = {
      total,
      matched,
      unmatched: Math.max(0, total - matched)
    }
    supplierSummaryCache.set(cacheKey, { expiresAt: now + SUPPLIER_SUMMARY_CACHE_TTL_MS, data })
    return data
  }

  const brandCondition = queryBrand
    ? Prisma.sql`AND COALESCE(sp.supplier_brand, '') = ${queryBrand}`
    : Prisma.sql``
  const qCondition = q
    ? Prisma.sql`
        AND (
          COALESCE(sp.supplier_sku, '')
          || ' '
          || COALESCE(sp.supplier_name, '')
          || ' '
          || COALESCE(sp.supplier_brand, '')
          || ' '
          || COALESCE(sp.barcode_1, '')
          || ' '
          || COALESCE(sp.barcode_2, '')
          || ' '
          || COALESCE(sp.barcode_3, '')
        ) ILIKE ${like}
      `
    : Prisma.sql``

  const summaryRows = await db.$queryRaw<
    Array<{ total_all: number | string; matched_total: number | string }>
  >(Prisma.sql`
    SELECT
      COUNT(*)::int AS total_all,
      COUNT(*) FILTER (
        WHERE m.part_id IS NOT NULL
          AND m.status = 'APPROVED'
      )::int AS matched_total
    FROM supplier_products sp
    LEFT JOIN supplier_part_mappings m
      ON m.provider_id = sp.provider_id
     AND m.supplier_product_id = sp.id
    WHERE sp.provider_id = ${provider.id}
      ${brandCondition}
      ${qCondition}
  `)

  const total = toNumber(summaryRows[0]?.total_all, 0)
  const matched = toNumber(summaryRows[0]?.matched_total, 0)

  const data = {
    total,
    matched,
    unmatched: Math.max(0, total - matched)
  }
  supplierSummaryCache.set(cacheKey, { expiresAt: Date.now() + SUPPLIER_SUMMARY_CACHE_TTL_MS, data })
  return data
}

export async function getSupplierProductMappingBrandOptions(input?: {
  providerCode?: string
  q?: string
  matchState?: SupplierProductListMatchState
  mappingStatus?: SupplierProductListMappingStatus
}) {
  await requireAdminAuth()
  const provider = await getSupplierProviderByCode(input?.providerCode)
  const q = normalizeText(input?.q) || ''
  const matchState = input?.matchState || 'all'
  const mappingStatus = normalizeSupplierProductListMappingStatus(
    input?.mappingStatus
  )

  if (!provider) return [] as SupplierQueryBrandOption[]

  if (!q && matchState === 'all' && mappingStatus === 'all') {
    return getSupplierQueryBrandOptionsCached(provider)
  }

  const like = `%${q}%`

  if (provider.code === 'dinamik') {
    const qCondition = q
      ? Prisma.sql`
          AND (
            COALESCE(sp.supplier_sku, '')
            || ' '
            || COALESCE(sp.supplier_name, '')
            || ' '
            || COALESCE(sp.supplier_brand, '')
            || ' '
            || COALESCE(sp.barcode_1, '')
            || ' '
            || COALESCE(sp.barcode_2, '')
            || ' '
            || COALESCE(sp.barcode_3, '')
          ) ILIKE ${like}
        `
      : Prisma.sql``

    const rowMatchCondition =
      matchState === 'matched'
        ? Prisma.sql`
            AND m.part_id IS NOT NULL
            AND m.status = 'APPROVED'
          `
        : matchState === 'unmatched'
          ? Prisma.sql`
              AND (m.part_id IS NULL OR m.status <> 'APPROVED')
            `
          : Prisma.sql``
    const rowMappingStatusCondition =
      getSupplierProductMappingStatusCondition(mappingStatus)

    const rows = await db.$queryRaw<
      Array<{ query_brand: string; product_count: number | string }>
    >(Prisma.sql`
      SELECT
        sp.supplier_brand AS query_brand,
        COUNT(*)::int AS product_count
      FROM supplier_products sp
      LEFT JOIN supplier_part_mappings m
        ON m.provider_id = sp.provider_id
       AND m.supplier_product_id = sp.id
      WHERE sp.provider_id = ${provider.id}
        AND sp.supplier_brand IS NOT NULL
        AND sp.supplier_brand <> ''
        ${qCondition}
        ${rowMatchCondition}
        ${rowMappingStatusCondition}
      GROUP BY sp.supplier_brand
      ORDER BY sp.supplier_brand ASC
    `)

    return rows.map((row) => ({
      queryBrand: row.query_brand,
      totalProducts: toNumber(row.product_count, 0)
    }))
  }

  const qCondition = q
    ? Prisma.sql`
        AND (
          COALESCE(sp.supplier_sku, '')
          || ' '
          || COALESCE(sp.supplier_name, '')
          || ' '
          || COALESCE(sp.supplier_brand, '')
          || ' '
          || COALESCE(sp.barcode_1, '')
          || ' '
          || COALESCE(sp.barcode_2, '')
          || ' '
          || COALESCE(sp.barcode_3, '')
        ) ILIKE ${like}
      `
    : Prisma.sql``

  const rowMatchCondition =
    matchState === 'matched'
      ? Prisma.sql`
          AND m.part_id IS NOT NULL
          AND m.status = 'APPROVED'
        `
      : matchState === 'unmatched'
        ? Prisma.sql`
            AND (m.part_id IS NULL OR m.status <> 'APPROVED')
          `
        : Prisma.sql``
  const rowMappingStatusCondition =
    getSupplierProductMappingStatusCondition(mappingStatus)

  const rows = await db.$queryRaw<
    Array<{ query_brand: string; product_count: number | string }>
  >(Prisma.sql`
    SELECT
      sp.supplier_brand AS query_brand,
      COUNT(*)::int AS product_count
    FROM supplier_products sp
    LEFT JOIN supplier_part_mappings m
      ON m.provider_id = sp.provider_id
     AND m.supplier_product_id = sp.id
    WHERE sp.provider_id = ${provider.id}
      AND sp.supplier_brand IS NOT NULL
      AND sp.supplier_brand <> ''
      ${qCondition}
      ${rowMatchCondition}
      ${rowMappingStatusCondition}
    GROUP BY sp.supplier_brand
    ORDER BY sp.supplier_brand ASC
  `)

  return rows.map((row) => ({
    queryBrand: row.query_brand,
    totalProducts: toNumber(row.product_count, 0)
  }))
}

function extractCodesFromUnknown(value: unknown): string[] {
  if (value == null) return []
  if (typeof value === 'string') {
    return value
      .split(/[,\n;]+/g)
      .map((item) => item.trim())
      .filter(Boolean)
  }

  if (typeof value === 'number' || typeof value === 'bigint') {
    return [String(value)]
  }

  if (Array.isArray(value)) {
    return value
      .flatMap((item) => extractCodesFromUnknown(item))
      .map((item) => item.trim())
      .filter(Boolean)
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    const keyCandidates = [
      record.code,
      record.oem,
      record.oemCode,
      record.oem_code,
      record.articleNumber,
      record.article_number,
      record.reference,
      record.references,
      record.referans,
      record.value,
      record.no,
      record.number,
      record.part_no,
      record.partNo,
      record.product_no,
      record.productNo
    ]

    const direct = keyCandidates
      .flatMap((item) => extractCodesFromUnknown(item))
      .map((item) => item.trim())
      .filter(Boolean)

    if (direct.length > 0) return direct

    const listCandidates = [
      record.items,
      record.list,
      record.rows,
      record.values,
      record.cross,
      record.crosses,
      record.references,
      record.oems,
      record.oemCodes,
      record.oem_codes
    ]

    return listCandidates
      .flatMap((item) => extractCodesFromUnknown(item))
      .map((item) => item.trim())
      .filter(Boolean)
  }

  return []
}

function extractCrossReferenceRowsFromUnknown(
  value: unknown,
  fallbackBrand: string
): Array<{ brand: string; articleNumber: string }> {
  if (value == null) return []

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') {
    return extractCodesFromUnknown(value).map((articleNumber) => ({
      brand: fallbackBrand,
      articleNumber
    }))
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) =>
      extractCrossReferenceRowsFromUnknown(item, fallbackBrand)
    )
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    const rowBrand =
      (typeof record.brand === 'string' ? normalizeText(record.brand) : null) ||
      (typeof record.marka === 'string' ? normalizeText(record.marka) : null) ||
      (typeof record.manufacturer === 'string'
        ? normalizeText(record.manufacturer)
        : null) ||
      fallbackBrand

    const directCodes = extractCodesFromUnknown(
      record.articleNumber ??
      record.article_number ??
      record.reference ??
      record.referans ??
      record.code ??
      record.value ??
      record.no ??
      record.number
    )

    if (directCodes.length > 0) {
      return directCodes.map((articleNumber) => ({
        brand: rowBrand,
        articleNumber
      }))
    }

    const nestedCandidates = [
      record.items,
      record.list,
      record.rows,
      record.cross,
      record.crosses,
      record.references,
      record.values
    ]

    return nestedCandidates.flatMap((item) =>
      extractCrossReferenceRowsFromUnknown(item, rowBrand)
    )
  }

  return []
}

function extractImageUrlsFromUnknown(value: unknown): string[] {
  if (value == null) return []

  if (typeof value === 'string') {
    const normalized = normalizeText(value)
    return normalized ? [normalized] : []
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => extractImageUrlsFromUnknown(item))
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    const direct = [
      record.image,
      record.thumb,
      record.url,
      record.src,
      record.href,
      record.imageUrl,
      record.image_url,
      record.resimUrl
    ]
      .flatMap((item) => extractImageUrlsFromUnknown(item))
      .map((item) => item.trim())
      .filter(Boolean)

    if (direct.length > 0) return direct

    const nested = [record.images, record.items, record.list, record.rows]
    return nested.flatMap((item) => extractImageUrlsFromUnknown(item))
  }

  return []
}

function extractCategoryNameFromUnknown(value: unknown): string | null {
  if (value == null) return null
  if (typeof value === 'string') return normalizeText(value)
  if (typeof value === 'number' || typeof value === 'bigint') {
    return normalizeText(String(value))
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractCategoryNameFromUnknown(item)
      if (found) return found
    }
    return null
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    return (
      (typeof record.name === 'string' ? normalizeText(record.name) : null) ||
      (typeof record.title === 'string' ? normalizeText(record.title) : null) ||
      (typeof record.category === 'string'
        ? normalizeText(record.category)
        : null) ||
      (typeof record.label === 'string' ? normalizeText(record.label) : null)
    )
  }
  return null
}

function normalizeSearchToken(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

function toCodeLikeToken(value: string): string | null {
  const normalized = normalizeSearchToken(value)
  if (!normalized) return null
  if (normalized.length < 2) return null
  if (/\s/.test(normalized)) return null

  const compact = normalized.replace(/[^0-9a-zA-Z]/g, '')
  if (compact.length < 2) return null

  if (/\d/.test(compact)) return compact
  if (compact.length >= 5) return compact

  return null
}

function normalizeOemCode(value: string | null | undefined): string | null {
  const text = normalizeText(value)
  if (!text) return null
  const compact = text.replace(/[^0-9a-zA-Z]/g, '').toUpperCase()
  return compact.length >= 2 ? compact : null
}

export async function searchPartsForSupplierMappingAdvanced(
  input: SupplierPartSearchAdvancedInput
) {
  await requireAdminAuth()
  const provider = await getSupplierProviderByCode(input.providerCode)
  if (!provider) return [] as MappingCandidate[]

  const normalizedQ = normalizeText(input.q) || ''
  const oemCodes = normalizeTextList(input.oemCodes)
  const refCodes = normalizeTextList(input.refCodes)
  const oemBrandHints = new Set<string>()

  const tokens = new Set<string>()
  if (normalizedQ) tokens.add(normalizedQ)
  for (const value of oemCodes) tokens.add(value)
  for (const value of refCodes) tokens.add(value)

  if (input.supplierProductId) {
    const supplierProduct = await db.supplier_products.findFirst({
      where: {
        id: input.supplierProductId,
        provider_id: provider.id
      },
      select: {
        supplier_sku: true,
        supplier_name: true,
        supplier_brand: true,
        barcode_1: true,
        barcode_2: true,
        barcode_3: true,
        raw_json: true
      }
    })

    if (supplierProduct) {
      const supplierBrand = normalizeText(supplierProduct.supplier_brand)
      if (supplierBrand) {
        oemBrandHints.add(supplierBrand)
      }

      const seedValues = [
        supplierProduct.supplier_sku,
        supplierProduct.supplier_name,
        supplierProduct.supplier_brand,
        supplierProduct.barcode_1,
        supplierProduct.barcode_2,
        supplierProduct.barcode_3
      ]
      for (const value of seedValues) {
        const normalized = normalizeText(value)
        if (normalized) tokens.add(normalized)
      }

      if (
        supplierProduct.raw_json &&
        typeof supplierProduct.raw_json === 'object' &&
        !Array.isArray(supplierProduct.raw_json)
      ) {
        const raw = supplierProduct.raw_json as Record<string, unknown>
        const rawValues = [
          raw.part_no,
          raw.stock_code,
          raw.barcode_1,
          raw.barcode_2,
          raw.barcode_3
        ]
        for (const value of rawValues) {
          for (const code of extractCodesFromUnknown(value)) {
            const normalized = normalizeText(code)
            if (normalized) tokens.add(normalized)
          }
        }
      }

      const supplierProductOems = getSupplierProductOemsDelegate()
      let supplierOemRows: Array<{ oem_code: string; oem_brand: string | null }> = []
      if (supplierProductOems) {
        try {
          supplierOemRows = await supplierProductOems.findMany({
            where: {
              provider_id: provider.id,
              supplier_product_id: input.supplierProductId,
              is_active: true
            },
            select: {
              oem_code: true,
              oem_brand: true
            },
            take: 120,
            orderBy: { updated_at: 'desc' }
          })
        } catch (error) {
          if (!isMissingSupplierProductOemsTableError(error)) {
            throw error
          }
          supplierOemRows = []
        }
      }

      for (const row of supplierOemRows) {
        const normalizedCode = normalizeOemCode(row.oem_code)
        if (normalizedCode) tokens.add(normalizedCode)
        const normalizedBrand = normalizeText(row.oem_brand)
        if (normalizedBrand) oemBrandHints.add(normalizedBrand)
      }
    }
  }

  const tokenList = Array.from(tokens)
    .map((token) => normalizeSearchToken(token))
    .filter((token) => token.length >= 2)
    .slice(0, 12)

  const codeTokens = Array.from(
    new Set(
      tokenList
        .map((token) => toCodeLikeToken(token))
        .filter((token): token is string => Boolean(token))
    )
  ).slice(0, 8)
  const numericTokens = codeTokens.filter((token) => /^\d+$/.test(token))

  const caseVariants = (values: string[]) =>
    Array.from(
      new Set(
        values.flatMap((value) => [
          value,
          value.toLocaleUpperCase('tr'),
          value.toLocaleLowerCase('tr')
        ])
      )
    )

  const codeTokenVariants = caseVariants(codeTokens)
  const oemBrandVariants = new Set(
    caseVariants(Array.from(oemBrandHints)).map((item) =>
      item.toLocaleUpperCase('tr')
    )
  )
  const normalizedQName = normalizeText(input.q)

  if (
    tokenList.length === 0 &&
    codeTokenVariants.length === 0 &&
    !normalizedQName
  ) {
    return [] as MappingCandidate[]
  }

  const limit = input.limit && input.limit > 0 ? Math.min(input.limit, 40) : 20
  try {
    const candidateCap = Math.max(limit * 4, 80)

    const scoreMap = new Map<string, { score: number; reasons: Set<string> }>()

    const addScore = (partId: string, score: number, reason: string) => {
      const existing = scoreMap.get(partId)
      if (existing) {
        existing.score += score
        existing.reasons.add(reason)
        return
      }

      scoreMap.set(partId, {
        score,
        reasons: new Set([reason])
      })
    }

    const exactQueries: Promise<void>[] = []

    if (numericTokens.length > 0) {
      exactQueries.push(
        db
          .$queryRaw<Array<{ id: string }>>(
            Prisma.sql`
            SELECT p.id::text AS id
            FROM parts p
            WHERE CAST(p.part_no AS TEXT) IN (${Prisma.join(
              numericTokens.map((token) => Prisma.sql`${token}`),
              ','
            )})
               OR CAST(p.article_link_id AS TEXT) IN (${Prisma.join(
                 numericTokens.map((token) => Prisma.sql`${token}`),
                 ','
               )})
               OR CAST(p.id AS TEXT) IN (${Prisma.join(
                 numericTokens.map((token) => Prisma.sql`${token}`),
                 ','
               )})
            ORDER BY p.updated_at DESC
            LIMIT ${candidateCap}
          `
          )
          .then((rows) => {
            for (const row of rows) addScore(row.id, 0.9, 'part_exact')
          })
      )
    }

    if (codeTokenVariants.length > 0) {
      exactQueries.push(
        db
          .$queryRaw<Array<{ id: string; oem_brand: string | null }>>(
            Prisma.sql`
            SELECT DISTINCT
              po.part_id::text AS id,
              po.brand AS oem_brand
            FROM part_oens po
            WHERE po.code IN (${Prisma.join(
              codeTokenVariants.map((token) => Prisma.sql`${token}`),
              ','
            )})
            LIMIT ${candidateCap}
          `
          )
          .then((rows) => {
            for (const row of rows) {
              addScore(row.id, 0.75, 'oem_exact')
              const oemBrand = normalizeText(row.oem_brand)?.toLocaleUpperCase('tr')
              if (oemBrand && oemBrandVariants.has(oemBrand)) {
                addScore(row.id, 0.08, 'oem_brand')
              }
            }
          })
      )

      exactQueries.push(
        db
          .$queryRaw<Array<{ id: string }>>(
            Prisma.sql`
            SELECT DISTINCT pcr.part_id::text AS id
            FROM part_cross_references pcr
            WHERE pcr.article_number IN (${Prisma.join(
              codeTokenVariants.map((token) => Prisma.sql`${token}`),
              ','
            )})
               OR pcr.brand_name IN (${Prisma.join(
                 codeTokenVariants.map((token) => Prisma.sql`${token}`),
                 ','
               )})
            LIMIT ${candidateCap}
          `
          )
          .then((rows) => {
            for (const row of rows) addScore(row.id, 0.68, 'cross_exact')
          })
      )

      exactQueries.push(
        db
          .$queryRaw<Array<{ id: string }>>(
            Prisma.sql`
            SELECT DISTINCT pe.part_id::text AS id
            FROM part_eans pe
            WHERE pe.code IN (${Prisma.join(
              codeTokenVariants.map((token) => Prisma.sql`${token}`),
              ','
            )})
            LIMIT ${candidateCap}
          `
          )
          .then((rows) => {
            for (const row of rows) addScore(row.id, 0.82, 'ean_exact')
          })
      )
    }

    if (exactQueries.length > 0) {
      await Promise.all(exactQueries)
    }

    if (scoreMap.size < limit && numericTokens.length > 0) {
      const prefixNumeric = numericTokens
        .filter((token) => token.length >= 4)
        .slice(0, 2)
        .map((token) => `${token}%`)

      if (prefixNumeric.length > 0) {
        const partPrefixConditions = prefixNumeric.flatMap((like) => [
          Prisma.sql`CAST(p.part_no AS TEXT) LIKE ${like}`,
          Prisma.sql`CAST(p.article_link_id AS TEXT) LIKE ${like}`,
          Prisma.sql`CAST(p.id AS TEXT) LIKE ${like}`
        ])

        const rows = await db.$queryRaw<Array<{ id: string }>>(
          Prisma.sql`
            SELECT p.id::text AS id
            FROM parts p
            WHERE ${Prisma.join(partPrefixConditions, ' OR ')}
            ORDER BY p.updated_at DESC
            LIMIT ${candidateCap}
          `
        )

        for (const row of rows) addScore(row.id, 0.25, 'part_prefix')
      }
    }

    if (
      scoreMap.size < limit &&
      normalizedQName &&
      normalizedQName.length >= 3
    ) {
      const fuzzyLike = `%${normalizedQName}%`
      const rows = await db.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`
          SELECT p.id::text AS id
          FROM parts p
          WHERE p.name ILIKE ${fuzzyLike}
          ORDER BY p.updated_at DESC
          LIMIT ${candidateCap}
        `
      )
      for (const row of rows) addScore(row.id, 0.2, 'name_fuzzy')
    }

    if (scoreMap.size === 0) {
      return [] as MappingCandidate[]
    }

    const rankedIds = Array.from(scoreMap.entries())
      .sort((a, b) => b[1].score - a[1].score)
      .slice(0, candidateCap)
      .map(([id]) => id)

    const partRows = await db.$queryRaw<
      Array<{
        id: string
        article_link_id: string
        part_no: string | null
        name: string
        brand_name: string | null
        updated_at: Date
      }>
    >(Prisma.sql`
      SELECT
        p.id::text AS id,
        p.article_link_id::text AS article_link_id,
        CAST(p.part_no AS TEXT) AS part_no,
        p.name,
        b.name AS brand_name,
        p.updated_at
      FROM parts p
      LEFT JOIN part_brands b ON b.id = p.brand_id
      WHERE CAST(p.id AS TEXT) IN (${Prisma.join(
        rankedIds.map((id) => Prisma.sql`${id}`),
        ','
      )})
      ORDER BY p.updated_at DESC
      LIMIT ${candidateCap}
    `)

    const rowMap = new Map(partRows.map((row) => [row.id, row]))

    const resolved = rankedIds
      .map((id) => {
        const row = rowMap.get(id)
        const scored = scoreMap.get(id)
        if (!row || !scored) return null

        let confidence = Math.min(0.95, 0.2 + scored.score)
        const normalizedPartNo = normalizeText(row.part_no)
        if (
          normalizedPartNo &&
          tokenList.some(
            (token) =>
              token.toLocaleLowerCase('tr') ===
              normalizedPartNo.toLocaleLowerCase('tr')
          )
        ) {
          confidence = Math.min(0.99, confidence + 0.12)
        }

        return {
          partId: row.id,
          articleLinkId: row.article_link_id,
          partNo: row.part_no,
          name: row.name,
          brand: row.brand_name,
          confidence,
          reasons: Array.from(scored.reasons)
        }
      })
      .filter((item) => item !== null)

    return resolved.slice(0, limit) as MappingCandidate[]
  } catch (error) {
    console.error('[supplier-mapping] advanced part search failed:', error)
    return [] as MappingCandidate[]
  }
}

export async function manualMapSupplierProductToPart(input: {
  providerCode: string
  supplierProductId: number
  partId: string
  note?: string | null
}) {
  const userId = await getAdminUserId()
  const provider = await getSupplierProviderByCode(input.providerCode)

  if (!provider) {
    return { success: false, message: 'Tedarikçi bulunamadı.' }
  }

  let partId: bigint
  try {
    partId = BigInt(input.partId)
  } catch {
    return { success: false, message: 'Geçersiz part_id.' }
  }

  const [part, supplierProduct] = await Promise.all([
    db.parts.findUnique({
      where: { id: partId },
      select: { id: true }
    }),
    db.supplier_products.findFirst({
      where: {
        id: input.supplierProductId,
        provider_id: provider.id
      }
    })
  ])

  if (!part) {
    return { success: false, message: 'Public part bulunamadı.' }
  }

  if (!supplierProduct) {
    return { success: false, message: 'Supplier ürün bulunamadı.' }
  }

  await db.$transaction(async (tx) => {
    if (supplierProduct.supplier_brand) {
      const existingAlias = await tx.supplier_brand_aliases.findFirst({
        where: {
          provider_id: provider.id,
          supplier_brand: supplierProduct.supplier_brand
        }
      })

      if (!existingAlias) {
        const partBrand = await tx.part_brands.findFirst({
          where: {
            name: {
              equals: supplierProduct.supplier_brand,
              mode: 'insensitive'
            }
          },
          select: { id: true }
        })

        await tx.supplier_brand_aliases.create({
          data: {
            provider_id: provider.id,
            supplier_brand: supplierProduct.supplier_brand,
            normalized_brand:
              supplierProduct.supplier_brand.toLocaleUpperCase('tr'),
            part_brand_id: partBrand?.id ?? null,
            mapping_status: partBrand ? 'APPROVED' : 'PENDING',
            confidence: partBrand ? new Prisma.Decimal(1) : null
          }
        })
      }
    }

    await tx.supplier_part_mappings.upsert({
      where: {
        provider_id_supplier_product_id: {
          provider_id: provider.id,
          supplier_product_id: supplierProduct.id
        }
      },
      update: {
        supplier_sku: supplierProduct.supplier_sku,
        part_id: partId,
        status: 'APPROVED',
        workflow_status: 'MATCHED_EXISTING',
        confidence: new Prisma.Decimal(1),
        match_reason: normalizeText(input.note) || 'manuel:supplier-products',
        is_manual: true,
        approved_by: userId,
        approved_at: new Date(),
        ignored_reason: null
      },
      create: {
        provider_id: provider.id,
        supplier_product_id: supplierProduct.id,
        supplier_sku: supplierProduct.supplier_sku,
        part_id: partId,
        status: 'APPROVED',
        workflow_status: 'MATCHED_EXISTING',
        confidence: new Prisma.Decimal(1),
        match_reason: normalizeText(input.note) || 'manuel:supplier-products',
        is_manual: true,
        approved_by: userId,
        approved_at: new Date()
      }
    })

    await tx.part_supplier_offers.upsert({
      where: {
        provider_id_supplier_product_id: {
          provider_id: provider.id,
          supplier_product_id: supplierProduct.id
        }
      },
      update: {
        part_id: partId,
        supplier_price: supplierProduct.supplier_price,
        supplier_stock_qty: supplierProduct.supplier_stock_qty,
        currency: supplierProduct.currency,
        is_active: true,
        last_synced_at: new Date()
      },
      create: {
        provider_id: provider.id,
        supplier_product_id: supplierProduct.id,
        part_id: partId,
        supplier_price: supplierProduct.supplier_price,
        supplier_stock_qty: supplierProduct.supplier_stock_qty,
        currency: supplierProduct.currency,
        is_active: true,
        last_synced_at: new Date()
      }
    })

    await ensureSupplierMappingCrossReference({
      tx,
      partId,
      providerCode: provider.code,
      supplierSku: supplierProduct.supplier_sku
    })
  })

  await applyPolicyForPart(partId)
  revalidateSupplierPaths()

  return {
    success: true,
    message: `${supplierProduct.supplier_sku} -> part #${partId.toString()} eşleşmesi kaydedildi.`
  }
}

export async function saveSupplierProductManualOems(input: {
  providerCode: string
  supplierProductId: number
  oemCodes: string[]
  oemBrand?: string | null
}) {
  await requireAdminAuth()

  const provider = await getSupplierProviderByCode(input.providerCode)
  if (!provider) {
    return { success: false, message: 'Tedarikçi bulunamadı.' }
  }

  const supplierProduct = await db.supplier_products.findFirst({
    where: {
      id: input.supplierProductId,
      provider_id: provider.id
    },
    select: {
      id: true,
      supplier_sku: true,
      supplier_brand: true,
      supplier_price: true,
      supplier_stock_qty: true,
      currency: true
    }
  })

  if (!supplierProduct) {
    return { success: false, message: 'Supplier ürün bulunamadı.' }
  }

  if (!getSupplierProductOemsDelegate()) {
    return { success: false, message: PRISMA_GENERATE_HINT }
  }

  const normalizedRows = Array.from(
    new Map(
      (input.oemCodes || [])
        .map((code) => normalizeText(code))
        .filter((code): code is string => Boolean(code))
        .map((code) => {
          const normalizedCode = normalizeOemCode(code)
          if (!normalizedCode) return null
          return [
            normalizedCode,
            {
              oem_code: code,
              normalized_oem_code: normalizedCode
            }
          ] as const
        })
        .filter(
          (
            entry
          ): entry is readonly [
            string,
            { oem_code: string; normalized_oem_code: string }
          ] => Boolean(entry)
        )
    ).values()
  )

  if (normalizedRows.length === 0) {
    return {
      success: false,
      message: 'Geçerli OEM kodu bulunamadı.'
    }
  }

  const oemBrand =
    normalizeText(input.oemBrand) || normalizeText(supplierProduct.supplier_brand)

  try {
    await db.$transaction(async (tx) => {
      await tx.supplier_product_oems.updateMany({
        where: {
          provider_id: provider.id,
          supplier_product_id: supplierProduct.id,
          source: 'MANUAL'
        },
        data: { is_active: false }
      })

      for (const row of normalizedRows) {
        await tx.supplier_product_oems.upsert({
          where: {
            provider_id_supplier_product_id_normalized_oem_code_source: {
              provider_id: provider.id,
              supplier_product_id: supplierProduct.id,
              normalized_oem_code: row.normalized_oem_code,
              source: 'MANUAL'
            }
          },
          update: {
            oem_code: row.oem_code,
            oem_brand: oemBrand,
            is_active: true
          },
          create: {
            provider_id: provider.id,
            supplier_product_id: supplierProduct.id,
            oem_code: row.oem_code,
            normalized_oem_code: row.normalized_oem_code,
            oem_brand: oemBrand,
            source: 'MANUAL',
            is_active: true
          }
        })
      }
    })
  } catch (error) {
    if (isMissingSupplierProductOemsTableError(error)) {
      return { success: false, message: PRISMA_GENERATE_HINT }
    }
    throw error
  }

  // --- Auto-match or create part ---
  const autoMatchResult = await autoMatchOrCreatePartAfterOemSave({
    provider,
    supplierProduct,
    normalizedRows,
    oemBrand
  })

  if (autoMatchResult.matched) {
    const action = autoMatchResult.created ? 'Yeni parça oluşturuldu' : 'Mevcut parçaya eşleştirildi'
    return {
      success: true,
      message: `${normalizedRows.length} OEM kodu kaydedildi. ${action}: ${autoMatchResult.partBrand || ''} ${autoMatchResult.partName || ''} (${autoMatchResult.reason})`.trim(),
      data: {
        count: normalizedRows.length,
        autoMatch: autoMatchResult
      }
    }
  }

  return {
    success: true,
    message: `${normalizedRows.length} OEM kodu kaydedildi.`,
    data: {
      count: normalizedRows.length,
      autoMatch: null
    }
  }
}

export async function getSupplierProductMappingDetail(input: {
  providerCode: string
  supplierProductId?: number | null
  stockCode?: string | null
  queryBrand?: string | null
  includeOptions?: boolean
  includeFallbackPart?: boolean
}): Promise<{
  success: boolean
  message?: string
  data?: SupplierProductMappingDetail
}> {
  await requireAdminAuth()
  const provider = await getSupplierProviderByCode(input.providerCode)

  if (!provider) {
    return { success: false, message: 'Tedarikçi bulunamadı.' }
  }

  let supplierProductId =
    typeof input.supplierProductId === 'number' && input.supplierProductId > 0
      ? input.supplierProductId
      : null

  if (!supplierProductId) {
    const stockCode = normalizeText(input.stockCode)

    if (provider.code === 'dinamik' && stockCode) {
      supplierProductId = await ensureSupplierProductFromDinamikStockCode(
        provider.id,
        {
          stockCode,
          queryBrand: input.queryBrand
        }
      )
    } else if (stockCode) {
      const existingSupplierProduct = await db.supplier_products.findFirst({
        where: {
          provider_id: provider.id,
          supplier_sku: stockCode
        },
        select: { id: true }
      })
      supplierProductId = existingSupplierProduct?.id ?? null
    }
  }

  if (!supplierProductId) {
    return { success: false, message: 'Supplier ürün bulunamadı.' }
  }

  const supplierProduct = await db.supplier_products.findFirst({
    where: {
      id: supplierProductId,
      provider_id: provider.id
    },
    include: {
      supplier_part_mappings: {
        where: { provider_id: provider.id },
        include: {
          parts: {
            include: {
              part_brands: {
                select: { name: true }
              }
            }
          }
        },
        orderBy: { updated_at: 'desc' },
        take: 1
      }
    }
  })

  if (!supplierProduct) {
    return { success: false, message: 'Supplier ürün bulunamadı.' }
  }

  const includeOptions = input.includeOptions === true
  const includeFallbackPart = input.includeFallbackPart === true

  const mappingOptions = includeOptions
    ? await getSupplierMappingCreationOptions(provider)
    : null

  const supplierBrands = normalizeTextList(
    includeOptions
      ? [
          ...(mappingOptions?.supplierBrands || []),
          supplierProduct.supplier_brand || ''
        ]
      : [supplierProduct.supplier_brand || '']
  )

  const mapping = supplierProduct.supplier_part_mappings[0] || null
  const referenceClone =
    mapping?.part_id != null
      ? await db.part_reference_links.findUnique({
          where: { derived_part_id: mapping.part_id },
          select: {
            derived_part_id: true,
            source_part_id: true,
            relation_type: true,
            copy_mode: true,
            is_active: true
          }
        })
      : null
  const raw =
    supplierProduct.raw_json && typeof supplierProduct.raw_json === 'object'
      ? (supplierProduct.raw_json as Record<string, unknown>)
      : {}
  const supplierProductOems = getSupplierProductOemsDelegate()
  if (!supplierProductOems) {
    return { success: false, message: PRISMA_GENERATE_HINT }
  }

  let supplierOemRows: Array<{ oem_code: string; source: string }> = []
  try {
    supplierOemRows = await supplierProductOems.findMany({
      where: {
        provider_id: provider.id,
        supplier_product_id: supplierProduct.id,
        is_active: true
      },
      select: {
        oem_code: true,
        source: true
      },
      orderBy: { updated_at: 'desc' }
    })
  } catch (error) {
    if (isMissingSupplierProductOemsTableError(error)) {
      return { success: false, message: PRISMA_GENERATE_HINT }
    }
    throw error
  }

  const manualOemCodes = normalizeTextList(
    supplierOemRows
      .filter((r) => r.source === 'MANUAL')
      .map((r) => r.oem_code)
  )

  const rawPartNo = normalizeText(String(raw.part_no || ''))
  let fallbackPart: {
    id: string
    article_link_id: string
    name: string
    brand_name: string | null
  } | null = null

  if (!mapping?.part_id && rawPartNo && includeFallbackPart) {
    const fallbackRows = await db.$queryRaw<
      Array<{
        id: string
        article_link_id: string
        name: string
        brand_name: string | null
      }>
    >(Prisma.sql`
      SELECT
        p.id::text AS id,
        p.article_link_id::text AS article_link_id,
        p.name,
        b.name AS brand_name
      FROM parts p
      LEFT JOIN part_brands b ON b.id = p.brand_id
      WHERE CAST(p.part_no AS TEXT) = ${rawPartNo}
      ORDER BY p.updated_at DESC
      LIMIT 1
    `)
    fallbackPart = fallbackRows[0] || null
  }

  const matchedPart = mapping?.parts
    ? {
        id: mapping.parts.id.toString(),
        articleLinkId: mapping.parts.article_link_id.toString(),
        name: mapping.parts.name,
        brand: mapping.parts.part_brands?.name || null
      }
    : fallbackPart
      ? {
          id: fallbackPart.id,
          articleLinkId: fallbackPart.article_link_id,
          name: fallbackPart.name,
          brand: fallbackPart.brand_name
        }
      : null

  const row: SupplierProductMappingRow = {
    supplierProductId: supplierProduct.id,
    providerId: provider.id,
    providerCode: provider.code,
    providerName: provider.name,
    queryBrand:
      normalizeText(String(raw.query_brand || '')) ||
      supplierProduct.supplier_brand,
    partNo: rawPartNo,
    stockCode: supplierProduct.supplier_sku,
    stockName: supplierProduct.supplier_name,
    brand: supplierProduct.supplier_brand,
    price: mapSupplierProductPrice(supplierProduct.supplier_price),
    currency: supplierProduct.currency,
    barcode1: supplierProduct.barcode_1,
    barcode2: supplierProduct.barcode_2,
    barcode3: supplierProduct.barcode_3,
    updatedAt: supplierProduct.updated_at.toISOString(),
    mappingStatus:
      (mapping?.status as 'QUEUE' | 'APPROVED' | 'IGNORED' | null) || null,
    supplierStockQty: supplierProduct.supplier_stock_qty,
    workflowStatus: mapping?.workflow_status
      ? mapWorkflowStatus(mapping.workflow_status)
      : null,
    matchedPart
  }

  const suggestedOemCodes = normalizeTextList(
    [
      ...supplierOemRows.map((row) => row.oem_code),
      ...extractCodesFromUnknown(raw.oem),
      ...extractCodesFromUnknown(raw.oem_codes),
      ...extractCodesFromUnknown(raw.oemCodes),
      ...extractCodesFromUnknown(raw.oem_kodlari),
      ...extractCodesFromUnknown(raw.oemKodlari)
    ].slice(0, 30)
  )

  const suggestedRefCodes = normalizeTextList(
    [
      ...extractCodesFromUnknown(raw.referans),
      ...extractCodesFromUnknown(raw.reference),
      ...extractCodesFromUnknown(raw.references),
      ...extractCodesFromUnknown(raw.cross),
      ...extractCodesFromUnknown(raw.crossReferences),
      ...extractCodesFromUnknown(raw.part_no)
    ].slice(0, 30)
  )

  const suggestedQuery =
    normalizeText(row.partNo) ||
    normalizeText(row.stockCode) ||
    normalizeText(row.stockName) ||
    normalizeText(row.barcode1) ||
    ''

  return {
    success: true,
    data: {
      provider,
      row,
      supplierProduct: {
        id: supplierProduct.id,
        key: supplierProduct.supplier_product_key,
        sku: supplierProduct.supplier_sku,
        name: supplierProduct.supplier_name,
        brand: supplierProduct.supplier_brand,
        price: mapSupplierProductPrice(supplierProduct.supplier_price),
        currency: supplierProduct.currency,
        stockQty: supplierProduct.supplier_stock_qty,
        barcode1: supplierProduct.barcode_1,
        barcode2: supplierProduct.barcode_2,
        barcode3: supplierProduct.barcode_3,
        regionalStock: getRegionalStockFromRawJson(supplierProduct.raw_json),
        lastSeenAt: supplierProduct.last_seen_at.toISOString(),
        rawJson: supplierProduct.raw_json
      },
      mapping: mapping
        ? {
            id: mapping.id,
            status: mapping.status as 'QUEUE' | 'APPROVED' | 'IGNORED',
            workflowStatus: mapWorkflowStatus(mapping.workflow_status),
            confidence: mapping.confidence
              ? Number(mapping.confidence.toString())
              : null,
            matchReason: mapping.match_reason,
            isManual: mapping.is_manual,
            partId: mapping.part_id ? mapping.part_id.toString() : null
          }
        : null,
      referenceClone: referenceClone
        ? {
            partId: referenceClone.derived_part_id.toString(),
            sourcePartId: referenceClone.source_part_id.toString(),
            relationType: referenceClone.relation_type,
            copyMode: referenceClone.copy_mode,
            isActive: referenceClone.is_active
          }
        : null,
      suggestedQuery,
      suggestedOemCodes,
      suggestedRefCodes,
      manualOemCodes,
      options: {
        brands: mappingOptions?.brands || [],
        supplierBrands,
        categories: mappingOptions?.categories || []
      }
    }
  }
}

function mapVehicleTypeLabel(link: {
  vehicle_type_id: number
  vehicle_types: {
    name: string
    vehicle_models: {
      name: string
      vehicle_brands: { name: string }
    } | null
  } | null
}) {
  const brandName = link.vehicle_types?.vehicle_models?.vehicle_brands?.name
  const modelName = link.vehicle_types?.vehicle_models?.name
  const typeName = link.vehicle_types?.name

  return (
    [brandName, modelName, typeName].filter(Boolean).join(' / ') ||
    String(link.vehicle_type_id)
  )
}

function mapPartReferenceLinkRow(
  row: {
    id: bigint
    source_part_id: bigint
    derived_part_id: bigint
    provider_id: number
    supplier_product_id: number
    relation_type: string
    copy_mode: string
    created_by: string | null
    is_active: boolean
    created_at: Date
    updated_at: Date
  } | null
): PartReferenceLink | null {
  if (!row) return null

  return {
    id: row.id.toString(),
    sourcePartId: row.source_part_id.toString(),
    derivedPartId: row.derived_part_id.toString(),
    providerId: row.provider_id,
    supplierProductId: row.supplier_product_id,
    relationType: row.relation_type,
    copyMode: row.copy_mode,
    createdBy: row.created_by,
    isActive: row.is_active,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  }
}

async function loadReferenceClonePart(partId: bigint) {
  return db.parts.findUnique({
    where: { id: partId },
    include: {
      part_pricing_inventory: true,
      part_admin_overrides: true,
      part_eans: { select: { code: true } },
      part_oens: { select: { brand: true, code: true } },
      part_cross_references: {
        select: { brand_name: true, article_number: true }
      },
      part_properties: { select: { key: true, value: true } },
      part_infos: { select: { content: true } },
      part_images: { select: { image: true, thumb: true } },
      part_documents: {
        select: {
          id: true,
          doc_file_name: true,
          doc_file_type_name: true,
          doc_id: true,
          doc_type_id: true,
          doc_type_name: true,
          doc_url: true
        }
      },
      part_vehicle_types: {
        select: {
          vehicle_type_id: true,
          vehicle_types: {
            select: {
              name: true,
              vehicle_models: {
                select: {
                  name: true,
                  vehicle_brands: { select: { name: true } }
                }
              }
            }
          }
        }
      },
      part_brands: { select: { id: true, name: true } },
      part_categories: { select: { id: true, name: true } }
    }
  })
}

async function buildSupplierReferenceCloneDraftData(input: {
  providerCode: string
  supplierProductId: number
  sourcePartId?: string | null
  partId?: string | null
}) {
  const provider = await getSupplierProviderByCode(input.providerCode)
  if (!provider) {
    return { error: 'Tedarikçi bulunamadı.' } as const
  }

  const supplierProduct = await db.supplier_products.findFirst({
    where: {
      id: input.supplierProductId,
      provider_id: provider.id
    }
  })

  if (!supplierProduct) {
    return { error: 'Supplier ürün bulunamadı.' } as const
  }

  const existingPartId = parsePositiveBigInt(input.partId)
  const requestedSourcePartId = parsePositiveBigInt(input.sourcePartId)

  let referenceLink = existingPartId
    ? await db.part_reference_links.findUnique({
        where: { derived_part_id: existingPartId }
      })
    : await db.part_reference_links.findFirst({
        where: {
          provider_id: provider.id,
          supplier_product_id: supplierProduct.id,
          is_active: true
        },
        orderBy: { updated_at: 'desc' }
      })

  if (
    referenceLink &&
    existingPartId &&
    referenceLink.derived_part_id !== existingPartId
  ) {
    referenceLink = null
  }

  const sourcePartId =
    referenceLink?.source_part_id ?? requestedSourcePartId ?? null
  if (!sourcePartId) {
    return { error: 'Referans alınacak kaynak part seçin.' } as const
  }

  const [sourcePart, derivedPart] = await Promise.all([
    loadReferenceClonePart(sourcePartId),
    referenceLink
      ? loadReferenceClonePart(referenceLink.derived_part_id)
      : Promise.resolve(null)
  ])

  if (!sourcePart) {
    return { error: 'Referans public part bulunamadı.' } as const
  }

  const raw =
    supplierProduct.raw_json &&
    typeof supplierProduct.raw_json === 'object' &&
    !Array.isArray(supplierProduct.raw_json)
      ? (supplierProduct.raw_json as Record<string, unknown>)
      : {}

  const rawPartNo =
    (typeof raw.part_no === 'string' ? normalizeText(raw.part_no) : null) ||
    (typeof raw.partNo === 'string' ? normalizeText(raw.partNo) : null) ||
    (typeof raw.product_no === 'string' ? normalizeText(raw.product_no) : null) ||
    (typeof raw.productNo === 'string' ? normalizeText(raw.productNo) : null)
  const brandResolution = await resolveSupplierBrandAlias({
    providerId: provider.id,
    supplierBrand: supplierProduct.supplier_brand,
    sourceBrandId: sourcePart.brand_id
  })
  const mappingOptions = await getSupplierMappingCreationOptions(provider)
  const supplierRawCategoryName =
    extractCategoryNameFromUnknown(raw.category) ||
    extractCategoryNameFromUnknown(raw.category_name) ||
    extractCategoryNameFromUnknown(raw.categoryName)
  const matchedSupplierCategory =
    supplierRawCategoryName
      ? mappingOptions.categories.find(
          (category) =>
            category.name.trim().toLocaleLowerCase('tr') ===
            supplierRawCategoryName.trim().toLocaleLowerCase('tr')
        ) || null
      : null

  const basePart = derivedPart ?? sourcePart
  const basePricing = basePart.part_pricing_inventory
  const baseOverrides = basePart.part_admin_overrides
  const sourceBrandName = sourcePart.part_brands?.name ?? null
  const supplierBrandName =
    normalizeText(supplierProduct.supplier_brand) || sourceBrandName || ''

  const eans = normalizeStringArray(basePart.part_eans.map((item) => item.code))
  const oemReferences = normalizeReferenceRows(
    [
      ...basePart.part_oens.map((item) => ({
        brand: item.brand,
        code: item.code
      })),
      ...extractCodesFromUnknown(raw.oem)
        .concat(
          extractCodesFromUnknown(raw.oem_codes),
          extractCodesFromUnknown(raw.oemCodes),
          extractCodesFromUnknown(raw.oem_kodlari),
          extractCodesFromUnknown(raw.oemKodlari)
        )
        .map((code) => ({
          brand: supplierBrandName,
          code
        }))
    ],
    ['brand', 'code']
  )
  const crossReferences = normalizeReferenceRows(
    [
      ...basePart.part_cross_references.map((item) => ({
        brand: item.brand_name,
        articleNumber: item.article_number
      })),
      sourcePart.article_link_id
        ? {
            brand: sourceBrandName || supplierBrandName,
            articleNumber: sourcePart.article_link_id.toString()
          }
        : null,
      rawPartNo
        ? {
            brand: supplierBrandName,
            articleNumber: rawPartNo
          }
        : null,
      supplierProduct.supplier_sku
        ? {
            brand: supplierBrandName,
            articleNumber: supplierProduct.supplier_sku
          }
        : null,
      ...extractCrossReferenceRowsFromUnknown(raw.cross, supplierBrandName),
      ...extractCrossReferenceRowsFromUnknown(
        raw.crossReferences,
        supplierBrandName
      ),
      ...extractCrossReferenceRowsFromUnknown(raw.reference, supplierBrandName),
      ...extractCrossReferenceRowsFromUnknown(raw.references, supplierBrandName)
    ].filter(
      (
        row
      ): row is {
        brand: string
        articleNumber: string
      } => row !== null
    ),
    ['brand', 'articleNumber']
  )
  const properties = normalizeReferenceRows(
    [
      ...basePart.part_properties.map((item) => ({
        key: item.key,
        value: item.value
      })),
      ...(supplierRawCategoryName
        ? [{ key: 'supplier_category', value: supplierRawCategoryName }]
        : []),
      ...extractSupplierPropertyRows(raw)
    ],
    ['key', 'value'],
    ['key']
  )

  const sourceProvenanceNote = buildReferenceCloneProvenanceNote({
    sourcePartId,
    supplierSku: supplierProduct.supplier_sku,
    providerCode: provider.code
  })
  const noteParts = [
    normalizeText(baseOverrides?.note),
    derivedPart ? null : sourceProvenanceNote
  ].filter((value): value is string => Boolean(value))

  const warnings: string[] = []
  if (brandResolution.status === 'FALLBACK_SOURCE') {
    warnings.push(
      'Supplier marka alias onaylı değil. Marka varsayılan olarak kaynak part markasından geliyor.'
    )
  }
  if (brandResolution.status === 'UNRESOLVED') {
    warnings.push(
      'Supplier marka çözümlenmedi. Kaydetmeden önce marka seçmeniz gerekiyor.'
    )
  }
  if (!derivedPart && supplierRawCategoryName && !matchedSupplierCategory) {
    warnings.push(
      `Supplier kategori adı eşleşmedi: ${supplierRawCategoryName}. Kategoriyi kaydetmeden önce kontrol edin.`
    )
  }

  const editable: SupplierReferenceCloneEditableFields = {
    name:
      normalizeText(derivedPart?.name) ||
      normalizeText(supplierProduct.supplier_name) ||
      sourcePart.name,
    articleLinkId: (
      derivedPart?.article_link_id ??
      buildArticleLinkIdFromSupplier({
        sku: supplierProduct.supplier_sku,
        rawPartNo
      })
    ).toString(),
    brandId: derivedPart?.brand_id ?? brandResolution.brandId,
    categoryId:
      derivedPart?.category_id ??
      matchedSupplierCategory?.id ??
      sourcePart.category_id,
    inBasket: derivedPart?.in_basket ?? false,
    sellingPriceOverride:
      baseOverrides?.selling_price_override != null
        ? Number(baseOverrides.selling_price_override.toString())
        : null,
    isVisible: derivedPart ? (baseOverrides?.is_visible ?? false) : false,
    lockPrice: derivedPart ? (baseOverrides?.lock_price ?? false) : false,
    lockVisibility: derivedPart
      ? (baseOverrides?.lock_visibility ?? false)
      : false,
    note: noteParts.join('\n'),
    supplierPrice:
      supplierProduct.supplier_price != null
        ? Number(supplierProduct.supplier_price.toString())
        : basePricing?.supplier_price != null
          ? Number(basePricing.supplier_price.toString())
          : basePart.price != null
            ? Number(basePart.price.toString())
            : null,
    supplierStockQty: supplierProduct.supplier_stock_qty,
    reservedStockQty: basePricing?.reserved_stock_qty ?? 0,
    minStockLevel: basePricing?.min_stock_level ?? 3,
    currency: supplierProduct.currency || basePricing?.currency || 'TRY',
    syncStatus: derivedPart ? basePricing?.sync_status || 'PENDING' : 'PENDING',
    eans,
    oemReferences,
    crossReferences,
    properties,
    infos: normalizeStringArray(
      basePart.part_infos.map((item) => item.content)
    ),
    images: normalizeReferenceCloneImages(
      [
        ...basePart.part_images.map((item) => ({
          image: item.image || '',
          thumb: item.thumb
        })),
        ...extractImageUrlsFromUnknown(raw.image).map((url) => ({
          image: url,
          thumb: url
        })),
        ...extractImageUrlsFromUnknown(raw.images).map((url) => ({
          image: url,
          thumb: url
        })),
        ...extractImageUrlsFromUnknown(raw.imageUrl).map((url) => ({
          image: url,
          thumb: url
        })),
        ...extractImageUrlsFromUnknown(raw.image_url).map((url) => ({
          image: url,
          thumb: url
        })),
        ...extractImageUrlsFromUnknown(raw.resimUrl).map((url) => ({
          image: url,
          thumb: url
        }))
      ]
    ),
    documents: normalizeReferenceCloneDocuments(
      basePart.part_documents.map((item) => ({
        id: item.id,
        name: item.doc_file_name,
        fileTypeName: item.doc_file_type_name,
        docId: item.doc_id,
        docTypeId: item.doc_type_id,
        docTypeName: item.doc_type_name,
        url: item.doc_url
      }))
    ),
    vehicleTypes: normalizeReferenceCloneVehicleTypes(
      basePart.part_vehicle_types.map((item) => ({
        id: item.vehicle_type_id,
        label: mapVehicleTypeLabel(item)
      }))
    ),
    supplierOffer: {
      supplierPrice:
        supplierProduct.supplier_price != null
          ? Number(supplierProduct.supplier_price.toString())
          : null,
      supplierStockQty: supplierProduct.supplier_stock_qty,
      currency: supplierProduct.currency || 'TRY',
      isActive: true
    }
  }

  return {
    provider,
    supplierProduct,
    sourcePart,
    referenceLink,
    draft: {
      mode: derivedPart ? 'edit' : 'create',
      partId: derivedPart ? derivedPart.id.toString() : null,
      sourcePart: {
        id: sourcePart.id.toString(),
        articleLinkId: sourcePart.article_link_id.toString(),
        name: sourcePart.name,
        brandId: sourcePart.brand_id,
        brandName: sourcePart.part_brands?.name ?? null,
        categoryId: sourcePart.category_id,
        categoryName: sourcePart.part_categories?.name ?? null
      },
      supplierProduct: {
        id: supplierProduct.id,
        sku: supplierProduct.supplier_sku,
        name: supplierProduct.supplier_name,
        brand: supplierProduct.supplier_brand,
        price:
          supplierProduct.supplier_price != null
            ? Number(supplierProduct.supplier_price.toString())
            : null,
        stockQty: supplierProduct.supplier_stock_qty,
        currency: supplierProduct.currency
      },
      provider: {
        id: provider.id,
        code: provider.code,
        name: provider.name
      },
      resolvedBrand: {
        id: brandResolution.brandId,
        name: brandResolution.brandName,
        status: brandResolution.status
      },
      resolvedCategory: {
        id: sourcePart.category_id,
        name: sourcePart.part_categories?.name ?? null
      },
      referenceLink: mapPartReferenceLinkRow(referenceLink),
      options: {
        brands: mappingOptions.brands,
        categories: mappingOptions.categories
      },
      warnings,
      editable
    } satisfies SupplierReferenceCloneDraft
  } as const
}

async function saveReferenceClonePartRecord(input: {
  tx: Prisma.TransactionClient
  userId: string
  provider: { id: number; code: string; name: string }
  supplierProduct: {
    id: number
    supplier_sku: string
    supplier_price: Prisma.Decimal | null
    supplier_stock_qty: number
    currency: string
  }
  sourcePartId: bigint
  partId: bigint
  editable: SupplierReferenceCloneEditableFields
  existingReferenceLinkId?: bigint | null
}) {
  const brandId = parsePositiveInt(input.editable.brandId)
  const categoryId = parsePositiveInt(input.editable.categoryId)
  const articleLinkId = parsePositiveBigInt(input.editable.articleLinkId)

  if (!normalizeText(input.editable.name)) {
    throw new Error('Ürün adı zorunludur.')
  }
  if (!articleLinkId) {
    throw new Error('Geçerli bir Article Link ID girin.')
  }
  if (!brandId) {
    throw new Error('Geçerli bir marka seçin.')
  }
  if (!categoryId) {
    throw new Error('Geçerli bir kategori seçin.')
  }

  const [brandExists, categoryExists] = await Promise.all([
    input.tx.part_brands.findUnique({
      where: { id: brandId },
      select: { id: true }
    }),
    input.tx.part_categories.findUnique({
      where: { id: categoryId },
      select: { id: true }
    })
  ])

  if (!brandExists) throw new Error('Geçerli bir marka seçin.')
  if (!categoryExists) throw new Error('Geçerli bir kategori seçin.')

  const supplierPrice = parsePositiveDecimal(input.editable.supplierPrice)
  const sellingOverride = parsePositiveDecimal(
    input.editable.sellingPriceOverride
  )
  const offerPrice = parsePositiveDecimal(
    input.editable.supplierOffer.supplierPrice
  )
  const eans = normalizeStringArray(input.editable.eans)
  const oemRows = normalizeReferenceRows(input.editable.oemReferences, [
    'brand',
    'code'
  ])
  const crossRows = normalizeReferenceRows(input.editable.crossReferences, [
    'brand',
    'articleNumber'
  ])
  const propertyRows = normalizeReferenceRows(
    input.editable.properties,
    ['key', 'value'],
    ['key']
  )
  const infoRows = normalizeStringArray(input.editable.infos)
  const imageRows = normalizeReferenceCloneImages(input.editable.images)
  const documentRows = normalizeReferenceCloneDocuments(
    input.editable.documents
  )
  const vehicleTypeRows = normalizeReferenceCloneVehicleTypes(
    input.editable.vehicleTypes
  )

  await input.tx.parts.upsert({
    where: { id: input.partId },
    update: {
      name: normalizeText(input.editable.name)!,
      article_link_id: articleLinkId,
      price: supplierPrice,
      brand_id: brandId,
      category_id: categoryId,
      in_basket: Boolean(input.editable.inBasket)
    },
    create: {
      id: input.partId,
      name: normalizeText(input.editable.name)!,
      article_link_id: articleLinkId,
      price: supplierPrice,
      brand_id: brandId,
      category_id: categoryId,
      in_basket: Boolean(input.editable.inBasket)
    }
  })

  await input.tx.part_pricing_inventory.upsert({
    where: { part_id: input.partId },
    update: {
      supplier_price: supplierPrice,
      supplier_stock_qty: Math.max(0, input.editable.supplierStockQty),
      reserved_stock_qty: Math.max(0, input.editable.reservedStockQty),
      min_stock_level: Math.max(0, input.editable.minStockLevel),
      currency: normalizeText(input.editable.currency) || 'TRY',
      sync_status: normalizeText(input.editable.syncStatus) || 'PENDING',
      source_provider_id: input.provider.id,
      source_supplier_product_id: input.supplierProduct.id,
      last_synced_at: new Date()
    },
    create: {
      part_id: input.partId,
      supplier_price: supplierPrice,
      supplier_stock_qty: Math.max(0, input.editable.supplierStockQty),
      reserved_stock_qty: Math.max(0, input.editable.reservedStockQty),
      min_stock_level: Math.max(0, input.editable.minStockLevel),
      currency: normalizeText(input.editable.currency) || 'TRY',
      sync_status: normalizeText(input.editable.syncStatus) || 'PENDING',
      source_provider_id: input.provider.id,
      source_supplier_product_id: input.supplierProduct.id,
      last_synced_at: new Date()
    }
  })

  await input.tx.part_admin_overrides.upsert({
    where: { part_id: input.partId },
    update: {
      selling_price_override: sellingOverride,
      is_visible: Boolean(input.editable.isVisible),
      lock_price: Boolean(input.editable.lockPrice),
      lock_visibility: Boolean(input.editable.lockVisibility),
      note: normalizeText(input.editable.note),
      updated_by: input.userId
    },
    create: {
      part_id: input.partId,
      selling_price_override: sellingOverride,
      is_visible: Boolean(input.editable.isVisible),
      lock_price: Boolean(input.editable.lockPrice),
      lock_visibility: Boolean(input.editable.lockVisibility),
      note: normalizeText(input.editable.note),
      updated_by: input.userId
    }
  })

  await input.tx.part_supplier_offers.upsert({
    where: {
      provider_id_supplier_product_id: {
        provider_id: input.provider.id,
        supplier_product_id: input.supplierProduct.id
      }
    },
    update: {
      part_id: input.partId,
      supplier_price: offerPrice,
      supplier_stock_qty: Math.max(
        0,
        input.editable.supplierOffer.supplierStockQty
      ),
      currency: normalizeText(input.editable.supplierOffer.currency) || 'TRY',
      is_active: Boolean(input.editable.supplierOffer.isActive),
      last_synced_at: new Date()
    },
    create: {
      provider_id: input.provider.id,
      supplier_product_id: input.supplierProduct.id,
      part_id: input.partId,
      supplier_price: offerPrice,
      supplier_stock_qty: Math.max(
        0,
        input.editable.supplierOffer.supplierStockQty
      ),
      currency: normalizeText(input.editable.supplierOffer.currency) || 'TRY',
      is_active: Boolean(input.editable.supplierOffer.isActive),
      last_synced_at: new Date()
    }
  })

  await input.tx.supplier_part_mappings.upsert({
    where: {
      provider_id_supplier_product_id: {
        provider_id: input.provider.id,
        supplier_product_id: input.supplierProduct.id
      }
    },
    update: {
      supplier_sku: input.supplierProduct.supplier_sku,
      part_id: input.partId,
      status: 'APPROVED',
      workflow_status: 'CLONED_DRAFT',
      confidence: new Prisma.Decimal(1),
      match_reason:
        normalizeText(input.editable.note) ||
        `manual:reference-clone:${input.sourcePartId.toString()}`,
      is_manual: true,
      approved_by: input.userId,
      approved_at: new Date(),
      ignored_reason: null
    },
    create: {
      provider_id: input.provider.id,
      supplier_product_id: input.supplierProduct.id,
      supplier_sku: input.supplierProduct.supplier_sku,
      part_id: input.partId,
      status: 'APPROVED',
      workflow_status: 'CLONED_DRAFT',
      confidence: new Prisma.Decimal(1),
      match_reason:
        normalizeText(input.editable.note) ||
        `manual:reference-clone:${input.sourcePartId.toString()}`,
      is_manual: true,
      approved_by: input.userId,
      approved_at: new Date()
    }
  })

  await ensureSupplierMappingCrossReference({
    tx: input.tx,
    partId: input.partId,
    providerCode: input.provider.code,
    supplierSku: input.supplierProduct.supplier_sku
  })

  if (input.existingReferenceLinkId) {
    await input.tx.part_reference_links.update({
      where: { id: input.existingReferenceLinkId },
      data: {
        source_part_id: input.sourcePartId,
        derived_part_id: input.partId,
        provider_id: input.provider.id,
        supplier_product_id: input.supplierProduct.id,
        relation_type: 'SUPPLIER_REFERENCE_CLONE',
        copy_mode: 'FULL_COPY_EDITABLE',
        created_by: input.userId,
        is_active: true
      }
    })
  } else {
    await input.tx.part_reference_links.create({
      data: {
        source_part_id: input.sourcePartId,
        derived_part_id: input.partId,
        provider_id: input.provider.id,
        supplier_product_id: input.supplierProduct.id,
        relation_type: 'SUPPLIER_REFERENCE_CLONE',
        copy_mode: 'FULL_COPY_EDITABLE',
        created_by: input.userId,
        is_active: true
      }
    })
  }

  await input.tx.part_eans.deleteMany({ where: { part_id: input.partId } })
  await input.tx.part_oens.deleteMany({ where: { part_id: input.partId } })
  await input.tx.part_cross_references.deleteMany({
    where: { part_id: input.partId }
  })
  await input.tx.part_properties.deleteMany({
    where: { part_id: input.partId }
  })
  await input.tx.part_infos.deleteMany({ where: { part_id: input.partId } })
  await input.tx.part_images.deleteMany({ where: { part_id: input.partId } })
  await input.tx.part_documents.deleteMany({ where: { part_id: input.partId } })
  await input.tx.part_vehicle_types.deleteMany({
    where: { part_id: input.partId }
  })

  if (eans.length > 0) {
    await input.tx.part_eans.createMany({
      data: eans.map((code) => ({ part_id: input.partId, code }))
    })
  }

  if (oemRows.length > 0) {
    await input.tx.part_oens.createMany({
      data: oemRows.map((row) => ({
        part_id: input.partId,
        brand: row.brand,
        code: row.code
      }))
    })
  }

  if (crossRows.length > 0) {
    await input.tx.part_cross_references.createMany({
      data: crossRows.map((row) => ({
        part_id: input.partId,
        brand_name: row.brand,
        article_number: row.articleNumber
      }))
    })
  }

  if (propertyRows.length > 0) {
    await createPartPropertiesRows(input.tx, input.partId, propertyRows)
  }

  if (infoRows.length > 0) {
    await input.tx.part_infos.createMany({
      data: infoRows.map((content) => ({ part_id: input.partId, content }))
    })
  }

  if (imageRows.length > 0) {
    await input.tx.part_images.createMany({
      data: imageRows.map((row) => ({
        part_id: input.partId,
        image: row.image,
        thumb: row.thumb
      }))
    })
  }

  if (documentRows.length > 0) {
    await input.tx.part_documents.createMany({
      data: documentRows.map((row) => ({
        part_id: input.partId,
        doc_file_name: row.name,
        doc_file_type_name: row.fileTypeName,
        doc_id: row.docId,
        doc_type_id: row.docTypeId,
        doc_type_name: row.docTypeName,
        doc_url: row.url
      }))
    })
  }

  if (vehicleTypeRows.length > 0) {
    await input.tx.part_vehicle_types.createMany({
      data: vehicleTypeRows.map((row) => ({
        part_id: input.partId,
        vehicle_type_id: row.id
      }))
    })
  }
}

export async function listSupplierReferenceCandidates(
  input: SupplierPartSearchAdvancedInput
) {
  return searchPartsForSupplierMappingAdvanced(input)
}

function buildReferenceCloneStoragePath(input: {
  providerCode: string
  supplierProductId: number | null
  folder: 'images' | 'documents'
  extension: string
}) {
  const providerSegment = sanitizeStorageSegment(input.providerCode)
  const supplierSegment = input.supplierProductId
    ? String(input.supplierProductId)
    : 'unknown-supplier-product'
  const random = Math.random().toString(36).slice(2, 9)

  return `supplier-reference-clones/${providerSegment}/${supplierSegment}/${input.folder}/${Date.now()}-${random}.${input.extension}`
}

async function uploadReferenceCloneBinaryFile(input: {
  file: File
  providerCode: string
  supplierProductId: number | null
  bucket: string
  folder: 'images' | 'documents'
}) {
  const extension =
    getFileExtension(input.file.name) ||
    getFileExtensionFromMime(input.file.type) ||
    (input.folder === 'images' ? 'jpg' : 'bin')

  const path = buildReferenceCloneStoragePath({
    providerCode: input.providerCode,
    supplierProductId: input.supplierProductId,
    folder: input.folder,
    extension
  })

  const bytes = new Uint8Array(await input.file.arrayBuffer())
  const supabase = createAdminClient()

  const { error } = await supabase.storage
    .from(input.bucket)
    .upload(path, bytes, {
      contentType:
        normalizeText(input.file.type) ||
        (input.folder === 'images'
          ? `image/${extension === 'jpg' ? 'jpeg' : extension}`
          : undefined),
      upsert: false
    })

  if (error) {
    return { success: false, message: error.message } as const
  }

  const {
    data: { publicUrl }
  } = supabase.storage.from(input.bucket).getPublicUrl(path)

  return {
    success: true,
    data: {
      path,
      bucket: input.bucket,
      publicUrl
    }
  } as const
}

export async function uploadSupplierReferenceCloneImage(
  formData: FormData
): Promise<{
  success: boolean
  message: string
  data?: {
    url: string
    thumbUrl: string
    path: string
    bucket: string
    fileName: string
  }
}> {
  await requireAdminAuth()

  const file = formData.get('file')
  if (!(file instanceof File)) {
    return { success: false, message: 'Yüklenecek görsel bulunamadı.' }
  }
  if (file.size <= 0) {
    return { success: false, message: 'Boş görsel dosyası yüklenemez.' }
  }
  if (!file.type.startsWith('image/')) {
    return { success: false, message: 'Sadece görsel dosyaları yüklenebilir.' }
  }
  if (file.size > 12 * 1024 * 1024) {
    return { success: false, message: 'Görsel boyutu 12MB sınırını aşıyor.' }
  }

  const providerCode =
    normalizeText(String(formData.get('providerCode') || '')) || 'supplier'
  const supplierProductId = parsePositiveInt(
    formData.get('supplierProductId')
      ? String(formData.get('supplierProductId'))
      : null
  )

  const uploaded = await uploadReferenceCloneBinaryFile({
    file,
    providerCode,
    supplierProductId,
    bucket: REFERENCE_CLONE_IMAGE_BUCKET,
    folder: 'images'
  })

  if (!uploaded.success) {
    return {
      success: false,
      message: uploaded.message || "Görsel Supabase Storage'a yüklenemedi."
    }
  }

  return {
    success: true,
    message: 'Görsel yüklendi.',
    data: {
      url: uploaded.data.publicUrl,
      thumbUrl: uploaded.data.publicUrl,
      path: uploaded.data.path,
      bucket: uploaded.data.bucket,
      fileName: file.name
    }
  }
}

export async function uploadSupplierReferenceCloneDocument(
  formData: FormData
): Promise<{
  success: boolean
  message: string
  data?: {
    name: string
    fileTypeName: string
    docId: string
    docTypeId: number
    docTypeName: string
    url: string
    path: string
    bucket: string
  }
}> {
  await requireAdminAuth()

  const file = formData.get('file')
  if (!(file instanceof File)) {
    return { success: false, message: 'Yüklenecek döküman bulunamadı.' }
  }
  if (file.size <= 0) {
    return { success: false, message: 'Boş döküman dosyası yüklenemez.' }
  }
  if (file.size > 25 * 1024 * 1024) {
    return { success: false, message: 'Döküman boyutu 25MB sınırını aşıyor.' }
  }

  const providerCode =
    normalizeText(String(formData.get('providerCode') || '')) || 'supplier'
  const supplierProductId = parsePositiveInt(
    formData.get('supplierProductId')
      ? String(formData.get('supplierProductId'))
      : null
  )

  const uploaded = await uploadReferenceCloneBinaryFile({
    file,
    providerCode,
    supplierProductId,
    bucket: REFERENCE_CLONE_DOCUMENT_BUCKET,
    folder: 'documents'
  })

  if (!uploaded.success) {
    return {
      success: false,
      message: uploaded.message || "Döküman Supabase Storage'a yüklenemedi."
    }
  }

  const extension =
    getFileExtension(file.name) || getFileExtensionFromMime(file.type) || 'bin'

  return {
    success: true,
    message: 'Döküman yüklendi.',
    data: {
      name: file.name,
      fileTypeName: extension.toLocaleUpperCase('en-US'),
      docId: uploaded.data.path,
      docTypeId: REFERENCE_CLONE_DOCUMENT_TYPE_ID,
      docTypeName: REFERENCE_CLONE_DOCUMENT_TYPE_NAME,
      url: uploaded.data.publicUrl,
      path: uploaded.data.path,
      bucket: uploaded.data.bucket
    }
  }
}

export async function searchSupplierReferenceCloneVehicleTypes(input: {
  q: string
  limit?: number
}): Promise<{
  success: boolean
  message: string
  data?: Array<{
    id: number
    label: string
    brandName: string
    modelName: string
    typeName: string
  }>
}> {
  await requireAdminAuth()

  const query = normalizeText(input.q) || ''
  if (query.length < 2) {
    return { success: true, message: 'Kısa sorgu.', data: [] }
  }

  const limit = Math.min(Math.max(parsePositiveInt(input.limit) ?? 20, 1), 50)
  const like = `%${query}%`
  const prefixLike = `${query}%`

  type VehicleSearchRow = {
    id: number
    brand_name: string
    model_name: string
    type_name: string
    year_of_constr_from: string | null
    year_of_constr_to: string | null
  }

  const rows = await db.$queryRaw<VehicleSearchRow[]>(Prisma.sql`
    SELECT
      vt.id,
      vb.name AS brand_name,
      vm.name AS model_name,
      vt.name AS type_name,
      vt.year_of_constr_from,
      vt.year_of_constr_to
    FROM vehicle_types vt
    JOIN vehicle_models vm ON vm.id = vt.model_id
    JOIN vehicle_brands vb ON vb.id = vm.brand_id
    WHERE
      vt.id::text = ${query}
      OR vt.name ILIKE ${like}
      OR vm.name ILIKE ${like}
      OR vb.name ILIKE ${like}
    ORDER BY
      CASE
        WHEN vt.id::text = ${query} THEN 0
        WHEN vt.name ILIKE ${prefixLike} THEN 1
        WHEN vm.name ILIKE ${prefixLike} THEN 2
        WHEN vb.name ILIKE ${prefixLike} THEN 3
        ELSE 4
      END,
      vb.name ASC,
      vm.name ASC,
      vt.name ASC,
      vt.id ASC
    LIMIT ${limit}
  `)

  return {
    success: true,
    message: `${rows.length} araç tipi bulundu.`,
    data: rows.map((row) => {
      const years = [row.year_of_constr_from, row.year_of_constr_to]
        .filter((value): value is string => Boolean(value))
        .join('-')

      return {
        id: row.id,
        brandName: row.brand_name,
        modelName: row.model_name,
        typeName: row.type_name,
        label: `${row.brand_name} / ${row.model_name} / ${row.type_name}${
          years ? ` (${years})` : ''
        }`
      }
    })
  }
}

export async function prepareSupplierReferenceCloneDraft(input: {
  providerCode: string
  supplierProductId: number
  sourcePartId?: string | null
  partId?: string | null
}): Promise<{
  success: boolean
  message: string
  data?: SupplierReferenceCloneDraft
}> {
  await requireAdminAuth()

  const loaded = await buildSupplierReferenceCloneDraftData(input)
  if ('error' in loaded) {
    return {
      success: false,
      message: loaded.error || 'Referans klon taslağı hazırlanamadı.'
    }
  }

  return {
    success: true,
    message:
      loaded.draft.mode === 'edit'
        ? 'Mevcut referans klon taslağı yüklendi.'
        : 'Referans klon taslağı hazırlandı.',
    data: loaded.draft
  }
}

export async function createSupplierReferenceClone(
  input: SupplierReferenceCloneInput
): Promise<{
  success: boolean
  message: string
  data?: { partId: string; mappingId: number; referenceLinkId: string }
}> {
  const userId = await getAdminUserId()
  const loaded = await buildSupplierReferenceCloneDraftData({
    providerCode: input.providerCode,
    supplierProductId: input.supplierProductId,
    sourcePartId: input.sourcePartId
  })

  if ('error' in loaded) {
    return {
      success: false,
      message: loaded.error || 'Referans klon taslağı hazırlanamadı.'
    }
  }

  if (loaded.referenceLink?.derived_part_id) {
    return {
      success: false,
      message: `Bu supplier ürün için zaten #${loaded.referenceLink.derived_part_id.toString()} referans klonu var. Düzenleme akışını kullanın.`
    }
  }

  const newPartId = buildNewPartId()
  let mappingId = 0
  let referenceLinkId = BigInt(0)

  await db.$transaction(async (tx) => {
    await saveReferenceClonePartRecord({
      tx,
      userId,
      provider: loaded.provider,
      supplierProduct: loaded.supplierProduct,
      sourcePartId: loaded.sourcePart.id,
      partId: newPartId,
      editable: input.editable
    })

    const mapping = await tx.supplier_part_mappings.findUniqueOrThrow({
      where: {
        provider_id_supplier_product_id: {
          provider_id: loaded.provider.id,
          supplier_product_id: loaded.supplierProduct.id
        }
      },
      select: { id: true }
    })
    const referenceLink = await tx.part_reference_links.findUniqueOrThrow({
      where: { derived_part_id: newPartId },
      select: { id: true }
    })
    mappingId = mapping.id
    referenceLinkId = referenceLink.id
  })

  await applyPolicyForPart(newPartId)
  invalidateSupplierMappingOptionsCache(loaded.provider.code)
  revalidateSupplierPaths()

  return {
    success: true,
    message: `Referans klon taslağı oluşturuldu (#${newPartId.toString()}).`,
    data: {
      partId: newPartId.toString(),
      mappingId,
      referenceLinkId: referenceLinkId.toString()
    }
  }
}

export async function updateSupplierReferenceClone(
  input: SupplierReferenceCloneInput
): Promise<{
  success: boolean
  message: string
  data?: { partId: string }
}> {
  const userId = await getAdminUserId()
  const partId = parsePositiveBigInt(input.partId)
  if (!partId) {
    return { success: false, message: 'Geçersiz klon part ID.' }
  }

  const loaded = await buildSupplierReferenceCloneDraftData({
    providerCode: input.providerCode,
    supplierProductId: input.supplierProductId,
    sourcePartId: input.sourcePartId,
    partId: input.partId
  })

  if ('error' in loaded) {
    return {
      success: false,
      message: loaded.error || 'Referans klon taslağı hazırlanamadı.'
    }
  }

  const referenceLinkId = loaded.referenceLink?.id
    ? parsePositiveBigInt(loaded.referenceLink.id)
    : null

  if (!referenceLinkId) {
    return {
      success: false,
      message: 'Bu part için referans klon provenance kaydı bulunamadı.'
    }
  }

  await db.$transaction(async (tx) => {
    await saveReferenceClonePartRecord({
      tx,
      userId,
      provider: loaded.provider,
      supplierProduct: loaded.supplierProduct,
      sourcePartId: loaded.sourcePart.id,
      partId,
      editable: input.editable,
      existingReferenceLinkId: referenceLinkId
    })
  })

  await applyPolicyForPart(partId)
  revalidateSupplierPaths()

  return {
    success: true,
    message: `Referans klon taslağı güncellendi (#${partId.toString()}).`,
    data: { partId: partId.toString() }
  }
}

export async function publishSupplierReferenceClone(input: {
  providerCode: string
  supplierProductId: number
  partId: string
}) {
  const userId = await getAdminUserId()
  const provider = await getSupplierProviderByCode(input.providerCode)
  if (!provider) {
    return { success: false, message: 'Tedarikçi bulunamadı.' }
  }

  const partId = parsePositiveBigInt(input.partId)
  if (!partId) {
    return { success: false, message: 'Geçersiz klon part ID.' }
  }

  const [part, referenceLink] = await Promise.all([
    db.parts.findUnique({
      where: { id: partId },
      select: {
        id: true,
        name: true,
        article_link_id: true,
        brand_id: true,
        category_id: true
      }
    }),
    db.part_reference_links.findUnique({
      where: { derived_part_id: partId },
      select: {
        id: true,
        provider_id: true,
        supplier_product_id: true
      }
    })
  ])

  if (!part) {
    return { success: false, message: 'Yayınlanacak part bulunamadı.' }
  }
  if (
    !referenceLink ||
    referenceLink.provider_id !== provider.id ||
    referenceLink.supplier_product_id !== input.supplierProductId
  ) {
    return {
      success: false,
      message: 'Bu part ilgili supplier reference clone kaydıyla eşleşmiyor.'
    }
  }
  if (
    !normalizeText(part.name) ||
    !part.article_link_id ||
    !part.brand_id ||
    !part.category_id
  ) {
    return {
      success: false,
      message: 'Yayın için ad, article link, marka ve kategori zorunludur.'
    }
  }

  await db.$transaction(async (tx) => {
    await tx.part_admin_overrides.upsert({
      where: { part_id: partId },
      update: {
        is_visible: true,
        updated_by: userId
      },
      create: {
        part_id: partId,
        is_visible: true,
        updated_by: userId
      }
    })

    await tx.supplier_part_mappings.updateMany({
      where: {
        provider_id: provider.id,
        supplier_product_id: input.supplierProductId,
        part_id: partId
      },
      data: {
        status: 'APPROVED',
        workflow_status: 'CLONED_DRAFT',
        approved_by: userId,
        approved_at: new Date()
      }
    })
  })

  revalidateSupplierPaths()

  return {
    success: true,
    message: `Referans klon yayınlandı (#${partId.toString()}).`
  }
}

export async function createSupplierClonePartFromCandidate(input: {
  providerCode: string
  supplierProductId: number
  sourcePartId: string
  name?: string | null
  articleLinkId?: string | number | null
  price?: number | null
  brandId?: number | null
  brandName?: string | null
  categoryId?: number | null
  inBasket?: boolean
  note?: string | null
}): Promise<{
  success: boolean
  message: string
  data?: { partId: string; sourcePartId: string; supplierProductId: number }
}> {
  const prepared = await prepareSupplierReferenceCloneDraft({
    providerCode: input.providerCode,
    supplierProductId: input.supplierProductId,
    sourcePartId: input.sourcePartId
  })

  if (!prepared.success || !prepared.data) {
    return {
      success: false,
      message: prepared.message
    }
  }

  const editable: SupplierReferenceCloneEditableFields = {
    ...prepared.data.editable,
    name: normalizeText(input.name) || prepared.data.editable.name,
    articleLinkId:
      normalizeText(
        input.articleLinkId == null ? null : String(input.articleLinkId)
      ) || prepared.data.editable.articleLinkId,
    brandId: parsePositiveInt(input.brandId) ?? prepared.data.editable.brandId,
    categoryId:
      parsePositiveInt(input.categoryId) ?? prepared.data.editable.categoryId,
    inBasket:
      typeof input.inBasket === 'boolean'
        ? input.inBasket
        : prepared.data.editable.inBasket,
    note: normalizeText(input.note) || prepared.data.editable.note,
    supplierPrice:
      input.price != null && Number.isFinite(Number(input.price))
        ? Number(input.price)
        : prepared.data.editable.supplierPrice
  }

  const result = await createSupplierReferenceClone({
    providerCode: input.providerCode,
    supplierProductId: input.supplierProductId,
    sourcePartId: input.sourcePartId,
    editable
  })

  if (!result.success || !result.data) {
    return {
      success: false,
      message: result.message
    }
  }

  return {
    success: true,
    message: result.message,
    data: {
      partId: result.data.partId,
      sourcePartId: input.sourcePartId,
      supplierProductId: input.supplierProductId
    }
  }
}

export async function saveSupplierProductPartDetail(input: {
  providerCode: string
  supplierProductId: number
  partId: string
  note?: string | null
  sellingPriceOverride?: number | null
  isVisible?: boolean
  lockPrice?: boolean
  lockVisibility?: boolean
  minStockLevel?: number
  reservedStockQty?: number
  adminNote?: string | null
  technical?: PartTechnicalReferenceInput
}) {
  const provider = await getSupplierProviderByCode(input.providerCode)
  if (!provider) {
    return { success: false, message: 'Tedarikçi bulunamadı.' }
  }

  const prepared = await prepareSupplierReferenceCloneDraft({
    providerCode: input.providerCode,
    supplierProductId: input.supplierProductId,
    partId: input.partId
  })

  if (!prepared.success || !prepared.data) {
    return {
      success: false,
      message: prepared.message
    }
  }

  const editable: SupplierReferenceCloneEditableFields = {
    ...prepared.data.editable,
    sellingPriceOverride:
      input.sellingPriceOverride ?? prepared.data.editable.sellingPriceOverride,
    isVisible:
      typeof input.isVisible === 'boolean'
        ? input.isVisible
        : prepared.data.editable.isVisible,
    lockPrice:
      typeof input.lockPrice === 'boolean'
        ? input.lockPrice
        : prepared.data.editable.lockPrice,
    lockVisibility:
      typeof input.lockVisibility === 'boolean'
        ? input.lockVisibility
        : prepared.data.editable.lockVisibility,
    note:
      normalizeText(input.adminNote) ||
      normalizeText(input.note) ||
      prepared.data.editable.note,
    minStockLevel: input.minStockLevel ?? prepared.data.editable.minStockLevel,
    reservedStockQty:
      input.reservedStockQty ?? prepared.data.editable.reservedStockQty,
    eans: input.technical?.eans || prepared.data.editable.eans,
    oemReferences:
      input.technical?.oemReferences || prepared.data.editable.oemReferences,
    crossReferences:
      input.technical?.crossReferences ||
      prepared.data.editable.crossReferences,
    properties: input.technical?.properties || prepared.data.editable.properties
  }

  const result = await updateSupplierReferenceClone({
    providerCode: provider.code,
    supplierProductId: input.supplierProductId,
    sourcePartId: prepared.data.sourcePart.id,
    partId: input.partId,
    editable
  })

  if (!result.success) {
    return result
  }

  return {
    success: true,
    message: `${prepared.data.supplierProduct.sku} için referans klon detayı güncellendi.`
  }
}

interface DinamikManualProductRow {
  query_brand: string
  part_no: string | null
  stock_code: string
  stock_name: string | null
  brand: string | null
  price: string | null
  barcode_1: string | null
  barcode_2: string | null
  barcode_3: string | null
  updated_at: Date
  matched_part_id: string | null
  matched_part_name: string | null
  matched_part_brand: string | null
  mapping_status: 'QUEUE' | 'APPROVED' | 'IGNORED' | null
}

interface DinamikManualBrandRow {
  query_brand: string
  product_count: number | string
}

interface DinamikManualCountRow {
  total: number | string
}

interface DinamikAutoMatchSourceRow {
  query_brand: string
  part_no: string
  stock_code: string
  stock_name: string | null
  brand: string | null
  price: string | null
  barcode_1: string | null
  barcode_2: string | null
  barcode_3: string | null
  matched_part_id: string
}

function mapDinamikManualProductRow(row: DinamikManualProductRow) {
  return {
    queryBrand: row.query_brand,
    partNo: row.part_no,
    stockCode: row.stock_code,
    stockName: row.stock_name,
    brand: row.brand,
    price: toNumber(row.price, 0),
    barcode1: row.barcode_1,
    barcode2: row.barcode_2,
    barcode3: row.barcode_3,
    updatedAt: row.updated_at.toISOString(),
    matchedPart: row.matched_part_id
      ? {
          id: row.matched_part_id,
          name: row.matched_part_name || '-',
          brand: row.matched_part_brand
        }
      : null,
    mappingStatus: row.mapping_status
  }
}

export async function getDinamikBrandsForManualMapping(input?: {
  q?: string
  limit?: number
}) {
  await requireAdminAuth()

  const q = input?.q?.trim() || ''
  const limit =
    input?.limit && input.limit > 0 ? Math.min(input.limit, 10000) : null
  const like = `%${q}%`
  const qCondition = q
    ? Prisma.sql`AND d.query_brand ILIKE ${like}`
    : Prisma.sql``
  const limitCondition =
    typeof limit === 'number' ? Prisma.sql`LIMIT ${limit}` : Prisma.sql``

  try {
    const rows = await db.$queryRaw<DinamikManualBrandRow[]>(Prisma.sql`
      SELECT
        d.query_brand,
        COUNT(*)::int AS product_count
      FROM dinamik.products d
      WHERE d.query_brand IS NOT NULL
        AND d.query_brand <> ''
        ${qCondition}
      GROUP BY d.query_brand
      ORDER BY d.query_brand ASC
      ${limitCondition}
    `)

    return rows.map((row) => ({
      queryBrand: row.query_brand,
      totalProducts: toNumber(row.product_count, 0)
    }))
  } catch (error) {
    console.error('[manual-mapping] dinamik brands list failed:', error)
    return [] as Array<{ queryBrand: string; totalProducts: number }>
  }
}

export async function listDinamikProductsForManualMapping(input?: {
  q?: string
  queryBrand?: string | null
  matchState?: 'all' | 'matched' | 'unmatched'
  mappingStatus?: SupplierProductListMappingStatus
  page?: number
  limit?: number
}) {
  const result = await listSupplierProductsForManualMapping({
    providerCode: 'dinamik',
    q: input?.q,
    queryBrand: input?.queryBrand,
    matchState: input?.matchState,
    mappingStatus: input?.mappingStatus,
    page: input?.page,
    limit: input?.limit
  })

  if (!result.success) {
    return {
      rows: [] as Array<ReturnType<typeof mapDinamikManualProductRow>>,
      pagination: {
        page: input?.page && input.page > 0 ? input.page : 1,
        limit:
          input?.limit && input.limit > 0 ? Math.min(input.limit, 100) : 20,
        total: 0,
        pages: 1
      },
      filters: {
        q: input?.q?.trim() || '',
        queryBrand: input?.queryBrand?.trim() || null,
        matchState: input?.matchState || 'all',
        mappingStatus: normalizeSupplierProductListMappingStatus(
          input?.mappingStatus
        )
      },
      summary: {
        total: 0,
        matched: 0,
        unmatched: 0
      }
    }
  }

  return {
    rows: result.rows.map((row) => ({
      queryBrand: row.queryBrand || '',
      partNo: row.partNo,
      stockCode: row.stockCode,
      stockName: row.stockName,
      brand: row.brand,
      price: row.price || 0,
      barcode1: row.barcode1,
      barcode2: row.barcode2,
      barcode3: row.barcode3,
      updatedAt: row.updatedAt || new Date().toISOString(),
      matchedPart: row.matchedPart
        ? {
            id: row.matchedPart.id,
            name: row.matchedPart.name,
            brand: row.matchedPart.brand
          }
        : null,
      mappingStatus: row.mappingStatus
    })),
    pagination: result.pagination,
    filters: {
      q: result.filters.q,
      queryBrand: result.filters.queryBrand,
      matchState: result.filters.matchState,
      mappingStatus: result.filters.mappingStatus
    },
    summary: result.summary
  }
}

export async function searchDinamikProductsForManualMapping(input: {
  q?: string
  queryBrand?: string
  limit?: number
}) {
  const q = input.q?.trim() || ''
  const queryBrand = input.queryBrand?.trim() || null

  if (!q && !queryBrand) return []

  const result = await listDinamikProductsForManualMapping({
    q,
    queryBrand,
    page: 1,
    limit: input.limit && input.limit > 0 ? Math.min(input.limit, 50) : 20
  })

  return result.rows
}

export async function autoMapDinamikProductsByPartNo(input?: {
  q?: string
  queryBrand?: string | null
  limit?: number
}) {
  const userId = await getAdminUserId()
  const provider = await ensureDinamikProvider()

  const q = input?.q?.trim() || ''
  const queryBrand =
    input?.queryBrand && input.queryBrand !== 'all'
      ? input.queryBrand.trim()
      : null
  const limit =
    input?.limit && input.limit > 0 ? Math.min(input.limit, 5000) : 1000
  const like = `%${q}%`

  const brandCondition = queryBrand
    ? Prisma.sql`AND d.query_brand = ${queryBrand}`
    : Prisma.sql``
  const qCondition = q
    ? Prisma.sql`
      AND (
        COALESCE(d.part_no, '') ILIKE ${like}
        OR d.stock_code ILIKE ${like}
        OR COALESCE(d.stock_name, '') ILIKE ${like}
        OR COALESCE(d.brand, '') ILIKE ${like}
      )
    `
    : Prisma.sql``

  const rows = await db.$queryRaw<DinamikAutoMatchSourceRow[]>(Prisma.sql`
    SELECT DISTINCT ON (d.stock_code)
      d.query_brand,
      d.part_no,
      d.stock_code,
      d.stock_name,
      d.brand,
      d.price::text AS price,
      d.barcode_1,
      d.barcode_2,
      d.barcode_3,
      p.id::text AS matched_part_id
    FROM dinamik.products d
    JOIN LATERAL (
      SELECT a.part_brand_id
      FROM supplier_brand_aliases a
      WHERE a.provider_id = ${provider.id}
        AND a.mapping_status = 'APPROVED'
        AND a.part_brand_id IS NOT NULL
        AND (
          LOWER(TRIM(a.supplier_brand)) = LOWER(TRIM(d.query_brand))
          OR (
            d.brand IS NOT NULL
            AND d.brand <> ''
            AND LOWER(TRIM(a.supplier_brand)) = LOWER(TRIM(d.brand))
          )
        )
      ORDER BY a.updated_at DESC
      LIMIT 1
    ) mapped_brand ON TRUE
    JOIN parts p
      ON CAST(p.part_no AS TEXT) = CAST(d.part_no AS TEXT)
      AND p.brand_id = mapped_brand.part_brand_id
    WHERE d.part_no IS NOT NULL
      AND d.part_no <> ''
      ${brandCondition}
      ${qCondition}
    ORDER BY d.stock_code, d.updated_at DESC, p.updated_at DESC
    LIMIT ${limit}
  `)

  if (rows.length === 0) {
    return {
      success: true,
      message: 'Onaylı marka mapping + birebir PART NO eşleşmesi bulunamadı.',
      data: {
        scanned: 0,
        mapped: 0,
        policyUpdated: 0
      }
    }
  }

  const touchedPartIds = new Set<bigint>()
  const autoMapConcurrency = parsePositiveInt(process.env.AUTO_MAP_CONCURRENCY)
  const UPSERT_CONCURRENCY = autoMapConcurrency
    ? Math.min(autoMapConcurrency, 32)
    : 8
  for (let start = 0; start < rows.length; start += UPSERT_CONCURRENCY) {
    const batch = rows.slice(start, start + UPSERT_CONCURRENCY)

    await Promise.all(
      batch.map(async (row) => {
        let partId: bigint
        try {
          partId = BigInt(row.matched_part_id)
        } catch {
          return
        }

        const supplierPrice = row.price ? new Prisma.Decimal(row.price) : null
        const supplierBrand = row.brand?.trim() || null
        const supplierName = row.stock_name?.trim() || null
        const productKey = `${row.query_brand || 'auto'}::${row.stock_code}`

        const supplierProduct = await db.supplier_products.upsert({
          where: {
            provider_id_supplier_sku: {
              provider_id: provider.id,
              supplier_sku: row.stock_code
            }
          },
          update: {
            supplier_product_key: productKey,
            supplier_brand: supplierBrand,
            supplier_name: supplierName,
            normalized_sku: row.stock_code
              .replace(/[^a-zA-Z0-9]/g, '')
              .toUpperCase(),
            normalized_name: supplierName
              ? supplierName.replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
              : null,
            barcode_1: row.barcode_1,
            barcode_2: row.barcode_2,
            barcode_3: row.barcode_3,
            supplier_price: supplierPrice,
            currency: 'TRY',
            raw_json: {
              query_brand: row.query_brand,
              part_no: row.part_no,
              stock_code: row.stock_code,
              stock_name: row.stock_name,
              brand: row.brand,
              price: row.price,
              barcode_1: row.barcode_1,
              barcode_2: row.barcode_2,
              barcode_3: row.barcode_3
            } as Prisma.InputJsonValue,
            last_seen_at: new Date()
          },
          create: {
            provider_id: provider.id,
            supplier_product_key: productKey,
            supplier_sku: row.stock_code,
            supplier_brand: supplierBrand,
            supplier_name: supplierName,
            normalized_sku: row.stock_code
              .replace(/[^a-zA-Z0-9]/g, '')
              .toUpperCase(),
            normalized_name: supplierName
              ? supplierName.replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
              : null,
            barcode_1: row.barcode_1,
            barcode_2: row.barcode_2,
            barcode_3: row.barcode_3,
            supplier_price: supplierPrice,
            supplier_stock_qty: 0,
            currency: 'TRY',
            raw_json: {
              query_brand: row.query_brand,
              part_no: row.part_no,
              stock_code: row.stock_code,
              stock_name: row.stock_name,
              brand: row.brand,
              price: row.price,
              barcode_1: row.barcode_1,
              barcode_2: row.barcode_2,
              barcode_3: row.barcode_3
            } as Prisma.InputJsonValue,
            last_seen_at: new Date()
          }
        })

        await db.supplier_part_mappings.upsert({
          where: {
            provider_id_supplier_sku: {
              provider_id: provider.id,
              supplier_sku: row.stock_code
            }
          },
          update: {
            supplier_product_id: supplierProduct.id,
            part_id: partId,
            status: 'APPROVED',
            workflow_status: 'MATCHED_EXISTING',
            confidence: new Prisma.Decimal(1),
            match_reason: 'auto:part_no_exact',
            is_manual: false,
            approved_by: userId,
            approved_at: new Date(),
            ignored_reason: null
          },
          create: {
            provider_id: provider.id,
            supplier_product_id: supplierProduct.id,
            supplier_sku: row.stock_code,
            part_id: partId,
            status: 'APPROVED',
            workflow_status: 'MATCHED_EXISTING',
            confidence: new Prisma.Decimal(1),
            match_reason: 'auto:part_no_exact',
            is_manual: false,
            approved_by: userId,
            approved_at: new Date(),
            ignored_reason: null
          }
        })

        await db.part_supplier_offers.upsert({
          where: {
            provider_id_supplier_product_id: {
              provider_id: provider.id,
              supplier_product_id: supplierProduct.id
            }
          },
          update: {
            part_id: partId,
            supplier_price: supplierPrice,
            currency: 'TRY',
            is_active: true,
            last_synced_at: new Date()
          },
          create: {
            provider_id: provider.id,
            supplier_product_id: supplierProduct.id,
            part_id: partId,
            supplier_price: supplierPrice,
            supplier_stock_qty: 0,
            currency: 'TRY',
            is_active: true,
            last_synced_at: new Date()
          }
        })

        await ensureSupplierMappingCrossReference({
          partId,
          providerCode: provider.code,
          supplierSku: row.stock_code
        })

        touchedPartIds.add(partId)
      })
    )
  }

  const touchedPartIdsList = Array.from(touchedPartIds)
  const POLICY_CONCURRENCY = UPSERT_CONCURRENCY
  for (
    let index = 0;
    index < touchedPartIdsList.length;
    index += POLICY_CONCURRENCY
  ) {
    const partBatch = touchedPartIdsList.slice(
      index,
      index + POLICY_CONCURRENCY
    )
    await Promise.all(partBatch.map((partId) => applyPolicyForPart(partId)))
  }

  revalidateSupplierPaths()

  return {
    success: true,
    message: `${rows.length} dinamik ürün için (onaylı marka + birebir PART NO) otomatik eşleştirme tamamlandı.`,
    data: {
      scanned: rows.length,
      mapped: rows.length,
      policyUpdated: touchedPartIdsList.length
    }
  }
}

export async function manualMapDinamikProductToPart(input: {
  stockCode: string
  queryBrand?: string | null
  partId: string
  note?: string | null
}) {
  await requireAdminAuth()
  const provider = await ensureDinamikProvider()

  const stockCode = input.stockCode.trim()
  if (!stockCode) {
    return { success: false, message: 'Stok kodu zorunludur.' }
  }

  let partId: bigint
  try {
    partId = BigInt(input.partId)
  } catch {
    return { success: false, message: 'Geçersiz part_id.' }
  }

  const part = await db.parts.findUnique({
    where: { id: partId },
    select: { id: true }
  })

  if (!part) {
    return { success: false, message: 'Public part bulunamadı.' }
  }

  const queryBrand = input.queryBrand?.trim() || null
  const brandCondition = queryBrand
    ? Prisma.sql`AND d.query_brand = ${queryBrand}`
    : Prisma.sql``

  const rows = await db.$queryRaw<DinamikManualProductRow[]>(Prisma.sql`
    SELECT
      d.query_brand,
      d.part_no,
      d.stock_code,
      d.stock_name,
      d.brand,
      d.price::text AS price,
      d.barcode_1,
      d.barcode_2,
      d.barcode_3,
      d.updated_at
    FROM dinamik.products d
    WHERE d.stock_code = ${stockCode}
      ${brandCondition}
    ORDER BY d.updated_at DESC
    LIMIT 1
  `)

  const source = rows[0]
  if (!source) {
    return { success: false, message: 'Dinamik ürün bulunamadı.' }
  }

  const supplierBrand = normalizeText(source.brand)
  const supplierName = normalizeText(source.stock_name)
  const supplierPrice = source.price ? new Prisma.Decimal(source.price) : null
  const productKey = `${source.query_brand || 'manual'}::${source.stock_code}`

  const supplierProduct = await db.supplier_products.upsert({
    where: {
      provider_id_supplier_sku: {
        provider_id: provider.id,
        supplier_sku: source.stock_code
      }
    },
    update: {
      supplier_product_key: productKey,
      supplier_brand: supplierBrand,
      supplier_name: supplierName,
      normalized_sku: source.stock_code
        .replace(/[^a-zA-Z0-9]/g, '')
        .toUpperCase(),
      normalized_name: supplierName
        ? supplierName.replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
        : null,
      barcode_1: source.barcode_1,
      barcode_2: source.barcode_2,
      barcode_3: source.barcode_3,
      supplier_price: supplierPrice,
      currency: 'TRY',
      raw_json: {
        query_brand: source.query_brand,
        part_no: source.part_no,
        stock_code: source.stock_code,
        stock_name: source.stock_name,
        brand: source.brand,
        price: source.price,
        barcode_1: source.barcode_1,
        barcode_2: source.barcode_2,
        barcode_3: source.barcode_3
      } as Prisma.InputJsonValue,
      last_seen_at: new Date()
    },
    create: {
      provider_id: provider.id,
      supplier_product_key: productKey,
      supplier_sku: source.stock_code,
      supplier_brand: supplierBrand,
      supplier_name: supplierName,
      normalized_sku: source.stock_code
        .replace(/[^a-zA-Z0-9]/g, '')
        .toUpperCase(),
      normalized_name: supplierName
        ? supplierName.replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
        : null,
      barcode_1: source.barcode_1,
      barcode_2: source.barcode_2,
      barcode_3: source.barcode_3,
      supplier_price: supplierPrice,
      supplier_stock_qty: 0,
      currency: 'TRY',
      raw_json: {
        query_brand: source.query_brand,
        part_no: source.part_no,
        stock_code: source.stock_code,
        stock_name: source.stock_name,
        brand: source.brand,
        price: source.price,
        barcode_1: source.barcode_1,
        barcode_2: source.barcode_2,
        barcode_3: source.barcode_3
      } as Prisma.InputJsonValue,
      last_seen_at: new Date()
    },
    select: { id: true }
  })

  return manualMapSupplierProductToPart({
    providerCode: 'dinamik',
    supplierProductId: supplierProduct.id,
    partId: input.partId,
    note: input.note || 'manuel:dinamik-products'
  })
}

export async function getSupplierMappingCandidates(mappingId: number): Promise<{
  success: boolean
  message?: string
  candidates: MappingCandidate[]
}> {
  await requireAdminAuth()

  const mapping = await db.supplier_part_mappings.findUnique({
    where: { id: mappingId },
    include: {
      supplier_products: true
    }
  })

  if (!mapping) {
    return {
      success: false,
      message: 'Mapping kaydı bulunamadı.',
      candidates: []
    }
  }

  const supplierName = mapping.supplier_products.supplier_name || ''
  const supplierSku = mapping.supplier_products.supplier_sku
  const queryToken = supplierName.trim() || supplierSku

  if (!queryToken) {
    return {
      success: true,
      candidates: []
    }
  }

  const rows = await db.$queryRaw<
    Array<{
      id: string
      article_link_id: string
      part_no: string | null
      name: string
      brand_name: string | null
      score: string
    }>
  >(Prisma.sql`
    SELECT
      p.id::text AS id,
      p.article_link_id::text AS article_link_id,
      CAST(p.part_no AS TEXT) AS part_no,
      p.name,
      b.name AS brand_name,
      (
        CASE WHEN CAST(p.part_no AS TEXT) = ${supplierSku} THEN 0.85 ELSE 0 END +
        CASE WHEN CAST(p.part_no AS TEXT) ILIKE ${`%${supplierSku}%`} THEN 0.10 ELSE 0 END +
        CASE WHEN p.name ILIKE ${`%${supplierName}%`} THEN 0.05 ELSE 0 END
      )::text AS score
    FROM parts p
    LEFT JOIN part_brands b ON b.id = p.brand_id
    WHERE
      CAST(p.part_no AS TEXT) ILIKE ${`%${supplierSku}%`}
      OR p.name ILIKE ${`%${queryToken}%`}
    ORDER BY (
      CASE WHEN CAST(p.part_no AS TEXT) = ${supplierSku} THEN 0.85 ELSE 0 END +
      CASE WHEN CAST(p.part_no AS TEXT) ILIKE ${`%${supplierSku}%`} THEN 0.10 ELSE 0 END +
      CASE WHEN p.name ILIKE ${`%${supplierName}%`} THEN 0.05 ELSE 0 END
    ) DESC,
    p.updated_at DESC
    LIMIT 15
  `)

  return {
    success: true,
    candidates: rows.map((row) => ({
      partId: row.id,
      articleLinkId: row.article_link_id,
      partNo: row.part_no,
      name: row.name,
      brand: row.brand_name,
      confidence: Math.min(0.99, toNumber(row.score, 0)),
      reasons: ['aday_eşleşme']
    }))
  }
}

export async function searchPartsForSupplierMapping(input: {
  q: string
  limit?: number
}) {
  await requireAdminAuth()

  const q = input.q.trim()
  if (!q) {
    return [] as MappingCandidate[]
  }

  const limit = input.limit && input.limit > 0 ? Math.min(input.limit, 40) : 20

  const rows = await db.$queryRaw<
    Array<{
      id: string
      article_link_id: string
      part_no: string | null
      name: string
      brand_name: string | null
    }>
  >(Prisma.sql`
    SELECT
      p.id::text AS id,
      p.article_link_id::text AS article_link_id,
      CAST(p.part_no AS TEXT) AS part_no,
      p.name,
      b.name AS brand_name
    FROM parts p
    LEFT JOIN part_brands b ON b.id = p.brand_id
    WHERE
      CAST(p.part_no AS TEXT) ILIKE ${`%${q}%`}
      OR p.name ILIKE ${`%${q}%`}
      OR CAST(p.id AS TEXT) ILIKE ${`%${q}%`}
    ORDER BY
      CASE
        WHEN CAST(p.part_no AS TEXT) = ${q} THEN 0
        WHEN CAST(p.part_no AS TEXT) ILIKE ${`${q}%`} THEN 1
        ELSE 2
      END,
      p.updated_at DESC
    LIMIT ${limit}
  `)

  return rows.map((row) => ({
    partId: row.id,
    articleLinkId: row.article_link_id,
    partNo: row.part_no,
    name: row.name,
    brand: row.brand_name,
    confidence: 1,
    reasons: ['manuel_ara']
  }))
}

export async function approveSupplierMapping(input: {
  mappingId: number
  partId?: string
  note?: string | null
}) {
  const userId = await getAdminUserId()

  const mapping = await db.supplier_part_mappings.findUnique({
    where: { id: input.mappingId },
    include: {
      supplier_products: true,
      supplier_providers: {
        select: {
          code: true
        }
      }
    }
  })

  if (!mapping) {
    return {
      success: false,
      message: 'Mapping kaydı bulunamadı.'
    }
  }

  let partId = mapping.part_id

  if (input.partId) {
    try {
      partId = BigInt(input.partId)
    } catch {
      return { success: false, message: 'Geçersiz part_id.' }
    }
  }

  if (!partId) {
    const candidates = await getSupplierMappingCandidates(mapping.id)
    const winner = candidates.candidates[0]
    if (!winner) {
      return {
        success: false,
        message: 'Onay için part eşleşmesi bulunamadı. Manuel part seçin.'
      }
    }
    partId = BigInt(winner.partId)
  }

  const targetPart = await db.parts.findUnique({
    where: { id: partId },
    select: { id: true }
  })

  if (!targetPart) {
    return {
      success: false,
      message: 'Seçilen parça bulunamadı.'
    }
  }

  await db.$transaction(async (tx) => {
    await tx.supplier_part_mappings.update({
      where: { id: mapping.id },
      data: {
        part_id: partId,
        status: 'APPROVED',
        workflow_status: 'MATCHED_EXISTING',
        is_manual: Boolean(input.partId),
        approved_by: userId,
        approved_at: new Date(),
        ignored_reason: null,
        match_reason: input.note ? `manuel:${input.note}` : mapping.match_reason
      }
    })

    const existingOffer = await tx.part_supplier_offers.findFirst({
      where: {
        provider_id: mapping.provider_id,
        supplier_product_id: mapping.supplier_product_id
      },
      select: { id: true }
    })

    const offerData = {
      part_id: partId,
      supplier_price: mapping.supplier_products.supplier_price,
      supplier_stock_qty: mapping.supplier_products.supplier_stock_qty,
      currency: mapping.supplier_products.currency,
      is_active: true,
      last_synced_at: new Date()
    }

    if (existingOffer) {
      await tx.part_supplier_offers.update({
        where: { id: existingOffer.id },
        data: offerData
      })
    } else {
      await tx.part_supplier_offers.create({
        data: {
          provider_id: mapping.provider_id,
          supplier_product_id: mapping.supplier_product_id,
          ...offerData
        }
      })
    }

    await ensureSupplierMappingCrossReference({
      tx,
      partId,
      providerCode: mapping.supplier_providers.code,
      supplierSku: mapping.supplier_sku
    })
  })

  await applyPolicyForPart(partId)
  revalidateSupplierPaths()

  return {
    success: true,
    message: 'Mapping onaylandı ve teklif aktif edildi.'
  }
}

export async function ignoreSupplierMapping(input: {
  mappingId: number
  reason?: string
}) {
  const userId = await getAdminUserId()

  const mapping = await db.supplier_part_mappings.findUnique({
    where: { id: input.mappingId },
    select: { id: true }
  })

  if (!mapping) {
    return {
      success: false,
      message: 'Mapping kaydı bulunamadı.'
    }
  }

  await db.supplier_part_mappings.update({
    where: { id: input.mappingId },
    data: {
      status: 'IGNORED',
      workflow_status: 'IGNORED',
      ignored_reason: input.reason || 'Kullanıcı tarafından ignore edildi.',
      approved_by: userId,
      approved_at: new Date()
    }
  })

  revalidateSupplierPaths()

  return {
    success: true,
    message: 'Mapping ignore edildi.'
  }
}

export async function bulkProcessSupplierMappings(input: {
  mappingIds: number[]
  action: 'approve' | 'reject'
  rejectReason?: string
}) {
  await requireAdminAuth()

  const uniqueIds = Array.from(
    new Set(input.mappingIds.filter((id) => Number.isFinite(id)))
  )
  if (uniqueIds.length === 0) {
    return {
      success: false,
      message: 'İşlem için mapping seçilmedi.',
      affected: 0
    }
  }

  let affected = 0

  if (input.action === 'reject') {
    const result = await db.supplier_part_mappings.updateMany({
      where: {
        id: { in: uniqueIds }
      },
      data: {
        status: 'IGNORED',
        workflow_status: 'IGNORED',
        ignored_reason: input.rejectReason || 'Toplu red',
        approved_at: new Date()
      }
    })

    affected = result.count
  } else {
    for (const mappingId of uniqueIds) {
      const res = await approveSupplierMapping({ mappingId })
      if (res.success) {
        affected += 1
      }
    }
  }

  revalidateSupplierPaths()

  return {
    success: true,
    message:
      input.action === 'approve'
        ? `${affected} mapping onaylandı.`
        : `${affected} mapping reddedildi.`,
    affected
  }
}

export async function testDinamikEndpoint(input: {
  endpoint: 'getBrandList' | 'getStockList' | 'getPriceList' | 'getStock'
  brand?: string
  stockCode?: string
}) {
  await requireAdminAuth()

  try {
    if (input.endpoint === 'getBrandList') {
      const data = await getBrandList()
      return {
        success: true,
        message: `${data.length} marka döndü.`,
        sample: data.slice(0, 5)
      }
    }

    if (input.endpoint === 'getStockList') {
      const brand = input.brand?.trim()
      if (!brand) {
        return {
          success: false,
          message: 'getStockList için marka girin.'
        }
      }
      const data = await getStockList(brand)
      return {
        success: true,
        message: `${brand} için ${data.length} stok satırı döndü.`,
        sample: data.slice(0, 5)
      }
    }

    if (input.endpoint === 'getPriceList') {
      const brand = input.brand?.trim()
      if (!brand) {
        return {
          success: false,
          message: 'getPriceList için marka girin.'
        }
      }
      const data = await getPriceList(brand)
      return {
        success: true,
        message: `${brand} için ${data.length} fiyat satırı döndü.`,
        sample: data.slice(0, 5)
      }
    }

    const stockCode = input.stockCode?.trim()
    if (!stockCode) {
      return {
        success: false,
        message: 'getStock için stok kodu girin.'
      }
    }

    const row = await getStockBySku(stockCode)

    return {
      success: true,
      message: row ? 'Anlık stok kaydı alındı.' : 'Stok kaydı bulunamadı.',
      sample: row ? [row] : []
    }
  } catch (error) {
    return {
      success: false,
      message:
        error instanceof Error
          ? error.message
          : 'Dinamik endpoint testi başarısız.'
    }
  }
}

export async function checkDinamikStockBySku(stockCode: string) {
  await requireAdminAuth()

  const sku = stockCode.trim()
  if (!sku) {
    return {
      success: false,
      message: 'Stok kodu zorunludur.'
    }
  }

  try {
    const row = await getStockBySku(sku)
    if (!row) {
      return {
        success: false,
        message: 'Dinamik tarafında stok kaydı bulunamadı.'
      }
    }

    return {
      success: true,
      data: {
        sku: row.stokKodu,
        brand: row.marka,
        name: row.stokAdi,
        stockQty: row.stokAdedi,
        price: row.fiyat,
        regionalStock: row.regionalStock
      }
    }
  } catch (error) {
    return {
      success: false,
      message:
        error instanceof Error
          ? error.message
          : 'Anlık stok doğrulama başarısız.'
    }
  }
}

export async function refreshDinamikStockBySku(stockCode: string) {
  await requireAdminAuth()

  const sku = stockCode.trim()
  if (!sku) {
    return {
      success: false as const,
      message: 'Stok kodu zorunludur.'
    }
  }

  try {
    const row = await getStockBySku(sku)
    if (!row) {
      return {
        success: false as const,
        message: 'Dinamik tarafında stok kaydı bulunamadı.'
      }
    }

    const provider = await ensureDinamikProvider()

    // Find the supplier_products row for this SKU
    const supplierProduct = await db.supplier_products.findUnique({
      where: {
        provider_id_supplier_sku: {
          provider_id: provider.id,
          supplier_sku: sku
        }
      },
      select: { id: true }
    })

    if (!supplierProduct) {
      // No DB record to update — return read-only result
      return {
        success: true as const,
        data: {
          sku: row.stokKodu,
          brand: row.marka,
          name: row.stokAdi,
          stockQty: row.stokAdedi,
          price: row.fiyat,
          regionalStock: row.regionalStock,
          dbUpdated: false
        }
      }
    }

    const newPrice = row.fiyat != null ? new Prisma.Decimal(row.fiyat) : null
    const newStockQty = row.stokAdedi ?? 0
    const campaignRate =
      row.campaignRate != null && row.campaignRate > 0
        ? new Prisma.Decimal(row.campaignRate)
        : null

    // Build raw_json from the API response
    const rawJson = row.raw as Prisma.InputJsonValue

    // Update supplier_products + all related offers + pricing_inventory in a tx
    const touchedPartIds: bigint[] = []

    await db.$transaction(async (tx) => {
      // 1. Update supplier_products
      await tx.supplier_products.update({
        where: { id: supplierProduct.id },
        data: {
          supplier_price: newPrice,
          supplier_stock_qty: newStockQty,
          raw_json: rawJson,
          last_seen_at: new Date()
        }
      })

      // 2. Update all part_supplier_offers that reference this supplier product
      const offers = await tx.part_supplier_offers.findMany({
        where: {
          provider_id: provider.id,
          supplier_product_id: supplierProduct.id
        },
        select: { id: true, part_id: true }
      })

      if (offers.length > 0) {
        await tx.part_supplier_offers.updateMany({
          where: {
            provider_id: provider.id,
            supplier_product_id: supplierProduct.id
          },
          data: {
            supplier_price: newPrice,
            supplier_stock_qty: newStockQty,
            campaign_rate: campaignRate,
            last_synced_at: new Date()
          }
        })

        for (const offer of offers) {
          touchedPartIds.push(offer.part_id)
        }
      }

      // 3. Update part_pricing_inventory for parts sourced from this supplier product
      if (touchedPartIds.length > 0) {
        await tx.part_pricing_inventory.updateMany({
          where: {
            source_provider_id: provider.id,
            source_supplier_product_id: supplierProduct.id
          },
          data: {
            supplier_price: newPrice,
            supplier_stock_qty: newStockQty,
            last_synced_at: new Date()
          }
        })
      }
    })

    // Re-apply pricing policy for all affected parts
    for (const partId of touchedPartIds) {
      await applyPolicyForPart(partId)
    }

    return {
      success: true as const,
      data: {
        sku: row.stokKodu,
        brand: row.marka,
        name: row.stokAdi,
        stockQty: row.stokAdedi,
        price: row.fiyat,
        regionalStock: row.regionalStock,
        dbUpdated: true,
        affectedParts: touchedPartIds.length
      }
    }
  } catch (error) {
    return {
      success: false as const,
      message:
        error instanceof Error
          ? error.message
          : 'Anlık stok güncelleme başarısız.'
    }
  }
}

export async function updateDinamikPricingPolicy(input: {
  standardDiscountRate: number
  marginRate: number
  fixedFee: number
}) {
  await requireAdminAuth()
  const provider = await ensureDinamikProvider()

  const normalizeRateInput = (value: number) => {
    const numeric = Number(value)
    if (!Number.isFinite(numeric) || numeric < 0) return null
    return numeric > 1 ? numeric / 100 : numeric
  }

  const standardDiscountRate = normalizeRateInput(input.standardDiscountRate)
  const marginRate = normalizeRateInput(input.marginRate)
  const fixedFee = Number(input.fixedFee)

  if (
    standardDiscountRate == null ||
    marginRate == null ||
    !Number.isFinite(fixedFee) ||
    fixedFee < 0
  ) {
    return {
      success: false,
      message: 'Gecerli pricing policy degerleri girin.'
    }
  }

  const normalizedPolicy = {
    standardDiscountRate: Math.min(1, standardDiscountRate),
    marginRate: Math.min(1, marginRate),
    fixedFee,
    rounding: 'HALF_UP_2' as const,
    vatMode: 'EXCLUDED' as const
  }

  const currentConfig =
    provider.config && typeof provider.config === 'object'
      ? (provider.config as Record<string, unknown>)
      : {}

  const nextConfig = {
    ...DEFAULT_DINAMIK_PROVIDER_CONFIG,
    ...currentConfig,
    pricing: normalizedPolicy
  }

  await db.supplier_providers.update({
    where: { id: provider.id },
    data: {
      config: nextConfig,
      updated_at: new Date()
    }
  })

  const impactedPartRows = await db.$queryRaw<
    Array<{ part_id: string }>
  >(Prisma.sql`
    SELECT DISTINCT o.part_id::text AS part_id
    FROM part_supplier_offers o
    WHERE o.provider_id = ${provider.id}
      AND o.is_active = TRUE
      AND o.part_id IS NOT NULL
  `)

  const impactedPartIds = impactedPartRows
    .map((row) => parsePositiveBigInt(row.part_id))
    .filter((value): value is bigint => value !== null)

  const POLICY_CONCURRENCY = 12
  for (
    let index = 0;
    index < impactedPartIds.length;
    index += POLICY_CONCURRENCY
  ) {
    const batch = impactedPartIds.slice(index, index + POLICY_CONCURRENCY)
    await Promise.all(batch.map((partId) => applyPolicyForPart(partId)))
  }

  await deleteCachePattern('catalog:prices:*')

  revalidateSupplierPaths()

  return {
    success: true,
    message: 'Dinamik pricing policy guncellendi.',
    data: {
      pricingPolicy: normalizedPolicy,
      recalculatedParts: impactedPartIds.length
    }
  }
}

export async function triggerDinamikSync(input?: {
  brand?: string
  limitBrands?: number
}) {
  await requireAdminAuth()

  const brands = input?.brand?.trim() ? [input.brand.trim()] : undefined

  try {
    const result = await runDinamikSyncJob({
      triggerType: 'MANUAL',
      brands,
      limitBrands: input?.limitBrands
    })

    revalidateSupplierPaths()

    return {
      success: true,
      message: `Senkron tamamlandı. Durum: ${result.status}`,
      data: result
    }
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Senkron başlatılamadı.'
    }
  }
}

export async function triggerSetaSync(input?: {
  mode?: 'full' | 'delta'
  brand?: string
  limitProducts?: number
}) {
  await requireAdminAuth()

  const mode = input?.mode === 'delta' ? 'delta' : 'full'
  const brand = input?.brand?.trim() || undefined
  const limitProductsRaw =
    typeof input?.limitProducts === 'number' ? input.limitProducts : undefined
  const limitProducts =
    limitProductsRaw && Number.isFinite(limitProductsRaw) && limitProductsRaw > 0
      ? Math.min(Math.trunc(limitProductsRaw), 50_000)
      : undefined

  try {
    const result = await runSetaSyncJob({
      triggerType: 'MANUAL',
      mode,
      brand,
      limitProducts
    })

    revalidateSupplierPaths()

    return {
      success: true,
      message: `SETA senkron tamamlandı. Durum: ${result.status}`,
      data: result
    }
  } catch (error) {
    return {
      success: false,
      message:
        error instanceof Error ? error.message : 'SETA senkron başlatılamadı.'
    }
  }
}

export async function triggerSetaCatalogRemap(input?: {
  limitProducts?: number
  onlyQueued?: boolean
}) {
  await requireAdminAuth()

  const limitProductsRaw =
    typeof input?.limitProducts === 'number' ? input.limitProducts : undefined
  const limitProducts =
    limitProductsRaw && Number.isFinite(limitProductsRaw) && limitProductsRaw > 0
      ? Math.min(Math.trunc(limitProductsRaw), 50_000)
      : undefined

  try {
    const result = await runSetaCatalogOemRemapJob({
      triggerType: 'MANUAL',
      limitProducts,
      onlyQueued: Boolean(input?.onlyQueued)
    })

    revalidateSupplierPaths()

    return {
      success: true,
      message: `SETA OEM remap tamamlandı. Durum: ${result.status}`,
      data: result
    }
  } catch (error) {
    return {
      success: false,
      message:
        error instanceof Error ? error.message : 'SETA OEM remap başlatılamadı.'
    }
  }
}

export async function getPartTemplateDetails(partIdRaw: string) {
  await requireAdminAuth()

  let partId: bigint
  try {
    partId = BigInt(partIdRaw)
  } catch {
    return {
      success: false,
      message: 'Geçersiz partId.'
    }
  }

  const part = await db.parts.findUnique({
    where: { id: partId },
    select: {
      category_id: true,
      brand_id: true,
      price: true,
      article_link_id: true,
      part_categories: { select: { id: true, name: true } },
      part_brands: { select: { id: true, name: true } }
    }
  })

  if (!part) {
    return {
      success: false,
      message: 'Şablon part bulunamadı.'
    }
  }

  return {
    success: true,
    data: {
      categoryId: part.category_id,
      brandId: part.brand_id,
      price: part.price != null ? Number(part.price) : null,
      articleLinkId: Number(part.article_link_id),
      categoryName: part.part_categories.name,
      brandName: part.part_brands.name
    }
  }
}
