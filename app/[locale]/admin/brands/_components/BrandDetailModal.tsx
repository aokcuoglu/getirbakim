'use client'

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { AdminApprovedBrandRow, AdminApprovedBrandMapping } from '@/lib/admin/approved-dnbrd-catalog'
import { Badge } from '@/components/ui/badge'
import { CheckCircle2, XCircle } from 'lucide-react'

function ProviderStatus({ label, active }: { label: string; active: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      {active ? (
        <CheckCircle2 className="size-4 text-emerald-500" />
      ) : (
        <XCircle className="size-4 text-muted-foreground/50" />
      )}
      <span className={active ? 'text-xs font-medium text-foreground' : 'text-xs text-muted-foreground/60'}>
        {label}
      </span>
    </div>
  )
}

const STATUS_MAP: Record<string, { label: string; className: string }> = {
  APPROVED: { label: 'APPROVED', className: 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-400 dark:border-emerald-800' },
  PENDING:  { label: 'PENDING',  className: 'bg-amber-50 text-amber-600 border-amber-200 dark:bg-amber-950 dark:text-amber-400 dark:border-amber-800' },
  REJECTED: { label: 'REJECTED', className: 'bg-red-50 text-red-600 border-red-200 dark:bg-red-950 dark:text-red-400 dark:border-red-800' },
  IGNORED:  { label: 'IGNORED',  className: 'bg-muted text-muted-foreground border-border' },
}

interface BrandDetailModalProps {
  brand: AdminApprovedBrandRow | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function BrandDetailModal({ brand, open, onOpenChange }: BrandDetailModalProps) {
  if (!brand) return null

  const hasDnmk = brand.mappings.some((m) => m.dnmkBrand)
  const hasPtdrk = brand.mappings.some((m) => m.ptName)
  const hasBsbg = brand.mappings.some((m) => m.bsbgBrand)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg">{brand.normalizedName}</DialogTitle>
          <DialogDescription>
            ID: {brand.id} &middot; {brand.mappings.length} eşleşme
          </DialogDescription>
        </DialogHeader>

        {/* Provider Overview */}
        <div className="rounded-md border bg-muted/30 p-3 space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Sağlayıcı Durumu
          </p>
          <div className="flex flex-wrap gap-x-6 gap-y-1.5">
            <ProviderStatus label="Dinamik" active={hasDnmk} />
            <ProviderStatus label="P-Tedarik" active={hasPtdrk} />
            <ProviderStatus label="Başbuğ" active={hasBsbg} />
          </div>
        </div>

        {/* Mappings Table */}
        <div>
          <p className="text-sm font-semibold mb-2">Eşleşmeler</p>
          {brand.mappings.length === 0 ? (
            <p className="text-sm text-muted-foreground">Eşleşme bulunamadı.</p>
          ) : (
            <div className="space-y-2">
              {brand.mappings.map((m) => {
                const status = STATUS_MAP[m.mappingStatus] ?? { label: m.mappingStatus, className: 'bg-muted text-muted-foreground border-border' }
                return (
                  <div
                    key={m.mappingId}
                    className="rounded-md border p-3 space-y-1.5 text-sm"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">
                        ID: {m.mappingId}
                      </span>
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wide ${status.className}`}>
                        {status.label}
                      </span>
                    </div>
                    <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                      {m.dnmkBrand && (
                        <>
                          <span className="text-muted-foreground">Dinamik:</span>
                          <span className="font-medium">{m.dnmkBrand}</span>
                        </>
                      )}
                      {m.ptName && (
                        <>
                          <span className="text-muted-foreground">P-Tedarik:</span>
                          <span className="font-medium">{m.ptName}</span>
                        </>
                      )}
                      {m.bsbgBrand && (
                        <>
                          <span className="text-muted-foreground">Başbuğ:</span>
                          <span className="font-medium">{m.bsbgBrand}</span>
                        </>
                      )}
                      {m.matchMethod && (
                        <>
                          <span className="text-muted-foreground">Yöntem:</span>
                          <span className="font-medium text-muted-foreground">{m.matchMethod}</span>
                        </>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* All Provider Names Summary */}
        <div>
          <p className="text-sm font-semibold mb-2">Tüm Sağlayıcı İsimleri</p>
          <div className="rounded-md border bg-muted/30 p-3 space-y-2 text-xs">
            <div>
              <p className="text-muted-foreground font-medium mb-1">Dinamik Markaları</p>
              {brand.mappings.filter((m) => m.dnmkBrand).length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {Array.from(new Set(brand.mappings.filter((m) => m.dnmkBrand).map((m) => m.dnmkBrand))).map(
                    (name) => (
                      <Badge key={name} variant="secondary" className="text-[10px]">
                        {name}
                      </Badge>
                    )
                  )}
                </div>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </div>
            <div>
              <p className="text-muted-foreground font-medium mb-1">P-Tedarik Markaları</p>
              {brand.mappings.filter((m) => m.ptName).length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {Array.from(new Set(brand.mappings.filter((m) => m.ptName).map((m) => m.ptName))).map(
                    (name) => (
                      <Badge key={name} variant="secondary" className="text-[10px]">
                        {name}
                      </Badge>
                    )
                  )}
                </div>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </div>
            <div>
              <p className="text-muted-foreground font-medium mb-1">Başbuğ Markaları</p>
              {brand.mappings.filter((m) => m.bsbgBrand).length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {Array.from(new Set(brand.mappings.filter((m) => m.bsbgBrand).map((m) => m.bsbgBrand))).map(
                    (name) => (
                      <Badge key={name} variant="secondary" className="text-[10px]">
                        {name}
                      </Badge>
                    )
                  )}
                </div>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
