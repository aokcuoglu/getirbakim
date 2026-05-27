'use client'

import { ColumnDef } from '@tanstack/react-table'
import { Badge } from '@/components/ui/badge'
import { DataTableColumnHeader } from '@/components/admin/data-table/data-table-column-header'
import type { AdminApprovedBrandRow } from '@/lib/admin/approved-dbrands-catalog'
import { BrandLogoUploadCell } from './BrandLogoUploadCell'

const METHOD_LABELS: Record<string, string> = {
  EXACT_NORMALIZED: 'Birebir',
  CASE_INSENSITIVE: 'Harf',
  NORMALIZED_BRAND_NAME: 'Marka',
  MANUAL: 'Manuel'
}

export function createApprovedBrandColumns(handlers: {
  onUpload: (row: AdminApprovedBrandRow, file: File) => Promise<boolean>
  onUploadFromUrl: (row: AdminApprovedBrandRow, url: string) => Promise<boolean>
  uploadingId: number | null
}): ColumnDef<AdminApprovedBrandRow, unknown>[] {
  return [
    {
      id: 'logo',
      header: () => <span className="text-xs font-medium">Logo</span>,
      cell: ({ row }) => (
        <BrandLogoUploadCell
          row={row.original}
          isUploading={handlers.uploadingId === row.original.id}
          onUpload={handlers.onUpload}
          onUploadFromUrl={handlers.onUploadFromUrl}
        />
      ),
      enableSorting: false
    },
    {
      accessorKey: 'dinamikBrand',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Dinamik Marka" />
      ),
      cell: ({ getValue }) => (
        <span className="text-sm font-medium">{getValue<string>() || '—'}</span>
      )
    },
    {
      id: 'ptManufacturer',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="PT Üretici" />
      ),
      cell: ({ row }) => (
        <span className="text-sm">
          {row.original.parcatedarikManufacturerName || '—'}
        </span>
      )
    },
    {
      accessorKey: 'normalizedName',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Normalized" />
      ),
      cell: ({ getValue }) => (
        <span className="font-mono text-xs text-muted-foreground">
          {getValue<string>() || '—'}
        </span>
      )
    },
    {
      id: 'logoStatus',
      header: () => <span className="text-xs font-medium">Logo Durumu</span>,
      cell: ({ row }) => {
        const hasLogo = Boolean(row.original.logoUrl?.trim())
        return (
          <Badge
            variant="outline"
            className={
              hasLogo
                ? 'border-success/20 bg-success/15 text-success'
                : 'border-warning/20 bg-warning/15 text-warning'
            }
          >
            {hasLogo ? 'Var' : 'Eksik'}
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
        return (
          <Badge variant="outline" className="text-xs">
            {METHOD_LABELS[v] || v}
          </Badge>
        )
      }
    },
    {
      accessorKey: 'id',
      header: ({ column }) => <DataTableColumnHeader column={column} title="ID" />,
      cell: ({ getValue }) => (
        <span className="font-mono text-xs text-muted-foreground">
          {getValue<number>()}
        </span>
      )
    }
  ]
}
