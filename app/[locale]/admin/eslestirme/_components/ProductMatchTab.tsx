'use client'

import { Package, Sparkles } from 'lucide-react'

export function ProductMatchTab() {
  return (
    <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 rounded-md border border-dashed border-border bg-card/50 p-8 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Package className="h-6 w-6" />
      </div>
      <div className="space-y-1">
        <p className="flex items-center justify-center gap-1.5 text-sm font-semibold text-foreground">
          <Sparkles className="h-3.5 w-3.5 text-amber-500" />
          Ürün eşleştirme yakında
        </p>
        <p className="mx-auto max-w-md text-xs text-muted-foreground">
          Önce marka eşleştirmesini tamamlayın. Marka eşleştirmeleri onaylandıkça, ilgili
          tedarikçilerin ürünleri kanonik kataloğa bağlanabilir hale gelir.
        </p>
      </div>
    </div>
  )
}
