import { ColumnDef } from '@tanstack/react-table'
import { Check, X, Ban, Link2, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { DataTableColumnHeader } from '../data-table-column-header'

export interface ModelRow {
  id: number
  dproductsId: string | null
  productId: number | null
  normalized: string | null
  mappingStatus: string
  matchMethod: string | null
  dinamik: {
    stockCode: string | null
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
    manufacturerId: number | null
    manufacturerName: string
  }
}

const STATUS_LABELS: Record<string, string> = {
  PENDING: 'Beklemede',
  APPROVED: 'Onaylandı',
  REJECTED: 'Reddedildi',
  IGNORED: 'Yoksayıldı',
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
          checked={table.getIsAllPageRowsSelected() || (table.getIsSomePageRowsSelected() && 'indeterminate')}
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
        const colors: Record<string, string> = {
          PENDING: 'bg-amber-100 text-amber-800 border-amber-200',
          APPROVED: 'bg-emerald-100 text-emerald-800 border-emerald-200',
          REJECTED: 'bg-rose-100 text-rose-800 border-rose-200',
          IGNORED: 'bg-slate-100 text-slate-600 border-slate-200',
        }
        return (
          <Badge variant="outline" className={`text-xs font-medium ${colors[v] || ''}`}>
            {STATUS_LABELS[v] || v}
          </Badge>
        )
      },
    },
    {
      id: 'productInfo',
      header: () => <span className="text-xs font-medium">Ürün Eşleşmesi</span>,
      cell: ({ row }) => {
        const r = row.original
        const isMatched = !!(r.dproductsId && r.productId)

        if (isMatched) {
          return (
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-1.5 min-w-0 cursor-default">
                  <span className="text-sm font-mono font-medium text-blue-700 truncate max-w-[120px]">
                    {r.dinamik.stockCode || '—'}
                  </span>
                  <ArrowRight className="h-3 w-3 text-emerald-500 shrink-0" />
                  <span className="text-sm text-violet-700 truncate max-w-[200px]">
                    {r.parcatedarik.title?.slice(0, 40) || '—'}
                  </span>
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-sm p-3 space-y-1.5 text-xs">
                <div>
                  <p className="font-semibold text-blue-700">Dinamik</p>
                  <p className="font-mono">{r.dinamik.stockCode}</p>
                  <p className="text-muted-foreground">{r.dinamik.stockName || '—'}</p>
                  <p className="text-muted-foreground">Marka: {r.dinamik.brand || '—'}</p>
                </div>
                <div className="border-t pt-1.5">
                  <p className="font-semibold text-violet-700">ParçaTedarik</p>
                  <p>{r.parcatedarik.title}</p>
                  <p className="text-muted-foreground">{r.parcatedarik.manufacturerName}</p>
                  <p className="text-muted-foreground font-mono">model: {r.parcatedarik.model || '—'}</p>
                </div>
              </TooltipContent>
            </Tooltip>
          )
        }

        if (r.dproductsId) {
          return (
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-1.5 min-w-0 cursor-default">
                  <span className="text-sm font-mono font-medium truncate max-w-[250px]">
                    {r.dinamik.stockCode || '—'}
                  </span>
                  <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-200 shrink-0">
                    PT bekliyor
                  </Badge>
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-sm p-3 space-y-1 text-xs">
                <p className="font-semibold">Dinamik Ürün (eşleşme bekliyor)</p>
                <p className="font-mono">{r.dinamik.stockCode}</p>
                <p className="text-muted-foreground">{r.dinamik.stockName || '—'}</p>
                <p className="text-muted-foreground">Marka: {r.dinamik.brand || '—'}</p>
                {r.dinamik.partNo && <p className="text-muted-foreground">Parça No: {r.dinamik.partNo}</p>}
              </TooltipContent>
            </Tooltip>
          )
        }

        if (r.productId) {
          return (
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-1.5 min-w-0 cursor-default">
                  <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-200 shrink-0">
                    Dinamik bekliyor
                  </Badge>
                  <span className="text-sm truncate max-w-[250px]">
                    {r.parcatedarik.title?.slice(0, 50) || '—'}
                  </span>
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-sm p-3 space-y-1 text-xs">
                <p className="font-semibold">PT Ürün (eşleşme bekliyor)</p>
                <p>{r.parcatedarik.title}</p>
                <p className="text-muted-foreground">{r.parcatedarik.manufacturerName}</p>
                <p className="text-muted-foreground font-mono">model: {r.parcatedarik.model || '—'}</p>
                {r.parcatedarik.refNo && <p className="text-muted-foreground font-mono">ref: {r.parcatedarik.refNo}</p>}
              </TooltipContent>
            </Tooltip>
          )
        }

        return <span className="text-xs text-muted-foreground">—</span>
      },
    },
    {
      accessorKey: 'matchMethod',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Yöntem" />,
      cell: ({ getValue }) => {
        const v = getValue<string | null>()
        if (!v) return <span className="text-xs text-muted-foreground">—</span>
        return (
          <Badge variant="outline" className="text-xs bg-emerald-50 text-emerald-700 border-emerald-200">
            {METHOD_LABELS[v] || v}
          </Badge>
        )
      },
    },
    {
      id: 'actions',
      cell: ({ row }) => {
        const m = row.original
        return (
          <div className="flex items-center gap-0.5">
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
            {(m.mappingStatus === 'APPROVED' || m.mappingStatus === 'REJECTED') && (
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-slate-400 hover:text-rose-600" onClick={() => handlers.onAction(m.id, 'unmatch')} title="Eşleştirmeyi Kaldır">
                <X className="h-4 w-4" />
              </Button>
            )}
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-blue-600 hover:text-blue-700" onClick={() => handlers.onLinkDproducts(m)} title="Eşleştir">
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
