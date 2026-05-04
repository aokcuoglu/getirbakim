import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import {
  createPaymentRecord,
  getLatestPaymentForOrder,
  markOrderPaymentFailed,
  markOrderPaymentPending,
  markOrderPaymentSucceeded
} from '@/lib/orders/service'
import { decimalToNumber, formatOrderNumber, splitFullName } from '@/lib/orders/types'
import {
  authorizeDirectPayment,
  queryPaymentByOrderId,
  TamiRequestError,
  type TamiDirectAuthPayload,
  type TamiDirectAuthResponse,
  type TamiQueryResponse
} from '@/lib/payments/tami'
import { resolveSiteUrl } from '@/lib/site-url'

export function buildCheckoutResultUrl(input: {
  locale: string
  orderId: number
  state: 'success' | 'failure' | 'cod' | 'pending_verification'
  error?: string
  baseUrl?: string
}) {
  const url = new URL(`/${input.locale}/checkout/result`, input.baseUrl || resolveSiteUrl())
  url.searchParams.set('orderId', String(input.orderId))
  url.searchParams.set('state', input.state)
  if (input.error) {
    url.searchParams.set('error', input.error)
  }
  return url.toString()
}

function normalizeMobilePhoneNumber(phone: string): string {
  const digits = phone.replace(/\D/g, '')

  if (digits.length === 10) {
    return `0${digits}`
  }

  if (digits.length === 11 && digits.startsWith('0')) {
    return digits
  }

  if (digits.length === 12 && digits.startsWith('90')) {
    return `0${digits.slice(2)}`
  }

  if (digits.length === 13 && digits.startsWith('090')) {
    return `0${digits.slice(3)}`
  }

  return digits
}

export type TamiCheckoutCardInput = {
  holderName: string
  number: string
  cvv: string
  expireMonth: number
  expireYear: number
  installmentCount: number
}

type TamiCheckoutResult = {
  paymentId: number
  redirectUrl: string
  providerOrderId: string
  state: 'success' | 'failure' | 'pending_verification'
  message?: string
}

type StoredShippingAddress = {
  fullName: string
  phone: string
  line1: string
  line2?: string
  city: string
  postalCode: string
  country: string
}

function normalizeTamiLocale(locale: string): 'tr' | 'en' {
  return locale === 'en' ? 'en' : 'tr'
}

function buildTamiFailureMessage(input: {
  errorMessage?: string | null
  errorCode?: string | null
  fallback: string
}): string {
  const base = input.errorMessage?.trim() || input.fallback
  return input.errorCode ? `${base} (TAMI errorCode: ${input.errorCode})` : base
}

function classifyDirectAuthResult(result: TamiDirectAuthResponse): {
  state: 'success' | 'failure' | 'pending_verification'
  message?: string
  providerPaymentId?: string | null
} {
  if (!result.success) {
    return {
      state: 'failure',
      message: buildTamiFailureMessage({
        errorMessage: result.errorMessage,
        errorCode: result.errorCode,
        fallback: 'Odeme islemi basarisiz.'
      })
    }
  }

  if (!result.securityHashValid) {
    return {
      state: 'pending_verification',
      message: 'Odeme yaniti imza dogrulamasindan gecemedi.'
    }
  }

  const paymentStatus = String(result.paymentStatus || '').toUpperCase()
  const transactionStatus = String(result.transactionStatus || '').toUpperCase()

  if (
    ['FAIL', 'FAILED', 'ERROR', 'DECLINED'].includes(paymentStatus) ||
    ['FAIL', 'FAILED', 'ERROR', 'DECLINED'].includes(transactionStatus)
  ) {
    return {
      state: 'failure',
      message: buildTamiFailureMessage({
        errorMessage: result.errorMessage,
        errorCode: result.errorCode,
        fallback: 'Odeme islemi basarisiz.'
      })
    }
  }

  return {
    state: 'success',
    providerPaymentId: result.bankReferenceNumber || result.bankAuthCode || null
  }
}

