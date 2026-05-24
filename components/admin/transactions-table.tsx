import {
  AlertTriangle,
  BadgeCheck,
  Clock3,
  ShoppingBag,
  XCircle
} from 'lucide-react'
import type { ElementType } from 'react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import {
  MobileDataCard,
  ResponsiveDataView
} from '@/components/admin/responsive-data-view'

interface TransactionsTableProps {
  orders: Array<{
    id: number
    customerName: string
    customerEmail: string | null
    createdAt: string
    totalAmount: number
    status: string
  }>
  alerts: Array<{
    id: string
    label: string
    value: number
    severity: 'high' | 'medium' | 'low'
  }>
}

const statusStyles: Record<string, { label: string; icon: ElementType; tone: string }> = {
  PENDING: {
    label: 'Beklemede',
    icon: Clock3,
    tone: 'bg-warning/10 text-warning border-warning/20'
  },
  COMPLETED: {
    label: 'Tamamlandı',
    icon: BadgeCheck,
    tone: 'bg-success/10 text-success border-success/20'
  },
  CANCELLED: {
    label: 'İptal',
    icon: XCircle,
    tone: 'bg-destructive/10 text-destructive border-destructive/20'
  }
}

export function TransactionsTable({ orders, alerts }: TransactionsTableProps) {
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      <div className="xl:col-span-2 rounded-2xl border border-border/50 bg-background p-4 shadow-sm sm:p-5">
        <div className="mb-5 flex items-center justify-between">
          <h3 className="text-lg font-bold text-foreground">Son Siparişler</h3>
          <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
            {orders.length} kayıt
          </span>
        </div>

        <ResponsiveDataView
          mobile={
            orders.length === 0 ? (
              <div className="py-10 text-center text-muted-foreground">
                <ShoppingBag className="mx-auto mb-2 opacity-40" size={24} />
                Sipariş kaydı bulunamadı.
              </div>
            ) : (
              <div className="space-y-3">
                {orders.map((order) => {
                  const style = statusStyles[order.status] || statusStyles.PENDING
                  const Icon = style.icon
                  return (
                    <MobileDataCard key={order.id} className="border border-border bg-muted/50">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold text-foreground">
                            #{order.id} - {order.customerName}
                          </p>
                          <p className="text-xs text-muted-foreground truncate">
                            {order.customerEmail || '-'}
                          </p>
                        </div>
                        <Badge variant="outline" className={cn('gap-1 text-xs font-semibold', style.tone)}>
                          <Icon size={12} />
                          {style.label}
                        </Badge>
                      </div>
                      <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                        <span>{new Date(order.createdAt).toLocaleDateString('tr-TR')}</span>
                        <span className="font-bold text-foreground">
                          {order.totalAmount.toLocaleString('tr-TR', {
                            style: 'currency',
                            currency: 'TRY',
                            maximumFractionDigits: 2
                          })}
                        </span>
                      </div>
                    </MobileDataCard>
                  )
                })}
              </div>
            )
          }
          desktop={
            <div className="overflow-x-auto -mx-4 sm:mx-0">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    <th className="px-4 py-3">Sipariş</th>
                    <th className="px-4 py-3">Müşteri</th>
                    <th className="px-4 py-3">Tarih</th>
                    <th className="px-4 py-3">Tutar</th>
                    <th className="px-4 py-3">Durum</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {orders.map((order) => {
                    const style =
                      statusStyles[order.status] || statusStyles.PENDING
                    const Icon = style.icon
                    return (
                      <tr key={order.id} className="transition-colors hover:bg-muted/50">
                        <td className="px-4 py-3 font-semibold text-foreground">
                          #{order.id}
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-foreground">
                            {order.customerName}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {order.customerEmail || '-'}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {new Date(order.createdAt).toLocaleDateString('tr-TR')}
                        </td>
                        <td className="px-4 py-3 font-bold text-foreground">
                          {order.totalAmount.toLocaleString('tr-TR', {
                            style: 'currency',
                            currency: 'TRY',
                            maximumFractionDigits: 2
                          })}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="outline" className={cn('gap-1 text-xs font-semibold', style.tone)}>
                            <Icon size={12} />
                            {style.label}
                          </Badge>
                        </td>
                      </tr>
                    )
                  })}

                  {orders.length === 0 && (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-4 py-10 text-center text-muted-foreground"
                      >
                        <ShoppingBag
                          className="mx-auto mb-2 opacity-40"
                          size={24}
                        />
                        Sipariş kaydı bulunamadı.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          }
        />
      </div>

      <div className="rounded-2xl border border-border/50 bg-background p-4 shadow-sm sm:p-5">
        <div className="mb-5 flex items-center gap-2">
          <h3 className="text-lg font-bold text-foreground">Kritik Uyarılar</h3>
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-destructive/15 text-[10px] font-bold text-destructive">
            {alerts.length}
          </span>
        </div>
        <div className="space-y-3">
          {alerts.map((alert) => (
            <div
              key={alert.id}
              className={cn(
                'relative overflow-hidden rounded-xl border p-4',
                alert.severity === 'high'
                  ? 'border-destructive/20 bg-gradient-to-br from-destructive/10 to-destructive/10'
                  : alert.severity === 'medium'
                    ? 'border-warning/20 bg-gradient-to-br from-warning/10 to-warning/10'
                    : 'border-success/20 bg-gradient-to-br from-success/10 to-success/10'
              )}
            >
              <div className="flex items-start justify-between">
                <p className="text-sm font-medium text-foreground">{alert.label}</p>
                <AlertTriangle
                  size={16}
                  className={cn(
                    'mt-0.5',
                    alert.severity === 'high'
                      ? 'text-destructive'
                      : alert.severity === 'medium'
                        ? 'text-warning'
                        : 'text-success'
                  )}
                />
              </div>
              <p className="mt-2 text-2xl font-bold text-foreground">
                {alert.value.toLocaleString('tr-TR')}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
