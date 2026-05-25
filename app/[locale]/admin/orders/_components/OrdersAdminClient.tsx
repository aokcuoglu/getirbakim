'use client'

import { useMemo, useState } from 'react'
import { Calendar, ListFilter } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Pagination } from '@/components/ui/Pagination'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { AdminKpiCard, AdminKpiGrid } from '@/components/admin/data-table/admin-kpi-card'
import { AdminSurface } from '@/components/admin/admin-page-shell'
import { AdminTableShell } from '@/components/admin/data-table/admin-table-shell'
import { AdminTableToolbar } from '@/components/admin/data-table/admin-table-toolbar'
import { OrdersTable } from '@/components/admin/orders/orders-table'
import {
  MOCK_ORDERS,
  MOCK_ORDERS_KPIS,
  type ReferenceOrderStatus
} from '../_data/mock-orders'

const PAGE_SIZE = 5
const ALL_STATUS = 'all'

const REFERENCE_STATUSES: ReferenceOrderStatus[] = [
  'Accepted',
  'Pending',
  'Completed',
  'Rejected'
]

export function OrdersAdminClient() {
  const [searchValue, setSearchValue] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>(ALL_STATUS)
  const [currentPage, setCurrentPage] = useState(1)

  const filteredOrders = useMemo(() => {
    const query = searchValue.trim().toLowerCase()

    return MOCK_ORDERS.filter((order) => {
      const matchesStatus =
        statusFilter === ALL_STATUS || order.status === statusFilter

      const matchesSearch =
        !query ||
        order.productName.toLowerCase().includes(query) ||
        order.customerName.toLowerCase().includes(query) ||
        order.orderId.toLowerCase().includes(query)

      return matchesStatus && matchesSearch
    })
  }, [searchValue, statusFilter])

  const totalPages = Math.max(1, Math.ceil(filteredOrders.length / PAGE_SIZE))

  const paginatedOrders = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE
    return filteredOrders.slice(start, start + PAGE_SIZE)
  }, [filteredOrders, currentPage])

  const handleSearchChange = (value: string) => {
    setSearchValue(value)
    setCurrentPage(1)
  }

  const handleStatusChange = (value: string) => {
    setStatusFilter(value)
    setCurrentPage(1)
  }

  return (
    <div className="space-y-6">
      <AdminKpiGrid>
        <AdminKpiCard
          label="Toplam Sipariş"
          value={MOCK_ORDERS_KPIS.totalOrders}
          subtitle="Son 365 gün"
        />
        <AdminKpiCard
          label="Yeni Siparişler"
          value={MOCK_ORDERS_KPIS.newOrders}
          tone="warning"
          subtitle="Son 365 gün"
        />
        <AdminKpiCard
          label="Tamamlanan"
          value={MOCK_ORDERS_KPIS.completedOrders}
          tone="success"
          subtitle="Son 365 gün"
        />
        <AdminKpiCard
          label="İptal Edilen"
          value={MOCK_ORDERS_KPIS.cancelledOrders}
          tone="danger"
          subtitle="Son 365 gün"
        />
      </AdminKpiGrid>

      <AdminSurface className="space-y-0 p-0">
        <div className="border-b border-border p-4 sm:px-6">
          <AdminTableToolbar
            searchValue={searchValue}
            onSearchChange={handleSearchChange}
            searchPlaceholder="İsim, sipariş no ile ara..."
            showRefresh={false}
            filters={
              <>
                <Select value={statusFilter} onValueChange={handleStatusChange}>
                  <SelectTrigger
                    className="h-8 w-[140px] rounded-md border-border bg-background"
                    aria-label="Duruma göre filtrele"
                  >
                    <ListFilter className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
                    <SelectValue placeholder="Tüm Durumlar" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_STATUS}>Tüm Durumlar</SelectItem>
                    {REFERENCE_STATUSES.map((status) => (
                      <SelectItem key={status} value={status}>
                        {status}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  className="h-8 rounded-md border-border bg-background px-3 text-sm font-normal"
                  aria-label="Tarih aralığı seç"
                >
                  <Calendar className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="hidden sm:inline">
                    01 Oca 2024 – 31 Ara 2024
                  </span>
                  <span className="sm:hidden">Tarih</span>
                </Button>
              </>
            }
            onAdvancedFilter={() => undefined}
            advancedFilterLabel="Daha Fazla Filtre"
          />
        </div>

        <AdminTableShell className="rounded-none border-0 shadow-none">
          <OrdersTable orders={paginatedOrders} />
        </AdminTableShell>

        <div className="border-t border-border px-4 py-3 sm:px-6">
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            totalItems={filteredOrders.length}
            itemsPerPage={PAGE_SIZE}
            onPageChange={setCurrentPage}
            showItemCount={false}
            previousLabel="Önceki"
            nextLabel="Sonraki"
            compact
          />
        </div>
      </AdminSurface>
    </div>
  )
}
