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
      header: 'Sipariş No',
      cell: ({ row }) => (
        <span className="text-sm font-semibold">{row.original.orderNumber}</span>
      ),
    },
    {
      id: 'customer',
      accessorFn: (row) => row.customerName,
      header: 'Müşteri',
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
      header: 'Tutar',
      cell: ({ row }) => (
        <span className="text-sm font-semibold">
          {formatCurrency(row.original.totalAmount, 'TRY')}
        </span>
      ),
    },
    {
      accessorKey: 'status',
      header: 'Durum',
      cell: ({ row }) => <OrderStatusBadge status={row.original.status} />,
    },
    {
      id: 'payment',
      accessorFn: (row) => row.paymentStatus,
      header: 'Ödeme',
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
      header: 'Tarih',
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
      header: 'İşlem',
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
