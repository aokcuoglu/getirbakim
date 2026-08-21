import { Prisma } from '@prisma/client'
import {
  resolveCatalogAvailability,
  resolveCatalogName,
  type CatalogAvailability
} from '@/lib/catalog/store-view'
import { resolvePartnerPrice, type PartnerPriceView } from './b2b-pricing'

export type PartnerOfferAvailability = 'IN_STOCK' | 'SUPPLYABLE' | 'UNKNOWN'

export interface PartnerOfferDto {
  supplierDisplayName: string
  /** GetirBakım-owned, informational/non-binding B2B price; kuruş, ex-VAT. */
  informationalPriceKurus: number | null
  currency: 'TRY'
  vatRateBps: 2000
  availability: PartnerOfferAvailability
  /** Null means the supplier's stock feed is not reliable enough to present. */
  stockQty: number | null
  lastSyncedAt: string | null
}

/**
 * Partner API'nin DIŞA AÇIK veri sözleşmesi (BAK-183).
 *
 * Bu tip sınırdır: burada olmayan hiçbir alan partnere gitmez. Özellikle
 * `net_cost_try`, `list_price`, `campaign_rate`, tedarikçi kodu ve
 * `stock_breakdown` KASITLI olarak yoktur — bunlar marjımızı ve tedarikçi
 * ilişkilerimizi açık eder. Yeni bir alan eklerken soru "faydalı mı" değil,
 * "partnerin görmesinde sakınca var mı" olmalı.
 */
export interface PartnerProductDto {
  contractVersion: '1.2'
  /** Immutable `catalog.products.id`; use this instead of display/manufacturer codes. */
  sourceProductId: string
  id: string
  /** Kanonik parça numarası (görüntü biçimi). */
  partNo: string
  /** Separator/case-independent manufacturer part identity. */
  manufacturerPartNumber: { value: string; normalized: string }
  name: string
  brandName: string
  categoryName: string | null
  oemNumbers: string[]
  references: { type: 'OEM'; value: string; normalized: string; brand: string | null }[]
  exactFitment: {
    requestedVehicleTypeId: number | null
    status: 'CONFIRMED' | 'NOT_CONFIRMED' | 'NOT_REQUESTED'
    matchedVehicleTypeIds: number[]
  }
  imageUrl: string | null
  /** Vitrin liste fiyatı — kuruş, KDV hariç. */
  listPriceKurus: number | null
  /** GetirBakım-owned informational B2B sale price; non-binding, kuruş/KDV hariç. */
  b2bPriceKurus: number | null
  discountBps: number
  vatRateBps: number
  currency: string
  stockQty: number
  availability: CatalogAvailability
  /**
   * Stok/fiyatın tedarikçiden en son çekildiği an (ISO-8601) ya da null.
   *
   * SÖZLEŞMENİN PARÇASI: bu uç "anlık stok" VAAT ETMEZ. Veri `product_offers`
   * rollup'ından gelir ve sync aralığı kadar bayattır; tüketici taraf bunu
   * kullanıcıya göstermek zorunda (BAK-183 kabul kriteri).
   */
  lastSyncedAt: string | null
  /** One canonical active offer per active supplier; internal fields are excluded. */
  offers: PartnerOfferDto[]
}

/** DTO'yu üretmek için gereken EN DAR satır — route'un `select`'i bunu karşılar. */
export interface PartnerProductRow {
  id: bigint
  part_no: string
  part_no_norm: string
  name: string
  primary_image_url: string | null
  min_selling_price_try: Prisma.Decimal | null
  total_stock_qty: number
  brand: { brand: string; display_name: string | null }
  category: { name: string; name_tr: string | null } | null
  product_oems: { code: string; code_norm: string; oem_brand: string }[]
  product_vehicle_types: { vehicle_type_id: number }[]
  product_overrides: {
    name_override: string | null
    selling_price_override: Prisma.Decimal | null
    lock_price: boolean
  } | null
  product_offers: {
    id: bigint
    supplier_code: string
    selling_price_try: Prisma.Decimal | null
    net_cost_try: Prisma.Decimal | null
    stock_qty: number
    last_synced_at: Date
    supplier: { name: string }
  }[]
}

function compareOffers(
  left: PartnerProductRow['product_offers'][number],
  right: PartnerProductRow['product_offers'][number]
): number {
  const stockOrder = Number(right.stock_qty > 0) - Number(left.stock_qty > 0)
  if (stockOrder !== 0) return stockOrder

  if (left.selling_price_try == null) {
    if (right.selling_price_try != null) return 1
  } else if (right.selling_price_try == null) {
    return -1
  } else {
    const priceOrder = left.selling_price_try.comparedTo(right.selling_price_try)
    if (priceOrder !== 0) return priceOrder
  }

  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0
}

