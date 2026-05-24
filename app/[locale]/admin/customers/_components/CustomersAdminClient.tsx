'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { Filter, Loader2, RefreshCw, Search } from 'lucide-react'
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
  MobileDataCard,
  ResponsiveDataView
} from '@/components/admin/responsive-data-view'
import {
  bulkUpdateCustomerRole,
  updateCustomerRole
} from '@/lib/actions/admin-customers'
import type { AdminCustomersResult } from '@/lib/types/admin-customers'
import { CustomerDetailDrawer } from './CustomerDetailDrawer'

interface CustomersAdminClientProps {
  data: AdminCustomersResult
}

export function CustomersAdminClient({ data }: CustomersAdminClientProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [isPending, startTransition] = useTransition()
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [rowRoles, setRowRoles] = useState<Record<string, 'ADMIN' | 'CUSTOMER'>>({})
  const [bulkRole, setBulkRole] = useState<'ADMIN' | 'CUSTOMER'>('CUSTOMER')

  const [detailCustomerId, setDetailCustomerId] = useState<string | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)

  useEffect(() => {
    setSelectedIds([])
    const nextRoles: Record<string, 'ADMIN' | 'CUSTOMER'> = {}
    for (const customer of data.customers) {
      nextRoles[customer.id] = customer.role === 'ADMIN' ? 'ADMIN' : 'CUSTOMER'
    }
    setRowRoles(nextRoles)
  }, [data.customers])

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
  }, 300)

  const allVisibleSelected = useMemo(() => {
    if (data.customers.length === 0) return false
    return data.customers.every((customer) => selectedIds.includes(customer.id))
  }, [data.customers, selectedIds])

  const toggleAllVisible = () => {
    if (allVisibleSelected) {
      setSelectedIds((prev) =>
        prev.filter((id) => !data.customers.some((customer) => customer.id === id))
      )
    } else {
      setSelectedIds((prev) =>
        Array.from(new Set([...prev, ...data.customers.map((customer) => customer.id)]))
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
      toast.success(result.message)
      router.refresh()
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
      toast.success(`${result.affected} müşteri güncellendi.`)
      router.refresh()
    })
  }

  const goPage = (page: number) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('page', String(page))
    router.push(`${pathname}?${params.toString()}`)
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Toplam Müşteri" value={data.kpis.totalCustomers} tone="slate" />
        <KpiCard label="Admin Kullanıcı" value={data.kpis.adminUsers} tone="violet" />
        <KpiCard label="Doğrulanmış" value={data.kpis.verifiedCustomers} tone="emerald" />
        <KpiCard label="Aktif Müşteri" value={data.kpis.activeCustomers} tone="amber" />
      </div>

      <div className="rounded-xl border border-border bg-background p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative w-full max-w-lg">
            <Search
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              defaultValue={searchParams.get('q') || ''}
              onChange={(event) => onSearch(event.target.value)}
              placeholder="Müşteri adı veya e-posta ara..."
              className="w-full rounded-md border border-border bg-background py-2 pl-9 pr-3 text-sm"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 rounded-md border border-border bg-background px-2 py-1 text-xs text-muted-foreground">
              <Filter size={12} />
              <span>Rol</span>
              <Select
                value={searchParams.get('role') || 'all'}
                onValueChange={(value) => setParam('role', value)}
              >
                <SelectTrigger className="h-7 w-[130px] border-none bg-transparent px-1 text-xs text-foreground shadow-none focus-visible:ring-0">
                  <SelectValue placeholder="Tümü" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tümü</SelectItem>
                  <SelectItem value="CUSTOMER">CUSTOMER</SelectItem>
                  <SelectItem value="ADMIN">ADMIN</SelectItem>
                </SelectContent>
              </Select>
            </label>

            <Button
              variant="outline"
              onClick={() => router.refresh()}
              disabled={isPending}
            >
              {isPending ? (
                <Loader2 size={14} className="mr-2 animate-spin" />
              ) : (
                <RefreshCw size={14} className="mr-2" />
              )}
              Yenile
            </Button>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-background p-4">
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
            <Button onClick={applyBulkRole} disabled={isPending || selectedIds.length === 0}>
              Uygula
            </Button>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-background p-3 md:p-0 md:border-0 md:bg-transparent">
        <ResponsiveDataView
          mobile={
            data.customers.length === 0 ? (
              <div className="rounded-xl border border-border bg-background px-4 py-12 text-center text-muted-foreground">
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
                  Bu sayfadaki tum musterileri sec
                </label>
                {data.customers.map((customer) => (
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
                      <Badge
                        variant="outline"
                        className={
                          customer.emailVerified
                            ? 'text-[10px] bg-success/10 text-success border-success/20'
                            : 'text-[10px] bg-warning/10 text-warning border-warning/20'
                        }
                      >
                        {customer.emailVerified ? 'Dogrulandi' : 'Bekliyor'}
                      </Badge>
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
                            [customer.id]: value as
                              | 'ADMIN'
                              | 'CUSTOMER'
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
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setDetailCustomerId(customer.id)
                            setDetailOpen(true)
                          }}
                        >
                          Detay
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => saveRole(customer.id)}
                          disabled={isPending}
                         
                        >
                          Kaydet
                        </Button>
                      </div>
                    </div>
                  </MobileDataCard>
                ))}
              </div>
            )
          }
          desktop={
            <div className="overflow-x-auto rounded-xl border border-border bg-background">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-muted/80 text-left text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    <th className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={allVisibleSelected}
                        onChange={toggleAllVisible}
                      />
                    </th>
                    <th className="px-4 py-3">Müşteri</th>
                    <th className="px-4 py-3">İletişim</th>
                    <th className="px-4 py-3">Sipariş</th>
                    <th className="px-4 py-3">Toplam Harcama</th>
                    <th className="px-4 py-3">Rol</th>
                    <th className="px-4 py-3 text-right">Aksiyon</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.customers.map((customer) => (
                    <tr key={customer.id} className="hover:bg-muted/60">
                      <td className="px-4 py-3 align-top">
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(customer.id)}
                          onChange={() => toggleSelection(customer.id)}
                        />
                      </td>
                      <td className="px-4 py-3 align-top">
                        <p className="font-semibold text-foreground">
                          {customer.name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Kayıt:{' '}
                          {new Date(customer.createdAt).toLocaleDateString(
                            'tr-TR'
                          )}
                        </p>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <p className="text-sm text-foreground">{customer.email}</p>
                        <Badge
                          variant="outline"
                          className={
                            customer.emailVerified
                              ? 'text-[10px] bg-success/10 text-success border-success/20'
                              : 'text-[10px] bg-warning/10 text-warning border-warning/20'
                          }
                        >
                          {customer.emailVerified ? 'Doğrulandı' : 'Doğrulanmadı'}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 align-top text-muted-foreground">
                        {customer.ordersCount}
                      </td>
                      <td className="px-4 py-3 align-top font-semibold text-foreground">
                        {customer.totalSpent.toLocaleString('tr-TR', {
                          style: 'currency',
                          currency: 'TRY',
                          maximumFractionDigits: 2
                        })}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <Select
                          value={rowRoles[customer.id] || 'CUSTOMER'}
                          onValueChange={(value) =>
                            setRowRoles((prev) => ({
                              ...prev,
                              [customer.id]: value as
                                | 'ADMIN'
                                | 'CUSTOMER'
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
                      </td>
                      <td className="px-4 py-3 align-top text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setDetailCustomerId(customer.id)
                              setDetailOpen(true)
                            }}
                          >
                            Detay
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => saveRole(customer.id)}
                            disabled={isPending}
                           
                          >
                            Kaydet
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}

                  {data.customers.length === 0 && (
                    <tr>
                      <td
                        colSpan={7}
                        className="px-4 py-12 text-center text-muted-foreground"
                      >
                        Müşteri bulunamadı.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          }
        />
      </div>

      <Pagination
        currentPage={data.pagination.page}
        totalPages={data.pagination.pages}
        totalItems={data.pagination.total}
        itemsPerPage={data.pagination.limit}
        onPageChange={goPage}
      />

      <CustomerDetailDrawer
        customerId={detailCustomerId}
        open={detailOpen}
        onOpenChange={setDetailOpen}
      />
    </div>
  )
}

function KpiCard({
  label,
  value,
  tone
}: {
  label: string
  value: number
  tone: 'slate' | 'violet' | 'emerald' | 'amber'
}) {
  const toneClass =
    tone === 'violet'
      ? 'bg-accent text-primary border-border'
      : tone === 'emerald'
        ? 'bg-success/10 text-success border-success/20'
        : tone === 'amber'
          ? 'bg-warning/10 text-warning border-warning/20'
          : 'bg-muted text-foreground border-border'

  return (
    <div className={`rounded-xl border p-4 ${toneClass}`}>
      <p className="text-xs font-medium uppercase tracking-wider">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value.toLocaleString('tr-TR')}</p>
    </div>
  )
}
