'use client'

import { ColumnDef } from '@tanstack/react-table'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { AdminRowActions } from '@/components/admin/data-table/admin-row-actions'
import { formatCurrency } from '@/lib/utils'
import type { AdminCustomerListItem } from '@/lib/types/admin-customers'

function VerificationBadge({ verified }: { verified: boolean }) {
  return (
    <Badge
      variant="outline"
      className={
        verified
          ? 'mt-1 gap-1.5 text-[10px] bg-green-50 text-green-700 border-green-200'
          : 'mt-1 gap-1.5 text-[10px] bg-amber-50 text-amber-700 border-amber-200'
      }
    >
      <span className={`h-1.5 w-1.5 rounded-full ${verified ? 'bg-green-500' : 'bg-amber-500'}`} />
      {verified ? 'Doğrulandı' : 'Doğrulanmadı'}
    </Badge>
  )
}

export interface CustomerColumnHandlers {
  onDetails?: (id: string) => void
  onSaveRole?: (id: string) => void
  rowRoles?: Record<string, 'ADMIN' | 'CUSTOMER'>
  onRoleChange?: (id: string, role: 'ADMIN' | 'CUSTOMER') => void
  isPending?: boolean
}

export function createCustomerColumns(
  handlers: CustomerColumnHandlers
): ColumnDef<AdminCustomerListItem, unknown>[] {
  return [
    {
      id: 'select',
      header: ({ table }) => (
        <Checkbox
          checked={table.getIsAllPageRowsSelected()}
          onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
          aria-label="Tümünü seç"
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(!!value)}
          aria-label="Satır seç"
        />
      ),
      enableSorting: false,
      enableHiding: false,
    },
    {
      accessorKey: 'name',
      header: () => <span className="text-xs font-medium">Müşteri</span>,
      cell: ({ row }) => (
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{row.original.name}</p>
          <p className="text-[11px] text-muted-foreground">
            Kayıt: {new Date(row.original.createdAt).toLocaleDateString('tr-TR')}
          </p>
        </div>
      ),
    },
    {
      accessorKey: 'email',
      header: () => <span className="text-xs font-medium">İletişim</span>,
      cell: ({ row }) => (
        <div>
          <p className="text-sm text-foreground">{row.original.email}</p>
          <VerificationBadge verified={row.original.emailVerified} />
        </div>
      ),
    },
    {
      accessorKey: 'ordersCount',
      header: () => <span className="text-xs font-medium">Sipariş</span>,
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">{row.original.ordersCount}</span>
      ),
    },
    {
      accessorKey: 'totalSpent',
      header: () => <span className="text-xs font-medium">Toplam Harcama</span>,
      cell: ({ row }) => (
        <span className="text-sm font-semibold">
          {formatCurrency(row.original.totalSpent, 'TRY')}
        </span>
      ),
    },
    {
      accessorKey: 'role',
      header: () => <span className="text-xs font-medium">Rol</span>,
      cell: ({ row }) => {
        const currentRole = handlers.rowRoles?.[row.original.id] || row.original.role || 'CUSTOMER'
        return (
          <Select
            value={currentRole}
            onValueChange={(value) =>
              handlers.onRoleChange?.(row.original.id, value as 'ADMIN' | 'CUSTOMER')
            }
          >
            <SelectTrigger className="h-8 w-[140px] text-xs">
              <SelectValue placeholder="Rol seçin" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="CUSTOMER">CUSTOMER</SelectItem>
              <SelectItem value="ADMIN">ADMIN</SelectItem>
            </SelectContent>
          </Select>
        )
      },
    },
    {
      id: 'actions',
      header: () => (
        <span className="text-xs font-medium text-right w-full block pr-2">Aksiyon</span>
      ),
      cell: ({ row }) => (
        <div className="flex justify-end">
          <AdminRowActions
            srLabel={`Müşteri ${row.original.name} işlemleri`}
            actions={[
              {
                label: 'Detay',
                onClick: () => handlers.onDetails?.(row.original.id),
              },
              {
                label: handlers.isPending ? 'Kaydediliyor…' : 'Kaydet',
                onClick: () => handlers.onSaveRole?.(row.original.id),
                disabled: handlers.isPending,
              },
            ]}
          />
        </div>
      ),
    },
  ]
}
