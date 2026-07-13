'use client'

import { useMemo, useState, useTransition } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useDebouncedCallback } from 'use-debounce'
import { toast } from 'sonner'
import { CheckCircle2, EyeOff, Hourglass, Link2, Loader2, Package, Search, Sparkles, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet'
import {
  MobileDataCard,
  ResponsiveDataView
} from '@/components/admin/responsive-data-view'
import {
  AdminFilterBar,
  AdminFilterChip,
  AdminFilterSelectChip
} from '@/components/admin/data-table/admin-filter-chip'
import { AdminKpiCard, AdminKpiGrid } from '@/components/admin/data-table/admin-kpi-card'
import { AdminTableToolbar } from '@/components/admin/data-table/admin-table-toolbar'
import { AdminTableEmptyState } from '@/components/admin/data-table/admin-table-empty-state'
import { DataTable } from '@/components/admin/data-table/data-table'
import {
  approveDpprdMatch,
  bulkApproveDpprdMatches,
  bulkApplyOemBridge,
  bulkPopulateDpprdMatches,
  ignoreDpprdMatch,
  manualLinkDpprdMatch,
  searchPtdrkForManualMatch
} from '@/lib/actions/admin-dpprd-match'
import type {
  DpprdManualSearchCandidate,
  DpprdMatchBrandOption,
  DpprdMatchListItem,
  DpprdMatchListResult,
  DpprdMatchOverviewResult
} from '@/lib/types/dpprd-match'
import type { ColumnDef } from '@tanstack/react-table'

interface MatchProductsAdminClientProps {
  overview: DpprdMatchOverviewResult
  listResult: DpprdMatchListResult
}

const STATUS_TONE: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-800 border-amber-200',
  APPROVED: 'bg-green-100 text-green-800 border-green-200',
  IGNORED: 'bg-gray-100 text-gray-600 border-gray-200'
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] font-medium ${STATUS_TONE[status] ?? 'bg-muted text-muted-foreground border-border'}`}
    >
      {status}
    </span>
  )
}

function truncate(text: string | null, max = 24): string {
  if (!text) return '-'
  return text.length > max ? `${text.slice(0, max)}…` : text
}

export function MatchProductsAdminClient({
  overview,
  listResult
}: MatchProductsAdminClientProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [isPending, startTransition] = useTransition()
  const [isRefreshing, startRefresh] = useTransition()
  const [searchValue, setSearchValue] = useState(searchParams.get('q') || '')
  const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({})
  const [selectedMatches, setSelectedMatches] = useState<DpprdMatchListItem[]>([])

  // Manual search drawer state
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerMatch, setDrawerMatch] = useState<DpprdMatchListItem | null>(null)
  const [drawerQuery, setDrawerQuery] = useState('')
  const [drawerCandidates, setDrawerCandidates] = useState<DpprdManualSearchCandidate[]>([])
  const [drawerSearching, setDrawerSearching] = useState(false)
  const [drawerLinkingId, setDrawerLinkingId] = useState<number | null>(null)

  const currentStatus = searchParams.get('status') || 'all'
  const currentBrand = searchParams.get('brandListId') || 'all'

  const selectedIds = useMemo(
    () => Object.entries(rowSelection).filter(([, v]) => v).map(([k]) => k),
    [rowSelection]
  )

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

  const goPage = (page: number) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('page', String(page))
    router.push(`${pathname}?${params.toString()}`)
  }

  const handleRefresh = () => {
    startRefresh(() => {
      router.refresh()
    })
  }

  const handleApprove = (id: string) => {
    startTransition(async () => {
      const result = await approveDpprdMatch({ id })
      if (!result.success) {
        toast.error(result.message)
        return
      }
      toast.success(result.message)
      router.refresh()
    })
  }

  const handleIgnore = (id: string) => {
    startTransition(async () => {
      const result = await ignoreDpprdMatch({ id })
      if (!result.success) {
        toast.error(result.message)
        return
      }
      toast.success(result.message)
      router.refresh()
    })
  }

  const handleBulkApprove = () => {
    if (selectedIds.length === 0) {
      toast.error('Lütfen en az bir eşleştirme seçin.')
      return
    }
    startTransition(async () => {
      const result = await bulkApproveDpprdMatches({ ids: selectedIds })
      if (!result.success) {
        toast.error(result.message)
        return
      }
      toast.success(result.message)
      setRowSelection({})
      setSelectedMatches([])
      router.refresh()
    })
  }

  const handleBulkPopulate = (apply: boolean) => {
    startTransition(async () => {
      const result = await bulkPopulateDpprdMatches({ apply })
      if (!result.success) {
        toast.error(result.message)
        return
      }
      toast.success(result.message)
      router.refresh()
    })
  }

  const handleBulkOemBridge = () => {
    startTransition(async () => {
      const result = await bulkApplyOemBridge({})
      if (!result.success) {
        toast.error(result.message)
        return
      }
      toast.success(result.message)
      router.refresh()
    })
  }

  const openDrawerForMatch = (match: DpprdMatchListItem) => {
    setDrawerMatch(match)
    setDrawerQuery('')
    setDrawerCandidates([])
    setDrawerOpen(true)
  }

  const runDrawerSearch = () => {
    if (!drawerMatch) return
    const q = drawerQuery.trim()
    if (q.length === 0) {
      setDrawerCandidates([])
      return
    }
    setDrawerSearching(true)
    startTransition(async () => {
      const result = await searchPtdrkForManualMatch({
        dnmkProductId: drawerMatch.dnmkProductId,
        q
      })
      setDrawerSearching(false)
      if (!result.success) {
        toast.error(result.message)
        setDrawerCandidates([])
        return
      }
      setDrawerCandidates(result.candidates)
    })
  }

  const handleManualLink = (candidate: DpprdManualSearchCandidate) => {
    if (!drawerMatch) return
    setDrawerLinkingId(candidate.id)
    startTransition(async () => {
      const result = await manualLinkDpprdMatch({
        dnmkProductId: drawerMatch.dnmkProductId,
        ptdrkProductId: candidate.id
      })
      setDrawerLinkingId(null)
      if (!result.success) {
        toast.error(result.message)
        return
      }
      toast.success(result.message)
      setDrawerOpen(false)
      router.refresh()
    })
  }

  const columns = useMemo<ColumnDef<DpprdMatchListItem>[]>(
    () => [
      {
        id: 'dnmk',
        header: 'Dinamik Ürün',
        cell: ({ row }) => {
          const m = row.original
          return (
            <div className="min-w-0 max-w-[180px]">
              <p className="font-medium text-foreground truncate" title={m.dnmkStockCode}>
                {truncate(m.dnmkStockCode, 20)}
              </p>
              <p className="text-xs text-muted-foreground truncate" title={m.dnmkStockName ?? m.dnmkPartNo ?? ''}>
                {truncate(m.dnmkStockName ?? m.dnmkPartNo ?? '-', 22)}
              </p>
              <p className="text-[11px] text-muted-foreground/70 truncate" title={m.dnmkBrand ?? ''}>
                {truncate(m.dnmkBrand, 18)}
              </p>
            </div>
          )
        }
      },
      {
        id: 'ptdrk',
        header: 'ParçaTedarik Ürün',
        cell: ({ row }) => {
          const m = row.original
          return (
            <div className="min-w-0 max-w-[200px]">
              <p className="font-medium text-foreground truncate" title={m.ptdrkPartNo ?? ''}>
                {truncate(m.ptdrkPartNo, 20)}
              </p>
              <p className="text-xs text-muted-foreground truncate" title={m.ptdrkTitle}>
                {truncate(m.ptdrkTitle, 26)}
              </p>
              <p className="text-[11px] text-muted-foreground/70 truncate" title={m.ptdrkBrand ?? ''}>
                {truncate(m.ptdrkBrand, 18)}
              </p>
            </div>
          )
        }
      },
      {
        id: 'ptdrkRefNo',
        header: 'ptdrk.ref_no',
        cell: ({ row }) => {
          const refNo = row.original.ptdrkRefNo
          return (
            <span className="text-xs text-muted-foreground" title={refNo ?? ''}>
              {refNo ? truncate(refNo, 28) : '-'}
            </span>
          )
        }
      },
      {
        id: 'status',
        header: 'Durum',
        cell: ({ row }) => <StatusBadge status={row.original.mappingStatus} />
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => {
          const m = row.original
          return (
            <div className="flex items-center justify-end gap-1">
              {m.mappingStatus !== 'APPROVED' && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleApprove(m.id)}
                  disabled={isPending}
                  className="h-7 px-2 text-xs"
                >
                  Onayla
                </Button>
              )}
              {m.mappingStatus !== 'IGNORED' && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleIgnore(m.id)}
                  disabled={isPending}
                  className="h-7 px-2 text-xs"
                >
                  Yoksay
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => openDrawerForMatch(m)}
                disabled={isPending}
                className="h-7 px-2 text-xs"
                title="Manuel ParçaTedarik ara"
              >
                <Link2 size={12} />
              </Button>
            </div>
          )
        }
      }
    ],
    [isPending]
  )

  const emptyState = (
    <AdminTableEmptyState
      title="Henüz eşleştirme yok"
      description="Toplu Eşleştir ile başlayın, ya da tek tek manuel arama yapın."
      icon={<Package size={28} />}
    />
  )

  return (
    <div className="space-y-4">
      {/* KPI Grid */}
      <AdminKpiGrid>
        <AdminKpiCard label="Toplam Eşleştirme" value={overview.total} icon={<Package size={16} />} />
        <AdminKpiCard label="Bekleyen" value={overview.pending} tone="warning" icon={<Hourglass size={16} />} />
        <AdminKpiCard label="Onaylı" value={overview.approved} tone="success" icon={<CheckCircle2 size={16} />} />
        <AdminKpiCard label="Yoksayılan" value={overview.ignored} tone="info" icon={<EyeOff size={16} />} />
        <AdminKpiCard label="OEM Yazılan" value={overview.oemWritten} icon={<Sparkles size={16} />} />
      </AdminKpiGrid>

      {/* Bulk Populate + OEM Bridge Panel */}
      <div className="rounded-md border border-border bg-card p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-semibold text-foreground">Toplu İşlemler</p>
            <p className="text-xs text-muted-foreground">
              Önce adayları oluştur, sonra tüm PENDING satırlara OEM köprüsü uygula (ptdrk.ref_no → dnmk.oem_no).
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleBulkPopulate(false)}
              disabled={isPending}
            >
              {isPending ? <Loader2 size={14} className="mr-2 animate-spin" /> : <Search size={14} className="mr-2" />}
              Eşleştir Önizle
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleBulkPopulate(true)}
              disabled={isPending}
            >
              {isPending ? <Loader2 size={14} className="mr-2 animate-spin" /> : <Sparkles size={14} className="mr-2" />}
              Eşleştir Uygula
            </Button>
            <Button
              size="sm"
              onClick={handleBulkOemBridge}
              disabled={isPending || overview.pending === 0}
              title={overview.pending === 0 ? 'Bekleyen eşleştirme yok' : `${overview.pending} PENDING satırı APPROVED yap ve OEM köprüsünü uygula`}
            >
              {isPending ? <Loader2 size={14} className="mr-2 animate-spin" /> : <CheckCircle2 size={14} className="mr-2" />}
              OEM Köprüsü Uygula
            </Button>
          </div>
        </div>
      </div>

      {/* Toolbar + Filters */}
      <div className="rounded-md border border-border bg-card p-4">
        <AdminTableToolbar
          searchValue={searchValue}
          onSearchChange={(nextValue) => {
            setSearchValue(nextValue)
            onSearch(nextValue)
          }}
          searchPlaceholder="Dinamik stock_code / part_no veya ParçaTedarik part_no / title ara..."
          onRefresh={handleRefresh}
          isRefreshing={isRefreshing || isPending}
        />

        <AdminFilterBar onReset={resetFilters} className="mt-3">
          <AdminFilterChip
            active={currentStatus === 'PENDING'}
            onClick={() => setParam('status', currentStatus === 'PENDING' ? null : 'PENDING')}
            label="Bekleyen"
          />
          <AdminFilterChip
            active={currentStatus === 'APPROVED'}
            onClick={() => setParam('status', currentStatus === 'APPROVED' ? null : 'APPROVED')}
            label="Onaylı"
          />
          <AdminFilterChip
            active={currentStatus === 'IGNORED'}
            onClick={() => setParam('status', currentStatus === 'IGNORED' ? null : 'IGNORED')}
            label="Yoksayılan"
          />
          {overview.brands.length > 0 && (
            <AdminFilterSelectChip
              prefix="Marka:"
              value={currentBrand}
              options={[
                { value: 'all', label: 'Tüm Markalar' },
                ...overview.brands.map((b) => ({
                  value: String(b.id),
                  label: `${b.name} (${b.pairCount})`
                }))
              ]}
              onChange={(v) => setParam('brandListId', v === 'all' ? null : v)}
            />
          )}
        </AdminFilterBar>
      </div>

      {/* Bulk Actions Bar */}
      {selectedIds.length > 0 && (
        <div className="rounded-md border border-border bg-card p-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <p className="text-sm font-semibold text-foreground">
              {selectedIds.length} eşleştirme seçili
            </p>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={handleBulkApprove} disabled={isPending}>
                {isPending ? <Loader2 size={14} className="mr-2 animate-spin" /> : <CheckCircle2 size={14} className="mr-2" />}
                Toplu Onayla
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setRowSelection({})
                  setSelectedMatches([])
                }}
                disabled={isPending}
              >
                Temizle
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Table / Mobile */}
      <ResponsiveDataView
        mobile={
          listResult.matches.length === 0 ? (
            <div className="rounded-lg border border-border bg-background px-4 py-14">
              {emptyState}
            </div>
          ) : (
            <div className="space-y-3">
              {listResult.matches.map((m) => (
                <MobileDataCard key={m.id}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-foreground truncate">{m.dnmkStockCode}</p>
                      <p className="text-xs text-muted-foreground truncate">{m.dnmkBrand}</p>
                    </div>
                    <StatusBadge status={m.mappingStatus} />
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    <p className="truncate">↳ {m.ptdrkPartNo ?? '-'}</p>
                    <p className="truncate">{truncate(m.ptdrkTitle, 40)}</p>
                  </div>
                  <div className="mt-3 flex gap-1">
                    {m.mappingStatus !== 'APPROVED' && (
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => handleApprove(m.id)} disabled={isPending}>
                        Onayla
                      </Button>
                    )}
                    {m.mappingStatus !== 'IGNORED' && (
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => handleIgnore(m.id)} disabled={isPending}>
                        Yoksay
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => openDrawerForMatch(m)} disabled={isPending}>
                      <Link2 size={12} />
                    </Button>
                  </div>
                </MobileDataCard>
              ))}
            </div>
          )
        }
        desktop={
          <DataTable
            columns={columns}
            data={listResult.matches}
            pagination={listResult.pagination}
            onPaginationChange={goPage}
            rowSelection={rowSelection}
            onRowSelectionChange={setRowSelection}
            emptyMessage="Henüz eşleştirme yok. Toplu Eşleştir ile başlayın."
          />
        }
      />

      {/* Manual Search Drawer */}
      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Manuel ParçaTedarik Ara</SheetTitle>
            <SheetDescription>
              {drawerMatch && (
                <>
                  Dinamik: <span>{drawerMatch.dnmkStockCode}</span> ({drawerMatch.dnmkBrand})
                </>
              )}
            </SheetDescription>
          </SheetHeader>

          <div className="mt-4 space-y-3">
            <div className="flex gap-2">
              <Input
                value={drawerQuery}
                onChange={(e) => setDrawerQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    runDrawerSearch()
                  }
                }}
                placeholder="part_no, title veya ref_no ara..."
                className="h-9 text-sm"
              />
              <Button size="sm" onClick={runDrawerSearch} disabled={drawerSearching}>
                {drawerSearching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
              </Button>
            </div>

            {drawerCandidates.length > 0 && (
              <div className="space-y-2">
                {drawerCandidates.map((c) => (
                  <div
                    key={c.id}
                    className="rounded-md border border-border bg-card p-3 text-xs"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium text-foreground">{c.partNo ?? '-'}</p>
                        <p className="text-muted-foreground truncate">{truncate(c.title, 48)}</p>
                        <p className="text-muted-foreground/70">{c.brandName}</p>
                        {c.refNo && (
                          <p className="mt-1 text-muted-foreground/70" title={c.refNo}>
                            ref_no: {truncate(c.refNo, 32)}
                          </p>
                        )}
                        {c.previewOemNo && (
                          <p className="mt-1 text-foreground">
                            OEM (önizleme): <span>{truncate(c.previewOemNo, 28)}</span>
                          </p>
                        )}
                      </div>
                      <Button
                        size="sm"
                        onClick={() => handleManualLink(c)}
                        disabled={drawerLinkingId === c.id}
                        className="h-7 shrink-0 text-xs"
                      >
                        {drawerLinkingId === c.id ? <Loader2 size={12} className="animate-spin" /> : <Link2 size={12} className="mr-1" />}
                        Eşleştir
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {drawerCandidates.length === 0 && drawerQuery.trim().length > 0 && !drawerSearching && (
              <p className="text-center text-xs text-muted-foreground py-4">
                Sonuç yok. Farklı bir terim deneyin.
              </p>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}