function buildTamiAddress(
  shippingAddress: StoredShippingAddress,
  emailAddress: string,
  phoneNumber: string
): TamiDirectAuthPayload['billingAddress'] {
  return {
    address: [shippingAddress.line1, shippingAddress.line2].filter(Boolean).join(' '),
    city: shippingAddress.city,
    country: shippingAddress.country,
    contactName: shippingAddress.fullName,
    phoneNumber,
    zipCode: shippingAddress.postalCode,
    emailAddress,
    district: shippingAddress.city
  }
}

function buildTamiBasketItems(
  items: Array<{
    id: number
    part_id: bigint
    quantity: number
    price: Prisma.Decimal
    parts: {
      name: string
      part_categories: {
        name: string
      } | null
    } | null
  }>,
  shippingFee: Prisma.Decimal | number | string
): TamiDirectAuthPayload['basket']['basketItems'] {
  const basketItems = items.map((item) => ({
    itemId: String(item.part_id),
    name: item.parts?.name || `Parca ${item.part_id.toString()}`,
    itemType: 'PHYSICAL' as const,
    numberOfProducts: item.quantity,
    totalPrice: decimalToNumber(
      item.price.mul(item.quantity).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
    ),
    unitPrice: decimalToNumber(item.price),
    category: item.parts?.part_categories?.name || undefined
  }))

  const shippingAmount = decimalToNumber(shippingFee)
  if (shippingAmount > 0) {
    basketItems.push({
      itemId: 'shipping',
      name: 'Kargo',
      itemType: 'PHYSICAL' as const,
      numberOfProducts: 1,
      totalPrice: shippingAmount,
      unitPrice: shippingAmount,
      category: 'Shipping'
    })
  }

  return basketItems
}

function classifyTamiQueryResult(result: TamiQueryResponse): {
  state: 'success' | 'failure' | 'pending_verification'
  message?: string
  providerPaymentId?: string | null
} {
  if (!result.success) {
    return {
      state: 'pending_verification',
      message: 'Odeme sonucu dogrulanamadi. Lutfen biraz sonra tekrar kontrol edin.'
    }
  }

  if (!result.securityHashValid) {
    return {
      state: 'pending_verification',
      message: 'Odeme yaniti imza dogrulamasindan gecemedi.'
    }
  }

  const orderStatus = String(result.orderStatus || '').toUpperCase()
  const paymentStatus = String(result.paymentStatus || '').toUpperCase()
  const transactionStatus = String(result.transactionStatus || '').toUpperCase()

  if (
    orderStatus === 'AUTH' ||
    (paymentStatus === 'SUCCESS' && transactionStatus === 'SUCCESS')
  ) {
    return {
      state: 'success',
      providerPaymentId: result.bankReferenceNumber || result.bankAuthCode || null
    }
  }

  if (
    ['REVERSE', 'REFUND', 'PARTIAL_REFUND', 'CHARGEBACK'].includes(orderStatus) ||
    ['FAIL', 'FAILED', 'ERROR', 'DECLINED'].includes(paymentStatus) ||
    ['FAIL', 'FAILED', 'ERROR', 'DECLINED'].includes(transactionStatus)
  ) {
    return {
      state: 'failure',
      message: 'Odeme islemi basarisiz veya geri alinmis gorunuyor.'
    }
  }

  return {
    state: 'pending_verification',
    message: 'Odeme sonucu hala dogrulaniyor.'
  }
}

