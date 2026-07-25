'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Wand2 } from 'lucide-react'
import { toast } from 'sonner'
import { useDebouncedCallback } from 'use-debounce'
import { Button } from '@/components/ui/button'
import { AdminFilterBar, AdminFilterChip } from '@/components/admin/data-table/admin-filter-chip'
import { AdminKpiCard, AdminKpiGrid } from '@/components/admin/data-table/admin-kpi-card'
import { AdminTableToolbar } from '@/components/admin/data-table/admin-table-toolbar'
import { DataTable } from '@/components/admin/data-table/data-table'
import {
  SUPPLIER_KEYS,
  SUPPLIER_LABELS,
  type AutoMatchExactResult,
  type SupplierBrandMatchResult,
  type SupplierBrandMatchRow,
  type SupplierBrandMatchStatus,
  type SupplierKey
} from '@/lib/admin/supplier-brand-shared'
import { createSupplierBrandColumns } from './supplier-brand-columns'
import { SupplierBrandMatchSheet } from './SupplierBrandMatchSheet'

type TabFilters = {
  supplier: SupplierKey
  status: SupplierBrandMatchStatus
  q: string
  page: number
  limit: number
}

function buildParams(f: TabFilters) {
  const params = new URLSearchParams()
  params.set('supplier', f.supplier)
  if (f.status !== 'all') params.set('status', f.status)
  if (f.q) params.set('q', f.q)
  params.set('page', String(f.page))
  params.set('limit', String(f.limit))
  return params
}

interface BrandMatchTabProps {
  initialData: SupplierBrandMatchResult
}

