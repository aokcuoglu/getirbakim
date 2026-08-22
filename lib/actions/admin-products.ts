'use server'

import { Prisma } from '@prisma/client'
import { parse } from 'csv-parse/sync'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { requireAdminAuth } from '@/lib/admin-auth'
import {
  calculateSellingPrice,
  resolvePricingPolicyFromProviderConfig
} from '@/lib/pricing/calculate-selling-price'
import { parseDinamikRegionalStock } from '@/lib/suppliers/dinamik-stock'
import type {
  AdminBulkUpdateInput,
  AdminDinamikProductFilters,
  AdminDinamikProductListItem,
  AdminDinamikProductsResult,
  AdminDashboardData,
  AdminImportPreviewRow,
  AdminNewImportPreviewRow,
  AdminProductKpis,
  AdminProductDetail,
  AdminProductFilters,
  AdminProductListItem,
  AdminProductSearchMeta,
  AdminProductsListResult,
  AdminProductOptions,
  AdminProductsResult,
  AdminProductsWorkbenchResult,
  AdminSortBy,
  AdminSortOrder,
  PartTechnicalReferenceInput
} from '@/lib/types/admin-products'

const DEFAULT_LIMIT = 20
const DEFAULT_DINAMIK_LIMIT = 20
const MAX_EXPORT_ROWS = 50000
const NEW_PRODUCT_TEMPLATE_PART_ID = BigInt(41055)

const SELLING_PRICE_SQL = Prisma.sql`
  CASE
    WHEN COALESCE(o.lock_price, FALSE) = TRUE
      AND o.selling_price_override IS NOT NULL
      THEN o.selling_price_override
    ELSE COALESCE(p.min_selling_price_try, 0)
  END
`

const STOCK_STATUS_SQL = Prisma.sql`
  CASE
    WHEN COALESCE(p.total_stock_qty, 0) <= 0 THEN 'OUT_OF_STOCK'
    ELSE 'IN_STOCK'
  END
`

interface AdminProductRawRow {
  id: string
  id_numeric: bigint
  article_link_id: string
  name: string
  match_rank?: number | null
  variant_count: number | null
  brand_name: string | null
  category_name: string | null
  supplier_price: string | null
  selling_price: string
  supplier_stock_qty: number | null
  available_stock_qty: number
  stock_status: 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK'
  last_synced_at: Date | null
  lock_price: boolean | null
  note: string | null
  created_at: Date
  updated_at: Date
}

interface AdminProductPagedRow extends AdminProductRawRow {
  total_products?: number
  low_stock_count?: number
  zero_price_count?: number
  sync_error_count?: number
}

interface DashboardMetricsRow {
  total_products: number
  zero_price_count: number
}

interface CountRow {
  total: number
}

interface SearchMetaRow {
  id: string
  match_rank: number
}

interface DinamikProductRawRow {
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
}

interface DinamikCountRow {
  total: number
}

interface DinamikKpiRow {
  total_products: number
  distinct_brands: number
  priced_rows: number
}

interface DinamikBrandRow {
  query_brand: string
}

interface DinamikSourceRow {
  query_brand: string | null
  part_no: string | null
  stock_code: string
  stock_name: string | null
  brand: string | null
  price: string | null
}

type ProductTemplatePart = Prisma.partsGetPayload<{
  include: {
    part_infos: true
    part_oens: true
    part_eans: true
    part_cross_references: true
    part_properties: true
    part_vehicle_types: true
    part_images: true
    part_documents: true
  }
}>

interface NewProductImportPartImage {
  image: string
  thumb: string | null
}

interface NewProductImportPartDocument {
  doc_file_name: string
  doc_file_type_name: string
  doc_id: string
  doc_type_id: number
  doc_type_name: string
  doc_url: string | null
}

interface NewProductImportTechnicalRows {
  infos: string[]
  oens: Array<{ brand: string; code: string }>
  eans: string[]
  crossReferences: Array<{ brand_name: string; article_number: string }>
  properties: Array<{ key: string; value: string }>
  vehicleTypeIds: number[]
  images: NewProductImportPartImage[]
  documents: NewProductImportPartDocument[]
}

interface NewProductImportPreparedRow {
  rowIndex: number
  partId: bigint
  articleLinkId: bigint
  name: string
  brandId: number
  categoryId: number
  partNo?: string | null
  price?: number | null
  inBasket: boolean
  adminOverride?: {
    sellingPriceOverride?: number | null
    lockPrice?: boolean
    note?: string
  }
  technical: NewProductImportTechnicalRows
}

interface ParsedJsonColumn<T> {
  specified: boolean
  value: T | null
  error: string | null
}

function normalizeSortBy(sortBy: string | undefined): AdminSortBy {
  const allowed: AdminSortBy[] = [
    'created_at',
    'name',
    'selling_price',
    'supplier_stock_qty',
    'last_synced_at'
  ]
  return allowed.includes(sortBy as AdminSortBy)
    ? (sortBy as AdminSortBy)
    : 'created_at'
}

function normalizeSortOrder(sortOrder: string | undefined): AdminSortOrder {
  return sortOrder === 'asc' ? 'asc' : 'desc'
}

function normalizeFilters(
  input: AdminProductFilters
): Required<AdminProductFilters> {
  const page =
    Number.isFinite(input.page) && (input.page ?? 0) > 0
      ? Number(input.page)
      : 1
  const limit =
    Number.isFinite(input.limit) && (input.limit ?? 0) > 0
      ? Math.min(Number(input.limit), 100)
      : DEFAULT_LIMIT

  return {
    q: (input.q || '').trim(),
    page,
    limit,
    brandId: input.brandId ?? null,
    categoryId: input.categoryId ?? null,
    stockStatus: input.stockStatus || 'all',
    sortBy: normalizeSortBy(input.sortBy),
    sortOrder: normalizeSortOrder(input.sortOrder)
  }
}

function normalizeDinamikFilters(
  input: AdminDinamikProductFilters
): Required<AdminDinamikProductFilters> {
  const page =
    Number.isFinite(input.page) && (input.page ?? 0) > 0
      ? Number(input.page)
      : 1
  const limit =
    Number.isFinite(input.limit) && (input.limit ?? 0) > 0
      ? Math.min(Number(input.limit), 100)
      : DEFAULT_DINAMIK_LIMIT

  return {
    q: (input.q || '').trim(),
    queryBrand:
      input.queryBrand && input.queryBrand !== 'all'
        ? input.queryBrand.trim() || null
        : null,
    page,
    limit
  }
}

function toNumber(
  value: string | number | null | undefined,
  fallback: number = 0
): number {
  if (value == null) return fallback
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : fallback
}

