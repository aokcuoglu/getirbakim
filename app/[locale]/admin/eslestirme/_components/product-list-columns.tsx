'use client'

import { ColumnDef } from '@tanstack/react-table'
import { CornerDownRight, Link2, Pencil } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  PRODUCT_LIST_SUPPLIER_LABELS,
  type ProductListSupplier,
  type SupplierProductRow
} from '@/lib/admin/product-match-shared'
import { CoverageBadge } from './CoverageBadge'

const DOT: Record<ProductListSupplier, string> = {
  dinamik: 'bg-blue-500',
  basbug: 'bg-violet-500'
}

/**
 * Alternatif varyant satırının açıklaması. Admin'in kafasındaki soru
 * "neden eşleşmedi" değil, "kaybettim mi" — cevap: hayır, ürün katalogta.
 */
function variantTitle(row: SupplierProductRow): string {
  const owner = row.variantOf
  if (!owner) return ''
  const blocked = owner.blockingSku
    ? ` ve bu ürünün ${PRODUCT_LIST_SUPPLIER_LABELS[row.supplier]} teklifi «${owner.blockingSku}» satırında dolu`
    : ''
  return (
    `Tedarikçi aynı parçayı birden çok stok koduyla listelemiş: bu satırın part numarası ` +
    `zaten «${owner.name ?? owner.productId}» kanonik ürününe düşüyor${blocked}. ` +
    `Ürün katalogta ve satılabilir — eksik bir şey yok, bu satır ikinci yazılış.`
  )
}

export function createProductListColumns(handlers: {
  onMatch: (row: SupplierProductRow) => void
  /** Varyantı bloklayan satıra atla (arama kutusunu blokçu SKU'ya çevirir). */
  onVariantJump: (row: SupplierProductRow) => void
}): ColumnDef<SupplierProductRow, unknown>[] {
  return [
    {
      id: 'supplier',
      header: 'Firma',
      cell: ({ row }) => {
        const s = row.original.supplier
        return (
          <span className="flex items-center gap-1.5">
            <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${DOT[s]}`} />
            <span className="text-xs font-medium">{PRODUCT_LIST_SUPPLIER_LABELS[s]}</span>
          </span>
        )
      },
      enableSorting: false
    },
    {
      accessorKey: 'brandName',
      header: 'Marka',
      cell: ({ getValue }) => (
        <span className="text-sm font-medium">{getValue<string>() || '—'}</span>
      )
    },
    {
      accessorKey: 'name',
      header: 'Ürün',
      cell: ({ row }) => (
        <div className="w-[220px] min-w-0 max-w-[220px]">
          <p className="truncate text-sm" title={row.original.name || row.original.sku}>
            {row.original.name || row.original.sku}
          </p>
          <p className="truncate text-[11px] text-muted-foreground">
            SKU: {row.original.sku}
            {row.original.partNo ? ` · part: ${row.original.partNo}` : ''}
          </p>
        </div>
      )
    },
    {
      id: 'status',
      header: 'Durum',
      cell: ({ row }) => {
        const r = row.original
        return r.matched ? (
          <div className="w-[200px] min-w-0 max-w-[200px]">
            <div className="flex flex-wrap items-center gap-1">
              <Badge variant="outline" className="border-success/20 bg-success/15 text-success">
                Eşleşti
              </Badge>
              {r.coverage ? <CoverageBadge coverage={r.coverage} /> : null}
            </div>
            {r.canonicalName ? (
              <p
                className={`mt-0.5 truncate text-[11px] ${
                  r.canonicalNameOverridden ? 'font-medium text-foreground' : 'text-muted-foreground'
                }`}
                title={
                  r.canonicalNameOverridden
                    ? `Kanonik ad (isim override): ${r.canonicalName}`
                    : r.canonicalName
                }
              >
                → {r.canonicalName}
                {r.canonicalNameOverridden ? (
                  <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                    (özel ad)
                  </span>
                ) : null}
              </p>
            ) : null}
          </div>
        ) : r.variantOf ? (
          // Offer'ı yok ama parçası katalogta: "Eşleşmedi" demek yanlış olurdu —
          // admin'i olmayan bir boşluğu doldurmaya gönderirdi.
          <div className="w-[200px] min-w-0 max-w-[200px]">
            <Badge
              variant="outline"
              className="border-violet-500/20 bg-violet-500/10 text-violet-600 dark:text-violet-400"
              title={variantTitle(r)}
            >
              Alternatif varyant
            </Badge>
            {r.variantOf.name ? (
              <p className="mt-0.5 truncate text-[11px] text-muted-foreground" title={r.variantOf.name}>
                → {r.variantOf.name}
              </p>
            ) : null}
          </div>
        ) : (
          <Badge
            variant="outline"
            className="border-warning/20 bg-warning/15 text-warning"
            title="Bu parça bu tedarikçiden hiç bağlanamamış — gerçek boşluk"
          >
            Eşleşmedi
          </Badge>
        )
      },
      enableSorting: false
    },
    {
      id: 'oem',
      header: 'OEM',
      cell: ({ row }) => {
        const count = row.original.oemCount
        // Eşleşmemiş satırda kanonik ürün yok; "0" demek yanıltıcı olurdu.
        if (count == null) return <span className="text-xs text-muted-foreground">—</span>
        return count === 0 ? (
          <Badge
            variant="outline"
            className="border-warning/20 bg-warning/15 text-warning"
            title="Bu ürünün hiç OEM kodu yok"
          >
            yok
          </Badge>
        ) : (
          <span className="text-xs tabular-nums text-muted-foreground" title={`${count} OEM kodu`}>
            {count}
          </span>
        )
      },
      enableSorting: false
    },
    {
      id: 'actions',
      header: 'İşlem',
      cell: ({ row }) => {
        const r = row.original
        // Varyant satırında "Eşleştir" çıkmaz kapı: manuel eşleştirme
        // SUPPLIER_CONFLICT ile reddeder. Bunun yerine offer'ı tutan kardeş
        // satıra götürürüz — admin'in gerçekten aradığı satır odur.
        if (!r.matched && r.variantOf) {
          return (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handlers.onVariantJump(r)}
              className="h-8 gap-1"
              disabled={!r.variantOf.blockingSku}
              title={
                r.variantOf.blockingSku
                  ? `Bu parçanın bağlı satırına git: ${r.variantOf.blockingSku}`
                  : 'Bağlı satır bulunamadı'
              }
            >
              <CornerDownRight className="h-3.5 w-3.5" />
              <span className="text-xs">Bağlı satıra git</span>
            </Button>
          )
        }
        return (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handlers.onMatch(r)}
            className="h-8 gap-1"
            title={r.matched ? 'Düzenle' : 'Eşleştir'}
          >
            {r.matched ? <Pencil className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}
            <span className="text-xs">{r.matched ? 'Düzenle' : 'Eşleştir'}</span>
          </Button>
        )
      },
      enableSorting: false
    }
  ]
}
