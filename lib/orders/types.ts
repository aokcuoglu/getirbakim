import { Prisma } from '@prisma/client'

export const ORDER_STATUS_VALUES = [
  'PENDING_PAYMENT',
  'PAID',
  'PAYMENT_FAILED',
  'PROCESSING',
  'SHIPPED',
  'COMPLETED',
  'CANCELLED',
  'REFUNDED'
] as const

export type OrderStatus = (typeof ORDER_STATUS_VALUES)[number]

export const ORDER_PAYMENT_STATUS_VALUES = [
  'NOT_REQUIRED',
  'PENDING',
  'PAID',
  'FAILED',
  'REFUNDED'
] as const

export type OrderPaymentStatus = (typeof ORDER_PAYMENT_STATUS_VALUES)[number]

export const ORDER_PAYMENT_PROVIDER_VALUES = ['TAMI'] as const
export type OrderPaymentProvider =
  (typeof ORDER_PAYMENT_PROVIDER_VALUES)[number]

export const ORDER_PAYMENT_RECORD_STATUS_VALUES = [
  'INITIATED',
  'PENDING',
  'SUCCEEDED',
  'FAILED',
  'REFUNDED'
] as const

export type OrderPaymentRecordStatus =
  (typeof ORDER_PAYMENT_RECORD_STATUS_VALUES)[number]

export const CHECKOUT_PAYMENT_METHOD_VALUES = [
  'TAMI',
  'CASH_ON_DELIVERY'
] as const

export type CheckoutPaymentMethod =
  (typeof CHECKOUT_PAYMENT_METHOD_VALUES)[number]

export const CHECKOUT_SHIPPING_METHOD_VALUES = ['STANDARD', 'EXPRESS'] as const
export type CheckoutShippingMethod =
  (typeof CHECKOUT_SHIPPING_METHOD_VALUES)[number]

export const ADMIN_OPERATIONAL_ORDER_STATUS_VALUES = [
  'PROCESSING',
  'SHIPPED',
  'COMPLETED',
  'CANCELLED',
  'REFUNDED'
] as const

export type AdminOperationalOrderStatus =
  (typeof ADMIN_OPERATIONAL_ORDER_STATUS_VALUES)[number]

export const DEFAULT_CURRENCY = 'TRY' as const
export const DISPLAY_VAT_RATE = 0.2

const VAT_MULTIPLIER = new Prisma.Decimal(1 + DISPLAY_VAT_RATE)

export interface ShippingAddressInput {
  fullName: string
  phone: string
  line1: string
  line2?: string
  city: string
  postalCode: string
  country: string
}

export interface CheckoutLineInput {
  partId: number
  quantity: number
}

export const SHIPPING_FEE_BY_METHOD: Record<CheckoutShippingMethod, number> = {
  STANDARD: 79.9,
  EXPRESS: 149.9
}

export function toMoneyDecimal(
  value: number | string | Prisma.Decimal
): Prisma.Decimal {
  if (value instanceof Prisma.Decimal) {
    return value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
  }

  return new Prisma.Decimal(value).toDecimalPlaces(
    2,
    Prisma.Decimal.ROUND_HALF_UP
  )
}

export function decimalToNumber(
  value: Prisma.Decimal | number | string | null | undefined
): number {
  if (value == null) return 0
  if (value instanceof Prisma.Decimal) {
    return Number(value.toString())
  }
  return Number(value)
}

export function toVatIncludedDecimal(
  value: Prisma.Decimal | number | string | null | undefined
): Prisma.Decimal | null {
  if (value == null) return null

  const decimal =
    value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value)

  return decimal
    .mul(VAT_MULTIPLIER)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
}

export function getShippingFeeDecimal(
  method: CheckoutShippingMethod
): Prisma.Decimal {
  return toMoneyDecimal(SHIPPING_FEE_BY_METHOD[method])
}

export function formatOrderNumber(orderId: number): string {
  return `GB-${String(orderId).padStart(6, '0')}`
}

export function parseOrderNumber(raw: string): number | null {
  const normalized = raw.trim().toUpperCase()
  if (!normalized) return null

  const digits = normalized.replace(/^GB-/, '').replace(/\D/g, '')
  if (!digits) return null

  const parsed = Number(digits)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

export function canAdminManageOrderStatus(
  status: string
): status is AdminOperationalOrderStatus {
  return (ADMIN_OPERATIONAL_ORDER_STATUS_VALUES as readonly string[]).includes(
    status
  )
}

export function shouldReleaseReservedStock(nextStatus: string): boolean {
  return (
    nextStatus === 'PAYMENT_FAILED' ||
    nextStatus === 'CANCELLED' ||
    nextStatus === 'REFUNDED'
  )
}

export function splitFullName(fullName: string): {
  name: string
  surname: string
} {
  const parts = fullName.trim().split(/\s+/).filter(Boolean)

  if (parts.length === 0) {
    return { name: 'Customer', surname: 'Customer' }
  }

  if (parts.length === 1) {
    return { name: parts[0], surname: 'Customer' }
  }

  return {
    name: parts[0],
    surname: parts.slice(1).join(' ')
  }
}
