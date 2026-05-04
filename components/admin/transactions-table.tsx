import {
  AlertTriangle,
  BadgeCheck,
  Clock3,
  ShoppingBag,
  XCircle
} from 'lucide-react'
import type { ElementType } from 'react'
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
    tone: 'bg-amber-50 text-amber-700 border-amber-200'
  },
  COMPLETED: {
    label: 'Tamamlandı',
    icon: BadgeCheck,
    tone: 'bg-emerald-50 text-emerald-700 border-emerald-200'
  },
  CANCELLED: {
    label: 'İptal',
    icon: XCircle,
    tone: 'bg-rose-50 text-rose-700 border-rose-200'
  }
}

export function TransactionsTable({ orders, alerts }: TransactionsTableProps) {
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      <div className="xl:col-span-2 rounded-2xl border border-indigo-100/50 bg-white p-4 shadow-lg shadow-indigo-100/50 sm:p-5">
        <div className="mb-5 flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900">Son Siparişler</h3>
          <span className="rounded-full bg-slate-50 px-3 py-1 text-xs font-medium text-slate-500">
            {orders.length} kayıt
          </span>
        </div>

        <ResponsiveDataView
          mobile={
            orders.length === 0 ? (
              <div className="py-10 text-center text-slate-400">
                <ShoppingBag className="mx-auto mb-2 opacity-40" size={24} />
                Sipariş kaydı bulunamadı.
              </div>
            ) : (
              <div className="space-y-3">
                {orders.map((order) => {
                  const style = statusStyles[order.status] || statusStyles.PENDING
                  const Icon = style.icon
                  return (
                    <MobileDataCard key={order.id} className="border border-slate-100 bg-slate-50/50">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold text-slate-800">
                            #{order.id} - {order.customerName}
                          </p>
                          <p className="text-xs text-slate-400 truncate">
                            {order.customerEmail || '-'}
                          </p>
                        </div>
                        <span
                          className={cn(
                            'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold',
                            style.tone
                          )}
                        >
                          <Icon size={12} />
                          {style.label}
                        </span>
                      </div>
                      <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                        <span>{new Date(order.createdAt).toLocaleDateString('tr-TR')}</span>
                        <span className="font-bold text-slate-900">
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
                  <tr className="border-b border-slate-100 text-left text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    <th className="px-4 py-3">Sipariş</th>
                    <th className="px-4 py-3">Müşteri</th>
                    <th className="px-4 py-3">Tarih</th>
                    <th className="px-4 py-3">Tutar</th>
                    <th className="px-4 py-3">Durum</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {orders.map((order) => {
                    const style =
                      statusStyles[order.status] || statusStyles.PENDING
                    const Icon = style.icon
                    return (
                      <tr key={order.id} className="transition-colors hover:bg-slate-50/50">
                        <td className="px-4 py-3 font-semibold text-slate-700">
                          #{order.id}
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-slate-800">
                            {order.customerName}
                          </div>
                          <div className="text-xs text-slate-400">
                            {order.customerEmail || '-'}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-slate-500">
                          {new Date(order.createdAt).toLocaleDateString('tr-TR')}
                        </td>
                        <td className="px-4 py-3 font-bold text-slate-900">
                          {order.totalAmount.toLocaleString('tr-TR', {
                            style: 'currency',
                            currency: 'TRY',
                            maximumFractionDigits: 2
                          })}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={cn(
                              'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold',
                              style.tone
                            )}
                          >
                            <Icon size={12} />
                            {style.label}
                          </span>
                        </td>
                      </tr>
                    )
                  })}

                  {orders.length === 0 && (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-4 py-10 text-center text-slate-400"
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

      <div className="rounded-2xl border border-indigo-100/50 bg-white p-4 shadow-lg shadow-indigo-100/50 sm:p-5">
        <div className="mb-5 flex items-center gap-2">
          <h3 className="text-lg font-bold text-slate-900">Kritik Uyarılar</h3>
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-rose-100 text-[10px] font-bold text-rose-600">
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
                  ? 'border-rose-200 bg-gradient-to-br from-rose-50 to-rose-100/30'
                  : alert.severity === 'medium'
                    ? 'border-amber-200 bg-gradient-to-br from-amber-50 to-amber-100/30'
                    : 'border-emerald-200 bg-gradient-to-br from-emerald-50 to-emerald-100/30'
              )}
            >
              <div className="flex items-start justify-between">
                <p className="text-sm font-medium text-slate-700">{alert.label}</p>
                <AlertTriangle
                  size={16}
                  className={cn(
                    'mt-0.5',
                    alert.severity === 'high'
                      ? 'text-rose-500'
                      : alert.severity === 'medium'
                        ? 'text-amber-500'
                        : 'text-emerald-500'
                  )}
                />
              </div>
              <p className="mt-2 text-2xl font-bold text-slate-900">
                {alert.value.toLocaleString('tr-TR')}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
