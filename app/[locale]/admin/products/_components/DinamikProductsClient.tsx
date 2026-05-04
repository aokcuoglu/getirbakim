'use client'

import { Loader2, RefreshCw, Search } from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useState, useTransition } from 'react'
import { useDebouncedCallback } from 'use-debounce'
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
import type { AdminDinamikProductListItem, AdminDinamikProductsResult } from '@/lib/types/admin-products'
import { DinamikProductDetailDrawer } from './DinamikProductDetailDrawer'
import { useTranslations } from 'next-intl'

interface DinamikProductsClientProps {
  data: AdminDinamikProductsResult
  locale: string
}

export function DinamikProductsClient({ data, locale }: DinamikProductsClientProps) {
  const t = useTranslations('DinamikProducts')
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailProduct, setDetailProduct] = useState<AdminDinamikProductListItem | null>(null)

  const setParam = (name: string, value?: string | null) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('source', 'dinamik')

    if (!value) {
      params.delete(name)
    } else {
      params.set(name, value)
    }

    if (name !== 'dpage') {
      params.delete('dpage')
    }

    router.push(`${pathname}?${params.toString()}`)
  }

  const onSearch = useDebouncedCallback((term: string) => {
    setParam('dq', term.trim() || null)
  }, 300)

  const goPage = (page: number) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('source', 'dinamik')
    params.set('dpage', String(page))
    router.push(`${pathname}?${params.toString()}`)
  }

  const currentSearch = searchParams.get('dq') || ''
  const currentBrand = searchParams.get('dbrand') || 'all'
  const numberLocale = locale === 'tr' ? 'tr-TR' : 'en-US'

  const openDetail = (product: AdminDinamikProductListItem) => {
    setDetailProduct(product)
    setDetailOpen(true)
  }

  const onPartCreated = (partId: string) => {
    const params = new URLSearchParams()
    params.set('source', 'public')
    params.set('q', partId)
    router.push(`${pathname}?${params.toString()}`)
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <DinamikKpiCard
          label={t('kpi.totalRows')}
          value={data.kpis.totalProducts}
        />
        <DinamikKpiCard
          label={t('kpi.distinctQueryBrands')}
          value={data.kpis.distinctBrands}
        />
        <DinamikKpiCard
          label={t('kpi.rowsWithPrice')}
          value={data.kpis.pricedRows}
        />
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex w-full flex-1 flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative w-full max-w-xl">
              <Search
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
              />
              <input
                defaultValue={currentSearch}
                onChange={(event) => onSearch(event.target.value)}
                placeholder={t('searchPlaceholder')}
                className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm"
              />
            </div>

            <Select
              value={currentBrand}
              onValueChange={(value) =>
                setParam('dbrand', value === 'all' ? null : value)
              }
            >
              <SelectTrigger className="h-10 w-full sm:w-auto sm:min-w-[220px] bg-white text-sm text-gray-700">
                <SelectValue
                  placeholder={t('allQueryBrands')}
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  {t('allQueryBrands')}
                </SelectItem>
              {data.options.queryBrands.map((brand) => (
                <SelectItem key={brand} value={brand}>
                  {brand}
                </SelectItem>
              ))}
              </SelectContent>
            </Select>
          </div>

          <Button
            type="button"
            variant="outline"
            onClick={() => startTransition(() => router.refresh())}
            disabled={isPending}
          >
            {isPending ? (
              <Loader2 size={14} className="mr-2 animate-spin" />
            ) : (
              <RefreshCw size={14} className="mr-2" />
            )}
            {t('refresh')}
          </Button>
        </div>
      </div>

      <ResponsiveDataView
        mobile={
          data.products.length === 0 ? (
            <div className="rounded-xl border border-gray-200 bg-white px-6 py-14 text-center text-sm text-gray-500">
              {t('noRecords')}
            </div>
          ) : (
            <div className="space-y-3">
              {data.products.map((row, index) => (
                <MobileDataCard key={`${row.stockCode}-${row.partNo || '-'}-${index}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-mono text-xs font-semibold text-[#101828]">
                        {row.stockCode}
                      </p>
                      <p className="text-sm font-medium text-gray-700">
                        {row.partNo || '-'}
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => openDetail(row)}
                    >
                      {t('detail')}
                    </Button>
                  </div>

                  <div className="mt-3 space-y-1 text-xs text-gray-600">
                    <p className="truncate" title={row.stockName || '-'}>
                      {row.stockName || '-'}
                    </p>
                    <p>{t('columns.brand')}: {row.brand || '-'}</p>
                    <p>
                      {t('columns.price')}:{' '}
                      {row.price == null
                        ? '-'
                        : row.price.toLocaleString(numberLocale, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2
                          })}
                    </p>
                    <p>{t('columns.barcode')}: {row.barcode1 || row.barcode2 || row.barcode3 || '-'}</p>
                    <p>
                      {t('columns.updated')}:{' '}
                      {row.updatedAt
                        ? new Date(row.updatedAt).toLocaleString(numberLocale)
                        : '-'}
                    </p>
                  </div>
                </MobileDataCard>
              ))}
            </div>
          )
        }
        desktop={
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-gray-50/80 text-left text-[11px] font-bold uppercase tracking-wider text-gray-500">
                  <th className="px-4 py-3">{t('columns.stockCode')}</th>
                  <th className="px-4 py-3">{t('columns.partNo')}</th>
                  <th className="px-4 py-3">{t('columns.stockName')}</th>
                  <th className="px-4 py-3">{t('columns.brand')}</th>
                  <th className="px-4 py-3">{t('columns.price')}</th>
                  <th className="px-4 py-3">{t('columns.barcode')}</th>
                  <th className="px-4 py-3">{t('columns.updated')}</th>
                  <th className="px-4 py-3 text-right">{t('columns.action')}</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-gray-100 text-sm">
                {data.products.map((row, index) => (
                  <tr
                    key={`${row.stockCode}-${row.partNo || '-'}-${index}`}
                    className="hover:bg-gray-50/60"
                  >
                    <td className="px-4 py-3 align-top font-mono text-xs text-[#101828]">
                      {row.stockCode}
                    </td>
                    <td className="px-4 py-3 align-top text-gray-700">
                      {row.partNo || '-'}
                    </td>
                    <td className="max-w-[280px] px-4 py-3 align-top text-gray-700">
                      <p className="truncate" title={row.stockName || '-'}>
                        {row.stockName || '-'}
                      </p>
                    </td>
                    <td className="px-4 py-3 align-top text-gray-700">
                      {row.brand || '-'}
                    </td>
                    <td className="px-4 py-3 align-top text-gray-700">
                      {row.price == null
                        ? '-'
                        : row.price.toLocaleString(numberLocale, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2
                          })}
                    </td>
                    <td className="px-4 py-3 align-top text-xs text-gray-600">
                      {row.barcode1 || row.barcode2 || row.barcode3 || '-'}
                    </td>
                    <td className="px-4 py-3 align-top text-xs text-gray-600">
                      {row.updatedAt
                        ? new Date(row.updatedAt).toLocaleString(numberLocale)
                        : '-'}
                    </td>
                    <td className="px-4 py-3 align-top text-right">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => openDetail(row)}
                      >
                        {t('detail')}
                      </Button>
                    </td>
                  </tr>
                ))}

                {data.products.length === 0 && (
                  <tr>
                    <td
                      colSpan={8}
                      className="px-6 py-14 text-center text-sm text-gray-500"
                    >
                      {t('noRecords')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        }
      />

      <Pagination
        currentPage={data.pagination.page}
        totalPages={data.pagination.pages}
        totalItems={data.pagination.total}
        itemsPerPage={data.pagination.limit}
        onPageChange={goPage}
      />

      <DinamikProductDetailDrawer
        open={detailOpen}
        onOpenChange={setDetailOpen}
        product={detailProduct}
        options={{
          brands: data.options.brands,
          categories: data.options.categories
        }}
        onCreated={onPartCreated}
      />
    </div>
  )
}

function DinamikKpiCard({
  label,
  value
}: {
  label: string
  value: number
}) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50 p-4 text-slate-700">
      <p className="text-xs font-medium uppercase tracking-wider">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value.toLocaleString()}</p>
    </div>
  )
}
