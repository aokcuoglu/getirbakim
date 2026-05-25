'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import {
  CheckCircle2,
  Clock,
  Loader2,
  ShoppingCart,
  XCircle
} from 'lucide-react'
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'
import {
  MobileDataCard,
  ResponsiveDataView
} from '@/components/admin/responsive-data-view'
import { AdminFilterBar, AdminFilterChip } from '@/components/admin/data-table/admin-filter-chip'
import { AdminKpiCard, AdminKpiGrid } from '@/components/admin/data-table/admin-kpi-card'
import { AdminTableHead } from '@/components/admin/data-table/admin-table-head'
import { AdminTableShell } from '@/components/admin/data-table/admin-table-shell'
import { AdminTableToolbar } from '@/components/admin/data-table/admin-table-toolbar'
import { OrderStatusBadge } from '@/components/orders/OrderStatusBadge'
import { canAdminManageOrderStatus } from '@/lib/orders/types'
import {
  bulkUpdateOrderStatus,
  updateOrderStatus
} from '@/lib/actions/admin-orders'
import type { AdminOrderListItem, AdminOrdersResult } from '@/lib/types/admin-orders'
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
  const [isRefreshing, startRefresh] = useTransition()
  const [orders, setOrders] = useState<AdminOrderListItem[]>(data.orders)
  const [searchValue, setSearchValue] = useState(searchParams.get('q') || '')
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [rowStatuses, setRowStatuses] = useState<Record<number, string>>({})
  const [bulkStatus, setBulkStatus] = useState('PROCESSING')

  const [detailOrderId, setDetailOrderId] = useState<number | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)

  const currentStatus = searchParams.get('status') || 'all'

  useEffect(() => {
    setOrders(data.orders)
    setSelectedIds([])
    const nextStatuses: Record<number, string> = {}
    for (const order of data.orders) {
      nextStatuses[order.id] = canAdminManageOrderStatus(order.status)
        ? order.status
        : ''
    }
    setRowStatuses(nextStatuses)
  }, [data.orders])

  useEffect(() => {
    setSearchValue(searchParams.get('q') || '')
  }, [searchParams])

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
  }, 250)

  const resetFilters = () => {
    setSearchValue('')
    router.push(pathname)
  }

  const allVisibleSelected = useMemo(() => {
    if (orders.length === 0) return false
    return orders.every((order) => selectedIds.includes(order.id))
  }, [orders, selectedIds])

  const toggleAllVisible = () => {
    if (allVisibleSelected) {
      setSelectedIds((prev) =>
        prev.filter((id) => !orders.some((order) => order.id === id))
      )
    } else {
      setSelectedIds((prev) =>
        Array.from(new Set([...prev, ...orders.map((order) => order.id)]))
      )
    }
  }

  const toggleSelection = (id: number) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    )
  }

  const patchOrderStatus = (orderId: number, status: string) => {
    setOrders((prev) =>
      prev.map((order) =>
        order.id === orderId ? { ...order, status } : order
      )
    )
    setRowStatuses((prev) => ({ ...prev, [orderId]: status }))
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
      patchOrderStatus(orderId, status)
      toast.success(result.message)
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

      setOrders((prev) =>
        prev.map((order) =>
          selectedIds.includes(order.id)
            ? { ...order, status: bulkStatus }
            : order
        )
      )
      setRowStatuses((prev) => {
        const next = { ...prev }
        for (const id of selectedIds) {
          next[id] = bulkStatus
        }
        return next
      })
      toast.success(`${result.affected} sipariş güncellendi.`)
    })
  }

  const goPage = (page: number) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('page', String(page))
    router.push(`${pathname}?${params.toString()}`)
  }

  const handleRefresh = () => {
    startRefresh(() => {
      router.refresh()
    })
  }

  return (
    <div className="space-y-4">
      <AdminKpiGrid>
        <AdminKpiCard
          label="Toplam Sipariş"
          value={data.kpis.totalOrders}
          icon={<ShoppingCart size={16} />}
        />
        <AdminKpiCard
          label="Ödeme Bekleyen"
          value={data.kpis.pendingOrders}
          tone="warning"
          icon={<Clock size={16} />}
        />
        <AdminKpiCard
          label="Tamamlanan"
          value={data.kpis.completedOrders}
          tone="default"
          icon={<CheckCircle2 size={16} />}
        />
        <AdminKpiCard
          label="Problemli"
          value={data.kpis.cancelledOrders}
          tone="danger"
          icon={<XCircle size={16} />}
        />
      </AdminKpiGrid>

      <div className="rounded-md border border-border bg-card p-4">
        <AdminTableToolbar
          searchValue={searchValue}
          onSearchChange={(nextValue) => {
            setSearchValue(nextValue)
            onSearch(nextValue)
          }}
          searchPlaceholder="Sipariş no, müşteri adı veya e-posta ara..."
          onRefresh={handleRefresh}
          isRefreshing={isRefreshing || isPending}
        />

        <AdminFilterBar onReset={resetFilters} className="mt-3">
          <AdminFilterChip
            active={currentStatus === 'PENDING_PAYMENT'}
            onClick={() =>
              setParam(
                'status',
                currentStatus === 'PENDING_PAYMENT' ? null : 'PENDING_PAYMENT'
              )
            }
            label="Ödeme Bekleyen"
          />
          <AdminFilterChip
            active={currentStatus === 'PROCESSING'}
            onClick={() =>
              setParam(
                'status',
                currentStatus === 'PROCESSING' ? null : 'PROCESSING'
              )
            }
            label="İşlemde"
          />
          <AdminFilterChip
            active={currentStatus === 'COMPLETED'}
            onClick={() =>
              setParam(
                'status',
                currentStatus === 'COMPLETED' ? null : 'COMPLETED'
              )
            }
            label="Tamamlanan"
          />
          <AdminFilterChip
            active={currentStatus === 'CANCELLED'}
            onClick={() =>
              setParam(
                'status',
                currentStatus === 'CANCELLED' ? null : 'CANCELLED'
              )
            }
            label="İptal"
          />
        </AdminFilterBar>
      </div>

      <div className="rounded-md border border-border bg-card p-4">
        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          <p className="text-sm font-semibold text-foreground">
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
            <Button
              onClick={applyBulkStatus}
              disabled={isPending || selectedIds.length === 0}
            >
              Uygula
            </Button>
          </div>
        </div>
      </div>

      <ResponsiveDataView
        mobile={
          orders.length === 0 ? (
            <div className="rounded-xl border border-border bg-background px-4 py-14 text-center text-sm text-muted-foreground">
              Sipariş bulunamadı.
            </div>
          ) : (
            <div className="space-y-3">
              <label className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={toggleAllVisible}
                />
                Bu sayfadaki tüm siparişleri seç
              </label>
              {orders.map((order) => (
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
                        <p className="font-semibold text-foreground truncate">
                          {order.orderNumber}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Kalem: {order.itemsCount}
                        </p>
                      </span>
                    </label>
                    <OrderStatusBadge status={order.status} />
                  </div>

                  <div className="mt-3 grid grid-cols-1 gap-2 text-xs text-muted-foreground">
                    <p>
                      Müşteri: {order.customerName} ({order.customerEmail || '-'})
                    </p>
                    <p>Tarih: {new Date(order.createdAt).toLocaleString('tr-TR')}</p>
                    <p className="font-semibold text-foreground">
                      Tutar:{' '}
                      {order.totalAmount.toLocaleString('tr-TR', {
                        style: 'currency',
                        currency: 'TRY',
                        maximumFractionDigits: 2
                      })}
                    </p>
                    <p>
                      Ödeme: <OrderStatusBadge status={order.paymentStatus} />{' '}
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
                        variant="ghost"
                        onClick={() => {
                          setDetailOrderId(order.id)
                          setDetailOpen(true)
                        }}
                        className="h-8 text-xs"
                      >
                        Detay
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => saveRowStatus(order.id)}
                        disabled={isPending}
                        className="h-8 text-xs"
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
          <AdminTableShell isLoading={isRefreshing}>
            <Table>
              <TableHeader>
                <TableRow className="border-b border-border bg-muted/40 hover:bg-muted/40">
                  <TableHead className="w-10">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleAllVisible}
                    />
                  </TableHead>
                  <TableHead>
                    <AdminTableHead>Sipariş</AdminTableHead>
                  </TableHead>
                  <TableHead>
                    <AdminTableHead>Müşteri</AdminTableHead>
                  </TableHead>
                  <TableHead>
                    <AdminTableHead>Tarih</AdminTableHead>
                  </TableHead>
                  <TableHead>
                    <AdminTableHead>Tutar</AdminTableHead>
                  </TableHead>
                  <TableHead>
                    <AdminTableHead>Durum</AdminTableHead>
                  </TableHead>
                  <TableHead>
                    <AdminTableHead>Ödeme</AdminTableHead>
                  </TableHead>
                  <TableHead className="text-right">
                    <AdminTableHead className="justify-end">Aksiyon</AdminTableHead>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((order) => (
                  <TableRow key={order.id} className="group transition-colors duration-150">
                    <TableCell>
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(order.id)}
                        onChange={() => toggleSelection(order.id)}
                      />
                    </TableCell>
                    <TableCell>
                      <p className="font-semibold text-sm text-foreground">
                        {order.orderNumber}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        Kalem: {order.itemsCount}
                      </p>
                    </TableCell>
                    <TableCell>
                      <p className="font-semibold text-sm text-foreground">
                        {order.customerName}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {order.customerEmail || '-'}
                      </p>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(order.createdAt).toLocaleString('tr-TR')}
                    </TableCell>
                    <TableCell className="font-semibold text-sm text-foreground">
                      {order.totalAmount.toLocaleString('tr-TR', {
                        style: 'currency',
                        currency: 'TRY',
                        maximumFractionDigits: 2
                      })}
                    </TableCell>
                    <TableCell>
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
                    </TableCell>
                    <TableCell>
                      <div className="space-y-2">
                        <OrderStatusBadge status={order.paymentStatus} />
                        <p className="text-[11px] text-muted-foreground">
                          {order.paymentMethod || '-'}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setDetailOrderId(order.id)
                            setDetailOpen(true)
                          }}
                          className="h-8 text-xs font-medium text-muted-foreground hover:text-foreground"
                        >
                          Detay
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => saveRowStatus(order.id)}
                          disabled={isPending}
                          className="h-8 text-xs font-medium"
                        >
                          {isPending ? (
                            <Loader2 size={12} className="mr-1 animate-spin" />
                          ) : null}
                          Kaydet
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}

                {orders.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="h-48 text-center">
                      <div className="flex flex-col items-center gap-2">
                        <ShoppingCart size={32} className="text-muted-foreground/50" />
                        <p className="text-sm font-medium text-muted-foreground">
                          Sipariş bulunamadı.
                        </p>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </AdminTableShell>
        }
      />

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
