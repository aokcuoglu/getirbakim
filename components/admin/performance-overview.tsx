import { TrendingUp, TrendingDown, ArrowUpRight, ArrowDownRight } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Metric {
  label: string
  value: string
  change: number
  changeLabel: string
  icon: React.ElementType
  color: string
  bgColor: string
}

interface PerformanceOverviewProps {
  metrics?: Metric[]
}

export function PerformanceOverview({ metrics }: PerformanceOverviewProps) {
  const defaultMetrics: Metric[] = [
    {
      label: 'Satış Geliri',
      value: '₺124.500',
      change: 12.5,
      changeLabel: 'geçen aya göre',
      icon: TrendingUp,
      color: 'text-success',
      bgColor: 'bg-success/10'
    },
    {
      label: 'Sipariş Sayısı',
      value: '856',
      change: 8.2,
      changeLabel: 'geçen aya göre',
      icon: TrendingUp,
      color: 'text-primary',
      bgColor: 'bg-accent'
    },
    {
      label: 'Ortalama Sepet',
      value: '₺145.50',
      change: -2.3,
      changeLabel: 'geçen aya göre',
      icon: TrendingDown,
      color: 'text-destructive',
      bgColor: 'bg-destructive/10'
    },
    {
      label: 'Müşteri Memnuniyeti',
      value: '%98.5',
      change: 1.2,
      changeLabel: 'geçen aya göre',
      icon: TrendingUp,
      color: 'text-warning',
      bgColor: 'bg-warning/10'
    }
  ]

  const items = metrics || defaultMetrics

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {items.map((metric) => {
        const Icon = metric.icon
        const isPositive = metric.change > 0
        return (
          <div
            key={metric.label}
            className="rounded-2xl border border-border/50 bg-background p-5 shadow-sm hover:shadow-md transition-shadow"
          >
            <div className="flex items-center justify-between mb-3">
              <div
                className={cn(
                  'flex h-10 w-10 items-center justify-center rounded-xl',
                  metric.bgColor
                )}
              >
                <Icon size={20} className={metric.color} />
              </div>
              <div
                className={cn(
                  'flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold',
                  isPositive
                    ? 'bg-success/10 text-success'
                    : 'bg-destructive/10 text-destructive'
                )}
              >
                {isPositive ? (
                  <ArrowUpRight size={12} />
                ) : (
                  <ArrowDownRight size={12} />
                )}
                {Math.abs(metric.change)}%
              </div>
            </div>
            <p className="text-2xl font-bold text-foreground">{metric.value}</p>
            <p className="text-xs text-muted-foreground mt-1">{metric.label}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {metric.changeLabel}
            </p>
          </div>
        )
      })}
    </div>
  )
}
