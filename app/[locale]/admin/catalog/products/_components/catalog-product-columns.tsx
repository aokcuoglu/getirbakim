'use client'

import { ColumnDef } from '@tanstack/react-table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Lock, Link2 } from 'lucide-react'
import { formatCurrency } from '@/lib/utils'
import type {
  AdminCatalogListItem,
  CatalogProductStatus
} from '@/lib/types/admin-catalog'

const STATUS_STYLES: Record<CatalogProductStatus, string> = {
  ACTIVE: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  DRAFT: 'bg-slate-50 text-slate-600 border-slate-200',
  HIDDEN: 'bg-amber-50 text-amber-700 border-amber-200',
  ARCHIVED: 'bg-red-50 text-red-700 border-red-200'
}

const STATUS_LABELS: Record<CatalogProductStatus, string> = {
  ACTIVE: 'Aktif',
  DRAFT: 'Taslak',
  HIDDEN: 'Gizli',
  ARCHIVED: 'Arşiv'
}

export interface CatalogColumnHandlers {
  onDetails: (id: string) => void
}

export function createCatalogProductColumns(
  handlers: CatalogColumnHandlers
): ColumnDef<AdminCatalogListItem, unknown>[] {
  return [
    {
      accessorKey: 'name',
      header: 'Ürün',
      cell: ({ row }) => {
        const p = row.original
        return (
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{p.displayName}</p>
            <p className="text-[11px] text-muted-foreground">
              <span>{p.partNo}</span>
              <span className="mx-1.5">·</span>
              {p.brandName}
              {p.categoryName ? (
                <>
                  <span className="mx-1.5">·</span>
                  {p.categoryName}
                </>
              ) : null}
            </p>
          </div>
        )
      }
    },
    {
      accessorKey: 'status',
      header: 'Durum',
      cell: ({ row }) => (
        <Badge variant="outline" className={STATUS_STYLES[row.original.status]}>
          {STATUS_LABELS[row.original.status]}
        </Badge>
      )
    },
    {
      accessorKey: 'priceIncVat',
      header: 'Fiyat (KDV dahil)',
      cell: ({ row }) => {
        const p = row.original
        if (p.priceIncVat == null) {
          return <span className="text-xs text-muted-foreground">—</span>
        }
        return (
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium tabular-nums">
              {formatCurrency(p.priceIncVat, 'TRY')}
            </span>
            {p.lockPrice && (
              <span title="Fiyat kilitli">
                <Lock size={12} className="text-amber-600" />
              </span>
            )}
          </div>
        )
      }
    },
    {
      accessorKey: 'totalStockQty',
      header: 'Stok',
      cell: ({ row }) => {
        const p = row.original
        return p.inStock ? (
          <span className="text-sm font-medium text-emerald-600 tabular-nums">
            {p.totalStockQty}
          </span>
        ) : (
          <span className="text-xs text-amber-600">Tedarik</span>
        )
      }
    },
    {
      accessorKey: 'offerCount',
      header: 'Teklif',
      cell: ({ row }) => (
        <span className="text-sm tabular-nums">{row.original.offerCount}</span>
      )
    },
    {
      id: 'enriched',
      header: 'Eşleşme',
      cell: ({ row }) =>
        row.original.isEnriched ? (
          <span title="public.parts eşleşmesi var">
            <Link2 size={15} className="text-sky-600" />
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )
    },
    {
      id: 'actions',
      header: '',
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="outline"
            onClick={() => handlers.onDetails(row.original.id)}
          >
            Detay
          </Button>
        </div>
      )
    }
  ]
}
