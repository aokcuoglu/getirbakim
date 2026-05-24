import {
  AlertTriangle,
  CircleDollarSign,
  Package,
  ShieldAlert
} from 'lucide-react'
import type { ElementType } from 'react'
import { cn } from '@/lib/utils'
import {
  AdminCard,
  AdminCardContent,
  AdminCardHeader,
  AdminCardTitle
} from '@/components/admin/admin-card'

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
  const iconVariants = {
    default: 'bg-muted text-muted-foreground',
    warning: 'bg-secondary text-secondary-foreground',
    danger: 'bg-destructive/10 text-destructive'
  }

  const subtitleVariants = {
    default: 'text-muted-foreground',
    warning: 'text-secondary-foreground',
    danger: 'text-destructive'
  }

  return (
    <AdminCard>
      <AdminCardHeader className="flex flex-row items-center justify-between space-y-0 pb-1">
        <AdminCardTitle className="text-xs font-medium text-muted-foreground">
          {title}
        </AdminCardTitle>
        <div
          className={cn(
            'flex h-8 w-8 items-center justify-center rounded-md',
            iconVariants[variant]
          )}
        >
          <Icon className="h-4 w-4" />
        </div>
      </AdminCardHeader>
      <AdminCardContent>
        <p className="text-xl font-semibold tracking-tight">{value}</p>
        {subtitle ? (
          <p className={cn('mt-0.5 text-xs', subtitleVariants[variant])}>
            {subtitle}
          </p>
        ) : null}
      </AdminCardContent>
    </AdminCard>
  )
}

export function StatsCards({ metrics }: StatsCardsProps) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
        subtitle={
          metrics.syncErrorCount > 0
            ? `${metrics.syncErrorCount} hata`
            : 'Hata yok'
        }
        icon={ShieldAlert}
        variant={metrics.syncErrorCount > 0 ? 'danger' : 'default'}
      />
    </div>
  )
}
