'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import {
  BadgeCheck,
  Shield,
  UserCheck,
  Users
} from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useDebouncedCallback } from 'use-debounce'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import {
  MobileDataCard,
  ResponsiveDataView
} from '@/components/admin/responsive-data-view'
import { AdminFilterBar, AdminFilterChip } from '@/components/admin/data-table/admin-filter-chip'
import { AdminKpiCard, AdminKpiGrid } from '@/components/admin/data-table/admin-kpi-card'
import { AdminTableToolbar } from '@/components/admin/data-table/admin-table-toolbar'
import { DataTable } from '@/components/admin/data-table/data-table'
import { createCustomerColumns } from './customer-columns'
import {
  bulkUpdateCustomerRole,
  updateCustomerRole
} from '@/lib/actions/admin-customers'
import type {
  AdminCustomerListItem,
  AdminCustomersResult
} from '@/lib/types/admin-customers'
import { CustomerDetailDrawer } from './CustomerDetailDrawer'

interface CustomersAdminClientProps {
  data: AdminCustomersResult
}

export function CustomersAdminClient({ data }: CustomersAdminClientProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [isPending, startTransition] = useTransition()
  const [isRefreshing, startRefresh] = useTransition()
  const [customers, setCustomers] = useState<AdminCustomerListItem[]>(data.customers)
  const [searchValue, setSearchValue] = useState(searchParams.get('q') || '')
  const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({})
  const [rowRoles, setRowRoles] = useState<Record<string, 'ADMIN' | 'CUSTOMER'>>({})
  const [bulkRole, setBulkRole] = useState<'ADMIN' | 'CUSTOMER'>('CUSTOMER')

  const [detailCustomerId, setDetailCustomerId] = useState<string | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)

  const currentRole = searchParams.get('role') || 'all'

  useEffect(() => {
    setCustomers(data.customers)
    setRowSelection({})
    const nextRoles: Record<string, 'ADMIN' | 'CUSTOMER'> = {}
    for (const customer of data.customers) {
      nextRoles[customer.id] = customer.role === 'ADMIN' ? 'ADMIN' : 'CUSTOMER'
    }
    setRowRoles(nextRoles)
  }, [data.customers])

  useEffect(() => {
    setSearchValue(searchParams.get('q') || '')
  }, [searchParams])

  const selectedIds = useMemo(
    () => Object.entries(rowSelection).filter(([, v]) => v).map(([k]) => k),
    [rowSelection]
  )

  const setParam = (name: string, value?: string | null) => {
    const params = new URLSearchParams(searchParams.toString())
    if (!value || value === 'all') {
      params.delete(name)
    } else {
      params.set(name, value)
    }
    params.delete('page')
    router.push(`${pathname}?${params.toString()}`)
  }

  const onSearch = useDebouncedCallback((value: string) => {
    setParam('q', value.trim() || null)
  }, 250)

  const resetFilters = () => {
    setSearchValue('')
    router.push(pathname)
  }

  const handleRoleChange = (id: string, role: 'ADMIN' | 'CUSTOMER') => {
    setRowRoles((prev) => ({ ...prev, [id]: role }))
  }

  const saveRole = (userId: string) => {
    const role = rowRoles[userId]
    if (!role) return

    startTransition(async () => {
      const result = await updateCustomerRole({ userId, role })
      if (!result.success) {
        toast.error(result.message)
        return
      }
      setCustomers((prev) =>
        prev.map((customer) =>
          customer.id === userId ? { ...customer, role } : customer
        )
      )
      toast.success(result.message)
    })
  }

  const applyBulkRole = () => {
    if (selectedIds.length === 0) {
      toast.error('Lütfen en az bir müşteri seçin.')
      return
    }

    startTransition(async () => {
      const result = await bulkUpdateCustomerRole({
        userIds: selectedIds,
        role: bulkRole
      })
      if (!result.success) {
        toast.error(result.message)
        return
      }
      setCustomers((prev) =>
        prev.map((customer) =>
          selectedIds.includes(customer.id)
            ? { ...customer, role: bulkRole }
            : customer
        )
      )
      setRowRoles((prev) => {
        const next = { ...prev }
        for (const id of selectedIds) {
          next[id] = bulkRole
        }
        return next
      })
      setRowSelection({})
      toast.success(`${result.affected} müşteri güncellendi.`)
    })
  }

  const goPage = (page: number) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('page', String(page))
    router.push(`${pathname}?${params.toString()}`)
  }

  const handleRefresh = () => {
    startRefresh(() => {
      router.refresh()
    })
  }

  const columns = useMemo(
    () =>
      createCustomerColumns({
        onDetails: (id) => {
          setDetailCustomerId(id)
          setDetailOpen(true)
        },
        onSaveRole: saveRole,
        rowRoles,
        onRoleChange: handleRoleChange,
        isPending,
      }),
    [rowRoles, isPending]
  )

  return (
    <div className="space-y-4">
      <AdminKpiGrid>
        <AdminKpiCard label="Toplam Müşteri" value={data.kpis.totalCustomers} icon={<Users size={16} />} />
        <AdminKpiCard label="Admin Kullanıcı" value={data.kpis.adminUsers} tone="info" icon={<Shield size={16} />} />
        <AdminKpiCard label="Doğrulanmış" value={data.kpis.verifiedCustomers} icon={<BadgeCheck size={16} />} />
        <AdminKpiCard label="Aktif Müşteri" value={data.kpis.activeCustomers} tone="warning" icon={<UserCheck size={16} />} />
      </AdminKpiGrid>

      <div className="rounded-md border border-border bg-card p-4">
        <AdminTableToolbar
          searchValue={searchValue}
          onSearchChange={(nextValue) => {
            setSearchValue(nextValue)
            onSearch(nextValue)
          }}
          searchPlaceholder="Müşteri adı veya e-posta ara..."
          onRefresh={handleRefresh}
          isRefreshing={isRefreshing || isPending}
        />

        <AdminFilterBar onReset={resetFilters} className="mt-3">
          <AdminFilterChip
            active={currentRole === 'CUSTOMER'}
            onClick={() => setParam('role', currentRole === 'CUSTOMER' ? null : 'CUSTOMER')}
            label="Müşteri"
          />
          <AdminFilterChip
            active={currentRole === 'ADMIN'}
            onClick={() => setParam('role', currentRole === 'ADMIN' ? null : 'ADMIN')}
            label="Admin"
          />
        </AdminFilterBar>
      </div>

      {selectedIds.length > 0 && (
        <div className="rounded-md border border-border bg-card p-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-center">
            <p className="text-sm font-semibold text-foreground">
              Toplu Rol Güncelle ({selectedIds.length} seçili)
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={bulkRole} onValueChange={(v) => setBulkRole(v as 'ADMIN' | 'CUSTOMER')}>
                <SelectTrigger className="w-[170px]">
                  <SelectValue placeholder="Rol seçin" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CUSTOMER">CUSTOMER</SelectItem>
                  <SelectItem value="ADMIN">ADMIN</SelectItem>
                </SelectContent>
              </Select>
              <Button onClick={applyBulkRole} disabled={isPending || selectedIds.length === 0}>
                Uygula
              </Button>
            </div>
          </div>
        </div>
      )}

      <ResponsiveDataView
        mobile={
          customers.length === 0 ? (
            <div className="rounded-lg border border-border bg-background px-4 py-14 text-center text-sm text-muted-foreground">
              Müşteri bulunamadı.
            </div>
          ) : (
            <div className="space-y-3">
              {customers.map((customer) => (
                <MobileDataCard key={customer.id}>
                  <div className="flex items-start justify-between gap-3">
                    <span className="min-w-0">
                      <p className="font-semibold text-foreground truncate">{customer.name}</p>
                      <p className="text-xs text-muted-foreground truncate">{customer.email}</p>
                    </span>
                    <span className={`text-[10px] px-2 py-0.5 rounded border ${
                      customer.emailVerified
                        ? 'bg-green-50 text-green-700 border-green-200'
                        : 'bg-amber-50 text-amber-700 border-amber-200'
                    }`}>
                      {customer.emailVerified ? 'Doğrulandı' : 'Doğrulanmadı'}
                    </span>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                    <p className="col-span-2">Kayıt: {new Date(customer.createdAt).toLocaleDateString('tr-TR')}</p>
                    <p>Sipariş: {customer.ordersCount}</p>
                    <p className="font-semibold text-foreground">{formatCurrency(customer.totalSpent, 'TRY')}</p>
                  </div>
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                    <Select
                      value={rowRoles[customer.id] || 'CUSTOMER'}
                      onValueChange={(v) => handleRoleChange(customer.id, v as 'ADMIN' | 'CUSTOMER')}
                    >
                      <SelectTrigger className="h-9 flex-1 text-xs"><SelectValue placeholder="Rol seçin" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="CUSTOMER">CUSTOMER</SelectItem>
                        <SelectItem value="ADMIN">ADMIN</SelectItem>
                      </SelectContent>
                    </Select>
                    <div className="flex items-center justify-end">
                      <Button size="sm" variant="outline" onClick={() => { setDetailCustomerId(customer.id); setDetailOpen(true); }}>Detay</Button>
                      <Button size="sm" className="ml-2" disabled={isPending} onClick={() => saveRole(customer.id)}>
                        {isPending ? 'Kaydediliyor…' : 'Kaydet'}
                      </Button>
                    </div>
                  </div>
                </MobileDataCard>
              ))}
            </div>
          )
        }
        desktop={
          <DataTable
            columns={columns}
            data={customers}
            pagination={data.pagination}
            onPaginationChange={goPage}
            rowSelection={rowSelection}
            onRowSelectionChange={setRowSelection}
            emptyMessage="Müşteri bulunamadı."
          />
        }
      />

      <CustomerDetailDrawer
        customerId={detailCustomerId}
        open={detailOpen}
        onOpenChange={setDetailOpen}
      />
    </div>
  )
}

function formatCurrency(value: number, currency: string) {
  return value.toLocaleString('tr-TR', { style: 'currency', currency, maximumFractionDigits: 2 })
}
