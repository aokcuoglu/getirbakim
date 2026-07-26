'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { getEnrichmentCoverage } from '@/lib/actions/admin-catalog'
import type { CatalogEnrichmentCoverage } from '@/lib/admin/catalog-enrichment-stats'
import { ApprovalQueue } from './ApprovalQueue'
import { CoverageDetailDialog } from './CoverageDetailDialog'
import { OemCoveragePanel } from './OemCoveragePanel'

const tr = (n: number) => n.toLocaleString('tr-TR')

function pct(part: number, total: number) {
  return total > 0 ? Math.round((part / total) * 100) : 0
}

/** Kapsam kartı — tıklama kırılım modalını açar. */
function StatTile({
  label,
  value,
  total,
  tone = 'success',
  onClick
}: {
  label: string
  value: number
  total: number
  tone?: 'success' | 'warning'
  onClick: () => void
}) {
  const p = pct(value, total)
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg border border-border bg-card p-3 text-left transition hover:border-primary/40 hover:bg-muted/40"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-xs text-muted-foreground">{label}</span>
        <span className="text-xs font-semibold tabular-nums text-muted-foreground">%{p}</span>
      </div>
      <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">{tr(value)}</p>
      <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full ${tone === 'success' ? 'bg-success' : 'bg-warning'}`}
          style={{ width: `${p}%` }}
        />
      </div>
    </button>
  )
}

/**
 * Zenginleştirme sekmesi: kapsam → kaynak → onay kuyruğu.
 *
 * Sayfa üç bloktan ibaret. Kırılım tabloları (eşleşme yöntemi, marka boşluğu)
 * günlük iş değil kartların açıklaması olduğu için modale alındı; üç ayrı onay
 * listesi ise tek kuyruğa toplandı.
 */
export function EnrichmentTab() {
  const [coverage, setCoverage] = useState<CatalogEnrichmentCoverage | null>(null)
  const [brand, setBrand] = useState<string | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setCoverage(await getEnrichmentCoverage())
    } catch {
      toast.error('Kapsama verisi yüklenemedi.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const clearBrand = useCallback(() => setBrand(null), [])

  const pendingLinks = useMemo(
    () =>
      (coverage?.linkBreakdown ?? [])
        .filter((r) => r.status === 'CANDIDATE')
        .reduce((n, r) => n + r.links, 0),
    [coverage]
  )

  if (loading && !coverage) {
    return (
      <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Kapsam hesaplanıyor…
      </div>
    )
  }

  if (!coverage) return null

  const t = coverage.totals

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">{tr(t.activeProducts)}</span> aktif ürün ·
          zengin veri katalogda tutulmaz, onaylanmış eşleşmeler üzerinden{' '}
          <code className="rounded bg-muted px-1 py-0.5 text-[11px]">public.part_*</code>{' '}
          tablolarından canlı okunur. Karta tıklayın: kırılım açılır.
        </p>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Yenile
        </Button>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="parts'a bağlı"
          value={t.confirmedLinked}
          total={t.activeProducts}
          onClick={() => setDetailOpen(true)}
        />
        <StatTile
          label="OEM'i var"
          value={t.withOem}
          total={t.activeProducts}
          onClick={() => setDetailOpen(true)}
        />
        <StatTile
          label="Özelliği var"
          value={t.withProperties}
          total={t.activeProducts}
          onClick={() => setDetailOpen(true)}
        />
        <StatTile
          label="Resmi var"
          value={t.withImages}
          total={t.activeProducts}
          onClick={() => setDetailOpen(true)}
        />
        <StatTile
          label="Araç uyumluluğu var"
          value={t.withVehicles}
          total={t.activeProducts}
          onClick={() => setDetailOpen(true)}
        />
        <StatTile
          label="EAN'i var"
          value={t.withEans}
          total={t.activeProducts}
          onClick={() => setDetailOpen(true)}
        />
        <StatTile
          label="Onay bekliyor"
          value={t.candidateOnly}
          total={t.activeProducts}
          tone="warning"
          onClick={() => setDetailOpen(true)}
        />
        <StatTile
          label="Hiç bağlanmamış"
          value={t.unlinked}
          total={t.activeProducts}
          tone="warning"
          onClick={() => setDetailOpen(true)}
        />
      </div>

      <CoverageDetailDialog
        open={detailOpen}
        onOpenChange={setDetailOpen}
        coverage={coverage}
        onSelectBrand={setBrand}
      />

      {/* Kapsam önce gelir: hangi markanın beklemeye, hangisinin elle işe
          gideceği belli olmadan kuyruğa bakmanın sırası yok. */}
      <div className="rounded-lg border border-border bg-card">
        <OemCoveragePanel selectedBrand={brand} onSelectBrand={setBrand} />
      </div>

      {/* Onaydan sonra toplamlar bilerek yeniden hesaplanmaz: kapsam sorgusu
          ~8 sn sürüyor, her tıklamada koşturmak kuyruğu kullanılmaz yapardı.
          Satır anında listeden düşer, sayımlar "Yenile" ile tazelenir. */}
      <ApprovalQueue brand={brand} onClearBrand={clearBrand} pendingLinks={pendingLinks} />

      <p className="text-xs text-muted-foreground">
        OEM türetme:{' '}
        <code className="rounded bg-muted px-1 py-0.5">
          bun scripts/derive-oems-from-part-links.ts
        </code>{' '}
        · web toplama:{' '}
        <code className="rounded bg-muted px-1 py-0.5">
          bun scripts/harvest-brand-refs.ts --site=all
        </code>
      </p>
    </div>
  )
}
