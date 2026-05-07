'use client'

import React, { useMemo, useState } from 'react'
import { SafeImage } from '@/components/ui/SafeImage'
import Link from 'next/link'
import { Package, Calendar, CheckCircle } from 'lucide-react'
import { useTranslations, useFormatter } from 'next-intl'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import {
  PRODUCT_SPEC_KEYS,
  PRODUCT_SPEC_VALUE_KEYS
} from '@/lib/product-card-i18n'
import { buildProductDisplayName } from '@/lib/product-display-name'
import { useShop } from '@/components/ShopProvider'
import { CustomerRequestDialog } from '@/components/customer-requests/CustomerRequestDialog'

interface ProductProperty {
  key: string
  value: string
}

import type { AvailabilityStatus } from '@/lib/search/availability'
import type { SearchCTA } from '@/lib/search/availability'

interface GridProductCardProps {
  id: number
  name: string
  sourceType?: 'part' | 'supplier_product'
  supplierProductId?: number | null
  brandName: string
  brandLogo?: string | null
  categoryName?: string | null
  image?: string | null
  thumb?: string | null
  price?: string | null
  priceSource?: 'real' | 'placeholder'
  isPlaceholderPrice?: boolean
  isPurchasable?: boolean
  properties: ProductProperty[]
  eans: string[]
  variantCount?: number
  isVehicleSpecific?: boolean
  isBestseller?: boolean
  stock?: number
  isPriceLoading?: boolean
  availabilityStatus?: AvailabilityStatus
  cta?: SearchCTA
  detailUrl?: string | null
}

