import { Package, ShoppingCart, RefreshCw, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Activity {
  id: string
  icon: React.ElementType
  message: string
  time: string
  variant: 'default' | 'success' | 'warning' | 'danger'
}

interface ActivityFeedProps {
  activities: Activity[]
}

export function ActivityFeed({ activities }: ActivityFeedProps) {
  const defaultActivities: Activity[] = [
    {
      id: '1',
      icon: Package,
      message: '15 yeni ürün eklendi',
      time: '2 saat önce',
      variant: 'default'
    },
    {
      id: '2',
      icon: ShoppingCart,
      message: 'Yeni sipariş alındı',
      time: '3 saat önce',
      variant: 'success'
    },
    {
      id: '3',
      icon: RefreshCw,
      message: 'Stok senkronizasyonu tamamlandı',
      time: '5 saat önce',
      variant: 'success'
    },
    {
      id: '4',
      icon: AlertTriangle,
      message: '5 ürünün stoku azaldı',
      time: '1 gün önce',
      variant: 'warning'
    }
  ]

  const items = activities.length > 0 ? activities : defaultActivities

  const variantStyles = {
    default: {
      dot: 'bg-slate-400',
      text: 'text-slate-600'
    },
    success: {
      dot: 'bg-emerald-500',
      text: 'text-emerald-600'
    },
    warning: {
      dot: 'bg-amber-500',
      text: 'text-amber-600'
    },
    danger: {
      dot: 'bg-rose-500',
      text: 'text-rose-600'
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <h3 className="text-sm font-semibold text-slate-900 mb-4">Aktiviteler</h3>
      <div className="space-y-4">
        {items.map((activity, idx) => {
          const Icon = activity.icon
          const styles = variantStyles[activity.variant]
          return (
            <div key={activity.id} className="flex gap-3">
              <div className="relative mt-0.5">
                <div className={cn('h-2 w-2 rounded-full', styles.dot)} />
                {idx !== items.length - 1 && (
                  <div className="absolute left-1 top-3 h-full w-px bg-slate-200" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-slate-700">{activity.message}</p>
                <p className="text-xs text-slate-400 mt-0.5">{activity.time}</p>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
