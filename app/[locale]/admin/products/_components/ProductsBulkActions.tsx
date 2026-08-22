'use client'

import { useMemo, useRef, useState, useTransition } from 'react'
import { Download, Upload, Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  bulkUpdateAdminProducts,
  exportAdminNewProductsCsvTemplate,
  exportAdminProductsCsv,
  importAdminNewProductsCsv,
  importAdminProductsCsv
} from '@/lib/actions/admin-products'
import type {
  AdminImportPreviewRow,
  AdminNewImportPreviewRow,
  AdminProductFilters
} from '@/lib/types/admin-products'

interface ProductsBulkActionsProps {
  selectedIds: string[]
  filters: AdminProductFilters
  onCompleted?: () => void
  mode?: 'full' | 'csv'
}

export function ProductsBulkActions({
  selectedIds,
  filters,
  onCompleted,
  mode = 'full'
}: ProductsBulkActionsProps) {
  const [isPending, startTransition] = useTransition()
  const [priceInput, setPriceInput] = useState('')
  const [lockPrice, setLockPrice] = useState(true)

  const updateFileInputRef = useRef<HTMLInputElement>(null)
  const [updatePreviewRows, setUpdatePreviewRows] = useState<AdminImportPreviewRow[]>(
    []
  )
  const [updatePreviewSummary, setUpdatePreviewSummary] = useState<{
    totalRows: number
    readyRows: number
    updatedRows: number
    errorRows: number
    skippedRows: number
  } | null>(null)
  const newFileInputRef = useRef<HTMLInputElement>(null)
  const [newPreviewRows, setNewPreviewRows] = useState<AdminNewImportPreviewRow[]>(
    []
  )
  const [newPreviewSummary, setNewPreviewSummary] = useState<{
    totalRows: number
    readyRows: number
    createdRows: number
    errorRows: number
    skippedRows: number
  } | null>(null)

  const hasSelection = selectedIds.length > 0

  const bulkDisabled = useMemo(() => {
    const hasPrice = priceInput.trim().length > 0
    return !hasSelection || !hasPrice
  }, [hasSelection, priceInput])

  const downloadCsvFile = (csv: string, filename: string) => {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.setAttribute('download', filename)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const handleExport = () => {
    startTransition(async () => {
      const result = await exportAdminProductsCsv(filters)
      if (!result.success || !result.csv || !result.filename) {
        toast.error(result.message || 'CSV dışa aktarma başarısız.')
        return
      }

      downloadCsvFile(result.csv, result.filename)
      toast.success('CSV dosyası indirildi.')
    })
  }

  const handleDownloadNewTemplate = () => {
    startTransition(async () => {
      const result = await exportAdminNewProductsCsvTemplate()
      if (!result.success || !result.csv || !result.filename) {
        toast.error(result.message || 'Yeni ürün CSV şablonu indirilemedi.')
        return
      }

      downloadCsvFile(result.csv, result.filename)
      toast.success(result.message || 'Yeni ürün CSV şablonu indirildi.')
    })
  }

  const handleBulkApply = () => {
    if (!hasSelection) {
      toast.error('Lütfen en az bir ürün seçin.')
      return
    }

    startTransition(async () => {
      const price = priceInput.trim()
      const payload: {
        partIds: string[]
        sellingPriceOverride?: number | null
        lockPrice?: boolean
      } = {
        partIds: selectedIds
      }

      if (price.length > 0) {
        const parsed = Number(price)
        if (!Number.isFinite(parsed) || parsed < 0) {
          toast.error('Geçerli bir fiyat girin.')
          return
        }
        payload.sellingPriceOverride = parsed
        payload.lockPrice = lockPrice
      }

      const result = await bulkUpdateAdminProducts(payload)
      if (!result.success) {
        toast.error(result.message)
        return
      }

      toast.success(`${result.affected} ürün güncellendi.`)
      onCompleted?.()
    })
  }

  const runUpdateImport = (mode: 'preview' | 'apply') => {
    const file = updateFileInputRef.current?.files?.[0]
    if (!file) {
      toast.error('Lütfen bir CSV dosyası seçin.')
      return
    }

    startTransition(async () => {
      const result = await importAdminProductsCsv(file, mode)
      if (!result.success) {
        toast.error(result.message)
        return
      }

      setUpdatePreviewRows(result.rows)
      setUpdatePreviewSummary(result.summary)

      toast.success(result.message)
      if (mode === 'apply') {
        onCompleted?.()
      }
    })
  }

  const runNewImport = (mode: 'preview' | 'apply') => {
    const file = newFileInputRef.current?.files?.[0]
    if (!file) {
      toast.error('Lütfen yeni ürün import CSV dosyasını seçin.')
      return
    }

    startTransition(async () => {
      const result = await importAdminNewProductsCsv(file, mode)
      if (!result.success) {
        toast.error(result.message)
        return
      }

      setNewPreviewRows(result.rows)
      setNewPreviewSummary(result.summary)

      toast.success(result.message)
      if (mode === 'apply') {
        onCompleted?.()
      }
    })
  }

  return (
    <div className="space-y-4 rounded-lg border border-border bg-background p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            {mode === 'full' ? `Toplu İşlemler (${selectedIds.length} seçili)` : 'CSV Araçları'}
          </h3>
          <p className="text-xs text-muted-foreground">
            {mode === 'full'
              ? 'Seçili ürünlerde fiyat override güncellemesi yapın.'
              : 'Filtreye göre ürünleri dışa aktarın veya CSV ile içe alın.'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={handleExport}
            disabled={isPending}
          >
            {isPending ? (
              <Loader2 size={14} className="mr-2 animate-spin" />
            ) : (
              <Download size={14} className="mr-2" />
            )}
            CSV Dışa Aktar
          </Button>
        </div>
      </div>

      {mode === 'full' ? (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Satış fiyatı override (TRY)
            </label>
            <input
              value={priceInput}
              onChange={(event) => setPriceInput(event.target.value)}
              placeholder="Örn: 1299.90"
              className="w-full rounded-md border border-border px-3 py-2 text-sm"
            />
            <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={lockPrice}
                onChange={(event) => setLockPrice(event.target.checked)}
              />
              Fiyat kilidi uygula
            </label>
          </div>

          <div className="flex items-end gap-2">
            <Button
              type="button"
              onClick={handleBulkApply}
              disabled={isPending || bulkDisabled}
              className="w-full"
            >
              {isPending ? (
                <Loader2 size={14} className="mr-2 animate-spin" />
              ) : (
                <RefreshCw size={14} className="mr-2" />
              )}
              Toplu Güncelle
            </Button>
          </div>
        </div>
      ) : null}

      <div className="border-t border-border pt-4">
        <h4 className="text-sm font-semibold text-foreground">
          CSV Güncelleme İçe Aktar
        </h4>
        <p className="mt-1 text-xs text-muted-foreground">
          Desteklenen kolonlar: `part_id`, `article_link_id`,
          `selling_price_override`, `lock_price`.
        </p>

        <div className="mt-3 flex flex-col gap-2 md:flex-row md:items-center">
          <input
            ref={updateFileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="w-full rounded-md border border-border px-3 py-2 text-sm md:max-w-sm"
          />
          <Button
            type="button"
            variant="outline"
            disabled={isPending}
            onClick={() => runUpdateImport('preview')}
          >
            {isPending ? (
              <Loader2 size={14} className="mr-2 animate-spin" />
            ) : (
              <Upload size={14} className="mr-2" />
            )}
            Önizle
          </Button>
          <Button
            type="button"
            disabled={isPending}
            onClick={() => runUpdateImport('apply')}
            className="bg-success hover:bg-success"
          >
            Uygula
          </Button>
        </div>

        {updatePreviewSummary && (
          <div className="mt-3 rounded-lg bg-muted p-3 text-xs text-foreground">
            <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
              <span>Toplam: {updatePreviewSummary.totalRows}</span>
              <span>Hazır: {updatePreviewSummary.readyRows}</span>
              <span>Güncellenen: {updatePreviewSummary.updatedRows}</span>
              <span>Hata: {updatePreviewSummary.errorRows}</span>
              <span>Atlanan: {updatePreviewSummary.skippedRows}</span>
            </div>
          </div>
        )}

        {updatePreviewRows.length > 0 && (
          <div className="mt-3 max-h-56 overflow-auto rounded-md border border-border">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-background">
                <tr className="border-b border-border">
                  <th className="px-3 py-2">Satır</th>
                  <th className="px-3 py-2">Part ID</th>
                  <th className="px-3 py-2">Durum</th>
                  <th className="px-3 py-2">Mesaj</th>
                </tr>
              </thead>
              <tbody>
                {updatePreviewRows.map((row) => (
                  <tr key={`update-${row.row}-${row.partId || 'x'}`}>
                    <td className="px-3 py-2">{row.row}</td>
                    <td className="px-3 py-2">{row.partId || '-'}</td>
                    <td className="px-3 py-2 font-semibold">{row.status}</td>
                    <td className="px-3 py-2 text-muted-foreground">{row.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="border-t border-border pt-4">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <h4 className="text-sm font-semibold text-foreground">
              Yeni Ürün CSV Import
            </h4>
            <p className="mt-1 text-xs text-muted-foreground">
              `template_part_id` tabanlı satırlarla yeni ürün ve ilişkili teknik tabloları
              tek seferde oluşturur.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={isPending}
            onClick={handleDownloadNewTemplate}
          >
            {isPending ? (
              <Loader2 size={14} className="mr-2 animate-spin" />
            ) : (
              <Download size={14} className="mr-2" />
            )}
            Yeni Ürün Template İndir
          </Button>
        </div>

        <div className="mt-3 flex flex-col gap-2 md:flex-row md:items-center">
          <input
            ref={newFileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="w-full rounded-md border border-border px-3 py-2 text-sm md:max-w-sm"
          />
          <Button
            type="button"
            variant="outline"
            disabled={isPending}
            onClick={() => runNewImport('preview')}
          >
            {isPending ? (
              <Loader2 size={14} className="mr-2 animate-spin" />
            ) : (
              <Upload size={14} className="mr-2" />
            )}
            Önizle
          </Button>
          <Button
            type="button"
            disabled={isPending}
            onClick={() => runNewImport('apply')}
            className="bg-success hover:bg-success"
          >
            Uygula
          </Button>
        </div>

        {newPreviewSummary && (
          <div className="mt-3 rounded-lg bg-muted p-3 text-xs text-foreground">
            <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
              <span>Toplam: {newPreviewSummary.totalRows}</span>
              <span>Hazır: {newPreviewSummary.readyRows}</span>
              <span>Oluşturulan: {newPreviewSummary.createdRows}</span>
              <span>Hata: {newPreviewSummary.errorRows}</span>
              <span>Atlanan: {newPreviewSummary.skippedRows}</span>
            </div>
          </div>
        )}

        {newPreviewRows.length > 0 && (
          <div className="mt-3 max-h-56 overflow-auto rounded-md border border-border">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-background">
                <tr className="border-b border-border">
                  <th className="px-3 py-2">Satır</th>
                  <th className="px-3 py-2">Template ID</th>
                  <th className="px-3 py-2">Part ID</th>
                  <th className="px-3 py-2">Durum</th>
                  <th className="px-3 py-2">Mesaj</th>
                </tr>
              </thead>
              <tbody>
                {newPreviewRows.map((row) => (
                  <tr key={`new-${row.row}-${row.partId || 'x'}`}>
                    <td className="px-3 py-2">{row.row}</td>
                    <td className="px-3 py-2">{row.templatePartId || '-'}</td>
                    <td className="px-3 py-2">{row.partId || '-'}</td>
                    <td className="px-3 py-2 font-semibold">{row.status}</td>
                    <td className="px-3 py-2 text-muted-foreground">{row.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
