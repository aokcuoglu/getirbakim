'use client'

import { AdminRowActions } from '@/components/admin/data-table/admin-row-actions'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'
import { AdminTableHead, adminTableHeaderRowClassName } from '@/components/admin/data-table/admin-table-head'
import type { MockOrderRow } from '@/app/[locale]/admin/orders/_data/mock-orders'
import { OrderReferenceStatusBadge } from './order-reference-status-badge'

function ProductThumbnail({ name }: { name: string }) {
  const initial = name.charAt(0).toUpperCase()
  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-sm font-semibold text-muted-foreground">
      {initial}
    </div>
  )
}

function CustomerAvatar({ name }: { name: string }) {
  const initials = name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-[11px] font-semibold text-foreground">
      {initials}
    </div>
  )
}

function formatAmount(amount: number, currency: string) {
  return amount.toLocaleString('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2
  })
}

interface OrdersTableProps {
  orders: MockOrderRow[]
  onDetails?: (orderId: string) => void
}

export function OrdersTable({ orders, onDetails }: OrdersTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow className={adminTableHeaderRowClassName()}>
          <TableHead>
            <AdminTableHead>Product Name</AdminTableHead>
          </TableHead>
          <TableHead>
            <AdminTableHead>Customer Name</AdminTableHead>
          </TableHead>
          <TableHead>
            <AdminTableHead>Order Id</AdminTableHead>
          </TableHead>
          <TableHead>
            <AdminTableHead>Amount</AdminTableHead>
          </TableHead>
          <TableHead>
            <AdminTableHead>Status</AdminTableHead>
          </TableHead>
          <TableHead className="text-right">
            <AdminTableHead className="justify-end">Action</AdminTableHead>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {orders.map((order) => (
          <TableRow
            key={order.id}
            className="group border-b border-border/40 transition-colors duration-150 hover:bg-muted/20"
          >
            <TableCell>
              <div className="flex items-center gap-2.5">
                <ProductThumbnail name={order.productName} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-foreground">
                    {order.productName}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {order.productCategory}
                  </p>
                </div>
              </div>
            </TableCell>
            <TableCell>
              <div className="flex items-center gap-2.5">
                <CustomerAvatar name={order.customerName} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-foreground">
                    {order.customerName}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {order.customerType}
                  </p>
                </div>
              </div>
            </TableCell>
            <TableCell>
              <p className="text-sm font-semibold text-foreground">
                {order.orderId}
              </p>
              <p className="text-xs text-muted-foreground">{order.orderDate}</p>
            </TableCell>
            <TableCell>
              <p className="text-sm font-semibold text-foreground">
                {formatAmount(order.amount, order.currency)}
              </p>
              <p className="text-xs text-muted-foreground">
                {order.paymentMethod}
              </p>
            </TableCell>
            <TableCell>
              <OrderReferenceStatusBadge status={order.status} />
            </TableCell>
            <TableCell className="text-right">
              <div className="flex items-center justify-end">
                <AdminRowActions
                  srLabel={`Sipariş ${order.orderId} aksiyonları`}
                  actions={[
                    {
                      label: 'Detay',
                      onClick: () => onDetails?.(order.id)
                    },
                    {
                      label: 'Düzenle',
                      separatorBefore: true
                    },
                    {
                      label: 'Fatura yazdır'
                    },
                    {
                      label: 'Siparişi iptal et',
                      destructive: true,
                      separatorBefore: true
                    }
                  ]}
                />
              </div>
            </TableCell>
          </TableRow>
        ))}

        {orders.length === 0 && (
          <TableRow>
            <TableCell colSpan={6} className="h-48 text-center">
              <p className="text-sm font-medium text-muted-foreground">
                No orders found.
              </p>
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  )
}
