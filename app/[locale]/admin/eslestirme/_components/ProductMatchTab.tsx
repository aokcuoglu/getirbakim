'use client'

import { useCallback, useEffect, useState } from 'react'
import { ChevronRight, Loader2, Play, Package, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  PRODUCT_LIST_SUPPLIERS,
  PRODUCT_LIST_SUPPLIER_LABELS,
  type ProductMatchCandidateGroup,
  type ProductMatchOverview,
  type ProductMatchRunResult,
  type SupplierCoverage
} from '@/lib/admin/product-match-shared'
import { ProductMatchCandidateSheet } from './ProductMatchCandidateSheet'
import { ProductListTab } from './ProductListTab'

const DOT: Record<string, string> = {
  dinamik: 'bg-blue-500',
  basbug: 'bg-violet-500'
}

function SupplierCoverageCard({ cov }: { cov: SupplierCoverage }) {
  const pct = cov.total > 0 ? Math.round((cov.linked / cov.total) * 100) : 0
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-1.5">
          <span className={`inline-block h-2 w-2 rounded-full ${DOT[cov.supplier]}`} />
          <p className="text-sm font-semibold text-foreground">
            {PRODUCT_LIST_SUPPLIER_LABELS[cov.supplier]}
          </p>
        </span>
        <span className="text-xs font-semibold tabular-nums text-foreground">%{pct}</span>
      </div>
      <div className="mb-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-success" style={{ width: `${pct}%` }} />
      </div>
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>
          <span className="font-semibold text-success">{cov.linked.toLocaleString('tr-TR')}</span> eşleşen
        </span>
        <span>
          <span className="font-semibold text-warning">{cov.unlinked.toLocaleString('tr-TR')}</span> kalan
        </span>
        <span>{cov.total.toLocaleString('tr-TR')} toplam</span>
      </div>
    </div>
  )
}

function SummaryStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col">
      <span className="text-lg font-semibold tabular-nums tracking-tight text-foreground">
        {value.toLocaleString('tr-TR')}
      </span>
      <span className="text-[11px] text-muted-foreground">{label}</span>
    </div>
  )
}

