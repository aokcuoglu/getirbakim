'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, Check, ExternalLink, Link2Off, Loader2, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  PRODUCT_LIST_SUPPLIER_LABELS,
  type ManualCandidatesResult,
  type ManualSimilarCandidate,
  type SupplierProductRow
} from '@/lib/admin/product-match-shared'
import {
  addCatalogProductOem,
  getCatalogProductQuickEdit,
  removeCatalogProductOem,
  setCatalogProductNameOverride
} from '@/lib/actions/admin-catalog'
import type { CatalogProductQuickEdit } from '@/lib/types/admin-catalog'
import { CatalogProductDetailSheet } from '@/app/[locale]/admin/products/_components/CatalogProductDetailSheet'
import { CodeEditor } from '@/app/[locale]/admin/products/_components/ProductCodeEditor'
import { CoverageBadge } from './CoverageBadge'

interface ProductMatchModalProps {
  row: SupplierProductRow | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Eşleştirme/kaldırma sonrası (tabloyu + KPI'ları tazele). */
  onChanged?: () => void
}

function SimilarityBadge({ value }: { value: number }) {
  const pct = Math.round(value * 100)
  const tone =
    value >= 0.7
      ? 'border-green-200 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-400'
      : value >= 0.4
        ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400'
        : 'border-border bg-muted text-muted-foreground'
  return (
    <Badge variant="outline" className={`shrink-0 text-[11px] font-semibold ${tone}`}>
      %{pct}
    </Badge>
  )
}

/** Kanonik ürün adını tıklanabilir yapar; tıklayınca admin detay sheet'ini açar. */
function CanonicalDetailButton({
  onClick,
  className,
  children
}: {
  onClick: () => void
  className?: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex min-w-0 items-center gap-1 text-left hover:underline ${className ?? ''}`}
    >
      <span className="truncate">{children}</span>
      <ExternalLink className="h-3 w-3 shrink-0 opacity-60" />
    </button>
  )
}

export function ProductMatchModal({ row, open, onOpenChange, onChanged }: ProductMatchModalProps) {
  const [cands, setCands] = useState<ManualCandidatesResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [linkingId, setLinkingId] = useState<string | null>(null)
  const [unlinking, setUnlinking] = useState(false)
  // Modal açıldığındaki eşleşme durumu; kaldırınca yeniden eşleştirmeye geçer.
  const [matched, setMatched] = useState(false)
  const [currentName, setCurrentName] = useState<string | null>(null)
  // Bu modalda açılan yeni kanonik ürün; tablo satırı henüz eski (eşleşmemiş)
  // hâlini taşıdığı için bağlı ürünün kimliği buradan gelir.
  const [createdProductId, setCreatedProductId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  // Kanonik ürün detay sheet'i (eşleştirme modalinin üzerine açılır).
  const [detailProductId, setDetailProductId] = useState<string | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  // Bağlı kanonik ürünün hızlı düzenleme paneli (OEM havuzu + ad override).
  // Sık yapılan iki düzenleme burada; detay sheet'ini açmak gerekmiyor.
  const [quick, setQuick] = useState<CatalogProductQuickEdit | null>(null)
  const [quickLoading, setQuickLoading] = useState(false)
  const [nameOverride, setNameOverride] = useState('')
  const [savingName, setSavingName] = useState(false)

  // Modal kapanırken üst bileşen `row`'u null'a çeker, ama Radix kapanış
  // animasyonu boyunca içerik hâlâ mount'lu kalır. Son satırı tutup onu
  // gösteriyoruz: hem render çökmüyor hem de içerik animasyon sırasında
  // "Ürün seçilmedi."ye düşmüyor.
  const lastRowRef = useRef<SupplierProductRow | null>(null)
  if (row) lastRowRef.current = row
  const activeRow = row ?? lastRowRef.current

  const linkedProductId = activeRow?.canonicalProductId ?? createdProductId

  const openDetail = useCallback((productId: string) => {
    setDetailProductId(productId)
    setDetailOpen(true)
  }, [])

  const loadCandidates = useCallback(async (r: SupplierProductRow) => {
    setLoading(true)
    setCands(null)
    try {
      const params = new URLSearchParams({
        view: 'candidates',
        supplier: r.supplier,
        supplierProductId: r.supplierProductId,
        limit: '20'
      })
      const res = await fetch(`/api/admin/eslestirme/products/manual?${params}`)
      const data = await res.json()
      if (!res.ok || data.error) {
        toast.error(data?.error?.message || 'Adaylar yüklenemedi.')
        return
      }
      setCands(data)
    } catch {
      toast.error('Adaylar yüklenirken hata oluştu.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open && row) {
      setMatched(row.matched)
      setCurrentName(row.canonicalName)
      if (!row.matched) void loadCandidates(row)
      else setCands(null)
    }
    if (!open) {
      setCands(null)
      setLinkingId(null)
      setUnlinking(false)
      setCreating(false)
      setCreatedProductId(null)
      setDetailOpen(false)
      setDetailProductId(null)
      setQuick(null)
      setNameOverride('')
    }
  }, [open, row, loadCandidates])

  /** Bağlı kanonik ürünün ad + OEM havuzunu getirir (dar sorgu). */
  const loadQuick = useCallback(async (productId: string) => {
    setQuickLoading(true)
    try {
      const data = await getCatalogProductQuickEdit(productId)
      setQuick(data)
      setNameOverride(data?.nameOverride ?? '')
    } catch {
      toast.error('Ürün bilgileri yüklenemedi.')
    } finally {
      setQuickLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!open || !matched || !linkedProductId) {
      if (!matched) setQuick(null)
      return
    }
    void loadQuick(linkedProductId)
  }, [open, matched, linkedProductId, loadQuick])

  const saveName = useCallback(async () => {
    if (!linkedProductId || !quick) return
    setSavingName(true)
    try {
      const trimmed = nameOverride.trim()
      const res = await setCatalogProductNameOverride({
        id: linkedProductId,
        nameOverride: trimmed || null
      })
      if (!res.success) {
        toast.error(res.message)
        return
      }
      toast.success(res.message)
      const resolved = trimmed || quick.baseName
      setQuick({ ...quick, nameOverride: trimmed || null, name: resolved })
      setCurrentName(resolved)
      onChanged?.()
    } catch {
      toast.error('Ad kaydedilirken hata oluştu.')
    } finally {
      setSavingName(false)
    }
  }, [linkedProductId, quick, nameOverride, onChanged])

  const unlink = useCallback(async () => {
    if (!row) return
    setUnlinking(true)
    try {
      const res = await fetch('/api/admin/eslestirme/products/manual/unlink', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ supplier: row.supplier, supplierProductId: row.supplierProductId })
      })
      const data = await res.json()
      if (!res.ok || data.error) {
        toast.error(data?.error?.message || 'Kaldırılamadı.')
        return
      }
      toast.success('Eşleşme kaldırıldı.')
      setMatched(false)
      setCurrentName(null)
      onChanged?.()
      void loadCandidates(row)
    } catch {
      toast.error('Kaldırma sırasında hata oluştu.')
    } finally {
      setUnlinking(false)
    }
  }, [row, onChanged, loadCandidates])

  const link = useCallback(
    async (cand: ManualSimilarCandidate) => {
      if (!row) return
      setLinkingId(cand.productId)
      try {
        const res = await fetch('/api/admin/eslestirme/products/manual/link', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            supplier: row.supplier,
            supplierProductId: row.supplierProductId,
            productId: cand.productId
          })
        })
        const data = await res.json()
        if (!res.ok || data.error) {
          toast.error(data?.error?.message || 'Eşleştirme yapılamadı.')
          return
        }
        toast.success('Eşleştirildi, offer oluşturuldu.')
        onOpenChange(false)
        onChanged?.()
      } catch {
        toast.error('Eşleştirme sırasında hata oluştu.')
      } finally {
        setLinkingId(null)
      }
    },
    [row, onOpenChange, onChanged]
  )

  /**
   * Ham satırdan yeni kanonik ürün açar. Modal kapanmaz — ürün açılır açılmaz
   * detay sheet'i üstüne gelir ki admin OEM/EAN/görsel/özelliği hemen girsin.
   */
  const createCanonical = useCallback(async () => {
    if (!row) return
    setCreating(true)
    try {
      const res = await fetch('/api/admin/eslestirme/products/manual/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          supplier: row.supplier,
          supplierProductId: row.supplierProductId
        })
      })
      const data = await res.json()
      if (!res.ok || data.error) {
        toast.error(data?.error?.message || 'Kanonik ürün oluşturulamadı.')
        return
      }
      toast.success(data.message || 'Yeni kanonik ürün açıldı.')
      setMatched(true)
      setCurrentName(data.name ?? null)
      setCreatedProductId(data.productId)
      onChanged?.()
      openDetail(data.productId)
    } catch {
      toast.error('Kanonik ürün oluşturulurken hata oluştu.')
    } finally {
      setCreating(false)
    }
  }, [row, onChanged, openDetail])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] w-full flex-col overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="space-y-1 border-b border-border px-5 pb-3 pt-5">
          <DialogTitle className="text-base">
            {matched ? 'Eşleşmeyi Düzenle' : 'Ürünü Eşleştir'}
          </DialogTitle>
          <DialogDescription className="text-xs">
            Bu tedarikçi ürününü benzerlik oranına göre bir kanonik ürüne bağlayın.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 pb-5 pt-4">
          <div className="rounded-md border border-border bg-muted/30 p-3">
            {activeRow ? (
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">
                  {activeRow.name || activeRow.sku}
                </p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {PRODUCT_LIST_SUPPLIER_LABELS[activeRow.supplier]}
                  {activeRow.brandName ? ` · ${activeRow.brandName}` : ''} · SKU: {activeRow.sku}
                  {activeRow.partNo ? ` · part: ${activeRow.partNo}` : ''}
                </p>
                {activeRow.oem ? (
                  <p className="mt-1 truncate text-[11px] text-muted-foreground">
                    OEM: {activeRow.oem}
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Ürün seçilmedi.</p>
            )}
          </div>

          {matched ? (
            <div className="space-y-2 rounded-md border border-success/30 bg-success/10 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  Şu an bağlı olduğu kanonik ürün:
                  {activeRow?.canonicalNameOverridden ? ' (özel ad)' : ''}
                </p>
                {activeRow?.coverage ? <CoverageBadge coverage={activeRow.coverage} /> : null}
              </div>
              {linkedProductId ? (
                <CanonicalDetailButton
                  onClick={() => openDetail(linkedProductId)}
                  className="max-w-full text-sm font-medium text-foreground"
                >
                  {currentName || '—'}
                </CanonicalDetailButton>
              ) : (
                <p className="truncate text-sm font-medium text-foreground">{currentName || '—'}</p>
              )}
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => void unlink()}
                disabled={unlinking}
              >
                {unlinking ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Link2Off className="mr-2 h-4 w-4" />
                )}
                Bağlantıyı kaldır ve yeniden eşleştir
              </Button>
            </div>
          ) : null}

          {/*
            Hızlı düzenleme: eşleştirme sırasında en sık gereken iki alan
            (OEM havuzu + ad override) burada. Detay sheet'i tam düzenleme
            için hâlâ duruyor — ürün adına tıklayınca açılır.
          */}
          {matched && linkedProductId ? (
            <div className="space-y-4 rounded-md border border-border p-3">
              {quickLoading && !quick ? (
                <p className="flex items-center justify-center gap-2 py-4 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Ürün bilgileri yükleniyor…
                </p>
              ) : !quick ? (
                <p className="py-2 text-center text-xs text-muted-foreground">
                  Ürün bilgileri getirilemedi.
                </p>
              ) : (
                <>
                  <CodeEditor
                    title="OEM / Çapraz Referans"
                    codes={quick.oems.map((o) => ({
                      code: o.code,
                      source: o.source,
                      extra: o.brand
                    }))}
                    placeholder="DAF 1812163, MERCEDES-BENZ 0019934196"
                    hint="Virgülle ayırın; her numara «MARKA KOD» biçiminde. Marka opsiyonel."
                    listClassName="max-h-32"
                    onAdd={async (code) => {
                      const res = await addCatalogProductOem({ id: quick.id, code })
                      if (!res.success) {
                        toast.error(res.message)
                        return false
                      }
                      setQuick({ ...quick, oems: res.oems })
                      toast.success(res.message)
                      onChanged?.()
                      return true
                    }}
                    onRemove={async (item) => {
                      const res = await removeCatalogProductOem({
                        id: quick.id,
                        code: item.code,
                        brand: item.extra ?? ''
                      })
                      if (!res.success) {
                        toast.error(res.message)
                        return
                      }
                      setQuick({ ...quick, oems: res.oems })
                      toast.success(res.message)
                      onChanged?.()
                    }}
                  />

                  <div className="space-y-1.5">
                    <Label htmlFor="match-name-override" className="text-sm font-semibold">
                      İsim override
                    </Label>
                    <div className="flex items-center gap-2">
                      <Input
                        id="match-name-override"
                        value={nameOverride}
                        onChange={(e) => setNameOverride(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            void saveName()
                          }
                        }}
                        placeholder={quick.baseName}
                        className="h-8 text-xs"
                      />
                      <button
                        type="button"
                        onClick={() => void saveName()}
                        disabled={savingName || nameOverride.trim() === (quick.nameOverride ?? '')}
                        className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-border bg-card px-3 text-xs font-medium hover:bg-muted disabled:opacity-50"
                      >
                        {savingName ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Check className="h-3.5 w-3.5" />
                        )}
                        Kaydet
                      </button>
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      Boş bırakırsanız ürünün ham adı kullanılır: {quick.baseName}
                    </p>
                  </div>
                </>
              )}
            </div>
          ) : null}

          {!matched ? (
            <>
              {/*
                Eşleşmeyen satırların büyük çoğunluğu "anahtarı kapılmış"
                durumundadır: aynı part_no'lu kanonik ürün var ve bu
                tedarikçiden offer'ı dolu. O ürün aday listesinden elendiği
                için ekran boş görünür — asıl hedefi burada gösteriyoruz.
              */}
              {cands?.conflict ? (
                <div className="space-y-2 rounded-md border border-warning/30 bg-warning/10 p-3">
                  <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                    <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0 text-warning" />
                    <span>
                      Aynı part numarasını taşıyan kanonik ürün zaten var
                      {cands.conflict.blockingSku
                        ? ` ve ${activeRow ? PRODUCT_LIST_SUPPLIER_LABELS[activeRow.supplier] : 'tedarikçi'} teklifi «${cands.conflict.blockingSku}» satırında dolu`
                        : ''}
                      . Bu satırı bağlayamayız; ürünü düzenlemek için üstüne tıklayın.
                    </span>
                  </p>
                  <CanonicalDetailButton
                    onClick={() => openDetail(cands.conflict!.productId)}
                    className="max-w-full text-sm font-medium text-foreground"
                  >
                    {cands.conflict.name}
                  </CanonicalDetailButton>
                  <p className="truncate text-[11px] text-muted-foreground">
                    part: {cands.conflict.partNo}
                  </p>
                </div>
              ) : null}

              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Aday Kanonik Ürünler ({cands?.candidates.length ?? 0})
                </p>
                <div className="overflow-hidden rounded-md border border-border">
                  {loading ? (
                    <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                      Adaylar hesaplanıyor…
                    </p>
                  ) : !cands || cands.candidates.length === 0 ? (
                    <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                      Benzer kanonik ürün bulunamadı.
                    </p>
                  ) : (
                    <ul className="divide-y divide-border">
                      {cands.candidates.map((c) => (
                        <li key={c.productId} className="flex items-center gap-2 px-3 py-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <SimilarityBadge value={c.similarity} />
                              <CanonicalDetailButton
                                onClick={() => openDetail(c.productId)}
                                className="min-w-0 text-sm font-medium text-foreground"
                              >
                                {c.name}
                              </CanonicalDetailButton>
                            </div>
                            <p className="truncate text-[11px] text-muted-foreground">
                              part: {c.partNo}
                              {c.existingSuppliers.length > 0
                                ? ` · ${c.existingSuppliers.map((s) => PRODUCT_LIST_SUPPLIER_LABELS[s]).join(', ')}`
                                : ''}
                            </p>
                          </div>
                          <Button
                            size="sm"
                            className="h-7 shrink-0 px-2 text-xs"
                            onClick={() => void link(c)}
                            disabled={linkingId === c.productId}
                          >
                            {linkingId === c.productId ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Check className="mr-1 h-3.5 w-3.5" />
                            )}
                            Eşleştir
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              <div className="space-y-1.5 rounded-md border border-border p-3">
                <p className="text-[11px] text-muted-foreground">
                  Bu satır gerçekten ayrı bir ürünse kendi kanonik kaydını açın —
                  ürün hemen açılır, detay sheet’inden OEM, barkod, görsel ve
                  teknik özellik girebilirsiniz.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => void createCanonical()}
                  disabled={creating || !activeRow}
                >
                  {creating ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="mr-2 h-4 w-4" />
                  )}
                  Yeni kanonik ürün oluştur
                </Button>
              </div>
            </>
          ) : null}
        </div>
      </DialogContent>

      <CatalogProductDetailSheet
        productId={detailProductId}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onSaved={() => {
          onChanged?.()
          // Detay sheet'i bağlı ürünü düzenlediyse modaldeki panel de tazelensin.
          if (detailProductId && detailProductId === linkedProductId) {
            void loadQuick(detailProductId)
          }
        }}
      />
    </Dialog>
  )
}
