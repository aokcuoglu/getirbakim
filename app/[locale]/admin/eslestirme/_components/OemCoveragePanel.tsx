'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, RefreshCw, Search } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { getOemBrandCoverage, type OemCoverageBrandRow } from '@/lib/actions/admin-catalog'

const tr = (n: number) => n.toLocaleString('tr-TR')

/** Kaynak site kimliğinin panelde okunur karşılığı. */
const SOURCE_LABEL: Record<string, string> = {
  'repxpert.com.tr': 'REPXPERT',
  'partsfinder.bilsteingroup.com': 'bilstein',
  'tecalliance-catalog': 'TecAlliance'
}

/** Kapsamın nereden bilindiği — arama sonucu elle düzeltilebilir, arşiv sabittir. */
const RESOLVED_LABEL: Record<string, string> = {
  archive: 'arşiv',
  search: 'arama',
  builtin: 'sabit'
}

type Filter = 'uncovered' | 'covered' | 'all'

const FILTERS: { key: Filter; label: string; hint: string }[] = [
  { key: 'uncovered', label: 'Kapsam dışı', hint: 'OEM"i elle araştırılacak markalar' },
  { key: 'covered', label: 'Kapsanan', hint: 'Scraper"ın çekebildiği markalar' },
  { key: 'all', label: 'Tümü', hint: '' }
]

/**
 * Marka bazında OEM kaynak kapsamı.
 *
 * Panelin tek amacı işi ikiye ayırmak: kapsanan markalarda beklemek yeter,
 * KAPSAM DIŞI markaların OEM'i elle bulunmalı. Varsayılan görünüm bu yüzden
 * kapsam dışı olanlar ve en çok OEM'siz ürünü olan marka en üstte.
 */
export function OemCoveragePanel() {
  const [rows, setRows] = useState<OemCoverageBrandRow[]>([])
  const [filter, setFilter] = useState<Filter>('uncovered')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async (next: Filter) => {
    setLoading(true)
    try {
      setRows(
        await getOemBrandCoverage({
          covered: next === 'all' ? null : next === 'covered'
        })
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(filter)
  }, [filter, load])

  const visible = useMemo(() => {
    const q = query.trim().toUpperCase()
    return q ? rows.filter((r) => r.brand.toUpperCase().includes(q)) : rows
  }, [rows, query])

  const missingTotal = useMemo(
    () => visible.reduce((sum, r) => sum + r.missingOem, 0),
    [visible]
  )

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center gap-3 border-b border-border p-4">
        <div className="mr-auto">
          <p className="text-sm font-semibold text-foreground">Kaynak kapsamı</p>
          <p className="text-xs text-muted-foreground">
            Hangi markanın OEM&apos;i web kaynağından çekilebiliyor, hangisi elle araştırılmalı.
          </p>
        </div>

        <div className="flex rounded-md border border-border p-0.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              title={f.hint}
              onClick={() => setFilter(f.key)}
              className={`rounded px-3 py-1 text-xs font-semibold transition ${
                filter === f.key
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Marka ara"
            className="h-8 w-40 pl-7 text-xs"
          />
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={() => void load(filter)}
          disabled={loading}
          className="h-8"
        >
          {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
        </Button>
      </div>

      <div className="flex flex-wrap gap-4 border-b border-border px-4 py-2 text-xs text-muted-foreground">
        <span>
          <span className="font-semibold text-foreground">{tr(visible.length)}</span> marka
        </span>
        <span>
          OEM&apos;siz ürün:{' '}
          <span className="font-semibold text-foreground">{tr(missingTotal)}</span>
        </span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Yükleniyor…
        </div>
      ) : visible.length === 0 ? (
        <p className="p-8 text-center text-sm text-muted-foreground">Kayıt yok.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-4 py-2 font-medium">Marka</th>
                <th className="px-4 py-2 font-medium">Kaynak</th>
                <th className="px-4 py-2 text-right font-medium">Ürün</th>
                <th className="px-4 py-2 text-right font-medium">OEM&apos;siz</th>
                <th className="px-4 py-2 text-right font-medium">Bekleyen öneri</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.brandId} className="border-b border-border/50 last:border-0">
                  <td className="px-4 py-2 font-medium text-foreground">{r.brand}</td>
                  <td className="px-4 py-2">
                    {r.sourceSite ? (
                      <span className="flex items-center gap-1.5">
                        <Badge variant="outline" className="border-emerald-500/25 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                          {SOURCE_LABEL[r.sourceSite] ?? r.sourceSite}
                        </Badge>
                        {r.resolvedBy ? (
                          <span className="text-[11px] text-muted-foreground">
                            {RESOLVED_LABEL[r.resolvedBy] ?? r.resolvedBy}
                          </span>
                        ) : null}
                      </span>
                    ) : (
                      <Badge variant="outline" className="border-amber-500/25 bg-amber-500/15 text-amber-600 dark:text-amber-400">
                        elle
                      </Badge>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                    {tr(r.products)}
                  </td>
                  <td className="px-4 py-2 text-right font-semibold tabular-nums text-foreground">
                    {tr(r.missingOem)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                    {r.pendingSuggestions > 0 ? tr(r.pendingSuggestions) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
