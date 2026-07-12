'use client'

import { ColumnDef } from '@tanstack/react-table'
import { Badge } from '@/components/ui/badge'
import { AdminRowActions } from '@/components/admin/data-table/admin-row-actions'
import type { CustomerRequestListItem, CustomerRequestStatus } from '@/lib/types/customer-requests'

const STATUS_LABELS: Record<string, string> = {
  NEW: 'Yeni',
  IN_REVIEW: 'İncelemede',
  RESOLVED: 'Çözüldü',
  ARCHIVED: 'Arşivlendi',
}

const TYPE_LABELS: Record<string, string> = {
  PRICE_REQUEST: 'Fiyat Talebi',
  PRODUCT_QUESTION: 'Ürün Sorusu',
  MISSING_PRODUCT: 'Bulunamayan Ürün',
  FITMENT_CHECK: 'Uygunluk Kontrolü',
}

const SOURCE_LABELS: Record<string, string> = {
  PRICE_MODAL: 'Fiyat Modalı',
  PRODUCT_FAQ_FORM: 'Ürün Formu',
  MISSING_PRODUCT_MODAL: 'Bulunamayan Ürün',
  FITMENT_MODAL: 'Uygunluk Modalı',
}

function StatusBadge({ status }: { status: CustomerRequestStatus }) {
  const tone: Record<string, string> = {
    NEW: 'border-blue-500/30 bg-blue-50 text-blue-700',
    IN_REVIEW: 'border-amber-500/30 bg-amber-50 text-amber-700',
    RESOLVED: 'border-green-500/30 bg-green-50 text-green-700',
    ARCHIVED: 'border-gray-500/30 bg-gray-50 text-gray-700',
  }

  return (
    <span className={`inline-flex items-center rounded-sm border px-2 py-0.5 text-[11px] font-medium ${tone[status]}`}>
      {STATUS_LABELS[status] || status}
    </span>
  )
}

export interface RequestColumnHandlers {
  onDetails?: (id: number) => void
}

export function createRequestColumns(
  handlers: RequestColumnHandlers
): ColumnDef<CustomerRequestListItem, unknown>[] {
  return [
    {
      accessorKey: 'id',
      header: 'ID',
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">{row.original.id}</span>
      ),
    },
    {
      accessorKey: 'name',
      header: 'Müşteri',
      cell: ({ row }) => (
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{row.original.name}</p>
          <p className="text-xs text-muted-foreground">{row.original.email}</p>
        </div>
      ),
    },
    {
      id: 'type',
      accessorFn: (row) => row.requestType,
      header: 'Tip',
      cell: ({ row }) => (
        <Badge variant="outline" className="text-xs">
          {TYPE_LABELS[row.original.requestType] || row.original.requestType}
        </Badge>
      ),
    },
    {
      id: 'status',
      accessorFn: (row) => row.status,
      header: 'Durum',
      cell: ({ row }) => <StatusBadge status={row.original.status} />,
    },
    {
      id: 'source',
      accessorFn: (row) => row.source,
      header: 'Kaynak',
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {SOURCE_LABELS[row.original.source] || row.original.source}
        </span>
      ),
    },
    {
      id: 'partInfo',
      header: 'Ürün',
      cell: ({ row }) => (
        <div>
          {row.original.partNameSnapshot ? (
            <p className="text-sm font-semibold truncate">{row.original.partNameSnapshot}</p>
          ) : (
            <p className="text-xs text-muted-foreground">—</p>
          )}
          {row.original.brandNameSnapshot && (
            <p className="text-xs text-muted-foreground">{row.original.brandNameSnapshot}</p>
          )}
        </div>
      ),
    },
    {
      accessorKey: 'createdAt',
      header: 'Tarih',
      cell: ({ row }) => (
        <span className="text-sm">
          {new Date(row.original.createdAt).toLocaleDateString('tr-TR', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          })}
        </span>
      ),
    },
    {
      id: 'actions',
      header: 'İşlem',
      cell: ({ row }) => (
        <div className="flex justify-end">
          <AdminRowActions
            srLabel={`Talep ${row.original.id} işlemleri`}
            actions={[
              {
                label: 'Detay',
                onClick: () => handlers.onDetails?.(row.original.id),
              },
              {
                label: 'Düzenle',
                separatorBefore: true,
              },
              {
                label: 'Arşivle',
                separatorBefore: true,
              },
            ]}
          />
        </div>
      ),
    },
  ]
}
