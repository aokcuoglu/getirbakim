'use client'

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import { Check, ExternalLink, Loader2, RefreshCw, X } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  getRefSuggestionSummary,
  getRefSuggestions,
  reviewRefSuggestions,
  type RefSuggestionRow,
  type RefSuggestionSummary
} from '@/lib/actions/admin-catalog'

const tr = (n: number) => n.toLocaleString('tr-TR')

const CONFIDENCE_STYLE: Record<string, string> = {
  HIGH: 'border-emerald-500/25 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  MEDIUM: 'border-amber-500/25 bg-amber-500/15 text-amber-600 dark:text-amber-400',
  LOW: 'border-rose-500/25 bg-rose-500/15 text-rose-600 dark:text-rose-400'
}

type KindFilter = 'OEM' | 'NAME'

/**
 * Web'den toplanan OEM / SEO ad önerilerinin inceleme kuyruğu.
 * Onay = uygulama: OEM catalog.product_oems'e source='WEB' ile, ad ise
 * product_overrides.name_override'a yazılır (bkz. reviewRefSuggestions).
 */
export function WebSuggestionsPanel() {
  const [summary, setSummary] = useState<RefSuggestionSummary | null>(null)
  const [rows, setRows] = useState<RefSuggestionRow[]>([])
  const [kind, setKind] = useState<KindFilter>('OEM')
  const [brand, setBrand] = useState('ABA')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [pending, startTransition] = useTransition()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const brandFilter = brand.trim() || null
      const [sum, list] = await Promise.all([
        getRefSuggestionSummary(brandFilter),
        getRefSuggestions({ brand: brandFilter, kind, status: 'PENDING', limit: 200 })
      ])
      setSummary(sum)
      setRows(list)
      setSelected(new Set())
    } catch {
      toast.error('Öneriler yüklenemedi.')
    } finally {
      setLoading(false)
    }
  }, [brand, kind])

  useEffect(() => {
    void load()
  }, [load])

  const allSelected = rows.length > 0 && selected.size === rows.length

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const review = (ids: string[], decision: 'APPROVE' | 'REJECT') => {
    if (ids.length === 0) return
    startTransition(async () => {
      const res = await reviewRefSuggestions({ ids, decision })
      if (!res.success) {
        toast.error(res.message)
        return
      }
      toast.success(res.message)
      const done = new Set(ids)
      setRows((prev) => prev.filter((r) => !done.has(r.id)))
      setSelected(new Set())
      void getRefSuggestionSummary(brand.trim() || null)
        .then(setSummary)
        .catch(() => undefined)
    })
  }

  const counts = useMemo(
    () => ({
      pending: kind === 'OEM' ? (summary?.pendingOem ?? 0) : (summary?.pendingName ?? 0),
      applied: kind === 'OEM' ? (summary?.appliedOem ?? 0) : (summary?.appliedName ?? 0)
    }),
    [kind, summary]
  )

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Web önerileri</h3>
          <p className="text-xs text-muted-foreground">
            Açık web kataloglarından toplanan OEM ve SEO başlık önerileri. Onaylanan OEM{' '}
            <code className="rounded bg-muted px-1 py-0.5">source=&apos;WEB&apos;</code> ile yazılır,
            ad ise isim override alanına geçer.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
            placeholder="Marka (boş = tümü)"
            className="h-8 w-40"
          />
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Yenile
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={kind === 'OEM' ? 'default' : 'outline'}
          onClick={() => setKind('OEM')}
        >
          OEM ({tr(summary?.pendingOem ?? 0)})
        </Button>
        <Button
          size="sm"
          variant={kind === 'NAME' ? 'default' : 'outline'}
          onClick={() => setKind('NAME')}
        >
          Ad ({tr(summary?.pendingName ?? 0)})
        </Button>
        <span className="text-xs text-muted-foreground">
          Uygulanmış: {tr(counts.applied)} · Reddedilmiş: {tr(summary?.rejected ?? 0)}
        </span>

        <div className="ml-auto flex items-center gap-1">
          <Button
            size="sm"
            variant="outline"
            disabled={pending || rows.length === 0}
            onClick={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))}
          >
            {allSelected ? 'Seçimi bırak' : `Tümünü seç (${tr(rows.length)})`}
          </Button>
          <Button
            size="sm"
            disabled={pending || selected.size === 0}
            onClick={() => review([...selected], 'APPROVE')}
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Seçileni onayla ({tr(selected.size)})
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={pending || selected.size === 0}
            onClick={() => review([...selected], 'REJECT')}
          >
            <X className="h-4 w-4" />
            Reddet
          </Button>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground">
          {loading ? 'Yükleniyor…' : 'Bekleyen öneri yok.'}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="w-8 px-3 py-2" />
                <th className="px-3 py-2 text-left font-medium">Ürün</th>
                <th className="px-3 py-2 text-left font-medium">
                  {kind === 'OEM' ? 'Önerilen OEM' : 'Önerilen başlık'}
                </th>
                <th className="px-3 py-2 text-left font-medium">Kaynak</th>
                <th className="px-3 py-2 text-right font-medium">İşlem</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
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
                        className={kind === 'OEM' ? 'font-mono text-sm font-semibold' : 'text-sm'}
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
                        onClick={() => review([r.id], 'APPROVE')}
                      >
                        <Check className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={() => review([r.id], 'REJECT')}
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

      <p className="text-xs text-muted-foreground">
        Toplama:{' '}
        <code className="rounded bg-muted px-1 py-0.5">
          bun scripts/harvest-brand-refs.ts --site=all
        </code>{' '}
        →{' '}
        <code className="rounded bg-muted px-1 py-0.5">
          bun scripts/ingest-ref-suggestions.ts --brand=ABA --file=.data/harvest/aba.jsonl
        </code>
      </p>
    </section>
  )
}
