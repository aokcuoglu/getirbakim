import {
  AlertTriangle,
  CircleDollarSign,
  Package,
  ShieldAlert
} from 'lucide-react'
import type { ElementType } from 'react'
import { cn } from '@/lib/utils'

interface StatsCardsProps {
  metrics: {
    totalProducts: number
    lowStockCount: number
    zeroPriceCount: number
    syncErrorCount: number
    failedSyncRate: number
  }
}

interface StatsCardProps {
  title: string
  value: string
  subtitle?: string
  icon: ElementType
  variant: 'default' | 'warning' | 'danger'
}

function StatsCard({
  title,
  value,
  subtitle,
  icon: Icon,
  variant
}: StatsCardProps) {
  const variants = {
    default: {
      iconBg: 'bg-slate-100',
      iconColor: 'text-slate-600'
    },
    warning: {
      iconBg: 'bg-amber-50',
      iconColor: 'text-amber-600'
    },
    danger: {
      iconBg: 'bg-rose-50',
      iconColor: 'text-rose-600'
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <p className="text-sm font-medium text-slate-500">{title}</p>
          <p className="text-2xl font-semibold text-slate-900">{value}</p>
          {subtitle && (
            <p className={cn(
              'text-xs',
              variant === 'default' ? 'text-slate-400' :
              variant === 'warning' ? 'text-amber-600' : 'text-rose-600'
            )}>
              {subtitle}
            </p>
          )}
        </div>
        <div className={cn(
          'flex h-11 w-11 items-center justify-center rounded-lg',
          variants[variant].iconBg
        )}>
          <Icon size={20} className={variants[variant].iconColor} />
        </div>
      </div>
    </div>
  )
}

export function StatsCards({ metrics }: StatsCardsProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatsCard
        title="Toplam Ürün"
        value={metrics.totalProducts.toLocaleString('tr-TR')}
        subtitle="Aktif katalog"
        icon={Package}
        variant="default"
      />
      <StatsCard
        title="Düşük Stok"
        value={metrics.lowStockCount.toLocaleString('tr-TR')}
        subtitle={metrics.lowStockCount > 0 ? 'İnceleme gerekli' : 'Normal'}
        icon={AlertTriangle}
        variant={metrics.lowStockCount > 0 ? 'warning' : 'default'}
      />
      <StatsCard
        title="Sıfır Fiyat"
        value={metrics.zeroPriceCount.toLocaleString('tr-TR')}
        subtitle={metrics.zeroPriceCount > 0 ? 'Müdahale gerekli' : 'Normal'}
        icon={CircleDollarSign}
        variant={metrics.zeroPriceCount > 0 ? 'danger' : 'default'}
      />
      <StatsCard
        title="Senkron Hata Oranı"
        value={`%${metrics.failedSyncRate.toFixed(2)}`}
        subtitle={metrics.syncErrorCount > 0 ? `${metrics.syncErrorCount} hata` : 'Hata yok'}
        icon={ShieldAlert}
        variant={metrics.syncErrorCount > 0 ? 'danger' : 'default'}
      />
    </div>
  )
}
