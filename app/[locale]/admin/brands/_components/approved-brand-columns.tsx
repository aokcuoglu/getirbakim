'use client'

import { ColumnDef } from '@tanstack/react-table'
import { Badge } from '@/components/ui/badge'
import { DataTableColumnHeader } from '@/components/admin/data-table/data-table-column-header'
import type { AdminApprovedBrandRow } from '@/lib/admin/approved-dnbrd-catalog'
import { BrandLogoUploadCell } from './BrandLogoUploadCell'
import { Eye } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function createApprovedBrandColumns(handlers: {
  onUpload: (row: AdminApprovedBrandRow, file: File) => Promise<boolean>
  onUploadFromUrl: (row: AdminApprovedBrandRow, url: string) => Promise<boolean>
  uploadingId: number | null
  selectedIds: number[]
  onToggleSelect: (id: number) => void
  onViewDetail: (row: AdminApprovedBrandRow) => void
}): ColumnDef<AdminApprovedBrandRow, unknown>[] {
  return [
    {
      id: 'select',
      header: () => (
        <span className="sr-only">Seç</span>
      ),
      cell: ({ row }) => {
        const id = row.original.id
        const isSelected = handlers.selectedIds.includes(id)
        return (
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => handlers.onToggleSelect(id)}
            className="rounded border-gray-300"
          />
        )
      },
      enableSorting: false,
      size: 40
    },
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
      accessorKey: 'normalizedName',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Canonical Marka" />
      ),
      cell: ({ getValue }) => (
        <span className="text-sm font-semibold">{getValue<string>() || '—'}</span>
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
      id: 'actions',
      header: () => <span className="text-xs font-medium">İşlem</span>,
      cell: ({ row }) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => handlers.onViewDetail(row.original)}
          className="h-8 gap-1"
        >
          <Eye className="h-3.5 w-3.5" />
          <span className="text-xs">Detay</span>
        </Button>
      ),
      enableSorting: false
    }
  ]
}
