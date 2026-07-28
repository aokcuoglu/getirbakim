'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Search, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import type { ProductListBrandOption } from '@/lib/admin/product-match-shared'

interface BrandFilterModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (brand: { brandId: number; brandName: string } | null) => void
  /**
   * Tablonun aktif filtreleri (marka hariç), serialize edilmiş query string.
   * Seçenekler bu filtrelerden geçen satırlardan türetilir — seçildiğinde tabloyu
   * boşaltacak bir markayı listelemek admin'i kör aramaya sokuyordu.
   */
  filterParams: string
  /** Filtrelerin daralttığını anlatan açıklama satırı. */
  filterSummary: string | null
}

export function BrandFilterModal({
  open,
  onOpenChange,
  onSelect,
  filterParams,
  filterSummary
}: BrandFilterModalProps) {
  const [query, setQuery] = useState('')
  const [brands, setBrands] = useState<ProductListBrandOption[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(
    async (q: string) => {
      setLoading(true)
      try {
        const params = new URLSearchParams(filterParams)
        params.set('limit', '1000')
        // Marka adı araması `brandQ`; `q` tablonun ürün aramasıdır ve filtreden gelir.
        if (q.trim()) params.set('brandQ', q.trim())
        const res = await fetch(`/api/admin/eslestirme/products/brands?${params}`)
        const data = await res.json()
        if (!res.ok || data.error) {
          toast.error(data?.error?.message || 'Markalar yüklenemedi.')
          return
        }
        setBrands(data.brands ?? [])
      } catch {
        toast.error('Markalar yüklenirken hata oluştu.')
      } finally {
        setLoading(false)
      }
    },
    [filterParams]
  )

  useEffect(() => {
    if (!open) {
      setQuery('')
      setBrands([])
      return
    }
    // Açılışta (boş arama) anında yükle; yazarken debounce uygula.
    if (query.trim() === '') {
      void load('')
      return
    }
    const t = setTimeout(() => void load(query), 250)
    return () => clearTimeout(t)
  }, [open, query, load])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[80vh] w-full flex-col overflow-hidden p-0 sm:max-w-md">
        <DialogHeader className="space-y-1 border-b border-border px-5 pb-3 pt-5">
          <DialogTitle className="text-base">Markaya Göre Filtrele</DialogTitle>
          <DialogDescription className="text-xs">
            Bir marka seçin; liste yalnız o markanın ürünlerini gösterir.
            {filterSummary
              ? ` Yalnız aktif filtrelere (${filterSummary}) uyan markalar ve satır sayıları listeleniyor.`
              : ' Yanındaki sayı, o markanın altındaki satır sayısıdır.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-3 px-5 pb-5 pt-4">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Marka ara..."
                className="h-9 pl-8 text-sm"
                autoFocus
              />
            </div>
            {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>

          <Button
            variant="outline"
            size="sm"
            className="justify-start"
            onClick={() => {
              onSelect(null)
              onOpenChange(false)
            }}
          >
            <X className="mr-2 h-4 w-4" />
            Filtreyi temizle (tüm markalar)
          </Button>

          <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-border">
            {brands.length === 0 && !loading ? (
              <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                {filterSummary
                  ? 'Aktif filtrelere uyan marka yok.'
                  : 'Marka bulunamadı.'}
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {brands.map((b) => (
                  <li key={b.brandId}>
                    <button
                      type="button"
                      onClick={() => {
                        onSelect({ brandId: b.brandId, brandName: b.brandName })
                        onOpenChange(false)
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-accent/50"
                    >
                      <span className="flex-1 truncate text-sm font-medium text-foreground">
                        {b.brandName}
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {b.rowCount.toLocaleString('tr-TR')}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
