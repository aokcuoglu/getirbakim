'use client'

import React, { useState } from 'react'
import Image from 'next/image'
import {
  CheckCircle,
  Calendar,
  Truck,
  CreditCard,
  Shield,
  ShoppingCart
} from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useShop } from '@/components/ShopProvider'
import { CustomerRequestDialog } from '@/components/customer-requests/CustomerRequestDialog'
import { buildProductDisplayName } from '@/lib/product-display-name'
import {
  PRODUCT_SPEC_KEYS,
  PRODUCT_SPEC_VALUE_KEYS
} from '@/lib/product-card-i18n'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'

interface ProductInfoProps {
  id: number
  name: string
  articleNumber?: string | null
  brand: {
    id: number
    name: string
    logoUrl: string | null
  }
  categoryName?: string | null
  price: string | null
  stockQty: number
  priceSource: 'real' | 'placeholder'
  isPlaceholderPrice: boolean
  isPurchasable: boolean
  eans: string[]
  properties: {
    key: string
    value: string
  }[]
}

export function ProductInfo({
  id,
  name,
  articleNumber,
  brand,
  categoryName,
  price,
  stockQty,
  priceSource,
  isPlaceholderPrice,
  isPurchasable,
  eans,
  properties
}: ProductInfoProps) {
  const [quantity, setQuantity] = useState(1)
  const t = useTranslations('Part')
  const tProductCard = useTranslations('ProductCard')
  const locale = useLocale()
  const { addToCart } = useShop()

  // Format price
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
  const canAddToCart = hasDisplayPrice && isPurchasable
  const selectableMaxQty = Math.max(1, Math.min(10, stockQty))
  const safePriceIncVat = priceIncVat ?? 0
  const displayName = buildProductDisplayName({
    categoryName,
    brandName: brand.name,
    name
  })

  // Brand logo URL
  const brandLogoUrl = brand.logoUrl

  // Calculate dispatch date (next Tuesday)
  const getNextDispatchDate = () => {
    const today = new Date()
    const daysUntilTuesday = (2 - today.getDay() + 7) % 7 || 7
    const nextTuesday = new Date(today)
    nextTuesday.setDate(today.getDate() + daysUntilTuesday)
    return nextTuesday.toLocaleDateString(locale === 'tr' ? 'tr-TR' : 'en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric'
    })
  }

  // Deduplicate properties by key (last value wins), then take first 4
  const displayProperties = Array.from(
    new Map(properties.map((p) => [p.key, p])).values()
  ).slice(0, 4)

  const handleAddToCart = () => {
    if (!canAddToCart) return

    addToCart(
      {
        partId: id,
        id: String(id),
        name: displayName,
        brand: brand.name,
        price: safePriceIncVat,
        imageUrl: brandLogoUrl ?? '/logo.png'
      },
      quantity
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Brand Badge */}
      <div className="flex items-center gap-2 mb-3">
        <div className="w-6 h-6 md:w-8 md:h-8 bg-success rounded-full flex items-center justify-center shrink-0">
          <CheckCircle className="w-4 h-4 md:w-5 md:h-5 text-success-foreground" />
        </div>
        {brandLogoUrl ? (
          <Image
            src={brandLogoUrl}
            alt={brand.name}
            width={80}
            height={28}
            className="object-contain h-6 md:h-8"
          />
        ) : (
          <span className="text-base md:text-lg font-bold text-foreground">
            {brand.name}
          </span>
        )}
      </div>

      {/* Product Title */}
      <h1 className="text-xl md:text-2xl lg:text-3xl font-bold text-foreground mb-1 md:mb-2 leading-tight">
        {displayName}
      </h1>

      {/* Product ID & Article Number - Compact on mobile */}
      <p className="text-xs md:text-sm text-muted-foreground mb-3 md:mb-4">
        {articleNumber && (
          <span className="font-semibold text-foreground mr-2">{articleNumber}</span>
        )}
        <span className="font-medium">#{id}</span>
        {eans.length > 0 && (
          <span className="ml-2 text-muted-foreground">EAN: {eans[0]}</span>
        )}
      </p>

      {/* Quick Properties - Horizontal scroll on mobile */}
      <div className="flex gap-1.5 md:gap-2 mb-4 md:mb-6 overflow-x-auto pb-2 scrollbar-hide -mx-1 px-1">
        {displayProperties.map((prop, idx) => {
          const label = PRODUCT_SPEC_KEYS.has(prop.key)
            ? tProductCard('specs.' + prop.key)
            : prop.key
          const value = PRODUCT_SPEC_VALUE_KEYS.has(prop.value)
            ? tProductCard('specValues.' + prop.value)
            : prop.value

          return (
            <span
              key={idx}
              className="px-2 md:px-3 py-1 text-xs md:text-sm bg-muted text-foreground rounded-full border border-border whitespace-nowrap shrink-0"
            >
              <span className="text-muted-foreground">{label}:</span>{' '}
              <span className="font-medium">{value}</span>
            </span>
          )
        })}
      </div>

      {/* Price Section - More compact on mobile */}
      <div className="bg-linear-to-r from-muted to-muted rounded-xl p-4 md:p-5 mb-4 md:mb-6">
        {formattedPrice ? (
          <>
            <div className="flex items-center gap-2 md:gap-3 mb-1 flex-wrap">
              <span className="text-2xl md:text-3xl font-bold text-foreground">
                {formattedPrice}
              </span>
            </div>
            <p className="text-xs md:text-sm text-muted-foreground">
              {t('priceIncVat')}
            </p>
            <p
              className={`mt-2 text-xs md:text-sm font-medium ${
                canAddToCart ? 'text-success' : 'text-warning'
              }`}
            >
              {canAddToCart ? t('inStock') : t('outOfStock')}
            </p>
          </>
        ) : (
          <div className="space-y-3">
            <p className="text-base md:text-lg text-muted-foreground">
              {t('requestQuote')}
            </p>
            <CustomerRequestDialog
              requestType="PRICE_REQUEST"
              source="PRICE_MODAL"
              product={{
                partId: id,
                partName: displayName,
                brandName: brand.name,
                categoryName
              }}
              trigger={
                <Button className="bg-success text-success-foreground hover:bg-success/90">
                  {t('askForPrice')}
                </Button>
              }
            />
          </div>
        )}
      </div>

      {/* Quantity + Add to Cart - Full width on mobile */}
      <div className="flex items-center gap-2 md:gap-3 mb-4 md:mb-6">
        <div className="w-16 md:w-20">
          <Select
            value={String(quantity)}
            onValueChange={(value) => setQuantity(Number(value))}
            disabled={!canAddToCart}
          >
            <SelectTrigger className="h-11 md:h-12 w-full border-input bg-background px-2 md:px-3 text-base md:text-lg font-medium">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
            {Array.from({ length: selectableMaxQty }, (_, idx) => idx + 1).map((n) => (
              <SelectItem key={n} value={String(n)}>
                {n}
              </SelectItem>
            ))}
            </SelectContent>
          </Select>
        </div>

        <Button
          onClick={handleAddToCart}
          disabled={!canAddToCart}
          variant="default"
          size="lg"
          className="flex-1 h-11 md:h-12 text-base md:text-lg font-semibold shadow-md hover:shadow-lg"
        >
          <ShoppingCart className="w-5 h-5" />
          <span>{canAddToCart ? t('addToCart') : t('outOfStock')}</span>
        </Button>
      </div>

      {/* Shipping Info - Compact cards on mobile */}
      <div className="grid grid-cols-2 gap-2 md:gap-3 mb-4 md:mb-6">
        <div className="flex items-center gap-2 p-2.5 md:p-3 bg-success/10 rounded-md border border-success/20">
          <Calendar className="w-4 h-4 md:w-5 md:h-5 text-success shrink-0" />
          <div className="min-w-0">
            <p className="text-[10px] md:text-xs text-success">
              {t('dispatchDate')}
            </p>
            <p className="text-xs md:text-sm font-medium text-success truncate">
              {getNextDispatchDate()}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 p-2.5 md:p-3 bg-accent rounded-md border border-border">
          <Truck className="w-4 h-4 md:w-5 md:h-5 text-primary shrink-0" />
          <div className="min-w-0">
            <p className="text-[10px] md:text-xs text-primary">
              {t('freeShipping')}
            </p>
            <p className="text-xs md:text-sm font-medium text-primary">
              {t('over')}
            </p>
          </div>
        </div>
      </div>

      {/* Trust Badges - Compact on mobile */}
      <div className="mt-auto pt-4 md:pt-6 border-t border-border">
        <div className="flex items-center gap-3 md:gap-4 mb-3">
          <div className="flex items-center gap-1.5 md:gap-2 text-xs md:text-sm text-muted-foreground">
            <Shield className="w-4 h-4 md:w-5 md:h-5 text-success" />
            <span>{t('securePayment')}</span>
          </div>
          <div className="flex items-center gap-1.5 md:gap-2 text-xs md:text-sm text-muted-foreground">
            <CreditCard className="w-4 h-4 md:w-5 md:h-5 text-primary" />
            <span>{t('multiPayment')}</span>
          </div>
        </div>

        {/* Payment Icons - Horizontal scroll on mobile */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide">
          <div className="px-2.5 md:px-3 py-1 md:py-1.5 bg-background border border-border rounded text-[10px] md:text-xs font-bold text-foreground shrink-0">
            VISA
          </div>
          <div className="px-2.5 md:px-3 py-1 md:py-1.5 bg-background border border-border rounded text-[10px] md:text-xs font-bold text-foreground shrink-0">
            MasterCard
          </div>
          <div className="px-2.5 md:px-3 py-1 md:py-1.5 bg-background border border-border rounded text-[10px] md:text-xs font-bold text-foreground shrink-0">
            PayPal
          </div>
          <div className="px-2.5 md:px-3 py-1 md:py-1.5 bg-background border border-border rounded text-[10px] md:text-xs font-bold text-warning shrink-0">
            Klarna
          </div>
        </div>
      </div>
    </div>
  )
}
