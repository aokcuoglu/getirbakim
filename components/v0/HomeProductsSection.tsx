'use client'

import { useTranslations } from 'next-intl'
import type { SearchHit } from '@/lib/types/search'
import { GridProductCard } from '@/app/[locale]/[...slug]/_components/GridProductCard'
import { mapSearchHitToProductCardProps } from '@/lib/v0/mapSearchHitToProductCard'

interface HomeProductsSectionProps {
  products: SearchHit[]
}

export function HomeProductsSection({ products }: HomeProductsSectionProps) {
  const t = useTranslations('V0Home')

  if (products.length === 0) {
    return null
  }

  return (
    <section className="bg-background py-12 border-t border-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="mb-6 sm:mb-8">
          <h2 className="text-2xl sm:text-[28px] font-semibold text-foreground">
            {t('matchedProductsTitle')}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {t('matchedProductsDescription')}
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {products.map((product, index) => (
            <GridProductCard
              key={product.id}
              {...mapSearchHitToProductCardProps(product)}
              isFirst={index === 0}
            />
          ))}
        </div>
      </div>
    </section>
  )
}
