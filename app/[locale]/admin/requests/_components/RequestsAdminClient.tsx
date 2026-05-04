'use client'

import { type ReactNode, useMemo, useState } from 'react'
import { Filter, RefreshCw, Search } from 'lucide-react'
import { useDebouncedCallback } from 'use-debounce'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
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
import type {
  CustomerRequestListItem,
  CustomerRequestsResult
} from '@/lib/types/customer-requests'
import { RequestDetailDrawer } from './RequestDetailDrawer'

interface RequestsAdminClientProps {
  data: CustomerRequestsResult
}

export function RequestsAdminClient({ data }: RequestsAdminClientProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [detailRequestId, setDetailRequestId] = useState<number | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)

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
  }, 300)

  const totalPages = data.pagination.pages

  const rows = useMemo(() => data.requests, [data.requests])

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
        <KpiCard label="Açık Talep" value={data.kpis.openTotal} tone="slate" />
        <KpiCard label="Bugün Yeni" value={data.kpis.newToday} tone="blue" />
        <KpiCard
          label="Fiyat Talebi"
          value={data.kpis.priceRequestsOpen}
          tone="emerald"
        />
        <KpiCard
          label="Ürün Sorusu"
          value={data.kpis.productQuestionsOpen}
          tone="amber"
        />
        <KpiCard
          label="Bulunamayan Ürün"
          value={data.kpis.missingProductsOpen}
          tone="rose"
        />
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="relative w-full max-w-lg">
            <Search
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
            />
            <input
              defaultValue={searchParams.get('q') || ''}
              onChange={(event) => onSearch(event.target.value)}
              placeholder="İsim, e-posta, OEM, ürün adı veya not ara..."
              className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <FilterPill label="Tip">
              <Select
                value={searchParams.get('type') || 'all'}
                onValueChange={(value) => setParam('type', value)}
              >
                <SelectTrigger className="h-7 w-[170px] border-none bg-transparent px-1 text-xs text-[#101828] shadow-none focus-visible:ring-0">
                  <SelectValue placeholder="Tümü" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tümü</SelectItem>
                  <SelectItem value="PRICE_REQUEST">PRICE_REQUEST</SelectItem>
                  <SelectItem value="PRODUCT_QUESTION">PRODUCT_QUESTION</SelectItem>
                  <SelectItem value="MISSING_PRODUCT">MISSING_PRODUCT</SelectItem>
                </SelectContent>
              </Select>
            </FilterPill>

            <FilterPill label="Durum">
              <Select
                value={searchParams.get('status') || 'all'}
                onValueChange={(value) => setParam('status', value)}
              >
                <SelectTrigger className="h-7 w-[150px] border-none bg-transparent px-1 text-xs text-[#101828] shadow-none focus-visible:ring-0">
                  <SelectValue placeholder="Tümü" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tümü</SelectItem>
                  <SelectItem value="NEW">NEW</SelectItem>
                  <SelectItem value="IN_REVIEW">IN_REVIEW</SelectItem>
                  <SelectItem value="RESOLVED">RESOLVED</SelectItem>
                  <SelectItem value="ARCHIVED">ARCHIVED</SelectItem>
                </SelectContent>
              </Select>
            </FilterPill>

            <FilterPill label="Kaynak">
              <Select
                value={searchParams.get('source') || 'all'}
                onValueChange={(value) => setParam('source', value)}
              >
                <SelectTrigger className="h-7 w-[195px] border-none bg-transparent px-1 text-xs text-[#101828] shadow-none focus-visible:ring-0">
                  <SelectValue placeholder="Tümü" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tümü</SelectItem>
                  <SelectItem value="PRICE_MODAL">PRICE_MODAL</SelectItem>
                  <SelectItem value="PRODUCT_FAQ_FORM">PRODUCT_FAQ_FORM</SelectItem>
                  <SelectItem value="MISSING_PRODUCT_MODAL">
                    MISSING_PRODUCT_MODAL
                  </SelectItem>
                </SelectContent>
              </Select>
            </FilterPill>

            <input
              type="date"
              defaultValue={searchParams.get('from') || ''}
              onChange={(event) => setParam('from', event.target.value || null)}
              className="rounded-lg border border-gray-200 px-3 py-2 text-xs"
            />
            <input
              type="date"
              defaultValue={searchParams.get('to') || ''}
              onChange={(event) => setParam('to', event.target.value || null)}
              className="rounded-lg border border-gray-200 px-3 py-2 text-xs"
            />

            <Button variant="outline" onClick={() => router.refresh()}>
              <RefreshCw size={14} className="mr-2" />
              Yenile
            </Button>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-3 md:p-0 md:border-0 md:bg-transparent">
        <ResponsiveDataView
          mobile={
            rows.length > 0 ? (
              <div className="space-y-3">
                {rows.map((request) => (
                  <MobileDataCard key={request.id}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-[#101828]">
                          #{request.id} - {request.requestType}
                        </p>
                        <p className="text-xs text-gray-500 truncate">
                          {request.source}
                        </p>
                      </div>
                      <StatusBadge status={request.status} />
                    </div>

                    <div className="mt-3 text-xs text-gray-600 space-y-1">
                      <p className="font-medium text-[#101828]">
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
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setDetailRequestId(request.id)
                          setDetailOpen(true)
                        }}
                      >
                        Detay
                      </Button>
                    </div>
                  </MobileDataCard>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-gray-200 bg-white px-4 py-10 text-center text-sm text-gray-500">
                Filtrelere uyan talep bulunamadı.
              </div>
            )
          }
          desktop={
            <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-gray-50/80 text-left text-[11px] font-bold uppercase tracking-wider text-gray-500">
                    <th className="px-4 py-3">Talep</th>
                    <th className="px-4 py-3">Müşteri</th>
                    <th className="px-4 py-3">Bağlam</th>
                    <th className="px-4 py-3">Durum</th>
                    <th className="px-4 py-3">Tarih</th>
                    <th className="px-4 py-3 text-right">Aksiyon</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rows.length > 0 ? (
                    rows.map((request) => (
                      <RequestRow
                        key={request.id}
                        request={request}
                        onOpen={() => {
                          setDetailRequestId(request.id)
                          setDetailOpen(true)
                        }}
                      />
                    ))
                  ) : (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-4 py-10 text-center text-sm text-gray-500"
                      >
                        Filtrelere uyan talep bulunamadı.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          }
        />
      </div>

      {totalPages > 1 && (
        <Pagination
          currentPage={data.pagination.page}
          totalPages={totalPages}
          totalItems={data.pagination.total}
          itemsPerPage={data.pagination.limit}
          onPageChange={(page) => setParam('page', String(page))}
        />
      )}

      <RequestDetailDrawer
        requestId={detailRequestId}
        open={detailOpen}
        onOpenChange={setDetailOpen}
      />
    </div>
  )
}

function RequestRow({
  request,
  onOpen
}: {
  request: CustomerRequestListItem
  onOpen: () => void
}) {
  return (
    <tr className="hover:bg-gray-50/60">
      <td className="px-4 py-3 align-top">
        <p className="font-semibold text-[#101828]">#{request.id}</p>
        <p className="text-xs text-gray-500">{request.requestType}</p>
        <p className="mt-1 text-xs text-gray-400">{request.source}</p>
      </td>
      <td className="px-4 py-3 align-top">
        <p className="font-semibold text-[#101828]">{request.name}</p>
        <p className="text-xs text-gray-500">{request.email}</p>
        <p className="text-xs text-gray-400">{request.phone || '-'}</p>
      </td>
      <td className="px-4 py-3 align-top text-xs text-gray-600">
        <p className="font-medium text-[#101828]">
          {request.partNameSnapshot || request.requestedSkuOrOem || 'Genel talep'}
        </p>
        <p className="mt-1 line-clamp-2">
          {request.message || request.searchQuery || request.pageUrl || '-'}
        </p>
      </td>
      <td className="px-4 py-3 align-top">
        <StatusBadge status={request.status} />
      </td>
      <td className="px-4 py-3 align-top text-gray-600">
        {new Date(request.createdAt).toLocaleString('tr-TR')}
      </td>
      <td className="px-4 py-3 align-top text-right">
        <Button size="sm" variant="outline" onClick={onOpen}>
          Detay
        </Button>
      </td>
    </tr>
  )
}

function FilterPill({
  label,
  children
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs text-gray-600">
      <Filter size={12} />
      <span>{label}</span>
      {children}
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const className =
    status === 'NEW'
      ? 'bg-blue-50 text-blue-700'
      : status === 'IN_REVIEW'
        ? 'bg-amber-50 text-amber-700'
        : status === 'RESOLVED'
          ? 'bg-emerald-50 text-emerald-700'
          : 'bg-slate-100 text-slate-700'

  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${className}`}>
      {status}
    </span>
  )
}

function KpiCard({
  label,
  value,
  tone
}: {
  label: string
  value: number
  tone: 'slate' | 'blue' | 'emerald' | 'amber' | 'rose'
}) {
  const tones = {
    slate: 'from-slate-50 to-slate-100 text-slate-900',
    blue: 'from-blue-50 to-blue-100 text-blue-900',
    emerald: 'from-emerald-50 to-emerald-100 text-emerald-900',
    amber: 'from-amber-50 to-amber-100 text-amber-900',
    rose: 'from-rose-50 to-rose-100 text-rose-900'
  }

  return (
    <div className={`rounded-xl border border-gray-200 bg-gradient-to-br p-4 ${tones[tone]}`}>
      <p className="text-xs font-semibold uppercase tracking-wide opacity-70">
        {label}
      </p>
      <p className="mt-3 text-3xl font-bold">{value}</p>
    </div>
  )
}
