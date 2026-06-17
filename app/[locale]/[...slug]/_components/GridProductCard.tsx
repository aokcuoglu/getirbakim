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

interface GridProductCardProps extends ProductCardItem {
  isFirst?: boolean
}

export function GridProductCard(props: GridProductCardProps) {
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

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-sm border border-border bg-background transition-colors hover:border-input">
      <div className="flex items-center px-3 pt-3">
        {props.brandLogo ? (
          <SafeImage
            src={props.brandLogo}
            alt={props.brandName}
            width={84}
            height={24}
            className="h-6 object-contain"
            fallback={
              <div className="flex h-6 items-center justify-center rounded-sm">
                <span className="text-[13px] font-semibold text-foreground">
                  {props.brandName}
                </span>
              </div>
            }
          />
        ) : (
          <div className="flex h-6 items-center justify-center rounded-sm">
            <span className="text-[13px] font-semibold text-foreground">
              {props.brandName}
            </span>
          </div>
        )}
      </div>

      <div className="flex aspect-square w-full items-center justify-center border-y border-border bg-muted/40 p-3">
        {imageUrl ? (
          <SafeImage
            src={imageUrl}
            alt={displayName}
            width={180}
            height={180}
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            className="h-full w-full max-h-40 object-contain"
            priority={props.isFirst}
            loading={props.isFirst ? 'eager' : 'lazy'}
            fallback={<Package className="h-16 w-16 text-muted-foreground/70" />}
          />
        ) : (
          <Package className="h-16 w-16 text-muted-foreground/70" />
        )}
      </div>

      <div className="flex flex-1 flex-col p-3 pt-2.5">
        <Link href={productLink} className="block group">
          <h3 className="mb-1.5 line-clamp-2 text-[14px] font-semibold leading-snug text-foreground transition-colors group-hover:text-primary">
            {displayName}
          </h3>
        </Link>

        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          {props.isVehicleSpecific && (
            <span className="rounded-sm bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-foreground">
              {t('vehicleSpecific')}
            </span>
          )}
          {!props.isVehicleSpecific && (props.variantCount ?? 1) > 1 && (
            <span className="rounded-sm bg-warning/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning">
              {t('fitmentVariants', { count: Number(props.variantCount) })}
            </span>
          )}
          <span className="text-[11px] text-muted-foreground font-medium">
            {t('specs.ID')}: {props.id}
          </span>
          {hasSupplierSource && (
            <span className="rounded-sm bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-700">
              {t('supplierSource')}
            </span>
          )}
        </div>

        <p
          className={`mb-2 text-[11px] font-semibold uppercase tracking-wide ${stockStatusClass}`}
        >
          {canAddToCart ? t('inStock') : t('outOfStock')}
        </p>

        {eanDisplay && (
          <p className="mb-1 text-[12px] leading-5">
            <span className="text-muted-foreground">{t('specs.EAN')}:</span>{' '}
            <span className="font-medium text-foreground">{eanDisplay}</span>
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
                <span className="text-muted-foreground">{label}:</span>{' '}
                <span className="font-medium text-foreground">{value}</span>
              </p>
            )
          })}
        </div>

        {props.properties.length > 4 && (
          <button
            onClick={() => setShowAllProperties(!showAllProperties)}
            className="mb-2 text-left text-[12px] font-semibold text-primary transition-colors hover:text-primary"
          >
            {showAllProperties ? t('showLess') : t('showAll')}
          </button>
        )}

        <div className="mt-auto border-t border-border pt-2.5">
          <p className="mb-2 flex min-h-5 items-center gap-2 text-[12px] text-muted-foreground">
            <Calendar className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">
              {t('readyForDispatch')} {dispatchDateLabel}
            </span>
          </p>

          {props.isPriceLoading ? (
            <p className="mb-3 min-h-[38px] text-sm text-muted-foreground">
              {t('priceLoading')}
            </p>
          ) : formattedPrice ? (
            <div className="mb-3 min-h-[38px]">
              <div className="mb-1 flex flex-wrap items-baseline gap-1.5">
                <span className="text-[21px] font-bold leading-none text-foreground">
                  {formattedPrice}
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground">
                {t('inclVat')} <span className="mx-1 text-muted-foreground/70">|</span>
                {t('exclShipping')}
              </p>
            </div>
          ) : (
            <p className="mb-3 min-h-[38px] text-sm text-muted-foreground">
              {t('priceNotAvailable')}
            </p>
          )}

          {hasDisplayPrice ? (
            <div className="flex items-center gap-2">
              <Select
                value={quantity.toString()}
                onValueChange={(v) => setQuantity(Number(v))}
                disabled={!canAddToCart || props.isPriceLoading}
              >
                <SelectTrigger className="h-8 w-14 rounded-sm border-input focus-visible:ring-ring/50">
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
                size="sm"
                className="h-8 flex-1 rounded-sm text-xs font-semibold"
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
                  partId: props.id,
                  partName: displayName,
                  brandName: props.brandName,
                  categoryName: props.categoryName
                }}
                trigger={
                  <Button className="h-8 w-full bg-success text-success-foreground hover:bg-success/90 text-xs font-semibold">
                    {resolvedCta === 'verify_fitment'
                      ? t('verifyFitment')
                      : resolvedCta === 'notify_or_request_price'
                        ? t('requestPriceWhenAvailable')
                        : t('askForPrice')}
                  </Button>
                }
              />
              <p className="text-[11px] text-muted-foreground">
                {t('priceInquiryHint')}
              </p>
            </div>
          )}

          <label className="mt-2.5 flex cursor-pointer items-center gap-2 text-[12px] text-muted-foreground transition-colors hover:text-foreground">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-input text-primary focus-visible:ring-ring/50 focus:ring-offset-0"
            />
            <span>{t('addToCompare')} (0/3)</span>
          </label>
        </div>
      </div>
    </div>
  )
}