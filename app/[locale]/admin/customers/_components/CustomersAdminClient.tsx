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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Pagination } from '@/components/ui/Pagination'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'
import {
  MobileDataCard,
  ResponsiveDataView
} from '@/components/admin/responsive-data-view'
import { AdminFilterBar, AdminFilterChip } from '@/components/admin/data-table/admin-filter-chip'
import { AdminKpiCard, AdminKpiGrid } from '@/components/admin/data-table/admin-kpi-card'
import { AdminRowActions } from '@/components/admin/data-table/admin-row-actions'
import { AdminTableHead, adminTableHeaderRowClassName } from '@/components/admin/data-table/admin-table-head'
import { AdminTableShell } from '@/components/admin/data-table/admin-table-shell'
import { AdminTableToolbar } from '@/components/admin/data-table/admin-table-toolbar'
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
  const [customers, setCustomers] = useState<AdminCustomerListItem[]>(
    data.customers
  )
  const [searchValue, setSearchValue] = useState(searchParams.get('q') || '')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [rowRoles, setRowRoles] = useState<Record<string, 'ADMIN' | 'CUSTOMER'>>({})
  const [bulkRole, setBulkRole] = useState<'ADMIN' | 'CUSTOMER'>('CUSTOMER')

  const [detailCustomerId, setDetailCustomerId] = useState<string | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)

  const currentRole = searchParams.get('role') || 'all'

  useEffect(() => {
    setCustomers(data.customers)
    setSelectedIds([])
    const nextRoles: Record<string, 'ADMIN' | 'CUSTOMER'> = {}
    for (const customer of data.customers) {
      nextRoles[customer.id] = customer.role === 'ADMIN' ? 'ADMIN' : 'CUSTOMER'
    }
    setRowRoles(nextRoles)
  }, [data.customers])

  useEffect(() => {
    setSearchValue(searchParams.get('q') || '')
  }, [searchParams])

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

  const allVisibleSelected = useMemo(() => {
    if (customers.length === 0) return false
    return customers.every((customer) => selectedIds.includes(customer.id))
  }, [customers, selectedIds])

  const toggleAllVisible = () => {
    if (allVisibleSelected) {
      setSelectedIds((prev) =>
        prev.filter((id) => !customers.some((customer) => customer.id === id))
      )
    } else {
      setSelectedIds((prev) =>
        Array.from(new Set([...prev, ...customers.map((customer) => customer.id)]))
      )
    }
  }

  const toggleSelection = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    )
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

  return (
    <div className="space-y-4">
      <AdminKpiGrid>
        <AdminKpiCard
          label="Toplam Müşteri"
          value={data.kpis.totalCustomers}
          icon={<Users size={16} />}
        />
        <AdminKpiCard
          label="Admin Kullanıcı"
          value={data.kpis.adminUsers}
          tone="info"
          icon={<Shield size={16} />}
        />
        <AdminKpiCard
          label="Doğrulanmış"
          value={data.kpis.verifiedCustomers}
          tone="default"
          icon={<BadgeCheck size={16} />}
        />
        <AdminKpiCard
          label="Aktif Müşteri"
          value={data.kpis.activeCustomers}
          tone="warning"
          icon={<UserCheck size={16} />}
        />
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
            onClick={() =>
              setParam('role', currentRole === 'CUSTOMER' ? null : 'CUSTOMER')
            }
            label="Müşteri"
          />
          <AdminFilterChip
            active={currentRole === 'ADMIN'}
            onClick={() =>
              setParam('role', currentRole === 'ADMIN' ? null : 'ADMIN')
            }
            label="Admin"
          />
        </AdminFilterBar>
      </div>

      <div className="rounded-md border border-border bg-card p-4">
        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          <p className="text-sm font-semibold text-foreground">
            Toplu Rol Güncelle ({selectedIds.length} seçili)
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={bulkRole}
              onValueChange={(value) => setBulkRole(value as 'ADMIN' | 'CUSTOMER')}
            >
              <SelectTrigger className="w-[170px]">
                <SelectValue placeholder="Rol seçin" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="CUSTOMER">CUSTOMER</SelectItem>
                <SelectItem value="ADMIN">ADMIN</SelectItem>
              </SelectContent>
            </Select>
            <Button
              onClick={applyBulkRole}
              disabled={isPending || selectedIds.length === 0}
            >
              Uygula
            </Button>
          </div>
        </div>
      </div>

      <ResponsiveDataView
        mobile={
          customers.length === 0 ? (
            <div className="rounded-lg border border-border bg-background px-4 py-14 text-center text-sm text-muted-foreground">
              Müşteri bulunamadı.
            </div>
          ) : (
            <div className="space-y-3">
              <label className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={toggleAllVisible}
                />
                Bu sayfadaki tüm müşterileri seç
              </label>
              {customers.map((customer) => (
                <MobileDataCard key={customer.id}>
                  <div className="flex items-start justify-between gap-3">
                    <label className="flex min-w-0 items-start gap-2">
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(customer.id)}
                        onChange={() => toggleSelection(customer.id)}
                        className="mt-1"
                      />
                      <span className="min-w-0">
                        <p className="font-semibold text-foreground truncate">
                          {customer.name}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {customer.email}
                        </p>
                      </span>
                    </label>
                    <VerificationBadge verified={customer.emailVerified} />
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                    <p className="col-span-2">
                      Kayıt: {new Date(customer.createdAt).toLocaleDateString('tr-TR')}
                    </p>
                    <p>Sipariş: {customer.ordersCount}</p>
                    <p className="font-semibold text-foreground">
                      {customer.totalSpent.toLocaleString('tr-TR', {
                        style: 'currency',
                        currency: 'TRY',
                        maximumFractionDigits: 2
                      })}
                    </p>
                  </div>

                  <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                    <Select
                      value={rowRoles[customer.id] || 'CUSTOMER'}
                      onValueChange={(value) =>
                        setRowRoles((prev) => ({
                          ...prev,
                          [customer.id]: value as 'ADMIN' | 'CUSTOMER'
                        }))
                      }
                    >
                      <SelectTrigger className="h-9 flex-1 text-xs">
                        <SelectValue placeholder="Rol seçin" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="CUSTOMER">CUSTOMER</SelectItem>
                        <SelectItem value="ADMIN">ADMIN</SelectItem>
                      </SelectContent>
                    </Select>
                    <div className="flex items-center justify-end">
                      <AdminRowActions
                        actions={[
                          {
                            label: 'Detay',
                            onClick: () => {
                              setDetailCustomerId(customer.id)
                              setDetailOpen(true)
                            }
                          },
                          {
                            label: isPending ? 'Kaydediliyor…' : 'Kaydet',
                            onClick: () => saveRole(customer.id),
                            disabled: isPending
                          }
                        ]}
                      />
                    </div>
                  </div>
                </MobileDataCard>
              ))}
            </div>
          )
        }
        desktop={
          <AdminTableShell isLoading={isRefreshing || isPending}>
            <Table>
              <TableHeader>
                <TableRow className={adminTableHeaderRowClassName()}>
                  <TableHead className="w-10">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleAllVisible}
                    />
                  </TableHead>
                  <TableHead>
                    <AdminTableHead>Müşteri</AdminTableHead>
                  </TableHead>
                  <TableHead>
                    <AdminTableHead>İletişim</AdminTableHead>
                  </TableHead>
                  <TableHead>
                    <AdminTableHead>Sipariş</AdminTableHead>
                  </TableHead>
                  <TableHead>
                    <AdminTableHead>Toplam Harcama</AdminTableHead>
                  </TableHead>
                  <TableHead>
                    <AdminTableHead>Rol</AdminTableHead>
                  </TableHead>
                  <TableHead className="text-right">
                    <AdminTableHead className="justify-end">Aksiyon</AdminTableHead>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {customers.map((customer) => (
                  <TableRow
                    key={customer.id}
                    className="group transition-colors duration-150"
                  >
                    <TableCell>
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(customer.id)}
                        onChange={() => toggleSelection(customer.id)}
                      />
                    </TableCell>
                    <TableCell>
                      <p className="font-semibold text-sm text-foreground">
                        {customer.name}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        Kayıt:{' '}
                        {new Date(customer.createdAt).toLocaleDateString('tr-TR')}
                      </p>
                    </TableCell>
                    <TableCell>
                      <p className="text-sm text-foreground">{customer.email}</p>
                      <VerificationBadge verified={customer.emailVerified} />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {customer.ordersCount}
                    </TableCell>
                    <TableCell className="font-semibold text-sm text-foreground">
                      {customer.totalSpent.toLocaleString('tr-TR', {
                        style: 'currency',
                        currency: 'TRY',
                        maximumFractionDigits: 2
                      })}
                    </TableCell>
                    <TableCell>
                      <Select
                        value={rowRoles[customer.id] || 'CUSTOMER'}
                        onValueChange={(value) =>
                          setRowRoles((prev) => ({
                            ...prev,
                            [customer.id]: value as 'ADMIN' | 'CUSTOMER'
                          }))
                        }
                      >
                        <SelectTrigger className="h-8 w-[150px] text-xs">
                          <SelectValue placeholder="Rol seçin" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="CUSTOMER">CUSTOMER</SelectItem>
                          <SelectItem value="ADMIN">ADMIN</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end">
                        <AdminRowActions
                          actions={[
                            {
                              label: 'Detay',
                              onClick: () => {
                                setDetailCustomerId(customer.id)
                                setDetailOpen(true)
                              }
                            },
                            {
                              label: isPending ? 'Kaydediliyor…' : 'Kaydet',
                              onClick: () => saveRole(customer.id),
                              disabled: isPending
                            }
                          ]}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}

                {customers.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="h-48 text-center">
                      <div className="flex flex-col items-center gap-2">
                        <Users size={32} className="text-muted-foreground/50" />
                        <p className="text-sm font-medium text-muted-foreground">
                          Müşteri bulunamadı.
                        </p>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </AdminTableShell>
        }
      />

      <Pagination
        currentPage={data.pagination.page}
        totalPages={data.pagination.pages}
        totalItems={data.pagination.total}
        itemsPerPage={data.pagination.limit}
        onPageChange={goPage}
        compact
      />

      <CustomerDetailDrawer
        customerId={detailCustomerId}
        open={detailOpen}
        onOpenChange={setDetailOpen}
      />
    </div>
  )
}

function VerificationBadge({ verified }: { verified: boolean }) {
  return (
    <Badge
      variant="outline"
      className={
        verified
          ? 'mt-1 gap-1.5 text-[10px] bg-success/10 text-success border-success/20'
          : 'mt-1 gap-1.5 text-[10px] bg-warning/10 text-warning border-warning/20'
      }
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          verified ? 'bg-success' : 'bg-warning'
        }`}
      />
      {verified ? 'Doğrulandı' : 'Doğrulanmadı'}
    </Badge>
  )
}
