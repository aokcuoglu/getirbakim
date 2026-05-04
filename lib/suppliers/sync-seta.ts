import 'server-only'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { deleteCachePattern } from '@/lib/redis'
import { applyPolicyForPart } from '@/lib/suppliers/sync-dinamik'
import { ensureSupplierMappingCrossReference } from '@/lib/suppliers/cross-reference-mirror'
import { scheduleSearchIndexUpdate } from '@/lib/search/update-search-index'
import {
  getSetaProducts,
  type SetaProductItem,
  type SetaSyncMode
} from '@/lib/suppliers/seta-client'

const SETA_PROVIDER_CODE = 'seta'
const AUTO_APPROVE_CONFIDENCE_WITH_STRONG_SIGNAL = 0.9
const DEFAULT_STALE_DAYS = 3
const DEFAULT_ITEM_CONCURRENCY = 12
const DEFAULT_POLICY_CONCURRENCY = 12

type TriggerType = 'MANUAL' | 'SCHEDULED'

export interface SetaSyncOptions {
  triggerType?: TriggerType
  mode?: SetaSyncMode
  brand?: string
  limitProducts?: number
}

export interface SetaSyncResult {
  runId: number
  providerId: number
  status: 'SUCCESS' | 'PARTIAL_SUCCESS' | 'FAILED'
  brandCount: number
  totalCount: number
  successCount: number
  failedCount: number
  errorCount: number
  mappingMissCount: number
  approvedMappingCount: number
  offerCount: number
  policyUpdatedCount: number
}

function normalizeText(value: unknown): string | null {
  if (value == null) return null
  const text = String(value).trim()
  return text.length > 0 ? text : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function splitCodes(value: unknown): string[] {
  if (value == null) return []
  if (typeof value === 'string') {
    return value
      .split(/[,\n;|]+/g)
      .map((item) => item.trim())
      .filter(Boolean)
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => splitCodes(item))
  }
  if (isRecord(value)) {
    return Object.values(value).flatMap((item) => splitCodes(item))
  }
  return []
}

function pickStringFromRaw(raw: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = normalizeText(raw[key])
    if (value) return value
  }
  return null
}

function collectSetaOemCodesFromRaw(raw: Record<string, unknown>): string[] {
  return Array.from(
    new Set(
      [
        ...splitCodes(raw.oemListe),
        ...splitCodes(raw.oem),
        ...splitCodes(raw.oem_codes),
        ...splitCodes(raw.oemCodes),
        ...splitCodes(raw.oem_kodlari),
        ...splitCodes(raw.oemKodlari),
        ...splitCodes(raw.oem_list),
        ...splitCodes(raw.oems),
        ...splitCodes(raw.OEM),
        ...splitCodes(raw.oemNo),
        ...splitCodes(raw.oem_no)
      ]
        .map((value) => normalizeText(value))
        .filter((value): value is string => Boolean(value))
    )
  ).slice(0, 120)
}

function parseConcurrency(
  value: string | undefined,
  fallback: number,
  maxValue = 64
): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.max(1, Math.min(maxValue, Math.trunc(parsed)))
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return []

  const limit = Math.max(1, Math.min(concurrency, items.length))
  const results = new Array<R>(items.length)
  let cursor = 0

  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (true) {
        const index = cursor
        cursor += 1
        if (index >= items.length) break
        results[index] = await worker(items[index], index)
      }
    })
  )

  return results
}

