'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Car,
  ExternalLink,
  FileUp,
  ImagePlus,
  Loader2,
  Plus,
  Search,
  Trash2
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import {
  createSupplierReferenceClone,
  prepareSupplierReferenceCloneDraft,
  publishSupplierReferenceClone,
  searchSupplierReferenceCloneVehicleTypes,
  updateSupplierReferenceClone,
  uploadSupplierReferenceCloneDocument,
  uploadSupplierReferenceCloneImage
} from '@/lib/actions/admin-suppliers'
import type {
  SupplierReferenceCloneDraft,
  SupplierReferenceCloneEditableFields
} from '@/lib/types/admin-products'

interface SupplierReferenceCloneDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  providerCode: string
  supplierProductId: number
  sourcePartId: string | null
  existingPartId?: string | null
  onSaved?: () => void
}

interface VehicleTypeSearchItem {
  id: number
  label: string
  brandName: string
  modelName: string
  typeName: string
}

function cloneEditable(
  editable: SupplierReferenceCloneEditableFields
): SupplierReferenceCloneEditableFields {
  return {
    ...editable,
    eans: [...editable.eans],
    oemReferences: editable.oemReferences.map((item) => ({ ...item })),
    crossReferences: editable.crossReferences.map((item) => ({ ...item })),
    properties: editable.properties.map((item) => ({ ...item })),
    infos: [...editable.infos],
    images: editable.images.map((item) => ({ ...item })),
    documents: editable.documents.map((item) => ({ ...item })),
    vehicleTypes: editable.vehicleTypes.map((item) => ({ ...item })),
    supplierOffer: { ...editable.supplierOffer }
  }
}

