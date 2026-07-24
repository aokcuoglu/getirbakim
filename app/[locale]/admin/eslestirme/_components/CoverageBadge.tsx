'use client'

import { Badge } from '@/components/ui/badge'
import type { ProductMatchCoverage } from '@/lib/admin/product-match-shared'

/** Eşleşen kanonik ürünün offer kapsamı rozeti (iki tedarikçili / tek). */
const COVERAGE_STYLE: Record<ProductMatchCoverage, { label: string; className: string }> = {
  both: {
    label: 'Dinamik + Başbuğ',
    className: 'border-emerald-500/25 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
  },
  dinamik: {
    label: 'Yalnız Dinamik',
    className: 'border-blue-500/25 bg-blue-500/15 text-blue-600 dark:text-blue-400'
  },
  basbug: {
    label: 'Yalnız Başbuğ',
    className: 'border-violet-500/25 bg-violet-500/15 text-violet-600 dark:text-violet-400'
  }
}

export function CoverageBadge({
  coverage,
  className
}: {
  coverage: ProductMatchCoverage
  className?: string
}) {
  const style = COVERAGE_STYLE[coverage]
  return (
    <Badge variant="outline" className={`${style.className}${className ? ` ${className}` : ''}`}>
      {style.label}
    </Badge>
  )
}
