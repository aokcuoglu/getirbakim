'use client'

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import { Check, ExternalLink, Loader2, RefreshCw, X } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  getCandidateProductPartLinks,
  getRefSuggestionSummary,
  getRefSuggestions,
  reviewProductPartLink,
  reviewRefSuggestions,
  type CandidateLinkRow,
  type RefSuggestionRow,
  type RefSuggestionSummary
} from '@/lib/actions/admin-catalog'

const tr = (n: number) => n.toLocaleString('tr-TR')

const CONFIDENCE_STYLE: Record<string, string> = {
  HIGH: 'border-emerald-500/25 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  MEDIUM: 'border-amber-500/25 bg-amber-500/15 text-amber-600 dark:text-amber-400',
  LOW: 'border-rose-500/25 bg-rose-500/15 text-rose-600 dark:text-rose-400'
}

/**
 * LINK  = katalog ürünü ↔ public.parts eşleşmesi (resim/özellik/araç açar)
 * OEM   = web'den toplanan OEM önerisi (source='WEB' ile yazılır)
 * NAME  = web'den toplanan SEO başlık önerisi (name_override'a geçer)
 */
type Mode = 'LINK' | 'OEM' | 'NAME'

const PAGE_SIZE = 50

export interface ApprovalQueueProps {
  /** Kapsam tablosundan seçilen marka; null = tüm markalar. */
  brand: string | null
  onClearBrand: () => void
  /** Bekleyen eşleşme linki sayısı (kapsam kırılımından). */
  pendingLinks: number
}

/**
 * Zenginleştirmenin tek onay kuyruğu.
 *
 * Üç kaynak da aynı işi yapıyordu — ürünü zenginleştirmek — ama üç ayrı başlık
 * altındaydı. Tek liste, üstte kaynak seçici: marka filtresi hepsinde ortak.
 */
