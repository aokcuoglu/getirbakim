'use client'

import { ColumnDef } from '@tanstack/react-table'
import { Check, Link2, Loader2, Unlink, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { SupplierBrandMatchRow } from '@/lib/admin/supplier-brand-shared'

function StatusBadge({ status }: { status: string | null }) {
  const map: Record<string, { label: string; className: string }> = {
    APPROVED: { label: 'Eşleşti', className: 'border-success/20 bg-success/15 text-success' },
    PENDING: { label: 'Bekliyor', className: 'border-warning/20 bg-warning/15 text-warning' },
    REJECTED: { label: 'Reddedildi', className: 'border-destructive/20 bg-destructive/15 text-destructive' },
    IGNORED: { label: 'Yoksayıldı', className: 'border-border bg-muted text-muted-foreground' }
  }
  const cfg = status ? map[status] : null
  if (!cfg) {
    return (
      <Badge variant="outline" className="border-border bg-muted text-muted-foreground">
        Eşleşmemiş
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className={cfg.className}>
      {cfg.label}
    </Badge>
  )
}

export function createSupplierBrandColumns(handlers: {
  onMatch: (row: SupplierBrandMatchRow) => void
  onApprove: (row: SupplierBrandMatchRow) => void
  onReject: (row: SupplierBrandMatchRow) => void
  onUnlink: (row: SupplierBrandMatchRow) => void
  busyId: string | null
}): ColumnDef<SupplierBrandMatchRow, unknown>[] {
  return [
    {
      accessorKey: 'supplierName',
      header: 'Tedarikçi Markası',
      cell: ({ getValue }) => (
        <span className="text-sm font-semibold">{getValue<string>() || '—'}</span>
      )
    },
    {
      id: 'status',
      header: 'Durum',
      cell: ({ row }) => <StatusBadge status={row.original.mappingStatus} />,
      enableSorting: false
    },
    {
      accessorKey: 'canonicalName',
      header: 'Kanonik Marka',
      cell: ({ row }) => {
        const name = row.original.canonicalName
        return name ? (
          <span className="text-sm">{name}</span>
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        )
      }
    },
    {
      id: 'matchMethod',
      header: 'Yöntem',
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {row.original.matchMethod ?? '—'}
        </span>
      ),
      enableSorting: false
    },
    {
      id: 'actions',
      header: 'İşlem',
      cell: ({ row }) => {
        const r = row.original
        const busy = handlers.busyId === r.supplierId
        const hasMapping = r.mappingId != null
        const isPending = r.mappingStatus === 'PENDING'
        return (
          <div className="flex items-center gap-1">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" /> : null}
            {isPending ? (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => handlers.onApprove(r)}
                  className="h-8 gap-1 text-success"
                  title="Onayla"
                >
                  <Check className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => handlers.onReject(r)}
                  className="h-8 gap-1 text-destructive"
                  title="Reddet"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => handlers.onMatch(r)}
              className="h-8 gap-1"
              title="Eşleştir"
            >
              <Link2 className="h-3.5 w-3.5" />
              <span className="text-xs">{hasMapping ? 'Değiştir' : 'Eşleştir'}</span>
            </Button>
            {hasMapping ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => handlers.onUnlink(r)}
                className="h-8 gap-1 text-muted-foreground"
                title="Bağlantıyı kaldır"
              >
                <Unlink className="h-3.5 w-3.5" />
              </Button>
            ) : null}
          </div>
        )
      },
      enableSorting: false
    }
  ]
}
