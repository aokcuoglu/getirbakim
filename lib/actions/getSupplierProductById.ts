'use server'

import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'

export interface SupplierProductPublicDetail {
  id: number
  provider: {
    id: number
    code: string
    name: string
  }
  sku: string
  name: string | null
  brand: string | null
  price: number | null
  currency: string
  stockQty: number
  lastSeenAt: string
  imageUrl: string | null
  oemCodes: string[]
  crossCodes: string[]
  crossLinks: Array<{
    code: string
    partId: string | null
  }>
  mappedPartId: string | null
  mappedPart: {
    id: string
    name: string
    brand: string | null
    category: string | null
    articleLinkId: string
  } | null
  rawJson: Record<string, unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeText(value: unknown): string | null {
  if (typeof value === 'string') {
    const normalized = value.trim()
    return normalized.length > 0 ? normalized : null
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  return null
}

function extractCodesFromUnknown(value: unknown, depth = 0): string[] {
  if (depth > 4 || value == null) return []

  if (typeof value === 'string') {
    return value
      .split(/[\n,;|]+/g)
      .map((item) => item.trim())
      .filter(Boolean)
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return [String(value)]
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => extractCodesFromUnknown(item, depth + 1))
  }

  if (!isRecord(value)) return []

  const picked: string[] = []
  const directKeys = [
    'code',
    'value',
    'articleNumber',
    'article_number',
    'oem',
    'sku',
    'partNo',
    'part_no'
  ]

  for (const key of directKeys) {
    const text = normalizeText(value[key])
    if (text) picked.push(text)
  }

  const nestedKeys = [
    'items',
    'list',
    'rows',
    'data',
    'values',
    'codes',
    'oems',
    'cross',
    'crossReferences'
  ]

  for (const key of nestedKeys) {
    picked.push(...extractCodesFromUnknown(value[key], depth + 1))
  }

  return picked
}

function normalizeCodeKey(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]+/g, '')
}

async function resolveCrossLinks(codes: string[]): Promise<
  Array<{
    code: string
    partId: string | null
  }>
> {
  const normalizedTokens = Array.from(
    new Set(
      codes
        .map((code) => normalizeCodeKey(code.trim()))
        .filter((token) => token.length > 0)
    )
  )

  if (normalizedTokens.length === 0) {
    return codes.map((code) => ({ code, partId: null }))
  }

  const tokenSql = Prisma.join(normalizedTokens.map((token) => Prisma.sql`${token}`))

  const rows = await db.$queryRaw<
    Array<{
      token: string
      part_id: string
    }>
  >(Prisma.sql`
    WITH input_tokens AS (
      SELECT unnest(ARRAY[${tokenSql}]::text[]) AS token
    ),
    candidates AS (
      SELECT DISTINCT
        regexp_replace(upper(pcr.article_number), '[^A-Z0-9]+', '', 'g') AS token,
        pcr.part_id::text AS part_id
      FROM part_cross_references pcr
      WHERE regexp_replace(upper(pcr.article_number), '[^A-Z0-9]+', '', 'g') IN (
        SELECT token FROM input_tokens
      )
      UNION
      SELECT DISTINCT
        regexp_replace(upper(CAST(p.part_no AS TEXT)), '[^A-Z0-9]+', '', 'g') AS token,
        p.id::text AS part_id
      FROM parts p
      WHERE regexp_replace(upper(CAST(p.part_no AS TEXT)), '[^A-Z0-9]+', '', 'g') IN (
        SELECT token FROM input_tokens
      )
    )
    SELECT token, part_id
    FROM candidates
  `)

  const tokenPartIds = new Map<string, Set<string>>()
  for (const row of rows) {
    const token = row.token || ''
    const partId = row.part_id || ''
    if (!token || !partId) continue
    if (!tokenPartIds.has(token)) tokenPartIds.set(token, new Set())
    tokenPartIds.get(token)!.add(partId)
  }

  return codes.map((code) => {
    const token = normalizeCodeKey(code.trim())
    const partIds = tokenPartIds.get(token)
    if (!partIds || partIds.size !== 1) {
      return { code, partId: null }
    }
    return { code, partId: Array.from(partIds)[0] }
  })
}

type SupplierProductOemRow = { oem_code: string }

async function loadSupplierProductOemRows(
  supplierProductId: number
): Promise<SupplierProductOemRow[]> {
  try {
    return await db.supplier_product_oems.findMany({
      where: {
        supplier_product_id: supplierProductId,
        is_active: true
      },
      select: {
        oem_code: true
      },
      orderBy: [{ updated_at: 'desc' }],
      take: 200
    })
  } catch {
    return []
  }
}

function dedupeCodes(values: string[], limit = 200): string[] {
  const seen = new Set<string>()
  const result: string[] = []

  for (const value of values) {
    const trimmed = value.trim()
    if (!trimmed) continue
    const normalizedKey = normalizeCodeKey(trimmed)
    if (!normalizedKey) continue
    if (seen.has(normalizedKey)) continue
    seen.add(normalizedKey)
    result.push(trimmed)
    if (result.length >= limit) break
  }

  return result
}

