'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Play, Package, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { AdminKpiCard, AdminKpiGrid } from '@/components/admin/data-table/admin-kpi-card'
import {
  PRODUCT_SUPPLIER_KEYS,
  PRODUCT_SUPPLIER_LABELS,
  type ProductMatchOverview,
  type ProductMatchRunResult,
  type SupplierCoverage
} from '@/lib/admin/product-match-shared'

function SupplierCoverageCard({ cov }: { cov: SupplierCoverage }) {
  const pct = cov.total > 0 ? Math.round((cov.linked / cov.total) * 100) : 0
  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-semibold text-foreground">{PRODUCT_SUPPLIER_LABELS[cov.supplier]}</p>
        <span className="text-xs text-muted-foreground">%{pct} eşleşmiş</span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div>
          <p className="text-lg font-semibold tracking-tight">{cov.total.toLocaleString('tr-TR')}</p>
          <p className="text-[11px] text-muted-foreground">Onaylı marka altı</p>
        </div>
        <div>
          <p className="text-lg font-semibold tracking-tight text-success">{cov.linked.toLocaleString('tr-TR')}</p>
          <p className="text-[11px] text-muted-foreground">Eşleşmiş</p>
        </div>
        <div>
          <p className="text-lg font-semibold tracking-tight text-warning">{cov.unlinked.toLocaleString('tr-TR')}</p>
          <p className="text-[11px] text-muted-foreground">Eşleşmeyen</p>
        </div>
      </div>
    </div>
  )
}

export function ProductMatchTab() {
  const [overview, setOverview] = useState<ProductMatchOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [lastRun, setLastRun] = useState<ProductMatchRunResult | null>(null)

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

  useEffect(() => {
    void loadOverview()
  }, [loadOverview])

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
      await loadOverview()
    } catch {
      toast.error('Eşleştirme sırasında hata oluştu.')
    } finally {
      setRunning(false)
    }
  }, [loadOverview])

  const unmatchedTotal = overview
    ? overview.suppliers.reduce((sum, s) => sum + s.unlinked, 0)
    : 0

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Ürün Eşleştirme</h3>
          <p className="text-xs text-muted-foreground">
            Onaylı markalar altındaki Dinamik ve Başbuğ ürünlerini kanonik kataloğa (products +
            offers) otomatik bağlar. Parçatedarik ürünleri bu akışa dahil değildir.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void loadOverview()} disabled={loading || running}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Yenile
          </Button>
          <Button size="sm" onClick={() => void runMatching()} disabled={running}>
            {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
            {running ? 'Çalışıyor…' : 'Eşleştirmeyi çalıştır'}
          </Button>
        </div>
      </div>

      {/* Kanonik toplamlar */}
      <AdminKpiGrid>
        <AdminKpiCard label="Kanonik Ürün" value={overview?.canonicalProducts ?? 0} tone="default" />
        <AdminKpiCard label="Toplam Offer" value={overview?.totalOffers ?? 0} tone="default" />
        <AdminKpiCard label="Eşleşmeyen (toplam)" value={unmatchedTotal} tone="warning" />
        <AdminKpiCard
          label="Firma"
          value={PRODUCT_SUPPLIER_KEYS.length}
          tone="info"
          subtitle="Dinamik + Başbuğ"
        />
      </AdminKpiGrid>

      {/* Firma bazlı kapsama */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {overview
          ? overview.suppliers.map((cov) => <SupplierCoverageCard key={cov.supplier} cov={cov} />)
          : PRODUCT_SUPPLIER_KEYS.map((k) => (
              <div key={k} className="h-28 animate-pulse rounded-lg border border-border bg-muted/40" />
            ))}
      </div>

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