function toNullableNumber(
  value: string | number | null | undefined
): number | null {
  if (value == null || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

function normalizeTextValue(value: string | null | undefined): string | null {
  const text = (value || '').trim()
  return text.length > 0 ? text : null
}

function normalizeUniqueTexts(values: string[]): string[] {
  const unique = new Set<string>()
  for (const value of values) {
    const normalized = normalizeTextValue(value)
    if (normalized) unique.add(normalized)
  }
  return Array.from(unique)
}

function formatDate(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null
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

function mapProductRow(row: AdminProductRawRow): AdminProductListItem {
  return {
    id: row.id,
    articleLinkId: row.article_link_id,
    name: row.name,
    variantCount: row.variant_count ?? 1,
    brand: row.brand_name,
    category: row.category_name,
    supplierPrice: toNullableNumber(row.supplier_price),
    sellingPrice: toNumber(row.selling_price, 0),
    supplierStockQty: row.supplier_stock_qty ?? 0,
    availableStockQty: row.available_stock_qty,
    stockStatus: row.stock_status,
    lastSyncedAt: formatDate(row.last_synced_at),
    lockPrice: row.lock_price ?? false,
    note: row.note,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  }
}

function mapDinamikProductRow(
  row: DinamikProductRawRow
): AdminDinamikProductListItem {
  return {
    queryBrand: row.query_brand,
    partNo: row.part_no,
    stockCode: row.stock_code,
    stockName: row.stock_name,
    brand: row.brand,
    price: toNullableNumber(row.price),
    barcode1: row.barcode_1,
    barcode2: row.barcode_2,
    barcode3: row.barcode_3,
    updatedAt: formatDate(row.updated_at)
  }
}

function buildDinamikWhereSql(filters: Required<AdminDinamikProductFilters>) {
  const conditions: Prisma.Sql[] = [Prisma.sql`1=1`]

  if (filters.q) {
    const like = `%${filters.q}%`
    conditions.push(
      Prisma.sql`(
        d.stock_code ILIKE ${like}
        OR COALESCE(d.part_no, '') ILIKE ${like}
        OR COALESCE(d.stock_name, '') ILIKE ${like}
        OR COALESCE(d.brand, '') ILIKE ${like}
        OR COALESCE(d.query_brand, '') ILIKE ${like}
      )`
    )
  }

  if (filters.queryBrand) {
    conditions.push(Prisma.sql`d.query_brand = ${filters.queryBrand}`)
  }

  return Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`
}

function isCodeLikeSearch(query: string) {
  return /^[a-z0-9._/-]+$/i.test(query) && !/\s/.test(query)
}

function buildAdminProductSearchClauses(query: string) {
  const raw = query.trim()
  const normalized = raw.toLowerCase()
  const prefix = `${raw}%`
  const normalizedPrefix = `${normalized}%`
  const contains = `%${raw}%`
  const preferCodeMatches = isCodeLikeSearch(raw)

  const exactClause = Prisma.sql`(
    CAST(p.id AS TEXT) = ${raw}
    OR lower(p.part_no) = ${normalized}
    OR EXISTS (
      SELECT 1
      FROM catalog.product_oems po
      WHERE po.product_id = p.id AND lower(po.code) = ${normalized}
    )
    OR EXISTS (
      SELECT 1
      FROM catalog.product_offers pso
      WHERE pso.product_id = p.id AND lower(pso.supplier_sku) = ${normalized}
    )
    OR EXISTS (
      SELECT 1
      FROM catalog.product_eans pe
      WHERE pe.product_id = p.id AND lower(pe.code) = ${normalized}
    )
  )`

  const prefixClause = Prisma.sql`(
    CAST(p.id AS TEXT) LIKE ${prefix}
    OR lower(p.part_no) LIKE ${normalizedPrefix}
    OR EXISTS (
      SELECT 1
      FROM catalog.product_oems po
      WHERE po.product_id = p.id AND lower(po.code) LIKE ${normalizedPrefix}
    )
    OR EXISTS (
      SELECT 1
      FROM catalog.product_offers pso
      WHERE pso.product_id = p.id AND lower(pso.supplier_sku) LIKE ${normalizedPrefix}
    )
    OR EXISTS (
      SELECT 1
      FROM catalog.product_eans pe
      WHERE pe.product_id = p.id AND lower(pe.code) LIKE ${normalizedPrefix}
    )
  )`

  const fuzzyCodeClause = Prisma.sql`(
    lower(p.part_no) LIKE ${`%${normalized}%`}
    OR EXISTS (
      SELECT 1
      FROM catalog.product_oems po
      WHERE po.product_id = p.id AND po.code ILIKE ${contains}
    )
    OR EXISTS (
      SELECT 1
      FROM catalog.product_offers pso
      WHERE pso.product_id = p.id AND pso.supplier_sku ILIKE ${contains}
    )
    OR EXISTS (
      SELECT 1
      FROM catalog.product_eans pe
      WHERE pe.product_id = p.id AND pe.code ILIKE ${contains}
    )
  )`

  const fuzzyNameClause = Prisma.sql`(
    p.name ILIKE ${contains}
    OR ${fuzzyCodeClause}
  )`

  return {
    normalized,
    exactClause,
    prefixClause,
    fuzzyClause: preferCodeMatches ? fuzzyCodeClause : fuzzyNameClause
  }
}

function buildMatchRankSql(query: string) {
  if (!query) {
    return Prisma.sql`3`
  }

  const clauses = buildAdminProductSearchClauses(query)
  return Prisma.sql`
    CASE
      WHEN ${clauses.exactClause} THEN 0
      WHEN ${clauses.prefixClause} THEN 1
      WHEN ${clauses.fuzzyClause} THEN 2
      ELSE 3
    END
  `
}

function buildWhereSql(filters: Required<AdminProductFilters>) {
  const conditions: Prisma.Sql[] = [Prisma.sql`1=1`]

  if (filters.q) {
    const clauses = buildAdminProductSearchClauses(filters.q)
    conditions.push(
      Prisma.sql`(
        ${clauses.exactClause}
        OR ${clauses.prefixClause}
        OR ${clauses.fuzzyClause}
      )`
    )
  }

  if (filters.brandId) {
    conditions.push(Prisma.sql`p.brand_id = ${filters.brandId}`)
  }

  if (filters.categoryId) {
    conditions.push(Prisma.sql`p.category_id = ${filters.categoryId}`)
  }

  if (filters.stockStatus === 'in_stock') {
    conditions.push(
      Prisma.sql`COALESCE(p.total_stock_qty, 0) > 0`
    )
  } else if (filters.stockStatus === 'out_of_stock') {
    conditions.push(Prisma.sql`COALESCE(p.total_stock_qty, 0) <= 0`)
  } else if (filters.stockStatus === 'zero_price') {
    conditions.push(Prisma.sql`${SELLING_PRICE_SQL} <= 0`)
  }

  return Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`
}

function buildSortSql(filters: Required<AdminProductFilters>) {
  const { sortBy, sortOrder, q } = filters
  const direction = sortOrder === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`

  const sortMap: Record<AdminSortBy, Prisma.Sql> = {
    created_at: Prisma.sql`d.created_at`,
    name: Prisma.sql`d.name`,
    selling_price: Prisma.sql`d.selling_price_numeric`,
    supplier_stock_qty: Prisma.sql`d.supplier_stock_qty`,
    last_synced_at: Prisma.sql`COALESCE(d.last_synced_at, d.updated_at)`
  }

  return q
    ? Prisma.sql`ORDER BY d.match_rank ASC, ${sortMap[sortBy]} ${direction}, d.id_numeric DESC`
    : Prisma.sql`ORDER BY ${sortMap[sortBy]} ${direction}, d.id_numeric DESC`
}

function buildBaseProductsSelect(
  filters: Required<AdminProductFilters>,
  whereSql: Prisma.Sql
) {
  return Prisma.sql`
    SELECT
      p.id::text AS id,
      p.id AS id_numeric,
      COALESCE(pp.article_link_id, p.id)::text AS article_link_id,
      p.name,
      ${buildMatchRankSql(filters.q)} AS match_rank,
      1::int AS variant_count,
      b.name AS brand_name,
      c.name AS category_name,
      NULL::text AS supplier_price,
      ${SELLING_PRICE_SQL}::text AS selling_price,
      ${SELLING_PRICE_SQL} AS selling_price_numeric,
      COALESCE(p.total_stock_qty, 0) AS supplier_stock_qty,
      COALESCE(p.total_stock_qty, 0) AS available_stock_qty,
      ${STOCK_STATUS_SQL} AS stock_status,
      offer_sync.last_synced_at,
      COALESCE(o.lock_price, FALSE) AS lock_price,
      o.note,
      p.created_at,
      p.updated_at
    FROM catalog.products p
    LEFT JOIN catalog.brands b ON b.id = p.brand_id
    LEFT JOIN part_categories c ON c.id = p.category_id
    LEFT JOIN parts pp ON pp.id = p.primary_part_id
    LEFT JOIN catalog.product_overrides o ON o.product_id = p.id
    LEFT JOIN LATERAL (
      SELECT MAX(po.last_synced_at) AS last_synced_at
      FROM catalog.product_offers po
      WHERE po.product_id = p.id AND po.is_active = TRUE
    ) offer_sync ON TRUE
    ${whereSql}
  `
}

async function queryAdminProductsRows(
  filters: Required<AdminProductFilters>,
  options: { limit: number; offset: number }
): Promise<AdminProductPagedRow[]> {
  const whereSql = buildWhereSql(filters)
  const orderBySql = buildSortSql(filters)
  const baseSelect = buildBaseProductsSelect(filters, whereSql)

  // Prisma-first hybrid rule:
  // This query intentionally stays as SQL because it relies on computed columns
  // + dedup/ordering semantics that are not expressible in Prisma without
  // multiple queries and larger in-memory post-processing.
  // Performance reference: docs/perf/data-access-benchmarks.md
  return db.$queryRaw<AdminProductPagedRow[]>(Prisma.sql`
    SELECT
      d.id,
      d.id_numeric,
      d.article_link_id,
      d.name,
      d.match_rank,
      d.variant_count,
      d.brand_name,
      d.category_name,
      d.supplier_price,
      d.selling_price,
      d.selling_price_numeric,
      d.supplier_stock_qty,
      d.available_stock_qty,
      d.stock_status,
      d.last_synced_at,
      d.lock_price,
      d.note,
      d.created_at,
      d.updated_at
    FROM (
      ${baseSelect}
    ) d
    ${orderBySql}
    LIMIT ${options.limit}
    OFFSET ${options.offset}
  `)
}

async function queryAdminProductsMetrics(
  filters: Required<AdminProductFilters>
): Promise<DashboardMetricsRow> {
  const whereSql = buildWhereSql(filters)
  const baseSelect = buildBaseProductsSelect(filters, whereSql)

  // SQL is intentional for aggregate KPIs over computed fields from baseSelect.
  // Performance reference: docs/perf/data-access-benchmarks.md
  const rows = await db.$queryRaw<DashboardMetricsRow[]>(Prisma.sql`
    SELECT
      COUNT(*)::int AS total_products,
      COALESCE(
        SUM(CASE WHEN d.selling_price_numeric <= 0 THEN 1 ELSE 0 END),
        0
      )::int AS zero_price_count
    FROM (
      ${baseSelect}
    ) d
  `)

  return (
    rows[0] ?? {
      total_products: 0,
      zero_price_count: 0
    }
  )
}

async function queryAdminProductsTotal(
  filters: Required<AdminProductFilters>
): Promise<number> {
  const whereSql = buildWhereSql(filters)
  const baseSelect = buildBaseProductsSelect(filters, whereSql)

  // SQL is intentional to preserve exact count parity with queryAdminProductsRows.
  // Performance reference: docs/perf/data-access-benchmarks.md
  const rows = await db.$queryRaw<CountRow[]>(Prisma.sql`
    SELECT COUNT(*)::int AS total
    FROM (
      ${baseSelect}
    ) d
  `)

  return rows[0]?.total ?? 0
}

function buildCsvCell(value: string | number | boolean | null): string {
  if (value == null) return ''
  const text = String(value)
  if (text.includes(',') || text.includes('"') || text.includes('\n')) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

function parseBooleanValue(value: unknown): {
  value: boolean | undefined
  error: string | null
} {
  if (value == null || value === '') {
    return { value: undefined, error: null }
  }

  const normalized = String(value).trim().toLowerCase()
  if (['1', 'true', 'yes', 'evet'].includes(normalized)) {
    return { value: true, error: null }
  }
  if (['0', 'false', 'no', 'hayir'].includes(normalized)) {
    return { value: false, error: null }
  }

  return {
    value: undefined,
    error: `Geçersiz boolean değeri: ${String(value)}`
  }
}

function parseNumberValue(value: unknown): {
  value: number | null | undefined
  error: string | null
} {
  if (value == null || value === '') {
    return { value: undefined, error: null }
  }

  const text = String(value).trim()
  if (text.toLowerCase() === 'null') {
    return { value: null, error: null }
  }

  const n = Number(text)
  if (!Number.isFinite(n)) {
    return { value: undefined, error: `Geçersiz sayı değeri: ${text}` }
  }

  return { value: n, error: null }
}

function revalidateAdminPaths() {
  revalidatePath('/admin')
  revalidatePath('/admin/products')
  revalidatePath('/tr/admin')
  revalidatePath('/tr/admin/products')
  revalidatePath('/en/admin')
  revalidatePath('/en/admin/products')
}

async function getAdminUserId() {
  const auth = await requireAdminAuth()
  if (!auth?.user?.id) {
    throw new Error('Yetkisiz işlem.')
  }
  return auth.user.id
}

function generateRandomPartId(): bigint {
  return BigInt(
    `${Date.now()}${Math.floor(Math.random() * 1000)
      .toString()
      .padStart(3, '0')}`
  )
}

function parseJsonColumn<T>(value: unknown): ParsedJsonColumn<T> {
  if (value == null || value === '') {
    return { specified: false, value: null, error: null }
  }

  const text = String(value).trim()
  if (!text) {
    return { specified: false, value: null, error: null }
  }

  try {
    return {
      specified: true,
      value: JSON.parse(text) as T,
      error: null
    }
  } catch (error) {
    return {
      specified: true,
      value: null,
      error: error instanceof Error ? error.message : 'JSON parse hatası'
    }
  }
}

function buildNewProductTechnicalRowsFromTemplate(
  templatePart: ProductTemplatePart
): NewProductImportTechnicalRows {
  return {
    infos: normalizeUniqueTexts(templatePart.part_infos.map((item) => item.content)),
    oens: templatePart.part_oens.map((item) => ({
      brand: item.brand,
      code: item.code
    })),
    eans: normalizeUniqueTexts(templatePart.part_eans.map((item) => item.code)),
    crossReferences: templatePart.part_cross_references.map((item) => ({
      brand_name: item.brand_name,
      article_number: item.article_number
    })),
    properties: templatePart.part_properties.map((item) => ({
      key: item.key,
      value: item.value
    })),
    vehicleTypeIds: Array.from(
      new Set(templatePart.part_vehicle_types.map((item) => item.vehicle_type_id))
    ),
    images: templatePart.part_images
      .map((item) => ({
        image: normalizeTextValue(item.image),
        thumb: normalizeTextValue(item.thumb)
      }))
      .filter((item): item is NewProductImportPartImage => Boolean(item.image)),
    documents: templatePart.part_documents.map((item) => ({
      doc_file_name: item.doc_file_name,
      doc_file_type_name: item.doc_file_type_name,
      doc_id: item.doc_id,
      doc_type_id: item.doc_type_id,
      doc_type_name: item.doc_type_name,
      doc_url: item.doc_url
    }))
  }
}

async function fetchNewProductTemplatePart(
  templatePartId: bigint
): Promise<ProductTemplatePart | null> {
  return db.parts.findUnique({
    where: { id: templatePartId },
    include: {
      part_infos: true,
      part_oens: true,
      part_eans: true,
      part_cross_references: true,
      part_properties: true,
      part_vehicle_types: true,
      part_images: true,
      part_documents: true
    }
  })
}

function mapAdminMetricsRow(metrics: DashboardMetricsRow): AdminProductKpis {
  return {
    totalProducts: metrics.total_products ?? 0,
    zeroPriceCount: metrics.zero_price_count ?? 0
  }
}

export async function getAdminProductsList(
  input: AdminProductFilters = {}
): Promise<AdminProductsListResult> {
  await requireAdminAuth()

  const filters = normalizeFilters(input)
  const offset = (filters.page - 1) * filters.limit
  const [rows, total] = await Promise.all([
    queryAdminProductsRows(filters, { limit: filters.limit, offset }),
    queryAdminProductsTotal(filters)
  ])

  return {
    filters,
    products: rows.map(mapProductRow),
    pagination: {
      page: filters.page,
      limit: filters.limit,
      total,
      pages: Math.max(Math.ceil(total / filters.limit), 1)
    }
  }
}

export async function getAdminProductKpis(
  input: AdminProductFilters = {}
): Promise<AdminProductKpis> {
  await requireAdminAuth()
  const filters = normalizeFilters(input)
  const metrics = await queryAdminProductsMetrics(filters)
  return mapAdminMetricsRow(metrics)
}

export async function getAdminDinamikProducts(
  input: AdminDinamikProductFilters = {}
): Promise<AdminDinamikProductsResult> {
  await requireAdminAuth()

  const filters = normalizeDinamikFilters(input)
  const offset = (filters.page - 1) * filters.limit
  const whereSql = buildDinamikWhereSql(filters)

  const [rows, countRows, kpiRows, brandRows, brands, categories] =
    await Promise.all([
      db.$queryRaw<DinamikProductRawRow[]>(Prisma.sql`
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
      ${whereSql}
      ORDER BY d.updated_at DESC NULLS LAST, d.stock_code ASC
      LIMIT ${filters.limit}
      OFFSET ${offset}
    `),
      db.$queryRaw<DinamikCountRow[]>(Prisma.sql`
      SELECT COUNT(*)::int AS total
      FROM dinamik.products d
      ${whereSql}
    `),
      db.$queryRaw<DinamikKpiRow[]>(Prisma.sql`
      SELECT
        COUNT(*)::int AS total_products,
        COUNT(
          DISTINCT NULLIF(TRIM(COALESCE(d.query_brand, '')), '')
        )::int AS distinct_brands,
        COALESCE(
          SUM(
            CASE
              WHEN NULLIF(TRIM(COALESCE(d.price::text, '')), '') IS NOT NULL THEN 1
              ELSE 0
            END
          ),
          0
        )::int AS priced_rows
      FROM dinamik.products d
      ${whereSql}
    `),
      db.$queryRaw<DinamikBrandRow[]>(Prisma.sql`
      SELECT DISTINCT d.query_brand
      FROM dinamik.products d
      WHERE d.query_brand IS NOT NULL
        AND d.query_brand <> ''
      ORDER BY d.query_brand ASC
      LIMIT 500
    `),
      db.part_brands.findMany({
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
        take: 500
      }),
      db.part_categories.findMany({
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
        take: 500
      })
    ])

  const total = countRows[0]?.total ?? 0
  const kpis = kpiRows[0] ?? {
    total_products: 0,
    distinct_brands: 0,
    priced_rows: 0
  }

  return {
    filters,
    products: rows.map(mapDinamikProductRow),
    pagination: {
      page: filters.page,
      limit: filters.limit,
      total,
      pages: Math.max(Math.ceil(total / filters.limit), 1)
    },
    kpis: {
      totalProducts: kpis.total_products,
      distinctBrands: kpis.distinct_brands,
      pricedRows: kpis.priced_rows
    },
    options: {
      queryBrands: brandRows.map((row) => row.query_brand),
      brands,
      categories
    }
  }
}

export async function createAdminPartFromDinamik(input: {
  stockCode: string
  queryBrand?: string | null
  name: string
  articleLinkId: number
  price?: number | null
  brandId: number
  categoryId: number
  inBasket?: boolean
  note?: string | null
}): Promise<{
  success: boolean
  message: string
  data?: { partId: string; stockCode: string }
}> {
  await requireAdminAuth()

  const stockCode = (input.stockCode || '').trim()
  if (!stockCode) {
    return { success: false, message: 'Stok kodu zorunludur.' }
  }

  const queryBrand = input.queryBrand?.trim() || null
  const name = (input.name || '').trim()
  if (!name) {
    return { success: false, message: 'Ürün adı zorunludur.' }
  }

  const articleLinkId = Math.trunc(Number(input.articleLinkId))
  if (!Number.isFinite(articleLinkId) || articleLinkId <= 0) {
    return { success: false, message: 'Geçerli bir Article Link ID girin.' }
  }

  const brandId = Math.trunc(Number(input.brandId))
  const categoryId = Math.trunc(Number(input.categoryId))
  if (!Number.isFinite(brandId) || brandId <= 0) {
    return { success: false, message: 'Geçerli bir marka seçin.' }
  }
  if (!Number.isFinite(categoryId) || categoryId <= 0) {
    return { success: false, message: 'Geçerli bir kategori seçin.' }
  }

  const rawPrice = input.price == null ? null : Number(input.price)
  const price = rawPrice == null || Number.isNaN(rawPrice) ? null : rawPrice
  if (price != null && (!Number.isFinite(price) || price < 0)) {
    return { success: false, message: 'Geçerli bir fiyat girin.' }
  }

  const brandCondition = queryBrand
    ? Prisma.sql`AND d.query_brand = ${queryBrand}`
    : Prisma.sql``
  const sourceRows = await db.$queryRaw<DinamikSourceRow[]>(Prisma.sql`
    SELECT
      d.query_brand,
      d.part_no,
      d.stock_code,
      d.stock_name,
      d.brand,
      d.price::text AS price
    FROM dinamik.products d
    WHERE d.stock_code = ${stockCode}
      ${brandCondition}
    ORDER BY d.updated_at DESC
    LIMIT 1
  `)
  const source = sourceRows[0]

  if (!source) {
    return { success: false, message: 'Dinamik kaydı bulunamadı.' }
  }

  const [brand, category] = await Promise.all([
    db.part_brands.findUnique({ where: { id: brandId }, select: { id: true } }),
    db.part_categories.findUnique({
      where: { id: categoryId },
      select: { id: true }
    })
  ])
  if (!brand) return { success: false, message: 'Seçilen marka bulunamadı.' }
  if (!category)
    return { success: false, message: 'Seçilen kategori bulunamadı.' }

  const existingMapped = await db.$queryRaw<
    Array<{ part_id: string }>
  >(Prisma.sql`
    SELECT m.part_id::text AS part_id
    FROM supplier_part_mappings m
    JOIN supplier_providers sp ON sp.id = m.provider_id
    WHERE sp.code = 'dinamik'
      AND m.supplier_sku = ${stockCode}
      AND m.part_id IS NOT NULL
      AND m.status = 'APPROVED'
    ORDER BY m.updated_at DESC
    LIMIT 1
  `)
  if (existingMapped[0]?.part_id) {
    return {
      success: false,
      message: `${stockCode} zaten public part #${existingMapped[0].part_id} ile eşleşmiş.`
    }
  }

  const partId = BigInt(
    `${Date.now()}${Math.floor(Math.random() * 1000)
      .toString()
      .padStart(3, '0')}`
  )

  let createdPartId = ''
  try {
    const sourcePrice = source.price != null ? Number(source.price) : null
    const supplierPrice =
      sourcePrice != null && Number.isFinite(sourcePrice) ? sourcePrice : price

    const createdPart = await db.parts.create({
      data: {
        id: partId,
        name,
        article_link_id: BigInt(articleLinkId),
        price: price != null ? new Prisma.Decimal(price) : null,
        brand_id: brandId,
        category_id: categoryId,
        in_basket: Boolean(input.inBasket)
      },
      select: { id: true }
    })
    createdPartId = createdPart.id.toString()

    // A legacy part has no supplier provenance, so it cannot truthfully create
    // a canonical product_offer. Supplier pricing is intentionally not copied.
    void supplierPrice
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Public part oluşturulurken hata oluştu.'
    return { success: false, message }
  }

  // Old Dinamik→part supplier-mapping removed with the retired supplier system
  // (superseded by the catalog pipeline). Part creation no longer maps offers.
  void queryBrand
  revalidateAdminPaths()

  return {
    success: true,
    message: `${stockCode} için public part #${createdPartId} oluşturuldu ve eşleşme kaydedildi.`,
    data: {
      partId: createdPartId,
      stockCode
    }
  }
}

export async function createAdminPartFromTemplate(input: {
  templatePartId: string
  stockCode: string
  queryBrand?: string | null
  name: string
  articleLinkId: number
  price?: number | null
  brandId: number
  categoryId: number
  inBasket?: boolean
  note?: string | null
}): Promise<{
  success: boolean
  message: string
  data?: { partId: string; stockCode: string }
}> {
  await requireAdminAuth()

  let templatePartIdBigInt: bigint
  try {
    templatePartIdBigInt = BigInt(input.templatePartId)
  } catch {
    return { success: false, message: 'Geçersiz şablon part ID.' }
  }

  const stockCode = (input.stockCode || '').trim()
  if (!stockCode) {
    return { success: false, message: 'Stok kodu zorunludur.' }
  }

  const queryBrand = input.queryBrand?.trim() || null
  const name = (input.name || '').trim()
  if (!name) {
    return { success: false, message: 'Ürün adı zorunludur.' }
  }

  const articleLinkId = Math.trunc(Number(input.articleLinkId))
  if (!Number.isFinite(articleLinkId) || articleLinkId <= 0) {
    return { success: false, message: 'Geçerli bir Article Link ID girin.' }
  }

  const brandId = Math.trunc(Number(input.brandId))
  const categoryId = Math.trunc(Number(input.categoryId))
  if (!Number.isFinite(brandId) || brandId <= 0) {
    return { success: false, message: 'Geçerli bir marka seçin.' }
  }
  if (!Number.isFinite(categoryId) || categoryId <= 0) {
    return { success: false, message: 'Geçerli bir kategori seçin.' }
  }

  const rawPrice = input.price == null ? null : Number(input.price)
  const price = rawPrice == null || Number.isNaN(rawPrice) ? null : rawPrice
  if (price != null && (!Number.isFinite(price) || price < 0)) {
    return { success: false, message: 'Geçerli bir fiyat girin.' }
  }

  const templatePart = await db.parts.findUnique({
    where: { id: templatePartIdBigInt },
    include: {
      part_oens: true,
      part_cross_references: true,
      part_properties: true,
      part_vehicle_types: true,
      part_eans: true
    }
  })

  if (!templatePart) {
    return { success: false, message: 'Şablon ürün bulunamadı.' }
  }

  const brandCondition = queryBrand
    ? Prisma.sql`AND d.query_brand = ${queryBrand}`
    : Prisma.sql``
  const sourceRows = await db.$queryRaw<DinamikSourceRow[]>(Prisma.sql`
    SELECT
      d.query_brand,
      d.part_no,
      d.stock_code,
      d.stock_name,
      d.brand,
      d.price::text AS price
    FROM dinamik.products d
    WHERE d.stock_code = ${stockCode}
      ${brandCondition}
    ORDER BY d.updated_at DESC
    LIMIT 1
  `)
  const source = sourceRows[0]

  if (!source) {
    return { success: false, message: 'Dinamik kaydı bulunamadı.' }
  }

  const existingMapped = await db.$queryRaw<
    Array<{ part_id: string }>
  >(Prisma.sql`
    SELECT m.part_id::text AS part_id
    FROM supplier_part_mappings m
    JOIN supplier_providers sp ON sp.id = m.provider_id
    WHERE sp.code = 'dinamik'
      AND m.supplier_sku = ${stockCode}
      AND m.part_id IS NOT NULL
      AND m.status = 'APPROVED'
    ORDER BY m.updated_at DESC
    LIMIT 1
  `)
  if (existingMapped[0]?.part_id) {
    return {
      success: false,
      message: `${stockCode} zaten public part #${existingMapped[0].part_id} ile eşleşmiş.`
    }
  }

  const partId = BigInt(
    `${Date.now()}${Math.floor(Math.random() * 1000)
      .toString()
      .padStart(3, '0')}`
  )
  const createdPartId = partId.toString()

  const sourcePrice = source.price != null ? Number(source.price) : null
  const supplierPrice =
    sourcePrice != null && Number.isFinite(sourcePrice) ? sourcePrice : price

  try {
    await db.$transaction(async (tx) => {
      await tx.parts.create({
        data: {
          id: partId,
          name,
          article_link_id: BigInt(articleLinkId),
          price: price != null ? new Prisma.Decimal(price) : null,
          brand_id: brandId,
          category_id: categoryId,
          in_basket: Boolean(input.inBasket)
        }
      })

      // No canonical offer is created without supplier provenance.
      void supplierPrice

      if (templatePart.part_oens.length > 0) {
        await tx.part_oens.createMany({
          data: templatePart.part_oens.map((oen) => ({
            part_id: partId,
            brand: oen.brand,
            code: oen.code
          }))
        })
      }

      if (templatePart.part_cross_references.length > 0) {
        await tx.part_cross_references.createMany({
          data: templatePart.part_cross_references.map((cross) => ({
            part_id: partId,
            brand_name: cross.brand_name,
            article_number: cross.article_number
          }))
        })
      }

      if (templatePart.part_eans.length > 0) {
        await tx.part_eans.createMany({
          data: templatePart.part_eans.map((ean) => ({
            part_id: partId,
            code: ean.code
          }))
        })
      }

      if (templatePart.part_vehicle_types.length > 0) {
        await tx.part_vehicle_types.createMany({
          data: templatePart.part_vehicle_types.map((vt) => ({
            part_id: partId,
            vehicle_type_id: vt.vehicle_type_id
          }))
        })
      }

      if (templatePart.part_properties.length > 0) {
        await createPartPropertiesRows(
          tx,
          partId,
          templatePart.part_properties.map((prop) => ({
            key: prop.key,
            value: prop.value
          }))
        )
      }
    })
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Public part (şablondan) oluşturulurken hata oluştu.'
    return { success: false, message }
  }

  // Old Dinamik→part supplier-mapping removed with the retired supplier system.
  void queryBrand
  revalidateAdminPaths()

  return {
    success: true,
    message: `${stockCode} için şablondan public part #${createdPartId} oluşturuldu ve eşleşme kaydedildi.`,
    data: { partId: createdPartId, stockCode }
  }
}

export async function searchAdminProductTemplates(input: {
  q?: string
  limit?: number
}): Promise<
  Array<{
    partId: string
    articleLinkId: string
    partNo: string | null
    name: string
    brand: string | null
    category: string | null
    imageUrl: string | null
  }>
> {
  await requireAdminAuth()

  const query = (input.q || '').trim()
  if (query.length < 2) return []

  const limit =
    Number.isFinite(input.limit) && (input.limit ?? 0) > 0
      ? Math.min(Number(input.limit), 20)
      : 10

  const like = `%${query}%`

  const rows = await db.$queryRaw<
    Array<{
      part_id: string
      article_link_id: string
      part_no: string | null
      name: string
      brand_name: string | null
      category_name: string | null
      image_url: string | null
    }>
  >(Prisma.sql`
    SELECT
      p.id::text AS part_id,
      p.article_link_id::text AS article_link_id,
      CAST(p.part_no AS TEXT) AS part_no,
      p.name,
      b.name AS brand_name,
      c.name AS category_name,
      (
        SELECT pi.image
        FROM part_images pi
        WHERE pi.part_id = p.id
        ORDER BY pi.id ASC
        LIMIT 1
      ) AS image_url
    FROM parts p
    LEFT JOIN part_brands b ON b.id = p.brand_id
    LEFT JOIN part_categories c ON c.id = p.category_id
    WHERE (
      CAST(p.id AS TEXT) ILIKE ${like}
      OR CAST(p.article_link_id AS TEXT) ILIKE ${like}
      OR COALESCE(CAST(p.part_no AS TEXT), '') ILIKE ${like}
      OR p.name ILIKE ${like}
      OR EXISTS (
        SELECT 1
        FROM part_oens po
        WHERE po.part_id = p.id
          AND (po.code ILIKE ${like} OR po.brand ILIKE ${like})
      )
      OR EXISTS (
        SELECT 1
        FROM part_cross_references pcr
        WHERE pcr.part_id = p.id
          AND (
            pcr.article_number ILIKE ${like}
            OR pcr.brand_name ILIKE ${like}
          )
      )
      OR EXISTS (
        SELECT 1
        FROM part_eans pe
        WHERE pe.part_id = p.id
          AND pe.code ILIKE ${like}
      )
    )
    ORDER BY p.updated_at DESC
    LIMIT ${limit}
  `)

  return rows.map((row) => ({
    partId: row.part_id,
    articleLinkId: row.article_link_id,
    partNo: row.part_no,
    name: row.name,
    brand: row.brand_name,
    category: row.category_name,
    imageUrl: row.image_url
  }))
}

export async function getAdminProductTemplateDetail(
  partIdRaw: string
): Promise<{
  success: boolean
  message?: string
  data?: {
    partId: string
    name: string
    articleLinkId: string
    brandId: number | null
    categoryId: number | null
    price: number | null
    inBasket: boolean
  }
}> {
  await requireAdminAuth()

  let templatePartId: bigint
  try {
    templatePartId = BigInt(partIdRaw)
  } catch {
    return { success: false, message: 'Geçersiz şablon ürün kimliği.' }
  }

  const template = await db.parts.findUnique({
    where: { id: templatePartId },
    select: {
      id: true,
      name: true,
      article_link_id: true,
      brand_id: true,
      category_id: true,
      price: true,
      in_basket: true
    }
  })

  if (!template) {
    return { success: false, message: 'Şablon ürün bulunamadı.' }
  }

  return {
    success: true,
    data: {
      partId: template.id.toString(),
      name: template.name,
      articleLinkId: template.article_link_id.toString(),
      brandId: template.brand_id,
      categoryId: template.category_id,
      price: template.price != null ? Number(template.price) : null,
      inBasket: template.in_basket
    }
  }
}

export async function createAdminProductFromTemplate(input: {
  templatePartId: string
  name: string
  articleLinkId: number
  price?: number | null
  brandId: number
  categoryId: number
  inBasket?: boolean
}): Promise<{ success: boolean; message: string; data?: { partId: string } }> {
  await requireAdminAuth()

  let templatePartIdBigInt: bigint
  try {
    templatePartIdBigInt = BigInt(input.templatePartId)
  } catch {
    return { success: false, message: 'Geçersiz şablon ürün kimliği.' }
  }

  const name = (input.name || '').trim()
  if (!name) {
    return { success: false, message: 'Ürün adı zorunludur.' }
  }

  const articleLinkId = Math.trunc(Number(input.articleLinkId))
  if (!Number.isFinite(articleLinkId) || articleLinkId <= 0) {
    return { success: false, message: 'Geçerli bir Article Link ID girin.' }
  }

  const brandId = Math.trunc(Number(input.brandId))
  const categoryId = Math.trunc(Number(input.categoryId))
  if (!Number.isFinite(brandId) || brandId <= 0) {
    return { success: false, message: 'Geçerli bir marka seçin.' }
  }
  if (!Number.isFinite(categoryId) || categoryId <= 0) {
    return { success: false, message: 'Geçerli bir kategori seçin.' }
  }

  const rawPrice = input.price == null ? null : Number(input.price)
  const price = rawPrice == null || Number.isNaN(rawPrice) ? null : rawPrice
  if (price != null && (!Number.isFinite(price) || price < 0)) {
    return { success: false, message: 'Geçerli bir fiyat girin.' }
  }

  const [templatePart, brand, category] = await Promise.all([
    db.parts.findUnique({
      where: { id: templatePartIdBigInt },
      include: {
        part_oens: true,
        part_cross_references: true,
        part_properties: true,
        part_vehicle_types: true,
        part_eans: true,
        part_images: true
      }
    }),
    db.part_brands.findUnique({ where: { id: brandId }, select: { id: true } }),
    db.part_categories.findUnique({
      where: { id: categoryId },
      select: { id: true }
    })
  ])

  if (!templatePart) {
    return { success: false, message: 'Şablon ürün bulunamadı.' }
  }
  if (!brand) {
    return { success: false, message: 'Seçilen marka bulunamadı.' }
  }
  if (!category) {
    return { success: false, message: 'Seçilen kategori bulunamadı.' }
  }

  const partId = BigInt(
    `${Date.now()}${Math.floor(Math.random() * 1000)
      .toString()
      .padStart(3, '0')}`
  )
  const createdPartId = partId.toString()

  try {
    await db.$transaction(async (tx) => {
      await tx.parts.create({
        data: {
          id: partId,
          name,
          article_link_id: BigInt(articleLinkId),
          price: price != null ? new Prisma.Decimal(price) : null,
          brand_id: brandId,
          category_id: categoryId,
          in_basket: Boolean(input.inBasket)
        }
      })

      if (templatePart.part_oens.length > 0) {
        await tx.part_oens.createMany({
          data: templatePart.part_oens.map((oen) => ({
            part_id: partId,
            brand: oen.brand,
            code: oen.code
          }))
        })
      }

      if (templatePart.part_cross_references.length > 0) {
        await tx.part_cross_references.createMany({
          data: templatePart.part_cross_references.map((cross) => ({
            part_id: partId,
            brand_name: cross.brand_name,
            article_number: cross.article_number
          }))
        })
      }

      if (templatePart.part_eans.length > 0) {
        await tx.part_eans.createMany({
          data: templatePart.part_eans.map((ean) => ({
            part_id: partId,
            code: ean.code
          }))
        })
      }

      if (templatePart.part_vehicle_types.length > 0) {
        await tx.part_vehicle_types.createMany({
          data: templatePart.part_vehicle_types.map((vt) => ({
            part_id: partId,
            vehicle_type_id: vt.vehicle_type_id
          }))
        })
      }

      if (templatePart.part_properties.length > 0) {
        await createPartPropertiesRows(
          tx,
          partId,
          templatePart.part_properties.map((prop) => ({
            key: prop.key,
            value: prop.value
          }))
        )
      }

      if (templatePart.part_images.length > 0) {
        await tx.part_images.createMany({
          data: templatePart.part_images.map((image) => ({
            part_id: partId,
            image: image.image,
            thumb: image.thumb
          }))
        })
      }
    })
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Ürün şablondan oluşturulurken hata oluştu.'
    return { success: false, message }
  }

  revalidateAdminPaths()

  return {
    success: true,
    message: `Ürün şablondan oluşturuldu (#${createdPartId}).`,
    data: { partId: createdPartId }
  }
}

async function canonicalProductExists(productId: bigint): Promise<boolean> {
  const product = await db.products.findUnique({
    where: { id: productId },
    select: { id: true }
  })
  return Boolean(product)
}

function isInvalidSellingPrice(value: number | null | undefined): boolean {
  return typeof value === 'number' && (!Number.isFinite(value) || value < 0)
}

export async function updateAdminProductInline(input: {
  partId: string
  sellingPriceOverride?: number | null
  lockPrice?: boolean
}): Promise<{ success: boolean; message: string }> {
  const userId = await getAdminUserId()

  let parsedPartId: bigint
  try {
    parsedPartId = BigInt(input.partId)
  } catch {
    return { success: false, message: 'Geçersiz ürün kimliği.' }
  }

  if (!(await canonicalProductExists(parsedPartId))) {
    return { success: false, message: 'Kanonik ürün bulunamadı.' }
  }
  if (isInvalidSellingPrice(input.sellingPriceOverride)) {
    return { success: false, message: 'Satış fiyatı negatif olamaz.' }
  }
  const productId = parsedPartId

  const updateData: Prisma.product_overridesUncheckedUpdateInput = { updated_by: userId }
  const createData: Prisma.product_overridesUncheckedCreateInput = {
    product_id: productId,
    updated_by: userId
  }

  if (typeof input.lockPrice === 'boolean') {
    updateData.lock_price = input.lockPrice
    createData.lock_price = input.lockPrice
  }

  if (input.sellingPriceOverride !== undefined) {
    updateData.selling_price_override = input.sellingPriceOverride
    createData.selling_price_override = input.sellingPriceOverride
  }

  await db.product_overrides.upsert({
    where: { product_id: productId },
    update: updateData,
    create: createData
  })

  revalidateAdminPaths()

  return { success: true, message: 'Ürün satırı güncellendi.' }
}

export async function updateAdminProductDetail(input: {
  partId: string
  sellingPriceOverride?: number | null
  lockPrice?: boolean
  note?: string | null
}): Promise<{ success: boolean; message: string }> {
  const userId = await getAdminUserId()

  let parsedPartId: bigint
  try {
    parsedPartId = BigInt(input.partId)
  } catch {
    return { success: false, message: 'Geçersiz ürün kimliği.' }
  }

  if (!(await canonicalProductExists(parsedPartId))) {
    return { success: false, message: 'Kanonik ürün bulunamadı.' }
  }
  if (isInvalidSellingPrice(input.sellingPriceOverride)) {
    return { success: false, message: 'Satış fiyatı negatif olamaz.' }
  }
  const productId = parsedPartId

  await db.$transaction(async (tx) => {
    const overridesUpdate: Prisma.product_overridesUncheckedUpdateInput = {
      updated_by: userId
    }

    const overridesCreate: Prisma.product_overridesUncheckedCreateInput = {
      product_id: productId,
      updated_by: userId
    }

    if (input.sellingPriceOverride !== undefined) {
      overridesUpdate.selling_price_override = input.sellingPriceOverride
      overridesCreate.selling_price_override = input.sellingPriceOverride
    }

    if (typeof input.lockPrice === 'boolean') {
      overridesUpdate.lock_price = input.lockPrice
      overridesCreate.lock_price = input.lockPrice
    }

    if (input.note !== undefined) {
      overridesUpdate.note = input.note
      overridesCreate.note = input.note
    }

    await tx.product_overrides.upsert({
      where: { product_id: productId },
      update: overridesUpdate,
      create: overridesCreate
    })

  })

  revalidateAdminPaths()

  return { success: true, message: 'Ürün detayı güncellendi.' }
}

export async function updateAdminProductTechnicalDetail(input: {
  partId: string
  technical: PartTechnicalReferenceInput
}): Promise<{ success: boolean; message: string }> {
  await requireAdminAuth()

  let parsedPartId: bigint
  try {
    parsedPartId = BigInt(input.partId)
  } catch {
    return { success: false, message: 'Geçersiz ürün kimliği.' }
  }

  const part = await db.parts.findUnique({
    where: { id: parsedPartId },
    select: { id: true }
  })

  if (!part) {
    return { success: false, message: 'Ürün bulunamadı.' }
  }

  const eans = normalizeUniqueTexts(input.technical.eans || [])

  const oemRows = Array.from(
    new Map(
      (input.technical.oemReferences || [])
        .map((row) => ({
          brand: normalizeTextValue(row.brand),
          code: normalizeTextValue(row.code)
        }))
        .filter((row): row is { brand: string; code: string } =>
          Boolean(row.brand && row.code)
        )
        .map((row) => [
          `${row.brand.toLocaleLowerCase('tr')}::${row.code.toLocaleLowerCase('tr')}`,
          row
        ])
    ).values()
  )

  const crossRows = Array.from(
    new Map(
      (input.technical.crossReferences || [])
        .map((row) => ({
          brand: normalizeTextValue(row.brand),
          articleNumber: normalizeTextValue(row.articleNumber)
        }))
        .filter((row): row is { brand: string; articleNumber: string } =>
          Boolean(row.brand && row.articleNumber)
        )
        .map((row) => [
          `${row.brand.toLocaleLowerCase('tr')}::${row.articleNumber.toLocaleLowerCase('tr')}`,
          row
        ])
    ).values()
  )

  const propertyRows = Array.from(
    new Map(
      (input.technical.properties || [])
        .map((row) => ({
          key: normalizeTextValue(row.key),
          value: normalizeTextValue(row.value)
        }))
        .filter((row): row is { key: string; value: string } =>
          Boolean(row.key && row.value)
        )
        .map((row) => [
          `${row.key.toLocaleLowerCase('tr')}::${row.value.toLocaleLowerCase('tr')}`,
          row
        ])
    ).values()
  )

  await db.$transaction(async (tx) => {
    await tx.part_eans.deleteMany({ where: { part_id: parsedPartId } })
    await tx.part_oens.deleteMany({ where: { part_id: parsedPartId } })
    await tx.part_cross_references.deleteMany({
      where: { part_id: parsedPartId }
    })
    await tx.part_properties.deleteMany({ where: { part_id: parsedPartId } })

    if (eans.length > 0) {
      await tx.part_eans.createMany({
        data: eans.map((code) => ({
          part_id: parsedPartId,
          code
        }))
      })
    }

    if (oemRows.length > 0) {
      await tx.part_oens.createMany({
        data: oemRows.map((row) => ({
          part_id: parsedPartId,
          brand: row.brand,
          code: row.code
        }))
      })
    }

    if (crossRows.length > 0) {
      await tx.part_cross_references.createMany({
        data: crossRows.map((row) => ({
          part_id: parsedPartId,
          brand_name: row.brand,
          article_number: row.articleNumber
        }))
      })
    }

    if (propertyRows.length > 0) {
      await createPartPropertiesRows(tx, parsedPartId, propertyRows)
    }
  })

  revalidateAdminPaths()

  return { success: true, message: 'Teknik referans bilgileri güncellendi.' }
}

export async function bulkUpdateAdminProducts(
  input: AdminBulkUpdateInput
): Promise<{ success: boolean; message: string; affected: number }> {
  const userId = await getAdminUserId()

  const partIds = Array.from(
    new Set(
      input.partIds
        .map((id) => {
          try {
            return BigInt(id)
          } catch {
            return null
          }
        })
        .filter((id): id is bigint => id !== null)
    )
  )

  if (partIds.length === 0) {
    return {
      success: false,
      message: 'Toplu işlem için ürün seçilmedi.',
      affected: 0
    }
  }

  const hasAnyField =
    input.sellingPriceOverride !== undefined ||
    input.lockPrice !== undefined

  if (!hasAnyField) {
    return {
      success: false,
      message: 'Güncellenecek alan seçilmedi.',
      affected: 0
    }
  }

  if (isInvalidSellingPrice(input.sellingPriceOverride)) {
    return { success: false, message: 'Satış fiyatı negatif olamaz.', affected: 0 }
  }

  const productIds = Array.from(new Set(partIds.map((id) => id.toString()))).map(BigInt)
  const existingCount = await db.products.count({ where: { id: { in: productIds } } })
  if (existingCount !== productIds.length) {
    return { success: false, message: 'Bir veya daha fazla kanonik ürün bulunamadı.', affected: 0 }
  }

  await db.$transaction(async (tx) => {
    for (const productId of productIds) {

      const updateData: Prisma.product_overridesUncheckedUpdateInput = {
        updated_by: userId
      }
      const createData: Prisma.product_overridesUncheckedCreateInput = {
        product_id: productId,
        updated_by: userId
      }

      if (input.sellingPriceOverride !== undefined) {
        updateData.selling_price_override = input.sellingPriceOverride
        createData.selling_price_override = input.sellingPriceOverride
      }

      if (input.lockPrice !== undefined) {
        updateData.lock_price = input.lockPrice
        createData.lock_price = input.lockPrice
      }

      await tx.product_overrides.upsert({
        where: { product_id: productId },
        update: updateData,
        create: createData
      })
    }
  })

  revalidateAdminPaths()

  return {
    success: true,
    message: 'Toplu güncelleme tamamlandı.',
    affected: productIds.length
  }
}

export async function exportAdminProductsCsv(
  input: AdminProductFilters = {}
): Promise<{
  success: boolean
  filename?: string
  csv?: string
  message?: string
}> {
  await requireAdminAuth()

  const filters = normalizeFilters({
    ...input,
    page: 1,
    limit: MAX_EXPORT_ROWS
  })
  const rows = await queryAdminProductsRows(filters, {
    limit: MAX_EXPORT_ROWS,
    offset: 0
  })

  const headers = [
    'part_id',
    'article_link_id',
    'ad',
    'marka',
    'kategori',
    'supplier_price',
    'selling_price',
    'supplier_stock_qty',
    'stock_status',
    'lock_price',
    'last_synced_at'
  ]

  const lines = [headers.join(',')]

  for (const row of rows) {
    lines.push(
      [
        row.id,
        row.article_link_id,
        row.name,
        row.brand_name,
        row.category_name,
        row.supplier_price,
        row.selling_price,
        row.supplier_stock_qty,
        row.stock_status,
        row.lock_price ?? false,
        row.last_synced_at ? row.last_synced_at.toISOString() : ''
      ]
        .map((item) => buildCsvCell(item as string | number | boolean | null))
        .join(',')
    )
  }

  const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')

  return {
    success: true,
    filename: `admin-urunler-${timestamp}.csv`,
    csv: lines.join('\n')
  }
}

export async function exportAdminNewProductsCsvTemplate(): Promise<{
  success: boolean
  filename?: string
  csv?: string
  message?: string
}> {
  await requireAdminAuth()

  const headers = [
    'template_part_id',
    'part_id',
    'name',
    'article_link_id',
    'brand_id',
    'category_id',
    'part_no',
    'price',
    'in_basket',
    'supplier_price',
    'supplier_stock_qty',
    'currency',
    'lock_price',
    'note',
    'part_infos_json',
    'part_oens_json',
    'part_eans_json',
    'part_cross_references_json',
    'part_properties_json',
    'part_vehicle_type_ids_json',
    'part_images_json',
    'part_documents_json'
  ]

  const sampleTemplate = await fetchNewProductTemplatePart(
    NEW_PRODUCT_TEMPLATE_PART_ID
  )
  const technicalRows = sampleTemplate
    ? buildNewProductTechnicalRowsFromTemplate(sampleTemplate)
    : null

  const sampleRow: Record<string, string | number | boolean | null> = {
    template_part_id: sampleTemplate
      ? sampleTemplate.id.toString()
      : NEW_PRODUCT_TEMPLATE_PART_ID.toString(),
    part_id: '',
    name: sampleTemplate?.name || '',
    article_link_id: sampleTemplate?.article_link_id.toString() || '',
    brand_id: sampleTemplate?.brand_id || '',
    category_id: sampleTemplate?.category_id || '',
    part_no: sampleTemplate?.part_no?.toString() || '',
    price: sampleTemplate?.price?.toString() || '',
    in_basket: sampleTemplate?.in_basket ?? false,
    supplier_price: '',
    supplier_stock_qty: '',
    currency: 'TRY',
    lock_price: '',
    note: '',
    part_infos_json: technicalRows ? JSON.stringify(technicalRows.infos) : '[]',
    part_oens_json: technicalRows ? JSON.stringify(technicalRows.oens) : '[]',
    part_eans_json: technicalRows ? JSON.stringify(technicalRows.eans) : '[]',
    part_cross_references_json: technicalRows
      ? JSON.stringify(technicalRows.crossReferences)
      : '[]',
    part_properties_json: technicalRows
      ? JSON.stringify(technicalRows.properties)
      : '[]',
    part_vehicle_type_ids_json: technicalRows
      ? JSON.stringify(technicalRows.vehicleTypeIds)
      : '[]',
    part_images_json: technicalRows ? JSON.stringify(technicalRows.images) : '[]',
    part_documents_json: technicalRows
      ? JSON.stringify(technicalRows.documents)
      : '[]'
  }

  const lines = [headers.join(',')]
  lines.push(
    headers
      .map((header) =>
        buildCsvCell(
          (sampleRow[header] ?? '') as string | number | boolean | null
        )
      )
      .join(',')
  )

  const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')

  return {
    success: true,
    filename: `admin-yeni-urun-template-${timestamp}.csv`,
    csv: lines.join('\n'),
    message: sampleTemplate
      ? 'Yeni ürün CSV şablonu hazırlandı.'
      : 'Şablon ürün (#41055) bulunamadı. Boş örnek satır ile şablon oluşturuldu.'
  }
}

export async function importAdminNewProductsCsv(
  file: File,
  mode: 'preview' | 'apply' = 'preview'
): Promise<{
  success: boolean
  message: string
  summary: {
    totalRows: number
    readyRows: number
    createdRows: number
    errorRows: number
    skippedRows: number
  }
  rows: AdminNewImportPreviewRow[]
}> {
  await requireAdminAuth()

  if (!file || file.size === 0) {
    return {
      success: false,
      message: 'CSV dosyası boş.',
      summary: {
        totalRows: 0,
        readyRows: 0,
        createdRows: 0,
        errorRows: 0,
        skippedRows: 0
      },
      rows: []
    }
  }

  const text = await file.text()
  let records: Record<string, string>[] = []

  try {
    records = parse(text, {
      columns: true,
      skip_empty_lines: true,
      trim: true
    }) as Record<string, string>[]
  } catch (error) {
    return {
      success: false,
      message: `CSV okunamadı: ${error instanceof Error ? error.message : 'Bilinmeyen hata'}`,
      summary: {
        totalRows: 0,
        readyRows: 0,
        createdRows: 0,
        errorRows: 0,
        skippedRows: 0
      },
      rows: []
    }
  }

  const asRecord = (value: unknown): Record<string, unknown> | null => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    return value as Record<string, unknown>
  }

  const parseRequiredText = (
    value: unknown,
    field: string
  ): { value?: string; error: string | null } => {
    const textValue = normalizeTextValue(
      typeof value === 'string' ? value : String(value || '')
    )
    if (!textValue) {
      return { error: `${field} zorunludur.` }
    }
    return { value: textValue, error: null }
  }

  const parseRequiredBigInt = (
    value: unknown,
    field: string
  ): { value?: bigint; error: string | null } => {
    const textValue = normalizeTextValue(
      typeof value === 'string' ? value : String(value || '')
    )
    if (!textValue) return { error: `${field} zorunludur.` }
    try {
      const parsed = BigInt(textValue)
      if (parsed <= BigInt(0)) {
        return { error: `${field} pozitif olmalıdır.` }
      }
      return { value: parsed, error: null }
    } catch {
      return { error: `${field} geçersiz.` }
    }
  }

  const parseRequiredInt = (
    value: unknown,
    field: string
  ): { value?: number; error: string | null } => {
    const parsed = parseNumberValue(value)
    if (parsed.error) return { error: `${field}: ${parsed.error}` }
    if (parsed.value == null || parsed.value === undefined) {
      return { error: `${field} zorunludur.` }
    }
    const intValue = Math.trunc(parsed.value)
    if (!Number.isFinite(intValue) || intValue <= 0) {
      return { error: `${field} pozitif sayı olmalıdır.` }
    }
    return { value: intValue, error: null }
  }

  const parseOptionalBigInt = (
    value: unknown,
    field: string
  ): { value: bigint | null | undefined; error: string | null } => {
    if (value == null || value === '') return { value: undefined, error: null }
    const textValue = String(value).trim()
    if (!textValue) return { value: undefined, error: null }
    if (textValue.toLowerCase() === 'null') return { value: null, error: null }
    try {
      const parsed = BigInt(textValue)
      if (parsed <= BigInt(0)) {
        return { value: undefined, error: `${field} pozitif olmalıdır.` }
      }
      return { value: parsed, error: null }
    } catch {
      return { value: undefined, error: `${field} geçersiz.` }
    }
  }

  // parts.part_no is TEXT — roughly a third of TecDoc part numbers are
  // alphanumeric ("10PK1342"), so it cannot be parsed as a number.
  const parseOptionalPartNo = (
    value: unknown
  ): { value: string | null | undefined; error: string | null } => {
    if (value == null || value === '') return { value: undefined, error: null }
    const textValue = String(value).trim()
    if (!textValue) return { value: undefined, error: null }
    if (textValue.toLowerCase() === 'null') return { value: null, error: null }
    return { value: textValue, error: null }
  }

  const parseStringArrayColumn = (
    value: unknown,
    field: string
  ): { value: string[]; error: string | null } => {
    if (!Array.isArray(value)) {
      return { value: [], error: `${field} bir dizi olmalıdır.` }
    }
    const normalized: string[] = []
    for (const item of value) {
      if (typeof item !== 'string') {
        return { value: [], error: `${field} sadece string değerler içermelidir.` }
      }
      const textItem = normalizeTextValue(item)
      if (textItem) normalized.push(textItem)
    }
    return { value: normalizeUniqueTexts(normalized), error: null }
  }

  const parseOemArrayColumn = (
    value: unknown
  ): { value: Array<{ brand: string; code: string }>; error: string | null } => {
    if (!Array.isArray(value)) {
      return { value: [], error: 'part_oens_json bir dizi olmalıdır.' }
    }
    const dedup = new Map<string, { brand: string; code: string }>()
    for (const item of value) {
      const row = asRecord(item)
      if (!row) return { value: [], error: 'part_oens_json satırları object olmalıdır.' }
      const brand = normalizeTextValue(
        typeof row.brand === 'string' ? row.brand : ''
      )
      const code = normalizeTextValue(typeof row.code === 'string' ? row.code : '')
      if (!brand || !code) {
        return { value: [], error: 'part_oens_json için brand ve code zorunludur.' }
      }
      dedup.set(
        `${brand.toLocaleLowerCase('tr')}::${code.toLocaleLowerCase('tr')}`,
        { brand, code }
      )
    }
    return { value: Array.from(dedup.values()), error: null }
  }

  const parseCrossArrayColumn = (
    value: unknown
  ): {
    value: Array<{ brand_name: string; article_number: string }>
    error: string | null
  } => {
    if (!Array.isArray(value)) {
      return { value: [], error: 'part_cross_references_json bir dizi olmalıdır.' }
    }
    const dedup = new Map<string, { brand_name: string; article_number: string }>()
    for (const item of value) {
      const row = asRecord(item)
      if (!row) {
        return {
          value: [],
          error: 'part_cross_references_json satırları object olmalıdır.'
        }
      }
      const brandName = normalizeTextValue(
        typeof row.brand_name === 'string' ? row.brand_name : ''
      )
      const articleNumber = normalizeTextValue(
        typeof row.article_number === 'string' ? row.article_number : ''
      )
      if (!brandName || !articleNumber) {
        return {
          value: [],
          error:
            'part_cross_references_json için brand_name ve article_number zorunludur.'
        }
      }
      dedup.set(
        `${brandName.toLocaleLowerCase('tr')}::${articleNumber.toLocaleLowerCase('tr')}`,
        { brand_name: brandName, article_number: articleNumber }
      )
    }
    return { value: Array.from(dedup.values()), error: null }
  }

  const parsePropertyArrayColumn = (
    value: unknown
  ): { value: Array<{ key: string; value: string }>; error: string | null } => {
    if (!Array.isArray(value)) {
      return { value: [], error: 'part_properties_json bir dizi olmalıdır.' }
    }
    const dedup = new Map<string, { key: string; value: string }>()
    for (const item of value) {
      const row = asRecord(item)
      if (!row) {
        return { value: [], error: 'part_properties_json satırları object olmalıdır.' }
      }
      const key = normalizeTextValue(typeof row.key === 'string' ? row.key : '')
      const rowValue = normalizeTextValue(
        typeof row.value === 'string' ? row.value : ''
      )
      if (!key || !rowValue) {
        return { value: [], error: 'part_properties_json için key ve value zorunludur.' }
      }
      dedup.set(
        `${key.toLocaleLowerCase('tr')}::${rowValue.toLocaleLowerCase('tr')}`,
        { key, value: rowValue }
      )
    }
    return { value: Array.from(dedup.values()), error: null }
  }

  const parseVehicleTypeIdsColumn = (
    value: unknown
  ): { value: number[]; error: string | null } => {
    if (!Array.isArray(value)) {
      return { value: [], error: 'part_vehicle_type_ids_json bir dizi olmalıdır.' }
    }
    const ids = new Set<number>()
    for (const item of value) {
      const numberValue =
        typeof item === 'number'
          ? item
          : typeof item === 'string'
            ? Number(item)
            : Number.NaN
      if (!Number.isFinite(numberValue)) {
        return {
          value: [],
          error: 'part_vehicle_type_ids_json sadece sayı değerleri içermelidir.'
        }
      }
      const intValue = Math.trunc(numberValue)
      if (intValue <= 0) {
        return {
          value: [],
          error: 'part_vehicle_type_ids_json değerleri pozitif olmalıdır.'
        }
      }
      ids.add(intValue)
    }
    return { value: Array.from(ids), error: null }
  }

  const parseImagesColumn = (
    value: unknown
  ): { value: NewProductImportPartImage[]; error: string | null } => {
    if (!Array.isArray(value)) {
      return { value: [], error: 'part_images_json bir dizi olmalıdır.' }
    }
    const dedup = new Map<string, NewProductImportPartImage>()
    for (const item of value) {
      const row = asRecord(item)
      if (!row) return { value: [], error: 'part_images_json satırları object olmalıdır.' }
      const image = normalizeTextValue(typeof row.image === 'string' ? row.image : '')
      const thumb = normalizeTextValue(typeof row.thumb === 'string' ? row.thumb : '')
      if (!image) return { value: [], error: 'part_images_json için image zorunludur.' }
      dedup.set(image, { image, thumb: thumb || image })
    }
    return { value: Array.from(dedup.values()), error: null }
  }

  const parseDocumentsColumn = (
    value: unknown
  ): { value: NewProductImportPartDocument[]; error: string | null } => {
    if (!Array.isArray(value)) {
      return { value: [], error: 'part_documents_json bir dizi olmalıdır.' }
    }
    const rows: NewProductImportPartDocument[] = []
    for (const item of value) {
      const row = asRecord(item)
      if (!row) {
        return { value: [], error: 'part_documents_json satırları object olmalıdır.' }
      }
      const fileName = normalizeTextValue(
        typeof row.doc_file_name === 'string' ? row.doc_file_name : ''
      )
      const fileTypeName = normalizeTextValue(
        typeof row.doc_file_type_name === 'string' ? row.doc_file_type_name : ''
      )
      const docId = normalizeTextValue(typeof row.doc_id === 'string' ? row.doc_id : '')
      const docTypeName = normalizeTextValue(
        typeof row.doc_type_name === 'string' ? row.doc_type_name : ''
      )
      const docTypeId = Number(row.doc_type_id)
      const docUrl = normalizeTextValue(
        typeof row.doc_url === 'string' ? row.doc_url : ''
      )
      if (!fileName || !fileTypeName || !docId || !docTypeName) {
        return {
          value: [],
          error:
            'part_documents_json için doc_file_name, doc_file_type_name, doc_id, doc_type_name zorunludur.'
        }
      }
      if (!Number.isFinite(docTypeId) || Math.trunc(docTypeId) <= 0) {
        return {
          value: [],
          error: 'part_documents_json için doc_type_id pozitif sayı olmalıdır.'
        }
      }
      rows.push({
        doc_file_name: fileName,
        doc_file_type_name: fileTypeName,
        doc_id: docId,
        doc_type_id: Math.trunc(docTypeId),
        doc_type_name: docTypeName,
        doc_url: docUrl
      })
    }
    return { value: rows, error: null }
  }

  const previewRows: AdminNewImportPreviewRow[] = []
  const preparedRows: NewProductImportPreparedRow[] = []
  const templateCache = new Map<string, ProductTemplatePart>()
  const seenPartIds = new Set<string>()
  const seenArticleLinkIds = new Set<string>()
  const brandExistsCache = new Map<number, boolean>()
  const categoryExistsCache = new Map<number, boolean>()

  for (let i = 0; i < records.length; i++) {
    const rowNo = i + 2
    const row = records[i]

    const templatePartIdResult = parseRequiredBigInt(
      row.template_part_id,
      'template_part_id'
    )
    if (templatePartIdResult.error || !templatePartIdResult.value) {
      previewRows.push({
        row: rowNo,
        partId: null,
        articleLinkId: null,
        templatePartId: normalizeTextValue(row.template_part_id),
        status: 'ERROR',
        message: templatePartIdResult.error || 'template_part_id zorunludur.'
      })
      continue
    }

    const templatePartId = templatePartIdResult.value
    const templateCacheKey = templatePartId.toString()
    let templatePart = templateCache.get(templateCacheKey)
    if (!templatePart) {
      const fetchedTemplate = await fetchNewProductTemplatePart(templatePartId)
      if (!fetchedTemplate) {
        previewRows.push({
          row: rowNo,
          partId: normalizeTextValue(row.part_id),
          articleLinkId: normalizeTextValue(row.article_link_id),
          templatePartId: templatePartId.toString(),
          status: 'ERROR',
          message: `Şablon ürün bulunamadı (#${templatePartId}).`
        })
        continue
      }
      templatePart = fetchedTemplate
      templateCache.set(templateCacheKey, templatePart)
    }

    const nameResult = parseRequiredText(row.name, 'name')
    if (nameResult.error || !nameResult.value) {
      previewRows.push({
        row: rowNo,
        partId: normalizeTextValue(row.part_id),
        articleLinkId: normalizeTextValue(row.article_link_id),
        templatePartId: templatePartId.toString(),
        status: 'ERROR',
        message: nameResult.error || 'name zorunludur.'
      })
      continue
    }

    const articleLinkResult = parseRequiredBigInt(
      row.article_link_id,
      'article_link_id'
    )
    if (articleLinkResult.error || !articleLinkResult.value) {
      previewRows.push({
        row: rowNo,
        partId: normalizeTextValue(row.part_id),
        articleLinkId: normalizeTextValue(row.article_link_id),
        templatePartId: templatePartId.toString(),
        status: 'ERROR',
        message: articleLinkResult.error || 'article_link_id zorunludur.'
      })
      continue
    }

    const brandIdResult = parseRequiredInt(row.brand_id, 'brand_id')
    if (brandIdResult.error || !brandIdResult.value) {
      previewRows.push({
        row: rowNo,
        partId: normalizeTextValue(row.part_id),
        articleLinkId: articleLinkResult.value.toString(),
        templatePartId: templatePartId.toString(),
        status: 'ERROR',
        message: brandIdResult.error || 'brand_id zorunludur.'
      })
      continue
    }

    const categoryIdResult = parseRequiredInt(row.category_id, 'category_id')
    if (categoryIdResult.error || !categoryIdResult.value) {
      previewRows.push({
        row: rowNo,
        partId: normalizeTextValue(row.part_id),
        articleLinkId: articleLinkResult.value.toString(),
        templatePartId: templatePartId.toString(),
        status: 'ERROR',
        message: categoryIdResult.error || 'category_id zorunludur.'
      })
      continue
    }

    const brandId = brandIdResult.value
    const categoryId = categoryIdResult.value

    let brandExists = brandExistsCache.get(brandId)
    if (brandExists === undefined) {
      brandExists = Boolean(
        await db.part_brands.findUnique({
          where: { id: brandId },
          select: { id: true }
        })
      )
      brandExistsCache.set(brandId, brandExists)
    }
    if (!brandExists) {
      previewRows.push({
        row: rowNo,
        partId: normalizeTextValue(row.part_id),
        articleLinkId: articleLinkResult.value.toString(),
        templatePartId: templatePartId.toString(),
        status: 'ERROR',
        message: `brand_id bulunamadı (${brandId}).`
      })
      continue
    }

    let categoryExists = categoryExistsCache.get(categoryId)
    if (categoryExists === undefined) {
      categoryExists = Boolean(
        await db.part_categories.findUnique({
          where: { id: categoryId },
          select: { id: true }
        })
      )
      categoryExistsCache.set(categoryId, categoryExists)
    }
    if (!categoryExists) {
      previewRows.push({
        row: rowNo,
        partId: normalizeTextValue(row.part_id),
        articleLinkId: articleLinkResult.value.toString(),
        templatePartId: templatePartId.toString(),
        status: 'ERROR',
        message: `category_id bulunamadı (${categoryId}).`
      })
      continue
    }

    const providedPartId = parseOptionalBigInt(row.part_id, 'part_id')
    if (providedPartId.error) {
      previewRows.push({
        row: rowNo,
        partId: normalizeTextValue(row.part_id),
        articleLinkId: articleLinkResult.value.toString(),
        templatePartId: templatePartId.toString(),
        status: 'ERROR',
        message: providedPartId.error
      })
      continue
    }

    if (providedPartId.value === null) {
      previewRows.push({
        row: rowNo,
        partId: normalizeTextValue(row.part_id),
        articleLinkId: articleLinkResult.value.toString(),
        templatePartId: templatePartId.toString(),
        status: 'ERROR',
        message: 'part_id null olamaz.'
      })
      continue
    }

    const generatedPartId = providedPartId.value || generateRandomPartId()
    const partIdText = generatedPartId.toString()
    const articleLinkText = articleLinkResult.value.toString()

    if (seenPartIds.has(partIdText)) {
      previewRows.push({
        row: rowNo,
        partId: partIdText,
        articleLinkId: articleLinkText,
        templatePartId: templatePartId.toString(),
        status: 'SKIPPED',
        message: 'Aynı part_id CSV içinde tekrar ediyor.'
      })
      continue
    }
    if (seenArticleLinkIds.has(articleLinkText)) {
      previewRows.push({
        row: rowNo,
        partId: partIdText,
        articleLinkId: articleLinkText,
        templatePartId: templatePartId.toString(),
        status: 'SKIPPED',
        message: 'Aynı article_link_id CSV içinde tekrar ediyor.'
      })
      continue
    }

    if (providedPartId.value) {
      const existingByPartId = await db.parts.findUnique({
        where: { id: providedPartId.value },
        select: { id: true }
      })
      if (existingByPartId) {
        previewRows.push({
          row: rowNo,
          partId: partIdText,
          articleLinkId: articleLinkText,
          templatePartId: templatePartId.toString(),
          status: 'SKIPPED',
          message: `part_id zaten mevcut (#${partIdText}).`
        })
        continue
      }
    }

    const existingByArticleLink = await db.parts.findFirst({
      where: { article_link_id: articleLinkResult.value },
      select: { id: true }
    })
    if (existingByArticleLink) {
      previewRows.push({
        row: rowNo,
        partId: partIdText,
        articleLinkId: articleLinkText,
        templatePartId: templatePartId.toString(),
        status: 'SKIPPED',
        message: `article_link_id zaten mevcut (#${existingByArticleLink.id.toString()}).`
      })
      continue
    }

    seenPartIds.add(partIdText)
    seenArticleLinkIds.add(articleLinkText)

    const priceResult = parseNumberValue(row.price)
    if (priceResult.error) {
      previewRows.push({
        row: rowNo,
        partId: partIdText,
        articleLinkId: articleLinkText,
        templatePartId: templatePartId.toString(),
        status: 'ERROR',
        message: `price: ${priceResult.error}`
      })
      continue
    }

    const inBasketResult = parseBooleanValue(row.in_basket)
    if (inBasketResult.error) {
      previewRows.push({
        row: rowNo,
        partId: partIdText,
        articleLinkId: articleLinkText,
        templatePartId: templatePartId.toString(),
        status: 'ERROR',
        message: `in_basket: ${inBasketResult.error}`
      })
      continue
    }

    const partNoResult = parseOptionalPartNo(row.part_no)
    if (partNoResult.error) {
      previewRows.push({
        row: rowNo,
        partId: partIdText,
        articleLinkId: articleLinkText,
        templatePartId: templatePartId.toString(),
        status: 'ERROR',
        message: partNoResult.error
      })
      continue
    }

    const supplierPriceResult = parseNumberValue(row.supplier_price)
    if (supplierPriceResult.error) {
      previewRows.push({
        row: rowNo,
        partId: partIdText,
        articleLinkId: articleLinkText,
        templatePartId: templatePartId.toString(),
        status: 'ERROR',
        message: `supplier_price: ${supplierPriceResult.error}`
      })
      continue
    }

    const supplierStockResult = parseNumberValue(row.supplier_stock_qty)
    if (supplierStockResult.error) {
      previewRows.push({
        row: rowNo,
        partId: partIdText,
        articleLinkId: articleLinkText,
        templatePartId: templatePartId.toString(),
        status: 'ERROR',
        message: `supplier_stock_qty: ${supplierStockResult.error}`
      })
      continue
    }

    const lockPriceResult = parseBooleanValue(row.lock_price)
    if (lockPriceResult.error) {
      previewRows.push({
        row: rowNo,
        partId: partIdText,
        articleLinkId: articleLinkText,
        templatePartId: templatePartId.toString(),
        status: 'ERROR',
        message: `lock_price: ${lockPriceResult.error}`
      })
      continue
    }

    const partInfosJson = parseJsonColumn<unknown>(row.part_infos_json)
    const partOensJson = parseJsonColumn<unknown>(row.part_oens_json)
    const partEansJson = parseJsonColumn<unknown>(row.part_eans_json)
    const partCrossJson = parseJsonColumn<unknown>(row.part_cross_references_json)
    const partPropertiesJson = parseJsonColumn<unknown>(row.part_properties_json)
    const partVehicleTypesJson = parseJsonColumn<unknown>(
      row.part_vehicle_type_ids_json
    )
    const partImagesJson = parseJsonColumn<unknown>(row.part_images_json)
    const partDocumentsJson = parseJsonColumn<unknown>(row.part_documents_json)

    const jsonErrors = [
      ['part_infos_json', partInfosJson.error],
      ['part_oens_json', partOensJson.error],
      ['part_eans_json', partEansJson.error],
      ['part_cross_references_json', partCrossJson.error],
      ['part_properties_json', partPropertiesJson.error],
      ['part_vehicle_type_ids_json', partVehicleTypesJson.error],
      ['part_images_json', partImagesJson.error],
      ['part_documents_json', partDocumentsJson.error]
    ].find((item) => Boolean(item[1]))

    if (jsonErrors) {
      previewRows.push({
        row: rowNo,
        partId: partIdText,
        articleLinkId: articleLinkText,
        templatePartId: templatePartId.toString(),
        status: 'ERROR',
        message: `${jsonErrors[0]} JSON hatası: ${jsonErrors[1]}`
      })
      continue
    }

    const technicalRows = buildNewProductTechnicalRowsFromTemplate(templatePart)

    if (partInfosJson.specified) {
      const parsedInfos = parseStringArrayColumn(
        partInfosJson.value,
        'part_infos_json'
      )
      if (parsedInfos.error) {
        previewRows.push({
          row: rowNo,
          partId: partIdText,
          articleLinkId: articleLinkText,
          templatePartId: templatePartId.toString(),
          status: 'ERROR',
          message: parsedInfos.error
        })
        continue
      }
      technicalRows.infos = parsedInfos.value
    }

    if (partOensJson.specified) {
      const parsedOens = parseOemArrayColumn(partOensJson.value)
      if (parsedOens.error) {
        previewRows.push({
          row: rowNo,
          partId: partIdText,
          articleLinkId: articleLinkText,
          templatePartId: templatePartId.toString(),
          status: 'ERROR',
          message: parsedOens.error
        })
        continue
      }
      technicalRows.oens = parsedOens.value
    }

    if (partEansJson.specified) {
      const parsedEans = parseStringArrayColumn(partEansJson.value, 'part_eans_json')
      if (parsedEans.error) {
        previewRows.push({
          row: rowNo,
          partId: partIdText,
          articleLinkId: articleLinkText,
          templatePartId: templatePartId.toString(),
          status: 'ERROR',
          message: parsedEans.error
        })
        continue
      }
      technicalRows.eans = parsedEans.value
    }

    if (partCrossJson.specified) {
      const parsedCross = parseCrossArrayColumn(partCrossJson.value)
      if (parsedCross.error) {
        previewRows.push({
          row: rowNo,
          partId: partIdText,
          articleLinkId: articleLinkText,
          templatePartId: templatePartId.toString(),
          status: 'ERROR',
          message: parsedCross.error
        })
        continue
      }
      technicalRows.crossReferences = parsedCross.value
    }

    if (partPropertiesJson.specified) {
      const parsedProperties = parsePropertyArrayColumn(partPropertiesJson.value)
      if (parsedProperties.error) {
        previewRows.push({
          row: rowNo,
          partId: partIdText,
          articleLinkId: articleLinkText,
          templatePartId: templatePartId.toString(),
          status: 'ERROR',
          message: parsedProperties.error
        })
        continue
      }
      technicalRows.properties = parsedProperties.value
    }

    if (partVehicleTypesJson.specified) {
      const parsedVehicleTypes = parseVehicleTypeIdsColumn(partVehicleTypesJson.value)
      if (parsedVehicleTypes.error) {
        previewRows.push({
          row: rowNo,
          partId: partIdText,
          articleLinkId: articleLinkText,
          templatePartId: templatePartId.toString(),
          status: 'ERROR',
          message: parsedVehicleTypes.error
        })
        continue
      }
      technicalRows.vehicleTypeIds = parsedVehicleTypes.value
    }

    if (partImagesJson.specified) {
      const parsedImages = parseImagesColumn(partImagesJson.value)
      if (parsedImages.error) {
        previewRows.push({
          row: rowNo,
          partId: partIdText,
          articleLinkId: articleLinkText,
          templatePartId: templatePartId.toString(),
          status: 'ERROR',
          message: parsedImages.error
        })
        continue
      }
      technicalRows.images = parsedImages.value
    }

    if (partDocumentsJson.specified) {
      const parsedDocuments = parseDocumentsColumn(partDocumentsJson.value)
      if (parsedDocuments.error) {
        previewRows.push({
          row: rowNo,
          partId: partIdText,
          articleLinkId: articleLinkText,
          templatePartId: templatePartId.toString(),
          status: 'ERROR',
          message: parsedDocuments.error
        })
        continue
      }
      technicalRows.documents = parsedDocuments.value
    }

    const hasUnprovenOfferInput =
      supplierPriceResult.value !== undefined ||
      supplierStockResult.value !== undefined ||
      normalizeTextValue(row.currency) !== null
    const note = normalizeTextValue(row.note)
    if (hasUnprovenOfferInput || lockPriceResult.value !== undefined || note !== null) {
      previewRows.push({
        row: rowNo,
        partId: partIdText,
        articleLinkId: articleLinkText,
        templatePartId: templatePartId.toString(),
        status: 'ERROR',
        message: 'Tedarikçi kaynağı veya kanonik ürün olmadan teklif/override oluşturulamaz.'
      })
      continue
    }

    preparedRows.push({
      rowIndex: previewRows.length,
      partId: generatedPartId,
      articleLinkId: articleLinkResult.value,
      name: nameResult.value,
      brandId,
      categoryId,
      partNo:
        partNoResult.value !== undefined
          ? partNoResult.value
          : templatePart.part_no,
      price:
        priceResult.value !== undefined
          ? priceResult.value
          : templatePart.price != null
            ? Number(templatePart.price)
            : null,
      inBasket:
        inBasketResult.value !== undefined
          ? inBasketResult.value
          : templatePart.in_basket,
      technical: technicalRows
    })

    previewRows.push({
      row: rowNo,
      partId: partIdText,
      articleLinkId: articleLinkText,
      templatePartId: templatePartId.toString(),
      status: 'READY',
      message: 'Yeni ürün oluşturma için hazır.'
    })
  }

  let createdRows = 0

  if (mode === 'apply') {
    for (const prepared of preparedRows) {
      try {
        await db.$transaction(async (tx) => {
          const existingByPartId = await tx.parts.findUnique({
            where: { id: prepared.partId },
            select: { id: true }
          })
          if (existingByPartId) {
            throw new Error(`SKIP::part_id zaten mevcut (#${prepared.partId.toString()}).`)
          }

          const existingByArticleLink = await tx.parts.findFirst({
            where: { article_link_id: prepared.articleLinkId },
            select: { id: true }
          })
          if (existingByArticleLink) {
            throw new Error(
              `SKIP::article_link_id zaten mevcut (#${existingByArticleLink.id.toString()}).`
            )
          }

          await tx.parts.create({
            data: {
              id: prepared.partId,
              name: prepared.name,
              article_link_id: prepared.articleLinkId,
              brand_id: prepared.brandId,
              category_id: prepared.categoryId,
              part_no: prepared.partNo ?? null,
              price:
                prepared.price == null
                  ? null
                  : new Prisma.Decimal(prepared.price),
              in_basket: prepared.inBasket
            }
          })

          if (prepared.technical.infos.length > 0) {
            await tx.part_infos.createMany({
              data: prepared.technical.infos.map((content) => ({
                part_id: prepared.partId,
                content
              }))
            })
          }

          if (prepared.technical.oens.length > 0) {
            await tx.part_oens.createMany({
              data: prepared.technical.oens.map((row) => ({
                part_id: prepared.partId,
                brand: row.brand,
                code: row.code
              }))
            })
          }

          if (prepared.technical.eans.length > 0) {
            await tx.part_eans.createMany({
              data: prepared.technical.eans.map((code) => ({
                part_id: prepared.partId,
                code
              }))
            })
          }

          if (prepared.technical.crossReferences.length > 0) {
            await tx.part_cross_references.createMany({
              data: prepared.technical.crossReferences.map((row) => ({
                part_id: prepared.partId,
                brand_name: row.brand_name,
                article_number: row.article_number
              }))
            })
          }

          if (prepared.technical.properties.length > 0) {
            await createPartPropertiesRows(
              tx,
              prepared.partId,
              prepared.technical.properties
            )
          }

          if (prepared.technical.vehicleTypeIds.length > 0) {
            await tx.part_vehicle_types.createMany({
              data: prepared.technical.vehicleTypeIds.map((vehicleTypeId) => ({
                part_id: prepared.partId,
                vehicle_type_id: vehicleTypeId
              }))
            })
          }

          if (prepared.technical.images.length > 0) {
            await tx.part_images.createMany({
              data: prepared.technical.images.map((image) => ({
                part_id: prepared.partId,
                image: image.image,
                thumb: image.thumb
              }))
            })
          }

          if (prepared.technical.documents.length > 0) {
            await tx.part_documents.createMany({
              data: prepared.technical.documents.map((doc) => ({
                part_id: prepared.partId,
                doc_file_name: doc.doc_file_name,
                doc_file_type_name: doc.doc_file_type_name,
                doc_id: doc.doc_id,
                doc_type_id: doc.doc_type_id,
                doc_type_name: doc.doc_type_name,
                doc_url: doc.doc_url
              }))
            })
          }
        })

        const current = previewRows[prepared.rowIndex]
        previewRows[prepared.rowIndex] = {
          ...current,
          status: 'CREATED',
          message: `Yeni ürün oluşturuldu (#${prepared.partId.toString()}).`
        }
        createdRows += 1
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Bilinmeyen hata'
        const current = previewRows[prepared.rowIndex]
        if (message.startsWith('SKIP::')) {
          previewRows[prepared.rowIndex] = {
            ...current,
            status: 'SKIPPED',
            message: message.replace('SKIP::', '')
          }
          continue
        }
        previewRows[prepared.rowIndex] = {
          ...current,
          status: 'ERROR',
          message
        }
      }
    }

    revalidateAdminPaths()
  }

  const readyRows = previewRows.filter((row) => row.status === 'READY').length
  const errorRows = previewRows.filter((row) => row.status === 'ERROR').length
  const skippedRows = previewRows.filter((row) => row.status === 'SKIPPED').length

  return {
    success: true,
    message:
      mode === 'apply'
        ? `Yeni ürün import tamamlandı. ${createdRows} satır oluşturuldu.`
        : 'Yeni ürün import önizlemesi hazır.',
    summary: {
      totalRows: previewRows.length,
      readyRows,
      createdRows,
      errorRows,
      skippedRows
    },
    rows: previewRows.slice(0, 200)
  }
}

