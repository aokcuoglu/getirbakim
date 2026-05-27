'use client'

import { useState, useEffect } from 'react'
import { useDebouncedCallback } from 'use-debounce'
import {
  HelpCircle,
  Inbox,
  MessageSquare,
  PackageSearch,
  Sparkles,
  Tag
} from 'lucide-react'
import { DataTable } from '@/components/admin/data-table/data-table'
import { AdminKpiCard, AdminKpiGrid } from '@/components/admin/data-table/admin-kpi-card'
import { AdminFilterBar, AdminFilterChip } from '@/components/admin/data-table/admin-filter-chip'
import { AdminTableToolbar } from '@/components/admin/data-table/admin-table-toolbar'
import { createRequestColumns } from './request-columns'
import type {
  CustomerRequestsResult,
  CustomerRequestStatus,
  CustomerRequestType,
  CustomerRequestSource,
} from '@/lib/types/customer-requests'
import { getAdminCustomerRequests } from '@/lib/actions/customer-requests'
import { RequestDetailDrawer } from './RequestDetailDrawer'

interface RequestsAdminClientProps {
  data: CustomerRequestsResult
}

const STATUS_LABELS: Record<string, string> = {
  NEW: 'Yeni',
  IN_REVIEW: 'İncelemede',
  RESOLVED: 'Çözüldü',
  ARCHIVED: 'Arşivlendi',
}

const TYPE_LABELS: Record<string, string> = {
  PRICE_REQUEST: 'Fiyat Talebi',
  PRODUCT_QUESTION: 'Ürün Sorusu',
  MISSING_PRODUCT: 'Bulunamayan Ürün',
  FITMENT_CHECK: 'Uygunluk Kontrolü',
}

