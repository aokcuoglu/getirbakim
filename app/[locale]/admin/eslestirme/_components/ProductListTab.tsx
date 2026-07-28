'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Download, Loader2, Tag, Upload, X } from 'lucide-react'
import { toast } from 'sonner'
import { useDebouncedCallback } from 'use-debounce'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { AdminFilterBar, AdminFilterChip } from '@/components/admin/data-table/admin-filter-chip'
import { AdminTableToolbar } from '@/components/admin/data-table/admin-table-toolbar'
import { DataTable } from '@/components/admin/data-table/data-table'
import {
  PRODUCT_LIST_COVERAGE_LABELS,
  PRODUCT_LIST_OEM_LABELS,
  PRODUCT_LIST_STATUS_LABELS,
  PRODUCT_LIST_SUPPLIERS,
  PRODUCT_LIST_SUPPLIER_LABELS,
  PRODUCT_LIST_UNMATCHED_KINDS,
  type ProductListCoverage,
  type ProductListOem,
  type ProductListResult,
  type ProductListStatus,
  type ProductListSupplierFilter,
  type ProductMatchCoverage,
  type SupplierProductRow
} from '@/lib/admin/product-match-shared'
import { createProductListColumns } from './product-list-columns'
import { ProductMatchModal } from './ProductMatchModal'
import { BrandFilterModal } from './BrandFilterModal'
import { ProductCsvImportDialog } from './ProductCsvImportDialog'

