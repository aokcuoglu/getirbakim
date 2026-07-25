'use client'

import { useEffect, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Loader2, ExternalLink, Plus, X } from 'lucide-react'
import { AdminFormSheet } from '@/components/admin/admin-form-sheet'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { formatCurrency } from '@/lib/utils'
import {
  addCatalogProductEan,
  addCatalogProductOem,
  getAdminCatalogProductDetail,
  removeCatalogProductEan,
  removeCatalogProductOem,
  updateCatalogProductOverride
} from '@/lib/actions/admin-catalog'
import type {
  AdminCatalogProductDetail,
  CatalogProductStatus
} from '@/lib/types/admin-catalog'

const STATUS_OPTIONS: { value: CatalogProductStatus; label: string }[] = [
  { value: 'ACTIVE', label: 'Aktif' },
  { value: 'DRAFT', label: 'Taslak' },
  { value: 'HIDDEN', label: 'Gizli' },
  { value: 'ARCHIVED', label: 'Arşiv' }
]

interface Props {
  productId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}

export function CatalogProductDetailSheet({
  productId,
  open,
  onOpenChange,
  onSaved
}: Props) {
  const [detail, setDetail] = useState<AdminCatalogProductDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [isSaving, startSave] = useTransition()

  // form state
  const [status, setStatus] = useState<CatalogProductStatus>('ACTIVE')
  const [nameOverride, setNameOverride] = useState('')
  const [priceOverride, setPriceOverride] = useState('')
  const [lockPrice, setLockPrice] = useState(false)
  const [note, setNote] = useState('')

  useEffect(() => {
    if (!open || !productId) return
    let cancelled = false
    setLoading(true)
    setDetail(null)
    getAdminCatalogProductDetail(productId)
      .then((d) => {
        if (cancelled) return
        setDetail(d)
        if (d) {
          setStatus(d.status)
          setNameOverride(d.override?.nameOverride ?? '')
          setPriceOverride(
            d.override?.sellingPriceOverride != null
              ? String(d.override.sellingPriceOverride)
              : ''
          )
          setLockPrice(d.override?.lockPrice ?? false)
          setNote(d.override?.note ?? '')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, productId])

  const handleSave = () => {
    if (!productId) return
    const parsedPrice = priceOverride.trim() === '' ? null : Number(priceOverride)
    if (parsedPrice != null && (Number.isNaN(parsedPrice) || parsedPrice < 0)) {
      toast.error('Geçerli bir override fiyatı girin.')
      return
    }
    if (lockPrice && parsedPrice == null) {
      toast.error('Fiyatı kilitlemek için bir override fiyatı girin.')
      return
    }

    startSave(async () => {
      const result = await updateCatalogProductOverride({
        id: productId,
        status,
        sellingPriceOverride: parsedPrice,
        lockPrice,
        nameOverride: nameOverride.trim() || null,
        note: note.trim() || null
      })
      if (!result.success) {
        toast.error(result.message)
        return
      }
      toast.success(result.message)
      onSaved()
      onOpenChange(false)
    })
  }

  return (
    <AdminFormSheet
      open={open}
      onOpenChange={onOpenChange}
      title={detail ? detail.name : 'Ürün Detayı'}
      description={
        detail ? `${detail.brandName} · ${detail.partNo}` : undefined
      }
      onSave={handleSave}
      isSaving={isSaving}
      saveDisabled={loading || !detail}
      width="md"
    >
      {loading || !detail ? (
        <div className="flex h-40 items-center justify-center text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Yükleniyor…
        </div>
      ) : (
        <div className="space-y-5">
          {/* Summary */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <Metric
              label="Satış (KDV hariç)"
              value={
                detail.sellingPriceExVat != null
                  ? formatCurrency(detail.sellingPriceExVat, 'TRY')
                  : '—'
              }
            />
            <Metric label="Toplam Stok" value={String(detail.totalStockQty)} />
            <Metric label="Teklif Sayısı" value={String(detail.offerCount)} />
            <Metric label="Kategori" value={detail.categoryName ?? '—'} />
          </div>

          {detail.href && (
            <a
              href={detail.href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
            >
              <ExternalLink size={13} />
              Mağazada görüntüle
            </a>
          )}

          <Separator />

          {/* Offers */}
          <div>
            <h3 className="mb-2 text-sm font-semibold">Tedarikçi Teklifleri</h3>
            {detail.offers.length === 0 ? (
              <p className="text-xs text-muted-foreground">Teklif yok.</p>
            ) : (
              <div className="space-y-2">
                {detail.offers.map((o) => (
                  <div
                    key={o.id}
                    className="rounded-md border border-border bg-card p-2.5 text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{o.supplierName}</span>
                      <span
                        className={
                          o.isActive
                            ? 'text-emerald-600'
                            : 'text-muted-foreground'
                        }
                      >
                        {o.isActive ? 'Aktif' : 'Pasif'}
                      </span>
                    </div>
                    <div className="mt-1 grid grid-cols-3 gap-1 text-muted-foreground">
                      <span>SKU: <span className="text-foreground">{o.supplierSku}</span></span>
                      <span>
                        Satış:{' '}
                        <span className="text-foreground">
                          {o.sellingPriceTry != null
                            ? formatCurrency(o.sellingPriceTry, 'TRY')
                            : '—'}
                        </span>
                      </span>
                      <span>Stok: <span className="text-foreground">{o.stockQty}</span></span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* OEM / cross-reference pool — feeds public.parts matching */}
          <CodeEditor
            title="OEM / Çapraz Referans"
            codes={detail.oems.map((o) => ({
              code: o.code,
              source: o.source,
              extra: o.brand
            }))}
            placeholder="DAF 1812163, MERCEDES-BENZ 0019934196"
            hint="Virgülle ayırın; her numara «MARKA KOD» biçiminde (part_oens formatı). Marka opsiyonel."
            onAdd={async (code) => {
              const res = await addCatalogProductOem({ id: detail.id, code })
              if (!res.success) {
                toast.error(res.message)
                return false
              }
              setDetail({ ...detail, oems: res.oems })
              toast.success(res.message)
              onSaved()
              return true
            }}
            onRemove={async (code) => {
              const res = await removeCatalogProductOem({ id: detail.id, code })
              if (!res.success) {
                toast.error(res.message)
                return
              }
              setDetail({ ...detail, oems: res.oems })
              toast.success(res.message)
              onSaved()
            }}
          />

          {/* EAN / barcode pool */}
          <CodeEditor
            title="EAN / Barkod"
            codes={detail.eans.map((e) => ({ code: e.code, source: e.source }))}
            placeholder="8690000000000, 8690000000001"
            hint="Virgülle birden çok barkod ekleyebilirsiniz."
            onAdd={async (code) => {
              const res = await addCatalogProductEan({ id: detail.id, code })
              if (!res.success) {
                toast.error(res.message)
                return false
              }
              setDetail({ ...detail, eans: res.eans })
              toast.success(res.message)
              onSaved()
              return true
            }}
            onRemove={async (code) => {
              const res = await removeCatalogProductEan({ id: detail.id, code })
              if (!res.success) {
                toast.error(res.message)
                return
              }
              setDetail({ ...detail, eans: res.eans })
              toast.success(res.message)
              onSaved()
            }}
          />

          {/* Read-only enrichment counts */}
          <div className="grid grid-cols-2 gap-2 text-center text-xs">
            <CountPill label="Görsel" value={detail.imageCount} />
            <CountPill label="Araç" value={detail.vehicleCount} />
          </div>

          <Separator />

          {/* Override editor */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold">Yönetici Düzenlemeleri</h3>

            <div className="space-y-1.5">
              <Label htmlFor="cat-status">Durum</Label>
              <Select
                value={status}
                onValueChange={(v) => setStatus(v as CatalogProductStatus)}
              >
                <SelectTrigger id="cat-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                Yalnızca “Aktif” ürünler mağazada görünür.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cat-name">İsim override</Label>
              <Input
                id="cat-name"
                value={nameOverride}
                onChange={(e) => setNameOverride(e.target.value)}
                placeholder={detail.name}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cat-price">Fiyat override (KDV hariç, ₺)</Label>
              <Input
                id="cat-price"
                type="number"
                step="0.01"
                min="0"
                value={priceOverride}
                onChange={(e) => setPriceOverride(e.target.value)}
                placeholder="Otomatik (tekliflerden)"
              />
            </div>

            <div className="flex items-center justify-between rounded-md border border-border p-3">
              <div>
                <Label htmlFor="cat-lock" className="cursor-pointer">
                  Fiyatı kilitle
                </Label>
                <p className="text-[11px] text-muted-foreground">
                  Açıkken override fiyatı sync’lerde ezilmez.
                </p>
              </div>
              <Switch id="cat-lock" checked={lockPrice} onCheckedChange={setLockPrice} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cat-note">Not</Label>
              <Textarea
                id="cat-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
              />
            </div>

            {detail.override?.updatedBy && (
              <p className="text-[11px] text-muted-foreground">
                Son düzenleyen: {detail.override.updatedBy}
              </p>
            )}
          </div>
        </div>
      )}
    </AdminFormSheet>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="truncate text-sm font-semibold">{value}</p>
    </div>
  )
}

function CountPill({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border bg-card py-1.5">
      <p className="text-sm font-semibold tabular-nums">{value}</p>
      <p className="text-[10px] text-muted-foreground">{label}</p>
    </div>
  )
}

function SourceBadge({ source }: { source: string }) {
  const isManual = source === 'MANUAL'
  return (
    <Badge
      variant="outline"
      className={
        isManual
          ? 'border-primary/40 bg-primary/10 text-[10px] font-medium text-primary'
          : 'border-border bg-muted text-[10px] text-muted-foreground'
      }
    >
      {source}
    </Badge>
  )
}

interface CodeItem {
  code: string
  source: string
  extra?: string | null
}

/**
 * Kanonik ürünün kimlik havuzunu (OEM/çapraz veya EAN) listeler + manuel
 * ekleme/silme yapar. Sync kaynaklı (DNMK/BSBG/PARTS) satırlar salt-okunur;
 * yalnız MANUAL kayıtlarda kaldır (X) görünür. Mutasyonlar anında kaydeder.
 */
function CodeEditor({
  title,
  codes,
  placeholder,
  hint,
  onAdd,
  onRemove
}: {
  title: string
  codes: CodeItem[]
  placeholder: string
  hint?: string
  onAdd: (code: string) => Promise<boolean>
  onRemove: (code: string) => Promise<void>
}) {
  const [value, setValue] = useState('')
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)

  const handleAdd = async () => {
    const code = value.trim()
    if (!code || adding) return
    setAdding(true)
    const ok = await onAdd(code)
    setAdding(false)
    if (ok) setValue('')
  }

  const handleRemove = async (code: string) => {
    setRemoving(code)
    await onRemove(code)
    setRemoving(null)
  }

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">
        {title}{' '}
        <span className="text-xs font-normal text-muted-foreground">({codes.length})</span>
      </h3>

      {codes.length > 0 && (
        <ul className="max-h-44 space-y-1 overflow-y-auto rounded-md border border-border p-2">
          {codes.map((c) => (
            <li
              key={`${c.source}:${c.code}`}
              className="flex items-center gap-2 text-xs"
            >
              <span className="font-mono text-foreground">{c.code}</span>
              {c.extra ? (
                <span className="text-[10px] text-muted-foreground">{c.extra}</span>
              ) : null}
              <span className="ml-auto flex items-center gap-1.5">
                <SourceBadge source={c.source} />
                {c.source === 'MANUAL' ? (
                  <button
                    type="button"
                    aria-label="Kaldır"
                    onClick={() => void handleRemove(c.code)}
                    disabled={removing === c.code}
                    className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-destructive disabled:opacity-50"
                  >
                    {removing === c.code ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <X className="h-3.5 w-3.5" />
                    )}
                  </button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-2">
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void handleAdd()
            }
          }}
          placeholder={placeholder}
          className="h-8 text-xs"
        />
        <button
          type="button"
          onClick={() => void handleAdd()}
          disabled={adding || value.trim().length === 0}
          className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-border bg-card px-3 text-xs font-medium hover:bg-muted disabled:opacity-50"
        >
          {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          Ekle
        </button>
      </div>

      {hint ? <p className="text-[10px] text-muted-foreground">{hint}</p> : null}
    </div>
  )
}
