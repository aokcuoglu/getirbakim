'use client'

import { useEffect, useState, useTransition } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet'
import { getAdminCustomerDetail } from '@/lib/actions/admin-customers'
import type { AdminCustomerDetail } from '@/lib/types/admin-customers'

interface CustomerDetailDrawerProps {
  customerId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CustomerDetailDrawer({
  customerId,
  open,
  onOpenChange
}: CustomerDetailDrawerProps) {
  const [isPending, startTransition] = useTransition()
  const [detail, setDetail] = useState<AdminCustomerDetail | null>(null)

  useEffect(() => {
    if (!open || !customerId) return

    startTransition(async () => {
      const result = await getAdminCustomerDetail(customerId)
      if (!result.success || !result.data) {
        toast.error(result.message || 'Müşteri detayı alınamadı.')
        setDetail(null)
        return
      }
      setDetail(result.data)
    })
  }, [open, customerId])

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-[760px]">
        <SheetHeader>
          <SheetTitle>Müşteri Detayı</SheetTitle>
          <SheetDescription>
            {detail ? `${detail.name} (${detail.email})` : 'Müşteri detayları yükleniyor'}
          </SheetDescription>
        </SheetHeader>

        {isPending && !detail ? (
          <div className="mt-8 flex items-center justify-center text-gray-500">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Yükleniyor...
          </div>
        ) : detail ? (
          <div className="mt-5 space-y-4">
            <div className="grid grid-cols-1 gap-2 rounded-lg border border-gray-200 p-3 md:grid-cols-2">
              <Info label="Müşteri" value={detail.name} />
              <Info label="Rol" value={detail.role} />
              <Info label="E-posta" value={detail.email} />
              <Info label="Doğrulama" value={detail.emailVerified ? 'Doğrulandı' : 'Doğrulanmadı'} />
              <Info label="Sipariş Sayısı" value={String(detail.ordersCount)} />
              <Info
                label="Toplam Harcama"
                value={detail.totalSpent.toLocaleString('tr-TR', {
                  style: 'currency',
                  currency: 'TRY',
                  maximumFractionDigits: 2
                })}
              />
            </div>

            <div className="rounded-lg border border-gray-200">
              <div className="border-b border-gray-100 px-3 py-2 text-sm font-semibold text-[#101828]">
                Son Siparişler
              </div>
              <div className="max-h-56 overflow-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2">Sipariş</th>
                      <th className="px-3 py-2">Durum</th>
                      <th className="px-3 py-2">Tarih</th>
                      <th className="px-3 py-2">Tutar</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.orders.map((order) => (
                      <tr key={order.id} className="border-t border-gray-100">
                        <td className="px-3 py-2">#{order.id}</td>
                        <td className="px-3 py-2">{order.status}</td>
                        <td className="px-3 py-2">
                          {new Date(order.createdAt).toLocaleDateString('tr-TR')}
                        </td>
                        <td className="px-3 py-2 font-semibold">
                          {order.totalAmount.toLocaleString('tr-TR', {
                            style: 'currency',
                            currency: 'TRY',
                            maximumFractionDigits: 2
                          })}
                        </td>
                      </tr>
                    ))}
                    {detail.orders.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-3 py-3 text-gray-500">
                          Sipariş kaydı yok.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded-lg border border-gray-200">
              <div className="border-b border-gray-100 px-3 py-2 text-sm font-semibold text-[#101828]">
                Kayıtlı Araçlar
              </div>
              <div className="max-h-56 overflow-auto p-3 text-xs text-gray-700">
                {detail.vehicles.length === 0 ? (
                  <p>Araç kaydı yok.</p>
                ) : (
                  <ul className="space-y-2">
                    {detail.vehicles.map((vehicle) => (
                      <li key={vehicle.id} className="rounded-md bg-gray-50 p-2">
                        <p className="font-semibold">Araç #{vehicle.id}</p>
                        <pre className="mt-1 overflow-auto whitespace-pre-wrap break-all text-[11px] text-gray-600">
                          {JSON.stringify(vehicle.vehicleData, null, 2)}
                        </pre>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-8 text-sm text-gray-500">Müşteri bulunamadı.</div>
        )}
      </SheetContent>
    </Sheet>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-gray-50 px-3 py-2">
      <div className="text-[11px] font-medium text-gray-500">{label}</div>
      <div className="text-sm font-semibold text-[#101828]">{value}</div>
    </div>
  )
}
