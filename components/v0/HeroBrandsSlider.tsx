'use client'

import Link from 'next/link'
import { useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Search } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'

import { Input } from '@/components/ui/input'
import { SafeImage } from '@/components/ui/SafeImage'
import type { V0BrandMatchRow } from '@/lib/v0/types'

interface HeroBrandsSliderProps {
  brands: V0BrandMatchRow[]
}

export function HeroBrandsSlider({ brands }: HeroBrandsSliderProps) {
  const t = useTranslations('Hero')
  const locale = useLocale()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')

  const filteredBrands = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase(locale)
    if (!normalized) return brands
    return brands.filter((brand) =>
      brand.brandName.toLocaleLowerCase(locale).includes(normalized)
    )
  }, [brands, query, locale])

  const scroll = (direction: 'left' | 'right') => {
    if (scrollRef.current) {
      const scrollAmount = 300
      scrollRef.current.scrollBy({
        left: direction === 'left' ? -scrollAmount : scrollAmount,
        behavior: 'smooth'
      })
    }
  }

  if (brands.length === 0) {
    return null
  }

  return (
    <section className="bg-muted py-12 border-t border-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="mb-6 sm:mb-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-2xl sm:text-[28px] font-semibold text-foreground">
              {t('brandsTitle')}
            </h2>
            <div className="relative w-full sm:max-w-xs">
              <Search
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('brandsSearchPlaceholder')}
                className="pl-9"
                aria-label={t('brandsSearchPlaceholder')}
              />
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => scroll('left')}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background text-muted-foreground transition-colors hover:bg-muted"
              aria-label={t('brandsScrollLeft')}
            >
              <ChevronLeft size={16} />
            </button>
            <button
              type="button"
              onClick={() => scroll('right')}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background text-muted-foreground transition-colors hover:bg-muted"
              aria-label={t('brandsScrollRight')}
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>

        {filteredBrands.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('brandsSearchEmpty')}</p>
        ) : (
          <div
            ref={scrollRef}
            className="grid grid-flow-col grid-rows-3 gap-2.5 overflow-x-auto pb-2 snap-x scrollbar-hide"
            style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
          >
            {filteredBrands.map((brand) => (
              <Link
                key={brand.matchId}
                href={`/${locale}/marka/${brand.matchId}`}
                className="w-[172px] shrink-0 snap-start rounded-sm p-0.5 opacity-75 grayscale transition-all hover:opacity-100 hover:grayscale-0"
              >
                <div className="flex h-[56px] w-full items-center justify-center overflow-hidden rounded-sm border border-border bg-background px-3">
                  {brand.logoUrl ? (
                    <SafeImage
                      src={brand.logoUrl}
                      alt={brand.brandName}
                      width={100}
                      height={50}
                      className="h-full w-full object-contain"
                      fallback={
                        <span className="text-sm font-bold text-foreground">
                          {brand.brandName}
                        </span>
                      }
                    />
                  ) : (
                    <span className="text-sm font-bold text-foreground">
                      {brand.brandName}
                    </span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
