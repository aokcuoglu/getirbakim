'use client'

import { ColumnDef } from '@tanstack/react-table'
import { ArrowRight, ExternalLink } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { AdminTableHead } from '@/components/admin/data-table/admin-table-head'
import { Link } from '@/lib/navigation'
import { DataTableColumnHeader } from '../../eslestirme/_components/data-table-column-header'
import type { AdminApprovedDpmatchRow } from '@/lib/admin/approved-dpmatch-catalog'

function buildMatchingHref(row: AdminApprovedDpmatchRow) {
  const query =
    row.dinamik.stockCode ||
    row.parcatedarik.model ||
    row.normalized ||
    row.parcatedarik.title ||
    ''
  return query
    ? `/admin/eslestirme?tab=products&q=${encodeURIComponent(query)}`
    : '/admin/eslestirme?tab=products'
}

const MATCH_SIDE_LABELS: Record<string, string> = {
  matched: 'Eşleşmiş',
  dinamik_only: 'Sadece Dinamik',
  pt_only: 'Sadece PT'
}

const MATCH_SIDE_VARIANTS: Record<
  string,
  'default' | 'secondary' | 'outline' | 'destructive'
> = {
  matched: 'default',
  dinamik_only: 'secondary',
  pt_only: 'outline'
}

const MAPPING_STATUS_LABELS: Record<string, string> = {
  APPROVED: 'Onaylı',
  PENDING: 'Bekliyor'
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
    accessorKey: 'matchSide',
    header: () => <AdminTableHead>Eşleşme</AdminTableHead>,
    cell: ({ row }) => {
      const side = row.original.matchSide
      return (
        <Badge
          variant={MATCH_SIDE_VARIANTS[side] ?? 'outline'}
          className="text-xs font-medium"
        >
          {MATCH_SIDE_LABELS[side] ?? side}
        </Badge>
      )
    }
  },
  {
    accessorKey: 'mappingStatus',
    header: () => <AdminTableHead>Durum</AdminTableHead>,
    cell: ({ getValue }) => {
      const value = getValue<string>()
      return (
        <Badge variant="outline" className="text-xs font-medium">
          {MAPPING_STATUS_LABELS[value] ?? value}
        </Badge>
      )
    }
  },
  {
    accessorKey: 'matchMethod',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Yöntem" />
    ),
    cell: ({ getValue }) => {
      const v = getValue<string | null>()
      if (!v) return <span className="text-xs text-muted-foreground">—</span>
      const METHOD_LABELS: Record<string, string> = {
        EXACT_MATCH: 'Birebir Eşleşti',
        MANUAL: 'Manuel',
        NO_BRAND_MATCH: 'Marka eşleşmesi yok'
      }
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
  },
  {
    id: 'actions',
    header: () => <AdminTableHead className="text-right">İşlem</AdminTableHead>,
    cell: ({ row }) => (
      <div className="flex justify-end">
        <Button variant="outline" size="sm" asChild>
          <Link href={buildMatchingHref(row.original)}>
            <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
            Eşleştirme
          </Link>
        </Button>
      </div>
    )
  }
]