export async function initializeTamiPaymentForOrder(input: {
  orderId: number
  locale: string
  card: TamiCheckoutCardInput
  clientIp?: string | null
  baseUrl?: string
}): Promise<TamiCheckoutResult> {
  const order = await db.orders.findUnique({
    where: { id: input.orderId },
    include: {
      users: {
        select: {
          email: true
        }
      },
      order_items: {
        select: {
          id: true,
          part_id: true,
          quantity: true,
          price: true,
          parts: {
            select: {
              name: true,
              part_categories: {
                select: {
                  name: true
                }
              }
            }
          }
        }
      }
    }
  })

  if (!order) {
    throw new Error('ORDER_NOT_FOUND')
  }

  if (order.payment_method !== 'TAMI') {
    throw new Error('ORDER_PAYMENT_METHOD_INVALID')
  }

  if (!order.shipping_address_json) {
    throw new Error('ORDER_SHIPPING_ADDRESS_MISSING')
  }

  const shippingAddress = order.shipping_address_json as StoredShippingAddress

  const mobilePhoneNumber = normalizeMobilePhoneNumber(shippingAddress.phone || '')
  if (!mobilePhoneNumber) {
    throw new Error('ORDER_PHONE_MISSING')
  }

  const emailAddress = order.users?.email || order.guest_email || ''
  if (!emailAddress) {
    throw new Error('ORDER_EMAIL_MISSING')
  }

  if (order.order_items.length === 0) {
    throw new Error('ORDER_ITEMS_MISSING')
  }

  const providerOrderId = formatOrderNumber(order.id)

  const paymentRecord = await createPaymentRecord({
    orderId: order.id,
    provider: 'TAMI',
    providerConversationId: providerOrderId,
    status: 'INITIATED',
    amount: order.total_amount
  })

  const { name, surname } = splitFullName(shippingAddress.fullName)
  const now = new Date().toISOString()
  const payload: TamiDirectAuthPayload = {
    amount: decimalToNumber(order.total_amount),
    orderId: providerOrderId,
    currency: 'TRY',
    installmentCount: input.card.installmentCount,
    paymentGroup: 'PRODUCT',
    paymentChannel: 'WEB',
    motoInd: false,
    card: {
      holderName: input.card.holderName,
      cvv: input.card.cvv,
      expireMonth: input.card.expireMonth,
      expireYear: input.card.expireYear,
      number: input.card.number
    },
    billingAddress: buildTamiAddress(shippingAddress, emailAddress, mobilePhoneNumber),
    shippingAddress: buildTamiAddress(shippingAddress, emailAddress, mobilePhoneNumber),
    buyer: {
      ipAddress: input.clientIp?.trim() || '127.0.0.1',
      buyerId: order.user_id || `guest-${order.id}`,
      name,
      surName: surname,
      city: shippingAddress.city,
      country: shippingAddress.country,
      emailAddress,
      phoneNumber: mobilePhoneNumber,
      registrationAddress: [shippingAddress.line1, shippingAddress.line2]
        .filter(Boolean)
        .join(' '),
      registrationDate: now,
      lastLoginDate: now,
      zipCode: shippingAddress.postalCode
    },
    basket: {
      basketId: providerOrderId,
      basketItems: buildTamiBasketItems(order.order_items, order.shipping_fee)
    }
  }

  let authResult: TamiDirectAuthResponse

  try {
    authResult = await authorizeDirectPayment({
      payload,
      locale: normalizeTamiLocale(input.locale)
    })
  } catch (error) {
    const tamiError = error instanceof TamiRequestError ? error : null
    const isExplicitProviderFailure =
      tamiError &&
      (typeof tamiError.payload.errorCode === 'string' ||
        typeof tamiError.payload.errorCode === 'number' ||
        typeof tamiError.payload.errorMessage === 'string')

    const providerMessage = tamiError
      ? buildTamiFailureMessage({
          errorMessage:
            typeof tamiError.payload.errorMessage === 'string'
              ? tamiError.payload.errorMessage
              : typeof tamiError.payload.message === 'string'
                ? tamiError.payload.message
                : tamiError.message,
          errorCode:
            typeof tamiError.payload.errorCode === 'number'
              ? String(tamiError.payload.errorCode)
              : typeof tamiError.payload.errorCode === 'string'
                ? tamiError.payload.errorCode
                : null,
          fallback: 'Odeme istegi basarisiz oldu.'
        })
      : error instanceof Error
        ? error.message
        : 'Odeme istegi basarisiz oldu.'

    if (isExplicitProviderFailure) {
      await markOrderPaymentFailed({
        orderId: order.id,
        paymentId: paymentRecord.id,
        failureReason: providerMessage,
        rawPayload: (tamiError?.payload || {
          error: providerMessage
        }) as Prisma.InputJsonValue
      })

      return {
        paymentId: paymentRecord.id,
        providerOrderId,
        state: 'failure',
        message: providerMessage,
        redirectUrl: buildCheckoutResultUrl({
          locale: input.locale,
          orderId: order.id,
          state: 'failure',
          error: providerMessage,
          baseUrl: input.baseUrl
        })
      }
    }

    const pendingMessage =
      error instanceof Error
        ? error.message
        : 'Odeme sonucu dogrulanamadi. Lutfen biraz sonra tekrar kontrol edin.'

    await markOrderPaymentPending({
      orderId: order.id,
      paymentId: paymentRecord.id,
      message: pendingMessage,
      rawPayload: (tamiError?.payload || {
        error: pendingMessage
      }) as Prisma.InputJsonValue
    })

    return {
      paymentId: paymentRecord.id,
      providerOrderId,
      state: 'pending_verification',
      message: pendingMessage,
      redirectUrl: buildCheckoutResultUrl({
        locale: input.locale,
        orderId: order.id,
        state: 'pending_verification',
        error: pendingMessage,
        baseUrl: input.baseUrl
      })
    }
  }

  const classified = classifyDirectAuthResult(authResult)
  const expectedTotal = decimalToNumber(order.total_amount)
  const amountMismatch =
    Number.isFinite(authResult.amount) && Math.abs(authResult.amount - expectedTotal) > 0.01

  if (classified.state === 'success' && !amountMismatch) {
    await markOrderPaymentSucceeded({
      orderId: order.id,
      paymentId: paymentRecord.id,
      providerPaymentId: classified.providerPaymentId,
      rawPayload: authResult.raw as Prisma.InputJsonValue
    })

    return {
      paymentId: paymentRecord.id,
      providerOrderId,
      state: 'success',
      redirectUrl: buildCheckoutResultUrl({
        locale: input.locale,
        orderId: order.id,
        state: 'success',
        baseUrl: input.baseUrl
      })
    }
  }

  if (classified.state === 'failure' || amountMismatch) {
    const message = amountMismatch
      ? 'Odeme tutari dogrulanamadi.'
      : classified.message || 'Odeme islemi basarisiz.'

    await markOrderPaymentFailed({
      orderId: order.id,
      paymentId: paymentRecord.id,
      failureReason: message,
      rawPayload: authResult.raw as Prisma.InputJsonValue
    })

    return {
      paymentId: paymentRecord.id,
      providerOrderId,
      state: 'failure',
      message,
      redirectUrl: buildCheckoutResultUrl({
        locale: input.locale,
        orderId: order.id,
        state: 'failure',
        error: message,
        baseUrl: input.baseUrl
      })
    }
  }

  const pendingMessage = classified.message || 'Odeme sonucu hala dogrulaniyor.'
  await markOrderPaymentPending({
    orderId: order.id,
    paymentId: paymentRecord.id,
    message: pendingMessage,
    rawPayload: authResult.raw as Prisma.InputJsonValue
  })

  return {
    paymentId: paymentRecord.id,
    providerOrderId,
    state: 'pending_verification',
    message: pendingMessage,
    redirectUrl: buildCheckoutResultUrl({
      locale: input.locale,
      orderId: order.id,
      state: 'pending_verification',
      error: pendingMessage,
      baseUrl: input.baseUrl
    })
  }
}

