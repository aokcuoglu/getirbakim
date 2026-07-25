'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Tag, X } from 'lucide-react'
import { toast } from 'sonner'
import { useDebouncedCallback } from 'use-debounce'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { AdminFilterBar, AdminFilterChip } from '@/components/admin/data-table/admin-filter-chip'
import { AdminTableToolbar } from '@/components/admin/data-table/admin-table-toolbar'
import { DataTable } from '@/components/admin/data-table/data-table'
import {
  PRODUCT_LIST_COVERAGE_LABELS,
  PRODUCT_LIST_SUPPLIERS,
  PRODUCT_LIST_SUPPLIER_LABELS,
  type ProductListCoverage,
  type ProductListResult,
  type ProductListStatus,
  type ProductListSupplier,
  type ProductMatchCoverage,
  type SupplierProductRow
} from '@/lib/admin/product-match-shared'
import { createProductListColumns } from './product-list-columns'
import { ProductMatchModal } from './ProductMatchModal'
import { BrandFilterModal } from './BrandFilterModal'

type Filters = {
  supplier: ProductListSupplier
  status: ProductListStatus
  coverage: ProductListCoverage
  q: string
  brandId: number | null
  page: number
  limit: number
}

const EMPTY: ProductListResult = {
  rows: [],
  summary: { total: 0, matched: 0, unmatched: 0 },
  pagination: { page: 1, limit: 50, total: 0, pages: 1 }
}

/**
 * Firma bazlı geçerli kapsam seçenekleri. Dinamik satırları eşleşince kanonik
 * ürünün mutlaka bir Dinamik offer'ı olur → "Yalnız Başbuğ" imkânsız (boş döner);
 * Başbuğ için tersi.
 */
const COVERAGE_OPTIONS: Record<ProductListSupplier, ProductMatchCoverage[]> = {
  dinamik: ['both', 'dinamik'],
  basbug: ['both', 'basbug']
}

function buildParams(f: Filters) {
  const p = new URLSearchParams()
  p.set('supplier', f.supplier)
  if (f.status !== 'all') p.set('status', f.status)
  if (f.coverage !== 'all') p.set('coverage', f.coverage)
  if (f.q) p.set('q', f.q)
  if (f.brandId != null) p.set('brandId', String(f.brandId))
  p.set('page', String(f.page))
  p.set('limit', String(f.limit))
  return p
}

