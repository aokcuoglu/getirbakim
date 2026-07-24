'use client'

import { useCallback, useEffect, useState } from 'react'
import { ArrowRight, Check, Loader2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet'
import {
  PRODUCT_SUPPLIER_LABELS,
  type ProductMatchCandidate,
  type ProductMatchCandidateGroup
} from '@/lib/admin/product-match-shared'

interface ProductMatchCandidateSheetProps {
  group: ProductMatchCandidateGroup | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onResolved?: () => void
}

function SupplierBadges({ suppliers }: { suppliers: ProductMatchCandidate['existingSuppliers'] }) {
  if (suppliers.length === 0) {
    return <span className="text-[10px] text-muted-foreground">henüz offer yok</span>
  }
  return (
    <span className="flex gap-1">
      {suppliers.map((s) => (
        <Badge key={s} variant="outline" className="border-border bg-muted text-[10px] text-muted-foreground">
          {PRODUCT_SUPPLIER_LABELS[s]}
        </Badge>
      ))}
    </span>
  )
}

export function ProductMatchCandidateSheet({
  group,
  open,
  onOpenChange,
  onResolved
}: ProductMatchCandidateSheetProps) {
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    if (!open) setBusyId(null)
  }, [open])

  const act = useCallback(
    async (candidateId: string, action: 'approve' | 'reject') => {
      setBusyId(candidateId)
      try {
        const res = await fetch(`/api/admin/eslestirme/products/candidates/${action}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ candidateId })
        })
        const data = await res.json()
        if (!res.ok || data.error) {
          toast.error(data?.error?.message || 'İşlem başarısız.')
          return
        }
        toast.success(action === 'approve' ? 'Eşleştirildi, offer oluşturuldu.' : 'Aday reddedildi.')
        onOpenChange(false)
        onResolved?.()
      } catch {
        toast.error('İşlem sırasında hata oluştu.')
      } finally {
        setBusyId(null)
      }
    },
    [onOpenChange, onResolved]
  )

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Ürün Eşleştir (belirsiz)</SheetTitle>
          <SheetDescription>
            Bu tedarikçi satırının OEM'i birden çok kanonik ürüne denk geldi. Doğru ürünü seçip
            eşleştirin ya da adayları reddedin.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-3">
          <div className="rounded-md border border-border bg-muted/30 p-3">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {group ? PRODUCT_SUPPLIER_LABELS[group.supplier] : ''} Ürünü
            </p>
            {group ? (
              <div className="min-w-0">
                <p className="truncate font-medium text-foreground">
                  {group.supplierName || group.supplierSku}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  SKU: {group.supplierSku}
                  {group.brandName ? ` · marka: ${group.brandName}` : ''}
                </p>
                {group.supplierOem ? (
                  <p className="mt-1 truncate text-[11px] text-muted-foreground">OEM: {group.supplierOem}</p>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Satır seçilmedi.</p>
            )}
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Aday Kanonik Ürünler ({group?.candidates.length ?? 0})
            </p>
            <div className="space-y-2">
              {group?.candidates.map((c) => {
                const busy = busyId === c.candidateId
                return (
                  <div
                    key={c.candidateId}
                    className="rounded-md border border-border p-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">{c.productName}</p>
                        <p className="truncate text-[11px] text-muted-foreground">
                          {c.brandName ? `${c.brandName} · ` : ''}part_no: {c.productPartNo}
                        </p>
                        <div className="mt-1 flex items-center gap-2">
                          <SupplierBadges suppliers={c.existingSuppliers} />
                          {c.matchedCode ? (
                            <span className="text-[10px] text-muted-foreground">OEM: {c.matchedCode}</span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <Button
                        size="sm"
                        className="flex-1"
                        onClick={() => void act(c.candidateId, 'approve')}
                        disabled={busy}
                      >
                        {busy ? (
                          <Loader2 size={14} className="mr-2 animate-spin" />
                        ) : (
                          <Check size={14} className="mr-2" />
                        )}
                        Eşleştir
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void act(c.candidateId, 'reject')}
                        disabled={busy}
                      >
                        <X size={14} className="mr-1" />
                        Reddet
                      </Button>
                    </div>
                  </div>
                )
              })}
              {group && group.candidates.length === 0 && (
                <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                  Bu satır için bekleyen aday kalmadı.
                </p>
              )}
            </div>
          </div>

          {group && (
            <div className="flex items-center gap-2 rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
              <span className="truncate">{group.supplierName || group.supplierSku}</span>
              <ArrowRight size={12} className="shrink-0" />
              <span>seçilen kanonik ürüne offer olarak bağlanır; kardeş adaylar otomatik reddedilir.</span>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
