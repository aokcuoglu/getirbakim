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
import {
  AdminCard,
  AdminCardContent,
  AdminCardDescription,
  AdminCardHeader,
  AdminCardTitle
} from '@/components/admin/admin-card'
import { Alert, AlertDescription } from '@/components/ui/alert'

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
    <AdminCard>
      <AdminCardHeader>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <AdminCardTitle>Satış Grafiği</AdminCardTitle>
            <AdminCardDescription>Son 6 ay performansı</AdminCardDescription>
          </div>
          {failedSyncRate > 0 && (
            <Alert className="max-w-xs border-border py-2">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-xs">
                Sync hata oranı: %{failedSyncRate.toFixed(2)}
              </AlertDescription>
            </Alert>
          )}
        </div>
      </AdminCardHeader>
      <AdminCardContent>
        <div className="mb-3 grid grid-cols-2 gap-2">
          <div className="rounded-md bg-muted/50 p-3">
            <p className="text-xs font-medium text-muted-foreground">
              Toplam Gelir
            </p>
            <p className="mt-0.5 text-base font-semibold tracking-tight">
              {totalRevenue.toLocaleString('tr-TR', {
                style: 'currency',
                currency: 'TRY',
                maximumFractionDigits: 0
              })}
            </p>
          </div>
          <div className="rounded-md bg-muted/50 p-3">
            <p className="text-xs font-medium text-muted-foreground">
              Toplam Sipariş
            </p>
            <p className="mt-0.5 text-base font-semibold tracking-tight">
              {totalOrders.toLocaleString('tr-TR')}
            </p>
          </div>
        </div>

        <div className="h-[220px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={salesSeries}>
              <defs>
                <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="5%"
                    stopColor="hsl(var(--primary))"
                    stopOpacity={0.15}
                  />
                  <stop
                    offset="95%"
                    stopColor="hsl(var(--primary))"
                    stopOpacity={0}
                  />
                </linearGradient>
              </defs>

              <CartesianGrid
                strokeDasharray="3 3"
                vertical={false}
                stroke="hsl(var(--border))"
              />
              <XAxis
                dataKey="month"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                dy={10}
              />
              <YAxis hide />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'hsl(var(--popover))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '8px',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                  padding: '12px',
                  color: 'hsl(var(--popover-foreground))'
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
                stroke="hsl(var(--primary))"
                fill="url(#revenueFill)"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </AdminCardContent>
    </AdminCard>
  )
}
