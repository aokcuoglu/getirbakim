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
        <div className="w-6 h-6 md:w-8 md:h-8 bg-emerald-500 rounded-full flex items-center justify-center shrink-0">
          <CheckCircle className="w-4 h-4 md:w-5 md:h-5 text-white" />
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
          <span className="text-base md:text-lg font-bold text-slate-700">
            {brand.name}
          </span>
        )}
      </div>

      {/* Product Title */}
      <h1 className="text-xl md:text-2xl lg:text-3xl font-bold text-slate-900 mb-1 md:mb-2 leading-tight">
        {displayName}
      </h1>

      {/* Product ID & Article Number - Compact on mobile */}
      <p className="text-xs md:text-sm text-slate-500 mb-3 md:mb-4">
        {articleNumber && (
          <span className="font-semibold text-slate-700 mr-2">{articleNumber}</span>
        )}
        <span className="font-medium">#{id}</span>
        {eans.length > 0 && (
          <span className="ml-2 text-slate-400">EAN: {eans[0]}</span>
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
              className="px-2 md:px-3 py-1 text-xs md:text-sm bg-slate-100 text-slate-700 rounded-full border border-slate-200 whitespace-nowrap shrink-0"
            >
              <span className="text-slate-500">{label}:</span>{' '}
              <span className="font-medium">{value}</span>
            </span>
          )
        })}
      </div>

      {/* Price Section - More compact on mobile */}
      <div className="bg-linear-to-r from-slate-50 to-slate-100 rounded-xl p-4 md:p-5 mb-4 md:mb-6">
        {formattedPrice ? (
          <>
            <div className="flex items-center gap-2 md:gap-3 mb-1 flex-wrap">
              <span className="text-2xl md:text-3xl font-bold text-slate-900">
                {formattedPrice}
              </span>
            </div>
            <p className="text-xs md:text-sm text-slate-500">
              {t('priceIncVat')}
            </p>
            <p
              className={`mt-2 text-xs md:text-sm font-medium ${
                canAddToCart ? 'text-emerald-700' : 'text-amber-700'
              }`}
            >
              {canAddToCart ? t('inStock') : t('outOfStock')}
            </p>
          </>
        ) : (
          <div className="space-y-3">
            <p className="text-base md:text-lg text-slate-500">
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
                <button className="inline-flex h-11 items-center justify-center rounded-lg bg-emerald-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-emerald-700">
                  {t('askForPrice')}
                </button>
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
            <SelectTrigger className="h-11 md:h-12 w-full border-slate-300 bg-white px-2 md:px-3 text-base md:text-lg font-medium">
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

        <button
          onClick={handleAddToCart}
          disabled={!canAddToCart}
          className="flex-1 h-11 md:h-12 px-4 md:px-8 bg-sky-500 hover:bg-sky-600 active:bg-sky-700 disabled:bg-sky-300 disabled:cursor-not-allowed text-white text-base md:text-lg font-semibold rounded-lg transition-all duration-200 shadow-md hover:shadow-lg flex items-center justify-center gap-2"
        >
          <ShoppingCart className="w-5 h-5" />
          <span>{canAddToCart ? t('addToCart') : t('outOfStock')}</span>
        </button>
      </div>

      {/* Shipping Info - Compact cards on mobile */}
      <div className="grid grid-cols-2 gap-2 md:gap-3 mb-4 md:mb-6">
        <div className="flex items-center gap-2 p-2.5 md:p-3 bg-emerald-50 rounded-lg border border-emerald-100">
          <Calendar className="w-4 h-4 md:w-5 md:h-5 text-emerald-600 shrink-0" />
          <div className="min-w-0">
            <p className="text-[10px] md:text-xs text-emerald-600">
              {t('dispatchDate')}
            </p>
            <p className="text-xs md:text-sm font-medium text-emerald-800 truncate">
              {getNextDispatchDate()}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 p-2.5 md:p-3 bg-sky-50 rounded-lg border border-sky-100">
          <Truck className="w-4 h-4 md:w-5 md:h-5 text-sky-600 shrink-0" />
          <div className="min-w-0">
            <p className="text-[10px] md:text-xs text-sky-600">
              {t('freeShipping')}
            </p>
            <p className="text-xs md:text-sm font-medium text-sky-800">
              {t('over')}
            </p>
          </div>
        </div>
      </div>

      {/* Trust Badges - Compact on mobile */}
      <div className="mt-auto pt-4 md:pt-6 border-t border-slate-200">
        <div className="flex items-center gap-3 md:gap-4 mb-3">
          <div className="flex items-center gap-1.5 md:gap-2 text-xs md:text-sm text-slate-600">
            <Shield className="w-4 h-4 md:w-5 md:h-5 text-emerald-600" />
            <span>{t('securePayment')}</span>
          </div>
          <div className="flex items-center gap-1.5 md:gap-2 text-xs md:text-sm text-slate-600">
            <CreditCard className="w-4 h-4 md:w-5 md:h-5 text-blue-600" />
            <span>{t('multiPayment')}</span>
          </div>
        </div>

        {/* Payment Icons - Horizontal scroll on mobile */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide">
          <div className="px-2.5 md:px-3 py-1 md:py-1.5 bg-white border border-slate-200 rounded text-[10px] md:text-xs font-bold text-slate-700 shrink-0">
            VISA
          </div>
          <div className="px-2.5 md:px-3 py-1 md:py-1.5 bg-white border border-slate-200 rounded text-[10px] md:text-xs font-bold text-slate-700 shrink-0">
            MasterCard
          </div>
          <div className="px-2.5 md:px-3 py-1 md:py-1.5 bg-white border border-slate-200 rounded text-[10px] md:text-xs font-bold text-slate-700 shrink-0">
            PayPal
          </div>
          <div className="px-2.5 md:px-3 py-1 md:py-1.5 bg-white border border-slate-200 rounded text-[10px] md:text-xs font-bold text-amber-600 shrink-0">
            Klarna
          </div>
        </div>
      </div>
    </div>
  )
}
