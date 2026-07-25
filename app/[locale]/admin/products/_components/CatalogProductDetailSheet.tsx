'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'
import {
  Loader2,
  ExternalLink,
  ImageIcon,
  Plus,
  Star,
  Trash2,
  Upload,
  X
} from 'lucide-react'
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
  removeCatalogProductImage,
  removeCatalogProductOem,
  removeCatalogProductProperty,
  setCatalogProductPrimaryImage,
  updateCatalogProductOverride,
  upsertCatalogProductProperty
} from '@/lib/actions/admin-catalog'
import type {
  AdminCatalogImage,
  AdminCatalogProductDetail,
  AdminCatalogProperty,
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
            onRemove={async (item) => {
              const res = await removeCatalogProductOem({
                id: detail.id,
                code: item.code,
                brand: item.extra ?? ''
              })
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
            onRemove={async (item) => {
              const res = await removeCatalogProductEan({ id: detail.id, code: item.code })
              if (!res.success) {
                toast.error(res.message)
                return
              }
              setDetail({ ...detail, eans: res.eans })
              toast.success(res.message)
              onSaved()
            }}
          />

          {/* Görseller — manuel yükleme + devralınan TecDoc görselleri */}
          <ImageEditor
            productId={detail.id}
            images={detail.images}
            onChange={(images) => {
              setDetail({ ...detail, images, imageCount: images.length })
              onSaved()
            }}
          />

          {/* Teknik özellikler — genişlik, yükseklik, çap… */}
          <PropertyEditor
            productId={detail.id}
            properties={detail.properties}
            onChange={(properties) => {
              setDetail({ ...detail, properties, propertyCount: properties.length })
              onSaved()
            }}
          />

          {/* Araç uyumluluğu yalnız TecDoc'tan devralınır, elle girilmez. */}
          <div className="grid grid-cols-1 gap-2 text-center text-xs">
            <CountPill label="Uyumlu Araç" value={detail.vehicleCount} />
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

/**
 * Görsel havuzu: manuel yüklenen catalog.product_images satırları + onaylı
 * part link'lerinden devralınan TecDoc görselleri. Devralınanlar id'siz gelir;
 * silinemez ama birincil seçilebilir.
 *
 * Yükleme API route'undan geçer (multipart dosya + harici URL indirme storage
 * gerektiriyor); silme/birincil seçme server action ile anında kaydeder.
 */
function ImageEditor({
  productId,
  images,
  onChange
}: {
  productId: string
  images: AdminCatalogImage[]
  onChange: (images: AdminCatalogImage[]) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const send = async (body: FormData) => {
    setBusy('upload')
    try {
      const res = await fetch(`/api/admin/catalog/products/${productId}/images`, {
        method: 'POST',
        body
      })
      const data = await res.json()
      if (!res.ok || data.error) {
        toast.error(data?.error?.message || 'Görsel yüklenemedi.')
        return false
      }
      onChange(data.images)
      toast.success(data.message)
      return true
    } catch {
      toast.error('Görsel yüklenirken hata oluştu.')
      return false
    } finally {
      setBusy(null)
    }
  }

  const handleUrl = async () => {
    const trimmed = url.trim()
    if (!trimmed || busy) return
    const body = new FormData()
    body.set('url', trimmed)
    if (await send(body)) setUrl('')
  }

  const handleRemove = async (image: AdminCatalogImage) => {
    if (!image.id) return
    setBusy(image.url)
    const res = await removeCatalogProductImage({ id: productId, imageId: image.id })
    setBusy(null)
    if (!res.success) {
      toast.error(res.message)
      return
    }
    onChange(res.images)
    toast.success(res.message)
  }

  const handlePrimary = async (image: AdminCatalogImage) => {
    if (image.isPrimary) return
    setBusy(image.url)
    const res = await setCatalogProductPrimaryImage({ id: productId, url: image.url })
    setBusy(null)
    if (!res.success) {
      toast.error(res.message)
      return
    }
    onChange(res.images)
    toast.success(res.message)
  }

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">
        Görseller{' '}
        <span className="text-xs font-normal text-muted-foreground">({images.length})</span>
      </h3>

      {images.length > 0 && (
        <div className="grid grid-cols-4 gap-2">
          {images.map((img) => (
            <div
              key={img.url}
              className={`group relative aspect-square overflow-hidden rounded-md border bg-muted ${
                img.isPrimary ? 'border-primary ring-1 ring-primary' : 'border-border'
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={img.thumb || img.url}
                alt=""
                loading="lazy"
                className="h-full w-full object-contain"
              />
              {busy === img.url && (
                <div className="absolute inset-0 flex items-center justify-center bg-background/70">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
              )}
              <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-background/85 px-1 py-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                <button
                  type="button"
                  aria-label="Birincil görsel yap"
                  title={img.isPrimary ? 'Birincil görsel' : 'Birincil görsel yap'}
                  onClick={() => void handlePrimary(img)}
                  disabled={busy != null}
                  className="rounded p-0.5 text-muted-foreground hover:text-primary disabled:opacity-50"
                >
                  <Star
                    className={`h-3.5 w-3.5 ${img.isPrimary ? 'fill-primary text-primary' : ''}`}
                  />
                </button>
                <span className="text-[9px] uppercase text-muted-foreground">{img.source}</span>
                {img.id ? (
                  <button
                    type="button"
                    aria-label="Görseli kaldır"
                    onClick={() => void handleRemove(img)}
                    disabled={busy != null}
                    className="rounded p-0.5 text-muted-foreground hover:text-destructive disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                ) : (
                  <span className="w-4" />
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {images.length === 0 && (
        <div className="flex items-center gap-2 rounded-md border border-dashed border-border px-3 py-4 text-xs text-muted-foreground">
          <ImageIcon className="h-4 w-4" />
          Görsel yok.
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
        className="hidden"
        onChange={async (event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (!file) return
          const body = new FormData()
          body.set('file', file)
          await send(body)
        }}
      />

      <div className="flex items-center gap-2">
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void handleUrl()
            }
          }}
          type="url"
          inputMode="url"
          placeholder="https://… görsel adresi"
          className="h-8 text-xs"
        />
        <button
          type="button"
          onClick={() => void handleUrl()}
          disabled={busy != null || url.trim().length === 0}
          className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-border bg-card px-3 text-xs font-medium hover:bg-muted disabled:opacity-50"
        >
          {busy === 'upload' ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Plus className="h-3.5 w-3.5" />
          )}
          Ekle
        </button>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy != null}
          className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-border bg-card px-3 text-xs font-medium hover:bg-muted disabled:opacity-50"
        >
          <Upload className="h-3.5 w-3.5" />
          Dosya
        </button>
      </div>

      <p className="text-[10px] text-muted-foreground">
        Dosya ya da adres verin; her ikisi de sunucuya kopyalanır (en fazla 2 MB).
        Yıldız birincil görseli seçer — vitrin kartlarında o görünür. “PARTS”
        kaynaklı görseller TecDoc’tan devralınır, silinemez.
      </p>
    </div>
  )
}

/**
 * Teknik özellik havuzu (genişlik, yükseklik, çap…). Manuel satırlar
 * catalog.product_properties'e yazılır ve aynı anahtarlı TecDoc değerini ezer;
 * manuel satır silinince devralınan değer yeniden görünür.
 */
function PropertyEditor({
  productId,
  properties,
  onChange
}: {
  productId: string
  properties: AdminCatalogProperty[]
  onChange: (properties: AdminCatalogProperty[]) => void
}) {
  const [key, setKey] = useState('')
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)

  const handleSave = async () => {
    if (!key.trim() || !value.trim() || saving) return
    setSaving(true)
    const res = await upsertCatalogProductProperty({ id: productId, key, value })
    setSaving(false)
    if (!res.success) {
      toast.error(res.message)
      return
    }
    onChange(res.properties)
    toast.success(res.message)
    setKey('')
    setValue('')
  }

  const handleRemove = async (prop: AdminCatalogProperty) => {
    setRemoving(prop.key)
    const res = await removeCatalogProductProperty({ id: productId, key: prop.key })
    setRemoving(null)
    if (!res.success) {
      toast.error(res.message)
      return
    }
    onChange(res.properties)
    toast.success(res.message)
  }

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">
        Teknik Özellikler{' '}
        <span className="text-xs font-normal text-muted-foreground">({properties.length})</span>
      </h3>

      {properties.length > 0 && (
        <ul className="max-h-52 space-y-1 overflow-y-auto rounded-md border border-border p-2">
          {properties.map((p) => (
            <li key={p.key} className="flex items-center gap-2 text-xs">
              <button
                type="button"
                title="Değeri düzenlemek için doldur"
                onClick={() => {
                  setKey(p.key)
                  setValue(p.value)
                }}
                className="min-w-0 flex-1 truncate text-left hover:underline"
              >
                <span className="text-muted-foreground">{p.key}</span>
                <span className="mx-1 text-muted-foreground">·</span>
                <span className="font-medium text-foreground">{p.value}</span>
              </button>
              <span className="flex shrink-0 items-center gap-1.5">
                <SourceBadge source={p.source} />
                {p.id ? (
                  <button
                    type="button"
                    aria-label="Kaldır"
                    onClick={() => void handleRemove(p)}
                    disabled={removing === p.key}
                    className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-destructive disabled:opacity-50"
                  >
                    {removing === p.key ? (
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
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="Genişlik (mm)"
          className="h-8 text-xs"
        />
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void handleSave()
            }
          }}
          placeholder="120"
          className="h-8 text-xs"
        />
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving || !key.trim() || !value.trim()}
          className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-border bg-card px-3 text-xs font-medium hover:bg-muted disabled:opacity-50"
        >
          {saving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Plus className="h-3.5 w-3.5" />
          )}
          Ekle
        </button>
      </div>

      <p className="text-[10px] text-muted-foreground">
        Var olan bir özelliğe tıklayınca alanlar dolar; aynı adla kaydetmek
        değerini günceller. “PARTS” satırları TecDoc’tan devralınır — aynı adı
        manuel girerek ezebilirsiniz.
      </p>
    </div>
  )
}

interface CodeItem {
  code: string
  source: string
  extra?: string | null
}

/**
 * Satır kimliği. `extra` (OEM'de araç markası) dahil: aynı kod, aynı kaynak
 * altında birden çok marka varyantı olarak listelenebilir — key'e girmezse
 * React'te çakışır, silme sırasında da yanlış satır hedeflenir.
 */
const codeKey = (c: CodeItem) => `${c.source}:${c.code}:${c.extra ?? ''}`

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
  onRemove: (item: CodeItem) => Promise<void>
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

  const handleRemove = async (item: CodeItem) => {
    setRemoving(codeKey(item))
    await onRemove(item)
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
              key={codeKey(c)}
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
                    onClick={() => void handleRemove(c)}
                    disabled={removing === codeKey(c)}
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
