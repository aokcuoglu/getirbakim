'use client'

import { ColumnDef } from '@tanstack/react-table'
import { Check, X, Ban, Link2, Unlink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { DataTableColumnHeader } from '../data-table-column-header'

export interface BrandRow {
  id: number
  dinamikBrand: string
  normalizedName: string
  parcatedarikManufacturerId: number
  parcatedarikManufacturerName: string
  mappingStatus: string
  matchMethod: string | null
}

const STATUS_LABELS: Record<string, string> = {
  PENDING: 'Beklemede',
  APPROVED: 'Onaylandı',
  REJECTED: 'Reddedildi',
  IGNORED: 'Yoksayıldı',
}

const STATUS_COLORS: Record<string, string> = {
  PENDING: 'bg-amber-50 text-amber-700 ring-amber-600/10',
  APPROVED: 'bg-emerald-50 text-emerald-700 ring-emerald-600/10',
  REJECTED: 'bg-rose-50 text-rose-700 ring-rose-600/10',
  IGNORED: 'bg-slate-50 text-slate-600 ring-slate-500/10',
}

const METHOD_LABELS: Record<string, string> = {
  EXACT_NORMALIZED: 'Birebir',
  CASE_INSENSITIVE: 'Harf',
  NORMALIZED_BRAND_NAME: 'Marka',
  MANUAL: 'Manuel',
}

export function createBrandsColumns(handlers: {
  onAction: (id: number, action: string) => void
  onUpdate: (row: BrandRow) => void
}): ColumnDef<BrandRow, unknown>[] {
  return [
    {
      id: 'select',
      header: ({ table }) => (
        <Checkbox
          checked={
            table.getIsAllPageRowsSelected() ||
            (table.getIsSomePageRowsSelected() && 'indeterminate')
          }
          onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
          aria-label="Select all"
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(!!value)}
          aria-label="Select row"
        />
      ),
      enableSorting: false,
      enableHiding: false,
    },
    {
      accessorKey: 'dinamikBrand',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Dinamik Marka" />,
      cell: ({ getValue }) => <span className="text-sm font-medium">{getValue<string>()}</span>,
    },
    {
      accessorKey: 'normalizedName',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Normalize" />,
      cell: ({ getValue }) => <span className="text-xs text-muted-foreground font-mono">{getValue<string>()}</span>,
    },
    {
      accessorKey: 'parcatedarikManufacturerName',
      header: ({ column }) => <DataTableColumnHeader column={column} title="PT Üretici" />,
      cell: ({ getValue }) => <span className="text-sm">{getValue<string>() || '-'}</span>,
    },
    {
      accessorKey: 'matchMethod',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Yöntem" />,
      cell: ({ getValue }) => {
        const v = getValue<string | null>()
        return <span className="text-xs text-muted-foreground">{v ? (METHOD_LABELS[v] || v) : '-'}</span>
      },
    },
    {
      accessorKey: 'mappingStatus',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Durum" />,
      cell: ({ getValue }) => {
        const v = getValue<string>()
        return (
          <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_COLORS[v] || 'bg-slate-50 text-slate-600'}`}>
            {STATUS_LABELS[v] || v}
          </span>
        )
      },
      filterFn: (row, id, value) => {
        return row.getValue<string>(id) === value
      },
    },
    {
      id: 'actions',
      cell: ({ row }) => {
        const alias = row.original
        return (
          <div className="flex items-center gap-1">
            {alias.mappingStatus === 'PENDING' && (
              <>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-emerald-600 hover:text-emerald-700" onClick={() => handlers.onAction(alias.id, 'approve')} title="Onayla">
                  <Check className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-rose-600 hover:text-rose-700" onClick={() => handlers.onAction(alias.id, 'reject')} title="Reddet">
                  <X className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-slate-500 hover:text-slate-700" onClick={() => handlers.onAction(alias.id, 'ignore')} title="Yoksay">
                  <Ban className="h-4 w-4" />
                </Button>
              </>
            )}
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-blue-600 hover:text-blue-700" onClick={() => handlers.onUpdate(alias)} title="Eşleştirmeyi Değiştir">
              <Link2 className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-slate-400 hover:text-rose-600" onClick={() => handlers.onAction(alias.id, 'delete')} title="Sil">
              <Unlink className="h-4 w-4" />
            </Button>
          </div>
        )
      },
      enableSorting: false,
      enableHiding: false,
    },
  ]
}
