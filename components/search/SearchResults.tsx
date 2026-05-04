'use client'

/**
 * SearchResults
 *
 * List display of search results matching the category page format.
 * Uses the same ProductCard component as category pages.
 */

import { Loader2, Package } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SearchHit } from '@/lib/types/search'
import { ProductCard } from '@/app/[locale]/[...slug]/_components/ProductCard'
import { useLocale, useTranslations } from 'next-intl'

interface SearchResultsProps {
  hits: SearchHit[]
  totalHits: number
  isLoading: boolean
  className?: string
}

// Convert SearchHit to ProductCard props
function mapHitToProductCardProps(hit: SearchHit) {
  return {
    id: parseInt(hit.id, 10),
    name: hit.name,
    sourceType: hit.sourceType,
    supplierProductId: hit.supplierProductId ?? null,
    brandName: hit.brandName,
    categoryName: hit.categoryName,
    brandLogo: hit.brandLogo,
    image: hit.images?.[0]?.image || null,
    thumb: hit.images?.[0]?.thumb || null,
    price: hit.price,
    priceSource: hit.priceSource,
    isPlaceholderPrice: hit.isPlaceholderPrice,
    isPurchasable: hit.isPurchasable,
    properties: [], // Not indexed
    eans: hit.oemCodes || [],
    isVehicleSpecific: hit.formattedCompatibility.length > 0,
    isBestseller: false,
    stock: hit.stockQty
  }
}

export function SearchResults({
  hits,
  totalHits,
  isLoading,
  className
}: SearchResultsProps) {
  const t = useTranslations('SearchResults')
  const locale = useLocale()
  const numberLocale = locale === 'tr' ? 'tr-TR' : 'en-US'

  if (isLoading && hits.length === 0) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
      </div>
    )
  }

  if (!isLoading && hits.length === 0) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center text-center">
        <Package className="h-16 w-16 text-slate-200" />
        <h3 className="mt-4 text-lg font-medium text-slate-900">
          {t('noResultsTitle')}
        </h3>
        <p className="mt-1 text-sm text-slate-500">
          {t('noResultsDescription')}
        </p>
      </div>
    )
  }

  return (
    <div className={cn('space-y-4', className)}>
      {/* Results Count */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-600">
          <span className="font-medium text-slate-900">
            {totalHits.toLocaleString(numberLocale)}
          </span>{' '}
          {t('productsFound')}
        </p>
        {isLoading && (
          <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
        )}
      </div>

      {/* List - Same as Category Page */}
      <div className="space-y-4">
        {hits.map((hit) => (
          <ProductCard key={hit.id} {...mapHitToProductCardProps(hit)} />
        ))}
      </div>
    </div>
  )
}

export default SearchResults