export function ApprovalQueue({ brand, onClearBrand, pendingLinks }: ApprovalQueueProps) {
  const [mode, setMode] = useState<Mode>('LINK')
  const [links, setLinks] = useState<CandidateLinkRow[]>([])
  const [suggestions, setSuggestions] = useState<RefSuggestionRow[]>([])
  const [summary, setSummary] = useState<RefSuggestionSummary | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [pending, startTransition] = useTransition()

  const load = useCallback(async () => {
    setLoading(true)
    setSelected(new Set())
    try {
      // Öneri sayıları sekme rozetlerinde durur; hangi sekmede olursak olalım çekilir.
      const summaryPromise = getRefSuggestionSummary(brand)
      if (mode === 'LINK') {
        const [sum, rows] = await Promise.all([
          summaryPromise,
          getCandidateProductPartLinks({ brand, limit: PAGE_SIZE })
        ])
        setSummary(sum)
        setLinks(rows)
      } else {
        const [sum, rows] = await Promise.all([
          summaryPromise,
          getRefSuggestions({ brand, kind: mode, status: 'PENDING', limit: 200 })
        ])
        setSummary(sum)
        setSuggestions(rows)
      }
    } catch {
      toast.error('Onay kuyruğu yüklenemedi.')
    } finally {
      setLoading(false)
    }
  }, [brand, mode])

  useEffect(() => {
    void load()
  }, [load])

  const reviewLink = (linkId: string, decision: 'APPROVE' | 'REJECT') => {
    startTransition(async () => {
      const res = await reviewProductPartLink({ linkId, decision })
      if (!res.success) {
        toast.error(res.message)
        return
      }
      toast.success(res.message)
      setLinks((prev) => prev.filter((c) => c.linkId !== linkId))
    })
  }

  const reviewSuggestions = (ids: string[], decision: 'APPROVE' | 'REJECT') => {
    if (ids.length === 0) return
    startTransition(async () => {
      const res = await reviewRefSuggestions({ ids, decision })
      if (!res.success) {
        toast.error(res.message)
        return
      }
      toast.success(res.message)
      const done = new Set(ids)
      setSuggestions((prev) => prev.filter((r) => !done.has(r.id)))
      setSelected(new Set())
      void getRefSuggestionSummary(brand).then(setSummary).catch(() => undefined)
    })
  }

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const allSelected = suggestions.length > 0 && selected.size === suggestions.length

  const tabs = useMemo(
    () =>
      [
        // Eşleşme sayısı kapsam kırılımından gelir; o kırılım marka bazlı
        // değil, bu yüzden marka seçiliyken rozet gösterilmez — yanlış sayı
        // göstermektense hiç göstermemek doğru.
        { key: 'LINK' as const, label: 'Eşleşme', count: brand ? null : pendingLinks },
        { key: 'OEM' as const, label: 'Web OEM', count: summary?.pendingOem ?? 0 },
        { key: 'NAME' as const, label: 'Web ad', count: summary?.pendingName ?? 0 }
      ] satisfies { key: Mode; label: string; count: number | null }[],
    [brand, pendingLinks, summary]
  )

  const rowCount = mode === 'LINK' ? links.length : suggestions.length

  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center gap-3 border-b border-border p-4">
        <div className="mr-auto">
          {/* mb: çip satır yüksekliğini aşıyor, alttaki açıklamaya değiyordu. */}
          <h3 className="mb-1.5 flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
            Onay kuyruğu
            {brand ? (
              <button
                type="button"
                onClick={onClearBrand}
                title="Marka filtresini kaldır"
                className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary"
              >
                {brand}
                <X className="size-3" />
              </button>
            ) : (
              <span className="text-xs font-normal text-muted-foreground">tüm markalar</span>
            )}
          </h3>
          <p className="text-xs text-muted-foreground">
            {mode === 'LINK'
              ? `Onay anında resim/özellik/araç uyumluluğu görünür olur. İlk ${PAGE_SIZE} kayıt.`
              : "Onay = uygulama: OEM source='WEB' ile yazılır, ad isim override alanına geçer. İlk 200 kayıt."}
          </p>
        </div>

        <div className="flex rounded-md border border-border p-0.5">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setMode(t.key)}
              className={`rounded px-3 py-1 text-xs font-semibold transition ${
                mode === t.key
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t.label}
              {t.count == null ? '' : ` (${tr(t.count)})`}
            </button>
          ))}
        </div>

        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
        </Button>
      </div>

      {mode !== 'LINK' && rowCount > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
          <span className="text-xs text-muted-foreground">
            Uygulanmış:{' '}
            {tr(mode === 'OEM' ? (summary?.appliedOem ?? 0) : (summary?.appliedName ?? 0))} ·
            Reddedilmiş: {tr(summary?.rejected ?? 0)}
          </span>
          <div className="ml-auto flex items-center gap-1">
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() =>
                setSelected(allSelected ? new Set() : new Set(suggestions.map((r) => r.id)))
              }
            >
              {allSelected ? 'Seçimi bırak' : `Tümünü seç (${tr(suggestions.length)})`}
            </Button>
            <Button
              size="sm"
              disabled={pending || selected.size === 0}
              onClick={() => reviewSuggestions([...selected], 'APPROVE')}
            >
              {pending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              Seçileni onayla ({tr(selected.size)})
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={pending || selected.size === 0}
              onClick={() => reviewSuggestions([...selected], 'REJECT')}
            >
              <X className="h-4 w-4" />
              Reddet
            </Button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Yükleniyor…
        </div>
      ) : rowCount === 0 ? (
        <p className="p-8 text-center text-sm text-muted-foreground">
          {brand ? `${brand} markasında bekleyen kayıt yok.` : 'Bekleyen kayıt yok.'}
        </p>
      ) : mode === 'LINK' ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Katalog ürünü</th>
                <th className="px-4 py-2 text-left font-medium">Eşleşen parça</th>
                <th className="px-4 py-2 text-left font-medium">Yöntem</th>
                <th className="px-4 py-2 text-right font-medium">OEM</th>
                <th className="px-4 py-2 text-right font-medium">İşlem</th>
              </tr>
            </thead>
            <tbody>
              {links.map((c) => (
                <tr key={c.linkId} className="border-t border-border">
                  <td className="px-4 py-2">
                    <div className="font-medium">
                      {c.brandName} <span className="font-mono text-xs">{c.partNo}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">{c.productName}</div>
                  </td>
                  <td className="px-4 py-2">
                    <div className="font-medium">{c.partBrandName}</div>
                    <div className="text-xs text-muted-foreground">{c.partName}</div>
                  </td>
                  <td className="px-4 py-2">
                    <span className="font-mono text-xs">{c.matchMethod}</span>
                    {c.confidence != null && (
                      <span className="ml-1 text-xs text-muted-foreground">
                        ({c.confidence.toFixed(2)})
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{tr(c.oemCount)}</td>
                  <td className="px-4 py-2">
                    <div className="flex justify-end gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={() => reviewLink(c.linkId, 'APPROVE')}
                      >
                        <Check className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={() => reviewLink(c.linkId, 'REJECT')}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="w-8 px-3 py-2" />
                <th className="px-3 py-2 text-left font-medium">Ürün</th>
                <th className="px-3 py-2 text-left font-medium">
                  {mode === 'OEM' ? 'Önerilen OEM' : 'Önerilen başlık'}
                </th>
                <th className="px-3 py-2 text-left font-medium">Kaynak</th>
                <th className="px-3 py-2 text-right font-medium">İşlem</th>
              </tr>
            </thead>
            <tbody>
              {suggestions.map((r) => (
                <tr key={r.id} className="border-t border-border align-top">
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={selected.has(r.id)}
                      onChange={() => toggle(r.id)}
                      className="h-4 w-4 accent-foreground"
                      aria-label="Öneriyi seç"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium">
                      {r.brandName} <span className="font-mono text-xs">{r.partNo}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">{r.currentName}</div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap items-center gap-1">
                      {r.oemBrand && (
                        <span className="text-xs font-semibold text-muted-foreground">
                          {r.oemBrand}
                        </span>
                      )}
                      <span
                        className={mode === 'OEM' ? 'font-mono text-sm font-semibold' : 'text-sm'}
                      >
                        {r.value}
                      </span>
                      <Badge variant="outline" className={CONFIDENCE_STYLE[r.confidence] ?? ''}>
                        {r.confidence}
                      </Badge>
                    </div>
                    {r.evidence && (
                      <div className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">
                        {r.evidence}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {r.sourceUrl ? (
                      <a
                        href={r.sourceUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                      >
                        {r.sourceSite}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : (
                      <span className="text-xs text-muted-foreground">{r.sourceSite}</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={() => reviewSuggestions([r.id], 'APPROVE')}
                      >
                        <Check className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={() => reviewSuggestions([r.id], 'REJECT')}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
