'use client'

import { useEffect, useState, useTransition } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet'
import {
  getAdminCustomerRequestDetail,
  updateAdminCustomerRequest
} from '@/lib/actions/customer-requests'
import type {
  CustomerRequestDetail,
  CustomerRequestStatus
} from '@/lib/types/customer-requests'

interface RequestDetailDrawerProps {
  requestId: number | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved?: (patch: { id: number; status: CustomerRequestStatus }) => void
}

export function RequestDetailDrawer({
  requestId,
  open,
  onOpenChange,
  onSaved
}: RequestDetailDrawerProps) {
  const [isPending, startTransition] = useTransition()
  const [isSaving, startSaving] = useTransition()
  const [detail, setDetail] = useState<CustomerRequestDetail | null>(null)
  const [status, setStatus] = useState<CustomerRequestStatus>('NEW')
  const [adminNote, setAdminNote] = useState('')

  useEffect(() => {
    if (!open || !requestId) return

    startTransition(async () => {
      const result = await getAdminCustomerRequestDetail(requestId)
      if (!result.success || !result.data) {
        toast.error(result.message || 'Talep detayı alınamadı.')
        setDetail(null)
        return
      }

      setDetail(result.data)
      setStatus(result.data.status)
      setAdminNote(result.data.adminNote || '')
    })
  }, [open, requestId])

  const handleSave = () => {
    if (!requestId) return

    startSaving(async () => {
      const result = await updateAdminCustomerRequest({
        id: requestId,
        status,
        adminNote
      })

      if (!result.success) {
        toast.error(result.message)
        return
      }

      setDetail((prev) =>
        prev
          ? {
              ...prev,
              status,
              adminNote
            }
          : prev
      )
      onSaved?.({ id: requestId, status })
      toast.success(result.message)
    })
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-[760px]">
        <SheetHeader>
          <SheetTitle>Talep Detayı</SheetTitle>
          <SheetDescription>
            {detail
              ? `#${detail.id} - ${detail.name} / ${detail.requestType}`
              : 'Talep detayı yükleniyor'}
          </SheetDescription>
        </SheetHeader>

        {isPending && !detail ? (
          <div className="mt-8 flex items-center justify-center text-muted-foreground">
            <Loader2 size={18} className="mr-2 animate-spin" />
            Yükleniyor...
          </div>
        ) : detail ? (
          <div className="mt-5 space-y-4">
            <div className="grid grid-cols-1 gap-2 rounded-md border border-border p-3 md:grid-cols-2">
              <Info label="Talep ID" value={`#${detail.id}`} />
              <Info label="Tip" value={detail.requestType} />
              <Info label="Kaynak" value={detail.source} />
              <Info label="Durum" value={detail.status} />
              <Info label="Müşteri" value={detail.name} />
              <Info label="E-posta" value={detail.email} />
              <Info label="Telefon" value={detail.phone || '-'} />
              <Info
                label="Oluşturulma"
                value={new Date(detail.createdAt).toLocaleString('tr-TR')}
              />
            </div>

            <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
              <div className="space-y-4">
                <section className="rounded-md border border-border p-4">
                  <h4 className="text-sm font-semibold text-foreground">
                    Kontekst
                  </h4>
                  <div className="mt-3 space-y-2 text-sm text-foreground">
                    <p>
                      <span className="font-medium text-foreground">Ürün:</span>{' '}
                      {[
                        detail.brandNameSnapshot,
                        detail.partNameSnapshot
                      ]
                        .filter(Boolean)
                        .join(' ') || '-'}
                    </p>
                    <p>
                      <span className="font-medium text-foreground">
                        Kategori:
                      </span>{' '}
                      {detail.categoryNameSnapshot || '-'}
                    </p>
                    <p>
                      <span className="font-medium text-foreground">
                        Arama / OEM:
                      </span>{' '}
                      {detail.requestedSkuOrOem || detail.searchQuery || '-'}
                    </p>
                    <p>
                      <span className="font-medium text-foreground">Sayfa:</span>{' '}
                      <span className="break-all">{detail.pageUrl || '-'}</span>
                    </p>
                    <p>
                      <span className="font-medium text-foreground">Araç:</span>{' '}
                      {detail.vehicle
                        ? JSON.stringify(detail.vehicle)
                        : '-'}
                    </p>
                  </div>
                </section>

                <section className="rounded-md border border-border p-4">
                  <h4 className="text-sm font-semibold text-foreground">Müşteri Mesajı</h4>
                  <p className="mt-3 whitespace-pre-wrap text-sm text-foreground">
                    {detail.message || '-'}
                  </p>
                </section>
              </div>

              <div className="space-y-4">
                <section className="rounded-md border border-border p-4">
                  <h4 className="text-sm font-semibold text-foreground">
                    Operasyon
                  </h4>
                  <div className="mt-3 space-y-3">
                    <div className="space-y-1">
                      <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Durum
                      </label>
                      <Select
                        value={status}
                        onValueChange={(value) =>
                          setStatus(value as CustomerRequestStatus)
                        }
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Durum seçin" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="NEW">NEW</SelectItem>
                          <SelectItem value="IN_REVIEW">IN_REVIEW</SelectItem>
                          <SelectItem value="RESOLVED">RESOLVED</SelectItem>
                          <SelectItem value="ARCHIVED">ARCHIVED</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Admin Notu
                      </label>
                      <Textarea
                        value={adminNote}
                        onChange={(event) => setAdminNote(event.target.value)}
                        rows={8}
                        placeholder="Müşteriye dönüş notu, fiyat araştırma durumu, tedarikçi bilgisi..."
                      />
                    </div>
                    <Button onClick={handleSave} disabled={isSaving}>
                      {isSaving ? 'Kaydediliyor...' : 'Kaydet'}
                    </Button>
                  </div>
                </section>
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-8 text-sm text-muted-foreground">Talep bulunamadı.</div>
        )}
      </SheetContent>
    </Sheet>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-muted px-3 py-2">
      <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold text-foreground">{value}</div>
    </div>
  )
}
