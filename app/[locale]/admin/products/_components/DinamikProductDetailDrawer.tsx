'use client'

import { useEffect, useMemo, useState, useTransition, type HTMLAttributes } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet'
import { createAdminPartFromDinamik } from '@/lib/actions/admin-products'
import type { AdminDinamikProductListItem } from '@/lib/types/admin-products'
import { useTranslations } from 'next-intl'

interface DinamikProductDetailDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  product: AdminDinamikProductListItem | null
  options: {
    brands: Array<{ id: number; name: string }>
    categories: Array<{ id: number; name: string }>
  }
  onCreated?: (partId: string) => void
}

function guessArticleLinkId(product: AdminDinamikProductListItem | null) {
  if (!product) return ''

  const fromPartNo = (product.partNo || '').replace(/\D/g, '')
  if (fromPartNo) return fromPartNo.slice(0, 12)

  const fromStockCode = product.stockCode.replace(/\D/g, '')
  if (fromStockCode) return fromStockCode.slice(0, 12)

  return String(Date.now()).slice(-10)
}

function guessName(product: AdminDinamikProductListItem | null) {
  if (!product) return ''
  if (product.stockName?.trim()) return product.stockName.trim()

  return [product.brand, product.partNo, product.stockCode].filter(Boolean).join(' ').trim()
}

function findBrandId(
  product: AdminDinamikProductListItem | null,
  brands: Array<{ id: number; name: string }>
) {
  if (!product) return ''

  const tokens = [product.brand, product.queryBrand]
    .map((value) => value?.trim().toLocaleLowerCase('tr'))
    .filter(Boolean) as string[]

  if (tokens.length === 0) return ''

  const matched = brands.find((brand) =>
    tokens.some((token) => brand.name.trim().toLocaleLowerCase('tr') === token)
  )

  return matched ? String(matched.id) : ''
}