export async function finalizeTamiPaymentFromCallback(input: {
  orderId: number
  locale: string
  baseUrl?: string
}): Promise<{
  orderId: number
  success: boolean
  redirectUrl: string
  state: 'success' | 'failure' | 'pending_verification'
  message?: string
}> {
  const payment = await getLatestPaymentForOrder(input.orderId)
  const order = await db.orders.findUnique({
    where: { id: input.orderId },
    select: {
      id: true,
      total_amount: true,
      payment_method: true
    }
  })

  if (!order) {
    throw new Error('ORDER_NOT_FOUND')
  }

  if (order.payment_method !== 'TAMI') {
    throw new Error('ORDER_PAYMENT_METHOD_INVALID')
  }

  let queryResult: TamiQueryResponse
  try {
    queryResult = await queryPaymentByOrderId({
      orderId: formatOrderNumber(order.id),
      locale: input.locale === 'en' ? 'en' : 'tr',
      isTransactionDetail: true
    })
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Odeme sonucu gecici olarak dogrulanamadi.'

    await markOrderPaymentPending({
      orderId: order.id,
      paymentId: payment.id,
      message,
      rawPayload: {
        error: message
      } as Prisma.InputJsonValue
    })

    return {
      orderId: order.id,
      success: false,
      state: 'pending_verification',
      message,
      redirectUrl: buildCheckoutResultUrl({
        locale: input.locale,
        orderId: order.id,
        state: 'pending_verification',
        error: message,
        baseUrl: input.baseUrl
      })
    }
  }

  const classified = classifyTamiQueryResult(queryResult)
  const expectedTotal = decimalToNumber(order.total_amount)
  const amountMismatch =
    Number.isFinite(queryResult.amount) && Math.abs(queryResult.amount - expectedTotal) > 0.01

  if (classified.state === 'success' && !amountMismatch) {
    await markOrderPaymentSucceeded({
      orderId: order.id,
      paymentId: payment.id,
      providerPaymentId: classified.providerPaymentId,
      rawPayload: queryResult.raw as Prisma.InputJsonValue
    })

    return {
      orderId: order.id,
      success: true,
      state: 'success',
      redirectUrl: buildCheckoutResultUrl({
        locale: input.locale,
        orderId: order.id,
        state: 'success',
        baseUrl: input.baseUrl
      })
    }
  }

  if (classified.state === 'failure' || amountMismatch) {
    const message = amountMismatch
      ? 'Odeme tutari dogrulanamadi.'
      : classified.message || 'Odeme islemi basarisiz.'

    await markOrderPaymentFailed({
      orderId: order.id,
      paymentId: payment.id,
      failureReason: message,
      rawPayload: queryResult.raw as Prisma.InputJsonValue
    })

    return {
      orderId: order.id,
      success: false,
      state: 'failure',
      message,
      redirectUrl: buildCheckoutResultUrl({
        locale: input.locale,
        orderId: order.id,
        state: 'failure',
        error: message,
        baseUrl: input.baseUrl
      })
    }
  }

  const pendingMessage = classified.message || 'Odeme sonucu hala dogrulaniyor.'
  await markOrderPaymentPending({
    orderId: order.id,
    paymentId: payment.id,
    message: pendingMessage,
    rawPayload: queryResult.raw as Prisma.InputJsonValue
  })

  return {
    orderId: order.id,
    success: false,
    state: 'pending_verification',
    message: pendingMessage,
    redirectUrl: buildCheckoutResultUrl({
      locale: input.locale,
      orderId: order.id,
      state: 'pending_verification',
      error: pendingMessage,
      baseUrl: input.baseUrl
    })
  }
}

export function buildCodResultUrl(locale: string, orderId: number, baseUrl?: string): string {
  return buildCheckoutResultUrl({
    locale,
    orderId,
    state: 'cod',
    baseUrl
  })
}

export function formatCheckoutPaymentTitle(method: string | null): string {
  if (method === 'TAMI') return 'Tami'
  if (method === 'CASH_ON_DELIVERY') return 'Cash on Delivery'
  return method || '-'
}

export function buildGuestLookupHint(orderId: number): string {
  return `Siparisinizi ${formatOrderNumber(orderId)} numarasiyla sorgulayabilirsiniz.`
}
