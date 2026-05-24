'use client'

import { ColumnDef } from '@tanstack/react-table'
import { DataTableColumnHeader } from '../data-table-column-header'

export interface ProductRow {
  id: string
  stockCode: string
  stockName: string | null
  brand: string | null
  price: string | null
  barcode1: string | null
  barcode2: string | null
  barcode3: string | null
}

export const productsColumns: ColumnDef<ProductRow, unknown>[] = [
  {
    accessorKey: 'stockCode',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Stok Kodu" />,
    cell: ({ getValue }) => <span className="text-sm font-medium font-mono">{getValue<string>()}</span>,
    enableHiding: false,
  },
  {
    accessorKey: 'stockName',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Stok Adı" />,
    cell: ({ getValue }) => {
      const v = getValue<string | null>()
      return <span className="text-sm text-muted-foreground max-w-48 block truncate" title={v ?? undefined}>{v || '-'}</span>
    },
  },
  {
    accessorKey: 'brand',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Marka" />,
    cell: ({ getValue }) => <span className="text-sm">{getValue<string | null>() || '-'}</span>,
  },
  {
    accessorKey: 'price',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Fiyat" />,
    cell: ({ getValue }) => {
      const v = getValue<string | null>()
      return <span className="text-sm">{v ? `${Number(v).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺` : '-'}</span>
    },
  },
  {
    accessorKey: 'barcode1',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Barkod 1" />,
    cell: ({ getValue }) => <span className="text-xs text-muted-foreground font-mono">{getValue<string | null>() || '-'}</span>,
  },
  {
    accessorKey: 'barcode2',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Barkod 2" />,
    cell: ({ getValue }) => <span className="text-xs text-muted-foreground font-mono">{getValue<string | null>() || '-'}</span>,
  },
  {
    accessorKey: 'barcode3',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Barkod 3" />,
    cell: ({ getValue }) => <span className="text-xs text-muted-foreground font-mono">{getValue<string | null>() || '-'}</span>,
  },
  {
    accessorKey: 'id',
    header: ({ column }) => <DataTableColumnHeader column={column} title="ID" />,
    cell: ({ getValue }) => <span className="text-xs text-muted-foreground font-mono">{getValue<string>()}</span>,
  },
]