export function SupplierReferenceCloneDrawer({
  open,
  onOpenChange,
  providerCode,
  supplierProductId,
  sourcePartId,
  existingPartId,
  onSaved
}: SupplierReferenceCloneDrawerProps) {
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [draft, setDraft] = useState<SupplierReferenceCloneDraft | null>(null)
  const [editable, setEditable] =
    useState<SupplierReferenceCloneEditableFields | null>(null)

  const loadDraft = async (overridePartId?: string | null) => {
    if (!sourcePartId && !overridePartId && !existingPartId) return

    setLoading(true)
    const result = await prepareSupplierReferenceCloneDraft({
      providerCode,
      supplierProductId,
      sourcePartId,
      partId: overridePartId ?? existingPartId ?? undefined
    })
    setLoading(false)

    if (!result.success || !result.data) {
      toast.error(result.message || 'Referans klon taslağı alınamadı.')
      return
    }

    setDraft(result.data)
    setEditable(cloneEditable(result.data.editable))
  }

  useEffect(() => {
    if (!open) return
    void loadDraft()
  }, [open, providerCode, supplierProductId, sourcePartId, existingPartId])

  const updateEditable = (
    updater: (
      current: SupplierReferenceCloneEditableFields
    ) => SupplierReferenceCloneEditableFields
  ) => {
    setEditable((current) => (current ? updater(current) : current))
  }

  const handleSave = async () => {
    if (!draft || !editable) return
    if (!sourcePartId) {
      toast.error('Önce bir referans part seçin.')
      return
    }

    setSaving(true)
    const result = draft.partId
      ? await updateSupplierReferenceClone({
          providerCode,
          supplierProductId,
          sourcePartId,
          partId: draft.partId,
          editable
        })
      : await createSupplierReferenceClone({
          providerCode,
          supplierProductId,
          sourcePartId,
          editable
        })
    setSaving(false)

    if (!result.success) {
      toast.error(result.message || 'Referans klon kaydedilemedi.')
      return
    }

    toast.success(result.message)
    onSaved?.()
    await loadDraft(result.data?.partId ?? draft.partId ?? null)
  }

  const handlePublish = async () => {
    if (!draft?.partId) {
      toast.error('Önce taslağı oluşturun.')
      return
    }

    setPublishing(true)
    const result = await publishSupplierReferenceClone({
      providerCode,
      supplierProductId,
      partId: draft.partId
    })
    setPublishing(false)

    if (!result.success) {
      toast.error(result.message || 'Referans klon yayınlanamadı.')
      return
    }

    toast.success(result.message)
    onSaved?.()
    await loadDraft(draft.partId)
  }

  const modeLabel = draft?.mode === 'edit' ? 'Taslak Düzenleme' : 'Yeni Taslak'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-7xl overflow-hidden border-border bg-muted p-0">
        <DialogHeader className="border-b border-border bg-background px-6 py-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <DialogTitle>Referans Klon Editörü</DialogTitle>
              <DialogDescription>
                Supplier ürününden türetilen draft part için hızlı düzenleme
                ekranı.
              </DialogDescription>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="secondary">{modeLabel}</Badge>
              <Badge variant={draft?.partId ? 'outline' : 'secondary'}>
                {draft?.partId ? `#${draft.partId}` : 'Kaydedilmemiş'}
              </Badge>
            </div>
          </div>
        </DialogHeader>

        {loading || !draft || !editable ? (
          <div className="flex h-[60vh] items-center justify-center text-sm text-muted-foreground">
            <Loader2 size={16} className="mr-2 animate-spin" />
            Taslak hazırlanıyor...
          </div>
        ) : (
          <div className="max-h-[calc(92vh-84px)] overflow-y-auto px-6 py-5">
            <div className="space-y-4">
              <SourceSummaryCard draft={draft} />

              <Tabs defaultValue="core" className="gap-4">
                <TabsList className="w-full justify-start">
                  <TabsTrigger value="core">Temel</TabsTrigger>
                  <TabsTrigger value="pricing">Fiyat / Stok</TabsTrigger>
                  <TabsTrigger value="references">Referanslar</TabsTrigger>
                  <TabsTrigger value="media">Medya</TabsTrigger>
                  <TabsTrigger value="vehicles">Araç Uyum</TabsTrigger>
                </TabsList>

                <TabsContent value="core" className="space-y-4">
                  <Panel title="Temel Ürün">
                    <div className="grid gap-3 md:grid-cols-2">
                      <Field
                        label="Ürün Adı"
                        value={editable.name}
                        onChange={(value) =>
                          updateEditable((current) => ({
                            ...current,
                            name: value
                          }))
                        }
                      />
                      <Field
                        label="Article Link ID"
                        value={editable.articleLinkId}
                        onChange={(value) =>
                          updateEditable((current) => ({
                            ...current,
                            articleLinkId: value
                          }))
                        }
                        type="number"
                      />
                      <SelectLikeField
                        label="Marka"
                        value={String(editable.brandId || '')}
                        options={draft.options.brands.map((item) => ({
                          value: String(item.id),
                          label: item.name
                        }))}
                        onChange={(value) =>
                          updateEditable((current) => ({
                            ...current,
                            brandId: value ? Number(value) : null
                          }))
                        }
                      />
                      <SelectLikeField
                        label="Kategori"
                        value={String(editable.categoryId || '')}
                        options={draft.options.categories.map((item) => ({
                          value: String(item.id),
                          label: item.name
                        }))}
                        onChange={(value) =>
                          updateEditable((current) => ({
                            ...current,
                            categoryId: value ? Number(value) : null
                          }))
                        }
                      />
                    </div>

                    <label className="mt-3 flex items-center gap-2 text-sm text-foreground">
                      <Checkbox
                        checked={editable.inBasket}
                        onCheckedChange={(checked) =>
                          updateEditable((current) => ({
                            ...current,
                            inBasket: Boolean(checked)
                          }))
                        }
                      />
                      `in_basket` aktif olsun
                    </label>
                  </Panel>

                  <Panel title="Görünürlük ve Override">
                    <div className="grid gap-3 md:grid-cols-2">
                      <Field
                        label="Satış Fiyatı Override"
                        value={editable.sellingPriceOverride?.toString() || ''}
                        onChange={(value) =>
                          updateEditable((current) => ({
                            ...current,
                            sellingPriceOverride:
                              value.trim() === '' ? null : Number(value)
                          }))
                        }
                        type="number"
                      />
                      <Field
                        label="Sync Status"
                        value={editable.syncStatus}
                        onChange={(value) =>
                          updateEditable((current) => ({
                            ...current,
                            syncStatus: value
                          }))
                        }
                      />
                    </div>
                    <div className="mt-3 grid gap-2 md:grid-cols-3">
                      <label className="flex items-center gap-2 text-sm text-foreground">
                        <Checkbox
                          checked={editable.isVisible}
                          onCheckedChange={(checked) =>
                            updateEditable((current) => ({
                              ...current,
                              isVisible: Boolean(checked)
                            }))
                          }
                        />
                        Vitrinde görünsün
                      </label>
                      <label className="flex items-center gap-2 text-sm text-foreground">
                        <Checkbox
                          checked={editable.lockPrice}
                          onCheckedChange={(checked) =>
                            updateEditable((current) => ({
                              ...current,
                              lockPrice: Boolean(checked)
                            }))
                          }
                        />
                        Fiyat kilidi
                      </label>
                      <label className="flex items-center gap-2 text-sm text-foreground">
                        <Checkbox
                          checked={editable.lockVisibility}
                          onCheckedChange={(checked) =>
                            updateEditable((current) => ({
                              ...current,
                              lockVisibility: Boolean(checked)
                            }))
                          }
                        />
                        Görünürlük kilidi
                      </label>
                    </div>
                    <div className="mt-3">
                      <p className="mb-1 text-xs font-medium text-muted-foreground">
                        Not
                      </p>
                      <Textarea
                        value={editable.note}
                        onChange={(event) =>
                          updateEditable((current) => ({
                            ...current,
                            note: event.target.value
                          }))
                        }
                        rows={4}
                      />
                    </div>
                  </Panel>
                </TabsContent>

                <TabsContent value="pricing" className="space-y-4">
                  <Panel title="Fiyat, Stok ve Supplier Offer">
                    <div className="grid gap-3 md:grid-cols-3">
                      <Field
                        label="Supplier Price"
                        value={editable.supplierPrice?.toString() || ''}
                        onChange={(value) =>
                          updateEditable((current) => ({
                            ...current,
                            supplierPrice:
                              value.trim() === '' ? null : Number(value)
                          }))
                        }
                        type="number"
                      />
                      <Field
                        label="Supplier Stock Qty"
                        value={String(editable.supplierStockQty)}
                        onChange={(value) =>
                          updateEditable((current) => ({
                            ...current,
                            supplierStockQty: Number(value) || 0
                          }))
                        }
                        type="number"
                      />
                      <Field
                        label="Currency"
                        value={editable.currency}
                        onChange={(value) =>
                          updateEditable((current) => ({
                            ...current,
                            currency: value
                          }))
                        }
                      />
                      <Field
                        label="Reserved Stock Qty"
                        value={String(editable.reservedStockQty)}
                        onChange={(value) =>
                          updateEditable((current) => ({
                            ...current,
                            reservedStockQty: Number(value) || 0
                          }))
                        }
                        type="number"
                      />
                      <Field
                        label="Min Stock Level"
                        value={String(editable.minStockLevel)}
                        onChange={(value) =>
                          updateEditable((current) => ({
                            ...current,
                            minStockLevel: Number(value) || 0
                          }))
                        }
                        type="number"
                      />
                    </div>
                    <div className="mt-4 grid gap-3 rounded-md border border-border bg-muted p-3 md:grid-cols-3">
                      <Field
                        label="Offer Supplier Price"
                        value={editable.supplierOffer.supplierPrice?.toString() || ''}
                        onChange={(value) =>
                          updateEditable((current) => ({
                            ...current,
                            supplierOffer: {
                              ...current.supplierOffer,
                              supplierPrice:
                                value.trim() === '' ? null : Number(value)
                            }
                          }))
                        }
                        type="number"
                      />
                      <Field
                        label="Offer Supplier Stock"
                        value={String(editable.supplierOffer.supplierStockQty)}
                        onChange={(value) =>
                          updateEditable((current) => ({
                            ...current,
                            supplierOffer: {
                              ...current.supplierOffer,
                              supplierStockQty: Number(value) || 0
                            }
                          }))
                        }
                        type="number"
                      />
                      <Field
                        label="Offer Currency"
                        value={editable.supplierOffer.currency}
                        onChange={(value) =>
                          updateEditable((current) => ({
                            ...current,
                            supplierOffer: {
                              ...current.supplierOffer,
                              currency: value
                            }
                          }))
                        }
                      />
                    </div>
                    <label className="mt-3 flex items-center gap-2 text-sm text-foreground">
                      <Checkbox
                        checked={editable.supplierOffer.isActive}
                        onCheckedChange={(checked) =>
                          updateEditable((current) => ({
                            ...current,
                            supplierOffer: {
                              ...current.supplierOffer,
                              isActive: Boolean(checked)
                            }
                          }))
                        }
                      />
                      Supplier offer aktif olsun
                    </label>
                  </Panel>
                </TabsContent>

                <TabsContent value="references" className="space-y-4">
                  <Panel title="Teknik Veriler">
                    <StringListEditor
                      label="EAN Kodları"
                      values={editable.eans}
                      onChange={(values) =>
                        updateEditable((current) => ({ ...current, eans: values }))
                      }
                    />
                    <StringListEditor
                      label="Bilgi Satırları"
                      values={editable.infos}
                      onChange={(values) =>
                        updateEditable((current) => ({ ...current, infos: values }))
                      }
                    />
                    <PairListEditor
                      label="OEM Referansları"
                      rows={editable.oemReferences}
                      fields={[
                        { key: 'brand', label: 'Marka' },
                        { key: 'code', label: 'Kod' }
                      ]}
                      onChange={(rows) =>
                        updateEditable((current) => ({
                          ...current,
                          oemReferences: rows
                        }))
                      }
                    />
                    <PairListEditor
                      label="Cross Referans"
                      rows={editable.crossReferences}
                      fields={[
                        { key: 'brand', label: 'Marka' },
                        { key: 'articleNumber', label: 'Kod' }
                      ]}
                      onChange={(rows) =>
                        updateEditable((current) => ({
                          ...current,
                          crossReferences: rows
                        }))
                      }
                    />
                    <PairListEditor
                      label="Özellikler"
                      rows={editable.properties}
                      fields={[
                        { key: 'key', label: 'Anahtar' },
                        { key: 'value', label: 'Değer' }
                      ]}
                      onChange={(rows) =>
                        updateEditable((current) => ({
                          ...current,
                          properties: rows
                        }))
                      }
                    />
                  </Panel>
                </TabsContent>

                <TabsContent value="media" className="space-y-4">
                  <Panel title="Görseller">
                    <ImageListEditor
                      rows={editable.images}
                      providerCode={providerCode}
                      supplierProductId={supplierProductId}
                      onChange={(rows) =>
                        updateEditable((current) => ({ ...current, images: rows }))
                      }
                    />
                  </Panel>

                  <Panel title="Dökümanlar">
                    <DocumentListEditor
                      rows={editable.documents}
                      providerCode={providerCode}
                      supplierProductId={supplierProductId}
                      onChange={(rows) =>
                        updateEditable((current) => ({
                          ...current,
                          documents: rows
                        }))
                      }
                    />
                  </Panel>
                </TabsContent>

                <TabsContent value="vehicles" className="space-y-4">
                  <Panel title="Vehicle Type Bağlantıları">
                    <VehicleTypeListEditor
                      rows={editable.vehicleTypes}
                      onChange={(rows) =>
                        updateEditable((current) => ({
                          ...current,
                          vehicleTypes: rows
                        }))
                      }
                    />
                  </Panel>
                </TabsContent>
              </Tabs>

              <div className="sticky bottom-0 z-10 flex flex-wrap justify-end gap-2 border-t border-border bg-muted py-3">
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  Kapat
                </Button>
                {draft.partId ? (
                  <Button
                    variant="secondary"
                    onClick={() => void handlePublish()}
                    disabled={publishing || saving}
                  >
                    {publishing ? (
                      <Loader2 size={14} className="mr-2 animate-spin" />
                    ) : null}
                    Yayınla
                  </Button>
                ) : null}
                <Button
                  onClick={() => void handleSave()}
                  disabled={saving || publishing}
                 
                >
                  {saving ? (
                    <Loader2 size={14} className="mr-2 animate-spin" />
                  ) : null}
                  {draft.partId ? 'Taslağı Güncelle' : 'Taslağı Oluştur'}
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function SourceSummaryCard({ draft }: { draft: SupplierReferenceCloneDraft }) {
  return (
    <div className="rounded-xl border border-border bg-background p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-foreground">Kaynak Özeti</h3>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">{draft.provider.name}</Badge>
          <Badge variant="outline">SKU: {draft.supplierProduct.sku}</Badge>
          <Badge variant="secondary">Kaynak: #{draft.sourcePart.id}</Badge>
        </div>
      </div>

      <div className="mt-3 grid gap-2 text-xs text-muted-foreground md:grid-cols-3">
        <InfoRow
          label="Supplier Ürün"
          value={draft.supplierProduct.name || '-'}
        />
        <InfoRow
          label="Kaynak Part"
          value={`#${draft.sourcePart.id} / ${draft.sourcePart.name}`}
        />
        <InfoRow
          label="Kategori"
          value={draft.resolvedCategory.name || '-'}
        />
        <InfoRow
          label="Resolved Marka"
          value={
            draft.resolvedBrand.name
              ? `${draft.resolvedBrand.name} (${draft.resolvedBrand.status})`
              : draft.resolvedBrand.status
          }
        />
        <InfoRow
          label="Supplier Marka"
          value={draft.supplierProduct.brand || '-'}
        />
        <InfoRow
          label="Mevcut Draft"
          value={draft.partId ? `#${draft.partId}` : 'Henüz yok'}
        />
      </div>
      {draft.warnings.length > 0 ? (
        <div className="mt-3 space-y-2 rounded-md border border-warning/20 bg-warning/10 p-3 text-xs text-warning">
          {draft.warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function Panel({
  title,
  children
}: {
  title: string
  children: ReactNode
}) {
  return (
    <div className="rounded-xl border border-border bg-background p-4">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <div className="mt-3 space-y-4">{children}</div>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-muted px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 font-medium text-foreground">{value}</p>
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  type = 'text'
}: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: 'text' | 'number'
}) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-muted-foreground">{label}</p>
      <Input
        value={value}
        type={type}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}

function SelectLikeField({
  label,
  value,
  options,
  onChange
}: {
  label: string
  value: string
  options: Array<{ value: string; label: string }>
  onChange: (value: string) => void
}) {
  const EMPTY_VALUE = '__none__'

  return (
    <div>
      <p className="mb-1 text-xs font-medium text-muted-foreground">{label}</p>
      <Select
        value={value || EMPTY_VALUE}
        onValueChange={(nextValue) =>
          onChange(nextValue === EMPTY_VALUE ? '' : nextValue)
        }
      >
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Seçin" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={EMPTY_VALUE}>Seçin</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

function StringListEditor({
  label,
  values,
  onChange
}: {
  label: string
  values: string[]
  onChange: (values: string[]) => void
}) {
  const updateValue = (index: number, value: string) => {
    const next = [...values]
    next[index] = value
    onChange(next)
  }

  const removeValue = (index: number) => {
    onChange(values.filter((_, itemIndex) => itemIndex !== index))
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => onChange([...values, ''])}
        >
          <Plus size={14} className="mr-1" />
          Satır Ekle
        </Button>
      </div>
      <div className="space-y-2">
        {values.map((value, index) => (
          <div key={`${label}-${index}`} className="flex gap-2">
            <Input
              value={value}
              onChange={(event) => updateValue(index, event.target.value)}
            />
            <Button
              type="button"
              size="icon"
              variant="outline"
              onClick={() => removeValue(index)}
            >
              <Trash2 size={14} />
            </Button>
          </div>
        ))}
        {values.length === 0 ? (
          <p className="text-xs text-muted-foreground">Kayıt yok.</p>
        ) : null}
      </div>
    </div>
  )
}

function PairListEditor<T extends Record<string, string>>({
  label,
  rows,
  fields,
  onChange
}: {
  label: string
  rows: T[]
  fields: Array<{ key: keyof T; label: string }>
  onChange: (rows: T[]) => void
}) {
  const updateRow = (index: number, key: keyof T, value: string) => {
    const next = rows.map((row, rowIndex) =>
      rowIndex === index ? { ...row, [key]: value } : row
    )
    onChange(next)
  }

  const addRow = () => {
    onChange([
      ...rows,
      Object.fromEntries(fields.map((field) => [field.key, ''])) as T
    ])
  }

  const removeRow = (index: number) => {
    onChange(rows.filter((_, rowIndex) => rowIndex !== index))
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <Button type="button" size="sm" variant="outline" onClick={addRow}>
          <Plus size={14} className="mr-1" />
          Satır Ekle
        </Button>
      </div>
      <div className="space-y-2">
        {rows.map((row, index) => (
          <div
            key={`${label}-${index}`}
            className="grid gap-2 md:grid-cols-[1fr_1fr_auto]"
          >
            {fields.map((field) => (
              <Input
                key={String(field.key)}
                value={row[field.key]}
                placeholder={field.label}
                onChange={(event) =>
                  updateRow(index, field.key, event.target.value)
                }
              />
            ))}
            <Button
              type="button"
              size="icon"
              variant="outline"
              onClick={() => removeRow(index)}
            >
              <Trash2 size={14} />
            </Button>
          </div>
        ))}
        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">Kayıt yok.</p>
        ) : null}
      </div>
    </div>
  )
}

function ImageListEditor({
  rows,
  providerCode,
  supplierProductId,
  onChange
}: {
  rows: SupplierReferenceCloneEditableFields['images']
  providerCode: string
  supplierProductId: number
  onChange: (rows: SupplierReferenceCloneEditableFields['images']) => void
}) {
  const [uploading, setUploading] = useState(false)

  const updateRow = (index: number, key: 'image' | 'thumb', value: string) => {
    const next = rows.map((row, rowIndex) =>
      rowIndex === index
        ? {
            ...row,
            [key]: value
          }
        : row
    )
    onChange(next)
  }

  const handleImageUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return

    setUploading(true)
    const nextRows = [...rows]

    for (const file of Array.from(files)) {
      const formData = new FormData()
      formData.set('providerCode', providerCode)
      formData.set('supplierProductId', String(supplierProductId))
      formData.set('file', file)

      const result = await uploadSupplierReferenceCloneImage(formData)
      if (!result.success || !result.data) {
        toast.error(result.message || `${file.name} yüklenemedi.`)
        continue
      }

      nextRows.push({
        image: result.data.url,
        thumb: result.data.thumbUrl || result.data.url
      })
    }

    setUploading(false)
    onChange(nextRows)
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">
          Görsel URL ve önizleme
        </p>
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={uploading}
            onClick={() => onChange([...rows, { image: '', thumb: '' }])}
          >
            <Plus size={14} className="mr-1" />
            Satır Ekle
          </Button>
          <label className="inline-flex">
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(event) => {
                void handleImageUpload(event.target.files)
                event.target.value = ''
              }}
            />
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={uploading}
              asChild
            >
              <span>
                {uploading ? (
                  <Loader2 size={14} className="mr-1 animate-spin" />
                ) : (
                  <ImagePlus size={14} className="mr-1" />
                )}
                Upload
              </span>
            </Button>
          </label>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {rows.map((row, index) => (
          <div
            key={`image-${index}`}
            className="rounded-md border border-border bg-muted p-3"
          >
            <div className="mb-3 aspect-video overflow-hidden rounded-md border border-border bg-background">
              {row.image ? (
                <img
                  src={row.thumb || row.image}
                  alt={`Gorsel ${index + 1}`}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                  Görsel yok
                </div>
              )}
            </div>
            <div className="space-y-2">
              <Input
                value={row.image}
                placeholder="Image URL"
                onChange={(event) =>
                  updateRow(index, 'image', event.target.value)
                }
              />
              <Input
                value={row.thumb || ''}
                placeholder="Thumb URL"
                onChange={(event) =>
                  updateRow(index, 'thumb', event.target.value)
                }
              />
              <div className="flex justify-end gap-2">
                {row.image ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => window.open(row.image, '_blank')}
                  >
                    <ExternalLink size={14} className="mr-1" />
                    Aç
                  </Button>
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    onChange(rows.filter((_, rowIndex) => rowIndex !== index))
                  }
                >
                  <Trash2 size={14} className="mr-1" />
                  Sil
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">Kayıt yok.</p>
      ) : null}
    </div>
  )
}

function DocumentListEditor({
  rows,
  providerCode,
  supplierProductId,
  onChange
}: {
  rows: SupplierReferenceCloneEditableFields['documents']
  providerCode: string
  supplierProductId: number
  onChange: (rows: SupplierReferenceCloneEditableFields['documents']) => void
}) {
  const [uploading, setUploading] = useState(false)

  const updateRow = (
    index: number,
    key: keyof SupplierReferenceCloneEditableFields['documents'][number],
    value: string
  ) => {
    const next = rows.map((row, rowIndex) =>
      rowIndex === index
        ? {
            ...row,
            [key]:
              key === 'docTypeId'
                ? value === ''
                  ? 0
                  : Number(value)
                : value
          }
        : row
    )
    onChange(next)
  }

  const addRow = () => {
    onChange([
      ...rows,
      {
        id: null,
        name: '',
        fileTypeName: '',
        docId: '',
        docTypeId: 1,
        docTypeName: 'DOKUMAN',
        url: ''
      }
    ])
  }

  const handleDocumentUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return

    setUploading(true)
    const nextRows = [...rows]

    for (const file of Array.from(files)) {
      const formData = new FormData()
      formData.set('providerCode', providerCode)
      formData.set('supplierProductId', String(supplierProductId))
      formData.set('file', file)

      const result = await uploadSupplierReferenceCloneDocument(formData)
      if (!result.success || !result.data) {
        toast.error(result.message || `${file.name} yüklenemedi.`)
        continue
      }

      nextRows.push({
        id: null,
        name: result.data.name,
        fileTypeName: result.data.fileTypeName,
        docId: result.data.docId,
        docTypeId: result.data.docTypeId,
        docTypeName: result.data.docTypeName,
        url: result.data.url
      })
    }

    setUploading(false)
    onChange(nextRows)
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">
          Döküman metadata ve bağlantı
        </p>
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="outline" onClick={addRow}>
            <Plus size={14} className="mr-1" />
            Satır Ekle
          </Button>
          <label className="inline-flex">
            <input
              type="file"
              multiple
              className="hidden"
              onChange={(event) => {
                void handleDocumentUpload(event.target.files)
                event.target.value = ''
              }}
            />
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={uploading}
              asChild
            >
              <span>
                {uploading ? (
                  <Loader2 size={14} className="mr-1 animate-spin" />
                ) : (
                  <FileUp size={14} className="mr-1" />
                )}
                Upload
              </span>
            </Button>
          </label>
        </div>
      </div>

      <div className="space-y-3">
        {rows.map((row, index) => (
          <div
            key={`doc-${index}`}
            className="rounded-md border border-border bg-muted p-3"
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="truncate text-sm font-medium text-foreground">
                {row.name || `Doküman ${index + 1}`}
              </p>
              <div className="flex gap-2">
                {row.url ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => window.open(row.url || '', '_blank')}
                  >
                    <ExternalLink size={14} className="mr-1" />
                    Aç
                  </Button>
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    onChange(rows.filter((_, rowIndex) => rowIndex !== index))
                  }
                >
                  <Trash2 size={14} className="mr-1" />
                  Sil
                </Button>
              </div>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              <Input
                value={row.name}
                placeholder="Dosya adı"
                onChange={(event) => updateRow(index, 'name', event.target.value)}
              />
              <Input
                value={row.fileTypeName}
                placeholder="Dosya tipi"
                onChange={(event) =>
                  updateRow(index, 'fileTypeName', event.target.value)
                }
              />
              <Input
                value={row.docId}
                placeholder="Doc ID"
                onChange={(event) => updateRow(index, 'docId', event.target.value)}
              />
              <Input
                value={String(row.docTypeId ?? '')}
                placeholder="Doc Type ID"
                type="number"
                onChange={(event) =>
                  updateRow(index, 'docTypeId', event.target.value)
                }
              />
              <Input
                value={row.docTypeName}
                placeholder="Doc Type Name"
                onChange={(event) =>
                  updateRow(index, 'docTypeName', event.target.value)
                }
              />
              <Input
                value={row.url || ''}
                placeholder="URL"
                onChange={(event) => updateRow(index, 'url', event.target.value)}
              />
            </div>
          </div>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">Kayıt yok.</p>
      ) : null}
    </div>
  )
}

function VehicleTypeListEditor({
  rows,
  onChange
}: {
  rows: SupplierReferenceCloneEditableFields['vehicleTypes']
  onChange: (rows: SupplierReferenceCloneEditableFields['vehicleTypes']) => void
}) {
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState<VehicleTypeSearchItem[]>([])

  const selectedMap = useMemo(
    () => new Map(rows.map((item) => [item.id, true])),
    [rows]
  )

  useEffect(() => {
    const value = query.trim()
    if (value.length < 2) {
      setResults([])
      return
    }

    const timeout = setTimeout(async () => {
      setSearching(true)
      const result = await searchSupplierReferenceCloneVehicleTypes({
        q: value,
        limit: 25
      })
      setSearching(false)

      if (!result.success || !result.data) {
        toast.error(result.message || 'Araç tipi araması başarısız.')
        return
      }

      setResults(result.data)
    }, 250)

    return () => clearTimeout(timeout)
  }, [query])

  const addRow = (item: VehicleTypeSearchItem) => {
    if (selectedMap.has(item.id)) {
      toast.info('Bu araç tipi zaten seçili.')
      return
    }

    onChange([
      ...rows,
      {
        id: item.id,
        label: item.label
      }
    ])
  }

  const removeRow = (id: number) => {
    onChange(rows.filter((row) => row.id !== id))
  }

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-border bg-muted p-3">
        <p className="mb-2 text-xs font-medium text-muted-foreground">
          Araç tipi ara ve seç
        </p>
        <div className="flex gap-2">
          <Input
            value={query}
            placeholder="Marka, model, araç tipi veya ID"
            onChange={(event) => setQuery(event.target.value)}
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => setQuery(query.trim())}
          >
            <Search size={14} className="mr-1" />
            Ara
          </Button>
        </div>
        <div className="mt-3 max-h-64 space-y-2 overflow-auto">
          {searching ? (
            <div className="flex items-center text-xs text-muted-foreground">
              <Loader2 size={14} className="mr-2 animate-spin" />
              Aranıyor...
            </div>
          ) : null}
          {!searching && results.length === 0 && query.trim().length >= 2 ? (
            <p className="text-xs text-muted-foreground">Sonuç bulunamadı.</p>
          ) : null}
          {results.map((item) => (
            <button
              key={item.id}
              type="button"
              className="flex w-full items-center justify-between rounded-md border border-border bg-background px-3 py-2 text-left hover:bg-muted"
              onClick={() => addRow(item)}
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">
                  {item.label}
                </p>
                <p className="text-xs text-muted-foreground">ID: {item.id}</p>
              </div>
              <Badge variant={selectedMap.has(item.id) ? 'secondary' : 'outline'}>
                {selectedMap.has(item.id) ? 'Seçili' : 'Ekle'}
              </Badge>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">Seçili araç tipleri</p>
        {rows.map((row) => (
          <div
            key={`vehicle-${row.id}`}
            className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">
                {row.label}
              </p>
              <p className="text-xs text-muted-foreground">Vehicle Type ID: {row.id}</p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => removeRow(row.id)}
            >
              <Trash2 size={14} className="mr-1" />
              Sil
            </Button>
          </div>
        ))}
        {rows.length === 0 ? (
          <div className="rounded-md border border-dashed border-input bg-muted p-4 text-center text-xs text-muted-foreground">
            <Car size={16} className="mx-auto mb-2" />
            Araç tipi bağlantısı yok.
          </div>
        ) : null}
      </div>
    </div>
  )
}
