'use client'

import { useState, useEffect } from 'react'
import { useDebouncedCallback } from 'use-debounce'
import { Calendar, ListFilter } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { AdminKpiCard, AdminKpiGrid } from '@/components/admin/data-table/admin-kpi-card'

import { AdminTableToolbar } from '@/components/admin/data-table/admin-table-toolbar'
import { DataTable } from '@/components/admin/data-table/data-table'
import { ORDER_STATUS_LABELS } from '@/components/admin/orders/order-status-badge'
import { createOrderColumns } from '@/components/admin/orders/order-columns'
import type { AdminOrdersResult, AdminOrderStatus } from '@/lib/types/admin-orders'
import { getAdminOrders } from '@/lib/actions/admin-orders'

const ALL_STATUS = 'all' as const
const ORDER_STATUSES = Object.keys(ORDER_STATUS_LABELS) as AdminOrderStatus[]

interface OrdersAdminClientProps {
  initialData: AdminOrdersResult
}

export function OrdersAdminClient({ initialData }: OrdersAdminClientProps) {
  const [data, setData] = useState<AdminOrdersResult>(initialData)
  const [isLoading, setIsLoading] = useState(false)
  const [searchValue, setSearchValue] = useState(initialData.filters.q)
  const [statusFilter, setStatusFilter] = useState<'all' | AdminOrderStatus>(
    (initialData.filters.status as 'all' | AdminOrderStatus) || ALL_STATUS
  )

  useEffect(() => {
    setData(initialData)
    setSearchValue(initialData.filters.q)
    setStatusFilter((initialData.filters.status as 'all' | AdminOrderStatus) || ALL_STATUS)
  }, [initialData])

  function load(params: { page?: number; q?: string; status?: 'all' | AdminOrderStatus }) {
    setIsLoading(true)
    getAdminOrders({
      page: params.page || 1,
      limit: 20,
      q: params.q ?? searchValue,
      status: params.status === ALL_STATUS ? undefined : (params.status ?? (statusFilter === ALL_STATUS ? undefined : statusFilter)),
    })
      .then((result) => setData(result))
      .finally(() => setIsLoading(false))
  }

  const debouncedSearch = useDebouncedCallback((value: string) => {
    load({ q: value, page: 1 })
  }, 350)

  const handleSearchChange = (value: string) => {
    setSearchValue(value)
    debouncedSearch(value)
  }

  const handleStatusChange = (value: string) => {
    const typed = value as 'all' | AdminOrderStatus
    setStatusFilter(typed)
    load({ status: typed, page: 1 })
  }

  const handlePageChange = (page: number) => {
    load({ page })
  }

  const columns = createOrderColumns({ onDetails: () => undefined })

  const { orders, pagination, kpis } = data

  return (
    <div className="space-y-4">
      <AdminKpiGrid>
        <AdminKpiCard label="Toplam Sipariş" value={kpis.totalOrders} subtitle="Yüklenen set" tone="default" />
        <AdminKpiCard label="Beklemede" value={kpis.pendingOrders} subtitle="Ödeme bekliyor" tone="warning" />
        <AdminKpiCard label="Tamamlanan" value={kpis.completedOrders} subtitle="Teslimat tamamlandı" tone="success" />
        <AdminKpiCard label="İptal / Hatalı" value={kpis.cancelledOrders} subtitle="İptal / Başarısız / İadeli" tone="danger" />
      </AdminKpiGrid>

      <div className="rounded-md border border-border bg-card p-4">
        <AdminTableToolbar
          searchValue={searchValue}
          onSearchChange={handleSearchChange}
          searchPlaceholder="Sipariş no, müşteri adı ile ara..."
          showRefresh={true}
          onRefresh={() => load({})}
          isRefreshing={isLoading}
          isSearchLoading={isLoading}
          filters={
            <>
              <Select value={statusFilter} onValueChange={handleStatusChange}>
                <SelectTrigger className="h-8 w-[180px] rounded-md border-border bg-background">
                  <ListFilter className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
                  <SelectValue placeholder="Tüm Durumlar" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_STATUS}>Tüm Durumlar</SelectItem>
                  {ORDER_STATUSES.map((status) => (
                    <SelectItem key={status} value={status}>
                      {ORDER_STATUS_LABELS[status] || status}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" size="default" disabled>
                <Calendar className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
                Tarih
              </Button>
            </>
          }
          onAdvancedFilter={() => undefined}
          advancedFilterLabel="Daha Fazla Filtre"
        />
      </div>

      <DataTable
        columns={columns}
        data={orders}
        isLoading={isLoading}
        pagination={pagination}
        onPaginationChange={handlePageChange}
        emptyMessage="Sipariş bulunamadı."
      />
    </div>
  )
}
