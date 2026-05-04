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
      color: 'text-emerald-600',
      bgColor: 'bg-emerald-50'
    },
    {
      label: 'Sipariş Sayısı',
      value: '856',
      change: 8.2,
      changeLabel: 'geçen aya göre',
      icon: TrendingUp,
      color: 'text-blue-600',
      bgColor: 'bg-blue-50'
    },
    {
      label: 'Ortalama Sepet',
      value: '₺145.50',
      change: -2.3,
      changeLabel: 'geçen aya göre',
      icon: TrendingDown,
      color: 'text-rose-600',
      bgColor: 'bg-rose-50'
    },
    {
      label: 'Müşteri Memnuniyeti',
      value: '%98.5',
      change: 1.2,
      changeLabel: 'geçen aya göre',
      icon: TrendingUp,
      color: 'text-amber-600',
      bgColor: 'bg-amber-50'
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
            className="rounded-2xl border border-indigo-100/50 bg-white p-5 shadow-lg shadow-indigo-100/50 hover:shadow-xl transition-shadow"
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
                    ? 'bg-emerald-50 text-emerald-600'
                    : 'bg-rose-50 text-rose-600'
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
            <p className="text-2xl font-bold text-slate-900">{metric.value}</p>
            <p className="text-xs text-slate-500 mt-1">{metric.label}</p>
            <p className="text-[10px] text-slate-400 mt-0.5">
              {metric.changeLabel}
            </p>
          </div>
        )
      })}
    </div>
  )
}
