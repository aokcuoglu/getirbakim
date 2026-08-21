import 'server-only'
import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import {
  assertOfferFresh, calculateBindingUnitPrice, cancellationOutcome, decodeOfferId,
  fingerprintOrderRequest, PartnerOrderError, resolvePartnerOrderPolicy,
  type PartnerOrderStatus, PARTNER_ORDER_POLICY_ENV
} from './order-contract'
import { buildPartnerOrderEvent, shouldExpirePartnerOrder } from './webhook-contract'

export interface CreatePartnerOrderInput {
  idempotencyKey: string
  selectedOfferId: string
  quantity: number
  expectedUnitNetKurus: number
}

const orderInclude = {
  items: { select: { product_id: true, selected_offer_id: true, quantity: true, unit_net_amount: true, unit_vat_amount: true, unit_gross_amount: true } },
  reservations: { select: { status: true, expires_at: true }, orderBy: { id: 'asc' as const } }
} as const

type PartnerOrderRow = Prisma.partner_ordersGetPayload<{ include: typeof orderInclude }>

function amountToKurus(value: Prisma.Decimal): number { return value.mul(100).toNumber() }

export function toPartnerOrderDto(order: PartnerOrderRow) {
  return {
    contractVersion: '1.0' as const,
    id: order.id,
    status: order.status as PartnerOrderStatus,
    version: order.version,
    bindingPrice: {
      netKurus: amountToKurus(order.binding_net_amount),
      vatKurus: amountToKurus(order.binding_vat_amount),
      grossKurus: amountToKurus(order.binding_gross_amount),
      currency: order.currency,
      policyVersion: order.pricing_policy_version,
      expiresAt: order.binding_expires_at.toISOString()
    },
    items: order.items.map((item) => ({
      sourceProductId: item.product_id.toString(),
      selectedOfferId: `offer_${item.selected_offer_id.toString(36)}`,
      quantity: item.quantity,
      unitNetKurus: amountToKurus(item.unit_net_amount),
      unitVatKurus: amountToKurus(item.unit_vat_amount),
      unitGrossKurus: amountToKurus(item.unit_gross_amount)
    })),
    cancellationRequested: order.cancellation_requested_at != null,
    createdAt: order.created_at.toISOString(),
    updatedAt: order.updated_at.toISOString()
  }
}

async function enqueueOrderEvent(tx: Prisma.TransactionClient, order: PartnerOrderRow) {
  const id = randomUUID()
  const event = buildPartnerOrderEvent({
    eventId: id, occurredAt: order.updated_at, partnerId: order.partner_id,
    order: toPartnerOrderDto(order)
  })
  await tx.partner_order_events.create({
    data: {
      id,
      partner_id: order.partner_id,
      order_id: order.id,
      order_version: order.version,
      event_type: event.eventType,
      contract_version: event.contractVersion,
      raw_body: event.rawBody
    }
  })
}

async function expireLockedOrder(tx: Prisma.TransactionClient, order: PartnerOrderRow) {
  await tx.partner_stock_reservations.updateMany({
    where: { order_id: order.id, status: 'ACTIVE' }, data: { status: 'RELEASED' }
  })
  const expired = await tx.partner_orders.update({
    where: { id: order.id }, data: { status: 'RESERVATION_EXPIRED', version: { increment: 1 } }, include: orderInclude
  })
  await enqueueOrderEvent(tx, expired)
  return expired
}

async function findOwnedOrder(partnerId: string, id: string) {
  return db.partner_orders.findFirst({ where: { id, partner_id: partnerId }, include: orderInclude })
}