export function DinamikProductDetailDrawer({
  open,
  onOpenChange,
  product,
  options,
  onCreated
}: DinamikProductDetailDrawerProps) {
  const t = useTranslations('DinamikProductDetail')
  const [isPending, startTransition] = useTransition()
  const [name, setName] = useState('')
  const [articleLinkId, setArticleLinkId] = useState('')
  const [price, setPrice] = useState('')
  const [brandId, setBrandId] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [inBasket, setInBasket] = useState(false)

  const sourceSummary = useMemo(() => {
    if (!product) return ''
    return `${product.stockCode}${product.partNo ? ` / ${product.partNo}` : ''}`
  }, [product])

  useEffect(() => {
    if (!product || !open) return

    setName(guessName(product))
    setArticleLinkId(guessArticleLinkId(product))
    setPrice(product.price != null ? product.price.toString() : '')
    setBrandId(findBrandId(product, options.brands))
    setCategoryId(options.categories[0] ? String(options.categories[0].id) : '')
    setInBasket(false)
  }, [product, open, options.brands, options.categories])

  const handleCreate = () => {
    if (!product) return

    const parsedArticle = Number(articleLinkId)
    const parsedBrand = Number(brandId)
    const parsedCategory = Number(categoryId)
    const parsedPrice = price.trim() ? Number(price) : null

    if (!name.trim()) {
      toast.error(t('errors.nameRequired'))
      return
    }

    if (!Number.isFinite(parsedArticle) || parsedArticle <= 0) {
      toast.error(t('errors.articleLinkIdInvalid'))
      return
    }

    if (!Number.isFinite(parsedBrand) || parsedBrand <= 0) {
      toast.error(t('errors.brandRequired'))
      return
    }

    if (!Number.isFinite(parsedCategory) || parsedCategory <= 0) {
      toast.error(t('errors.categoryRequired'))
      return
    }

    if (parsedPrice != null && (!Number.isFinite(parsedPrice) || parsedPrice < 0)) {
      toast.error(t('errors.priceInvalid'))
      return
    }

    startTransition(async () => {
      const result = await createAdminPartFromDinamik({
        stockCode: product.stockCode,
        queryBrand: product.queryBrand,
        name: name.trim(),
        articleLinkId: parsedArticle,
        price: parsedPrice,
        brandId: parsedBrand,
        categoryId: parsedCategory,
        inBasket,
        note: 'admin-products:dinamik-detail'
      })

      if (!result.success) {
        toast.error(result.message)
        return
      }

      toast.success(result.message)
      if (result.data?.partId) {
        onCreated?.(result.data.partId)
      }
      onOpenChange(false)
    })
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-[760px]">
        <SheetHeader>
          <SheetTitle>{t('title')}</SheetTitle>
          <SheetDescription>
            {product
              ? `${t('sourceRow')}: ${sourceSummary}`
              : t('selectRow')}
          </SheetDescription>
        </SheetHeader>

        {!product ? (
          <div className="mt-6 text-sm text-gray-500">
            {t('noProductSelected')}
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            <div className="grid grid-cols-1 gap-3 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm md:grid-cols-2">
              <InfoRow label={t('fields.queryBrand')} value={product.queryBrand || '-'} />
              <InfoRow label={t('fields.stockCode')} value={product.stockCode} />
              <InfoRow label={t('fields.partNo')} value={product.partNo || '-'} />
              <InfoRow label={t('fields.sourceBrand')} value={product.brand || '-'} />
            </div>

            <div className="rounded-lg border border-gray-200 p-4">
              <h3 className="mb-3 text-sm font-semibold text-[#101828]">
                {t('formTitle')}
              </h3>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <Field
                  label={t('fields.partName')}
                  value={name}
                  onChange={setName}
                  placeholder={t('placeholders.partName')}
                />
                <Field
                  label="Article Link ID"
                  value={articleLinkId}
                  onChange={setArticleLinkId}
                  inputMode="numeric"
                  placeholder="123456"
                />
                <Field
                  label={t('fields.priceTry')}
                  value={price}
                  onChange={setPrice}
                  inputMode="decimal"
                  placeholder="0.00"
                />

                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">
                    {t('fields.brand')}
                  </label>
                  <Select
                    value={brandId}
                    onValueChange={setBrandId}
                  >
                    <SelectTrigger className="h-10 w-full">
                      <SelectValue placeholder={t('placeholders.selectBrand')} />
                    </SelectTrigger>
                    <SelectContent>
                    {options.brands.map((brand) => (
                      <SelectItem key={brand.id} value={String(brand.id)}>
                        {brand.name}
                      </SelectItem>
                    ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">
                    {t('fields.category')}
                  </label>
                  <Select
                    value={categoryId}
                    onValueChange={setCategoryId}
                  >
                    <SelectTrigger className="h-10 w-full">
                      <SelectValue placeholder={t('placeholders.selectCategory')} />
                    </SelectTrigger>
                    <SelectContent>
                    {options.categories.map((category) => (
                      <SelectItem key={category.id} value={String(category.id)}>
                        {category.name}
                      </SelectItem>
                    ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <label className="mt-3 flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={inBasket}
                  onChange={(event) => setInBasket(event.target.checked)}
                />
                {t('fields.inBasket')}
              </label>
            </div>

            <div className="flex justify-end gap-2 border-t pt-4">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {t('close')}
              </Button>
              <Button
                onClick={handleCreate}
                disabled={isPending}
                className="bg-[#101828] hover:bg-[#1d2939]"
              >
                {isPending ? <Loader2 size={14} className="mr-2 animate-spin" /> : null}
                {t('saveAndMap')}
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-gray-100 bg-white px-3 py-2">
      <span className="text-xs font-medium text-gray-500">{label}</span>
      <span className="text-sm font-semibold text-[#101828]">{value}</span>
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  inputMode
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  inputMode?: HTMLAttributes<HTMLInputElement>['inputMode']
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-gray-600">{label}</label>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        inputMode={inputMode}
        className="h-10 w-full rounded-lg border border-gray-200 px-3 text-sm"
      />
    </div>
  )
}
