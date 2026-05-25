'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useState, useTransition } from 'react'
import { useDebouncedCallback } from 'use-debounce'
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
import { AdminRowActions } from '@/components/admin/data-table/admin-row-actions'
import { AdminTableHead, adminTableHeaderRowClassName } from '@/components/admin/data-table/admin-table-head'
import { AdminTableShell } from '@/components/admin/data-table/admin-table-shell'
import { AdminTableToolbar } from '@/components/admin/data-table/admin-table-toolbar'
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
  const [searchValue, setSearchValue] = useState(searchParams.get('dq') || '')
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

  const handleSearchChange = (value: string) => {
    setSearchValue(value)
    onSearch(value)
  }

  const handleRefresh = () => {
    startTransition(() => {
      router.refresh()
    })
  }

  const goPage = (page: number) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('source', 'dinamik')
    params.set('dpage', String(page))
    router.push(`${pathname}?${params.toString()}`)
  }

  const currentBrand = searchParams.get('dbrand') || 'all'
  const numberLocale = locale === 'tr' ? 'tr-TR' : 'en-US'
  const isRefreshing = isPending && data.products.length > 0

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

      <div className="rounded-lg border border-border/60 bg-card p-4">
        <AdminTableToolbar
          searchValue={searchValue}
          onSearchChange={handleSearchChange}
          searchPlaceholder={t('searchPlaceholder')}
          onRefresh={handleRefresh}
          isRefreshing={isPending}
          showRefresh
          filters={
            <Select
              value={currentBrand}
              onValueChange={(value) =>
                setParam('dbrand', value === 'all' ? null : value)
              }
            >
              <SelectTrigger className="h-8 w-full rounded-md border-border/60 bg-muted/40 sm:w-auto sm:min-w-[220px]">
                <SelectValue placeholder={t('allQueryBrands')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('allQueryBrands')}</SelectItem>
                {data.options.queryBrands.map((brand) => (
                  <SelectItem key={brand} value={brand}>
                    {brand}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
      </div>

      <ResponsiveDataView
        mobile={
          data.products.length === 0 ? (
            <div className="rounded-lg border border-border bg-background px-6 py-14 text-center text-sm text-muted-foreground">
              {t('noRecords')}
            </div>
          ) : (
            <div className="space-y-3">
              {data.products.map((row, index) => (
                <MobileDataCard key={`${row.stockCode}-${row.partNo || '-'}-${index}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-mono text-xs font-semibold text-foreground">
                        {row.stockCode}
                      </p>
                      <p className="text-sm font-medium text-foreground">
                        {row.partNo || '-'}
                      </p>
                    </div>
                    <AdminRowActions
                      actions={[
                        {
                          label: t('detail'),
                          onClick: () => openDetail(row)
                        }
                      ]}
                    />
                  </div>

                  <div className="mt-3 space-y-1 text-xs text-muted-foreground">
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
          <AdminTableShell isRefreshing={isRefreshing}>
            <Table>
              <TableHeader>
                <TableRow className={adminTableHeaderRowClassName()}>
                  <TableHead><AdminTableHead>{t('columns.stockCode')}</AdminTableHead></TableHead>
                  <TableHead><AdminTableHead>{t('columns.partNo')}</AdminTableHead></TableHead>
                  <TableHead><AdminTableHead>{t('columns.stockName')}</AdminTableHead></TableHead>
                  <TableHead><AdminTableHead>{t('columns.brand')}</AdminTableHead></TableHead>
                  <TableHead><AdminTableHead>{t('columns.price')}</AdminTableHead></TableHead>
                  <TableHead><AdminTableHead>{t('columns.barcode')}</AdminTableHead></TableHead>
                  <TableHead><AdminTableHead>{t('columns.updated')}</AdminTableHead></TableHead>
                  <TableHead className="text-right"><AdminTableHead className="justify-end">{t('columns.action')}</AdminTableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.products.map((row, index) => (
                  <TableRow
                    key={`${row.stockCode}-${row.partNo || '-'}-${index}`}
                    className="group transition-colors duration-150"
                  >
                    <TableCell className="font-mono text-xs text-foreground">
                      {row.stockCode}
                    </TableCell>
                    <TableCell className="text-foreground">
                      {row.partNo || '-'}
                    </TableCell>
                    <TableCell className="max-w-[280px] text-foreground">
                      <p className="truncate" title={row.stockName || '-'}>
                        {row.stockName || '-'}
                      </p>
                    </TableCell>
                    <TableCell className="text-foreground">
                      {row.brand || '-'}
                    </TableCell>
                    <TableCell className="text-foreground">
                      {row.price == null
                        ? '-'
                        : row.price.toLocaleString(numberLocale, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2
                          })}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {row.barcode1 || row.barcode2 || row.barcode3 || '-'}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {row.updatedAt
                        ? new Date(row.updatedAt).toLocaleString(numberLocale)
                        : '-'}
                    </TableCell>
                    <TableCell className="text-right">
                      <AdminRowActions
                        actions={[
                          {
                            label: t('detail'),
                            onClick: () => openDetail(row)
                          }
                        ]}
                      />
                    </TableCell>
                  </TableRow>
                ))}

                {data.products.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={8}
                      className="px-6 py-14 text-center text-sm text-muted-foreground"
                    >
                      {t('noRecords')}
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
        compact
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
    <div className="rounded-lg border border-border bg-muted p-4 text-foreground">
      <p className="text-xs font-medium uppercase tracking-wider">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value.toLocaleString()}</p>
    </div>
  )
}