function extractCrossCodesFromUnknown(value: unknown, depth = 0): string[] {
  if (depth > 4 || value == null) return []

  if (typeof value === 'string') {
    return value
      .split(/[\n,;|]+/g)
      .map((item) => item.trim())
      .filter(Boolean)
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return [String(value)]
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => extractCrossCodesFromUnknown(item, depth + 1))
  }

  if (!isRecord(value)) return []

  const collected: string[] = []

  // Typical structured entries (array items or object payloads)
  const structuredKeys = [
    'code',
    'value',
    'articleNumber',
    'article_number',
    'partNo',
    'part_no',
    'sku'
  ]
  for (const key of structuredKeys) {
    const normalized = normalizeText(value[key])
    if (normalized) collected.push(normalized)
  }

  // SETA cross payload may come as brand->code map object:
  // { "Mann": "W 712/95", "Mahle": "OC977/1", ... }
  for (const item of Object.values(value)) {
    if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
      collected.push(String(item))
      continue
    }

    collected.push(...extractCrossCodesFromUnknown(item, depth + 1))
  }

  return collected
}

function normalizeImageUrl(url: string): string {
  if (url.startsWith('//')) return `https:${url}`
  return url
}

function extractImageUrl(raw: Record<string, unknown>): string | null {
  const imageKeys = [
    'image',
    'image_url',
    'imageUrl',
    'resimUrl',
    'resim_url',
    'photo',
    'img',
    'thumbnail'
  ]

  for (const key of imageKeys) {
    const candidates = extractCodesFromUnknown(raw[key], 0)
    const first = candidates.find((item) => item.includes('/'))
    if (first) return normalizeImageUrl(first)
  }

  return null
}

export async function getSupplierProductById(
  supplierProductId: number
): Promise<SupplierProductPublicDetail | null> {
  if (!Number.isInteger(supplierProductId) || supplierProductId <= 0) {
    return null
  }

  const supplierProduct = await db.supplier_products.findFirst({
    where: {
      id: supplierProductId
    },
    select: {
      id: true,
      supplier_sku: true,
      supplier_name: true,
      supplier_brand: true,
      supplier_price: true,
      supplier_stock_qty: true,
      currency: true,
      last_seen_at: true,
      raw_json: true,
      supplier_providers: {
        select: {
          id: true,
          code: true,
          name: true
        }
      },
      supplier_part_mappings: {
        select: {
          part_id: true,
          status: true,
          is_manual: true,
          updated_at: true
        },
        orderBy: [{ is_manual: 'desc' }, { updated_at: 'desc' }],
        take: 20
      }
    }
  })

  if (!supplierProduct) return null

  const raw = isRecord(supplierProduct.raw_json)
    ? supplierProduct.raw_json
    : {}

  const oemRows = await loadSupplierProductOemRows(supplierProduct.id)

  const oemCodes = dedupeCodes(
    [
      ...oemRows.map((row) => row.oem_code),
      ...extractCodesFromUnknown(raw.oems),
      ...extractCodesFromUnknown(raw.oem),
      ...extractCodesFromUnknown(raw.oemListe),
      ...extractCodesFromUnknown(raw.oem_codes),
      ...extractCodesFromUnknown(raw.oemCodes),
      ...extractCodesFromUnknown(raw.oemKodlari),
      ...extractCodesFromUnknown(raw.oem_kodlari)
    ],
    250
  )

  const crossCodes = dedupeCodes(
    [
      ...extractCrossCodesFromUnknown(raw.cross),
      ...extractCrossCodesFromUnknown(raw.crosses),
      ...extractCrossCodesFromUnknown(raw.crossReferences),
      ...extractCrossCodesFromUnknown(raw.reference),
      ...extractCrossCodesFromUnknown(raw.references)
    ],
    250
  )

  const mappedMapping = supplierProduct.supplier_part_mappings.find((mapping) => {
    if (mapping.part_id == null) return false
    const status = mapping.status.toUpperCase()
    return status !== 'REJECTED' && status !== 'IGNORED'
  })

  const mappedPartId = mappedMapping?.part_id ? mappedMapping.part_id.toString() : null

  const [crossLinks, mappedPartRow] = await Promise.all([
    resolveCrossLinks(crossCodes),
    mappedMapping?.part_id
      ? db.parts.findFirst({
          where: { id: mappedMapping.part_id },
          select: {
            id: true,
            name: true,
            article_link_id: true,
            part_brands: { select: { name: true } },
            part_categories: { select: { name: true } }
          }
        })
      : Promise.resolve(null)
  ])

  const mappedPart = mappedPartRow
    ? {
        id: mappedPartRow.id.toString(),
        name: mappedPartRow.name,
        brand: mappedPartRow.part_brands?.name ?? null,
        category: mappedPartRow.part_categories?.name ?? null,
        articleLinkId: mappedPartRow.article_link_id.toString()
      }
    : null

  return {
    id: supplierProduct.id,
    provider: {
      id: supplierProduct.supplier_providers.id,
      code: supplierProduct.supplier_providers.code,
      name: supplierProduct.supplier_providers.name
    },
    sku: supplierProduct.supplier_sku,
    name: supplierProduct.supplier_name,
    brand: supplierProduct.supplier_brand,
    price: supplierProduct.supplier_price
      ? Number(supplierProduct.supplier_price.toString())
      : null,
    currency: supplierProduct.currency,
    stockQty: supplierProduct.supplier_stock_qty,
    lastSeenAt: supplierProduct.last_seen_at.toISOString(),
    imageUrl: extractImageUrl(raw),
    oemCodes,
    crossCodes,
    crossLinks,
    mappedPartId,
    mappedPart,
    rawJson: raw
  }
}