function normalizeKey(value: string | null | undefined): string {
  return (value || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
}

function toDecimal(value: number | null | undefined): Prisma.Decimal | null {
  if (value == null || !Number.isFinite(value)) return null
  return new Prisma.Decimal(value)
}

async function ensureSetaProvider() {
  return db.supplier_providers.upsert({
    where: { code: SETA_PROVIDER_CODE },
    update: {
      name: 'SETA',
      status: 'ACTIVE',
      priority: 20,
      schedule: 'HOURLY',
      base_url: 'https://b2b-api.ismyazilim.com'
    },
    create: {
      code: SETA_PROVIDER_CODE,
      name: 'SETA',
      status: 'ACTIVE',
      priority: 20,
      schedule: 'HOURLY',
      base_url: 'https://b2b-api.ismyazilim.com',
      config: {
        productsPath: '/seta/products',
        supportsDelta: true
      }
    }
  })
}

async function ensureBrandAlias(providerId: number, supplierBrand: string | null) {
  const brandName = normalizeText(supplierBrand)
  if (!brandName) return null

  const partBrand = await db.part_brands.findFirst({
    where: {
      name: {
        equals: brandName,
        mode: 'insensitive'
      }
    },
    select: { id: true }
  })

  const alias = await db.supplier_brand_aliases.upsert({
    where: {
      provider_id_supplier_brand: {
        provider_id: providerId,
        supplier_brand: brandName
      }
    },
    update: {
      normalized_brand: brandName.toLocaleUpperCase('tr'),
      part_brand_id: partBrand?.id ?? null,
      mapping_status: partBrand ? 'APPROVED' : 'PENDING',
      confidence: partBrand ? new Prisma.Decimal(1) : null
    },
    create: {
      provider_id: providerId,
      supplier_brand: brandName,
      normalized_brand: brandName.toLocaleUpperCase('tr'),
      part_brand_id: partBrand?.id ?? null,
      mapping_status: partBrand ? 'APPROVED' : 'PENDING',
      confidence: partBrand ? new Prisma.Decimal(1) : null
    }
  })

  return alias.part_brand_id
}

async function upsertSupplierProduct(providerId: number, item: SetaProductItem) {
  return db.supplier_products.upsert({
    where: {
      provider_id_supplier_sku: {
        provider_id: providerId,
        supplier_sku: item.sku
      }
    },
    update: {
      supplier_product_key: `${item.brand || 'SETA'}::${item.sku}`,
      supplier_brand: item.brand,
      supplier_name: item.name,
      normalized_sku: normalizeKey(item.sku),
      normalized_name: normalizeKey(item.name),
      barcode_1: item.barcode1,
      barcode_2: item.barcode2,
      barcode_3: item.barcode3,
      supplier_price: toDecimal(item.price),
      supplier_stock_qty: item.stockQty,
      currency: item.currency || 'TRY',
      raw_json: item.raw as Prisma.InputJsonValue,
      last_seen_at: new Date()
    },
    create: {
      provider_id: providerId,
      supplier_product_key: `${item.brand || 'SETA'}::${item.sku}`,
      supplier_sku: item.sku,
      supplier_brand: item.brand,
      supplier_name: item.name,
      normalized_sku: normalizeKey(item.sku),
      normalized_name: normalizeKey(item.name),
      barcode_1: item.barcode1,
      barcode_2: item.barcode2,
      barcode_3: item.barcode3,
      supplier_price: toDecimal(item.price),
      supplier_stock_qty: item.stockQty,
      currency: item.currency || 'TRY',
      raw_json: item.raw as Prisma.InputJsonValue,
      last_seen_at: new Date()
    }
  })
}

async function syncSupplierProductApiOems(
  providerId: number,
  supplierProductId: number,
  item: SetaProductItem
) {
  const rawOemCodes = isRecord(item.raw)
    ? collectSetaOemCodesFromRaw(item.raw)
    : []
  const mergedCodes = item.oemCodes.length > 0 ? item.oemCodes : rawOemCodes
  const rows = Array.from(
    new Map(
      mergedCodes
        .map((code) => normalizeText(code))
        .filter((code): code is string => Boolean(code))
        .map((code) => {
          const normalized = normalizeKey(code)
          return [
            normalized,
            {
              oem_code: code,
              normalized_oem_code: normalized
            }
          ] as const
        })
    ).values()
  ).slice(0, 120)

  for (const row of rows) {
    await db.supplier_product_oems.upsert({
      where: {
        provider_id_supplier_product_id_normalized_oem_code_source: {
          provider_id: providerId,
          supplier_product_id: supplierProductId,
          normalized_oem_code: row.normalized_oem_code,
          source: 'API'
        }
      },
      update: {
        oem_code: row.oem_code,
        oem_brand: item.brand,
        is_active: true
      },
      create: {
        provider_id: providerId,
        supplier_product_id: supplierProductId,
        oem_code: row.oem_code,
        normalized_oem_code: row.normalized_oem_code,
        oem_brand: item.brand,
        source: 'API',
        is_active: true
      }
    })
  }

  if (rows.length === 0) {
    await db.supplier_product_oems.updateMany({
      where: {
        provider_id: providerId,
        supplier_product_id: supplierProductId,
        source: 'API'
      },
      data: { is_active: false }
    })
    return
  }

  await db.supplier_product_oems.updateMany({
    where: {
      provider_id: providerId,
      supplier_product_id: supplierProductId,
      source: 'API',
      normalized_oem_code: {
        notIn: rows.map((row) => row.normalized_oem_code)
      }
    },
    data: { is_active: false }
  })
}

async function findBestCandidate(
  providerId: number,
  supplierProductId: number,
  item: SetaProductItem,
  partBrandId: number | null
) {
  const candidateMap = new Map<
    bigint,
    {
      score: number
      reasons: string[]
      hasStrongSignal: boolean
    }
  >()

  const addScore = (partId: bigint, score: number, reason: string) => {
    const current = candidateMap.get(partId)
    if (current) {
      current.score += score
      current.reasons.push(reason)
      if (reason === 'ean' || reason === 'part_exact') {
        current.hasStrongSignal = true
      }
      return
    }
    candidateMap.set(partId, {
      score,
      reasons: [reason],
      hasStrongSignal: reason === 'ean' || reason === 'part_exact'
    })
  }

  const barcodeList = [item.barcode1, item.barcode2, item.barcode3].filter(
    (value): value is string => Boolean(value)
  )
  if (barcodeList.length > 0) {
    const rows = await db.part_eans.findMany({
      where: { code: { in: barcodeList } },
      select: { part_id: true }
    })
    for (const row of rows) addScore(row.part_id, 0.65, 'ean')
  }

  if (item.partNo && /^\d+$/.test(item.partNo)) {
    const articleLinkId = BigInt(item.partNo)
    const rows = await db.parts.findMany({
      where: { article_link_id: articleLinkId },
      select: { id: true },
      take: 8
    })
    for (const row of rows) addScore(row.id, 0.9, 'part_exact')
  }

  const oemRows = await db.supplier_product_oems.findMany({
    where: {
      provider_id: providerId,
      supplier_product_id: supplierProductId,
      is_active: true
    },
    select: {
      normalized_oem_code: true,
      oem_brand: true
    },
    take: 120
  })

  const oemMatchedPartIds = new Set<bigint>()
  if (oemRows.length > 0) {
    const codeVariants = Array.from(
      new Set(
        oemRows
          .map((row) => normalizeText(row.normalized_oem_code))
          .filter((value): value is string => Boolean(value))
      )
    ).slice(0, 300)
    const brands = new Set(
      oemRows
        .map((row) => normalizeText(row.oem_brand)?.toLocaleUpperCase('tr'))
        .filter((value): value is string => Boolean(value))
    )

    const rows =
      codeVariants.length > 0
        ? await db.$queryRaw<Array<{ id: string; brand: string | null }>>(Prisma.sql`
            SELECT DISTINCT po.part_id::text AS id, po.brand
            FROM part_oens po
            WHERE regexp_replace(UPPER(po.code), '[^A-Z0-9]', '', 'g') IN (${Prisma.join(
              codeVariants.map((code) => Prisma.sql`${code}`),
              ','
            )})
            LIMIT 64
          `)
        : []

    for (const row of rows) {
      const partId = BigInt(row.id)
      oemMatchedPartIds.add(partId)
      addScore(partId, 0.75, 'oem_exact')
      const oemBrand = normalizeText(row.brand)?.toLocaleUpperCase('tr')
      if (oemBrand && brands.has(oemBrand)) {
        addScore(partId, 0.08, 'oem_brand')
      }
    }
  }

  if (candidateMap.size === 0) {
    return {
      partId: null,
      confidence: null,
      reasons: ['oem_miss'],
      autoApproveEligible: false,
      matchReason: 'oem_miss' as const
    }
  }

  const partIds = Array.from(candidateMap.keys())
  const metaRows = await db.parts.findMany({
    where: { id: { in: partIds } },
    select: { id: true, brand_id: true }
  })
  const brandMap = new Map(metaRows.map((row) => [row.id, row.brand_id]))

  let winner:
    | {
        partId: bigint
        confidence: number
        reasons: string[]
        hasStrongSignal: boolean
      }
    | null = null
  for (const [partId, row] of candidateMap.entries()) {
    let confidence = row.score
    if (partBrandId && brandMap.get(partId) === partBrandId) {
      confidence += 0.1
      row.reasons.push('brand_alias')
    }
    const bounded = Math.min(0.999, confidence)

    if (!winner || bounded > winner.confidence) {
      winner = {
        partId,
        confidence: bounded,
        reasons: row.reasons,
        hasStrongSignal: row.hasStrongSignal
      }
    }
  }

  if (!winner) {
    return {
      partId: null,
      confidence: null,
      reasons: ['oem_miss'],
      autoApproveEligible: false,
      matchReason: 'oem_miss' as const
    }
  }

  // OEM-only matches are never auto-approved.
  if (!winner.hasStrongSignal) {
    if (oemMatchedPartIds.size === 0) {
      return {
        partId: null,
        confidence: winner.confidence,
        reasons: ['oem_miss'],
        autoApproveEligible: false,
        matchReason: 'oem_miss' as const
      }
    }

    if (oemMatchedPartIds.size === 1) {
      return {
        partId: Array.from(oemMatchedPartIds)[0],
        confidence: winner.confidence,
        reasons: ['oem_exact_unique'],
        autoApproveEligible: false,
        matchReason: 'oem_exact_unique' as const
      }
    }

    return {
      partId: null,
      confidence: winner.confidence,
      reasons: ['oem_exact_ambiguous'],
      autoApproveEligible: false,
      matchReason: 'oem_exact_ambiguous' as const
    }
  }

  return {
    partId: winner.partId,
    confidence: winner.confidence,
    reasons: winner.reasons,
    autoApproveEligible: true,
    matchReason: winner.reasons.join(',')
  }
}

async function upsertMapping(args: {
  providerId: number
  supplierProductId: number
  supplierSku: string
  candidate: {
    partId: bigint | null
    confidence: number | null
    reasons: string[]
    autoApproveEligible: boolean
    matchReason: string
  } | null
}) {
  const existing = await db.supplier_part_mappings.findFirst({
    where: {
      provider_id: args.providerId,
      supplier_product_id: args.supplierProductId
    }
  })

  const shouldAutoApprove =
    args.candidate &&
    args.candidate.partId != null &&
    args.candidate.confidence != null &&
    args.candidate.confidence >= AUTO_APPROVE_CONFIDENCE_WITH_STRONG_SIGNAL &&
    args.candidate.autoApproveEligible
  const mappedPartId =
    shouldAutoApprove || args.candidate?.matchReason === 'oem_exact_unique'
      ? args.candidate?.partId ?? null
      : args.candidate?.autoApproveEligible
        ? args.candidate?.partId ?? null
        : null
  const matchReason = args.candidate?.matchReason || 'oem_miss'

  if (existing?.is_manual) {
    return existing
  }

  if (existing?.status === 'APPROVED' && existing.part_id) {
    return existing
  }

  if (existing) {
    return db.supplier_part_mappings.update({
      where: { id: existing.id },
      data: {
        supplier_sku: args.supplierSku,
        part_id: mappedPartId,
        status: shouldAutoApprove ? 'APPROVED' : 'QUEUE',
        workflow_status: shouldAutoApprove ? 'MATCHED_EXISTING' : 'NEW',
        confidence:
          args.candidate?.confidence != null
            ? new Prisma.Decimal(args.candidate.confidence)
            : null,
        match_reason: matchReason,
        is_manual: false,
        approved_by: shouldAutoApprove ? 'system:auto' : null,
        approved_at: shouldAutoApprove ? new Date() : null,
        ignored_reason: null
      }
    })
  }

  return db.supplier_part_mappings.create({
    data: {
      provider_id: args.providerId,
      supplier_product_id: args.supplierProductId,
      supplier_sku: args.supplierSku,
      part_id: mappedPartId,
      status: shouldAutoApprove ? 'APPROVED' : 'QUEUE',
      workflow_status: shouldAutoApprove ? 'MATCHED_EXISTING' : 'NEW',
      confidence:
        args.candidate?.confidence != null
          ? new Prisma.Decimal(args.candidate.confidence)
          : null,
      match_reason: matchReason,
      is_manual: false,
      approved_by: shouldAutoApprove ? 'system:auto' : null,
      approved_at: shouldAutoApprove ? new Date() : null,
      ignored_reason: null
    }
  })
}

async function upsertOffer(args: {
  providerId: number
  supplierProductId: number
  partId: bigint
  supplierPrice: number | null
  supplierStockQty: number
  currency: string
}) {
  await db.part_supplier_offers.upsert({
    where: {
      provider_id_supplier_product_id: {
        provider_id: args.providerId,
        supplier_product_id: args.supplierProductId
      }
    },
    update: {
      part_id: args.partId,
      supplier_price: toDecimal(args.supplierPrice),
      supplier_stock_qty: args.supplierStockQty,
      currency: args.currency || 'TRY',
      is_active: true,
      last_synced_at: new Date()
    },
    create: {
      provider_id: args.providerId,
      supplier_product_id: args.supplierProductId,
      part_id: args.partId,
      supplier_price: toDecimal(args.supplierPrice),
      supplier_stock_qty: args.supplierStockQty,
      currency: args.currency || 'TRY',
      is_active: true,
      last_synced_at: new Date()
    }
  })
}

async function deactivateStaleOffersForProvider(args: {
  providerId: number
  staleBefore: Date
}) {
  const rows = await db.$queryRaw<Array<{ part_id: string }>>(Prisma.sql`
    SELECT DISTINCT o.part_id::text AS part_id
    FROM part_supplier_offers o
    JOIN supplier_products sp ON sp.id = o.supplier_product_id
    WHERE o.provider_id = ${args.providerId}
      AND o.is_active = TRUE
      AND sp.last_seen_at < ${args.staleBefore}
  `)

  await db.$executeRaw(Prisma.sql`
    UPDATE part_supplier_offers o
    SET is_active = FALSE,
        updated_at = NOW(),
        last_synced_at = NOW()
    FROM supplier_products sp
    WHERE o.provider_id = ${args.providerId}
      AND o.supplier_product_id = sp.id
      AND o.is_active = TRUE
      AND sp.last_seen_at < ${args.staleBefore}
  `)

  // Zero out stock on stale supplier_products so admin counts reflect reality
  await db.$executeRaw(Prisma.sql`
    UPDATE supplier_products
    SET supplier_stock_qty = 0,
        updated_at = NOW()
    WHERE provider_id = ${args.providerId}
      AND supplier_stock_qty > 0
      AND last_seen_at < ${args.staleBefore}
  `)

  return rows
    .map((row) => {
      try {
        return BigInt(row.part_id)
      } catch {
        return null
      }
    })
    .filter((value): value is bigint => value != null)
}

async function cleanupSetaLegacyOemArtifacts(providerId: number) {
  const deletedPartOens = await db.$executeRaw<number>(Prisma.sql`
    DELETE FROM part_oens
    WHERE UPPER(TRIM(brand)) = 'SETA'
  `)

  const demotedMappings = await db.supplier_part_mappings.updateMany({
    where: {
      provider_id: providerId,
      status: 'APPROVED',
      is_manual: false,
      match_reason: {
        contains: 'oem_exact'
      },
      NOT: [
        { match_reason: { contains: 'part_exact' } },
        { match_reason: { contains: 'ean' } }
      ]
    },
    data: {
      status: 'QUEUE',
      workflow_status: 'NEW',
      approved_by: null,
      approved_at: null
    }
  })

  const deactivatedOffers = await db.$executeRaw<number>(Prisma.sql`
    UPDATE part_supplier_offers o
    SET is_active = FALSE,
        updated_at = NOW(),
        last_synced_at = NOW()
    FROM supplier_part_mappings m
    WHERE o.provider_id = ${providerId}
      AND m.provider_id = ${providerId}
      AND m.supplier_product_id = o.supplier_product_id
      AND m.status <> 'APPROVED'
      AND o.is_active = TRUE
  `)

  return {
    deletedPartOens,
    demotedMappings: demotedMappings.count,
    deactivatedOffers
  }
}

type SetaCatalogProductRow = {
  id: number
  supplier_sku: string
  supplier_brand: string | null
  supplier_name: string | null
  supplier_price: Prisma.Decimal | null
  supplier_stock_qty: number
  currency: string
  barcode_1: string | null
  barcode_2: string | null
  barcode_3: string | null
  raw_json: Prisma.JsonValue
}

function toNumber(value: Prisma.Decimal | null | undefined): number | null {
  if (!value) return null
  const parsed = Number(value.toString())
  return Number.isFinite(parsed) ? parsed : null
}

function buildSetaItemFromCatalogProduct(row: SetaCatalogProductRow): SetaProductItem {
  const raw = isRecord(row.raw_json) ? row.raw_json : {}
  const rawBrand = pickStringFromRaw(raw, [
    'marka',
    'brand',
    'brand_name',
    'brandName',
    'manufacturer'
  ])
  const rawPartNo = pickStringFromRaw(raw, [
    'part_no',
    'partNo',
    'part_number',
    'partNumber',
    'product_no',
    'productNo',
    'referans',
    'reference'
  ])

  return {
    sku: row.supplier_sku,
    name: normalizeText(row.supplier_name),
    brand: normalizeText(row.supplier_brand) || rawBrand,
    price: toNumber(row.supplier_price),
    stockQty: row.supplier_stock_qty,
    currency: normalizeText(row.currency) || 'TRY',
    barcode1: normalizeText(row.barcode_1),
    barcode2: normalizeText(row.barcode_2),
    barcode3: normalizeText(row.barcode_3),
    partNo: rawPartNo,
    oemCodes: collectSetaOemCodesFromRaw(raw),
    raw
  }
}

export interface SetaCatalogRemapOptions {
  triggerType?: TriggerType
  limitProducts?: number
  onlyQueued?: boolean
  cleanupLegacy?: boolean
}

export async function runSetaCatalogOemRemapJob(
  options: SetaCatalogRemapOptions = {}
): Promise<SetaSyncResult> {
  const provider = await ensureSetaProvider()
  const itemConcurrency = parseConcurrency(
    process.env.SETA_ITEM_CONCURRENCY,
    DEFAULT_ITEM_CONCURRENCY,
    64
  )
  const policyConcurrency = parseConcurrency(
    process.env.SUPPLIER_POLICY_CONCURRENCY,
    DEFAULT_POLICY_CONCURRENCY,
    64
  )
  const limitProducts =
    options.limitProducts && options.limitProducts > 0
      ? Math.min(Math.trunc(options.limitProducts), 50_000)
      : undefined
  const shouldCleanupLegacy = options.cleanupLegacy !== false

  const cleanupSummary = shouldCleanupLegacy
    ? await cleanupSetaLegacyOemArtifacts(provider.id)
    : null

  const rows = await db.supplier_products.findMany({
    where: {
      provider_id: provider.id,
      ...(options.onlyQueued
        ? {
            supplier_part_mappings: {
              some: {
                provider_id: provider.id,
                status: 'QUEUE'
              }
            }
          }
        : {})
    },
    select: {
      id: true,
      supplier_sku: true,
      supplier_brand: true,
      supplier_name: true,
      supplier_price: true,
      supplier_stock_qty: true,
      currency: true,
      barcode_1: true,
      barcode_2: true,
      barcode_3: true,
      raw_json: true
    },
    orderBy: {
      id: 'asc'
    },
    take: limitProducts
  })

  if (rows.length === 0) {
    throw new Error('İşlenecek SETA katalog ürünü bulunamadı.')
  }

  const run = await db.supplier_sync_runs.create({
    data: {
      provider_id: provider.id,
      trigger_type: options.triggerType || 'MANUAL',
      endpoint: 'seta/catalog-remap',
      status: 'RUNNING',
      started_at: new Date(),
      meta: {
        mode: 'SETA_CATALOG_OEM_REMAP',
        productCount: rows.length,
        onlyQueued: Boolean(options.onlyQueued),
        cleanupSummary
      }
    }
  })

  let successCount = 0
  let failedCount = 0
  let mappingMissCount = 0
  let approvedMappingCount = 0
  let offerCount = 0
  let mappedWithPartCount = 0
  const errors: string[] = []
  const affectedParts = new Set<bigint>()
  const brandSet = new Set<string>()

  try {
    const brandAliasPromiseCache = new Map<string, Promise<number | null>>()
    const resolvePartBrandId = (supplierBrand: string | null) => {
      const brandName = normalizeText(supplierBrand)
      if (!brandName) return Promise.resolve<number | null>(null)
      const key = brandName.toLocaleUpperCase('tr')
      const cached = brandAliasPromiseCache.get(key)
      if (cached) return cached
      const next = ensureBrandAlias(provider.id, brandName)
      brandAliasPromiseCache.set(key, next)
      return next
    }

    const itemResults = await mapWithConcurrency(rows, itemConcurrency, async (row) => {
      const item = buildSetaItemFromCatalogProduct(row)
      try {
        const supplierBrand = normalizeText(item.brand)
        const partBrandId = await resolvePartBrandId(supplierBrand)
        await syncSupplierProductApiOems(provider.id, row.id, item)
        const candidate = await findBestCandidate(provider.id, row.id, item, partBrandId)
        const mapping = await upsertMapping({
          providerId: provider.id,
          supplierProductId: row.id,
          supplierSku: item.sku,
          candidate
        })

        if (mapping.part_id) {
          if (mapping.status === 'APPROVED') {
            await upsertOffer({
              providerId: provider.id,
              supplierProductId: row.id,
              partId: mapping.part_id,
              supplierPrice: item.price,
              supplierStockQty: item.stockQty,
              currency: item.currency
            })
            await ensureSupplierMappingCrossReference({
              partId: mapping.part_id,
              providerCode: provider.code,
              supplierSku: item.sku
            })
            return {
              ok: true as const,
              approved: true as const,
              hasPart: true as const,
              partId: mapping.part_id,
              supplierBrand
            }
          }

          return {
            ok: true as const,
            approved: false as const,
            hasPart: true as const,
            partId: null,
            supplierBrand
          }
        }

        return {
          ok: true as const,
          approved: false as const,
          hasPart: false as const,
          partId: null,
          supplierBrand
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return {
          ok: false as const,
          error: `[${item.sku}] ${message}`
        }
      }
    })

    for (const row of itemResults) {
      if (!row.ok) {
        failedCount += 1
        errors.push(row.error)
        continue
      }

      successCount += 1
      if (row.supplierBrand) {
        brandSet.add(row.supplierBrand)
      }

      if (row.hasPart) {
        mappedWithPartCount += 1
      } else {
        mappingMissCount += 1
      }

      if (row.approved && row.partId) {
        approvedMappingCount += 1
        offerCount += 1
        affectedParts.add(row.partId)
      }
    }

    await mapWithConcurrency(
      Array.from(affectedParts),
      policyConcurrency,
      async (partId) => applyPolicyForPart(partId)
    )

    await deleteCachePattern('catalog:prices:*')
    await scheduleSearchIndexUpdate(Array.from(affectedParts))

    const status: SetaSyncResult['status'] =
      failedCount === 0 ? 'SUCCESS' : successCount > 0 ? 'PARTIAL_SUCCESS' : 'FAILED'

    await db.supplier_sync_runs.update({
      where: { id: run.id },
      data: {
        status,
        ended_at: new Date(),
        total_count: rows.length,
        success_count: successCount,
        failed_count: failedCount,
        error_summary: errors.length ? errors.slice(0, 20).join(' | ') : null,
        meta: {
          mode: 'SETA_CATALOG_OEM_REMAP',
          productCount: rows.length,
          onlyQueued: Boolean(options.onlyQueued),
          cleanupSummary,
          mappingMissCount,
          mappedWithPartCount,
          approvedMappingCount,
          offerCount,
          policyUpdatedCount: affectedParts.size
        }
      }
    })

    await db.supplier_providers.update({
      where: { id: provider.id },
      data: { last_sync_at: new Date() }
    })

    return {
      runId: run.id,
      providerId: provider.id,
      status,
      brandCount: brandSet.size,
      totalCount: rows.length,
      successCount,
      failedCount,
      errorCount: errors.length,
      mappingMissCount,
      approvedMappingCount,
      offerCount,
      policyUpdatedCount: affectedParts.size
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await db.supplier_sync_runs.update({
      where: { id: run.id },
      data: {
        status: 'FAILED',
        ended_at: new Date(),
        total_count: rows.length,
        success_count: successCount,
        failed_count: Math.max(failedCount, 1),
        error_summary: message
      }
    })
    throw error
  }
}

export async function runSetaSyncJob(
  options: SetaSyncOptions = {}
): Promise<SetaSyncResult> {
  const provider = await ensureSetaProvider()
  const mode: SetaSyncMode = options.mode || 'full'
  const itemConcurrency = parseConcurrency(
    process.env.SETA_ITEM_CONCURRENCY,
    DEFAULT_ITEM_CONCURRENCY,
    64
  )
  const policyConcurrency = parseConcurrency(
    process.env.SUPPLIER_POLICY_CONCURRENCY,
    DEFAULT_POLICY_CONCURRENCY,
    64
  )
  const requestedBrand = normalizeText(options.brand)

  const rows = await getSetaProducts(mode)
  const filteredRows = rows.filter((row) => {
    if (!requestedBrand) return true
    return normalizeText(row.brand)?.toLocaleLowerCase('tr') ===
      requestedBrand.toLocaleLowerCase('tr')
  })
  const dedupedRows = Array.from(
    new Map(
      filteredRows.map((row) => [normalizeKey(row.sku) || row.sku, row] as const)
    ).values()
  )
  const limitedRows =
    options.limitProducts && options.limitProducts > 0
      ? dedupedRows.slice(0, Math.min(options.limitProducts, 50_000))
      : dedupedRows

  if (limitedRows.length === 0) {
    throw new Error('İşlenecek SETA ürünü bulunamadı.')
  }

  const run = await db.supplier_sync_runs.create({
    data: {
      provider_id: provider.id,
      trigger_type: options.triggerType || 'MANUAL',
      endpoint: 'seta/products',
      status: 'RUNNING',
      started_at: new Date(),
      meta: {
        mode: 'SETA_SYNC',
        syncMode: mode,
        requestedBrand,
        productCount: limitedRows.length
      }
    }
  })

  let successCount = 0
  let failedCount = 0
  let mappingMissCount = 0
  let approvedMappingCount = 0
  let offerCount = 0
  const errors: string[] = []
  const affectedParts = new Set<bigint>()
  const brandSet = new Set<string>()

  try {
    const brandAliasPromiseCache = new Map<string, Promise<number | null>>()
    const resolvePartBrandId = (supplierBrand: string | null) => {
      const brandName = normalizeText(supplierBrand)
      if (!brandName) return Promise.resolve<number | null>(null)
      const key = brandName.toLocaleUpperCase('tr')
      const cached = brandAliasPromiseCache.get(key)
      if (cached) return cached
      const next = ensureBrandAlias(provider.id, brandName)
      brandAliasPromiseCache.set(key, next)
      return next
    }

    const itemResults = await mapWithConcurrency(
      limitedRows,
      itemConcurrency,
      async (item) => {
        try {
          const supplierBrand = normalizeText(item.brand)
          const partBrandId = await resolvePartBrandId(supplierBrand)
          const supplierProduct = await upsertSupplierProduct(provider.id, item)
          await syncSupplierProductApiOems(provider.id, supplierProduct.id, item)
          const candidate = await findBestCandidate(
            provider.id,
            supplierProduct.id,
            item,
            partBrandId
          )
          const mapping = await upsertMapping({
            providerId: provider.id,
            supplierProductId: supplierProduct.id,
            supplierSku: item.sku,
            candidate
          })

          if (mapping.status === 'APPROVED' && mapping.part_id) {
            await upsertOffer({
              providerId: provider.id,
              supplierProductId: supplierProduct.id,
              partId: mapping.part_id,
              supplierPrice: item.price,
              supplierStockQty: item.stockQty,
              currency: item.currency
            })
            await ensureSupplierMappingCrossReference({
              partId: mapping.part_id,
              providerCode: provider.code,
              supplierSku: item.sku
            })
            return {
              ok: true as const,
              approved: true as const,
              partId: mapping.part_id,
              supplierBrand
            }
          }

          return {
            ok: true as const,
            approved: false as const,
            partId: null,
            supplierBrand
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          return {
            ok: false as const,
            error: `[${item.sku}] ${message}`
          }
        }
      }
    )

    for (const row of itemResults) {
      if (!row.ok) {
        failedCount += 1
        errors.push(row.error)
        continue
      }

      successCount += 1
      if (row.supplierBrand) {
        brandSet.add(row.supplierBrand)
      }

      if (row.approved && row.partId) {
        approvedMappingCount += 1
        offerCount += 1
        affectedParts.add(row.partId)
      } else {
        mappingMissCount += 1
      }
    }

    const shouldRunStalePolicy = mode === 'full' && !requestedBrand
    if (shouldRunStalePolicy) {
      const staleDaysRaw = Number(process.env.SUPPLIER_STALE_DAYS || DEFAULT_STALE_DAYS)
      const staleDays = Number.isFinite(staleDaysRaw) && staleDaysRaw > 0
        ? Math.trunc(staleDaysRaw)
        : DEFAULT_STALE_DAYS
      const staleBefore = new Date(Date.now() - staleDays * 24 * 60 * 60 * 1000)
      const stalePartIds = await deactivateStaleOffersForProvider({
        providerId: provider.id,
        staleBefore
      })
      for (const partId of stalePartIds) {
        affectedParts.add(partId)
      }
    }

    await mapWithConcurrency(
      Array.from(affectedParts),
      policyConcurrency,
      async (partId) => applyPolicyForPart(partId)
    )

    await deleteCachePattern('catalog:prices:*')
    await scheduleSearchIndexUpdate(Array.from(affectedParts))

    const status: SetaSyncResult['status'] =
      failedCount === 0 ? 'SUCCESS' : successCount > 0 ? 'PARTIAL_SUCCESS' : 'FAILED'

    await db.supplier_sync_runs.update({
      where: { id: run.id },
      data: {
        status,
        ended_at: new Date(),
        total_count: limitedRows.length,
        success_count: successCount,
        failed_count: failedCount,
        error_summary: errors.length ? errors.slice(0, 20).join(' | ') : null,
        meta: {
          mode: 'SETA_SYNC',
          syncMode: mode,
          requestedBrand,
          productCount: limitedRows.length,
          mappingMissCount,
          approvedMappingCount,
          offerCount,
          policyUpdatedCount: affectedParts.size
        }
      }
    })

    await db.supplier_providers.update({
      where: { id: provider.id },
      data: { last_sync_at: new Date() }
    })

    return {
      runId: run.id,
      providerId: provider.id,
      status,
      brandCount: brandSet.size,
      totalCount: limitedRows.length,
      successCount,
      failedCount,
      errorCount: errors.length,
      mappingMissCount,
      approvedMappingCount,
      offerCount,
      policyUpdatedCount: affectedParts.size
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await db.supplier_sync_runs.update({
      where: { id: run.id },
      data: {
        status: 'FAILED',
        ended_at: new Date(),
        total_count: limitedRows.length,
        success_count: successCount,
        failed_count: Math.max(failedCount, 1),
        error_summary: message
      }
    })
    throw error
  }
}
