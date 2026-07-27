'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import type {
  CatalogEnrichmentCoverage,
  EnrichmentTotals
} from '@/lib/admin/catalog-enrichment-stats'
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

/** Kapsam gelene kadar kartların yerini tutar — sayfa zıplamasın. */
function StatTileSkeleton() {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="h-3 w-24 animate-pulse rounded bg-muted" />
      <div className="mt-2 h-6 w-20 animate-pulse rounded bg-muted" />
      <div className="mt-2 h-1 w-full rounded-full bg-muted" />
    </div>
  )
}

const TILES: { key: keyof EnrichmentTotals; label: string; tone?: 'success' | 'warning' }[] = [
  { key: 'confirmedLinked', label: "parts'a bağlı" },
  { key: 'withOem', label: "OEM'i var" },
  { key: 'withProperties', label: 'Özelliği var' },
  { key: 'withImages', label: 'Resmi var' },
  { key: 'withVehicles', label: 'Araç uyumluluğu var' },
  { key: 'withEans', label: "EAN'i var" },
  { key: 'candidateOnly', label: 'Onay bekliyor', tone: 'warning' },
  { key: 'unlinked', label: 'Hiç bağlanmamış', tone: 'warning' }
]

/**
 * Zenginleştirme sekmesi: kapsam → kaynak → onay kuyruğu.
 *
 * Sayfa üç bloktan ibaret. Kırılım tabloları (eşleşme yöntemi, marka boşluğu)
 * günlük iş değil kartların açıklaması olduğu için modale alındı; üç ayrı onay
 * listesi ise tek kuyruğa toplandı.
 *
 * Üç blok da kendi verisini bağımsız çeker ve kapsamı BEKLEMEZ. Eskiden kapsam
 * gelene kadar alt paneller mount bile edilmiyordu; server action kuyruğuyla
 * birleşince sekme ~23 sn'de doluyordu.
 */
export function EnrichmentTab() {
  const [coverage, setCoverage] = useState<CatalogEnrichmentCoverage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [brand, setBrand] = useState<string | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async (fresh = false) => {
    setLoading(true)
    try {
      const res = await fetch(
        `/api/admin/eslestirme/enrichment/coverage${fresh ? '?fresh=1' : ''}`
      )
      // Gövde JSON olmayabilir (Next'in gövdesiz 500'ü gibi); parse hatası gerçek
      // sebebi yutmasın diye ayrı yakalanır.
      const data = await res.json().catch(() => null)
      if (!res.ok || data?.error) {
        const message =
          data?.error?.message || `Kapsama verisi yüklenemedi. (HTTP ${res.status})`
        setError(message)
        toast.error(message)
        return
      }
      setError(null)
      setCoverage(data as CatalogEnrichmentCoverage)
    } catch {
      const message = 'Kapsama verisi yüklenemedi: sunucuya ulaşılamadı.'
      setError(message)
      toast.error(message)
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

  const t = coverage?.totals ?? null

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {t ? (
            <>
              <span className="font-semibold text-foreground">{tr(t.activeProducts)}</span> aktif
              ürün ·{' '}
            </>
          ) : (
            'Kapsam hesaplanıyor · '
          )}
          zengin veri katalogda tutulmaz, onaylanmış eşleşmeler üzerinden{' '}
          <code className="rounded bg-muted px-1 py-0.5 text-[11px]">public.part_*</code>{' '}
          tablolarından canlı okunur. Karta tıklayın: kırılım açılır.
        </p>
        <Button variant="outline" size="sm" onClick={() => void load(true)} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Yenile
        </Button>
      </div>

      {/* Hata iskeletle gösterilemez: kartlar sonsuza kadar "yükleniyor" gibi
          durur, toast da kaybolur. Sebep sayılarla aynı yerde kalsın. */}
      {error && !t ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <p className="text-sm font-medium text-foreground">Kapsam hesaplanamadı</p>
          <p className="mt-1 text-sm text-muted-foreground">{error}</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => void load(true)}
            disabled={loading}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Tekrar dene
          </Button>
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {TILES.map((tile) =>
            t ? (
              <StatTile
                key={tile.key}
                label={tile.label}
                value={t[tile.key]}
                total={t.activeProducts}
                tone={tile.tone}
                onClick={() => setDetailOpen(true)}
              />
            ) : (
              <StatTileSkeleton key={tile.key} />
            )
          )}
        </div>
      )}

      {coverage && (
        <CoverageDetailDialog
          open={detailOpen}
          onOpenChange={setDetailOpen}
          coverage={coverage}
          onSelectBrand={setBrand}
        />
      )}

      {/* Kapsam önce gelir: hangi markanın beklemeye, hangisinin elle işe
          gideceği belli olmadan kuyruğa bakmanın sırası yok. */}
      <div className="rounded-lg border border-border bg-card">
        <OemCoveragePanel selectedBrand={brand} onSelectBrand={setBrand} />
      </div>

      {/* Onaydan sonra toplamlar bilerek yeniden hesaplanmaz: kapsam sorgusu
          birkaç saniye sürüyor, her tıklamada koşturmak kuyruğu kullanılmaz
          yapardı. Satır anında listeden düşer, sayımlar "Yenile" ile tazelenir
          (onay zaten önbellek tag'ini düşürür). */}
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