export async function ensureSupplierProductPurchasablePartId(
  supplierProductId: number
): Promise<string | null> {
  if (!Number.isInteger(supplierProductId) || supplierProductId <= 0) {
    return null
  }

  const supplierProduct = await db.supplier_products.findUnique({
    where: { id: supplierProductId },
    select: {
      id: true,
      part_reference_links: {
        where: {
          is_active: true
        },
        select: {
          derived_part_id: true,
          source_part_id: true,
          updated_at: true
        },
        orderBy: [{ updated_at: 'desc' }],
        take: 5
      },
      supplier_part_mappings: {
        where: {
          part_id: { not: null },
          status: 'APPROVED'
        },
        select: {
          part_id: true,
          is_manual: true,
          updated_at: true
        },
        orderBy: [{ is_manual: 'desc' }, { updated_at: 'desc' }],
        take: 10
      }
    }
  })

  if (!supplierProduct) return null

  const candidateIds: bigint[] = []

  for (const link of supplierProduct.part_reference_links) {
    if (link.derived_part_id && link.derived_part_id !== link.source_part_id) {
      candidateIds.push(link.derived_part_id)
    }
    if (link.source_part_id) {
      candidateIds.push(link.source_part_id)
    }
  }

  for (const mapping of supplierProduct.supplier_part_mappings) {
    if (mapping.part_id) {
      candidateIds.push(mapping.part_id)
    }
  }

  const orderedUniqueCandidates: bigint[] = []
  const seen = new Set<string>()
  for (const id of candidateIds) {
    const key = id.toString()
    if (seen.has(key)) continue
    seen.add(key)
    orderedUniqueCandidates.push(id)
  }

  if (orderedUniqueCandidates.length === 0) return null

  const existingParts = await db.parts.findMany({
    where: {
      id: { in: orderedUniqueCandidates }
    },
    select: {
      id: true
    }
  })

  if (existingParts.length === 0) return null

  const existingIds = new Set(existingParts.map((part) => part.id.toString()))
  const preferred = orderedUniqueCandidates.find((id) =>
    existingIds.has(id.toString())
  )

  return preferred ? preferred.toString() : null
}

function normalizeSkuLookupKey(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '')
}

export async function resolveSupplierProductPartIdByLookup(input: {
  providerCode: string
  sku: string
}): Promise<string | null> {
  const providerCode = input.providerCode.trim().toLowerCase()
  const sku = input.sku.trim()

  if (!providerCode || !sku) return null

  const provider = await db.supplier_providers.findUnique({
    where: {
      code: providerCode
    },
    select: {
      id: true
    }
  })

  if (!provider) return null

  const normalizedSku = normalizeSkuLookupKey(sku)
  const supplierProduct = await db.supplier_products.findFirst({
    where: {
      provider_id: provider.id,
      OR: [
        {
          supplier_sku: {
            equals: sku,
            mode: 'insensitive'
          }
        },
        ...(normalizedSku
          ? [
              {
                normalized_sku: {
                  equals: normalizedSku,
                  mode: 'insensitive' as const
                }
              }
            ]
          : [])
      ]
    },
    select: {
      id: true
    }
  })

  if (!supplierProduct) return null
  return ensureSupplierProductPurchasablePartId(supplierProduct.id)
}

export async function getSupplierProductByLookup(input: {
  providerCode: string
  sku: string
}): Promise<SupplierProductPublicDetail | null> {
  const providerCode = input.providerCode.trim().toLowerCase()
  const sku = input.sku.trim()

  if (!providerCode || !sku) return null

  const provider = await db.supplier_providers.findUnique({
    where: {
      code: providerCode
    },
    select: {
      id: true
    }
  })

  if (!provider) return null

  const normalizedSku = normalizeSkuLookupKey(sku)
  const supplierProduct = await db.supplier_products.findFirst({
    where: {
      provider_id: provider.id,
      OR: [
        {
          supplier_sku: {
            equals: sku,
            mode: 'insensitive'
          }
        },
        ...(normalizedSku
          ? [
              {
                normalized_sku: {
                  equals: normalizedSku,
                  mode: 'insensitive' as const
                }
              }
            ]
          : [])
      ]
    },
    select: {
      id: true
    }
  })

  if (!supplierProduct) return null

  return getSupplierProductById(supplierProduct.id)
}
