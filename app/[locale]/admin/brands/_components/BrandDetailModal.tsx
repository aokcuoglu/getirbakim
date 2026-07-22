'use client'

import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import type { AdminApprovedBrandRow, AdminApprovedBrandMapping } from '@/lib/admin/approved-dnbrd-catalog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { CheckCircle2, XCircle, Loader2, Check, Ban, Unlink, Trash2, AlertTriangle } from 'lucide-react'
import { BrandLogoUploadCell } from './BrandLogoUploadCell'

export type MappingAction = 'approve' | 'reject' | 'ignore' | 'unlink'

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
  uploadingId: number | null
  onRename: (row: AdminApprovedBrandRow, name: string) => Promise<boolean>
  onUpload: (row: AdminApprovedBrandRow, file: File) => Promise<boolean>
  onUploadFromUrl: (row: AdminApprovedBrandRow, url: string) => Promise<boolean>
  onMappingAction: (row: AdminApprovedBrandRow, mapping: AdminApprovedBrandMapping, action: MappingAction) => Promise<boolean>
  onDelete: (row: AdminApprovedBrandRow) => Promise<boolean>
}

export function BrandDetailModal({
  brand,
  open,
  onOpenChange,
  uploadingId,
  onRename,
  onUpload,
  onUploadFromUrl,
  onMappingAction,
  onDelete
}: BrandDetailModalProps) {
  const [nameInput, setNameInput] = useState('')
  const [savingName, setSavingName] = useState(false)
  const [pendingMappingId, setPendingMappingId] = useState<number | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (brand) {
      setNameInput(brand.normalizedName)
      setConfirmDelete(false)
    }
  }, [brand])

  if (!brand) return null

  const hasDnmk = brand.mappings.some((m) => m.dnmkBrand)
  const hasPtdrk = brand.mappings.some((m) => m.ptName)
  const hasBsbg = brand.mappings.some((m) => m.bsbgBrand)

  const nameChanged = nameInput.trim() !== brand.normalizedName && nameInput.trim().length > 0
  const canDelete = brand.mappings.length === 0

  const handleSaveName = async () => {
    if (!nameChanged) return
    setSavingName(true)
    try {
      await onRename(brand, nameInput.trim())
    } finally {
      setSavingName(false)
    }
  }

  const handleMapping = async (mapping: AdminApprovedBrandMapping, action: MappingAction) => {
    setPendingMappingId(mapping.mappingId)
    try {
      await onMappingAction(brand, mapping, action)
    } finally {
      setPendingMappingId(null)
    }
  }

  const handleDelete = async () => {
    setDeleting(true)
    try {
      const ok = await onDelete(brand)
      if (ok) onOpenChange(false)
    } finally {
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg">{brand.normalizedName}</DialogTitle>
          <DialogDescription>
            ID: {brand.id} &middot; {brand.mappings.length} eşleşme
          </DialogDescription>
        </DialogHeader>

        {/* Edit: name + logo */}
        <div className="space-y-3 rounded-md border p-3">
          <div className="space-y-1.5">
            <Label htmlFor="brand-name-edit" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Marka Adı
            </Label>
            <div className="flex gap-2">
              <Input
                id="brand-name-edit"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                disabled={savingName}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && nameChanged) {
                    e.preventDefault()
                    void handleSaveName()
                  }
                }}
                className="h-9"
              />
              <Button
                size="sm"
                onClick={() => void handleSaveName()}
                disabled={!nameChanged || savingName}
              >
                {savingName ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Kaydet'}
              </Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Logo
            </Label>
            <BrandLogoUploadCell
              row={brand}
              isUploading={uploadingId === brand.id}
              onUpload={onUpload}
              onUploadFromUrl={onUploadFromUrl}
            />
          </div>
        </div>

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

        {/* Mappings — editable */}
        <div>
          <p className="text-sm font-semibold mb-2">Eşleşmeler</p>
          {brand.mappings.length === 0 ? (
            <p className="text-sm text-muted-foreground">Eşleşme bulunamadı.</p>
          ) : (
            <div className="space-y-2">
              {brand.mappings.map((m) => {
                const status = STATUS_MAP[m.mappingStatus] ?? { label: m.mappingStatus, className: 'bg-muted text-muted-foreground border-border' }
                const busy = pendingMappingId === m.mappingId
                return (
                  <div
                    key={m.mappingId}
                    className="rounded-md border p-3 space-y-2 text-sm"
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
                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                      {m.mappingStatus !== 'APPROVED' && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 gap-1 text-emerald-600 hover:text-emerald-700"
                          disabled={busy}
                          onClick={() => void handleMapping(m, 'approve')}
                        >
                          <Check className="h-3.5 w-3.5" /> Onayla
                        </Button>
                      )}
                      {m.mappingStatus !== 'REJECTED' && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 gap-1 text-amber-600 hover:text-amber-700"
                          disabled={busy}
                          onClick={() => void handleMapping(m, 'reject')}
                        >
                          <Ban className="h-3.5 w-3.5" /> Reddet
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 gap-1 text-red-600 hover:text-red-700"
                        disabled={busy}
                        onClick={() => void handleMapping(m, 'unlink')}
                      >
                        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Unlink className="h-3.5 w-3.5" />} Kaldır
                      </Button>
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

        <Separator />

        {/* Danger zone: delete */}
        <div className="rounded-md border border-red-200 bg-red-50/50 p-3 dark:border-red-900 dark:bg-red-950/30">
          <p className="text-xs font-semibold uppercase tracking-wider text-red-600 dark:text-red-400 mb-2">
            Tehlikeli Bölge
          </p>
          {!canDelete ? (
            <div className="flex items-start gap-2 text-xs text-muted-foreground">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
              <span>
                Bu markada {brand.mappings.length} eşleşme var. Silmeden önce eşleşmeleri
                kaldırın veya markayı başka bir markayla birleştirin.
              </span>
            </div>
          ) : !confirmDelete ? (
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">
                Bu markayı kalıcı olarak sil.
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1 border-red-200 text-red-600 hover:bg-red-100 hover:text-red-700 dark:border-red-900 dark:hover:bg-red-950"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 className="h-3.5 w-3.5" /> Sil
              </Button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-red-600 dark:text-red-400">
                Emin misiniz? Bu işlem geri alınamaz.
              </span>
              <div className="flex gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8"
                  onClick={() => setConfirmDelete(false)}
                  disabled={deleting}
                >
                  İptal
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  className="h-8 gap-1"
                  onClick={() => void handleDelete()}
                  disabled={deleting}
                >
                  {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  Evet, sil
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
