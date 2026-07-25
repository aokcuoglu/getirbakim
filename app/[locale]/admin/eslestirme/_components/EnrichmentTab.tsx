'use client'

import { useCallback, useEffect, useState, useTransition } from 'react'
import { Check, Loader2, RefreshCw, X } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  getCandidateProductPartLinks,
  getEnrichmentCoverage,
  reviewProductPartLink,
  type CandidateLinkRow
} from '@/lib/actions/admin-catalog'
import type { CatalogEnrichmentCoverage } from '@/lib/admin/catalog-enrichment-stats'

const tr = (n: number) => n.toLocaleString('tr-TR')

function pct(part: number, total: number) {
  return total > 0 ? Math.round((part / total) * 100) : 0
}

function CoverageBar({
  label,
  value,
  total,
  tone = 'success'
}: {
  label: string
  value: number
  total: number
  tone?: 'success' | 'warning'
}) {
  const p = pct(value, total)
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-semibold text-foreground">{label}</p>
        <span className="text-xs font-semibold tabular-nums text-foreground">%{p}</span>
      </div>
      <div className="mb-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full ${tone === 'success' ? 'bg-success' : 'bg-warning'}`}
          style={{ width: `${p}%` }}
        />
      </div>
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span className="font-semibold text-foreground">{tr(value)}</span>
        <span>{tr(total)} toplam</span>
      </div>
    </div>
  )
}

const STATUS_STYLE: Record<string, string> = {
  CONFIRMED: 'border-emerald-500/25 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  CANDIDATE: 'border-amber-500/25 bg-amber-500/15 text-amber-600 dark:text-amber-400',
  REJECTED: 'border-rose-500/25 bg-rose-500/15 text-rose-600 dark:text-rose-400'
}

export function EnrichmentTab() {
  const [coverage, setCoverage] = useState<CatalogEnrichmentCoverage | null>(null)
  const [candidates, setCandidates] = useState<CandidateLinkRow[]>([])
  const [loading, setLoading] = useState(true)
  const [pending, startTransition] = useTransition()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [cov, cand] = await Promise.all([
        getEnrichmentCoverage(),
        getCandidateProductPartLinks({ limit: 50 })
      ])
      setCoverage(cov)
      setCandidates(cand)
    } catch {
      toast.error('Kapsama verisi yüklenemedi.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const review = (linkId: string, decision: 'APPROVE' | 'REJECT') => {
    startTransition(async () => {
      const res = await reviewProductPartLink({ linkId, decision })
      if (!res.success) {
        toast.error(res.message)
        return
      }
      toast.success(res.message)
      setCandidates((prev) => prev.filter((c) => c.linkId !== linkId))
    })
  }

  if (loading && !coverage) {
    return (
      <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Kapsama hesaplanıyor…
      </div>
    )
  }

  if (!coverage) return null

  const t = coverage.totals

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Zengin veri katalogda tutulmaz; onaylanmış eşleşmeler üzerinden{' '}
          <code className="rounded bg-muted px-1 py-0.5 text-[11px]">public.part_*</code>{' '}
          tablolarından canlı okunur.
        </p>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Yenile
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <CoverageBar label="parts'a bağlı" value={t.confirmedLinked} total={t.activeProducts} />
        <CoverageBar label="OEM'i var" value={t.withOem} total={t.activeProducts} />
        <CoverageBar label="Özelliği var" value={t.withProperties} total={t.activeProducts} />
        <CoverageBar label="Resmi var" value={t.withImages} total={t.activeProducts} />
        <CoverageBar label="Araç uyumluluğu var" value={t.withVehicles} total={t.activeProducts} />
        <CoverageBar label="EAN'i var" value={t.withEans} total={t.activeProducts} />
        <CoverageBar
          label="Onay bekliyor"
          value={t.candidateOnly}
          total={t.activeProducts}
          tone="warning"
        />
        <CoverageBar
          label="Hiç bağlanmamış"
          value={t.unlinked}
          total={t.activeProducts}
          tone="warning"
        />
      </div>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-foreground">Eşleşme yöntemleri</h3>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Durum</th>
                <th className="px-3 py-2 text-left font-medium">Yöntem</th>
                <th className="px-3 py-2 text-right font-medium">Link</th>
                <th className="px-3 py-2 text-right font-medium">Ürün</th>
              </tr>
            </thead>
            <tbody>
              {coverage.linkBreakdown.map((r) => (
                <tr key={`${r.status}-${r.matchMethod}`} className="border-t border-border">
                  <td className="px-3 py-2">
                    <Badge variant="outline" className={STATUS_STYLE[r.status] ?? ''}>
                      {r.status}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{r.matchMethod}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{tr(r.links)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{tr(r.products)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-foreground">
          En çok boşluğu olan markalar
        </h3>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Marka</th>
                <th className="px-3 py-2 text-right font-medium">Aktif ürün</th>
                <th className="px-3 py-2 text-right font-medium">Bağlı</th>
                <th className="px-3 py-2 text-right font-medium">Onay bekleyen</th>
                <th className="px-3 py-2 text-right font-medium">Bağlı değil</th>
              </tr>
            </thead>
            <tbody>
              {coverage.topGapBrands.map((b) => (
                <tr key={b.brand} className="border-t border-border">
                  <td className="px-3 py-2 font-medium">{b.brand}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{tr(b.activeProducts)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-success">
                    {tr(b.confirmedLinked)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-warning">
                    {tr(b.candidateOnly)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                    {tr(b.activeProducts - b.confirmedLinked - b.candidateOnly)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-foreground">
          Onay kuyruğu{' '}
          <span className="text-xs font-normal text-muted-foreground">
            (ilk {candidates.length} kayıt)
          </span>
        </h3>
        {candidates.length === 0 ? (
          <p className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground">
            İncelenecek eşleşme yok.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Katalog ürünü</th>
                  <th className="px-3 py-2 text-left font-medium">Eşleşen parça</th>
                  <th className="px-3 py-2 text-left font-medium">Yöntem</th>
                  <th className="px-3 py-2 text-right font-medium">OEM</th>
                  <th className="px-3 py-2 text-right font-medium">İşlem</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((c) => (
                  <tr key={c.linkId} className="border-t border-border">
                    <td className="px-3 py-2">
                      <div className="font-medium">
                        {c.brandName} <span className="font-mono text-xs">{c.partNo}</span>
                      </div>
                      <div className="text-xs text-muted-foreground">{c.productName}</div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{c.partBrandName}</div>
                      <div className="text-xs text-muted-foreground">{c.partName}</div>
                    </td>
                    <td className="px-3 py-2">
                      <span className="font-mono text-xs">{c.matchMethod}</span>
                      {c.confidence != null && (
                        <span className="ml-1 text-xs text-muted-foreground">
                          ({c.confidence.toFixed(2)})
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{tr(c.oemCount)}</td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={pending}
                          onClick={() => review(c.linkId, 'APPROVE')}
                        >
                          <Check className="h-4 w-4" />
                          Onayla
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={pending}
                          onClick={() => review(c.linkId, 'REJECT')}
                        >
                          <X className="h-4 w-4" />
                          Reddet
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          Onaydan sonra resim/özellik/araç uyumluluğu anında görünür. OEM'ler toplu türetmeyle
          akar: <code className="rounded bg-muted px-1 py-0.5">bun scripts/derive-oems-from-part-links.ts</code>
        </p>
      </section>
    </div>
  )
}
