'use client'

import React, { useMemo, useState } from 'react'
import { SafeImage } from '@/components/ui/SafeImage'
import Link from 'next/link'
import { Package, Calendar } from 'lucide-react'
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

interface ProductCardProps {
  id: number
  name: string
  isFirst?: boolean
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

export function ProductCard({
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
  detailUrl,
  isFirst = false
}: ProductCardProps) {
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
  const fullImageUrl = imageUrl
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
  const stockStatusClass =
    resolvedAvailability === 'PURCHASABLE'
      ? 'text-success'
      : resolvedAvailability === 'OUT_OF_STOCK'
        ? 'text-destructive'
        : 'text-muted-foreground'
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
        imageUrl: fullImageUrl ?? '/logo.png'
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
    <div className="min-w-0 w-full rounded-sm border border-border bg-background px-4 py-3 transition-colors hover:border-input">
      <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-start lg:gap-5">
        <div className="flex shrink-0 flex-col gap-2.5 lg:w-[176px]">
          <div className="flex items-center">
            {brandLogo ? (
              <div className="flex h-6 w-[104px] items-center">
                <SafeImage
                  src={brandLogo}
                  alt={brandName}
                  width={104}
                  height={24}
                  className="h-full w-full object-contain object-left"
                  fallback={
                    <span className="truncate text-[13px] font-semibold text-foreground">
                      {brandName}
                    </span>
                  }
                />
              </div>
            ) : (
              <span className="max-w-[104px] truncate text-[13px] font-semibold text-foreground">
                {brandName}
              </span>
            )}
          </div>

           <div className="flex h-[128px] items-center justify-center rounded-sm bg-background">
            {fullImageUrl ? (
              <SafeImage
                src={fullImageUrl}
                alt={displayName}
                width={176}
                height={136}
                sizes="(max-width: 1024px) 176px, 176px"
                className="h-full w-full object-contain"
                priority={isFirst}
                loading={isFirst ? 'eager' : 'lazy'}
                fallback={<Package className="h-12 w-12 text-muted-foreground/70" />}
              />
            ) : (
              <Package className="h-12 w-12 text-muted-foreground/70" />
            )}
          </div>
        </div>

        <div className="min-w-0 flex-1 lg:pt-0.5">
          <Link href={productLink} className="block group">
            <h3 className="line-clamp-2 text-[18px] font-semibold leading-snug text-foreground transition-colors group-hover:text-primary">
              {displayName}
            </h3>
          </Link>

          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            {isVehicleSpecific && (
              <span className="rounded-sm bg-muted px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-foreground">
                {t('vehicleSpecific')}
              </span>
            )}
            {!isVehicleSpecific && variantCount > 1 && (
              <span className="rounded-sm bg-warning/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-warning">
                {t('fitmentVariants', { count: variantCount })}
              </span>
            )}
            <span className="text-xs font-medium text-muted-foreground">
              {t('specs.ID')}: {id}
            </span>
            {isBestseller && (
              <span className="rounded-sm bg-success px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-success-foreground">
                {t('bestseller')}
              </span>
            )}
            {hasSupplierSource && (
              <span className="rounded-sm bg-indigo-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-indigo-700">
                {t('supplierSource')}
              </span>
            )}
          </div>

          <p
            className={`mt-3 text-[11px] font-semibold uppercase tracking-wide ${stockStatusClass}`}
          >
            {canAddToCart ? t('inStock') : t('outOfStock')}
          </p>

          <div className="mt-2.5 space-y-1.5">
            {eanDisplay && (
              <p className="text-[13px] leading-5">
                <span className="font-medium text-muted-foreground">
                  {t('specs.EAN')}:
                </span>{' '}
                <span className="font-semibold text-foreground">{eanDisplay}</span>
              </p>
            )}
            {displayedProperties.map((prop, idx) => {
              const label = PRODUCT_SPEC_KEYS.has(prop.key)
                ? t('specs.' + prop.key)
                : prop.key
              const value = PRODUCT_SPEC_VALUE_KEYS.has(prop.value)
                ? t('specValues.' + prop.value)
                : prop.value

              return (
                <p key={idx} className="text-[13px] leading-5">
                  <span className="font-medium text-muted-foreground">{label}:</span>{' '}
                  <span className="font-semibold text-foreground">{value}</span>
                </p>
              )
            })}
          </div>

          {properties.length > 4 && (
            <button
              onClick={() => setShowAllProperties(!showAllProperties)}
              className="mt-2 text-[12px] font-semibold text-primary transition-colors hover:text-primary"
            >
              {showAllProperties ? t('showLess') : t('showAll')}
            </button>
          )}
        </div>

        <div className="shrink-0 rounded-sm border border-border bg-background p-3 lg:w-[244px] lg:self-stretch">
          {isPriceLoading ? (
            <p className="min-h-[48px] text-sm text-muted-foreground">
              {t('priceLoading')}
            </p>
          ) : formattedPrice ? (
            <div className="min-h-[48px]">
              <div className="flex items-baseline gap-2">
                <span className="text-[24px] font-bold leading-none text-foreground">
                  {formattedPrice}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {t('inclVat')} <span className="mx-1 text-muted-foreground/70">|</span>
                {t('exclShipping')}
              </p>
            </div>
          ) : (
            <div className="min-h-[48px]">
              <p className="text-sm text-muted-foreground">{t('priceNotAvailable')}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {t('priceInquiryHint')}
              </p>
            </div>
          )}

          {hasPrice ? (
            <div className="mt-3.5 flex gap-2">
              <Select
                value={quantity.toString()}
                onValueChange={(v) => setQuantity(Number(v))}
                disabled={!canAddToCart || isPriceLoading}
              >
                <SelectTrigger className="h-9 w-16 rounded-sm border-input bg-background text-sm font-semibold focus-visible:ring-ring/50">
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
                className="h-9 flex-1 rounded-sm px-4 text-sm font-semibold"
              >
                {resolvedCta === 'add_to_cart' ? t('addToCart') : t('outOfStock')}
              </Button>
            </div>
          ) : (
            <div className="mt-3.5">
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
                  <Button className="h-9 w-full rounded-sm bg-success px-4 text-sm font-semibold text-success-foreground hover:bg-success/90">
                    {resolvedCta === 'verify_fitment'
                      ? t('verifyFitment')
                      : resolvedCta === 'notify_or_request_price'
                        ? t('requestPriceWhenAvailable')
                        : t('askForPrice')}
                  </Button>
                }
              />
            </div>
          )}

          <div className="mt-3.5 space-y-2.5">
            <p className="flex min-h-5 items-center gap-2 text-[12px] text-muted-foreground">
              <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="truncate">
                {t('readyForDispatch')} {dispatchDateLabel}
              </span>
            </p>

            <label className="flex items-center gap-2 text-[12px] text-foreground transition-colors hover:text-foreground">
              <input
                type="checkbox"
                className="h-4 w-4 rounded-sm border-input text-primary focus-visible:ring-ring/50 focus:ring-offset-0"
              />
              <span>{t('addToCompare')} (0/3)</span>
            </label>
          </div>
        </div>
      </div>
    </div>
  )
}