export function GridProductCard({
  id,
  name,
  sourceType = 'part',
  supplierProductId,
  brandName,
  brandLogo,
  categoryName,
  image,
  thumb,
  price,
  priceSource,
  isPlaceholderPrice = false,
  isPurchasable,
  properties,
  eans,
  variantCount = 1,
  isVehicleSpecific = true,
  isBestseller = false,
  stock,
  isPriceLoading = false,
  availabilityStatus,
  cta,
  detailUrl
}: GridProductCardProps) {
  const t = useTranslations('ProductCard')
  const format = useFormatter()
  const { addToCart } = useShop()
  const [showAllProperties, setShowAllProperties] = useState(false)
  const [quantity, setQuantity] = useState(1)

  // Format price display
  const VAT_RATE = 0.2
  const exVatPrice = price ? parseFloat(price) : null
  const priceIncVat =
    exVatPrice != null && Number.isFinite(exVatPrice)
      ? exVatPrice * (1 + VAT_RATE)
      : null
  const hasDisplayPrice =
    priceIncVat != null &&
    priceSource === 'real' &&
    !isPlaceholderPrice
  const formattedPrice =
    hasDisplayPrice
      ? new Intl.NumberFormat('tr-TR', {
          style: 'currency',
          currency: 'TRY',
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        }).format(priceIncVat)
      : null

  // Limit displayed properties
  const displayedProperties = showAllProperties
    ? properties
    : properties.slice(0, 4)

  // Get first EAN for display
  const eanDisplay = eans.length > 0 ? eans[0] : null

  // Image URL
  const imageUrl = thumb || image
  const hasPrice = hasDisplayPrice
  const hasAvailableStock = (stock ?? 0) > 0
  const computedPurchasable = hasPrice && hasAvailableStock
  const canAddToCart = isPurchasable ?? computedPurchasable
  const safePriceIncVat = priceIncVat ?? 0
  const hasSupplierSource =
    sourceType === 'supplier_product' || Boolean(supplierProductId)
  const displayName = buildProductDisplayName({
    categoryName,
    brandName,
    name
  })

  const resolvedAvailability = availabilityStatus ?? (
    canAddToCart ? 'PURCHASABLE' as AvailabilityStatus
    : hasPrice ? 'OUT_OF_STOCK' as AvailabilityStatus
    : 'REQUEST_PRICE' as AvailabilityStatus
  )
  const resolvedCta = cta ?? (
    resolvedAvailability === 'PURCHASABLE' ? 'add_to_cart' as SearchCTA
    : resolvedAvailability === 'OUT_OF_STOCK' ? 'notify_or_request_price' as SearchCTA
    : resolvedAvailability === 'VERIFY_FITMENT' ? 'verify_fitment' as SearchCTA
    : 'request_price' as SearchCTA
  )
  const productLink = detailUrl ?? `/part/${id}`

  const handleAddToCart = () => {
    if (!canAddToCart) return

    addToCart(
      {
        partId: id,
        id: String(id),
        name: displayName,
        brand: brandName,
        price: safePriceIncVat,
        imageUrl: imageUrl ?? '/logo.png'
      },
      quantity
    )
  }

  // Keep dispatch date deterministic between SSR/CSR to avoid hydration-driven CLS.
  const dispatchDateLabel = useMemo(() => {
    const now = new Date()
    const daysUntilTuesday = (2 - now.getUTCDay() + 7) % 7 || 7
    const nextTuesdayUtc = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() + daysUntilTuesday
      )
    )
    return format.dateTime(nextTuesdayUtc, {
      weekday: 'long',
      month: 'numeric',
      day: 'numeric',
      year: '2-digit',
      timeZone: 'UTC'
    })
  }, [format])

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-sm border border-slate-200 bg-white transition-colors hover:border-slate-300">
      <div className="flex items-center gap-2 px-3 pt-3">
        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-red-500 shrink-0">
          <CheckCircle className="h-3.5 w-3.5 text-white" />
        </div>
        {brandLogo ? (
          <SafeImage
            src={brandLogo}
            alt={brandName}
            width={84}
            height={24}
            className="h-6 object-contain"
            fallback={
              <div className="flex h-6 items-center justify-center rounded-sm">
                <span className="text-[13px] font-semibold text-slate-700">
                  {brandName}
                </span>
              </div>
            }
          />
        ) : (
          <div className="flex h-6 items-center justify-center rounded-sm">
            <span className="text-[13px] font-semibold text-slate-700">
              {brandName}
            </span>
          </div>
        )}
      </div>

      <div className="flex aspect-square w-full items-center justify-center border-y border-slate-100 bg-slate-50/40 p-3">
        {imageUrl ? (
          <SafeImage
            src={imageUrl}
            alt={displayName}
            width={180}
            height={180}
            className="h-full w-full max-h-40 object-contain"
            fallback={<Package className="h-16 w-16 text-slate-300" />}
          />
        ) : (
          <Package className="h-16 w-16 text-slate-300" />
        )}
      </div>

      <div className="flex flex-1 flex-col p-3 pt-2.5">
        <Link href={productLink} className="block group">
          <h3 className="mb-1.5 line-clamp-2 text-[14px] font-semibold leading-snug text-slate-900 transition-colors group-hover:text-sky-600">
            {displayName}
          </h3>
        </Link>

        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          {isVehicleSpecific && (
            <span className="rounded-sm bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-700">
              {t('vehicleSpecific')}
            </span>
          )}
          {!isVehicleSpecific && variantCount > 1 && (
            <span className="rounded-sm bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
              {t('fitmentVariants', { count: variantCount })}
            </span>
          )}
          <span className="text-[11px] text-slate-400 font-medium">
            {t('specs.ID')}: {id}
          </span>
          {hasSupplierSource && (
            <span className="rounded-sm bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-700">
              {t('supplierSource')}
            </span>
          )}
        </div>

        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-emerald-600">
          {canAddToCart ? t('inStock') : t('outOfStock')}
        </p>

        {eanDisplay && (
          <p className="mb-1 text-[12px] leading-5">
            <span className="text-slate-500">{t('specs.EAN')}:</span>{' '}
            <span className="font-medium text-slate-800">{eanDisplay}</span>
          </p>
        )}

        <div className="mb-2 space-y-1 text-[12px] leading-5">
          {displayedProperties.map((prop, idx) => {
            const label = PRODUCT_SPEC_KEYS.has(prop.key)
              ? t('specs.' + prop.key)
              : prop.key
            const value = PRODUCT_SPEC_VALUE_KEYS.has(prop.value)
              ? t('specValues.' + prop.value)
              : prop.value

            return (
              <p key={idx} className="truncate">
                <span className="text-slate-500">{label}:</span>{' '}
                <span className="font-medium text-slate-800">{value}</span>
              </p>
            )
          })}
        </div>

        {properties.length > 4 && (
          <button
            onClick={() => setShowAllProperties(!showAllProperties)}
            className="mb-2 text-left text-[12px] font-semibold text-sky-600 transition-colors hover:text-sky-700"
          >
            {showAllProperties ? t('showLess') : t('showAll')}
          </button>
        )}

        <div className="mt-auto border-t border-slate-100 pt-2.5">
          <p className="mb-2 flex min-h-5 items-center gap-2 text-[12px] text-slate-600">
            <Calendar className="h-3.5 w-3.5 shrink-0 text-slate-500" />
            <span className="truncate">
              {t('readyForDispatch')} {dispatchDateLabel}
            </span>
          </p>

          {isPriceLoading ? (
            <p className="mb-3 min-h-[38px] text-sm text-slate-500">
              {t('priceLoading')}
            </p>
          ) : formattedPrice ? (
            <div className="mb-3 min-h-[38px]">
              <div className="mb-1 flex flex-wrap items-baseline gap-1.5">
                <span className="text-[21px] font-bold leading-none text-slate-900">
                  {formattedPrice}
                </span>
              </div>
              <p className="text-[11px] text-slate-500">
                {t('inclVat')} <span className="mx-1 text-slate-300">|</span>
                {t('exclShipping')}
              </p>
            </div>
          ) : (
            <p className="mb-3 min-h-[38px] text-sm text-slate-500">
              {t('priceNotAvailable')}
            </p>
          )}

          {hasPrice ? (
            <div className="flex items-center gap-2">
              <Select
                value={quantity.toString()}
                onValueChange={(v) => setQuantity(Number(v))}
                disabled={!canAddToCart || isPriceLoading}
              >
                <SelectTrigger className="h-8 w-14 rounded-sm border-slate-300 focus:ring-sky-500">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(stock !== undefined
                    ? stock > 0
                      ? Array.from(
                          { length: Math.min(stock, 5) },
                          (_, i) => i + 1
                        )
                      : []
                    : [1, 2, 3, 4, 5]
                  ).map((n) => (
                    <SelectItem key={n} value={n.toString()}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button
                onClick={handleAddToCart}
                disabled={!canAddToCart || isPriceLoading}
                className="h-8 flex-1 rounded-sm bg-blue-600 text-xs font-semibold text-white transition-colors hover:bg-blue-700 active:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {resolvedCta === 'add_to_cart' ? t('addToCart') : t('outOfStock')}
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <CustomerRequestDialog
                requestType={resolvedCta === 'verify_fitment' ? 'FITMENT_CHECK' : 'PRICE_REQUEST'}
                source={resolvedCta === 'verify_fitment' ? 'FITMENT_MODAL' : 'PRICE_MODAL'}
                product={{
                  partId: id,
                  partName: displayName,
                  brandName,
                  categoryName
                }}
                trigger={
                  <Button className="h-8 w-full bg-emerald-600 text-xs font-semibold text-white hover:bg-emerald-700">
                    {resolvedCta === 'verify_fitment'
                      ? t('verifyFitment')
                      : resolvedCta === 'notify_or_request_price'
                        ? t('requestPriceWhenAvailable')
                        : t('askForPrice')}
                  </Button>
                }
              />
              <p className="text-[11px] text-slate-500">
                {t('priceInquiryHint')}
              </p>
            </div>
          )}

          <label className="mt-2.5 flex cursor-pointer items-center gap-2 text-[12px] text-slate-600 transition-colors hover:text-slate-800">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500 focus:ring-offset-0"
            />
            <span>{t('addToCompare')} (0/3)</span>
          </label>
        </div>
      </div>
    </div>
  )
}
