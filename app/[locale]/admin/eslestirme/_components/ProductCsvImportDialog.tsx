'use client'

import { useCallback, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, FileUp, Loader2, Upload } from 'lucide-react'
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
import { PRODUCT_CSV_EDITABLE_COLUMNS } from '@/lib/admin/product-csv-schema'

/**
 * CSV içe aktarma diyaloğu — her zaman iki adım: önce sunucuda kuru çalışma
 * (`validate`, hiçbir şey yazmaz), admin özeti gördükten sonra `apply`.
 * Dosya değişirse onay sıfırlanır; böylece A dosyasının önizlemesine bakıp
 * B dosyasını uygulamak mümkün olmaz.
 */

type ImportIssue = { line: number; message: string }

type ImportChange = {
  line: number
  supplier: string
  supplierProductId: string
  label: string
  actions: string[]
}

type ImportResult = {
  mode: 'validate' | 'apply'
  totalRows: number
  editableColumns: string[]
  ignoredHeaders: string[]
  changedRows: number
  unchangedRows: number
  counts: { link: number; relink: number; unlink: number; override: number; oems: number }
  appliedRows: number
  errorCount: number
  errors: ImportIssue[]
  changes: ImportChange[]
  touchedProducts: number
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onApplied: () => void
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'warn' | 'ok' }) {
  const color =
    tone === 'warn'
      ? 'text-warning'
      : tone === 'ok'
        ? 'text-success'
        : 'text-foreground'
  return (
    <div className="flex flex-col">
      <span className={`text-base font-semibold tabular-nums ${color}`}>
        {value.toLocaleString('tr-TR')}
      </span>
      <span className="text-[11px] text-muted-foreground">{label}</span>
    </div>
  )
}

