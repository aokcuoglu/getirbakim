import {
  DINAMIK_REGIONAL_STOCK_LABELS,
  DINAMIK_REGIONAL_STOCK_ORDER
} from '@/lib/suppliers/dinamik-stock'
import type { RegionalStock } from '@/lib/types/admin-products'

interface RegionalStockSummaryProps {
  regionalStock: RegionalStock | null | undefined
  title?: string
  emptyLabel?: string
}

export function RegionalStockSummary({
  regionalStock,
  title = 'Bolgesel Stok',
  emptyLabel = 'Bolgesel stok kaydi yok.'
}: RegionalStockSummaryProps) {
  return (
    <div className="rounded-xl border border-border/60 bg-card/80 p-4 shadow-sm backdrop-blur-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </p>

      {regionalStock ? (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-4">
          {DINAMIK_REGIONAL_STOCK_ORDER.map((key) => {
            const entry = regionalStock[key]
            const toneClass =
              entry.status == null
                ? 'border-border bg-muted/50 text-muted-foreground'
                : entry.hasStock
                  ? 'border-success/20/60 bg-success/10/50 text-success'
                  : 'border-warning/20/60 bg-warning/10/50 text-warning'

            return (
              <div
                key={key}
                className={`rounded-md border px-3 py-2.5 ${toneClass}`}
              >
                <p className="text-[11px] font-semibold uppercase tracking-wide">
                  {DINAMIK_REGIONAL_STOCK_LABELS[key]}
                </p>
                <p className="mt-1 text-sm font-semibold">
                  {entry.status || 'Kayit yok'}
                </p>
                <p className="mt-1 text-[11px]">{entry.qty} adet</p>
              </div>
            )
          })}
        </div>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">{emptyLabel}</p>
      )}
    </div>
  )
}