type Filters = {
  /** 'all' = hiçbir firma seçili değil → iki tedarikçinin ürünleri birlikte. */
  supplier: ProductListSupplierFilter
  status: ProductListStatus
  coverage: ProductListCoverage
  oem: ProductListOem
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
 * Başbuğ için tersi. Firma seçilmediğinde her iki tarafın satırları listelendiği
 * için üç seçenek de anlamlıdır.
 */
const COVERAGE_OPTIONS: Record<ProductListSupplierFilter, ProductMatchCoverage[]> = {
  all: ['both', 'dinamik', 'basbug'],
  dinamik: ['both', 'dinamik'],
  basbug: ['both', 'basbug']
}

/** Marka seçicisinin "hangi filtreler daraltıyor" özetinde kullanılan durum adları. */
const STATUS_SUMMARY_LABELS: Record<Exclude<ProductListStatus, 'all'>, string> = {
  matched: 'Eşleşen',
  unmatched: 'Eşleşmeyen',
  ...PRODUCT_LIST_STATUS_LABELS
}

/** Sunucu tarafındaki filtreler — export ve liste AYNI parametreleri kullanır. */
function buildFilterParams(f: Filters) {
  const p = new URLSearchParams()
  p.set('supplier', f.supplier)
  if (f.status !== 'all') p.set('status', f.status)
  if (f.coverage !== 'all') p.set('coverage', f.coverage)
  if (f.oem !== 'all') p.set('oem', f.oem)
  if (f.q) p.set('q', f.q)
  if (f.brandId != null) p.set('brandId', String(f.brandId))
  return p
}

function buildParams(f: Filters) {
  const p = buildFilterParams(f)
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
  const [csvOpen, setCsvOpen] = useState(false)
  const [exporting, setExporting] = useState(false)

  const [filters, setFilters] = useState<Filters>({
    supplier: 'dinamik',
    status: 'all',
    coverage: 'all',
    oem: 'all',
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

  /**
   * Alternatif varyant satırından, offer'ı gerçekten tutan kardeş satıra atlar.
   * Kardeş satır çoğu zaman farklı yazılışta olduğu için (WPO-901 / WPO901)
   * arama kutusunda bulunamaz — blokçu SKU'yu arama terimi yaparız. Durum
   * filtresi 'all'a çekilir, yoksa hedef satır (eşleşmiş) kendi filtresinin
   * dışında kalırdı.
   */
  const onVariantJump = useCallback(
    (row: SupplierProductRow) => {
      const sku = row.variantOf?.blockingSku
      if (!sku) return
      setSearchValue(sku)
      applyFilters({ q: sku, status: 'all', page: 1 })
    },
    [applyFilters]
  )

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

  // İki adım: önce ucuz sayım çağrısı (satır tavanı / yetki hatalarını düzgün
  // bir toast'la göstermek için), sonra indirmeyi tarayıcıya bırak. Yanıtı
  // fetch ile blob'a almak 1M satırda yüzlerce MB'ı sekme belleğine yığardı;
  // doğrudan gezinmede tarayıcı akışı diske yazar.
  const onExport = useCallback(async () => {
    setExporting(true)
    try {
      const params = buildFilterParams(filtersRef.current)
      const res = await fetch(`/api/admin/eslestirme/products/export?${params}&countOnly=1`)
      const data = await res.json().catch(() => null)
      if (!res.ok || data?.error) {
        toast.error(data?.error?.message || 'CSV indirilemedi.')
        return
      }
      const total = Number(data?.total ?? 0)
      if (total === 0) {
        toast.error('Bu filtreyle indirilecek satır yok.')
        return
      }
      window.location.href = `/api/admin/eslestirme/products/export?${params}`
      toast.success(`${total.toLocaleString('tr-TR')} satır indiriliyor…`)
    } catch {
      toast.error('CSV indirilirken hata oluştu.')
    } finally {
      setExporting(false)
    }
  }, [])

  const columns = createProductListColumns({ onMatch, onVariantJump })

  // 'variant' ve 'gap' eşleşmeyenlerin alt kümesi: ana chip ikisinde de aktif
  // kalır, daraltma chip'leri yalnız o dal seçiliyken görünür.
  const unmatchedActive =
    filters.status === 'unmatched' || filters.status === 'variant' || filters.status === 'gap'

  const statusChips: { key: ProductListStatus; label: string; active: boolean }[] = [
    { key: 'matched', label: 'Eşleşen', active: filters.status === 'matched' },
    { key: 'unmatched', label: 'Eşleşmeyen', active: unmatchedActive }
  ]

  const coverageChips = COVERAGE_OPTIONS[filters.supplier].map((key) => ({
    key,
    label: PRODUCT_LIST_COVERAGE_LABELS[key]
  }))

  const oemChips: { key: Exclude<ProductListOem, 'all'>; label: string }[] = [
    { key: 'without', label: PRODUCT_LIST_OEM_LABELS.without },
    { key: 'with', label: PRODUCT_LIST_OEM_LABELS.with }
  ]

  // Marka seçeneklerini üreten filtreler = tablonun filtreleri EKSİ markanın
  // kendisi (yoksa seçici zaten seçili markaya iner).
  const brandOptionParams = buildFilterParams({ ...filters, brandId: null }).toString()

  const activeFilterSummary =
    [
      filters.supplier !== 'all' ? PRODUCT_LIST_SUPPLIER_LABELS[filters.supplier] : null,
      filters.status !== 'all' ? STATUS_SUMMARY_LABELS[filters.status] : null,
      filters.coverage !== 'all' ? PRODUCT_LIST_COVERAGE_LABELS[filters.coverage] : null,
      filters.oem !== 'all' ? PRODUCT_LIST_OEM_LABELS[filters.oem] : null,
      filters.q ? `"${filters.q}"` : null
    ]
      .filter(Boolean)
      .join(' · ') || null

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
                // Diğer chip'ler gibi seçili olana tekrar tıklamak seçimi kaldırır
                // → 'all': iki tedarikçinin ürünleri tek tabloda listelenir.
                const supplier: ProductListSupplierFilter = filters.supplier === key ? 'all' : key
                // Yeni firmada geçersiz kalan kapsam filtresini sıfırla.
                const coverage = COVERAGE_OPTIONS[supplier].includes(
                  filters.coverage as ProductMatchCoverage
                )
                  ? filters.coverage
                  : 'all'
                applyFilters({ supplier, coverage, page: 1 })
              }}
              label={PRODUCT_LIST_SUPPLIER_LABELS[key]}
            />
          ))}
          {filters.supplier === 'all' && (
            <span className="ml-1 text-xs text-muted-foreground">
              Firma seçili değil — tüm ürünler
            </span>
          )}
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
          actions={
            <>
              <Button
                variant="outline"
                size="sm"
                className="rounded-md border-border bg-background"
                onClick={() => void onExport()}
                disabled={exporting}
                title="Ekrandaki filtrelere uyan TÜM satırları CSV olarak indir"
              >
                {exporting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Download className="mr-2 h-4 w-4" />
                )}
                CSV indir
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="rounded-md border-border bg-background"
                onClick={() => setCsvOpen(true)}
              >
                <Upload className="mr-2 h-4 w-4" />
                CSV yükle
              </Button>
            </>
          }
        />

        <AdminFilterBar
          onReset={() => {
            setSearchValue('')
            setBrandName(null)
            applyFilters({
              status: 'all',
              coverage: 'all',
              oem: 'all',
              q: '',
              brandId: null,
              page: 1
            })
          }}
          className="mt-3"
        >
          {statusChips.map((chip) => (
            <AdminFilterChip
              key={chip.key}
              active={chip.active}
              onClick={() =>
                applyFilters({
                  status: chip.active ? 'all' : chip.key,
                  page: 1
                })
              }
              label={chip.label}
            />
          ))}

          {unmatchedActive &&
            PRODUCT_LIST_UNMATCHED_KINDS.map((kind) => (
              <AdminFilterChip
                key={kind}
                active={filters.status === kind}
                onClick={() =>
                  applyFilters({
                    status: filters.status === kind ? 'unmatched' : kind,
                    page: 1
                  })
                }
                label={PRODUCT_LIST_STATUS_LABELS[kind]}
                title={
                  kind === 'gap'
                    ? 'Bu parça bu tedarikçiden hiç bağlanamamış — doldurulacak gerçek boşluk'
                    : 'Parçası katalogta zaten kapsanmış, ikinci stok kodu olarak gelen satır'
                }
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

          <span className="mx-0.5 h-4 w-px shrink-0 bg-border" aria-hidden />

          {oemChips.map((chip) => (
            <AdminFilterChip
              key={chip.key}
              active={filters.oem === chip.key}
              onClick={() =>
                applyFilters({
                  oem: filters.oem === chip.key ? 'all' : chip.key,
                  page: 1
                })
              }
              label={chip.label}
              title="Bağlı kanonik ürünün OEM kodu var mı — yalnız eşleşmiş satırlara uygulanır"
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

      <ProductCsvImportDialog
        open={csvOpen}
        onOpenChange={setCsvOpen}
        onApplied={() => void onChanged()}
      />

      <BrandFilterModal
        open={brandModalOpen}
        onOpenChange={setBrandModalOpen}
        filterParams={brandOptionParams}
        filterSummary={activeFilterSummary}
        onSelect={(brand) => {
          setBrandName(brand?.brandName ?? null)
          applyFilters({ brandId: brand?.brandId ?? null, page: 1 })
        }}
      />
    </div>
  )
}