export async function importAdminProductsCsv(
  file: File,
  mode: 'preview' | 'apply' = 'preview'
): Promise<{
  success: boolean
  message: string
  summary: {
    totalRows: number
    readyRows: number
    updatedRows: number
    errorRows: number
    skippedRows: number
  }
  rows: AdminImportPreviewRow[]
}> {
  const userId = await getAdminUserId()

  if (!file || file.size === 0) {
    return {
      success: false,
      message: 'CSV dosyası boş.',
      summary: {
        totalRows: 0,
        readyRows: 0,
        updatedRows: 0,
        errorRows: 0,
        skippedRows: 0
      },
      rows: []
    }
  }

  const text = await file.text()
  let records: Record<string, string>[] = []

  try {
    records = parse(text, {
      columns: true,
      skip_empty_lines: true,
      trim: true
    }) as Record<string, string>[]
  } catch (error) {
    return {
      success: false,
      message: `CSV okunamadı: ${error instanceof Error ? error.message : 'Bilinmeyen hata'}`,
      summary: {
        totalRows: 0,
        readyRows: 0,
        updatedRows: 0,
        errorRows: 0,
        skippedRows: 0
      },
      rows: []
    }
  }

  const previewRows: AdminImportPreviewRow[] = []
  const preparedUpdates: Array<{
    rowIndex: number
    productId: bigint
    overrides: Prisma.product_overridesUncheckedCreateInput
    overrideUpdate: Prisma.product_overridesUncheckedUpdateInput
  }> = []

  for (let i = 0; i < records.length; i++) {
    const rowNo = i + 2
    const row = records[i]

    const partIdRaw = (row.part_id || '').trim()
    const articleLinkIdRaw = (row.article_link_id || '').trim()

    if (!partIdRaw && !articleLinkIdRaw) {
      previewRows.push({
        row: rowNo,
        partId: null,
        articleLinkId: null,
        status: 'ERROR',
        message: 'part_id veya article_link_id zorunludur.'
      })
      continue
    }

    let product: { id: bigint; primary_part: { article_link_id: bigint } | null } | null = null

    if (partIdRaw) {
      try {
        product = await db.products.findUnique({
          where: { id: BigInt(partIdRaw) },
          select: { id: true, primary_part: { select: { article_link_id: true } } }
        })
      } catch {
        product = null
      }
    }

    if (!product && articleLinkIdRaw) {
      try {
        product = await db.products.findFirst({
          where: { primary_part: { article_link_id: BigInt(articleLinkIdRaw) } },
          select: { id: true, primary_part: { select: { article_link_id: true } } }
        })
      } catch {
        product = null
      }
    }

    if (!product) {
      previewRows.push({
        row: rowNo,
        partId: partIdRaw || null,
        articleLinkId: articleLinkIdRaw || null,
        status: 'ERROR',
        message: 'Ürün bulunamadı.'
      })
      continue
    }

    const canonicalProductId = product.id
    const productArticleLinkId = product.primary_part?.article_link_id.toString() ?? null

    const priceResult = parseNumberValue(row.selling_price_override)
    if (priceResult.error) {
      previewRows.push({
        row: rowNo,
        partId: product.id.toString(),
        articleLinkId: productArticleLinkId,
        status: 'ERROR',
        message: priceResult.error
      })
      continue
    }
    if (isInvalidSellingPrice(priceResult.value)) {
      previewRows.push({
        row: rowNo,
        partId: product.id.toString(),
        articleLinkId: productArticleLinkId,
        status: 'ERROR',
        message: 'Satış fiyatı negatif olamaz.'
      })
      continue
    }

    const lockPriceResult = parseBooleanValue(row.lock_price)
    if (lockPriceResult.error) {
      previewRows.push({
        row: rowNo,
        partId: product.id.toString(),
        articleLinkId: productArticleLinkId,
        status: 'ERROR',
        message: lockPriceResult.error
      })
      continue
    }

    const hasUpdateField =
      priceResult.value !== undefined ||
      lockPriceResult.value !== undefined

    if (!hasUpdateField) {
      previewRows.push({
        row: rowNo,
        partId: product.id.toString(),
        articleLinkId: productArticleLinkId,
        status: 'SKIPPED',
        message: 'Güncellenecek alan bulunamadı.'
      })
      continue
    }

    const overrideCreate: Prisma.product_overridesUncheckedCreateInput = {
      product_id: canonicalProductId,
      updated_by: userId
    }

    const overrideUpdate: Prisma.product_overridesUncheckedUpdateInput = {
      updated_by: userId
    }

    if (priceResult.value !== undefined) {
      overrideCreate.selling_price_override = priceResult.value
      overrideUpdate.selling_price_override = priceResult.value
      if (lockPriceResult.value === undefined) {
        overrideCreate.lock_price = true
        overrideUpdate.lock_price = true
      }
    }

    if (lockPriceResult.value !== undefined) {
      overrideCreate.lock_price = lockPriceResult.value
      overrideUpdate.lock_price = lockPriceResult.value
    }

    preparedUpdates.push({
      rowIndex: previewRows.length,
      productId: canonicalProductId,
      overrides: overrideCreate,
      overrideUpdate
    })

    previewRows.push({
      row: rowNo,
      partId: product.id.toString(),
      articleLinkId: productArticleLinkId,
      status: 'READY',
      message: 'Uygulamaya hazır.'
    })
  }

  let updatedRows = 0

  if (mode === 'apply') {
    await db.$transaction(async (tx) => {
      for (const prepared of preparedUpdates) {
        await tx.product_overrides.upsert({
          where: { product_id: prepared.productId },
          update: prepared.overrideUpdate,
          create: prepared.overrides
        })


        const current = previewRows[prepared.rowIndex]
        previewRows[prepared.rowIndex] = {
          ...current,
          status: 'UPDATED',
          message: 'Güncelleme uygulandı.'
        }
        updatedRows += 1
      }
    })

    revalidateAdminPaths()
  }

  const readyRows = previewRows.filter((row) => row.status === 'READY').length
  const errorRows = previewRows.filter((row) => row.status === 'ERROR').length
  const skippedRows = previewRows.filter(
    (row) => row.status === 'SKIPPED'
  ).length

  return {
    success: true,
    message:
      mode === 'apply'
        ? `İçe aktarma tamamlandı. ${updatedRows} satır güncellendi.`
        : 'Önizleme hazır.',
    summary: {
      totalRows: previewRows.length,
      readyRows,
      updatedRows,
      errorRows,
      skippedRows
    },
    rows: previewRows.slice(0, 200)
  }
}

