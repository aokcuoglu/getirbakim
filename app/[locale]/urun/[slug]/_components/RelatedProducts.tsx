'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import type { CatalogProductCardView } from '@/lib/actions/catalog-store'

interface Props {
  products: CatalogProductCardView[]
}

/**
 * "Benzer ürünler" strip on the product detail page: same-category products
 * (excluding the current one), resolved server-side via
 * getCatalogProductsForStore and passed down as a lightweight card projection.
 */
export function RelatedProducts({ products }: Props) {
  const t = useTranslations('ProductDetail')

  if (products.length === 0) return null

  return (
    <section className="mx-auto mt-12 w-full max-w-6xl px-4">
      <h2 className="mb-4 text-base font-semibold text-foreground">
        {t('relatedProducts')}
      </h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        {products.map((p) => (
          <Link
            key={p.id}
            href={p.href}
            className="group flex flex-col overflow-hidden rounded-lg border border-border bg-card transition-colors hover:border-primary"
          >
            <div className="flex aspect-square items-center justify-center overflow-hidden bg-white">
              {p.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={p.image}
                  alt={p.name}
                  className="h-full w-full object-contain p-2"
                  loading="lazy"
                />
              ) : (
                <span className="text-xs text-muted-foreground">
                  {t('noImage')}
                </span>
              )}
            </div>
            <div className="flex flex-1 flex-col gap-1 p-2.5">
              <span className="text-[11px] font-medium text-muted-foreground">
                {p.brandName}
              </span>
              <span className="line-clamp-2 text-[13px] leading-snug text-foreground group-hover:text-primary">
                {p.name}
              </span>
              <span className="mt-auto pt-1 text-sm font-semibold text-foreground">
                {p.price.formatted ?? t('priceOnRequest')}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  )
}
