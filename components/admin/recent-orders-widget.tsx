import { ShoppingCart, Eye } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Link } from '@/lib/navigation'

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
    color: string
    bg: string
  }
> = {
  PENDING: {
    label: 'Beklemede',
    color: 'text-amber-700',
    bg: 'bg-amber-50'
  },
  COMPLETED: {
    label: 'Tamamlandı',
    color: 'text-emerald-700',
    bg: 'bg-emerald-50'
  },
  CANCELLED: {
    label: 'İptal',
    color: 'text-rose-700',
    bg: 'bg-rose-50'
  }
}

export function RecentOrdersWidget({ orders }: RecentOrdersWidgetProps) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
        <h3 className="text-sm font-semibold text-slate-900">Son Siparişler</h3>
        <Link
          href="/admin/orders"
          className="text-sm font-medium text-indigo-600 hover:text-indigo-700"
        >
          Tümünü Gör →
        </Link>
      </div>
      <div className="divide-y divide-slate-100">
        {orders.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-slate-500">
            Henüz sipariş bulunmuyor
          </div>
        ) : (
          orders.slice(0, 8).map((order) => {
            const status = statusConfig[order.status] || statusConfig.PENDING
            return (
              <div
                key={order.id}
                className="flex items-center justify-between px-5 py-3.5 hover:bg-slate-50 transition-colors group"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-slate-100">
                    <ShoppingCart size={16} className="text-slate-600" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900">
                      #{order.id}
                    </p>
                    <p className="text-xs text-slate-500 truncate max-w-[180px] sm:max-w-[240px]">
                      {order.customerName}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right hidden sm:block">
                    <p className="text-sm font-semibold text-slate-900">
                      {order.totalAmount.toLocaleString('tr-TR', {
                        style: 'currency',
                        currency: 'TRY'
                      })}
                    </p>
                  </div>
                  <span
                    className={cn(
                      'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium',
                      status.bg,
                      status.color
                    )}
                  >
                    {status.label}
                  </span>
                  <button 
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-md hover:bg-slate-200"
                    aria-label="Detayları gör"
                  >
                    <Eye size={14} className="text-slate-500" />
                  </button>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
