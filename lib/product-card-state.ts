'use client'

import { useMemo, useState } from 'react'
import { useTranslations, useFormatter } from 'next-intl'
import { useShop } from '@/components/ShopProvider'
import { buildProductDisplayName } from '@/lib/product-display-name'

export interface ProductProperty {
  key: string
  value: string
}

import type { AvailabilityStatus } from '@/lib/search/availability'
import type { SearchCTA } from '@/lib/search/availability'

export interface ProductCardItem {
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

export function useProductCardState(item: ProductCardItem) {
  const t = useTranslations('ProductCard')
  const format = useFormatter()
  const { addToCart } = useShop()
  const [showAllProperties, setShowAllProperties] = useState(false)
  const [quantity, setQuantity] = useState(1)

  const VAT_RATE = 0.2
  const exVatPrice = item.price ? parseFloat(item.price) : null
  const priceIncVat =
    exVatPrice != null && Number.isFinite(exVatPrice)
      ? exVatPrice * (1 + VAT_RATE)
      : null
  const hasDisplayPrice =
    priceIncVat != null &&
    item.priceSource === 'real' &&
    !item.isPlaceholderPrice
  const formattedPrice =
    hasDisplayPrice
      ? new Intl.NumberFormat('tr-TR', {
          style: 'currency',
          currency: 'TRY',
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        }).format(priceIncVat)
      : null

  const displayedProperties = showAllProperties
    ? item.properties
    : item.properties.slice(0, 4)

  const eanDisplay = item.eans.length > 0 ? item.eans[0] : null

  const imageUrl = item.thumb || item.image
  const hasPrice = hasDisplayPrice
  const hasAvailableStock = (item.stock ?? 0) > 0
  const computedPurchasable = hasPrice && hasAvailableStock
  const canAddToCart = item.isPurchasable ?? computedPurchasable
  const safePriceIncVat = priceIncVat ?? 0
  const hasSupplierSource =
    item.sourceType === 'supplier_product' || Boolean(item.supplierProductId)
  const displayName = buildProductDisplayName({
    categoryName: item.categoryName,
    brandName: item.brandName,
    name: item.name
  })

  const resolvedAvailability: AvailabilityStatus = item.availabilityStatus ?? (
    canAddToCart ? 'PURCHASABLE'
    : hasPrice ? 'OUT_OF_STOCK'
    : 'REQUEST_PRICE'
  )
  const resolvedCta: SearchCTA = item.cta ?? (
    resolvedAvailability === 'PURCHASABLE' ? 'add_to_cart'
    : resolvedAvailability === 'OUT_OF_STOCK' ? 'notify_or_request_price'
    : resolvedAvailability === 'VERIFY_FITMENT' ? 'verify_fitment'
    : 'request_price'
  )
  const stockStatusClass =
    resolvedAvailability === 'PURCHASABLE'
      ? 'text-success'
      : resolvedAvailability === 'OUT_OF_STOCK'
        ? 'text-destructive'
        : 'text-muted-foreground'
  const productLink = item.detailUrl ?? `/part/${item.id}`

  const handleAddToCart = () => {
    if (!canAddToCart) return
    addToCart(
      {
        partId: item.id,
        id: String(item.id),
        name: displayName,
        brand: item.brandName,
        price: safePriceIncVat,
        imageUrl: imageUrl ?? '/logo.png'
      },
      quantity
    )
  }

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

  return {
    t,
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
    safePriceIncVat,
    hasSupplierSource,
    displayName,
    resolvedAvailability,
    resolvedCta,
    stockStatusClass,
    productLink,
    handleAddToCart,
    dispatchDateLabel
  }
}