function toPartnerOffers(row: PartnerProductRow): PartnerOfferDto[] {
  const bestBySupplier = new Map<string, PartnerProductRow['product_offers'][number]>()
  for (const offer of row.product_offers) {
    const current = bestBySupplier.get(offer.supplier_code)
    if (!current || compareOffers(offer, current) < 0) {
      bestBySupplier.set(offer.supplier_code, offer)
    }
  }

  return [...bestBySupplier.values()]
    .sort((left, right) => left.supplier.name.localeCompare(right.supplier.name, 'tr'))
    .map((offer) => {
      const price = resolvePartnerPrice({
        sellingPriceExVat: offer.selling_price_try,
        netCostExVat: offer.net_cost_try,
        discountBps: 0
      })
      const hasPrice = price.b2bPriceKurus != null && price.b2bPriceKurus > 0
      // Başbuğ StokGetir ingestion'ı henüz bağlı değil; DB'deki 0 gerçek
      // stok yokluğu değil, bu yüzden miktar veya availability iddiası yapma.
      const hasReliableStock = offer.supplier_code !== 'basbug'
      const stockQty = hasReliableStock ? Math.max(offer.stock_qty, 0) : null
      const availability: PartnerOfferAvailability = !hasReliableStock || !hasPrice
        ? 'UNKNOWN'
        : stockQty! > 0
          ? 'IN_STOCK'
          : 'SUPPLYABLE'

      return {
        supplierDisplayName: offer.supplier.name,
        informationalPriceKurus: price.b2bPriceKurus,
        currency: 'TRY',
        vatRateBps: 2000,
        availability,
        stockQty,
        lastSyncedAt: offer.last_synced_at.toISOString()
      }
    })
}

/** Görünen marka adı — `display_name` varsa o kazanır (vitrinle aynı kural). */
function brandLabel(brand: PartnerProductRow['brand']): string {
  const display = brand.display_name?.trim()
  return display && display.length > 0 ? display : brand.brand
}

/**
 * Fiyat tabanı: kilitli bir override vitrin fiyatını EZER (admin bilerek
 * sabitlemiştir), yoksa rollup'taki en düşük satış fiyatı kullanılır.
 */
function resolveSellingPrice(row: PartnerProductRow): Prisma.Decimal | null {
  const override = row.product_overrides
  if (override?.lock_price && override.selling_price_override != null) {
    return override.selling_price_override
  }
  return row.min_selling_price_try
}

/**
 * Maliyet tabanı: aktif offer'lar arasındaki EN DÜŞÜK net maliyet. En düşüğü
 * seçmek doğru olan — vitrin fiyatı da en ucuz offer'dan türetiliyor
 * (`min_selling_price_try`), taban daha yüksek bir offer'dan alınırsa gerçekte
 * kârlı olan bir satışı zararda sanıp fiyatı şişirirdik.
 */
function resolveNetCost(row: PartnerProductRow): Prisma.Decimal | null {
  let lowest: Prisma.Decimal | null = null
  for (const offer of row.product_offers) {
    if (offer.net_cost_try == null) continue
    if (lowest == null || offer.net_cost_try.lessThan(lowest)) lowest = offer.net_cost_try
  }
  return lowest
}

/** En SON senkron anı — birden çok offer'da en tazesi ürünün tazeliğidir. */
function resolveLastSyncedAt(row: PartnerProductRow): string | null {
  let latest: Date | null = null
  for (const offer of row.product_offers) {
    if (latest == null || offer.last_synced_at > latest) latest = offer.last_synced_at
  }
  return latest ? latest.toISOString() : null
}

export function toPartnerProductDto(
  row: PartnerProductRow,
  options: { discountBps: number; vehicleTypeId?: number | null }
): PartnerProductDto {
  const price: PartnerPriceView = resolvePartnerPrice({
    sellingPriceExVat: resolveSellingPrice(row),
    netCostExVat: resolveNetCost(row),
    discountBps: options.discountBps
  })

  const stockQty = Math.max(row.total_stock_qty, 0)
  const requestedVehicleTypeId = options.vehicleTypeId ?? null
  const matchedVehicleTypeIds = row.product_vehicle_types.map((fitment) => fitment.vehicle_type_id)
  const exactFitmentStatus: PartnerProductDto['exactFitment']['status'] = requestedVehicleTypeId == null
    ? 'NOT_REQUESTED'
    : matchedVehicleTypeIds.includes(requestedVehicleTypeId)
      ? 'CONFIRMED'
      : 'NOT_CONFIRMED'

  return {
    contractVersion: '1.2',
    sourceProductId: row.id.toString(),
    id: row.id.toString(),
    partNo: row.part_no,
    manufacturerPartNumber: { value: row.part_no, normalized: row.part_no_norm },
    name: resolveCatalogName(row.name, row.product_overrides?.name_override),
    brandName: brandLabel(row.brand),
    categoryName: row.category?.name_tr?.trim() || row.category?.name || null,
    oemNumbers: row.product_oems.map((o) => o.code),
    references: row.product_oems.map((o) => ({
      type: 'OEM',
      value: o.code,
      normalized: o.code_norm,
      brand: o.oem_brand.trim() || null
    })),
    exactFitment: {
      requestedVehicleTypeId,
      status: exactFitmentStatus,
      matchedVehicleTypeIds
    },
    imageUrl: row.primary_image_url,
    listPriceKurus: price.listPriceKurus,
    b2bPriceKurus: price.b2bPriceKurus,
    discountBps: price.discountBps,
    vatRateBps: price.vatRateBps,
    currency: price.currency,
    stockQty,
    availability: resolveCatalogAvailability({
      hasPrice: price.b2bPriceKurus != null && price.b2bPriceKurus > 0,
      totalStockQty: stockQty
    }),
    lastSyncedAt: resolveLastSyncedAt(row),
    offers: toPartnerOffers(row)
  }
}
