import { ShoppingCart } from 'lucide-react'
import { Link } from '@/lib/navigation'
import { AdminTableHead } from '@/components/admin/data-table/admin-table-head'
import { AdminTableShell } from '@/components/admin/data-table/admin-table-shell'
import {
  AdminCard,
  AdminCardContent,
  AdminCardDescription,
  AdminCardHeader,
  AdminCardTitle
} from '@/components/admin/admin-card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'

interface Order {
  id: number
  customerName: string
  totalAmount: number
  status: string
  createdAt: string
}

interface RecentOrdersWidgetProps {
  orders: Order[]
}

const statusConfig: Record<
  string,
  {
    label: string
    className: string
  }
> = {
  PENDING: {
    label: 'Beklemede',
    className: 'border-secondary text-secondary-foreground'
  },
  COMPLETED: {
    label: 'Tamamlandı',
    className: 'border-border text-foreground'
  },
  CANCELLED: {
    label: 'İptal',
    className: 'border-destructive/50 text-destructive'
  }
}

export function RecentOrdersWidget({ orders }: RecentOrdersWidgetProps) {
  return (
    <AdminCard>
      <AdminCardHeader className="flex flex-row items-center justify-between space-y-0">
        <div>
          <AdminCardTitle>Son Siparişler</AdminCardTitle>
          <AdminCardDescription>En son alınan siparişler</AdminCardDescription>
        </div>
        <Button variant="link" size="sm" className="px-0" asChild>
          <Link href="/admin/orders">Tümünü Gör →</Link>
        </Button>
      </AdminCardHeader>
      <AdminCardContent>
        {orders.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <ShoppingCart className="mb-3 h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">Henüz sipariş bulunmuyor</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Yeni siparişler burada listelenecek
            </p>
          </div>
        ) : (
          <AdminTableShell>
            <Table>
              <TableHeader>
                <TableRow className="border-b border-border bg-muted/40 hover:bg-muted/40">
                  <TableHead className="h-10 px-4">
                    <AdminTableHead>Sipariş</AdminTableHead>
                  </TableHead>
                  <TableHead className="h-10 px-4">
                    <AdminTableHead>Müşteri</AdminTableHead>
                  </TableHead>
                  <TableHead className="hidden h-10 px-4 sm:table-cell">
                    <AdminTableHead>Tarih</AdminTableHead>
                  </TableHead>
                  <TableHead className="hidden h-10 px-4 text-right md:table-cell">
                    <AdminTableHead className="justify-end">Tutar</AdminTableHead>
                  </TableHead>
                  <TableHead className="h-10 px-4">
                    <AdminTableHead>Durum</AdminTableHead>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.slice(0, 8).map((order) => {
                  const status =
                    statusConfig[order.status] || statusConfig.PENDING
                  return (
                    <TableRow key={order.id} className="cursor-pointer">
                      <TableCell className="px-4 py-2.5 font-medium">
                        <Link
                          href="/admin/orders"
                          className="hover:underline"
                        >
                          #{order.id}
                        </Link>
                      </TableCell>
                      <TableCell className="max-w-[180px] truncate px-4 py-2.5 text-muted-foreground sm:max-w-[240px]">
                        {order.customerName}
                      </TableCell>
                      <TableCell className="hidden px-4 py-2.5 text-muted-foreground sm:table-cell">
                        {new Date(order.createdAt).toLocaleDateString('tr-TR')}
                      </TableCell>
                      <TableCell className="hidden px-4 py-2.5 text-right font-medium md:table-cell">
                        {order.totalAmount.toLocaleString('tr-TR', {
                          style: 'currency',
                          currency: 'TRY'
                        })}
                      </TableCell>
                      <TableCell className="px-4 py-2.5">
                        <Badge variant="outline" className={status.className}>
                          {status.label}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </AdminTableShell>
        )}
      </AdminCardContent>
    </AdminCard>
  )
}
