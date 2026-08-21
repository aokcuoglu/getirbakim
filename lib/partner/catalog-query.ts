import 'server-only'
import { db } from '@/lib/db'
import { normalizeCode, normalizeOem } from '@/lib/matching/code-normalization'
import { isMeiliUnavailableError } from '@/lib/meilisearch'
import {
  getMeiliClient,
  getProductsIndexName,
  isMeiliEnabled
} from '@/lib/search/meilisearch-client'
import type { PartnerProductRow } from './dto'
import { buildPartnerPartNoFilter } from './input'

export const PARTNER_MIN_QUERY_LENGTH = 2
export const PARTNER_DEFAULT_LIMIT = 20
export const PARTNER_MAX_LIMIT = 50

export function clampPartnerLimit(raw: string | null): number {
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) return PARTNER_DEFAULT_LIMIT
  return Math.min(Math.floor(parsed), PARTNER_MAX_LIMIT)
}

/**
 * DTO'nun ihtiyaç duyduğu EN DAR seçim. `product_offers` yalnız aktif
 * satırlarla sınırlı: pasif bir offer'ın maliyeti fiyat tabanını yanlış
 * çeker, `last_synced_at`'i de olmayan bir stoğu taze gösterir.
 */
function partnerProductSelect(vehicleTypeId: number | null) {
  return {
  id: true,
  part_no: true,
  part_no_norm: true,
  name: true,
  primary_image_url: true,
  min_selling_price_try: true,
  total_stock_qty: true,
  brand: { select: { brand: true, display_name: true } },
  category: { select: { name: true, name_tr: true } },
  product_oems: { select: { code: true, code_norm: true, oem_brand: true }, take: 12 },
  product_vehicle_types: {
    where: vehicleTypeId == null ? { vehicle_type_id: -1 } : { vehicle_type_id: vehicleTypeId },
    select: { vehicle_type_id: true },
    take: 1
  },
  product_overrides: {
    select: { name_override: true, selling_price_override: true, lock_price: true }
  },
  product_offers: {
    where: { is_active: true, supplier: { is: { is_active: true } } },
    select: {
      id: true,
      supplier_code: true,
      selling_price_try: true,
      net_cost_try: true,
      stock_qty: true,
      last_synced_at: true,
      supplier: { select: { name: true } }
    }
  }
  } as const
}

/** Partnere yalnız yayında olan ürünler görünür. */
const PARTNER_VISIBLE = { status: 'ACTIVE' } as const

export async function getPartnerProductById(
  id: bigint,
  vehicleTypeId: number | null = null
): Promise<PartnerProductRow | null> {
  return db.products.findFirst({
    where: { id, ...PARTNER_VISIBLE },
    select: partnerProductSelect(vehicleTypeId)
  })
}

async function loadProductsPreservingOrder(
  ids: bigint[],
  vehicleTypeId: number | null
): Promise<PartnerProductRow[]> {
  if (ids.length === 0) return []

  const rows = await db.products.findMany({
    where: { id: { in: ids }, ...PARTNER_VISIBLE },
    select: partnerProductSelect(vehicleTypeId)
  })

  // Meili'nin alaka sırası korunmalı — `findMany` sırayı garanti etmez.
  const byId = new Map(rows.map((row) => [row.id.toString(), row]))
  return ids.map((id) => byId.get(id.toString())).filter((row): row is PartnerProductRow => !!row)
}

/**
 * OEM koduyla arama — B2B'nin asıl yolu. Atölye elindeki koda bakar, serbest
 * metin aramaz; bu yüzden bu dal Meili'ye HİÇ uğramaz, doğrudan indeksli
 * `product_oems.code_norm` üzerinden gider.
 */
async function searchByOem(
  oem: string,
  limit: number,
  vehicleTypeId: number | null
): Promise<PartnerProductRow[]> {
  const codeNorm = normalizeOem(oem)
  if (!codeNorm) return []

  const matches = await db.product_oems.findMany({
    where: { code_norm: codeNorm },
    select: { product_id: true },
    take: limit * 2
  })

  const ids = [...new Set(matches.map((m) => m.product_id.toString()))]
    .slice(0, limit)
    .map((id) => BigInt(id))

  return loadProductsPreservingOrder(ids, vehicleTypeId)
}

