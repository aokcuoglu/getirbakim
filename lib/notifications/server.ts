import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'
import type { CartReconcileEvent, NotificationEventType } from '@/lib/notifications/types'

export async function createUserNotifications(
  userId: string,
  items: Array<{
    type: NotificationEventType
    title: string
    message: string
    payload?: Record<string, unknown> | null
  }>
): Promise<void> {
  if (!userId || items.length === 0) return

  await db.notifications.createMany({
    data: items.map((item) => ({
      user_id: userId,
      type: item.type,
      title: item.title,
      message: item.message,
      payload:
        item.payload == null
          ? Prisma.JsonNull
          : (item.payload as Prisma.InputJsonValue)
    }))
  })
}

export async function createCartEventNotifications(
  userId: string,
  events: CartReconcileEvent[]
): Promise<void> {
  if (!userId || events.length === 0) return

  await createUserNotifications(
    userId,
    events.map((event) => ({
      type: event.type,
      title:
        event.type === 'CART_PRICE_CHANGED'
          ? 'Sepet fiyatı güncellendi'
          : event.type === 'CART_STOCK_REDUCED'
            ? 'Sepet adedi güncellendi'
            : 'Sepet kalemi kaldırıldı',
      message: event.message,
      payload: {
        partId: event.partId,
        oldPrice: event.oldPrice,
        newPrice: event.newPrice,
        oldQuantity: event.oldQuantity,
        newQuantity: event.newQuantity,
        reason: event.reason
      }
    }))
  )
}

export async function createOrderStatusNotification(input: {
  userId: string | null
  orderId: number
  previousStatus: string
  nextStatus: string
}): Promise<void> {
  if (!input.userId) return

  await createUserNotifications(input.userId, [
    {
      type: 'ORDER_STATUS_CHANGED',
      title: `Sipariş #${input.orderId} durumu güncellendi`,
      message: `${input.previousStatus} -> ${input.nextStatus}`,
      payload: {
        orderId: input.orderId,
        previousStatus: input.previousStatus,
        nextStatus: input.nextStatus
      }
    }
  ])
}
