'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { Boxes, PackageCheck, Tag, Link2 } from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useDebouncedCallback } from 'use-debounce'
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
import {
  AdminFilterBar,
  AdminFilterChip
} from '@/components/admin/data-table/admin-filter-chip'
import { AdminKpiCard, AdminKpiGrid } from '@/components/admin/data-table/admin-kpi-card'
import { AdminTableToolbar } from '@/components/admin/data-table/admin-table-toolbar'
import { DataTable } from '@/components/admin/data-table/data-table'
import { formatCurrency } from '@/lib/utils'
import { createCatalogProductColumns } from './catalog-product-columns'
import { CatalogProductDetailSheet } from './CatalogProductDetailSheet'
import type { AdminCatalogListResult } from '@/lib/types/admin-catalog'

interface Props {
  data: AdminCatalogListResult
}

const SORT_OPTIONS = [
  { value: 'updated', label: 'Son güncellenen' },
  { value: 'price_asc', label: 'Fiyat (artan)' },
  { value: 'price_desc', label: 'Fiyat (azalan)' },
  { value: 'stock', label: 'Stok (azalan)' }
]

export function CatalogProductsClient({ data }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [isRefreshing, startRefresh] = useTransition()
  const [searchValue, setSearchValue] = useState(searchParams.get('q') || '')
  const [detailId, setDetailId] = useState<string | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)

  const currentStatus = searchParams.get('status') || 'all'
  const currentStock = searchParams.get('stock') || 'all'
  const currentSort = searchParams.get('sort') || 'updated'

  useEffect(() => {
    setSearchValue(searchParams.get('q') || '')
  }, [searchParams])

  const setParam = (name: string, value?: string | null) => {
    const params = new URLSearchParams(searchParams.toString())
    if (!value || value === 'all') params.delete(name)
    else params.set(name, value)
    params.delete('page')
    router.push(`${pathname}?${params.toString()}`)
  }

  const onSearch = useDebouncedCallback((value: string) => {
    setParam('q', value.trim() || null)
  }, 300)

  const resetFilters = () => {
    setSearchValue('')
    router.push(pathname)
  }

  const goPage = (page: number) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('page', String(page))
    router.push(`${pathname}?${params.toString()}`)
  }

  const openDetail = (id: string) => {
    setDetailId(id)
    setDetailOpen(true)
  }

  const columns = useMemo(
    () => createCatalogProductColumns({ onDetails: openDetail }),
    []
  )

  return (
    <div className="space-y-4">
      <AdminKpiGrid>
        <AdminKpiCard
          label="Toplam Ürün"
          value={data.kpis.totalProducts.toLocaleString('tr-TR')}
          icon={<Boxes size={16} />}
        />
        <AdminKpiCard
          label="Stokta"
          value={data.kpis.inStock.toLocaleString('tr-TR')}
          tone="info"
          icon={<PackageCheck size={16} />}
        />
        <AdminKpiCard
          label="Fiyatlı"
          value={data.kpis.priced.toLocaleString('tr-TR')}
          icon={<Tag size={16} />}
        />
        <AdminKpiCard
          label="Eşleşmiş (parts)"
          value={data.kpis.enriched.toLocaleString('tr-TR')}
          tone="warning"
          icon={<Link2 size={16} />}
        />
      </AdminKpiGrid>

      <div className="rounded-md border border-border bg-card p-4">
        <AdminTableToolbar
          searchValue={searchValue}
          onSearchChange={(v) => {
            setSearchValue(v)
            onSearch(v)
          }}
          searchPlaceholder="Parça no, ürün adı veya OEM kodu ara..."
          onRefresh={() => startRefresh(() => router.refresh())}
          isRefreshing={isRefreshing}
          actions={
            <Select value={currentSort} onValueChange={(v) => setParam('sort', v)}>
              <SelectTrigger className="w-[170px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SORT_OPTIONS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />

        <AdminFilterBar onReset={resetFilters} className="mt-3">
          <AdminFilterChip
            active={currentStatus === 'ACTIVE'}
            onClick={() => setParam('status', currentStatus === 'ACTIVE' ? null : 'ACTIVE')}
            label="Aktif"
          />
          <AdminFilterChip
            active={currentStatus === 'DRAFT'}
            onClick={() => setParam('status', currentStatus === 'DRAFT' ? null : 'DRAFT')}
            label="Taslak"
          />
          <AdminFilterChip
            active={currentStatus === 'HIDDEN'}
            onClick={() => setParam('status', currentStatus === 'HIDDEN' ? null : 'HIDDEN')}
            label="Gizli"
          />
          <AdminFilterChip
            active={currentStock === 'in'}
            onClick={() => setParam('stock', currentStock === 'in' ? null : 'in')}
            label="Stokta"
          />
          <AdminFilterChip
            active={currentStock === 'out'}
            onClick={() => setParam('stock', currentStock === 'out' ? null : 'out')}
            label="Tedarik"
          />
        </AdminFilterBar>
      </div>

      <ResponsiveDataView
        mobile={
          data.products.length === 0 ? (
            <div className="rounded-lg border border-border bg-background px-4 py-14 text-center text-sm text-muted-foreground">
              Ürün bulunamadı.
            </div>
          ) : (
            <div className="space-y-3">
              {data.products.map((p) => (
                <MobileDataCard key={p.id}>
                  <div className="flex items-start justify-between gap-3">
                    <span className="min-w-0">
                      <p className="truncate font-semibold text-foreground">
                        {p.displayName}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        <span>{p.partNo}</span> · {p.brandName}
                      </p>
                    </span>
                    <span className="shrink-0 text-right text-sm font-semibold">
                      {p.priceIncVat != null ? formatCurrency(p.priceIncVat, 'TRY') : '—'}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                    <span>{p.inStock ? `Stok: ${p.totalStockQty}` : 'Tedarik edilebilir'}</span>
                    <button
                      type="button"
                      className="font-medium text-primary"
                      onClick={() => openDetail(p.id)}
                    >
                      Detay
                    </button>
                  </div>
                </MobileDataCard>
              ))}
            </div>
          )
        }
        desktop={
          <DataTable
            columns={columns}
            data={data.products}
            pagination={data.pagination}
            onPaginationChange={goPage}
            emptyMessage="Ürün bulunamadı."
          />
        }
      />

      <CatalogProductDetailSheet
        productId={detailId}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onSaved={() => router.refresh()}
      />
    </div>
  )
}
