'use client'

import React from 'react'
import { SafeImage } from '@/components/ui/SafeImage'
import Link from 'next/link'
import { Package, Calendar } from 'lucide-react'
import { useTranslations } from 'next-intl'
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
import { CustomerRequestDialog } from '@/components/customer-requests/CustomerRequestDialog'
import { useProductCardState, type ProductCardItem } from '@/lib/product-card-state'

interface ProductCardProps extends ProductCardItem {
  isFirst?: boolean
}

export function ProductCard(props: ProductCardProps) {
  const t = useTranslations('ProductCard')
  const {
    showAllProperties,
    setShowAllProperties,
    quantity,
    setQuantity,
    formattedPrice,
    hasDisplayPrice,
    displayedProperties,
    eanDisplay,
    imageUrl,
    canAddToCart,
    hasSupplierSource,
    displayName,
    resolvedAvailability,
    resolvedCta,
    stockStatusClass,
    productLink,
    handleAddToCart,
    dispatchDateLabel
  } = useProductCardState(props)

  const fullImageUrl = imageUrl

  return (
    <div className="min-w-0 w-full rounded-sm border border-border bg-background px-4 py-3 transition-colors hover:border-input">
      <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-start lg:gap-5">
        <div className="flex shrink-0 flex-col gap-2.5 lg:w-[176px]">
          <div className="flex items-center">
            {props.brandLogo ? (
              <div className="flex h-6 w-[104px] items-center">
                <SafeImage
                  src={props.brandLogo}
                  alt={props.brandName}
                  width={104}
                  height={24}
                  className="h-full w-full object-contain object-left"
                  fallback={
                    <span className="truncate text-[13px] font-semibold text-foreground">
                      {props.brandName}
                    </span>
                  }
                />
              </div>
            ) : (
              <span className="max-w-[104px] truncate text-[13px] font-semibold text-foreground">
                {props.brandName}
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
                priority={props.isFirst}
                loading={props.isFirst ? 'eager' : 'lazy'}
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
            {props.isVehicleSpecific && (
              <span className="rounded-sm bg-muted px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-foreground">
                {t('vehicleSpecific')}
              </span>
            )}
            {!props.isVehicleSpecific && (props.variantCount ?? 1) > 1 && (
              <span className="rounded-sm bg-warning/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-warning">
                {t('fitmentVariants', { count: Number(props.variantCount) })}
              </span>
            )}
            <span className="text-xs font-medium text-muted-foreground">
              {t('specs.ID')}: {props.id}
            </span>
            {props.isBestseller && (
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

          {props.properties.length > 4 && (
            <button
              onClick={() => setShowAllProperties(!showAllProperties)}
              className="mt-2 text-[12px] font-semibold text-primary transition-colors hover:text-primary"
            >
              {showAllProperties ? t('showLess') : t('showAll')}
            </button>
          )}
        </div>

        <div className="shrink-0 rounded-sm border border-border bg-background p-3 lg:w-[244px] lg:self-stretch">
          {props.isPriceLoading ? (
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

          {hasDisplayPrice ? (
            <div className="mt-3.5 flex gap-2">
              <Select
                value={quantity.toString()}
                onValueChange={(v) => setQuantity(Number(v))}
                disabled={!canAddToCart || props.isPriceLoading}
              >
                <SelectTrigger className="h-9 w-16 rounded-sm border-input bg-background text-sm font-semibold focus-visible:ring-ring/50">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(props.stock !== undefined
                    ? props.stock > 0
                      ? Array.from(
                          { length: Math.min(props.stock, 5) },
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
                disabled={!canAddToCart || props.isPriceLoading}
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
                  partId: props.id,
                  partName: displayName,
                  brandName: props.brandName,
                  categoryName: props.categoryName
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