export function ProductMatchTab() {
  const [overview, setOverview] = useState<ProductMatchOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [lastRun, setLastRun] = useState<ProductMatchRunResult | null>(null)
  const [candidateGroups, setCandidateGroups] = useState<ProductMatchCandidateGroup[]>([])
  const [candidatesLoading, setCandidatesLoading] = useState(false)
  const [selectedGroup, setSelectedGroup] = useState<ProductMatchCandidateGroup | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)

  const loadOverview = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/eslestirme/products')
      const data = await res.json()
      if (!res.ok || data.error) {
        toast.error(data?.error?.message || 'Kapsama verisi yüklenemedi.')
        return
      }
      setOverview(data)
    } catch {
      toast.error('Kapsama verisi yüklenirken hata oluştu.')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadCandidates = useCallback(async () => {
    setCandidatesLoading(true)
    try {
      const res = await fetch('/api/admin/eslestirme/products/candidates?limit=50')
      const data = await res.json()
      if (!res.ok || data.error) {
        toast.error(data?.error?.message || 'Bekleyen adaylar yüklenemedi.')
        return
      }
      setCandidateGroups(data.groups ?? [])
    } catch {
      toast.error('Bekleyen adaylar yüklenirken hata oluştu.')
    } finally {
      setCandidatesLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadOverview()
    void loadCandidates()
  }, [loadOverview, loadCandidates])

  const openGroup = useCallback((group: ProductMatchCandidateGroup) => {
    setSelectedGroup(group)
    setSheetOpen(true)
  }, [])

  const onResolved = useCallback(() => {
    void loadOverview()
    void loadCandidates()
  }, [loadOverview, loadCandidates])

  const runMatching = useCallback(async () => {
    setRunning(true)
    setLastRun(null)
    try {
      const res = await fetch('/api/admin/eslestirme/products/run', { method: 'POST' })
      const data = await res.json()
      if (!res.ok || data.error) {
        toast.error(data?.error?.message || 'Eşleştirme çalıştırılamadı.')
        return
      }
      setLastRun(data)
      const created = (data.dinamik?.productsCreated ?? 0) + (data.basbug?.productsCreated ?? 0)
      const linked = (data.dinamik?.offersLinked ?? 0) + (data.basbug?.offersLinked ?? 0)
      toast.success(`Eşleştirme tamam: +${created} ürün, +${linked} offer.`)
      await Promise.all([loadOverview(), loadCandidates()])
    } catch {
      toast.error('Eşleştirme sırasında hata oluştu.')
    } finally {
      setRunning(false)
    }
  }, [loadOverview, loadCandidates])

  const unmatchedTotal = overview
    ? overview.suppliers.reduce((sum, s) => sum + s.unlinked, 0)
    : 0

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Ürün Eşleştirme</h3>
          <p className="text-xs text-muted-foreground">
            Onaylı markalar altındaki ürünleri kanonik kataloğa bağlayın. Otomatik akış Dinamik ve
            Başbuğ&apos;u offer olarak bağlar.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onResolved()}
            disabled={loading || running || candidatesLoading}
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${loading || candidatesLoading ? 'animate-spin' : ''}`} />
            Yenile
          </Button>
          <Button size="sm" onClick={() => void runMatching()} disabled={running}>
            {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
            {running ? 'Çalışıyor…' : 'Eşleştirmeyi çalıştır'}
          </Button>
        </div>
      </div>

      {/* Kompakt özet şeridi */}
      <div className="flex flex-wrap items-center gap-x-8 gap-y-3 rounded-lg border border-border bg-card px-5 py-3">
        <SummaryStat label="Kanonik Ürün" value={overview?.canonicalProducts ?? 0} />
        <SummaryStat label="Toplam Offer" value={overview?.totalOffers ?? 0} />
        <SummaryStat label="İki Tedarikçili Ürün" value={overview?.dualSupplierProducts ?? 0} />
        <SummaryStat label="Bekleyen İnceleme" value={overview?.pendingCandidates ?? 0} />
      </div>

      {/* Firma bazlı kapsama (Dinamik / Başbuğ) */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {overview
          ? overview.suppliers.map((cov) => <SupplierCoverageCard key={cov.supplier} cov={cov} />)
          : PRODUCT_LIST_SUPPLIERS.map((k) => (
              <div key={k} className="h-24 animate-pulse rounded-lg border border-border bg-muted/40" />
            ))}
      </div>

      {/* Ürün listesi — kapsama kartlarının altında satır bazında tablo + satır içi eşleştirme */}
      <ProductListTab onMatched={onResolved} />

      {/* Bekleyen belirsiz eşleştirmeler */}
      <div className="rounded-md border border-border bg-card">
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Package className="h-4 w-4 text-muted-foreground" />
            <p className="text-sm font-semibold text-foreground">Bekleyen eşleştirmeler</p>
            <Badge variant="outline" className="text-[11px]">
              {overview?.pendingCandidates ?? candidateGroups.length}
            </Badge>
          </div>
          {candidatesLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>

        {candidateGroups.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-muted-foreground">
            {candidatesLoading
              ? 'Yükleniyor…'
              : 'Bekleyen belirsiz eşleştirme yok. OEM birden çok ürüne denk gelen satırlar burada listelenir.'}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {candidateGroups.map((g) => (
              <li key={`${g.supplier}:${g.supplierProductId}`}>
                <button
                  type="button"
                  onClick={() => openGroup(g)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/50"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {g.supplierName || g.supplierSku}
                    </p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {PRODUCT_LIST_SUPPLIER_LABELS[g.supplier]} · SKU: {g.supplierSku}
                      {g.brandName ? ` · ${g.brandName}` : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant="outline" className="text-[11px]">
                      {g.candidates.length} aday
                    </Badge>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ProductMatchCandidateSheet
        group={selectedGroup}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onResolved={onResolved}
      />

      {/* Son çalıştırma günlüğü */}
      {lastRun && (
        <div className="rounded-md border border-border bg-card p-4">
          <div className="mb-2 flex items-center gap-2">
            <Package className="h-4 w-4 text-muted-foreground" />
            <p className="text-sm font-semibold">Son çalıştırma</p>
          </div>
          <ul className="space-y-1 font-mono text-xs text-muted-foreground">
            {lastRun.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      )}

      {overview && unmatchedTotal === 0 && overview.canonicalProducts === 0 && (
        <p className="text-xs text-muted-foreground">
          Henüz onaylı marka altında eşleştirilecek ürün yok. Önce Marka Eşleştirme sekmesinden
          markaları onaylayın, sonra buradan eşleştirmeyi çalıştırın.
        </p>
      )}
    </div>
  )
}
