'use client'

import { ColumnDef } from '@tanstack/react-table'
import { Link2, Pencil } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  PRODUCT_LIST_SUPPLIER_LABELS,
  type ProductListSupplier,
  type SupplierProductRow
} from '@/lib/admin/product-match-shared'
import { CoverageBadge } from './CoverageBadge'

const DOT: Record<ProductListSupplier, string> = {
  dinamik: 'bg-blue-500',
  basbug: 'bg-violet-500',
  ptdrk: 'bg-amber-500'
}

export function createProductListColumns(handlers: {
  onMatch: (row: SupplierProductRow) => void
}): ColumnDef<SupplierProductRow, unknown>[] {
  return [
    {
      id: 'supplier',
      header: 'Firma',
      cell: ({ row }) => {
        const s = row.original.supplier
        return (
          <span className="flex items-center gap-1.5">
            <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${DOT[s]}`} />
            <span className="text-xs font-medium">{PRODUCT_LIST_SUPPLIER_LABELS[s]}</span>
          </span>
        )
      },
      enableSorting: false
    },
    {
      accessorKey: 'brandName',
      header: 'Marka',
      cell: ({ getValue }) => (
        <span className="text-sm font-medium">{getValue<string>() || '—'}</span>
      )
    },
    {
      accessorKey: 'name',
      header: 'Ürün',
      cell: ({ row }) => (
        <div className="min-w-0 max-w-[360px]">
          <p className="truncate text-sm">{row.original.name || row.original.sku}</p>
          <p className="truncate text-[11px] text-muted-foreground">
            SKU: {row.original.sku}
            {row.original.partNo ? ` · part: ${row.original.partNo}` : ''}
          </p>
        </div>
      )
    },
    {
      id: 'status',
      header: 'Durum',
      cell: ({ row }) => {
        const r = row.original
        return r.matched ? (
          <div className="min-w-0 max-w-[280px]">
            <div className="flex flex-wrap items-center gap-1">
              <Badge variant="outline" className="border-success/20 bg-success/15 text-success">
                Eşleşti
              </Badge>
              {r.coverage ? <CoverageBadge coverage={r.coverage} /> : null}
            </div>
            {r.canonicalName ? (
              <p className="mt-0.5 truncate text-[11px] text-muted-foreground">→ {r.canonicalName}</p>
            ) : null}
          </div>
        ) : (
          <Badge variant="outline" className="border-warning/20 bg-warning/15 text-warning">
            Eşleşmedi
          </Badge>
        )
      },
      enableSorting: false
    },
    {
      id: 'actions',
      header: 'İşlem',
      cell: ({ row }) => {
        const r = row.original
        return (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handlers.onMatch(r)}
            className="h-8 gap-1"
            title={r.matched ? 'Düzenle' : 'Eşleştir'}
          >
            {r.matched ? <Pencil className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}
            <span className="text-xs">{r.matched ? 'Düzenle' : 'Eşleştir'}</span>
          </Button>
        )
      },
      enableSorting: false
    }
  ]
}
