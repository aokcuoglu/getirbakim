'use client'

import { useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useDebouncedCallback } from 'use-debounce'
import { Boxes, EyeOff, AlertTriangle, TrendingDown, Link2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Link } from '@/lib/navigation'
import {
  MobileDataCard,
  ResponsiveDataView
} from '@/components/admin/responsive-data-view'
import { AdminFilterBar, AdminFilterChip } from '@/components/admin/data-table/admin-filter-chip'
import { AdminKpiCard, AdminKpiGrid } from '@/components/admin/data-table/admin-kpi-card'
import { AdminTableToolbar } from '@/components/admin/data-table/admin-table-toolbar'
import { AdminTableEmptyState } from '@/components/admin/data-table/admin-table-empty-state'
import { DataTable } from '@/components/admin/data-table/data-table'
import type { AdminProductListItem } from '@/lib/types/admin-products'
import type { ColumnDef } from '@tanstack/react-table'

interface ProductsAdminClientProps {
  products?: AdminProductListItem[]
}

const columns: ColumnDef<AdminProductListItem>[] = [
  {
    id: 'name',
    header: 'Ürün Adı',
    cell: ({ row }) => row.original.name,
  },
  {
    id: 'articleLinkId',
    header: 'Parça No',
    cell: ({ row }) => row.original.articleLinkId,
  },
  {
    id: 'brand',
    header: 'Marka',
    cell: ({ row }) => row.original.brand ?? '-',
  },
  {
    id: 'category',
    header: 'Kategori',
    cell: ({ row }) => row.original.category ?? '-',
  },
  {
    id: 'sellingPrice',
    header: 'Satış Fiyatı',
    cell: ({ row }) =>
      row.original.sellingPrice.toLocaleString('tr-TR', {
        style: 'currency',
        currency: 'TRY',
        maximumFractionDigits: 2,
      }),
  },
  {
    id: 'supplierStockQty',
    header: 'Stok',
    cell: ({ row }) => row.original.supplierStockQty,
  },
]

const placeholderRows: AdminProductListItem[] = []

export function ProductsAdminClient(_props: ProductsAdminClientProps = {}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [searchValue, setSearchValue] = useState(searchParams.get('q') || '')
  const [isRefreshing, startRefresh] = useState(false)

  const currentStock = searchParams.get('stockStatus') || 'all'
  const currentVisibility = searchParams.get('visibility') || 'all'
  const currentSync = searchParams.get('syncStatus') || 'all'

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

  const resetFilters = () => {
    setSearchValue('')
    router.push(pathname)
  }

  const handleRefresh = () => {
    startRefresh(true)
    router.refresh()
    setTimeout(() => startRefresh(false), 500)
  }

  const emptyState = (
    <AdminTableEmptyState
      title="Henüz ürün bulunmuyor"
      description="Ürünler v0.products tablosundan doldurulacak."
      icon={<Boxes size={28} />}
    />
  )

  const memoizedColumns = useMemo(() => columns, [])

  return (
    <div className="space-y-4">
      <AdminKpiGrid>
        <AdminKpiCard label="Toplam Ürün" value={0} icon={<Boxes size={16} />} />
        <AdminKpiCard label="Düşük Stok" value={0} tone="warning" icon={<TrendingDown size={16} />} />
        <AdminKpiCard label="Fiyatsız" value={0} tone="info" icon={<AlertTriangle size={16} />} />
        <AdminKpiCard label="Gizli" value={0} tone="info" icon={<EyeOff size={16} />} />
      </AdminKpiGrid>

      <div className="rounded-md border border-border bg-card p-4">
        <AdminTableToolbar
          searchValue={searchValue}
          onSearchChange={(nextValue) => {
            setSearchValue(nextValue)
            onSearch(nextValue)
          }}
          searchPlaceholder="Ürün adı veya parça no ara..."
          onRefresh={handleRefresh}
          isRefreshing={isRefreshing}
          actions={
            <Button variant="outline" size="sm" asChild className="rounded-md border-border bg-background">
              <Link href="/admin/products/match">
                <Link2 className="mr-2 h-4 w-4" />
                Eşleştir
              </Link>
            </Button>
          }
        />

        <AdminFilterBar onReset={resetFilters} className="mt-3">
          <AdminFilterChip
            active={currentStock !== 'all'}
            onClick={() =>
              setParam('stockStatus', currentStock === 'low' ? null : 'low')
            }
            label="Düşük Stok"
          />
          <AdminFilterChip
            active={currentVisibility === 'hidden'}
            onClick={() =>
              setParam('visibility', currentVisibility === 'hidden' ? null : 'hidden')
            }
            label="Gizli"
          />
          <AdminFilterChip
            active={currentSync === 'error'}
            onClick={() =>
              setParam('syncStatus', currentSync === 'error' ? null : 'error')
            }
            label="Senk Hatası"
          />
        </AdminFilterBar>
      </div>

      <ResponsiveDataView
        mobile={
          placeholderRows.length === 0 ? (
            <div className="rounded-lg border border-border bg-background px-4 py-14">
              {emptyState}
            </div>
          ) : (
            <div className="space-y-3">
              {placeholderRows.map((product) => (
                <MobileDataCard key={product.id}>
                  <p className="font-semibold text-foreground">{product.name}</p>
                </MobileDataCard>
              ))}
            </div>
          )
        }
        desktop={
          <DataTable
            columns={memoizedColumns}
            data={placeholderRows}
            emptyMessage="Henüz ürün bulunmuyor"
          />
        }
      />
    </div>
  )
}