export function ProductCsvImportDialog({ open, onOpenChange, onApplied }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<ImportResult | null>(null)
  const [applied, setApplied] = useState<ImportResult | null>(null)
  const [busy, setBusy] = useState<'validate' | 'apply' | null>(null)

  const reset = useCallback(() => {
    setFile(null)
    setPreview(null)
    setApplied(null)
    setBusy(null)
    if (inputRef.current) inputRef.current.value = ''
  }, [])

  const send = useCallback(
    async (target: File, mode: 'validate' | 'apply'): Promise<ImportResult | null> => {
      setBusy(mode)
      try {
        const body = new FormData()
        body.append('file', target)
        body.append('mode', mode)
        const res = await fetch('/api/admin/eslestirme/products/import', { method: 'POST', body })
        const data = await res.json()
        if (!res.ok || data.error) {
          toast.error(data?.error?.message || 'CSV işlenemedi.')
          return null
        }
        return data as ImportResult
      } catch {
        toast.error('CSV yüklenirken hata oluştu.')
        return null
      } finally {
        setBusy(null)
      }
    },
    []
  )

  const onPick = useCallback(
    async (picked: File | null) => {
      setPreview(null)
      setApplied(null)
      setFile(picked)
      if (!picked) return
      const result = await send(picked, 'validate')
      if (result) setPreview(result)
    },
    [send]
  )

  const onApply = useCallback(async () => {
    if (!file) return
    const result = await send(file, 'apply')
    if (!result) return
    setApplied(result)
    toast.success(
      `${result.appliedRows.toLocaleString('tr-TR')} satır uygulandı (${result.touchedProducts.toLocaleString('tr-TR')} kanonik ürün güncellendi).`
    )
    onApplied()
  }, [file, send, onApplied])

  const shown = applied ?? preview

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset()
        onOpenChange(next)
      }}
    >
      <DialogContent className="flex max-h-[85vh] w-full flex-col overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="space-y-1 border-b border-border px-5 pb-3 pt-5">
          <DialogTitle className="text-base">CSV İçe Aktar</DialogTitle>
          <DialogDescription className="text-xs">
            İndirdiğiniz CSV&apos;yi düzenleyip geri yükleyin. Önce ne olacağı gösterilir, hiçbir
            şey yazılmaz; onaylayınca uygulanır.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 pb-5 pt-4">
          <div className="rounded-md border border-border bg-muted/30 p-3 text-[11px] leading-relaxed text-muted-foreground">
            <p className="mb-1 font-medium text-foreground">Kurallar</p>
            <ul className="list-inside list-disc space-y-0.5">
              <li>
                Satır kimliği <code>supplier</code> + <code>supplier_product_id</code>; bu iki sütun
                silinemez, değiştirilemez.
              </li>
              <li>
                Yalnız dosyada <strong>bulunan</strong> sütunlar yazılır. Bir sütunu tamamen
                silerseniz o alana hiç dokunulmaz.
              </li>
              <li>
                Sütun durup hücre boşsa alan <strong>temizlenir</strong> —{' '}
                <code>canonical_product_id</code> boş bırakılırsa eşleşme koparılır.
              </li>
              <li>
                Düzenlenebilir sütunlar:{' '}
                {PRODUCT_CSV_EDITABLE_COLUMNS.map((c, i) => (
                  <span key={c}>
                    {i > 0 && ', '}
                    <code>{c}</code>
                  </span>
                ))}
                .
              </li>
            </ul>
          </div>

          <div className="flex items-center gap-3">
            <input
              ref={inputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => void onPick(e.target.files?.[0] ?? null)}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => inputRef.current?.click()}
              disabled={busy != null}
            >
              <FileUp className="mr-2 h-4 w-4" />
              Dosya seç
            </Button>
            <span className="min-w-0 truncate text-xs text-muted-foreground">
              {file ? file.name : 'Henüz dosya seçilmedi'}
            </span>
            {busy === 'validate' && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>

          {shown && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-x-8 gap-y-3 rounded-md border border-border bg-card px-4 py-3">
                <Stat label="Okunan satır" value={shown.totalRows} />
                <Stat label="Değişecek" value={shown.changedRows} tone="ok" />
                <Stat label="Değişmeyen" value={shown.unchangedRows} />
                <Stat label="Hatalı" value={shown.errorCount} tone={shown.errorCount ? 'warn' : undefined} />
                {applied && <Stat label="Uygulanan" value={applied.appliedRows} tone="ok" />}
              </div>

              <div className="flex flex-wrap gap-1.5">
                {shown.counts.link > 0 && (
                  <Badge variant="outline">{shown.counts.link} yeni eşleştirme</Badge>
                )}
                {shown.counts.relink > 0 && (
                  <Badge variant="outline">{shown.counts.relink} taşıma</Badge>
                )}
                {shown.counts.unlink > 0 && (
                  <Badge variant="outline" className="border-warning/20 bg-warning/15 text-warning">
                    {shown.counts.unlink} kopartma
                  </Badge>
                )}
                {shown.counts.override > 0 && (
                  <Badge variant="outline">{shown.counts.override} ad/fiyat/not</Badge>
                )}
                {shown.counts.oems > 0 && <Badge variant="outline">{shown.counts.oems} OEM</Badge>}
              </div>

              {shown.ignoredHeaders.length > 0 && (
                <p className="text-[11px] text-muted-foreground">
                  Tanınmayan sütunlar yok sayıldı: {shown.ignoredHeaders.join(', ')}
                </p>
              )}

              {shown.errors.length > 0 && (
                <div className="rounded-md border border-warning/30 bg-warning/10">
                  <div className="flex items-center gap-2 border-b border-warning/20 px-3 py-2">
                    <AlertTriangle className="h-4 w-4 text-warning" />
                    <p className="text-xs font-semibold text-warning">
                      {shown.errorCount} hata — bu satırlar uygulanmaz
                    </p>
                  </div>
                  <ul className="max-h-44 divide-y divide-warning/15 overflow-y-auto">
                    {shown.errors.map((e, i) => (
                      <li key={i} className="px-3 py-1.5 text-[11px] text-foreground">
                        <span className="font-mono text-muted-foreground">satır {e.line}</span> —{' '}
                        {e.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {shown.changes.length > 0 && (
                <div className="rounded-md border border-border">
                  <p className="border-b border-border px-3 py-2 text-xs font-semibold text-foreground">
                    Değişiklikler {shown.changedRows > shown.changes.length && `(ilk ${shown.changes.length})`}
                  </p>
                  <ul className="max-h-56 divide-y divide-border overflow-y-auto">
                    {shown.changes.map((c) => (
                      <li key={`${c.supplier}:${c.supplierProductId}`} className="px-3 py-1.5">
                        <p className="truncate text-xs font-medium text-foreground">{c.label}</p>
                        <p className="truncate text-[11px] text-muted-foreground">
                          <span className="font-mono">satır {c.line}</span> · {c.actions.join(' · ')}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {applied && (
                <p className="flex items-center gap-1.5 text-xs text-success">
                  <CheckCircle2 className="h-4 w-4" />
                  Uygulandı. Tablo tazelendi.
                </p>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Kapat
          </Button>
          <Button
            size="sm"
            onClick={() => void onApply()}
            disabled={busy != null || !preview || preview.changedRows === 0 || applied != null}
          >
            {busy === 'apply' ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Upload className="mr-2 h-4 w-4" />
            )}
            {preview ? `${preview.changedRows.toLocaleString('tr-TR')} değişikliği uygula` : 'Uygula'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
