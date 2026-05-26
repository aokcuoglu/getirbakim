'use client'

import { ColumnDef } from '@tanstack/react-table'
import { ArrowRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { AdminTableHead } from '@/components/admin/data-table/admin-table-head'
import { DataTableColumnHeader } from '../../eslestirme/_components/data-table-column-header'
import type { AdminApprovedDpmatchRow } from '@/lib/admin/approved-dpmatch-catalog'

const METHOD_LABELS: Record<string, string> = {
  EXACT_MATCH: 'Birebir Eşleşti',
  MANUAL: 'Manuel',
  NO_BRAND_MATCH: 'Marka eşleşmesi yok'
}

export const approvedProductColumns: ColumnDef<AdminApprovedDpmatchRow, unknown>[] = [
  {
    id: 'productInfo',
    header: () => <AdminTableHead>Ürün Eşleşmesi</AdminTableHead>,
    cell: ({ row }) => {
      const r = row.original
      const isMatched = !!(r.dproductsId && r.productId)

      if (isMatched) {
        return (
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex min-w-0 cursor-default items-center gap-1.5">
                <span className="max-w-[120px] truncate font-mono text-sm font-medium text-primary">
                  {r.dinamik.stockCode || '—'}
                </span>
                <ArrowRight className="h-3 w-3 shrink-0 text-success" />
                <span className="max-w-[200px] truncate text-sm text-primary">
                  {r.parcatedarik.title?.slice(0, 40) || '—'}
                </span>
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-sm space-y-1.5 p-3 text-xs">
              <div>
                <p className="font-semibold text-primary">Dinamik</p>
                <p className="font-mono">{r.dinamik.stockCode}</p>
                <p className="text-muted-foreground">{r.dinamik.stockName || '—'}</p>
                <p className="text-muted-foreground">Marka: {r.dinamik.brand || '—'}</p>
              </div>
              <div className="border-t pt-1.5">
                <p className="font-semibold text-primary">ParçaTedarik</p>
                <p>{r.parcatedarik.title}</p>
                <p className="text-muted-foreground">{r.parcatedarik.manufacturerName}</p>
              </div>
            </TooltipContent>
          </Tooltip>
        )
      }

      if (r.dproductsId) {
        return (
          <span className="font-mono text-sm">{r.dinamik.stockCode || '—'}</span>
        )
      }

      if (r.productId) {
        return (
          <span className="truncate text-sm">{r.parcatedarik.title?.slice(0, 50) || '—'}</span>
        )
      }

      return <span className="text-xs text-muted-foreground">—</span>
    }
  },
  {
    accessorKey: 'dinamik.brand',
    id: 'dinamikBrand',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Dinamik Marka" />
    ),
    cell: ({ row }) => (
      <span className="text-sm">{row.original.dinamik.brand || '—'}</span>
    )
  },
  {
    id: 'ptManufacturer',
    header: () => <AdminTableHead>PT Üretici</AdminTableHead>,
    cell: ({ row }) => (
      <span className="text-sm">
        {row.original.parcatedarik.manufacturerName || '—'}
      </span>
    )
  },
  {
    accessorKey: 'matchMethod',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Yöntem" />
    ),
    cell: ({ getValue }) => {
      const v = getValue<string | null>()
      if (!v) return <span className="text-xs text-muted-foreground">—</span>
      return (
        <Badge variant="outline" className="text-xs font-medium">
          {METHOD_LABELS[v] || v}
        </Badge>
      )
    }
  },
  {
    accessorKey: 'normalized',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Normalized" />
    ),
    cell: ({ getValue }) => {
      const v = getValue<string | null>()
      return (
        <span className="font-mono text-xs text-muted-foreground">{v || '—'}</span>
      )
    }
  },
  {
    accessorKey: 'id',
    header: ({ column }) => <DataTableColumnHeader column={column} title="ID" />,
    cell: ({ getValue }) => (
      <span className="font-mono text-xs text-muted-foreground">{getValue<number>()}</span>
    )
  }
]
