import { cn } from '@/lib/utils'
import type { AdminOrderStatus } from '@/lib/types/admin-orders'

type OrderStatusBadgeProps = {
  status: AdminOrderStatus | string
  className?: string
}

export const ORDER_STATUS_LABELS: Record<string, string> = {
  PENDING_PAYMENT: 'Ödeme Bekliyor',
  PAID: 'Ödendi',
  PAYMENT_FAILED: 'Ödeme Başarısız',
  PROCESSING: 'İşleniyor',
  SHIPPED: 'Kargoda',
  COMPLETED: 'Tamamlandı',
  CANCELLED: 'İptal Edildi',
  REFUNDED: 'İade Edildi'
}

export function OrderStatusBadge({ status, className }: OrderStatusBadgeProps) {
  const tone = getStatusTone(status)
  const label = ORDER_STATUS_LABELS[status] || status

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-sm border px-2 py-0.5 text-[11px] font-medium',
        tone,
        className
      )}
    >
      {label}
    </span>
  )
}

function getStatusTone(status: string): string {
  switch (status) {
    case 'COMPLETED':
      return 'border-green-500/30 bg-green-50 text-green-700'
    case 'PAID':
      return 'border-green-500/30 bg-green-50 text-green-700'
    case 'PENDING_PAYMENT':
      return 'border-amber-500/30 bg-amber-50 text-amber-700'
    case 'PROCESSING':
      return 'border-blue-500/30 bg-blue-50 text-blue-700'
    case 'SHIPPED':
      return 'border-indigo-500/30 bg-indigo-50 text-indigo-700'
    case 'CANCELLED':
      return 'border-gray-500/30 bg-gray-50 text-gray-700'
    case 'REFUNDED':
      return 'border-gray-500/30 bg-gray-50 text-gray-700'
    case 'PAYMENT_FAILED':
      return 'border-red-500/30 bg-red-50 text-red-700'
    default:
      return 'border-border bg-secondary text-secondary-foreground'
  }
}