export async function getAdminDashboardData(): Promise<AdminDashboardData> {
  await requireAdminAuth()

  const [
    totalProducts,
    outOfStockCount,
    unpricedCount,
    unenrichedCount,
    monthlySalesRows,
    recentOrders
  ] = await Promise.all([
    // Sayımlar catalog.products üzerinden: sattığımız şey Dinamik/Başbuğ
    // ürünlerinin kanonik katalog kaydı. Eski sorgu public.parts +
    // part_pricing_inventory'ye bakıyordu; o tablolar bu veritabanında YOK, sorgu
    // `.catch` ile yutuluyor ve panel dört metriği de hep 0 gösteriyordu — yani
    // "sorun yok" gibi okunuyordu.
    db.products.count(),
    db.products.count({ where: { in_stock: false, status: 'ACTIVE' } }),
    db.products.count({ where: { min_selling_price_try: null, status: 'ACTIVE' } }),
    // Zenginleştirme ölçütü onaylı part bağlantısı — Eşleştirme sekmesindeki
    // "parts'a bağlı" ile aynı kaynak. `primary_part_id` (cache kolonu) bu
    // veritabanında hiç doldurulmuyor, ona bakmak her ürünü zenginleşmemiş
    // gösterirdi.
    db.products.count({
      where: {
        status: 'ACTIVE',
        product_part_links: { none: { status: 'CONFIRMED' } }
      }
    }),
    db.$queryRaw<
      Array<{ month_label: string; revenue: string; orders_count: number }>
    >(
      Prisma.sql`
          SELECT
            TO_CHAR(DATE_TRUNC('month', created_at), 'Mon YY') AS month_label,
            COALESCE(SUM(total_amount), 0)::text AS revenue,
            COUNT(*)::int AS orders_count
          FROM orders
          WHERE created_at >= DATE_TRUNC('month', NOW()) - INTERVAL '5 months'
          GROUP BY DATE_TRUNC('month', created_at)
          ORDER BY DATE_TRUNC('month', created_at) ASC
        `
    ),
    db.orders.findMany({
      orderBy: { created_at: 'desc' },
      take: 8,
      include: {
        users: {
          select: {
            name: true,
            email: true
          }
        }
      }
    })
  ])

  const salesSeries = monthlySalesRows.map((row) => ({
    month: row.month_label,
    revenue: toNumber(row.revenue, 0),
    orders: row.orders_count
  }))

  // Uyarılar satılabilirliğin önündeki engeller: fiyatsız ürün satılamaz,
  // stoksuz ürün sipariş alamaz, zenginleşmemiş ürün (parts'a bağlı değil)
  // görselsiz/özelliksiz listelenir.
  const alerts: AdminDashboardData['alerts'] = [
    {
      id: 'out_of_stock',
      label: 'Stokta olmayan ürün',
      value: outOfStockCount,
      severity: outOfStockCount > totalProducts / 2 ? 'high' : 'medium'
    },
    {
      id: 'unpriced',
      label: 'Fiyatsız ürün',
      value: unpricedCount,
      severity: unpricedCount > 0 ? 'high' : 'low'
    },
    {
      id: 'unenriched',
      label: "Zenginleşmemiş ürün (parts'a bağlı değil)",
      value: unenrichedCount,
      severity: unenrichedCount > totalProducts / 2 ? 'high' : 'medium'
    }
  ]

  return {
    metrics: {
      totalProducts,
      outOfStockCount,
      unpricedCount,
      unenrichedCount
    },
    salesSeries,
    recentOrders: recentOrders.map((order) => ({
      id: order.id,
      customerName: order.users?.name || 'Misafir',
      customerEmail: order.users?.email || null,
      createdAt: order.created_at.toISOString(),
      totalAmount: toNumber(order.total_amount.toString(), 0),
      status: order.status
    })),
    alerts
  }
}
