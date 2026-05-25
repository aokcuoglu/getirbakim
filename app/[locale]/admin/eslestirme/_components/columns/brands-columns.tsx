'use client'

import { ColumnDef } from '@tanstack/react-table'
import { ArrowRight, Ban, Check, Link2, Unlink, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { AdminRowActions, type AdminRowAction } from '@/components/admin/data-table/admin-row-actions'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { AdminTableHead } from '@/components/admin/data-table/admin-table-head'
import { DataTableColumnHeader } from '../data-table-column-header'

export interface BrandRow {
  id: number
  dinamikBrand: string
  normalizedName: string
  parcatedarikManufacturerId: number | null
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

const METHOD_LABELS: Record<string, string> = {
  EXACT_NORMALIZED: 'Birebir',
  CASE_INSENSITIVE: 'Harf',
  NORMALIZED_BRAND_NAME: 'Marka',
  MANUAL: 'Manuel',
}

export type BrandMatchSide = 'paired' | 'dinamik_only' | 'pt_only' | 'empty'

/** Which catalog side exists on the row (filter matchSide uses the missing side name). */
export function getBrandMatchSide(row: BrandRow): BrandMatchSide {
  const hasDinamik = Boolean(row.dinamikBrand?.trim())
  const hasPt =
    row.parcatedarikManufacturerId != null &&
    Boolean(row.parcatedarikManufacturerName?.trim())
  if (hasDinamik && hasPt) return 'paired'
  if (hasDinamik) return 'dinamik_only'
  if (hasPt) return 'pt_only'
  return 'empty'
}

function isPaired(row: BrandRow): boolean {
  return getBrandMatchSide(row) === 'paired'
}

function isApprovedSingleSide(row: BrandRow): boolean {
  return row.mappingStatus === 'APPROVED'
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
      id: 'brandMatch',
      header: () => <AdminTableHead>Marka Eşleşmesi</AdminTableHead>,
      cell: ({ row }) => {
        const r = row.original
        const side = getBrandMatchSide(r)
        const approvedSingleSide = isApprovedSingleSide(r)

        if (side === 'paired') {
          return (
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex min-w-0 cursor-default items-center gap-1.5">
                  <span className="max-w-[140px] truncate text-sm font-medium">
                    {r.dinamikBrand}
                  </span>
                  <ArrowRight className="h-3 w-3 shrink-0 text-success" />
                  <span className="max-w-[180px] truncate text-sm text-primary">
                    {r.parcatedarikManufacturerName || '—'}
                  </span>
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-sm space-y-1.5 p-3 text-xs">
                <div>
                  <p className="font-semibold text-primary">Dinamik Marka</p>
                  <p>{r.dinamikBrand}</p>
                </div>
                <div className="border-t pt-1.5">
                  <p className="font-semibold text-primary">ParçaTedarik Üretici</p>
                  <p>{r.parcatedarikManufacturerName}</p>
                </div>
              </TooltipContent>
            </Tooltip>
          )
        }

        if (side === 'dinamik_only') {
          if (approvedSingleSide) {
            return (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="min-w-0 cursor-default">
                    <p className="truncate text-sm font-medium">{r.dinamikBrand}</p>
                    <p className="text-xs text-muted-foreground">
                      Onaylı · yalnızca Dinamik (PT eşleşmesi yok)
                    </p>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-xs text-xs">
                  Bu marka onaylandı; ParçaTedarik üreticisi bağlı değil.
                </TooltipContent>
              </Tooltip>
            )
          }
          return (
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="max-w-[200px] truncate text-sm font-medium">{r.dinamikBrand}</span>
              <Badge
                variant="outline"
                className="shrink-0 border-warning/20 bg-warning/10 text-xs text-warning"
              >
                PT bekliyor
              </Badge>
            </div>
          )
        }

        if (side === 'pt_only') {
          if (approvedSingleSide) {
            return (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="min-w-0 cursor-default">
                    <p className="truncate text-sm font-medium">{r.parcatedarikManufacturerName}</p>
                    <p className="text-xs text-muted-foreground">
                      Onaylı · yalnızca PT (Dinamik katalogda yoktu)
                    </p>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-xs text-xs">
                  Üretici onaylandı; kayıt sonradan Dinamik marka olarak eklendi veya tek taraflı onaylı.
                </TooltipContent>
              </Tooltip>
            )
          }
          return (
            <div className="flex min-w-0 items-center gap-1.5">
              <Badge
                variant="outline"
                className="shrink-0 border-warning/20 bg-warning/10 text-xs text-warning"
              >
                Dinamik bekliyor
              </Badge>
              <span className="max-w-[220px] truncate text-sm">{r.parcatedarikManufacturerName}</span>
            </div>
          )
        }

        return <span className="text-xs text-muted-foreground">—</span>
      },
    },
    {
      accessorKey: 'normalizedName',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Normalized" />,
      cell: ({ getValue }) => {
        const v = getValue<string>()
        if (!v) return <span className="text-xs text-muted-foreground">—</span>
        return (
          <span className="max-w-[140px] truncate font-mono text-sm text-foreground" title={v}>
            {v}
          </span>
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
        const alias = row.original
        const actions: AdminRowAction[] = []

        if (alias.mappingStatus === 'PENDING') {
          actions.push(
            {
              label: 'Onayla',
              icon: <Check className="h-4 w-4" />,
              onClick: () => handlers.onAction(alias.id, 'approve')
            },
            {
              label: 'Reddet',
              icon: <X className="h-4 w-4" />,
              destructive: true,
              onClick: () => handlers.onAction(alias.id, 'reject')
            },
            {
              label: 'Yoksay',
              icon: <Ban className="h-4 w-4" />,
              onClick: () => handlers.onAction(alias.id, 'ignore')
            }
          )
        }

        actions.push(
          {
            label: 'Eşleştirmeyi Değiştir',
            icon: <Link2 className="h-4 w-4" />,
            onClick: () => handlers.onUpdate(alias),
            separatorBefore: alias.mappingStatus === 'PENDING'
          },
          {
            label: 'Sil',
            icon: <Unlink className="h-4 w-4" />,
            destructive: true,
            onClick: () => handlers.onAction(alias.id, 'delete'),
            separatorBefore: true
          }
        )

        return <AdminRowActions actions={actions} />
      },
      enableSorting: false,
      enableHiding: false,
    },
  ]
}
