'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, Loader2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { RegionalStockSummary } from '@/components/admin/regional-stock-summary'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { AdminFormDialog } from '@/components/admin/admin-form-dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Link } from '@/lib/navigation'
import {
  adminProductDetailQueryKey,
  fetchAdminProductDetail
} from '@/lib/api/admin-products-workbench'
import { updateAdminProductDetail } from '@/lib/actions/admin-products'
import { refreshDinamikStockBySku } from '@/lib/actions/admin-suppliers'
import type { AdminProductDetail } from '@/lib/types/admin-products'

interface ProductDetailDrawerProps {
  partId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: (detail: AdminProductDetail) => void
}

export function ProductDetailDrawer({
  partId,
  open,
  onOpenChange,
  onSaved
}: ProductDetailDrawerProps) {
  const t = useTranslations('AdminCatalog.products')
  const queryClient = useQueryClient()
  const [isSaving, setIsSaving] = useState(false)
  const [isCheckingStock, setIsCheckingStock] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [imageUrlsText, setImageUrlsText] = useState('')
  const [sellingPrice, setSellingPrice] = useState('')
  const [minStock, setMinStock] = useState('3')
  const [reservedStock, setReservedStock] = useState('0')
  const [isVisible, setIsVisible] = useState(true)
  const [lockPrice, setLockPrice] = useState(false)
  const [lockVisibility, setLockVisibility] = useState(false)
  const [note, setNote] = useState('')

  const detailQuery = useQuery({
    queryKey: adminProductDetailQueryKey(partId),
    queryFn: () => fetchAdminProductDetail(partId as string),
    enabled: open && Boolean(partId),
    staleTime: 60 * 1000
  })

  const detail = detailQuery.data ?? null
  const activeRegionalOffer = useMemo(() => {
    const summary = detail?.supplierSummary
    if (!summary?.sourceSupplierProductId) return null

    return (
      summary.offers.find(
        (offer) => offer.supplierProductId === summary.sourceSupplierProductId
      ) || null
    )
  }, [detail])

  const syncFormFromDetail = (value: AdminProductDetail) => {
    setName(value.name)
    setDescription(value.description || '')
    setImageUrlsText(value.imageUrls.join('\n'))
    setSellingPrice(value.sellingPrice.toString())
    setMinStock(value.minStockLevel.toString())
    setReservedStock(value.reservedStockQty.toString())
    setIsVisible(value.isVisible)
    setLockPrice(value.lockPrice)
    setLockVisibility(value.lockVisibility)
    setNote(value.note || '')
  }

  useEffect(() => {
    if (!detail) return
    syncFormFromDetail(detail)
  }, [detail])

  const technicalSummary = useMemo(() => {
    return {
      eans: detail?.eans.length || 0,
      oem: detail?.oemReferences.length || 0,
      cross: detail?.crossReferences.length || 0,
      properties: detail?.properties.length || 0,
      documents: detail?.documents.length || 0
    }
  }, [detail])

  const matchingHref = useMemo(() => {
    const query = (detail?.name || detail?.articleLinkId || '').trim()
    return query
      ? `/admin/eslestirme?tab=products&q=${encodeURIComponent(query)}`
      : '/admin/eslestirme?tab=products'
  }, [detail?.articleLinkId, detail?.name])

  const parsedImageUrls = useMemo(
    () =>
      imageUrlsText
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
    [imageUrlsText]
  )

  const handleSave = async () => {
    if (!partId) return

    const trimmedName = name.trim()
    if (!trimmedName) {
      toast.error('Ürün adı boş olamaz.')
      return
    }

    const parsedPrice = Number(sellingPrice)
    if (!Number.isFinite(parsedPrice) || parsedPrice < 0) {
      toast.error('Geçerli bir satış fiyatı girin.')
      return
    }

    const parsedMinStock = Number(minStock)
    if (!Number.isFinite(parsedMinStock) || parsedMinStock < 0) {
      toast.error('Geçerli bir minimum stok değeri girin.')
      return
    }

    const parsedReserved = Number(reservedStock)
    if (!Number.isFinite(parsedReserved) || parsedReserved < 0) {
      toast.error('Geçerli bir rezerve stok değeri girin.')
      return
    }

    setIsSaving(true)
    const response = await updateAdminProductDetail({
      partId,
      name: trimmedName,
      description: description.trim() || null,
      imageUrls: parsedImageUrls,
      sellingPriceOverride: parsedPrice,
      minStockLevel: parsedMinStock,
      reservedStockQty: parsedReserved,
      isVisible,
      lockPrice,
      lockVisibility,
      note: note.trim() || null
    })

    if (!response.success) {
      setIsSaving(false)
      toast.error(response.message)
      return
    }

    const refreshedDetail = await queryClient.fetchQuery({
      queryKey: adminProductDetailQueryKey(partId),
      queryFn: () => fetchAdminProductDetail(partId),
      staleTime: 0
    })
    setIsSaving(false)

    toast.success(response.message)
    onSaved(refreshedDetail)
  }

  const handleCheckSupplierStock = async (sku: string) => {
    setIsCheckingStock(sku)
    const result = await refreshDinamikStockBySku(sku)
    setIsCheckingStock(null)

    if (!result.success || !result.data) {
      toast.error(result.message || 'Anlık stok doğrulaması başarısız.')
      return
    }

    const { data } = result
    const dbLabel = data.dbUpdated
      ? ` (DB güncellendi, ${data.affectedParts} parça)`
      : ' (salt okunur)'

    toast.success(
      `${data.sku} anlık stok: ${data.stockQty} | fiyat: ${
        data.price ?? '-'
      } TRY${dbLabel}`
    )

    // Refresh detail data from DB if it was updated
    if (data.dbUpdated && partId) {
      void queryClient.invalidateQueries({
        queryKey: adminProductDetailQueryKey(partId)
      })
    }
  }

  return (
    <AdminFormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('productDetails')}
      description={
        detail
          ? `#${detail.id} - ${detail.name}`
          : 'Ürün bilgileri yükleniyor.'
      }
      onSave={handleSave}
      isSaving={isSaving}
      saveDisabled={detailQuery.isFetching || !detail}
      saveLabel="Kaydet"
      size="4xl"
    >
      {detailQuery.isLoading && !detail ? (
          <div className="mt-8 flex items-center justify-center text-muted-foreground">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            Yükleniyor...
          </div>
        ) : detail ? (
          <div className="mt-6 space-y-4">
            <div className="sticky top-0 z-10 rounded-lg border border-border bg-white/95 p-4 backdrop-blur">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-foreground">
                  {t('productDetails')}
                </p>
                <Button variant="outline" size="sm" asChild>
                  <Link href={matchingHref}>
                    <ExternalLink className="mr-1.5 h-4 w-4" />
                    {t('openMatching')}
                  </Link>
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                <SummaryCard label="Parça ID" value={`#${detail.id}`} />
                <SummaryCard
                  label="Article Link"
                  value={detail.articleLinkId}
                />
                <SummaryCard label="Senkron" value={detail.syncStatus} />
                <SummaryCard
                  label="Stok"
                  value={`${detail.availableStockQty} kullanılabilir`}
                />
                <SummaryCard
                  label="Satış Fiyatı"
                  value={`${detail.sellingPrice} TRY`}
                />
                <SummaryCard
                  label="Marka / Kategori"
                  value={`${detail.brand || '-'} / ${detail.category || '-'}`}
                />
              </div>
            </div>

            <Tabs defaultValue="genel" className="w-full">
              <TabsList className="w-full justify-start overflow-auto">
                <TabsTrigger value="genel">Genel</TabsTrigger>
                <TabsTrigger value="fiyat">Fiyat/Stok</TabsTrigger>
                <TabsTrigger value="gorunurluk">Görünürlük</TabsTrigger>
                <TabsTrigger value="tedarik">Tedarik</TabsTrigger>
                <TabsTrigger value="varyantlar">Varyantlar</TabsTrigger>
                <TabsTrigger value="teknik">Teknik Referans</TabsTrigger>
                <TabsTrigger value="senkron">Senkron Özeti</TabsTrigger>
              </TabsList>

              <TabsContent
                value="genel"
                className="space-y-3 rounded-md border p-4"
              >
                <Field
                  label={t('detailName')}
                  value={name}
                  onChange={setName}
                />
                <InfoRow label="Parça ID" value={detail.id} />
                <InfoRow label="Article Link ID" value={detail.articleLinkId} />
                <InfoRow label="Marka" value={detail.brand || '-'} />
                <InfoRow label="Kategori" value={detail.category || '-'} />
                <label className="block text-sm font-medium text-foreground">
                  {t('detailDescription')}
                </label>
                <Textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  rows={4}
                  placeholder="Ürün açıklaması"
                />
                <label className="block text-sm font-medium text-foreground">
                  {t('detailImages')}
                </label>
                <p className="text-xs text-muted-foreground">
                  {t('detailImagesHint')}
                </p>
                <Textarea
                  value={imageUrlsText}
                  onChange={(event) => setImageUrlsText(event.target.value)}
                  rows={4}
                  placeholder="https://..."
                  className="font-mono text-xs"
                />
                {parsedImageUrls.length > 0 ? (
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    {parsedImageUrls.slice(0, 8).map((url) => (
                      <div
                        key={url}
                        className="overflow-hidden rounded-md border border-border bg-muted"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={url}
                          alt=""
                          className="aspect-square w-full object-contain"
                        />
                      </div>
                    ))}
                  </div>
                ) : null}
                <InfoRow
                  label="Güncelleme"
                  value={new Date(detail.updatedAt).toLocaleString('tr-TR')}
                />
              </TabsContent>

              <TabsContent
                value="fiyat"
                className="space-y-3 rounded-md border p-4"
              >
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <Field
                    label="Tedarikçi Fiyatı"
                    value={
                      detail.supplierPrice != null
                        ? `${detail.supplierPrice} TRY`
                        : '-'
                    }
                    readOnly
                  />
                  <Field
                    label="Satış Fiyatı Override"
                    value={sellingPrice}
                    onChange={setSellingPrice}
                    type="number"
                  />
                  <Field
                    label="Tedarikçi Stok"
                    value={String(detail.supplierStockQty)}
                    readOnly
                  />
                  <Field
                    label="Rezerve Stok"
                    value={reservedStock}
                    onChange={setReservedStock}
                    type="number"
                  />
                  <Field
                    label="Minimum Stok"
                    value={minStock}
                    onChange={setMinStock}
                    type="number"
                  />
                  <Field
                    label="Senkron Durumu"
                    value={detail.syncStatus}
                    readOnly
                  />
                </div>

                {activeRegionalOffer ? (
                  <div className="mt-4 rounded-lg border border-border bg-accent/50 p-4">
                    <h4 className="mb-3 text-sm font-semibold text-foreground">
                      Fiyat Hesaplama Detayı ({activeRegionalOffer.providerName}
                      )
                    </h4>
                    <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
                      <div>
                        <p className="text-xs text-primary">
                          Tedarikçi Fiyatı
                        </p>
                        <p className="text-sm font-medium text-foreground">
                          {activeRegionalOffer.supplierPrice != null
                            ? `${activeRegionalOffer.supplierPrice} ${activeRegionalOffer.currency}`
                            : '-'}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-primary">Marka İndirimi</p>
                        <p className="text-sm font-medium text-foreground">
                          %
                          {(
                            activeRegionalOffer.standardDiscountRate * 100
                          ).toFixed(2)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-primary">
                          Kampanya İndirimi
                        </p>
                        <p className="text-sm font-medium text-foreground">
                          %{(activeRegionalOffer.campaignRate * 100).toFixed(2)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-primary">
                          Satın Alma Fiyatı (Net)
                        </p>
                        <p className="text-sm font-bold text-foreground">
                          {activeRegionalOffer.computedNetCost != null
                            ? `${activeRegionalOffer.computedNetCost} TRY`
                            : '-'}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-primary">
                          Kâr Oranı (Margin)
                        </p>
                        <p className="text-sm font-medium text-foreground">
                          %{(activeRegionalOffer.marginRate * 100).toFixed(2)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-primary">
                          Sistem Satış Fiyatı
                        </p>
                        <p className="text-sm font-bold text-success">
                          {activeRegionalOffer.computedSellingPrice != null
                            ? `${activeRegionalOffer.computedSellingPrice} TRY`
                            : '-'}
                        </p>
                      </div>
                    </div>
                  </div>
                ) : null}

                <label className="flex items-center gap-2 text-sm text-foreground mt-4">
                  <input
                    type="checkbox"
                    checked={lockPrice}
                    onChange={(event) => setLockPrice(event.target.checked)}
                  />
                  Fiyat kilidini etkinleştir
                </label>
              </TabsContent>

              <TabsContent
                value="gorunurluk"
                className="space-y-3 rounded-md border p-4"
              >
                <label className="flex items-center gap-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={isVisible}
                    onChange={(event) => setIsVisible(event.target.checked)}
                  />
                  Ürün vitrinde görünsün
                </label>
                <label className="flex items-center gap-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={lockVisibility}
                    onChange={(event) =>
                      setLockVisibility(event.target.checked)
                    }
                  />
                  Görünürlük kilidini etkinleştir
                </label>
                <label className="block text-sm font-medium text-foreground">
                  Not
                </label>
                <Textarea
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  rows={4}
                  placeholder="Operasyon notu"
                />
              </TabsContent>

              <TabsContent
                value="tedarik"
                className="space-y-3 rounded-md border p-4"
              >
                <InfoRow
                  label="Aktif Seçim Nedeni"
                  value={detail.supplierSummary?.selectionReason || 'Kayıt yok'}
                />
                <InfoRow
                  label="Aktif Sağlayıcı"
                  value={
                    detail.supplierSummary?.sourceProvider
                      ? `${detail.supplierSummary.sourceProvider.name} (${detail.supplierSummary.sourceProvider.code})`
                      : 'Yok'
                  }
                />
                <InfoRow
                  label="Politika Zamanı"
                  value={
                    detail.supplierSummary?.policyAppliedAt
                      ? new Date(
                          detail.supplierSummary.policyAppliedAt
                        ).toLocaleString('tr-TR')
                      : 'Kayıt yok'
                  }
                />
                <RegionalStockSummary
                  title={
                    activeRegionalOffer
                      ? `Bolgesel Stok (${activeRegionalOffer.providerName} / ${activeRegionalOffer.supplierSku})`
                      : 'Bolgesel Stok'
                  }
                  regionalStock={detail.supplierSummary?.selectedRegionalStock}
                />

                <div className="rounded-md border border-border">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-border bg-muted">
                        <th className="px-3 py-2">Sağlayıcı</th>
                        <th className="px-3 py-2">SKU</th>
                        <th className="px-3 py-2">Fiyat</th>
                        <th className="px-3 py-2">Stok</th>
                        <th className="px-3 py-2">Durum</th>
                        <th className="px-3 py-2 text-right">Aksiyon</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(detail.supplierSummary?.offers || []).map((offer) => (
                        <tr
                          key={`${offer.providerId}-${offer.supplierProductId}`}
                        >
                          <td className="px-3 py-2">{offer.providerName}</td>
                          <td className="px-3 py-2">{offer.supplierSku}</td>
                          <td className="px-3 py-2">
                            {offer.supplierPrice != null
                              ? `${offer.supplierPrice} ${offer.currency}`
                              : '-'}
                          </td>
                          <td className="px-3 py-2">
                            {offer.supplierStockQty}
                          </td>
                          <td className="px-3 py-2">
                            {offer.isActive ? 'Aktif' : 'Pasif'}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {offer.providerCode === 'dinamik' ? (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={isCheckingStock === offer.supplierSku}
                                onClick={() =>
                                  handleCheckSupplierStock(offer.supplierSku)
                                }
                              >
                                {isCheckingStock === offer.supplierSku ? (
                                  <Loader2
                                    size={13}
                                    className="mr-1 animate-spin"
                                  />
                                ) : null}
                                Anlık Kontrol
                              </Button>
                            ) : (
                              '-'
                            )}
                          </td>
                        </tr>
                      ))}
                      {(detail.supplierSummary?.offers || []).length === 0 && (
                        <tr>
                          <td colSpan={6} className="px-3 py-3 text-muted-foreground">
                            Tedarik teklifi bulunamadı.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </TabsContent>

              <TabsContent
                value="varyantlar"
                className="space-y-3 rounded-md border p-4"
              >
                <p className="text-sm text-muted-foreground">
                  Aynı ürün anahtarında toplam {detail.variants.length} varyant
                  bulundu.
                </p>

                <div className="rounded-md border border-border">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-border bg-muted">
                        <th className="px-3 py-2">Parça ID</th>
                        <th className="px-3 py-2">Article Link</th>
                        <th className="px-3 py-2">Stok</th>
                        <th className="px-3 py-2">Senkron</th>
                        <th className="px-3 py-2">Görünür</th>
                        <th className="px-3 py-2">Güncelleme</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.variants.map((variant) => (
                        <tr
                          key={variant.id}
                          className={
                            variant.id === detail.id
                              ? 'bg-muted/80'
                              : undefined
                          }
                        >
                          <td className="px-3 py-2 font-medium text-foreground">
                            #{variant.id}
                          </td>
                          <td className="px-3 py-2">{variant.articleLinkId}</td>
                          <td className="px-3 py-2">
                            {variant.supplierStockQty}
                          </td>
                          <td className="px-3 py-2">{variant.syncStatus}</td>
                          <td className="px-3 py-2">
                            {variant.isVisible ? 'Evet' : 'Hayır'}
                          </td>
                          <td className="px-3 py-2">
                            {new Date(variant.updatedAt).toLocaleString(
                              'tr-TR'
                            )}
                          </td>
                        </tr>
                      ))}
                      {detail.variants.length === 0 && (
                        <tr>
                          <td colSpan={6} className="px-3 py-3 text-muted-foreground">
                            Varyant bulunamadı.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </TabsContent>

              <TabsContent
                value="teknik"
                className="space-y-3 rounded-md border p-4"
              >
                <p className="text-sm text-muted-foreground">
                  EAN: {technicalSummary.eans} | OEM: {technicalSummary.oem} |
                  Cross Ref: {technicalSummary.cross} | Özellik:{' '}
                  {technicalSummary.properties} | Doküman:{' '}
                  {technicalSummary.documents}
                </p>

                <ReadOnlySection
                  title="EAN Kodları"
                  items={detail.eans.slice(0, 20)}
                />
                <ReadOnlySection
                  title="OEM Referansları"
                  items={detail.oemReferences
                    .slice(0, 20)
                    .map((item) => `${item.brand}: ${item.code}`)}
                />
                <ReadOnlySection
                  title="Cross Referans"
                  items={detail.crossReferences
                    .slice(0, 20)
                    .map((item) => `${item.brand}: ${item.articleNumber}`)}
                />
              </TabsContent>

              <TabsContent
                value="senkron"
                className="space-y-3 rounded-md border p-4"
              >
                <InfoRow
                  label="Son Senkron"
                  value={
                    detail.lastSyncedAt
                      ? new Date(detail.lastSyncedAt).toLocaleString('tr-TR')
                      : 'Kayıt yok'
                  }
                />
                <div className="rounded-md border border-border">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-border bg-muted">
                        <th className="px-3 py-2">Kaynak</th>
                        <th className="px-3 py-2">Durum</th>
                        <th className="px-3 py-2">Başlangıç</th>
                        <th className="px-3 py-2">Başarılı/Başarısız</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.recentSyncRuns.map((run) => (
                        <tr key={run.id}>
                          <td className="px-3 py-2">{run.source}</td>
                          <td className="px-3 py-2 font-semibold">
                            {run.status}
                          </td>
                          <td className="px-3 py-2">
                            {new Date(run.startedAt).toLocaleString('tr-TR')}
                          </td>
                          <td className="px-3 py-2">
                            {run.successCount}/{run.failedCount}
                          </td>
                        </tr>
                      ))}
                      {detail.recentSyncRuns.length === 0 && (
                        <tr>
                          <td colSpan={4} className="px-3 py-3 text-muted-foreground">
                            Senkron geçmişi bulunamadı.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </TabsContent>
            </Tabs>
          </div>
        ) : detailQuery.isError ? (
          <div className="mt-8 text-sm text-muted-foreground">
            Ürün detayı yüklenemedi.
          </div>
        ) : (
          <div className="mt-8 text-sm text-muted-foreground">
            Ürün detayı bulunamadı.
          </div>
        )}
    </AdminFormDialog>
  )
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-muted/70 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-sm font-semibold text-foreground">{value}</p>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-md bg-muted px-3 py-2">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold text-foreground">{value}</span>
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  readOnly,
  type = 'text'
}: {
  label: string
  value: string
  onChange?: (value: string) => void
  readOnly?: boolean
  type?: 'text' | 'number'
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-muted-foreground">
        {label}
      </label>
      <input
        type={type}
        value={value}
        readOnly={readOnly}
        onChange={(event) => onChange?.(event.target.value)}
        className="w-full rounded-md border border-border px-3 py-2 text-sm"
      />
    </div>
  )
}

function ReadOnlySection({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-md border border-border">
      <div className="border-b border-border px-3 py-2 text-xs font-semibold text-muted-foreground">
        {title}
      </div>
      <div className="max-h-32 overflow-auto px-3 py-2 text-xs text-foreground">
        {items.length > 0 ? items.join(', ') : 'Kayıt yok'}
      </div>
    </div>
  )
}
