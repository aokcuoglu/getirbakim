'use client'

import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import type { CatalogEnrichmentCoverage } from '@/lib/admin/catalog-enrichment-stats'

const tr = (n: number) => n.toLocaleString('tr-TR')

const STATUS_STYLE: Record<string, string> = {
  CONFIRMED: 'border-emerald-500/25 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  CANDIDATE: 'border-amber-500/25 bg-amber-500/15 text-amber-600 dark:text-amber-400',
  REJECTED: 'border-rose-500/25 bg-rose-500/15 text-rose-600 dark:text-rose-400'
}

export interface CoverageDetailDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  coverage: CatalogEnrichmentCoverage
  /** Marka satırına tıklanınca onay kuyruğunu o markaya daraltır. */
  onSelectBrand: (brand: string) => void
}

/**
 * Kapsam kartlarının arkasındaki kırılım.
 *
 * Sayfada sürekli duran iki tablo (eşleşme yöntemleri + marka boşluğu) günlük
 * işin parçası değil, kartların açıklaması: modale alındılar.
 */
export function CoverageDetailDialog({
  open,
  onOpenChange,
  coverage,
  onSelectBrand
}: CoverageDetailDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Kapsam detayı</DialogTitle>
          <DialogDescription>
            Eşleşmelerin hangi yöntemle kurulduğu ve boşluğun hangi markalarda toplandığı.
          </DialogDescription>
        </DialogHeader>

        <section>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Eşleşme yöntemleri
          </h4>
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
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            En çok boşluğu olan markalar
          </h4>
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
                  <tr
                    key={b.brand}
                    onClick={() => {
                      onSelectBrand(b.brand)
                      onOpenChange(false)
                    }}
                    className="cursor-pointer border-t border-border transition hover:bg-muted/50"
                  >
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
          <p className="mt-2 text-xs text-muted-foreground">
            Satıra tıklayın: onay kuyruğu o markaya daralır.
          </p>
        </section>
      </DialogContent>
    </Dialog>
  )
}
