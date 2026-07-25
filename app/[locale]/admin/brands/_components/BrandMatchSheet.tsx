'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Search, ArrowRight, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet'
import type { AdminApprovedBrandRow } from '@/lib/admin/approved-dnbrd-catalog'

interface BrandMatchSheetProps {
  /** Source brand_list row to match into a target. */
  source: AdminApprovedBrandRow | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called after a successful merge to refresh the parent list. */
  onLinked?: () => void
}

interface BrandListCandidate {
  id: number
  brand: string
  logo_url: string | null
  dnmk_count: number
}

export function BrandMatchSheet({
  source,
  open,
  onOpenChange,
  onLinked
}: BrandMatchSheetProps) {
  const [query, setQuery] = useState('')
  const [candidates, setCandidates] = useState<BrandListCandidate[]>([])
  const [searching, setSearching] = useState(false)
  const [merging, setMerging] = useState(false)
  const [selectedTarget, setSelectedTarget] = useState<BrandListCandidate | null>(null)

  const runSearch = useCallback(
    async (q: string) => {
      if (q.trim().length === 0) {
        setCandidates([])
        return
      }
      setSearching(true)
      try {
        const params = new URLSearchParams({ q, limit: '50' })
        const res = await fetch(`/api/admin/catalog/brands?${params.toString()}`)
        if (!res.ok) {
          toast.error('Marka araması başarısız.')
          return
        }
        const data = await res.json()
        // Exclude the source itself from results
        const rows: BrandListCandidate[] = (data.rows || [])
          .filter((r: { id: number }) => r.id !== source?.id)
          .map((r: { id: number; normalizedName: string; logoUrl: string | null; mappings: Array<{ dnmkBrandsId: string | null }> }) => ({
            id: r.id,
            brand: r.normalizedName,
            logo_url: r.logoUrl,
            dnmk_count: r.mappings.filter((m: { dnmkBrandsId: string | null }) => m.dnmkBrandsId).length,
          }))
        setCandidates(rows)
      } catch {
        toast.error('Marka araması sırasında hata.')
      } finally {
        setSearching(false)
      }
    },
    [source?.id]
  )

  // Debounce-lite: search on query change after 300ms
  useEffect(() => {
    const t = setTimeout(() => {
      if (query.trim().length > 0) runSearch(query)
      else setCandidates([])
    }, 300)
    return () => clearTimeout(t)
  }, [query, runSearch])

  // Reset state when sheet opens/closes
  useEffect(() => {
    if (!open) {
      setQuery('')
      setCandidates([])
      setSelectedTarget(null)
    }
  }, [open])

  const handleMerge = async () => {
    if (!source || !selectedTarget) return

    setMerging(true)
    try {
      const res = await fetch('/api/admin/brands/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceIds: [source.id],
          targetId: selectedTarget.id
        })
      })
      const data = await res.json()
      if (data.error) {
        toast.error(data.error?.message || 'Eşleştirme başarısız.')
      } else {
        toast.success(
          `"${source.normalizedName}" → "${selectedTarget.brand}" birleştirildi.`
        )
        onOpenChange(false)
        onLinked?.()
      }
    } catch {
      toast.error('Eşleştirme sırasında hata oluştu.')
    } finally {
      setMerging(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Marka Eşleştir / Birleştir</SheetTitle>
          <SheetDescription>
            Kaynak canonical markayı hedefe taşıyın. Tüm mapping'ler hedefe aktarılır, kaynak silinir.
          </SheetDescription>
        </SheetHeader>

        {/* Source */}
        <div className="mt-4 space-y-3">
          <div className="rounded-md border border-border bg-muted/30 p-3">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Kaynak Marka
            </p>
            {source ? (
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-foreground truncate">
                    {source.normalizedName}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    id: {source.id} · {source.mappings.length} mapping
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Kaynak seçilmedi.</p>
            )}
          </div>

          {/* Target search */}
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Hedef Marka Ara (brand_list)
            </p>
            <div className="flex gap-2">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Marka adı ara..."
                className="h-9 text-sm"
                autoFocus
              />
              <Button size="sm" onClick={() => runSearch(query)} disabled={searching}>
                {searching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
              </Button>
            </div>

            {/* Candidates */}
            <div className="max-h-72 overflow-y-auto rounded-md border border-border">
              {candidates.length === 0 && query.trim().length > 0 && !searching && (
                <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                  Sonuç yok. Farklı bir terim deneyin.
                </p>
              )}
              {candidates.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelectedTarget(c)}
                  className={`flex w-full items-center justify-between border-b border-border/50 px-3 py-2 text-left text-xs transition-colors last:border-b-0 ${
                    selectedTarget?.id === c.id
                      ? 'bg-accent text-accent-foreground'
                      : 'hover:bg-accent/50'
                  }`}
                >
                  <div className="min-w-0">
                    <p className="font-medium truncate">{c.brand}</p>
                    <p className="text-[10px] text-muted-foreground">
                      id: {c.id} · dnmk: {c.dnmk_count}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Summary + action */}
          {source && selectedTarget && (
            <div className="space-y-3 rounded-md border border-green-200 bg-green-50 p-3 dark:border-green-900 dark:bg-green-950">
              <div className="flex items-center gap-2 text-sm">
                <span className="font-medium text-foreground truncate">
                  {source.normalizedName}
                </span>
                <ArrowRight size={14} className="shrink-0 text-muted-foreground" />
                <span className="font-medium text-foreground truncate">
                  {selectedTarget.brand}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Tüm dnmk/bsbg mapping'ler hedefe taşınır, kaynak brand_list silinir.
              </p>
              <Button
                size="sm"
                className="w-full"
                onClick={handleMerge}
                disabled={merging}
              >
                {merging ? (
                  <Loader2 size={14} className="mr-2 animate-spin" />
                ) : null}
                Birleştir ve Eşleştir
              </Button>
            </div>
          )}

          {/* Warning when source has dnmk mappings */}
          {source && source.mappings.some((m) => m.dnmkBrand) && selectedTarget && (
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>
                Kaynakta dnmk markaları var. Hedefe taşındığında çakışan dnmk mapping'ler
                hedefin kaydında kalır (üzerine yazılmaz).
              </span>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}