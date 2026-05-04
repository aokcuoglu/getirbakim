import { Prisma } from '@prisma/client'

export type PricingRoundingMode = 'HALF_UP_2'
export type PricingVatMode = 'EXCLUDED'

export interface PricingPolicy {
  standardDiscountRate: number
  marginRate: number
  fixedFee: number
  rounding: PricingRoundingMode
  vatMode: PricingVatMode
}

export interface CalculateSellingPriceInput {
  supplierPrice: number | Prisma.Decimal | null | undefined
  campaignRate?: number | null
  overridePrice?: number | Prisma.Decimal | null
  lockPrice?: boolean
  policy?: Partial<PricingPolicy> | null
}

export interface CalculateSellingPriceResult {
  supplierPrice: number | null
  standardDiscountRate: number
  campaignRate: number
  marginRate: number
  fixedFee: number
  netCostExVat: number | null
  sellingExVat: number | null
  usedOverride: boolean
  rounding: PricingRoundingMode
  vatMode: PricingVatMode
}

export const DEFAULT_PRICING_POLICY: PricingPolicy = {
  standardDiscountRate: 0,
  marginRate: 0,
  fixedFee: 0,
  rounding: 'HALF_UP_2',
  vatMode: 'EXCLUDED'
}

function asFiniteNumber(value: unknown): number | null {
  if (value == null) return null
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }
  if (value instanceof Prisma.Decimal) {
    const num = Number(value.toString())
    return Number.isFinite(num) ? num : null
  }
  if (typeof value === 'string') {
    const cleaned = value.replace('%', '').trim()
    const parsed = Number(cleaned)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

export function normalizeRate(rate: unknown, fallback = 0): number {
  const numeric = asFiniteNumber(rate)
  if (numeric == null) return fallback

  const maybePercent = numeric > 1 ? numeric / 100 : numeric
  if (!Number.isFinite(maybePercent)) return fallback

  if (maybePercent < 0) return 0
  if (maybePercent > 1) return 1

  return maybePercent
}

export function roundHalfUp(value: number, decimals = 2): number {
  if (!Number.isFinite(value)) return 0
  const factor = 10 ** decimals
  const shifted = value * factor
  const rounded =
    shifted >= 0
      ? Math.floor(shifted + Number.EPSILON + 0.5)
      : Math.ceil(shifted - Number.EPSILON - 0.5)
  return rounded / factor
}

export function resolvePricingPolicy(config: unknown): PricingPolicy {
  const input =
    config && typeof config === 'object' ? (config as Record<string, unknown>) : {}

  return {
    standardDiscountRate: normalizeRate(
      input.standardDiscountRate,
      DEFAULT_PRICING_POLICY.standardDiscountRate
    ),
    marginRate: normalizeRate(input.marginRate, DEFAULT_PRICING_POLICY.marginRate),
    fixedFee: Math.max(0, asFiniteNumber(input.fixedFee) ?? DEFAULT_PRICING_POLICY.fixedFee),
    rounding:
      input.rounding === 'HALF_UP_2'
        ? 'HALF_UP_2'
        : DEFAULT_PRICING_POLICY.rounding,
    vatMode:
      input.vatMode === 'EXCLUDED'
        ? 'EXCLUDED'
        : DEFAULT_PRICING_POLICY.vatMode
  }
}

export function resolvePricingPolicyFromProviderConfig(config: unknown): PricingPolicy {
  if (!config || typeof config !== 'object') {
    return DEFAULT_PRICING_POLICY
  }

  const objectConfig = config as Record<string, unknown>
  const pricingConfig =
    objectConfig.pricing && typeof objectConfig.pricing === 'object'
      ? objectConfig.pricing
      : null

  return resolvePricingPolicy(pricingConfig)
}

export function calculateSellingPrice(
  input: CalculateSellingPriceInput
): CalculateSellingPriceResult {
  const supplierPrice = asFiniteNumber(input.supplierPrice)
  const overridePrice = asFiniteNumber(input.overridePrice)
  const lockPrice = Boolean(input.lockPrice)
  const policy = resolvePricingPolicy(input.policy)

  if (lockPrice && overridePrice != null) {
    return {
      supplierPrice,
      standardDiscountRate: policy.standardDiscountRate,
      campaignRate: normalizeRate(input.campaignRate, 0),
      marginRate: policy.marginRate,
      fixedFee: policy.fixedFee,
      netCostExVat: supplierPrice,
      sellingExVat: roundHalfUp(Math.max(0, overridePrice), 2),
      usedOverride: true,
      rounding: policy.rounding,
      vatMode: policy.vatMode
    }
  }

  if (supplierPrice == null || supplierPrice < 0) {
    return {
      supplierPrice: null,
      standardDiscountRate: policy.standardDiscountRate,
      campaignRate: normalizeRate(input.campaignRate, 0),
      marginRate: policy.marginRate,
      fixedFee: policy.fixedFee,
      netCostExVat: null,
      sellingExVat: null,
      usedOverride: false,
      rounding: policy.rounding,
      vatMode: policy.vatMode
    }
  }

  const campaignRate = normalizeRate(input.campaignRate, 0)
  const discountedCost =
    supplierPrice *
    (1 - policy.standardDiscountRate) *
    (1 - campaignRate)

  const netCostExVat = roundHalfUp(Math.max(0, discountedCost), 2)
  const sellingExVat = roundHalfUp(
    Math.max(0, netCostExVat * (1 + policy.marginRate) + policy.fixedFee),
    2
  )

  return {
    supplierPrice,
    standardDiscountRate: policy.standardDiscountRate,
    campaignRate,
    marginRate: policy.marginRate,
    fixedFee: policy.fixedFee,
    netCostExVat,
    sellingExVat,
    usedOverride: false,
    rounding: policy.rounding,
    vatMode: policy.vatMode
  }
}