export function BrandMatchTab({ initialData }: BrandMatchTabProps) {
  const [rows, setRows] = useState<SupplierBrandMatchRow[]>(initialData.rows)
  const [summary, setSummary] = useState(initialData.summary)
  const [pagination, setPagination] = useState(initialData.pagination)
  const [isFetching, setIsFetching] = useState(false)
  const [searchValue, setSearchValue] = useState(initialData.filters.q)
  const [isSearchPending, setIsSearchPending] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [matchSheetOpen, setMatchSheetOpen] = useState(false)
  const [matchSource, setMatchSource] = useState<SupplierBrandMatchRow | null>(null)
  const [autoRunning, setAutoRunning] = useState(false)
  const [autoResult, setAutoResult] = useState<AutoMatchExactResult | null>(null)

  const [filters, setFilters] = useState<TabFilters>({
    supplier: initialData.supplier,
    status: initialData.filters.status,
    q: initialData.filters.q,
    page: initialData.pagination.page,
    limit: initialData.pagination.limit
  })
  const filtersRef = useRef(filters)
  useEffect(() => {
    filtersRef.current = filters
  }, [filters])

  const loadRows = useCallback(async (f: TabFilters) => {
    setIsFetching(true)
    try {
      const res = await fetch(`/api/admin/eslestirme/brands?${buildParams(f)}`)
      const data = await res.json()
      if (!res.ok || data.error) {
        toast.error(data?.error?.message || 'Liste yüklenemedi.')
        return
      }
      setRows(data.rows || [])
      setPagination(data.pagination)
      setSummary(data.summary)
    } catch {
      toast.error('Liste yüklenirken hata oluştu.')
    } finally {
      setIsFetching(false)
    }
  }, [])

  const applyFilters = useCallback(
    (patch: Partial<TabFilters>) => {
      const next = { ...filtersRef.current, ...patch }
      setFilters(next)
      void loadRows(next)
    },
    [loadRows]
  )

  const onSearch = useDebouncedCallback((term: string) => {
    setIsSearchPending(false)
    applyFilters({ q: term.trim(), page: 1 })
  }, 250)

  const runAction = useCallback(
    async (row: SupplierBrandMatchRow, action: 'approve' | 'reject' | 'unlink') => {
      if (row.mappingId == null) return
      setBusyId(row.supplierId)
      try {
        // unlink tedarikçi kolonunu boşaltır (satırı silmez) → supplier + supplierBrandId.
        // approve/reject satır durumunu değiştirir → mappingId.
        const payload =
          action === 'unlink'
            ? { supplier: filtersRef.current.supplier, supplierBrandId: row.supplierId }
            : { mappingId: row.mappingId }
        const res = await fetch(`/api/admin/eslestirme/brands/${action}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        })
        const data = await res.json()
        if (data.error) {
          toast.error(data.error?.message || 'İşlem başarısız.')
        } else {
          toast.success(data.message || 'İşlem tamamlandı.')
          await loadRows(filtersRef.current)
        }
      } catch {
        toast.error('İşlem sırasında hata oluştu.')
      } finally {
        setBusyId(null)
      }
    },
    [loadRows]
  )

  const handleMatch = useCallback((row: SupplierBrandMatchRow) => {
    setMatchSource(row)
    setMatchSheetOpen(true)
  }, [])

  const runAutoMatch = useCallback(async () => {
    setAutoRunning(true)
    setAutoResult(null)
    try {
      const res = await fetch('/api/admin/eslestirme/brands/auto-match', { method: 'POST' })
      const data = await res.json()
      if (!res.ok || data.error) {
        toast.error(data?.error?.message || 'Otomatik eşleştirme çalıştırılamadı.')
        return
      }
      setAutoResult(data as AutoMatchExactResult)
      toast.success(
        `Birebir eşleştirme tamam: +${data.brandsLinked} marka bağlandı, +${data.canonicalsCreated} kanonik.`
      )
      await loadRows(filtersRef.current)
    } catch {
      toast.error('Otomatik eşleştirme sırasında hata oluştu.')
    } finally {
      setAutoRunning(false)
    }
  }, [loadRows])

  const columns = createSupplierBrandColumns({
    onMatch: handleMatch,
    onApprove: (r) => void runAction(r, 'approve'),
    onReject: (r) => void runAction(r, 'reject'),
    onUnlink: (r) => void runAction(r, 'unlink'),
    busyId
  })

  const statusChips: { key: SupplierBrandMatchStatus; label: string }[] = [
    { key: 'matched', label: 'Eşleşmiş' },
    { key: 'pending', label: 'Bekleyen' },
    { key: 'unmatched', label: 'Eşleşmemiş' }
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Marka Eşleştirme</h3>
          <p className="text-xs text-muted-foreground">
            Dinamik ve Başbuğ markalarını kanonik markalara bağlayın. Birebir
            (kelimesi kelimesine) aynı olan markalar tek tıkla otomatik eşleştirilebilir.
          </p>
        </div>
        <Button size="sm" onClick={() => void runAutoMatch()} disabled={autoRunning}>
          {autoRunning ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Wand2 className="mr-2 h-4 w-4" />
          )}
          {autoRunning ? 'Eşleştiriliyor…' : 'Birebir otomatik eşleştir'}
        </Button>
      </div>

      {autoResult && (
        <div className="rounded-md border border-border bg-card p-4">
          <p className="mb-2 text-sm font-semibold">Son otomatik eşleştirme</p>
          <ul className="space-y-1 font-mono text-xs text-muted-foreground">
            {autoResult.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      )}

      <AdminKpiGrid>
        <AdminKpiCard label="Toplam Marka" value={summary.total} tone="default" />
        <AdminKpiCard label="Eşleşmiş" value={summary.matched} tone="success" />
        <AdminKpiCard label="Bekleyen" value={summary.pending} tone="warning" />
        <AdminKpiCard label="Eşleşmemiş" value={summary.unmatched} tone="info" />
      </AdminKpiGrid>

      <div className="rounded-md border border-border bg-card p-4">
        {/* Firma seçici */}
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs font-medium text-muted-foreground">Firma:</span>
          {SUPPLIER_KEYS.map((key) => (
            <AdminFilterChip
              key={key}
              active={filters.supplier === key}
              onClick={() => {
                if (filters.supplier === key) return
                applyFilters({ supplier: key, page: 1 })
              }}
              label={SUPPLIER_LABELS[key]}
            />
          ))}
        </div>

        <AdminTableToolbar
          searchValue={searchValue}
          onSearchChange={(nextValue) => {
            setSearchValue(nextValue)
            setIsSearchPending(true)
            onSearch(nextValue)
          }}
          searchPlaceholder="Marka adı ara..."
          isSearchLoading={isSearchPending || isFetching}
          onRefresh={() => void loadRows(filtersRef.current)}
          isRefreshing={isFetching}
        />

        <AdminFilterBar
          onReset={() => {
            setSearchValue('')
            applyFilters({ status: 'all', q: '', page: 1 })
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
        </AdminFilterBar>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <p>
          {pagination.total} marka (sayfa {pagination.page} / {pagination.pages})
        </p>
      </div>

      <DataTable
        columns={columns}
        data={rows}
        getRowId={(row) => row.supplierId}
        isLoading={isFetching}
        pagination={pagination}
        onPaginationChange={(page) => applyFilters({ page })}
        emptyMessage="Sonuç bulunamadı."
      />

      <SupplierBrandMatchSheet
        supplier={filters.supplier}
        source={matchSource}
        open={matchSheetOpen}
        onOpenChange={(open) => {
          setMatchSheetOpen(open)
          if (!open) setMatchSource(null)
        }}
        onLinked={() => void loadRows(filtersRef.current)}
      />
    </div>
  )
}
