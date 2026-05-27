'use client'

import { ColumnDef } from '@tanstack/react-table'
import { Package } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { AdminRowActions } from '@/components/admin/data-table/admin-row-actions'
import type { AdminProductListItem } from '@/lib/types/admin-products'
import { formatCurrency } from '@/lib/utils'

function StockBadge({
  status
}: {
  status: 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK'
}) {
  if (status === 'IN_STOCK') {
    return (
      <Badge
        variant="outline"
        className="gap-1.5 text-[10px] bg-success/10 text-success border-success/20"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-success" />
        Stokta
      </Badge>
    )
  }

  if (status === 'LOW_STOCK') {
    return (
      <Badge
        variant="outline"
        className="gap-1.5 text-[10px] bg-warning/10 text-warning border-warning/20"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-warning" />
        Düşük Stok
      </Badge>
    )
  }

  return (
    <Badge
      variant="outline"
      className="gap-1.5 text-[10px] bg-destructive/10 text-destructive border-destructive/20"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-destructive" />
      Stok Yok
    </Badge>
  )
}

function SyncBadge({ status }: { status: 'OK' | 'PENDING' | 'ERROR' }) {
  if (status === 'OK') {
    return (
      <Badge
        variant="outline"
        className="gap-1.5 text-[10px] bg-success/10 text-success border-success/20"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-success" />
        OK
      </Badge>
    )
  }

  if (status === 'PENDING') {
    return (
      <Badge
        variant="outline"
        className="gap-1.5 text-[10px] bg-warning/10 text-warning border-warning/20"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-warning animate-pulse" />
        Bekliyor
      </Badge>
    )
  }

  return (
    <Badge
      variant="outline"
      className="gap-1.5 text-[10px] bg-destructive/10 text-destructive border-destructive/20"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-destructive" />
      Hata
    </Badge>
  )
}

export interface ProductColumnMeta {
  onOpenDetail: (id: string) => void
}

export function getProductColumns(
  meta: ProductColumnMeta
): ColumnDef<AdminProductListItem>[] {
  return [
    {
      accessorKey: 'name',
      header: 'Ürün',
      cell: ({ row }) => {
        const product = row.original
        return (
          <button
            type="button"
            onClick={() => meta.onOpenDetail(product.id)}
            className="flex items-center gap-3 text-left group/product w-full"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-linear-to-br from-muted to-muted text-muted-foreground ring-1 ring-border/60 transition-all group-hover/product:text-muted-foreground">
              <Package size={14} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-foreground text-sm leading-snug truncate group-hover/product:text-foreground transition-colors">
                {product.name}
              </p>
              <p className="text-[11px] text-muted-foreground font-mono truncate">
                #{product.id} · ArtLink {product.articleLinkId}
                {product.variantCount && product.variantCount > 1
                  ? ` · ${product.variantCount} varyant`
                  : null}
              </p>
            </div>
          </button>
        )
      },
    },
    {
      accessorKey: 'brand',
      header: 'Marka',
      cell: ({ row }) => {
        const brand = row.original.brand
        return (
          <span className="text-sm font-medium text-foreground">
            {brand || (
              <span className="text-muted-foreground italic">—</span>
            )}
          </span>
        )
      },
    },
    {
      accessorKey: 'category',
      header: 'Kategori',
      cell: ({ row }) => {
        const category = row.original.category
        return (
          <span className="text-sm text-muted-foreground max-w-[140px] truncate block">
            {category || (
              <span className="text-muted-foreground italic">—</span>
            )}
          </span>
        )
      },
    },
    {
      accessorKey: 'sellingPrice',
      header: 'Fiyat',
      cell: ({ row }) => {
        return (
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium text-foreground">
              {formatCurrency(row.original.sellingPrice)}
            </span>
            <span className="text-[11px] font-medium text-muted-foreground">
              ₺
            </span>
          </div>
        )
      },
    },
    {
      accessorKey: 'stockStatus',
      header: 'Stok',
      cell: ({ row }) => {
        const product = row.original
        return (
          <div className="flex items-center gap-2">
            <StockBadge status={product.stockStatus} />
            <span className="text-[11px] text-muted-foreground whitespace-nowrap">
              {product.availableStockQty} adet
            </span>
          </div>
        )
      },
    },
    {
      accessorKey: 'syncStatus',
      header: 'Durum',
      cell: ({ row }) => {
        const product = row.original
        return (
          <div className="flex items-center gap-3">
            <SyncBadge status={product.syncStatus} />
            <div className="flex items-center gap-1.5">
              <span
                className={`inline-block h-2 w-2 rounded-full ${
                  product.isVisible ? 'bg-success' : 'bg-muted-foreground/30'
                }`}
              />
              <span className="text-[11px] font-medium text-muted-foreground">
                {product.isVisible ? 'Görünür' : 'Gizli'}
              </span>
            </div>
          </div>
        )
      },
    },
    {
      id: 'actions',
      header: () => <span className="sr-only">Aksiyon</span>,
      cell: ({ row }) => {
        const product = row.original
        return (
          <div className="flex items-center justify-end">
            <AdminRowActions
              actions={[
                {
                  label: 'Ürün Detayları',
                  onClick: () => meta.onOpenDetail(product.id),
                },
              ]}
            />
          </div>
        )
      },
    },
  ]
}