export async function getPartnerOrder(partnerId: string, id: string) {
  let order = await findOwnedOrder(partnerId, id)
  if (!order) throw new PartnerOrderError('ORDER_NOT_FOUND', 'Order not found.', 404)
  if (shouldExpirePartnerOrder(order.status, order.binding_expires_at, new Date())) {
    order = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "catalog"."partner_orders" WHERE "id" = ${id}::uuid FOR UPDATE`
      const current = await tx.partner_orders.findFirst({ where: { id, partner_id: partnerId }, include: orderInclude })
      if (!current) throw new PartnerOrderError('ORDER_NOT_FOUND', 'Order not found.', 404)
      if (!shouldExpirePartnerOrder(current.status, current.binding_expires_at, new Date())) return current
      return expireLockedOrder(tx, current)
    })
  }
  return toPartnerOrderDto(order)
}

export async function quotePartnerOffer(selectedOfferId: string, quantity: number) {
  const offerId = decodeOfferId(selectedOfferId)
  if (!offerId) throw new PartnerOrderError('OFFER_UNAVAILABLE', 'Selected offer is unavailable.', 409)
  const policy = resolvePartnerOrderPolicy(process.env[PARTNER_ORDER_POLICY_ENV])
  const now = new Date()
  const offer = await db.product_offers.findFirst({
    where: { id: offerId, is_active: true, product: { status: 'ACTIVE' }, supplier: { is_active: true } },
    select: { currency: true, net_cost_try: true, stock_qty: true, priced_at: true, last_synced_at: true, supplier_code: true }
  })
  if (!offer || offer.supplier_code === 'basbug' || offer.currency !== 'TRY' || offer.net_cost_try == null || offer.priced_at == null) {
    throw new PartnerOrderError('OFFER_UNAVAILABLE', 'Selected offer is unavailable.', 409)
  }
  assertOfferFresh(offer.priced_at, offer.last_synced_at, now, policy.offerMaxAgeSeconds)
  if (offer.stock_qty < quantity) throw new PartnerOrderError('OFFER_UNAVAILABLE', 'Selected offer has insufficient availability.', 409)
  const unit = calculateBindingUnitPrice(offer.net_cost_try, policy)
  const multiplier = new Prisma.Decimal(quantity)
  const freshnessDeadline = offer.priced_at.getTime() + policy.offerMaxAgeSeconds * 1000
  const quoteDeadline = Math.min(freshnessDeadline, now.getTime() + policy.reservationTtlSeconds * 1000)
  return {
    selectedOfferId, quantity,
    bindingNetKurus: amountToKurus(unit.net.mul(multiplier)),
    bindingVatKurus: amountToKurus(unit.vat.mul(multiplier)),
    bindingGrossKurus: amountToKurus(unit.gross.mul(multiplier)),
    unitNetKurus: amountToKurus(unit.net), currency: 'TRY', policyVersion: policy.version,
    expiresAt: new Date(quoteDeadline).toISOString()
  }
}

/** Internal fulfilment boundary. A partner-facing request cannot confirm itself. */
export async function confirmPartnerOrder(partnerId: string, id: string, expectedVersion: number) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "catalog"."partner_orders" WHERE "id" = ${id}::uuid FOR UPDATE`
    const order = await tx.partner_orders.findFirst({ where: { id, partner_id: partnerId }, include: orderInclude })
    if (!order) throw new PartnerOrderError('ORDER_NOT_FOUND', 'Order not found.', 404)
    if (order.status === 'CONFIRMED') return toPartnerOrderDto(order)
    if (order.status !== 'REQUESTED' || order.version !== expectedVersion) {
      throw new PartnerOrderError('INVALID_TRANSITION', 'Order transition is not allowed.', 409)
    }
    const now = new Date()
    const active = await tx.partner_stock_reservations.count({
      where: { order_id: id, status: 'ACTIVE', expires_at: { gt: now } }
    })
    if (active !== order.items.length) {
      return toPartnerOrderDto(await expireLockedOrder(tx, order))
    }
    await tx.partner_stock_reservations.updateMany({ where: { order_id: id, status: 'ACTIVE' }, data: { status: 'COMMITTED' } })
    const updated = await tx.partner_orders.update({
      where: { id }, data: { status: 'CONFIRMED', version: { increment: 1 } }, include: orderInclude
    })
    await enqueueOrderEvent(tx, updated)
    return toPartnerOrderDto(updated)
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
}

export async function createPartnerOrder(partnerId: string, input: CreatePartnerOrderInput, retryCount = 2) {
  const offerId = decodeOfferId(input.selectedOfferId)
  if (!offerId) throw new PartnerOrderError('OFFER_UNAVAILABLE', 'Selected offer is unavailable.', 409)
  const policy = resolvePartnerOrderPolicy(process.env[PARTNER_ORDER_POLICY_ENV])
  const fingerprint = fingerprintOrderRequest({
    selectedOfferId: input.selectedOfferId,
    quantity: input.quantity,
    expectedUnitNetKurus: input.expectedUnitNetKurus
  })

  const replay = await db.partner_orders.findUnique({
    where: { partner_id_idempotency_key: { partner_id: partnerId, idempotency_key: input.idempotencyKey } },
    include: orderInclude
  })
  if (replay) {
    if (replay.request_fingerprint !== fingerprint) {
      throw new PartnerOrderError('IDEMPOTENCY_CONFLICT', 'Idempotency key was used for another request.', 409)
    }
    return { order: await getPartnerOrder(partnerId, replay.id), replayed: true }
  }

  try {
    const order = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "catalog"."product_offers" WHERE "id" = ${offerId} FOR UPDATE`
      const now = new Date()
      const offer = await tx.product_offers.findFirst({
        where: {
          id: offerId, is_active: true, product: { status: 'ACTIVE' },
          supplier: { is_active: true }
        },
        select: {
          id: true, product_id: true, currency: true, net_cost_try: true,
          stock_qty: true, priced_at: true, last_synced_at: true, supplier_code: true
        }
      })
      if (!offer || offer.supplier_code === 'basbug' || offer.currency !== 'TRY' || offer.net_cost_try == null || offer.priced_at == null) {
        throw new PartnerOrderError('OFFER_UNAVAILABLE', 'Selected offer is unavailable.', 409)
      }
      await tx.$queryRaw`SELECT "id" FROM "catalog"."products" WHERE "id" = ${offer.product_id} FOR UPDATE`
      assertOfferFresh(offer.priced_at, offer.last_synced_at, now, policy.offerMaxAgeSeconds)

      const unit = calculateBindingUnitPrice(offer.net_cost_try, policy)
      const actualUnitNetKurus = amountToKurus(unit.net)
      if (actualUnitNetKurus !== input.expectedUnitNetKurus) {
        throw new PartnerOrderError('PRICE_CHANGED', 'Selected offer price changed.', 409, {
          bindingNetKurus: actualUnitNetKurus,
          currency: 'TRY', policyVersion: policy.version
        })
      }

      const reserved = await tx.partner_stock_reservations.aggregate({
        where: { selected_offer_id: offer.id, OR: [{ status: 'COMMITTED' }, { status: 'ACTIVE', expires_at: { gt: now } }] },
        _sum: { quantity: true }
      })
      const consumerReserved = await tx.stock_reservations.aggregate({
        where: { product_id: offer.product_id, status: 'ACTIVE', expires_at: { gt: now } }, _sum: { quantity: true }
      })
      const available = Math.max(offer.stock_qty - (reserved._sum.quantity ?? 0) - (consumerReserved._sum.quantity ?? 0), 0)
      if (available < input.quantity) {
        throw new PartnerOrderError('OFFER_UNAVAILABLE', 'Selected offer has insufficient availability.', 409)
      }

      const expiresAt = new Date(now.getTime() + policy.reservationTtlSeconds * 1000)
      const quantity = new Prisma.Decimal(input.quantity)
      const created = await tx.partner_orders.create({
        data: {
          partner_id: partnerId, idempotency_key: input.idempotencyKey,
          request_fingerprint: fingerprint, status: 'REQUESTED', currency: 'TRY',
          binding_net_amount: unit.net.mul(quantity), binding_vat_amount: unit.vat.mul(quantity),
          binding_gross_amount: unit.gross.mul(quantity), pricing_policy_version: policy.version,
          binding_expires_at: expiresAt,
          items: { create: { product_id: offer.product_id, selected_offer_id: offer.id, quantity: input.quantity, unit_net_amount: unit.net, unit_vat_amount: unit.vat, unit_gross_amount: unit.gross } },
          reservations: { create: { product_id: offer.product_id, selected_offer_id: offer.id, quantity: input.quantity, status: 'ACTIVE', expires_at: expiresAt } }
        },
        include: orderInclude
      })
      await enqueueOrderEvent(tx, created)
      return created
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    return { order: toPartnerOrderDto(order), replayed: false }
  } catch (error) {
    if (error instanceof PartnerOrderError) throw error
    if ((error as { code?: string }).code === 'P2002') {
      const replay = await db.partner_orders.findUnique({
        where: { partner_id_idempotency_key: { partner_id: partnerId, idempotency_key: input.idempotencyKey } }, include: orderInclude
      })
      if (replay?.request_fingerprint === fingerprint) {
        return { order: await getPartnerOrder(partnerId, replay.id), replayed: true }
      }
      throw new PartnerOrderError('IDEMPOTENCY_CONFLICT', 'Idempotency key was used for another request.', 409)
    }
    if ((error as { code?: string }).code === 'P2034' && retryCount > 0) {
      return createPartnerOrder(partnerId, input, retryCount - 1)
    }
    throw error
  }
}

export async function cancelPartnerOrder(partnerId: string, id: string) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "catalog"."partner_orders" WHERE "id" = ${id}::uuid FOR UPDATE`
    const order = await tx.partner_orders.findFirst({ where: { id, partner_id: partnerId }, include: orderInclude })
    if (!order) throw new PartnerOrderError('ORDER_NOT_FOUND', 'Order not found.', 404)
    if (shouldExpirePartnerOrder(order.status, order.binding_expires_at, new Date())) {
      return toPartnerOrderDto(await expireLockedOrder(tx, order))
    }
    const outcome = cancellationOutcome(order.status as PartnerOrderStatus)
    if (outcome === 'NOOP') return toPartnerOrderDto(order)
    if (outcome === 'REQUEST') {
      if (order.cancellation_requested_at) return toPartnerOrderDto(order)
      const updated = await tx.partner_orders.update({
        where: { id }, data: { cancellation_requested_at: new Date(), version: { increment: 1 } }, include: orderInclude
      })
      await enqueueOrderEvent(tx, updated)
      return toPartnerOrderDto(updated)
    }
    await tx.partner_stock_reservations.updateMany({ where: { order_id: id, status: 'ACTIVE' }, data: { status: 'RELEASED' } })
    const updated = await tx.partner_orders.update({ where: { id }, data: { status: 'CANCELLED', version: { increment: 1 } }, include: orderInclude })
    await enqueueOrderEvent(tx, updated)
    return toPartnerOrderDto(updated)
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
}

/** Bounded operations sweep; each candidate is rechecked under its order lock. */
export async function expirePartnerOrders(limit = 100): Promise<number> {
  const candidates = await db.partner_orders.findMany({
    where: { status: 'REQUESTED', binding_expires_at: { lte: new Date() } },
    select: { id: true, partner_id: true }, orderBy: { binding_expires_at: 'asc' }, take: limit
  })
  let expiredCount = 0
  for (const candidate of candidates) {
    const expired = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "catalog"."partner_orders" WHERE "id" = ${candidate.id}::uuid FOR UPDATE`
      const current = await tx.partner_orders.findFirst({
        where: { id: candidate.id, partner_id: candidate.partner_id }, include: orderInclude
      })
      if (!current || !shouldExpirePartnerOrder(current.status, current.binding_expires_at, new Date())) return false
      await expireLockedOrder(tx, current)
      return true
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    if (expired) expiredCount += 1
  }
  return expiredCount
}
