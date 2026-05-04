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
import { getAdminOrderDetail } from '@/lib/actions/admin-orders'
import type { AdminOrderDetail } from '@/lib/types/admin-orders'

interface OrderDetailDrawerProps {
  orderId: number | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function OrderDetailDrawer({
  orderId,
  open,
  onOpenChange
}: OrderDetailDrawerProps) {
  const [isPending, startTransition] = useTransition()
  const [detail, setDetail] = useState<AdminOrderDetail | null>(null)

  useEffect(() => {
    if (!open || !orderId) return

    startTransition(async () => {
      const result = await getAdminOrderDetail(orderId)
      if (!result.success || !result.data) {
        toast.error(result.message || 'Sipariş detayı alınamadı.')
        setDetail(null)
        return
      }
      setDetail(result.data)
    })
  }, [open, orderId])

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-[720px]">
        <SheetHeader>
          <SheetTitle>Sipariş Detayı</SheetTitle>
          <SheetDescription>
            {detail
              ? `#${detail.id} - ${detail.customerName}`
              : 'Sipariş detayı yükleniyor'}
          </SheetDescription>
        </SheetHeader>

        {isPending && !detail ? (
          <div className="mt-8 flex items-center justify-center text-gray-500">
            <Loader2 size={18} className="mr-2 animate-spin" />
            Yükleniyor...
          </div>
        ) : detail ? (
          <div className="mt-5 space-y-4">
            <div className="grid grid-cols-1 gap-2 rounded-lg border border-gray-200 p-3 md:grid-cols-2">
              <Info label="Sipariş ID" value={detail.orderNumber} />
              <Info label="Durum" value={detail.status} />
              <Info label="Ödeme Durumu" value={detail.paymentStatus} />
              <Info label="Ödeme Yöntemi" value={detail.paymentMethod || '-'} />
              <Info label="Müşteri" value={detail.customerName} />
              <Info label="E-posta" value={detail.customerEmail || '-'} />
              <Info label="Telefon" value={detail.guestPhone || '-'} />
              <Info label="Kargo" value={detail.shippingMethod || '-'} />
              <Info
                label="Sipariş Tarihi"
                value={new Date(detail.createdAt).toLocaleString('tr-TR')}
              />
              <Info
                label="Tutar"
                value={detail.totalAmount.toLocaleString('tr-TR', {
                  style: 'currency',
                  currency: 'TRY',
                  maximumFractionDigits: 2
                })}
              />
            </div>

            {detail.latestPayment && (
              <div className="grid grid-cols-1 gap-2 rounded-lg border border-gray-200 p-3 md:grid-cols-2">
                <Info label="Provider" value={detail.latestPayment.provider} />
                <Info label="Payment Record" value={detail.latestPayment.status} />
                <Info
                  label="Provider Ref"
                  value={detail.latestPayment.providerPaymentId || '-'}
                />
                <Info
                  label="Ödeme Zamanı"
                  value={
                    detail.latestPayment.paidAt
                      ? new Date(detail.latestPayment.paidAt).toLocaleString('tr-TR')
                      : '-'
                  }
                />
                <Info
                  label="Hata"
                  value={detail.latestPayment.failureReason || '-'}
                />
              </div>
            )}

            <div className="rounded-lg border border-gray-200">
              <div className="border-b border-gray-100 px-4 py-3">
                <h4 className="text-sm font-semibold text-[#101828]">Sipariş Kalemleri</h4>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2">Ürün</th>
                      <th className="px-3 py-2">Article Link ID</th>
                      <th className="px-3 py-2">Adet</th>
                      <th className="px-3 py-2">Fiyat</th>
                      <th className="px-3 py-2">Toplam</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.items.map((item) => (
                      <tr key={item.id} className="border-t border-gray-100">
                        <td className="px-3 py-2">
                          <div className="font-medium text-[#101828]">{item.productName}</div>
                          <div className="text-[11px] text-gray-500">Part ID: {item.partId}</div>
                        </td>
                        <td className="px-3 py-2">{item.articleLinkId}</td>
                        <td className="px-3 py-2">{item.quantity}</td>
                        <td className="px-3 py-2">
                          {item.price.toLocaleString('tr-TR', {
                            style: 'currency',
                            currency: 'TRY',
                            maximumFractionDigits: 2
                          })}
                        </td>
                        <td className="px-3 py-2 font-semibold">
                          {(item.price * item.quantity).toLocaleString('tr-TR', {
                            style: 'currency',
                            currency: 'TRY',
                            maximumFractionDigits: 2
                          })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded-lg bg-gray-50 p-3 text-sm text-gray-700">
              <p>Toplam Kalem: {detail.items.length}</p>
              <p>Toplam Adet: {detail.summary.totalQuantity}</p>
              <p>
                Ara Toplam:{' '}
                {detail.subtotalAmount.toLocaleString('tr-TR', {
                  style: 'currency',
                  currency: 'TRY',
                  maximumFractionDigits: 2
                })}
              </p>
              <p>
                Kargo:{' '}
                {detail.shippingFee.toLocaleString('tr-TR', {
                  style: 'currency',
                  currency: 'TRY',
                  maximumFractionDigits: 2
                })}
              </p>
              <p>
                Kalem Toplamı:{' '}
                {detail.summary.itemsTotal.toLocaleString('tr-TR', {
                  style: 'currency',
                  currency: 'TRY',
                  maximumFractionDigits: 2
                })}
              </p>
              <p>Not: {detail.note || '-'}</p>
            </div>
          </div>
        ) : (
          <div className="mt-8 text-sm text-gray-500">Sipariş bulunamadı.</div>
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
