'use client'

import { useCallback, useEffect, useState } from 'react'
import { ArrowRight, Loader2, Plus, Search } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet'
import {
  CANDIDATE_KIND_LABELS,
  SUPPLIER_LABELS,
  type BrandCandidate,
  type SupplierBrandMatchRow,
  type SupplierKey
} from '@/lib/admin/supplier-brand-shared'

interface SupplierBrandMatchSheetProps {
  supplier: SupplierKey
  source: SupplierBrandMatchRow | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onLinked?: () => void
}

function CandidateKindBadge({ kind }: { kind: BrandCandidate['kind'] }) {
  const isCanonical = kind === 'canonical'
  return (
    <Badge
      variant="outline"
      className={
        isCanonical
          ? 'border-primary/20 bg-primary/10 text-primary'
          : 'border-border bg-muted text-muted-foreground'
      }
    >
      {CANDIDATE_KIND_LABELS[kind]}
    </Badge>
  )
}

export function SupplierBrandMatchSheet({
  supplier,
  source,
  open,
  onOpenChange,
  onLinked
}: SupplierBrandMatchSheetProps) {
  const [query, setQuery] = useState('')
  const [candidates, setCandidates] = useState<BrandCandidate[]>([])
  const [searching, setSearching] = useState(false)
  const [linking, setLinking] = useState(false)
  const [selected, setSelected] = useState<BrandCandidate | null>(null)

  const runSearch = useCallback(
    async (q: string) => {
      if (q.trim().length === 0) {
        setCandidates([])
        return
      }
      setSearching(true)
      try {
        const params = new URLSearchParams({ q, limit: '50' })
        if (source) {
          params.set('excludeSupplier', supplier)
          params.set('excludeId', source.supplierId)
        }
        const res = await fetch(`/api/admin/eslestirme/candidates?${params.toString()}`)
        const data = await res.json()
        if (!res.ok || data.error) {
          toast.error(data?.error?.message || 'Aday araması başarısız.')
          return
        }
        setCandidates(data.candidates || [])
      } catch {
        toast.error('Aday araması sırasında hata.')
      } finally {
        setSearching(false)
      }
    },
    [source, supplier]
  )

  // Sheet açılınca tedarikçi markasının adıyla önden arama yap.
  useEffect(() => {
    if (open && source) {
      setQuery(source.supplierName)
      void runSearch(source.supplierName)
    }
  }, [open, source, runSearch])

  useEffect(() => {
    if (!open) {
      setQuery('')
      setCandidates([])
      setSelected(null)
    }
  }, [open])

  useEffect(() => {
    const t = setTimeout(() => {
      if (query.trim().length > 0) void runSearch(query)
      else setCandidates([])
    }, 300)
    return () => clearTimeout(t)
  }, [query, runSearch])

  const doLink = useCallback(
    async (body: Record<string, unknown>) => {
      if (!source) return
      setLinking(true)
      try {
        const res = await fetch('/api/admin/eslestirme/brands/link', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            supplier,
            supplierBrandId: source.supplierId,
            ...body
          })
        })
        const data = await res.json()
        if (data.error) {
          toast.error(data.error?.message || 'Eşleştirme başarısız.')
        } else {
          toast.success(`"${source.supplierName}" eşleştirildi.`)
          onOpenChange(false)
          onLinked?.()
        }
      } catch {
        toast.error('Eşleştirme sırasında hata oluştu.')
      } finally {
        setLinking(false)
      }
    },
    [source, supplier, onOpenChange, onLinked]
  )

  const linkSelected = useCallback(() => {
    if (!selected) return
    if (selected.kind === 'canonical') {
      void doLink({ canonicalBrandId: Number(selected.id) })
    } else if (selected.canonicalId != null) {
      // Aday zaten bir kanonik markaya bağlı → aynı kanonik'e bağla.
      void doLink({ canonicalBrandId: selected.canonicalId })
    } else {
      // Aday henüz bağlanmamış tedarikçi markası → ortak kanonik oluştur, ikisini de bağla.
      void doLink({ targetSupplier: selected.kind, targetSupplierBrandId: selected.id })
    }
  }, [selected, doLink])

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Marka Eşleştir</SheetTitle>
          <SheetDescription>
            {SUPPLIER_LABELS[supplier]} markasını bir kanonik markaya ya da başka bir firmanın
            markasına bağlayın.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-3">
          <div className="rounded-md border border-border bg-muted/30 p-3">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {SUPPLIER_LABELS[supplier]} Markası
            </p>
            {source ? (
              <div className="min-w-0">
                <p className="truncate font-medium text-foreground">{source.supplierName}</p>
                <p className="text-xs text-muted-foreground">
                  id: {source.supplierId}
                  {source.canonicalName ? ` · şu an: ${source.canonicalName}` : ''}
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Kaynak seçilmedi.</p>
            )}
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Aday Ara (kanonik + tüm firmalar)
            </p>
            <div className="flex gap-2">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Marka adı ara..."
                className="h-9 text-sm"
                autoFocus
              />
              <Button size="sm" onClick={() => void runSearch(query)} disabled={searching}>
                {searching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
              </Button>
            </div>

            <div className="max-h-72 overflow-y-auto rounded-md border border-border">
              {candidates.length === 0 && query.trim().length > 0 && !searching && (
                <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                  Sonuç yok. Farklı bir terim deneyin veya yeni kanonik marka oluşturun.
                </p>
              )}
              {candidates.map((c) => (
                <button
                  key={`${c.kind}:${c.id}`}
                  type="button"
                  onClick={() => setSelected(c)}
                  className={`flex w-full items-center justify-between gap-2 border-b border-border/50 px-3 py-2 text-left text-xs transition-colors last:border-b-0 ${
                    selected?.kind === c.kind && selected?.id === c.id
                      ? 'bg-accent text-accent-foreground'
                      : 'hover:bg-accent/50'
                  }`}
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{c.name}</p>
                    <p className="truncate text-[10px] text-muted-foreground">
                      id: {c.id}
                      {c.kind !== 'canonical' && c.canonicalName
                        ? ` · kanonik: ${c.canonicalName}`
                        : ''}
                      {c.kind !== 'canonical' && !c.canonicalName ? ' · henüz bağlı değil' : ''}
                    </p>
                  </div>
                  <CandidateKindBadge kind={c.kind} />
                </button>
              ))}
            </div>
          </div>

          {source && selected && (
            <div className="space-y-3 rounded-md border border-green-200 bg-green-50 p-3 dark:border-green-900 dark:bg-green-950">
              <div className="flex items-center gap-2 text-sm">
                <span className="truncate font-medium text-foreground">{source.supplierName}</span>
                <ArrowRight size={14} className="shrink-0 text-muted-foreground" />
                <span className="truncate font-medium text-foreground">{selected.name}</span>
                <CandidateKindBadge kind={selected.kind} />
              </div>
              {selected.kind !== 'canonical' && !selected.canonicalId ? (
                <p className="text-xs text-muted-foreground">
                  Ortak bir kanonik marka oluşturulup her iki firma markası da bu kanonik&apos;e
                  bağlanacak.
                </p>
              ) : null}
              <Button size="sm" className="w-full" onClick={linkSelected} disabled={linking}>
                {linking ? <Loader2 size={14} className="mr-2 animate-spin" /> : null}
                Eşleştir
              </Button>
            </div>
          )}

          {source && (
            <div className="rounded-md border border-dashed border-border p-3">
              <p className="mb-2 text-xs text-muted-foreground">
                Uygun aday yoksa, bu tedarikçi markasının adından yeni bir kanonik marka
                oluşturup bağlayın.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => void doLink({ newBrandName: source.supplierName })}
                disabled={linking}
              >
                <Plus size={14} className="mr-2" />
                Yeni kanonik marka oluştur: {source.supplierName}
              </Button>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