export function ProductListTab({ onMatched }: { onMatched?: () => void }) {
  const [data, setData] = useState<ProductListResult>(EMPTY)
  const [isFetching, setIsFetching] = useState(true)
  const [searchValue, setSearchValue] = useState('')
  const [isSearchPending, setIsSearchPending] = useState(false)
  const [matchRow, setMatchRow] = useState<SupplierProductRow | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [brandModalOpen, setBrandModalOpen] = useState(false)
  const [brandName, setBrandName] = useState<string | null>(null)

  const [filters, setFilters] = useState<Filters>({
    supplier: 'dinamik',
    status: 'all',
    coverage: 'all',
    q: '',
    brandId: null,
    page: 1,
    limit: 50
  })
  const filtersRef = useRef(filters)
  useEffect(() => {
    filtersRef.current = filters
  }, [filters])

  const load = useCallback(async (f: Filters): Promise<ProductListResult | null> => {
    setIsFetching(true)
    try {
      const res = await fetch(`/api/admin/eslestirme/products/list?${buildParams(f)}`)
      const d = await res.json()
      if (!res.ok || d.error) {
        toast.error(d?.error?.message || 'Ürün listesi yüklenemedi.')
        return null
      }
      setData(d)
      return d as ProductListResult
    } catch {
      toast.error('Ürün listesi yüklenirken hata oluştu.')
      return null
    } finally {
      setIsFetching(false)
    }
  }, [])

  useEffect(() => {
    void load(filtersRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const applyFilters = useCallback(
    (patch: Partial<Filters>) => {
      const next = { ...filtersRef.current, ...patch }
      setFilters(next)
      void load(next)
    },
    [load]
  )

  const onSearch = useDebouncedCallback((term: string) => {
    setIsSearchPending(false)
    applyFilters({ q: term.trim(), page: 1 })
  }, 300)

  const onMatch = useCallback((row: SupplierProductRow) => {
    setMatchRow(row)
    setModalOpen(true)
  }, [])

  // Modal açıkken de (ör. isim override kaydedildiğinde) tablo tazelenir ve
  // açık modalin satır snapshot'ı taze veriyle değiştirilir — yoksa modal eski
  // kanonik adı göstermeye devam eder.
  const onChanged = useCallback(async () => {
    const fresh = await load(filtersRef.current)
    if (fresh) {
      setMatchRow((prev) =>
        prev
          ? (fresh.rows.find(
              (r) =>
                r.supplier === prev.supplier && r.supplierProductId === prev.supplierProductId
            ) ?? prev)
          : prev
      )
    }
    onMatched?.()
  }, [load, onMatched])

  const columns = createProductListColumns({ onMatch })

  const statusChips: { key: ProductListStatus; label: string }[] = [
    { key: 'matched', label: 'Eşleşen' },
    { key: 'unmatched', label: 'Eşleşmeyen' }
  ]

  const coverageChips = COVERAGE_OPTIONS[filters.supplier].map((key) => ({
    key,
    label: PRODUCT_LIST_COVERAGE_LABELS[key]
  }))

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-foreground">Ürün Listesi</h3>
        <p className="text-xs text-muted-foreground">
          Onaylı marka altındaki Dinamik ve Başbuğ ürünlerini listeleyin ve eşleştirin.
        </p>
      </div>

      <div className="rounded-md border border-border bg-card p-4">
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs font-medium text-muted-foreground">Firma:</span>
          {PRODUCT_LIST_SUPPLIERS.map((key) => (
            <AdminFilterChip
              key={key}
              active={filters.supplier === key}
              onClick={() => {
                if (filters.supplier === key) return
                // Yeni firmada geçersiz kalan kapsam filtresini sıfırla.
                const coverage = COVERAGE_OPTIONS[key].includes(
                  filters.coverage as ProductMatchCoverage
                )
                  ? filters.coverage
                  : 'all'
                applyFilters({ supplier: key, coverage, page: 1 })
              }}
              label={PRODUCT_LIST_SUPPLIER_LABELS[key]}
            />
          ))}
        </div>

        <AdminTableToolbar
          searchValue={searchValue}
          onSearchChange={(v) => {
            setSearchValue(v)
            setIsSearchPending(true)
            onSearch(v)
          }}
          searchPlaceholder="SKU / ad / part_no / OEM ara..."
          isSearchLoading={isSearchPending || isFetching}
          onRefresh={() => void load(filtersRef.current)}
          isRefreshing={isFetching}
        />

        <AdminFilterBar
          onReset={() => {
            setSearchValue('')
            setBrandName(null)
            applyFilters({ status: 'all', coverage: 'all', q: '', brandId: null, page: 1 })
          }}
          className="mt-3"
        >
          {statusChips.map((chip) => (
            <AdminFilterChip
              key={chip.key}
              active={filters.status === chip.key}
              onClick={() =>
                applyFilters({
                  status: filters.status === chip.key ? 'all' : chip.key,
                  page: 1
                })
              }
              label={chip.label}
            />
          ))}

          <span className="mx-0.5 h-4 w-px shrink-0 bg-border" aria-hidden />

          {coverageChips.map((chip) => (
            <AdminFilterChip
              key={chip.key}
              active={filters.coverage === chip.key}
              onClick={() =>
                applyFilters({
                  coverage: filters.coverage === chip.key ? 'all' : chip.key,
                  page: 1
                })
              }
              label={chip.label}
            />
          ))}

          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => setBrandModalOpen(true)}
          >
            <Tag className="mr-1 h-3.5 w-3.5" />
            Marka filtrele
          </Button>

          {filters.brandId != null && (
            <Badge variant="outline" className="gap-1 border-primary/20 bg-primary/10 text-primary">
              {brandName}
              <button
                type="button"
                onClick={() => {
                  setBrandName(null)
                  applyFilters({ brandId: null, page: 1 })
                }}
                className="ml-0.5 rounded-full hover:bg-primary/20"
                aria-label="Marka filtresini kaldır"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          )}
        </AdminFilterBar>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <p>
          {data.pagination.total.toLocaleString('tr-TR')} ürün (sayfa {data.pagination.page} /{' '}
          {data.pagination.pages})
        </p>
      </div>

      <DataTable
        columns={columns}
        data={data.rows}
        getRowId={(row) => `${row.supplier}:${row.supplierProductId}`}
        isLoading={isFetching}
        pagination={data.pagination}
        onPaginationChange={(page) => applyFilters({ page })}
        emptyMessage="Ürün bulunamadı."
        animateRows={false}
      />

      <ProductMatchModal
        row={matchRow}
        open={modalOpen}
        onOpenChange={(o) => {
          setModalOpen(o)
          if (!o) setMatchRow(null)
        }}
        onChanged={() => void onChanged()}
      />

      <BrandFilterModal
        open={brandModalOpen}
        onOpenChange={setBrandModalOpen}
        onSelect={(brand) => {
          setBrandName(brand?.brandName ?? null)
          applyFilters({ brandId: brand?.brandId ?? null, page: 1 })
        }}
      />
    </div>
  )
}
