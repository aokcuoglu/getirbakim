'use client'

import { ColumnDef } from '@tanstack/react-table'
import { Check, X, Ban, Link2 } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { AdminRowActions, type AdminRowAction } from '@/components/admin/data-table/admin-row-actions'
import { DataTableColumnHeader } from '../data-table-column-header'

export interface ModelRow {
  id: number
  dnprdId: string | null
  productId: number | null
  bsbgProductsId: string | null
  part_no: string | null
  mappingStatus: string
  matchMethod: string | null
  brandListId: number | null
  canonicalBrand: string | null
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
  bsbg: {
    partNo: string | null
    malzemeNo: string | null
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
  NO_BRAND_MATCH: 'Marka eşleşmesi yok',
}

export function createModelColumns(handlers: {
  onAction: (id: number, action: string) => void
  onLinkProduct: (row: ModelRow) => void
  onLinkDproducts: (row: ModelRow) => void
  onBulkApproveRows: (rows: ModelRow[]) => void
  onViewDetail: (row: ModelRow) => void
  onViewBrand: (brandListId: number) => void
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
      id: 'product',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Ürün" />,
      cell: ({ row }) => {
        const r = row.original
        const label = r.part_no || '—'
        const source = r.dnprdId ? 'Dinamik' : r.bsbgProductsId ? 'Başbuğ' : r.productId ? 'P-Tedarik' : null
        return (
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => handlers.onViewDetail(r)}
              className="max-w-[160px] truncate font-mono text-sm text-primary hover:underline text-left"
              title={label}
            >
              {label}
            </button>
            {source && (
              <Badge variant="outline" className="shrink-0 text-[9px] px-1 py-0 border-primary/20 bg-primary/5 text-primary">
                {source}
              </Badge>
            )}
          </div>
        )
      },
    },
    {
      id: 'providers',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Tedarikçiler" />,
      cell: ({ row }) => {
        const r = row.original
        const providers: { label: string; name: string }[] = []
        if (r.dnprdId) {
          providers.push({ label: 'Dinamik', name: r.dinamik.stockCode || r.dinamik.stockName || '—' })
        }
        if (r.productId) {
          providers.push({ label: 'PT', name: r.parcatedarik.title?.slice(0, 40) || '—' })
        }
        if (r.bsbgProductsId) {
          providers.push({ label: 'Başbuğ', name: r.bsbg.malzemeNo || 'Ürün mevcut' })
        }
        if (providers.length === 0) {
          return <span className="text-xs text-muted-foreground">Yok</span>
        }
        return (
          <div className="space-y-0.5">
            {providers.map((p) => (
              <div key={p.label} className="flex items-center gap-1.5 text-xs">
                <Badge variant="outline" className="shrink-0 text-[9px] px-1 py-0 border-primary/20 bg-primary/5 text-primary">
                  {p.label}
                </Badge>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="truncate max-w-[140px] text-foreground">{p.name}</span>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs">
                    {p.label}: {p.name}
                  </TooltipContent>
                </Tooltip>
              </div>
            ))}
          </div>
        )
      },
      enableSorting: false,
    },
    {
      accessorKey: 'mappingStatus',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Durum" />,
      cell: ({ getValue }) => {
        const v = getValue<string>()
        const colors: Record<string, string> = {
          PENDING: 'bg-warning/15 text-warning border-warning/20',
          APPROVED: 'bg-success/15 text-success border-success/20',
          REJECTED: 'bg-destructive/15 text-destructive border-destructive/20',
          IGNORED: 'bg-muted text-muted-foreground border-border',
        }
        return (
          <Badge variant="outline" className={`text-xs font-medium ${colors[v] || ''}`}>
            {STATUS_LABELS[v] || v}
          </Badge>
        )
      },
    },
    {
      accessorKey: 'matchMethod',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Yöntem" />,
      cell: ({ getValue }) => {
        const v = getValue<string | null>()
        if (!v) return <span className="text-xs text-muted-foreground">—</span>
        return (
          <Badge variant="outline" className="text-xs bg-success/10 text-success border-success/20">
            {METHOD_LABELS[v] || v}
          </Badge>
        )
      },
    },
    {
      id: 'canonicalBrand',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Kanonik Marka" />,
      cell: ({ row }) => {
        const blId = row.original.brandListId
        const name = row.original.canonicalBrand
        if (!blId || !name) return <span className="text-xs text-muted-foreground">—</span>
        return (
          <button
            onClick={() => handlers.onViewBrand(blId)}
            className="max-w-[160px] truncate text-sm text-primary hover:underline text-left"
            title={name}
          >
            {name}
          </button>
        )
      },
      enableSorting: false,
    },
    {
      id: 'actions',
      cell: ({ row }) => {
        const m = row.original
        const actions: AdminRowAction[] = []

        if (m.mappingStatus === 'PENDING') {
          actions.push(
            {
              label: 'Onayla',
              icon: <Check className="h-4 w-4" />,
              onClick: () => handlers.onAction(m.id, 'approve')
            },
            {
              label: 'Reddet',
              icon: <X className="h-4 w-4" />,
              destructive: true,
              onClick: () => handlers.onAction(m.id, 'reject')
            },
            {
              label: 'Yoksay',
              icon: <Ban className="h-4 w-4" />,
              onClick: () => handlers.onAction(m.id, 'ignore')
            }
          )
        }

        if (m.mappingStatus === 'APPROVED' || m.mappingStatus === 'REJECTED') {
          actions.push({
            label: 'Eşleştirmeyi Kaldır',
            icon: <X className="h-4 w-4" />,
            destructive: true,
            onClick: () => handlers.onAction(m.id, 'unmatch')
          })
        }

        actions.push({
          label: 'Eşleştir',
          icon: <Link2 className="h-4 w-4" />,
          onClick: () => handlers.onLinkDproducts(m),
          separatorBefore: actions.length > 0
        })

        return <AdminRowActions actions={actions} />
      },
      enableSorting: false,
      enableHiding: false,
    },
  ]
}