/**
 * Üretici parça numarasıyla tam eşleşme. `part_no_norm` marka genelinde
 * unique değildir; bu nedenle tek ürün varsayılmaz ve bounded `0..N` sonuç
 * döner. Serbest metin/Meili yolu bu dalda kasıtlı olarak kullanılmaz.
 */
async function searchByPartNo(
  partNo: string,
  limit: number,
  vehicleTypeId: number | null
): Promise<PartnerProductRow[]> {
  const where = buildPartnerPartNoFilter(partNo)
  if (!where) return []

  return db.products.findMany({
    where,
    select: partnerProductSelect(vehicleTypeId),
    orderBy: { id: 'asc' },
    take: limit
  })
}

/**
 * Meili kapalı ya da erişilemez olduğunda kullanılan Postgres dalı.
 * `part_no_norm` indekslidir; ad araması ona ek olarak yapılır.
 */
async function searchByPrismaFallback(
  q: string,
  limit: number,
  vehicleTypeId: number | null
): Promise<PartnerProductRow[]> {
  const partNoNorm = normalizeCode(q)

  const rows = await db.products.findMany({
    where: {
      ...PARTNER_VISIBLE,
      OR: [
        ...(partNoNorm ? [{ part_no_norm: { startsWith: partNoNorm } }] : []),
        { name: { contains: q, mode: 'insensitive' as const } }
      ]
    },
    select: partnerProductSelect(vehicleTypeId),
    orderBy: [{ in_stock: 'desc' as const }, { updated_at: 'desc' as const }],
    take: limit
  })

  return rows
}

export interface PartnerSearchResult {
  rows: PartnerProductRow[]
  /** Hangi dal cevapladı — sorun ayıklamak için yanıtta taşınır. */
  source: 'part_no' | 'oem' | 'meilisearch' | 'database'
}

/**
 * Partner araması.
 *
 * FİYAT/STOK MEİLİ'DEN OKUNMAZ: indeks vitrin fiyatını taşır ve sync arasında
 * bayatlar. Meili yalnız ALAKA SIRASINI üretir (hangi ürünler, hangi sırayla);
 * fiyat ve stok her zaman `catalog.products` + `product_offers` rollup'ından
 * yeniden okunur. Aksi hâlde partnere indeksteki eski fiyattan söz vermiş
 * olurduk.
 */
export async function searchPartnerProducts(input: {
  q: string | null
  oem: string | null
  partNo?: string | null
  limit: number
  vehicleTypeId: number | null
}): Promise<PartnerSearchResult> {
  if (input.partNo) {
    return {
      rows: await searchByPartNo(input.partNo, input.limit, input.vehicleTypeId),
      source: 'part_no'
    }
  }

  if (input.oem) {
    return { rows: await searchByOem(input.oem, input.limit, input.vehicleTypeId), source: 'oem' }
  }

  const q = (input.q ?? '').trim()
  if (q.length < PARTNER_MIN_QUERY_LENGTH) {
    return { rows: [], source: 'database' }
  }

  if (isMeiliEnabled()) {
    try {
      const index = getMeiliClient().index(getProductsIndexName())
      const hits = await index.search(q, {
        filter: 'documentType = "canonical_part"',
        limit: input.limit,
        attributesToRetrieve: ['id']
      })

      const ids = (hits.hits as { id?: unknown }[])
        .map((hit) => (typeof hit.id === 'string' ? hit.id : null))
        .filter((id): id is string => !!id && /^\d+$/.test(id))
        .map((id) => BigInt(id))

      return { rows: await loadProductsPreservingOrder(ids, input.vehicleTypeId), source: 'meilisearch' }
    } catch (error) {
      // Meili'nin düşmesi partner aramasını düşürmemeli — Postgres'e in.
      if (!isMeiliUnavailableError(error)) throw error
    }
  }

  return { rows: await searchByPrismaFallback(q, input.limit, input.vehicleTypeId), source: 'database' }
}