export function RequestsAdminClient({ data: initialData }: RequestsAdminClientProps) {
  const [data, setData] = useState<CustomerRequestsResult>(initialData)
  const [isLoading, setIsLoading] = useState(false)
  const [searchValue, setSearchValue] = useState(initialData.filters.q)
  const [statusFilter, setStatusFilter] = useState<CustomerRequestStatus | 'all'>(
    (initialData.filters.status as CustomerRequestStatus | 'all') || 'all'
  )
  const [typeFilter, setTypeFilter] = useState<CustomerRequestType | 'all'>(
    (initialData.filters.type as CustomerRequestType | 'all') || 'all'
  )
  const [sourceFilter, setSourceFilter] = useState<CustomerRequestSource | 'all'>(
    (initialData.filters.source as CustomerRequestSource | 'all') || 'all'
  )
  const [detailRequestId, setDetailRequestId] = useState<number | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)

  useEffect(() => {
    setData(initialData)
    setSearchValue(initialData.filters.q)
    setStatusFilter((initialData.filters.status as CustomerRequestStatus | 'all') || 'all')
    setTypeFilter((initialData.filters.type as CustomerRequestType | 'all') || 'all')
    setSourceFilter((initialData.filters.source as CustomerRequestSource | 'all') || 'all')
  }, [initialData])

  function load(params: {
    page?: number
    q?: string
    status?: CustomerRequestStatus | 'all'
    type?: CustomerRequestType | 'all'
    source?: CustomerRequestSource | 'all'
  }) {
    setIsLoading(true)
    getAdminCustomerRequests({
      page: params.page || 1,
      limit: 20,
      q: params.q ?? searchValue,
      status: params.status === 'all' ? undefined : (params.status ?? (statusFilter === 'all' ? undefined : statusFilter)),
      type: params.type === 'all' ? undefined : (params.type ?? (typeFilter === 'all' ? undefined : typeFilter)),
      source: params.source === 'all' ? undefined : (params.source ?? (sourceFilter === 'all' ? undefined : sourceFilter)),
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

  const handleStatusChange = (value: CustomerRequestStatus | 'all') => {
    setStatusFilter(value)
    load({ status: value, page: 1 })
  }

  const handleTypeChange = (value: CustomerRequestType | 'all') => {
    setTypeFilter(value)
    load({ type: value, page: 1 })
  }

  const handleSourceChange = (value: CustomerRequestSource | 'all') => {
    setSourceFilter(value)
    load({ source: value, page: 1 })
  }

  const handlePageChange = (page: number) => {
    load({ page })
  }

  const handleRequestSaved = (patch: { id: number; status: CustomerRequestStatus }) => {
    setData((prev) => ({
      ...prev,
      requests: prev.requests.map((request) =>
        request.id === patch.id ? { ...request, status: patch.status } : request
      ),
    }))
  }

  const columns = createRequestColumns({
    onDetails: (id) => {
      setDetailRequestId(id)
      setDetailOpen(true)
    },
  })

  const { requests, pagination, kpis } = data

  return (
    <div className="space-y-4">
      <AdminKpiGrid className="lg:grid-cols-5">
        <AdminKpiCard label="Açık Talep" value={kpis.openTotal} icon={<Inbox size={16} />} />
        <AdminKpiCard label="Bugün Yeni" value={kpis.newToday} tone="info" icon={<Sparkles size={16} />} />
        <AdminKpiCard label="Fiyat Talebi" value={kpis.priceRequestsOpen} tone="default" icon={<Tag size={16} />} />
        <AdminKpiCard label="Ürün Sorusu" value={kpis.productQuestionsOpen} tone="warning" icon={<HelpCircle size={16} />} />
        <AdminKpiCard label="Bulunamayan Ürün" value={kpis.missingProductsOpen} tone="danger" icon={<PackageSearch size={16} />} />
      </AdminKpiGrid>

      <div className="rounded-md border border-border bg-card p-4">
        <AdminTableToolbar
          searchValue={searchValue}
          onSearchChange={handleSearchChange}
          searchPlaceholder="İsim, e-posta, OEM, ürün adı veya not ara..."
          showRefresh={true}
          onRefresh={() => load({})}
          isRefreshing={isLoading}
          isSearchLoading={isLoading}
        />

        <AdminFilterBar onReset={() => load({ status: 'all', type: 'all', source: 'all', page: 1 })} className="mt-3">
          <AdminFilterChip
            active={statusFilter === 'NEW'}
            onClick={() => handleStatusChange(statusFilter === 'NEW' ? 'all' : 'NEW')}
            label="Yeni"
          />
          <AdminFilterChip
            active={statusFilter === 'IN_REVIEW'}
            onClick={() => handleStatusChange(statusFilter === 'IN_REVIEW' ? 'all' : 'IN_REVIEW')}
            label="İncelemede"
          />
          <AdminFilterChip
            active={statusFilter === 'RESOLVED'}
            onClick={() => handleStatusChange(statusFilter === 'RESOLVED' ? 'all' : 'RESOLVED')}
            label="Çözüldü"
          />
          <AdminFilterChip
            active={typeFilter === 'PRICE_REQUEST'}
            onClick={() => handleTypeChange(typeFilter === 'PRICE_REQUEST' ? 'all' : 'PRICE_REQUEST')}
            label="Fiyat Talebi"
          />
          <AdminFilterChip
            active={typeFilter === 'PRODUCT_QUESTION'}
            onClick={() => handleTypeChange(typeFilter === 'PRODUCT_QUESTION' ? 'all' : 'PRODUCT_QUESTION')}
            label="Ürün Sorusu"
          />
        </AdminFilterBar>
      </div>

      <DataTable
        columns={columns}
        data={requests}
        isLoading={isLoading}
        pagination={pagination}
        onPaginationChange={handlePageChange}
        emptyMessage="Talep bulunamadı."
      />

      <RequestDetailDrawer
        requestId={detailRequestId}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onSaved={handleRequestSaved}
      />
    </div>
  )
}
