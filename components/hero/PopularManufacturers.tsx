'use client'
import React, { useRef } from 'react'
import { SafeImage } from '@/components/ui/SafeImage'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { PopularManufacturer } from '@/lib/actions/getPopularManufacturers'
import { useTranslations } from 'next-intl'

interface PopularManufacturersProps {
  manufacturers: PopularManufacturer[]
  onBrandSelect?: (brand: string) => void
}

export function PopularManufacturers({
  manufacturers,
  onBrandSelect
}: PopularManufacturersProps) {
  const t = useTranslations('Hero')
  const scrollRef = useRef<HTMLDivElement>(null)

  const scroll = (direction: 'left' | 'right') => {
    if (scrollRef.current) {
      const scrollAmount = 300
      scrollRef.current.scrollBy({
        left: direction === 'left' ? -scrollAmount : scrollAmount,
        behavior: 'smooth'
      })
    }
  }

  return (
    <section className="bg-muted py-12 border-t border-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between mb-6 sm:mb-8">
          <h2 className="text-2xl sm:text-[28px] font-semibold text-foreground">
            {t('popularManufacturers')}
          </h2>
          <div className="flex gap-2">
            <button
              onClick={() => scroll('left')}
              className="w-8 h-8 rounded-full border border-border bg-background flex items-center justify-center hover:bg-muted text-muted-foreground transition-colors"
              aria-label="Scroll left"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              onClick={() => scroll('right')}
              className="w-8 h-8 rounded-full border border-border bg-background flex items-center justify-center hover:bg-muted text-muted-foreground transition-colors"
              aria-label="Scroll right"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>

        <div
          ref={scrollRef}
          className="grid grid-rows-3 grid-flow-col gap-2.5 overflow-x-auto scrollbar-hide pb-2 snap-x"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          {manufacturers.map((brand) => (
            <button
              key={brand.id}
              onClick={() => onBrandSelect && onBrandSelect(brand.name)}
              className="snap-start shrink-0 p-0.5 rounded-sm grayscale hover:grayscale-0 opacity-75 hover:opacity-100 transition-all w-[172px]"
            >
              <div className="w-full h-[56px] bg-background border border-border rounded-sm flex items-center justify-center overflow-hidden px-3">
                {brand.logoUrl ? (
                  <SafeImage
                    src={brand.logoUrl}
                    alt={brand.name}
                    width={100}
                    height={50}
                    className="object-contain w-full h-full"
                    fallback={
                      <span className="font-bold text-foreground text-sm">
                        {brand.name}
                      </span>
                    }
                  />
                ) : (
                  <span className="font-bold text-foreground text-sm">
                    {brand.name}
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}
