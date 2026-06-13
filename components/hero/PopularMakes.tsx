'use client'
import React from 'react'
import { ArrowRight } from 'lucide-react'
import { POPULAR_MAKES } from './data'
import { useTranslations } from 'next-intl'

interface PopularMakesProps {
  onMakeSelect?: (make: string) => void
}

export function PopularMakes({ onMakeSelect }: PopularMakesProps) {
  const t = useTranslations('Hero')

  return (
    <section className="bg-background py-12 border-t border-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 text-center sm:text-left">
        <h2 className="mb-4 text-2xl font-semibold text-foreground sm:text-[28px]">
          {t('popularMakes')}
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2.5">
          {POPULAR_MAKES.map((make) => (
            <button
              key={make.key}
              onClick={() => onMakeSelect && onMakeSelect(make.key)}
              className="group h-[70px] border border-border bg-background px-2 transition-colors hover:border-input hover:bg-muted"
              aria-label={make.label}
            >
              <img
                src={make.logo}
                alt={make.alt}
                width={96}
                height={40}
                className="mx-auto h-10 w-auto object-contain opacity-90 transition-opacity group-hover:opacity-100"
              />
            </button>
          ))}
          <button className="h-[70px] border border-border hover:border-input text-muted-foreground hover:text-foreground transition-colors flex items-center justify-center text-xs font-semibold bg-transparent">
            {t('allMakes')} <ArrowRight size={12} className="ml-1" />
          </button>
        </div>
      </div>
    </section>
  )
}
