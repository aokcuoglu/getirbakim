'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useTranslations, useLocale } from 'next-intl'
import {
  Minus,
  Plus,
  ShoppingCart,
  Truck,
  PackageCheck,
  Clock,
  ChevronRight
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useShop } from '@/components/ShopProvider'
import { buildCategoryUrl } from '@/lib/catalog-url'
import type { CatalogProductDetailView } from '@/lib/actions/catalog-store'
import { ProductTechnicalInfo } from './ProductTechnicalInfo'

interface Props {
  product: CatalogProductDetailView
}

export function CatalogProductDetail({ product }: Props) {
  const t = useTranslations('ProductDetail')
  const locale = useLocale()
  const { addToCart, setIsCartOpen } = useShop()
  const [quantity, setQuantity] = useState(1)
  const [activeImage, setActiveImage] = useState(product.primaryImageUrl)

  const categoryName =
    product.category &&
    (locale === 'tr' && product.category.nameTr
      ? product.category.nameTr
      : product.category.name)
  const categoryHref = product.category?.urlKey
    ? buildCategoryUrl(locale, { categoryUrlKey: product.category.urlKey })
    : null

  const canOrder =
    product.price.incVat != null &&
    (product.availability === 'IN_STOCK' || product.availability === 'SUPPLYABLE')

  const availabilityMeta = useMemo(() => {
    switch (product.availability) {
      case 'IN_STOCK':
        return {
          label: t('inStock'),
          className: 'bg-emerald-50 text-emerald-700 border-emerald-200',
          icon: <PackageCheck size={15} />,
          delivery: t('deliveryInStock')
        }
      case 'SUPPLYABLE':
        return {
          label: t('supplyable'),
          className: 'bg-amber-50 text-amber-700 border-amber-200',
          icon: <Clock size={15} />,
          delivery: t('deliverySupplyable')
        }
      default:
        return {
          label: t('unavailable'),
          className: 'bg-muted text-muted-foreground border-border',
          icon: null,
          delivery: null
        }
    }
  }, [product.availability, t])

  const handleAddToCart = () => {
    if (!canOrder || product.price.incVat == null) return
    addToCart(
      {
        partId: Number(product.id),
        id: product.id,
        name: product.name,
        brand: product.brand.name,
        price: product.price.incVat,
        imageUrl: product.primaryImageUrl ?? '/logo.png'
      },
      quantity
    )
    setIsCartOpen(true)
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 md:py-10">
      <nav className="mb-4 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
        <Link href="/" className="transition-colors hover:text-foreground">
          {t('home')}
        </Link>
        {categoryName && (
          <>
            <ChevronRight size={12} />
            {categoryHref ? (
              <Link
                href={categoryHref}
                className="transition-colors hover:text-foreground"
              >
                {categoryName}
              </Link>
            ) : (
              <span>{categoryName}</span>
            )}
          </>
        )}
        <ChevronRight size={12} />
        <span className="font-medium text-foreground">{product.name}</span>
      </nav>

      <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
        {/* Gallery */}
        <div>
          <div className="flex aspect-square items-center justify-center overflow-hidden rounded-xl border border-border bg-white">
            {activeImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={activeImage}
                alt={product.name}
                className="h-full w-full object-contain p-4"
                loading="eager"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">
                {t('noImage')}
              </div>
            )}
          </div>
          {product.images.length > 1 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {product.images.map((img) => (
                <button
                  key={img.url}
                  type="button"
                  onClick={() => setActiveImage(img.url)}
                  className={`h-16 w-16 overflow-hidden rounded-md border bg-white ${
                    activeImage === img.url ? 'border-primary' : 'border-border'
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img.thumb ?? img.url}
                    alt=""
                    className="h-full w-full object-contain p-1"
                    loading="lazy"
                  />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Buy box */}
        <div className="flex flex-col">
          <div className="flex items-center gap-3">
            {product.brand.logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={product.brand.logoUrl}
                alt={product.brand.name}
                className="h-7 object-contain"
                loading="lazy"
              />
            )}
            <span className="text-sm font-medium text-muted-foreground">
              {product.brand.name}
            </span>
          </div>

          <h1 className="mt-2 text-xl font-semibold leading-snug text-foreground md:text-2xl">
            {product.name}
          </h1>

          <p className="mt-1 text-sm text-muted-foreground">
            {t('sku')}: <span className="text-foreground">{product.partNo}</span>
          </p>

          <div className="mt-4 flex items-center gap-2">
            <Badge
              variant="outline"
              className={`gap-1.5 ${availabilityMeta.className}`}
            >
              {availabilityMeta.icon}
              {availabilityMeta.label}
            </Badge>
            {product.availability === 'IN_STOCK' && product.totalStockQty > 0 && (
              <span className="text-xs text-muted-foreground">
                {t('stockQty', { count: product.totalStockQty })}
              </span>
            )}
          </div>

          {product.price.formatted ? (
            <div className="mt-5">
              <div className="text-3xl font-bold text-foreground">
                {product.price.formatted}
              </div>
              <div className="text-xs text-muted-foreground">{t('vatIncluded')}</div>
            </div>
          ) : (
            <div className="mt-5 text-lg font-semibold text-muted-foreground">
              {t('priceOnRequest')}
            </div>
          )}

          {availabilityMeta.delivery && (
            <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
              <Truck size={16} />
              <span>{availabilityMeta.delivery}</span>
            </div>
          )}

          {canOrder && (
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <div className="flex items-center rounded-md border border-border">
                <button
                  type="button"
                  className="grid h-10 w-10 place-items-center text-muted-foreground hover:text-foreground"
                  onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                  aria-label={t('decrease')}
                >
                  <Minus size={16} />
                </button>
                <span className="w-10 text-center text-sm font-medium">{quantity}</span>
                <button
                  type="button"
                  className="grid h-10 w-10 place-items-center text-muted-foreground hover:text-foreground"
                  onClick={() => setQuantity((q) => Math.min(99, q + 1))}
                  aria-label={t('increase')}
                >
                  <Plus size={16} />
                </button>
              </div>
              <Button size="lg" className="gap-2" onClick={handleAddToCart}>
                <ShoppingCart size={18} />
                {t('addToCart')}
              </Button>
            </div>
          )}

          {product.offerCount > 0 && (
            <p className="mt-4 text-xs text-muted-foreground">
              {t('offerCount', { count: product.offerCount })}
            </p>
          )}
        </div>
      </div>

      {/* TecDoc enrichment — accordion sections + table of contents */}
      <ProductTechnicalInfo product={product} />
    </div>
  )
}
