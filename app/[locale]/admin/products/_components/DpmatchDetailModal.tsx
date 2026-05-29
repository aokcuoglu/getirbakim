'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { AdminFormDialog } from '@/components/admin/admin-form-dialog'
import type { AdminDpmatchRow } from '@/lib/admin/dpprd-catalog'

interface DpmatchDetailModalProps {
  row: AdminDpmatchRow
  open: boolean
  onClose: () => void
}

function DetailField({
  label,
  value,
  editable,
  onChange,
  disabled
}: {
  label: string
  value: string
  editable?: boolean
  onChange?: (value: string) => void
  disabled?: boolean
}) {
  if (editable && onChange) {
    return (
      <div>
        <p className="mb-1 text-xs font-medium text-muted-foreground">{label}</p>
        <input
          type="text"
          value={value === '—' || value === '' ? '' : value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className={
            disabled
              ? 'w-full rounded-md border border-border bg-muted px-3 py-1.5 text-sm font-medium text-muted-foreground cursor-not-allowed'
              : 'w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground'
          }
        />
      </div>
    )
  }
  return (
    <div className="rounded-md bg-muted/70 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold text-foreground">{value}</p>
    </div>
  )
}

function DetailBadge({
  label,
  value
}: {
  label: string
  value: string
}) {
  const v = value.toUpperCase()
  const colorClass =
    v === 'APPROVED' || v === 'MATCHED'
      ? 'bg-success/10 text-success border-success/20'
      : v === 'PENDING' || v === 'DINAMIK_ONLY'
        ? 'bg-warning/10 text-warning border-warning/20'
        : v === 'REJECTED' || v === 'ERROR' || v === 'PT_ONLY'
          ? 'bg-destructive/10 text-destructive border-destructive/20'
          : 'bg-muted text-muted-foreground border-border'
  return (
    <div className="rounded-md bg-muted/70 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <Badge variant="outline" className={`mt-0.5 gap-1.5 text-[10px] ${colorClass}`}>
        {v}
      </Badge>
    </div>
  )
}

function SectionAccordion({
  title,
  subtitle,
  defaultOpen,
  children
}: {
  title: string
  subtitle?: string
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen ?? true)
  return (
    <div className="rounded-lg border border-border">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-muted/50 transition-colors"
      >
        <div>
          <p className="text-sm font-semibold text-foreground">{title}</p>
          {subtitle ? (
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          ) : null}
        </div>
        <svg
          className={`h-4 w-4 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {isOpen ? (
        <div className="border-t border-border px-4 pb-4 pt-3">
          {children}
        </div>
      ) : null}
    </div>
  )
}

interface RegionalStockEntry {
  warehouse: string
  status: string | null
  hasStock: boolean
  qty: number
}

export function DpmatchDetailModal({
  row,
  open,
  onClose
}: DpmatchDetailModalProps) {
  const [draft, setDraft] = useState({
    sellingPrice: (row.dinamik.price ?? '').toString(),
    isVisible: !row.dinamik.isPassive
  })
  const [stockLoading, setStockLoading] = useState(false)
  const [regionalStock, setRegionalStock] = useState<RegionalStockEntry[] | null>(null)
  const [stockError, setStockError] = useState<string | null>(null)
  const [imageUrl, setImageUrl] = useState(row.parcatedarik.imageUrl || '')

  const isMatched = row.matchSide === 'matched'
  const isDinamikOnly = row.matchSide === 'dinamik_only'
  const isPtOnly = row.matchSide === 'pt_only'

  const handleCheckStock = async () => {
    const sku = row.dinamik.stockCode
    if (!sku) return

    setStockLoading(true)
    setStockError(null)
    try {
      const res = await fetch('/api/admin/products/dinamik-stock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stockCode: sku })
      })
      const data = await res.json()
      if (!res.ok) {
        setStockError(data.message || 'Stok sorgusu basarisiz.')
        setRegionalStock(null)
      } else if (!data.found) {
        setStockError('Dinamik tarafinda stok kaydi bulunamadi.')
        setRegionalStock(null)
      } else {
        setRegionalStock(data.regionalStock || [])
        setStockError(null)
      }
    } catch {
      setStockError('Baglanti hatasi.')
      setRegionalStock(null)
    } finally {
      setStockLoading(false)
    }
  }

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setImageUrl(reader.result)
      }
    }
    reader.readAsDataURL(file)
  }

  return (
    <AdminFormDialog
      open={open}
      onOpenChange={(o) => { if (!o) onClose() }}
      title="Urun Detaylari"
      description={`#${row.id} · ${isMatched ? 'Eslesmis' : isDinamikOnly ? 'Sadece Dinamik' : 'Sadece PT'}`}
      showSave={false}
      showClose
      closeLabel="Kapat"
      size="4xl"
    >
      <div className="space-y-4">
        {/* Genel Bilgiler */}
        <div>
          <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Genel Bilgiler
          </h4>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <DetailField label="Part No (normalized)" value={row.normalized_name || '—'} editable onChange={() => {}} />
            <DetailField label="Part Name" value={row.dinamik.stockName || row.parcatedarik.title || '—'} editable onChange={() => {}} />
            <DetailField label="Marka" value={row.dinamik.brand || row.parcatedarik.manufacturerName || '—'} disabled />
            <DetailBadge label="Eslesme Durumu" value={row.mappingStatus} />
            <DetailBadge label="Eslesme Tarafi" value={row.matchSide} />
            <DetailBadge label="Eslesme Yontemi" value={row.matchMethod || '—'} />
            <DetailBadge label="Durum" value={row.dinamik.isPassive ? 'PASSIVE' : 'ACTIVE'} />
          </div>
        </div>

        {/* Dinamik Bilgileri */}
        {!isPtOnly && (
          <SectionAccordion
            title="Dinamik Bilgileri"
            subtitle={row.dinamik.stockCode ? `#${row.dinamik.stockCode}` : undefined}
            defaultOpen
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <DetailField label="SKU" value={row.dinamik.stockCode || '—'} editable onChange={() => {}} />
              <DetailField label="Urun Adi" value={row.dinamik.stockName || '—'} editable onChange={() => {}} />
              <DetailField label="Marka" value={row.dinamik.brand || '—'} disabled />
              <DetailField label="Barkod 1" value={row.dinamik.barcode1 || '—'} editable onChange={() => {}} />
              <DetailField label="Barkod 2" value={row.dinamik.barcode2 || '—'} editable onChange={() => {}} />
              <DetailField label="Barkod 3" value={row.dinamik.barcode3 || '—'} editable onChange={() => {}} />
              <DetailField label="Fiyat" value={row.dinamik.price ? `${row.dinamik.price} TRY` : '—'} editable onChange={() => {}} />
              <DetailField label="Stok" value={row.dinamik.stockQty != null ? String(row.dinamik.stockQty) : '—'} />
              <div className="col-span-1 sm:col-span-2 lg:col-span-3">
                <button
                  type="button"
                  onClick={handleCheckStock}
                  disabled={stockLoading || !row.dinamik.stockCode}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {stockLoading ? <Loader2 size={12} className="animate-spin" /> : null}
                  Anlik Stok Sorgula
                </button>
                {stockError ? (
                  <p className="mt-1.5 text-xs text-destructive">{stockError}</p>
                ) : null}
                {regionalStock && regionalStock.length > 0 ? (
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {regionalStock.map((entry) => (
                      <div key={entry.warehouse} className="rounded-md border border-border px-2.5 py-1.5 text-center">
                        <p className="text-[10px] font-semibold uppercase text-muted-foreground">{entry.warehouse}</p>
                        <p className={`text-sm font-bold ${entry.hasStock ? 'text-success' : 'text-destructive'}`}>
                          {entry.hasStock ? `VAR (${entry.qty})` : 'YOK'}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </SectionAccordion>
        )}

        {/* ParcaTedarik Bilgileri */}
        {!isDinamikOnly && (
          <SectionAccordion
            title="ParcaTedarik Bilgileri"
            subtitle={row.productId != null ? `#${row.productId}` : undefined}
            defaultOpen
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <DetailField label="Baslik" value={row.parcatedarik.title || '—'} editable onChange={() => {}} />
              <DetailField label="Model" value={row.parcatedarik.model || '—'} editable onChange={() => {}} />
              <DetailField label="Marka" value={row.parcatedarik.manufacturerName || '—'} disabled />
              <DetailField label="Ref No" value={row.parcatedarik.refNo || '—'} editable onChange={() => {}} />
              <DetailField label="Liste Fiyati" value={row.parcatedarik.price ? `${row.parcatedarik.price} TRY` : '—'} />
              <DetailField label="Gercek Fiyat" value={row.parcatedarik.priceActual ? `${row.parcatedarik.priceActual} TRY` : '—'} />
              <div className="col-span-1 sm:col-span-2 lg:col-span-3">
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">Gorsel</p>
                <div className="flex items-start gap-3">
                  {(imageUrl || row.parcatedarik.imageUrl) ? (
                    <div className="inline-block overflow-hidden rounded-md border border-border bg-muted">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={imageUrl || row.parcatedarik.imageUrl || ''}
                        alt={row.parcatedarik.title}
                        className="h-24 w-auto max-w-full object-contain"
                      />
                    </div>
                  ) : null}
                  <label className="flex cursor-pointer items-center gap-1.5 rounded-md border border-dashed border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted transition-colors">
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                    Gorsel Yukle
                    <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
                  </label>
                </div>
              </div>
            </div>
          </SectionAccordion>
        )}

        {/* Fiyat & Gorunurluk */}
        <div className="border-t border-border pt-4">
          <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Fiyat & Gorunurluk
          </h4>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">Satis Fiyati Override</p>
              <input
                type="text"
                value={draft.sellingPrice}
                onChange={(e) => setDraft((prev) => ({ ...prev, sellingPrice: e.target.value }))}
                className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground"
                inputMode="decimal"
              />
            </div>
            <DetailField label="Dinamik Fiyat" value={row.dinamik.price ? `${row.dinamik.price} TRY` : '—'} />
            {!isDinamikOnly && (
              <DetailField label="PT Gercek Fiyat" value={row.parcatedarik.priceActual ? `${row.parcatedarik.priceActual} TRY` : '—'} />
            )}
            <DetailField label="Stok" value={row.dinamik.stockQty != null ? String(row.dinamik.stockQty) : '—'} />
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">Gorunurluk</p>
              <label className="flex items-center gap-2">
                <Switch
                  checked={draft.isVisible}
                  onCheckedChange={(checked) => setDraft((prev) => ({ ...prev, isVisible: checked }))}
                  className="data-[state=checked]:bg-success/100"
                />
                <span className="text-sm text-foreground">
                  {draft.isVisible ? 'Gorunur' : 'Gizli'}
                </span>
              </label>
            </div>
          </div>
        </div>
      </div>
    </AdminFormDialog>
  )
}
