import { Prisma } from '@prisma/client'

export type PublicPriceSource = 'real' | 'placeholder'

const PLACEHOLDER_MIN_EX_VAT = new Prisma.Decimal(50)
const PLACEHOLDER_MAX_EX_VAT = new Prisma.Decimal(5000)
const PLACEHOLDER_FALLBACK_EX_VAT = new Prisma.Decimal(199)
const PLACEHOLDER_CATEGORY_RATIO = new Prisma.Decimal(0.9)

export const REAL_PRICE_EXISTS_WHERE: Prisma.partsWhereInput = {
  OR: [
    {
      part_admin_overrides: {
        is: {
          lock_price: true,
          selling_price_override: {
            not: null
          }
        }
      }
    },
    {
      part_pricing_inventory: {
        is: {
          computed_selling_price_ex_vat: {
            not: null
          }
        }
      }
    },
    {
      part_pricing_inventory: {
        is: {
          supplier_price: {
            not: null
          }
        }
      }
    },
    {
      price: {
        not: null
      }
    }
  ]
}

export type PriceCarrier = {
  price?: Prisma.Decimal | null
  part_pricing_inventory?: {
    supplier_price?: Prisma.Decimal | null
    computed_selling_price_ex_vat?: Prisma.Decimal | null
    supplier_stock_qty?: number | null
    reserved_stock_qty?: number | null
  } | null
  part_admin_overrides?: {
    lock_price?: boolean | null
    selling_price_override?: Prisma.Decimal | null
  } | null
}

export function decimalToString(
  value: Prisma.Decimal | null | undefined
): string | null {
  return value ? value.toString() : null
}

export function resolveRealPriceExVat(input: PriceCarrier): Prisma.Decimal | null {
  const override = input.part_admin_overrides

  if (override?.lock_price && override.selling_price_override) {
    return override.selling_price_override
  }

  return (
    input.part_pricing_inventory?.computed_selling_price_ex_vat ??
    input.part_pricing_inventory?.supplier_price ??
    input.price ??
    null
  )
}

export function normalizeStockQty(stockQty: number | null | undefined): number {
  if (typeof stockQty !== 'number' || !Number.isFinite(stockQty)) {
    return 0
  }

  return Math.max(0, Math.floor(stockQty))
}

export function normalizeReservedStockQty(
  reservedStockQty: number | null | undefined
): number {
  if (typeof reservedStockQty !== 'number' || !Number.isFinite(reservedStockQty)) {
    return 0
  }

  return Math.max(0, Math.floor(reservedStockQty))
}

export function computeAvailableStock(input: {
  stockQty: number | null | undefined
  reservedStockQty?: number | null | undefined
}): number {
  const stockQty = normalizeStockQty(input.stockQty)
  const reservedStockQty = normalizeReservedStockQty(input.reservedStockQty)
  return Math.max(stockQty - reservedStockQty, 0)
}

export function computePlaceholderPriceExVat(
  categoryMinRealPriceExVat: Prisma.Decimal | null | undefined
): Prisma.Decimal {
  if (!categoryMinRealPriceExVat) {
    return PLACEHOLDER_FALLBACK_EX_VAT
  }

  let candidate = categoryMinRealPriceExVat
    .mul(PLACEHOLDER_CATEGORY_RATIO)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)

  if (candidate.lessThan(PLACEHOLDER_MIN_EX_VAT)) {
    candidate = PLACEHOLDER_MIN_EX_VAT
  }

  if (candidate.greaterThan(PLACEHOLDER_MAX_EX_VAT)) {
    candidate = PLACEHOLDER_MAX_EX_VAT
  }

  return candidate
}

export function resolvePublicPriceAndPurchasability(input: {
  realPriceExVat: Prisma.Decimal | null
  categoryMinRealPriceExVat?: Prisma.Decimal | null
  stockQty?: number | null
  reservedStockQty?: number | null
}) {
  const stockQty = normalizeStockQty(input.stockQty)
  const availableStock = computeAvailableStock({
    stockQty,
    reservedStockQty: input.reservedStockQty
  })
  const hasRealPrice = input.realPriceExVat != null
  const resolvedPriceExVat =
    input.realPriceExVat ??
    computePlaceholderPriceExVat(input.categoryMinRealPriceExVat)
  const priceSource: PublicPriceSource = hasRealPrice ? 'real' : 'placeholder'
  const isPlaceholderPrice = !hasRealPrice
  const isPurchasable = hasRealPrice && availableStock > 0

  return {
    resolvedPriceExVat,
    realPriceExVat: input.realPriceExVat,
    priceSource,
    isPlaceholderPrice,
    stockQty,
    availableStock,
    isPurchasable
  }
}
