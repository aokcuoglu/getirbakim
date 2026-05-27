'use client'

import { ColumnDef } from '@tanstack/react-table'
import { OrderStatusBadge } from '@/components/admin/orders/order-status-badge'
import { AdminRowActions } from '@/components/admin/data-table/admin-row-actions'
import { formatCurrency } from '@/lib/utils'
import type { AdminOrderListItem } from '@/lib/types/admin-orders'

export interface OrderColumnHandlers {
  onDetails?: (id: number) => void
}

export function createOrderColumns(
  handlers: OrderColumnHandlers
): ColumnDef<AdminOrderListItem, unknown>[] {
  return [
    {
      accessorKey: 'orderNumber',
      header: () => <span className="text-xs font-medium">Sipariş No</span>,
      cell: ({ row }) => (
        <span className="text-sm font-semibold">{row.original.orderNumber}</span>
      ),
    },
    {
      id: 'customer',
      accessorFn: (row) => row.customerName,
      header: () => <span className="text-xs font-medium">Müşteri</span>,
      cell: ({ row }) => (
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{row.original.customerName}</p>
          {row.original.customerEmail && (
            <p className="text-xs text-muted-foreground">{row.original.customerEmail}</p>
          )}
        </div>
      ),
    },
    {
      accessorKey: 'totalAmount',
      header: () => <span className="text-xs font-medium">Tutar</span>,
      cell: ({ row }) => (
        <span className="text-sm font-semibold">
          {formatCurrency(row.original.totalAmount, 'TRY')}
        </span>
      ),
    },
    {
      accessorKey: 'status',
      header: () => <span className="text-xs font-medium">Durum</span>,
      cell: ({ row }) => <OrderStatusBadge status={row.original.status} />,
    },
    {
      id: 'payment',
      accessorFn: (row) => row.paymentStatus,
      header: () => <span className="text-xs font-medium">Ödeme</span>,
      cell: ({ row }) => (
        <div>
          <p className="text-sm">{row.original.paymentStatus}</p>
          {row.original.paymentMethod && (
            <p className="text-xs text-muted-foreground">{row.original.paymentMethod}</p>
          )}
        </div>
      ),
    },
    {
      accessorKey: 'createdAt',
      header: () => <span className="text-xs font-medium">Tarih</span>,
      cell: ({ row }) => (
        <span className="text-sm">
          {new Date(row.original.createdAt).toLocaleDateString('tr-TR', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          })}
        </span>
      ),
    },
    {
      id: 'actions',
      header: () => (
        <span className="text-xs font-medium text-right w-full block pr-2">İşlem</span>
      ),
      cell: ({ row }) => (
        <div className="flex justify-end">
          <AdminRowActions
            srLabel={`Sipariş ${row.original.orderNumber} işlemleri`}
            actions={[
              {
                label: 'Detay',
                onClick: () => handlers.onDetails?.(row.original.id),
              },
              {
                label: 'Düzenle',
                separatorBefore: true,
              },
              {
                label: 'Fatura yazdır',
              },
              {
                label: 'İptal et',
                destructive: true,
                separatorBefore: true,
              },
            ]}
          />
        </div>
      ),
    },
  ]
}
