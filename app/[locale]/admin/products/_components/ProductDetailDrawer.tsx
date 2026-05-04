'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { RegionalStockSummary } from '@/components/admin/regional-stock-summary'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
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
  const queryClient = useQueryClient()
  const [isSaving, setIsSaving] = useState(false)
  const [isCheckingStock, setIsCheckingStock] = useState<string | null>(null)

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

  const handleSave = async () => {
    if (!partId) return

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
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto sm:max-w-[760px]"
      >
        <SheetHeader className="border-b border-gray-100 pb-4">
          <SheetTitle>Ürün Detayı</SheetTitle>
          <SheetDescription>
            {detail
              ? `#${detail.id} - ${detail.name}`
              : 'Ürün bilgileri yükleniyor.'}
          </SheetDescription>
        </SheetHeader>

        {detailQuery.isLoading && !detail ? (
          <div className="mt-8 flex items-center justify-center text-gray-500">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            Yükleniyor...
          </div>
        ) : detail ? (
          <div className="mt-6 space-y-4">
            <div className="sticky top-0 z-10 rounded-xl border border-gray-200 bg-white/95 p-4 shadow-sm backdrop-blur">
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
                className="space-y-3 rounded-lg border p-4"
              >
                <InfoRow label="Parça ID" value={detail.id} />
                <InfoRow label="Article Link ID" value={detail.articleLinkId} />
                <InfoRow label="Ad" value={detail.name} />
                <InfoRow label="Marka" value={detail.brand || '-'} />
                <InfoRow label="Kategori" value={detail.category || '-'} />
                <InfoRow
                  label="Güncelleme"
                  value={new Date(detail.updatedAt).toLocaleString('tr-TR')}
                />
              </TabsContent>

              <TabsContent
                value="fiyat"
                className="space-y-3 rounded-lg border p-4"
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
                  <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50/50 p-4">
                    <h4 className="mb-3 text-sm font-semibold text-blue-900">
                      Fiyat Hesaplama Detayı ({activeRegionalOffer.providerName}
                      )
                    </h4>
                    <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
                      <div>
                        <p className="text-xs text-blue-600">
                          Tedarikçi Fiyatı
                        </p>
                        <p className="text-sm font-medium text-slate-800">
                          {activeRegionalOffer.supplierPrice != null
                            ? `${activeRegionalOffer.supplierPrice} ${activeRegionalOffer.currency}`
                            : '-'}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-blue-600">Marka İndirimi</p>
                        <p className="text-sm font-medium text-slate-800">
                          %
                          {(
                            activeRegionalOffer.standardDiscountRate * 100
                          ).toFixed(2)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-blue-600">
                          Kampanya İndirimi
                        </p>
                        <p className="text-sm font-medium text-slate-800">
                          %{(activeRegionalOffer.campaignRate * 100).toFixed(2)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-blue-800">
                          Satın Alma Fiyatı (Net)
                        </p>
                        <p className="text-sm font-bold text-slate-900">
                          {activeRegionalOffer.computedNetCost != null
                            ? `${activeRegionalOffer.computedNetCost} TRY`
                            : '-'}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-blue-600">
                          Kâr Oranı (Margin)
                        </p>
                        <p className="text-sm font-medium text-slate-800">
                          %{(activeRegionalOffer.marginRate * 100).toFixed(2)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-blue-800">
                          Sistem Satış Fiyatı
                        </p>
                        <p className="text-sm font-bold text-emerald-700">
                          {activeRegionalOffer.computedSellingPrice != null
                            ? `${activeRegionalOffer.computedSellingPrice} TRY`
                            : '-'}
                        </p>
                      </div>
                    </div>
                  </div>
                ) : null}

                <label className="flex items-center gap-2 text-sm text-gray-700 mt-4">
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
                className="space-y-3 rounded-lg border p-4"
              >
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={isVisible}
                    onChange={(event) => setIsVisible(event.target.checked)}
                  />
                  Ürün vitrinde görünsün
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={lockVisibility}
                    onChange={(event) =>
                      setLockVisibility(event.target.checked)
                    }
                  />
                  Görünürlük kilidini etkinleştir
                </label>
                <label className="block text-sm font-medium text-gray-700">
                  Not
                </label>
                <textarea
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  rows={4}
                  className="w-full rounded-lg border border-gray-200 p-2 text-sm"
                  placeholder="Operasyon notu"
                />
              </TabsContent>

              <TabsContent
                value="tedarik"
                className="space-y-3 rounded-lg border p-4"
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

                <div className="rounded-lg border border-gray-200">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-gray-100 bg-gray-50">
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
                          <td colSpan={6} className="px-3 py-3 text-gray-500">
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
                className="space-y-3 rounded-lg border p-4"
              >
                <p className="text-sm text-gray-600">
                  Aynı ürün anahtarında toplam {detail.variants.length} varyant
                  bulundu.
                </p>

                <div className="rounded-lg border border-gray-200">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-gray-100 bg-gray-50">
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
                              ? 'bg-slate-50/80'
                              : undefined
                          }
                        >
                          <td className="px-3 py-2 font-medium text-[#101828]">
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
                          <td colSpan={6} className="px-3 py-3 text-gray-500">
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
                className="space-y-3 rounded-lg border p-4"
              >
                <p className="text-sm text-gray-600">
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
                className="space-y-3 rounded-lg border p-4"
              >
                <InfoRow
                  label="Son Senkron"
                  value={
                    detail.lastSyncedAt
                      ? new Date(detail.lastSyncedAt).toLocaleString('tr-TR')
                      : 'Kayıt yok'
                  }
                />
                <div className="rounded-lg border border-gray-200">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-gray-100 bg-gray-50">
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
                          <td colSpan={4} className="px-3 py-3 text-gray-500">
                            Senkron geçmişi bulunamadı.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </TabsContent>
            </Tabs>

            <div className="flex justify-end gap-2 border-t pt-4">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Kapat
              </Button>
              <Button
                onClick={handleSave}
                disabled={isSaving || detailQuery.isFetching}
                className="bg-[#101828] hover:bg-[#1d2939]"
              >
                {isSaving ? (
                  <Loader2 size={14} className="mr-2 animate-spin" />
                ) : null}
                Kaydet
              </Button>
            </div>
          </div>
        ) : detailQuery.isError ? (
          <div className="mt-8 text-sm text-gray-500">
            Ürün detayı yüklenemedi.
          </div>
        ) : (
          <div className="mt-8 text-sm text-gray-500">
            Ürün detayı bulunamadı.
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50/70 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
        {label}
      </p>
      <p className="mt-1 text-sm font-semibold text-[#101828]">{value}</p>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-md bg-gray-50 px-3 py-2">
      <span className="text-xs font-medium text-gray-500">{label}</span>
      <span className="text-sm font-semibold text-[#101828]">{value}</span>
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
      <label className="mb-1 block text-xs font-medium text-gray-600">
        {label}
      </label>
      <input
        type={type}
        value={value}
        readOnly={readOnly}
        onChange={(event) => onChange?.(event.target.value)}
        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
      />
    </div>
  )
}

function ReadOnlySection({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-md border border-gray-200">
      <div className="border-b border-gray-100 px-3 py-2 text-xs font-semibold text-gray-600">
        {title}
      </div>
      <div className="max-h-32 overflow-auto px-3 py-2 text-xs text-gray-700">
        {items.length > 0 ? items.join(', ') : 'Kayıt yok'}
      </div>
    </div>
  )
}
