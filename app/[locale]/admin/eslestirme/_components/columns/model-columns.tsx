import { ColumnDef } from '@tanstack/react-table'
import { Check, X, Ban, Link2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { DataTableColumnHeader } from '../data-table-column-header'

export interface ModelRow {
  id: number
  dproductsId: string
  productId: number
  normalized: string | null
  mappingStatus: string
  matchMethod: string | null
  dinamik: {
    stockCode: string
    stockName: string | null
    brand: string | null
    barcode1: string | null
    barcode2: string | null
    barcode3: string | null
    partNo: string | null
    price: string | null
  }
  parcatedarik: {
    title: string
    model: string | null
    refNo: string | null
    manufacturerId: number
    manufacturerName: string
  }
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
  EXACT_MATCH: 'Birebir Eşleşti',
  MANUAL: 'Manuel',
}

export function createModelColumns(handlers: {
  onAction: (id: number, action: string) => void
  onLinkProduct: (row: ModelRow) => void
  onLinkDproducts: (row: ModelRow) => void
  onBulkApproveRows: (rows: ModelRow[]) => void
}): ColumnDef<ModelRow, unknown>[] {
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
        row.original.mappingStatus === 'PENDING' ? (
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(value) => row.toggleSelected(!!value)}
            aria-label="Select row"
          />
        ) : null
      ),
      enableSorting: false,
      enableHiding: false,
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
    },
    {
      id: 'dinamik',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Dinamik Ürün" />,
      cell: ({ row }) => {
        const isPending = row.original.mappingStatus === 'PENDING'
        if (isPending) {
          return (
            <div className="min-w-0">
              <p className="truncate text-xs text-muted-foreground italic">Eşleşme bekliyor</p>
              <p className="truncate text-xs text-muted-foreground">{row.original.dinamik.brand || '-'}</p>
            </div>
          )
        }
        return (
          <div className="min-w-0">
            <p className="truncate text-sm font-medium font-mono">{row.original.dinamik.stockCode || '-'}</p>
            <p className="truncate text-xs text-muted-foreground">{row.original.dinamik.stockName || '-'}</p>
            <p className="truncate text-xs text-muted-foreground">{row.original.dinamik.brand || '-'}</p>
          </div>
        )
      },
    },
    {
      id: 'parcatedarik',
      header: ({ column }) => <DataTableColumnHeader column={column} title="PT Ürün" />,
      cell: ({ row }) => {
        const isPending = row.original.mappingStatus === 'PENDING'
        if (isPending) {
          return (
            <div className="min-w-0">
              <p className="truncate text-sm">{(row.original.parcatedarik.title || '-').slice(0, 60)}</p>
              <p className="truncate text-xs text-muted-foreground">{row.original.parcatedarik.manufacturerName || '-'}</p>
              <p className="truncate text-xs text-muted-foreground font-mono">model: {row.original.parcatedarik.model || '-'}</p>
              <p className="text-xs text-amber-600">↳ Eşleştirilmeyi bekliyor</p>
            </div>
          )
        }
        return (
          <div className="min-w-0">
            <p className="truncate text-sm">{(row.original.parcatedarik.title || '-').slice(0, 60)}</p>
            <p className="truncate text-xs text-muted-foreground">{row.original.parcatedarik.manufacturerName || '-'}</p>
            <p className="truncate text-xs text-muted-foreground font-mono">model: {row.original.parcatedarik.model || '-'}</p>
          </div>
        )
      },
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
      accessorKey: 'normalized',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Normalize" />,
      cell: ({ getValue }) => <span className="text-xs text-muted-foreground font-mono">{getValue<string | null>() || '-'}</span>,
    },
    {
      id: 'actions',
      cell: ({ row }) => {
        const m = row.original
        return (
          <div className="flex items-center gap-1">
            {m.mappingStatus === 'PENDING' && (
              <>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-emerald-600 hover:text-emerald-700" onClick={() => handlers.onAction(m.id, 'approve')} title="Onayla">
                  <Check className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-rose-600 hover:text-rose-700" onClick={() => handlers.onAction(m.id, 'reject')} title="Reddet">
                  <X className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-slate-500 hover:text-slate-700" onClick={() => handlers.onAction(m.id, 'ignore')} title="Yoksay">
                  <Ban className="h-4 w-4" />
                </Button>
              </>
            )}
            {m.mappingStatus !== 'PENDING' && (
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-slate-400 hover:text-rose-600" onClick={() => handlers.onAction(m.id, 'unmatch')} title="Eşleştirmeyi Kaldır">
                <X className="h-4 w-4" />
              </Button>
            )}
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-blue-600 hover:text-blue-700" onClick={() => handlers.onLinkDproducts(m)} title="Dinamik ürün ile eşleştir">
              <Link2 className="h-4 w-4" />
            </Button>
          </div>
        )
      },
      enableSorting: false,
      enableHiding: false,
    },
  ]
}
