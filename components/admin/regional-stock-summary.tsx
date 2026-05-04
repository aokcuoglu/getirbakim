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
    <div className="rounded-xl border border-slate-100/60 bg-white/80 p-4 shadow-sm backdrop-blur-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </p>

      {regionalStock ? (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-4">
          {DINAMIK_REGIONAL_STOCK_ORDER.map((key) => {
            const entry = regionalStock[key]
            const toneClass =
              entry.status == null
                ? 'border-slate-100 bg-slate-50/50 text-slate-500'
                : entry.hasStock
                  ? 'border-emerald-200/60 bg-emerald-50/50 text-emerald-700'
                  : 'border-amber-200/60 bg-amber-50/50 text-amber-700'

            return (
              <div
                key={key}
                className={`rounded-lg border px-3 py-2.5 ${toneClass}`}
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
        <p className="mt-2 text-xs text-slate-500">{emptyLabel}</p>
      )}
    </div>
  )
}
