'use client'

import { useEffect, useState, useTransition } from 'react'
import {
  HelpCircle,
  Inbox,
  MessageSquare,
  PackageSearch,
  Sparkles,
  Tag
} from 'lucide-react'
import { useDebouncedCallback } from 'use-debounce'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
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
import { AdminRowActions } from '@/components/admin/data-table/admin-row-actions'
import { AdminTableHead, adminTableHeaderRowClassName } from '@/components/admin/data-table/admin-table-head'
import { AdminTableShell } from '@/components/admin/data-table/admin-table-shell'
import { AdminTableToolbar } from '@/components/admin/data-table/admin-table-toolbar'
import type {
  CustomerRequestListItem,
  CustomerRequestsResult,
  CustomerRequestStatus
} from '@/lib/types/customer-requests'
import { RequestDetailDrawer } from './RequestDetailDrawer'

interface RequestsAdminClientProps {
  data: CustomerRequestsResult
}

export function RequestsAdminClient({ data }: RequestsAdminClientProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [isRefreshing, startRefresh] = useTransition()
  const [requests, setRequests] = useState<CustomerRequestListItem[]>(data.requests)
  const [searchValue, setSearchValue] = useState(searchParams.get('q') || '')
  const [detailRequestId, setDetailRequestId] = useState<number | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)

  const currentStatus = searchParams.get('status') || 'all'
  const currentType = searchParams.get('type') || 'all'

  useEffect(() => {
    setRequests(data.requests)
  }, [data.requests])

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
    if (name !== 'page') {
      params.delete('page')
    }
    router.push(`${pathname}?${params.toString()}`)
  }

  const onSearch = useDebouncedCallback((value: string) => {
    setParam('q', value.trim() || null)
  }, 250)

  const resetFilters = () => {
    setSearchValue('')
    router.push(pathname)
  }

  const handleRefresh = () => {
    startRefresh(() => {
      router.refresh()
    })
  }

  const handleRequestSaved = (patch: {
    id: number
    status: CustomerRequestStatus
  }) => {
    setRequests((prev) =>
      prev.map((request) =>
        request.id === patch.id ? { ...request, status: patch.status } : request
      )
    )
  }

  const totalPages = data.pagination.pages

  return (
    <div className="space-y-4">
      <AdminKpiGrid className="lg:grid-cols-5">
        <AdminKpiCard
          label="Açık Talep"
          value={data.kpis.openTotal}
          icon={<Inbox size={16} />}
        />
        <AdminKpiCard
          label="Bugün Yeni"
          value={data.kpis.newToday}
          tone="info"
          icon={<Sparkles size={16} />}
        />
        <AdminKpiCard
          label="Fiyat Talebi"
          value={data.kpis.priceRequestsOpen}
          tone="default"
          icon={<Tag size={16} />}
        />
        <AdminKpiCard
          label="Ürün Sorusu"
          value={data.kpis.productQuestionsOpen}
          tone="warning"
          icon={<HelpCircle size={16} />}
        />
        <AdminKpiCard
          label="Bulunamayan Ürün"
          value={data.kpis.missingProductsOpen}
          tone="danger"
          icon={<PackageSearch size={16} />}
        />
      </AdminKpiGrid>

      <div className="rounded-md border border-border bg-card p-4">
        <AdminTableToolbar
          searchValue={searchValue}
          onSearchChange={(nextValue) => {
            setSearchValue(nextValue)
            onSearch(nextValue)
          }}
          searchPlaceholder="İsim, e-posta, OEM, ürün adı veya not ara..."
          onRefresh={handleRefresh}
          isRefreshing={isRefreshing}
        />

        <AdminFilterBar onReset={resetFilters} className="mt-3">
          <AdminFilterChip
            active={currentStatus === 'NEW'}
            onClick={() =>
              setParam('status', currentStatus === 'NEW' ? null : 'NEW')
            }
            label="Yeni"
          />
          <AdminFilterChip
            active={currentStatus === 'IN_REVIEW'}
            onClick={() =>
              setParam('status', currentStatus === 'IN_REVIEW' ? null : 'IN_REVIEW')
            }
            label="İncelemede"
          />
          <AdminFilterChip
            active={currentStatus === 'RESOLVED'}
            onClick={() =>
              setParam('status', currentStatus === 'RESOLVED' ? null : 'RESOLVED')
            }
            label="Çözüldü"
          />
          <AdminFilterChip
            active={currentType === 'PRICE_REQUEST'}
            onClick={() =>
              setParam(
                'type',
                currentType === 'PRICE_REQUEST' ? null : 'PRICE_REQUEST'
              )
            }
            label="Fiyat Talebi"
          />
          <AdminFilterChip
            active={currentType === 'PRODUCT_QUESTION'}
            onClick={() =>
              setParam(
                'type',
                currentType === 'PRODUCT_QUESTION' ? null : 'PRODUCT_QUESTION'
              )
            }
            label="Ürün Sorusu"
          />
        </AdminFilterBar>

        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <Select
            value={searchParams.get('source') || 'all'}
            onValueChange={(value) => setParam('source', value)}
          >
            <SelectTrigger className="h-8 w-[195px] text-xs">
              <SelectValue placeholder="Kaynak" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tüm Kaynaklar</SelectItem>
              <SelectItem value="PRICE_MODAL">PRICE_MODAL</SelectItem>
              <SelectItem value="PRODUCT_FAQ_FORM">PRODUCT_FAQ_FORM</SelectItem>
              <SelectItem value="MISSING_PRODUCT_MODAL">
                MISSING_PRODUCT_MODAL
              </SelectItem>
            </SelectContent>
          </Select>
          <input
            type="date"
            defaultValue={searchParams.get('from') || ''}
            onChange={(event) => setParam('from', event.target.value || null)}
            className="h-8 rounded-md border border-border bg-background px-3 text-xs"
          />
          <input
            type="date"
            defaultValue={searchParams.get('to') || ''}
            onChange={(event) => setParam('to', event.target.value || null)}
            className="h-8 rounded-md border border-border bg-background px-3 text-xs"
          />
        </div>
      </div>

      <ResponsiveDataView
        mobile={
          requests.length > 0 ? (
            <div className="space-y-3">
              {requests.map((request) => (
                <MobileDataCard key={request.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-foreground">
                        #{request.id} - {request.requestType}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {request.source}
                      </p>
                    </div>
                    <StatusBadge status={request.status} />
                  </div>

                  <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                    <p className="font-medium text-foreground">
                      {request.name} ({request.email})
                    </p>
                    <p>
                      {request.partNameSnapshot ||
                        request.requestedSkuOrOem ||
                        'Genel talep'}
                    </p>
                    <p className="line-clamp-2">
                      {request.message ||
                        request.searchQuery ||
                        request.pageUrl ||
                        '-'}
                    </p>
                    <p>{new Date(request.createdAt).toLocaleString('tr-TR')}</p>
                  </div>

                  <div className="mt-3 flex justify-end">
                    <AdminRowActions
                      actions={[
                        {
                          label: 'Detay',
                          onClick: () => {
                            setDetailRequestId(request.id)
                            setDetailOpen(true)
                          }
                        }
                      ]}
                    />
                  </div>
                </MobileDataCard>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-border bg-background px-4 py-14 text-center text-sm text-muted-foreground">
              Filtrelere uyan talep bulunamadı.
            </div>
          )
        }
        desktop={
          <AdminTableShell isLoading={isRefreshing}>
            <Table>
              <TableHeader>
                <TableRow className={adminTableHeaderRowClassName()}>
                  <TableHead>
                    <AdminTableHead>Talep</AdminTableHead>
                  </TableHead>
                  <TableHead>
                    <AdminTableHead>Müşteri</AdminTableHead>
                  </TableHead>
                  <TableHead>
                    <AdminTableHead>Bağlam</AdminTableHead>
                  </TableHead>
                  <TableHead>
                    <AdminTableHead>Durum</AdminTableHead>
                  </TableHead>
                  <TableHead>
                    <AdminTableHead>Tarih</AdminTableHead>
                  </TableHead>
                  <TableHead className="text-right">
                    <AdminTableHead className="justify-end">Aksiyon</AdminTableHead>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {requests.length > 0 ? (
                  requests.map((request) => (
                    <TableRow
                      key={request.id}
                      className="group transition-colors duration-150"
                    >
                      <TableCell>
                        <p className="font-semibold text-sm text-foreground">
                          #{request.id}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {request.requestType}
                        </p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {request.source}
                        </p>
                      </TableCell>
                      <TableCell>
                        <p className="font-semibold text-sm text-foreground">
                          {request.name}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {request.email}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {request.phone || '-'}
                        </p>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        <p className="font-medium text-foreground">
                          {request.partNameSnapshot ||
                            request.requestedSkuOrOem ||
                            'Genel talep'}
                        </p>
                        <p className="mt-1 line-clamp-2">
                          {request.message ||
                            request.searchQuery ||
                            request.pageUrl ||
                            '-'}
                        </p>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={request.status} />
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(request.createdAt).toLocaleString('tr-TR')}
                      </TableCell>
                      <TableCell className="text-right">
                        <AdminRowActions
                          actions={[
                            {
                              label: 'Detay',
                              onClick: () => {
                                setDetailRequestId(request.id)
                                setDetailOpen(true)
                              }
                            }
                          ]}
                        />
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={6} className="h-48 text-center">
                      <div className="flex flex-col items-center gap-2">
                        <MessageSquare size={32} className="text-muted-foreground/50" />
                        <p className="text-sm font-medium text-muted-foreground">
                          Filtrelere uyan talep bulunamadı.
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

      {totalPages > 1 && (
        <Pagination
          currentPage={data.pagination.page}
          totalPages={totalPages}
          totalItems={data.pagination.total}
          itemsPerPage={data.pagination.limit}
          onPageChange={(page) => setParam('page', String(page))}
          compact
        />
      )}

      <RequestDetailDrawer
        requestId={detailRequestId}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onSaved={handleRequestSaved}
      />
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'NEW') {
    return (
      <Badge
        variant="outline"
        className="gap-1.5 text-[10px] bg-accent text-primary border-border"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-primary" />
        {status}
      </Badge>
    )
  }

  if (status === 'IN_REVIEW') {
    return (
      <Badge
        variant="outline"
        className="gap-1.5 text-[10px] bg-warning/10 text-warning border-warning/20"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-warning" />
        {status}
      </Badge>
    )
  }

  if (status === 'RESOLVED') {
    return (
      <Badge
        variant="outline"
        className="gap-1.5 text-[10px] bg-success/10 text-success border-success/20"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-success" />
        {status}
      </Badge>
    )
  }

  return (
    <Badge
      variant="outline"
      className="gap-1.5 text-[10px] bg-muted text-foreground border-border"
    >
      {status}
    </Badge>
  )
}
