'use client'

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'
import { AlertCircle } from 'lucide-react'

interface SalesReportProps {
  salesSeries: Array<{
    month: string
    revenue: number
    orders: number
  }>
  failedSyncRate: number
}

export function SalesReport({ salesSeries, failedSyncRate }: SalesReportProps) {
  const totalRevenue = salesSeries.reduce((sum, item) => sum + item.revenue, 0)
  const totalOrders = salesSeries.reduce((sum, item) => sum + item.orders, 0)

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-5">
        <div>
          <h3 className="text-base font-semibold text-slate-900">Satış Grafiği</h3>
          <p className="text-sm text-slate-500 mt-0.5">Son 6 ay performansı</p>
        </div>

        {failedSyncRate > 0 && (
          <div className="flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-700">
            <AlertCircle size={14} />
            Sync hata oranı: %{failedSyncRate.toFixed(2)}
          </div>
        )}
      </div>

      <div className="mb-5 grid grid-cols-2 gap-4">
        <div className="rounded-lg bg-slate-50 p-4">
          <p className="text-xs font-medium text-slate-500">Toplam Gelir</p>
          <p className="mt-1 text-xl font-semibold text-slate-900">
            {totalRevenue.toLocaleString('tr-TR', {
              style: 'currency',
              currency: 'TRY',
              maximumFractionDigits: 0
            })}
          </p>
        </div>

        <div className="rounded-lg bg-slate-50 p-4">
          <p className="text-xs font-medium text-slate-500">Toplam Sipariş</p>
          <p className="mt-1 text-xl font-semibold text-slate-900">
            {totalOrders.toLocaleString('tr-TR')}
          </p>
        </div>
      </div>

      <div className="h-[280px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={salesSeries}>
            <defs>
              <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#6366f1" stopOpacity={0.15} />
                <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
              </linearGradient>
            </defs>

            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
            <XAxis
              dataKey="month"
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 12, fill: '#64748b' }}
              dy={10}
            />
            <YAxis hide />
            <Tooltip
              contentStyle={{
                backgroundColor: '#fff',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                padding: '12px'
              }}
              formatter={(
                rawValue: number | string | undefined,
                name: string | undefined
              ) => {
                const value = Number(rawValue ?? 0)
                if (name === 'revenue') {
                  return [
                    value.toLocaleString('tr-TR', {
                      style: 'currency',
                      currency: 'TRY',
                      maximumFractionDigits: 0
                    }),
                    'Gelir'
                  ]
                }

                return [value.toLocaleString('tr-TR'), 'Sipariş']
              }}
              labelFormatter={(value) => `Dönem: ${value}`}
            />
            <Area
              type="monotone"
              dataKey="revenue"
              stroke="#6366f1"
              fill="url(#revenueFill)"
              strokeWidth={2}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
