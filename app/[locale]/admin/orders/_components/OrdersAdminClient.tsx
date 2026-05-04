'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { Filter, Loader2, RefreshCw, Search } from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useDebouncedCallback } from 'use-debounce'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Pagination } from '@/components/ui/Pagination'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import {
  MobileDataCard,
  ResponsiveDataView
} from '@/components/admin/responsive-data-view'
import { OrderStatusBadge } from '@/components/orders/OrderStatusBadge'
import { canAdminManageOrderStatus } from '@/lib/orders/types'
import {
  bulkUpdateOrderStatus,
  updateOrderStatus
} from '@/lib/actions/admin-orders'
import type { AdminOrdersResult } from '@/lib/types/admin-orders'
import { OrderDetailDrawer } from './OrderDetailDrawer'

interface OrdersAdminClientProps {
  data: AdminOrdersResult
}

const ROW_STATUS_NONE = '__none__'

export function OrdersAdminClient({ data }: OrdersAdminClientProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [isPending, startTransition] = useTransition()
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [rowStatuses, setRowStatuses] = useState<Record<number, string>>({})
  const [bulkStatus, setBulkStatus] = useState('PROCESSING')

  const [detailOrderId, setDetailOrderId] = useState<number | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)

  useEffect(() => {
    setSelectedIds([])
    const nextStatuses: Record<number, string> = {}
    for (const order of data.orders) {
      nextStatuses[order.id] = canAdminManageOrderStatus(order.status) ? order.status : ''
    }
    setRowStatuses(nextStatuses)
  }, [data.orders])

  const setParam = (name: string, value?: string | null) => {
    const params = new URLSearchParams(searchParams.toString())
    if (!value || value === 'all') {
      params.delete(name)
    } else {
      params.set(name, value)
    }
    params.delete('page')
    router.push(`${pathname}?${params.toString()}`)
  }

  const onSearch = useDebouncedCallback((value: string) => {
    setParam('q', value.trim() || null)
  }, 300)

  const allVisibleSelected = useMemo(() => {
    if (data.orders.length === 0) return false
    return data.orders.every((order) => selectedIds.includes(order.id))
  }, [data.orders, selectedIds])

  const toggleAllVisible = () => {
    if (allVisibleSelected) {
      setSelectedIds((prev) =>
        prev.filter((id) => !data.orders.some((order) => order.id === id))
      )
    } else {
      setSelectedIds((prev) =>
        Array.from(new Set([...prev, ...data.orders.map((order) => order.id)]))
      )
    }
  }

  const toggleSelection = (id: number) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    )
  }

  const saveRowStatus = (orderId: number) => {
    const status = rowStatuses[orderId]
    if (!status) return

    startTransition(async () => {
      const result = await updateOrderStatus({ orderId, status })
      if (!result.success) {
        toast.error(result.message)
        return
      }
      toast.success(result.message)
      router.refresh()
    })
  }

  const applyBulkStatus = () => {
    if (selectedIds.length === 0) {
      toast.error('Lütfen en az bir sipariş seçin.')
      return
    }

    startTransition(async () => {
      const result = await bulkUpdateOrderStatus({
        orderIds: selectedIds,
        status: bulkStatus
      })

      if (!result.success) {
        toast.error(result.message)
        return
      }

      toast.success(`${result.affected} sipariş güncellendi.`)
      router.refresh()
    })
  }

  const goPage = (page: number) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('page', String(page))
    router.push(`${pathname}?${params.toString()}`)
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Toplam Sipariş" value={data.kpis.totalOrders} tone="slate" />
        <KpiCard label="Ödeme Bekleyen" value={data.kpis.pendingOrders} tone="amber" />
        <KpiCard label="Tamamlanan" value={data.kpis.completedOrders} tone="emerald" />
        <KpiCard label="Problemli" value={data.kpis.cancelledOrders} tone="rose" />
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative w-full max-w-lg">
            <Search
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
            />
            <input
              defaultValue={searchParams.get('q') || ''}
              onChange={(event) => onSearch(event.target.value)}
              placeholder="Sipariş no, müşteri adı veya e-posta ara..."
              className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs text-gray-600">
              <Filter size={12} />
              <span>Durum</span>
              <Select
                value={searchParams.get('status') || 'all'}
                onValueChange={(value) => setParam('status', value)}
              >
                <SelectTrigger className="h-7 w-[170px] border-none bg-transparent px-1 text-xs text-[#101828] shadow-none focus-visible:ring-0">
                  <SelectValue placeholder="Tümü" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tümü</SelectItem>
                  <SelectItem value="PENDING_PAYMENT">PENDING_PAYMENT</SelectItem>
                  <SelectItem value="PAID">PAID</SelectItem>
                  <SelectItem value="PAYMENT_FAILED">PAYMENT_FAILED</SelectItem>
                  <SelectItem value="PROCESSING">PROCESSING</SelectItem>
                  <SelectItem value="SHIPPED">SHIPPED</SelectItem>
                  <SelectItem value="COMPLETED">COMPLETED</SelectItem>
                  <SelectItem value="CANCELLED">CANCELLED</SelectItem>
                  <SelectItem value="REFUNDED">REFUNDED</SelectItem>
                </SelectContent>
              </Select>
            </label>

            <Button
              variant="outline"
              onClick={() => router.refresh()}
              disabled={isPending}
            >
              {isPending ? (
                <Loader2 size={14} className="mr-2 animate-spin" />
              ) : (
                <RefreshCw size={14} className="mr-2" />
              )}
              Yenile
            </Button>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          <p className="text-sm font-semibold text-[#101828]">
            Toplu Durum Güncelle ({selectedIds.length} seçili)
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={bulkStatus} onValueChange={setBulkStatus}>
              <SelectTrigger className="w-[190px]">
                <SelectValue placeholder="Durum seçin" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="PROCESSING">PROCESSING</SelectItem>
                <SelectItem value="SHIPPED">SHIPPED</SelectItem>
                <SelectItem value="COMPLETED">COMPLETED</SelectItem>
                <SelectItem value="CANCELLED">CANCELLED</SelectItem>
                <SelectItem value="REFUNDED">REFUNDED</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={applyBulkStatus} disabled={isPending || selectedIds.length === 0}>
              Uygula
            </Button>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-3 md:p-0 md:border-0 md:bg-transparent">
        <ResponsiveDataView
          mobile={
            data.orders.length === 0 ? (
              <div className="rounded-xl border border-gray-200 bg-white px-4 py-12 text-center text-gray-500">
                Sipariş bulunamadı.
              </div>
            ) : (
              <div className="space-y-3">
                <label className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleAllVisible}
                  />
                  Bu sayfadaki tum siparisleri sec
                </label>
                {data.orders.map((order) => (
                  <MobileDataCard key={order.id}>
                    <div className="flex items-start justify-between gap-3">
                      <label className="flex min-w-0 items-start gap-2">
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(order.id)}
                          onChange={() => toggleSelection(order.id)}
                          className="mt-1"
                        />
                        <span className="min-w-0">
                          <p className="font-semibold text-[#101828] truncate">
                            {order.orderNumber}
                          </p>
                          <p className="text-xs text-gray-500">
                            Kalem: {order.itemsCount}
                          </p>
                        </span>
                      </label>
                      <OrderStatusBadge status={order.status} />
                    </div>

                    <div className="mt-3 grid grid-cols-1 gap-2 text-xs text-gray-600">
                      <p>
                        Musteri: {order.customerName} ({order.customerEmail || '-'})
                      </p>
                      <p>Tarih: {new Date(order.createdAt).toLocaleString('tr-TR')}</p>
                      <p className="font-semibold text-[#101828]">
                        Tutar:{' '}
                        {order.totalAmount.toLocaleString('tr-TR', {
                          style: 'currency',
                          currency: 'TRY',
                          maximumFractionDigits: 2
                        })}
                      </p>
                      <p>
                        Odeme: <OrderStatusBadge status={order.paymentStatus} />{' '}
                        <span className="ml-1">{order.paymentMethod || '-'}</span>
                      </p>
                    </div>

                    <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                      <Select
                        value={rowStatuses[order.id] || ROW_STATUS_NONE}
                        onValueChange={(value) =>
                          setRowStatuses((prev) => ({
                            ...prev,
                            [order.id]: value === ROW_STATUS_NONE ? '' : value
                          }))
                        }
                      >
                        <SelectTrigger className="h-9 flex-1 text-xs">
                          <SelectValue placeholder="Operasyon Seç" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={ROW_STATUS_NONE}>Operasyon Seç</SelectItem>
                          <SelectItem value="PROCESSING">PROCESSING</SelectItem>
                          <SelectItem value="SHIPPED">SHIPPED</SelectItem>
                          <SelectItem value="COMPLETED">COMPLETED</SelectItem>
                          <SelectItem value="CANCELLED">CANCELLED</SelectItem>
                          <SelectItem value="REFUNDED">REFUNDED</SelectItem>
                        </SelectContent>
                      </Select>
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setDetailOrderId(order.id)
                            setDetailOpen(true)
                          }}
                        >
                          Detay
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => saveRowStatus(order.id)}
                          disabled={isPending}
                          className="bg-[#101828] hover:bg-[#1d2939]"
                        >
                          Kaydet
                        </Button>
                      </div>
                    </div>
                  </MobileDataCard>
                ))}
              </div>
            )
          }
          desktop={
            <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-gray-50/80 text-left text-[11px] font-bold uppercase tracking-wider text-gray-500">
                    <th className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={allVisibleSelected}
                        onChange={toggleAllVisible}
                      />
                    </th>
                    <th className="px-4 py-3">Sipariş</th>
                    <th className="px-4 py-3">Müşteri</th>
                    <th className="px-4 py-3">Tarih</th>
                    <th className="px-4 py-3">Tutar</th>
                    <th className="px-4 py-3">Durum</th>
                    <th className="px-4 py-3">Ödeme</th>
                    <th className="px-4 py-3 text-right">Aksiyon</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {data.orders.map((order) => (
                    <tr key={order.id} className="hover:bg-gray-50/60">
                      <td className="px-4 py-3 align-top">
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(order.id)}
                          onChange={() => toggleSelection(order.id)}
                        />
                      </td>
                      <td className="px-4 py-3 align-top">
                        <p className="font-semibold text-[#101828]">
                          {order.orderNumber}
                        </p>
                        <p className="text-xs text-gray-500">
                          Kalem: {order.itemsCount}
                        </p>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <p className="font-semibold text-[#101828]">
                          {order.customerName}
                        </p>
                        <p className="text-xs text-gray-500">
                          {order.customerEmail || '-'}
                        </p>
                      </td>
                      <td className="px-4 py-3 align-top text-gray-600">
                        {new Date(order.createdAt).toLocaleString('tr-TR')}
                      </td>
                      <td className="px-4 py-3 align-top font-semibold text-[#101828]">
                        {order.totalAmount.toLocaleString('tr-TR', {
                          style: 'currency',
                          currency: 'TRY',
                          maximumFractionDigits: 2
                        })}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div className="mb-2">
                          <OrderStatusBadge status={order.status} />
                        </div>
                        <Select
                          value={rowStatuses[order.id] || ROW_STATUS_NONE}
                          onValueChange={(value) =>
                            setRowStatuses((prev) => ({
                              ...prev,
                              [order.id]: value === ROW_STATUS_NONE ? '' : value
                            }))
                          }
                        >
                          <SelectTrigger className="h-8 w-[180px] text-xs">
                            <SelectValue placeholder="Operasyon Seç" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={ROW_STATUS_NONE}>Operasyon Seç</SelectItem>
                            <SelectItem value="PROCESSING">PROCESSING</SelectItem>
                            <SelectItem value="SHIPPED">SHIPPED</SelectItem>
                            <SelectItem value="COMPLETED">COMPLETED</SelectItem>
                            <SelectItem value="CANCELLED">CANCELLED</SelectItem>
                            <SelectItem value="REFUNDED">REFUNDED</SelectItem>
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div className="space-y-2">
                          <OrderStatusBadge status={order.paymentStatus} />
                          <p className="text-xs text-gray-500">
                            {order.paymentMethod || '-'}
                          </p>
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setDetailOrderId(order.id)
                              setDetailOpen(true)
                            }}
                          >
                            Detay
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => saveRowStatus(order.id)}
                            disabled={isPending}
                            className="bg-[#101828] hover:bg-[#1d2939]"
                          >
                            Kaydet
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}

                  {data.orders.length === 0 && (
                    <tr>
                      <td
                        colSpan={8}
                        className="px-4 py-12 text-center text-gray-500"
                      >
                        Sipariş bulunamadı.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          }
        />
      </div>

      <Pagination
        currentPage={data.pagination.page}
        totalPages={data.pagination.pages}
        totalItems={data.pagination.total}
        itemsPerPage={data.pagination.limit}
        onPageChange={goPage}
      />

      <OrderDetailDrawer
        orderId={detailOrderId}
        open={detailOpen}
        onOpenChange={setDetailOpen}
      />
    </div>
  )
}

function KpiCard({
  label,
  value,
  tone
}: {
  label: string
  value: number
  tone: 'slate' | 'amber' | 'emerald' | 'rose'
}) {
  const toneClass =
    tone === 'amber'
      ? 'bg-amber-50 text-amber-700 border-amber-100'
      : tone === 'emerald'
        ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
        : tone === 'rose'
          ? 'bg-rose-50 text-rose-700 border-rose-100'
          : 'bg-slate-50 text-slate-700 border-slate-100'

  return (
    <div className={`rounded-xl border p-4 ${toneClass}`}>
      <p className="text-xs font-medium uppercase tracking-wider">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value.toLocaleString('tr-TR')}</p>
    </div>
  )
}
