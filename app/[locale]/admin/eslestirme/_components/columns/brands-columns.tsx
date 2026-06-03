'use client'

import { ColumnDef } from '@tanstack/react-table'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { DataTableColumnHeader } from '../data-table-column-header'

export interface BrandRow {
  id: number
  brandListId: number
  normalizedName: string
  dinamikBrand: string
  ptName: string
  bsbgBrand: string
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
  PENDING: 'bg-warning/15 text-warning border-warning/20',
  APPROVED: 'bg-success/15 text-success border-success/20',
  REJECTED: 'bg-destructive/15 text-destructive border-destructive/20',
  IGNORED: 'bg-muted text-muted-foreground border-border',
}

const METHOD_LABELS: Record<string, string> = {
  EXACT_NORMALIZED: 'Birebir',
  CASE_INSENSITIVE: 'Harf',
  NORMALIZED_BRAND_NAME: 'Marka',
  MANUAL: 'Manuel',
}

export function createBrandsColumns(handlers: {
  onAction: (id: number, action: string) => void
  onViewDetail: (row: BrandRow) => void
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
      cell: ({ row }) =>
        row.original.mappingStatus === 'PENDING' ? (
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(value) => row.toggleSelected(!!value)}
            aria-label="Select row"
          />
        ) : null,
      enableSorting: false,
      enableHiding: false,
    },
    {
      accessorKey: 'normalizedName',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Marka" />,
      cell: ({ getValue, row }) => {
        const v = getValue<string>()
        if (!v) return <span className="text-xs text-muted-foreground">—</span>
        return (
          <button
            onClick={() => handlers.onViewDetail(row.original)}
            className="max-w-[140px] truncate font-mono text-sm text-primary hover:underline text-left"
            title={v}
          >
            {v}
          </button>
        )
      },
    },
    {
      id: 'providers',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Sağlayıcılar" />,
      cell: ({ row }) => {
        const r = row.original
        const providers = []
        if (r.dinamikBrand) providers.push({ label: 'Dinamik', name: r.dinamikBrand })
        if (r.ptName) providers.push({ label: 'PT', name: r.ptName })
        if (r.bsbgBrand) providers.push({ label: 'Başbuğ', name: r.bsbgBrand })
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
        return (
          <Badge variant="outline" className={`text-xs font-medium ${STATUS_COLORS[v] || ''}`}>
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
          <Badge variant="outline" className="border-success/20 bg-success/10 text-xs text-success">
            {METHOD_LABELS[v] || v}
          </Badge>
        )
      },
    },
    {
      id: 'actions',
      cell: ({ row }) => {
        const r = row.original
        const actions = []

        if (r.mappingStatus === 'PENDING') {
          actions.push(
            { label: 'Onayla', icon: '✓', onClick: () => handlers.onAction(r.id, 'approve') },
            { label: 'Reddet', icon: '✕', destructive: true, onClick: () => handlers.onAction(r.id, 'reject') },
            { label: 'Yoksay', icon: '⊘', onClick: () => handlers.onAction(r.id, 'ignore') }
          )
        }

        actions.push({ label: 'Sil', icon: '✕', destructive: true, onClick: () => handlers.onAction(r.id, 'delete') })

        return (
          <div className="flex items-center gap-1">
            {actions.map((a, i) => (
              <button
                key={i}
                onClick={a.onClick}
                className={`inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium transition-colors ${a.destructive ? 'text-destructive hover:bg-destructive/10' : 'text-muted-foreground hover:bg-muted'}`}
              >
                {a.label}
              </button>
            ))}
          </div>
        )
      },
      enableSorting: false,
      enableHiding: false,
    },
  ]
}